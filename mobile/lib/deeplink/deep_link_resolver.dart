import '../schema/schema.dart';

/// The one host this runtime's Universal Links (iOS) / App Links (Android)
/// are configured for — see `ios/Runner/Runner.entitlements`'
/// `applinks:` entry and `android/app/src/main/AndroidManifest.xml`'s
/// `<data android:host="…">`. This is a placeholder under the IANA-reserved
/// `.example` TLD (RFC 2606), the same convention MOBILE-RUNTIME-1 used for
/// the placeholder Bundle/Application ID — no canonical AWJ mobile deep-link
/// domain is documented anywhere yet, and hosting the real
/// `.well-known/apple-app-site-association`/`assetlinks.json` files a real
/// domain needs is outside this repository. Recorded as an explicit open
/// Decision Gate in this task's implementation report, exactly like the
/// Bundle ID before it.
const String kDeepLinkHost = 'awj-runtime-proof.example';

/// A defensive cap on an accepted `productId` segment's length — the
/// Commerce API's own IDs are short opaque strings (see
/// `docs/openapi/commerce-api-v1.yaml`); this only guards against a
/// pathologically long path segment, not a real format constraint.
const int _kMaxProductIdLength = 200;

/// Resolves a raw incoming Universal Link / App Link URL string into the
/// exact same allowlisted [ActionRef] shape every schema-driven tap already
/// dispatches through `AppActionDispatcher.dispatch` — never a parallel
/// navigation mechanism, and never anything a schema-declared component
/// couldn't already produce. This directly satisfies MR-08's "map only to
/// allowlisted navigation" and "a deep link must never directly execute
/// destructive/sensitive actions": this function's return type can *only*
/// ever be a `navigate`/`openProduct` action — there is no code path here
/// that can construct an `addToCart`/`updateCartQuantity`/`removeCartItem`
/// `ActionRef`, so a malicious or malformed link cannot smuggle a
/// destructive action no matter what it contains.
///
/// Fail-safe like [decodeAction]: malformed/unparseable input, an
/// unrecognized host, scheme, or path never throws — it returns `null`,
/// meaning "do nothing" at the call site (never a crash, never a stale/
/// wrong navigation).
///
/// Query parameters are never read for anything (MR-07: "no tokens in
/// deep-link query strings") — a link's query string, if present at all
/// (e.g. marketing/attribution parameters appended by a share sheet), is
/// silently ignored rather than either rejecting the whole link or feeding
/// it into any resolved value.
ActionRef? resolveDeepLinkString(String raw) {
  final uri = Uri.tryParse(raw);
  if (uri == null) return null;
  return resolveDeepLinkUri(uri);
}

/// The [Uri]-typed counterpart of [resolveDeepLinkString], for callers that
/// already have a parsed [Uri] (tests, primarily).
ActionRef? resolveDeepLinkUri(Uri uri) {
  if (uri.scheme.toLowerCase() != 'https') return null;
  if (uri.host.toLowerCase() != kDeepLinkHost) return null;

  // A trailing slash (e.g. "/product/123/") adds a trailing empty segment
  // in `Uri.pathSegments` — dropped here so it doesn't change which route a
  // link resolves to, the same leniency an ordinary web router would apply.
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.isEmpty || (segments.length == 1 && segments.first == 'home')) {
    return const ActionRef(type: 'navigate', params: {'pageId': 'home'});
  }
  if (segments.length == 1 && segments.first == 'cart') {
    return const ActionRef(type: 'navigate', params: {'pageId': 'cart'});
  }
  if (segments.length == 2 && segments.first == 'product') {
    final productId = segments[1];
    if (productId.isEmpty || productId.length > _kMaxProductIdLength) {
      return null;
    }
    return ActionRef(type: 'openProduct', params: {'productId': productId});
  }
  return null;
}
