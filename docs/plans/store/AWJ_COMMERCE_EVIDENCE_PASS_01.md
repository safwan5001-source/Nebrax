# AWJ Commerce — Evidence Pass 01

**Status:** Research evidence — read-only, not implementation approval  
**Date:** 2026-09-09  
**Purpose:** Preserve verified internal and external evidence before writing the AWJ Commerce Implementation Master Plan.

> Rule: this document distinguishes repository facts, external-source facts, approved ADR decisions, and inferences. An external platform behavior is not automatically an AWJ requirement. Anything not supported strongly enough remains open rather than being converted into implementation scope.

## 1. Evidence classes

- **AWJ VERIFIED:** confirmed from the current repository/audit.
- **EXTERNAL VERIFIED:** confirmed from current official vendor/platform documentation reviewed on 2026-09-09.
- **ADR APPROVED:** already decided in merged ADR-01 through ADR-05.
- **INFERENCE:** architectural implication supported by evidence but not yet an implementation decision.
- **OPEN:** requires more evidence/design before inclusion as implementation behavior.

## 2. AWJ repository baseline

### 2.1 Product core — AWJ VERIFIED

The Existing Architecture Audit confirms:

- `Product` is currently a flat product/SKU model.
- No product variant/options/attribute model was found in the audited code/migrations.
- UOM exists through `UnitTemplate`, `UnitTemplateUnit`, and the existing unit-conversion authority.
- `ProductCategory` exists.
- `ProductMedia` exists as a real media table.
- `PriceList` and `PriceListItem` exist.
- `Partner.default_price_list_id` exists, but the audit describes the current resolution behavior as incomplete/inconsistent across sales paths.
- Storefront-specific publication/SEO/marketing fields are not separated from Product today; the audit identifies a separate CommerceListing boundary as a candidate extension.

**Implication:** Product variants are a real AWJ gap, not a feature we can assume already exists. Commerce storefront metadata should not be added casually to accounting/inventory Product without a scoped design.

### 2.2 Inventory — AWJ VERIFIED

The audit confirms:

- no Reservation or Available-to-Sell concept exists in current AWJ;
- current sales/POS paths can oversell because there is no Commerce reservation/availability guard;
- physical sale inventory effects pass through approved inventory/accounting services;
- moving-average valuation is the current authority;
- UOM conversion already has an authority;
- stock movement/accounting writes are service-mediated rather than direct writes discovered in the audit.

This is the highest-priority foundational gap identified by the audit.

### 2.3 Payment / identity / channels — AWJ VERIFIED

The audit confirms:

- no PaymentIntent/Authorization/Capture provider orchestration exists;
- existing AWJ Payment is a financial settlement/payment document and must not be replaced by a second ledger;
- mature idempotency patterns already exist in Public API and POS checkout;
- mature outbound webhook infrastructure exists;
- no inbound payment-provider webhook receiver exists;
- no SalesChannel model exists;
- Partner is flat and there is no consumer/mobile identity or B2B Company → Location → Buyer hierarchy;
- staff/developer authorization exists and must not be treated as consumer authentication.

## 3. Inventory reservation / ATS external evidence

### 3.1 Salla — EXTERNAL VERIFIED

Current Salla Help Center inventory documentation (updated 2026-08-31) explicitly distinguishes inventory states including:

- Total quantity;
- Available for sale;
- Reserved for orders;
- Reserved for payment;
- Incoming;
- Outgoing;
- Not available for sale.

It describes **Reserved for payment** as temporary reservation when the customer reaches the payment page but does not complete payment, and **Reserved for orders** as stock allocated to paid orders still being processed/fulfilled.

Source reviewed:
- https://help.salla.sa/en/article/inventory-management-and-stocktaking-1/xzpw5e46wflnxg611caz0aem

**Correction to earlier uncertainty:** earlier research did not have sufficient evidence from Salla's order-reservation API to prove physical inventory reservation. The current official Salla inventory documentation *does* provide direct evidence that Salla has separate available-for-sale, order-reserved, and payment-reserved inventory states.

### 3.2 Shopify — EXTERNAL VERIFIED

Current Shopify inventory documentation separates merchandising ProductVariant from InventoryItem and location-scoped InventoryLevel. Inventory quantities/states are maintained at the inventory-item × location boundary rather than as only one global storefront number.

Sources reviewed:
- https://shopify.dev/docs/apps/build/orders-fulfillment/inventory-management-apps/manage-quantities-states
- https://shopify.dev/docs/api/admin-rest/latest/resources/inventorylevel

### 3.3 ADR implication — ADR APPROVED / INFERENCE

