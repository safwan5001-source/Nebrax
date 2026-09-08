# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — reports/scope code audit expanded to inventory, sales and purchases  
**Scope:** Users, Employees, Roles, Permissions, Branch Scope, Resource Access, Record Scope, Workflow/Record State, Reports, permission-aware UX.  
**Reference product:** Daftra official documentation.  

> This document is a functional research/reference artifact. It does **not** authorize implementation, database changes, permission migrations, merge/deploy, or changes to accounting/security rules.

## 1. Decision

Daftra is the functional reference for the AWJ users / roles / permissions experience. AWJ should provide the same overall operating model and flexibility while using AWJ-native stable permission keys and stronger security/accounting invariants. URL/path-based blocked pages are a functional reference only, not the desired AWJ authorization architecture.

## 2. Target authorization model

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

All layers are restrictive intersections. Lower-level access never overrides a higher-level denial or hard accounting/compliance invariant.

## 3. Confirmed AWJ baseline

Current AWJ already has substantial access-control infrastructure:

- tenant-scoped roles with JSON permissions and protected system roles;
- central `Rbac::PERMISSIONS` catalogue;
- custom roles;
- Employee ↔ User linking (`users.employee_id`);
- `users.is_active` independent from employee deletion;
- per-user branch scope through `branch_user`;
- per-user warehouse scope through `user_warehouse`;
- reusable server-side branch/warehouse access guards;
- cashbox/bank deposit and withdraw ACLs;
- many explicit sensitive permissions in newer modules;
- cost/profit redaction via `products.view_cost` / `SensitiveCostPolicy` in relevant report paths.

Important architectural conclusion: **do not rebuild these foundations.** Access Control V2 is primarily a consistency/coverage/granularity project.

## 4. Employee vs User

Daftra distinguishes employee identity from system login. AWJ already follows the same core model (`User ⊃ Employee`). Preserve employee lifecycle, login status, role assignment and access scope as separate concerns. Disabling login must not delete employee history or alter financial audit attribution.

## 5. Roles and role UX

AWJ `RoleController` already supports create/update/delete custom roles, assigned-user counts, owner immutability and system-role deletion protection. `Rbac::PERMISSIONS` is returned as the canonical catalogue.

Current `RoleDialog` groups permissions by module, but its action UX is optimized for `view/manage`: `ACTION_ORDER` only lists those actions and non-`manage` actions fall into the view-label path. This is insufficient for AWJ's modern fine-grained permissions such as approve/close/reopen/audit/export/recalculate/etc.

No clone endpoint/action was found in the inspected role controller/dialog. Role cloning is therefore a current parity gap unless later code inspection finds another path.

Target: preserve role safety, generalize the editor for arbitrary semantic actions, dependencies and risk labels, and consider cloning without changing permission semantics.

## 6. Permission granularity and dependencies

Daftra demonstrates action/field-level permissions beyond `view/manage`. AWJ newer modules already follow this pattern while older areas still rely on broad permissions such as `invoices.manage`, `products.manage`, `partners.manage`, `purchases.manage`.

Do not perform a big-bang rewrite. Fine-grained permissions should be introduced incrementally with explicit backward-compatibility behavior for legacy broad permissions.

Permission dependencies should be explicit where justified, for example manage/update/approve requiring the corresponding view authority. Exact dependency rules must be domain-specific and server-tested.

## 7. Permission-aware UX

Target standardized states:

1. Hidden.
2. Read-only.
3. Forbidden/disabled action.
4. Filtered resource set.
5. Scope-filtered rows/totals.

UI hiding is never the security boundary; backend policy remains authoritative.

## 8. Branch scope — PRESENT

AWJ `User` has `branches()` through `branch_user`, `allowedBranchIds()` and `canAccessBranch()`. `UserController::syncAccessScope()` persists and tenant-validates branch IDs; `UserResource` and User UI expose them.

`ApiController::scopeToActiveBranch()` intersects queries with user scope. `?branch=all` means all **allowed** branches, not all tenant branches.

Backward-compatible convention:

```text
no assignments / [] relation => unrestricted legacy behavior
allowedBranchIds() => null when unrestricted
```

Preserve this unless a separately approved migration intentionally changes it.

