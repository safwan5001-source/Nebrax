# ADR-06 — Commerce Mobile Customer Authentication Mechanism

**Status:** Accepted — Implemented (COM-MOBILE-AUTH-1)
**Date:** 2026-10-06
**Scope:** resolves ADR-05 §22's authentication-mechanism non-decisions for `/commerce/v1` only — does not reopen any ADR-05 boundary/invariant, and does not decide a production SMS/OTP vendor.

## Context

ADR-05 fixed the conceptual identity boundary (Commerce Authentication Identity / Commerce Customer Account / ERP Staff User / Partner stay distinct; tenant-scoped; ownership-based authorization; guest checkout preserved) but explicitly deferred, in §22: authentication framework/provider, SMS/OTP provider, password-vs-passwordless default, exact phone/email normalization, and token/session technology.

`COM-MOBILE-AUTH-1` (Customer mobile auth + profile) could not be promoted to `ready` on that basis alone — a genuine Decision Escalation Gate, not an evidence gap. The gate was delivered to the AWJ owner (Safwan), who returned the decision this ADR records (`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`, verbatim in the implementation report).

Separately, evidence review found a **pre-existing, merged-but-unwired** web customer-identity stack (`CustomerIdentity`, `CustomerAuthController`, `CustomerIdentityService`, `CustomerAuthenticationService`, `EstablishCustomerContext`, `CustomerContext`) at `/customer/v1/{tenantSlug}`, shipped by PR #868 (`STORE-UI-5`) for the web storefront, already unilaterally implementing email+password + Sanctum tokens for that one channel — but never evaluated against, and not wired to, `/commerce/v1`. This ADR extends that existing authority into `/commerce/v1` rather than building a second, parallel identity system.

## Decision

### AWJ Decision (owner-authorized, `COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`)

1. `/commerce/v1` supports **two independent authentication mechanisms**, both producing the same `CustomerIdentity` + Sanctum `customer:access` token:
   - **Phone + OTP** — primary/default for Saudi/mobile Commerce. A single, unified request-code / verify-code flow: verifying a code for a phone with no matching identity **creates** one (already phone-verified); verifying a code for a phone with an existing, phone-verified identity **logs into** it. There is no separate "register" step for phone — OTP verification is itself proof of phone ownership.
   - **Email + password** — supported alternative, reusing `CustomerIdentityService::register()` and `CustomerAuthenticationService::login()` byte-for-byte, the exact authorities `/customer/v1` already uses. No new email business logic was introduced.
2. Guest checkout is unchanged — this ADR adds an authentication *option*, not a requirement. Nothing under the existing guest cart/checkout routes was touched.
3. OTP delivery sits behind a provider-neutral seam, `App\Services\Commerce\Otp\OtpProvider` (`send(tenantId, phoneE164, code, purpose): void`). `App\Services\Commerce\Otp\FakeOtpProvider` is the **only** bound implementation (`CommerceApiServiceProvider::register()`); it never sends a real message, logs only delivery metadata (never the code), and keeps the code in process memory for tests. No real SMS/OTP vendor (Unifonic or otherwise) is integrated, purchased, or credentialed.
4. Unifonic remains only a **future preferred candidate** for a first Saudi OTP vendor. Vendor selection, pricing commitment, Sender ID/registration, credentials, and production messaging are explicitly **out of scope** here and remain a separate Decision/Owner Gate (§10 of the AWJ decision) — none of that work exists in this change.
5. Every ADR-05 boundary is preserved unchanged: Commerce Authentication Identity/Customer Account/ERP Staff User/Partner stay four distinct concepts; tenant isolation is enforced end to end (see Consequences below); `CustomerContext`/`EstablishCustomerContext` are reused **unmodified**; `/customer/v1` and `/store/v1` are untouched in behavior.

### Open Decisions (still not made — explicitly out of scope here)

