# INT-UX-6 / DP-E — Contract & Security Gate

STATUS: **Documentation only — owner decisions D1–D9 recorded as Approved (2026-10-14); awaiting review of the closure.** No production code, test, migration, route, permission or API was changed. Not merged. Not deployed.
DATE: 2026-10-14
TASK: Prepare the contract and security gate for the **configuration-change audit reader** of the AWJ-signed ingress (`INT-UX-6`, audit side only), before any implementation starts.
HORIZON: Integrations Center — INT-UX-6 (after INT-UX-5a–5d, all merged).
INPUTS (as stated in the assignments, 2026-10-14): INT-UX-5a/5b/5c/5d merged (5d merge SHA `24affdc91cbc72524699cb9061eeeb7a940e21c5`); INT-AUDIT-1 merged; **DP-E approved**; the new permission is **`delivery_connector.audit.view`**. **Decision closure:** the owner formally approved **D1–D9** exactly as listed in §6; this revision records them and re-checks the contract against them (§6.2). A revision history is at the end of §9.
NOT STARTED: the reader (backend or UI), INT-ACT-1 (attempts/events API), INT-MAP-1, native provider connect/sync, Backend idempotency for create.

> **D1 closed.** The owner approved a dedicated, read-only permission **`delivery_connector.audit.view`** that grants no management authority. (Earlier revisions of this document noted that the repository did not spell out "option A"; the approved decision below is now the record, and `DLV-INTEGRATIONS-UX-DESIGN-1.md` §DP-E carries it.)

---

## 1. Verified current state (from code at the Base SHA)

### 1.1 Git

| Item | Value |
|---|---|
| Base SHA (`origin/main` at start) | `28c8a20e4a928587315266b515feed091b8f0f33` |
| Contains the 5d merge | `24affdc91cbc72524699cb9061eeeb7a940e21c5` ✅ (ancestor check) |
| Branch | `docs/int-ux-6-contract-security-gate` |

### 1.2 The two audit sources (they are **not** symmetric)

| | `delivery_connector_lifecycle_events` (INT-AUDIT-1) | `delivery_connector_operator_events` (DLV-CONNECTOR-OWNERSHIP-1) |
|---|---|---|
| Migration | `2026_11_08_010000_create_delivery_connector_lifecycle_events_table.php` | `2026_11_03_010000_add_delivery_connector_operated_by.php` |
| Model | `App\Models\DeliveryConnectorLifecycleEvent` (`BaseModel`, **`CompanyWide`**, append-only via model hooks) | `App\Models\DeliveryConnectorOperatorEvent` (`BaseModel`, **`CompanyWide`**, append-only via model hooks) |
| Writer | `DeliveryConnectorAccountService::recordEvent()` — inside the operation's own transaction (`create`, `rotateSecret`, `disable`) | `DeliveryConnectorAccountService::reassign()` — inside its transaction; **no event on a same-operator no-op** |
| Event vocabulary | `event_code` ∈ `ingress.created`, `secret.rotated`, `ingress.disabled` (model `CODES`, validated on save) | none — the table *is* "operator reassigned" (no code column) |
| Tenant | `tenant_id` FK → `tenants` (cascade), forced from `TenantContext` on save, forging refused | `tenant_id` FK → `tenants` (cascade); no model-level forging guard (BaseModel tenant handling only) |
| Account link | `delivery_connector_account_id` uuid, **no FK** | `delivery_connector_account_id` uuid, **FK → accounts, `cascadeOnDelete`** |
| Branch context | **`branch_id` (nullable) = the account's routing branch at event time** (`recordEvent`) | **none** |
| Store context | `platform_key`, `external_store_id` **copied** into the row (intelligible alone) | **none** (needs the account row) |
| People | `actor_user_id` (uuid, required, no FK) | `from_user_id`, `to_user_id`, `actor_user_id` (uuids, no FK) |
| Payload | `secret_version_from` / `secret_version_to` (versions only) | — |
| Time | `created_at` NOT NULL (second precision) | `created_at` **nullable** (set by the model on save) |
| Index | `(tenant_id, delivery_connector_account_id, created_at)` | `(tenant_id, delivery_connector_account_id)` |
| Secret / prefix / token / payload / IP / request id | **never stored** (migration + model docblock + `no_secret_prefix_token_or_request_data_is_ever_stored` test) | never stored |

Pre-existing tests that already pin the write side: `DeliveryConnectorLifecycleAuditTest` (12 tests: one event per operation, no event on failure, rollback, tenant isolation, append-only, no secrets, `events_outlive_a_deleted_account_row`, reassignment keeps its own log) and `DeliveryConnectorCoreTest` (36 tests).

### 1.3 Facts that decide the isolation design

1. **Both event models are `CompanyWide`.** `TenantScope` applies; **no branch scope is applied automatically** (`BranchIsolationGuardTest` records them as a conscious company-wide classification). A reader must apply branch scope **explicitly**.
2. **The visibility rule for connectors today** (`DeliveryConnectorAccount::visibleTo`, list query in `DeliveryConnectorAccountController::index`): an unrestricted user (`allowedBranchIds() === null`) sees everything; a branch-restricted user sees **only accounts whose `branch_id` is in their branches — unrouted accounts (`branch_id = null`) are hidden from them**. The audit reader must not be more permissive than this.
3. **The account's mapping is immutable at the model level** (`saving` refuses a change to `platform_key`, `external_store_id`, `delivery_platform_profile_id`, `branch_id`; `configured_by` is immutable too). There is **no application path that deletes or re-routes an account** (no soft delete; `branch_id` FK is `restrictOnDelete`). Both guarantees live in application code, **not** in the database or in the event rows.
4. **`User` is not a `BaseModel`** (no tenant scope; `SoftDeletes`) — any name lookup must filter `tenant_id` explicitly and decide how to treat soft-deleted users. `Branch` is a `BaseModel`.
5. `reassign()` computes `previous = operated_by ?? configured_by`; a first reassignment therefore records the creator as `from_user_id`. There is **no event for the initial `operated_by` assignment** (creation) other than `ingress.created`.
6. The two existing read paths are `GET /delivery-connectors` (`delivery_connector.view` + `sales.pos`, **unpaginated**, resource includes `secret_prefix`, `configured_by`, `operated_by`) and `GET /delivery-connectors/{id}`. **No audit read route exists**: grep finds no route, controller or resource that reads either event table.

### 1.4 Permissions today

