# أَوْج / AWJ ERP — Products & Inventory Audit Working Record

**Date:** 2026-09-05  
**Last reconciled:** 2026-09-06  
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

### Evidence/status vocabulary

- **Approved decision** — explicitly settled in prior project discussion; preserve unless deliberately reopened.
- **Confirmed finding** — verified against AWJ implementation during this audit.
- **PASS** — directly verified behavior satisfies the audited invariant in the reviewed path.
- **Daftra benchmark** — externally observed/documented comparison, not automatically an AWJ requirement.
- **Needs Decision** — candidate/capability discovered but not approved as an AWJ requirement.
- **Pending Verification** — do not state as fact until directly verified.

---

## 3. Product master — verified foundation

`Product` supports tenant/branch, SKU, primary barcode, Arabic/English names, type/base unit, description, category/brand, unit template, reorder level, supplier, sales/COGS accounts, minimum sale price, discount fields, profit margin, tags/notes, sale/purchase price, tax, inventory tracking, quantity, average cost and active status. Relations include movements, alternate barcodes, media, category, brand and unit template.

Product create/update validates tenant-owned references and accounting account types. Selecting a unit template through Product flows forces the product base unit to the template base unit.

General product RBAC is present: read operations use `products.view`, writes use `products.manage`. Sensitive cost authorization is a separate P1 documented below.

`ProductLifecycleService` correctly keeps catalog edits separate from inventory/accounting. Used products are intended to be deactivated rather than deleted. Its manually maintained reference census and inventory-identity mutation guard are incomplete; see Section 11.

**Approved boundary:** Product Master and Inventory State are distinct. Reading On Hand/warehouse availability from a product view is allowed; editing product master must not directly alter inventory balances, valuation, or GL.

---

## 4. Categories, brands and media

Categories are hierarchical, tenant validated, cycle protected, sibling-name unique, support image/color, persistent private storage, and block deletion while products/children reference them. Brands are flat managed entities with uniqueness, active state and deletion protection. Both foundations are strong.

Product media APIs support list/upload/download/delete, up to 8 images, persistent private storage, and POS first-image exposure. Bulk media portability is missing; future recommendation is workbook + image files + manifest in a package/ZIP (P3), not binary images embedded in XLSX.

Lifecycle/deletion protection is part of the domain contract: referenced master data must not be destructively removed in a way that breaks historical or draft transactions.

---

## 5. Units of measure (UOM)

`UnitTemplate` defines a base unit plus alternative units with **canonical integer factors directly to base**. Example: Piece=1, Box=12, Carton=120. The architecture expects the smallest practical inventory unit as base rather than fractional conversion factors.

Critical invariant:

> Every `StockMovement.quantity` must be BASE INVENTORY QUANTITY.

The central conversion model converts **quantity, not money**. Commercial line price remains the entered commercial-unit price; inventory quantity becomes `commercial quantity × unit_factor`. Unknown units fail closed rather than silently becoming factor 1.

Historical invoice/purchase/delivery-note lines snapshot `unit_name` and `unit_factor`; later template edits must never reinterpret posted historical documents.

No independent Default Sales UOM or Default Purchase UOM fields were found. Approved future model:

> Base Inventory Unit ≠ Default Sales UOM ≠ Default Purchase UOM

### P1 — In-use Unit Template mutation safety

Confirmed: `UnitTemplateController::update()` can change `base_unit` and deletes/recreates alternative-unit rows without checking whether products, stock, barcodes, price-list items, held POS carts, or draft documents already depend on the template. Deletion of a used template is guarded, but semantic mutation is not equivalently guarded.

This creates two classes of risk:

1. **P1 inventory semantics:** changing the base unit or conversion factors of an in-use template can change the meaning of future conversions while current stock balances have no template-version identity.
2. **P2 live-reference integrity:** rename/delete of an alternative unit can leave string-based `unit_name` references in alternate barcodes, price-list items, or held operational drafts stale.

A direct template base-unit edit can also diverge `UnitTemplate.base_unit` from an already-linked `Product.unit`; POS treats `Product.unit` as factor 1. Required invariant for linked products:

