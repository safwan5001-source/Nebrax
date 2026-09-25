# AWJ Storefront Visual Completion Horizon

**Status:** Implementation-ready queue done. Horizon stays open only for classified gated/deferred gaps. No deploy.  
**Base SHA at evidence:** `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4`  
**Main after the fidelity merges:** `ec2aad3cacc988417971489d46c9125da838c8d8`  
**Evidence:** `docs/plans/store/AWJ_STOREFRONT_VISUAL_COMPLETION_EVIDENCE_PASS.md`

## Objective

Make the existing AWJ storefront and Store Customizer visually and interactionally coherent across the core buyer journey and the merchant customization journey, on desktop and mobile, Arabic RTL and English LTR, without inventing commerce.

The question this horizon answers:

> Is the experience complete, and is every remaining gap classified as IMPLEMENTATION_READY, BACKEND_GATED, PRODUCT_DECISION_REQUIRED, or DEFERRED?

## Non-goals

- Restarting storefront design.
- A second page builder, theme runtime, or Market/Floral implementation.
- Payment, tax, coupon, wishlist, address-book, order-history, review, or shipping-authority changes.
- Branding object storage, undo/redo, version history, drag-and-drop, or per-instance content fields.
- Production deploy or release.
- Production deploy or release.

## Invariants

- Tenant isolation and `commerce.manage` stay as they are.
- Draft is never a public payload. Publish is the only public snapshot.
- Prices, discounts, tax, delivery amounts, and stock stay server-owned.
- No merchant HTML, CSS, JS, or iframe.
- Unknown presentation values fail closed.
- `presentation: null` still means AWJ Modern defaults.
- `CommerceOrder` is not an invoice.
- Gated sections stay off the public homepage until they have a real, honest contract.

## Definition of done

1. Evidence matrix exists. **Done** (this horizon’s evidence pass).
2. Every core buyer route has a classification. **Done in the matrix.** Populated PDP/checkout were not browser-rendered; that limit is written down, not treated as a pass.
3. Desktop/mobile and RTL/LTR verified at 390, 430, 768, 1024, 1280, 1440 where the environment could render. **Partial.** See the evidence pass. English customizer harness was not available.
4. Customizer preview vs public runtime checked. **Gap patched and merged in #1016 and #1017.**
5. Every IMPLEMENTATION_READY defect closed or explicitly left. **Homepage deletion and chrome click-to-edit are merged. Designed 404 is the current task. Public density/product-card remains open.**
6. No unsupported backend feature activated. **Held.**
7. Remaining gaps classified. **Done.**
8. Tests and CI green on each final PR head. **Green on #1015, #1016, and #1017, including post-merge CI on the merge SHAs. Repeat for each later head.**
9. No open P1/P2 inside the patches. **None left open on the merged heads.**
10. Closure report. **Updated. The horizon stays open until the 404 and density/product-card tasks are finished.**

## Task queue

| Order | ID | Depends on merge? | Outcome | State |
|---|---|---|---|---|
| 0 | Evidence + this horizon | No | Durable matrix and queue | Merged [#1015](https://github.com/safwan5001-source/Nebrax/pull/1015) `ec2aad3cacc988417971489d46c9125da838c8d8` |
| 1 | STORE-VISUAL-CLOSE-1 | No | Public v2 homepage deletion is not resurrected | Merged [#1016](https://github.com/safwan5001-source/Nebrax/pull/1016) `2e1225f39e553103ef628e25438461d4cd7d2abe` |
| 2 | STORE-CUSTOMIZER-CLOSE-1 | No | Header/logo/footer/WhatsApp/social click-to-edit. Honest logo and display-name hints. Preview links do not leave the editor | Merged [#1017](https://github.com/safwan5001-source/Nebrax/pull/1017) `6b8869e8694c3b897eed4f75bbf1af07b708f1e4` |
| 3 | STORE-STATES-CLOSE-1 | No | Designed `not-found` inside the store shell, ar/en, no new data | Merged [#1020](https://github.com/safwan5001-source/Nebrax/pull/1020) `395b163c0bc2f22e6086e3e4f5422fa612c7a2a3` |
| 4 | STORE-THEME-PARITY-1 | No | Public page honors published `density` and `productCard` only | Merged [#1021](https://github.com/safwan5001-source/Nebrax/pull/1021) `58567bb0ce3b8ccb62dae2668aafa56cf4ccf64d` |
| — | Per-instance content, branding media object, undo, version history, Market, Floral | Decision or explicit deferral | Do not start | Blocked |

Tasks 1 and 2 do not stack. Either can merge first. Tasks 3 and 4 do not need them merged.

## Acceptance

- Deleted published sections stay deleted. Hidden sections stay in the document but do not render. No presentation still shows hero, categories, new arrivals, wholesale.
- Gated types never render on the public homepage.
- Clicking header, logo, or footer opens that panel and does not write presentation JSON by itself.
- WhatsApp and social preview clicks do not navigate and do not mark publish success.
- Hints do not say the logo is unsaved, and do not say a file store exists.
- Tests cover the new resolver and the chrome clicks.

## Tests

- Storefront: `src/lib/home/__tests__/sections.test.ts` and the presentation/customizer unit set.
- Web: `appearance/section-selection.test.tsx` plus the appearance and `store-experience-builder` suites.
- No Laravel contract change, so SQLite/PostgreSQL suites are not required for these two patches. Run them if a later task touches PHP.

## Visual QA

Required widths: 390, 430, 768, 1024, 1280, 1440.  
Directions: Arabic RTL and English LTR.  
Record unavailable cells. Do not backfill them with a claim.

## Decision gates

None opened. A gate would be required before:

- a per-instance content schema;
- a branding storage provider;
- turning on offers, reviews, coupons, tax, or a verified badge;
- registering `awj-market` or Floral as a preset.

## Release boundary

No deploy or production migration in this horizon without a new explicit approval. Merge of in-scope PRs follows the horizon cycle after exact-head CI and pre-merge review.
