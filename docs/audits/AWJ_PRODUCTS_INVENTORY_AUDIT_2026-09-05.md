# أَوْج / AWJ ERP — Products & Inventory Audit Working Record

**Date:** 2026-09-05  
**Last reconciled:** 2026-09-06  
**Repository:** `safwan5001-source/Nebrax`  
**Audit basis:** actual `main` source code + AWJ UI screenshots supplied during the audit + prior approved project discussions/decisions + Daftra as a competitive benchmark where explicitly reviewed.  
**Status:** Working audit record — implementation has **not** started. No merge/deploy/production release is authorized by this document.

## Governing pre-production data rule

The project-wide policy in `docs/audits/AWJ_PRE_PRODUCTION_DATA_POLICY.md` governs this audit: all current tenants and business data are test/demo data and are not preservation constraints. Do not weaken the intended production design or add compatibility complexity solely to preserve them. Clean schema/default/constraint changes and deliberate test-data reset are acceptable before first real production data. This does **not** relax Tenant Isolation, accounting correctness, inventory integrity, security, intended API/domain contracts, idempotency, or explicit merge/deploy approval requirements.

---

## 1. Executive conclusion

AWJ already has a substantial Products & Inventory core. It should **not** be rebuilt as a new Inventory Core/V2 from scratch.

The correct program is:

> **Products & Inventory Completion & Hardening**

The existing foundation includes product catalog, categories/brands, inventory tracking fields, warehouses, warehouse balances, permanent stock movements, moving-average costing, perpetual inventory, sales COGS, purchase receipts, returns foundation, stocktake, stock permits/transfers, opening inventory, POS integration, UOM templates, alternate barcodes, price lists, import/export, and inventory reporting.

The highest priority is to close correctness/security/integrity gaps before adding large-import, serial/lot/expiry, reservations, advanced replenishment, or broader UX.

---

## 2. Audit principles and invariants

1. Actual `main` code is the source of truth for current implementation state.
2. Daftra is a benchmark, not a checklist.
3. Master Data, Stock State, and Financial Transactions remain separate.
4. Product catalog import must not directly create inventory balances or accounting entries.
5. Every stock movement quantity is a base inventory quantity.
6. Historical document UOM factors are immutable snapshots.
7. Referenced products are deactivated, not destructively deleted.
8. Inventory GL and inventory subledger must reconcile.
9. Sensitive cost data is protected at backend, not merely hidden in UI.
10. Tenant isolation and branch/warehouse correctness are mandatory.
11. Quantity truth is warehouse/subledger state; Product Master edits are not stock adjustments.
12. Moving Average Cost remains global per product under the current architecture.
13. Live operational references must remain valid or fail closed when UOM/catalog structures change.
14. Current pre-production test/demo data is disposable and must not force a weaker production design.
15. No Merge/Deploy/Production Release without explicit approval.

---

## 3. Product master and lifecycle

Product Master supports tenant/branch identity, SKU/barcode, bilingual names, product type/base unit, category/brand, unit template, supplier, accounting mappings, sale/purchase/minimum prices, inventory tracking, reorder, quantity, average cost and active state.

Product create/update validates tenant-owned references and accounting account types. Selecting a unit template through Product flows forces `Product.unit` to the template base unit.

`ProductLifecycleService` correctly separates catalog edits from inventory/accounting, but its manually maintained Product-reference census and inventory-identity mutation guard are incomplete; see Section 11.

**PASS:** `UpdateProductRequest` explicitly prohibits `initial_quantity`; stock changes must use stock transactions rather than Product Master edits.

---

## 4. Categories, brands and media

Categories/brands are tenant-scoped managed master data with deletion protection. Product media uses persistent private storage and supports POS exposure. Bulk media portability remains P3: workbook + media manifest/package rather than binary images embedded in XLSX.

---

## 5. Units of measure (UOM)

`UnitTemplate` defines a base unit plus alternative units with canonical integer factors directly to base. The central conversion model converts quantity, not money. Unknown units fail closed rather than silently becoming factor 1.

Historical invoice/purchase/delivery-note lines snapshot `unit_name` and `unit_factor`.