> `Product.unit === UnitTemplate.base_unit`

Historical snapshots remain immutable; do not rewrite posted documents to repair live-template changes.

---

## 6. Multiple barcode

Alternate barcode backend/API is real. Each barcode supports code, product, `unit_name`, `default_quantity`, label and creator. `ProductBarcode` stores the unit as a string; it does not hold a unit-row FK or factor snapshot.

Semantic rule:

> Barcode = what was scanned; Unit = commercial unit; Default Quantity = how many commercial units per scan; Unit Factor = base units per commercial unit; Unit Price = commercial unit price.

`default_quantity` must not be treated as conversion factor.

POS builds allowed units from the product/template and excludes alternate barcodes whose `unit_name` is no longer valid. Central UOM resolution fails closed for unknown units. Therefore no silent stale-barcode → factor-1 stock corruption was found in the reviewed POS path. A stale barcode may instead stop working, which remains a live-reference integrity problem.

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

---

## 7. Pricing

Existing: base sale price, explicit price lists, per-product/per-unit list items, customer default list, POS server-authoritative pricing, minimum sale price, authorized override with reason/actor snapshot, historical line prices.

Alternative UOM pricing is intentionally **not** derived from conversion factor × base price. A commercial alternative unit in POS requires an explicit applicable price. Preserve the separation:

> Quantity conversion ≠ Price derivation

Missing P2: product-level default UOM prices. Approved precedence:

> Product Default UOM Price → Price List Override → Customer/POS resolved price

Purchase pricing correctly distinguishes commercial quantity/unit price from base stock quantity. Purchase discounts reduce acquisition cost and inbound shipping increases it. `purchase_price` is master/default commercial price; `avg_cost` is accounting valuation and must remain distinct.

### P1 — Minimum Sale Price bypass through invoice/header discount

Confirmed: line minimum-price validation occurs before invoice/header discount, while the header discount later reduces invoice net sales and is distributed economically across revenue. Lines can individually pass the floor and then fall below it after header discount.

Required invariant:

> Effective final sale price after all economically applicable discounts, including allocated invoice/header discount, must not fall below `minimum_sale_price` unless the existing authorized minimum-price override path is used.

Fix belongs in the central invoice pricing/service policy, not as a controller-only guard.

### P2 — UOM rename/delete can orphan live Price List references

`PriceListItem` keys commercial unit prices by `product_id + unit_name`. Renaming/removing an alternative UOM can therefore leave existing price-list rows referring to the old name. This should fail closed, not migrate to a different factor silently.

---

## 8. Product import/export contract

`ProductImportFields` is the single source of truth for the flat product contract.

Current round-trip covers AWJ ID, SKU, names, type, unit, unit template, category, brand, primary barcode, sale/purchase/min prices, tax, track inventory, reorder, tags, description, internal notes and active status. `type` and `track_inventory` are update-locked for existing products through import semantics.

Correctly excluded from product master import: quantity on hand, average cost, initial quantity and stock movements.

The Product model/UI/API is richer than flat round-trip. Not all supplier, sales/COGS mappings, discount fields, profit margin, alternate barcodes and media are preserved. Therefore:

> Current round-trip is lossless for its declared flat catalog contract, but not lossless for the complete AWJ Product Master.

Keep `catalog` export distinct from `round_trip`; catalog may contain reporting quantities/costs and must not become a stock re-import source.

Approved future lossless workbook direction: Products + Barcodes + Unit Prices, with media as separate files/manifest. Stock balances never belong in Product Master round-trip.

---

## 9. Product import engine and >2,000 products

Current engine strengths: Inspect → Preview → Apply; Preview writes nothing; Apply re-reads/revalidates; Create/Update/Upsert; matching by AWJ ID then SKU; tenant-scoped matching; duplicate detection; safe blank semantics; deferred category/brand creation; unit templates not silently auto-created; transaction-protected current apply; batch-window foundation.

