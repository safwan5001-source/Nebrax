# AWJ Storefront Design System & Responsive UX Specification

**Status:** Design specification — implementation not started  
**Date:** 2026-09-13  
**Scope:** AWJ Store customer-facing storefront and merchant presentation configuration  
**Reference direction:** approved desktop + mobile storefront and customizer visual references supplied by product owner  
**Related architecture:** `AWJ_SPREE_TECHNICAL_FIT_AUDIT.md` and existing Commerce ADRs/plans

---

## 1. Decision

AWJ Store will have a dedicated customer-facing storefront design system. It is **not** a direct reuse of the AWJ ERP back-office visual system.

The ERP remains an accounting/operations workspace where clarity, density, speed, trust and data tables dominate. The storefront serves shoppers and therefore prioritizes discovery, product imagery, conversion, mobile shopping, cart and checkout.

The two products still share:

- AWJ platform identity and quality bar.
- Arabic-first localization with English support.
- RTL for Arabic and mirrored LTR behavior for English.
- accessibility, responsive behavior and consistent interaction rules.
- strict tenant isolation and server-authoritative commerce data.

The supplied visual references are the **approved visual direction**, not pixel-perfect source code and not a license to copy third-party branding/assets.

---

## 2. Product model: theme, not one hard-coded store

The reference design becomes the foundation of the first reusable AWJ storefront theme:

**Working name:** `AWJ Modern`

It must be tenant-configurable rather than tied to one merchant. The structural components remain stable while merchant-controlled content and branding can change.

### Merchant-configurable presentation

- logo / store identity.
- primary and supported secondary/accent presentation colors.
- supported Arabic/English typography choices.
- hero banners and their links.
- category imagery/presentation overrides where explicitly supported.
- homepage section visibility.
- homepage section ordering within supported rules.
- featured collections/products selection from AWJ-owned commerce data.
- promotional banners.
- store contact/support content.
- policy links and footer content.

### Platform-controlled

- checkout safety and transaction flow.
- cart totals and monetary calculations.
- responsive layout rules.
- accessibility requirements.
- authentication/session security.
- tenant isolation.
- product availability truth.
- inventory reservation behavior.
- payment state and order state.
- legal/accounting boundaries defined by AWJ Commerce ADRs.

Theme configuration must never be allowed to alter financial calculations, inventory truth, tenant resolution, checkout state, permissions, or accounting behavior.

---

## 3. AWJ is the system of record

**Architectural rule:** AWJ is the system of record for commerce master data. The Store Customizer controls presentation, not commerce master data.

The storefront and its customization UI must not create a second independent catalog taxonomy or duplicate product master data.

### Master data owned by AWJ

The authoritative source remains AWJ for:

- products and product identity.
- product names/descriptions and core commerce attributes.
- categories/classifications and their membership relationships.
- prices and valid discounts/promotions according to implemented Commerce contracts.
- inventory/availability truth.
- product media that belongs to the product record.
- publication/eligibility state for whether a product may appear in the storefront.
- other commerce facts governed by AWJ backend contracts.

Creation, deletion, renaming and structural maintenance of categories/classifications happen through the appropriate AWJ management capability, not through the Store Customizer.

### What the Store Customizer may control

For AWJ-owned categories/products that are eligible for storefront use, the Customizer may control presentation-only choices such as:

- show/hide a category or homepage category section.
- choose which eligible categories are promoted on the homepage.
- reorder supported homepage category/section placements.
- choose an approved presentation style/layout.
- assign presentation imagery/banner treatment where the schema explicitly supports an override without changing the underlying category identity.
- choose featured products/collections from products already exposed by AWJ.

A presentation override must reference the stable AWJ entity identifier. It must not clone the entity into a separate storefront-owned record.

### Lifecycle behavior

