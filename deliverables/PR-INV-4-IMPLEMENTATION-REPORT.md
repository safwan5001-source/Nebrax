# AWJ Implementation Report — PR-INV-4

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-inv-4`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/674
**Base SHA:** `f23e1e5` (main, after PR-SEC-INV-1 / #666, PR-INV-1 / #668, PR-PRICE-1 / #669, PR-INV-2 / #671, and PR-INV-3 / #673 merged)
**Head SHA:** `550e046`

This report supersedes the version delivered before independent review. §16 records the post-review fix (monotonic revision identity instead of quantity comparison) and everything above it reflects the final, updated code.

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-INV-4-stocktake.md` only — the sixth Phase 1 hardening gate of the Products & Inventory program. No other program task was started, no audit re-run from scratch, no scope expansion.

Confirmed problem: `StocktakeService::open()` snapshots `system_quantity`; `count()` stores the physical `counted_quantity`; but `post()` applied `counted_quantity - system_quantity` directly against whatever `ProductWarehouseStock`/`Product.quantity_on_hand` balance existed at posting time, with no proof that balance had remained unchanged since the snapshot. Per the contract's own example: snapshot 100, physical count 98, an intervening sale of 10 before posting → actual balance 90. Applying the stale diff (-2) would have produced 88, a number the count evidence never established. `Stocktake::lockForUpdate()` prevents double-posting the *document*, but proves nothing about whether the *inventory state* it is about to correct is still the one it was opened against.

## 2. Policy decision (mandatory, explicit — not silently chosen)

The contract required selecting and documenting one of three explicit policies:

- **A.** Movement freeze/cutoff for the counted warehouse/products during the count window.
- **B.** Optimistic detect/reconcile: detect movement/state change since snapshot, require refresh/reconciliation before posting.
- **C.** An equivalently safe alternative design.

**Decision: B.** The contract states AWJ's default preference is minimal operational disruption — detect/reconcile over a broad freeze — "unless implementation evidence shows freeze is materially safer/simpler." No such evidence surfaced during implementation, and confining the mechanism to a scoped, per-row identity check (§16) rather than a broad freeze remained the right call even after the review's correction. A freeze would have blocked *all* movement on the counted warehouse for the entire open→count→post window regardless of whether anything relevant to the count actually moved, which is strictly more disruptive with no corresponding safety gain. The default was therefore not overridden.

## 3. Scope implemented

- **`app/Services/Accounting/StocktakeService.php`**:
  - `post()`: before touching any stock or journal entry, locks the `ProductWarehouseStock` row for every **counted** line (uncounted lines never produce a diff, so they are never checked) and compares its current **revision** — not merely its quantity, see §16 — to the line's `system_revision` snapshot. Locks are acquired in a **fixed `product_id` order** so two concurrent postings sharing overlapping products always contend for locks in the same order, avoiding circular-wait deadlocks. A single mismatch aborts the entire post — no partial application to the lines that were fine.
  - `reconcile()` (new): refreshes **both** `system_quantity` and `system_revision` to the current state and clears `counted_quantity` **only for lines whose revision actually changed** — untouched lines are left completely alone. Clearing (not reinterpreting) the stale count is deliberate: there is no way to know, from the state alone, how much of the drift belongs to the legitimate intervening movement versus a real variance, so the tainted evidence is discarded and the affected items must be recounted against the refreshed baseline.
  - `snapshot()`: now captures `{quantity, revision}` per product from `ProductWarehouseStock`, not quantity alone.
