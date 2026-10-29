# H6 / T1-6 — Full StoreProduct Type Decoupling

Storefront only, type-only, zero intended runtime change. No orders/cart/checkout/payments/accounting, migrations, backend/API, feature-gate or mapper-runtime changes. No runtime mapping expression, data-fetch, routing, caching or tenant-scoping line was touched.

## Types introduced / redefined (`storefront/src/lib/commerce/types.ts`)
Kept the existing name `StoreProduct` and redefined it (no competing contract):
- `StoreProduct = StoreProductFull & { isVariantManaged; card_url; gifting }` — no `@spree/sdk` inheritance; `types.ts` no longer imports the SDK at all.
- `StoreProductFull extends StoreProductDetail` — adds `meta_*`, `variant_count`, `available_on`, `preorder_ships_at`, `preorder`, `backorderable`, `available`, `description_html`, `tags`, `primary_media?`, `option_values?`, `prior_price?`, with `media`/`variants`/`default_variant` narrowed to the Full variants below.
- `StoreVariantFull extends StoreVariant` — `product_id`, `track_inventory`, `media_count`, `preorder_ships_at`, `thumbnail_url`, `backorderable`, `preorder`, dimensions, `primary_media?`, `media?`, `custom_fields?`, `prior_price?`.
- `StoreMediaFull extends StoreMedia` — `product_id`, `media_type`, focal point, `external_video_url`, `og_image_url`.
- `StorePriceHistory`.
Reused: `StoreProductDetail`, `StoreVariant`, `StoreMedia`, `StoreCategoryNode`, `StorePrice`, `StoreOptionType/Value`, `StoreCustomField`, `StorePaginationMeta`, `StoreProductPage`, `StoreProductFilters`.

## Migrated (type-only)
- `mappers.ts`: `Price/Variant/Media/OptionType/OptionValue` → `StorePrice/StoreVariantFull/StoreMediaFull/StoreOptionType/StoreOptionValue` (5 SDK imports removed).
- `products.ts`: `PaginatedResponse/PaginationMeta/Product/ProductFiltersResponse` → `StoreProductPage<StoreProductFull>/StorePaginationMeta/StoreProductFull/StoreProductFilters` (4 removed).
- `ProductListing`, `InfiniteProductList`: `Product` generic → `StoreProductFull` (2 removed).
- Comment text in `products.ts` follows the renamed type.

## Compatibility gate
Verified by `tsc` (strict, includes tests) against the real mapper output: `mapAwjProductToViewModel` returns `StoreProduct`, `fetchProducts/fetchProduct/...` return the Full types, the category/products/wholesale pages that pass `getProducts` into `ProductListing` compile unchanged, and `mappers.test.ts` (reads `primary_media`, `available`, `option_values`, `description_html`, `variant_count`) compiles unchanged. No casts, no `any`. An earlier intermediate attempt (T1-5) failed because `products.ts` still typed returns as SDK `Product`; moving those to the Full type resolved it with no runtime edit.

## Spree dependency counts
`spree_type_imports` **103 → 91 (−12)**: mappers.ts 5→0, products.ts 4→0, types.ts 1→0, ProductListing 1→0, InfiniteProductList 1→0. Others unchanged: value 4, client 68, wrapper 77, env 9. Baseline diff decreases only.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest (mapper, data layer, listing, PDP, variant, pricing, media, gifting, wholesale included) | 240 files passed / 16 skipped; 3462 tests passed |
| Biome (changed files) | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | exit 0 |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |
Serialized output unchanged: only `import type` lines, annotations and one comment changed; mapper test assertions on emitted objects pass untouched.

## Remaining Spree dependencies
Product-related: `ProductListParams` (`utils/product-query`, `utils/listing-context`, `data/categories`, `data/wholesale`), `gtm.ts` (`Cart`, `LineItem`, `Order`), `data/wholesale.ts` (`Channel`), `StoreCategory`-adjacent none. Non-product: cart/checkout/account/addresses/orders/payment/markets/webhooks/auth (the rest of the 91), plus value imports (4), client access (68), wrappers (77), env reads (9).

## Risks / unresolved
Low (type-only). The Full types intentionally mirror the Spree record shape because the mapper still emits it; if the mapper later drops fields, the Full types should be narrowed in the same PR. `StoreCustomField` stays the T1-5 discriminated union (assignable from SDK values; verified by `tsc`).

## Next recommended cluster
(1) Request-param types: `ProductListParams`/`CategoryListParams` → AWJ `StoreProductListParams` (`utils/product-query`, `listing-context`, `data/categories`, `data/wholesale`, `data/products` callers). (2) Then the cart/checkout/order type clusters (largest remaining type-import share) — separate slices touching commerce flows, so each needs its own gate.

Branch `claude/commerce-h6-t1-6-store-product` · Base `1486edb45` · Head: see PR. No merge, no deploy.
