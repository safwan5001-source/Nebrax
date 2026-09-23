import '../schema/schema.dart';

/// A defensive cap mirroring `deep_link_resolver.dart`'s own
/// `_kMaxProductIdLength` — guards against a pathologically long value in an
/// attacker- or bug-controlled payload, not a real format constraint.
const int _kMaxProductIdLength = 200;

/// Resolves a push notification's `data` payload into the exact same
/// allowlisted [ActionRef] shape `resolveDeepLinkUri` produces for a deep
/// link, and for the same reason (MR-08's rule, reused here for MR-09):
/// every schema-driven tap already dispatches through this shape via
/// `AppActionDispatcher.dispatch`, so a notification tap is never a
/// parallel navigation mechanism and can never smuggle a destructive
/// action — there is no branch here that can construct an
/// `addToCart`/`updateCartQuantity`/`removeCartItem` `ActionRef`, whatever
/// a push payload's `data` map contains.
///
/// Fail-safe like [resolveDeepLinkUri]: a payload with no recognized
/// `type`, a malformed value, or anything this function doesn't explicitly
/// allow returns `null` — "do nothing" at the call site, never a crash and
/// never a guess.
///
/// Only `data` fields are ever read here — never a notification's display
/// `title`/`body` text, and never any token/session-shaped field. A push
/// payload is exactly as untrusted as a deep link's query string (MR-07):
/// nothing from it is ever treated as session/business authority, only as
/// a hint about *where* to navigate.
ActionRef? resolvePushPayload(Map<String, String> data) {
  switch (data['type']) {
    case 'navigate':
      final pageId = data['pageId'];
      if (pageId == null || pageId.isEmpty) return null;
      return ActionRef(type: 'navigate', params: {'pageId': pageId});

    case 'openProduct':
      final productId = data['productId'];
      if (productId == null ||
          productId.isEmpty ||
          productId.length > _kMaxProductIdLength) {
        return null;
      }
      return ActionRef(type: 'openProduct', params: {'productId': productId});

    default:
      return null;
  }
}
