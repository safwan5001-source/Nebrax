# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — reconciliation pass through reports/record scope/activity log/admin findings  
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

Important current characteristic: AWJ roles are **CompanyWide**. This is acceptable; branch/resource scope should not be implemented by creating branch-specific role copies.

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

### AWJ target

Keep the backend permission registry canonical, but present role editing in grouped modules/applications. Desired UX includes create/edit/clone, assigned-user counts, module grouping, safe select-all, risk labeling for sensitive permissions, and protection of system roles.

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

Official documentation also describes branch assignment as limiting the user to the branch's sales screens, warehouses and cashboxes when those resources are configured consistently.

### AWJ target

Avoid branch-specific role explosion. Branch authorization must be server-enforced and tenant-safe, not merely a frontend filter.

## 10. Resource-level access (ACL / scoped policy)

Daftra documentation confirms resource-specific access beyond general role/branch.

### Warehouses

Observed permission concepts:

- View warehouse.
- Use warehouse when creating an invoice.
- Modify inventory for warehouse.

Warehouse **view** also affects reporting: an employee without view access to a warehouse does not see that warehouse's data in inventory movement reports.

### Cashboxes / bank accounts

Observed permission concepts:

- Incoming/deposit/receipt authority.
- Withdrawal/payment authority.
- Assignment to specific employees and, in documented configuration, broader selectors such as roles/branches/all.
- A default cashbox/account can be assigned to an employee/user.
- The default does not grant access to other resources; another bank/cashbox is selectable only when the user is authorized for it.
- Unauthorized cashboxes are omitted from transaction selection, not merely rejected after selection.

### AWJ target

Resource-level access should be a reusable authorization concept where justified, potentially covering warehouses, cashboxes, bank accounts, POS resources, and future scoped operational resources. Do not generalize prematurely into an over-complex universal ACL engine before concrete AWJ use cases are mapped.

## 11. Sales / invoices — findings so far

Daftra research confirms permissions/policies around operations **inside** the invoice, not merely opening the page. Examples include invoice profit visibility, payment date modification, ZATCA/tax submission, discount controls, manual/free item data entry/modification, and invoice-number-related controls.

Daftra invoice settings also demonstrate the separation of **feature/policy configuration** from **who may use it**: some capabilities are enabled at account/settings level and separately controlled through employee-role permissions.

Daftra also documents record-level sales visibility concepts such as viewing a user's own invoices/estimates rather than all records. In documented contexts, ownership can include the acting user and/or sales-representative assignment associated with the record.

### AWJ direction

Authorization should distinguish sensitive actions rather than treating `invoices.manage` as permanent authority for every sales action. Record visibility must also be considered separately from action permission.

Candidate permission/scope names remain conceptual until derived from actual AWJ routes/services/workflows.

## 12. Purchasing — findings so far

Daftra documents a purchasing workflow including Purchase Request → Request for Quotation → Purchase Quotation → Purchase Order → Purchase Invoice/Bill, with controls around viewing and performing operations at multiple stages.

### AWJ direction

Compare existing `purchases.view/manage` against actual AWJ purchasing workflows and decompose only where business/security value justifies it. No purchasing workflow or permission change is approved by this reference.

## 13. Inventory — findings so far

Important Daftra concepts found:

- warehouse-level access,
- inventory movement permissions,
- movement price visibility,
- movement price modification,
- separation between general inventory capability and access to specific warehouses,
- warehouse view permission affects report visibility,
- warehouse permission can be used to model an employee's goods custody/stock responsibility.

### AWJ observation

AWJ's explicit `products.view_cost` is a strong pattern: cost visibility should remain an explicit sensitive authorization concern rather than an accidental consequence of unrelated purchase/inventory permissions.

## 14. POS — findings so far

Daftra supports fine restrictions around POS/session behavior, including documented ways to restrict reopening previous sessions. AWJ already has explicit permissions for several sensitive POS actions and should prefer stable semantic permissions over URL/path blocking.

## 15. Blocked pages / explicit restrictions

Daftra provides an additional blocked-pages mechanism that can restrict specific pages/actions beyond general role permissions. This is functionally useful but AWJ should **not** copy URL/path-based authorization as its primary design.

AWJ should use stable semantic permission/policy keys for equivalent restrictions, resilient to route refactoring.

## 16. Application / feature state

Daftra documentation shows feature availability and authorization are separate. For example, general-ledger functionality must be enabled before journal-entry workflows are available; role permissions then govern users within enabled features. Application-specific permission sections can be conditional on the application being enabled while configured assignments can remain conceptually separate from feature state.

AWJ must preserve the distinction between tenant entitlement/application enabled state, tenant configuration/policy, and user authorization. A permission must not enable a feature the tenant does not have or has disabled.

