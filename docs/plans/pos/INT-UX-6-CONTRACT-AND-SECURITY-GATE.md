# INT-UX-6 / DP-E — Contract & Security Gate

STATUS: **Documentation only — awaiting owner review.** No production code, test, migration, route, permission or API was changed. Not merged. Not deployed.
DATE: 2026-10-14
TASK: Prepare the contract and security gate for the **configuration-change audit reader** of the AWJ-signed ingress (`INT-UX-6`, audit side only), before any implementation starts.
HORIZON: Integrations Center — INT-UX-6 (after INT-UX-5a–5d, all merged).
INPUTS (as stated in the assignment, 2026-10-14): INT-UX-5a/5b/5c/5d merged (5d merge SHA `24affdc91cbc72524699cb9061eeeb7a940e21c5`); INT-AUDIT-1 merged; **DP-E approved, option A**; the new permission is **`delivery_connector.audit.view`**.
NOT STARTED: the reader (backend or UI), INT-ACT-1 (attempts/events API), INT-MAP-1, native provider connect/sync, Backend idempotency for create.

> **Wording check needed (D1).** The repository does not contain the text of "DP-E option A" for the audit-read sub-decision: `DLV-INTEGRATIONS-UX-DESIGN-1.md` §DP-E still records it as *"not yet made"* (the other "Option A" in `DELIVERY-DECISION-PASS-1-REPORT.md` is DG-1, unrelated). This document takes the assignment at its word — **a dedicated, read-only permission `delivery_connector.audit.view`** — and asks the owner to confirm that is what "option A" means so the decision record can be written exactly (see §6, D1).

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
- **Consequence:** a user holding only `delivery_connector.audit.view` **cannot reach any Integration Center page today** (no `invoices.view`) — the page-access gap the assignment asks to close (§3.3).
- The role editor derives module/area/action **generically from the key** (`modules/roles/catalog.ts` `parsePermission`: `delivery_connector.audit.view` → module `delivery_connector`, area `audit`, action `view`); sensitive grants are flagged from an explicit map (`modules/roles/risk.ts`), where unknown keys are simply not flagged.

### 1.6 Horizon text to reconcile

`DLV-INTEGRATIONS-UX-DESIGN-1.md` defines `INT-UX-6` as *"Activity & errors tab and error-code dictionary"* (events log from INT-ACT-1 **plus** the configuration-change log), and §5.8 says the two logs are **never merged**. INT-ACT-1 (attempts read API) is **not built**. This gate covers **only the configuration-change (audit) reader**; the attempts log stays blocked on INT-ACT-1 (D8).

---

## 2. Gaps and risks

| # | Finding | Severity | Where handled |
|---|---|---|---|
| **G1** | **Operator events carry no event-time branch or store context.** Their branch scope can only be derived from the *live* account row, and an account-row delete **cascades** and erases them (`cascadeOnDelete`) — unlike lifecycle events, which survive (`events_outlive_a_deleted_account_row`). Today this is accurate only because of two invariants held by application code (immutable `branch_id`, no delete path). | **Decision gate — BLOCKER-1** | §4.4, D2 |
| G2 | Both tables are `CompanyWide`: an Eloquent query on them is **not** branch-filtered. A reader that forgets the explicit filter leaks other branches' history to restricted users. | High (by construction) | §4.2, tests T-B* |
| G3 | `GET /delivery-connectors` is unpaginated and returns `secret_prefix`. The audit DTO must not follow that precedent. | Medium (pre-existing; out of scope) | §3.2 DTO allow-list |
| G4 | No index serves *tenant-wide, newest-first* listing (`(tenant_id, account_id, created_at)` leads with the account; the operator table has no time column in its index). Correct but may degrade with volume. | Low–Medium | §3.2 (index recommendation) |
| G5 | `delivery_connector_operator_events.created_at` is **nullable**; a cursor over a nullable sort key is unsafe. | Low | §3.2 (null handling) |
| G6 | `*` holders (owner/admin) receive the permission automatically; there are no deny rules, so an admin can read the audit of their own actions. Inherent to the RBAC model. | Accepted / documented | §3.4 |
| G7 | Users are soft-deleted and ids have no FK: events can reference deleted or unknown users. | Medium | §3.2 (person states) |
| G8 | Sort tie-break: timestamps are second-precision and ids are UUIDs; the relative order of two events in the same second is deterministic but **not causal**. | Low | §3.2 ordering |
| G9 | Existing UI allow-list guard (`no-connection-controls.test.ts`) will fail on any new read; it must be extended **deliberately**, not loosened. | Process | §7 PR-6d |
| G10 | The model for operator events lacks the tenant-forging guard the lifecycle model has (asymmetry). Not exploitable today (the only writer takes the tenant from the locked account). | Low | noted; not required for the reader |

