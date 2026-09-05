# AWJ Products & Inventory Audit — Reconciliation Addendum

**Date:** 2026-09-05  
**Status:** Working audit evidence; no implementation, merge, deploy, or production release authorized.  
**Parent audit:** `docs/audits/AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md`

> This addendum is part of the living audit record and records findings confirmed after the parent audit commit `35d84d3099a1ff1131516f53c4d8865b1fd1a281`. It must be folded into the parent audit at formal audit closure; it does not replace earlier confirmed findings or approved decisions.

## 1. Evidence methodology — mandatory correction

- Any AWJ-side question verifiable from code, migrations/schema, routes/API, settings, tests, or existing UI must be inspected in actual `main` before it is classified as Gap, Needs Decision, or Pending Verification.
- `Pending Verification` must mean that verification was actually attempted and remains blocked or requires an unexecuted runtime/integration check. It must not mean “not looked at yet”.
- Presence can be confirmed from direct implementation evidence. **Absence requires repository-wide domain tracing; a failed filename/string search is insufficient evidence of absence.**
- Old or assumed repository paths are not evidence. The current Laravel source is rooted at `app/`, `database/`, and `routes/`.
- Prior confirmed findings remain confirmed unless contradictory current evidence is found. Prior explicitly approved behavior remains an Approved Decision even when not implemented.
- Prior “missing/not found” claims based only on stale paths or inconclusive search must be selectively revalidated; the audit is not restarted from zero.

## 2. Reconciliation log

| Prior assumption / classification | Current `main` evidence | Corrected status |
|---|---|---|
| Product auto numbering may be missing / Daftra gap | `Product` uses `GeneratesDocumentNumbers`; numbering column is `sku`; product numbering is company-wide and continuous (non-yearly). Numbering catalog includes product prefix configuration. | **Confirmed Existing Capability / MATCH**. Daftra “next product number” remains a configurability benchmark, not evidence of missing auto numbering. |
| Default Warehouse may be absent | `Warehouse` has `is_default`, `Warehouse::default()`, automatic first-warehouse defaulting, single-default enforcement, and deletion protection. | **Confirmed Existing Capability** at tenant level. Per-branch default remains separate and is not established by current evidence. |
| Stocktake concurrency was a hardening concern | `StocktakeLine` stores `system_quantity` snapshot; posting applies `counted_quantity - system_quantity` without reconciling movements occurring after snapshot. | **Confirmed P1 correctness risk**. |
| Quantity-tier Pricing shown as P3 in current parent audit | Prior approved project classification is P2. | **Correct to P2** at closure. |
| Large Catalog + Inventory Opening Import priority | Earlier approved sequence classified shared large-import infrastructure as P1; later safety-first ordering places correctness/security P1 work ahead. | Preserve both facts: historical priority classification and current provisional execution order are distinct. No silent reclassification. |
| Default warehouse per branch inferred from Daftra benchmark | AWJ has tenant default warehouse and warehouses may carry `branch_id`; `BranchSettings` does not currently expose `default_warehouse_id`. | **Existing tenant default + Needs Decision/P2 candidate for per-branch default**, subject to full warehouse-resolution trace. |

## 3. Product SKU numbering — confirmed current capability

- `Product` uses the unified `GeneratesDocumentNumbers` trait.
- `sku` is the document-number column.
- Product numbering explicitly does not reset yearly.
- Product numbering explicitly does not branch its sequence; it is a company/tenant catalog sequence even when product visibility is branch-shareable.
- The unified numbering layer uses an existing Tenant/Branch anchor with `lockForUpdate()` to serialize concurrent generation, avoiding the old `count()+1` collision class.
- The sequence is derived from the highest matching number and is five-digit zero-padded.
- Product numbering is registered in the central numbering catalog and supports a product prefix setting; default prefix is `SKU`.

**Audit classification:** MATCH / Existing Capability. Do not create a backlog item for “add product auto numbering”. Any future item must be narrowly about additional configurability after exact settings/UI behavior is verified.

## 4. Default Warehouse — corrected current state

Confirmed from `Warehouse` and `WarehouseController`:

- Warehouse carries `branch_id`, `is_default`, and `is_active`.
- `Warehouse::default()` returns the warehouse marked default, otherwise the first active warehouse ordered by code.
- The first warehouse created for a tenant becomes default automatically.
- Setting another warehouse as default clears the default flag from all other warehouses.
- The default warehouse cannot be deleted until another default is assigned.
- A warehouse may be branch-linked or central (`branch_id = null`).
- Current `BranchSettings` evidence does not show a per-branch `default_warehouse_id` setting.

**Correct classification:** Default Warehouse is **not a missing capability**. AWJ currently has a tenant-level default. A Daftra-style per-branch default is a distinct candidate and requires a decision only after completing warehouse-resolution tracing.

No precedence rule such as user-default → branch-default → tenant-default is approved yet; do not invent one during implementation.

## 5. Stocktake — confirmed P1 concurrent-movement defect

Current workflow is confirmed as **Open → Snapshot → Count → Post**.

