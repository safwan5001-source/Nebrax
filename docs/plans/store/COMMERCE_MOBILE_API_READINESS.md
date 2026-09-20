# AWJ Commerce Mobile API Readiness — Evidence Pass V1

**Status:** Evidence-based readiness assessment — not implementation authorization  
**Evidence baseline:** repository `main` inspected on 2026-09-20  
**Purpose:** Gate AWJ App Builder V1 against the Commerce APIs that actually exist today.

## 1. Classification

- **Ready** — current mobile Commerce contract is suitable for the intended V1 capability with no known material contract gap from this pass.
- **Ready with Hardening** — substantial reusable implementation exists, but a known gap must close before App Builder/runtime depends on it.
- **Missing** — no mobile contract was found for the required capability.
- **Blocked** — depends on an unresolved product/security/business architecture decision.

This pass does not mark an area Ready merely because an internal ERP controller/model exists.

## 2. Existing mobile trust boundary

The repository already has a dedicated `/commerce/v1` API.

Its route chain is:

```text
AuthenticateApiClient
 -> PublicApiTenantGuard
 -> ResolveCommerceChannel
 -> PublicApiRequestAudit
 -> EnforcePublicApiRateLimit
 -> EnsureActiveSubscription
```

Evidence: `routes/api_commerce.php`.

Important current design:
- Authorization bearer resolves `ApiClient` and TenantContext;
- mobile SalesChannel is resolved server-side;
- tenant/channel are not client-selected;
- reads and writes use separate rate-limit classes;
- the mobile boundary is intentionally separate from `/store/v1`.

**Assessment: Ready foundation.**

## 3. Readiness matrix

| Capability | Status | Current evidence | Required before App Builder V1 |
|---|---|---|---|
| Mobile app/store identity | Ready | `GET /commerce/v1/storefront`; trusted ApiClient + server-resolved mobile channel | Confirm provisioning/lifecycle in implementation gate |
| Categories | Ready | index/show; `CommerceCategoryListing` publication on resolved mobile channel | Contract fixtures + mobile runtime integration |
| Product list | Ready with Hardening | list/search/category/sort/pagination; channel publication; server price/availability | Media + variant contract gaps |
| Product detail | Ready with Hardening | show route + server pricing/availability for non-variant products | Variant detail/options + media |
| Search | Ready with Hardening | product `search` filter supports name/name_en/SKU | Decide whether V1 needs richer facets/dedicated search contract |
| Product media | Missing | controller explicitly states no `/commerce/v1/media/{id}`; mobile resource suppresses media | Add mobile-authorized media contract reusing hardened media authority |
| Variant/options | Missing for mobile product contract | controller explicitly defers variant payload; parent price/stock intentionally unknown | Define variant/options/UOM DTO + price/availability contract |
| Pricing | Ready with Hardening | `CommercePriceResolver` reused; tenant currency; server authority | Variant pricing; verify promotion/price-list needs |
| Availability | Ready with Hardening | `FulfillmentPolicyService` + `AvailableToSellService` | Variant availability; define unknown/no-policy UX |
| Guest cart read | Ready | `GET cart`; `CommerceCartService`; opaque `X-Cart-Token` | Runtime secure token storage |
| Cart add/update/remove | Ready with Hardening | same CommerceCartService business authority; strict request fields | Action Registry wants retry semantics; Cart V1 intentionally has no request-level idempotency |
| Guest checkout | Ready | get/create/contact/address/delivery; same trusted service | Runtime integration and validation fixtures |
| Checkout completion/order creation | Ready | mandatory `Idempotency-Key`; final revalidation; conflict/review-required handling | Payment gap remains separate |
| Guest order status | Ready | signed `X-Order-Reference`; tenant + mobile-channel scoped; non-revealing 404 | Secure storage/deep-link strategy |
| Customer authentication | Missing in `/commerce/v1` evidence | no customer auth route in inspected mobile Commerce route surface | Design customer mobile auth/session contract |
| Customer profile | Missing | no mobile customer profile resource found in this pass | Add minimum customer-facing DTO/API |
| Customer addresses | Missing as account resource | checkout accepts delivery address, but no authenticated saved-address resource in mobile boundary | Define authenticated address API if V1 requires saved addresses |
| Customer order history | Missing | standalone guest order status exists, not authenticated customer order collection | Define customer-owned orders list/detail contract |
| Guest → customer cart merge | Blocked | current mobile contract is guest-token based; no authenticated customer transition evidenced | Decide identity/merge/claim policy before implementation |
| Shipping methods/rates | Ready with Hardening | checkout delivery mutation exists | Inspect/define eligible methods/rates DTO if richer mobile UI requires it |
| Payment methods | Missing | no payment-method resource in inspected `/commerce/v1` routes | Define eligibility/display DTO |
| Payment initiation/verification | Missing | checkout completion creates CommerceOrder; no provider payment action evidenced in mobile route surface | Payment architecture/provider contracts required |
| Coupons/promotions | Missing from inspected mobile surface | no coupon routes/resources in `api_commerce.php` | Add only if required for V1 |
| App-specific push/deep links | Missing from Commerce API | outside current route surface | Separate engagement/native capability work |
| Localization contract | Ready with Hardening | product search supports Arabic/English names; existing resources reused | Explicit response locale/fallback contract still needed |

