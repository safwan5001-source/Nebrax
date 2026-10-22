# IMP-H1-S3a — Job branch binding (F-15)

**Branch:** `claude/imp-h1-s3a-preview-binding` · first of three S3 slices (S3b = preview/option binding + UI, S3c = sync-apply binding + plan drift).

## Problem (F-15)

`ImportJob` had no branch. Every apply chunk took the branch from the **current request** (`SetBranch` → `BranchContext`), so a job created while
branch A was active could be applied under branch B, stamping `BranchScoped` rows (products, categories, brands, units, partners) with the wrong branch.

## Changes

- Migration `2026_11_23_010000_add_branch_id_to_import_jobs`: nullable `branch_id` (FK `branches`, `nullOnDelete`). **Additive; existing jobs stay `NULL`; no backfill.**
- `ImportJobService::create()` captures `BranchContext::id()` once (server-derived in `SetBranch` after the user's branch scope was verified). The idempotency identity now includes the branch
  (a legacy `NULL` job is treated as matching); the mismatch message mentions the branch.
- `applyNextChunk()` runs each chunk through `withJobBranch()`: the job's branch is set on `BranchContext` for the chunk and the request's previous value is restored in `finally`.
  A job with `branch_id = NULL` (legacy / tenant without branches) keeps the old behaviour exactly.
- `ImportJobAccess::assertJobBranch()` — a user without access to the job's branch gets **403** on apply and cancel (even if their active branch is another one).
- `ImportJobResource` exposes `branch_id`.
- `ImportJob` stays `CompanyWide` (the job belongs to the organization; `branch_id` is a binding, same as `AiAction`).

## Safety / deploy evaluation

- No journal entry; no domain-service change; AI settings, Railway, accounting, ZATCA untouched.
- **Migration** runs at boot on deploy (`migrate --force`). It adds one nullable FK column to a small table (`import_jobs`) — no rewrite, no backfill, no new lock beyond a brief `ALTER`. `down()` drops the column (no data guard needed: it is a pure binding).
- Behavior change (intentional, narrow): a job's rows are stamped with the job's branch instead of the apply request's branch; a user outside the job's branch is refused (403) on apply/cancel; the same idempotency key in a different branch is rejected (422).

## Tests

`ImportJobBranchBindingTest` (6): records/exposes the branch; apply stamps the **job** branch not the request header's; request context restored after the chunk;
restricted user → 403 on apply/cancel with no rows and job still `ready`; idempotency key across branches rejected, true retry returns the same job; legacy `NULL` job keeps old behaviour.
Negative control (`withJobBranch` neutralised) fails the stamping test. Existing `ImportJob*`/`ImportDomain*` suites unchanged and green (195 passed).

Added after the independent review: multi-chunk job with the request branch changing between chunks (all rows stamped with the job branch), a failing chunk (job `failed`, request context restored, nothing written),
a restricted user **with** the job's branch can still apply, and an `inventory_opening` job under another request branch. Total 10 tests. Full local suite at `dc6486b`: 8192 passed / 26 env-only `bcmath`.

## Scope notes (so S3a is not read as closing F-15 everywhere)

- The **synchronous** endpoints (`products/import/apply`, `products/workbook/apply`, `inventory-openings/import/apply`) still use the request's branch — that is S3c.
- `show`/`index` are not fenced by branch (the job is `CompanyWide`; only `branch_id` is visible).
- `nullOnDelete`: deleting a branch used to turn its jobs into legacy jobs (request-branch behaviour, no 403 fence) — flagged by the independent review **and by the Codex review of this PR**. Fixed: `BranchController::destroy` now refuses (422) while an *unfinished* job (`uploaded`/`ready`/`queued`/`processing`, `ImportJobStatus::UNFINISHED`) references the branch; finished jobs (completed/failed/cancelled) don't block and keep `NULL` for audit. Covered by a test. (A rare create-between-check-and-delete race remains; it degrades to the legacy behaviour, never to data loss.)
- `recountOnFirstApply()` also runs under the job branch (review finding; all adapters return `null` today).

## Codex follow-ups on this PR (all fixed)

1. Branch deletion nulling the binding of an actionable job → deletion refused while a job is unfinished (above).
2. Uploads orphaned when the insert fails for any reason (e.g. the branch deleted between `SetBranch` and the insert) → generic cleanup (`catch Throwable` → delete stored files → rethrow), test with negative control.
3. A terminal job whose branch was deleted matched any idempotent retry from another branch → strict branch comparison, test added.

## Review

Codex (when its quota returned) reviewed commit `3983a53`: one P2 finding (branch deletion), fixed above. Before that, an independent read-only subagent reviewed the diff (static; did not run tests): no blocking defects. Its medium findings (recount outside the branch wrapper; missing multi-chunk / exception-restore / other-domain tests) are fixed above; the low ones are recorded in the scope notes.
