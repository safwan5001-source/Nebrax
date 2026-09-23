import 'push_message.dart';

/// Whether this runtime is currently allowed to receive/display push
/// notifications — modeled with four states, not a bool, because iOS and
/// Android's real permission models are not the same shape (Gate F:
/// "iOS/Android capability divergence is represented rather than assumed
/// equal"):
/// - Android (until API 32) never asks at all — a concrete adapter reports
///   [granted] immediately, with no user-facing prompt ever shown;
/// - Android 33+ shows exactly one system permission dialog, resulting in
///   [granted] or [denied] — it has no [provisional] concept;
/// - iOS shows an authorization prompt resulting in [granted], [denied], or
///   (if requested) quiet, no-alert [provisional] delivery with no prompt
///   at all. A concrete Android [PushAdapter] must never report
///   [provisional].
enum PushPermissionStatus {
  /// The user has not yet been asked, or permission hasn't been checked
  /// yet.
  notDetermined,
  granted,
  denied,

  /// iOS-only quiet delivery without an explicit prompt. Has no Android
  /// equivalent.
  provisional,
}

/// The provider-agnostic push boundary MR-09 requires: "prove a provider
/// adapter boundary and one safe notification-to-navigation path" without
/// committing this runtime to a specific vendor. A concrete implementation
/// (e.g. one eventually backed by Firebase Cloud Messaging, or any other
/// provider) lives entirely behind this interface — nothing outside
/// `lib/push/` may reference a vendor SDK type directly, so swapping
/// providers later is a one-class change, never a rewrite of
/// [PushController] or the app shell that owns it.
///
/// This interface is deliberately shaped like the real FCM Flutter
/// plugin's own API (`getToken`, `onMessage`, `onMessageOpenedApp`,
/// `getInitialMessage`) — not because this horizon adopts that plugin (it
/// does not; see `push_channel_adapter.dart`'s own doc comment for why),
/// but because that shape already matches every major push provider's
/// actual delivery model (foreground / background-tap / terminated-tap),
/// so a future concrete adapter for *any* provider can implement this
/// interface without forcing a redesign of the boundary itself.
abstract class PushAdapter {
  /// Must be called once before anything else on this adapter. Fail-safe:
  /// never throws, even when the native side isn't wired at all (a test
  /// host, or a platform this proof hasn't finished configuring).
  Future<void> initialize();

  /// Prompts (iOS) or checks (Android) for notification permission.
  Future<PushPermissionStatus> requestPermission();

  /// An opaque provider-issued registration token, or `null` when none is
  /// available yet. Never logged, never embedded in App Schema, never
  /// written to plain shared preferences (MR-07's boundary applies to this
  /// exactly as it does to a session token) — a real adapter would send
  /// this to the Commerce backend over an authenticated request, never a
  /// schema/deep-link/log surface.
  Future<String?> getToken();

  /// The message that launched this app, when it was launched by the user
  /// tapping a notification while the app was fully terminated (cold
  /// start) — mirrors `DeepLinkController`'s `getInitialLink` semantics
  /// exactly. `null` when the app was not launched this way.
  Future<PushMessage?> getInitialMessage();

  /// Fires when the user taps a notification while the app was running in
  /// the background (warm start) — mirrors `DeepLinkController`'s `onLink`.
  Stream<PushMessage> get onMessageOpenedApp;

  /// Fires when a message arrives while the app is in the foreground.
  /// Deliberately never wired to navigation anywhere in this runtime — a
  /// message merely *arriving* is never a command, only a tap is (the same
  /// principle MR-08 applies to deep links: only an explicit, allowlisted
  /// user action may navigate). Exposed for observability only.
  Stream<PushMessage> get onForegroundMessage;
}
