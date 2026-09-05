# أَوْج / AWJ ERP — Products & Inventory Audit Working Record

**Date:** 2026-09-05  
**Repository:** `safwan5001-source/Nebrax`  
**Audit basis:** actual `main` source code + AWJ UI screenshots supplied during the audit + prior approved project discussions/decisions + Daftra as a competitive benchmark where explicitly reviewed.  
**Status:** Working audit record — implementation has **not** started. No merge/deploy/production release is authorized by this document.

---

## 1. Executive conclusion

AWJ already has a substantial Products & Inventory core. It should **not** be rebuilt as a new Inventory Core/V2 from scratch.

The correct program is:

> **Products & Inventory Completion & Hardening**

The existing foundation includes product catalog, categories/brands, inventory tracking fields, warehouses, warehouse balances, permanent stock movements, moving-average costing, perpetual inventory, sales COGS, purchase receipts, returns foundation, stocktake, stock permits/transfers, opening inventory, POS integration, UOM templates, alternate barcodes, price lists, import/export, and inventory reporting.

The highest priority is to close correctness/security/integrity gaps before adding large-import, serial/lot/expiry, reservations, advanced replenishment, or broader UX.

---

## 2. Audit principles and invariants

1. Actual `main` code is the source of truth for **current implementation state**. Prior explicitly approved project decisions remain source-of-truth for **target behavior/requirements** even when not yet implemented.
2. Daftra is a benchmark, not a checklist. AWJ features are not removed merely because Daftra lacks them.
3. Master Data, Stock State, and Financial Transactions remain separate.
4. Product catalog import must not directly create inventory balances or accounting entries.
5. Every stock movement quantity is a **base inventory quantity**.
6. Historical document UOM factors must remain immutable snapshots.
7. Product deletion policy: a referenced product is deactivated, not deleted.
8. Inventory GL control account and inventory subledger must reconcile.
9. Sensitive cost data must be protected at the backend, not merely hidden in UI.
10. Tenant isolation and branch/warehouse correctness are mandatory.
11. Quantity truth is warehouse/subledger state. Product master may display On Hand but product edits must never be a stock-adjustment path.
12. Moving Average Cost remains global per product under the current architecture; do not introduce per-warehouse costing without a deliberate costing redesign.
13. Live operational references must remain valid when UOM/catalog structures change; historical document snapshots are immutable.
14. No Merge/Deploy/Production Release without explicit approval.

### Evidence/status vocabulary used by this working record

- **Approved decision** — explicitly settled in prior project discussion; preserve unless deliberately reopened.
- **Confirmed finding** — verified against AWJ implementation during this audit.
- **Daftra benchmark** — externally observed/documented comparison, not automatically an AWJ requirement.
- **Needs Decision** — candidate/capability discovered but not approved as an AWJ requirement.
- **Pending Verification** — do not state as fact until directly verified.

---

## 3. Product master — verified foundation

`Product` supports tenant/branch, SKU, primary barcode, Arabic/English names, type/base unit, description, category/brand, unit template, reorder level, supplier, sales/COGS accounts, minimum sale price, discount fields, profit margin, tags/notes, sale/purchase price, tax, inventory tracking, quantity, average cost and active status. Relations include movements, alternate barcodes, media, category, brand and unit template.

Product create/update validates tenant-owned references and accounting account types. Selecting a unit template forces the product base unit to the template base unit.

General product RBAC is present: read operations use `products.view`, writes use `products.manage`.

`ProductLifecycleService` correctly keeps catalog edits separate from inventory/accounting. Used products are intended to be deactivated rather than deleted. It blocks type/tracking identity changes after inventory use, but lifecycle reference coverage and UOM-template lifecycle still have gaps documented below.

**Approved boundary:** Product Master and Inventory State are distinct. Reading On Hand/warehouse availability from a product view is allowed; editing product master must not directly alter inventory balances, valuation, or GL.

---

## 4. Categories, brands and media

