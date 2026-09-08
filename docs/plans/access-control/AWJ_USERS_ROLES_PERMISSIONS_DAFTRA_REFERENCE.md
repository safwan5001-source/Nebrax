# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research in progress  
**Date started:** 2026-09-08  
**Scope:** Users, Employees, Roles, Permissions, Branch Scope, Resource Access, permission-aware UX.  
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
- AWJ already contains fine-grained sensitive permissions in newer modules, including examples such as:
  - `products.view_cost`
  - `sales.minimum_price_override`
  - `pos.variance.approve`
  - `pos.session.handover.confirm`
  - `pos.cash_drawer.open`
  - `pos.audit.*`
  - `documents.center.*`
  - `accounting_settings.*`
  - `accounting_period_locks.*`
  - `fiscal_years.*`

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
 └─ Resource-specific access where applicable
```

Effective authorization is influenced by multiple layers:

```text
Tenant / account boundary
        ↓
Enabled application / feature
        ↓
Allowed branch scope
        ↓
Role permission
        ↓
Resource-specific permission
        ↓
Business / accounting / compliance rule
```

AWJ target principle:

```text
Effective Access =
Tenant Isolation
∩ Enabled Feature
∩ Allowed Scope
∩ Role Permission
∩ Resource Permission (when applicable)
∩ Business / Accounting / Compliance Policy
```

The layers are restrictive intersections. A lower-level resource permission must never bypass a higher-level denial or invariant.

## 4. Employee vs User

Daftra distinguishes an employee record from a system user:

- Employee: HR/personnel record; system login is not inherently required.
- User: employee/person with login credentials and a role.
- System access can be enabled/disabled without deleting the underlying person.
- A user can be assigned a role and allowed branches.

AWJ already documents and implements the same core model: `User ⊃ Employee`.

### AWJ target

Preserve the separation between:

- employee lifecycle,
- login/access status,
- role assignment,
- branch/resource authorization.

Disabling login must not require deleting the employee, deleting the user history, or changing financial audit attribution.

## 5. Roles

Observed Daftra behavior:

- Employee/User/Admin role types are documented.
- User roles expose customizable permissions.
- Admin role grants all permissions.
- Roles can be created, edited, assigned, and cloned.
- Permissions are presented by application/module rather than as an unstructured flat list.

### AWJ target

Keep the backend permission registry canonical, but present role editing in grouped modules/applications.

Desired UX capabilities:

- Create custom role.
- Edit custom role.
- Clone role.
- Show users assigned to a role.
- Group permissions by module.
- Select/deselect a whole module where safe.
- Clearly distinguish sensitive/high-risk permissions.
- Protect system roles according to AWJ policy.

## 6. Permission granularity

Daftra documentation shows that permissions are often finer than simple `view/manage` and include business actions.

Confirmed examples from the research include:

- invoice profit visibility,
- changing payment date,
- sending invoices to ZATCA/tax authority,
- inventory movement price visibility,
- inventory movement price modification,
- sales/order workflow actions,
- task add/edit/view/delete and workflow/template administration,
- rental reservation view/manage/delete,
- restrictions around POS session operations.

### AWJ observation

Newer AWJ areas already follow this stronger pattern, while older modules still contain broad permissions such as:

- `invoices.manage`
- `products.manage`
- `partners.manage`
- `purchases.manage`

### Direction

Do **not** perform a big-bang permission rewrite.

Fine-grained permissions should be introduced incrementally for sensitive operations, with explicit backward-compatibility rules for existing broad `*.manage` permissions until a safe migration plan is approved.

## 7. Permission dependencies

Daftra documents cases where permissions imply or require other permissions (for example management requiring view access).

AWJ V2 should model dependencies explicitly rather than relying only on UI convention.

Conceptual example only:

```text
resource.update -> requires resource.view
resource.delete -> requires resource.view
workflow.approve -> requires workflow.view
```

Exact dependencies must be defined per AWJ domain and tested server-side.

## 8. Permission-aware UX

Daftra demonstrates more than one unauthorized UI state:

1. **Hidden** — action/menu/column is not shown.
2. **Read-only** — data remains visible but cannot be changed.
3. **Forbidden action** — action is unavailable and direct unauthorized access must be rejected.

AWJ should standardize this behavior.

Important: UI hiding is not authorization. Backend policy/middleware/service enforcement remains authoritative.

## 9. Branch scope

Daftra allows allowed branches to be associated with a user. This separates:

- **Role:** what the user may do.
- **Scope:** where the user may do it.

### AWJ target

Avoid role explosion such as:

- Accountant — Dammam
- Accountant — Khobar
- Accountant — Riyadh

Prefer:

```text
User: Example Accountant
Role: Accountant
Allowed branches:
  ✓ Dammam
  ✓ Khobar
  ✗ Riyadh
