# AWJ Luxe Motion — Final Visual, Functional, Accessibility & Responsive QA

PR: [#2001](https://github.com/safwan5001-source/Nebrax/pull/2001) · Branch `feat/awj-luxe-motion-theme-foundation` · **Status: `READY_FOR_CHATGPT_FINAL_REVIEW`** (PR stays Draft; not merged, not deployed, theme not published, no tenant data touched)

> **Scope of this task:** QA + fixing defects *demonstrated by tests*. No redesign, no new features, no change to pricing, inventory, payments or order logic.

---

## 1. Executive summary

* AWJ Luxe Motion was exercised in a **real browser (Chromium) against the real, unmodified storefront routes** — home, category/listing, product (simple, variant-managed, unavailable, long-name, no-image), header, footer, bottom nav, quick view, gallery, cart action, wishlist, share — at **390×844, 430×932, 320×568 and 1440×900, in Arabic RTL and English LTR**, plus keyboard, focus, reduced-motion, axe (WCAG 2.2 AA), CLS and image-loading checks.
* The same matrix was re-run against **AWJ Modern** (baseline / isolation) and against a **Luxe preset-only document** (no global theme tokens). Customizer preview ↔ storefront parity was checked in the same browser.
* **3 real defects were demonstrated and fixed** (all with red→green regression tests); **0 Luxe-introduced accessibility violations** remain. One serious axe finding (PDP stock-status contrast) is **pre-existing, shared with AWJ Modern, and out of scope** — documented in §6.2.
* Final local results: Luxe **66/66**, Luxe preset-only **66/66**, Modern baseline **62/62 (+4 Luxe-only tests skipped by design)**, Customizer parity **2/2**; Web **10,464/10,464**, Storefront **3,791 passed**; storefront production build OK.
* **Limitation (explicit):** WebKit/Safari is **not** available in this environment. iPhone coverage is Chromium with iPhone viewport/DPR/touch emulation — it does **not** prove Safari rendering or real-device safe-area behaviour (see §9).

## 2. SHAs

| Item | SHA |
|---|---|
| PR base (`main`) when this task started | `a4d308a` (PR base); `main` had since moved to `88dbeb5` |
| PR head at task start (last verified-green) | `4aeddf0` |
| `main` at final sync | `45f5c1f` (merged into the branch, no conflicts) |
| **Code head verified in this report** | **`ce5146d`** (fixes + tests + QA harness + `main` merge) |
| Final head | `ce5146d` + the docs-only commit that adds this report and `docs/audits/luxe-motion-qa/` (its SHA and CI links are in the PR description; no code differs from `ce5146d`) |

Newer `main` commits (`88dbeb5` partner-statement UI, `45f5c1f` fuel icons, `4cc1bd0` **Buyer Ordering UX** which touches storefront `layout.tsx`/checkout, fuel-ops UI) were reviewed for theme impact: only the Buyer Ordering PR touches storefront chrome; the full browser matrix and unit suites were re-run on the merged tree (§8) and stayed green.

## 3. Method and what is real vs. mocked

| Layer | What was used |
|---|---|
| Storefront | **Real** Next 16 app (`pnpm dev`), real routes `/sa/{ar,en}`, `/products`, `/products/[slug]`, real header/footer/bottom-nav/cart drawer/quick view/gallery/carousel components |
| Backend | `storefront/e2e/support/luxe-motion-api-fixture.mjs` — **mock `store/v1`** (synthetic neutral catalogue, in-memory cart). No merchant branding, no tenant data. Section designs and tokens are copied from the Luxe theme definition (what "Apply theme" writes). **Not** the Laravel backend; no cart/price/stock logic was changed |
| Browser | Chromium 1243 (`/opt/pw-browsers`), Playwright; iPhone = viewport + DPR 2 + `isMobile` + `hasTouch`. **Not WebKit** |
| Customizer preview | **Real `StorefrontPreviewCanvas`** mounted by a dev-only page (`web/src/app/dev/luxe-motion-preview`, 404 in production) with the config `applyTheme()` produces. The preview is an *illustrative canvas*, not the public components |
| Accessibility | axe-core 4.x (`wcag2a/2aa/21aa/22aa`) injected into each page + explicit keyboard/focus/target-size/RTL assertions |

Illustrative vs. interactive: the Customizer canvas is illustrative (no cart, zoom, wishlist, sort). Everything under "published storefront" below is the fully interactive public component tree.

## 4. Test matrix (final run on the merged head — Luxe, full theme tokens)

✅ = passed. Each cell is one Playwright test (own page load, own assertions).

| Page / scenario | 390·ar | 390·en | 430·ar | 430·en | 320·ar | 320·en | 1440·ar | 1440·en |
|---|---|---|---|---|---|---|---|---|
| Home (header, hero, categories, cards, footer, overflow, CLS < 0.1, lazy images, axe, 44px card actions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Home product rail (RTL edge/gap, arrows, tap targets, direction, hit-testing) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Category/listing (grid cols, 2-line clamp, equal-height rows, sort, axe) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDP simple (gallery swap, h1 ≥ 24px, qty 44px, fixed bar vs bottom nav, wishlist, share, add-to-cart → cart API, CLS < 0.15, axe) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDP variant-managed (add gated until option chosen; OOS variant blocked) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDP unavailable (no active purchase action; zero cart writes) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PDP long name / product without image | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Interaction tests (390 touch, ar + en; hover tests on a 1440 desktop-pointer context): quick view dialog (accessible name, focus trap, Escape, **focus return**) ✅✅ · keyboard focus-visible ring on card actions + PDP controls ✅✅ · reduced motion (no infinite animations, no hover lift) ✅✅ · motion enabled (hover treatment per published tokens) ✅✅ · RTL/LTR mirroring of purchase bar ✅✅.

Other result sets: Luxe **preset-only** 66/66 · **AWJ Modern baseline** 62/62 (+4 skipped) — Luxe classes/`text-2xl` title/hover lift are asserted **absent** on Modern (isolation) · **Customizer parity** 2/2.

Axe (24 page runs per preset): **no `critical`; no `aria-hidden-focus`, `button-name`, `target-size`, `label`, `landmark` or `region` violations.** Only `color-contrast` (serious) on the PDP stock-status text — see §6.2. Luxe fails it on 5/8 PDP runs, Luxe preset-only 6/8, **Modern 8/8** (so Luxe is not worse).

Measured target sizes (Luxe, 390): Quick View 44×44 · quantity −/+ 44×44 · Add to cart 54 high · header menu/cart 44×44 · bottom-nav items 98×60 · card CTAs ≥ 44 high · PDP wishlist/share 40×40 · carousel arrows 40×40 · card wishlist 32×32 · Sort 36 high. All ≥ 24 px (WCAG 2.2 SC 2.5.8, enforced by axe `target-size`).

## 5. Visual evidence

Stored in [`docs/audits/luxe-motion-qa/`](docs/audits/luxe-motion-qa/) (48 WebP captures, 1.1 MB; real-browser, real components). Naming: `luxe-{home-top|category-top|pdp-top|rail}-{iphone-390|iphone-430|small-320|desktop-1440}-{ar|en}.webp`, plus
`luxe-pdp-variant-iphone-390-*`, `luxe-pdp-unavailable-iphone-390-*`, `luxe-pdp-noimage-iphone-390-*`, `luxe-quickview-390-*`, `baseline-modern-*-iphone-390-en`, `preset-only-pdp-top-iphone-390-en`, and the side-by-side parity pairs `parity-{product,category}-{published,preview}`.

Visual review notes (Luxe): wine primary on CTAs/prices, serif editorial headings (Lora/Amiri) at 24px/700 on the PDP, bordered gallery frame on a muted surface, 3:4 cards with soft shadow, centred section headings, mirrored chevrons/dialog/quantity order in RTL, fixed purchase bar sits above the bottom nav with no overlap at all four viewports.

## 6. Findings

### 6.1 Confirmed defects — fixed (each: red test first, then fix, then green)

| # | Defect | Evidence (real browser) | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| D-1 | **Quick View drops focus on close** (focus lands on `<body>`; WCAG 2.4.3). Luxe newly exposes Quick View on every card | `quick view…Escape returns focus` failed: `document.activeElement` = `BODY` (mouse and keyboard open) | `QuickView` uses a bare `<button>` beside a *controlled* Radix `<Dialog>` — no `DialogTrigger`; Radix's `onCloseAutoFocus` only refocuses its own trigger ref, which is null | `triggerRef` + `onCloseAutoFocus` → `preventDefault(); triggerRef.focus()` (`QuickView.tsx`) | `QuickView.test.tsx` "returns focus to its trigger…" (red before, green after) + e2e quick-view test ×2 |
| D-2 | **Arabic product rail mis-spaced** — double gap and the rail offset by one gap from the start edge (first slide at 183–350 instead of 207–374 at 390px; 24 px off at all four RTL viewports). Luxe's default "new arrivals" section is a rail, so it is the first thing Arabic shoppers see | `home: product rail` red ×4 (AR): first slide not flush with start edge, gap ≠ Swiper `spaceBetween` | `globals.css` pre-hydration rule `.product-carousel .swiper-slide { margin-right: 24px }` is *physical*; in RTL Swiper also writes inline `margin-left`, so both margins applied | `margin-inline-end` (logical; resolves to the very property Swiper writes in each direction) | `src/app/__tests__/product-carousel-rtl.css.test.ts` (red before/green after) + e2e rail ×8 |
| D-3 | **Rail arrows swallow taps meant for the first card's Quick View.** (a) The start arrow, when "disabled" at the start of the rail, is `opacity-0` but still pointer-active and sits on the first card's bottom-start Quick View; (b) after advancing, the *visible* start arrow covers the first visible card's Quick View (`top-1/2` of the whole slide lands on the bottom band of a tall 3:4 image) | `elementFromPoint` at the Quick View centre returned the "Previous products" button: at rest at 430 px ar/en (hidden arrow) and again after advancing the rail at 430 px ar/en (visible arrow); also at rest at 390 px on the preset-only document | `ProductCarousel` arrows: hidden state had no `pointer-events-none`; arrows anchored at `top-1/2` of image+body | Hidden arrow gets `pointer-events-none` (all themes, pure no-op visually); **Luxe only**: arrows measured onto the card image's vertical centre (`ResizeObserver`), other themes keep `top-1/2` | `ProductCarousel.test.tsx` ×2 (hidden arrow click-through — red before/green after; Luxe anchoring vs default) + e2e hit-test before and after advancing ×8 |

All three touch **presentation/focus/layout only**. No commerce contract, pricing, stock, payment or order path was modified; `ProductCard`/cart logic untouched.

### 6.2 Observations — pre-existing / shared, **not** changed (out of scope; present on the AWJ Modern baseline unless noted)

| # | Observation | Evidence | Why not fixed here | Suggested follow-up |
|---|---|---|---|---|
| O-1 | **PDP stock-status text fails WCAG 1.4.3**: `text-store-success` `#059669` on the store background `#f8f9fa` = **3.57:1** at 12 px (needs 4.5:1) | axe `color-contrast` (serious); Luxe 5/8, preset-only 6/8, **Modern 8/8** PDP runs | Global semantic token shared by every theme; changing it alters all stores | Darken `--store-success` (≈ `#047857`, 5.0:1) in a dedicated, all-theme token task |
| O-2 | **Header store name clipped at ≤ 430 px** (`AWJ QA S…`; in RTL `…J QA Store`, dropping the first letters) | Brand cell is 1/3 of a `1fr minmax(0,1fr) 1fr` mobile grid; identical on Modern | Shared header grid; affects every theme/long wordmark | Give the brand cell more of the row (or `logo-start` layout) |
| O-3 | `DialogContent` close button has hard-coded English `sr-only` "Close" in Arabic UIs | `components/ui/dialog.tsx` | Shared UI primitive | Localise via `next-intl` |
| O-4 | `viewport-fit=cover` is not set, so `env(safe-area-inset-bottom)` (bottom nav, fixed purchase bar offset) resolves to 0 | page `<meta viewport>`; CSS uses `env()` | Benign in Safari browsing; can't be validated without a real iPhone; global layout decision | Decide `viewport-fit` + verify on device |
| O-5 | Prices render via `Intl ar-SA` even on English pages (Arabic-Indic digits, `٢٤٩٫٠٠ ر.س.`), while the Customizer preview shows `SAR 249.00` | PDP/card screenshots vs `parity-product-preview` | Shared catalogue mapper (`mappers.ts` `formatMoney`) — money display, out of scope | Locale-aware formatting + align preview |
| O-6 | On an unavailable PDP the quantity stepper stays enabled beside the disabled "Out of stock" CTA | `pdp-unavailable-*` | Shared PDP behaviour (also Market) | Disable stepper when not purchasable |
| O-7 | Several controls are < 44 px (card wishlist 32, PDP wishlist/share 40, carousel arrows 40, Sort 36 high) | measured | Meet WCAG 2.2 AA (≥ 24); only below Apple's 44 pt guideline; pre-existing sizes | Optional: opt-in `largeHitTarget` as done for Quick View |
| O-8 | Card hover: the published token `cards.hover: "zoom"` (written by *Apply theme*) wins over the card's own `hover:-translate-y-0.5 hover:shadow-lg`; those classes act only on preset-only documents | e2e "motion enabled": tokens ⇒ image zoom, no lift; preset-only ⇒ ≈ 2 px lift | Intentional token-over-preset layering (merchant policy wins) — verified both | Note in theme docs |

## 7. Files changed (this QA task)

Fixes
* `storefront/src/components/products/QuickView.tsx` — focus return (D-1)
* `storefront/src/app/globals.css` — `margin-inline-end` for the carousel slide pre-hydration rule (D-2)
* `storefront/src/components/products/ProductCarousel.tsx` — click-through hidden arrows (D-3a); Luxe image-anchored arrows (D-3b)

Regression tests
* `storefront/src/components/products/__tests__/QuickView.test.tsx` (+1)
* `storefront/src/components/products/__tests__/ProductCarousel.test.tsx` (+2)
* `storefront/src/app/__tests__/product-carousel-rtl.css.test.ts` (new, 2 tests)

QA harness (on-demand; **not** wired into CI; excluded from the default Playwright config)
* `storefront/e2e/luxe-motion-qa.spec.ts`, `storefront/e2e/luxe-motion-preview-parity.spec.ts`
* `storefront/e2e/support/luxe-motion-api-fixture.mjs` (mock `store/v1`, `LUXE_QA_PRESET=luxe|luxe-bare|modern`)
* `storefront/playwright.luxe-qa.config.ts`, `storefront/playwright.config.ts` (testIgnore only)
* `web/src/app/dev/luxe-motion-preview/page.tsx` (dev-only Customizer preview fixture; 404 in production)

Docs: this report, `docs/audits/luxe-motion-qa/*.webp`.

Re-run: `cd web && npm run dev -- -p 3002` (for parity) · `cd storefront && PW_CHROMIUM_PATH=<chromium> pnpm exec playwright test -c playwright.luxe-qa.config.ts` (add `LUXE_QA_PRESET=modern|luxe-bare`). The spec borrows `axe-core` from `web/node_modules`.

## 8. Tests executed and actual results

| Suite | Result |
|---|---|
| Browser — Luxe (full tokens), merged head | **66 passed, 0 failed** |
| Browser — Luxe preset-only | **66 passed, 0 failed** |
| Browser — AWJ Modern baseline | **62 passed, 0 failed**, 4 skipped (Luxe-only by design) |
| Browser — Customizer preview ↔ storefront parity | **2 passed** (h1 size/weight/line-height/family, gallery frame border/radius/bg identical; 3:4 card ratio in both) |
| Storefront — `biome check`, `check:locales`, `check:spree-ratchet`, `tsc --noEmit` | all pass (0 errors) |
| Storefront — Vitest (merged tree) | **3,791 passed**, 16 skipped, 0 failed |
| Storefront — `next build` (production) | compiled successfully |
| Web — Vitest (full) | **879 files / 10,464 tests passed** |
| Web — `next build` (incl. TS) | succeeded |
| Web — Design Token Drift + themes page + App Builder presets + Preview canvas (re-run after `main` merge) | 211 passed |
| Red→green proof | QuickView focus test, carousel CSS guard, carousel arrow click-through test each fail without their fix and pass with it |
| PHP | **No PHP code changed in this task**; full PHP suite (sqlite + pgsql) **passed in CI** on `ce5146d` (§9) |

Earlier in this QA, tests that failed because of *test* mistakes (not product defects) were corrected, not loosened: jsdom-less matchers, `isMobile` inheritance disabling `(hover: hover)`, mismatched RTL bar order assumption, desktop rail `spaceBetween` (20 px) vs assumed 24 px, clipped slides counted as visible controls, axe run while a menu was mid-close. Test-environment lesson: Next 16 `dev` blocks `/_next` resources from `127.0.0.1`, so React never hydrated until the harness used `localhost`.

## 9. Build and CI results (code head `ce5146d`)

| Check | Result | Link |
|---|---|---|
| Web CI | ✅ success | https://github.com/safwan5001-source/Nebrax/actions/runs/41961095871 |
| Storefront CI | ✅ success | https://github.com/safwan5001-source/Nebrax/actions/runs/41961096118 |
| Storefront Docker build context | ✅ success | https://github.com/safwan5001-source/Nebrax/actions/runs/41961096080 |
| Store Brand QA | ✅ success | https://github.com/safwan5001-source/Nebrax/actions/runs/41961095836 |
| CI (PHP sqlite + pgsql + feed-lock perf) | ✅ success | https://github.com/safwan5001-source/Nebrax/actions/runs/41961095908 |
| CI Gate | ✅ success | https://github.com/safwan5001-source/Nebrax/actions/runs/41961095944 |

The earlier transient Docker/Turbopack Google-Fonts fetch failure (see previous recovery report) did not recur.

## 10. Remaining risks and limitations

1. **No WebKit / real iPhone.** Safari-specific rendering, momentum scrolling, dynamic toolbar and real safe-area insets are **unverified**; O-4 makes the safe-area CSS inert anyway. Do a short Safari/iPhone pass before any tenant uses the theme.
2. **Mock backend.** Price, stock, cart, delivery and checkout correctness are the backend's; this QA only proved the storefront drives the existing cart API correctly (one POST, right quantity/variant, none for unavailable products).
3. **Not covered (no authored content/capability in the fixture, by design — no fake merchant data):** hero/banner/slider *media*, gallery sections, personalization and add-ons (FLOWERS gifting blocks), checkout/payment screens, order-tracking, accounts. The `/products/[slug]` page was exercised with simple, variant-managed, unavailable, long-name and image-less products.
4. **Customizer coverage:** the *real canvas* was compared with the storefront through a dev fixture; the authenticated Customizer → Save → Publish → public route flow (needs the Laravel backend) was **not** driven.
5. Shared issues O-1…O-7 remain (pre-existing; O-1 is the only WCAG AA failure and is identical on AWJ Modern).
6. CLS is asserted below thresholds (home < 0.1, PDP < 0.15) rather than recorded as exact values; image-loading is asserted structurally (far-below-fold images `loading=lazy`, ≤ 40 images on home).
7. Layout shift/animation behaviour was verified in dev mode; a production-build pass would be marginally more representative for CLS.

## 11. Final recommendation and next action

**`READY_FOR_CHATGPT_FINAL_REVIEW`.** Luxe Motion is functionally and visually sound across the tested matrix, isolated from AWJ Modern, in parity with the Customizer preview on its design language, and its three demonstrated defects are fixed with regression coverage.

Next actions (human): (1) final review of this PR; (2) short real-Safari/iPhone smoke before merge (limitation 1); (3) open separate, small tasks for O-1 (global success-colour contrast) and O-2 (header brand width) — both pre-existing and all-theme; (4) merge/publish only on explicit approval — nothing here deploys or publishes the theme.
