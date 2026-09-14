# AWJ Product Variants — VAR-CORE-1 Implementation Plan

**Status:** implementation planning only — code/schema implementation is NOT authorized by this document  
**Date:** 2026-09-14  
**Depends on:** `AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md`, `AWJ_CONFIGURABLE_POLICY_PRINCIPLE.md`  
**Scope:** Product Option / Option Value / Product Variant core identity, combination invariants, SKU/barcode namespace integration, lifecycle foundation, and Simple → Variant-managed transition contract.

## 1. Goal

`VAR-CORE-1` introduces the minimum first-class domain needed to represent concrete Product variants without yet moving inventory, pricing, media, documents, POS or Commerce onto variants.

The PR must remain a foundation PR. It MUST NOT silently absorb `VAR-INV-1`, `VAR-PRICE-1`, `VAR-MEDIA-1`, `VAR-DOC-1`, `VAR-POS-1` or `VAR-COM-1`.

## 2. Core domain

Conceptually:

```text
Product
  ├── ProductOption        e.g. Color, Size
  │      └── ProductOptionValue  e.g. Black, White, M, XL
  └── ProductVariant
         └── exact set of ProductOptionValues
```

A Product without variants remains directly sellable. No synthetic/default Variant is created.

### 2.1 ProductOption

An Option belongs to exactly one Product and one tenant. It defines one variant dimension such as Color or Size.

Required semantics:
- tenant-owned;
- product-owned;
- stable identifier independent of translated/display name;
- deterministic display order;
- active/lifecycle state;
- option names may be edited only without changing historical meaning of already snapshotted documents.

Duplicate logical options on one Product should be rejected after normalized comparison where appropriate; exact normalization rules must be explicit in implementation tests rather than client-only validation.

### 2.2 ProductOptionValue

An Option Value belongs to exactly one ProductOption, therefore transitively to exactly one Product and tenant.

Required semantics:
- tenant/product/option ownership must be validated server-side;
- deterministic display order;
- lifecycle state;
- values used by existing Variants must not be hard-deleted by cascade merely because the display configuration changes;
- future visual media may attach at this layer, but `VAR-CORE-1` does not implement media ownership.

### 2.3 ProductVariant

A Variant belongs to exactly one Product and tenant and represents one concrete combination of option values.

A Variant is a sellable identity only for a Product that is in an approved variant-managed state. It does not own UOM semantics.

Core fields/concepts may include identity, Product/tenant ownership, SKU, active state, deterministic combination key and lifecycle timestamps. Exact physical columns are implementation details subject to migration review.

## 3. Combination invariants

The server/database contract must enforce all of the following:

1. every selected Option Value belongs to an Option belonging to the same Product;
2. every selected Option Value belongs to the current tenant;
3. one Variant cannot select two values from the same Option;
4. a concrete combination cannot be duplicated for the same Product;
5. combination equality is order-independent: `Black + XL` equals `XL + Black`;
6. if an Option is required for variant generation, each active concrete Variant must have exactly one value from that Option;
7. changing display order or translated labels must not create a new logical combination;
8. client-provided combination keys/hashes are not trusted as authority.

Preferred implementation direction: derive a canonical server-side combination identity from stable Option/OptionValue IDs and enforce uniqueness at the database boundary in addition to service validation. Do not use a display-name concatenation as the uniqueness key.

## 4. SKU identity contract

Current AWJ Product SKU is tenant-wide unique, including soft-deleted Product rows. Variant SKU must not create a parallel collision-prone namespace.

Required target invariant:

> A tenant cannot have two active/historical catalog identities whose SKU is ambiguous between a simple Product and a ProductVariant.

Therefore `VAR-CORE-1` must design one authoritative SKU namespace covering Product and Variant identities, analogous in safety intent to the existing unified barcode registry.

Do not rely on two independent unique constraints (`products(tenant_id, sku)` and `product_variants(tenant_id, sku)`) because they cannot prevent Product-vs-Variant collisions.

The physical solution may be a dedicated SKU registry or another strong relational mechanism, but it must:
- be tenant-wide;
- fail closed on cross-tenant ownership;
- reserve identity consistently through lifecycle operations;
- avoid releasing/reusing an SKU while protected historical/inventory references make reuse misleading;
- be transaction-safe under concurrent creation/update.

## 5. Barcode boundary

`VAR-CORE-1` does not redesign barcode pricing or UOM behavior. It prepares Variant identity to participate in the existing tenant-wide barcode authority.

Invariant from `VAR-ARCH-1` remains:

```text
Barcode -> Product + optional Variant + UOM -> Pricing Resolver
```

Barcode is not a price authority. Product and Variant barcodes must not form independent collision namespaces.

Detailed UOM/price integration remains `VAR-PRICE-1`.

## 6. Simple vs Variant-managed Product state

