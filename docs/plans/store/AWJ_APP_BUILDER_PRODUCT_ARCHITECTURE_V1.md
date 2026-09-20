# AWJ App Builder — Product & Architecture V1

**Status:** Active product/architecture documentation — evidence-first; not implementation authorization  
**Recovered/updated:** 2026-09-20  
**Scope:** AWJ merchant mobile-app platform, visual builder, developer workspace, preview/runtime, versioning, build/release lifecycle  
**Related baseline:** `AWJ_MOBILE_APP_BUILDER_BENCHMARK.md`

> This document recovers and consolidates the App Builder decisions made after the initial benchmark. It intentionally separates **External Evidence**, **AWJ Decision / Requirement**, and **Open Decision**. A proposal is not evidence, and an open item must not be guessed into an implementation contract.

---

## 0. Documentation rule — evidence first

For every material Product / Architecture / UX / Runtime / Release decision:

1. Prefer current first-party documentation, original repositories/specifications, and platform policy.
2. Compare multiple strong references when the decision is not platform-mandated.
3. Extract the best proven pattern, then evaluate whether it fits AWJ rather than copying it blindly.
4. Mark statements as:
   - **External Evidence** — directly supported by an identified source.
   - **AWJ Decision / Requirement** — AWJ's chosen direction.
   - **Open Decision** — not yet sufficiently evidenced or approved.
5. For fast-changing or sensitive areas — Apple/Google policies, signing, store release/update behavior, security, SDK/API capabilities — re-verify current official documentation before implementation.
6. Never turn an inference into a documented fact.

---

## 1. Vision & product foundation

### AWJ Decision

AWJ App Builder is a complete platform for merchants to **create, design, develop, preview, test, version, build, release, update and operate** branded iOS/Android commerce applications from AWJ.

It is not merely:
- a page/block editor;
- a WebView wrapper;
- a one-time app-generation service;
- or a second commerce administration system.

AWJ Commerce remains the source of truth for catalog, pricing, availability/inventory, customers, cart/checkout, orders, payments, shipping and related business data.

### Product layers

1. **Visual Builder** — merchant-friendly pages, sections/blocks/components, navigation, content, branding and live preview.
2. **Developer Workspace** — advanced data sources, controlled actions, state/variables, conditions, events, APIs/integrations, diagnostics, test data and future extension tooling.
3. **Trusted Mobile Runtime** — interprets an AWJ-owned declarative/versioned experience contract using shipped/approved capabilities.
4. **App Factory / Release System** — build, signing, validation, store submission, release/update lifecycle.

### Boundary

**Store Customizer ≠ App Builder ≠ App Factory.**

They may share brand/theme foundations and commerce data, but each has a distinct responsibility.

---

## 2. Benchmark/evidence direction

### External Evidence already captured in the baseline benchmark

The existing benchmark identifies useful patterns from:
- Salla — regional merchant journey, templates, preview and launch/publishing workflow.
- Zid — unified commerce administration rather than duplicating product/order/payment management inside the app tool.
- Tapcart — builder architecture, reusable blocks/components, extensibility, draft/version/publish concepts and developer tooling.
- OneMobile — merchant-friendly Screen → Blocks → Properties → Preview model.
- Shopney — live/device preview and separation between configurable experience changes and binary app updates.
- Vajro / Superfans — commerce widgets, navigation/content controls and scheduling.
- Shopify ecosystem — broad mature mobile-commerce ecosystem reference.
- Digia UI and other SDUI projects — schema/runtime/component/action/state architectural evidence, subject to license/maturity/security review.

### AWJ Requirement

Continue benchmarking strong regional products — including Salla, Zid, and other relevant platforms such as Wrd/ورد **only after the exact product is positively identified and its authoritative documentation is found**. Do not attribute features to an ambiguous product name.

No single competitor is the product specification. AWJ combines evidence with its own safety, tenancy, commerce and UX requirements.

---

## 3. Information architecture

### App Manager

Entry from Commerce Workspace should lead to an App Manager, not directly into an editor.

Target areas:
- Overview
- Apps
- Templates
- Versions / releases
- App-level settings

For an app:
- Overview
- Builder
  - Design
  - Develop
  - Preview
- Content
  - Pages
  - Navigation
  - Components
  - Assets
- Engagement
  - Push notifications
  - Campaigns
  - App-only promotions
  - Automations (subject to event/policy architecture)
- Testing / Preview
- Versions
- Release Center
  - iOS
  - Android
- Analytics
- Settings

### UX principle

Use progressive disclosure. A normal merchant should not be forced into an IDE. Advanced capabilities belong behind **Develop** while **Design** remains a clear visual workflow.

The builder is the center of editing, but it is not the whole product.

---

## 4. Builder workspace

### AWJ Requirement

The target workspace must support a professional end-to-end editing experience including:
- pages/screens tree;
- component/block palette;
- interactive canvas/device frame;
- selection and property inspector;
- drag/reorder/direct manipulation where appropriate;
- undo/redo/history;
- navigation;
- content/design/layout controls;
- data bindings;
- actions/events/conditions;
- visibility;
- issues/validation;
- logs/network/data/events diagnostics in Developer mode;
- draft/save/publish state;
- version awareness;
- preview entry points.

Conceptual layout only — **not locked UI**:

```text
┌───────────────────────────────────────────────────────────────┐
│ Apps / App   Draft/Saved        Undo/Redo   Preview  Publish │
├──────────────┬─────────────────────────────┬──────────────────┤
│ Pages        │ Interactive device/canvas   │ Inspector        │
│ Components   │                             │ Content          │
│ Layers       │                             │ Layout / Style   │
│              │                             │ Data / Actions   │
│              │                             │ Conditions       │
├──────────────┴─────────────────────────────┴──────────────────┤
│ Components | Data | Actions | Navigation | Issues | Console  │
└───────────────────────────────────────────────────────────────┘
```

### System vs custom pages

**AWJ Proposal — requires contract design:** distinguish commerce-critical system screens (for example product/cart/checkout/account/order flows) from custom content/landing pages. System capabilities must remain safe even when presentation is customizable.

---

## 5. App creation

### AWJ Decision

A new app must offer three starting paths:

1. **Use My Store Design**
2. **Choose a Template**
3. **Start From Scratch**

“Start from scratch” should still create the minimum safe commerce shell required by the selected AWJ commerce capabilities; it must not silently remove authentication/checkout/navigation contracts needed for a working app.

---

## 6. Shared store/app theme foundation

### AWJ Decision

**Use My Store Design** is a first-class option.

It does **not** mean “turn the website into a WebView” and does not require pixel-identical web/mobile layouts.

Core principle:

> Same brand can be shared; mobile UX remains mobile-appropriate.

Target architecture:

```text
              Shared Brand / Theme Foundation
                    /                 \
             Store Theme            App Theme
                |                       |
         Web components          Mobile components
                |                       |
          Web runtime             Mobile runtime
```

### Shareable concepts

Candidate shared inputs:
- logo/brand assets;
- brand colors;
- typography where mobile/platform-compatible;
- selected visual tokens;
- selected marketing assets/content;
- compatible section/component intent.

Commerce data is not copied for theme sync; store and app consume AWJ Commerce as the source of truth.

### Compatibility mapping

Store layout must not be copied blindly. A compatibility layer may map store concepts to mobile equivalents, for example desktop navigation to mobile navigation.

### Sync policy

Three conceptual modes are retained for design:
- **Linked** — safe supported inherited changes can follow shared brand/theme policy.
- **Review Changes** — preferred default direction; detect → diff → preview → selectively apply.
- **Independent** — app presentation becomes independent while commerce data remains shared.

Exact labels/behavior remain UX/contract work, not final API.

### Override tracking

Local app customization must not be silently overwritten by later store-theme changes.

The model must preserve the concept of:
- inherited value;
- app override;
- upstream store/shared-brand change;
- conflict;
- explicit resolution.

### Theme sync safety

For meaningful sync:
**Detect → Diff → Preview → Apply**

Conflicts should support a merchant-readable comparison such as:
- keep app value;
- use store/shared value;
- compare before applying.

---

## 7. Templates

### AWJ Direction

A template is more than colors/screenshots. It should be representable through the same app contract/runtime and may include:
- page definitions;
- component tree;
- navigation;
- theme defaults;
- content placeholders;
- commerce bindings;
- compatibility metadata.

Do not build a separate runtime per template.

---

## 8. Preview architecture

### AWJ Requirement

Preview is a core product capability, not a decorative phone screenshot.

Target maturity:
1. live canvas preview in Builder;
2. interactive device preview;
3. locale/direction/state/device controls as supported;
4. real-device preview through a safe mechanism such as QR/link/preview app;
5. test commerce flows where sandbox/test infrastructure exists;
6. push/deep-link testing before release where supported.

### Open Decision

Exact real-device preview mechanism remains open and must be benchmarked/evidenced before implementation.

---

## 9. Draft, versioning, publish and rollback

### AWJ Decision

Never edit the customer-visible published experience directly.

Conceptual lifecycle:

```text
Draft → Validate → Preview/Test → Publish → Published Experience Version
```

The platform must distinguish:
- draft;
- published experience;
- native application release/build.

Version records should eventually make it possible to know:
- who published;
- when;
- meaningful change set;
- runtime compatibility;
- whether a native build/release was required.

Rollback is a strong requirement but must be compatibility-safe; exact rollback semantics remain to be designed.

---

## 10. Experience contract / App Schema direction

### External Evidence

The existing benchmark documents production/reference patterns around:
- server-driven/declarative UI;
- versioned schemas;
- component registries;
- typed properties;
- controlled action catalogs;
- state/data binding;
- runtime compatibility.

Digia is useful architecture evidence but its current licensing must not be treated as cleared for AWJ dependency adoption.

### AWJ Decision

AWJ owns its Experience Contract/App Schema.

Preferred security direction:

```text
Builder
  ↓
Versioned declarative App Schema
  ↓
Validate + authorize + compatibility check
  ↓
Publish
  ↓
Trusted AWJ Mobile Runtime
  ├ Component Registry
  ├ Action Registry
  ├ Data Binding
  ├ State
  ├ Navigation
  ├ Theme
  └ Compatibility / fallback
  ↓
Native UI / shipped runtime capabilities
```

The server/configuration may describe approved experience behavior; it must not become an unrestricted remote-code execution channel for sensitive business logic.

### Explicitly not finalized

- JSON vs another serialized format;
- exact field names;
- exact expression language;
- Flutter vs React Native vs native;
- production SDUI dependency;
- exact runtime update envelope.

---

## 11. Component Registry

### AWJ Direction

Separate:

**Component Definition** — what a component is and what it permits.

**Component Instance** — a specific configured use of that component in an app/page.

A definition should conceptually be able to describe:
- stable identity/type;
- version/compatibility;
- capabilities;
- merchant-editable properties;
- property types/validation;
- data requirements;
- supported actions/events;
- child/content rules;
- accessibility metadata;
- runtime compatibility.

This enables a metadata-driven Inspector instead of hard-coding a separate editor UI for every component.

### Candidate official categories

- Commerce
- Content
- Layout
- Navigation

The final V1 component list remains open.

---

## 12. Controlled Action Registry

### AWJ Decision

Do not let remote schema inject arbitrary executable business logic.

Actions should resolve through allowlisted, validated capabilities. Candidate classes:
- commerce actions;
- navigation actions;
- UI actions;
- controlled state actions;
- integration actions under stricter policy.

Sensitive flows — payment, authentication, pricing/tax, tenant access, authorization, order mutation — remain governed by trusted AWJ backend/runtime behavior.

---

## 13. Data binding, state, events and conditions

### Evidence status

Research has begun but this section is **not closed**.

### AWJ Requirements already fixed

- no direct database access from merchant schemas;
- no tenant identifier supplied by a schema may override authenticated/host-resolved tenant context;
- data access must use tenant-scoped backend capabilities/resources;
- state/expressions must not become an escape hatch to arbitrary code execution;
- actions/events must be validated against authorization and runtime capability;
- sensitive business rules stay server-authoritative.

### Open Decision

Before locking the model, perform a dedicated evidence pass on mature data-binding/state/action/event/security designs. Do not invent an expression engine from competitor UI alone.

---

## 13A. Data Binding + State + Actions + Events + Security — Evidence Pass (2026-09-20)

### External Evidence

**Digia state scopes.** Digia documents distinct state lifetimes: global App State, immutable entity/page/component parameters, mutable page/component state, and local State Container state. It also binds state variables to widget properties and updates them through explicit state actions. This is useful evidence for scoped state/lifecycle rather than one undifferentiated global store.

