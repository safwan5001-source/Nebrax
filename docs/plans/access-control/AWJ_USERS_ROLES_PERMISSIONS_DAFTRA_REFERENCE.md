# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — first code-backed AWJ access-control inspection  
**Scope:** Users, Employees, Roles, Permissions, Branch Scope, Resource Access, Record Scope, Workflow/Record State, Reports, permission-aware UX.  
**Reference product:** Daftra official documentation.  

> This document is a functional research/reference artifact. It does **not** authorize implementation, database changes, permission migrations, merge/deploy, or changes to accounting/security rules.

## 1. Decision

Daftra is the functional reference for the AWJ users / roles / permissions experience.

AWJ should provide the same overall operating model and flexibility while implementing it with AWJ-native, stable permission keys and stronger security invariants where appropriate.

We do **not** intend to copy Daftra's URL-based blocked-page mechanism literally. Equivalent restrictions in AWJ should normally use stable authorization permissions/policies.

## 2. Confirmed AWJ baseline

Current AWJ already has a real tenant-aware RBAC foundation:

- `roles` are tenant-scoped (`tenant_id`).
- Roles contain `slug`, `name`, JSON `permissions`, and `is_system`.
- System roles are seeded with backward-compatible behavior.
- `owner` / `admin` have wildcard `*`.
- `accountant`, `staff`, and `self_service` exist.
- `Rbac::PERMISSIONS` is the central assignable permission catalogue.
- Custom roles exist and are assignable to users.
- Employee ↔ User linkage exists (`users.employee_id`), with tenant-safe linking rules documented in the HR/users architecture.
- AWJ already contains fine-grained sensitive permissions in newer modules, including `products.view_cost`, `sales.minimum_price_override`, POS audit/approval permissions, Document Center permissions, accounting settings/period locks and fiscal-year permissions.

Important correction after code inspection: AWJ roles remain **CompanyWide**, but AWJ already has **per-user branch scope and per-user warehouse scope**. This is the desired separation: role = what; user scope = where/which resource. It must be preserved rather than replaced with branch-specific role copies.

## 3. Daftra model observed so far

Research of Daftra official documentation indicates a model broader than plain RBAC:

```text
User
 ├─ Employee identity
 ├─ Login/access enabled
 ├─ Role
 │   └─ Permissions grouped by application/module
 ├─ Allowed branches
 ├─ Resource-specific access where applicable
 └─ Record scope where applicable
      ├─ All allowed records
      ├─ Own records
      ├─ Assigned records
      └─ Workflow-related records
```

Effective authorization is influenced by multiple layers:

```text
Tenant / account boundary
        ↓
Enabled application / feature
        ↓
Role permission
        ↓
Allowed branch/data scope
        ↓
Resource-specific permission
        ↓
Record scope / assignment
        ↓
Workflow state / actor position
        ↓
Business / accounting / compliance rule
```

AWJ target principle:

```text
Effective Access =
Tenant Isolation
∩ Enabled Feature
∩ Role Permission
∩ Allowed Branch/Data Scope
∩ Resource Permission (when applicable)
∩ Record Scope (when applicable)
∩ Workflow/Record State (when applicable)
∩ Business / Accounting / Compliance Policy
```

The layers are restrictive intersections. A lower-level permission must never bypass a higher-level denial or invariant.

## 4. Employee vs User

Daftra distinguishes an employee record from a system user:

- Employee: HR/personnel record; system login is not inherently required.
- User: employee/person with login credentials and a role.
- System access can be enabled/disabled without deleting the underlying person.
- A user can be assigned a role and allowed branches.
- User status and login enablement are separate concerns in the documented user form.

AWJ already documents and implements the same core model: `User ⊃ Employee`.

### AWJ target

Preserve the separation between employee lifecycle, login/access status, role assignment, and branch/resource authorization. Disabling login must not require deleting the employee, deleting user history, or changing financial audit attribution.

## 5. Roles

Observed Daftra behavior:

- Employee/User/Admin role types are documented.
- User roles expose customizable permissions.
- Admin role grants all permissions.
- Roles can be created, edited, deleted where allowed, assigned, and cloned.
- Permissions are presented by application/module rather than as an unstructured flat list.
- A restricted user's visible navigation and available actions reflect effective permissions.
- Administrators can use "login as user" to inspect the resulting experience.

### AWJ code-backed status

AWJ `RoleController` already supports create/update/delete custom roles, tenant-safe assigned-user counts, system-role protection, owner immutability and prevention of wildcard `*` for custom roles through the role contract. The role list returns `Rbac::PERMISSIONS` as the canonical assignable catalogue.