Categories are hierarchical, tenant validated, cycle protected, sibling-name unique, support image/color, persistent private storage, and block deletion while products/children reference them. Brands are flat managed entities with uniqueness, active state and deletion protection. Both foundations are strong.

Product media APIs support list/upload/download/delete, up to 8 images, persistent private storage, and POS first-image exposure. Bulk media portability is missing; future recommendation is workbook + image files + manifest in a package/ZIP (P3), not binary images embedded in XLSX.

Lifecycle/deletion protection is part of the domain contract: referenced master data must not be destructively removed in a way that breaks historical or draft transactions.

---

## 5. Units of measure (UOM)

`UnitTemplate` defines a base unit plus alternative units with **canonical factors directly to base**. Example: Piece=1, Box=12, Carton=120. Do not depend on chained conversions such as Carton→Box→Piece at posting time. Historical commercial lines store entered quantity, `unit_name`, and historical `unit_factor`; stock uses base quantity.

Critical invariant:

> Every `StockMovement.quantity` must be BASE INVENTORY QUANTITY.

No independent Default Sales UOM or Default Purchase UOM fields were found. Approved future model:

> Base Inventory Unit ≠ Default Sales UOM ≠ Default Purchase UOM

UOM lifecycle has a P1 gap: template alternatives can be changed/deleted while live references such as alternate barcodes and price-list items can point to unit names; product lifecycle does not protect `unit_template_id` / base-unit changes. Historical documents are safer because they snapshot factors, but live references can dangle logically.

---

## 6. Multiple barcode

Alternate barcode backend/API is real. Each barcode supports code, product, unit, default quantity, label and creator. POS resolves alternate barcode to its commercial unit plus `default_quantity`.

Semantic rule:

> Barcode = what was scanned; Unit = commercial unit; Default Quantity = how many commercial units per scan; Unit Factor = base units per commercial unit; Unit Price = commercial unit price.

`default_quantity` must not be treated as conversion factor.

### P1 — Tenant-wide Primary + Alternate Barcode Namespace Integrity

Alternate-barcode creation checks conflicts against both primary and alternate barcodes, but primary product barcode validation/import does not consistently check `ProductBarcode.code`.

Required invariant:

> `Primary Barcode ∪ Alternate Barcodes` is unique **within the tenant**.

This is not cross-tenant global uniqueness. Tenant isolation must be preserved.

Must cover product create/update/import, alternate-barcode writes, and future barcode workbook import.

Backend/API and POS scanning exist; Product UI management and alternate-barcode import/export are incomplete/missing.

Recommended workbook:

- **Products**: one row/product, primary barcode
- **Barcodes**: zero-to-many alternate rows

Absence from Barcodes must not imply deletion; deletion should be explicit.

### Daftra benchmark reconciliation

Earlier user testing showed that the tested Daftra **product import/export round-trip** did not preserve multiple barcodes adequately. Later official Daftra review showed a **separate multiple-barcode Excel import capability**. These are not contradictory claims: the separate import capability does not prove that Product Export → Product Import is a lossless multi-barcode round-trip.

AWJ target: explicit, lossless, tenant-safe multi-barcode portability rather than copying fragmented benchmark behavior.

---

## 7. Pricing

Existing: base sale price, explicit price lists, per-product/per-unit list items, customer default list, POS server-authoritative pricing, minimum sale price, authorized override with reason/actor snapshot, historical line prices.

Alternative UOM pricing is not blindly derived from factor × base price. Preserve this.

Missing P2: product-level default UOM prices. Approved precedence:

> Product Default UOM Price → Price List Override → Customer/POS resolved price

Do not auto-derive package price from conversion factor.

Purchase pricing correctly distinguishes commercial quantity/unit price from base stock quantity. Purchase discounts reduce acquisition cost and inbound shipping increases it. `purchase_price` is master/default commercial price; `avg_cost` is accounting valuation and must remain distinct.

### P1 — Minimum Sale Price bypass through invoice/header discount

