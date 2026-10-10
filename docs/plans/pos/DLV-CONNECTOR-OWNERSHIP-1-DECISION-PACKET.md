# DLV-CONNECTOR-OWNERSHIP-1 — Decision Packet

Status: **approved and implemented** (Option B). The owner approved explicit operational reassignment. No merge, deploy, or release.

Thread `PRRT_kwDOS52FT86rGOhy` stays open until the implementation SHA has green CI and the fix is verified on that SHA. Do not resolve it earlier.

PRE_MERGE_REVIEW: **NOT PASS** in this file. Declare PASS only when GitHub CI is green on the exact implementation head and unresolved P1/P2 = 0.

Base before this change: `795c645f1f10b1fa602a9300df2fd2419dc10727` on `safwan5001-source/Nebrax` PR #1287.
CI on that base: success. pull_request run `38080264764` (sqlite 12m19s, pgsql 19m51s) and push run `38080261613`.
That base had 16 review threads resolved and this ownership P2 open.

## Approved outcome

Option B is the decision. There is no synthetic user, no connector-as-actor, and no `withTrashed` creator.

- `configured_by` stays the immutable historical creator.
- Nullable `operated_by` is the current operational actor. Existing rows leave it null and keep using `configured_by`.
- `actor()` uses `operated_by` when set, otherwise `configured_by`. The chosen user must be active, non-deleted, and in the account tenant. An ineligible `operated_by` does not fall back to the creator. `branchFailure` still applies.
- Permission `delivery_connector.reassign` is separate from view and manage. Owner and admin receive it through `*`. Accountant, staff, and self-service do not.
- `POST /api/delivery-connectors/{id}/reassign` with `{ "user_id": "<uuid>" }` sits behind that permission, `EnsureApplicationActive:sales.pos`, and `EnsureActiveSubscription`.
- The target must be active, non-deleted, same-tenant, and eligible for the connector branch. A branchless connector rejects a branch-restricted successor.
- Reassignment does not change store mapping, platform, status, or credentials, and it does not return the secret. A disabled connector may be reassigned and stays disabled.
- The account row is locked first (`lockForUpdate`), then the acting admin and the target are re-read with no user-row lock. Same-target calls do not append a second audit row. Naming the historical creator while `operated_by` is null does append one row.
- Audit table `delivery_connector_operator_events` stores connector id, tenant id, previous operational actor (`operated_by` or else `configured_by`), new actor, acting admin, and `created_at`. User ids are plain uuids, not foreign keys, so a later soft or hard delete does not erase the history. The model rejects update and delete.
- Existing Hub rows keep `created_by`. New Hub rows use the actor selected under the locked account. Reassignment is not credential rotation. If the previous operator may still hold the secret, rotate it in a separate `delivery_connector.manage` call.
- Ineligible current or target actors fail closed. There is no automatic replacement and no grace period.

Rollback: stop calling the route and ignore `operated_by` in `actor()` before dropping anything. Do not drop `delivery_connector_operator_events` after a transfer has been recorded. Existing connectors with a null `operated_by` behave as they did before this column existed.

The sections below are the evidence from the decision pass. They describe the code at `795c645`, before this implementation.

## 1. Current verified state

Connector ingestion is operational only. It does not post invoices, payments, journals, VAT, COGS, stock, or settlement.

The live principal for a signed event is `delivery_connector_accounts.configured_by`. `DeliveryConnectorIngestionService::actor()` loads that user in the account tenant and returns null when the row is missing or `is_active` is false. A null actor returns `422 actor_unavailable` and does not write an attempt, so `event_id` is not burned.

Management routes can still rotate or disable the secret. They authorize the calling administrator (`delivery_connector.manage` plus branch visibility). They do not read `configured_by`. There is no reassignment route and no user-restore route.

## 2. Root cause

`User` uses `SoftDeletes`. `UserController::destroy` calls `$user->delete()` after blocking self-delete and non-owner edits of an owner. The row stays. `deleted_at` is set. `is_active` is not cleared.

`configured_by` is a nullable FK with `nullOnDelete`. Soft delete does not fire that action, so the FK keeps pointing at the deleted user. `User::query()` hides soft-deleted rows, so `actor()` gets null even though the id is still stored.