ADR-02 already requires one auditable Reservation truth and ATS derived from On Hand minus active reservations, with optional checkout/payment hold using the same reservation engine if adopted.

The Salla evidence strengthens, but does not redefine, that decision. AWJ must still design its own reservation states, locking and expiry behavior rather than copy Salla's internal model.

## 4. Warehouse / fulfillment routing external evidence

### 4.1 Salla — EXTERNAL VERIFIED

Current Salla retail-store documentation supports multiple routing strategies including:

- branch/warehouse with highest stock;
- closest branch/warehouse to customer;
- explicit branch/warehouse priority order;
- multi-branch shipment configuration.

It also exposes product availability across branches to customers.

Sources reviewed:
- https://help.salla.sa/en/article/customize-retail-stores-on-your-salla-store/d1bomk5h49peauthjzvpecap
- https://help.salla.sa/en/article/adding-and-managing-branches-and-warehouses/f0ik50tqs9hgdbf8xna21oqh

### 4.2 Shopify — EXTERNAL VERIFIED

Shopify InventoryLevel represents inventory for one inventory item at one location. Product variant inventory is therefore location-aware rather than a single aggregate authority for fulfillment decisions.

Source reviewed:
- https://shopify.dev/docs/api/admin-rest/latest/resources/inventorylevel

### 4.3 ADR implication — ADR APPROVED

ADR-03's typed direction remains appropriate:

- `FIXED_LOCATION` for V1 implementation direction;
- `PRIORITY_LOCATIONS` as later/foundation capability;
- full routing engine later;
- no automatic split fulfillment in V1.

External platforms prove these advanced strategies are real commerce requirements, but they do **not** justify pulling them into AWJ V1 prematurely.

## 5. Product variants / options

### 5.1 Odoo 19 — EXTERNAL VERIFIED

Odoo 19 models product variants from attributes and values. Individual variants can have their own barcode/SKU, price impact and inventory count. Pricelist rules can target a template or a variant.

Source reviewed:
- https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/products/variants.html

### 5.2 Shopify — EXTERNAL VERIFIED

Shopify maintains a 1:1 relationship between a ProductVariant and InventoryItem, while inventory levels attach the inventory item to locations. ProductVariant therefore carries customer-facing variant identity while InventoryItem/InventoryLevel carry physical stock concerns.

Sources reviewed:
- https://shopify.dev/docs/api/admin-graphql/latest/objects/inventoryitem
- https://shopify.dev/docs/api/admin-rest/latest/resources/inventorylevel

### 5.3 Zid — EXTERNAL VERIFIED

Current Zid Merchant API supports product attributes/choices and creation of variants for a product. Creating variants can convert a standalone product into a parent product.

Source reviewed:
- https://docs.zid.sa/add-product-variants

### 5.4 Salla — EXTERNAL VERIFIED

Current Salla Merchant API exposes Product Options and Product Variants separately. Variant details can carry their own price, sale price, stock quantity, barcode, SKU, option values and weight. Salla's current merchant help also documents option combinations creating variants and a current platform limit of 100 variants per product.

Sources reviewed:
- https://docs.salla.dev/product-variants/list
- https://docs.salla.dev/product-variants/details
- https://docs.salla.dev/product-options/details
- https://help.salla.sa/en/article/product-option-management-1/fz6e4g9ohl7rnv4g561vexl6

### 5.5 AWJ implication — INFERENCE / OPEN

Product variants are not merely presentation metadata: external evidence consistently shows that a sellable variant can own SKU/barcode/price/inventory identity.

Therefore a future AWJ variant design must be audited against Product, inventory valuation, UOM, price lists, invoices, purchases, returns, POS, barcode uniqueness, imports and reports before implementation.

**OPEN:** exact AWJ variant schema and whether existing Product becomes the sellable SKU, parent/template, or participates in a compatibility model. No implementation decision is made in this Evidence Pass.

## 6. Pricing / promotions

### 6.1 Odoo 19 — EXTERNAL VERIFIED

Odoo distinguishes structured pricelists from promotional/loyalty programs. Current documentation supports pricing based on factors such as customer, location, quantity, period and currency, plus separate promotional concepts such as discount codes, promotions, Buy X Get Y and loyalty. Odoo can associate pricelists/promotions with a website and can apply variant-specific pricelist rules.

Sources reviewed:
- https://www.odoo.com/documentation/19.0/applications/websites/ecommerce/configuration/prices.html
- https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/loyalty_discount.html

### 6.2 Shopify — EXTERNAL VERIFIED

Shopify currently classifies discounts by target class:

- PRODUCT;
- ORDER;
- SHIPPING.

