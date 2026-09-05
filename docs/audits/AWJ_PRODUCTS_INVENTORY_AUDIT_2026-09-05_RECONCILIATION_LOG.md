# أَوْج / AWJ ERP — Products & Inventory Audit Reconciliation Log

**Date:** 2026-09-05  
**Parent audit:** `docs/audits/AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md`  
**Repository:** `safwan5001-source/Nebrax`  
**Scope:** append-only reconciliation of findings discovered after the current parent-audit snapshot.  
**Status:** Documentation only. No implementation, merge, deploy, or production release is authorized.

> This log is part of the Products & Inventory audit package and must be folded into the parent audit at formal Audit Closure. It exists to prevent any confirmed finding or prior approved decision from being lost while the parent document remains a long living record.

---

## A. Methodology correction — permanent audit rule

The following rule supersedes any earlier classification that relied only on an assumed path, filename, or unsuccessful string search:

1. Any AWJ-side question that can be verified from code, migrations/schema, tests, routes/API, settings, or UI implementation must be inspected against actual `main` before it is classified.
2. `Pending Verification` means a verification attempt was genuinely blocked or remains incomplete; it must not mean “not inspected yet”.
3. A failed filename/string/code-search result is **not evidence of absence**.
4. Presence may be confirmed from direct implementation evidence. Absence requires repository-wide domain tracing.
5. Earlier confirmed findings remain confirmed unless contradicted by stronger current evidence.
6. Earlier explicitly approved decisions remain Approved Decisions even when not implemented.
7. Earlier “missing/not found/absent” conclusions based on stale paths or inconclusive searches must be selectively revalidated; do not restart the full audit.
8. Maintain a correction trail: prior assumption → current `main` evidence → corrected classification.

---

## B. Repository path correction

### Prior assumption

Some early probes used `nibras-app/app/...` paths and received 404/not-found results.

### Current `main` evidence

The active Laravel source is at repository root (`app/`, `database/`, `routes/`). `app/Models/Product.php`, `app/Models/InventoryOpeningLine.php`, inventory services/controllers, and supporting infrastructure exist there.

### Corrected status

**Confirmed correction.** A stale/wrong path is not evidence that a capability is absent. Findings whose only evidence was an old-path miss must be selectively revalidated.

---

## C. Product SKU automatic numbering

### Current `main` evidence

`Product` uses `GeneratesDocumentNumbers`, declares `sku` as its numbering column, and explicitly declares product numbering as non-branch-numbered. The SKU sequence is continuous rather than yearly-reset.

`GeneratesDocumentNumbers` is the shared numbering layer. It uses a tenant/branch anchor lock to serialize concurrent generation, uses the model’s declared scope, and derives the next number from the maximum existing sequence rather than `count()+1`.

The product numbering catalog/settings integration provides product prefix configuration; the default product prefix is `SKU`.

### Corrected status

**Confirmed Existing Capability / MATCH.** AWJ already has automatic SKU numbering. Daftra’s “Next Auto-Generated Product Number” is not evidence that AWJ lacks auto numbering.

### Remaining verification

Before claiming full parity on configurability, distinguish:

- prefix/suffix/format configurability — existing numbering infrastructure;
- direct administrator control over the **next numeric sequence value** — must be separately verified.

Do not collapse these into one claim.

---

## D. SKU scope vs Branch Sharing — schema reconciliation required

### Current evidence

`Product` is `BranchShareable`; `share_products` controls whether products are shared across branches, while product number generation itself is company/tenant-wide rather than branch-numbered.

The original products migration creates `UNIQUE (tenant_id, sku)`.

Branch-sharing settings logic previously inspected contains duplicate-SKU checks when re-enabling product sharing, implying a design in which branch-separated catalogs may contain duplicate SKUs.

### Status

**Confirmed inconsistency requiring schema/domain reconciliation.** Do not yet claim either tenant-wide SKU uniqueness or branch-aware SKU uniqueness as final current behavior until later migrations/current effective schema are traced.

### Important distinction

SKU identity policy and scannable-barcode identity policy must not be forced to use the same namespace merely because both identify products.

