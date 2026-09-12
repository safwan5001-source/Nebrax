# AWJ Mobile App Builder — Benchmark & Architecture Direction

**Status:** Research / architecture direction — not a final implementation or technology decision  
**Date:** 2026-09-12

## 1. Purpose

AWJ Store should provide a professional **mobile commerce app builder** for merchants. The goal is not to manually build and integrate a separate mobile application for every AWJ customer.

A merchant should be able to configure and design their own branded iOS/Android storefront application from inside AWJ, while AWJ remains the source of truth for commerce and ERP data.

A ready-made standalone storefront application may still be useful for a specific private store, but it does not solve the AWJ customer-platform requirement.

## 2. Current benchmark direction

The initial benchmark is based on official documentation and product behavior from established commerce platforms and mobile app builders.

### Salla

Use as a primary regional reference for:

- merchant-facing mobile app builder workflow;
- branded iOS/Android applications;
- configurable home-page elements and templates;
- navigation and launch/welcome screens;
- in-builder application preview;
- publishing / launch workflow;
- ability to update significant presentation configuration without requiring a new store release for every visual change.

### Shopney

Use as a primary reference for the **visual experience builder**:

- drag-and-drop composition;
- commerce-oriented blocks and sections;
- live mobile preview;
- block-level configuration;
- reusable layouts / showcases;
- separation between remotely configurable experience changes and changes that require a new application binary/version;
- future AI-assisted design as a possible later capability, not a V1 requirement.

### Zid

Use as a reference for **unified commerce administration**:

- the mobile application must not become a second commerce-management system;
- products, categories, orders, payments, shipping, and other commerce data continue to be managed through the main platform;
- the mobile application is a customer-facing sales channel over the existing commerce platform.

### Shopify ecosystem

Use the Mobile App Builder ecosystem as a wider competitive benchmark, especially for:

- drag-and-drop mobile storefront editors;
- push notifications;
- templates;
- merchandising components;
- app publishing and lifecycle management;
- mature third-party builder UX patterns.

Further benchmark targets include Tapcart, Vajro, OneMobile, and a deeper Shopney review.

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

The current direction is composed of four major parts:

### 4.1 Visual Experience Builder

Merchant-facing workspace for composing the application experience:

- pages;
- sections / blocks;
- drag and drop / reordering;
- block properties;
- navigation;
- themes and branding;
- live mobile preview;
- draft/save/publish workflow.

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
Save / Publish
        ↓
AWJ Store API
        ↓
Mobile Commerce Runtime
```

JSON or an equivalent structured format is a candidate representation. The exact schema and storage model are **not yet decided**.

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

## 5. Server-driven experience principle

A key architecture direction is to avoid rebuilding and resubmitting an application merely because a merchant changes presentation configuration.

Examples that should preferably be remotely publishable where platform rules and runtime capabilities permit:

- home-page section order;
- banners;
- product/category sections;
- content blocks;
- navigation configuration;
- selected theme/design tokens;
- merchandising layout.

The mobile runtime retrieves/interprets the published experience and reflects those changes without requiring a new App Store / Google Play release for ordinary merchandising changes.

## 6. Binary/version changes

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

## 7. Candidate builder workspace

Conceptual information architecture:

```text
Mobile App
├── Pages
│   ├── Home
│   ├── Categories
│   ├── Product
│   ├── Cart
│   └── Account
├── Components / Sections
│   ├── Banner
│   ├── Slider
│   ├── Categories
│   ├── Products
│   ├── Brands
│   ├── Countdown
│   └── Image + CTA
├── Branding
├── Navigation
├── Settings
├── Notifications
├── Preview
└── Releases
```

This is a product concept, not a locked screen specification.

## 8. Initial capability benchmark

| Capability | Target for AWJ |
|---|---|
| Merchant-specific branded app | Required |
| iOS + Android | Required |
| No-code merchant configuration | Required |
| Commerce-aware blocks/sections | Required |
| Drag/drop or equivalent direct manipulation | Required |
| Live mobile preview | Required |
| Templates | Required |
| Navigation editor | Required |
| Post-launch experience updates | Required |
| Server-driven presentation where appropriate | Required |
| Push notifications | Required |
| Unified AWJ commerce administration | Required |
| App build/release lifecycle | Required |
| AI-assisted design | Later / optional |

## 9. Open-source research status

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

## 10. Next research pass

Before implementation:

1. Deep-review official documentation for Tapcart, Vajro, OneMobile, and Shopney.
2. Expand the benchmark for blocks, page management, navigation, preview, publishing, versioning, push notifications, and app-store lifecycle.
3. Produce an AWJ-specific functional capability matrix.
4. Revisit open-source repositories against that matrix.
5. Decide whether AWJ should reuse a builder/runtime, reuse selected components, or build the critical layers internally.
6. Only then define V1 scope and implementation plan.

## 11. Decisions explicitly NOT made

The following remain open:

- Flutter vs React Native vs native runtime;
- exact Experience Schema format;
- exact builder UI;
- whether any open-source builder code will be reused;
- build/signing infrastructure;
- app-store account ownership model;
- pricing/plan entitlement for App Builder;
- AI design generation;
- final list of V1 components/blocks.

Do not treat exploratory prototypes or candidate repositories as the source of truth for these decisions.

---

**Current recommendation:** complete the commercial-platform benchmark first, then evaluate GitHub/open-source candidates against the resulting AWJ requirements. Do not start implementation from a repository merely because it already exposes a visual builder.