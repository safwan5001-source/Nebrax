# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — activity/audit visibility and deleted-record lifecycle inspection  
**Scope:** Users, Employees, Roles, Permissions, Branch Scope, Resource Access, Record Scope, Workflow/Record State, Reports, permission-aware UX.  
**Reference product:** Daftra official documentation.  

> This document is a functional research/reference artifact. It does **not** authorize implementation, database changes, permission migrations, merge/deploy, or changes to accounting/security rules.

## 1. Decision
Daftra is the functional reference for the AWJ users / roles / permissions experience. AWJ should provide the same overall operating model and flexibility while using AWJ-native stable permission keys and stronger security/accounting invariants. URL/path-based blocked pages are a functional reference only, not the desired AWJ authorization architecture.

## 2. Target authorization model
```text
Tenant Isolation
∩ Feature / Entitlement
∩ Role Permission
∩ Branch / Data Scope
∩ Resource Scope
∩ Record Scope
∩ Workflow Position
∩ Record State
∩ Accounting / Compliance Invariants
```
All layers are restrictive intersections.

## 3. Confirmed AWJ baseline
Current AWJ already has tenant-scoped roles, canonical RBAC permissions, custom roles, Employee↔User linking, independent user active state, per-user branch and warehouse scope, reusable branch/warehouse guards, cash/bank deposit-withdraw ACLs, and explicit sensitive permissions in newer modules. Access Control V2 is primarily consistency/coverage/granularity, not rebuilding foundations.

## 4. Employee vs User
Preserve employee lifecycle, login status, role assignment and access scope as separate concerns. Disabling login must not delete employee history or alter audit attribution.

## 5. Roles and permission granularity
Role backend supports custom/system roles and safety controls. Role UI is still optimized around `view/manage` and no clone path was found. Older broad permissions (`invoices.manage`, `partners.manage`, `purchases.manage`, `hr.manage`) coexist with newer semantic permissions. Fine-grained decomposition must be incremental and backward-compatible.

## 6. Permission-aware UX
Standardize Hidden, Read-only, Forbidden, Filtered resource set, Scope-filtered rows/totals. UI hiding is never the security boundary.

## 7. Branch / warehouse / treasury foundations
- User branch scope: present.
- User warehouse scope: present.
- Cash/bank deposit/withdraw ACL: present with `all`, `role`, `user`, `branch` subjects.
Reuse these mechanisms and audit consumers rather than create parallel ACL systems.

## 8. Record scope — domain-aware
```text
Record Scope
├── All records inside higher-level scope
├── Own / created records
├── Assigned records
└── Workflow-related records
```
Do not define one global meaning of "own".

## 9. Reports — mandatory security property
```text
Report Result = Report Permission ∩ Source Data Permission ∩ Branch Scope ∩ Resource Scope ∩ Record Scope
```
Rows, totals, drill-downs and exports must obey the same scope. Static inspection has identified likely/strong-likely P1 scope gaps in Inventory, Sales, Purchases, Customers and Classification Analytics. Core accounting reports need accounting-aware authorization rather than a naive branch Global Scope. Generic CSV/PDF/print inherit loaded API data.

Specialized Fuel/POS endpoints demonstrate stronger semantic permission + feature gating.

## 10. Invoice operational record scope
Invoices already store server-authored `created_by` and tenant-validated `salesperson_id`; branch scope is present, but own/assigned authorization is missing. Candidate semantics require product/BC decision: ALL_ALLOWED / CREATED_BY_ME / ASSIGNED_TO_ME / CREATED_OR_ASSIGNED_TO_ME.

## 11. Partner/customer operational scope
`Partner` has no current owner/salesperson/assignee/creator field. Visibility uses BranchScoped plus customer/supplier branch-sharing rules. Therefore customer ownership must not be inferred from invoice salesperson history. If Daftra-like "my customers" is required, AWJ needs an explicit customer relationship/assignment semantic after product/data-model decision.

