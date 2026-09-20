# AWJ Data Resource Registry V1 — Contract Draft

**Status:** Draft implementation-facing contract  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Related:** `APP_SCHEMA_V1.md`, `COMPONENT_REGISTRY_V1.md`, `ACTION_REGISTRY_V1.md`

## 1. Purpose

The Data Resource Registry defines the **approved, typed data capabilities** that AWJ mobile experiences may read.

It is the formal boundary between App Builder presentation and AWJ Commerce business truth.

```text
App Schema / Component
 -> registered Data Resource
 -> trusted runtime request
 -> authenticated app/customer context
 -> server resolves tenant/store/channel/market
 -> AWJ Commerce Core
 -> authorized typed result
```

A Data Resource is not an arbitrary URL and does not grant authority.

## 2. Source-of-truth invariant

AWJ Commerce remains authoritative for:
- products and publication;
- categories;
- variants/options/UOM where supported;
- product media;
- price lists/current price;
- promotions/discount eligibility;
- stock/availability;
- cart;
- checkout;
- customer/account;
- orders;
- shipping/delivery;
- payment state;
- other commerce/business records.

The app may cache/render results according to policy, but App Builder does not create a parallel commerce database.

## 3. Storefront and app relationship

The web store and mobile app are separate presentation channels over the same Commerce Core.

They may differ in:
- layout;
- navigation;
- app-only content;
- app-only promotions when explicitly supported by Commerce rules;
- published experience version;
- channel-specific merchandising.

They must not diverge by silently copying authoritative product/price/stock/order truth.

## 4. Resource Definition

Conceptual metadata:

```json
{
  "type": "commerce.products",
  "version": 1,
  "resultType": "ProductSummaryConnection",
  "auth": "public-or-customer",
  "scope": "serverResolved",
  "parameters": {},
  "cachePolicy": {},
  "previewPolicy": {},
  "compatibility": {}
}
```

Exact serialization is not locked.

## 5. Server-resolved context

Client/schema does not choose authoritative:
- tenant;
- storefront;
- sales channel;
- price list;
- customer identity;
- warehouse/inventory authority;
- currency/market when governed by server policy.

The server derives/validates context from trusted app/domain/session/token relationships and business configuration.

A client-provided identifier can be a lookup input only when server independently authorizes it.

## 6. Reference types

Prefer opaque/stable references rather than full backend models.

Candidate references:
- ProductRef;
- CategoryRef;
- VariantRef;
- CartLineRef;
- CustomerAddressRef;
- OrderRef;
- ShippingMethodRef.

References do not encode authorization.

Knowing an ID/reference does not entitle access.

## 7. Initial V1 resource families

Final inclusion depends on `COMMERCE_MOBILE_API_READINESS.md`.

### Catalog
- `commerce.categories`
- `commerce.category`
- `commerce.products`
- `commerce.product`
- `commerce.productMedia` where separate resource is justified
- `commerce.search`

### Commerce state
- `commerce.cart`
- `commerce.checkout` / checkout session read model when approved
- `commerce.shippingMethods` when checkout context permits
- `commerce.paymentMethods` as safe eligibility/display metadata, never provider secrets

### Customer
- `customer.profile`
- `customer.addresses`
- `customer.orders`
- `customer.order`

### Experience/content
- AWJ-managed app content resources where content is not embedded directly in Published Experience;
- campaign/promotion presentation resources where later approved.

## 8. Categories

### `commerce.categories`

Returns categories available for the resolved tenant/store/channel/market.

Candidate parameters:
- parent reference;
- pagination;
- safe sort/presentation options;
- publication/visibility filters controlled by server contract.

The app cannot set `includeUnpublished=true` to expose hidden categories.

### `commerce.category`

Returns one authorized/published category and safe presentation metadata.

Cross-tenant/unavailable references return safe not-found/denial semantics without existence leakage.

## 9. Products collection

### `commerce.products`

Candidate parameters:
- category/collection reference;
- search/filter facets supported by Commerce;
- sort enum;
- pagination/cursor;
- bounded page size;
- merchandising context.

