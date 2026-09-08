# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — report/export scope audit expanded across analytical, customer and accounting reports  
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

## 14. Sales report audit — LIKELY P1 BRANCH-SCOPE GAP

Confirmed code facts:

- route uses `reports.view`;
- `SalesReportRequest::authorize()` returns true;
- request accepts `branch_id[]` UUID filters but does not constrain them to the user's allowed branches;
- controller passes filters to the service;
- service applies branch filtering only when supplied;
- no visible intersection with `allowedBranchIds()`;
- payments view uses the same request-driven pattern;
- totals use the same query family;
- salesperson is a filter, not authorization scope.

Static conclusion: a branch-restricted user with `reports.view` appears capable of widening sales report rows/totals outside allowed branches. Tenant isolation remains intact, but intra-tenant branch authorization is not visibly inherited. Verify with executable tests before fixing.

## 15. Purchase report audit — STRONG LIKELY P1 GAP

`PurchaseReportService` explicitly calls `withoutGlobalScope(BranchScope::class)` and documents that no branch selection means all tenant branches. Request branch IDs are filters, not visibly intersected with user branch scope.

For unrestricted users this is intentional reporting behavior. For restricted users it appears to bypass their branch scope. Rows, totals, supplier balances and payment aggregates derived from the same family may all be affected.

## 16. Customer report audit — STRONG LIKELY P1 GAP

The wider report inventory found the same design explicitly in `CustomerReportService`:

- invoice-based customer sales/balance reports remove `BranchScope`;
- code comment states no branch selection = all tenant branches;
- customer receipt reports remove `BranchScope`;
- customer appointment reports remove `BranchScope`;
- branch filters are applied only when the request supplies them;
- no visible intersection with the authenticated user's `allowedBranchIds()` in the inspected service path.

Therefore customer sales, balances, receipts and appointments appear vulnerable to the same intra-tenant branch-scope widening for a restricted user with `reports.view`.

This confirms the problem spans both financial and operational report sources.

## 17. Core accounting reports — IMPORTANT DESIGN CONSTRAINT + AUTHORIZATION RISK

AWJ core accounting reports include at least:

- trial balance;
- income statement;
- balance sheet;
- account ledger;
- journal entries;
- cash flow;
- tax report;
- partner statement;
- aging;
- cost-center profitability.

Routes are generally protected by `reports.view`.

`ReportController::filters()` explicitly treats `branch_id` as optional and documents that omitting it leaves reports aggregated across all branches. The controller does not visibly intersect a requested branch with `request()->user()->allowedBranchIds()`.

### Critical accounting constraint

This must **not** be fixed by applying a normal branch Global Scope to journal lines/entries. Existing AWJ multi-branch architecture intentionally keeps accounting data globally complete so a balanced journal is not silently truncated and consolidated accounting remains correct.

`ApiController` itself documents this distinction: operational display lists use explicit branch scoping while `ReportService` accounting calculations must not be damaged by an indiscriminate global branch filter.

Therefore accounting report authorization needs a report-aware scope intersection at the appropriate accounting dimension/query boundary, preserving journal completeness and balancing rules.

Static assessment: **authorization risk confirmed at controller/filter design level; accounting-safe implementation requires dedicated design and tests.**

## 18. Export/PDF/print propagation — CONFIRMED CLIENT-SIDE DERIVATION

The current report workspaces for general, sales, purchases, customers and inventory generate CSV from the already-loaded report document rows (`doc.rows` + totals) in the browser. PDF/print flows are likewise built from the report document state rather than fetching an independently authorized server-side export dataset in the inspected paths.

Security consequence:

```text
If API report data is over-broad,
CSV/PDF/print inherit the same over-broad data.
```

Conversely, fixing only export buttons would not solve the disclosure because the raw report API response is already the security boundary.

This makes the backend report-scope correction the primary requirement. Export tests should verify propagation, but export UI must not become the authorization layer.

## 19. Systemic report conclusion after wider inventory

The issue is now clearly systemic rather than isolated:

| Report family | Scope behavior found | Static assessment |
|---|---|---|
| Inventory | no visible branch/warehouse user-scope intersection | Likely P1 |
| Sales | request branch filter; no visible user intersection | Likely P1 |
| Purchases | explicit tenant-wide scope absent filter | Strong likely P1 |
| Customers | explicit BranchScope removal across invoices/payments/appointments | Strong likely P1 |
| Core accounting | optional branch filter; consolidated-all default | Authorization risk; accounting-sensitive |
| CSV/PDF/print | derived from loaded report rows | Inherits API disclosure |

The preferred architectural direction is a **shared reporting authorization/scope contract**, not duplicated frontend restrictions and not a blanket Global Scope.

Conceptually:

```text
Requested Report Scope
        ∩
User Allowed Branch Scope
        ∩
User Allowed Resource Scope (where relevant)
        ∩
Record Scope (where relevant)
        ↓
Domain-safe report query
        ↓
Rows + Totals + Drilldowns + Exports
```

For accounting reports, the domain-safe query must preserve complete/balanced journal semantics.

No implementation is authorized by this reference yet.

## 20. Classification analytics and specialized report families — STILL TO VERIFY

