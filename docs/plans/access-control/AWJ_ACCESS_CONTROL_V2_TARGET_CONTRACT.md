# AWJ Access Control V2 — Target Contract

**Status:** Documentation only — no production or test code touched by this file.
**Date:** 2026-09-09
**Companion documents:**
* Living reference — [`AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md`](./AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md)
* Verification evidence — `AWJ_ACCESS_CONTROL_V2_VERIFICATION_REPORT.md` (lives on the verification branch `claude/awj-access-control-v2-verify-avq7i6`)

**Purpose:** name the contract Access Control V2 fixes must satisfy, before any fix PR is opened. This is deliberately a small architecture contract, not a master plan. Every clause names either a runtime-verified invariant AWJ already meets, or a runtime-verified gap that must close without violating adjacent invariants.

---

## 1. Core Authorization Contract

Every effective authorization decision in AWJ is a **restrictive intersection** of the layers below:

```text
Effective Authorization =
  Tenant Isolation
  ∩ Feature / Application Entitlement
  ∩ Role / Semantic Permission
  ∩ Branch / Data Scope
  ∩ Resource Scope   (where applicable)
  ∩ Workflow / Record State
  ∩ Accounting & Security Invariants
```

Rules that apply to every layer:

1. Any single layer denying access denies the whole operation. No layer grants access another layer denied.
2. `Record Scope` (own / created / assigned / workflow-member) is only added to modules that need it. It is not a global mandatory layer today.
3. Accounting invariants (double entry, tenant isolation, ledger immutability, period locks, ZATCA lifecycle) sit outside authorization. Permissions never override them.

---

## 2. Action vs Data vs Resource — three distinct layers

Access V2 keeps these three axes explicitly separate. A single permission key must never encode more than one axis.

### 2.1 Action permission — *what the user can do*

Named domain capabilities. Examples already in AWJ:

* `invoices.manage`
* `fiscal_years.close`
* `pos.variance.approve`
* `fuel.shift.approve`

An action permission answers only "may this user attempt this operation at all?"

### 2.2 Data scope — *what data the user can see/act on*

Non-permission fields on the User model that restrict the set of rows the action can touch:

* `User::allowedBranchIds(): ?array` — `null` = unrestricted within tenant; empty array is never returned (see `allowedBranchIds()` in `app/Models/User.php`).
* Branch inference through `SetBranch` middleware from the `X-Branch-Id` header, validated against `User::canAccessBranch()`.

Data scope is orthogonal to action permission. `invoices.manage` never widens branch scope. Branch scope never grants `invoices.manage`.

### 2.3 Resource scope — *on which resources the operation may run*

Per-resource fields on the resource itself:

* `User::allowedWarehouseIds(): ?array` — warehouses.
* `CashBankAccount.deposit_scope` / `withdraw_scope` — `all` / `role` / `user` / `branch` — with a subject column per direction.

Holding `payments.manage` does not entitle the user to use every `CashBankAccount`. The resource scope layer decides that.

---

## 3. Actor Contract

### 3.1 `Authenticated Actor` is never substituted by `created_by`

* `created_by` records **audit attribution**. It answers "who created this row".
* The authorization principal for a user-initiated composed operation is the authenticated actor at the top of the call chain (`request()->user()`), and it must survive every service boundary until the resource-authorization layer.
* `created_by` may equal the actor most of the time; that coincidence must never be used to substitute one for the other.

### 3.2 User-initiated composed operations must propagate the actor

For every path of the shape:

```text
Authenticated User
  → Controller
    → Domain Service
      → Composed Service    (may be nested)
        → Resource Authorization Layer
          → Financial / State Effect
```

the authenticated actor must be a first-class parameter of every intermediate service call until the resource-authorization layer receives it. The runtime verification pass proved this contract is currently violated at four call sites:

* POS checkout tender → `PaymentService::post()` (`PosService.php:248`)
* Fuel sale collection → `PaymentService::post()` (`FuelSaleService.php:330`)
* Invoice auto-settlement — reachable from HTTP `is_paid=true` → `PaymentService::post()` (`InvoiceService.php:1052`)
* Purchase auto-settlement — reachable from HTTP `paid_on_post` → `PaymentService::post()` (`PurchaseService.php:563`)

### 3.3 System / non-interactive actors

Server jobs, migrations and deterministic system adjustments may legitimately have no interactive actor. They must declare that intent explicitly (a documented system-authority contract, an audit note, or a dedicated system-user identity), not silently inherit nullable actor behavior.

---

## 4. Branch Effective Scope

### 4.1 Effective scope formula

```text
Effective Branch Scope =
  Allowed Branches   (from User::allowedBranchIds())
  ∩ Requested Branches   (client filter, if any)
```

