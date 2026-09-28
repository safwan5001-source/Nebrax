# AWJ Market — Full Theme Completion: Coverage Matrix

**Status:** Evidence and implementation matrix for the Full Theme Completion Horizon
**Base SHA:** `f6ce95a215d82767139332cf14722c5a9b80261a` (`origin/main`)
**Evidence date:** 2026-09-28
**Live reference:** `https://store.shonaksa.com/` (public storefront "أسواق شونة Shona Markets", built on the Salla platform — evidence only, no branding/assets/copy reused)
**Prior context:** `AWJ_MARKET_HORIZON_IMPLEMENTATION_TASK.md`, `AWJ_MARKET_HORIZON_IMPLEMENTATION_REPORT.md` (PR #1084/#1091 — preset registration + starting bundle + `PublishedThemeMarker` seam + `ProductCard` image-height only), `AWJ_MARKET_SHONA_EVIDENCE_GAP_PASS.md` (Master Spec).

## 1. What changed since the prior Horizon report

The prior Horizon's live-evidence pass was blocked by network policy (`store.shonaksa.com` was denied). This Horizon confirmed live access (`HTTP 200`) and performed a real Playwright/Chromium pass: desktop 1440px and mobile 390px, with intermediate 768/1024 spot checks, across Home (full page, all sections), Category listing, a simple-product PDP (with reviews/ratings/related-products), the Offers/`التخفيضات` page, Search results, and a cart add-to-cart/empty-cart flow. The branch/location selector (`salla-modal`, "أنت تتسوق من فرع جابر") was handled through the live UI (confirm click) before capturing evidence, per the task's evidence-quality requirement.

It also found the baseline had drifted since PR #1084/#1091: `banner`/`featured`/`benefits`/`appPromo`/`customContent` home sections are now fully implemented (only `offers` remains gated), and a "Theme Gallery" (`web/src/app/(commerce)/commerce/themes/page.tsx`) now lets a merchant apply the Market preset from a gallery card via the same `presetSelectionPatch()` seam. Neither changes this Horizon's scope — Market's starting bundle never writes `homepage.sections`, and the Gallery is a metadata-only consumer of the same closed `THEME_PRESETS` enum — but both are recorded here since the Master Spec's "Exact Change Map" predates them.

## 2. Live evidence — what was actually observed

Captured via real Chromium (not inferred): `screens/{home,category,pdp-tomato,offers,cart,search}-{desktop,mobile}-seg*.png` (session-local, not committed — this matrix records the findings).

| Surface | Desktop (1440) | Mobile (390) | Key structural findings |
|---|---|---|---|
| Home | ✅ full page | ✅ full page | Hero (proprietary model+grocery-box photo, not reusable) → **huge multi-row category discovery grid** (24 tiles, 4 cols, before any product rail) → payment-method trust band (Apple Pay/Visa/mada logos) → brand/lifestyle banner → **carousel-style product rails** with prev/next chevrons and real compare-at pricing → FAQ accordion → testimonials carousel (avatar+stars+quote) → embedded map/location card → "6944+ عميل راضٍ" trust stat → 3-icon benefits band → footer (contact/social/app links) |
| Category listing | ✅ | ✅ | Breadcrumb + h1, 4-col product grid (desktop) / 2-col (mobile). No visible facet/filter UI above the fold; category filter/sort exist per the Master Spec's prior repository pass |
| PDP (simple product, "فلين طماطم كبير") | ✅ full page | ✅ | Title → category tag → **star rating (4.6, 47 reviews) with a full ratings breakdown and verified-buyer comment list** → price (compare-at + sale) → availability dot → wishlist/share icons → **"334+ purchase count"** → **"242 رقم الموديل" (model number)** → loyalty-points banner → quantity + Buy Now / Add to Cart → Apple Pay express button → description → SKU/options table → **review pagination ("عرض المزيد")** → **"منتجات قد تعجبك" related-products carousel**. Mobile: identical content, plus a **sticky bottom bar** (qty stepper + Apple Pay + Buy Now + cart icon) |
| Offers (`/offers`, "التخفيضات") | ✅ | — | Plain product grid, same card component as category — no bespoke offers UI, just a discount-filtered listing |
| Search (`/products?query=…`) | — | ✅ | `h1` "البحث عن (حليب)", same grid/card as category — confirms search is a filtered listing, not a distinct surface |
| Cart | ✅ | — | Populated: thumbnail + name + price/compare-at + running total. Empty: centered lock icon + "سلتك فارغة" + "العودة إلى الرئيسية" |
| Global shell | ✅ | ✅ | Announcement marquee strip (repeating "Shona Markets"), combined search+branch-location pill, WhatsApp floating button, 4-item mobile bottom nav (بحث / تسجيل الدخول / السلة / الرئيسية) |

## 3. Coverage matrix

Status legend — **Capability:** EXISTING / WIRING_GAP / PARTIAL / MISSING / THEME_ONLY / DEFER-REJECT. **Implementation:** IMPLEMENT / ALREADY_COMPLETE / GATED / NOT_APPLICABLE.

### 3.1 Global shell

| Item | Observed (Shona) | AWJ translation decision | Capability | Implementation | Evidence / notes |
|---|---|---|---|---|---|
| Announcement/promo strip | Repeating marquee banner above header | No AWJ presentation field for a site-wide announcement bar exists | MISSING (schema) | NOT_APPLICABLE this Horizon | Would need a new persisted field across 3 normalizers (PHP + 2 TS). Decorative, not structural — deferred; see §6 |
| Header: logo/search/account/cart | Combined search+location pill, logo centered | AWJ's `Header.tsx` already has logo/search/account/cart + `header.style=compact` (hides utility strip) | EXISTING | ALREADY_COMPLETE | No code change; `compact` already applies under Market's starting bundle |
| Branch/location selector | Modal + persistent pill showing selected branch | Forbidden by the Master Spec (§16): no public multi-location contract, browser-selected warehouse must never become authority | MISSING (platform) | GATED | Confirmed again live: Shona lets the shopper pick between "فرع جابر"/"فرع طويق" and persists it via `?scope=`. AWJ correctly does not imitate this |
| Category nav rail | Horizontal scrollable pill rail, paging chevrons | AWJ's `CategoryNav.tsx` already does this generically | EXISTING | ALREADY_COMPLETE | No theme-specific change; not preset-aware and doesn't need to be — it's already dense/scrollable |
| Mobile bottom nav | 4 items: بحث / تسجيل الدخول / السلة / الرئيسية | AWJ's `MobileBottomNav.tsx` (locked, shared) | EXISTING | ALREADY_COMPLETE | Item set/order differs slightly (AWJ: home/shop/cart/account) but this is a locked, cross-theme baseline per the Master Spec — not a Market-specific decision to make |
| WhatsApp floating button | Not observed as floating on Shona (contact only in footer) | AWJ already has `StoreWhatsApp.tsx` | EXISTING | ALREADY_COMPLETE | No change |
| Footer (contact/social/app/policy) | Contact icons row, app badges, social icons, legal/VAT text | AWJ's `Footer.tsx` already covers this via the presentation contract | EXISTING | ALREADY_COMPLETE | No change |
| Payment-method trust logos (Apple Pay/Visa/mada) | Confirmed | No AWJ presentation field asserts which payment methods a given merchant actually accepts | MISSING (would be an unverified claim) | GATED | Showing payment marks the merchant may not actually support would violate the Master Spec's "no unsupported payment claims" rule |

### 3.2 Home

| Item | Observed (Shona) | AWJ translation decision | Capability | Implementation | Evidence / notes |
|---|---|---|---|---|---|
| Hero/banner | Proprietary lifestyle photography + marketing tagline | AWJ's `HeroSection.tsx` (existing, no fabricated imagery — see its own doc comment) | EXISTING | ALREADY_COMPLETE | Reused as-is; Shona's photography is not reproduced |
| Category discovery density | ~24 photographic tiles, 4 cols, dominates above-the-fold | `CategoriesSection.tsx`: raised the Market tile ceiling (12→18) and grid (`grid-cols-2…xl:grid-cols-6` → `grid-cols-3…xl:grid-cols-8`, tighter `gap-2`, `px-3 py-2.5` tiles, subcategory count hidden) | EXISTING (data) / THEME_ONLY (density) | **IMPLEMENT — done** | `CategoriesSection.tsx`, `page.tsx` (threads `themePreset`), mirrored in `StorefrontPreviewCanvas.tsx`. No per-category imagery added — AWJ has no category-image contract; text+colour tiles are the deliberate, honest translation |
| Product rails ("طازجة يومياً", "أحدث المنتجات") | Carousel with prev/next chevrons, compare-at pricing | `NewArrivals.tsx`/`FeaturedShelf.tsx`: denser desktop grid (`lg:grid-cols-4`→`lg:grid-cols-5` for Market) | EXISTING (data) / THEME_ONLY (density) | **IMPLEMENT — done (grid, not carousel)** | A literal Swiper-carousel port was considered and rejected: it would require re-deriving the exact preview/published parity work the prior Horizon spent 7 review rounds on for one dimension (image height) across a second dimension (slides-per-view vs. columns), for a component (`ProductCarousel.tsx`) that already exists but is unused. The denser static grid captures the same "more products, faster scanning" intent with materially lower regression risk. Recorded as **ADAPTED**, not **MATCHED** |
| Compare-at/sale badge on rails | Real strikethrough pricing on ~40% of products observed | AWJ's `original_price`/`compare_at` is never populated platform-wide (confirmed unchanged this Horizon) | MISSING (platform) | GATED | No fake discount was added; `ProductCard`'s existing dormant sale-badge branch stays inactive until real data exists |
| Payment trust band | Apple Pay/Visa/mada logos with decorative leaves | No verified per-merchant payment-method contract | MISSING | GATED | See §3.1 |
| Brand/lifestyle banner | Full-bleed proprietary photography + tagline | AWJ's `BannerBand` (already implemented, merchant-authored `imageUrl`/copy) | EXISTING | ALREADY_COMPLETE | Available to any merchant via the Customizer; Market's starting bundle does not force it on (per §29's "never auto-enable" rule extended to non-gated-but-optional sections too) |
| FAQ | Accordion, 3 questions shown | AWJ's `customContent` section (generic authored blocks) can carry this | EXISTING | ALREADY_COMPLETE (as a capability merchants can use, not Market-specific) | No accordion *interaction* exists in `CustomContentBand` today — it renders static text blocks. Recorded as **ADAPTED**: the content slot exists, the accordion micro-interaction does not. Building a real accordion for one content type was judged out of proportion to this Horizon's density-focused scope |
| Testimonials/reviews carousel | Avatar + 5-star + quote + carousel nav | No AWJ reviews/testimonials capability exists (see §3.4) | MISSING (platform) | GATED | Same root gap as PDP reviews — not theme-only |
| Store location/map | Embedded interactive map + address card | Master Spec explicitly forbids arbitrary iframe/HTML; no safe structured map contract exists | MISSING (platform) | GATED | AWJ's existing `contact.address` text field is the honest substitute — already rendered by `Footer.tsx` |
| "N+ satisfied customers" trust stat | "6944+ عميل راضٍ" | No AWJ aggregate/customer-count contract | MISSING (platform) | GATED | Would be a fabricated number without a real source |
| Benefits/trust band (3 icons) | "أسعار تنافسية" / "توصيل سريع" / "منتجات محلية" | AWJ's `benefits` section (already implemented, `BenefitsBand`) | EXISTING | ALREADY_COMPLETE | Merchant-authored claims, not fabricated ones — matches the Master Spec's requirement exactly |
| App promotion | Not prominently observed on Home (footer only) | AWJ's `appPromo` section (already implemented) | EXISTING | ALREADY_COMPLETE | No change needed |
| Offers home section | N/A (Shona's home doesn't surface a dedicated "offers" band either — offers is its own page) | `GATED_HOME_SECTION_KEYS = ["offers"]`, unchanged | MISSING (platform) | GATED | Consistent with both the benchmark and the existing gate |

### 3.3 Catalog / Category / Search

| Item | Observed (Shona) | AWJ translation decision | Capability | Implementation | Evidence / notes |
|---|---|---|---|---|---|
| Grid density | 4 cols desktop, 2 cols mobile — same as AWJ's existing default | `InfiniteProductList.tsx` + `ProductGrid.tsx`: Market gets `sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` (earlier 3-up ramp, one more column at `xl`) vs. unchanged Modern `lg:grid-cols-3 xl:grid-cols-4` | EXISTING (data) / THEME_ONLY (density) | **IMPLEMENT — done** | Client components read `usePublishedThemeMarker()` directly (no prop drilling needed — both are already `"use client"`) |
| Category/name/date/price sort | Not visibly exposed above the fold on Shona | AWJ's existing server-side sort (unchanged) | EXISTING | ALREADY_COMPLETE | No UI change; not a benchmark-driven gap |
| Faceted filters | None observed on the live grid (assumed exists per nav categories only) | Master Spec explicitly forbids fake client-side facets | MISSING (platform) | GATED | Unchanged from the Master Spec's prior classification |
| Search results | `/products?query=` reused, no dedicated search UI/autocomplete on Shona beyond the same grid | AWJ's existing `/products?query=` path (unchanged) | EXISTING | ALREADY_COMPLETE | MATCHED — both platforms treat search as a filtered listing, not a bespoke page |
| Empty/no-results state | Not separately observed (not tested with a zero-result query) | AWJ's existing empty-state copy | EXISTING | ALREADY_COMPLETE | NOT OBSERVED on Shona; AWJ's own honest empty state stands |

### 3.4 PDP

| Item | Observed (Shona) | AWJ translation decision | Capability | Implementation | Evidence / notes |
|---|---|---|---|---|---|
| Media/title/category/price/availability | Full gallery, breadcrumb, compare-at pricing, green "متوفر" dot | AWJ's existing `ProductDetails.tsx`/`MediaGallery.tsx` (unchanged data contract) | EXISTING | ALREADY_COMPLETE | MATCHED structurally; AWJ's compare-at stays inactive until real data exists (see §3.2) |
| Ratings/reviews (4.6★, 47 reviews, breakdown, verified-buyer comments) | Confirmed, rich | No AWJ reviews/ratings capability — persistence, moderation, verified-purchase identity all missing platform-wide | MISSING (platform) | GATED | Exactly the gap the Master Spec (§18/§19) already flagged; reconfirmed with fresh, detailed live evidence (star breakdown, "95.74% أوصوا بالمنتج", named verified-buyer comments) |
| Purchase count ("334+") | Confirmed on the observed PDP | No privacy-safe aggregation contract | MISSING (platform) | GATED | Unchanged |
| Model number ("242 رقم الموديل") | Confirmed, labelled distinctly from SKU | AWJ exposes public SKU only; must not relabel it as a model/barcode number | EXISTING (SKU) / MISSING (model/barcode) | REJECTED (as a relabel) | AWJ's `sku` field is shown correctly under its own label; no field was renamed to imply a barcode/model semantics it doesn't carry |
| Loyalty-points banner | Confirmed ("اكسب +1 نقطة ولاء…") | No AWJ loyalty/points program exists at all | MISSING (platform) | NOT_APPLICABLE | Out of Commerce's scope entirely, not a theme decision |
| Quantity + Buy Now / Add to Cart | Confirmed, plus Apple Pay express button | AWJ's existing `QuantityPickerField`/add-to-cart (unchanged authority) | EXISTING | ALREADY_COMPLETE | Express/wallet checkout is a separate, already-scoped capability elsewhere in the codebase (`ExpressCheckoutButton`, Spree-only) — not duplicated here |
| **Mobile sticky purchase bar** | Confirmed: fixed bottom bar with qty + Buy Now + cart icon | `ProductDetails.tsx`: the *existing* quantity/add-to-cart row becomes `fixed` (pinned above `MobileBottomNav`, same `bottom: calc(var(--store-bottom-nav-height)+env(safe-area-inset-bottom))` technique `StoreWhatsApp.tsx` already uses) below `md`, `static` at `md` and up, for Market only | THEME_ONLY | **IMPLEMENT — done** | One repositioned control, not a duplicated one (verified by a dedicated test asserting exactly one "addToCart" button renders). AWJ Modern is unaffected (no `PublishedThemeMarkerProvider` override → static row, unchanged) |
| Related/"you might like" products | Confirmed, carousel of unrelated categories | Master Spec explicitly gates "arbitrary related/recommended products" without an authoritative contract; AWJ has no such contract | MISSING (platform) | GATED | Not implemented — would be an invented recommendation, not a real one |
| Review pagination ("عرض المزيد") | Confirmed | Same root gap as reviews | MISSING (platform) | GATED | — |

### 3.5 Cart

| Item | Observed (Shona) | AWJ translation decision | Capability | Implementation | Evidence / notes |
|---|---|---|---|---|---|
| Populated line (thumb/name/price/compare-at) | Confirmed | AWJ's `CartLine.tsx` (shared across drawer/page/checkout-summary/order-confirmation) | EXISTING | ALREADY_COMPLETE | No structural change — money/quantity logic is money-critical and was not touched |
| Row density | Not materially denser than AWJ's default on Shona's own cart page | `CartLine.tsx`: `py-4`→`py-3` for `page`/`drawer` densities under Market only, via `usePublishedThemeMarker()` | THEME_ONLY | **IMPLEMENT — done** | Deliberately narrow: only a padding class changed, nothing in `CartLineView`, the adapters, or quantity/remove handlers |
| Empty cart | Confirmed: centered lock icon + "سلتك فارغة" + CTA | AWJ's existing `CartEmptyState` | EXISTING | ALREADY_COMPLETE | MATCHED |
| Checkout continuity | Not investigated beyond the cart→checkout link (checkout authority is out of scope) | AWJ's dedicated `(store-checkout)` shell (unchanged) | EXISTING | ALREADY_COMPLETE | Per the Master Spec (§H), checkout does not consume theme tokens today and this Horizon does not add that wiring |

### 3.6 Offers

| Item | Observed (Shona) | AWJ translation decision | Capability | Implementation | Evidence / notes |
|---|---|---|---|---|---|
| Dedicated `/offers` route | Confirmed: plain grid filtered to discounted products | AWJ has no `/offers` route and no `compare_at`-populated data to filter on | MISSING (platform) | GATED | Live evidence closes the remaining ambiguity from the original Master Spec: Shona's Offers page has **no bespoke UI** beyond the shared grid — it is purely a data filter AWJ cannot honestly reproduce without the missing pricing contract. No route was added |

## 4. Customizer / Theme Gallery / publish lifecycle

No new persisted `StorefrontPresentationConfig` field was introduced by this Horizon — every change here is driven off the **already-persisted** `themePreset` value, read either as an explicit prop (server components: `CategoriesSection`, `NewArrivalsSection`/`NewArrivals`, `FeaturedShelf`) or via the existing `usePublishedThemeMarker()` context seam (client components: `InfiniteProductList`, `ProductGrid`, `ProductDetails`, `CartLine`). Consequences:

- Draft/Publish/normalization/tenant-isolation code paths are **untouched** — no new normalizer field, no new request-envelope key, nothing to add to `StorefrontPresentationNormalizer.php`.
- The Theme Gallery (`web/src/app/(commerce)/commerce/themes/page.tsx`) and `presetSelectionPatch()` continue to work exactly as before; this Horizon changed no file under `web/src/modules/commerce-workspace/`.
- The one `web/` file this Horizon *did* touch, `StorefrontPreviewCanvas.tsx`, mirrors the real components' new density classes using the same "resolve-from-simulated-`viewport`" technique the file already established for `cardImageHeight`/`newArrivalsColumns` (see that file's own doc comments) — extended to the categories grid, which had never received that fix and still used un-resolved `sm:`/`lg:`/`xl:` prefixes. This closes a latent preview/published mismatch for categories, not just a Market-specific one.

## 5. Backward compatibility

- Every new branch is `themePreset === "awj-market"`-gated; the `else`/default path is byte-identical to pre-Horizon code in every touched file (verified by full test-suite runs before and after, see the final report).
- `DEFAULT_PRESENTATION_CONFIG` / `defaultConfig()` were not touched — no-presentation and non-Market stores render exactly as before.
- `CategoryTile` was changed from a private to an exported function (for the `/dev/market-visual` fixture to reuse it) — a visibility change only, no behavior change to existing callers.

## 6. Explicitly deferred (not silently dropped)

These were identified from fresh live evidence but judged out of this Horizon's bounded, density-focused scope; each is a candidate for a separately scoped follow-up, not a platform capability gap:

1. **Site-wide announcement/promo strip** — would need a new persisted presentation field (schema change across 3 normalizers), which this Horizon's "presentation-only, no new persisted field" discipline intentionally avoided.
2. **FAQ accordion interaction** — the content slot (`customContent`) exists; the expand/collapse micro-interaction does not.
3. **Product-rail carousel (Swiper)** — `ProductCarousel.tsx` exists and is unused; wiring it into the homepage rails was rejected this Horizon in favor of the lower-risk denser static grid (see §3.2). A future Horizon could revisit this with its own dedicated preview-parity work.

## 7. Non-negotiable gates re-confirmed by live evidence (no change from the Master Spec)

Multi-location/branch selector, authoritative offers/compare-at pricing, persistent wishlist, ratings/reviews, purchase-count social proof, public barcode/GTIN beyond SKU, structured/interactive map, faceted filtering, search suggestions, unsupported payment-method claims, arbitrary related-product recommendations, loyalty/points programs. None were activated, faked, or simulated.
