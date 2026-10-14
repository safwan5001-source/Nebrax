# AWJ-ERP-UX-H1-6A — Contrast, dark-mode document paper, workspace link names — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-011, ERP-UX-012 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §3 (acceptance rubric)

## Outcome
- **Dark-mode documents are readable again — on screen and in print.** The A4 and thermal document previews are white paper, but their sections read the app tokens (`--text`, `--muted`, `--border`). In dark mode that made VAT numbers, dates, city and other info values `#f3f4f6` on white (**1.1:1**, effectively blank). The same colours reached `@media print`, so a receipt voucher printed from dark mode came out without those values. Found while tracing ERP-UX-011 on `/payments/:id` and `/document-qa`; it is broader than the audit's description.
- **No more opacity dimming on readable text.** "Coming soon" cards on the settings hubs and unbuilt rows on `/applications` used `opacity-60/70`, pushing body text below 4.5:1 (73 nodes per dark run on `/applications`). They now render at full contrast and are marked by a dashed border plus the existing "soon" badge.
- **Workspace back links are named.** Commerce/App Builder and Fuel shells: the "Back to AWJ" link (and Commerce's "View store") hide their text below `sm`; they now carry an `aria-label`, so the name never depends on visible text.

## Root causes and fixes

| Finding | Cause | Fix |
|---|---|---|
| Document values invisible in dark mode (1.1:1) | Paper is always white; sections use app tokens that flip in `.dark` | `data-doc-paper` on the A4 (`DocLayout`) and thermal (`ThermalLayout`) roots; `globals.css` pins the light palette on it **in dark mode only** (legacy and v3 values), plus `color-scheme: light`. Light mode is byte-identical. |
| Small grey labels on tinted paper (2.42–4.39:1) | `text-gray-400/500` on `gray-50`, `gray-100`, brand-soft | `text-gray-600` in `doc-voucher`, `doc-amount-words`, `doc-qr` (legacy label), `doc-header` (one template) |
| `/applications` rows, settings hubs, inventory product-settings card | `opacity-60/70` on text | removed; dashed border signals "not available yet" |
| "Soon" badge (4.15:1, legacy light) | `text-muted` on `bg-border` | outlined chip on `bg-surface` (4.83:1+) in the 5 settings hubs |
| `/applications` selected status tab label (4.32:1) | `text-muted` on `bg-primary-soft` | `text-text` when selected |
| Dashboard phone tab (3.21:1, legacy dark) | `text-white` on dark-mode `--primary` | `text-primary-foreground` (the token designed for it) |
| `/journal-entries/:id` account chips (1.94–3.68:1) | solid `bg-muted` (a text colour) behind body text | `bg-background` with a border |
| `link-name` on 25 workspace routes | text in `hidden sm:inline` | `aria-label` from the same message key |

## Changed files
- `web/src/app/globals.css` — dark-mode paper palette (comment explains scope)
- `web/src/modules/documents/components/sections/doc-layout.tsx`, `thermal-layout.tsx` — `data-doc-paper`
- `web/src/modules/documents/components/sections/{doc-voucher,doc-amount-words,doc-qr,doc-header}.tsx` — label greys
- `web/src/app/(app)/{applications,dashboard,journal-entries/[id],sales-settings,inventory-settings,inventory-settings/products,finance-settings,accounting-settings,pos/settings}/page.tsx`
- `web/src/components/commerce-workspace/commerce-workspace-shell.tsx`, `web/src/components/fuel-stations/fuel-workspace-shell.tsx`
- Tests: `doc-paper-palette.test.tsx` (new), `fuel-workspace-shell.test.tsx` (new), `commerce-workspace-shell.test.tsx`, `applications/page.test.tsx`, `journal-entries/[id]/page.test.tsx`
- Evidence: `h1-6a-evidence/` (before/after dark voucher screenshots, portable axe probe)

## Tests and exact results
- New/changed tests: document paper roots + CSS guard (2), Fuel back link AR/EN (2), Commerce back link + View store label (2), applications rows/tab (1), journal chips (1 — **fails without the fix, passes with it**).
- Full Vitest: **552 files, 6,007 tests passed** (tree before the journal-chip commit); the final exact-head run is recorded in the PR.
- Real browser, axe-core 4.10.2, production builds (`main` vs integration build containing this slice), AR, v3 + legacy × light + dark × 1440 + 390:

| Probe | Before | After |
|---|---|---|
| `color-contrast` — `/applications`, `/finance-settings`, `/inventory-settings`, `/inventory-settings/products`, `/journal-entries`, `/payments/:id`, `/document-qa`, `/dashboard` (64 runs) | **515 nodes** | **0** |
| `color-contrast` — `/journal-entries/:id` chips (computed ratio) | 1.94–3.68:1 | **14.5–18.1:1** |
| `link-name` — `/commerce`, `/commerce/stores`, `/app-builder`, `/fuel-stations`, `/fuel-stations/shifts` at 390 (20 runs) | **20** | **0** |
| Final combined pass, 16 routes, `color-contrast` + `link-name` (128 runs) | — | **0** |
| Document info value colour in `@media print` from dark mode (v3 and legacy) | `rgb(243,244,246)` on white | **`rgb(21,24,29)`** |

Screenshots: [`before`](h1-6a-evidence/6a-before-dark-voucher.png) · [`after`](h1-6a-evidence/6a-after-dark-voucher.png) (receipt voucher preview, dark mode, v3, 1440).

## Self-review / Guardian
- Reviewer: the paper override applies only under `.dark`; light mode CSS is unchanged, so printed output from light mode is identical except the darker small labels (gray-400/500 → gray-600), which also improves paper legibility. Document templates, numbers, amounts, QR payload and layout are unchanged.
- AWJ Guardian: presentation only. No document data, ZATCA field, QR content, amount, rounding, posting, permission or API path touched. Platform (`/platform`) files not edited.

## External research
WCAG 2.2 SC 1.4.3 (Contrast minimum, 4.5:1 normal text) and SC 4.1.2 / axe `link-name` (accessible name independent of visible text). AWJ Decision: signal "not available yet" by shape (dashed border + badge), never by fading readable text. Rejected: raising opacity to a "passing" value (fragile across themes).

## Risks / remaining
- The sidebar "soon" badge keeps its previous style (not flagged by axe on measured routes; owned by the H1-3B sidebar change).
- Not verified: physical printers and PDF export from dark mode (print-media colours verified in Chromium only); real screen readers.

## Recommended next task
H1-5B (unnamed form controls: `select-name`, `label`, `button-name`).