## 9. Warehouse scope — PRESENT FOUNDATION

AWJ has `user_warehouse`, `allowedWarehouseIds()` and `canAccessWarehouse()` plus central helpers:

- `assertWarehouseAllowed()`;
- `assertRecordAccessible()`;
- `scopeToAccessibleWarehouses()`.

This protects direct access and list queries where callers use the helpers.

Daftra has separate warehouse-local concepts (view / use in invoice / modify inventory). AWJ may be able to express the same effective behavior more simply as:

```text
global semantic action permission ∩ allowed warehouse
```

Do not add a parallel warehouse ACL engine unless concrete requirements prove the current intersection insufficient.

## 10. Cashboxes / bank accounts — ACL ALREADY PRESENT

`CashBankAccount` stores independent:

```text
deposit_scope + deposit_scope_subject
withdraw_scope + withdraw_scope_subject
```

`CashBankAccountService` supports scope types `all`, `role`, `user`, `branch`. `CashBankAccount::allows()` evaluates them and `assertAllowed()` enforces them with active branch context.

Inspected financial callers include transfer source/destination, employee custody and supplier refund; existing implementation evidence also shows payment-flow use. This Daftra-like financial resource ACL should be reused, not rebuilt.

Current representation is one scope mode + one subject per action rather than arbitrary multi-subject unions. Do not generalize without a real product need.

## 11. Record scope — Daftra reference and AWJ status

Daftra supports concepts equivalent to own/assigned/workflow-related records. Target model where justified:

```text
Record Scope
├── All records inside higher-level scope
├── Own records
├── Assigned records
└── Workflow-related records
```

No generic own/assigned sales-record scope has been confirmed in AWJ yet. Sales invoices do have a `salesperson_id` dimension in reporting, but that is currently a request filter, not evidence of authorization scope.

Do not define a global meaning of "own". Per domain it may mean creator, salesperson, assignee, responsible employee or requester.

## 12. Reports — mandatory security property

Daftra evidence establishes that opening a report must not widen underlying data access. AWJ target:

```text
Report Result =
Report Permission
∩ Source Data Permission
∩ Branch Scope
∩ Resource Scope
∩ Record Scope
```

The same rule applies to rows, totals/KPIs, drill-downs, CSV/Excel/PDF exports, generated files and report APIs.

`reports.view` is permission to use the reporting capability, **not** permission to ignore source-data scope.

## 13. Inventory report audit — LIKELY P1 SCOPE GAP

`InventoryReportController` applies `SensitiveCostPolicy`, so cost fields are redacted based on cost permission. Preserve this.

But the inspected `InventoryReportService` builds warehouse balances, movements, stock operations and stocktakes from tenant-scoped data plus request filters. No consumption of `allowedWarehouseIds()` / `allowedBranchIds()` or central branch/warehouse helpers was visible in the inspected path. It also deliberately removes `BranchScope` for a tenant-wide tracked-product snapshot.

Therefore branch/warehouse restrictions appear not to be inherited automatically by this report path. This is a **likely P1 authorization gap** pending executable restricted-user tests.

The fact that current records are disposable/test data does not reduce the severity of the architectural issue: the concern is future production authorization behavior, not preservation of current rows.

## 14. Sales report audit — SAME CLASS OF BRANCH-SCOPE RISK

The second report pass found the same pattern in `SalesReportService`.

### Confirmed code facts

- Route is protected by `reports.view`.
- `SalesReportRequest::authorize()` returns `true`; route middleware is therefore the general permission boundary.
- `SalesReportRequest` accepts `branch_id[]` as UUID filters but does not constrain those IDs to the authenticated user's allowed branches.
- `SalesReportController` passes validated filters directly to `SalesReportService`.
- `SalesReportService::invoices()` uses posted sale invoices and applies `branch_id` only when supplied by the request.
- With no branch filter, the service does not visibly intersect results with `User::allowedBranchIds()`.
- The `payments` view follows the same request-driven branch-filter pattern.
- Totals are computed from the same service query family, so any scope widening affects totals as well as visible rows.
- Salesperson filtering (`invoices.salesperson_id`) is a report filter, not an authorization rule.

### Security conclusion

