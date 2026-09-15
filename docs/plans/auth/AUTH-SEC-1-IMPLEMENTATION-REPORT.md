# AUTH-SEC-1 Implementation Report

- **Status:** AUTH-SEC-1 implementation is unchanged and secure. The PR was re-synchronized with the current `origin/main`. All required CI checks are green on both the SQLite and PostgreSQL matrices, and on Web CI. PR remains open, not merged, and not deployed.
- **Branch:** `feat/auth-sec-1-email-password-recovery`
- **PR:** [#795](https://github.com/safwan5001-source/Nebrax/pull/795)
- **PR base branch:** `main`
- **Synchronized `origin/main` SHA (this round):** `15f6c53d4fddc8fc0a19ac96ab6738eb3ea44d4b`
- **Merge-base for this round's sync:** `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e` (the SHA `origin/main` was previously at)
- **Synchronization method:** merge-from-main (`git merge origin/main --no-edit`), preserving published history. No rebase, no force-push.
- **Conflicts:** None.
- **Final Head (pushed):** `41152d0d3e3bed9c6bc868d132181d15e7b6cbbf`

## Implemented

The implementation adds email verification on registration and authenticated resend, public forgot-password and reset-password endpoints, and a public verification endpoint. Recovery and verification tokens are generated with cryptographically secure framework primitives, stored only as SHA-256 hashes, expire after one hour, and are invalidated on use or replacement. A successful password reset deletes the user's existing Sanctum tokens. Existing staff users are not made subject to mandatory email verification, preserving current login behavior.

The web application includes minimal responsive pages for password recovery, password reset, and email verification, plus a recovery link on the existing login page. Arabic is the primary language and English keys were added through the existing `next-intl` message files.

## Security Guarantees Preserved

- Token consumption requires a non-null, valid `HostnameTenantContext` and exact tenant matching.
- Tenant A tokens fail on Tenant B and on generic/no-tenant hosts.
- Forgot-password without valid tenant context performs no global lookup and issues no token while returning the same neutral response.
- Links remain tenant-aware and use the existing hostname resolver/configuration.
- Database storage remains SHA-256 hashes only; tokens remain expiring, single-use, and invalidated on replacement.
- Successful password reset continues to revoke existing Sanctum tokens.
- Existing users are not made subject to mandatory email verification.

All of the above are now confirmed by a fully green `AuthRecoveryTest` (9/9) on both database engines — see "This Synchronization Round" below for the one test-file correction that was required to get an accurate signal.

## This Synchronization Round

`origin/main` had advanced from `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e` to `15f6c53d4fddc8fc0a19ac96ab6738eb3ea44d4b`, picking up (among others) `VAR-INV-1` follow-up fix `#815` (`ee4a260`, migrates `ReportEffectiveScopeTest` fixtures to the `InventoryState` contract — this is exactly the regression that was blocking the previous round), `VAR-MEDIA-1` (#814), the AWJ tenant-subdomain pin (#816), and `VAR-DOC-1` (#817). None of these touch any of the 20 files AUTH-SEC-1 changes, so `git merge origin/main --no-edit` completed with **zero conflicts**.

The OpenAPI spec (`docs/openapi/public-api-v1.yaml`) was not modified by `main` in this round, so there was no contract drift to regenerate; `npm run openapi:generate` was not needed this round (confirmed by a passing OpenAPI drift test with no diff).

**One pre-existing test-authoring defect was found and fixed**, unrelated to `main` and unrelated to any AUTH-SEC-1 security behavior:

`tests/Feature/AuthRecoveryTest.php::tenant_bound_token_fails_without_hostname_context` posted to a relative `'/api/reset-password'` URL expecting a generic, no-tenant host. Laravel's `url()` helper (used internally by `TestCase::postJson()` for relative URIs) resolves against the root of the **last request handled within the same PHPUnit test method**, not `config('app.url')`. Since the same test had already posted to an absolute tenant URL (`http://alpha.awj.app/...`) earlier, the later "relative" call inherited that tenant host instead of hitting a generic one — a known Laravel testing behavior, not an application bug.

This was root-caused by direct instrumentation (temporary debug output in a disposable build outside the repository, never committed) confirming the middleware saw `alpha.awj.app` instead of `localhost` on the second call. The actual security code was read and verified correct and unmodified:
- `AuthRecoveryService::matchesHostname()` already requires a non-null `HostnameTenantContext` match.
- `IdentifyTenantHostname` middleware calls `forget()` on entry and again in a `finally` block, so state does not leak between requests in production (this bug is a testing-harness quirk specific to how Laravel resolves relative URLs across sequential requests in one test method).

**Fix applied (test file only):** the relative URL was replaced with an explicit `http://localhost/api/reset-password`, so the test actually exercises the no-tenant-context path it was written to check. No production code was touched.

## Files Changed in This Round

| Change | Files | Reason |
|---|---|---|
| Main synchronization | 50 files brought in by the merge from `origin/main` (see merge commit `0674ff8`) | Required PR synchronization; zero conflicts, none intersect AUTH-SEC-1's files. |
| Test fix | `tests/Feature/AuthRecoveryTest.php` (3 lines) | Corrected a relative-URL test-authoring bug (see above); no application/security logic changed. |
| Documentation | `docs/plans/auth/AUTH-SEC-1-IMPLEMENTATION-REPORT.md` | Records this synchronization round, the test fix, and final green CI results. |

## Validation

| Check | Result |
|---|---|
| `php artisan test --filter=AuthRecoveryTest` (SQLite) | **PASS 9/9** (40 assertions) — verified locally against a build assembled to match `.github/workflows/ci.yml` exactly, and confirmed by GitHub Actions. |
| `php artisan test --filter=AuthRecoveryTest` (PostgreSQL) | **PASS 9/9** (40 assertions) — same, confirmed by GitHub Actions. |
| `php artisan test --filter=ReportEffectiveScopeTest` (SQLite) | **PASS 34/34** (479 assertions) — confirms fix `#815` fully resolves the previous round's blocker. |
| `php artisan test --filter=ReportEffectiveScopeTest` (PostgreSQL) | **PASS 34/34** (479 assertions). |
| Full local suite (both engines, informational only) | 27 pre-existing failures in `Fuel*` and `DocumentCenterSecureIntakeTest`, identical on both engines — caused by the local sandbox missing the `bcmath` PHP extension and a PDF engine (both installed in real CI via `shivammathur/setup-php@v2` and the "PDF/XML engines" CI step). Confirmed **not present** in the actual GitHub Actions run (both matrices fully green). Unrelated to AUTH-SEC-1, Reports, or Inventory. |
| OpenAPI drift test | Passed, no diff. |
| `cd web && npm run test` | Passed: 269 files / 1,745 tests. |
| `cd web && npm run build` | Passed; Next.js build completed successfully (exit 0). |

## GitHub Actions

All runs below target Final Head `41152d0d3e3bed9c6bc868d132181d15e7b6cbbf`:

| Workflow | Run ID | Job | Result |
|---|---:|---|---|
| CI (push-triggered) | `34929231435` | php artisan test (L11, sqlite) | Success |
| CI (push-triggered) | `34929231435` | php artisan test (L11, pgsql) | Success |
| CI (push-triggered) | `34929231441` | web build (Next.js) | Success |
| CI (pull_request-triggered) | `34929233693` | php artisan test (L11, sqlite) | Success |
| CI (pull_request-triggered) | `34929233693` | php artisan test (L11, pgsql) | Success |
| CI (pull_request-triggered) | `34929233794` | web build (Next.js) | Success |

Storefront CI did not trigger for this PR (path-filtered to `storefront/**`, which this PR does not touch — not applicable). PR `mergeable_state` is `clean`.

## Risks and Blockers

None remaining for this round. The local-sandbox-only `bcmath`/PDF-engine gap (see Validation) is informational and does not affect real CI, which is fully green. Mail-provider credentials, sender identity, delivery monitoring, and tenant base-domain configuration remain deployment configuration, unchanged by this round.

## Final Readiness

All required checks are green: Web CI, Laravel CI on SQLite, Laravel CI on PostgreSQL, `AuthRecoveryTest` (9/9 on both engines), `ReportEffectiveScopeTest` (34/34 on both engines, confirming no regression), and the OpenAPI drift test. `mergeable_state` is `clean`. From a CI and test-evidence standpoint PR #795 is ready for merge; **no merge or deploy was performed as part of this task**, per explicit instruction — that decision remains with the PR owner/reviewers.

Future mandatory email-verification enforcement remains a separate backward-compatibility policy decision.
