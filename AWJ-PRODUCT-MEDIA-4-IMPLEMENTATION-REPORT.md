# AWJ-PRODUCT-MEDIA-4 — Wire Product Image Derivatives to Consumers

## Repository

- Base SHA: `37d462f54e091a4ba630b41ec3210b90e00e3b21` (`origin/main` at start).
- Implementation head SHA: `adf6cccae14a02b93265dd856be1747e7f4109cd`.
- Validation head SHA: `eeffede68b813e055e16f024ca585c9d5f8d8aa2`.
- Branch: `feat/awj-product-media-4-consumer-wiring`.
- PR: [#1247 — AWJ-PRODUCT-MEDIA-4 — Wire image derivatives to Storefront and POS](https://github.com/safwan5001-source/Nebrax/pull/1247).

## Consumer map

| Consumer | Previous source | New source | Fallback |
| --- | --- | --- | --- |
| Storefront ProductCard | `thumbnail_url` (original public media) | additive public `card_url` | existing `thumbnail_url` |
| Storefront PDP main gallery | original public media aliases | unchanged | unchanged |
| Storefront PDP thumbnails and variant media | original public media aliases | explicit `thumbnail_url` | existing original alias |
| POS product tile | authenticated `download_url` | additive authenticated `card_url` | `download_url` |
| POS variant picker (44 px compact selector) | authenticated `download_url` | additive authenticated `thumbnail_url` | `download_url` |

The Storefront card follows the 800 px card policy. The PDP main image keeps
the original/high-resolution behavior. No CSS ratio, `object-cover`, layout,
or image generation policy changed.

## Public/private boundaries

- ERP/POS derivative URLs remain under the existing `products.view` protected
  product-media route.
- Storefront receives separate public derivative URLs only through its existing
  host-resolved `/store/v1/media/{id}` boundary.
- The new public derivative route reuses the same tenant context and published
  `CommerceListing` check as the original route. It returns 404 for hidden,
  cross-tenant, malformed, and unsupported requests.
- The browser uses a same-origin Next proxy that forwards only the server-side
  storefront gateway headers. No ERP URL, raw R2 key, disk path, or client
  supplied storage path is exposed.
- A missing derivative is resolved at the media-serving boundary and streams
  the original, so legacy rows remain valid.

## API changes

- Storefront product responses add nullable `card_url`.
- Storefront detailed media/variant-media entries add `thumbnail_url` and
  `card_url`.
- POS `pos_image` and `pos_variants[].image` add explicit
  `thumbnail_url` and `card_url`.
- Existing `thumbnail_url`, `url`, `download_url`, and historical
  Spree-shaped aliases are unchanged. No schema or migration changed.

## Performance

- Catalog serialization constructs deterministic URLs only; it does not call
  derivative existence checks, storage probes, or make per-card/tile requests.
- POS keeps its existing eager-loaded media and batched variant-cover path; no
  query is added per product, variant, or image.
- Derivative existence is checked only when the requested media byte route is
  served, where legacy fallback is required.
- The client makes the existing image request only; no discovery/HEAD request
  layer was added.

## Tests

- PHP syntax: changed controllers, resources, routes, and focused feature
  tests — passed in PHP 8.3 Docker.
- Storefront focused tests: `npx vitest run src/lib/commerce/__tests__/mappers.test.ts src/components/products/__tests__/ProductCard.test.tsx` — 44 passed.
- Storefront Flowers contract test: `npx vitest run src/lib/commerce/__tests__/flowers-journey-contract.test.ts` — 7 passed.
- Storefront Biome and TypeScript: focused `biome check` and
  `npx tsc --noEmit` — passed.
- Storefront build: `npm run build` — passed. Missing local Commerce/Spree
  configuration emitted expected non-fatal static-generation warnings.
- POS focused tests: `npx vitest run src/components/pos/pos-product-tile.test.tsx src/components/pos/pos-variant-picker-dialog.test.tsx` — 22 passed.
- Web build: `npm run build` — passed.
- PR CI run 8175: `php artisan test` passed for both Laravel 11/SQLite and
  Laravel 11/PostgreSQL after CI assembled the runtime.
- PR CI: Storefront CI run 537, Web CI run 3625, and Store Brand QA run 167
  passed.
- Added/extended backend coverage covers published derivative delivery,
  legacy original fallback, unpublished rejection, cross-tenant rejection,
  malformed derivative routes, POS card URLs, and POS variant thumbnail URLs.
- The first CI attempt correctly detected that additive `card_url` fields
  needed the closed OpenAPI schemas and Flowers shared response contracts.
  Those contracts were updated in `eeffede6`; the subsequent full CI run
  passed on both database engines.

## Files changed

- `app/Http/Controllers/Api/PosController.php`
- `app/Http/Controllers/Api/ServesProductMediaBytes.php`
- `app/Http/Controllers/Api/StorefrontMediaController.php`
- `app/Http/Resources/ProductResource.php`
- `app/Http/Resources/StorefrontProductResource.php`
- `routes/api_storefront.php`
- `storefront/src/app/api/storefront/media/[id]/derivatives/[derivative]/route.ts`
- Storefront product media types, mapper, card/gallery consumers, and focused tests.
- POS product tile/variant-picker consumers and focused tests.
- `tests/Feature/StorefrontDomainMediaVisibilityTest.php`
- `tests/Feature/PosVariantMediaTest.php`
- `tests/Feature/ProductBarcodeAndMediaTest.php`
- `docs/openapi/commerce-api-v1.yaml`
- `contracts/flowers-journey/01-product-list.json`
- `contracts/flowers-journey/02-product-detail.json`

## Risks / remaining

- No backfill was run. Legacy media deliberately uses the original fallback.
- Public derivative storage is still private and publication-gated; the public
  route is only a byte-delivery boundary, not a bucket/CDN change.
- The final implementation CI run passed on both supported test databases.

## Next recommended task

No automatic follow-up is needed. Future work, if separately prioritized, can
consider delivery/CDN caching policy without changing derivative semantics.
