# AC-UX-HZ-01 — Current State (execution tracker + AC-UX-00 inspection)

**Horizon:** Access Control Administration & Permission-Aware UX
**Status document:** execution only. It is **not** a permissions source of truth — the canonical functional/security reference is
[`AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md`](./AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md), and the code is
`App\Support\Rbac` + the controllers cited below.
**Inspection base:** `main` @ `5ff31353272f8e1cf0dc153d90c6bd860cfc4982` (2026-10-14).
**Companions:** [`AC-UX-HZ-01-MASTER-PLAN.md`](./AC-UX-HZ-01-MASTER-PLAN.md) · [`AC-UX-HZ-01-TASK-QUEUE.md`](./AC-UX-HZ-01-TASK-QUEUE.md)

> Evidence labels: **[code]** read in source · **[probe]** executed against current `main` with a throwaway test that was **not** committed ·
> **[count]** computed from the live `Rbac::PERMISSIONS` constant via `artisan tinker`.

---

## 0. Slice status

A slice is marked **Merged** only after tests + exact-head CI + merge. "Post-merge verified" is recorded when a post-merge check exists.

| Slice | Status | PR | Merge SHA |
|---|---|---|---|
| AC-UX-00 baseline & UX contract | **Merged** | #1460 | `58582ce85cfe541bd41df727cce79d2289acad2b` |
| **AC-UX-00A User administration grant boundaries** (backend, owner-mandated) | **Merged** | #1462 | `f1b7031fae615556149b8e0653247d6f73325827` |
| AC-UX-01 Users workspace | **Merged** | #1465 | `cc30b53d63c61ef1ac97d5280b562d67f1036ebb` |
| AC-UX-02 User editor & access scope | **Merged** | #1466 | `8c9f411f795ba2b35fb7a79f3d8427e08504f571` |
| AC-UX-03 Roles & Permissions workspace — **03A shell/catalogue** | **Merged** | #1467 | `cd72408462ced93d3da5431030aab2804b918c34` |
| AC-UX-03B role editing/risk | **Merged** | #1468 | `db93a7034ef7786e61c525adf5d8b36b431819c0` |
| AC-UX-04 Role creation & safe cloning | **Merged** | #1469 | `f147fb6063d36952971724609250f9ba1baf42f5` |
| AC-UX-05 Branch & warehouse scope UX | **Merged** | #1471 | `7e8af039de6ac71b571ed8f0208e6ea48a5dc064` |
| AC-UX-06 Resource access / treasury UX | **Merged** | #1475 | `beaa6bf15b5b2284b0973bf41004dbe76a59afdc` |
| AC-UX-07 Permission-aware ERP UX | **Merged** | #1480 | `f1bcc67b809617c620c1629831c25eb744a826cd` |
| AC-UX-08 Access summary & explainability | **Merged** | #1481 | `23c1dd3ca6ee4e530205da65227f5e0066baa839` |
| AC-UX-09 Accessibility / responsive / visual QA | **Merged** | #1484 | `e972e5ba949a57c3716b53d6bd75894c7e262989` |
| AC-UX-10 Closure & security verification | **Merged** — see [`AC-UX-HZ-01-FINAL-REPORT.md`](./AC-UX-HZ-01-FINAL-REPORT.md) | #1486 | `757a7a39823eb9d26a8c11d2f755c8af81c52876` |

Deploy: **NOT DEPLOYED** (no deploy authority in this horizon).

---

## A. Current screen map

There is **no dedicated Access Control area today**. Users and Roles are two tabs of the HR page.

