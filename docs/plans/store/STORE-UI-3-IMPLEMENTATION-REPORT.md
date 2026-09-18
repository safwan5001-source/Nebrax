# STORE-UI-3 — AWJ Store Catalog & Product Detail — Implementation Report

## 1. Status

**Complete.** Stop gate passed, implemented, validated and pushed. Awaiting
product-owner visual approval per `NO VISUAL APPROVAL = NO MERGE`. Not merged,
not deployed.

## 2. Base SHA

`5c062c31f28241a5fda8b77b5f83cf04ce83607e` — current `main`, the STORE-UI-2
merge (#857). Verified by fetch, not assumed.

## 3. Head SHA

`d9e73345752e5bbeb1e0cd492aad08368e52940d`

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
