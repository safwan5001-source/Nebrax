import '../commerce/commerce.dart';
import '../schema/schema.dart';
import 'experience_cache.dart';
import 'last_known_good.dart';

/// The real fetch+cache wiring around MR-14's `resolveStartup` (a pure
/// decision function with zero I/O by design — see `last_known_good.dart`'s
/// own doc comment, which named exactly this as future work). APP-BUILDER-19.
///
/// This is the *only* place in the runtime that calls
/// [CommerceClient.getExperienceSchemaJson] to obtain an
/// [ExperienceFetchOutcome], and the *only* place that writes to
/// [ExperienceCache] — `resolveStartup` itself stays exactly as already
/// unit-tested, unmodified, with no I/O of its own.
Future<StartupDecision> resolveRealStartup({
  required CommerceClient client,
  required ExperienceCache cache,
  required CapabilityManifest manifest,
}) async {
  // MR-14's whole point is that a boot always reaches a decision, never an
  // unhandled exception — a platform-storage failure reading the cache is
  // treated exactly like "no cache exists" rather than crashing startup.
  CachedExperience? cached;
  try {
    cached = await cache.read();
  } catch (_) {
    cached = null;
  }

  final outcome = await _fetch(client);

  final decision = resolveStartup(fetch: outcome, cached: cached, manifest: manifest);

  // Only a *fresh, rendered* fetch is worth persisting — never a
  // last-known-good reuse (that would just re-write the same bytes under a
  // newer `cachedAt`, hiding from the *next* boot how stale the cache
  // really is) and never a fetch `resolveStartup` itself rejected as
  // incompatible/unparseable (caching something it won't render is
  // pointless, and would let a bad entry linger instead of retrying next
  // boot). A failure persisting it must never discard an otherwise-good
  // decision this boot should still render — caching is a best-effort side
  // effect, not a precondition for [UseFreshExperience].
  if (decision is UseFreshExperience && outcome is ExperienceFetchSucceeded) {
    try {
      await cache.write(CachedExperience.capture(outcome.rawJson, cachedAt: DateTime.now()));
    } catch (_) {
      // Best-effort: this boot still renders the fresh experience either way.
      return decision;
    }
  }

  return decision;
}

/// Maps every way [CommerceClient.getExperienceSchemaJson] can fail to
/// either [ExperienceFetchNotPublished] (the endpoint's documented,
/// definitive "nothing published for this tenant" 404 —
/// `CommerceExperienceController::show`'s only 404 case) or
/// [ExperienceFetchFailed]'s stable, non-sensitive `reason` code — never a
/// raw exception message or URL (its own doc comment's requirement). This is
/// the one place that draws that line: everywhere else in the runtime, a
/// 404 on this specific, single-purpose endpoint means exactly one thing.
Future<ExperienceFetchOutcome> _fetch(CommerceClient client) async {
  try {
    final rawJson = await client.getExperienceSchemaJson();
    return ExperienceFetchSucceeded(rawJson);
  } on CommerceApiException catch (e) {
    if (e.statusCode == 404) {
      return const ExperienceFetchNotPublished();
    }
    return ExperienceFetchFailed(e.code.name);
  } on CommerceProtocolException {
    return const ExperienceFetchFailed('protocol_error');
  } on CommerceTransportException {
    return const ExperienceFetchFailed('transport_error');
  } catch (_) {
    // Anything else (a raw `FormatException` from malformed response JSON,
    // `MissingCustomerSessionException` — unreachable in practice since this
    // call sends no customer token policy — or any other surprise) still
    // must never escape uncaught: MR-14's whole point is that a boot always
    // reaches a decision, never an unhandled exception.
    return const ExperienceFetchFailed('unknown_error');
  }
}
