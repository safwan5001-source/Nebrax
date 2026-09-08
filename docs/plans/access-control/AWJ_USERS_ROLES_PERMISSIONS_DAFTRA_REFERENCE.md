# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — full RBAC catalogue vs RoleDialog semantics inspection  
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
AWJ already has tenant-scoped roles, canonical RBAC permissions, custom roles, Employee↔User linking, independent user active state, per-user branch and warehouse scope, reusable branch/warehouse guards, cash/bank deposit-withdraw ACLs, and explicit sensitive permissions in newer modules. Access Control V2 is primarily consistency/coverage/granularity, not rebuilding foundations.

## 4. Employee vs User
Preserve employee lifecycle, login status, role assignment and access scope as separate concerns. Disabling login must not delete employee history or alter audit attribution.

## 5. Roles and permission granularity
Role backend supports custom/system roles and safety controls. Older broad permissions coexist with modern semantic permissions. Fine-grained decomposition must be incremental and backward-compatible. Role cloning was not found in the inspected API/UI and remains a candidate Daftra-parity UX feature.

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
Rows, totals, drill-downs and exports must obey the same scope. Static inspection identified likely/strong-likely P1 scope gaps in Inventory, Sales, Purchases, Customers and Classification Analytics. Core accounting reports need accounting-aware authorization rather than a naive branch Global Scope. Generic CSV/PDF/print inherit loaded API data. Specialized Fuel/POS endpoints demonstrate stronger semantic permission + feature gating.

## 10. Invoice operational record scope
Invoices store server-authored `created_by` and tenant-validated `salesperson_id`; branch scope is present, but own/assigned authorization is missing. Candidate semantics require product/BC decision: ALL_ALLOWED / CREATED_BY_ME / ASSIGNED_TO_ME / CREATED_OR_ASSIGNED_TO_ME.

## 11. Partner/customer operational scope
`Partner` has no current owner/salesperson/assignee/creator field. Visibility uses BranchScoped plus customer/supplier branch-sharing rules. Customer ownership must not be inferred from invoice salesperson history. Daftra-like "my customers" requires an explicit relationship/assignment semantic if AWJ adopts it.

## 12. HR approvals
Leave and general employee requests enforce pending state and record approver/time, but broad `hr.manage` currently gates approve/reject/delete. No manager/approval-chain/step/selected-approver/branch-approver/self-approval predicate was found in those paths.

Target:
```text
canApprove = feature ∩ semantic approval permission ∩ organizational scope ∩ workflow membership ∩ current step ∩ state ∩ SoD/domain rules
```
Fuel/POS already provide stronger semantic approval examples.

## 13. Activity / audit
POS audit is a strong scoped pattern: dedicated `pos.audit.view` / `pos.audit.export`, POS feature gate, user branch scope reapplied through `scopeToActiveBranch()`, scoped cart drill-down returning 404 outside scope, and export derived from the same visible query.

Invariant:
```text
Can view audit event != Can open/modify referenced resource
```
Repository contains multiple specialized audit systems but no confirmed generic tenant Activity Log equivalent. A future unified activity view must not become a cross-module side-channel.

## 14. Deleted records / Recycle Bin
Important entities widely use `SoftDeletes`, but no general tenant Recycle Bin/list/restore/permanent-delete API was found. `SoftDeletes present != Recycle Bin capability present`.

Daftra's deleted-sales/deleted-purchases management therefore remains a capability gap. Restore/permanent-delete must be explicit sensitive authorities and financial recovery must respect journal integrity, fiscal locks, ZATCA/compliance lifecycle and immutable audit.

## 15. RBAC catalogue — CURRENT SHAPE
`Rbac::PERMISSIONS` is the canonical assignable catalogue. It now mixes three generations of permission design:

### A. Legacy broad module pairs
Examples:
```text
partners.view / partners.manage
products.view / products.manage
invoices.view / invoices.manage
payments.view / payments.manage
purchases.view / purchases.manage
returns.view / returns.manage
hr.view / hr.manage
expenses.view / expenses.manage
assets.view / assets.manage
cost_centers.view / cost_centers.manage
accounts.view / accounts.manage
branches.view / branches.manage
users.view / users.manage
roles.view / roles.manage
```
These are simple operational permissions but several `manage` keys aggregate create/update/delete and sometimes domain-sensitive actions. They should not be decomposed in one big-bang migration.

### B. Intermediate explicit actions
Examples:
```text
delivery_notes.confirm / cancel / invoice
sales.minimum_price_override
products.view_cost
supplier_refunds.view / manage
accounting_period_locks.view / manage
```
These correctly isolate a business-sensitive capability from a broad module permission, even where the action name remains `manage`.

