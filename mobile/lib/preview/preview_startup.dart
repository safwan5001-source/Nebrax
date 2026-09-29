import '../schema/schema.dart';
import 'preview_fetch_outcome.dart';

/// What a Preview boot should render, given one fetch attempt
/// (MOBILE-PREVIEW-6). Deliberately narrower than `last_known_good.dart`'s
/// [StartupDecision]: Preview never caches a previous fetch and never falls
/// back to a bundled Default Experience (§5.15/task item 8 — "do not
/// silently fall back to Published inside Preview"; the same reasoning
/// rules out a silent fallback to Default here too), so there is no
/// [UseLastKnownGood]/[UseDefaultExperience] analogue at all — only
/// "rendered", or one of three distinct controlled-failure states.
sealed class PreviewStartupDecision {
  const PreviewStartupDecision();
}

/// Render the fetched, compatible snapshot. [draftChanged] carries the
/// server's own advisory flag (§5.5) straight through — this decision layer
/// neither drops it nor turns it into a blocking state.
class PreviewReady extends PreviewStartupDecision {
  final RenderableExperience experience;
  final bool draftChanged;
  const PreviewReady({required this.experience, required this.draftChanged});
}

/// Expired, revoked, or unknown/malformed token — the one class of failure
/// this runtime is structurally unable to tell apart (§5.15), so it shows
/// exactly one "no longer available" state for all three.
class PreviewUnauthorized extends PreviewStartupDecision {
  const PreviewUnauthorized();
}

/// The fetched snapshot itself is incompatible with this runtime's
/// [CapabilityManifest] ([CompatibilityResolver]'s own fail-closed rule —
/// the *actual* resolver, not a re-implementation), or failed to parse at
/// all.
class PreviewIncompatible extends PreviewStartupDecision {
  final String message;
  const PreviewIncompatible(this.message);
}

/// The fetch never reached a usable answer — network/transport/protocol
/// failure. Retryable, unlike the two states above.
class PreviewUnavailable extends PreviewStartupDecision {
  final String message;
  const PreviewUnavailable(this.message);
}

/// Pure function — no I/O, no network, no platform storage — exactly like
/// [CompatibilityResolver.resolve] and `last_known_good.dart`'s
/// `resolveStartup`, which this delegates every compatibility question to
/// rather than re-implementing it.
PreviewStartupDecision resolvePreviewStartup({
  required PreviewFetchOutcome fetch,
  required CapabilityManifest manifest,
  CompatibilityResolver resolver = const CompatibilityResolver(),
}) {
  if (fetch is PreviewFetchUnauthorized) {
    return const PreviewUnauthorized();
  }
  if (fetch is PreviewFetchUnavailable) {
    return PreviewUnavailable('preview service is unavailable (${fetch.reason})');
  }

  final succeeded = fetch as PreviewFetchSucceeded;
  final AppSchema schema;
  try {
    schema = AppSchema.parse(succeeded.rawSchemaJson);
  } on SchemaFormatException {
    return const PreviewIncompatible('preview schema could not be parsed');
  }

  final result = resolver.resolve(schema, manifest);
  if (result is RenderableExperience) {
    return PreviewReady(experience: result, draftChanged: succeeded.draftChanged);
  }
  final incompatible = result as IncompatibleExperience;
  return PreviewIncompatible(incompatible.message);
}
