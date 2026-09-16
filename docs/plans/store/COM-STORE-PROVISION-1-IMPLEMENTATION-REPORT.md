# COM-STORE-PROVISION-1 — Tenant-scoped Storefront Provisioning + AWJ-managed Storefront Domain

**Status:** Implemented, tested, PR opened — not merged, not deployed.
**Base:** `main` (`1e7b0c7a13eeee5b1679817b281dc79d4d127003`, "PR-PROD-UX-1: Shared Product Workspace Foundation (#838)").
**Builds on:** `AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md` (Storefront/StorefrontDomain graph and
resolver), `AWJ_COM_WS_2_COMMERCE_STORE_SELECTOR.md` (Commerce Workspace store list). This document does not
redefine that architecture — it documents the explicit *provisioning* action added on top of it.

## 1. Problem

`GET /api/commerce/workspace/storefronts` (COM-WS-2) could list a tenant's web storefronts but nothing could
create the first one through the product. The only way to establish the ownership graph
(`Tenant → web SalesChannel → Storefront → StorefrontDomain`) was two CLI operator commands
(`sales-channel:ensure-web`, `storefront:register-domain`), each requiring interactive human confirmation —
not something an ERP user could trigger from the product, and not something safe to run unattended for a
production tenant such as `alrshd`.

## 2. Explicit provisioning lifecycle

```
Authenticated ERP user (commerce.manage)
        │  POST /api/commerce/workspace/storefronts  (optional { name })
        ▼
EnsurePermission:commerce.manage  ──403──▶  denied, nothing created
        ▼
StorefrontProvisioningService::provisionFirstStorefrontForCurrentTenant()
        │
        │  DB transaction, tenants row locked FOR UPDATE (anchor lock)
        ▼
  1. ensure one active `web` SalesChannel  (reuse if present, fail closed on ambiguity/conflict)
  2. ensure one Storefront on that channel (reuse/reactivate if present, fail closed on ambiguity/conflict)
  3. ensure one AWJ-managed StorefrontDomain, hostname = ManagedStorefrontHostname::forSlug(tenant.slug)
     - new: created as `awj_subdomain`, active, verified — immediately
     - existing compatible: converged (reactivated if needed)
     - existing incompatible (different tenant/storefront/type): fail closed, 409, nothing reassigned
        ▼
201 (created) or 200 (idempotent replay) — { store: { id, name, sales_channel_id, is_active, preview_url } }
```

Nothing in this path is triggered automatically by login, dashboard load, tenant creation, Commerce Workspace
`GET`, or the public Host-resolved storefront request. It is reachable only by an explicit `POST` a human user
sends, gated by RBAC.

### Existing/partial state handling

