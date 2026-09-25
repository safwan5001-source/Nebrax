# Decision Packet — Offers section

**Status:** Open. Blocks STORE-CAP-OFFERS-1 only.  
**Horizon:** Store Customizer Capability Completion  
**Date:** 2026-09-26

## Problem

The merchant customizer lists an Offers section. The Build, Don’t Hide decision says to complete it when it can point at authoritative AWJ offer data, and to stop rather than invent prices.

## Repository evidence

- `ApplicationCatalog`: `sales.promotions` maturity is `coming_soon`.
- `ADR-11` (accepted): promotions/coupons are deferred. A future engine must be shared Commerce-Core, and financial review is a prerequisite. Whether promotions are ever in scope is still an open decision in that ADR.
- `DataResourceRegistry`: `commerce.promotions` does not exist.
- The presentation normalizer has no discount, compare-at, or percent field. This horizon strips any smuggled `content` on `offers`.

## Options

1. **Leave offers gated and unpublished** (recommended). The section stays visible with copy that says it waits on the promotions engine. No prices are shown.
2. **Author free-text “offer” banners inside Offers.** That is a second banner, and it invites merchants to type percentages the cart will not honor.
3. **Build a promotions engine in this horizon.** Rejected here. It changes amount-due semantics and contradicts ADR-11.

## Trade-offs

Option 1 does not give merchants a live offers band. It also does not create a shadow price list. Option 2 would look finished and be false. Option 3 is a financial project, not a customizer slice.

## Impact

- Backward compatibility: offers instances still save as `{id,type,visible}`.
- Tenant / security: unchanged.
- Data / migration: none.
- Preview / public: preview explains the gate; the public homepage skips the section.

## Independent work that continues

Banner, benefits, custom content, app promo, featured product references, and the chrome nesting cleanup do not depend on this packet.