The current `RoleDialog` already groups permission strings by the first segment (`module.action`) and displays module rows. However, it is structurally optimized for `view/manage`: `ACTION_ORDER` contains only those two actions and the label logic treats any non-`manage` action as the view label. With AWJ's newer fine-grained keys (`approve`, `close`, `reopen`, audit actions, etc.), the grouping exists but the UX/action labeling is not yet sufficiently expressive.

No clone endpoint/action was found in the inspected `RoleController`/`RoleDialog`; role cloning therefore remains a **confirmed UX/API gap in this inspection**, unless another implementation is discovered later.

### AWJ target

Keep the backend permission registry canonical, preserve current role safety invariants, and evolve the role editor for arbitrary action names, dependencies, risk labels and cloning without weakening backward compatibility.

## 6. Permission granularity

Daftra documentation shows permissions finer than simple `view/manage` and includes business actions: invoice profit visibility, changing payment date, ZATCA/tax submission, inventory movement price visibility/modification, workflow actions, task CRUD/administration, rental reservation view/manage/delete, and POS restrictions.

### AWJ observation

Newer AWJ areas already follow this stronger pattern, while older modules still contain broad permissions such as `invoices.manage`, `products.manage`, `partners.manage`, and `purchases.manage`.

### Direction

Do **not** perform a big-bang permission rewrite. Introduce fine-grained permissions incrementally for sensitive operations with explicit backward-compatibility rules for legacy broad permissions until a safe migration plan is approved.

## 7. Permission dependencies

Daftra documents cases where permissions imply or require other permissions (for example management requiring view access).

AWJ V2 should model dependencies explicitly rather than relying only on UI convention.

Conceptual examples only:

```text
resource.update -> requires resource.view
resource.delete -> requires resource.view
workflow.approve -> requires workflow.view
```

Exact dependencies must be defined per AWJ domain and tested server-side.

## 8. Permission-aware UX

Daftra demonstrates multiple unauthorized UI states:

1. **Hidden** — action/menu/column/resource is not shown.
2. **Read-only** — data remains visible but cannot be changed.
3. **Forbidden action** — action is unavailable and direct unauthorized access is rejected/redirected.
4. **Filtered resource set** — unauthorized warehouse/cashbox/report scope does not appear as a selectable/visible resource.
5. **Scope-filtered results** — user can open a page/report but sees only records inside effective branch/resource/record scope.

AWJ should standardize these behaviors. UI hiding is not authorization; backend enforcement remains authoritative.

## 9. Branch scope

Daftra allows allowed branches to be associated with a user. Role answers **what** the user may do; scope answers **where**.

### AWJ code-backed status — PRESENT

This is **not a missing foundation** in current AWJ.

Current `User` model has a `branches()` many-to-many relation through `branch_user`, plus:

- `allowedBranchIds()` — returns assigned IDs, with `null` meaning unrestricted.
- `canAccessBranch()` — server-side access predicate.

`UserController::syncAccessScope()` persists `branch_ids`, validates IDs through tenant-scoped models, and deliberately treats an empty array as removal of restriction/full access for backward compatibility. `UserResource` exposes `branch_ids`; the User dialog already edits them.

`ApiController::scopeToActiveBranch()` intersects list queries with the user's allowed branches. Importantly, `?branch=all` means all **allowed** branches, not all tenant branches. This closes an obvious URL/filter bypass.

### Compatibility convention

AWJ deliberately uses:

```text
no branch assignments / [] persisted relation => unrestricted legacy behavior
allowedBranchIds() => null when unrestricted
```

This prevents existing users from becoming silently locked out when scope support is introduced. Any V2 work must preserve or deliberately migrate this convention with tests.

### Remaining verification

Presence of the foundation does not prove every controller/report/export uses it. End-to-end coverage remains an audit item.

## 10. Warehouse resource scope

Daftra distinguishes warehouse visibility/use/modification.

### AWJ code-backed status — PARTIALLY PRESENT, STRONG FOUNDATION

AWJ already has per-user warehouse assignment through `user_warehouse` and the `User::warehouses()` relation. `allowedWarehouseIds()` and `canAccessWarehouse()` provide server-side predicates; empty assignment means unrestricted for backward compatibility.

`UserController` persists `warehouse_ids` and the UI exposes them.

`ApiController` already provides reusable enforcement:

- `assertWarehouseAllowed()` checks tenant visibility, active state, user warehouse scope and warehouse branch scope.
- `assertRecordAccessible()` protects direct UUID access to branch/warehouse-scoped records and returns 404 for inaccessible records.
- `scopeToAccessibleWarehouses()` filters list queries by every relevant warehouse column, including both sides of transfers.

This is materially more mature than the earlier research-only gap assessment.

### Remaining gap vs Daftra model

Current inspected AWJ warehouse scope is primarily **which warehouses a user may access**, not separate per-warehouse capabilities equivalent to Daftra's:

```text
View
Use in invoice
Modify inventory
```

AWJ may combine global role permission (`invoices.*` / inventory action) with user warehouse scope, which can be a cleaner design. The final Master Plan must decide whether separate warehouse-local action bits are actually needed or whether `global action permission ∩ allowed warehouse` gives equivalent functional behavior with less complexity.

Do not add a second ACL engine unless a real use case cannot be expressed by the existing intersection.

## 11. Cashboxes / bank accounts — resource ACL

### Daftra reference

Cashboxes/banks have independent incoming/deposit and withdrawal/payment authority, assignable to subjects such as user/role/branch/all.

### AWJ code-backed status — ALREADY PRESENT

This is another major correction to the earlier gap assumption.

`CashBankAccount` already stores:

```text
deposit_scope
deposit_scope_subject
withdraw_scope
withdraw_scope_subject
```

Supported scope types in `CashBankAccountService` are:

```text
all
role
user
branch
```

`CashBankAccount::allows(action, user, branchId)` evaluates the selected scope. `CashBankAccountService::assertAllowed()` obtains the active `BranchContext` and rejects unauthorized deposit/withdraw operations server-side.

Enforcement is not merely decorative: inspected callers include `CashBankTransferService` (withdraw source + deposit destination), `EmployeeCustodyService` (withdraw), `SupplierRefundService` (deposit), and documented implementation evidence confirms the same pair is used in payment flows.

Therefore the Daftra-style financial resource ACL is substantially implemented already and should be **reused**, not rebuilt.

### Important limitation to verify

The current representation supports one scope mode + one subject per action, rather than an arbitrary union/list of multiple users/roles/branches. Before changing it, inspect actual product requirements. Do not generalize it merely to imitate Daftra if current semantics satisfy AWJ use cases.

## 12. Sales / invoices — findings so far

Daftra research confirms permissions/policies around operations **inside** the invoice, not merely opening the page. Examples include invoice profit visibility, payment date modification, ZATCA/tax submission, discount controls, manual/free item data entry/modification, and invoice-number-related controls.

Daftra also documents record-level sales visibility concepts such as viewing a user's own invoices/estimates rather than all records.

### AWJ code-backed status from this pass

No clear implementation of generic **own/assigned invoice record scope** was found by targeted code search in this pass. This remains a likely gap, but it must be confirmed by inspecting invoice model/controller fields and sales-representative/customer assignment semantics before defining any key or migration.

Candidate scope semantics must be domain-specific: creator, salesperson, assigned employee and requester are not interchangeable meanings of "own".

## 13. Purchasing — findings so far

Daftra documents a purchasing workflow including Purchase Request → Request for Quotation → Purchase Quotation → Purchase Order → Purchase Invoice/Bill, with controls around viewing and performing operations at multiple stages.

### AWJ direction

Compare existing `purchases.view/manage` against actual AWJ purchasing workflows and decompose only where business/security value justifies it. No purchasing workflow or permission change is approved by this reference.

## 14. Inventory reports — security finding

Daftra evidence says reports inherit underlying resource/data scope.

### AWJ code-backed finding — P1 SECURITY GAP TO VERIFY/FIX

The inspected `InventoryReportController` delegates directly to `InventoryReportService::report()` and applies `SensitiveCostPolicy` redaction for cost fields. This is good for `products.view_cost`.

However, the inspected `InventoryReportService` builds warehouse balances, movements, stock operations and stocktakes from tenant-scoped data plus **request filters**. In the inspected code there is no use of `User::allowedWarehouseIds()` / `allowedBranchIds()` or the `ApiController` scope helpers. It even deliberately removes `BranchScope` for the tracked-products snapshot so it can produce tenant-wide inventory value.

That means the existing operational branch/warehouse access infrastructure is not visibly inherited by this report service in the inspected path. A restricted user with report permission may therefore be able to receive rows/totals outside their allowed branch/warehouse scope, depending on route/middleware and request validation not yet found to add equivalent restrictions.