Candidate result summary:
- ProductRef;
- localized name;
- authorized media summary;
- authoritative display price/range;
- promotion badge/summary if server provides it;
- availability summary;
- safe option/variant summary only where useful.

Do not expose internal cost, margin, supplier cost or accounting-only fields.

## 10. Product detail

### `commerce.product`

Candidate result:
- stable product reference;
- localized content;
- authorized media;
- price/current pricing presentation;
- publication/availability;
- purchasable units/options/variants;
- required selection rules;
- quantity constraints where server owns them;
- safe merchandising metadata.

Product detail response must be sufficient for the runtime to request a valid cart mutation without trusting merchant-authored price/stock.

## 11. Product media

Product media must resolve through an authorized media path compatible with the app/store context.

Requirements:
- no protected internal filesystem path leaked;
- no cross-tenant media access;
- appropriate cache/CDN strategy;
- revoked/unpublished media behavior;
- image variants/sizing as future optimization.

This contract should reuse/follow the hardened Commerce media architecture rather than create App Builder-specific product media storage.

## 12. Search

### `commerce.search`

Search is a typed resource, not arbitrary query language.

Candidate inputs:
- normalized query text;
- category/facet filters;
- sort;
- pagination.

Server applies:
- tenant/channel publication;
- permissions;
- market;
- searchable fields;
- safe limits.

Do not allow raw SQL/Elasticsearch/OpenSearch expressions from App Schema.

## 13. Pricing

Pricing returned to the app is **displayable authoritative server output for the current context**, subject to final validation again during cart/checkout mutations.

Resource responses may include:
- current display price;
- compare-at/original price where business rules support it;
- currency;
- promotion/discount presentation;
- price range for variants.

Do not expose:
- product cost unless a separate authorized internal capability exists outside customer app;
- arbitrary price-list internals;
- server pricing formulas;
- sensitive discount rules unnecessarily.

The runtime never computes final payable totals as authority.

## 14. Inventory / availability

Customer app receives an appropriate availability model, not unrestricted inventory records.

Candidate states:
- available;
- unavailable;
- low-stock messaging if merchant/business policy supports it;
- quantity availability only if deliberately exposed.

Do not expose warehouse stock internals by default.

Cart/checkout revalidate current availability because displayed data may become stale.

## 15. Cart

### `commerce.cart`

Returns authoritative current cart state.

Candidate result:
- cart identity/reference safe for client use;
- lines;
- authoritative unit/display prices;
- quantities;
- discounts/promotions;
- subtotal;
- tax where applicable;
- shipping estimate/state where applicable;
- grand total/current payable summary;
- validation messages;
- checkout readiness.

Cart writes happen through Action Registry.

Runtime must not recompute authoritative totals from line display data.

## 16. Guest and authenticated cart

The data contract must explicitly support the approved identity lifecycle:

```text
anonymous app session
 -> guest cart
 -> authentication
 -> deterministic server-controlled merge/claim policy
 -> customer cart
```

Exact merge policy is an Open Decision until current Cart backend behavior is reviewed.

Never merge carts solely by trusting a client-supplied customer ID.

## 17. Checkout read model

Checkout resource exists only after a trusted checkout session/context is created.

Candidate data:
- authoritative cart snapshot/current state;
- customer/guest requirements;
- addresses;
- eligible shipping methods;
- eligible payment methods;
- totals;
- validation blockers;
- session state/expiry.

Checkout creation/mutation belongs to Action Registry.

## 18. Shipping/delivery

### `commerce.shippingMethods`

Eligibility is server-derived from:
- tenant/store/channel;
- address/region;
- cart/items;
- configured shipping rules;
- provider availability;
- other business constraints.

Client cannot author shipping price/eligibility.

Pickup/delivery location data, if supported, follows the same rule.

## 19. Payment methods

### `commerce.paymentMethods`

Returns safe display/eligibility metadata:
- method identifier/reference;
- localized label;
- icon/brand metadata;
- availability;
- trusted flow type/capability requirement.