---

## E. Primary + alternate barcode namespace

### Current `main` evidence

`ProductBarcode` is `CompanyWide`. Its source comment explicitly states that alternate barcode uniqueness is tenant-wide because a scanner does not have branch context to resolve an ambiguous repeated code.

Alternate barcode behavior supports product, code, unit name, default quantity, label, and creator. POS alternate-barcode resolution is part of the existing foundation.

### Approved invariant retained

> `Primary Product Barcode ∪ Alternate Product Barcodes` must resolve uniquely within the Tenant scanning namespace.

### P1 hardening still required

It is not enough for alternate barcodes to be unique only inside `product_barcodes`. All write paths must prevent collisions across the union of:

- `products.barcode`
- `product_barcodes.code`

Cover product create/update/import, alternate-barcode writes, and future workbook import.

**Priority:** P1 — Barcode Namespace Integrity.

---

## F. Default Warehouse — corrected classification

### Prior tentative classification

Default Warehouse had been treated as potentially absent because `BranchSettings` did not expose `default_warehouse_id` and text search was inconclusive.

### Current `main` evidence

`Warehouse` contains `is_default` and `is_active`, plus `Warehouse::default()`.

Current behavior:

- choose the warehouse marked `is_default=true`;
- otherwise fall back to the first active warehouse ordered by code;
- the first warehouse created for the tenant becomes default automatically;
- setting another warehouse as default clears the flag from other warehouses;
- the default warehouse cannot be deleted until another default is selected;
- a warehouse may belong to a branch (`branch_id`) or be central (`branch_id=null`).

### Corrected status

**Confirmed Existing Capability:** tenant/company-level Default Warehouse exists.

**Needs Decision / P2 candidate:** independent Default Warehouse per Branch is not established by current evidence. `BranchSettings` currently does not contain `default_warehouse_id`.

Do not describe Default Warehouse as a total gap.

### Unapproved design candidate

A possible future resolution precedence such as user-allowed warehouse → branch default → tenant default → explicit selection is **not approved yet** and must not be treated as a requirement until deliberately decided.

---

## G. Stocktake — P1 concurrency defect confirmed

### Current `main` evidence

Current workflow is materially:

> Open → Snapshot → Count → Post

`StocktakeLine` stores `system_quantity`, `counted_quantity`, `unit_cost`, and `difference_value`. `counted_quantity = null` means “not counted” and is distinct from zero.

At opening/snapshot time, the warehouse quantity is captured into `system_quantity`. At posting, the service applies the stored difference based on:

> `counted_quantity - system_quantity`

The posting path does not reconcile that snapshot against legitimate inventory movements that occurred after snapshot and before Post.

The transaction locks the Stocktake document to prevent double-post and performs posting/movements/journal atomically, but locking the Stocktake row does not solve concurrent inventory movement between Snapshot and Post.

### Demonstrated failure mode

- snapshot = 100
- physical count = 90
- legitimate sale before Post = 10 → current stock becomes 90
- stale stocktake difference remains -10
- Post issues another 10 → stock becomes 80 instead of 90

### Accounting behavior verified

Stocktake posting uses current average cost at posting. Inventory variance accounting uses inventory control 1140 against inventory variance 5180 according to surplus/shortage direction.

### Status

**Confirmed P1 — Stocktake Snapshot / Concurrent Movement Reconciliation.**

This is an inventory-integrity defect, not a cosmetic Stocktake V2 request.

### Required invariant

Posting a stocktake must not double-apply legitimate movements that occurred after its snapshot. The eventual fix must define an explicit reconciliation/version/cutoff policy while preserving transactionality, historical auditability, and GL↔subledger integrity.

---

## H. Inventory Opening — direct model evidence

### Current `main` evidence

`InventoryOpeningLine` exists and directly stores:

- `tenant_id`
- `inventory_opening_id`
- `product_id`
- `warehouse_id`
- `quantity`
- `unit_cost`
- `total_cost`
- `notes`
- `position`

Quantity/cost fields are integer-cast. Product and Warehouse are stored references.

