# COM-MOBILE-VARIANTS-1 — Implementation Report

**Task:** Variant/options/UOM mobile contract for `/commerce/v1`
**Branch:** `claude/com-mobile-variants-1` · **Base:** `main` @ `c91f873`
**Date:** 2026-09-21
**STATUS:** review (pre-merge)

---

## Outcome

`GET /commerce/v1/products/{id}` for a variant-managed product now exposes `options`
(attribute/value definitions) and `variants` (id, sku, descriptor, option_value_ids, price,
in_stock, media) — the same contract shape `/store/v1` already ships — instead of the
previous deferred `is_variant_managed: true` with no selection data. A mobile client can
now select a concrete variant before calling the already-variant-aware
`POST /commerce/v1/cart/items` (`product_variant_id`).

`GET /commerce/v1/products` (list) is unchanged: still returns `is_variant_managed` only,
matching `/store/v1`'s own list/detail asymmetry (resolving every variant's price/stock for
a full paginated page has no listing benefit and would be real N+1).

## Repository evidence / root cause

- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §5 classified the variant gap as
  "Missing capability, not a bug to paper over," with the required contract: option/attribute
  definitions, valid combinations, UOM/unit selection, variant price, variant availability,
  media relationship, add-to-cart selection requirements.
- **The business logic side of this gap was already closed, not new**:
  `CommerceCartController::store()` already validates and forwards `product_variant_id` to
  `CommerceCartService::add()` — the exact same shared service `/store/v1` uses, already
  covered end-to-end (add/update/checkout/order-line-identity) by
  `StorefrontVariantCommerceTest`. `CommercePriceResolver::resolve()` and
  `AvailableToSellService::forWarehouse()` already accept an optional `$variantId`
  (VAR-COM-1). This task only had a **read-side** gap: `CommerceProductController` never
  surfaced what a client needs to construct that `product_variant_id` in the first place.
- `StorefrontProductController::show()` already implements and ships the exact target shape
  for `/store/v1` (options/variants payload, per-variant price/stock/media,
  `DocumentLineVariantResolver::descriptor()` for the human-readable label) — the pattern to
  mirror, not invent.
- `StorefrontProductResource` already declares optional `$options`/`$variants` constructor
  parameters (added by VAR-COM-1) with `null` defaults — `CommerceProductController` simply
  wasn't passing them yet.

## Approach chosen