Never return:
- provider secret key;
- private signing credential;
- unrestricted merchant gateway credential.

Payment execution belongs to trusted actions/backend/native capability.

## 20. Customer profile

### `customer.profile`

Authentication required.

Returns minimum customer-facing account data needed by app.

Do not expose internal ERP notes, credit/accounting fields, sensitive administrative metadata or unrelated customer records.

Profile mutation uses registered actions/endpoints with validation.

## 21. Customer addresses

### `customer.addresses`

Authentication required.

Returns only addresses belonging to authenticated customer within current authorized tenant/customer relationship.

Address IDs are references, not authorization.

## 22. Orders

### `customer.orders`

Authentication required.

Returns current customer's authorized orders under the current tenant/store relationship.

Candidate summary:
- order reference/number safe for customer;
- date;
- status;
- total/currency;
- fulfillment/shipping summary where appropriate.

### `customer.order`

Returns authorized customer-facing order detail.

Do not expose:
- internal accounting journal details;
- cost/margin;
- employee/internal notes;
- other customer's information;
- sensitive provider internals.

A guessed OrderRef must not reveal whether another customer's order exists.

## 23. Payment/order state freshness

Payment and order status can change asynchronously.

Resources should support appropriate refresh/revalidation and event/push-triggered refresh where future architecture supports it.

A stale cached “pending” or “paid” UI is not business authority.

Backend remains source of truth.

## 24. Promotions

Promotion presentation comes from Commerce rules/results.

App Builder may choose where to present eligible promotion content, but cannot define authoritative eligibility merely through a visual component.

Future app-only promotions should be represented as explicit Commerce channel/campaign rules, not hidden schema arithmetic.

## 25. Pagination and limits

Collection resources use bounded pagination/cursors.

Requirements:
- server maximum page size;
- stable safe sort;
- no unbounded “return all products/orders” request;
- runtime supports loading/next-page/error states.

This protects performance and tenant infrastructure.

## 26. Filtering and sorting

Each resource publishes an allowlisted filter/sort contract.

Example product filters may include category, availability, price range or supported facets only when backend supports them safely.

Schema cannot send arbitrary field/operator expressions.

## 27. Field minimization

Use purpose-built DTO/read models.

Do not serialize entire Laravel/domain models into customer apps.

Benefits:
- prevents accidental sensitive-field leakage;
- stable mobile contract;
- smaller payloads;
- clearer compatibility;
- easier caching.

## 28. Caching

Cache policy belongs to Resource Definition/server/runtime policy, not arbitrary merchant choice.

Cache keys must include every security/business dimension that can change the result, such as applicable:
- tenant;
- app/store/channel;
- market/locale;
- authenticated customer where personalized;
- resource/parameters;
- version/authorization context.

Never share personalized/customer cart/order cache across users.

Pricing/availability/cart/checkout require conservative freshness policies.

## 29. Offline/stale behavior

V1 may display safely cached catalog/content where policy allows.

UI must distinguish stale/error states where correctness matters.

Do not allow stale cache to authorize:
- checkout;
- payment;
- stock commitment;
- final price;
- order state mutation.

## 30. Preview data modes

Preview resource policy supports the previously approved modes:

1. **Sample Data**
2. **Tenant Read Data**
3. **Test/Sandbox Commerce**

Shared preview must not automatically expose customer PII.

Preview Session policy determines which resource modes are allowed.

## 31. Tenant Isolation

Non-negotiable tests/rules:
- server derives tenant scope;
- cross-tenant ProductRef/CategoryRef/OrderRef/CartRef cannot escape scope;
- customer resources verify authenticated ownership;
- cache isolation;
- media isolation;
- pagination cursors cannot be replayed across tenant/security contexts;
- resource errors do not leak foreign object existence.

## 32. Channel/publication isolation

A product existing in AWJ ERP does not imply it is available in every sales channel.

Resources respect:
- publication state;
- SalesChannel;
- Storefront/app relationship;
- market/locale rules;
- other Commerce eligibility.