## 12. HR approvals
Leave and general employee requests enforce pending state and record approver/time, but routes use broad `hr.manage` for approve/reject/delete. No direct-manager, department-manager, configured chain/step, selected approver, branch approver or self-approval predicate was found in those paths.

Target conceptual rule:
```text
canApprove = feature ∩ semantic approval permission ∩ organizational scope ∩ workflow membership ∩ current step ∩ state ∩ SoD/domain rules
```
Fuel/POS already contain stronger semantic approval patterns that can inform the target design.

## 13. Activity / audit — POS HAS STRONG SCOPED PATTERN
Dedicated inspection of POS audit found a materially good authorization pattern:

- overview/events/carts/users use `pos.audit.view` plus `sales.pos` feature gate;
- export is separately gated by `pos.audit.export` plus the same feature gate;
- `visibleEvents()` deliberately removes the model BranchScope and then re-applies `scopeToActiveBranch()`, which intersects the query with the authenticated user's allowed branch scope;
- `visibleApprovals()` follows the same pattern;
- cart drill-down queries only through `visibleEvents()` and returns 404 when the cart has no events inside the caller's visible scope;
- event export is derived from the same visible-event query, so export does not intentionally widen branch scope;
- actor/user aggregation is derived from visible events rather than a tenant-wide user activity source.

This is a useful AWJ reference implementation for audit visibility:
```text
Audit permission ∩ feature gate ∩ effective branch/data scope
```

### Audit drill-down conclusion
POS cart/event drill-down is scope-safe at the inspected branch boundary. The event record may contain references/IDs and snapshots, but the inspected controller does not automatically open an unrelated protected operational resource. Therefore the key target invariant remains:
```text
Can view audit event != Can open/modify referenced resource
```
Any future clickable links from audit events to invoices/payments/customers/etc. must re-authorize the target resource through its own policy.

### Audit architecture is fragmented
Repository search shows multiple specialized audit/event systems (POS, Corporate Fuel, station readiness, Document Center governance, platform integration). No single generic tenant Activity Log equivalent was established in this pass. Therefore Daftra-style general Activity Log parity should not be assumed from POS audit alone. Each audit surface needs its own permission/scope review, and a future unified activity view must avoid becoming a side-channel across modules.

Status:
- POS audit branch visibility/export: **good pattern confirmed statically**.
- Generic cross-module Activity Log: **not found/confirmed**.
- Cross-module audit drill-down authorization: **still a systemic design requirement**.

## 14. Deleted records / Recycle Bin — SOFT DELETE FOUNDATION, NO TENANT RECYCLE-BIN API FOUND
Repository inspection confirms widespread Laravel `SoftDeletes` use on important master/config entities including User, Role, Partner, Product and others. Thus deletion often preserves rows internally.

However, searches for tenant application use of `onlyTrashed`, `withTrashed`, `forceDelete` and restore endpoints did **not** reveal a general user-facing Recycle Bin/restore/permanent-delete API. The meaningful `forceDelete` hit found was test/migration maintenance, not a tenant authorization surface; the meaningful application `restore()` hit found was a platform-administrator CLI recovery path, not tenant Recycle Bin UX.

### Important distinction
```text
SoftDeletes present != Recycle Bin capability present
```
A model being recoverable at ORM/database level does not mean an authorized tenant user can list, inspect, restore or permanently delete it.

### Daftra parity conclusion
Daftra's explicit deleted-sales/deleted-purchases management capability is currently **not matched by a confirmed AWJ tenant Recycle Bin workflow**.

If introduced, keep sensitive actions separate conceptually:
```text
deleted_records.view
sales_deleted.restore / purchases_deleted.restore
permanent_delete (highest risk, if allowed at all)
```
Names above are research concepts, not approved keys. Financial transaction deletion/restore must additionally respect accounting state, journal integrity, fiscal locks, ZATCA/compliance lifecycle and immutable audit requirements. A permission must never resurrect an accounting object into an invalid state.

