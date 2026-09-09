# PR-DUR-2 — Implementation Report

**Durable Imports: chunked/resumable apply engine for Product Catalog**

## 1. What changed

`ImportJobService::applyNextChunk()` is the only new mutation-driving code. It calls
`ProductImportService::apply()` — **unchanged, zero lines added to that class** — once per HTTP request, for a
bounded row window, sourcing the file from PR-DUR-1's durable storage instead of a fresh upload, and sourcing
the resume cursor from a new durable column instead of a client-supplied value.

A single `DB::transaction()` holding `lockForUpdate()` on the `ImportJob` row for the **entire** chunk (read
cursor → materialize file → call `apply()` → persist result) is the whole concurrency/idempotency mechanism.
No new table, no queue, no per-row failure ledger.

Full contract, mutation-boundary analysis, and the recorded deviation from the pre-written forward-contract
(queue-dispatch → per-request HTTP-driven chunking) are in
`DURABLE-IMPORTS-DECOMPOSITION.md` §6.

## 2. Files changed

| File | Change |
|---|---|
| `database/migrations/2026_09_18_010000_add_apply_progress_to_import_jobs.php` | **New.** Additive: `processed_rows` (unsignedInteger, default 0), `apply_options` (json, nullable), `apply_result` (json, nullable) on `import_jobs`. |
| `app/Models/ImportJob.php` | Adds the three columns to `$fillable` and casts (`integer`, `array`, `array`). |
| `app/Services/ImportJobService.php` | Adds `applyNextChunk()` and private `assertApplicable()`. No change to `create()`/`inspect()`/`cancel()`. |
| `app/Http/Requests/ApplyImportJobRequest.php` | **New.** Validates `mode`/`blank_policy`/`master_data_policy`/`mapping`/`batch_size` — no `file`, no `batch_offset` (server-owned cursor). |
| `app/Http/Controllers/Api/ImportJobController.php` | Adds `apply()` action, wiring `SensitiveCostPolicy::authorized($request->user())` live, exactly as `ProductController::importApply()` does. |
| `app/Http/Resources/ImportJobResource.php` | Exposes `processed_rows`, `apply_result`. |
| `app/Support/ImportJobStatus.php` | `NOT_YET_REACHABLE` narrowed to `[QUEUED]` only — `PROCESSING`/`COMPLETED` are now live states. Doc comment updated. |
| `routes/api.php` | Adds `POST /import-jobs/{id}/apply`, gated `products.manage` (same as `store`/`cancel`). |
| `tests/Feature/ImportJobTest.php` | Renames/updates the PR-DUR-1 test whose premise (`processing`/`completed` unreachable) no longer holds; behavior unaffected otherwise. |
| `tests/Feature/ImportJobApplyTest.php` | **New.** 8 tests — see §5. |
| `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` | §6 added: full PR-DUR-2 contract (mutation boundary, progress model, state machine, concurrency mechanism, deviation note). |

No file outside this list was touched. `ProductImportService`, `ProductController`, `ProductLifecycleService`,
and every existing import/workbook/inventory-opening surface are byte-for-byte unchanged.

## 3. Schema / migrations / API

**Schema** — additive only, see table above; no new table, no column renamed or dropped, no backfill needed
(`processed_rows` defaults to `0` for the small number of pre-existing PR-DUR-1 rows in any deployed
environment — they are all in `ready`/terminal states already, so the default is correct for them by
construction).

**API** — one new endpoint:

```
POST /api/import-jobs/{id}/apply
Body (all optional, read only on the job's first apply call): mode, blank_policy, master_data_policy, mapping, batch_size
Auth: Sanctum + products.manage
Response: ImportJobResource (now includes processed_rows, apply_result)
```

No existing endpoint's request/response contract changed. `/products/import/apply`, `/products/workbook/*`,
`/inventory-openings/*` are untouched.

## 4. Apply / resume / idempotency model (exact)

- **Cursor**: `ImportJob.processed_rows`, durable, read fresh under `lockForUpdate()` at the top of every call.
  Never taken from the request or from process memory.
- **Options freeze**: on the transition `ready → processing` (the first `/apply` call), the request's options are
  saved verbatim to `apply_options` before any row is touched. Every later call — including a resumed one after
  a crash — ignores its own request body's semantics and reuses the frozen value; only `batch_size` from a
  fresh call still governs *that* chunk's size (the row-processing rules themselves — mode/blank/master-data
  policy/mapping — never change mid-run).
- **One row lock, held end-to-end for the chunk**: `lockForUpdate()` is taken once and not released until the
  chunk's status/cursor update commits. This is the entire concurrency mechanism — no advisory lock, no
  optimistic-concurrency version column, no process-memory guard.
  - Two concurrent `/apply` calls on the same job: the second blocks on the row lock until the first commits,
    then reads the now-advanced cursor and processes the *next* window. Proven on PostgreSQL with a genuine
    second connection (not inferred from SQLite) — see §5.
  - A crash/interruption before the transaction commits: nothing persisted (options-freeze save and cursor
    advance are in the *same* transaction), so a retry reads the unchanged cursor and reprocesses the identical
    window from scratch — no double effect, because nothing from the failed attempt exists to double.
  - A retry against an already-`completed` job: short-circuits before calling `ProductImportService::apply()`
    again.