App Builder cannot bypass these through binding parameters.

## 33. Localization

Resources should return localized business content according to an explicit locale/fallback contract.

Arabic and English are first-class.

App Schema localized presentation content and Commerce localized business content remain separate concerns.

## 34. Error model

Typed resource states:
- loading;
- success;
- empty;
- validation error;
- unauthenticated;
- unauthorized;
- not found;
- conflict/stale where applicable;
- rate limited;
- retryable network/server error;
- incompatible capability.

Sensitive errors are sanitized.

## 35. Observability

Capture safe resource telemetry:
- resource type/version;
- app/runtime/experience version;
- latency;
- outcome;
- pagination/cache behavior;
- correlation ID;
- internally scoped tenant/app identity.

Redact tokens, payment secrets and unnecessary PII.

## 36. Rate limiting and abuse

Public/anonymous resources require abuse controls.

Consider:
- app/store context;
- IP/device/session signals where appropriate;
- endpoint/resource cost;
- search abuse;
- pagination scraping;
- auth/customer limits.

Rate limiting must not become cross-tenant shared-state leakage.

## 37. Compatibility

Resource Definition is versioned.

Breaking response/semantic changes require versioning/migration policy.

Published experiences declare compatible resource capability requirements through runtime/schema compatibility.

Do not silently change a field's meaning while keeping the same contract version.

## 38. Security classification

Each resource should declare data classification, e.g.:
- public commerce;
- authenticated customer;
- sensitive customer;
- checkout-sensitive;
- internal-only (not available to customer app).

Internal ERP resources are excluded unless deliberately exposed through a safe mobile DTO.

## 39. Explicit V1 exclusions

- raw database/model access;
- arbitrary REST/GraphQL URL;
- unrestricted internal ERP reports;
- cost/margin/supplier cost;
- arbitrary customer lookup;
- other tenants' data;
- merchant secrets;
- payment-provider credentials;
- raw accounting journal data;
- unrestricted warehouse internals;
- client-selected tenant scope.

## 40. Commerce API readiness dependency

Before locking each resource, inspect current AWJ APIs and classify:

- **Ready** — safe contract already exists;
- **Ready with hardening** — reusable after bounded fixes;
- **Missing** — requires new mobile/public Commerce contract;
- **Blocked** — dependent architecture/business decision unresolved.

Do not build a second App-Builder-only business service merely to hide a missing Commerce API.

## 41. Required readiness evidence per resource

For each selected V1 resource document:
- current endpoint/service evidence;
- auth model;
- tenant resolution;
- channel/publication behavior;
- DTO fields;
- pagination;
- localization;
- caching;
- error contract;
- tests;
- cross-tenant negatives;
- known gaps.

This becomes `COMMERCE_MOBILE_API_READINESS.md`.

## 42. Open decisions

- exact resource names/version syntax;
- current Commerce API reuse vs new `/store/mobile/v1`-style contract;
- guest app/session identity;
- cart guest→customer merge semantics;
- market/currency model;
- price-list/channel resolution;
- inventory availability granularity;
- checkout session read model;
- shipping provider abstraction;
- payment-method eligibility DTO;
- order/customer API scope;
- promotion/coupon read models;
- product facet/search backend;
- cursor format/security;
- cache TTL/invalidation;
- app-only merchandising/promotion representation.

## 43. Acceptance criteria

DATA_RESOURCE_REGISTRY_V1 can be implementation-locked when:

1. every V1 data-bound component maps to a typed registered resource;
2. every resource has explicit auth/security classification;
3. tenant/store/channel scope is server-resolved;
4. no client parameter can expose unpublished/cross-tenant/internal data;
5. pricing/availability/cart/checkout remain server-authoritative;
6. customer/order ownership checks are explicit;
7. cache/pagination cannot cross security boundaries;
8. representative Product → Product Detail → Cart data flow is defined;
9. Preview data policy is defined;
10. `COMMERCE_MOBILE_API_READINESS.md` provides repository evidence for every V1 resource before implementation.
