# H6 / T1 — AWJ Catalog Presentation Types (first cluster: media)

**Scope:** storefront only, type-only, no runtime change. No orders/checkout/payment/accounting, no migrations, no backend APIs, no feature-gate changes.

## Types introduced
- `StoreMedia` (`storefront/src/lib/commerce/types.ts`): AWJ-owned presentation type for one media item (id, variant_ids, position, alt, original/mini/small/medium/large/xlarge URLs, optional thumbnail_url). It is a structural subset of the Spree `Media` that `mappers.ts` still produces, so no cast or adapter is needed; mappers are untouched (adapter boundary stays for a later cluster).

## Cluster chosen
Smallest cluster still importing a Spree type with no other coupling: **media presentation** (gallery, lightbox, JSON-LD image list, PDP gallery selection).

## Files changed
`src/lib/commerce/types.ts`, `src/components/products/MediaGallery.tsx`, `src/components/products/MediaLightbox.tsx`, `src/lib/seo.ts`, `src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx`, `scripts/spree-ratchet/baseline.json`.

## Spree dependencies removed
`spree_type_imports` 147 → **143** (MediaGallery −1, MediaLightbox −1, ProductDetails 3→2, seo.ts 3→2). Other categories unchanged (value 4, client 68, wrapper 77, env 9). Baseline diff shows decreases only.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` (full storefront) | 238 files passed / 16 skipped; 3433 tests passed |
| `biome check` on changed files | clean (repo-wide lint: 5 warnings, 3 infos, none in changed files) |
| `next build` | exit 0 |
| Spree ratchet | OK; baseline tightened |
| CI | see PR |

## Behavior preservation
Same URL fallback chains, alt text, variant-image selection and JSON-LD output; only the declared type changed. Product data, variants, prices, availability, ar/en and RTL paths are not touched.

## Risks
Low: type-only. A future change to Spree `Media` could no longer break these consumers; the mapper still returns Spree `Media`, checked structurally by `tsc`.

## Next recommended cluster
Category presentation (`Category`: Breadcrumbs, Footer, Header, MobileMenu, CategoryBanner, layout, public-navigation/footer) — ~10 imports, single type, same technique via `StoreCategory`.

## Branch / PR
Branch `claude/commerce-h6-t1-catalog-types` · Base `7ce615a31` · Head: see PR.
No merge, no deploy.
