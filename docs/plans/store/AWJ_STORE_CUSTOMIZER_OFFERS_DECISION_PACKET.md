# Decision Packet — Offers section

**Status:** Resolved — owner selected Option 1 on 2026-09-26. No implementation is authorized by this decision.  
**Horizon:** Store Customizer Capability Completion  
**Date:** 2026-09-26

## Problem

The merchant customizer lists an Offers section. The Build, Don’t Hide decision says to complete it when it can point at authoritative AWJ offer data, and to stop rather than invent prices.

## Repository evidence

- `ApplicationCatalog`: `sales.promotions` maturity is `coming_soon`.
- `ADR-11` (accepted): promotions/coupons are deferred. A future engine must be shared Commerce-Core, and financial review is a prerequisite. Whether promotions are ever in scope is still an open decision in that ADR.
- `DataResourceRegistry`: `commerce.promotions` does not exist.
- The presentation normalizer has no discount, compare-at, or percent field. This horizon strips any smuggled `content` on `offers`.

## Owner decision

**Selected: Option 1 — leave Offers gated and unpublished until AWJ has an authoritative shared Promotions Engine.**

This decision closes the Store Customizer decision gate. It does not approve building promotions, coupons, pricing overrides, or discount semantics inside the customizer.

Current product behavior remains intentional:

- Offers stays visible in the merchant customizer as an intended future capability.
- The merchant preview explains that the section is waiting on the promotions engine.
- The published storefront skips Offers.
- Offers carries no merchant-authored percentage, compare-at price, discount amount, tax override, or other monetary truth.
- Existing offers instances remain backward compatible as `{id,type,visible}`.

A future implementation requires a separate, explicitly authorized **AWJ Promotions & Discounts Engine** horizon (or equivalent), with financial/accounting review and a shared Commerce-Core source of truth before the Store Customizer can consume it.

## Options

1. **Leave offers gated and unpublished** (**selected by owner 2026-09-26**). The section stays visible with copy that says it waits on the promotions engine. No prices are shown.
2. **Author free-text “offer” banners inside Offers.** That is a second banner, and it invites merchants to type percentages the cart will not honor.
3. **Build a promotions engine in this horizon.** Rejected here. It changes amount-due semantics and contradicts ADR-11.

## Trade-offs

Option 1 does not give merchants a live offers band. It also does not create a shadow price list. Option 2 would look finished and be false. Option 3 is a financial project, not a customizer slice.

## Impact

- Backward compatibility: offers instances still save as `{id,type,visible}`.
- Tenant / security: unchanged.
- Data / migration: none.
- Preview / public: preview explains the gate; the public homepage skips the section.

## Decision closure

`STORE-CAP-OFFERS-1` is no longer an open product decision inside the completed Store Customizer horizon. Its status is **owner-deferred behind the future Promotions Engine**.

No runtime code, database migration, API, pricing rule, accounting rule, or deployment is authorized by this decision record.

The Store Customizer capability-completion and visual-verification work remain closed.

## Independent work that continues

Banner, benefits, custom content, app promo, featured product references, and the chrome nesting cleanup do not depend on this packet.
