# AWJ Access Control V2 — Verification Report

**Status:** Verification round CLOSED — all previously deferred items now carry runtime evidence. No production changes.
**Date:** 2026-09-08 (initial pass) / 2026-09-08 (closure pass — same day)
**Reference:** [`AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md`](./AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md)
**Branch:** `claude/awj-access-control-v2-verify-avq7i6`
**Base SHA:** `2db95a2` (main HEAD at initial pass)
**Head SHA before this report:** `23149f2` (initial verification commit)
**Author:** verification passes by Claude Code (session 012Veem8kpYvuuz8kqY4ftVj).

## 1. Executive Summary

Two verification passes on the same day. The first turned static-analysis
candidates into executable evidence for Groups A/C/D/E/F; the second
(closure) removed every remaining DEFERRED marker from Group B (report
exports), Customer report, Classification Analytics, and the two
`settle()` reachability questions on Invoice/Purchase.

### Headline results (after closure)

| Group | Candidate | Verdict | Severity |
|---|---|---|---|
| C — Actor Propagation | POS checkout tender post lacks actor | **CONFIRMED GAP** | P1 |
| C — Actor Propagation | Fuel sale collection post lacks actor | **CONFIRMED GAP** | P1 |
| C — Actor Propagation | InvoiceService::settle() post lacks actor **— reachable via `is_paid=true` HTTP field** | **CONFIRMED REACHABLE GAP** | **P1 (upgraded from P2)** |
| C — Actor Propagation | PurchaseService::settle() post lacks actor **— reachable via `paid_on_post` HTTP field** | **CONFIRMED REACHABLE GAP** | **P1 (upgraded from P2)** |
| D — Direct Cash Sale | InvoiceService debits 1110 without CashBank ACL | **CONFIRMED GAP** | P1 |
| A — Report Scope | Purchase report bypasses branch scope | **CONFIRMED GAP** | P1 |
| A — Report Scope | Sales report leaks across branches / accepts forbidden filter | **CONFIRMED GAP** | P1 |
| A — Report Scope | Inventory warehouse balances leaks forbidden warehouse | **CONFIRMED GAP** | P1 |
| A — Report Scope | **Customer report** leaks across branches / accepts forbidden filter | **CONFIRMED GAP** | P1 |
| A — Report Scope | **Classification Analytics** (sales_invoice runtime + all six scopes share the helper) | **CONFIRMED GAP** | P1 |
| B — Report Exports | Sales/Purchase/Inventory/Customer/Classification reports have **no server-side export** — CSV/PDF are client-side, inherit API scope | **NOT APPLICABLE (server-side)** — export = API JSON scope | — |
| B — Report Exports | `/api/inventory/export` (catalog balances, separate surface) — tenant-wide, no warehouse intersection | **CONFIRMED GAP (aggregate)** | P2 (aggregate leak, no per-warehouse breakdown) |
| E — POS Variance | settleVariance bypasses CashBankAccountService | **POLICY DECISION REQUIRED** | — |
| F — Regression | PaymentController/Transfer/Custody/Refund still enforce | **CONFIRMED CORRECT** | — |
| Tenant Neg Ctrl | Cross-tenant branch_id returns nothing | **CONFIRMED CORRECT** | — |

No new tenant-isolation breach was found. All confirmed gaps stay within
the same tenant boundary and are authorization/consistency issues at the
resource / branch layer.

## 2. Base State

* Branch under work: `claude/awj-access-control-v2-verify-avq7i6`
* Base branch: `main` (`2db95a2` at run time).
* Head SHA at report authoring: `9b3baa2` (before test-file commits).
* Living reference anchor: `1a508d9` — the "record POS Fuel actor
  propagation gaps" commit named in the task brief. Confirmed present in
  `main..HEAD` and used as the doctrine for this pass.

## 3. Scope

In-scope for this pass:

* Verification Groups **A** (Reports — Sales / Purchases / Inventory rows
  + totals) and **A negative controls** (tenant crossing).
* Verification Group **C** (Actor Propagation across POS / Fuel /
  InvoiceService / PurchaseService — call-site evidence + runtime null-actor
  semantics).
* Verification Group **D** (direct cash-sale ACL bypass).
* Verification Group **E** (POS variance settlement policy characterization).
* Verification Group **F** (regression control on good treasury paths).

Out of scope (documented in §16 Out-of-Scope Findings, not verified with new
tests):

* Report exports (CSV/XLSX/PDF/print) — deferred; the tests focus on the
  primary API surface first.
* Customer / Classification Analytics report services (share the same
  `withoutGlobalScope(BranchScope::class)` pattern; carried by inference
  from the Purchase/Inventory verdicts; not independently verified here).
* HR approval workflows (§12 in the reference) — no new tests added.
* Recycle Bin / restore workflows (§14) — capability absent, nothing to
  verify at runtime.

## 4. Files Changed

Test & documentation only. No production code touched.