```

Branch authorization must be server-enforced and tenant-safe, not merely a frontend filter.

## 10. Resource-level access (ACL / scoped policy)

Daftra documentation indicates resource-specific access beyond the user's general role/branch.

### Warehouses

Observed permission concepts include:

- View warehouse.
- Use warehouse when creating an invoice.
- Modify inventory for warehouse.

Therefore general invoice permission does not necessarily imply the ability to use every warehouse.

### Cashboxes / bank accounts

Observed permission concepts include:

- Deposit.
- Withdraw.
- Assignment to users/roles/branches/all, depending on the resource/configuration.
- Default cashbox/account for a user while other resources remain permission-controlled.

### AWJ target

Resource-level access should be designed as a reusable authorization concept where justified, potentially covering:

- warehouses,
- cashboxes,
- bank accounts,
- POS resources,
- future scoped operational resources.

Do not generalize prematurely into an over-complex universal ACL engine before concrete AWJ use cases are mapped.

## 11. Sales / invoices — findings so far

Daftra research confirms permissions/policies around operations inside the invoice, not merely opening the invoice page.

Examples found:

- invoice profit visibility,
- payment date modification,
- ZATCA/tax submission,
- discount controls,
- manual/free item data entry/modification,
- invoice numbering/configuration-related controls.

### AWJ direction

Authorization should distinguish sensitive actions rather than treating `invoices.manage` as permanent authority for every sales action.

Potential categories to map later (names not final):

```text
invoices.view
invoices.create
invoices.update
invoices.cancel
invoices.delete
invoices.view_profit
invoices.discount_override
zatca.submit
```

These are architecture candidates only. Final permission names must be derived from actual AWJ routes/services/business workflows before implementation.

## 12. Purchasing — findings so far

Daftra documents a purchasing workflow including concepts such as:

```text
Purchase Request
→ Request for Quotation
→ Purchase Quotation
→ Purchase Order
→ Purchase Invoice/Bill
```

Permissions/workflow controls exist around viewing and performing operations at multiple stages.

### AWJ direction

The existing broad `purchases.view/manage` model should eventually be compared against actual AWJ purchasing workflows and decomposed only where business/security value justifies it.

No permission names or purchasing workflow changes are approved by this document.

## 13. Inventory — findings so far

Important Daftra concepts found:

- warehouse-level access,
- inventory movement permissions,
- movement price visibility,
- movement price modification,
- separation between general inventory capability and access to specific warehouses.

### AWJ observation

AWJ already has an important improvement over some Daftra patterns: `products.view_cost` is an explicit sensitive permission. Cost visibility should remain an explicit authorization concern rather than becoming an accidental consequence of unrelated purchase/inventory permissions.

## 14. POS — findings so far

Daftra supports fine restrictions around POS/session behavior, including documented ways to restrict reopening previous sessions.

AWJ already has explicit permissions for several sensitive POS actions and should prefer these stable permissions over URL/path blocking.

Examples in AWJ:

- `pos.variance.approve`
- `pos.session.handover.confirm`
- `pos.cash_drawer.open`
- `pos.audit.*`
- `pos.investigations.*`

## 15. Blocked pages / explicit restrictions

Daftra provides an additional blocked-pages mechanism that can restrict specific pages/actions beyond the general role permissions.

This is functionally useful but AWJ should **not** copy URL/path-based authorization as its primary design.

### AWJ equivalent

Use stable semantic permission/policy keys such as conceptual examples:

```text
partners.delete
pos.sessions.reopen
sales.returns.create
```

rather than security rules tied to frontend/backend route strings.

The user-facing result may be equivalent to Daftra while the implementation remains AWJ-native and resilient to route refactoring.

## 16. Application / feature state

Daftra documentation shows that permissions may remain configured while an application is disabled, becoming effective again when the feature is enabled.

AWJ should preserve the distinction between:

- tenant entitlement/application enabled state,
- tenant configuration/policy,
- user authorization.

A permission must not enable a feature that the tenant does not have or has disabled.

## 17. Security and accounting invariants

Permissions must never override hard system invariants.

Examples:

- Tenant Isolation.
- Accounting integrity and balanced posting requirements.
- Immutable/frozen document state where mandated.
- Fiscal/period locking rules according to their approved policy.
- ZATCA/compliance lifecycle restrictions.
- Referential/data-integrity constraints.

`owner` / wildcard access means broad authorization inside allowed system behavior; it must not mean permission to violate accounting/compliance invariants.

## 18. Impersonation / "login as user"

Daftra documents an administrative ability to inspect the system as another user.

This may be useful for AWJ support/permission troubleshooting, but it is **not Phase 1**.

If ever implemented, minimum requirements include:

- tightly restricted permission,
- original actor preserved,
- audit log,
- obvious impersonation banner/state,
- tenant boundary cannot be crossed,
- sensitive actions reviewed/restricted as appropriate.

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
| Resource-level warehouse access | Gap / needs current-code verification | High priority design candidate |
| Cashbox/bank resource permissions | Gap / needs current-code verification | High priority design candidate |
| Explicit permission dependencies | Needs verification | Add where justified |
| Permission-aware hidden/read-only states | Partial / distributed | Standardize |
| URL blocked pages | Not desired as architecture | Use semantic permissions instead |
| Impersonation | Not priority | Later only |

## 20. Research matrix — work in progress

The next research passes must continue against Daftra official documentation and then be mapped to current AWJ code.

Domains:

1. Sales and invoices.
2. Purchasing.
3. Inventory and warehouses.
4. Accounting, treasury, cashboxes and banks.
5. POS.
6. Customers and suppliers.
7. Employees / HR / self-service / approvals.
8. Reports.
9. Settings and administration.
10. Users / roles / access management UX.

For each capability classify:

- Daftra behavior (officially supported by source).
- AWJ current implementation.
- Gap.
- Decision: adopt / adapt / AWJ already stronger / reject.
- Security/accounting impact.
- Backward-compatibility requirement.

## 21. Official Daftra references reviewed so far

The research so far used Daftra's official documentation, including topics covering:

- Employee permissions and roles.
- Difference between employee and user.
- Blocked pages.
- Task-management permissions.
- Invoice profit visibility.
- Restricting ZATCA/tax submission.
- Invoice settings and permission-sensitive invoice behavior.
- Inventory movement price visibility/modification.
- Warehouse creation/access assignment.
- Branch-specific selling/access.
- Cashbox and bank-account permissions.
- Default cashbox/bank assignment to employees/users.
- Purchasing cycle.
- Purchase requests / purchasing workflow.
- Inventory permits for sales orders.
- POS session management and restrictions.
- Related/custom supplier forms with scoped permissions.

When this reference is updated, exact source links and evidence should be retained/expanded rather than replacing evidence with generic ERP assumptions.

## 22. Non-goals of this research document

This document does **not** approve:

- a database migration,
- a new universal ACL engine,
- changing existing permission semantics,
- removing legacy permissions,
- modifying accounting behavior,
- modifying ZATCA behavior,
- merge/deploy/production release.

Those require a separate reviewed Master Plan and scoped implementation PRs.

## 23. Next step

Continue the Daftra research, especially:

- accounting/treasury,
- reports,
- HR and approvals,
- settings/administration,
- role-management UX,

then perform a code-backed comparison against current AWJ `Rbac::PERMISSIONS`, routes, policies/middleware, branch model, warehouses, cashboxes/bank accounts and relevant frontend permission checks.

Only after the evidence matrix is sufficiently complete should an **AWJ Access Control V2 Master Plan** be proposed.
