# Implementation-Ready Packet — PR-INV-2

**State:** IMPLEMENTATION-READY; implementation not authorized.
**Current code baseline verified:** main `70501735051f7cd4632417b38b835e8057b1bd8d`.
**Contract:** `../phase-1-hardening/PR-INV-2-purchase-returns.md`

## FROM — verified current code

### Historical UOM asymmetry
Sales returns already have `ReturnService::returnLineBaseQuantity(ReturnLine, ?InvoiceLine)`, which converts a linked sales-return quantity using the historical source `InvoiceLine.unit_factor` (and precision/baseQuantity for fractional lines). Free sales returns keep legacy semantics: entered quantity is base stock quantity.

Purchase returns do not use an equivalent historical PurchaseLine conversion in `postPurchaseReturn()`.

`PurchaseLine` uses `HasUnitConversion` and persists immutable purchase snapshots:
- `quantity`
- `unit_name`
- `unit_factor`
- `unit_price`
- commercial line totals/discount/tax.

`ReturnLine` currently has no `unit_name`, `unit_factor`, or persisted base-quantity snapshot. It stores `source_line_id`, commercial `quantity`, price/tax and line totals.

### Current purchase-return stock issue
`postPurchaseReturn()` currently calls:
`InventoryService::applyIssue($product, $line->quantity, $line->unit_price, ...)`
for tracked products.

Therefore:
- raw ReturnLine commercial quantity is treated as stock/base quantity;
- original PurchaseLine historical factor is ignored;
- issue cost is supplied as ReturnLine commercial unit price rather than an authoritative inventory carrying value.

Example defect: original purchase 1 carton with historical factor 24; purchase return of 1 carton can remove 1 base unit instead of 24.

### Current GL valuation
Before issuing stock, `postPurchaseReturn()` sums tracked commercial return line net into `$inventoryTotal` and credits account 1140 by that commercial amount. Non-tracked line net credits 5150; tax credits 1150; cash/payable is debited for the commercial total.

The subsequent inventory issue is a separate calculation path. There is no explicit proof that the value removed by InventoryService/subledger equals the GL credit to 1140.

Thus current architecture can violate:
> Δ Inventory GL 1140 = Δ Inventory Subledger

whenever commercial supplier-credit economics differ from inventory carrying value.

### Existing source/quantity concurrency foundation
`ReturnService` already validates source relationships and cumulative return quantity, and `tests/Feature/ReturnFromSourceTest.php` proves:
- per-source-line quantity cap;
- cumulative posted returns;
- two drafts cannot both post beyond remaining source quantity;
- purchase return is limited by its Purchase source.

Preserve and strengthen this foundation in base quantity; do not replace it with a new returns subsystem.

## TO — two defects ship together

### Invariant A — immutable base quantity
A linked purchase return derives stock quantity from the original PurchaseLine historical UOM semantics, never from the current UnitTemplate.

For ordinary PurchaseLine:
`return_base_qty = return_commercial_qty × historical PurchaseLine.unit_factor`.

The source PurchaseLine is authoritative for linked returns. A later template rename/factor change/deletion must not reinterpret the return.

For a free/standalone purchase return with no source line, preserve explicit safe legacy semantics unless product policy says otherwise: entered quantity is base stock quantity. Do not infer a live alternative UOM from current template without an immutable source snapshot.

### Invariant B — exact carrying-value reconciliation
Tracked inventory leaves the subledger at the authoritative carrying value under AWJ's current **global moving-average** architecture.

The GL credit to 1140 must equal exactly the value removed from inventory subledger in minor units.

Commercial supplier-credit economics remain separate:
- amount owed/refunded by supplier;
- input VAT reversal;
- tracked inventory carrying value removed;
- difference between commercial net and carrying value posted to the appropriate existing purchase-return difference/expense treatment.

Do not force commercial return value into inventory valuation merely to balance the entry.

## Required accounting shape

