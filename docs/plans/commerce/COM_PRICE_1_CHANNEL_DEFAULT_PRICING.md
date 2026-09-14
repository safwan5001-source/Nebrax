# COM-PRICE-1 — Channel Default Pricing Authority

**Status:** Approved — Safwan  
**Scope:** Commerce pricing authority required before COM-CART-2  
**Repository baseline:** `f0848b131cf60f560433218e5ec033540b8c800c`

## 1. Purpose

COM-CART-2 exposed one material gap in the current commerce pricing boundary: an anonymous storefront visitor has no Partner and therefore no Partner default PriceList. A valid alternative UOM can be identified and validated, but `CommercePriceResolver` intentionally refuses to derive an alternative-unit price from its conversion factor. This leaves anonymous alternative-UOM lines without an authoritative price.

This decision defines the smallest approved pricing authority needed to unblock AWJ Cart without inventing a second pricing engine or weakening existing financial rules.

## 2. Repository evidence

Current AWJ behavior establishes the following facts:

1. `PriceList` / `PriceListItem` already support explicit product + unit prices.
2. `CommercePriceResolver` coordinates existing pricing authorities; it does not persist a second price source.
3. For a known Partner, the current resolver can use the Partner's applicable default PriceList.
4. If an explicit PriceListItem exists for the requested product/unit, that explicit price is authoritative for the commerce proposal.
5. For the base unit only, absence of a list price may fall back to `Product.sale_price`.
6. For an alternative unit without an explicit list price, the resolver deliberately returns unresolved; AWJ must not derive a selling price from the UOM conversion factor.
7. There is currently no SalesChannel → PriceList pricing authority.

## 3. Approved decision

A `SalesChannel` MAY have one tenant-scoped **default PriceList** used as the anonymous/default commercial pricing authority for that channel.

Conceptually:

`SalesChannel.default_price_list_id -> PriceList.id`

The implementation must follow existing repository naming, UUID, tenancy, deletion and foreign-key conventions after verifying them against current `main`.

This relationship is a pricing selection authority only. It does not make SalesChannel a financial posting authority and does not change the historical financial truth stored on posted document lines.

## 4. Approved resolution precedence

For commerce price resolution, the approved precedence is:

1. **Known Partner with an applicable Partner PriceList** → use the existing Partner PriceList behavior.
2. **Otherwise, current SalesChannel has an active default PriceList** → use that PriceList.
3. **Otherwise, requested unit is the base unit** → fall back to `Product.sale_price` using existing behavior.
4. **Otherwise, requested unit is an alternative UOM without an explicit applicable PriceListItem** → unresolved / not orderable at that unit price context.

Partner-specific pricing therefore remains higher priority than the channel default.

The channel default is primarily the anonymous storefront/mobile pricing authority, but the resolver should express this as a general fallback after Partner pricing rather than hard-coding storefront-specific business logic.

## 5. Alternative UOM rule — mandatory

An alternative UOM MUST have an explicit applicable `PriceListItem` price to be commercially resolvable when no higher-priority explicit price exists.

AWJ MUST NOT calculate an alternative-UOM selling price by:

- multiplying `Product.sale_price` by the conversion factor;
- dividing a price by the conversion factor;
- copying the base-unit price to the alternative unit;
- inferring price from inventory quantity conversion;
- accepting a browser/client supplied price.

UOM conversion factors describe quantity conversion, not commercial pricing policy.

Example:

- base unit: piece, `Product.sale_price = 10.00`
- alternative unit: carton = 12 pieces

AWJ MUST NOT assume carton = 120.00. The merchant may explicitly price the carton at 110.00, 115.00, 120.00, or another permitted amount through the applicable PriceList.

## 6. Tenant Isolation and ownership

The SalesChannel default PriceList must belong to the same active Tenant as the SalesChannel.

Implementation must fail closed for:

- cross-tenant PriceList assignment;
- deleted/nonexistent PriceList;
- inactive PriceList when resolving commerce price;
- cross-tenant SalesChannel resolution.

Do not bypass `TenantScope` to make assignment or resolution work.

If existing PriceList behavior has narrow branch-scope handling, reuse only the established safe convention; do not weaken tenant isolation.

## 7. Active/inactive PriceLists

Only an active PriceList may act as the channel default pricing source at resolution time.

If a configured default list later becomes inactive, the resolver treats the channel list as unavailable and continues through the approved precedence:

- base unit may fall back to `Product.sale_price`;
- alternative unit without another explicit applicable price remains unresolved.

Do not silently use an inactive list.

## 8. Missing explicit unit price

A channel PriceList does not imply that every product/UOM has a price.

If the channel list has no matching `PriceListItem`:

- base unit → existing `Product.sale_price` fallback remains allowed;
- alternative unit → unresolved.

Do not synthesize missing PriceListItems.

## 9. Money and accounting boundary

