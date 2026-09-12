# AWJ Mobile App Builder — Benchmark & Architecture Direction

**Status:** Research / architecture direction — not a final implementation or technology decision  
**Date:** 2026-09-12

## 1. Purpose

AWJ Store should provide a professional **mobile commerce app builder** for merchants. The goal is not to manually build and integrate a separate mobile application for every AWJ customer.

A merchant should be able to configure and design their own branded iOS/Android storefront application from inside AWJ, while AWJ remains the source of truth for commerce and ERP data.

A ready-made standalone storefront application may still be useful for a specific private store, but it does not solve the AWJ customer-platform requirement.

## 2. Commercial benchmark direction

The benchmark is based on documented behavior of established commerce platforms and mobile app builders. No single platform is the complete reference; AWJ should combine the strongest patterns while keeping AWJ's own commerce model and product constraints.

### 2.1 Salla — regional merchant journey

Use as a primary regional reference for:

- merchant-facing mobile app builder workflow;
- branded iOS/Android applications;
- configurable home-page elements and templates;
- navigation and launch/welcome screens;
- in-builder application preview;
- publishing / launch workflow;
- ability to update significant presentation configuration without requiring a new store release for every visual change.

### 2.2 Zid — unified commerce administration

Use as a reference for the principle that the mobile application must not become a second commerce-management system:

- products, categories, orders, payments, shipping, and other commerce data continue to be managed through the main platform;
- the mobile application is a customer-facing sales channel over the existing commerce platform;
- merchant operations should remain unified rather than duplicated in a separate app-management back office.

### 2.3 Tapcart — primary architecture/product reference

Tapcart is currently the strongest benchmark for the **overall builder architecture and extensibility model**.

Patterns to study/adapt:

- App Studio based on reusable blocks;
- add/remove/reorder components;
- navigation and branding controls;
- multi-page layouts;
- saved/duplicated experience versions;
- scheduled publishing;
- ability to target/differentiate experiences where appropriate;
- developer extensibility through custom blocks/components;
- separation between developer-defined component capabilities and merchant-editable properties.

A particularly important pattern is the two-layer model:

1. **Merchant layer:** visual/no-code editing.
2. **Developer layer:** SDK/tooling for defining new commerce-aware blocks and the properties merchants are allowed to configure.

AWJ should preserve this extensibility direction even if a public/custom developer SDK is not part of V1.

### 2.4 OneMobile — screen + blocks simplicity

Use as a reference for a simple mental model for merchants:

> Select screen → add blocks → configure properties → preview.

Relevant patterns include:

- explicit screen selection (Home, Search, Product Details, Cart, Account, etc.);
- commerce-oriented blocks;
- direct manipulation/reordering;
- block-level image/text/layout/spacing configuration;
- custom screens as a possible later capability.

This model is preferable to presenting merchants with a generic concept of “building an app.”

### 2.5 Shopney — preview and release boundary

Use as a primary reference for:

- drag-and-drop composition;
- commerce-oriented blocks and sections;
- live/mobile preview;
- reusable layouts/showcases;
- testing the experience before launch;
- separation between remotely configurable experience changes and changes that require a new application binary/version.

A key lesson is that design/navigation/merchandising changes should be remotely publishable when technically and policy-wise appropriate, while binary/native changes follow a separate application release lifecycle.

### 2.6 Vajro / Superfans — widgets and scheduling

Use as a reference for:

- Theme / Branding / Content / Navigation separation;
- commerce widgets such as product grids/sliders, banners, image grids, video, countdowns, etc.;
- widget operations such as duplicate, hide, delete, and schedule;
- scheduled merchandising content.

Scheduling is strategically useful for campaigns such as seasonal offers, launches, and time-limited promotions.

### 2.7 Shopify ecosystem

Use the Shopify Mobile App Builder ecosystem as a wider competitive benchmark for:

- drag-and-drop mobile storefront editors;
- push notifications;
- templates;
- merchandising components;
- app publishing and lifecycle management;
- mature third-party builder UX patterns;
- extensibility and integrations.

Further deep review may include Tapcart, Vajro/Superfans, OneMobile, Shopney, and other high-quality Shopify mobile app builders where they expose useful architecture/product behavior.

## 3. Product principle

**AWJ App Builder is not a generic no-code application builder.**

It should be a specialized mobile-commerce experience builder tightly integrated with AWJ Store.

For example, when a merchant inserts a `Products` block, they should not configure an API endpoint. AWJ already knows the tenant's products, categories, prices, availability, and commerce configuration.

The builder should expose business-aware choices such as:

- select category;
- select collection/product set;
- featured products;
- offers/promotions;
- brands;
- banners and calls to action;
- navigation destinations.

Commerce operations remain backed by AWJ Store capabilities, including products, customers, inventory, pricing, orders, payments, shipping, and related business data.

## 4. Proposed architecture direction

The current direction is composed of four major parts.

### 4.1 Visual Experience Builder

Merchant-facing workspace for composing the application experience:

