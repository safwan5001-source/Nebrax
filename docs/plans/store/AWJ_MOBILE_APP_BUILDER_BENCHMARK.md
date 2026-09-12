# AWJ Mobile App Builder — Benchmark & Architecture Direction

**Status:** Research / architecture direction — not a final implementation or technology decision  
**Date:** 2026-09-12

## 1. Purpose

AWJ Store should provide a professional **mobile commerce app builder** for merchants. The goal is not to manually build and integrate a separate mobile application for every AWJ customer.

A merchant should be able to configure and design their own branded iOS/Android storefront application from inside AWJ, while AWJ remains the source of truth for commerce and ERP data.

A ready-made standalone storefront application may still be useful for a specific private store, but it does not solve the AWJ customer-platform requirement.

## 2. Commercial benchmark direction

No single platform is the complete reference. Current lessons:

- **Salla:** regional merchant journey, templates, preview, launch/publishing workflow.
- **Zid:** unified commerce administration; the app must not become a second product/order/payment management system.
- **Tapcart:** strongest current reference for builder architecture, reusable blocks, extensibility, versions and publishing.
- **OneMobile:** merchant-friendly Screen → Blocks → Properties → Preview mental model.
- **Shopney:** strong preview model and clear separation between remotely configurable experience changes and application binary updates.
- **Vajro / Superfans:** commerce widgets, content controls, scheduling and navigation.
- **Shopify ecosystem:** broad competitive reference for mobile builders, push, integrations and mature editor patterns.

## 3. Product principle

**AWJ App Builder is not a generic no-code application builder.** It is a specialized mobile-commerce experience builder tightly integrated with AWJ Store.

When a merchant inserts a `Products` block, they should not configure an API endpoint. AWJ already knows the tenant's products, categories, prices, availability and commerce configuration.

Commerce operations remain backed by AWJ Store capabilities, including products, customers, inventory, pricing, orders, payments, shipping and related business data.

## 4. Architecture direction

### 4.1 Visual Experience Builder

Merchant-facing workspace:

- screens/pages;
- sections/blocks;
- drag/drop and reordering;
- property inspector;
- navigation;
- themes/branding;
- visibility and scheduling;
- live mobile preview;
- draft/save/publish;
- experience version history.

Conceptually:

```text
┌─────────────────────────────────────────────┐
│ Home | Search | Product | Cart | Account    │
├────────────┬───────────────────┬────────────┤
│ BLOCKS     │                   │ PROPERTIES │
│ Banner     │    LIVE PREVIEW   │ Content    │
│ Products   │     ┌───────┐     │ Layout     │
│ Categories │     │ Phone │     │ Spacing    │
│ Slider     │     │       │     │ Visibility │
│ Video      │     └───────┘     │ Schedule   │
│ Countdown  │                   │ Link       │
└────────────┴───────────────────┴────────────┘

Branding | Navigation | Push | Releases
```

This is conceptual, not a locked visual specification.

### 4.2 AWJ Experience Contract / Schema

The builder should produce a structured, versioned contract rather than hard-coding a unique application per merchant.

```text
Merchant edits experience
        ↓
AWJ App Builder
        ↓
Versioned AWJ Experience Contract
        ↓
Validate → Save → Preview → Publish
        ↓
AWJ Store API
        ↓
Trusted Mobile Commerce Runtime
```

The exact serialized format is not decided. JSON is a candidate, but the important decision is that the contract is **typed, versioned, validated and capability-limited**.

Candidate conceptual node:

```text
Component
├── id
├── type
├── typed props
├── children
├── visibility
├── data binding reference
└── controlled action reference
```

### 4.3 Trusted Mobile Commerce Runtime

A reusable iOS/Android runtime interprets only supported AWJ Experience Contract capabilities.

The runtime owns trusted commerce behavior:

- authentication/customer session;
- catalog/product behavior;
- cart;
- checkout;
- payments;
- orders;
- shipping/delivery;
- push notifications;
- deep links;
- device/platform integrations.

The runtime technology (Flutter, React Native, native, or another approach) remains undecided.

### 4.4 AWJ Store API

AWJ remains the commerce source of truth. The builder/runtime must preserve:

- tenant isolation;
- authorization;
- data integrity;
- inventory consistency;
- pricing/tax rules;
- backward compatibility;
- secure customer access.

The builder must not create an independent copy of core commerce data unless a deliberately designed cache/read model is required.

## 5. Security boundary — server controls experience, runtime controls behavior

