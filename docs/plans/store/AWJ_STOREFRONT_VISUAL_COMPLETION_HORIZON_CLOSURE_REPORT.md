# AWJ Storefront Visual Completion — Horizon status

**Status:** OPEN. Not closed.  
**Reason:** Designed 404 and public density/product-card parity are still open. The earlier pause (unmerged #1015/#1016/#1017, CI not observed) is resolved.

## Identity

| | |
|---|---|
| Verified base / latest `main` at start | `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4` |
| Main after #1014, then these merges | `ec2aad3cacc988417971489d46c9125da838c8d8` |

## Pull requests

| PR | Branch | Reviewed head | Merge SHA | What |
|---|---|---|---|---|
| [#1015](https://github.com/safwan5001-source/Nebrax/pull/1015) | `docs/storefront-visual-completion-evidence` | `0b6b146ae19e8219011404ad0c2006f13c80a214` | `ec2aad3cacc988417971489d46c9125da838c8d8` | Evidence matrix, horizon, screenshots |
| [#1016](https://github.com/safwan5001-source/Nebrax/pull/1016) | `fix/storefront-published-home-sections` | `99349f4fc93fa610242101e1a7fccd68161d6d59` | `2e1225f39e553103ef628e25438461d4cd7d2abe` | Public v2 section deletion |
| [#1017](https://github.com/safwan5001-source/Nebrax/pull/1017) | `fix/customizer-chrome-click-to-edit` | `b6498e9b706a95d467d3844a445e1e6521a59b09` | `6b8869e8694c3b897eed4f75bbf1af07b708f1e4` | Chrome click-to-edit + honest hints |

Each squash is a single parent. Path diffs against the reviewed heads were empty. `PRE_MERGE_REVIEW: PASS` and `POST_MERGE_REVIEW: PASS` are on the PR threads with those SHAs. Post-merge CI was green on each merge commit (PHP sqlite + pgsql; storefront CI on #1016 and #1017; web CI on #1017). No deploy.

## Evidence completed

`docs/plans/store/AWJ_STOREFRONT_VISUAL_COMPLETION_EVIDENCE_PASS.md`  
Screenshots: `docs/plans/store/storefront-visual-completion-qa/`

Rendered: customizer dev harness, account harness (ar/en), public home/products/cart shells without Laravel.  
Not rendered: populated PDP, variant PDP, live checkout, confirmation, merchant `web` customizer in a browser, Market, Floral.

## What changed

- Docs and screenshots only on #1015.
- #1016: `resolvePublishedImplementedSections`. Null presentation still uses defaults.
- #1017: editor chrome selection. Preview external anchors do not navigate. Hints match the data-URL cap.

## Tests

| PR | Command | Result |
|---|---|---|
| #1016 | storefront `vitest` home/presentation/customizer | 8 files, 48 passed |
| #1016 | `sections.test.ts` | 7 passed |
| #1017 | web appearance + store-experience-builder | 7 files, 65 passed |
| #1017 | storefront customizer/presentation/home | 8 files, 48 passed |

No PHP suite. No schema change.  
Build/typecheck/lint: not run as full package builds in this pass.  
CI: **not observed**. Do not treat local vitest as GitHub green.

## Visual QA

Widths 390, 430, 768, 1024, 1280, 1440 were requested. Harness and shell routes were captured. Some first-pass shots at 430 raced paint; a retry of `/sa/ar` at 430 showed the Arabic shell and the empty-catalog line. Console noise was the dev HMR socket only.

RTL: Arabic home, account, and customizer harness.  
LTR: English account overview and sign-in harness. Customizer harness is Arabic-only.  
Mobile/desktop: 390 and 1440 captures exist for those surfaces.

## Security / tenant / compatibility / performance

- No tenant, auth, or `commerce.manage` change.
- Draft still unpublished. Public page reads the normalized published snapshot only.
- No monetary calculation added or removed.
- `presentation: null` behavior preserved.
- No new queries. Homepage walk is in memory.
- Preview `preventDefault` stops the editor following `wa.me` and social URLs. The public storefront links are unchanged.

## Findings resolved in PRs (not on main)

- Published v2 homepage deletions resurrected.
- Header/logo/footer not click-to-edit.
- Stale “not saved” logo and display-name hints.
- Preview WhatsApp/social anchors could leave the editor.

## Remaining gaps

| Classification | Items |
|---|---|
| IMPLEMENTATION_READY | Designed storefront 404. Public `density` and `productCard`. Both unstarted. |
| BACKEND_GATED | Orders, order detail, addresses, wishlist persistence, saved payment methods, card payment, coupons, verification badge. |
| PRODUCT_DECISION_REQUIRED | Per-instance section content shape. Branding file storage. |
| DEFERRED | Undo/redo, version history, DnD, tax row, reviews, related products, category imagery, comparison, homepage appPromo band, `awj-market`, Floral. |
| OUT_OF_SCOPE | Turning the Spree policy route into an AWJ CMS. |

## Decision gates

None. No packet. The content-schema and media-storage choices were not forced.

## Risks

- #1016 empty published homepage is intentional. Confirm that is the wanted merchant outcome before merge.
- Nested chrome buttons (logo inside header/footer) are keyboard-focusable separately. A stricter split would be a follow-up, not a behavior change.
- Screenshot set includes a few frames taken before paint. Do not cite a white frame as a blank route.

## PRE_MERGE_REVIEW

Recorded on each PR before merge, against the exact head SHA above. A later head move invalidates that review.

## Next dependency-safe action

1. STORE-STATES-CLOSE-1 — designed `not-found` inside the store shell.
2. STORE-THEME-PARITY-1 — public `density` and `productCard` only.
3. Do not deploy.
