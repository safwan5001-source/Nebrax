# AWJ Implementation Report — PR-INV-3

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-inv-3`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/673
**Base SHA:** `6a49a95` (main, after PR-SEC-INV-1 / #666, PR-INV-1 / #668, PR-PRICE-1 / #669, and PR-INV-2 / #671 merged)
**Head SHA:** `45fa841`

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-INV-3-stock-permit-uom.md` only — the fifth Phase 1 hardening gate of the Products & Inventory program. No other program task was started, no audit re-run from scratch, no scope expansion.

Confirmed problem: `StockPermitLine.quantity` was consumed directly as stock/base quantity — the model has no UOM concept at all (unlike `InvoiceLine`/`PurchaseLine`, which already have `unit_name`/`unit_factor`). A commercial input such as "1 carton" was treated as "1 base piece" by `InventoryService`, silently under-moving stock and mis-valuing every affected receipt/issue/transfer.

## 2. The `unit_cost` semantics decision (mandatory, evidence-based — not a guess)

The contract explicitly required: *"User-entered receipt cost semantics must be explicit: determine whether current `unit_cost` is per entered UOM or per base unit from existing UI/API contract before modifying; do not guess."*

**Current state, verified from code:** there is no "entered UOM" concept anywhere in Stock Permit today — `quantity` has always been the only unit in play, which by definition makes it the base unit (factor 1 implicit). `unit_cost × quantity = line_cost` and both operands are in that one existing unit. There is no ambiguity in the *current* behavior — it was directly confirmed, not assumed.

**Forward decision, for when an alternate UOM is entered:** the contract also says *"Exact naming should align with established Invoice/Purchase line conventions after implementation inspection."* Inspection of `PurchaseService::writeLines()` (lines ~151–195) shows the already-built, already-reviewed (PR-INV-2) precedent: `unit_price` is entered **per the chosen commercial unit** (e.g., price per carton, not per piece), so `line_subtotal = quantity_entered × unit_price` stays an exact integer with no fractional halala loss; only at the `InventoryService` boundary does `PurchaseService::post()` normalize — `intdiv(lineValue, baseQuantity)` for the per-base-unit cost, with the exact `lineValue` passed as `$totalCost` to avoid any rounding drift (`app/Services/Accounting/PurchaseService.php:480-496`).

**Decision:** Stock Permit's receipt `unit_cost` follows the identical, established convention — entered per the chosen commercial unit, normalized to a per-base-unit cost only when calling `InventoryService::applyReceipt()`, using the same `intdiv(line_cost, base_quantity)` + explicit `totalCost` pattern. This is derived directly from inspecting the one existing precedent the contract named, not invented: it guarantees zero behavior change for every existing caller (factor 1 ⇒ entered unit = base unit ⇒ identical numbers), and it is the only choice consistent with "align with established Invoice/Purchase line conventions." No NEEDS DECISION was raised because the contract itself pointed to the evidence that resolves it.

## 3. Scope implemented

- **`app/Models/StockPermitLine.php`**: added `unit_name`/`unit_factor` (immutable snapshot, `HasUnitConversion` trait — same convention as `InvoiceLine`/`PurchaseLine`) plus a **persisted, authoritative** `base_quantity`, computed once at line creation and never re-derived from a live `UnitTemplate` afterward. This is a deliberate strengthening beyond Purchase/Invoice's on-the-fly `baseQuantity()` method, justified directly by the contract's own wording: *"must validate that UOM against the Product semantics and persist an immutable conversion snapshot/base quantity before stock movement."*
- **`app/Services/Accounting/StockPermitService.php`**:
  - Injects `UnitConversion` and calls the **same shared `resolve()` service** Purchase and Invoice already use — not a parallel copy, per the existing code's own stated reason for centralizing it ("a divergence here is the worst possible inventory bug").
  - `create()` resolves `[$unitName, $unitFactor]` for every item (all three permit types), computes `base_quantity = quantity × unitFactor`, and persists all three snapshot fields on the line.
  - `applyReceipt()`: normalizes the line's total commercial value (`line_cost`) to a per-base-unit cost via `intdiv($line->line_cost, max(1, $baseQuantity))`, and calls `InventoryService::applyReceipt()` with `base_quantity` and the explicit `totalCost` parameter (mirroring `PurchaseService`).
  - `applyIssue()`: `assertAvailable()` and `InventoryService::applyIssue()` both now receive `base_quantity`; the line's recorded `unit_cost`/`line_cost` after posting reflect `base_quantity × avg_cost` — the true carrying value removed — instead of `entered_quantity × avg_cost`.
  - `applyTransfer()`: `base_quantity` is computed **once**, at permit creation, and the identical stored value is read for both the source `applyIssue()` and the target `applyReceipt()` calls — there is no second conversion that could drift from the first.
