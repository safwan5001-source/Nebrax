# POS-UI-V3-1 — Implementation Report

STATUS: MERGED
DATE: 2026-10-02

## Outcome

Floor shell foundation for AWJ POS UI V3: cashier topbar with the existing search/barcode field as the dominant control, and a two-column catalog/cart grid of about 65/35. No checkout, session, tender, scanner, or RBAC behavior change.

## Repository evidence / root cause

Consumed `docs/plans/pos/POS-UI-V3-EVIDENCE.md` (slice POS-UI-V3-EVIDENCE). The sale shell was a three-column grid (cart | products | category rail) and the search input lived in the products panel.

## Approach chosen

- `POS_SALE_GRID_CLASS` is now two columns from `md`: `13fr / 7fr` (≈65/35), with a cart minimum below 35% of 768px and 1024px so the page does not gain a horizontal scrollbar.
- DOM order is catalog, then cart, so LTR matches the approved diagram and RTL mirrors it. The cart separator is `border-s` (the edge that faces the catalog).
- The category rail stays inside the catalog pane at a fixed 104/148px until POS-UI-V3-2 replaces it with one horizontal strip. It is no longer a third grid column.
- The same search input, `registerSearchInput`, and Enter-to-scan path moved into `PosTopbar` through a `search` slot. Recent invoices, held sales, and manage-session moved into the existing overflow menu. Return-to-system still calls `onReturnToSystem`.
- Mobile remains one workspace plus the existing bottom nav and cart FAB. The sticky transaction bar is POS-UI-V3-5.

## Why this approach fits AWJ

Presentation only. Floor posture, tokens, focus manager, scanner, shortcuts, cart math, and payment screen are reused.

## Changed files

- `web/src/lib/pos-responsive.ts`
- `web/src/lib/__tests__/pos-responsive.test.ts`
- `web/src/app/(pos)/pos/page.tsx`
- `web/src/app/(pos)/pos/selected-line-bar.test.ts`
- `web/src/components/pos/pos-topbar.tsx`
- `web/src/components/pos/pos-topbar.test.tsx`
- `docs/plans/pos/POS-UI-V3-1-IMPLEMENTATION-REPORT.md`

## Tests and exact results

Local, worktree, Vitest 2.1.9, exit 0:

- Focused shell/topbar/cart/focus/page smoke: 6 files, 34 passed.
- POS suites under `src/components/pos`, `src/lib/__tests__/pos-*`, `src/lib/pos-category-presentation.test.ts`, `src/app/(pos)`, `src/app/(app)/pos`: 54 files, 308 passed.
- After the category-rail width tweak: `pos-responsive.test.ts` and `selected-line-bar.test.ts` passed, then `npm run build` in `web/` completed exit 0 (TypeScript check included in the Next.js build).

Pre-existing stderr, not a failure: `IntlError: INVALID_KEY` for dotted message keys (`cart.itemCount` and others) during `renderIntl`, and `HTMLMediaElement's load()` in the page smoke. Both already occur on unchanged tests.

## Build / lint / typecheck

`npm run build` in `web/` exited 0. That script is the Web CI typecheck+build gate. Lint was not a separate script in this run.

## CI

Exact reviewed Head `c8cab2cbf986425024a871786992915c61ffc642`:

- Web pull request run [37056512371](https://github.com/safwan5001-source/Nebrax/actions/runs/37056512371) SUCCESS.
- Web push run [37056495965](https://github.com/safwan5001-source/Nebrax/actions/runs/37056495965) SUCCESS.
- PHP pull request run [37056512320](https://github.com/safwan5001-source/Nebrax/actions/runs/37056512320) SUCCESS (sqlite + pgsql).
- PHP push run [37056495947](https://github.com/safwan5001-source/Nebrax/actions/runs/37056495947) SUCCESS (sqlite + pgsql).

Post-merge runs on Merge SHA `96977ab382e8defe402490ed77d3727783aa7a19`:

- Web CI [37058284673](https://github.com/safwan5001-source/Nebrax/actions/runs/37058284673) SUCCESS.
- PHP CI [37058284828](https://github.com/safwan5001-source/Nebrax/actions/runs/37058284828) SUCCESS (sqlite + pgsql).

## Pre-merge review

- PRE_MERGE_REVIEW: PASS
- Reviewed Head SHA: `c8cab2cbf986425024a871786992915c61ffc642`
- Findings / resolution: none. Comment: https://github.com/safwan5001-source/Nebrax/pull/1168#issuecomment-5960537749

## Merge

- Merge status: merged
- Merge SHA: `96977ab382e8defe402490ed77d3727783aa7a19`
- PR: https://github.com/safwan5001-source/Nebrax/pull/1168
- Method: squash

## Post-merge review

- POST_MERGE_REVIEW: PASS
- Reviewed Merge SHA: `96977ab382e8defe402490ed77d3727783aa7a19`
- Target-branch checks/smoke: `origin/main` is this merge commit. Post-merge Web CI and PHP CI above are SUCCESS. No production deploy.
- Findings / resolution: none. Comment: https://github.com/safwan5001-source/Nebrax/pull/1168#issuecomment-5960852973

## Self-review

### Implementer

Search remains one input. Grid mins were checked against 768 and 1024. Rail width is explicit so it cannot expand inside the catalog column.

### Reviewer

No change to tender math, checkout attempt, session close, or permissions. Overflow still calls the same callbacks. Selected-line editor is untouched.

### AWJ Guardian

- Accounting impact: none.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none. Logout, return-to-system, and warehouse select stay wired.
- Backward compatibility: same POS routes and APIs. Layout class strings changed; tests updated.
- API / DB / migration impact: none.

## Accounting impact

None. No journal entries.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

Runtime layout changed visually. Business contracts unchanged. Keyboard shortcut registry unchanged. Scanner Enter path unchanged.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

- Category rail is still vertical inside the catalog until V3-2.
- Portrait/mobile still uses the FAB, not the V3 sticky transaction bar (V3-5).
- Topbar is denser on narrow widths because search now shares the header. Search is `min-w-0` so it shrinks instead of overflowing the page.

## Discovered backlog

None that is a Decision Gate.

## Git state

- Branch: `pos-ui-v3-1` (merged)
- PR: https://github.com/safwan5001-source/Nebrax/pull/1168
- Base SHA: `d9942a6e264bf05aadc4f005485699cd04f41844` (evidence merge, PR #1166)
- Reviewed Head SHA: `c8cab2cbf986425024a871786992915c61ffc642`
- Merge SHA: `96977ab382e8defe402490ed77d3727783aa7a19`

## Recommended next dependency-ready task

POS-UI-V3-2 — horizontal categories and density modes. POST_MERGE_REVIEW on this slice has passed, so V3-2 may start from this merge SHA.