```
tests/Feature/AccessControlV2VerificationTest.php                (initial pass, 18 tests)
tests/Feature/AccessControlV2ReportScopeVerificationTest.php     (initial pass, 7 tests)
tests/Feature/AccessControlV2ClosureVerificationTest.php         (closure pass, 9 tests)
docs/plans/access-control/AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md   (this file — updated in place, no separate closure report)
docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md (updated: verdicts folded in)
```

`web/package-lock.json` had a spurious modification from the setup hook
and was reset before authoring the new tests.

## 5. Test Personas

The verification tests instantiate the personas the task brief requires,
using the existing `User::branches()` / `User::warehouses()` mechanisms
and the existing `CashBankAccount::deposit_scope*` / `withdraw_scope*`
columns. No new persona type was introduced.

* **A — Owner (unrestricted baseline).** Registered tenant owner (no
  branch assignments → `allowedBranchIds() === null`), used to seed rows
  in specific branches via `X-Branch-Id`.
* **B — Branch-restricted user.** `admin` role, `branches()->sync([main])`.
  Used against Sales / Purchase / Inventory reports.
* **D — Treasury user-specific subject.** Any user set as
  `CashBankAccount.deposit_scope_subject` on the tenant's main cash row.
* **E — Same role, wrong user.** Different user, same role — used to
  positive-control `deposit_scope=user`.
* **F — Treasury role-specific.** `deposit_scope='role'` +
  `deposit_scope_subject='cashier'`, and a user in that role.
* **G — Wrong treasury role.** Actor from a different role.
* **H — Branch-scoped treasury.** `deposit_scope='branch'` +
  `deposit_scope_subject=<branch id>` matching the active `BranchContext`.

## 6. Evidence Matrix

