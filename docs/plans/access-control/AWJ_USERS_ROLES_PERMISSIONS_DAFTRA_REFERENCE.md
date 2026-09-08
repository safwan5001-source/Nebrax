# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — partner/customer ownership semantics and HR approval authorization inspection  
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

Current `RoleDialog` groups permissions by module, but its action UX is optimized for `view/manage`. This is insufficient for AWJ's modern fine-grained permissions such as approve/close/reopen/audit/export/recalculate/etc. No clone endpoint/action was found in the inspected role controller/dialog.

Target: preserve role safety, generalize the editor for arbitrary semantic actions, dependencies and risk labels, and consider cloning without changing permission semantics.

## 6. Permission granularity and dependencies

Daftra demonstrates action/field-level permissions beyond `view/manage`. AWJ newer modules already follow this pattern while older areas still rely on broad permissions such as `invoices.manage`, `products.manage`, `partners.manage`, `purchases.manage` and `hr.manage`.

Do not perform a big-bang rewrite. Fine-grained permissions should be introduced incrementally with explicit backward-compatibility behavior for legacy broad permissions.

## 7. Permission-aware UX

Target standardized states: Hidden, Read-only, Forbidden/disabled action, Filtered resource set, Scope-filtered rows/totals. UI hiding is never the security boundary.

## 8. Branch scope — PRESENT

AWJ has per-user branch assignments and `allowedBranchIds()` / `canAccessBranch()`. `ApiController::scopeToActiveBranch()` intersects operational queries with user scope. Preserve the backward-compatible unrestricted convention where no assignments means unrestricted legacy behavior.

## 9. Warehouse scope — PRESENT FOUNDATION

AWJ has `user_warehouse`, user predicates and central warehouse guards. Reuse this foundation; do not create a parallel warehouse ACL engine unless concrete requirements prove it insufficient.

## 10. Cashboxes / bank accounts — ACL ALREADY PRESENT

AWJ supports independent deposit/withdraw scopes using `all`, `role`, `user`, `branch`, with server enforcement. Reuse and audit coverage rather than rebuild.

## 11. Record scope — DOMAIN-AWARE

Daftra supports own/assigned/workflow-related records. AWJ target should remain domain-aware:

```text
Record Scope
├── All records inside higher-level scope
├── Own / created records
├── Assigned records
└── Workflow-related records
```

Do not define one global meaning of "own".

## 12. Reports — mandatory security property

```text
Report Result =
Report Permission
∩ Source Data Permission
∩ Branch Scope
∩ Resource Scope
∩ Record Scope
```

This applies to rows, totals/KPIs, drill-downs and exports. `reports.view` is not permission to ignore source-data scope.

## 13. Generic report scope findings

Static inspection has identified likely/strong likely P1 branch/resource scope gaps across:

- Inventory reports;
- Sales reports;
- Purchase reports;
- Customer reports;
- Classification analytics (all six scopes).

Core accounting reports also have an authorization risk because branch is an optional report filter, but their fix must be accounting-aware and must never truncate balanced journals through a naive Global Scope.

CSV/PDF/print in inspected generic workspaces derive from already-loaded report data and therefore inherit API disclosure.

## 14. Specialized report gates — POSITIVE CONTRAST

Fuel reports use dedicated `fuel.reports.view` plus app gating. POS audit has separate `pos.audit.view`, `pos.audit.export` and app gating. This is stronger semantic permission design, though query-level data scope still needs separate verification.

## 15. Invoice operational access — BRANCH SCOPE PRESENT, RECORD SCOPE MISSING

Invoices store both `created_by` and `salesperson_id`. `created_by` is set server-side; salesperson is tenant-validated. Invoice list/show are branch-scoped and require `invoices.view`.

But creator/salesperson are not currently authorization predicates. A user with invoice view sees all invoices in permitted branch scope.

Candidate domain semantics, subject to product decision and backward compatibility:

```text
ALL_ALLOWED
CREATED_BY_ME
ASSIGNED_TO_ME
CREATED_OR_ASSIGNED_TO_ME
```

## 16. Partner/customer operational access — NO OWNER/SALESPERSON FIELD TODAY