1. **`CommerceProductController::variantResource()`** (new private method) — line-for-line
   mirror of `StorefrontProductController::show()`'s variant-managed branch: resolves each
   active variant's price (`CommercePriceResolver::resolve($id, $channelId, null, null,
   false, $variant->id)`), availability (`AvailableToSellService::forWarehouse($id,
   $warehouse->id, $variant->id)`), descriptor (`DocumentLineVariantResolver::descriptor()`),
   and per-variant media (`ProductMediaGalleryService::resolveGallery($product, $variant)` +
   `StorefrontProductResource::commerceMediaPayload()`, reusing COM-MOBILE-MEDIA-1's
   trust-boundary-specific URL builder). Only differences from the storefront original:
   `commerceMediaPayload()` instead of `mediaPayload($items, $tenantSlug)`, and no
   `tenantSlug` parameter (the mobile boundary never has one).
2. **`toResource()`** (existing shared helper) now branches to `variantResource()` only when
   `$detailed` is true (i.e. only from `show()`) — `index()`'s call site is unchanged
   (`$detailed = false`), preserving the exact deferred list-row behavior.
3. No changes to `CommerceCartController`, `CommerceCartService`, `CommercePriceResolver`,
   `AvailableToSellService`, or `DocumentLineVariantResolver` — none were needed; all were
   already variant-aware.

## Why this approach fits AWJ

- **Source-of-truth discipline:** zero new pricing/availability/variant-identity logic. The
  only new code is a read-only DTO-assembly method reusing four already-existing, already-
  variant-aware authorities plus the resource shape VAR-COM-1 already defined.
- **No cross-tenant/cross-product variant resolution risk:** unlike the cart/checkout path
  (which resolves a *client-supplied* variant id via `DocumentLineVariantResolver::resolve()`
  and must guard against a foreign/mismatched id), this read path only ever enumerates
  `$product->variants()` — the already-tenant-scoped, already-product-scoped relation of a
  product that passed the publication/tenant/channel gate. There is no client-supplied
  variant id to validate here at all, so this is structurally safer than the mutation path,
  not merely as safe.
- **List/detail asymmetry preserved deliberately**, matching `/store/v1`'s own accepted
  pattern — not a new inconsistency between the two trust boundaries.

## Changed files

- `app/Http/Controllers/Api/CommerceProductController.php` — adds `variantResource()`;
  `toResource()` branches to it for `$detailed` variant-managed products; updates the class
  docblock's now-stale "variants deferred for both list and detail" note.
- `tests/Feature/CommerceVariantApiTest.php` (new) — 7 focused tests (see below).
- `docs/autonomous-engineering/TASK-QUEUE.md` — promotes `COM-MOBILE-VARIANTS-1` from
  `backlog` to `ready` with the evidence above, recorded before implementation began.

No migration. No new model. No new business/pricing/availability authority. No change to
`CommerceCartController`/`CommerceCartService` (already variant-aware).

## Tests and exact results

### New — `tests/Feature/CommerceVariantApiTest.php` (7 tests / 28 assertions)

| Test | Proves |
|---|---|
| `a_published_variant_managed_product_exposes_its_active_variants_with_descriptor_and_price` | `options`/`variants` shape matches `/store/v1` (descriptor, per-variant price) |
| `a_simple_products_detail_has_null_options_and_variants` | Non-variant products unaffected (`options`/`variants` absent) |
| `an_inactive_variant_does_not_appear_among_purchasable_options` | Inactive variant excluded |
| `the_list_endpoint_keeps_the_deferred_row_with_no_variant_payload` | `index()` unchanged: `is_variant_managed` only, price 0, no `options`/`variants` keys |
| `a_variant_managed_product_unpublished_on_the_mobile_channel_is_not_shown` | Existing publication gate still applies |
| `a_foreign_tenants_variant_managed_product_is_not_shown` | Tenant isolation unaffected |
| `no_sensitive_internal_fields_leak_through_the_variant_payload` | No `avg_cost`/`purchase_price`/`quantity_on_hand`/`tenant_id` in variant JSON |

Run: `php artisan test --filter=CommerceVariantApiTest` → **7 passed (28 assertions)**, SQLite
and PostgreSQL.

### Regression

- `php artisan test --filter="CommerceVariantApiTest|CommerceCatalogApiTest|CommerceMediaApiTest|CommerceModuleBoundaryTest|StorefrontVariantCommerceTest"`
  → **53 passed (216 assertions)**, SQLite.
- `php artisan test --filter="Commerce|Storefront|ProductMedia|Variant"` on **SQLite** →
  **969 passed (4260 assertions)**, 30 skipped (PostgreSQL-only concurrency tests), 0
  failures.
- Same filter on **PostgreSQL** → **1001 passed (4477 assertions)**, 0 failures — full
  commerce/storefront/variant/media module regression green on the production database
  engine.

### Full suite

Not re-run in full for this task: the local sandbox's known, already-documented,
unrelated gaps (missing `bcmath` extension; `setup.sh` not copying `app/Mail`/
`resources/views`) were already fully characterized and isolated to `Fuel*`/
`AuthRecoveryTest`/`DocumentCenterSecureIntakeTest` in COM-MOBILE-MEDIA-1's implementation
report — none of which touch Commerce/Storefront/Product/Variant code, and this task's own
change surface (one controller, one new test file) has no relationship to fuel/mail/PDF
either. The module-scoped regression above (1001 tests on PostgreSQL, 999 on SQLite) is the
appropriate and sufficient verification; actual CI runs the complete suite on both engines
with the correct extensions/resources and will be inspected before merge.

## Build / lint / typecheck

No `web/` changes — Web CI not applicable.

## CI

Not yet observed on the exact final Head SHA — pending push/PR. Will be inspected before
Pre-Merge Review.

## Pre-merge review

- PRE_MERGE_REVIEW: *(recorded immediately before merge, on the exact final Head SHA)*
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
Smallest correct change: one new private method (~55 lines, line-for-line mirror of its
`/store/v1` sibling), one call-site branch, zero changes to any pricing/availability/cart
authority. No unrelated refactor.

### Reviewer
- Verified `toResource()`'s variant branch only triggers for `$detailed = true` (i.e. only
  `show()`), leaving `index()`'s call site (`$detailed = false`) untouched — confirmed by
  the passing `the_list_endpoint_keeps_the_deferred_row_with_no_variant_payload` test.
- Verified the per-variant N+1 query pattern (`resolve()`/`forWarehouse()`/
  `resolveGallery()` once per active variant) is the identical, already-accepted pattern in
  `StorefrontProductController::show()` — not a new characteristic, and bounded by a
  product's realistic variant count (one detail-screen view), not a paginated list.
- Verified `StorefrontProductResource` constructor positional arguments (9 params:
  product, price, currency, inStock, detailed, tenantSlug=null, galleryMedia, options,
  variants) match exactly.
- Verified no other call site of `CommerceProductController::toResource()`/`variantResource()`
  exists that could be affected.

### AWJ Guardian
- **No client-supplied variant id resolved here at all**: this read path only enumerates
  `$product->variants()` (the already-tenant/product-scoped Eloquent relation of a product
  that already passed the publication/tenant/channel gate) — structurally safer than the
  cart/price mutation paths, which do resolve a client-supplied variant id via
  `DocumentLineVariantResolver::resolve()` (reused unchanged, untouched by this task).
- **Tenant isolation:** unaffected — the product-level publication/tenant/channel gate runs
  identically before `variantResource()` is ever called. Tested (foreign-tenant negative).
- **No sensitive leakage:** tested — no cost/quantity/tenant-id fields in variant JSON.
- **Backward compatibility:** `index()` and non-variant `show()` unchanged (tests green);
  variant-managed `show()`'s new fields are strictly additive (previously absent, now
  populated).

### Researcher/Architect
Confirmed against `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §5's explicit
required outcome and against the already-accepted `/store/v1` implementation as the
reference pattern — no external research needed (a purely internal-authority-reuse task,
same shape as COM-MOBILE-MEDIA-1).

