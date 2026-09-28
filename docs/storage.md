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

`config/filesystems.php` now defines a separate `r2` disk using Laravel's S3-compatible driver. It is private by default and is server-side only. The current default disk and existing flows are intentionally unchanged.

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

The R2 bucket remains private. A later migration slice must explicitly decide which flow, tenant-prefixed key contract, and server-side access policy will use this disk. This task does not migrate files, change database paths, expose raw bucket URLs, or switch any existing `Storage::disk(...)` call.
