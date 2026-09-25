# AWJ Storefront Visual Completion Horizon

**Status:** Evidence recorded. Two implementation PRs opened from `main` and left unmerged. Horizon is not closed.  
**Base SHA:** `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4`  
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
- Merge. This invocation requires Safwan’s explicit approval before every merge. Standing merge authority in the protocol does not override that.

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
4. Customizer preview vs public runtime checked. **Gap found and patched, not merged.**
5. Every IMPLEMENTATION_READY defect closed or explicitly left. **Two patched in PRs. Designed 404 and public density/product-card remain open.**
6. No unsupported backend feature activated. **Held.**
7. Remaining gaps classified. **Done.**
8. Tests and CI green on each final PR head. **Local tests recorded per PR. GitHub CI must be observed on the final head before any merge review.**
9. No open P1/P2 inside the patches. **Self-review recorded on the PRs. Not a merge.**
10. Closure report. **Written when the PRs exist. The horizon stays open because 5 and 8 are not finished and merge is forbidden.**

## Task queue

| Order | ID | Depends on merge? | Outcome | State |
|---|---|---|---|---|
| 0 | Evidence + this horizon | No | Durable matrix and queue | This docs change |
| 1 | STORE-VISUAL-CLOSE-1 | No | Public v2 homepage deletion is not resurrected | PR from `main`. Do not merge |
| 2 | STORE-CUSTOMIZER-CLOSE-1 | No | Header/logo/footer/WhatsApp/social click-to-edit. Honest logo and display-name hints. Preview links do not leave the editor | PR from `main`. Do not merge |
| 3 | STORE-STATES-CLOSE-1 | No | Designed `not-found` inside the store shell, ar/en, no new data | Not started |
| 4 | STORE-THEME-PARITY-1 | No | Public page honors published `density` and `productCard` only | Not started |
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

No merge, deploy, or production migration in this horizon without a new explicit approval.