### P1 — In-use Unit Template mutation safety

`UnitTemplateController::update()` can change `base_unit` and recreate alternative-unit rows without protecting existing stock/live references. Changing base/factor semantics can reinterpret future conversions while current stock has no template-version identity.

A direct template base-unit edit can also diverge `UnitTemplate.base_unit` from linked `Product.unit`; POS treats `Product.unit` as factor 1.

Required invariant:

> `Product.unit === UnitTemplate.base_unit` for linked products.

### P2 — Live UOM reference integrity

Alternative-unit rename/delete can leave string-based references stale in alternate barcodes, price-list items and held POS carts. These must fail closed or be explicitly migrated; never silently reinterpret quantity under another factor.

---

## 6. Multiple barcode

Alternate barcode backend/API is real. POS excludes stale alternate barcodes whose `unit_name` is no longer valid; no stale-barcode → silent factor-1 corruption was found in the reviewed POS path.

### P1 — Tenant-wide Primary + Alternate Barcode Namespace Integrity

Alternate-barcode creation checks both primary and alternate barcode namespaces. However, Product primary barcode validation and Product Import live-conflict checks query only `Product.barcode`; they do not consistently include `ProductBarcode.code`.

The original Product schema enforces tenant-wide SKU uniqueness but does not define tenant-wide DB uniqueness for the primary `products.barcode`. `ProductBarcode` is explicitly company-wide because scanner resolution has no branch context. Controller/request checks therefore cannot be the final concurrency boundary.

Required invariant:

> `Primary Barcode ∪ Alternate Barcodes` is unique within the tenant.

Must cover Product create/update/import, alternate-barcode writes and future barcode workbook import, including atomic/concurrency-safe enforcement. Because current data is disposable pre-production data, implementation may adopt the cleanest canonical namespace/constraint model rather than preserve experimental duplicates.

---

## 7. Pricing

Existing: base sale price, explicit price lists, per-product/per-unit list items, customer default list, POS server-authoritative pricing, minimum sale price and authorized override foundation.

Alternative UOM price is intentionally not derived from conversion factor × base price:

> Quantity conversion ≠ Price derivation.

### P1 — Minimum Sale Price after invoice/header discount

Confirmed: line minimum-price validation occurs before invoice/header discount; header discount can later reduce final effective line economics below `minimum_sale_price`.

Required invariant:

> Effective final sale price after all economically applicable discounts must not fall below `minimum_sale_price` unless the authorized override path is used.

---

## 8. Product import/export contract

`ProductImportFields` is the source of truth for the flat Product Import contract. Correctly excluded from Product Master import: quantity on hand, average cost, initial quantity and stock movements.

Current round-trip is lossless for its declared flat contract, not for the complete Product Master. Future lossless workbook direction remains Products + Barcodes + Unit Prices, with media separate. Stock balances never belong in Product Master round-trip.

### Confirmed security detail

`purchase_price` is a writable Product Import field and is updateable. Product Import therefore belongs to the sensitive cost-write authorization surface; see Section 19.

---

## 9. Product import engine and scale

Current workflow: Inspect → Preview → Apply; Apply revalidates and writes transactionally. Current synchronous limit is 2,000 rows; do not simply raise it to 50,000.

Future direction: durable upload/job, whole-file validation, frozen mapping/options, deterministic chunks, progress/errors, resumable/idempotent apply and live conflict revalidation.

---

## 10. Inventory Opening

Inventory Opening remains a separate accounting domain from Product Catalog Import.

Confirmed limits:

- `MAX_ROWS = 2000`
- `MAX_COLUMNS = 200`
- `PREVIEW_ROW_LIMIT = 200`
- `SAMPLE_ROW_LIMIT = 5`

Workflow: Inspect → Preview → Draft → explicit Posting. Preview/Draft creation has no stock/GL effect.

### Inventory Opening posting — PASS

Posting is transaction-protected, locks/rechecks the draft against concurrent double-post, locks product rows before moving-average calculations, requires warehouse per line, supports warehouses from different branches, creates one opening journal entry, and uses stored line values consistently with inventory receipt values. Posted openings cannot be deleted. Restrictive FKs and Product+Warehouse uniqueness protect line integrity.

