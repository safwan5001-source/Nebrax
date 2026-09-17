# STORE-UI-2 — AWJ Store Homepage Experience — Implementation Report

## 1. Status

Implemented, validated and pushed, including the **final product-owner visual
polish pass** (§30). **Not merged, not deployed.** Awaiting product-owner visual
approval per `NO VISUAL APPROVAL = NO MERGE`.

## 2. Objective completed

The AWJ storefront homepage now presents a production commerce experience —
masthead, category browsing, a product shelf, and graceful sparse/empty
behaviour — composed inside the locked STORE-UI-1 shell, rendering only data
`store/v1` actually returns.

STORE-UI-1 surfaces (`Header`, utility strip, identity row, `StoreSearch`,
`CategoryNav`, `MobileBottomNav`, `Footer`, `StoreContainer`) were not
redesigned. The one shell-adjacent change is documented in §9.

## 3. Base SHA

`0318f0eeaac1396283c290a3acfc5f93ce441875` (`main`, "STORE-ADMIN-ADOPT-1B-3A
custom domain TXT verification (#856)")

`main` moved by one commit during implementation (#856, ERP `web/` + backend,
zero overlap with `storefront/`). The branch was rebased onto it; no conflicts.

## 4. Head SHA

`bee29329afaec51dbb96e65340d6eb3835cfbfbd` — includes the final visual polish pass (§30).

## 5. Branch

`claude/store-ui-2-homepage`

## 6. PR

[#857](https://github.com/safwan5001-source/Nebrax/pull/857)

## 7. Repository evidence inspected

Authority was read from the Laravel side before any presentation decision, not
assumed from the Spree-shaped view models:

| Question | Evidence | Finding |
|---|---|---|
| Does a category carry an image? | `StorefrontCategoryController` / category resource | **No.** `id`, `name`, `description`, `color`, `parent_id`, `children`, `ancestors`. `color` is the only visual identity a category has. |
| Does a product carry a compare-at / original price? | product resource + `src/lib/commerce/mappers.ts:175` | `original_price` is hard-`null`; `price.compare_at` is never populated. The sale badge is structurally unreachable. |
| What sorts exist? | `StorefrontProductController::SORTS` | `name`, `sale_price`, `created_at` only. No featured flag, no ranking, no sales volume. |
| Does the store carry hero/banner/tagline content? | `store/v1/storefront` → `src/lib/commerce/storefront.ts` | `name` and `default_locale`. Nothing else. |
| Ratings / reviews / wishlist / stock counts / delivery promises? | absent from every `store/v1` resource | Not exposed; not presented. |

## 8. Architecture reused

- `src/lib/commerce/*` adapters remain the single commerce source. No second
  product source, no duplicate taxonomy, no client-side pricing.
- `getCategories` / `cachedListProducts` — the same cached data layer the rail
  and the catalogue already use.
- `PRODUCT_CARD_FIELDS` unchanged; the shelf narrows its payload exactly as
  `ProductListing` does.
- `StoreContainer`, `--store-*` tokens, `rounded-store`, `next-intl`,
  `ProductImage`, `HiddenPricePrompt`, GA4 `trackSelectItem` — all reused.

## 9. Exact homepage changes

| Area | Change |
|---|---|
| Page composition | `page.tsx` renders from `resolveHomeSections()` over a `Record<HomeSectionKey, ReactNode>` inside **one** `StoreContainer` stack, replacing a run of full-bleed bands that each carried their own container and `border-t` separator. |
| Hero | Rewritten: contained brand card, direction-aware gradient over the store's primary ramp, store name as `<h1>`, one CTA, initial-letter watermark. |
| Categories | Rewritten: tinted tiles driven by the merchant's `color`, initial-letter mark, subcategory counts, 12-tile cap with a "view all" escape. |
| Product shelf | `FeaturedProducts` → `NewArrivals` (git mv), sorted `-available_on`. |
| Product card | Bordered card surface, height-bounded image tile, category eyebrow, divided price row. |
| Section headings | New shared `SectionHeading` (rule bar + title + optional action with a direction-aware chevron). |
| Wholesale block | Brought onto the page's measure and the footer's dark-band tokens instead of a hard-coded slate full-bleed band. Still gated by `isWholesaleEnabled()`. |
| `globals.css` | **Removed** the `.featured-products` `content-visibility` rule. Its stated premise — "below the fold (hero `min-h-[823px]`)" — has not been true since STORE-UI-1; with a 176px mobile hero the shelf is near the fold and a 500px intrinsic-size guess would cause scroll jump. This is the only `globals.css` change; no token was touched. |

## 10. Hero behaviour

- **Content:** the store's own name, from the server-resolved storefront. When
  the API cannot identify the store, it falls back to the translated word for
  "shop" — never to a cross-tenant name or `NEXT_PUBLIC_STORE_NAME`.
- **Claims:** none. No badge, no slogan, no offer, no delivery or trust
  statement, because `store/v1/storefront` supplies nothing that would make one
  true.
- **The empty side stays empty.** The approved baseline fills that half with a
  photograph; AWJ has no banner capability. An earlier pass put an oversized
  translucent store initial there; the product owner read it as placeholder
  decoration and it was **removed, not replaced** — a monogram, an illustration
  or a stock photograph would each be storefront invention standing in for
  merchant content. The band was not made taller to compensate.
- **Customizer seam:** `headline` and `subheadline` props exist and are supplied
  by nothing. When a hero contract lands, the band fills without the homepage
  being restructured. No persistence, no editor, no stored theme.
- **Proportion:** 176px at 390 (category grid stays in the first viewport),
  256px at 768, 288px at ≥1024.

## 11. Category behaviour

- Root categories (`depth_eq: 0`) straight from `store/v1/categories`. No
  curated list, no hard-coded production categories, no second taxonomy.
- **`color` was being dropped by the mapper.** `StoreCategory` (the Spree
  `Category` plus AWJ's `color`) now carries it through `mapAwjCategoryToViewModel`
  and `fetchCategories`. `categoryAccent()` validates hex only — the value
  reaches a `style` attribute — and returns it as the tile's **3px inline-start
  accent edge** on the store's own neutral surface. A near-white colour is
  deepened toward the text colour so the edge stays visible; the merchant's hue
  survives, only its lightness is corrected. An unset or non-hex colour falls
  back to `--store-border-strong`.
- **No generated category marks.** The tile is typography-first: the category
  name and its subcategory count. An earlier pass rendered the category's first
  letter as a mark; there is no repository evidence that a category initial
  carries any merchant identity, so it was pseudo-branding and was removed.
- Subcategory counts are `children.length`; the count is omitted at zero rather
  than printed as "0 subcategories".
- `HOME_CATEGORY_LIMIT = 12` with a "view all" link to `/products`, so a merchant
  with forty root categories does not turn the homepage into a sitemap.
- **Zero categories → the section returns `null`.** An empty shelf would imply a
  catalogue that has not been built.
- ≤2 categories drop the `xl:grid-cols-6` track so two tiles do not stretch
  across the whole measure.

## 12. Product-section behaviour

- **Heading is the sort.** `-available_on` maps to the catalogue's `created_at`,
  one of the three sorts the controller allows, which is what makes "new
  arrivals" an authoritative claim. The previous "Featured Products" heading sat
  over an unsorted — in practice alphabetical — page and asserted a ranking AWJ
  does not expose. Arbitrary API ordering is never read as semantics.
- Eight products, streamed inside a `Suspense` boundary whose skeleton matches
  the card's real geometry. The heading and its "view all" link sit outside the
  boundary so they are part of the prerendered shell.
- **The card presents only what exists:** image (or the missing-media fallback),
  the product's own category as an eyebrow, name, price, and an out-of-stock note
  when `purchasable` is false. No ratings, reviews, best-seller status, wishlist,
  free-shipping or coupon badges, inventory urgency or delivery promises.
- The sale badge and strikethrough remain in the component but are gated on real
  API values that AWJ never populates, so they never render. They were not
  deleted — the branch is the correct behaviour if a compare-at price is ever
  exposed — but nothing was built around them.
- **Zero products → an honest empty state** ("no products found" + a browse
  line), not a skeleton left spinning and not filler cards.
- A failed fetch is caught, logged, and renders the same empty state; the
  homepage never 500s on a catalogue outage.

## 13. Data-authority decisions

| Decision | Reasoning |
|---|---|
| Category colour carried through, not category imagery | `store/v1/categories` has `color` and no image. Colour is real merchant data; photography would be invented. |
| Category eyebrow on the product card | `categories` is already in `PRODUCT_CARD_FIELDS` — real data, zero extra payload, and it gives the card the second line of information a catalogue entry needs. |
| Product SKU **not** shown | SKU lives on the variant, not the listing payload. Showing it would widen the fetch contract for a merchant-facing detail. |
| No `name_en` for categories | Category names render in Arabic under `/en`. This is the documented AWJ schema gap (P2B). Not patched here with a client-side translation table. |
| Section order from `resolveHomeSections()` | Unknown keys are dropped and omitted implemented sections are kept, so a future stored configuration cannot blank the page or render a section that does not exist. |

## 14. Capability-gating decisions

- Absent capability → **hide the presentation**, never invent it. Applied to:
  hero campaign content, category imagery, discounts, ratings, wishlist,
  best-sellers, stock levels, shipping and trust claims.
- The baseline reference's trust strip and quick-add button were **deliberately
  not built**: the first would state delivery/returns guarantees AWJ does not
  supply, the second needs a cart mutation that is explicitly out of scope.
- The wholesale block stays behind `isWholesaleEnabled()` and is absent on
  DTC-only storefronts.

## 15. Responsive behaviour

| Width | Hero | Categories | Shelf |
|---|---|---|---|
| 390 | 176px | 2 cols | 2 cols, 144px image |
| 768 | 256px | 3 cols | 3 cols, 176px image |
| 1024 | 288px | 4 cols | 4 cols, 208px image |
| 1280 | 288px | 6 cols | 4 cols |
| 1440 | 288px | 6 cols | 4 cols |

No horizontal overflow at any width in either direction (asserted by comparing
`documentElement.scrollWidth` against `clientWidth` in every capture).

## 16. RTL/LTR validation

- Logical properties throughout (`ps/pe`, `start/end`, `inset-inline`); no
  physical `left`/`right` added.
- The hero gradient and chevrons flip with `rtl:` variants, so the dark end
  always sits on the text side and arrows always point forward.
- The section rule bar leads the heading in both directions.
- `<bdi>` isolates the store name, so a mixed-script merchant name renders
  correctly inside either document direction.
- Verified at all five widths in both `ar` (RTL) and `en` (LTR).

## 17. Accessibility

- One `<h1>` (the hero), `<h2>` per section, `<h3>` per product — a single
  ordered outline.
- Every section is a labelled landmark (`aria-labelledby` → its own heading id).
- Category and product collections are `<ul>`/`<li>`.
- Links carry their own text; no "click here". The card's stretched-link
  `::after` keeps the whole card clickable while the accessible name stays the
  product name.
- Decorative marks (category initials, hero watermark, chevrons) are
  `aria-hidden`.
- `ProductImage` keeps the product name as `alt` and renders the fallback icon
  when media is missing.
- Focus states inherit the shell's; the card adds `focus-within:shadow-md` and
  never removes an outline.
- `motion-reduce:` disables the card hover transform and the skeleton pulse.
- Contrast: card and eyebrow text use `--store-muted-foreground` (`#636a78`,
  the AA-corrected value from STORE-UI-1); hero text is white on the primary
  ramp (≥ 10:1); category tiles pick their foreground by luminance.
- No STORE-UI-1 shell accessibility work was altered.

## 18. Performance / data-fetching notes

- Two server fetches for the homepage, both through the existing cached data
  layer: root categories and one narrowed eight-product page. No new endpoint,
  no client-side fetching, no waterfall — the shelf streams in parallel with the
  rest of the page.
- `PRODUCT_CARD_FIELDS` keeps the listing payload narrow; the card change added
  no field.
- The first four cards get `fetchPriority="high"`; `sizes` was retuned to the
  new (smaller) rendered tile so the browser stops requesting oversized images.
- Height-bounded image tiles mean the shelf reserves a fixed box before media
  loads, and the skeleton matches it, so there is no layout shift.
- The stale `content-visibility` rule was removed (§9) rather than left to
  mis-reserve 500px under a hero that is now 176px.

## 19. Changed files

```
storefront/messages/{ar,de,en,es,fr,pl}.json
storefront/src/app/[country]/[locale]/(storefront)/page.tsx
storefront/src/app/globals.css
storefront/src/components/home/CategoriesSection.tsx
storefront/src/components/home/HeroSection.tsx
storefront/src/components/home/SectionHeading.tsx                    (new)
storefront/src/components/home/WholesaleSection.tsx
storefront/src/components/home/FeaturedProductsSection.tsx        →  NewArrivalsSection.tsx
storefront/src/components/products/FeaturedProducts.tsx           →  NewArrivals.tsx
storefront/src/components/products/ProductCard.tsx
storefront/src/components/products/ProductCardSkeleton.tsx
storefront/src/lib/commerce/{types,mappers,categories}.ts
storefront/src/lib/home/category-accent.ts                           (new)
storefront/src/lib/home/sections.ts                                  (new)
storefront/src/components/home/__tests__/CategoriesSection.test.tsx  (new)
storefront/src/components/products/__tests__/FeaturedProducts.test.tsx → NewArrivals.test.tsx
storefront/src/lib/home/__tests__/category-accent.test.ts            (new)
storefront/src/lib/home/__tests__/sections.test.ts                   (new)
```

28 files, +961 / −345.

## 20. Tests and exact results

New focused coverage (20 cases):

| File | Cases | Covers |
|---|---|---|
| `products/__tests__/NewArrivals.test.tsx` | 4 | the `-available_on` sort is actually requested; the shelf renders; zero products → honest empty state; a failed fetch → the same state, not a throw. |
| `home/__tests__/CategoriesSection.test.tsx` | 7 | tiles render from authoritative categories; merchant `color` tints the tile; a missing colour falls back to neutral; subcategory counts; the count is omitted at zero; the 12-tile cap and its "view all"; zero categories → `null`. |
| `lib/home/__tests__/category-accent.test.ts` | 5 | hex-only validation (a non-hex value never reaches the `style` attribute); tint construction; luminance-based foreground. |
| `lib/home/__tests__/sections.test.ts` | 4 | default order; unknown keys dropped; omitted implemented sections kept. |

No existing test was weakened, skipped or removed.

```
$ npx vitest run
 Test Files  59 passed (59)
      Tests  449 passed (449)
   Duration  22.22s

$ pnpm check          # biome
Checked 322 files in 281ms. No fixes applied.

$ pnpm check:locales
[ar] OK  [de] OK  [es] OK  [fr] OK  [pl] OK — All locale files are in sync.

$ npx tsc --noEmit
(clean)
```

## 21. Build result

```
$ pnpm build
exit 0
```

Production Next.js build succeeds. The homepage keeps its partial-prerender
posture: the shell and section frames prerender, the shelf streams.

## 22. CI status

On the current head `d7ea4c0`:

| Check | Result |
|---|---|
| `storefront (lint + typecheck + test)` | ✅ pass |
| `php artisan test (L11, sqlite)` | ✅ pass |
| `php artisan test (L11, pgsql)` | ❌ fail — **inherited from `main`, not this PR** |

The pgsql leg is red on the base branch itself: green on `main` at `0beee23`
(#854), red at `19fb6f7` (#855) and red at `0318f0e` (#856, this PR's base),
where it is the only failed job in the run. Its Postgres log shows
`relation "webhook_events" does not exist` — a pgsql-only schema gap, which is
why the sqlite leg passes on `main` and here.

This PR cannot be the cause: every changed file is under `storefront/` or
`docs/`, with no PHP, migration, model, route or schema change for
`php artisan test` to reach. No fix for it exists on `main` to port, and writing
one would be a backend migration change — explicitly outside STORE-UI-2's scope
and belonging in its own PR. Documented once on the PR
([comment](https://github.com/safwan5001-source/Nebrax/pull/857#issuecomment-5722269789));
the branch stays watched until it is green and mergeable.

## 23. Visual QA screenshots captured

Ten renders of the actual implementation — fold and full-page — at 390 / 768 /
1024 / 1280 / 1440 in Arabic RTL and English LTR, against a local AWJ mock
shaped to the real `store/v1` contract.

The mock is **test-only scaffolding**: it lived in the session scratchpad, was
pointed at by a local `.env.local` that has been deleted, and nothing from it is
committed. No stub value became a production default. It deliberately included
categories with and without `color`, staggered `created_at` values so the sort
is a real ordering, and one product with `thumbnail_url: null` to exercise the
missing-media fallback.

Every capture asserted no horizontal overflow, the measured hero height, and the
rendered section headings in both languages.

## 24. Comparison against the approved baseline

| Dimension | Outcome |
|---|---|
| Visual hierarchy | Matches. Rule-bar section headings, hero → categories → products, one measure throughout. |
| Content density | Matches. The page is a contained stack of blocks on the page surface, not airy full-bleed bands. |
| Whitespace | Matches after tightening tile padding and shelf gaps to the baseline's `gap-3 md:gap-5`. |
| Image dominance | **Fixed during QA.** The square tile grew with the column and turned the desktop shelf into a wall of photography. Now height-bounded (`h-36 / sm:h-44 / md:h-52`), exactly the baseline's ramp. |
| Category treatment | Deliberate difference — see §25. Calmer than the first pass: neutral tiles with a coloured edge, not competing pastel surfaces. |
| Product-card quality | Matches: bordered surface, bounded image, eyebrow, bold title, divided price row, primary-coloured price. |
| Hero proportion | Close. Contained rounded card, 288px vs the baseline's 340px, because there is no hero image to give the extra height a purpose. |
| Card segmentation | Matches after the polish pass: one frame per product, image flush to the card edge, no inner tile and no price divider. |
| Typography | Matches. Cairo/Geist as approved; the baseline's black weights on headings and prices. |
| Alignment | Matches. Every block starts on the same vertical line as the header brand and the first footer column. |
| Responsive transitions | Matches at all five widths. |
| RTL / LTR | Verified both. |
| Reads as prototype/AI-generated? | Not after this pass. The first render did — cardless products floating on the page background under giant square images — and that was fixed rather than reported as complete. |

## 25. Known visual differences from the baseline

All three are capability-driven, not oversights:

1. **No hero photograph.** The baseline fills ~48% of the hero with a product
   image. AWJ exposes no banner capability. A stock photograph would be
   invented merchant content. Replaced with a brand-gradient field carrying the
   store's initial.
2. **Category tiles instead of category thumbnails.** The baseline renders a
   96px photo per category. `store/v1/categories` has no image, only `color`.
   A neutral tile with the merchant's colour as an accent edge is the honest
   expression of the data that exists — and it keeps the grid calm, where a
   surface per colour made every category shout at the same volume.
3. **No trust strip and no quick-add button.** The strip would state delivery,
   returns and guarantee claims AWJ does not supply; the button needs a cart
   mutation that is explicitly out of scope.

The baseline's discount, rating and wishlist affordances are likewise absent —
its own config models them as capability flags, and in AWJ they are all off.

## 26. Risks

- **`ProductCard` is shared** with `/products` and category listings, so the card
  restyle reaches those surfaces too. This is intentional and consistent — one
  card treatment across the storefront — but it is a wider blast radius than the
  homepage alone. The listing was visually verified at all five widths in both
  directions (§30) and its grid was brought to the same density; no separate
  homepage-only card was created to dodge the check.
- **`category.color` is merchant-controlled.** It reaches a `style` attribute, so
  `categoryAccent()` accepts hex only and everything else falls back to neutral.
  A merchant choosing a very light colour still gets a readable tile because the
  tint is a `color-mix` against the surface, not the raw value.
- **Category names remain Arabic under `/en`** (the known AWJ schema gap). More
  visible now that categories are a headline homepage section.
- The `.featured-products` rule removal is a small mobile-performance trade
  (one section no longer skips off-screen rendering), taken because its stated
  premise was false and its 500px intrinsic size would now cause scroll jump.

## 27. Deliberately deferred

- Store Customizer persistence, editor and stored merchant theme. Only the
  seams exist: `HomeSectionKey` / `resolveHomeSections()` and the hero's
  `headline` / `subheadline` props.
- A merchant hero contract (banner image, headline, campaign) — needs a backend
  capability that does not exist. **Not invented here.**
- Category imagery — needs an image column on the category resource.
- `name_en` for categories — the documented P2B schema gap.
- Trust/benefit strip — needs real fulfilment and returns policy data.
- Quick-add to cart from the shelf — needs the cart mutation, out of scope.
- Automated visual-regression tests — the repository has no such system, and the
  brief says not to introduce brittle screenshot tests.

## 28. Confirmation

- **No backend / API / schema changes.** No Laravel file, migration or model was
  touched. No `store/v1` contract was changed; the adapter change (`color`)
  reads a field the API already returns.
- **No accounting or inventory changes.**
- **No Tenant Isolation changes.**
- **No checkout, payment, shipping or cart-backend changes.**
- **No Store Customizer persistence** — seams only.
- **No PR #794 overlap.**
- **No ERP `web/` UI or design changes.** Every changed file is under
  `storefront/`.
- **Not merged.**
- **Not deployed.**

## 29. Recommended next step

Product-owner visual review of the ten captures against the locked baseline,
with attention to the three capability-driven differences in §25 — specifically
whether the hero's brand-gradient treatment is accepted as the permanent
no-banner presentation, or whether a merchant banner capability should be
specified as the next backend slice.

On approval, merge and proceed to the next slice. If a banner capability is
wanted, it is a backend ticket (a storefront hero contract on
`store/v1/storefront`), not a storefront change — the hero already has the props
to consume it.

---

## 30. Final product-owner visual polish pass

Requested after the first visual review. The composition, section order, data
authority, capability gating, sparse states, STORE-UI-1 shell, Cairo, RTL/LTR,
performance architecture and accessibility are all unchanged; this pass only
removed decoration and reduced visual weight.

### 30.1 Hero — monogram removed

The large translucent merchant initial was not approved: it read as decorative
placeholder UI. It was **removed and not replaced**. With no authoritative
banner, the hero is now deliberately simple — real store name, existing CTA,
approved palette, nothing invented. The band was **not** enlarged to compensate;
heights are unchanged at 176 / 256 / 288px.

`overflow-hidden` and the `relative`/`z-10` stacking that only existed to clip
and layer the monogram went with it. The text block's `max-w-[75%]` cap, which
existed to keep the title clear of the monogram, became `max-w-2xl`.

### 30.2 Category tiles — colour demoted to an accent

`categoryAccent()` changed shape rather than losing data. Authoritative
`category.color` support is fully preserved; it now drives a **3px inline-start
edge** on the store's own neutral surface instead of tinting the whole tile.

| | Before | After |
|---|---|---|
| Tile surface | `color-mix` tint of the merchant colour | `--store-surface` |
| Merchant colour | the surface | a 3px inline-start edge |
| No / invalid colour | `--store-surface-muted` | `--store-border-strong` edge |
| Pale colour | tint strength and label colour adjusted by luminance | edge deepened toward `--store-foreground` so it stays visible |

Hex-only validation is unchanged — the value still reaches a `style` attribute,
and the hostile-input test still asserts that nothing else gets through.

### 30.3 Category initials — removed

The generated first-letter marks are gone. There is no repository evidence that
a category initial represents any intentional merchant or category identity, and
a generated initial is not category media — it was pseudo-branding. The tile is
now typography-first: the category name, and its subcategory count when there is
one. No icon or image was invented in its place.

### 30.4 Product card — segmentation removed

`ProductCard` was **not redesigned**; all data and capability rules are
untouched. Only nested framing came out:

| | Before | After |
|---|---|---|
| Frames | card border + padding, then a separately rounded inset image tile | one card frame; the image sits flush inside it |
| Price row | preceded by a `border-t` divider | no divider |
| Price | `text-sm` | `text-sm md:text-base` |

Image, product name and the authoritative price now carry the card. The eyebrow
(the product's own category) stays: it is authoritative data in 10px muted text,
not segmentation.

### 30.5 Shared-card regression check — and one fix

`/products` was captured at 390 / 768 / 1024 / 1280 / 1440 in both directions
alongside the homepage. The check found a real regression and it was fixed
rather than reported:

- The listing grid was `grid-cols-2 lg:grid-cols-3 gap-6`. With no sidebar, three
  columns at 1440 give ~390px cards, and the new height-bounded image looked
  squat in them.
- Fixed with `grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 md:gap-5`, applied
  identically to `ProductGrid`, `ProductGridSkeleton` and `InfiniteProductList`
  so the grid, its skeleton and the infinite-scroll continuation stay in step.
- The catalogue card now matches the homepage card's proportions.

No homepage-only `ProductCard` was created to avoid this check.

### 30.6 Validation after the polish pass

```
npx vitest run     59 files, 449 tests passed
pnpm check         322 files, no fixes applied
pnpm check:locales all 6 locales in sync
npx tsc --noEmit   clean
pnpm build         exit 0
```

The build log carries `AWJ_COMMERCE_API_URL is not configured` warnings from
prerender: that is the sections' catch path degrading gracefully with no backend
configured in CI, which is the documented zero-data behaviour, not a failure.

20 renders captured: homepage and `/products`, fold and full page, at 390 / 768 /
1024 / 1280 / 1440 in Arabic RTL and English LTR. No horizontal overflow at any
width on either page.

### 30.7 What this pass did not change

Section order, `-available_on` New Arrivals semantics, category data authority,
zero/sparse states, capability gating, the STORE-UI-1 shell, Cairo, RTL/LTR
handling, the data-fetching architecture and accessibility are all as reported
above. Nothing was added: no ratings, wishlist, promotions, shipping claims,
trust strip, stock or category photography, backend banner capability, or
Customizer persistence.