Direct audit after the original working record confirmed that line minimum-price validation occurs before invoice/header discount, while the header discount later reduces invoice net sales and is distributed economically across revenue. Therefore lines can individually pass the floor and then fall below it after header discount.

Required invariant:

> Effective final sale price after all economically applicable discounts, including allocated invoice/header discount, must not fall below `minimum_sale_price` unless the existing authorized minimum-price override path is used.

Fix belongs in the central invoice pricing/service policy, not as a controller-only guard. Do not alter tax, COGS, UOM, or accounting semantics outside this scope.

---

## 8. Product import/export contract

`ProductImportFields` is the single source of truth for the flat product contract.

Current round-trip covers AWJ ID, SKU, names, type, unit, unit template, category, brand, primary barcode, sale/purchase/min prices, tax, track inventory, reorder, tags, description, internal notes and active status. `type` and `track_inventory` are update-locked for existing products.

Correctly excluded from product master import: quantity on hand, average cost, initial quantity and stock movements.

The Product model/UI/API is richer than flat round-trip. Not all of supplier, sales/COGS account mappings, discount fields, profit margin, alternate barcodes and media are preserved. Therefore:

> Current round-trip is lossless for its declared flat catalog contract, but not lossless for the complete AWJ Product Master.

Keep `catalog` export distinct from `round_trip`; catalog may contain reporting quantities/costs and must not become a stock re-import source.

Approved future lossless workbook direction:

- `Products` — one row per product/master fields
- `Barcodes` — zero-to-many alternate barcode rows
- `Unit Prices` — after product-level default UOM pricing exists
- Media — separate files + manifest/package, not binary XLSX cells

Stock balances never belong in the Product Master round-trip workbook.

---

## 9. Product import engine and >2,000 products

Current engine strengths:

- Inspect → Preview → Apply
- Preview writes nothing
- Apply re-reads/revalidates
- Create/Update/Upsert
- matching by AWJ ID then SKU; not name
- tenant-scoped matching
- duplicate detection for ID/SKU/primary barcode
- safe blank semantics
- category/brand policies with deferred create-on-apply
- unit templates not silently auto-created
- transaction-protected current apply
- batch-window foundation

The current Product Catalog Import has a 2,000-row synchronous limit. Raising a constant to 50,000 is not acceptable.

Recommended future epic:

> **Large Catalog Import Jobs & Lossless Product Workbook**

Architecture: durable upload → import job → whole-file validation → frozen mapping/options → deterministic chunks → persistent progress/errors → resumable/idempotent apply → cancellation → live conflict revalidation.

Multi-sheet workbook should eventually include Products, Barcodes, and Unit Prices, with whole-workbook dependency validation before writes.

**Approved accounting boundary:** unlike benchmark systems that may accept stock quantity in Product Import, AWJ Product Catalog Import remains Master Data only. Quantity/value/GL belong to Inventory Opening or later stock transactions.

---

## 10. Inventory opening and import separation

Inventory Opening is a separate accounting domain and must remain separate from Product Catalog Import.

> Catalog Import → master data only
> Inventory Opening Import → Product + Warehouse + Quantity + Unit Cost + opening document/date

Future import-job infrastructure may be shared, but domain processors remain separate. Product import must never become a shortcut for stock/accounting.

Opening inventory is currently base-unit oriented; multi-UOM opening input/import is P2.

The prior audit discussion recorded a 2,000-row synchronous limit in the Opening Import area. Before changing that implementation, re-locate the exact current `main` source path/constant and test semantics; do not blindly raise it. Large financial/stock imports should use durable job architecture with review and controlled posting.

Approved conceptual workflow remains staged/reviewable: import/inspect/preview or draft preparation must not create stock or GL effects until the explicit posting stage.

---

## 11. Product lifecycle reference integrity — P1

`ProductLifecycleService::referenceCounts()` checks many references manually, but `InventoryOpeningLine` directly has `product_id` and is not included.

Risk: Draft opening references product → no movement yet → product deletion may be allowed → draft points to soft-deleted product.

Required:

- add missing direct reference coverage
- audit every product-bearing transactional entity
- use DB referential integrity as final safety line
- keep counts for UX
- future DoD: every new Product reference must review lifecycle/deletion behavior

This DoD applies to future domains too: adding a new `product_id` reference is incomplete until lifecycle/deletion behavior is explicitly reviewed.

---

## 12. Warehouse and inventory core

AWJ already has a real warehouse core. `ProductWarehouseStock` stores per-product/per-warehouse quantity behind global product quantity.

Current architecture:

> Quantity = per warehouse + aggregate global
> Moving Average Cost = global per product

Do not introduce per-warehouse average cost without a deliberate costing redesign.

Warehouse resolution and explicit warehouse validation are present. Legacy no-warehouse behavior exists for backward compatibility. Future P2 policy may require warehouse for new tracked documents after setup while preserving historical compatibility.

`InventoryService` implements perpetual inventory, moving-average costing, permanent movements, warehouse quantity updates, sales COGS, purchase receipts and opening inventory. Preserve this core.

**Standing decision:** do not build Inventory Core/V2. Correctness/security hardening comes first; then expose the existing core through a mature warehouse-aware workspace.

---

## 13. Negative stock policy

Tenant setting `inventory.allow_negative_stock` exists. Central availability logic can check selected warehouse rather than only global quantity.

Sales/Invoice COGS converts to base quantity and checks availability before issue, so POS/invoice sales do not show a UOM negative-stock bypass.

`InventoryService::applyIssue()` intentionally does not universally enforce stock availability because reconciliation/correction operations may need controlled bypass.

Invariant:

> Operational issue must enforce negative-stock policy; reconciliation/correction may bypass only intentionally and audibly.

### Stock Permit / Transfer verification

`StockPermitService` explicitly checks availability before both Issue and Transfer source movements, including selected warehouse quantity when warehouse rows exist. No operational negative-stock bypass was found in Stock Permit/Transfer.

Legacy pre-warehouse stock can fall back to global quantity intentionally.

Stock Permit still has a separate P1 UOM problem.

### Purchase Return verification — PASS for negative-stock enforcement

Subsequent audit closed the Purchase Return negative-stock question as **PASS**. This PASS applies only to negative-stock enforcement; it does not close the separate Purchase Return UOM/historical-base-quantity or valuation/GL reconciliation P1 findings.

---

## 14. Stock permits and transfers

Implemented: receipt/issue/transfer, draft→posted, source/target warehouses, stock+accounting transaction, issue at average cost, transfer out/in at same cost, no GL for same-branch transfer, branch-dimensional inventory reclassification for cross-branch transfer, source metadata.

### P1 — Stock Permit UOM / Base Quantity

`StockPermitLine.quantity` is treated directly as stock quantity and has no historical `unit_name`/`unit_factor` snapshot. Commercial UOM input must convert to immutable base quantity at posting.

### P2 — Stock Requests / Approval / Fulfillment

Approved target:

> Stock Request → Approval → Fulfillment → one or more/partial Stock Permits

A Stock Request itself has **no stock or GL effect**. Partial fulfillment is allowed by design. Invoice→Stock Permit approval/separation policy, if introduced, remains a separate workflow decision and must not be inferred merely from Daftra behavior.

---

## 15. Returns

Sales-return inventory handling is comparatively strong and can use historical invoice UOM factor; restock vs damage/non-restock is separated. Tenant setting for restocking sales returns remains part of the reviewed settings surface.

### P1 — Purchase Return UOM / Historical Base Quantity

Purchase return lines do not preserve equivalent historical UOM/base-quantity semantics. Returning 1 carton originally factor 24 can risk issuing 1 base piece.

### P1 — Purchase Return Inventory Valuation / GL Reconciliation

Supplier credit/commercial return value and inventory carrying value can diverge. Required invariant:

> Δ Inventory GL 1140 = Δ Inventory Subledger

These two purchase-return fixes should ship together.