- Registry: `App\Support\Rbac::PERMISSIONS` (`Rbac.php:73` lists `delivery_connector.view`, `.manage`, `.reassign`). It is also the validation source for custom roles (`StoreRoleRequest`: `Rule::in(Rbac::PERMISSIONS)`) and the catalog sent to the role editor (`RoleController` `meta.permissions`).
- `Rbac::MATRIX`: `owner`/`admin` = `['*']`; `accountant` and `staff` contain **no** `delivery_connector.*` (pinned by `DeliveryConnectorCoreTest` lines 76–81); `self_service` only `self_service.access`.
- Stored roles are the source of truth once a tenant has role rows (`Rbac::allows`); system roles are seeded **verbatim** from `MATRIX` (`['*']` for owner/admin). A new key therefore reaches **only** roles holding `*` unless a role is edited explicitly. The grant ceiling (`RoleController::guardGrantCeiling`, `Rbac::covers`) stops an actor granting what they do not hold.
- Precedent for deliberately granting a new permission to existing roles: `REM-37` backfill migration. **Not wanted here** (§3.4).
- Routes: all `delivery-connectors` routes carry `[$perm(...), $app('sales.pos')]` (`routes/api.php:900–905`). `EnsureApplicationActive` lets a **suspended** app through for safe methods (read-only) and rejects a **disabled** app with 403.

### 1.5 Integration Center UI today

- Sidebar entry `/integrations` is gated by **`invoices.view`** with no `appKey` (`sidebar.tsx:333`); the center page (`app/(app)/integrations/page.tsx`) and the shared data hook (`use-delivery-integration-data.ts:77`) deny anyone without `invoices.view` (`DELIVERY_PERMISSION = 'invoices.view'`, `integration-center.ts:41`). The readiness and platform endpoints the center reads are also `invoices.view` + `sales.pos`.
- The signed-ingress panel (INT-UX-4/5) lives on `/integrations/delivery-platforms/[platformKey]`, reads `GET /delivery-connectors` (`delivery_connector.view`), and hosts the 5b/5c/5d actions. It exposes **no audit surface** and the structural guard `no-connection-controls.test.ts` allow-lists the exact endpoints it may read.
- **Consequence:** a user holding only `delivery_connector.audit.view` **cannot reach any Integration Center page today** (no `invoices.view`) — the page-access gap the assignment asks to close (§3.2).
- The role editor derives module/area/action **generically from the key** (`modules/roles/catalog.ts` `parsePermission`: `delivery_connector.audit.view` → module `delivery_connector`, area `audit`, action `view`); sensitive grants are flagged from an explicit map (`modules/roles/risk.ts`), where unknown keys are simply not flagged.

### 1.6 Horizon text to reconcile

`DLV-INTEGRATIONS-UX-DESIGN-1.md` defines `INT-UX-6` as *"Activity & errors tab and error-code dictionary"* (events log from INT-ACT-1 **plus** the configuration-change log), and §5.8 says the two logs are **never merged**. INT-ACT-1 (attempts read API) is **not built**. This gate covers **only the configuration-change (audit) reader**; the attempts log stays under INT-ACT-1 (**D8 approved**). The Horizon text should be re-scoped accordingly when PR-6e closes the work.

---

## 2. Gaps and risks

| # | Finding | Severity | Where handled |
|---|---|---|---|
| **G1** | **Operator events carry no event-time branch or store context.** Their branch scope could only be derived from the *live* account row, and an account-row delete **cascades** and erases them (`cascadeOnDelete`) — unlike lifecycle events, which survive (`events_outlive_a_deleted_account_row`). | **Resolved for new events by approved D2 = A** (snapshot at write, PR-6b0). **Residual:** events written before PR-6b0 have no recorded context (never inferred; hidden from branch-restricted users), and the FK cascade is unchanged (separate future decision). | §4.4, §6 |
| G2 | Both tables are `CompanyWide`: an Eloquent query on them is **not** branch-filtered. A reader that forgets the explicit filter leaks other branches' history to restricted users. | High (by construction) | §4.2, tests T-B* |
| G3 | `GET /delivery-connectors` is unpaginated and returns `secret_prefix`. The audit DTO must not follow that precedent. | Medium (pre-existing; out of scope) | §3.3.2 DTO allow-list |
| G4 | No index serves *tenant-wide, newest-first* listing (`(tenant_id, account_id, created_at)` leads with the account; the operator table has no time column in its index). Correct but may degrade with volume. | Low–Medium | §3.3 (indexes) |
| G5 | `delivery_connector_operator_events.created_at` is **nullable**; a cursor over a nullable sort key is unsafe. | Low | §3.3 (null handling) |
| G6 | `*` holders (owner/admin) receive the permission automatically; there are no deny rules, so an admin can read the audit of their own actions. Inherent to the RBAC model. | Accepted / documented | §3.4 |
| G7 | Users are soft-deleted and ids have no FK: events can reference deleted or unknown users. | Medium | §3.3.2 (person states) |
| G8 | Sort tie-break: timestamps are second-precision and ids are UUIDs; the relative order of two events in the same second is deterministic but **not causal**. | Low | §3.3 ordering |
| G9 | Existing UI allow-list guard (`no-connection-controls.test.ts`) will fail on any new read; it must be extended **deliberately**, not loosened. | Process | §7 PR-6d |
| G10 | The model for operator events lacks the tenant-forging guard the lifecycle model has (asymmetry). Not exploitable today (the only writer takes the tenant from the locked account). | Low | noted; not required for the reader |

---

## 3. Contracts

### 3.1 Permission contract

`delivery_connector.audit.view`

| Rule | Contract |
|---|---|
| Meaning | **Read-only** access to the configuration-change audit of AWJ-signed ingress points (the four event kinds in §3.3). Nothing else. |
| Independence | It does **not** include and is **not** implied by `delivery_connector.view`, `.manage`, `.reassign`, `users.view`, `invoices.view`, `reports.view`, `delivery_hub.*`, or any `pos.audit.*`. None of those grants it, and it grants none of them. |
| `view` alone | A role with `delivery_connector.view` and no `audit.view` gets **403** on the audit endpoint (middleware, before any query). |
| `manage` / `reassign` alone | Same: **403**. Managing or reassigning does not entitle reading history. |
| `audit.view` alone | Allowed to read the audit endpoint and **nothing else** in the delivery-connector API (the connector list/detail, secret-bearing routes, attempts and users stay 403). |
| Application gate (**D4 approved**) | `$app('sales.pos')`, same as its siblings. A *suspended* app keeps it readable (read-only); a *disabled* app returns 403. |
| Role editor | The key appears automatically in the catalog once it is in `Rbac::PERMISSIONS`. It is **not** a write/secret authority, but it reveals *who did what and when* and (per approved D5) user names → classified **`data`** in the editor's risk map (**D6 approved**) so granting it is flagged. |
| Grant ceiling | Unchanged: an actor can grant it only if they hold it (or `*`). |

