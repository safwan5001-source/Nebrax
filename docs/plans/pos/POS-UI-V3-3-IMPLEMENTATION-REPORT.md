# POS-UI-V3-3 — Implementation Report

STATUS: READY FOR REVIEW
DATE: 2026-10-02

## Outcome

Cart lines now read as a transaction, not a table: product name, unit price, touch quantity (`−` / qty / `+`), and line total. Totals always show subtotal, discount, tax, and grand total. Pay stays the dominant action. The cart surface stays the light Floor paper; only the totals/Pay block uses the existing Outcome emphasis.

## Repository evidence / root cause

Started from POS-UI-V3-2 merge. Lines showed name, a small `×qty`, and a line total, with quantity editing only in the selected-line bar. Discount was omitted from the totals when it was zero, so the hierarchy collapsed.

## Approach chosen

- Each line calls the existing `setQty` / `setQtyFromInput` through `PosCartQtyControls` (minimum 48px). No new quantity math.
- The selected-line bar still owns unit, quantity, price override, discount, and remove. POS-FINAL-1 locks that bar. Discount, unit, and price are not repeated on every row.
- Discount is always visible. Zero prints as `0.00`. A positive discount keeps the existing minus and positive color. Totals math is unchanged.
- Grand total and Pay keep the Floor Outcome tokens already in `globals.css` (`--awj-display-money-fs`, `--awj-action-h`). The cart body stays `--awj-surface-paper`.

## Why this approach fits AWJ

Presentation only. Same line mutation functions, same selected-line editor, same Pay click path.

## Changed files

- `web/src/app/(pos)/pos/page.tsx`
- `web/src/app/(pos)/pos/selected-line-bar.test.ts`
- `docs/plans/pos/POS-UI-V3-3-IMPLEMENTATION-REPORT.md`

## Tests and exact results

Local Vitest, exit 0: `selected-line-bar.test.ts`, `pos-cart-line-controls.test.tsx`, `drift-ratchet.test.ts`, `page.test.tsx` — 4 files, 19 passed.

## Build / lint / typecheck

`npm run build` in `web/` exited 0 on this working tree (Next.js typecheck included).

## CI

Pending on the PR Head after POS-UI-V3-2 POST_MERGE_REVIEW. Web CI is required (`web/**`). Root PHP CI also runs. The PRE_MERGE comment records the exact reviewed SHA.

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: branch tip when the PR is opened
- Findings / resolution: —

## Merge

- Merge status: not merged
- Merge SHA: —

## Post-merge review

- POST_MERGE_REVIEW: PENDING
- Reviewed Merge SHA: —
- Target-branch checks/smoke: —
- Findings / resolution: —

## Self-review

### Implementer

Line quantity and the selected-line quantity both call `setQty`. Selecting a line still happens because the controls sit inside the line frame and the click bubbles.

### Reviewer

No tender, tax, or discount calculation change. Unit `<select` is still not in the line body.

### AWJ Guardian

- Accounting impact: none.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none.
- Backward compatibility: same cart mutations. Discount row is visible at zero; it does not post a discount.
- API / DB / migration impact: none.

## Accounting impact

None. No journal entries.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

Visual hierarchy only. Checkout payload still uses `lineCalc`.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

Quantity controls appear both on the line and in the selected-line bar. That duplication is intentional so POS-FINAL-1 stays intact. Payment workspace is POS-UI-V3-4. Portrait sticky bar is POS-UI-V3-5.

## Discovered backlog

None that is a Decision Gate.

## Git state

- Branch: `pos-ui-v3-3`
- PR: not opened until POS-UI-V3-2 POST_MERGE_REVIEW passes
- Base SHA: `30ead922dbaf40a20bd7b10ac839876310e0de18` (latest main; contains POS-UI-V3-2 merge `2781cd1bc360cbc68d6a5c9d0569f6bff6db22ef`)
- Head SHA: branch tip when the PR is opened; the PRE_MERGE comment is the review authority

## Recommended next dependency-ready task

POS-UI-V3-4 — Payment Workspace V3 — after this slice merges and POST_MERGE_REVIEW passes.
