# POS-UI-V3-2 — Implementation Report

STATUS: MERGED
DATE: 2026-10-02

## Outcome

Product catalog V3: one horizontal category strip (All, Favorites, categories), Compact / Standard / Visual density with Standard as the default, and product tiles that lead with name, price, image, and in-cart quantity. Barcode and healthy stock leave the tile face. Actionable out-of-stock and low-stock remain.

## Repository evidence / root cause

Started from POS-UI-V3-1 (catalog pane + search in the topbar). The permanent category rail and the separate All/Favorites tabs were still two controls. Tiles still printed barcode and on-hand quantity on every card.

## Approach chosen

- One strip. Favorites sets the existing `tab` filter. A category sets `cat` and clears favorites. All clears both. Same filter function as before.
- `renderCategoryVisual` / `resolveCategoryVisual` still decide the small chip mark. No new palette.
- Density is `localStorage` key `awj-pos-density-v3`. Default `standard`. Compact never shows an image. Standard and Visual show an image only when `posCfg.show_product_images` is true.
- In-cart badge sums existing line quantities. It does not change add-to-cart. The badge and the active density control use `text-primary-foreground` on `bg-primary` so Light/Dark stay on the semantic token (no new `text-white`).
- The vertical rail class `POS_DESKTOP_CATEGORIES_CLASS` is removed.
- `globals.css` no longer forces a third `data-awj-floor-grid` track at 1024/1280. That rule was overriding `POS_SALE_GRID_CLASS` and would have left an empty rail column after the strip replaced the rail.

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

Local Vitest after cherry-pick onto the V3-1 merge, exit 0: `pos-density.test.ts`, `pos-responsive.test.ts`, `pos-product-tile.test.tsx`, `selected-line-bar.test.ts`, `page.test.tsx` — 5 files, 34 passed.

`npx tsc --noEmit` reports pre-existing errors in unrelated tests. No error line matched `pos-product-tile`, `pos-density`, `(pos)/pos/page`, or `pos-responsive`.

## Build / lint / typecheck

`npm run build` in `web/` exited 0 after the cherry-pick onto `96977ab382e8defe402490ed77d3727783aa7a19`. That script is the Web CI typecheck+build gate.

## CI

Exact reviewed Head `9c0125f9d2786e7323173ae05750dc4ab41f8575`:

- Web pull request run [37062336343](https://github.com/safwan5001-source/Nebrax/actions/runs/37062336343) SUCCESS.
- Web push run [37062331580](https://github.com/safwan5001-source/Nebrax/actions/runs/37062331580) SUCCESS.
- PHP pull request run [37062335896](https://github.com/safwan5001-source/Nebrax/actions/runs/37062335896) SUCCESS (sqlite + pgsql).
- PHP push run [37062331717](https://github.com/safwan5001-source/Nebrax/actions/runs/37062331717) SUCCESS (sqlite + pgsql).

An earlier Head `0be9cd7` failed the drift ratchet (`text-white`). That was fixed forward on the reviewed Head. It was not merged.

Post-merge runs on Merge SHA `2781cd1bc360cbc68d6a5c9d0569f6bff6db22ef`:

- Web CI [37064066042](https://github.com/safwan5001-source/Nebrax/actions/runs/37064066042) SUCCESS.
- PHP CI [37064066029](https://github.com/safwan5001-source/Nebrax/actions/runs/37064066029) SUCCESS (sqlite + pgsql).

## Pre-merge review

- PRE_MERGE_REVIEW: PASS
- Reviewed Head SHA: `9c0125f9d2786e7323173ae05750dc4ab41f8575`
- Findings / resolution: none. Comment: https://github.com/safwan5001-source/Nebrax/pull/1169#issuecomment-5961385091

## Merge

- Merge status: merged
- Merge SHA: `2781cd1bc360cbc68d6a5c9d0569f6bff6db22ef`
- PR: https://github.com/safwan5001-source/Nebrax/pull/1169
- Method: squash

## Post-merge review

- POST_MERGE_REVIEW: PASS
- Reviewed Merge SHA: `2781cd1bc360cbc68d6a5c9d0569f6bff6db22ef`
- Target-branch checks/smoke: post-merge Web and PHP CI above are SUCCESS. `origin/main` later also contains `30ead92` (store canvas catalog, PR #1167), which does not change the POS sale shell.
- Findings / resolution: none. Comment: https://github.com/safwan5001-source/Nebrax/pull/1169#issuecomment-5961676001

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

- Branch: `pos-ui-v3-2` (merged)
- PR: https://github.com/safwan5001-source/Nebrax/pull/1169
- Base SHA: `96977ab382e8defe402490ed77d3727783aa7a19` (POS-UI-V3-1 merge, PR #1168)
- Reviewed Head SHA: `9c0125f9d2786e7323173ae05750dc4ab41f8575`
- Merge SHA: `2781cd1bc360cbc68d6a5c9d0569f6bff6db22ef`

## Recommended next dependency-ready task

POS-UI-V3-3 — cart hierarchy, touch quantity, totals and Pay. POST_MERGE_REVIEW on this slice has passed. Start from the latest `origin/main` (includes this merge and the later store commit `30ead92`).