### 3.2 Page / navigation access contract

| Question | Contract |
|---|---|
| Who sees the entry | Holders of `delivery_connector.audit.view` (checked client-side from the server-computed permission list — convenience only; the API 403 is the authority). Hidden in Demo, as in 5a–5d. |
| Can `audit.view` alone reach the page? | **Yes — approved (D3, P1):** a **dedicated route `/integrations/audit`**, gated by `delivery_connector.audit.view` **only**, whose only network dependency is the audit endpoint (plus the session/navigation calls every page makes). It must **not** import the center's shared data hook (that hook denies without `invoices.view` and reads readiness/platform endpoints the auditor may not hold). |
| Sidebar | A child/secondary entry under the Integrations group gated by `delivery_connector.audit.view` (the existing `/integrations` entry stays `invoices.view`). Because the parent entry is hidden without `invoices.view`, the audit entry must be able to stand on its own (an auditor-only role sees the group with this single entry). |
| Landing page | Users who hold **both** `invoices.view` and `audit.view` also get a quiet link from the Integration Center landing and a filtered deep link (`?platform=<key>`) from the platform detail page. A deep link is a navigation aid, never a precondition. |
| Alternative (P2) — **not adopted (D3)** | Require `invoices.view` **and** `audit.view` and host the log inside the center. Simpler, but it forces granting a broader permission to an auditor and contradicts "audit.view alone must be usable". Not recommended; listed in D3. |
| Server vs client | Absent link ≠ protection. A forged request without the permission gets 403; a request with it but for another tenant/branch gets an empty/filtered result. |
| Stale permission list | The permission list is read at login/refresh (`permission-refresh`); a role change takes effect on refresh. The API is never trusted to the client list. |

### 3.3 API contract (read-only; shaped by the approved D2, D4, D5, D7, D9)

**`GET /api/delivery-connectors/audit-events`**
(registered **before** `delivery-connectors/{id}`; `{id}` is `whereUuid`, so `audit-events` can never match it.)

| Aspect | Contract |
|---|---|
| Method | `GET` only. No write verbs on this path (a test enumerates the router for `delivery-connectors/audit-events*`). |
| Middleware | `auth:sanctum` group as siblings, `$perm('delivery_connector.audit.view')`, `$app('sales.pos')`. |
| Sources | Merges `delivery_connector_lifecycle_events` and `delivery_connector_operator_events` into **one** DTO (§3.3.2). Other event kinds do not exist yet (connect/authorize/map/pause/disconnect have no writers — the UI must say the log is not complete for those, as §5.8 requires). |
| Filters (all optional, all validated) | `event_code[]` ∈ {`ingress.created`,`secret.rotated`,`ingress.disabled`,`operator.reassigned`}; `platform_key` ∈ the central platform registry; `account_id` (uuid); `external_store_id` (exact, ≤191 bytes, no control characters); `branch_id` (uuid); `from` / `to` (ISO-8601 instants, `from ≤ to`); `per_page`; `cursor`. **No free-text search, no client-chosen sort, no total count.** |
| Ordering (stable) | Fixed: `occurred_at DESC, kind DESC, id DESC` where `kind` ∈ {`lifecycle`,`operator`}. Keyset, never offset. Within one second the order is deterministic, **not causal** (documented in the response docs and the UI help). |
| Pagination (**D7 approved**) | Cursor-based. `per_page` default **25**, min 1, max **100** (out of range → 422, not clamped). Response `meta`: `{ per_page, has_more, next_cursor }` (`next_cursor` is opaque, `null` when `has_more=false`). No `total`. |
| Cursor | Opaque base64url of `(occurred_at, kind, id)`. It only encodes a **position**; tenant, branch scope and filters are **always re-applied server-side**, so a forged or replayed cursor cannot widen scope. Malformed/unknown cursor → 422. |
| Merge algorithm (portable SQLite/PostgreSQL) | Two **bounded** queries (one per source), each `ORDER BY created_at DESC, id DESC LIMIT per_page+1` with the keyset predicate for that source (`ts < c.ts OR (ts = c.ts AND (kind < c.kind OR (kind = c.kind AND id < c.id)))` per the global order), then an in-memory merge-and-cut to `per_page`. Cost is bounded at `2 × (per_page+1)` rows per request. (A SQL `UNION ALL` is an acceptable alternative if proven equivalent on both engines.) |
| Null times | An operator event with `created_at = null` sorts **last**, is returned with `occurred_at: null`, and never participates in a cursor tie-break except as the end sentinel. (Not expected in practice; handled defensively.) |
| N+1 control | At most **2 batched lookups per page** after the two page queries: users `whereIn(ids)` (explicit `tenant_id`, `withTrashed`, `select id,name,is_active,deleted_at`) and branches `whereIn(ids)` (`id,name`). **No account lookup**: lifecycle and (new) operator events carry their own platform/store/branch snapshot, and a missing context is **never** reconstructed from the live account (approved D2). No lazy relations in the resource. |
| Unbounded queries / indexes (**D9 approved**) | Impossible: every source query has a tenant predicate, the keyset predicate and `LIMIT`. Indexes suited to newest-first reads are part of PR-6b: additive `(tenant_id, created_at, id)` on both tables, and — to be confirmed by the plan check, not assumed — a branch-aware variant for restricted users on the snapshot column (e.g. `(tenant_id, branch_id, created_at, id)`). **Mandatory evidence:** an `EXPLAIN` of the unrestricted and the branch-restricted page queries on **PostgreSQL** (with representative volume) showing index use and no full tenant-partition sort, recorded in the PR-6b report. Correctness never depends on the index. |

#### 3.3.1 Status codes

