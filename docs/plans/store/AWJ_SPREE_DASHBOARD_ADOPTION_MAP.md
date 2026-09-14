# AWJ × Spree Dashboard — Adoption Map

**Status:** Architecture/design decision support only — implementation explicitly deferred while coding models/agents are unavailable
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

## 6. Repository evidence pass — 2026-09-12

A focused read-only pass against current `main` confirmed the following:

### Existing foundation

- `SalesChannel` already exists as a tenant-owned, company-wide Commerce entity and explicitly remains separate from Branch and Warehouse. It supports web, mobile, POS and external channel types.
- `Storefront` already exists as a tenant-owned hosted-store entity linked to a web `SalesChannel`.
- Current `Storefront` persistence already carries `slug`, `name`, `is_active` and `default_locale` (Arabic by default).
- `Storefront` deliberately does **not** currently own branding, theme or SEO configuration; its model documentation explicitly leaves those for later Store Configuration/Design work.
- The `Storefront` save boundary validates that the selected channel belongs to the same tenant and is of type `web`; this invariant must be preserved by every future admin contract.
- `StorefrontDomain` and Host-based resolution already establish the Storefront → Tenant → SalesChannel boundary.
- `CommerceListing`, `CommerceOrder`, fulfillment policy and channel-aware payment availability already build on `SalesChannel`; these foundations must be reused rather than duplicated.

### Confirmed admin gap

The existing Commerce Workspace documentation already records that there is **no tenant-scoped ERP admin API** that lists/manages `SalesChannel`, `Storefront` or `StorefrontDomain`. The public storefront endpoint is Host-resolved and must not be repurposed as a client-selected tenant admin endpoint.

Because of this gap, the current Commerce Workspace store selector and **View Store** action cannot safely become fully operational yet.

### Architectural conclusion

Do **not** create a new Store Settings subsystem from scratch and do not put store configuration directly into `SalesChannel`.

The intended ownership remains:

```text
SalesChannel
  = commercial sales channel identity
        ↓
Storefront
  = hosted store identity, status and default locale
        ↓
Store Configuration / Design
  = future commerce-owned branding, storefront access, SEO, theme and other store-specific settings
```

ERP-owned product, inventory, customer, pricing, payment/accounting and authorization truth remains outside this configuration layer.

## 7. Revised implementation sequence

The earlier broad `STORE-ADMIN-ADOPT-1 — Store Settings Foundation` proposal is split to reduce risk.

### STORE-ADMIN-ADOPT-1A — Store Admin Contract

**Recommended first implementation slice when coding capacity is available.**

Scope:

- Add the minimum authenticated, tenant-scoped ERP admin contract required to read/manage the existing `SalesChannel`, `Storefront` and relevant domain data.
- Reuse existing models and tenant invariants.
- Enable the Commerce Workspace store selector and **View Store** against that safe admin contract.
- Do not repurpose the public Host-resolved storefront API.
- Do not add branding, SEO, checkout, shipping or payment-gateway configuration.
- Prefer **no migration** in 1A unless repository evidence during implementation proves one is strictly necessary.
- Add focused tenant-isolation, authorization and cross-tenant negative tests before broad UI/build tests.

### STORE-ADMIN-ADOPT-1B — Store Settings / Configuration

Only after 1A is stable:

- Define the smallest explicit AWJ Store Configuration contract.
- Adapt the useful Spree settings information architecture to AWJ design system and Arabic-first RTL.
- Introduce only commerce-owned settings with a clear persistence owner.
- Products, inventory, pricing, customers and accounting remain links/read-only context to AWJ authority.
- Any DB/API expansion requires a separate tenant-isolation and backward-compatibility review.

## 8. Deferred decision — 2026-09-12

**Implementation of STORE-ADMIN-ADOPT-1A and 1B is intentionally deferred.**

Reason: the preferred coding models/agents are currently unavailable. There is no operational urgency that justifies spending Work/Codex capacity or starting implementation with a less suitable tool merely to keep the workstream moving.

While deferred:

- The evidence and proposed architecture in this document are the continuation point.
- Do not restart the Spree/AWJ investigation from zero when coding capacity returns.
- Do not create migrations, APIs or UI for this workstream in the meantime.
- Do not merge or deploy anything from this documentation branch without explicit approval.

**Resume point:** `STORE-ADMIN-ADOPT-1A — Store Admin Contract`.
