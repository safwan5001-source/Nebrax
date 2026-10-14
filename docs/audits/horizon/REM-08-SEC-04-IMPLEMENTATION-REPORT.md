# REM-08 / SEC-04 — Implementation Report: deactivated users lose API access immediately

STATUS: **MERGED** (PR #1415, merge `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11`) · **CI verified** · **Production deployment NOT VERIFIED**

> **Status correction (2026-10-14, post-merge).** This report was authored while the change was a Draft PR ("NOT MERGED"). Current verified state: PR #1415 merged, merge SHA `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11`, post-merge `CI` run #9359 success; **production deployment NOT VERIFIED**. The body below is otherwise unchanged and still describes the state at authoring; where it says "Draft" or "not merged" this note supersedes it. Cross-horizon status: `TAX-ZATCA-RECONCILIATION-AUDIT.md`.
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: TAX-HZ-00 → REM-08)
ZONE: C — security / authentication

## Executive summary

| | |
|---|---|
| Verdict | **PASS locally.** A user deactivated after login can no longer use an already-issued token: the next authenticated tenant request is denied before any tenant logic runs, and the token rows are removed when the deactivation goes through the API. |
| Production change | `SetTenant` (+10 lines), `UserController::update` / `::destroy` (+~22 lines). No schema, route, RBAC, Sanctum, middleware-order or `AuthController` change. |
| STOP conditions | None triggered (evidence in *Pre-implementation checks*). |
| Needs owner attention | (1) 401-vs-403 nuance, below. (2) A deactivation written **outside** `UserController` leaves tokens until reactivation — see *Risks*. |

## Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `322c20cf009e0f1c917566e4930b689764651b60` (`origin/main` at start, contains REM-03 and REM-03b). `main` has since advanced to `22f2ee5` (#1414, web-only heading fix) — no file overlap, no merge needed. |
| Branch | `fix/security/rem08-deactivated-user-revocation` |
| PR | #1415 — https://github.com/safwan5001-source/Nebrax/pull/1415 (**Draft**) |
| Code + tests head | `aedeee387cb05a8ace7bd7b7419648e1af38598c` |
| Final Head SHA | recorded in the PR and in the hand-back message (a file cannot contain its own commit hash); it adds only this report and the backlog wording on top of the code head |
| Merge SHA | `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11` (was "N/A" at authoring) |

## Original defect

On `main` at the Base SHA:

- `SetTenant` checked principal, tenant id, hostname and `tenant->is_active`, but never `user->is_active`.
- `is_active` was enforced only at `login()` and `handoff()`.
- `UserController::update` could set `is_active=false` without touching tokens; `destroy` soft-deleted the user without touching tokens. `personal_access_tokens` is `uuidMorphs('tokenable')` with **no foreign key**, so nothing cascades.
- Token deletion existed only on password reset (`AuthController`, `tokens()->delete()`).

Reproduction (now tests A and B): active user with a valid Sanctum token → admin `PUT /api/users/{id} {"is_active":false}` → the same token still returns 200 on `GET /api/me`.

## Pre-implementation checks (STOP-condition review)

| STOP condition | Finding |
|---|---|
| Soft-only deactivation by design / tokens meant to survive | No evidence; login/handoff already treat inactive as denied. |
| Deletion preserves tokens for audit | No: no FK, no audit consumer of those rows. |
| User-management policy change needed | No. Owner/self rules are untouched (characterised by test K). |
| Machine principals in `users` | No. `ApiClient`, `PreviewSession`, `CustomerIdentity` are separate models; the guard is `instanceof User` (test L). |
| Non-human `users` with different `is_active` semantics | None found; `UserController` is the only writer of `users.is_active`. |
| Guard belongs elsewhere | `SetTenant` is on the `User` route groups (`EnsureUserPrincipal → SetTenant`) and the POS/Commerce provider groups; customer/platform auth does not pass through it. |
| Global middleware order / Sanctum internals / schema / tenant isolation | None required. |
| Another merged layer already fixes it | No. |

## Implementation