## Accounting impact

None. No financial operation, no journal entry, no change to any posting.

## Tenant / branch isolation impact

Tenant isolation preserved and tested. Branch isolation not applicable (unchanged from
COM-MOBILE-MEDIA-1's classification — `ProductVariant`/`ProductOption` are product-scoped,
not branch-scoped).

## Security / authorization impact

No new route, no new middleware, no new authentication/authorization primitive. Reuses the
existing `/commerce/v1` read-group chain unmodified.

## Backward compatibility

Fully additive. `index()` response shape unchanged; `show()`'s previously-absent
`options`/`variants` fields for variant-managed products are now populated.

## API / DB / migration impact

No new route, no migration, no schema change, no new model.

## External research used

None — purely internal source-of-truth reuse.

## Risks / remaining work

- None newly introduced. Inherits the same discovered backlog items as COM-MOBILE-MEDIA-1
  (rate-limit budget sharing; batched gallery loading for list endpoints) — this task does
  not touch the list endpoint's gallery resolution and adds no new rate-limit consumption
  pattern beyond what already existed.

## Discovered backlog

None new.

## Git state

- Branch: `claude/com-mobile-variants-1`
- PR: *(pending — opened immediately after this commit)*
- Base SHA: `c91f873`
- Head SHA: *(pending)*

## Recommended next dependency-ready task

`COM-MOBILE-AUTH-1` (Customer mobile auth + profile) is next in the queue's dependency
direction but is `critical` risk and explicitly gated on an "identity architecture
decision/readiness" — it must be freshly validated against current `main` evidence (and any
required Decision Escalation resolved) before promotion, not assumed ready here.
