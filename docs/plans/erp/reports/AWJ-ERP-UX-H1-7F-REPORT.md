# AWJ-ERP-UX-H1-7F — Residuals found by the H1-8 regression crawl — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Source: H1-8 full regression crawl on `main` `7888cdf` (v3 AR/EN 1440, AR 390/320; legacy AR 1440) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md)

## Outcome
The closure crawl (including the restricted staff role) left five small, real findings. Fixed here:

| Finding (axe rule) | Where | Fix |
|---|---|---|
| `heading-order` at 390/320 | `/journal-entries/:id` (shared mobile `AccordionItem` header `h3` right under the page `h1`) | accordion section header → `h2` (same look; also correct on the other detail pages using it) |
| `scrollable-region-focusable` at 390/320 | developer code samples (`/developer`, `/developer/security`), partner account-summary table (`/partners/:id`) | `tabIndex=0`, accessible name, visible focus ring on the horizontal scroll container |
| `link-in-text-block` (EN dark) | "moved to numbering settings" links on `/purchase-settings` and `/sales-settings/invoices` | underlined like the H1-7D links |
| `page-has-heading-one` (restricted **staff** role) | `/accounting-settings` (+ fiscal years, period locks, account routing) and `/developer/*` access-denied state | shared `EmptyState` gains optional `titleAs`; the five page-level forbidden states render their title as the page `h1` (other empty states unchanged) |
| `color-contrast` (EN dark) | landing page CTA band: white text on dark-mode primary `#4f8cff` | band uses `text-primary-foreground` (white in light mode as before; dark ink in dark mode); subtitle opacity 75 % → 90 % |

Classified, not defects: `/icon.ico` (not a page), 403 console messages (this test tenant lacks those commercial entitlements; the pages show the localized forbidden state from H1-5A), 404 on the 404 page and dev-only routes, 422 on `/verify-email` without a token, the labelled checkbox `target-size` (H1-7D note).

## Changed files
`web/src/components/ui/accordion.tsx`, `web/src/components/developer/code-block.tsx`, `web/src/app/(app)/partners/[id]/page.tsx`, `web/src/app/(app)/purchase-settings/page.tsx`, `web/src/app/(app)/sales-settings/invoices/page.tsx`, `web/src/app/page.tsx`, `web/src/components/nebrax/states.tsx`, `web/src/components/developer/developer-shell.tsx`, `web/src/app/(app)/accounting-settings/{page,fiscal-years/page,period-locks/page,account-routing/page}.tsx`; test `web/src/lib/__tests__/erp-ux-h1-7f.test.tsx`.

## Tests and exact results
- New tests (4): page-level forbidden title is `h1`, other empty states unchanged; accordion header is `h2`; code sample `pre` is focusable and named; links underlined and landing band token (source guard).
- Affected suites: 28 files / 219 tests pass. Full Vitest on the exact head: recorded in the PR.
- Browser re-verification on final `main` after merge: recorded in the H1-8 closure report.

## Guardian
Markup/classes only; no data, permission, request or `/platform` file.