**Digia actions/events.** Digia documents an Action Catalog grouped into state, navigation, API/data, UI, file/media and timing/events, with actions triggered by interactions or lifecycle events. This supports a typed/registered action model rather than arbitrary callback code.

**Android architecture.** Android's official app-architecture guidance stresses repositories and a defined source of truth. This reinforces AWJ's existing decision that Commerce Core remains authoritative and mobile UI state must not become a competing source of business truth.

**OWASP MASVS.** MASVS treats secure storage, cryptography, authentication/authorization, network communication, platform interaction, code/update safety, resilience and privacy as separate mobile security control groups. AWJ mobile architecture and testing should map to these categories rather than treating “mobile security” as one generic checklist.

**React Native security guidance (architectural evidence, not runtime selection).** Official React Native guidance warns not to ship sensitive API keys/secrets in app code, recommends a server-side orchestration layer for secret-bearing calls, distinguishes non-sensitive local storage from secure platform storage, requires HTTPS for APIs, and warns that deep links must not carry sensitive information. This is relevant regardless of whether React Native is eventually selected.

**Apple platform security evidence.** Apple documents Keychain Services for encrypted storage of small secrets and Universal Links with verified website/app association. Apple also explicitly warns that incoming universal-link parameters are an attack surface: parameters must be validated and available actions limited so links cannot directly perform destructive or sensitive operations.

**Firebase Remote Config as remote-configuration evidence, not an AWJ dependency decision.** Firebase documents remote changes to app behavior/appearance without an app update, real-time fetching, app/build targeting and versioned templates. It also explicitly says not to store confidential data in client Remote Config and not to use it to circumvent target-platform requirements. This is strong evidence for AWJ's “configuration is readable/untrusted client input, not a secret store or policy bypass” boundary.

### AWJ Decisions / Requirements from this pass

#### A. Separate business truth, remote data and UI state

AWJ should distinguish at least these concepts:

1. **Server-authoritative commerce data** — products, prices, stock/availability, customer/order/payment state and other business records governed by AWJ backend rules.
2. **Remote experience data/configuration** — published app schema, content references, theme/config values and safe targeting metadata.
3. **Navigation/page parameters** — immutable inputs passed into a screen/component instance.
4. **Ephemeral UI state** — local/page/component state such as selected tab, expanded section, form input or loading indicator.
5. **Sensitive local session material** — only what is required on-device, stored using platform-appropriate secure storage and never exposed through the experience schema.

A visual binding must never promote UI state into business authority. For example, a local `price` or `isPaid` value cannot authorize a checkout/payment/order result.

#### B. Typed Data Source Registry

Do not let merchant-authored schemas contain unrestricted URLs, SQL, tenant IDs or arbitrary backend queries.

Bindings should resolve through an allowlisted **Data Source / Resource Registry**, conceptually:

```text
Binding
  -> registered resource/capability
  -> typed parameters
  -> authenticated tenant/customer context
  -> backend authorization
  -> normalized response
```

Candidate resource classes may include catalog/category/product/customer/cart/order/content resources, but the final registry is not yet locked.

The backend — not the schema — resolves tenant scope. Any tenant/store/app identifiers in client input are treated as resource identifiers to authorize, never as authority to switch tenant context.

#### C. Scoped state model

Adopt the architectural concept of explicit scope/lifecycle rather than a universal mutable global store:

- app/session state;
- page/screen state;
- component-instance/local state;
- immutable navigation/component parameters;
- server/query state handled separately from mutable UI state.

Persistence must be explicit. “Global” must not imply “persist to disk,” and “persisted” must not imply “safe for secrets.”

#### D. Binding model must be declarative and constrained

Bindings may read typed fields, safe derived values and scoped state, but the final expression language remains open.

Minimum constraints:
- deterministic where practical;
- typed;
- bounded in complexity;
- no arbitrary code/eval;
- no direct network/database/filesystem access;
- no access to signing credentials/secrets;
- no tenant-context override;
- validation at authoring/publish time plus defensive runtime validation.

#### E. Event → Action pipeline

Use an explicit pipeline:

```text
Trusted event
   -> validated Action Definition
   -> capability/authorization check
   -> execute
   -> typed success/error result
   -> optional allowed state/navigation effect
```

Events may originate from UI interaction, lifecycle, approved runtime/system events or trusted backend-driven events. External/deep-link/push payloads are **untrusted input** and must be parsed/validated before they can select a safe action.

#### F. Action risk classes

The Action Registry should distinguish risk, because “show toast” and “place order” cannot share the same trust model.

Conceptual classes:

- **Local UI** — visual/local state effects.
- **Navigation** — open known screen/resource/deep link.
- **Read capability** — tenant/customer-scoped reads.
- **Mutation capability** — cart/customer/content mutations with backend authorization.
- **Sensitive commerce** — checkout/payment/order/account-security actions; server-authoritative and subject to stronger validation/idempotency/audit.
- **External integration** — allowlisted integration capability; no client-held provider secret.

Exact names are open, but differentiated policy is required.

#### G. Secrets never live in App Schema

Published schema/configuration, client logs, preview payloads and remotely fetched parameters must be assumed inspectable by an end user.

Therefore:
- no API/provider secrets in schema;
- no signing keys/certificates;
- no backend service credentials;
- no reusable privileged bearer tokens;
- no cross-tenant credentials.

Secret-bearing integrations must terminate through trusted AWJ/server-side orchestration.

#### H. Secure local storage

Authentication/session secrets that genuinely must be stored on-device use platform-appropriate secure storage. Non-sensitive cached UI/config data must remain separate from secret storage.

The exact mobile framework abstraction is deferred until runtime selection; the security requirement is not.

#### I. Deep links and push links are routing requests, not authority

A deep link may identify intent/resource, but must not directly authorize sensitive effects.

Required flow:

```text
incoming link/push
 -> verify supported origin/type where applicable
 -> parse
 -> validate route + typed parameters
 -> authenticate if required
 -> backend authorize resource/action
 -> navigate/execute safe capability
```

Never place sensitive tokens/data in ordinary deep-link parameters when a safer authenticated flow is available.

#### J. Preview/Test isolation

Preview is not a security bypass.

Preview/Test must preserve:
- tenant isolation;
- authenticated resource authorization;
- environment separation;
- explicit test/sandbox data where available;
- clear prevention of accidental production-sensitive mutations;
- no privileged “builder preview token” that becomes a universal tenant bypass.

Exact preview credential/session design remains open.

#### K. Error and fallback model

Bindings/actions need typed failure states rather than silent failure:
- loading;
- empty;
- validation error;
- unauthorized/forbidden;
- not found;
- network/retryable failure;
- incompatible capability/schema;
- safe fallback.

Sensitive errors shown to merchants/users must not leak secrets, internal credentials or cross-tenant existence.

#### L. Security verification baseline

Use OWASP MASVS/MASTG as a mobile-security verification reference alongside platform-specific Apple/Android guidance. AWJ-specific controls remain stricter where required for multi-tenancy, finance, payments and commerce integrity.

### Open Decisions after 04B

Do **not** lock yet:
- expression syntax/engine;
- exact state serialization/persistence model;
- query/cache library;
- offline-first scope;
- exact Data Source Registry contract;
- exact Event/Action schema;
- custom actions/public extension permissions;
- secure-storage abstraction/library;
- preview authentication/token architecture;
- whether third-party API calls can ever originate directly from runtime versus always through AWJ;
- targeting/personalization rules and privacy model.

### 04B conclusion

The recommended AWJ boundary is now:

```text
Visual schema/config
       |
       v
Typed bindings + scoped state + registered events/actions
       |
       v
Capability boundary
       |
       +---- local safe UI/runtime effects
       |
       +---- authenticated AWJ backend resources/actions
                         |
                         v
              tenant-scoped authorization
                         |
                         v
              server-authoritative commerce
```

The schema can describe experience intent. It cannot grant itself authority.

---

## 14. Tenant isolation and security

### Non-negotiable AWJ Requirement

Tenant isolation, authorization, data integrity and secure commerce behavior are enforced by trusted backend/runtime boundaries, never by visual-editor conventions.

A Tenant A app/schema must not gain Tenant B access by:
- changing IDs;
- changing URLs/query parameters;
- crafting bindings;
- custom actions;
- preview/test mode;
- cached contracts;
- release/version endpoints.

Custom/extension code, if introduced later, must not receive raw AWJ secrets or unrestricted database/network capability.

Security design must cover Builder, Preview, Runtime, publishing, artifacts/builds, credentials/signing and release integrations.

---

## 15. WebView boundary

### AWJ Decision

WebView is **not** the primary AWJ App Builder runtime.

A constrained WebView/safe web-content component may be useful for specific external/legacy/unsupported content, subject to explicit policy for:
- allowed origins/domains;
- authentication/session;
- navigation;
- deep links;
- JS/native bridge;
- permissions;
- payment/security constraints.

---

## 16. Commerce feature parity

### AWJ Requirement

A visually configurable app is not complete if core commerce flows are missing.

The app platform must map supported AWJ commerce capabilities across:
- catalog/categories/search;
- product options/variants where supported;
- pricing/promotions/coupons;
- stock/availability behavior;
- cart;
- checkout;
- customer identity/account;
- payments;
- orders/order details;
- shipping/delivery;
- notifications/deep links;
- other supported commerce capabilities.

“Parity” does not mean identical web UI. It means correct, supported business capability with mobile-appropriate UX.

---

## 17. Engagement

### AWJ Direction

Push and engagement deserve a first-class workspace, not a hidden setting.

Potential areas:
- push notifications;
- campaigns;
- app-only promotions;
- event-driven automations such as abandoned-cart communication.

Actual automation execution must use AWJ's trusted event/policy architecture, not hidden client-side logic.

---

## 18. Release Center

### AWJ Requirement

Publishing experience configuration and releasing a native binary are different operations.

Target Release Center must eventually expose per-platform state for iOS and Android, including as applicable:
- app/version/build identifiers;
- validation;
- signing readiness/status;
- submission status;
- review/release status;
- errors/actions requiring merchant or AWJ intervention.

The UI must not collapse the entire lifecycle into a vague “Publishing…” state.

---

## 19. Update & Release Classification Matrix — mandatory research area

This is a critical requirement and must be verified against **current official Apple and Google documentation** before implementation.

### Four distinct concepts

1. **Runtime / Experience Update**  
   A declarative content/configuration/experience change that the already-installed AWJ runtime is allowed and able to consume.

2. **Native Build Required**  
   The requested change needs capabilities/code/resources/entitlements/SDK changes not present in the installed runtime.

3. **Store Submission / Release Required**  
   A new native build must go through the applicable App Store / Google Play submission and release process.

4. **End-user Installation Update**  
   Even after a store release is available, whether/when a device installs it can depend on Apple/Google mechanisms, rollout configuration, device/user update settings and other platform rules. AWJ must not promise “all users update automatically” without verified platform evidence.

### Builder UX requirement

Before Publish/Release, classify the pending change set and explain its impact in merchant language, for example:
- can publish as an experience/runtime update;
- requires new iOS build;
- requires new Android build;
- requires store submission/review/release;
- mixed change set.

### Research matrix to close

For each capability/change type, verify from current first-party docs whether it:
- can be delivered through AWJ's declarative runtime;
- requires a binary build;
- requires new permissions/entitlements;
- requires store submission/review;
- is eligible for phased/staged rollout;
- can/should be forced or merely offered;
- reaches users automatically or depends on platform/device/user behavior.

Examples requiring explicit verification:
- banners/content;
- theme/token changes;
- page/component reorder;
- properties of already-shipped components;
- introduction of a new native component/capability;
- SDK/library changes;
- permissions/entitlements;
- push/deep-link capability changes;
- payment/auth changes;
- native assets/metadata;
- minimum OS/runtime compatibility.

**Do not fill this matrix from intuition.**

---

## 19A. Apple + Google Update & Release Matrix — Official Evidence Pass (2026-09-20)

### External Evidence — Apple

- Apple App Review Guideline 2.5.2 requires apps to be self-contained and prohibits downloading/installing/executing code that introduces or changes app features/functionality. This makes AWJ's declarative, allowlisted-runtime boundary important: remote experience configuration must configure capabilities already present in the reviewed app, not become a remote executable-code channel.
- A new App Store version requires a new build to be uploaded/selected and the version submitted to App Review.
- App Store Connect supports release after approval manually, automatically, or automatically no earlier than a selected date.
- Apple phased release for an **update** distributes automatic updates over seven days to users with automatic updates enabled: 1%, 2%, 5%, 10%, 20%, 50%, 100%. Users may still manually download the update at any time.
- Apple Support states App Store apps on iPhone/iPad automatically update by default, but the user can turn automatic app updates off and update manually.
- Therefore AWJ can manage release configuration/status, but cannot truthfully promise that every installed iOS app changes binary version immediately after an App Store release.

