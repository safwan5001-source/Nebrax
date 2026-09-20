# COM-MOBILE-MEDIA-1 — Implementation Report

**Task:** Close the Public/Mobile Commerce Product Media gap
**Branch:** `claude/autonomous-engineering-bootstrap-fo0mvj` · **Base:** `main` @ `c333836`
**Date:** 2026-09-20
**STATUS:** review (pre-merge)

---

## Outcome

`/commerce/v1` (the mobile Commerce trust boundary) can now retrieve authorized product
media. `GET /commerce/v1/products` returns a real `thumbnail_url`, and
`GET /commerce/v1/products/{id}` returns the full `media` gallery — both previously
hardcoded to `null`/absent because, as `CommerceProductController`'s own docblock stated,
"no `/commerce/v1/media/{id}` route exists yet." That route now exists
(`GET /commerce/v1/media/{id}`, `CommerceMediaController`), gated by the exact same
tenant/channel/publication authority the rest of `/commerce/v1` already enforces, and
reusing — not duplicating — the existing `ProductMedia` storage authority and
`ProductMediaGalleryService` gallery-resolution authority (VAR-MEDIA-1).

## Repository evidence / root cause

- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §6 classified product media as
  **Missing** for `/commerce/v1`, with the explicit required outcome: "create a
  mobile-authorized media delivery contract that reuses AWJ's hardened product-media
  storage/tenant authority. Do not duplicate media records/storage for App Builder."
- `app/Http/Controllers/Api/CommerceProductController.php`'s own docblock stated the gap
  verbatim ("Media deliberately out of scope — no `/commerce/v1/media/{id}` route exists
  yet ... `thumbnail_url`/`media` resolve to `null`/absent").
- `/store/v1` already solves the identical problem for the web trust boundary:
  `StorefrontMediaController` serves `ProductMedia` bytes gated by `CommerceListing`
  publication on the resolved channel, and `StorefrontProductController` wires
  `ProductMediaGalleryService` + `StorefrontProductResource::mediaPayload()` into both its
  list and detail responses. This is the pattern to mirror for the mobile boundary, per
  the readiness doc's own instruction to reuse the hardened authority rather than invent a
  new one.
- `ResolveCommerceChannel` (already in the `/commerce/v1` read-group middleware chain)
  populates the same `StorefrontContext` class the storefront path uses, with the tenant's
  resolved *mobile* `SalesChannel` — never a client-supplied id. This means the exact same
  `CommerceListing`-publication check `StorefrontMediaController` performs is directly
  reusable for the mobile boundary with zero new resolution logic.
- `ProductMedia` extends `BaseModel implements CompanyWide` — it is already
  `TenantScope`-isolated automatically; no explicit tenant filter is needed in the new
  controller (mirrors `StorefrontMediaController` exactly).

## Approach chosen

1. **New route + controller**, not a reuse of `StorefrontMediaController`: `/commerce/v1`
   is architecturally a separate trust boundary from `/store/v1` (shares Commerce
   *services*, never routes/controllers — see `CommerceApiServiceProvider`'s own
   docblock). `CommerceMediaController::show()` mirrors `StorefrontMediaController::show()`
   line-for-line in its guard logic (find media → tenant-scoped by `TenantScope` →
   `CommerceListing` published on `StorefrontContext::salesChannelId()` → serve bytes from
   the same `Storage::disk()`), with the only difference being *which* resolved channel it
   checks against (mobile vs. web) — that difference is already handled entirely by which
   middleware ran (`ResolveCommerceChannel` vs. `ResolveStorefrontDomain`/`ResolveStorefrontTenant`),
   not by any new code in the controller itself.
2. **Route:** `GET commerce/v1/media/{id}` (`whereUuid('id')`), name `commerce.v1.media.show`,
   placed in the existing read-only middleware group (`AuthenticateApiClient` →
   `PublicApiTenantGuard` → `ResolveCommerceChannel` → `PublicApiRequestAudit` →
   `EnforcePublicApiRateLimit:read` → `EnsureActiveSubscription`) — unmodified, identical to
   `products`/`categories`.
3. **Gallery wiring:** `CommerceProductController::index()`/`show()` now inject
   `ProductMediaGalleryService` and call `resolveGallery($product)` (product-level shared
   gallery only — no variant passed) for every product, matching
   `StorefrontProductController`'s own accepted N+1-per-row pattern for list rows (not a
   new performance regression, an existing precedent).