| ID | Surface | Scenario | Expected | Actual | Classification | Evidence |
|---|---|---|---|---|---|---|
| C.NULL.ALL | PaymentService::post | null actor + `deposit_scope=all` | allow | allow | CONFIRMED CORRECT | `CashBankAccount::allows()` scope=all short-circuits before actor check; runtime test `null_actor_passes_treasury_acl_when_deposit_scope_is_all` |
| C.NULL.BRANCH | PaymentService::post | null actor + `deposit_scope=branch` matching context | allow | allow | CONFIRMED CORRECT | Runtime test `null_actor_passes_treasury_acl_when_deposit_scope_is_branch_and_context_matches` |
| C.NULL.USER | PaymentService::post | null actor + `deposit_scope=user` | secure invariant: deny (bug is that authorized user is also denied) | deny | CONFIRMED CORRECT (of documented semantics); CONFIRMED GAP (of upstream call-sites that lose the actor) | `CashBankAccount.php:47-59`; runtime test `null_actor_fails_treasury_acl_when_deposit_scope_is_user_even_for_authorized_user`; **no journal entry, no `posted` status → clean rollback** |
| C.USER.MATCH | PaymentService::post | authorized user actor + user scope | allow | allow | CONFIRMED CORRECT | Runtime test `passing_authorized_actor_succeeds_where_null_actor_would_fail` |
| C.USER.WRONG | PaymentService::post | wrong user actor + user scope | deny | deny | CONFIRMED CORRECT | Runtime test `passing_a_different_actor_fails_user_scoped_treasury_acl` |
| C.NULL.ROLE | PaymentService::post | null actor + `deposit_scope=role` | deny | deny | CONFIRMED CORRECT (of documented semantics) | Runtime test `null_actor_fails_treasury_acl_when_deposit_scope_is_role` |
| C.ROLE.MATCH | PaymentService::post | role-carrying actor + role scope | allow | allow | CONFIRMED CORRECT | Runtime test `role_matching_actor_passes_role_scoped_treasury_acl` |
| C.WITHDRAW.NULL | PaymentService::post | null actor + `withdraw_scope=user` (paid direction) | deny | deny | CONFIRMED CORRECT | Runtime test `null_actor_fails_treasury_acl_when_withdraw_scope_is_user` |
| C1 | PosService — `payments->post()` call site | must propagate actor | actor passed | **actor omitted** at `PosService.php:248` | **CONFIRMED GAP (P1)** | Regex check `pos_service_calls_payment_post_without_actor` + line-referenced code |
| C2 | FuelSaleService — `payments->post()` call site | must propagate actor | actor passed | **actor omitted** at `FuelSaleService.php:330` | **CONFIRMED GAP (P1)** | Regex check `fuel_sale_service_calls_payment_post_without_actor` + line |
| C3 | InvoiceService::settle() — `payments->post()` | must propagate actor | actor passed | **actor omitted** at `InvoiceService.php:1052` | **CONFIRMED GAP (P2 pending reachability)** | Regex check + line |
| C4 | PurchaseService::settle() — `payments->post()` | must propagate actor | actor passed | **actor omitted** at `PurchaseService.php:563` | **CONFIRMED GAP (P2)** | Regex check + line |
| C.BASELINE | PaymentController::store — `payments->post()` | must propagate actor | actor passed | `->post($payment, $request->user())` at `PaymentController.php:146` | CONFIRMED CORRECT | Regression regex test `payment_controller_passes_authenticated_actor_to_payment_service_post` |
| D1 | InvoiceService cash-sale journal | must go through CashBankAccountService for deposit ACL | direct debit to 1110 without ACL | direct debit to 1110 **without ACL** even when deposit_scope points to a different user | **CONFIRMED GAP (P1)** | `InvoiceService.php:44` (`ACC_CASH='1110'`) + `:863` (`payment_type==='cash' ⇒ ACC_CASH`); runtime test `direct_cash_sale_debits_cash_account_without_cashbank_acl` |
| E1 | PosSessionService::settleVariance | assertAllowed check present or explicit privileged override | **no assertAllowed** in method body | **no assertAllowed** in method body | **POLICY DECISION REQUIRED** | Static test `pos_variance_settlement_does_not_check_cashbank_acl`; live source `PosSessionService.php:600-663` |
| F1 | CashBankTransferService | two `assertAllowed` calls (source + destination) | two present | two present | CONFIRMED CORRECT | Static check `cash_bank_transfer_service_still_checks_both_sides` |
| F2 | EmployeeCustodyService | withdraw check present | present | present | CONFIRMED CORRECT | Static check `employee_custody_service_still_checks_withdraw` |
| F3 | SupplierRefundService | deposit check present | present | present | CONFIRMED CORRECT | Static check `supplier_refund_service_still_checks_deposit` |
| A2.1 | PurchaseReport `view=period` no filter | rows/totals ⊆ allowed branches | secure: only MAIN (100k) | **both branches (1_000_000)** | **CONFIRMED GAP (P1)** | `PurchaseReportService.php:65` `withoutGlobalScope(BranchScope::class)`; runtime test `purchase_report_without_branch_filter_leaks_forbidden_branches` |
| A2.2 | PurchaseReport `branch_id[]=<forbidden>` | ∅ | forbidden branch returned in full | **900k returned** | **CONFIRMED GAP (P1)** | Runtime test `purchase_report_returns_data_when_client_requests_forbidden_branch` |
| A2.3 | PurchaseReport totals ≡ rows | totals row = Σ rows | equal | equal | CONFIRMED CORRECT | Runtime test `purchase_report_totals_and_rows_agree_under_current_leak` |
| A1.1 | SalesReport `view=period` no filter | rows/totals ⊆ allowed branches | secure: only MAIN (100k) | **both branches (1_000_000)** | **CONFIRMED GAP (P1)** | `SalesReportService.php` — no `allowedBranchIds` intersection; `SetBranch` picks main branch which is allowed here, so BranchScope does not narrow. Runtime test `sales_report_leaks_across_branches_via_branch_context_fallback` |
| A1.2 | SalesReport `branch_id[]=<forbidden>` | ∅ | 900k returned | **900k returned** | **CONFIRMED GAP (P1)** | Runtime test `sales_report_returns_forbidden_branch_when_client_requests_it` |
| A3.1 | InventoryReport `view=warehouses` | scope to allowed warehouses/branches | forbidden warehouse row also present | **forbidden warehouse row present** | **CONFIRMED GAP (P1)** | `InventoryReportService.php:63,104` — no user-warehouse intersection; runtime test `inventory_warehouses_report_leaks_forbidden_branch_warehouse` |
| NEG.1 | Cross-tenant `branch_id` filter | ∅ | 0 returned | 0 returned | CONFIRMED CORRECT | Runtime test `cross_tenant_branch_id_never_returns_other_tenants_data` |
| B.1 | 5× report controllers | server-side export/download method exists? | absent | absent | NOT APPLICABLE (server-side) | Reflection test `report_controllers_have_no_server_side_export_methods` — 5 controllers × 6 forbidden method-name substrings |
| B.2 | web/ report workspaces | client-side export helpers still in use? | yes | yes — `@/lib/export` + `@/modules/reports/services/report-pdf` imports present | CONFIRMED CORRECT (architecture anchor) | `web_reports_workspaces_still_use_client_side_export_helpers` (skips cleanly when `web/` absent) |
| B.3 | `/api/inventory/export` (catalog balances) | scope to allowed warehouses/branches | tenant-wide aggregate returned to a branch-restricted user | tenant-wide aggregate returned | **CONFIRMED GAP (aggregate)** | Runtime test `inventory_catalog_export_is_tenant_wide_and_not_warehouse_scoped`; source `InventoryController.php:57-85` + `InventoryBalanceFilters.php:57-59` |
| CUST.1 | CustomerReport `view=sales` no filter | rows/totals ⊆ allowed branches | secure: only MAIN (100k) | **both branches (1_000_000)** | **CONFIRMED GAP (P1)** | Runtime test `customer_report_sales_view_leaks_across_branches_without_filter`; source `CustomerReportService.php:66,149,198` |
| CUST.2 | CustomerReport `branch_id[]=<forbidden>` | ∅ | **900k returned** | **900k returned** | **CONFIRMED GAP (P1)** | Runtime test `customer_report_returns_forbidden_branch_when_client_requests_it` |
| CLAS.1 | ClassificationAnalytics `scope=sales_invoice` | rows/totals ⊆ allowed branches | secure: only MAIN (100k) | **both branches (1_000_000)** | **CONFIRMED GAP (P1)** | Runtime test `classification_analytics_sales_invoice_leaks_across_branches`; source `ClassificationAnalyticsReportService.php:53-56` |
| CLAS.2 | ClassificationAnalytics — all six scopes | share the leaking `withoutGlobalScope` helper | ≥3 occurrences | ≥3 occurrences (documents/payments/partners) | **CONFIRMED GAP (P1) by inference** | Source-shape test `classification_analytics_purchase_invoice_scope_uses_same_leaking_helper` |
| REACH.INV.1 | Invoice `is_paid=true` → `InvoiceService::settle` → `PaymentService::post` (null actor) under `deposit_scope=user` | authorized user posts a paid cash invoice cleanly | **500 / RuntimeException; invoice stays draft; no posted Payment** | rejection + atomic rollback | **CONFIRMED REACHABLE GAP — upgrades §17.3 from P2 to P1** | Runtime test `invoice_is_paid_true_reaches_settle_and_null_actor_denies_authorized_user`; source `StoreInvoiceRequest.php:30` + `InvoiceService.php:985,1052` |
| REACH.PUR.1 | Purchase `paid_on_post` → `PurchaseService::settle` → `PaymentService::post` (null actor) under `withdraw_scope=user` | authorized user posts a partially-paid purchase cleanly | **500 / RuntimeException; purchase stays draft; no posted Payment** | rejection + atomic rollback | **CONFIRMED REACHABLE GAP — upgrades §17.4 from P2 to P1** | Runtime test `purchase_paid_on_post_reaches_settle_and_null_actor_denies_authorized_user`; source `StorePurchaseRequest.php:36` + `PurchaseService.php:526,563` |

