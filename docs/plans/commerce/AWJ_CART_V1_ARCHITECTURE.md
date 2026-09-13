# AWJ Cart V1 Architecture Decision

**Status: Proposed — awaiting Safwan approval**

> هذه الوثيقة قرار معماري مقترح لـ Cart V1 فقط. لا تُعدّ موافقة على التنفيذ، ولا تنشئ Cart أو migrations أو API أو تغييرات Storefront.

## 1. Executive decision

يوصى ببناء **AWJ-native server-side Cart V1** ككيان مستقل عن `CommerceOrder`، وعن `Invoice`، وعن Spree. يحتفظ المتصفح بملف cookie يحتوي على مرجع عشوائي opaque عالي الإنتروبيا فقط. يحتفظ AWJ backend بالحالة authoritative، ويربط كل Cart بخادمياً بـ`tenant_id` و`storefront_id` و`sales_channel_id` التي حُلّت من hostname الطلب عبر مسار `ResolveStorefrontDomain` الحالي.

يبدأ Cart عند أول `POST /store/v1/cart/items` ناجح، وليس عند قراءة Cart فارغة. يستخدم Cart في V1 حالة `active` أو `expired` فقط. تحفظ السطور المنتج واسم وحدة القياس القانوني والكمية، بينما يعاد حسم السعر من `CommercePriceResolver` عند كل قراءة أو تغيير. لا يُحفظ snapshot سعري في Cart لأن Cart ليس Order ولا يحتاج إلى تجميد سعر قبل Checkout.

لا توجد هوية variant مستقلة في AWJ الحالية. لذلك يكون sellable identity في V1 هو `product_id + canonical unit_name`. لا يجوز استخدام `${product.id}-default`؛ فهو معرف اصطناعي لطبقة توافق واجهة Spree، وليس هوية AWJ مخزنة.

يجب أن ترفض الخدمة كل محاولة لاجتياز حدود المستأجر أو المتجر أو القناة، وأن تعيد خطأً عاماً غير كاشف. ويجب أن تظل Cart بلا قيود أو حجوزات مخزون أو قيود محاسبية أو Order creation.

## 2. Current-state evidence

| Evidence | Repository finding | Architectural consequence |
|---|---|---|
| Storefront authority | `ResolveStorefrontDomain` resolves normalized hostname → verified active `StorefrontDomain` → active `Storefront` → active `web` `SalesChannel`, then establishes `TenantContext` and `StorefrontContext`. [1] | Cart requests must use this middleware and must not accept tenant/storefront/channel IDs from the browser. |
| AWJ catalog eligibility | `StorefrontProductController` requires active products and a published `CommerceListing` on the resolved channel. [2] | Cart add and every retained-line read must use the same effective eligibility rule. |
| Listing model | `CommerceListing` belongs to a product and sales channel, stores publication state, and stores no price or inventory. [3] | Listing is an eligibility boundary, not a Cart price or stock source. |
| Pricing | `CommercePriceResolver` validates tenant-owned Product/SalesChannel, resolves UOM with `UnitConversion`, and returns price plus `Tenant.currency`. [4] | Browser prices are ignored; Cart totals are derived from this resolver. |
| Product/UOM | `Product` has a base `unit` and optional `unit_template_id`; `UnitTemplateUnit` stores named alternative units and integer factors. [5] [6] | V1 does not invent variants. A line stores a canonical unit name and positive integer quantity. |
| Inventory | `AvailableToSellService` reads warehouse stock minus active reservations and creates no stock effects. [7] | Cart does not reserve or mutate stock. Hard stock commitment remains a Checkout concern. |
| Existing Order | `CommerceOrderService` creates draft Orders, snapshots price and quantity, and explicitly excludes Cart semantics. [8] | Cart must not call or repurpose Order creation. |
| Existing Cart | `storefront/src/lib/data/cart.ts` calls Spree cart get/list/create/item APIs and uses Spree cookies/tokens. [9] | The future adapter must replace runtime Spree calls only on the Cart path. |
| Existing UI compatibility | AWJ products are mapped into Spree-shaped view models; the default variant is synthetic `${product.id}-default`. [10] | Type/view-model compatibility may temporarily remain, but the synthetic ID must never enter AWJ Cart persistence. |
| Current public routes | `/store/v1` is an anonymous, hostname-resolved, rate-limited catalog surface. [11] | Cart routes should extend this AWJ surface with the same context and error boundary, not use the legacy tenant-slug route in production. |

### Repository conflicts and safe resolutions