Direct inspection of `Partner` and `PartnerController` changes an important assumption:

- `Partner` has no `created_by`, `salesperson_id`, `assigned_to`, `owner_id` or account-manager field in its current fillable/model contract;
- customer/supplier visibility is primarily governed by `BranchScoped` + branch-sharing rules (`share_customers` / `share_suppliers`);
- `PartnerController::index()` relies on the Partner model's branch-sharing/global-scope behavior and supports type/search filtering;
- `show/update/destroy` use normal `Partner::findOrFail()`, therefore the model's operational branch-sharing scope remains the relevant visibility boundary;
- no current partner record-level owner/assignee predicate was found.

### Consequence

AWJ cannot safely implement Daftra-like "my customers" by simply reusing the invoice `salesperson_id`. A customer is a master-data entity and may have invoices assigned to multiple salespeople over time.

If AWJ product requirements include salesperson-owned/customer-assigned visibility, it needs an explicit **customer relationship/assignment semantic** rather than inferring ownership from transaction history.

Potential future concepts (not approved implementation keys):

```text
customer_account_manager / responsible_employee
customer_sales_assignment
team/territory assignment
```

Do not add any of these until Daftra behavior and AWJ CRM/sales requirements justify the exact model.

Status: **Daftra parity capability not present at Partner master-data level; requires product/data-model decision, not merely a query filter.**

## 17. HR leave approvals — STATE CHECK PRESENT, WORKFLOW/ACTOR SCOPE MISSING

`LeaveRequestController` provides a tenant-wide approval queue. Routes are gated by:

```text
hr.view   -> list approval queue
hr.manage -> approve / reject / delete
AND hr.employees app enabled
```

Controller approval/rejection checks that the request is still `pending` and records the authenticated user as `approved_by` with timestamp. This is good record-state enforcement and audit attribution.

However, no evidence was found in this approval path for:

- direct-manager relationship;
- department manager authority;
- configured approval chain/step;
- selected approver membership;
- branch-specific approver scope;
- self-approval prevention.

Therefore any user with broad `hr.manage` appears able to approve/reject any pending leave request visible in the tenant-level queue, subject to tenant isolation and feature gating.

Status: **Daftra workflow parity gap confirmed at static code level.**

## 18. General employee-request approvals — SAME BROAD PATTERN

`EmployeeRequestController` follows the same pattern:

- `hr.view` lists the cross-employee queue;
- `hr.manage` approves/rejects/deletes;
- approval/rejection requires pending state;
- actor and timestamp are recorded;
- no configured approver/step/manager/branch membership is visible in the controller path.

Thus `hr.manage` currently represents both HR administration and approval authority. This is broader than the target model.

### Target conceptual rule

```text
canApprove(request, user) =
feature enabled
∩ semantic approval permission
∩ branch/organizational scope
∩ workflow membership
∩ current approval step
∩ request state
∩ separation-of-duties/domain rules
```

This does **not** imply introducing a workflow engine immediately. First decide which AWJ HR workflows actually require manager/chain approvals and preserve current behavior through a backward-compatible migration path.

## 19. Approval architecture contrast inside AWJ

AWJ already contains stronger approval patterns elsewhere:

- Fuel shift service has a dedicated `fuel.shift.approve` semantic permission;
- POS loss-prevention contains explicit approval concepts and separation-of-duties/self-approval controls in relevant flows.

This proves AWJ does not need to invent approval security from scratch. Access Control V2 should reuse these design principles where appropriate rather than leaving all HR approval authority under `hr.manage`.

## 20. Accounting invariants

Authorization and accounting validity remain separate. Permissions never override tenant isolation, ledger integrity, immutable/source-generated rules, period/fiscal locks or ZATCA lifecycle restrictions.

## 21. Activity/audit

Audit visibility and target-resource authorization are separate:

```text
Can view audit event != Can open/modify audited resource
```

Dedicated inspection still required.

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

## 23. Recycle Bin / deleted transactions — SENSITIVE AUTHORITY

Daftra research identified explicit management permissions for deleted sales and purchase transactions, disabled by default in its role model, with recovery lifecycle for deleted transactions. AWJ should treat restore/permanent-delete/deleted-record access as high-risk authority and must not assume broad `manage` should permanently imply it.