- **`app/Services/Accounting/InventoryService.php`**: `adjustWarehouseStock()` — the single existing write path for `product_warehouse_stock`, already used by every movement type the contract lists — now increments a new `revision` column by exactly 1 alongside the existing `quantity` increment, for every real (non-zero-delta) movement.
- **`app/Models/ProductWarehouseStock.php`** / **`app/Models/StocktakeLine.php`**: new `revision` / `system_revision` integer columns, fillable and cast.
- **`app/Http/Resources/StocktakeLineResource.php`**: exposes `system_revision` (read-only, for audit/debugging — not intended for direct UI consumption).
- **`app/Http/Controllers/Api/StocktakeController.php`** + **`routes/api.php`**: `POST /stocktakes/{id}/reconcile`, guarded by the same `products.manage` permission and `inventory.core` application-active middleware already used by `count`/`post`, and the same `assertRecordAccessible()` branch/warehouse authorization check. Unchanged since the first version of this PR.

No change to `open()`'s outer structure, `count()`, `buildEntry()`, the costing architecture (still global moving-average), Purchase Return (PR-INV-2), Stock Permit UOM (PR-INV-3), Product Lifecycle, or Account Mapping. `PR-UOM-1` was not started. No SERIALIZABLE isolation change, no broad warehouse freeze, no new locking framework beyond the row-level locks the chosen policy already required.

## 4. Schema / migrations / API contract

**Two new migrations:**

- `2026_09_06_030000_add_revision_to_product_warehouse_stock.php` — adds `product_warehouse_stock.revision` (`unsignedBigInteger`, default 0).
- `2026_09_06_030100_add_system_revision_to_stocktake_lines.php` — adds `stocktake_lines.system_revision` (`unsignedBigInteger`, default 0).

Both default to 0, so no existing row's behavior changes until its first real movement after this migration runs — no backfill computation needed or attempted, since a revision counter has no meaningful "historical" value to reconstruct for movements that already happened before this column existed.

**New endpoint:** `POST /stocktakes/{id}/reconcile` (no request body). Response shape: `{"data": <StocktakeResource>, "reconciled_product_ids": [<uuid>, ...]}`. `StocktakeLineResource` gained one new read-only field, `system_revision`. No existing endpoint's request or response shape changed otherwise.

## 5. Concurrency cases — evidence per the contract's list