### External Evidence — Google Play

- Google Play's Device and Network Abuse policy says a Play-distributed app may not modify/replace/update itself outside Google Play's update mechanism and may not download executable dex/JAR/native code from outside Google Play. Runtime-loaded interpreted code must not enable policy violations.
- Updating an existing Play app requires an updated signed app bundle with a higher version code; after submission the update may enter review, and once published distribution to existing users begins.
- Users can manually update. If automatic updates are enabled for the app, Google Play can download/install the update automatically; delivery can take time and device/account/network settings can affect it.
- Google Play staged rollout exposes an update to a chosen percentage of eligible users; the percentage does **not** increase automatically and the developer must raise it. Delivery to the selected group may take time.
- Google Play In-App Updates provides **Flexible** and **Immediate** flows. Flexible permits use while downloading; Immediate is a fullscreen flow requiring update/restart to continue after the user accepts it. This is a client UX mechanism for an update already available through Google Play, not a bypass of Play release/distribution.
- Google Play's Publishing API/Developer API can participate in automated publishing/release workflows, but review/policy gates remain external platform controls.

### AWJ Decision — four separate statuses

AWJ must never use one ambiguous `Published` state for all update concepts.

The product must distinguish:

1. **Experience Published** — remote AWJ experience/config version is published.
2. **Native Build Released** — a binary version has passed the AWJ build/release process and is released/available through the relevant store path.
3. **Store Availability / Rollout** — Apple/Google is making the binary available to all or a rollout cohort.
4. **Device Installed Version** — the customer's device has actually installed a particular binary version.

These states can legitimately differ at the same time.

### Update Classification Matrix

The following is the AWJ target classification based on current platform evidence. “Runtime update” always means a **declarative change using capabilities already shipped in the installed reviewed binary**; it is not permission to download executable code or reveal materially hidden/unreviewed functionality.

| Change | Experience/runtime publish candidate | New native build | Store submission/release | Notes |
|---|---:|---:|---:|---|
| Marketing text/content from approved AWJ content model | Yes | No | No | Subject to content/store policy and existing runtime support. |
| Banner/image/content asset reference | Yes | No | No | Runtime already supports asset/content rendering; security/content policy still applies. |
| Brand colors / supported theme tokens | Yes | No | No | Within shipped theme capabilities. |
| Reorder existing supported sections/components | Yes | No | No | Must remain within reviewed/shipped component registry. |
| Change properties of an existing supported component | Yes | No | No | Only properties/capabilities supported by installed runtime/schema compatibility. |
| Navigation among existing approved screens/routes | Yes | No | No | Deep-link/resource authorization remains enforced. |
| Visibility/scheduling of already-supported content/component | Yes | No | No | Must not activate hidden native functionality outside approved capability envelope. |
| New server data/content returned through an existing typed AWJ resource | Usually yes | No | No | Does not authorize new native functionality; backend rules remain authoritative. |
| New component type not present in installed runtime | No for affected installed runtime | Yes | Yes | Ship component/runtime capability first. |
| New native capability/API integration | No | Yes | Yes | Binary capability change. |
| Add/change native SDK/library | No | Yes | Yes | Rebuild; review/policy/data disclosures may also change. |
| Native bug/performance fix | No | Yes | Yes | Binary code change. |
| New OS permission/entitlement/capability | No | Yes | Yes | Also requires platform policy/configuration review as applicable. |
| Change minimum OS / target SDK / platform compatibility | No | Yes | Yes | Binary/build configuration change. |
| New payment/auth native implementation | No | Yes | Yes | Sensitive capability; stronger AWJ + store review controls. |
| Push content/campaign using an already-shipped push capability | Yes | No | No | Push capability/config already present; payload cannot grant authority. |
| Add/change push native capability, entitlement or SDK | No | Yes | Yes | Native/platform capability change. |
| Existing supported deep-link destination/content | Yes | No | No | Incoming data remains untrusted; authorization required. |
| Add a native deep-link/universal/app-link capability requiring binary/platform config change | No | Yes | Yes | Exact platform setup depends on chosen runtime and link model. |
| App executable icon/bundled native assets requiring binary replacement | No | Yes | Yes | Distinguish from remotely rendered in-app branding assets. |
| App Store / Play listing metadata only | N/A | Not necessarily | Store-side change/review rules apply | Must be tracked separately from runtime and binary versioning. |

### Compatibility rule — the decisive check

A remote change is eligible for an AWJ Experience Publish only when **all** of the following are true:

1. the installed runtime already implements the requested component/action/data/navigation capability;
2. the published schema version is compatible with that runtime;
3. the change is declarative configuration/content, not downloaded executable native code;
4. the change stays within Apple/Google policy and the app's disclosed/reviewed purpose/capability envelope;
5. AWJ security/authorization/tenant-isolation validation passes.

If any required capability is missing from an installed runtime, AWJ must classify that portion as **Native Release Required** rather than silently failing or pretending it can hot-update it.

### Mixed-version installed base

After AWJ releases a new binary, users may remain on older runtime versions because automatic updates are not instantaneous/guaranteed.

Therefore the server must support an installed-base compatibility model:

```text
Published Experience
   |
   +-- runtime capability/version constraints
   |
   +-- compatible experience projection for older supported runtime
   |
   +-- latest experience for newer runtime
   |
   +-- minimum-supported-version policy when compatibility can no longer be preserved
```

A new builder capability should not be published globally until AWJ knows what older installed binaries will do.

### Builder publish impact UX

Before publishing, the Builder/Release Center should classify the pending diff:

- **Experience update only** — no store binary required.
- **iOS native release required**.
- **Android native release required**.
- **Both native releases required**.
- **Mixed** — some changes can publish remotely while others wait for a native release.

For mixed changes, AWJ should default to preserving a coherent user experience rather than partially publishing a configuration that references unavailable runtime capabilities.

### iOS rollout model for AWJ

After an approved binary is released:

- Apple may release it immediately or via Apple's seven-day phased release for automatic updates.
- Phased release affects automatic updates; users can manually fetch the update earlier.
- Automatic updates can be disabled by the user.
- AWJ may display **Available in App Store / Phased rollout / Released to all** based on store state, but this is not equivalent to “installed on all devices.”

Do not show “100% users updated” merely because Apple's phased release reached day 7.

### Android rollout/update model for AWJ

After a Play binary is approved/published:

- full rollout can make it available broadly;
- staged rollout limits eligibility to a selected percentage and requires deliberate percentage increases;
- automatic update depends on Google Play/user/device/account/network behavior and can take time;
- AWJ may optionally integrate Google Play **In-App Updates** later to encourage/require an eligible update while the app is open.

An Immediate In-App Update should be reserved for justified critical compatibility/security cases, not normal merchandising changes.

### Force-update policy

AWJ must not conflate “minimum supported runtime” with “the store forcibly installed a binary.”

If a runtime becomes too old to operate safely:
- backend/runtime compatibility policy may block incompatible/sensitive operations or present an update-required screen;
- Android can additionally use Play's Immediate In-App Update UX where supported;
- the binary still comes from the official store update mechanism.

Exact iOS user-prompt UX for minimum-version enforcement remains a later design decision; do not invent an Apple equivalent to Google Play In-App Updates without official evidence.

### Store automation boundary

AWJ may automate supported App Store Connect / Google Play API operations where credentials/roles allow, including submission/release workflow operations exposed by official APIs.

Automation does **not** mean AWJ controls:
- App Review approval;
- Google policy review outcome;
- exact review duration;
- whether a user has automatic updates enabled;
- exact moment every device installs the update.

Release Center must expose external waiting/review states rather than hide them.

### Rollback semantics

Experience rollback and binary rollback are different:

- **Experience rollback:** AWJ can republish a prior compatible experience/config version, subject to validation.
- **Apple binary rollback:** Apple states a previous App Store version cannot simply be reverted; a corrective new version must be created/submitted.
- **Google binary recovery:** if a binary release is defective, release controls can halt staged rollout where applicable, but fixing the artifact requires a corrected release; do not model this as the same instant rollback operation as an experience config.

### Required telemetry

To operate safely with mixed runtime versions, AWJ should collect privacy-appropriate operational telemetry sufficient to understand:
- app platform;
- installed binary/runtime version;
- supported schema/capability version;
- published experience version fetched/applied;
- compatibility/fallback failures;
- update-required states.

This telemetry must remain tenant/app scoped and must not become cross-tenant analytics leakage.

### Open Decisions after this pass

- exact minimum-supported-runtime policy;
- whether/how AWJ measures installed-version adoption versus store rollout eligibility;
- final Apple/Google API automation scope after credential/account-ownership design;
- Android In-App Updates V1 vs later;
- exact iOS update-required UX;
- metadata-only store-change classification per field;
- App Store/Play account ownership model;
- phased/staged rollout defaults by risk class;
- emergency security-release procedure.

### Evidence-pass conclusion

The core product rule is now:

> **Publish experience changes remotely when they only configure capabilities already present in the installed reviewed runtime. Build/release through Apple/Google whenever the binary capability changes. Never report a store release as proof that every user's installed app has updated.**

---

## 20. Build/signing/store-account model

### Open Decision

Still requires dedicated official-documentation evidence pass:
- build infrastructure;
- signing/certificate/key management;
- Apple Developer / App Store Connect ownership and access;
- Google Play developer/account/access model;
- automated submission APIs and limitations;
- credential custody/rotation/audit;
- tenant/app isolation for signing artifacts;
- failure/retry/idempotency;
- App Store / Google Play review and release controls.

No implementation should assume AWJ can silently perform every store-account action.

---

## 20A. Build, Signing, Store Ownership & Submission Automation — High-Sensitivity Evidence Pass (2026-09-20)

### Why this is a security boundary

The App Factory will eventually handle or orchestrate assets that can authorize software distribution under a merchant's identity. Store-account access, signing identities, API keys, upload keys and release permissions are security-sensitive credentials — not ordinary tenant configuration.

A compromise here can affect distributed binaries, developer identity, release control and customer trust. Therefore the App Factory requires stronger isolation than normal Builder content.

### External Evidence — Apple account ownership and roles

Apple explicitly recommends that when a contract developer builds an app for an organization, **the organization enrolls in the Apple Developer Program and adds the developer to its team**. The organization's legal entity name is then the seller, and the organization remains the party submitting/distributing the app.

For organization enrollment Apple requires a legal entity, D-U-N-S number (with stated exceptions such as government), legal authority to bind the organization, work email and public website. The legal entity name is used as the seller identity.

Apple organization accounts have role-based access. The Account Holder controls legal agreements/membership and some uniquely sensitive functions. App Manager/Developer roles can perform scoped delivery work, while app access can be restricted for applicable roles.

Apple App Store Connect API access must first be requested by the Account Holder. Apple supports team API keys and individual API keys. Apple states team API keys apply across all apps and **cannot be app-limited**, which makes a broad team key a poor default for a multi-merchant AWJ custody model. Individual API keys inherit the user's role/app access and are a potentially narrower integration path, subject to final automation design.

### External Evidence — Apple signing

Apple distribution certificates belong to the developer team and Apple says certificates/authentication assets are sensitive identity material and should not be shared outside the organization.

Apple also supports cloud-managed distribution certificates. Xcode can use cloud signing, and Apple documents certificate rotation behavior.

This evidence argues against AWJ casually exporting/importing long-lived merchant private distribution certificates into a shared credential database when a delegated/cloud-managed model can satisfy the workflow.

### External Evidence — Apple upload/submission automation

App Store Connect supports build upload using official tooling/API paths, including JWT-authenticated automation. Apple documents App Store Connect API automation and build upload/selection/submission workflows.

Submitting an app version requires appropriate App Store Connect roles and still enters Apple App Review. API automation does not bypass review or legal/account-holder gates.

### External Evidence — Apple app transfer

Apple supports transferring an eligible app between developer accounts while keeping it available; reviews/ratings remain and users continue receiving updates. The Bundle ID remains with the app.

However transfer is **not operationally trivial**. Apple documents special handling for capabilities such as push, Keychain sharing, Apple Pay, Sign in with Apple, iCloud, TestFlight/Xcode Cloud and others. Account Holders initiate/accept transfers.

Therefore “we can transfer later” is a safety valve, not a justification for choosing the wrong ownership model initially.

