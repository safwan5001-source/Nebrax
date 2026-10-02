# POS-UI-V3-6 — Implementation Report

STATUS: READY FOR REVIEW
DATE: 2026-10-03

## Outcome

Code-level visual and interaction audit of the merged V3 sale shell. No business logic change. Browser screenshots were not produced in this executor environment, and this report does not claim them.

## Repository evidence / root cause

Started from POS-UI-V3-5 merge SHA `a9708738b707441e64fc76029e272d2ae1e58fa7` after PRE_MERGE on `687ae76bf702fc61c4530328aae5aa9172510baf` (PR #1175).

The Horizon asks for a viewport, theme, direction, and interaction matrix. This environment has the web unit tests and the source, not a signed-in cashier session. Fabricating screenshots would violate the Horizon's truth rule.

## What the source and tests already lock

| Guarantee | Evidence |
|---|---|
| Sale shell does not grow the page | `(pos)/layout.tsx` is `h-screen overflow-hidden`. `page.tsx` sale root is `h-full overflow-hidden`. |
| 65/35 split from 900px | `POS_SALE_GRID_CLASS` and `pos-responsive.test.ts` |
| Full-height cart under 900px | `posCartPaneClass('cart')` includes `h-full flex-1` and is not `hidden` |
| Transaction bar safe area | `POS_TRANSACTION_BAR_CLASS` includes `env(safe-area-inset-bottom)` and `min-h-14`; hidden from 900px |
| Pay remains one primary | Cart Pay and the bar both call `setStep('payment')`. Confirm stays `data-testid="pos-confirm-payment"` |
| RTL/LTR mirror | DOM order is catalog then cart. Logical properties: `border-s`, `ps-*`, `min-w-0`. Locale still sets direction through the existing document shell. |
| Light/Dark | No POS theme engine. Floor posture uses the app theme tokens already gated by `data-awj-ui` / `data-posture="floor"`. |
| Touch / keyboard / hybrid / scanner | `data-interaction-mode`, `usePosBarcodeScanner`, `usePosFocusManager`, `usePosKeyboardShortcuts` remain on the sale root. Interaction viewport thresholds were not changed. |
| Density default | `parsePosDensity` default remains `standard` from V3-2. |
| Checkout lock | Payment still refuses confirm while paying, offline, submitting, or recovering. |

## Viewport matrix

Browser evidence was **not run**. The class contract implies:

| Viewport | Expected composition | Browser checked |
|---|---|---|
| ~390 phone | single workspace, 2-column catalog, transaction bar | NOT RUN |
| ~430 phone | same | NOT RUN |
| portrait tablet ~600–899 | two workspaces, full-height cart, bar | NOT RUN |
| iPad landscape / compact desktop ~900–1279 | 65/35 split, cart min 280px, fewer catalog columns | NOT RUN |
| 1024×768 | split, no horizontal page overflow by shell `overflow-hidden` | NOT RUN |
| 1440 desktop | split, cart min 320px, more catalog columns from `xl` | NOT RUN |

## Languages and theme

| Check | Result |
|---|---|
| Arabic RTL | NOT RUN in a browser. Source uses logical CSS and locale-driven direction. |
| English LTR | NOT RUN in a browser. |
| Light | NOT RUN in a browser. No separate POS palette was added. |
| Dark | NOT RUN in a browser. |

## Interaction

| Check | Result |
|---|---|
| Touch targets on quantity, Pay, methods, bar | Source mins: quantity controls stay in `PosCartQtyControls`; Pay and Confirm use `min-h-14`; method tiles use `min-h-14`; bar actions use `min-h-11` / `min-h-14`. Not measured in a browser. |
| Keyboard / hybrid / scanner | Hooks still mounted. No new test failure in `page.test.tsx`. A live HID scan was not run. |
| Hover-only critical state | Method selection uses `aria-pressed` and a check icon. Remaining/change use text, not color alone. |

## Approach chosen

Documentation-only slice. No production code, because no in-scope visual defect was proven without a browser, and guessing a polish edit would be scope drift.

## Why this approach fits AWJ

The protocol forbids claiming a check that was not observed.

## Changed files

- `docs/plans/pos/POS-UI-V3-6-IMPLEMENTATION-REPORT.md`
- `docs/plans/pos/POS-UI-V3-5-IMPLEMENTATION-REPORT.md` (merge evidence, once post-merge CI is recorded)

## Tests and exact results

No new tests. V3-5 local Vitest already passed on the parent slice: responsive 11, selected-line bar 5, page smoke 1.

## Build / lint / typecheck

Not re-run. This slice does not change executable code. Web CI on the parent merge is the last production build evidence until this PR's CI.

## CI

Pending on the PR.

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

The report distinguishes source locks from browser checks.

### Reviewer

No production diff except the prior slice's report status, if that file is updated in this PR.

### AWJ Guardian

- Accounting impact: none.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none.
- Backward compatibility: no runtime change in this slice.
- API / DB / migration impact: none.

## Accounting impact

None.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

No runtime change in this slice.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

The viewport, RTL/LTR, Light/Dark, and live scanner matrix is still unverified in a browser. That does not revert the merged UI, and it must stay visible in the Horizon final report. It is not a reason to invent screenshots.

## Discovered backlog

A later pass with a real cashier session should capture the six viewports in ar/en and light/dark. Out of this executor's reach.

## Git state

- Branch: `pos-ui-v3-6`
- PR: pending until V3-5 POST_MERGE_REVIEW passes
- Base SHA: `a9708738b707441e64fc76029e272d2ae1e58fa7`
- Head SHA: recorded at commit

## Recommended next dependency-ready task

POS-UI-V3-CLOSE after this slice merges, carrying the browser-matrix gap as a known limitation rather than a silent pass.