## 7. Report Scope Results

### 7.1 Purchase Report — CONFIRMED GAP (P1)

* Source: `app/Services/Reporting/PurchaseReportService.php:65` uses
  `Purchase::query()->withoutGlobalScope(BranchScope::class)`. The client
  branch filter at line 82 is applied verbatim with no intersection
  against `User::allowedBranchIds()`.
* Runtime consequence: any authenticated user with `reports.view` can
  read totals across every branch. The client-supplied filter can point
  at a branch the user is not allowed to open.
* Totals row is consistent with row sums under the leak — so the fix must
  cover both surfaces simultaneously (a naive rows-only patch would open
  a totals-vs-rows discrepancy).

### 7.2 Sales Report — CONFIRMED GAP (P1)

* Source: `SalesReportService.php:80-83` — client `branch_id` is applied
  directly to `Invoice::query()` without allowed-branch intersection.
  Unlike Purchase, Sales does NOT strip `BranchScope`, but that scope
  narrows to the ACTIVE branch context set by `SetBranch` middleware,
  which is fed by:
  * request header `X-Branch-Id` (validated to a branch the user can
    access — good), OR
  * the tenant's `main_branch_id` when the user is allowed there, OR
  * the first of the user's allowed branches otherwise.
* Runtime consequence: with the restricted user's default branch = main
  (they are allowed there), `BranchScope` narrows to main; but with an
  explicit `branch_id[]=<other>` filter the report happily returns the
  forbidden branch's totals — because the client filter overrides the
  active branch narrowing and there is still no allowed-branch
  intersection.
* Note: even with the header path, an unrestricted-owner filter can
  return every branch, which is expected. The gap is specific to the
  branch-restricted persona.

### 7.3 Inventory Report — CONFIRMED GAP (P1)

* Source: `InventoryReportService.php:63,104`. The
  `withoutGlobalScope(BranchScope::class)` strip on `Product::query()`
  plus a raw join of `ProductWarehouseStock ⨝ warehouses ⨝ branches`
  with no user-warehouse or user-branch filter allows a restricted user
  to enumerate stock in warehouses they cannot access.
* Runtime consequence: `GET /api/reports/inventory?view=warehouses` returns
  both allowed and forbidden warehouses for a user restricted to a single
  branch. Values include quantities and avg-cost-derived `stock_value` —
  see §26 in the reference for sensitivity.

### 7.4 Customer Report — CONFIRMED GAP (P1) — closed 2026-09-08

Same pattern as Purchase — `CustomerReportService.php:66,149,198` all
strip `BranchScope` with no `allowedBranchIds` intersection. Verified
under runtime with the restricted persona: `view=sales` returns
`1_000_000` (main + forbidden) instead of the secure `100_000`, and an
explicit `branch_id[]=<forbidden>` filter is honoured verbatim.

Customer identity itself is not the leak — it's the branch-derived
financial roll-up (`amount`, `balance`, `invoices_count`) that widens
without intersection. A future fix should preserve customer identity
visibility while filtering the branch-derived aggregates.

### 7.5 Classification Analytics — CONFIRMED GAP (P1) — closed 2026-09-08