### External Evidence — Google account ownership and permissions

Google Play organization accounts are intended for businesses/organizations and require organization verification including D-U-N-S in the documented organization flow.

Play Console supports account-level and app-level user permissions. AWJ should prefer app-scoped least privilege where the required operation supports it, not global account administration.

Google Play Developer API supports server automation using service accounts or OAuth. Google's documentation says service-account credentials should be kept in a secure server environment and granted the appropriate Play Console permissions.

### External Evidence — Google signing

With **Play App Signing**, Google holds/protects the app signing key and the developer keeps an upload key used to sign the bundle uploaded to Play. Google documents that a lost/compromised upload key can be reset.

This distinction is critical for AWJ: the App Factory generally needs an authorized upload path, not custody of the final Google-held app signing private key.

For apps outside Play App Signing, loss of the signing key can be catastrophic; Google documents that an app not enrolled in Play App Signing may need a new package/app if the keystore is lost.

### External Evidence — Google transfer

Google supports transferring apps between developer accounts subject to eligibility/process requirements. Play App Signing has specific upload/signing-key considerations during transfer.

As with Apple, transfer is an exit/ownership mechanism, not a zero-cost routine operation.

### AWJ Decision — default ownership model

**Preferred default: merchant-owned store accounts, AWJ as delegated builder/release operator.**

For a merchant-branded public app:

```text
Merchant legal organization
   ├── owns Apple Developer / App Store Connect account
   ├── owns Google Play developer account
   ├── remains legal seller/developer of record where platform rules apply
   └── delegates minimum required access to AWJ automation/operators
```

AWJ owns:
- App Builder;
- Experience Contract;
- runtime/app-factory source and build templates;
- build orchestration;
- validation;
- release workflow UI;
- automation adapters.

AWJ should **not** become the legal owner of every merchant's store account by default.

### Why this is preferred

1. merchant retains durable ownership if they leave AWJ;
2. seller/developer identity aligns with the merchant's legal business;
3. Apple explicitly describes organization-owned enrollment for contract-developed apps;
4. reduces mass blast radius from one AWJ store account;
5. app transfer is not required merely because a merchant ends the AWJ relationship;
6. legal agreements/tax/business identity remain with the merchant;
7. delegated access can be revoked without transferring the app.

### Managed-account exception

AWJ may later offer a managed publishing model for specific customer segments **only after** legal, policy, support, security and commercial review.

It must be an explicit model, not the hidden default.

The UI/contract must make ownership clear before first release:
- Merchant-owned;
- AWJ-managed (if ever supported);
- transfer/exit consequences.

### First-release onboarding

Before App Factory can release, create an explicit **Store Connection & Ownership Setup** workflow.

Candidate checks:

#### Apple
- organization/account status;
- Account Holder/legal agreements readiness;
- app record / Bundle ID;
- delegated user/API access;
- Certificates/Identifiers/Profiles capability where actually required;
- signing mode;
- push/entitlements;
- App Store metadata/privacy/review prerequisites.

#### Google
- organization/account verification;
- package/app record;
- delegated user/service-account/API access;
- Play App Signing status;
- upload-key setup;
- app-content/data-safety/review prerequisites.

Do not ask merchants to paste account passwords into AWJ.

### Credential architecture

Store credentials must be handled by a dedicated secret-management boundary.

Required properties:
- encrypted at rest with managed KMS/HSM-backed key management where available;
- never stored plaintext in tenant/business tables;
- no secret returned to normal frontend APIs after connection;
- scoped by platform + external account + app/tenant relationship;
- least privilege;
- rotation/revocation support;
- audit of creation/use/revoke without logging secret value;
- short-lived tokens generated from long-lived credentials where platform design allows;
- environment separation;
- no secrets in build logs/artifacts;
- no cross-tenant secret lookup.

Exact cloud secret manager/KMS provider remains an implementation decision.

### Apple credential preference

Preferred order, subject to proof/API capability:

1. delegated merchant organization access with least privilege;
2. narrowly scoped individual/integration identity where Apple permissions permit;
3. avoid broad team API keys as default because Apple documents that team API keys cannot be limited to individual apps;
4. avoid exported long-lived distribution private certificates when cloud-managed signing/delegated workflows can meet the requirement.

Do not store the merchant's Apple Account password or 2FA recovery material.

### Google credential preference

Preferred:
- merchant-owned Play account;
- AWJ service identity/OAuth integration granted only required Play permissions;
- Play App Signing for final distribution key custody;
- separate upload key per app by default unless a reviewed operational reason says otherwise;
- upload private keys stored in secret manager and injected only into isolated build jobs.

Do not reuse one global AWJ upload key across unrelated merchant apps.

### Build isolation

Every native build is an untrusted multi-tenant job boundary.

Required model:

```text
Build Request
  -> authorize tenant/app/version
  -> immutable build manifest
  -> ephemeral isolated worker
  -> fetch exact source/runtime/template revision
  -> inject app-specific public config
  -> lease required secret(s) just-in-time
  -> build + sign
  -> validate
  -> upload artifact / submit
  -> destroy worker + workspace + secret material
```

Requirements:
- no shared writable workspace between merchant builds;
- no previous tenant secrets/caches carried into another build unless cache is proven secret-free/content-addressed;
- secrets are mounted/injected at execution time, not committed to source;
- artifacts are tenant/app/version scoped;
- build inputs are immutable/auditable;
- build job cannot request another app's credentials by changing a client-supplied ID;
- outbound network should be minimized/controlled for signing/build jobs;
- logs must be secret-redacted.

### Identity invariants

Treat these as durable identities:
- iOS Bundle ID;
- Android application/package ID;
- Apple/Google external app record IDs;
- signing identity/public fingerprints;
- merchant/store ownership relation.

Do not regenerate identifiers on every build.

Changing branding/name does not imply changing package/bundle identity.

### Signing invariants

A release record must know which signing identity was used, without exposing private material.

Store at least safe metadata such as:
- signing provider/mode;
- certificate/key identifier/fingerprint;
- validity/rotation status where applicable;
- external account/app identity;
- build artifact digest;
- signer job/audit reference.

Private key material remains in the secret/signing boundary.

### Release state machine

Do not model release as a single boolean.

Conceptual states:

```text
Draft Release
 -> Validating
 -> Build Queued
 -> Building
 -> Build Failed / Built
 -> Signing / Signed
 -> Uploading / Uploaded
 -> Store Processing
 -> Ready for Submission
 -> Submitted
 -> In Review
 -> Rejected / Action Required / Approved
 -> Scheduled / Phased/Staged
 -> Released
 -> Superseded
```

Apple and Google have different exact external states; AWJ should map them into a normalized product state while retaining the raw external state for diagnostics.

### Human approval / separation of duties

Production submission/release is a high-impact action.

AWJ should support policy such as:
- Builder/editor can prepare;
- authorized Release Manager can approve submission;
- credentials are used by backend automation, not revealed to the approver;
- high-risk changes can require explicit re-authentication/confirmation;
- audit records actor, app, version, artifact digest and external submission IDs.

For V1, **no unattended auto-release by default**.

Future automated release policies may be considered only with explicit merchant opt-in and risk controls.

### Idempotency and retry

Build/upload/submission jobs must be idempotent around external side effects.

Persist:
- AWJ release ID;
- immutable build/version identity;
- artifact digest;
- Apple/Google external operation/build/version IDs;
- last known external state;
- retry count/error class.

A timeout must not cause AWJ to blindly create duplicate store versions/submissions.

### Credential compromise / rotation

#### Apple
- revoke compromised API keys immediately and create replacement credentials with least privilege;
- rotate signing assets according to Apple-supported processes;
- cloud-managed certificates are preferred where they reduce private-key custody;
- revocation effects must be understood before acting because uploaded/pending builds can be affected.

#### Google
- reset compromised upload key through Play App Signing-supported process;
- distinguish upload key compromise from Google-held app signing key;
- update third-party API fingerprint registrations when signing identity changes/upgrades.

AWJ Release Center should surface credential health and block unsafe release operations.

### Merchant offboarding / exit

Because merchant ownership is preferred:
- revoke AWJ delegated access;
- revoke AWJ integration credentials/service accounts;
- export merchant-owned AWJ app configuration/data as contractually supported;
- merchant keeps Apple/Google app ownership;
- no store transfer is normally needed.

If an app is AWJ-managed under a future exception model, offboarding requires an explicit transfer runbook and capability-specific migration checklist.

### App transfer runbook requirement

Never implement “Transfer App” as one button without preflight.

Preflight must inspect relevant capabilities, including at least:
- subscriptions/IAP;
- push;
- Sign in with Apple;
- Apple Pay;
- Keychain/App Groups/iCloud where used;
- TestFlight/Xcode Cloud;
- Google Play App Signing/upload key;
- linked API fingerprints/deep links;
- webhooks/integrations;
- current review/release states.

Transfer should produce a signed/audited handoff checklist and post-transfer verification.

### Audit requirements

Security/audit log should record:
- connection created/changed/revoked;
- role/permission verification;
- credential/key rotation;
- build requested/completed;
- artifact digest;
- signing identity metadata;
- upload;
- submission;
- release control change;
- rejection/action-required;
- transfer/offboarding.

Do not log private keys, JWT signing material, account passwords or full access tokens.

### Production protections

- no Merge/Deploy from App Builder documentation automatically authorizes App Factory production access;
- production store credentials require explicit secure onboarding;
- preview credentials cannot submit production releases;
- staging build workers cannot access production release secrets;
- tenant/app ownership relation is checked server-side before every secret lease and external store action;
- financial/legal account actions remain restricted to roles/platform processes that support them.

### Open Decisions after high-sensitivity pass

- exact Apple delegated integration identity: individual API key vs other supported App Store Connect API arrangement for each operation;
- exact Apple signing automation path and whether cloud-managed signing can cover the required CI/App Factory workflow;
- final secret manager/KMS/HSM provider;
- build worker platform/provider;
- whether one isolated Google Cloud service account is created per merchant account or another narrower credential model;
- upload-key-per-app operational implementation;
- merchant onboarding UX for D-U-N-S/account verification;
- handling merchants who only have personal developer accounts;
- whether AWJ ever offers managed developer-account publishing;
- store fees/commercial responsibility;
- tax/banking/IAP/subscription ownership;
- exact automated metadata/review API coverage;
- emergency signing/release procedure;
- two-person approval policy for high-risk releases;
- retention period for signed artifacts/build logs;
- formal app-transfer/offboarding SLA.

### High-sensitivity conclusion

**Default ownership architecture: merchant owns Apple/Google developer accounts and the app; AWJ receives revocable least-privilege delegated access and operates the build/release workflow.**

**Default signing architecture: minimize private-key custody; prefer platform-managed signing where available; isolate any credential AWJ must hold per external account/app and expose it only just-in-time to ephemeral build workers.**

This direction materially reduces legal lock-in, tenant blast radius and credential risk while preserving AWJ's ability to automate professional releases.

---

## 21. Localization, RTL and accessibility

### AWJ Requirement

The builder and produced app experiences must treat Arabic/RTL and English/LTR as first-class concerns.

Preview/testing must make locale/direction differences visible before publish.

Component definitions should carry accessibility requirements/metadata where appropriate. The builder must not make accessible behavior optional merely because the visual output “looks correct.”

---

## 20B. Visual Builder UX + Developer Workspace Architecture (2026-09-20)

### Goal

Turn the architecture already established — App Schema, Component/Action/Data registries, Draft/Published separation, Preview ladder, compatibility and Release Center — into one coherent merchant workflow.

The Builder must serve two audiences without forcing either into the other's complexity:

- **Design mode:** merchant/operator building a commerce app visually.
- **Develop mode:** advanced operator/developer inspecting data, actions, state, conditions, events and runtime diagnostics.

This is progressive disclosure, not two separate app-building products.

### External benchmark evidence

**Tapcart** documents a visual app studio based around screens/blocks/components, preview, editable component configuration and developer extensibility. Its developer tooling reinforces the value of keeping merchant-editable fields explicit rather than exposing implementation code.

**FlutterFlow** demonstrates the broader product pattern of a visual canvas combined with widget hierarchy, properties, actions, backend/data binding, state and conditional logic. AWJ should adopt the information-architecture lesson without inheriting Flutter-specific concepts into the AWJ Experience Contract.

**Webflow** provides strong evidence for the Layers/Navigator + Canvas + Style/Settings inspector mental model used by professional visual builders. AWJ should simplify this for merchants rather than reproduce a web-design IDE.

