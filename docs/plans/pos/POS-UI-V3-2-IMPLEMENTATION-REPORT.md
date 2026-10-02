# POS-UI-V3-2 — Implementation Report

STATUS: READY FOR REVIEW
DATE: 2026-10-02

## Outcome

Product catalog V3: one horizontal category strip (All, Favorites, categories), Compact / Standard / Visual density with Standard as the default, and product tiles that lead with name, price, image, and in-cart quantity. Barcode and healthy stock leave the tile face. Actionable out-of-stock and low-stock remain.

## Repository evidence / root cause

Started from POS-UI-V3-1 (catalog pane + search in the topbar). The permanent category rail and the separate All/Favorites tabs were still two controls. Tiles still printed barcode and on-hand quantity on every card.

## Approach chosen

- One strip. Favorites sets the existing `tab` filter. A category sets `cat` and clears favorites. All clears both. Same filter function as before.
- `renderCategoryVisual` / `resolveCategoryVisual` still decide the small chip mark. No new palette.
- Density is `localStorage` key `awj-pos-density-v3`. Default `standard`. Compact never shows an image. Standard and Visual show an image only when `posCfg.show_product_images` is true.
- In-cart badge sums existing line quantities. It does not change add-to-cart.
- The vertical rail class `POS_DESKTOP_CATEGORIES_CLASS` is removed.

## Why this approach fits AWJ

Presentation preference only. Server image flag, favorites storage, category config, and add-to-cart stay in place. Quick View still carries barcode and stock detail.

## Changed files

- `web/src/lib/pos-density.ts`
- `web/src/lib/pos-density.test.ts`
- `web/src/lib/pos-responsive.ts`
- `web/src/lib/__tests__/pos-responsive.test.ts`
- `web/src/components/pos/pos-product-tile.tsx`
- `web/src/components/pos/pos-product-tile.test.tsx`
- `web/src/app/(pos)/pos/page.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`
- `docs/plans/pos/POS-UI-V3-2-IMPLEMENTATION-REPORT.md`

## Tests and exact results

Local Vitest, exit 0: `pos-density.test.ts`, `pos-responsive.test.ts`, `pos-product-tile.test.tsx`, `selected-line-bar.test.ts`, `page.test.tsx` — 5 files, 34 passed.

`npx tsc --noEmit` reports pre-existing errors in unrelated tests. No error line matched `pos-product-tile`, `pos-density`, `(pos)/pos/page`, or `pos-responsive`.

## Build / lint / typecheck

Full `npm run build` is the Web CI gate and will be recorded on the PR Head. Not re-run locally after this slice beyond `tsc` (see above).

## CI

Pending on the PR Head after POS-UI-V3-1 is merged and this branch is rebased.

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: tip when the PR is opened
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

Filter semantics preserved. Density cannot force images when the server disables them. Compact cannot show images when the server enables them.

### Reviewer

No cart math, payment, or scanner change. Category chip targets are `min-h-11`.

### AWJ Guardian

- Accounting impact: none.
- Tenant / branch isolation impact: none.
- Security / authorization impact: none.
- Backward compatibility: same category ids and favorites. Tile no longer shows barcode; Quick View still does.
- API / DB / migration impact: none.

## Accounting impact

None. No journal entries.

## Tenant / branch isolation impact

None.

## Security / authorization impact

None.

## Backward compatibility

Visual only. `show_product_images` remains authoritative for whether an image may appear.

## API / DB / migration impact

None.

## External research used

None.

## Risks / remaining work

Cart line hierarchy, touch quantity on the line, and totals emphasis are POS-UI-V3-3. Portrait sticky bar is POS-UI-V3-5.

## Discovered backlog

None that is a Decision Gate.

## Git state

- Branch: `pos-ui-v3-2`
- PR: not opened until POS-UI-V3-1 is merged
- Base SHA: POS-UI-V3-1 merge SHA
- Head SHA: tip after rebase onto that merge

## Recommended next dependency-ready task

POS-UI-V3-3 — cart hierarchy, touch quantity, totals and Pay — after this slice merges and POST_MERGE_REVIEW passes.