- **`database/migrations/2026_09_06_020000_add_uom_to_stock_permit_lines.php`** (new): adds the three columns and backfills existing rows with `unit_factor=1`, `base_quantity=quantity` — the correct, non-destructive interpretation of every row that predates this PR (they always meant factor 1; nothing is being reinterpreted).
- **`app/Http/Requests/StoreStockPermitRequest.php`**: added `items.*.unit` (`nullable|string|max:255`), byte-identical rule to `StorePurchaseRequest`.
- **`app/Http/Resources/StockPermitLineResource.php`**: exposes `unit_name`/`unit_factor`/`base_quantity`, same field names as `InvoiceLineResource`.

No change to `postSalesReturn()`/`postPurchaseReturn()` (PR-INV-2), `CreditNoteService`, `ProductLifecycleService`, any Account Mapping code, or the costing architecture (still global moving-average, `LedgerService::post()` remains the only journal-writing path).

## 4. Schema / migrations / API contract

**New migration** `2026_09_06_020000_add_uom_to_stock_permit_lines.php`:

```php
Schema::table('stock_permit_lines', function (Blueprint $table) {
    $table->string('unit_name')->nullable()->after('quantity');
    $table->unsignedInteger('unit_factor')->default(1)->after('unit_name');
    $table->integer('base_quantity')->default(0)->after('unit_factor');
});
DB::table('stock_permit_lines')->update(['base_quantity' => DB::raw('quantity')]);
```

Matches the established `2025_01_01_000046_create_unit_templates.php` pattern (`unit_name`/`unit_factor` added identically to `invoice_lines`/`purchase_lines`) plus the extra persisted `base_quantity` the contract specifically asks for. This repo is pre-production core (per `CLAUDE.md`: rebuilt fresh via `setup.sh`/CI for every test run), so a backfill rather than a reset was chosen anyway since it is simple, safe, and exactly correct — no "inferior ambiguous meaning" is preserved because factor 1 was always the true, only meaning of a pre-existing row.

**API contract:** new optional `items.*.unit` field on `POST /stock-permits`. Omitting it (every existing client) reproduces prior behavior exactly. Response resource gains three new read-only fields per line. No breaking change to any existing field or endpoint shape.

## 5. UOM semantics — before / after

| Scenario (1 carton, factor 24, entered receipt cost 2400.00/carton) | Before this PR | After this PR |
|---|---|---|
| Receipt of 2 cartons | Moves **2** base units; avg_cost computed from `2400.00 × 2 ÷ 2` = 2400.00/unit (wrong — carton price treated as piece price) | Moves **48** base units; avg_cost = `4800.00 ÷ 48` = 100.00/unit |
| Issue of 1 carton | Moves **1** base unit; 23 stay stranded in stock | Moves **24** base units — the whole carton |
| Transfer of 1 carton (cross-branch) | Same 1-unit bug on both legs | 24 base units on both legs, valued identically at current avg_cost |
| No `unit` sent (every pre-existing client) | `quantity` used directly | `unit_factor=1`, `base_quantity=quantity` — **byte-identical result** |
| Unit name not defined on the product's `UnitTemplate` | N/A (no UOM existed) | `RuntimeException` — fails closed, never silently assumes factor 1 |
| `UnitTemplate` mutated after a permit is posted | N/A | Posted permit's `unit_factor`/`base_quantity` are untouched — read from the persisted snapshot, never recomputed |

## 6. Security / Tenant / Branch / Warehouse evidence

- No new endpoint or permission surface; `StockPermitController`'s existing RBAC/tenant-scoped/branch-and-warehouse-authorization path (`assertTenantOwned`, `assertWarehouseAllowed`, `assertRecordAccessible`) is completely unchanged — verified by re-running `StocktakeStockPermitRecordAccessTest` (15 tests, all branch/warehouse/tenant-isolation scenarios for Stock Permit) unmodified and green.
- `UnitConversion::resolve($product, $unitName)` is looked up against `$product->unitTemplate`, and `$product` itself is already tenant-resolved (`Product::findOrFail($item['product_id'])` inside `create()`, under the tenant-scoped `BaseModel`); no new cross-tenant surface.
- Warehouse-level negative-stock enforcement is preserved and now correctly scoped to base quantity: `assertAvailable($product, $baseQuantity, $permit->warehouse_id)` — verified by `issuing_more_cartons_than_the_warehouse_holds_in_base_units_is_rejected` (a request for 2 cartons = 48 base units against a warehouse holding only 30 base units is rejected, even though the *entered* count "2" alone would look small).
- Atomicity/double-post safety unchanged: `post()`'s existing `DB::transaction()` + `lockForUpdate()` + draft-status re-check are untouched — verified by `a_posted_alternate_uom_permit_cannot_be_posted_again` and `a_rejected_alternate_uom_transfer_leaves_no_partial_stock_or_gl_mutation` (draft status, no journal entry, no stock movement, no warehouse-stock mutation survive a rejected post with an alternate UOM in play).

