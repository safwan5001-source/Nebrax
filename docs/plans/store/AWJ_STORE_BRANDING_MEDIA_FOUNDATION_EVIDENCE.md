# AWJ Store Branding & Media Foundation — Evidence

**Task:** STORE-BRAND-MEDIA-0  
**Status:** Evidence complete. No implementation. No deploy.  
**Verified `origin/main`:** `0f36355573b3de746211bd1bed0a6f888f0bba0a`  
(`docs(app-builder): define Real Mobile Preview horizon (#1041)`)  
**Documented pass base (older, not this HEAD):** `8881a8f3f4f86b4b62b7faca1f52cef91a21e4a2`  
**Governing pass:** `docs/plans/store/AWJ_STORE_BRANDING_MEDIA_FOUNDATION_PASS.md`

This pass read the tree at the verified HEAD above. It does not authorize a storage provider, a migration, a public API change, or a production deploy.

## Classification

`INFRA_DECISION_REQUIRED`

The product contract for store branding media already exists. The file authority AWJ would extend also already exists. What does not exist is a durable disk. Branding bytes that live in PostgreSQL today would become ephemeral if they were moved onto the current local filesystem. That is a platform lock, not a missing media design.

## What the code actually does

### Branding document (the live path)

`StorefrontPresentation` is `CompanyWide`, one row per storefront. Draft and published copies are separate JSON columns: `draft_config` and `published_config`. There is no branding file table.

`StorefrontPresentationNormalizer` keeps three slots:

| Slot | Contract | What is stored | What the public store uses |
|---|---|---|---|
| Store logo | `branding.logoDataUrl` | `https://…` or raster `data:image/(png\|jpeg\|jpg\|webp);base64,…` | `publishedLogoUrl()` |
| Compact logo | `branding.compactLogoDataUrl` | same sanitizer and cap | `publishedLogoUrl(..., compact=true)` when set |
| Favicon | `branding.faviconDataUrl` | same sanitizer and cap | Merchant control only. No published `<link rel="icon">` was found |

Rules already enforced on save:

- SVG data URLs are rejected.
- `http`, `javascript:`, and other non-https / non-raster-data values are dropped.
- Each logo string longer than `MAX_LOGO_BYTES` (524288, 512 KiB) becomes `null`.
- The whole presentation document is rejected above `MAX_DOCUMENT_BYTES` (1572864, 1.5 MiB). Three logos at the individual cap cannot fit together with the rest of the document.
- The server normalizer is the cap. The storefront `sanitizeLogoUrl` twin checks shape only; it does not re-apply the 512 KiB cap.

Public delivery today is not a file URL. `StorefrontConfigController` returns the published presentation snapshot on the anonymous storefront config read. Draft is not in that payload. Workspace draft/publish routes require `commerce.manage`.

`https` logos are remote URLs the merchant typed. AWJ does not fetch or proxy them.

Tests already round-trip the three data-URL slots through publish (`StorefrontPresentationPublishApiTest`). `storefront/src/lib/presentation/capabilities.ts` still labels `BRANDING_PERSISTENCE_CAPABILITY` as `design_only`, and the same file says data URLs round-trip until a tenant-scoped branding media object exists. The tests are the persistence evidence. The capability flag is stale wording, not a second store.

### Banner and other section images

Banner `content.imageUrl` is `https` only (`sanitizeExternalUrl`). There is no upload, no data URL, and no AWJ-owned object.

Benefits are `{id,title,body}`. Custom content is `heading|paragraph`. Neither has an image field. This pass does not invent one.

### Why the current branding path is the durable one

`deploy/DEPLOY.md` and `render.yaml` lock production as:

- `DOCUMENT_DURABLE_STORAGE_ENABLED=false`
- `DOCUMENT_STORAGE_DRIVER=local`
- `DOCUMENT_STORAGE_DISK=local`

`DEPLOY.md` states that the Render container disk is temporary and can lose files on rebuild or container replacement. That risk is accepted for the current development stage. `config/imports.php` repeats the same fact for import files and says real durability needs an S3-compatible driver plus an owner decision about the bucket and credentials. This pass does not make that decision.

A logo stored inside `published_config` survives a container replacement because PostgreSQL does. A logo stored only on the local disk does not.

## Current-state diagram

```text
Merchant (commerce.manage)
  PUT /api/commerce/workspace/storefronts/{id}/presentation
        │
        ▼
  StorefrontPresentationNormalizer
    logo / compact / favicon
      https URL ──────────────► kept if sanitizeExternalUrl accepts it
      raster data URL ≤ 512KiB ► kept inside draft_config JSON
      svg / oversize / other ──► null
    banner imageUrl ──────────► https only, no file
        │
        │ publish (commerce.manage, revision check)
        ▼
  published_config JSON  (PostgreSQL, CompanyWide, draft excluded)
        │
        ▼
  GET public storefront config
        │
        ▼
  publishedLogoUrl() → <img src="data:…"> or <img src="https://…">
  faviconDataUrl is stored and not applied as the tab icon

Product / category / document bytes (not used by branding)
  DocumentStorageService.put(visibility=private)
        │
        ├─ persistent_enabled=false  → Storage disk "local"  (forced)
        └─ persistent_enabled=true   → S3-compatible, only if key/secret/bucket/endpoint exist
        │
        ▼
  Private object. Public bytes only via a proxy that re-checks tenant + publication.
  No public bucket URL. No CDN URL in the product-media contract.
```

