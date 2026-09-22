# AWJ Mobile Runtime Proof Horizon V1

**Status:** READY FOR REVIEW / horizon authorization candidate  
**Prepared:** 2026-09-22  
**Base:** `main@6708c5f1dd481040d4b10a1c2aa6406d0723bb9c`  
**Process:** نظام الأفق / AWJ Autonomous Engineering Horizon

## 1. Objective

Prove that AWJ can run a trusted, native mobile commerce runtime on iOS and Android that consumes the completed `/commerce/v1` boundary and can later become the execution layer for App Builder experiences.

This is a **runtime proof**, not the full App Builder, not the App Factory, and not a production store release.

## 2. Inputs already proven

This horizon starts from repository evidence, not from zero:

- Commerce Mobile API Readiness V1 is closed.
- `/commerce/v1` has a machine-checked OpenAPI 3.1 contract.
- Guest and authenticated end-to-end commerce journeys exist.
- Catalog/media/variants/UOM/auth/profile/cart identity/addresses/order history/i18n/shipping/payment-intent V1 are already closed.
- Promotions remain explicitly deferred.
- App Builder architecture already fixes the boundary:
  `Builder -> Versioned App Schema -> validation/compatibility -> Trusted Mobile Runtime -> native UI`.
- AWJ Commerce Core remains business truth. Runtime/schema must not duplicate pricing, stock, payment, order, tenant or authorization rules.

## 3. External Evidence — current official sources

### Flutter

Flutter remains the preferred proof candidate, but this horizon must prove it rather than assume it.

Official Flutter documentation confirms:
- first-class localization infrastructure and locale-driven LTR/RTL direction;
- Router-based navigation is appropriate for apps with deep-link requirements;
- deep links are supported on iOS and Android;
- accessibility is a first-class framework concern and should be tested with VoiceOver/TalkBack and large text.

Sources:
- https://docs.flutter.dev/ui/internationalization
- https://docs.flutter.dev/ui/navigation
- https://docs.flutter.dev/ui/navigation/deep-linking
- https://docs.flutter.dev/ui/accessibility
- https://docs.flutter.dev/ui/accessibility/assistive-technologies

### iOS trust/platform integration

Apple Universal Links require an app↔website association and Apple explicitly treats incoming link parameters as an attack surface that must be validated. Keychain is the platform facility for small secrets/session material.

Sources:
- https://developer.apple.com/documentation/Xcode/allowing-apps-and-websites-to-link-to-your-content
- https://developer.apple.com/documentation/Xcode/supporting-universal-links-in-your-app
- https://developer.apple.com/documentation/security/keychain-services

### Android trust/platform integration

Android App Links use verified HTTP(S) associations through Digital Asset Links. Android Keystore protects cryptographic key material and supports restrictions on key use.

Sources:
- https://developer.android.com/training/app-links/verify-applinks
- https://developer.android.com/privacy-and-security/keystore

### Push proof

Firebase Cloud Messaging has a documented Flutter integration across iOS/Android, including foreground/background/terminated handling and platform permission requirements. This is evidence for a feasible proof path, **not** authorization to make Firebase the permanent AWJ Messaging provider.

Sources:
- https://firebase.google.com/docs/cloud-messaging/flutter/get-started
- https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages

## 4. AWJ architecture decisions for this horizon

### MR-01 — Flutter-first proof, fallback preserved

Build the proof in Flutter.

Flutter is **not yet declared irreversible platform lock-in**. React Native remains the fallback only if a material proof gate fails and evidence shows the failure is architectural rather than a local implementation defect.

Changing the runtime family after material implementation is a Decision Gate.

### MR-02 — New bounded mobile runtime workspace

The proof should live in a clearly isolated mobile workspace in this repository (exact path chosen after targeted repo inspection, with `mobile/` preferred if no conflict exists).

Do not mix runtime code into `web/` or `storefront/`.

### MR-03 — Commerce contract is authoritative

The runtime consumes the existing `/commerce/v1` contract.

Do not:
- create a parallel mobile commerce backend;
- copy pricing/stock/payment/shipping rules into Dart;
- let schema select tenant authority;
- let client state mark an order/payment authoritative.

### MR-04 — Small versioned App Schema proof

Prove a deliberately small AWJ-owned declarative schema:

```text
App Schema
 -> schemaVersion / minRuntimeVersion
 -> page definitions
 -> approved component instances
 -> typed props/bindings
 -> allowlisted actions
 -> navigation
 -> theme tokens
 -> compatibility/fallback
```

V1 proof components are bounded to what is needed for:
- Home
- Product
- Cart

Candidate component registry:
- Page
- Section
- Text
- Image
- ProductList
- ProductCard
- ProductDetail
- Price
- VariantSelector
- Quantity
- AddToCart
- CartList
- CartSummary
- Button
- Navigation target

