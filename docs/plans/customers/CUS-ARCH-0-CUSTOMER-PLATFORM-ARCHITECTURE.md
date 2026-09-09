# CUS-ARCH-0 — AWJ Customer Platform Architecture & Repository Evidence Pass

**Status:** Architecture decision and implementation contract; no application implementation authorized

**Date:** 2026-09-09

**Base SHA:** `83bea87f5b36923495d51a42c82e1cdb1fe60fba`

**Scope:** AWJ-wide customer digital access foundation, Partner boundary, tenant resolution, authorization, and Commerce integration

## 1. Executive Summary

1. **AWJ VERIFIED — `Partner` is the current AWJ Customer Master.** It is the tenant-owned commercial/accounting party used by invoices, payments, receivables/payables, statements, quotes, recurring invoices, returns, credit/debit notes, POS, price lists, CRM, delivery notes, procurement and the current Commerce order/price services. It must remain authoritative for commercial identity, tax identity, credit policy, pricing assignment, classifications and ledger counterparty linkage.
2. **DECISION — Customer Digital Identity is a new tenant-owned, company-wide authentication principal.** It is neither `User` nor `Partner`, and it is shared by Customer Portal, AWJ Web Store and «متجرنا». V1 uses one `CustomerIdentity` aggregate plus an explicit `CustomerPartnerLink`; it does not create a Commerce-private customer database.
3. **DECISION — cardinality is Partner 1 ↔ N CustomerIdentities through an explicit link entity.** V1 permits at most one active Partner link for one identity, while one Partner may have many linked identities. This supports a B2C identity now and preserves the later company scenario (أحمد/محمد/خالد) without implementing B2B roles today.
4. **AWJ VERIFIED + DECISION — resolve tenant before credential lookup by globally unique `Tenant.slug`.** The V1 customer route carries the tenant slug in its path. A fail-closed middleware resolves an active, non-deleted Tenant and sets `TenantContext` before any identity lookup. `SalesChannel.slug` cannot do this alone because it is unique only inside a tenant. Email/mobile are never global tenant resolvers.
5. **AWJ VERIFIED — Sanctum token storage is reusable; staff authentication architecture is not.** `personal_access_tokens` is polymorphic and already serves `User`, `PlatformAdministrator` and `ApiClient`. CustomerIdentity may use Sanctum tokens, but must have its own login controller, token abilities, principal-type middleware, route group and `CustomerContext`. Staff RBAC and `User + role=customer` are rejected.
6. **SECURITY BLOCKER — staff routes need an explicit principal-type guard before customer tokens exist.** The main internal group currently begins with `auth:sanctum`, then `SetTenant`/`SetBranch`, but does not globally require `User`. Existing code proves `auth:sanctum` accepts multiple tokenable types and uses explicit type guards for platform/developer surfaces. `CUS-FOUNDATION-1` must place `EnsureUserPrincipal` before `SetTenant` on the complete staff group and add regression tests.
7. **AWJ VERIFIED + DECISION — no shared Contact/Address schema is required to resume Commerce.** Partner already contains one current contact/address and AWJ has a separate staff-managed `Contact` model. These are sufficient as current/default B2C data when a Partner is linked. Guest and unlinked checkout must capture immutable order contact/shipping/billing snapshots later on CommerceOrder; that snapshot is not a reusable address book. Therefore **`CUS-CONTACT-1-MIN = NOT REQUIRED BEFORE COMMERCE RESUMES`**.
8. **AWJ VERIFIED — current CommerceOrder needs a later integration change.** It has nullable `partner_id`, but no customer identity ownership and no contact/address snapshot. `CommerceOrderService::create()` accepts an optional raw Partner ID. A later Commerce PR must derive ownership and any linked Partner from trusted `CustomerContext`, add a nullable customer-identity ownership reference, and add immutable order snapshots. This CUS-ARCH-0 PR does not modify Commerce.

**Commerce unblock conclusion:** merge the tenant-safe CustomerIdentity/authentication/context foundation, explicit Partner link foundation, staff/customer token-type separation and ownership/IDOR tests. Customer Portal, saved/multiple addresses, B2B roles, loyalty, memberships and subscriptions are not prerequisites.

## 2. Repository Evidence

### 2.1 Evidence rules used

| Label | Meaning in this report |
|---|---|
| **AWJ VERIFIED** | Proven by current repository implementation/tests at the Base SHA. |
| **EXTERNAL VERIFIED** | Proven by the external sources recorded in the authoritative Daftra reference. |
| **DECISION** | Approved product direction or architecture selected by this pass. |
| **INFERENCE** | Consequence derived from verified implementation, identified as such. |
| **OPEN / REQUIRES VERIFICATION** | Repository evidence is insufficient or an operational choice remains. |

Planning documents were used to understand approved intent but never as proof that code exists.

### 2.2 High-confidence repository findings

| Finding | Evidence | Classification |
|---|---|---|
| All `BaseModel` business records receive `TenantScope`, and creation injects `tenant_id` from `TenantContext`. | `BaseModel`, `BelongsToTenant`, `TenantScope` | **AWJ VERIFIED** |
| `TenantScope` is fail-open when no context exists. Public data routes therefore need a fail-closed guard. | `TenantScope::apply`, `PublicApiTenantGuard` | **AWJ VERIFIED** |
| Partner is `BranchScoped` and conditionally shareable by independent customer/supplier flags. | `Partner`, `BranchScope`, `BranchSharing`, branch tests | **AWJ VERIFIED** |
| Staff login looks up globally unique `users.email`, then infers tenant from User. | users migration 027, `AuthController::login`, `ApiAuthTest` | **AWJ VERIFIED** |
| That staff rule cannot be copied to customers because customer identifiers must be reusable across tenants. | approved direction + customer collision requirement | **DECISION** |
| Sanctum authenticates any supported tokenable type unless a type middleware narrows it. | `EnsurePlatformAdministrator`, `EnsureUserPrincipal`, `AuthenticateApiClient` | **AWJ VERIFIED** |
| No CustomerIdentity/CustomerAccount/auth controller/guard/routes currently exist. | repository-wide exact-name and concept search | **AWJ VERIFIED** |
| No customer Address model/table or order address snapshot exists. | models, migrations, CommerceOrder schema | **AWJ VERIFIED** |
| A separate `Contact` exists, optionally linked to Partner, but it is a branch-scoped staff CRM record rather than an auth principal or address book. | `Contact`, contacts migration/controller/tests/UI | **AWJ VERIFIED** |
| Commerce has no API route yet; its services are internal domain services. | `CommerceModuleBoundaryTest`, routes | **AWJ VERIFIED** |
| Latest main contains the generic COM-1B reservation primitive and COM-5A CommerceOrder, but no COM-5B order-to-reservation orchestration. | `InventoryReservationService`, `CommerceOrderService`, migrations, git history | **AWJ VERIFIED** |

