# ADR-24 — Gifting in the account order view; saved recipients, re-order and wishlist (FLOWERS-ACCOUNT-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H13
**Date:** 2026-10-04
**Scope:** storefront account order detail and order confirmation (`storefront/`) — renders contracts that already exist; no backend change, no new persistence

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- `store/v1` (the storefront API) is anonymous: a cart cookie, no shopper identity. The only customer identity in the platform is `commerce/v1`'s `X-Customer-Token` group, which the storefront does not use. Consequently the storefront's own account capabilities are declared `design_only` in `lib/commerce/capabilities.ts` (`ACCOUNT_ORDER_LOOKUP_CAPABILITY`, `WISHLIST_CAPABILITY`, saved addresses): the screens are built, nothing is persisted, production activation is gated on a contract.
- `commerce/v1` already has a customer address book (`addresses`, each row carries `recipient_name`, `phone` and the full address) and an owned order history (`me/orders`, `me/orders/{id}`). `CommerceOrderSerializer` already returns `gift`, `schedule`, `personalization` and add-on lines (`line_id`, `addon_of`) on the order detail.
- The checkout confirmation and the account order detail (`AccountOrderDetail`) both render a `StorefrontOrder`; H12 already maps `gift`, `schedule` and the line fields onto it.
- The account order status (`AccountOrderStatus`) shows only what is true of a confirmed order and says the store does not publish shipment tracking.

## 2. Decision (AWJ DECISION)

1. **One component for the placed order's gifting snapshot.** `OrderGiftingDetails` renders the requested delivery date/window and the gift card from the order's stored snapshots. The confirmation screen and the account order detail both use it, so the same order never reads differently in two places. It renders nothing for an order with neither, so a non-gifting store's order is unchanged. Dates are plain calendar dates (the order carries no browser-resolvable timezone); no "today/tomorrow", no fulfilment promise.
2. **Account order detail** groups add-ons under their own bouquet (the API lists lines by creation time) and shows personalization answers, exactly like the cart and confirmation. It stays gated behind `ACCOUNT_ORDER_LOOKUP_CAPABILITY`; this slice makes it complete for when the contract lands, it does not activate it.
3. **Fulfilment timeline: unchanged.** No state is invented. The timeline remains the shared `AccountOrderStatus`.
4. **Saved recipients: DEFERRED (not built, not faked).** A separate recipient entity would (a) need shopper identity the storefront does not have and (b) duplicate the existing customer address book, whose rows already pair a recipient name and phone with a destination. The sound path, when identity is live, is to *reuse the address book* (an address used as a gift destination carries its recipient) rather than a parallel Flowers-only store; that needs its own ADR, migration slice and idempotency/RBAC tests. Persisting recipients in browser storage is rejected (it would look like an account promise).
5. **Re-order: DEFERRED.** A faithful re-order must re-price, re-check availability and re-validate the date window and personalization against today's catalog; only the server can do that. Copying lines client-side from an old order would assert stale prices and availability. Needs a server-authoritative endpoint.
6. **Wishlist: stays `design_only`** (`WISHLIST_CAPABILITY`). No Flowers-specific copy of it is created.

## 3. Rejected / Not adopted

- A Flowers-only "recipients" screen or table parallel to the address book.
- Browser-storage persistence for recipients or favourites.
- Client-side re-order from a past order's lines.
- A synthesised fulfilment timeline (preparing / out for delivery) with no backing state.

## 4. Consequences

- Capability states are unchanged; no new API, table, tenant data or journal entry. Backward compatible: orders without gift/schedule render exactly as before.
- Residual: saved recipients, re-order and an active order history remain gated on a storefront customer-identity contract (outside Horizon 1).