---

## 3. Contracts

### 3.1 Permission contract

`delivery_connector.audit.view`

| Rule | Contract |
|---|---|
| Meaning | **Read-only** access to the configuration-change audit of AWJ-signed ingress points (the four event kinds in §3.2). Nothing else. |
| Independence | It does **not** include and is **not** implied by `delivery_connector.view`, `.manage`, `.reassign`, `users.view`, `invoices.view`, `reports.view`, `delivery_hub.*`, or any `pos.audit.*`. None of those grants it, and it grants none of them. |
| `view` alone | A role with `delivery_connector.view` and no `audit.view` gets **403** on the audit endpoint (middleware, before any query). |
| `manage` / `reassign` alone | Same: **403**. Managing or reassigning does not entitle reading history. |
| `audit.view` alone | Allowed to read the audit endpoint and **nothing else** in the delivery-connector API (the connector list/detail, secret-bearing routes, attempts and users stay 403). |
| Application gate | Same as its siblings: `$app('sales.pos')`. A *suspended* app keeps it readable (read-only), a *disabled* app returns 403 (D4). |
| Role editor | The key appears automatically in the catalog once it is in `Rbac::PERMISSIONS`. It is **not** a write/secret authority, but it reveals *who did what and when* and (per D5) user names → classify as `data` in the editor's risk map so granting it is flagged. |
| Grant ceiling | Unchanged: an actor can grant it only if they hold it (or `*`). |

### 3.2 Page / navigation access contract

| Question | Contract |
|---|---|
| Who sees the entry | Holders of `delivery_connector.audit.view` (checked client-side from the server-computed permission list — convenience only; the API 403 is the authority). Hidden in Demo, as in 5a–5d. |
| Can `audit.view` alone reach the page? | **Yes — recommended (P1):** a **dedicated route `/integrations/audit`**, gated by `delivery_connector.audit.view` **only**, whose only network dependency is the audit endpoint (plus the session/navigation calls every page makes). It must **not** import the center's shared data hook (that hook denies without `invoices.view` and reads readiness/platform endpoints the auditor may not hold). |
| Sidebar | A child/secondary entry under the Integrations group gated by `delivery_connector.audit.view` (the existing `/integrations` entry stays `invoices.view`). Because the parent entry is hidden without `invoices.view`, the audit entry must be able to stand on its own (an auditor-only role sees the group with this single entry). |
| Landing page | Users who hold **both** `invoices.view` and `audit.view` also get a quiet link from the Integration Center landing and a filtered deep link (`?platform=<key>`) from the platform detail page. A deep link is a navigation aid, never a precondition. |
| Alternative (P2) | Require `invoices.view` **and** `audit.view` and host the log inside the center. Simpler, but it forces granting a broader permission to an auditor and contradicts "audit.view alone must be usable". Not recommended; listed in D3. |
| Server vs client | Absent link ≠ protection. A forged request without the permission gets 403; a request with it but for another tenant/branch gets an empty/filtered result. |
| Stale permission list | The permission list is read at login/refresh (`permission-refresh`); a role change takes effect on refresh. The API is never trusted to the client list. |

### 3.3 API contract (read-only, proposed)

**`GET /api/delivery-connectors/audit-events`**
(registered **before** `delivery-connectors/{id}`; `{id}` is `whereUuid`, so `audit-events` can never match it.)

