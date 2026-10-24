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

- Web: new `ExpenseImportWizard.test.tsx` (9), `contract.test.ts` (6), `client.test.ts` (+1); **full web suite 700 files / 8397 tests passed**. `tsc` is clean for the touched files (pre-existing errors exist only in other test files).
- Backend: `ExpenseImportTest` + `H5ImportEndpointsTest` 56 passed (SQLite).
- Local `next build` cannot run here (Google Fonts fetch is blocked in the sandbox — unrelated to this change); the Web CI build is the authority.
- No screenshots were taken (no browser session against a seeded tenant in this environment); the UI is verified by component tests only. This is a disclosed limit, not a claim of visual verification.

## Independent review dispositions (subagent; Codex not claimed)

| # | Finding | Disposition |
|---|---|---|
| 1 | Job-creation failure (expired binding, rejected option, network) left an empty page | **Fixed** — the error is shown and the wizard returns to the preview; test added |
| 2 | A stale `engine.job` survived a file/rule change and was re-applied instead of the new preview | **Fixed** — any change of file, rule, mapping or a new preview drops the job (it stays on the server, resumable by URL); test with mutation control |
| 3 | Repeat candidates beyond the 200 truncated preview rows could not be confirmed | **Fixed** — server returns `repeat_candidates` independent of truncation (cap 200, PHP test with 207 rows); UI lists from it |
| 4 | Resumed job that is not preview-bound would freeze page defaults | **Fixed** — apply blocked with a message (unreachable for this PREVIEW_BOUND_ONLY domain, kept as a guard) |
| 5 | Tax input accepted `1e1`, `0x10`, `5.` | **Fixed** — `parseTaxRate` (`^\d{1,3}$`, ≤100) |
| 6 | Failed confirmation re-preview left a blank step | **Fixed** — previous preview kept, checkbox reverted, error shown; aria-live status while re-previewing |
| 7 | a11y: unnamed select for an empty header; `dir="ltr"` around Arabic vendor text | **Fixed** — fallback label «Column n»; `dir="auto"` |
| 8 | Inspect failure leaves auto-mapping | Accepted (server auto-maps; the server still validates) |

**Codex review (2 × P2, both valid, fixed):** (a) the result screen showed only the *last chunk's* `created` (`apply_result` is overwritten per chunk) — it now shows the cumulative `processed_rows` (create-only domain; test with a 250-row job whose last chunk created 50); (b) with more than 200 candidates the confirmed ones (filled first by sheet order) hid the later unconfirmed ones — `repeat_candidates` now lists **unconfirmed first**, so every confirmation exposes the next batch (PHP test with 205 candidates).

**Codex, second pass (2 × P2, both valid, fixed):** (c) a job resumed after a refresh while `processing` showed only progress and a cancel button — nothing continued the chunk loop; the apply card now offers an explicit **Continue** (only for a preview-bound job that is `processing` and idle), which calls `applyLoop` with the frozen options (test); (d) the rollback of a failed confirmation toggle ran even when the request had been **superseded** by a file/rule change, restoring confirmations that belonged to the old input — `runPreview` now reports `ok | failed | stale` and only `failed` reverts (test with two candidates and a pending toggle; mutation-controlled).

The Partner wizard shares findings 1–2 (and the last-chunk result count); they are logged as follow-up **IMP-WIZARD-STATE-01** (also: last-chunk result counts in the Partner wizard) (not widened here).

## Not in scope / next

Stocktake count wizard (H7-S1c), purchases (H5-S3/S4), AI Action `expense_import.v1` (H5-S5, after OPS-02).
