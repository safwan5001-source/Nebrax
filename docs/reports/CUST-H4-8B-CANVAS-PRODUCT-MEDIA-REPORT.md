# CUST-H4-8b — Workspace-Authorized Product Media for Canvas

| | |
|---|---|
| **Base SHA** | `064a91e7df3d31962758364911608e1f8631e114` (`origin/main`, verified via `git fetch origin main` + `git rev-parse origin/main`, not assumed). Its immediate parent is `c5b89c2b84e3dde6dca586f012298b2c0a26675d` — the H4-8 squash merge (PR #1215) — confirmed directly with `git log --oneline` and `git merge-base --is-ancestor`. |
| **Head SHA** | see the PR (one commit on top of the Base SHA, this branch) |
| **Branch** | `fix/cust-h4-8b-canvas-product-media` |
| **PR** | opened for this fix — **not merged** |
| **Merge / Deploy / Production** | **None.** Not merged, not deployed, not released. |
| **Scope** | Canvas product-image blocker B1 only. No media architecture redesign, no storefront/public media semantics change, no Offers/Featured/NewArrivals product scope change. |

---

## 1. Confirmed root cause

H4-8's integrated QA (`docs/reports/CUST-H4-8-INTEGRATED-QA-REPORT.md` §15, blocker B1) found that the workspace product/offer read endpoints that feed Canvas —

- `CommerceWorkspaceStorefrontProductController::index()/show()` (New Arrivals' and Featured's product picker/preview data), and
- `StorefrontOfferResource::workspace()` (Offers' Canvas preview data)

— built every `thumbnail_url`/`media[].url` via `StorefrontProductResource::commerceMediaPayload()` → `buildCommerceMediaUrl()`, which points at `/commerce/v1/media/{id}` — the **mobile `ApiClient`/bearer trust boundary** (`CommerceMediaController`). That route is correct for the mobile app (which can always attach `Authorization: Bearer <api-client-key>`), but the merchant's web Canvas renders these URLs as plain `<img src="...">` tags.

Verified directly in `web/src/lib/api.ts`: the AWJ merchant web app authenticates **every** API call with `Authorization: Bearer <token>` read from `localStorage` (`export function api<T>(...)`), not with a session cookie. There is no `EnsureFrontendRequestsAreStateful`/cookie-based Sanctum SPA mode in use here. A plain `<img>` tag cannot attach a custom header, so the browser's request to `/commerce/v1/media/{id}` carries no `Authorization` at all → `401` → the browser reports `net::ERR_BLOCKED_BY_ORB` and the `<img>` renders broken.

The codebase already has (and documents) the correct general pattern for "authenticated-API image in a plain `<img>`" in `web/src/lib/api.ts::fetchImageUrl()` — fetch with the Bearer header, turn the blob into an object URL. The H4-8b brief explicitly forbids reusing that pattern here ("no blob hydration layer", "no JS fetch-per-image") because it would reintroduce exactly the N+1-per-card problem the Canvas/Published parity work has been careful to avoid. So the fix had to be a **URL contract change**, not a frontend data-fetching change.

## 2. Chosen auth model

**A short-lived, resource-scoped signed URL** (Laravel's built-in `URL::temporarySignedRoute()` / `signed` route middleware — a framework feature, not new cryptography):

```
Authenticated merchant browser (Bearer token)
  → GET /api/commerce/workspace/storefronts/{id}/products   (existing, auth:sanctum + commerce.manage + ownedStorefront())
  → server resolves the gallery via ProductMediaGalleryService (existing, unchanged)
  → server mints a signed URL for each media item, valid 20 minutes
      StorefrontProductResource::buildWorkspaceMediaUrl($mediaId, $storefrontId)
  → response JSON carries that URL as thumbnail_url / media[].url

Browser <img src="...signed-url...">            (no Authorization header, no JS, no blob)
  → GET /api/commerce/workspace/storefronts/{id}/media/{media}?expires=...&signature=...
  → `signed` middleware validates the signature + expiry (the ONLY authority on this route —
    there is no auth:sanctum here, because a plain <img> cannot supply a bearer token)
  → CommerceWorkspaceMediaController re-verifies tenant ownership + channel publication
    (defense in depth, independent of the signature) → same ProductMedia storage read path
  → bytes
```

Why this satisfies every constraint in the brief:

- **No bearer token in the URL.** The signature is an HMAC over the route name + parameters + expiry, keyed by `APP_KEY` — it is not the user's Sanctum token and cannot be used to call any other endpoint or retrieve any other resource.
- **Not a long-lived/casual public URL.** Expiry is 20 minutes; every time the merchant's browser reloads the product/offer list it gets fresh signed URLs. The underlying media stays private — only the signature changes what a given request is allowed to see "right now".
- **No tenant/storefront id as authority.** The storefront id in the path is informational; neither it nor any other request value is trusted as authority. Authority is (a) the signature (unforgeable, time-boxed) **and independently** (b) the controller's own tenant/publication re-check against the database, exactly like the two existing sibling controllers.
- **Workspace media stays private**, not made public: the new route is distinct from `/store/v1/media` (the genuinely anonymous, `Cache-Control: public` route) and from `/commerce/v1/media` (the bearer-gated mobile route). It is `Cache-Control: private, max-age=600` — not shareable by an intermediate cache/CDN, matching the mobile route's own reasoning, not the public one's.
- **No new storage architecture, no duplicated authority.** It reuses `ProductMedia`, the same R2/`document`-disk/legacy-disk read logic the two existing controllers already had (see §5), and the same `ProductMediaGalleryService` resolution used everywhere else.

## 3. Route / contract

```
GET /api/commerce/workspace/storefronts/{id}/media/{media}
    middleware: signed            (NOT auth:sanctum — see §2)
    name: commerce.workspace.media.show
```

Authority chain inside `CommerceWorkspaceMediaController::show()`:

1. `Storefront::query()->withoutGlobalScope(TenantScope::class)->find($id)` — explicit, because no `SetTenant` ran on this unauthenticated route; missing → non-revealing `404`.
2. `ProductMedia::query()->withoutGlobalScope(TenantScope::class)->find($media)` — missing, **or** `tenant_id !== $storefront->tenant_id` → `404`.
3. `CommerceListing` must exist for `(product_id, sales_channel_id = $storefront->sales_channel_id, is_published = true)` — unpublished, or published only on a *sibling* storefront's channel → `404`.
4. Bytes served via the shared `ServesProductMediaBytes` trait (§5), `Cache-Control: private, max-age=600`.

Generation (only ever called from inside the fully authenticated `commerce.manage` + `ownedStorefront()` context, never client-supplied):

```php
StorefrontProductResource::buildWorkspaceMediaUrl(string $mediaId, string $storefrontId): string
// URL::temporarySignedRoute('commerce.workspace.media.show', now()->addMinutes(20), ['id' => $storefrontId, 'media' => $mediaId])

StorefrontProductResource::workspaceMediaPayload(iterable $items, string $storefrontId): array
// same {id, url, alt, position} shape as commerceMediaPayload()/mediaPayload(), url built via buildWorkspaceMediaUrl()
```

## 4. Exact files changed

**New:**
- `app/Http/Controllers/Api/CommerceWorkspaceMediaController.php` — the new route's controller (authority chain above).
- `app/Http/Controllers/Api/ServesProductMediaBytes.php` — trait extracted from the two existing media controllers' identical three-branch byte-serving logic (`document` disk / `r2` / legacy named-disk fallback), so the third controller reuses it instead of a fourth copy. Kept as a flat file in `app/Http/Controllers/Api/` (not a `Concerns/` subdirectory) because `setup.sh`/`ci.yml` only copy `app/Http/Controllers/Api/*.php` one level deep — a subdirectory would silently vanish from the built app (the exact footgun `setup.sh`'s own comment warns about).
- `tests/Feature/CommerceWorkspaceMediaApiTest.php` — 13 new tests (§8).
- `scripts/qa/h4-8/h4-8b-verify.mjs` — real-stack reproduction script (§9), reusing the H4-8 harness's `lib.mjs`/`seed.json`.
- `scripts/qa/h4-8/seed-media-visible.php`, `scripts/qa/h4-8/checker.png` — visual-QA variant of `seed-media.php` with a visibly distinct 64×64 checkerboard image instead of a 1×1 pixel (§10).

**Modified:**
- `app/Http/Resources/StorefrontProductResource.php` — added `workspaceMediaPayload()`/`buildWorkspaceMediaUrl()`. `mediaPayload()`/`buildMediaUrl()` (public `/store/v1`) and `commerceMediaPayload()`/`buildCommerceMediaUrl()` (mobile `/commerce/v1`) are untouched.
- `app/Http/Resources/StorefrontOfferResource.php` — `workspace()` now takes `$storefrontId` and builds its thumbnail via `workspaceMediaPayload()` instead of `commerceMediaPayload()`. `public()` (the Published/anonymous read) is untouched.
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontProductController.php` — `index()`, `show()`, `simpleResource()`, `variantResource()` now thread the storefront id through and call `workspaceMediaPayload()` instead of `commerceMediaPayload()`. No change to eligibility/pricing/availability logic.
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontOfferController.php` — both call sites of `StorefrontOfferResource::workspace()` now pass `$storefront->id`.
- `app/Http/Controllers/Api/CommerceMediaController.php` / `app/Http/Controllers/Api/StorefrontMediaController.php` — `show()` bodies reduced to the shared trait call; **identical behavior**, proven by the existing `CommerceMediaApiTest` (13 tests) and `ProductMediaR2CommerceStorefrontReadTest` (2 tests) passing unmodified (§8). `StorefrontMediaController::showCategory()` (a different model, `ProductCategory`) is untouched.
- `routes/api.php` — one new unauthenticated, `signed`-only route (placed in the existing "عام (بلا مصادقة)" block, next to `health`/`company-browser-identity`, not inside the `auth:sanctum` commerce-workspace group — see §2 for why).
- `tests/Feature/CommerceModuleBoundaryTest.php` — added the new route's URI to `ALLOWED_COMMERCE_API_ROUTES` (this guard test enumerates *every* route whose URI contains "commerce" across the whole app and fails on anything unlisted; it correctly caught the new route and needed one line).

## 5. Storage reuse

No new storage logic, no new table, no new bucket. `CommerceWorkspaceMediaController` uses the exact same `ProductMedia` model, the exact same `document`/`r2`/legacy-disk three-branch read (now shared via `ServesProductMediaBytes`) that `CommerceMediaController` and `StorefrontMediaController` already had. `ProductMedia.path`/`disk` are still never exposed to any client in any response.

## 6. Tenant isolation

Enforced twice, independently:

1. **Signature** — unforgeable, scoped to the exact `(id, media)` pair and an expiry; a tampered parameter invalidates it (`403`, Laravel's own `ValidateSignature`).
2. **Controller re-check** — even presented with a *mathematically valid* signature for an arbitrary `(storefront, media)` pair (simulated directly in tests, bypassing normal generation), the controller independently rejects:
   - media whose `tenant_id` differs from the storefront's tenant → `404`
   - media for a product not published on *that storefront's own* sales channel (including a sibling storefront of the *same* tenant) → `404`
   - a nonexistent storefront or media id → `404`
   - a malformed (non-UUID) id → `404` (route pattern)
   - an expired signature → `403`

All failure paths return the same non-revealing `404` (or Laravel's standard `403` for a bad/expired signature) with no information about which check failed.

## 7. Storefront/channel eligibility

Same rule the workspace product/offer reads themselves already enforce: the referenced product must have a `CommerceListing` with `is_published = true` on **this storefront's own** `sales_channel_id`. A product published only on a sibling storefront's channel (same tenant) is not served through this storefront's media URL — proven by `media_published_only_on_a_sibling_storefronts_channel_is_not_served_via_this_storefront` (it also proves the same media *is* served through the storefront it's actually published on).

## 8. Tests / results

Backend, run against SQLite via `php artisan test`:

| Suite | Result |
|---|---|
| `CommerceWorkspaceMediaApiTest` (new, 13 tests) | **13 passed, 45 assertions** — signed-contract payload shape, zero-Authorization-header byte serving, cache header, foreign-tenant/foreign-storefront/unpublished/sibling-channel/missing/malformed 404s, expired-signature 403, tampered-parameter 403, no path/disk leak |
| `CommerceMediaApiTest` (existing, unmodified) | **13 passed** — proves the `ServesProductMediaBytes` extraction changed nothing about `/commerce/v1/media` |
| `ProductMediaR2CommerceStorefrontReadTest` (existing, unmodified) | **2 passed** — R2-backed bytes on both `/commerce/v1` and `/store/v1`, unaffected |
| `CommerceWorkspaceStorefrontProductApiTest` (existing, unmodified) | **30 passed, 115 assertions** — the storefront-id-threading change didn't touch eligibility/pricing/pagination/sorting/`ids[]` behavior |
| `CommerceWorkspaceStorefrontOfferApiTest` (existing, unmodified) | **45 passed, 311 assertions** — offers CRUD/isolation/price-field-rejection all unaffected by the thumbnail-url change |
| `CommerceModuleBoundaryTest` (1 line added) | **3 passed** — the new route is now the one explicitly allow-listed Commerce API addition |
| Full suite, no `--filter`, **real CI** (`.github/workflows/ci.yml`, both `L11, sqlite` and `L11, pgsql`) | **green** — all 4 jobs across this PR's push + pull_request triggers completed with `conclusion: success` |
| Full suite, no `--filter`, local sandbox | 5511 passed / 56 failed / 57 skipped — all 56 failures traced to `Class "App\Mail\AuthActionMail" not found`, a pre-existing gap in this sandbox's `setup.sh` copy step (it omits `app/Mail/`, unlike `ci.yml` which copies it explicitly — confirmed by reading both scripts). Unrelated to this change: no file this PR touches is under `app/Mail`, and the real CI run above (which does copy `app/Mail/` correctly) is green. Not a repo-wide regression — fixed locally for this session by manually copying `app/Mail/` into the sandbox's build. |

Web: **zero files under `web/` were changed.** `thumbnailUrl`/`thumbnail_url` is consumed identically before and after this change — every Canvas consumer (`OfferParts.tsx`, `ProductPreviewPickerPanel.tsx`, `StorefrontPreviewCanvas.tsx` ×3 (New Arrivals/Featured/Offers), `ControlPanels.tsx`, `OfferCatalog.tsx`) already binds the resource's `thumbnail_url`/`thumbnailUrl` string directly into `<img src>` with no header construction, no blob handling, no URL rewriting. The bug was entirely in what URL the backend returned, not in how the frontend consumed it — confirmed by reading every one of those call sites before writing any code. Web CI (`web-ci.yml`) only triggers on `web/**` changes, so it does not run on this PR, and does not need to.

## 9. Real-stack evidence (H4-8 harness reuse)

Reused `scripts/qa/h4-8/{lib.mjs,seed.php,seed-media.php,reset.sh}` against the real `nibras-app` Laravel build (synced via `setup.sh`) and a real `next dev` web server — not component mocks. New script `scripts/qa/h4-8/h4-8b-verify.mjs`:

1. Logs in for real (`POST /api/login`), creates a real offer for the seeded product with real attached media via the real workspace Offers API.
2. Reads the real workspace product list and offer list payloads and asserts their `thumbnail_url` is the new signed route, not `/commerce/v1/media`.
3. Does a **plain `fetch()` with deliberately no `Authorization` header** against that exact URL — the literal `<img>`-tag scenario — and asserts `200` + `image/*`.
4. Configures the real draft (New Arrivals visible, Featured → the seeded product, Offers → the new live offer), saves and publishes through the real presentation API.
5. Opens the real Canvas (`/commerce/appearance`) in a real Playwright/Chromium browser, logged in as the merchant, and for each of the three sections (`New Arrivals`, `Featured`, `Offers`) locates the real `<img>` the real React tree rendered and asserts `naturalWidth > 0` / `complete === true` (i.e. a real decoded image, not a broken-image glyph) — plus asserts the browser's own network layer sent **no `Authorization` header** on any `/media/` request and got `200` back on all of them.
6. Screenshots each surface individually plus the whole panel, at desktop and `390`px.

**Result: `FAILS 0`** — every assertion passed, including the three real-browser checks:

```
New Arrivals: real image loaded (naturalWidth=64, complete=true)
Featured: real image loaded (naturalWidth=64, complete=true)
Offers: real image loaded (naturalWidth=64, complete=true)
the browser issued at least one real HTTP request for a workspace media URL
none of those <img>-triggered requests carried an Authorization header
every workspace media response was 200
```

(`seed-media.php`'s default 1×1 test pixel is enough to prove the HTTP/auth contract but is visually imperceptible; `scripts/qa/h4-8/seed-media-visible.php` — new, same pattern — attaches a 64×64 checkerboard PNG instead for actual visual inspection, used for the screenshots in §10.)

## 10. Visual QA

AR RTL, real browser (Chromium via Playwright), real product (64×64 checkerboard PNG so a human can actually see it, not the 1×1 pixel used for the assertion-only runs):

| Surface | Desktop (1440) | Mobile (390) |
|---|---|---|
| New Arrivals | real card image renders, no broken-image glyph | same — card below the first fold, confirmed via element screenshot (scroll-independent) |
| Featured | real card image + product name | same |
| Offers | real card image **with live price/discount** (`199.00 ر.س` / `~~250.00 ر.س~~` / `خصم 20%`) — proves the image fix composes correctly with the already-shipped H4-7 Offers price resolution | same |

Published regression: covered by the existing, unmodified `CommerceMediaApiTest`/`ProductMediaR2CommerceStorefrontReadTest`/`StorefrontMediaController` tests (§8) — byte-for-byte unchanged behavior, not re-screenshotted here since nothing in the Published path changed.

Missing-image fallback: unchanged — `{product.thumbnailUrl ? <img .../> : null}` in `StorefrontPreviewCanvas.tsx` is untouched by this PR; a product with no media still renders no `<img>` (no broken-icon regression risk introduced).

A harness note for future reruns: `page.screenshot({ fullPage: true })` and a whole-panel element screenshot of `[data-preview-canvas]` can both capture a card below the panel's own internal scroll fold mid-paint (an unrelated Playwright/virtualized-scroll timing quirk, not a product bug — confirmed by the fact that a *targeted* per-section element screenshot of the exact same DOM node, taken moments apart, is always correct). `h4-8b-verify.mjs` screenshots each of the three sections individually for this reason.

## 11. Security review

- Signature is HMAC-based (Laravel core), keyed by the app's `APP_KEY`; not reversible, not reusable across different `(id, media)` pairs or past its expiry.
- No secret, token, or tenant identifier is ever treated as authority from client input on the new route — see §6.
- `Cache-Control: private` prevents a shared proxy/CDN from serving one merchant's signed response to a different requester.
- The route is additive; it does not alter, weaken, or bypass `/commerce/v1/media` or `/store/v1/media`'s own guards (unchanged, proven by their own still-green test suites).
- No raw storage path/disk is exposed in any JSON response (unchanged from before — still asserted by both the existing and new tests).

## 12. Backward compatibility

- `/commerce/v1/media/{id}` and `/store/v1/media/{id}` behavior is byte-for-byte unchanged (proven by their existing, unmodified test suites passing after the shared-trait extraction).
- Mobile Commerce clients are untouched — `CommerceProductController` (the mobile product read) still builds its `thumbnail_url`/`media[]` via `commerceMediaPayload()`, unchanged.
- The only contract change is additive: workspace product/offer payloads now return a different (correct) URL shape for a field (`thumbnail_url`) that was already documented as "whatever URL the backend says" — no consumer parsed or depended on the old URL's shape.

## 13. Performance

- **Zero new product/media metadata API calls.** The signed URL is embedded directly in the existing single list/detail response (`GET .../products`, `GET .../offers`) — no per-card follow-up request.
- **Zero new JS fetch-per-image / no blob hydration.** The browser's own `<img>` tag issues one ordinary HTTP GET per distinct image URL, exactly as it always has for `/store/v1/media` on the Published side.
- No new N+1 at the application-query level: `workspaceMediaPayload()` is a pure URL-string builder (one `URL::temporarySignedRoute()` call per already-resolved `ProductMedia` row); it adds no database query of its own. The gallery resolution itself (`ProductMediaGalleryService::resolveGallery()`) is unchanged.

## 14. Remaining risks / follow-ups

- Signed-URL expiry (20 minutes) means a Canvas tab left open and idle past that window will show broken thumbnails until the merchant reloads the product/offer list (a normal page refresh, or any action that re-fetches it, mints fresh URLs). This is an accepted, deliberate trade-off (short exposure window) rather than a bug; no user-facing "refresh" affordance was added because every existing list-reload path already covers it.
- This fix does not touch the Categories Canvas preview, which still renders a deliberately-labeled mock fixture (`PREVIEW_CATEGORIES`), not real images — out of scope for B1 per the H4-8 report itself (categories/newArrivals Canvas parity is a separate, already-tracked item, and newArrivals specifically *does* use this fix since it shares the same workspace product payload).

## 15. H4-8 rerun recommendation

Re-run `scripts/qa/h4-8/canvas-media-probe.mjs` (the original B1 reproduction script) and `scripts/qa/h4-8/published-all-sections.mjs` against this branch once merged to `main`, to close out CUST-H4-8's `B) NOT READY` verdict. This report's own `h4-8b-verify.mjs` additionally exercises the exact browser no-Authorization-header path the original probe only inferred from the `401`/`ERR_BLOCKED_BY_ORB` symptom.

## 16. Confirmation

**No Merge. No Deploy. No Production release.**
