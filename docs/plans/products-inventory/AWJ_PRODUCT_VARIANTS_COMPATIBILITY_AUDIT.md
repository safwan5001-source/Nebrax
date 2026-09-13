# AWJ Product Variants — Compatibility Audit

**Gate:** PRODUCT-VARIANTS-COMPAT-1  
**Status:** Architecture / compatibility decision — documentation only  
**Date:** 2026-09-14  
**Scope:** Product, inventory, UOM/barcode, pricing, media, POS, financial-document snapshots, Commerce compatibility. No production code, schema, API, accounting, merge or deployment change.

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

### 2.6 Alternate barcode + UOM pricing requirement

AWJ product create/edit UX must support assigning the commercial selling price for each sellable UOM represented by an alternate barcode. Typical business usage is not limited to mathematically multiplying the base-unit price:

| UOM | Base factor | Example barcode | Example selling price |
|---|---:|---|---:|
| piece / حبة | 1 | Barcode A | 5.00 |
| pack / شدة | 6 | Barcode B | 27.00 |
| dozen / درزن | 12 | Barcode C | 50.00 |

The conversion factor determines inventory quantity normalization; it MUST NOT determine the commercial price by multiplication. A merchant may intentionally price a pack or dozen below or above the simple base-unit multiple.

**Authority decision:** price belongs to the **sellable identity + UOM**, not to the barcode string itself. Barcode is a resolver/input identity. This prevents accidental divergent prices if more than one barcode later resolves to the same UOM.

Conceptually:

```text
Barcode -> Sellable identity + UOM -> Pricing authority
```

not:

```text
Barcode -> owns price
```

For a simple Product today, the sellable identity is Product. For a future variant-capable Product it may be ProductVariant. Therefore the same rule can extend cleanly to:

```text
Product + UOM -> price
ProductVariant + UOM -> price
```

**UX requirement:** when creating/editing an alternate barcode that selects a sellable UOM, the user should be able to see/set that UOM's selling price in the same workflow. The UI may present this as a row containing barcode, UOM, base factor/default quantity and selling price, while persistence continues to respect the central UOM/pricing authority rather than storing an independent price on the barcode record.

This requirement must be included in the future pricing/barcode contract and regression coverage for Product create/edit, POS scanning and invoice price resolution.

### 2.7 Product and variant media contract

AWJ already has `ProductMedia`. The current model is explicitly product-owned, tenant-aware, stores file metadata and `sort_order`, and serves media through guarded access that verifies product/tenant ownership before exposing the file. Current product UI supports multiple images (currently capped at 8 in the product dialog).

The product-media capability should be preserved and extended rather than replaced when variants are introduced.

**Required media layers:**

1. **Product gallery** — common images that describe the product family and apply regardless of selected option/variant.
2. **Option-value / visual selection media** — images associated with a visual option value where appropriate, especially color. Example: selecting `Black` should show black-product images without requiring duplicate uploads for Black/M, Black/L and Black/XL.
3. **Variant-specific override media** — optional escape hatch only when one exact combination genuinely requires distinct media. It must not be the default storage model for every combination.

**Decision:** do not model the storefront gallery as `variant_id -> duplicated image files` only. That would cause unnecessary duplication for dimensions such as size that normally do not change appearance.

Preferred conceptual resolution:

```text
Product gallery
      +
selected visual option-value media (for example Color=Black)
      +
optional exact-variant overrides
      -> resolved storefront/POS product gallery
```

Media inheritance/fallback must be deterministic. If no selection-specific media exists, Product gallery remains the fallback. An exact variant override may augment or replace selection-specific media only according to the future approved media contract; clients must not invent their own precedence.

**Primary image requirement:** AWJ needs an explicit, deterministic primary-image/cover concept for product listing cards, POS/store search results and Commerce listing. `sort_order` alone can remain part of ordering, but the architecture must define how the cover is selected and what fallback applies if it is deleted or unavailable.

**Commerce requirement:** public/storefront media URLs must remain tenant-safe and must not expose internal storage paths. Publication of a Product/Variant does not imply publication of arbitrary tenant media; only media resolved through the approved product-media boundary may be exposed.

