import '../schema/schema.dart';
import 'push_adapter.dart';
import 'push_message.dart';
import 'push_payload_resolver.dart';

/// Wires a [PushAdapter]'s notification-tap events to [onAction] — the
/// exact same shape `DeepLinkController` uses for incoming links, and for
/// the same reason: a notification tap must dispatch through
/// `AppActionDispatcher.dispatch` like every other user-initiated
/// navigation, never a parallel path.
///
/// Handles both lifecycle cases MR-09/Gate F ask for:
/// - cold start: the app was launched by tapping a notification while
///   terminated ([PushAdapter.getInitialMessage], checked once in [start]);
/// - warm start: the app was already running in the background and the
///   user tapped a notification ([PushAdapter.onMessageOpenedApp]).
///
/// A message that merely *arrives* while the app is in the foreground
/// ([PushAdapter.onForegroundMessage]) deliberately never reaches
/// [onAction] here — see that stream's own doc comment on [PushAdapter].
///
/// [start] also requests notification permission once, immediately. *When*
/// to ask (immediately vs. contextually, e.g. at first add-to-cart) is a
/// product/UX policy this horizon does not decide — asking once at launch
/// is simply the simplest default that lets this proof exercise the real
/// permission boundary end-to-end; a later task may change the timing
/// without touching this boundary.
class PushController {
  final PushAdapter adapter;
  final void Function(ActionRef action) onAction;

  PushPermissionStatus? _lastPermissionStatus;

  PushController({required this.adapter, required this.onAction});

  /// The most recent [PushPermissionStatus] this controller observed, or
  /// `null` before [start] has completed. Exposed for observability/tests,
  /// never read to gate navigation — a denied/undetermined permission never
  /// changes how an already-received tap is routed.
  PushPermissionStatus? get lastPermissionStatus => _lastPermissionStatus;

  Future<void> start() async {
    await adapter.initialize();
    _lastPermissionStatus = await adapter.requestPermission();
    adapter.onMessageOpenedApp.listen(_resolveAndDispatch);

    final initial = await adapter.getInitialMessage();
    if (initial != null) _resolveAndDispatch(initial);
  }

  void _resolveAndDispatch(PushMessage message) {
    final action = resolvePushPayload(message.data);
    if (action != null) onAction(action);
  }
}
