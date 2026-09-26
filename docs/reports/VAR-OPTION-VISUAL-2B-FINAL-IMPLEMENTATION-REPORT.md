# VAR-OPTION-VISUAL-2B — Final Implementation Report

## Option Value Image Swatch Upload Authority + Product Workspace Authoring

Repository: `safwan5001-source/Nebrax`

---

## 1. Final status

**COMPLETE** — implemented, tested (frontend locally; backend via GitHub CI), delivered as ONE independent PR.

- Not merged. Not deployed.

## 2. Repository evidence / Phase 0 findings

Verified against latest `main` (Base SHA `52aa20797368cf91ea07d1e3c8efa140229b768e`, post PR #865 / VAR-OPTION-VISUAL-2A):

1. **ProductMedia model** — three exclusive scopes (product gallery / option value / variant) via nullable `product_option_value_id` / `product_variant_id`; exclusivity + tenant/product ownership enforced in `ProductMedia::booted()`; both columns `cascadeOnDelete`.
2. **VAR-MEDIA-1 association** — `ProductMediaService::attachToProduct/attachToOptionValue/attachToVariant` already existed as the service-level authority (8-per-scope cap, server-generated path `product-media/{tenant}/{product}/{uuid}.{ext}`, `DocumentStorageService` persistent disk).
3. **Upload validation** — `StoreProductMediaRequest`: `max:5120` KB, `mimes:jpg,jpeg,png,webp` (server-side).
4. **Tenant authorization** — `TenantScope` global scope + `$perm('products.view'/'products.manage')` route middleware; hierarchical ownership asserted explicitly in `ProductVariantController::resolveOption/resolveOptionValue/resolveVariant`.
5. **Storage** — `DocumentStorageService` (`document` disk, S3/R2), no client-controlled paths.
6. **Secure delivery** — `ProductController::downloadMedia` via `Product::allMedia()` (covers all three scopes), tenant-safe, no raw paths; `ProductOptionValueResource.image_media` exposes only `{id, download_url}`.
7. **HTTP endpoint for option-value-scoped upload** — **CONFIRMED GAP**: no route existed. Only product-level `POST /products/{id}/media`. The previously confirmed state is unchanged on latest main.
8. **`image_media_id` validation** — `ProductVariantService::applyVisualMetadata` resolves `ProductMedia::where('id', …)->where('product_option_value_id', $value->id)` under `TenantScope`; cross-tenant/cross-value/arbitrary IDs resolve to null → generic 422 (no existence leak).
9. **Deletion protection** — `ProductController::destroyMedia` targets only product-level media (`Product::media()` with `whereNull` scopes), so swatch media was unreachable by that endpoint; option-value media lifecycle otherwise follows `deleteOptionValue` (rows in-transaction + files after commit). `image_media_id` FK is `nullOnDelete`.
10. **Frontend utilities** — `fetchImageUrl` (authenticated blob preview), FormData support in `api()`, and the `ProductMediaSection` validation constants (5 MB, jpeg/png/webp) were reused as conventions.

## 3. Exact upload authority used

Existing authority reused, nothing parallel created:

- Storage/scoping: `ProductMediaService::attachToOptionValue()` (VAR-MEDIA-1) — unmodified.
- Visual reference authority: `ProductVariantService::updateOptionValue()` → `applyVisualMetadata()` (VAR-OPTION-VISUAL-1) — the server sets `visual_type=image` + `image_media_id`; the browser never sends a media ID to trust.
- Permission authority: existing `products.manage` middleware. No second permission system.

## 4. API/routes added or extended

**Added (one route, smallest safe path):**

- `POST /api/products/{id}/options/{optionId}/values/{valueId}/media` → `ProductVariantController@storeOptionValueMedia` — middleware `products.manage`; body: single `image` file (`StoreOptionValueSwatchRequest`: required, `max:5120`, `mimes:jpg,jpeg,png,webp` — identical limits to existing product media). Resolves Tenant → Product → Option → Value hierarchy (404 on any mismatch, cross-tenant included), stores media scoped to that exact value, then sets the visual reference through the existing service authority. Returns `ProductOptionValueResource` (201). If visual adoption fails after storage, the newly created media is deleted — no orphan row.

**Extended (behavioral, same contract):**

- `ProductVariantService::updateOptionValue()` — deterministic cleanup of a de-referenced swatch: when `image_media_id` changes away from its previous value (replace, or image → none/color), the previous media row (only if owned by this exact value) is deleted inside the same transaction and its file deleted after commit — the exact `deleteOptionValue` pattern.

No existing route or contract changed. Clients ignoring the new fields are unaffected.

## 5. Media ownership/scoping behavior

- Swatch media rows carry `product_id` + `product_option_value_id` (variant column null), tenant-filled by `BelongsToTenant`; `ProductMedia::booted()` re-verifies value↔product↔tenant consistency on every save.
- Swatch media is exclusively owned by its option value — it cannot be referenced by any other value (service authority rejects sibling/cross-product/cross-tenant references), so deterministic cleanup on de-reference is safe by construction.
- Swatch media counts toward the existing per-scope cap of 8 (unchanged VAR-MEDIA-1 semantics).

## 6. Tenant Isolation / security behavior

- Cross-tenant upload → 404 (`TenantScope` + hierarchy resolution), nothing created (test-verified).
- Cross-product option/value mismatch → 404 (explicit hierarchy assertion).
- Arbitrary/gallery/sibling media IDs as `image_media_id` → 422 generic message (no existence leak).
- MIME and size validated server-side; filename is server-generated UUID; no client path input; no storage path ever serialized (only guarded `download_url`); retrieval stays on the existing guarded download route.

## 7. Replace/delete semantics (deterministic)

| Transition | Behavior |
|---|---|
| None → Image | Upload via new endpoint; server sets reference. |
| Color → Image | Upload; `color_value` cleared by `applyVisualMetadata`. |
| Image → different Image | New upload; previous swatch media row deleted in-transaction, file after commit. |
| Image → Color | PUT `visual_type=color`; reference cleared; swatch media cleaned the same way. |
| Image → None | PUT `visual_type=none`; reference cleared; swatch media cleaned the same way. |

No broken references; no speculative garbage collection. Media referenced elsewhere cannot exist by construction (exclusive ownership).

## 8. Product Workspace lifecycle behavior

- The visual editor (`OptionValueVisualSheet`, the same 2A sheet — no second editor) only ever opens for an **already persisted** option value; upload therefore always targets a real identity.
- Choosing "Image" in the quick-add row creates the value as plain text first (POST values with `{value}` only — no `visual_type=image`, no fake media ID), shows the gate hint, then opens the value's own editor for the actual upload. No draft-product architecture, no duplicate Product POSTs, no pre-persistence media calls (test-verified).
- The panel itself is only rendered for a persisted product (`productId` prop), so no fake product IDs anywhere.

## 9. Files changed

Backend:
- `routes/api.php` — one route added.
- `app/Http/Controllers/Api/ProductVariantController.php` — `storeOptionValueMedia` + `ProductMediaService` injection.
- `app/Http/Requests/StoreOptionValueSwatchRequest.php` — new (mirrors existing media limits).
- `app/Services/ProductVariantService.php` — deterministic stale-swatch cleanup in `updateOptionValue`.

Backend tests:
- `tests/Feature/ProductOptionValueImageSwatchTest.php` — new, 11 test methods covering all 13 required cases.

Frontend:
- `web/src/components/products/product-variants-panel.tsx` — same 2A editor extended: None/Color/Image, upload control, preview (blob via `fetchImageUrl`), replace, remove→none, image↔color switching, loading + error states, chip thumbnail (`SwatchImage`), gated quick-add image flow.
- `web/src/messages/ar.json`, `web/src/messages/en.json` — 7 new keys each.
- `web/src/components/products/product-variants-panel.test.tsx` — 8 new tests + mocks (media endpoint, `fetchImageUrl`, object-URL stubs).

## 10. Tests + exact results

**Frontend (run locally, vitest):**

- `product-variants-panel.test.tsx`: **20/20 passed** (12 pre-existing incl. all VAR-OPTION-VISUAL-2A tests + 8 new: three visual choices, upload control/no premature media call, required-file error, successful FormData upload, upload failure state, replace without client media ID, image→none PUT, image→color PUT, gated create-then-edit flow).
- Full `src/components/products/` suite (incl. ProductWorkspace lifecycle regression / no duplicate Product POST): **73/73 passed (4 files)**.

**Backend (cannot run locally — no PHP runtime in the authoring environment; executed by GitHub CI):**

- `tests/Feature/ProductOptionValueImageSwatchTest.php` (new): authorized upload succeeds; `visual_type=image` + `image_media_id` persist and round-trip; tenant/product/value scoping; cross-tenant 404; cross-product 404; arbitrary + gallery media ID rejected; invalid MIME 422; oversized 422; image→none clears + cleans; image→color clears + cleans; deterministic replace; variant ID/SKU/combination invariant across the full lifecycle.
- CI additionally runs the pre-existing `ProductOptionValueVisualTest`, `ProductMediaGalleryTest`, `PosVariantMediaTest`, `ProductVariantCoreTest` and the full suite.

Exact CI counts: see §12.

## 11. Build result

- `npm run build` (Next.js production): **SUCCESS** (all routes compiled, no type errors).

## 12. GitHub CI result

_Pending at push time — filled after CI completes on the PR head SHA._

## 13. Risks / remaining items

- **Backend tests not executed locally** (no PHP runtime available to the agent): the new backend suite is written to existing conventions but its green state is asserted by CI only. If CI flags anything, a follow-up commit on the same branch is required before review.
- Swatch media shares the option-value media scope (per contract §7): a de-referenced swatch is deterministically deleted precisely so replaced samples cannot silently accumulate into the variant-resolved gallery.
- Storefront/POS rendering of image swatches intentionally untouched.

## 14. Explicit deferred scope

- **VAR-OPTION-VISUAL-3** — Storefront/POS swatch consumption (rendering, selection UX). Not part of this PR.

## 15. Branch

`feat/var-option-visual-2b-image-swatch`

## 16. PR

_Pending — filled after PR creation._

## 17. Base SHA

`52aa20797368cf91ea07d1e3c8efa140229b768e` (latest `main` at branch time; includes merged PR #865 / VAR-OPTION-VISUAL-2A merge `62c6f77859c3192f72b7713778293fa33750d308`).

## 18. Head SHA

_Pending — filled after push._

## 19. Next recommended step

Review + merge this PR, then open **VAR-OPTION-VISUAL-3** (Storefront/POS swatch consumption) against the now-complete canonical authoring authority.
