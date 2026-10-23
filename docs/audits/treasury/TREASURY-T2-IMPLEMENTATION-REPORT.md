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
| `app/Services/Reporting/ReportService.php` | `cashFlow()` takes its account set from the resolver (everything else, including classification, filters and date handling, is untouched). New `cashPosition()` returns **one total only**. An unrestricted user gets the company total from the same `account_balances` snapshot `/accounts` used; a branch-restricted user gets the sum of the journal lines of their own branches, i.e. the same branch rule every other report applies (`branchIds`). |
| `app/Http/Controllers/Api/ReportController.php`, `routes/api.php` | `GET /api/reports/cash-position` (`reports.view`, same group as `reports/cash-flow`). Response is exactly `{ "balance": "2000.00" }`: no account names, codes, ids or per-account balances. |
| `web/src/app/(app)/dashboard/page.tsx`, `web/src/lib/dashboard.ts`, `web/src/components/dashboard/kpi-card.tsx`, `web/src/messages/{ar,en}.json` | KPI reads `/reports/cash-position` in its own request, outside `Promise.all`. `loadCashPosition()` never throws: a rejection (network, 403) or a malformed response yields an explicit `unavailable` state, rendered by `KpiCard` as a dash with the text "Balance unavailable" (no number, unit or sparkline). A genuine `0.00` is shown as zero. The rest of the dashboard loads regardless. |
| `web/src/lib/mock-data.ts` | Demo-mode response for the new endpoint (`balance` only). |
| `tests/Feature/TreasuryAwareCashReportsTest.php` (new) | 17 cases, below. |

Review follow-up (PR review comments): the first version of the endpoint returned every account's name and balance and was company-wide for everyone, and a failing request made the whole dashboard fail to load. Both are fixed as described above, with tests (sections 4 and 5).

Semantics preserved: a posted or reversed entry is included, per-entry net is signed debit minus credit over the set, a zero net (internal transfer) is skipped, an asset-sourced entry is investing, a counter-line in equity is financing, everything else is operating, branch filters apply to the lines, dates are inclusive. The dashboard KPI keeps its previous meaning for unrestricted users (cumulative `account_balances` balance, all branches, independent of the dashboard date filter); only the account set changed. **Branch-restricted users now see their own branches' cash** instead of the company total, matching `ReportService::branchIds()` ("a restricted user must not see aggregate numbers outside their scope"). No permission, role or gate changed. See section 7 for the one inconsistency this exposes.

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
| Dashboard KPI equals the accounting balance | `the_dashboard_endpoint_returns_only_the_ledger_equivalent_total_and_no_account_details` (exact JSON `{balance}`, equal to an independent SQL sum of journal lines, no names in the payload) |
| Branch-restricted user | `a_branch_restricted_user_sees_only_the_cash_of_their_own_branches_never_the_company_total` (company 740.00 vs restricted 340.00 vs empty branch 0.00; fails if the branch rule is removed) |
| Frontend: failure isolation | `dashboard/page.test.tsx` (5): total shown via one request; request failure (500) and permission denial (403) leave the other cards loaded and the cash card "unavailable", never zero; malformed response unavailable; genuine zero shown as zero (3 of 5 fail against the previous page code). `lib/__tests__/dashboard.test.ts` `loadCashPosition` (4) and `kpi-card.test.tsx` (3) cover the helper and the card states |
| Empty or partially provisioned tenant | `a_tenant_with_the_chart_but_without_treasury_entities...`, `a_tenant_without_any_cash_accounts...` |
| No prefix guess | `the_resolver_is_entities_union_legacy_codes_and_never_a_code_prefix_guess` (unlinked `1119` and group `111` excluded) |
| Reversed entry | `a_reversed_entry_stays_visible_and_nets_to_zero` |
| Auth | `the_dashboard_endpoint_requires_authentication...` |

## 5. Results

| Run (local sandbox) | Result |
|---|---|
| `TreasuryAwareCashReportsTest` | 17 passed on SQLite and 17 passed on PostgreSQL 16 |
| Same tests against the original `ReportService` | 12 of the first 16 fail with the differences in section 3 (4 pass: legacy tenant, resolver cases, auth). Removing the branch rule from `cashPosition()` makes the restricted-user test fail |
| Web: `vitest` on `src/lib`, `src/components/dashboard`, `dashboard/page.test.tsx` (includes i18n key parity and mock contracts) | 100 files, 769 tests passed; `tsc --noEmit` shows no error in changed files (unrelated pre-existing type errors exist in other test files) |
| Full SQLite suite | 8335 passed, 185 skipped, 27 failed |
| Full PostgreSQL suite, `--parallel --processes=4` (as CI) | 8547 tests, 27 failing |
| CI (`php artisan test` sqlite and pgsql, CI Gate) | see the PR |

All 27 local failures are the same pre-existing set as in the T1 report and none touches reports or treasury: 26 `Fuel*` tests (the sandbox lacks `bcmath`; CI has it) plus `AiPaidProviderDisabledTest` on SQLite and `StorefrontMediaApiTest` on PostgreSQL (both fail identically on `main`, verified in T1). The related report and accounting suites (`GeneralReportTest`, report, payment, invoice, ledger, treasury) are inside the full runs and pass.

## 6. Accounting invariants

No journal entry, amount, VAT, ZATCA, numbering or permission change; no schema change; no new account fallback (the resolver only unions two explicit sources and never substitutes an account); tenant scoping comes from the scoped models and is covered by two isolation tests. No new accounting entry exists to tabulate.

## 7. Remaining risks

- The dashboard KPI still ignores the dashboard date and branch filters (unchanged behaviour); only the user's branch restriction applies.
- **Open inconsistency, owner decision:** the dashboard's *receivables* card still reads `/accounts` (company-wide `account_balances`), so a branch-restricted user sees a branch-scoped cash figure next to a company-wide receivables figure. That is pre-existing and outside T2; the options are to scope receivables the same way or to keep it as is. The cash card now follows the report rule rather than reproducing the old company-wide exposure through a `reports.view` endpoint.
- A restricted user's cash figure comes from journal lines tagged with their branches; company-wide entries with no branch are not counted for them (same as every branch-filtered report).
- `account_balances` is a maintained snapshot. The test proves it equals the ledger for these flows; any path that bypassed the ledger would break that, as it would for `/accounts`.
- `VatRoleIntegrityService` and `ArApControlBalanceService` keep their own copies of the "entities ∪ 1110/1120" classification. They could adopt `CashAccountResolver`, left out to keep this PR reporting-only.
- Any other report that hard-codes 1110/1120 is outside this task. A repository search found none besides the two fixed here; the production posting paths that still hard-code 1110/1120 are tracked as T4 to T8 in the audit.

## 8. Next recommended action

Owner review. Then T3 from the audit: one posting resolver contract for treasury selection, before the posting paths move off the hard-coded accounts.
