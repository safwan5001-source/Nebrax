# IMP-H5-S2b — Expense import wizard (UI)

Web wizard for the registered `expense_import` domain (H5-S2). Four steps like the partner wizard: setup (file · rules · column mapping) → preview (no writes) → preview-bound durable job → result with failed-row download/repair. Entry: «استيراد من ملف» on `/expenses`; route `/expenses/import`.

## What is specific to expenses

- **Drafts only.** The copy says so at the rules step, the preview and the result; nothing is posted and tax/totals are derived by the server. The mapping step states that the amount column is **before tax**, in riyals, with a dot as the decimal separator.
- **Rules (frozen with the preview):** reference policy (optional/required), default expense account (only active, postable `expense` accounts from `/accounts`), default payment method, default tax rate (0–100, validated client-side as the server does).
- **Explicit duplicate confirmation.** Rows the server rejected as a duplicate (`repeat_candidate`, new boolean on preview rows) get a checkbox «genuine repeat — create it»; ticking it re-previews immediately with `confirmed_repeat_rows`, the server returns a new binding for exactly that list, and the job freezes it (`options[confirmed_repeat_rows][]`). Any change to the file, mapping or a rule **drops the confirmations** (row numbers belong to one file and rule set).
- Apply is disabled while errors remain or a re-preview is running; a bound job sends no semantic options on apply.

## Files

`web/src/modules/expenses/import/{contract.ts,ExpenseImportWizard.tsx}` · `web/src/app/(app)/expenses/import/page.tsx` · `web/src/modules/import-jobs/client.ts` (all import domains typed; list-valued options sent as `options[key][]`) · `web/src/app/(app)/expenses/page.tsx` (entry button) · `web/src/messages/{ar,en}.json` (`expenseImport.*`, `expenses.import_from_file`) · backend: `ExpenseImportService::rowSummary` adds `repeat_candidate` (+ assertion in `ExpenseImportTest`).

## Accounting impact

None — the UI only drives the already-merged drafts-only endpoints. No journal entries.

## Verification

- Web: new `ExpenseImportWizard.test.tsx` (5), `contract.test.ts` (5), `client.test.ts` (+1); **full web suite 700 files / 8397 tests passed**. `tsc` is clean for the touched files (pre-existing errors exist only in other test files).
- Backend: `ExpenseImportTest` + `H5ImportEndpointsTest` 56 passed (SQLite).
- Local `next build` cannot run here (Google Fonts fetch is blocked in the sandbox — unrelated to this change); the Web CI build is the authority.
- No screenshots were taken (no browser session against a seeded tenant in this environment); the UI is verified by component tests only. This is a disclosed limit, not a claim of visual verification.

## Not in scope / next

Stocktake count wizard (H7-S1c), purchases (H5-S3/S4), AI Action `expense_import.v1` (H5-S5, after OPS-02).
