# AWJ-ERP-UX-H1-7C1 — English UI on the main list pages — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-025 (P2), first module group · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md)

## Outcome
In English, the invoices, products, credit-notes, debit-notes and suppliers lists showed Arabic sort options, search placeholders, filter labels, a column header ("المتبقي"), pagination text and button names. All of them now come from the message catalog (new `listUi` namespace, AR/EN). Pagination arrows on the credit-notes, debit-notes and suppliers lists now point the right way in LTR (they were RTL-only icons).

## Changed files
- `web/src/app/(app)/{invoices,products,credit-notes,debit-notes,suppliers}/page.tsx` — literals → `useTranslations('listUi')`; module-level sort option constants moved into the components (`useMemo`) because they need translations; `ltr:rotate-180` on the pagination chevrons.
- `web/src/messages/{ar,en}.json` — `listUi` (53 keys; Arabic values are the exact previous literals, so the Arabic UI is unchanged).
- `web/src/i18n/__tests__/no-hardcoded-arabic.test.ts` (new guard).
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-7C1-REPORT.md`

## Tests and exact results
- Guard: **on `main` sources 5 failed / 5; with the change 5 passed / 5** (one case per converted file; future slices add their files).
- Existing page tests for the five routes: 27 passed.
- Full Vitest on the final tree: recorded in the PR.
- Real browser (baseline vs integration build, 1440): Arabic strings found in the page chrome (`th`, `label`, `button`, `option`, placeholders, `aria-label`, list footers) with `locale=en`: invoices 8 → **0**, products 7 → **0**, credit notes 8 → **0**, debit notes 8 → **0**, suppliers 8 → **0**. Arabic UI unchanged (same strings, now from the catalog).

## Guardian
Labels only. Sort values, filter keys, request parameters and money formatting unchanged.

## Remaining for ERP-UX-025
Other files from the H1-0 scan (POS shift settings, saved report views, inventory categories, POS dialog, Commerce/App Builder) follow in later H1-7C slices. `inventory/page.tsx` already switches on locale inline (correct output, bypasses the catalog) — lower priority.

## Residual noted (not changed)
In the English layout a long Arabic name in a truncated list cell is clipped at its beginning (the cell is LTR, the name RTL). Same on `main`; fixing it needs a per-cell direction decision (alignment vs. ellipsis side) — recorded for H1-8.
