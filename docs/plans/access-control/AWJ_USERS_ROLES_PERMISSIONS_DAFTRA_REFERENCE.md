# AWJ Users, Roles & Permissions — Daftra Functional Reference

**Status:** Living reference — verification pass complete for Groups A / C / D / E / F  
**Date started:** 2026-09-08  
**Last research update:** 2026-09-08 — POS/Fuel PaymentService actor propagation audit  
**Last verification update:** 2026-09-08 — treasury actor propagation + report branch scope + direct cash-sale executable verification; closure pass same day for Group B (report exports), Customer report, Classification Analytics, Invoice/Purchase settle reachability  
**Scope:** Users, Employees, Roles, Permissions, Branch Scope, Resource Access, Record Scope, Workflow/Record State, Reports, permission-aware UX.  
**Reference product:** Daftra official documentation.  
**Verification detail:** [`AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md`](./AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md) — evidence matrix, per-gap severity, recommended PR breakdown.

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
AWJ has a meaningful treasury resource ACL, not just module-level RBAC. `CashBankAccountService::assertAllowed()` evaluates the selected CashBankAccount's `deposit` or `withdraw` scope against the actor and active branch context.

### 16.1 PaymentService — REFERENCE PATTERN, WITH ACTOR REQUIREMENT
`PaymentService::post(Payment $payment, ?User $actor = null)` resolves the actual CashBankAccount and calls:
```text
received -> assertAllowed(deposit)
paid     -> assertAllowed(withdraw)
```
The check occurs at posting time before `LedgerService::post()`. This is the correct resource-security boundary **only when a real actor is propagated for user-initiated operations**.

`CashBankAccount::allows()` behavior is important:
```text
scope=all    -> true even with actor=null
scope=branch -> branch match can succeed with actor=null
scope=role   -> requires non-null actor with matching role
scope=user   -> requires non-null actor with matching user id
```
Therefore omitting the actor is not a universal bypass. It produces inconsistent semantics: `all`/matching `branch` may pass, while `role`/`user` scopes fail even for a user who should be authorized. User-initiated callers must propagate the authenticated actor rather than rely on nullable service defaults.

### 16.2 PaymentController — GOOD
The direct API posting path calls:
```text
$this->payments->post($payment, $request->user())
```
so the authenticated actor reaches treasury ACL evaluation.

### 16.3 CashBankTransferService — GOOD
Internal transfer checks both sides before posting:
```text
source      -> withdraw
destination -> deposit
```
Thus authority on one treasury resource does not imply authority on the other.

### 16.4 EmployeeCustodyService — GOOD
Issuing employee custody resolves the selected cash/bank entity and checks `withdraw` before posting.

### 16.5 SupplierRefundService — GOOD
Supplier refund resolves the cash/bank entity and checks `deposit` before posting.

## 17. CONFIRMED actor-propagation defects in composed payment flows
Static call-site inspection found user-initiated flows that create a Payment and immediately call `PaymentService::post()` **without passing the actor**, even though the caller already has or can carry the authenticated actor.

### 17.1 POS checkout — CONFIRMED DEFECT
`PosController::checkout()` correctly sets both:
```text
data.created_by = request user id
data.actor      = request user object
```
and `PosService` uses the actor for session/audit controls.

However, the POS tender posting call is of the form:
```text
$this->payments->post($this->payments->create([...]))
```
with no second actor argument.

Consequence:
- `deposit_scope=all`: payment can post;
- matching `deposit_scope=branch`: payment can post based on BranchContext;
- `deposit_scope=role`: fails because actor is null, even when the cashier has the permitted role;
- `deposit_scope=user`: fails because actor is null, even when the cashier is the explicitly permitted user.

This means the current POS path does **not faithfully enforce configured treasury ACL semantics**. It can deny legitimate authorized POS checkout under role/user-scoped treasury configuration. Status: **Confirmed high-priority authorization integration defect.**