**Historical-document boundary:** invoice/purchase/accounting documents do not need to persist live product-gallery relationships as financial truth. Media changes must not mutate posted financial document meaning. If a future document template snapshots an image, that is a separate presentation decision, not part of inventory/accounting identity.

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
  name / description / category / brand
  common product gallery
        |
        +-- Product Options
        |     color / size / material / ...
        |     visual option values may own/refer to media selections
        |
        +-- Sellable Variants (optional)
              option-value combination
              SKU
              barcode identity
              inventory identity
              pricing eligibility/overrides
              optional exact-variant media override

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
| Product gallery/common images | ProductMedia / Product media boundary |
| Visual option images (e.g. Color=Black) | Future option-value media mapping; reuse media rather than duplicate per size combination |
| Exact variant image exception | Optional variant-media override, not default ownership for every image |
| Primary/cover image | Explicit deterministic media contract with fallback; not client guesswork |
| Option definitions and combinations | Product option/variant domain |
| Variant SKU | Variant when variants exist; Product for simple products |
| Barcode | Existing tenant-wide barcode registry, targeting the sellable identity/UOM as appropriate; barcode itself does not own price |
| Stock / warehouse availability | Sellable inventory identity; variants must be independently distinguishable when stocked independently |
| Moving-average valuation | Requires explicit migration/design decision; current authority is Product and must not be silently shared across independent variants |
| UOM conversion | Existing UOM authority, orthogonal to variant |
| UOM selling price | Sellable identity + UOM; editable alongside alternate-barcode/UOM setup UX |
| Price list | Variant-aware extension must preserve UOM dimension and existing pricing/min-price rules |
| Historical document display | Immutable line snapshots |
| Commerce publication | Commerce listing/channel boundary; do not move `is_online` into Product |
| Tenant ownership | Every new variant/option/media/inventory reference must fail closed within trusted TenantContext |

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
3. **Barcode contract** — extend the existing registry; define Product/Variant/UOM targeting and collision rules; barcode remains a resolver and does not own price.
4. **Pricing contract** — define precedence for Product price, Variant override, UOM selling price, PriceListItem and approved minimum-sale-price rules; product create/edit must support setting the UOM price alongside alternate-barcode setup.
5. **Media contract** — define product gallery, visual option-value media, optional exact-variant override, primary image, deterministic fallback, tenant-safe public exposure and deletion behavior without per-combination duplication.
6. **Historical snapshot contract** — define the minimum immutable snapshot for Invoice/Purchase/Return/Quote/Commerce lines.
7. **Lifecycle contract** — variant deactivate/delete behavior and reference classification.
8. **POS contract** — scan/search/cart/held-cart behavior for variant + UOM while preserving simple Product behavior, including barcode-resolved UOM price and resolved cover image where UI needs it.
9. **Public/Mobile Commerce API contract** — option selection, resolved gallery and stable sellable identity without exposing internal assumptions.
10. **Tenant Isolation tests** — cross-tenant Product/Variant/Option/Media/Barcode/Inventory negative tests.
11. **PostgreSQL concurrency tests** — reservations/stock for two variants of the same Product must not contaminate one another.

## 10. Recommended implementation order — not authorized yet

If Product Variants are approved for implementation, use small independent PRs:

1. `VAR-ARCH-1` — final sellable-identity + inventory/valuation + barcode/UOM/pricing + media ADR (docs/tests contract only where possible).
2. `VAR-CORE-1` — Product Option / Option Value / Variant core and tenant/lifecycle constraints.
3. `VAR-INV-1` — variant inventory, warehouse stock, movement and valuation integration.
4. `VAR-PRICE-1` — pricing/UOM/price-list integration, alternate-barcode UOM price workflow and min-price regression coverage.
5. `VAR-MEDIA-1` — product/option-value/variant media mapping, cover/fallback and tenant-safe Commerce resolution.
6. `VAR-DOC-1` — invoice/purchase/return/quote snapshot and sellable-reference integration.
7. `VAR-POS-1` — POS search/scan/cart/held-cart UI and API integration.
8. `VAR-COM-1` — Commerce listing/public API/cart selection integration.
9. `VAR-REPORT-1` — reports/search/import/export/workbook compatibility.

Do not combine these into one broad refactor.

## 11. Decision

**PRODUCT-VARIANTS-COMPAT-1: PASS WITH REQUIRED DESIGN GATES.**

First-class Product Variants are architecturally feasible in AWJ, and the current demo-only data posture gives freedom to choose a clean pre-production schema. The implementation must nevertheless preserve the established boundaries for UOM, barcode registry, pricing authority, media security, financial snapshots, lifecycle, Tenant Isolation and accounting/inventory correctness.

The preferred direction is **optional first-class variants above Product**, while simple Products remain directly sellable. Variants must become real sellable/inventory identities where independent stock exists; they must not be reduced to storefront-only attributes.

Alternate barcode setup is also explicitly a UOM-pricing UX surface: each sellable UOM can have its own commercial selling price, but the price authority is the sellable identity + UOM rather than the barcode string.

Product imagery remains product-owned by default, with future visual option-value media and optional exact-variant overrides. AWJ should avoid duplicating the same color images across every size combination and must define an explicit cover/fallback contract before implementation.

This audit does **not** authorize schema/code implementation and does not change Commerce V1 scope. The next decision artifact should be `VAR-ARCH-1`, with particular attention to inventory valuation, sellable-identity representation, Barcode/UOM/Pricing and Product/Variant Media contracts before any migration is written.
