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

## Review

Codex quota exhausted — not Codex-reviewed. Independent subagent review: see PR.
