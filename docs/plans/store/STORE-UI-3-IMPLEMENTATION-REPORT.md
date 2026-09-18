# STORE-UI-3 — AWJ Store Catalog & Product Detail — Implementation Report

## 1. Status

**Phase 0 (evidence pass) complete — stop gate passed, implementation underway.**
Not merged, not deployed.

## 2. Base SHA

`5c062c31f28241a5fda8b77b5f83cf04ce83607e` — current `main`, the STORE-UI-2
merge (#857). Verified by fetch, not assumed.

## 3. Head SHA

`<HEAD_SHA>`

## 4. Branch

`claude/store-ui-3-catalog-pdp`

## 5. PR

`<PR_LINK>`

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
