import 'package:flutter/services.dart';

import '../schema/schema.dart';
import 'deep_link_resolver.dart';

/// The one platform channel this runtime uses to receive an incoming
/// Universal Link (iOS) / App Link (Android) from native code — the native
/// side (`MainActivity.kt`/`AppDelegate.swift`) only ever forwards a raw URL
/// string; every bit of validation/allowlisting happens Dart-side in
/// [resolveDeepLinkString], never trusted from native input directly.
const MethodChannel _channel = MethodChannel('awj/deep_links');

/// Wires the incoming-link platform channel to [onAction] — called with the
/// resolved [ActionRef] for a link this runtime recognizes, exactly the
/// same shape any other schema-driven tap already produces. A link this
/// runtime doesn't recognize, can't parse, or that fails validation simply
/// never calls [onAction] — never a crash, matching [resolveDeepLinkString]'s
/// own fail-safe contract.
///
/// This is deliberately resilient to native code not being wired at all
/// (e.g. a test host, or a platform this proof hasn't finished configuring):
/// `MissingPluginException`/`PlatformException` from either the initial-link
/// fetch or the handler registration are caught and treated as "no link",
/// never surfaced to the caller.
class DeepLinkController {
  final void Function(ActionRef action) onAction;

  DeepLinkController({required this.onAction});

  /// Starts listening for `onLink` calls and checks for a cold-start link
  /// once. Safe to call exactly once, typically from the app shell's
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
      // A native-side failure reading the link is not this runtime's fault
      // to recover from beyond "there is no link" — never a crash.
    }
  }

  Future<void> _handleMethodCall(MethodCall call) async {
    if (call.method != 'onLink') return;
    final link = call.arguments;
    if (link is String) _resolveAndDispatch(link);
  }

  void _resolveAndDispatch(String rawLink) {
    final action = resolveDeepLinkString(rawLink);
    if (action != null) onAction(action);
  }
}
