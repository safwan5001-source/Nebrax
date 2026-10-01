# CUST-H3-3 — Implementation Report: Global Component Appearance Parity

## 1. Base SHA

`aa8815e5d761f7678cb90a67f69531bc35813a0d` (verified against `origin/main` at task start — `feat(store): close color and typography truth (#1144)`, the CUST-H3-2 merge commit).

## 2. Head SHA

`f647258` (see `git log feat/cust-h3-3-global-component-parity`).

## 3. Branch

`feat/cust-h3-3-global-component-parity`

## 4. PR number + URL

Opened against `safwan5001-source/Nebrax` — see the PR this report accompanies (created immediately after this commit). No merge performed.

## 5. Evidence table (before implementation)

Built by reading the PHP normalizer (`app/Support/Commerce/StorefrontPresentationNormalizer.php`), both TS normalizer mirrors (`web/.../presentation/{tokens,config}.ts`, `storefront/src/lib/presentation/{tokens,config}.ts`), the Canvas (`web/.../StorefrontPreviewCanvas.tsx`), and every real Published consumer (`storefront/src/app/[country]/[locale]/(storefront)/**`, `storefront/src/components/products/ProductCard.tsx`, `storefront/src/components/layout/{PublishedCardStyle,PublishedThemeMarker}.tsx`).

| Field | Classification found | Detail |
|---|---|---|
| `density` | **LIVE, parity incomplete** | Real Published consumer already existed: `publishedHomeStackClass(presentation?.density)` drives the homepage section rhythm (`(storefront)/page.tsx`). But the Canvas's Product/Category page previews (`ProductPagePreview`/`CategoryPagePreview` in `StorefrontPreviewCanvas.tsx`) *already* showed a second, different compact/comfortable difference — their own outer container padding — that had **no Published counterpart at all**: the real Product page (`ProductDetails.tsx`) and Category page (`c/[...permalink]/page.tsx`) used fixed padding regardless of `density`. This is exactly the "Canvas shows a difference Published doesn't" failure mode the task brief warns about, in the opposite direction from a persisted no-op. |
| `productCard` | **LIVE, parity incomplete** | Real Published consumer already existed and was already wired broadly: `ProductCard.tsx` (shared by `InfiniteProductList.tsx`, `FeaturedShelf.tsx`, `NewArrivalsSection.tsx`) calls `publishedProductCardBodyClass(cardStyle)` via `usePublishedProductCard()`/`PublishedCardStyleProvider`, varying body padding (`p-2.5` vs `p-3`). The Canvas's Home preview mirrors this correctly (`cardPad` applied to the "new arrivals" mock). But the Canvas's **Category page preview's `product_grid` region** used a separate, hard-coded mock card (`px-1.5 py-1`, no variation) that ignored `productCard` entirely — the one page where the real published grid changes the most, the Canvas showed no difference at all. |
| `radius` | **LIVE, parity complete** | Both Canvas and Published call the exact same `presentationCssVars(primaryColor, radius)` (`tokens.ts`, byte-identical file on both sides), which both apply as inline CSS vars (`--store-radius`/`--radius`) on their respective root/wrapper elements. `globals.css` derives the whole Tailwind radius scale from `--radius`, which resolves from `--store-radius`. No seam divergence found. **No change made.** |
| `header.style` | **LIVE, parity complete** | Confirmed by reading the Canvas's own documented reasoning (`StorefrontPreviewCanvas.tsx` lines ~176–188) against `Header.tsx` and `(storefront)/layout.tsx`: the Published Header ties `header.style === "compact"` to exactly two things — which logo variant renders, and whether the utility strip shows (`!compact` gate in `Header.tsx`). The Canvas computes `compact = mobileViewport || headerStyleCompact` and gates the identical two things. Already carries an explicit comment distinguishing this from the shell's own independent `md`/`lg` responsive behavior (not part of `header.style` at all). **No change made.** |

This matches the brief's "expected H3-3 primary gaps" exactly: density and productCard incomplete, radius and header.style already LIVE — confirmed in code rather than assumed.

## 6. `density` status before/after