The task's preferred conceptual route shape matches the existing AWJ `/store/v1` surface, but the current route file is catalog-only and has no Cart controller or service. The safe decision is to add Cart endpoints only in COM-CART-2 after the aggregate and tests are approved; no route is added in this architecture task.

The task asks whether Cart should use a variant identity. The repository has no confirmed AWJ variant model. The safe decision is **no variant identity in V1**. The synthetic UI identifier is explicitly excluded from the backend contract.

The task asks whether quantity should be decimal or integer. Current Product/UOM factors and Commerce order lines use integer quantities, and stock quantities are represented as integer base quantities. The safe V1 decision is positive integer quantity only. Decimal quantities require a separate domain decision and are out of scope.

The task's word “token” could suggest storing a bearer secret directly. The safer repository-compatible decision is to store only a SHA-256 hash of a random cookie secret; the raw secret remains in the browser cookie and is never stored in the database.

## 3. Proposed Cart aggregate

The proposed table/model is `CommerceCart` or `Cart` under the Commerce namespace, subject to the naming convention selected in COM-CART-2. It must be a `BaseModel` and be explicitly classified as `CompanyWide` in the repository's branch-isolation taxonomy. It is tenant-owned and storefront/channel-bound, not branch-bound.

| Field | Required | Decision and reason |
|---|---:|---|
| `id` | Yes | UUID primary key, consistent with current Commerce tables. It is an internal relation key, never the anonymous authorization mechanism. |
| `tenant_id` | Yes | Required for tenant ownership and tenant-scoped queries. It must be derived from `TenantContext`. |
| `storefront_id` | Yes | Required because two storefronts can represent distinct customer surfaces even when they share a tenant or channel. It is derived from `StorefrontContext`. |
| `sales_channel_id` | Yes | Required for product publication and pricing context. It is derived from `StorefrontContext`. |
| `token_hash` | Yes | SHA-256 hash of the opaque random anonymous bearer reference. It is unique. Raw token is never persisted. |
| `status` | Yes | Minimal enum: `active`, `expired`. No Checkout or payment states. |
| `expires_at` | Yes | Supports lazy expiry without requiring a scheduler. Recommended initial lifetime: 30 days from last successful Cart mutation or creation, subject to approval. |
| `created_at` / `updated_at` | Yes | Standard audit and lifecycle timestamps. |

No `currency` column is proposed. The repository is single-currency per tenant and `Tenant.currency` is the existing source of truth. No `customer_identity_id` is proposed for V1 because the first target is anonymous Cart and the current task does not require authenticated Cart ownership. A future migration may add a nullable customer association after a separate customer/cart ownership decision.

## 4. Proposed Cart Item aggregate

The proposed line table/model is `CommerceCartItem` or `CartItem`, owned by the Cart. It must not be an Order line and must not snapshot an Order's historical commercial agreement.

| Field | Required | Decision and reason |
|---|---:|---|
| `id` | Yes | UUID stable item reference. Operations always scope it through the current Cart loaded from the cookie and current context. |
| `tenant_id` | Yes | Consistent with existing Commerce line tables and useful for tenant-scoped guards and indexes. It must equal the parent Cart tenant. |
| `cart_id` | Yes | Parent Cart foreign key with cascade delete for active ephemeral state. |
| `product_id` | Yes | Authoritative AWJ sellable product identity. It is validated under the current tenant and current storefront channel. |
| `unit_name` | Yes | Canonical unit key. The base unit is stored as `Product.unit`; an alternative unit is stored by its exact `UnitTemplateUnit.name`. This avoids nullable uniqueness ambiguity and matches the repository's actual UOM identity. |
| `quantity` | Yes | Positive unsigned integer. It is never accepted from the browser as a precomputed total. |
| `created_at` / `updated_at` | Yes | Standard line timestamps. |

No `variant_id` is proposed. No `unit_factor` is persisted in Cart V1 because the authoritative unit definition is resolved from the current Product/UnitTemplate through `UnitConversion`. The resolved factor is needed for downstream stock/order semantics, not as a Cart price or identity snapshot.

No `unit_price`, `line_total`, `subtotal`, tax, discount, shipping, or payment field is persisted. These values are calculated for each response by the server.

The service canonicalizes omitted unit input to the product base unit. It validates an explicit alternative unit through `UnitConversion`; unknown units fail closed. If a later product/UOM edit makes a stored line invalid, the line remains a retained but unavailable line until the customer removes it or a future policy explicitly defines cleanup.

## 5. Identity/token model

The anonymous identity is a bearer secret carried in a cookie and mapped to a server-side Cart.

