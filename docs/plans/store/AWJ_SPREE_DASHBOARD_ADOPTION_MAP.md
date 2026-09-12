# AWJ × Spree Dashboard — Adoption Map

**Status:** Architecture/design decision support only — no implementation, merge, or deployment authorized
**Date:** 2026-09-12

## 1. Decision

AWJ will not adopt Spree Admin as a second ERP administration system. Spree Dashboard is treated as a reusable commerce UI/UX and implementation source where doing so reduces duplicated work without weakening AWJ's accounting, security, tenant, inventory, customer, or pricing authority.

Core rule:

> AWJ remains the system of record. Reuse or adapt Spree commerce administration where the ownership boundary is genuinely commerce-specific; link back to AWJ where the capability already belongs to ERP.

## 2. Non-negotiable boundaries

The following remain authoritative in AWJ and must not be replaced by Spree models or state:

- Tenant isolation, staff authentication, roles and permissions.
- Accounting, journals, invoices, credit/debit documents, tax and ZATCA flows.
- Product master data.
- Inventory truth, stock movements, reservations and valuation.
- Customer/Partner truth and Customer Platform identity/linking.
- Price resolution and approved AWJ price sources.
- Financial reporting.

`CommerceOrder` remains distinct from `Invoice`; commerce fulfillment must not create accounting or inventory postings outside existing AWJ services.

## 3. Adoption classification

- **REUSE-CANDIDATE** — inspect Spree code/components for direct reuse where licensing, dependencies, i18n/RTL and AWJ design-system fit are acceptable.
- **ADAPT** — reuse interaction model/component structure, but bind it to AWJ contracts and visual system.
- **AWJ-LINK** — capability belongs to existing AWJ ERP; Commerce Workspace shows context/summary and deep-links to the authoritative AWJ screen.
- **AWJ-COMMERCE** — implement on AWJ Commerce models/services; Spree is UX/reference only.
- **REJECT** — do not adopt Spree authority or duplicate the capability.
- **LATER** — defer until an explicit product requirement exists.

## 4. Capability map

| Capability | Decision | AWJ authority / implementation note |
|---|---|---|
| Commerce dashboard shell | ADAPT | Build AWJ Store dashboard with store sales/orders/alerts/channel health; no duplicate ERP dashboard. |
| Dashboard cards/charts/table patterns | REUSE-CANDIDATE | Inspect isolated React UI pieces; restyle to AWJ and Arabic-first RTL. |
| Store selector / multi-store navigation | ADAPT | Bind to AWJ Store/SalesChannel + tenant boundary; never Spree tenant isolation. |
| Store general settings form | ADAPT | Strong candidate: name, locale, timezone, storefront access and commerce toggles mapped to AWJ Store settings. |
| Store language | AWJ-COMMERCE | Arabic primary + English; RTL/LTR follows AWJ policy. |
| Store identity / logo / branding | ADAPT | Store/channel-specific settings; AWJ ERP identity is not forced on merchant storefront branding. |
| Theme tokens / colors / typography | ADAPT | Use AWJ Store theme contract; do not import Spree visual identity wholesale. |
| Storefront connection/setup UX | REUSE-CANDIDATE | Useful onboarding pattern; bind to AWJ storefront deployment/domain contract. |
| Custom domain | AWJ-COMMERCE | Must resolve securely to tenant/store/channel. Do not reuse Spree isolation semantics. |
| SEO settings | ADAPT | Reuse mature forms/patterns where possible; AWJ Store owns persisted commerce SEO settings. |
| Static pages / policies | ADAPT | Commerce-owned content; preserve merchant ownership and safe rendering. |
| Page/section builder | LATER | Valuable but not required for current foundation. |
| Product management | AWJ-LINK | Product master stays in AWJ. Store adds only commerce listing/publication context. |
| Product publication / "show in store" | AWJ-COMMERCE | Commerce listing/channel publication layer; must not fork product truth. |
| Product media | AWJ-LINK | Reuse AWJ ProductMedia; store consumes publishable media. |
| Categories / collections | ADAPT | Reuse AWJ taxonomy where valid; commerce presentation/collections may be channel-specific. |
| Variants/options | LATER | Do not import Spree Variant model automatically. |
| Pricing UI | AWJ-LINK | AWJ pricing remains source of truth. Commerce may display resolved price and channel context. |
| External pricing-provider concept | ADAPT | Spree pattern validates provider abstraction; map to AWJ price-resolution contracts rather than Spree pricing state. |
| Inventory UI | AWJ-LINK | AWJ inventory is authoritative. |
| External inventory-provider concept | ADAPT | Strong architectural fit: storefront/commerce reads AWJ availability/reservation contracts. |
| Low-stock commerce alert | ADAPT | Derived from AWJ inventory truth; no second stock counter. |
| Orders list/detail | AWJ-COMMERCE / ADAPT | `CommerceOrder` is authoritative; Spree order-management UX can guide layout/actions. |
| Cart | AWJ-COMMERCE / ADAPT | AWJ cart authority; Spree UX/reference only. |
| Checkout settings | ADAPT | Reuse settings concepts such as guest checkout/address requirements where they fit AWJ contracts. |
| Checkout runtime | AWJ-COMMERCE | AWJ state machine/services remain authority. |
| Payment capture settings | ADAPT | UI/settings only; financial posting and provider orchestration remain AWJ-controlled. |
| Payment gateways | AWJ-COMMERCE | Integrate providers behind AWJ payment contract; never bypass accounting/payment controls. |
| Shipping methods/settings | ADAPT | Strong reuse/reference candidate for admin UX; persistence uses AWJ Commerce shipping model. |
| Fulfillment / shipment / tracking | AWJ-COMMERCE / ADAPT | Requires real commerce fulfillment entity; DeliveryNote is not silently treated as Shipment. |
| Pickup locations | AWJ-COMMERCE | Build policy over AWJ warehouse/location/channel contracts; Warehouse != storefront. |
| Returns | AWJ-COMMERCE / ADAPT | Commerce journey orchestrates existing approved AWJ financial/inventory paths. |
| Refunds | AWJ-COMMERCE | Refund != Return != CreditNote; accounting authority stays AWJ. |
| Customers | AWJ-LINK | Customer Platform/Partner is authoritative. |
| Customer order history | AWJ-COMMERCE | Read from CommerceOrder under customer context. |
| Address book | AWJ-COMMERCE | Current order snapshot is not a reusable address book; separate capability required. |
| Email commerce settings/templates | ADAPT | Reuse admin patterns; integrate with AWJ notification infrastructure. |
| Analytics/GA4 | ADAPT / LATER | Useful commerce analytics, never accounting source of truth. |
| Reports | AWJ-LINK / AWJ-COMMERCE | Link to AWJ reports; add only genuinely channel-specific commerce metrics. |
| API keys/developer UI | REJECT / AWJ-LINK | AWJ Developer Platform is authoritative; do not create parallel Spree credentials. |
| CSV import/export | AWJ-LINK | Reuse AWJ pipelines where applicable. |
| Bulk operations | AWJ-LINK / ADAPT | Existing AWJ operations remain authority; commerce may add publication/channel actions. |
| Promotions/coupons | LATER | Do not import a general rules engine before an explicit launch requirement. |
| Gift cards/store credit | LATER | Requires independent accounting/product decision. |
| B2B/wholesale | LATER | Outside current first vertical slice. |