### 2.3 Repository packaging qualification

The repository is an AWJ core overlay: CI/setup creates Laravel 11, installs Sanctum, then copies this repository's application, migration, route and test files. Consequently the generated framework `config/auth.php`/`config/sanctum.php` are not source files in this repository. Reuse decisions in this report rely on AWJ's explicit Sanctum models/controllers/middleware/migration and assembly scripts, not on an assumed checked-in guard configuration. **AWJ VERIFIED.**

## 3. Current Partner Architecture

### 3.1 Customer Master decision

**DECISION: Yes, `Partner` is the correct AWJ Customer Master.** No new Customer Digital Identity table may duplicate or replace Partner's commercial/accounting truth.

`Partner` is one commercial party with two independent dimensions:

- `type`: `customer | supplier | both`;
- `entity_type`: `individual | commercial`.

`isCustomer()` accepts `customer` and `both`; `isSupplier()` accepts `supplier` and `both`. The schema defaults to customer/commercial. **AWJ VERIFIED.**

### 3.2 Ownership, branch behavior and lifecycle

- `partners.tenant_id` is mandatory and cascades with Tenant; `TenantScope` isolates normal queries. **AWJ VERIFIED.**
- Partner carries nullable `branch_id` and `BranchScope`. Customers and suppliers have separate sharing switches; `both` is shared if either applicable switch is on. Legacy `branch_id=null` rows remain visible across branches. **AWJ VERIFIED.**
- Stored-document relations use `referenceBelongsTo()`/`BranchScope::reference()` to bypass branch filtering while preserving TenantScope, so an existing invoice/statement does not lose its counterparty. **AWJ VERIFIED.**
- Partner uses soft deletion. Several historical tables use `restrictOnDelete`; soft-deleted Partners are excluded by default queries. **AWJ VERIFIED.**
- `is_active` exists, but eligibility enforcement is domain-specific. POS explicitly requires active customer eligibility; current generic Commerce price/order existence checks do not require `is_active` or customer type. **AWJ VERIFIED.**

### 3.3 Fields and relationships that remain on Partner

| Concern | Current Partner evidence | Decision |
|---|---|---|
| Commercial identity | code, type, entity_type, name/name_en | Keep on Partner. |
| Tax/legal identity | vat_number, cr_number | Keep on Partner. Never store as auth claims. |
| Current contact | email, phone, mobile | Keep as commercial contact data; may differ from login identifier. |
| Current national address | address, city, building_no, street, district, postal_code, country | Keep as current/default commercial address. |
| Segmentation | classification plus customer/supplier classification FKs | Keep on Partner. |
| Pricing | default_price_list_id | Keep on Partner; identity may only consume resolved pricing through services. |
| Credit policy | credit_limit, credit_period | Keep on Partner; never expose automatically to customer clients. |
| Status | is_active, deleted_at | Keep on Partner and honor during link-backed transactions. |
| Opening balance | request action posts Partner-tagged journal lines; not a Partner column | Keep in accounting service/ledger. Never move into identity. |

**Information that must not move into CustomerIdentity:** VAT/CR, customer/supplier role, entity type, classifications, price list, credit limit/period, opening balance/receivable balance, branch assignment, accounting references, internal code and commercial active/deleted semantics. **DECISION backed by AWJ VERIFIED usage.**

### 3.4 Current Partner use across domains

| Domain | Current use | Classification |
|---|---|---|
| Invoices/ZATCA | mandatory `partner_id`; buyer data, price-list default, credit limit and receivable journal tagging | **AWJ VERIFIED** |
| Payments/receivables | mandatory Partner, direction, allocations; journal lines tagged by Partner; partner statement/aging derive from these lines/documents | **AWJ VERIFIED** |
| Statements/reports | `ReportService::partnerStatement()` and aging resolve Partner within tenant, intentionally bypassing branch scope | **AWJ VERIFIED** |
| Quotes/recurring invoices | mandatory Partner and conversion into invoice keeps it | **AWJ VERIFIED** |
| POS | mandatory selected/default customer; active customer eligibility; customer price list; held carts store nullable customer | **AWJ VERIFIED** |
| Price lists | Partner has a default PriceList suggestion consumed by invoice/POS/Commerce price resolution | **AWJ VERIFIED** |
| CRM | `CrmActivity.partner_id`, appointments and contacts attach to Partner | **AWJ VERIFIED** |
| Credit/debit notes/returns | Partner identifies the sales/purchase counterparty and receives ledger tags | **AWJ VERIFIED** |
| Delivery/procurement/purchases | delivery customer and purchase/procurement supplier resolve to Partner | **AWJ VERIFIED** |
| Commerce | optional `CommerceOrder.partner_id`; Commerce pricing accepts optional Partner for default price list | **AWJ VERIFIED** |
| Other discovered use | expenses/assets, supplier refunds, corporate fuel contracts/fleet/cards/AVI and journal lines also reference Partner | **AWJ VERIFIED** |

### 3.5 Existing contacts