- If an AWJ category is renamed, the storefront reads the authoritative updated name unless a separately approved presentation-label feature exists.
- If an AWJ category/product becomes unavailable, unpublished, deleted, or no longer eligible for storefront exposure, stale Customizer references must fail safely and must not resurrect or expose it.
- Reordering or hiding an item in the Customizer changes only storefront presentation; it does not mutate AWJ catalog hierarchy or product-category membership.
- Storefront caches and theme configuration must remain tenant-scoped; an entity reference from one tenant must never resolve in another tenant.

This boundary prevents synchronization drift such as having one category in AWJ and a second conflicting category in the storefront.

---

## 4. Store Customizer boundary

The approved Customizer visual direction consists of the **customization controls, top configuration/preview controls, and the live storefront preview canvas**. Any surrounding ERP navigation/sidebar visible in the supplied reference is contextual only and is explicitly **not** part of the Store Customizer design reference.

The Customizer is a constrained presentation editor, not an unrestricted page builder in V1.

### V1 customization families

- supported theme/template selection.
- merchant presentation colors through semantic theme tokens.
- supported Arabic and English typography choices.
- homepage layout preset where supported.
- section visibility.
- safe section ordering.
- desktop/tablet/mobile preview modes.
- preview before publish.

The exact persistence schema and publish workflow are implementation decisions for `STORE-UI-6`; they must preserve tenant isolation, validation, backward compatibility and safe defaults.

---

## 5. Visual direction

The storefront should feel modern, calm, commercial and trustworthy — not like an ERP screen and not like an AI-generated landing page.

### Core characteristics

- light neutral page background.
- white or near-white commerce surfaces.
- generous product photography.
- compact but readable product cards.
- restrained borders and shadows.
- strong hierarchy instead of decorative effects.
- merchant primary color used for calls to action and selected states.
- rounded surfaces used consistently, without excessive pill styling.
- Arabic typography and spacing treated as first-class, not translated afterthoughts.

### Avoid

- gradients without functional purpose.
- glassmorphism as a default surface treatment.
- excessive colored cards.
- oversized empty spacing that reduces product density.
- animations that delay shopping actions.
- desktop layouts merely scaled down for mobile.
- hard-coded AWJ green (or any single merchant color) throughout components.

---

## 6. Responsive strategy

Desktop and mobile are two coordinated compositions using the same commerce model and component primitives. Mobile is **not** a shrunken desktop.

### Breakpoint intent

Exact Tailwind breakpoints should follow repository conventions during implementation, but behavior is defined as:

- **Mobile:** single shopper-focused viewport, bottom navigation, compact header, 2-column product grids where viable.
- **Tablet:** adaptive grid and navigation; no forced desktop cart rail when space is insufficient.
- **Desktop:** full header/navigation, wide content canvas, denser product grid and optional persistent cart rail.

All layouts must be tested in Arabic RTL and English LTR.

---

## 7. Desktop storefront anatomy

The approved desktop direction contains these regions, in order:

1. Utility/header row: locale/region, account, wishlist, cart.
2. Brand + prominent search.
3. Primary category navigation sourced from AWJ-authoritative categories.
4. Main commerce canvas.
5. Hero promotional banner/carousel.
6. Visual category shortcuts sourced from AWJ categories and presentation configuration.
7. Featured products grid/carousel.
8. Promotional/category banners.
9. Trust/service benefits.
10. Footer.

### Desktop cart rail

Where viewport width permits, the storefront may expose a persistent cart summary rail similar to the reference:

- item count.
- cart line thumbnail/name.
- quantity controls.
- remove action.
- coupon entry.
- subtotal/discount/shipping/total.
- prominent checkout action.
- trust/service cues.

The rail is a convenience view over the authoritative cart. It must not perform independent price calculations.

At narrower widths it collapses to the normal cart surface/drawer rather than compressing the catalog.

---

## 8. Mobile storefront anatomy

### Global mobile shell

- compact top header.
- merchant logo/identity.
- menu/search access as appropriate.
- persistent bottom navigation on primary shopping surfaces.
- safe-area aware spacing.

### Default bottom navigation

