import 'dart:async';

import 'package:flutter/services.dart';

import 'push_adapter.dart';
import 'push_message.dart';

/// The one platform channel this runtime uses for push, exactly the same
/// pattern `deep_link_channel.dart` established for Universal/App Links —
/// the native side only ever forwards an opaque token string or a
/// string-keyed payload map, never validates or interprets anything
/// itself; every allowlist decision happens Dart-side.
const MethodChannel _channel = MethodChannel('awj/push');

/// The one concrete [PushAdapter] this horizon proves: a first-party
/// Flutter platform channel, no third-party push plugin, no vendor SDK
/// dependency added to `pubspec.yaml` or the native build files.
///
/// This is a deliberate scope boundary, not an oversight. Wiring a real
/// transport (Firebase Cloud Messaging, or any alternative) means adding
/// `firebase_messaging`/`firebase_core` (or an equivalent) as a genuine
/// Flutter *and native* dependency — a Gradle plugin and a CocoaPod linked
/// into the release build, plus a Firebase project/APNs key this
/// environment has no account or credentials for. That is exactly the kind
/// of "strategic dependency lock-in" (MR-19) and "permanent push/messaging
/// vendor commitment" (horizon §10 Decision Gates) MR-09 itself names —
/// "any permanent messaging/provider choice is a Decision Gate" — not
/// something this proof may adopt on its own initiative merely to make
/// delivery "real".
///
/// What this class proves instead: the exact Dart-side contract a concrete
/// FCM-backed (or any other vendor's) adapter would need to satisfy, and
/// the notification-to-navigation pipeline that contract feeds — see
/// `push_controller.dart` and `push_payload_resolver.dart`. Swapping this
/// class for a real FCM-backed one later changes zero lines outside
/// `lib/push/`. This task's native Android/iOS glue behind `awj/push` is
/// deliberately inert beyond permission handling (see `MainActivity.kt`/
/// `AppDelegate.swift`'s own doc comments), for the same reason
/// `deep_link_channel.dart`'s native counterparts are not compiled/
/// verified by this environment — an acknowledged, documented gap, not a
/// silent one.
///
/// Fail-safe like [DeepLinkController]: `MissingPluginException`/
/// `PlatformException` from any channel call are caught and treated as
/// "nothing available" — never surfaced to the caller.
class ChannelPushAdapter implements PushAdapter {
  final _foregroundController = StreamController<PushMessage>.broadcast();
  final _openedAppController = StreamController<PushMessage>.broadcast();

  @override
  Future<void> initialize() async {
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    switch (call.method) {
      case 'onForegroundMessage':
        final message = _decodeMessage(call.arguments);
        if (message != null) _foregroundController.add(message);
      case 'onMessageOpenedApp':
        final message = _decodeMessage(call.arguments);
        if (message != null) _openedAppController.add(message);
    }
  }

  @override
  Future<PushPermissionStatus> requestPermission() async {
    try {
      final result = await _channel.invokeMethod<String>('requestPermission');
      return switch (result) {
        'granted' => PushPermissionStatus.granted,
        'denied' => PushPermissionStatus.denied,
        'provisional' => PushPermissionStatus.provisional,
        _ => PushPermissionStatus.notDetermined,
      };
    } on MissingPluginException {
      return PushPermissionStatus.notDetermined;
    } on PlatformException {
      return PushPermissionStatus.notDetermined;
    }
  }

  @override
  Future<String?> getToken() async {
    try {
      return await _channel.invokeMethod<String>('getToken');
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  @override
  Future<PushMessage?> getInitialMessage() async {
    try {
      final raw = await _channel.invokeMethod<Object?>('getInitialMessage');
      return _decodeMessage(raw);
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  @override
  Stream<PushMessage> get onMessageOpenedApp => _openedAppController.stream;

  @override
  Stream<PushMessage> get onForegroundMessage => _foregroundController.stream;

  /// Defensive decoding of a native-sent payload: a platform channel only
  /// guarantees `Map<Object?, Object?>` on the wire, never
  /// `Map<String, String>` — any non-string key or value is silently
  /// dropped rather than thrown, the same fail-safe posture
  /// `resolvePushPayload` itself takes on a malformed `type`/`pageId`/
  /// `productId`.
  PushMessage? _decodeMessage(Object? raw) {
    if (raw is! Map) return null;
    final data = <String, String>{};
    for (final entry in raw.entries) {
      final key = entry.key;
      final value = entry.value;
      if (key is String && value is String) data[key] = value;
    }
    return PushMessage(data);
  }

  /// Releases this adapter's stream controllers. Safe to call at most once;
  /// not part of [PushAdapter] itself since a test double may have nothing
  /// to release.
  void dispose() {
    _foregroundController.close();
    _openedAppController.close();
  }
}
