import '../schema/schema.dart';
import 'preview_client.dart';
import 'preview_startup.dart';

/// The real fetch+decide wiring around [resolvePreviewStartup] — the *only*
/// place in the runtime that calls [PreviewClient.fetchExperience], mirroring
/// `startup/experience_fetcher.dart`'s `resolveRealStartup` shape. No cache
/// is read or written here at all (§5.15's "no client-side caching of a
/// previously-successful fetch that could mask staleness" — Preview must
/// never look "still working" from a stale local copy once its session has
/// expired or been revoked).
Future<PreviewStartupDecision> resolveRealPreviewStartup({
  required PreviewClient client,
  required CapabilityManifest manifest,
}) async {
  final outcome = await client.fetchExperience();
  return resolvePreviewStartup(fetch: outcome, manifest: manifest);
}