Opening inventory is currently base-unit oriented; multi-UOM opening is P2.

---

## 11. Product lifecycle reference integrity — P1

`ProductLifecycleService::referenceCounts()` is manually maintained and omits at least these confirmed direct generic Product references:

- `InventoryOpeningLine.product_id`
- `DeliveryNoteLine.product_id`

DB restrictive references remain a final safety line, but the business service can incorrectly report a product as deletable.

`ProductActivity.product_id`, alternate barcodes and product media require classification rather than blind addition to deletion blockers: they are product-owned/audit children, and creation activity exists even for a newly-created otherwise-unused product. The target registry must distinguish business/historical blockers, inventory-identity blockers, owned children and unrelated domains.

### P1 — Inventory identity mutation guard incomplete

`assertInventoryIdentityCanChange()` does not include `InventoryOpeningLine`. A Draft Inventory Opening can therefore reference a product before stock movements exist while `type` / `track_inventory` can still change.

Required direction: centralized Product Reference Registry/census, explicit policy classes for deletion/deactivation and inventory-identity mutation, plus regression/architecture tests for new Product-bearing domains.

Confirmed false positives excluded: fuel contract/card/fleet product models reference `FuelProduct`, not generic `Product`.

**Audit status:** generic Product-reference census remains open until tree/migration/model review is exhausted; incomplete GitHub code-search results are not accepted as proof of completeness.

---

## 12. Warehouse and inventory core

AWJ already has a real warehouse core. Quantity is per warehouse plus aggregate global; Moving Average Cost is global per product. Do not introduce per-warehouse average cost without deliberate costing redesign.

`InventoryService` implements perpetual inventory, moving-average costing, permanent movements, warehouse quantity updates, sales COGS, purchase receipts and opening inventory.

**Standing decision:** do not build Inventory Core/V2.

---

## 13. Negative stock policy

Tenant setting `inventory.allow_negative_stock` exists. Sales/Invoice COGS converts to base quantity and checks availability.

**PASS:** Stock Permit/Transfer source availability enforcement is warehouse-aware in reviewed paths.

**PASS:** Purchase Return negative-stock enforcement. This does not close its separate UOM/base-quantity and valuation P1s.

Existing demo-tenant values are not a compatibility requirement; choose and enforce the intended production default before real customer data exists.

---

## 14. Stock permits and transfers

Implemented: receipt/issue/transfer, draft→posted, source/target warehouses, stock+accounting transaction and source metadata.

**PASS — Tenant/warehouse creation path:** source and target warehouses are tenant-owned and must both be allowed to the user; all Product IDs are tenant-owned.

### P1 — Stock Permit UOM / Base Quantity

`StockPermitLine.quantity` is treated directly as stock quantity and lacks historical `unit_name`/`unit_factor` snapshot. Commercial UOM input must convert to immutable base quantity at posting.

### P2 — Stock Requests

Target: Stock Request → Approval → Fulfillment → partial/multiple Stock Permits. Request itself has no stock/GL effect.

---

## 15. Returns

Sales-return inventory handling is comparatively strong and can use historical invoice UOM factor.

### P1 — Purchase Return UOM / Historical Base Quantity

Purchase return lines do not preserve equivalent historical base-quantity semantics. Returning one carton originally factor 24 can risk issuing one base piece.

### P1 — Purchase Return Inventory Valuation / GL Reconciliation

Supplier credit/commercial return value and inventory carrying value can diverge.

Required invariant:

> Δ Inventory GL 1140 = Δ Inventory Subledger.

These two Purchase Return fixes should ship together.

---

## 16. Stocktake

**PASS — creation isolation:** warehouse is tenant-owned and allowed for the active branch/user context; supplied Product IDs are tenant-owned.

Stocktake remains base-unit oriented; multi-UOM counting UX is P2.

### P1 — Stocktake Snapshot / Concurrent Movement Reconciliation

Opening stocktake snapshots warehouse quantity; intervening movements may occur before posting. Posting stale counted-minus-snapshot requires reconciliation/version validation.

---

