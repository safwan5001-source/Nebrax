# AWJ-PRODUCT-MEDIA-3 — Secure Product Image Derivative Foundation

## Repository

- Base SHA: `b0c3574225531ed907991bd9c5f23a7e8f5d66bb` (`origin/main` at implementation start).
- Implementation head SHA: `5a32eb47bd19ca6075b3c0f947bbf24fea6817e0`.
- Local implementation commit: `8a6698b19b096412bc5b8a79d6d45199dafe65eb`.
- Follow-up implementation head: `71a9e4f1ec06a594b1f16849ef7a38cbb3f97291`.
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
  It uses Intervention v4's verified `decodePath()` and
  `encodeUsingMediaType()` APIs.
- Timing: generation is synchronous inside the established upload path. No
  queue was added.
- Storage flow: `ProductMediaService` writes original, thumbnail, and card
  through the same existing document/R2 abstraction, then saves the
  `ProductMedia` row. A save exception triggers best-effort compensating
  deletion before that same exception is rethrown.
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

## Save-failure compensation follow-up

- Review finding: original, thumbnail, and card could be stored successfully
  before `ProductMedia::save()` threw, leaving orphaned objects without a row.
- Fix: only the `save()` call is wrapped. On an exception, the existing
  best-effort storage cleanup removes generated derivatives and the original.
  A cleanup error is reported but cannot replace the save exception.
- Exception behavior: the exact original exception object is rethrown; model
  guards, database errors, and tenant-isolation errors are not converted to a
  generic storage exception.

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
- Follow-up focused PHP 8.3 syntax check for `ProductMediaService.php` and
  `ProductMediaDerivativeTest.php` — passed.
- Focused derivative coverage added in `ProductMediaDerivativeTest`: JPEG,
  PNG, WebP, portrait/landscape geometry, no-upscale, dimension bounds,
  legacy fallback, deletion, authorization, and cross-tenant isolation.
- Existing R2 write/delete and bulk lifecycle-cleanup tests were extended for
  both derivative objects.
- Regression test `a_product_media_save_failure_cleans_stored_files_and_rethrows_the_same_exception` forces a `ProductMedia::saving` exception only
  after original, thumbnail, and card are present. It verifies the same
  exception object/message is rethrown, all three objects are removed, and no
  row persists on the document/local path.
- The local production Docker Runtime Smoke could not start: Composer failed
  before Laravel assembly on the managed environment's untrusted TLS chain
  (`curl error 60`). No insecure TLS workaround was introduced.
- GitHub Actions CI run `8055` exposed two PR-owned compatibility issues:
  `ImageManager::read()` is unavailable in the installed Intervention v4
  runtime, and the existing R2 contract expects an explicit
  `$disk = 'document'` default. The follow-up changes `read()` to
  `decodePath()` and restores that behavior-neutral default.
- Follow-up CI run `8065` confirmed the decoder correction, then exposed the
  matching v4 encoder difference: `Image::toJpeg()` is unavailable. The
  derivative service now uses `encodeUsingMediaType()` with the same JPEG/WebP
  quality values and the existing PNG default behavior.
- CI run `8087` reached the full suite and confirmed transformation execution.
  Its remaining failures were two test defects (selecting the first media after
  a second upload, and retaining an auth header in an unauthenticated check)
  plus one manually constructed `ProductLifecycleService` test double that
  needed the service's existing `ProductMediaService` dependency.
- CI run `8093` left one relevant failure: its unauthenticated derivative URL
  assertion used a non-JSON request after flushing headers, so Laravel attempted
  to redirect to the unavailable `login` route. The regression test now uses
  `getJson()`, exercising the intended API 401 behavior without changing routes
  or authorization semantics.
- CI run `8101` passed both full Laravel test jobs (`sqlite` and `pgsql`) for
  the updated PR branch, including the save-failure cleanup and protected
  derivative URL regression coverage.

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
- `tests/Feature/ProductImportV2Test.php`
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
