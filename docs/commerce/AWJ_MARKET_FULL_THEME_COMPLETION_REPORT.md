# AWJ Market — Full Theme Completion: Implementation Report

**Status:** IMPLEMENTATION COMPLETE for the scope defined below — PR open, pending review
**Repository:** `safwan5001-source/Nebrax`

## 1. Scope and exclusions

This Horizon extends `AWJ_MARKET_HORIZON_IMPLEMENTATION_TASK.md`/`AWJ_MARKET_SHONA_EVIDENCE_GAP_PASS.md` (the Master Spec) using fresh live evidence from `https://store.shonaksa.com/` (previously blocked by network policy; confirmed reachable this session). It closes the gap the prior Horizon (PR #1084/#1091) left open: that Horizon registered the `awj-market` preset and its starting bundle but made no Market-specific composition/density changes beyond one `ProductCard` image-height branch, citing blocked live-evidence access.

**Explicitly excluded** (unchanged from the Master Spec's capability-gate manifest, re-confirmed by this Horizon's own live evidence — see the coverage matrix §7 for the full list):
customer-selectable multi-location availability, authoritative offers/compare-at pricing and a dedicated Offers route, persistent wishlist, ratings/reviews, purchase-count social proof, public barcode/GTIN relabeling, a structured/interactive map, faceted catalog filtering, search suggestions, unsupported payment-method claims, arbitrary related-product recommendations, a loyalty/points program, and a site-wide announcement strip (would require a new persisted schema field — deferred, not gated by missing platform authority).

No database model, storefront route, commerce authority, or persisted `StorefrontPresentationConfig` field was added. Every change reads the **already-persisted** `themePreset` value.

## 2. Base verification

- **Base SHA:** `f6ce95a215d82767139332cf14722c5a9b80261a` (`origin/main`, confirmed via `git fetch` + `git rev-parse` at Horizon start)
- **Branch:** `claude/awj-market-full-theme-completion`
- **PR:** https://github.com/safwan5001-source/Nebrax/pull/1096
- **Head SHA:** `4218ad403b275d9449a44abff01d66cfb7225f26`
- Working tree was clean at start; no intervening conflicting work found (this was the exact tip of `main` at the time of `git fetch`, not a moved target).

## 3. Live evidence pass

Full detail in `docs/commerce/AWJ_MARKET_FULL_THEME_COMPLETION_COVERAGE_MATRIX.md` (§2). Summary: real Playwright/Chromium session against `store.shonaksa.com`, branch/location modal handled through the live UI, evidence captured at 1440px and 390px (spot checks at 768/1024) across Home (full page, every section), Category, PDP (simple product, full page including reviews/related), Offers, Search, and Cart (add-to-cart, empty state). No Shona branding, imagery, copy, or proprietary code was copied — screenshots and DOM structure were inspected, not redistributed.

## 4. Implementation summary by surface

### 4.1 Home

- **Category discovery density** (`CategoriesSection.tsx`): Market raises the tile ceiling (12→18) and grid density (`grid-cols-2…xl:grid-cols-6` → `grid-cols-3…xl:grid-cols-8`, `gap-3`→`gap-2`, tile padding `px-4 py-3.5`→`px-3 py-2.5`, subcategory count hidden). `page.tsx` threads `presentation?.themePreset` in. Modern is byte-identical to before.
- **Product-rail density** (`NewArrivalsSection.tsx`/`NewArrivals.tsx`, `FeaturedShelf.tsx`): Market widens the desktop tier (`lg:grid-cols-4`→`lg:grid-cols-5`); both components and their skeletons thread `themePreset`.
- Hero, wholesale, banner/featured/benefits/appPromo/customContent sections: reused unchanged — already generic, merchant-authored, no fabricated content.

### 4.2 Catalog / Category / Search

- **`InfiniteProductList.tsx`** (the actual live catalog/category/search grid) and **`ProductGrid.tsx`** (the dev-fixture/backend-free grid): both now read `usePublishedThemeMarker()` directly (client components) and widen to `sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` under Market, vs. the unchanged `lg:grid-cols-3 xl:grid-cols-4` for every other theme. `ProductGrid.tsx` gained a `"use client"` directive (required to call the hook); its only production consumer (`/dev/market-visual`) is unaffected.

### 4.3 PDP

- **`ProductDetails.tsx`**: under Market, the existing quantity/add-to-cart row becomes a `fixed` bar pinned above `MobileBottomNav` (`bottom: calc(var(--store-bottom-nav-height)+env(safe-area-inset-bottom))`, the same technique `StoreWhatsApp.tsx` already uses) below the `md` breakpoint — the same breakpoint `MobileBottomNav` itself disappears at — and reverts to the ordinary static row at `md` and up. This **repositions** the existing controls; it does not duplicate them (a dedicated test asserts exactly one "add to cart" button renders). Container padding also tightens (`py-5 md:py-6`→`py-3 md:py-5`) under Market.
- No PDP business logic (`handleAddToCart`, variant resolution, availability) was touched.

### 4.4 Cart

- **`CartLine.tsx`** (shared by the cart drawer, cart page, checkout item review, and order confirmation): row padding tightens `py-4`→`py-3` for the `page`/`drawer` densities under Market only, via `usePublishedThemeMarker()`. Nothing in `CartLineView`, the AWJ/Spree adapters, or the quantity/remove handlers changed — this is a pure spacing adjustment on a money-critical, shared component.

### 4.5 Offers

- No route added. Live evidence confirmed Shona's own Offers page is a plain grid filtered on a pricing field (`compare_at`) AWJ does not populate anywhere in the platform — reproducing it would require either fabricating discounts or building the missing platform pricing contract, both out of this Horizon's scope. Documented as GATED in the coverage matrix.

### 4.6 Global shell (Header/CategoryNav/MobileBottomNav/Footer/WhatsApp)

- **No code change.** Live evidence confirmed these already satisfy the Master Spec's acceptance bar (prominent search, dense category rail, safe-area-respecting bottom nav, configurable contact/social/app footer) through existing, already-reused components and the pre-existing `header.style=compact` token Market's starting bundle already applies. Forcing a Market-exclusive shell change with no evidenced gap would have been exactly the kind of unjustified generic seam the Master Spec and CLAUDE.md both warn against.

### 4.7 Customizer / preview parity

- **`StorefrontPreviewCanvas.tsx`** (`web/`): mirrors the new category-grid and new-arrivals density classes using the file's own established "resolve the class from the simulated `viewport` prop, not a real responsive prefix" technique (documented in the file since the prior Horizon's 7-round preview-parity saga over `cardImageHeight`). This also fixed a **pre-existing, non-Market-specific** gap: the categories grid preview had never received that fix and still used un-resolved `sm:`/`lg:`/`xl:` classes that would have evaluated against the host browser's real window, not the simulated device — closed for both Modern and Market as a natural consequence of touching this exact code.
- No new persisted config field — see §5.

