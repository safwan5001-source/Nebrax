# IMP-H5-S1b — ExpenseService owns the reservation lifecycle + `duplicate_reference_policy`

**Branch:** `claude/imp-h5-s1b-expense-hooks` (stacked on S1a / PR #1675). **No migration, route, permission, ledger, accounting-rule, ZATCA, env or AI-setting change.** One new tenant setting (default preserves today's behaviour). **No importer yet** (S1c) — nothing in production passes a reservation context.

## What changes

- `ExpenseService::create(array $data, ?array $reservation = null)` — `$reservation = ['source', 'reference', 'occurrence_id']` is supplied only by importers / Document Center (later slices). Direct creation (`null`) is **byte-for-byte the old behaviour** unless the tenant opts in to `block`.
  - Order inside the one transaction: derive predicate → PG advisory lock on `(tenant, vendor, date, amount)` → existing-document lookup (skipped when an explicit `occurrence_id` confirms a repeat) → `Expense::create` → `reserve()`.
  - Existing-document lookup is **company-wide** (deliberately bypasses `BranchScope`, tenant scope stays): duplicates are a company question, and a second branch must not re-book the same vendor/date/amount. Matches `partner_id`, or the normalised vendor name when there is no partner.
- `ExpenseService::update` — a reserved draft **re-keys in place** when vendor/date/amount change; the stored `reference` and `occurrence` survive (Expense has no reference column, so the predicate JSON is their only home). Collision ⇒ `DuplicateDocumentException` ⇒ 422 and nothing changes. An unreserved (manual, `allow`) expense never gains a reservation by being edited.
- `ExpenseService::discardDraft` (called by `DELETE /expenses/{id}`, replacing the controller's inline delete) — attachments, reservation and expense go in one transaction. Posted expenses cannot be deleted, so their reservation stays and keeps blocking re-import.
- Setting `finance.duplicate_reference_policy = allow | block` (`GET/PUT /settings/finance`, same `payments.view/manage` gates; validated `in:allow,block`). **`allow` (default):** direct creation unchanged, no reservation; imports still refuse to duplicate an existing or reserved expense. **`block`:** direct creation joins the same protocol, so a direct create racing an import cannot duplicate in either order. A tenant that pays the same vendor the same amount daily should stay on `allow` (CLAUDE.md rule 6: policy, not a forced behaviour).
- `DocumentDuplicateReservationService::forDocument` is used by `update` (added in S1a).

## Decisions / disclosures

- **Why an advisory lock instead of a partner row lock** (master plan said "counterparty lock"): many expenses have only a free-text vendor name and no partner, so there is no row to lock; the lock key `(tenant, vendor key, date, amount)` serialises exactly the set that can collide, with or without a partner, and is transaction-scoped. A first version used a partner row lock and the PostgreSQL race test **failed** (two expenses) — that is what led to this change.
- **The race protects the broad identity (vendor‖date‖amount), not only the reference-bearing key.** An import with reference `R-1` and a direct create with no reference have different `dedupe_key`s, so the unique index alone cannot arbitrate them; the lock + lookup does.
- Edits into an identity held only by an **unreserved** legacy expense are not checked on `update` (re-key checks reservations only). Create is the guarded moment; documented, not hidden.
- `ExpenseService::duplicate()` (the "copy" action) creates directly: under `block`, copying an expense onto the same day collides and returns 422 by design.
- Document Center's `ExpenseDocumentDraftBuilder` still calls `create($data)` (manual source) until H5-S6 passes `source=document_center`.
- No UI for the setting in this slice (web toggle is planned with H5-S2).

## Tests

- `ExpenseDuplicateReservationTest` (15, SQLite + PG): default/validation of the setting; `allow` unchanged (two identical expenses, zero reservations); `block` refuses identical and passes different amount/date/vendor; vendor-name normalisation; `block` refuses a legacy unreserved duplicate; import reserves under `allow` and refuses a reserved *and* an existing manual duplicate (reports the holder); explicit occurrence id lets one confirmed repeat through (and only once); failed import leaves no expense/reservation; edit re-keys keeping the reference; edit into a taken identity ⇒ 422, unchanged; edit of an unreserved expense never reserves; delete releases and a corrected re-import succeeds; posted keeps its reservation and cannot be deleted; **posting an imported draft yields the same journal lines as a manual one** (no ledger change); copy action unchanged under `allow`.
- `ExpenseDuplicateReservationConcurrencyPostgresTest` (2, real PG + `pcntl_fork`): 8 racers (half import, half direct under `block`) ⇒ exactly one expense and one reservation, losers get `DuplicateDocumentException`; a delete racing a re-import leaves no orphan reservation. **Negative control (manual):** with the advisory lock disabled the first test failed in 3 of 4 runs; with it, 0 of 4.
- Regression: `Expense*`, `FinanceSettings*`, `CashBankAccount*`, `Settings*`, `DocumentCenter*` — 185 passed locally (SQLite). Full suite in CI.

## Accounting statement

No journal entry is created or changed by this slice: reservation rows are not ledger rows, and `post()` is untouched (a test proves an imported draft posts to the same lines as a manual one). Posting still goes only through `LedgerService::post`.