## Reusable paths

| Mechanism | Current owner/domain | Tenant scoped? | Public delivery | Upload validation | Cleanup | Reusable for Store branding? | Risk / gap |
|---|---|---|---|---|---|---|---|
| Presentation JSON data URL / https logo | `StorefrontPresentation` + normalizer. Store customizer. | Yes. `CompanyWide` + storefront tenant check on save. | Published snapshot on the public config read. Draft stays behind `commerce.manage`. | Raster allow-list, SVG rejected, 512 KiB per slot, 1.5 MiB per document. No transcoding. | Replace by writing a new JSON value. No object to orphan. | Yes, and it is the path in production today. It is not a file foundation. | Cap is small for real brand assets. Favicon is stored and not rendered. `https` logos are unowned remote URLs. |
| `DocumentStorageService` | Platform file authority. Private visibility. S3-compatible driver behind `persistent_enabled`. | Paths already embed `tenant_id` (`product-media/{tenant}/…`, `product-category-media/{tenant}/…`). Profile is single (`platform`). | Not public. Callers stream bytes themselves. | Callers validate. The service writes a stream and fails closed on a bad driver or missing S3 settings. | Callers delete. A failed delete of a replaced category image is reported and does not roll the pointer back. | Yes, as the file authority to extend later. Not usable for durable branding while the lock forces `local`. | `persistent_enabled` defaults false and `render.yaml` keeps it false. Local disk is ephemeral on Render. |
| `ProductMedia` + `ProductMediaService` | Catalog images for a product, an option value, or a variant. Max 8 per scope. | Yes. `CompanyWide`. `booted()` rejects cross-tenant option/variant links. | `/store/v1/media/{id}` only if a `CommerceListing` for that product is published on the resolved channel. `Cache-Control: public, max-age=3600`. `/commerce/v1` twin is `private`. `disk=document` is not a Laravel disk name; the controller resolves it through `DocumentStorageService`. | `jpg,jpeg,png,webp`, max 5120 KB. Client extension is used in the object key. No transcoding. | Row delete plus object delete. Files for a deleted variant are queued after commit. | No. A logo is not a product and must not depend on `CommerceListing.is_published`. Reuse would publish branding through the catalog gate or invent a fake product. | `ProductController` comments say `disk=document` means durable S3 rather than the Render disk. The lock in `DocumentStorageService::settings()` still forces `local` when `persistent_enabled` is false. The comment overstates durability. |
| Product category image | One image on `ProductCategory`, stored via `DocumentStorageService`. | Yes. Path includes `tenant_id`. Download is `findOrFail` under the authenticated API. | Private authenticated download. Not a storefront URL. | `jpeg,jpg,png,webp`, max 5120 KB. | New upload replaces the pointer, then deletes the old object. Category delete deletes the object. | Pattern only (replace-then-delete, private object, tenant path). Not the branding owner. | Same ephemeral disk. No public storefront delivery. |
| Document Center file | Intake batches, private documents. | Yes, document rows are tenant-owned. | Short signed URL (clamped 1–15 minutes, default 5) then `Cache-Control: private, no-store`. | Intake limits (size, pages, pixels). Not a logo allow-list. | `DOCUMENT_RETENTION_DAYS=365` in `render.yaml`. | No for lifecycle. A live logo must not expire in 5 minutes or 365 days. The storage service underneath is the same authority as above. | Wrong cache and retention semantics for a public store identity. |
| `ImportJobFileStorage` | Import CSV/XLSX. Explicitly independent of Document Center. | Operational, not storefront. | None. | Spreadsheet MIME, 5120 KB. | Prune after 14 days for finished jobs. | No. | `config/imports.php` already says `local` is not production durability. |
| Employee photo | HR. `Storage::disk('local')` under `employees/{id}`. | Employee row. | Authenticated `disk->response`. | `jpg,jpeg,png,webp`, max 5 MB. | Delete file on replace/clear. | No. Different domain, and it bypasses `DocumentStorageService`. | Ephemeral local disk with no S3 path. |
| Company `logo` | ERP company profile. `UpdateCompanyRequest` allows only `data:image/png;base64`, max 512000 characters. | Company row, not the storefront. | Not the storefront logo pipeline. | PNG data URL only. Stricter and different from store raster rules. | In-row replace. | No. `capabilities.ts` already forbids using `company.logo` as the store logo. | A second, narrower data-URL dialect. Do not merge the two. |

No image normalization or transcoding library is on these paths. Validation is MIME/type plus size.

No tenant-deletion sweeper for `DocumentStorageService` objects was found. Deleting a storefront cascades the presentation row (JSON only). That is fine today because branding bytes are in the row. It becomes an orphan gap if object keys are introduced and delete does not remove them.