```442:457:app/Services/DeliveryHub/DeliveryConnectorIngestionService.php
    private function actor(DeliveryConnectorAccount $account): ?User
    {
        if ($account->configured_by === null) {
            return null;
        }

        $user = User::query()
            ->where('tenant_id', $account->tenant_id)
            ->whereKey($account->configured_by)
            ->first();

        if ($user === null || ! $user->is_active) {
            return null;
        }

        return $user;
    }
```

The same null path is used for `is_active = false` without deletion. That fail-closed behavior is intentional for a missing living actor. The defect is that the connector cannot be pointed at another living user, and it cannot be recreated.

`delivery_connector_store_unique` is global on `(platform_key, external_store_id)`. `DeliveryConnectorAccountService::create` turns a unique violation into `409 mapping_ambiguous` ("متجر المزوّد مربوط مسبقاً ولا يُعاد تعيينه."). Disable does not drop the row, so the store id stays reserved.

`UserController` already says employee relink of a soft-deleted user is deferred ("إعادة إتاحة موظفِ مستخدمٍ محذوف تُعالَج لاحقاً."). There is no restore route.

Hub projection still requires a `User`. `DeliveryHubOrderService::intake` and `::transition` take a `User` and store that id in nullable `created_by` / `updated_by`. Branch checks for the connector use that user's `allowedBranchIds()` / `canAccessBranch()`. The provider payload does not choose the tenant or the actor. Application (`sales.pos` enabled) and `PlanGate::subscriptionActive()` run before `actor()` and do not depend on the configurator.

## 3. Existing AWJ patterns

- Tenant authority comes from the account row after a verified signature, then `TenantContext`. A provider `tenant_id` that disagrees is `mapping_mismatch`.
- Branch authority for ingestion is the account's `branch_id` intersected with the living actor's branch scope. A restricted user cannot create an unscoped connector. A restricted reader cannot see another branch's account (`visibleTo`).
- Credential rotation locks the account row and increments `secret_version`. The public ingest path re-verifies the locked secret. Disable is a status flip. Neither path rewrites `configured_by`.
- `delivery_connector.view` and `delivery_connector.manage` are owner/admin via `*`. They are not on accountant, staff, or self-service. They are not a posting permission.
- Audit attribution elsewhere is a real user FK (`actor_id`, `performed_by`, `created_by`). No connector system user, service account, or `actor_kind` exists. The core report already recorded that a synthetic user would be a new actor model.
- Hub `created_by` is nullable at the schema layer, but the service always writes the acting user. Null would mean "no human", and no current reader distinguishes that from a missing attribution.

There is no proven AWJ mechanism that already solves durable connector identity. Option D is "no existing pattern", not a fourth design.

## 4. Options

### Option A — Durable operational principal

A connector-scoped actor that is not the human creator. Two shapes were considered.

A1. Synthetic user row. Rejected. It fabricates a human in `created_by` and violates invariant 6.

A2. The connector account is the actor. `created_by` stays null. The attempt row already names `delivery_connector_account_id`. Branch scope becomes the mapped branch only, not a living user's ACL.

Isolation stays inside the account tenant and mapped branch. Least privilege gets worse: deleting or suspending the configurator no longer stops ingestion, and a later loss of that user's branch access is ignored. Authentication remains HMAC. Audit can be truthful only if `created_by` is null and the attempt is the actor of record. Subscription and application gates can stay in front. Rotation and disable already work. No silent grant to another human. Existing connectors would start ingesting again with no admin action. Schema can avoid a new user, but `DeliveryHubOrderService` must accept a non-user actor without changing manual Hub or POS call sites. That is a real boundary change. Complexity is higher than it looks because every hub write currently assumes a `User` for destination checks and visibility.

### Option B — Explicit ownership reassignment

An authorized administrator chooses another eligible, active user in the same tenant. Until that call, ingestion stays `actor_unavailable` and does not burn `event_id`.

Recommended shape: keep `configured_by` immutable as the historical creator. Add nullable `operated_by` (FK users, `nullOnDelete`). `actor()` uses `operated_by` when set, otherwise `configured_by`. Both must be an active, non-deleted user in the account tenant, and `branchFailure` still applies to that user.