The current Product Catalog Import has a 2,000-row synchronous limit. Raising a constant to 50,000 is not acceptable.

Recommended future epic:

> **Large Catalog Import Jobs & Lossless Product Workbook**

Architecture: durable upload → import job → whole-file validation → frozen mapping/options → deterministic chunks → persistent progress/errors → resumable/idempotent apply → cancellation → live conflict revalidation.

**Approved accounting boundary:** Product Catalog Import remains Master Data only. Quantity/value/GL belong to Inventory Opening or later stock transactions.

---

## 10. Inventory opening and import separation

Inventory Opening is a separate accounting domain and must remain separate from Product Catalog Import.

> Catalog Import → master data only  
> Inventory Opening Import → Product + Warehouse + Quantity + Unit Cost + opening document/date

Confirmed current `InventoryOpeningImportService` limits:

- `MAX_ROWS = 2000`
- `MAX_COLUMNS = 200`
- `PREVIEW_ROW_LIMIT = 200`
- `SAMPLE_ROW_LIMIT = 5`

The workflow is explicitly staged: Inspect → Preview (read-only) → Draft. Posting is a separate fourth step in `InventoryOpeningService::post()`. Preview does not create products, warehouses, stock movements or journal entries.

Opening inventory is currently base-unit oriented; multi-UOM opening input/import is P2. Large financial/stock imports should use durable job architecture rather than merely raising the 2,000-row constant.

### Inventory Opening posting — confirmed PASS

The posting path is transaction-protected and rechecks the draft under `lockForUpdate()`, protecting against concurrent double-post. Product rows are locked before moving-average calculations. Warehouse is mandatory per line. A document may cover warehouses from different branches; branch dimension is derived from the warehouse/movement/accounting lines rather than a fake header branch.

Posting creates one journal entry for the opening document (Inventory / Opening Balances) and uses stored line `total_cost` values consistently with stock receipt values so Inventory GL and the inventory subledger are designed to reconcile to the halala. Posted openings cannot be deleted; correction uses accounting reversal. DB FKs for opening line product/warehouse are restrictive, and duplicate Product+Warehouse lines in the same opening are prevented.

PASS for the reviewed path: atomic posting, double-post protection, product locking, warehouse requirement, branch treatment, and opening accounting rounding/reconciliation design.

---

## 11. Product lifecycle reference integrity — P1

`ProductLifecycleService::referenceCounts()` is a manually maintained census. It currently covers many document/inventory references but omits at least two confirmed direct generic Product references:

- `InventoryOpeningLine.product_id`
- `DeliveryNoteLine.product_id`

Both database domains use restrictive product references, so the DB remains a final physical-delete safety line; however, the business service can incorrectly report a product as deletable and then conflict with DB/domain reality.

### P1 — Inventory identity mutation guard incomplete

`assertInventoryIdentityCanChange()` protects `type` / `track_inventory` only when it sees StockMovement, StockPermitLine, StocktakeLine or ProductWarehouseStock. It does not include `InventoryOpeningLine`.

Therefore a Draft Inventory Opening can reference a product before any stock movement exists, while the product inventory identity may still be changed. Later posting can then encounter a semantically changed product.

Required direction:

- establish a centralized Product Reference Registry/census by reference class/policy rather than relying on scattered manual `count()` additions
- distinguish transactional/history references from owned child master data
- include deletion/deactivation policy and inventory-identity mutation policy explicitly
- keep DB referential integrity as the final safety line
- add a regression/architecture test so a new Product-bearing domain cannot silently bypass lifecycle review

Confirmed false positives excluded from the generic Product census: fuel contract/card/fleet product models reference `FuelProduct`, not generic `Product`.

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

Tenant setting `inventory.allow_negative_stock` exists. Sales/Invoice COGS converts to base quantity and checks availability; no UOM negative-stock bypass was found there.

`InventoryService::applyIssue()` intentionally does not universally enforce stock availability because reconciliation/correction operations may need controlled bypass.

Invariant:

> Operational issue must enforce negative-stock policy; reconciliation/correction may bypass only intentionally and audibly.

