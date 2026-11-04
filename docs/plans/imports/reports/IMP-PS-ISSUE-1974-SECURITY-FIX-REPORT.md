# SEC #1974 — Security Fix Report: uniform refusal for out-of-scope-branch reconciliations

**Status:** implemented, PR open, **not merged, not deployed.** PS-A4a and Track B not started. No migration, route, permission, RBAC, policy, settings, financial or capability-gate change.

| | |
|---|---|
| Issue | https://github.com/safwan5001-source/Nebrax/issues/1974 |
| Branch | `claude/sec-1974-uniform-branch-refusal` |
| PR | #1977 — https://github.com/safwan5001-source/Nebrax/pull/1977 |
| Base SHA | `eefaec83ea69a6307c8b46c1693a1bb5548dd376` (`main` at start = PR #1970 squash) |
| Head SHA (code commit) | `4c853c9ecfcd7d64aebcdb268b352362efdc0d1c` |
| Head SHA (final, incl. this report) | recorded in the PR / hand-off message (a file cannot contain its own commit SHA) |

## 1. Root cause and response contract

`PartnerStatementImportService::assertAccess()` is shared by two very different callers:
* **import preview/apply** — `branch_id` is *user input*; a specific message is legitimate validation;
* **per-reconciliation routes** (via `PartnerStatementMatchService::authorize()` and `::source()`) — the branch is the *frozen* `policy.branch_id` of an existing record; the same specific message there tells a branch-restricted user "this reconciliation exists, in a branch you cannot see" (existence oracle), while unknown ids, other tenants and unavailable partners return `PARTNER_UNAVAILABLE`.

| Case (restricted user) | Before | After |
|---|---|---|
| unknown id / other tenant / soft-deleted or wrong-type partner | 422 `{"message":"الطرف غير متاح لك في هذا الدور."}` | unchanged |
| existing reconciliation, frozen branch out of scope — **12 routes** | 422 `{"message":"هذا الفرع خارج نطاق صلاحياتك."}` | **422 `{"message":"الطرف غير متاح لك في هذا الدور."}`** (byte-equal to unknown id) |
| import preview / apply with user-supplied out-of-scope branch | 422 branch message | **unchanged** |
| 403 (missing permission), non-SAR tenant message, no `partners.view` | as before | **unchanged** |

Routes in scope (13 requests / 12 endpoints): `match`, `matches`, `verify-set`, `decisions` GET + POST, `reversed-pairs`, `status`, `events`, `review`, `reopen`, `close`, `void`, `replace` — plus N2 `GET {id}` and N4 `GET {id}/lines` (already uniform through the shim, now through the central path).

## 2. Files changed and why

| File | Change |
|---|---|
| `app/Support/PartnerStatementBranchScopeException.php` | **new**, `final`, extends `RuntimeException`, carries the legacy message. Typed signal instead of string matching. |
| `app/Services/PartnerStatementImportService.php` | `assertAccess()` throws the typed exception (same message, still a `RuntimeException` ⇒ 422 as before) — decision logic untouched. |
| `app/Services/PartnerStatementMatchService.php` | `authorize()` and `source()` catch **only** that type and throw the uniform refusal. |
| `app/Services/PartnerStatementReconciliationQuery.php` | removed `BRANCH_REFUSAL` and `authorizeUniformly()` (string-match shim); N2/N4 call `authorize()` directly. |
| `tests/Feature/PartnerStatementBranchRefusalSecurityTest.php` | **new**, 6 tests (§3). |
| `tests/Feature/PartnerStatementMatchApiTest.php` | the one assertion that pinned the leaking message on `match`/`matches` now expects `PARTNER_UNAVAILABLE` (intentional contract change approved in the issue). |

**Scope verification:** `git diff origin/main...HEAD` = 6 files above; no route/migration/config/RBAC/web/mobile file. `PartnerLedgerCandidates` (user-supplied filter path) is untouched; its test still pins the legacy message and passes.

**Consumer audit:** the legacy text does not appear in `web/`, `storefront/`, `mobile/`, `contracts/` or `docs/openapi`; no client calls `partner-statement-reconciliations*`; the web only knows the `partner_statement` import domain key (`import-jobs/client.ts`, `imports/catalog.ts`), without message handling. Other occurrences of similar wording belong to unrelated modules (POS, purchases, stock permits, `ApiController`). **Compatibility impact:** only API consumers that matched the old branch text on those routes — none in this repository.

## 3. Tests and mutation evidence

`PartnerStatementBranchRefusalSecurityTest` (6 tests, 186 assertions; `app.debug=false` for the literal production body; rate-limit counter reset per request so throttling cannot mask authorization):
1. all 13 requests with valid payloads: status **and** body of *out-of-scope branch* ≡ *unknown id* ≡ *other-tenant id*, no mention of "الفرع" or the branch id;
2. soft-deleted partner and wrong-type partner ≡ unknown id, for owner and restricted user, on every route;
3. authorized access preserved: restricted user sees own-branch and organisation-wide reconciliations on header/lines/status/events/decisions/matches and in the N1 list (out-of-scope excluded); unrestricted user sees all;
4. unrelated refusals are *not* converted (403 without `view`; `PARTNER_UNAVAILABLE` without `partners.view`; non-SAR message intact);
5. user-supplied branch keeps its typed, specific message through `assertAccess` and `apply`; own-branch / no-branch pass;
6. static guard: the message literal exists only in the exception class; exactly two `catch (PartnerStatementBranchScopeException)` in the match service; no `BRANCH_REFUSAL`/`getMessage()` in the query service.

Mutations (each applied to the app tree, test run, then restored and verified byte-identical):
| Mutation | Result |
|---|---|
| M0 pre-fix `main` services | 3 tests fail (oracle present) |
| M1 `authorize()` stops converting (distinct message restored) | equivalence test fails |
| M2 branch-scope check bypassed in `assertAccess` | equivalence + import-contract tests fail |
| M3 over-broad conversion (all `RuntimeException`) | "unrelated refusals" + static guard fail |
| M4 string-match shim reintroduced | static guard fails |

Local runs (sandbox PHP 8.3, PostgreSQL 16): `PartnerStatement|PartnerLedgerCandidates` — **SQLite 221 passed (32 PostgreSQL-only skipped), PostgreSQL 253 passed** (includes the `pcntl_fork` concurrency suites).

## 4. CI and review status
_Filled in after the CI run on the final head — see the PR checks and the hand-off message._

## 5. Risks, compatibility, remaining items
* **Behaviour change (intended, approved):** the 422 *message* for that one case changes; status code unchanged.
* **Other signal, not covered by this issue (observation, no change made):** `replace` also accepts `replaces[]` ids in the *body*. For each, `supersedeFinals()` checks existence (uniform refusal), then `replace_target_mismatch` (other partner/role) and `replace_target_not_closed` **before** `assertCloseRunReadable()` (which already answers with the uniform `PARTNER_UNAVAILABLE`). So a caller holding `close`+`void` can learn that a same-tenant id exists and is not a closed final of the same partner/role even when its branch is outside their scope. This is not the `assertAccess` branch message, needs a valid same-tenant UUID plus two privileged permissions, and is independent of #1974; reordering the readability check first would remove it. Suggested as a separate small follow-up.
* Timing side channels are not addressed (out of scope).
* Pre-existing, unrelated local-environment items seen earlier (Fuel tests need `bcmath`; `PostgresTestLockTimeoutTest` needs CI's `PGOPTIONS`): unchanged by this PR.
* Rollback: revert the PR; no data or schema involved.

## 6. Next recommendation
Merge after owner approval, then proceed to PS-A4a. Optionally open a follow-up to review the `replaces[]` body-id signals noted above.