This is primarily a fail-closed availability/functional authorization bug for role/user scopes, not evidence that a forbidden user can bypass those scopes. The security issue is inconsistent policy enforcement and future fragility from nullable actor propagation.

### 17.2 Fuel sale collection — CONFIRMED DEFECT
`FuelSaleService` receives a real `User $actor`, stores `created_by => $actor->id`, and uses actor context throughout the domain flow. But the payment collection call likewise uses:
```text
$this->payments->post($this->payments->create([...]))
```
without passing `$actor` to `post()`.

The same ACL consequence applies: role/user-scoped cash/bank deposit permissions cannot recognize the authorized fuel operator because the actor is lost at the PaymentService boundary. Status: **Confirmed high-priority authorization integration defect.**

### 17.3 InvoiceService automatic settlement — CONFIRMED CALL-SITE RISK
`InvoiceService` contains an internal settlement path that creates a Payment and calls:
```text
$this->payments->post($payment)
```
without actor propagation. The exact externally reachable workflows and intended authority semantics must be covered by executable tests before deciding the repair signature/BC strategy. Status: **Confirmed actor omission; impact to verify by workflow.**

### 17.4 PurchaseService automatic settlement — CONFIRMED CALL-SITE RISK
`PurchaseService` likewise creates a payment and calls `post($payment)` without actor propagation. Status: **Confirmed actor omission; impact to verify by workflow.**

## 18. Treasury ACL boundary exceptions / special cases
Not every journal line touching a cash account is a user-selected CashBankAccount movement.

### 18.1 POS drawer cash_in / cash_out — NOT AN ACCOUNTING MONEY MOVEMENT
`PosSessionService::recordCashMovement()` records physical drawer movement for reconciliation and does not post a journal entry or alter the cash account. It enforces session actor branch/warehouse scope and POS operation policy. Absence of CashBank `assertAllowed()` here is not currently a treasury ACL bypass.

### 18.2 POS variance settlement — POLICY AMBIGUITY
`PosSessionService::settleVariance()` posts shortage/overage against a server-resolved session cash account after `pos.variance.approve`, state/acknowledgement/one-time guards and optional SoD. It resolves through `resolveForPayment()` but does not call `assertAllowed()`.

Policy question:
```text
Does pos.variance.approve authorize accounting adjustment of the session treasury
regardless of the user's deposit/withdraw ACL?
```
If treasury ACL is absolute, this is a gap. If variance authority is a privileged domain override over a server-bound account, that exception must be explicit, auditable and high-risk. Status: **Policy ambiguity; do not change automatically.**

### 18.3 Direct cash sale in InvoiceService — STRONG CANDIDATE CONSISTENCY GAP
`InvoiceService` has a legacy/direct cash-sale journal path using server-defined cash account `1110` and explicitly does not pass through CashBankAccountService. A cash invoice can therefore create cash-account effect without evaluating CashBank deposit ACL.

Status: **Strong candidate treasury ACL consistency gap; restricted-user executable test required before implementation.**

## 19. Treasury security invariant — TARGET
For user-initiated financial effects:
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

For user-initiated composed services, the actor must remain explicit across service boundaries. `created_by` is audit attribution and must not be silently substituted for the authenticated authorization principal unless a deliberately designed trusted execution contract says so.

Server/system jobs, migrations and deterministic system adjustments may legitimately have no interactive actor, but those need an explicit system-authority contract rather than accidentally inheriting nullable actor behavior.