Implementation must calculate stock issue valuation before final ledger posting (or use an InventoryService preview/atomic primitive) so one authoritative carrying-value amount feeds both:
1. inventory movement/subledger issue;
2. GL account 1140 credit.

For tracked lines:
- commercial net contributes to supplier/cash economics;
- carrying value contributes to 1140;
- difference is explicitly represented in the existing appropriate P&L/difference account semantics, not hidden in 1140.

For non-tracked lines, existing commercial expense reversal behavior remains unless tests show an accounting defect outside this PR.

Required equation for the whole posted return:
`commercial subtotal + tax = supplier/cash debit side`
while
`tracked carrying value + nontracked commercial reversal + tax + explicit tracked commercial-vs-carrying difference = same debit total`.

Exact account chosen for the tracked difference must follow existing AWJ purchase/return accounting architecture. If no established account/policy exists, STOP and report the decision instead of inventing a new accounting policy.

## Atomic posting/concurrency

All of the following must be in the same posting transaction:
- lock/reload ReturnDocument and recheck draft state;
- re-resolve/lock source Purchase/PurchaseLine as required;
- recompute remaining returnable **base quantity** against posted returns;
- enforce warehouse stock/negative-stock policy using base quantity;
- compute authoritative carrying value;
- apply inventory issue;
- post ledger using exactly that carrying value;
- mark return posted and attach journal entry.

A failure at any point rolls back stock movement, Product/ProductWarehouseStock changes, GL and document status.

Do not weaken existing double-post protection.

## Historical snapshot persistence

Because `ReturnLine` currently lacks UOM/base-quantity fields, implementation must persist enough immutable information for a posted purchase return to explain its stock quantity later.

Preferred minimal shape for purchase-return lines:
- historical `unit_name` snapshot when linked;
- historical `unit_factor` snapshot;
- immutable `base_quantity` (or equivalent explicit field) used for stock posting/audit.

If existing schema conventions provide a more canonical name, use them. Because AWJ is pre-production and existing data is experimental, choose the clean correct schema rather than preserving inferior test-data semantics. Still keep API/backward compatibility where it does not compromise correctness.

A migration/schema change is allowed **only for these immutable purchase-return quantity/audit fields**, not for unrelated returns redesign.

## Source quantity limit must become base-aware

Current source validation is commercial-quantity based. For linked purchase returns, cumulative eligibility must be enforced in historical base quantity so UOM representation cannot bypass the cap.

Example:
- purchase source = 10 cartons × factor 24 = 240 base;
- posted return = 4 cartons = 96 base;
- remaining eligible = 144 base;
- any combination of later return representation cannot exceed 144 base.

Do not reinterpret historical source with current UnitTemplate.

## Expected change set
Likely:
- `app/Services/Accounting/ReturnService.php`;
- `app/Models/ReturnLine.php`;
- narrow migration for immutable purchase-return UOM/base-quantity snapshot if required;
- Return request/resource fields only as needed for safe display/compatibility;
- possibly a narrow InventoryService valuation/issue primitive if existing `applyIssue()` cannot expose authoritative carrying value without double calculation;
- `tests/Feature/ReturnFromSourceTest.php`;
- `tests/Feature/ReturnTest.php` / `ReturnWithProductTest.php` / `WarehouseAwareDocumentsTest.php` as relevant;
- new focused Purchase Return UOM/valuation test file if clearer.

Inspect/preserve:
- `PurchaseLine` historical snapshots;
- `PurchaseService` UOM conversion/posting;
- InventoryService global moving-average semantics;
- ReturnDocument posting lock/idempotency;
- negative stock settings;
- sales-return `returnLineBaseQuantity()` behavior (do not regress POS/sales returns).

## Forbidden
- no per-warehouse average cost;
- no new costing method;
- no Serial/Lot/Expiry work;
- no broad Purchase/Return UX redesign;
- no unrelated sales-return rewrite;
- no change to supplier tax/commercial policy beyond separating it correctly from carrying value;
- no manual journal write outside LedgerService.

