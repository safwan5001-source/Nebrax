# AWJ COM-7-P2 — Storefront & Domain Resolution Decision

**Status:** Approved architecture decision for COM-7-P2 implementation planning  
**Date:** 2026-09-11  
**Base:** `a31ad154bc5dc524d108d73d930d312fcd9860a6`  
**Scope:** Storefront identity, domain mapping, Tenant isolation, Web SalesChannel binding, locale ownership

## 1. Decision

AWJ will model a hosted commerce storefront as a first-class, tenant-owned entity separate from `SalesChannel`.

Target ownership graph:

```text
Tenant
  └─ Storefront
       ├─ Web SalesChannel
       └─ StorefrontDomain (1..n)
```

A Tenant may own more than one Storefront in the future. COM-7-P2 must not encode a permanent one-store-per-tenant assumption.

`SalesChannel` remains the commercial origin/channel of a sale. It must not be overloaded with hosted-store concerns such as domains, branding, SEO, locale or theme configuration.

## 2. Storefront core

The minimum proposed persistence contract for implementation is:

```text
storefronts
- id (UUID)
- tenant_id
- sales_channel_id
- slug
- name
- is_active
- default_locale
- timestamps
- soft deletes
```

Required invariants:

- Storefront is tenant-owned and must remain under normal AWJ Tenant isolation.
- `slug` is unique within the Tenant: `unique(tenant_id, slug)`.
- The referenced `SalesChannel` must belong to the same Tenant.
- The referenced `SalesChannel.type` must be `web`.
- The referenced SalesChannel must be active before it can establish an active public storefront context.
- A Storefront being active does not bypass Tenant or SalesChannel lifecycle checks.

Branding, theme, SEO, page-builder content and broad appearance settings are intentionally not added to this core table in this phase. Their storage belongs to later Store Configuration / Design work.

## 3. Storefront domains

The minimum proposed domain mapping contract is:

```text
storefront_domains
- id (UUID)
- tenant_id
- storefront_id
- hostname
- type
- is_primary
- is_active
- verification_status
- timestamps
```

Initial domain types:

```text
awj_subdomain
custom
```

`hostname` stores a normalized hostname only, for example:

```text
merchant.awj.app
shop.example.com
```

It must not contain scheme, path, query string, fragment or port.

## 4. Hostname uniqueness and ownership

`hostname` is globally unique across active/persisted domain mappings, not merely unique per Tenant.

This is deliberate: hostname is an input to Tenant/Store resolution, so the same hostname must never be capable of resolving to two Tenants.

A custom domain may reference only a Storefront belonging to the same `tenant_id` carried by its domain record. Cross-tenant Storefront/Domain associations are invalid even if supplied by an internal caller.

Implementation must enforce these invariants server-side and cover them with PostgreSQL and application-level tests where appropriate.

## 5. Primary domain

A Storefront may have multiple domain records but at most one active primary domain at a time.

The exact database mechanism for enforcing the conditional primary-domain invariant must follow repository PostgreSQL/SQLite compatibility conventions. Do not introduce a PostgreSQL-only constraint without an equivalent safe application invariant/test path used by AWJ CI.

A non-primary verified active domain may still resolve to the same Storefront; `is_primary` controls canonical/default URL behavior, not Tenant authority.

## 6. Domain verification

Custom domains must have explicit verification state. An unverified custom domain must never establish production storefront authority.

COM-7-P2A may define the persistence states and resolver guard without implementing a full DNS ownership-verification workflow if that would broaden the PR. The full verification workflow can be delivered separately.

AWJ-managed subdomains may use an AWJ-controlled verification path, but they must still resolve through persisted server-side mapping rather than treating a parsed subdomain slug as Tenant authority.

## 7. Trusted resolution flow

Production resolution is:

```text
Incoming Host
  ↓
Normalize and validate hostname
  ↓
Lookup persisted StorefrontDomain
  ↓
Require domain active and sufficiently verified
  ↓
Load Storefront
  ↓
Require Storefront active
  ↓
Load Tenant + Web SalesChannel
  ↓
Require Tenant valid/active under AWJ conventions
  ↓
Require SalesChannel active + type=web + same Tenant
  ↓
Establish trusted StorefrontContext
```

Failure at any step is fail-closed and non-revealing. Unknown or invalid hosts must never fall back to an arbitrary/default Tenant.

Production Tenant authority must not come from:

- query parameters such as `tenant_id`;
- browser-controlled generic tenant headers;
- arbitrary cookies;
- direct textual parsing of a subdomain slug without persisted mapping;
- the current P1 `AWJ_STORE_TENANT_SLUG` provisional deployment setting.

