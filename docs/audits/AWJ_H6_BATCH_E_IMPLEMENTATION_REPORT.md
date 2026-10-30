# H6 Batch E — Native Wholesale Buyer Identity & Approval Foundation (backend)

**Closed by default, additive, no financial surface touched.** Nothing here enables wholesale for anyone: the whole surface is a uniform 404 until the deployment flag `COMMERCE_WHOLESALE_BUYER_ENABLED` is turned on **and** a web channel is explicitly marked `wholesale_membership_enabled` (no HTTP route sets that in this batch). No price, cart, checkout, payment, order, accounting/VAT/ZATCA, MOQ, shipping, SMS/OTP, frontend or Spree-removal change was made.

## 1. Approved decisions → actual architecture
| Decision | Implementation |
|---|---|
| D-1 buyer identity separate from ERP users | Buyer = existing `CustomerIdentity` (tenant-scoped, own table/model/Sanctum `customer:access` tokens, `CompanyWide`). ERP `User` is never involved in buyer auth. |
| D-2 email + password now; SMS/OTP later via Messaging Foundation | Reuses `CustomerIdentityService::register` + `CustomerAuthenticationService::login` verbatim (one additive optional argument, below). No OTP code touched. |
| Approval by authorized staff | New explicit permission `commerce.wholesale.manage` (owner/admin via `*` only), staff-only decision endpoints, audited. |
| Separate subdomain/host using existing isolation | Routes live in the existing Host-resolved `store/v1` group (`ResolveStorefrontDomain`: Host → verified domain → storefront → active **web** channel of the same tenant, 404 on any mismatch). No new host convention. |

## 2. Existing components reused (no second identity system)
`CustomerIdentity`, `CustomerIdentityService`, `CustomerAuthenticationService`, `CustomerRegisterRequest`/`CustomerLoginRequest`/`CustomerIdentityResource`, `AuthenticateCommerceCustomer` (Sanctum token, expiry, tokenable type, active, verified contact, **tenant == host tenant**), `ResolveStorefrontDomain`, `RequireStorefrontMutationGateway`, `StorefrontContext`, `PublicApiResponse`, `EnsurePermission`/`Rbac`, `EnsureApplicationActive`, the existing rate-limiter pattern (IP + identifier), `TenantScope`/`BelongsToTenant`, the immutable-event pattern (`TenantApplicationEvent`).
Changed existing code (all backward compatible): `CustomerAuthenticationService::login()` gained an optional `array $extraAbilities = []` (default ⇒ byte-identical token); `SalesChannel` gained a cast + a saving guard; `Rbac::PERMISSIONS`, `config/commerce.php`, `TenancyServiceProvider` (3 limiters), the two route files.

## 3. Identity & session boundaries
- **Tenant & channel authority = the Host only.** No `tenant_id`/channel/identity id from a client is read (registration `prohibited`s them; tests prove it).
- **Channel-bound session:** `store/v1` login issues a token with abilities `customer:access` + `store-channel:{channelId}`; `BindStorefrontBuyerToChannel` (after `AuthenticateCommerceCustomer`) requires the ability for the **host-resolved** channel. A token minted on host A is rejected on host B (same tenant, other channel) and on another tenant's host; a `commerce/v1` / `customer/v1` token (no such ability) is rejected. → no cross-host/channel replay, no privilege inheritance.
- **Logout** deletes the presented token only (other sessions survive). **Deactivated** (`is_active=false`) or **deleted** identities fail on the next request (existing middleware; tested). Tokens expire after 7 days (existing).
- **No enumeration:** register → identical 202 for new/existing emails and never replaces an existing password; login failures (unknown, wrong password, inactive, unverified) return byte-identical bodies (modulo request id); the shared service already burns a dummy hash for unknown emails.
- **Rate limiting:** `storefront-buyer-register` (10/IP, 3/email per minute), `storefront-buyer-login` (20/IP, 5/email), `storefront-buyer-apply` (10/identity), all keyed on the Host-resolved tenant. Tested: 6th login attempt → 429 even with the correct password (no oracle).
- **Passwords** hashed (`hashed` cast); never serialized; tested at the DB and response levels.

