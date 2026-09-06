# AWJ Implementation Report — PR-INV-4

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-inv-4`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/674
**Base SHA:** `f23e1e5` (main, after PR-SEC-INV-1 / #666, PR-INV-1 / #668, PR-PRICE-1 / #669, PR-INV-2 / #671, and PR-INV-3 / #673 merged)
**Head SHA:** `37c09d8`

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-INV-4-stocktake.md` only — the sixth Phase 1 hardening gate of the Products & Inventory program. No other program task was started, no audit re-run from scratch, no scope expansion.

Confirmed problem: `StocktakeService::open()` snapshots `system_quantity`; `count()` stores the physical `counted_quantity`; but `post()` applied `counted_quantity - system_quantity` directly against whatever `ProductWarehouseStock`/`Product.quantity_on_hand` balance existed at posting time, with no proof that balance had remained unchanged since the snapshot. Per the contract's own example: snapshot 100, physical count 98, an intervening sale of 10 before posting → actual balance 90. Applying the stale diff (-2) would have produced 88, a number the count evidence never established. `Stocktake::lockForUpdate()` prevents double-posting the *document*, but proves nothing about whether the *inventory state* it is about to correct is still the one it was opened against.

## 2. Policy decision (mandatory, explicit — not silently chosen)

The contract required selecting and documenting one of three explicit policies:

- **A.** Movement freeze/cutoff for the counted warehouse/products during the count window.
- **B.** Optimistic detect/reconcile: detect movement/state change since snapshot, require refresh/reconciliation before posting.
- **C.** An equivalently safe alternative design.

**Decision: B.** The contract states AWJ's default preference is minimal operational disruption — detect/reconcile over a broad freeze — "unless implementation evidence shows freeze is materially safer/simpler." No such evidence surfaced during implementation: the staleness check needed for B is a simple, scoped comparison against the exact rows already read at snapshot time (`ProductWarehouseStock`), requires no new locking framework, and confines any operational impact to the specific Product×Warehouse pairs that actually drifted — never to unrelated products or other warehouses. A freeze would have blocked *all* movement on the counted warehouse for the entire open→count→post window regardless of whether anything relevant to the count actually moved, which is strictly more disruptive with no corresponding safety gain. The default was therefore not overridden.

## 3. Scope implemented

- **`app/Services/Accounting/StocktakeService.php`**:
  - `post()`: before touching any stock or journal entry, locks the `ProductWarehouseStock` row for every **counted** line (uncounted lines never produce a diff, so they are never checked — a movement on an uncounted item cannot block a count that never depended on it) and compares the current quantity to the line's `system_quantity` snapshot. Locks are acquired in a **fixed `product_id` order** so two concurrent postings sharing overlapping products always contend for locks in the same order, avoiding circular-wait deadlocks. A single mismatch aborts the entire post — no partial application to the lines that were fine.
  - `reconcile()` (new): refreshes `system_quantity` to the current balance and clears `counted_quantity` **only for lines whose balance actually drifted** — untouched lines are left completely alone. Clearing (not reinterpreting) the stale count is deliberate: there is no way to know, from a quantity comparison alone, how much of the drift belongs to the legitimate intervening movement versus a real variance, so the tainted evidence is discarded and the affected items must be recounted against the refreshed baseline.
- **`app/Http/Controllers/Api/StocktakeController.php`** + **`routes/api.php`**: new `POST /stocktakes/{id}/reconcile`, guarded by the same `products.manage` permission and `inventory.core` application-active middleware already used by `count`/`post`, and the same `assertRecordAccessible()` branch/warehouse authorization check.

No change to `open()`, `count()`, `buildEntry()`, `snapshot()`, the costing architecture (still global moving-average), Purchase Return (PR-INV-2), Stock Permit UOM (PR-INV-3), Product Lifecycle, or Account Mapping. `PR-UOM-1` was not started.

## 4. Schema / migrations / API contract

No migration — no schema change. `StocktakeLine.system_quantity`/`counted_quantity` already existed; `reconcile()` only writes new values into them.

**New endpoint:** `POST /stocktakes/{id}/reconcile` (no request body). Response shape: `{"data": <StocktakeResource>, "reconciled_product_ids": [<uuid>, ...]}` — the same `StocktakeResource` shape every other Stocktake endpoint returns, plus one new top-level key naming which products were actually refreshed (empty array if nothing had drifted). No existing endpoint's request or response shape changed.

## 5. Concurrency cases — evidence per the contract's list

