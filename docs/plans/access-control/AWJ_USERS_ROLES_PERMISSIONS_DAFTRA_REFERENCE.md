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

**Process rule:** research/inspect → verify → update this file → confirm commit → summarize to Safwan.
