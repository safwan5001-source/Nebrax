/// MOBILE-PREVIEW-7 — resolves an incoming Universal Link / App Link for
/// the **device preview entry point only** (`main_device_preview.dart`) —
/// structurally independent from `deeplink/deep_link_resolver.dart`'s own
/// production in-app-navigation allowlist (`home`/`cart`/`product/{id}`,
/// dispatched through `AppActionDispatcher`). This resolver never returns
/// an `ActionRef` — its only possible output is the raw, opaque, one-time
/// exchange reference itself (never a bearer, never any other value), or
/// `null` on anything malformed/unrecognized — the exact same fail-safe
/// contract [resolveDeepLinkUri] already uses, applied to a different
/// concept.
///
/// **A dedicated host, not the production one.** `main.dart` and
/// `main_device_preview.dart` are two independent, separately-built entry
/// points that never run in the same process — but sharing one Universal
/// Link / App Link host between them would require either platform's
/// association file to declare which of two *different* apps owns which
/// path (Apple's `apps` array, or Android's multi-package `assetlinks.json`)
/// — an unnecessary complication this repository does not need yet, since
/// neither host has a real, publicly hosted domain today (this task's
/// implementation report records the exact operational gate). A distinct
/// preview-only subdomain keeps the two allowlists — and the two apps that
/// will eventually claim them — structurally independent from day one,
/// rather than retrofitting that separation once a real domain exists.
const String kPreviewDeepLinkHost = 'preview.awj-runtime-proof.example';

/// A defensive cap on an accepted reference's length — the backend's own
/// opaque exchange references are short random ASCII strings
/// (`Str::random(40)`); this only guards against a pathologically long path
/// segment, not a real format constraint.
const int _kMaxReferenceLength = 128;

/// One-time exchange references are plain random ASCII (letters and
/// digits only, per `Str::random()` on the backend) — never a character an
/// attacker could use to smuggle a second path segment or query-like
/// content past this allowlist.
final RegExp _kReferencePattern = RegExp(r'^[A-Za-z0-9]+$');

/// Resolves a raw incoming link string to the opaque exchange reference it
/// carries, or `null` if the link is malformed, uses the wrong host/scheme,
/// or does not match the one allowlisted shape
/// (`https://{kPreviewDeepLinkHost}/preview/{reference}`). Never throws —
/// same fail-safe contract as [resolveDeepLinkString] in the production
/// resolver: an unrecognized link means "do nothing," never a crash.
String? resolvePreviewExchangeReferenceFromString(String raw) {
  final uri = Uri.tryParse(raw);
  if (uri == null) return null;
  return resolvePreviewExchangeReferenceFromUri(uri);
}

/// The [Uri]-typed counterpart of [resolvePreviewExchangeReferenceFromString],
/// for callers that already have a parsed [Uri] (tests, primarily).
String? resolvePreviewExchangeReferenceFromUri(Uri uri) {
  if (uri.scheme.toLowerCase() != 'https') return null;
  if (uri.host.toLowerCase() != kPreviewDeepLinkHost) return null;

  // Query parameters are never read for anything (MR-07: "no tokens in
  // deep-link query strings") — the reference travels in the path only,
  // and a query string, if present at all, is silently ignored rather than
  // rejecting the whole link.
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.length != 2 || segments.first != 'preview') return null;

  final reference = segments[1];
  if (reference.isEmpty || reference.length > _kMaxReferenceLength) return null;
  if (!_kReferencePattern.hasMatch(reference)) return null;

  return reference;
}