Status: **Daftra parity gap / product capability gap; no implementation authorized.**

## 15. Accounting invariants
Authorization and accounting validity are separate. Permissions never override tenant isolation, ledger integrity, source-generated/immutable rules, period/fiscal locks or ZATCA lifecycle restrictions.

## 16. Feature/application state
```text
Tenant entitlement / enabled feature AND tenant policy AND user permission AND applicable scope
```
Permission never activates an unavailable feature.

## 17. Impersonation
If added later: restricted permission, preserve original actor, audit trail, obvious impersonation state, no tenant crossing and sensitive-operation review.

## 18. Code-backed gap matrix — current
| Capability | AWJ evidence | Status | Direction |
|---|---|---|---|
| Tenant isolation | tenant-scoped models | Present | Preserve |
| Custom/system roles | RBAC + RoleController | Present | Preserve |
| Login enable/disable | `users.is_active` | Present | Preserve |
| User branch/warehouse scope | assignments + predicates | Present | Audit consumers |
| Cash/bank ACL | deposit/withdraw subjects | Present | Verify all money paths |
| Role arbitrary-action UX | view/manage-centric | Partial | Generalize |
| Role cloning | not found | Missing | Candidate parity feature |
| Invoice own/assigned scope | fields exist, predicate absent | Missing | Define semantics |
| Partner owner/assignee scope | no field/model | Missing capability | Product/data-model decision |
| Generic report effective scope | multiple likely bypasses | Likely/strong likely P1 | Restricted-user tests |
| HR approval workflow membership | broad `hr.manage` | Missing | Define policy |
| POS audit view/export gates | dedicated permissions + app | Present | Preserve |
| POS audit branch scope | `visibleEvents/Approvals` reapply user branch scope | Present/good | Reuse pattern |
| POS audit cart drill-down | scoped event query + 404 outside scope | Present/good | Preserve |
| Generic cross-module Activity Log | not confirmed | Missing/unknown | Decide parity scope |
| Soft-delete foundation | widespread model `SoftDeletes` | Present | Do not confuse with recycle bin |
| Tenant Recycle Bin list/restore | no general endpoint found | Missing | Product/security design |
| Permanent-delete authority | no tenant workflow found | Missing | Highest-risk; explicit decision |

## 19. Corrections / architectural conclusions
1. Branch, warehouse and cash/bank foundations already exist.
2. Main problem is inconsistent consumption/coverage.
3. Generic reports remain the clearest systemic authorization risk.
4. Invoice own/assigned can use existing fields; Partner ownership cannot.
5. HR approvals enforce state but use broad authority rather than workflow membership.
6. POS audit demonstrates a strong pattern: semantic permission + feature + user branch scope + scoped drill-down/export.
7. Specialized audit systems do not equal a general Activity Log.
8. SoftDeletes do not equal a user-facing Recycle Bin.
9. Daftra-style deleted transaction management remains an explicit capability gap and must be treated as sensitive, especially for financial documents.

## 20. Current-data status
Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**. This does not relax tenant isolation, authorization, accounting invariants, schema safety or future production readiness.

## 21. Documentation reconciliation
This living reference now includes activity/audit findings, POS audit scope/drill-down/export behavior, fragmented audit architecture, SoftDeletes-vs-Recycle-Bin distinction, and the absence of a confirmed tenant restore/permanent-delete workflow. No substantive finding from this inspection is intentionally left only in chat.

## 22. Next inspection pass
1. Map the full `Rbac::PERMISSIONS` catalogue against RoleDialog rendering; classify sensitive actions, dependencies and legacy broad-permission compatibility.
2. Enumerate every cash/bank money movement path and prove `assertAllowed()` coverage.
3. Audit specialized Fuel/POS data scope where still relevant.
4. Then use targeted executable restricted-user tests for the static P1 candidates before proposing fixes.

After these checks, update the evidence matrix and only then propose an **AWJ Access Control V2 Master Plan**.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