## 20. Cash/bank audit matrix — current
| Money path | Cash/bank effect | Actor/resource ACL status | Classification |
|---|---|---|---|
| Direct receipt/payment API | deposit/withdraw | request user passed to PaymentService | Good |
| Internal cash/bank transfer | source withdraw + destination deposit | actor checked on both | Good |
| Employee custody issue | withdraw | actor checked | Good |
| Supplier refund received | deposit | actor checked | Good |
| POS checkout tenders | deposit | actor exists upstream but omitted at PaymentService post | **Confirmed defect** |
| Fuel sale collection | deposit | actor exists upstream but omitted at PaymentService post | **Confirmed defect** |
| Invoice automatic settlement | deposit | PaymentService post called without actor | Confirmed omission / impact verify |
| Purchase automatic settlement | withdraw | PaymentService post called without actor | Confirmed omission / impact verify |
| POS drawer cash_in/out | no ledger/cash-account mutation | POS operational policy | Not treasury movement |
| POS variance settlement | server-derived session cash journal | no assertAllowed | Policy ambiguity |
| Direct cash sale in InvoiceService | debit cash account | no CashBank ACL | Strong candidate consistency gap |

## 21. Restricted-user executable test matrix — REQUIRED NEXT
Before code repair, tests should prove current behavior and prevent accidental accounting/security regressions.

Minimum treasury cases:
1. POS + `deposit_scope=user` matching cashier -> should succeed; expected current failure due null actor.
2. POS + `deposit_scope=user` different cashier -> must fail.
3. POS + `deposit_scope=role` matching role -> should succeed; expected current failure.
4. POS + `deposit_scope=branch` matching active branch -> succeeds; ensure this remains intentional.
5. Fuel collection with matching user/role scope -> should succeed; expected current failure.
6. Fuel collection with non-matching user/role -> must fail.
7. Invoice automatic paid/settlement flow with restricted deposit scope -> characterize current behavior and desired actor.
8. Purchase automatic settlement with restricted withdraw scope -> characterize current behavior and desired actor.
9. Direct cash invoice posting by user forbidden from default cash deposit -> determine whether policy requires rejection.
10. POS variance settlement by actor lacking session cash resource authority -> determine policy, not merely current behavior.

All financial tests must assert **no partial side effects on rejection**: no posted Payment, no duplicate journal, no paid_amount drift, no inconsistent invoice/purchase state, and transaction rollback remains atomic.

## 22. Dependency / sensitive permission principles
Permission dependencies remain domain-defined rather than inferred globally. Sensitive candidates include role/user administration, apps/developer, accounting settings, period locks, fiscal close/reopen, treasury movement, supplier refunds, POS override/variance/audit, minimum-price override, product cost visibility, Fuel controls and Document Center control-plane actions.

## 23. Accounting invariants
Authorization and accounting validity are separate. Permissions never override tenant isolation, ledger integrity, source-generated/immutable rules, period/fiscal locks or ZATCA lifecycle restrictions.

## 24. Feature/application state
```text
Tenant entitlement / enabled feature AND tenant policy AND user permission AND applicable scope
```
Permission never activates an unavailable feature.

## 25. Impersonation
If added later: restricted permission, preserve original actor, audit trail, obvious impersonation state, no tenant crossing and sensitive-operation review.

## 26. Code-backed gap matrix — current

Verdicts marked **[V]** were closed by executable evidence in the 2026-09-08
verification pass (see the verification report for the exact test names and
line-referenced sources).

