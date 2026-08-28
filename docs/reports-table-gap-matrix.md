# Reports Table Gap Matrix

## Current foundation

Nebrax already has a dedicated report-table layer built on TanStack Table through `ReportDataTable` and consumed by `ReportResultsTable` and advanced report workspaces. It already supports client-side search, sorting, pagination, column visibility/order/resize, row density, sticky header/footer totals, saved views, drill-down links, RTL-aware resizing, and mobile report cards.

## Gaps observed in this audit

| Area | Current state | Gap / risk | Decision |
| --- | --- | --- | --- |
| Pagination arrows | Functional buttons, wrong base LTR icon direction | Previous rendered right arrow and Next rendered left arrow | Fix in this PR with regression coverage |
| RTL pagination | Uses `rtl:rotate-180` | Must remain correct after LTR fix | Preserve rotation and cover structurally in test |
| Financial totals | Sticky `tfoot` and semantic numeric formatting already present | No foundational gap found | Reuse; do not replace |
| Search | Localized-digit normalization and global result search already present | Client-side only; acceptable for current report payloads, but large server datasets may eventually need server-side search | Defer until a report proves scale need |
| Sorting | Numeric/date-aware client sorting already present | Same scale caveat as search | Defer; no parallel server contract in this PR |
| Column layout | Visibility, reorder, resize, density, saved views exist | Need stable report keys at each consumer to persist layouts | Audit consumer-by-consumer in later PRs |
| Mobile | `ReportMobileRows` used via `ReportResultsTable`; advanced workspace has mobile-specific presentation | Not all desktop column layout controls map to custom mobile representations | Keep mobile purpose-built; do not force desktop table config onto cards |
| Export | CSV, PDF, print/share paths exist in report workspaces | Export must continue to use the report dataset, not only current visible page | Preserve existing export path; no export rewrite here |
| Design system | Semantic tokens, Lucide icons, compact financial tables, RTL support already present | Avoid raw colors or decorative redesign | Keep current Nebrax design system |
| Architecture | Dedicated thin reports layer exists alongside Unified DataTable | Risk would be creating another report grid abstraction | Explicitly prohibited; evolve existing `ReportDataTable` only |

## PR-1 scope

- Correct pagination icon directions in LTR while preserving RTL mirroring.
- Add a focused regression test.
- No API changes.
- No accounting logic changes.
- No report calculation changes.
- No database changes.
- No export behavior changes.

## Follow-up candidates

1. Audit stable `reportKey` coverage so Saved Views persist consistently where safe.
2. Identify report datasets large enough to justify server-side search/sort/pagination instead of client-only operations.
3. Normalize loading / empty / no-results / error presentation across all report workspaces without changing financial payloads.
4. Verify all report exports operate on the intended full filtered dataset and never silently export only the visible page.
5. Review specialized financial statements separately from tabular result reports; they should remain specialized and should not be forced into a generic grid.
