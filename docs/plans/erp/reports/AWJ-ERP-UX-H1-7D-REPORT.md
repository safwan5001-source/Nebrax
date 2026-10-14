# AWJ-ERP-UX-H1-7D — Residual P3 cluster: landmarks, links, 404, fuel settings, labels — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-019, ERP-UX-023 (P3) and the remaining hard-coded label of ERP-UX-025 · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md)

## Outcome
| Finding (axe rule) | Where | Fix |
|---|---|---|
| Two unnamed complementary landmarks (`landmark-unique`) | sidebar `aside` vs. page side panels on 7 routes | sidebar `aside` named «الشريط الجانبي» / "Sidebar" (`nav.sidebarLabel`) |
| `main` nested inside the layout `main` (`landmark-main-is-top-level`, `landmark-no-duplicate-main`) | `/pos/audit` | inner `main` → `div` |
| Links distinguishable by colour only (`link-in-text-block`, 1.39:1 vs text) | credit-note form, numbering settings, sales invoice settings | underlined (`underline-offset-2`), underline removed on hover |
| `aria-controls` pointing at no element (`aria-valid-attr-value`) | `/commerce/published-products` tabs | active section wrapped in the shared `TabPanel` (id/labelledby) |
| QR `svg role="img"` without a name (`svg-img-alt`) | document QR (A4 + thermal) | `title` «رمز QR» / "QR code" (`invoiceDoc.qr_title`); QR value unchanged |
| **No `h1`, endless skeleton** (`page-has-heading-one`) | `/fuel-stations/settings` | when the first load fails, the page kept skeletons forever (no title, no reason). It now shows the title and either the localized forbidden state (403, via H1-5A `describeLoadFailure`, no futile retry) or the error with Refresh |
| 404 without `main`, English-only (`landmark-one-main`, `region`) | any unknown URL | `app/not-found.tsx`: `main`, localized `h1`/text, "Back to the dashboard" |
| Small link targets (`target-size`) | partner detail summary/document links | `inline-flex min-h-6` (24 px) |
| Hard-coded Arabic close label | POS dialog | `useCommonLabel('close')` |

Not changed (recorded): the invoice form's "Already paid" checkbox (16 px) is inside its clickable text label, which meets WCAG 2.5.8 through the equivalent-target exception although axe still reports it.

Literal inventory (H1-7C2 scope check): after H1-7C1 the remaining Arabic literals in ERP `.tsx` are bilingual ternaries (`ar ? … : …` — POS shifts, report saved views, inventory list, POS sessions), digit-normalisation tables, sample preview content, dev-only pages, punctuation joiners, the stored walk-in customer default and intentional provider-less fallbacks. None renders Arabic in the English UI except the POS dialog label fixed here.

## Changed files
`components/layout/sidebar.tsx`, `app/(app)/pos/audit/page.tsx`, `components/credit-notes/credit-note-form.tsx`, `app/(app)/numbering-settings/page.tsx`, `app/(app)/sales-settings/invoices/page.tsx`, `app/(commerce)/commerce/published-products/page.tsx`, `modules/documents/components/sections/doc-qr.tsx`, `modules/documents/templates/thermal-receipt.tsx`, `app/(fuel)/fuel-stations/settings/page.tsx`, `app/not-found.tsx` (new), `components/partners/partner-panels.tsx`, `components/pos/pos-dialog.tsx`, `messages/{ar,en}.json` (`nav.sidebarLabel`, `invoiceDoc.qr_title`, `notFound.*`). Tests: `app/not-found.test.tsx`, `app/(fuel)/fuel-stations/settings/page.test.tsx` (new), `components/pos/pos-dialog.test.tsx`, `app/(commerce)/commerce/published-products/page.test.tsx`.

## Tests and exact results
- Fuel settings: forbidden state (title, localized message, no Refresh, no busy skeleton) and generic error with retry — **2 failed against `main`'s page, 2 passed with the fix**.
- 404 page AR/EN (main, h1, link) — 2 passed. POS dialog EN close label — passed. Published products tab → existing `tabpanel` — passed.
- Full Vitest on the exact head: recorded in the PR.
- Real browser (production builds, AR, 1440; partner page also 390), 21 routes incl. an unknown URL:

| Rule | `main` | This change |
|---|---|---|
| `landmark-unique` | 8 | **0** |
| `landmark-main-is-top-level` / `landmark-no-duplicate-main` | 1 / 1 | **0 / 0** |
| `link-in-text-block` | 3 | **0** |
| `aria-valid-attr-value` | 1 | **0** |
| `svg-img-alt` | 1 | **0** |
| `page-has-heading-one` | 1 | **0** |
| `landmark-one-main` / `region` (404) | 1 / 2 | **0 / 0** |
| `target-size` | 6 | **2** (the labelled checkbox above, on `/invoices/new` and draft edit) |

## Self-review / Guardian
- Reviewer: attribute/markup changes; fuel settings change only affects the failure branch (success rendering identical); 404 page uses existing tokens.
- AWJ Guardian: QR payload, document data, entitlement checks (still server-side 403), permissions and requests unchanged. Commerce change is ARIA wiring only. No `/platform` file edited (the 404 page also serves unknown `/platform` URLs, which previously got the same bare Next page).

## Risks / remaining
Not verified: real screen readers. The labelled checkbox `target-size` note above.

## Recommended next task
H1-8 final regression and closure.