## 7. Accounting / Inventory reconciliation

**Verified example** (`the_1140_delta_exactly_equals_the_subledger_delta_for_an_alternate_uom_receipt_and_issue`): a carton-factor-24 product, receipt of 2 cartons at 2400.00/carton, then issue of 1 carton. Measured directly, in halalas:

- After receipt: `Δ1140 = Δ(quantity_on_hand × avg_cost)` exactly (480000 in both).
- After the subsequent issue: `Δ1140 = Δ(quantity_on_hand × avg_cost)` exactly again, measured as a fresh delta from the post-receipt state.
- Final assertion: `bal('1140') === product.quantity_on_hand × product.avg_cost` — no cumulative drift across two postings.

**Cross-branch transfer** (`a_cross_branch_transfer_with_an_alternate_uom_posts_a_balanced_entry_at_carrying_value`): 1 carton (24 base units) transferred branch-to-branch. Journal: two `1140` lines, `Σdebit = Σcredit = 240000` (24 × avg_cost 10000), debit tagged to the destination branch, credit to the source branch — net company-wide effect zero, per-branch balances corrected. Same-branch transfer (`a_same_branch_transfer_with_an_alternate_uom_moves_the_same_base_quantity_on_both_sides_with_no_gl`) confirms no journal entry is created and `1140`'s balance is unchanged, while both warehouses' `ProductWarehouseStock` rows move by the identical 24-unit base quantity.

## 8. Historical / immutability semantics

`changing_the_unit_template_after_posting_does_not_reinterpret_the_permit`: after posting a receipt with `unit=carton` (factor 24 at the time), the product's `UnitTemplate` is mutated so `carton` becomes factor 12. The posted line's `unit_factor` and `base_quantity` remain 24 — read from the persisted columns, never recomputed — and the product's actual `quantity_on_hand` reflects the historical 24-unit movement, not a hypothetical 12-unit one.

## 9. Concurrency / idempotency

Unchanged transaction/locking structure for the permit-posting path (`DB::transaction()` + `StockPermit::lockForUpdate()` + draft-status re-check), exercised with an alternate UOM specifically by:
- `a_posted_alternate_uom_permit_cannot_be_posted_again` — a second `post()` call on an already-posted alt-UOM receipt throws and the product quantity is unchanged from the single legitimate posting.
- `a_rejected_alternate_uom_transfer_leaves_no_partial_stock_or_gl_mutation` — a transfer whose alt-UOM base quantity (24) exceeds the source warehouse's actual stock (10) is rejected with the document staying `draft`, `journal_entry_id` null, zero new `StockMovement`/`JournalEntry` rows, and both warehouses' stock rows exactly as before the attempt.

## 10. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=StockPermitUomValuationTest` | **12 passed** (59 assertions) | New PR-INV-3 acceptance matrix (§10a below) |
| `php artisan test --filter="StockPermitTest\|StockPermitUomValuationTest\|StocktakeStockPermitRecordAccessTest\|InventoryReportTest\|InventoryServiceTest\|PurchaseTest\|InvoiceTest\|ReturnTest"` | **141 passed** (1022 assertions) | Every existing Stock Permit / stocktake-access / inventory-report / purchase / invoice / return suite touching this code path — zero regressions |
| `php artisan test` (full suite, SQLite) | **2450 passed, 1 skipped, 25 failed** | All 25 failures pre-existing and unrelated — identical set/count to the `PR-SEC-INV-1`/`PR-INV-1`/`PR-PRICE-1`/`PR-INV-2` baseline: 24 `Fuel*` tests on missing `ext-bcmath` in this sandbox, 1 `DocumentCenterSecureIntakeTest` PDF-fixture issue. Passed count rose 2438→2450 with the 12 new tests. |

### 10a. Acceptance matrix coverage (from the contract)