- screens/pages;
- sections/blocks;
- drag and drop/reordering;
- block properties;
- navigation;
- themes and branding;
- visibility controls;
- scheduling where applicable;
- live mobile preview;
- draft/save/publish workflow;
- experience version history.

A conceptual workspace:

```text
┌─────────────────────────────────────────────┐
│ Home | Search | Product | Cart | Account    │
├────────────┬───────────────────┬────────────┤
│ BLOCKS     │                   │ PROPERTIES │
│            │    LIVE PREVIEW   │            │
│ Banner     │                   │ Content    │
│ Products   │     ┌───────┐     │ Layout     │
│ Categories │     │ Phone │     │ Spacing    │
│ Slider     │     │       │     │ Visibility │
│ Video      │     └───────┘     │ Schedule   │
│ Countdown  │                   │ Link       │
└────────────┴───────────────────┴────────────┘

Branding | Navigation | Push | Releases
```

This is a conceptual product model, not a locked visual specification.

### 4.2 App Experience Schema

The builder should produce a structured, versioned representation of the application experience rather than hard-coding a unique application for every merchant.

Conceptually:

```text
Merchant edits experience
        ↓
AWJ App Builder
        ↓
Versioned App Experience Schema
        ↓
Save / Preview / Publish
        ↓
AWJ Store API
        ↓
Mobile Commerce Runtime
```

JSON or an equivalent structured format is a candidate representation. The exact schema and storage model are **not yet decided**.

The schema should be designed for compatibility/version evolution rather than allowing arbitrary unversioned configuration.

### 4.3 Mobile Commerce Runtime

A reusable iOS/Android runtime interprets the published experience configuration and renders the merchant's storefront while communicating with AWJ Store APIs.

This runtime should provide the native/mobile commerce capabilities that should not be recreated by the visual editor itself, such as:

- authentication/customer session;
- catalog and product details;
- cart and checkout;
- orders;
- payment integrations;
- shipping/delivery experience;
- push notifications;
- deep links;
- device/platform integrations.

The runtime technology (Flutter, React Native, native, or another approach) is **not decided**.

### 4.4 AWJ Store API

AWJ remains the commerce source of truth. The application builder and runtime must respect existing AWJ requirements for:

- tenant isolation;
- authorization;
- data integrity;
- inventory consistency;
- pricing and tax rules;
- backward compatibility;
- secure customer access.

The mobile app builder must not introduce an independent copy of core commerce data unless a deliberately designed cache/read model is required.

## 5. Block model and future extensibility

AWJ should ship with a curated library of official commerce blocks. The exact V1 list is not yet decided, but candidate categories include:

- banners and sliders;
- category grids/lists;
- product grids/sliders;
- featured/recommended products;
- brands;
- image + CTA;
- video;
- countdown/campaign blocks;
- promotional content;
- navigation shortcuts.

The architecture should allow AWJ to add new blocks without redesigning the builder.

A future developer/extension model should allow a developer to define a new block and explicitly expose only safe merchant-editable properties. Examples of future blocks could include:

- loyalty;
- store locator;
- size guide;
- restaurant booking where relevant;
- custom upsell;
- specialized industry components.

This does **not** mean a public App Builder SDK must ship in V1. It means V1 architecture must avoid making future extensibility unnecessarily difficult.

## 6. Experience versioning and publishing

Inspired particularly by mature commercial builders, AWJ should treat experience publishing as a controlled lifecycle rather than direct mutation of the live application.

Target conceptual lifecycle:

```text
Draft
  ↓
Preview / Test
  ↓
Publish
  ↓
Published Experience Version
```

Future capabilities may include:

- duplicate version;
- scheduled publish;
- scheduled block visibility;
- rollback to a prior known-good experience;
- audit history;
- targeted experiences/segments, only if later justified.

Rollback/version history is particularly valuable because a merchant should be able to recover from a bad layout/configuration without requiring a new mobile release.

## 7. Server-driven experience principle

A key architecture direction is to avoid rebuilding and resubmitting an application merely because a merchant changes presentation configuration.

Examples that should preferably be remotely publishable where platform rules and runtime capabilities permit:

- home-page section order;
- banners;
- product/category sections;
- content blocks;
- navigation configuration;
- selected theme/design tokens;
- merchandising layout;
- scheduled campaigns/content.

The mobile runtime retrieves/interprets the published experience and reflects those changes without requiring a new App Store / Google Play release for ordinary merchandising changes.

## 8. Binary/version changes

Some changes may still require a new application build/version. Candidate examples include:

- application identity/package configuration;
- bundle/package identifiers;
- native permissions/capabilities;
- certain SDK/native integrations;
- platform signing/provisioning configuration;
- changes to runtime code itself.

The exact boundary must be verified against Apple/Google policies and the selected runtime architecture before implementation.

AWJ therefore needs to distinguish between:

1. **Experience Publish** — remote configuration/content change; and
2. **Application Release** — build, QA, signing, store submission, and version lifecycle.

These must be represented as separate concepts in the product and architecture.

## 9. Preview and testing direction

Preview should eventually go beyond a static phone frame.

Target maturity levels:

