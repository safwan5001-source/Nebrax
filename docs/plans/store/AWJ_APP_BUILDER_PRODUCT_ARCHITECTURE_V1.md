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

## 21. Localization, RTL and accessibility

### AWJ Requirement

The builder and produced app experiences must treat Arabic/RTL and English/LTR as first-class concerns.

Preview/testing must make locale/direction differences visible before publish.

Component definitions should carry accessibility requirements/metadata where appropriate. The builder must not make accessible behavior optional merely because the visual output “looks correct.”

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