## Required acceptance matrix
1. linked purchase return in base unit removes correct base quantity.
2. original alt UOM factor 24; return 1 carton removes 24 base units.
3. UnitTemplate factor changed after purchase → return still uses historical factor 24.
4. UnitTemplate/alt unit deleted after purchase → linked return still uses historical snapshot.
5. partial linked returns accumulate in base quantity and cannot exceed source.
6. two drafts/concurrent posting cannot both consume same remaining eligible base quantity.
7. duplicate post cannot create second movement/journal effect.
8. standalone/free purchase return follows documented base-quantity legacy semantics and does not invent live UOM conversion.
9. insufficient warehouse stock with negative stock disabled → reject and roll back all effects.
10. negative-stock-enabled policy preserves existing allowed behavior where applicable.
11. commercial net equals carrying value → normal reversal, no artificial difference.
12. commercial net greater than carrying value → 1140 equals carrying value, difference explicit, entry balances.
13. commercial net less than carrying value → same invariant, opposite difference direction handled correctly.
14. tax-bearing tracked purchase return preserves supplier/VAT commercial economics.
15. mixed tracked + nontracked return posts correct separated amounts.
16. line discount affects commercial supplier credit but does not redefine carrying value.
17. movement quantity equals persisted immutable base quantity.
18. movement/subledger value removed equals GL 1140 credit exactly, zero-halalah difference.
19. Product global quantity/avg-cost behavior remains consistent with current moving-average model.
20. warehouse ProductWarehouseStock delta equals base quantity issue.
21. failure after valuation but before completion rolls back StockMovement, ProductWarehouseStock/Product quantity, JournalEntry and Return status.
22. other-tenant/source-line references remain inaccessible.
23. branch/warehouse semantics remain unchanged except correct base quantity.
24. existing sales-return UOM/POS return tests remain green.

## Explicit reconciliation assertion
Every tracked purchase-return financial test must assert both sides, not merely journal balance:
- capture Inventory account 1140 before/after;
- capture inventory subsidiary value before/after using the canonical AWJ valuation basis;
- assert `abs(Δ1140) === abs(Δsubledger)` exactly;
- assert movement quantity/cost/value explains that delta.

A balanced journal by itself is insufficient proof.

## Test execution order
1. focused purchase-return UOM/base-quantity tests.
2. purchase-return valuation/1140 reconciliation tests.
3. `ReturnFromSourceTest` including cumulative/concurrent source guards.
4. warehouse negative-stock tests.
5. ReturnTest/ReturnWithProductTest and sales/POS return UOM regressions.
6. PurchaseService/InventoryService accounting regressions.
7. full backend SQLite then PostgreSQL/CI matrix; do not reduce financial test coverage.

## Stop conditions
Stop and report if:
- there is no established account/policy for tracked commercial-vs-carrying-value difference;
- InventoryService cannot provide/apply one authoritative issue valuation atomically without a material redesign;
- source PurchaseLine lacks enough immutable historical information for a specific supported purchase quantity mode;
- a fix would require changing global moving-average or per-warehouse costing architecture.

## Definition of Done
A purchase return can never remove the wrong stock quantity because a historical alternative UOM was ignored or changed, and can never credit Inventory 1140 by a value different from the inventory subledger carrying value removed. Supplier credit/tax economics remain correct, posting is atomic, cumulative source eligibility is base-aware, and existing sales-return behavior is not regressed.

## Eventual Claude Code handoff
Only after Safwan explicitly authorizes implementation. Start from then-current main and reconcile drift. Mandatory final MD report: changed files/migrations, financial invariants, exact tests/results, SQLite/PostgreSQL/CI, rollback/concurrency proof, risks/remaining, Branch/PR/Base SHA/Head SHA, next step. No Merge/Deploy.