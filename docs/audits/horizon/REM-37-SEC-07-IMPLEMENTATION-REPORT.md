# REM-37 / SEC-07 — Implementation Report: dedicated `zatca.submit` permission (separation of duties)

STATUS: **PASS locally (pending CI on the final head and owner review)** — **DRAFT PR — NOT MERGED — NOT DEPLOYED**
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: TAX-HZ-00 → REM-37)
ZONE: C — security / authorization / ZATCA

## Executive summary

| | |
|---|---|
| Verdict | **PASS locally.** ZATCA transmission (create attempt, dispatch) now needs `zatca.submit`; `invoices.manage` is no longer an authorization path for it. `zatca.view` stays read-only. |
| Owner decision | **Option B approved** (additive one-time backfill migration). A pre-implementation STOP was raised first because stored `roles` rows, not `Rbac::MATRIX`, drive permissions for existing tenants — without a backfill every existing accountant/custom role would have silently lost ZATCA submission. |
| Production change | `Rbac` (2 lists), `routes/api.php` (2 middleware lines), 1 migration, 2 message strings. **`ZatcaSubmissionController`, ZATCA services/jobs/credentials/ICV/PIH, REM-03b guards, schema and tenant/branch primitives untouched.** |
| Remaining blockers | None for this PR. |

## Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11` (`origin/main` at start; contains REM-03, REM-03b, REM-08) |
| Branch | `fix/security/rem37-zatca-submit-permission` |
| PR | recorded in the PR itself and the hand-back message (**Draft**) |
| Code + tests head | `8620d2ad8c157a5e8e9954415a819e014fb2a7a4` |
| Final Head SHA | recorded in the PR and the hand-back message (a file cannot contain its own commit hash); it adds only this report on top of the code head |
| Merge SHA | N/A |

## Original defect

`routes/api.php` gated the two ZATCA mutation routes with `invoices.manage`:

```
POST invoices/{id}/zatca/submissions                       → invoices.manage + compliance.zatca + throttle:10,1
POST invoices/{id}/zatca/submissions/{attemptId}/dispatch  → invoices.manage + compliance.zatca + throttle:10,1
GET  invoices/{id}/zatca/submissions                       → zatca.view     + compliance.zatca
```

Anyone able to edit invoices could therefore transmit to ZATCA, while `zatca.view` (read) and the write concern were not separable in a custom role. `zatca.submit` did not exist in `Rbac::PERMISSIONS`.

## STOP-condition review (before implementation)

| # | Condition | Result |
|---|---|---|
| 1 | Stored custom roles would lose access without a backfill | **Triggered** → reported; owner chose Option B |
| 2 | A migration is required | **Triggered** → explicitly approved by the owner |
| 3 | `invoices.manage` is intentionally the permanent ZATCA permission | No (routes used it as a placeholder; `zatca.view` already separated reads) |
| 4 | Built-in role mapping ambiguous | No: `accountant` is the only non-wildcard built-in with `invoices.manage` |
| 5/6 | Wildcard or hierarchy change | No: `*` already covers new keys |
| 7 | Second incompatible Role Matrix source | No: `Rbac::PERMISSIONS` feeds `StoreRoleRequest` and `meta.permissions` |
| 8/9 | Machine/internal path bypassing route RBAC | No: `SendZatcaSubmission`/`ZatcaSubmissionDispatcher` are not route-gated |
| 10 | Already implemented elsewhere | No |

## Permission model

| Permission | Meaning |
|---|---|
| `zatca.view` | Read-only ZATCA status and submissions. Unchanged. |
| `zatca.submit` (new) | Create a submission attempt and dispatch it to the queue. Independent of `zatca.view` (a holder without `zatca.view` can submit but not read; a viewer cannot submit). |

- **Wildcard:** `owner`/`admin` are `['*']`; `Rbac::allows()` resolves `zatca.submit` with no special case (test J).
- **Catalogue:** `zatca.submit` added once to `Rbac::PERMISSIONS`, next to `zatca.view`; the Role Matrix groups by first segment (`zatca` → «الفوترة الإلكترونية»). The action label `submit` was added to `hr.perm_actions` (ar «إرسال» / en «Submit») so it is not rendered untranslated. No second permissions file.

### Built-in role mapping

| Role | `invoices.manage` before | `zatca.submit` now |
|---|---|---|
| `owner`, `admin` | via `*` | via `*` (unchanged) |
| `accountant` | yes | **yes** (added to `MATRIX`) |
| `staff` | no | no |
| `self_service` | no | no |

Test H also asserts the derived invariant for every non-wildcard `MATRIX` role: `zatca.submit ⇔ invoices.manage`.

### Existing tenants and custom roles (Option B)

Existing tenants resolve permissions from their **stored** `roles` rows (`Rbac::resolve()`); `MATRIX` is only a fallback when no row exists. Migration `2026_11_08_010000_backfill_zatca_submit_permission_for_invoice_managers.php`:

- appends `zatca.submit` (last) to every stored role, in any tenant, whose explicit permissions contain `invoices.manage`;
- skips roles containing `*`, roles without `invoices.manage`, roles already containing `zatca.submit` (idempotent), and rows whose JSON is not a list;
- writes nothing for rows it does not change (their bytes and `updated_at` are identical);
- iterates and updates **per row by id** — no cross-row or cross-tenant statement; soft-deleted roles are upgraded too so a restore does not lose the capability;
- `down()` is a deliberate no-op: a grant added by this migration cannot be told apart from one an admin added later, and deleting both would revoke a deliberate grant.

It is transition-only. There is **no runtime fallback** from `invoices.manage`: after deploy, removing `zatca.submit` from a role takes effect on the next request even if `invoices.manage` stays (migration test 7, permission test K). Roles created after the migration do not inherit `zatca.submit` from `invoices.manage`.

## Route matrix

| Route | Permission | Entitlement | Other (unchanged) |
|---|---|---|---|
| `GET invoices/{id}/zatca/submissions` | `zatca.view` | `compliance.zatca` | general read/branch policy (`scopeToActiveBranch`), response shape unchanged |
| `POST invoices/{id}/zatca/submissions` | **`zatca.submit`** (was `invoices.manage`) | `compliance.zatca` | `throttle:10,1`; REM-03b Active-Branch-Only; idempotency key |
| `POST invoices/{id}/zatca/submissions/{attemptId}/dispatch` | **`zatca.submit`** (was `invoices.manage`) | `compliance.zatca` | `throttle:10,1`; REM-03b Active-Branch-Only; attempt bound to `invoice_id` + TenantScope |

## Middleware order (characterised, not changed)

Permission **403** → entitlement **403** → controller: wrong active branch / foreign tenant / attempt of another invoice **404**. Proven: a `zatca.submit` holder on an allowed-but-inactive branch gets 404 (not 403); the same holder with `compliance.zatca` disabled gets 403 with no side effects.

## Tenant isolation

Test F: tenant 1's `zatca.submit` holder and its owner (`*`) get 404 on tenant 2's invoice (store), tenant 2's attempt (dispatch, via tenant 2's invoice and via tenant 1's own invoice), and a non-existent id. Tenant 2's attempt and invoice rows and tenant 1's own attempt row are identical afterwards; nothing queued; tenant 2's own submitter still works (a role in one tenant grants nothing in another). Migration test 6 covers per-row isolation of the backfill (same slug in two tenants, different outcomes). No `withoutGlobalScope` was introduced.

## Branch isolation (REM-03b intact)

Test E: A+B user, A active, B invoice → 404 for store and dispatch, with and without `?branch=all`; unrestricted owner with the wrong active branch → 404; restricted user with a spoofed branch header → 404; the correct branch proceeds (202, one job); a branchless legacy invoice behaves as before (accepted). `scopeToCurrentBranchOnly()` was not touched. Attempt binding: test G (attempt of another invoice → 404, row unchanged).

## Side effects on denial

For every denial (A, B, D, E, F, G, K, migration test 7): zero new `zatca_submission_attempts`, no `jobs` row, `Queue::assertNothingPushed()`, `Http::preventStrayRequests()` + `Http::assertNothingSent()`, target invoice row identical (no ZATCA field, ICV/PIH change), and unchanged counts of `journal_entries`, `journal_lines`, `stock_movements`, `payments`, `invoices`. No live ZATCA traffic anywhere; no OTP/CSID operation.

## Tests

`tests/Feature/Rem37ZatcaSubmitPermissionTest.php` (12): A view-only reads/cannot submit or dispatch · B `invoices.manage` alone denied (+ still creates invoices, still reads) · C `zatca.submit` alone passes both gates and does not grant read · D entitlement disabled (+ owner) · E wrong branch · F tenant isolation · G attempt binding · H default roles (+ seeded tenant roles) · accountant allowed / staff denied · I catalogue (exactly once, only `zatca.submit`+`zatca.view` in module, no duplicates, `meta.permissions`, role validation accepts it / rejects a near-miss) · J owner/admin wildcard · K removal of `zatca.submit` with `invoices.manage` kept ⇒ 403.

`tests/Feature/Rem37ZatcaSubmitBackfillMigrationTest.php` (10): the seven required cases (custom role upgraded and appended last; no-`invoices.manage` roles byte-identical incl. look-alike keys; wildcard roles byte-identical incl. `["*","invoices.manage"]`; no duplicates and re-run no-op; unrelated permissions byte- and order-identical; per-row tenant isolation; post-migration removal ⇒ 403 on store and dispatch) plus the stored system accountant, soft-deleted roles, and unreadable JSON.

## SQLite

Local app assembled with the CI copy list into `nibras-app`.

| Command | Result |
|---|---|
| `--filter=Rem37ZatcaSubmitPermissionTest` | 12 passed (198 assertions) |
| `--filter=Rem37ZatcaSubmitBackfillMigrationTest` | 10 passed (59 assertions) |
| focused set¹ | 495 tests: **491 passed, 4 failed** (pre-existing, see below) |
| **full suite** `php artisan test` | **6520 passed**, 73 skipped, **142 failed** (795.9 s). Failing set is **identical** to the known baseline (zero new failures, zero fixed); passed = 6498 + the 22 new tests. |

