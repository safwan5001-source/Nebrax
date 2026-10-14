# INT-AUDIT-1 — Scope Gate and Decision Report

STATUS: **RESOLVED — owner decisions received 2026-10-14; implemented in PR #1411** (see `INT-AUDIT-1-IMPLEMENTATION-REPORT.md` on that branch). This document is the scope-gate record as it stood **before** implementation (investigation only; no code, migration, API or test was changed by this PR). Not merged, not deployed.
DATE: 2026-10-14
HORIZON: Integrations Center — Slice 6 (after INT-UX-4, PR #1408, merge `176965d086dd60dbd98208d4f4580da91b9a07b0`)
BASE VERIFIED: `main` @ `176965d086dd60dbd98208d4f4580da91b9a07b0` (equals the stated last merge SHA).
RESULT: the confirmed gap needs **a new database table (a migration)**. The brief forbids database changes without explicit approval, and the Horizon dependency `DP-F` is a *recommendation*, not a recorded owner decision. Per the brief's stop rule, work stops here with a ready-to-approve proposal.

## 1. INT-AUDIT-1 as defined in Horizon

`DLV-INTEGRATIONS-UX-DESIGN-1.md` §11, *"INT-AUDIT-1 — Connection-lifecycle audit (after DP-F)"*:

- **Scope.** Append-only audit table and writers for ingress create / rotate / disable; reader for the activity tab's second log.
- **Depends on.** DP-F.
- **Acceptance.** No secrets/payloads recorded; model rejects update/delete; existing operator events remain valid.
- **Security.** Uuid user columns without FKs; tenant scoped.
- **Tests.** Append-only, completeness per action, isolation.
- **Excludes.** Backfill, provider events.

`DP-F` (same document): one append-only table, written **in the same database transaction** as the operation (audit insert failure ⇒ the operation rolls back), written in the **backend service layer** so direct API calls are covered, rows hold ids / version numbers / reason codes only, model rejects update/delete, **before** any UI or new endpoint that rotates/disables. Catalog in §7.4 (`ingress.created`, `secret.rotated`, `ingress.disabled`, `operator.reassigned` — the last already exists). The Handoff records the same rule (P2: INT-UX-5 hard-depends on INT-AUDIT-1).

**Classification.** This is an **implementation** task (table + writers), not a decision-only or design-only one. It is conflicted with the brief only on two points (§6): it needs a migration, and its prerequisite decision DP-F is not recorded as decided (`INT-READY-1` report: *"Decide DP-C, DP-F before INT-UX-4/5"*; DP-C was decided on 2026-10-13, DP-F was not).

**Difference from the brief's proposed goal.** The brief lists "re-route to a branch if the operation exists and is in Horizon". It does **not** exist: `branch_id` is immutable (`DeliveryConnectorAccount::booted` rejects any change to `platform_key`, `external_store_id`, `delivery_platform_profile_id`, `branch_id`), there is no route for it, and Horizon treats re-homing as a separate, undecided option (`DP-A` option 3). It is therefore **not** in INT-AUDIT-1. What does exist and is called "reassign" is **operator** reassignment, which is already audited.

## 2. Current audit state (evidence from the code at the base SHA)

Management API (all under `delivery_connector.*` + `sales.pos`, `routes/api.php` 898–903; **no web caller** — the Integration Center has no management UI, by design):

| Operation | Route / permission | Service | Who/when recoverable today? | Audited? |
|---|---|---|---|---|
| Create | `POST /delivery-connectors` — `delivery_connector.manage` | `DeliveryConnectorAccountService::create` | Partly: `configured_by` (immutable) + `created_at` on the account row | **No event.** Only the account row itself; fine for "who created", but not an event stream |
| Rotate secret | `POST …/{id}/rotate-secret` — `delivery_connector.manage` | `rotateSecret` (row lock) | **No.** Only the counter `secret_version` increments; nobody is recorded | **No** |
| Disable | `POST …/{id}/disable` — `delivery_connector.manage` | `disable` | **No actor.** `disabled_at` only | **No** |
| Reassign **operator** | `POST …/{id}/reassign` — `delivery_connector.reassign` | `reassign` (row lock) | Yes | **Yes** — `DeliveryConnectorOperatorEvent` (`delivery_connector_operator_events`): tenant, account id, from, to, actor, `created_at`; model rejects update/delete; written in the same transaction; tests exist |
| Re-route to branch | none | — | — | n/a (operation does not exist; mapping immutable) |
| Re-enable | none | — | — | n/a (GAP-4, `DP-A`) |

No generic tenant audit table exists that could carry these events. The repo's pattern is one append-only event table per domain (`TenantApplicationEvent`, `DeliveryConnectorOperatorEvent`, …); `PlatformIntegrationAuditEvent` is platform-administrator-only (no tenant, no connector). So no existing store can hold them **without a new table**.

Isolation and permissions today (already sound, unchanged): `DeliveryConnectorAccount` is tenant-scoped through `BaseModel`; the controller's `visibleAccount()` applies `visibleTo()` (restricted users see only their branches' accounts, never unrouted ones; foreign/other-tenant ids → 404); create's `destinationOrFail` forbids a restricted user from creating an unrouted or foreign-branch account; permissions are owner/admin via `*` plus any custom role explicitly granted `delivery_connector.manage`/`.reassign`. Existing tests (`DeliveryConnectorCoreTest`) cover cross-tenant 404 on rotate, restricted-user 404 on rotate/disable, rotation/disable semantics and operator-event append-only/isolation. Secrets: the resource returns the secret only at create/rotate, never on reads (pinned in INT-UX-4); exception messages are fixed Arabic strings with no secret material; no `Log::` calls in the connector services.

