# H6 / T1-4 — Product Card Presentation Types

Storefront only, type-only, zero intended runtime change. No orders/checkout/cart/payment/accounting, migrations, backend/API, feature-gate or mapper changes.

## Types introduced (`storefront/src/lib/commerce/types.ts`)
- `StorePrice` — price fields cards/quick-view/analytics read.
- `StoreVariantSummary` — `id`, `sku`, `options_text`, `price`, `original_price` (what GTM reads of a variant).
- `StoreProductSummary` — `id`, `name`, `slug`, `purchasable`, `thumbnail_url`, `default_variant_id`, `price`, `original_price`, `categories?: StoreCategoryNode[]`.
All are structural subsets of the Spree-shaped values the mappers produce, so no casts or adapters were added. Mappers untouched.

## Boundary first (downstream consumers)
- `lib/analytics/gtm.ts`: `mapProductToGA4Item`, `trackSelectItem`, `trackViewItem`, `trackAddToCart`, list builders now take `StoreProductSummary` / `StoreVariantSummary`. Expressions, event names and payloads unchanged. `Cart`/`LineItem`/`Order` remain Spree (checkout cluster).
- `QuickView`: prop type only.
- `WishlistButton`: already takes `productId` only — no change needed.
- `AccountWishlist`: its local `CatalogProduct` alias now derives from `getProduct`'s return type instead of `ProductCard`'s prop (required: the card prop widened, so the `is CatalogProduct` type guard on `Product | null` no longer typechecked). Same runtime value; `ComponentProps` import removed.

## Consumers migrated
`ProductCard`, `ProductGrid`, `ProductCarousel`, `ListingAnalytics`, `SearchBar`, plus `QuickView`, `gtm.ts`, `AccountWishlist` (above).

## Spree dependency counts (latest main baseline → after)
`spree_type_imports` **117 → 109 (−8)**: ListingAnalytics −1, ProductCard −1, ProductCarousel −1, ProductGrid −1, QuickView −1, SearchBar −1, gtm.ts 5 → 3. Others unchanged: value 4, client 68, wrapper 77, env 9. Baseline diff is decreases only.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest (includes product-card, wishlist, quick-view, GTM tests) | 238 files passed / 16 skipped; 3433 tests passed |
| Biome (changed files) | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | exit 0 |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |

Runtime check: diff contains only `import type` lines, annotations, and the `AccountWishlist` alias; no runtime expression changed.

## Remaining Spree dependencies
Product-related: `Product`/`Variant` in `ProductDetails` (and `Media`-adjacent PDP code), `seo.ts` (`Product`), `gtm.ts` (`Cart`, `LineItem`, `Order`), `OptionType`/`Variant` in `VariantPicker`, `CustomField` in `ProductCustomFields`, `ProductListParams` (data layer / utils), `StoreProduct` (still `Product & {…}`), `ProductListing`/`InfiniteProductList` `Product` (page generic), `app/dev/*` and tests (not counted).

## Risks
Low (type-only). Product-summary fields are a deliberate subset; a card that later reads a new field must add it to `StoreProductSummary`, and `tsc` will flag the mapper boundary.

## Recommended next cluster
PDP cluster: `StoreVariant`/`StoreOptionType` for `VariantPicker`, `ProductDetails`, `ProductCustomFields`, `seo.ts`; then re-base `StoreProduct` off the SDK.

Branch `claude/commerce-h6-t1-4-product-card` · Base `81e8eda82` · Head: see PR. No merge, no deploy.
