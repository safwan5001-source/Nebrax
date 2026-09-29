# AWJ Market — Full Theme Completion: Coverage Matrix (Closure Audit)

**Status:** Closure audit of PR #1096, re-classified with strict closure vocabulary
**Base SHA:** `f6ce95a215d82767139332cf14722c5a9b80261a` (`origin/main`)
**Evidence date:** 2026-09-28 (live pass) / 2026-09-29 (closure audit)
**Live reference:** `https://store.shonaksa.com/` (public storefront "أسواق شونة Shona Markets", built on the Salla platform — evidence only, no branding/assets/copy reused)
**Prior context:** `AWJ_MARKET_HORIZON_IMPLEMENTATION_TASK.md`, `AWJ_MARKET_HORIZON_IMPLEMENTATION_REPORT.md` (PR #1084/#1091), `AWJ_MARKET_SHONA_EVIDENCE_GAP_PASS.md` (Master Spec).

## 0. Closure-audit method

This revision re-audits every item this PR's first pass classified as `ALREADY_COMPLETE`, `ADAPTED`, `NOT_APPLICABLE`, `GATED`, or `DEFER/REJECT`, per this repository's closure-audit brief. For each, it independently re-answers: was it actually observed on Shona; is it presentation/composition, a no-new-data interaction, or a platform/business capability; can AWJ implement it honestly from existing data/contracts; does it need new backend data, new persisted schema, new business logic, or fabricated information; and if none of those block it, why was it not implemented.

**Status vocabulary used below** (per the closure-audit brief):
- **IMPLEMENTED** — built or changed in this PR to produce a real Market-specific result.
- **ALREADY MATCHED** — the existing shared AWJ component/contract already satisfies the benchmark evidence; no code change was needed or made.
- **GATED — PLATFORM CAPABILITY** — a genuine missing backend/business authority; the exact missing contract is stated.
- **NOT APPLICABLE** — the benchmark pattern has no AWJ equivalent context (e.g. wholesale-only concepts), with the evidence for why.

No item is left as bare "ADAPTED" or "DEFER" — those labels are folded into one of the four above, with the reasoning kept in the notes.

## 1. Items whose classification changed in this audit

| Item | Prior classification | New classification | Why it changed |
|---|---|---|---|
| Product rail rhythm (Home) | ADAPTED ("denser grid, not a carousel — rejected to avoid preview-parity work") | **IMPLEMENTED** | Re-audited: `ProductCarousel.tsx` already existed, uses the identical `Product[]`/`ProductCard` contract, and preview-parity work was not a valid reason to withhold it. Wired into `NewArrivals.tsx`/`FeaturedShelf.tsx` for Market, with `slidesPerView`/`breakpoints` made configurable so mobile still shows 2 products (never Swiper's own single-card default), preserving the locked two-column-mobile baseline. Preview canvas left as the honest static approximation it already was (a carousel's *motion* can't be usefully represented in a snapshot canvas; its density is unaffected). |
| FAQ / multi-question content | ADAPTED ("static text blocks stand in for the accordion") | **IMPLEMENTED** | Re-audited: `CustomBlock` is already `{id, kind: "heading"\|"paragraph", text}` — the exact shape a merchant produces authoring one FAQ question/answer pair at a time. Grouping consecutive heading+paragraphs into a native `<details>`/`<summary>` disclosure needed no new data, no new business logic, and no fabricated text. Implemented in `CustomContentBand.tsx`, gated to Market and to 2+ question groups (a single heading is ordinary prose, not an FAQ). |
| Product card "quick view" | Not previously audited as a distinct item (folded into "product card anatomy") | **IMPLEMENTED** | Shona's cards show a quick-view (eye icon) affordance the AWJ card had no equivalent for. Built `QuickView.tsx`: a dialog using *only* the fields already in the listing payload (name, image, price/compare-at, purchasable) — zero new fetch, so it does not introduce a per-card or on-open product-detail request. Variant-managed/unpurchasable products fall back to a "view full details" link to the real PDP, exactly like the card's own existing inline action does, rather than pretending to resolve a variant the listing payload cannot see. |
| PDP share affordance | Not previously audited as a distinct item | **IMPLEMENTED** | Shona's PDP shows wishlist + share icons together. AWJ already had wishlist; share was missing entirely. `ShareButton.tsx` shares the current page (`navigator.share`, falling back to clipboard-copy with a toast) — no product data collected, sent, or invented. |
| Hero/masthead density | ALREADY_COMPLETE ("HeroSection reused unchanged") | **IMPLEMENTED** | Re-audited: the *existing* component was reused, correctly — no photography was owed. But its proportions were not re-examined for Market. Shona's masthead cedes space to discovery almost immediately; AWJ Market's Hero now does the same (`min-h-[11rem]→[7rem]` etc.), using only the same headline/subheadline/CTA data as before. |
| Category tile imagery | GATED (assumed, not verified) | **GATED — PLATFORM CAPABILITY (verified)** | Re-audited by reading the actual data path: `AwjCategory` (the raw `store/v1/categories` payload type) has no image field at all (`id, name, description, color, parent_id, children, ancestors`) — confirmed in `src/lib/commerce/types.ts`. Both category-mapping functions in `mappers.ts` hardcode `image_url: null` because there is nothing to map *from*, not because of an oversight. This is a genuine backend data gap, not a wiring gap: adding it needs a new category-image field server-side plus a merchant upload UI, both outside this Horizon. |
| Announcement/promo strip | GATED ("no persisted field") | **GATED — PLATFORM CAPABILITY (verified, dependency stated)** | Re-audited the full `StorefrontPresentationConfig` shape field-by-field (version, themePreset, colors, font, density, radius, productCard, branding, header, homepage{sections,heroHeadline,heroSubheadline}, footer, contact, whatsapp, social, verification, sbc, apps, pages). None is a site-wide, above-header announcement field; `footer.tagline` and `homepage.heroHeadline` are both scoped to the wrong page location to reuse honestly. Implementing it needs a new field added to the server-authoritative PHP normalizer plus both TS mirrors — a schema/contract change this frontend-only closure Horizon does not make unilaterally (see §4). |
| Payment-method trust logos | GATED | **GATED — PLATFORM CAPABILITY (unchanged)** | Re-confirmed: no presentation field records which payment methods a given tenant actually accepts. Displaying Apple Pay/Visa/mada marks without that would be an unsupported payment-method claim, explicitly forbidden by the Master Spec regardless of theme. |
| Global shell (Header/CategoryNav/MobileBottomNav/Footer) | ALREADY_COMPLETE | **ALREADY MATCHED (verified by re-reading the rendered output, not just the component name)** | Re-read `Header.tsx`, `MobileBottomNav.tsx`, and the cart page in full rather than trusting the earlier summary. Findings: AWJ's search is already full-width and prominent at every breakpoint (not a small icon); the header's own doc comment records it was already benchmarked against "the reference" and two affordances (wishlist total, cart total) were deliberately left out for lacking real data — the same honesty standard this audit is applying, already applied here before. `MobileBottomNav` is an explicitly locked, cross-theme baseline per the Master Spec. No Market-specific gap found on re-reading the actual rendered structure. |
| Cart page sticky checkout bar | Not previously audited as a distinct item | **ALREADY MATCHED — deliberate, documented architectural constraint** | The cart page's own doc comment states mobile deliberately has no second fixed bar because `MobileBottomNav` already occupies that space, and a second one would either overlap it or push it off the safe area — the identical class of conflict this same closure pass solved for the PDP by measuring `MobileBottomNav`'s own height and pinning above it. Applying that same fix to the cart page was evaluated and is unnecessary: the cart is a short, finite list the shopper reaches the end of, and its summary/checkout action already sits inline at the natural scroll-end. No fixed-bar addition was made here. |

## 2. Full coverage table (post-audit)

### 2.1 Global shell

| Item | Status | Evidence / dependency |
|---|---|---|
| Header search prominence | ALREADY MATCHED | `Header.tsx`: full-width search on desktop (`md:flex-1`), wraps to its own full-width row on mobile. Matches Shona's full-width search+location pill in structure (location itself is gated, see below). |
| Branch/location selector | GATED — PLATFORM CAPABILITY | No public multi-location contract; browser-selected `warehouse_id` must never become authority (Master Spec §16). Re-confirmed live: Shona persists the choice via `?scope=`. |
| Category nav rail | ALREADY MATCHED | `CategoryNav.tsx` — scrollable pill rail, already generic and dense. |
| Mobile bottom navigation | ALREADY MATCHED | Locked, cross-theme baseline (Master Spec). Same 4-slot structure as Shona's (different specific destinations, functionally equivalent). |
| WhatsApp floating button | ALREADY MATCHED | `StoreWhatsApp.tsx`, unchanged. |
| Footer (contact/social/app/policy) | ALREADY MATCHED | `Footer.tsx`, unchanged, fully merchant-configurable already. |
| Announcement/promo strip | GATED — PLATFORM CAPABILITY | No presentation field exists for it; adding one is a normalizer/schema change (see §1, §4). |
| Payment-method trust logos | GATED — PLATFORM CAPABILITY | No per-tenant accepted-payment-methods field; would otherwise be an unsupported claim. |

### 2.2 Home

| Item | Status | Evidence / dependency |
|---|---|---|
| Hero/masthead | IMPLEMENTED | `HeroSection.tsx` — Market-specific tighter `min-h`/padding; same headline/subheadline/CTA data, no new content. |
| Category discovery density | IMPLEMENTED | `CategoriesSection.tsx` — 12→18 tile ceiling, `grid-cols-3 sm:4 lg:6 xl:8` (vs. Modern's `2/3/4/6`), tighter gap/padding, subcategory count hidden for scan speed. |
| Category tile imagery | GATED — PLATFORM CAPABILITY | `AwjCategory` (raw API type) carries no image field at all — verified in `types.ts`/`mappers.ts`. |
| Product rails ("new arrivals", "featured") | IMPLEMENTED | `NewArrivals.tsx`/`FeaturedShelf.tsx` now render via `ProductCarousel` for Market (2/3/5 slides, never Swiper's 1-slide default on mobile), matching Shona's horizontally-scrollable rail. |
| Compare-at/sale badge on rails | GATED — PLATFORM CAPABILITY | `original_price`/`compare_at` never populated platform-wide; `ProductCard`'s existing dormant sale-badge branch stays inactive until real data exists. |
| Payment trust band | GATED — PLATFORM CAPABILITY | See §2.1. |
| Brand/lifestyle banner | ALREADY MATCHED | `BannerBand` (already implemented, merchant-authored `imageUrl`/copy); not forced on by Market's starting bundle. |
| FAQ | IMPLEMENTED | `CustomContentBand.tsx` — native `<details>`/`<summary>` accordion for Market when 2+ heading-led question groups exist; unchanged (flat) otherwise and for every other theme. |
| Testimonials/reviews carousel | GATED — PLATFORM CAPABILITY | No reviews/testimonials persistence, moderation, or identity contract exists anywhere in AWJ. |
| Store location/map | GATED — PLATFORM CAPABILITY | No safe structured map contract; arbitrary iframe/HTML forbidden outright. `contact.address` (already rendered by `Footer.tsx`) is the honest substitute. |
| "N+ satisfied customers" stat | GATED — PLATFORM CAPABILITY | No aggregate/customer-count contract to source a real number from. |
| Benefits/trust band | ALREADY MATCHED | `benefits` section, already implemented, merchant-authored claims. |
| App promotion | ALREADY MATCHED | `appPromo` section, already implemented. |
| Offers home section | GATED — PLATFORM CAPABILITY | `GATED_HOME_SECTION_KEYS = ["offers"]`, unchanged; no authoritative discount contract. |

### 2.3 Catalog / Category / Search

| Item | Status | Evidence / dependency |
|---|---|---|
| Grid density | IMPLEMENTED | `InfiniteProductList.tsx`/`ProductGrid.tsx` — `sm:3 lg:4 xl:5` for Market vs. unchanged `2/3/4` for Modern. |
| Sort (name/price/date) | ALREADY MATCHED | Existing server-side sort, unchanged; not a benchmark-driven gap. |
| Faceted filters | GATED — PLATFORM CAPABILITY | No server-authoritative facet contract; client-side faceting over a partial page explicitly rejected by the Master Spec. |
| Search results | ALREADY MATCHED | `/products?query=` reused — both AWJ and Shona treat search as a filtered listing, not a bespoke page. |
| Empty/no-results state | ALREADY MATCHED | Existing honest empty-state copy; not separately observable live on Shona (NOT OBSERVED there). |

### 2.4 Product cards

| Item | Status | Evidence / dependency |
|---|---|---|
| Image density/proportions | ALREADY MATCHED (from PR #1084) | `h-28/32/40` (Market) vs. `h-36/44/52` (Modern) — pre-existing from the prior Horizon, unchanged here. |
| Sale badge / compare-at | GATED — PLATFORM CAPABILITY | Same platform gap as home rails; card already has the dormant branch. |
| Wishlist | ALREADY MATCHED | `WishlistButton`, unchanged, shared across themes (DESIGN_ONLY/GATED persistence, pre-existing). |
| Quick view | IMPLEMENTED | `QuickView.tsx` — Market-only, zero new data fetch, honest fallback for variant-managed/unavailable products. |
| Price hierarchy / availability / add-to-cart | ALREADY MATCHED | Unchanged, already theme-agnostic and matches the benchmark's information hierarchy. |
| Purchase count / ratings on card | GATED — PLATFORM CAPABILITY | Same as PDP (below) — no aggregation contract. |

### 2.5 PDP

| Item | Status | Evidence / dependency |
|---|---|---|
| Media/title/category/price/availability | ALREADY MATCHED | Existing `ProductDetails.tsx`/`MediaGallery.tsx`, unchanged data contract. |
| Container density | IMPLEMENTED | `py-5 md:py-6` → `py-3 md:py-5` for Market. |
| Mobile sticky purchase bar | IMPLEMENTED | Existing quantity/add-to-cart row repositioned `fixed` above `MobileBottomNav` below `md`, `static` at `md`+, for Market — one control, not duplicated (asserted by test). |
| Wishlist + share icon pair | IMPLEMENTED | `ShareButton.tsx` added beside the existing `WishlistButton`, Market-only; shares the current URL only. |
| Ratings/reviews | GATED — PLATFORM CAPABILITY | No reviews persistence/moderation/identity contract anywhere in AWJ. |
| Purchase count | GATED — PLATFORM CAPABILITY | No privacy-safe aggregation contract. |
| Model/barcode-like identifier | REJECTED (not relabeled) | AWJ's public `sku` is shown under its own honest label; relabeling it as a barcode/model number would misstate its semantics, explicitly forbidden. |
| Loyalty-points banner | NOT APPLICABLE | No AWJ loyalty/points program exists at all — this is a business-model absence, not a theme decision. |
| Related/"you might like" products | GATED — PLATFORM CAPABILITY | No authoritative recommendation contract; would otherwise be an invented pairing. |
| Express/wallet checkout button | NOT APPLICABLE | Already exists as a separate, already-scoped capability (`ExpressCheckoutButton`, Spree/wholesale-only) — not a PDP presentation gap to close here. |

### 2.6 Cart

| Item | Status | Evidence / dependency |
|---|---|---|
| Populated line (thumb/name/price/compare-at) | ALREADY MATCHED | `CartLine.tsx`, structurally unchanged — money-critical, shared with checkout review/order confirmation. |
| Row density | IMPLEMENTED | `py-4`→`py-3` for `page`/`drawer` densities, Market only; zero logic touched. |
| Empty cart | ALREADY MATCHED | Existing `CartEmptyState`. |
| Mobile sticky checkout bar | ALREADY MATCHED — deliberate constraint | See §1: a second fixed bar would fight `MobileBottomNav`'s safe area; the cart's own architecture doc explains why the inline summary is the correct choice, the same reasoning this Horizon itself applied to solve the analogous PDP conflict. |
| Checkout continuity | ALREADY MATCHED | Dedicated `(store-checkout)` shell, unchanged; out of this Horizon's authority per the Master Spec (§H). |

### 2.7 Offers

| Item | Status | Evidence / dependency |
|---|---|---|
| Dedicated `/offers` route | GATED — PLATFORM CAPABILITY | Live evidence confirms Shona's own Offers page is a plain grid filtered on `compare_at`, a field AWJ never populates anywhere. No route was added; building one without the pricing contract would mean fabricating discounts. |

## 3. Capability gates — final list with exact dependency

Every item below remains gated because a **named, verified** platform/business capability is missing — none is gated merely because AWJ Modern lacks the component:

1. **Multi-location/branch selection** — no public contract enumerating customer-visible locations with per-location availability; browser-selected warehouse must never become authority.
2. **Authoritative offers/compare-at pricing** — `original_price`/`compare_at` never populated by any AWJ surface; confirmed unchanged this Horizon.
3. **Ratings/reviews** — no persistence, moderation, or verified-purchase identity contract anywhere in AWJ.
4. **Purchase-count social proof** — no privacy-safe aggregation contract.
5. **Related/recommended products** — no authoritative recommendation contract.
6. **Category tile imagery** — the raw `AwjCategory` API type has no image field (verified in source, not assumed).
7. **Site-wide announcement/promo strip** — no persisted presentation field; adding one is a PHP-normalizer + dual-TS-mirror schema change, out of this frontend-only Horizon's authorized scope.
8. **Payment-method trust marks** — no per-tenant accepted-payment-methods field; displaying marks would be an unsupported claim.
9. **Structured/interactive map** — no safe map contract; arbitrary iframe/HTML forbidden outright.
10. **"N+ customers" trust stat** — no aggregate customer-count contract.
11. **Loyalty/points program** — does not exist in AWJ at all (business-model absence, not a theme gap).
12. **Faceted catalog filtering** — no server-authoritative facet contract.
13. **Public barcode/GTIN** — internal data exists but is deliberately not exposed/relabeled; AWJ's public `sku` remains correctly labeled as itself.

None of these was activated, faked, or simulated.

## 4. Why the announcement strip and category imagery were not force-implemented

Both are visually real, observed Shona patterns. Both were seriously re-considered against the closure-audit's own test ("could AWJ implement this honestly using existing data/contracts?") and both failed it for a **verified, named** reason rather than convenience:

- **Category imagery** needs a new field in the *backend* category domain model (`AwjCategory` has none) plus a merchant-facing upload UI — a data-model change, not a frontend composition choice.
- **Announcement strip** needs a new field in the *server-authoritative* `StorefrontPresentationConfig` (validated in PHP, mirrored in two TypeScript files) — a persisted-contract change, which this closure audit's own scope boundary ("do not change database schema … unless you stop and report") correctly withholds from a frontend-only PR.

Both are recorded here with their exact dependency so a future, explicitly-scoped Horizon can pick either up without re-deriving why they were deferred.