| Code | When |
|---|---|
| 200 | Success, including an **empty** page. |
| 401 | Unauthenticated (framework). |
| 403 | Missing `delivery_connector.audit.view`; or `sales.pos` **disabled** for the tenant (suspended ⇒ allowed, read-only). Same generic body as siblings; no hint about data. |
| 404 | The route does not exist for this verb only. **There is no per-event or per-account lookup here, hence no 404-as-oracle.** Filtering by an `account_id` / `branch_id` that is foreign, invisible or non-existent returns **200 with an empty page** — indistinguishable from "no events" (no existence oracle). |
| 422 | Malformed filter, unknown `event_code`/`platform_key`, bad cursor, `per_page` out of 1–100, `from > to`, over-long `external_store_id`. Fixed message keys; never echoing the input back verbatim beyond the field name. |
| 429/5xx | Framework behaviour; the UI treats 5xx/network as a retryable read failure (a read, so retry is safe). |

#### 3.3.2 Response DTO (allow-list serializer; built explicitly, never `toArray()` of a model)

```jsonc
{
  "data": [
    {
      "id": "uuid",                       // event id
      "kind": "lifecycle" | "operator",
      "event_code": "ingress.created" | "secret.rotated" | "ingress.disabled" | "operator.reassigned",
      "occurred_at": "2026-10-14T18:03:00Z" | null,
      "context_recorded": true | false,    // lifecycle: always true; operator: false for events written before PR-6b0
      "platform_key": "keeta" | null,      // snapshot taken at event time; null when context_recorded=false (never inferred)
      "external_store_id": "KTA-…" | null, // same
      "account_id": "uuid",                // opaque reference; never a link to a management action
      "account_available": true | false,   // false when the account row no longer exists
      "branch": { "id": "uuid", "name": "…" | null } | null,   // null ⇒ unrouted at event time (only when context_recorded=true); null+context_recorded=false ⇒ unknown
      "actor": { "id": "uuid", "name": "…" | null, "state": "active"|"inactive"|"deleted"|"unknown" },
      "detail": {
        "secret_version_from": 3 | null,   // lifecycle only
        "secret_version_to": 4 | null,
        "from_operator": { "id": "uuid", "name": "…" | null, "state": "…" } | null, // operator only
        "to_operator":   { "id": "uuid", "name": "…" | null, "state": "…" } | null
      }
    }
  ],
  "meta": { "per_page": 25, "has_more": true, "next_cursor": "opaque" | null }
}
```

- **Never present** (and a test asserts the exact key set plus a forbidden-substring scan of the raw JSON): `secret`, `secret_prefix`, any token, `delivery_connector_accounts.secret*`, raw request payload, headers, IP, request id, email, role, employee link, phone.
- People are rendered as `{id, name, state}` only. **Name only, never email** (same rule as 5d D2). **Approved D5:** a holder of `audit.view` receives these names **without needing `users.view`**; no email, role, employee link, phone or any other user data. `name = null` with `state = unknown` when the row is gone (ids have no FK); `deleted` for a soft-deleted user (name still shown, labelled by the UI); `inactive` for a deactivated user. Accepted consequence: a branch-restricted auditor sees the *names* of actors/operators from events in their scope regardless of those people's own branches.
- `account_id` is returned as a stable reference only; **the audit UI offers no action** on it.
- Events whose account was deleted: lifecycle events still return (snapshot), `account_available=false`. **Operator events are still erased with the account row** (FK cascade is unchanged by D2 and its change is deferred to a separate decision); once erased they are simply absent.
- **`context_recorded=false` operator events** (written before PR-6b0): platform, store and branch are `null`; the row is returned **only to unrestricted users**, never to a branch-restricted user (their scope cannot be proven), and the account id is not used to fill the gaps.
- Events whose actor/user reference is missing: shown with `state=unknown`, never dropped (an audit log must not hide its own gaps).

#### 3.3.3 Explicit non-goals of the API
No export, no write, no delete/redact, no event detail endpoint, no search, **no backfill** (approved D2: no speculative backfill of historical context; any backfill would need its own evidence and approval).

### 3.4 Registry / migration / seeder impact (documented, **not executed**)

| Artifact | Change needed | Notes |
|---|---|---|
| `App\Support\Rbac::PERMISSIONS` | **Add** `delivery_connector.audit.view` next to the other `delivery_connector.*` keys, with the "owner/admin via `*` only; not granted to accountant/staff/self_service" comment. | Only registry. Also makes `StoreRoleRequest` accept it and `RoleController` list it. |
| `Rbac::MATRIX` | **No change.** `accountant`, `staff`, `self_service` must **not** receive it. | Add the assertions next to `DeliveryConnectorCoreTest:76-81`. |
| Migration for roles | **None.** Do **not** copy `REM-37`'s backfill. Stored owner/admin roles already hold `*`; custom roles and system accountant/staff keep their explicit lists and therefore **do not** gain the key. | This is the "no implicit grant to old custom roles" requirement. Granting it to an existing custom role is a deliberate admin action in the role editor. |
| Seeder | **None.** `Rbac::systemRoles()` derives from `MATRIX`, which does not change. | |
| `routes/api.php` | One `GET` route (PR-6b). | |
| Frontend `modules/roles/risk.ts` | Classify the key as `data` (sensitive-grant flag in the editor) — **D6 approved**. | Labels derive from existing module/area/action messages; the area label `audit` already exists in both locales (`hr.perm_areas.audit` — "Audit" / «التدقيق»), so the editor renders it without a message change (the implementation PR re-verifies with the catalog test). |
| Frontend sidebar / messages | New entry + dictionary (PR-6d). | |
| Docs | DP-E (audit-read sub-decision) recorded as approved in `DLV-INTEGRATIONS-UX-DESIGN-1.md` §DP-E (done in this revision; no other decision touched). | |
| Migration — operator-event snapshot (**PR-6b0, D2**) | Additive columns on `delivery_connector_operator_events`: `branch_id` (nullable uuid, no FK), `platform_key`, `external_store_id`, `branch_context_recorded` (boolean default `false`). **No backfill, no FK or index drop.** | Not executed here. |
| Migration — read indexes (**PR-6b, D9**) | Additive time-ordered indexes (`(tenant_id, created_at, id)` and, if the plan check shows it helps, a branch-aware variant) on both event tables. | Not executed here; PostgreSQL EXPLAIN evidence required. |
| Residual (G6) | `*` holders always have it; no deny rule exists; an admin can read the audit of their own actions. | Inherent; documented in the permission description. |

---

## 4. Tenant & branch isolation rules (mandatory acceptance gate)

### 4.1 Tenant binding of each event class