Purchase Return negative-stock enforcement has separately been verified PASS and must not be conflated with these unresolved correctness issues.

---

## 16. Stocktake

Stocktake is base-unit oriented; multi-UOM counting UX is P2.

### P1 — Stocktake Snapshot / Concurrent Movement Reconciliation

Opening stocktake snapshots warehouse quantity; intervening movements may occur before posting. Posting stale counted-minus-snapshot can be wrong without reconciliation/version validation.

Stocktake is a correction/reconciliation path, so controlled negative correction is conceptually separate from operational negative-stock policy.

The target is hardening of the existing stocktake foundation, not a Stocktake V2 rebuild.

---

## 17. Inventory reporting / workspace

Current `/inventory` is primarily a global Inventory Balance / Valuation Report, not a full Warehouse Inventory Workspace. It returns product-level quantity, average cost, stock value and total inventory value. Current filter/report layer lacks warehouse dimension.

Web page loads the full result then searches/filters/sorts/paginates client-side.

### P2 — Server-side Inventory DataTable

Required for 20k–50k catalog scale. Reuse existing server-side filter concepts used by export.

### P2 — Warehouse dimension

Core already has per-warehouse balances; UI/reporting must expose Product × Warehouse.

### P2 — Low Stock Center

`reorder_level` exists but mature low-stock/reorder workspace is missing. First stage:

> In Stock / Low Stock / Out of Stock / Negative Stock

Later Product×Warehouse reorder point/target, preferred supplier and lead time.

### P2 — Movement Source Drilldown

Movement model already stores warehouse and source type/id. UX/API should expose normalized source/document drilldown rather than only type/quantity/notes.

### Daftra benchmark implication

Daftra review confirmed mature warehouse-aware valuation/movement reporting and source drilldown patterns. This strengthens the P2 workspace/reporting gap but does not justify rebuilding the underlying AWJ inventory core or blindly cloning Daftra's report catalog.

---

## 18. Central sensitive cost authorization — confirmed P1

Confirmed sensitive surfaces include:

- Product list/show
- Product Activity diff
- Product export
- Inventory list/export
- Stock movement unit/total cost
- inventory valuation
- sensitive cost/value filters and sorting
- product update/import cost writes

Sensitive fields at minimum: purchase price, average cost, profit margin, stock value, movement unit cost, movement total cost. Sale price is not cost.

Generic `ProductResource` exposes cost/profit unless a POS-specific transient hide flag is set. General product routes use `products.view`, not centrally enforced `products.view_cost`.

Product Activity stores full dirty-field diff and its resource returns raw diff, so cost changes can leak through history.

Without cost permission, operational exports should remain possible but cost columns should be omitted. Inventory quantity/warehouse access should remain possible while valuation is removed.

Filtering/sorting by hidden cost/value fields must also be blocked to prevent inference side channels.

Approved initial write rule:

> non-cost edits = `products.manage`
> cost edits/import = `products.manage` + `products.view_cost`

Centralize the sensitive-field policy; do not scatter field lists across controllers/resources.

### Pending Verification — default role grants

Usage of `products.view_cost` has been found, but the complete source-of-truth/default role grants (Owner/Admin/Accountant/custom roles) were not conclusively proven during the audit. Do not assume role grants until directly verified.

### Daftra benchmark

Daftra exposes role-level cost-hiding capability. AWJ's target is intentionally broader/stronger: backend/API/export/activity/filter/sort/write protection, not merely hiding a visible cost column.

---

## 19. Product & Inventory settings — reviewed and future decision surface

Confirmed/reviewed AWJ settings include:

1. Serial/batch/expiry marked coming soon
2. Negative stock stop/allow with warnings (`inventory.allow_negative_stock`)
3. Show stock quantities; available quantity remains future-facing
4. Restock sales returns toggle

Keep useful AWJ-specific settings even if Daftra lacks them.