## 17. Delivery Notes and POS held sales

### Delivery Notes — PASS for stock/GL ownership

Delivery Note is operational/non-financial under current design; confirm does not issue inventory or create GL. Lines snapshot `unit_name`/`unit_factor`; confirm revalidates current factor and fails closed if semantics changed.

Direct `DeliveryNoteLine.product_id` is part of the Product lifecycle P1 census gap.

### POS Held Sales — P2 live-reference integrity

Held sales have no Invoice/Payment/Stock Movement/Journal Entry effect. Resume uses cashier/warehouse/session access controls and `lockForUpdate()`. Held lines do not snapshot `unit_factor`, so UOM mutation can invalidate live drafts and must fail closed rather than reinterpret them.

---

## 18. Inventory reporting / workspace

Current `/inventory` is primarily a global Inventory Balance/Valuation Report, not a full Warehouse Inventory Workspace. The screen still loads results for client-side search/filter/sort/pagination; P2 server-side DataTable is required for 20k–50k scale.

### Inventory export scalability — PASS

Inventory export is server-side, chunked/streamed with deterministic ordering and a 50,000-row cap. Do not conflate export scalability with the screen's client-side scalability gap.

### P2

Warehouse Product×Warehouse dimension, Low Stock Center and movement source drilldown.

---

## 19. Central Sensitive Cost Authorization — confirmed P1

Sensitive data includes at minimum purchase price, average cost, profit margin, stock value, movement unit cost and movement total cost. Sale price is not cost.

### Confirmed read/exposure surfaces

- generic Product list/show resource
- Product Activity historical diff
- Product export
- Inventory list/valuation
- Inventory export
- Stock Movement unit/total cost
- cost/value filters and sorting

Generic `ProductResource` exposes cost/profit unless a POS-specific transient hide flag is set. Product Activity returns raw dirty diff. Inventory APIs expose valuation/movement costs without a central `products.view_cost` gate in the reviewed path. Cost/value filters and sorts can become inference side channels.

### Confirmed write surfaces

`StoreProductRequest` accepts `purchase_price`; `UpdateProductRequest` inherits the same rule. ProductController store/update passes validated data into Product domain/lifecycle without a separate cost-permission gate.

`ProductImportFields` marks `purchase_price` writable and updateable, and Product Import Apply can create/update it. `ImportProductsRequest::authorize()` itself is unconditional; route-level `products.manage` is not sufficient to distinguish ordinary master edits from sensitive cost edits.

Therefore the approved write policy is now a **confirmed implementation gap**, not merely a future rule:

> non-cost edits = `products.manage`  
> cost edits/import = `products.manage` + `products.view_cost`

Import inspect/preview may require separate UX policy, but any apply that writes sensitive cost fields must enforce the cost permission server-side.

### Product export — confirmed cost disclosure

`ProductExportService` catalog includes `purchase_price` and `avg_cost`; round-trip includes writable `purchase_price`. `ExportProductsRequest::authorize()` is unconditional. Therefore Product export must be part of the centralized cost authorization/redaction remediation. An operational export may remain available to non-cost users only with sensitive columns omitted or via a separate safe template/policy.

### Required centralized policy

- backend redaction of sensitive fields
- redact Product Activity historical diff
- reject/disable cost/value filters and sorts for unauthorized users
- safe export policy/columns
- require cost permission for cost writes/import apply
- authorized/unauthorized regression tests
- avoid scattered independent sensitive-field lists

### Default role grants — verified

`products.view_cost` is explicit. Owner/Admin (`*`) have it; Accountant/Staff do not by default; custom roles receive it only when explicitly granted.

POS itself is comparatively strong: cost/profit exposure requires both cost permission and the relevant POS visibility setting.

---

## 20. Product & Inventory settings

Reviewed settings include negative-stock policy, show stock quantities, restock sales returns, and Serial/batch/expiry coming-soon surface.

**PASS — current route/settings boundary:** Inventory Settings are tenant-level; read is protected by `products.view`, update by `company.manage`. Unsupported detailed tracking cannot currently be enabled through the backend. Existing demo-tenant settings are not preservation constraints under the governing pre-production policy.