## 4. Membership state machine (eligibility ≠ authentication)
```
(none) ─apply(buyer)─▶ pending ─approve(staff)─▶ approved ─suspend(staff)─▶ suspended
                          └─reject(staff)─▶ rejected (terminal here)         └─reinstate(staff)─▶ approved
```
`wholesale_memberships` is one row per (tenant, channel, identity) — unique-constrained. Applying is idempotent and **never changes** an existing status (a rejected/suspended buyer cannot reopen or self-approve; a body `status` is ignored). Every decision runs in one transaction under `lockForUpdate` and validates the transition against the *current* row, then stamps `decided_at`/`decided_by_user_id`/staff note and appends an immutable `wholesale_membership_events` row (from→to, actor type/user, note, time). The gate `EnsureApprovedWholesaleBuyer` reads the membership **fresh on every request** (no cache, no token claim), so suspension/rejection bites existing sessions immediately; none of pending/rejected/suspended/absent is distinguishable (uniform 403). Authentication state is unaffected by membership (a suspended buyer can still `GET me`).

## 5. API contracts
Store host (`store/v1`, all behind `EnsureWholesaleBuyerEnabled`; mutations also behind the gateway secret):
| Route | Auth | Result |
|---|---|---|
| `POST auth/register` | gateway | 202 `{verification_required:true}` (uniform), 422 validation |
| `POST auth/login` | gateway | 200 `{token, customer}` · 422 uniform failure · 429 |
| `POST auth/logout` | token (+gateway) | 200 `{logged_out:true}` |
| `GET me` | token | 200 `{customer}` (no secrets) |
| `POST wholesale/application` | token (+gateway) | 201 new / 200 existing `{membership:{status,applied_at,decided_at}}` |
| `GET wholesale/membership` | token | `{membership}` or `null` |
| `GET wholesale/access` | token + **approved** | 200 `{access:true}` · 403 otherwise (reusable gate; probe for later batches) |
Staff (`/api`, `auth:sanctum` + `commerce.wholesale.manage` + `commerce.storefront`, flag-gated):
`GET commerce/wholesale/channels/{channelId}/memberships?status=&per_page=` · `POST commerce/wholesale/memberships/{id}/{approve|reject|suspend|reinstate}` `{note?}` → 200 / 404 (other tenant, unknown) / 409 `{reason:invalid_transition}` / 422. There is **no public or store-host route that changes a status.**
Buyer payloads expose only status + two timestamps — never the decider, the staff note, other buyers, or tenant/channel/identity ids (asserted).

## 6. RBAC matrix
| Actor | list | approve / reject / suspend / reinstate |
|---|---|---|
| unauthenticated | 401 | 401 |
| buyer token on staff API | 401/403 | 401/403 |
| `accountant`, `staff`, stored custom role (even with `commerce.manage`/`commerce.orders.view`) | 403 | 403 |
| `owner` / `admin` (via `*`) | 200 | 200 |
| other tenant's owner | 404 | 404 |
Permission `commerce.wholesale.manage` is in `Rbac::PERMISSIONS`, in no `MATRIX` role, and granted to no stored role by migration (tested).

## 7. Tenant / host / channel isolation evidence (tests)
cross-tenant login (same email, two tenants = two identities, no cross login) · token reuse on other host/tenant/unknown host (401/404) · approval on channel A grants nothing on channel B of the same tenant · DTC host with the flag on ⇒ 404 and its normal catalog read still 200 · only `web` channels can be flagged · foreign tenant staff ⇒ 404 on list and decisions · membership/identity/channel tenant-consistency enforced in the model `saving` guard.

## 8. Database changes (additive, reversible with a guard)
Migration `2026_12_15_010000_create_wholesale_memberships`: `sales_channels.wholesale_membership_enabled` (bool, default false), `wholesale_memberships`, `wholesale_membership_events` (tenant FK cascade; channel/identity `restrictOnDelete`; unique `(tenant, channel, identity)`; status index; PostgreSQL CHECK constraints). **Rollback:** `down()` refuses (RuntimeException, tested) while any membership/event row exists because decision history is audit evidence; otherwise drops the tables and the column. No existing administrative identity table touched; nothing seeded; no live-data migration.