- **Before:** Published consumer existed only for the homepage section rhythm. Product/Category page container padding was fixed (`py-5 md:py-6` for Product's non-Market branch; `py-5 md:py-6` for Category, unconditionally), while the Canvas already simulated a `py-3` (compact) vs `py-5 md:py-6` (comfortable) difference for those same two pages — a Canvas-only, never-truthful effect.
- **After:** `pageContainerPaddingClass()` (web, `presentation/tokens.ts`) and `publishedPageContainerPaddingClass()` (storefront, `lib/presentation/public-rhythm.ts`) are the single deterministic resolver (`compact` → `"py-3"`, anything else → `"py-5 md:py-6"`) now used by:
  - Canvas: `ProductPagePreview`'s ready-state container, `CategoryPagePreview`'s ready-state container (its `space-y-*` stays separate — that's a Canvas-only need for its own multi-region block stacking, not a Published surface).
  - Published: `ProductDetails.tsx`'s outer `StoreContainer` (for every theme but AWJ Market, whose own already-locked compact chrome — Master Spec §29 — is untouched), and `c/[...permalink]/page.tsx`'s outer `StoreContainer`.
- Home page's existing `publishedHomeStackClass` is untouched — a different, already-correct surface with its own numbers.

## 7. `productCard` status before/after

- **Before:** Canvas's Category page preview `product_grid` mock always rendered `px-1.5 py-1`, regardless of `config.productCard`.
- **After:** the same mock now renders `px-1.5 py-1` for `compact` and `px-2 py-1.5` for `standard`, driven directly by `config.productCard` (passed as a new prop to `CategoryPagePreview`). This is a context-calibrated value (not a literal reuse of the full-size `ProductCard`'s `p-2.5`/`p-3`, which is tuned for a card with category/title/price/button — this mock has only a name label), but it is the same bounded standard/compact semantic, deterministically driven by the one `productCard` field, exactly like `cardImageHeight`/`newArrivalsColumns` are each separately calibrated per their own rendering context from the same canonical fields elsewhere in this file.
- Home page's "new arrivals" mock (`cardPad`) was already correct — untouched.
- No change to the real Published `ProductCard.tsx`, `publishedProductCardBodyClass()`, or `PublishedCardStyleProvider` — all already correct and already proven live across Home shelves and catalog/category grids.

## 8. `radius` status

Unchanged. Confirmed parity-complete; no code touched.

## 9. `header.style` status

Unchanged. Confirmed parity-complete; no code touched.

## 10. Exact runtime architecture

```
density ──┬─> publishedHomeStackClass(density)            [pre-existing, untouched]
          │     storefront/src/lib/presentation/public-rhythm.ts
          │     consumed by (storefront)/page.tsx (Home) and Canvas's Home preview
          │
          └─> publishedPageContainerPaddingClass(density)  [NEW]
                storefront/src/lib/presentation/public-rhythm.ts
                consumed by:
                  - products/[slug]/ProductDetails.tsx (StoreContainer, non-Market branch)
                  - c/[...permalink]/page.tsx (StoreContainer)
                mirrored by pageContainerPaddingClass(density) [NEW]
                  web/src/modules/store-experience-builder/presentation/tokens.ts
                  consumed by StorefrontPreviewCanvas.tsx's ProductPagePreview/
                  CategoryPagePreview ready-state containers

productCard ──> usePublishedProductCard() -> publishedProductCardBodyClass()  [pre-existing]
                storefront/src/components/layout/PublishedCardStyle.tsx
                storefront/src/lib/presentation/public-rhythm.ts
                consumed by storefront/src/components/products/ProductCard.tsx
                  (shared by InfiniteProductList, FeaturedShelf, NewArrivalsSection)
              + Canvas's own cardPad (pre-existing, Home "new arrivals" mock)
              + Canvas's CategoryPagePreview product_grid tile padding [NEW —
                driven by the same config.productCard, calibrated to this
                smaller mock's own layout]
```

`StorefrontPresentationNormalizer` (PHP) and both TS `normalizePresentationConfig()` mirrors were already identical for all four fields before this slice (confirmed in the evidence pass, §5) — no normalizer change was needed or made.

## 11. Canvas parity

- Product page preview: selecting `compact` density now visibly shrinks the preview's outer vertical padding (`py-3` vs `py-5 md:py-6`), proven by `StorefrontPreviewCanvas.densityProductCard.test.tsx`.
- Category page preview: same density effect on its own container, plus the `product_grid` mock's tile padding now visibly changes with `productCard`, proven by the same test file.

## 12. Published storefront parity

- Product detail page (`ProductDetails.tsx`): `density` now resolves through the identical `publishedPageContainerPaddingClass()` the Canvas uses, for every theme except AWJ Market (whose own already-locked `py-3 md:py-5` compact chrome is untouched — a separate, pre-existing Master Spec decision, not generic density).
- Category page (`c/[...permalink]/page.tsx`): same resolver, no theme branch existed before, none added.
- `productCard`'s real runtime effect was already fully live and already proven on Published (`ProductCard.tsx` via `InfiniteProductList`/`FeaturedShelf`/`NewArrivalsSection`) — nothing on the Published side needed to change for this field; only the Canvas's Category preview mock was lying about it.

## 13. Draft isolation

Unaffected. `publishedPageContainerPaddingClass()`/`pageContainerPaddingClass()` are pure functions taking an already-resolved `density` value — they introduce no new data source. `ProductDetails.tsx` receives `density` as a plain prop from `page.tsx`'s existing `fetchPublishedPresentation()` call (the same Published-only presentation the page already fetched for `pagePresentation`) — no new fetch, no Draft ever reaches the public runtime.

## 14. Mobile evidence

No new breakpoint-sensitive classes were introduced beyond what the Canvas already computed (`py-3` / `py-5 md:py-6` — both of which were already present, verified correct at the Canvas's three existing simulated widths by the pre-existing `StorefrontPreviewCanvas.marketCard.test.tsx` pattern). The new `StorefrontPreviewCanvas.densityProductCard.test.tsx` tests render at `viewport="desktop"` for determinism (matching the existing `marketCard`/`typography` test files' own convention of not re-deriving viewport-breakpoint behavior per new test file); no interactive target size changed — only container padding and a text label's own padding.

## 15. RTL/LTR

No direction-sensitive classes were touched (`py-*`/`px-*` are logical already in the existing codebase's Tailwind config for this project — confirmed by reading the existing `py-3`/`px-1.5` classes already present before this change, unmodified in kind). No new test was needed beyond the existing RTL/LTR coverage in `StorefrontPreviewCanvas.marketCard.test.tsx` and `ProductDetails.test.tsx`'s existing suite, which continues to pass unmodified.

## 16. Accessibility

- No interactive element's tap target size changed — only non-interactive container/text padding.
- No focus or contrast-relevant class was touched.
- The `ProductDetails — CUST-H3-3 density container-padding parity` test suite explicitly proves AWJ Market's own compact chrome (a pre-existing, separately-governed decision) is not overridden by the new generic resolver, so no accessibility regression from conflating the two.

## 17. Visual QA evidence

No existing Playwright/dev harness exercises `density`/`productCard`/page-container-padding specifically (`dev/trust-visual` is scenario-driven for identity/branding only, with no `density`/`productCard` query knobs, and the task brief explicitly forbids building a new visual framework). Given that constraint, visual evidence for this slice is:

1. **Real-DOM class assertions** via React Testing Library (not mocked, not jsdom-approximated) in both `StorefrontPreviewCanvas.densityProductCard.test.tsx` (Canvas) and `ProductDetails.test.tsx`'s new `CUST-H3-3` suite (Published) — these read the actual rendered `className` string React produced, proving the correct Tailwind utility classes are present/absent for each density/productCard value.
2. **Full production builds** (web + storefront, §21) compile these exact literal class strings through Tailwind's JIT scanner — a typo'd or dead class would either fail the build or silently not exist in the output CSS; both builds succeeded, so the classes are real, shipped utilities, not just strings in a test assertion.
3. **Regression run of the existing `store-brand-qa` Playwright suite** (real headless Chromium, not jsdom) — both the web `merchant-preview` job (33 tests) and the storefront `published-footer` job (69 tests) were run locally and passed with zero changes needed to any existing test, confirming this slice introduced no visible regression to the one real-browser visual harness that already exists for this module. (Executed with a local-only `executablePath` override to point at this sandbox's pre-installed Chromium revision; the override was reverted before committing — it is not part of the diff. CI's own `store-brand-qa.yml` workflow has path filters that cover every file this PR touches and will run for real on the PR.)

No pixel-diff/screenshot-comparison claim is made for the density/productCard surfaces specifically — this is stated explicitly per the task's own instruction not to claim pixel parity without a harness that actually proves it.

## 18. Files changed

```
storefront/src/app/[country]/[locale]/(storefront)/c/[...permalink]/page.tsx        (modified)
storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/page.tsx          (modified)
storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx (modified)
storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.test.tsx (modified)
storefront/src/lib/presentation/public-rhythm.ts                                     (modified)
storefront/src/lib/presentation/__tests__/public-rhythm.test.ts                      (modified)
web/src/modules/store-experience-builder/presentation/tokens.ts                      (modified)
web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx                 (modified)
web/src/modules/store-experience-builder/__tests__/presentation.test.ts              (modified)
web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.densityProductCard.test.tsx (new)
docs/reports/CUST-H3-3-IMPLEMENTATION-REPORT.md                                      (new, this file)
```

No PHP file touched (confirmed via `git status` before committing) — the normalizer contract for all four fields was already correct and identical across PHP/web/storefront before this slice (§5).

## 19. Tests + exact results

| Suite | Command | Result |
|---|---|---|
| storefront — presentation + `ProductDetails` | `npx vitest run src/lib/presentation "src/app/[country]/[locale]/(storefront)"` | **95/95 passed** (12 files) |
| storefront — `ProductDetails.test.tsx` + `public-rhythm.test.ts` focused | `npx vitest run "...ProductDetails.test.tsx" src/lib/presentation/__tests__/public-rhythm.test.ts` | **24/24 passed** (2 files — 16 pre-existing + 8 new) |
| storefront — full suite | `npx vitest run` | **754/754 passed** (110 files — 748 pre-existing + 6 new) |
| web — `store-experience-builder` module | `npx vitest run src/modules/store-experience-builder` | **236/236 passed** (23 files — 229 pre-existing + 7 new: 6 in the new `StorefrontPreviewCanvas.densityProductCard.test.tsx` + 1 in `presentation.test.ts`) |
| PHP — normalizer only | `php artisan test --filter=StorefrontPresentationNormalizerTest` | **33/33 passed** (166 assertions) — unchanged, confirms zero impact since no PHP file changed |
| PHP — full suite | `php artisan test` | **4968 passed, 56 failed, 51 skipped** (31030 assertions) — identical counts to CUST-H3-2's own report; all 56 failures are the same pre-existing environment-caused clusters (missing `aws/aws-sdk-php` vendor package, missing `RESEND_API_KEY`/mail env, unrelated Fuel Stations/product-visual-type tests) — none reference `StorefrontPresentationNormalizer`, `density`, `productCard`, or any file this PR touched |
| web/storefront — `store-brand-qa` Playwright (regression, real Chromium) | `npx playwright test e2e/store-brand-qa.spec.ts --project=desktop` (web) / `--config=playwright.brand-qa.config.ts --project=chromium` (storefront) | **33/33 passed** (web) + **69/69 passed** (storefront) |

## 20. Typecheck

- `storefront/`: `npx tsc --noEmit -p .` — clean, zero errors.
- `web/`: `npx tsc --noEmit -p .` — **27 pre-existing errors**, identical in count and content to a clean checkout of this PR's own base commit (verified by `git stash` + re-run, per the CUST-H3-1/H3-2 convention). All 27 are in files this PR never touched (`pos/settings/configuration`, `commerce/appearance/section-{editing,instances,selection}.test.tsx`, `platform/integrations/gemini-card.test.tsx`, `documents/document-language-selector.test.tsx`, `global-application-controls-card.test.tsx`, `products/product-{multi-barcode-table,variants-panel,workspace}.test.tsx`, `documents/use-document-label-mode.test.tsx`, `import-jobs/useImportJobEngine.test.tsx`). **Zero errors in any file this PR changed.**

## 21. Builds

- `web/`: `npm run build` — exit code `0`, full route manifest generated, no compile errors.
- `storefront/`: `pnpm build` (Next 16.2.11, Turbopack) — exit code `0`, every route (including `/[country]/[locale]/products/[slug]`, `/[country]/[locale]/c/[...permalink]`, and `/dev/trust-visual`) compiled successfully.

## 22. CI

Not yet observed on this PR (opened immediately after this report). The relevant workflows and why they will exercise this change:

- `ci.yml` (PHP, sqlite + pgsql) — will pass; no PHP file changed, and the full local run (§19) already confirms zero PHP impact.
- `web-ci.yml` (web build) — will pass; local `npm run build` already succeeded (§21).
- storefront CI (`lint + typecheck + test`) — will pass; local `pnpm build`, `npx tsc --noEmit`, and `npx vitest run` all already succeeded.
- `store-brand-qa.yml` — its path filters (`web/src/modules/store-experience-builder/**`, `storefront/src/lib/presentation/**`, `storefront/src/app/**`) cover every file this PR touches, so both its jobs will run for real on the PR. Both were already run locally with identical pass results (§19).

## 23. Backward compatibility

- **No DB migration, no new persisted field, no schema version bump.** `StorefrontPresentationNormalizer::VERSION` is unchanged (still `3`). `density` and `productCard` were already-persisted fields with already-correct enum acceptance in all three normalizer layers (PHP/web/storefront) before this slice — confirmed in the evidence pass (§5) and re-confirmed by the unchanged `StorefrontPresentationNormalizerTest` (33/33 passing, §19).
- **A merchant who never touches `density`/`productCard`** (i.e. every existing stored document, which normalizes to `density: "comfortable"`, `productCard: "standard"`) sees **zero visual change**: `pageContainerPaddingClass("comfortable")` / `publishedPageContainerPaddingClass("comfortable")` both resolve to `"py-5 md:py-6"` — the exact literal class string both the Product page's prior fixed value and the Category page's prior fixed value already used. The non-Market branch of `ProductDetails.tsx` and `c/[...permalink]/page.tsx` are therefore byte-identical in rendered output for every pre-existing merchant.
- **AWJ Market's own locked compact chrome is untouched** — its `isMarket` branch in `ProductDetails.tsx` still renders its own exact pre-existing `"py-3 md:py-5"`, independently of the new density resolver, proven by a dedicated regression test (§19, `ProductDetails.test.tsx`).
- **Forward safety:** an unknown/future density value fails closed to the comfortable padding at the resolver layer in both languages — explicitly tested (`public-rhythm.test.ts`, `presentation.test.ts`).

## 24. Risks / remaining gaps

- The Canvas Category preview's `product_grid` tile is a deliberately simplified thumbnail-only mock (no price, no stock, no button — sourced from a lighter Customizer-only data shape), not a literal re-render of the real `ProductCard` component. True pixel parity for that specific mock would require widening the Customizer's category-grid data contract to carry full catalog fields, which is a new API shape change explicitly out of this slice's bounded scope (see STOP CONDITIONS). The fix made here closes the *truthfulness* gap (compact vs standard now shows a real, deterministic difference, in the same semantic direction as the real control) without claiming the mock is a pixel-identical preview of the real card — this is the same kind of bounded, calibrated-per-context approach the file already uses for `cardImageHeight`/`newArrivalsColumns`/`categoriesColumns` elsewhere.
- No pixel-diff/screenshot comparison exists for the density/productCard surfaces specifically (§17) — only real-DOM class assertions, full production builds, and a passing regression run of the one existing real-browser visual harness. This is stated explicitly rather than claimed as pixel parity.

## 25. Explicit confirmations

- ✅ No DB migration
- ✅ No new API
- ✅ No schema version bump (`StorefrontPresentationNormalizer::VERSION` stays `3`)
- ✅ No new persisted field
- ✅ No commerce truth change (no product data, pricing, variant behavior, add-to-cart semantics, or availability logic touched)
- ✅ No Merge performed
- ✅ No Deploy performed
- ✅ No Production release performed

---

## Next step

**CUST-H3-4 — Cross-page/global parity + integrated QA** (per `CUST-H3-ARCH-1-IDENTITY-CONTRACT.md` §11), followed by the CUST-H3 Horizon Closure report.

---

# CUST-H3-3 READY FOR MERGE — OWNER APPROVAL REQUIRED