| | Users | Roles |
|---|---|---|
| Route | `/hr?tab=users` | `/hr?tab=roles` |
| Host | `web/src/app/(app)/hr/page.tsx` (513 lines; 9 tabs) | same |
| Components | `DataTable` (inline `userColumns`), `UserDialog`, `UserScopeDialog`, `AccessScopeFields`, unified `EmployeeDialog` (when the user is linked to an employee) | `DataTable` (inline `roleColumns`), `RoleDialog` |
| APIs | `GET/POST /users`, `PUT/DELETE /users/{id}`, `POST /users/{id}/send-invitation`, `GET /employees`, `GET /employees/{id}`, `GET /branches`, `GET /warehouses`, `GET /roles` | `GET/POST /roles`, `PUT/DELETE /roles/{id}` |
| Gate (UI) | tab shown iff `currentUser().role ∈ {owner, admin}` | same |
| Gate (API) | `users.view` (read) / `users.manage` (write) | `roles.view` / `roles.manage` |
| Scope editing | Yes — branch + warehouse checklists inside `UserDialog` (create/edit) and a separate `UserScopeDialog` (map-pin row action) | n/a |
| Mobile | Generic `DataTable` fallback — no `mobileRecord` supplied for either table | same |
| Loading / error / empty | Loading flag shared with the whole HR page; empty label present; **load errors are swallowed** (`.catch(() => {})`) so a failed `/users` fetch renders as "no users" | same |

**Known defects (all [code] unless noted):**

| # | Defect | Where | Severity | Planned in |
|---|---|---|---|---|
| U-1 | Tab visibility is hard-coded to role **name** (`owner`/`admin`), not `users.view`/`roles.view`. A custom role holding `roles.view` cannot reach the screen; an `admin` whose permissions were edited down still sees tabs the API then 403s. | `hr/page.tsx:86,448` | Med (UX/correctness; backend still authoritative) | 01, 07 — **07 fixed the users-login gating** (`users.view` + `users.manage`); the HR *org-structure* tab intentionally stays owner/admin (accountant holds `hr.manage` by default — product decision) |
| U-2 | Delete has **no confirmation** and the call is `await api(...).catch(() => {}); success(...)` — a failed delete (e.g. 422/403) still shows the "deleted" toast. | `hr/page.tsx:113-117` | Med (misleading success on a security-relevant action) | 01 |
| U-3a | `GET /users` returns only the role **slug**; display names exist only in `GET /roles`, guarded by `roles.view`. A custom role may hold `users.view` without `roles.view`, so the Users table cannot always resolve a role name. | `UserResource`, `routes/api.php` | Med | 01 |
| U-3 | Role column renders `tu('roles.${role}')`; only `owner/admin/accountant/staff` have messages. Custom roles (`role-xxxxxxxx` slug) and `self_service` hit a missing-message path. | `hr/page.tsx:367` | Med | 01 |
| U-4 | Deactivation (status select in `UserDialog`) carries no explanation that it **revokes login and API access** (REM-08) and no impact summary. | `user-dialog.tsx` | Low-Med | 01/02 |
| U-5 | Scope editor shows bare checkboxes + a hint sentence. Empty = "all" is explained only in small hint text; there is no explicit **All / Selected** mode, no count, no search, no warehouse↔branch context. | `access-scope-fields.tsx` | Med (this is the exact "empty looks like none" trap the horizon forbids) | 02, 05 |
| U-6 | `UserDialog` role list excludes `owner`; opening an existing **owner** user therefore has a `<select>` whose value is not among its options. | `user-dialog.tsx:83` | Low (verify in 02) | 02 |
| U-7 | No search facets: only the generic text search. No active/inactive or role filter, no branch-scope filter, no row count. | `hr/page.tsx` | Low | 01 |
| U-8 | `GET /users` returns **all** tenant users unpaginated and unsearched; the table sorts/filters client-side. **Not bounded by plan**: `Plans::PLANS` gives `enterprise` `users: null` (unlimited, `PlanGate::limit()` ⇒ no cap) and a tenant `users` override can do the same, so payload size and browser rendering are unbounded for those tenants. Free/basic/pro are capped (2/5/20). Server pagination/search would be an API change (D-D); until then AC-UX-01 must mitigate client-side (see MASTER-PLAN D-D). | `UserController::index`, `app/Support/Plans.php` | Low-Med | 01 |
| R-1 | Permission editor is a flat `max-h-72` scroll box of toggle chips per module (the "checkbox wall"); no search, no counts, no group select, no risk treatment, no dirty-state, no unsaved-changes guard. | `role-dialog.tsx` | Med (UX) | 03 |
| R-2 | Modal is the wrong container for 134 permissions. | `role-dialog.tsx` | UX | 03 |
| R-3 | No "this change applies to N users immediately" warning on edit, although roles are bound by `slug` and `users_count` is already returned. | `role-dialog.tsx` | Low-Med | 03 |
| R-4 | Delete button is hidden for system roles (correct), but the **owner** immutability and the **wildcard-downgrade** consequence are communicated only via small notes. | `hr/page.tsx:344`, `role-dialog.tsx` | Low | 03 |
| P-1 | `permission_modules` i18n coverage is partial: **19 of 36** modules have no label → **101 of 134** keys render under a raw key such as `fuel`, `pos`, `documents`. 3 terminal actions (`operate`, `reassign`, `publish`) have no label in either locale. | `messages/{ar,en}.json` `hr.perm_modules/perm_actions` | Med | 03 |
| P-2 | Stale session permissions: `currentUser().permissions` is written at login and refreshed only by a few screens that call `/me`. After a role edit, affected users keep stale nav until re-login. Backend remains authoritative, so this is a UX/staleness issue, not a bypass. | `lib/auth.ts` | Low-Med | 07 — **fixed**: `/me` re-read on shell mount/focus (role+permissions only, throttled 30 s) |

