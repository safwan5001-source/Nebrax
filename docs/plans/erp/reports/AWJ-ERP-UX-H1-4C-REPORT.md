# AWJ-ERP-UX-H1-4C — Negative amounts keep the minus sign on the left — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-027 (P2, financial display) · Contract: H1-1 §2.8 · Rule: design-system/v3/FOUNDATIONS.md §5 rule 5, §12.3

## Outcome
In the Arabic (RTL) interface, negative amounts rendered as `10,471.50-` (minus at the right end) on the dashboard KPI, the income statement, the balance sheet and the supplier ledger/statement — e.g. a net loss. They now render `-10,471.50 𞸁` with the sign immediately left of the digits, as the shared `Money` component already does. Values, formatting functions and alignment are unchanged.

## Root cause
`.num` only sets the Mono font. Amounts printed as `formatRiyal(...)` strings inside RTL elements follow the Unicode bidi algorithm, which places a leading `-` on the right in an RTL paragraph. `Money` isolates (`dir="ltr"`, `unicode-bidi: isolate`), but these sites print strings directly.

## Approach
`web/src/components/ui/ltr-number.tsx` — `LtrNumber` wraps **numeric-looking strings only** (optional sign then a Latin or Arabic-Indic digit) in an inline `<bdi dir="ltr">`; other text (labels, "—") passes through untouched. The wrapper is inline, so the `text-end` alignment of cells and cards does not change. Applied at the measured sites:
- `components/dashboard/kpi-card.tsx` (main and secondary amounts)
- `components/reports/report-workspace-ui.tsx` (summary metrics, mobile record values)
- `components/reports/structured-financial-statement.tsx` (desktop cells, mobile values, subtotal/grand total/equation amounts)
- `components/reports/reports-workspace.tsx` (net income and cost-centre profit badges)
- `components/reports/general-advanced-reports-workspace.tsx` (ledger closing balance, net cash flow badges)
- `components/partners/partner-panels.tsx` (statement and document amounts)
- `app/(app)/partners/[id]/statement/page.tsx`, `app/(app)/suppliers/[id]/statement/page.tsx` (end-aligned cells)

Rejected: a global `.num { direction: ltr }` (flips `text-start/end` alignment of block cells and cards); bidi control characters inside `formatRiyal` (would leak invisible characters into strings used elsewhere).

## Tests and exact results
- `ltr-number.test.tsx` → 7 passed (negative/positive/percent/Arabic-Indic numbers isolated with identical text; "—", Arabic and English labels untouched).
- `components/reports` → 92 passed after narrowing one assertion in `delivery-channel-report-workspace.test.tsx` from "no `[dir=ltr]` anywhere" to "no `[dir=ltr]` layout wrapper (`:not(bdi)`)", because inline amount isolation is the intended contract.
- Full Vitest on the final tree: recorded in the PR.
- Real browser (baseline vs integration build, AR, 1440 and 390), negative amounts whose minus renders left of the digits / right of the digits:

| Page | Before (left/right) | After |
|---|---|---|
| `/dashboard` | 0 / 1 | **1 / 0** |
| supplier ledger | 0 / 1 | **1 / 0** |
| supplier statement | 0 / 2 | **2 / 0** |
| income statement | 0 / 3 | **3 / 0** (badge fixed in the second commit) |
| balance sheet | 0 / 3 | **3 / 0** |

## Guardian
Display only. No calculation, rounding, sign convention, API or export change; text content is identical (screen readers and copy/paste get the same string).