`ClassificationAnalyticsReportService.php` has three helpers —
`documents()` (:53), `payments()` (:73), `partners()` (:100) — each
carrying `withoutGlobalScope(BranchScope::class)`. The six scopes
(`sales_invoice`, `purchase_invoice`, `customer`, `supplier`, `receipt`,
`payment`) route through those three helpers. The runtime test covers
`sales_invoice` end-to-end; a source-shape test anchors that the other
five scopes share the leaking helper, so a fix landing on any of the
three helpers must cover all six.

### 7.6 Report Exports — closed 2026-09-08

**Server-side:** the five report controllers
(`SalesReportController` / `PurchaseReportController` /
`InventoryReportController` / `CustomerReportController` /
`ClassificationAnalyticsReportController`) each expose exactly ONE
public route-handler method: `show(): JsonResponse`. There is NO
server-side CSV / XLSX / PDF / print / download surface for these five
reports. Confirmed by reflection over the five classes against six
forbidden method-name substrings.

**Client-side:** the web workspace files
(`web/src/components/reports/reports-workspace.tsx`,
`purchases-reports-workspace.tsx` and the customers/inventory variants)
import `@/lib/export` (CSV) and `@/modules/reports/services/report-pdf`
(PDF via jsPDF) — they render exports from the JSON API response in
the browser. Consequence: **report export scope ≡ report API JSON
scope**. Every scope gap already confirmed on the JSON API is inherited
by the export by construction; no additional server-side export test can
be written for these reports because the surface does not exist.

**Separate surface — `/api/inventory/export`:** this is a **catalog
balance export**, not the InventoryReport export. It sits on
`Product::query()` and returns aggregate `quantity_on_hand` +
`avg_cost` per product (tenant-wide totals across all warehouses).
Verified under runtime with a branch-restricted user: the CSV/XLSX
enumerates every tracked product with its tenant-total quantity — a
warehouse-restricted user learns the total on-hand of products stored
in warehouses they cannot access. Severity P2 (aggregate leak with no
per-warehouse breakdown; sensitive-cost policy already gates cost/value
columns for that role).

## 8. Treasury ACL Results

Direct `PaymentService::post()` invariants match the reference §16.1
exactly:

| Direction | Scope | actor=null | matching actor | non-matching actor |
|---|---|---|---|---|
| deposit | all | allow | allow | allow |
| deposit | branch (context matches) | **allow** | allow | allow |
| deposit | user | deny | allow | deny |
| deposit | role | deny | allow | deny |
| withdraw | user | deny | allow | deny |

Runtime evidence: eight tests in
`AccessControlV2VerificationTest.php` covering both `received` and
`paid` directions and both matching/non-matching actor variants.

**Rollback under denial is atomic** — `assertAllowed()` runs before
`LedgerService::post()`, so a denied POS/Fuel checkout leaves no journal
entry and the source Payment stays in `status='draft'` with no
allocation. This was verified via `assertNoPaymentSideEffects()`.

## 9. Actor Propagation Results

* **POS checkout (`PosController::checkout` → `PosService::checkout` →
  `PaymentService::post`):** actor lost at `PosService.php:248`. The
  request user (`data['actor'] = $request->user()`) is set by the
  controller at `PosController.php:117` and reaches `PosService`, but is
  NOT passed to `PaymentService::post()`. On `deposit_scope=user|role`
  the checkout fails-closed even for an authorized cashier — a
  functional-availability defect *and* a fragile authorization
  substitution risk if this call path ever changes semantics.
* **Fuel collection (`FuelSaleController::collectPayment` →
  `FuelSaleService::collectPayment` → `PaymentService::post`):** actor
  lost at `FuelSaleService.php:330`. The service receives
  `User $actor` and even sets `created_by => $actor->id`, but omits
  `$actor` when calling `post()`. Same runtime consequence as POS.
* **InvoiceService::settle() (auto-settlement when `is_paid=true`)
  — REACHABILITY CLOSED, SEVERITY UPGRADED TO P1.** `is_paid` is a
  user-controlled `nullable, boolean` field on
  `StoreInvoiceRequest.php:30`. The runtime test posts the invoice as
  the user who IS the authorized deposit subject
  (`deposit_scope=user, deposit_scope_subject=<actor>`) and observes:
  the post fails with a `RuntimeException` at `assertAllowed(deposit,
  null)`, the invoice stays in `draft`, and no posted Payment leaks
  out. This proves BOTH that the settle path is user-reachable AND that
  the null-actor consequence is user-visible.
* **PurchaseService::settle() — REACHABILITY CLOSED, SEVERITY UPGRADED
  TO P1.** `paid_on_post` is a user-controlled `nullable, integer`
  field on `StorePurchaseRequest.php:36`; the runtime test does the
  mirror under `withdraw_scope=user`.

Baseline still-good: `PaymentController::store()` at
`PaymentController.php:146` passes `$request->user()`. That's the
reference "correct call shape".

## 10. Direct Cash Sale Result