This decision does NOT change AWJ accounting truth.

`CommercePriceResolver` remains a commercial price proposal/resolution boundary. Financial truth remains governed by the existing invoice/order/posting paths when a financial document is actually created and posted.

COM-PRICE-1 must not change:

- invoice posting;
- journal entries;
- VAT/ZATCA calculations;
- minimum-price enforcement ownership;
- inventory valuation;
- purchase costing;
- historical document prices.

Preserve the existing integer-safe money representation. Do not introduce floating-point money calculations.

## 10. SalesChannel administration

COM-PRICE-1 backend implementation should provide the minimum repository-consistent mechanism to assign/clear a channel default PriceList if an existing SalesChannel management path already exists and can be extended safely.

Do not build a broad Commerce Workspace redesign as part of COM-PRICE-1.

If exposing this setting requires a larger UI/API architecture decision, backend persistence and service support may be implemented first and the UI deferred to a separate scoped task.

## 11. Backward compatibility

Existing behavior must remain unchanged when `SalesChannel.default_price_list_id` is null.

Specifically:

- existing Partner PriceList behavior remains first priority;
- existing base-unit `Product.sale_price` fallback remains intact;
- existing alternative-UOM no-derived-price rule remains intact;
- POS behavior must not be redirected to channel pricing unless it explicitly calls the commerce resolver under this approved precedence;
- existing invoices/orders/accounting/inventory behavior must not change accidentally.

## 12. COM-CART-2 integration contract

After COM-PRICE-1 is implemented, anonymous Cart pricing may call the existing `CommercePriceResolver` with:

- current tenant context;
- resolved SalesChannel;
- `partner_id = null`;
- resolved unit name.

For a valid alternative UOM, Cart may accept the line only when the resolver returns an authoritative resolved price under this decision.

A valid UOM identity alone does not guarantee orderability; it must also be price-resolvable.

Cart must never implement its own channel PriceList lookup or pricing precedence. The pricing decision belongs in `CommercePriceResolver` (and its existing collaborators), so Cart consumes one authoritative commerce pricing boundary.

## 13. Required implementation tests for COM-PRICE-1

At minimum verify:

1. anonymous base-unit request uses active channel PriceList explicit item when present;
2. anonymous alternative-UOM request uses explicit channel PriceListItem;
3. anonymous base unit falls back to `Product.sale_price` when channel list/item is absent;
4. anonymous alternative UOM remains unresolved when explicit unit price is absent;
5. no factor-derived alternative price;
6. Partner PriceList takes precedence over channel default PriceList;
7. inactive channel PriceList is not used;
8. cross-tenant PriceList cannot be assigned to SalesChannel;
9. cross-tenant channel/list resolution fails closed;
10. null channel default preserves existing behavior;
11. currency remains `Tenant.currency`;
12. existing POS/PriceList/Commerce resolver regression tests remain green.

Add negative tests for any assignment endpoint/service introduced by implementation.

## 14. Out of scope

COM-PRICE-1 does NOT implement:

- Cart persistence/API;
- Storefront Cart wiring;
- Checkout;
- Payments;
- promotions/coupons;
- tax redesign;
- shipping;
- inventory reservation/movement;
- accounting changes;
- customer authentication;
- broad PriceList redesign;
- multi-currency;
- derived UOM prices;
- broad SalesChannel UI redesign.

## 15. Implementation stop conditions

Implementation must stop and report evidence if current `main` proves that:

1. SalesChannel cannot safely reference PriceList without a broader schema/ownership decision;
2. PriceList tenancy or lifecycle semantics conflict with the same-tenant channel authority;
3. adding channel fallback would alter POS/accounting behavior outside this scope;
4. alternative UOM identity/pricing differs materially from the evidence used for this decision;
5. implementation requires derived prices or a second pricing engine;
6. Tenant Isolation cannot be proven with negative tests.

Do not improvise around a stop condition.

## 16. Definition of Done

COM-PRICE-1 is complete only when:

- SalesChannel can safely reference an optional same-tenant default PriceList;
- anonymous commerce pricing resolves explicit channel prices;
- Partner PriceList remains higher priority;
- base-unit fallback remains backward compatible;
- alternative UOM without explicit price remains unresolved;
- no UOM-derived pricing is introduced;
- Tenant Isolation negative tests pass;
- existing relevant pricing/POS/Commerce tests pass;
- migration behavior is safe for supported databases;
- implementation report records exact tests, CI, branch, PR, Base SHA and Head SHA;
- no merge/deploy occurs without Safwan's explicit approval.

## 17. Roadmap position

`Product Publication ✅ → Cart Architecture ✅ → COM-PRICE-1 → COM-CART-2 → Storefront Cart Wiring → Checkout → Public/Mobile Commerce API V1 → Payments`

COM-CART-2 remains blocked until COM-PRICE-1 is implemented and verified.