## 5. Contracts/components reused (no fork)

`StorefrontPresentationConfig`, the three mirrored `THEME_PRESETS` allow-lists, `PublishedThemeMarkerProvider`/`usePublishedThemeMarker()` (from PR #1084), `PublishedCardStyleProvider`, `CategoriesSection`/`NewArrivals`/`FeaturedShelf`/`ProductCard`/`ProductGrid`/`InfiniteProductList`, `CartLine`/`awjCartLineView`, `ProductDetails`, the Theme Gallery's `presetSelectionPatch()`. No `Market*` component fork, no second storefront runtime, no new commerce service.

## 6. Generic seams introduced and why

1. **`CategoryTile` export** (`CategoriesSection.tsx`): was a private function; exported only so the `/dev/market-visual` fixture can render the exact production tile markup against hand-built categories (that fixture is backend-free and cannot call `getCategories()`). No behavior change for existing callers.
2. **Explicit `themePreset` prop** on `CategoriesSection`/`NewArrivalsSection`/`NewArrivals`/`FeaturedShelf`: these are server components, so the client-only `usePublishedThemeMarker()` context isn't available to them; `page.tsx` already has `presentation.themePreset` in scope from the same `fetchStorefrontConfig()` call it uses for everything else on the page. This mirrors the codebase's own existing pattern (`publishedHomeStackClass(density)`, `publishedProductCardBodyClass(productCard)` — primitives passed explicitly, not read from context, for server-renderable decisions).

Both are narrow, additive, and were "genuinely needed" per the Master Spec's own bar: without the first, real category tiles couldn't be visually verified without a backend; without the second, Home's density decisions would have had no lawful place to read `themePreset` from at all.

## 7. Capability gates encountered

None were activated. Every implemented change consumes only already-live AWJ capabilities (the closed preset enum, existing category/product data, existing `CartLine`/`ProductDetails` structure). See the coverage matrix §7 for the full, unchanged gate list re-confirmed by this Horizon's fresh evidence.

## 8. Changed files

**Home:**
- `storefront/src/components/home/CategoriesSection.tsx`
- `storefront/src/components/home/NewArrivalsSection.tsx`
- `storefront/src/components/home/FeaturedShelf.tsx`
- `storefront/src/app/[country]/[locale]/(storefront)/page.tsx`

**Catalog/category/search:**
- `storefront/src/components/products/InfiniteProductList.tsx`
- `storefront/src/components/products/ProductGrid.tsx`
- `storefront/src/components/products/NewArrivals.tsx`

**PDP:**
- `storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx`

**Cart:**
- `storefront/src/components/cart/CartLine.tsx`

**Customizer preview parity:**
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`

**Dev-only visual fixture (404s in production):**
- `storefront/src/app/dev/market-visual/page.tsx` (extended with a categories block and a cart-line block, reusing the real `CategoryTile`/`CartLine` components)

**Tests (new or extended):**
- `storefront/src/components/home/__tests__/CategoriesSection.test.tsx`
- `storefront/src/components/home/__tests__/FeaturedShelf.test.tsx` (new)
- `storefront/src/components/products/__tests__/NewArrivals.test.tsx`
- `storefront/src/components/products/__tests__/InfiniteProductList.test.tsx` (new)
- `storefront/src/components/products/__tests__/ProductGrid.test.tsx` (new)
- `storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.test.tsx`
- `storefront/src/components/cart/__tests__/CartLine.test.tsx`
- `web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.marketCard.test.tsx`

**Documentation:**
- `docs/commerce/AWJ_MARKET_FULL_THEME_COMPLETION_COVERAGE_MATRIX.md` (new)
- `docs/commerce/AWJ_MARKET_FULL_THEME_COMPLETION_REPORT.md` (this file)

16 code/test files changed, 3 new test files, 546 insertions / 40 deletions (`git diff --stat`, excluding the two new docs).

## 9. Focused and full test results

**Storefront (vitest):** full suite **672 passed, 0 failed** (100 files) — up from the pre-Horizon baseline's 657/657 (this Horizon added 15 new test cases across 3 new + 5 extended files). Re-run after every source edit; consistently green.

**Web (vitest):** full suite **2187 passed, 0 failed** (315 files) — up from 2180/2180 (7 new cases in `StorefrontPreviewCanvas.marketCard.test.tsx`, plus one existing assertion's selector fixed — see §10).

**Storefront `tsc --noEmit`:** clean, 0 errors.
**Web `tsc --noEmit`:** pre-existing errors only, in files this Horizon never touched (POS settings, platform integrations, product-variant/document components, import-jobs) — identical list to the pre-existing baseline the prior Horizon documented, confirmed unrelated by `git diff` showing zero changes to any of those files.

**Storefront `pnpm check` (Biome):** clean, 0 errors (442 files) after one auto-fix pass (import ordering + formatter nits on 3 files this Horizon touched).
**Web:** has no Biome config and its `lint` script (`next lint`) requires interactive first-time ESLint setup not present in this container; web's CI (`web-ci.yml`) runs `npm run test` + `npm run build` only, both green — see §11.

**Storefront `pnpm build` (Next.js production build):** succeeded, exit code 0, all routes including `/dev/market-visual` built cleanly.
**Web `npm run build`:** succeeded, exit code 0 (this also performs web's TypeScript check per its own build step).

**Backend (PHP):** not run. Confirmed via `git diff --stat` that this Horizon touched zero files outside `storefront/` and `web/` — no `app/`, `routes/`, or `database/` file changed, and no new `StorefrontPresentationConfig` field was persisted. Per the Master Spec's own conditional ("run backend/presentation contract tests if shared normalization/persistence code changes"), that condition was never met this Horizon.

## 10. One pre-existing test selector fixed (not a regression)

`StorefrontPreviewCanvas.marketCard.test.tsx`'s "keeps desktop chrome… when header.style is compact" test used an unscoped `.mt-4.grid.gap-3` selector that was only *coincidentally* unique before this Horizon (the categories preview grid used a hardcoded `gap-2`, the New Arrivals grid `gap-3`). Fixing the categories preview's gap to correctly track the real component (`gap-3` for Modern, matching `CategoriesSection.tsx`) made the selector ambiguous — `querySelector` would return whichever section happens to render first in the DOM. Scoped the selector to `section[aria-labelledby="preview-arrivals"] ul.grid` (the same disambiguation pattern the file's own newer column-count test already uses) — same expected value, no assertion weakened.

## 11. Visual acceptance evidence

Real component visual QA via the extended `/dev/market-visual` dev fixture (404s in production; mounts `ProductGrid`/`ProductCard`/`CategoryTile`/`CartLine` — the exact production components — against fixture data, no backend). Captured with Playwright/Chromium at **390, 768, 1024, 1440** for `{ar,en} × {awj-market,awj-modern}` (18 screenshots). Confirmed:

- Category grid: 3/4/6/8 columns at mobile/tablet/(1024)/(1280+) for Market vs. 2/3/4/6 for Modern — matches the resolved breakpoints exactly, no overflow at any width.
- Product grid: 2/3/4/5 columns for Market vs. 2/2/3/4 for Modern at the same widths (5 columns confirmed rendering at 1440 with real product-card content, sale badge, out-of-stock state, and long-name truncation all intact).
- Cart line: renders correctly in both densities; RTL (Arabic) and LTR (English) both verified — quantity controls, price alignment, and the +/- stepper mirror correctly.
- No horizontal overflow, no broken wrapping of long Arabic/English product names, at any captured width.

**Not captured as screenshots this session:** the PDP mobile sticky bar and the exact Cart-drawer/page padding delta. Both are single, narrow CSS changes (a `fixed`/`md:static` positioning swap and a `py-4`→`py-3` padding swap respectively) verified precisely by dedicated unit tests (`ProductDetails.test.tsx`'s "AWJ Market mobile purchase bar" suite; `CartLine.test.tsx`'s density tests) rather than pixel screenshots, because mounting the full `ProductDetails`/`CartDrawer` tree backend-free would require additionally faking `CartContext`/`StoreContext`/`HiddenPricingContext`/`MediaGallery`/`Sheet` portal behavior — risking the fixture drifting from what those contexts actually enforce, for a change that is positional/spacing-only rather than new layout structure. This is reported explicitly rather than claimed as visually verified.

RTL/LTR: verified via the 390/1440 `ar`/`en` fixture screenshots (§ above) for the surfaces that fixture covers; not separately re-verified for PDP/Cart beyond the unit tests noted above.

## 12. Accessibility

No accessibility-relevant markup changed. The PDP purchase row's semantic structure (labelled quantity control, button) is identical — only its CSS position changes; the spacer div added alongside it is `aria-hidden="true"`. `CategoryTile`'s link/heading semantics are unchanged (only Tailwind classes and a boolean-gated subcategory count changed). `CartLine`'s DOM structure/ARIA is unchanged (only a padding class is conditional). No new icon-only control, no color-only state communication.

## 13. Performance

**Measured:** zero new client bundle added to the hot path — every change is either a conditional Tailwind class or an existing hook already wired into these components' provider tree; no new network request, no duplicated storefront-config/catalog fetch. `ProductGrid.tsx` gained a `"use client"` directive, but its only consumer is the dev-only fixture, so this adds no client-bundle weight to any public route.
**Not measured:** real paint/LCP deltas from the denser grids (would require a live backend + Lighthouse pass, out of reach in this environment). Reported explicitly as unmeasured.

## 14. Tenant isolation / security / backward compatibility

- No tenant-resolution, publication-guard, or Draft/Published-isolation code was touched.
- No new persisted field — the preset enum, its normalization, and its fail-closed-to-`awj-modern` behavior are all unchanged (verified: zero diff in `StorefrontPresentationNormalizer.php` or either TS `tokens.ts`/`config.ts` mirror).
- Every new branch is `themePreset === "awj-market"`-gated with an unchanged `else` path; AWJ Modern and the other four presets (`navy`/`burgundy`/`sand`/`slate`) are provably unaffected — confirmed by the full green test suites both before and after every change, and by the explicit "no theme regression" test added alongside each Market-specific test (e.g. `NewArrivals.test.tsx`'s "widens the desktop tier for AWJ Market without changing AWJ Modern").
- No raw stock, cost, margin, or accounting data is touched or newly exposed.

## 15. Risks / remaining work

- **Product-rail carousel** (`ProductCarousel.tsx`) remains unused. Wiring it into the homepage rails for a closer visual match to Shona's carousel-style shelves is a legitimate future enhancement, deliberately deferred this Horizon to avoid re-deriving the preview/published parity work the prior Horizon's 7 review rounds already paid for on a different dimension (see the coverage matrix §3.2 and §6).
- **Site-wide announcement strip** is a real Shona pattern with no AWJ equivalent; would need a new persisted presentation field, out of this Horizon's "no new schema" discipline.
- **PDP sticky bar and Cart padding** are verified by precise unit tests rather than pixel screenshots (see §11) — a future pass with a fuller backend-free PDP/cart fixture could add that screenshot evidence.
- **FAQ accordion interaction** — the content slot exists (`customContent`); the expand/collapse behavior does not. Static text blocks are the honest current state.

## 16. CI status / merge state / deploy state

PR #1096 opened against `main` at base SHA `f6ce95a215d82767139332cf14722c5a9b80261a`, head SHA `4218ad403b275d9449a44abff01d66cfb7225f26`. This session is subscribed to the PR's activity (CI, reviews, comments) and will drive it to green and address in-scope findings as they arrive. Not merged, not deployed — outside this Horizon's authorization by design.

## 17. Recommended next action

Follow CI on PR #1096 to green and address any in-scope review findings. The visual/coverage matrix should be reconciled against the actual live storefront once a backend-connected preview environment is available, to extend the screenshot evidence in §11 to PDP/Cart. Otherwise this slice is ready to merge once CI is green and review feedback is addressed — **merge/deploy remain outside this Horizon's authorization.**