Exact AWJ keys and behavior remain subject to code inspection and backward-compatibility design.

## 24. Impersonation

If added later: restricted permission, original actor retained, audit trail, obvious impersonation state, no tenant crossing and sensitive-operation review.

## 25. Code-backed gap matrix — current

| Capability | AWJ evidence | Status | Direction |
|---|---|---|---|
| Tenant isolation | Tenant-scoped models | Present | Preserve |
| Custom/system roles | RBAC + RoleController | Present | Preserve |
| Login enable/disable | `users.is_active` | Present | Preserve |
| Employee ↔ User | tenant-safe link | Present | Preserve |
| User allowed branches | branch assignments/predicates | Present | Audit consumers |
| User allowed warehouses | warehouse assignments/predicates | Present | Audit consumers |
| Cash/bank deposit/withdraw ACL | all/role/user/branch | Present | Verify all money paths |
| Role editor arbitrary actions | optimized around view/manage | Partial | Generalize |
| Role cloning | not found | Missing | Candidate parity feature |
| Invoice branch scope | list/show branch-scoped | Present | Preserve |
| Invoice own/assigned authorization | creator/salesperson fields exist, no predicate | **Missing** | Define domain semantics |
| Partner branch/share scope | `BranchScoped` + sharing keys | Present | Preserve |
| Partner owner/assignee scope | no owner/salesperson field | **Missing capability** | Product/data-model decision if required |
| Generic report effective scope | multiple report families bypass user scope | **Likely/strong likely P1** | Restricted-user tests then shared contract |
| Accounting report branch authorization | all-branch default | **Risk; accounting-sensitive** | Domain-safe design |
| HR leave approval state check | pending + actor/time | Present | Preserve |
| HR leave workflow membership | no manager/step/approver predicate found | **Missing** | Define approval policy |
| General employee-request workflow membership | same broad `hr.manage` pattern | **Missing** | Define approval policy |
| Dedicated approval permission pattern | Fuel/POS examples | Present elsewhere | Reuse principles |
| Audit drill-down authorization | not yet inspected | Unknown | Inspect next |
| Recycle-bin authority | Daftra reference documented; AWJ code not yet mapped | Unknown | Inspect |

## 26. Corrections / architectural conclusions

1. Branch, warehouse and cash/bank ACL foundations already exist.
2. Main issue is inconsistent consumption/coverage.
3. Generic reports are the clearest systemic authorization risk.
4. Invoice own/assigned scope can use existing real fields.
5. Partner/customer ownership cannot: there is no current partner owner/assignee field, and invoice salesperson history must not be treated as customer ownership.
6. HR approvals enforce state but currently use broad `hr.manage` authority rather than workflow membership.
7. AWJ already has stronger semantic approval patterns in Fuel/POS that can inform a consistent target architecture.
8. Deleted-record management is explicitly retained as a sensitive permission area in this reference and must not be lost from the final plan.

## 27. Current-data status

Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**.

This does not relax schema safety, tenant isolation, authorization correctness, accounting invariants, backward-compatible contracts where required, or future production readiness.

## 28. Documentation reconciliation

This living reference now includes the partner/customer ownership finding, HR leave/general-request approval findings, the stronger AWJ Fuel/POS approval contrast, and an explicit Recycle Bin/deleted-transactions section so that this previously researched Daftra capability is not omitted from the final plan.

No substantive finding from this inspection is intentionally left only in chat.

## 29. Next inspection pass

1. Inspect activity/audit endpoints, event payload visibility and drill-down authorization.
2. Inspect deleted-record/restore/permanent-delete behavior in AWJ.
3. Map the full `Rbac::PERMISSIONS` catalogue against RoleDialog rendering and identify dependency/risk-label candidates.
4. Enumerate every cash/bank money movement path and prove `assertAllowed()` coverage.
5. Audit specialized Fuel/POS query data scope where relevant.
6. Then use targeted executable restricted-user tests before proposing fixes.

After these checks, update the evidence matrix and only then propose an **AWJ Access Control V2 Master Plan**.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
