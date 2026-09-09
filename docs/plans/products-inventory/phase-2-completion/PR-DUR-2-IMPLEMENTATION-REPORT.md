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
| `tests/Feature/ImportJobApplyTest.php` | 8 tests originally — see §5. **Review round:** +4 tests (blank-row completion, multi/trailing-blank single-call completion, pre-fix `row_count` self-heal, frozen-`batch_size` proof) — 12 total. |
| `docs/plans/products-inventory/phase-2-completion/DURABLE-IMPORTS-DECOMPOSITION.md` | §6 added: full PR-DUR-2 contract (mutation boundary, progress model, state machine, concurrency mechanism, deviation note). **Review round:** added the "Review-round fix" subsection documenting the `row_count`/`processed_rows`/completion fix and the frozen-`batch_size` contract clarification. |
| `app/Services/ProductImportService.php` | **Review round.** `isBlankRow()` promoted `private` → `public static` — same body, same call sites (now `self::isBlankRow()` instead of `$this->isBlankRow()`), reused by `ImportJobService` as the single blank-row definition. Zero behavior change to `inspect()`/`parse()`. |
| `app/Services/ImportJobService.php` | **Review round.** `inspect()`'s `row_count` now counts data rows (header dropped, blanks excluded) instead of physical rows. `applyNextChunk()` recomputes/self-heals `row_count` once on the first chunk (before the completion check), and `processed_rows` is set to the exact cumulative count with no `min()` cap. See §6 (fix section) below. |

No file outside this list was touched at the time this PR was first opened for review. See §6 below for the
review-round fix, which does touch `ProductImportService` (one method promoted from `private` to
`public static`, zero behavior change) in addition to `ImportJobService` and the test files.

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
- **Options freeze**: on the transition `ready → processing` (the first `/apply` call), the request's options —
  `mode`, `blank_policy`, `master_data_policy`, `mapping`, **and `batch_size`** — are saved verbatim to
  `apply_options` before any row is touched. Every later call — including a resumed one after a crash — ignores
  its own request body entirely (for anything but which cursor to resume from) and reuses the frozen value.
  `batch_size` is treated as a semantic option, not an operational per-request one: a later call passing a
  different `batch_size` cannot change how big the remaining chunks are, exactly like `mode`/`blank_policy`/
  `master_data_policy`/`mapping` never change mid-run. This is the simpler, fully deterministic contract — a
  job's entire chunking behavior is fixed at the moment it starts processing, so replaying/retrying any chunk
  is unambiguous regardless of what a client sends afterward. (An earlier draft of this report incorrectly
  claimed `batch_size` stayed live per-request; the implementation was always frozen — see §6, Finding 2.)
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
| `blank_rows_are_excluded_from_row_count_and_do_not_block_completion` **(review round)** | A file with a blank row interleaved between two valid rows and two trailing blank rows, `batch_size=1`: `row_count` reported as `2` (data rows, not the 5 physical rows), each `/apply` call advances `processed_rows` by exactly 1 real row, final status `completed` (not `failed`), 2 products created exactly once, and a post-completion retry stays idempotent. |
| `multiple_and_trailing_blank_rows_complete_in_a_single_default_size_call` **(review round)** | Same file, default (uncapped) `batch_size`: a single `/apply` call reaches `completed` with `processed_rows=2`, proving the fix holds outside the `batch_size=1` edge case too. |
| `a_stale_pre_fix_physical_row_count_self_heals_on_first_apply` **(review round)** | A job row inserted directly with the pre-fix physical `row_count=5` (simulating a job created before this fix shipped): the first `/apply` call self-heals `row_count` to `2` before deciding completion, and the job reaches `completed` instead of hanging or failing. |
| `batch_size_is_frozen_from_the_first_apply_call_and_later_requests_cannot_change_it` **(review round)** | First call freezes `batch_size=1`; a later call passing `batch_size=100` is ignored — chunk size stays 1 for the rest of the job. Proves the corrected report claim in §4. |

`tests/Feature/ImportJobTest.php`'s PR-DUR-1 suite: one test renamed/narrowed (`NOT_YET_REACHABLE` now covers
only `QUEUED`), the other 14 unchanged and still green.

### Results