This is exactly the class of bypass identified in the Daftra research:

```text
reports.view must not imply unrestricted source data
```

This finding must be treated as **high priority** and verified with targeted tests before implementation. It must also be checked for exports and other report services, not assumed universal from one service.

## 15. POS — findings so far

Daftra supports fine restrictions around POS/session behavior, including documented ways to restrict reopening previous sessions. AWJ already has explicit permissions for several sensitive POS actions and should prefer stable semantic permissions over URL/path blocking.

## 16. Blocked pages / explicit restrictions

Daftra provides an additional blocked-pages mechanism that can restrict specific pages/actions beyond general role permissions. AWJ should **not** copy URL/path-based authorization as its primary design.

AWJ should use stable semantic permission/policy keys for equivalent restrictions, resilient to route refactoring.

## 17. Application / feature state

Daftra documentation shows feature availability and authorization are separate. AWJ must preserve the distinction between tenant entitlement/application enabled state, tenant configuration/policy, and user authorization. A permission must not enable a feature the tenant does not have or has disabled.

## 18. Security and accounting invariants

Permissions must never override hard system invariants: Tenant Isolation, balanced posting/integrity, immutable/frozen states where mandated, period/fiscal locks according to approved policy, ZATCA lifecycle restrictions, and referential/data-integrity constraints.

`owner` / wildcard access means broad authorization inside allowed system behavior; it must not mean permission to violate accounting/compliance invariants.

## 19. Impersonation / "login as user"

Daftra documents an administrative ability to inspect the system as another user. This may be useful for AWJ support/permission troubleshooting, but it is not an initial implementation priority.

If implemented later: tightly restricted permission, original actor preserved, audit log, obvious impersonation state/banner, no tenant crossing, and explicit review/restriction of sensitive actions.

## 20. Accounting / general ledger — deeper findings

Daftra's accounting documentation adds an important distinction between **authorization** and **accounting object rules**.

- automatic/source journals must not become directly editable merely because a user has broad authority,
- reversal is a correction mechanism,
- drafts and final state matter,
- period/fiscal state remains authoritative.

AWJ must keep two layers separate:

```text
Authorization: may this user request this action?
Accounting invariant/state: is this action valid for this journal/period?
```

Candidate journal permission families remain research candidates until current AWJ journal routes/services are inspected.

## 21. HR / self-service / approval workflows

Daftra separates limited employee/self-service capabilities from full user permissions and makes approval stateful.

Target rule remains:

```text
canApprove(request, user) =
permission
∩ workflow membership
∩ current step
∩ request state
∩ domain rules
```

Current AWJ approval/workflow implementation still needs a dedicated code pass before status can be finalized.

## 22. Reports — scope inheritance target

The mandatory target remains:

```text
Report Result =
Report Permission
∩ Source Data Permission
∩ Branch Scope
∩ Resource Scope
∩ Record Scope
```

This applies to rows, totals/KPIs, drill-downs, CSV/Excel/PDF exports, generated files and report APIs.

The inventory report inspection above gives a concrete reason to audit this property across AWJ rather than treating it as theoretical.

## 23. Record scope — own / assigned / workflow-related

Daftra evidence adds a distinct authorization dimension beyond company/branch/resource scope.

Target model where a domain needs it:

```text
Record Scope
├── All records inside allowed higher-level scope
├── Own records
├── Assigned records
└── Workflow-related records
```

AWJ does not yet have a confirmed generic record-scope layer from this inspection. Do not invent a universal layer until concrete domains and ownership semantics are mapped.

## 24. Activity log / audit access

Daftra demonstrates that audit-event visibility and target-resource access are separate checks:

```text
Can view audit event != Can open/modify audited resource
```

AWJ activity/audit endpoints still require a dedicated inspection pass.

## 25. Administration / application-aware permissions

Target ordering remains:

```text
Tenant entitlement / enabled feature
AND
Tenant configuration/policy
AND
User role permission
AND
Applicable scope/policy
```

A role permission cannot activate an unavailable application.

## 26. Reconciled architecture conclusions

```text
AWJ Effective Authorization

Tenant Isolation
        ∩
Feature / Entitlement
        ∩
Role Permission
        ∩
Branch / Data Scope
        ∩
Resource Scope
        ∩
Record Scope
        ∩
Workflow Position
        ∩
Record State
        ∩
Accounting / Compliance Invariants
```