| Aspect | Contract |
|---|---|
| Method | `GET` only. No write verbs on this path (a test enumerates the router for `delivery-connectors/audit-events*`). |
| Middleware | `auth:sanctum` group as siblings, `$perm('delivery_connector.audit.view')`, `$app('sales.pos')`. |
| Sources | Merges `delivery_connector_lifecycle_events` and `delivery_connector_operator_events` into **one** DTO (§3.3.2). Other event kinds do not exist yet (connect/authorize/map/pause/disconnect have no writers — the UI must say the log is not complete for those, as §5.8 requires). |
| Filters (all optional, all validated) | `event_code[]` ∈ {`ingress.created`,`secret.rotated`,`ingress.disabled`,`operator.reassigned`}; `platform_key` ∈ the central platform registry; `account_id` (uuid); `external_store_id` (exact, ≤191 bytes, no control characters); `branch_id` (uuid); `from` / `to` (ISO-8601 instants, `from ≤ to`); `per_page`; `cursor`. **No free-text search, no client-chosen sort, no total count.** |
| Ordering (stable) | Fixed: `occurred_at DESC, kind DESC, id DESC` where `kind` ∈ {`lifecycle`,`operator`}. Keyset, never offset. Within one second the order is deterministic, **not causal** (documented in the response docs and the UI help). |
| Pagination | Cursor-based. `per_page` default **25**, min 1, max **100** (out of range → 422, not clamped). Response `meta`: `{ per_page, has_more, next_cursor }` (`next_cursor` is opaque, `null` when `has_more=false`). No `total`. |
| Cursor | Opaque base64url of `(occurred_at, kind, id)`. It only encodes a **position**; tenant, branch scope and filters are **always re-applied server-side**, so a forged or replayed cursor cannot widen scope. Malformed/unknown cursor → 422. |
| Merge algorithm (portable SQLite/PostgreSQL) | Two **bounded** queries (one per source), each `ORDER BY created_at DESC, id DESC LIMIT per_page+1` with the keyset predicate for that source (`ts < c.ts OR (ts = c.ts AND (kind < c.kind OR (kind = c.kind AND id < c.id)))` per the global order), then an in-memory merge-and-cut to `per_page`. Cost is bounded at `2 × (per_page+1)` rows per request. (A SQL `UNION ALL` is an acceptable alternative if proven equivalent on both engines.) |
| Null times | An operator event with `created_at = null` sorts **last**, is returned with `occurred_at: null`, and never participates in a cursor tie-break except as the end sentinel. (Not expected in practice; handled defensively.) |
| N+1 control | At most **3 batched lookups per page** after the two page queries: users `whereIn(ids)` (explicit `tenant_id`, `withTrashed`, `select id,name,is_active,deleted_at`), branches `whereIn(ids)` (`id,name`), and — operator events only, if the account context is not snapshotted (D2) — accounts `whereIn(ids)` (`id,platform_key,external_store_id,branch_id`). No lazy relations in the resource. |
| Unbounded queries | Impossible: every source query has a tenant predicate, the keyset predicate and `LIMIT`. Index recommendation: additive `(tenant_id, created_at, id)` on both tables so the newest-first tenant-wide scan is index-served (PR-6b, with an EXPLAIN check on PostgreSQL; correctness does not depend on it). |

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
      "platform_key": "keeta" | null,      // lifecycle: snapshot; operator: see D2
      "external_store_id": "KTA-…" | null, // same
      "account_id": "uuid",                // opaque reference; never a link to a management action
      "account_available": true | false,   // false when the account row no longer exists
      "branch": { "id": "uuid", "name": "…" | null } | null,   // null ⇒ unrouted at event time
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
- People are rendered as `{id, name, state}` only. **Name only, never email** (same rule as 5d D2). `name = null` with `state = unknown` when the row is gone (ids have no FK); `deleted` for a soft-deleted user (name still shown, labelled by the UI); `inactive` for a deactivated user. Whether the server may resolve names for a holder who lacks `users.view` is **D5**.
- `account_id` is returned as a stable reference only; **the audit UI offers no action** on it.
- Events whose account was deleted: lifecycle events still return (snapshot), `account_available=false`; operator events cannot outlive the account today (cascade) — see G1.
- Events whose actor/user reference is missing: shown with `state=unknown`, never dropped (an audit log must not hide its own gaps).

