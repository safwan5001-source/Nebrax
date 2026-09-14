# AWJ Product Variants — VAR-ARCH-1 Architecture Contract

**Status:** Architecture decision / documentation only — implementation is NOT authorized  
**Date:** 2026-09-14  
**Depends on:** `AWJ_PRODUCT_VARIANTS_COMPATIBILITY_AUDIT.md`, `AWJ_CONFIGURABLE_POLICY_PRINCIPLE.md`  
**Scope:** sellable identity, inventory/valuation, UOM/barcode/pricing, media, historical snapshots, lifecycle/delete protection, POS/Commerce compatibility and Tenant Isolation.

## 1. Domain boundary

AWJ adopts Product as the shared merchandising parent and optional concrete ProductVariant records as independently sellable combinations.

- Product owns shared name/description/category/brand and common merchandising metadata.
- Product Options / Option Values describe dimensions such as color, size or material.
- ProductVariant represents one concrete option-value combination when variants are enabled.
- A Product without variants remains directly sellable. AWJ MUST NOT create a synthetic/default variant merely to unify implementation.
- UOM is orthogonal to ProductVariant. `Black / XL` is a variant; `piece / pack / dozen` are UOMs.

## 2. Sellable-reference contract

Business documents and APIs should use an explicit relational pair rather than a generic polymorphic sellable reference:

```text
product_id             required
product_variant_id     nullable
```

Invariants:

1. when `product_variant_id` is present, the Variant MUST belong to `product_id`;
2. Product and Variant MUST belong to the current trusted tenant;
3. cross-tenant references fail closed;
4. a simple Product uses `product_variant_id = null`;
5. a variant-managed selection uses the concrete Variant; the parent Product is not a parallel stock identity for the same selection;
6. do not introduce generic `sellable_type/sellable_id` if doing so weakens relational FKs or Tenant Isolation.

## 3. Inventory and valuation authority

A concrete independently stocked Variant MUST have an independent inventory/valuation identity. Costs of sibling variants MUST NOT be blended into one Product average.

AWJ preserves its existing valuation philosophy:

- moving average is tenant-wide per concrete inventory identity;
- warehouse rows hold quantity/location state, not independent average cost;
- receipts recalculate moving average for the affected inventory identity;
- issues do not recalculate moving average;
- transfers between warehouses do not create a new warehouse cost;
- UOM quantities normalize to base quantity before inventory valuation;
- sibling variants never contaminate one another's quantity or average cost.

Conceptually:

```text
Simple Product -> one Inventory State
Variant-managed Product -> one Inventory State per concrete Variant
Inventory State -> tenant-wide quantity_on_hand + avg_cost
Inventory State + Warehouse -> warehouse quantity/revision
```

The physical table/model name is intentionally deferred to implementation design.

### 3.1 Single source of truth

When `VAR-INV-1` is implemented, `quantity_on_hand` and `avg_cost` SHOULD move to the unified inventory-state authority rather than remain permanently dual-written on Product and Variant.

Current demo/test data does not justify permanent compatibility debt. Existing API fields may be preserved temporarily as projections from the new authority, but there MUST NOT be two writable truths for quantity or average cost.

For a variant-managed Product parent, an aggregate quantity may be derived for display/reporting. A synthetic parent `avg_cost` MUST NOT be invented if it would hide economically different variant costs.

## 4. UOM, barcode and pricing contract

Barcode is a resolver, not the price authority:

```text
Barcode -> Product + optional Variant + UOM -> Pricing Resolver
```

The existing tenant-wide barcode namespace remains authoritative. Variant work MUST extend it rather than create a parallel namespace.

Commercial price belongs to sellable identity + UOM. Conversion factor determines inventory normalization and MUST NOT automatically determine selling price.

Example:

| Variant | UOM | Factor | Barcode | Base selling price |
|---|---|---:|---|---:|
| Black / XL | piece | 1 | A | 5.00 |
| Black / XL | pack | 6 | B | 27.00 |
| Black / XL | dozen | 12 | C | 50.00 |

`pack = 6` does not imply `pack price = 6 × piece price`.

Multiple barcodes resolving to the same sellable identity + UOM resolve to the same canonical UOM price unless a future, separately approved barcode-specific promotion feature is designed.

