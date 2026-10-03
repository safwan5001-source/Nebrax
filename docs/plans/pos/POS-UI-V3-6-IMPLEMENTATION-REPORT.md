# POS-UI-V3-6 — Implementation Report

STATUS: MERGED
DATE: 2026-10-03

## Outcome

Code-level visual and interaction audit of the merged V3 sale shell. No business logic change. Browser screenshots were not produced in this executor environment, and this report does not claim them.

## Repository evidence / root cause

Started from latest `main` `241a06f87a61ff2d006e0758c1776abd9c815a71` (`feat(store): complete H4 content sections (#1172)`). That commit contains the POS-UI-V3-5 merge `a9708738b707441e64fc76029e272d2ae1e58fa7` after PRE_MERGE on `687ae76bf702fc61c4530328aae5aa9172510baf` (PR #1175). #1172 is outside this Horizon and is not modified here.

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
- `docs/plans/pos/POS-UI-V3-5-IMPLEMENTATION-REPORT.md` (PRE_MERGE, merge SHA, POST_MERGE)

## Tests and exact results

No new tests. V3-5 local Vitest already passed on the parent slice: responsive 11, selected-line bar 5, page smoke 1.

## Build / lint / typecheck

Not re-run. This slice does not change executable code. Web CI on the parent merge is the last production build evidence until this PR's CI.

## CI

Exact reviewed Head `e18b94672f75507d7498087ff983c448aa8187d8`:

- PHP pull request [37080354304](https://github.com/safwan5001-source/Nebrax/actions/runs/37080354304) SUCCESS (sqlite + pgsql).
- PHP push [37080345658](https://github.com/safwan5001-source/Nebrax/actions/runs/37080345658) SUCCESS (sqlite + pgsql).
- Web CI did not run (no `web/**` change).

Post-merge on Merge SHA `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087`:

- PHP CI [37081812418](https://github.com/safwan5001-source/Nebrax/actions/runs/37081812418) SUCCESS (sqlite + pgsql).
- Web CI did not run (docs only).

## Pre-merge review

- PRE_MERGE_REVIEW: PASS
- Reviewed Head SHA: `e18b94672f75507d7498087ff983c448aa8187d8`
- Findings / resolution: none. Comment: https://github.com/safwan5001-source/Nebrax/pull/1176#issuecomment-5963568790

## Merge

- Merge status: merged
- Merge SHA: `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087`
- PR: https://github.com/safwan5001-source/Nebrax/pull/1176
- Method: squash

## Post-merge review

- POST_MERGE_REVIEW: PASS
- Reviewed Merge SHA: `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087`
- Target-branch checks/smoke: `origin/main` is this merge commit. PHP CI above succeeded. No production deploy.
- Findings / resolution: none. Comment: https://github.com/safwan5001-source/Nebrax/pull/1176#issuecomment-5963763357

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

- Branch: `pos-ui-v3-6` (merged)
- PR: https://github.com/safwan5001-source/Nebrax/pull/1176
- Base SHA: `241a06f87a61ff2d006e0758c1776abd9c815a71`
- Implementation commit: `40a3fa7c97dcab244f90ba25fa83c87e38404dcd`
- Reviewed Head SHA: `e18b94672f75507d7498087ff983c448aa8187d8`
- Merge SHA: `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087`

## Recommended next dependency-ready task

POS-UI-V3-CLOSE. The browser-matrix gap stays a known limitation.