`Contact` stores tenant, branch, optional Partner, name, job title, email, phone, notes and creator. It is staff-RBAC managed under `partners.view/manage`; it has no password, verification, customer ownership or address fields. It can remain/reuse as a Partner CRM contact, and a later B2B design may optionally link an authorization relationship to a Contact after an explicit audit. It is **not** CustomerIdentity. **AWJ VERIFIED + DECISION.**

**OPEN / REQUIRES VERIFICATION:** `ContactController::update()` does not repeat the create-time `Partner::findOrFail()` ownership validation when `partner_id` changes. CUS-FOUNDATION-1 must not depend on Contact linking; hardening this existing CRUD is a separate small security task.

## 4. Current Authentication Architecture

### 4.1 Staff path end-to-end

1. `/api/register` creates Tenant, accounting/bootstrap records, roles, branch, warehouse and owner `User`; it issues a seven-day Sanctum token. **AWJ VERIFIED.**
2. `/api/login` accepts email/password. `users.email` is globally unique after migration 027, so User is found before tenant is known; active user and subscription are checked; a seven-day Sanctum token is issued. **AWJ VERIFIED.**
3. Internal requests pass `auth:sanctum → SetTenant → SetBranch`; `SetTenant` derives Tenant from authenticated principal and verifies tenant active. Resource routes then use subscription and RBAC middleware. **AWJ VERIFIED.**
4. Logout deletes the current token. Email/password changes require current password and revoke other tokens. **AWJ VERIFIED.**
5. `User` carries staff role, tenant, optional employee, branch/warehouse assignments and RBAC. User does not inherit BaseModel; staff management manually filters by tenant. **AWJ VERIFIED.**
6. No forgot-password/reset flow is implemented in AWJ source. `email_verified_at` exists but no user verification flow is wired. **AWJ VERIFIED.**

### 4.2 Reusable infrastructure

- Laravel hashed password casting/`Hash::check`. **Reusable.**
- Sanctum `personal_access_tokens`, expiry, abilities, current-token logout and token revocation. **Reusable.**
- throttling patterns and request validation. **Reusable.**
- `TenantContext`, `TenantScope`, fail-closed tenant guard pattern and request IDs. **Reusable, with a new pre-auth tenant resolver.**
- explicit principal-type middleware, demonstrated by Platform Administrator, Public ApiClient and developer routes. **Reusable pattern.**
- ownership queries demonstrated by Notification and employee self-service controllers: derive owner from authenticated server context and include ownership in every query. **Reusable pattern.**

### 4.3 Infrastructure that must not be reused as customer semantics

- `User`, User roles, employee link, branch/warehouse assignments and staff RBAC;
- the staff login assumption that email is globally unique;
- staff route group or staff API resources;
- `SetTenant` as the first tenant resolver, because it requires a principal already authenticated;
- internal `PartnerResource`, `InvoiceResource` and `PaymentResource`, which expose staff/commercial fields.

**DECISION:** do not implement `User + role=customer`. Repository evidence instead proves AWJ intentionally separates token principal types and protects them with explicit middleware.

## 5. Tenant Resolution Decision

### 5.1 Evidence

- `tenants.slug` is globally unique. **AWJ VERIFIED.**
- `sales_channels.slug` is only unique by `(tenant_id, slug)`, and the same value is tested across tenants. **AWJ VERIFIED.**
- internal staff login cannot establish tenant before lookup because it relies on globally unique staff email. **AWJ VERIFIED.**
- Public API establishes TenantContext from an already authenticated server-owned ApiClient and then uses a fail-closed guard. That sequence cannot authenticate an end customer whose lookup itself must be tenant-scoped, but its fail-closed pattern is applicable. **AWJ VERIFIED + INFERENCE.**
- no implemented domain/subdomain/custom-domain customer resolver exists. **AWJ VERIFIED.**

### 5.2 V1 decision

**DECISION:** use a route-scoped tenant slug for every customer authentication/public account endpoint, for example:

```text
/api/customer/v1/{tenantSlug}/auth/register
/api/customer/v1/{tenantSlug}/auth/login
/api/customer/v1/{tenantSlug}/me
```

A new `ResolveCustomerTenant` middleware must:

1. validate slug shape/length;
2. query Tenant globally by exact slug, excluding soft-deleted/inactive tenants;
3. set `TenantContext`;
4. fail closed before CustomerIdentity, link, Partner, Order or Address query;
5. never accept `tenant_id` from request body/query/header as authority;
6. allow a later trusted custom-domain adapter to resolve to the same TenantContext without changing identity uniqueness.

Login then queries normalized email/phone inside the established tenant. Therefore `customer@example.com` may exist independently in Tenant A and Tenant B with no collision or leakage.

The sales channel is resolved **after** tenant establishment by `(tenant_id, channel_slug/id)` and is authorization/business context, not tenant authority. **DECISION.**

Unknown tenant and unknown credential responses must be externally non-enumerating on auth endpoints. A storefront discovery route may return a normal not-found for an unknown tenant slug because store tenancy is public, but it must not disclose accounts. **DECISION.**

## 6. Customer Identity Model Decision

### 6.1 Model

**DECISION:** introduce `App\Models\CustomerIdentity`, a tenant-owned, `CompanyWide` customer-facing Authenticatable principal with Sanctum tokens. It is shared inside one tenant across Web Store, «متجرنا» and future Customer Portal; it is not owned by a SalesChannel.

V1 attributes belong to authentication/profile only:

- UUID, tenant ID;
- display name;
- normalized email and/or E.164 phone identifiers;
- hashed password for the approved password flow;
- identifier verification timestamps;
- active status, last-login timestamp, timestamps and soft deletion.

No accounting/commercial Partner fields belong here.

### 6.2 Uniqueness

- unique `(tenant_id, email_normalized)` when email is present;
- unique `(tenant_id, phone_e164)` when phone is present;
- no global email/mobile uniqueness;
- application normalization before insert/update, backed by database unique constraints;
- at least one supported login identifier required by validation/service;
- PostgreSQL tests must prove case-normalized email collision and same-email-different-tenant success.