**Stock Permit / Transfer — PASS:** availability is checked before Issue and Transfer source movements, warehouse-aware where warehouse rows exist. Legacy pre-warehouse stock can intentionally fall back to global quantity.

**Purchase Return — PASS for negative-stock enforcement:** this does not close its separate UOM/base-quantity and valuation/GL P1 findings.

---

## 14. Stock permits and transfers

Implemented: receipt/issue/transfer, draft→posted, source/target warehouses, stock+accounting transaction, issue at average cost, transfer out/in at same cost, no GL for same-branch transfer, branch-dimensional inventory reclassification for cross-branch transfer, source metadata.

### P1 — Stock Permit UOM / Base Quantity

`StockPermitLine.quantity` is treated directly as stock quantity and has no historical `unit_name`/`unit_factor` snapshot. Commercial UOM input must convert to immutable base quantity at posting.

### P2 — Stock Requests / Approval / Fulfillment

Approved target:

> Stock Request → Approval → Fulfillment → one or more/partial Stock Permits

A Stock Request itself has **no stock or GL effect**. Partial fulfillment is allowed by design.

---

## 15. Returns

Sales-return inventory handling is comparatively strong and can use historical invoice UOM factor; restock vs damage/non-restock is separated.

### P1 — Purchase Return UOM / Historical Base Quantity

Purchase return lines do not preserve equivalent historical UOM/base-quantity semantics. Returning 1 carton originally factor 24 can risk issuing 1 base piece.

### P1 — Purchase Return Inventory Valuation / GL Reconciliation

Supplier credit/commercial return value and inventory carrying value can diverge. Required invariant:

> Δ Inventory GL 1140 = Δ Inventory Subledger

These two purchase-return fixes should ship together. Purchase Return negative-stock enforcement is separately PASS.

---

## 16. Stocktake

Stocktake is base-unit oriented; multi-UOM counting UX is P2.

### P1 — Stocktake Snapshot / Concurrent Movement Reconciliation

Opening stocktake snapshots warehouse quantity; intervening movements may occur before posting. Posting stale counted-minus-snapshot can be wrong without reconciliation/version validation.

The target is hardening of the existing stocktake foundation, not a Stocktake V2 rebuild.

---

## 17. Delivery Notes and POS held sales — reviewed dependencies

### Delivery Notes — PASS for stock/GL ownership

The reviewed Delivery Note flow is operational/non-financial: confirming a Delivery Note does not itself issue inventory or create GL entries. This avoids a double-stock-effect path where both Delivery Note and Invoice would issue the same stock under the current architecture.

Delivery Note lines snapshot product identity plus `unit_name` and `unit_factor`. Confirm revalidates current unit/factor compatibility and fails closed if conversion semantics changed. This protects against silently confirming a draft under a different factor, although it also demonstrates why unsafe in-use UOM mutation can break live drafts.

### POS Held Sales — P2 live-reference integrity

Held POS sales are operational drafts with no Invoice, Payment, Stock Movement or Journal Entry effect. They persist product, quantity, unit, price/tax/discount information but do not snapshot `unit_factor`. Resume is protected by cashier/warehouse/session rules and `lockForUpdate()` against conflicting pickup.

A UOM rename/delete/factor change can invalidate a held cart's live unit reference. This must fail closed or be explicitly repaired; it must never silently reinterpret the held quantity under a new factor.

---

## 18. Inventory reporting / workspace

Current `/inventory` is primarily a global Inventory Balance / Valuation Report, not a full Warehouse Inventory Workspace. It returns product-level quantity, average cost, stock value and total inventory value. Current filter/report layer lacks warehouse dimension.

Web page loads the full result then searches/filters/sorts/paginates client-side.

### P2 — Server-side Inventory DataTable

Required for 20k–50k catalog scale. Reuse existing server-side filter concepts used by export.

### Inventory export scalability — PASS for current target

Inventory export is already server-side, uses streaming/chunked processing, has deterministic ordering, and supports a 50,000-row cap. Do not rebuild it merely because the Inventory screen needs server-side pagination.

