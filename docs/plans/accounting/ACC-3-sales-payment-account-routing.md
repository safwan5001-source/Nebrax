# ACC-3 — Sales + Payment Counterparty Account Routing

**Status:** PREPARED — execute only after ACC-2 review/merge  
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`  
**Risk:** High accounting correctness.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Adopt the ACC-2 semantic resolver in the first controlled posting vertical slice: Sales Invoice posting and Payment counterparty accounts, while preserving all journal directions, amounts, dimensions, product overrides, CashBankAccount policy and historical immutability.

## Approved roles consumed
- `accounts_receivable` (legacy 1130)
- `sales_revenue` (legacy 4110)
- `sales_shipping_revenue` (legacy 4130)
- `document_adjustment` (legacy 5170)
- `tax_output` (legacy 2120)
- `cogs` (legacy 5110)
- `inventory_asset` (legacy 1140)
- `accounts_payable` (legacy 2110) only in PaymentService supplier-payment counterparty path.

## Invoice routing contract
Preserve existing journal economics exactly.

### Receivable
Credit-sale debit account becomes semantic `accounts_receivable` instead of fixed 1130.

### Sales revenue precedence
For each product line:
`product.sales_account_id -> tenant sales_revenue mapping -> legacy 4110`.

Existing valid product override stays higher precedence than tenant default. Do not erase or migrate product overrides.

### Shipping
Shipping revenue resolves `sales_shipping_revenue` -> legacy 4130 when unmapped.

### VAT output
VAT output resolves `tax_output` -> legacy 2120 when unmapped. Do not change VAT calculation or tax timing.

### Document adjustment
Header adjustment resolves shared `document_adjustment` -> legacy 5170. Preserve signs exactly:
- positive sales adjustment = credit;
- negative sales adjustment = debit.
It remains non-taxable and retains current cost-center behavior.

## COGS / inventory side of sale
Sales posting triggers InventoryService COGS journal. In this ACC-3 slice, route only the sale-consumed inventory roles required for end-to-end semantic adoption:

COGS precedence:
`product.cogs_account_id -> tenant cogs mapping -> legacy 5110`.

Inventory credit:
`inventory_asset -> legacy 1140`.

Do not change stock valuation, quantities, warehouse/branch dimensions, journal grouping or product override semantics.

## Cash sale boundary
Do not invent `cash_account` role. If the existing Invoice cash-sale path still uses a stored/selected cash account contract that is not CashBankAccount-safe, do not broaden ACC-3 to redesign it. Preserve existing behavior unless a previously approved CashBankAccount resolver integration already exists on the execution baseline. Report any mismatch rather than silently changing financial settlement architecture.

## PaymentService boundary
Replace only hardcoded counterparty control accounts:
- customer receipt: Cr `accounts_receivable`;
- supplier payment: Dr `accounts_payable`.

Cash/Bank side MUST continue through `CashBankAccountService::resolveForPayment()` (or execution-baseline equivalent) and its deposit/withdraw/branch rules.

Do not change `Payment.direction`, allocation semantics, `paid_amount`, payment status, numbering or voucher templates.

## Historical integrity
Changing a mapping affects only new postings after the change. Existing posted JournalLine account IDs remain frozen. Reversal behavior must continue to reverse original concrete journal entries, not re-resolve current mappings.

## Fail-closed behavior
If a tenant has an explicit invalid/disabled mapping for any role consumed by a posting, block the posting with a clear domain validation error. Never fall back secretly to legacy account in that case.

Unmapped role remains legacy-equivalent.

## Cost-center / Partner / Branch invariants
Routing changes account ID only. Preserve all existing:
- Partner dimensions;
- invoice line cost-center allocations and header fallback;
- branch IDs;
- descriptions/references;
- debit/credit amounts and balance;
- journal count/order where tests depend on it.

## Explicitly out of scope
Do NOT:
- alter PurchaseService or Purchase Return behavior;
- implement Supplier Refund;
- add cash/bank semantic roles;
- redesign cash-sale settlement;
- add branch-specific role mappings;
- alter tax calculations;
- change LedgerService;
- change product override schema;
- rewrite historical journals;
- refactor unrelated accounting services;
- merge/deploy.

## Required tests
For every adopted role, test both unmapped and mapped states.

Must include:
1. unmapped invoice produces legacy-equivalent accounts and amounts.
2. mapped AR used on new credit invoice.
3. mapped sales revenue used when no product override.
4. product sales override wins over tenant mapping.
5. mapped shipping revenue used.
6. mapped tax output used with unchanged VAT amount.
7. mapped document adjustment preserves positive/negative direction and non-tax treatment.
8. mapped COGS used when no product override.
9. product COGS override wins.
10. mapped inventory asset used on sale COGS credit.
11. line cost-center allocation unchanged.
12. branch and Partner dimensions unchanged.
13. invalid explicit mapping blocks posting; no journal partially created.
14. transaction rollback preserves stock/accounting consistency on routing failure.
15. mapping change does not mutate old journals.
16. reversal of old/new invoice reverses original concrete accounts rather than current mapping.
17. customer receipt uses mapped AR and selected CashBankAccount.
18. supplier payment uses mapped AP and selected CashBankAccount.
19. CashBankAccount inactive/wrong-type/deposit-withdraw restrictions still fail as before.
20. Payment allocations/payment status unchanged.
21. tenant isolation: tenant A mapping cannot affect tenant B posting.
22. relevant SQLite and PostgreSQL suites pass.
23. frontend regression only if UI touched; otherwise do not expand scope.

## Acceptance criteria
- Approved services consume resolver only at documented boundaries.
- Legacy behavior is exact when no mapping exists.
- Explicit mapping changes only future account IDs.
- Product overrides retain precedence.
- CashBankAccount resolver is never bypassed.
- No Purchase/Purchase Return behavior changed.
- Accounting, tenant isolation and rollback tests pass.
- no merge/deploy.

## Implementation report contract
MD report: status, exact changed files, before/after journal examples, role-by-role adoption, tests/results SQLite/PostgreSQL, tenant-isolation evidence, rollback/fail-closed evidence, CashBankAccount preservation, historical/reversal evidence, Branch/PR/Base SHA/Head SHA, risks/remaining, no merge/no deploy, next step.

## Stop conditions
STOP if cash-sale routing requires a settlement redesign, if reversal currently re-resolves accounts instead of reversing original entries, or if adopting a role would require changing accounting amounts/tax/stock behavior.

## Final instruction
ACC-3 is an account-resolution change only. Preserve accounting economics exactly.