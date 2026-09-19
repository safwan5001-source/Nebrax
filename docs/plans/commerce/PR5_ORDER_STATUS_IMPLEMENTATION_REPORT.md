# Commerce API V1 — PR-5 Standalone Order Status — Implementation Report

**PR:** #877 · **Branch:** `commerce-api-v1/pr5-order-status` · **Base:** `main` @ `5dd415f7` (PR #836 merge)
**Date:** 2026-09-19

---

## Repository Evidence

- **Architecture authority:** `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
  §3.2 ("CommerceOrder result/status") + §9.5 — `GET /commerce/v1/orders/{id}`, guest orders
  resolvable **only via a signed order reference returned at checkout completion**; response
  reuses `StorefrontCheckoutController::serializeOrder()`'s shape as its base.
- **Existing order serialization:** `serializeOrder()` exists as private copies in
  `StorefrontCheckoutController` (web `/store/v1`) and `CommerceCheckoutController` (mobile,
  PR-4) — identical shape, public-safe fields only.
- **Existing signed-reference primitives:** none for orders (verified by inspection — the only
  HMAC primitive in the codebase is `App\Support\WebhookSignature`, webhook-transport-specific,
  not reusable for per-resource ownership). PR-5 therefore adds the smallest standard primitive:
  stateless HMAC-SHA256 keyed by `config('app.key')` — the same key material class Laravel itself
  uses for its signed URLs/encrypter. No new dependency, no custom crypto, no reversible-encoding
  "signature", no DB secret storage.
- **Existing middleware/trust boundary:** the `/commerce/v1` read group already runs
  `AuthenticateApiClient` → `PublicApiTenantGuard` → `ResolveCommerceChannel` →
  `PublicApiRequestAudit` → `EnforcePublicApiRateLimit:read` → `EnsureActiveSubscription`.
  The new endpoint sits in exactly this group, unmodified.

## Implemented Contract

- **Endpoint:** `GET /commerce/v1/orders/{id}` (`whereUuid('id')`), route name
  `commerce.v1.orders.show`, controller `App\Http\Controllers\Api\CommerceOrderController@show`.
- **Request ownership proof:** header `X-Order-Reference: v1.{64-hex HMAC}` — issued only inside
  the `POST /commerce/v1/checkout/complete` response (new additive field `order_reference`).
- **Response shape:** `data.order` = exact `serializeOrder()` shape
  (`id, number, status, delivery_method, total{amount_minor,currency}, contact{...},
  delivery{...}, items[{product_id, product_name, unit_name, quantity, unit_price, line_total}],
  created_at`), served via the new shared `App\Support\CommerceOrderSerializer`.
- **Error behavior:** every ownership failure → the same `PublicApiResponse::error` envelope with
  `PublicApiErrorCode::NOT_FOUND` (404, "الطلب غير متاح.") — no new error code, no distinction
  between "missing reference", "bad signature", "foreign order", "nonexistent id".

## Security Model

- **Construction/verification:** `HMAC-SHA256` over `v1|{tenant_id}|{sales_channel_id}|{order_id}`,
  key = application key (`base64:`-decoded when prefixed). Comparison via `hash_equals`.
  Strict format gate (`v1.` prefix + 64 lowercase hex) before comparison.
- **Tenant binding:** the controller's lookup is scoped `where tenant_id = TenantContext::id()`
  (set by `AuthenticateApiClient` from the ApiClient's own row — never client-supplied) **and**
  the HMAC input contains the order's `tenant_id`. Double binding, fail-closed both ways.
- **SalesChannel/context binding:** lookup additionally scoped
  `where sales_channel_id = StorefrontContext::salesChannelId()` (the resolved active *mobile*
  channel from `ResolveCommerceChannel`) and the HMAC input contains the order's
  `sales_channel_id`. A web-channel order is unreachable from this endpoint (tested).
- **Tamper resistance:** any modified bit fails HMAC (tested: flipped-char signature rejected).
- **Enumeration protection:** identical 404 envelope for every failure mode (tested: cross-tenant
  access returns the byte-identical `error` object as a nonexistent-id request); order ids are
  UUIDs but are explicitly **not** relied upon as a security boundary (tested: bare UUID without
  reference rejected; valid reference for order A rejected on order B).
- **Logging/audit safety:** the reference travels in the `X-Order-Reference` **header**, never in
  the query string. `PublicApiRequestAudit` audits only its `SAFE_QUERY_KEYS` allow-list
  (`page, per_page, sort, type, status`) and no headers — the reference cannot leak into audit
  logs by construction.
- **ApiClient token is store context, not ownership:** an attacker holding only a valid store
  token cannot read any order without its per-order signed reference (tested across the suite).

## Checkout Completion Integration

- `POST /commerce/v1/checkout/complete` response gains **`order_reference`** alongside the
  existing `order` and `replayed` fields — purely additive; no field renamed or removed.
- **Replay semantics:** the reference is a deterministic function of the order row, so an
  idempotent replay of completion returns the byte-identical `order_reference` for the same order
  (tested). No new ownership identity can ever be minted by replay.
- Completion idempotency, Cart consumed lifecycle, and `CommerceOrder` creation semantics are
  untouched — `CommerceCheckoutService` is not modified at all.

## Changed Files

| File | Change |
|---|---|
| `app/Support/CommerceOrderReference.php` | **new** — issue/verify signed guest-order reference |
| `app/Support/CommerceOrderSerializer.php` | **new** — shared public order serialization (exact approved shape) |
| `app/Http/Controllers/Api/CommerceOrderController.php` | **new** — `GET /commerce/v1/orders/{id}` |
| `app/Http/Controllers/Api/CommerceCheckoutController.php` | additive `order_reference` in complete response |
| `routes/api_commerce.php` | one read-group route + import + comment |
| `tests/Feature/CommerceOrderStatusApiTest.php` | **new** — 14 tests |
| `tests/Feature/CommerceModuleBoundaryTest.php` | allow-list += `commerce/v1/orders/{id}` |
| `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md` | §9.5 marked implemented |

## Schema / Migrations

**NONE.** The signed reference is stateless (pure function of the order row + app key) — no
persistence required, `CommerceOrder` schema untouched.

## Tests

New suite `CommerceOrderStatusApiTest` (14 tests): happy path, exact serialization parity with
checkout-complete response, sensitive-field leak guard, missing/malformed/tampered/wrong-order
reference, bare-UUID insufficiency, random-UUID rejection, cross-tenant with identical error
envelope, web-channel order unreachable from mobile endpoint, completion replay preserving
order+reference, reference determinism, no accounting/payment/inventory side effects, no
order/checkout/cart mutation.

Local results (exact CI assembly replica — Laravel 11 app + core copy per `.github/workflows/ci.yml`,
PHP 8.4.25; local PostgreSQL 15 vs CI's 16 — concurrency semantics identical):

- **SQLite:** PR-5 suite 14/14 passed (133 assertions); full targeted regression
  (CommerceCheckoutApiTest, CommerceCartApiTest, CommerceCartOneShotLifecycleTest,
  CommerceCartConsumedStatusMigrationTest, StorefrontCheckoutApiTest,
  StorefrontCheckoutCompletionApiTest, CommerceModuleBoundaryTest, CommerceApiFoundationTest,
  MobileSalesChannelResolverTest, StorefrontCartApiTest, StorefrontCatalogApiTest,
  PublicApiAuthTest, SalesChannelTest): **181 passed, 1 skipped** (PG-only), 930 assertions.
- **PostgreSQL:** PR-5 suite + all of the above + the three existing PG concurrency suites
  (StorefrontCheckoutPostgresConcurrencyTest,
  StorefrontCheckoutCompletionPostgresConcurrencyTest, StorefrontCartPostgresConcurrencyTest):
  **170 passed**, 954 assertions.
- No new concurrency behavior was introduced (read-only endpoint), so no new concurrency test was
  invented; existing PG concurrency coverage is unchanged and green.

## Accounting / Payment / Inventory Safety

The endpoint performs a single read query + serialization. Dedicated tests assert
`journal_entries` / `journal_lines` / `stock_movements` remain empty and order/checkout/cart rows
are byte-identical after repeated fetches. The completion path's side-effect profile is unchanged
(PR-4's own no-side-effects tests still green).

## Tenant Isolation

Unchanged and extended: order lookup is hard-scoped to the authenticated tenant + resolved mobile
channel; the signature independently binds both. Cross-tenant and cross-channel access are
indistinguishable from nonexistence (tested).

## Backward Compatibility

- `/store/v1` untouched (zero changes).
- `/commerce/v1` completion response: one additive field only; all PR-4 tests green unmodified.
- No signature/behavior change in any shared service.

## CI

- **Head SHA:** `844a782b57d92d569c45427b590d584b45b9460c`
- Run `35436596629` (push, final head): **sqlite ✅ SUCCESS · pgsql ✅ SUCCESS**
- Run `35436568915` (push, code-identical prior commit): **sqlite ✅ SUCCESS · pgsql ✅ SUCCESS**
- Web build / Storefront checks: not triggered (paths-filtered; this PR touches no `web/**` or
  `storefront/**` files).

## Deferred / Out of Scope

- Order History list (`GET /commerce/v1/orders`) — not built.
- Customer Platform order ownership/history (authenticated `customer_identity_id` path) — later phase (§3.4).
- Payments, Fulfillment, Invoice/ZATCA — untouched.
- PR #836 deferred P2: variant identity in completed-order items (order lines carry no
  `product_variant_id` here either — same as the existing serializer contract), and
  contact/delivery completeness.

## Risks / Remaining

- The reference's lifetime is the app's key lifetime: rotating `APP_KEY` invalidates outstanding
  references (same blast radius as Laravel's own signed URLs — acceptable, worth documenting to
  ops).
- Local PG verification used PG 15 (sandbox limit); CI's PG 16 run is green, closing the gap.

## Git State

- Branch: `commerce-api-v1/pr5-order-status`
- PR: #877
- Base SHA: `5dd415f7358137cac3e030b21ca7b629c15815c0`
- Head SHA: `844a782b57d92d569c45427b590d584b45b9460c`
- Latest main SHA: `5dd415f7358137cac3e030b21ca7b629c15815c0`
- ahead/behind vs main: 4 / 0

## Next Step

**READY FOR OWNER REVIEW**

No merge, no deploy, no release performed.
