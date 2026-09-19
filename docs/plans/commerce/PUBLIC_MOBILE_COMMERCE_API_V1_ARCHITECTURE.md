# Public/Mobile Commerce API V1 — Architecture & Contract Pass

> **Scope of this document:** architecture and contract design only. No implementation, no
> migrations. Written after PR #811 merged to `main` (Storefront Checkout Wiring).
>
> Branch: `commerce-api-v1/architecture-contract` · Base: `main` @ `40152c8` (PR #811 merge commit).

---

## 1. Repository evidence

Evidence gathered by direct inspection of the merged `main` (no assumptions, no re-derivation
from scratch — this section is a map of what already exists, with file references).

### 1.1 Three independent API layers already exist

| Layer | Prefix | Provider | Auth | Audience today |
|---|---|---|---|---|
| Internal API | `/api` | (default) | Sanctum session + RBAC (`EnsurePermission`) | Internal web app (`web/`), staff |
| Public M2M API | `/api/v1` | `PublicApiServiceProvider` | `ApiClient` bearer key | Third-party integrations |
| Storefront API | `/store/v1` | `StorefrontApiServiceProvider` (`routes/api_storefront.php`) | Anonymous + gateway secret for writes | Current web storefront (`storefront/`) only |
| Customer Platform | `/customer/v1/{tenantSlug}` | (default, `routes/api.php`) | Sanctum token, slug-resolved tenant | Authenticated end-customers (nascent) |

`PublicApiResponse` / `PublicApiErrorCode` / `PublicApiController` (`app/Support/PublicApiResponse.php`,
`app/Support/PublicApiErrorCode.php`, `app/Http/Controllers/Api/PublicApiController.php`) are
**shared** between `/api/v1` and `/store/v1` today: one envelope, one error-code enum with HTTP
status mapping, one pagination/sort/search-escaping convention. This is the strongest existing
asset for a new V1 contract — it does not need to be reinvented.

### 1.2 `/store/v1/*` route inventory (`routes/api_storefront.php`)

Trusted (production) group, resolved by `ResolveStorefrontDomain` (host-based):

- `GET categories`, `GET categories/{id}`
- `GET products`, `GET products/{id}`
- `GET media/{id}`
- `GET storefront` (identity/config)
- `GET cart`, and behind `RequireStorefrontMutationGateway`: `POST cart/items`,
  `PATCH cart/items/{item}`, `DELETE cart/items/{item}`
- `GET checkout`, and behind `RequireStorefrontMutationGateway`: `POST checkout`,
  `PATCH checkout/contact`, `PATCH checkout/address`, `PATCH checkout/delivery`,
  `POST checkout/complete`

A second, `{tenantSlug}`-prefixed **legacy/dev-only** group duplicates the read endpoints,
resolved by `ResolveStorefrontTenant`, which **hard-aborts in `app()->environment('production')`**
and is documented in its own docblock as retained only for local dev/tests without real DNS.

### 1.3 Two competing tenant/storefront resolution philosophies

- **Host-based (production authority):** `ResolveStorefrontDomain` resolves
  `StorefrontDomain → Storefront → SalesChannel(type=web)` from the request `Host` header, sets
  `TenantContext` + `BranchContext` + `StorefrontContext`. Mutation routes additionally require
  `X-Storefront-Gateway-Secret` + `X-Storefront-Forwarded-Host`, checked with `hash_equals()`
  against `config('storefront.gateway_secret')` — a secret known only to the Next.js storefront
  server and Laravel, **never sent to the browser**.
- **Slug-based:** `ResolveCustomerTenant` (used by `/customer/v1/{tenantSlug}`) resolves `Tenant`
  directly from a URL slug, no host dependency, no gateway secret, paired with Sanctum bearer
  auth and `EstablishCustomerContext` (cross-checks the authenticated user's tenant against the
  URL slug, optionally resolves a linked `Partner`).

### 1.4 `Storefront` is architecturally web-only today

`Storefront::booted()` (`app/Models/Storefront.php`) throws
`RuntimeException('يجب أن تكون قناة البيع من نوع ويب لربطها بمتجر.')` if the linked
`SalesChannel.type !== SalesChannel::TYPE_WEB`. This is a **hard model-level constraint**, not
convention. `CommerceProductPublicationService::webStorefronts()` likewise only queries
`Storefront` rows tied to a `type=web` channel to decide publication visibility.

### 1.5 `SalesChannel::TYPE_MOBILE` already exists in the schema — and is completely unwired

`app/Models/SalesChannel.php` declares `TYPE_WEB`, `TYPE_MOBILE`, `TYPE_POS` constants, and the
migration (`2026_09_13_010000_create_sales_channels_table.php`) enumerates
`['web', 'mobile', 'pos', 'external']` at the database level. However, a full-repository grep for
`SalesChannel::TYPE_MOBILE` usage found **zero** call sites: no `Storefront` can be created for
it (§1.4), `CommerceProductPublicationService` does not check it, `ResolveStorefrontDomain` and
`ResolveStorefrontTenant` only ever query `type=web`, and `CommercePriceResolver` takes a
`$salesChannelId` but nothing in the existing code path ever supplies a mobile channel's ID. The
schema anticipated a mobile channel; nothing downstream was built for it. This is the central
factual finding this document is written around — see §3, §5, §10.

### 1.6 Product variants are unexposed end-to-end on the storefront surface

Variants (`VAR-CORE-1`/`VAR-PRICE-1`/`VAR-INV-1`/`VAR-MEDIA-1`/`VAR-DOC-1`) are merged to `main`
but confirmed absent from every storefront-facing layer inspected:
- `StorefrontProductResource` (`app/Http/Resources/StorefrontProductResource.php`) — exact public
  field allow-list, no variant fields.
- `CommercePriceResolver::resolve(string $productId, string $salesChannelId, ?string $partnerId, ?string $unitName, bool $lockEligibility)`
  — no variant parameter anywhere in the signature.
- `StorefrontCheckoutController::serializeOrder()` — order lines carry no `product_variant_id`.

### 1.7 Guest identity today

`CommerceCartService::COOKIE_NAME` = `awj_cart_token`, HttpOnly, `SameSite=Lax`, 30-day lifetime,
raw token hashed (`sha256` → `token_hash`) server-side, scoped by `storefront_id` +
`sales_channel_id` taken from the server-resolved `StorefrontContext` (never client-supplied).
Checkout **reuses the same cookie** — there is no separate checkout-session cookie.

### 1.8 Idempotency and rate limiting already have reusable primitives

- `PublicApiIdempotency` (`app/Support/PublicApiIdempotency.php`) is a **pure** helper: key
  validation (`8–255` URL-safe chars), `hashKey()` (sha256, raw key never stored), canonical
  request `fingerprint()` (method + path + sorted query + canonicalized body). State (claim /
  in-progress lease / completion / replay) lives in a separate enforcement layer keyed by
  `api_client_id` for the M2M API; storefront checkout instead keeps idempotency state directly
  on the `CommerceCheckout` row, because that table is structurally bound to an `ApiClient`.
- `PublicApiRateLimits` / `EnforcePublicApiRateLimit`: per-`ApiClient` when authenticated, else
  per-hashed-IP. Classes: `read=100/min`, `write=30/min`, `sensitive=10/min`, `unauth=30/min`.
  Documented as effectively-global only because of the current single-instance deployment + file
  cache; will need a shared store (Redis/DB) once horizontally scaled — already an acknowledged,
  explicitly out-of-scope gap in the code that introduced it, not new information.

### 1.9 `CommerceOrder` semantics

`CommerceOrder` (`app/Models/CommerceOrder.php`) is the unified order entity
(ADR-01/ADR-03 — "unify/migrate", see `AWJ_COMMERCE_ORDER_IDENTITY_DECISION_REPORT.md`).
Explicitly **not** an `Invoice`: no accounting/inventory/payment effect at creation or
confirmation. `status` currently has exactly one dimension (`draft`/`confirmed`) — payment and
fulfillment status are explicitly not yet modeled and must not be compressed into this column.
`customer_identity_id` is sourced only from `CustomerContext`; always `null` for guests, never
client-settable.

---

## 2. Current API inventory (delta view)

This is not a re-listing of the full route table — it is what matters for the V1 decision.

| Concern | Current home | Client-trust model | Mobile-usable as-is? |
|---|---|---|---|
| Store identity/config | `GET /store/v1/storefront` | Host → `Storefront` | No (host resolution assumes a browser+DNS+reverse-proxy chain the storefront gateway owns) |
| Categories | `GET /store/v1/categories[/…]` | Host | Read-only, close to reusable |
| Products (list/detail) | `GET /store/v1/products[/…]` | Host | Read-only, close to reusable, but missing variants (§1.6) |
| Media | `GET /store/v1/media/{id}` | Host | Close to reusable |
| Cart read | `GET /store/v1/cart` | Host + guest cookie | Cookie model unusable for a native app |
| Cart write | `POST/PATCH/DELETE /store/v1/cart/items` | Host + **gateway secret** | **No** — hard-blocked by design (§1.4-adjacent, `RequireStorefrontMutationGateway`) |
| Checkout | `/store/v1/checkout*` | Host + **gateway secret** + guest cookie | **No**, same reason |
| Order result | `serializeOrder()` inside checkout response | — | Contract exists but is checkout-response-shaped, not a standalone order-status endpoint |
| Authenticated identity | `/customer/v1/{tenantSlug}/*` | Sanctum bearer + slug | Proven mobile-suitable pattern, but currently a separate, narrower surface (auth only) |

**Conclusion of this section:** the read-only catalog/config surface of `/store/v1` is close to
directly reusable; the identity-resolution layer beneath it (host) and the entire mutation
surface (gateway secret) are not. This finding drives §4 and §5.

---

## 3. Proposed V1 contract — decision and endpoints

### 3.1 The `/store/v1` vs. separate-Public-API question — explicit answer

**Decision: introduce a new, separate route surface, `/commerce/v1/*`, sharing infrastructure
with `/store/v1` rather than extending `/store/v1` in place.**

Reasoning, weighed against the evidence in §1 and §2, not assumed in advance:

- **Reuse, don't fork, the shared layer.** `PublicApiResponse`/`PublicApiErrorCode`/
  `PublicApiController`, `CommercePriceResolver`, `CommerceCartService`, `CommerceCheckoutService`,
  `CommerceListing`-based publication gating, `PublicApiIdempotency`, `PublicApiRateLimits` are
  **all reused as-is** — nothing here is duplicated business logic (satisfies the "no duplication"
  constraint). Controllers for `/commerce/v1` call the same services `/store/v1` controllers call.
- **Do not extend `/store/v1` in place**, because two of its foundational, non-negotiable
  properties are structurally web-only and must not be weakened to accommodate mobile:
  1. `ResolveStorefrontDomain` is Host-header-driven. A native app has no meaningful "Host" the
     way a browser hitting the storefront's own domain does; forcing mobile through this
     middleware means either spoofable client-supplied host hints or an artificial fixed host,
     both worse than a purpose-built resolver.
  2. `RequireStorefrontMutationGateway` exists specifically so that only the storefront's own
     Next.js server (which holds the secret) can write. This is the exact mechanism the task
     explicitly forbids the mobile app from depending on. Loosening it for mobile removes the
     protection for the web storefront too — a shared gate with two trust levels is a bug waiting
     to happen, not an architecture.
  3. `Storefront::booted()` **hard-rejects** any non-`web` `SalesChannel` (§1.4). Since
     `SalesChannel::TYPE_MOBILE` already exists but has no `Storefront` counterpart, "mobile" is
     not a variant of "storefront" in this schema — it is a sibling concept. Routing mobile
     through `/store/v1` would mean either abusing the `web` channel for mobile traffic (breaks
     publication/pricing channel semantics, §1.5) or silently patching the `Storefront` model's
     invariant, which is out of scope for a docs-only pass and risky for a hard constraint that
     exists for a reason not yet documented here.
- **A new prefix costs little and buys a clean trust boundary.** `/commerce/v1/*` gets its own
  service provider (`CommerceApiServiceProvider`, mirrors `StorefrontApiServiceProvider`), its
  own middleware chain (§4/§5), while its controllers are thin adapters over the same services
  `/store/v1` already uses. This is explicitly the smallest change that satisfies "must not depend
  on web-gateway-only secrets" without touching `/store/v1`'s existing guarantees — i.e.
  **backward compatibility is by construction, not by careful editing** (§8).
- **`/api/v1` (M2M) is not the right home either** — that surface is `ApiClient`-bearer-key
  authenticated, meant for server-to-server integrations with a provisioned API client per
  integration, not for a store's own first-party mobile app talking on behalf of a browsing
  end-user session.

So: **`/store/v1` remains exactly as-is** (zero changes — it is the current web storefront's
contract and stays that way, §8). **A new `/commerce/v1/*` is the Public/Mobile Commerce API V1**,
built for: the current web storefront (optionally, migrating onto it later — not required now),
a standalone mobile app, and future Awj client apps.

### 3.2 Endpoint groups (contract shape, not implementation)

All under `/commerce/v1/*`. All read endpoints anonymous-accessible (subject to rate limiting);
all mutation endpoints require the mobile session token described in §4.

**Store identity + configuration**
- `GET /commerce/v1/storefront` — tenant/store display name, default locale, currency, supported
  languages. Mirrors `StorefrontConfigController::show()`'s shape (`{name, default_locale}`),
  extended only if a real mobile need surfaces (e.g. currency, supported locales list) — no
  speculative fields.

**Categories/catalog**
- `GET /commerce/v1/categories` — tree listing (reuse category service as-is).
- `GET /commerce/v1/categories/{id}` — detail + ancestor chain.

**Products + variants + media**
- `GET /commerce/v1/products` — list, filterable/sortable (§3.3), gated by `CommerceListing`
  publication (`is_active=true` + `is_published=true` for the resolved channel).
- `GET /commerce/v1/products/{id}` — detail.
- `GET /commerce/v1/media/{id}` — unchanged from `/store/v1` shape.
- **Variants are an explicit open item, not a silent omission** (per §1.6): this contract defines
  the *slot* for variant data (`variants: [{id, sku, attributes, is_active}]` on product detail,
  and `product_variant_id` accepted on cart-item write / echoed on cart/order lines) but marks it
  **not implementable in the first PR slice** until `CommercePriceResolver` and
  `CommerceListing`/publication gating gain variant-awareness — those are prerequisite,
  independent pieces of work, not something this API layer should quietly work around. See §9, §10.

**Search/filter/sort/pagination**
- Reuses `PublicApiController`'s existing pagination (`page`/`per_page`), sorting, and
  search-escaping helpers verbatim — no new convention.
- Filter parameters: `category_id`, `q` (search), `min_price`/`max_price` (evaluated against
  server-resolved price, never client-asserted), `in_stock` (boolean, derived from
  `CommerceListing`+stock policy — no direct stock number exposed as a filter input).

**Server-authoritative pricing**
- Every product/list/detail/cart/checkout response carries prices computed at response time via
  `CommercePriceResolver::resolve()` for the resolved `sales_channel_id` — **never** a client-sent
  price, and never a cached price treated as truth beyond the response that served it.
- Because `CommercePriceResolver` has no variant parameter today (§1.6), variant-level pricing is
  part of the same open item as variant catalog exposure — not resolved differently by this API.

**Cart**
- `GET /commerce/v1/cart`
- `POST /commerce/v1/cart/items`, `PATCH /commerce/v1/cart/items/{item}`,
  `DELETE /commerce/v1/cart/items/{item}`
- Reuses `CommerceCartService` in full. Identity boundary differs from web (§3.3/§4/§5): instead
  of an HttpOnly cookie, the mobile session token itself (or a server-issued opaque guest-cart
  reference bound to that token) scopes the cart — no behavior in `CommerceCartService` needs to
  change, only how the caller is identified before reaching it.

**Checkout**
- `GET /commerce/v1/checkout`, `POST /commerce/v1/checkout`,
  `PATCH /commerce/v1/checkout/{contact,address,delivery}`, `POST /commerce/v1/checkout/complete`
- Reuses checkout services in full (no Payments per the mandatory constraint — checkout completion
  semantics stay exactly what they are today: order creation, not payment capture).
- Idempotency: `Idempotency-Key` header required on `POST checkout/complete` only, using
  `PublicApiIdempotency`'s pure helpers, with state kept on `CommerceCheckout` — same pattern
  `/store/v1` already uses, not a new mechanism (§6). `POST checkout` carries no
  `Idempotency-Key` of its own — it is naturally idempotent (resume-if-open) via
  `CommerceCheckoutService::createOrResume()`, and duplicate-order safety is a Cart-lifecycle
  invariant, not a `POST checkout` idempotency mechanism: one `CommerceCart` backs at most one
  successful `CommerceOrder` (`CommerceCart::STATUS_CONSUMED`, set in the same transaction that
  completes the Checkout), so a repeat `POST checkout` on an already-purchased cart 404s — the
  cart itself is no longer usable, never a second Checkout row to resume.

**CommerceOrder result/status**
- `GET /commerce/v1/orders/{id}` — **new**, standalone endpoint (does not exist in `/store/v1`
  today, where the order is only ever seen embedded in the checkout-complete response). Needed
  because a mobile app's "order confirmation" / "order history" screens must be able to fetch
  order state independently of the checkout flow that created it (e.g. after app restart, push
  notification deep link). Ownership check: guest orders resolvable only via a signed order
  reference returned at checkout completion (never a bare sequential ID guessable by another
  guest); authenticated-customer orders resolvable via `customer_identity_id` match once/if
  Customer Platform is adopted for this surface (§3.4).
- Response reuses `StorefrontCheckoutController::serializeOrder()`'s shape as its base.

**Guest session/identity boundary**
- See §4 and §5 in full — this is one of the two central design questions of this document.

### 3.3 What is explicitly excluded from V1 (per mandatory constraints)

- No payment endpoints of any kind (no capture, no payment-method listing tied to a gateway).
- No invoice/ZATCA fields on any response.
- No stock-movement, reservation, or journal data exposed.
- No customer-account endpoints (registration/login/profile/order-history-by-account) unless
  §3.4 below is triggered — this is deliberate, not an oversight.

### 3.4 Where Customer Platform adoption is/isn't triggered

Per the constraint "no Customer Platform adoption unless an endpoint genuinely needs a clear
boundary — document as later phase otherwise": the only endpoint in this contract that has any
plausible need is `GET /commerce/v1/orders/{id}` for a *returning, identified* customer wanting
order history across sessions/devices. V1 as designed here satisfies the guest case entirely
without Customer Platform (signed order reference, §3.2). Authenticated order history, saved
addresses, and repeat-customer pricing eligibility are explicitly deferred to a **later phase**
that would adopt `/customer/v1`'s Sanctum pattern for `/commerce/v1` mutation routes as an
additional, optional auth mode — not built now.

---

## 4. Web vs Mobile trust/auth model

| | Web (`/store/v1`, unchanged) | Mobile (`/commerce/v1`, new) |
|---|---|---|
| Tenant/channel resolution | Host header → `StorefrontDomain` → `Storefront` → `SalesChannel(web)` | Explicit, server-issued **store token** bound to `(tenant_id, sales_channel_id=mobile)` at app-install/first-launch time (§5) — never a client-guessed slug or ID trusted at face value on every request |
| Mutation gate | `X-Storefront-Gateway-Secret` (server-to-server secret, never reaches browser) | **None of this kind.** Replaced by the store token above plus standard per-request auth below — satisfies "must not depend on web-gateway-only secrets" by construction, not by exception |
| Guest identity | HttpOnly `SameSite=Lax` cookie (`awj_cart_token`) | No cookies (native apps do not reliably carry cookie jars across contexts the way a browser does). A server-issued **opaque guest token** (bearer, long-lived, revocable), analogous in purpose to `awj_cart_token` but transport-appropriate for mobile: same hashing-at-rest (`sha256` → stored hash, raw never stored) and scoping (`storefront`-equivalent `+ sales_channel_id`) as `CommerceCartService` already does for web — **no change to `CommerceCartService` itself**, only to how the token reaches it |
| Authenticated identity (later phase, §3.4) | N/A today | Sanctum bearer token, reusing `/customer/v1`'s proven pattern (`ResolveCustomerTenant`-equivalent + `EstablishCustomerContext`-equivalent), added as an *additional* accepted credential on the same `/commerce/v1` routes — not a second API |
| Rate limiting | `EnforcePublicApiRateLimit`, per-hashed-IP for anonymous | Same middleware, same classes; per-store-token where available (more precise than per-IP for a mobile client, avoids NAT-shared-IP false positives), else per-hashed-IP |

Nothing here is a new invention beyond the two token types (store token, guest token) — both are
narrow, purpose-built variants of patterns already proven in this codebase (`StorefrontContext`
resolution and `awj_cart_token`, respectively), not a new trust primitive.

---

## 5. Tenant/storefront resolution

**New middleware, `ResolveCommerceChannel`** (name illustrative — implementation detail for the
first PR), analogous in role to `ResolveStorefrontDomain` but built for a non-host client:

1. Client sends a store token (issued out-of-band — see open decision in §10 on exact issuance:
   app-config bundled per tenant at build/config time is the leading candidate, since a mobile
   app is already tenant-specific by nature of being "the Awj client's app," not a shared
   multi-tenant browser session).
2. Middleware resolves the token server-side to `(tenant_id, sales_channel_id)` — **the client
   never supplies tenant/channel IDs directly**, satisfying the "never trust client-supplied
   tenant/storefront/channel IDs" constraint the same way `ResolveStorefrontDomain` never trusts a
   client-supplied host claim (it resolves from infrastructure state, here from a server-issued,
   server-validated token instead of a header).
3. Sets `TenantContext` + `BranchContext` + a `StorefrontContext`-equivalent (or a documented
   reuse of `StorefrontContext` itself if its shape fits — implementation detail, §9) scoped to
   `sales_channel_id` pointing at a `SalesChannel(type=mobile)` row.
4. **Fail-closed**: any resolution failure (unknown/revoked token, inactive tenant, no active
   mobile channel provisioned) is a non-revealing 404/401, mirroring `ResolveStorefrontDomain`'s
   and `ResolveStorefrontTenant`'s existing behavior — no distinction leaked between "bad token"
   and "tenant has no mobile channel yet."
5. **Prerequisite this exposes, not hidden**: because `Storefront` hard-rejects non-`web`
   channels (§1.4) and `CommerceProductPublicationService` only ever queries `web` storefronts
   (§1.4), a `SalesChannel(type=mobile)` row alone is not sufficient today for publication gating
   to work correctly. This is called out explicitly as a blocking dependency in §9/§10, not
   worked around inside this API layer (this document does not propose weakening `Storefront`'s
   invariant or duplicating publication logic — both would violate the "no duplicated business
   logic" constraint).

---

## 6. Request/response/error conventions

**Reused verbatim, zero new envelope design:**

- Success/error envelope: `PublicApiResponse` (already shared by `/api/v1` and `/store/v1`).
- Error codes: `PublicApiErrorCode` enum + its existing HTTP-status mapping — any new
  mobile-specific failure mode (e.g. "store token invalid") is added as a **new enum case**, not a
  parallel error shape.
- Pagination/sorting/search-escaping: `PublicApiController` helpers, called identically from
  `/commerce/v1` controllers.
- Versioning: the `v1` path segment is the version, matching the existing convention on both
  `/api/v1` and `/store/v1` — no header-based versioning scheme introduced.
- Idempotency: `Idempotency-Key` header + `PublicApiIdempotency` pure helpers on all
  cart/checkout mutation routes, mirroring `/store/v1` checkout's existing use, state kept on the
  owning row (`CommerceCart`/`CommerceCheckout`) as it already is — not the `ApiClient`-bound
  idempotency table, for the same structural reason `/store/v1` doesn't use it either.

---

## 7. Security / Tenant Isolation requirements

- **Fail-closed tenant resolution** (§5.4) — no code path may proceed with a request whose
  tenant could not be positively resolved server-side.
- **No client-supplied tenant/channel/storefront IDs ever trusted** — every ID used to scope a
  query is either derived from the resolved token/context or is an application-owned record ID
  (e.g. `cart_item_id`) whose ownership is independently checked against the resolved tenant/cart,
  matching `PublicApiController`'s existing domain-ownership-check helper pattern.
- **`TenantScope` applies unconditionally** — `/commerce/v1` controllers must not bypass it; this
  is inherited for free by continuing to resolve `TenantContext` through the same singleton
  (`TenancyServiceProvider`) every other layer uses.
- **Rate limiting** per §4's table — read/write/sensitive classes reused from
  `PublicApiRateLimits`, with the same acknowledged single-instance-deployment caveat already
  documented in that class (not a new gap introduced by this API).
- **Store-token and guest-token secrecy**: both are bearer credentials; transport requires TLS
  (already mandatory in production), and neither is logged in plaintext — mirrors how
  `awj_cart_token`'s raw value is never persisted, only its hash.
- **No web-gateway-secret dependency** — by construction (§3.1, §4), `/commerce/v1` never checks
  `X-Storefront-Gateway-Secret`; this satisfies the explicit constraint without a "mobile bypass
  flag" on the existing middleware (which would have been the wrong shape — a bypass is a standing
  weakening of the web guarantee, a separate route surface is not).

---

## 8. Compatibility strategy

- **`/store/v1/*` is untouched.** Zero route, controller, middleware, or service-signature changes
  proposed here. The current web storefront (`storefront/src/lib/commerce/*` client) keeps working
  exactly as today, with no coordinated deploy required between this work and the storefront app.
- **Shared services gain no breaking signature changes** in this pass — `CommercePriceResolver`,
  `CommerceCartService`, checkout services are called by the new controllers with their existing
  signatures. Any future variant-awareness change to `CommercePriceResolver` (§1.6/§9) is a
  separate, independently-reviewable change that both `/store/v1` and `/commerce/v1` would need to
  adopt together — not something this pass forces.
- **`/store/v1`'s legacy `{tenantSlug}` dev-only group stays as-is** — irrelevant to this decision,
  already production-disabled by its own defensive check.
- **Future consolidation is optional, not required**: if the web storefront later migrates onto
  `/commerce/v1` (e.g. to gain the standalone order-status endpoint), that is a follow-on decision
  made with its own evidence at that time — this document does not commit to it now, per the
  instruction not to assume outcomes in advance.

---

## 9. Implementation slices / PR sequence (smallest possible scope per PR)

1. **PR-1 — Skeleton + identity/config only.** `CommerceApiServiceProvider`, `routes/api_commerce.php`,
   `ResolveCommerceChannel` middleware (store-token resolution, fail-closed, §5), and a single
   endpoint: `GET /commerce/v1/storefront`. No cart, no checkout, no catalog yet — proves the
   trust boundary (§4/§5/§7) end-to-end on the smallest possible surface, reviewable in isolation.
2. **PR-2 — Read-only catalog.** `GET categories[/…]`, `GET products[/…]`, `GET media/{id}`,
   search/filter/sort/pagination — thin adapters reusing existing catalog/publication/pricing
   services exactly as `/store/v1`'s equivalents do, scoped to `sales_channel_id` from PR-1's
   context. Still no writes, so no idempotency/guest-token work needed yet.
3. **PR-3 — Guest token + cart.** Introduce the guest bearer token (issuance, hashing-at-rest,
   revocation), wire `GET/POST/PATCH/DELETE cart[/items...]` onto `CommerceCartService`.
4. **PR-4 — Checkout + idempotency.** `GET/POST checkout`, contact/address/delivery patches,
   `POST checkout/complete`, `Idempotency-Key` enforcement (on completion only) on the same
   `CommerceCheckout`-row pattern `/store/v1` already uses. Follow-up (Cart One-Shot Lifecycle):
   `CommerceCart::STATUS_CONSUMED` closes the one-Cart-per-Order invariant a completed-but-still-
   `active` Cart left open — see `AWJ_CHECKOUT_V1_ARCHITECTURE.md` §9.
5. **PR-5 — Standalone order status.** `GET /commerce/v1/orders/{id}` with the signed-guest-order-
   reference scheme from §3.2. **Implemented** — reference = `v1.{HMAC-SHA256(tenant|channel|order)}`
   issued at checkout completion (`order_reference` field), verified fail-closed via the
   `X-Order-Reference` header; see `docs/plans/commerce/PR5_ORDER_STATUS_IMPLEMENTATION_REPORT.md`.
6. **Deferred, separate prerequisite work (not part of this API's PR sequence, but blocking for
   variant support specifically):** variant-awareness in `CommercePriceResolver`,
   `CommerceListing`/publication gating, and `StorefrontProductResource`-equivalent serialization —
   tracked as an open dependency (§10), reviewed and merged on its own merits before a PR adds
   `variants[]` to `/commerce/v1` product responses.
7. **Deferred, separate prerequisite work for a true mobile `SalesChannel`:** since
   `Storefront` currently hard-rejects non-`web` channels (§1.4) and publication gating only
   checks `web` storefronts (§1.4), provisioning a real, usable `SalesChannel(type=mobile)` per
   tenant needs its own small, reviewed change (most likely: teach
   `CommerceProductPublicationService` to also recognize channel-direct publication for channels
   with no `Storefront` row, since `Storefront` is a web-specific domain/DNS concept a mobile
   channel doesn't need). This is called out here because PR-1's `ResolveCommerceChannel` depends
   on at least one such channel existing to resolve into — it is a prerequisite for PR-1 to be
   testable end-to-end, not merely a nice-to-have deferred to later.

**First implementable PR is PR-1**, per §9.1 above and restated in the final report below.

---

## 10. Risks and open decisions

1. **Mobile `SalesChannel` provisioning is a real prerequisite, not a formality.** §1.5 and §9.7:
   `SalesChannel::TYPE_MOBILE` exists in the schema but nothing creates or recognizes it for
   publication purposes today. This must be resolved (small, separate, reviewed change) before
   PR-1 can be exercised against real data.
2. **Store-token issuance mechanism is not yet decided.** Leading candidate: bundled per-tenant
   app configuration at build/release time (an Awj client's mobile app is inherently
   tenant-specific, unlike a multi-tenant browser hitting arbitrary storefront domains). Needs a
   decision before PR-1's middleware can be fully specified — flagged here rather than assumed.
3. **Variant exposure is explicitly out of V1's first slices** (§1.6, §3.2, §9.6) — pricing and
   publication gating need variant-awareness first; this API layer must not invent a parallel,
   duplicate variant-pricing shortcut to work around that gap.
4. **Rate-limit store is single-instance-only today** (§1.8) — acceptable for current deployment
   scale, but a mobile client base could reach this ceiling sooner than the web storefront did;
   worth re-evaluating once real mobile traffic exists, not blocking for V1.
5. **Guest-to-authenticated-customer merge is unresolved** — if/when §3.4's later phase adds
   Sanctum auth to `/commerce/v1`, what happens to an existing guest cart/order history on
   sign-in is an open product/architecture decision, not addressed by this pass.
6. **Whether the web storefront ever migrates onto `/commerce/v1`** is explicitly left open
   (§8) — no commitment either way in this document.
7. **`Storefront`'s hard web-only invariant may have reasons not fully surfaced by this pass** —
   before any change proposed in §9.7 is implemented, the original rationale for that constraint
   (git blame / associated ADR, not found in the docblocks read for this pass) should be checked
   so the fix doesn't remove a protection whose purpose wasn't visible from the code alone.

---

*This document is the deliverable for the "Public/Mobile Commerce API V1 — Architecture & Contract
Pass." No code, migrations, or route changes are included in this branch — see the accompanying
report for the proposed first implementable PR.*