* If the client did not request any branches: `Effective = Allowed`.
* If the client requested only forbidden branches: intersection is empty → the report/list returns zero rows (silent narrowing), NOT the forbidden data.
* If the client requested a mix `[allowed, forbidden]`: `Effective = allowed subset`.

### 4.2 Backward compatibility invariant

```text
allowedBranchIds() === null  ⇒  unrestricted within tenant
```

This must remain true until (and only until) a migration is deliberately introduced. Fix PRs must not turn `null` into "no access" by accident.

### 4.3 Direct resource access

Direct access to a specific resource ID (a single-invoice fetch, a single-payment update) is governed by the existing endpoint-level check (typically 404 outside scope, as `PosInvoiceBranchAccessTest` demonstrates). This contract does not change that behavior; the branch effective-scope formula applies to list / report / aggregation queries where "empty result" is a legitimate return.

---

## 5. Warehouse Contract

```text
Inventory Data Access =
  Product Visibility
  ∩ Branch Scope
  ∩ Warehouse Scope
```

Cost / valuation visibility is a separate sensitive-permission layer on top:

```text
Cost Visibility = Inventory Data Access ∩ products.view_cost
```

`products.view_cost` never substitutes for warehouse authorization. A user restricted to Warehouse A cannot see Warehouse B's stock even if they hold `products.view_cost`.

Distinct surfaces:

* **Product master** — CompanyWide by default.
* **Warehouse stock** — per-warehouse; must be scoped by `allowedWarehouseIds`.
* **Quantity** — always scope-restricted.
* **Valuation / cost** — scope-restricted PLUS `products.view_cost`.
* **Inventory transactions / movements** — same scope shape as stock.

---

## 6. Treasury Contract

Daftra's official documentation confirms the operating model split between:

* Deposit authority (who may put money into a treasury or bank),
* Withdraw authority (who may take money out).

AWJ already implements exactly this shape on `CashBankAccount`.

### 6.1 Contract

```text
Financial Operation Authorization =
  Domain Action Permission                       (e.g. payments.manage, pos.*)
  ∩ Branch Scope
  ∩ Cash/Bank Resource Authority                 (deposit / withdraw per resource)
  ∩ Workflow / Record State                      (posted vs draft, session open, etc.)
  ∩ Accounting Invariants                        (double entry, period lock, ZATCA)
```

Direction rule:

```text
money into treasury   → deposit authority
money out of treasury → withdraw authority
internal transfer     → source withdraw AND destination deposit
```

Holding `invoices.manage`, `payments.manage`, or `pos.*` does NOT automatically grant the right to use any specific cash or bank resource. The `CashBankAccount.deposit_scope` / `withdraw_scope` layer decides that per-resource.

### 6.2 CashBankAccount scope semantics — preserve as-is

The verification pass confirmed `CashBankAccount::allows()` behaves exactly as documented:

| scope | actor=null | matching actor | non-matching actor |
|---|---|---|---|
| all | allow | allow | allow |
| branch (context matches) | allow | allow | allow |
| user | deny | allow | deny |
| role | deny | allow | deny |

No change to `CashBankAccount` schema, columns or semantics is contemplated by Access Control V2. Every fix in this round is about ensuring the correct actor reaches the check — not about redesigning the check.

---

## 7. POS Variance Decision — DECIDED, IMPLEMENTATION PENDING

### 7.1 Decision
```text
canSettleVariance =
  pos.variance.approve
  ∩ session/branch authority
  ∩ affected CashBankAccount authority (deposit for overage, withdraw for shortage)
  ∩ valid session/state/SoD requirements
```

`pos.variance.approve` does **not** grant an implicit treasury override.

### 7.2 What is deliberately NOT introduced now

* No new permission key (`treasury.override`, `pos.variance.treasury_bypass`, or similar).
* No exception path inside `settleVariance` that quietly skips `assertAllowed`.
* No blanket domain-override framework.

Any future privileged override — if the product ever decides one is required — must be an explicit, audited authority with its own key and its own audit event. Never an implicit bypass discovered by reading code.

### 7.3 Implementation status

Pending. Not part of the first fix bundle. The verification tests already characterize the current (non-conforming) behavior for future regression comparison.

---

## 8. Reports Contract

```text
Report Result =
  Report Permission
  ∩ Effective Data Scope   (Branch / Warehouse / Record as applicable)
  ∩ Resource Scope         (where applicable)
```

The same Effective Scope must govern **every** report surface, without exception:

* JSON API `rows`,
* JSON API `totals` and KPIs,
* charts,
* drill-downs,
* client-side CSV exports built from the JSON response,
* client-side PDF/print exports built from the JSON response.

`totals` / `KPIs` may NEVER be broader than `rows` under the same request. If the client renders an aggregate that isn't derived from the same query family, that widget is out of contract until it is.