## 4. Catalog evidence

### Categories — Ready

`CommerceCategoryController`:
- reads the mobile channel from trusted `StorefrontContext`;
- gates categories using `CommerceCategoryListing::publishedOn(channel)`;
- filters active categories;
- returns only published hierarchy;
- detail returns 404 when unavailable.

This matches the App Builder requirement that placing a Category component never bypasses channel publication.

### Products — Ready with Hardening

`CommerceProductController`:
- requires active product;
- requires published `CommerceListing` on the resolved mobile SalesChannel;
- supports search, category filter, sort and pagination;
- category filtering additionally verifies category publication;
- uses `CommercePriceResolver`;
- uses fulfillment + Available-to-Sell services;
- does not accept client tenant/channel.

This is a strong reusable mobile catalog foundation.

Two explicit gaps prevent full V1 readiness: **media and variants**.

## 5. Variant gap — explicit repository evidence

The current controller deliberately defers variants.

For a variant-managed product:
- price is not exposed as an invented parent price;
- `in_stock` is `null`, not fabricated false;
- no mobile attributes/variant/options payload is provided.

This is the correct fail-safe behavior, but App Builder Product Detail/Add-to-Cart cannot be complete for variant-managed products until a mobile variant contract exists.

**Classification: Missing capability, not a bug to paper over in App Builder.**

Required contract:
- option/attribute definitions;
- valid combinations/VariantRef;
- UOM/unit selection where applicable;
- variant price;
- variant availability;
- media relationship if variant media exists;
- add-to-cart selection requirements.

## 6. Media gap — explicit repository evidence

`CommerceProductController` states that no `/commerce/v1/media/{id}` route exists and intentionally suppresses gallery/thumbnail data rather than leaking a URL from another trust boundary.

This is safe but blocks production-quality mobile catalog UX.

**Required:** create a mobile-authorized media delivery contract that reuses AWJ's hardened product-media storage/tenant authority. Do not duplicate media records/storage for App Builder.

## 7. Pricing and availability

Current mobile product reads reuse the same authority services rather than duplicating business logic.

This satisfies the architectural direction:

```text
App -> Commerce API -> existing AWJ pricing/fulfillment/availability authority
```

not:

```text
App -> App Builder pricing implementation
```

Remaining gaps:
- variant pricing/availability;
- explicit mobile contract for promotions if V1 needs them;
- UX semantics when fulfillment warehouse is not configured and availability is unknown.

## 8. Cart

`CommerceCartController` reuses `CommerceCartService` for:
- pricing;
- publication;
- availability;
- quantity;
- eligibility;
- expiry;
- locking.

