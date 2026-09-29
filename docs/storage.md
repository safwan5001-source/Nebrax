# Storage contract

## Current Laravel storage behavior

The repository is a Laravel core that is assembled into a Laravel 11 application at build time. The current generated filesystem contract remains unchanged:

- `local` is the default disk and stores private local files.
- `public` is the existing public local disk.
- `s3` remains the existing AWS-compatible disk and keeps its `AWS_*` environment contract.
- `document` is a logical value stored in existing media/attachment rows. It is resolved by `DocumentStorageService`; it is not a direct `Storage::disk('document')` disk.
- Product media paths are tenant-prefixed (`product-media/{tenant_id}/{product_id}/...`) and are served through authenticated API download endpoints. Existing media uploads, reads, and deletes continue to resolve through the current local document-storage profile **unless the row's `disk` column reads `r2`** — see "Product Media R2 migration" below.
- All other flows (invoices, documents, generic attachments, storefront assets) still select no `r2` disk at all.

## Cloudflare R2 foundation disk

`config/filesystems.php` now defines a separate `r2` disk using Laravel's S3-compatible driver. The disk deliberately does not declare a `visibility` option: Cloudflare R2 does not implement S3 object ACL APIs, while the Laravel/Flysystem S3 adapter maps visibility to ACL behavior. Privacy is enforced by the private R2 bucket and scoped credentials, and the disk is server-side only. The current default disk and existing flows are intentionally unchanged.

Configure these values in the runtime environment only; do not commit credentials:

```dotenv
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=your-r2-bucket
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_REGION=auto
# Optional; leave false for the normal R2 endpoint behavior.
R2_USE_PATH_STYLE_ENDPOINT=false
```

The R2 bucket remains private. The standard Laravel/Flysystem S3 adapter is not used for runtime R2 writes because its visibility layer can derive ACLs and call `GetObjectAcl`/`PutObjectAcl`. The narrow `R2StorageService` proof path uses the AWS SDK S3 client directly and exposes only `put`, `get`, `exists`, and `delete`; it never sends `x-amz-acl`, calls ACL operations, sets visibility, generates public URLs, or lists the bucket.

### Runtime key and tenant contract

Future R2 objects use the server-derived key shape:

```text
tenant/{tenant_id}/{domain}/{resource_id}/{filename}
```

`R2StorageService` reads `{tenant_id}` only from the scoped `TenantContext`; callers cannot provide a tenant prefix or arbitrary object key. Every segment is restricted to safe single-segment characters, so traversal such as `../` and embedded separators is rejected. No controller receives bucket-listing capability. This foundation slice does not migrate data by itself. **Product Media is the first consumer**, and category images now reuse the same private tenant-scoped R2 boundary for new writes when their own flag is enabled. Documents, invoices, generic attachments, and unrelated storefront assets remain out of scope.

### Manual smoke test command

`php artisan awj:r2-smoke-test` is a **manual-only operator diagnostic**. It is not
called by application boot, migrations, CI, deployment/Railway startup, scheduled
jobs, HTTP routes, or queue workers.

The command creates one internally generated temporary object with this exact
contract:

```text
system/r2-smoke-test/{uuid}.txt
```

The UUID, complete key, and tiny non-sensitive payload are generated internally;
there is no key, prefix, tenant identifier, or customer data input. The command
uses only the ACL-free AWS operations `PutObject`, `HeadObject`, `GetObject`, and
`DeleteObject`, in the order write → confirm exists → read/compare → delete →
confirm missing. It never lists objects/buckets, generates URLs, calls visibility
or ACL APIs, sends an ACL field/header, or touches `tenant/*` data.

Cleanup is mandatory. After a successful write, any later failure triggers a
delete of the exact generated key and a missing-object confirmation. A cleanup
failure returns a non-zero exit code and reports only the safe temporary key,
stating that the object may remain; credentials, request structures, and raw
exceptions are never printed. Missing configuration also fails before a network
operation.

The focused automated tests use a mocked AWS client and require no real R2
credentials or network calls. A real Production smoke test has already passed
(write/exists/read/delete/cleanup all PASS) against the `awj-production`
Cloudflare R2 bucket, with `nibras-api`'s Railway R2 variables configured
(AWJ-R2-3). Production execution of the smoke test remains a manual, explicit
operator action; it is never invoked automatically.


## Category image durability

Product-category images can opt into the same private R2 credentials without a
schema migration. New writes are controlled by
`CATEGORY_MEDIA_R2_ENABLED` (`config/category_media.php`) and use:

```text
tenant/{tenant_id}/product-category-media/{category_id}/{filename}
```

The filename is server-generated. The original merchant filename never becomes
part of the object key. The existing `image_path` column remains the pointer:
R2-backed paths have the server-derived `tenant/.../product-category-media/...`
shape, while legacy local/document paths keep their old
`product-category-media/{tenant_id}/{category_id}/...` shape. Reads and
deletes branch from that stored shape, so existing rows remain backward
compatible and no database migration is required.

