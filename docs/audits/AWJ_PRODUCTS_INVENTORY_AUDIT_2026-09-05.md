# أَوْج / AWJ ERP — Products & Inventory Audit Working Record

**Date:** 2026-09-05  
**Repository:** `safwan5001-source/Nebrax`  
**Audit basis:** actual `main` source code + AWJ UI screenshots supplied during the audit + Daftra as a competitive benchmark where explicitly reviewed.  
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

1. Actual `main` code is the source of truth.
2. Daftra is a benchmark, not a checklist. AWJ features are not removed merely because Daftra lacks them.
3. Master Data, Stock State, and Financial Transactions remain separate.
4. Product catalog import must not directly create inventory balances or accounting entries.
5. Every stock movement quantity is a **base inventory quantity**.
6. Historical document UOM factors must remain immutable snapshots.
7. Product deletion policy: a referenced product is deactivated, not deleted.
8. Inventory GL control account and inventory subledger must reconcile.
9. Sensitive cost data must be protected at the backend, not merely hidden in UI.
10. Tenant isolation and branch/warehouse correctness are mandatory.
11. No Merge/Deploy/Production Release without explicit approval.

---

## 3. Product master — verified foundation

`Product` supports tenant/branch, SKU, primary barcode, Arabic/English names, type/base unit, description, category/brand, unit template, reorder level, supplier, sales/COGS accounts, minimum sale price, discount fields, profit margin, tags/notes, sale/purchase price, tax, inventory tracking, quantity, average cost and active status. Relations include movements, alternate barcodes, media, category, brand and unit template.

Product create/update validates tenant-owned references and accounting account types. Selecting a unit template forces the product base unit to the template base unit.

General product RBAC is present: read operations use `products.view`, writes use `products.manage`.

`ProductLifecycleService` correctly keeps catalog edits separate from inventory/accounting. Used products are intended to be deactivated rather than deleted. It blocks type/tracking identity changes after inventory use, but lifecycle reference coverage and UOM-template lifecycle still have gaps documented below.

---

## 4. Categories, brands and media

Categories are hierarchical, tenant validated, cycle protected, sibling-name unique, support image/color, persistent private storage, and block deletion while products/children reference them. Brands are flat managed entities with uniqueness, active state and deletion protection. Both foundations are strong.

Product media APIs support list/upload/download/delete, up to 8 images, persistent private storage, and POS first-image exposure. Bulk media portability is missing; future recommendation is workbook + image files + manifest in a package/ZIP (P3), not binary images embedded in XLSX.

---

## 5. Units of measure (UOM)

`UnitTemplate` defines a base unit plus alternative units with canonical integer factors directly to base. Example: Piece=1, Box=12, Carton=120. Historical commercial lines store entered quantity, `unit_name`, and historical `unit_factor`; stock uses base quantity.

Critical invariant:

> Every `StockMovement.quantity` must be BASE INVENTORY QUANTITY.

No independent Default Sales UOM or Default Purchase UOM fields were found. Recommended future model:

> Base Inventory Unit ≠ Default Sales UOM ≠ Default Purchase UOM

UOM lifecycle has a P1 gap: template alternatives can be changed/deleted while live references such as alternate barcodes and price-list items can point to unit names; product lifecycle does not protect `unit_template_id` / base-unit changes. Historical documents are safer because they snapshot factors, but live references can dangle logically.

---

## 6. Multiple barcode

Alternate barcode backend/API is real. Each barcode supports code, product, unit, default quantity, label and creator. POS resolves alternate barcode to its commercial unit plus `default_quantity`.

Semantic rule:

> Barcode = what was scanned; Unit = commercial unit; Default Quantity = how many commercial units per scan; Unit Factor = base units per commercial unit; Unit Price = commercial unit price.

`default_quantity` must not be treated as conversion factor.

### P1 — Global Barcode Namespace Integrity

Alternate-barcode creation checks conflicts against both primary and alternate barcodes, but primary product barcode validation/import does not consistently check `ProductBarcode.code`.

Required invariant:

> `Primary Barcode ∪ Alternate Barcodes` is tenant-wide unique.

Must cover product create/update/import, alternate-barcode writes, and future barcode workbook import.

Backend/API and POS scanning exist; Product UI management and alternate-barcode import/export are incomplete/missing.

Recommended workbook:

- **Products**: one row/product, primary barcode
- **Barcodes**: zero-to-many alternate rows

Absence from Barcodes must not imply deletion; deletion should be explicit.