| Decision | V1 choice |
|---|---|
| Token generation | `random_bytes(32)` or the framework's cryptographically secure equivalent. Encode as URL-safe base64 without padding, yielding a non-sequential opaque reference. |
| Database representation | Persist `hash('sha256', raw_token)` in `token_hash`. Do not persist raw token. |
| Authorization use | The raw cookie token is presented implicitly by the browser; the server hashes it and queries only within the resolved tenant/storefront/channel context. |
| Sequential IDs | Never use Cart UUID, database IDs, or numbers as bearer authorization. |
| Rotation | Do not rotate on normal reads or mutations in V1. Rotate only if a future authenticated association or explicit security event requires it. |
| Invalid token | Treat as no usable Cart, clear the invalid cookie, and return a generic empty-cart result for `GET`; mutation endpoints return a generic not-found/invalid-cart response and do not reveal whether a record existed. |
| Cross-store token | Fail closed. Do not rebind, move, or adopt the Cart into the new storefront. Clear the cookie at the new storefront and return the generic failure/empty behavior defined above. |

A token must not be accepted as an arbitrary request body field or query parameter. The API may support an explicit server-to-server mechanism later, but that is not part of anonymous Cart V1.

## 6. Cookie model

Recommended cookie name: `awj_cart_token`. It is deliberately AWJ-specific and must not reuse the existing Spree cart cookie names.

| Attribute | Decision |
|---|---|
| `HttpOnly` | `true`, so browser JavaScript cannot read or exfiltrate the bearer token. |
| `Secure` | `true` in production; local non-TLS development may use the framework's environment-safe exception. |
| `SameSite` | `Lax`, sufficient for same-site storefront navigation while reducing cross-site request exposure. Any cross-site deployment requirement needs explicit approval. |
| `Path` | `/`, so the token is available to all storefront API requests and future same-site pages. |
| `Max-Age` / `Expires` | 30 days initially, aligned with `expires_at`; exact retention is an approval question because no existing Cart policy establishes it. |
| Domain | Host-only by default. Do not set a parent domain across storefronts. |
| Creation | Set only after a successful first add creates an active Cart. `GET` without a Cart does not create one. |
| Deletion | Expired, invalid, or context-mismatched token is cleared. |

The Next.js storefront adapter must forward the cookie through its server-side request to AWJ. The raw token must never be included in response JSON, HTML, analytics events, or client-controlled tenant/channel fields.

## 7. Tenant/Storefront/SalesChannel binding

Every Cart request follows this exact sequence:

```text
request Host
  → HostnameNormalizer
  → verified active StorefrontDomain
  → active Storefront
  → active web SalesChannel belonging to the same Tenant
  → TenantContext + StorefrontContext
  → awj_cart_token cookie
  → Cart lookup by token_hash and resolved context
```

The request payload contains no authoritative `tenant_id`, `storefront_id`, or `sales_channel_id`. The service obtains all three from the established server contexts. It then requires the Cart record to match all three values. A token from Store A presented to Store B must not result in a Cart lookup that searches globally by token alone.

A mismatch, inactive context, unknown domain, inactive channel, or missing Cart must fail closed. For `GET`, the safe public behavior is a generic empty Cart or a generic not-found response according to the endpoint contract; for mutation, use a generic `404`/`409` contract without disclosing which binding failed. The implementation must not distinguish “token exists in another tenant” from “token does not exist” in its body or timing-sensitive application logic.

The existing `ResolveStorefrontDomain` already performs the critical cross-tenant verification: it resolves the domain before setting TenantContext, then resolves Storefront and SalesChannel under the tenant scope and checks active `web` state. Cart must reuse that middleware rather than duplicating host resolution.

## 8. Product eligibility

Cart V1 uses one effective eligibility rule:

```text
Product belongs to current Tenant
AND Product.is_active = true
AND CommerceListing.product_id = Product.id
AND CommerceListing.sales_channel_id = resolved SalesChannel.id
AND CommerceListing.is_published = true
```

The product must be loaded through the current tenant scope. Because `Product` is branch-shareable and the public storefront deliberately bypasses only the transient `BranchScope` when looking up an explicitly requested product, Cart may use the same narrowly justified pattern, while never bypassing `TenantScope`.

The current repository has the rule in `StorefrontProductController` as a query boundary, but no single reusable `isEligibleForStorefront()` service is confirmed. COM-CART-2 should either call a small shared eligibility service extracted from that exact rule or create a narrowly scoped query object. It must not create a second definition that can drift from catalog publication.

Eligibility is checked on add, update, and read/serialization. If an already-added product becomes inactive or unpublished, the Cart item is not silently converted into an orderable item. V1 should retain the row for customer visibility, mark it unavailable, exclude it from the authoritative subtotal, and require removal before any future Checkout boundary accepts the Cart. Mutation of an unavailable item is rejected until eligibility is restored or the item is removed. The exact response flag should be fixed in COM-CART-2 tests.