Both authenticated AWJ downloads and public storefront category-media reads keep
their existing authorization/publication checks before touching storage.
`R2StorageService` reconstructs the tenant prefix from `TenantContext`; it
never trusts a caller-supplied tenant prefix or exposes a public bucket URL.

Production cutover is explicit: keep the flag off until the R2 credentials are
confirmed, then set `CATEGORY_MEDIA_R2_ENABLED=true`. Images whose old local
bytes were already lost during a previous ephemeral-container replacement cannot
be reconstructed by this change and must be uploaded once more after cutover.


## Product Media R2 migration (AWJ-R2-4)

Product Media (`app/Models/ProductMedia.php`) is the first real consumer of
`R2StorageService`. The migration is scoped to Product Media only — invoices,
generic documents/attachments, and storefront assets are untouched and keep
using `DocumentStorageService` exclusively.

### Architecture

`ProductMedia.disk` (an existing column, no schema change) is the single
source of truth for which backend a row lives on:

- `disk = 'document'` — legacy path, resolved through `DocumentStorageService`
  (local disk in dev/test, S3-compatible profile when
  `document_center.storage.persistent_enabled` is on).
- `disk = 'r2'` — new path, resolved through `R2StorageService`.
- Any other value (e.g. a raw local disk name from very old rows) — resolved
  through `Storage::disk($media->disk)`, unchanged from before this epic.

Every read, write, and delete site branches on this column. There is no
migration flag stored anywhere else, and no inference from file content or
extension.

### New write behavior (R2-4A)

New Product Media uploads go to R2 only when the `product_media.r2.enabled`
config flag is **on**. It defaults to **off**
(`PRODUCT_MEDIA_R2_ENABLED` env var, `config/product_media.php`), so merging
and even deploying this code changes nothing in Production until the flag is
explicitly flipped — a deliberate rollback lever that needs no redeploy.

Two write sites route through this flag identically:

- `ProductController::storeMedia()` — the product-level upload endpoint
  (`POST /api/products/{id}/media`).
- `ProductMediaService::store()` — the option-value/variant-scoped media
  writer (`attachToOptionValue()`/`attachToVariant()`).

When enabled, each file is read fully into memory (uploads are already capped
at 5 MB by `StoreProductMediaRequest`) and written via
`R2StorageService::put('product-media', $product->id, $filename, $bytes, $mimeType)`,
where `$filename` is a server-generated `Str::uuid().'.'.$extension` — the
caller's original filename never reaches the object key. The resulting row
gets `disk = 'r2'` and `path` = the full server-derived key. When disabled,
behavior is byte-for-byte what it was before this epic (`disk = 'document'`).

### Backward-compatible reads (R2-4B)

`ProductController::downloadMedia()`, `CommerceMediaController::show()`
(`/commerce/v1/media/{id}`), and `StorefrontMediaController::show()`
(`/store/v1/{tenantSlug}/media/{id}`) each gained one additional branch:

```php
if ($media->disk === 'r2') {
    $body = $this->r2->get(ProductMedia::R2_DOMAIN, (string) $media->product_id, basename($media->path));
    return response()->streamDownload(fn () => print((string) $body), ...);
}
```

placed alongside the existing `document` branch and ahead of the legacy
`Storage::disk($media->disk)` fallback, so a product's gallery can freely mix
`document` and `r2` rows — each row is served from whichever backend it
actually lives on. Existing authorization and tenant-isolation checks
(`Product::findOrFail`, publish/channel gating) run unchanged before the disk
branch is ever reached. A missing/failed R2 read returns the same
non-revealing 404 the `document` branch already returns for a missing file.

### R2 read behavior

`R2StorageService::get()` returns the AWS SDK response body (a PSR-7 stream
in production, whatever the test double returns in tests). All three read
sites cast it once with `(string) $body` before streaming it back — simple
and safe given the 5 MB upload cap, and it works uniformly whether the value
is a real stream or a plain string in tests.

### Delete behavior (R2-4D)

Every delete site — `ProductController::destroyMedia()`, `ProductMediaService::delete()`,
and `ProductMediaService::deleteFiles()` — gained an `r2` branch that calls
`R2StorageService::delete(ProductMedia::R2_DOMAIN, $productId, basename($path))`
— the exact object for that row, never a prefix or a listing. Cross-tenant
delete is impossible for the same reason cross-tenant read is: the row is
resolved through the normal tenant-scoped Eloquent relation before any
storage call happens. There are two different, deliberately different,
consistency guarantees depending on which site is involved — this PR
preserves both exactly as they already existed for the `document` and
legacy-disk branches, and only adds the matching `r2` branch to each:

- **Direct single delete** (`ProductController::destroyMedia()`,
  `ProductMediaService::delete()`, both driving the same single-media
  DELETE endpoint/call): storage delete happens **before** the
  `ProductMedia` row is deleted, and a failed storage delete **throws**,
  so the row survives. A storage failure here can never silently desync
  the database from the bucket.