Product create/edit UX should allow the UOM selling price to be seen/set in the same alternate-barcode/UOM workflow while persistence writes through the canonical pricing authority rather than storing an independent price on the barcode record.

### 4.1 Pricing precedence

Preserve the existing AWJ precedence already aligned between Commerce and POS:

1. valid customer/Partner price list when applicable;
2. otherwise the Sales Channel default price list when applicable;
3. otherwise the explicit base price for the selected sellable identity + UOM;
4. approved discounts/adjustments;
5. minimum-sale-price guard and authorized override rules;
6. snapshot the resulting transaction price on the document line.

A missing override for one UOM falls back to that same UOM's explicit base price. AWJ MUST NOT derive an alternate-UOM price by multiplying another UOM price by its conversion factor.

A future business need for a closed/exclusive price list where missing items/UOMs are not sellable may be introduced only as an explicit pricing-list policy with a safe default; it must not silently change global Price List semantics.

## 5. Media contract

Media resolution has three layers:

1. Product gallery for common product-family images;
2. visual Option Value media (for example `Color=Black`) to avoid duplicating identical images across sizes;
3. optional exact Variant media override only where the full combination genuinely differs.

Resolution/fallback MUST be deterministic. Product gallery is the fallback when selection-specific media is absent. AWJ needs an explicit cover/primary-image contract; clients must not independently guess from `sort_order`.

Public/storefront media exposure remains tenant-safe and MUST NOT expose internal storage paths. Product/Variant publication does not publish arbitrary tenant media.

Financial historical truth does not depend on the live product gallery.

## 6. Historical snapshot contract

Posted/historical documents MUST remain readable and semantically unchanged after Product/Variant/UOM/barcode/price edits, deactivation or permitted deletion.

A variant-aware historical line should retain, as applicable:

```text
product_id
product_variant_id
product_name_snapshot
variant_name_snapshot
variant_options_snapshot (structured option/value pairs)
product/variant SKU snapshot
barcode snapshot used for the transaction when materially relevant
unit_name
unit_factor
quantity
base_quantity
unit_price
discount/tax/totals required by that document
```

`variant_options_snapshot` should preserve structured values (for example Color=Black, Size=XL) rather than only one concatenated display string so exports/reports/APIs can retain semantic dimensions.

The live Product/Variant FK is a navigation/reference aid; it is not the historical display authority.

Average cost used for a posted inventory/accounting event MUST be recorded through the approved stock/accounting historical path. A later change in current average cost MUST NOT reinterpret old COGS or stock movements.

Returns/exchanges should link to the source historical line where the workflow has a source document, preserving the original Product/Variant/UOM identity instead of guessing from the current catalog.

## 7. Variant lifecycle and delete-protection contract

AWJ MUST extend the existing centralized Product lifecycle/reference-classification philosophy to ProductVariant. Do not scatter ad-hoc `exists()` checks across controllers/services.

### 7.1 Deactivation

Deactivation is the normal way to stop future use of a Variant that has history.

An inactive Variant:

- cannot be selected for new sales/purchases/Commerce operations unless a separately approved workflow explicitly allows it;
- remains resolvable for historical documents, returns and audit/reporting where required;
- does not mutate existing snapshots;
- must not release a historical SKU/barcode in a way that can make old documents misleading.

### 7.2 Delete protection categories

Variant references should follow the same semantic categories already used by `ProductReferenceRegistry`:

**BUSINESS_HISTORICAL — blocks hard delete**
- Invoice/Purchase/Return/Credit Note/Quote/Recurring Invoice/Procurement/Delivery Note/Commerce Order lines that reference the concrete Variant.
- Reason: the Variant is part of an existing business fact. Reusing its identity after deletion can mislead historical documents even when snapshots exist.

**INVENTORY_SEMANTIC — blocks hard delete and incompatible inventory-identity changes**
- Stock movements.
- Stock permit lines.
- Stocktake lines.
- Inventory opening lines.
- Warehouse stock state.
- Inventory reservations according to the approved reservation lifecycle.
- Any future inventory-state row representing non-zero or historically meaningful stock identity.

A Variant with inventory history MUST NOT be converted into a non-stock interpretation that would reinterpret prior movements.

**COMMERCIAL_LIVE — blocks hard delete while live configuration exists**
- Variant-aware Price List entries.
- Commerce listing/publication/channel configuration.
- Other active sellable configuration that would silently break if the Variant disappeared.