## 9. Pricing authority

For every eligible line, the server performs:

```text
CartItem(product_id, canonical unit_name)
  → Product/UOM under current TenantContext
  → CommercePriceResolver::resolve(product_id, sales_channel_id, null, unit_name)
  → authoritative unit price in minor units
  → quantity × unit price
  → sum of eligible line totals = subtotal
```

`partner_id` is `null` for anonymous Cart V1. If authenticated customer pricing is introduced later, it must come from a trusted CustomerContext and a separately approved ownership/pricing decision, never from a browser-supplied partner ID.

V1 chooses **A: no price snapshot; recalculate on each read and mutation**. This is the safest separation between a mutable Cart and a historical Order. If the product price changes, the next Cart response reflects the new authoritative price and subtotal. The Cart does not preserve the old price and does not create an Order until a later Checkout decision defines when a commercial price becomes historical.

The browser may submit only product, unit, and quantity. Any submitted `price`, `unit_price`, `line_total`, `subtotal`, `total`, `currency`, or discount field is ignored only if the request validator rejects unknown fields; the recommended contract is to reject these fields with `422` to make client misuse visible. The server never uses them in a calculation.

All monetary values are integer minor units. Currency is returned as the tenant's `Tenant.currency`; there is no browser-selected currency and no Cart currency field.

## 10. Quantity semantics

V1 accepts **positive integers only**. This follows the current Commerce order line schema (`unsignedInteger`), integer UOM factors, integer stock quantities, and `CommerceOrderService`'s positive-quantity guard.

| Input | Result |
|---|---|
| Missing, null, non-numeric, fractional, NaN-like, or non-integer | `422`; no write |
| `quantity < 0` | `422`; no write |
| `quantity = 0` | `422`; zero is not an implicit remove operation |
| `quantity >= 1` | Accepted after eligibility and context checks |
| Decimal quantity | `422` in V1; requires a separate domain decision |

Removal is explicit through `DELETE /store/v1/cart/items/{item}`. This avoids ambiguous client behavior and preserves a single meaning for quantity.

## 11. Cart lifecycle

The lifecycle has only two V1 states:

```text
(no Cart) --successful first add--> active
active --expiry check--> expired
expired --future Checkout decision--> outside V1
```

A Cart is created lazily on the first successful add. A failed add must not leave an empty Cart or cookie behind. Expiry is checked lazily on every access and mutation; no scheduled cleanup is required for correctness. A background cleanup job may be added later for storage hygiene but is not part of this task.

Recommended initial expiry is 30 days from creation or the last successful mutation, with the exact policy requiring Safwan approval because the repository has no existing anonymous Cart retention policy. On expiry, mark the Cart `expired` when practical, delete or clear the browser cookie, and treat the token as unusable. The next successful add creates a new Cart and token; no automatic cross-Cart restoration is performed.

Checkout conversion, reservation, payment, and order confirmation are not lifecycle states in V1.

## 12. Proposed backend contract

The safest route prefix is the existing production AWJ surface: `/store/v1`. The current `StorefrontApiServiceProvider` applies JSON handling and public request context, while `routes/api_storefront.php` applies `ResolveStorefrontDomain` and public rate limiting to catalog routes. COM-CART-2 should add the Cart routes to the same production-resolved group, not to the legacy `{tenantSlug}` development-only group.

| Method and path | Purpose | Identity | Success response | Main failure responses |
|---|---|---|---|---|
| `GET /store/v1/cart` | Read current Cart or an empty Cart without creating one. | `awj_cart_token` cookie, if present. | `200` AWJ Cart response; absent/invalid token returns the documented empty response. | `404`/generic context failure; no cross-tenant disclosure. |
| `POST /store/v1/cart/items` | Create a Cart lazily or increment the existing product/UOM line. | Resolved context plus cookie; no cookie is valid for first add. | `201` on first Cart creation or `200` on an existing Cart, with `Set-Cookie` when created. | `422` malformed input, ineligible product, unknown UOM, or forbidden client pricing fields; `404`/generic invalid context. |
| `PATCH /store/v1/cart/items/{item}` | Replace an existing line quantity. | Cookie-derived Cart plus item UUID. | `200` refreshed Cart. | `404` if item is not in the current Cart or context; `422` invalid quantity/eligibility. |
| `DELETE /store/v1/cart/items/{item}` | Remove an existing line. | Cookie-derived Cart plus item UUID. | `200` refreshed Cart, or `204` only if the final response contract explicitly permits an empty body. | `404` if item is not in the current Cart or context. |