#### 3.3.3 Explicit non-goals of the API
No export, no write, no delete/redact, no event detail endpoint, no search, no backfill. **No backfill of historical context is proposed** unless D2 selects it with its own approval.

### 3.4 Registry / migration / seeder impact (documented, **not executed**)

| Artifact | Change needed | Notes |
|---|---|---|
| `App\Support\Rbac::PERMISSIONS` | **Add** `delivery_connector.audit.view` next to the other `delivery_connector.*` keys, with the "owner/admin via `*` only; not granted to accountant/staff/self_service" comment. | Only registry. Also makes `StoreRoleRequest` accept it and `RoleController` list it. |
| `Rbac::MATRIX` | **No change.** `accountant`, `staff`, `self_service` must **not** receive it. | Add the assertions next to `DeliveryConnectorCoreTest:76-81`. |
| Migration for roles | **None.** Do **not** copy `REM-37`'s backfill. Stored owner/admin roles already hold `*`; custom roles and system accountant/staff keep their explicit lists and therefore **do not** gain the key. | This is the "no implicit grant to old custom roles" requirement. Granting it to an existing custom role is a deliberate admin action in the role editor. |
| Seeder | **None.** `Rbac::systemRoles()` derives from `MATRIX`, which does not change. | |
| `routes/api.php` | One `GET` route (PR-6b). | |
| Frontend `modules/roles/risk.ts` | Classify the key as `data` (sensitive-grant flag in the editor) — see D6. | Labels derive from existing module/area/action messages; the area label `audit` already exists in both locales (`hr.perm_areas.audit` — "Audit" / «التدقيق»), so the editor renders it without a message change (the implementation PR re-verifies with the catalog test). |
| Frontend sidebar / messages | New entry + dictionary (PR-6d). | |
| Docs | Record DP-E (audit-read sub-decision) in `DLV-INTEGRATIONS-UX-DESIGN-1.md` (D1) — wording must come from the owner. | |
| Residual (G6) | `*` holders always have it; no deny rule exists; an admin can read the audit of their own actions. | Inherent; documented in the permission description. |

---

## 4. Tenant & branch isolation rules (mandatory acceptance gate)

### 4.1 Tenant binding of each event class

| Event class | How it is bound to the company | Strength |
|---|---|---|
| Lifecycle (`ingress.created`, `secret.rotated`, `ingress.disabled`) | `tenant_id` column, forced from `TenantContext` on save; forging refused; `TenantScope` on every Eloquent read | Strong (own column + model guard + scope) |
| Operator reassignment | `tenant_id` column (FK, cascade) written from the locked account; `TenantScope` on reads; no model-level forging guard | Adequate (own column + scope); weaker model guard (G10) |
| Names / branches / accounts used to enrich rows | `User` is **not** tenant-scoped ⇒ explicit `where tenant_id = <context>` on every user lookup; `Branch` and `DeliveryConnectorAccount` are `BaseModel` (scoped) but the reader still states the tenant predicate explicitly (defence in depth) | Must be enforced + tested |

Answers to the assignment's questions, from the code:

- **Events with `branch_id = null`?** Yes, by design: lifecycle events of **unrouted** accounts carry `branch_id = null`; operator events have no branch column at all.
- **How is branch scope enforced on read?** Mirror `visibleTo`: unrestricted user ⇒ no branch predicate; restricted user ⇒ `branch ∈ allowed`; **null-branch events are hidden from restricted users**. Lifecycle: `whereIn('branch_id', allowed)`. Operator: via the account's branch (live join today — see 4.4).
- **Branch of the point changes after the event?** It cannot today (model-level immutability), so the lifecycle snapshot equals the current branch. If a future feature re-routes, **lifecycle events stay correct (snapshot)** while a join-based operator filter would silently re-attribute history — hence G1.
- **Point or user deleted?** *Point:* lifecycle events survive (snapshot of platform/store/branch; `account_available=false`); operator events are **erased by the FK cascade** (G1). *User:* no FK ⇒ ids remain; the reader shows `state=deleted|unknown` and never drops the row.
- **Can another company's events appear through filters or pagination?** Not by design: every source query has the tenant scope **and** an explicit tenant predicate; the cursor carries position only; filters (`account_id`, `branch_id`, `external_store_id`) intersect with the tenant+branch scope and can only narrow. Proven by tests T-T1…T-T6 (§8).
- **Must the branch context be frozen at event time for historical accuracy?** For lifecycle: already done. For operator events: **not done** ⇒ BLOCKER-1.

### 4.2 Required rules (apply to the whole reader)

1. One service class owns the read; controllers never query the event models directly.
2. Every query: tenant predicate (scope **and** explicit), branch predicate (for restricted users), keyset predicate, `LIMIT`.
3. Branch predicate is applied **in SQL**, never as a post-filter (post-filtering breaks pagination and can leak page boundaries).
4. A restricted user never receives null-branch events, never receives events of branches outside their set, and never learns that hidden events exist (no counts, no `has_more` influenced by hidden rows: `has_more` is computed **after** the scope is applied).
5. Branch scope is evaluated at **read time** from the user's current branches (identical to the connector list). Losing a branch removes its events from that user's view immediately.
6. Fail closed: a row whose branch context cannot be established is shown only to unrestricted users.

### 4.3 What the data guarantees today

| Event class | Historical isolation guaranteed by the row itself? |
|---|---|
| Lifecycle | **Yes** — tenant, branch (event-time), platform and store are in the row; survives account deletion. |
| Operator | **No (conditional)** — tenant yes; branch/store only through the live account row; correct **only while** (I1) `branch_id` is immutable and (I2) no code path deletes an account. Neither invariant is enforced by the database or by the event row. |

### 4.4 BLOCKER-1 — historical branch scope of operator events (decision D2)

> **Not decided here.** The three options below are compared; one is recommended; the owner chooses.

| Option | What changes | Pros | Cons / risks |
|---|---|---|---|
| **A — Snapshot at write (recommended)** | Additive migration on `delivery_connector_operator_events`: nullable `branch_id`, `platform_key`, `external_store_id`, plus `branch_context_recorded` boolean (default `false`). `reassign()` writes them (a few lines, same transaction). Legacy rows (flag `false`) keep using the live-join fallback under I1/I2. **No backfill; no FK change.** | Same principle as the lifecycle table (event-time facts in the row); closes the asymmetry; new rows stay correct even if re-route/delete ever ships; reader has one clean path for new data. | A migration + writer change + tests (a separate small PR, **PR-6b0**); two read paths (snapshot / legacy-join) until legacy rows age out; the FK-cascade erasure of operator events is **not** fixed by this alone. |
| **B — Join under invariants (no schema change)** | None. Reader derives operator-event branch/store from the live account row (SQL join through a scoped relation). Add **guard tests** that fail if immutability (I1) or deletion (I2) ever changes, and a documented rule: any feature that re-routes or deletes accounts **must first** ship Option A. | Zero schema/writer change; fastest. | History correctness depends on application invariants outside the log; a raw SQL change or future feature silently corrupts attribution; operator history disappears with the account row. |
| **C — Restrict operator events to unrestricted users in v1** | None. Branch-restricted users see lifecycle events only; operator-reassignment rows are shown to unrestricted audit holders. | Trivially isolation-safe, no schema change. | Restricted auditors get an incomplete log (must be stated in the UI); defers rather than solves. |