Mobile transport uses:
- ApiClient bearer for store/mobile identity;
- separate opaque `X-Cart-Token` for guest cart identity;
- token hash stored rather than raw token according to controller evidence.

Supported:
- read cart;
- add item;
- update quantity;
- remove item.

### Hardening note: idempotency

The route documentation explicitly states Cart V1 has **no request-level Idempotency-Key contract by design**, matching the web storefront/current cart architecture.

This does not automatically make Cart unsafe; the reused service has its own locking/business rules. However, the App Builder Action Registry draft expects explicit retry/duplicate semantics for mobile mutations.

Before runtime implementation, reconcile these contracts:
- preserve existing cart semantics if sufficient;
- or introduce a backward-compatible mobile operation-id contract if evidence shows retries can create undesirable duplicate intent.

Do not casually change cart semantics as part of App Builder.

## 9. Checkout

Current mobile checkout is materially advanced.

Supported:
- read current checkout;
- create/resume;
- contact update;
- address update;
- delivery update;
- complete.

`CommerceCheckoutController` reuses `CommerceCheckoutService` rather than reimplementing pricing/stock/order logic.

Completion requires a valid `Idempotency-Key` and handles:
- replay;
- idempotency conflict;
- final review/revalidation required;
- order creation only after successful service completion.

**Classification: Ready for guest checkout foundation.**

This does **not** mean payment-provider integration is Ready.

## 10. Guest order status

`GET /commerce/v1/orders/{id}` exists.

Ownership is not inferred from order ID or the store ApiClient token.

The controller requires:
1. order scoped to trusted tenant;
2. order scoped to resolved mobile SalesChannel;
3. valid signed `X-Order-Reference` bound to tenant/channel/order.

Failures return the same non-revealing 404.

**Classification: Ready for guest standalone order status.**

This is distinct from authenticated customer order history.

## 11. Customer identity gap

The inspected `/commerce/v1` surface is currently store/mobile-client + guest-cart oriented.

This evidence pass did not find a customer-authenticated mobile Commerce contract for:
- sign in/register/recovery;
- profile;
- saved addresses;
- order collection/history.

Internal ERP customer controllers are not substitutes for a customer-facing mobile trust boundary.

**Classification: Missing.**

Before V1 account/order features, define:
- customer identity/session mechanism;
- tenant/app binding;
- secure token storage/rotation/revocation;
- guest → authenticated transition;
- minimum customer DTOs;
- ownership negatives.

## 12. Guest → customer cart transition — Blocked

Current cart identity is the guest `X-Cart-Token`.

No evidence in the inspected mobile route surface establishes how a guest cart becomes/merges with an authenticated customer's cart.

Do not invent this in Flutter/App Schema.

Decision required:
- claim guest cart;
- merge with existing customer cart;
- conflict/quantity behavior;
- pricing/revalidation;
- abandoned/expired cart handling;
- logout behavior;
- multi-device behavior.

Backend must own the merge decision.

## 13. Payment gap

The current inspected mobile route surface has no:
- payment-method eligibility resource;
- payment initiation action;
- provider session/client-secret abstraction;
- provider callback/webhook verification contract;
- payment status resource/action.

Checkout completion currently creates/returns a CommerceOrder, but that alone is not evidence of a complete online-payment architecture.

**Classification: Missing.**

Before enabling paid mobile checkout:
- select/provider-neutral payment architecture;
- define payment method eligibility;
- server-side initiation;
- provider verification/webhooks;
- idempotency/replay;
- pending/failure/cancel states;
- order/payment accounting state transition;
- sandbox Preview path;
- native SDK impact where applicable.

## 14. Shipping/delivery

Checkout supports a validated delivery `method` from `CommerceCheckoutService::DELIVERY_METHODS` and delivery address fields.

This proves a delivery selection foundation, but this pass did not establish a rich standalone shipping-method/rate resource.

**Classification: Ready with Hardening** for a simple checkout; inspect service/DTO before designing a richer shipping selector.