- **Failure is terminal, not resumable**: any exception from `ProductImportService::apply()` (a live SKU/barcode
  conflict, a cost-authorization revocation between chunks, a malformed row) sets `status = failed` and
  `error_message`, and is surfaced as an HTTP 422. This matches "deterministic failure state" with the smallest
  mechanism — no per-row retry queue.
- **Non-goal, by design**: `ImportJobService::applyNextChunk()` does not dispatch a queued job. See
  `DURABLE-IMPORTS-DECOMPOSITION.md` §6's deviation note for why (production runs `QUEUE_CONNECTION=sync`; a
  queue dispatch there is either a no-op wrapper or, if self-chaining, defeats bounded chunking entirely).

## 5. Tests and results

New file `tests/Feature/ImportJobApplyTest.php`, 8 tests:

| Test | Proves |
|---|---|
| `first_apply_processes_chunks_and_completes` | 3 rows, `batch_size=1` → 3 calls, `processed_rows` 1→2→3, `ready→processing→processing→completed`, 3 products created. |
| `an_interrupted_first_chunk_leaves_no_partial_state_and_a_retry_completes_cleanly` | A `RuntimeException` thrown from an `ImportJob::saving` hook mid-transaction leaves the job unchanged (`ready`, `processed_rows=0`, `apply_options=null`, 0 products); a retry then completes normally with no duplicate. |
| `retrying_a_completed_job_is_idempotent_and_creates_nothing_twice` | Second `/apply` on a `completed` job returns the cached state; product count unchanged. |
| `a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` | **PostgreSQL only.** A genuine second `pgsql` connection's `SELECT ... FOR UPDATE` on the same row, fired from inside our transaction while the lock is held, fails under a 200ms `lock_timeout` — proves the lock is real, not inferred from SQLite's file-level serialization. Skipped on SQLite with an explicit reason, same convention as `ImportJobTest`'s PR-DUR-1 concurrency test and `DocumentNumberingTest`. |
| `apply_cannot_be_called_from_another_tenant` | Cross-tenant `/apply` → 404 (existing `BaseModel`/`TenantScope` behavior, not new code). |
| `apply_fails_closed_on_a_cancelled_job` | Terminal status → 422, no product created. |
| `apply_fails_closed_on_a_domain_with_no_apply_engine` | A job manually re-domained off `product_catalog` → `RuntimeException` from `assertApplicable()`. |
| `completed_apply_creates_zero_inventory_or_ledger_effect` | After a full completed run: `StockMovement::count() === 0`, `JournalEntry::count() === 0`, `JournalLine::count() === 0`, every created product's `quantity_on_hand`/`avg_cost` still `0`. |

`tests/Feature/ImportJobTest.php`'s PR-DUR-1 suite: one test renamed/narrowed (`NOT_YET_REACHABLE` now covers
only `QUEUED`), the other 14 unchanged and still green.

### Results

**PostgreSQL 16** (local harness, `.github/workflows/ci.yml`'s copy-list):
- `ImportJobApplyTest`: **8/8 passed**, 66 assertions.
- `ImportJobTest`: **15/15 passed**, 76 assertions.
- Product Import regression (`ProductImportTest`, `ProductImportV2Test`, `ProductWorkbookTest`,
  `InventoryOpeningImport*`): **110/110 passed**, 635 assertions — including the existing
  `import creates no stock movement and no journal entry` test, unmodified.
- **Full suite**: 3176 passed, 26 failed, 20658 assertions, 605.28s. All 26 failures are
  `Call to undefined function App\Services\bcmul()` in `FuelCostBasisService` — the local sandbox's PHP build
  lacks the `bcmath` extension that `.github/workflows/ci.yml` installs via `shivammathur/setup-php@v2`. Same 26
  tests, same root cause, disclosed identically in PR-DUR-1's report; zero relation to `ImportJob`/`Product`/this
  PR's diff.

**SQLite** (same harness, `DB_CONNECTION=sqlite`):
- `ImportJobApplyTest`: **6/6 passed, 2 skipped** (the PostgreSQL-only lock test, correctly skipped with reason).
- `ImportJobTest`: **13/13 passed, 2 skipped** (the pre-existing PR-DUR-1 concurrency test, unchanged).
- Product Import regression: **110/110 passed**, 635 assertions.
- **Full suite**: 3159 passed, 26 failed, 17 skipped, 20581 assertions, 246.58s. Identical 26-test failure set
  to PostgreSQL, same `bcmath` cause.

CI (`shivammathur/setup-php@v2` installs `bcmath`) is expected to show 0 Fuel-domain failures, matching PR-DUR-1's
precedent.

## 6. CI

Not yet run for this PR (branch pushed as a checkpoint; PR not yet opened at the time of writing this report —
see §9). Will be reported alongside the PR URL once opened and CI completes, per PR-DUR-1's precedent
(`.github/workflows/ci.yml` on both `sqlite` and `pgsql` matrix legs).

## 7. Tenant / security evidence

- **Tenant isolation**: `apply_cannot_be_called_from_another_tenant` — the new endpoint inherits
  `BaseModel`/`TenantScope` automatically (the controller's `ImportJob::query()->whereKey($id)->firstOrFail()`
  is unchanged from `show`/`cancel`); no manual scope-bypassing query was introduced.
  `completed_apply_creates_zero_inventory_or_ledger_effect` and every other new test also runs under
  `registerTenant()`'s normal tenant-scoped flow.
- **Authorization**: `POST /import-jobs/{id}/apply` is gated `products.manage`, identical to `store`/`cancel`.
  Cost-column authorization is re-checked **live** on every chunk via
  `SensitiveCostPolicy::authorized($request->user())`, passed straight through to
  `ProductImportService::apply()` exactly as `ProductController::importApply()` already does — a permission
  revoked between chunk 1 and chunk 2 is caught on chunk 2, not cached from chunk 1.
- **Fail-closed**: wrong domain (`apply_fails_closed_on_a_domain_with_no_apply_engine`), wrong status
  (`apply_fails_closed_on_a_cancelled_job`), and cross-tenant access all reject before any write, matching the
  project's fail-closed convention (`config/imports.php`'s S3 check, `ZatcaIcvScope`, etc.).