The request bodies are intentionally narrow:

```json
POST /store/v1/cart/items
{
  "product_id": "uuid",
  "unit_name": "box",
  "quantity": 2
}
```

`unit_name` may be omitted to select the product base unit. `PATCH` accepts only `{ "quantity": 3 }`. `DELETE` has no body. No endpoint accepts Cart ID, tenant ID, storefront ID, sales channel ID, price, subtotal, total, currency, partner ID, or variant ID as authority.

Every successful mutation recalculates the complete response from server-side state. The backend returns a fresh `Set-Cookie` only on first creation or an explicit future rotation event.

## 13. Response contract

The response is AWJ-native and intentionally smaller than the Spree Cart model.

```json
{
  "data": {
    "reference": "opaque-or-public-cart-reference-as-approved",
    "status": "active",
    "items": [
      {
        "id": "uuid",
        "product_id": "uuid",
        "product_name": "اسم المنتج",
        "unit_name": "piece",
        "quantity": 2,
        "unit_price": { "amount_minor": 25000, "currency": "SAR" },
        "line_total": { "amount_minor": 50000, "currency": "SAR" },
        "eligible": true,
        "available": null,
        "thumbnail_url": null
      }
    ],
    "subtotal": { "amount_minor": 50000, "currency": "SAR" },
    "currency": "SAR",
    "has_unavailable_items": false
  },
  "meta": { "request_id": "uuid" }
}
```

The public `reference` must not be the raw cookie token and must not be a sequential identifier. The safest response choice is to omit it unless the storefront adapter needs a non-authorizing display reference; if exposed, it should be a non-sensitive UUID or a separately generated public reference. The raw bearer token never appears in JSON.

`unit_price`, `line_total`, and `subtotal` are integer minor-unit amounts. For an ineligible retained line, `eligible` is `false`, `available` is `null` or `false` as determined by the approved response contract, and that line contributes zero to the authoritative subtotal. Product name and safe thumbnail may be read from current AWJ catalog data; no cost, raw stock, margin, tenant ID, or internal fields are exposed.

## 14. Currency behavior

The Cart currency is `Tenant.currency` for the tenant resolved by the current storefront context. `CommercePriceResolver` already returns that value and does not invent `SAR`; the Cart must reuse this behavior. All lines in one Cart therefore share one tenant currency. Multi-currency Cart support is not designed in V1.

A currency change on the tenant is an operational policy change that must be handled explicitly. The minimum safe behavior is to recompute all lines under the current tenant currency and reject mixed or unresolved pricing rather than trusting a stale client currency. This should be covered by COM-CART-2 if tenant currency mutation is possible in the deployed system.

## 15. Inventory boundary

Cart V1 performs no stock movement, reservation, valuation update, accounting entry, invoice creation, payment posting, or order creation.

The existing catalog path can display derived availability through `FulfillmentPolicyService` and `AvailableToSellService`. Cart may expose a non-authoritative `available` display field using that existing read-only path when a channel has a configured fulfillment policy. It must not reserve stock or reject a Cart add solely because a transient ATS value is zero unless a separately approved policy requires that behavior. Hard stock validation belongs to Checkout because Cart has no commitment boundary and the repository explicitly separates ATS reads from reservation effects.

If a product is not eligible for catalog publication, Cart add is rejected regardless of stock. Eligibility is a Cart safety rule; reservation is not.

## 16. Customer/auth compatibility

COM-CART-ARCH-1 targets anonymous Cart only. The existing `CustomerContext` establishes tenant, `customer_identity_id`, and an optional linked Partner from trusted middleware, not request input. [12]

V1 should not add customer ownership fields or perform guest-to-customer merging. A future authenticated Cart phase may add a nullable `customer_identity_id` or a separate ownership relation after deciding whether login adopts the anonymous Cart, requires an explicit action, or creates a new Cart. Any future association must verify the CustomerContext tenant and must never accept a customer or partner ID from the browser.

`CommerceOrderService` already distinguishes customer identity ownership from descriptive `partner_id`; Cart must preserve that separation and must not use Partner as an anonymous authorization mechanism.

## 17. Concurrency strategy

Use a database transaction for each mutation. Load the Cart by token hash and resolved context with `lockForUpdate()`. On add, lock the scoped line lookup, increment the existing quantity, or create the line under the uniqueness constraint. On update and delete, lock the item through the current Cart before changing it.

The transaction must re-check eligibility and resolve the authoritative price after acquiring the relevant lock and before committing the response state. This is sufficient to prevent obvious lost updates between two same-Cart mutations without introducing distributed locks or queues.