User directly tested Daftra and reported it does not preserve multiple barcodes adequately through import/export. AWJ should exceed that limitation.

---

## 7. Pricing

Existing: base sale price, explicit price lists, per-product/per-unit list items, customer default list, POS server-authoritative pricing, minimum sale price, authorized override with reason/actor snapshot, historical line prices.

Alternative UOM pricing is not blindly derived from factor × base price. This is safe.

Missing P2: product-level default UOM prices. Recommended precedence:

> Product Default UOM Price → Price List Override → Customer/POS resolved price

Do not auto-derive package price from conversion factor.

Minimum-sale-price enforcement is strong for line discount/UOM/authorized override. Pending nuance: determine whether invoice-level/header discount is intended to participate in minimum-price enforcement; current check occurs before header discount.

Purchase pricing correctly distinguishes commercial quantity/unit price from base stock quantity. Purchase discounts reduce acquisition cost and inbound shipping increases it. `purchase_price` is master/default commercial price; `avg_cost` is accounting valuation and should remain distinct.

---

## 8. Product import/export contract

`ProductImportFields` is the single source of truth for the flat product contract.

Current round-trip covers AWJ ID, SKU, names, type, unit, unit template, category, brand, primary barcode, sale/purchase/min prices, tax, track inventory, reorder, tags, description, internal notes and active status. `type` and `track_inventory` are update-locked for existing products.

Correctly excluded from product master import: quantity on hand, average cost, initial quantity and stock movements.

The Product model/UI/API is richer than flat round-trip. Not all of supplier, sales/COGS account mappings, discount fields, profit margin, alternate barcodes and media are preserved. Therefore:

> Current round-trip is lossless for its declared flat catalog contract, but not lossless for the complete AWJ Product Master.

Keep `catalog` export distinct from `round_trip`; catalog may contain reporting quantities/costs and must not become a stock re-import source.

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

The 2,000-row limit is architectural because current processing is synchronous. Raising a constant to 50,000 is not acceptable.

Recommended future epic:

> **Large Catalog Import Jobs & Lossless Product Workbook**

Architecture: durable upload → import job → whole-file validation → frozen mapping/options → deterministic chunks → persistent progress/errors → resumable/idempotent apply → cancellation → live conflict revalidation.

Multi-sheet workbook should eventually include Products, Barcodes, and Unit Prices (after product-level UOM pricing exists), with whole-workbook dependency validation before writes.

---

## 10. Inventory opening and import separation

Inventory Opening is a separate accounting domain and must remain separate from Product Catalog Import.

> Catalog Import → master data only
> Inventory Opening Import → Product + Warehouse + Quantity + Unit Cost + opening document/date

Future import-job infrastructure may be shared, but domain processors remain separate. Product import must never become a shortcut for stock/accounting.

Opening inventory is currently base-unit oriented; multi-UOM opening input/import is P2. A 2,000-row limit was observed in the opening-import area and should be re-verified at exact implementation path before implementation.

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

---

## 12. Warehouse and inventory core

AWJ already has a real warehouse core. `ProductWarehouseStock` stores per-product/per-warehouse quantity behind global product quantity.

Current architecture:

> Quantity = per warehouse + aggregate global
> Moving Average Cost = global per product

Do not introduce per-warehouse average cost without a deliberate costing redesign.

Warehouse resolution and explicit warehouse validation are present. Legacy no-warehouse behavior exists for backward compatibility. Future P2 policy may require warehouse for new tracked documents after setup while preserving historical compatibility.

`InventoryService` implements perpetual inventory, moving-average costing, permanent movements, warehouse quantity updates, sales COGS, purchase receipts and opening inventory. Preserve this core.

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

Purchase Return negative-stock caller path remains pending direct verification.

---

## 14. Stock permits and transfers

Implemented: receipt/issue/transfer, draft→posted, source/target warehouses, stock+accounting transaction, issue at average cost, transfer out/in at same cost, no GL for same-branch transfer, branch-dimensional inventory reclassification for cross-branch transfer, source metadata.

### P1 — Stock Permit UOM / Base Quantity

`StockPermitLine.quantity` is treated directly as stock quantity and has no historical `unit_name`/`unit_factor` snapshot. Commercial UOM input must convert to immutable base quantity at posting.

Future P2: Stock Request → Approval → Fulfillment → one-to-many/partial Stock Permits; request itself has no stock/GL effect.

---

## 15. Returns