### 8.1 Verified consequence
The verification pass proved that report exports on Sales / Purchases / Inventory / Customer / Classification Analytics are 100% client-side: the browser renders CSV via `@/lib/export` and PDF via `@/modules/reports/services/report-pdf` (jsPDF), starting from the same JSON API response the on-screen table uses. Therefore:

```text
Report Export Scope = Report API JSON Scope   (by construction)
```

A single fix at the API layer covers rows, totals and exports for all five report families.

### 8.2 One separate export surface
`GET /api/inventory/export` is a **catalog balance export**, not a report export. It sits on `Product::query()` and returns tenant-wide aggregate quantity / avg_cost per product. It is treated as its own fix in the PR breakdown — not bundled with the five report services.

---

## 9. Customer Contract

Customer master identity and customer branch-derived financial activity are **separate surfaces**:

```text
Customer Master Identity  !=  Customer Branch-derived Financial Activity
```

* Customer master (name, VAT, contact) — visibility governed by existing sharing / branch semantics; may remain visible even when some of the customer's transactions live in branches the user cannot see.
* Customer's sales / invoices / balances / receipts / branch-derived aggregates — MUST be filtered by Effective Branch Scope.

A future fix must not hide the customer's identity to hide their branch-B invoices. It must scope the branch-B invoices out while keeping the customer discoverable in the customer list.

---

## 10. Direct Cash Sale — target invariant only, no adopted fix yet

The verification pass confirmed a P1 gap: `InvoiceService::post()` debits ledger account 1110 directly for `payment_type='cash'` invoices, without traversing `CashBankAccountService`.

### 10.1 Target invariant
```text
For every user-initiated cash-account effect:
  1. Resolve the affected Treasury Resource (a real CashBankAccount row).
  2. Verify deposit authority on that resource via CashBankAccountService::assertAllowed('deposit', $actor).
  3. Resolve / use the correct GL account THROUGH the resource (not a hard-coded '1110').
  4. Post the balanced journal via LedgerService.
```

### 10.2 Deliberate non-decision

The exact selection rule for the CashBankAccount on a direct cash-sale invoice is NOT decided in this contract. Options include:

* the invoice's own `cash_account_id` if provided,
* the tenant's main cash CashBankAccount if not,
* the branch's designated cash CashBankAccount if branch-scoped cash resources are ever introduced,
* the POS session's cash CashBankAccount when the invoice originated from POS.

Before opening `PR-ACL-CASH-SALE` an inspection pass must confirm the treasury-resource ↔ GL-account resolution semantics AWJ intends. That inspection is out of scope for this contract.

---

## 11. Backward Compatibility

Access Control V2 explicitly preserves:

* Owner / admin wildcard `*` role behavior in `Rbac`.
* Legacy `view` / `manage` broad permission matrices — no key rewrites, no removals.
* `allowedBranchIds() === null` and `allowedWarehouseIds() === null` semantics = unrestricted within tenant.
* All migrations already in production. No schema migration is contemplated by this round.
* Every RBAC catalogue key. Sensitive risk labels, dependency metadata and role cloning are separate future work.

If a future PR needs to break any of the above, it must land as its own migration + its own PR, and must be explicitly acknowledged in that PR's description as a BC-breaking change.

---

## 12. Non-goals — what Access Control V2 is NOT building

To keep the fix bundle small and reviewable, the following are explicitly out of scope:

* Dynamics-style `Role → Duty → Privilege → Permission` tables in AWJ's schema.
* Any generic ABAC engine.
* Any generic Record Rules language.
* Any role hierarchy engine.
* Any generic Segregation-of-Duties engine.
* Any permission dependency engine.
* Any treasury override framework beyond what already exists (`CashBankAccount.deposit_scope='all'` is the only universal-grant path).
* An RBAC rewrite of any kind.
* Big-bang `*.manage` decomposition into semantic keys.
* A general permission-migration mechanism.
* A tenant Recycle Bin capability (separate future work).
* Advanced record-scope semantics (own / assigned / workflow) as a global mandatory layer.

None of the confirmed P1 gaps require any of the above.

---

## 13. Verification Gaps ↔ Broken Contract ↔ Planned PR

