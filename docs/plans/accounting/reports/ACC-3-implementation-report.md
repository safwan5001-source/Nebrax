# ACC-3 — Sales + Payment Counterparty Account Routing — Implementation Report

**Status:** DONE
**Task doc:** `docs/plans/accounting/ACC-3-sales-payment-account-routing.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Dependency:** ACC-2 (merged, `9957cf5`)

## Summary

Adopted `AccountRoleResolver` (built, unused, in ACC-2) in the first real posting consumers:
`InvoiceService::post()`, `InventoryService::recordSaleCogs()`, and `PaymentService::post()`.
This is an account-resolution change only — no amount, VAT, debit/credit direction, rounding,
or document-lifecycle rule changed anywhere. `LedgerService` was not touched and remains
role-agnostic, exactly as the doc requires.

## Posting consumers changed

| Service | Method | Role(s) adopted | Legacy default |
|---|---|---|---|
| `InvoiceService` | `post()` — debit line (credit sale only) | `accounts_receivable` | 1130 |
| `InvoiceService` | `post()` — `assertWithinCreditLimit()` | `accounts_receivable` (same resolved account) | 1130 |
| `InvoiceService` | `post()` — per-line revenue (no product override) | `sales_revenue` | 4110 |
| `InvoiceService` | `post()` — shipping line | `sales_shipping_revenue` | 4130 |
| `InvoiceService` | `post()` — VAT line | `tax_output` | 2120 |
| `InvoiceService` | `post()` — adjustment line | `document_adjustment` | 5170 |
| `InventoryService` | `recordSaleCogs()` — COGS debit (no product override) | `cogs` | 5110 |
| `InventoryService` | `recordSaleCogs()` — inventory credit | `inventory_asset` | 1140 |
| `PaymentService` | `post()` — customer-receipt credit | `accounts_receivable` | 1130 |
| `PaymentService` | `post()` — supplier-payment debit | `accounts_payable` (explicitly approved in the doc) | 2110 |

**Untouched by design:**
- `InvoiceService`'s cash-sale debit line (still hardcoded `1110`, see "Deliberate boundary" below).
- `InventoryService::receiveStock()` / `recordOpeningStock()` (purchase/opening-balance paths — the
  doc scopes ACC-3 to "sale-consumed inventory roles" only).
- `PaymentService`'s cash/bank side (`CashBankAccountService::resolveForPayment()`), on every path.
- `PurchaseService`, `ReturnService` — not modified at all.
- `LedgerService` — not modified at all.

## Deliberate boundary: cash-sale debit stays hardcoded

Before touching `InvoiceService`, I read its current cash-sale path: the debit line for a cash sale
is built as `$this->accountId(self::ACC_CASH)` — a direct lookup by account code, with **no**
`CashBankAccountService` involvement at all (unlike the `settle()` path used for "already paid" credit
invoices, which does go through `PaymentService`/`CashBankAccountService`). The doc anticipated exactly
this: *"If the existing Invoice cash-sale path still uses a stored/selected cash account contract that
is not CashBankAccount-safe, do not broaden ACC-3 to redesign it... Report any mismatch rather than
silently changing financial settlement architecture."*

This is confirmed to be true on current main, predating ACC-3. I left it untouched — no semantic
`cash`/`sales_cash` role was introduced (ACC-2/ACC-3 explicitly prohibit inventing a generic cash role),
and I did not redesign the settlement path. This is reported here as required rather than fixed silently.

## Necessary fix surfaced by adoption: `ChartOfAccountsSeeder` now seeds default mappings too

Turning the resolver into a real consumer immediately exposed a real gap: roughly 15 existing test
files construct a tenant via `Tenant::create()` + `app(ChartOfAccountsSeeder::class)->seed($id)`
directly, bypassing `AuthController::register()` entirely. Under ACC-2's Clean Seeded Cutover contract,
*every* tenant must have an explicit mapping for every role from the moment its chart of accounts
exists — but that guarantee was only wired into the registration call site, not into "seeding a chart of
accounts" as a concept. The very first regression run (58 failures, all `RuntimeException: لا يوجد تعيين
حساب صريح للدور «accounts_payable»`) surfaced this immediately.

**Fix:** `ChartOfAccountsSeeder::seed()` now calls `AccountRoleMappingSeeder::seedDefaults()` at the end
of its own `DB::transaction()`, so a chart and its default mappings are always seeded atomically,
regardless of caller. `ChartOfAccountsSeeder::seed()` had exactly one production caller
(`AuthController::register()`, grep-verified) — so this changes no real behavior, it only closes the gap
for every other caller (all of them tests, and any future one). The now-redundant explicit
`AccountRoleMappingSeeder::seedDefaults()` call inside `AuthController::register()` was removed to avoid
a harmless-but-confusing duplicate call.

I judged this in-scope and necessary rather than a stop condition: it touches no `LedgerService`,
`Purchase`/`Purchase Return`/`Supplier Refund` code, no schema, and no financial rule — it only makes an
already-approved ACC-2 guarantee actually hold everywhere a chart of accounts is created, which ACC-3's
own regression suite could not pass without it.

## Before / after journal examples

**Credit-sale invoice, unmapped tenant** (byte-identical before/after — legacy-equivalent by construction):
```
Dr  1130 Accounts Receivable   115,000
Cr  4110 Sales Revenue         100,000
Cr  2120 VAT Output             15,000
```

**Same invoice, tenant with `accounts_receivable → custom 1135`, `sales_revenue → custom 4115`:**
```
Dr  1135 (accounts_receivable mapping)   115,000
Cr  4115 (sales_revenue mapping)         100,000
Cr  2120 VAT Output                       15,000
```

**Sale of a tracked product, COGS side** (unmapped): `Dr 5110 COGS / Cr 1140 Inventory` — unchanged
whether the tenant has mapped `cogs`/`inventory_asset` or not, as long as no explicit mapping exists
(both resolve to the same defaults). With `cogs → custom 5112`: `Dr 5112 / Cr 1140` (or the mapped
`inventory_asset` account if that role is also mapped).

**Customer receipt:** `Dr Cash/Bank (CashBankAccountService, unchanged) / Cr 1130` becomes, with a
custom `accounts_receivable` mapping, `Dr Cash/Bank (unchanged) / Cr <mapped AR>`.

**Supplier payment:** `Dr 2110 / Cr Cash/Bank (unchanged)` becomes, with a custom `accounts_payable`
mapping, `Dr <mapped AP> / Cr Cash/Bank (unchanged)`.

## Changed files

| File | Why |
|---|---|
| `app/Services/Accounting/InvoiceService.php` | AR/sales/shipping/tax/adjustment resolved via `AccountRoleResolver`; credit-limit check reuses the same resolved AR account; cash-sale debit and `ACC_CASH` constant kept exactly as-is (see boundary above). |
| `app/Services/Accounting/InventoryService.php` | `recordSaleCogs()` resolves `cogs`/`inventory_asset`; `ACC_COGS` constant removed (now dead); `ACC_INVENTORY`/`ACC_PAYABLE`/`ACC_OPENING` kept for the untouched purchase/opening-balance paths. |
| `app/Services/Accounting/PaymentService.php` | Customer-receipt/supplier-payment counterparty resolved; `ACC_RECEIVABLE`/`ACC_PAYABLE` constants and the now-dead `accountId()` helper (plus its unused `Account` import) removed. |
| `app/Services/Accounting/ChartOfAccountsSeeder.php` | Seeds default account-role mappings atomically with the chart (see gap above). |
| `app/Http/Controllers/Api/AuthController.php` | Removed the now-redundant explicit `AccountRoleMappingSeeder::seedDefaults()` call and its import. |
| `tests/Feature/SalesPaymentAccountRoutingTest.php` (new) | 18 tests, listed below. |

No migration, no schema change, no `journal_lines`/`journal_entries` write path touched.

## Tests run and results

**New — `SalesPaymentAccountRoutingTest` (18 tests, both engines):**
1. Unmapped roles resolve to the exact legacy accounts.
2. Mapped `accounts_receivable` used as the debit on a new credit invoice.
3. Mapped `sales_revenue` used when the product has no override.
4. Product `sales_account_id` override wins over the tenant mapping.
5. Mapped `sales_shipping_revenue` used; VAT amount unchanged.
6. Mapped `tax_output` used; VAT amount unchanged.
7. Mapped `document_adjustment` preserves sign (both positive and negative) and stays non-taxable.
8. Mapped `cogs`/`inventory_asset` used when the product has no override.
9. Product `cogs_account_id` override wins over the tenant mapping.
10. Cost-center allocation and partner dimension unchanged by routing.
11. An invalid `sales_revenue` mapping blocks posting before any `JournalEntry` is created.
12. An invalid `cogs` mapping rolls back the already-built sales journal too (same DB transaction).
13. Remapping `sales_revenue` never mutates a previously posted invoice's journal.
14. Reversing an old invoice reverses the **original concrete account**, not the current mapping
    (re-verifies existing, untouched `LedgerService::reverse()` behavior under the new resolver-adopting
    callers).
15. Customer receipt uses the mapped receivable account and the resolved `CashBankAccountService` cash
    account.
16. Supplier payment uses the mapped payable account and the resolved cash account.
17. Partial-payment status/remaining unaffected by a custom receivable mapping.
18. A tenant's custom mapping (and its account) never affects or leaks into another tenant's posting.

**Targeted regression** (SQLite and PostgreSQL, all passed):
`InvoiceTest`, `PurchaseTest`, `ApiInvoiceTest`, `CashBankAccountTest`, `RecurringInvoiceTest`,
`InvoiceCostCenterAllocationTest`, `InvoiceInventoryApiTest`, `InvoiceLinePrecisionTest`,
`PurchasePaidOnPostTest`, `PurchaseDiscountShippingTest`, `LedgerTest`, `AccountRoutingTest`,
`AccountingSettingsRbacTest`, `RoleTest`, `ApiRbacTest`, `PaymentTest`, `SupplierPaymentTest`,
`PaymentVoucherApiTest`, `PaymentCollectionDetailsTest`, `PaymentMethodDefaultsTest`,
`PaymentDirectionFilterTest`, `ChartOfAccountsDemoTest` — 215 passed (SQLite), 162 passed (PostgreSQL,
narrower filter set re-run to save time after the first full pass).

**Full backend suite — SQLite:** `php artisan test` (no filter) → **2549 passed, 1 skipped, 25 failed**
(18099 assertions, 246s). All 25 failures are the pre-existing `Fuel*Test` `bcmul()`/`bcmath`-missing
failures already documented in the ACC-1/ACC-2 reports — identical failure set, same count as the
pre-ACC-3 baseline.

**Full backend suite — PostgreSQL 16:** same command → **2550 passed, 25 failed** (18101 assertions,
564s). Same pre-existing bcmath failures, nothing else. PostgreSQL was started fresh in this session
(reusing the `nibras`/`nibras`/`secret` database/role set up during the ACC-2 session).

**Frontend:** not touched, not run — no `web/` file was changed in this PR, per the doc's "frontend
regression only if UI touched; otherwise do not expand scope."

## Tenant isolation evidence

- `Account::whereKey()` (used throughout `AccountRoleResolver`/`AccountRoutingService`) passes through
  the existing `TenantScope` global scope, so a foreign-tenant account ID simply does not resolve —
  verified directly: `tenant_a_custom_mapping_does_not_affect_tenant_b_posting` posts under tenant B
  after tenant A mapped `sales_revenue` to a custom account, and asserts tenant B's invoice still uses
  tenant B's own default `4110` and that tenant A's custom account is invisible from tenant B's context
  (`Account::whereKey($customSales->id)->exists()` is `false` once tenant context switches).
- No cross-tenant raw/unscoped Account or mapping lookup was introduced anywhere in this PR.

## Confirmed unchanged (per the doc's explicit boundaries)

- `LedgerService`: not modified.
- `PurchaseService`, `ReturnService`: not modified — no Purchase/Purchase Return/Supplier Refund
  behavior touched.
- No DB/accounting schema change (only a new internal call inside an existing seeder method).
- No amount, VAT, rounding, or debit/credit-direction rule changed — every line of the diff changes
  *which account_id* a line targets, never *how much* or *which side*.
- Product `sales_account_id`/`cogs_account_id` override precedence preserved exactly (tested).
- Historical `JournalLine.account_id` values are immutable; remapping only affects future postings
  (tested); reversal reverses the original concrete entry, never re-resolving current mappings (tested).
- ACC-4, ACC-5, and ACC-RET-1 were **not** started.

## Risks, blockers, remaining work

- **Risk:** low-medium. This changes account selection on already-battle-tested posting paths
  (Invoice/Payment/Inventory-COGS), but the change is narrow (account_id source only), backed by 18 new
  targeted tests plus the full pre-existing regression suite passing unchanged on both engines.
- **Known, deliberate gap** (not introduced by ACC-3, not fixed here): `InvoiceService`'s cash-sale debit
  line bypasses `CashBankAccountService` entirely. Flagged per the doc's explicit instruction rather than
  silently redesigned; worth a dedicated follow-up task scoped specifically to that settlement path.
- **Remaining work:** per the parent plan's dependency graph (`ACC-2 -> ACC-RET-1 -> ACC-4`, `ACC-2 ->
  ACC-5`), ACC-RET-1 (Purchase Return Cutover + Supplier Refund) is next — not ACC-4 or ACC-5, both of
  which explicitly require ACC-RET-1 first. Not started, per this task's explicit instruction.

## Branch / PR / SHAs

- Branch: `claude/acc-3-sales-payment-account-routing`
- PR: https://github.com/safwan5001-source/Nebrax/pull/682
- Base SHA (`origin/main` at branch point, contains the ACC-2 merge `9957cf5`): `9957cf5fba68faa88cc418115800f457df2b1d09`
- Head SHA: `6212a31c597a74ca174f8d2045462eab0ab07aa2`

**No merge, no deploy performed.**

## Recommended next step

Review PR #682 in isolation. Once approved (merged by Safwan, not by this agent), begin ACC-RET-1 —
Purchase Return Cutover + Supplier Refund per the parent plan's execution sequence and its resolved
gate/prepared task documents (`GATE-ACC-RET-1-purchase-return-supplier-refund.md`,
`ACC-RET-1-purchase-return-cutover-supplier-refund.md`).