## Security and tenant findings

- Workspace reads and writes of presentation require `commerce.manage`. A branding upload has to use that permission. No new permission is justified by this evidence.
- Public storefront tenant comes from `StorefrontContext` (host / channel resolution), not from a client-sent tenant id. `StorefrontMediaController` already depends on that plus `TenantScope`.
- Product-media objects are private. The public route re-checks publication and returns one 404 for missing and unpublished. Branding must not weaken that into “anyone who knows a UUID can fetch a draft logo.”
- Do not add an arbitrary remote-fetch proxy for banner or logo `https` URLs. AWJ stores the URL string and the browser loads it.
- SVG and non-image uploads stay rejected. Executable content is already out of the logo contract.
- Cross-tenant media references are already rejected for `ProductMedia`. A future branding key must be checked against the storefront’s tenant the same way, not trusted from the client body.
- Three full-size data URLs can trip the 1.5 MiB document cap even when each slot is under 512 KiB. That is a real limit of the current path, not a bug to patch in this pass.

## Backward compatibility

Existing `logoDataUrl`, `compactLogoDataUrl`, and `faviconDataUrl` values are the published contract. They must keep rendering.

This pass does not rewrite merchant JSON.

When a future implementation is authorized, old values should migrate only on the next explicit save of that slot:

- a data URL or `https` URL that the merchant has not replaced continues to render;
- a new upload replaces that one slot’s pointer;
- there is no bulk migration and no lazy rewrite of untouched stores.

No database migration is required to keep today’s documents valid. A new table is not required for a later reference either: an object key can live in the existing JSON beside the current string, and unknown keys are already dropped by the normalizer until a versioned reader allows them. Adding that reader is a contract change for a later task, not a schema migration.

## Provider decision

Not required, and not taken.

`DocumentStorageService` already builds an S3-compatible disk (key, secret, region, bucket, endpoint, path-style). `DEPLOY.md` says turning the lock to true needs a deliberate activation plan: bucket, secrets, tests, and a file-migration policy. Choosing R2 versus AWS versus another S3-compatible endpoint is an operational detail inside that existing driver. This pass does not research or rank providers.

A branding-only bucket would be a second filesystem. Rejected.

## What is already decided in this pass

These are AWJ decisions grounded in the current code. They are not owner escalations.

1. Do not reuse `ProductMedia` or `GET store/v1/media/{id}` for logos.
2. Do not reuse company `logo`, employee photos, import files, or Document Center signed URLs.
3. Do not add a second storage service or a branding-only provider.
4. When objects exist, delivery stays a private object plus a storefront-scoped proxy. Draft bytes are not public. Signed five-minute document URLs are the wrong lifetime for a logo.
5. `commerce.manage` remains the upload and publish gate.
6. Data URLs and `https` logos keep working until a merchant replaces that slot. No silent rewrite.
7. Banner stays an `https` URL. Benefits and custom content do not gain image fields here.
8. No transcoding in the foundation.
9. Document-center retention (365 days) must not apply to a live published logo.
10. Replace/delete follows the category-image pattern: move the pointer, then delete the previous object. Storefront deletion must delete branding objects if they exist. That hook does not exist today because there are no branding objects.

## Migration necessity

None in this pass. None to preserve current stores. A later object path still does not need a table migration if the pointer stays inside `draft_config` / `published_config`.

## Smallest safe implementation slice

Not safe to start now.

The smallest slice that would be safe after the infra lock is opened, and only then:

1. `STORE-DURABLE-STORAGE-ACTIVATION` — platform task, not a store-customizer task. Follow the activation plan already written in `deploy/DEPLOY.md`. Includes the fate of files already written to local disk. Branding does not start before this is merged and reviewed.
2. `STORE-BRAND-MEDIA-1` — `commerce.manage` upload of one raster (png/jpeg/webp) into `DocumentStorageService` at `storefront-branding/{tenant_id}/{storefront_id}/{uuid}.ext`, private visibility, size bounded by the presentation document budget. Pointer stored in the presentation JSON. No new table.
3. `STORE-BRAND-MEDIA-2` — public proxy that streams a logo only when the published snapshot references it and the storefront context tenant matches. Draft preview keeps using the workspace, not this route.
4. `STORE-BRAND-MEDIA-3` — replace and storefront-delete cleanup. Old data URLs and `https` values still render.

Do not build 2–4 on the current local disk. That would make the published logo less durable than it is today.

## Out of scope (confirmed untouched)

Promotions / Offers, undo/redo, version history, Market theme, Floral theme, customizer redesign, production deploy, remote image proxy, image transcoding, a new favicon renderer.

The favicon slot is saved and not applied as the tab icon. Fixing that rendering can stay on the current data-URL contract. It is not part of this pass and it does not remove the infra gate.

## Decision packet

`docs/plans/store/AWJ_STORE_BRANDING_MEDIA_FOUNDATION_DECISION_PACKET.md`

## Stop

No provider implementation. No migration. No merge of runtime code. No deploy.

`INFRA_DECISION_REQUIRED`
