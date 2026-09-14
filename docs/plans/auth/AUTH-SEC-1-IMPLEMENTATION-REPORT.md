# AUTH-SEC-1 Implementation Report

- **Status:** P1 fix and the scoped Laravel CI fix are implemented on the existing branch; PR open; not merged and not deployed.
- **Summary:** Hardened the tenant-bound V1 email verification and password recovery flow for AWJ staff authentication, then fixed the CI configuration-load regression introduced by the tenant frontend scheme setting.
- **Base SHA:** `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e`
- **Head SHA:** Updated by the final metadata commit for this CI-fix pass.
- **Branch:** `feat/auth-sec-1-email-password-recovery`
- **PR:** [#795](https://github.com/safwan5001-source/Nebrax/pull/795)

## Implemented

The implementation adds email verification on registration and authenticated resend, public forgot-password and reset-password endpoints, and a public verification endpoint. Recovery and verification tokens are generated with cryptographically secure framework primitives, stored only as SHA-256 hashes, expire after one hour, and are invalidated on use or replacement. A successful password reset deletes the user’s existing Sanctum tokens. Existing staff users are not made subject to mandatory email verification, preserving current login behavior.

The web application now includes minimal responsive pages for password recovery, password reset, and email verification, plus a recovery link on the existing login page. Arabic is the primary language and English keys were added through the existing `next-intl` message files.

## Files Changed

| File | Purpose |
|---|---|
| `app/Services/AuthRecoveryService.php` | Issues and atomically consumes tenant-bound, expiring, single-use token records. |
| `app/Tenancy/TenantHostnameResolver.php` | Reused V1 tenant authority to construct environment-aware tenant frontend links. |
| `config/tenancy.php` | Adds the configurable frontend scheme for tenant links. |
| `database/migrations/2026_09_12_120000_create_auth_action_tokens_table.php` | Adds the token table with tenant/user foreign keys and lookup indexes. |
| `app/Http/Controllers/Api/AuthController.php` | Adds forgot, reset, verify, and resend handlers; sends verification on registration. |
| `app/Mail/AuthActionMail.php` | Mailable for verification and recovery links. |
| `resources/views/emails/auth-action.blade.php` | Arabic email content. |
| `routes/api.php` | Registers public and authenticated auth routes with throttles. |
| `app/Providers/TenancyServiceProvider.php` | Adds dedicated recovery/reset rate limiters. |
| `deploy/assemble.sh` | Ensures the Mailable and view are included in Docker/CI Laravel assembly. |
| `tests/Feature/AuthRecoveryTest.php` | Focused regression/security coverage for neutral responses, reset, replay, expiry, resend throttling, strict tenant boundaries, missing context, and tenant links. |
| `docs/plans/auth/AUTH-SEC-1-IMPLEMENTATION-REPORT.md` | Records P1 behavior, CI root causes, validation, and remaining unrelated CI status. |
| `web/src/app/forgot-password/page.tsx` | Forgot-password form and neutral success state. |
| `web/src/app/reset-password/page.tsx` | Reset-password form. |
| `web/src/app/verify-email/page.tsx` | Verification result state. |
| `web/src/app/login/page.tsx` | Minimal recovery link. |
| `web/src/messages/ar.json`, `web/src/messages/en.json` | Arabic/English auth strings. |

## Security

- **Tenant isolation:** Token records carry `tenant_id`; consumption now requires a non-null `HostnameTenantContext` and an exact tenant ID match before any state change. A token issued in Tenant A is rejected on Tenant B and on generic/no-tenant hosts. The existing hostname-before-credential behavior is preserved.
- **P1 strict binding:** `AuthRecoveryService::matchesHostname()` is fail-closed; the previous `hostnameTenantId === null || ...` behavior was removed.
- **Tenant-aware links:** Password-reset and verification links use `TenantHostnameResolver` and `config('tenancy.base_domains')`, with `AWJ_TENANT_FRONTEND_SCHEME` / local-testing defaults. No second domain architecture or hard-coded production domain was introduced.
- **Account enumeration protection:** Forgot-password only queries within a resolved tenant. Without valid tenant context it does not perform a global lookup or issue a token, while returning the same neutral response. Mail delivery failures are reported server-side without changing the response.
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
| `cd web && npm run test` after P1 changes | Passed: **266 test files, 1,731 tests**. |
| `php artisan test --filter=AuthRecoveryTest` | Not run locally: this checkout contains Laravel core files assembled by Docker/CI and the sandbox has no PHP, Composer, or Docker. The focused test file is included for CI. |
| `cd web && npm run test -- src/modules/developer/docs/__tests__/openapi-model.drift.test.ts` | Passed locally: 1 file, 3 tests. The corresponding Web CI failure was an unrelated OpenAPI model drift assertion in `openapi-model.drift.test.ts`; no Web source or contract change was made within this scope. |

## Build / CI

The CI run at the starting Head failed before tests. **Laravel root cause:** `config/tenancy.php` evaluated `app()->environment(...)` while the temporary Laravel assembly was loading configuration; in that CI bootstrap state the `env` binding/helper was unavailable, producing `Target class [env] does not exist` / `Class "env" does not exist` for both SQLite and PostgreSQL. The scoped fix removes the application-container call from config evaluation and uses the existing environment variables with a plain `APP_ENV` comparison.

**Web CI root cause:** the first failing test was the pre-existing `src/modules/developer/docs/__tests__/openapi-model.drift.test.ts`, which reported a committed OpenAPI model mismatch (`1 failed, 268 passed`, `1,744 passed, 1 failed`). This is outside AUTH-SEC-1 and passed locally; no unrelated OpenAPI/Developer change was made. A fresh CI run after the Laravel fix is required to record the final check state. The PR remains open at [#795](https://github.com/safwan5001-source/Nebrax/pull/795). This task does not merge or deploy.

## Deferred / Follow-up

A production policy decision is still required before making email verification mandatory for existing users. Email-provider credentials, sender identity, delivery monitoring, and the configured tenant base domains/scheme remain deployment configuration and were intentionally not changed. No broader auth architecture, Customer Platform architecture, or unrelated findings were addressed.

## Risks

The repository cannot validate the Laravel tests locally without the Docker/CI toolchain. The fresh CI run must validate the migration and full backend test matrix on SQLite and PostgreSQL. Web CI still needs a fresh result; if the OpenAPI drift failure recurs, it remains a pre-existing unrelated blocker and should not be fixed under AUTH-SEC-1 without a separate scope decision. Mail delivery remains dependent on the configured provider; failed delivery is logged but requires operational monitoring and retry policy outside this narrow V1.

## Next Step

Review the completed PR and wait for all Laravel and Web CI checks to pass. Then separately decide the backward-compatible migration policy for any future mandatory verification enforcement. Do not merge or deploy as part of AUTH-SEC-1 execution.