1. live visual preview inside AWJ;
2. responsive/state preview for supported screens;
3. preview/test on a real mobile runtime/device;
4. test commerce flows before launch, where safe test/sandbox infrastructure is available;
5. test push/deep-link behavior before production release.

The exact V1 boundary is not decided.

## 10. Initial capability benchmark

| Capability | Target for AWJ | Benchmark signal |
|---|---|---|
| Merchant-specific branded app | Required | Salla/Zid/Tapcart/others |
| iOS + Android | Required | Industry baseline |
| No-code merchant configuration | Required | All primary references |
| Screen + block mental model | Required | OneMobile/Tapcart |
| Commerce-aware blocks/sections | Required | Tapcart/Shopney/Vajro |
| Drag/drop or equivalent direct manipulation | Required | Tapcart/Shopney/OneMobile |
| Property inspector | Required | Mature visual builders |
| Live mobile preview | Required | Salla/Shopney/others |
| Templates | Required | Salla/Shopney/ecosystem |
| Navigation editor | Required | Tapcart/Vajro/Shopney |
| Post-launch experience updates | Required | Salla/Shopney |
| Server-driven presentation where appropriate | Required | Commercial builder pattern |
| Draft/publish separation | Required | Product safety requirement |
| Experience versioning | Required direction | Tapcart |
| Scheduled content/publishing | Strong target | Tapcart/Vajro |
| Rollback/history | Strong target | Versioned architecture |
| Push notifications | Required | Industry baseline |
| Unified AWJ commerce administration | Required | Zid/Salla principle |
| App build/release lifecycle | Required | Platform requirement |
| Extensible/custom block architecture | Required direction | Tapcart |
| Public developer SDK | Later / undecided | Tapcart reference |
| AI-assisted design | Later / optional | Competitive enhancement |

## 11. Current reference ranking

This ranking is about **what AWJ should study from each platform**, not an overall commercial-product ranking.

| Reference | Primary lesson for AWJ |
|---|---|
| Tapcart | Core builder architecture, blocks, extensibility, versions/publishing |
| OneMobile | Merchant-friendly Screen + Blocks workflow |
| Shopney | Preview and Live Experience vs App Release boundary |
| Vajro / Superfans | Widgets, content controls, scheduling, navigation |
| Salla | Saudi/regional merchant journey and launch workflow |
| Zid | Unified commerce administration |
| Shopify ecosystem | Breadth of mature mobile-builder patterns and integrations |

## 12. Open-source research status

No open-source project or implementation technology is approved yet.

Current research candidates include:

- OSMEA — commerce/mobile architecture candidate; licensing requires careful review before any reuse;
- App Creaty — visual editor concepts;
- FlutterBuilder — schema-driven rendering/export concepts;
- Frappe Studio — visual builder architecture/UX reference.

These are **research candidates only**. Their presence in this document does not authorize copying, dependency adoption, or architectural commitment.

Before reusing code, AWJ must review at minimum:

- license compatibility with AWJ's commercial/SaaS model;
- repository health and maintenance;
- security posture;
- architecture and extensibility;
- mobile runtime quality;
- localization and RTL suitability;
- performance;
- test coverage;
- feasibility of AWJ Store API integration.

## 13. GitHub Architecture Hunt — next phase

The next repository research should no longer search only for generic “mobile ecommerce app builder” projects.

Search and evaluate engines/components for these specific layers:

1. **Visual Editor** — drag/drop, tree/canvas, property inspector.
2. **Screen/Block Schema** — structured and versionable component representation.
3. **Live Preview** — accurate rendering of the same schema used by the runtime.
4. **Server-driven Mobile Runtime** — safe rendering of remote experience configuration.
5. **Versioning/Publishing** — drafts, publish, rollback, scheduling.
6. **Extensible Component Model** — custom block definitions and controlled merchant properties.
7. **Commerce Runtime/Foundation** — catalog, product, cart, checkout, account, orders, notifications.

Candidate repositories should be scored against this architecture rather than judged primarily by screenshots or README claims.

The goal is to determine whether AWJ can responsibly reuse a meaningful portion of the engine, or whether AWJ should build the critical builder/schema layers internally and reuse only selected libraries/runtime components.

## 14. Decisions explicitly NOT made

The following remain open:

- Flutter vs React Native vs native runtime;
- exact Experience Schema format;
- exact builder UI;
- whether any open-source builder code will be reused;
- build/signing infrastructure;
- app-store account ownership model;
- pricing/plan entitlement for App Builder;
- public/custom developer SDK timing;
- AI design generation;
- final list of V1 components/blocks;
- exact preview/test-device mechanism;
- segmentation/personalized experience scope.

Do not treat exploratory prototypes or candidate repositories as the source of truth for these decisions.

---

**Current recommendation:** the commercial benchmark is now sufficiently clear to begin the GitHub Architecture Hunt. Evaluate open-source candidates against the defined AWJ layers (Visual Editor, Schema, Preview, Runtime, Versioning, Extensibility, Commerce foundation) before defining V1 or starting implementation.