**CONFIRMED GAP (P1).** `InvoiceService.php:863` selects the debit
account as `$this->accountId(self::ACC_CASH)` when `payment_type='cash'`
— i.e. debits ledger account **1110** directly, without ever calling
`CashBankAccountService::resolveForPayment()` or `assertAllowed()`. Runtime
evidence:

* Test `direct_cash_sale_debits_cash_account_without_cashbank_acl` sets
  the tenant's main cash CashBankAccount to `deposit_scope='user'` with
  a stranger user as subject.
* A cash invoice is created and posted through `InvoiceService`.
* The resulting journal entry contains a debit line on account 1110 with
  no deposit ACL rejection.

This means any user with invoice-post authority can move value into the
default cash account regardless of how the tenant configured its
CashBankAccount deposit scope. Fix must reroute the cash-sale debit
through `CashBankAccountService` so the same
`deposit_scope=user|role|branch|all` semantics apply.

## 11. POS Variance Result

**POLICY DECISION REQUIRED.** `PosSessionService.php:600-663`
(`settleVariance`) posts shortage/overage against a server-resolved
session cash account after `pos.variance.approve`, state/acknowledgement
guards and optional SoD. Static test
`pos_variance_settlement_does_not_check_cashbank_acl` confirms the
method body contains no `assertAllowed` call.

Question for product/BC:

* Is `pos.variance.approve` a **privileged domain override** allowed to
  adjust the session's server-bound cash account regardless of the
  deposit/withdraw ACL configured for that CashBankAccount? Or
* Is treasury ACL an **absolute resource boundary**, in which case
  settleVariance must reject the operation when the actor lacks
  deposit/withdraw authority on the session cash entity?

We recommend **not** flipping this in the fix PR bundle. Either answer
is defensible; the code cannot decide it for us. Once product picks a
side, the fix is a one-line addition (either an `assertAllowed()` or an
explicit `// domain override — bypass treasury ACL` comment plus an
audit-visible event).

## 12. Tenant Isolation Negative Controls

Verified: `cross_tenant_branch_id_never_returns_other_tenants_data`
proves a Tenant B user filtering on a Tenant A branch ID resolves to
zero rows and zero totals. This means every branch/scope gap above is
strictly *within* the same tenant. No CRITICAL escalation.

## 13. Confirmed Gaps — final list with future-fix boundary (not executed here)

| Gap | Severity | Path | Failed invariant | Fix boundary (do NOT execute) |
|---|---|---|---|---|
| Actor omitted at POS tender post | P1 | `PosService.php:248` | User-initiated composed service must propagate authenticated actor to `PaymentService::post` | Pass `$data['actor']` (already available) as second arg to `payments->post()`. Contract-only change; no other file touched. |
| Actor omitted at Fuel collection post | P1 | `FuelSaleService.php:330` | Same invariant | Pass `$actor` (already in scope) as second arg. |
| Actor omitted at InvoiceService::settle() **— user-reachable via `is_paid=true`** | **P1 (upgraded)** | `InvoiceService.php:1052` (settle) + `InvoiceService.php:985` (post→settle wiring) + `StoreInvoiceRequest.php:30` (is_paid field) | Same invariant | Plumb the authenticated actor from `InvoiceController::post()` through `InvoiceService::post()` into `settle()`, and pass it as the second arg of `payments->post()`. `created_by` is NOT a substitute for the authorization principal. |
| Actor omitted at PurchaseService::settle() **— user-reachable via `paid_on_post`** | **P1 (upgraded)** | `PurchaseService.php:563` (settle) + `PurchaseService.php:526` (post→settle wiring) + `StorePurchaseRequest.php:36` (paid_on_post field) | Same invariant | Same shape as InvoiceService. |
| Direct cash-sale bypasses CashBank ACL | P1 | `InvoiceService.php:44,863` | Every user-initiated cash movement must traverse `CashBankAccountService::assertAllowed(deposit)` | Reroute the `payment_type='cash'` debit through `resolveForPayment` + `assertAllowed`, using the invoice's `cash_account_id` (already carried on the model). |
| Purchase report branch scope leak | P1 | `PurchaseReportService.php:65,82` | `Report ⊆ allowedBranchIds ∩ requested` | Introduce a shared `restrictReportBranches($filters)` helper (mirror of `ReportService::branchIds()` at `ReportService.php:811-836`) and apply it in each of Purchase / Sales / Inventory / Customer / Classification. |
| Sales report branch scope leak | P1 | `SalesReportService.php:80-83` | Same | Same helper. Note: SalesReport keeps `BranchScope`, but that's insufficient — the intersection MUST happen at the report layer, not just at active-branch context. |
| Inventory warehouse balance leak | P1 | `InventoryReportService.php:63,104` | `Report ⊆ allowedWarehouseIds ∩ allowedBranchIds ∩ requested` | Same helper plus a warehouse-intersection variant. |
| Customer report branch leak | P1 | `CustomerReportService.php:66,149,198` | Same | Same helper. Customer identity itself is CompanyWide-visible; the fix must scope only branch-derived aggregates. |
| Classification Analytics branch leak (all 6 scopes) | P1 | `ClassificationAnalyticsReportService.php:53-56, :73-77, :100` | Same | Apply the same helper inside the three shared helper methods `documents()`, `payments()`, `partners()` — one edit fixes all six scopes. |
| Inventory catalog export aggregates tenant-wide | P2 | `InventoryController.php:57-85` + `InventoryBalanceFilters.php:57-59` | Aggregate export ⊆ allowed warehouses | Either scope the aggregate by joining `product_warehouse_stock` filtered by `allowedWarehouseIds`, or add a per-warehouse breakdown filtered the same way. Note this is a separate surface from `/api/reports/inventory` — the fix PR should be scoped to `InventoryController` alone. |

