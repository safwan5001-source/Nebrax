# AUTH-SEC-1 Implementation Report

- **Status:** Implemented on branch; PR open; not merged and not deployed.
- **Summary:** Added a tenant-bound V1 email verification and password recovery flow for AWJ staff authentication, with expiring single-use hashed tokens, neutral recovery responses, rate limiting, conservative token revocation, and minimal Arabic-first UI.
- **Base SHA:** `23af768262f284f5092fd8922037c291c47aca06`
- **Head SHA:** `206dbfa2f21b100ff9a9847f82d8e8e7054ab6da`
- **Branch:** `feat/auth-sec-1-email-password-recovery`
- **PR:** [#795](https://github.com/safwan5001-source/Nebrax/pull/795)

## Implemented

The implementation adds email verification on registration and authenticated resend, public forgot-password and reset-password endpoints, and a public verification endpoint. Recovery and verification tokens are generated with cryptographically secure framework primitives, stored only as SHA-256 hashes, expire after one hour, and are invalidated on use or replacement. A successful password reset deletes the user’s existing Sanctum tokens. Existing staff users are not made subject to mandatory email verification, preserving current login behavior.

The web application now includes minimal responsive pages for password recovery, password reset, and email verification, plus a recovery link on the existing login page. Arabic is the primary language and English keys were added through the existing `next-intl` message files.

## Files Changed

| File | Purpose |
|---|---|
| `app/Services/AuthRecoveryService.php` | Issues and atomically consumes tenant-bound, expiring, single-use token records. |
| `database/migrations/2026_09_12_120000_create_auth_action_tokens_table.php` | Adds the token table with tenant/user foreign keys and lookup indexes. |
| `app/Http/Controllers/Api/AuthController.php` | Adds forgot, reset, verify, and resend handlers; sends verification on registration. |
| `app/Mail/AuthActionMail.php` | Mailable for verification and recovery links. |
| `resources/views/emails/auth-action.blade.php` | Arabic email content. |
| `routes/api.php` | Registers public and authenticated auth routes with throttles. |
| `app/Providers/TenancyServiceProvider.php` | Adds dedicated recovery/reset rate limiters. |
| `deploy/assemble.sh` | Ensures the Mailable and view are included in Docker/CI Laravel assembly. |
| `tests/Feature/AuthRecoveryTest.php` | Focused regression/security coverage for neutral responses, reset, replay, expiry, resend throttling, and tenant boundary. |
| `web/src/app/forgot-password/page.tsx` | Forgot-password form and neutral success state. |
| `web/src/app/reset-password/page.tsx` | Reset-password form. |
| `web/src/app/verify-email/page.tsx` | Verification result state. |
| `web/src/app/login/page.tsx` | Minimal recovery link. |
| `web/src/messages/ar.json`, `web/src/messages/en.json` | Arabic/English auth strings. |

## Security

- **Tenant isolation:** Token records carry `tenant_id`; consumption checks the resolved `HostnameTenantContext` before any state change. A token issued in Tenant A is rejected on Tenant B’s tenant hostname. The existing hostname-before-credential behavior is preserved.
- **Account enumeration protection:** Forgot-password always returns the same semantic response for known and unknown email addresses. Mail delivery failures are reported server-side without changing the response.
- **Token handling:** Plain tokens are returned only in generated links; the database stores only SHA-256 hashes. Existing outstanding tokens of the same type are invalidated when a new token is issued.
- **Expiration:** Tokens expire after 60 minutes and are rejected after expiry.
- **Single-use behavior:** Consumption is performed inside a transaction with a row lock and marks the token used before returning the user. Replays therefore fail.
- **Rate limiting:** Forgot-password and verification resend use IP and email buckets; reset and verification consumption use an IP bucket.
- **Session/token handling:** Successful password reset revokes all existing Sanctum tokens for that user. No mandatory verification gate was added to login.

## Backward Compatibility

Existing users can continue to log in under the current policy. Email verification is not enforced globally and no accounting, permissions, Customer Platform, or financial posting code was changed. New registrations receive a verification email, but the existing registration response and login issuance remain compatible.

The deployment environment must provide the existing Laravel mail configuration and `FRONTEND_URL` so generated links resolve to the deployed web application. Mail send failures are logged and do not turn a neutral forgot-password request into an account-existence signal.

## Tests

| Command | Result |
|---|---|
| `cd web && npm ci` | Passed; npm reported 14 pre-existing dependency audit findings (6 moderate, 6 high, 2 critical). |
| `cd web && npm run test` | Passed: **266 test files, 1,731 tests**. Existing `next-intl` warnings about dotted keys in `developer.events` were observed; they are unrelated to this change. |
| `cd web && npm run build` | Passed: Next.js compiled successfully and generated 170 static pages. |
| `php artisan test --filter=AuthRecoveryTest` | Not run locally: this checkout contains Laravel core files assembled by Docker/CI and the sandbox has no PHP, Composer, or Docker. The focused test file is included for CI. |

## Build / CI

The PR’s GitHub Actions checks were queued when this report was authored: four Laravel matrix checks and two Web CI checks were pending, with no failures or successes reported yet. The PR is open at [#795](https://github.com/safwan5001-source/Nebrax/pull/795). CI must complete before merge review; this task does not merge or deploy.

## Deferred / Follow-up

A production policy decision is still required before making email verification mandatory for existing users. Email-provider credentials, sender identity, delivery monitoring, and `FRONTEND_URL` remain deployment configuration and were intentionally not changed. No broader auth architecture, Customer Platform architecture, or unrelated findings were addressed.

## Risks

The repository cannot validate the Laravel tests locally without the Docker/CI toolchain. CI must validate the migration and full backend test matrix on SQLite and PostgreSQL. Mail delivery remains dependent on the configured provider; failed delivery is logged but requires operational monitoring and retry policy outside this narrow V1.

## Next Step

Review the completed PR and wait for all Laravel and Web CI checks to pass. Then separately decide the backward-compatible migration policy for any future mandatory verification enforcement. Do not merge or deploy as part of AUTH-SEC-1 execution.
