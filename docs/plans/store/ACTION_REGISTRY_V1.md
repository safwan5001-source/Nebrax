# AWJ Action Registry V1 — Contract Draft

**Status:** Draft implementation-facing contract  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Related:** `APP_SCHEMA_V1.md`, `COMPONENT_REGISTRY_V1.md`

## 1. Purpose

The Action Registry defines every operation an AWJ mobile experience may request from a component event.

Core flow:

```text
Trusted Component Event
 -> Registered Action
 -> Validate typed inputs
 -> Check runtime capability
 -> Check authentication/authorization
 -> Execute locally OR call tenant-scoped AWJ backend
 -> Typed result
 -> Allowed navigation/state/UI effect
```

An action is a request to an approved capability. It is never a mechanism for merchant-authored arbitrary code.

## 2. Core authority rule

Client/runtime/App Schema is never authoritative for:
- tenant;
- price;
- tax;
- discount eligibility;
- inventory availability;
- payment success;
- order status;
- customer authorization;
- accounting outcome.

Sensitive commerce actions send intent and references to AWJ backend; the backend re-resolves and validates authoritative business state.

## 3. Action Definition

Conceptual metadata:

```json
{
  "type": "commerce.cart.add",
  "version": 1,
  "riskClass": "commerceMutation",
  "input": {},
  "result": {},
  "auth": "optional-or-required",
  "idempotency": "required",
  "nativeCapability": null,
  "allowedEvents": ["tap"],
  "compatibility": {}
}
```

Exact syntax remains open.

## 4. Risk classes

### A — Local UI
Examples:
- open/close sheet;
- select local tab;
- set bounded UI state.

No server business mutation.

### B — Navigation
Examples:
- open page;
- open product/category/cart/account.

Destination/parameters validated.

### C — Read capability
Triggers an approved resource refresh/read. Backend authorization applies.

### D — Commerce mutation
Examples:
- cart add/update/remove;
- apply/remove coupon where supported;
- save address where supported.

Requires server authority and usually idempotency/concurrency handling.

### E — Sensitive commerce
Examples:
- checkout create/confirm;
- payment initiation/confirmation;
- order cancellation/refund/reorder where supported;
- account-security-sensitive operation.

Requires explicit backend policy, stronger audit and potentially re-authentication/confirmation.

### F — External integration
Future/controlled integrations only. Not arbitrary client HTTP.

## 5. Event-to-action binding

A component emits a typed event; schema maps it to an allowed action.

Example:

```text
productCard.itemTap(productRef)
  -> navigation.openProduct(productRef)
```

or:

```text
addToCart.tap(productRef, selectedOptionRefs, quantity)
  -> commerce.cart.add(...)
```

Component events cannot fabricate privileged action types unavailable in registry.

## 6. Input sourcing

Allowed input sources may include:
- literal safe configuration;
- current bound item/reference;
- navigation parameter;
- approved local state;
- authenticated-session context resolved by runtime/backend;
- previous typed action result where explicitly supported.

Forbidden as authority:
- client-supplied tenant ID;
- client-supplied authoritative price/tax/discount;
- “payment succeeded” boolean from schema;
- arbitrary customer/user ID used to bypass authorization;
- raw secret/token.

## 7. Navigation actions — V1 candidates

- `navigation.openPage`
- `navigation.openProduct`
- `navigation.openCategory`
- `navigation.openCart`
- `navigation.openCheckout`
- `navigation.openAccount`
- `navigation.openOrders`
- `navigation.openOrder`
- `navigation.back`
- controlled external/deep-link action if approved by policy

Incoming/outgoing links are validated against destination policy.

## 8. UI/state actions — V1 candidates

- `ui.openSheet`
- `ui.closeSheet`
- `ui.showMessage`
- `state.setLocal`
- `state.toggleLocal`
- `resource.refresh`

State writes are bounded by declared state schema and cannot alter business authority.

## 9. Cart actions — V1 candidates

### `commerce.cart.add`

Intent inputs:
- product/reference;
- variant/option/unit references as required by product contract;
- requested quantity;
- optional safe source/context metadata.

Server revalidates:
- tenant/channel;
- product publication;
- purchasability;
- selected configuration;
- quantity;
- inventory rules;
- authoritative price;
- promotion eligibility;
- cart/customer context.

Result returns authoritative cart state or typed mutation result.

### `commerce.cart.updateQuantity`

Client requests target line/reference + quantity. Backend revalidates line ownership, limits, stock and pricing.

### `commerce.cart.remove`

Backend verifies current cart/line context.

### `commerce.cart.clear`

Requires explicit confirmation UX if exposed.

No component directly edits an authoritative local cart total.

## 10. Coupon/promotion actions

Candidate:
- `commerce.cart.applyCoupon`
- `commerce.cart.removeCoupon`