### C. Modern semantic/action catalogues
POS, Fuel, Document Center and Fiscal Years demonstrate the target direction:
```text
view, create, manage, assign, resolve, export,
approve, review, recalculate, open, close, confirm,
finalize, collect, authorize, ingest, retry,
transition, inspect, verify, build_draft, audit_export,
reopen
```
This is already a rich semantic authorization model in the backend. The role editor has not caught up with it.

## 16. RoleDialog — STRUCTURAL PARSING BUG, NOT ONLY A LABEL BUG
Direct inspection confirms two distinct defects.

### 16.1 Every non-`manage` action is displayed as View
The renderer is effectively:
```text
action == manage ? Manage : View
```
So `approve`, `export`, `close`, `reopen`, `retry`, `resolve`, `assign`, `inspect`, `verify`, etc. are all mislabeled as View. This can cause an administrator to grant a materially stronger authority while believing they granted read access.

This is a **security-relevant admin UX defect**, not cosmetic polish.

### 16.2 Multi-segment permission keys are parsed incorrectly
RoleDialog currently does:
```text
const [mod, action] = perm.split('.')
```
This assumes exactly two segments. Many modern AWJ permissions contain 3 or 4 segments, for example:
```text
pos.audit.export
pos.audit.settings.manage
pos.investigations.resolve
fuel.shift.approve
fuel.sale.price.manage
documents.center.audit_export
```
For these, the UI discards all segments after the second when constructing the module/action pair. It then reconstructs a different key as `${mod}.${action}`.

Examples:
```text
pos.audit.export            -> module=pos, action=audit -> reconstructed pos.audit
fuel.shift.approve          -> module=fuel, action=shift -> reconstructed fuel.shift
documents.center.review     -> module=documents, action=center -> reconstructed documents.center
```
Those reconstructed strings are not the canonical permissions from `Rbac::PERMISSIONS`.

### Consequences
1. Existing modern permissions may not render as selected correctly.
2. Multiple distinct permissions collapse to duplicate buttons/keys.
3. Toggling can add invalid truncated permission strings to local selection.
4. Saving may be rejected by backend validation, or existing intended permissions may be unintentionally changed depending on selection state.
5. The UI cannot faithfully administer the backend permission catalogue.

Status: **Confirmed high-priority Role Administration defect.** Before expanding the catalogue further, the editor needs a semantic metadata model rather than positional `split('.')` parsing.

## 17. Permission metadata model — TARGET
Do not make the UI infer security semantics from punctuation. The canonical permission key should remain stable, while presentation metadata describes it.

Conceptual shape (not approved implementation contract):
```text
key: fiscal_years.close
module/group: accounting / fiscal_years
action: close
label_ar / label_en
risk: normal | sensitive | critical
requires: [fiscal_years.view]
conflicts_with: []
feature/app gate: optional
help/description: optional
```

The UI should always toggle the **exact canonical key** supplied by the backend.

## 18. Dependency candidates — RESEARCH, NOT YET ENFORCEMENT RULES
There is no confirmed generic dependency engine in the inspected role editor/RBAC path. Candidates must be domain-defined, not guessed globally.

Safe conceptual examples to evaluate:
```text
*.manage usually requires corresponding *.view
fiscal_years.close/reopen -> fiscal_years.view
pos.audit.export/review/recalculate -> pos.audit.view
pos.investigations.assign/resolve/export -> pos.investigations.view
fuel.shift.approve/correct/close -> fuel.shift.view
fuel.*.manage/action -> corresponding resource view
```
But dependency behavior must specify whether selecting a child auto-selects prerequisites, blocks invalid combinations, or backend computes effective implied permissions. Do not silently add implication semantics without a migration/BC plan.

## 19. Sensitive / critical permission candidates
The current catalogue already contains permissions that should receive stronger role-admin UX treatment.

### Critical/high-impact candidates
- `roles.manage`, `users.manage` — can alter who has access and what they can do.
- `apps.manage`, `developer.manage` — can alter enabled capabilities/integration credentials or surfaces.
- `accounting_settings.manage` — changes accounting configuration.
- `accounting_period_locks.manage` — controls posting availability.
- `fiscal_years.close`, `fiscal_years.reopen` — creates/reverses year-close accounting effect.
- `supplier_refunds.manage` — moves/refunds money.
- `pos.override.approve`, `pos.variance.approve`, `pos.audit.settings.manage`, `pos.audit.recalculate` — override/audit control plane.
- `sales.minimum_price_override` — bypasses commercial pricing floor.
- `products.view_cost` — exposes commercially sensitive cost/profit data.
- `fuel.sale.price.manage`, `fuel.avi.authorize`, `fuel.integration.retry/ingest`, and similar operational-control actions — domain-sensitive.
- Document Center operations/retry/build-draft/settings/audit-export — sensitive according to operation/data exposure.