## 3. Gaps and security risks (confirmed, not assumed)

| ID | Gap | Severity | Notes |
|---|---|---|---|
| **A1** | Rotate is unaudited: no actor, no time, no event | **High** | A secret rotation invalidates the previous signing secret immediately (events signed with it start failing), so it is both a security-relevant and an availability-relevant action with no trace of who did it |
| **A2** | Disable is unaudited: no actor | **High** | Disable is irreversible (no re-enable route) and stops all event ingestion for that store; the permanent store-id reservation makes it effectively final |
| **A3** | Create has no event record | Medium | Creator and time are recoverable from the row, but there is no uniform stream and it is not append-only |
| **A4** | `disable()` is not idempotent-aware and takes no row lock | Low | A second disable call returns 200 and **overwrites `disabled_at`** with a later time, losing the original disable time; an audit writer must decide what a repeat call means (see decision D3) |
| **A5** | `rotateSecret()` does not check status | Low (observation) | A disabled account can still be rotated. Not changed here; flagged so the audit catalog records it if it happens |
| **A6** | Legacy history cannot be reconstructed | Accepted | `secret_version > 1` proves rotations of unknown actor and `disabled_at IS NOT NULL` a disable of unknown actor. Horizon **excludes backfill**; this stays unauditable and must be stated honestly in any future UI |
| **A7** | Interim exposure until fixed | Medium | The three actions remain callable through the API by owner/admin (and custom roles granted `delivery_connector.manage`) with no trace. Mitigation already in force: no UI exists, INT-UX-5 is not authorized |

No financial, POS, ZATCA or secret-exposure risk was found in the audit scope; no secret is logged or returned by reads.

## 4. Proposed implementation (for approval — **not started**)

Smallest change that satisfies DP-F and the Horizon acceptance, mirroring `DeliveryConnectorOperatorEvent`:

**Table** `delivery_connector_lifecycle_events` (new migration, additive, no change to existing tables):
`id uuid pk` · `tenant_id` FK tenants (cascade) · `delivery_connector_account_id` uuid (**no FK**, per D2 — see §7a) · `platform_key` string(64) · `event_code` string(32) in {`ingress.created`, `secret.rotated`, `ingress.disabled`} · `actor_user_id uuid` (no FK — survives user deletion) · `branch_id uuid null` (no FK; the account's routing branch at the time, so branch-scoped readers can filter later) · `secret_version_from`/`secret_version_to` unsigned integer null (the same range as the account's `secret_version`; a narrower type would make rotations fail, and roll back, once the counter outgrew it) (versions only) · `created_at` (the only timestamp column). Index `(tenant_id, delivery_connector_account_id, created_at)`.
**Never stored:** secret, `secret_prefix`, any token/credential, request body, headers, IP, user agent, free text. Event code and version numbers only.

**Model** `DeliveryConnectorLifecycleEvent` (`CompanyWide`, `BaseModel`): `public const UPDATED_AT = null` (the table has no `updated_at`, exactly like `DeliveryConnectorOperatorEvent` — omitting it would make every insert fail and, being fail-closed, roll back every operation); `updating`/`deleting` throw `LogicException` (append-only), plus a tenant-forgery guard in `saving` like the account model.

**Writers** (service layer, **inside the existing transaction**, so a failed audit insert rolls the operation back and a failed operation writes nothing). **The actor is an explicit argument**, not read from global auth: `rotateSecret($account, $actor)` and `disable($account, $actor)` (create already receives it), the controller passes `$request->user()` from both actions, and the direct service callers in `DeliveryConnectorCoreTest` are updated:
- `create` → `ingress.created` (version 1) inside the existing `DB::transaction`; the duplicate-store path (`mapping_ambiguous`) throws before commit ⇒ no misleading event.
- `rotateSecret` → `secret.rotated` (from n to n+1) inside the existing locked transaction.
- `disable` → wrap in a locked transaction; write `ingress.disabled` **only on the real configured→disabled transition**.
- `reassign` → unchanged (already audited; `operator.reassigned` stays in its own table, "existing operator events remain valid").