A branch-restricted user with `reports.view` appears capable, from static inspection, of requesting no branch filter (or potentially another tenant branch UUID) and receiving report aggregates outside their allowed branch scope. Tenant isolation still protects against another tenant, but **intra-tenant branch isolation is not visibly enforced here**.

Status: **Likely P1 authorization gap; verify with tests before fixing.**

## 15. Purchase report audit — STRONGER EVIDENCE OF SAME GAP

`PurchaseReportService` makes the intended report behavior explicit in code:

```text
withoutGlobalScope(BranchScope::class)
```

with a comment that no branch selection means all tenant branches. It then applies `branch_id[]` only when the request provides it.

This is valid for an unrestricted user, but it conflicts with per-user allowed-branch authorization unless the service intersects requested/all branches with the authenticated user's scope elsewhere. No such intersection was found in the inspected service/request path.

Therefore a branch-restricted user with `reports.view` appears able to receive purchase report data for all tenant branches when no branch filter is supplied. This is **strong static evidence of the same P1 authorization-class gap**, still to be confirmed by executable tests.

This issue affects not only rows but any totals/balances/payment aggregations derived from the unrestricted query family.

## 16. Cross-report conclusion after second pass

The earlier Inventory finding is no longer an isolated suspicion. Three analytical report families now show the same design pattern:

| Report family | General permission | User branch/resource scope visibly inherited? | Static assessment |
|---|---|---|---|
| Inventory | `reports.view` | No visible branch/warehouse intersection in inspected path | Likely P1 gap |
| Sales | `reports.view` | No visible user-branch intersection; request filter only | Likely P1 gap |
| Purchases | `reports.view` | Explicit tenant-wide branch scope unless request filter supplied | Strong likely P1 gap |

This suggests a **systemic report authorization coverage problem**, not three unrelated bugs.

Preferred design direction is a shared reporting-scope primitive that intersects user access before report aggregation, rather than one-off UI restrictions or duplicated controller patches. Exact implementation is not authorized yet and must be designed after tests and wider report/export inventory.

## 17. Sales / invoices — sensitive actions

Daftra research confirms permissions/policies inside invoices: profit visibility, payment-date changes, tax/ZATCA submission, discount controls, free item editing and numbering controls.

AWJ already has some fine-grained sales permissions such as `sales.minimum_price_override` and separate ZATCA-related capabilities. Broader legacy invoice permissions still need route/action mapping before deciding decomposition.

Own/assigned invoice scope remains unconfirmed and requires direct Invoice model/controller inspection.

## 18. Purchasing — workflow granularity

Daftra has a staged purchase workflow with granular actions. AWJ still has broad legacy `purchases.view/manage` in parts of the system. Decompose only where actual AWJ workflow/security value justifies it and preserve compatibility.

## 19. Accounting invariants

Authorization and accounting validity are separate:

```text
Authorization: may the user request the action?
Accounting invariant/state: is the action valid for this object/period?
```

Permissions must never override tenant isolation, ledger balance/integrity, source-generated journal rules, approved immutable/frozen states, period/fiscal locks or ZATCA lifecycle restrictions. `owner`/`*` does not mean "break accounting".

## 20. HR / self-service / approvals

Daftra shows stateful approval. Target rule:

```text
canApprove(record, user) =
permission
∩ workflow membership
∩ current step
∩ record state
∩ domain rules
```

AWJ approval implementations still need dedicated inspection.

## 21. Activity/audit

Audit visibility and target-resource authorization are separate:

```text
Can view audit event != Can open/modify audited resource
```

AWJ activity/audit endpoints still require dedicated inspection.

## 22. Feature/application state

Target ordering:

```text
Tenant entitlement / enabled feature
AND
Tenant configuration/policy
AND
User role permission
AND
Applicable scope/policy
```

Permission never activates an unavailable tenant feature.

## 23. Impersonation

Daftra's login-as-user is useful functional reference but not initial priority. If added later: restricted permission, original actor retained, audit trail, obvious impersonation state, no tenant crossing and review of sensitive operations.

## 24. Code-backed gap matrix — current