1. **Per-request guard — `SetTenant`.** After the existing principal / hostname / tenant-active checks and **before** `TenantContext::set()`: if `$user instanceof User && $user->is_active === false` → `403 {"message":"الحساب غير مفعّل."}` — the exact status and message `login()` already returns. No new envelope. Because it sits before `set()`, no tenant scope is established and no business code runs. Existing checks run first, so tenant-inactive behaviour is unchanged for every prior case.
2. **Transition-based revocation — `UserController::update`.** `$wasActive` is read before the update; inside `DB::transaction` the update runs and, only if `$wasActive && ! $user->is_active`, `$user->tokens()->delete()` runs. The inactive state therefore cannot commit without the token deletion (and vice-versa). `syncAccessScope()` stays outside the transaction so branch/warehouse sync failure semantics are unchanged; a failure there leaves the user inactive **and** revoked (safe direction).
3. **Delete-time revocation — `UserController::destroy`.** After the existing self-delete and owner guards, `DB::transaction`: `tokens()->delete()` then `delete()` (soft delete).
4. **Ordering / race note.** A login that read the user as active just before the deactivation commit could still mint a token after the revocation. That is why the per-request guard — not the token delete — is the authoritative control (test B proves it independently).

`tokens()` is the `HasApiTokens` morph relation, so it deletes only rows where `tokenable_type = User` and `tokenable_id = <that user>`.

## Existing auth contracts preserved

| Flow | Behaviour | Evidence |
|---|---|---|
| Login, inactive user | `403 الحساب غير مفعّل.` (unchanged) | existing `SubscriptionTest::inactive_user_cannot_login`; test J |
| Handoff, inactive user | **`422` "رابط الانتقال غير صالح…", no token issued.** `AuthRecoveryService::consume()` filters `where is_active = true` and burns the code, so the controller receives no user and aborts 422 *before* its own `is_active` branch (`abort(403)`), which is therefore not reached today. This is the **existing contract**; `AuthController` was not touched and the contract is pinned by a characterization test. | test J (handoff) |
| Logout | deletes current token only (unchanged) | existing `ApiAuthTest::logout_revokes_the_token` |
| Password reset | `tokens()->delete()` (unchanged) | `AuthController` is untouched by this PR; the existing `AuthRecoveryTest` suite passes on SQLite and PostgreSQL. It does not assert Sanctum token deletion itself, so no new claim is made beyond "unchanged". |
| Tenant inactive | `403 الاشتراك غير مفعّل.`, takes precedence over the user message | test I; `TenantSubdomainAuthTest::an_inactive_tenant_subdomain_fails_closed` |

**401 vs 403 (owner note).** The backlog card says "403 on the next request". That is what happens when the token row survives (guard path, test B). Through the normal API path the tokens are already deleted, so the *same old token* gets **401** from `auth:sanctum` before `SetTenant` runs (test A). Both deny before any tenant logic; no envelope was altered to force a single code.

## Tenant isolation

Test G: tenant A's owner `PUT`/`DELETE` on tenant B's user → **404** (`findOrFail` scoped by `tenant_id`, the existing non-disclosing semantics); a forged non-existent UUID gives the same 404. The victim's `users` row and both `personal_access_tokens` rows are identical before and after (`assertEquals` on the raw rows), the victim token still returns 200, tenant B's owner is unaffected. No `withoutGlobalScope` was introduced.

## RBAC

Test H: an `accountant` (no `users.manage`) calling `PUT`/`DELETE /api/users/{id}` still gets **403**; the target stays active with its token row and token working; the accountant's own request still succeeds on `/api/me`. No permission, role, route or `EnsurePermission` change. Test K characterises, unchanged: `admin` cannot deactivate the owner (403), and self-deactivation remains allowed by current policy (200, then that actor's own token is dead).

## Token behaviour matrix

| State | Token rows | Next request with old token |
|---|---|---|
| Active, unrelated update (name, `true→true`) | kept | 200 (test D) |
| Deactivated via API (`active→inactive`) | **deleted** | 401 (test A) |
| Deactivated, token row survives (direct DB write) | kept | **403** `الحساب غير مفعّل.`, no side effects (test B) |
| Repeated inactive update (`false→false`) | not touched | 403 via guard (test E) |
| Reactivated via API | stays deleted; **not recreated** | 401; fresh `/api/login` returns a new working token (test C) |
| Deleted via API | **all of that user's deleted**; other users' kept | 401; others 200 (test F) |

## Tests — `tests/Feature/Rem08DeactivatedUserAccessTest.php` (13)