If a concurrent first-add can create duplicate lines, the unique line constraint must be treated as the final guard: retry the transaction or re-read the winner and increment it. The implementation must not silently return two lines for one product/UOM identity.

## 18. Idempotency and line uniqueness

V1 line identity is `(cart_id, product_id, unit_name)`. Adding the same product and canonical unit twice **increments the existing line quantity** rather than creating a second line. Different UOMs are different lines because the UOM can change price and quantity semantics.

No general request-level idempotency-key infrastructure is proposed for V1. The repository has no existing Cart idempotency contract, and adding one would expand the scope. This means a retried add request may increment twice; the COM-CART-2 API documentation and storefront adapter must avoid blind retries. A future Checkout/payment boundary must introduce request idempotency before externally consequential operations.

## 19. Security model

| Threat | Protection |
|---|---|
| Guessed cart token | 32 cryptographically random bytes, URL-safe encoding, raw token never stored, HttpOnly cookie. |
| Stolen token | Bearer-token risk is limited by Secure/HttpOnly/host-only cookie settings, HTTPS, short bounded lifetime, and strict context binding. Token revocation occurs through expiry or future rotation. |
| Token replay on another storefront | Lookup is scoped to resolved tenant/storefront/channel; mismatch fails closed and does not rebind. |
| Cross-tenant Cart access | Tenant comes from trusted hostname resolution and TenantScope; payload tenant IDs are ignored/rejected. |
| Cross-channel product injection | Product must have a published `CommerceListing` for the resolved channel; product/channel IDs are never selected from the client. |
| Unpublished or inactive product injection | Eligibility is checked on add, update, and retained-line serialization. |
| Client price manipulation | Price/totals/currency fields are rejected as unknown authority; all money comes from `CommercePriceResolver`. |
| Cart-item ID tampering | Item UUID is scoped through the cookie-derived Cart and current context; no global item lookup by ID. |
| Expired tokens | Expiry is checked before use; expired state is unusable, cookie is cleared, and the next add creates a new Cart. |
| Malformed quantity | Strict positive integer validation rejects zero, negative, fractional, null, and malformed values before any write. |
| Timing/data disclosure | Use generic not-found/context errors and avoid reporting whether a token exists in another store. |
| CSRF on cookie-authenticated mutation | SameSite=Lax reduces cross-site submission; COM-CART-2 must confirm whether the Next.js server adapter or Laravel endpoint also requires a CSRF/origin control for the deployment topology. |

## 20. Database constraints and indexes

The following is the minimum proposed constraint set; it is a design proposal, not a migration.

| Constraint/index | Purpose |
|---|---|
| UUID primary keys on Cart and CartItem | Matches existing AWJ Commerce IDs and avoids sequential public identifiers. |
| FK `cart.tenant_id → tenants.id` cascade | Tenant ownership and cleanup. |
| FK `cart.storefront_id → storefronts.id` restrict or controlled delete | Prevent deleting a storefront while active customer state still refers to it, unless an explicit cleanup policy exists. |
| FK `cart.sales_channel_id → sales_channels.id` restrict | Preserve context identity for Cart rows. |
| FK `cart_item.cart_id → carts.id` cascade | Ephemeral line cleanup with parent Cart. |
| FK `cart_item.product_id → products.id` restrict or application-managed retention | The Cart is not historical Order evidence. COM-CART-2 must choose whether product deletion is blocked or items are marked unavailable. |
| Unique `token_hash` | Prevent two Carts sharing one bearer reference. |
| Index `(tenant_id, storefront_id, sales_channel_id, status, expires_at)` | Context-scoped active/expiry lookups and cleanup. |
| Unique `(cart_id, product_id, unit_name)` | Deterministic line merge. `unit_name` is non-null and canonical to avoid NULL uniqueness differences across PostgreSQL and SQLite. |
| Index `(tenant_id, cart_id)` on items | Tenant-safe parent and item queries. |

Individual foreign keys do not prove that all referenced rows belong to the same tenant. That invariant must remain an explicit service check, matching existing AWJ patterns such as `CommerceListingService`, `FulfillmentPolicyService`, and `ResolveStorefrontDomain`. A composite cross-tenant foreign-key design is not proposed without repository evidence that the database portability and migration conventions support it.

## 21. Spree migration boundary

The goal is not broad Spree removal. The migration boundary is the Cart path only.

