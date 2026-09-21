# ADR-07 — Commerce Guest → Authenticated Customer Cart Merge Policy

**Status:** Accepted — Owner Decision
**Date:** 2026-09-21
**Scope:** resolves `COM-MOBILE-CART-IDENTITY-1`'s Decision Escalation Gate (`COMMERCE_MOBILE_API_READINESS.md` §12, "Blocked") — does not reopen ADR-05/ADR-06, does not introduce promotions/discounts, does not change checkout completion's revalidation authority.

## Context

`COM-MOBILE-AUTH-1` (done) gave `/commerce/v1` a working customer identity, token (`X-Customer-Token`), and `CustomerContext`, but deliberately did not touch cart/checkout — `CommerceCartService`'s cart remains purely anonymous (`token_hash` only, no `customer_identity_id` column anywhere). `COMMERCE_MOBILE_API_READINESS.md` §12 explicitly named this a required decision, not an evidence gap: "Backend must own the merge decision."

The Decision Escalation packet (delivered to Safwan, compared Claim vs. Merge against AWJ's own repository evidence — notably that `CommerceCartService::serialize()` never freezes price, so "stale cart price" is structurally not a problem AWJ's cart has, and that `add()` already defines the exact quantity-sum-on-duplicate-line behavior needed for a merge) recommended Merge. The owner decision below adopts that recommendation with explicit required behavior.

## Decision

### AWJ Decision (owner-authorized)

1. **Merge**, not claim-replace, is the policy: on successful customer authentication (or on presenting a valid `X-Customer-Token` alongside a guest `X-Cart-Token`), if the customer has no active cart, the guest cart is claimed outright (renamed ownership, cheapest path); if the customer already has an active cart, the guest cart's lines are folded into it using `CommerceCartService::add()`'s existing, unmodified semantics — same `(product_id, product_variant_id, unit_key)` sums quantities via `safeQuantityAdd()`; a different variant or unit is always a separate line.
2. The source guest cart becomes terminal after a successful merge (moves to `CommerceCart::STATUS_CONSUMED`, the same terminal state already used after a successful order — "one cart supports at most one successful outcome") and can never be merged again. Repeated authentication/merge attempts using the same guest token are idempotent — no duplicate quantity accumulation from replay.
3. Logout never exposes the authenticated customer's cart to a subsequent unauthenticated bearer. A guest session after logout resolves to a fresh, empty guest cart identity, never the customer's.
4. No price freezing, no price copying, no new pricing/availability logic. `CommercePriceResolver`/checkout completion's existing `revalidateAndPrice()` remain the sole pricing/availability authorities, unchanged, for merged and unmerged carts alike.
5. No promotion/discount logic is introduced (none exists in AWJ today).
6. Multi-device: a second device authenticating with its own guest cart must never silently discard the customer's existing active cart's contents — merge (per #1), not replace, is exactly what protects this.
7. Tenant, sales-channel, storefront/mobile-channel, and `CustomerIdentity` isolation remain fully server-enforced through the existing `CommerceCartService::scopeToContext()`/`CustomerContext` authorities — a merge/claim implementation must go through these, never a raw query that bypasses them.
8. Guest checkout remains fully backward compatible — nothing about guest-only flows on `/commerce/v1` or `/store/v1` changes.
9. Any schema change is narrowly scoped to cart ownership (a nullable `customer_identity_id` column on `commerce_carts`, mirroring the existing pattern already used on `CommerceOrder`) — no redefinition of pricing, checkout, inventory, or order semantics.

### Concurrency/idempotency requirement (owner-specified, #9 of the decision)

The merge/claim operation must prevent, under concurrent/replayed requests:
- **double merge** (the same guest cart merged into the customer's cart twice);
- **duplicate quantity accumulation from replay** (a retried request re-adding the same lines);
- **cross-customer cart claiming** (a guest cart ending up claimed by a customer identity other than the one whose token was presented);
- **cross-tenant/channel cart access** (a merge reaching across the existing `scopeToContext()` boundary).

This is achieved by requiring the merge/claim transaction to `lockForUpdate()` both the guest cart and the customer's target cart (if one exists) inside a single database transaction, transition the guest cart's status atomically as part of that same transaction (so a concurrent second attempt finds it already non-`active` and does nothing), and re-verify tenant/channel/customer-tenant match inside the lock — the same pattern `CommerceCartService::add()`/`lockUsableCart()` and `CustomerOtpService`/`CustomerPhoneAuthenticationService` (`COM-MOBILE-AUTH-1`) already establish.

## Consequences

### Benefits
No parallel pricing/availability/quantity logic — the entire merge reuses `CommerceCartService::add()` verbatim for the line-folding case, and the codebase's existing terminal-state (`consumed`) and revalidation (`revalidateAndPrice()`) authorities for everything else.

### Costs/trade-offs
One new nullable column on `commerce_carts`; one new orchestration method; the guest cart's `STATUS_CONSUMED` semantics now have two distinct triggers (ordered-away or merged-away) — call sites that assume "consumed implies an order exists" (if any) must be checked and are expected to already tolerate this, since `findByToken(..., allowConsumed: true)` already treats `consumed` as a legitimate terminal state without assuming an order.

## References
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §12
- `docs/plans/commerce/COM-MOBILE-CART-IDENTITY-1-IMPLEMENTATION-REPORT.md` (full evidence, once implemented)