### P2 — Warehouse dimension / Low Stock / Movement drilldown

Expose Product × Warehouse from the existing warehouse core. First low-stock stage: In Stock / Low / Out / Negative. Movement UX should expose normalized source/document drilldown from existing source metadata.

---

## 19. Central sensitive cost authorization — confirmed P1

Sensitive fields include at minimum: purchase price, average cost, profit margin, stock value, movement unit cost, movement total cost. Sale price is not cost.

Confirmed exposure surfaces include:

- generic Product list/show resource
- Product Activity historical diff
- Product export where applicable
- Inventory list/valuation
- Inventory export
- Stock Movement unit/total cost
- cost/value filters and sorting
- product update/import cost writes requiring policy hardening

Generic `ProductResource` exposes cost/profit unless a POS-specific transient hide flag is set. Product Activity records the full dirty diff and returns it raw, so historical cost changes can leak even if the current Product resource is later redacted.

Inventory APIs expose `avg_cost`, `stock_value`, total valuation, and movement unit/total cost without a central `products.view_cost` gate in the reviewed path. Inventory export includes Average Cost and Inventory Value. Cost/value filters and sorts must also be blocked for unauthorized users to prevent inference side channels.

Required policy:

- without cost permission, quantity/warehouse operational access may remain
- valuation/cost fields must be omitted/redacted at backend
- cost/value filters and sorting must be rejected/disabled
- operational exports may remain available but omit cost/value columns
- Product Activity diff must redact sensitive fields
- centralize sensitive-field policy rather than scattering field lists

Approved initial write rule:

> non-cost edits = `products.manage`  
> cost edits/import = `products.manage` + `products.view_cost`

### Default role grants — verified

`products.view_cost` exists as an explicit independent permission. System role source-of-truth confirms:

- `owner` — `*`, therefore has cost permission
- `admin` — `*`, therefore has cost permission
- `accountant` — does **not** receive `products.view_cost` by default
- `staff` — does **not** receive `products.view_cost` by default
- custom roles receive it only when explicitly granted

The roles migration seeds existing tenants from this system-role matrix, preserving those defaults unless the tenant later customizes its role rows.

POS itself is comparatively strong here: cost/profit exposure requires the cost permission plus the relevant POS visibility setting; the stricter rule wins.

---

## 20. Product & Inventory settings — reviewed and future decision surface

Confirmed/reviewed AWJ settings include Serial/batch/expiry coming soon, negative stock allow/stop, show stock quantities, and restock sales returns.

Roadmap must retain Default Warehouse/warehouse-required policy, Stocktake basis/cutoff, Stock Requests, Low Stock/Reorder, cost visibility, available/reserved quantities, future detailed tracking, and weighted-barcode as Needs Decision where not approved.

---

## 21. Future tracking, reservations, replenishment and variants

### P2 — Serial/Lot/Expiry

Approved target: Quantity-only/Lot/Serial tracking; expiry Off/Optional/Required; Product + Warehouse + Tracking Identity balance; tracking sum equals warehouse quantity; base quantities; global moving average; FEFO as selection not valuation; no negative quantity per tracking identity.

### P2 — Reservations / Available Quantity

Use durable `StockReservation` records:

> On Hand = physical/subledger truth  
> Reserved = active durable commitments  
> Available = On Hand - Active Reservations

### P2/P3 — Replenishment

P2: warehouse reorder point/target, preferred supplier, lead time, Low Stock Center, transfer-before-purchase suggestion. P3: intelligent suggestions. No automatic PO initially.

### Needs Decision

Product Variants/Attributes remain separate from Serial/Lot/Expiry identities. Weighted Barcode remains a future candidate, not an approved requirement.

---

## 22. POS and cross-domain dependencies

POS barcode/UOM resolution must remain server-authoritative and base-quantity safe. Product Quick View may expose stock according to permission, but cost/purchase price must not appear without cost authorization.

