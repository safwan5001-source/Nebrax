# AWJ Product Variants — Compatibility Audit

**Gate:** PRODUCT-VARIANTS-COMPAT-1  
**Status:** Architecture / compatibility decision — documentation only  
**Date:** 2026-09-14  
**Scope:** Product, inventory, UOM/barcode, pricing, POS, financial-document snapshots, Commerce compatibility. No production code, schema, API, accounting, merge or deployment change.

## 1. Context and evidence boundary

AWJ Commerce Evidence Pass 03 already established Gate C6: first-class Product Variants are not part of the initial Commerce vertical slice, and any later implementation must begin with a compatibility audit. This document performs that gate; it does not authorize implementation.

All current AWJ business data is test/demo data. Therefore preservation of current rows is not an architecture constraint. However code/API compatibility, accounting correctness, inventory correctness, Tenant Isolation, historical-document integrity and safe rollout remain mandatory. A cleaner pre-production schema correction is preferable to permanent compatibility complexity when evidence supports it.

## 2. Current AWJ model — verified

### 2.1 Product is currently the sellable/inventory identity

`Product` owns the current SKU/product identity and carries primary barcode, sale/purchase/minimum prices, inventory tracking fields, quantity-on-hand/average-cost state, unit-template/default sales/purchase unit references, media and related product metadata.

There is no first-class ProductVariant/ProductOption aggregate in the current repository.

### 2.2 Inventory is Product-scoped

`StockMovement` is Product-scoped. Current moving-average valuation is documented as global on Product. Per-location stock is represented by `ProductWarehouseStock`, keyed by tenant/product/warehouse semantics.

**Compatibility consequence:** a real stocked variant cannot be presentation-only metadata. If variants have independently sellable stock, inventory identity must be able to distinguish them.

### 2.3 UOM is an independent dimension

AWJ already supports multiple UOM, conversion factors, default sales/purchase units, unit-aware price-list entries, barcode scan pre-fill and base-quantity normalization.

**Decision:** Variant and UOM MUST remain distinct concepts.

Example:

- Variant: Shirt / Black / XL
- UOM: piece / carton

A barcode that selects a UOM is not evidence of a variant.

### 2.4 Barcode namespace is already governed

AWJ has primary and alternate barcode infrastructure plus a tenant-wide barcode registry/uniqueness model. Variant implementation must extend/reuse this authority rather than create a parallel barcode namespace.

### 2.5 Price lists are Product + UOM scoped today

`PriceListItem` represents a price for a Product and unit. POS/customer price resolution and invoice calculation rely on existing Product/UOM contracts.

**Compatibility consequence:** future variant-aware pricing must preserve UOM as a separate pricing dimension and must not bypass minimum-sale-price or authorized override rules.

## 3. Financial and historical document evidence

### 3.1 Invoice lines already use snapshot semantics

`InvoiceService` persists `product_id` plus `product_name_snapshot`. Invoice resources prefer the historical snapshot rather than reinterpreting the document from the current Product name.

This is the correct precedent for variants.

### 3.2 Commerce order lines use the same historical pattern

`CommerceOrderLine` currently stores `product_id`, `product_name_snapshot`, quantity, `unit_name`, `unit_factor`, `unit_price` and line total. Commerce implementation deliberately follows the existing BUSINESS_HISTORICAL convention for Product references.

### 3.3 Purchase/return/quote lifecycle convention

Repository lifecycle tests and Commerce migrations document InvoiceLine, PurchaseLine, ReturnLine and QuoteLine as historical Product-reference siblings. Product deletion protection is governed centrally by `ProductReferenceRegistry` / `ProductLifecycleService`, not by treating every historical FK as a permanent live-catalog dependency.

**Decision:** future variant-capable documents MUST retain immutable sellable-item display/identity snapshots sufficient to read the historical document after the live variant changes, becomes unavailable or is deleted according to lifecycle policy.

No posted historical financial document may recalculate itself from current variant attributes, current name, current barcode or current price.

## 4. POS compatibility

POS currently treats Product + selected UOM as its sellable line identity. Existing behavior includes unit switching, barcode-to-UOM scan pre-fill, UOM pricing, checkout base-quantity normalization and held/local cart round trips.

**Compatibility consequence:** Variant support must not reinterpret existing UOM barcodes as variants or break existing non-variant Product cart keys.

A future POS sellable identity must be able to represent:

```text
Product without variants + UOM
or
Product + Variant + UOM
```

without requiring a fake/default variant for every existing simple Product.

## 5. Commerce compatibility

Commerce V1 remains allowed to sell current Product/SKU records directly. This audit does not reopen Cart or Checkout work already scoped around Product.

However new Commerce contracts should avoid making `product_id` semantically permanent as the only possible sellable identity. Historical snapshots must remain readable if a later variant identity is introduced.

Cart remains ephemeral. Product/variant deletion must not be blocked merely by abandoned carts; cart lines should retain required display snapshots and fail closed for new/revalidated purchase operations when the live sellable item is no longer available.

## 6. Recommended target domain model

This is the recommended domain boundary, not an approved physical schema.

