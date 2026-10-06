# CUST-HV V2b — Transform Derivatives & Derivative Orchestration — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V2b** — second of three V2 sub-slices (V2a #1255 merged; V2c = public delivery + publish gate) |
| **Branch** | `cust-hv/v2b-derivatives` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `origin/main` after V1A (#1252), V2a (#1255) (+ V3 if merged first — see PR) |
| **Authority** | V0 §7.2 (`storefront_media_derivatives`), §7.5 (`transformKey`, AMEND-2/9/11/12/21), §7.6 (image editing), §7.10 (per-usage readiness), §19.0 (proof gate) |
| **Depends on** | V2a (merged). Independent of V3. |

V2b ships **nothing user-visible and nothing enabled** (same flag as V2a, `STOREFRONT_MEDIA_R2_ENABLED`, off by default): the editor that calls these endpoints is V4, the public delivery and the Publish gate that *reads* them is V2c.

---

## What V0 left to this slice — the orchestration, selected and proven

V0 §7.5 (AMEND-21) froze five **invariants** and deliberately left the mechanism to V2: *every required `transformKey` reaches a terminal state; Publish is verify-only; no unbounded/bulk generation; no sole dependency on infrastructure AWJ Production does not guarantee (no scheduler, no cron, `QUEUE_CONNECTION=sync`); no permanent-pending state for a valid document.*

### Selected mechanism

**Bounded synchronous unit of work + request-driven continuation, with a lease.**

| Property | Mechanism |
|---|---|
| **Unit of work (invariant 3)** | One *usage* per request: `POST …/storefront-media/{id}/derivatives` decodes the original **once** and renders ≤ 8 files (4 ladder widths × WebP/JPEG). Never "everything the document needs". |
| **Continuation (invariant 4)** | A document with N usages is N sequential calls from the editor (V4). No worker, scheduler, cron or queue is involved or required. |
| **Terminal state (invariants 1, 5)** | Every request ends each row it owns `ready` or `failed(code)`. Each row carries a short **lease** (`claimed_at`, 120 s). A `pending` row whose lease expired is **read as `failed(interrupted)`** and **re-claimable by any later request** — so a request that dies mid-way (timeout, OOM, deploy restart) cannot strand a usage: it becomes a retryable failure. |
| **No double work** | Claiming is an atomic conditional `UPDATE` per row; a live lease held by another request returns `processing` without generating. Rows are created under a unique index `(media_id, transform_key, width, format)`; a lost race means someone else owns them. |
| **No hot loops** | A `failed` row is regenerated only with an explicit `retry: true` (the per-usage **Retry** of V0 §7.10). |
| **Publish verify-only (invariant 2)** | `status()` is a pure read — no write, no storage call, no generation, for absent, failed or pending usages. V2c's gate calls it; there is no code path that generates at Publish time. |

### Proof (all executable, `StorefrontMediaDerivativeTest`)

| Claim | Test |
|---|---|
| One decode, ≤ 8 writes per request | `ensure_renders_eight_files_from_one_decode…` (1 `get`, 8 `put`, keys under the tenant prefix) |
| A realistic **maximum document** (40 usages across 3 assets, one injected storage outage mid-document) | every request returns `ready`/`failed`, never an owned in-between state; max 8 puts and 1 get per request; **0 `pending` rows afterwards**; one-click `retry` of the failed usages completes the document → 320/320 files `ready` |
| A **crashed request** cannot leave a usage pending | rows forced to `pending` with an old lease → `status` reports `failed(interrupted)`, `retryable`; the next `ensure` (even without `retry`) reclaims and reaches `ready` |
| A **live lease** is respected | fresh `claimed_at` → `processing`, zero writes |
| **Storage failure** | the failing file → `failed(storage_unavailable)`, files that did store stay `ready` (per-file), nothing left `pending`, no orphan file; no regeneration without `retry`; `retry` recovers only the failed rows |
| **Reads never generate** | absent → `absent`, no rows, no storage calls; failed → stays failed, put count unchanged |
| **Decode cost guard** | a user rotation is costed like an EXIF rotation (the V2a RSS-calibrated budget): an over-budget decode is a *terminal* `failed(image_too_large_for_processing)`, not a worker crash; a plain crop of the same asset stays within budget |
| **Abuse bounds** | per-asset usage cap and per-tenant row cap → 422 with a stable code; an *existing* usage is never blocked by the cap |

### Measured cost (this container, 4 cores; GD + Intervention 4; one usage = 8 files)

| Source | Plain frame | crop + rotate + zoom |
|---|---|---|
| 12 MP | 0.9 s | 1.6 s |
| 20 MP | 1.0 s | 2.4 s |
| 40 MP (the upload cap) | 1.4 s | **4.5 s** (peak RSS ≈ 517 MB incl. the benchmark's own source image) |

The lease (120 s) is ≈ 27× the worst measured unit; PHP-FPM's default `max_execution_time` (30 s) is ≈ 6× it. **Production CPU was not measured** — enabling the capability in Production keeps the V2a go-live checklist (R2 credentials, PHP upload limits, RAM vs `workers × decode budget`) and adds: *confirm one 40 MP crop+rotate render completes inside the FPM request timeout of the Production container*.

---

## Implemented

| Area | Detail |
|---|---|
| **Data** | `storefront_media_derivatives` (tenant-scoped `CompanyWide` under the branch guard, `BaseModel`): `usage_key` (identity of the transform alone), `transform_key` (V0 formula, **includes `zoom`** — AMEND-11), normalised `transform`, nominal `width`, `format`, actual `rendered_width/height`, `bytes`, advisory `avg_luminance`/`dominant_colour` **computed on the rendered pixels** (AMEND-8), reserved `region_luminance` (shape owned by V5/V6 — AMEND-20), `state`, stable `error_code`, `attempts`, lease `claimed_at`. Additive migration; unique `(media_id, transform_key, width, format)`. |
| **Identity** | `StorefrontMediaTransform`: strict allow-list validation (path-specific errors), deterministic normalisation (crop 4 dp, zoom 2 dp, focal integers, fixed field order), `key()` = `sha256(mediaId:normalized:width:format)[0..32]` verbatim from V0. Two usages differing only in `zoom` diverge; float noise collapses; the default frame (no crop, no rotation, centred focal, `cover`) has no derivatives. |
| **Rendering** | `StorefrontMediaVariantGenerator::renderTransform` — the **same imaging path** as base variants and Product Media (N-1): EXIF orientation (built-in reader when `exif` is absent) → user rotation (clockwise, CSS semantics) → crop → zoom around the focal point (clamped inside the crop) → in-place descending scale-down. **Never upscales**; widths larger than the frame render at the frame width and share one encode. |
| **API** (`commerce.manage`, self-service refused, foreign/deleted media → uniform 404, unknown body keys → 422) | `POST …/storefront-media/{id}/derivatives` (ensure; `retry` optional) · `POST …/derivatives/status` (≤ 16 transforms, **read-only**). Response: usage `state` (`absent`/`processing`/`ready`/`failed`), `retryable`, stable `error_code`, per-file state/dimensions/size and a short-lived **signed** URL for ready files. **No** storage key, bucket, path, sha, transform JSON or contrast evidence in any response (asserted). |
| **Signed workspace read** | `GET …/{media}/derivatives/{transformKey}.{webp|jpg}` — same trust model as V2a's variant read (signature is the authority, tenant matched manually, state re-checked on every read, `private` cache). A base-ladder file name can never be served through it. |
| **Storage** | R2 via `R2StorageService` only, `…/storefront-media/{media}/{transformKey}.{fmt}`; the key is deterministic, so an interrupted write that is later re-claimed overwrites the same object — no orphan class. |

### AWJ decisions inside the V0 envelope (not contract changes)

1. **`transformKey` hashes the *nominal* ladder width** (480/768/1280/1920), not the clamped one. The renderer can therefore derive all eight keys from the `MediaRef` alone, independent of source size; the row stores the real rendered size so `srcset` descriptors are honest.
2. **`focal` and `fit` are identity inputs but change pixels only through `zoom`** (they drive `object-position` / `object-fit` at render time, as §7.6 says). A focal-only usage therefore produces byte-equivalent files under its own keys — literal V0 ("any difference is a transform"), one small, bounded duplication.
3. **Crop coordinates are relative to the image after EXIF orientation and user rotation** (what the editor shows). Stated here so V4's crop UI and V2c's renderer use the same frame.
4. **Orphan reclamation is V2c's reconciler, not V2b's caps.** Every saved crop edit mints a new usage key; V2b only bounds abuse (200 usages per asset, 4 000 rows per tenant). Reclaiming superseded framings needs the reference scanner over Draft + every Version, which V2c owns with the purge reconciler.

---

## Invariants

| Invariant | Status |
|---|---|
| **Tenant Isolation** | Tenant only from `TenantContext` (`BaseModel` scope + `R2StorageService`); no tenant/key/prefix from the client; foreign media/derivative probes create nothing and return 404; signed link cannot be re-pointed at another tenant or another key (403). |
| **RBAC / auth** | `commerce.manage`; `cashier` and `self_service` refused on both endpoints; anonymous → 401; the signed read has no Bearer by design (`<img>`), authority = signature. |
| **Draft vs Published / revision / concurrency** | No presentation document, version, publish or schedule code touched. Concurrency is the per-row atomic lease above; two framings never share or overwrite a file. |
| **Media ownership** | Derivatives are tenant-owned rows under the owning asset; a deleted/purged asset serves nothing (state re-checked per read). Public access is **not** opened here — V2c. |
| **Commerce / accounting truth** | Untouched; no journal entries. |
| **Backward compatibility** | New table + new routes only; the flag stays off; V2a behaviour unchanged (one method made `public` for the shared decode guard). |
| **Production infrastructure** | None new: same R2 path, no worker, no scheduler. |

---

## Verification

| Gate | Result |
|---|---|
| New | `StorefrontMediaDerivativeTest` — **35** (identity incl. zoom-only divergence & float-noise collapse, 13 validation paths, region geometry, pixel-level crop/rotate/no-upscale, orchestration proofs above, tenant/RBAC/signed-read suites) |
| Guards | `CommerceModuleBoundaryTest` allow-list (3 new routes), `BranchIsolationGuardTest` ✓; V2a suites unchanged (65) |
| Full backend | see PR description (local container failures are the known `ext-bcmath` / mail-view set); **PostgreSQL by CI** |

## Risks / deferred

- **V2c:** the public same-origin route + Next proxy (explicit format segment, AMEND-16 cache split), the **published-reference gate**, Publish/schedule/dispatch verify-only calling `status()`, and the reconciler/purge (including superseded derivatives and the V2a-noted orphan R2 objects).
- **V4:** the editor must call `ensure` per changed usage on save (sequentially) and show processing/failed/Retry per usage; `ensure` is idempotent so repeated saves are safe.
- **Operational:** confirm render time vs the Production FPM timeout (above); derivative bytes are not counted in the library byte quota (bounded by the row cap and by reclamation in V2c).
- **Product Media** still has the EXIF-orientation latent defect noted in V2a (reported, not changed).

## Next dependency-safe slice

**V2c** (depends on this slice). In parallel on the graph: V4 (media picker/editor UI) can start against this API contract; V5 (+V1B) is unblocked by V3.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