- Real SMS/OTP vendor selection, pricing, Sender ID/compliance, delivery reliability (deferred to a future Decision/Owner Gate per the AWJ decision's own §10).
- Full E.164 phone normalization (country-default inference, e.g. bare `05XXXXXXXX` → `+9665XXXXXXXX`). This change keeps the pre-existing regex contract (`^\+[1-9][0-9]{7,14}$`, already used by `CustomerRegisterRequest`) — the client must submit an already-normalized phone. `CustomerIdentity::normalizePhone()` still only strips separator characters; it was not upgraded.
- Email verification delivery (a mailer that actually sends a verification code/link for the email+password path). This gap is **pre-existing** in the already-merged `/customer/v1` stack (PR #868) — `CustomerAuthController::register()` there has always returned 202 with no token and no way to ever set `email_verified_at`. `/commerce/v1`'s new `registerWithEmail()` reuses that same service unmodified and therefore inherits the same gap; it is not introduced or fixed by this ADR. See the implementation report's discovered-backlog section.
- A claim/dispute mechanism for a phone number squatted (self-declared, unverified) by an email+password registration before its real owner ever proves control via OTP — see the security note under Consequences below. ADR-05 §16 itself defers "the exact claim/linking mechanism."
- A dedicated customer-facing display-name/profile-editing surface — phone-only identities are created with a generic placeholder display name; profile editing is not part of this task's outcome (Customer mobile auth + **profile** here means the read-only `me` contract, not editing).

## 1. Token transport: a new customer-scoped header, not `Authorization`

`/commerce/v1`'s `Authorization` header is already reserved for the ApiClient/store bearer resolved by the existing, unmodified `AuthenticateApiClient` middleware — every route on this trust boundary requires it first, customer-authenticated or not. A customer's own Sanctum token therefore cannot reuse `Authorization` without either replacing the store-identity concept or requiring two bearer tokens in one header.

The existing precedent for exactly this situation is `CommerceCartService`'s guest `X-Cart-Token` header (never `Authorization`). This ADR follows the same pattern: a new `X-Customer-Token` header, resolved by a new `AuthenticateCommerceCustomer` middleware that runs *after* the full existing `/commerce/v1` chain (so `PublicApiRequestAudit`/`EnforcePublicApiRateLimit`, which both still read `$request->user()` expecting the `ApiClient`, are unaffected), then swaps the request's user resolver so the pre-existing, **unmodified** `EstablishCustomerContext` middleware runs immediately after it — precisely as it already does on `/customer/v1`.

`AuthenticateCommerceCustomer` does not reuse `EnsureCustomerPrincipal` (the `/customer/v1` gate): that middleware hard-requires `email_verified_at`, which a phone-OTP-only identity will never have. The commerce-side condition is "some verified contact method" (email **or** phone), not "verified email".

## 2. OTP code lifecycle and security controls

- 6-digit numeric code, `random_int()` (CSPRNG), zero-padded.
- Stored as a bcrypt hash (`Hash::make()`/`Hash::check()`), never a bare digest — a 6-digit code has only 10^6 possibilities, so an unsalted/fast hash would be trivially precomputable from a leaked table. This mirrors how `CustomerIdentity` passwords are hashed, not `AuthRecoveryService`'s `sha256(Str::random(64))` pattern, which relies on 64 characters of entropy that an OTP code does not have.
- 5-minute expiry; a fresh request invalidates any prior unconsumed code for the same phone+purpose (mirrors `AuthRecoveryService::issue()`'s own "invalidate prior unused" pattern).
- Verification is attempt-limited (5 per code) and time-limited; consumption is atomic under a row lock (`lockForUpdate()`), so only one concurrent verify can ever succeed per issued code.
- Issuance itself is throttled per phone+purpose (3 per 10 minutes) independently of `/commerce/v1`'s existing per-ApiClient/IP `EnforcePublicApiRateLimit` — the new `auth/*` routes are also the first real consumer of the previously-seeded, unused `PublicApiRateLimits::CLASS_SENSITIVE` (10/min).
- Logs never carry the plaintext code (ADR-05 §19); `FakeOtpProvider` keeps it in process memory for tests only, never logged.

## 3. Schema

`customer_identities.email` and `.password` become nullable (a phone-only identity has neither); `.email_normalized` likewise, for the same reason. A new `.phone_verified_at` timestamp is the OTP-side counterpart to the existing `.email_verified_at`. `phone_e164`/`email_normalized` already tolerate multiple `NULL`s under their unique indexes on both SQLite and PostgreSQL, so this does not weaken the existing one-identity-per-email/phone-per-tenant guarantee.

A new `customer_otp_codes` table (tenant-scoped, `CompanyWide`) holds issued codes independently of `customer_identities` — a short-lived, high-churn record, not a column on the identity.

## Consequences

### Benefits

- Two authentication mechanisms ship without a second identity model, a second token format, or a second tenant-isolation mechanism — `CustomerIdentity`/`CustomerContext`/`EstablishCustomerContext` are reused exactly as ADR-05 anticipated ("A Customer Account may operate across authorized Sales Channels without duplicating core identity per channel").
- OTP delivery is fully swappable later (a real Saudi vendor) by rebinding one interface, with zero change to identity, token, or rate-limit code.
- No coupling to Unifonic or any vendor exists anywhere in the codebase yet — the AWJ decision's explicit "not yet" is enforced structurally (`FakeOtpProvider` is the only binding), not just documented.

### Costs and trade-offs

- **Security note, addressed in this ADR, not merely disclosed:** because the email+password registration request accepts an optional, unverified `phone`, a naive "match by `phone_e164`" OTP login could let whoever *later* proves real control of a squatted/reused number silently land inside a stranger's pre-existing identity — seeing that identity's email/profile. `CustomerPhoneAuthenticationService::verifyAndAuthenticate()` closes this: it only matches an existing identity when that identity's own phone was itself already established through proven OTP control (`phone_verified_at IS NOT NULL`); a match against an unverified, self-declared phone is rejected outright rather than resolved either way. The number then stays deadlocked until a claim/dispute mechanism exists (deferred, ADR-05 §16) — recorded as backlog, not silently accepted.
- Email verification delivery remains unimplemented (pre-existing gap inherited from `/customer/v1`, not newly introduced) — email+password registration on `/commerce/v1` is reachable today but not completable end-to-end without it.
- Two rate-limiting mechanisms now both apply to customer auth depending on which `/commerce/v1` group a route sits in (`EnforcePublicApiRateLimit`) versus `/customer/v1`'s named `RateLimiter::for()` — pre-existing architectural asymmetry (Evidence, not a decision made here), unchanged by this ADR.

## References

- `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md`
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §11–13
- `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
- `docs/plans/store/STORE-UI-5-IMPLEMENTATION-REPORT.md` (pre-existing, unwired `/customer/v1` identity stack this ADR extends)
- `docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md` (full evidence, tests, accounting-neutral confirmation)