**Recommendation: A.** If the owner prefers zero schema change for the first release, **B with the guard tests** is acceptable as long as it is recorded as a conscious, time-boxed acceptance; **C** is the safe interim if neither can be approved.
**Optional, separate decision (not recommended now):** drop the `cascadeOnDelete` FK on operator events and/or backfill the snapshot for legacy rows. Backfill would copy the *current* account branch (equal to the event-time branch **only because of I1**); per the assignment it needs its own documented reason and approval.

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
| Partial data | Rows are never dropped: unknown person → "Unknown user"; missing store/platform → "—"; `occurred_at = null` → "Time unknown". A visible note when any row has partial data. |
| Stale response | Latest-request-wins guard (filters/cursor changes cancel older responses). |

**Hard rules.** No management action anywhere on the screen (no rotate/disable/reassign/copy-secret; no link to a manage dialog); no secret, prefix, token or payload; no export in v1; Demo mode shows nothing and sends nothing; AR/EN with RTL/LTR logical properties; light/dark with AA contrast; ≥44 px touch targets; the link and the data request both respect `delivery_connector.audit.view` (absent link for non-holders; 403 handled if forged).

---

## 6. Owner decisions required

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **D1** | Confirm "DP-E option A" = dedicated `delivery_connector.audit.view` (read-only, owner/admin via `*`, nobody else by default); supply the wording for the decision record in `DLV-INTEGRATIONS-UX-DESIGN-1.md`. | Confirm. | Record only; PR-6a can proceed once confirmed. |
| **D2 (BLOCKER-1)** | Historical branch scope of operator events: **A** snapshot, **B** join under invariants, **C** unrestricted-only (§4.4). | **A** (B acceptable as a recorded interim; C as safe fallback). | **PR-6b** (and PR-6b0 if A). |
| **D3** | Page access: **P1** dedicated `/integrations/audit` gated by `audit.view` alone, vs **P2** require `invoices.view` + `audit.view`. | **P1.** | PR-6d. |
| **D4** | Application gate on the audit endpoint: `sales.pos` like siblings (suspended ⇒ readable, disabled ⇒ 403) vs no app gate. | Same as siblings. | PR-6b. |
| **D5** | May the server resolve **user names** (not emails) for a holder of `audit.view` who lacks `users.view`? **N1** yes — `audit.view` is an explicit authority over "who did what" (documented in the permission description); **N2** no — require `users.view` too, else show "User" with no name. | **N1** (names only, never email). | PR-6b DTO. |
| **D6** | Classify the key as a **sensitive `data` grant** in the role editor. | Yes. | PR-6d (frontend). |
| **D7** | Cursor pagination (recommended) vs offset (`page`/`per_page` as the Commerce endpoints). Offset shifts under inserts and needs a total. | Cursor. | PR-6b. |
| **D8** | Re-scope the Horizon `INT-UX-6` text: this slice = **audit reader only**; the attempts/events log stays under **INT-ACT-1**. | Yes. | Docs. |
| **D9** | Additive `(tenant_id, created_at, id)` indexes on both tables in PR-6b (index-only migration, no data change). | Yes, with an EXPLAIN check on PostgreSQL. | PR-6b. |

No decision above requires a backend *behaviour* change to existing endpoints.

---

## 7. Proposed implementation split (independent small PRs, each Draft, each needs its own approval)

| PR | Scope | Depends on | Notes |
|---|---|---|---|
| **PR-6a** Permission registry | `Rbac::PERMISSIONS` += `delivery_connector.audit.view`; tests: not in `MATRIX` for accountant/staff/self_service; role editor/`StoreRoleRequest` accept it; grant-ceiling test; stored custom roles unchanged; **no route** (inert) | D1 | Backend, ~1 line + tests. No migration/seeder. |
| **PR-6b0** *(only if D2 = A)* Operator-event context snapshot | Additive migration (3 nullable cols + flag), `reassign()` writes them in the same transaction, tests (written, null-branch, legacy rows untouched, no secret, same-operator no-op still writes nothing) | D2 | Separate so the schema change is reviewed alone. |
| **PR-6b** Audit reader API | Route + controller + form request + service + resource + `(tenant_id, created_at, id)` indexes (D9) + the full backend matrix (§8) on SQLite **and** PostgreSQL | PR-6a, D2–D5, D7 | Read-only; adds no write path. |
| **PR-6c** UI data layer | `lib/connector-audit.ts` (allow-list reader, dictionary, cursor handling), hook with latest-request-wins, permission gate helper, messages AR/EN, extend `no-connection-controls.test.ts` deliberately (one new GET route, zero write verbs, no actions) | PR-6b | No screen yet; pure + hook tests. |
| **PR-6d** Screen + navigation | `/integrations/audit` screen (desktop table / mobile cards, filters, all states), sidebar entry, landing + platform deep links, role-editor risk flag (D6), Playwright AR/EN × light/dark × desktop/mobile | PR-6c, D3, D6 | Real clicks; API-intercepted vs real-backend runs labelled separately. |
| **PR-6e** Docs close-out | Decision record in the design doc, closure report, Horizon status | PR-6d | Docs only. |