Risk classification is a UX/governance layer; it must not replace backend permission checks.

## 20. Legacy role compatibility
`owner` and `admin` still use wildcard `*`. `accountant` and `staff` retain legacy matrices; modern sensitive permissions are deliberately not automatically added to them in many newer modules. This is an important security-compatible evolution pattern.

The `Rbac::resolve()` path reads tenant role rows first and falls back to the static MATRIX, preserving pre-migration/test safety. Any Access Control V2 migration must preserve existing effective access unless a specific tightening is explicitly approved and tested.

## 21. Accounting invariants
Authorization and accounting validity are separate. Permissions never override tenant isolation, ledger integrity, source-generated/immutable rules, period/fiscal locks or ZATCA lifecycle restrictions.

## 22. Feature/application state
```text
Tenant entitlement / enabled feature AND tenant policy AND user permission AND applicable scope
```
Permission never activates an unavailable feature.

## 23. Impersonation
If added later: restricted permission, preserve original actor, audit trail, obvious impersonation state, no tenant crossing and sensitive-operation review.

## 24. Code-backed gap matrix — current
| Capability | AWJ evidence | Status | Direction |
|---|---|---|---|
| Tenant isolation | tenant-scoped models | Present | Preserve |
| Custom/system roles | RBAC + RoleController | Present | Preserve |
| Login enable/disable | `users.is_active` | Present | Preserve |
| User branch/warehouse scope | assignments + predicates | Present | Audit consumers |
| Cash/bank ACL | deposit/withdraw subjects | Present | Verify all money paths |
| Canonical permission catalogue | `Rbac::PERMISSIONS` | Present/rich | Preserve exact keys |
| Role arbitrary-action labels | non-manage shown as View | **Confirmed defect** | Metadata-driven labels |
| Role multi-segment keys | positional split truncates keys | **Confirmed high-priority defect** | Never reconstruct keys |
| Permission dependencies | no generic engine confirmed | Missing/verify | Domain metadata + BC design |
| Sensitive risk labels/warnings | not present in RoleDialog | Missing | Add governance UX |
| Role cloning | not found | Missing | Candidate parity feature |
| Invoice own/assigned scope | fields exist, predicate absent | Missing | Define semantics |
| Partner owner/assignee scope | no field/model | Missing capability | Product/data-model decision |
| Generic report effective scope | multiple likely bypasses | Likely/strong likely P1 | Restricted-user tests |
| HR approval workflow membership | broad `hr.manage` | Missing | Define policy |
| POS audit branch/drill-down/export | scoped pattern | Present/good | Reuse |
| Generic Activity Log | not confirmed | Missing/unknown | Decide parity scope |
| Soft-delete foundation | widespread `SoftDeletes` | Present | Not a recycle bin |
| Tenant Recycle Bin | no general workflow found | Missing | Product/security design |

## 25. Architectural conclusions
1. AWJ backend permission vocabulary is substantially more mature than the current role editor.
2. The RoleDialog issue is not merely translation: multi-segment keys are structurally mishandled.
3. The exact canonical permission key must become an opaque identifier to the UI; labels/groups/actions/risk/dependencies belong in metadata.
4. Modern semantic permissions should remain separate rather than collapse back into broad `manage`.
5. Legacy broad permissions need gradual decomposition with explicit backward compatibility.
6. Sensitive permissions need visible warnings/risk treatment in role administration.
7. Report scope remains the clearest systemic data-authorization risk; role-editor repair does not replace those backend fixes/tests.

## 26. Current-data status
Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**. This does not relax tenant isolation, authorization, accounting invariants, schema safety or future production readiness.

## 27. Documentation reconciliation
This living reference now contains the full RBAC-catalogue generation analysis, the confirmed arbitrary-action label defect, the more serious multi-segment-key truncation defect, target permission metadata principles, dependency candidates, risk-classification candidates and backward-compatibility requirements. No substantive finding from this inspection is intentionally left only in chat.

## 28. Next inspection pass
1. Enumerate every cash/bank money movement path and prove `CashBankAccountService::assertAllowed()` coverage for deposit/withdraw direction.
2. Audit specialized Fuel/POS data scope where still relevant.
3. Then run targeted restricted-user executable tests for static P1 candidates before proposing fixes.
4. After evidence closure, draft the AWJ Access Control V2 Master Plan with small independent PRs.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
