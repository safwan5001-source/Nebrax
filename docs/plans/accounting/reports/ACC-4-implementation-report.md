# ACC-4 — Purchase & Purchase Return Account Routing — Implementation Report

**Status:** DONE
**Task doc:** `docs/plans/accounting/ACC-4-purchase-account-routing.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Dependency:** ACC-2 (merged) + `GATE-ACC-RET-1`/ACC-RET-1 (merged, `a19c42a`)

## Summary

Adopted `AccountRoleResolver` in `PurchaseService::post()` and in the mirrored credit lines of
`ReturnService::postPurchaseReturn()` (whose debit side — `accounts_payable` — was already routed in
ACC-RET-1). All five roles the doc approves (`accounts_payable`, `inventory_asset`, `purchase_expense`,
`tax_input`, `document_adjustment`) now resolve through the semantic layer instead of hardcoded `ACC_*`
constants.

This closes exactly the asymmetry the ACC-RET-1 report flagged as a deliberate, reported boundary: **a
purchase and its return now always agree on the tenant's current mapping.** Before this PR, a tenant who
remapped `inventory_asset` would see their purchase receipts land on the new account while purchase
returns kept crediting hardcoded `1140` — a real, silent disagreement between two postings this task
existed specifically to close.

`LedgerService` was not modified and remains role-agnostic. `SupplierRefundService`/`SupplierRefund` were
not touched at all. No amount, VAT, discount/shipping cost-basis allocation, rounding, or debit/credit
direction changed anywhere — every edit in this PR swaps only an `account_id` source.

## Baseline check

Verified `origin/main` head is `a19c42a02570173d25b5abaf48cf4263c71e48ef`, the ACC-RET-1 merge commit,
before branching. No commits landed between that merge and this task's start.

## Roles adopted and their consumers

| Role | Consumer(s) | Legacy default |
|---|---|---|
| `inventory_asset` | `PurchaseService::post()` debit (tracked lines) **and** `ReturnService::postPurchaseReturn()` credit | 1140 |
| `purchase_expense` | same pair, non-tracked lines | 5150 |
| `tax_input` | same pair, input VAT | 1150 |
| `document_adjustment` | `PurchaseService::post()` header adjustment only, sign preserved (Purchase Return has no adjustment field/line to route) | 5170 |
| `accounts_payable` | `PurchaseService::post()` credit (newly routed here); Return-side debit already routed since ACC-RET-1 | 2110 |

Per the doc, shipping/discount receive no separate role in V1 — they are allocated proportionally into the
inventory/expense cost basis *before* those totals resolve to `inventory_asset`/`purchase_expense`
(`PurchaseService::allocate()`, unchanged).

## Deliberate boundaries carried forward, not touched

- **Purchase-return valuation-variance line (`5116`)** stays hardcoded via the existing `accountId()`
  helper still present in `ReturnService` for `postSalesReturn()`. It is not one of ACC-4's five approved
  roles — the doc is explicit: *"No dedicated `purchase_returns` semantic account is approved in V1."*
- **`postSalesReturn()`** (sales-return inventory debit/COGS reversal, hardcoded `1140`/`5110`/`5180`) is
  **untouched**. ACC-4's objective explicitly scopes to "Purchase and Purchase Return posting only" —
  adopting `inventory_asset` there too would be scope creep into a sales-side path ACC-3 never covered
  either.
- **`InventoryService::receiveStock()`/`recordOpeningStock()`** (used only by `ProductService::create()`'s
  "initial quantity" shortcut, never by `PurchaseService`) remain hardcoded, exactly as already noted "out
  of ACC-3 scope" in that file — `PurchaseService::post()` calls `applyReceipt()` directly (pure
  stock/avg-cost update, no journal of its own), so this path was never in scope here either.

## Before / after journal examples

**Tracked purchase, unmapped tenant (byte-identical before/after):**
```
Dr  1140 Inventory Asset     10,000
Dr  1150 Input VAT            1,500
Cr  2110 Accounts Payable    11,500   (partner: supplier)
```

**Same purchase, tenant with `inventory_asset → custom 1148`, `accounts_payable → custom 2119`:**
```
Dr  1148 (inventory_asset mapping)     10,000
Dr  1150 Input VAT                      1,500
Cr  2119 (accounts_payable mapping)    11,500   (partner: supplier)
```

**Purchase return of part of that same purchase, same tenant — now symmetric:**
```
Dr  2119 (accounts_payable mapping)     4,600
Cr  1148 (inventory_asset mapping)      4,000   ← same custom account the receipt used
Cr  1150 Input VAT                        600
```

Before this PR, that return's inventory credit would have posted to hardcoded `1140` while the receipt
used `1148` — the exact disagreement closed here (test:
`a_custom_inventory_asset_mapping_is_used_identically_by_purchase_and_its_return`).

**Non-tracked purchase with a positive header adjustment, mapped `document_adjustment`:**
```
Dr  <mapped purchase_expense>   10,000
Dr  <mapped document_adjustment>   500
Cr  <mapped accounts_payable>   10,500
```
A negative adjustment credits the same mapped account instead (sign preserved, tested both ways).

## Changed files

| File | Why |
|---|---|
| `app/Services/Accounting/PurchaseService.php` | `post()`'s five account sources (`inventory_asset`, `purchase_expense`, `tax_input`, `document_adjustment` ×2 branches, `accounts_payable`) now call `AccountRoleResolver::resolve()`. `ACC_INVENTORY`/`ACC_INPUT_VAT`/`ACC_EXPENSE`/`ACC_PAYABLE`/`ACC_ADJUSTMENT` constants and the now-fully-dead `accountId()` helper removed, along with the now-unused `use App\Models\Account;` import. |
| `app/Services/Accounting/ReturnService.php` | `postPurchaseReturn()`'s three credit lines (`inventory_asset`, `purchase_expense`, `tax_input`) now call the resolver, mirroring `PurchaseService`. `ACC_INPUT_VAT`, `ACC_EXPENSE`, and the already-dead `ACC_PAYABLE` (leftover from ACC-RET-1, never actually referenced) removed. `ACC_INVENTORY` **kept** — still used by `postSalesReturn()`'s restock branch, out of ACC-4's scope. Docblocks updated to describe the routed roles and the purchase/return symmetry invariant. |
| `tests/Feature/PurchaseAccountRoutingTest.php` (new) | 18 tests, listed below. |

No migration, no schema change, no frontend file touched (Purchase/Purchase Return posting exposes no
account-selection UI to migrate).

## Tests run and results

**New — `PurchaseAccountRoutingTest`, 18 tests / 52 assertions (SQLite + PostgreSQL):**

1. `an_unmapped_tracked_purchase_matches_legacy_accounts_exactly`
2. `an_unmapped_non_tracked_purchase_matches_legacy_expense_account`
3. `a_mapped_accounts_payable_is_used_with_unchanged_amount_and_partner_dimension`
4. `a_mapped_inventory_asset_is_used_when_the_product_is_tracked`
5. `a_mapped_purchase_expense_is_used_for_non_tracked_lines`
6. `a_mapped_tax_input_is_used_with_the_vat_amount_unchanged`
7. `a_mapped_document_adjustment_preserves_the_sign_for_a_positive_and_negative_value`
8. `tracked_and_non_tracked_lines_split_correctly_regardless_of_mapping`
9. `stock_quantity_and_average_cost_are_unaffected_by_account_mapping`
10. `an_invalid_inventory_asset_mapping_blocks_posting_with_no_partial_effect` — zero journals created,
    purchase stays `draft`, stock quantity/avg_cost untouched.
11. `an_invalid_accounts_payable_mapping_blocks_purchase_return_posting` — same guarantee on the return side.
12. **`a_custom_inventory_asset_mapping_is_used_identically_by_purchase_and_its_return`** — the core ACC-4
    symmetry test.
13. `purchase_expense_and_tax_input_mappings_are_shared_between_purchase_and_return`
14. `purchase_return_still_never_moves_cash_after_routing` — reconfirms the ACC-RET-1 invariant survives.
15. `tenant_a_custom_mapping_does_not_affect_tenant_b_purchase_posting`
16. `remapping_after_posting_never_changes_a_previously_posted_purchase_journal`
17. `reversing_a_posted_purchase_journal_uses_the_original_account_not_the_current_mapping` — via
    `LedgerService::reverse()` directly, same pattern as the ACC-3 report.
18. `resolver_has_no_disabled_purchase_specific_fallback_and_fails_closed_on_a_missing_mapping`

**Targeted regression (SQLite + PostgreSQL, all passing, 296 total on SQLite / 128 on the focused
PostgreSQL pass):** `PurchaseTest`, `PurchasePaidOnPostTest`, `PurchaseEditDeleteTest`,
`PurchaseDiscountShippingTest`, `PurchaseReportTest`, `PurchaseWithProductTest`, `PurchaseSettingsTest`,
`ReturnTest`, `ReturnFromSourceTest`, `ReturnRestockPolicyTest`, `PurchaseReturnUomValuationTest`,
`SupplierRefundTest`, `SupplierPaymentTest`, `PaymentTest`, `LedgerTest`, `AccountRoutingTest`,
`SalesPaymentAccountRoutingTest`, `AccountingSettingsRbacTest`, `RoleTest`, `ApiRbacTest`.

**Full backend suite — SQLite:** first run showed **26 failed** (one more than the documented 25-failure
`bcmath` baseline) — the extra failure, `ZatcaQrCertificateMaterialExtractorTest`, passed standalone
(3/3, 0.11s) and the **full suite was re-run in full and came back at exactly 25 failed, 2600 passed**,
confirming it was order-dependent flakiness unrelated to this diff (no file this PR touches has any
relation to ZATCA certificate parsing), not a regression.

**Full backend suite — PostgreSQL 16:** 2601 passed, **25 failed** (18246 assertions, 625s). Same
pre-existing `Fuel*Test` `bcmath`-extension failures documented in every ACC-1→ACC-RET-1 report, identical
count to the pre-ACC-4 baseline.

## Tenant isolation

`tenant_a_custom_mapping_does_not_affect_tenant_b_purchase_posting`: tenant A maps `accounts_payable` to a
custom account; a fresh tenant B posts a purchase and its journal uses B's own legacy `2110`, never A's
custom account — and `Account::find($customA->id)` returns `null` once the active tenant context switches
to B, confirming the custom account isn't merely unused but genuinely invisible under `TenantScope`. No
new cross-tenant query was introduced anywhere in this PR; every resolution goes through the existing
`AccountRoleResolver`/`TenantScope` machinery unchanged.

## Confirmed unchanged

- `LedgerService`: not modified, remains role-agnostic.
- `PaymentService` settlement semantics (the `settle()` call inside `PurchaseService::post()`): untouched.
- `SupplierRefundService`/`SupplierRefund`: not touched at all.
- Amounts, VAT computation, discount/shipping cost-basis allocation (`allocate()`), rounding, and
  debit/credit direction: unchanged everywhere.
- Purchase Return still never touches cash/bank (re-tested explicitly here, not just inherited from
  ACC-RET-1).
- Historical `journal_lines.account_id` values are immutable; remapping affects only future postings
  (tested); `LedgerService::reverse()` reverses the original concrete account, never re-resolved (tested).
- No branch-specific mapping, no fiscal/period-lock work, no valuation redesign.
- ACC-5 and Fiscal/Period Locks were **not** started.

## Risks and remaining work

- **Risk: low-medium.** Narrow, mechanical account-source swap on two already-covered, well-tested
  posting paths. 18 new targeted tests plus the full pre-existing regression suite passing unchanged on
  both engines back it.
- Removed now-dead `accountId()` helpers and their `ACC_*` constants in both services (zero remaining
  callers after routing) — pure cleanup with no behavior change, verified by grep before removal.
- One transient CI-style flake was observed and diagnosed (see above) — not from this diff, not
  actioned further per the task's own "targeted regression first, broader as needed" instruction; noted
  here for visibility only.
- **Remaining:** ACC-5 (Inventory/COGS Routing) is next per the parent plan's dependency graph
  (`ACC-2 -> ACC-5`, independent of the return-cutover chain). Not started, per this task's explicit
  instruction.

## Branch / PR / SHAs

- Branch: `claude/acc-4-purchase-account-routing`
- PR: https://github.com/safwan5001-source/Nebrax/pull/685
- Base SHA (`origin/main`, contains the ACC-RET-1 merge): `a19c42a02570173d25b5abaf48cf4263c71e48ef`
- Head SHA: `fbc2c8b267fc432d8083129cf9f2513429b5379b`

**No merge, no deploy performed. No data reset or deleted.**

## Recommended next step

Review PR #685 in isolation. Once approved and merged by Safwan, ACC-5 (Inventory/COGS Routing) can begin
per the parent plan's execution sequence.