No arbitrary executable code, arbitrary HTTP, arbitrary package loading, SQL, tenant switching, secret-bearing schema fields, or remote expressions with general code semantics.

### MR-05 — Action Registry

Proof only a minimal typed allowlist:
- navigate
- openProduct
- addToCart
- updateCartQuantity
- removeCartItem
- refresh

Sensitive server-authoritative actions stay behind Commerce API behavior. Schema describes intent; runtime validates and dispatches.

### MR-06 — State separation

Keep separate:
1. server-authoritative Commerce data;
2. published/fixture experience configuration;
3. navigation parameters;
4. ephemeral UI state;
5. sensitive local session material.

No local UI value can become business authority.

### MR-07 — Secure session material

Customer/cart/order session material must be behind a platform-secure-storage abstraction backed by iOS Keychain / Android secure keystore-backed storage.

No tokens in:
- App Schema;
- logs;
- analytics events;
- deep-link query strings;
- plain shared preferences;
- committed fixtures.

### MR-08 — Deep links

Prove:
- product link;
- order/status or account-safe navigation link if contract permits.

Use Universal Links / Android App Links direction. Validate host/path/parameters and map only to allowlisted navigation. A deep link must never directly execute destructive/sensitive actions.

### MR-09 — Push boundary

Prove a provider adapter boundary and one safe notification-to-navigation path.

FCM may be used as the proof transport if required by implementation, but this does not make Firebase the permanent AWJ Messaging architecture and must not create feature-specific business notification logic.

Any permanent messaging/provider choice is a Decision Gate.

### MR-10 — Localization

Proof:
- Arabic default;
- English;
- RTL/LTR;
- `Accept-Language` aligned with the existing Commerce API locale contract;
- runtime/theme/layout remain direction-safe;
- no duplicated business translation authority.

### MR-11 — Accessibility

Proof must include:
- semantic labels for interactive controls;
- VoiceOver/TalkBack smoke path;
- large text resilience;
- touch target and focus/navigation sanity;
- no direction-only meaning.

### MR-12 — Build proof

Horizon must prove release-mode buildability for both Android and iOS as far as available CI/tooling permits.

A successful local/simulator debug run alone is insufficient.

Store signing, merchant certificates, App Store/Play submission and production release are **outside this horizon** and remain owner-gated.

## 5. Runtime proof vertical slice

The minimum runtime flow:

```text
Boot
 -> resolve runtime/schema compatibility
 -> Arabic/English shell
 -> Home from App Schema
 -> product list from /commerce/v1
 -> Product screen
 -> media + variant/UOM where applicable
 -> authoritative price/availability
 -> Add to Cart
 -> Cart read/update/remove
 -> persist/recover permitted session material securely
 -> deep-link into a supported screen
 -> push interaction routes through the same validated navigation boundary
```

Checkout/payment UI is not required to make this proof pass unless implementation evidence shows it is necessary to validate a runtime primitive. Commerce checkout remains covered by the completed API horizon.

## 6. Compatibility contract

Every schema must declare compatibility metadata.

Runtime behavior:
- supported schema -> render;
- unsupported optional component -> deterministic safe fallback;
- unsupported required capability -> fail closed to a controlled incompatible-experience screen/state;
- newer schema must not silently execute unknown actions;
- unknown component/action/property with security significance is rejected;
- fallback must never bypass auth, tenant, pricing, stock, payment or order authority.

Proof fixtures must include:
- current schema;
- older compatible schema;
- unknown optional component;
- unknown required component/action;
- too-new schema/runtime requirement;
- malformed schema.

## 7. Quality Gates

### Gate A — Repository/runtime foundation
- Flutter project/workspace isolated and documented.
- pinned SDK/dependency strategy.
- lint/analyze/test commands documented.
- no unrelated repo refactor.

### Gate B — Schema + Registry
- versioned schema parser/validator;
- typed Component Registry;
- typed Action Registry;
- compatibility/fallback tests;
- malicious/unknown input negatives.

### Gate C — Commerce integration
- generated or strongly typed client based on the committed OpenAPI contract where practical;
- no manually invented alternate API shapes;
- tenant/channel remain server-resolved;
- error envelope handled explicitly;
- Home/Product/Cart proof green.

### Gate D — Security
- secure token/session abstraction;
- no token logging;
- deep-link input validation;
- no arbitrary URL/action execution;
- cross-tenant authority cannot be supplied by schema/runtime;
- negative tests.

### Gate E — i18n/accessibility
- ar/en;
- RTL/LTR;
- large text;
- semantics;
- VoiceOver/TalkBack smoke evidence where executable.

