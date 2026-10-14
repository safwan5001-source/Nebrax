# INT-AUDIT-1 — Implementation Report

STATUS: PR open for review. Not merged. Not deployed.
DATE: 2026-10-14
TASK: Append-only lifecycle audit for AWJ-signed ingress create / rotate-secret / disable (backend only)
HORIZON: Integrations Center — Slice 6 (after INT-UX-4, PR #1408, merge `176965d086dd60dbd98208d4f4580da91b9a07b0`)
APPROVAL: DP-F approved and D1–D6 decided by the owner on 2026-10-14 (recorded in `DLV-INTEGRATIONS-UX-DESIGN-1.md` under DP-F).
NOT STARTED: INT-UX-5, INT-MAP-1.

## 1. INT-AUDIT-1 as defined in Horizon

*Append-only audit table and writers for ingress create / rotate / disable; reader for the activity tab's second log. Depends on DP-F. Acceptance: no secrets/payloads recorded; model rejects update/delete; existing operator events remain valid. Security: uuid user columns without FKs; tenant scoped. Tests: append-only, completeness per action, isolation. Excludes: backfill, provider events.* The reader is **not** built (owner decision D4). The scope-gate record is in `INT-AUDIT-1-SCOPE-AND-DECISION-REPORT.md` (PR #1409).

## 2. Audit state: before → after

| Operation | Before | After |
|---|---|---|
| Create ingress | row only (`configured_by`, `created_at`) | + `ingress.created` event |
| Rotate secret | **unaudited** (counter only) | + `secret.rotated` event (version n → n+1) |
| Disable | **unaudited**; repeat call overwrote `disabled_at` | + `ingress.disabled` event on the real transition only; repeat is idempotent |
| Reassign operator | audited (`delivery_connector_operator_events`) | **unchanged** (no duplicate lifecycle event) |
| Re-route to branch | operation does not exist (mapping immutable) | out of scope (D6) |

## 3. What was implemented

- **Migration** `2026_11_08_010000_create_delivery_connector_lifecycle_events_table` (additive; no existing table changed): `id`, `tenant_id` (FK, cascade), `delivery_connector_account_id` and `actor_user_id` (uuid, **no FK**), `platform_key`, `external_store_id`, `event_code`, `branch_id` (uuid, nullable, no FK), `secret_version_from`/`_to`, `created_at`; one index.
- **Model** `DeliveryConnectorLifecycleEvent` (`CompanyWide`): `update`/`delete` throw; `saving` rejects a forged tenant, an unknown event code, or a missing actor.
- **Service** `DeliveryConnectorAccountService`: the event is written **inside the operation's own transaction, before the account is modified** — an audit failure rolls the whole operation back and the new secret is never bound to any failing statement; a failed operation leaves no event. `disable` now takes the row lock and returns early when already disabled (200, original `disabled_at` kept, no event). `assertActor` refuses an actor from another tenant.
- **Signatures:** `rotateSecret($account, $actor)` and `disable($account, $actor)` — the actor is mandatory so no caller can act without leaving a trace. The controller passes `$request->user()`; two existing test call sites were updated.
- **Docs:** DP-F decision record, GAP-3 and the INT-AUDIT-1 slice header in the Horizon design.

## 4. D2 — deletion policy check (conditional approval)

Checked before choosing the key design: **no code path deletes a connector account** (no route, no service method, no soft deletes); the profile and branch FKs are `restrict`; the only way a row disappears is tenant erasure. Options: *cascade* from the account would erase the security events with the row; *restrict* would block tenant erasure (Postgres RESTRICT is immediate) and any future legitimate deletion. **Resolution: account and user ids have no foreign key**, and `platform_key` + `external_store_id` are copied into the event so it stays intelligible alone. The tenant FK keeps its cascade (erasing a tenant erases all its data, as in every other table). No conflict required escalation. A test proves events survive deleting the account row.

## 5. Metadata recorded — and not recorded

Recorded: tenant, actor user id, account id, platform key, provider store id, event code, account's routing branch at that time, secret version before/after, timestamp.
**Never recorded:** the secret, `secret_prefix`, any token/credential, request body/headers, IP, Request ID, user agent, free text. A test pins the exact column list and scans every row for the plaintext secrets, their 14-character prefixes, `dsec_`, a sent `X-Request-Id`, a sent `User-Agent`, and `127.0.0.1`.

## 6. Tests and results

New file `tests/Feature/DeliveryConnectorLifecycleAuditTest.php` — 12 tests, 181 assertions:

| Test | Proves |
|---|---|
| create writes one safe event | actor, tenant, account, platform, store, branch, versions (null → 1), timestamp; no operator event |
| rotate writes one event per rotation | versions 1→2, 2→3; **the real actor** (a second admin) is recorded |
| disable + repeat | one event; repeat → 200, same response keys, same `disabled_at` (clock advanced 5 min), still one event |
| failed/rejected operations write no events | duplicate store 409, blank store 422, unknown profile 404, unknown account 404, accountant/staff/self_service 403, branch-restricted user 404/422, POS app `disabled` and `suspended` 403 — event count and account unchanged |
| audit write failure rolls back (real DB failure: table dropped) | create/rotate/disable → 500, no new account, account row byte-identical (ciphertext, version, prefix, status), no `dsec_` in any response |
| audit listener failure rolls back | rotate and disable → 500, account row unchanged, event count unchanged |
| tenant isolation | foreign-tenant rotate/disable → 404 and no event; model reads scoped to the tenant context; a foreign actor is refused by the service |
| append-only + validation | update/delete throw; unknown code, missing actor, forged tenant rejected |
| no secret/prefix/token/request data | exact column list; row scan for every sensitive needle |
| events outlive a deleted account row | D2 behavior |
| operator reassignment unchanged | writes its own event only |
| response contract unchanged | exact key set for create/rotate/disable; secret only at create/rotate |

Mutation checks (temporary, in the local app copy, then restored): removing the idempotent early return fails the disable test; swallowing audit failures fails both rollback tests.

Local results (this environment has a full Laravel app with SQLite and PostgreSQL 16):
- New 12 + existing `DeliveryConnectorCoreTest` 36 (which includes the INT-UX-4 list-gate test, now run for the first time): **48/48 on SQLite, 48/48 on PostgreSQL 16.**
- Broader pgsql run (`Delivery|BranchIsolationGuard|TenantIsolation|ApplicationCatalog`): 406 passed, 13 failed. The 13 are **unrelated and environmental**: `bcmul()` is undefined (bcmath is not installed here; CI installs it — fuel cost-basis tests) and storefront media tests. None touches the connector, branch-isolation or tenant-isolation code. CI (below) is the authority for the full suites.
- Correction of an earlier statement: the INT-UX-4 report said a PHP backend could not be run locally. That was wrong — `/home/user/nibras-app` provides one; the INT-UX-4 PHP test was run here for the first time and passes.

## 7. Build and CI (observed on the exact code head)

Code head `f9fe268f709e80697739e702bc13cdd8628bdf08` — check runs read via the API after completion:

| Check | Result |
|---|---|
| `php artisan test (L11, sqlite)` | success |
| `php artisan test (L11, pgsql)` | success |
| `CI Gate` | success |

Codex automated review on that head: completed, no findings, no review threads. This report is committed after that observation; CI on the report commit itself is reported in the PR/final message, not here (a document cannot embed the result of the run it triggers). PR `mergeable_state: clean` at the time of reading; `main` had advanced to `a94e15b870a739bc79abbac72f135f040aee64b2` from an unrelated merge, with no conflict.

## 8. Risks and remaining work

- **Append-only is enforced at the model layer**, as for every existing event table. A raw query-builder delete/update (or a DBA) bypasses it. A database trigger would harden it; that is a separate decision.
- **Tenant erasure removes the audit rows** (FK cascade) — consistent with the rest of the schema, but it means audit history does not outlive a tenant.
- **No reader yet** (D4): the events are written and queryable by the database/support only; surfacing them needs its own permission/contract decision (DP-E). **Ownership gap:** Horizon puts the reader in INT-AUDIT-1 while INT-UX-6 *excludes* the configuration-change log (it waits on this reader), so after D4 the reader has **no owning slice** — the owner must assign one; INT-AUDIT-1 as delivered is the table and writers only.
- **No backfill** (Horizon exclusion): history before this change cannot be reconstructed (`secret_version > 1` and `disabled_at` prove rotations/disables of unknown actor). Any future UI must say so.
- **Observation, not changed:** `rotateSecret` does not check status, so a *disabled* account can still be rotated (now audited when it happens). Disable stays irreversible (no re-enable route).
- **Rollout:** the migration is additive and runs on deploy; the change touches only the three management endpoints, not ingestion, POS or finance. Deploy needs its own approval.
- Deleted-user actors keep their uuid in events (no FK), by design.

## 9. Changed files

| File | Change |
|---|---|
| `database/migrations/2026_11_08_010000_create_delivery_connector_lifecycle_events_table.php` | new |
| `app/Models/DeliveryConnectorLifecycleEvent.php` | new |
| `app/Services/DeliveryHub/DeliveryConnectorAccountService.php` | writers, idempotent disable, actor guard |
| `app/Http/Controllers/Api/DeliveryConnectorAccountController.php` | pass the authenticated user |
| `tests/Feature/DeliveryConnectorLifecycleAuditTest.php` | new (12 tests) |
| `tests/Feature/DeliveryConnectorCoreTest.php` | two call sites pass an actor |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | DP-F decision, GAP-3, slice header |
| `docs/plans/pos/INT-AUDIT-1-IMPLEMENTATION-REPORT.md` | this report |

No route, API contract, RBAC, frontend, financial, POS or ingestion change.

## 10. Relationship to PR #1409

#1409 stays a **documentation-only** scope-gate record (one file, no conflict with this PR); it was updated to "RESOLVED" with the owner's decisions and points here. It can be merged or closed independently.

## 11. Git state

- Branch: `feat/int-audit-1-connector-lifecycle-audit`
- PR: #1411 · Base: `main` @ `176965d086dd60dbd98208d4f4580da91b9a07b0` at branching (GitHub now shows `a94e15b8…`) · Code head: `f9fe268f709e80697739e702bc13cdd8628bdf08` (report commit follows it).

## 12. PRE_MERGE status

Code: CI green on the code head, automated review without findings, no conflict. **Pending: owner review.** Nothing merged, nothing deployed.

## 13. Decisions needed / next step

Review of #1411 (and #1409). Optional follow-ups, each needing its own assignment: a DB-level append-only trigger; assigning an owning slice to the deferred audit reader (after a permission decision; INT-UX-6 excludes it); a decision on rotating a disabled account (A5). **INT-UX-5 is not started and needs a separate assignment**; INT-MAP-1 remains blocked.