The important implementation lesson from the first AWJ code pass is: **several Daftra-like layers already exist in AWJ and must be reused rather than rebuilt.** The main task is coverage, consistency and missing dimensions — not replacement of the authorization foundation.

## 27. First code-backed gap matrix

| Daftra capability / target | AWJ current implementation found | Status | Decision |
|---|---|---|---|
| Tenant isolation | Tenant-scoped models + explicit tenant filtering for `User` | Present | Preserve; non-bypassable |
| Role permissions | `Rbac`, tenant roles, custom roles | Present | Evolve incrementally |
| User login enabled/disabled | `users.is_active`; auth rejects inactive users | Present | Preserve independently from employee lifecycle |
| Employee ↔ User | `users.employee_id`, tenant-safe unique linking | Present | Preserve |
| Allowed branches per user | `branch_user`, `allowedBranchIds`, UI + controller sync | Present | Reuse; audit coverage |
| Allowed warehouses per user | `user_warehouse`, `allowedWarehouseIds`, UI + controller sync | Present | Reuse; audit coverage |
| Direct warehouse access guards | `assertWarehouseAllowed`, `assertRecordAccessible`, list filtering | Present | Reuse centrally |
| Cashbox/bank deposit/withdraw ACL | `deposit_scope` / `withdraw_scope`: all/role/user/branch + service enforcement | Present | Reuse; verify all money paths |
| Role permission grouping | RoleDialog derives modules from catalogue | Partial | Generalize beyond view/manage |
| Role cloning | Not found in inspected role API/UI | Missing | Candidate UX parity feature |
| Permission dependency graph | Not confirmed | Missing/verify | Add only with explicit domain rules |
| Own/assigned sales record scope | Not found in targeted search | Missing/verify | Inspect invoice/sales semantics first |
| Inventory cost redaction in reports | `SensitiveCostPolicy` in InventoryReportController | Present | Preserve |
| Inventory report branch/warehouse inheritance | Not visible in inspected report path | **Likely security gap (P1)** | Verify with tests; fix centrally if confirmed |
| Report/export scope inheritance globally | Not yet audited | Unknown | Mandatory audit |
| Stateful approval authorization | Not yet inspected deeply | Unknown | Dedicated pass |
| Activity/audit drill-down authorization | Not yet inspected | Unknown | Dedicated pass |
| Feature/entitlement ∩ permission | Exists in parts of AWJ; not audited globally here | Partial/unknown | Dedicated coverage audit |

## 28. Important corrections to earlier research assumptions

The earlier research-only gap table said user branch scope, warehouse access and cashbox/bank resource permissions "need verification" / appeared to be likely gaps. Current code inspection corrects that:

1. **User branch scope already exists.**
2. **User warehouse scope already exists.**
3. **Cashbox/bank deposit/withdraw resource ACL already exists and is enforced in multiple financial services.**
4. The architectural risk is therefore not "build these from scratch" but **verify complete enforcement and report/export inheritance**.
5. The first concrete suspicious gap is `InventoryReportService`, which does not visibly consume user branch/warehouse scope in the inspected path.

This correction is important for avoiding duplicate ACL infrastructure and unnecessary migrations.

## 29. Documentation reconciliation checklist

All prior research findings remain represented here, and this pass additionally records:

- concrete `branch_user` / `user_warehouse` implementation,
- backward-compatible empty-scope = unrestricted convention,
- `ApiController` branch and warehouse guards,
- cash/bank scope implementation and enforcement callers,
- current RoleDialog limitation with fine-grained actions,
- role clone not found,
- inventory report scope-inheritance risk,
- own/assigned record scope not found by targeted search,
- corrected gap assessment so future work does not rebuild existing infrastructure.

No code was modified in this inspection. No database change, merge, deploy or production action is authorized by this document.

## 30. Next inspection pass

Before the Master Plan, continue code-backed inspection in this order:

1. **Reports and exports:** inventory first, then financial/sales reports; prove rows + totals + exports inherit user scope.
2. **Sales/invoices/customers:** inspect creator/salesperson/assignment fields and determine whether own/assigned scope exists or is needed.
3. **Approval workflows:** HR requests, leave and any purchase/document approvals; map permission + actor + state enforcement.
4. **Activity/audit:** permissions, branch/resource scope and safe drill-down.
5. **Role/RBAC catalogue:** map every current fine-grained action to RoleDialog UX and identify dependency candidates.
6. **Cash/bank coverage:** enumerate every money movement path and ensure `assertAllowed()` cannot be bypassed.

Then update the evidence matrix before proposing any implementation PRs.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
