# AWJ Checkout V1 Architecture

**Status:** Proposed for Safwan approval  
**Scope:** Architecture contract only — no implementation, merge, deployment, payment-provider integration, accounting posting, inventory movement, or ZATCA side effects.

## 1. Purpose

Define the smallest safe AWJ-native checkout boundary that follows the approved Commerce architecture and the existing anonymous Cart V1 backend.

The lifecycle is intentionally separated:

`CommerceCart -> CommerceCheckout -> CommerceOrder -> Payment -> Invoice`

The existing architectural invariant remains binding:

`CommerceOrder != Invoice`

Checkout and Commerce Order are commercial orchestration identities. They must not become accounting, inventory, payment-provider, or ZATCA authorities.

## 2. Non-negotiable boundaries

Commerce code MUST NOT write directly to journal entries/lines, stock movements/valuation/COGS, ZATCA invoice artifacts, or financial settlement outside the approved payment authority.

Existing AWJ authorities remain authoritative for their domains, including LedgerService, InventoryService, ZatcaService, PaymentService, and InvoiceService where applicable.

Checkout V1 does not post an invoice, create accounting entries, record inventory movements, settle payment, or create ZATCA artifacts.

## 3. Context authority and tenant isolation

Every Checkout is bound server-side to the same resolved storefront context as its Cart:

- `tenant_id`
- `storefront_id`
- `sales_channel_id`
- `cart_id`

The browser MUST NOT be allowed to choose or override tenant, storefront, sales channel, price authority, warehouse authority, or trusted host context.

All lookups and mutations fail closed on tenant/storefront/channel mismatch. Existing trusted Storefront Gateway and forwarded-host rules used by Cart V1 are reused for checkout mutations.

## 4. CommerceCheckout

`CommerceCheckout` is a mutable, temporary purchase-completion session. It is not an order and is not a financial document.

Minimum identity/state:

- UUID primary key
- tenant/storefront/sales-channel/cart ownership
- status
- expiry
- timestamps

Minimum customer/contact snapshot:

- customer name
- phone
- optional email

Minimum delivery snapshot when delivery is required:

- country
- region/state/province as applicable
- city
- district as applicable
- street/address lines
- postal code as applicable
- delivery notes as applicable

Checkout V1 supports guest checkout. A `partner_id` is not required and Cart remains anonymous. Future customer-account adoption must not rewrite historical order snapshots.

Initial states:

`active -> ready -> completed | expired`

Do not add a larger state machine until a real requirement exists.

## 5. Delivery and shipping boundary

Checkout may store the selected delivery method and server-authoritative delivery amount.

The client MUST NOT be pricing authority for shipping and MUST NOT submit a trusted `shipping_amount` or final total.

A full shipping/rate engine is outside Checkout V1. If no shipping subsystem is available at implementation time, use only explicitly configured server-side storefront delivery choices and leave advanced carriers/rates for the Shipping workstream.

## 6. Revalidation rule

Cart contents are never trusted as final purchase truth merely because they were previously valid.

Before completion, the server revalidates every line against current authoritative state, including at minimum:

- tenant/storefront/sales-channel context
- product existence and active eligibility
- CommerceListing publication for the resolved channel
- canonical UOM identity and continued validity
- current CommercePriceResolver result
- positive integer quantity
- required stock availability for final purchase

No client-supplied price, subtotal, shipping total, tax total, discount total, or grand total is authoritative.

If a price changes or a line becomes unavailable/invalid, completion MUST NOT silently create an order. Return a structured conflict/review-required response with authoritative current cart/checkout state so the customer can review the change.

## 7. Pricing

CommercePriceResolver remains the commercial pricing authority.

The approved precedence remains unchanged:

1. Known Partner applicable/default PriceList when a future authenticated customer context exists.
2. Active SalesChannel default PriceList.
3. Product.sale_price for base UOM.
4. Alternative UOM requires explicit applicable PriceList pricing; never derive selling price from conversion factor.

Checkout V1 does not introduce a second pricing engine.

All monetary calculations use the repository's integer minor-unit conventions. No floating-point financial arithmetic.

## 8. Inventory

Checkout V1 performs a final stock-availability validation before creating CommerceOrder.

Checkout V1 does **not** create inventory reservations or stock movements.

The existing architectural invariant remains binding:

`Reservation != StockMovement`

If reservations are later required, implement them as a separate Commerce capability with explicit expiry/release semantics and independent tests. Do not simulate reservation by writing stock movements.

## 9. Completion and idempotency

Checkout completion is a critical exactly-once business operation.

Proposed endpoint:

`POST /store/v1/checkout/complete`

An `Idempotency-Key` is mandatory for completion.

The implementation must combine application-level idempotency with database-enforced uniqueness so retries, mobile network interruption, double taps, or concurrent requests cannot create two Commerce Orders from one Checkout.

Conceptual critical section:

`transaction -> lock checkout/cart -> verify context -> revalidate lines/prices/stock -> recompute totals -> enforce idempotency -> create exactly one CommerceOrder -> mark checkout completed -> commit`

Do not rely on frontend button disabling for correctness.

A completed Checkout is immutable for purchase-affecting fields. Repeating completion with the same accepted idempotency identity returns the same resulting order representation rather than creating another order.

## 10. CommerceOrder