| Capability | AWJ evidence | Status | Direction |
|---|---|---|---|
| Tenant isolation | Tenant-scoped models + explicit user tenant filtering | Present | Preserve, non-bypassable |
| Custom/system roles | `Rbac`, `RoleController`, role table | Present | Preserve |
| Login enable/disable | `users.is_active` | Present | Preserve independently from employee lifecycle |
| Employee ↔ User | `employee_id` with tenant-safe linking | Present | Preserve |
| User allowed branches | `branch_user`, user predicates, controller/UI sync | Present | Reuse; audit consumers |
| User allowed warehouses | `user_warehouse`, user predicates, controller/UI sync | Present | Reuse; audit consumers |
| Direct branch/warehouse guards | `ApiController` helpers | Present | Reuse centrally |
| Cash/bank deposit/withdraw ACL | all/role/user/branch + server enforcement | Present | Reuse; verify all money paths |
| Role module grouping | current RoleDialog | Partial | Generalize arbitrary actions |
| Role cloning | not found in inspected API/UI | Missing | Candidate parity feature |
| Permission dependencies | not confirmed | Missing/verify | Domain-specific graph only |
| Own/assigned sales scope | not found; salesperson exists as data/filter | Missing/verify | Inspect invoice semantics |
| Inventory cost redaction | `SensitiveCostPolicy` | Present | Preserve |
| Inventory report scope inheritance | no visible branch/warehouse intersection | **Likely P1 gap** | Restricted-user tests, then central fix |
| Sales report branch inheritance | request filter only; no visible user intersection | **Likely P1 gap** | Restricted-user tests, then central fix |
| Purchase report branch inheritance | explicit tenant-wide query absent request filter | **Strong likely P1 gap** | Restricted-user tests, then central fix |
| Report totals scope | derived from same query families | **Likely affected** | Test rows + totals together |
| Exports/generated reports | not yet inventoried | Unknown | Next report pass |
| Stateful approvals | not yet deeply inspected | Unknown | Dedicated pass |
| Audit drill-down authorization | not yet inspected | Unknown | Dedicated pass |
| Feature entitlement ∩ permission | exists in parts, not audited globally | Partial/unknown | Coverage audit |

## 25. Corrections to earlier assumptions

Research initially treated branch scope, warehouse scope and cash/bank ACL as likely gaps. Code inspection corrected this:

1. User branch scope already exists.
2. User warehouse scope already exists.
3. Cashbox/bank deposit/withdraw ACL already exists.
4. The problem is coverage/consistency, not missing foundational models.
5. Report services are now the clearest systemic coverage risk.

This correction must remain visible so no future plan creates duplicate access-control infrastructure.

## 26. Current-data status

Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**.

Planning implication: implementation/migration strategy does not need to preserve the business value of current test transactions as if they were live production records. However, this does **not** relax requirements for schema safety, tenant isolation, authorization correctness, accounting invariants, backward-compatible application contracts where still required, or future production readiness.

## 27. Documentation reconciliation

This living reference now contains all substantive findings from the thread through the sales/purchase report inspection, including:

- Daftra functional model;
- target multi-layer authorization formula;
- current AWJ RBAC foundation;
- Employee/User lifecycle;
- per-user branches and warehouses;
- cash/bank ACL;
- role-editor limitations and cloning gap;
- permission granularity/dependencies;
- own/assigned record-scope concept;
- accounting/workflow invariants;
- report scope inheritance requirement;
- inventory report scope risk;
- sales report scope risk;
- purchase report scope risk;
- current test-data status.

No substantive finding from this inspection is intentionally left only in chat.

## 28. Next inspection pass

Continue before any Master Plan or implementation:

1. Inventory of **all report/export endpoints** and classify which use tenant-wide queries, BranchScope removal, request-only branch filters, or central scope helpers.
2. Inspect sales/invoice/customer models/controllers to define own/assigned semantics from actual fields.
3. Inspect HR/purchase/document approval workflows for permission + actor + state enforcement.
4. Inspect activity/audit endpoints and drill-down authorization.
5. Map the full `Rbac::PERMISSIONS` catalogue against RoleDialog rendering and identify dependency candidates.
6. Enumerate every cash/bank money movement path and prove `assertAllowed()` coverage.

After those checks, update the evidence matrix and only then propose an **AWJ Access Control V2 Master Plan**.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
