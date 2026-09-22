# ADR-11 — Commerce Promotions/Coupons Deferral

**Status:** Accepted — Owner Decision
**Date:** 2026-09-22
**Scope:** records that a coupon/promotions engine is explicitly out of scope for the current Commerce Mobile V1 readiness horizon — a deliberate deferral, not a missing or accidentally incomplete capability.

## Context

Repository evidence (Decision/Evidence Packet, delivered 2026-09-22) confirmed **zero implementation of any kind**: no `Coupon`/`Discount`/`Promo` model, migration, service, or route exists anywhere in the codebase. `PriceList`/`PriceListItem` implement customer/tier pricing, a different concept, not promotional codes. This is a genuine product/scope question with no existing partial implementation to build on or reconcile.

## AWJ Decision (owner-authorized)

1. **Promotions/coupons are explicitly deferred**, not implemented, for the current Commerce Mobile V1 readiness horizon.
2. This deferral is recorded durably (this ADR + `TASK-QUEUE.md`) specifically so it is never mistaken for an oversight in a future readiness audit.
3. **When eventually built, the promotion system must be Commerce-Core/shared** — a discount/coupon engine applies uniformly across POS, web storefront, and mobile; it must not be designed or implemented as a mobile-only feature.
4. **Financial/order-total review is a prerequisite before implementation begins**, not an afterthought — a discount changes the "amount due" that `ADR-04` §3 already requires must never silently diverge from the payment obligation. Any future promotions work should be sequenced after the Payment Intent model (`ADR-09`) has landed, to avoid designing a total-adjustment mechanism twice.

## Open Decisions (still not made — explicitly out of scope here)

- Whether any coupon/promotion capability is ever in scope at all.
- If yes: shape (simple percentage/fixed-amount code vs. a fuller rules engine with stacking/campaigns).

## Consequences

### Benefits
Prevents scope creep into the current horizon; leaves a clean, explicit record for future planning instead of silence.

### Costs / trade-offs
None — no work was in flight to unwind; this simply confirms the existing backlog classification with an owner-authorized rationale attached.

## References
- `docs/plans/store/AWJ_COMMERCE_FEATURE_MATRIX.md`
- `docs/plans/store/ADR-09-COMMERCE-PAYMENT-INTENT-V1-SCOPE.md` (sequencing dependency, once promotions are eventually authorized)