`CommerceOrder` is the durable commercial order produced from a successfully completed Checkout. It remains distinct from Invoice.

It stores durable snapshots sufficient to preserve what the customer actually ordered even if products, names, UOM configuration, addresses, publication state, or current prices later change.

Minimum order header snapshot/identity should cover:

- tenant/storefront/sales-channel identity
- source checkout identity
- order number/reference generated server-side
- customer/contact snapshot
- delivery/address snapshot
- delivery method snapshot
- authoritative monetary totals
- currency
- status
- timestamps

Minimum line snapshot should cover:

- nullable current product reference where safe
- product name snapshot
- canonical UOM key and display snapshot
- quantity
- authoritative unit price
- authoritative line total
- any additional tax/discount fields required by the existing AWJ sales-document contract when implementation evidence confirms them

Initial V1 order states:

`pending_payment -> confirmed -> cancelled`

Do not prematurely model fulfillment/shipment/return state machines in CHECKOUT-1.

## 11. Invoice boundary

Checkout completion does not equal invoice posting.

`CommerceOrder != Invoice` remains mandatory.

The later orchestration step that creates an AWJ sales invoice must use the existing InvoiceService contract and approved accounting/inventory/ZATCA authorities rather than writing those records directly from Commerce.

The exact trigger for Invoice creation/posting belongs to the Payment/Order orchestration architecture and must be defined before implementation of that transition. Checkout V1 must not guess it.

## 12. Payment boundary

Payment provider integration is outside Checkout V1.

Checkout/Order may expose the state needed for a later payment workflow, but CHECKOUT-1 does not:

- create provider payment intents
- capture/authorize/refund money
- create AWJ Payment records
- mark invoices paid
- store card data

The existing identity invariant remains binding:

`PaymentIntent != provider attempt/transaction != AWJ Payment`

## 13. Proposed Storefront API V1

Small initial contract:

- `POST /store/v1/checkout` — create/resume Checkout from the current AWJ Cart when eligible
- `GET /store/v1/checkout` — retrieve current Checkout
- `PATCH /store/v1/checkout/contact` — update contact snapshot
- `PATCH /store/v1/checkout/address` — update delivery address snapshot
- `PATCH /store/v1/checkout/delivery` — select a server-authorized delivery method
- `POST /store/v1/checkout/complete` — final revalidation and exactly-once CommerceOrder creation

API responses are AWJ-native compact representations. They never expose internal bearer secrets or allow the browser to become authority for tenant/context/pricing/totals.

Exact validation schemas and error codes are implementation details, but conflict/review-required conditions must be distinguishable from ordinary validation failures.

## 14. Cookie / browser transport

Reuse the Cart V1 browser-to-Next-server-action-to-Laravel trust boundary rather than introducing a parallel browser trust mechanism.

The HttpOnly cart token remains inaccessible to browser JavaScript. Checkout identifiers must not weaken that boundary.

If Checkout requires an additional bearer credential in implementation, its threat model and cookie contract require explicit review before adoption; do not add one by default.

## 15. Concurrency requirements

Implementation must test at least:

- two simultaneous complete requests for one Checkout create one CommerceOrder
- repeated same Idempotency-Key returns the same order
- a different key cannot create a second order for an already completed Checkout
- price/publication/UOM changes racing completion fail safely or serialize correctly
- insufficient stock at completion prevents order creation
- cross-tenant/storefront/channel access fails closed
- SQLite and PostgreSQL behavior is equivalent for all uniqueness/idempotency guarantees

## 16. Explicitly out of scope for CHECKOUT-1

- payment-provider integration
- AWJ Payment settlement
- Invoice creation/posting and ZATCA issuance
- inventory reservation subsystem
- fulfillment/shipping lifecycle
- returns/refunds/exchanges
- customer account creation/login/adoption
- loyalty, coupons, promotions, gift cards
- ProductVariant support unless the separately approved Variant workstream reaches Commerce first
- advanced shipping-rate/carrier integrations
- redesign of Cart V1
- changes to accounting rules or posting behavior

## 17. Implementation sequencing

After approval of this architecture, keep implementation reviewable and small:

1. **COM-CHECKOUT-1A — Checkout foundation**: schema/models/context ownership, guest contact/address/delivery contract, API foundation, gateway/tenant tests.
2. **COM-CHECKOUT-1B — Revalidation + completion**: authoritative price/UOM/publication/stock checks, idempotency, locking, CommerceOrder snapshot creation, concurrency tests.
3. **COM-CHECKOUT-1C — Storefront wiring**: AWJ DTC checkout screens/server actions using only the approved API; Wholesale/Spree path remains untouched unless separately scoped.
4. **PAYMENT architecture/implementation**: provider intent/attempt/AWJ Payment separation and the approved Order-to-Invoice trigger.

Do not merge Checkout and Payments into one implementation PR.

## 18. Acceptance gate before implementation

Safwan approval is required for this architecture before CHECKOUT-1A begins.

Implementation must preserve:

- Tenant Isolation
- Backward Compatibility
- integer-safe financial calculations
- CommerceBoundary invariants
- Cart V1 behavior
- SalesChannel pricing authority
- existing accounting/inventory/ZATCA service ownership
- SQLite/PostgreSQL equivalence

No merge, deploy, or production release is authorized by this document.