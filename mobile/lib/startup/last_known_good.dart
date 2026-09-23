import '../schema/schema.dart';
import 'integrity_digest.dart';

/// The outcome of *this boot's* attempt to obtain a Published Experience.
///
/// MOBILE-RUNTIME-10 proves the *decision mechanism* only (owner decision,
/// recorded in this task's implementation report): there is no real remote
/// Published Experience serving infrastructure in this repository yet — the
/// Home/Cart screens MOBILE-RUNTIME-5 shipped render a bundled fixture
/// schema (`kHomeSchemaJson`/`kCartSchemaJson`) directly, not a network
/// fetch. This type therefore models what a real fetch attempt's *outcome*
/// would look like without inventing the fetch itself: production code that
/// one day adds a real remote fetch only needs to produce this shape and
/// call [resolveStartup] — it does not need to know how the decision is
/// made.
sealed class ExperienceFetchOutcome {
  const ExperienceFetchOutcome();
}

/// A fetch that produced schema bytes (regardless of whether the runtime
/// can actually render them — [resolveStartup] still checks compatibility).
class ExperienceFetchSucceeded extends ExperienceFetchOutcome {
  final String rawJson;
  const ExperienceFetchSucceeded(this.rawJson);
}

/// A fetch that produced nothing usable: no network, a timeout, a server
/// error, or malformed bytes that failed to parse. [reason] is a stable,
/// non-sensitive machine-readable code (never a raw exception message or
/// URL, so this can never leak a token embedded in a query string or a
/// server error body into a diagnostic).
class ExperienceFetchFailed extends ExperienceFetchOutcome {
  final String reason;
  const ExperienceFetchFailed(this.reason);
}

/// A previously validated Published Experience cached as MR-14's
/// "last-known-good", together with the integrity/compatibility metadata a
/// later boot needs to decide whether it may still be trusted.
///
/// Deliberately structural: this class has no field, constructor parameter,
/// or setter through which a token, cart/order identifier, or any other
/// secret/business-authority value could ever be attached — the same
/// "structurally incapable" proof style `deep_link_resolver.dart` and
/// `push_payload_resolver.dart` already established for MR-07/MR-08/MR-09.
/// MR-14 requires this explicitly: "it contains no customer secrets" and
/// "sensitive/business data is not treated as current merely because
/// presentation can render".
class CachedExperience {
  final String rawJson;
  final String integrityDigest;
  final DateTime cachedAt;

  const CachedExperience({
    required this.rawJson,
    required this.integrityDigest,
    required this.cachedAt,
  });

  /// The only way production code should construct a cache entry: computes
  /// [integrityDigest] from [rawJson] itself, so a caller can never cache a
  /// digest that doesn't actually match its own bytes.
  factory CachedExperience.capture(String rawJson, {required DateTime cachedAt}) {
    return CachedExperience(
      rawJson: rawJson,
      integrityDigest: computeIntegrityDigest(rawJson),
      cachedAt: cachedAt,
    );
  }
}

/// Why [resolveStartup] fell back to a controlled-unavailable state, for
/// diagnostics (`diagnostics/diagnostic_context.dart`) and for the screen
/// layer to choose an appropriate message.
enum UnavailableReason {
  /// The fetch failed and no cache entry exists at all.
  fetchFailedNoCache,

  /// The fetch failed and a cache entry exists, but it fails its own
  /// integrity check (bytes were altered after caching) — MR-14 forbids
  /// trusting it merely because presentation could still render it.
  fetchFailedCacheCorrupted,

  /// The fetch failed and a cache entry exists and is intact, but it is not
  /// compatible with this runtime's current capability manifest (e.g. the
  /// runtime was downgraded, or the cache predates a capability the
  /// installed runtime no longer/not-yet supports).
  fetchFailedCacheIncompatible,

  /// The fetch failed and a cache entry exists and is intact, but it fails
  /// to parse at all (e.g. it was cached in an older, incompatible on-disk
  /// shape) — treated identically to a corrupted cache: never rendered.
  fetchFailedCacheUnparseable,

  /// The fetch succeeded but the freshly fetched schema itself is
  /// incompatible with this runtime (`CompatibilityResolver`'s own
  /// fail-closed rule) and no compatible cache exists to fall back to
  /// either.
  freshIncompatibleNoCache,
}

/// The startup decision `resolveStartup` reached.
sealed class StartupDecision {
  const StartupDecision();
}

/// Render the freshly fetched, compatible Experience. The normal case.
class UseFreshExperience extends StartupDecision {
  final RenderableExperience experience;
  const UseFreshExperience(this.experience);
}