### Gate F — Native capability proof
- verified-link configuration/validation path documented;
- push adapter proof;
- lifecycle handling for foreground/background/open-from-notification where applicable.

### Gate G — Build
- Android release build;
- iOS release/archive build to the maximum non-signing level available;
- no production signing/release required;
- build instructions reproducible.

### Gate H — Final runtime evidence
- representative device/simulator proof;
- startup/runtime errors captured;
- binary/build observations recorded;
- known limitations explicit;
- Flutter viability conclusion based on evidence.

## 8. Task queue — dependency safe

| Order | ID | Task | Depends on | Outcome |
|---|---|---|---|---|
| 1 | MOBILE-RUNTIME-1 | Flutter workspace + toolchain proof | horizon authorization | reproducible shell, tests/analyze/build baseline |
| 2 | MOBILE-RUNTIME-2 | App Schema + compatibility kernel | 1 | parser/validator/version/fallback |
| 3 | MOBILE-RUNTIME-3 | Component + Action Registry | 2 | allowlisted typed rendering/actions |
| 4 | MOBILE-RUNTIME-4 | Commerce OpenAPI client + auth/session boundary | 1 | typed client + secure session abstraction |
| 5 | MOBILE-RUNTIME-5 | Home/Product/Cart vertical UI | 3,4 | real Commerce-backed proof |
| 6 | MOBILE-RUNTIME-6 | ar/en + RTL/LTR + theme/accessibility | 5 | direction/accessibility proof |
| 7 | MOBILE-RUNTIME-7 | Universal/App Links | 3,5 | validated product/navigation deep links |
| 8 | MOBILE-RUNTIME-8 | Push adapter + notification routing proof | 3,7 | provider-bounded push/navigation |
| 9 | MOBILE-RUNTIME-9 | Android/iOS release-build proof | 6,7,8 | reproducible native build evidence |
| 10 | MOBILE-RUNTIME-10 | Final compatibility/security/runtime evidence | 9 | closure report + Flutter viability verdict |

Tasks may be split into smaller PRs when evidence warrants it. Dependent work does not unlock until predecessor Post-Merge Review passes.

## 9. Definition of Done

The horizon is complete only when all of the following are evidenced:

- Flutter runtime starts and renders an AWJ versioned schema.
- Component and Action Registries are allowlisted and tested.
- Home/Product/Cart consume real `/commerce/v1` contracts.
- server remains authority for commerce/tenant/security.
- secure local session storage boundary exists.
- Arabic/English and RTL/LTR pass.
- deep link proof passes on iOS/Android configuration path.
- push adapter/navigation proof passes without making a permanent messaging-provider decision.
- accessibility evidence exists.
- Android and iOS release-mode build proof exists within available non-production credentials.
- compatibility/fallback negatives pass.
- final security/Guardian review passes.
- exact-Head CI passes before every merge.
- Post-Merge Review passes after every merge.
- durable final implementation report is committed.
- no production deploy, App Store/Google Play submission, signing ownership change or paid provider commitment occurs without Safwan approval.

## 10. Decision Gates

Stop and ask Safwan only for material decisions, especially:
- Flutter fails a material architecture proof and switching runtime family is proposed;
- permanent push/messaging vendor commitment;
- payment provider/native payment SDK commitment;
- Apple/Google account ownership/signing/release;
- new production secrets/credentials;
- breaking `/commerce/v1` change;
- destructive migration;
- major App Schema capability expansion;
- production deploy/release.

Routine package selection is autonomous only when license, maintenance, security and scope are acceptable and it does not create a strategic lock-in.

## 11. Explicitly out of scope

- full App Builder web editor;
- full App Factory;
- merchant signing/account automation;
- production App Store / Google Play submission;
- production rollout;
- arbitrary merchant code/packages;
- arbitrary HTTP actions;
- payment-provider selection;
- full checkout UI unless needed by a runtime primitive;
- promotions;
- offline-first commerce;
- analytics platform;
- permanent Messaging provider;
- large design-system redesign.

## 12. Claude execution rule

Once this horizon documentation is merged and Gate 11 for the preceding Horizon-System PR is closed, Claude Code may execute continuously under نظام الأفق:

```text
latest main
 -> read CLAUDE.md
 -> read docs/autonomous-engineering/00-START-HERE.md
 -> read AWJ-HORIZON-SYSTEM.md
 -> read this horizon
 -> inspect only evidence needed for MOBILE-RUNTIME-1
 -> implement/review/Guardian/test/CI
 -> PRE_MERGE_REVIEW on exact Head
 -> merge under standing authority
 -> POST_MERGE_REVIEW
 -> durable state
 -> next dependency-ready task
```

Do not rediscover the entire repository. Do not wait for “استمر” between routine tasks. Stop at a genuine Decision Gate or Horizon End.
