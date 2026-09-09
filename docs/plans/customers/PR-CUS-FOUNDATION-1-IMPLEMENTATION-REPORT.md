# CUS-FOUNDATION-1 — Customer Digital Access Foundation Implementation Report

**Status:** IMPLEMENTED — awaiting review; not merged or deployed

**Base SHA:** `d3f4c58f173c51fb92856776dd809ff581ec3842`

**Validated implementation SHA:** `18eb9c6a136c9afd3e07f60f98894b775c54946e`

**Branch:** `feat/cus-foundation-1`

The final PR head also contains this report; the immutable final head is recorded in the PR metadata and hand-off report.

## Files changed

**IMPLEMENTED**

- Customer auth controller, login/register requests, customer-safe resource, and customer middleware under `app/Http`.
- `CustomerIdentity` and `CustomerPartnerLink` models, and the corresponding authentication, identity-registration, and explicit-link services.
- Request-scoped `CustomerContext`, tenant provider bindings/rate limiters, Partner relationship, staff permission declaration, API routes, and one foundation migration.
- Focused feature and database-invariant tests.
- This implementation report.

No Commerce order, checkout, inventory, accounting, ledger, ZATCA, POS financial, portal UI, or deployment file was changed.

## Principal hardening

**IMPLEMENTED / VERIFIED**

- The complete internal staff route group now applies `auth:sanctum`, then `EnsureUserPrincipal`, then `SetTenant`, then `SetBranch`.
- `EnsureUserPrincipal` therefore rejects a non-`User` Sanctum principal before staff tenant or branch context is established.
- Platform administrator, API client, developer, and other intentionally separate principal flows retain their existing route boundaries.
- Tests prove an authorized staff token can enter staff routes, a customer token cannot, and a staff token cannot enter customer-only routes.

## CustomerIdentity

**IMPLEMENTED / VERIFIED**

- `CustomerIdentity` is a tenant-owned, company-wide, Sanctum-compatible principal distinct from `User` and `Partner`.
- It stores display name, original and normalized email, optional original and E.164-normalized phone, hashed password, active state, email verification timestamp, last-login timestamp, remember token, timestamps, and soft deletion.
- Registration creates only an unverified `CustomerIdentity`; it neither creates nor links a Partner.
- The same normalized email is permitted in different tenants and rejected within one tenant by a database unique constraint.

## Tenant resolution

**IMPLEMENTED / VERIFIED**

- Customer endpoints use `/api/customer/v1/{tenantSlug}/...`.
- `ResolveCustomerTenant` validates a globally unique route slug, resolves only an active tenant, and establishes `TenantContext` before Sanctum authentication or credential lookup.
- Missing, malformed, unknown, or inactive tenants fail closed. Tenant and branch context are cleared before and after the request.
- Request-provided `tenant_id`, `customer_identity_id`, and `partner_id` are never ownership authority and cannot override server-derived context.

## Authentication and session behavior

**IMPLEMENTED / VERIFIED**

- V1 login is email plus password, scoped to the already-resolved tenant.
- Unknown email, incorrect password, unverified identity, and inactive identity return the same generic validation response. A dummy password hash reduces identifier-dependent timing differences.
- A successful login issues a Sanctum token with only `customer:access`, an explicit seven-day expiry, and no staff semantics.
- Logout revokes the current token. `me` returns only the dedicated customer-safe resource and trusted Partner-link state.
- Registration and login have tenant/IP and tenant/normalized-email rate limits.

## Verification, recovery, and invitation

**DEFERRED / REQUIRES VERIFICATION**

Targeted repository inspection found no real production-capable proof-delivery mechanism that can safely complete email verification, password recovery, invitation, or customer-driven Partner claim. Accordingly:

- no verification, recovery, invitation, or public claim endpoint is enabled;
- registration returns a non-enumerating `202` response and issues no token;
- no fake verification, hard-coded OTP, auto-verification, log-only proof, or insecure recovery was added;
- these flows require an approved production delivery channel and replay-safe proof design before enablement.

This deferral does not weaken the implemented shared foundation and does not block the Commerce foundation gate.

## CustomerIdentity ↔ Partner link

**IMPLEMENTED / VERIFIED**

- `CustomerPartnerLink` records explicit, auditable active/revoked history, link method, timestamps, and staff actors.
- One Partner can link to many identities; each identity can have at most one active Partner link while retaining revoked history.
- The service requires one tenant, a verified/active identity, an active customer/both Partner, and an active staff actor with `customer_access.manage`.
- The current service path records `staff_verified_claim`; invitation remains disabled until secure proof delivery exists.
- Email, phone, and name matches never trigger linking. Cross-tenant links are rejected in the service and by composite database foreign keys.
- No public link endpoint was added.

## CustomerContext and IDOR controls

**IMPLEMENTED / VERIFIED**

- A request-scoped `CustomerContext` exposes only server-derived `tenantId`, `customerIdentityId`, nullable `linkedPartnerId`, and `hasPartnerLink`.
- It is established only after tenant resolution, Sanctum authentication, and customer-principal validation.
- A linked Partner is exposed only through an active link to an active, non-deleted customer/both Partner. Revoked links are absent.
- Tests cover forged owner IDs, same-tenant IDOR attempts, cross-tenant route/token mismatch, request tenant override attempts, and context cleanup.

## Database invariants

**IMPLEMENTED / VERIFIED**

- Unique `(tenant_id, email_normalized)` and `(tenant_id, phone_e164)` constraints protect tenant-local identifiers.
- Composite foreign keys enforce tenant equality across identity, Partner, and staff audit actors.
- A partial unique index on `(tenant_id, customer_identity_id) WHERE status = 'active'` is the concurrency-safe database backstop for identity active-link cardinality.
- Tests exercise duplicate identifiers, cross-tenant links, Partner 1:N identities, revoked-link history, and the partial index. PostgreSQL catalog assertions verify the production index predicate.

## Validation

**VERIFIED**

- SQLite, PHP 8.4: **PASS** — 3,161 passed, 15 PostgreSQL-only tests skipped, 20,619 assertions.
- PostgreSQL, PHP 8.4: **PASS** — 3,176 passed, 20,688 assertions.
- Both jobs ran the complete repository suite after fresh migration.
- The first run exposed one incorrect new assertion: a valid customer principal presented to another tenant correctly failed as `403`, while the test expected `401`. The test was corrected without changing application behavior; no latest-main baseline failure required reconciliation.

## Deferred and open items

**DEFERRED**

- Production email verification and activation.
- Password recovery.
- Invitation/customer-driven claim and replay-safe proof consumption.
- Customer Portal, B2B roles, saved addresses, and Commerce integration.

**REQUIRES VERIFICATION**

- Select and approve a production-capable email delivery provider/mechanism before enabling verification, recovery, invitation, or claim flows.
- Define delivery operations such as sender identity, bounce handling, secret/key custody, observability, and abuse limits with that mechanism.

## Boundary verification

**VERIFIED**

The final diff is confined to Customer Digital Access foundation files, the minimum staff principal guard/permission integration, Partner's relationship declaration, routes, migration, tests, and this report. It does not modify Commerce checkout or orders, InventoryReservation, SalesChannel/FulfillmentPolicy, contacts/addresses, accounting/ledger, balances, invoices/payments financial behavior, ZATCA, inventory valuation/COGS, POS financial behavior, portal UI, deployment, or the approved architecture documents.

CUS-CONTACT-1-MIN remains not required before Commerce resumes. Guest and account checkout remain conceptually allowed; checkout integration is deliberately outside this PR.

COMMERCE CUSTOMER FOUNDATION GATE:
PASS
