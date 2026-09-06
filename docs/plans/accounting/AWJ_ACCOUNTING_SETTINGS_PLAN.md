# AWJ Accounting Settings — Living Plan

**Status:** ACTIVE / LIVING PLAN  
**Created:** 2026-09-06  
**Base SHA:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`  
**Scope:** Architecture and phased implementation plan only.  
**Safety:** No merge, deploy, schema change, or accounting behavior change is authorized by this document.

---

## 1. Purpose

This document is the authoritative living plan for building **إعدادات الحسابات / Accounting Settings** in AWJ ERP.

It converts the repository audit, direct code inspection, and Daftra functional-reference review into explicit AWJ decisions. It is not a copy of Daftra and it is not an implementation report.

Priorities, in order:

1. Accounting correctness and historical ledger integrity.
2. Tenant isolation and explicit branch semantics.
3. Backward compatibility.
4. Server-side enforcement for financial controls.
5. Small independently reviewable PRs.
6. AWJ-native dense accounting UX.

`LedgerService::post()` remains the exclusive posting primitive. Posted journal history must never be silently rewritten by settings changes.

---

## 2. Evidence Base

### 2.1 AWJ repository audit

The read-only architecture audit established that:

- Posting is centralized through `LedgerService::post()` and correction through `LedgerService::reverse()`.
- Current posting services resolve accounts primarily through local hardcoded `ACC_*` account-code constants.
- There is no semantic account-routing subsystem today.
- There is no fiscal-year/fiscal-period domain today.
- There is no accounting-period-lock domain today.
- Cost centers are implemented, including invoice line allocations, but purchase/inventory allocation capabilities are asymmetric.
- `App\Support\Settings` is suitable for scalar tenant policy flags, not relational accounting configuration.
- Posted journal lines already store concrete `account_id` values, providing the correct historical-freeze behavior.

### 2.2 Daftra reference review

Daftra is used only as a functional benchmark. Useful reference concepts include:

- separation of fiscal-period close from transaction-date locks;
- configurable account routing;
- per-line account/cost-center capabilities;
- prospective routing changes that do not rewrite historical postings;
- fiscal periods and closed intervals as distinct concepts.

AWJ must not copy Daftra behavior where it conflicts with AWJ's ledger architecture, perpetual-inventory design, security model, or accounting invariants.

---

## 3. Target Accounting Settings Workspace — V1

The initial workspace is limited to:

1. **الإعدادات العامة — General Accounting Settings**
2. **توجيه الحسابات — Account Routing**
3. **الفترات المالية — Fiscal Periods**
4. **قفل الفترات — Accounting Period Locks**
5. **مراكز التكلفة — Cost Centers**

Deferred from V1:

- Journal custom fields.
- Asset custom fields.
- Physical asset locations/stores.
- Multi-currency/exchange-rate implementation.
- Generic cross-domain audit framework.
- Inventory warehouses inside Accounting Settings; warehouses remain under Products & Inventory.

The General page must expose only policies the backend genuinely enforces. No decorative or non-functional toggles.

---

## 4. Account Routing Architecture Contract — V1

### 4.1 Semantic role is the accounting identity

Application code must move toward semantic roles such as `sales_revenue` and `inventory_asset`, not account codes such as `4110` or `1140` as permanent application identities.

### 4.2 Static catalog + relational mapping

Accounting roles are a static code catalog, conceptually similar to `ApplicationCatalog`.

There is **no `accounting_roles` tenant table** in V1.

Tenant choices belong in a relational mapping table conceptually shaped as:

`Tenant + Role Key -> Account ID`

Branch semantics are not assumed by this line and must be decided separately before branch overrides are implemented.

### 4.3 Transitional resolution rules

For an existing tenant during migration:

1. **No explicit mapping exists** -> use the existing legacy resolution/default to preserve backward compatibility.
2. **A valid explicit mapping exists** -> use the mapped account for new postings.
3. **An explicit mapping exists but is invalid, cross-tenant, missing, or disabled** -> **BLOCK POSTING** with a clear accounting-configuration error. Do not silently fall back.
4. **Historical posted journal** -> never re-resolve; stored `journal_lines.account_id` remains authoritative.

Legacy fallback is a migration bridge, not the desired permanent architecture. New tenants should eventually receive explicit default mappings as part of provisioning/setup.

### 4.4 Historical integrity

Changing account routing is prospective only.

`routing change -> future postings`

It must never imply:

`routing change -> rewrite historical journal lines`

Correction of historical accounting must use explicit accounting correction/reversal flows, not silent settings-driven mutation.

### 4.5 Required/optional roles

AWJ must not introduce a global "no accounting" switch copied from another ERP.

If a role can legitimately be optional, that must be defined per role/flow. Accounting-impacting posted documents remain subject to AWJ ledger invariants.

### 4.6 Ledger boundary

`LedgerService` should receive already-resolved account IDs. It should not become aware of sales/purchase/inventory role semantics.

Conceptually:

`Business posting rule -> Account Routing resolution -> Account ID -> LedgerService::post()`

---

## 5. Confirmed Sales Routing Contract

Direct inspection of `InvoiceService` and `InventoryService` confirms the following current meanings.

### 5.1 Confirmed semantic roles

| Role key | UI meaning | Current legacy account | Status |
|---|---|---:|---|
| `accounts_receivable` | حساب العملاء / الذمم المدينة | `1130` | CONFIRMED |
| `sales_revenue` | إيرادات المبيعات | `4110` | CONFIRMED |
| `sales_shipping_revenue` | إيرادات الشحن | `4130` | CONFIRMED |
| `sales_adjustment` | فروق وتسويات المبيعات | `5170` | UNDER_REVIEW — shared-code semantics need full audit |
| `tax_output` | ضريبة القيمة المضافة — المخرجات | `2120` | CONFIRMED |
| `cogs` | تكلفة البضاعة المباعة | `5110` | CONFIRMED; classified under Inventory Accounting |
| `inventory_asset` | المخزون | `1140` | CONFIRMED; classified under Inventory Accounting |

### 5.2 Existing product override must be preserved

AWJ already supports `products.sales_account_id`.

Therefore the transitional sales-revenue precedence is:

`Product sales_account_id override -> explicit tenant sales_revenue mapping -> legacy 4110`

A configured-but-invalid mapping is not equivalent to an absent mapping and must block posting.

### 5.3 COGS override must be preserved

AWJ already supports `products.cogs_account_id`.

Transitional precedence:

`Product cogs_account_id override -> explicit tenant cogs mapping -> legacy 5110`

### 5.4 Cash/bank is not yet a confirmed Sales role

Do not introduce `sales_cash` merely because invoice posting currently references `1110` in some paths. Payment and cash/bank resolution already have separate behavior through `PaymentService` / cash-bank accounts.

Cash/bank routing requires a dedicated flow audit before role design.

### 5.5 VAT classification

`tax_output` is a shared tax role, not a sales-specific identity such as `sales_vat`.

---

## 6. Confirmed Purchase Routing Contract

Direct inspection of `PurchaseService` confirms:

- tracked inventory purchases debit inventory (`1140`);
- non-inventory purchase lines debit general purchase/expense (`5150`);
- input VAT debits `1150`;
- payable credits `2110` for the purchase document, including cash purchases;
- immediate/partial payment is a separate `PaymentService` disbursement;
- purchase discount and inbound shipping currently modify inventory/expense cost rather than posting to independent discount/shipping accounts;
- adjustment currently uses `5170`.

### 6.1 Confirmed/under-review roles

| Role key | UI meaning | Current legacy account | Status |
|---|---|---:|---|
| `accounts_payable` | حساب الموردين / الذمم الدائنة | `2110` | CONFIRMED |
| `inventory_asset` | حساب المخزون | `1140` | CONFIRMED |
| `purchase_expense` | مصروف البنود غير المخزنية | `5150` | CONFIRMED |
| `tax_input` | ضريبة القيمة المضافة — المدخلات | `1150` | CONFIRMED |
| `purchase_adjustment` | فروق وتسويات المشتريات | `5170` | UNDER_REVIEW — determine whether role should be shared or flow-specific |

Do not create `purchase_shipping` or `purchase_discount` roles in V1 unless later code/accounting requirements prove they need independent posting identities.

---

## 7. Purchase Returns — Confirmed Findings

### 7.1 Current behavior

`ReturnService::postPurchaseReturn()` currently reverses the original purchase categories directly:

- debit payable (`2110`) for credit return, or cash (`1110`) for cash return;
- credit inventory (`1140`) for tracked goods;
- credit expense (`5150`) for non-inventory lines;
- credit input VAT (`1150`);
- tracked goods are issued from inventory.

### 7.2 `5180` is NOT the Purchase Returns account

This is a critical confirmed correction.

In the inspected current code, `5180` is defined/used as an inventory damage/variance-type account, including sales-return goods that do not return to saleable inventory and other inventory variance contexts.

Therefore:

> **Do not use or document `5180` as the semantic Purchase Returns account.**

Any prior implementation proposal that reused `5180` for Purchase Returns must be re-evaluated against the current code and accounting design before merge.

### 7.3 No `purchase_returns` role in V1 by default

AWJ currently uses perpetual-inventory reversal semantics. A tracked-goods purchase return credits the same inventory asset that the purchase debited.

A dedicated contra-purchase `purchase_returns` role must not be introduced merely because another ERP exposes one. It requires an explicit accounting use case/design decision (for example a different inventory accounting model or reporting requirement).

### 7.4 Accounting Review Flag — cash purchase return

Current purchase posting always credits Accounts Payable and treats payment as a separate settlement document. However, a purchase return with `payment_type=cash` currently debits cash directly.

This may conflate:

`Purchase Return`

with

`Supplier Refund / Settlement`.

**Status: ACCOUNTING_REVIEW_REQUIRED.**

Do not alter behavior yet. Before purchase-return routing is implemented, determine whether a cash purchase return semantically guarantees that cash was actually received at posting time, or whether supplier refund/settlement must remain a separate operation consistent with purchase settlement architecture.

---

## 8. Role Catalog — Current Working Set

The catalog must grow only from proven posting needs.

### Confirmed

- `accounts_receivable`
- `accounts_payable`
- `sales_revenue`
- `sales_shipping_revenue`
- `inventory_asset`
- `cogs`
- `purchase_expense`
- `tax_output`
- `tax_input`

### Under review

- `sales_adjustment`
- `purchase_adjustment`
- inventory variance/loss/damage role split
- cash/bank roles and their relationship to `CashBankAccount`
- opening-balance roles

### Deferred / not approved

- `purchase_returns` as an independent contra-purchase role
- generic product/category routing precedence beyond existing product overrides
- branch-specific role mappings
- fiscal-close roles such as `retained_earnings` until fiscal-close design is completed

A role represents accounting meaning, not a module. `inventory_asset`, for example, may be consumed by purchases, purchase returns, COGS flows, sales returns, openings, stocktakes, and stock movements without becoming multiple module-specific roles.

---

## 9. Inventory Routing — NEXT / UNDER REVIEW

The next code-audit slice must inspect at minimum:

- `InventoryService`
- `InventoryOpeningService`
- `StocktakeService`
- `StockPermitService`
- relevant sales-return inventory behavior

It must determine whether the current use of account `5180` conflates distinct semantic meanings that should be separately configurable:

- inventory variance gain;
- inventory variance loss;
- damage/write-off;
- non-saleable returned goods;
- other inventory adjustments.

It must also confirm the semantic role of opening-balance account `3130` and whether that role belongs to inventory routing or a broader opening-balances/fiscal domain.

No inventory-routing implementation begins until this section is resolved and updated.

---

## 10. General Accounting Settings

V1 must be intentionally smaller than Daftra where AWJ lacks corresponding backend behavior.

Do not expose:

- exchange-rate controls before real multi-currency exists;
- tax-on-journal-line controls when AWJ's VAT model is separate VAT posting lines;
- per-line account toggles before the corresponding posting flow supports them end-to-end;
- any switch whose server-side behavior is absent.

Cost-center policies may be surfaced only to the extent supported by the current CostCenter/journal/allocation implementation.

---

## 11. Cost Centers

Reuse existing implementation. Do not rebuild Cost Centers as part of Accounting Settings.

Current state:

- CostCenter entity exists.
- `journal_lines.cost_center_id` exists.
- purchases have header-level cost center.
- invoice line percentage/amount/basis-point allocations exist.
- purchase line allocation is not equivalent to the invoice implementation today.
- inventory line allocation is absent.

The Accounting Settings workspace may link to existing Cost Center management. Purchase-line allocation, if approved, is a separate functional PR rather than a prerequisite for the settings hub.

---

## 12. Accounting Period Locks

Confirmed absent in current AWJ.

Required architectural principles:

- server-side enforcement;
- UI is never the security/accounting boundary;
- effective accounting date is checked for every relevant financial mutation path;
- API/POS/import paths cannot bypass the lock;
- reversal/correction semantics must be explicit;
- original historical date being locked must not necessarily prevent a correcting reversal posted to a valid unlocked date.

### Branch semantics

**UNRESOLVED.**

Do not assume tenant-wide or branch-specific locks merely for implementation convenience. Decide from AWJ accounting requirements and branch architecture before schema design.

---

## 13. Fiscal Periods and Closing

Confirmed absent in current AWJ.

Fiscal Period Close and Accounting Period Lock are distinct domains.

Do not implement fiscal closing from a simplified formula in the architecture audit. A separate accounting design/audit is required before implementation, covering at minimum:

- fiscal year vs fiscal sub-periods;
- P&L closing mechanism;
- whether an income-summary intermediary is used;
- retained earnings;
- opening balances for the next period/year;
- generated closing journal structure;
- reopen by reversal/correction;
- re-close after changes;
- interaction with period locks;
- branch semantics;
- audit trail and concurrency/idempotency.

### Branch semantics

**UNRESOLVED.**

Fiscal periods must not be declared `CompanyWide` solely because that is simpler to implement.

---

## 14. Account Routing Branch Semantics

**UNRESOLVED for V1.**

Tenant-default routing is the initial conceptual baseline, but whether branch overrides are required must be decided independently from fiscal-period and lock branch semantics.

Do not assume all three domains share the same branch policy.

---

## 15. Audit and Permissions

Accounting-settings changes that can affect future financial postings require explicit permissions and an audit trail.

Initial permission direction:

- `accounting_settings.view`
- `accounting_settings.manage`

Exact naming must be checked against repository RBAC conventions during implementation.

Audit-worthy operations include at minimum:

- account-routing mapping create/change/remove;
- period-lock create/remove;
- fiscal close/reopen;
- future high-impact accounting policy changes.

A generic cross-domain audit framework is not a prerequisite. Follow existing domain event/audit patterns unless a separate generic-audit initiative is approved.

---

## 16. Updated PR Sequence

No PR below is authorized for merge/deploy merely by appearing in this plan.

### ACC-1 — Accounting Settings Foundation + Workspace + RBAC

- `/accounting-settings` hub.
- accounting sidebar leaf.
- real permissions from the start; no temporary permission model.
- cards only for real/planned capabilities.
- Cost Centers can link to the existing page.
- no accounting behavior change.

### ACC-2 — Semantic Accounting Roles + Mapping Foundation

- static role catalog;
- relational tenant mapping table;
- resolver;
- validation and cross-tenant protection;
- audit trail for mapping changes;
- no posting flow consumes the resolver yet;
- define invalid-mapping fail-closed behavior.

### ACC-3 — Sales Routing Vertical Slice

- consume confirmed sales roles only;
- preserve `products.sales_account_id` precedence;
- preserve historical journals;
- no-mapping tenants must produce legacy-equivalent journals.

### ACC-4 — Purchases + Purchase Returns Routing

- consume confirmed purchase/shared roles;
- resolve the cash-purchase-return accounting review flag before implementation;
- do not introduce a dedicated `purchase_returns` role without explicit approval;
- do not repurpose `5180`.

### ACC-5 — Inventory / COGS Routing

- implement only after §9 is completed;
- determine variance/damage role split first;
- preserve `products.cogs_account_id` precedence.

### ACC-6 — Accounting Period Lock — Design + Implementation

- complete branch-semantics decision first;
- central server-side guard;
- comprehensive Web/API/POS/import coverage;
- explicit reversal behavior;
- concurrency tests.

### Fiscal Periods / Closing

Not yet assigned a single implementation PR. First produce a dedicated accounting design/audit, then split implementation into small PRs (CRUD/domain foundation, close, reopen, integration) as justified by that design.

### Optional later work

- purchase-line cost-center allocation;
- custom journal fields;
- asset settings;
- multi-currency;
- branch-specific account-routing overrides if approved.

---

## 17. Mandatory Test Invariants for Routing

When routing implementation starts, tests must explicitly cover:

1. No mapping -> legacy-equivalent posting.
2. Valid explicit mapping -> new posting uses mapped account.
3. Explicit mapping to cross-tenant account -> rejected.
4. Explicit mapping to disabled/invalid account -> posting blocked; no silent fallback.
5. Mapping changed after posting -> historical journal account IDs unchanged.
6. Existing product sales-account override still wins where currently supported.
7. Existing product COGS override still wins where currently supported.
8. Ledger remains balanced and `LedgerService` invariants remain unchanged.
9. Tenant isolation.
10. Branch isolation/semantics once branch routing is approved.

Financial/security tests must never be weakened to make a routing PR pass.

---

## 18. Decisions Log

### DEC-ACC-001 — Semantic roles, not account codes
**Status:** ACCEPTED  
Account codes such as `4110`, `1140`, `5180` are legacy implementation defaults, not permanent application identities.

### DEC-ACC-002 — Static role catalog + relational mappings
**Status:** ACCEPTED  
Role definitions live in code; tenant selections live in relational rows.

### DEC-ACC-003 — Legacy fallback only when mapping is absent
**Status:** ACCEPTED  
An absent mapping may use the current legacy default during migration. An explicit but invalid/disabled mapping blocks posting.

### DEC-ACC-004 — Routing changes are prospective
**Status:** ACCEPTED  
Historical posted `journal_lines.account_id` values are never re-resolved because a setting changes.

### DEC-ACC-005 — Preserve existing product overrides
**Status:** ACCEPTED  
Existing `products.sales_account_id` and `products.cogs_account_id` remain higher-precedence explicit overrides until separately redesigned.

### DEC-ACC-006 — `5180` is not Purchase Returns
**Status:** ACCEPTED  
Current repository evidence identifies `5180` with inventory damage/variance semantics, not a purchase-return contra account.

### DEC-ACC-007 — No dedicated Purchase Returns role by imitation
**Status:** ACCEPTED  
A `purchase_returns` role requires a proven AWJ accounting need; perpetual-inventory purchase returns currently reverse inventory/expense/input VAT directly.

### DEC-ACC-008 — Fiscal close and transaction lock are separate
**Status:** ACCEPTED  
They require separate domain models and enforcement semantics.

### DEC-ACC-009 — Branch semantics are explicit decisions
**Status:** ACCEPTED  
Routing, locks, and fiscal periods must each decide branch behavior independently; none is assumed CompanyWide merely for convenience.

### DEC-ACC-010 — General Settings exposes only real backend behavior
**Status:** ACCEPTED  
No non-functional toggles, speculative exchange-rate controls, or incompatible journal-tax options.

---

## 19. Open Decisions / Do Not Implement Yet

Do not implement until explicitly resolved:

- inventory variance vs damage vs write-off role separation;
- semantic meaning and routing of `5170` across flows;
- cash/bank routing model;
- cash purchase-return vs supplier-refund settlement behavior;
- branch-specific account-routing policy;
- period-lock branch policy;
- fiscal-period branch policy;
- fiscal close mechanics;
- generic product/category routing beyond current product overrides;
- independent Purchase Returns contra account;
- multi-currency.

---

## 20. Immediate Next Step

Continue the read-only **Inventory Routing Contract** audit and update this living plan with confirmed findings before authorizing ACC-1/ACC-2 implementation work.

Files to inspect next include `InventoryService`, `InventoryOpeningService`, `StocktakeService`, `StockPermitService`, and sales-return inventory accounting paths.