**DECISION:** an identity from Tenant A does not silently become an identity in Tenant B. Entering another tenant/store starts an independent registration/invitation under that tenant, even with the same email/mobile. No orders, Partner links or profile data cross the boundary. A future marketplace-wide/federated identity is a separate ADR, not V1.

## 7. Partner ↔ Identity Cardinality

### 7.1 Options

| Option | Result | Decision |
|---|---|---|
| A. Partner 1 ↔ 1 CustomerIdentity | Blocks multiple people acting for one company. | Rejected. |
| B. Nullable `partner_id` directly on CustomerIdentity | Preserves Partner 1:N but makes link provenance/revocation and later B2B relationship policy part of the credential record. | Viable but not selected. |
| C. CustomerIdentity + explicit link entity | Keeps authentication separate from commercial authorization; supports audited link/revoke and later relationship roles. | **Selected.** |

### 7.2 Selected foundation

`CustomerPartnerLink` is tenant-owned and records identity, exact Partner, status, link method, who/what established it and link/revocation times.

V1 invariants:

- an identity may be unlinked;
- one identity has at most one current Partner link inside a tenant;
- one Partner may have many linked identities;
- link service verifies both records belong to the current tenant;
- Partner must have customer semantics (`customer|both`) to activate a customer link;
- link creation never merges or edits Partners;
- a revoked link grants no access;
- B2B roles/limits are absent in V1 and default to no organization-wide capabilities beyond explicitly implemented resource ownership.

Later B2B can add relationship role/permissions to the link without changing Partner or CustomerIdentity identity. Example:

```text
Partner: شركة النور
  ├─ أحمد — CustomerPartnerLink — Purchasing (Later)
  ├─ محمد — CustomerPartnerLink — Finance (Later)
  └─ خالد — CustomerPartnerLink — Administrator (Later)
```

## 8. Registration / Invitation / Claim / Linking

### 8.1 Definitions

- **Register:** create a tenant-scoped CustomerIdentity. It does not create/link/merge Partner.
- **Invite:** an authenticated authorized staff actor selects one exact Partner and issues a one-time, hashed, expiring customer-access invitation scoped to tenant + Partner + intended identifier.
- **Claim:** prove control using a valid invitation/verification challenge, then request the exact preselected Partner link. String similarity is not proof.
- **Link:** create/reactivate the explicit CustomerPartnerLink after tenant, identity, Partner, status and proof checks.
- **Unlink/Revoke:** deactivate the link, revoke link-derived access and retain audit evidence; it does not delete either record.
- **Duplicate resolution:** a staff/manual workflow chooses exact records. V1 may report candidates internally but never silently merges or links them.

### 8.2 Lifecycle matrix

| Scenario | V1 lifecycle | Classification |
|---|---|---|
| Existing Partner activates access | Staff with `customer_access.manage` selects exact active customer Partner → one-time invitation → customer registers/logs in under tenant slug → accepts proof → link created. | **DECISION** |
| New Web Store person | Resolve tenant → register and verify CustomerIdentity → remain unlinked → order ownership uses identity; Partner is created/resolved only at later approved business/financial milestone. | **DECISION** |
| New «متجرنا» person | Same Customer Platform endpoints/context; mobile is a channel/client, not a separate identity DB. | **DECISION** |
| Guest checkout | No CustomerIdentity and no automatic Partner. Commerce stores guest/order snapshots and nullable ownership/link references according to checkout policy. | **DECISION** |
| Existing identity enters another tenant | Independent tenant-scoped registration/invitation. Same identifier allowed; no cross-tenant carryover. | **DECISION** |
| Email/mobile matches existing Partner | Matching may suggest an internal candidate only. No automatic link; require an exact invitation/claim policy. | **DECISION** |
| Similar contact shared by multiple Partners | Stop automatic resolution. Staff chooses exact Partner or identity remains unlinked. | **DECISION** |
| Company with multiple authorized users | Separate CustomerIdentities, each with its own explicit link to the same Partner. Roles are Later. | **DECISION** |

### 8.3 Minimum Commerce V1 lifecycle

Commerce needs only:

1. tenant-safe register/verify/login/logout/me;
2. an unlinked authenticated identity capable of owning its own orders;
3. optional invitation-based exact Partner link for existing customers;
4. guest flow with no persistent identity;
5. no silent merge/link and no client-supplied Partner ownership.

Guest-order-to-account historical claim is **not** required to unblock initial Commerce. If added later, it requires a separate proof design (order-bound secret or verified communication challenge), audit and replay protection. **DECISION.**

### 8.4 Verification delivery

**OPEN / REQUIRES VERIFICATION:** the repository has no customer email/SMS verification delivery or password-reset implementation. CUS-FOUNDATION-1 may build the token/challenge boundary, but public self-registration must remain fail-closed/pending until a real delivery channel is configured and verified. Do not return production verification secrets in API responses. Invitation-only activation can be enabled first if its secure delivery process is approved.

## 9. Contacts & Addresses Decision

### 9.1 Verified current capability

Partner contains all expected flat fields: `email`, `phone`, `mobile`, `address`, `city`, `building_no`, `street`, `district`, `postal_code`, `country`. Store/update requests and PartnerResource expose them; tests verify national address/mobile persistence. **AWJ VERIFIED.**

`Contact` supports multiple person records per Partner in practice (no one-to-one constraint), but contains only name/job/email/phone/notes, is branch-scoped, and is controlled by staff Partner permissions. Partner currently has no inverse relation method, and Contact is not a customer-owned address book. **AWJ VERIFIED.**

No reusable customer Address entity, billing/shipping distinction, multi-address book or immutable Commerce order address snapshot exists. **AWJ VERIFIED.**

### 9.2 Decision

For B2C V1, a linked Partner's flat address is sufficient as an optional current/default commercial address. An unlinked identity or guest supplies checkout address/contact data directly for the order snapshot. Saving multiple reusable customer addresses is not necessary to establish identity/auth/ownership.

**`CUS-CONTACT-1-MIN = NOT REQUIRED BEFORE COMMERCE RESUMES`.**

