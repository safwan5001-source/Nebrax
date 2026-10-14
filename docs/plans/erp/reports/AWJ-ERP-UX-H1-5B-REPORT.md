# AWJ-ERP-UX-H1-5B — Every form control has a name — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: unnamed-control findings of the H1-0 audit (`select-name` 15 routes, `label` 15, `button-name` 4) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §3 (rubric: every control has an accessible name)

## Outcome
Screen-reader users heard "combo box", "edit text" or "button" with no name on the document line editors (purchase orders/quotes/requests, RFQ, recurring invoices, debit notes, stock permits, quotes), manual journals, account routing, tax settings, product discount type, Fuel forms and filters, the Commerce/App Builder colour pickers, list search boxes, purchase attachments/notes and the cash-and-bank row menu. All of them are now named in the interface language. Nothing visible changed except where noted.

## Fixes by cause

| Cause | Where | Fix |
|---|---|---|
| Line grids with a visual header row but unlabeled controls | `procurement-form`, `credit-note-form`, `recurring-invoices/new`, `stock-permits/new`, `quotes/new` | `aria-label` from the same column-header key |
| `<Label>` present but not associated | `manual-journals/new` (6 per line), Fuel `alerts`, `maintenance`, `safety`, `settings`, `master-data` helpers | `htmlFor` ↔ `id` (`mj-{index}-{field}`; `useId()` in the Fuel helpers) |
| Selects with no label at all | account routing (17), tax settings (rate / inclusive / name), product discount type (workspace + dialog) | `aria-label` (role name; column header; new key `products.discount_type`) |
| Icon-only or text-hidden-on-phone buttons | quotes "new customer" (+), invoice form "new customer" (text hidden below `sm`), cash-and-bank row menu | `aria-label` (`invoiceForm.new_partner_title`; "Actions: {account name}") |
| Shared table search with no placeholder | `DataTable` toolbar | name falls back to `nebrax.search` |
| Colour pickers | Store Customizer `ControlPanels`, App Builder `theme-panel` | `aria-label` = "Primary colour" on picker and hex field |
| Focusable "hidden" file input | purchase attachments | native `<input type="file" hidden>` (same as H1-4B; opened only by the visible button) |
| Unlabelled textarea | purchase notes | `aria-label` = section title |

## Changed files
`web/src/components/{procurement/procurement-form,credit-notes/credit-note-form,purchases/purchase-form,invoices/invoice-form,settings/tax-settings-card,products/product-workspace,products/product-dialog,data-table}.tsx`, `web/src/app/(app)/{recurring-invoices/new,stock-permits/new,quotes/new,manual-journals/new,accounting-settings/account-routing,cash-and-bank}/page.tsx`, `web/src/app/(fuel)/fuel-stations/{alerts,maintenance,safety,settings,master-data}/page.tsx`, `web/src/modules/store-experience-builder/ControlPanels.tsx`, `web/src/modules/app-builder/theme-panel.tsx`, `web/src/messages/{ar,en}.json` (`products.discount_type`). Tests: `components/ui/__tests__/label-association.test.ts` (new guard), `components/procurement/procurement-form.a11y.test.tsx` (new), `components/data-table.test.tsx` (+1 per locale).

## Tests and exact results
- `procurement-form.a11y.test.tsx`: AR + EN — **2 failed against `main`'s form, 2 passed with the fix**.
- `label-association.test.ts`: scans all non-test `.tsx` under `web/src` for a visible `<Label>` followed by an unassociated control — 0 offenders (it caught the Fuel and manual-journal pattern before the fix).
- `data-table.test.tsx`: search box named in AR/EN without a placeholder — 37 passed.
- Affected suites (164 files): 2,769 passed; 1 failure in `device-frame.test.tsx` (untouched file) that passes in isolation with and without this change — load-sensitive, recorded, not caused here.
- Full Vitest on the exact head: recorded in the PR.
- Real browser, axe-core 4.10.2, production builds, AR, 24 routes:

| Rule | `main` (1440, v3) | This change (v3 + legacy × 1440 + 390, 96 runs) |
|---|---|---|
| `select-name` | 40 | **0** |
| `label` | 25 | **0** |
| `button-name` | 3 | **0** |

## Self-review / Guardian
- Reviewer: names reuse existing visible labels/column headers, so speech matches what sighted users read (WCAG 2.5.3 label-in-name: the invoice "New" button's name "Add a new customer" contains "new"). No layout change except the purchase attachment input, which leaves the layout and Tab order exactly as the visible button already defined.
- AWJ Guardian: attributes only. No value, calculation, default, validation, request, permission, posting or document numbering path changed. Store Customizer / App Builder changes are `aria-label` only (no persistence, contract or preview behavior touched). No `/platform` file edited.

## External research
WCAG 2.2 SC 1.3.1, 4.1.2 (name, role, value), 2.5.3 (label in name); axe rules `select-name`, `label`, `button-name`.

## Risks / remaining
- Rows repeat the same names per line (e.g., "Qty" on every line), matching the visual header; row-specific names were not added.
- Not verified: real screen readers.

## Recommended next task
H1-6B (native `window.confirm` → in-app dialog).
