# CUST-HV V2a — Customizer Media Library (foundation) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V2a** — first of three V2 sub-slices (see "Why V2 is split") |
| **Branch** | `cust-hv/v2a-media-foundation` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `df85e5a75af37bce171388b2f554b9cf670630fd` (`origin/main`, Flowers H2-11 #1251) |
| **Authority** | V0 contract §7 (Contract E), §19.0, AMEND-1/2/5/12/16/21; Master Execution §6 (V2) |
| **Depends on** | V0 only. **Independent of V1A (#1252)** — no shared files. |

### Why V2 is split

V2 as written in the V0 slice table covers: the data model, R2 domain, the full CRUD API, signed workspace reads, the same-origin public proxy with published-reference gate, the base-variant **and** transform-derivative pipelines, derivative orchestration + readiness proof, publish-time verification, the reconciler and the tenant/cache test matrix. That is not one reviewable PR (and the V0 text itself forbids merging V2 before the orchestration is *proven*). Splitting along real seams, each independently mergeable and additive:

| Sub-slice | Scope | Status |
|---|---|---|
| **V2a** (this) | `storefront_media`, upload/list/patch/delete/usage/retry API, **base-variant ladder + the single imaging path (N-1)**, EXIF orientation, signed workspace reads, quota, reference scanner, tenant + RBAC suites | **done — PR open** |
| V2b | `storefront_media_derivatives`, `transformKey` identity (incl. `zoom`), **derivative orchestration selected and proven**, per-usage retry/readiness | next |
| V2c | Public delivery: Laravel origin route + Next.js same-origin proxy (explicit format segment, AMEND-16 cache split), published-media-id gate, **publish/schedule verify-only**, reconciler/purge | after V2b |

V2a ships **nothing user-visible and nothing enabled**: the new routes are additive, the capability flag is **off by default**, no existing flow calls them yet (the picker is V4).

---

## Implemented

**Data** — `storefront_media` (tenant-scoped, `CompanyWide`, `BaseModel`): `id, tenant_id, kind, original_name, mime, size, sha256, width, height, avg_luminance (advisory), dominant_colour, region_luminance (reserved, shape not frozen), alt_ar, alt_en, storage_key (file name only), variants, variants_state (pending|ready|failed), variants_error (stable code), state (active|deleted|purged), deleted_at, purge_after, uploaded_by`. Soft delete is a column, not `SoftDeletes`. Purely additive migration.

**Storage** — R2 only, via the existing `R2StorageService`, domain `storefront-media`, key `tenant/{tenant}/storefront-media/{media}/{file}`; tenant segment comes from `TenantContext`, never from the caller; no ACL, no listing. Flag `STOREFRONT_MEDIA_R2_ENABLED` (**default off**): while off, uploads answer **503 `storage_not_enabled`**, nothing is written, list still works — **never** a fallback to the ephemeral `DocumentStorageService` disk (V0 §7.1).

**API** (all `commerce.manage`, self-service refused, foreign/missing id → uniform 404, unknown body keys → 422):

| Call | Behaviour |
|---|---|
| `GET /api/commerce/workspace/storefront-media` | newest-first cursor pagination (24), `q` search over name + AR/EN alt (wildcards escaped), `unused=1`, `usage_count` per item, `meta` with `uploads_enabled`, limits and library quota |
| `POST …` | multipart `files[]` ≤ 8; **per-file result** (`created`/`duplicate`/`rejected` + stable error `code`); whole-batch 503 only for infrastructure failure; `throttle:30,1` |
| `PATCH …/{id}` | rename, `alt_ar`/`alt_en` (trimmed, ≤ 300, empty → null) |
| `DELETE …/{id}` | **409 `media_in_use` with the exact usage list** if referenced by the head draft, head published, or **any** version (draft/scheduled/published); otherwise soft delete (`purge_after` +30 d) |
| `GET …/{id}/usage` | exact references (container, id, storefront, JSON path, version name) |
| `POST …/{id}/retry` | re-generate variants from the stored original; idempotent when `ready` |
| `GET …/{media}/variants/{file}?…signature` | **signed, 20-min, unauthenticated** read (an `<img>` carries no Bearer — same trust model as CUST-H4-8b); tenant in the signature, re-checks tenant + `active` + `ready` + variant-listed on every read; serves **variants only, never the original**; `Cache-Control: private` |

**Validation (V0 §7.4)** — JPEG/PNG/WebP by **magic bytes** (client MIME/extension ignored); SVG, GIF, **animated WebP and APNG** rejected; ≤ 5 MB; short edge ≥ 320; edge ≤ 8192; ≤ 40 MP; **truncated files rejected** (GD silently decodes a half-grey image from a cut JPEG — found in testing); decode-cost guard (below); per-tenant quota (500 assets / 1 GiB, env-tunable); identical bytes in a tenant return the existing asset (`duplicate`, zero storage work); never across tenants.

**Variants (V0 §7.5)** — WebP **and** JPEG fallback at 480/768/1280/1920 (only widths *below* the source, **plus the source width itself up to 1920**, never upscaling) and thumbnails 160/320; heights/bytes recorded per file; `variants_state` reaches `ready` synchronously (`QUEUE_CONNECTION=sync`) or `failed` with a stable code + **Retry**; partial files are cleaned on failure; the original is kept private (source of truth for V2b crops). Alpha is flattened on white for the JPEG fallback (asserted on pixels). Advisory `avg_luminance`/`dominant_colour` from a 16×16 sample of the smallest rung.

## N-1 decisions and evidence (V0 §7.5 "Still open for V2")

| Question | Decision / evidence |
|---|---|
| **Library** | **Intervention Image `4.3.x` + `intervention/image-laravel 4.1.1` on GD** — the *same* `ImageManagerInterface` binding Product Media already uses (`ProductMediaDerivativeService`). One library, one container binding, no new dependency, **no external image platform**. |
| **Quality values** | WebP **82**, JPEG **85** — the values Product Media already ships; configurable in `config/storefront_media.php`. |
| **Downscale strategy** | decode once; scale **down in place** 1920→…→160 and encode each rung immediately → one decoded image resident, every result handed to the store callback and freed. |
| **EXIF orientation — real defect found** | The production image and CI have **no `exif` extension**; Intervention's `orient()` depends on `exif_read_data()` and **silently does nothing without it** (verified in vendor source). Phone photos (orientation 6/8) would be stored sideways with no error. **Fix in this slice, no Dockerfile change:** a read-only EXIF orientation reader (`StorefrontMediaOrientation`, bounds-checked, fail-safe → 1) applied with Intervention's *own* transform table **only when the extension is absent** (no double rotation). Tested for all 8 orientations × (no-extension path) and proven **identical to Intervention's native path** where the extension exists; both byte orders; truncated/forged segments. |
| **Memory — real finding** | GD allocates pixel buffers **outside PHP `memory_limit`** (measured: 40 MP decodes under `memory_limit=128M`), so `memory_limit` is the wrong guard. Measured peak RSS in this runtime (idle process ≈ 76 MB): 1.9 MP **76 MB** · 12 MP **115 MB** · 24 MP **159 MB** · 40 MP **220 MB** · 40 MP *rotated* (EXIF 6) **517 MB**. Rotation costs ≈ 2.75× buffers. Guard = `pixels × 4 × (1.15 plain | 3.0 rotated) + 32 MB` vs a **256 MB per-request budget** (`STOREFRONT_MEDIA_DECODE_BUDGET_MB`): every plain image up to the 40 MP cap, rotated phone photos up to ≈ 18 MP; anything over is refused **up front** with `image_too_large_for_processing` (actionable: "reduce and re-upload"), never mid-request. |
| **Runtime cost** | 12 MP ≈ 1.0–1.7 s, 40 MP ≈ 1.4 s plain / 4.4 s rotated for the **whole 12-file ladder**, in the upload request (acceptable synchronously; V2b's per-usage derivatives are bounded separately). |
| **Concurrency** | Apache prefork ⇒ one image per worker; the budget is per request, so `workers × budget` must fit container RAM — see prerequisites. |

## Operational prerequisites (N-2 — **not** decisions, **not** done by this PR)

1. R2 credentials/flags verified before `STOREFRONT_MEDIA_R2_ENABLED=true` (fix configuration if absent; never fall back to local disk).
2. **PHP upload limits.** The production image ships no `php.ini` (`Dockerfile` has none; repo search finds none): PHP defaults `upload_max_filesize=2M`, `post_max_size=8M` would reject 5 MB files at the PHP layer (each file would come back `upload_failed`). Needs ≥ `upload_max_filesize=6M`, `post_max_size=48M` (8 × 5 MB). The same limit affects Product Media's 5 MB cap today — worth verifying on the live service. I did **not** edit the Dockerfile (production runtime change ⇒ Owner call).
3. Container RAM comfortably above `workers × 256 MB` worst case, or lower `STOREFRONT_MEDIA_DECODE_BUDGET_MB`.

## Findings outside V2a (reported, not changed)

- **Product Media derivatives have the same silent no-orientation defect** (`ProductMediaDerivativeService` calls `orient()` with no `exif` ext in prod). The new reader could be shared there; deliberately not touched (different slice, product-visible change).
- **`R2StorageService::put()` cannot accept a stream** — it calls `is_readable($body)` on a resource (`TypeError`). Latent, never exercised. V2a passes bytes (≤ 5 MB) instead of editing the shared service.
- Race: a reference could be saved between the delete-time usage check and the soft delete. Drafts tolerate dangling ids by contract (V0 §7.8) and V2c's Publish gate re-checks `active`, so no unsafe state is reachable; recorded, not locked.

## Files

**Backend** — `database/migrations/2026_11_01_010000_create_storefront_media_table.php`, `config/storefront_media.php`, `app/Models/StorefrontMedia.php`, `app/Services/Commerce/{StorefrontMediaService, StorefrontMediaVariantGenerator, StorefrontMediaOrientation, StorefrontMediaReferenceScanner, StorefrontMediaException}.php`, `app/Http/Controllers/Api/CommerceWorkspaceStorefrontMedia{,File}Controller.php`, `app/Http/Resources/StorefrontMediaResource.php`, `routes/api.php` (+6 authed, +1 signed).
**Tests** — `StorefrontMediaApiTest` (39), `StorefrontMediaVariantGeneratorTest` (19), shared `StorefrontMediaTestSupport` (in-memory R2, real JPEG/PNG/WebP builders with EXIF), and the Commerce route allow-list in `CommerceModuleBoundaryTest` updated (the guard caught the new routes — working as designed).
No new directories (copy lists in `setup.sh` / `assemble.sh` / `ci.yml` unchanged).

## Tests

| | |
|---|---|
| Focused | `StorefrontMediaApiTest` **39** · `StorefrontMediaVariantGeneratorTest` **19** · `CommerceModuleBoundaryTest` ✓ · `BranchIsolationGuardTest` ✓ (model classified `CompanyWide`) · existing `ProductMedia*`/`CategoryMedia*` suites ✓ |
| Full backend (local, sqlite) | 5 632 passed · 57 skipped · **29 failed — all environmental in this container**: 24 × `bcmul()` (no `ext-bcmath`; `ci.yml` installs it — fuel module), 2 × missing mail view/`AuthActionMail` (`UserInvitation`, `ResendMailTransport`), plus the route-allow-list failure that this slice **caused and fixed** (now green). None touch media. |
| PostgreSQL | not runnable locally — **CI is the proof** (`CAST(json AS TEXT) LIKE … ESCAPE`, cursor pagination and the `char`/`uuid` columns are standard on both engines) |
| Security matrix covered | tenant A/B on every call · tenant swap in a signed URL (403) · tampered/expired signature · original and unlisted variants never signable/servable · no `storage_key`/`sha256`/bucket/path/`tenant/` anywhere in a response (schema assertion) · RBAC (cashier, self-service, anonymous) · quota before any write · gated mode touches nothing · outage leaves no orphan row/object · cross-tenant reference does not block deletion |

## Safety summary

Tenant isolation ✓ (automatic scope; unauthenticated route compares signed tenant manually) · auth/RBAC ✓ (`commerce.manage`, no new permission) · Draft/Published **untouched** (read-only scanning of existing JSON; no write to any presentation table) · revision concurrency untouched · **commerce/accounting truth untouched** (no ledger, price, stock or invoice code) · backward compatible (additive table/routes/config; flag off) · no arbitrary CSS/JS/HTML.

## External evidence gate (V0 §21.3)

Re-checked 2026-10-06: Salla's product-image docs describe drag-and-drop upload, reorder, per-image delete and an edit action, with GIF accepted; **in-use deletion semantics are not documented** on the pages reachable (the V0 note that Salla substitutes a default stays *undocumented-by-source*). Daftra unchanged since V0 capture. **AWJ adopts:** upload + library. **AWJ changes:** blocks deletion while referenced (versions + scheduled publish make silent substitution unsafe), rejects GIF/animated (motion/a11y), strips metadata from served variants, keeps the original private. **Rejects:** folders (V0 D-02).

## Status

- **Merge: NOT PERFORMED**
- **Deploy: NOT PERFORMED**
- **Production release: NOT PERFORMED** (flag off; prerequisites above are Owner/ops items)

## Next dependency-safe slice

**V2b** — derivative table + `transformKey`, orchestration selection with proof against AWJ's real deployment (no scheduler, `QUEUE_CONNECTION=sync`), per-usage retry. Then V2c. In parallel V3 (Announcement Bar) and V5 need only V0.