**Out of scope even after approval:** reader endpoint / activity tab (see D4), backfill, any UI, INT-UX-5, INT-MAP-1, re-enable, branch re-home, provider events, any change to events ingestion, POS, finance or RBAC.

**Test plan** (added to the existing `DeliveryConnectorCoreTest` conventions; related tests first, then the full suite on sqlite and pgsql in CI): one event per operation with correct actor/tenant/account/platform/version/time; no event on every failure path (unknown/foreign/other-tenant/branch-restricted 404, invalid store, duplicate store, unauthorized 403, POS app disabled 403); rollback proof (force the audit insert to fail ⇒ the secret/status did **not** change); repeat-disable behavior per D3; append-only (update/delete throw); no secret/prefix/token/request data in any column (scan of the row and of the table schema); tenant isolation (tenant A's events invisible to B; cross-tenant account id → 404, zero events); operator-event table and behavior unchanged; existing ingestion, rotate/disable and operator tests unchanged and green.

## 5. Decisions requested

| # | Decision | Recommendation |
|---|---|---|
| **D1** | **Approve a new additive table and migration** (§4) and record **DP-F as decided** in `DLV-INTEGRATIONS-UX-DESIGN-1.md` | Approve. It is the minimum that satisfies DP-F and acceptance; no existing table changes |
| **D2** | FK on `delivery_connector_account_id`: cascade (as operator events) vs none | Cascade — accounts are never deleted today, and this keeps parity with the existing table. (User ids stay FK-less) |
| **D3** | Repeat `disable` on an already-disabled account | Keep returning 200 (backward compatible), write **no** new event, and **do not overwrite** `disabled_at`. This changes one stored value (the original disable time is preserved instead of overwritten) — a deliberate, tiny behavior fix inside the audited operation. Alternative: keep overwriting and audit nothing for repeats |
| **D4** | Reader endpoint / "configuration changes" log now or later | **Later.** Reading audit rows needs its own permission decision (DP-E: today finance roles must not gain visibility) and an API contract. Writing the events first closes the security gap. **Open ownership gap:** Horizon lists the reader inside INT-AUDIT-1, while INT-UX-6 explicitly *excludes* the configuration-change log — so deferring "with INT-UX-6" would leave the reader with no owning slice. It is therefore recorded as **unowned**, to be assigned by the owner (not decided here) |
| **D5** | Record request id / IP | No. Minimal data; ids and codes only |
| **D6** | Ratify that branch re-route is not part of INT-AUDIT-1 | Yes — the operation does not exist (mapping immutable); audit it when `DP-A` option 3 is decided |

## 6. Why work stopped (the brief's own rules)

1. *"عدم تغيير ... قاعدة البيانات دون موافقة صريحة"* — every storage option needs a new table.
2. *"إذا كانت المهمة تتطلب قرارًا أمنيًا ... توقف واطلب موافقتي"* — DP-F is open, and D3 changes an existing endpoint's stored value.
3. The Horizon scope is an implementation task, but its stated prerequisite decision is not recorded. Starting would have presumed a decision that is the owner's.

## 7. Changed files, tests, build, git

- **Changed files:** this report only (`docs/plans/pos/INT-AUDIT-1-SCOPE-AND-DECISION-REPORT.md`). No code, migration, API, RBAC or test change.
- **Tests / build:** none run — nothing to verify (documentation only). CI on the docs PR is not claimed here.
- **Branch:** `docs/int-audit-1-scope-gate` · **Base:** `main` @ `176965d086dd60dbd98208d4f4580da91b9a07b0` · **PR / head SHA:** reported in the final message (a document cannot embed the hash of its own commit).
- **Status (at the time): BLOCKED — awaiting D1–D6; since resolved (§7a).** Nothing merged, nothing deployed.

## 7a. Owner decisions received (2026-10-14)

| # | Decision | Outcome |
|---|---|---|
| D1 | Approve DP-F and the new table/migration within INT-AUDIT-1 only | **Approved** |
| D2 | Cascade — conditional | **Approved with condition.** Checked: no code path deletes an account today (no route, no soft delete; profile and branch FKs are `restrict`), so the only removal is tenant erasure. Resolution: account and user ids carry **no FK** (no cascade erasing security events, no restrict blocking deletion); tenant FK keeps its cascade. No conflict raised |
| D3 | Idempotent repeated disable | **Approved** (200, original `disabled_at`, no extra event, same response contract) |
| D4 | No new read API | **Approved** |
| D5 | No IP / Request ID | **Approved** |
| D6 | Branch re-route out of scope | **Approved** |

Handling of this PR: it stays **documentation-only** and is kept as the scope-gate record; the code lives in the separate implementation PR so neither duplicates nor conflicts with the other (different files; this PR touches only this document).

## 8. Next step

Done as planned in PR #1411 (backend-only, DP-F recorded as decided). **INT-UX-5 is not started by this** and needs its own assignment; INT-MAP-1 stays blocked.