`classification-analytics` is a separate report service and remains to be inspected for the same scope rules. Fuel-station reports and POS audit/investigation exports use specialized permissions/application gates and should be audited separately rather than assumed equivalent to generic `reports.view`.

This distinction matters: specialized modules may already have stronger local authorization than the generic report subsystem.

## 21. Sales / invoices — sensitive actions

Daftra research confirms permissions/policies inside invoices: profit visibility, payment-date changes, tax/ZATCA submission, discount controls, free item editing and numbering controls.

AWJ already has some fine-grained sales permissions such as `sales.minimum_price_override` and separate ZATCA-related capabilities. Broader legacy invoice permissions still need route/action mapping before deciding decomposition.

Own/assigned invoice scope remains unconfirmed and requires direct Invoice model/controller inspection.

## 22. Purchasing — workflow granularity

Daftra has a staged purchase workflow with granular actions. AWJ still has broad legacy `purchases.view/manage` in parts of the system. Decompose only where actual AWJ workflow/security value justifies it and preserve compatibility.

## 23. Accounting invariants

Authorization and accounting validity are separate:

```text
Authorization: may the user request the action?
Accounting invariant/state: is the action valid for this object/period?
```

Permissions must never override tenant isolation, ledger balance/integrity, source-generated journal rules, approved immutable/frozen states, period/fiscal locks or ZATCA lifecycle restrictions. `owner`/`*` does not mean "break accounting".

## 24. HR / self-service / approvals

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

## 25. Activity/audit

Audit visibility and target-resource authorization are separate:

```text
Can view audit event != Can open/modify audited resource
```

AWJ activity/audit endpoints still require dedicated inspection.

## 26. Feature/application state

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

## 27. Impersonation

Daftra's login-as-user is useful functional reference but not initial priority. If added later: restricted permission, original actor retained, audit trail, obvious impersonation state, no tenant crossing and review of sensitive operations.

## 28. Code-backed gap matrix — current

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
| Customer report branch inheritance | explicit BranchScope removal across multiple sources | **Strong likely P1 gap** | Restricted-user tests, then central fix |
| Core accounting report branch authorization | optional/all-branches report filter | **Risk confirmed; accounting-sensitive** | Design safe intersection; never truncate journals blindly |
| Report totals scope | derived from same query families | **Likely affected** | Test rows + totals together |
| CSV/PDF/print | client-side from report rows | **Inherits API scope** | Fix backend; verify exports |
| Classification analytics | separate service | Unknown | Inspect next |
| Specialized fuel/POS reports | specialized permissions/app gates | Unknown/possibly stronger | Audit separately |
| Stateful approvals | not yet deeply inspected | Unknown | Dedicated pass |
| Audit drill-down authorization | not yet inspected | Unknown | Dedicated pass |
| Feature entitlement ∩ permission | exists in parts, not audited globally | Partial/unknown | Coverage audit |

## 29. Corrections to earlier assumptions

Research initially treated branch scope, warehouse scope and cash/bank ACL as likely gaps. Code inspection corrected this:

1. User branch scope already exists.
2. User warehouse scope already exists.
3. Cashbox/bank deposit/withdraw ACL already exists.
4. The problem is coverage/consistency, not missing foundational models.
5. Generic report services are now the clearest systemic coverage risk.
6. Export is mostly a propagation surface of report API data, not a separate authorization boundary in the inspected report workspaces.
7. Accounting reports require a different technical treatment from operational report rows because journal completeness/balance must never be broken by naive scoping.

## 30. Current-data status

Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**.

Planning implication: implementation/migration strategy does not need to preserve the business value of current test transactions as if they were live production records. However, this does **not** relax requirements for schema safety, tenant isolation, authorization correctness, accounting invariants, backward-compatible application contracts where still required, or future production readiness.

## 31. Documentation reconciliation

This living reference now contains the substantive findings through the wider report/export inventory:

- Daftra functional model and target authorization formula;
- current AWJ RBAC/branch/warehouse/cash-bank foundations;
- Employee/User lifecycle;
- role editor limitations and cloning gap;
- permission granularity/dependencies;
- record-scope concept;
- accounting/workflow invariants;
- report scope inheritance requirement;
- inventory, sales, purchase and customer report scope findings;
- accounting-report authorization constraint;
- CSV/PDF/print propagation finding;
- current test-data status.

No substantive finding from this inspection is intentionally left only in chat.

## 32. Next inspection pass

Continue before any Master Plan or implementation:

1. Inspect `ClassificationAnalyticsReportService` and specialized report endpoints to complete report-family classification.
2. Inspect sales/invoice/customer models/controllers to define own/assigned semantics from actual fields.
3. Inspect HR/purchase/document approval workflows for permission + actor + state enforcement.
4. Inspect activity/audit endpoints and drill-down authorization.
5. Map the full `Rbac::PERMISSIONS` catalogue against RoleDialog rendering and identify dependency candidates.
6. Enumerate every cash/bank money movement path and prove `assertAllowed()` coverage.
7. After static inventory, use targeted executable tests for restricted branch/warehouse users before proposing a fix.

After those checks, update the evidence matrix and only then propose an **AWJ Access Control V2 Master Plan**.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