No other user gains access because of the delete. The admin who already passes `visibleTo` and a reassignment permission must name the successor. The successor must be active, same tenant, and able to access the mapped branch (unrestricted if the connector has no branch). `created_by` on new hub rows is that real user. Old hub rows keep the original `created_by`.

Suspension (`is_active = false`) stays fail-closed. Reassignment is allowed so the connector can move without deleting the user and without reactivating them. Application and subscription gates are untouched. Rotation and disable stay as they are and do not require the configurator to exist. Concurrency: reassignment and ingest lock the account row; a signature in flight still re-verifies the secret. Existing rows stay valid with `operated_by` null. Recovery is one explicit call, not a backfill. Schema is one nullable column. API is one new route. No change to manual Hub request bodies.

### Option C — Keep using the soft-deleted creator

`actor()` would use `withTrashed()` and still require `is_active`. Soft delete does not clear `is_active`, so the deleted login would keep authorizing hub writes. `created_by` would name a person who can no longer sign in. That treats a soft-deleted user as an authorized actor, which this pass must not assume. User restore is already deferred and is a user-lifecycle decision, not a connector decision. Rejected.

### Option D — Existing pattern

None. Documented above so it is not an implied selection.

### Comparison

| Question | A2 connector principal | B explicit reassignment | C deleted creator |
|---|---|---|---|
| Tenant isolation | Account tenant. Holds. | Account tenant plus successor `tenant_id` check. Holds. | Holds, but the actor is deleted. |
| Branch isolation | Mapped branch only. Drops the living user ACL. | Successor must pass the current branch check. Holds. | Frozen ACL of a deleted user. |
| Least privilege | Ingestion outlives every human except disable. | No new access until an admin names a successor. | Deleted user keeps the write. |
| AuthN / AuthZ | HMAC unchanged. User gate removed. | HMAC unchanged. Successor is a normal user. | HMAC unchanged. Deleted user is the gate. |
| Audit | Truthful only if `created_by` is null and the attempt names the connector. | New rows name the successor. `configured_by` stays the creator. | Attributes a removed human. Violates invariant 6. |
| After delete | Ingestion continues immediately. | Ingestion stops until reassignment. | Ingestion continues as that user. |
| After suspension | Continues if the principal is not the user. | Stops until reactivation or reassignment. | Stops if `is_active` is still required. |
| App / subscription off | Still rejected first. | Still rejected first. | Still rejected first. |
| Rotation / revoke | Unchanged. | Unchanged. | Unchanged. |
| Concurrency | Must not race with rotate. | Lock the account row in the reassignment transaction. | No new race. |
| Compatibility | Hub service signature changes. | Additive column and route. Manual Hub unchanged. | Behavior change with no schema. |
| Schema / API | Hub actor boundary, or a sentinel user. | `operated_by` plus one route. | None. |
| Migration | Backfill not required if null `created_by` is accepted. | `operated_by` null. No backfill. | None. |
| Recovery | Automatic. Surprising if delete was meant to stop the person. | Explicit. Event ids from the outage can be retried. | Automatic, wrong actor. |
| Complexity / risk | High. New actor model the core report refused. | Low. Matches the current living-user rule. | Low, and unsafe. |

## 5. Security and audit

Invariants and how B meets them:

1. Credentials stay on the tenant/store row. Reassignment does not rotate the secret and does not move `external_store_id`.
2. Provider `tenant_id` remains a claim to check, not authority.
3. Delete does not select a fallback owner, admin, or "any active user".
4. `applicationFailure()` and `subscriptionFailure()` stay before `actor()` and inside the locked transaction.
5. Successor query is `tenant_id = account.tenant_id`. Branch check is the existing `branchFailure`. Cross-tenant ids 404. A restricted successor who cannot see the mapped branch is rejected. An unscoped connector (`branch_id` null) accepts only a successor whose `allowedBranchIds()` is null.
6. No synthetic user. `created_by` is the successor's real id, or stays the original user on rows written before the transfer.
7. `configured_by` is not overwritten. The soft-deleted row remains the historical creator. A reassignment record stores from-user, to-user, actor, and time. If a later hard delete nulls the FK, the audit row must store the uuid even when the FK is gone. Prefer a uuid column that does not cascade away the fact.
8. Rotate and disable stay behind `delivery_connector.manage`, branch `visibleTo`, application, and subscription. Reassignment does not itself rotate. The admin can rotate in a separate call if the old secret should die with the old owner.
9. Existing connectors keep working while `configured_by` is a living active user. Broken ones recover only through the new route.
10. No financial posting.
11. No Invoice, VAT, Journal, COGS, Stock, or Settlement edits.
12. Manual Hub and POS still pass a `User` into the same service. Their routes do not call `actor()`.

