# AWJ-ERP-UX-H1-3A — Skip link, 320 px header reflow, menu button state — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-005, ERP-UX-006 (P2), ERP-UX-021 (P3) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.4 S1–S4

## Outcome
- **Skip link** as the first focusable element of every ERP page (`(app)` layout); visible on focus; moves focus to `main#main-content`.
- **No sideways scroll at 320 px.** Every ERP page scrolled 12 px horizontally at 320 px because the topbar needed ~348 px. The header now uses tighter mobile spacing, no control shrinks below its size (`shrink-0`), and below `sm` (640 px) the language and theme toggles move from the bar into the account menu — both functions stay reachable on every width (WCAG 1.4.10: no loss of functionality).
- **Menu button** keeps its 44×44 target (was squeezed to 20×44 by flex shrink) and exposes `aria-expanded` for the mobile drawer.

## Changed files
- `web/src/app/(app)/layout.tsx` — skip link, `main` id/tabIndex, `menuExpanded` passed to the topbar.
- `web/src/components/layout/topbar.tsx` — responsive spacing, `shrink-0`, toggles in the bar from `sm`, account-menu items below `sm`, `aria-expanded`.
- `web/src/components/layout/lang-toggle.tsx` — exports `switchLocale` (same cookie + refresh logic, now shared by the bar button and the menu item).
- `web/src/messages/{ar,en}.json` — `topbar.skip_to_content`.
- `web/src/components/layout/__tests__/topbar.test.tsx` (new, 2 tests).
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-3A-REPORT.md`

## Tests and exact results
- `topbar.test.tsx` → 2 passed (`aria-expanded` false/true, menu button `shrink-0`; toggles hidden below `sm` in the bar and present in the account menu below `sm`; theme item calls `setTheme`).
- Full Vitest on the final tree: recorded in the PR (run on exact head before merge).
- Real browser, production builds (baseline vs integration build):

| Probe | Before | After |
|---|---|---|
| Page overflow at 320 px — `/dashboard`, `/invoices`, `/accounts` | 12 px each | **0** |
| Menu button size at 320 px | 20×44 | **44×44** |
| Menu button `aria-expanded` (390, closed → open) | none → none | **false → true** |
| First Tab at 1440 on `/invoices` | first sidebar control | **"Skip to main content" (visible)** |
| Enter on skip link | — | focus on `main#main-content`; next Tab lands inside `main` |
| Tab presses to reach `main` without the skip link | 40 | 38 (unchanged path; the skip link is the shortcut) |

## Self-review
- Reviewer: `useTranslations('topbar')` added in the layout before the early return (hook order stable). The skip link uses only existing tokens (`bg-surface`, `text-primary`, `ring-primary`). Account-menu items reuse `DropdownItem`, so H1-2B's inert/close behavior applies.
- AWJ Guardian: no data, permission, branch-switching or request change; branch list in the account menu untouched.

## External research
WCAG 2.2 SC 2.4.1 (skip link or landmarks — landmarks already existed, so this is efficiency, not a Level A failure), SC 1.4.10 Reflow, SC 2.5.8 Target Size; APG Menu Button / disclosure `aria-expanded`.

## Risks / remaining
Between 320 and 639 px, language/theme are one tap deeper (inside the account menu). Not verified: real screen readers, iOS Safari safe-area on device.

## Recommended next task
H1-5C (dashboard KPI amount at ≤360 px).