POS catalog/checkout revalidates tenant-owned products and session/device warehouse constraints server-side. Reviewed Held Sale resume also protects cashier/warehouse/session ownership. Preserve these tenant/warehouse safeguards.

Sales must preserve base conversion, warehouse-aware negative-stock enforcement, final minimum-sale-price policy, historical UOM snapshots and COGS. Purchases must preserve commercial entered quantity/price separately from base stock quantity. Returns must preserve historical base quantity and GL/subledger reconciliation.

Master data, stock state and financial transactions remain separated. Draft/review/import-preview paths must not accidentally create stock/GL effects.

---

## 23. Current confirmed P1 list

1. **Central Sensitive Cost Authorization & Data Redaction**
2. **Minimum Sale Price after Invoice/Header Discount**
3. **Purchase Return UOM / Historical Base Quantity**
4. **Purchase Return Inventory Valuation / GL Reconciliation**
5. **Stock Permit UOM / Base Quantity**
6. **Stocktake Snapshot / Concurrent Movement Reconciliation**
7. **In-use UOM Template Base/Factor Mutation Safety**
8. **Tenant-wide Primary + Alternate Barcode Namespace Integrity**
9. **Product Lifecycle Reference Census Integrity**
10. **Product Inventory-Identity Mutation Guard Completeness**

Confirmed PASS items relevant to prior open questions:

- Purchase Return negative-stock enforcement
- Stock Permit/Transfer operational negative-stock enforcement
- Inventory Opening staged preview/draft has no stock/GL effect
- Inventory Opening atomic posting / double-post protection / accounting-value design
- UOM unknown-unit resolution fails closed
- historical UOM snapshots on reviewed posted-document paths
- Delivery Note has no duplicate stock/GL posting in current architecture
- POS cost visibility has a dedicated permission/settings gate
- Inventory export scalability/chunking is adequate for the current 50k target

Closed verification items:

- Opening Import exact 2,000-row implementation path/constants — **verified**
- `products.view_cost` default system-role grants — **verified**
- `DeliveryNoteLine` missing from Product lifecycle census — **verified**
- `InventoryOpeningLine` missing from Product lifecycle census and inventory-identity guard — **verified**

Remaining audit closure work should focus on any still-unreviewed generic Product-bearing references, cost-write authorization paths, tenant/warehouse scoping edge cases, and final benchmark reconciliation. Do not reopen closed PASS items without new evidence.

---

## 24. Confirmed P2/P3 backlog

### P2

Alternate-barcode Product UI; Default Sales/Purchase UOM; Default Product UOM Prices; UOM rename/delete live-reference integrity for Barcode/Price List/Held Cart; lossless multiple-barcode import/export; Large Catalog/Opening Import Jobs; multi-UOM stocktake/opening; server-side Inventory DataTable; warehouse Inventory Workspace; Low Stock/warehouse reorder; movement source drilldown; Stock Requests/Approval/partial fulfillment; Reservations/Available Quantity; Serial/Lot/Expiry; warehouse-required/default-warehouse policy where appropriate; default supplier UX/portability; POS commercial UOM switching.

### P3/later

Media migration package; quantity-tier pricing; intelligent replenishment; bundles; manufacturing/BOM deferred; accounting mapping portability only if real migration need exists.

### Needs Decision

Product Variants/Attributes; Weighted Barcode; any workflow that delays invoice stock effects into separately approved warehouse permits; other Daftra-only capabilities not explicitly approved for AWJ.

---

## 25. Provisional PR sequence

No implementation is authorized by this record. Final ordering remains subject to audit closure.

1. **PR-PRICE-1 — Minimum Sale Price after all economically applicable discounts**
2. **PR-INV-1 — Centralize Product & Inventory Cost Authorization**
3. **PR-INV-2 — Purchase Returns Hardening** (UOM/base quantity + valuation/GL together)
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

Do not begin this sequence until the Products & Inventory audit is formally closed and the user explicitly authorizes implementation.

---

## 26. Definition-of-done principles