| Eventually changes in Cart wiring | Remains untouched by COM-CART-2 / wiring task |
|---|---|
| AWJ Cart backend model, service, controller, request validation, resource, routes, and tests | Checkout implementation and checkout payment flow |
| `storefront/src/lib/data/cart.ts` becomes an AWJ server-action adapter | Payments, gateways, shipping, tax, coupons, order creation |
| `storefront/src/contexts/CartContext.tsx` changes its data types and action calls to AWJ contract | Existing AWJ catalog publication behavior |
| Cart page and product-detail calls change only as needed to consume AWJ Cart response | Unrelated Spree account/order/checkout modules |
| Cart-specific runtime Spree calls and Spree cart cookies disappear | Broad `@spree/sdk` removal and unrelated type-only compatibility |

The current `storefront/src/lib/commerce/mappers.ts` may temporarily retain type-only Spree-shaped view models for catalog UI compatibility. That compatibility must not leak into the AWJ Cart API. Runtime calls in `storefront/src/lib/data/cart.ts` to `getClientForSurface(...).carts.*`, Spree cart tokens, and Spree cart cookies must disappear only after the AWJ Cart backend is implemented and the adapter is covered by tests.

The existing Cart page includes Express Checkout and a Checkout link. Those paths are outside COM-CART-2 and must not be redesigned or made to consume an incomplete Cart contract. The wiring task must define the safe feature boundary so Cart can render without silently starting Checkout.

## 22. Storefront adapter plan

The smallest future adapter preserves the existing `CartContext` and visual UI while replacing its server-side data source:

1. `CartContext.refreshCart()` calls the AWJ Cart server action.
2. The server action forwards the host context and `awj_cart_token` to `/store/v1/cart` through the existing server-side gateway pattern.
3. `addItem` sends AWJ `product_id`, optional `unit_name`, and integer quantity, never a synthetic variant ID or price.
4. `updateItem` sends the AWJ CartItem UUID and replacement quantity.
5. `removeItem` sends the AWJ CartItem UUID.
6. The adapter maps the compact AWJ response to a local Cart view type; it does not recreate every Spree field.
7. The existing UI remains visually unchanged unless a response field is genuinely unavailable. Unavailable retained lines need a clear non-checkout state and removal action.
8. Product detail obtains the authoritative product ID from the AWJ product response. It does not pass `${product.id}-default` to AWJ.

The adapter must continue to resolve the visitor hostname server-side and must not let browser JavaScript choose tenant or channel. Cookie setting and deletion should occur only in server actions/route handlers where the Next.js runtime permits cookie mutation.

## 23. COM-CART-2 backend scope

COM-CART-2 should implement only the approved backend boundary:

- Cart and CartItem migrations with the approved fields and constraints.
- BaseModel and explicit `CompanyWide` classification.
- One Cart service containing context binding, token lookup, eligibility, UOM canonicalization, pricing, totals, lifecycle, and mutation transactions.
- Thin request validation and resource serialization.
- `/store/v1/cart` endpoints under the existing trusted domain middleware and public rate limit.
- Focused backend tests for every row in the test matrix below.
- No Storefront code, Checkout, Payments, Shipping, promotions, Order creation, accounting, or inventory reservation.

If the implementation discovers that the existing route/provider or tenant context cannot support the contract without a broad refactor, it must stop and report the boundary rather than expanding COM-CART-2.

## 24. Later storefront wiring scope

A separate storefront task should replace only Cart runtime dependencies:

- AWJ Cart fetch/action adapter.
- AWJ-native Cart and CartItem TypeScript types.
- CartContext action calls and loading/error handling.
- Product detail add action.
- Cart page response mapping and unavailable-line behavior.
- Cart-specific tests and build/typecheck.

It should not remove Spree globally, modify catalog publication, redesign the storefront, or start Checkout. The task should explicitly confirm that `SPREE_API_URL` and `SPREE_PUBLISHABLE_KEY` are not required for AWJ catalog-plus-Cart navigation once the Cart path is switched.

## 25. COM-CART-2 test matrix

| Scenario | Backend test | Storefront wiring test |
|---|---:|---:|
| Create anonymous Cart on first add | Yes | Cookie/action integration |
| `GET` without token returns empty without creating a Cart | Yes | Empty-state rendering |
| Add published product | Yes | Add action sends product ID and quantity |
| Reject unpublished product | Yes | Error toast/state |
| Reject inactive product | Yes | Error toast/state |
| Reject product from another tenant | Yes | Error state without leakage |
| Reject product from another sales channel | Yes | Error state without leakage |
| Reject Cart token on another storefront | Yes | Cookie clearing and generic failure |
| Authoritative server pricing | Yes | Render returned price only |
| Client price ignored/rejected | Yes | Adapter does not send price |
| Update quantity | Yes | Quantity control refreshes response |
| Zero, negative, fractional, malformed quantity | Yes | Control prevents invalid input; server error remains handled |
| Remove item | Yes | Removal updates count and subtotal |
| Persistence across refresh/navigation | Yes | Provider refresh behavior |
| Expired Cart behavior | Yes | Expired cookie recovery |
| Cart item ID tampering | Yes | Generic error handling |
| Price change after add | Yes | Updated server price is rendered |
| Ineligible retained item | Yes | Unavailable state and removal path |
| Same product/UOM add twice | Yes | Deterministic merged line |
| No inventory/accounting side effects | Yes | Not applicable |
| AWJ Cart path does not require Spree configuration | Yes/contract | Build and action tests with Spree env absent |