Keep these concepts separate:

| Concept | Authority/lifecycle |
|---|---|
| Current reusable commercial address | Partner flat fields in V1; editable and current. |
| Partner contact person | Existing Contact after its independent CRUD hardening; staff-managed. |
| Saved customer address book | Later `CUS-CONTACT-1`, only if product scope requires it. |
| Order shipping/billing/contact snapshot | Commerce-owned immutable historical evidence captured at checkout/confirmation; required before shippable order flow, even if sourced from Partner. |

This decision corrects the older Commerce Master Plan assumption that multiple Commerce addresses (`COM-6C`) are automatically a prerequisite. The exact proposed plan amendment is in §11.4; this PR does not edit that plan.

## 10. Customer Authorization Boundary

### 10.1 Pattern

**DECISION:** use a dedicated customer route group with all four layers:

1. `ResolveCustomerTenant` — trusted tenant before identity lookup/token use;
2. `auth:sanctum` plus `EnsureCustomerPrincipal` — only active `CustomerIdentity`, never User/ApiClient/PlatformAdministrator;
3. `CustomerContext` — request-scoped tenant ID, identity ID and optional active linked Partner ID established server-side;
4. ownership-aware query/service boundary — every resource lookup includes tenant and identity ownership (or an explicit, active Partner link plus resource-specific permission later).

Staff RBAC may protect staff-side invitation administration, but it is not customer authorization.

### 10.2 IDOR invariant

Customer endpoints never accept `customer_identity_id` or `partner_id` as an authority claim. For an order route, the lookup shape is conceptually:

```php
CommerceOrder::query()
    ->whereKey($orderId)
    ->where('customer_identity_id', $customerContext->identityId())
    ->firstOrFail();
```

TenantScope remains defense in depth; ownership filtering is mandatory because two customers share one tenant. This follows the verified `NotificationController::ownNotifications()` and SelfService pattern. IDs not owned by the caller return a non-enumerating 404. **DECISION backed by AWJ VERIFIED patterns.**

Partner-linked portal resources later require a dedicated service/policy that checks the active link and resource's exact `partner_id`; no route may expose all resources for the tenant or infer access from matching contact text.

## 11. Commerce Integration Boundary

### 11.1 Context contract

**Recommended AWJ-consistent name:** `App\Tenancy\CustomerContext`.

AWJ already names request-scoped boundaries `TenantContext` and `BranchContext`. `CustomerContext` should expose only:

- `tenantId()`;
- `identityId()`;
- nullable `partnerId()` from one active verified link;
- `hasPartnerLink()`.

It must not expose password hashes, raw tokens, verification challenges, staff User, staff permissions or raw credential tables. Commerce consumes this context/service contract rather than authentication implementation details.

### 11.2 Current CommerceOrder impact

Current `CommerceOrder` has `tenant_id`, SalesChannel, nullable Partner, number/status/total/confirmed time and line snapshots. It has no customer identity ownership and no contact/shipping/billing snapshot. `CommerceOrderService::create()` validates an optional tenant Partner but does not require active/customer semantics. **AWJ VERIFIED.**

The current Base SHA contains the tenant-safe, idempotent generic `InventoryReservation` primitive (COM-1B) with optional `source_type/source_id`, but no service currently orchestrates CommerceOrder confirmation into reservations (COM-5B). Customer Platform must not assume such orchestration already exists. **AWJ VERIFIED.**

There is also a recorded plan/implementation mismatch: the Commerce Master Plan's COM-5A text says the order must preserve customer/contact/address and other commercial snapshots, while the merged COM-5A migration deliberately omitted address fields and deferred them to COM-6C. Current code is authoritative; the plan requires the explicit later amendment below before checkout implementation. **AWJ VERIFIED + OPEN / REQUIRES PLAN RECONCILIATION.**

**Later integration required; not modified in CUS-ARCH-0:**

- add nullable `customer_identity_id` (or equivalently reviewed ownership FK) to CommerceOrder;
- keep it null for guests;
- derive it from CustomerContext, never request input;
- derive optional Partner from the active link and reject inactive/deleted/non-customer Partner for new linked transactions;
- do not allow a public/mobile payload to select arbitrary `partner_id`;
- add immutable customer/contact/shipping/billing snapshots before checkout can confirm a shippable order;
- ownership-scope customer order reads and mutations;
- keep internal Commerce service paths explicit and tenant-safe.

### 11.3 Guest flow

```text
Browse → Guest Cart → Checkout policy → CommerceOrder with guest snapshots
```

Browse/add-to-cart must not create Partner or CustomerIdentity. If the downstream invoice bridge requires Partner, an explicit resolution/create step occurs at the approved financial milestone; it is not a side effect of registration or browsing. **DECISION.**

### 11.4 Exact proposed Commerce Master Plan amendment (later review only)

Do not edit the plan in this PR. Proposed amendment:

1. Rename `PR-COM-6A — Commerce Customer Account foundation` to `PR-COM-6A — Integrate Shared Customer Platform Context` and make it depend on merged `CUS-FOUNDATION-1`.
2. Replace `PR-COM-6B — Commerce authentication & ownership guard` implementation language with Commerce ownership integration over `CustomerContext`; authentication remains owned by Customer Platform.
3. Split current `PR-COM-6C`: immutable order contact/shipping/billing snapshot remains a Commerce prerequisite before shippable checkout; reusable/multiple saved addresses move to later `CUS-CONTACT-1` and are not a Commerce unblock prerequisite.
4. Require CommerceOrder's customer identity and Partner values to be server-derived from CustomerContext/link (or null for guest), never raw client authority.
5. Preserve guest browse/cart/checkout according to the selected checkout policy.

## 12. Security / Threat Review