**PostgreSQL 16** (local harness, `.github/workflows/ci.yml`'s copy-list):
- `ImportJobApplyTest`: **12/12 passed** (1 skipped: `a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock` runs
  and passes on PostgreSQL — "skipped" count is 0 there), assertions above 66 from the original 8 plus the 4 new
  tests.
- `ImportJobTest`: **15/15 passed**.
- Product Import regression (`ProductImportTest` 7 tests + `ProductImportV2Test` 49 tests = 56 tests, 305
  assertions): **56/56 passed** — including the existing `import creates no stock movement and no journal entry`
  test, unmodified. (`ProductWorkbookTest`/`InventoryOpeningImport*` were run in this same regression pass in the
  original PR-DUR-2 report; not re-run in this review round since neither `ProductWorkbookService` nor
  `InventoryOpeningImportService` was touched by this round's fix.)
- Full local `php artisan test` run: launched in the background for this round; the pre-existing
  `bcmath`/`FuelCostBasisService` gap noted in the original report is environment-only (CI installs `bcmath`) and
  unrelated to this diff — see original results below for its exact shape.

**SQLite** (same harness, `DB_CONNECTION=sqlite`):
- `ImportJobApplyTest`: **11/11 passed, 1 skipped** (the PostgreSQL-only lock test, correctly skipped with reason)
  — 12 tests total including the 4 new ones.
- `ImportJobTest`: **14/14 passed, 1 skipped** (the pre-existing PR-DUR-1 concurrency test, unchanged).
- Product Import regression: **56/56 passed**, 305 assertions.

**Original PR-DUR-2 results (pre-review-round, unchanged by this fix's diff outside `ImportJob*`):**

- PostgreSQL: `ImportJobApplyTest` 8/8, `ImportJobTest` 15/15, Product Import regression 110/110 (635
  assertions, includes `ProductWorkbookTest`/`InventoryOpeningImport*`), full suite 3176 passed / 26 failed
  (`bcmath`-only, disclosed in PR-DUR-1's report) / 20658 assertions / 605.28s.
- SQLite: `ImportJobApplyTest` 6/6 (2 skipped), `ImportJobTest` 13/13 (2 skipped), Product Import regression
  110/110, full suite 3159 passed / 26 failed (same `bcmath` cause) / 17 skipped / 20581 assertions / 246.58s.

CI (`shivammathur/setup-php@v2` installs `bcmath`) is expected to show 0 Fuel-domain failures, matching PR-DUR-1's
precedent.

## 6. Review-round fix — blank rows and the `batch_size` contract

Two findings from pre-merge review of this PR (Head `b357139f9f04469998db16ba4eec612237eb7262`):

**Finding 1 (BLOCKER) — blank rows could prevent completion, or turn it into a false `failed`.** Full
root-cause, fix, and backward-compatibility analysis is in
`DURABLE-IMPORTS-DECOMPOSITION.md` §6 → "Review-round fix — `row_count`/`processed_rows`/completion must share
one 'data row' definition." In short: `ImportJob.row_count` counted physical rows (blank included) while
`ProductImportService::parse()`'s `dataIndex` — the only counter that actually drives batching — skips blanks;
a job with any blank row could never reach `processed_rows >= row_count`, stayed `processing` forever, then
failed on the next call because that call's window was past the true end of data.
`ProductImportService::isBlankRow()` is now the single shared (`public static`) definition; `row_count` is
computed with it at `inspect()` time and self-healed once at the first `/apply` call for jobs created before
this fix; `processed_rows` is the exact cumulative applied count with no cap. This was §9's known-and-deferred
risk item in the original report — it is fixed now, not deferred further (see the corrected §9 below).

**Finding 2 (P2) — the report claimed `batch_size` stayed live per-request; the implementation always froze
it.** `DURABLE-IMPORTS-DECOMPOSITION.md`'s schema table (§6, `apply_options` row) already documented
`batch_size` as part of the frozen options, and `ImportJobService::applyNextChunk()`'s code always read
`batch_size` from the frozen `apply_options`, never from a later request. Only this report's §4 prose
(now corrected above) claimed otherwise. Resolution: kept the implementation as-is (the simpler, fully
deterministic contract — a job's chunk size is fixed for its whole life, matching every other apply option) and
fixed the report; added `batch_size_is_frozen_from_the_first_apply_call_and_later_requests_cannot_change_it` to
close the gap between "documented" and "tested."

## 7. CI

Reported once the dedicated PR-DUR-2 PR is opened on this review round's exact Head SHA — see §11 for the SHA
once pushed.

## 8. Tenant / security evidence

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

## 9. Accounting / inventory non-effect evidence (D-08 unchanged)

`completed_apply_creates_zero_inventory_or_ledger_effect` asserts, after a full completed chunked run:
`StockMovement::count() === 0`, `JournalEntry::count() === 0`, `JournalLine::count() === 0`, and every created
product's `quantity_on_hand === 0` / `avg_cost === 0` (the `Product` model's own defaults, never touched).
This is unsurprising by construction — `ProductImportService::apply()` itself never touches stock or the
ledger, and PR-DUR-2 adds no code path that could — but it is asserted explicitly, not just inherited by
absence, so a future change to either service trips this test if it regresses.

## 10. Risks / remaining work

- **Known, pre-existing, out of scope**: `ProductImportService::parse()`'s within-file uniqueness check
  (`assertUniqueWithinFile`) operates on the batch window, not the whole file, when batching is active. A
  duplicate SKU/barcode split across two different chunks of the *same* import is not caught as a
  within-file duplicate (each chunk sees it as unique in its own window) — it would instead surface as a live
  conflict at the DB level on the second chunk if `products.manage` mode is `create`, or as two legitimate
  sequential updates if `update`/`upsert`. This characteristic already exists in the currently-shipped
  synchronous batch-apply option (`batch_offset`/`batch_size` in `/products/import/apply`) and predates PR-DUR-2;
  this PR reuses `apply()` unchanged and does not worsen or fix it. Not in this PR's scope per the approved
  requirements (reuse the mutation boundary as-is).
- **`inspect()`'s `row_count` vs. chunking's `dataIndex`** — ~~previously listed here as a known,
  deferred risk~~ **fixed in the review round (§6, Finding 1).** `row_count` now shares the exact same
  blank-excluding data-row definition as `dataIndex`, computed at `inspect()` time and self-healed on a job's
  first `/apply` call for anything created before the fix. No longer a risk; kept as a struck-through note here
  for audit continuity with the original report.
- **Self-heal covers only jobs still `ready`**: the first-chunk self-heal in `applyNextChunk()` corrects
  `row_count` before the completion check runs, but only for a job that has not yet started processing. This is
  provably sufficient: any job that had already taken a chunk under the pre-fix bug would, by the documented
  state machine, already be terminal `failed` (not resumable) by the time this fix ships — there is no
  "already mid-flight with a stale `row_count`" case left. No such jobs exist in any deployed environment today
  either way, since Durable Imports has not shipped to production.
- **No frontend**: `/import-jobs/{id}/apply` has no UI caller yet — PR-DUR-5's explicit subject.
- **CI**: reported for this review round's exact Head SHA once the dedicated PR-DUR-2 PR is opened — see §11.

## 11. Branch / PR / SHAs / next step

- **Branch**: `claude/pr-dur-2-review-fixes-fmutus` (this review round; built directly on top of
  `claude/pr-dur-2-chunked-apply`'s reviewed tip).
- **Base SHA**: `26d58d8fb1ca6acee9d585f09dcd039565662a97` (`main`, includes merged PR-DUR-1 at `b1b291eaf4789327688412875efab51ebf4838fe`)
- **Reviewed Head SHA (this round's starting point)**: `b357139f9f04469998db16ba4eec612237eb7262`
  (`claude/pr-dur-2-chunked-apply`, plus a docs-only commit `35022bc831e5f941c49dfe8bf39d99da5c8188ac` adding
  this report).
- **New Head SHA (with the two review fixes)**: recorded once pushed — see the PR description / task report for
  the exact commit.
- **PR**: dedicated PR-DUR-2 PR opened on this branch, separate from #746 and from the original
  `claude/pr-dur-2-chunked-apply` checkpoint, per the approved scope.
- **Next step**: open the PR, monitor CI, report PR URL + CI run status. No merge, no deploy, no PR-DUR-3 — per
  the approved scope.

## Accounting entries produced by this PR

**None.** `ImportJobService::applyNextChunk()` produces no accounting entry of any kind — it calls
`ProductImportService::apply()` unchanged, which itself never calls `LedgerService::post()`. No new debit/credit
pair exists anywhere in this diff. This satisfies the pre-PR protocol's accounting-entry table requirement
vacuously: there is no new financial operation in this module to tabulate.