- **Bulk lifecycle cleanup** (`ProductMediaService::collectAndQueueDeletion()`
  + `deleteFiles()`, used by `ProductVariantService` when an option, an
  option value, or a variant is deleted — the same pattern
  `ProductLifecycleService::delete()` already used before this epic): the
  `ProductMedia` rows are deleted **inside the caller's DB transaction**
  first, and the actual storage objects are cleaned up **after that
  transaction commits**, on a best-effort basis. A storage failure here is
  caught and reported (`report($exception)`), **not** re-thrown — it never
  rolls back the already-committed parent deletion (the option/value/
  variant is gone regardless). This is an intentional, pre-existing
  architectural choice (external storage I/O is kept out of the DB
  transaction so a slow or unavailable backend can never hold a lock or
  block a cascade delete), not something this PR introduced or weakened —
  the `r2` branch added here simply matches the `document` and legacy-disk
  branches that already behaved this way. A storage failure in this path
  can leave an orphaned object in the bucket (with no `ProductMedia` row
  pointing to it); this is the existing, accepted tradeoff for every disk
  type this path handles, not an R2-specific gap.

### Key contract

```text
tenant/{tenant_id}/product-media/{product_id}/{filename}
```

`{tenant_id}` comes from `TenantContext` only, `{product_id}` comes from the
already tenant-scoped `Product`/`ProductMedia` row, and `{filename}` is
always server-generated. No caller-supplied value ever reaches the key.

### Backfill command (R2-4C)

`php artisan awj:product-media-r2-backfill --tenant=<uuid> [--limit=200] [--dry-run]`
(`App\Services\ProductMediaR2BackfillService`) copies one tenant's legacy
Product Media rows to R2:

- **Manual only** — not wired into boot, migrations, deploy, scheduler, or
  queue workers.
- **Tenant-scoped and batch-bounded** — `--tenant` is required and validated
  as a UUID; `--limit` defaults to 200 and is capped at 2000.
- **Idempotent** — it only ever queries rows where `disk != 'r2'`, so a row
  already migrated is never revisited by a later run; safe to re-run after a
  partial failure.
- **Integrity-verified** — after `put()`, it confirms the object exists
  (`HeadObject`) and then reads it back (`GetObject`) and compares a SHA-256
  hash of the source bytes against the read-back bytes with `hash_equals()`;
  the `ProductMedia` row is only flipped to `disk = 'r2'` when both checks
  pass. A mismatch leaves the row on its legacy disk and reports
  `failed_integrity_mismatch`.
- **Never deletes the legacy source** — out of scope for this epic by
  design; the row keeps whatever legacy bytes it had, now duplicated on R2.
- **Never lists the bucket and never accepts a raw object key** — every key
  is derived the same way the live write path derives it, from the row's own
  `product_id` and a safe filename.
- **Never touches another tenant, another file domain, or another model** —
  the service only ever queries and updates `ProductMedia` rows within the
  one tenant passed on the command line.
- **Dry-run exists** — `--dry-run` reports what would happen (`would_migrate`
  per row) without calling R2 or writing to the database.
- Produces a structured table (`media_id`, `product_id`, `source_disk`,
  `status`) plus a summary count per status; exits non-zero if any row
  reports a `failed_*` status.

### Rollback / fallback strategy

- **New writes**: flip `PRODUCT_MEDIA_R2_ENABLED` back to `false` (or leave
  it unset). No code change or redeploy needed; the next upload goes back to
  `disk = 'document'` immediately.
- **Already-migrated rows**: reads keep working regardless of the flag,
  because the read branch is keyed off each row's own `disk` column, not the
  write flag. Turning the write flag off does not "un-migrate" rows already
  on R2, and does not break reading them.
- **Backfill**: since it never deletes the legacy source, a backfilled row
  can always be manually reverted (`UPDATE product_media SET disk = 'document', path = '<original path>'`)
  if ever needed, because the original bytes were never touched.

### Coexistence

A single product's gallery can contain a mix of `document`- and `r2`-backed
rows indefinitely — there is no requirement or expectation that a tenant (or
even a single product) is ever "fully migrated." Every read/write/delete
site treats each row independently by its own `disk` value.

### Production cutover checklist (not executed by this PR)

1. Confirm `R2_*` Railway variables are present for `nibras-api` (already
   true per AWJ-R2-3).
2. Set `PRODUCT_MEDIA_R2_ENABLED=true` in Production — new uploads start
   going to R2 immediately, legacy rows keep reading from their existing
   backend.
3. Verify a handful of new uploads end-to-end (create → list → download →
   delete) in Production.
4. When ready to backfill: run
   `php artisan awj:product-media-r2-backfill --tenant=<uuid> --dry-run`
   first per tenant, review the report, then re-run without `--dry-run`.
   Repeat per tenant/batch as needed; it is safe to re-run and safe to
   interleave with live traffic (idempotent, additive only).
5. Legacy source deletion is a **separate, future, explicitly out-of-scope**
   decision — not part of this checklist.

### What remains before R2 is authoritative

- Legacy source deletion after backfill (explicitly out of scope for this
  epic).
- A background/queued backfill worker — today's command is synchronous and
  manual, consistent with `QUEUE_CONNECTION=sync` in Production today.
- Extending this same pattern to any other file domain (documents, invoices,
  storefront assets) — each would need its own explicit epic; nothing here
  changes their behavior.