Previously discussed settings/capabilities that must remain visible in the roadmap rather than being silently lost include: Default Warehouse/warehouse-required policy, Stocktake basis/cutoff semantics, Stock Requests, Low Stock/Reorder, cost visibility/permissions, available/reserved quantities, future detailed tracking, and weighted-barcode capability. Items not yet approved as concrete behavior remain **Needs Decision**, not automatic requirements.

---

## 20. Future tracking, reservations, replenishment and variants

### P2 — Serial/Lot/Expiry

Approved target model:

- Tracking mode: Quantity-only / Lot / Serial
- Expiry policy: Off / Optional / Required
- Tracking balance identity: Product + Warehouse + Tracking Identity
- Sum of tracking balances must equal warehouse quantity
- Tracking quantities are base quantities
- Costing remains global moving average
- FEFO is an issue-selection rule, not valuation
- No negative quantity for a specific tracking identity

Daftra benchmark confirms Serial/Lot/Expiry is a real competitive capability. AWJ should implement it after P1 hardening, with AWJ's separated tracking/expiry model rather than blindly copying a combined enum.

### P2 — Reservations / Available Quantity

Future durable `StockReservation` records. Do not use an editable reserved-quantity field.

> On Hand = physical/subledger stock truth
> Reserved = active durable reservation commitments
> Available = On Hand - Active Reservations

Reservation lifecycle must be tied to the source document that creates/releases/consumes it.

### P2/P3 — Replenishment

P2: warehouse reorder point/target, preferred supplier, lead time, Low Stock Center and transfer-before-purchase suggestion.

P3: intelligent replenishment suggestions. No automatic PO initially.

### Needs Decision — Product Variants / Attributes

Color/size/other commercial variants are a separate domain from Serial/Lot/Expiry tracking identities. Do not mix `Red / XL / 42` with `Serial ABC123 / Lot L2405 / Expiry 2027-06` in one model. Daftra capability was observed; AWJ Product Variants/Attributes remains a future candidate until explicitly approved.

### Needs Decision — Weighted barcode

Weighted-barcode behavior was observed in the Daftra benchmark. Preserve it as a future candidate/settings decision; do not promote it to an AWJ requirement without explicit approval.

---

## 21. POS and cross-domain dependencies

Products & Inventory contracts are consumed by other AWJ domains and must remain end-to-end consistent.

### POS

Previously approved POS V2 dependencies include:

- barcode/UOM resolution must remain server-authoritative and base-quantity safe
- product card click adds to cart; Product Quick View is a separate read-only action
- Product Quick View may expose stock according to permission
- purchase price/cost and other sensitive information must not appear to a cashier without the required cost permission
- product image setting remains supported: image-on card with placeholder vs compact data-only card when images are off
- multiple barcode scanning must preserve Unit, Default Quantity, Unit Factor and Unit Price semantics

**P2 — POS/Product-UOM completion:** alternate-barcode resolution existing does not by itself prove complete cashier-driven commercial UOM switching. Future POS unit switching must use the same pricing, minimum-price, barcode, and base-stock contracts.

### Sales

Sales must preserve base quantity conversion, warehouse-aware negative-stock enforcement, final minimum-sale-price policy, historical UOM snapshots and correct COGS.

### Purchases

Purchases must preserve commercial entered quantity/unit price separately from base stock quantity; acquisition cost feeds inventory valuation while master `purchase_price` remains distinct from `avg_cost`.

### Returns

Returns must preserve historical UOM/base quantity, negative-stock policy where operational, and inventory GL/subledger reconciliation.

### Document processing / imports

Master data, stock state and financial transactions remain separated. Do not silently create Product/Supplier/Unit/Warehouse master data from transactional/document-processing flows unless an explicitly reviewed workflow permits it. Draft/review stages must not accidentally create stock/GL effects.

### Reporting

Reports must read the same stock/cost source-of-truth and enforce the same sensitive-cost policy as operational APIs.

---

## 22. Current confirmed P1 list

The previous P1 list is preserved and expanded with the subsequently confirmed minimum-price finding:

