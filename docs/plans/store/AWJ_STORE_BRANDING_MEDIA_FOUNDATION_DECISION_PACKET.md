# Decision Packet — Store branding media durability

**Status:** Resolved — owner selected Option 1 on 2026-09-26. No implementation is authorized.  
**Horizon:** AWJ Store Branding & Media Foundation — evidence pass only  
**Date:** 2026-09-26  
**Evidence:** `docs/plans/store/AWJ_STORE_BRANDING_MEDIA_FOUNDATION_EVIDENCE.md`  
**Verified `origin/main`:** `0f36355573b3de746211bd1bed0a6f888f0bba0a`

## Problem

Store logos, compact logos, and favicons are raster data URLs (or merchant-typed `https` URLs) inside the storefront presentation JSON, capped at 512 KiB each. That is durable because it sits in PostgreSQL. It is not a file foundation, and the cap is too small for real brand files.

AWJ already has one private file authority, `DocumentStorageService`. Production forces it onto the local container disk (`DOCUMENT_DURABLE_STORAGE_ENABLED=false`). `deploy/DEPLOY.md` says that disk can lose files when the container is replaced.

Moving branding onto that disk would make logos less durable than they are today. Opening the existing S3-compatible lock is a platform decision. It affects every current caller (product media, category images, document intake), not only the store customizer. This pass must not flip the lock or pick a vendor.

## Repository evidence

- Branding slots and caps: `StorefrontPresentationNormalizer` (`MAX_LOGO_BYTES`, `MAX_DOCUMENT_BYTES`, `sanitizeLogoUrl`).
- Public rendering: `publishedLogoUrl()` reads the published JSON. Favicon is edited in the customizer and is not applied as the document icon.
- Prior contract note: `storefront/src/lib/presentation/capabilities.ts` says the future object must be tenant-scoped branding media, not `company.logo` and not `GET store/v1/media/{id}`.
- File authority: `DocumentStorageService` writes `visibility=private`. When `persistent_enabled` is false it returns the local disk even if an S3 configuration is present.
- Production lock: `render.yaml` and `deploy/DEPLOY.md`. Activation later requires bucket, secrets, tests, and a file-migration policy.
- Catalog files are the wrong owner: `ProductMedia` is served publicly only when the product listing is published.
- Category images show the replace-then-delete pattern, on the same locked disk, behind an authenticated download.
- Document Center signed URLs expire within minutes and use `private, no-store`. Wrong lifetime for a logo.
- Import storage and employee photos are separate local-disk paths. Not candidates.

External provider research was not done. The repo already has an S3-compatible driver and an explicit deferral. Ranking R2 against S3 would be a vendor preference, not missing evidence.

## Options

1. **Keep data URLs until durable storage is authorized.** Logos stay in `published_config`. The 512 KiB cap and the SVG rejection stay. Banner stays an `https` URL. No upload endpoint. This does not meet the “real file foundation” objective. It does not lose logos on deploy.
2. **Authorize the existing durable-storage activation first, then extend `DocumentStorageService` for branding.** Not a new provider and not a second filesystem. A later branding slice may store a private object and publish it through a storefront-scoped proxy, only after the activation plan in `DEPLOY.md` is actually done. Existing data URLs and `https` values keep rendering until the merchant replaces that slot.
3. **Upload branding to the current local disk now.** Same ephemeral risk product images already carry. Rejected: published store identity would disappear on container replace, which data URLs do not do.
4. **Add a branding-only bucket or a new storage service.** Rejected: second filesystem, and it still needs the same owner decision about credentials and durability.

## Trade-offs

Option 1 leaves merchants inside a 512 KiB data-URL cap and leaves favicon rendering unfinished, but it changes nothing in production. Option 2 is the only option that can become a real media foundation, and it is larger than the store customizer: secrets, bucket, tests, and whatever already sits on the local disk. Option 3 looks like progress and fails the durability reason this pass exists. Option 4 splits the file authority the rest of AWJ already shares.

Public URL shape, retention, and schema are not separate owner choices if Option 2 is selected later. Evidence already fixes them: private object, proxy gated by the published snapshot, replace-then-delete, pointer inside the existing JSON, no 365-day logo expiry, no bulk rewrite of old data URLs.

## Recommendation

Do not implement in this pass.

If this packet is not answered, stay on Option 1. Silence must not start uploads.

If the owner wants the file foundation, the next authorized work is Option 2’s prerequisite only: the durable-storage activation plan already described in `deploy/DEPLOY.md`. Branding upload tasks stay blocked until that activation is merged and post-merge reviewed.

## Impact

- Backward compatibility: current data URLs and `https` logos unchanged.
- Tenant / security: unchanged. No new public route in this pass.
- Data / migration: none.
- Accounting / payments / tax: none.
- Deploy: none.

## What is not authorized

No runtime code, no database migration, no new bucket, no change to `DOCUMENT_DURABLE_STORAGE_ENABLED`, no production file migration, no deploy.

## Independent work that continues

None inside this pass. Offers stays on its resolved deferral. Undo, version history, Market, and Floral stay deferred. A favicon `<link>` that consumes the existing data URL is a separate rendering fix and is not started here.

## Owner decision

**Selected: Option 1 — keep embedded branding media until persistent storage is explicitly authorized.**

Stable decision key:

`KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`

This resolves the Store Branding & Media infrastructure gate for the current horizon without authorizing implementation.

### Effective behavior

- Keep current raster Data URL branding in the storefront presentation JSON, subject to the existing 512 KiB cap and existing SVG rejection.
- Keep existing merchant-entered `https` branding URLs supported.
- Keep banner media as the existing `https` URL contract.
- Do not add a branding upload endpoint yet.
- Do not move branding onto the current local container disk.
- Do not create a branding-only bucket or second storage service.
- Do not enable `DOCUMENT_DURABLE_STORAGE_ENABLED` as a side effect of Store Customizer work.
- Do not rewrite or migrate existing presentation documents.

### Future prerequisite

If persistent storage is later explicitly authorized, the next work is the platform durable-storage activation plan already described in `deploy/DEPLOY.md`, including bucket/secrets/tests and a file migration/retention policy as required.

Only after that prerequisite is merged and post-merge reviewed may a separate branding-upload slice extend the existing file authority for tenant-scoped storefront branding.

### Closure

The current Store Branding & Media evidence pass is closed with an owner-resolved deferral. The classification is no longer an open `INFRA_DECISION_REQUIRED` gate for this horizon; it is a documented deferred prerequisite.

No runtime code, database change, provider selection, upload path, production migration, or deploy is authorized by this decision.
