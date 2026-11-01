# AWJ Store — Extended Store Customizer Architecture

**Status:** Architecture and product-design decision
**Date:** 2026-09-17
**Scope:** AWJ Storefront customization readiness and future Store Customizer
**Parent specification:** `AWJ_STOREFRONT_DESIGN_SYSTEM.md`

---

## 1. Decision

AWJ Storefront must be **customization-ready from day one**.

The current `AWJ Modern` visual baseline is the first preset and implementation reference. It is not a permanently hard-coded storefront and it must not become a separate codebase that blocks later merchant customization.

The intended architecture is:

`Store Customizer -> validated Theme Configuration -> semantic Theme Tokens + Component/Section Variants -> shared Storefront Engine`

`STORE-UI-1` must establish the customization-ready foundation, but must **not** expand into implementation of the complete Store Customizer. The full merchant editor remains a later bounded workstream.

---

## 2. One Storefront Engine, multiple presets

AWJ must maintain one shared Storefront Engine for catalog, product detail, cart, checkout presentation, customer account and other storefront surfaces.

Presets such as:

- Modern
- Classic
- Simple
- future approved themes

are configurations of the shared engine, not independent storefront applications or duplicated commerce implementations.

A preset may select supported tokens, layouts, section arrangements and component variants. It must not fork commerce truth, checkout logic, tenant resolution or product/category data.

---

## 3. Extended customization vision

The Store Customizer is intentionally broader than a color-and-font picker. The architecture must support gradual expansion across the following presentation families without requiring a storefront rewrite.

### 3.1 Brand identity

Supported configuration may include, as capabilities are implemented:

- store logo and supported logo variants.
- favicon/app/store icon where relevant.
- primary, secondary and accent/promotion colors.
- light/dark or additional approved presentation modes if introduced later.
- supported Arabic and English font families.
- typography scale/weight choices within safe presets.
- border radius and approved surface style.
- button style/variant.
- icon treatment where supported.

### 3.2 Layout and density

Supported configuration may include:

- content/container width presets.
- page density/spacing presets where safe.
- homepage layout preset.
- product-grid density and supported column behavior.
- product-card presentation variants.
- category-card presentation variants.
- header variants.
- footer variants.
- navigation presentation variants.
- supported product-detail presentation variants.

Responsive behavior, accessibility and minimum usability constraints remain platform-controlled. A merchant cannot configure a layout that breaks supported mobile/tablet/desktop behavior.

### 3.3 Homepage composition

The homepage must be section-driven and capable of supporting approved configuration such as:

- show/hide sections.
- safe reordering.
- hero/banner/carousel configuration.
- category sections.
- featured products/collections.
- new products where supported by authoritative data.
- best sellers where supported by authoritative data.
- offers/promotional sections where supported by authoritative data.
- store-benefit/trust blocks only from approved merchant/platform content.
- editorial/content blocks.
- image/banner blocks.
- future approved section types.

The Customizer may compose presentation from eligible AWJ entities; it must not create alternate commerce master data.

### 3.4 Header and navigation

The architecture should allow future approved customization of:

- header layout preset.
- logo placement.
- search presentation.
- account/wishlist/cart visibility only when the corresponding capability exists.
- primary navigation presentation.
- category navigation presentation and supported ordering/selection.
- announcement/utility bar.
- mobile navigation presentation within platform usability constraints.

### 3.5 Product and category presentation

The Customizer may eventually control approved presentation options such as:

- product-card style.
- image aspect-ratio preset.
- badge presentation.
- supported information density.
- quick actions only when backed by real capabilities.
- category-card style.
- category presentation imagery override where explicitly supported.
- featured category/product selection from eligible AWJ entities.

It may not override authoritative price, stock, publication state, product identity, category membership or other commerce facts.

### 3.6 Footer and merchant content

Supported configuration may later include:

- footer layout preset.
- merchant-provided contact/support content.
- approved policy links.
- social links where supported.
- newsletter/content blocks where a real capability exists.
- merchant-provided legal/business presentation fields only when backed by validated AWJ data/configuration.

The storefront must never invent commercial, legal, regulatory, shipping, payment, warranty or security claims.

### 3.7 Pages and content

The broader Customizer may include managed presentation for supported storefront pages and content, including:

- page visibility/navigation placement.
- approved page templates.
- banners and content sections.
- menus and menu ordering.
- SEO presentation fields where a dedicated contract exists.

This does not authorize an unrestricted arbitrary-code page builder.

---

## 4. Theme Tokens are a required architectural boundary

Storefront components must consume **semantic Theme Tokens** rather than merchant-specific hard-coded values whenever an approved token exists.

At minimum the token system should be extensible across:

### Color

- background/surface/subtle surface.
- foreground/muted foreground.
- border.
- primary/primary hover/primary foreground/primary soft.
- secondary/accent/promotion where approved.
- success/warning/danger.

### Typography

- Arabic font family.
- English font family.
- supported heading/body scales and weights.

### Shape and layout

- radius scale.
- spacing/density preset where approved.
- content maximum width.
- component presentation variables that genuinely belong to the theme contract.

### Rule

**No hard-coded theme value inside a storefront component when an approved semantic Theme Token exists.**

Hard-coded values may still be appropriate for platform invariants, accessibility constraints or non-theme implementation details. Theme configuration must not be allowed to weaken safety or accessibility requirements.

---

## 5. Theme Configuration contract

The Storefront Engine must be designed so a future persisted, tenant-scoped Theme Configuration can resolve into safe runtime presentation settings.

The exact database/API schema is deliberately **not defined by this document** and must not be invented during `STORE-UI-1`.

Future persistence must support:

- schema/version identification.
- safe defaults and backward-compatible fallback.
- tenant scoping.
- validation and normalization.
- allowlisted tokens, variants and section types.
- stable references to eligible AWJ entities.
- draft/preview versus published configuration where the approved workflow requires it.
- safe handling of removed/deprecated options.
- deterministic rendering for a published configuration.

Arbitrary executable JavaScript or equivalent unsafe code injection is outside the standard Customizer contract.

---

## 6. AWJ remains the system of record

Customization changes presentation, not commerce truth.

AWJ remains authoritative for:

- products and product identity.
- categories/classifications and membership.
- product options/variants.
- prices and valid promotions.
- inventory and availability.
- product media owned by commerce records.
- publication/eligibility.
- customers and addresses where applicable.
- shipping/payment capabilities and methods when implemented.
- carts, orders and transaction state.
- accounting/financial outcomes.

The Customizer must not duplicate these records into a second storefront-owned source of truth.

---

## 7. Stable entity references and lifecycle safety

When presentation configuration references AWJ-owned products, categories, collections or future eligible entities:

- references must use stable AWJ identifiers.
- resolution must be tenant-scoped.
- cross-tenant resolution is forbidden.
- the referenced entity must remain eligible for storefront exposure.
- unpublished, deleted, unavailable or otherwise ineligible entities must fail safely.
- stale configuration must never resurrect an entity.
- renames and authoritative data changes flow from AWJ unless a separately approved presentation-label capability exists.

Customizer ordering/visibility is presentation metadata and must not mutate catalog hierarchy or product-category membership.

---

## 8. Capability-driven presentation

Optional UI must render only when the underlying AWJ capability exists and is allowed for the storefront.

Examples include:

- wishlist.
- ratings/reviews.
- coupons/promotions.
- Buy Now.
- payment methods.
- shipping methods.
- order tracking.
- membership/loyalty.
- notifications.
- social/newsletter features.

A theme or preset cannot enable a business capability that the backend does not support.

---

## 9. Preview and publishing model

The Customizer UX direction includes:

- live storefront preview.
- Desktop / Tablet / Mobile preview modes.
- RTL/LTR-aware preview.
- draft changes before publication.
- explicit Save/Publish behavior when implemented.
- safe reset/default behavior.

Preview must use the same Storefront Engine and theme-resolution rules as the published storefront as far as practical. A separate fake preview renderer that drifts from production is undesirable.

The exact publication workflow, permissions, auditability and persistence are deferred to the dedicated Customizer implementation task.

---

## 10. Guardrails

Customization must never override:

- tenant isolation.
- authentication/authorization.
- accounting rules.
- price/tax/total calculation authority.
- inventory truth/reservations.
- order/payment state.
- checkout security boundaries.
- publication eligibility.
- accessibility minimums.
- responsive safety constraints.
- supported Commerce API contracts.

Merchant-provided presentation content must be validated and safely rendered. URLs/assets must follow the security and ownership rules defined during implementation.

---

## 11. STORE-UI-1 implementation requirement

`STORE-UI-1 — Storefront Shell` must be implemented as a **customization-ready shell**, while keeping its scope small.

It must establish:

- semantic Theme Token consumption.
- safe default `AWJ Modern` token values/preset.
- shared responsive shell components.
- RTL/LTR behavior.
- customization-ready component boundaries for Header, navigation, content container and Footer.
- no merchant-color/theme hard-coding where semantic tokens apply.
- no duplicated catalog/taxonomy.
- no new persistence schema solely to anticipate the future Customizer.

It must **not** implement the complete merchant editor, database model, publishing workflow or every future component variant.

This is the required balance:

> Build for customization from day one; do not build the full Customizer in STORE-UI-1.

---

## 12. Future Customizer workstream

The full Store Customizer should be delivered incrementally rather than as one oversized feature. A likely decomposition is:

1. Theme Configuration contract and persistence.
2. Branding + semantic colors + typography.
3. Presets and supported component variants.
4. Homepage section visibility/order/composition.
5. Header/navigation/footer configuration.
6. Pages, menus, banners and managed content.
7. Product/category presentation controls.
8. Responsive live preview and draft/publish workflow hardening.
9. Extended presentation capabilities such as SEO/social/content integrations where approved contracts exist.

Each phase must preserve backward compatibility and safe defaults for existing stores.

---

## 13. Acceptance principles

The customization architecture is acceptable only if:

1. A merchant can eventually change substantial storefront presentation without source-code changes.
2. Existing stores continue rendering safely when new customization options are introduced.
3. One Storefront Engine serves all supported presets.
4. AWJ remains the sole source of commerce truth.
5. Theme values are semantic and centrally resolved rather than scattered hard-coded constants.
6. Optional presentation never fabricates unsupported business capabilities.
7. Tenant isolation is preserved for configuration and referenced entities.
8. Mobile, tablet, desktop, Arabic RTL and English LTR remain first-class.
9. Preview cannot silently diverge into a separate commerce implementation.
10. The architecture can grow without requiring a storefront rewrite.

---

## 14. Relationship to visual references

The supplied Store Customizer reference — including Appearance / Pages / Components tabs, theme presets, colors, Arabic/English fonts, homepage layout, section visibility/order and responsive preview — is a **functional direction for the customization experience**.

The surrounding AWJ ERP sidebar visible in that reference is contextual and is not part of the Store Customizer design specification.

Visual references guide UX and presentation. They do not override the architectural, commerce, security, tenant-isolation or accounting boundaries in this document and the parent Storefront Design System.

---

## 15. Final architectural rule

The current storefront design is a **baseline and default preset, not a permanent limitation**.

AWJ Store should be able to evolve from a polished default storefront into a broad merchant-customizable commerce presentation system without duplicating commerce data, forking checkout logic, or rebuilding the Storefront Engine.