**OWNED_CHILD — does not independently block delete once deletion is otherwise allowed**
- alternate barcode mappings;
- variant-specific/option-value media mappings owned solely by the deleted identity;
- other purely owned configuration with no independent historical meaning.

Owned children are cleaned only inside the approved deletion transaction after all blockers pass.

**AUDIT_HISTORY — does not block delete and remains preserved**
- lifecycle/activity/audit events.

### 7.3 Zero-stock is necessary but not sufficient

`quantity_on_hand = 0` does NOT by itself make a Variant deletable. Historical, inventory-semantic and commercial-live references are independent blockers.

Likewise, deleting a Product parent MUST fail while protected Variant references exist. Parent lifecycle must evaluate its Variants before deletion.

### 7.4 Identity reuse

SKU/barcode reuse after deletion must follow the existing Product identity-safety philosophy. Historical business/inventory references that block deletion also prevent silent release/reuse of an identity that would make old records ambiguous.

No tenant setting may weaken these lifecycle protections; they are data-integrity invariants.

## 8. POS and Commerce compatibility

POS and Commerce must represent:

```text
Product + UOM
or
Product + Variant + UOM
```

without forcing simple Products through fake variants.

Barcode scanning resolves identity + UOM, then trusted server-side pricing resolves price. Scanner/client payloads are not trusted as price authority.

Cart remains operational/ephemeral and does not become a permanent historical deletion blocker. On revalidation, unavailable/deleted/inactive sellable identities fail closed according to the Cart/Checkout contract while display snapshots preserve a useful user message.

Commerce publication remains under CommerceListing/channel authority; do not add `is_online` to Product as the publication source of truth.

## 9. Tenant Isolation and concurrency invariants

Every Variant/Option/Barcode/Media/Pricing/Inventory association MUST be tenant-owned and resolved inside trusted TenantContext.

Required negative coverage includes:

- cross-tenant Variant attached to Product;
- cross-tenant Variant used on document line;
- cross-tenant barcode resolving to another tenant's Variant;
- cross-tenant Price List item targeting Variant;
- cross-tenant media mapping;
- cross-tenant warehouse stock/reservation/movement.

PostgreSQL concurrency coverage must prove that reservations/stock mutations for two Variants of the same Product serialize only on the correct concrete inventory identity and do not contaminate sibling Variant quantities or revisions.

## 10. Configurable-policy boundary

Use `AWJ_CONFIGURABLE_POLICY_PRINCIPLE.md` project-wide.

The following are invariants, not Settings:

- Tenant Isolation;
- one authoritative inventory/valuation state;
- historical snapshot immutability;
- no UOM-price invention from conversion factor;
- lifecycle protection for historical/inventory facts;
- accounting/inventory correctness;
- variant belongs to its Product.

Settings may be considered only where multiple business behaviors are genuinely valid and all preserve these invariants. Any transaction-affecting policy must snapshot its historical result.

## 11. Implementation sequence — not authorized

1. `VAR-CORE-1` — Options / Option Values / Variant core, tenant constraints and lifecycle foundation.
2. `VAR-INV-1` — unified inventory state, warehouse stock, movements, reservations and valuation.
3. `VAR-PRICE-1` — Variant + UOM pricing, price lists, alternate-barcode/UOM price workflow and minimum-price guards.
4. `VAR-MEDIA-1` — product/option-value/variant media and deterministic cover resolution.
5. `VAR-DOC-1` — historical document references/snapshots and returns.
6. `VAR-POS-1` — POS search/scan/cart/held-cart.
7. `VAR-COM-1` — Commerce listing/public API/cart selection.
8. `VAR-REPORT-1` — reports/search/import/export/workbook compatibility.

No implementation, merge, deploy or production release is authorized by this ADR.

## 12. VAR-ARCH-1 decision

**PASS — architecture contract ready for implementation planning, subject to repository-level schema design during the scoped implementation PRs.**

The physical schema may be refined during `VAR-CORE-1`/`VAR-INV-1`, but it MUST preserve the invariants in this document. Any proposed schema that requires dual inventory truths, blends sibling Variant average costs, weakens Tenant Isolation, reinterprets historical documents, or makes barcode/UOM conversion the price authority must be rejected or returned for architecture review.