| Capability | AWJ evidence | Status | Direction |
|---|---|---|---|
| Tenant isolation | tenant-scoped models; cross-tenant `branch_id` filter returns ∅ **[V]** | Confirmed correct | Preserve |
| Custom/system roles | RBAC + RoleController | Present | Preserve |
| Login enable/disable | users.is_active | Present | Preserve |
| User branch/warehouse scope | assignments + predicates | Present | Audit consumers |
| Cash/bank ACL foundation | deposit/withdraw subjects; null actor semantics match §16.1 exactly **[V]** | Confirmed correct | Preserve |
| Direct Payment API actor propagation | `PaymentController.php:146` passes `$request->user()` **[V]** | Confirmed correct baseline | Preserve |
| POS Payment actor propagation | `PosService.php:248` omits actor **[V]** | **Confirmed gap — P1** | Pass `$data['actor']` as second arg |
| Fuel Payment actor propagation | `FuelSaleService.php:330` omits actor **[V]** | **Confirmed gap — P1** | Pass `$actor` as second arg |
| Invoice auto-settlement actor | `InvoiceService.php:1052` omits actor + user-controlled `is_paid=true` on `StoreInvoiceRequest.php:30` reaches the path **[V]** | **Confirmed reachable gap — P1** (upgraded from P2 after closure verification) | Plumb actor through `settle()` callers |
| Purchase auto-settlement actor | `PurchaseService.php:563` omits actor + user-controlled `paid_on_post` on `StorePurchaseRequest.php:36` reaches the path **[V]** | **Confirmed reachable gap — P1** (upgraded from P2) | Same shape as Invoice |
| POS variance vs treasury ACL | `PosSessionService::settleVariance` has no `assertAllowed` **[V]** | **Policy decision required** | Product picks privileged-override vs absolute-boundary |
| Direct invoice cash-sale treasury ACL | `InvoiceService.php:44,863` debit 1110 directly; stranger-scoped deposit still succeeds **[V]** | **Confirmed gap — P1** | Reroute through `CashBankAccountService::assertAllowed(deposit)` |
| Canonical permission catalogue | Rbac::PERMISSIONS | Present/rich | Preserve exact keys |
| Role arbitrary-action labels | non-manage shown as View | Confirmed defect | Metadata-driven labels |
| Role multi-segment keys | positional split truncates keys | Confirmed high-priority defect | Never reconstruct keys |
| Permission dependencies | no generic engine confirmed | Missing/verify | Domain metadata + BC design |
| Sensitive risk labels/warnings | absent | Missing | Governance UX |
| Role cloning | not found | Missing | Candidate parity |
| Invoice own/assigned scope | predicate absent | Missing | Define semantics |
| Partner owner/assignee scope | no model | Missing capability | Product/data decision |
| Purchase report branch scope | `PurchaseReportService.php:65,82` — `withoutGlobalScope(BranchScope)` + no `allowedBranchIds` intersection **[V]** | **Confirmed gap — P1** | Shared `RestrictedBranchScope` helper |
| Sales report branch scope | `SalesReportService.php:80-83` — no `allowedBranchIds` intersection; forbidden `branch_id[]` returns forbidden data **[V]** | **Confirmed gap — P1** | Same helper |
| Inventory warehouse balance scope | `InventoryReportService.php:63,104` — no user warehouse/branch intersection **[V]** | **Confirmed gap — P1** | Helper + warehouse-intersection variant |
| Customer report branch scope | `CustomerReportService.php:66,149,198` — same `withoutGlobalScope` pattern; runtime-verified restricted user sees both branches **[V]** | **Confirmed gap — P1** | Same helper as Purchase/Sales |
| Classification Analytics branch scope | `ClassificationAnalyticsReportService.php:53-56,73-77,100` — all six scopes route through three helpers, each stripping BranchScope; runtime-verified for `sales_invoice` **[V]** | **Confirmed gap — P1** (source-shape covers the other five scopes) | Apply the helper inside `documents()` / `payments()` / `partners()` |
| Report exports (CSV/PDF/print) scope | five report controllers have NO server-side export method (reflection-verified); web/ renders CSV+PDF client-side from JSON via `@/lib/export` + jsPDF **[V]** | **Not applicable (server-side)** — export ≡ API scope by construction | Fix at the API layer only |
| Inventory catalog export (`/api/inventory/export`, separate surface) | `InventoryController.php:57-85` + `InventoryBalanceFilters.php:57-59` — tenant-wide `Product::query()`, no warehouse intersection; runtime-verified aggregate leaks **[V]** | **Confirmed gap — P2** (aggregate, no per-warehouse breakdown) | Warehouse-intersect the aggregate or add per-warehouse breakdown |
| Accounting-core reports scope | `ReportService.php:811-836` intersects with `allowedBranchIds()` | Confirmed correct pattern | Reuse as reference for the fix helper |
| HR approval workflow membership | broad hr.manage | Missing | Define policy |
| POS audit branch/drill-down/export | scoped | Present/good | Reuse |
| Generic Activity Log | not confirmed | Missing/unknown | Decide parity scope |
| Soft-delete foundation | widespread SoftDeletes | Present | Not recycle bin |
| Tenant Recycle Bin | no general workflow found | Missing | Product/security design |
| CashBankTransfer / EmployeeCustody / SupplierRefund | still call `assertAllowed` **[V]** | Confirmed correct | Preserve |

