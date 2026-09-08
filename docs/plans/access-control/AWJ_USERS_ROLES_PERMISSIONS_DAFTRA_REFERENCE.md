# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — research + code inspection in progress  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — cash/bank ACL money-path inspection  
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

## 15. RBAC catalogue and RoleDialog
`Rbac::PERMISSIONS` mixes legacy broad `view/manage`, intermediate explicit sensitive permissions and modern semantic POS/Fuel/Document/Fiscal permissions.

RoleDialog has two confirmed security-relevant administration defects:
1. every non-`manage` action is displayed as View;
2. `const [mod, action] = perm.split('.')` truncates multi-segment keys such as `pos.audit.export`, `fuel.shift.approve`, `documents.center.review`, then reconstructs invalid shorter keys.

The UI must treat the exact canonical key as opaque and use backend-provided metadata for group/action/label/risk/dependencies. Sensitive permissions should receive visible risk treatment. Any legacy decomposition must preserve effective access unless explicitly approved.

## 16. Cash / bank ACL — CODE-BACKED MONEY-PATH AUDIT
AWJ has a meaningful treasury resource ACL, not just module-level RBAC. `CashBankAccountService::assertAllowed()` evaluates the selected CashBankAccount's `deposit` or `withdraw` scope against the authenticated actor and active branch context. The inspected core money paths show good enforcement at the moment of financial effect.

### 16.1 PaymentService — GOOD
`PaymentService::post()` resolves the actual CashBankAccount and calls:
```text
received -> assertAllowed(deposit)
paid     -> assertAllowed(withdraw)
```
The check occurs at posting time after allocation validation and before `LedgerService::post()`. This is the correct security boundary: a draft can exist, but financial effect cannot occur without current resource authority.

This covers the canonical customer-receipt and supplier-payment voucher path, including POS/Fuel flows that deliberately create/post `Payment` records through `PaymentService`.

### 16.2 CashBankTransferService — GOOD
Internal transfer checks both sides before posting:
```text
source      -> withdraw
destination -> deposit
```
Thus authority on one treasury resource does not imply authority on the other. This is the correct two-resource intersection.

### 16.3 EmployeeCustodyService — GOOD
Issuing employee custody resolves the selected cash/bank entity and checks `withdraw` before posting the custody debit / cash-bank credit entry.

### 16.4 SupplierRefundService — GOOD
Supplier refund is intentionally modeled as money entering AWJ treasury after a posted purchase return. It resolves the cash/bank entity and checks `deposit` before posting. This is directionally correct for the implemented refund semantic.

### 16.5 Purchase payment architecture — GOOD BY DELEGATION
`PurchaseService` documents that settlement is a separate `PaymentService` financial document rather than embedding cash/bank movement in the purchase invoice journal. Therefore the canonical purchase-payment path inherits `PaymentService` withdraw ACL rather than bypassing it.

## 17. Treasury ACL boundary exceptions / special cases
Not every journal line touching a cash account is a `CashBankAccount` user-selected movement. These cases need explicit classification rather than blindly inserting ACL checks everywhere.

### 17.1 POS drawer `cash_in` / `cash_out` — NOT AN ACCOUNTING MONEY MOVEMENT
`PosSessionService::recordCashMovement()` explicitly records physical drawer movement for session reconciliation and does **not** post a journal entry or alter the cash account. It enforces session actor branch/warehouse scope and applies POS operation-policy approval for `cash_out`. Therefore absence of `CashBankAccountService::assertAllowed()` here is not currently a treasury ACL bypass; it is a POS operational-control surface.

If AWJ later changes drawer cash-out to represent an actual expense/treasury transfer, that conclusion must be revisited.

### 17.2 POS variance settlement — SPECIAL SERVER-DERIVED JOURNAL
`PosSessionService::settleVariance()` posts shortage/overage directly against the server-resolved session cash account and variance account after `pos.variance.approve`, closed-session state, acknowledgement, optional SoD self-approval policy, and one-time settlement guard.

It resolves the session cash account through `CashBankAccountService::resolveForPayment()` but does **not** call `assertAllowed()` before posting the debit/credit.

This is not an arbitrary user-selected cash account: the server derives the account from the session/payment-method configuration and the action has a dedicated high-impact POS permission. Therefore it is **not yet classified as a confirmed bypass**.

However, it creates a policy question that must be explicit in Access Control V2:
```text
Does pos.variance.approve authorize accounting adjustment of the session treasury
regardless of that user's deposit/withdraw ACL on the CashBankAccount?
```
If treasury ACL is intended as an absolute resource boundary, variance settlement is a gap. If POS variance authority is intentionally a privileged domain override over a server-bound session account, that exception must be documented, auditable and visibly high-risk. Status: **Policy ambiguity / verify before changing code.**

### 17.3 Cash sales inside InvoiceService — LEGACY ACCOUNTING PATH OUTSIDE CASHBANK ACL
Static inspection confirms `InvoiceService` still contains a legacy/direct cash-sale posting path using a server-defined cash account (`1110`) and comments explicitly state that this debit does not pass through `CashBankAccountService`, unlike separate payment settlement.