| Gap (verification-round evidence) | Broken contract clause | Planned PR |
|---|---|---|
| POS checkout actor omission at `PaymentService::post` — `PosService.php:248` | §3.2 (composed-service actor propagation) | PR-ACL-PAYMENT-ACTOR |
| Fuel collection actor omission — `FuelSaleService.php:330` | §3.2 | PR-ACL-PAYMENT-ACTOR |
| Invoice auto-settle actor omission (`is_paid=true` reachable) — `InvoiceService.php:1052` + `StoreInvoiceRequest.php:30` | §3.2 | PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR |
| Purchase auto-settle actor omission (`paid_on_post` reachable) — `PurchaseService.php:563` + `StorePurchaseRequest.php:36` | §3.2 | PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR |
| Direct cash sale debits 1110 without CashBank ACL — `InvoiceService.php:44,863` | §6 (Treasury resource authority) + §10 (target invariant) | PR-ACL-CASH-SALE (after treasury resolution inspection) |
| Sales report branch scope leak — `SalesReportService.php:80-83` | §4 + §8 | PR-ACL-REPORT-SCOPE |
| Purchase report branch scope leak — `PurchaseReportService.php:65,82` | §4 + §8 | PR-ACL-REPORT-SCOPE |
| Inventory warehouse balances leak — `InventoryReportService.php:63,104` | §4 + §5 + §8 | PR-ACL-REPORT-SCOPE |
| Customer report branch scope leak — `CustomerReportService.php:66,149,198` | §4 + §8 + §9 | PR-ACL-REPORT-SCOPE |
| Classification Analytics branch scope leak (six scopes, three helpers) — `ClassificationAnalyticsReportService.php:53-56,73-77,100` | §4 + §8 | PR-ACL-REPORT-SCOPE |
| Inventory catalog export tenant-wide aggregate — `InventoryController.php:57-85` | §5 (warehouse resource scope on aggregates) | PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE |
| POS variance settlement bypasses CashBank ACL — `PosSessionService.php:600-663` | §7.1 (target policy — decided; not implicit override) | Pending — no PR in the first bundle |

---

## 14. Implementation Order

Sequenced to keep each PR small, self-contained and independently reviewable. This is documentation only — do NOT start any PR from this file.

1. **PR-ACL-PAYMENT-ACTOR.** Two-line change per service. `PosService.php:248` and `FuelSaleService.php:330` pass the already-available actor as the second argument of `payments->post()`. Regression tests under `deposit_scope=user`. Bundle: services + tests only.

2. **PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR.** Plumb the authenticated actor from `InvoiceController::post()` / `PurchaseController::post()` through the respective service `post()` → `settle()` → `payments->post()` chain. Regression tests are already characterized in `AccessControlV2ClosureVerificationTest`; convert them from characterization to secure-invariant form when the fix lands.

3. **PR-ACL-REPORT-SCOPE.** Introduce a shared `RestrictedBranchScope` helper (mirror of `ReportService::branchIds()` at `ReportService.php:811-836`). Apply it in Sales / Purchase / Inventory / Customer / Classification Analytics report services. All five characterization tests flip to secure-invariant form. One PR, one helper, five call-site edits.

4. **Treasury Resource ↔ GL Account resolution inspection** (docs / research only, no code). Decides how a direct cash sale selects its `CashBankAccount`. Pre-requisite for PR 5.

5. **PR-ACL-CASH-SALE.** Reroute the `payment_type='cash'` debit in `InvoiceService.php:863` through `CashBankAccountService`. Depends on step 4.

6. **PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE.** Warehouse-intersect the aggregate on `/api/inventory/export`, or add a per-warehouse breakdown filtered by `allowedWarehouseIds`. Separate surface from PR 3.

7. **Role Administration defects** (RoleDialog display + multi-segment key truncation from living reference §15). Separate track — UI surface only, no authorization boundary.

8. **Advanced record scope / workflow / SoD** — deferred until an actual module needs it. Not part of Access Control V2.

---

## 15. References

Official, non-blog sources fed the architectural research. Any conflict with AWJ runtime-verified behavior is resolved in favour of the runtime observation.

### Daftra official documentation (functional benchmark)
* Adding a New User
* Employee Role
* Branches Management
* Adding a New Warehouse
* Creating a Warehouse Manager and Branch Manager
* Adding a Treasury
* Adding a Bank Account
* Approval and workflow documentation (leave, requests, POS/fuel approvals)

### Microsoft Learn — Dynamics 365 (enterprise validation reference)
* Dynamics 365 Role-based Security
* Security Strategy / data security
* Segregation of Duties
* Security Reports

The Dynamics references validate the *shape* of the model (action ↔ data ↔ resource separation, SoD as a modelling concept). They do not authorize adopting Dynamics' database schema in AWJ.

---

## 16. What this contract does NOT do

* It does not open any pull request.
* It does not change any production code, test, migration or schema.
* It does not decide the exact fix code for any of the eleven runtime-confirmed gaps.
* It does not resolve the POS variance implementation (only the target policy).
* It does not resolve treasury-resource ↔ GL-account selection semantics.

Its only role is to make sure every future Access Control V2 fix PR can point at a clause here and say "this fix upholds the contract".
