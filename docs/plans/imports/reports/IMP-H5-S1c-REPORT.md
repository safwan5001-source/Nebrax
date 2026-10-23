# IMP-H5-S1c — Expense import adapter (unregistered)

Standard (non-AI) import: **one row = one expense DRAFT** through `ExpenseService::create` only. No posting, no journal entry, no endpoint, no registry entry (registration + gates + durable domain = H5-S2).

## What was built

| File | Role |
|---|---|
| `app/Support/ExpenseImportFields.php` | Field contract (date, amount before tax, account code, category, supplier code, vendor name, cost-center code, payment method, tax rate, reference, description). No derived/system/posting fields. |
| `app/Services/ExpenseImportService.php` | inspect · template · preview (with plan) · apply (windowed, one transaction per chunk) |
| `app/Services/ExpenseImportAdapter.php` | `UNIT_ROW` durable-engine adapter, `DOMAIN = 'expense_import'`, failure-export capable, **unregistered** |
| `tests/Feature/ExpenseImportTest.php` | 38 tests (SQLite + PostgreSQL) |
| `tests/Feature/ExpenseImportConcurrencyPostgresTest.php` | 3 `pcntl_fork` race tests (PostgreSQL; fail, never skip, if `pcntl` is missing) |

## Contract decisions (AWJ decisions, per master plan H5-S1)

- **Tax and totals are derived** by `ExpenseService` from `amount` (before tax, riyals → halalas via the shared `ProductImportValueNormalizer::money`) and `tax_rate`. The file cannot supply `tax_amount`/`total`.
- **References by trusted identifiers; no auto-create.** Account by code (expense, postable, active), supplier by code (visible partner that is a supplier), cost center by code (active), category by exact normalized name among **active** categories (ambiguity = error). A missing reference is a row error; names are not identifiers for accounts/partners/cost centers.
- **Duplicate protection (H5-S1a/b reservations):** every imported expense reserves `vendor ‖ normalized reference ‖ date ‖ amount ‖ occurrence`; reference-less rows still reserve (no-ref key). Before writing, the importer rejects (a) duplicates **inside the file** — fails the whole file at chunk 0 so no window is committed before a late duplicate is found — and (b) rows matching an **existing** expense by the same criterion the service uses (`vendor ‖ date ‖ amount`, reference ignored), including manual expenses that have no reservation.
- **Confirmed repeats:** `confirmed_repeat_rows` (sheet row numbers, frozen with the preview) mark genuine repeats. They get a deterministic occurrence id `sha256(job id | row)`, so replaying a chunk cannot create a second expense (unique reservation → named failure) while a new job is a new decision.
- **Per-run policies (configured, not imposed):** `reference_policy` optional|required (default optional), `default_account_id`, `default_payment_method` (cash), `default_tax_rate` (15). Defaults equal `POST /expenses` behaviour.
- **Order of checks at apply:** empty → file duplicates (chunk 0) → **plan drift** → row errors → writes. Drift precedes row errors: something that changed since approval is reported as drift, not as a row defect.
- A race that slips past the preview check surfaces as `ImportUnitFailureException` (`duplicate_document`, named row) and the chunk rolls back — never a bare 500.

## Accounting impact

**No journal entries.** The import creates `status = draft` expenses only; posting stays a separate action through `ExpenseService::post` → `LedgerService`. A static test asserts the three new files never mention the ledger/journal. Derived amounts for a typical row (1,000.00 + 15 %): amount 100000, tax 15000, total 115000 halalas.

## Verification

- SQLite: `ExpenseImportTest` 38 passed (163 assertions). PostgreSQL: the same 38 + 3 race tests passed, race file repeated 3× stable.
- Negative controls (mutation): disabling the existing-expense check fails 4 tests; disabling in-file duplicate flagging fails 2.
- Lock order verified by the opposite-order importer + direct creator race (no 40P01): numbering anchor → advisory identity lock → reservation, as already established in H5-S1b.
- SQLite 42 / PostgreSQL 45 (incl. 3 race tests) passed after review fixes.
- Independent subagent review (Codex quota-limited — no Codex review is claimed):

| # | Finding | Disposition |
|---|---|---|
| 1 | `canonicalOptions` coerced `default_tax_rate` (`""`→0% VAT) and `confirmed_repeat_rows` (`3.9`→3) before validation | **Fixed** — invalid values pass through unchanged and `options()` rejects them; tests added |
| 2 | Cross-branch importers hold different numbering anchors, then tenant-wide identity locks in opposite order → possible 40P01 | **Accepted, documented.** Fails closed (rolled-back chunk, no corruption, retryable); a pre-lock in sorted order would invert the established anchor→identity order and create a worse deadlock with direct creators. Same design as H5-S1b |
| 3 | `85,50` read as thousands → ×100 | **Fixed** — a comma followed by 1–2 trailing digits is `invalid_money` (expense-only guard; shared normalizer untouched) |
| 4 | Plan drift is checked before row errors (siblings check errors first) | **Kept deliberately** — a change since approval is drift; test locks it |
| 5 | Default `occurrence_scope` `standalone` | **No action** — no sync apply exists; adapter always scopes by job id and overrides a forged scope; fails closed |
| 6 | Fractional Excel serials rejected | **Fixed** |
| T | Tautological category assertion; missing cross-tenant, blank-row, later-window-confirm tests | **Fixed / added** (branch-scoping of partner/category is covered by the shared `BranchScope` and H3 tests; not duplicated here) |

## Not in scope / next

Endpoints, `ImportJobDomain` registration and gates (`expenses.manage` + `finance.operations`), preview-bound-only enforcement, UI wizard (H5-S2); expense attachments; AI Action `expense_import.v1` (H5-S5, after X-01 operational state). No change to accounting, ZATCA, permissions, migrations or routes.