| Event class | How it is bound to the company | Strength |
|---|---|---|
| Lifecycle (`ingress.created`, `secret.rotated`, `ingress.disabled`) | `tenant_id` column, forced from `TenantContext` on save; forging refused; `TenantScope` on every Eloquent read | Strong (own column + model guard + scope) |
| Operator reassignment | `tenant_id` column (FK, cascade) written from the locked account; `TenantScope` on reads; no model-level forging guard | Adequate (own column + scope); weaker model guard (G10) |
| Names / branches / accounts used to enrich rows | `User` is **not** tenant-scoped ⇒ explicit `where tenant_id = <context>` on every user lookup; `Branch` and `DeliveryConnectorAccount` are `BaseModel` (scoped) but the reader still states the tenant predicate explicitly (defence in depth) | Must be enforced + tested |

Answers to the assignment's questions, from the code and the approved D2:

- **Events with `branch_id = null`?** Yes, by design: events of **unrouted** accounts carry `branch_id = null` (lifecycle today; operator events from PR-6b0 on, with `branch_context_recorded = true`). Operator events written **before** PR-6b0 have no branch column value either, but there the `null` means **unknown**, not "unrouted" — distinguished by `branch_context_recorded = false`.
- **How is branch scope enforced on read?** Mirror `visibleTo`: unrestricted user ⇒ no branch predicate; restricted user ⇒ `branch_id ∈ allowed` **and** context recorded; **null-branch events and unrecorded-context events are hidden from restricted users**. Both source queries filter on their own stored `branch_id` (no join to the account).
- **Branch of the point changes after the event?** It cannot today (model-level immutability). Both event tables now hold the **event-time** branch, so a future re-route could not re-attribute history; the reader never consults the live account for scope.
- **Point or user deleted?** *Point:* lifecycle events survive (snapshot of platform/store/branch; `account_available=false`); operator events are **still erased by the FK cascade** (unchanged by D2; changing it needs its own decision). *User:* no FK ⇒ ids remain; the reader shows `state=deleted|unknown` and never drops the row.
- **Can another company's events appear through filters or pagination?** Not by design: every source query has the tenant scope **and** an explicit tenant predicate; the cursor carries position only; filters (`account_id`, `branch_id`, `external_store_id`) intersect with the tenant+branch scope and can only narrow. Proven by tests T-T1…T-T6 (§8) on **SQLite and PostgreSQL before the reader route exists in a merged state**.
- **Must the branch context be frozen at event time for historical accuracy?** Lifecycle: already done. Operator events: **now required and approved** (D2 = A): `branch_id`, `platform_key`, `external_store_id` are recorded inside the reassignment transaction.

### 4.2 Required rules (apply to the whole reader)

1. One service class owns the read; controllers never query the event models directly.
2. Every query: tenant predicate (scope **and** explicit), branch predicate (for restricted users), keyset predicate, `LIMIT`.
3. Branch predicate is applied **in SQL**, never as a post-filter (post-filtering breaks pagination and can leak page boundaries).
4. A restricted user never receives null-branch events, never receives events of branches outside their set, **never receives an event whose scope cannot be proven (`context_recorded = false`)**, and never learns that hidden events exist (no counts; `has_more` is computed **after** the scope is applied).
5. Branch scope is evaluated at **read time** from the user's current branches (identical to the connector list). Losing a branch removes its events from that user's view immediately.
6. Fail closed: a row whose branch context cannot be established is shown only to unrestricted users.
7. **No inference:** missing historical context (platform, store, branch) is never reconstructed from the current account row, from the account's current state, or from any other source, and nothing is backfilled speculatively.

### 4.3 What the data guarantees

| Event class | Historical isolation guaranteed by the row itself? |
|---|---|
| Lifecycle | **Yes** — tenant, branch (event-time), platform and store are in the row; survives account deletion. |
| Operator — written from PR-6b0 on | **Yes (approved D2 = A)** — tenant, branch (event-time), platform and store are recorded in the row inside the reassignment transaction. |
| Operator — written before PR-6b0 | **No, and not inferred.** Tenant yes; branch/store unknown. Shown only to unrestricted users, with `context_recorded=false`; hidden from branch-restricted users. |

### 4.4 D2 — historical context of operator events (**Approved: Option A**)

**Approved decision (owner, 2026-10-14).** Take a historical snapshot of the operator-reassignment context with **additive** columns, **without backfill** and **without changing the FK** in this phase.

**Specification (PR-6b0, to be implemented later — not now):**

1. **Schema (additive only):** on `delivery_connector_operator_events` add nullable `branch_id` (uuid, no FK), `platform_key` (string 32), `external_store_id` (string 191), and `branch_context_recorded` (boolean, `NOT NULL`, default `false`). No existing column, index or FK changes; `cascadeOnDelete` on the account link stays as is.
2. **Writer:** `DeliveryConnectorAccountService::reassign()` sets the four values from the **locked** account row **inside the same transaction** that updates `operated_by` and appends the event (`branch_context_recorded = true`; `branch_id = null` is a recorded "unrouted"). A same-operator no-op still writes no event. If the write fails the whole operation rolls back (same fail-closed rule as lifecycle events).
3. **Evidence rule:** the snapshot is taken from the locked row at event time; it is **never** derived later from the account's current state. Rows written before the migration keep `branch_context_recorded = false` and null context forever (no backfill).
4. **Reader:** uses only the stored values (§4.2); legacy rows are returned to unrestricted users with `context_recorded=false` and hidden from restricted users.
5. **Deferred to a separate decision (not part of this phase):** dropping or changing the account FK / event retention-on-delete policy, and any backfill.
6. **Merge gate:** the reader route must not ship until the tenant-isolation and branch-isolation suites (§8.1 T-T*, T-B*, T-W*) are green on **SQLite and PostgreSQL** in CI.

**Residual risks (accepted by the approved scope, recorded for the owner):**
- Pre-PR-6b0 reassignments are invisible to branch-restricted auditors (and have no context for anyone). The UI must say so (§5).
- Operator events disappear when an account row is deleted (FK cascade unchanged); there is no application path that does this today.
- The immutable-branch rule is enforced by the model only; the new snapshot makes the log independent of it for new events.

---

## 5. UX proposal (read-only audit panel)

**Placement.** A dedicated read-only screen `/integrations/audit` ("Configuration changes" / «سجل تغييرات الإعدادات») inside the Integration Center family (§3.2). Heading + one-line scope note: *"Changes to signed ingress points: creation, secret rotation, disabling and operator reassignment. Connect, authorize, map, pause and disconnect events are not recorded yet."* The panel **never** claims completeness (design §5.8).

**Layout (accounting-grade density, tables are the hero).**