**Shopify theme editor** demonstrates section/block editing, contextual settings and live storefront preview. This reinforces AWJ's progressive-disclosure direction for merchant-facing customization.

### AWJ Decision — Builder shell

Desktop is the primary authoring workspace.

```text
┌────────────────────────────────────────────────────────────────────┐
│ App / Page   Draft status     Undo/Redo     Preview     Publish   │
├──────────────┬───────────────────────────────┬─────────────────────┤
│ Pages        │                               │ Inspector           │
│ Components   │         Live Canvas           │                     │
│ Layers       │                               │ Content             │
│              │                               │ Layout              │
│              │                               │ Style               │
│              │                               │ Data                │
│              │                               │ Actions             │
│              │                               │ Conditions          │
│              │                               │ Advanced            │
├──────────────┴───────────────────────────────┴─────────────────────┤
│ Components | Data | Actions | Navigation | Issues | Diagnostics   │
└────────────────────────────────────────────────────────────────────┘
```

Do not make every panel visible simultaneously on normal merchant workflows. The diagram is the complete capability map; actual UI uses contextual tabs/drawers and progressive disclosure.

### Top bar

Always visible:
- current app;
- current page/screen;
- Draft / saved state;
- undo/redo;
- device/preview entry;
- validation/issues indicator;
- Save where explicit save is needed;
- Publish entry point.

Native build/store release must **not** be presented as the same action as Experience Publish.

If a pending change requires a native release, Publish impact analysis routes the merchant toward Release Center.

### Left workspace — structure

Three primary views:

#### Pages
Merchant mental model first:
- Home;
- Categories;
- Product;
- Search;
- Cart;
- Account;
- custom content/landing pages where supported.

System-required commerce screens may be locked/required rather than deletable.

#### Components
Searchable categorized component library:
- Commerce;
- Content;
- Layout;
- Navigation.

Only components compatible with the current app/runtime target should be insertable.

#### Layers
Tree of component instances on the selected page.

Supports:
- select;
- reorder;
- nest where allowed;
- hide;
- duplicate where safe;
- delete where allowed;
- identify locked/system elements.

Do not expose internal Flutter widget hierarchy.

### Center — Live Canvas

Canvas is the primary manipulation surface.

Required interactions:
- click/tap to select;
- drag/reorder where structurally valid;
- insert between valid drop zones;
- resize only for properties the component contract exposes;
- inline text editing where safe/useful;
- empty/error/loading-state simulation;
- device viewport presets;
- locale + RTL/LTR;
- zoom/fit;
- safe navigation between app screens.

Canvas operations mutate Draft App Schema through validated editor commands, not arbitrary DOM/widget mutation.

### Right — metadata-driven Inspector

The Inspector is generated from Component Definition metadata wherever possible.

Stable conceptual groups:

1. **Content** — text, media, labels and merchant content.
2. **Layout** — spacing, alignment, sizing and allowed structure.
3. **Style** — theme-aware visual properties.
4. **Data** — resource/binding selection.
5. **Actions** — allowed event → action mapping.
6. **Conditions** — visibility/behavior predicates.
7. **Advanced** — IDs, accessibility, diagnostics or expert options that are safe to expose.

A component only shows groups it supports.

Merchant-facing terminology must remain business-friendly. Do not show schema paths, Dart classes or API internals in Design mode.

### Basic vs Advanced

Default Inspector shows the smallest useful set of settings.

Advanced expands expert controls.

Theme Tokens remain an internal/design-system foundation. Merchant UI should normally say concepts such as:
- Brand color;
- Text style;
- Spacing;
- Corner style;
- Section background;

not `--token-primary-500` or runtime implementation names.

### Contextual editing

When the merchant selects a banner, show banner settings.
When they select product grid, show product-source/layout/card settings.
When they select button, show label/style/action.

Avoid a giant app-wide form disconnected from the selected visual element.

### Data binding UX

Design mode does not expose arbitrary queries.

Preferred merchant flow:

```text
Data
  Source: Products
  Collection: Featured products
  Sort: Recommended
  Limit: 8
```

Advanced/Develop mode may expose the typed resource, parameters, returned fields and binding diagnostics.

Unsupported or unauthorized data sources never appear as selectable options.

### Actions UX

Design mode uses human-readable actions:

```text
When tapped
  → Open product
```

or:

```text
When tapped
  → Add selected item to cart
```

Develop mode can inspect:
- event;
- registered action type;
- typed inputs;
- source of each input;
- success/error behavior;
- required capability/auth;
- diagnostics.

Neither mode permits arbitrary JavaScript/Dart execution.

### Conditions UX

Merchant mode should support safe business predicates such as:
- show when signed in;
- show when collection has items;
- show during a scheduled period;
- show for supported market/locale where product rules permit.

Complex expressions belong in Develop mode only if the future constrained expression engine supports them.

Security/authorization conditions are never delegated to UI visibility. Hiding a button is not authorization.

### Develop mode

Develop mode extends the same selected component/page context.

Target tools:
- Data;
- Actions;
- State;
- Events;
- Conditions;
- Navigation;
- Issues;
- Console/diagnostics;
- Network/resource requests with redaction;
- runtime/schema compatibility.

Develop mode is an inspector/debugger for the **AWJ declarative runtime**, not a general-purpose code editor.

### Bottom workbench

Collapsed by default for merchants.

Tabs:

**Components** — search/details/capabilities.

**Data** — current resources, bindings, loading/error state.

**Actions** — event/action graph or list.

**Navigation** — route graph/deep-link mapping.

**Issues** — errors, warnings and compatibility blockers.

**Diagnostics** — preview runtime events, sanitized resource calls and compatibility/fallback information.

A future extension SDK may get a separate development workflow; do not put arbitrary package/code installation into this panel.

### Validation UX

Issues are classified:

- **Blocker** — cannot Publish.
- **Warning** — publish allowed with explicit awareness where policy permits.
- **Info** — recommendation/diagnostic.

Examples of blockers:
- missing required page/navigation target;
- unsupported component for target runtime;
- invalid required binding;
- forbidden action;
- schema incompatibility;
- missing mandatory accessibility/content property where enforced;
- native capability required but no compatible release path.

Clicking an issue should focus the relevant page/component/property.

### Save / Draft semantics

Editing updates a Draft working model.

The UI must clearly distinguish:
- Unsaved/local transient edit where applicable;
- Saved Draft;
- Published Experience version;
- Native release version.

Autosave may be used later, but it must not silently publish.

### Publish flow

Publish is a review flow, not an instant blind button.

```text
Publish
 -> validate
 -> summarize changes
 -> classify impact
 -> Preview recommendation / required checks
 -> confirm
 -> create immutable Published Experience version
```

Impact classification reuses the Update & Release Matrix:

- Experience update only;
- iOS native release required;
- Android native release required;
- both;
- mixed.

For native-impacting changes, Experience Publish must not create references that older installed runtimes cannot safely handle.

### Version comparison

Before Publish and in Versions, show meaningful diffs such as:
- Home: Hero image changed;
- Product Grid: columns 2 → 1 on small viewport;
- Cart button action unchanged;
- New component requires runtime capability X;
- Navigation: added Offers page.

Do not force merchants to read raw JSON diffs.

Develop mode may expose technical diff details.

### Undo/redo

Undo/redo should operate on validated editor commands.

Long-term desirable:
- local short history for fast edits;
- named/version checkpoints through Draft/Published versions.

Undo does not roll back a published production version. Published rollback is a separate version operation.

### Multi-user editing

Do not assume Google-Docs-style simultaneous editing for V1.

Minimum safe architecture:
- revision/version identifier;
- optimistic concurrency check;
- conflict detection;
- prevent silent overwrite of another editor's newer Draft.

Presence/live collaboration can come later.

### Mobile authoring

AWJ should have a mobile-friendly management experience, but **full precision visual authoring is desktop-first**.

Mobile V1 target:
- inspect app/status;
- edit simple content/settings;
- reorder straightforward sections;
- preview;
- review issues;
- approve/publish where authorized;
- monitor release status.

Complex layer nesting, data/action debugging and advanced Develop mode may require desktop/tablet.

This avoids making the desktop Builder worse merely to fit every advanced tool onto a phone.

### Accessibility authoring

Component Definition should declare accessibility-relevant merchant inputs.

Builder should surface applicable controls such as:
- meaningful image description/semantics where required;
- button/control label;
- heading semantics where relevant;
- contrast warnings where reliably measurable;
- focus/interaction requirements.

Runtime components themselves remain responsible for platform accessibility semantics that merchants should not manually configure.

### Localization authoring

Content fields should show translation status and fallback behavior.

Required direction:
- Arabic and English are first-class;
- preview locale switch;
- RTL/LTR preview;
- missing translation indicator;
- explicit fallback policy;
- do not duplicate entire page trees merely because locale differs unless structurally required.

### Theme relationship

App Theme can inherit from Shared Brand/Store Theme while allowing app overrides.

Inspector should be able to show, where useful:
- inherited value;
- app override;
- upstream change available;
- conflict.

Theme sync uses the previously defined:
**Detect → Diff → Preview → Apply** flow.

### System components and guardrails

Some commerce elements may be required/locked because removing or rewiring them could break core flows.

Examples may include required checkout/account/legal/navigation elements depending on final V1 scope.

The Builder should explain why an element is locked rather than merely disabling controls.

### UX trust principles

- no destructive action without clear consequence;
- no fake “Published” when store binary is merely submitted;
- no hidden production mutation from Preview;
- no ambiguous Draft vs Live state;
- no raw technical error as primary merchant message;
- technical diagnostics remain available to authorized advanced users;
- show compatibility impact before committing a change.

### Open Decisions after Builder UX pass

- exact visual design/layout dimensions;
- Canvas implementation technology;
- autosave cadence;
- collaboration/presence scope;
- exact component insertion/reorder gestures;
- mobile authoring depth;
- version-diff visualization;
- component search/favorites/recent;
- reusable merchant sections/components;
- page templates;
- extension SDK workflow;
- approval workflow between Designer and Release Manager;
- AI-assisted building/editing — future capability, not assumed in V1.

### Builder architecture conclusion

AWJ Builder should feel like a commerce design tool to a merchant and like a controlled declarative-runtime inspector to an advanced developer.

The user should progress naturally:

> Select page → select/add component → edit visually → bind data/action if needed → preview → resolve issues → review impact → publish.

The complexity of Schema, tenant isolation, capability checks, runtime compatibility and native release classification remains enforced underneath rather than exposed as implementation jargon.

---

## 21A. Mobile Runtime Technology Evidence Pass — Flutter vs React Native vs Native (2026-09-20)

### Decision criteria for AWJ

The runtime choice is evaluated against AWJ's actual requirements, not generic framework popularity:

1. one merchant app product targeting iOS + Android;
2. high-quality Arabic/RTL + English/LTR UI;
3. strong visual consistency for a schema-driven component runtime;
4. ability to implement an allowlisted Component/Action Registry;
5. real native/platform capabilities for payments, push, deep links, secure storage and accessibility;
6. predictable performance for commerce screens and long lists;
7. safe versioned runtime that can consume declarative experience updates;
8. maintainable build/sign/release pipeline for many merchant-branded apps;
9. ability to write platform-specific native code where required;
10. long-term ownership by AWJ without coupling the Experience Contract to a framework.

### External Evidence — Flutter

Official Flutter documentation describes Flutter as a multiplatform framework from a single codebase. Its architecture uses a Dart framework over an engine and platform embedder, and it provides platform channels for calling Kotlin/Swift/native host code when platform integration is required.

Flutter's rendering model gives the framework substantial control over UI rendering, which is attractive for a visual-builder/runtime product where the same AWJ component definition should render predictably across many branded apps.

Flutter documents internationalization/localization support and direction-aware widgets/properties such as `EdgeInsetsDirectional` and `AlignmentDirectional`, relevant to AWJ's RTL-first requirement.

Flutter supports add-to-app/platform integration and plugins, so choosing Flutter would not prevent AWJ from implementing native payment, push, deep-link, secure-storage or other platform-specific bridges.

### External Evidence — React Native

Official React Native documentation describes React Native as rendering to native platform UI and supports platform-specific code/files and Native Modules/Native Components for capabilities not covered by the common layer.

React Native's current architecture includes the New Architecture/Fabric/TurboModules direction, enabling JavaScript and native interoperability without the historical bridge model for supported integrations.

React Native documents RTL support through `I18nManager`, including RTL layout controls.