This is materially different from `PaymentService`: a cash invoice can create a cash-account journal effect without evaluating the actor's CashBankAccount deposit ACL.

Because the account is server-defined rather than caller-selected, tenant/account isolation is not the issue. The access-control question is whether `invoices.manage` should permit posting cash receipts into a treasury resource the actor is otherwise forbidden to deposit into.

Status: **Strong candidate treasury ACL consistency gap; verify exact current post route, actor propagation and cash-sale semantics with restricted-user executable test before implementation.**

## 18. Treasury security invariant — TARGET
For user-initiated financial effects that select or economically affect a treasury resource:
```text
Domain action permission
∩ Branch/Data scope
∩ CashBank resource permission for economic direction
∩ Accounting state/invariants
```

Direction:
```text
money into treasury  -> deposit
money out of treasury -> withdraw
internal transfer     -> source withdraw ∩ destination deposit
```

Server-derived system adjustments may require an explicit documented exception rather than silently bypassing resource ACL. The exception must identify the domain permission, immutable audit source and why user resource selection cannot occur.

## 19. Cash/bank audit matrix — current
| Money path | Cash/bank effect | Resource ACL status | Classification |
|---|---|---|---|
| Customer receipt / receipt voucher | deposit | `PaymentService::post()` checks deposit | Good |
| Supplier payment / payment voucher | withdraw | `PaymentService::post()` checks withdraw | Good |
| Internal cash/bank transfer | source withdraw + destination deposit | both checked | Good |
| Employee custody issue | withdraw | checked | Good |
| Supplier refund received | deposit | checked | Good |
| Purchase settlement | withdraw | delegated to PaymentService | Good |
| POS/Fuel payment created via PaymentService | direction-dependent | inherits PaymentService check | Good where canonical service used |
| POS drawer cash_in/out | no ledger/cash-account mutation | N/A; POS operational policy | Not treasury movement |
| POS variance settlement | server-derived debit/credit to session cash | no `assertAllowed()` | Policy ambiguity |
| Direct cash sale in InvoiceService | debit cash account | no CashBank ACL | Strong candidate consistency gap |

## 20. Dependency / sensitive permission principles
Permission dependencies remain domain-defined rather than inferred globally. Sensitive/critical candidates include role/user administration, app/developer management, accounting settings, period locks, fiscal close/reopen, supplier refunds, POS override/variance/audit control plane, minimum-price override, product cost visibility, Fuel operational controls and Document Center control-plane actions.

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
| Cash/bank ACL foundation | deposit/withdraw subjects | Present | Preserve |
| Payment receipt/payment ACL | posting-time deposit/withdraw | Present/good | Preserve |
| Cash/bank transfer ACL | both resource directions | Present/good | Preserve |
| Employee custody ACL | withdraw | Present/good | Preserve |
| Supplier refund ACL | deposit | Present/good | Preserve |
| POS variance vs treasury ACL | server-derived cash journal, no assertAllowed | Ambiguous | Decide privileged exception vs gap |
| Direct invoice cash-sale treasury ACL | cash debit outside CashBank ACL | Strong candidate gap | Restricted-user test |
| Canonical permission catalogue | `Rbac::PERMISSIONS` | Present/rich | Preserve exact keys |
| Role arbitrary-action labels | non-manage shown as View | Confirmed defect | Metadata-driven labels |
| Role multi-segment keys | positional split truncates keys | Confirmed high-priority defect | Never reconstruct keys |
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
1. AWJ already has a useful treasury resource ACL and most canonical money-document paths enforce it at posting time.
2. Do not rebuild treasury ACL; close consistency gaps and define privileged server-derived exceptions.
3. PaymentService's posting-time check is the reference pattern because draft creation does not confer financial authority.
4. Direct cash sales are the clearest remaining treasury consistency candidate and require an executable restricted-user proof.
5. POS variance settlement needs a deliberate policy decision, not an automatic code change.
6. POS physical drawer movement is not currently an accounting treasury movement and should not be misclassified.
7. Backend permission vocabulary remains more mature than RoleDialog; its structural key parsing defect is still high priority.
8. Report scope remains the clearest systemic data-authorization risk overall.

## 26. Current-data status
Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**. This does not relax tenant isolation, authorization, accounting invariants, schema safety or future production readiness.

## 27. Documentation reconciliation
This living reference now includes the cash/bank money-path audit: PaymentService, transfers, employee custody, supplier refunds, purchase-payment delegation, POS drawer movement classification, POS variance policy ambiguity and direct cash-sale candidate gap. No substantive finding from this inspection is intentionally left only in chat.

## 28. Next inspection pass
1. Audit specialized Fuel/POS scope and verify that all domain flows using PaymentService propagate the real actor rather than `null`/system authority at posting time.
2. Prepare targeted restricted-user executable-test matrix for report-scope candidates and direct cash-sale treasury ACL candidate.
3. Run those tests with a code-capable tool only after choosing the lowest-cost appropriate execution path; inspection/documentation alone does not require Codex.
4. After evidence closure, draft the AWJ Access Control V2 Master Plan with small independent PRs.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