This is now a core architecture direction.

**The server-driven contract may control presentation and approved experience configuration, but it must not be allowed to inject arbitrary business logic.**

Preferred boundary:

```text
AWJ Server / Builder
   │
   ├── layout
   ├── section ordering
   ├── content
   ├── approved navigation
   ├── visual properties
   ├── visibility
   └── scheduling
            ↓
     Experience Contract
            ↓
┌─────────────────────────┐
│ Trusted AWJ App Runtime │
├─────────────────────────┤
│ Products                │
│ Cart                    │
│ Checkout                │
│ Payments                │
│ Customer                │
│ Orders                  │
│ Shipping                │
└─────────────────────────┘
```

For example, the contract may request an approved `CheckoutButton`, but it must not provide arbitrary payment execution logic. `CheckoutButton` behavior remains compiled, reviewed AWJ runtime code subject to AWJ rules.

This boundary is particularly important for payment, authentication, tenant isolation, authorization, pricing/tax and other sensitive operations.

## 6. Runtime contract safeguards

Current recommended safeguards for the eventual AWJ runtime:

### 6.1 Versioned schema

Every published experience must identify a supported schema/contract version. Runtime compatibility must be explicit rather than inferred.

### 6.2 Allowlisted Component Registry

The runtime renders only component types registered in the shipped AWJ runtime. Unknown/arbitrary component types must not gain execution capability.

### 6.3 Typed properties

Component properties should be validated against explicit definitions. Avoid arbitrary untyped property bags where security or compatibility can be affected.

### 6.4 Controlled actions

Actions should resolve through an approved action/capability registry rather than arbitrary executable expressions or remote code.

### 6.5 Compatibility validation

Publishing should verify that the target runtime/app version supports the requested schema version, components, properties and capabilities.

### 6.6 Safe fallback behavior

The contract/runtime design must define behavior for unsupported components or newer schema capabilities. A malformed/new experience must not unnecessarily break the entire storefront.

## 7. Block model and extensibility

AWJ should ship a curated official commerce block library. Candidate categories:

- banners/sliders;
- category grids/lists;
- product grids/sliders;
- featured/recommended products;
- brands;
- image + CTA;
- video;
- countdown/campaign;
- promotional content;
- navigation shortcuts.

The architecture should allow AWJ to add blocks without redesigning the builder.

A future extension model may allow developers to define new blocks while exposing only safe merchant-editable properties. This does **not** mean a public SDK is required in V1; V1 should simply avoid blocking future extensibility.

## 8. Experience versioning and publishing

Target conceptual lifecycle:

```text
Draft
  ↓
Validate
  ↓
Preview / Test
  ↓
Publish
  ↓
Published Experience Version
```

Future capabilities may include duplicate version, scheduled publish, scheduled block visibility, rollback, audit history and—only if justified later—targeted experiences/segments.

AWJ should distinguish:

1. **Experience Publish** — remote configuration/content change.
2. **Application Release** — build, QA, signing, store submission and binary version lifecycle.

Ordinary merchandising changes should not require rebuilding/resubmitting the app where platform rules and runtime capabilities permit.

## 9. Preview direction

Target maturity levels:

1. live visual preview inside AWJ;
2. responsive/state preview for supported screens;
3. preview/test using the real mobile runtime/device;
4. safe test commerce flows where sandbox infrastructure exists;
5. push/deep-link testing before production release.

V1 boundary remains undecided.

## 10. SDUI / runtime open-source research

No runtime project is approved for production adoption.

### Digia UI

**Assessment:** strong architecture/reference; do not adopt directly at this stage.

Why it is relevant:

- Flutter-oriented server-driven UI architecture;
- visual Studio + runtime pattern;
- pages/components;
- data binding/actions/state concepts;
- custom widget extensibility;
- supports a hybrid direction where sensitive capabilities can remain compiled/native while presentation is server-driven.

Primary blocker:

- current Business Source License terms create commercial/competitive-use concerns for AWJ App Builder;
- therefore treat Digia as an architectural reference unless licensing is explicitly cleared.

### ServeDynamicUI

**Assessment:** promising MIT-licensed proof-of-concept/runtime research candidate, not yet an approved dependency.

Relevant ideas/capabilities include:

- JSON-driven Flutter UI;
- custom widgets;
- custom actions;
- forms/state behavior;
- remote configuration patterns;
- component/handler registration concepts.

Concern:

- project maturity, maintenance, tests, security posture and long-term suitability require code-level review before considering production dependency.