Backend tests must assert tenant/channel context from the request hostname and must include direct ID-tampering attempts. Storefront tests must mock the AWJ contract, not Spree cart APIs, once wiring begins. Existing Spree tests remain unchanged unless a later Cart-path removal makes a focused compatibility test obsolete.

## 26. Risks and open questions

| Question or risk | Safe recommendation | Approval needed |
|---|---|---:|
| Anonymous Cart retention | Start with 30 days and lazy expiry. | Yes |
| Public Cart reference in JSON | Omit it unless UI needs a non-authorizing display reference. | Yes |
| Product deletion with Cart items | Prefer blocking deletion while active Cart references exist, or explicitly mark retained items unavailable. Do not silently null the identity. | Yes |
| Product/UOM edits after add | Revalidate on every read; retain and flag ineligible lines rather than silently deleting them. | Yes |
| Hard stock validation in Cart | Defer commitment to Checkout; expose read-only availability only. | Yes |
| CSRF/origin control | Confirm based on the actual Next.js-to-Laravel deployment topology. | Yes |
| Authenticated customer adoption | Defer association and merge semantics to a separate customer/cart decision. | Yes |
| Base unit rename | Canonicalize and store the current base unit name in V1; define rename handling before implementation if base-unit edits are common. | Yes |
| Route status for missing Cart | Prefer `200` empty response for `GET`, generic `404` for item mutations. | No, unless API standards differ |
| Cart model name | Use a Commerce-prefixed name if `Cart` conflicts with existing framework/vendor semantics. | Yes |

## 27. Explicit out-of-scope list

This architecture does not include Checkout, Payments, gateways, Shipping, delivery, tax redesign, coupons, promotions, order creation, invoice creation, accounting postings, inventory movements, inventory reservations, inventory valuation changes, public/mobile Commerce API V1, app builder, multi-store redesign, broad Spree removal, storefront redesign, authenticated Cart merge, multi-currency support, or decimal quantities.

It also does not modify any application file, create migrations, add routes, create models, create services, update Storefront behavior, or remove Spree code.

## 28. Recommended implementation sequence

1. Safwan approves this proposed decision and resolves the open questions marked for approval.
2. COM-CART-2 implements migrations and backend Cart contract only, starting with model constraints and tenant/channel binding tests.
3. COM-CART-2 adds eligibility and pricing service tests before exposing routes.
4. COM-CART-2 adds endpoint tests for token, quantity, lifecycle, and side-effect boundaries.
5. A separate storefront wiring task replaces only runtime Spree calls in the Cart path and preserves the existing UI direction.
6. Run focused backend and storefront tests, then typecheck and build with Spree Cart configuration absent where the AWJ path is expected to work.
7. Keep Checkout and Payments on their existing boundary until separate architecture and implementation tasks are approved.

## References

[1]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Http/Middleware/ResolveStorefrontDomain.php "AWJ Storefront domain resolution middleware"
[2]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Http/Controllers/Api/StorefrontProductController.php "AWJ public storefront product controller"
[3]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Models/CommerceListing.php "AWJ Commerce listing model"
[4]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Services/Commerce/CommercePriceResolver.php "AWJ Commerce price resolver"
[5]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Models/Product.php "AWJ Product model"
[6]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Models/UnitTemplateUnit.php "AWJ Product alternative unit model"
[7]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Services/Commerce/AvailableToSellService.php "AWJ available-to-sell read service"
[8]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Services/Commerce/CommerceOrderService.php "AWJ Commerce order service"
[9]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/storefront/src/lib/data/cart.ts "Current Spree-backed storefront Cart actions"
[10]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/storefront/src/lib/commerce/mappers.ts "AWJ-to-Spree-shaped storefront view-model mapper"
[11]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/routes/api_storefront.php "AWJ public storefront routes"
[12]: https://github.com/safwan5001-source/Nebrax/blob/556679ac8bffcb38ee769b444ace13bdf44aed99/app/Tenancy/CustomerContext.php "Trusted AWJ customer context"