| Viewport | Layout |
|---|---|
| Desktop (≥1024) | Filter bar (event type multi-select, platform, store ID, date range, branch if the user may see several) → dense `DataTable` (time · event · store/platform · branch · actor · detail) → cursor pager ("Newer/Older" style load-more; no page numbers, no total). |
| Mobile (≤640) | Cards, one per event, same fields stacked; filters in a `Sheet`; "Load more" button. |

**Row content.** Event label from a dictionary (unknown code ⇒ neutral fallback + the raw code in LTR); time in the viewer's locale and zone-labelled; store ID in an LTR `bdi`; branch name or "Not routed to a branch"; actor name (or *Deleted user* / *Unknown user* / *Inactive* badge); detail: *Secret v3 → v4*, *Operator: A → B*. People never show email or ids. Deleted account ⇒ muted "point no longer exists" tag.

**States.**

| State | Behaviour |
|---|---|
| Loading | Skeleton rows; filters disabled until first load settles. |
| Empty | "No configuration changes recorded yet." (and, with filters, "No events match these filters." + clear-filters). |
| Forbidden (403) | Neutral "You don't have permission to view this log." — no data, no retry loop; also shown if permission is lost mid-session. |
| Error / network / 5xx | Inline error with **Retry** (a read — retry is safe). Never "no events". Fail-closed like 4/5. |
| Partial data | Rows are never dropped: unknown person → "Unknown user"; missing store/platform → "—"; `occurred_at = null` → "Time unknown"; `context_recorded=false` → "Context was not recorded for this older event". A visible note when any row has partial data. **Branch-restricted users** also see a standing note that reassignments made before context recording started are visible only to users with all-branch access (approved D2: their scope cannot be proven). |
| Stale response | Latest-request-wins guard (filters/cursor changes cancel older responses). |

**Hard rules.** No management action anywhere on the screen (no rotate/disable/reassign/copy-secret; no link to a manage dialog); no secret, prefix, token or payload; no export in v1; Demo mode shows nothing and sends nothing; AR/EN with RTL/LTR logical properties; light/dark with AA contrast; ≥44 px touch targets; the link and the data request both respect `delivery_connector.audit.view` (absent link for non-holders; 403 handled if forged).

---

## 6. Owner decisions — **Approved (2026-10-14)**

### 6.1 Decision record

| # | Decision (as approved by the owner) | Status | Where it lands in this contract |
|---|---|---|---|
| **D1** | Dedicated permission **`delivery_connector.audit.view`**, read-only; it grants **no** management permission. | **Approved** | §3.1, §3.4 |
| **D2** | **Option A** — historical snapshot of operator-reassignment context with **additive** columns; **no backfill**, **no FK change** in this phase. Requirements: record `branch_id`, `platform_key`, `external_store_id` at event time **inside the reassignment transaction**; never infer missing historical context from the current account state without evidence; do not expose old events to a branch-restricted user if their scope cannot be proven; no speculative backfill; any FK / event-deletion-policy change deferred to a separate decision; tenant- and branch-isolation tests on SQLite **and** PostgreSQL before the reader opens. | **Approved** | §4.2–§4.4, §3.3, §7 (PR-6b0), §8 (T-W*, T-L*, T-B3, T-B5, T-F1) |
| **D3** | Dedicated route **`/integrations/audit`** that works with the audit permission alone. | **Approved** | §3.2, §7 (PR-6d) |
| **D4** | `sales.pos` gate: a **suspended** app allows reading, a **disabled** app blocks it. | **Approved** | §3.1, §3.3 (T-P8) |
| **D5** | Show the **names** of people tied to audit events to holders of `audit.view` **without requiring `users.view`**; no email and no extra user data. | **Approved** | §3.3.2, §8 (T-S1, T-T5) |
| **D6** | Classify the permission as **`data`** in the role editor. | **Approved** | §3.1, §3.4, §7 (PR-6d) |
| **D7** | **Cursor pagination**, default page size **25**, maximum **100**. | **Approved** | §3.3 (T-O*) |
| **D8** | INT-UX-6 scope = the **configuration-change log only**; the attempts log belongs to **INT-ACT-1**. | **Approved** | §1.6, §5 scope note |
| **D9** | Indexes suited to time-ordered reads, **with the query plan verified on PostgreSQL**. | **Approved** | §3.3 (indexes), §8 (T-D2) |

No approved decision requires a behaviour change to any existing endpoint.

### 6.2 Compatibility review — approved decisions vs. the contract

Each item was checked against the approved decisions. Where the earlier draft of this document went beyond or against an approved decision, **the contract text was corrected; no decision was changed.**

| # | Finding | Type | Resolution |
|---|---|---|---|
| **C1** | The earlier Option-A text kept a **live-join fallback** for legacy operator events (derive branch/store from the current account row under invariants I1/I2). That contradicts the approved D2 rule *"do not infer missing historical context from the current account state without evidence"* and *"do not expose old events to a restricted user if scope cannot be proven"*. | **Contract corrected (draft only)** | Removed. Legacy events (`branch_context_recorded=false`) carry `null` context, are returned only to unrestricted users and never to branch-restricted users; the reader never joins or looks up the account (§3.3, §4.2 rule 7, §4.4). The "account lookup" in the N+1 budget was dropped. |
| **C2** | Consequence of C1 + "no backfill": **pre-PR-6b0 reassignments are invisible to branch-restricted auditors forever** and have no context for anyone. | **Impact of the approved decision (not a contradiction)** | Accepted by D2; UI must state it (§5); recorded as residual risk (§4.4). Owner may later approve a backfill **only with documented evidence** (separate decision). |
| **C3** | D2 leaves `cascadeOnDelete` on `delivery_connector_operator_events.delivery_connector_account_id`: operator events are still erased with an account row, while lifecycle events survive. | **Residual risk, by decision** | Deferred to a separate decision as approved. No application path deletes an account today. Pinned by a test that documents current behaviour (T-F1) so a future change is deliberate. |
| **C4** | D5 shows person **names** without `users.view`. A **branch-restricted** auditor therefore learns names of actors/operators (who may belong to other branches) for events in the auditor's own scope. | **Accepted consequence of D5** | Documented in §3.3.2; email and all other user data stay excluded; tenant predicate on user lookups is mandatory and tested (T-T5). |
| **C5** | D4 makes the endpoint 403 when `sales.pos` is **disabled**, while the sidebar entry for `/integrations/audit` is gated by permission only (the existing `/integrations` entry has no `appKey`). A user could see the entry and get a forbidden state. | **Implementation detail to settle in PR-6d (not a contradiction)** | The screen already has a neutral forbidden state; PR-6d decides whether to hide the entry when navigation state reports the app **disabled** (keeping it for **suspended**). No contract change. |
| **C6** | D9 requires the **PostgreSQL query plan** to be verified; CI proves correctness on PostgreSQL but not plan quality. | **Process requirement** | PR-6b must attach EXPLAIN evidence for the unrestricted and the branch-restricted page queries (§3.3, T-D2). |
| **C7** | D2's "isolation tests on SQLite and PostgreSQL **before opening the reader**" requires an ordering inside the work, not only a test list. | **Process requirement** | PR-6b is **not mergeable** without T-T*, T-B*, T-W*, T-L* green on both engines; the suites are written first in the PR (test-first commit) and the route is registered last (§7, §8.3). |
| **C8** | The snapshot flag `branch_context_recorded` is a design detail added by this document, not named in D2. | **Design detail within D2 ("additive columns")** | Kept because it is the only evidence-based way to tell "unrouted" (recorded `null`) from "unknown" (legacy `null`). Owner may substitute an equivalent marker without affecting the decision. |

