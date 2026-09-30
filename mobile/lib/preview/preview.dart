/// AWJ Mobile Runtime — Real Runtime Preview (MOBILE-PREVIEW-6) and its
/// merchant-usable QR/deep-link physical-device handoff (MOBILE-PREVIEW-7).
///
/// Consumes a `PreviewSession` credential (MOBILE-PREVIEW-5's approved
/// security architecture) against `preview/v1`, structurally unrelated to
/// `commerce/v1`/[CommerceClient]. Reuses the real [CompatibilityResolver],
/// Component Registry, and [ExperienceView] hydration/render path — never a
/// second schema/runtime contract. MOBILE-PREVIEW-7 adds only how a device
/// *obtains* that credential (a scanned deep link → one-time exchange →
/// real bearer, `AwjDevicePreviewApp`/`PreviewExchangeClient`) — the
/// rendering path itself (`PreviewRuntimeView`/`PreviewClient`) is untouched
/// and identically reused by both entry points.
library;

export 'device_preview_app.dart';
export 'preview_action_handler.dart';
export 'preview_app.dart';
export 'preview_client.dart';
export 'preview_config.dart';
export 'preview_deep_link.dart';
export 'preview_deep_link_channel.dart';
export 'preview_exchange_client.dart';
export 'preview_exchange_outcome.dart';
export 'preview_fetch_outcome.dart';
export 'preview_fetcher.dart';
export 'preview_runtime_view.dart';
export 'preview_startup.dart';
