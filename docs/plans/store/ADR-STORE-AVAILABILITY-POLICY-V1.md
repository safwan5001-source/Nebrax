# ADR — Store/Product Availability Policy V1
**Status:** Proposed — architecture review required, no implementation authorization
**Date:** 2026-10-15
**Depends on:** ADR-02 Inventory Reservation & Available-to-Sell; existing FulfillmentPolicyService/AvailableToSellService/StorefrontProductController.

## Existing code evidence (main reviewed 2026-10-15)
- `FulfillmentPolicyService::resolveWarehouseFor(channelId)` resolves one fixed **tenant-owned active warehouse** for a channel; no fallback.
- `AvailableToSellService::forWarehouse`: `max(0, ProductWarehouseStock.quantity - active reservations)` with product/variant/warehouse identity.
- `StorefrontProductController::batchAvailability` uses selected warehouse and active reservations; missing policy returns `in_stock: null`, not false.
- `StorefrontProductResource` exposes `in_stock`, pricing and public media, not raw stock.
- `storefront/src/lib/commerce/mappers.ts` maps `in_stock === false` to unpurchasable, while `null` currently maps to optimistic presentation. That legacy behavior must be inspected at ALL order-side enforcement points before making changes.
- `CommerceFulfillmentController` currently provides merchant read/update of selected fulfillment warehouse.
- ADR-02 states tracked items reject oversell by default and non-inventory goods do not reserve, using authoritative Product/Inventory classification — not channel presentation metadata.

## Decision direction
Introduce a **commerce availability presentation/ordering policy**, distinct from physical inventory truth and from delivery capability. Product overrides are scoped by store/channel to prevent one store's selection from globally changing another store's SKU; no new schema is prescribed now.

Suggested conceptual resolver:
`resolveAvailability(tenant, storefront, salesChannel, product, variant, requestedQty, destination, time)` returns policy source + effective mode + product eligibility + orderability reason; it does not mutate stock. **Any stock reservation/commit remains in the transactional inventory authority.** Catalog may show coarse availability, but checkout must re-evaluate quantity and authorization.

Precedence proposal:
- Store Auto => existing logic exactly (default, backward compatibility). Product overrides are dormant while Auto is selected; UI must explain this.
- Store Custom => valid store/channel product override if present, else store default policy.
- Non-stock and made-to-order eligibility are verified using authoritative Product/Inventory semantics; disallowed combinations fail closed with a merchant-facing reason.

## Invariants
1. Existing Auto must match historical API behavior including null, variants and storefront scopes.
2. Non-stock sale cannot create `ProductWarehouseStock`, an inventory reservation, stock issue, GL/COGS or tax artifact by policy selection alone. Actual sales accounting follows existing approved source flows.
3. Tracked sale cannot bypass stock validation by selecting «متوفر دائمًا». No false physical On Hand, negative inventory or invented reservations.
4. Made-to-order is **NOT** synonymous with backorder: its order lifecycle and real physical fulfillment must have explicit design and authorization before activation.
5. Checkout/complete, cart add/update/revalidate, order creation/payment retries and cancellation share server-authoritative checks; guard race, idempotency, and partial failure.
6. Respect TenantScope and trusted StorefrontContext; merchant read/write gated by `commerce.manage`; store/product/variant/channel never accepted across tenants.
7. No new tenant-wide stock source, no leaking stock numbers in public payload. Policy enums/JSON/API evolution must preserve older clients and unknown-value safe handling.
8. Delivery windows/capacity, region, same-day claims, product publication, prices and payment gates remain separate.
9. Audit changes including actor, store, product, old/new policy and time; reversible behavior without losing recorded orders.

## Risks / unresolved blockers
- Current cart/checkout architecture may assume every physical product acquires inventory reservation: trace all paths and establish non-stock eligibility and MTO fulfillment accounting before choosing schema or activating Always/MTO.
- Existing product `is_variant_managed` needs exact per-variant eligibility and price/stock behavior. Never aggregate a variant's orderability incorrectly.
- If an existing product becomes MTO after existing carts/orders, snapshots and replay must remain stable; no retroactive reprice or altered fiscal document.
- Fulfillment warehouse cannot be silently optional for stock-tracked products; treating missing warehouse as Always would violate ADR-02.
- Decide how scheduled delivery slots interact with lead time; prohibit false «يوصل اليوم» for made-to-order.

## Approval gates
Gate A (this PR): docs only, review and resolve explicit open decisions.
Gate B: read-only architecture/contract inventory of cart, checkout, order, inventory, accounting and product classification.
Gate C: approved small scoped implementation PRs with tests.
Gate D: manual merge authorization, then separate deploy authorization and production verification.
