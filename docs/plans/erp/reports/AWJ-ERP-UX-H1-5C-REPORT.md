# AWJ-ERP-UX-H1-5C — Dashboard KPI amounts stay inside their cards on phones — Implementation Report

STATUS: PR OPEN (see PR for exact-head CI, PRE_MERGE_REVIEW and merge record)
DATE: 2026-10-14
Backlog: ERP-UX-024 (P2, financial readability) · Audit: [H1-0](../AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: H1-1 §2.8

## Outcome
On `/dashboard` at 320–360 px the secondary figure ("net income after expenses") ran outside its KPI card and was cut at 320 px (leading digit and riyal sign lost). Now every amount stays inside its card at 320/360/390 px; nothing is truncated and **number formatting is unchanged**.

## Root cause
Two-column KPI grid on phones with a fixed 21 px amount and a non-wrapping label/amount row. Amounts are full precision (`formatNumberShort` only drops trailing zeros), so large values cannot fit a ~110 px card at a fixed size.

## Approach
- KPI card content is a size container (`container-type: inline-size`); below `sm` the main amount uses `clamp(14px, 12.5cqi, 21px)`, i.e. it scales with the card's width and never exceeds the previous 21 px. From `sm` up the existing 26 px is unchanged.
- The secondary row wraps (`flex-wrap`), so the amount moves under its label when both do not fit.
- Formatting functions, values, signs, colours and arrows untouched.

## Changed files
- `web/src/components/dashboard/kpi-card.tsx`
- `web/src/components/dashboard/kpi-card.test.tsx` (new, 2 tests)
- `docs/plans/erp/reports/AWJ-ERP-UX-H1-5C-REPORT.md`

## Tests and exact results
- `kpi-card.test.tsx` → 2 passed (container sizing classes, no truncation classes, amount text unchanged; secondary row wraps).
- Full Vitest on the final tree: recorded in the PR.
- Real browser (baseline vs integration build), count of `.num` amounts extending outside their KPI card on `/dashboard` (AR light): 320 px 1 → **0**, 360 px 1 → **0**, 390 px 0 → 0.

## Guardian
Display only. No API, calculation, rounding or formatting change; the same strings are rendered.

## Related, not fixed here
ERP-UX-027 (logged in this horizon): negative amounts in RTL render with the minus sign on the right (`10,471.5-`) because `.num` sets only the font, while v3 FOUNDATIONS §12.3 specifies LTR isolation for amounts. A global CSS change would also flip `text-start/end` alignment of block-level `.num` cells, so it needs its own measured slice.