/// Render a previously validated, still-compatible, integrity-intact cache
/// entry because this boot's fetch did not succeed. MR-14: this is
/// presentation recovery only — the caller must still treat any commerce
/// operation (price, stock, cart, order) as unvalidated until the server is
/// reachable again ([revalidateWhenOnline] documents that obligation; this
/// type carries no commerce data itself to make the point structurally).
class UseLastKnownGood extends StartupDecision {
  final RenderableExperience experience;
  final DateTime cachedAt;

  /// Always `true` — documents the MR-14 obligation ("stale commerce
  /// operations fail safely and revalidate server-side when connectivity
  /// returns") for any caller that renders this decision. Kept as an
  /// explicit field (rather than only a doc comment) so a future caller
  /// wiring this into a real screen has something concrete to branch on,
  /// without this proof having to invent the revalidation call itself.
  final bool revalidateWhenOnline = true;

  const UseLastKnownGood({required this.experience, required this.cachedAt});
}

/// Show a controlled unavailable/update-required state. Never execute
/// unknown or partially validated schema, and never guess.
class ControlledUnavailable extends StartupDecision {
  final UnavailableReason reason;
  final String message;
  const ControlledUnavailable({required this.reason, required this.message});
}

/// Decides what a boot should render, given this attempt's fetch outcome, an
/// optional previously cached Experience, and the installed runtime's
/// [CapabilityManifest] — MR-14's "last-known-good startup and offline
/// safety" decision mechanism.
///
/// Pure function, exactly like [CompatibilityResolver.resolve] (which it
/// delegates every compatibility question to, never re-implementing the
/// fail-closed rule): same inputs, same output, no I/O, no network, no
/// platform storage read/write. This mirrors `compatibility.dart`'s own
/// "deliberately... trivially unit-testable" design note.
StartupDecision resolveStartup({
  required ExperienceFetchOutcome fetch,
  required CachedExperience? cached,
  required CapabilityManifest manifest,
  CompatibilityResolver resolver = const CompatibilityResolver(),
}) {
  if (fetch is ExperienceFetchSucceeded) {
    final AppSchema schema;
    try {
      schema = AppSchema.parse(fetch.rawJson);
    } on SchemaFormatException {
      return _fallBackToCache(cached, manifest, resolver);
    }
    final result = resolver.resolve(schema, manifest);
    if (result is RenderableExperience) {
      return UseFreshExperience(result);
    }
    // Freshly fetched but incompatible: still try a compatible cache before
    // giving up, per MR-14's own "no compatible last-known-good experience
    // exists" framing (it does not carve out an exception for "fetch
    // technically succeeded but produced something unusable"). If no cache
    // was ever recorded, [freshIncompatibleNoCache] names that precisely;
    // if a cache exists but is itself corrupted/unparseable/incompatible,
    // the more specific reason `_fallBackToCache` already determined is
    // preserved rather than overwritten with a less accurate "no cache"
    // label.
    final fallback = _fallBackToCache(cached, manifest, resolver);
    if (fallback is ControlledUnavailable && cached == null) {
      return const ControlledUnavailable(
        reason: UnavailableReason.freshIncompatibleNoCache,
        message: 'fetched experience is incompatible with this runtime and no '
            'cached experience is available',
      );
    }
    return fallback;
  }

  return _fallBackToCache(cached, manifest, resolver);
}

StartupDecision _fallBackToCache(
  CachedExperience? cached,
  CapabilityManifest manifest,
  CompatibilityResolver resolver,
) {
  if (cached == null) {
    return const ControlledUnavailable(
      reason: UnavailableReason.fetchFailedNoCache,
      message: 'no experience could be fetched and no cached experience exists',
    );
  }
  if (computeIntegrityDigest(cached.rawJson) != cached.integrityDigest) {
    return const ControlledUnavailable(
      reason: UnavailableReason.fetchFailedCacheCorrupted,
      message: 'cached experience failed its integrity check and will not be rendered',
    );
  }
  final AppSchema schema;
  try {
    schema = AppSchema.parse(cached.rawJson);
  } on SchemaFormatException {
    return const ControlledUnavailable(
      reason: UnavailableReason.fetchFailedCacheUnparseable,
      message: 'cached experience could not be parsed and will not be rendered',
    );
  }
  final result = resolver.resolve(schema, manifest);
  if (result is RenderableExperience) {
    return UseLastKnownGood(experience: result, cachedAt: cached.cachedAt);
  }
  return const ControlledUnavailable(
    reason: UnavailableReason.fetchFailedCacheIncompatible,
    message: 'cached experience is no longer compatible with this runtime and will not be rendered',
  );
}