- Opening a stocktake snapshots warehouse stock into `system_quantity`.
- `counted_quantity = null` means uncounted and is intentionally different from zero.
- Posting calculates the adjustment from `counted_quantity - system_quantity`.
- Posting uses `applyReceipt` or `applyIssue` for the stored difference.
- Posting locks the Stocktake record and runs stock movements + accounting journal within a transaction, protecting against double posting and partial accounting writes.
- However, current posting does **not** reconcile legitimate stock movements that occurred between snapshot/open and post.

Example: snapshot 100, physical count 90, then a legitimate sale of 10 occurs before posting. Current stock becomes 90, but the stored stocktake difference remains -10 and posting issues another 10, producing 80 instead of 90.

**Classification:** **P1 — Stocktake Snapshot / Concurrent Movement Reconciliation — Confirmed Finding.**

Accounting currently uses inventory account 1140 and inventory variance account 5180; adjustment cost is based on `avg_cost` at posting time. This P1 must preserve GL↔inventory-subledger reconciliation and transaction safety.

## 6. SKU namespace vs barcode namespace — do not conflate

### SKU

- `Product` is BranchShareable and product visibility can be controlled through `share_products`.
- Product numbering itself is company-wide.
- The original products migration contains `UNIQUE (tenant_id, sku)`.
- Branch-sharing logic previously inspected contains behavior/comments around duplicate SKU handling when products are not shared.

These facts appear potentially inconsistent until all later branch/product migrations are traced. **Do not yet assert final SKU uniqueness semantics from the original migration alone.** The current effective schema must be reconciled first.

### Scannable barcode

- `ProductBarcode` is CompanyWide.
- Its source explicitly states that alternate barcode uniqueness is tenant-wide because a scanner does not have branch context with which to disambiguate a repeated code.

This strongly supports the approved invariant that the **scannable barcode namespace must be unambiguous tenant-wide**. However, full enforcement of the union `products.barcode ∪ product_barcodes.code` still requires migration/write-path verification; uniqueness inside only one table is not enough.

**Audit direction:** treat SKU identity policy and scanner barcode identity policy separately. Do not force them into one namespace rule without evidence.

## 7. Inventory Opening — direct model evidence retained

`InventoryOpeningLine` is confirmed in current `main` with tenant, opening, product, warehouse, quantity, unit cost, total cost, notes, and position. `total_cost` is stored intentionally and used for inventory application/journal matching. This reinforces the existing boundary:

- Product Catalog Import = Master Data only.
- Inventory Opening = inventory + accounting domain.

The exact current import class/path, 2,000-row cap, Draft/Review/Post workflow, posting locks, and 1140/3130 journal behavior must be traced from actual current routes/controllers/services/tests before those implementation details are re-certified. A failed search for a guessed `InventoryOpeningImport` class is not evidence of absence.

## 8. Priority reconciliation

### P1 confirmed/hardening set currently retained

1. Minimum Sale Price after all economically applicable discounts.
2. Central Sensitive Cost Authorization & Data Redaction.
3. Purchase Return UOM / Historical Base Quantity.
4. Purchase Return Inventory Valuation / GL Reconciliation.
5. Stock Permit UOM / Base Quantity.
6. Stocktake Snapshot / Concurrent Movement Reconciliation.
7. UOM Referential Integrity & Product Template Lifecycle.
8. Tenant-wide scannable Barcode Namespace Integrity — exact cross-table enforcement still to verify.
9. Product Lifecycle Reference Integrity.

Purchase Return negative-stock policy remains previously closed/PASS and is not reopened by this addendum.

### P2 decisions that must not be lost

- Serial/Lot/Expiry.
- **Quantity-tier Pricing** — correction from the parent audit’s erroneous P3 placement.
- Stock Requests / Approval / partial or one-to-many fulfillment through Stock Permits; request itself has no stock/GL effect.
- Reservations / Available Quantity.
- Warehouse Reorder / Low Stock Center.
- Movement Source Drilldown.
- Multi-UOM stocktake is P2 after P1 concurrency correctness.

### P3 / deferred

- Bundles/Kits = P3.
- Manufacturing/BOM = deferred.

### Large imports

Preserve the historical approved classification that **Large Catalog & Inventory Opening Import Infrastructure** was once P1. The later safety-first audit ordering places accounting/security/correctness defects ahead of it. Final audit closure must explicitly distinguish:

1. priority/classification history; and
2. final PR execution order.

It must not silently rewrite the earlier decision.

## 9. Items requiring actual `main` tracing before final classification

- Effective current SKU uniqueness after all branch-related migrations.
- Cross-table primary + alternate barcode collision enforcement.
- Default Warehouse resolution through operational documents and whether per-branch behavior exists elsewhere.
- `products.view_cost` definition, default grants, backend enforcement, exports/history/filter/sort inference.
- Inventory Opening import implementation and exact 2,000-row limit.
- Complete Product lifecycle reference map and DB FK delete behavior.
- Product Custom Fields.
- Inventory Settings Audit Trail.
- Available/Reserved current implementation.
- Stocktake basis/cutoff settings beyond the confirmed snapshot workflow.
- Weighted barcode current implementation.
- Product variants/attributes current implementation.

None of the above may be called “missing” solely because a text search returns no result.

## 10. No implementation authorization

This reconciliation changes audit evidence/classification only. It does **not** authorize P1 implementation, merge, deploy, schema changes, accounting-rule changes, or production release. Formal audit closure and Safwan’s explicit approval remain required.