Future default-warehouse/warehouse-required policy remains P2 unless a current correctness dependency proves otherwise.

---

## 21. Future tracking, reservations, replenishment and variants

### P2 — Serial/Lot/Expiry

Target: Quantity-only/Lot/Serial; expiry Off/Optional/Required; Product + Warehouse + Tracking Identity balance; tracking sum equals warehouse quantity; base quantities; global moving average; FEFO selection not valuation.

### P2 — Reservations

> On Hand = physical/subledger truth  
> Reserved = active durable commitments  
> Available = On Hand - Active Reservations

### P2/P3 — Replenishment

Warehouse reorder point/target, preferred supplier, lead time, Low Stock Center and transfer-before-purchase suggestion. No automatic PO initially.

Needs Decision: Product Variants/Attributes and Weighted Barcode.

---

## 22. POS and cross-domain dependencies

POS barcode/UOM resolution remains server-authoritative and base-quantity safe in reviewed paths. Checkout revalidates tenant-owned products and session/device warehouse constraints. Alternative-unit pricing requires explicit price rather than factor-derived money.

Preserve Product Quick View cost authorization, negative-stock enforcement, historical UOM snapshots and final minimum-sale-price policy.

---

## 23. Current confirmed P1 list

1. **Central Sensitive Cost Authorization & Data Redaction — read + write + import/export + inference**
2. **Minimum Sale Price after Invoice/Header Discount**
3. **Purchase Return UOM / Historical Base Quantity**
4. **Purchase Return Inventory Valuation / GL Reconciliation**
5. **Stock Permit UOM / Base Quantity**
6. **Stocktake Snapshot / Concurrent Movement Reconciliation**
7. **In-use UOM Template Base/Factor Mutation Safety + Product.unit invariant**
8. **Tenant-wide Primary + Alternate Barcode Namespace Integrity**
9. **Product Lifecycle Reference Census Integrity**
10. **Product Inventory-Identity Mutation Guard Completeness**

### Confirmed PASS items

- Purchase Return negative-stock enforcement
- Stock Permit/Transfer operational negative-stock enforcement
- Stock Permit creation tenant/source/target warehouse/Product isolation
- Stocktake creation tenant/warehouse/Product isolation
- Inventory Opening staged preview/draft has no stock/GL effect
- Inventory Opening atomic posting/double-post protection/accounting-value design
- UOM unknown-unit resolution fails closed
- historical UOM snapshots on reviewed posted-document paths
- Delivery Note no duplicate stock/GL effect under current design
- Delivery Note UOM snapshot + confirm revalidation
- POS tenant/warehouse validation in reviewed checkout path
- POS local cost visibility gate
- POS explicit alternative-unit pricing
- POS held-sale lock/access controls
- Inventory export scalability/chunking for current 50k target
- Product Update prohibits `initial_quantity`
- Product Catalog Import excludes quantity/avg-cost/opening-stock/stock-movement writes
- Inventory Settings tenant-level route authorization and unsupported detailed-tracking fail-closed behavior

---

## 24. Confirmed P2/P3 backlog

### P2

Alternate-barcode Product UI; Default Sales/Purchase UOM; Default Product UOM Prices; UOM rename/delete live-reference integrity for Barcode/Price List/Held Cart; lossless multiple-barcode import/export; Large Catalog/Opening Import Jobs; multi-UOM stocktake/opening; server-side Inventory DataTable; warehouse Inventory Workspace; Low Stock/warehouse reorder; movement source drilldown; Stock Requests/Approval/partial fulfillment; Reservations/Available Quantity; Serial/Lot/Expiry; warehouse-required/default-warehouse policy; default supplier UX/portability; POS commercial UOM switching.

### P3/later

Media migration package; quantity-tier pricing; intelligent replenishment; bundles; manufacturing/BOM deferred; accounting mapping portability only if a real migration need exists.

---

## 25. Provisional PR sequence

No implementation is authorized by this record.