### Backend/security findings surfaced by the inspection (not UI defects) — F-1/F-2 owner-classified **High**, fixed by AC-UX-00A

| # | Finding | Evidence | Severity | Disposition |
|---|---|---|---|---|
| **F-1** | A **branch-restricted** actor who holds `users.manage` can (a) clear their own `branch_ids` (`[]` ⇒ unrestricted) and (b) assign any tenant branch/warehouse — including outside their own scope — to themselves or others; (c) omitting `branch_ids` on create yields an unrestricted user. `UserController::syncAccessScope` and the Store/Update requests apply **no actor-scope check**. | **[probe]** custom role `{users.view, users.manage, branches.view}`, user scoped to branch A: `PUT /users/{self}` `{branch_ids: []}` → **200**, `allowedBranchIds() === null`; `{branch_ids:[A,B]}` → **200**, now holds B. **[code]** `UserController.php:syncAccessScope`, no guard in `guardOwnerRole`. | **High** (owner classification, 2026-10-14): authorization / privilege escalation. | **Owner decision: Option 2.** Fixed by **AC-UX-00A** (blocks AC-UX-01). |
| **F-2** | `users.manage` lets the holder assign **any tenant role except `owner`**, including `admin` (`*`), to themselves or others, and modify/reset the password of any non-owner user including an `admin` or a user with broader scope (takeover). `guardOwnerRole` blocks only the `owner` role. | **[code]** `UserController::guardOwnerRole`; `UpdateUserRequest.role` accepts any tenant role slug; update accepts `password` for any non-owner target. | **High** (same classification). | **Owner decision: Option 2.** Fixed by **AC-UX-00A**: a role grant ceiling and a target ceiling (by role and by scope). `users.manage`/`roles.manage` are still presented as the highest-risk class in AC-UX-03. |
| **F-4** | `roles.manage` lets the holder add **any** permission (including `users.manage`) to their own role — `RoleController::update` has no actor ceiling — which bypasses the user-assignment ceiling; the change is effective immediately. | **[code]** `RoleController::update/store` accept any `Rbac::PERMISSIONS` subset. (Raised in review of #1460.) | **High** (same chain as F-2). | **Owner decision D-I: fixed inside AC-UX-00A** (role-definition ceiling). |
| F-3 | `GET /branches` and `GET /warehouses` return only the **caller's** allowed rows. A restricted administrator therefore sees an incomplete checklist in the scope editor (target's out-of-view assignments are invisible but preserved in form state). | **[code]** `BranchController::index`, `WarehouseController::index`. | Low | Editor must tell the admin the list is limited to what they can see (AC-UX-05); no API change. |