### flutter-server-driven-ui

**Assessment:** useful architecture reference.

Particularly valuable ideas:

- explicit `schemaVersion`;
- Component Registry;
- contract validation;
- expression/data concepts;
- structured server-driven component representation.

AWJ may adopt these architectural patterns without adopting the repository itself.

### XWidget

**Assessment:** useful security/release architecture reference.

Most important lesson:

> server controls experience; compiled runtime controls trusted behavior.

Also relevant are concepts around versioned UI bundles, release channels/staged rollout and keeping services/credentials/permissions/business rules in compiled application code.

### Digia licensing conclusion

Do not use Digia code as a core AWJ dependency without explicit license/legal clearance. Architecture study is separate from code adoption.

### Current runtime recommendation

Do **not** select a production SDUI dependency yet.

Preferred current direction:

- AWJ owns the Experience Contract;
- AWJ owns security/capability boundaries;
- AWJ owns compatibility/version semantics;
- evaluate whether an MIT/Apache runtime library can safely provide rendering primitives;
- otherwise implement the narrow AWJ renderer needed by the commerce runtime rather than adopting a broad low-code execution engine.

## 11. Initial capability benchmark

| Capability | Target for AWJ |
|---|---|
| Merchant-specific branded app | Required |
| iOS + Android | Required |
| No-code merchant configuration | Required |
| Screen + Block mental model | Required |
| Commerce-aware blocks | Required |
| Drag/drop/direct manipulation | Required |
| Property inspector | Required |
| Live mobile preview | Required |
| Templates | Required |
| Navigation editor | Required |
| Server-driven presentation | Required direction |
| Draft/publish separation | Required |
| Versioned Experience Contract | Required |
| Allowlisted Component Registry | Required |
| Typed/validated props | Required |
| Controlled Action Registry | Required |
| Runtime compatibility validation | Required |
| Experience versioning | Required direction |
| Scheduled content/publishing | Strong target |
| Rollback/history | Strong target |
| Push notifications | Required |
| Unified AWJ commerce administration | Required |
| App build/release lifecycle | Required |
| Extensible/custom block architecture | Required direction |
| Public developer SDK | Later / undecided |
| AI-assisted design | Later / optional |

## 12. Open-source research status

Research candidates/references currently include:

- Digia UI — architecture/reference; licensing concern;
- ServeDynamicUI — MIT runtime research candidate;
- flutter-server-driven-ui — schema/registry architecture reference;
- XWidget — security/release architecture reference;
- OSMEA — commerce/mobile architecture candidate; licensing must be reviewed carefully;
- App Creaty — visual editor concepts;
- FlutterBuilder — schema-driven rendering/export concepts;
- Frappe Studio — visual builder architecture/UX reference.

Presence in this document does not authorize copying, dependency adoption or architectural commitment.

Before reusing code, review license compatibility, repository health, security, architecture, RTL/localization, performance, tests and AWJ integration feasibility.

## 13. Next phase — Visual Editor Architecture Hunt

The next research target is the **web visual editor inside AWJ**, especially because the AWJ management UI uses Next.js/React.

Search/evaluate open-source projects and libraries for:

1. drag/drop canvas or structured layout editing;
2. component/block palette;
3. component tree/layers;
4. property inspector;
5. selection/focus/keyboard behavior;
6. undo/redo/history;
7. phone/device preview;
8. serialization into an AWJ-owned schema rather than vendor-specific runtime data;
9. RTL/bilingual suitability;
10. accessibility and keyboard operation;
11. extensible component definitions;
12. license compatibility with commercial SaaS.

Priority is **not** finding a complete generic website builder. The goal is to identify safe, maintainable primitives for building a commerce-specific Tapcart-style editor inside AWJ.

## 14. Decisions explicitly NOT made

Still open:

- Flutter vs React Native vs native runtime;
- exact serialized Experience Contract format;
- exact visual builder UI;
- production SDUI library selection;
- whether any open-source builder code will be reused;
- build/signing infrastructure;
- app-store account ownership model;
- pricing/plan entitlement;
- public SDK timing;
- AI design generation;
- final V1 block list;
- preview/test-device mechanism;
- segmentation/personalization scope.

---

**Current recommendation:** AWJ should own its Experience Contract and trusted commerce behavior. Treat open-source SDUI projects as runtime/reference candidates rather than surrendering the product architecture to a generic low-code engine. Continue with the Visual Editor Architecture Hunt before defining V1 or writing production implementation code.