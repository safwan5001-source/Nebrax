# H6 / T1-2 — StoreCategory Presentation Types

Storefront only, type-only, zero intended runtime change. No orders/checkout/payment/accounting, migrations, backend/API or feature-gate changes.

## New types (`storefront/src/lib/commerce/types.ts`)
- `StoreCategoryNode` — AWJ-owned presentation node: field-for-field the subset of Spree `Category` the UI reads (id, name, permalink, position, depth, meta_*, children_count, parent_id, description(_html), image_url, square_image_url, is_root/child/leaf, recursive `parent`/`children`/`ancestors`). Spree-shaped values stay assignable structurally, no casts.
- `StoreCategory` — previously `import("@spree/sdk").Category & {color,image}`; now `interface StoreCategory extends StoreCategoryNode { color; image; recursive refs }`. Mapper output (`mappers.ts`) is unchanged and still satisfies it. `custom_fields` was dropped from the type (unused by any consumer; `tsc` confirms).

## Updated consumers
Breadcrumbs, Footer, Header, MobileMenu, CategoryBanner, `products/[slug]/page.tsx`, storefront `layout.tsx`, `presentation/public-navigation.ts`, `presentation/public-footer.ts`, `seo.ts` (all `Category` → `StoreCategoryNode`).

## Spree dependency counts
`spree_type_imports` **143 → 132 (−11)**: the ten consumers above (−1 each, one `seo.ts` specifier) and `commerce/types.ts` (2 → 1). Other categories unchanged (value 4, client 68, wrapper 77, env 9). Baseline diff shows decreases only.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` (full) | 238 files passed / 16 skipped; 3433 tests passed |
| Biome (changed files) | clean; repo-wide 5 warnings / 3 infos unchanged |
| `next build` | exit 0 |
| Spree ratchet | OK, baseline tightened |
| CI / CI Gate | see PR |

## Risks
Low (type-only). `custom_fields` no longer on `StoreCategory`; any future reader must add it to the AWJ type deliberately.

## Remaining category-related Spree imports
`lib/data/categories.ts` (`CategoryListParams`, `ProductListParams` — request-param types, wholesale/Spree data layer), `app/dev/*` pages and tests (excluded from ratchet or non-production).

## Next recommended cluster
Product listing presentation: `Product`/`PaginatedResponse`/`ProductFiltersResponse` in ProductCard/ProductGrid/ProductCarousel/InfiniteProductList/ProductListing/filters (~20 imports) via `StoreProduct`.

Branch `claude/commerce-h6-t1-2-store-category` · Base `799d09e3f` (origin/main incl. #1778 `d10c9d1fe`) · Head: see PR. No merge, no deploy.