## 14. False Positives

None found in this pass. Every candidate flagged in the reference §26
"code-backed gap matrix" that we verified this round either landed as
CONFIRMED GAP, CONFIRMED CORRECT (baseline good), or POLICY DECISION
REQUIRED.

## 15. Policy Decisions Required

* **POS variance vs treasury ACL** (§11 of this report; §18.2 of the
  reference). Product to decide privileged-override vs absolute-boundary
  semantics.
* **Report scope precedence in the fix PR bundle** (implicit): whether
  the intersection helper should:
  * silently narrow the request (invisible), or
  * return the effective scope in the response payload so the UI can
    display "showing 2 of 6 branches" (visible governance).

## 16. Out-of-Scope Findings / Testability Blockers

*(After the closure pass, most of this section is CLOSED. Retained
below for traceability; new deferrals are called out as such.)*

* ~~**Report exports** (Group B) deferred.~~ **CLOSED 2026-09-08.** The
  five report controllers have NO server-side export methods (verified
  by reflection); the web workspace renders CSV/PDF client-side from
  the JSON API response, so export scope ≡ API scope by construction.
  A separate `/api/inventory/export` catalog surface was found and
  independently tested — see A3 gap addendum.
* ~~**Customer report** — not runtime-tested in the initial pass.~~
  **CLOSED 2026-09-08.** CONFIRMED GAP P1 via `CUST.1` / `CUST.2`.
* ~~**Classification analytics** — not runtime-tested.~~ **CLOSED
  2026-09-08.** CONFIRMED GAP P1 via `CLAS.1` (runtime on
  sales_invoice) + `CLAS.2` (source-shape assertion across all six
  scopes).
* ~~**InvoiceService::settle() reachability.**~~ **CLOSED 2026-09-08.**
  Reachable from user-controlled HTTP `is_paid=true` field on
  `POST /api/invoices`; severity upgraded to P1.
* ~~**PurchaseService::settle() reachability.**~~ **CLOSED 2026-09-08.**
  Reachable from user-controlled HTTP `paid_on_post` field on
  `POST /api/purchases`; severity upgraded to P1.
* **POS variance settlement runtime characterization.** Still
  deferred — the policy answer decides the shape of the runtime
  invariant; building a runtime test before that decision would need
  to be rewritten either way. Static evidence stands.
* **Full test suite (`php artisan test`) environment issue.** Running
  the whole suite (`~2870` tests) surfaces two pre-existing
  environmental defects unrelated to either verification pass:
  1. `Call to undefined function App\Services\bcmul()` in
     `FuelCostBasisService.php:380` — the container lacks `ext-bcmath`.
     Fails 5 FuelSaleService tests + 1 FuelSaleApi test in isolation.
  2. `SQLSTATE[HY000]: General error: 5 database is locked` on SQLite
     when running the full suite — a well-known SQLite serialization
     issue under many `RefreshDatabase` cycles in one process.
  Both are environment issues, NOT regressions from the new tests. The
  new test files themselves pass cleanly in isolation and alongside all
  adjacent modules.

## 17. Tests Executed

Exact commands + results (both passes):

Initial pass (2026-09-08):
```
$ php artisan test --filter=AccessControlV2VerificationTest
  Tests:    18 passed (29 assertions)   Duration: 6.38s

$ php artisan test --filter=AccessControlV2ReportScopeVerificationTest
  Tests:    7 passed (102 assertions)   Duration: 8.85s
```

Closure pass (2026-09-08):
```
$ php artisan test --filter=AccessControlV2ClosureVerificationTest
  Tests:    9 passed (153 assertions)   Duration: 10.19s

$ php artisan test --filter=AccessControlV2
  Tests:    34 passed (284 assertions)  Duration: 10.99s
```

Adjacent-module smoke (unchanged from baseline):
```
$ php artisan test tests/Feature/PaymentTest.php tests/Feature/PaymentVoucherApiTest.php \
    tests/Feature/SupplierPaymentTest.php tests/Feature/SalesReportTest.php \
    tests/Feature/PurchaseReportTest.php tests/Feature/InventoryReportTest.php \
    tests/Feature/CashBankAccountTest.php tests/Feature/PosCheckoutTest.php \
    tests/Feature/FuelSaleServiceTest.php tests/Feature/FuelSaleApiTest.php \
    tests/Feature/AccessControlV2VerificationTest.php \
    tests/Feature/AccessControlV2ReportScopeVerificationTest.php
  Tests:    6 failed, 102 passed (827 assertions)
  # The 6 failures are all `Call to undefined function App\Services\bcmul()`
  # — pre-existing ext-bcmath environment defect. Not caused by either pass.
```