Sales-return inventory handling is comparatively strong and can use historical invoice UOM factor; restock vs damage/non-restock is separated.

### P1 — Purchase Return UOM / Historical Base Quantity

Purchase return lines do not preserve equivalent historical UOM/base-quantity semantics. Returning 1 carton originally factor 24 can risk issuing 1 base piece.

### P1 — Purchase Return Inventory Valuation / GL Reconciliation

Supplier credit/commercial return value and inventory carrying value can diverge. Required invariant:

> Δ Inventory GL 1140 = Δ Inventory Subledger

These two purchase-return fixes should ship together. Negative-stock enforcement for purchase return remains to be directly verified in the exact posting path.

---

## 16. Stocktake

Stocktake is base-unit oriented; multi-UOM counting UX is P2.

### P1 — Stocktake Snapshot / Concurrent Movement Reconciliation

Opening stocktake snapshots warehouse quantity; intervening movements may occur before posting. Posting stale counted-minus-snapshot can be wrong without reconciliation/version validation.

Stocktake is a correction/reconciliation path, so controlled negative correction is conceptually separate from operational negative-stock policy.

---

## 17. Inventory reporting / workspace

Current `/inventory` is primarily a global Inventory Balance / Valuation Report, not a full Warehouse Inventory Workspace. It returns product-level quantity, average cost, stock value and total inventory value. Current filter/report layer lacks warehouse dimension.

Web page loads the full result then searches/filters/sorts/paginates client-side.

### P2 — Server-side Inventory DataTable

Required for 20k–50k catalog scale. Reuse existing server-side filter concepts used by export.

### P2 — Warehouse dimension

Core already has per-warehouse balances; UI/reporting must expose Product × Warehouse.

### P2 — Low Stock Center

`reorder_level` exists but mature low-stock/reorder workspace is missing. First stage: In Stock / Low Stock / Out of Stock / Negative Stock. Later Product×Warehouse reorder point/target, preferred supplier and lead time.

### P2 — Movement Source Drilldown

Movement model already stores warehouse and source type/id. UX/API should expose normalized source/document drilldown rather than only type/quantity/notes.

---

## 18. Central sensitive cost authorization — confirmed P1

This is the recommended first implementation PR.

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

Recommended write rule initially:

> non-cost edits = `products.manage`
> cost edits/import = `products.manage` + `products.view_cost`

Centralize the sensitive-field policy; do not scatter field lists across controllers/resources.

Before rollout, audit where `products.view_cost` is defined/granted to owner/admin/accountant/custom roles. Usage was found, but complete default-role source of truth was not yet proven.

---

## 19. Current settings reviewed

AWJ Product/Inventory settings screenshots showed:

1. Serial/batch/expiry marked coming soon
2. Negative stock stop/allow with warnings
3. Show quantities; available quantity future
4. Restock sales returns toggle

Keep AWJ-specific useful settings even if Daftra lacks them.

---

## 20. Future tracking/reservations/replenishment

### P2 Serial/Lot/Expiry

Recommended tracking modes: Quantity-only / Lot / Serial, with expiry off/optional/required. Tracking balances are Product + Warehouse + Identity; sum must equal warehouse quantity. Tracking is base quantity. Costing remains global moving average. FEFO is selection, not valuation. No negative tracking identity.

### P2 Reservations

Future durable StockReservation records. Do not use editable reserved quantity. `Available = On Hand - Active Reservations`.

### P2/P3 Replenishment

P2 warehouse reorder point/target, preferred supplier, lead time, Low Stock Center and transfer-before-purchase suggestion. P3 intelligent suggestions. No automatic PO initially.

---

## 21. Current confirmed P1 list

1. **Central Sensitive Cost Authorization & Data Redaction**
2. **Purchase Return UOM / Historical Base Quantity**
3. **Purchase Return Inventory Valuation / GL Reconciliation**
4. **Stock Permit UOM / Base Quantity**
5. **Stocktake Snapshot / Concurrent Movement Reconciliation**
6. **UOM Referential Integrity & Product Template Lifecycle**
7. **Global Barcode Namespace Integrity**
8. **Product Lifecycle Reference Integrity**

Pending verification that may modify the list:

- Purchase-return negative-stock enforcement
- minimum-sale-price behavior under invoice-level/header discount
- complete product FK/reference coverage beyond InventoryOpeningLine

---

## 22. Confirmed P2/P3 backlog