React Native is particularly attractive where an organization wants to reuse React/TypeScript knowledge and ecosystem patterns. AWJ's management web application already uses Next.js/React/TypeScript, but this is a team/product-maintenance advantage — it does **not** imply that web components can or should be reused as mobile runtime components.

### External Evidence — fully native Swift/Kotlin

Apple's SwiftUI and Android's Jetpack Compose are first-party declarative UI stacks with the deepest direct access to their respective platform capabilities and UI behavior.

A fully native AWJ runtime would require maintaining two primary UI/runtime implementations and keeping the AWJ schema/component/action behavior semantically synchronized across iOS and Android.

This can maximize platform-specific control, but it increases duplicated runtime/component work for AWJ's multi-merchant app-factory use case.

### AWJ comparative assessment

| Criterion | Flutter | React Native | Separate Native |
|---|---|---|---|
| Shared iOS/Android runtime | Strong | Strong | Weak — two implementations |
| Predictable cross-platform visual component rendering | **Strongest fit** | Strong | Requires dual parity work |
| React/TypeScript alignment with AWJ web team | Lower | **Strongest** | Low |
| Native/platform escape hatch | Strong via plugins/platform channels | Strong via native modules/components | **Direct** |
| Schema-driven Component Registry fit | **Very strong** | Very strong | Possible but duplicated |
| Multi-brand app factory maintainability | **Very strong** | Very strong | Higher operational cost |
| RTL/localization capability | Strong | Strong | Strong |
| Platform-native UI semantics by default | Framework-rendered model | **Native component model** | **Direct** |
| Single renderer implementation controlled by AWJ | **Strong** | Strong | Two renderers |
| Risk of framework-specific coupling | Manageable if contract stays independent | Manageable if contract stays independent | Platform duplication instead |
| Existing AWJ React/TS skill leverage | Limited | **High** | Limited |

### AWJ Decision — preferred runtime direction

**Flutter is the preferred runtime direction for the AWJ App Builder/App Factory, subject to a focused technical proof before implementation lock.**

This is a product-architecture preference, not authorization to begin implementation.

Why Flutter currently fits AWJ better:

1. **AWJ is building a runtime, not merely one mobile app.** The product needs one controlled renderer for a versioned Component Registry across many merchant-branded applications.
2. **Visual predictability matters.** A merchant designing a component in AWJ should get a highly consistent result across iOS and Android.
3. **The schema/runtime architecture maps naturally to a widget registry.** AWJ can own component definitions and map them to trusted compiled Flutter widgets.
4. **Native escape hatches remain available.** Sensitive/platform capabilities can be implemented through audited plugins/platform channels and backend APIs.
5. **It reduces dual-runtime parity work** compared with separate SwiftUI/Compose implementations.
6. **React Native's strongest AWJ advantage is team-stack alignment**, which is valuable but less decisive than renderer consistency for this specific App Builder/App Factory product.

### Why React Native is not rejected

React Native remains the **fallback/second candidate**, not a bad choice.

Reconsider Flutter if the proof shows a material problem in:
- required Saudi payment/wallet SDK integration;
- push/deep-link/native SDK support;
- accessibility;
- Arabic/RTL correctness;
- performance/memory/startup for the AWJ runtime;
- app-factory build size/time/operations;
- store-policy compatibility;
- maintainability compared with the available AWJ engineering skill set.

Do not choose React Native merely because the AWJ web UI uses React. Web-builder technology and mobile-runtime technology are separate architecture decisions.

### Why separate native is not the default

Separate SwiftUI + Compose runtimes are not recommended as the initial AWJ direction because every schema capability/component/action would require parity across two implementations.

Native code remains an essential **integration layer**, not the default whole-runtime strategy.

### Critical decoupling rule

The AWJ App Schema must remain framework-neutral.

Bad:

```text
schema -> Flutter class names / Dart expressions
```

Required direction:

```text
AWJ App Schema
   -> AWJ capability/component identifiers
   -> runtime adapter/registry
       -> Flutter widget today
       -> another implementation later if ever required
```

Do not expose Dart, React Native component names, Swift types or Kotlin types in merchant-authored/persisted contracts.

### Runtime layering if Flutter proof succeeds

```text
AWJ App Schema
      |
Schema validation + compatibility
      |
Component / Action / Data registries
      |
AWJ Runtime Domain Layer
      |
Flutter Presentation Runtime
      |
Audited Plugins / Platform Channels
      |
iOS native        Android native
```

Commerce authority remains on AWJ backend regardless of runtime framework.

### Proof gate before final technology lock

Before changing status from **Preferred** to **Selected**, build a narrow throwaway/isolated technical proof — not production App Builder implementation — that verifies:

1. Arabic RTL + English LTR switching;
2. representative Home/Product/Cart component rendering;
3. long product list/grid scrolling;
4. schema → registry → widget rendering;
5. state/binding/action dispatch;
6. secure authenticated AWJ API call;
7. deep link;
8. push notification;
9. secure local token storage;
10. at least one representative Saudi payment/native SDK integration path;
11. accessibility semantics;
12. iOS + Android release builds;
13. runtime/schema compatibility fallback;
14. approximate binary/startup/build operational characteristics.

The proof should test architecture risk, not polish UI.

### Open Decisions after runtime comparison

- Flutter final selection — pending proof gate;
- state-management package/library;
- networking/cache package;
- secure-storage implementation;
- routing package vs AWJ-owned navigation abstraction;
- push provider/integration;
- payment SDK matrix;
- app-factory build isolation strategy;
- shared engine/artifact strategy across merchant apps;
- minimum iOS/Android versions;
- whether any merchant extension can include compiled custom code and, if so, how it is reviewed/built.

### Runtime comparison conclusion

For AWJ's **multi-merchant, schema-driven mobile commerce runtime**, Flutter currently has the strongest architectural fit. React Native remains the fallback candidate because of strong native interoperability and React/TypeScript team alignment. Separate native runtimes remain appropriate for platform-specific integration code but are not the preferred whole-product architecture.

---

## 21B. Preview Architecture Evidence Pass (2026-09-20)

### Product goal

AWJ Preview must let a merchant move from a fast visual check to a high-confidence real-device test **without turning Preview into a second production environment or a tenant-isolation bypass**.

Preview is a fidelity ladder, not one mode.

### External Evidence

**Flutter development model.** Flutter officially separates development/debug iteration (including hot reload) from profile/release builds. Hot reload is a development mechanism and is not the production merchant-preview architecture AWJ should expose.

**Firebase App Distribution.** Firebase provides pre-release distribution of iOS/Android builds to trusted testers, tester invitations/groups, release notes and SDK/CLI/API-style automation. This is evidence for a controlled tester-build lane, not a decision to adopt Firebase.

**Apple TestFlight.** TestFlight provides Apple’s official beta-distribution path for builds before App Store release, with internal/external testers and beta review rules where applicable. This is useful for release-candidate/beta testing, but is too heavyweight to be the normal per-edit visual preview loop.

**Google Play testing tracks / internal app sharing.** Google Play provides testing/distribution mechanisms for pre-release Android builds. These are useful for build/release QA but should not be confused with instant Builder preview.

**Tapcart / Shopney benchmark evidence.** Commercial mobile-commerce builders demonstrate the product value of in-editor live preview plus real-device preview/testing. AWJ should preserve this two-level mental model while implementing its own secure architecture.

### AWJ Decision — four preview levels

#### Level 1 — Canvas Preview

Purpose: fastest authoring feedback inside AWJ Builder.

Characteristics:
- rendered from the current Draft;
- device frame/viewport presets;
- locale and RTL/LTR switching;
- visual state simulation;
- component selection synchronized with Inspector;
- no claim of perfect native-device fidelity;
- should work without creating a native build for every edit.

This is the primary design loop.

#### Level 2 — Interactive Runtime Preview

Purpose: execute the real AWJ component/action/data-binding semantics using the preview runtime rather than a decorative mock.

Characteristics:
- same App Schema contract and Component Registry semantics as the mobile runtime;
- authenticated tenant-scoped data access;
- explicit Preview environment/session;
- safe navigation/actions;
- compatibility/issues surfaced;
- may run in a dedicated preview surface/runtime implementation while preserving the same contract semantics.

The exact technical implementation — web renderer, embedded runtime, streamed/device runtime or hybrid — remains open until prototype evidence.

#### Level 3 — Real Device Preview

Purpose: merchant scans a QR/open link and sees the Draft on a physical phone before release.

Preferred architecture direction:

```text
AWJ Builder Draft
      |
Create short-lived Preview Session
      |
Signed opaque preview reference
      |
QR / universal-app link
      |
AWJ Preview App / authorized preview runtime
      |
Authenticate user if needed
      |
Server resolves tenant + app + draft + permissions
      |
Fetch preview-safe schema/data
```

The QR/link must **not** contain raw tenant authority, secrets, permanent bearer tokens or the full schema.

Real-device Preview should use the same runtime capability model as production so it catches device/RTL/native integration issues earlier.

#### Level 4 — Release Candidate / Beta Build

Purpose: test the actual merchant-branded binary, native configuration and store-adjacent behavior before production release.

Candidate distribution lanes:
- Apple TestFlight;
- Google Play testing tracks/internal distribution mechanisms;
- optionally another controlled pre-release distribution service if later justified.

Use this level for:
- final native SDK verification;
- permissions;
- push;
- deep links;
- signing/bundle identity;
- app icon/splash/native assets;
- release-candidate QA.

Do not rebuild a merchant binary merely to preview every banner or spacing edit.

### Preview Session security model

A Preview Session is a server-side resource, not a magic URL.

Conceptual record:

```text
PreviewSession
- id / opaque public reference
- tenant_id        [server-owned]
- app_id           [authorized server relation]
- draft_version_id
- environment
- created_by
- expires_at
- revoked_at
- allowed_preview_capabilities
- optional device/tester binding
- audit metadata
```

Exact schema/storage is not approved; this is the required security model.

### Tenant isolation requirements

1. Tenant context is derived/validated server-side; a QR parameter cannot switch tenants.
2. The authenticated previewer must be authorized for the referenced app/tenant unless an explicitly designed guest-preview mode is later approved.
3. Cross-tenant app/draft IDs return safe not-found/forbidden behavior without leaking existence.
4. Preview data endpoints enforce the same tenant boundary as production APIs.
5. Preview cache keys include tenant/app/version/environment dimensions.
6. Revocation and expiry are server-enforced.
7. Preview must never expose signing credentials, store credentials or backend secrets.
8. A compromised preview link alone must not become durable account access.

### Mutation policy

Default preview posture:

- read operations may use authorized tenant data where safe;
- local UI interactions are allowed;
- business mutations should use sandbox/test resources when available;
- sensitive production mutations are blocked by default;
- any explicitly allowed production-affecting preview action must be unmistakable, separately authorized and audited.

Checkout/payment testing must use provider sandbox/test infrastructure where available. Preview must not silently create real charges/orders just because the screen looks like production.

### Draft isolation

Production runtime fetches only Published-compatible experience versions.

Preview runtime may fetch Draft versions only through an authorized Preview Session.

Required separation:

```text
Production App -> Published Experience endpoint
Preview App    -> Preview Session -> Draft Experience endpoint
Builder Canvas -> Authenticated Builder Draft
```

Do not add a generic `?preview=true` switch to the production experience endpoint.

### Preview version pinning

A preview session should pin to an identifiable draft/version snapshot or clearly declare “follow current draft.”

For reproducible QA and bug reports, **pinned snapshot** is preferred for shareable tester sessions. Builder-local live preview may follow the working draft.

The UI must show which version/snapshot the tester is seeing.

### QR/link lifecycle

Preview links should be:
- opaque;
- short-lived by default;
- revocable;
- scoped to one app/draft/environment;
- auditable;
- optionally limited by tester/device for higher-risk previews.

The QR is transport/discovery only. Authorization remains server-side.

### Real-device Preview App direction

Preferred direction is a dedicated **AWJ Preview App/runtime** for merchant/tester preview rather than generating a new store binary for every design iteration.

The Preview App:
- contains the approved AWJ Runtime capabilities;
- loads only authorized Preview Sessions;
- displays clear PREVIEW / environment identity;
- does not masquerade as the final merchant-branded production app;
- can report runtime/schema compatibility and diagnostics;
- should support Arabic/RTL and English/LTR exactly as production runtime does.

Final Apple/Google policy feasibility of the exact Preview App distribution model must be verified before implementation.

### Canvas fidelity rule

The web Builder canvas is allowed to be an authoring renderer, but it must not drift into a separate product implementation.

Component definitions should provide enough shared metadata/fixtures/contracts that Canvas and Mobile Runtime can be conformance-tested.