| Threat | Severity | Mitigation | Required |
|---|---|---|---|
| Cross-tenant login collision | Critical | Resolve active Tenant by route slug before identity lookup; composite tenant+normalized identifier uniqueness; generic auth errors. | Foundation V1 |
| Token carries/leaks tenant context | Critical | On every authenticated request compare route Tenant, identity tenant and tokenable identity; set/clear scoped contexts per request; reject mismatch. | Foundation V1 |
| Staff/customer auth confusion | Critical | `EnsureCustomerPrincipal` on customer routes and `EnsureUserPrincipal` before `SetTenant` on all staff routes; token abilities and regression tests in both directions. | Foundation V1 |
| IDOR by changing order/invoice/payment/address ID | Critical | Owner ID comes only from CustomerContext; every query includes identity ownership or exact active Partner link; foreign IDs return 404. | Foundation V1 for own profile/order integration; later per Portal resource |
| Partner claim takeover | Critical | Exact staff-issued, one-time, hashed, expiring invitation; bind tenant+Partner+intended identifier; verify identity control; consume transactionally; audit. | Foundation V1 if Partner linking enabled |
| Silent duplicate Partner linking/merge | High | Never merge; never link from string match; one current link per identity; explicit staff record selection and auditable link service. | Foundation V1 |
| Account enumeration | Medium | Same status/message/timing envelope for unknown identity/wrong password/ineligible login; rate-limit by tenant+normalized identifier+IP without logging secret. | Foundation V1 |
| Inactive/soft-deleted CustomerIdentity | High | Principal middleware rejects; revoke all tokens on deactivate/delete/password/identifier security changes. | Foundation V1 |
| Inactive Partner | High | Existing order history may remain owned by identity, but no new Partner-derived price/credit/transaction; link reports unavailable/inactive. | Foundation V1 link service + later Commerce/Portal integration |
| Soft-deleted Partner | High | Default relation is invalid for new access; treat link as unusable and require staff remediation; never use `withTrashed` for customer authorization. | Foundation V1 |
| Email/mobile changes | High | Require current credential/re-verification; uniqueness in tenant; revoke other/all tokens as policy dictates; never relink Partner automatically. | Foundation V1 |
| Brute force/credential stuffing | High | Tenant+identifier+IP rate limit, generic errors, audit/alerts; no global identifier disclosure. | Foundation V1 |
| Verification/invitation replay | High | Store only token hash, expiry/consumed/revoked state; one transaction/row lock; rotate/revoke; never log raw secret. | Foundation V1 if enabled |
| Guest order claim takeover | High | No email-string matching; order-bound secret or verified challenge plus audit/replay protection. | Later; feature excluded from first unblock |
| B2B user gains organization-wide access | High | V1 link has no implicit roles; deny every capability not explicitly implemented; later role/permission lives on relationship, not identity/Partner. | Foundation default-deny; B2B Later |
| Internal fields exposed to customer API | High | Dedicated customer resources/DTOs; never reuse staff Partner/Invoice/Payment resources wholesale. | Foundation V1 for identity endpoints; later per resource |
| Missing TenantContext fail-open | Critical | Customer route group always includes fail-closed tenant guard before business queries; direct service calls require context explicitly. | Foundation V1 |
| Contact cross-tenant reassignment on update | High | Do not use Contact for auth/link; separately validate Partner on update and add forged-tenant test before customer-side reuse. | Later/separate hardening; not Commerce unblock |

### 12.1 Security blockers before issuing customer tokens

1. Global staff `EnsureUserPrincipal` separation must be merged and tested.
2. Pre-auth route tenant resolution and fail-closed guard must exist.
3. Customer identity uniqueness must be tenant-composite and normalized.
4. Customer-owned resource queries must derive identity from server context.
5. Any Partner claim/invite enabled in production must have real proof delivery and replay-safe consumption.

## 13. CUS-FOUNDATION-1 Proposed Contract

### 13.1 Task

**CUS-FOUNDATION-1 — Customer Digital Access Foundation**

One implementation PR, only after this architecture PR is reviewed. It combines CUS-ID-1 + CUS-AUTH-1. It explicitly excludes CUS-CONTACT-1-MIN because current data plus later Commerce snapshots are enough for V1.

### 13.2 Proposed persistence

#### `customer_identities`

- UUID primary key;
- tenant FK, company-wide semantics;
- display name;
- original and normalized email (nullable);
- original phone and E.164 phone (nullable);
- hidden hashed password;
- email/phone verified timestamps;
- active flag, last login, timestamps, soft deletes;
- unique `(tenant_id, email_normalized)` and `(tenant_id, phone_e164)`;
- index `(tenant_id, is_active)`.

#### `customer_partner_links`

- UUID, tenant FK, CustomerIdentity FK, Partner FK;
- status `active|revoked`;
- method `invitation|staff_verified_claim` (no weak `matched` method);
- linked/revoked timestamps and actor/audit metadata;
- PostgreSQL/SQLite partial unique index on `(tenant_id, customer_identity_id)` where `status = 'active'`, enforcing one current Partner link while retaining revoked historical rows;
- ordinary index `(tenant_id, customer_identity_id, partner_id)` for audit/reconciliation;
- index `(tenant_id, partner_id, status)`;
- service-level same-tenant/customer-type/active checks inside a transaction.

#### `customer_access_invitations` (only if Partner activation ships in the same PR)

- UUID, tenant and exact Partner FKs;
- intended normalized identifier/type;
- random secret hash only, expiry, consumed/revoked timestamps;
- inviter User ID and eventual CustomerIdentity ID;
- unique token hash and indexes for tenant/Partner/status;
- raw secret shown/delivered once and never persisted/logged.

If secure invitation delivery is not operationally approved, keep invitation acceptance disabled and ship identities unlinked. Do not weaken proof to meet schedule.

### 13.3 Models and relationships

- `CustomerIdentity extends Authenticatable`, `HasUuids`, `HasApiTokens`, `SoftDeletes`, tenant-owned/CompanyWide.
- `CustomerPartnerLink extends BaseModel implements CompanyWide`.
- CustomerIdentity has one current link in V1; Partner has many links; link belongs to both.
- No new credential fields/relations on User or Partner.
- Do not make CustomerIdentity branch-scoped or channel-owned.

### 13.4 Services and contexts