Client submits coupon intent/code. Backend decides validity, scope, dates, customer eligibility, minimums, stacking and resulting totals.

Schema cannot define “20% accepted” as business truth.

## 11. Authentication/account actions

Candidate capabilities:
- `auth.signIn`
- `auth.signOut`
- `auth.register`
- approved recovery/verification flows;
- `account.openProfile` via navigation where appropriate.

Authentication secrets/tokens are handled by trusted auth/runtime storage, not App Schema/state.

Sign-out must clear/revoke local session material according to auth contract.

## 12. Checkout actions

Checkout is a trusted commerce boundary.

Candidate flow:

```text
commerce.checkout.start
 -> server resolves authoritative cart
 -> validates customer/guest eligibility
 -> shipping/delivery requirements
 -> pricing/tax/promotions
 -> payment-method eligibility
 -> returns checkout session/state
```

Schema may choose presentation entry points but cannot replace checkout validation.

## 13. Payment actions

Payment actions are AWJ-owned sensitive capabilities.

Conceptual flow:

```text
commerce.payment.initiate
 -> backend creates/authorizes provider flow
 -> trusted native/web payment capability if required
 -> provider result
 -> backend/provider verification
 -> authoritative payment/order state
```

Client callback alone is never proof of successful payment.

Required controls:
- server-side provider verification;
- idempotency;
- duplicate-submit protection;
- correlation IDs;
- explicit failure/cancel/pending states;
- no provider secret in schema/logs;
- native-impact classification for SDK/entitlement changes.

Exact payment actions wait for Commerce Mobile API Readiness.

## 14. Order actions

Read actions are Data Resources; mutations are explicit actions.

Potential V1/later depending backend readiness:
- `commerce.order.cancel`
- `commerce.order.reorder`

Cancellation:
- backend checks order/customer/tenant/status/time/policy;
- UI cannot promise cancellation before server result.

Reorder:
- does not blindly clone old price/stock;
- backend reconstructs purchasable items under current catalog/pricing/availability rules.

Refund remains outside generic merchant-app V1 action unless a deliberate customer-facing refund workflow is approved.

## 15. Address/shipping actions

Potential:
- save/update/delete customer address;
- select shipping/delivery method;
- choose pickup location.

Backend validates ownership, supported region/service and current checkout eligibility.

A local selected shipping fee is not authoritative.

## 16. Search actions

Search is primarily a typed Data Resource/query interaction.

UI may update search state and request `commerce.search` resource results.

Do not turn search text into arbitrary backend query language.

## 17. Deep links and push-triggered actions

Deep link/push payload requests a registered navigation/action intent.

It does not grant authorization.

Example:

```text
push: open order 123
 -> parse safe route/reference
 -> authenticate if needed
 -> backend verifies customer can access order 123
 -> open result or safe denial
```

Never trust tenant/customer/order authority merely because IDs came from a signed push provider.

## 18. Idempotency

Required for actions where duplicate execution can create harmful or confusing side effects.

At minimum evaluate:
- cart mutation;
- checkout session creation;
- payment initiation/confirmation;
- order creation;
- cancellation;
- other externally side-effecting operations.

Runtime/backend contract should support stable operation/idempotency keys tied to authenticated context and action semantics.

Retry after timeout must not blindly duplicate payment/order effects.

## 19. Concurrency

Backend remains responsible for concurrency.

Examples:
- inventory changes after product display;
- cart modified from another session;
- promotion expires;
- price list changes;
- duplicate taps;
- payment callback races.

Actions return typed current authoritative state/conflict where appropriate.

Do not solve races only by disabling a button client-side.

## 20. Confirmation and re-authentication

Action Definition can declare UX/security requirements:
- confirmation;
- destructive warning;
- authentication required;
- recent authentication/re-authentication where future policy requires;
- biometric/native confirmation only as an approved trusted capability.

Merchant schema cannot remove mandatory confirmation from high-risk actions.

## 21. Action result model

Typed outcomes should distinguish:
- success;
- validation error;
- unauthenticated;
- unauthorized;
- not found;
- conflict;
- unavailable/out of stock;
- payment pending;
- payment failed/cancelled;
- retryable network/server failure;
- incompatible capability.

Do not collapse every failure into “Something went wrong”.

User-safe messaging and developer diagnostics are separate.

## 22. State effects

Actions may return allowed effects:
- update resource cache from authoritative response;
- set bounded UI state;
- navigate;
- show safe feedback;
- require authentication;
- request retry.

A merchant cannot configure a payment-success action to locally mark an order paid.

## 23. Offline behavior

V1 does not provide offline-authoritative commerce mutation.

Local UI actions can work offline.

Commerce mutations may queue only if a specific future action contract explicitly defines safe semantics. Payment/order actions should fail safely rather than silently queue by default.

