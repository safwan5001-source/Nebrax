# IMP-PARTNER-STATEMENTS — Review of PR #1877 (PS-A1) + decision hand-off for PS-A2

Date: 2026-11-01 · Owner decisions applied: D-PS-01..04, P-1..P-5, **D-PS-08 (approved)**, **period-reconciliation policy (approved)**. Not approved / not assumed: D-PS-05, D-PS-06, D-PS-07, D-PS-09, D-03, D-06, D-13.

## 1. State of PR #1877
| Item | Value |
|---|---|
| Branch / PR | `claude/imp-ps-a1` · #1877 (open, ready for review, not merged) |
| Base recorded in the first hand-off | `30b0bcb5f2ff1d46d6606d0ab45abb9ce23f282a` (merge-base). GitHub now reports base `main@2eed4fcfd…`; `main` has since moved to `071558885` (5 newer commits). **`git merge-tree` against current main: clean, no conflicts.** |
| Head reviewed | `08fa7e752dd1fe4a2c975b4ec4213df18182e107` — CI on it: SQLite ✔ · PostgreSQL ✔ · web build ✔ (after one re-run of an unrelated `next/font` network failure) · CI Gate ✔ · Codex: no open findings |
| Head after the review fix | the commit that carries this report (pushed to the same branch; see PR for its SHA and the CI that re-runs on it) |

## 2. Review result (read-only pass, then one fix)
| # | Area | Verdict |
|---|---|---|
| 1 | Conformance to D-PS-01..04, P-1..P-5 | ✔ SAR only (option, row, tenant); independent `partner_statements.*`; `CompanyWide`; tolerances 3 d [0–30] / 0 halalas [no %]; direction mandatory for one column; reversed policy recorded; tenant-level partner + optional branch filter |
| 2 | Tenant isolation, RBAC, partner and branch visibility | ✔ `BranchScope::reference(Partner)` like the report; one identical refusal for missing / foreign / invisible / wrong-role partner; job reads need `partners.view` too; stored `apply_result` has no partner data; branch filter must be inside the actor's scope |
| 3 | CompanyWide limits | ✔ no path reads a reconciliation without `assertAccess`; replay/preview ids are exposed only after it |
| 4 | Parser | ✔ debit/credit non-negative only; signed forms `-x`, `(x)`, `x-`, `+x`, mixed forms refused; DD/MM/YYYY, ISO, Excel serial 36526–73415 (years 2000–2100) else row error; European decimal comma refused; zero amount refused; `MAX_AMOUNT_MINOR` bound |
| 5 | Inspect / Preview / Apply, frozen options | ✔ preview-bound only; options canonicalised and frozen; apply request accepts only the frozen keys; apply re-checks access inside the transaction |
| 6 | Replay / idempotency / PostgreSQL races | **P1 defect found and fixed** (below). Race: advisory xact lock + unique index, never catching a unique violation; 6-process fork test green on PostgreSQL |
| 7 | Accounting / tax effect | ✔ none; row counts of 9 financial tables and a hash of `partners` unchanged; static test forbids ledger/document/inventory/ZATCA references |
| 8 | Backward compatibility with the Unified Import Engine | ✔ additive domain; `ImportJobAccess` extension only adds a check for the new domain (`alsoRequires` is empty for every other domain); 739 import/RBAC/catalogue/branch-guard tests pass locally (32 PG-only skips on SQLite) |
| 9 | Migration `2026_12_25_010000` | ✔ sorts after the newest migration on both the PR base and current `main` (`2026_12_24_020000`); no migration was added to `main` since; no collision. Not renamed. **Edited in place for the P1 fix** (the migration is unmerged and no environment has it) |
| 10 | "Environmental" local failures | ✔ not hiding a regression: the 46 local failures map to missing `bcmath` (fuel suites), the two known `InventoryOpeningZeroValueDateGuardTest` cases and files absent from the local Laravel mirror (`contracts/`, mail views); **the same full suite is green in CI on both databases for this head** (CI has `bcmath` and the full tree) |

### Findings
| Class | Finding | Status |
|---|---|---|
| **P0** | none | — |
| **P1** | **Idempotency keyed on the file bytes only.** Re-uploading the same file with a different interpretation (corrected `amount_direction`, tolerance, column mapping, branch filter) returned the first, wrongly interpreted draft as `replayed`; A1 has no discard, so the user was trapped — contradicts the approved policy (several drafts allowed, never trap the user). | **Fixed in this PR** (below) |
| P2 | Excel-serial date: any 5-digit integer in the date column inside the serial window is read as a date (e.g. `45000`). Intended for XLSX date cells; a CSV with a numeric ID in the date column becomes a plausible date, but the period-bounds warning and the out-of-window rejection limit the damage. | Documented, not changed |
| P2 | Printed-balance consistency is sign-agnostic (cannot see a flipped sign convention). Warning only; never a matching input. | Known (report risk 4) |
| P2 | Report observation for PS-A2 (not this PR): reversal entries are created without `source_type/source_id` (LedgerService.php:104-150), and the role-filtered branch of `ReportService::partnerStatement` keeps rows only when `sourceRoles[source] === role` → the reversal rows appear to be dropped for a role-filtered statement while the original stays. Code reading only; PS-A2b starts with a characterisation test. **No change made.** | Carried into the A2 plan §3.5 |

