# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — classification analytics, specialized report gates and invoice record-scope inspection  
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
- request branch IDs are filters, not visibly constrained to user allowed branches;
- service applies branch filtering only when supplied;
- no visible intersection with `allowedBranchIds()`;
- payments view uses the same request-driven pattern;
- totals use the same query family;
- salesperson is a filter, not authorization scope.

Static conclusion: a branch-restricted user with `reports.view` appears capable of widening sales report rows/totals outside allowed branches. Verify with executable tests before fixing.

## 15. Purchase report audit — STRONG LIKELY P1 GAP

`PurchaseReportService` explicitly calls `withoutGlobalScope(BranchScope::class)` and documents that no branch selection means all tenant branches. Request branch IDs are filters, not visibly intersected with user branch scope.

For unrestricted users this is intentional reporting behavior. For restricted users it appears to bypass their branch scope. Rows, totals, supplier balances and payment aggregates derived from the same family may all be affected.

## 16. Customer report audit — STRONG LIKELY P1 GAP

`CustomerReportService` removes `BranchScope` from invoice, receipt and appointment report sources and uses request branch filters without visible user-scope intersection. Customer report rows/totals therefore show the same likely intra-tenant branch widening pattern.

## 17. Core accounting reports — IMPORTANT DESIGN CONSTRAINT + AUTHORIZATION RISK

AWJ core accounting reports include trial balance, income statement, balance sheet, account ledger, journal entries, cash flow, tax report, partner statement, aging and cost-center profitability.

Routes are generally protected by `reports.view`. `ReportController::filters()` treats `branch_id` as optional and omission as all-branch aggregation, without visible intersection with user allowed branches.

This must **not** be fixed by applying a normal branch Global Scope to journal lines/entries. Existing AWJ architecture intentionally preserves complete journals and consolidated accounting. Accounting report authorization needs a report-aware scope intersection at the correct accounting dimension/query boundary while preserving journal completeness and balance.

## 18. Export/PDF/print propagation

General, sales, purchases, customers and inventory report workspaces generate CSV from already-loaded report rows. PDF/print are likewise derived from report document state in inspected paths.

```text
If API report data is over-broad,
CSV/PDF/print inherit the same over-broad data.
```

Backend report scope is therefore the primary security boundary.

## 19. Classification analytics — STRONG LIKELY P1 GAP CONFIRMED BY CODE

`ClassificationAnalyticsReportService` supports six scopes:

```text
sales_invoice
purchase_invoice
customer
supplier
receipt
payment
```

The route is guarded by generic `reports.view`.

Static code evidence is strong:

- sales/purchase document aggregation calls `withoutGlobalScope(BranchScope::class)`;
- receipt/payment aggregation also removes `BranchScope`;
- customer/supplier partner aggregation removes `BranchScope`;
- `applyDocumentFilters()` applies `branch_id[]` only when provided by the request;
- partner joins likewise apply requested branch IDs only when present;
- no visible `allowedBranchIds()` intersection exists in this service;
- totals are calculated from the same aggregated rows.

Therefore all six classification-analysis scopes appear capable of tenant-wide aggregation for a branch-restricted user who has `reports.view`, unless an unseen outer layer restricts filters. No such outer restriction was found in the inspected route/service path.

Status: **Strong likely P1 authorization gap; verify with restricted-user tests.**

## 20. Specialized reports — IMPORTANT POSITIVE CONTRAST

Specialized modules should not be lumped automatically into generic `reports.view`.

Confirmed examples:

- Fuel-station dashboard/report endpoints require dedicated `fuel.reports.view` **and** the commercial application gate `fuel_stations.maintenance`.
- POS audit overview/events require `pos.audit.view` plus the `sales.pos` app gate.
- POS audit export has its own `pos.audit.export` permission plus `sales.pos` app gate.

This is a stronger permission/feature model than the generic reporting subsystem and validates the target rule:

```text
Feature/App Enabled
AND
Semantic Permission
AND
Effective Data Scope
```

However, dedicated permission/app gates do **not** prove branch/resource/record-scope inheritance. Specialized query implementations still need scope audit where relevant.

## 21. Invoice operational access — BRANCH SCOPE PRESENT, RECORD SCOPE MISSING

Direct invoice access is materially better scoped than generic reports.

Confirmed from `Invoice` and `InvoiceController`:

- invoice stores both `created_by` and `salesperson_id`;
- `store()` sets `created_by` server-side from the authenticated user, preventing client spoofing of creator identity;
- `salesperson_id` is tenant-validated against `Employee`;
- invoice list uses `scopeToActiveBranch()`;
- direct `show()` also uses branch-scoped lookup;
- route requires `invoices.view`.

This means AWJ already has two credible record-scope dimensions available in the data model:

```text
Creator scope   -> invoices.created_by == user.id
Assigned scope  -> invoices.salesperson_id == linked employee.id
```

But the inspected `index()` does not apply either dimension as authorization. A user with `invoices.view` sees all invoices inside their permitted branch scope, not only records they created or are assigned to.

No separate permission or policy for "own invoices only" / "assigned invoices only" was found in this path.

Status: **Daftra parity gap confirmed at static code level.** This is not a Tenant Isolation bug because branch/tenant controls remain; it is missing record-level scope granularity.

### Important semantic design note

Do not collapse creator and salesperson into one generic "own" rule. Daftra behavior and AWJ fields support a domain-aware model where sales visibility may need configurable semantics such as:

```text
ALL_ALLOWED
CREATED_BY_ME
ASSIGNED_TO_ME
CREATED_OR_ASSIGNED_TO_ME
```

Exact product semantics and backward compatibility must be decided before implementation.

## 22. Systemic report conclusion — UPDATED

| Report family | Scope behavior found | Static assessment |
|---|---|---|
| Inventory | no visible branch/warehouse user-scope intersection | Likely P1 |
| Sales | request branch filter; no visible user intersection | Likely P1 |
| Purchases | explicit tenant-wide scope absent filter | Strong likely P1 |
| Customers | explicit BranchScope removal across multiple sources | Strong likely P1 |
| Classification analytics | explicit BranchScope removal across six scopes | **Strong likely P1** |
| Core accounting | optional branch filter; consolidated-all default | Authorization risk; accounting-sensitive |
| CSV/PDF/print | derived from loaded report rows | Inherits API disclosure |
| Fuel reports | dedicated permission + app gate | Better gate; data-scope audit still needed |
| POS audit/export | dedicated view/export permissions + app gate | Better gate; data-scope audit still needed |

Preferred direction remains a shared reporting authorization/scope contract, not frontend restrictions and not a blanket Global Scope.

## 23. Purchasing — workflow granularity

Daftra has a staged purchase workflow with granular actions. AWJ still has broad legacy `purchases.view/manage` in parts of the system. Decompose only where actual AWJ workflow/security value justifies it and preserve compatibility.

## 24. Accounting invariants

Authorization and accounting validity are separate:

```text
Authorization: may the user request the action?
Accounting invariant/state: is the action valid for this object/period?
```

Permissions must never override tenant isolation, ledger balance/integrity, source-generated journal rules, approved immutable/frozen states, period/fiscal locks or ZATCA lifecycle restrictions. `owner`/`*` does not mean "break accounting".

## 25. HR / self-service / approvals

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

## 26. Activity/audit

Audit visibility and target-resource authorization are separate:

```text
Can view audit event != Can open/modify audited resource
```

AWJ activity/audit endpoints still require dedicated inspection.

## 27. Feature/application state

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

## 28. Impersonation

Daftra's login-as-user is useful functional reference but not initial priority. If added later: restricted permission, original actor retained, audit trail, obvious impersonation state, no tenant crossing and review of sensitive operations.

