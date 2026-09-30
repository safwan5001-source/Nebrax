import 'package:flutter/services.dart';

import 'preview_deep_link.dart';

/// The one platform channel the **device preview entry point** uses to
/// receive an incoming Universal Link (iOS) / App Link (Android) —
/// literally the same channel name `deeplink/deep_link_channel.dart`'s
/// `DeepLinkController` uses for the production runtime. Native code
/// (`MainActivity.kt`/`SceneDelegate.swift`) forwards a raw URL string with
/// no opinion on which Dart entry point is listening, and `main.dart`/
/// `main_device_preview.dart` never run in the same process — so reusing
/// the channel name here needs no native change at all.
const MethodChannel _channel = MethodChannel('awj/deep_links');

/// Wires the incoming-link platform channel to [onReference] — called with
/// the resolved one-time exchange reference for a link this build
/// recognizes. Resolution here uses
/// [resolvePreviewExchangeReferenceFromString] exclusively — never the
/// production [resolveDeepLinkString] allowlist — so a link this entry
/// point receives can only ever become an exchange reference, structurally
/// never an `ActionRef` navigation action.
///
/// Mirrors `DeepLinkController`'s own resilience: `MissingPluginException`/
/// `PlatformException` (no native side wired, e.g. a test host) are treated
/// as "no link," never surfaced as a crash.
class PreviewDeepLinkController {
  final void Function(String reference) onReference;

  PreviewDeepLinkController({required this.onReference});

  /// Starts listening for `onLink` calls and checks for a cold-start link
  /// once. Safe to call exactly once, typically from the entry widget's
  /// `initState`.
  Future<void> start() async {
    _channel.setMethodCallHandler(_handleMethodCall);
    try {
      final initialLink = await _channel.invokeMethod<String>('getInitialLink');
      if (initialLink != null) {
        _resolveAndDispatch(initialLink);
      }
    } on MissingPluginException {
      // No native side registered (test host, or a platform not wired yet)
      // — there is simply no cold-start link to report.
    } on PlatformException {
      // A native-side failure reading the link is not this entry point's
      // fault to recover from beyond "there is no link" — never a crash.
    }
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    if (call.method != 'onLink') return;
    final link = call.arguments;
    if (link is String) _resolveAndDispatch(link);
  }

  void _resolveAndDispatch(String rawLink) {
    final reference = resolvePreviewExchangeReferenceFromString(rawLink);
    if (reference != null) onReference(reference);
  }
}