### Fix (inside PS-A1 scope only)
- `identity_sha256` = SHA-256({file hash, effective column mapping, frozen policy}). Unique index `partner_stmt_recon_idem_unique` is now `(tenant_id, partner_id, role, period_from, period_to, identity_sha256)`; `file_sha256` kept and indexed (informational — "same file seen before"). Advisory lock, `existing()` and preview use the identity. Same file + same interpretation ⇒ replay (unchanged behaviour and test); same file + different interpretation ⇒ a new draft; the earlier draft is untouched. No unique constraint limits drafts per scope.
- Regression test added; mutation control (identity reverted to the file hash) fails it.

## 3. Files changed by the review fix
`database/migrations/2026_12_25_010000_create_partner_statement_tables.php` · `app/Models/PartnerStatementReconciliation.php` · `app/Services/PartnerStatementImportService.php` · `tests/Feature/PartnerStatementImportTest.php` · `docs/plans/imports/reports/IMP-PS-A1-REPORT.md` · `docs/plans/imports/AWJ_UNIFIED_IMPORT_HORIZON_TRACKER.md` · `docs/plans/imports/AWJ_IMP_PARTNER_STATEMENTS_PLAN.md` · new `docs/plans/imports/AWJ_IMP_PS_A2_EXECUTION_PLAN.md` · new `docs/plans/imports/reports/IMP-PS-A1-REVIEW-AND-A2-HANDOFF.md`. No application code outside the statement feature, no API change, no permission change.

## 4. Tests
| Run | Result |
|---|---|
| `PartnerStatementImportTest` (SQLite) | 35 passed (519 assertions) |
| `PartnerStatementImport*` (PostgreSQL, includes the 6-process race and the 4-file case) | 37 passed (531 assertions) |
| Mutation control for the fix | fails as intended |
| Import / RBAC / ApplicationCatalog / BranchIsolationGuard filter (SQLite) | 739 passed, 32 skipped (PG-only), 0 failed |
| CI on the new head | pending at the time of writing — see the PR checks (SQLite, PostgreSQL, web build, CI Gate) |

## 5. Tenant isolation, RBAC and financial no-effect — verification summary
Cross-tenant partner/reconciliation/binding refused; unavailable-partner refusal identical for every cause; `partners.view` required for reads of the job as well as for creation; losing visibility before apply ⇒ 403 and the job stays ready; no implicit permission (owner/admin through `*` only; absent from `MATRIX` and from every stored role); no write to `journal_entries`, `journal_lines`, invoices, purchases, payments, expenses, credit notes, stock movements or reservations; partner rows unchanged; lines immutable.

## 6. Effect of D-PS-08 and the drafts policy on PS-A2 (detail in `AWJ_IMP_PS_A2_EXECUTION_PLAN.md`)
- **Key:** `accounting.partner_statements` (convention `group.capability`; depends on `accounting.ledger`; operational gate). Wired through the existing `ImportJobDomain` `app` field and `EnsureApplicationActive`; RBAC stays independent and mandatory. `built` only when A2 ships a usable capability.
- **Needs the owner:** legacy tenants (registered before `ENFORCEMENT_CUTOVER_AT`) are treated as *enabled* for any capability they never decided on, so a new `built` key switches on automatically for them (D-PS-13). Exposure is bounded by the owner/admin-only permissions.
- **Drafts policy:** unlimited drafts per scope; the single *effective final* is `status = 'closed'` (superseded/voided are history); replace is explicit with a reason and an append-only events table; guarantee = advisory lock + compare-and-swap + partial unique index on `closed` + a PostgreSQL fork race test. Implemented in PS-A3, not A2.
- **A2 engine:** reads the ledger only through the report source (wrapper + additive keys pending D-PS-10), mirrors orientation uniformly (their debit = our credit) with role-specific candidate filtering and sanity checks, deterministic R1–R3 ladder, five outcomes with stored rule and explanation, reversed originals and their reversals handled as neutralised pairs, many-to-one verified but never auto-applied.

## 7. Risks
Concurrency: A1 race proven; the close/void race (A3) is designed, not built. Migration: edited pre-merge, additive, `down()` refuses with data; deploy order irrelevant (new tables only). Compatibility: new import domain only; the one shared-code touch (`ImportJobAccess::alsoRequires`) is inert for all other domains. Policy: D-PS-13 rollout default; the report/reversal observation could change A2 scope. Nothing deployed; no environment, Railway or flag change.

## 8. Recommendation
**READY_TO_MERGE — conditional on the CI of the fix commit being green** (SQLite, PostgreSQL, web build, CI Gate) and the owner's explicit merge approval. Reasons: no P0; the one P1 is fixed with a regression test and mutation control; D-PS-01..04 are honoured; zero financial effect is proven; the PR merges cleanly into current `main`. If the fix commit's CI shows a real failure the status flips to BLOCKED until it is fixed.

## 9. Next step (after your approval, in this order)
1. Review/merge #1877 (explicit approval required).
2. Answer D-PS-10 (additive report keys), D-PS-11 (orientation flag — recommended: not now), D-PS-12 (branch-filtered final), D-PS-13 (legacy-tenant default for the new key).
3. Then PS-A2a (catalogue key + gates) → PS-A2b (candidate source + characterisation test) → PS-A2c (engine + match API), each its own PR. PS-A3/PS-A4/Track B stay untouched until approved.
