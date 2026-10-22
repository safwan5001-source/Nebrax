# TREASURY-T2: treasury-aware cash-flow report and dashboard cash KPI

| | |
|---|---|
| Scope | Reporting correctness only. No posting, VAT, ZATCA, GL numbering, permission, provisioning or schema change. |
| Base | `origin/main` @ `9b59066ff` (includes #1611) |
| Branch | `claude/treasury-t2-cash-aware-reports` |
| Sources read | `TREASURY-BANKING-PHASE0-AUDIT.md` (sections 3, 4, 9: T2), `TREASURY-T1-IMPLEMENTATION-REPORT.md` |
| Not done | merge, deploy, data reset, production migration, tenant activation, ZATCA transmission |

## 1. Root cause

Two read paths defined "cash and bank" as the literal GL codes `1110` and `1120`:

1. `ReportService::cashFlow()`: `Account::whereIn('code', ['1110', '1120'])`.
2. The dashboard KPI (`web/src/app/(app)/dashboard/page.tsx`): `balanceOf('1110') + balanceOf('1120')` over the `/accounts` list.

Every treasury created through the Treasuries & Banks module gets its own GL account (`1111`, `1112`, ... under group 111; `1121`, ... under group 112), so those accounts were invisible to both. A transfer between a legacy and a new account was also wrong: the legacy leg counted as a real inflow or outflow because the other leg was outside the set, inflating gross flows and distorting the net.

## 2. Fix

| File | Change |
|---|---|
| `app/Services/Reporting/CashAccountResolver.php` (new) | Tenant-scoped set of "cash and bank" GL accounts = accounts linked to `CashBankAccount` entities (active **and inactive**, so history survives) ∪ legacy `1110`/`1120` when they exist. It never guesses from the `111`/`112` prefix: the group accounts and any unlinked `111x` account are excluded. Read-only; no fallback to any other account. |
| `app/Services/Reporting/ReportService.php` | `cashFlow()` takes its account set from the resolver (everything else, including classification, filters and date handling, is untouched). New `cashPosition()` returns the total and per-account balance from the same `account_balances` snapshot `/accounts` already used. |
| `app/Http/Controllers/Api/ReportController.php`, `routes/api.php` | `GET /api/reports/cash-position` (`reports.view`, same group as `reports/cash-flow`). |
| `web/src/app/(app)/dashboard/page.tsx` | KPI reads `/reports/cash-position` instead of summing two account codes. |
| `web/src/lib/mock-data.ts` | Demo-mode response for the new endpoint (total equals the sum of the mock 1110 and 1120 balances). |
| `tests/Feature/TreasuryAwareCashReportsTest.php` (new) | 16 cases, below. |

Semantics preserved: a posted or reversed entry is included, per-entry net is signed debit minus credit over the set, a zero net (internal transfer) is skipped, an asset-sourced entry is investing, a counter-line in equity is financing, everything else is operating, branch filters apply to the lines, dates are inclusive. The dashboard KPI keeps its previous meaning (cumulative `account_balances` balance, all branches, independent of the dashboard date filter); only the account set changed.

Findings the task asked about:

- The cash-flow report has **no opening or closing balance and no comparative periods** (it returns the three sections and `net_cash_flow`). None was added. Opening, closing and reconciliation are verified in the tests from the ledger: opening + net flow = closing.
- Accounts beginning with `111`/`112` are not assumed to be cash.

## 3. Before and after (reconciled amounts, amounts in halalas)

| Scenario | Before | After | Ledger check |
|---|---|---|---|
| Legacy tenant (1110/1120 only): 100,000 + 50,000 receipts, 20,000 payment | 130,000 | 130,000 | 130,000 |
| Receipt 100,000 on `1110` and 70,000 on new treasury `1111` | 100,000 | **170,000** | 170,000 |
| Receipt 90,000 and payment 25,000 on new bank account `1121` | 0 | **65,000** | 65,000 |
| 200,000 on `1110`, then transfers `1110`→new bank 60,000, new bank→new cash 30,000, new cash→`1120` 10,000 | **150,000** (phantom 60,000 out and 10,000 in) | **200,000**, no transfer listed | 200,000 |
| Opening 150,000 (100,000 on `1110` + 50,000 on `1111`) + period flow 18,000 (30,000 bank receipt, 12,000 payment, 25,000 internal transfer) | closing could not reconcile (flow -25,000) | opening + flow = closing = **168,000**; whole-ledger position 175,000 | 168,000 / 175,000 |
| Dashboard KPI: `1110` 85,000 (after a 15,000 transfer out), `1111` 70,000, `1121` 45,000, `1120` 0 | 850.00 SAR | **2,000.00 SAR** | 200,000 halalas |

"Before" values come from running the new tests against the original `ReportService` (12 of 16 fail there with exactly these differences).

## 4. Tests (`TreasuryAwareCashReportsTest`)

| Required case | Test |
|---|---|
| Legacy tenant, only 1110/1120 | `a_legacy_tenant_with_only_1110_and_1120_reports_exactly_as_before` |
| Additional cash treasury 1111 | `receipts_into_an_additional_cash_treasury_1111_are_included` |
| Additional bank account 1121 | `payments_from_an_additional_bank_account_1121_are_included` |
| Inactive treasury with history | `an_inactive_treasury_keeps_its_historical_postings...` |
| Internal treasury-to-bank transfer | `internal_transfers_between_any_included_treasuries_do_not_inflate_net_cash_flow` (three real transfers through the transfer service) |
| Cross-tenant isolation | `another_tenants_treasuries_and_postings_never_leak...`, `the_resolver_is_tenant_scoped` |
| Branch filter, date boundaries | `branch_filters_and_inclusive_date_boundaries_are_preserved` (both boundary days, other-branch and out-of-period lines excluded) |
| Opening and closing reconciliation | `opening_plus_net_flow_equals_closing_which_equals_the_position` |
| Dashboard KPI equals the accounting balance | `the_dashboard_endpoint_returns_the_ledger_equivalent_balance...` (compared with an independent SQL sum of journal lines) |
| Empty or partially provisioned tenant | `a_tenant_with_the_chart_but_without_treasury_entities...`, `a_tenant_without_any_cash_accounts...` |
| No prefix guess | `the_resolver_is_entities_union_legacy_codes_and_never_a_code_prefix_guess` (unlinked `1119` and group `111` excluded) |
| Reversed entry | `a_reversed_entry_stays_visible_and_nets_to_zero` |
| Auth | `the_dashboard_endpoint_requires_authentication...` |

## 5. Results

RESULTS_PLACEHOLDER

## 6. Accounting invariants

No journal entry, amount, VAT, ZATCA, numbering or permission change; no schema change; no new account fallback (the resolver only unions two explicit sources and never substitutes an account); tenant scoping comes from the scoped models and is covered by two isolation tests. No new accounting entry exists to tabulate.

## 7. Remaining risks

- The dashboard KPI still ignores the dashboard date and branch filters (unchanged behaviour). A branch-restricted user sees the company-wide cash balance there, as before.
- `account_balances` is a maintained snapshot. The test proves it equals the ledger for these flows; any path that bypassed the ledger would break that, as it would for `/accounts`.
- `VatRoleIntegrityService` and `ArApControlBalanceService` keep their own copies of the "entities ∪ 1110/1120" classification. They could adopt `CashAccountResolver`, left out to keep this PR reporting-only.
- Any other report that hard-codes 1110/1120 is outside this task. A repository search found none besides the two fixed here; the production posting paths that still hard-code 1110/1120 are tracked as T4 to T8 in the audit.

## 8. Next recommended action

Owner review. Then T3 from the audit: one posting resolver contract for treasury selection, before the posting paths move off the hard-coded accounts.