---

## B. Contract map (existing APIs only — nothing invented)

All routes are inside the `auth:sanctum` + tenant + active-subscription group of `routes/api.php`. Permission middleware is `EnsurePermission`.

### Users — `UserController`

| Method + path | Permission | Notes |
|---|---|---|
| `GET /users` | `users.view` | `User::where('tenant_id',…)->with(employee, branches, warehouses)->latest()->get()` — **unpaginated**. Manual tenant filter (User does not extend `BaseModel`). |
| `POST /users` | `users.manage` | Body: `name`, `email`, `password` (required unless `send_invitation`), `send_invitation`, `role` (tenant role slug), `is_active`, `employee_id`, `branch_ids[]`, `warehouse_ids[]`. 422 on plan user cap, duplicate email (global), employee already linked. Response adds `invitation.{sent,message}`. |
| `PUT /users/{id}` | `users.manage` | Partial. **Absent key = unchanged; `branch_ids: []` / `warehouse_ids: []` = clear = unrestricted.** `employee_id: null` unlinks. `is_active: true→false` deletes tokens in the same transaction (REM-08). |
| `DELETE /users/{id}` | `users.manage` | Soft delete + token purge. 422 for self. 403 for owner target by non-owner. |
| `POST /users/{id}/send-invitation` | `users.manage` + `throttle:auth-invitation` | 422 without email; 503 on mail failure. |

`UserResource`: `id, name, email, role, is_active, employee_id, branch_ids?, warehouse_ids?, employee?{id,name,employee_no}`. **No** `last_login`, no role display name, no created-at — so the Users table must not show them (horizon: "if last-login does not exist: omit it").

There is **no `show` route and no activate/deactivate endpoint**: activation is `PUT /users/{id} {is_active}`.

Guards to reflect in UI: owner role grant/modify/delete = owner only (403 otherwise); cannot delete self.

### Roles — `RoleController`