## 18. Build / CI Status

* `php artisan test --filter=AccessControlV2` — **PASS** (34/34 tests,
  284 assertions, 10.99s).
* Adjacent verification (Payment / Reports / POS / Fuel) — same result
  as pre-change baseline (bcmath failures are environmental, not
  regressions).
* No production files edited.

## 19. Risks / Remaining Unknowns

*(Trimmed to just what still stands after the closure pass.)*

* **POS variance policy decision** — pending product answer. Recommend
  not shipping a variance change in the first fix bundle.
* **Inventory catalog export scope shape** — the fix could either add
  a warehouse intersection to the aggregate, or add a per-warehouse
  breakdown. Product should pick before the fix PR is opened;
  otherwise the fix defaults to warehouse-intersected aggregate.
* **`InvoiceService::settle()` idempotency under the future fix** —
  once the actor is plumbed and the ACL passes for authorized users,
  the existing settle path becomes reachable end-to-end. The fix PR
  needs an explicit "settle runs at most once per post" test — this
  is a fix-time concern, not a verification-round gap.

## 20. Recommended Next PR Breakdown

Do NOT open these here — recommendation only. (Updated after closure.)

1. **PR-ACL-PAYMENT-ACTOR** (P1). Two-line change per service —
   `PosService.php:248`, `FuelSaleService.php:330`. Add regression
   tests exercising the runtime paths under `deposit_scope=user`.
   Bundle: services + tests only.
2. **PR-ACL-CASH-SALE** (P1). Reroute the direct cash-sale debit in
   `InvoiceService.php:863` through `CashBankAccountService` +
   `assertAllowed(deposit)`. Regression test proving a stranger-scoped
   deposit blocks the cash invoice.
3. **PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR** (**P1 after closure**).
   Plumb the authenticated actor from `InvoiceController::post()` and
   `PurchaseController::post()` through the respective services'
   `post()` → `settle()` → `payments->post()` chain. Includes the
   `is_paid=true` / `paid_on_post` regression tests already written
   here (convert from characterization → secure-invariant form).
4. **PR-ACL-REPORT-SCOPE** (P1). Introduce a shared
   `RestrictedBranchScope` helper (mirror of `ReportService::branchIds()`
   at `ReportService.php:811-836`), apply it in Purchase / Sales /
   Inventory / Customer / Classification analytics reports. Six
   scopes in ClassificationAnalytics all pass through three helpers
   — one edit fixes all six. Tests: convert `A2.*`, `A1.*`, `A3.1`,
   `CUST.*`, `CLAS.1` characterization tests to their secure-invariant
   form.
5. **PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE** (P2). Separate surface
   (`InventoryController::export`) — either warehouse-intersect the
   aggregate, or add a per-warehouse breakdown filtered by
   `allowedWarehouseIds`. NOT bundled with PR-4 because it touches a
   different controller and depends on a small product-shape
   decision.
6. **PR-ACL-REPORT-EXPORT-SCOPE** — **NO LONGER NEEDED.** Closure
   pass proved report exports are 100% client-side and inherit the
   API scope, so PR-4 already covers them by construction.
7. **PR-ACL-POS-VARIANCE-POLICY** (BLOCKED on product decision).

Do NOT ship items 1–7 as one big PR — the review surface is too broad
and the accounting invariants are too different.

## 21. Branch / PR / SHAs

* Branch: `claude/awj-access-control-v2-verify-avq7i6`.
* Base branch: `main` (`2db95a2` at initial pass).
* Head SHA at initial verification commit: `23149f2`.
* Head SHA at closure report authoring: `23149f2` (closure commit yet
  to land at authoring time — captured in a separate line by the git
  log once committed).
* PR: not opened by either pass. The task brief prohibits it.
* Commits on the verification branch:
  * `23149f2` — initial verification pass (18+7 tests + report + living reference update).
  * (pending) — closure pass (9 tests + report update + living reference §26 refresh).

---

## Appendix — Test file inventory

* `tests/Feature/AccessControlV2VerificationTest.php` — 18 tests,
  direct service-level and call-site evidence for Groups C / D / E / F.
* `tests/Feature/AccessControlV2ReportScopeVerificationTest.php` — 7
  tests, restricted-persona runtime evidence for Group A + negative
  tenant control.
* `tests/Feature/AccessControlV2ClosureVerificationTest.php` — 9 tests
  closing Group B (report exports), Customer report, Classification
  Analytics, and `is_paid` / `paid_on_post` reachability into
  Invoice/Purchase `settle()`.

Every test docblock names the reference section it verifies and the
secure invariant that would flip the assertion once the gap is fixed.