## 17. Security and accounting invariants

Permissions must never override hard system invariants: Tenant Isolation, balanced posting/integrity, immutable/frozen states where mandated, period/fiscal locks according to approved policy, ZATCA lifecycle restrictions, and referential/data-integrity constraints.

`owner` / wildcard access means broad authorization inside allowed system behavior; it must not mean permission to violate accounting/compliance invariants.

## 18. Impersonation / "login as user"

Daftra documents an administrative ability to inspect the system as another user. This may be useful for AWJ support/permission troubleshooting, but it is not an initial implementation priority.

If implemented later: tightly restricted permission, original actor preserved, audit log, obvious impersonation state/banner, no tenant crossing, and explicit review/restriction of sensitive actions.

## 19. Initial gap assessment

| Capability | AWJ current assessment | Direction |
|---|---|---|
| Tenant-aware roles | Present | Keep |
| Custom roles | Present | Keep |
| Central permission catalogue | Present | Evolve carefully |
| Employee/User separation | Present | Keep |
| Sensitive business permissions | Strong in newer modules | Expand incrementally |
| Permissions grouped by module in role UX | Needs review/improvement | Adopt Daftra-style grouping |
| Role cloning | Needs verification | Likely adopt |
| Login enable/disable independent of deletion | Needs current-code verification | Adopt if missing |
| User allowed branches | Major gap / needs current-code verification | High priority |
| Resource-level warehouse access | Needs current-code verification | High priority design candidate |
| Cashbox/bank resource permissions | Needs current-code verification | High priority design candidate |
| Own/assigned record scope | Needs current-code verification | High priority for sales/CRM-like domains |
| Explicit permission dependencies | Needs verification | Add where justified |
| Workflow/state-aware authorization | Partial / domain-specific | Standardize where needed |
| Permission-aware hidden/read-only/filter states | Partial / distributed | Standardize |
| Report/export scope inheritance | Needs end-to-end verification | Mandatory security property |
| Activity-log access and safe drill-down | Needs current-code verification | Preserve audit visibility without bypass |
| URL blocked pages | Not desired as architecture | Use semantic permissions instead |
| Impersonation | Not priority | Later only |

## 20. Research matrix — work in progress

Domains to complete/match against AWJ:

1. Sales and invoices.
2. Purchasing.
3. Inventory and warehouses.
4. Accounting, treasury, cashboxes and banks.
5. POS.
6. Customers and suppliers.
7. Employees / HR / self-service / approvals.
8. Reports and exports.
9. Settings, administration and activity/audit access.
10. Users / roles / access management UX.

For each capability classify Daftra behavior/evidence, AWJ implementation, gap, adopt/adapt/reject decision, security/accounting impact, and backward-compatibility requirement.

## 21. Official Daftra references reviewed so far

Official Daftra documentation reviewed includes topics covering employee permissions/roles; employee vs user; blocked pages; task permissions; invoice profit and settings; ZATCA submission restrictions; inventory movement prices; warehouses and goods custody; branch-specific selling/access; cashbox/bank permissions; employee default cashboxes/banks; purchasing cycle; inventory permits for sales orders; POS sessions; supplier-related custom forms; journal entries; journal entry display/edit/delete/reversal/activity history; general accounting settings; draft journals; financial-period closing; leave-approval permissions; report access and scope behavior; own-invoice/estimate visibility; invoice net-position/report scope inheritance; balance-sheet/report branch scope; and activity-log permission-aware drill-down behavior.

Exact evidence should continue to be retained/expanded rather than replaced with generic ERP assumptions.

## 22. Non-goals

This document does **not** approve a database migration, universal ACL engine, changed permission semantics, removal of legacy permissions, accounting/ZATCA behavior changes, merge, deploy, or production release. Those require a separate reviewed Master Plan and scoped implementation PRs.

## 23. Accounting / general ledger — deeper findings

Daftra's accounting documentation adds an important distinction between **authorization** and **accounting object rules**.

### Journal types and state rules

- Operational transactions can create automatic journal entries.
- Users can create manual journal entries when the accounting application is enabled.
- Manual journals can be saved as drafts before final recognition.
- Automatic journals cannot be edited directly; their source transaction must be changed instead.
- Deletion is documented for manually added journals; automatic journals are removed through their source transaction rather than direct journal deletion.
- Reversal is a first-class correction mechanism: a reversing journal can neutralize the original without rewriting history.
- Journal screens expose activity/change history, and journal creation records the acting user's identity/time.
- Financial-period closing produces/links accounting close journals and changes the effective accounting state of the period.

### AWJ conclusion

These are **not all permissions**. AWJ must keep two layers separate:

```text
Authorization: "may this user request this action?"
Accounting invariant/state: "is this action valid for this journal/period?"
```