AWJ must not treat enabling variants as a harmless boolean edit. It changes the inventory/sellable identity model of the Product.

Conceptual states:

```text
SIMPLE
VARIANT_MANAGED
```

The exact persisted representation is deferred, but transition must occur through a domain service/workflow, not arbitrary mass assignment.

### 6.1 SIMPLE -> VARIANT_MANAGED

The transition MUST fail closed when existing operational state cannot be mapped safely.

At minimum the transition gate must evaluate:
- tenant-wide quantity on hand;
- per-warehouse balances;
- inventory reservations;
- inventory-semantic references and drafts whose future posting depends on Product identity;
- held/operational carts where applicable when later integrated;
- commercial-live configuration that assumes direct Product identity;
- existing barcode/UOM/price configuration requiring explicit mapping.

The system MUST NOT guess how existing Product stock is distributed among newly created Variants.

Example: Product has 100 pieces and new Variants Black/M, Black/XL and White/M. AWJ must not automatically allocate 100 to any Variant or divide it evenly.

For initial `VAR-CORE-1`, the safe default is to permit the state transition only when no inventory/operational footprint requiring allocation exists, unless a separately designed migration workflow is explicitly approved.

A future stock-allocation wizard may support controlled conversion, but that belongs to `VAR-INV-1` or a dedicated scoped PR, not core creation.

### 6.2 VARIANT_MANAGED -> SIMPLE

This is also an identity migration, not a toggle. It MUST be blocked while Variants have protected historical/inventory/live references unless a separately approved consolidation workflow proves accounting and inventory correctness.

No setting may weaken these guards.

## 7. Option and Variant lifecycle

Deactivation is preferred over deletion once identity has meaningful references.

- inactive Option/Value/Variant remains resolvable for history where required;
- deactivation must not rewrite existing Variant combinations or historical snapshots;
- an Option Value used by a protected Variant cannot be cascade-deleted;
- deleting an unused draft Variant may clean owned combination rows transactionally after reference checks;
- Product deletion must evaluate Variant blockers as required by `VAR-ARCH-1`;
- lifecycle decisions should extend the centralized ProductReferenceRegistry/ProductLifecycleService philosophy rather than scatter ad-hoc checks.

Whether Variant gets a dedicated registry/service or a generalized catalog-reference registry is an implementation design choice, but the result must have one reviewable source of truth and architectural tests that prevent unclassified new references.

## 8. Tenant Isolation

Required negative tests for `VAR-CORE-1`:

- Option cannot attach to Product from another tenant;
- Option Value cannot attach to Option from another tenant;
- Variant cannot attach to Product from another tenant;
- Variant cannot select Option Value from another tenant;
- Variant cannot select a same-tenant Option Value belonging to another Product;
- lifecycle/update routes cannot resolve another tenant's Variant by UUID;
- SKU reservation cannot collide/leak across tenants but must reject collision inside one tenant.

All writes must resolve ownership inside trusted TenantContext; request-supplied tenant IDs are not authority.

## 9. Concurrency and database invariants

SQLite tests are insufficient for the final core identity contract. PostgreSQL coverage must include at least:

- two concurrent attempts to create the same Variant combination -> exactly one succeeds;
- two concurrent Product/Variant creations claiming the same tenant SKU -> exactly one succeeds;
- lifecycle/update races cannot release and reassign a protected SKU incorrectly.

Database uniqueness/constraints are required where practical; service-level `exists()` checks alone are not sufficient.

## 10. Explicitly out of scope

`VAR-CORE-1` must not implement:
- inventory-state migration or variant stock balances;
- moving-average integration;
- price list resolution or alternate-UOM price editing;
- Product/Option/Variant media;
- invoice/purchase/return snapshots;
- POS variant picker/scanner integration;
- Commerce/public API variant selection;
- broad Product UI redesign;
- unrelated Product/Inventory refactors.

## 11. Minimum implementation acceptance gates

Before `VAR-CORE-1` can be considered complete:

1. Option/Value/Variant ownership and combination invariants enforced server-side;
2. database-backed duplicate-combination protection;
3. unified Product/Variant SKU collision protection;
4. lifecycle/deactivation foundation with no unsafe cascade deletion;
5. Simple/Variant-managed transition guarded as an identity migration;
6. Tenant Isolation negative tests;
7. PostgreSQL concurrency tests for combination and SKU races;
8. existing simple Product behavior remains green;
9. no inventory/accounting behavior changed;
10. implementation report records changed files, tests, Build/CI, risks, remaining work, Branch/PR/Base SHA/Head SHA and next step.

## 12. Decision

`VAR-CORE-1` may proceed only as a narrowly scoped core-domain foundation after explicit implementation authorization.

The safe initial transition policy is intentionally conservative: existing Product stock or inventory-semantic state is never guessed into Variants. A later approved inventory migration workflow can relax that operational limitation without weakening the underlying correctness invariant.