## 9. Files changed
New: migration · `WholesaleMembership`, `WholesaleMembershipEvent` · `WholesaleMembershipService`, `WholesaleMembershipException` · `EnsureWholesaleBuyerEnabled`, `BindStorefrontBuyerToChannel`, `EnsureApprovedWholesaleBuyer` · `StorefrontBuyerAuthController`, `StorefrontWholesaleController`, `CommerceStaffWholesaleMembershipController` · `tests/Feature/WholesaleBuyerFoundationTest.php` (32 tests) · this report.
Modified: `SalesChannel`, `CustomerAuthenticationService`, `Rbac`, `config/commerce.php`, `TenancyServiceProvider`, `routes/api.php`, `routes/api_storefront.php`.

## 10. Verification
| Check | Result |
|---|---|
| Focused `WholesaleBuyerFoundationTest` | 32 tests / 209 assertions pass |
| Full backend suite (local sqlite, run in 28 class-chunks) | **15 947 passed · 428 skipped · 52 failed** — all 52 failures are 6 `Fuel*` classes (`FuelSaleService/Api`, `FuelReconciliation`, `FuelAviRfidService`, `FuelSupplyReceiving/Api`) failing with `Call to undefined function bcmul()`: this sandbox lacks the PHP `bcmath` extension (`setup.sh` warns about exactly this; CI installs it). None touches this change. |
| Route allowlist | `CommerceModuleBoundaryTest` (the repo's Commerce-route guard) correctly failed on the two new staff routes; they were added to its allowlist (the guard's purpose) and it passes. |
| PostgreSQL / CI Gate | not run locally (no PG; `*Postgres*` classes self-skip). CI runs sqlite + pgsql — see PR. |
| Local-environment note | a stale, untracked `CommerceOrderCancellationApiTest.php` in the sandbox's assembled app dir (not in the repo) kills the PHP process (signal 9); it was excluded and is unrelated. |
| Storefront suites | not run — no storefront file changed |
Mandatory negative coverage present: cross-tenant lookup/login, cross-host reuse, cross-channel access, unauthenticated approval, unauthorized staff approval, buyer self-approval (route + payload), pending/rejected/suspended/absent access, revoked account with live session, invalid password + enumeration, rate limiting (login, register), stale/concurrent transition refusal, duplicate-apply convergence, replayed/expired tokens.
**Coverage gap (honest):** the concurrency tests are *logical* races (stale read → re-validated under `lockForUpdate`) executed serially on sqlite; there is no multi-process PostgreSQL race test for approve-vs-suspend (the repo's pattern for those is a separate pcntl test class). Risk: low — the unique constraint and row lock are the only mechanisms and both are standard; recommended follow-up in Batch F.

## 11. Security & compatibility risks
- **Email verification delivery does not exist** (pre-existing gap shared with `customer/v1` and `commerce/v1`): `login` requires `email_verified_at`, registration returns 202 without a token, and no channel delivers a verification link. So no real buyer can complete email+password login until the Messaging Foundation lands. This batch neither fakes nor bypasses it (verified-state is set directly in tests). It is the main functional blocker for turning the feature on.
- An identity is tenant-wide (same person may use mobile app + wholesale host); channel binding + per-channel membership keep privileges apart, but a buyer's password is shared across that tenant's surfaces by design (Batch D decision).
- Rejected is terminal in this batch (no re-review path); a reconsideration flow is a policy decision for later.
- DTC unchanged: flag default off, channel flag default false, gates are uniform 404, the only edit to shared auth code is an optional argument defaulting to the old behaviour.

## 12. Deferred / blockers
Channel settings API (set `wholesale_membership_enabled`, price list, `require_auth`, hide-price) · wholesale price resolution + list/detail price fix · buyer-linked partner pricing · cart/checkout/MOQ/order-line price provenance · email verification & password recovery delivery (Messaging Foundation; also OTP) · storefront login UI · multi-process PG race test · retiring the Spree wholesale cluster.

## 13. Recommended next batch (F — not started)
Backend: staff **channel settings** endpoint + audit for `wholesale_membership_enabled`/price list/flags, the **list/detail price parity fix**, **order-line price provenance** and the PG concurrency test — one pricing-scoped PR (needs explicit pricing approval); separately the Messaging Foundation hook for verification/reset. Then the storefront native wholesale surface.

Branch `claude/commerce-h6-batch-e` · Base `0d7f10c0c` · Head: see PR. No merge, no deploy, no activation.