It also has explicit combination/stacking controls rather than assuming all discounts combine freely.

Sources reviewed:
- https://shopify.dev/docs/apps/build/discounts
- https://shopify.dev/docs/api/admin-graphql/latest/enums/DiscountClass
- https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountCombinesWith

### 6.3 AWJ implication — INFERENCE

The existing AWJ PriceList core is reusable, but Commerce pricing should not be reduced to `Product.sale_price` or one coupon field. A future central Price Resolver should preserve existing accounting/tax/rounding authorities while adding explicit context such as customer/Partner, price list, channel, quantity/UOM and eventually promotion effects.

Promotions should remain a separate capability from base/pricelist resolution. Discount combination policy must be explicit.

**OPEN:** exact promotion types, stacking matrix, coupon schema, loyalty/gift-card/store-credit scope, and V1 activation. These are not authorized by this document.

## 7. External-channel synchronization

### 7.1 Zid — EXTERNAL VERIFIED

Current Zid documentation exposes real-time webhooks for merchant events, including order/customer-related events, with subscription through Merchant APIs.

Sources reviewed:
- https://docs.zid.sa/webhooks
- https://docs.zid.sa/create-a-webhook

### 7.2 Salla — EXTERNAL VERIFIED

Current Salla Merchant APIs expose branch-filterable product quantities and variant-level quantity operations, showing that external-channel integrations need explicit product/variant and location/branch mapping rather than a single global stock number.

Sources reviewed:
- https://docs.salla.dev/9612796e0
- https://docs.salla.dev/product-variants/list

### 7.3 AWJ implication — INFERENCE

External commerce connectors should not become a second inventory truth. The architecture direction remains:

```text
AWJ warehouse inventory
      ↓
AWJ reservations / ATS
      ↓
approved external inventory projection
      ↓
channel API
      ↓
reconciliation
```

Connector design will need explicit tenant, channel/store, product/variant mapping, location mapping, idempotency, event handling, retries and reconciliation.

**OPEN:** exact connector framework, inbound webhook verification per provider, sync direction per entity, polling fallback and reconciliation cadence.

## 8. Evidence affecting implementation sequencing

The evidence currently supports this dependency logic, without yet fixing PR names/schema:

1. **Inventory Reservation / ATS remains the first critical missing Commerce foundation.** This is both an AWJ-audit finding and supported by external commerce inventory models.
2. **Sales Channel + Warehouse mapping must exist before multi-channel stock projection can be safe.**
3. **Commerce Order must remain separate from Invoice**, per ADR-01; implementation must reuse existing Invoice/accounting authorities rather than bypass them.
4. **Payment orchestration requires a separate provider/intent boundary**, while successful financial settlement must land in existing AWJ Payment authority.
5. **Customer/mobile authentication must remain outside ERP staff RBAC** and tenant/resource ownership must be explicit.
6. **Product variants are a genuine architectural gap**, but implementing them touches many mature ERP domains and should not be smuggled into a small storefront PR.
7. **Promotions are distinct from price lists** and require explicit combination policy; they should not block the minimum safe order/reservation foundation unless a verified V1 requirement says otherwise.
8. **External channel integrations depend on stable internal Commerce contracts**, not the reverse.

## 9. Items still requiring evidence before Master Plan is final

The following remain intentionally open for the next evidence pass:

- Saudi VAT/ZATCA invoice timing matrix for prepaid, immediate payment, COD, partial fulfillment and B2B credit scenarios;
- shipping/delivery method boundary and shipping-charge/tax treatment;
- detailed payment-provider callback/authentication requirements for candidate Saudi providers (provider selection itself not yet approved);
- customer authentication technology/provider choice (not to be inferred from Shopify's implementation);
- product-variant compatibility audit across current AWJ invoice/purchase/return/POS/import/report paths;
- exact current AWJ pricing resolution call graph and duplicated pricing logic that a Central Price Resolver would need to wrap;
- external connector inbound webhook security/reconciliation design;
- legal/privacy retention implications for Commerce customer identity and guest-order data.

## 10. Non-decisions

This document does not authorize:

- migrations or new tables;
- production code;
- new API endpoints;
- Product schema changes;
- variant implementation;
- promotion implementation;
- payment-provider selection;
- authentication-provider selection;
- external connector implementation;
- changes to Invoice, Payment, Inventory, Partner, POS or ZATCA behavior;
- merge or deployment.

## 11. Next step

Continue the Evidence Pass on the open items above. Only after those points are sufficiently verified should the research be converted into `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` with small dependency-ordered PRs, explicit tests, Tenant Isolation gates, accounting boundaries, backward-compatibility requirements and rollout/rollback conditions.