- `CustomerIdentityService`: normalize/create/activate/deactivate/change identifiers; never link by string match.
- `CustomerAuthenticationService`: credentials, token issue/revoke, active/verified rules.
- `CustomerPartnerLinkService`: invite/claim/link/revoke with exact tenant and Partner eligibility checks.
- `ResolveCustomerTenant` middleware and fail-closed guard.
- `EnsureCustomerPrincipal` middleware.
- request-scoped `CustomerContext` populated only after tenant and principal checks.
- add `EnsureUserPrincipal` before `SetTenant` to the complete internal staff route group.

### 13.5 Minimal API

Customer surface, under tenant slug:

- `POST auth/register` — creates pending/unlinked identity; no Partner;
- `POST auth/login` — tenant-scoped generic credential result;
- `POST auth/logout` — current customer token only;
- `GET me` — minimal customer-safe identity and optional link state;
- verification challenge/confirm endpoints only with real delivery and hashed replay-safe tokens;
- `POST access-invitations/accept` only if invitation proof is included.

Staff surface:

- create/revoke/list customer-access invitation/link for one exact Partner, protected by a new staff-side `customer_access.manage` permission (owner/admin via `*`, not automatically granted to accountant/staff);
- no customer Portal endpoints and no customer read of invoices/payments/statements in this PR.

### 13.6 Authentication rules

- V1 password auth may reuse hashing and Sanctum storage, not User/provider/RBAC semantics.
- customer token name/abilities are customer-specific and short-lived/revocable;
- route tenant must match CustomerIdentity tenant on every request;
- staff, platform and API-client tokens are rejected from customer routes; customer tokens are rejected from staff/platform/developer/public-M2M routes;
- logout/deactivate/security-sensitive identifier/password change revokes appropriate customer tokens;
- login/register/verification/invitation endpoints are rate-limited.

### 13.7 Registration/link/claim rules

- registration creates CustomerIdentity only;
- no Partner creation on browse/cart/register;
- no automatic link from Partner email/mobile;
- only exact invitation/verified staff claim creates a link;
- no Partner merge in any path;
- same identifier may register under different tenants;
- duplicate normalized identifier inside one tenant returns a generic conflict without exposing account details;
- inactive/soft-deleted/non-customer Partner cannot receive a new active link.

### 13.8 Ownership rules

- context identity and tenant are server-derived;
- `me` ignores any supplied customer/Partner ID;
- future Commerce owns orders by identity reference; guest is null;
- link-derived Partner access requires active exact link and resource Partner equality;
- revoked link ends future Partner-derived access without rewriting historical order ownership.

### 13.9 Validation and required tests

#### Unit/service

- email normalization and E.164 normalization;
- password hashing/hidden serialization;
- registration creates no Partner/User/ledger/order/contact/address;
- exact link eligibility and revoke behavior;
- invitation hash, expiry, one-time use and transaction/replay behavior if included.

#### Feature/security

- Tenant A and B may use the same normalized email/mobile;
- duplicate normalized identifier within one tenant fails;
- tenant slug is resolved before identity lookup;
- route tenant/token tenant mismatch denied without leakage;
- unknown user and wrong password return the same external contract;
- customer token denied from every representative staff route including `/api/me`, account mutation and a resource route;
- staff/ApiClient/PlatformAdministrator tokens denied from customer `me`;
- inactive/deleted identity and inactive/deleted tenant denied;
- forged identity ID/Partner ID ignored or denied;
- identity A cannot read/mutate identity B resource in same tenant;
- cross-tenant Partner link rejected;
- inactive/soft-deleted/supplier-only Partner link rejected;
- matching Partner contact alone never links;
- revoked link stops link-derived access;
- token revocation/logout works;
- login/registration/verification throttling works.

#### PostgreSQL-specific

- composite normalized uniqueness and nullable identifiers;
- case-normalized email race/unique violation translated safely;
- invitation single-consumption concurrency if invitation ships;
- cross-tenant forged link and FK/reference behavior;
- no SQLite-only acceptance of invalid enum/UUID/check constraints.

### 13.10 Non-goals

- Customer Portal, invoice/payment/statement customer APIs;
- saved/multiple addresses or Contact redesign;
- CommerceOrder migration/integration;
- guest-order historical claim;
- B2B roles, approval limits, locations or organization administration;
- memberships, subscriptions, loyalty, balances, attendance;
- marketplace/global multi-tenant consumer identity;
- Partner deduplication/merge engine;
- accounting, ledger, ZATCA, POS or existing commercial behavior changes;
- deployment in the implementation PR without separate approval.

## 14. Commerce Unblock Gate

### COMMERCE UNBLOCK REQUIREMENTS

The absolute minimum merged Customer Platform dependency is:

1. tenant-scoped `CustomerIdentity` independent of User/Partner/Commerce;
2. route-slug tenant resolution before credential lookup plus fail-closed TenantContext guard;
3. customer register/verified activation/login/logout/me with customer-only Sanctum tokens;
4. explicit principal-type separation in both directions, including global staff `EnsureUserPrincipal` hardening;
5. request-scoped `CustomerContext` with tenant, identity and optional exact Partner link;
6. explicit Partner link foundation with no automatic matching/merge (link may remain unused for unlinked B2C accounts);
7. ownership/IDOR, cross-tenant, inactive/deleted and PostgreSQL uniqueness tests;
8. a real verification/invitation proof channel before enabling the corresponding public flow.

After this is merged, Commerce may continue with a separate integration PR that adds identity ownership and immutable order snapshots. **Commerce does not need to wait for:** Customer Portal, reusable/multiple addresses, memberships, subscriptions, loyalty, balances, attendance, full CRM redesign or B2B permissions.

Guest-only catalog/cart work that does not read customer-owned resources can continue independently, provided it creates neither Partner nor CustomerIdentity. **DECISION.**

## 15. Open Decisions

