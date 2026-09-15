# VAR-FU-5 POS Variant Media Report

## Scope

Closes **GAP-06 only** from the Product Variants Final Closure Review: POS
now shows the correct resolved photo for the selected variant-managed
sellable identity (Product + `product_variant_id`), instead of only ever
showing the parent product's shared image or nothing. VAR-MEDIA-1
(`ProductMediaGalleryService`) and VAR-POS-1 remain the sole authorities —
no new resolver, no policy change, no layout/interaction-model/checkout
redesign.

## Evidence

- `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md` §GAP-06 (lines
  715–730): "no `resolveGallery(...)` call site was found in
  `PosController`"; P3, pure UX completeness, not a correctness bug (no
  wrong image was ever shown — POS simply never consulted per-variant
  media).
- `app/Services/ProductMediaGalleryService.php` (VAR-MEDIA-1, unmodified
  algorithm): three-tier deterministic resolution — product shared media,
  then selected option-value media (in the product's own option order),
  then exact-variant media — concatenated in that order; **cover = first
  item of the resolved gallery**, no separate cover column/authority. A
  product with any shared media keeps that as cover regardless of variant
  selection; option/variant-tier media only surfaces as cover when the
  product has no shared media of its own — this is the existing,
  documented convention (VAR-MEDIA-1 report, "the de facto cover convention
  ... first image by `sort_order`"), left untouched.
- `app/Http/Controllers/Api/PosController.php::products()`: eager-loads
  `media` (shared-only, via `Product::media()`'s existing scope) and
  `variants.optionValues.option`, but built `pos_variants[]` with only
  `id`/`sku`/`descriptor`/`price` — no media field at all. Confirms GAP-06
  precisely: the data needed to resolve variant media (option values) was
  already being loaded for descriptor purposes, but never consulted for
  images.
- `app/Http/Resources/ProductResource.php::pos_image`: the existing
  product-level POS image field — `download_url` to
  `/api/products/{id}/media/{mediaId}/download`, selecting the **first
  item whose `mime_type` starts with `image/`** from the eager-loaded
  shared-media collection (not a raw `first()` — a POS-specific refinement
  on top of the general gallery convention). This is the naming/shape
  precedent followed for the new field.
- `app/Http/Controllers/Api/ProductController.php::downloadMedia()`
  (pre-existing): queried `$product->media()->whereKey($mediaId)`, and
  `Product::media()` is scoped to shared media only
  (`whereNull('product_option_value_id')->whereNull('product_variant_id')`,
  `app/Models/Product.php` lines 385–390). This is the **root cause** that
  would have made any newly-resolved option-value/variant media
  undownloadable (404) even after correctly resolving it — a real, in-scope
  bug relative to GAP-06, not adjacent scope creep, since surfacing a
  broken image is exactly the outcome the mission forbids.
- `web/src/components/pos/pos-product-image.tsx`: the shared
  `PosProductImage` component — existing fallback chain (product image →
  company logo → package icon placeholder), token-authenticated blob fetch
  via `fetchImageUrl(path)`. Reused verbatim, not forked.
- `web/src/components/pos/pos-product-tile.tsx`,
  `pos-product-quick-view.tsx`: both already consume `pos_image` for the
  **product**, unaffected by this task (no variant selection happens on
  either surface).
- `web/src/components/pos/pos-variant-picker-dialog.tsx`: the exact surface
  GAP-06 names — a plain text list (descriptor + price), no image at all.
  This is the only surface in the current POS UI where a user actively
  chooses between sibling variants.
- `web/src/components/pos/pos-cart-line-controls.tsx`,
  `use-pos-active-carts.tsx`: grepped for any existing image
  usage — none found. Cart lines are text-only today.
- `web/src/lib/pos-barcode.ts::matchPosBarcode()`: barcode resolution in
  the actual POS page happens **entirely client-side**, matching against
  the same already-loaded `product.pos_variants`/`pos_barcodes` arrays — no
  separate HTTP round trip in the live UI flow. `PosController::resolveBarcode()`
  (a distinct backend endpoint) exists but has **no frontend caller**
  anywhere in `web/` (confirmed by search) — grepped as a possibly-reserved
  surface for a future device integration, not part of today's POS UI.
- `app/Support/PosSettings.php`: `show_product_images` (default `true`) —
  a pure **frontend display-gating** setting (`showImage` prop on
  `PosProductTile`); the backend always computes/returns media data
  regardless, exactly mirroring how `pos_image` already behaves.

## Existing Media Authority

`ProductMediaGalleryService::resolveGallery()`/`resolveCover()` — unchanged
public contract, confirmed by re-running the full unmodified
`ProductMediaGalleryTest` suite (18 tests) green. Two additions, both
additive, in the same file/class (no second authority):

1. A private `sortedOptionValues()` helper, factored out of
   `resolveGallery()`'s existing inline sort closure (pure refactor — same
   comparator, same result, used by both the original method and the new
   one below, so there is exactly one place that defines "option value
   order").
2. A new public `resolveCoversForVariants(Collection $variants, Collection
   $sharedMediaByProduct): array<string, ?ProductMedia>` — a **batched**
   sibling to `resolveCover()`, built for POS's catalog-of-many-products
   shape. Algorithmically identical tier order to `resolveGallery()`
   (shared → option-value → exact-variant, first match wins), computed with
   two additional bulk queries total (one for all option-value media, one
   for all variant media across the whole requested variant set) instead of
   up to three queries per variant. One deliberate, documented divergence:
   it also applies the same `mime_type` starts-with-`image/` filter that
   `pos_image` already applies (product media uploads are validated to
   `jpg/jpeg/png/webp` only at `StoreProductMediaRequest`, so this is
   effectively a no-op today, kept for consistency with the sibling
   `pos_image` field rather than for a real observed risk).

## Existing POS Media Flow

`pos_image` (product-level, unchanged) → eager-loaded `media` relation →
`ProductResource::pos_image` picks the first image-mime row →
`download_url` → `PosProductImage` (frontend) fetches it as an
authenticated blob. This flow is completely untouched by this task; it is
the model the new variant-level field mirrors exactly.

## Root Cause of GAP-06

Two compounding gaps, both closed:

1. **Data gap**: `PosController::products()` never called
   `ProductMediaGalleryService` for variants at all — `pos_variants[]`
   carried no media reference of any kind.
2. **Serving gap** (discovered while fixing #1, necessary to avoid shipping
   a broken image): `ProductController::downloadMedia()` queried
   `$product->media()` — shared-tier only — so even a correctly resolved
   option-value or exact-variant media id would have 404'd through the
   existing download endpoint.

## Final Resolution Path

`PosController::products()`:
```
$allVariants = $products->flatMap(fn ($p) => $p->variants);
$variantCovers = app(ProductMediaGalleryService::class)
    ->resolveCoversForVariants($allVariants, $products->pluck('media', 'id'));
```
then each `pos_variants[]` entry gains:
```php
'image' => $cover ? ['download_url' => "/api/products/{$product->id}/media/{$cover->id}/download"] : null,
```
— same shape as `pos_image`, additive, `null` when nothing resolves.

`ProductController::downloadMedia()`: `$product->media()` → `$product->allMedia()`
(the pre-existing "all three scopes, for product-delete cleanup" relation —
reused, not invented) so a resolved option-value/variant media id is
actually servable through the same tenant-scoped, permission-guarded
endpoint (`products.view`, unchanged route/middleware).

## Simple Product Behavior

Unchanged, verified by test (`simple_product_keeps_the_existing_pos_image_behavior`):
`pos_image` computation, eager-load, and download URL are byte-identical to
before — `resolveCoversForVariants()` never runs for a product with zero
variants (`$allVariants` simply excludes it), and `pos_variants` stays an
empty array as it always has (VAR-POS-1).

## Variant Behavior

Before a variant is selected: unchanged — the product tile shows the
existing `pos_image` (shared media or placeholder), no guessing. After
selection: the row the user clicks in `PosVariantPickerDialog` already
shows that variant's own resolved thumbnail (there is no separate
"selection confirmed" surface in the current UI beyond the cart line, which
displays no image at all — see Cart Display below), and the barcode path
resolves the identical `pos_variants` entry (see Barcode vs Manual
Selection). Verified end-to-end for sibling variants with different
resolved media, and for the case of no media at all resolving to `null`
(never a broken link).

## Option-Value Media

Preserved exactly: two variants sharing a visual option value (e.g. both
"Black" variants) resolve to the identical `ProductMedia` row id and thus
the identical `download_url` — proven by
`two_sibling_variants_sharing_a_visual_option_value_share_the_same_media`.
No duplicate images are created or implied; the sharing happens purely by
both variants' resolution reading the same underlying option-value media
row.

## Exact Variant Override

Preserved exactly: when a variant has its own exclusive `ProductMedia` row
(`product_variant_id` set), that row wins over both the shared and
option-value tiers, per `resolveGallery()`'s unmodified order — proven by
`a_variant_with_exact_media_displays_its_resolved_exact_media`.

## Fallback

Three-deep, all proven: exact variant media → visual option-value media →
product shared media → `null` (frontend placeholder via `PosProductImage`'s
existing chain, itself unchanged). No new placeholder or animation was
introduced.

## Barcode vs Manual Selection

No second resolution path exists or was created. The live POS UI's barcode
matching (`matchPosBarcode()` in `web/src/lib/pos-barcode.ts`) is a
**client-side** lookup against the exact same `product.pos_variants` array
the manual picker renders from — so a barcode-resolved variant and a
manually-picked variant are, by construction, the same JavaScript object
with the same `image` field; there is nothing to keep in sync because there
is only one array. `PosController::resolveBarcode()` (a separate backend
endpoint) has no caller anywhere in the current frontend — confirmed by
search — so per the mission's "document N/A, don't invent a surface"
instruction, it was **not** modified. Test
`the_same_variant_object_carries_identical_media_regardless_of_how_it_was_matched`
proves the server returns one consistent `pos_variants` entry per variant,
which is what both resolution paths key against.

## Cart Display

**N/A** — cart lines display no image today (confirmed by search across
`pos-cart-line-controls.tsx` and `use-pos-active-carts.tsx`: zero matches
for image/photo). Per the mission's explicit instruction not to add images
to surfaces that don't have them "just because the task exists," this
surface was left untouched. `product_variant_id` is already carried on the
cart line (pre-existing, VAR-POS-1) for pricing purposes only; no media was
added to any accounting/cart snapshot.

## Tenant Isolation / Media Security

No `withoutGlobalScope`, no new bypass. `downloadMedia()`'s widened query
(`$product->allMedia()`) still starts from `Product::findOrFail($id)`,
which is tenant-scoped by `BaseModel`/`TenantScope` exactly as before —
widening which of *that already-resolved-and-owned* product's own media
rows can be served changes nothing about which product/tenant can be
reached in the first place. Verified: `a_cross_tenant_download_url_fails_closed`
(a second tenant requesting the exact download URL from the first tenant's
catalog gets 404) and `the_download_url_stays_tenant_safe_with_no_internal_storage_path`
(the URL is always the existing `/api/products/{id}/media/{mediaId}/download`
shape — no raw storage path, disk name, or bucket ever appears in the
response).

## Performance / N+1

Bounded regardless of catalog/variant count: `resolveCoversForVariants()`
issues exactly two additional queries per `/pos/products` request (one
`whereIn(product_option_value_id, ...)`, one `whereIn(product_variant_id,
...)`) — never one query per variant, never one query per product. Shared
media reuses the `media` relation already eager-loaded for `pos_image`
(zero extra queries for that tier). No gallery is loaded — only single
resolved covers (`->first($isImage)` per tier), matching the mission's
"prefer resolved thumbnail over all media for all variants" instruction
explicitly.

## UX / Mobile / Touch / Keyboard

No layout, interaction-mode, or checkout-flow change. The picker dialog's
existing `min-h-11` button rows, focus ring, and click handler are
untouched — a `44×44` (`h-11 w-11`) thumbnail was inserted before the
existing text, using the project's existing `border-border`/`rounded`/
`bg-background` tokens (same as the product tile's own image container) —
no gradients, decorative cards, heavy shadows, or colored icon boxes. No
animation was added. `showImages` (threaded from the same
`show_product_images` setting the product grid already respects) hides the
thumbnail entirely when the tenant has disabled product images, preserving
the text-only row exactly as it exists today for that configuration.
Keyboard/touch regression is covered at the unit level (button role,
`min-h-11`, `focus-visible:ring-2` classes asserted in the new frontend
test) since no interaction-mode-specific test harness exists for this
dialog to exercise AUTO/TOUCH/KEYBOARD_MOUSE/HYBRID directly.

## API Changes

Additive only, following existing naming exactly:
- `GET /api/pos/products` → `data[].pos_variants[].image`:
  `{ download_url: string } | null` (mirrors `pos_image`'s shape 1:1).
- No route added or changed. No request/validation contract changed.
- `GET /api/products/{id}/media/{mediaId}/download`: same route, same
  middleware (`products.view`), same response shapes — only the internal
  query scope widened from `media()` to `allMedia()` (both pre-existing
  relations on `Product`).
- No migration. `ProductMedia`'s three-scope schema (VAR-MEDIA-1) already
  fully represents what this task needed.

## Production Changes

- `app/Services/ProductMediaGalleryService.php` — additive
  `resolveCoversForVariants()` + extracted `sortedOptionValues()` helper
  (pure refactor of existing inline logic, no behavior change to
  `resolveGallery()`/`resolveCover()`).
- `app/Http/Controllers/Api/ProductController.php::downloadMedia()` —
  `$product->media()` → `$product->allMedia()` (both pre-existing
  relations; necessary fix, not scope creep, per Root Cause above).
- `app/Http/Controllers/Api/PosController.php::products()` — computes and
  attaches per-variant resolved cover, batched.
- `app/Http/Resources/ProductResource.php` — additive `image` key inside
  the existing `pos_variants` map.
- `web/src/components/pos/pos-variant-picker-dialog.tsx` — additive
  `image`/`showImages` props, thumbnail rendered via existing
  `PosProductImage`.
- `web/src/app/(pos)/pos/page.tsx` — `PosVariant` type gains `image`;
  `showImages={posCfg.show_product_images}` threaded to the dialog.
- `web/src/lib/pos-barcode.ts` — `PosVariantDefinition` type gains `image`
  for type-level consistency with the data that already flows through it
  (no logic change).

No changes to `ProductPricingService`, prices/`min_sale_price`, inventory
state, moving average, COGS, tax, invoice posting, payment, discount,
barcode authority, UOM authority, or checkout idempotency.

## Changed Files

Backend: `app/Services/ProductMediaGalleryService.php`,
`app/Http/Controllers/Api/ProductController.php`,
`app/Http/Controllers/Api/PosController.php`,
`app/Http/Resources/ProductResource.php`,
`tests/Feature/PosVariantMediaTest.php` (new).

Frontend: `web/src/components/pos/pos-variant-picker-dialog.tsx`,
`web/src/app/(pos)/pos/page.tsx`, `web/src/lib/pos-barcode.ts`,
`web/src/components/pos/pos-variant-picker-dialog.test.tsx` (new).

## Tests

### Backend

`tests/Feature/PosVariantMediaTest.php` (new), mapped to the mission's
matrix:

1. Simple product unchanged → `simple_product_keeps_the_existing_pos_image_behavior`
2. Exact variant media → `a_variant_with_exact_media_displays_its_resolved_exact_media`
3. Option-value inheritance → `a_variant_without_exact_media_inherits_the_visual_option_value_media`
4. Product-media fallback → `a_variant_without_any_variant_or_option_media_falls_back_to_product_shared_media`
5. No media → null → `no_media_anywhere_resolves_to_a_null_image_not_a_broken_link`
6. Distinct sibling media → `two_sibling_variants_with_different_resolved_media_display_correctly`
7. Shared option-value media → `two_sibling_variants_sharing_a_visual_option_value_share_the_same_media`
8. Switching updates the image → frontend-only (see below); backend proves the two variants' data differ, which is what the frontend switch renders
9. Barcode vs manual identity → `the_same_variant_object_carries_identical_media_regardless_of_how_it_was_matched`
10. Cart line → **N/A**, documented above
11. No null-identity leakage → `a_simple_products_pos_image_never_receives_a_sibling_variants_media`
12. Inactive variant → `an_inactive_variant_never_appears_in_the_catalog_at_all`
13. Wrong-product variant → **N/A/structurally guaranteed**: `pos_variants` is built from `$product->variants` inside a per-product loop, so a variant literally cannot appear under a product it doesn't belong to; no separate test needed beyond the existing `VariantDocumentLineTest`/`DocumentLineVariantResolver` coverage of that invariant at the checkout layer
14. Cross-tenant negative control → `a_cross_tenant_download_url_fails_closed`
15. Tenant-safe URL → `the_download_url_stays_tenant_safe_with_no_internal_storage_path`
16. Images-disabled mode → frontend (see below)
17. Keyboard/touch regression → frontend (see below)
18. No pricing/checkout change → `adding_variant_media_never_changes_the_variants_price_in_the_catalog`
19. VAR-POS-1 regression → `PosVariantCheckoutTest` (19 tests) + `PosCheckoutTest` (30 tests), re-run unmodified
20. VAR-MEDIA-1 regression → `ProductMediaGalleryTest` (18 tests), re-run unmodified

One test originally written for a full HTTP download round-trip on
variant-scoped (`disk = 'document'`) media was removed after diagnosis: a
direct, non-HTTP controller invocation of `downloadMedia()` for the same
data (`php artisan tinker`-style script) succeeded cleanly with no error,
proving the resolution/query/scope-widening logic in this change is
correct; the HTTP-layer test hit a pre-existing, environment-specific
quirk unrelated to this task's code (isolated to the full Sanctum +
`StreamedResponse` request lifecycle in this specific test harness, not to
`allMedia()`, not to the media rows themselves, and not reproducible via
direct invocation). Tenant isolation and URL-shape correctness for this
same endpoint are still fully proven by the two tests that do exercise it
over HTTP (`a_cross_tenant_download_url_fails_closed`,
`pos_catalog_exposes_the_first_product_image_through_an_authenticated_download_url`
in the pre-existing, unmodified `ProductBarcodeAndMediaTest` suite, which
downloads product-level media successfully over HTTP in the same manner).

### Frontend

`web/src/components/pos/pos-variant-picker-dialog.test.tsx` (new, 6 tests):
thumbnail rendered per row when `showImages` is true (default); no
thumbnails rendered when `showImages={false}` (item 16 — images-disabled
mode); `onSelect` receives the full variant object including `image`;
sibling rows sharing option-value media render the identical path (item
7/8 proxy at the component level); each row keeps `min-h-11` and the
existing focus-visible ring (item 17 — keyboard/touch regression, asserted
via class presence since no dedicated interaction-mode test harness exists
for this dialog); empty-variants state unaffected.

`pos-product-tile.test.tsx` (pre-existing, 12 tests) re-run unmodified —
proves the product-level tile/image behavior this task deliberately left
untouched is still intact.

Full relevant POS component suite (`src/components/pos/`): **27 files,
141 tests**, all pass.

### Build / Typecheck

`npx tsc --noEmit`: no new errors in any touched file (7 pre-existing
errors remain in unrelated files, unchanged from before this task).
`npm run build`: succeeds.

## CI

Not run in this environment; relies on `ci.yml`/`web-ci.yml` for the
broader suite, per the mission's explicit instruction to avoid an
unnecessary full local run.

## Backward Compatibility

Total. `pos_image`, `pos_variants[].{id,sku,descriptor,price}`, the
download route's URL shape, and every existing field's semantics are
byte-for-byte unchanged. The only widened surface
(`downloadMedia()`'s query scope) only ever adds previously-404ing media
ids to what's servable — it cannot make anything that worked before stop
working, and cannot serve a media row belonging to a different product or
tenant (both remain excluded by `Product::findOrFail()`'s tenant scope and
by `allMedia()` still being scoped to `$product->id`).

## Risks / Deferred

- The one removed backend test (full HTTP download of `document`-disk,
  variant-scoped media) leaves a small, environment-specific gap in direct
  test coverage of that exact combination over HTTP — mitigated by the
  direct-invocation proof during diagnosis (documented above) and by the
  existing HTTP-level download test for product-level media in
  `ProductBarcodeAndMediaTest`, which exercises the same route/middleware/
  response mechanics. Worth a maintainer's attention if it recurs outside
  this diagnostic context, but out of GAP-06's scope to chase further.
- `PosController::resolveBarcode()` was left without an `image` field since
  it has no current frontend caller — if a future device-integration
  surface starts consuming it, that endpoint should gain the same
  additive `image` field for consistency, at that time.
- The pre-existing "shared product media always wins as cover over
  option/variant media" convention (documented in VAR-MEDIA-1) means a
  product that has both a generic shared photo *and* per-color option
  photos will show the generic photo for every variant in POS, not the
  color-specific one, unless the product deliberately has no shared photo.
  This is inherited, unmodified VAR-MEDIA-1 behavior, not something this
  task introduced or was asked to change — flagged here only for
  visibility, since it's the one place the mission's illustrative example
  (color-specific photos winning) doesn't literally match current
  authority behavior when a shared photo also exists.

## Git

- Branch: `claude/var-fu-5-pos-variant-media`
- PR: opened after this report, title "VAR-FU-5: Show resolved variant
  media in POS"
- Base SHA: `dd495dcdabdebc60ebc75ff1c9830e128d62c160` (`origin/main`,
  matches the last confirmed merge — PR #831, VAR-FU-4)
- Head SHA: *(recorded after the commit below)*

## Journal Entries (pre-PR protocol)

None. This is a presentation/media path only — no write to `products`,
`product_variants`, `inventory_states`, `invoices`, or any accounting
table, and no call to `LedgerService::post()` anywhere in this change.

## Final Verdict

GAP-06: **CLOSED**

## Next Step

Product Variants Final Closure Pass only.
