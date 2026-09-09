# AWJ Commerce — Web Store & Mobile App Experience Strategy

**Status:** Approved product/experience direction for continued Commerce planning — does **not** authorize implementation, merge, deployment, production release, or financial/accounting rule changes.  
**Date:** 2026-09-10  
**Scope:** AWJ Web Store, merchant-branded Mobile App / App Builder, shared Commerce truth, channel-specific presentation and experience.

## 1. Purpose

This document records the approved product direction reached during AWJ Commerce UX research for the relationship between the merchant Web Store and a merchant-branded Mobile App.

It complements the existing AWJ Commerce architecture and Implementation Master Plan. It does not replace existing ADRs or the authority boundaries already defined for inventory, pricing, payments, accounting, ZATCA, customer identity, or tenant isolation.

## 2. Core principle

> **Shared Commerce Truth + Channel-specific Experience.**

AWJ must not create separate commercial truth for Web and Mobile merely because their presentation differs.

The Web Store and Mobile App are first-class Commerce channels over the same AWJ commercial foundations. They may present different experiences while continuing to consume authoritative shared data and services.

Conceptually:

```text
                    AWJ Commerce
                         │
              Shared Commerce Truth
                         │
        ┌────────────────┴────────────────┐
        │                                 │
   AWJ Web Store                 Merchant Mobile App
        │                                 │
   Web Experience                    App Experience
        │                                 │
        └──────── same authorities ───────┘

Products / Pricing / ATS / Reservations
Customers / Orders / Payments / Fulfillment
Existing AWJ Accounting / Invoice / ZATCA authorities
```

## 3. What must remain shared

The following must not become independent Web-vs-App databases or competing authorities:

- product/sellable identity;
- authoritative catalog/product source;
- pricing resolution authority;
- inventory availability / ATS and reservations;
- customer identity and customer ownership context;
- Commerce orders;
- payment integration/state authorities;
- fulfillment/shipping business state;
- approved invoice/accounting/ZATCA paths.

A different visual experience is not a reason to duplicate Product, Customer, Inventory, Order, or accounting truth.

## 4. Channel visibility is allowed

Shared truth does **not** mean every sellable item or promotion must be visible in every channel.

Commerce may support channel-aware listing/visibility, for example:

```text
                         Web    App    POS
Product A                 ✓      ✓      ✓
App-exclusive campaign    —      ✓      —
Branch/POS-only item      —      —      ✓
Online-only item          ✓      ✓      —
```

This is channel visibility/presentation over shared authorities, not duplicated products.

Any future channel-specific pricing or promotion behavior must remain server-authoritative and auditable. Web or Mobile must not become an independent pricing/totals engine.

## 5. Shared Brand, independent experiences

AWJ should distinguish **Brand Identity** from **Channel Layout/Experience**.

A merchant may want one consistent brand across Web and App while using layouts optimized for each channel.

### Shared Brand may include

- merchant/store name;
- logo and brand assets;
- primary/secondary brand colors;
- typography where technically appropriate;
- other approved brand tokens.

### Web-specific experience may include

- desktop/tablet/mobile web layouts;
- web header and navigation;
- mega menu/navigation patterns;
- web product grids/cards;
- web footer;
- web-specific page sections.

### App-specific experience may include

- splash screen and app icon assets;
- mobile-native home layout;
- bottom navigation;
- app product cards/details presentation;
- app search/account/navigation patterns;
- native interaction patterns;
- app-only sections/content where approved.

The Web Store layout must not be mechanically copied into the Mobile App merely to maintain brand consistency.

## 6. App Builder — synchronization modes

The App Builder should support three product-level modes.

### 6.1 Synchronized / Shared Theme

The application inherits approved shared brand/theme properties from the Web Store or shared Brand layer.

Best for merchants who want fast setup and one consistent identity.

### 6.2 Synchronized with Overrides

The application inherits shared defaults but permits selected app-specific overrides.

This is the preferred flexible mode: consistency by default, independence where the mobile experience needs it.

### 6.3 Independent App Theme

The merchant may choose an independent App theme/presentation while continuing to use the same Commerce truth and authorities.

"Independent" applies to presentation/experience, not to product, inventory, customer, order, payment, or accounting truth.

## 7. Property-level inheritance and overrides

Synchronization should not be only an all-or-nothing global switch.

Where practical, individual properties should be able to declare their source:

```text
Property                    Source
Logo                        Linked to shared Brand
Primary color               Linked to shared Brand
Arabic typography           Linked to shared Brand
Splash screen               App override
Product-card variant        App override
Bottom navigation           App override
Home-section ordering       App override
```

The UX should make inheritance explicit, e.g. a property can be visibly **linked to store/shared brand** and offer an action such as **Customize for App**.

This enables the merchant to break inheritance only where necessary without forking the entire theme.

## 8. App Builder scope: experience, not arbitrary page design

AWJ should provide meaningful customization without becoming an unrestricted Canva/Webflow-style editor.

The App Builder should use approved, responsive/native-safe components and sections.

Candidate home sections include:

- Hero/banner;
- quick categories;
- featured products;
- new arrivals;
- best sellers;
- offers;
- brands;
- recently viewed;
- reorder;
- recommendations;
- approved promotional/content banners.

The merchant may add, remove, reorder, configure, and control visibility of supported sections within AWJ constraints.

## 9. Navigation customization

Mobile navigation should be customizable within an approved vocabulary rather than freely constructed.

Candidate destinations include:

- Home;
- Categories;
- Search;
- Offers;
- Cart;
- Orders;
- Favorites;
- Account.

AWJ may enforce usability limits such as maximum bottom-navigation items, mandatory destinations, and valid icon/label combinations.

## 10. Channel-specific content

Content and presentation entities should be capable, where appropriate, of targeting channels such as:

- Web Store;
- Mobile App;
- both Web + App;
- other future supported Commerce channels where the domain model permits.

Examples include banners, homepage sections, campaigns, or approved promotions.

This enables legitimate experiences such as an app-only acquisition campaign without creating a second product/customer/order system.

## 11. App delivery direction

The preferred long-term direction is:

> **Native-quality application shell + server-driven Commerce experience/configuration.**

Store content, supported home-section ordering, banners, theme configuration, navigation configuration, and feature flags should be capable of changing server-side where safe, without requiring an App Store / Google Play binary release for every content change.

Native capability changes that require a new binary remain normal application releases.

A WebView-only wrapper should not be treated as the primary strategic experience merely because it is cheaper to ship.

## 12. Relationship to POS

POS is another AWJ sales channel but is not required to share Web/App presentation and must not be forced through CommerceOrder merely for conceptual symmetry.

Existing AWJ ERP/POS flows and backward compatibility remain protected by the existing Commerce architecture decisions.

## 13. Merchant management model

The target product concept is a Commerce workspace in AWJ from which the merchant can manage channels while retaining shared commercial truth.

Conceptually:

```text
AWJ Commerce Workspace
│
├── Commerce operations
│   ├── Orders
│   ├── Customers
│   ├── Catalog/listings
│   ├── Marketing/promotions
│   ├── Fulfillment/shipping
│   └── Reports/analytics
│
└── Sales channels
    ├── Web Store
    │   └── Web Store Builder
    │
    └── Mobile App
        └── App Builder
```

The exact sidebar/top-navigation information architecture remains a UX research/design decision and is not locked by this document.

## 14. Safety and authority boundaries

This experience strategy must not weaken existing AWJ invariants:

1. Tenant isolation remains mandatory across all channels and configurations.
2. Mobile/Web clients do not become authoritative pricing, tax, ATS, reservation, payment, accounting, or ZATCA engines.
3. Commerce presentation does not expose private/cost/accounting-only product fields.
4. Customer-facing channels consume the shared AWJ Customer Platform rather than creating channel-private customer identities.
5. Commerce continues to use existing approved AWJ financial/inventory authorities for their responsibilities.
6. Channel-specific presentation must not silently mutate historical commercial/accounting truth.
7. Backward compatibility for existing ERP/POS flows remains a release gate.

## 15. Current UX research references

Current research uses different products for different lessons rather than copying one platform end-to-end:

- **Microsoft Dynamics 365 Commerce:** Commerce architecture, channels, site/module concepts.
- **Shopify:** Store/theme editor UX and section/block editing patterns.
- **Salla:** Saudi merchant needs, store/app-builder usability and local-market workflows.
- **Zid:** Saudi/local-market commerce requirements and themes.
- **Odoo:** selected direct-editing ideas.

These are research references, not specifications to clone.

## 16. Decisions recorded

The following direction is approved for continued planning:

1. Web Store and merchant Mobile App are first-class AWJ Commerce channels.
2. They share Commerce truth and existing AWJ authorities.
3. Their visual/interaction experiences do not have to be identical.
4. Brand identity may be shared across Web and App.
5. App Builder supports shared inheritance, inheritance with overrides, and independent presentation.
6. Property-level overrides are preferred where practical.
7. App Builder should allow broader but constrained customization rather than only a small fixed theme picker.
8. Channel-specific content/visibility is a supported product direction.
9. Native-quality + server-driven configuration is preferred over a WebView-only strategic architecture.
10. No separate App product/customer/inventory/order/accounting truth is created.

## 17. Explicitly not decided yet

The following remain under research and must not be inferred as approved implementation requirements:

- exact Web Store UI/theme;
- exact Mobile App UI/theme;
- exact Commerce workspace sidebar vs horizontal navigation;
- exact App Builder component catalogue;
- exact number/names of themes or presets;
- exact app build/signing/publishing automation;
- Apple/Google developer-account ownership model;
- pricing/subscription model for merchant apps;
- exact framework/native technology;
- exact promotion types or channel-price rules;
- final Design System V2 tokens.

---

**Implementation note:** This document records product/experience direction only. Any implementation must be reconciled with the merged Commerce ADRs, the AWJ Commerce Implementation Master Plan, Customer Platform architecture, security/tenant-isolation requirements, and the normal PR/test/review/approval process before merge or deployment.