A existing token dies after deactivation (+ only the target's tokens removed; admin and unrelated user unaffected) · B guard independently protects (+ write endpoint count unchanged) · C reactivation does not restore, fresh login works · D unrelated update keeps token · E repeated inactive update · F delete revokes all of the user's tokens only · G tenant isolation · H permission denial · I tenant-inactive regression · J login + handoff (inactive) · K owner/self-deactivation policy preserved · L guard ignores non-`User` principals.

## SQLite

Local app assembled with the CI copy list into `nibras-app`.

| Command | Result |
|---|---|
| `php artisan test --filter=Rem08DeactivatedUserAccessTest` | **13 passed (95 assertions)** |
| focused security set¹ | 324 tests: 320 passed, 4 failed — all 4 pre-existing, see *Existing failures* |
| **full suite** `php artisan test` | 6498 passed, 73 skipped, **142 failed** (789.9 s). **The failing set is identical to the pre-fix baseline** — see below. |

¹ `Rem08…|ApiAuthTest|ApiTenantIsolationTest|ApiUnauthenticatedResponseTest|AuthRecoveryTest|UserManagementTest|UserAccessScopeTest|UserEmployeeLinkTest|UserInvitationTest|UserRequestIdempotencyTest|SubscriptionTest|TenantSubdomainAuthTest|TenantProvisioningE2ETest|AccountManagementTest|PlatformTenantManagementTest|DeveloperApiClientManagementTest|PublicApiAuthTest|Rem03*ActiveBranchOnlyTest|BranchIsolation|AccessControl|Rbac|Role`.

## PostgreSQL

PostgreSQL 16 (CI settings: role `nibras`, db `nibras`, `max_locks_per_transaction=1024`), `migrate:fresh`, driver confirmed `pgsql` by a probe test.

| Command | Result |
|---|---|
| focused security set¹ (incl. `Rem08DeactivatedUserAccessTest`) | 324 tests: 320 passed, 4 failed (the same 4 pre-existing, none in REM-08/auth/user/tenant scope) — **identical to SQLite** |

The **full** PostgreSQL suite was not run locally (sequential run cost; no ParaTest here). It is covered by the CI `pgsql` leg on the exact head — see *CI*.

## Negative control

Run only in the assembled `nibras-app` copy (the PR branch was never dirtied), then restored and re-verified.

| Variant | Result of the 13 tests |
|---|---|
| Both files at Base SHA (pre-REM-08) | **6 failed** — A, B, C, E, F, K; D, G, H, I, J, L pass (they pin unchanged behaviour) |
| Only the `SetTenant` guard applied | 5 fail (A, C, E, F, K); **B passes** |
| Only the controller changes applied | 2 fail (**B**, E); A, C, F, K pass |

So test A reproduces the original defect (token usable after deactivation), test B fails without the guard, and each layer is independently necessary.

## Existing failures (not caused by this change)

The full run's 142 failures were re-run on the Base SHA files, restricted to the 28 failing classes: **142 failed on base, 142 on the fix; the sets are identical** (diffed test-by-test: zero only-in-fix, zero only-in-base). They are all Storefront/Product media, R2/attachment storage, document-storage diagnostics and Fuel tests (plus one `UserRequestIdempotencyTest` attachment-upload case). Root causes seen in this sandbox: PHP without `bcmath` (`Call to undefined function App\Services\bcmul()`) and without the AWS SDK (`Class "Aws\Exception\AwsException" not found`); CI installs both. They are therefore expected to pass in CI, which is the arbiter.

## Files changed

| File | Change |
|---|---|
| `app/Http/Middleware/SetTenant.php` | inactive-`User` guard |
| `app/Http/Controllers/Api/UserController.php` | transactional transition revocation; delete-time revocation |
| `tests/Feature/Rem08DeactivatedUserAccessTest.php` | new, 13 tests |
| `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` | REM-08 status entry |
| `docs/audits/horizon/REM-08-SEC-04-IMPLEMENTATION-REPORT.md` | this report |

No living auth reference was edited: the closest candidate (`docs/plans/auth/AUTH-SEC-1-IMPLEMENTATION-REPORT.md`) is a historical report, so adding to it was not clearly appropriate.

## Risks / remaining

1. **Deactivation outside `UserController`.** Today `UserController` is the only writer of `users.is_active`. A future path (HR offboarding, platform admin, a script) that flips it directly is still blocked at runtime by the guard, but its tokens persist and would **work again if the user is later reactivated through the API** (the `false→true` transition deliberately revokes nothing, per scope). Any such future path should revoke tokens itself.
2. **Self-deactivation** remains allowed (current policy, unchanged); the actor's own token dies with the response.
3. **Cost**: one `is_active` attribute read on an already-loaded model — no extra query.
4. Not covered by this slice: `ApiClient.is_active` on routes that reach `SetTenant` without `EnsureUserPrincipal` (POS provider group) — unchanged, out of scope.

## CI

Recorded in the hand-back message and PR comment against the exact final head (a file cannot contain its own head's CI result).

## Merge / Deploy

- **Draft**: yes (#1415)
- **NOT MERGED**
- **NOT DEPLOYED**

## Next step

Owner review only. No Railway or GitHub settings were changed.