4. **URL builder:** `StorefrontProductResource` gained `commerceMediaPayload()` +
   `buildCommerceMediaUrl()`, siblings of the existing `mediaPayload()`/`buildMediaUrl()`
   that point at `commerce.v1.media.show` instead of `storefront.v1(.legacy).media.show`.
   Both now share one private `buildPayload()` loop (extracted, not duplicated) — the only
   difference between the two trust boundaries is which route name the URL is built from;
   the item shape (`id`, `url`, `alt`, `position`) is identical business data, so keeping
   one shared iteration loop avoids maintaining two copies of the same array-building code.
5. **Variant media stays deferred**, unchanged: `CommerceProductController`'s existing
   variant deferral (no parent price/stock, no variant/options payload) is untouched by this
   task. Only the product-level shared gallery is wired in; a variant-managed product's
   per-variant media remains part of `COM-MOBILE-VARIANTS-1`'s scope, not invented here.

## Why this approach fits AWJ

- **Source-of-truth discipline (CLAUDE.md, non-negotiable rule):** no new media storage,
  no new gallery-resolution algorithm, no new tenant/publication-check logic — every piece
  is the existing authority, reused. The only new code is a thin controller (guard +
  byte-serving, ~35 lines, structurally identical to its `/store/v1` sibling) and a route.