The P1 environment-based tenant selection is transitional only and must be retired from production resolution when P2 resolution becomes authoritative.

## 8. Laravel remains the isolation authority

The Next.js Storefront may resolve/request store context server-side, but it does not replace Laravel Tenant enforcement.

The public/customer Commerce API must validate the trusted Storefront/Tenant/SalesChannel context according to the final P2 transport contract. A browser must not be able to forge a Tenant by changing a URL parameter, header, cookie or locale.

## 9. Locale ownership

Locale is not Tenant authority and is not Domain authority.

Initial language policy:

- Arabic is the primary AWJ Store language.
- English is fully supported.
- `Storefront.default_locale` defines the default experience.
- Visitor locale switching does not change Storefront, Tenant or SalesChannel identity.
- Arabic renders RTL; English renders LTR.
- The route/locale mechanism may adapt the existing Spree Storefront locale structure but must use AWJ Store semantics.

Examples conceptually:

```text
shop.example.com/ar/...
shop.example.com/en/...
```

Both resolve to the same Storefront/Tenant/SalesChannel.

## 10. Cache isolation

When request caching is introduced/re-enabled, cache identity must include the trusted store context needed to prevent cross-tenant leakage, at minimum Storefront/Tenant and any relevant SalesChannel/locale dimensions.

No generic product/list cache may return Tenant A data to Tenant B.

P2 tests must cover cache isolation if P2 introduces caching. If no cache exists in the affected path, document that fact rather than adding speculative caching.

## 11. Required security tests

Before P2 domain resolution can be considered complete, focused tests must prove at least:

1. Domain A resolves only to Tenant/Storefront/Channel A.
2. Domain B resolves only to B.
3. Unknown hostname fails closed.
4. Invalid hostname fails closed.
5. Inactive domain fails closed.
6. Unverified custom domain fails closed.
7. Inactive Storefront fails closed.
8. Inactive/non-web SalesChannel fails closed.
9. Storefront cannot bind a SalesChannel from another Tenant.
10. Domain cannot bind a Storefront from another Tenant.
11. Globally duplicate hostname is rejected.
12. Client-supplied conflicting `tenant_id` does not change authority.
13. Client-supplied tenant header/cookie does not change authority.
14. Locale switching does not change Tenant/Storefront/Channel identity.
15. Direct public catalog access cannot use a domain to read another Tenant's unpublished or published catalog.
16. Customer identity from Tenant A cannot become valid in Tenant B merely by changing hostname.
17. Cache isolation is proven if caching is present.

These tests are security/Tenant-Isolation tests and must not be reduced merely to save CI time.

## 12. Backward compatibility / migration discipline

COM-7-P2 must be additive and must not reinterpret existing `sales_channels` rows.

Do not:

- add storefront branding/domain fields to `sales_channels`;
- change CommerceOrder accounting semantics;
- change InventoryReservation or FulfillmentPolicy meaning;
- make Storefront equal Branch or Warehouse;
- migrate existing Web SalesChannels into guessed Storefronts without an explicit migration/backfill decision;
- silently select the first Web SalesChannel as permanent multi-store behavior.

Existing COM-7-P1 public catalog behavior should remain available during the migration path until P2's authoritative resolution is proven and the provisional path can be safely retired.

## 13. Implementation split

To keep security and scope reviewable, COM-7-P2 should be split:

### COM-7-P2A — Storefront & Domain Resolution Foundation

- persistence models/migrations;
- Tenant/Storefront/SalesChannel ownership invariants;
- hostname normalization;
- trusted domain resolver/context;
- fail-closed behavior;
- focused Tenant-isolation/security tests;
- no broad UI redesign;
- no cart/checkout/payment/shipping.

### COM-7-P2B — Arabic/English Storefront Integration

- Arabic primary / English supported;
- RTL/LTR;
- default locale from Storefront;
- visitor language switch;
- preserve resolved store identity across locale changes;
- localized storefront catalog shell/content contracts as supported by current AWJ data model.

If bilingual product/category content requires new persistence fields/contracts, stop and document the exact data-model gap before inventing translation storage inside P2B.

## 14. Deferred intentionally

Not decided/implemented by this architecture decision:

- full custom-domain DNS verification automation;
- SSL/certificate provisioning provider;
- final storefront branding/theme schema;
- SEO/page-builder persistence;
- merchant-facing domain-management UI;
- cart/checkout/payment/shipping;
- mobile Store App Builder;
- marketplace/app ecosystem;
- production deployment topology.

## 15. Gate for implementation

Implementation may begin only from current `main`, with this decision and the earlier `AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md` treated as authoritative.

If repository evidence discovered during implementation contradicts a persistence assumption here, stop before changing financial/API/database semantics outside this scope and report the conflict.
