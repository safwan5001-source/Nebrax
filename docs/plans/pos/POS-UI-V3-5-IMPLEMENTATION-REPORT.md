# POS-UI-V3-5 — Implementation Report

STATUS: READY FOR REVIEW
DATE: 2026-10-03

## Outcome

Below 900px the sale screen is two full-height workspaces, not a floating cart button. A sticky transaction bar shows count, total, View cart, and Pay, with a safe-area inset. From 900px the 65/35 split returns, with the cart protected at 280px and catalog columns reduced until 1280px.

## Repository evidence / root cause

Started from POS-UI-V3-4 merge SHA `557740d3fe8b0e70432b62a5ac144c1256d1a1f4` after that slice's PRE_MERGE on `4361616487b2a55c0ee88d779a3bbac300ab7383`.

The V3-1 shell split at `md` (768px) and used a floating cart button. Portrait widths in the approved plan (about 600–899) are supposed to be explicit Products and Cart workspaces.

## Approach chosen

- `posShowsSplitCart` is true only at `width >= 900`.
- Grid: one column under 900, `13fr/7fr` with a 280px cart floor from 900, 320px floor from `xl`.
- Cart and product panes fill the grid cell (`h-full flex-1`). Opening Cart hides Products below 900, so the cart is the full workspace, not a sheet.
- The floating button is replaced by `data-testid="pos-transaction-bar"`. Pay uses the same `setStep('payment')` path as the cart Pay button, including pending-attempt adopt. It is hidden on the cart workspace and from 900px up.
- Catalog columns drop before touch targets: image grid stays at 2 columns until `xl` (4). Compact mode uses 3 columns from 900 and 5 from `xl`.
- Search stays in the fixed topbar. Interaction viewport (768/1024) is unchanged.
- Payment remains the V3-4 terminal. It is already one column below `lg`.

## Why this approach fits AWJ

Presentation only. Same cart state, same Pay transition, same scanner and focus registration.

## Changed files

- `web/src/lib/pos-responsive.ts`
- `web/src/lib/__tests__/pos-responsive.test.ts`
- `web/src/app/(pos)/pos/page.tsx`
- `web/src/app/(pos)/pos/selected-line-bar.test.ts`
- `docs/plans/pos/POS-UI-V3-5-IMPLEMENTATION-REPORT.md`

## Tests and exact results

Local Vitest, exit 0: `pos-responsive.test.ts` 11, `selected-line-bar.test.ts` 5, `page.test.tsx` 1. Total 17 passed.

## Build / lint / typecheck

Not re-run as a full Next build in this environment. The previous slice compiled TypeScript and Web CI is the authoritative build. This slice does not change types of exported payment or checkout functions.

## CI

Pending on the PR. Must not open until POS-UI-V3-4 POST_MERGE_REVIEW passes.

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: pending
- Findings / resolution: pending

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

Bar and cart Pay both adopt a pending checkout attempt before `setStep('payment')`. No new money math.

### Reviewer

Split threshold, full-height panes, and the bar are the whole behavior change. Bottom nav remains for invoices and customers and does not replace Pay.

### AWJ Guardian

- Accounting impact: none.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none.
- Backward compatibility: same sale state. Layout breakpoint moved from 768 to 900, which is the approved V3 responsive contract.
- API / DB / migration impact: none.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

No API or stored-cart change. Cashiers under 900px now switch workspaces instead of seeing a side cart from 768px.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

Visual screenshots for 390, 430, tablet, 1024, and 1440 are POS-UI-V3-6. This slice proves the class contract and the page wiring, not a browser matrix.

## Discovered backlog

None.

## Git state

- Branch: `pos-ui-v3-5`
- PR: pending until V3-4 post-merge passes
- Base SHA: `557740d3fe8b0e70432b62a5ac144c1256d1a1f4`
- Head SHA: recorded at commit

## Recommended next dependency-ready task

POS-UI-V3-6 after this slice merges and POST_MERGE_REVIEW passes.
