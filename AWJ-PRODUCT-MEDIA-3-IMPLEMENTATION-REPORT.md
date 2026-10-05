# AWJ-PRODUCT-MEDIA-3 — Secure Product Image Derivative Foundation

## Repository

- Base SHA: `b0c3574225531ed907991bd9c5f23a7e8f5d66bb` (`origin/main` at implementation start).
- Implementation head SHA: `5a32eb47bd19ca6075b3c0f947bbf24fea6817e0`.
- Local implementation commit: `8a6698b19b096412bc5b8a79d6d45199dafe65eb`.
- Branch: `feat/awj-product-media-3-derivatives`.
- PR: [#1235 — AWJ-PRODUCT-MEDIA-3 — Add secure product image derivatives](https://github.com/safwan5001-source/Nebrax/pull/1235).

The GitHub PR branch was created from GitHub's then-current `main`
(`ac67e67add4e2edb3887d7812e931aeca12c09c7`). Each file changed by this
slice was verified to be identical between that base and the fetched
`origin/main` implementation base before publication.

## Architecture

- Upload path: `ProductController::storeMedia()` remains HTTP-only and calls
  `ProductMediaService::attachToProduct()`.
- Derivative class: `ProductMediaDerivativeService` owns decode, EXIF-safe
  orientation, scale-down, encoding, and per-derivative duration collection.
- Timing: generation is synchronous inside the established upload path. No
  queue was added.
- Storage flow: `ProductMediaService` writes original, thumbnail, and card
  through the same existing document/R2 abstraction, then saves the
  `ProductMedia` row.
- Fallback: the protected derivative endpoint returns the original when an
  old row has no derivative. Existing `download_url` stays unchanged.

## Derivatives

| Name | Maximum longest axis | Rationale |
| --- | ---: | --- |
| `thumbnail` | 200 px | Falls inside the required 160–240 px range and matches the compact variant/cart/selector role. |
| `card` | 800 px | The Storefront `ProductCard` evidence requests up to 260 CSS px (`md:h-52`, `sizes` up to 260 px); 800 px retains high-density headroom. It also safely supports the existing POS product-tile evidence without changing its ratio or consumer. |

- Images use Intervention Image with the verified GD driver and
  `orient()->scaleDown(width: ..., height: ...)`.
- Aspect ratio is preserved; nothing is forced square or cropped.
- `scaleDown()` prevents enlargement of small originals.
- Derivatives preserve accepted source encoding: JPEG remains JPEG (quality
  85), PNG remains lossless PNG, and WebP remains WebP (quality 82). AVIF and
  broad WebP conversion are not introduced.
- The uploaded original is never transformed or overwritten.

## Storage

- Original location behavior is unchanged.
- Document-backed paths are deterministic and record-bound:
  `product-media/{tenant}/{product}/derivatives/{media-id}/{thumbnail|card}.{ext}`.
- R2 uses the existing tenant-scoped `R2StorageService` and a deterministic
  record-bound object name: `{media-id}-{thumbnail|card}.{ext}` in the same
  product-media domain/product scope as the original.
- No derivative has a public bucket URL or local-only permanent location.
- Single-media deletion removes thumbnail and card before the original;
  product/option/variant lifecycle cleanup applies the same removal after its
  database transaction commits.

## Database / model

- No schema change or migration was required.
- There is no metadata backfill: paths are predictable from the existing row,
  its source MIME type, and its stable media ID.
- Legacy rows remain valid. Missing or unsupported historical derivative
  paths fall back to the original protected download endpoint.

## Security

- Tenant isolation remains anchored at tenant-scoped `Product::findOrFail()`
  and the existing document/R2 storage abstractions.
- Derivative reads use a new protected route with exactly the existing
  `products.view` permission; writes/deletes keep `products.manage`.
- The API exposes only protected application URLs, never an R2 or storage
  bypass URL.
- Tests cover cross-tenant read/delete rejection, unauthenticated rejection,
  same-tenant insufficient-role rejection, tenant-scoped paths, and deletion
  isolation.

## Tests

Commands/results:

- `git diff --check` — passed.
- `docker run --rm --mount type=bind,src=/workspace/Nebrax,dst=/core,readonly php:8.3-cli ... php -l ...` — passed for all ten changed PHP files.
- Focused derivative coverage added in `ProductMediaDerivativeTest`: JPEG,
  PNG, WebP, portrait/landscape geometry, no-upscale, dimension bounds,
  legacy fallback, deletion, authorization, and cross-tenant isolation.
- Existing R2 write/delete and bulk lifecycle-cleanup tests were extended for
  both derivative objects.
- The local production Docker Runtime Smoke could not start: Composer failed
  before Laravel assembly on the managed environment's untrusted TLS chain
  (`curl error 60`). No insecure TLS workaround was introduced.
- GitHub Actions CI run `8053` is queued for PR #1235 at the time of this
  report. It runs the Laravel suite on SQLite and PostgreSQL and is the
  authoritative Docker-independent runtime verification for this repository.

## Performance

- Each upload produces two derivatives sequentially: two source decodes and
  two encodes. The original is stored intact and never decoded for mutation.
- Only one decoded derivative image is retained at a time; encoded bytes are
  persisted before the next derivative begins.
- Focused tests record a positive synchronous processing duration without
  asserting or inventing a production performance number.
- For this first two-size, 5 MB-limit slice synchronous generation is the
  smallest safe implementation. Future production latency/memory telemetry
  should determine whether async processing is warranted; no queue
  infrastructure is added here.

## Files changed

- `app/Http/Controllers/Api/ProductController.php`
- `app/Http/Resources/ProductMediaResource.php`
- `app/Services/ProductLifecycleService.php`
- `app/Services/ProductMediaDerivativeService.php`
- `app/Services/ProductMediaService.php`
- `routes/api.php`
- `tests/Feature/ProductMediaDerivativeTest.php`
- `tests/Feature/ProductMediaR2BulkCleanupSemanticsTest.php`
- `tests/Feature/ProductMediaR2DeleteTest.php`
- `tests/Feature/ProductMediaR2WriteTest.php`
- `AWJ-PRODUCT-MEDIA-3-IMPLEMENTATION-REPORT.md`

## Risks / remaining

- Existing media intentionally has no backfill; it continues to serve the
  original through the documented fallback.
- No Storefront, PDP, POS, or other consumer has been switched to a
  derivative in this PR.
- The local managed environment's Composer TLS issue prevents a local
  production-image smoke run; it is unrelated to source behavior and remains
  visible in CI verification.

## Next task

`AWJ-PRODUCT-MEDIA-4 — Wire thumbnail/card derivatives to consumers`

This task does not implement MEDIA-4, merge the PR, deploy, or release to
production.
