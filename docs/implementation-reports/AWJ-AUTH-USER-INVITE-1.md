# AWJ-AUTH-USER-INVITE-1 — Implementation Report

## Summary

Implemented secure user login invitations by email for أَوْج AWJ ERP.

The implementation reuses the existing password-reset/authentication infrastructure:

- `AuthRecoveryService`
- `auth_action_tokens`
- `AuthActionMail`
- Existing `/reset-password` API flow
- Existing tenant hostname resolver
- Existing `users.manage` permission boundary
- Existing Laravel mail/Resend integration

Administrators can now send an invitation when creating a user and resend a secure invitation from the existing users management table.

No merge, deploy, or production release was performed.

### Post-review P2 consistency fix

The delivery sequence was hardened so a synchronous mail failure cannot invalidate a previously valid invitation:

1. `issueForDelivery()` creates a candidate token without revoking previous unused invitation tokens.
2. `Mail::send()` runs outside any long-running database transaction.
3. On success, `commitDelivery()` retires previous invitation tokens and keeps the delivered candidate active.
4. On failure, `abandonDelivery()` retires only the undelivered candidate, preserving the previous invitation.

For new-user creation, the saved user is not rolled back after the mail call fails. The API returns `201` with `invitation.sent=false` and an explicit retry message, so the client knows the user exists and can use the existing resend action. The failed candidate is revoked, leaving no live unmailed invitation.

## Security Design

### Token mechanism

A new `login_invitation` token type was added to the existing `AuthRecoveryService`. No parallel authentication mechanism or new token table was created.

The existing mechanism provides:

- Cryptographically secure random token generation using `Str::random(64)`.
- SHA-256 hash storage; the raw token is only placed in the generated link.
- User and tenant binding in `auth_action_tokens`.
- Existing hostname/tenant validation through `matchesHostname()`.
- Single-use consumption protected by a transaction and row lock.
- Existing expiration handling.

### Expiration and single use

Invitations use the existing one-hour auth-action TTL. Issuing a fresh invitation marks any currently unused invitation token for the same user as used before creating the new one.

The token is consumed only when the existing `/reset-password` flow successfully validates and changes the password. Reuse after consumption is rejected.

### Tenant binding

The invitation URL is generated through `AuthRecoveryService::frontendLink()`, which delegates to `TenantHostnameResolver`. No production or development hostname is hardcoded in the feature.

Consumption requires the request hostname to resolve to the same tenant recorded on the token. The returned user is also checked against the token tenant and must be active.

### Plaintext password protection

Plaintext passwords are never emailed, exposed, or stored as temporary invitation data.

When creation uses the invitation option and no password is supplied, the user receives an unknowable random password hash. The user can authenticate only after completing the secure setup/reset link. Existing passwords are not changed when an invitation is sent or resent.

The email contains the tenant/company name, user name where available, login email, tenant-specific setup URL, expiry information, CTA, and a security notice. It does not contain the token text, internal IDs, or passwords.

### Mail-failure consistency

The mail call is deliberately not placed inside a database transaction. The candidate token is provisional state:

- **Successful send:** the new token remains usable and previous unused invitations are retired.
- **Failed send with an old invitation:** only the new candidate is retired; the old invitation remains usable.
- **Failed send for a newly created user:** the user remains saved and is explicitly reported as saved; the unmailed candidate is retired, and a later resend creates a fresh candidate.

## UX

### New user creation

The existing user dialog includes the bilingual option:

- Arabic: `إرسال دعوة الدخول إلى بريد المستخدم`
- English: `Send login invitation by email`

When enabled, the database user creation completes first and the invitation is sent afterward.

The employee dialog uses the same option when creating a linked login account. Existing employee records remain separate from login access.

### Existing user action

The existing users table now includes a mail action labelled:

- Arabic: `إرسال بيانات الدخول`
- English: `Send login details`

The action displays a confirmation containing the destination email, then calls the tenant-scoped resend endpoint:

`POST /api/users/{id}/send-invitation`

Success feedback is shown as:

`تم إرسال بيانات الدخول إلى بريد المستخدم.`

The action does not change the current password. Repeated sends are protected by an invitation-specific rate limiter.

## Files Changed

- `app/Services/AuthRecoveryService.php` — Added the `login_invitation` token type and provisional delivery/commit/abandon operations while reusing existing hashing, expiry, single-use, and tenant-hostname checks.
- `app/Mail/AuthActionMail.php` — Added invitation metadata and subject handling while retaining the existing mail class.
- `resources/views/emails/auth-action.blade.php` — Added bilingual-compatible invitation content with tenant, user, login email, CTA, expiry, and security notice.
- `app/Http/Controllers/Api/AuthController.php` — Allowed invitation tokens to use the existing reset-password completion flow.
- `app/Http/Controllers/Api/UserController.php` — Added invitation sending on creation and the tenant-scoped resend action; preserves existing passwords on resend and reports mail failure without hiding a saved user.
- `app/Http/Requests/StoreUserRequest.php` — Made the password optional only when `send_invitation=true`.
- `app/Providers/TenancyServiceProvider.php` — Added a focused tenant/user/IP invitation throttle.
- `routes/api.php` — Added the protected resend route behind `users.manage` and `auth-invitation` throttling.
- `web/src/components/users/user-dialog.tsx` — Added the invitation option to direct user creation.
- `web/src/components/hr/employee-dialog.tsx` — Added the invitation option to employee-linked login creation.
- `web/src/app/(app)/hr/page.tsx` — Added the existing-user resend action and confirmation.
- `web/src/messages/ar.json` — Added Arabic invitation/action strings.
- `web/src/messages/en.json` — Added English invitation/action strings.
- `tests/Feature/UserInvitationTest.php` — Added focused backend tests for authorization, delivery, URL, tenant isolation, password preservation, expiry, single use, session revocation, throttling, failed resend preservation, failed creation consistency, and successful replacement delivery.
- `docs/implementation-reports/AWJ-AUTH-USER-INVITE-1.md` — This report.