## 27. Architectural conclusions
1. AWJ treasury ACL foundation is worth preserving; the current issue is integration consistency, not architecture absence.
2. Nullable actor propagation is now a concrete defect pattern in composed financial services.
3. POS and Fuel have confirmed user-initiated actor loss at PaymentService posting.
4. `scope=all/branch` succeeding with null while `scope=user/role` fails makes this defect configuration-dependent and easy to miss in normal tests.
5. Never use `created_by` as an implicit authorization principal merely to patch the symptom; actor/system authority should be explicit.
6. Direct cash invoice posting remains a separate treasury-consistency candidate because it bypasses CashBankAccountService entirely.
7. POS variance remains a deliberate policy decision.
8. Report scope remains the broadest systemic data-authorization risk and needs executable restricted-user verification too.

## 28. Current-data status
Safwan confirmed on 2026-09-08 that **all current AWJ data and transactions are experimental/test-only and not important production records**. This does not relax tenant isolation, authorization, accounting invariants, schema safety or future production readiness.

## 29. Documentation reconciliation
This living reference now includes the actor-propagation audit and the exact semantics of null actor under `all`, `branch`, `role` and `user` treasury scopes. POS and Fuel are documented as confirmed defects; Invoice/Purchase automatic settlement omissions are recorded for workflow-impact verification. No substantive finding from this pass is intentionally left only in chat.

## 30. Next inspection / execution pass
1. ~~Run targeted restricted-user executable tests for POS/Fuel actor propagation and characterize Invoice/Purchase auto-settlement.~~ **Done (2026-09-08).**
2. ~~In the same focused security test pass, verify the direct cash-invoice treasury candidate and selected report-scope P1 candidates.~~ **Done (2026-09-08).**
3. Do not change POS variance semantics until the privileged-exception policy is decided.
4. After executable evidence closure, draft small independent Access Control V2 PRs rather than one broad security refactor. Recommended breakdown: PR-ACL-PAYMENT-ACTOR (POS/Fuel), PR-ACL-CASH-SALE, PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR, PR-ACL-REPORT-SCOPE, PR-ACL-REPORT-EXPORT-SCOPE, and (BLOCKED on product decision) PR-ACL-POS-VARIANCE-POLICY. See §20 in the verification report for the full contract per PR.

## 31. Verification pass — 2026-09-08

Two passes on the same day.

**Initial pass:** executable evidence added in
`tests/Feature/AccessControlV2VerificationTest.php` (18 tests, treasury
actor + direct cash sale + policy characterization) and
`tests/Feature/AccessControlV2ReportScopeVerificationTest.php` (7 tests,
report branch scope + tenant negative control).

**Closure pass** (same day): `tests/Feature/AccessControlV2ClosureVerificationTest.php`
(9 tests). Closes Group B (report exports architecture + inventory
catalog export), Customer report runtime, Classification Analytics
runtime, Invoice `is_paid=true` reachability, Purchase `paid_on_post`
reachability. The two `settle()` gaps are upgraded from P2 → P1 by
proven HTTP reachability.

All 34 tests pass under `php artisan test --filter=AccessControlV2`
(284 assertions, ~11s). Verdicts folded into §26. Full report — with
evidence matrix, per-gap severity, PR breakdown and testability
blockers — in
[`AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md`](./AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md).

Remaining decision: POS variance policy (product-side).

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