As applicable: tenant isolation; branch/warehouse correctness; base-UOM invariants; accounting/subledger reconciliation; authorized/unauthorized tests; historical snapshots; rollback/transaction behavior; no weakening of financial/security tests; backward compatibility; source metadata; backend/UI authorization consistency; documented build/CI before merge consideration.

Additional standing DoD:

- every new Product reference reviews lifecycle/deletion and inventory-identity protection
- every stock-affecting commercial UOM path proves conversion to immutable base quantity
- every sensitive-cost surface proves authorized and unauthorized behavior, including exports/history/filter/sort inference
- every financial stock transaction proves Inventory GL ↔ inventory subledger reconciliation where applicable
- draft/review/import preview paths prove no unintended stock/GL writes
- in-use UOM mutation tests cover base-unit, factor, rename/delete, product synchronization, barcodes, price lists and live drafts

---

## 27. Daftra benchmark position

Daftra is a competitive benchmark, not AWJ's source of truth. Use MATCH / HARDEN / ADOPT-IMPROVE / INTENTIONALLY DIFFERENT / NEEDS DECISION.

Preserved conclusions:

- Multiple UOM and unit-linked barcodes are mature benchmark capabilities; AWJ preserves direct-to-base conversion and immutable historical snapshots.
- Daftra has a separate Multiple Barcode Excel import; this does not prove Product Export → Product Import is a lossless multi-barcode round-trip.
- Daftra Product Import may accept stock quantity. AWJ is **INTENTIONALLY DIFFERENT**: Product Catalog Import remains Master Data only; Inventory Opening owns opening quantity/value/accounting.
- Warehouse transfer/stocktake/returns/reporting patterns confirm competitive relevance of AWJ completion gaps but do not justify an Inventory Core rebuild.
- Serial/Lot/Expiry is a real P2 competitive gap; AWJ keeps its own tracking model/invariants.
- Cost-hiding permissions confirm cost visibility is a real permission domain; AWJ target is stronger centralized backend/data redaction.
- Weighted barcode and Product Variants/Attributes remain **Needs Decision**.

---

## 28. Overall assessment

### Strong/already present

Product catalog; categories/brands; persistent media; warehouses; per-warehouse balances; stock movements; perpetual inventory; moving average; sales COGS; purchase valuation; price lists/per-UOM prices; POS authoritative pricing; minimum-price override/audit foundation; stock permits/transfers; opening inventory; stocktake foundation; safe product import workflow; export infrastructure; alternate-barcode backend/POS; historical UOM snapshots; strong Inventory Opening posting path.

### Hardening before expansion

Minimum sale price after header discount; central cost authorization; purchase-return UOM/valuation; stock-permit UOM; stocktake concurrency; in-use UOM mutation; tenant barcode namespace; complete Product lifecycle reference/identity protection.

### Completion after hardening

Multiple-UOM/barcode UX/workbook; large async imports; warehouse-aware inventory workspace; low stock/replenishment; reservations; serial/lot/expiry; stock requests/approvals; POS commercial UOM completion.

### Deliberately not immediate

Inventory Core/V2 rebuild; per-warehouse costing redesign; stock quantity in Product Catalog Import; editable reserved quantity; automatic PO; variants mixed with tracking identities; uncontrolled master-data creation from transactions; copying Daftra merely for parity.

---

## 29. Audit continuation / closure checklist

Before formal closure:

1. complete remaining generic Product-reference census beyond the confirmed `InventoryOpeningLine` / `DeliveryNoteLine` omissions
2. complete cost-write authorization census for Product update/import and related write surfaces
3. verify remaining tenant/branch/warehouse scoping edge cases in Product/Inventory write paths
4. reconcile any remaining Daftra Product & Inventory benchmark areas with evidence
5. finalize P1/P2/P3 mapping and PR order without starting implementation

This record is a **living working source of truth**. Confirmed findings must be updated here rather than held only in chat.

---

## 30. Standing conclusion

> **Do not rebuild AWJ inventory core.**  
> **Complete and harden the existing Products & Inventory architecture.**

This working record preserves confirmed/approved findings through the current review state. Formal audit closure has not yet been declared.