Threats B must test: successor in another tenant; successor inactive or soft-deleted; successor restricted away from the branch; caller with `delivery_connector.view` only; caller who cannot `visibleTo` the account; reassignment while `sales.pos` is suspended or the subscription is expired; replay of an event that failed `actor_unavailable` before the transfer; two reassignments racing; ingest in flight with the old actor after the transfer commits.

## 6. Recommended architecture

**Option B.** `operated_by` is the living operational user. `configured_by` is history. There is no automatic successor.

This is the smallest design that keeps the rule already shipped in DLV-CONNECTOR-CORE-1: the provider does not choose the actor, and the actor must be an active user who can see the destination branch. A2 would drop that user ACL. C would authorize a deleted login. A1 would invent a person.

A new permission `delivery_connector.reassign` is required. Do not overload `delivery_connector.manage`. Manage already rotates and disables secrets. Naming the human who will be `created_by` on future hub rows is a separate grant. Owner and admin receive it through `*`. Accountant, staff, and self-service do not. Custom roles get it only when granted.

Schema: one nullable `operated_by` FK, `nullOnDelete`, no backfill. Plus one append-only reassignment table (`delivery_connector_operator_events`: tenant, account, from_user_id, to_user_id, actor_id, created_at). User ids are stored as uuids. If the FK to users is used, `nullOnDelete` must not be the only history. Store the uuid in the event row and do not cascade-delete the event. A nullable FK plus a plain uuid copy is enough. No change to hub order columns.

API: `POST /api/delivery-connectors/{id}/reassign` with `{ "user_id": "<uuid>" }`, behind `delivery_connector.reassign`, `EnsureApplicationActive:sales.pos`, and `EnsureActiveSubscription`. Response does not include the secret. Idempotent if `operated_by` is already that user. 404 if the account is not `visibleTo` the caller. 422 if the successor fails tenant, active, or branch checks. Disabled connectors may be reassigned so a later enable has a living actor; they still do not ingest while disabled.

Recovery: after the creator is soft-deleted, signed events return `actor_unavailable` and do not burn `event_id`. An administrator with the new permission and branch visibility reassigns. The same `event_id` can then succeed. New attempts and new hub rows attribute the successor. The attempt row continues to name the connector account, which is the automated source. The human attribution is the successor, not a fabricated system user. The historical creator remains `configured_by`.

Privilege: the caller cannot assign themselves unless they pass the same successor checks. They cannot assign a user outside the tenant or outside the branch. They do not gain the successor's other permissions. The secret does not move and is not revealed.

## 7. Required owner decision

Approve or reject all of the following before any code:

1. Option B, not A and not C.
2. `configured_by` stays immutable. `operated_by` is the living actor.
3. New permission `delivery_connector.reassign`, not a reuse of `manage`.
4. Ingestion stays down until that call. No fallback owner. No grace window.
5. Suspension is not auto-healed. Reassignment is allowed while the current actor is suspended or deleted.
6. Reassignment does not rotate the secret. Rotation stays a separate manage action.
7. Implementation lands on PR #1287 only after this approval, as a later commit. Do not treat `795c645` as PASS while the P2 is open.

## 8. Minimal implementation scope

Only after the decision in section 7.

Files:

- `database/migrations/*_add_delivery_connector_operated_by.php` (new)
- `app/Models/DeliveryConnectorAccount.php`
- `app/Models/DeliveryConnectorOperatorEvent.php` (new)
- `app/Services/DeliveryHub/DeliveryConnectorAccountService.php` (`reassign`)
- `app/Services/DeliveryHub/DeliveryConnectorIngestionService.php` (`actor()` only)
- `app/Http/Controllers/Api/DeliveryConnectorAccountController.php`
- `app/Http/Requests/ReassignDeliveryConnectorOperatorRequest.php` (new)
- `app/Http/Resources/DeliveryConnectorAccountResource.php` (expose `operated_by`, never the secret)
- `routes/api.php`
- `app/Support/Rbac.php` (permission constant only; not added to accountant/staff)
- `tests/Feature/DeliveryConnectorCoreTest.php`
- this packet's status line, and a short note in `DLV-CONNECTOR-CORE-1-IMPLEMENTATION-REPORT.md`

Not in scope: Hub service signature, manual intake, POS, financial services, provider adapters, user restore, hard delete, secret rotation behavior.

Data: additive nullable column and one append-only table. Existing accounts remain on `configured_by`. Rollback of the app code before the column is read is safe. Rolling back the column after events exist loses the operator history unless the table is kept.

API: one POST. No change to the public ingest body or to hub order JSON except future `created_by` values after a transfer.

Same PR after approval is appropriate. It closes the open P2 of #1287. It is not large enough to require a new product PR. It is large enough that it must not be slipped in before the owner answers section 7. A docs-only commit of this packet also moves the head; do not commit it until that answer, unless the owner asks for the packet on the PR by itself.

## 9. Test matrix

SQLite first, then the CI sqlite and pgsql jobs on the implementation SHA. Local pgsql is not available in this sandbox.

- Creator soft-deleted, no reassignment: `actor_unavailable`, no attempt, no hub row. Same `event_id` succeeds after reassignment.
- Creator `is_active = false`: same stop. Reassignment to another active user resumes ingestion. Reactivation of the original user also resumes it when `operated_by` is still null.
- Successor in another tenant: 422 or 404, `operated_by` unchanged, ingest still stopped.
- Successor soft-deleted or inactive: rejected.
- Successor restricted off the mapped branch: rejected. Restricted caller who cannot `visibleTo` the connector: 404.
- Unscoped connector rejects a branch-restricted successor.
- `delivery_connector.view` cannot reassign. `manage` without `reassign` cannot reassign.
- `sales.pos` disabled or suspended, and expired subscription: reassignment 403, ingest still gated, event id not burned.
- Reassignment does not insert Invoice, Payment, Journal, Stock, CommerceOrder, or DeliveryInvoiceContext, and does not change `status` or `secret_version`.
- Disabled connector can be reassigned and still returns `connector_disabled` on ingest.
- Second reassignment appends a second event. Concurrent reassignments end on one committed user id. In-flight ingest uses the locked account's operator.
- Manual hub intake by a normal user is unchanged.
- Historical `configured_by` equals the original user after reassignment. New hub `created_by` equals the successor. The attempt's `delivery_connector_account_id` is the connector.

## 10. Risks and rollback

- Operators may expect delete to stop the integration. B does stop it until a person is named. Document that in the admin response. A2 would not stop it.
- If the only unrestricted user is the deleted creator, an unscoped connector cannot be reassigned until another unrestricted user exists. That is fail-closed, not an automatic promotion of a branch-restricted user.
- `nullOnDelete` on `operated_by` can clear the living pointer if that user is later hard-deleted. Ingestion stops again. The event table must still show who was assigned.
- Reassignment does not revoke the old secret. A deleted configurator who copied the secret can still sign. The recovery runbook is reassign, then rotate, if the secret may have left with that person. The packet does not fold those into one call, so a partial failure cannot rotate by accident.
- Rollback: stop calling the route, ignore `operated_by` in `actor()`, leave the column. Do not drop the event table if any transfer was made.

## 11. Impact on PR #1287

`795c645` is unchanged by this packet. CI evidence for that SHA stands. The ownership P2 stays unresolved. PRE_MERGE_REVIEW remains NOT PASS. Sixteen resolved threads stay resolved. No production release is authorized.

## 12. Next execution step

Wait for an explicit owner answer to section 7. Do not implement B, do not resolve `PRRT_kwDOS52FT86rGOhy`, and do not declare PRE_MERGE_REVIEW: PASS. After approval, implement the scope in section 8 on PR #1287, run the matrix, and only then resolve the thread if CI is green on that later SHA and no new P1/P2 is open.