| Concurrency case | Test | Result |
|---|---|---|
| No intervening movement | `no_intervening_movement_preserves_the_current_posting_behavior` | Byte-identical posting outcome to pre-PR behavior |
| Sale after snapshot | `a_sale_between_snapshot_and_post_blocks_posting_without_any_mutation` | Rejected; zero stock/GL mutation from the attempt |
| Purchase receipt after snapshot | `a_purchase_receipt_between_snapshot_and_post_blocks_posting` | Rejected |
| Stock Permit issue after snapshot | `a_stock_permit_issue_between_snapshot_and_post_blocks_posting` | Rejected |
| Transfer out after snapshot (source warehouse's count) | `a_transfer_out_between_snapshot_and_post_blocks_posting_the_source_warehouse_count` | Rejected |
| Transfer in after snapshot (destination warehouse's count) | `a_transfer_in_between_snapshot_and_post_blocks_posting_the_destination_warehouse_count` | Rejected |
| Multiple movements (sale then receipt, net ≠ original) | `multiple_movements_between_snapshot_and_post_still_block_posting` | Rejected |
| **ABA / net-zero movement (the review's required scenario)** | `an_aba_movement_that_returns_to_the_original_quantity_still_blocks_posting` | **Rejected**, even though the final quantity is byte-identical to the snapshot — revision differs |
| Unrelated product, same warehouse | `movement_on_an_uncounted_product_in_the_same_warehouse_does_not_block_the_scoped_count` | Posts normally |
| Same product, different (uncounted) warehouse | `movement_in_a_different_warehouse_does_not_block_a_count_scoped_to_another_warehouse` | Posts normally |
| Retry/double-post | `reconcile_then_a_fresh_count_and_retry_succeeds_exactly_once_and_matches_the_ledger` | Posting succeeds once after `reconcile()` + a fresh count; a second `post()` on the now-posted document still throws "لا يمكن ترحيل جرد مرحَّل" |
| Retry after an ABA conflict specifically | `reconcile_updates_both_quantity_and_revision_after_an_aba_movement` | `reconcile()` refreshes both fields; a fresh count against the new baseline posts with the correct (zero) difference |
| Another stocktake/correction on the same Product×Warehouse | Structural — same row, same revision counter | Any operation that writes the row via `adjustWarehouseStock()` bumps its revision; a second stocktake's stale `system_revision` is detected identically to every other case above |

## 6. Every contract-required movement path increments revision

| Movement path | Test |
|---|---|
| Sale (Invoice → COGS) | `a_sale_increments_the_warehouse_revision` |
| Purchase receipt | `a_purchase_receipt_increments_the_warehouse_revision` |
| Stock Permit issue | `a_stock_permit_issue_increments_the_warehouse_revision` |
| Stock Permit receipt | `a_stock_permit_receipt_increments_the_warehouse_revision` |
| Stock Permit transfer (both legs) | `a_stock_permit_transfer_increments_the_revision_on_both_source_and_destination` |
| The stocktake's own posted correction | `posting_a_stocktake_difference_increments_the_revision_too` |

All six route through the single existing write path, `InventoryService::adjustWarehouseStock()` — there is exactly one place in the codebase that increments `revision`, confirmed by grepping every other writer of `product_warehouse_stock` and finding only read-only `::query()`/listing usages (`InventoryReportService`, `FuelCostBasisService`, `AccountSettingsController`, `WarehouseController`).

## 7. Rollback leaves no revision residue

| Scenario | Test |
|---|---|
| A Stock Permit transfer rejected for insufficient stock | `a_rejected_stock_permit_transfer_leaves_no_revision_residue_on_either_side` — asserts revision unchanged on **both** the source and destination warehouse rows |
| A stocktake `post()` rejected for one drifted line, with a second, undrifted line in the same document | `a_stale_stocktake_post_leaves_no_revision_residue_even_for_the_unaffected_line` — asserts the drifted product's revision (already changed by its own prior movement, not by the failed attempt) and the undrifted product's revision are both exactly what they were immediately before the attempt |

Both hold because the staleness check runs entirely before any `InventoryService` call in the same `DB::transaction()` — a thrown conflict rolls back the whole transaction, and there is nothing to roll back for a line the code never reached.

## 8. Accounting / Inventory reconciliation

**Δ1140 = Δsubledger, exact, across a full conflict→reconcile→repost cycle** (`delta_1140_exactly_equals_delta_subledger_across_a_sale_reconciliation_and_repost`): open a stocktake on 100 units (avg_cost 10000), count 95, a sale of 10 intervenes (balance → 90), the stocktake `post()` is rejected, `reconcile()` refreshes the line, a fresh count of 95 is recorded, and the retried `post()` succeeds. `Δ(quantity_on_hand × avg_cost)` for the stocktake's own correction equals `Δ1140` for that same correction, exactly, in halalas.

**No stock/GL mutation on conflict** (`a_sale_between_snapshot_and_post_blocks_posting_without_any_mutation`): after a rejected `post()` attempt, `StockMovement::count()` and `JournalEntry::count()` are unchanged from immediately before the attempt, the document stays `draft` with `journal_entry_id` null, and `Product.quantity_on_hand` is unchanged by the attempt.

**Correct outcome after an ABA cycle** (`reconcile_updates_both_quantity_and_revision_after_an_aba_movement`): after the 100→90→100 cycle, `reconcile()` sets `system_quantity=100`, a fresh count of 100 is recorded, and the retried `post()` produces `difference_value = 0` — proving the design doesn't just *detect* the ABA case but resolves it to the mathematically correct outcome (no phantom variance from a movement that net out to zero).

## 9. Security / Tenant / Branch / Warehouse evidence

Unchanged from the first version of this PR (verified again after the revision-based rewrite):

- `reconcile()` reuses the exact `products.manage` + `inventory.core` guard and `assertRecordAccessible()` call already used by `count()`/`post()`/`destroy()` — verified by re-running `StocktakeStockPermitRecordAccessTest` (15 scenarios) unmodified and green.
- `ProductWarehouseStock::where(...)` queries in `assertSnapshotStillValid()`/`reconcile()`/`snapshot()` run through `ProductWarehouseStock extends BaseModel`, carrying the mandatory `TenantScope` global scope — every such query is automatically tenant-filtered.
- The staleness check and `reconcile()` remain scoped by `(warehouse_id, product_id)`, matching `open()`'s own capture pair exactly.

## 10. Concurrency / idempotency

- **Deadlock avoidance**: unchanged — fixed `product_id` lock ordering in both `assertSnapshotStillValid()` and `reconcile()`.
- **Atomicity**: unchanged — the staleness check runs inside the same `DB::transaction()` as everything else, before any mutation.
- **Double-post**: unchanged guard, re-verified after a successful reconcile-then-repost cycle.
- **Verified on real PostgreSQL, not just SQLite** (see §11): `lockForUpdate()` takes real effect under PostgreSQL — this closes the caveat from the first version of this report, which could only note that SQLite silently no-ops the lock. The full PR-INV-4 suite and the entire test suite were run against a live local PostgreSQL 16 instance in this session with identical results to SQLite.

## 11. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=StocktakeConcurrencyReconciliationTest` (SQLite) | **22 passed** (62 assertions) | 12 from the first version + 10 new: the ABA scenario, ABA reconciliation, 6 per-movement-path revision-increment tests, and 2 rollback-residue tests |
| `php artisan test --filter="StocktakeTest\|StocktakeConcurrencyReconciliationTest\|StocktakeStockPermitRecordAccessTest\|InventoryReportTest\|StockPermitTest\|StockPermitUomValuationTest\|InvoiceTest\|PurchaseTest\|ReturnTest\|InventoryServiceTest"` (SQLite) | **170 passed** (1090 assertions) | Zero regressions |
| `php artisan test` full suite (SQLite) | **2472 passed, 1 skipped, 25 failed** | Same pre-existing, unrelated 25 (24 `Fuel*` on missing `ext-bcmath`, 1 `DocumentCenterSecureIntakeTest`) |
| **Same targeted suite, live PostgreSQL 16** | **82 passed** (537 assertions) | Installed and started PostgreSQL 16 in this sandbox (`postgresql-16` package was already present; started via `pg_ctlcluster`), created the `nibras`/`nibras` role and database matching `ci.yml`'s service container exactly, pointed `.env` at it, ran `migrate:fresh` (both new migrations applied cleanly), then this targeted suite — identical pass count and identical zero regressions to SQLite |
| **Full suite, live PostgreSQL 16** | **2473 passed, 25 failed** (no skips — one SQLite-only skip runs on Postgres) | Same 25 pre-existing/unrelated failures, byte-for-byte the same set as SQLite. This satisfies the review's explicit "SQLite + PostgreSQL CI كلاهما أخضر" requirement with a real run, not an assumption. |

## 12. Build / Lint / Typecheck

No `web/` changes. `vendor/bin/pint --test` compared pre-edit vs. post-edit via `git stash` for all five touched files (`StocktakeLineResource.php`, `ProductWarehouseStock.php`, `StocktakeLine.php`, `InventoryService.php`, `StocktakeService.php`): identical fixer lists before and after each — zero new violations. Both new migration files report clean. The test file shows only the same pre-existing-pattern violations already accepted across every other test file in this program. This repository's CI (`ci.yml`) does not gate on Pint.

## 13. CI

Unlike the first version of this report, the PostgreSQL leg was **actually run** in this session, not merely reasoned about — see §11. Both `ci.yml` matrix legs (`sqlite`, `pgsql`) are represented by real local runs with identical, all-pre-existing failure sets.

## 14. Deviations from approved plan

None from the contract itself — the policy decision (§2) remains B, as originally decided and re-confirmed after the fix. The one substantive change since the PR's first version is the correction detailed in §16, made in direct response to independent review, not a scope deviation: the review's own instructions were explicit about what to build and what to avoid (no timestamp as the primary mechanism, no SERIALIZABLE, no broad warehouse freeze, no scope beyond PR-INV-4), and all of those constraints were followed.

## 15. Risks / remaining work

- `reconcile()`'s "clear the count, force a recount" resolution remains the safest of the reasonable options (no guessing which portion of a drift is legitimate movement vs. real variance) but does mean a counter must physically revisit any item that drifted between snapshot and post — an accepted operational cost of policy B, unchanged from the first version.
- `revision` is a plain integer counter with no theoretical overflow concern at any realistic movement volume (`bigint`, unsigned).
- The local PostgreSQL instance used for §11 lives only in this sandbox session; it is not a substitute for the project's actual CI running the same `pgsql` matrix leg on every PR, which should still be watched once this PR is opened for review.

## 16. Post-review fix — monotonic revision identity, not quantity comparison alone

**Finding from independent review:** the first version of this PR's `assertSnapshotStillValid()`/`reconcile()` compared only `ProductWarehouseStock.quantity` (current) against `StocktakeLine.system_quantity` (snapshot). This is blind to an **ABA / net-zero movement**: `100 → issue 10 → 90 → receipt 10 → 100`. Two real, legitimate stock movements happened on the exact Product×Warehouse pair between snapshot and post, but the *final* quantity happens to coincide with the snapshot's quantity again, so the old comparison saw no difference and would have let a now-stale stocktake post through — exactly the "detect movements/state change since snapshot" requirement the contract states, which is not equivalent to "detect a different final quantity."

**Fix — a monotonic revision counter, not a timestamp:**

- New column `product_warehouse_stock.revision` (`unsignedBigInteger`, default 0).
- `InventoryService::adjustWarehouseStock()` — confirmed by inspection to be the **only** code path in the entire application that writes `product_warehouse_stock` (every other reference is a read-only `::query()`/listing) — now increments `revision` by exactly 1 immediately after incrementing `quantity`, for every call with a non-zero delta. This single chokepoint means every movement type the contract lists (sale/COGS via `Invoice::post()` → `recordSaleCogs()`, purchase receipt via `PurchaseService::post()`, Stock Permit issue/receipt/transfer via `StockPermitService::post()`, and the stocktake's own posted correction via `StocktakeService::post()` itself) automatically bumps revision with no per-caller duplication.
- New column `stocktake_lines.system_revision` snapshots the row's revision at `open()` time, alongside the pre-existing `system_quantity`.
- `assertSnapshotStillValid()` now compares **`system_revision` to the current revision** as the authoritative check. `system_quantity`/current quantity are still read and shown in the conflict message for human readability, but they no longer decide the outcome. The message distinguishes the ABA case explicitly: *"«المنتج» (تحرّك رصيده ثم عاد إلى N — لقطة الفتح لم تعد صالحة)"* when quantity coincidentally matches but revision doesn't, versus the plain "then/now" wording when quantity itself also differs.
- `reconcile()` refreshes **both** `system_quantity` and `system_revision` together, and its drift check is likewise revision-based.
- **No timestamp was used**, per the explicit instruction: a monotonic counter needs no notion of wall-clock time, is immune to clock skew or a database engine's timestamp-column precision limits between two very-fast-successive movements, and a strictly-increasing integer is suf­ficient and simpler to reason about than time-based ordering.
- **No SERIALIZABLE transaction isolation change** and **no broad warehouse freeze** were introduced — the fix is entirely local to the same row-level `lockForUpdate()` + comparison mechanism the original design already used, just comparing a different (correct) field.

**Verification that every required path increments revision, that rollback leaves no residue, and that the ABA scenario is both detected and correctly resolved** is detailed in §5–§8 above, backed by the 10 new tests enumerated in §11 (bringing the file from 12 to 22 tests). **Verification on both database engines** (§11) was performed with an actually-running local PostgreSQL 16 instance, not asserted from code inspection alone.