## 15. Promotions/coupons

No coupon resource/action was found in the inspected `/commerce/v1` routes.

Do not implement coupon math in the app.

If coupons are V1:
- expose a trusted cart/checkout action;
- server determines eligibility;
- return authoritative cart totals.

Until then: **Missing from mobile contract.**

## 16. Security posture already present

Positive evidence:
- TenantContext comes from authenticated ApiClient;
- mobile SalesChannel is server-resolved;
- public API audit middleware;
- rate limiting;
- subscription gate;
- publication by channel;
- order ownership uses signed reference;
- checkout completion has idempotency;
- controllers reject unknown mutation fields in Cart/Checkout;
- business logic is reused through Commerce services rather than copied into mobile controllers.

These are strong foundations for App Builder.

## 17. Required V1 closure order

Recommended dependency order:

1. **Mobile Product Media**
2. **Mobile Variant / Options / UOM contract**
3. **Customer Mobile Auth + Profile**
4. **Guest → Customer Cart transition**
5. **Customer Addresses + Order History**
6. **Payment architecture + Payment Methods**
7. **Shipping method/rate contract refinement**
8. **Coupons/Promotions only if V1 scope confirms them**
9. explicit localization/fallback contract
10. runtime fixtures/integration tests across the completed vertical slice

This order protects the critical flow:

```text
Browse
 -> Product Detail
 -> select purchasable configuration
 -> Cart
 -> authenticate/guest transition
 -> Checkout
 -> Shipping
 -> Payment
 -> Order
 -> Order Status/History
```

## 18. App Builder implementation gate

Do **not** start full App Builder implementation merely because the visual contracts are documented.

A representative V1 commerce vertical slice should first prove:

```text
mobile app identity
 -> published category/product
 -> media
 -> variant/options if applicable
 -> authoritative price/availability
 -> cart
 -> customer/guest identity
 -> checkout
 -> shipping
 -> payment/test payment
 -> order
 -> authenticated/guest status read
```

All through the same tenant-scoped Commerce Core.

## 19. Required tests before Ready

For each new/hardened mobile capability:
- happy path;
- invalid input;
- missing auth where required;
- cross-tenant reference;
- cross-channel/unpublished;
- ownership negative;
- rate-limit/error envelope;
- stale price/stock;
- retry/idempotency where side effects exist;
- SQLite + PostgreSQL where repository CI policy requires;
- no internal/cost/sensitive field leakage.

Payment/customer identity additionally require focused security tests.

## 20. Evidence files inspected

Primary evidence:
- `routes/api_commerce.php`
- `routes/api_storefront.php`
- `app/Http/Controllers/Api/CommerceProductController.php`
- `app/Http/Controllers/Api/CommerceCategoryController.php`
- `app/Http/Controllers/Api/CommerceCartController.php`
- `app/Http/Controllers/Api/CommerceCheckoutController.php`
- `app/Http/Controllers/Api/CommerceOrderController.php`

This is a targeted readiness pass, not a claim that every related service/test/migration in the repository was exhaustively audited.

Before coding each missing capability, inspect only its relevant service/models/tests and current main to avoid stale assumptions.

## 21. Readiness conclusion

AWJ is **not starting from zero** for mobile commerce.

Already present:
- dedicated mobile Commerce trust boundary;
- server-resolved tenant/mobile channel;
- category publication;
- product publication/search/pagination;
- non-variant server pricing/availability;
- guest cart;
- guest checkout;
- idempotent checkout completion;
- secure signed guest order lookup.

Material gaps before complete App Builder V1 commerce:
- mobile product media;
- variant/options contract;
- customer mobile identity/account resources;
- guest/customer cart lifecycle;
- payment methods/payment execution;
- customer order history;
- optional coupon/promotion contract;
- richer shipping contract if required.

The correct next engineering move is **not** to create parallel App Builder business logic. Close these gaps inside the existing Public/Mobile Commerce API boundary, then bind App Builder resources/actions to those contracts.
