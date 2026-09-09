# AWJ Inventory Valuation Semantics

**Date:** 2026-09-09
**Status:** Inspection — documents current, code-verified behavior. Does not authorize implementation.
**Purpose:** Establish AWJ's actual inventory quantity/valuation model with code-backed evidence, as the prerequisite for deciding how Warehouse Scope should affect `/api/inventory/export` and `InventoryReportService::trackedProducts()` (`view=value`) — the P2 gap left open by `docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md` §36.
**Related, already-authoritative sources reconciled here (not duplicated):**
`docs/audits/AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md` §2 (invariants #11/#12), §12, §27; `docs/plans/accounting/ACC-5-inventory-cogs-account-routing.md` (Transfers); `docs/plans/products-inventory/DECISION_REGISTER.md` D-07 ("Per-warehouse costing — DECIDED: NO in current program — global Product moving average"). This document adds direct code citations and executable proof; it does not reopen or contradict those prior decisions.

---

## 1. Current Model Classification

## **MODEL C — Hybrid, with a clearly defined boundary.**

- **Regular tracked products** (the overwhelming majority — everything reached through Purchases, Sales/Invoices, POS, Returns, Stock Permits/Transfers, Stocktake, Inventory Opening): **MODEL A — Tenant-wide Moving Average.** `Product.avg_cost` is the single authoritative unit cost for the whole tenant; warehouses track physical quantity/location only; COGS uses that same tenant-wide average regardless of source warehouse.
- **Fuel products** (linked via `FuelProduct.product_id` to a real `Product` row, sold through `FuelSaleService`, received through `FuelSupplyReceivingService`): carry a **genuine, separate, warehouse-specific cost ledger** (`FuelInventoryCostState` / `FuelCostBasisService`), keyed by `(warehouse_id, fuel_product_id)`, that is authoritative for **Fuel COGS specifically**. This is a real MODEL B mechanism, but it is a **documented, bounded exception** confined to the Fuel module — it does not generalize to regular retail products, and the shared `Product.quantity_on_hand`/`avg_cost` fields are still written alongside it (as a blended, non-authoritative-for-Fuel-COGS byproduct).

For the purposes of the P2 access-control decision this document exists to unblock — `/api/inventory/export` and `view=value`, which read generic `Product` columns for **all** tracked products including fuel — the operative model is **MODEL A**: neither surface consults `FuelInventoryCostState` at all, so from their point of view every product (fuel included) is a single tenant-wide scalar.

---

## 2. Quantity Authority

**`Product.quantity_on_hand`** — tenant-wide integer, base-UOM quantity. Updated by every stock-affecting write path (§2 evidence below) in lockstep with **`product_warehouse_stock.quantity`** (per `(product_id, warehouse_id)`, unique-constrained).

**Invariant tested:** `Product.quantity_on_hand = Σ product_warehouse_stock.quantity` (across all the product's warehouse rows) — **DERIVED**, not database-enforced, but structurally guaranteed by construction: `InventoryService::adjustWarehouseStock()` is *"the only path that writes `product_warehouse_stock`"* (its own doc-comment, `InventoryService.php:417-425`), and every caller that changes `Product.quantity_on_hand` also calls it with the identical `$delta` in the same method body. No code path was found that changes one without the other.

**Exception:** when no warehouse can be resolved (`resolveWarehouseId()` returns `null` — pre-warehouse-era documents, or a tenant with zero warehouses), the movement updates `Product.quantity_on_hand` but skips `adjustWarehouseStock()` entirely (`InventoryService.php:427-431`: early return when `$warehouseId === null`). `StockPermitTest::pre_warehouse_stock_falls_back_to_the_company_total` (line 332) proves this is intentional legacy-compatible behavior, not a bug — such quantity is real but has no warehouse location, exactly like pre-branch documents under `BranchScope`.

### Writers traced (all confirmed to update both representations together, via `InventoryService::applyReceipt()`/`applyIssue()`/`adjustWarehouseStock()`)

| Source | Method / file | Cost source used |
|---|---|---|
| Purchases / purchase receipts | `PurchaseService.php:530` → `applyReceipt()` | `product.avg_cost`-recomputing formula (see §3) |
| Sales / invoices (incl. POS, which posts ordinary `payment_type=credit` invoices through the same `InvoiceService::post()`) | `InvoiceService::post()` → `InventoryService::recordSaleCogs()` (`InventoryService.php:203-296`) | `$product->avg_cost` directly (line 236) |
| Sales returns (restock) | `ReturnService.php:472` → `applyReceipt()` | `$product->avg_cost` **at return time** (not the original sale's historical cost — see §9 note) |
| Purchase returns | `ReturnService.php:768` → `applyIssue()` | `$product->avg_cost` at return time |
| Stock adjustments (manual receipt/issue permits) | `StockPermitService::applyReceipt()`/`applyIssue()` (lines 172-221) → `InventoryService::applyReceipt()`/`applyIssue()` | line's entered unit cost (receipt) / `avg_cost` (issue) |
| Stocktakes (count variance) | `StocktakeService.php:191-204` | `(int) $product->avg_cost` for both surplus (`applyReceipt`) and shortage (`applyIssue`) |
| Warehouse transfers | `StockPermitService::applyTransfer()` (`StockPermitService.php:231-260`) | `$product->avg_cost`, identical on both issue and receipt legs — see §6 |
| Opening inventory (single product) | `InventoryService::recordOpeningStock()` (line 190) → `receiveStock()` → `applyReceipt()` | `product.purchase_price` as the initial unit cost |
| Opening inventory (bulk import) | `InventoryOpeningService` → same `applyReceipt()` primitive (per `CLAUDE.md`'s "الأرصدة الافتتاحية للمخزون" contract: one journal entry for the whole document, values from actual created movements) | line's entered unit cost |
| Fuel supply receiving | `FuelSupplyReceivingService.php:126-136` → `InventoryService::applyReceipt()`, **plus** `FuelCostBasisService::recordReceipt()` (separate, warehouse-keyed ledger) | delivery's own received unit/total cost, blended into `Product.avg_cost` **and** recorded exactly into the warehouse-specific `FuelInventoryCostState` |
| Fuel sales | `FuelSaleService.php:203-212` → `InventoryService::applyIssue()` with `$unitCost` sourced from `FuelCostBasisService::quoteIssue()` (warehouse-specific), **not** from `$product->avg_cost` directly | the fuel warehouse-specific cost basis (see §1, §5) |
| Delivery notes | Confirmed operational/non-financial per the 2026-09-05 audit §17 — no stock/GL effect; out of scope for valuation |
| Reconciliation/rebuild commands | **None exist.** `php artisan inventory:diagnose` (`DiagnoseInventoryCommand.php`) is **read-only** — it reports drift, it does not correct it (own doc-comment: *"الأمر لا يصلح شيئاً عمداً: التصحيح قرار محاسبي"* — "the command deliberately fixes nothing: correction is an accounting decision") |

No asymmetry was found among the regular (non-Fuel) writers — every one reads/writes the same tenant-wide `Product.avg_cost` via the same two primitives (`applyReceipt`/`applyIssue`), confirmed by direct reading of each service listed above.

---

## 3. Valuation Authority

**`Product.avg_cost`** is a **tenant-wide moving weighted average**, in minor units (halalas), recomputed only on receipt-type movements (issues never change it — `InventoryService.php:137`: *"المتوسط لا يتغيّر عند الإخراج"*).

**Formula** (`InventoryService::applyReceipt()`, lines 105-110):
```
oldValue = oldQty * product.avg_cost
newQty   = oldQty + receiptQty
newValue = oldValue + receiptLineValue        // receiptLineValue = totalCost if given, else qty*unitCost
newAvg   = newQty > 0 ? intdiv(newValue, newQty) : 0
```
Integer division (`intdiv`), floor-rounded — no `float` anywhere, consistent with the project-wide minor-units rule.

**Every meaningful writer/recalculator**, with old/new state mapped to the formula above:

| Writer | old qty / old cost | incoming qty / cost | new qty | new avg_cost |
|---|---|---|---|---|
| `InventoryService::applyReceipt()` (Purchases, Stock Permit receipt, Fuel receiving, Opening) | `product.quantity_on_hand` / `product.avg_cost` | `$quantity` / `$unitCost` (or exact `$totalCost` when supplied, e.g. tax-inclusive purchases) | `oldQty + quantity` | `intdiv(oldValue + lineValue, newQty)` |
| `InventoryService::applyIssue()` (Sales COGS, purchase returns, Stock Permit issue, Fuel sale, Stocktake shortage) | — | — | `oldQty - quantity` | **unchanged** — issues never move the average |
| `StockPermitService::applyTransfer()` | — | reuses `$product->avg_cost` as **both** the issue-leg and receipt-leg unit cost | net **0** (issue then receipt of the same qty) | mathematically **unchanged** (a weighted average of identical values is itself unchanged) |

**No inconsistency found.** All non-Fuel writers converge on the identical formula via the identical two primitives. The one deliberately different formula is Fuel's exact-fraction (`bcmath` numerator/denominator, not floor-rounded) per-warehouse pool in `FuelCostBasisService`, which is **intentional** (its own doc-comment: *"القيمة الدقيقة المتبقية كسـر... حتى لا ينشأ drift تراكمي"* — exact fractional remainder carried forward specifically to prevent cumulative rounding drift across many small milliliter-scale fuel transactions) and **scoped to Fuel only** — not evidence of a general-purpose inconsistency.

---

## 4. `product_warehouse_stock` Schema and Semantics

Migration `2025_01_01_000033_create_warehouses.php:38-48`, later `2026_09_06_030000_add_revision_to_product_warehouse_stock.php`. Full column list, exhaustively confirmed against every migration touching this table:

`id`, `tenant_id`, `product_id`, `warehouse_id`, `quantity` (integer, base UOM), `revision` (monotonic counter, bumped on every real movement — used by `StocktakeService` to detect concurrent movement since a count snapshot, per PR-INV-4), `timestamps`. Unique on `(product_id, warehouse_id)`.

**No `avg_cost`, `unit_cost`, `stock_value`, or `last_cost` column exists, and none is derived elsewhere for this table.** `InventoryService::adjustWarehouseStock()`'s own doc-comment states this as design intent: *"لا يمسّ القيمة — التقييم عالمي على المنتج (products.avg_cost)"* — "does not touch value — valuation is global on the Product."

**Can `product_warehouse_stock` currently produce an accounting-correct warehouse-specific inventory value without inventing new semantics?**

## **NO.**

Evidence: the table stores quantity only; no per-warehouse cost has ever been written to it by any regular (non-Fuel) writer; and `InventoryReportService::trackedProducts()`'s own doc-comment (written during PR #736) independently reaches the identical conclusion for the same reason: *"quantity_on_hand و avg_cost قيمتان عالميتان على Product نفسه... لا مجموعتان قابلتان للتفكيك حسب المخزن دون إعادة بناء الاستعلام"* — not decomposable per warehouse without a query redesign.

Fuel is the one exception with a genuine per-warehouse cost pool (`FuelInventoryCostState`), but that table is Fuel-specific (keyed by `fuel_product_id`, not generic `product_id`) and is not consulted by `product_warehouse_stock`, `/api/inventory/export`, or `view=value` today.

---

## 5. COGS Contract

**Traced, not inferred:**

- **Normal sales / POS sales** (identical code path — POS invoices are ordinary `Invoice` rows posted through the same `InvoiceService::post()`): `InventoryService::recordSaleCogs()`, `InventoryService.php:236`: `$unitCost = $product->avg_cost;` — read directly, unconditionally, regardless of `$warehouseId` (which is used only for the movement's location tag and the `assertStockAvailable()` quantity check, lines 213-234).
- **Sales returns/reversals:** `ReturnService.php:468`, `$unitCost = $product->avg_cost;` — the average **at return-processing time**, not the historical cost at the original sale (own code comment: *"التكلفة بمتوسط اليوم في الحالتين — هو الأساس الذي خرجت به"*).
- **Purchase returns:** `ReturnService.php:768`, same `(int) $product->avg_cost`.
- **Any other stock-issue flow that posts accounting entries** (Stock Permit issue, Stocktake shortage): confirmed at `StockPermitService.php:208` and `StocktakeService.php:191/204` — same `$product->avg_cost` source.
- **Fuel sales — the one exception:** `FuelSaleService.php:203-206` computes `$unitCost` via `FuelCostBasisService::quoteIssue($fuelProduct, $warehouse, quantity)` — a genuinely **warehouse-specific** cost pool, not `$product->avg_cost`. This is real, intentional, and documented (§1, §3).

**Is AWJ's COGS currently calculated using one tenant-wide moving average regardless of warehouse?**

## **YES, for every product type except Fuel.** Proven executably: the new characterization test `moving_average_and_cogs_are_tenant_wide_across_warehouses` (`tests/Feature/InventoryTest.php`) receives 10 units @ 10 SAR into Warehouse A, then 10 units @ 20 SAR into Warehouse B (tenant-wide average becomes 15 SAR), then sells 1 unit from each warehouse separately and asserts both resulting `StockMovement.unit_cost` values equal **1500 halalas (15 SAR) — identical**, not 1000 for A's sale and 2000 for B's.

---

## 6. Warehouse Transfer Findings

`StockPermitService::applyTransfer()` (`StockPermitService.php:231-260`), own doc-comment: *"إخراج من المصدر وإدخال إلى الوجهة **بنفس الكمية الأساس ونفس متوسط التكلفة**، فلا يتغيّر المتوسط ولا إجمالي قيمة المخزون"* — issue from source and receipt into destination at the **same** base quantity and the **same** average cost, so neither the average nor total inventory value changes.

- **Total `Product.quantity_on_hand`:** unchanged (issue subtracts, receipt adds back the identical quantity, net zero within the same transaction).
- **`Product.avg_cost`:** unchanged (mathematically — a weighted average of identical unit values stays that value; also proven by the existing tracked test `StockPermitTest::an_internal_transfer_moves_stock_without_any_journal_entry`, asserting `avg_cost` stays `10000` across a 30-unit transfer).
- **Source/destination warehouse quantities:** correctly move via `adjustWarehouseStock()` on both legs — proven by the same test: source `70`, destination `30` after a 30-of-100 transfer (lines 215-216).
- **Does any cost follow the transferred stock?** No separate cost record — there is nothing to follow, since `product_warehouse_stock` carries no cost column (§4). The transfer reuses the current tenant-wide rate on both legs.
- **Accounting entries:** **same-branch transfer → none at all** (`buildEntry()`, `StockPermitService.php:276-278`: *"تحويل داخلي — لا أثر على الدفتر العام"*). **Cross-branch transfer → one journal entry, same `inventory_asset` GL role debited (destination branch) and credited (source branch)**, net zero for the tenant — proven by `StockPermitTest::a_cross_branch_transfer_posts_a_zero_sum_entry_tagged_per_branch`. No transfer-clearing or valuation-adjustment account exists (matches ACC-5's explicit "no transfer-clearing role").
- **Any warehouse-specific valuation state?** None, for regular products (confirmed above). For Fuel specifically, `FuelCostBasisService` has no `transfer` primitive at all in the reviewed code — Fuel transfers were not found to have a warehouse-cost-pool-aware transfer path; this is noted as an open question for the Fuel domain specifically, not the regular retail path this inspection was commissioned to unblock.

**Conclusion:** a warehouse transfer reveals the valuation boundary precisely — it is the **tenant**, not the warehouse. Physical location moves; the single company-wide rate does not.

---

## 7. Branch Findings

`Product` uses the `BranchScoped` trait (`Product.php:23-25`) — this governs **visibility** (implicit `BranchScope` global scope, filtering to `branch_id = active BranchContext OR branch_id IS NULL`, itself validated against the actor's allowed branches by the pre-existing `SetBranch` middleware — see the living access-control reference §36). It has **no valuation meaning whatsoever**.

Confirmed by the transfer evidence in §6: a cross-branch transfer debits/credits the **same** `inventory_asset` GL account, differentiated only by the `branch_id` **dimension tag** on the journal lines — exactly the same account, same rate, same value, just relabeled. There is no "Branch A's inventory value" as a distinct ledger balance; there is one tenant-wide 1140 balance, optionally sliced by branch dimension for reporting (as ACC-5 already does for journal lines), never for costing.

**Is inventory valuation currently Tenant-wide, Branch-wide, Warehouse-wide, or mixed?**

## **Tenant-wide**, for regular products (Model A), with Fuel's documented warehouse-specific exception (Model B) layered on top for COGS purposes only — never branch-wide.

---

## 8. GL / Accounting Findings

- **Does GL inventory (1140) represent one tenant-wide value?** Yes — confirmed by `DiagnoseInventoryCommand.php:87-88,125`, whose own invariant comment states plainly: *"الثابت: رصيد 1140 يجب أن يساوي Σ(كمية × متوسط) بلا فارق هللة"* — "the invariant: 1140's balance must equal Σ(quantity × average) with no halala's difference" — a **tenant-wide** sum across every product, not per-branch or per-warehouse.
- **Branch dimension in journal lines?** Yes, as a **tag only** (cross-branch transfers, per §6/§7) — never as a separate valuation.
- **Warehouse dimension in journal lines?** **No.** No journal line anywhere in the reviewed code carries a `warehouse_id` — only `branch_id`. `StockMovement` rows carry `warehouse_id` (operational/quantity record), but the accounting journal lines they cause do not.
- **Can GL balances currently be reconciled to warehouse-specific inventory value?** **No** — there is no warehouse-specific inventory value to reconcile to (§4). GL 1140 reconciles only to the tenant-wide `Σ(quantity_on_hand × avg_cost)`, and does so by design (the diagnose command exists specifically to verify this single invariant).

---

## 9. Invariant Matrix

| Invariant | Classification | Evidence |
|---|---|---|
| `Product.quantity_on_hand = Σ product_warehouse_stock.quantity` | **DERIVED** (structurally guaranteed by `adjustWarehouseStock()` being the sole writer, called in lockstep by every quantity-changing path) | `InventoryService.php:106-128, 150-176, 427-438`; exception is intentional (pre-warehouse-era null-warehouse movements, `StockPermitTest::pre_warehouse_stock_falls_back_to_the_company_total`) |
| `GL 1140 balance = Σ(Product.quantity_on_hand × Product.avg_cost)` (tenant-wide) | **BEST-EFFORT, monitored** — not database-enforced, holds under every correct write path, but has one documented failure mode | `DiagnoseInventoryCommand.php` exists precisely to detect drift; its own doc-comment names the exact corruption mechanism: negative stock (from `allow_negative_stock`) skews the moving-average formula for all subsequent receipts, and the command is read-only by design — correction is an accounting decision, not automated |
| Warehouse transfer does not change tenant-wide quantity or value | **ENFORCED by construction** (mathematically follows from the issue-then-receipt-at-identical-rate implementation; not merely assumed) | `StockPermitService.php:231-260`; executable proof in `StockPermitTest::an_internal_transfer_moves_stock_without_any_journal_entry` and `a_cross_branch_transfer_posts_a_zero_sum_entry_tagged_per_branch` |
| COGS uses the same tenant-wide average regardless of source warehouse (non-Fuel) | **ENFORCED by construction** | `InventoryService.php:236`; executable proof in this inspection's new `moving_average_and_cogs_are_tenant_wide_across_warehouses` test |
| `avg_cost` unchanged by issue-type movements | **ENFORCED by construction** (issue methods never touch `avg_cost`) | `InventoryService::applyIssue()`, lines 139-179 — no `avg_cost` write anywhere in the method |
| Fuel COGS uses a warehouse-specific cost basis, independent of `Product.avg_cost` | **ENFORCED by construction**, scoped to Fuel only | `FuelCostBasisService.php` (full file); `FuelSaleService.php:203-212` |

---

## 10. Scenario Matrix

**A.** Warehouse A receives 10 units @ 10 SAR (1000 halalas). Result: `Product.quantity_on_hand = 10`, `Product.avg_cost = 1000`, A = 10, B = 0.

**B.** Warehouse B then receives 10 units @ 20 SAR (2000 halalas). Result: `Product.quantity_on_hand = 20`, `Product.avg_cost = 1500` (= `(10*1000 + 10*2000) / 20`), A = 10 (untouched), B = 10.
- *What is the accounting value of Warehouse A according to current AWJ?* **Not separately stored or determinable from persisted state.** No column, movement aggregate, or report anywhere records "Warehouse A's 10 units are still worth 1000/unit." The only authoritative unit rate in the system is the blended 1500.
- *Can current stored state answer that question correctly?* **No** — by design (Model A). Any number produced for "Warehouse A's value" would have to be computed as `A's quantity × the tenant-wide rate` (10 × 1500 = 15000), which is a **different number** from A's actual original cost basis (10 × 1000 = 10000). See §14 for whether that computed number is still meaningful.

**C.** Transfer A→B. No valuation information follows the transferred units — none exists to follow (§6). Quantities correctly relocate; the single company-wide rate and total value are unchanged.

**D.** Sell identical product from A vs. B. **COGS does not differ by warehouse** — both postings use the same `Product.avg_cost` (proven executably, §5, §10).

All four scenarios were proven with the new characterization test (`tests/Feature/InventoryTest.php::moving_average_and_cogs_are_tenant_wide_across_warehouses`) plus existing tracked tests (`StockPermitTest::an_internal_transfer_moves_stock_without_any_journal_entry`, `a_cross_branch_transfer_posts_a_zero_sum_entry_tagged_per_branch`, `InventoryTest::moving_average_cost_is_recomputed_on_each_receipt`).

---

## 11. Access-Control Options — evaluated separately per field

### Option A — Hide products outside allowed warehouses

**Security:** clean — a restricted user genuinely cannot infer anything about a product that has zero stock in their allowed warehouses. **Product/UX implication:** a shared catalog item stocked in a forbidden warehouse would vanish from a restricted user's export/report entirely, even though the same user can already see that product's **catalog identity** (name/SKU/barcode) elsewhere in the system (Products screen, per §36's existing `BranchScope`-governed identity visibility) — this creates an inconsistency between "the product exists and I can find it" and "the product does not appear in my inventory export," which may confuse rather than protect. Workable, but a genuine UX regression versus today.

### Option B — Recompute restricted quantity/value from allowed warehouses

**These are three separate questions, not one, per the task's own instruction:**

- **`quantity`:** **Valid and safe to warehouse-scope.** `product_warehouse_stock.quantity` is real, per-warehouse, correctly maintained data (§2, §4) — summing it over the user's allowed warehouses produces a genuinely accurate number, not an invented one. `SUM(product_warehouse_stock.quantity WHERE warehouse_id IN allowed)` is exactly the same kind of intersection `ReportWarehouseScope` already performs elsewhere.
- **`avg_cost`:** **Not valid to warehouse-scope** — there is no warehouse-specific cost to recompute from (§4 answered NO). Any "recomputed" avg_cost would have to be invented (e.g., re-deriving a new weighted average from only the movements that happened to occur in the allowed warehouses), which would produce a number that **never existed as a real system state** and would not reconcile to anything — a fabricated figure, not a scoped one.
- **`stock_value`:** follows `avg_cost`'s answer, **unless** computed as `scoped quantity × tenant-wide avg_cost` — see §12 (Candidate Contract), which is a different, valid construction from "recompute avg_cost per warehouse."

**It is exactly as valid to warehouse-scope quantity as it is invalid to warehouse-scope `avg_cost` directly** — the task's own hint that these might have different answers is correct.

### Option C — Keep tenant-global inventory figures

A warehouse-restricted user would learn: the company's total quantity and average cost/value for every tracked product, including products entirely absent from any warehouse they can access. Classification:

**A combination — acceptable product policy for `avg_cost` specifically (there is no other truthful number to show), but a genuine information-disclosure question for `quantity`/`stock_value`** (a user restricted to one warehouse learning the company's total stock position across warehouses they have no operational reason to see). Not an "accounting necessity" in the sense of being required by GAAP or the ledger — it is a necessity only in the narrow sense that no warehouse-specific `avg_cost` exists to substitute it with (§4). Whether showing the tenant-wide *quantity* to a warehouse-restricted user is acceptable is a product/security policy decision, not an accounting one.

---

## 12. Candidate Contract Evaluation

> Catalog identity: existing Product/Branch visibility
> Displayed quantity: sum of quantities in Effective Warehouse Scope
> Accounting `avg_cost`: tenant-wide `Product.avg_cost`
> Displayed restricted stock value: scoped quantity × tenant-wide authoritative `avg_cost`

**Is this mathematically and accounting-semantically consistent with AWJ's current valuation model? Yes — with one clearly stated caveat, and it is a materially different claim from "warehouse-specific valuation."**

**Mathematical consistency:** because `avg_cost` is a single tenant-wide rate, `Σ over all warehouses of (warehouse_qty × avg_cost)` is **exactly** `total_qty × avg_cost` — the same number the system already treats as the authoritative total inventory value for that product (the exact formula `DiagnoseInventoryCommand` uses to reconcile against GL 1140, §8, §9). A warehouse-scoped slice of that sum is therefore a genuine, exact **partition** of a real, GL-reconciled total — not an invented figure. (Caveat: because `avg_cost` itself is floor-rounded via `intdiv`, and each warehouse's slice would independently multiply integer quantity by that already-rounded rate, the sum of independently-displayed warehouse slices can differ from the single company-wide total by at most a few halalas of pure display rounding — the same class of cosmetic rounding the system already tolerates elsewhere, not a valuation error.)

**Semantic distinction from Model B:** this contract does **not** claim "Warehouse A's units cost 1000/unit" (a historical, warehouse-specific claim the system has no data to support — §10 Scenario B). It claims "if valued today at the company's single authoritative rate, the units physically located in Warehouse A are notionally worth `A's real quantity × that rate`" — a **current-rate, quantity-scoped display convention**, not a warehouse-specific costing method. It uses only two numbers that are both already real and authoritative in the system today (`product_warehouse_stock.quantity`, `Product.avg_cost`) and combines them with the exact same multiplication the system already performs at the whole-product level.

**This is a legitimate, implementable middle ground** distinct from both Option A (hide entirely) and naively warehouse-scoping `avg_cost` (Option B's invalid half). It does not require inventing new semantics, does not touch `Product.avg_cost`'s meaning, and reconciles to the existing GL invariant when summed.

---

## 13. Risks / Existing Inconsistencies (documented, not fixed)

- **Negative-stock corruption is real and unmonitored automatically.** `allow_negative_stock` is a tenant setting; when enabled (or when a race allows an oversell), `Product.avg_cost` becomes mathematically corrupted for all subsequent receipts (`DiagnoseInventoryCommand`'s own worked example: quantity −7, then a 10-unit purchase at 200 SAR/unit yields an average of 433.33, not 200). The diagnostic command exists and is read-only; there is no automatic guard preventing this drift from happening, only a report that can detect it after the fact. This is a pre-existing, already-known risk (documented in the 2026-09-05 audit as "Negative stock policy," §13) — not newly discovered here, and explicitly not something this inspection fixes.
- **Sales-return restock cost is "today's average," not the original sale's historical cost** (§2, §5). A product whose `avg_cost` has moved between the original sale and its return will restock at a different unit cost than it left at. This is a documented design choice (own code comment), not a bug, but worth carrying forward as a known characteristic when reasoning about valuation precision.
- **Fuel's dual-ledger design** (tenant-wide `Product.avg_cost` written alongside a separate, authoritative-for-Fuel-COGS `FuelInventoryCostState`) means a fuel product's `Product.avg_cost` — the same field `/api/inventory/export` and `view=value` read — reflects a blended figure that is **not** what actually drove that product's own COGS at any specific station. This inspection did not find a Fuel-specific transfer primitive in `FuelCostBasisService`; if one does not exist, an inter-station fuel transfer's cost-basis handling is an open question outside this inspection's regular-retail-product scope.
- **No automated reconciliation/rebuild exists** for `quantity_on_hand`/`avg_cost` drift of any kind (§2, §9) — correction, if ever needed, is manual and accounting-directed by design.

---

## 14. Tests / Evidence

**Existing, tracked, reused (not duplicated):**
- `tests/Feature/InventoryTest.php::moving_average_cost_is_recomputed_on_each_receipt` — moving-average formula.
- `tests/Feature/InventoryTest.php::selling_a_tracked_product_posts_cogs_and_reduces_stock` — COGS posting mechanics.
- `tests/Feature/StockPermitTest.php::an_internal_transfer_moves_stock_without_any_journal_entry` — transfer leaves `avg_cost`/total quantity unchanged; per-warehouse quantities correctly split; no journal for same-branch.
- `tests/Feature/StockPermitTest.php::a_cross_branch_transfer_posts_a_zero_sum_entry_tagged_per_branch` — cross-branch transfer, same GL role both sides, branch-dimension-only, net zero.
- `tests/Feature/StockPermitTest.php::pre_warehouse_stock_falls_back_to_the_company_total` — the one intentional exception to the quantity-per-warehouse invariant.
- `tests/Feature/FuelSaleServiceTest.php` (existing suite) — Fuel's separate cost-basis mechanics, not re-derived here.

**New, added by this inspection (characterization only, no production code changed):**
- `tests/Feature/InventoryTest.php::moving_average_and_cogs_are_tenant_wide_across_warehouses` — executes the task's exact Scenario A/B/D numbers (10@10 SAR in Warehouse A, 10@20 SAR in Warehouse B, sells 1 unit from each) and asserts the tenant-wide average (1500 halalas) and identical COGS regardless of source warehouse. 20/20 tests pass in `InventoryTest.php` (93 assertions) with this addition, including all pre-existing tests unmodified.

---

## 15. Recommended Architecture Decision (recommendation only — not implemented)

Adopt the §12 candidate contract for `/api/inventory/export` and `view=value`:
- Catalog identity: unchanged (existing `Product`/`BranchScope` visibility).
- Displayed quantity: `Σ product_warehouse_stock.quantity` intersected with the actor's Effective Warehouse Scope (the same `ReportWarehouseScope`/`allowedWarehouseIds()` pattern used elsewhere).
- `avg_cost`: unchanged — tenant-wide `Product.avg_cost`, exactly as today (already separately gated by `products.view_cost`/`SensitiveCostPolicy`).
- `stock_value`: `scoped quantity × tenant-wide avg_cost` (not a recomputed per-warehouse average).

This closes the P2 gap's *quantity* disclosure concern (a warehouse-restricted user no longer sees quantity physically located outside their scope) without inventing warehouse-specific costing, without touching `Product.avg_cost`'s meaning, and without contradicting D-07 in the Decision Register (per-warehouse *costing* stays out of scope — this recommendation never introduces a warehouse-specific rate, only a warehouse-scoped quantity multiplied by the one existing rate).

**Open product decision this document does not make:** whether keeping the tenant-wide `quantity` visible to a warehouse-restricted user (today's behavior, Option C) is acceptable to keep permanently for some role/plan tier, versus always moving to the scoped-quantity contract above. That is a product policy call, not an accounting or code question.

---

## 16. Recommended Next PR — Implemented (2026-09-09)

**`PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE`** was implemented exactly as recommended above: `SUM(product_warehouse_stock.quantity)` intersected with the actor's Effective Warehouse Scope, multiplied by the unchanged tenant-wide `Product.avg_cost`, applied to both `/api/inventory/export` and `view=value`. `Product.avg_cost`, COGS, GL routing, `FuelCostBasisService`, and every other accounting invariant in this document were confirmed untouched by the implementation's own test suite (including this document's own §10 characterization test, `moving_average_and_cogs_are_tenant_wide_across_warehouses`, re-run unmodified and still green). Full details, evidence, and test list: `docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md` §38.

**One clarification surfaced during implementation, not previously noted here:** `GET /api/inventory` (`InventoryController::index()`, the non-export list endpoint) exposes the identical tenant-wide `quantity_on_hand`/`avg_cost`/`stock_value` scalars as the two surfaces this PR fixed, but was not one of the two named in scope — it was deliberately left untouched and is flagged as a candidate for a future, separately-scoped pass rather than folded in here.

---

**Process rule:** research/inspect → verify → document → confirm commit → summarize to Safwan. No merge, no deploy authorized by this document.
