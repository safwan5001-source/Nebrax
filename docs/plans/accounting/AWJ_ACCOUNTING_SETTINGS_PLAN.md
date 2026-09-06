# AWJ Accounting Settings — Living Plan

**Status:** ACTIVE / EXECUTION PLAN READY  
**Updated:** 2026-09-06  
**Safety:** No implementation, merge or deploy is authorized by this document.

## Purpose
Authoritative execution map for Accounting Settings in AWJ ERP. Detailed contracts live in the dedicated task/design documents; this file intentionally stays compact to prevent duplicated/stale requirements.

## Non-negotiable principles
- Accounting correctness, tenant isolation, security and immutable posted history first.
- `LedgerService` remains the accounting posting/reversal core.
- Semantic roles resolve to concrete accounts before Ledger posting.
- Cash/Bank continues through its domain-specific resolver.
- Fiscal Close and Accounting Period Locks are separate controls.
- Saudi compliance is a first-class guardrail: ZATCA/VAT/e-invoicing records are never silently rewritten by accounting close/reopen.
- Current/test historical data is disposable if Safwan explicitly approves a reset; this is not automatic deletion permission.

## Confirmed Account Routing V1
Static semantic catalog + CompanyWide tenant mappings. Explicit invalid mapping fails closed. Existing product sales/COGS overrides keep precedence. Cash/bank/payment-method accounts are not generic Accounting Roles.

Core roles:
`accounts_receivable`, `accounts_payable`, `sales_revenue`, `sales_shipping_revenue`, `document_adjustment`, `inventory_asset`, `cogs`, `purchase_expense`, `tax_output`, `tax_input`, `inventory_count_variance`, `inventory_manual_adjustment`, `inventory_damage_loss`.

Fiscal implementation additionally requires `retained_earnings` (legacy default 3120). `opening_balances` 3130 is true opening/cutover equity and is not annual retained earnings.

## Purchase Return / Supplier Refund
Target principle: `Purchase != Supplier Payment` and `Purchase Return != Supplier Refund`.

New Purchase Return target is commercial reversal through AP; Supplier Refund is a dedicated branch-scoped financial document that debits selected CashBankAccount and credits AP, with dedicated allocations to posted purchase returns, row-lock/concurrency protection and Ledger reversal lifecycle.

Detailed resolved contract: `GATE-ACC-RET-1-purchase-return-supplier-refund.md`.
Prepared implementation task: `ACC-RET-1-purchase-return-cutover-supplier-refund.md`.

## Accounting Period Locks — RESOLVED
V1 is CompanyWide, inclusive bounded date ranges, server authoritative, with a dedicated AccountingDateGuard enforced finally by Ledger `post()` and `reverse()`. Drafts remain editable; posting/reversal into locked dates is blocked. No per-transaction admin bypass. Release/re-lock is explicit and audited. Tenant-level serialization must prevent lock/post races.

Detailed contract: `ACC-6-accounting-period-lock-design.md`.

## Fiscal Year Close — RESOLVED
V1 uses CompanyWide FiscalYear, not monthly FiscalPeriod rows. Directly close revenue/expense into semantic `retained_earnings`; no Income Summary V1 and no annual balance-sheet carry-forward journals. 3130 is not used.

Fiscal-close journals remain real ledger entries visible in Trial Balance/General Ledger. Historical Income Statement excludes fiscal-close journals so closed-year P&L remains visible. Balance Sheet synthetic net income includes only unclosed P&L after the latest closed fiscal boundary, preventing double counting with Retained Earnings.

Reopen reverses the exact close generation under a privileged audited workflow; correction and re-close create a new generation. Fiscal Close integrates with ACC-6 serialization/locking without exposing a generic Ledger bypass.

Saudi compliance/readiness is part of the design: fiscal close does not imply VAT-period closure, VAT-return amendment or ZATCA document mutation. Readiness uses BLOCKER/WARNING/INFO and must not claim authoritative ZATCA status unless AWJ has authoritative integration data.

Detailed contract: `FISCAL-1-fiscal-period-close-design.md`.

## Execution sequence
1. **ACC-1 — Accounting Settings Foundation**  
   RBAC `accounting_settings.view/manage`, `/accounting-settings` hub, Accounting sidebar leaf, i18n/tests. No accounting behavior.

2. **ACC-2 — Semantic Account Routing Foundation**  
   Static catalog, tenant mappings, resolver, validation, audit/API/UI. Before execution explicitly choose migration strategy: transitional legacy fallback vs clean seeded cutover, because current historical data is experimental/disposable. No posting consumer in ACC-2.

3. **ACC-3 — Sales + Payment Counterparty Routing**  
   Sales/shared semantic roles; product overrides preserved; CashBank remains authoritative.

4. **ACC-RET-1 — Purchase Return Cutover + Supplier Refund**  
   Requires ACC-2. Remove direct cash purchase-return target for new behavior; dedicated Supplier Refund domain.

5. **ACC-4 — Purchase Routing**  
   Starts only after ACC-RET-1 is complete and reviewed.

6. **ACC-5 — Inventory / COGS Routing**  
   Adopt inventory roles while preserving stock/GL atomicity and product COGS override.

7. **ACC-6 — Accounting Period Locks Implementation**  
   Implement resolved company-wide guard/lock contract. Before coding perform only narrow current-main writer/timezone/concurrency-anchor checks.

8. **FISCAL-2 — Fiscal Year Close Implementation Task**  
   Prepare/execute only after ACC-2 retained-earnings routing and ACC-6 guard/serialization are available. Must include report changes and Saudi compliance/readiness tests. Freeze zero-activity close persistence before coding.

## Dependency graph
`ACC-1 -> ACC-2 -> ACC-3`

`ACC-2 -> ACC-RET-1 -> ACC-4`

`ACC-2 -> ACC-5`

`ACC-6` depends on the stable Ledger/current-main posting inventory, not on purchase-routing completion.

`ACC-2(retained_earnings) + ACC-6 -> FISCAL-2`.

## Prepared documents
- `ACC-1-accounting-settings-foundation.md`
- `ACC-2-semantic-account-routing-foundation.md`
- `ACC-3-sales-payment-account-routing.md`
- `GATE-ACC-RET-1-purchase-return-supplier-refund.md`
- `ACC-RET-1-purchase-return-cutover-supplier-refund.md`
- `ACC-4-purchase-account-routing.md`
- `ACC-5-inventory-cogs-account-routing.md`
- `ACC-6-accounting-period-lock-design.md`
- `FISCAL-1-fiscal-period-close-design.md`

## Implementation reporting contract
Every Claude Code/Cursor execution must return MD containing: scope completed, changed files, tests/results, build/CI, accounting/security/tenant-isolation risks, remaining work, Branch/PR/Base SHA/Head SHA when available, and recommended next step. No merge/deploy without Safwan's explicit approval.

## Immediate next action
Prepare the focused **ACC-1 execution handoff** against latest main. Do not execute until Safwan authorizes implementation. In parallel no further architecture audit is required unless current main materially changes a contract.