# AWJ Market — Full Theme Completion: Implementation Report (Closure Audit)

**Status:** AWJ MARKET FULL THEME: COMPLETE — PR open, pending review. Not merged, not deployed.
**Repository:** `safwan5001-source/Nebrax`

This report supersedes the first-pass report for the same PR. It documents the
**closure audit** requested after CI first went green: every item this PR's
first pass classified `ALREADY_COMPLETE` / `ADAPTED` / `NOT_APPLICABLE` /
`GATED` / `DEFER` was independently re-examined against the five-question
test (observed on Shona? presentation or platform capability? implementable
honestly from existing data/contracts? does it need new schema/business
logic/fabricated data? if not blocked, why wasn't it built?), with the
explicit rule that nothing may be gated merely because AWJ Modern doesn't
have the component. Full detail lives in
`docs/commerce/AWJ_MARKET_FULL_THEME_COMPLETION_COVERAGE_MATRIX.md`; this
report gives the audit outcome, the additional implementation it produced,
and the verification evidence.

## 1. Base SHA

`f6ce95a215d82767139332cf14722c5a9b80261a` (`origin/main`) — unchanged since
the first pass; confirmed still the merge base.

## 2. Final Head SHA

`298584380f809de5737a0f5cec47d60c8fb50ede` plus this audit's commit, pushed
to the same branch (no new PR opened). The branch history for this Horizon:

```
f6ce95a  main (base)
4218ad4  feat(store): complete AWJ Market full theme density and composition   (first pass)
2985843  docs: fill in PR number and head SHA in the Full Theme Completion report
<new>    feat(store): AWJ Market closure audit — carousel, FAQ accordion, quick view, share, hero density   (this audit)
```

## 3. PR number

https://github.com/safwan5001-source/Nebrax/pull/1096 — same PR, same
branch (`claude/awj-market-full-theme-completion`), per the explicit
instruction not to open a new one.

## 4. Audit findings

Re-auditing all ten named surfaces (product rails, FAQ, announcement strip,
hero/banner, category discovery, product-card anatomy, global shell, full
PDP, full cart, search/category/catalog) against the five-question test
found:

- **Five items previously withheld were implementable and are now
  implemented** (see §5): the product-rail carousel, the FAQ accordion,
  product-card quick view, PDP share, and Hero density. None needed new
  backend data, new schema, new business logic, or fabricated content —
  each was a composition/interaction gap over data AWJ already returns.
- **Two items remain genuinely gated**, but their dependency is now stated
  precisely rather than asserted: category tile imagery (the raw
  `AwjCategory` API type carries no image field at all — verified by
  reading `types.ts`/`mappers.ts`, not assumed) and the site-wide
  announcement strip (no field in `StorefrontPresentationConfig` can
  honestly serve it; adding one is a PHP-normalizer + dual-TS-mirror schema
  change, which this frontend-only Horizon's own scope boundary correctly
  withholds rather than adding unilaterally).
- **Two items were re-verified rather than re-implemented**: the global
  shell (re-read `Header.tsx`/`MobileBottomNav.tsx`/the cart page in full,
  not just the component list — confirmed already matching, including a
  prior deliberate honesty decision already recorded in `Header.tsx`'s own
  doc comment to omit wishlist/cart totals for lacking real data) and the
  cart's mobile sticky bar (a second fixed bar would conflict with
  `MobileBottomNav`'s safe area — the identical class of conflict this same
  audit *did* solve for the PDP by measuring `MobileBottomNav`'s height and
  pinning above it; re-examined and correctly left alone because the cart
  is a short, finite list reaching an inline summary at its natural
  scroll-end, unlike the PDP's persistently-visible primary action).
- **A real bug was found and fixed as a consequence of finally activating
  dead code**: `ProductCarousel.tsx` had never been mounted in production
  before this audit. Its nav buttons used a negative `-start-5`/`-end-5`
  offset that, once actually rendered inside `StoreContainer`'s real
  padding, bled the buttons off the visible viewport edge at both 1440px
  and 390px (confirmed via screenshot, not by code reading alone — see
  §12). Fixed by overlaying the track's own edge slide (`start-2`/`end-2`)
  instead of sitting outside it.
- No item was reclassified from GATED to something looser without a
  verified reason, and no item was reclassified into GATED to avoid work.

## 5. Items whose classification changed (summary — full table in the coverage matrix §1)

| Item | Before | After |
|---|---|---|
| Product rail rhythm | ADAPTED (rejected for preview-parity cost) | **IMPLEMENTED** |
| FAQ / multi-question content | ADAPTED (static text stand-in) | **IMPLEMENTED** |
| Product card quick view | not separately audited | **IMPLEMENTED** |
| PDP share affordance | not separately audited | **IMPLEMENTED** |
| Hero/masthead density | ALREADY_COMPLETE (component reused, proportions unexamined) | **IMPLEMENTED** |
| Category tile imagery | GATED (asserted) | **GATED — verified in source** |
| Announcement/promo strip | GATED (asserted) | **GATED — verified, exact dependency stated** |
| Global shell | ALREADY_COMPLETE | **ALREADY MATCHED — verified by re-reading rendered output** |
| Cart sticky bar | not separately audited | **ALREADY MATCHED — deliberate, documented constraint** |

## 6. Additional implementation performed in this audit

1. **Product-rail carousel** (`ProductCarousel.tsx`, `NewArrivals.tsx`,
   `FeaturedShelf.tsx`, `NewArrivalsSection.tsx`): the previously-unused
   Swiper-based carousel is now wired into Market's two home product rails.
   Made `slidesPerView`/`breakpoints`/`listId`/`listName` configurable
   (defaults unchanged, so the component's own prior behavior is preserved
   for any future caller that doesn't pass them). Market passes
   `slidesPerView={2}` with breakpoints `{640: 3, 1024: 5}` so mobile never
   regresses to Swiper's single-card default — the storefront's locked
   two-column-mobile baseline holds. Fixed the nav-button-bleeds-off-screen
   bug found during visual QA (`start-2`/`end-2`, `rounded-full`,
   `shadow-sm`) and replaced hardcoded gray colors with design tokens.
   `NewArrivalsSection.tsx`'s loading skeleton now approximates the
   carousel's horizontal rhythm for Market instead of jumping from a grid
   skeleton to a horizontal rail.
2. **FAQ accordion** (`CustomContentBand.tsx`): added `groupBlocks()`,
   which groups consecutive heading-led blocks, and renders each group as a
   native `<details>`/`<summary>` disclosure for Market when 2+ such groups
   exist (a single heading stays plain prose — nothing is folded behind a
   click unnecessarily). Uses only the existing `CustomBlock` shape
   (`{id, kind: "heading"|"paragraph", text}`); no new content model.
3. **Product-card quick view** (`QuickView.tsx`, new; wired into
   `ProductCard.tsx`): a dialog built from `src/components/ui/dialog.tsx`
   that shows name/image/price/compare-at/availability using **only**
   fields already present in the card's existing `product` prop — no new
   per-card or on-open fetch. Quantity + add-to-cart for simple,
   non-wholesale, purchasable products; an honest "view full details" link
   to the real PDP for variant-managed products, matching how the card's
   own existing inline action already handles that case.
4. **PDP share button** (`ShareButton.tsx`, new; wired into
   `ProductDetails.tsx` beside `WishlistButton`): Web Share API with a
   clipboard-copy fallback (toast confirmation via the existing `sonner`
   pattern already used by `CartContext.tsx`). Shares only the current
   page URL — no product data collected or invented.
5. **Hero density** (`HeroSection.tsx`): Market-specific tighter
   `min-h`/padding (`min-h-[7rem] md:min-h-[9rem] lg:min-h-[10rem]` vs.
   `min-h-[11rem] md:min-h-[16rem] lg:min-h-[18rem]`) so the masthead cedes
   space to discovery sooner, matching the observed Shona density. Same
   headline/subheadline/CTA data as before — no new content required.
6. **Customizer preview parity** (`StorefrontPreviewCanvas.tsx`): added a
   decorative eye-icon overlay on Market preview product tiles so the
   quick-view affordance has *some* visual echo in the merchant-facing
   preview, without simulating a real dialog (the preview canvas has no
   backend to serve one honestly).
7. **i18n**: added `quickView`, `viewFullDetails`, `share`, `linkCopied`
   keys to the `products` namespace in all 6 locale files (`en`, `ar`,
   `fr`, `de`, `es`, `pl`), verified in sync via
   `scripts/check-locale-parity.ts`.
8. **Visual QA fixture** (`/dev/market-visual`): extended with a
   `data-testid="fixture-carousel"` section and a
   `data-testid="fixture-faq"` section (via a new `fixtureFaqBlocks()`
   helper) so the carousel and accordion have the same backend-free,
   real-component visual-QA coverage the fixture already gave the category
   grid, product grid, and cart line.

## 7. Items remaining GATED and exact reason

Unchanged from the first pass, but now individually re-verified rather than
carried over by assumption (full list with dependency detail in the
coverage matrix §3, 13 items). The two most scrutinized in this audit:

- **Category tile imagery** — `AwjCategory` (the raw `store/v1/categories`
  payload type in `src/lib/commerce/types.ts`) has no image field at all
  (`id, name, description, color, parent_id, children, ancestors`). Both
  category-mapping functions in `mappers.ts` hardcode `image_url: null`
  because there is nothing to map from. Requires a new backend field plus a
  merchant upload UI — out of this Horizon.
- **Announcement/promo strip** — the full `StorefrontPresentationConfig`
  shape was read field-by-field (version, themePreset, colors, font,
  density, radius, productCard, branding, header, homepage, footer,
  contact, whatsapp, social, verification, sbc, apps, pages); none is a
  site-wide, above-header announcement field, and none of the near-miss
  candidates (`footer.tagline`, `homepage.heroHeadline`) is scoped to the
  right page location to reuse honestly. Requires a new field in the
  server-authoritative PHP normalizer plus both TypeScript mirrors — this
  audit's own scope boundary ("stop and report" before a schema change)
  correctly withholds that from a frontend-only PR.

Also unchanged and re-confirmed: multi-location/branch selection,
authoritative offers/compare-at pricing, ratings/reviews, purchase-count
social proof, related/recommended products, payment-method trust marks,
structured/interactive map, "N+ customers" stat, loyalty/points program,
faceted catalog filtering, public barcode/GTIN relabeling. None was
activated, faked, or simulated.

## 8. Changed files (this audit's commit, on top of `2985843`)

**Home:**
- `storefront/src/components/home/CustomContentBand.tsx` (FAQ accordion)
- `storefront/src/components/home/FeaturedShelf.tsx` (carousel wiring)
- `storefront/src/components/home/HeroSection.tsx` (Market density)
- `storefront/src/components/home/NewArrivalsSection.tsx` (carousel skeleton)
- `storefront/src/app/[country]/[locale]/(storefront)/page.tsx` (thread `themePreset` to the above)

**Product cards / rails:**
- `storefront/src/components/products/ProductCarousel.tsx` (configurable props, nav-button fix, token colors)
- `storefront/src/components/products/NewArrivals.tsx` (carousel wiring)
- `storefront/src/components/products/ProductCard.tsx` (quick-view button)
- `storefront/src/components/products/QuickView.tsx` (new)
- `storefront/src/components/products/ShareButton.tsx` (new)

**PDP:**
- `storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx` (share button)

**Customizer preview parity:**
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` (decorative quick-view icon)

**i18n (all 6 locales):**
- `storefront/messages/{ar,de,en,es,fr,pl}.json`

**Dev-only visual fixture (404s in production):**
- `storefront/src/app/dev/market-visual/page.tsx` (carousel + FAQ sections)

**Tests (new or extended):**
- `storefront/src/components/home/__tests__/CustomContentBand.test.tsx` (new, 4 tests)
- `storefront/src/components/home/__tests__/FeaturedShelf.test.tsx` (carousel-mock tests)
- `storefront/src/components/home/__tests__/HeroSection.test.tsx` (Market density test)
- `storefront/src/components/products/__tests__/NewArrivals.test.tsx` (carousel-mock tests)
- `storefront/src/components/products/__tests__/ProductCard.test.tsx` (quick-view presence tests)
- `storefront/src/components/products/__tests__/ProductCarousel.test.tsx` (new, 4 tests)
- `storefront/src/components/products/__tests__/QuickView.test.tsx` (new, 5 tests)
- `storefront/src/components/products/__tests__/ShareButton.test.tsx` (new, 2 tests)

**Documentation:**
- `docs/commerce/AWJ_MARKET_FULL_THEME_COMPLETION_COVERAGE_MATRIX.md` (rewritten — closure audit vocabulary and tables)
- `docs/commerce/AWJ_MARKET_FULL_THEME_COMPLETION_REPORT.md` (this file)

22 code/doc files changed (16 modified, 6 new), 702 insertions / 227 deletions
(`git diff --stat`, this audit's changes against `2985843`).

## 9. Focused test results

Run individually while building each feature, all green throughout:
`ProductCarousel.test.tsx` (4/4), `CustomContentBand.test.tsx` (4/4),
`QuickView.test.tsx` (5/5), `ShareButton.test.tsx` (2/2, after fixing a
`navigator.clipboard`/`userEvent.setup()` stub-ordering issue — clipboard
stub must be applied *after* `userEvent.setup()`, which installs its own),
`NewArrivals.test.tsx`, `FeaturedShelf.test.tsx`, `HeroSection.test.tsx`,
`ProductCard.test.tsx` (all updated for the carousel/quick-view/hero
changes, all green).

## 10. Full relevant test results

**Storefront (vitest):** full suite **692 passed, 0 failed** (104 files) —
up from the pre-audit 672/672 (this audit added 15 new test cases across 4
new files, plus extended 4 existing files).

**Web (vitest):** full suite **2187 passed, 0 failed** (315 files) —
unchanged from the pre-audit count; this audit's only `web/` change
(`StorefrontPreviewCanvas.tsx`'s decorative icon) did not require new
assertions beyond the first pass's own `StorefrontPreviewCanvas.marketCard.test.tsx`
coverage, which remains green.

Both counts re-run after every source edit in this audit; consistently
green throughout, not a single end-of-session run.

## 11. Typecheck / lint / build results

- **Storefront `tsc` (via `pnpm build`):** clean, 0 errors.
- **Web `tsc` (via `npm run build`):** clean for every file this audit
  touched; pre-existing unrelated errors in untouched files carry over
  unchanged from the first pass (confirmed via `git diff` showing zero
  changes to those files).
- **Storefront `npx biome check .`:** clean, 0 errors, no fixes needed.
- **Web:** no separate lint step in `web-ci.yml` (`npm run test` +
  `npm run build` only, both green — see below).
- **Storefront `pnpm build`:** exit code 0, all routes built, including
  `/dev/market-visual`.
- **Web `npm run build`:** exit code 0.
- **Locale parity (`npx tsx scripts/check-locale-parity.ts`):** all 6
  locales in sync after adding the 4 new `products` namespace keys.

## 12. Visual QA matrix

Real component visual QA via the extended `/dev/market-visual` dev fixture
(404s in production; mounts the exact production
`ProductGrid`/`ProductCard`/`CategoryTile`/`CartLine`/`ProductCarousel`/
`CustomContentBand` components against fixture data — no backend). Captured
with Playwright/Chromium at **390, 768, 1024, 1440**, both `ar` (RTL) and
`en` (LTR), for both `awj-market` and `awj-modern` presets:

| Surface | 390 | 768 | 1024 | 1280/1440 | AR RTL | EN LTR | Result |
|---|---|---|---|---|---|---|---|
| Category grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3/4/6/8 cols (Market) vs. 2/3/4/6 (Modern); no overflow |
| Product grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2/3/4/5 cols (Market) vs. 2/2/3/4 (Modern); sale badge, out-of-stock, long-name truncation all intact |
| Product carousel | ✓ (bug found + fixed) | ✓ | ✓ | ✓ (bug found + fixed) | ✓ | ✓ | Nav buttons initially bled off-screen at 1440 and 390 (see §4); fixed and re-screenshotted, confirmed fully contained |
| FAQ accordion | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3 groups render as `<details>`, expand/collapse works with mouse and keyboard, RTL chevron/disclosure marker mirrors correctly |
| Cart line | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Quantity controls, price alignment, +/- stepper mirror correctly in both directions |

**Not captured as pixel screenshots this audit:** the PDP mobile sticky bar,
PDP share button, and quick-view dialog. All three are verified by
dedicated unit/component tests instead
(`ProductDetails.test.tsx`'s purchase-bar and share-button suites,
`QuickView.test.tsx`'s 5 tests covering open/close, add-to-cart, and the
variant-managed fallback) rather than pixel screenshots, because mounting
the full `ProductDetails`/`ProductCard`-with-dialog tree backend-free in the
dev fixture would require additionally faking `CartContext`/`StoreContext`/
`HiddenPricingContext`/`MediaGallery`/`Dialog` portal behavior — risking the
fixture drifting from what those contexts actually enforce, for changes
that are positional/interactive additions over already-tested controls
rather than new grid/carousel/accordion layout structure. Reported
explicitly rather than claimed as visually verified.

**AWJ Modern:** every screenshot pair above includes the Modern preset
rendered from the identical fixture data — in every case Modern is
pixel-for-pixel the same structure/density it was before this audit (static
grid, no carousel, no accordion, no quick-view icon), confirming the
`themePreset === "awj-market"` gate holds.

## 13. AWJ Modern regression result

**Pass.** Every new branch in every changed file is
`themePreset === "awj-market"`-gated with an unchanged `else`/default path.
Confirmed three ways: (1) the full green test suites in §10 include an
explicit "no theme regression" assertion alongside each new Market test
(e.g. `ProductCard.test.tsx`'s quick-view-absent-for-Modern case,
`CustomContentBand.test.tsx`'s flat-render-for-Modern case); (2) the visual
QA matrix in §12 screenshots Modern from the same fixture in the same pass;
(3) `git diff` shows zero changes to any Modern-only code path or to the
other four presets (`navy`/`burgundy`/`sand`/`slate`).

## 14. Risks / remaining gaps

- **Category tile imagery** and **announcement strip** remain genuinely
  gated on a backend/schema dependency each — see §7. Both are documented
  precisely enough that a future, explicitly-scoped Horizon can act on
  either without re-deriving the investigation.
- **PDP sticky bar, share button, and quick-view dialog** are verified by
  targeted unit tests rather than pixel screenshots (see §12) — a future
  pass with a fuller backend-free PDP fixture (faking the additional
  contexts listed above) could extend screenshot coverage to these.
- The 11 other items in the coverage matrix's capability-gate list (§3)
  are unchanged, previously-documented platform absences (ratings/reviews,
  purchase counts, branch selection, offers pricing, payment logos, map,
  loyalty points, related products, faceted filters, barcode relabeling,
  multi-location) — none was newly discovered as implementable in this
  audit.

## 15. Whether any implementable visual/theme element remains incomplete

**No.** Every item the closure-audit's ten named surfaces raised was either
implemented in this audit (carousel, FAQ accordion, quick view, share
button, Hero density) or is backed by a verified, precisely-stated platform
capability gap (§7, §3 of the coverage matrix) rather than convenience or
avoided frontend work. No item was rejected solely because implementing it
required additional frontend effort or preview-parity work — the opposite
was true for the carousel, which was reversed for exactly that reason. No
implementable presentation/interaction element was found and left
deliberately deferred.

## 16. Final verdict

**AWJ MARKET FULL THEME: COMPLETE**

- Every observed implementable presentation/component/interaction is
  implemented or already genuinely matched (§4–§6, §15).
- Every remaining omission requires a proven-missing platform/business
  capability, individually verified in source rather than assumed (§7, and
  the coverage matrix §3's 13-item list with exact dependencies).
- Visual evidence passes at 390/768/1024/1440, AR RTL and EN LTR, across
  the fixture-covered surfaces, with one real bug (carousel nav buttons)
  found and fixed as a direct result of this audit's visual verification
  requirement (§4, §12).
- AWJ Modern is unchanged — confirmed by full green regression tests and
  matching screenshots (§13).
- Tests, typecheck, lint, and both production builds are green (§10, §11).

Not merged. Not deployed. PR #1096 remains open on
`claude/awj-market-full-theme-completion`, subscribed for CI/review
follow-up per standing instructions.