Order: 6a → (6b0) → 6b → 6c → 6d → 6e. None starts without its own assignment.

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
| T-P8 | `sales.pos` enabled / suspended / disabled | 200 / 200 (read-only) / 403 |
| T-T1 | Two tenants, events in both | each tenant sees only its own, in every filter combination |
| T-T2 | Foreign `account_id` / `branch_id` / `external_store_id` filter | **200 empty**, not 404/403/422 (no oracle) |
| T-T3 | Forged / replayed cursor from another tenant | cannot widen scope; malformed ⇒ 422 |
| T-T4 | Pagination across a tenant boundary (interleaved timestamps) | no foreign row on any page; `has_more` unaffected by hidden rows |
| T-T5 | Name/branch/account enrichment lookups | never return another tenant's name (explicit tenant predicate on `User`) |
| T-T6 | Query-level assertion | every source query carries the tenant predicate (SQL log assertion) |
| T-B1 | Unrestricted user | sees all branches **and** null-branch events |
| T-B2 | Branch-restricted user | only events of their branches; **null-branch events hidden** |
| T-B3 | Restricted user, operator events | scope per decision D2 (A: snapshot; B: join; C: hidden) |
| T-B4 | Branch scope changed after events were written | visibility follows the user's **current** branches immediately |
| T-B5 | Account deleted (raw delete) | lifecycle events still returned with `account_available=false` and correct snapshot branch; restricted scoping still correct; operator events per D2 |
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
| T-N1 | Query count | constant (≤ 2 page queries + ≤ 3 lookups) regardless of page size / actors (assert query log) |
| T-R1 | Read-only | no non-GET verb exists on `delivery-connectors/audit-events*`; the reader writes nothing (event row counts unchanged) |
| T-D1 | PostgreSQL parity | keyset predicate, null ordering and timestamp equality behave identically to SQLite |
| T-X1 | *(guard)* | model/table invariants I1/I2 (immutable branch, no delete path) pinned by tests if D2 = B |

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
4. A branch-restricted user never sees events of other branches or null-branch events; the chosen D2 option is implemented and proven (including deleted-account and re-route guard cases).
5. The DTO matches the allow-list; secrets, prefixes, tokens, payloads, emails and ids-of-people-as-names never appear.
6. Stable ordering and cursor pagination with a hard page cap; bounded queries; no N+1.
7. The reader is strictly read-only; the UI offers no management action.
8. All tests green on SQLite and PostgreSQL; existing INT-UX-4/5 behaviour unchanged; CI green on the final head.

---

## 9. Git state

Branch `docs/int-ux-6-contract-security-gate` · Base SHA `28c8a20e4a928587315266b515feed091b8f0f33` · Draft PR and final Head SHA: recorded in the PR description (a document cannot name its own commit). Documentation-only: **this file is the only change.**

## 10. Next step

Owner review of this gate. Decisions D1–D9 (above all **D2 / BLOCKER-1**) are needed before **PR-6b**; **PR-6a** needs only D1. Nothing is implemented, merged or deployed, and INT-UX-6 implementation does not start until the owner assigns PR-6a (or the chosen first PR) explicitly.
