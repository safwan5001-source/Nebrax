# IMP-H5-S2 — Expense import: endpoints + durable job domain

Registers the H5-S1c expense adapter and exposes it. **Drafts only** — nothing is posted and no journal entry is created; posting stays `ExpenseService::post` → `LedgerService`.

## Changes

| Area | File |
|---|---|
| Domain + gates | `ImportJobDomain::EXPENSE_IMPORT = 'expense_import'`; view `expenses.view`, manage `expenses.manage`, app `finance.operations` (= `POST /expenses`); in `PREVIEW_BOUND_ONLY` |
| Registry | `ImportDomainRegistry` registers `ExpenseImportAdapter` (`DOMAIN` references the constant) |
| Endpoints | `GET expenses/import/fields`, `GET expenses/import/template`, `POST expenses/import/inspect`, `POST expenses/import/preview` — gates `expenses.manage` + `finance.operations`; file routes behind `EnsureImportFilesScanned`; **no synchronous apply** (404 asserted). Preview issues the single-use binding **with the row plan** (so a conflicting expense created after approval is `plan_drift`, not a silent duplicate) |
| Requests | `ExpenseImportRequest`; `StoreImportJobRequest`/`ApplyImportJobRequest` accept `reference_policy`, `default_account_id`, `default_payment_method`, `default_tax_rate`, `confirmed_repeat_rows` (frozen with the preview; apply cannot change them → `options_frozen`) |
| Tests | `H5ImportEndpointsTest` (14) · `ExpenseImportTest` (registered-with-gates test replaces "not registered") |

## Accounting impact

**None.** Drafts only: a completed job leaves `journal_entries` untouched (asserted) and each imported expense reserves its identity (`import_document_reservations`). Typical row 1,000.00 + 15 %: amount 100000 / tax 15000 / total 115000 halalas, posted later by the existing action.

## Verification

- SQLite: H5 endpoints (12) + ExpenseImport (42) + H7/StocktakeCount + route/permission/scan/application-access/AI-type-gate/branch-isolation sweeps green; PostgreSQL: 97 passed (H5 + ExpenseImport incl. the 3 race tests + H7 + StocktakeCount).
- The single failing test in the wider sweep (`fuel sale api…`) is the known local `bcmath`-missing environment failure, absent in CI.
- Failure paths asserted by code: in-file duplicate → `row_duplicate_in_file` unit; drift → `plan_drift` unit; nothing written in either case.

## Independent review dispositions (Codex out of quota — none claimed)

| # | Finding | Disposition |
|---|---|---|
| 1 | A repair child job inherited the parent's `confirmed_repeat_rows` (row numbers of the *original* file) while its file is renumbered → a different row could be silently treated as a confirmed repeat | **Fixed** — `ExpenseImportAdapter::effectiveOptions()` clears `confirmed_repeat_rows` for repair children; a genuine repeat is confirmed by a new import with its own preview. Unit-tested |
| 2 | Repair options validated only for product keys; array values for string options → 500 | **Fixed** — `canonicalOptions` passes non-scalars through and `options()` rejects them with a named error |
| 3 | JSON `5.0` vs multipart `"5"` canonicalised differently → false `preview_mismatch` (fail-closed) | **Fixed** — integral floats canonicalise to int |
| T | Missing tests: equal-vs-edited frozen options, repair inheritance | **Added** |

Residual (accepted): repair children have no stored plan (same for every ROW domain; repair claims the failed units by source ref).

## Not in scope / next

UI wizard (`/expenses/import`), failure-file/repair UI reuse, AI Action `expense_import.v1` (H5-S5, after the X-01 operational state), H5-S3/S4 purchases. No migration, permission, accounting or ZATCA change.