- **Trust-boundary separation is preserved, not blurred:** the mobile boundary gets its own
  controller/route/URL builder rather than reusing `/store/v1`'s — exactly the architecture
  the readiness doc and `CommerceApiServiceProvider` already mandate ("a new, separate
  trust boundary that shares Commerce services, not routes or middleware").
- **Fail-closed by construction:** every negative path (foreign tenant, foreign/web-only
  channel, unpublished product, invalid/nonexistent id, inactive channel) returns the same
  non-revealing 404 `CommerceProductController` already returns for the analogous product
  case — no new error taxonomy introduced.

## Changed files

- `app/Http/Controllers/Api/CommerceMediaController.php` (new) — guarded media byte-serving
  for `/commerce/v1`.
- `routes/api_commerce.php` — adds `GET media/{id}` to the existing read-only group.
- `app/Http/Controllers/Api/CommerceProductController.php` — wires
  `ProductMediaGalleryService` into `index()`/`show()`; updates the class docblock's
  now-stale "media out of scope" note.
- `app/Http/Resources/StorefrontProductResource.php` — adds `commerceMediaPayload()` /
  `buildCommerceMediaUrl()`; extracts the shared `buildPayload()` loop (no behavior change
  to the existing `mediaPayload()`/`buildMediaUrl()` call sites).
- `tests/Feature/CommerceMediaApiTest.php` (new) — 11 focused tests (see below).
- `tests/Feature/CommerceModuleBoundaryTest.php` — adds `commerce/v1/media/{id}` to the
  explicit route allowlist (`CommerceModuleBoundaryTest` fails closed on any
  undocumented `/commerce/v1` route; this is the deliberate, expected update for a newly
  authorized route).

No migration. No new model. No new business/storage authority.

## Tests and exact results

### New — `tests/Feature/CommerceMediaApiTest.php` (11 tests / 23 assertions)

| Test | Proves |
|---|---|
| `published_product_media_is_returned_as_the_listing_thumbnail_and_detail_gallery` | List `thumbnail_url` and detail `media[].url` point at `/commerce/v1/media/{id}` |
| `a_product_with_no_media_has_a_null_thumbnail_and_empty_gallery` | No false media conjured for a product with none |
| `the_media_route_serves_the_actual_file_bytes_for_a_published_product` | Byte-serving + `Content-Type` work end-to-end |
| `a_foreign_tenants_media_id_is_not_served` | Cross-tenant leakage blocked (`TenantScope`) |
| `media_of_an_unpublished_product_is_not_served` | Publication gate enforced |
| `media_published_only_on_a_web_channel_is_not_served_via_commerce_v1` | Foreign-channel (web) media not exposed via mobile boundary |
| `an_inactive_products_media_is_still_served_since_publication_alone_gates_media` | Matches `/store/v1` behavior exactly (documented, not accidental) |
| `a_nonexistent_media_id_returns_a_non_revealing_404` | Non-revealing 404 |
| `an_invalid_media_id_shape_is_rejected` | `whereUuid` route constraint |
| `an_inactive_mobile_channel_denies_media_access` | Channel resolution failure fails closed |
| `no_sensitive_storage_path_or_disk_leaks_in_any_response` | No `disk`/`path` leakage in any JSON response |

Run: `php artisan test --filter=CommerceMediaApiTest` → **11 passed (23 assertions)**, SQLite and PostgreSQL.

### Regression — unchanged behavior confirmed

- `php artisan test --filter=CommerceCatalogApiTest` → 13 passed (SQLite + PostgreSQL) —
  pricing/pagination/isolation tests untouched by the new gallery wiring.
- `php artisan test --filter=StorefrontCatalogApiTest` → 15 passed (SQLite + PostgreSQL) —
  `/store/v1` behaviorally identical (its own media test still asserts `/store/v1/...`
  URLs).
- `php artisan test --filter=CommerceModuleBoundaryTest` → 3 passed — allowlist correctly
  updated for the one new route, no other undocumented route introduced.
- `php artisan test --filter="Commerce|Storefront|ProductMedia|Variant"` on **PostgreSQL**
  → **987 passed (4407 assertions)**, 0 failures — full commerce/storefront/variant/media
  module regression green on the production database engine.

### Full suite

- **SQLite, full `php artisan test`:** 4346 passed, 35 failed, 49 skipped. All 35 failures
  are **pre-existing and unrelated** to this change, isolated to this local sandbox's
  bootstrap (`setup.sh`), not to the repository or to actual CI:
  - 26 failures in `Fuel*Test` (`FuelSupplyReceivingTest`, `FuelReconciliationTest`,
    `FuelSaleServiceTest`, `FuelSaleApiTest`, `FuelSupplyReceivingApiTest`,
    `FuelAviRfidServiceTest`) — `Call to undefined function App\Services\bcmul()`. The
    sandbox is missing the `bcmath` PHP extension, which `.github/workflows/ci.yml`
    explicitly installs (`extensions: ..., bcmath, ...`) but which could not be installed
    here (outbound package-proxy denies the `ondrej/php` PPA host). Confirmed unrelated to
    fuel/media by inspection — `FuelCostBasisService` has no relationship to Commerce/Product
    media.
  - 9 failures in `AuthRecoveryTest`/`DocumentCenterSecureIntakeTest` — traced to
    `setup.sh` (this sandbox's local bootstrap script) never copying `app/Mail/` or
    `resources/views/` into the built Laravel project, unlike `.github/workflows/ci.yml`
    which copies both (`cp -r "$CORE/app/Mail/"*.php app/Mail/`,
    `cp -r "$CORE/resources/views/"* resources/views/`). Manually syncing both directories
    into the sandbox fixed `AuthRecoveryTest` completely (8/8) and left one residual,
    unrelated `DocumentCenterSecureIntakeTest` PDF-validation failure ("ملف PDF تالف أو غير
    مدعوم") that has no connection to Commerce/media and was not investigated further, being
    entirely out of this task's scope.
  - None of the 35 failures are in any `Commerce*`, `Storefront*`, `Product*`, or
    `Variant*` test class.
  - This is a documented **local sandbox gap in `setup.sh`**, not a repository defect — it
    is recorded as discovered backlog below rather than fixed in this PR (out of
    COM-MOBILE-MEDIA-1's scope; `setup.sh` is unrelated tooling).
- **PostgreSQL:** full-suite run not repeated (same unrelated `bcmath`/local-setup gaps
  would reproduce); the full commerce/storefront/variant/media module regression (987
  tests) was run instead and is green, and the actual CI workflow runs the complete suite
  on both engines with the correct extensions/resources.

## Build / lint / typecheck

No `web/` changes — Web CI not applicable. No PHP static-analysis tool configured in this
repository beyond `php artisan test` (verified via `composer.json`/CI).

## CI

Not yet observed on the exact final Head SHA — pending push/PR per Gate 7/9. Will be
inspected before Pre-Merge Review, and any task-caused failure will be fixed before merge.

## Pre-merge review

- PRE_MERGE_REVIEW: *(recorded below, immediately before merge, on the exact final Head SHA)*
- Reviewed Head SHA: *(pending)*
- Findings / resolution: *(pending)*

## Merge

- Merge status: *(pending)*
- Merge SHA: *(pending)*

## Post-merge review

- POST_MERGE_REVIEW: *(pending)*
- Reviewed Merge SHA: *(pending)*
- Target-branch checks/smoke: *(pending)*
- Findings / resolution: *(pending)*

## Self-review

### Implementer
Smallest correct change: one new controller (~35 lines, structurally identical to its
`/store/v1` sibling), one new route, gallery wiring added to two existing controller
methods, one shared private helper extracted to avoid duplicating the media-payload loop
across two trust boundaries. No unrelated refactor.

### Reviewer
- Verified positional-argument wiring after adding `ProductMediaGalleryService $gallery`
  and `$galleryMedia` through `index()`/`show()`/`toResource()` — covered by passing tests
  for both list and detail shapes.
- Verified the `index()` per-row `resolveGallery()` call is an accepted existing pattern
  (matches `StorefrontProductController::index()` identically), not a new N+1 introduced
  by this change for a boundary that didn't have the problem before — both boundaries now
  share the same, already-accepted characteristic.
- Verified variant-managed products still get their (product-level, non-variant) shared
  gallery without resolving any per-variant media — consistent with the documented variant
  deferral.
- Verified no other call site of `StorefrontProductResource::mediaPayload()`/`buildMediaUrl()`
  exists that could be affected by the refactor into `buildPayload()` (only
  `StorefrontProductController` calls them; unchanged behavior confirmed by its own green
  tests).

### AWJ Guardian
- **Tenant isolation:** `ProductMedia::query()->find($id)` is `TenantScope`-filtered
  automatically (set by `AuthenticateApiClient` from the authenticated `ApiClient`'s own
  tenant — never client input); a foreign-tenant id resolves to `null` and 404s
  non-revealingly. Tested.
- **Channel/publication boundary:** gated by `CommerceListing` publication on
  `StorefrontContext::salesChannelId()`, populated only by `ResolveCommerceChannel` from
  the tenant's single active `mobile` `SalesChannel` — never a client-supplied value. A
  web-only-published product's media is unreachable via `/commerce/v1`. Tested.
- **No parallel authority:** identical `ProductMedia`/`Storage::disk()` authority as
  `/store/v1`; identical `ProductMediaGalleryService` gallery-resolution algorithm as every
  other consumer (POS, storefront, mobile now).
- **No sensitive leakage:** `disk`/`path` never serialized in any JSON response (only the
  guarded byte-serving route touches them server-side). Tested.
- **Backward compatibility:** `/store/v1` untouched (own test suite green, its own media
  test still asserts `/store/v1/...` URLs verbatim); `/commerce/v1`'s new media fields are
  strictly additive (`thumbnail_url`/`media` previously `null`/absent, now populated —
  every consumer of the previous shape already had to handle `null`).

### Researcher/Architect
Confirmed against `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §6's explicit
required outcome and against the already-accepted `/store/v1` implementation as the
reference pattern — no external research was needed (a purely internal-authority-reuse
task).

## Accounting impact

None. This task introduces no financial operation, no new journal entry, no change to any
existing posting. (CLAUDE.md's mandatory pre-PR journal-entry table is not applicable —
explicitly noted rather than omitted silently.)

## Tenant / branch isolation impact

Tenant isolation preserved and tested (see AWJ Guardian above). Branch isolation is not
applicable: `ProductMedia` is `CompanyWide` (no branch scoping), matching its existing
classification — this task does not change that classification.

## Security / authorization impact

New route reuses the existing `/commerce/v1` read-group middleware chain unmodified
(`AuthenticateApiClient` → `PublicApiTenantGuard` → `ResolveCommerceChannel` →
`PublicApiRequestAudit` → `EnforcePublicApiRateLimit:read` → `EnsureActiveSubscription`).
No new authentication/authorization primitive introduced.

## Backward compatibility

Fully additive. No existing route, contract field, or response shape changed meaning;
previously-`null`/absent fields now carry real data.

## API / DB / migration impact

One new route (`GET /commerce/v1/media/{id}`). No migration, no schema change, no new
model.

## External research used

None — purely internal source-of-truth reuse; the required approach was already fully
specified by repository evidence (`/store/v1`'s own implementation + the readiness doc's
explicit instruction).

## Automated review findings (Codex, PR #911)

Three findings were posted by the repo's automated Codex reviewer on commit `d745d7b854`.
All three were verified against repository evidence:

1. **P1 — `Cache-Control: public` on bearer-gated media (fixed).**
   `CommerceMediaController` originally copied `StorefrontMediaController`'s
   `Cache-Control: public, max-age=3600` verbatim. That is safe on `/store/v1` because that
   route is fully anonymous (no `Authorization` at all — any caller of the same URL already
   has the same right). `/commerce/v1/media/{id}` is bearer-gated
   (`AuthenticateApiClient` + tenant/channel/publication/subscription checks); `public`
   would let a shared proxy/CDN replay a cached response to a different caller without
   re-running those checks, and keep bytes servable for up to an hour after unpublishing or
   client revocation. **Fixed:** changed to `Cache-Control: private, max-age=3600` (browser
   caching preserved, shared/proxy caching disallowed). New regression test:
   `the_response_is_marked_private_not_shareable_by_a_proxy_or_cdn`. This was a real,
   in-scope defect in the new code (not inherited from an equivalent trust boundary) — fixed
   directly, not deferred.
2. **P1 — media shares the 100/min `read` rate-limit budget with catalog reads.** Verified
   against `app/Support/PublicApiRateLimits.php`: this is the *exact same architecture*
   already shipped for `/store/v1` — its own `media/{id}` route shares the **same**
   `unauth` bucket (30/min, even tighter) with `products`/`categories`/`cart`/`checkout` for
   that IP. This PR's `read` class (100/min) is strictly more generous than the existing,
   already-accepted precedent. Introducing a dedicated media rate-limit class means picking
   a concrete number with real cost/abuse trade-offs — a configurable-policy decision per
   CLAUDE.md's own governance rule, not a bug local to this PR's new code. **Not fixed here
   — recorded as backlog below** rather than silently choosing a number; replied on the PR
   thread with this evidence.
3. **P2 — no batched gallery loading for the product list (`index()`).** Verified: this
   mirrors `StorefrontProductController::index()`'s own accepted pattern exactly (one
   `resolveGallery()` call per paginated row; no batched non-variant gallery method exists
   yet in `ProductMediaGalleryService` to call instead). Fixing it only for the new mobile
   path would create asymmetric behavior between the two boundaries; fixing it for both
   means extending the shared `ProductMediaGalleryService` authority — a real but separate
   unit of work, not a small local fix. **Not fixed here — recorded as backlog below**;
   replied on the PR thread with this evidence.

## Risks / remaining work

- None newly introduced beyond the two Codex findings recorded as backlog above (rate-limit
  budget sharing, list-endpoint gallery batching) — both are pre-existing architecture
  characteristics this task inherits from the already-shipped `/store/v1` pattern, not
  regressions.

## Discovered backlog

- **Dedicated rate-limit budget for media downloads** (Codex finding #2 above): both
  `/store/v1/media/{id}` and now `/commerce/v1/media/{id}` share their general read-rate
  budget with catalog browsing, so a full page of thumbnails can consume most or all of a
  client's per-minute allowance. Needs a deliberate policy decision (a new rate class and
  its number, or a different accounting for media byte-requests) — out of this task's
  reuse-only scope, and a cross-cutting change affecting both trust boundaries.
- **Batched gallery loading for list endpoints** (Codex finding #3 above): both
  `StorefrontProductController::index()` and (now) `CommerceProductController::index()`
  resolve each row's gallery with a separate query. A shared, batched
  `ProductMediaGalleryService` method (resolve base/shared media for a whole page of
  products in one or two queries, derive each thumbnail from that collection) would remove
  the N+1 for both boundaries at once. Left as backlog rather than fixed here to avoid
  widening this task into a `ProductMediaGalleryService` refactor affecting every existing
  consumer (POS, storefront, mobile).
- **`setup.sh` (local dev bootstrap) does not copy `app/Mail/` or `resources/views/`**
  into the generated Laravel project, unlike `.github/workflows/ci.yml` which copies both.
  This causes `AuthRecoveryTest`/`DocumentCenterSecureIntakeTest`-class failures in any
  fresh local sandbox built via `setup.sh`, even though real CI is unaffected. Evidence:
  `grep -n "Mail\|resources/views" .github/workflows/ci.yml setup.sh`. Suggested fix:
  add the two missing `cp -r` lines to `setup.sh` mirroring CI's own copy step. Not fixed
  here — unrelated to COM-MOBILE-MEDIA-1 and out of this PR's scope.
- **`DocumentCenterSecureIntakeTest::a_valid_pdf_is_counted...`** fails in this sandbox
  even after the `app/Mail`/`resources/views` sync, with "ملف PDF تالف أو غير مدعوم" —
  not investigated further (unrelated to Commerce/media; likely a further local-sandbox
  PDF-validation dependency gap, not reproduced as a repository/CI defect here).

## Git state

- Branch: `claude/autonomous-engineering-bootstrap-fo0mvj`
- PR: *(pending — opened immediately after this commit)*
- Base SHA: `c333836`
- Head SHA: *(pending)*

## Recommended next dependency-ready task

Per `docs/autonomous-engineering/TASK-QUEUE.md`'s candidate order, `COM-MOBILE-VARIANTS-1`
(Variant/options/UOM mobile contract) is next in dependency direction, but remains
`backlog` until re-validated against current `main` after this task's merge and post-merge
review pass (per the queue's own promotion checklist — not promoted here).