## Tests

### Local static checks

- `git diff --check` — passed.
- Arabic and English message JSON parsing — passed.
- Arabic/English `users` translation-key parity — passed; 32 keys compared.
- No migration files changed — confirmed.

### Local frontend checks

- `npm run test` — passed: **334 test files, 2500 tests**.
- `npm run build` — passed.

These were run both before and after the final UI label/test additions; the final run passed with the same totals.

### Backend focused tests

Added `tests/Feature/UserInvitationTest.php` covering:

1. Authorized admin can create and invite a user.
2. No plaintext password is emailed or persisted as the invitation password.
3. Existing password remains unchanged on resend.
4. Invitation email goes to the correct address.
5. Correct tenant hostname/setup URL is generated.
6. Unauthorized actor is rejected.
7. Cross-tenant target is rejected with the established not-found behavior.
8. Invitation token is tenant-bound.
9. Invitation token expires.
10. Invitation token is single-use.
11. Password changes only after completing the reset/setup flow.
12. Existing Sanctum sessions are revoked by the existing reset-password contract.
13. Invitation resends are rate limited.
14. A failed resend preserves a previously valid invitation.
15. A failed creation reports the saved user and leaves no live unmailed invitation.
16. A successful resend retires the previous invitation and keeps the new invitation usable.

PHPUnit could not be run in the local Sandbox because PHP, Composer, and Laravel vendor dependencies are not installed there. The repository CI environment executed the backend tests successfully on both SQLite and PostgreSQL.

## Build / CI

PR checks for PR #1147 completed successfully:

| Check | Result |
|---|---|
| CI — `php artisan test` (SQLite, matrix run 1) | PASS |
| CI — `php artisan test` (SQLite, matrix run 2) | PASS |
| CI — `php artisan test` (PostgreSQL, matrix run 1) | PASS |
| CI — `php artisan test` (PostgreSQL, matrix run 2) | PASS |
| Web CI — `web build (Next.js)` (run 1) | PASS |
| Web CI — `web build (Next.js)` (run 2) | PASS |

Current PR check summary: **6 successful, 0 failing, 0 cancelled, 0 skipped, 0 pending**.

No unrelated CI failures were observed.

## Tenant Isolation

Positive coverage verifies that the invitation token records the correct tenant and user and generates a tenant-specific hostname such as `alpha.awj.app` through the resolver.

Negative coverage verifies:

- A token issued for Tenant A cannot be consumed on Tenant B.
- A user from Tenant A cannot be targeted through Tenant B's authenticated user-management route.
- A staff/unauthorized actor cannot send invitations.
- A tenant-scoped user lookup prevents cross-tenant delivery.
- Missing or mismatched tenant hostname context rejects token consumption.

## RBAC

The existing `users.manage` permission is reused. This is the established permission for user/access management and avoids introducing a new permission unnecessarily.

The resend route is also inside the existing authenticated tenant user-management route group and is protected by the existing permission middleware.

## Mail

The existing `AuthActionMail` and configured Laravel mail/Resend path are reused.

The invitation template includes:

- AWJ identity
- Tenant/company name
- User name
- Login email
- Correct tenant-specific frontend URL
- `تعيين كلمة المرور` CTA in Arabic / equivalent setup CTA in the invitation flow
- One-hour expiry notice
- Link-sharing security notice

The raw token is not rendered separately, logged, or exposed in the UI.

## Database

**No database migration or schema change was made.**

The existing `auth_action_tokens` table supports the new token type without structural changes.

## Audit Trail

The repository was inspected for an existing user-management activity/audit mechanism. No reliable existing mechanism was found that could be reused for this action. No new audit subsystem was introduced solely for this task, in accordance with the task scope. This is a remaining gap for a future audit-focused task.

## Risks / Remaining Gaps

- Local backend PHPUnit execution was unavailable in the Sandbox due to missing PHP/Composer/vendor dependencies; the official CI backend matrix passed on SQLite and PostgreSQL.
- No dedicated audit event was added because no existing suitable audit mechanism was found.
- Synchronous mail failures are caught by the invitation flow: the candidate token is abandoned, prior valid invitations are preserved, and creation/resend responses state the delivery failure explicitly. No unrelated mail infrastructure was changed.

## Git

- Repository: `safwan5001-source/Nebrax`
- Branch: `task/awj-auth-user-invite-1`
- Base SHA: `946ef115b986caaf7893a0b24cc0afbcddbc4830`
- Head SHA: `cf38c6d9af374c6c22f85994bf03b6401d682475`
- PR: [#1147](https://github.com/safwan5001-source/Nebrax/pull/1147)
- PR state: `OPEN`
- Merge state: `CLEAN`
- Merge performed: **No**
- Deploy/release performed: **No**

## Final Status

**READY_FOR_REVIEW**