- **Concurrency**: proven on PostgreSQL with a genuine second connection, not inferred from SQLite — see §5.

## 8. Accounting / inventory non-effect evidence (D-08 unchanged)

`completed_apply_creates_zero_inventory_or_ledger_effect` asserts, after a full completed chunked run:
`StockMovement::count() === 0`, `JournalEntry::count() === 0`, `JournalLine::count() === 0`, and every created
product's `quantity_on_hand === 0` / `avg_cost === 0` (the `Product` model's own defaults, never touched).
This is unsurprising by construction — `ProductImportService::apply()` itself never touches stock or the
ledger, and PR-DUR-2 adds no code path that could — but it is asserted explicitly, not just inherited by
absence, so a future change to either service trips this test if it regresses.

## 9. Risks / remaining work

- **Known, pre-existing, out of scope**: `ProductImportService::parse()`'s within-file uniqueness check
  (`assertUniqueWithinFile`) operates on the batch window, not the whole file, when batching is active. A
  duplicate SKU/barcode split across two different chunks of the *same* import is not caught as a
  within-file duplicate (each chunk sees it as unique in its own window) — it would instead surface as a live
  conflict at the DB level on the second chunk if `products.manage` mode is `create`, or as two legitimate
  sequential updates if `update`/`upsert`. This characteristic already exists in the currently-shipped
  synchronous batch-apply option (`batch_offset`/`batch_size` in `/products/import/apply`) and predates PR-DUR-2;
  this PR reuses `apply()` unchanged and does not worsen or fix it. Not in this PR's scope per the approved
  requirements (reuse the mutation boundary as-is).
- **`inspect()`'s `row_count` vs. chunking's `dataIndex`**: `ImportJob.row_count` (used as the completion
  threshold) counts all non-header rows including blank ones; `ProductImportService::parse()`'s batch-window
  filter counts only non-blank data rows. A file containing blank rows between data rows would therefore have
  `row_count` slightly overstate the number of actually-batchable rows. This is the same counting convention
  PR-DUR-1's `inspect()` already established (unchanged here) and is not something a chunked apply engine could
  fix without changing `inspect()`'s contract, which is out of this PR's scope. Files used in this PR's own
  tests contain no blank rows, so this does not affect the reported test results; flagging it here for whoever
  designs PR-DUR-3/4's Workbook/Inventory-Opening wiring, since both may have sparser rows.
- **No frontend**: `/import-jobs/{id}/apply` has no UI caller yet — PR-DUR-5's explicit subject.
- **CI not yet run** for this branch (see §6) — will be confirmed before requesting merge.

## 10. Branch / PR / SHAs / next step

- **Branch**: `claude/pr-dur-2-chunked-apply`
- **Base SHA**: `26d58d8fb1ca6acee9d585f09dcd039565662a97` (`main`, includes merged PR-DUR-1 at `b1b291eaf4789327688412875efab51ebf4838fe`)
- **Head SHA**: `b357139f9f04469998db16ba4eec612237eb7262`
- **PR**: not yet opened — pushed as a checkpoint per the stop-hook's request; will open a dedicated PR (separate
  from #746) once CI is confirmed green on this Head SHA, per the approved scope ("create a dedicated PR for
  PR-DUR-2 only").
- **Next step**: open the PR, monitor CI, report PR URL + CI run status. No merge, no deploy, no PR-DUR-3 — per
  the approved scope.

## Accounting entries produced by this PR

**None.** `ImportJobService::applyNextChunk()` produces no accounting entry of any kind — it calls
`ProductImportService::apply()` unchanged, which itself never calls `LedgerService::post()`. No new debit/credit
pair exists anywhere in this diff. This satisfies the pre-PR protocol's accounting-entry table requirement
vacuously: there is no new financial operation in this module to tabulate.