| Found state | Behaviour |
|---|---|
| No `web` SalesChannel | create one (`slug: web`, `type: web`, `is_active: true`) |
| Exactly one active `web` SalesChannel | reuse, no mutation |
| More than one active `web` SalesChannel | fail closed (`RuntimeException` → 422), nothing created |
| `web` slug occupied by an inactive/wrong-type/soft-deleted channel | fail closed, nothing created |
| No Storefront on that channel | create one (`slug: main`, `name`: request `name` or tenant name) |
| Exactly one Storefront on that channel, inactive | reactivate it (matches `RegisterStorefrontDomainCommand`'s own precedent), no new row |
| More than one Storefront on that channel | fail closed, nothing created |
| No `StorefrontDomain` for the generated hostname | create it as `awj_subdomain`, active, verified |
| Domain exists, same tenant/storefront, type `awj_subdomain` | converge (reactivate/reverify if needed) |
| Domain exists, same tenant/storefront, type `custom` (manually registered) | fail closed — never reclassified automatically |
| Domain exists, different tenant or different storefront | fail closed, 409, **no reassignment, no delete, no overwrite** |
| Managed base-domain config missing/invalid | fail closed *before* the transaction opens — no partial graph |

## 3. Managed Storefront domain contract

- Env var: `AWJ_STOREFRONT_BASE_DOMAIN` (new, separate from `AWJ_TENANT_BASE_DOMAIN`).
- Config key: `config('storefront.managed_base_domain')` in `config/storefront.php`.
- Config default (future production value, same pattern as `config/tenancy.php`'s `awj.app` default):
  `store.awj.app`.
- Current AWJ temporary environment (set via Railway env var, not committed here): `store.awjdev.xyz`.
- Generated example: tenant slug `alrshd` → `alrshd.store.awjdev.xyz` (temporary) /
  `alrshd.store.awj.app` (future). Changing the env var alone changes all future generated hostnames — no
  code change.
- Hostname generation and validation live in one place, `App\Support\ManagedStorefrontHostname`:
  - `configuredBaseDomain()` — reads, normalizes (via the existing `HostnameNormalizer`, the single
    normalization path for the whole Storefront domain subsystem), and validates the configured base domain;
    rejects empty/malformed/wildcard values.
  - `forSlug($slug, $baseDomain = null)` — builds `{slug}.{baseDomain}`, normalizes it, and asserts it is
    *exactly one label* beneath the base domain via `isUnderBaseDomain()`.
  - `isUnderBaseDomain($hostname, $baseDomain)` — a pure boundary check with no config/DB access, so it is
    tested directly against attack strings (`store.awjdev.xyz.evil.com`, `evilstore.awjdev.xyz`, …).

## 4. AWJ-managed (`awj_subdomain`) verification trust boundary

Automatic (unattended, no operator step) `verification_status = verified` is granted **only** when all of the
following hold, enforced by `StorefrontProvisioningService::ensureManagedDomain()`:

1. The hostname was generated by `ManagedStorefrontHostname::forSlug()` from the **trusted server-side**
   `tenants.slug` of the currently authenticated tenant (`TenantContext`) and the **configured** managed base
   domain — never from client input.
2. The domain row being created/converged carries `type = StorefrontDomain::TYPE_AWJ_SUBDOMAIN` — set by the
   service itself, never accepted from the request body.
3. Global hostname uniqueness holds (`storefront_domains.hostname` unique index) and, on any existing row for
   that exact hostname, tenant/storefront ownership match exactly — otherwise fail closed, no reassignment.
4. The whole operation runs inside the tenant-row-locked transaction described in §2 — no window where a
   partial graph could be read by a concurrent request or a later step could contradict an earlier one.

`type = custom` (merchant-owned domains, `storefront:register-domain` CLI, the storefront domains screen once
built) is **completely untouched** by this change: its verification remains a manual/operator decision, its
model invariants (`StorefrontDomain::booted()`) are unchanged, and this service never sets `type: custom` or
touches an existing `custom` row's `type`/`verification_status`.

## 5. Authorization

- New RBAC permission: `commerce.manage` (`App\Support\Rbac::PERMISSIONS`). `owner`/`admin` hold it via the
  existing `['*']` wildcard; `accountant`/`staff` do **not** receive it by default (same pattern as every
  other permission added to the matrix recently — `supplier_refunds.manage`, `fiscal_years.manage`, …). A
  tenant can grant it to a custom role explicitly through the existing role-management screen/API
  (`StoreRoleRequest` validates against `Rbac::PERMISSIONS`, which now includes `commerce.manage`).
- Route: `POST commerce/workspace/storefronts` carries `EnsurePermission:commerce.manage`.
- `self_service` (customer/self-service principal) can never hold `commerce.manage` — its permission set is
  fixed to `['self_service.access']` in `Rbac::MATRIX` and is not customizable through the role UI.
- The existing `GET commerce/workspace/storefronts` (COM-WS-2) is **unchanged**: it still only excludes
  `self_service` and does not require `commerce.manage`, exactly as before this ticket. Re-gating a working,
  tested read endpoint was out of scope.
- Tenant identity is never accepted from the client anywhere in this path — it comes exclusively from
  `TenantContext`, itself set by `SetTenant` from the authenticated user's `tenant_id`.

## 6. `ApplicationCatalog` maturity change

`commerce.storefront` moved from `MATURITY_COMING_SOON` to `MATURITY_BUILT` in `App\Support\ApplicationCatalog`
— nothing else about the entry changed (`group: sales`, `mandatory: false`, `dependencies: ['sales.invoicing']`).

This does **not** auto-activate the capability for any tenant. `TenantApplicationService::statusFor()` still
governs the actual per-tenant decision:

- Tenants registered before `ENFORCEMENT_CUTOVER_AT` (2026-08-21) — i.e. effectively every current production
  tenant — are treated as `enabled` by default once the capability becomes `built`, exactly like every other
  already-`built` optional capability (`isGrandfatheredTenant()`), protecting existing tenants per the
  repository's configurable-policies rule.
- Tenants registered after that date default to `disabled` until a tenant explicitly calls
  `POST /applications/enable`.
- No route in this change is gated by `EnsureApplicationActive:commerce.storefront` — the existing Commerce
  Workspace `GET` route was deliberately left un-gated by the catalog before this change (its own docblock
  explains why: a `coming_soon` capability would have closed the workspace to everyone), and extending
  enforcement to it or to the new `POST` route is a separate, broader decision explicitly left out of this
  ticket's scope.
- `web/src/components/layout/sidebar.tsx` does not map any nav item's `appKey` to `commerce.storefront` today,
  so this maturity change has no visible UI side effect on its own.

## 7. Transaction & concurrency

- The whole provisioning operation (SalesChannel → Storefront → StorefrontDomain) runs inside one
  `DB::transaction()`.
- The anchor lock is `Tenant::whereKey($tenantId)->lockForUpdate()->first()` — the exact same pattern
  `App\Support\GeneratesDocumentNumbers` uses for serial numbering. Two concurrent provisioning requests for
  the *same* tenant serialize on this row: the second transaction blocks until the first commits, then re-reads
  the now-committed state and converges to it instead of duplicating it.
- Cross-tenant hostname collision cannot occur naturally: the hostname is deterministic from
  `tenants.slug` (already globally unique, enforced by `unique:tenants,slug` at registration) plus one shared
  base domain, so two different tenants can never generate the same managed hostname. The collision path is
  defense-in-depth (and directly tested against a forged pre-existing row) rather than an expected runtime
  race.
- Verified on real PostgreSQL row locks with `pcntl_fork` (`StorefrontProvisioningPostgresConcurrencyTest`,
  same pattern as the existing `StorefrontCartPostgresConcurrencyTest`): a locker holds the tenant-row lock,
  commits a full graph while a real second provisioning call is blocked waiting on that same row, and the
  second call converges (`created: false`) to the exact row the locker committed — one channel, one storefront,
  one domain.

## 8. What stays out of scope (unchanged)

- `ResolveStorefrontDomain` — not modified. The new domain resolves through it exactly like any other verified,
  active `StorefrontDomain` row (proven by
  `StorefrontProvisioningApiSecurityTest::the_provisioned_managed_domain_resolves_correctly_through_the_unmodified_public_resolver`
  and the cross-tenant negative test in the same file).
- Custom merchant domains, `storefront:register-domain`, `sales-channel:ensure-web` — untouched.
- Cart, Checkout, Payments, shipping, SEO, appearance/theme, multi-store — untouched, not part of this graph.
- No database schema change — the existing `storefronts`/`storefront_domains`/`sales_channels` tables and
  constraints (unique `tenant_id+slug`, globally-unique `hostname`, one-active-primary-domain partial index)
  fully support this feature as-is.

## 9. Files

Backend application code:
- `config/storefront.php` — `managed_base_domain` key.
- `app/Support/ManagedStorefrontHostname.php` — hostname generation/trust-boundary helper (new).
- `app/Support/StorefrontBaseDomainMisconfiguredException.php` (new).
- `app/Services/Commerce/StorefrontHostnameConflictException.php` (new).
- `app/Services/Commerce/StorefrontProvisioningService.php` — the provisioning service (new).
- `app/Http/Requests/ProvisionStorefrontRequest.php` (new).
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php` — added `store()`.
- `routes/api.php` — `POST commerce/workspace/storefronts` behind `commerce.manage`.
- `app/Support/Rbac.php` — added `commerce.manage` permission.
- `app/Support/ApplicationCatalog.php` — `commerce.storefront` maturity `coming_soon` → `built`.

Frontend:
- `web/src/modules/commerce-workspace/stores.ts` — `provisionCommerceStorefront()`.
- `web/src/modules/commerce-workspace/store-context.tsx` — `refresh()`.
- `web/src/modules/commerce-workspace/messages.ts` — new AR/EN keys.
- `web/src/app/(commerce)/commerce/stores/page.tsx` — empty-state create action + store list.

Tests:
- `tests/Feature/StorefrontProvisioningServiceTest.php`
- `tests/Feature/ManagedStorefrontHostnameTest.php`
- `tests/Feature/StorefrontProvisioningApiSecurityTest.php`
- `tests/Feature/StorefrontProvisioningPostgresConcurrencyTest.php`
- `web/src/modules/commerce-workspace/stores.test.ts` (extended)
- `web/src/app/(commerce)/commerce/stores/page.test.tsx` (new)

Documentation:
- This file.

Migrations: **none**.