1. **Central Sensitive Cost Authorization & Data Redaction**
2. **Purchase Return UOM / Historical Base Quantity**
3. **Purchase Return Inventory Valuation / GL Reconciliation**
4. **Stock Permit UOM / Base Quantity**
5. **Stocktake Snapshot / Concurrent Movement Reconciliation**
6. **UOM Referential Integrity & Product Template Lifecycle**
7. **Tenant-wide Primary + Alternate Barcode Namespace Integrity**
8. **Product Lifecycle Reference Integrity**
9. **Minimum Sale Price after Invoice/Header Discount**

Closed verification item:

- Purchase Return negative-stock enforcement — **PASS**

Still pending direct verification and may refine scope/order:

- complete product FK/reference coverage beyond the already confirmed `InventoryOpeningLine` gap
- source-of-truth/default role grants for `products.view_cost`
- exact current Opening Import 2,000-row implementation path before changing it

---

## 23. Confirmed P2/P3 backlog

### P2

Alternate-barcode Product UI; Default Sales/Purchase UOM; Default Product UOM Prices; lossless multiple-barcode import/export; Large Catalog Import Jobs; multi-UOM stocktake/opening; server-side Inventory DataTable; warehouse Inventory Workspace; Low Stock/warehouse reorder; movement source drilldown; Stock Requests/Approval/partial fulfillment; Reservations/Available Quantity; Serial/Lot/Expiry; warehouse-required/default-warehouse policy where appropriate; default supplier UX/portability; POS commercial UOM switching; possible richer tax classification after tax audit.

### P3/later

Media migration package; quantity-tier pricing; intelligent replenishment; bundles; manufacturing/BOM deferred; accounting mapping portability only if real migration need exists.

### Needs Decision / future candidates — not silently promoted to backlog

Product Variants/Attributes; Weighted Barcode; any workflow that delays invoice stock effects into separately approved warehouse permits; other Daftra-only capabilities not explicitly approved for AWJ.

---

## 24. Provisional PR sequence

No implementation is authorized by this record. Final ordering remains subject to audit closure.

1. **PR-PRICE-1 — Minimum Sale Price after all economically applicable discounts**
2. **PR-INV-1 — Centralize Product & Inventory Cost Authorization**
3. **PR-INV-2 — Purchase Returns Hardening** (UOM/base quantity + valuation/GL together)
4. **PR-INV-3 — Stock Permit UOM / Base Quantity**
5. **PR-INV-4 — Stocktake Concurrent Reconciliation**
6. **PR-UOM-1 — UOM Referential Integrity + Product Template Lifecycle + Tenant Barcode Namespace**
7. **PR-PROD-LIFE-1 — Product Lifecycle Reference Integrity** (or isolated fold-in only if scope/tests remain clear)
8. Multiple UOM & Barcode Completion Epic
9. **PR-IMP-1 — Import Jobs Foundation + Large Catalog Workbook**
10. Inventory Workspace server-side/warehouse completion
11. Serial/Lot/Expiry
12. Reservations/Availability
13. Stock Requests/Approval
14. Low Stock/Replenishment
15. Movement source drilldown
16. Bundles
17. Manufacturing deferred

Do not begin this sequence until the Products & Inventory audit is formally closed and the user explicitly authorizes implementation.

---

## 25. Definition-of-done principles

As applicable: tenant isolation; branch/warehouse correctness; base-UOM invariants; accounting/subledger reconciliation; authorized/unauthorized tests; historical snapshots; rollback/transaction behavior; no weakening of financial/security tests; backward compatibility; source metadata; backend/UI authorization consistency; documented build/CI before merge consideration.

Additional standing DoD:

- every new Product reference reviews lifecycle/deletion protection
- every stock-affecting commercial UOM path proves conversion to immutable base quantity
- every sensitive-cost surface proves authorized and unauthorized behavior, including exports/history/filter/sort inference
- every financial stock transaction proves Inventory GL ↔ inventory subledger reconciliation where applicable
- draft/review/import preview paths prove no unintended stock/GL writes

---

