# AWJ-ERP-UX-H1-2B — Closed menus inert — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-003 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.2 (M1–M3)

## Outcome
A closed `Dropdown` menu (`web/src/components/ui/dropdown.tsx`) is now `inert`: neither focusable nor exposed to assistive technology, including custom children that do not go through `DropdownItem` (the notifications panel). When a menu closes while focus is inside it, focus returns to its trigger first.

## Root cause
The menu stays mounted for its open/close transition with `aria-hidden` toggled. `DropdownItem` set `tabIndex=-1` while closed, but custom children kept their natural tab order, so keyboard users landed on invisible controls (mobile `/invoices`: tab stops 4–6 were the hidden panel's "All", an unnamed `DIV` and "View all notifications") and axe reported `aria-hidden-focus` on 168 routes.

## Approach chosen
Toggle the `inert` attribute imperatively on the menu node in an effect. React 18.3.1 silently drops `inert={true}` (verified: renders no attribute, logs "Received `true` for a non-boolean attribute") and the installed `@types/react` rejects a string value, so a DOM `toggleAttribute` is the version-proof route. `aria-hidden` and the transition stay as they were.

## Changed files
- `web/src/components/ui/dropdown.tsx`
- `web/src/components/ui/dropdown.test.tsx` (+2 tests)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-2B-REPORT.md`

## Tests and exact results
- `npx vitest run src/components/ui/dropdown.test.tsx` → 5 passed (3 existing + inert for custom children while closed/open, focus return on close).
- Full Vitest on the final tree: recorded in the PR (run on exact head before merge).
- Real browser, production builds (baseline `main` vs integration build with H1 slices):

| Probe | Before | After |
|---|---|---|
| Mobile 390, `/invoices`, first 7 Tab stops | menu, quick create, notifications, **All, DIV, View all notifications**, language | skip link, menu, quick create, notifications, account, create invoice, search |
| axe `aria-hidden-focus` `/invoices` 390 / 1440 | 1 / 1 | **0 / 0** |
| axe `aria-hidden-focus` `/dashboard` 390 / 1440 | 1 / 1 | **0 / 0** |
| axe `aria-hidden-focus` `/accounting-settings` 390 | 1 | **0** |

(The skip link in the "after" column comes from H1-3A, present in the same integration build.)

## Self-review
- Reviewer: effect runs on `open` changes and on mount (initially closed → inert). Focus is moved before `inert` is applied, so focus never drops to `<body>`. `triggerRef` may be an external ref (`triggerButtonRef`) — handled.
- AWJ Guardian: no data, request or permission path; menu items run the same handlers.

## Accounting / tenant / security / API / DB
None. Backward compatible; no prop change.

## External research
WAI-ARIA APG *Menu Button* (button exposes `aria-expanded`); HTML `inert` semantics (removes subtree from focus order and accessibility tree).

## Risks / remaining
`inert` is supported by all current evergreen browsers; on a browser without it, behavior equals today's (`aria-hidden` + `tabIndex=-1` items). Not verified: real screen readers, Firefox/WebKit.

## Recommended next task
H1-3A (shell) builds on menus being inert.
