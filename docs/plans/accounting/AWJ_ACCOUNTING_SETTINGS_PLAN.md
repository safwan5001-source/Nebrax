# AWJ Accounting Settings — Living Plan

**Status:** ACTIVE / LIVING PLAN  
**Created:** 2026-09-06  
**Base SHA:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`  
**Scope:** Architecture and phased implementation plan only.  
**Safety:** No merge, deploy, schema change, or accounting behavior change is authorized by this document.

## 1. Purpose
This is the authoritative living plan for **إعدادات الحسابات / Accounting Settings** in AWJ ERP. Priorities: accounting correctness, historical integrity, tenant isolation, explicit branch semantics, backward compatibility, server-side controls, and small reviewable PRs. `LedgerService::post()` remains the exclusive posting primitive.

## 2. Evidence Base
The read-only AWJ audit established centralized posting/reversal, hardcoded `ACC_*` resolution, absence of semantic routing/fiscal periods/period locks, real but asymmetric cost-center support, scalar tenant Settings infrastructure, and concrete historical `journal_lines.account_id` snapshots. Daftra is a functional benchmark only; AWJ does not copy behavior that conflicts with its perpetual-inventory or ledger design.

## 3. Target Workspace — V1
1. General Accounting Settings
2. Account Routing
3. Fiscal Periods
4. Accounting Period Locks
5. Cost Centers

Deferred: journal/asset custom fields, physical asset locations/stores, multi-currency/exchange rates, generic cross-domain audit framework. Warehouses remain under Products & Inventory. General Settings exposes only policies genuinely enforced by backend behavior.

## 4. Account Routing Architecture Contract
- Semantic role is the accounting identity; chart codes are legacy defaults.
- Static role catalog in code; no tenant `accounting_roles` table.
- Tenant selections are relational mappings: `Tenant + Role Key -> Account ID`.
- No mapping -> legacy resolution for backward compatibility.
- Valid explicit mapping -> mapped account for new postings.
- Explicit invalid/cross-tenant/missing/disabled mapping -> **BLOCK POSTING**, no silent fallback.
- Historical posted journals never re-resolve; stored `journal_lines.account_id` remains authoritative.
- Legacy fallback is a migration bridge, not permanent target architecture.
- No global "disable accounting" switch.
- `LedgerService` receives resolved account IDs and remains unaware of business-role semantics.
- A generic Accounting Role resolver must not replace a domain-specific financial resolver that also enforces permissions or operational policy.

## 5. Sales Routing Contract
| Role | Meaning | Legacy | Status |
|---|---|---:|---|
| `accounts_receivable` | الذمم المدينة | `1130` | CONFIRMED |
| `sales_revenue` | إيرادات المبيعات | `4110` | CONFIRMED |
| `sales_shipping_revenue` | إيرادات الشحن | `4130` | CONFIRMED |
| `document_adjustment` | فروق/تسويات رأس المستند | `5170` | CONFIRMED shared role |
| `tax_output` | ضريبة المخرجات | `2120` | CONFIRMED |
| `cogs` | تكلفة البضاعة المباعة | `5110` | CONFIRMED / Inventory |
| `inventory_asset` | المخزون | `1140` | CONFIRMED / Inventory |

Preserve existing precedence:
- `Product sales_account_id -> tenant sales_revenue mapping -> legacy 4110`
- `Product cogs_account_id -> tenant cogs mapping -> legacy 5110`

Cash/bank is not a Sales semantic role. `tax_output` is a shared Tax role.

## 6. Purchase Routing Contract
Current purchase posting: tracked goods debit `1140`; non-inventory lines debit `5150`; input VAT debits `1150`; payable credits `2110` even for cash purchases; payment is separate via `PaymentService`. Purchase discount/inbound shipping modify inventory/expense cost rather than posting independently. Header adjustment uses shared `document_adjustment` with legacy fallback `5170`.

| Role | Meaning | Legacy | Status |
|---|---|---:|---|
| `accounts_payable` | الذمم الدائنة | `2110` | CONFIRMED |
| `inventory_asset` | المخزون | `1140` | CONFIRMED |
| `purchase_expense` | مصروف البنود غير المخزنية | `5150` | CONFIRMED |
| `tax_input` | ضريبة المدخلات | `1150` | CONFIRMED |
| `document_adjustment` | فروق/تسويات رأس المستند | `5170` | CONFIRMED shared role |

Do not invent independent purchase shipping/discount roles without a proven accounting need.

## 7. Purchase Returns and Supplier Refund
Current purchase return reverses original categories: debit payable (`2110`) for credit return or cash (`1110`) for cash return; credit inventory (`1140`), expense (`5150`), input VAT (`1150`) as applicable.

**`5180` is NOT Purchase Returns.** Current evidence identifies it with inventory variance/damage/adjustment semantics.

No dedicated `purchase_returns` role is approved merely by imitation of another ERP. AWJ's perpetual-inventory return reverses inventory/expense/input VAT directly.

### 7.1 Confirmed architectural inconsistency
Purchase posting always establishes supplier liability and delegates settlement to `PaymentService`, while the current Purchase Return UI/API requires `payment_type = cash|credit`. For `cash`, `ReturnService` directly debits legacy cash account `1110` without selecting a `CashBankAccount`, `PaymentMethod`, or applying Cash/Bank deposit permissions.

This is both a routing inconsistency and a business-contract ambiguity. It must not be hidden by introducing a generic `cash` Accounting Role.

### 7.2 Target accounting contract
For new behavior after an explicit future cutover:

**Purchase Return** records the commercial reversal only:
- Dr `accounts_payable`
- Cr `inventory_asset` and/or `purchase_expense`
- Cr `tax_input` as applicable.

If the supplier actually refunds money, that is a distinct **Supplier Refund / Settlement** operation:
- Dr the selected `CashBankAccount.account_id`
- Cr `accounts_payable`
- preserve partner dimension and an auditable link to the supplier and, where applicable, the return/credit being settled.

Therefore the target principle is: `Purchase != Payment` and `Purchase Return != Supplier Refund`.

Historical posted returns remain frozen and are never reinterpreted.

### 7.3 Do not overload current Payment direction
Current `Payment.direction` is not a generic cash-flow direction:
- `received` -> customer receipt, allocations to sales `Invoice`, Cr Accounts Receivable;
- `paid` -> supplier payment, allocations to `Purchase`, Dr Accounts Payable.

Posting also updates allocated invoice/purchase `paid_amount` and `payment_status`. Supplier Refund must not be implemented merely as `Payment(direction=received)` or by reversing `paid`.

### 7.4 Supplier Refund implementation gate
A dedicated Supplier Refund feature/domain is the preferred target rather than a flag that mutates existing Payment meaning. Exact model/service/API/UI design is outside Account Routing and requires focused design before ACC-4 consumes Purchase Return routing.

## 8. Inventory Routing Contract — CONFIRMED 2026-09-06
### 8.1 Inventory asset
`1140` is the inventory control account across purchases, purchase returns, sale COGS, sales returns, stocktakes, stock permits, transfers, and openings: `inventory_asset`.

### 8.2 COGS
`cogs` is shared Inventory Accounting. Preserve `Product cogs_account_id -> tenant cogs mapping -> legacy 5110`.

### 8.3 Opening balances are not variance
Inventory opening posts `Dr inventory_asset (1140) / Cr opening_balances (3130)` and refuses products with prior stock movements. `opening_balances` is confirmed semantically but final settings-domain placement remains UNDER_REVIEW.

### 8.4 `5180` is overloaded
Current `5180` conflates:
1. `inventory_count_variance` — physical stocktake differences.
2. `inventory_manual_adjustment` — generic manual stock receipt/issue counterpart.
3. `inventory_damage_loss` — explicitly damaged/non-saleable goods.

These roles may initially share legacy fallback `5180` while becoming independently mappable.

### 8.5 Do not split gain/loss merely by sign
Stocktake surplus and shortage are opposite signs of one business cause. Separate gain/loss mappings are deferred until proven necessary.

### 8.6 Stock Permit free text cannot select accounting semantics
Do not infer damage/internal consumption/samples accounts from free text. Structured accounting classification is required before such routing.

### 8.7 Non-saleable sales returns
Returned goods that do not re-enter saleable inventory consume `inventory_damage_loss`, not `inventory_count_variance`.

### 8.8 Transfers
Same-branch warehouse transfer creates no GL entry. Cross-branch transfer posts the same `inventory_asset` role on both sides with different branch dimensions. No transfer-clearing role is proven necessary.

### 8.9 Branch dimensions
ACC-5 must preserve existing branch dimensions exactly; this does not itself approve branch-specific mappings.

### 8.10 Inventory role set
| Role | Meaning | Legacy | Status |
|---|---|---:|---|
| `inventory_asset` | حساب مراقبة المخزون | `1140` | CONFIRMED |
| `cogs` | تكلفة البضاعة المباعة | `5110` | CONFIRMED |
| `opening_balances` | مقابل الأرصدة الافتتاحية | `3130` | CONFIRMED meaning / placement UNDER_REVIEW |
| `inventory_count_variance` | فروق الجرد الفعلي | `5180` | CONFIRMED concept |
| `inventory_manual_adjustment` | مقابل الإضافة/الصرف اليدوي | `5180` | CONFIRMED concept |
| `inventory_damage_loss` | تلف/مرتجع غير قابل للبيع | `5180` | CONFIRMED concept |

## 9. Cash / Bank / Payment Routing Contract — CONFIRMED 2026-09-06
### 9.1 CashBankAccount is the source of truth
AWJ already has a domain-specific Cash/Bank routing subsystem. Do not create semantic roles such as `cash_account`, `bank_account`, `card_account`, or `transfer_account` that duplicate it.

### 9.2 Payment methods are not Accounting Roles
Payment methods and settlement accounts remain under Payment/Cash-Bank configuration, not Account Routing.

### 9.3 PaymentService routing boundary
Customer receipt: Dr selected CashBankAccount / Cr `accounts_receivable`.
Supplier payment: Dr `accounts_payable` / Cr selected CashBankAccount.

### 9.4 Cash/Bank transfers
Transfers post concrete source/destination CashBankAccount accounts. No transfer-clearing role is proven necessary.

### 9.5 Resolver precedence principle
A domain-specific resolver that enforces permissions/policy must not be bypassed by generic Accounting Role resolution.

## 10. Legacy `5170` Semantic Audit — CONFIRMED 2026-09-06

### 10.1 Actual consumers
At the audited code baseline, `5170` is used as `ACC_ADJUSTMENT` by the sales `InvoiceService` and purchase `PurchaseService`. The similarly named Stock Permit `ACC_ADJUSTMENT` is a different legacy account, `5180`, and belongs to the inventory semantics already decomposed above.

### 10.2 Sales behavior
The invoice header `adjustment` is explicitly non-taxable and is included directly in document total. At posting:
- positive adjustment -> credit `5170` (gain/increase in invoice total);
- negative adjustment -> debit `5170` (loss/decrease in invoice total).

The code describes it as rounding/settlement difference rather than product revenue, shipping revenue, VAT, discount, or cash settlement.

### 10.3 Purchase behavior
The purchase header `adjustment` is included directly in total after inventory/expense base and input VAT calculation. At posting:
- positive adjustment -> debit `5170` (additional purchase-side cost/difference);
- negative adjustment -> credit `5170` (rounding/adjustment reduction).

The same service deliberately treats purchase discount and inbound shipping as part of inventory/expense cost, proving that `5170` is not their routing account.

### 10.4 One semantic role, not sales/purchase duplicates
Both consumers use the same user-facing/document-level concept: a signed header adjustment used to reconcile the final document total. The debit/credit direction differs naturally with sales vs purchase economics, but that does not create different accounting identities.

**Decision:** V1 uses one shared semantic role:

`document_adjustment` — فروق وتسويات/تقريب رأس المستند — legacy fallback `5170`.

Do not create `sales_adjustment` and `purchase_adjustment` as separate mappings in V1. Doing so would duplicate one current accounting policy merely because two document modules consume it.

### 10.5 Scope guard
`document_adjustment` must not become a generic dumping account for unrelated future adjustments. A future flow may consume it only when its accounting contract is genuinely the same signed document-header reconciliation concept. Inventory variance/damage remains under the separate `5180`-derived roles.

### 10.6 Tax and cost-center behavior are preserved
Current sales adjustment is explicitly non-taxable. Purchase adjustment is added after VAT calculation. Neither current `5170` posting line carries a cost-center dimension. Account Routing must change only account resolution; it must not silently change tax treatment or cost-center tagging.

## 11. Current Role Catalog
**Confirmed:**
- `accounts_receivable`
- `accounts_payable`
- `sales_revenue`
- `sales_shipping_revenue`
- `document_adjustment`
- `inventory_asset`
- `cogs`
- `purchase_expense`
- `tax_output`
- `tax_input`
- `inventory_count_variance`
- `inventory_manual_adjustment`
- `inventory_damage_loss`

**Confirmed meaning / placement under review:** `opening_balances`.

**Explicitly not Account Routing roles:** cash accounts, bank accounts, payment methods, card/cheque/transfer settlement accounts managed by Cash/Bank subsystem.

**Deferred/not approved:** independent `sales_adjustment` / `purchase_adjustment`; independent `purchase_returns`; separate variance gain/loss without proven need; inventory transfer clearing; cash/bank transfer clearing; generic product/category precedence beyond existing overrides; branch-specific role mappings; fiscal-close roles until fiscal design.

## 12. General Settings
No exchange-rate controls before multi-currency exists; no tax-on-journal-line controls when VAT is posted as separate lines; no per-line account toggles before end-to-end support; no non-functional switches.

## 13. Cost Centers
Reuse existing implementation. Settings may link to `/cost-centers`. Purchase-line allocation remains a separate optional functional PR.

## 14. Accounting Period Locks
Confirmed absent. Enforcement must be server-side and cover API/POS/import paths. Reversal semantics must be explicit. **Branch semantics UNRESOLVED.**

## 15. Fiscal Periods and Closing
Confirmed absent and distinct from date locks. Separate accounting design/audit is required before implementation. **Branch semantics UNRESOLVED.**

## 16. Routing Branch Semantics
**UNRESOLVED for V1.** Routing, locks, and fiscal periods each require an independent branch-policy decision.

## 17. Audit and Permissions
Initial direction: `accounting_settings.view` / `accounting_settings.manage`, subject to repository convention check. Audit mapping changes, period-lock changes, fiscal close/reopen, and future high-impact accounting policy changes.

## 18. Updated PR Sequence
### ACC-1 — Accounting Settings Foundation + Workspace + RBAC
Hub/sidebar/real permissions; no accounting behavior change.

### ACC-2 — Semantic Roles + Mapping Foundation
Static catalog; relational tenant mappings; resolver; validation; tenant protection; mapping audit; no posting consumer yet; invalid explicit mapping fails closed. Initial confirmed role catalog includes `document_adjustment` as one shared role.

### ACC-3 — Sales + Payment Counterparty Routing
Confirmed sales/shared roles including `document_adjustment`; preserve product sales override; historical journals unchanged; unmapped tenants legacy-equivalent. `PaymentService` may consume `accounts_receivable` / `accounts_payable` while Cash/Bank resolution remains in `CashBankAccountService`.

### GATE-ACC-RET-1 — Purchase Return / Supplier Refund Financial Contract
Before ACC-4: remove dependency on direct legacy `1110` for new cash purchase returns; design dedicated Supplier Refund domain rather than overloading current Payment direction; preserve history; define cutover; use selected CashBankAccount and deposit authorization; define linking/allocation; require accounting, tenant-isolation, authorization, concurrency and historical-integrity tests.

### ACC-4 — Purchases + Purchase Returns Routing
Starts only after GATE-ACC-RET-1. Use confirmed purchase/shared roles including the same `document_adjustment`; no dedicated purchase-return role without approval; never repurpose `5180`.

### ACC-5 — Inventory / COGS Routing
Use confirmed inventory roles; preserve product COGS override; three `5180`-backed roles may share legacy fallback; no free-text inference; preserve branch dimensions. `opening_balances` inclusion waits for placement decision.

### ACC-6 — Accounting Period Lock
Branch decision first; central server guard; Web/API/POS/import coverage; explicit reversal and concurrency tests.

### Fiscal Periods / Closing
Dedicated design/audit first, then split implementation into small PRs.

## 19. Mandatory Routing Test Invariants
1. No mapping -> legacy-equivalent posting.
2. Valid mapping -> new posting uses mapped account.
3. Cross-tenant mapping -> rejected.
4. Explicit disabled/invalid mapping -> posting blocked.
5. Mapping change -> historical account IDs unchanged.
6. Existing product sales override still wins.
7. Existing product COGS override still wins.
8. Ledger invariants unchanged.
9. Tenant isolation.
10. Payment counterparty routing never bypasses CashBankAccount selection/permissions.
11. Cash/Bank transfer still uses concrete source/destination accounts.
12. Sales positive/negative `document_adjustment` preserves existing credit/debit direction and remains non-taxable.
13. Purchase positive/negative `document_adjustment` preserves existing debit/credit direction and current VAT treatment.
14. Routing `document_adjustment` does not add cost-center tagging that does not exist today.
15. Stocktake shortage/surplus preserve direction.
16. Stock-permit receipt/issue preserve direction.
17. Non-saleable sales return uses damage/loss role, not count variance.
18. Inventory opening preserves branch-specific lines and balance.
19. Same-branch inventory transfer still has no journal; cross-branch transfer uses inventory asset both sides with correct branches.
20. Supplier Refund gate proves no new Purchase Return silently posts to legacy cash `1110` and historical returns remain unchanged.
21. Branch isolation once branch-specific routing is approved.

Financial/security tests must never be weakened.

## 20. Decisions Log
- **DEC-ACC-001 ACCEPTED:** semantic roles, not account codes.
- **DEC-ACC-002 ACCEPTED:** static catalog + relational mappings.
- **DEC-ACC-003 ACCEPTED:** legacy fallback only when mapping absent; invalid explicit mapping blocks.
- **DEC-ACC-004 ACCEPTED:** routing changes prospective; history frozen.
- **DEC-ACC-005 ACCEPTED:** preserve existing product sales/COGS overrides.
- **DEC-ACC-006 ACCEPTED:** `5180` is not Purchase Returns.
- **DEC-ACC-007 ACCEPTED:** no dedicated Purchase Returns role by imitation.
- **DEC-ACC-008 ACCEPTED:** fiscal close and transaction lock are separate.
- **DEC-ACC-009 ACCEPTED:** branch semantics are explicit per domain.
- **DEC-ACC-010 ACCEPTED:** General Settings exposes only real backend behavior.
- **DEC-ACC-011 ACCEPTED:** decompose overloaded `5180` into count variance, manual adjustment, and damage/non-saleable loss.
- **DEC-ACC-012 ACCEPTED:** do not split inventory variance gain/loss by sign in V1.
- **DEC-ACC-013 ACCEPTED:** Stock Permit free text cannot select accounting roles.
- **DEC-ACC-014 ACCEPTED:** no inventory transfer-clearing role proven necessary.
- **DEC-ACC-015 ACCEPTED:** opening balances are not inventory variance; final domain placement remains open.
- **DEC-ACC-016 ACCEPTED:** CashBankAccount is source of truth for cash/bank ledger accounts.
- **DEC-ACC-017 ACCEPTED:** Payment methods are not Account Routing roles.
- **DEC-ACC-018 ACCEPTED:** domain-specific financial resolver wins when it enforces additional permissions/policies.
- **DEC-ACC-019 ACCEPTED:** no Cash/Bank transfer-clearing role required by current architecture.
- **DEC-ACC-020 ACCEPTED:** Purchase Return and Supplier Refund are distinct target operations; do not overload current Payment direction.
- **DEC-ACC-021 ACCEPTED:** Supplier Refund is a financial behavior gate before Purchase Return routing.
- **DEC-ACC-022 ACCEPTED:** legacy `5170` resolves to one shared `document_adjustment` semantic role in V1, not separate sales/purchase roles.
- **DEC-ACC-023 ACCEPTED:** `document_adjustment` is limited to the signed document-header reconciliation concept; it is not a generic miscellaneous-adjustment account.
- **DEC-ACC-024 ACCEPTED:** routing `5170` must preserve current tax and cost-center behavior; account resolution alone must not alter those dimensions.

## 21. Open Decisions / Do Not Implement Yet
- exact Supplier Refund model/API/UI/allocation and cutover under GATE-ACC-RET-1;
- final domain placement of `opening_balances`;
- structured Stock Permit reason/category accounting model;
- separate variance gain/loss mappings;
- branch-specific routing policy;
- period-lock branch policy;
- fiscal-period branch policy;
- fiscal close mechanics;
- generic product/category routing beyond current overrides;
- independent Purchase Returns contra account;
- multi-currency.

## 22. Immediate Next Step
The core V1 semantic role catalog is now sufficiently resolved for foundation planning. Before implementation, perform a narrow **ACC-1 / ACC-2 readiness pass** against the current repository conventions: permissions/RBAC naming, settings-hub navigation pattern, migration/model tenant-isolation conventions, audit-log precedent, and tests required for a no-behavior-change mapping foundation. Then prepare the implementation task without merging or deploying anything.