For critical components, maintain contract/visual-behavior test fixtures so:
- Builder preview says what the runtime can actually render;
- unsupported properties are not shown as available;
- runtime compatibility issues appear before publish.

### Preview data modes

Target modes:

1. **Sample Data** — safe fixtures for designing empty/new apps.
2. **Tenant Read Data** — authorized real catalog/content for realistic visual preview.
3. **Test/Sandbox Commerce** — safe end-to-end mutations where infrastructure exists.

Do not automatically use real customer PII in a shared tester preview.

### Diagnostics

Develop/Preview mode should be able to expose safe diagnostics such as:
- schema version;
- runtime version/capabilities;
- component/binding errors;
- API/resource request status without secrets;
- navigation/action events;
- compatibility fallback;
- environment;
- current preview snapshot.

Logs must redact tokens, credentials, sensitive customer/payment data and cross-tenant identifiers where not needed.

### Expiry, revoke and audit

Preview sessions need:
- automatic expiry;
- manual revoke;
- revoke-all for an app/user if necessary;
- creator/time/environment audit;
- last-use/device metadata only where privacy-appropriate.

Publishing a Draft does not have to keep old preview sessions alive; exact invalidation policy remains open.

### Offline behavior

Offline preview is not a V1 assumption.

If the production app later supports offline/cached experience behavior, Preview must deliberately test that capability. Do not let cached Draft data leak into a production session or another tenant/app.

### Release Candidate testing is distinct from Preview

```text
Builder Preview
   -> validates experience

Real Device Preview
   -> validates runtime + device interaction

Release Candidate/Beta
   -> validates actual branded binary + native/store configuration

Production Release
   -> reviewed/released artifact
```

Passing Level 1/2/3 does not prove signing/store/native configuration is correct; Level 4 exists for that reason.

### Open Decisions after Preview pass

- exact Canvas renderer implementation;
- exact Preview App distribution model;
- whether real-device Preview follows live draft or defaults to snapshots;
- guest/client preview sharing;
- device binding;
- preview session TTL;
- screenshot/video feedback capture;
- remote device logs;
- iOS/Android deep-link bootstrap details;
- sandbox checkout/payment provider matrix;
- Firebase App Distribution or another service adoption — no dependency selected;
- TestFlight/Play testing automation details;
- privacy rules for using real tenant/customer data in preview.

### Preview architecture conclusion

AWJ should use a **fast-to-high-fidelity preview ladder**:

> Canvas → Interactive Runtime → Real Device Preview → Release Candidate/Beta.

All levels use the same AWJ App Schema/capability contract, while authorization, tenant isolation and Draft/Published separation remain server-enforced.

---

## 22. Observability, validation and testing

Target platform needs:
- schema validation;
- runtime compatibility validation;
- component/action capability validation;
- preview/test diagnostics;
- publish validation;
- build/release logs and actionable errors;
- audit history;
- safe test data/environment boundaries;
- progressive tests from component/schema to commerce flow to release pipeline.

Financial, payment, auth and tenant-isolation paths require stronger tests and must not be weakened for release speed.

---

## 23. Product scope vs delivery phases

### AWJ Decision

Document the **complete target product** first, then phase delivery. Do not define a weak MVP architecture that blocks the full product.

Likely delivery decomposition will separate:
- foundation/schema/registry;
- visual builder;
- preview;
- commerce runtime;
- versions/publishing;
- engagement;
- developer workspace;
- app factory/release;
- advanced extensibility/SDK.

The actual sequence remains subject to architecture dependencies and implementation evidence.

---

## 23A. V1 Scope & Delivery Plan (2026-09-20)

### Delivery principle

Do not attempt to ship the entire long-term App Builder vision as one feature.

V1 should prove one complete merchant outcome:

> **A merchant can create a branded AWJ commerce app from an approved starting point, visually customize it within controlled capabilities, preview/test it, and move an authorized native release through a safe store-release workflow — while AWJ Commerce remains the source of truth.**

Every V1 item must contribute directly to that loop or to its security/reliability.

### V1 success boundary

V1 is complete only when the full path works:

```text
Create App
 -> choose Store Design / Template / Safe Blank
 -> configure identity/theme/navigation
 -> edit supported pages/components
 -> bind approved Commerce data/actions
 -> validate
 -> preview
 -> publish compatible Experience
 -> create native release when required
 -> build/sign/upload safely
 -> track store state
 -> verify released app against AWJ Commerce
```

A beautiful editor without release capability is not complete V1.
A build pipeline without safe visual editing is not complete V1.
A demo app disconnected from tenant-scoped Commerce is not complete V1.

### V1 — Must Have

#### 1. App Manager foundation
- Apps list;
- create app;
- app status;
- platform readiness;
- current Draft/Published experience;
- current iOS/Android release status;
- basic settings.

#### 2. Creation wizard
First-class paths:
- Use My Store Design;
- Choose a Template;
- Start From Scratch with Minimum Safe Shell.

V1 can begin with a small curated template set; marketplace/template ecosystem is later.

#### 3. App identity
- app display name;
- logo/icon source workflow;
- splash/brand basics where runtime/build supports them;
- Arabic/English identity/content;
- stable app identity record;
- stable iOS Bundle ID / Android package ID after native identity creation.

Changing branding must not casually regenerate platform identity.

#### 4. Shared brand/theme foundation
- import compatible Store/Shared Brand values;
- app override;
- Review Changes as preferred sync mode;
- Detect → Diff → Preview → Apply;
- explicit inherited vs overridden values.

V1 does not require every Store Customizer structure to map automatically to mobile.

#### 5. Controlled page set
Initial page capability should focus on commerce-critical flows:
- Home;
- Category/Collection;
- Search;
- Product Detail;
- Cart;
- Account/Auth entry;
- Orders/Order Detail where Commerce API readiness supports it;
- required legal/support/settings surfaces.

Checkout architecture may be native/runtime-driven or an approved secure flow depending on the Commerce API/payment readiness proved before implementation. Do not fake parity if backend/mobile contracts are not ready.

#### 6. Curated Component Registry
V1 should ship a bounded, high-quality registry rather than dozens of weak components.

Candidate minimum groups:

**Content**
- heading/text;
- image;
- banner/hero;
- spacer/divider where genuinely useful.

**Commerce**
- category/collection list;
- product grid/list;
- product card;
- product detail primitives or approved composed product screen;
- price;
- variant/options selector where supported;
- add-to-cart;
- cart summary;
- promotion/content callout.

**Layout**
- section/container;
- stack/row/grid abstractions constrained for mobile.

**Navigation**
- button/link;
- tab/bottom navigation configuration;
- approved menu/navigation elements.

Exact component list is finalized only after Commerce API/runtime proof.

#### 7. Visual Builder Design mode
- Pages / Components / Layers;
- Live Canvas;
- contextual Inspector;
- Content/Layout/Style;
- simple Data/Actions/Conditions;
- device viewport;
- Arabic/English + RTL/LTR;
- undo/redo;
- Draft save;
- validation/issues;
- impact-aware Publish.

#### 8. Develop mode — bounded V1
Include only what is needed to diagnose and configure the declarative runtime:
- resource/binding inspector;
- state inspector;
- event/action configuration;
- conditions;
- navigation;
- issues;
- sanitized diagnostics.

No arbitrary code editor.
No arbitrary package install.
No merchant-supplied executable runtime code in V1.

#### 9. Typed Data Source Registry
V1 resources are AWJ-owned and tenant-scoped.

Priority:
- catalog/categories/products;
- search;
- pricing/availability;
- cart;
- customer/account;
- orders;
- content needed by app pages.

Checkout/payment/shipping mutations enter the registry only after their mobile/public contracts satisfy security/idempotency/payment requirements.

#### 10. Action Registry
V1:
- navigation;
- safe UI/local state;
- approved catalog/cart/account actions;
- approved commerce mutations;
- authentication entry/logout;
- deep-link resolution for supported routes.

Sensitive actions remain backend-authorized.

No arbitrary HTTP action to merchant-provided URL in baseline V1.

#### 11. State/conditions
- app/session UI state where needed;
- page/component local state;
- navigation parameters;
- typed loading/error/empty states;
- small allowlisted condition/predicate set.

No general scripting language in V1.

#### 12. Draft / Published Experience versions
- immutable published versions;
- compatibility metadata;
- meaningful change summary;
- publish actor/time;
- Draft vs Published separation;
- compatible Experience rollback.

#### 13. Preview
V1 target:
- Canvas Preview;
- Interactive Runtime Preview;
- Real Device Preview through an authorized Preview Session;
- release-candidate beta path before store production release.

QR/session links are short-lived/revocable and do not grant tenant authority.

#### 14. Flutter runtime proof then runtime V1
Flutter remains Preferred, not Selected, until the documented proof gate passes.

If proof succeeds, V1 runtime includes:
- framework-neutral schema adapter;
- Component Registry;
- Action Registry;
- Data Binding;
- navigation;
- theme;
- localization/RTL;
- compatibility/fallback;
- secure auth/session integration;
- diagnostics needed for preview/support.

Do not start broad component production before the proof gate closes the technology choice.

#### 15. Update classification
Every publish/release diff classified as:
- Experience only;
- iOS native;
- Android native;
- both native;
- mixed.

Compatibility prevents publishing experience references unsupported by installed runtimes.

#### 16. App Factory minimum safe release path
- immutable build manifest;
- isolated/ephemeral build worker;
- tenant/app authorization;
- secret-manager integration;
- signing;
- artifact digest;
- validation;
- upload;
- external store-state tracking;
- retry/idempotency;
- audit.

#### 17. Merchant-owned store connection
V1 default:
- merchant-owned Apple/Google developer accounts;
- delegated least-privilege AWJ access;
- readiness checks;
- no account-password collection;
- credential health/revoke flow.

#### 18. Release Center
V1:
- iOS/Android readiness;
- build status;
- submission status;
- review/action-required;
- approved/released;
- phased/staged state where integrated;
- raw external status available to support/admin diagnostics;
- clear distinction between store availability and device-installed version.

No claim that all customer devices updated merely because release completed.

#### 19. Security / Tenant Isolation
Release-blocking requirements:
- tenant-scoped resources;
- server authorization for every sensitive action;
- no schema secrets;
- preview isolation;
- build isolation;
- per-app/account credential boundary;
- redacted logs;
- audit;
- cross-tenant negative tests;
- OWASP MASVS-informed mobile verification.

#### 20. Observability and support
Minimum correlation:
- tenant/app;
- Draft/Published experience version;
- runtime/binary version;
- build/release ID;
- external store identifiers;
- action/resource error correlation without secret/PII leakage.

### V1 — Should Have if schedule allows

- basic push notification sending/campaigns using already-supported native push capability;
- deep-link campaign targets;
- reusable merchant sections;
- a small number of polished app templates;
- app analytics basics;
- version comparison UI;
- richer preview diagnostics;
- release notes workflow;
- staged/phased rollout controls where official APIs and account roles allow;
- basic minimum-supported-runtime policy;
- simple scheduled content visibility.

These must not delay the secure core loop.

### Explicitly Later / Not V1

- arbitrary merchant JavaScript/Dart/native code;
- arbitrary third-party package installation;
- public extension marketplace;
- full no-code workflow programming;
- complex loops/branching orchestration;
- custom merchant backend functions;
- arbitrary HTTP integrations from client runtime;
- AI-generated executable code in production runtime;
- full offline-first commerce;
- Google-Docs-style live collaborative editing;
- large template marketplace;
- multi-app portfolio automation beyond the core manager;
- fully automated unattended production release by default;
- AWJ-owned developer accounts as default;
- instant one-click app transfer;
- advanced campaign automation/journeys;
- advanced attribution/marketing analytics;
- universal custom native plugin marketplace;
- desktop/tablet app targets;
- Apple/Google platform parity for features that do not naturally map.

### Dependency gates before implementation phases

#### Gate A — Commerce API readiness
Confirm mobile-safe contracts for:
- catalog/search;
- pricing/availability;
- cart;
- auth/customer;
- orders;
- checkout;
- payments;
- shipping.

Do not make App Builder invent parallel commerce logic to compensate for missing APIs.

#### Gate B — Runtime proof
Close Flutter proof gate before broad runtime implementation.

#### Gate C — Store-account automation proof
Using non-production/test developer setup where possible, prove:
- delegated Apple access;
- chosen Apple signing path;
- Google API/service identity;
- Play App Signing/upload flow;
- build/upload automation;
- secret rotation/revoke.