Example: granting a future `journals.update` permission must never make an automatic/source-generated journal directly editable if AWJ's accounting model forbids that operation.

Likewise, period/fiscal close rules remain authoritative even for `owner`.

### Candidate permission families (not approved names)

Future comparison against AWJ may consider distinct authority for:

```text
journals.view
journals.create_manual
journals.update_manual
journals.reverse
journals.delete_manual
journals.view_audit
journals.manage_recurring
```

These names are research candidates only. Current AWJ routes/services and accounting invariants must determine final keys.

## 24. Treasury / cashboxes / banks — deeper findings

Daftra confirms that cashboxes and bank accounts behave as **secured financial resources**, not merely dropdown values.

A cashbox can independently control incoming/receipt authority and withdrawal/payment authority. An unauthorized resource is excluded from the employee's selectable resources when creating the relevant receipt/payment/expense workflow.

Daftra also supports assigning a default cashbox/bank account to an employee. The default is convenience/context, not an authorization bypass: the employee may choose another resource only if access is granted.

The same mechanism is documented as a way to create a financial custody (`عهدة مالية`) for an employee, with reports showing the resource's movements/transfers.

### AWJ conclusion

Cash/bank resource authorization is high priority because it protects **where money can move**, not merely which screen can be opened.

A future AWJ design must preserve:

```text
General financial permission
AND
Allowed branch/scope
AND
Specific cashbox/bank authority
AND
Accounting/business rule
```

No resource ACL may grant a financial action that the role lacks globally.

## 25. HR / self-service / approval workflows — deeper findings

Daftra separates limited Employee-role/self-service capabilities from full User-role system permissions. Documented employee-level capabilities include viewing own payslip, self attendance, own attendance records/books, and managing requests.

The employee/user distinction also affects leave submission and access to employment information, while a system user receives operational permissions through the assigned role.

### Approval authorization is stateful

Leave approval documentation confirms that permission alone is insufficient. Effective ability to approve/reject depends on:

- whether the user has approval authority,
- whether the user is actually included in the configured approval path,
- the user's current approval level,
- whether the workflow has reached that level,
- whether a later approver has already acted,
- the current request state (processing vs final approved/rejected).

This is a critical architecture lesson for AWJ:

```text
canApprove(request, user) =
  permission
  ∩ workflow membership
  ∩ current step
  ∩ request state
  ∩ domain rules
```

A static `*.approve` permission must never by itself authorize every approval record.

### AWJ target

Where AWJ has approval workflows, policies/services must evaluate record/workflow context server-side. The UI should show actions only when the same effective policy says the action is currently available.

## 26. Reports — scope inheritance

Daftra evidence supports that report authorization inherits underlying data scope rather than granting unrestricted access merely because the user can open a report.

Observed patterns include:

- branch-scoped users seeing report data inside allowed branch scope,
- warehouse **view** access affecting warehouse data visible in inventory movement reports,
- own-invoice/estimate restrictions carrying into invoice-related reporting rather than reports becoming a bypass around record visibility.

### AWJ target principle

```text
Report Result =
Report Permission
∩ Source Data Permission
∩ Branch Scope
∩ Resource Scope
∩ Record Scope
```

And therefore:

```text
Report data scope ⊆ user's effective operational/data scope
```

This rule must apply consistently to:

- report API rows,
- totals and KPIs,
- drill-downs,
- CSV/Excel/PDF exports,
- background/generated report files,
- any report-oriented API consumed outside the visible UI.

A general `reports.view` permission must never become a side door around branch, warehouse, cashbox, cost, own/assigned-record, or other sensitive-data restrictions.

## 27. Record scope — own / assigned / workflow-related records

Daftra evidence adds a distinct authorization dimension beyond company/branch/resource scope.

Documented behavior includes restrictions conceptually equivalent to **view own invoices/estimates**, and in relevant sales contexts a record can be associated with a user through creator/actor ownership and/or sales-representative assignment.

### AWJ target model

Where a domain needs it, record scope should be modeled explicitly rather than encoded through branch-specific roles:

```text
Record Scope
├── All records inside allowed higher-level scope
├── Own records
├── Assigned records
└── Workflow-related records
```

Example target behavior:

A sales representative may have `invoices.view` in Dammam branch but still be restricted to their own/assigned invoices rather than every Dammam invoice.

Record-scope semantics must be domain-specific and defined precisely. "Own" must not be a vague global concept; each resource must define whether ownership means creator, salesperson, assignee, responsible employee, requester, or another stable relation.

## 28. Activity log / audit access

Daftra documentation indicates that activity/audit visibility can itself be permission-aware.

Important observed behavior:

- activity records can expose who performed a change, when it occurred, affected branch/context, and previous/new values where supported,
- a user may be allowed to see an audit event without being granted unrestricted navigation into the protected setting/resource that generated it,
- drill-down/link availability therefore needs to respect the target resource's permission even when the audit event itself is visible.

### AWJ target principle

Audit visibility and target-resource authorization are separate checks:

```text
Can view audit event
≠
Can open / modify audited resource
```

This prevents the audit system from becoming an authorization bypass while preserving useful accountability.

## 29. Administration / application-aware permissions

Daftra evidence reinforces the separation between application/feature enablement and authorization. Application-specific permission groups can depend on the relevant application being enabled, while role permission configuration determines what a user can do within the enabled capability.

### AWJ target

Authorization evaluation should preserve this ordering:

```text
Tenant entitlement / enabled feature
AND
Tenant configuration/policy
AND
User role permission
AND
Applicable scope/policy
```

A role permission cannot activate an unavailable application, and disabling an application should not require destructive rewriting of unrelated role history unless the approved product model explicitly requires it.

## 30. Reconciled architecture conclusions

After reconciling all findings captured in this research thread so far, the target authorization dimensions are:

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

This is intentionally broader than traditional RBAC.

The dimensions answer different questions:

| Dimension | Question |
|---|---|
| Tenant Isolation | Which tenant can ever be touched? |
| Feature/Entitlement | Is the capability available to this tenant? |
| Role Permission | What class of action may the user request? |
| Branch/Data Scope | In which organizational/data scope? |
| Resource Scope | On which warehouse/cashbox/bank/etc.? |
| Record Scope | Which records inside the allowed scope? |
| Workflow Position | Is this actor the correct participant now? |
| Record State | Is this action valid for the current lifecycle state? |
| Accounting/Compliance | Is the action legally/accountingly/systemically valid at all? |

## 31. Documentation reconciliation checklist

This pass explicitly checked the conversation's accumulated research findings against the living reference. The following are now represented in this file:

- Daftra as functional reference, not implementation copy.
- Existing AWJ tenant-aware RBAC and backward-compatibility requirement.
- Employee vs User separation.
- Login enable/disable as a lifecycle concern.
- Role creation/editing/cloning and module-grouped permissions.
- Fine-grained sensitive permissions vs legacy broad `*.manage` permissions.
- Permission dependencies.
- Permission-aware UI states: hidden/read-only/forbidden/filtered.
- Allowed branch scope.
- Warehouse resource permissions.
- Cashbox/bank deposit/withdraw authority and defaults.
- Sales/invoice sensitive permissions.
- Purchasing workflow granularity.
- Inventory movement/cost visibility concerns.
- POS sensitive actions and preference for semantic keys over URL blocking.
- Blocked-page behavior as functional reference only.
- Feature/application state separate from permission state.
- Accounting journal type/state invariants, reversal, drafts and audit history.
- Period/fiscal/ZATCA/accounting invariants above permissions.
- HR/self-service distinction.
- Stateful approval authorization.
- Report scope inheritance.
- Own/assigned/workflow-related Record Scope.
- Export/totals/drill-down scope inheritance requirement.
- Activity-log permission-aware drill-down.
- Impersonation as a later, high-control capability.

No known substantive finding from the research performed in this thread through this reconciliation pass is intentionally left only in chat. Future research must follow: **research → verify → update this file → confirm commit → summarize to Safwan**.

## 32. Current gaps to verify in AWJ code

Before producing the Access Control V2 Master Plan, verify against current `main`:

1. User allowed-branch persistence and server enforcement end-to-end.
2. Warehouse resource access and report inheritance.
3. Cashbox/bank resource access for receipts/payments/expenses/transfers.
4. Own/assigned record scope in sales/customers and other relevant domains.
5. Report APIs/exports/totals respecting effective scope.
6. Workflow approval policies combining permission + configured actor + current state.
7. Login enable/disable lifecycle independent of employee/user deletion.
8. Role-management UX grouping, cloning, dependencies and risk labeling.
9. Activity/audit permissions and drill-down authorization.
10. Any existing scope infrastructure that should be reused instead of building a parallel ACL system.

## 33. Next research/inspection pass

The next pass should be code-backed rather than another broad conceptual survey:

- inspect current AWJ Users/Branches authorization,
- inspect Warehouses and inventory query scoping,
- inspect Cashboxes/Bank Accounts and money-movement authorization,
- inspect Reports and export endpoints,
- inspect own/assigned record filters where present,
- inspect approval/workflow policies,
- map actual `Rbac::PERMISSIONS` and existing middleware/policies/services.

Then build the first evidence matrix:

**Daftra behavior | AWJ current implementation | gap | decision | security/accounting risk | backward compatibility**.

Only after that matrix is sufficiently complete should an **AWJ Access Control V2 Master Plan** be proposed. No implementation is authorized by this living reference.