| Decision | Status / required owner |
|---|---|
| Production verification channel (email vs SMS/OTP; provider and delivery evidence) | **OPEN / REQUIRES VERIFICATION before public self-registration is enabled.** |
| Initial checkout policy (guest allowed/optional/required account) | **OPEN product decision**, but architecture supports all three without schema reversal. |
| Exact financial milestone that creates/resolves Partner for an unlinked guest/identity | **OPEN for Commerce-to-Invoice bridge**, not Foundation. |
| Customer token TTL and device/session policy | **OPEN security/product value**, must be fixed in CUS-FOUNDATION-1 before coding. |
| Password reset/recovery channel | **OPEN**; current AWJ source has none. It may follow Foundation but must exist before broad production adoption. |
| Whether a future B2B identity may link to more than one Partner in the same tenant | **OPEN Later**; V1 intentionally permits one current Partner link per identity. |
| Whether CustomerPartnerLink later references an existing Contact | **OPEN Later**, after Contact tenant-update hardening and B2B role design. |
| Customer custom domains/subdomains | **OPEN Later**; resolver must map trusted host to the same TenantContext contract. |

No open item changes the approved separation `User != CustomerIdentity != Partner`.

## 16. Evidence Classification

### AWJ VERIFIED

- Partner schema, semantics, tenant/branch/soft-delete behavior and domain usage;
- current User/Sanctum login/logout/token TTL, global staff email and RBAC;
- explicit multi-tokenable principal guard patterns;
- Tenant slug uniqueness and SalesChannel tenant-composite slug;
- Contact implementation and lack of customer Address/order snapshot;
- current CommerceOrder/CommerceOrderService fields and optional Partner behavior;
- lack of CustomerIdentity/customer auth/customer route implementation;
- ownership patterns in Notification and employee self-service code.

### EXTERNAL VERIFIED

- Daftra/Odoo/Shopify/Adobe product-pattern findings remain as recorded in `DAFTRA_CUSTOMER_PLATFORM_REFERENCE.md`; no new external claim was required by this repository pass.

### DECISION

- tenant-owned CompanyWide CustomerIdentity;
- tenant-slug path resolution before authentication;
- explicit CustomerPartnerLink with Partner 1:N identity cardinality;
- CustomerContext + ownership-scoped customer authorization;
- Sanctum storage reuse with separate customer principal/routes;
- CUS-CONTACT-1-MIN excluded from Commerce unblock;
- no silent Partner creation/link/merge.

### INFERENCE

- introducing a new Sanctum tokenable without globally guarding staff routes creates a principal-confusion risk;
- current Partner/Contact fields suffice for a default current address/contact but cannot substitute for immutable order snapshots;
- CommerceOrder needs a later ownership/snapshot integration migration before authenticated/shippable customer API.

### OPEN / REQUIRES VERIFICATION

- production verification/recovery delivery;
- launch checkout identity policy;
- Partner creation/resolution milestone;
- token/session policy values and Later B2B/global marketplace choices.

## 17. Files Inspected

The pass used repository-wide searches across `app`, `database/migrations`, `routes`, `tests/Feature`, `web/src`, Commerce plans and relevant git history. Material files inspected directly include:

### Customer master, contacts and frontend

- `app/Models/Partner.php`, `Contact.php`, `Classification.php`, `PriceList.php`
- partner/contact/classification/price-list migrations
- `PartnerController`, `ContactController`, Partner/Contact requests/resources
- `PartnerService`, `PriceListService`, `PosCustomerPriceListResolver`
- `PartnerProductTest`, `ApiTenantIsolationTest`, `BranchPartnerIsolationTest`, `BranchSharingTest`, `ContactTest`, `CustomerDefaultPriceListTest`, `PublicApiReadResourcesTest`
- Partner, supplier, contact, CRM, invoice, payment, quote, POS and report UI usages under `web/src`

### Authentication, tenancy and authorization

- `User`, `Tenant`, `Role`, `PlatformAdministrator`, `ApiClient`
- tenant/user/token and user-access migrations
- `AuthController`, `PlatformAuthController`, `AccountSettingsController`, `UserController`
- login/register/account/user requests
- `SetTenant`, `SetBranch`, `EnsureUserPrincipal`, `EnsurePlatformAdministrator`, `EnsurePermission`, `AuthenticateApiClient`, `PublicApiTenantGuard`
- `TenantContext`, `TenantScope`, `BelongsToTenant`, `BranchContext`, `BranchScope`, `BranchSharing`, `ResolvesBranchReferences`
- `Rbac`, `TenancyServiceProvider`, `PublicApiServiceProvider`, `setup.sh`, `deploy/assemble.sh`, CI workflow
- `ApiAuthTest`, `SubscriptionTest`, `AccountSettingsTest`, `ApiRbacTest`, `UserAccessScopeTest`, developer/public API isolation tests
- `NotificationController`, `SelfServiceController` and their ownership patterns

### Partner-consuming business domains

- Invoice, Payment, Quote, RecurringInvoice, CreditNote, ReturnDocument, Purchase, DeliveryNote, ProcurementDocument, CrmActivity, Appointment, JournalLine and related services/controllers/requests/routes/tests
- Reporting `ReportService` and `CustomerReportService`
- POS service/controller/held-sale/customer-setting paths
- fuel contract/fleet/card/AVI Partner references and supplier refund paths discovered by repository search

### Commerce

- `SalesChannel`, `CommerceListing`, `CommerceOrder`, `CommerceOrderLine`, `InventoryReservation`, `FulfillmentPolicy`
- their migrations and service tests through current CommerceOrder/reservation work
- `CommercePriceResolver`, `CommerceOrderService`, reservation/availability services
- `CommerceModuleBoundaryTest`, `CommerceOrderServiceTest`, `CommercePriceResolverTest`, `SalesChannelTest`
- `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`, ADR-01..05 and current Commerce implementation reports

### Authoritative reference

- `docs/plans/customers/DAFTRA_CUSTOMER_PLATFORM_REFERENCE.md`

No application code, migration, API, UI, accounting behavior, Commerce plan, merge or deployment is changed by CUS-ARCH-0.
