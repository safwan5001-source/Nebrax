# Storage contract

## Current Laravel storage behavior

The repository is a Laravel core that is assembled into a Laravel 11 application at build time. The current generated filesystem contract remains unchanged:

- `local` is the default disk and stores private local files.
- `public` is the existing public local disk.
- `s3` remains the existing AWS-compatible disk and keeps its `AWS_*` environment contract.
- `document` is a logical value stored in existing media/attachment rows. It is resolved by `DocumentStorageService`; it is not a direct `Storage::disk('document')` disk.
- Product media paths are tenant-prefixed (`product-media/{tenant_id}/{product_id}/...`) and are served through authenticated API download endpoints. Existing media uploads, reads, and deletes continue to resolve through the current local document-storage profile.
- No existing flow selects the `r2` disk in this foundation slice.

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

`R2StorageService` reads `{tenant_id}` only from the scoped `TenantContext`; callers cannot provide a tenant prefix or arbitrary object key. Every segment is restricted to safe single-segment characters, so traversal such as `../` and embedded separators is rejected. No controller receives bucket-listing capability. This slice does not migrate data or switch Product Media, documents, invoices, attachments, or storefront assets to R2.

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
credentials or network calls. **No real Production smoke test has occurred.**
Production execution requires explicit owner approval after the R2 environment
variables (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`,
`R2_REGION`, and `R2_USE_PATH_STYLE_ENDPOINT`) are added directly to the approved
runtime environment.