1. Home.
2. Categories.
3. Wishlist.
4. Cart.
5. Account.

Labels and order must mirror correctly between RTL/LTR while preserving meaning and platform conventions.

### Mobile home

- compact hero.
- main categories.
- featured products.
- optional promotional blocks.
- product cards primarily two across when content remains legible.

The goal is useful commerce density, not one giant card per viewport.

---

## 9. Required customer journeys

The theme is incomplete until the following surfaces share one coherent design language:

### Discovery

- Home.
- Categories index.
- Category/product listing.
- Search and search results.
- empty/no-result state.

### Product

- product detail.
- image gallery.
- pricing and discount display.
- availability.
- quantity.
- add to cart.
- wishlist.
- product information.
- related/recommended products when supported by data.

### Cart

- cart drawer/rail where applicable.
- full cart page/mobile cart.
- quantity update.
- remove.
- promotion/coupon, designed now and activated when a contract exists (see the
  design-first reconciliation below).
- server-authoritative totals.

### Checkout

AWJ checkout must follow AWJ Commerce architecture rather than copying Spree's checkout state machine.

Expected UX stages:

1. customer/contact.
2. address.
3. delivery/shipping.
4. payment.
5. review/submit.
6. order confirmation.

No visual implementation may invent unsupported shipping, payment, discount or fulfillment behavior.

### Design-first reconciliation (supersedes the "activated only as backend capabilities exist" wording)

This document originally said unsupported stages and controls were to be
*activated only as backend capabilities exist*, and §11 (STORE-UI-4) said to
scope *only against real Commerce contracts available at implementation time*.
Read literally, both meant "omit it until the backend lands".

The owner's decision recorded in
`AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` supersedes that reading:

> Missing backend capability does not block storefront design completion.
> It blocks production activation.

So the rule is now:

- **Design completeness is not gated on the backend.** A stage or control the
  journey needs is built now, in its intended final form, and recorded in the
  policy's register with its exact missing contract.
- **Activation is gated on the backend, absolutely.** A designed-but-unbacked
  control is visibly inert: it persists nothing, asserts no commercial fact,
  claims no success, and says plainly that it is not enabled.
- **What design-first never licenses is unchanged and non-negotiable** — see the
  policy's §3. Inventing an API, fabricating a price/discount/stock/delivery
  date, faking payment or order state, substituting browser storage for business
  persistence, or weakening tenant isolation are all still forbidden, in every
  state.

Concretely for cart and checkout: the payment stage and the coupon field exist
and are marked not enabled; no provider is named and no brand mark is shown; no
delivery price, estimate or date is stated; and no total is computed anywhere
before the server produces one on the order.

### Customer account

- profile.
- orders.
- order detail/status.
- addresses when backend capability exists.
- payment methods when backend capability exists.
- wishlist.
- notifications/preferences where supported.
- support/help.
- logout.

---

## 10. Component inventory

Initial reusable storefront components:

- `StoreHeader`
- `StoreSearch`
- `CategoryNav`
- `MobileBottomNav`
- `HeroBanner`
- `HeroCarousel`
- `CategoryShortcut`
- `CategoryGrid`
- `ProductCard`
- `ProductGrid`
- `ProductGallery`
- `PriceDisplay`
- `DiscountBadge`
- `QuantityStepper`
- `AddToCartButton`
- `WishlistButton`
- `CartRail`
- `CartDrawer`
- `CartLineItem`
- `CartTotals`
- `CouponInput`
- `CheckoutProgress`
- `AddressCard`
- `ShippingMethodCard`
- `PaymentMethodCard`
- `OrderStatusTimeline`
- `TrustBenefits`
- `StoreFooter`
- loading skeletons and explicit empty/error states for all data-driven surfaces.

Names are conceptual until implementation confirms existing component conventions.

---

## 11. Product card contract

Product cards are one of the highest-reuse components and must be standardized early.

Minimum visual/data contract:

- primary image with stable aspect ratio.
- product name, clamped predictably.
- current price.
- compare-at/original price only when valid.
- discount badge only from authoritative data.
- rating/review count only if a real review capability exists; otherwise omit entirely.
- wishlist action only when backed by a real persistence model.
- add-to-cart action.
- explicit unavailable/out-of-stock state.

No fake ratings, fake discounts, fake stock urgency or placeholder commercial claims in production.

---

## 12. Theme tokens

Storefront components consume semantic theme tokens instead of hard-coded merchant colors.

Initial conceptual tokens:

- `store-bg`
- `store-surface`
- `store-text`
- `store-muted`
- `store-border`
- `store-primary`
- `store-primary-hover`
- `store-primary-soft`
- `store-danger`
- `store-success`
- `store-warning`
- `store-radius`

The implementation must provide safe accessible defaults and validate merchant-selected primary colors for readable foreground contrast.

The ERP design tokens are **not automatically inherited** by the public storefront. Reuse should be intentional, not accidental.

---

## 13. Typography and imagery

### Typography

Arabic is the primary language. Typography must support clear product titles, prices, promotional headings and compact mobile labels.

Final font reuse vs storefront-specific font choice will be decided during implementation after checking existing asset/licensing/performance constraints. Do not add a new font casually.

### Product imagery

- stable aspect ratios to prevent layout shift.
- responsive image sizing.
- optimized loading.
- meaningful alt text.
- graceful missing-image fallback.
- hero images must support desktop and mobile crops/art direction where configuration permits.

Merchant imagery is content, not part of the theme code.

---

## 14. Accessibility and interaction

Minimum requirements:

- keyboard-accessible desktop navigation and cart controls.
- visible focus states.
- sufficient text/action contrast.
- touch targets appropriate for mobile.
- quantity controls usable with keyboard and touch.
- icon-only actions have accessible names.
- no information conveyed by color alone.
- reduced-motion preference respected.
- logical heading hierarchy.
- screen-reader announcements for important cart mutations where practical.

---

## 15. Loading, empty and failure states

Every data-driven block must define:

- loading/skeleton state.
- empty state.
- recoverable error state with retry where appropriate.
- unavailable product state.
- stale cart/product conflict handling from server response.

The UI must not display locally assumed success when an add-to-cart, inventory, coupon, payment or order mutation fails.

---

## 16. Commerce and security guardrails

These rules override visual convenience:

1. Tenant resolution is mandatory before storefront data access.
2. No cross-tenant cache, cookie, cart, customer, product, category or theme leakage.
3. Prices/totals are server-authoritative; client math is display-only at most.
4. Inventory availability follows AWJ Commerce reservation rules.
5. `CommerceOrder != Invoice`; storefront UI must not blur this accounting boundary.
6. Payment UI is enabled only for implemented and approved payment capabilities.
7. Shipping UI is enabled only when a real AWJ shipping/logistics contract exists.
8. Theme configuration cannot inject unsafe arbitrary executable code.
9. Storefront analytics must not expose secrets or sensitive customer data.
10. Backward compatibility with existing Commerce APIs/contracts is required unless a separate approved change explicitly modifies them.
11. Storefront configuration may reference only tenant-owned/tenant-visible AWJ entities eligible for storefront exposure.
12. Presentation configuration must not become an alternate source of product/category truth.

---

## 17. Relationship to Spree Storefront

The existing technical audit concluded that Spree provides meaningful reusable catalog/browsing/account UI, while its checkout/payment/session assumptions are deeply coupled to Spree and do not match AWJ's approved Commerce boundaries.

Therefore:

- reuse/adapt useful storefront UI patterns where technically sound and license-compliant.
- do not reshape AWJ Commerce architecture merely to fit Spree UI.
- do not reuse Spree checkout/payment state machine as AWJ's domain contract.
- AWJ's design specification and Commerce ADRs are authoritative for AWJ behavior.

---

## 18. Implementation plan

### STORE-UI-0 — Design specification

