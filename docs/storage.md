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

### Manual smoke test status

No production smoke test was run. A real R2 smoke command is intentionally not included in this slice; the service is manually invocable by a future, separately reviewed diagnostic surface only. The automated tests use a mocked AWS client and prove that write/read/existence/delete send only `PutObject`, `GetObject`, `HeadObject`, and `DeleteObject` parameters without ACL fields. CI never requires real Cloudflare credentials.
