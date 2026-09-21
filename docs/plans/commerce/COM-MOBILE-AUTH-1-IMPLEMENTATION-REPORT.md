# COM-MOBILE-AUTH-1 — Implementation Report

## Outcome

`/commerce/v1` gains customer authentication + read-only profile, resolving the Decision Escalation Gate recorded in `TASK-QUEUE.md`/`CURRENT-STATE.md` via the AWJ owner decision `COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`, recorded durably in `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`.

Two independent, provider-neutral authentication mechanisms, both producing the same `CustomerIdentity` + Sanctum `customer:access` token:

- **Phone + OTP** (primary) — unified register-or-login: `POST auth/otp/request`, `POST auth/otp/verify`.
- **Email + password** (alternative) — `POST auth/register`, `POST auth/login`, reusing `/customer/v1`'s own `CustomerIdentityService`/`CustomerAuthenticationService` byte-for-byte.

Plus `POST auth/logout` and `GET me`, gated by a new `X-Customer-Token` header (never `Authorization`, already the ApiClient/store bearer).

Guest checkout, `/customer/v1`, and `/store/v1` are untouched in behavior.

## Repository evidence / root cause

A background research pass (full findings retained in session transcript) found a **pre-existing, merged-but-unwired** customer identity stack at `/customer/v1/{tenantSlug}` (PR #868, `STORE-UI-5`, 2026-09-19): `CustomerIdentity` (Sanctum `Authenticatable`, tenant-scoped, UUID), `CustomerIdentityService::register()`, `CustomerAuthenticationService::login()`, `CustomerAuthController`, `CustomerContext`/`EstablishCustomerContext`, `CustomerPartnerLink`. It already answers several of ADR-05 §22's "non-decisions" one way for the web channel (email+password, Sanctum tokens, no OTP) — but was never wired to `/commerce/v1`, and `CommerceOrderService::resolveOwnership()`/`ownedOrders()` already *consume* `CustomerContext` today with nothing under `/commerce/v1` ever establishing it.

This meant the correct shape for `COM-MOBILE-AUTH-1` — once the owner decision unblocked mechanism/provider choices — was **extending this existing authority into `/commerce/v1`**, not building a second identity system, exactly the "reuse existing authority, no parallel logic" pattern `COM-MOBILE-MEDIA-1`/`COM-MOBILE-VARIANTS-1` already established for this horizon.

No OTP scaffolding of any kind existed anywhere in the repository (confirmed by exhaustive grep) — that part is genuinely greenfield, built behind a provider-neutral seam per the owner decision.

## Approach chosen

1. **Schema** — `customer_identities.email`/`.password`/`.email_normalized` become nullable (a phone-only identity has none of them); a new `.phone_verified_at` timestamp is the OTP-side counterpart to `.email_verified_at`. A new `customer_otp_codes` table holds short-lived, bcrypt-hashed, attempt-limited codes, independent of the identity row.
2. **OTP abstraction** — `App\Services\Commerce\Otp\OtpProvider` (interface) + `FakeOtpProvider` (the only bound implementation — no real vendor integrated; `Unifonic` remains a documented future candidate only) + `CustomerOtpService` (issue/verify lifecycle, hashing, expiry, attempt/issuance limits).
3. **Phone auth orchestration** — `App\Services\CustomerPhoneAuthenticationService`, sitting alongside the existing `CustomerIdentityService`/`CustomerAuthenticationService` (same directory, same shape): unified register-or-login, `createToken('customer', ['customer:access'], now()->addDays(7))` — identical token shape to the email path.
4. **Token transport** — new `AuthenticateCommerceCustomer` middleware resolves the customer's own Sanctum token from `X-Customer-Token` (new header, mirrors the established `X-Cart-Token` guest-identity precedent), swaps the request's user resolver, then the existing, **unmodified** `EstablishCustomerContext` runs immediately after it — the same middleware `/customer/v1` already uses, reused verbatim.
5. **Controller/routes** — new `CommerceCustomerAuthController` (extends `PublicApiController` like its sibling commerce controllers) + two new route groups in `routes/api_commerce.php`: an unauthenticated-customer `auth/*` group (`EnforcePublicApiRateLimit:sensitive` — first real consumer of that previously-seeded, unused rate class) and an authenticated group (`auth/logout`, `me`) requiring `X-Customer-Token`.
6. **Security fix found during implementation, not merely disclosed** — see "Automated review findings" / Consequences in ADR-06: an OTP login must not match an existing identity by a self-declared, *unverified* phone entered through the separate email+password registration path (would let a stranger who later proves real control of a squatted/reused number see the original registrant's email/profile). `CustomerPhoneAuthenticationService::verifyAndAuthenticate()` only matches an identity whose own phone was itself already OTP-verified; an unverified match is rejected outright rather than silently resolved either way.

## Why this approach fits AWJ

- No parallel identity model, token format, or tenant-isolation mechanism — `CustomerContext`/`EstablishCustomerContext` are the exact same production code `/customer/v1` already runs, not a reimplementation for commerce.
- The provider seam makes the AWJ owner's explicit "not yet" (no Unifonic/vendor commitment) structural, not just documented: `FakeOtpProvider` is the only binding in `CommerceApiServiceProvider::register()`.
- `X-Customer-Token` follows an established repository precedent (`X-Cart-Token`) rather than inventing a new header-separation idiom.
- OTP hashing uses `Hash::make()`/bcrypt (matching how `CustomerIdentity` passwords are already hashed), not the unsalted `sha256` pattern `AuthRecoveryService` uses for its 64-character tokens — a deliberate choice because a 6-digit code's low entropy makes an unsalted/fast digest precomputable from a leaked table.

## Changed files

- `database/migrations/2026_10_06_010000_add_phone_verification_and_nullable_credentials_to_customer_identities.php` (new)
- `database/migrations/2026_10_06_020000_create_customer_otp_codes_table.php` (new)
- `app/Models/CustomerOtpCode.php` (new)
- `app/Models/CustomerIdentity.php` — nullable-email guard in `booted()`, `phone_verified_at` fillable/cast
- `app/Http/Resources/CustomerIdentityResource.php` — additive `phone_verified` key
- `app/Services/Commerce/Otp/OtpProvider.php` (new)
- `app/Services/Commerce/Otp/FakeOtpProvider.php` (new)
- `app/Services/Commerce/Otp/CustomerOtpService.php` (new)
- `app/Services/CustomerPhoneAuthenticationService.php` (new)
- `app/Http/Middleware/AuthenticateCommerceCustomer.php` (new)
- `app/Http/Requests/CommerceCustomerOtpRequestRequest.php` (new)
- `app/Http/Requests/CommerceCustomerOtpVerifyRequest.php` (new)
- `app/Http/Controllers/Api/CommerceCustomerAuthController.php` (new)
- `app/Providers/CommerceApiServiceProvider.php` — binds `OtpProvider` → `FakeOtpProvider`
- `routes/api_commerce.php` — two new route groups (`auth/*`, authenticated `auth/logout`+`me`)
- `tests/Feature/CommerceModuleBoundaryTest.php` — allowlist updated for the 6 new routes
- `tests/Feature/CommerceCustomerAuthApiTest.php` (new, 21 tests)
- `setup.sh`, `.github/workflows/ci.yml`, `deploy/assemble.sh` — added the new `app/Services/Commerce/Otp/` subdirectory to all three core-sync scripts (mirrors the existing `Commerce/Edge/` pattern; the repository is core-only, a full Laravel app is assembled from it)
- `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md` (new)

## Tests and exact results

### New — `tests/Feature/CommerceCustomerAuthApiTest.php` (21 tests / 61 assertions)

Phone+OTP: new-phone issuance creates no identity yet; correct-code verification creates a verified identity + token; same phone verified twice logs into the same identity (no duplicate); wrong code rejected without consuming the real code; attempt-limit lockout (5); expired code rejected; issuance-window flood rejected (3/10min); a new request invalidates the prior unconsumed code; tenant isolation (identical phone, different tenants, codes never cross); invalid phone shape rejected; **the self-declared-unverified-phone-squatting rejection** (new identity/regression test for the security fix above).

Email+password: registration returns 202/no token (parity with `/customer/v1`); verified identity can log in; unverified identity cannot.

Profile/session: `me` via `X-Customer-Token`; missing customer token rejected even with a valid store bearer; the store bearer itself rejected as a customer token (wrong tokenable type); foreign-tenant customer token rejected; logout revokes the token; inactive identity rejected.

Hashing: the OTP code is stored hashed, never in plaintext.

### Regression

- `CommerceModuleBoundaryTest` (route allowlist) — green.
- `BranchIsolationGuardTest` (new `CustomerOtpCode` model classified `CompanyWide`) — green.
- `CustomerDigitalAccessTest` (`/customer/v1`, unmodified behavior) — green, all 16/16.
- `CommerceCustomerContextIntegrationTest` (`CustomerContext`/`EstablishCustomerContext` reused unmodified) — green, all 18/18.
- Full `Customer|Commerce` filter — 649 passed, 10 skipped (SQLite), 0 failed; 658 passed on PostgreSQL (no SQLite-only skips).

### Full suite

- SQLite: 4406 passed, 27 failed — all 27 pre-existing sandbox gaps unrelated to this change (`Fuel*Test`: missing `bcmath` PHP extension in this sandbox, blocked by network policy; `DocumentCenterSecureIntakeTest`: local `setup.sh` doesn't copy `resources/views/` the way CI does) — same class of gap already documented in `COM-MOBILE-MEDIA-1-IMPLEMENTATION-REPORT.md`. No `Customer`/`Commerce`/`Auth`/`Sanctum`-named test failed.
- PostgreSQL: focused + full `Customer|Commerce` filter green (see above); one PostgreSQL-specific fix was required and applied — see below.

## Build / lint / typecheck

No `web/` changes in this PR (backend-only task).

## CI

Pending — filled in once the PR's GitHub Actions run completes (SQLite + PostgreSQL jobs), per this repository's standing merge policy.

## Pre-merge review

Pending final-head review before merge, per the standing merge policy.

## Merge

Pending. PR number / Head SHA / Merge SHA to be recorded here and in `TASK-QUEUE.md`/`CURRENT-STATE.md`/`MASTER-EXECUTION-PLAN.md` via a docs-only follow-up PR once merged, matching the pattern used for `COM-MOBILE-MEDIA-1`/`COM-MOBILE-VARIANTS-1`.

## Post-merge review

Pending.

## Self-review

### Implementer

Reused every available existing authority (`CustomerIdentity`, `CustomerIdentityService`, `CustomerAuthenticationService`, `CustomerContext`, `EstablishCustomerContext`, `PublicApiResponse`/`PublicApiErrorCode`, `PublicApiController`, `EnforcePublicApiRateLimit`/`PublicApiRateLimits`) rather than introducing parallel logic. The only genuinely new business logic is OTP issuance/verification and the phone-based register-or-login orchestration, both required by the owner decision and previously non-existent anywhere in the repository.

### Reviewer

Checked the middleware ordering against `PublicApiRequestAudit`/`EnforcePublicApiRateLimit` (both read `$request->user()` expecting the `ApiClient`) — confirmed `AuthenticateCommerceCustomer` runs strictly after the full existing chain, never before, so neither is affected. Checked that `EnsureCustomerPrincipal` (which hard-requires `email_verified_at`) was deliberately *not* reused for `/commerce/v1`, since a phone-only identity would always fail it. Verified the nullable-email migration doesn't miss `email_normalized` (SQLite caught this once locally: `NOT NULL constraint failed`, fixed before PostgreSQL verification).

### AWJ Guardian

- **Double-entry / money:** none — no financial write path in this task.
- **Tenant isolation:** every new query in `CustomerOtpService`/`CustomerPhoneAuthenticationService`/`AuthenticateCommerceCustomer` is scoped by `tenant_id` from the trusted `TenantContext`, never from request input; tested cross-tenant (`otp codes are isolated per tenant even for the same phone number`, `a customer token from a foreign tenant is rejected`).
- **Immutability:** OTP codes are single-use (`consumed_at`) and never re-validated after consumption or expiry; no journal/ledger interaction exists in this task.
- **Configurable policy vs. hardcoded behavior:** OTP TTL/attempt/issuance limits are class constants, not per-tenant settings — consistent with `PublicApiRateLimits`' own documented stance (seed values, not yet a configurable policy surface); not a CLAUDE.md violation since this isn't a business-policy fork with more than one reasonable default, just an abuse-control tuning value.

### Researcher/Architect

Confirmed via `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md` that adding Sanctum-based customer auth to `/commerce/v1` "reusing `/customer/v1`'s proven pattern" was always the anticipated later-phase shape — this task is exactly that phase, not a deviation from the documented design.

## Accounting impact

None. No journal entry, invoice, payment, or inventory movement is created, read, or affected by any code path in this task.

## Tenant / branch isolation impact

- `CustomerOtpCode`: `CompanyWide` (authentication plumbing tied to `tenant_id` alone, not an operational/branch record) — declared explicitly; `BranchIsolationGuardTest` passes.
- All new queries filter by the trusted `TenantContext`, never client input (`tenant_id`/`customer_id`/`customer_identity_id`/`partner_id` are `prohibited` on every new request class, matching `CustomerRegisterRequest`/`CustomerLoginRequest`'s existing convention).

## Security / authorization impact

- New customer-facing attack surface: `auth/otp/request`, `auth/otp/verify`, `auth/register`, `auth/login` (unauthenticated relative to customer identity, still requires a valid ApiClient/store bearer), `auth/logout`/`me` (requires `X-Customer-Token`).
- OTP codes: bcrypt-hashed at rest, 5-minute TTL, 5-attempt lockout per code, 3-per-10-minute issuance throttle per phone+purpose, plus the existing per-ApiClient/IP `EnforcePublicApiRateLimit:sensitive` (10/min).
- Non-enumerating failure messages on the email+password path (unchanged, reused from `/customer/v1`).
- Closed a genuine account-boundary leak found during implementation (see "Approach chosen" §6 and ADR-06 Consequences) before it ever shipped — not a fix to a previously-released defect.
- No coupling to any real SMS/OTP vendor exists in the codebase.

## Backward compatibility

- `/customer/v1` and `/store/v1`: zero behavior change. `EstablishCustomerContext`, `CustomerIdentityService`, `CustomerAuthenticationService`, `CustomerAuthController` are untouched.
- `customer_identities.email`/`.email_normalized`/`.password` becoming nullable is additive (existing rows are unaffected; existing unique-index behavior on `NULL` is unchanged on both engines).
- `CustomerIdentityResource`'s new `phone_verified` key is additive.

## API / DB / migration impact

- New table: `customer_otp_codes`.
- New nullable columns: `customer_identities.phone_verified_at`; `email`/`email_normalized`/`password` become nullable (previously `NOT NULL`).
- New routes (all under `commerce/v1/`, added to `CommerceModuleBoundaryTest`'s allowlist): `auth/register`, `auth/login`, `auth/otp/request`, `auth/otp/verify`, `auth/logout`, `me`.

## External research used

- Confirmed via repository evidence (not external web research) that Laravel 11's schema builder supports `->nullable()->change()` on both SQLite and PostgreSQL without `doctrine/dbal` in this codebase already (three prior precedents: `2026_10_02_010000_make_commerce_carts_storefront_id_nullable.php`, `2026_08_29_020000_nullable_tenant_on_platform_administrator_actions.php`, `2026_10_03_010000_make_commerce_checkouts_storefront_id_nullable.php`).
- PostgreSQL's rejection of `SELECT ... FOR UPDATE` combined with an aggregate (`count()`) is a documented PostgreSQL restriction (not SQLite-specific), discovered here via the mandatory PostgreSQL verification pass — fixed by dropping the row lock on the abuse-rate count query (not a correctness invariant; see code comment in `CustomerOtpService::requestCode()`).

## Automated review findings (Codex, PR pending)

Recorded once the PR is opened and reviewed, per the standing merge policy — this section will be updated before merge.

## Risks / remaining work

- Email verification delivery is still unimplemented (pre-existing `/customer/v1` gap, not introduced here) — email+password registration cannot be completed end-to-end without it. See ADR-06 Open Decisions.
- Full E.164 phone normalization (bare local numbers, country-code inference) is out of scope — clients must submit an already-`+`-prefixed phone.
- The phone-squatting deadlock (an unverified self-declared phone permanently blocking the real owner's OTP login until a claim/dispute mechanism exists) is accepted as documented backlog, not solved here — ADR-05 §16 itself defers this.

## Discovered backlog

- Claim/dispute mechanism for a phone number squatted by an unverified email+password registration (ADR-06 Consequences).
- Email verification delivery mechanism, shared by `/customer/v1` and `/commerce/v1` alike (pre-existing gap, first documented here at the point it became directly relevant).
- Real SMS/OTP vendor selection — explicitly deferred to its own future Decision/Owner Gate per the AWJ decision.

## Git state

Branch: `claude/com-mobile-auth-1`. Commit/PR/SHA details recorded once pushed and opened.

## Recommended next dependency-ready task

`COM-MOBILE-CART-IDENTITY-1` (Guest → authenticated cart transition) becomes evaluable now that `COM-MOBILE-AUTH-1` ships a working customer identity + `X-Customer-Token` + `CustomerContext` wiring on `/commerce/v1` — its dependency is satisfied at the code level; merge/CI/post-merge-review completion is still required before treating it as `done`-dependency-ready per the queue's own rule ("An unmerged code dependency does not satisfy a downstream dependency").
