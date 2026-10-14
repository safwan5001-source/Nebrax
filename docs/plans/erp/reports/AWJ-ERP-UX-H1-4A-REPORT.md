# AWJ-ERP-UX-H1-4A — Row-actions header name and bidi-safe names — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-015, ERP-UX-016 (P3) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.6

## Outcome
- **Row-actions column header** now has an accessible name ("إجراءات الصف" / "Row actions", visually hidden) wherever a `DataTable` column has `id: 'actions'` and an empty header. One change in `DataTable` covers every list that uses that convention (invoices, purchases, partners, products, suppliers, warehouses, branches, cash & bank, assets, …). A labelled actions header is left untouched.
- **Latin names in RTL lists** keep their punctuation on the right side: "Al Khobar Trading Est." rendered as ".Al Khobar Trading Est" on `/invoices` (desktop and mobile). Free-text title/subtitle of the shared mobile record are now wrapped in `<bdi>`, as are the partner cells of the invoices and purchases lists.

## Changed files
- `web/src/components/data-table.tsx` (empty `actions` header → sr-only name)
- `web/src/components/nebrax/mobile-record.tsx` (`isolate()` for string title/subtitle)
- `web/src/app/(app)/invoices/page.tsx`, `web/src/app/(app)/purchases/page.tsx` (partner cell `<bdi>`)
- `web/src/messages/{ar,en}.json` (`nebrax.rowActionsHeader`)
- `web/src/components/data-table.test.tsx` (+3), `web/src/components/nebrax/mobile-record.test.tsx` (+2)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-4A-REPORT.md`

## Tests and exact results
- `data-table.test.tsx`, `mobile-record.test.tsx`: 48 passed (incl. new: AR/EN header name, labelled header untouched, `<bdi>` for strings, nodes passed through).
- Full Vitest on the final tree: recorded in the PR.
- Real browser (baseline vs integration build, 1440, AR):

| Probe | Before | After |
|---|---|---|
| axe `empty-table-header` on `/invoices`, `/partners`, `/products`, `/purchases`, `/suppliers`, `/warehouses`, `/branches`, `/cash-and-bank` | 1 each | **0 each** |
| `/invoices` "Al Khobar Trading Est." | `.Al Khobar Trading Est` (span, rtl, `unicode-bidi: normal`) | **Al Khobar Trading Est.** (`bdi`, ltr, isolate) |

## Guardian
Presentation only: no column, sort, filter, request or money formatting change. `<bdi>` changes no text content (exports and `title` tooltips unchanged).

## Not done here
Other lists showing free-text names (quotes, payments, credit notes, …) are not wrapped yet; the shared mobile record covers their phone layout. Desktop cells of further lists can follow the same one-line pattern when touched.