**This document.**

Deliverable:
- responsive design contract.
- component inventory.
- theme model.
- AWJ master-data / Customizer presentation boundary.
- security/commerce guardrails.

No production UI code.

### STORE-UI-1 — Storefront shell

Scope:
- theme token foundation.
- desktop header/navigation.
- mobile header.
- mobile bottom navigation.
- content container/breakpoints.
- footer foundation.
- RTL/LTR behavior.
- category navigation consumes AWJ-authoritative category data; it does not define a second taxonomy.

No checkout redesign and no Commerce API changes.

### STORE-UI-2 — Home & discovery

Scope:
- hero.
- category shortcuts sourced from AWJ category data.
- featured products sourced from AWJ commerce data.
- promotional blocks.
- product card/grid foundation.
- loading/empty/error states.

### STORE-UI-3 — Catalog & product detail

Scope:
- category listing.
- search/results.
- filters/sort where backend supports them.
- product detail/gallery.
- availability/quantity/add-to-cart wiring.

### STORE-UI-4 — Cart & checkout presentation

Scope, under the design-first reconciliation above:
- cart desktop/mobile.
- cart rail/drawer.
- totals, from the server only.
- the full six-stage checkout, with unbacked stages designed and visibly inert.
- confirmation.

No invented gateway/shipping domain. Delivered — see
`STORE-UI-4-IMPLEMENTATION-REPORT.md` for the capability matrix and the exact
missing contract behind each `DESIGN_ONLY` surface.

### STORE-UI-5 — Customer account

Scope, under the design-first reconciliation above:
- profile (session identity; update uses the existing storefront session contract).
- order history / detail / status presentation.
- wishlist, addresses and saved payment methods designed even where the
  backend contract is missing; those surfaces are visibly inert.
- login / register / logout journey, visually aligned with the store.

No invented account, order-list, address-book or saved-card API. Delivered —
see `STORE-UI-5-IMPLEMENTATION-REPORT.md`.

### STORE-UI-6 — Merchant theme configuration / Store Customizer

Scope:
- merchant branding.
- supported theme/template selection.
- theme colors/tokens.
- supported typography choices.
- homepage content/layout configuration.
- visibility and ordering of supported sections.
- selection/presentation of AWJ-owned categories/products without duplicating their master data.
- desktop/tablet/mobile preview.
- preview before publish.

Theme publishing must remain tenant-scoped and validated. Customizer persistence stores presentation configuration and stable references to eligible AWJ entities; it does not become a product/category master-data store.

---

## 19. Definition of done for each UI PR

A storefront UI PR is not complete from screenshots alone. At minimum it must include:

- Arabic RTL verification.
- English LTR verification.
- mobile verification.
- desktop verification.
- relevant component/unit tests.
- relevant integration/E2E coverage for changed commerce behavior.
- no regression of tenant isolation.
- no client-side authoritative financial calculations.
- build success.
- accessibility sanity check for changed interactions.
- implementation report with changed files, tests/results, build/CI, risks, remaining work, branch/PR/Base SHA/Head SHA, and next step.

Financial/security/tenant-isolation tests must not be weakened to make a UI PR pass.

---

## 20. Explicit non-goals for STORE-UI-0

This design-specification step does **not**:

- merge or deploy anything.
- change Commerce models or migrations.
- change APIs.
- implement payment gateways.
- implement shipping/logistics.
- implement reviews/ratings.
- implement wishlist persistence.
- create a second storefront-owned product/category taxonomy.
- alter ERP back-office design system.
- redesign unrelated AWJ modules.
- treat the surrounding ERP sidebar from the Customizer visual reference as part of the Customizer design scope.

---

## 21. Next action

Proceed with **STORE-UI-1 — Storefront Shell** only after reviewing this specification against the current storefront code structure. The implementation pass should inspect only the files necessary to identify the existing shell/layout/theme seams and then produce a small PR. Do not re-audit the full Commerce architecture.
