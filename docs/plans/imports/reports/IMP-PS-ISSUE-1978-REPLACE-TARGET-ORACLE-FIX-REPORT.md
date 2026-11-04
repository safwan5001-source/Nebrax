# SEC #1978 — `replaces[]` target readability oracle (PS-A3e replace)

Branch: `claude/sec-1978-replace-target-oracle` · PR: see the pull request for this branch · **Base SHA:** `9613a9b5b8b785036dd9e0885bc1cae941b3641c` (`main`, after #1980) · **Head SHA:** the final commit on the PR (see the PR head; this file is part of it).
Status: **ready for review — not merged, not deployed.** No migration, no RBAC/role change, no accounting/ledger/ZATCA change.

## 1. Root cause
`POST partner-statement-reconciliations/{id}/replace` → `PartnerStatementLifecycleService::supersedeFinals()` loaded the `replaces[]` rows (tenant-scoped, so cross-tenant ids are already "unknown"), then for each row checked **`replace_target_mismatch`** (other partner/role, 422) and **`replace_target_not_closed`** (409) and only afterwards `assertCloseRunReadable()` (uniform refusal). A caller holding `partner_statements.close` + `partner_statements.void` and restricted to a branch could therefore learn, for a same-tenant id outside their scope: that it exists, whether it belongs to another partner/role (with its id echoed in `details`), and whether it is closed. Raised as an observation in `IMP-PS-ISSUE-1974-SECURITY-FIX-REPORT.md` §5; independent of the #1974 branch-message fix.

A second, subtler form was found while reproducing: with several ids the loop runs in id order, so a *readable* target failing early (`mismatch`) hides/reveals the others — `[readable, unreadable]` and `[readable, unknown]` produced different responses.

## 2. Reproduction evidence (before the fix)
New tests, run against `main`'s services (valid payload, authorized actor, branch-restricted to B1, throttle cache flushed, `app.debug=false` as in production):

| Probe (restricted actor) | Before | After |
|---|---|---|
| unknown uuid | 422 `الطرف غير متاح لك في هذا الدور.` | same |
| org-wide closed final of **another partner** | **422 `replace_target_mismatch` + `details.reconciliation_id`** | 422 uniform body, byte-identical to unknown |
| org-wide **reviewed (not closed)** same-partner candidate | **409 `replace_target_not_closed`** | 422 uniform |
| org-wide closed same-partner final | 422 uniform (already safe) | 422 uniform |
| `[readable-mismatch, unreadable]` vs `[readable-mismatch, unknown]` | differ (mismatch error leaks ordering) | identical |

4 of the 7 new tests fail on the old code (parity, mixed-ids, no-trace rollback, check-order guard).

## 3. Fix (smallest safe change)
* `PartnerStatementMatchService::assertReconciliationReadable()` — the existing `authorize()` rule (partner/role/frozen-policy-branch via `assertAccess`; branch-scope failure → uniform refusal) extracted into one public method; `authorize()` now calls it (behaviour unchanged). No exception-class widening, no message matching.
* `PartnerStatementLifecycleService::supersedeFinals()` — a **first pass over all targets** calls new `assertTargetReadable()` (the rule above **and** the target's `reviewed_run_id` run must be `readable()` by the actor); only then the second pass evaluates mismatch / not-closed / close-run / retire. Unreadable ⇒ the same `PARTNER_UNAVAILABLE` `RuntimeException` as an unknown id (422, same body).
* Readable targets keep `replace_target_mismatch` / `replace_target_not_closed` exactly; unrestricted actors are unaffected; `import/preview`, `apply`, `void`, `close` untouched.

Changed files: `app/Services/PartnerStatementLifecycleService.php` (+19), `app/Services/PartnerStatementMatchService.php` (+16/−8), `tests/Feature/PartnerStatementVoidSupersedeApiTest.php` (+7 tests, helpers).

## 4. Tests
New (in `PartnerStatementVoidSupersedeApiTest`): status+full-body parity for 3 unreadable kinds vs unknown; mixed readable+unreadable ids (ordering forced so a single-pass check fails deterministically); readable targets keep precise errors (restricted: B1 targets; unrestricted: all); readable in-branch replace succeeds atomically with zero ledger/payment/stock deltas; refused replace by restricted actor leaves no event/claim/status change; close-only / void-only → 403 before targets are examined, reviewer = closer → 403 `closer_must_differ_from_reviewer`, foreign-tenant id ≡ unknown; static order guard. Existing suites cover overlap acknowledgement, atomic rollback, claims, concurrency.

Local results (PHP 8.3, PostgreSQL 16, filter `PartnerStatement|PartnerLedgerCandidates`):
* **SQLite: 228 passed, 32 skipped (PostgreSQL-only), 0 failed.**
* **PostgreSQL 16 (serial, `lock_timeout=60s`): 260 passed (6503 assertions), 0 skipped, 0 failed** — includes `PartnerStatementVoidSupersedeConcurrencyPostgresTest` (`pcntl_fork`, 9 tests).
* The complete `php artisan test` suite was **not** run locally (very long; `bcmath` is missing in the sandbox) — it is delegated to CI on this PR; see §5.

### Mutation verification (reverted after each)
| Mutation | Result |
|---|---|
| M1 readability check moved after mismatch/not-closed (original unsafe order) | 4 of 7 new tests fail |
| M2 single pass (check per target inside the detail loop) | mixed-ids test + order guard fail |
| M3 drop the run-scope half of the check | 3 of 7 fail |

## 5. Build / CI
Draft state of CI is recorded on the PR checks (ci.yml sqlite + pgsql, full suite). Filled in by the PR conversation; do not treat the issue as closed until CI is green on the final head and the PR is approved.

## 6. Client dependence
No code in `web/`, contracts or docs consumes `replace_target_mismatch` / `replace_target_not_closed`; only backend tests do. Behaviour change is limited to *unreadable* targets (message/status of that refusal becomes the uniform one).

## 7. Risks and limits
* Behavioural change (intended): a branch-restricted actor who previously got 409/422 detail for an out-of-scope target now gets the uniform 422. A target whose policy branch is readable but whose review/close run scope is not is also treated as unreadable (stricter, consistent with the existing close-run rule).
* Timing side channels are not addressed (out of scope, as in #1974).
* "Deleted" targets: reconciliations have no soft delete and no delete API; a missing id is covered by the unknown-id case.
* Throttle (`20/min` on `replace`) was neutralised in test setup only (cache flush), not in code.

## 8. Rollback
Revert the PR. No data, schema or settings involved.

## 9. Next step
Owner review of the PR; merge only on explicit owner approval. Nothing else (PS-A4a, Track B, POLICY-0) was started.