## 26. Daftra benchmark position and reconciled findings

Daftra is a competitive benchmark for mature ERP product/inventory workflows, not AWJ's source of truth. For each benchmark item use one of: **MATCH / HARDEN / ADOPT-IMPROVE / INTENTIONALLY DIFFERENT / NEEDS DECISION**.

Reconciled benchmark findings to preserve:

- Multiple UOM and unit-linked barcodes are mature benchmark capabilities; AWJ preserves direct-to-base conversion factors and immutable base-quantity posting.
- Daftra has a separate Multiple Barcode Excel import. Earlier user testing of the Product import/export round-trip did not adequately preserve multiple barcodes. AWJ target is an explicit lossless multi-sheet contract.
- Daftra Product Import may accept stock quantity. AWJ is **INTENTIONALLY DIFFERENT**: Product Catalog Import remains Master Data only; Inventory Opening owns opening quantity/value/accounting.
- Daftra warehouse transfer/stocktake/returns/reporting patterns confirm the competitive relevance of AWJ's existing foundations and completion gaps; they do not justify an Inventory Core rebuild.
- Daftra Serial/Lot/Expiry confirms a real P2 competitive gap; AWJ keeps its own tracking model/invariants.
- Daftra cost-hiding permissions confirm cost visibility is a real permission domain; AWJ target is stronger centralized backend/data redaction.
- Daftra weighted barcode and Product Variants/Attributes are **Needs Decision**, not automatically approved requirements.

Continue the final benchmark pass for any remaining Product/Inventory areas before audit closure; never infer parity/absence without evidence.

---

## 27. Overall assessment

### Strong/already present

Product catalog; categories/brands; persistent media; warehouses; per-warehouse balances; stock movements; perpetual inventory; moving average; sales COGS; purchase valuation; price lists/per-UOM list prices; POS authoritative pricing; minimum sale price override/audit foundation; stock permits/transfers; opening inventory; stocktake foundation; safe product import workflow; export infrastructure; alternate-barcode backend/POS; UOM snapshots on invoice/purchase lines.

### Hardening before expansion

Minimum sale price after header discount; cost authorization; purchase-return UOM/valuation; stock-permit UOM; stocktake concurrency; UOM lifecycle; tenant-wide primary+alternate barcode uniqueness; complete product lifecycle reference protection.

### Completion after hardening

Multiple-UOM/barcode UX/workbook; large async imports; warehouse-aware inventory workspace; low stock/replenishment; reservations; serial/lot/expiry; stock requests/approvals; POS commercial UOM completion.

### Deliberately not part of the immediate build

Inventory Core/V2 rebuild; per-warehouse costing redesign; stock quantity in Product Catalog Import; editable reserved quantity; automatic PO; Product Variants mixed with tracking identities; uncontrolled master-data creation from transactions; copying Daftra features merely for parity.

---

## 28. Audit continuation / closure checklist

The original continuation point was Purchase Return negative-stock tracing. That item is now closed **PASS** for negative-stock enforcement, while Purchase Return UOM/valuation P1s remain open.

Before formal audit closure, continue from the current review state and reconcile:

1. prior chat decisions not yet represented in this record
2. remaining Daftra Product & Inventory cross-check areas with evidence
3. `products.view_cost` default-role grant source-of-truth
4. complete Product reference/lifecycle coverage
5. exact current Opening Import 2,000-row implementation path before any implementation change
6. final P1/P2/P3 mapping so every finding has a status/priority and every priority traces to a finding/approved decision
7. final PR order after the above, without starting implementation

This record is a **living working source of truth** during the review. Confirmed/approved findings should be documented as they are established rather than held only in chat. Corrections must update the same finding and preserve the reason/evidence status.

---

## 29. Standing conclusion

> **Do not rebuild AWJ inventory core.**
> **Complete and harden the existing Products & Inventory architecture.**

This working record preserves the prior audit plus subsequently confirmed/approved decisions through the current review state. Continue updating it before implementation; formal closure has not yet been declared.