```text
Product
  shared merchandising identity
  name / description / category / brand / common media
        |
        +-- Product Options
        |     color / size / material / ...
        |
        +-- Sellable Variants (optional)
              option-value combination
              SKU
              barcode identity
              inventory identity
              pricing eligibility/overrides
              variant media where needed

UOM remains orthogonal:
  Sellable identity + UOM -> normalized base quantity / unit-aware pricing
```

### Core compatibility rule

A Product with no variants MUST continue to be directly sellable.

Do not force every simple Product through a synthetic/default Variant merely to unify implementation. Such a migration would create broad churn across POS, invoices, purchases, inventory, reports and APIs without a business benefit.

## 7. Authority decisions for a future variant

Before implementation, the following authorities should be treated as design requirements:

| Concern | Recommended authority |
|---|---|
| Shared merchandising name/description/category/brand | Product |
| Option definitions and combinations | Product option/variant domain |
| Variant SKU | Variant when variants exist; Product for simple products |
| Barcode | Existing tenant-wide barcode registry, targeting the sellable identity/UOM as appropriate |
| Stock / warehouse availability | Sellable inventory identity; variants must be independently distinguishable when stocked independently |
| Moving-average valuation | Requires explicit migration/design decision; current authority is Product and must not be silently shared across independent variants |
| UOM conversion | Existing UOM authority, orthogonal to variant |
| Price list | Variant-aware extension must preserve UOM dimension and existing pricing/min-price rules |
| Historical document display | Immutable line snapshots |
| Commerce publication | Commerce listing/channel boundary; do not move `is_online` into Product |
| Tenant ownership | Every new variant/option/inventory reference must fail closed within trusted TenantContext |

## 8. Pre-production data posture

Current data is test/demo only. Consequently, when implementation is approved:

- destructive migration of demo rows may be acceptable if it produces a cleaner final schema;
- no architecture shim should be added solely to preserve current demo IDs/rows;
- fixtures, seeders and tests must be migrated deliberately;
- production-facing API/backward compatibility still requires explicit review;
- financial, inventory and Tenant Isolation invariants remain non-negotiable even with demo-only data.

## 9. Implementation gates

No Variant implementation should begin until these decisions are explicit:

1. **Sellable identity contract** — define how services address simple Product vs Variant without polymorphic ambiguity or tenant leaks.
2. **Inventory/valuation contract** — decide variant warehouse balances, stock movements, reservation identity and moving-average valuation semantics.
3. **Barcode contract** — extend the existing registry; define Product/Variant/UOM targeting and collision rules.
4. **Pricing contract** — define precedence for Product price, Variant override, PriceListItem and UOM without changing approved price-floor behavior accidentally.
5. **Historical snapshot contract** — define the minimum immutable snapshot for Invoice/Purchase/Return/Quote/Commerce lines.
6. **Lifecycle contract** — variant deactivate/delete behavior and reference classification.
7. **POS contract** — scan/search/cart/held-cart behavior for variant + UOM while preserving simple Product behavior.
8. **Public/Mobile Commerce API contract** — option selection and stable sellable identity without exposing internal assumptions.
9. **Tenant Isolation tests** — cross-tenant Product/Variant/Option/Barcode/Inventory negative tests.
10. **PostgreSQL concurrency tests** — reservations/stock for two variants of the same Product must not contaminate one another.

## 10. Recommended implementation order — not authorized yet

If Product Variants are approved for implementation, use small independent PRs:

1. `VAR-ARCH-1` — final sellable-identity + inventory/valuation + barcode/pricing ADR (docs/tests contract only where possible).
2. `VAR-CORE-1` — Product Option / Option Value / Variant core and tenant/lifecycle constraints.
3. `VAR-INV-1` — variant inventory, warehouse stock, movement and valuation integration.
4. `VAR-PRICE-1` — pricing/UOM/price-list integration with min-price regression coverage.
5. `VAR-DOC-1` — invoice/purchase/return/quote snapshot and sellable-reference integration.
6. `VAR-POS-1` — POS search/scan/cart/held-cart UI and API integration.
7. `VAR-COM-1` — Commerce listing/public API/cart selection integration.
8. `VAR-REPORT-1` — reports/search/import/export/workbook compatibility.

Do not combine these into one broad refactor.

## 11. Decision

**PRODUCT-VARIANTS-COMPAT-1: PASS WITH REQUIRED DESIGN GATES.**

First-class Product Variants are architecturally feasible in AWJ, and the current demo-only data posture gives freedom to choose a clean pre-production schema. The implementation must nevertheless preserve the established boundaries for UOM, barcode registry, pricing authority, financial snapshots, lifecycle, Tenant Isolation and accounting/inventory correctness.

The preferred direction is **optional first-class variants above Product**, while simple Products remain directly sellable. Variants must become real sellable/inventory identities where independent stock exists; they must not be reduced to storefront-only attributes.

This audit does **not** authorize schema/code implementation and does not change Commerce V1 scope. The next decision artifact should be `VAR-ARCH-1`, with particular attention to inventory valuation and sellable-identity representation before any migration is written.
