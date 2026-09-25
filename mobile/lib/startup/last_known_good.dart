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
///
/// Deliberately **not** what a 404/"nothing published for this tenant"
/// response produces — see [ExperienceFetchNotPublished]. A transient
/// failure is retried against last-known-good; "nothing published" is a
/// definitive, well-formed answer from the server and is not.
class ExperienceFetchFailed extends ExperienceFetchOutcome {
  final String reason;
  const ExperienceFetchFailed(this.reason);
}

/// A fetch that reached the server and received its documented, definitive
/// "no Published Experience exists for this tenant" answer (`GET
/// commerce/v1/experience`'s 404 — `CommerceExperienceController::show`)
/// — never produced by a network/timeout/transport/server error or
/// malformed bytes, which stay [ExperienceFetchFailed].
///
/// AWJ Runtime Boot contract: this is not a fetch failure and must never be
/// treated like one. [resolveStartup] routes it straight to the bundled
/// Default AWJ Experience ([UseDefaultExperience]), never through
/// last-known-good — a tenant that has genuinely never published (or has
/// deliberately unpublished) is not "temporarily unreachable", so there is
/// nothing to recover from and no reason to prefer a stale cache over the
/// current, correct answer.
class ExperienceFetchNotPublished extends ExperienceFetchOutcome {
  const ExperienceFetchNotPublished();
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

/// Render the bundled **Default AWJ Experience** — this runtime's own
/// `kHomeSchemaJson`/`kCartSchemaJson` (`app/runtime_schema.dart`) — because
/// this boot's tenant has no Published Experience at all
/// ([ExperienceFetchNotPublished]).
///
/// This is the AWJ Runtime Boot contract's explicit second branch, not an
/// accidental fallback: a tenant that has never published (or has
/// deliberately unpublished) an App Builder Experience is not in a failure
/// state, so it is never routed through [UseLastKnownGood] or
/// [ControlledUnavailable] — it gets this runtime's own always-available,
/// always-compatible bundled demo, by design.
///
/// Carries no payload: unlike [UseFreshExperience]/[UseLastKnownGood], the
/// Default AWJ Experience is not fetched, cached, or resolved through
/// [CompatibilityResolver] at all — it is compiled into this runtime build
/// itself, and the screen layer already knows how to render it (exactly as
/// it always has) whenever no live experience overrides it.
class UseDefaultExperience extends StartupDecision {
  const UseDefaultExperience();
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
/// [CapabilityManifest] — the **AWJ Runtime Boot contract** (MR-14's
/// "last-known-good startup and offline safety" decision mechanism, extended
/// to name the Default AWJ Experience explicitly):
///
/// 1. Published Experience exists and is compatible -> [UseFreshExperience].
/// 2. No Published Experience ([ExperienceFetchNotPublished]) ->
///    [UseDefaultExperience] — never treated as a fetch failure, never
///    routed through last-known-good.
/// 3. Fetch fails transiently ([ExperienceFetchFailed]) and a compatible,
///    intact last-known-good cache exists -> [UseLastKnownGood].
/// 4. Fetch fails transiently and no usable cache exists ->
///    [ControlledUnavailable].
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
  if (fetch is ExperienceFetchNotPublished) {
    return const UseDefaultExperience();
  }
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