| Contract requirement | Test |
|---|---|
| Base-UOM (no unit sent) behaves exactly as factor 1 | `an_item_without_a_unit_is_stored_as_base_unit_factor_one_explicitly` |
| Alternate-UOM receipt: correct base quantity + normalized cost | `a_receipt_with_an_alternate_uom_converts_to_base_quantity_and_normalizes_the_cost` |
| Alternate-UOM issue: base-quantity availability + correct GL | `an_issue_with_an_alternate_uom_converts_to_base_quantity_and_checks_availability_in_base_units` |
| Warehouse availability checked in base quantity, not entered count | `issuing_more_cartons_than_the_warehouse_holds_in_base_units_is_rejected` |
| Same-branch transfer: converts once, identical base quantity both sides, no GL | `a_same_branch_transfer_with_an_alternate_uom_moves_the_same_base_quantity_on_both_sides_with_no_gl` |
| Cross-branch transfer: balanced 1140↔1140 at carrying value | `a_cross_branch_transfer_with_an_alternate_uom_posts_a_balanced_entry_at_carrying_value` |
| Template changed after permit creation does not reinterpret it | `changing_the_unit_template_after_posting_does_not_reinterpret_the_permit` |
| Unknown/stale unit fails closed (never defaults to factor 1) | `an_unknown_unit_fails_closed_and_creates_nothing`, `a_unit_name_without_any_template_on_the_product_fails_closed` |
| Double-post rejected | `a_posted_alternate_uom_permit_cannot_be_posted_again` |
| Atomic rollback on a rejected post | `a_rejected_alternate_uom_transfer_leaves_no_partial_stock_or_gl_mutation` |
| GL/subledger equality for financial permit types | `the_1140_delta_exactly_equals_the_subledger_delta_for_an_alternate_uom_receipt_and_issue` |

## 11. Build / Lint / Typecheck

No `web/` changes. `vendor/bin/pint --test` compared pre-edit vs. post-edit via `git stash` for every touched file (`StoreStockPermitRequest.php`, `StockPermitLineResource.php`, `StockPermitLine.php`, `StockPermitService.php`): identical fixer lists before and after each file — zero new violations. The new migration file (`2026_09_06_020000_add_uom_to_stock_permit_lines.php`) reports clean. This repository's CI (`ci.yml`) does not gate on Pint.

## 12. CI

Not polled from this session before opening the PR. `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite only (no PostgreSQL available in this sandbox — same caveat as all four prior PRs in this program). The new migration and service code use only portable `DB::table()`/query-builder calls and `intdiv()` integer arithmetic — no raw DB-specific SQL — so no PostgreSQL-specific divergence is expected but was not directly observed.

## 13. Deviations from approved plan

None from the contract. One deliberate, disclosed design choice within it: `base_quantity` is **persisted** on `StockPermitLine` rather than computed on demand via the `HasUnitConversion` trait method (as `InvoiceLine`/`PurchaseLine` do). This is not a deviation from the contract — it is the literal fulfillment of its own wording ("persist an immutable conversion snapshot/base quantity before stock movement"), and it is documented here explicitly rather than silently normalized as an implementation detail, per the Acceptance Matrix's universal Definition of Done (§7: "Any deviation from plan is called out explicitly").

Everything else matches the contract exactly: all three permit types convert through base quantity; unit resolution reuses the existing shared service instead of duplicating it; same-branch transfer stays GL-free; cross-branch transfer stays balanced; no new costing model; no Stock Requests, multi-UOM stocktake, Serial/Lot/Expiry, or general UOM-template-mutation-policy (PR-UOM-1) work was touched.

## 14. Risks / remaining work

- PostgreSQL leg of CI not run locally in this session; only SQLite validated directly.
- `StockPermitLine`'s new `unit_name`/`unit_factor` columns have no fractional (numerator/denominator) support, matching `PurchaseLine` exactly (no fractional purchase quantities exist today either) — this was confirmed as consistent with the existing precedent, not a gap introduced by this PR. Fractional Stock Permit quantities are outside this contract's scope.
- The receipt `unit_cost` semantics decision (§2) is grounded in the one precedent the contract named; if a reviewer disagrees with treating "entered per commercial unit" as the correct forward interpretation, that is a reviewable design point flagged prominently in §2 and the PR description, not a silent assumption.

## 15. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#673`) is open for review; no auto-merge is configured. Per the user's explicit instruction, work stops here to await review before any further Phase 1 task begins.

## 16. Next step

Review of this report and the PR diff (#673). Per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`, `PR-INV-4` (Stocktake concurrent/stale-snapshot reconciliation) is next in the Phase 1 sequence. Do not start it before this review, per program governance and the explicit instruction to stop and wait after opening this PR.