## 29. Code-backed gap matrix — current

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
| Invoice branch scope | `scopeToActiveBranch()` list/show | Present | Preserve |
| Invoice creator attribution | server-set `created_by` | Present | Candidate record-scope input |
| Invoice salesperson assignment | tenant-validated `salesperson_id` | Present | Candidate assigned-scope input |
| Own/assigned invoice authorization | no record-scope predicate in index/show | **Missing / Daftra parity gap** | Define semantics + BC before implementation |
| Inventory cost redaction | `SensitiveCostPolicy` | Present | Preserve |
| Inventory report scope inheritance | no visible branch/warehouse intersection | **Likely P1 gap** | Restricted-user tests, then central fix |
| Sales report branch inheritance | request filter only; no visible user intersection | **Likely P1 gap** | Restricted-user tests, then central fix |
| Purchase report branch inheritance | explicit tenant-wide query absent request filter | **Strong likely P1 gap** | Restricted-user tests, then central fix |
| Customer report branch inheritance | explicit BranchScope removal across multiple sources | **Strong likely P1 gap** | Restricted-user tests, then central fix |
| Classification analytics scope | explicit BranchScope removal across all six scopes | **Strong likely P1 gap** | Restricted-user tests, then central fix |
| Core accounting report branch authorization | optional/all-branches report filter | **Risk confirmed; accounting-sensitive** | Design safe intersection; never truncate journals blindly |
| Report totals scope | derived from same query families | **Likely affected** | Test rows + totals together |
| CSV/PDF/print | client-side from report rows | **Inherits API scope** | Fix backend; verify exports |
| Fuel report permission/app gate | `fuel.reports.view` + commercial app | Present | Audit data scope separately |
| POS audit export gate | `pos.audit.export` + `sales.pos` | Present | Preserve; audit data scope separately |
| Stateful approvals | not yet deeply inspected | Unknown | Dedicated pass |
| Audit drill-down authorization | not yet inspected | Unknown | Dedicated pass |
| Feature entitlement ∩ permission | proven in specialized modules | Present in parts | Standardize coverage |

## 30. Corrections to earlier assumptions

1. User branch scope already exists.
2. User warehouse scope already exists.
3. Cashbox/bank deposit/withdraw ACL already exists.
4. The problem is coverage/consistency, not missing foundational models.
5. Generic report services are the clearest systemic coverage risk.
6. Classification analytics belongs to the same risk class, not an exception.
7. Export is mostly a propagation surface of report API data in inspected generic workspaces.
8. Accounting reports require a domain-safe treatment that preserves complete journals.
9. Specialized Fuel/POS endpoints demonstrate better semantic permission + feature gating.
10. Invoice records already carry creator and salesperson fields, so Daftra-like own/assigned scope can be built from real AWJ semantics rather than inventing a new ownership field; the authorization layer itself is currently missing.

## 31. Current-data status

Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**.

This does not relax schema safety, tenant isolation, authorization correctness, accounting invariants, backward-compatible application contracts where required, or future production readiness.

## 32. Documentation reconciliation

This living reference now contains substantive findings through classification analytics and the first direct invoice record-scope inspection. No substantive finding from this inspection is intentionally left only in chat.

## 33. Next inspection pass

Continue before any Master Plan or implementation:

1. Inspect partner/customer operational access to determine whether customer visibility also needs own/assigned semantics and how it relates to salesperson ownership.
2. Inspect HR/purchase/document approval workflows for permission + actor + state enforcement.
3. Inspect activity/audit endpoints and drill-down authorization.
4. Map the full `Rbac::PERMISSIONS` catalogue against RoleDialog rendering and identify dependency candidates.
5. Enumerate every cash/bank money movement path and prove `assertAllowed()` coverage.
6. Audit Fuel/POS specialized query data scope only where relevant.
7. After static inventory, use targeted executable tests for restricted branch/warehouse/record-scope users before proposing fixes.

After those checks, update the evidence matrix and only then propose an **AWJ Access Control V2 Master Plan**.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
