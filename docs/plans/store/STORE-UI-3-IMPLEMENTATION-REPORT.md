# STORE-UI-3 — AWJ Store Catalog & Product Detail — Implementation Report

## 1. Status

**Complete.** Stop gate passed, implemented, validated and pushed. Awaiting
product-owner visual approval per `NO VISUAL APPROVAL = NO MERGE`. Not merged,
not deployed.

## 2. Base SHA

`5c062c31f28241a5fda8b77b5f83cf04ce83607e` — current `main`, the STORE-UI-2
merge (#857). Verified by fetch, not assumed.

## 3. Head SHA

`e931adae7be75f4056eb18cb3e05ac57a661d9bb`

## 4. Branch

`claude/store-ui-3-catalog-pdp`

## 5. PR

[#860](https://github.com/safwan5001-source/Nebrax/pull/860)

## 6. Evidence matrix

Read from the Laravel controllers, resources, routes and middleware on this
exact base — not inferred from the Spree-shaped view models the storefront
adapter produces.

### A. Product listing

| Question | Finding | Evidence |
|---|---|---|
| Endpoint | `GET store/v1/products` | `routes/api_storefront.php:43` |
| Guard | `is_active` **and** a published `CommerceListing` on the resolved `web` channel | `StorefrontProductController::index()` |
| Pagination | `page` + `per_page` (max 100); meta `{page, per_page, total, last_page, has_more}` | validate block + response `meta.pagination` |
| Category filter | `category_id` (uuid) → `where('category_id', …)` — **exact match, no descendant rollup** | `index()` |
| Search | `search` (≤120 chars) → `LIKE` over `name`, `name_en`, `sku` — server-authoritative | `index()` |
| Sorts | **`name`, `sale_price`, `created_at`** (asc/desc) — reconfirmed unchanged on this base | `self::SORTS` |
| Other filters | **None.** No price, availability, option or brand filter exists | validate block is the whole contract |
| Price in listing | `sale_price` for a simple product; **`0` for a variant-managed product** (deliberate — the parent has no meaningful price, and resolving every variant would be N+1) | `index()` + its comment |
| Media in listing | Yes — full gallery resolved, `thumbnail_url` = first item | `mediaPayload()` |
| Availability | `in_stock: bool\|null` — `null` when the channel has no fulfilment policy (unknown, not `false`) | `batchAvailability()` |

### B. Product detail

| Question | Finding |
|---|---|
| Endpoint | `GET store/v1/products/{id}` (uuid), 404 unless published on the channel |
| Media / gallery | `media[]` — `{id, url, alt, position}`, resolved by `ProductMediaGalleryService` |
| Description | `description` (nullable) |
| SKU | `sku` exposed |
| Price | `CommercePriceResolver::resolve()`; for variant-managed, the **cheapest active variant** |
| Availability | `in_stock: bool\|null`, from `AvailableToSellService` against the fulfilment warehouse |
| Stock quantity | **Never exposed** — deliberate; only a derived boolean |

### C. Product options / variants — **generic, and fully supplied**

```
options:  [{ id, name, name_en, values: [{ id, value, value_en }] }]
variants: [{ id, sku, descriptor, option_value_ids[], 
             price: { amount_minor, currency }, in_stock, media[] }]
is_variant_managed: bool
```

- Variant identity is the **set of `option_value_ids`** → selection resolves to a real variant.
- Variant-specific **price**, **availability** and **media** all supplied per variant.
- **No renderer metadata and no colour value anywhere.** There is no `kind`,
  no `presentation`, no hex. Per §11 and baseline §8 this mandates a **generic
  accessible selection control**; a colour swatch would require inferring
  colour from an option name, which is forbidden.
- Default variant: none is flagged. The UI must choose (first purchasable)
  without claiming the merchant designated it.

### D. Cart mutation

| Question | Finding |
|---|---|
| Endpoint | `POST store/v1/cart/items` |
| Body | `product_id` (uuid, required), `product_variant_id` (uuid, optional), `unit_key` (default `base`), `quantity` (int ≥1) — unknown keys rejected outright |
| Identity | Cookie token (`CommerceCartService::COOKIE_NAME`); cart lazily created, `201` on create / `200` on add |
| Anonymous | Yes — no auth required |
| Boundary | **Server-to-server only.** `RequireStorefrontMutationGateway` demands `X-Storefront-Gateway-Secret` + `X-Storefront-Forwarded-Host` and an established storefront context; anything else 404s. The browser can never call it directly |
| Errors | `404` + cookie cleared (stale/unknown cart) · `422` (business rejection, e.g. unavailable) · validation errors |
| Idempotency | None on cart mutations (explicitly noted at `routes/api_commerce.php:83`); required only at checkout |

### E. Search

Server-authoritative (`LIKE` in SQL, paginated). Empty/absent `search` returns
the unfiltered catalogue. No suggestions, trending or recent-search contract
exists — so none may be built.

### F. Filters

**The backend supports no product filters at all** beyond `category_id` and
`search`. Any price / availability / option facet would be a control that
looks functional and is not.

### G. Sorts

`name`, `sale_price`, `created_at` — ascending and descending. Reconfirmed on
this base rather than carried over from the STORE-UI-2 report.

### Adapter gaps found (frontend-only; no backend change needed)

1. **`AwjProduct` does not declare `options`, `variants` or `is_variant_managed`,
   and `mapAwjProductToViewModel` hard-codes `variants: []`, `option_types: []`,
   `option_values: []`.** The entire generic option/variant contract is
   discarded in the adapter — structurally the same defect as the dropped
   category `color` fixed in STORE-UI-2.
2. **`addAwjCartItem()` never sends `product_variant_id`**, and the PDP's DTC
   path calls `addItem(product.id, …)`. A variant-managed product would be
   added by its parent id.
3. **`CartContext.addItem(id, quantity, unitKey)` has no variant parameter.**
4. **A variant-managed product renders as free in the catalogue** — the listing
   sends `amount_minor: 0` by design, and `ProductCard` prints any truthy
   `display_amount`, so "٠٫٠٠ ر.س" appears as a real price.
5. **`fetchProductFilters()` omits `created_at`** from its sort menu although
   the backend supports it (STORE-UI-2's New Arrivals already relies on it).

### Stop-gate decision

**Continue.** Every capability §2 names as blocking is present: safe
server-to-server add-to-cart, authoritative variant resolution, authoritative
product detail, and honest availability semantics. The five gaps above are all
in the storefront adapter and are STORE-UI-3's work; none requires a new
backend contract.


## 7. Existing API / contracts reused

`store/v1` products (list + detail), categories, media and cart — all unchanged.
`storefrontFetch`/`storefrontCartRequest`, the cached data seams, `ProductCard`,
`ProductListing`/`InfiniteProductList`, `FilterBar`, `MediaGallery`,
`VariantPicker`, `QuantityPickerField`, `CartContext` and `StoreContainer` are
reused as they stand. No new dependency was added.

## 8. Catalogue changes

`/products` and the category results move onto `StoreContainer` and the
`--store-*` tokens; both carried their own `container mx-auto` and raw
gray-500/900 text and so sat on a different grid to the shell around them. The
heading takes the same rule-bar treatment as the homepage sections. The
catalogue grid, pagination and infinite-scroll architecture are untouched.

## 9. Search changes

Server-authoritative as it already was — `search` is passed to the API and the
results are whatever it returns. The query is reflected in the heading, the
count comes from `meta.pagination.total`, and the no-results state names the
term. No suggestions, trending or recent searches were added: no contract for
them exists. The existing STORE-UI-1 search field is the only entry point;
no second search interaction was created.

## 10. Filters and sort behaviour

**No filter control was added.** The AWJ catalog API supports none beyond
`category_id` and `search`, and `FilterBar` already renders only the facets the
payload contains — which is an empty list — so the bar shows the count and the
sort control alone. Sorts are exactly the three allowed columns in both
directions; "newest"/"oldest" were added because `created_at` has always been
supported and only the menu omitted it. Sort state stays in the URL and drives a
server query; nothing is sorted or filtered client-side over a partial page.

## 11. Product-detail changes

Product-first composition: gallery and purchase column side by side from `lg`
with the gallery capped and sticky, image-first below that. Category eyebrow,
name, price, availability, options, quantity, add-to-cart, then description and
details. Details render only when there is something to show. No marketing band
above the product.

## 12. Gallery behaviour

Authoritative media only. The selected variant's own media replaces the
parent's when it has any — AWJ supplies media per variant and the page never
read it, because Spree's `media.variant_ids` route has no ids to match on in
this adapter. One image, several, and none are all handled; the missing-media
fallback is the existing `ProductImage` placeholder. Nothing is duplicated to
pad the strip, and no carousel dependency was introduced.

## 13. Product options / variants behaviour

Generic by construction — see §6.C. Groups are whatever the merchant defined;
`kind: "awj_generic"` and a null `color_code` mean no group can render as a
swatch. Selection resolves to a real variant by `option_value_ids`; an
unavailable combination is marked and cannot be added; the chosen variant's id
is what reaches the cart. Nothing is preselected. A product with no options
shows no options area.

## 14. Quantity behaviour

The existing accessible `QuantityPickerField` is reused, minimum 1. No maximum
is shown: AWJ exposes no stock quantity, only a derived boolean, so any ceiling
would be invented. The server remains the final authority.

## 15. Add-to-cart behaviour

`POST store/v1/cart/items` through the existing server-to-server proxy, sending
the product id, the resolved `product_variant_id` where there is one, `base` as
the unit key and the requested quantity. Never a price. A rejection surfaces as
an error toast through `CartContext`'s existing path and the drawer does not
open, so a refused mutation can never read as a success. No totals are computed
on the page.

## 16. Capability-gating decisions

Absent capability, absent UI: no wishlist, ratings, reviews, sold counts,
urgency, delivery promise, shipping estimate, coupon, loyalty or trust badge.
No related/recommended section — AWJ exposes no relationship and catalogue
ordering is not a recommendation. The sale badge and compare-at price stay
gated on real API values that AWJ never populates, so they never render.

## 17. Data-authority decisions

| Decision | Reasoning |
|---|---|
| Variant-managed listing rows are unpriced | The zero is "not priced here", not "free" |
| Parent detail price labelled "from" | It is the cheapest active variant, per the controller |
| No category descendant rollup | `category_id` is an exact match; faking it client-side would misreport the catalogue |
| Description rendered as text | AWJ's column is plain text, not authored HTML |
| No default variant preselected | AWJ flags none; choosing one would assert a merchant decision |

## 18. Tenant / security assessment

Unchanged. No tenant resolution, storefront context, publication guard or
ownership boundary was touched. Cart mutations keep running through the
existing gateway-secret proxy — the browser still cannot reach them. No cache
key, cart token or product/category scope was altered.

## 19. Responsive validation

390 / 768 / 1024 / 1280 / 1440 on `/products`, category results, search results
and product detail. No horizontal overflow at any width, asserted per capture by
comparing `scrollWidth` against `clientWidth`. Mobile keeps two-column browsing;
tablet is a real breakpoint at three columns; desktop uses four.

## 20. RTL / LTR validation

Both directions at every width. Logical properties throughout; the gallery,
breadcrumb and option controls mirror semantically. The price qualifier is
`<bdi>`-isolated so an Arabic-formatted figure inside English text cannot
reorder around it.

## 21. Accessibility

One `h1` per page, `h2` per section; labelled landmarks; `ul`/`li` collections;
option groups keep their existing accessible controls; the disabled action
states what is required rather than silently failing; decorative marks are
`aria-hidden`; focus states inherit the shell's; `motion-reduce` on the spinner.
STORE-UI-1 shell accessibility is untouched.

## 22. Performance / data-fetching assessment

No new fetch. The PDP reads options and variants from the detail response it
already made; the listing keeps its narrowed `PRODUCT_CARD_FIELDS`. No listing
card fetches product detail. Server/client boundaries are unchanged — the only
client components are the ones that were already client components. The capped
gallery reduces the largest image request on desktop, and aspect-ratio boxes
keep layout stable.

## 23. Changed files

```
storefront/messages/ar.json
storefront/messages/de.json
storefront/messages/en.json
storefront/messages/es.json
storefront/messages/fr.json
storefront/messages/pl.json
storefront/src/app/[country]/[locale]/(storefront)/c/[...permalink]/CategoryBanner.tsx
storefront/src/app/[country]/[locale]/(storefront)/c/[...permalink]/page.tsx
storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.test.tsx
storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx
storefront/src/app/[country]/[locale]/(storefront)/products/page.tsx
storefront/src/components/products/MediaGallery.tsx
storefront/src/components/products/ProductCard.tsx
storefront/src/contexts/CartContext.tsx
storefront/src/contexts/__tests__/CartContext.test.tsx
storefront/src/lib/commerce/__tests__/mappers.test.ts
storefront/src/lib/commerce/__tests__/products.test.ts
storefront/src/lib/commerce/cart.ts
storefront/src/lib/commerce/mappers.ts
storefront/src/lib/commerce/products.ts
storefront/src/lib/commerce/types.ts
storefront/src/lib/data/__tests__/cart.test.ts
storefront/src/lib/data/cart.ts
```

## 24. Focused tests and results

14 new cases. Mapper: every merchant group maps whatever it is named; a group
called "colour" still gets the generic control and never a swatch; each variant
keeps its own option values, price, stock and media; a variant-managed listing
row is unpriced while a genuinely free simple product keeps its zero; the
synthetic default variant is withheld; a plain-text description is not claimed
as HTML; a simple product has no options or variants. PDP: nothing is
preselected, no add is possible before a variant resolves, no price of its own
before selection. Cart: the variant id is forwarded, and its absence is
explicit. Sorts: exactly the allowed set.

No test was weakened, skipped or removed; the six that asserted the old
signatures were updated to pin the new one.

## 25. Full storefront tests and results

```
npx vitest run   →  59 files, 463 tests passed
pnpm check       →  322 files, no fixes applied
pnpm check:locales → all 6 locales in sync
npx tsc --noEmit →  clean
```

## 26. Build result

```
pnpm build → exit 0 (Compiled successfully in 16.9s)
```

## 27. CI status

Running at the time of writing on PR #860. The `storefront (lint + typecheck + test)` check — the one this PR's diff owns — has already passed. The full suite, lint, locales, typecheck and production build were reproduced locally and are green (§25, §26).

## 28. Visual screenshots captured

25 renders — fold and full page — at 390/768/1024/1440 in Arabic RTL and English
LTR: catalogue, category results, search results, no-results, and product detail
with multiple images, a single image, no image, with options and without. States
exercised from an authoritative-shaped mock: a variant-managed product, an
out-of-stock product, a product whose availability is unknown (`in_stock: null`),
and a product with no media.

## 29. Comparison to the approved baseline

Image dominance, information hierarchy, catalogue density, option usability,
purchase-action clarity, whitespace and both directions were reviewed against the
baseline and against the merged STORE-UI-1/2 language. Three problems were found
and fixed rather than reported as complete: the gallery pushed the purchase
action below the fold at 1440; the parent's cheapest-variant figure read as
*the* price; and that qualifier collided with the Arabic-formatted figure in
English. The result uses the same rule-bar headings, card treatment, tokens and
spacing as the merged homepage.

## 30. Known visual differences

- **No category imagery.** AWJ exposes none; the restrained header replaces the
  band that used to reserve space for it.
- **No related-products shelf.** No authoritative relationship exists.
- **No facet filters.** The API supports none, so the bar carries count and sort
  alone rather than mimicking the reference's filter column.

## 31. Risks

- `ProductCard`, `MediaGallery`, `VariantPicker` and `CartContext` are shared
  with the wholesale surface. The wholesale path is explicitly branched around
  in `handleAddToCart` and its Spree variants still flow through unchanged, but
  the blast radius is wider than the DTC catalogue alone.
- Category browsing shows only products assigned directly to that category,
  because `category_id` is an exact match server-side. That is the API's real
  behaviour, surfaced rather than papered over, but it may surprise a merchant
  who expects a parent to roll up its children.
- Prices render in Arabic numerals on every locale — a pre-existing adapter
  decision, now visible alongside an English qualifier and handled with `<bdi>`
  rather than changed here.

## 32. Deferred capabilities

Category imagery, a merchant banner, related/recommended products, faceted
filtering (price, availability, option), stock quantities, ratings and reviews,
and a descendant-rollup category query — each needs a backend capability that
does not exist, and none was invented.

## 33. Confirmation

- **No backend / API / schema changes.** No Laravel file, migration or model
  touched; every field consumed was already being sent.
- **No accounting or inventory changes.**
- **No Tenant Isolation changes.**
- **No checkout, payment or shipping changes.**
- **No Store Customizer persistence.**
- **No PR #794 overlap.**
- **STORE-UI-1 and STORE-UI-2 surfaces untouched** — no header, utility strip,
  search, category nav, bottom nav, footer, hero, homepage categories or New
  Arrivals change.
- **Not merged.**
- **Not deployed.**

## 34. Recommended next step

Product-owner visual review of the 25 captures, with attention to the three
differences in §30 — in particular whether a category-image capability and a
related-products relationship are wanted as backend slices, since both are
presentation the reference shows and AWJ cannot currently support.


---

# STORE-UI-3 — Final Design Completion Pass

## 35. Heads

| | |
|---|---|
| **Previous Head** | `c8fbdc876bd4763a3f1d0f7dae2e995d0a0cf1ab` — verified against the remote before any change |
| **New Head** | `e931adae7be75f4056eb18cb3e05ac57a661d9bb` |

## 36. The policy this pass operates under

The owner's decision is now recorded in
`docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`:

> Missing backend capability does not block storefront design completion.
> It blocks production activation.

with the four states (**LIVE**, **DESIGN_ONLY**, **GATED**, **DEFERRED**), the
things design-first never licenses, the five facts every unbacked capability
must record, and a register covering wishlist, category imagery,
recommendations, ratings, promotions, shipping/payment presentation and
comparison.

## 37. Changed files

```
docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md
storefront/messages/ar.json
storefront/messages/de.json
storefront/messages/en.json
storefront/messages/es.json
storefront/messages/fr.json
storefront/messages/pl.json
storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx
storefront/src/app/[country]/[locale]/layout.tsx
storefront/src/components/products/ProductCard.tsx
storefront/src/components/products/WishlistButton.tsx
storefront/src/components/products/__tests__/ProductCard.test.tsx
storefront/src/components/products/filters/ProductFilters.tsx
storefront/src/contexts/WishlistContext.tsx
storefront/src/contexts/__tests__/WishlistContext.test.tsx
storefront/src/lib/commerce/capabilities.ts
```

## 38. ProductCard purchase action — **LIVE**

One action line at the foot of the **shared** card, so the homepage,
`/products`, category results and search results all get it from a single
component — no per-page card design.

| Case | Behaviour |
|---|---|
| Simple, purchasable | `أضف للسلة` / `Add to cart`. Adds by **product id** through the cart contract proven in Phase 0: quantity only, no variant, no price. |
| Variant-managed | `اختر الخيارات` / `Select options`. **Never adds the parent** — it has no sellable identity — and routes to the detail page where a real variant resolves. |
| Unavailable | A plain unavailable state and no working add action. |

Restraint held to deliberately: no nested action-card footer, no icon in the
button, no oversized control, no decoration. The image still leads and
two-column phone browsing stays readable (verified at 390).

Duplicate submission is refused while a request is in flight. A rejection
re-enables the control and reports nothing — errors stay on `CartContext`'s
single existing toast channel, and the card never reports a success the server
refused. No price or total is computed client-side.

**The wholesale surface is untouched.** It sells real Spree variants and its
listing carries no safe single identifier to add, so its cards stay link-only
exactly as before.

## 39. Wishlist / favourites — **DESIGN_ONLY / GATED**

Verified, not assumed: `store/v1` exposes **no wishlist endpoint** and this
repository has **no adapter**. The Spree SDK carries `WishlistItem` types, which
is why the gap is easy to mistake for a capability.

Designed and built anyway, on `ProductCard` (homepage, `/products`, category,
search) and on product detail, as one component through one provider.

- **States:** default (outline), selected (filled, primary), hover,
  focus-visible, pending (dimmed, non-interactive), error (reverts the flip).
- **Accessibility:** `aria-pressed` plus both names —
  "إضافة إلى المفضلة" / "إزالة من المفضلة", "Add to favorites" /
  "Remove from favorites".
- **Persistence: none.** Not React-persisted, not `localStorage`, not a cookie.
  State lives for the page only. A favourite surviving a reload would imply an
  account-level promise the platform has not made, and the policy forbids
  substituting browser storage for real business persistence. **A test asserts
  `Storage.prototype.setItem` is never called.**
- **Renders nothing outside its provider**, so a surface that has not opted in
  shows no heart rather than a dead control.

**Missing backend contract, for later closure:** `GET store/v1/wishlist` ·
`POST store/v1/wishlist/items {product_id}` ·
`DELETE store/v1/wishlist/items/{product}` — plus **an identity to hang it on**,
since the storefront's cart identity is an anonymous cookie token and a
favourites list outliving a cart needs an account. That identity decision is the
substantive part of the gap, not the three routes.

**Activation:** flip `WISHLIST_CAPABILITY` to `"live"` and point
`WishlistProvider.toggle` at the real mutation. **No consuming component
changes** — which is the entire purpose of the seam.

## 40. Capability status summary

| Capability | State |
|---|---|
| Catalogue browsing, search, sort, pagination | **LIVE** |
| Product detail, gallery, generic options, variant resolution | **LIVE** |
| Add to cart (simple + variant, incl. rejection handling) | **LIVE** |
| Quantity | **LIVE** |
| Wishlist / favourites | **DESIGN_ONLY / GATED** |
| Category imagery · related products · ratings · promotions · shipping/payment presentation · comparison | **DEFERRED** |

## 41. Catalogue spacing correction

The rule under the catalogue controls carried `pb-4` + `mb-6` on top of the
page's own vertical rhythm, which opened a gap wide enough to read as a missing
element between the controls and the grid. Tightened to `pb-3` + `mb-3` and
moved onto the store border token, so the grid reads as connected to the
controls while keeping deliberate breathing room. Verified on `/products` and on
a category with a single product. **No empty banner was restored.**

Two related honesty fixes the same area exposed:

- The **mobile filter trigger rendered unconditionally.** With AWJ's empty facet
  list that put a button on every phone which opened an empty drawer — a control
  that looks functional and is not. It now appears only when the catalogue
  actually exposes something to filter on.
- The **sort control used a physical `ml-auto`**, so it sat on the left in both
  directions instead of mirroring. Now `ms-auto`.

## 42. MobileBottomNav clearance — verified, not redesigned

Measured at 390 after scrolling to the end of the document:

```
navTop: 783 · lowest footer text bottom: 763.75 · clearance: 19px
spacer present: true · spacer height: 60px
```

The existing spacer (`--store-bottom-nav-height` + `env(safe-area-inset-bottom)`)
already clears the fixed navigation, and no meaningful content is obscured on the
homepage, catalogue, category or product detail — including the PDP's options,
purchase controls and description, and the catalogue's final row. The automated
probe's "1px" reading is the footer *container's* bottom edge meeting the spacer,
not text. `MobileBottomNav` itself was not touched.

## 43. Screenshots captured

28 renders — fold, full page, and a scrolled-to-end frame at phone width — at
390 / 768 / 1024 / 1440 in Arabic RTL and English LTR across the homepage,
`/products`, category results and product detail. Every ProductCard state is
visible for review in them: add to cart, select options, unavailable, and the
favourites affordance. The product detail frames show favourites, options,
quantity, add-to-cart and the end-of-page bottom-nav clearance.

**No horizontal overflow at any width on any page**, asserted per capture.

## 44. RTL / LTR and responsive validation

Both directions at 390 / 768 / 1024 / 1440 on all four surfaces. The card action
and heart mirror with logical properties; the sort control's physical margin was
corrected as part of this pass.

## 45. Tests

```
npx vitest run     →  60 files, 475 tests passed  (12 new in this pass)
pnpm check         →  326 files, no fixes applied
pnpm check:locales →  all 6 locales in sync
npx tsc --noEmit   →  clean
pnpm build         →  exit 0 (Compiled successfully in 18.4s)
```

New in this pass: simple-product add sends product id with no variant and no
price · a variant-managed card never mutates the cart and routes to detail ·
unavailable offers no working add and says so once · duplicate submit refused
while in flight · rejection re-enables without claiming success · wholesale left
link-only · wishlist declared `design_only` · renders nothing outside its
provider · both accessible names and `aria-pressed` toggle · per-product state
independence · **no browser storage written**.

A test caught a real defect during this pass — a rejected promise escaped the
card's click handler unhandled. The component was fixed, not the test.

## 46. CI status

Running on PR #860 at the time of writing. The prior head's `storefront (lint + typecheck + test)` check passed, and the full storefront suite, lint, locales, typecheck and production build were reproduced locally on this head and are green (§45).

## 47. Backend gaps intentionally deferred

Wishlist (contract above) · category imagery · related/recommended products ·
ratings and reviews · coupons, promotions and compare-at pricing · shipping,
delivery and payment presentation · product comparison. All registered in the
design-first policy with intended UX, surface, state, missing contract and
activation requirement, so each is a backend task with a known target rather
than a rediscovery.

## 48. Risks and remaining items

- **The favourites heart is interactive but inert.** That is the explicit intent
  of DESIGN_ONLY and it is documented in code, in the policy and here — but a
  reviewer clicking it should know the state is not saved anywhere.
- **`ProductCard` is shared with the wholesale surface.** The new action is
  branched away from wholesale and its tests pin that, but the blast radius is
  wider than the DTC catalogue.
- Category browsing still shows only products assigned directly to that
  category, per the API's exact-match `category_id` (unchanged from §31).

## 49. Confirmation

- **No backend / API / schema / migration changes.** No Laravel file touched.
- **No accounting or inventory changes.**
- **No Tenant Isolation changes.**
- **No checkout / payment / shipping changes.**
- **No Store Customizer persistence.**
- **No fake authoritative persistence, and no browser storage standing in for
  business persistence.**
- **Locked surfaces untouched:** Header, utility strip, StoreSearch, CategoryNav,
  MobileBottomNav, Footer, homepage hero/categories/New Arrivals, and the
  approved PDP composition. Only the minimum integration required by this pass.
- **Not merged. Not deployed.** PR #860 stays open.

## 50. Next step

Safwan's visual approval of the captures. On approval, the first gap-closure
task is the wishlist backend — the routes are trivial; the identity decision is
the real work, and it should be taken deliberately rather than inherited from
the cart's anonymous cookie.