#### Gate D — Preview security proof
Prove:
- session expiry/revoke;
- tenant negatives;
- Draft endpoint isolation;
- sandbox mutation behavior;
- no secret leakage.

### Proposed delivery sequence

#### Phase 0 — Architecture closure & contracts
**No production feature implementation yet.**

Outputs:
- V1 component/resource/action inventory;
- Commerce API readiness matrix;
- Flutter proof;
- App Schema V1 contract;
- compatibility contract;
- Preview Session threat model;
- App Factory/store credential proof;
- security test plan.

Exit: no unresolved P0 architectural risk blocking implementation.

#### Phase 1 — Runtime + schema foundation
Build:
- schema validation/versioning;
- Component Registry foundation;
- Data/Action registries;
- navigation/theme/localization;
- compatibility/fallback;
- minimal representative components.

Exit: deterministic test app renders from schema on iOS/Android and passes tenant/auth/security basics.

#### Phase 2 — Builder foundation
Build:
- App Manager;
- creation wizard;
- Pages/Components/Layers;
- Canvas;
- metadata-driven Inspector;
- Draft persistence;
- validation/issues.

Exit: merchant can create/customize a representative app without editing raw schema.

#### Phase 3 — Commerce vertical slice
Wire one complete customer journey:
- Home/catalog;
- product;
- options where supported;
- cart;
- auth/account;
- checkout/payment only when Gate A contracts are ready.

Exit: representative end-to-end commerce flow against tenant-scoped AWJ backend.

#### Phase 4 — Preview & publishing
Build:
- Interactive Preview;
- Preview Sessions;
- real-device Preview;
- Draft/Published versions;
- compatibility-aware Publish;
- rollback of compatible experience.

Exit: merchant can safely test a Draft and publish an Experience version without native rebuild when eligible.

#### Phase 5 — App Factory
Build:
- immutable manifests;
- isolated workers;
- secret integration;
- iOS/Android build/sign;
- store connection;
- upload;
- Release Center state machine;
- audit/idempotency.

Exit: authorized test merchant app can move from AWJ to official pre-release/store workflow with no manual secret copying through chat/UI fields.

#### Phase 6 — Production hardening
- MASVS/platform checks;
- cross-tenant negatives;
- credential rotation/revoke;
- build-worker isolation tests;
- failure/retry/duplicate-submission tests;
- accessibility/RTL;
- runtime compatibility matrix;
- observability/support runbooks;
- Apple/Google rejection/action-required flows.

Exit: production release candidate approved through AWJ's release checklist.

#### Phase 7 — Engagement & expansion
Only after core lifecycle is stable:
- push/campaigns;
- app promotions;
- analytics expansion;
- automation;
- reusable sections/templates;
- broader component catalog;
- extension architecture research.

### Parallelism rules

Some work can run in parallel after contracts are stable:
- Builder UI and runtime components;
- App Factory proof and Preview architecture;
- documentation/test fixtures.

Do **not** parallelize by inventing competing contracts. App Schema, Component Definition, Action Definition and Commerce resource contracts are shared foundations and need one owner/versioned decision path.

### PR strategy

Implementation should use small, independently reviewable PRs rather than one “App Builder” mega-PR.

Candidate streams after Phase 0:
- APP-SCHEMA-1;
- APP-RUNTIME-1;
- APP-BUILDER-1;
- APP-COMMERCE-1;
- APP-PREVIEW-1;
- APP-PUBLISH-1;
- APP-FACTORY-1;
- APP-RELEASE-1;
- APP-SEC-1.

Exact naming/order can change after dependency analysis.

Each PR must preserve:
- Tenant Isolation;
- backward compatibility;
- no unrelated refactor;
- focused tests;
- no merge/deploy without explicit approval.

### Definition of Done for App Builder V1

V1 is not “done” because screens exist.

It requires evidence that:

1. merchant can create an app through one of the supported creation paths;
2. merchant can visually customize the supported V1 surface;
3. app reads/mutates AWJ Commerce only through authorized tenant-scoped capabilities;
4. Arabic RTL and English LTR work on both target platforms;
5. Draft/Published are isolated;
6. Preview cannot bypass tenant/auth;
7. Experience updates respect installed-runtime compatibility;
8. native-impacting changes are correctly classified;
9. iOS/Android artifacts build reproducibly from immutable inputs;
10. signing credentials remain isolated and auditable;
11. store submission/release state is tracked truthfully;
12. failures/retries do not duplicate dangerous external operations;
13. cross-tenant negative tests pass;
14. security/accessibility/platform verification passes at the agreed baseline;
15. production verification is completed for an explicitly approved pilot app.

Only then should V1 be marked complete.

### Recommended immediate next artifact

Before implementation, create the **AWJ App Builder V1 Contract Pack**:

1. `APP_SCHEMA_V1.md`
2. `COMPONENT_REGISTRY_V1.md`
3. `ACTION_REGISTRY_V1.md`
4. `DATA_RESOURCE_REGISTRY_V1.md`
5. `RUNTIME_COMPATIBILITY_V1.md`
6. `PREVIEW_SESSION_SECURITY_V1.md`
7. `APP_FACTORY_SECURITY_V1.md`
8. `COMMERCE_MOBILE_API_READINESS.md`

The master architecture remains the decision record; these become implementation-facing contracts.

---

## 24. Open decisions

Do not silently close these:

- Flutter vs React Native vs native runtime;
- exact serialized schema;
- exact expression/data-binding model;
- final Component Registry contract;
- final Action/Event contract;
- production SDUI/runtime dependency vs narrow AWJ renderer;
- exact Visual Builder UI;
- exact real-device preview mechanism;
- exact Store ↔ App theme sync contract and UX labels;
- V1 component/block list;
- release/build/signing infrastructure;
- Apple/Google account ownership and delegated-access model;
- exact update classification matrix;
- public developer SDK timing;
- custom code/extensions security model;
- AI-assisted design;
- pricing/entitlements;
- segmentation/personalization scope.

---

## 25. Next evidence passes

Proceed in this order unless new evidence changes dependencies:

1. **Data Binding + State + Actions + Events + Security**
2. **Apple/Google Update & Release Matrix** — official docs first
3. **Runtime technology comparison** — Flutter / React Native / native against AWJ requirements
4. **Preview architecture**
5. **Build/signing/submission automation**
6. **Visual Builder UX/architecture**
7. **V1 capability/component contract**

Each pass updates this document with evidence, AWJ decision, and remaining open items.

---

## 26. Source/evidence register

### Existing repository evidence
- `docs/plans/store/AWJ_MOBILE_APP_BUILDER_BENCHMARK.md` — baseline benchmark and initial architecture direction.

### Visual Builder / Developer Workspace evidence added 2026-09-20
- Tapcart developer/product documentation — screen/block/component editing, merchant-editable fields, preview and developer extensibility patterns.
- FlutterFlow documentation — visual widget hierarchy, properties, actions, backend/data, state and conditional-logic workspace patterns (benchmark only; no framework-contract coupling).
- Webflow documentation — Navigator/Layers, canvas and contextual style/settings editor mental model (benchmark only).
- Shopify Help — theme editor section/block customization and live preview patterns.

### Build/signing/store ownership evidence added 2026-09-20
- Apple Developer — Program enrollment, organization identity/D-U-N-S and contract-developer ownership guidance.
- Apple Developer / App Store Connect — account roles, app-scoped access, API keys and API access.
- Apple Developer — certificates overview and cloud-managed certificates.
- App Store Connect — upload builds, choose build, submit to App Review.
- App Store Connect — app transfer overview and transfer criteria, including capability-specific transfer effects.
- Google Play Console — organization developer account requirements and identity verification.
- Google Play Console — users and permissions, including app-level vs account-level access.
- Google Play Developer API — service account/OAuth access and secure server credential guidance.
- Google Play Console — Play App Signing, upload key vs Google-held app signing key, upload-key reset.
- Google Play Console — app/account transfer documentation.

### Preview architecture evidence added 2026-09-20
- Flutter official documentation — hot reload and build modes; development iteration is distinct from release binaries.
- Apple Developer — TestFlight beta testing and tester/build workflow.
- Google Play Console / Android Developers — testing tracks and pre-release distribution mechanisms.
- Firebase App Distribution official documentation — controlled pre-release tester distribution (evidence only; no dependency selected).
- Existing AWJ benchmark — Tapcart / Shopney live and real-device preview product patterns.

### Runtime technology evidence added 2026-09-20
- Flutter official documentation — architectural overview; platform channels/platform-specific code; internationalization and direction-aware UI.
- React Native official documentation — core architecture/New Architecture; native modules/components; platform-specific code; I18nManager RTL support; security guidance.
- Apple Developer — SwiftUI first-party declarative UI documentation.
- Android Developers — Jetpack Compose first-party declarative UI documentation.

### Apple/Google Update & Release evidence added 2026-09-20
- Apple App Review Guidelines — 2.5.2 self-contained bundle / downloaded executable-code boundary.
- App Store Connect Help — Create a new version; Submit an app; release options; phased release for automatic updates.
- Apple Support — App Store apps automatically update by default on iPhone/iPad, with user control/manual updates.
- Google Play Console Help — Update or unpublish your app; Prepare and roll out a release; staged rollouts; submission activity.
- Google Play Developer Program Policy — Device and Network Abuse / official Play update mechanism and executable-code restrictions.
- Android Developers — Google Play In-App Updates (Flexible and Immediate flows).
- Google Play Android Developer API — publishing/release automation surface.

### 04B evidence sources added 2026-09-20
- Digia Academy — Variables; State Management; Action Catalog; Pages/lifecycle actions.
- Android Developers — App Architecture / Data Layer / source-of-truth guidance.
- OWASP MASVS / MASTG — mobile security verification control model.
- React Native official Security guide — secret handling, secure storage, network and deep-link security evidence (reference only; not a runtime selection).
- Apple Developer — Keychain Services; Universal Links and validation guidance.
- Firebase Remote Config official docs — remote configuration, real-time updates, version/build targeting and explicit security/platform-policy limitations (reference only; not a dependency decision).

### External sources already used during the research conversation

These are retained as an evidence queue and must be re-checked for freshness when their claims become implementation requirements:

- Salla Help Center — App Builder/design/subscription/launch documentation.
- Zid Help Center — mobile app creation/subscription and unified commerce administration documentation.
- Tapcart Developer Documentation — App Studio, blocks/components, developer tooling, versions/publishing/CI concepts.
- Shopney Support — preview and post-launch design/update behavior.
- Digia documentation/repository — SDUI, state/data, actions, custom widgets; licensing requires explicit clearance before code adoption.
- Apple Developer — App Review / Developer Program terms and release/update documentation; official source is authoritative for iOS.
- Google Play Console / Android developer policy documentation — dynamic code, release/update and store behavior; official source is authoritative for Android distribution.
- Firebase Remote Config — useful evidence for app-version-aware remote configuration patterns; not an AWJ runtime decision.

### Evidence hygiene

A source appearing in this register does not automatically approve its implementation pattern or license. Every implementation-sensitive claim must point to a current, authoritative source during the relevant evidence pass.

---

## 27. Recovery completeness checklist

This recovery pass explicitly captures the decisions discussed after the original benchmark:

- [x] complete App Builder vision, not a simple editor;
- [x] UI/UX + Developer Workspace + Preview as first-class product areas;
- [x] App Manager and product information architecture;
- [x] Store Customizer / App Builder / App Factory separation;
- [x] Use My Store Design / Template / Scratch creation paths;
- [x] shared brand/theme foundation;
- [x] controlled theme sync, diff, preview, overrides/conflicts;
- [x] mobile UX not literal web-layout copying;
- [x] Commerce Core as source of truth;
- [x] live/interative/real-device preview direction;
- [x] draft/published/version/rollback direction;
- [x] declarative versioned App Schema direction;
- [x] Component Definition vs Component Instance;
- [x] Component Registry and metadata-driven Inspector direction;
- [x] controlled Action Registry;
- [x] no arbitrary remote business-code execution;
- [x] tenant isolation/security boundary;
- [x] WebView is not the primary runtime;
- [x] commerce capability parity requirement;
- [x] Engagement as a first-class area;
- [x] Release Center per platform;
- [x] Instant/runtime update vs native build vs store release vs end-user installation distinction;
- [x] explicit Apple/Google official-evidence requirement for update behavior;
- [x] evidence-first documentation rule;
- [x] external benchmark must extract the best **and** the best fit for AWJ;
- [x] no final Flutter/React Native/native choice yet;
- [x] no final schema/JSON contract yet.

If a later review finds a missing decision from the conversation or prior documents, add it explicitly rather than relying on memory.
