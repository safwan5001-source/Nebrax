# AWJ-ERP-UX-H1-3B — Unbuilt sidebar modules are no longer links — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-007 (P2) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.4 S5

## Outcome
The 10 sidebar entries marked `built: false` (`/cheques`, `/work-orders`, `/workflow`, `/bookings`, `/rentals`, `/leases`, `/time-tracking`, `/manufacturing`, `/fleet`, `/shipping`) stay visible with their "soon" badge, as DESIGN_SYSTEM.md requires, but render as a non-interactive entry (`aria-disabled="true"`; `role="menuitem"` inside the collapsed-sidebar flyout) instead of a `next/link` to a route that does not exist.

## Root cause
They were `<Link>` elements. Clicking one opened the bare 404 page outside the ERP shell (no `main`, no navigation back), and Next.js prefetched them: on `/accounts`, `/assets`, `/cost-centers` and the accounting-settings pages the `/cheques` prefetch never resolved, so those pages never reached network-idle.

## Changed files
- `web/src/components/layout/sidebar.tsx` — new exported `SoonNavEntry`, used in the expanded list and the collapsed flyout; built items unchanged.
- `web/src/components/layout/__tests__/sidebar-soon.test.tsx` (new, 2 tests)
- `CLAUDE.md` — one sentence of the module map that said unbuilt modules are sidebar links.
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-3B-REPORT.md`

## Tests and exact results
- `sidebar-soon.test.tsx` → 2 passed (no anchor, not focusable, `aria-disabled`, badge text; disabled `menuitem` in flyout).
- Full Vitest on the final tree: **551 files, 6,003 tests passed**.
- Real browser, production builds (baseline vs integration build):

| Page (1440, AR) | Network idle before | After | Links to unbuilt routes before → after |
|---|---|---|---|
| `/accounts` | never (12 s cap) | 955 ms | 1 → 0 |
| `/assets` | never (12 s cap) | 814 ms | 1 → 0 |
| `/cost-centers` | never (12 s cap) | 792 ms | 1 → 0 |

## Self-review
- Reviewer: visibility rules (`appKey`, `permission`) still apply before rendering — `visibleItems` untouched. Text colour stays `text-muted` (same as before), not dimmed further.
- AWJ Guardian: navigation only; no route, permission, entitlement or API change.

## Decisions
AWJ Decision: keep "soon" modules visible (product signal per DESIGN_SYSTEM.md), remove navigation. Rejected: hiding them (contradicts the design system) or adding placeholder pages (feature scope).

## Risks / remaining
None known. Not verified: real screen readers.

## Recommended next task
H1-3A (shell skip link and 320 px header).