The source explicitly documents `total_cost` as stored rather than re-derived because it is passed to inventory receipt logic and summed for the journal, preserving agreement between inventory account 1140 and the inventory movement/subledger.

### Status

**Confirmed:** Inventory Opening is a financial/inventory domain and must remain separate from Product Catalog Import.

### Product lifecycle implication

Because `InventoryOpeningLine` directly carries `product_id`, product lifecycle/deletion reference coverage must include it. This strengthens the existing P1 Product Lifecycle Reference Integrity finding.

### Still to trace from actual `main`

- exact importer/controller/service route;
- exact current 2,000-row cap implementation;
- Template → Inspect → Preview → Apply Draft → Review → Post semantics;
- proof that no stock/GL occurs before Post;
- posting locks, double-post protections, transaction behavior, prior-movement protections;
- exact 1140 / 3130 opening journal path.

An unsuccessful search for an assumed class name such as `InventoryOpeningImport` is not evidence of absence.

---

## I. Product lifecycle reference integrity — P1 retained and strengthened

Earlier audit found manual reference counting in `ProductLifecycleService` and identified missing coverage for `InventoryOpeningLine`.

Current direct model inspection confirms that `InventoryOpeningLine` indeed carries `product_id`.

**Status:** P1 remains valid, not speculative.

Next closure step is repository-wide tracing of product-bearing models/migrations/FKs and comparison against lifecycle reference counting. DB foreign-key behavior/soft deletes must be reviewed as the final safety layer.

DoD remains:

> Every new `product_id` reference is incomplete until lifecycle/deletion behavior is explicitly reviewed.

---

## J. Sensitive cost permission — status discipline

`products.view_cost` default role grants remain **Pending Verification**.

Earlier exact-string searches were inconclusive and must not be interpreted as proof that the permission or default grant is absent. Closure requires tracing actual permission bootstrap/seeders/role defaults/migrations/tests.

The approved P1 security policy remains unchanged:

- backend authorization, not UI-only hiding;
- protect purchase price, average cost, profit margin, stock value, movement unit/total cost and equivalent derived cost surfaces;
- protect API resources, activity/history diffs, exports, valuation, and hidden filter/sort inference;
- non-cost product edit: `products.manage`;
- cost edit/import: `products.manage` + cost-view authorization;
- unauthorized operational exports may retain quantities/warehouses but omit cost/valuation data.

---

## K. Available / Reserved — current-state discipline

No reliable current implementation evidence has yet established a durable `StockReservation` domain or equivalent reserved/available state. Searches for expected names were inconclusive.

Therefore the correct status is **not “Confirmed Gap” yet**.

The prior Approved Decision remains:

> On Hand = physical/subledger quantity  
> Reserved = active durable commitments  
> Available = On Hand − Active Reservations

Reservations are P2. Reserved quantity must not be a manually editable stock field; lifecycle must be tied to source documents.

Before final current-state classification, trace inventory availability services, models/migrations, document commitments, and settings.

---

## L. Product Custom Fields and Inventory Settings Audit Trail

Daftra benchmark review established mature product custom fields and settings activity logging.

For AWJ, unsuccessful searches are insufficient to declare either feature absent.

Current status for both:

**Pending current-state repository-wide domain tracing / then Needs Decision if genuinely absent.**

Do not promote either to P1 without an AWJ-specific correctness/security reason.

---

## M. Priority reconciliation — preserve prior decisions

### Corrected classification

**Quantity-tier Pricing = P2**, not P3.

The parent audit snapshot currently contains an incorrect P3 classification for this item. This log explicitly corrects it pending consolidation into the parent record.

### Other preserved classifications

**P2:**

- Serial/Lot/Expiry
- Quantity-tier Pricing
- Stock Requests / Approval / Fulfillment
- Reservations / Available
- Warehouse Reorder / Low Stock Center
- Movement Source Drilldown

**P3:**

- Bundles/Kits
- advanced media portability package where applicable

**Deferred:**

- Manufacturing/BOM

### Large Import priority history