¹ `Rem37|Rem03|Rem08|Rbac|Role|Zatca|Permission|AccessMatrix|UserManagement|AccessControl|BranchIsolation|DeliveryFinancialRoleGate|SensitiveCostAuthorization|ApiAuthTest|ApiTenantIsolation|TenantApplication` (includes REM-03/03b/08, RoleTest, ApiRbacTest, ZatcaSubmission{Attempt,Dispatcher,Recovery}Test).

## PostgreSQL

PostgreSQL 16 with CI settings (role `nibras`, db `nibras`, `max_locks_per_transaction=1024`), `migrate:fresh`, driver verified `pgsql`.

| Command | Result |
|---|---|
| focused set¹ (incl. both REM-37 classes) | 495 tests: **491 passed, 4 failed** — the same 4 as SQLite |

The migration tests compare raw stored JSON text; `roles.permissions` is a `json` column (text-preserving) on PostgreSQL, so byte-equivalence holds there as well. The **full** PostgreSQL suite is covered by the CI `pgsql` leg on the final head (not run locally: sequential run cost).

## Negative control

Scratch copy (`nibras-app`) only; the PR branch was never modified, files restored and re-verified.

| Variant | Result (22 REM-37 tests) |
|---|---|
| Routes reverted to `origin/main` only | **7 failed**: B (`invoices.manage` alone still reaches submission), C, E, F, G, K, migration test 7; 15 pass |
| Routes + `Rbac` reverted, migration removed | **18 failed**, 4 pass (A, D, accountant, J — behaviour that did not change) |

The core SoD test (**B — `invoices.manage` alone no longer authorises**) fails on the pre-REM-37 routes, as required.

## Existing failures (not caused by this change)

The full run's 142 failures are the same tests that fail on unmodified `main` in this sandbox (Storefront/Product media, R2/attachment storage, document-storage diagnostics, Fuel, one `UserRequestIdempotencyTest` upload case). Causes seen: PHP without `bcmath` (`Call to undefined function App\Services\bcmul()`) and without the AWS SDK (`Class "Aws\Exception\AwsException" not found`); CI installs both. The 4 failures inside the focused set are `FuelSaleApiTest` (bcmul) and 3 storefront-media cases. They were also red, identically, in the REM-08 baseline comparison.

## Web / Role Matrix verification

Only message strings changed (`hr.perm_actions.submit` in `ar.json`/`en.json`). `npx vitest run src/components/hr/role-dialog.test.tsx` → 8 passed; a locale-rendering suite → 4 passed. No RoleDialog code, DS v3 rollout or UI structure was touched; the dialog derives groups/labels from the API catalogue and canonical keys are stored opaquely.

## Files changed

| File | Change |
|---|---|
| `app/Support/Rbac.php` | `zatca.submit` in `PERMISSIONS` and `MATRIX['accountant']` |
| `routes/api.php` | `store` and `dispatch` → `zatca.submit` |
| `database/migrations/2026_11_08_010000_backfill_zatca_submit_permission_for_invoice_managers.php` | owner-approved backfill (new) |
| `tests/Feature/Rem37ZatcaSubmitPermissionTest.php`, `…BackfillMigrationTest.php` | 22 new tests |
| `web/src/messages/ar.json`, `en.json` | `submit` action label |
| `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` | REM-37 status entry |
| `docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md` | §44 concise note |
| `docs/audits/horizon/REM-37-SEC-07-IMPLEMENTATION-REPORT.md` | this report |

## Risks / remaining

1. **Deploy ordering.** The migration must run with the code. Between code and migration, a custom/stored role would lack `zatca.submit` (denied, fail-closed). The migration test (7) documents this as the pre-migration state.
2. **Roles created or edited after the migration** do not get `zatca.submit` automatically; admins must tick it in the Role Matrix. Intentional (SoD), but worth a release note.
3. **Option B carries the old coupling forward once.** Roles that held `invoices.manage` keep the ability to transmit until an admin removes `zatca.submit`; this was the owner's compatibility choice.
4. **`down()` is a no-op** (reasoned above); a rolled-back deploy leaves a harmless extra key in stored roles.
5. Reads (`GET …/zatca/submissions`, `…/zatca`) are intentionally unchanged; the separate observation that `zatca-settings` metadata is visible to `invoices.view` (backlog REM-37 card) is **not** addressed here — out of the approved scope.
6. The REM-08 backlog entry on `main` still reads "IN REVIEW (Draft PR)" although #1415 merged; not edited here to keep this PR to REM-37.

## CI

Recorded in the hand-back message against the exact final head (a file cannot contain its own head's CI result).

## Merge / Deploy

- **Draft**: yes
- **NOT MERGED**
- **NOT DEPLOYED**
- No Railway or GitHub settings changes; no live ZATCA calls; no OTP/CSID operation.

## Next step

Owner review only.