1. **PR-PRICE-1 — Minimum Sale Price after all economically applicable discounts**
2. **PR-INV-1 — Centralize Product & Inventory Cost Authorization**
3. **PR-INV-2 — Purchase Returns Hardening**
4. **PR-INV-3 — Stock Permit UOM / Base Quantity**
5. **PR-INV-4 — Stocktake Concurrent Reconciliation**
6. **PR-UOM-1 — In-use UOM Mutation Safety + Live Reference Integrity + Tenant Barcode Namespace**
7. **PR-PROD-LIFE-1 — Product Lifecycle Reference Registry + Inventory Identity Guard**
8. Multiple UOM & Barcode Completion Epic
9. **PR-IMP-1 — Durable Import Jobs Foundation + Large Catalog/Opening Workflows**
10. Inventory Workspace server-side/warehouse completion
11. Serial/Lot/Expiry
12. Reservations/Availability
13. Stock Requests/Approval
14. Low Stock/Replenishment
15. Movement source drilldown
16. Bundles
17. Manufacturing deferred

---

## 26. Definition of Done

As applicable: tenant isolation; branch/warehouse correctness; base-UOM invariants; accounting/subledger reconciliation; authorized/unauthorized tests; historical snapshots; transaction/rollback behavior; backward compatibility for intended product contracts (not preservation of disposable pre-production data); source metadata; backend/UI authorization consistency; documented tests/build/CI.

Additional standing DoD:

- every new Product reference reviews lifecycle/deletion and inventory-identity protection
- every stock-affecting commercial UOM path proves conversion to immutable base quantity
- every sensitive-cost surface proves authorized and unauthorized behavior, including exports/history/filter/sort inference and writes/imports
- every financial stock transaction proves Inventory GL ↔ inventory subledger reconciliation where applicable
- draft/review/import-preview paths prove no unintended stock/GL writes
- in-use UOM mutation tests cover base unit, factor, rename/delete, Product synchronization, barcodes, price lists and live drafts

---

## 27. Daftra benchmark position

Daftra remains benchmark, not source of truth. Preserve MATCH / HARDEN / ADOPT-IMPROVE / INTENTIONALLY DIFFERENT / NEEDS DECISION.

Key preserved conclusion: AWJ intentionally keeps Product Catalog Import as Master Data only; opening quantity/value/accounting belongs to Inventory Opening. Serial/Lot/Expiry is a real P2 competitive gap. Cost hiding is a real permission domain, with AWJ targeting stronger centralized backend enforcement.

---

## 28. Overall assessment

### Strong/already present

Product catalog; categories/brands; warehouses; per-warehouse balances; stock movements; perpetual inventory; moving average; sales COGS; purchase valuation foundation; price lists/per-UOM prices; POS authoritative pricing; stock permits/transfers; opening inventory; stocktake foundation; safe Product Import staging; export infrastructure; alternate-barcode backend/POS; historical UOM snapshots.

### Hardening before expansion

Minimum-price final economics; centralized cost authorization; purchase-return UOM/valuation; stock-permit UOM; stocktake concurrency; in-use UOM mutation; barcode namespace; complete Product lifecycle reference/identity protection.

### Completion after hardening

Multiple-UOM/barcode UX/workbook; durable imports; warehouse-aware inventory workspace; low stock/replenishment; reservations; serial/lot/expiry; stock requests/approvals; POS commercial UOM completion.

---

## 29. Audit continuation / closure checklist

Before formal closure:

1. complete generic Product-reference census beyond confirmed `InventoryOpeningLine` / `DeliveryNoteLine` omissions
2. finish any remaining cost-write/export endpoint/route policy census
3. verify remaining tenant/branch/warehouse scoping edge cases, especially post/update paths
4. finalize barcode namespace/concurrency production invariant
5. reconcile remaining Daftra benchmark areas with evidence
6. finalize P1/P2/P3 mapping and PR order without starting implementation

Inventory Settings route/settings boundary is reconciled for the current reviewed surface; future default-warehouse policy remains backlog rather than a closure blocker.

This record is the living working source of truth. Confirmed findings must be updated here rather than held only in chat.

---

## 30. Standing conclusion

> **Do not rebuild AWJ inventory core.**  
> **Complete and harden the existing Products & Inventory architecture.**

Formal audit closure has not yet been declared.