P2: alternate-barcode UI; Default Sales/Purchase UOM; Default Product UOM Prices; multiple-barcode import/export; Large Catalog Import Jobs; multi-UOM stocktake/opening; server-side Inventory DataTable; warehouse Inventory Workspace; Low Stock/warehouse reorder; movement source drilldown; Stock Requests/Approval; Reservations; Serial/Lot/Expiry; warehouse-required policy; default supplier UX/portability; possible richer tax classification after tax audit.

P3/later: media migration package; quantity-tier pricing; intelligent replenishment; bundles; manufacturing/BOM deferred; accounting mapping portability only if real migration need exists.

---

## 23. Provisional PR sequence

No implementation is authorized by this record.

1. **PR-INV-1 — Centralize Product & Inventory Cost Authorization**
2. **PR-INV-2 — Purchase Returns Hardening**
3. **PR-INV-3 — Stock Permit UOM / Base Quantity**
4. **PR-INV-4 — Stocktake Concurrent Reconciliation**
5. **PR-UOM-1 — UOM Referential Integrity + Product Template Lifecycle + Global Barcode Namespace**
6. **PR-PROD-LIFE-1 — Product Lifecycle Reference Integrity** (or fold into a small isolated hardening PR)
7. Multiple UOM & Barcode Completion Epic
8. **PR-IMP-1 — Import Jobs Foundation + Large Catalog Workbook**
9. Inventory Workspace server-side/warehouse completion
10. Serial/Lot/Expiry
11. Reservations/Availability
12. Stock Requests/Approval
13. Low Stock/Replenishment
14. Movement source drilldown
15. Bundles
16. Manufacturing deferred

Sequence may change if remaining audit finds another P1.

---

## 24. Definition-of-done principles

As applicable: tenant isolation; branch/warehouse correctness; base-UOM invariants; accounting/subledger reconciliation; authorized/unauthorized tests; historical snapshots; rollback/transaction behavior; no weakening of financial/security tests; backward compatibility; source metadata; backend/UI authorization consistency; documented build/CI before merge consideration.

---

## 25. Daftra benchmark position

Daftra is a competitive benchmark for mature ERP product/inventory workflows, not AWJ's source of truth. Useful patterns may be adopted when compatible with AWJ architecture/accounting. AWJ features are not removed for parity.

Explicit user-tested benchmark finding: Daftra does not adequately preserve multiple barcodes through product import/export; AWJ should implement a better lossless multi-barcode workbook.

---

## 26. Overall assessment

### Strong/already present

Product catalog; categories/brands; persistent media; warehouses; per-warehouse balances; stock movements; perpetual inventory; moving average; sales COGS; purchase valuation; price lists/per-UOM list prices; POS authoritative pricing; minimum sale price override/audit; stock permits/transfers; opening inventory; stocktake foundation; safe product import workflow; export infrastructure; alternate-barcode backend/POS; UOM snapshots on invoice/purchase lines.

### Hardening before expansion

Cost authorization; purchase-return UOM/valuation; stock-permit UOM; stocktake concurrency; UOM lifecycle; global barcode uniqueness; complete product lifecycle reference protection.

### Completion after hardening

Multiple-UOM/barcode UX/workbook; large async imports; warehouse-aware inventory workspace; low stock/replenishment; reservations; serial/lot/expiry; stock requests/approvals.

---

## 27. Audit continuation point

Audit paused for documentation while tracing **Negative Stock enforcement across Stock Permit / Transfer / Purchase Return**.

Verified immediately before this file:

- Sales/Invoice path explicitly enforces warehouse-aware stock availability in base quantity.
- `InventoryService::applyIssue()` intentionally is not universally enforcing because reconciliation/correction may need controlled bypass.
- `StockPermitService` explicitly checks availability before Issue and Transfer source movements, including selected warehouse quantity where warehouse rows exist. No operational negative-stock bypass found there.
- Stock Permit retains a separate P1 UOM/base-quantity gap.
- Purchase Return negative-stock caller path remains to inspect directly.

**Next audit action:** inspect `ReturnService` purchase-return posting end-to-end for stock issue quantity/UOM, negative-stock enforcement, source warehouse behavior, and inventory GL/subledger valuation; then continue remaining inventory settings/reports/POS/purchase/sales integration audit.

---

## 28. Standing conclusion

> **Do not rebuild AWJ inventory core.**
> **Complete and harden the existing Products & Inventory architecture.**

This is a working source-of-truth snapshot through 2026-09-05 and should be updated as the audit continues.