**No technically impactful contradiction remains between the approved decisions and the contract.** C1 was the only place where the contract itself had to change.

---

## 7. Proposed implementation split (independent small PRs, each Draft, each needs its own approval)

| PR | Scope | Depends on | Notes |
|---|---|---|---|
| **PR-6a** Permission registry | `Rbac::PERMISSIONS` += `delivery_connector.audit.view`; tests: not in `MATRIX` for accountant/staff/self_service; role editor/`StoreRoleRequest` accept it; grant-ceiling test; stored custom roles unchanged; **no route** (inert) | D1 ✅ | Backend, ~1 line + tests. No migration/seeder. |
| **PR-6b0** Operator-event context snapshot (**required — D2 = A**) | Additive migration (`branch_id`, `platform_key`, `external_store_id`, `branch_context_recorded` default `false`); `reassign()` writes them from the **locked** account row in the same transaction; **no backfill, no FK change**; tests T-W*, T-L*, T-F1 on SQLite + PostgreSQL | D2 ✅ | Separate so the schema change is reviewed alone. Must merge **before** PR-6b. |
| **PR-6b** Audit reader API | Route + controller + form request + service + resource + time-ordered indexes (D9) + the full backend matrix (§8) on SQLite **and** PostgreSQL + **PostgreSQL EXPLAIN evidence**. Test-first: isolation suites (T-T*, T-B*) land in the first commit; the route is registered last. | PR-6a, PR-6b0, D2–D5, D7, D9 ✅ | Read-only; adds no write path. **Not mergeable** unless the isolation suites are green on both engines (C7). |
| **PR-6c** UI data layer | `lib/connector-audit.ts` (allow-list reader, dictionary, cursor handling), hook with latest-request-wins, permission gate helper, messages AR/EN, extend `no-connection-controls.test.ts` deliberately (one new GET route, zero write verbs, no actions) | PR-6b | No screen yet; pure + hook tests. |
| **PR-6d** Screen + navigation | `/integrations/audit` screen (desktop table / mobile cards, filters, all states), sidebar entry, landing + platform deep links, role-editor risk flag (D6), Playwright AR/EN × light/dark × desktop/mobile | PR-6c, D3 ✅, D6 ✅ | Real clicks; API-intercepted vs real-backend runs labelled separately. |
| **PR-6e** Docs close-out | Closure report and Horizon status; **re-sync the design doc's remaining pointers** that still say the reader is "deferred until the DP-E read permission is approved" (§5.8 item 2, the `INT-UX-6` slice's *Depends on* / *Deferred* lines) — intentionally **not** edited in this revision, which touches only the DP-E record | PR-6d | Docs only. |

Order: 6a → 6b0 → 6b → 6c → 6d → 6e (PR-6b0 is now mandatory). Decisions are closed; **each PR still starts only on its own explicit assignment**, and none is merged or deployed without explicit approval.

---

## 8. Test matrix and acceptance criteria (for the later implementation)

### 8.1 Backend (PHPUnit — SQLite **and** PostgreSQL in CI)