Earlier approved sequencing classified **Large Catalog & Inventory Opening Import Infrastructure** as P1. Later audit refinement placed accounting correctness, inventory integrity, and security defects ahead of large-import completion work.

Do not silently erase either fact.

Correct interpretation:

- historical priority classification: P1 existed;
- current execution recommendation: correctness/security/integrity P1s should be closed first unless Audit Closure identifies a safety reason to restore Large Import ahead of them;
- priority label history and final PR execution order are separate concepts.

---

## N. Current P1 register after reconciliation

The working P1 correctness/security register is:

1. Minimum Sale Price after all economically applicable discounts, including allocated invoice/header discount.
2. Central Sensitive Cost Authorization & Data Redaction.
3. Purchase Return UOM / Historical Base Quantity.
4. Purchase Return Inventory Valuation / GL Reconciliation.
5. Stock Permit UOM / Base Quantity.
6. Stocktake Snapshot / Concurrent Movement Reconciliation — **now directly confirmed from posting path**.
7. UOM Referential Integrity & Product Template Lifecycle.
8. Tenant scanning namespace integrity for Primary + Alternate Barcodes.
9. Product Lifecycle Reference Integrity — **InventoryOpeningLine reference directly confirmed**.

Purchase Return negative-stock enforcement remains separately closed as PASS.

Large Import retains its historical P1 classification record but is currently sequenced after the correctness/security register pending formal closure.

---

## O. Provisional execution sequence — corrected, not authorized

No implementation is authorized by this sequence. It is a planning artifact only.

1. Minimum Sale Price final-effective-price enforcement.
2. Cost Authorization / redaction.
3. Purchase Returns hardening: UOM/base + valuation/GL together.
4. Stock Permit UOM/base.
5. Stocktake concurrent-movement reconciliation.
6. UOM lifecycle + product template + barcode namespace hardening.
7. Product lifecycle reference integrity.
8. Multiple UOM & Barcode Completion epic.
9. Import Jobs + Large Catalog/Lossless Workbook infrastructure.
10. Inventory Workspace / warehouse-aware reporting.
11. Serial/Lot/Expiry.
12. Quantity-tier Pricing.
13. Reservations/Available.
14. Stock Requests/Approval/Fulfillment.
15. Low Stock/Warehouse Replenishment.
16. Movement Source Drilldown.
17. Bundles/Kits.
18. Manufacturing/BOM deferred.

Final ordering requires Audit Closure. No merge/deploy follows automatically.

---

## P. Remaining verification queue before Audit Closure

Work in larger batches; do not create chat churn for each probe.

1. Effective current product SKU uniqueness schema after all later branch migrations.
2. Full Primary + Alternate Barcode cross-table uniqueness enforcement and migrations/tests.
3. `products.view_cost` permission bootstrap/default role grants/tests.
4. Inventory Opening routes/controller/service/importer/tests and exact 2,000 cap.
5. Full Product lifecycle reference map: every product-bearing model/migration/FK vs `referenceCounts()`.
6. Available/Reserved current implementation trace.
7. Stocktake date/basis/cutoff settings and any existing policy beyond the confirmed concurrency defect.
8. Product Custom Fields current implementation trace.
9. Inventory Settings audit-trail current implementation trace.
10. Weighted barcode current implementation trace before benchmark classification.
11. Product variants/attributes current implementation trace before target classification.
12. Default Warehouse per-Branch behavior: existing tenant default is confirmed; only branch-specific default remains undecided/unproven.
13. Reconcile all remaining prior-chat Approved Decisions with Daftra benchmark and current `main`.
14. Produce final finding→status→priority matrix and final PR order.

---

## Q. Guardrails

- Do not rebuild Inventory Core/V2.
- Do not implement P1 before formal audit closure and explicit task authorization.
- Do not Merge, Deploy, or Production Release without Safwan’s explicit approval.
- Do not change financial/accounting rules, APIs, or database behavior outside an explicitly approved implementation scope.
- Tenant Isolation, branch/warehouse correctness, base-UOM correctness, historical snapshots, GL↔subledger reconciliation, backend authorization, and backward compatibility remain mandatory.