## 24. External URLs/integrations

Baseline V1 does not expose generic:
`http.request(url, headers, body)`

Future integration actions must be server-mediated through registered AWJ integration capabilities with:
- allowlisted provider;
- secret isolation;
- tenant authorization;
- timeout/retry policy;
- audit;
- data minimization.

## 25. Native actions

Native capabilities such as:
- push permission;
- camera;
- location;
- share;
- wallet/payment SDK;
- biometric auth

must be separately registered and compatibility-classified.

Using a capability not present in installed runtime can require native release.

Permissions are requested contextually, not merely because schema lists them.

## 26. Tenant Isolation

Every backend action derives tenant from trusted authenticated/host/app context.

Requirements:
- no action accepts tenant ID as authorization;
- app relation validated server-side;
- object IDs/references scoped to tenant/customer;
- cross-tenant references return safe denial/404 according to AWJ policy;
- caches/idempotency keys include correct security scope;
- logs do not leak cross-tenant existence.

## 27. Preview policy

Preview action policy is stricter than production app capability.

Default:
- local UI/navigation allowed;
- safe reads allowed with authorized preview context;
- production-sensitive mutations blocked;
- test/sandbox commerce used where available;
- any allowed production mutation must be separately explicit, authorized and visibly marked.

Preview schema cannot flip a flag to bypass this policy.

## 28. Authorization layering

Four independent checks:

1. **Builder authorization** — may merchant configure this action?
2. **Publish validation** — is binding/action structurally and compatibly valid?
3. **Runtime capability** — does installed runtime support it?
4. **Backend authorization** — may this authenticated actor perform this operation now?

Passing earlier layers never substitutes for backend authorization.

## 29. Observability/audit

For relevant actions capture safe metadata:
- app/experience/runtime version;
- action type/version;
- correlation/operation ID;
- tenant/app context internally;
- outcome/error class;
- latency;
- external provider correlation where safe;
- actor/customer reference according to privacy policy.

Sensitive actions receive stronger audit.

Never log:
- passwords;
- access/refresh tokens;
- payment credentials;
- provider secret keys;
- full sensitive payloads unnecessarily.

## 30. Compatibility

Action Definition declares minimum runtime capability/version.

If a Published Experience references an unsupported sensitive action:
- fail closed;
- show safe fallback/error;
- never reinterpret it as another action.

Publish should normally block incompatible action references before production.

## 31. Registry governance

New action requires:
- business purpose;
- risk class;
- typed input/result;
- auth requirement;
- idempotency/concurrency decision;
- Preview policy;
- native-impact classification;
- audit requirement;
- tests;
- security review for mutations/sensitive/integrations.

Avoid aliases with subtly different security semantics.

## 32. Testing requirements

Per action as applicable:
- schema/input validation;
- unauthenticated;
- unauthorized;
- tenant negative;
- customer/object ownership negative;
- idempotency;
- duplicate tap/retry;
- concurrency;
- stale price/stock;
- validation errors;
- provider pending/failure/cancel;
- Preview restriction;
- compatibility;
- audit/redaction.

Payment/order/security-sensitive tests cannot be reduced for speed.

## 33. Explicit V1 exclusions

- arbitrary executable action;
- arbitrary JavaScript/Dart callback;
- arbitrary HTTP request;
- direct database action;
- tenant switch action;
- client-side mark-as-paid;
- client-side authoritative discount/price/tax mutation;
- generic refund;
- unrestricted filesystem/process action;
- secret retrieval action;
- dynamic native package install.

## 34. Open decisions

Before implementation lock:
- exact action serialization;
- operation/idempotency key contract;
- cart identity/session behavior across guest → authenticated transition;
- checkout session lifecycle;
- payment provider abstraction and callback contract;
- address/shipping action inventory;
- order cancel/reorder V1 scope;
- push/deep-link action payload format;
- native permission/action registry;
- retry/backoff rules;
- optimistic UI boundaries;
- exact preview mutation matrix;
- action-level rate limiting;
- confirmation/re-auth policy.

## 35. Acceptance criteria

ACTION_REGISTRY_V1 can be implementation-locked when:

1. every V1 component event maps only to registered typed actions;
2. no action can grant tenant/customer/payment authority from client input;
3. Product → Cart representative flow revalidates authoritative commerce state;
4. Checkout/Payment contracts make server/provider verification mandatory;
5. duplicate/retry behavior is defined for side-effecting actions;
6. Preview cannot invoke production-sensitive mutations by schema choice;
7. cross-tenant/object-ownership negative tests are specified;
8. compatibility/native-impact behavior is explicit;
9. secrets never enter App Schema/general state/logs;
10. Commerce Mobile API Readiness confirms the backend endpoints/capabilities required by the selected V1 actions.
