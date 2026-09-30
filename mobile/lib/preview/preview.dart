/// AWJ Mobile Runtime — Real Runtime Preview (MOBILE-PREVIEW-6).
///
/// Consumes a `PreviewSession` credential (MOBILE-PREVIEW-5's approved
/// security architecture) against `preview/v1`, structurally unrelated to
/// `commerce/v1`/[CommerceClient]. Reuses the real [CompatibilityResolver],
/// Component Registry, and [ExperienceView] hydration/render path — never a
/// second schema/runtime contract.
library;

export 'preview_action_handler.dart';
export 'preview_app.dart';
export 'preview_client.dart';
export 'preview_config.dart';
export 'preview_fetch_outcome.dart';
export 'preview_fetcher.dart';
export 'preview_runtime_view.dart';
export 'preview_startup.dart';