## 5. What the current Spree Dashboard evidence changes

The current Spree React dashboard is not merely a visual reference. Its repository contains a real dashboard package, E2E tests and store-settings routes. The store settings implementation includes useful commerce concepts such as storefront access, guest checkout, address requirements, payment capture timing, inventory tracking/reservations, low-stock threshold, price/inventory provider selection and failure policies.

This changes the earlier default from **"borrow UX, rebuild all admin"** to **"reuse/adapt first when the boundary is commerce-owned; rebuild only when AWJ contracts or design require it."**

The provider pattern is especially relevant: AWJ can remain the pricing and inventory authority while the Commerce UI consumes explicit AWJ providers/contracts. This is preferable to importing Spree product, price or inventory truth.

## 6. Current AWJ implementation that must be preserved

Repository evidence already contains AWJ Commerce foundations including `CommerceOrder`, `CommerceOrderLine`, order services/reservation work, customer-commerce integration and storefront work. These are not discarded by this decision. The adoption pass is intended to reduce future duplicated admin/UI work, not restart Commerce.

## 7. Immediate plan change

Before implementing another broad Store Admin surface:

1. Inventory the relevant Spree Dashboard routes/components by capability.
2. For each **REUSE-CANDIDATE**, check license/dependency boundary, RTL/i18n, accessibility, API coupling and design-system fit.
3. Define AWJ Store Settings contract before wiring forms.
4. Preserve deep links into AWJ for ERP-owned resources instead of duplicating CRUD.
5. Implement commerce-owned settings incrementally behind tenant/store/channel authorization.
6. Run focused security/tenant tests before wider UI/build tests.

## 8. Recommended next implementation slice

**STORE-ADMIN-ADOPT-1 — Store Settings Foundation**

Small scope:

- Define/read the existing AWJ Store/SalesChannel/settings evidence first; no speculative schema migration.
- Map only general store settings and storefront publication/access settings.
- Adapt the useful Spree settings information architecture to AWJ design system and Arabic-first RTL.
- Products, inventory, pricing, customers and accounting remain links/read-only context to AWJ authority.
- No shipping/payment gateway/page-builder expansion in this PR.
- No merge or deployment without explicit approval.

## 9. Gate before coding

Do not start `STORE-ADMIN-ADOPT-1` until repository evidence confirms where store-scoped settings currently live and whether an existing settings JSON/table/model can safely carry the first slice. Any DB/API expansion requires explicit review for tenant isolation and backward compatibility.
