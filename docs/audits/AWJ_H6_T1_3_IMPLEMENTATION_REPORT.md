# H6 / T1-3 — Listing Filter & Pagination Presentation Types

Storefront only, type-only, zero intended runtime change. No orders/checkout/payment/accounting, migrations, backend/API, feature-gate or mapper-logic changes.

## Scope decision (split)
The requested listing cluster has two halves with very different coupling:
- **Filters / pagination** — pure presentation types; migrated here.
- **Product card (`ProductCard`, `ProductGrid`, `ProductCarousel`, `ListingAnalytics`)** — these forward the Spree `Product` to Spree-typed consumers (`trackSelectItem`/GTM, `WishlistButton`, `QuickView`, `AccountWishlist`). A `StoreProductSummary` attempt failed `tsc` in those call sites, so it was **deferred to its own PR** rather than widening this one (nothing from it is in this diff).

## Types introduced (`storefront/src/lib/commerce/types.ts`)
`StorePaginationMeta`, `StoreProductPage<T>`, `StoreFilterOption`, `StoreOptionFilterOption`, `StoreCategoryFilterOption`, `StorePriceRangeFilter`, `StoreAvailabilityFilter`, `StoreOptionFilter`, `StoreCategoryFilter`, `StoreProductFilter` (union), `StoreProductFilters`. Each is the structural twin of the SDK shape the UI reads; Spree-shaped data from the data layer is assignable without casts. Pre-existing `as` narrowing casts in the filter components are unchanged (only the type names changed).

## Consumers migrated
`ListingFilterBar`, `ProductListing`, `InfiniteProductList`, `filters/ProductFilters`, `filters/FilterChips`, `filters/AvailabilityDropdownContent`, `filters/OptionDropdownContent`, `filters/MobileFilterDrawer`. (`Product` stays imported from the SDK in `ProductListing`/`InfiniteProductList` — product-card cluster.)

## Spree dependency counts (baseline from latest main)
`spree_type_imports` **132 → 117 (−15)**. Others unchanged: value 4, client 68, wrapper 77, env 9. Baseline diff is decreases only.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full storefront vitest | 238 files passed / 16 skipped; 3433 tests passed (listing/filter tests included) |
| Biome (changed files) | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | exit 0 |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |

Runtime: only `import type` lines and type annotations changed (erased at build); behavior of pagination, search, sorting, filters, pricing, images, stock labels, ar/en and RTL is untouched.

## Risks
Low (type-only). The filter types duplicate SDK shapes by design; if the SDK filter contract changes before removal, `tsc` flags the data-layer boundary.

## Remaining Spree product types
`Product` (ProductCard/Grid/Carousel/ListingAnalytics/InfiniteProductList/ProductListing/QuickView/SearchBar/ProductDetails/seo/gtm/AccountWishlist), `Variant`/`OptionType` (VariantPicker, ProductDetails, gtm), `CustomField` (ProductCustomFields), `ProductListParams` (data layer/utils), `StoreProduct` (still `Product & {…}`).

## Recommended next cluster
Product-card cluster: define `StoreProductSummary`/`StorePrice` and give `trackSelectItem`/GTM item builders, `WishlistButton`, `QuickView` and `AccountWishlist` structural parameter types (small, mechanical), then migrate ProductCard/Grid/Carousel/ListingAnalytics/SearchBar.

Branch `claude/commerce-h6-t1-3-product-listing` · Base `f3d9f5635` · Head: see PR. No merge, no deploy.