| Concurrency case | Test | Result |
|---|---|---|
| No intervening movement | `no_intervening_movement_preserves_the_current_posting_behavior` | Byte-identical posting outcome to pre-PR behavior |
| Sale after snapshot | `a_sale_between_snapshot_and_post_blocks_posting_without_any_mutation` | Rejected; zero stock/GL mutation from the attempt |
| Purchase receipt after snapshot | `a_purchase_receipt_between_snapshot_and_post_blocks_posting` | Rejected |
| Stock Permit issue after snapshot | `a_stock_permit_issue_between_snapshot_and_post_blocks_posting` | Rejected |
| Transfer out after snapshot (source warehouse's count) | `a_transfer_out_between_snapshot_and_post_blocks_posting_the_source_warehouse_count` | Rejected |
| Transfer in after snapshot (destination warehouse's count) | `a_transfer_in_between_snapshot_and_post_blocks_posting_the_destination_warehouse_count` | Rejected |
| Multiple movements (sale then receipt, net ≠ original) | `multiple_movements_between_snapshot_and_post_still_block_posting` | Rejected — the check is cumulative, not a single-movement check |
| Unrelated product, same warehouse | `movement_on_an_uncounted_product_in_the_same_warehouse_does_not_block_the_scoped_count` | Posts normally — scoped strictly to counted lines |
| Same product, different (uncounted) warehouse | `movement_in_a_different_warehouse_does_not_block_a_count_scoped_to_another_warehouse` | Posts normally |
| Retry/double-post | `reconcile_then_a_fresh_count_and_retry_succeeds_exactly_once_and_matches_the_ledger` | After `reconcile()` + a fresh count, posting succeeds once; a second `post()` call on the now-posted document still throws "لا يمكن ترحيل جرد مرحَّل" (unchanged double-post guard) |
| Another stocktake/correction on the same Product×Warehouse | Structural — same `ProductWarehouseStock` row, same lock | If Stocktake A posts first and changes the row, Stocktake B's later staleness check against its own (now-stale) snapshot correctly detects the drift and is rejected — no dedicated test needed beyond the sale/receipt/permit cases already proving the row-comparison mechanism, since a second stocktake's `post()` mutates the exact same row those tests already move |

## 6. Accounting / Inventory reconciliation

**Δ1140 = Δsubledger, exact, across a full conflict→reconcile→repost cycle** (`delta_1140_exactly_equals_delta_subledger_across_a_sale_reconciliation_and_repost`): open a stocktake on 100 units (avg_cost 10000), count 95, a sale of 10 intervenes (balance → 90, its own COGS entry posts independently and correctly), the stocktake `post()` is rejected, `reconcile()` refreshes the line to `system_quantity=90` and clears the count, a fresh count of 95 is recorded, and the retried `post()` succeeds. Measured directly:

- `Δ(quantity_on_hand × avg_cost)` for the stocktake's own correction = `Δ1140` for that same correction, exactly, in halalas.
- `difference_value` on the posted document = 50000 (5 units surplus × avg_cost 10000) — the count evidence against the *correct*, refreshed baseline, not a guess involving the sale's 10 units.

**No stock/GL mutation on conflict** (`a_sale_between_snapshot_and_post_blocks_posting_without_any_mutation`): after a rejected `post()` attempt, `StockMovement::count()` and `JournalEntry::count()` are asserted unchanged from immediately before the attempt (i.e., the sale's own legitimate movement/entry is already counted in the "before" baseline — only the *attempted stocktake posting itself* is proven to add nothing), the document stays `draft` with `journal_entry_id` null, and `Product.quantity_on_hand` is unchanged by the attempt.

**Same-warehouse, same-product isolation via `reconcile()`** (`reconcile_leaves_unaffected_lines_completely_untouched`): a stocktake counting two products where only one drifted — `reconcile()`'s `reconciled_product_ids` names only the drifted product; the other line's `system_quantity` and `counted_quantity` are asserted byte-identical to what was recorded before reconciliation.

## 7. Security / Tenant / Branch / Warehouse evidence

- No new permission model: `reconcile()` reuses the exact `products.manage` + `inventory.core` guard and `assertRecordAccessible($stocktake->branch_id, [$stocktake->warehouse_id])` authorization call already used by `count()`/`post()`/`destroy()` — verified by re-running `StocktakeStockPermitRecordAccessTest` (15 branch/warehouse/tenant-isolation scenarios for Stocktake and Stock Permit) unmodified and green.
- `ProductWarehouseStock::where(...)` queries added in `assertSnapshotStillValid()`/`reconcile()` run through `ProductWarehouseStock extends BaseModel`, which carries `TenantScope` as a mandatory global scope — every such query is automatically tenant-filtered, identical to the pre-existing pattern in `StockPermitService::assertAvailable()`. No raw/tenant-bypassing query was introduced. This was verified by code inspection rather than a new dedicated isolation test, since it relies on architecture already covered by the broad tenant-isolation test suite and introduces no new query pattern.
- The staleness check and `reconcile()` are both scoped by `(warehouse_id, product_id)` exactly matching the pair `open()`'s own `snapshot()` used to capture `system_quantity` in the first place — no risk of comparing against the wrong warehouse's stock row.

## 8. Concurrency / idempotency

- **Deadlock avoidance**: both `assertSnapshotStillValid()` and `reconcile()` sort lines by `product_id` before acquiring `lockForUpdate()` on each `ProductWarehouseStock` row, so two stocktakes (or a stocktake and any other operation locking the same rows in the same documented order) covering overlapping product sets always request locks in the same order, never a reversed one.
- **Atomicity**: the staleness check runs inside the same `DB::transaction()` that already wraps `Stocktake::lockForUpdate()` + the draft-status re-check, before any `InventoryService` call or journal write — a thrown conflict rolls back the entire transaction, leaving zero partial state by construction, not by a separate compensating step.
- **Double-post**: unchanged guard (`isDraft()` check outside and again inside the locked transaction) — verified still working after a successful reconcile-then-repost cycle in `reconcile_then_a_fresh_count_and_retry_succeeds_exactly_once_and_matches_the_ledger`.
- **SQLite caveat**: `lockForUpdate()` is a silent no-op under SQLite (this repository's local test driver) — this is a pre-existing, repo-wide limitation of every other `lockForUpdate()` call already in the codebase (`Stocktake::lockForUpdate()`, `StockPermit::lockForUpdate()`, `ReturnDocument::lockForUpdate()`, etc.), not something introduced or worsened by this PR. The tests here validate the *comparison logic itself* (which is what actually prevents the mathematically-wrong correction), not true multi-connection row-lock contention, which would require a PostgreSQL-backed concurrency test outside this sandbox's capability.

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=StocktakeConcurrencyReconciliationTest` | **12 passed** (41 assertions) | New PR-INV-4 acceptance matrix (§5 above) |
| `php artisan test --filter="StocktakeTest\|StocktakeConcurrencyReconciliationTest\|StocktakeStockPermitRecordAccessTest\|InventoryReportTest\|StockPermitTest\|StockPermitUomValuationTest\|InvoiceTest\|PurchaseTest\|ReturnTest"` | **160 passed** (1069 assertions) | Every existing stocktake / stock-permit / inventory-report / invoice / purchase / return suite touching this code path — zero regressions |
| `php artisan test` (full suite, SQLite) | **2462 passed, 1 skipped, 25 failed** | All 25 failures pre-existing and unrelated — identical set/count to the `PR-SEC-INV-1`/`PR-INV-1`/`PR-PRICE-1`/`PR-INV-2`/`PR-INV-3` baseline: 24 `Fuel*` tests on missing `ext-bcmath` in this sandbox, 1 `DocumentCenterSecureIntakeTest` PDF-fixture issue. Passed count rose 2450→2462 with the 12 new tests. |

## 10. Build / Lint / Typecheck

No `web/` changes. `vendor/bin/pint --test` compared pre-edit vs. post-edit via `git stash` for every touched file. `StocktakeController.php` and `routes/api.php` showed identical fixer lists before and after. `StocktakeService.php` initially showed one **new** violation (`concat_space`, from a multi-line string concatenation in the new conflict-message code) — caught by the comparison and fixed directly (removed the space after `.` to match this file's/repo's established no-space concatenation style) before finalizing; the re-verified fixer list is now identical to the pre-edit baseline. The new test file reports only the same pre-existing-pattern violations already accepted across every other test file in this program (`class_attributes_separation`, `binary_operator_spaces`). This repository's CI (`ci.yml`) does not gate on Pint.

## 11. CI

Not polled from this session before opening the PR. `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite only (no PostgreSQL available in this sandbox — same caveat as all five prior PRs in this program). The new code uses only `Illuminate\Support\Collection` sorting and standard query-builder `lockForUpdate()`/`value()` calls — no raw DB-specific SQL — so no PostgreSQL-specific divergence is expected, though true row-lock contention under concurrent connections (as opposed to the comparison logic validated here) was not directly observed, per §8's SQLite caveat.

## 12. Deviations from approved plan

None. The contract's own required decision (policy A/B/C) was made explicitly, with rationale, and documented in §2 here and in the PR description — this is not a deviation but the literal fulfillment of the contract's "the implementer must not choose a policy silently; report the chosen policy and rationale" instruction. Everything else matches the contract exactly: physical count evidence is never applied as a stale delta; posting remains atomic with stock movements plus one variance journal; variance value still uses current `avg_cost` at posting; `Δ1140 = Δsubledger` for the actual posted correction; uncounted lines remain no-effect; no negative counted quantity (unchanged existing guard in `count()`); base quantity remains the unit of truth (no multi-UOM count UX was touched); no broad inventory locking framework was introduced beyond the row-level locks policy B itself requires.

## 13. Risks / remaining work

- PostgreSQL leg of CI not run locally in this session; only SQLite validated directly.
- True concurrent-connection row-lock contention (two simultaneous transactions racing on the same `ProductWarehouseStock` row) is architecturally correct by construction (row lock acquired before comparison, held until commit/rollback) but was not exercised under real concurrency in this sandbox — this is the same limitation already accepted for every other `lockForUpdate()` usage in the codebase, not a gap specific to this PR.
- `reconcile()`'s "clear the count, force a recount" resolution is the safest of the reasonable options (no guessing which portion of a drift is legitimate movement vs. real variance) but does mean a counter must physically revisit any item that drifted between snapshot and post — an accepted operational cost of policy B, not a defect.

## 14. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#674`) is open for review; no auto-merge is configured. Per the user's explicit instruction, work stops here to await review before any further Phase 1 task (including `PR-UOM-1`) begins.

## 15. Next step

Review of this report and the PR diff (#674). Per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`, `PR-UOM-1` (in-use UOM mutation safety) is next in the Phase 1 sequence. Do not start it before this review, per program governance and the explicit instruction to stop and wait.