| Method + path | Permission | Notes |
|---|---|---|
| `GET /roles` | `roles.view` | Ordered system-first, name. Each role: `id, slug, name, permissions[], is_system, is_owner, users_count`. `meta.permissions` = the **entire canonical catalogue** (`Rbac::PERMISSIONS`, flat string list). `users_count` is tenant-filtered manually. |
| `POST /roles` | `roles.manage` | `name` ≤100, `permissions` required, **min 1**, each in `Rbac::PERMISSIONS` (`*` rejected). Server generates `role-xxxxxxxx` slug, `is_system=false`. |
| `PUT /roles/{id}` | `roles.manage` | Same body. 422 for `owner`. System roles (`admin`, `accountant`, `staff`, `self_service`) **are editable**; editing `admin` replaces `*` with the explicit list (the dialog's "wildcard downgrade" note). Slug unchanged. Takes effect for all users of that slug immediately (no cache — `Rbac::resolve` reads per request). |
| `DELETE /roles/{id}` | `roles.manage` | 422 for `is_system`, 422 when any user holds the slug. |

### Scope sources

| | Contract |
|---|---|
| `GET /branches` | `branches.view` (list is un-gated by app key). **Caller-scoped**: restricted callers get only their branches (F-3). Fields: `id, code, name, is_active, …`; `main_branch_id` in `additional`. |
| `GET /warehouses` | `products.view`. Caller-scoped. Fields: `id, code, name, branch_id, is_active`. → parent-branch context for warehouses **is** available. |
| Effective scope | `User::allowedBranchIds()/allowedWarehouseIds()` return `null` for zero assignments. **No endpoint exposes the effective scope**; the Users list exposes the stored assignment arrays only. `/login` and `/me` return `permissions` but **not** branch/warehouse scope. |

### Resource ACL (treasury)

`CashBankAccount` carries `deposit_scope`, `deposit_scope_subject`, `withdraw_scope`, `withdraw_scope_subject`; `scope ∈ {all, role, user, branch}`; **one subject string per direction** (role slug / user id / branch id). Evaluated by `CashBankAccount::allows($action, $user, $branchId)`; `all` ⇒ true, unknown ⇒ false. Managed through `POST/PUT /cash-bank-accounts[/{id}]` (`payments.manage`) and edited today in `web/src/app/(app)/cash-and-bank/new/page.tsx` + `[id]`. No separate ACL endpoint exists; AC-UX-06 must stay on these.

### Session

`/login`, `/me` → `user.permissions` = `Rbac::permissionsForRole(role)` (`["*"]` for owner/admin by default). Frontend mirror: `web/src/lib/permissions.ts::hasPermission(permissions, role, permission)` — wildcard-aware, falls back to owner/admin only when `permissions` is `undefined`.

### Existing tests (to extend, never weaken)

Backend: `RoleTest`, `UserManagementTest`, `UserAccessScopeTest`, `UserEmployeeLinkTest`, `UserInvitationTest`, `UserRequestIdempotencyTest`, `Rem08DeactivatedUserAccessTest`, `ApiRbacTest`, `Rem37ZatcaSubmitPermissionTest`, `ReportEffectiveScopeTest`, `LegacyInventoryWarehouseScopeTest`.
Web: `components/hr/role-dialog.test.tsx` (8 tests, multi-segment key integrity), `lib/permissions.test.ts`. Playwright: **no** e2e spec covers Users/Roles today.
Gap: no backend test exercises a **scope-restricted actor** calling `/users` (F-1) — closed by AC-UX-00A.

---

## C. Permission metadata map

| Question | Answer |
|---|---|
| Single canonical source? | **Yes** — `App\Support\Rbac::PERMISSIONS`, delivered to the UI as `GET /roles` → `meta.permissions`. The UI must never maintain its own list of grantable keys. |
| Size **[count]** | **134 unique keys**: 68 two-segment, 62 three-segment, 4 four-segment. (The reference doc §39 says 122 — superseded by REM-37 / new modules; corrected in the reference.) |
| Exact-key handling | Opaque. The current `RoleDialog` stores/sends the original string and is covered by tests (PR-ACL-ROLE-UI-1). Any new editor MUST keep that: grouping/labels derive from the key **for display only**; the key itself is the only thing stored, compared, keyed and submitted. |
| Modules | First segment; **36 modules** (e.g. `partners`, `pos`, `fuel`, `documents`, `fiscal_years`, `apps_builder`). |
| Action | Last segment; 40 distinct (`view`, `manage`, `approve`, `export`, `review`, `confirm`, `recalculate`, `submit`, …). Do not collapse non-`manage` to "View". |
| Middle segments | Present for 66 keys (`pos.audit.export` → `audit`; `fuel.shift.approve` → `shift`; `pos.session.handover.confirm` → `session·handover`). Needed to sub-group the 41-key `fuel` module; display only. |
| Labels | `hr.perm_modules` (17/36 modules labelled) and `hr.perm_actions`. 101 keys sit in unlabelled modules; `operate`, `reassign`, `publish` unlabelled. Fallback today = humanised snake_case / raw key. **No** server-provided labels. |
| Sensitive / risk metadata | **Not provided by the backend.** Sensitivity is only described in comments and in reference §22 (candidate list). There is no `risk`, `group`, `label`, or `depends_on` field anywhere in the API. |
| Wildcard `*` | Exists only in `Rbac::MATRIX` (`owner`, `admin`) and stored system-role rows. Rejected by `StoreRoleRequest` for any role write. Editing a stored `admin` role replaces `*` with an explicit list (downgrade). Owner immutable. UI mirror: `hasPermission` treats `*` as grant-all. |
| Unknown future keys | A key not in any display map must still render and submit correctly (humanised fallback) — already true in `RoleDialog` and covered by a test. |

**Consequence for AC-UX-03:** labels/risk would have to be a **frontend presentation layer** keyed by exact key (decision D-B in the MASTER-PLAN) unless the owner approves an additive backend metadata field.

---

## D. Information architecture → see MASTER-PLAN §3

## E. UX acceptance spec → see MASTER-PLAN §4
