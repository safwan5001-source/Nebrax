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

## 32. PR-ACL-PAYMENT-ACTOR and PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR — shipped (2026-09-09)

The two P1 actor-propagation gaps recorded in §26/§31 above are now **closed
in `main`**, merged as two separate PRs. Historical verdicts in §26/§31 are
left as written (evidence of what was found, when) rather than rewritten;
this entry records disposition only:

- **PR #731** (`fix/access-control-payment-actor`) — POS (`PosService.php`)
  and Fuel (`FuelSaleService.php`) now pass `$actor` into
  `PaymentService::post()`'s second argument.
- **PR #734** (`fix/access-control-invoice-purchase-settle-actor`) —
  `InvoiceService::settle()` and `PurchaseService::settle()` now plumb actor
  through to the same call, closing the `is_paid=true` / `paid_on_post`
  reachable gaps.
- Merge commit for #734 (which contains #731): `c5a12aa701f7c65c0a19a8a0d169ffdd2a170701`.

POS variance policy (§30.3, §31) remains the one open, product-side decision
from that pass — untouched by either PR, as intended.

## 33. PR-ACL-REPORT-SCOPE — verification and fix (2026-09-09)

**Base:** `c5a12aa701f7c65c0a19a8a0d169ffdd2a170701` (PR #734 merge, includes #731).
**Branch:** `fix/access-control-report-scope`.

**Daftra remains the functional benchmark only** — no new authorization
architecture was introduced in its name. The fix reuses AWJ's own existing
Effective Branch Scope primitive (`ReportService::branchIds()`'s pattern,
mirrored — not reinvented — for services that don't extend `ReportService`)
and `User::allowedBranchIds()` / `allowedWarehouseIds()`.

This round closes the five **Confirmed gap — P1** report-scope rows recorded
in §26 (`Purchase report branch scope`, `Sales report branch scope`,
`Inventory warehouse balance scope`, `Customer report branch scope`,
`Classification Analytics branch scope`) with executable proof in
`tests/Feature/ReportEffectiveScopeTest.php` (22 tests, 284 assertions) —
the permanent regression suite that replaces the now-obsolete
characterization test `AccessControlV2ReportScopeVerificationTest.php`
(an untracked, unmerged leftover from the verification branch; it fails
under this fix because it asserted the pre-fix leaking behavior by design —
expected, not a regression).

**What was proven, per module:**

- **Sales / Purchase** (`SalesReportService.php`, `PurchaseReportService.php`):
  branch-filtered rows and totals (period view, profit view, payments-by-period,
  balances view) are now `requested branch_id ∩ User::allowedBranchIds() ∩ tenant`.
  A restricted user requesting an explicitly forbidden branch never receives
  that branch's rows or totals — falls back to the user's own allowed set
  (the existing `ReportService::branchIds()` behavior, mirrored exactly, not
  reinvented per-report). Proven with a two-branch fixture (allowed MAIN,
  forbidden OTHER) on both the no-filter and forbidden-explicit-filter cases.

- **Inventory** (`InventoryReportService.php`): `view=warehouses`,
  `view=movements`, and `view=stocktakes` are now
  `Tenant ∩ Effective Branch Scope ∩ Effective Warehouse Scope` (new
  `App\Support\ReportWarehouseScope` helper, same intersection pattern as
  branch scope, applied to `allowedWarehouseIds()`). Proven with an
  allowed/forbidden warehouse pair: forbidden-warehouse rows and their
  quantity/cost never appear in rows or totals, and an explicit forbidden
  `warehouse_id` request returns empty rather than leaking.
  **`view=value` is explicitly excluded from this fix** — `quantity_on_hand`
  and `avg_cost` are global scalars on `Product` (one moving average per
  tenant, not decomposable per warehouse without the same query redesign
  needed for the already-deferred P2 `/api/inventory/export` gap). Filtering
  the product list without correcting the displayed value would be false
  security; documented in-code as a deliberate deferral on
  `InventoryReportService::trackedProducts()`, not a silent gap.

- **Customer** (`CustomerReportService.php`): master identity (`GET /api/partners/{id}`)
  is unchanged and stays visible per the existing identity contract (§9 of
  the Target Contract) — a customer with activity in a forbidden branch is
  still findable by name/id. What changed is the branch-derived financial
  aggregates: sales total, invoice count, and balance (`view=sales`,
  `view=balances`) now derive only from the user's allowed branch activity.
  Proven with one customer having posted invoices in both an allowed and a
  forbidden branch — the aggregate reflects only the allowed branch's amount.

- **Classification Analytics** (`ClassificationAnalyticsReportService.php`):
  all three helper families — `documents()` (sales_invoice/purchase_invoice
  scopes), `payments()` (receipt/payment scopes), and `partners()`
  (customer/supplier scopes) — are now branch-scoped via the same
  `ReportBranchScope::resolve()` call, applied both to the base filter and,
  in `partners()`, to the `leftJoin` closure that pulls in each partner's
  transaction amount (the existing `orWhereNull('partners.branch_id')`
  company-wide-partner-visibility semantic was preserved unchanged). Proven
  for `sales_invoice`, `purchase_invoice`, `receipt`, and the customer side
  of `partners()` with an allowed/forbidden branch pair each.

**Export relationship — verified, not assumed:** all five report React
workspaces (`reports-workspace.tsx`, `purchases-reports-workspace.tsx`,
`inventory-reports-workspace.tsx`, `customers-reports-workspace.tsx`,
`classification-analytics-workspace.tsx`) build their CSV/PDF exports
directly from the same `report.data`/`report.totals` state populated by the
JSON API response — confirmed by reading each file, not inferred. There is
no separate export query or endpoint for any of the five report families,
so fixing rows+totals fixes the export by construction; no separate
export-specific test was needed for this PR.

**Explicitly left out of scope — not conflated with this P1 fix:**
`/api/inventory/export` (`InventoryController.php` +
`InventoryBalanceFilters.php`) is a **separate surface** from
`/api/reports/inventory` (different controller, different query, feeds the
product-catalog inventory-balance export screen, not the analytical report
workspace). Its confirmed gap is tracked in §26 as **P2** (tenant-wide
aggregate, no per-warehouse breakdown) and is reserved for a future,
separately-scoped `PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE`. Nothing in that
controller or its export path was touched here.

**Shared boundary, not a forced shared service:** two small, focused helper
classes were added — `App\Support\ReportBranchScope` and
`App\Support\ReportWarehouseScope` — each a literal mirror of
`ReportService::branchIds()`'s existing intersection logic, reused across
the five report services that don't extend `ReportService`. No centralized
`ReportScopeService` was introduced; each report service still owns its own
query shape and filter semantics, only the branch/warehouse intersection
itself is shared (proven identical semantics, no scope widening, covered by
tests, per the Target Contract's "shared contract, not forced shared
helper" instruction).

**CI:** full suite green on SQLite locally (3073 passed, 11 skipped); the
only failures are the pre-existing orphaned/untracked verification
characterization files (`AccessControlV2VerificationTest.php`,
`AccessControlV2ClosureVerificationTest.php`,
`AccessControlV2ReportScopeVerificationTest.php` — none tracked in this
repository's git history, leftovers from an earlier abandoned verification
branch) and one unrelated `DocumentCenterSecureIntakeTest` PDF-fixture
failure with no relation to reports, branches, or warehouses.

## 34. Treasury Resolution Inspection — Direct Cash Sale (2026-09-09)

**Inspection only — no production code changed.** Answers, with code
citations, the question §18.3/§20/§26 left open: when a direct cash-sale
invoice posts, how is the actual Treasury/CashBankAccount determined, and
how does it relate to the debited GL account?

**Daftra functional rule reaffirmed:** action permission ≠ treasury resource
permission — posting an invoice must not implicitly grant deposit rights
into whatever cash account the invoice happens to touch. Functional
benchmark only; nothing below is architecture borrowed from Daftra.

### Two distinct cash-sale mechanisms in `InvoiceService`, not one

`protected function paymentType(?string $requested, bool $isPaid): string`
(`InvoiceService.php:312-315`) makes them **mutually exclusive**:
`$isPaid ? 'credit' : ($requested ?: 'credit')`. `is_paid=true` always
forces `payment_type='credit'` — it can never be `'cash'`.

1. **`is_paid=true` (any payment_type request) — fully protected, unchanged
   by this inspection.** Debits `accounts_receivable` (1130) in the
   invoice's own journal, then `settle()` (`InvoiceService.php:1082-1103`)
   creates a real `Payment` with `cash_account_id = $invoice->cash_account_id`
   and calls `PaymentService::post($payment, $actor)` — actor propagated
   since PR #734. `PaymentService::post()` (`PaymentService.php:244`)
   resolves the Treasury via `CashBankAccountService::resolveForPayment()`
   (line 291) and checks `assertAllowed($cashEntity, 'deposit', $actor)`
   (lines 292-296) **before** posting. Proven by the existing tracked test
   `the_chosen_treasury_account_receives_the_collection`
   (`tests/Feature/InvoiceTest.php`) and by `ApiInvoiceTest`'s
   `invoice_auto_settlement_*_deposit_scope_user_*` pair.

2. **`payment_type='cash'`, `is_paid=false` — the direct/legacy cash sale,
   the confirmed gap.** `InvoiceService::post()` (`InvoiceService.php:907-909`):
   ```php
   $debitAccountId = $invoice->payment_type === 'cash'
       ? $this->accountId(self::ACC_CASH)   // hardcoded '1110'
       : $this->accountRoles->resolve('accounts_receivable')->id;
   ```
   `accountId()` (`InvoiceService.php:1240-1249`) is a raw
   `Account::where('code', $code)->first()` lookup — tenant-scoped only
   (via `Account`'s own global scope), no branch awareness, no settings, no
   `AccountRoleResolver`/ACC-3 involvement (deliberately, per the comment at
   `InvoiceService.php:39-43`). **`Invoice.cash_account_id` is never read on
   this path** — `CashBankAccountService` is never called, neither
   `resolveForPayment()` nor `assertAllowed()`. The frontend itself only
   ever sends `cash_account_id` when `is_paid` is checked
   (`web/src/components/invoices/invoice-form.tsx:599`:
   `cash_account_id: isPaid ? cashAccountId || null : null`) — for a plain
   cash sale, no treasury is offered or sent in the first place.

### Does GL `1110` uniquely identify a Treasury Resource? **YES.**

- `cash_bank_accounts` has `$table->unique(['tenant_id', 'account_id'])`
  (`2025_01_01_000070_create_cash_bank_accounts_and_transfers.php:34`) — at
  most one `CashBankAccount` per `(tenant, Account)`.
- `CashBankAccountService::bootstrapDefaults()` seeds exactly one
  `CashBankAccount` (`account_id` → the tenant's `1110` Account, `is_main =
  true`, `deposit_scope = 'all'`) the first time it runs, and is called
  from `AuthController::register()` (`AuthController.php:57`) — i.e. at
  tenant creation, for every tenant, before any invoice can exist.
- A `CashBankAccount` that `is_main` can never be deleted
  (`CashBankAccountService::delete()`), so the link is durable.
- Therefore `1110` **is** resolvable, deterministically, to exactly one
  `CashBankAccount` — via `CashBankAccountService::resolveForPayment($glId,
  'cash')`, the same call `PaymentService` already makes. The direct
  cash-sale path already computes that exact GL id; it simply never takes
  the one extra step to resolve and authorize the `CashBankAccount` behind
  it.
- Caveat: this always resolves to the tenant's single **main** cash
  treasury — never an alternate one — because the debit account is
  hardcoded to `1110` regardless of any `cash_account_id` a caller might
  send. A future fix authorizes access to *that one* treasury; it does not,
  by itself, add multi-treasury selection to direct cash sales.

### Normal Payment vs Direct Cash Sale

| Step | Normal Payment (`PaymentService::post`) | Direct Cash Sale (`InvoiceService::post`, `payment_type=cash`) | Difference |
|---|---|---|---|
| Actor available | Yes — `PaymentController` passes `$request->user()` | Yes — `InvoiceController::post()` passes `$request->user()` (`InvoiceController.php:335`) | None |
| Treasury selected/resolved | Yes — `CashBankAccountService::resolveForPayment($payment->cash_account_id, $method)` (`PaymentService.php:291`), defaults to the tenant's `is_main` `CashBankAccount` when null | No — hardcoded `accountId('1110')`; `Invoice.cash_account_id` never read on this path | Payment resolves a Treasury resource; Direct Cash Sale resolves a raw GL code only |
| Treasury ACL checked | Yes — `assertAllowed($cashEntity, 'deposit', $actor)` (`PaymentService.php:292-296`) | **No — not called anywhere on this path** | **The confirmed gap** |
| Direction | deposit | (would be deposit, if checked) | — |
| GL account resolved | `$cashEntity->account_id` — via the Treasury | `accountId('1110')` — hardcoded constant, no Treasury layer | Payment: Treasury→GL; Direct Cash Sale: GL only |
| Journal posted | Yes, `LedgerService::post()`, source = `Payment` | Yes, `LedgerService::post()`, source = `Invoice` | Same engine |
| Transaction boundary | `DB::transaction()`, row-locked, draft re-checked | `DB::transaction()`, row-locked, draft re-checked | Same pattern |

### Branch semantics

`CashBankAccount implements CompanyWide` (no `branch_id` column) —
treasuries are shared across a tenant's branches by design. A `branch`
deposit/withdraw scope stores a specific branch id in
`deposit_scope_subject` and is compared, inside `assertAllowed()`
(`CashBankAccountService.php:260-267`), against **the active
`BranchContext`** (`app(BranchContext::class)->id()` — the request's active
branch, set per-request, independent of any resource's stored `branch_id`),
not against `Invoice.branch_id`. This means a future fix needs no new
branch plumbing: calling `assertAllowed()` from `InvoiceService::post()`
picks up the same active-branch semantics every other money path already
uses, automatically.

### Characterization test — proves the gap executes, not just reads

Added to the existing tracked `tests/Feature/ApiInvoiceTest.php` (no new
file, no production change):
`direct_cash_sale_bypasses_treasury_deposit_acl_characterization` — a
`stranger` user is the *only* one the tenant's main cash treasury allows to
deposit (`deposit_scope='user'`, subject = stranger); the tenant owner
(not the stranger) still posts a direct cash-sale invoice successfully,
and the resulting journal debits exactly that treasury's GL account
(`1110`), with zero `Payment` rows created — `CashBankAccountService` is
never consulted. All 8 tests in the file pass (81 assertions), including
the two pre-existing `deposit_scope=user` tests for the `is_paid` path,
confirming no regression and an accurate characterization.

### Target Contract classification: **A — Already resolvable**

Direct Cash Sale already has a deterministically resolvable Treasury
identity (`1110` → the tenant's main cash `CashBankAccount`, proven above);
it simply bypasses the ACL check. The invariant
`resolve Treasury → assertAllowed(deposit, actor) → existing posting
unchanged` is directly implementable without a Treasury selector, API
change, migration, or GL-routing change — the smallest possible PR shape
(§14 below), not a resource-selection redesign.

### Recommended `PR-ACL-CASH-SALE` shape (proposal only, not implemented)

In `InvoiceService::post()`, immediately after computing `$debitAccountId`
for the `payment_type === 'cash'` branch: resolve
`$this->cashBankAccounts->resolveForPayment($debitAccountId, 'cash')` and
call `$this->cashBankAccounts->assertAllowed($cashEntity, 'deposit',
$actor)` before building `$lines`. No change to `$debitAccountId` itself,
no new request field, no UI change required (the gap is enforcement, not
resource selection). Requires injecting `CashBankAccountService` into
`InvoiceService` (not currently a constructor dependency). Test plan:
flip the new characterization test's expectation to a 422 denial, add the
symmetric `deposit_scope=user` **allow** case (mirroring
`invoice_auto_settlement_succeeds_when_deposit_scope_user_matches_the_authenticated_actor`),
and confirm the `1110`-debiting accounting tests in `InvoiceTest.php` still
pass unchanged (no formula change — only a `WHERE authorized` gate before
posting). **Not started. Requires explicit approval first.**

### Scope confirmed unchanged by this inspection

Migration/schema: none. `InvoiceService`, `PaymentService`,
`CashBankAccountService`, `CashBankAccount` ACL, POS/Fuel, GL `1110`,
accounting formulas: none touched. `PurchaseService` has no symmetric
direct-cash-debit shortcut (cash purchase settlement always routes through
`settle()`/`PaymentService`) — grep-confirmed, not deep-audited; a future
purchase-side inspection would need its own pass, out of scope here.

## 35. Direct Cash Sale Treasury ACL — Implemented (2026-09-09)

**PR-ACL-CASH-SALE**, `fix/access-control-direct-cash-sale-treasury`. Closes
exactly the gap §34 classified as **A — Already resolvable**. §34 itself is
left unedited as historical characterization of the pre-fix state.

**Daftra functional principle (reaffirmed, unchanged):** action permission
≠ treasury resource permission. Posting an invoice must not implicitly
grant deposit rights into whatever cash account it happens to touch.
Functional benchmark only — nothing below is imported architecture.

**Pre-fix gap:** `InvoiceService::post()`, `payment_type === 'cash'`
branch, computed `$debitAccountId = accountId('1110')` and posted directly
— no call to `CashBankAccountService` anywhere on that path, so no
resolution and no `assertAllowed()`. `is_paid=true` (a separate, mutually
exclusive path via `paymentType()`) was already fully protected since PR
#734.

**Exact fix** (`InvoiceService.php`, `post()`, right after `$debitAccountId`
is computed, before `$lines` is built):
```php
if ($invoice->payment_type === 'cash') {
    $cashEntity = $this->cashBankAccounts->resolveForPayment($debitAccountId, 'cash');
    $this->cashBankAccounts->assertAllowed($cashEntity, 'deposit', $actor);
}
```
`CashBankAccountService` added as a constructor dependency (same DI style
as every other collaborator). No other line in `post()` changed.

**Treasury resolution remains 1110 → existing CashBankAccount:**
`$debitAccountId` itself is untouched — still the hardcoded `accountId('1110')`
lookup. `resolveForPayment($debitAccountId, 'cash')` (the same method
`PaymentService` already calls) resolves the *existing* `CashBankAccount`
row that `bootstrapDefaults()` seeded on that exact GL account at tenant
registration (§34, §7) — no new treasury, no selection, no alternate
routing. The journal still debits `1110` with the identical amount as
before.

**Deposit ACL now enforced:** `assertAllowed()` throws (→ HTTP 422 via the
same `RuntimeException` → `domain()` handling every other money path uses)
before any journal line is built, so the entire `DB::transaction()`
(invoice status, journal entry, inventory/COGS if any) rolls back
atomically on denial — the invoice stays `draft`.

**Actor semantics — no new policy invented:** `InvoiceController::post()`
already passed `$request->user()` as the third argument to
`InvoiceService::post()` before this fix (established in §34); that actor
now reaches `assertAllowed()` unchanged. Call-site audit of every caller of
`InvoiceService::post()`:
- `InvoiceController.php:335` — HTTP path, always an authenticated,
  non-null actor (Sanctum guarantees this before the controller runs).
  **The only caller that can produce `payment_type === 'cash'`.**
- `PosService.php:228` and `FuelSaleService.php:205` — call `post()` with
  no actor (`null`), but both always create their invoices with
  `payment_type: 'credit'` (`PosService.php:222`,
  `FuelSaleService.php:177`) — **grep-confirmed neither ever reaches the
  `'cash'` branch**, so the new gate never executes for them. Zero
  backward-compatibility risk from internal null-actor callers; none
  needed a fallback or policy change.

**Branch semantics unchanged:** no branch parameter was added anywhere.
`assertAllowed()` reads `app(BranchContext::class)->id()` internally
exactly as it already did for the `is_paid`/`PaymentService` path (§34,
§8) — a `branch`-scoped treasury on a direct cash sale is authorized
against the same active request branch every other money path uses,
automatically, with no new plumbing.

**Test evidence** (`tests/Feature/ApiInvoiceTest.php`, all tracked, all
passing):

| Case | Expected | Result |
|---|---|---|
| `deposit_scope=all` (bootstrap default, unmodified) | allow | `creating_and_posting_an_invoice_via_api_generates_a_balanced_entry` — unmodified, still passes; direct cash sale still succeeds, debits 1110 |
| `deposit_scope=user`, subject = actor | allow | `direct_cash_sale_succeeds_when_deposit_scope_user_matches_the_authenticated_actor` — posts, debits 1110 for the identical amount (115000), zero `Payment` rows |
| `deposit_scope=user`, subject ≠ actor | deny, atomically | `direct_cash_sale_is_denied_when_deposit_scope_user_does_not_match_the_actor_with_no_partial_effect` — HTTP 422, invoice stays `draft`, no new `JournalEntry`, no `Payment` |
| Existing `is_paid=true` protected path | unchanged | `invoice_auto_settlement_succeeds_/_is_denied_when_deposit_scope_user_...` (pre-existing, PR #734) — both still pass unmodified |

The prior "characterization" test from PR #738
(`direct_cash_sale_bypasses_treasury_deposit_acl_characterization`, which
asserted the pre-fix leak) was replaced by the Deny test above — same
fixture shape, flipped expectation, per the explicit instruction not to
leave a test asserting vulnerable behavior once the vulnerability is
closed.

**Accounting invariants — proven unchanged:** invoice totals, VAT, revenue
account, debit amount, GL `1110`, journal balance (Σdebit=Σcredit), source
type/id, posting date, document numbering, settlement behavior — all
verified by the full existing `InvoiceTest.php` suite (60 tests, 332
assertions, zero modified) passing unchanged, plus the Allow test above
asserting the exact same 115000 debit on 1110 as pre-fix. The only
behavioral difference: `cash sale → 1110 → post` becomes `cash sale → 1110
→ resolve corresponding Treasury → authorize deposit → post`.

**`is_paid=true` confirmed unchanged:** `settle()`, `PaymentService::post()`,
and `cash_account_id` selection for that path were not touched. Both
pre-existing `invoice_auto_settlement_*_deposit_scope_user_*` tests
(PR #734) re-ran unmodified and still pass.

**CI:** full suite green on SQLite locally (3127 passed, 11 skipped, up
from 3073 in PR #736 as expected — 54 more from `main` advancing). The 16
failures are unrelated to this fix: the same three untracked/unmerged
verification-branch leftovers as before
(`AccessControlV2VerificationTest.php`,
`AccessControlV2ClosureVerificationTest.php`,
`AccessControlV2ReportScopeVerificationTest.php` — none tracked in this
repository's git history), **plus one new failure inside that same
untracked `AccessControlV2VerificationTest.php`**
(`direct_cash_sale_debits_cash_account_without_cashbank_acl`) — it
asserted the pre-fix leak by design (posts successfully, no ACL check),
and now correctly fails because the gap it characterized is closed. This
is the expected, direct proof the fix works, not a regression. Plus the
same pre-existing, unrelated `DocumentCenterSecureIntakeTest` PDF-fixture
failure.

**Remaining Access Control V2 gaps:** none from the treasury/actor audit
(§17–§21) remain — POS/Fuel actor propagation (#731), Invoice/Purchase
settle actor propagation (#734), Report Scope (#736), and now Direct Cash
Sale treasury ACL are all closed. Open items: POS variance vs treasury ACL
(§18.2 — explicit product policy decision, not started) and Report Export
Scope for `/api/inventory/export` (P2, tracked separately for
`PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE`).

## 36. PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE — inspection: BLOCKED (2026-09-09)

**Outcome: BLOCKED — requires an inventory valuation/data-model decision,
not an authorization bug fix.** No production code changed. §34/§35 remain
unedited as historical characterization; this entry documents disposition
on the P2 row §26 tracked as `Inventory catalog export`.

### Endpoint call chain

`GET /api/inventory/export` (`routes/api.php:410`, guarded by
`products.view` + `EnsureApplicationActive:inventory.core`, no branch/
warehouse middleware) → `InventoryController::export()`
(`InventoryController.php:57-85`) → `InventoryBalanceFilters::query()` +
`::apply()` (`InventoryBalanceFilters.php:56-116`) → `InventoryBalanceExportService::download()`
(`InventoryBalanceExportService.php:86-105`) → CSV/XLSX streamed response.

### Pre-fix exposure — exhaustively enumerated

`InventoryBalanceFilters::query()` is exactly `Product::query()->where('track_inventory', true)`
— no `withoutGlobalScope`, no join to `product_warehouse_stock`. Accepted
filters (`InventoryBalanceFilters::rules()` + `ExportInventoryBalancesRequest`):
`search`, `unit`, `qty_min`/`qty_max`, `avg_cost_min`/`avg_cost_max`,
`stock_value_min`/`stock_value_max`, `scope`, `format`, `include_zero`.
**No `branch_id` or `warehouse_id` parameter exists anywhere in this
endpoint's contract** — there is nothing to accept, validate, or intersect.
Exported columns (`InventoryBalanceExportService::COLUMNS` /
`row()`, lines 51-59, 171-182): `sku`, `barcode`, `name`, `unit`,
`quantity` (= `Product.quantity_on_hand`), `avg_cost` (=
`Product.avg_cost`, already redacted to `null` for a user lacking
`products.view_cost` via `SensitiveCostPolicy` — pre-existing, unrelated
control, untouched here), `stock_value` (derived,
`quantity_on_hand × avg_cost`, same redaction). No warehouse column, no
branch column, no per-warehouse breakdown anywhere in the payload.

### Catalog identity vs inventory facts

| Field / Aggregate | Source | Tenant-global / Branch / Warehouse | Authorization treatment |
|---|---|---|---|
| `sku`, `barcode`, `name`, `unit` | `products.*` (catalog identity) | Tenant-global, subject to `Product`'s own implicit `BranchScope` (see below) | Existing, standard — not a report-scope leak; identity visibility is a separate, already-governed concern |
| `quantity` | `products.quantity_on_hand` | **Tenant-global scalar** — one moving total per product per tenant, not decomposed per warehouse in this query | Not warehouse-scoped; no such dimension exists in the data this query reads |
| `avg_cost` | `products.avg_cost` | **Tenant-global scalar** — one moving average per product per tenant | Not warehouse-scoped (same reason); separately gated by `SensitiveCostPolicy` on `products.view_cost` (cost-visibility permission, not warehouse/branch scope) |
| `stock_value` | derived `quantity_on_hand × avg_cost` | **Tenant-global**, inherits both scalars above | Same as `avg_cost` |
| (no warehouse-derived field exists in the export) | — | — | — |

`Product` uses the `BranchScoped` trait (implicit `BranchScope` global
scope, `Product.php:23-25`) — **already** filters to
`branch_id = active BranchContext OR branch_id IS NULL`, and `BranchContext`
is **already** validated against `User::canAccessBranch()` by the
pre-existing `SetBranch` middleware (`SetBranch.php:44-53`) before any
controller runs — the same mechanism protecting every other `BranchScoped`
model (`Partner`, etc.) tenant-wide, not something specific to or missing
from this endpoint. No new branch-scope work was needed or done here.

### Why this is BLOCKED, not a missing-filter bug

`quantity_on_hand` and `avg_cost` are the **identical** tenant-global
`Product` scalars that `InventoryReportService::trackedProducts()`
(feeding `view=value`) already deferred in PR #736, for the identical
reason, stated in that method's own doc-comment
(`InventoryReportService.php:64-73`): *"not decomposable per warehouse
without a query redesign identical to the deferred P2 export fix"* — a
comment written during PR #736 that names this exact endpoint. Producing
a "warehouse-scoped quantity/avg_cost" would mean sourcing the exported
numbers from `product_warehouse_stock` (per-warehouse rows) instead of
`products` columns (one tenant-wide moving average) — changing what
`quantity`/`avg_cost` **mean** for a restricted export, not adding a
`WHERE` clause to an existing warehouse-scoped query. That is the exact
inventory-valuation/data-model decision §10 and §13 of this PR's brief
forbid making unilaterally, and the brief's own §3 names this precise
scenario as the stop condition. **No warehouse-specific values were
manufactured to stand in as equivalent.**

### Effective scope contract — not applicable to the tenant-global fields

No `ReportWarehouseScope`/`ReportBranchScope` intersection was added:
there is no `warehouse_id`/`branch_id` request parameter to intersect
against, and forcing one onto a query with no warehouse dimension would
either (a) be a no-op decoration, or (b) require the same forbidden
per-warehouse redesign above. Catalog identity's existing `BranchScope`
protection (validated via `SetBranch`) is unchanged and was not touched.

### Scope confirmation — unchanged

`Product.quantity_on_hand` semantics: **unchanged.** `Product.avg_cost`
semantics: **unchanged.** Valuation/COGS: **unchanged.** Stock movements:
**unchanged.** Ledger: **unchanged.** `InventoryBalanceFilters`,
`InventoryBalanceExportService`, `InventoryController::export()`: **no
lines edited.** No migration. No API contract change. No UI change.

### Tests

No new tests — no production code changed. Existing
`tests/Feature/InventoryBalanceExportTest.php` (20 tests, 107 assertions)
re-run unmodified and still pass, including its own pre-existing tenant-
isolation proof (`it never leaks another tenants balances`) — confirming
the baseline this inspection characterized is accurate and unregressed.

### Recommendation for the blocked decision

A future `PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE` (or a combined pass with
`view=value`) needs a **product decision** first, not more inspection:
should a warehouse-restricted user's export show (a) the product excluded
entirely when it has zero stock in their allowed warehouses, (b) a
recomputed quantity/cost derived only from `product_warehouse_stock` rows
in their allowed warehouses (a materially different number than the
tenant's actual moving average — cost accounting implications), or (c) the
tenant-global figures they see today, treated as an accepted, documented
exception because `quantity_on_hand`/`avg_cost` are catalog-level
management figures, not per-location secrets? This decision affects
`view=value` identically and should be made once, for both surfaces
together, not endpoint-by-endpoint.

## 37. Cross-reference — Inventory Valuation Semantics Inspection (2026-09-09)

The §36 blocked decision (whether/how Warehouse Scope should affect
`/api/inventory/export` and `view=value`'s `quantity`/`avg_cost`) is now
**answered by a dedicated inspection**, not resolved here — see
[`docs/plans/products-inventory/AWJ_INVENTORY_VALUATION_SEMANTICS.md`](../products-inventory/AWJ_INVENTORY_VALUATION_SEMANTICS.md).

Summary of that document's finding: AWJ's inventory valuation is **Model
A (tenant-wide moving average)** for regular products — code-verified
across every writer (Purchases, Sales/POS, Returns, Stock Permits/
Transfers, Stocktake, Opening) — with Fuel carrying a genuine, bounded,
warehouse-specific cost-basis exception (Model B, `FuelCostBasisService`)
that neither export nor report surface currently reads. `avg_cost` cannot
be validly recomputed per warehouse (no warehouse-specific cost data
exists in `product_warehouse_stock`), but `quantity` can be validly
warehouse-scoped (it is real, per-warehouse data). The document
recommends: scope displayed `quantity`/`stock_value` to the actor's
Effective Warehouse Scope while leaving the authoritative tenant-wide
`avg_cost` untouched — closing the disclosure concern without inventing
per-warehouse costing. That recommendation is not yet implemented; it
requires explicit approval before `PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE`
can proceed.

## 38. PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE — Implemented (2026-09-09)

**The §36 P2 blocker is now closed.** The recommendation from §37's
inspection was implemented as approved, unchanged: catalog identity
preserved, `avg_cost` left tenant-wide and untouched, only `quantity`/
`stock_value` scoped to the actor's Effective Warehouse Scope.

**Both required surfaces**, kept semantically identical:

- `GET /api/inventory/export` — `InventoryController::export()` now
  resolves `$warehouseIds = ReportWarehouseScope::resolve($filters)` and
  passes it into `InventoryBalanceExportService::download()`. Per streamed
  chunk (`rows()`), a restricted actor's quantity is recomputed as
  `SUM(product_warehouse_stock.quantity)` for that batch's products,
  intersected with `$warehouseIds` — one small grouped query per 500-row
  chunk, preserving the existing streaming/memory-bounded design (no
  whole-catalog map built upfront). An unrestricted actor (`$warehouseIds
  === null`) is completely unaffected: `$product->quantity_on_hand` is
  read exactly as before.
- `InventoryReportService::trackedProducts()`/`inventoryValue()`
  (`view=value`) — identical contract. `trackedProducts()` no longer
  applies `hide_zero` at the SQL level (moved to a post-computation filter
  on the *scoped* quantity, matching what the export does per-chunk) so a
  restricted actor's zero/nonzero determination is never based on the
  tenant-wide column.

**`avg_cost` is untouched in both** — same field, same value, same
`Money::toRiyal()` formatting, same `products.view_cost`/
`SensitiveCostPolicy` redaction gate. `stock_value` is always `(the
quantity now shown) × (that unchanged avg_cost)` — so it is scoped
exactly when quantity is, and stays tenant-wide exactly when quantity does.

**Explicit filter rule:** `/api/inventory/export` has no `warehouse_id`
request parameter (confirmed unchanged, per §36's exhaustive inspection),
so there was nothing to intersect against an explicit filter — calling
`ReportWarehouseScope::resolve()` with no `warehouse_id` key present
already yields exactly "the actor's full allowed set" for a restricted
actor and `null` for an unrestricted one, which is the correct behavior
with zero new request fields. `view=value` already accepted (but
previously ignored) `warehouse_id`/`branch_id` in `InventoryReportRequest`;
it now honors `warehouse_id` through the same `ReportWarehouseScope`
call — a forbidden explicit warehouse falls back to the actor's own
allowed set, identically to every other report family fixed in
PR-ACL-REPORT-SCOPE (§33), not a new convention.

**Legacy/pre-warehouse compatibility — proven, not assumed:** an
unrestricted actor's quantity is never recomputed from
`product_warehouse_stock`, so quantity that predates warehouses (a
movement with no `warehouse_id`, present only in `quantity_on_hand`) is
never dropped for them — proven by
`ReportEffectiveScopeTest::export_unrestricted_user_keeps_legacy_null_warehouse_quantity`.
A *restricted* actor correctly does not see that unlocated quantity
(it cannot be attributed to any warehouse they're provably allowed to
access) — this is the intended security boundary, not a semantics change.

**Fuel boundary — unchanged, confirmed safe:** neither surface was ever
warehouse-aware for cost, and remains so — Fuel-linked products (which
can appear here since `trackedProducts()`/`InventoryBalanceFilters::query()`
filter only on `track_inventory=true`) still show the same blended
tenant-wide `Product.avg_cost` they always did. This PR does not read,
write, or reference `FuelCostBasisService`/`FuelInventoryCostState` at
all — it only optionally narrows the generic `quantity` field, which
carries no valuation claim in either direction.

**Cost permission — independent of warehouse scope, proven together:**
`export_without_cost_permission_redacts_cost_but_still_scopes_quantity`
proves a `staff`-role actor (has `products.view`, lacks
`products.view_cost`) sees the correctly warehouse-scoped `quantity`
while `avg_cost`/`stock_value` stay redacted — the two controls compose
without interference.

**Tests:** `tests/Feature/ReportEffectiveScopeTest.php` — 11 new tests
(unrestricted/one-warehouse/multi-warehouse quantity, cost-permission
independence, `include_zero` true/false against the scoped quantity,
legacy null-warehouse preservation, cross-tenant isolation of the new SUM
query, and the `view=value` mirror of the same cases) — 33/33 pass
(462 assertions). Existing suites re-run unmodified: `InventoryBalanceExportTest`
(19/19), `InventoryReportTest` (5/5), `SensitiveCostAuthorizationTest`
(30/30), `InventoryTest` including PR #742's
`moving_average_and_cogs_are_tenant_wide_across_warehouses` characterization
(11/11, unchanged) — zero regression, zero accounting/COGS impact. Full
suite: 3174 passed (up from 3127 in PR #739 as `main` advanced), same
13 pre-existing untracked/unrelated failures as every prior PR in this
series (§33, §35, §36's own CI note) — none new.

**Scope confirmed unchanged:** `Product.quantity_on_hand` semantics,
`Product.avg_cost` semantics, valuation/COGS formulas, stock movements,
warehouse transfers, ledger/GL, `FuelCostBasisService`, migrations, RBAC
architecture. `GET /api/inventory` (the non-export list endpoint,
`InventoryController::index()`) was found to share the identical
tenant-wide-scalar exposure pattern but is **not** one of the two
surfaces this task named in scope — left untouched, flagged as a
candidate for a future, separately-scoped pass.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.

## 39. PR-ACL-ROLE-UI-1 — Role Administration Functional Hardening — Implemented (2026-09-09)

**Frontend-only correctness fix, not the Roles/Permissions visual
redesign.** `web/src/components/hr/role-dialog.tsx` is the sole screen
that renders `App\Support\Rbac::PERMISSIONS` (122 canonical entries) for
assignment to a custom role, and it mishandled any permission with more
than two dot-separated segments.

**Previous defect:** the component derived module/action via
`const [mod, action] = perm.split('.')` (array destructuring silently
drops everything past the second element) and later **reconstructed** the
submitted value as `` `${mod}.${action}` ``. AWJ's real catalogue is 56
two-segment keys (`products.view`) and **66 three-/four-segment keys**
(`pos.audit.export`, `pos.session.handover.confirm`,
`fuel.sale.price.manage`, `documents.center.build_draft`, …) — every one
of those 66 was silently truncated (e.g. `pos.audit.export` →
reconstructed as `pos.audit`), and permissions sharing a two-segment
prefix collided onto the same reconstructed string (`pos.audit.view` /
`pos.audit.review` / `pos.audit.export` all became `pos.audit`). The same
component also assumed only `view`/`manage` actions exist and labelled
every non-`manage` action "View" — wrong for the catalogue's 32 distinct
terminal actions (`approve`, `export`, `confirm`, `review`, `recalculate`,
`ingest`, `retry`, `transition`, `inspect`, `verify`, `build_draft`,
`audit_export`, …).

**Fix — canonical permission key is opaque authorization data:** the
component never reconstructs a permission string. It stores and
transacts on the **exact original string from `catalog`** at every step
— grouping (`modules` groups the full string by its first segment, not
by an action fragment), `selected` (a `Set<string>` of exact catalogue
values), `toggle`, the seeding `useEffect` (editing a role seeds
`selected` from `role.permissions` verbatim), the submitted body
(`permissions: [...selected]`), and the React `key` on each button (the
permission string itself — never an index or a reconstructed value).
Display is a strictly separate, pure derivation:
- `permAction(perm)` — the **last** dot-separated segment, correct
  regardless of segment count (2, 3, or 4).
- `permModule(perm)` — the first segment, unchanged grouping key.
- `permMiddleSegments(perm)` — segments between module and action, used
  only to disambiguate the display label when two permissions in the same
  module share a terminal action (`pos.audit.export` renders "Audit —
  Export", distinct from a hypothetical `pos.override.export` rendering
  "Override — Export" — the *canonical values* were already
  distinguishable; this only makes the *label* distinguishable too).
- `permLabel(perm)` — the only function that reads `t.raw('perm_actions')`
  (new i18n key, both `en.json`/`ar.json`, 36 real actions from the
  catalogue) with a **safe fallback** for an unmapped/future action
  (`humanizeSegment`: snake_case → Title Case, e.g. an unmapped `retry` →
  "Retry"), never "View". `permLabel()`'s return value is consumed only
  by JSX text content — never fed back into `selected`, `toggle`, or the
  submitted body.

**Regression tests** — `web/src/components/hr/role-dialog.test.tsx`
(8 tests, all using real `Rbac::PERMISSIONS` values, none invented):
standard two-segment permission (`products.view`) unchanged through
selection/submission; a multi-segment permission
(`documents.center.build_draft`) retained character-for-character;
collision protection — `pos.audit.view` / `pos.audit.review` /
`pos.audit.export` render as three distinct buttons, toggling two of them
never touches the third, and the submitted array never contains the old
truncated `pos.audit`; an `export`-action permission never labelled
"View"; an `approve`-action permission (`pos.variance.approve`) gets its
own label; an unmapped/future action (`future.module.frobnicate` — not a
real permission, used only to exercise the presentation fallback) gets a
safe humanized label and its canonical value survives submission
unchanged; editing an existing role (`permissions: ['products.view',
'pos.audit.export']`) shows the correct pre-selected state including the
multi-segment key; submitting a change (toggle one on, one off) sends
exactly the intended final set, nothing reconstructed or dropped. 8/8
pass. Full relevant frontend suite (`src/components/hr`, `src/app`, 42
files) — 252/252 pass, zero regressions. `npm run build` (includes
TypeScript type-checking, matches Web CI's actual pipeline) — succeeds.
`npm run lint` was not run: this repository has no committed ESLint
config (`next lint` prompts interactively to create one), and Web CI
(`web-ci.yml`) itself only runs `npm run test` and `npm run build` — a
pre-existing repository/environment characteristic, not introduced or
altered by this PR.

**Backward compatibility — unchanged, confirmed:**
- Legacy two-segment permissions (`partners.view`, `products.manage`,
  `invoices.view`, …) behave identically to before — `permAction()` on a
  two-segment key returns the same second segment `permAction()`'s
  predecessor logic did.
- `*` wildcard and system-role (`owner`/`admin`/`accountant`/`staff`/
  `self_service`) behavior is untouched: `hasWildcard` detection, the
  "select all catalogue entries" seeding, and submission logic are
  unmodified. No backend file was touched — `Rbac::resolve()`,
  `Rbac::MATRIX`, `Rbac::PERMISSIONS`, and `Rbac::allows()` are byte-
  identical to before this PR. The backend catalogue and validation
  remain the sole authority; the frontend cannot create new authorization
  keys — it can only submit a subset of the `catalog` prop it was given.
- `web/src/components/users/user-dialog.tsx`,
  `user-scope-dialog.tsx`, and `access-scope-fields.tsx` were inspected
  (grep for `.split('.')`, permission-string handling) and confirmed
  unrelated: they handle role *assignment* (a single `role` slug from
  `GET /roles`) and branch/warehouse access scope, never parsing or
  reconstructing individual permission-key strings. No defect found, no
  change made — correctly out of this PR's bounded scope.

**Deferred to Design System V2 (intentionally not touched):** visual
redesign of `RoleDialog`, a deeper resource-path navigation hierarchy
beyond the existing flat module-row grouping, full `perm_modules`
translation coverage for modules currently falling back to their raw key
(`pos`, `fuel`, `documents`, `apps`, …— a pre-existing, separate i18n gap),
Users UI V2, Roles UI V2, Branch/Warehouse Scope UX redesign, role
cloning, role hierarchy, and any ERP-wide Permission-Aware UX (hiding
buttons/pages by permission) — this PR only fixes what a role
administrator sees and submits inside `RoleDialog` itself.

**Accounting/Tenant safety:** no journal, ledger, COGS, Inventory
valuation, `Product.avg_cost`/`quantity_on_hand`, Fuel costing, Treasury
ACL, report totals, or business transaction data touched — this PR
changes zero backend files and zero database schema. Tenant Isolation
architecture untouched — no backend authorization code was modified.

**Git:** branch `fix/access-control-role-dialog-permission-keys`, Draft
PR against `main`, base SHA `eea714d9971a3bffe5818a186878d0f7da7f897a`.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.

## 40. PR-ACL-POS-VARIANCE — POS Variance Treasury ACL — Implemented (2026-09-09)

**Closes the §18.2 policy ambiguity.** The product decision: `pos.variance.approve`
is the operational action permission (may this event happen at all), not a
treasury resource override. It never implicitly authorizes the accounting
effect on the session's specific Cash/Bank treasury — that follows the same
`CashBankAccountService::assertAllowed()` boundary every other money path
(§16, §35) already enforces. No override framework, no new scope type, no
change to `Rbac`, `CashBankAccount::allows()`, or `pos.variance.approve`'s
meaning.

**Traced workflow (current code, not the old report):**
```text
POST /api/pos-sessions/{id}/settle-variance   [middleware: perm(pos.variance.approve)]
  → PosSessionController::settleVariance()      — $request->user() passed as $actor (already correct)
    → PosSessionService::settleVariance($session, $actor)
        permission gate: $actor->hasPermission('pos.variance.approve')
        DB::transaction():
          lockForUpdate($session); status/acknowledgement/idempotency/self-approval guards
          $cashAccountId = sessionCashAccountId($session)   — session's frozen-at-open GL account
          $varianceAccountId = varianceAccountId()          — 5170, tenant chart
          NEW: resolveForPayment($cashAccountId,'cash') → assertAllowed(direction, $actor)
          build $lines (shortage: debit 5170/credit cash; overage: debit cash/credit 5170)
          LedgerService::post($lines, [...])
          $session->update(['variance_journal_entry_id' => $entry->id])
```
`CashBankAccountService` was already a constructor dependency of
`PosSessionService` (used by `resolveSessionCashAccountId()` at session-open
time) — no new dependency, no new class.

**Root cause (previous gap):** `sessionCashAccountId($session)` returned a
raw `Account` (GL) id — `$session->cash_account_id`, frozen at session-open
time via the same `resolveForPayment()` `PaymentService` uses (§16.1) — but
`settleVariance()` posted directly against that GL id without ever calling
`resolveForPayment()`/`assertAllowed()` again at settlement time. The GL
identity was already deterministically resolvable to exactly one
`CashBankAccount` (same "Target Contract classification: A — Already
resolvable" shape as §34's Direct Cash Sale gap); the settlement simply
never took that resolve-then-authorize step before posting.

**Implemented fix** (`PosSessionService::settleVariance()`, right after
`$isShortage` is computed, before `$lines` is built):
```php
$cashEntity = $this->cashBankAccounts->resolveForPayment($cashAccountId, 'cash');
$this->cashBankAccounts->assertAllowed($cashEntity, $isShortage ? 'withdraw' : 'deposit', $actor);
```

**Treasury resource resolution — tenant-safe, no new mapping model:**
`resolveForPayment($accountId, 'cash')` (unchanged, the same method
`PaymentService`/Direct Cash Sale already call) looks up
`CashBankAccount::where('account_id', $accountId)` — `CashBankAccount
extends BaseModel`, so `TenantScope` applies automatically; there is no
manual `tenant_id` filter to forget. `$cashAccountId` itself is never
attacker-influenced — it is the session's own `cash_account_id`, stamped
once at session-open time from the tenant's own payment-method resolution,
never accepted from the request. §41/Test 8 below proves a second tenant's
`CashBankAccount` on the same GL code (`1110`) cannot interfere in either
direction.

**Variance direction mapping — verified against the actual posting lines,
not guessed from names:**

| Variance | Journal effect on session cash account | Required ACL |
|---|---|---|
| Shortage (counted < expected, `$isShortage=true`) | **credited** (decreases) — debit 5170 / credit cash | `withdraw` |
| Overage (counted > expected, `$isShortage=false`) | **debited** (increases) — debit cash / credit 5170 | `deposit` |

This matches the conceptual rule (`cash increases → deposit`, `cash
decreases → withdraw`) exactly, confirmed by reading the existing `$lines`
ternary in `settleVariance()` itself (unchanged by this PR) rather than
assumed.

**Actor / branch context:** `PosSessionController::settleVariance()`
already passed `$request->user()` as `$actor` before this PR (no actor
gap here, unlike §17's POS/Fuel `PaymentService::post()` omissions) — the
authenticated actor now simply reaches one more check.
`CashBankAccountService::assertAllowed()` reads `app(BranchContext::class)->id()`
internally exactly as every other money path does (§16, §35) — no new
branch plumbing, no POS-specific branch ACL semantics.

**Atomicity:** the entire guard chain, `assertAllowed()` included, runs
*inside* the same `DB::transaction()` that already wrapped the whole
method (row-locked on the session). `assertAllowed()` throws a
`RuntimeException` on denial, which `ApiController::domain()` turns into
HTTP 422 — and because it is thrown before `$lines` is built or
`LedgerService::post()` is called, Laravel's transaction rolls back
automatically: no journal entry, no `variance_journal_entry_id` write, no
`difference_status` change, no partial session state. Proven by Tests 2, 4,
5, 6 (deny case) below asserting an identical before/after snapshot
(`journal_entries` count and `variance_journal_entry_id` presence) across
the denied call.

**Tenant isolation:** proven, not just structurally assumed — Test 8 below
configures a *second* tenant's own main cash treasury (same GL code `1110`
as every tenant, since `bootstrapDefaults()` seeds it identically per
tenant) to deny literally everyone, then confirms the first tenant's
variance settlement still succeeds on its own independently-scoped
treasury, unaffected.

**Backward compatibility:** the two pre-existing accounting-semantics
tests (`settling_a_shortage_debits_the_variance_account_and_credits_cash_in_one_balanced_entry`,
`settling_an_overage_debits_cash_and_credits_the_variance_account`) run
unmodified and still pass — both use the bootstrap-default `deposit_scope=
'all'`/`withdraw_scope='all'` main treasury, so the new check is a no-op
for them, exactly as intended: authorized users retain existing behavior,
this PR only tightens the previously-open gap.

**Tests** (`tests/Feature/PosSessionTest.php`, 10 new, all using a custom
role granting exactly `pos.variance.approve` — none of the built-in
`accountant`/`staff` system roles carry it — plus the existing
`namedCashTreasury`/`pointCashMethodToTreasury` fixture helpers extended
with a new `scopedCashTreasury()` helper for explicit deposit/withdraw
scope+subject):

| Test | Proves |
|---|---|
| 1 — overage, deposit access granted | Succeeds; journal posted |
| 2 — overage, deposit access denied | 422; zero journal, no `variance_journal_entry_id`, `difference_status` unchanged |
| 3 — shortage, withdraw access granted | Succeeds; journal posted |
| 4 — shortage, withdraw access denied | 422; atomic, no partial effect |
| 5 — direction independence | Deposit-only access still denies a shortage; withdraw-only access still denies an overage |
| 6 — branch scope | Session's active branch (main, default) allowed; a different branch's subject denied |
| 7 — role scope | `deposit_scope='role'` with the custom role's slug (not a user id) succeeds — the mechanism distinct from Tests 1-5's `user` scope |
| 8 — tenant isolation | A second tenant's identically-coded (`1110`) treasury, configured to deny everyone, cannot affect the first tenant's independently-configured settlement |
| 9 — zero variance | Rejected with the pre-existing "no difference to settle" error (asserted by message content) even against a deny-all treasury — proves the treasury check is never reached, not merely that it wouldn't matter |
| 10 (accounting semantics) | Covered by the two pre-existing, unmodified shortage/overage journal-shape tests continuing to pass — this PR added authorization, no new formula |

**Test execution:**
```
php artisan test --filter=PosSessionTest                                   → 36 passed (483 assertions)  [SQLite]
php artisan test --filter="PosSessionTest|PosSessionCloseHandoverTest|
  CashBankAccountTest|CashBankTransferTest|ApiInvoiceTest|InvoiceTest|
  PosLossPreventionPhase4Test"                                             → 120 passed (1059 assertions) [SQLite]
php artisan test --env=pgsql --filter="<same filter>"                      → 120 passed (1059 assertions) [PostgreSQL]
```
Zero modified/weakened existing tests; zero new failures on either database.

**Accounting invariants — unchanged, confirmed:** variance amount formula
(`abs($difference)`), debit/credit direction per shortage/overage, GL
account selection (session's frozen `cash_account_id`, tenant's `5170`),
journal balancing, session totals, rounding, currency — none touched. The
only behavioral difference on an already-authorized actor: none at all
(same journal, same amounts, same accounts). On a previously-unauthorized
actor: the settlement now correctly denies with HTTP 422 instead of
silently posting against a treasury the actor has no configured access to.

**Scope confirmed unchanged:** no database migration; `Rbac`,
`CashBankAccount` scope types, `LedgerService`, `PosSettings`, Fuel
authorization, Inventory, report scope, Users/Roles UI, Design System V2 —
none touched. `assertVarianceSelfApprovalAllowed()` (SoD, §18.2's sibling
guard) is untouched and composes independently with the new treasury check
(both must pass; neither implies the other).

**Git:** branch `fix/access-control-pos-variance-treasury`, Draft PR
against `main`, base SHA `9f5b4727b982b258a8d46614f5d8ff6ab997d16f`.

**Access Control V2 status:** not yet complete. `ACL-CLOSURE-1` (final
targeted verification pass) is the next planned phase, not started by this
PR.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.

## 41. ACL-CLOSURE-1 — Access Control V2 Final Verification (2026-09-09)

**Verification-only phase. Zero production code changed.** Confirms that
every layer of the target authorization model (Tenant Isolation ∩ Feature
Entitlement ∩ Role/Action Permission ∩ Branch/Data Scope ∩ Resource Scope
∩ Workflow/Record State ∩ Accounting Invariants) composes correctly across
all completed Access Control V2 work (§16–§40), using **only tests already
tracked in this repository's git history** — no new test file was needed;
the existing suite already proves the matrix with real HTTP-request-level
composition evidence and meaningful deny-path coverage.

**Untracked leftovers — identified, excluded, not relied upon:**
`tests/Feature/AccessControlV2VerificationTest.php`,
`AccessControlV2ClosureVerificationTest.php`, and
`AccessControlV2ReportScopeVerificationTest.php` exist only in the local
assembled `nibras-app` working copy (`git ls-files` confirms zero of the
three are tracked in this repository). They are pre-fix characterization
files from the original 2026-09-08 research pass (§31) — several of their
tests assert the *old vulnerable behavior* by design (e.g.
`pos_variance_settlement_does_not_check_cashbank_acl`,
`direct_cash_sale_debits_cash_account_without_cashbank_acl`) and now fail
correctly because those exact gaps are closed (§35, §40). Their failures
are expected proof-of-fix, not regressions, and none of their content was
copied, committed, or cited as closure evidence below.

### Verification Matrix

| Layer / Invariant | Enforcement Point | Evidence (tracked tests) | Status |
|---|---|---|---|
| Tenant Isolation | `BaseModel`/`TenantScope` (global scope on every business model); explicit checks in resolution helpers | `ApiTenantIsolationTest` (5), `RoleTest::roles_are_isolated_per_tenant`, `CashBankAccountTest::cash_bank_entities_remain_tenant_isolated`, `InventoryBalanceExportTest::it_never_leaks_another_tenants_balances`, `ReportEffectiveScopeTest::cross_tenant_branch_id_never_returns_other_tenants_data` + `cross_tenant_warehouse_id_never_returns_other_tenants_inventory_data` + `export_scoped_sum_query_never_crosses_tenant_boundary`, `PosSessionTest::treasury_resolution_never_crosses_the_tenant_boundary` + `a_zero_variance_session_cannot_be_settled_and_settlement_respects_tenant_isolation`, `SupplierRefundTest::refunds_are_isolated_per_tenant` | VERIFIED |
| Role / Action Permission | `Rbac::PERMISSIONS` (canonical catalogue), `RoleController` validation, `Rbac::resolve()` (table-first, MATRIX-fallback), `RoleDialog` (frontend) | `RoleTest` (12, incl. `a_custom_role_rejects_wildcard_and_unknown_permissions`, `rbac_resolves_permissions_from_the_role_table`, `system_roles_carry_the_matrix_permissions_verbatim`), `ApiRbacTest` (4), `role-dialog.test.tsx` (8, canonical-key/multi-segment/collision) | VERIFIED |
| Branch Scope | `User::allowedBranchIds()` (null = unrestricted), `ApiController::scopeToActiveBranch()`/`whereBranchIn()` | `UserAccessScopeTest` (7, incl. `a_user_without_assignments_is_not_restricted` — legacy contract), `PosInvoiceBranchAccessTest`, `StocktakeStockPermitRecordAccessTest` (15), `DocumentBranchScopeTest`, `ReportEffectiveScopeTest` (Sales/Purchase/Customer/Classification branch rows+totals, forbidden-explicit-filter, unrestricted-legacy) | VERIFIED WITH DOCUMENTED LEGACY CONTRACT |
| Warehouse Scope | `User::allowedWarehouseIds()` (null = unrestricted), `ReportWarehouseScope` | `UserAccessScopeTest::a_warehouse_outside_the_scope_is_hidden_and_refused`, `StocktakeStockPermitRecordAccessTest` (transfer permit source/target warehouse checks), `ReportEffectiveScopeTest` (Inventory warehouse-balance rows+totals+movements, forbidden-explicit-warehouse, unrestricted-legacy) | VERIFIED WITH DOCUMENTED LEGACY CONTRACT |
| Treasury Resource ACL | `CashBankAccountService::assertAllowed()`/`resolveForPayment()`, `CashBankAccount::allows()` (`all`/`role`/`user`/`branch`) | Deposit: `ApiInvoiceTest` (direct-cash-sale + auto-settlement `deposit_scope=user` allow/deny), `PosCheckoutTest` (POS tender allow/deny), `PosSessionTest` (overage/deposit allow/deny, role-scope, branch-scope). Withdraw: `PurchasePaidOnPostTest` (auto-settlement `withdraw_scope=user` allow/deny), `PosSessionTest` (shortage/withdraw allow/deny), `SupplierRefundTest::a_refund_cannot_be_posted_when_deposit_is_not_allowed_for_the_actor`. Direction independence: `PosSessionTest::deposit_access_never_authorizes_a_shortage_and_withdraw_access_never_authorizes_an_overage`. Transfer (`CashBankTransferService`, two-sided check, §16.3): posting/balance proven by `CashBankAccountTest::transfer_posts_a_balanced_entry...`, but **no dedicated tracked test drives a restricted-scope denial through the transfer endpoint specifically** — see Known Non-Blocking Follow-ups | VERIFIED |
| Actor Propagation | `PaymentService::post($payment, ?User $actor)`, actor threaded from controller → service → post() | `PosCheckoutTest`, `FuelSaleServiceTest`, `ApiInvoiceTest` (auto-settlement), `PurchasePaidOnPostTest` (auto-settlement), `PosSessionTest` (variance) — each proves the *authenticated actor*, not a null/created_by substitute, reaches the ACL decision, with a matching allow and deny case | VERIFIED |
| Reports / Aggregates / Drilldowns / Exports | `ReportBranchScope`, `ReportWarehouseScope` (shared intersection helpers); each report service applies the same filter to rows, totals, and (via shared `report.data`/`report.totals` state, §33) client-side exports | `ReportEffectiveScopeTest` (33 tests: Sales/Purchase period+profit+payments/balances views, Customer sales/balances, Classification Analytics documents/payments/partners families, Inventory warehouse-balance rows+totals+movements+export+`view=value`) — rows and totals proven together in the same test for every family, closing the exact "rows filtered, totals not" composition leak class this phase exists to catch | VERIFIED |
| Inventory Hybrid Model C | `InventoryBalanceExportService`, `InventoryReportService::inventoryValue()` — scoped `quantity`/`stock_value`, tenant-wide `avg_cost` | `ReportEffectiveScopeTest` (`export_restricted_to_one_warehouse_sees_only_that_warehouses_quantity`, `export_restricted_to_multiple_warehouses_sums_only_allowed`, `export_without_cost_permission_redacts_cost_but_still_scopes_quantity`, `export_include_zero_*`, `export_unrestricted_user_keeps_legacy_null_warehouse_quantity`, `export_scoped_sum_query_never_crosses_tenant_boundary`, `inventory_value_view_*` — 3 tests mirroring the export cases for `view=value`); Fuel boundary not generalized: `InventoryReportTest::it_reports_current_inventory_value_and_warehouse_quantities_without_allocating_value_to_warehouses`, `FuelReconciliationTest::inventory_gain_from_zero_stock_requires_a_trusted_fuel_cost_basis` | VERIFIED |
| Workflow / Record State | Session/document state guards independent of permission (`status`, `difference_status`, `variance_journal_entry_id`, posted immutability) | `PosSessionTest` (`settlement_requires_a_prior_acknowledgement_and_the_approval_permission`, `variance_settlement_is_idempotent_...`, `zero_variance_is_rejected_before_any_treasury_authorization_check`), `PosSessionCloseHandoverTest::handover_requires_a_second_authorized_user_and_a_resolved_cash_variance`, `InvoiceTest` (`it_rejects_posting_an_already_posted_invoice`, `a_posted_invoice_cannot_be_edited`, `a_posted_invoice_cannot_be_deleted`) | VERIFIED |
| Accounting & Atomicity | `LedgerService::post()` (balance enforcement), `DB::transaction()` boundaries around every ACL check | `LedgerTest` (5: balanced-entry, unbalanced-rejected, group-account-rejected, reversal, tenant isolation); atomicity-on-denial proven by name across nearly every deny test above (the `..._with_no_partial_effect` / `..._leaves_no_partial_state` naming convention: zero journal, zero payment, unchanged status, on every one) | VERIFIED |

### Tenant Isolation

Verified as the outer mandatory boundary, representatively across every
domain the brief named: user/role administration (`RoleTest`), Treasury
resolution (`PosSessionTest::treasury_resolution_never_crosses_the_tenant_boundary`
— a second tenant's identically-GL-coded `1110` treasury, configured to
deny everyone, proven unable to affect the first tenant's independently
scoped settlement), report data (`ReportEffectiveScopeTest`, 3 dedicated
cross-tenant tests spanning branch/warehouse/export-SUM-query), POS
variance settlement, and inventory scoped export. No new test was added —
representative existing coverage was sufficient, per the brief's own
instruction not to duplicate the entire Tenant Isolation suite.

### Role / Action Permission

Backend remains the sole authority: `RoleTest::a_custom_role_rejects_wildcard_and_unknown_permissions`
proves a custom role cannot be created with `['*']` or an invented
permission key (`422`, validation error) — the frontend (`RoleDialog`,
§39) can only ever submit a subset of the `catalog` prop it receives from
the backend's own `Rbac::PERMISSIONS`. Owner/admin `['*']` wildcard and
legacy `MATRIX` fallback both remain intact and are exercised together:
`system_roles_carry_the_matrix_permissions_verbatim` proves the seeded
table rows equal `Rbac::MATRIX` verbatim, and `rbac_resolves_permissions_from_the_role_table`
proves `Rbac::resolve()` reads the table (not the constant) once a row
exists — composing to the documented "table if present, else MATRIX"
contract without a dedicated no-row test (every `registerTenant()` call
seeds all five rows at registration, so the fallback branch is a
migration-era safety net, not a reachable steady-state path — code-read
confirmed in `Rbac::resolve()`, unchanged by any PR in this series).
`role-dialog.test.tsx` (§39, PR #748, merged) independently proves the one
concrete real multi-segment example the brief asked for:
`pos.audit.{view,review,export}` never collapses and is submitted
character-for-character.

### Branch Scope

`User::allowedBranchIds()` (`app/Models/User.php:60-65`) returns `null`
when the user has zero branch assignments — code-read confirms the
documented legacy contract verbatim: `$ids === [] ? null : $ids`.
`UserAccessScopeTest::a_user_without_assignments_is_not_restricted` proves
this executes correctly. The `?branch=all` semantic — "all branches the
*user* owns, not all branches the *tenant* has" — is proven with genuinely
*restricted* (non-owner) actors, not just the unrestricted-owner case, in
three independent files: `PosInvoiceBranchAccessTest`,
`StocktakeStockPermitRecordAccessTest::branch_all_for_a_restricted_user_still_excludes_stocktakes_outside...`,
and `UserAccessScopeTest`'s own restricted-user `?branch=all` case
returning zero rows for a branch the user does not own. An explicit
unauthorized branch selection falls back to the actor's own allowed set
(`ReportEffectiveScopeTest::*_forbidden_explicit_branch_does_not_leak`,
`UserAccessScopeTest::requesting_a_branch_outside_the_scope_falls_back_to_an_owned_one`)
— the current, documented contract, unchanged by this phase.

### Warehouse Scope

Same shape as Branch Scope, verified independently:
`UserAccessScopeTest::a_warehouse_outside_the_scope_is_hidden_and_refused`
for the base contract; `ReportEffectiveScopeTest`'s Inventory-family tests
for rows+totals+movements+export scoping under
`ReportWarehouseScope`; `StocktakeStockPermitRecordAccessTest`'s transfer-permit
tests for a source/target warehouse boundary outside report contexts. No
second warehouse ACL exists or was created — one `allowedWarehouseIds()`
helper, reused everywhere.

### Treasury Resource ACL

Deposit and withdraw proven as genuinely independent authorities — not
just documented as such — by `PosSessionTest::deposit_access_never_authorizes_a_shortage_and_withdraw_access_never_authorizes_an_overage`,
which configures a treasury granting *only* deposit to an actor and proves
a shortage (which needs withdraw) is still denied, then the mirror case.
The same independence is implicit across every other flow's paired
allow/deny tests (deposit-direction tests never touch `withdraw_scope`,
and vice versa). Representative flows covering the full
`PaymentService`-backed / Direct-Cash-Sale / POS-variance triad the brief
asked for are all green on both databases. `CashBankTransferService`'s
two-sided check (§16.3, source withdraw ∩ destination deposit) is
code-verified unchanged but does not have a dedicated tracked test driving
an actual ACL *denial* through `/api/cash-bank-transfers` — recorded below
as a non-blocking follow-up, not a gap in the mechanism itself (it calls
the identical `assertAllowed()` proven to deny correctly in three other
consumers).

### Actor Propagation

All five previously-defective call sites (§17, §26: POS checkout, Fuel
collection, Invoice auto-settlement, Purchase auto-settlement — closed by
PR #731/#734 — and POS variance settlement — closed by PR #750, §40) now
have a passing **and** a denying tracked test proving the authenticated
actor, not `null` or `created_by`, reaches `CashBankAccountService::assertAllowed()`.
No regression found; no new propagation gap found.

### Reports / Aggregates / Drilldowns / Exports

The exact leak class this property exists to catch — "rows are filtered
by scope but totals/aggregates are not" — is closed and proven closed in
the same test for every hardened report family: `ReportEffectiveScopeTest`
asserts both the row set and the totals/aggregate figure in one test per
family (Sales period+profit+payments views, Purchase period+balances
views, Customer sales+balances views, Classification Analytics
documents/payments/partners families, Inventory warehouse-balances+movements+export+`view=value`).
Export was verified by construction, not by a separate export-specific
test suite: §33 confirmed by direct file inspection that all five report
React workspaces build CSV/PDF client-side from the identical
`report.data`/`report.totals` API response state — there is no parallel
export query to independently leak. `/api/inventory/export` (a genuinely
separate surface, §36) has its own dedicated export tests within
`ReportEffectiveScopeTest`. POS audit's drill-down access pattern (§13:
"scoped cart drill-down returning 404 outside scope") is pre-existing,
already-documented-good architecture from the original research pass, not
part of any PR closed in §32–§40 — not re-verified with a fresh test in
this closure pass, consistent with "verify only what is necessary," not a
blanket re-audit.

### Inventory Hybrid Model C

Verified intact, exactly as specified: restricted-warehouse `quantity` =
scoped `SUM(product_warehouse_stock.quantity)`
(`export_restricted_to_one_warehouse_sees_only_that_warehouses_quantity`,
`..._to_multiple_warehouses_sums_only_allowed`); `avg_cost` stays
tenant-wide and still gated by `products.view_cost`
(`export_without_cost_permission_redacts_cost_but_still_scopes_quantity` —
proves the two controls compose without interference); `stock_value` =
scoped quantity × tenant-wide `avg_cost` (same tests, `stock_value`
assertions). `include_zero`/hide-zero decisions occur against the scoped
quantity, not the tenant-wide column
(`export_include_zero_false_excludes_a_product_zero_in_scope_but_nonzero_tenant_wide`
proves the distinction concretely). Tenant isolation of the new SUM query
itself (not just the base product list) is proven by
`export_scoped_sum_query_never_crosses_tenant_boundary`. Fuel valuation
was not accidentally generalized:
`InventoryReportTest::it_reports_current_inventory_value_and_warehouse_quantities_without_allocating_value_to_warehouses`
proves ordinary products never get a fake per-warehouse average cost, and
`FuelReconciliationTest::inventory_gain_from_zero_stock_requires_a_trusted_fuel_cost_basis`
proves Fuel's bounded exception (`FuelCostBasisService`) stays gated. `GET
/api/inventory` (the non-export list endpoint) remains explicitly outside
the completed scoped-inventory work (§38's own documented exclusion,
reconfirmed here, not silently folded into "V2 complete") — recorded
below as a known non-blocking follow-up candidate, not a blocker (it
exposes the same tenant-wide scalars every unrestricted actor already
sees correctly; the gap is only for a *restricted* actor, same
classification as the pre-fix export gap was).

### Workflow / Record State

Permission never substitutes for record state: `PosSessionTest` proves
`pos.variance.approve` alone cannot settle a variance before manager
acknowledgement, cannot re-settle an already-settled session (idempotent,
exactly one journal entry), and — new in this phase's evidence review —
the zero-variance rejection fires *before* any Treasury check even runs
(`zero_variance_is_rejected_before_any_treasury_authorization_check`, §40
Test 9). `PosSessionCloseHandoverTest::handover_requires_a_second_authorized_user_and_a_resolved_cash_variance`
proves the same principle one workflow step up: sufficient permission does
not let an actor skip a required resolved-variance precondition.
`InvoiceTest`'s posted-immutability trio proves the same principle for
accounting documents generally.

### Accounting & Atomicity

`LedgerTest`'s five foundational tests (balanced-entry enforcement,
group-account rejection, reversal, tenant isolation) remain the bedrock
every higher-level ACL fix in this series relies on — none were modified
by any Access Control V2 PR. Atomicity on denial is proven, not assumed,
by name across the evidence table above: every deny-path test in this
matrix asserts zero journal entries, zero payments, and unchanged
document/session status after a `RuntimeException` → HTTP 422 denial —
the `DB::transaction()` boundary that every fix in this series (§35, §40)
was deliberately placed inside of, never after.

### Negative-Path Verification

All eight representative deny cases the brief named have concrete, tracked,
passing evidence: wrong tenant (`ApiTenantIsolationTest`, `RoleTest`,
`PosSessionTest`, `ReportEffectiveScopeTest`, `CashBankAccountTest`,
`InventoryBalanceExportTest`), unauthorized branch
(`ReportEffectiveScopeTest`, `UserAccessScopeTest`), unauthorized
warehouse (`UserAccessScopeTest`, `ReportEffectiveScopeTest`,
`StocktakeStockPermitRecordAccessTest`), missing action permission
(`RoleTest::role_management_requires_the_roles_permission`,
`ApiRbacTest::staff_can_view_but_cannot_manage_partners`,
`PosSessionTest::settlement_requires_a_prior_acknowledgement_and_the_approval_permission`),
Treasury deposit denial (`ApiInvoiceTest`, `PosCheckoutTest`,
`PosSessionTest`), Treasury withdraw denial (`PurchasePaidOnPostTest`,
`PosSessionTest`, `SupplierRefundTest`), and atomic no-partial-state on
every one of the above (proven inline in each test, not a separate check).

### Tracked Test Evidence

Every test cited above was confirmed via `git ls-files` to be tracked in
this repository before being used as evidence — the opposite check
(confirming the three `AccessControlV2*VerificationTest.php` files are
**not** tracked) is documented above. No untracked file's assertions,
pass or fail, were used as closure evidence anywhere in this section.

### Test Execution

```
php artisan test --filter="ApiTenantIsolationTest|RoleTest|ApiRbacTest|CashBankAccountTest|
  ApiInvoiceTest|InvoiceTest|PurchasePaidOnPostTest|PurchaseTest|FuelSaleServiceTest|
  FuelSaleApiTest|PosCheckoutTest|PosSessionTest|PosSessionCloseHandoverTest|SupplierRefundTest|
  ReportEffectiveScopeTest|InventoryBalanceExportTest|InventoryReportTest|LedgerTest|
  UserAccessScopeTest|PosInvoiceBranchAccessTest|StocktakeStockPermitRecordAccessTest|
  DocumentBranchScopeTest|FuelReconciliationTest"

  SQLite:     344 passed (2876 assertions), 46s
  PostgreSQL: 344 passed (2876 assertions), 200s — identical result, zero
              database-specific divergence in scoped-aggregate (SUM/GROUP BY)
              or tenant-isolation behavior
```
`web/src/components/hr/role-dialog.test.tsx` (frontend, §39): 8/8 passed,
re-confirmed green post-merge.

### Production Code Changes

**None.** This phase is verification, documentation, and git/PR mechanics
only — no `app/`, `routes/`, `database/`, or `web/src/` file was edited.

## Access Control V2 Final Status

### DONE

Tenant Isolation, Role/Action Permission (backend authority + canonical
key integrity), Branch Scope, Warehouse Scope, Treasury Resource ACL
(deposit/withdraw independence across the full PaymentService/Direct-Cash-Sale/POS-variance
triad), Actor Propagation (all five call sites), Report effective scope
(rows+totals+export composition, five families), Inventory Hybrid Model C,
Workflow/Record State gating independent of permission, and Accounting
atomicity on every denial path — all VERIFIED with concrete, tracked,
passing evidence on both SQLite and PostgreSQL. **No unresolved
security, accounting, or Tenant Isolation blocker was found.**

### Deferred to Design System V2

- Users UI V2, Roles & Permissions UI V2 (visual redesign; §39 was
  functional hardening only)
- Branch/Warehouse Scope UX (a dedicated scope-selection/management screen)
- Permission-aware frontend UX (hiding buttons/pages by permission
  throughout the ERP — §39's explicit boundary)
- Visual hierarchy/labels for the permission catalogue beyond §39's
  bounded action-label fix
- `products.sku` auto-numbering, numbering-settings UI (unrelated,
  pre-existing roadmap items, not Access Control)

### Future Enhancements

Only where current findings support them as real, not speculative:

- Role cloning (Daftra-parity UX gap, §5 — not a security requirement,
  no gap found without it)
- Role hierarchy / advanced SoD beyond the existing single optional
  `self_approval_blocked_for_variance` switch (§18.2's sibling guard) —
  no concrete need found, current mechanism is sufficient for every
  verified flow
- Richer permission metadata (risk labels, dependency graph) — §22's
  "sensitive candidates" list remains a naming convention, not a missing
  control; no bypass found from its absence
- Advanced Record Scope/ABAC (own/assigned invoice or partner scope, §10/§11)
  — a genuine product-decision gap (Daftra parity), not a security hole:
  every current record is still bounded by Tenant Isolation + Branch/Resource
  Scope even without an "assigned to me" predicate

### Known Legacy Contracts

- `User::allowedBranchIds()`/`allowedWarehouseIds()` return `null` (fully
  unrestricted) for a user with zero assignments — deliberate, unchanged,
  protects every pre-existing tenant's current admin/staff behavior
- `?branch=all` means "all branches *this user* owns," never "all branches
  the tenant has" — proven with restricted actors, not merely documented
- Owner/admin `['*']` wildcard and the `MATRIX`-fallback path for a tenant
  with no `roles` table rows remain supported exactly as before RBAC
  became table-driven
- `CashBankAccount::allows()`'s null-actor semantics (§16.1): `scope=all`/
  matching `scope=branch` can pass with a null actor; `scope=role`/`scope=user`
  cannot — a fail-closed availability quirk for system/null-actor callers,
  not a bypass, and no current caller relies on null-actor success for a
  restrictive scope (every user-initiated caller now propagates a real actor)

### Known Non-Blocking Follow-ups

1. **`CashBankTransferService` lacks a dedicated tracked test proving a
   restricted-scope *denial* through `/api/cash-bank-transfers`.** The
   underlying mechanism (`assertAllowed()` on both source and destination)
   is unchanged, shared with three other proven-denying consumers, and
   code-read confirmed correct (§16.3) — this is a coverage gap, not a
   known or suspected defect. A future small PR could add
   `deposit_scope=user`/`withdraw_scope=user` allow/deny pairs to
   `CashBankAccountTest.php` mirroring the pattern already used in
   `PurchasePaidOnPostTest`/`PosSessionTest`.
2. **`GET /api/inventory`** (the non-export catalog list endpoint) shares
   the pre-fix tenant-wide-scalar exposure pattern that `/api/inventory/export`
   and `view=value` had before §38, but was explicitly out of scope for
   that PR and remains so here (§38's own documented exclusion). Not a
   regression from this phase; a candidate for a future, separately-scoped
   pass if prioritized.
3. **POS audit drill-down/export scoping** (§13's "scoped cart drill-down
   returning 404 outside scope") is pre-existing documented-good
   architecture, not re-verified with a fresh executable test in this
   closure pass since it was never part of any PR closed in §32–§40.

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