| ID | Scenario | Expected |
|---|---|---|
| T-P1 | Role with **only** `audit.view` | 200 on the audit endpoint; **403** on `GET /delivery-connectors`, `…/{id}`, reassign, rotate, disable, `/users` |
| T-P2 | `delivery_connector.view` **without** `audit.view` | 403 (no query executed) |
| T-P3 | `manage` and/or `reassign` **without** `audit.view` | 403 |
| T-P4 | Owner / admin (`*`) | 200 |
| T-P5 | System `accountant`, `staff`, `self_service` | 403; `Rbac::MATRIX` does not contain the key |
| T-P6 | Custom role created **before** the key existed / stored without it | 403 (no implicit grant); after an explicit grant → 200 |
| T-P7 | Role editor / `StoreRoleRequest` | accepts the key; unknown key still 422; grant ceiling blocks an actor lacking it |
| T-P8 | `sales.pos` enabled / suspended / disabled (**D4**) | 200 / 200 (read-only) / 403 |
| T-T1 | Two tenants, events in both | each tenant sees only its own, in every filter combination |
| T-T2 | Foreign `account_id` / `branch_id` / `external_store_id` filter | **200 empty**, not 404/403/422 (no oracle) |
| T-T3 | Forged / replayed cursor from another tenant | cannot widen scope; malformed ⇒ 422 |
| T-T4 | Pagination across a tenant boundary (interleaved timestamps) | no foreign row on any page; `has_more` unaffected by hidden rows |
| T-T5 | Name/branch enrichment lookups (**D5**) | never return another tenant's name (explicit tenant predicate on `User`, `withTrashed`); a holder of `audit.view` **without** `users.view` still gets names; no email/role/other user field in any response |
| T-T6 | Query-level assertion | every source query carries the tenant predicate (SQL log assertion) |
| T-B1 | Unrestricted user | sees all branches **and** null-branch events |
| T-B2 | Branch-restricted user | only events of their branches; **null-branch events hidden** |
| T-B3 | Restricted user, **new** operator events (context recorded) | scoped by the **stored** `branch_id`; no join to the account; null-branch (recorded unrouted) hidden; other-branch hidden |
| T-B4 | Branch scope changed after events were written | visibility follows the user's **current** branches immediately |
| T-B5 | Account deleted (raw delete) | lifecycle events still returned with `account_available=false` and correct snapshot branch (restricted scoping still correct); operator events are erased by the unchanged cascade (documents current behaviour — see T-F1) |
| T-B6 | Point routed to branch X then (hypothetically) re-routed | lifecycle events keep the snapshot branch (guard test for G1) |
| T-E1 | All four event kinds appear with the right `event_code`, versions and operators | pass |
| T-E2 | No-op same-operator reassign | writes/returns no event |
| T-E3 | Actor/user deleted, soft-deleted, inactive, or id unknown | row kept; `state` correct; no exception |
| T-E4 | Operator event with `created_at = null` | returned last with `occurred_at: null`, cursor safe |
| T-O1 | Ordering | stable `occurred_at DESC, kind DESC, id DESC`; no duplicate/skip across pages while new events are inserted |
| T-O2 | Pagination limits | default 25; `per_page` 1–100; 0/101 ⇒ 422; last page `next_cursor = null` |
| T-O3 | Same-second events from both tables | deterministic order; no loss at page boundaries |
| T-S1 | Response key allow-list | exact key set; **no** `secret`, `secret_prefix`, token, payload, ip, request id, email, role, employee link anywhere in the raw JSON |
| T-S2 | Existing responses | `GET /delivery-connectors` contract unchanged |
| T-N1 | Query count | constant (≤ 2 page queries + ≤ 2 lookups: users, branches) regardless of page size / actors; **no account lookup** (assert query log) |
| T-R1 | Read-only | no non-GET verb exists on `delivery-connectors/audit-events*`; the reader writes nothing (event row counts unchanged) |
| T-D1 | PostgreSQL parity | keyset predicate, null ordering and timestamp equality behave identically to SQLite |
| T-D2 | Query plan (**D9**) | EXPLAIN of the unrestricted and the branch-restricted page queries on **PostgreSQL** (representative volume) attached to the PR-6b report: index used, no full tenant-partition sort |
| T-W1 | Writer (PR-6b0): a reassignment | the operator event stores `branch_id`, `platform_key`, `external_store_id` taken from the **locked** account row, `branch_context_recorded = true`, inside the same transaction |
| T-W2 | Writer: unrouted account | `branch_id = null` with `branch_context_recorded = true` (recorded unrouted) |
| T-W3 | Writer: failure after the snapshot / forced rollback | no `operated_by` change and no event row (fail-closed) |
| T-W4 | Writer: same-operator reassign | still writes **no** event |
| T-W5 | Writer: no secret / prefix / token / request data stored; additive migration only | existing columns, indexes and the account FK unchanged |
| T-L1 | Legacy operator events (rows with `branch_context_recorded = false`) | returned to an unrestricted user with `context_recorded=false` and null platform/store/branch; **hidden from every branch-restricted user** |
| T-L2 | No inference | a legacy row's context is never filled from the current account (assert no account query; mutate the account and re-read: output unchanged) |
| T-L3 | No backfill | the migration touches no existing row (all legacy rows keep `false` and null context) |
| T-F1 | FK / deletion policy (deferred decision) | the account FK on operator events is still `cascadeOnDelete`; a test pins this so any future change is deliberate |

### 8.2 Frontend (Vitest + Playwright)

| Area | Cases |
|---|---|
| Permission UI | audit.view alone shows the entry and the page; view-only / manage / reassign without audit.view: no entry and no request; Owner/Admin and custom roles; Demo: nothing, no request; forged route without the permission shows forbidden and sends no data request |
| States | loading, empty (with/without filters), forbidden, error + retry (read-only), partial data (unknown user, missing store/branch, null time), stale-response guard |
| Safety | no secret/prefix/token in DOM, URL, storage, console; unknown event code ⇒ neutral fallback; no email/id of people; store ID bidi-isolated; **no management action** anywhere (structural guard extended: exactly one new GET route, zero write verbs, no buttons beyond pager/filter/retry/clear) |
| Regression | INT-UX-4 panel, 5a dialogs, 5b rotate/disable, 5c create, 5d reassign: all existing specs unchanged and green |
| Browser | AR/EN × light/dark × desktop (1440) / mobile (390); real clicks and keys; API-intercepted runs **explicitly distinguished** from any real-backend verification; screenshots reviewed |

### 8.3 Acceptance criteria (all must hold)

1. `audit.view` is the only way (besides `*`) to read the audit; no other permission opens it, and it opens nothing else.
2. No implicit grant to any existing non-`*` role; no migration/seeder touches stored roles.
3. A tenant never sees another tenant's events — at the query level and at the API level, including via filters and cursors.
4. A branch-restricted user never sees events of other branches, null-branch events, or events whose scope cannot be proven (legacy operator events); the approved D2 = A snapshot is implemented (inside the reassignment transaction, additive columns, no backfill, no FK change) and proven, including deleted-account and no-inference cases.
5. The DTO matches the allow-list; secrets, prefixes, tokens, payloads, emails and ids-of-people-as-names never appear.
6. Stable ordering and cursor pagination with a hard page cap; bounded queries; no N+1.
7. The reader is strictly read-only; the UI offers no management action.
8. All tests green on SQLite **and** PostgreSQL — the tenant- and branch-isolation suites **before** the reader route is merged; existing INT-UX-4/5 behaviour unchanged; CI green on the final head.
9. PostgreSQL query-plan evidence (D9) attached to the PR-6b report.
10. Names of people are shown to `audit.view` holders without `users.view` (D5), with no email or other user data.

---

## 9. Git state

Branch `docs/int-ux-6-contract-security-gate` · Draft PR #1483 · Base SHA `28c8a20e4a928587315266b515feed091b8f0f33` · final Head SHA: recorded in the PR description (a document cannot name its own commit). Documentation-only.

**Revision history.** *r1 (2026-10-14)* — contract and security gate, decisions proposed. *r2 (2026-10-14)* — owner decisions D1–D9 recorded as **Approved**; §4.4 rewritten to the approved Option A (legacy live-join fallback removed, finding C1); §6 turned into a decision record with a compatibility review; §3.3, §7 and §8 aligned; `DLV-INTEGRATIONS-UX-DESIGN-1.md` §DP-E updated (no other decision touched).

## 10. Next step

Owner review of this closure. The decisions are closed, so the first implementation PR can be assigned: **PR-6a** (permission registry, inert) and then **PR-6b0** (operator-event context snapshot) before **PR-6b** (reader). Nothing is implemented, merged or deployed, and no implementation PR starts until the owner assigns it explicitly.
