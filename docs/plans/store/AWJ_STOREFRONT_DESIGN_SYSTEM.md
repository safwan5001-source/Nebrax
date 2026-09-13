# AWJ Storefront Design System & Responsive UX Specification

**Status:** Design specification — implementation not started  
**Date:** 2026-09-13  
**Scope:** AWJ Store customer-facing storefront only  
**Reference direction:** approved desktop + mobile visual references supplied by product owner  
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

### Merchant-configurable

- logo / store identity.
- primary brand color.
- hero banners and their links.
- category imagery.
- homepage section visibility.
- homepage section ordering within supported rules.
- featured collections/products.
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

## 3. Visual direction

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

## 4. Responsive strategy

Desktop and mobile are two coordinated compositions using the same commerce model and component primitives. Mobile is **not** a shrunken desktop.

### Breakpoint intent

Exact Tailwind breakpoints should follow repository conventions during implementation, but behavior is defined as:

- **Mobile:** single shopper-focused viewport, bottom navigation, compact header, 2-column product grids where viable.
- **Tablet:** adaptive grid and navigation; no forced desktop cart rail when space is insufficient.
- **Desktop:** full header/navigation, wide content canvas, denser product grid and optional persistent cart rail.

All layouts must be tested in Arabic RTL and English LTR.

---

## 5. Desktop storefront anatomy

The approved desktop direction contains these regions, in order:

1. Utility/header row: locale/region, account, wishlist, cart.
2. Brand + prominent search.
3. Primary category navigation.
4. Main commerce canvas.
5. Hero promotional banner/carousel.
6. Visual category shortcuts.
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

## 6. Mobile storefront anatomy

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

## 7. Required customer journeys

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
- promotion/coupon when supported.
- server-authoritative totals.

### Checkout

AWJ checkout must follow AWJ Commerce architecture rather than copying Spree's checkout state machine.

Expected UX stages, activated only as backend capabilities exist:

1. customer/address.
2. delivery/shipping.
3. payment.
4. review/submit where required.
5. order confirmation.

No visual implementation may invent unsupported shipping, payment, discount or fulfillment behavior.

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

## 8. Component inventory

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

## 9. Product card contract

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

## 10. Theme tokens

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

## 11. Typography and imagery

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

## 12. Accessibility and interaction

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

## 13. Loading, empty and failure states

Every data-driven block must define:

- loading/skeleton state.
- empty state.
- recoverable error state with retry where appropriate.
- unavailable product state.
- stale cart/product conflict handling from server response.

The UI must not display locally assumed success when an add-to-cart, inventory, coupon, payment or order mutation fails.

---

## 14. Commerce and security guardrails

These rules override visual convenience:

1. Tenant resolution is mandatory before storefront data access.
2. No cross-tenant cache, cookie, cart, customer, product or theme leakage.
3. Prices/totals are server-authoritative; client math is display-only at most.
4. Inventory availability follows AWJ Commerce reservation rules.
5. `CommerceOrder != Invoice`; storefront UI must not blur this accounting boundary.
6. Payment UI is enabled only for implemented and approved payment capabilities.
7. Shipping UI is enabled only when a real AWJ shipping/logistics contract exists.
8. Theme configuration cannot inject unsafe arbitrary executable code.
9. Storefront analytics must not expose secrets or sensitive customer data.
10. Backward compatibility with existing Commerce APIs/contracts is required unless a separate approved change explicitly modifies them.

---

## 15. Relationship to Spree Storefront

The existing technical audit concluded that Spree provides meaningful reusable catalog/browsing/account UI, while its checkout/payment/session assumptions are deeply coupled to Spree and do not match AWJ's approved Commerce boundaries.

Therefore:

- reuse/adapt useful storefront UI patterns where technically sound and license-compliant.
- do not reshape AWJ Commerce architecture merely to fit Spree UI.
- do not reuse Spree checkout/payment state machine as AWJ's domain contract.
- AWJ's design specification and Commerce ADRs are authoritative for AWJ behavior.

---

## 16. Implementation plan

### STORE-UI-0 — Design specification

**This document.**

Deliverable:
- responsive design contract.
- component inventory.
- theme model.
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

No checkout redesign and no Commerce API changes.

### STORE-UI-2 — Home & discovery

Scope:
- hero.
- category shortcuts.
- featured products.
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

Scope only against real Commerce contracts available at implementation time:
- cart desktop/mobile.
- cart rail/drawer.
- totals.
- checkout steps supported by backend.
- confirmation.

No invented gateway/shipping domain.

### STORE-UI-5 — Customer account

Scope:
- profile.
- order history/detail.
- wishlist/address/payment surfaces only where corresponding backend contracts exist.

### STORE-UI-6 — Merchant theme configuration

Scope:
- merchant branding.
- theme primary color.
- homepage content configuration.
- banners/sections ordering within safe schema.
- preview before publish.

Theme publishing must remain tenant-scoped and validated.

---

## 17. Definition of done for each UI PR

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

## 18. Explicit non-goals for STORE-UI-0

This design-specification step does **not**:

- merge or deploy anything.
- change Commerce models or migrations.
- change APIs.
- implement payment gateways.
- implement shipping/logistics.
- implement reviews/ratings.
- implement wishlist persistence.
- alter ERP back-office design system.
- redesign unrelated AWJ modules.

---

## 19. Next action

Proceed with **STORE-UI-1 — Storefront Shell** only after reviewing this specification against the current storefront code structure. The implementation pass should inspect only the files necessary to identify the existing shell/layout/theme seams and then produce a small PR. Do not re-audit the full Commerce architecture.
