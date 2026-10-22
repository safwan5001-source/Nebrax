# Dashboard branch-scoped receivables KPI

| | |
|---|---|
| Scope | Dashboard receivables KPI only. No posting, VAT, ZATCA, permission, role, schema or provisioning change. |
| Origin | Open decision D-T9 from the TREASURY-T2 review: a branch-restricted user saw branch-scoped cash next to company-wide receivables. |
| Base | `origin/main` @ `8919639e3` (includes #1617) |
| Branch | `claude/dashboard-branch-scoped-receivables` |
| Not done | merge, deploy, data reset, production migration, tenant activation, ZATCA transmission |

## 1. Root cause

The receivables card computed `accounts.find(code === '1130').balance` from the company-wide `GET /accounts` list (`account_balances` snapshot, all branches). The cash KPI was already branch-scoped through `ReportService::branchIds()` (T2), so one dashboard mixed two scopes. For a branch-restricted user the receivables card also exposed a company-wide figure that every branch-filtered report hides.

## 2. Fix

| File | Change |
|---|---|
| `app/Services/Reporting/ReportService.php` | New `receivablesPosition()` and a shared `scopedBalance(accountIds)` used by both it and `cashPosition()`. **Unrestricted** user (`branchIds()` is `null`): sum of the `account_balances` snapshot for the accounts, exactly the previous number. **Restricted** user: sum of the posted and reversed journal lines of their own branches, per account, signed by the account's normal balance (debit-normal: debit minus credit; credit-normal: the reverse), the same rule `LedgerService::applyToBalance` applies to the snapshot. Reversed entries stay with their reversal, so they net to zero. The receivables account set is the system account `1130` only (as the old KPI), not a role mapping; a tenant without it gets `0`. |
| `app/Http/Controllers/Api/ReportController.php`, `routes/api.php` | `GET /api/reports/receivables-position`, `reports.view`, same group as `cash-position`. Response is exactly `{ "balance": "…" }`: no account, branch or customer data. |
| `web/src/lib/dashboard.ts` | `loadCashPosition` generalised to `loadKpiBalance` (and `KpiBalanceState`) because two KPIs now use it. Same behaviour. |
| `web/src/app/(app)/dashboard/page.tsx` | Cash and receivables load in two independent requests outside `Promise.all`. Failure, 403 or a malformed response shows the explicit "Balance unavailable" state; a genuine `0.00` shows as zero. The page no longer requests `/accounts` (its only use was these two figures). |
| `web/src/messages/{ar,en}.json` | `dashboard.cash_unavailable` renamed `kpi_unavailable` (shared by both cards). |
| `web/src/lib/mock-data.ts` | Demo response for the new endpoint (balance equals the demo `1130` balance). |

Authorization is unchanged: the dashboard already requires `reports.view` for the income statement, and the new endpoint uses that existing permission. A role without it gets 403 and the card shows "unavailable". No role or permission definition was touched.

## 3. Tests

Backend `DashboardReceivablesPositionTest` (10) on SQLite and PostgreSQL:

| Required case | Test |
|---|---|
| Unrestricted, company-wide, identical to the old figure | `an_unrestricted_user_gets_the_company_wide_balance_identical_to_the_old_accounts_figure` (1,350.00; equals the 1130 row of `GET /accounts` and an independent SQL sum) |
| One branch | `a_user_restricted_to_one_branch...` (350.00 of 1,350.00) |
| Several branches | `a_user_restricted_to_several_branches...` (650.00; the main branch excluded) |
| Branch without receivables | `a_branch_without_receivables_is_a_genuine_zero...` (0.00, not the company total) |
| Cash and receivables consistent | `cash_and_receivables_share_one_branch_scope_for_the_same_user` (restricted: 150.00 cash, 450.00 receivables; unrestricted: 1,140.00 and -140.00) |
| Reversal | `a_reversed_entry_nets_to_zero_in_both_scopes` |
| Sign | `an_overpaid_customer_gives_a_negative_receivable...` (-200.00 in both scopes) |
| Cross-tenant | `another_tenants_receivables_never_leak_in_either_scope` |
| Authorization, minimal payload | `the_endpoint_requires_authentication_and_the_reports_permission...` (401 unauthenticated, 403 for a role without `reports.view`, only the `balance` key, no names or ids) |
| Legacy or incomplete tenant | `a_tenant_without_the_receivables_account_gets_zero_not_an_error` |

Removing the branch rule from `scopedBalance()` makes 5 tests fail (the four restricted receivables tests plus the T2 restricted-cash test). `TreasuryAwareCashReportsTest` (17) still passes unchanged.

Frontend `dashboard/page.test.tsx` (12): both totals shown through one request each with no `/accounts` call; for **each** KPI: 500, 403, malformed and empty response are isolated and show "unavailable", the other KPI and the rest of the page still load, and no zero appears; both failing at once; genuine zero for each; a negative receivable keeps its sign. `lib/__tests__/dashboard.test.ts` (24) covers the helper.

## 4. Results

RESULTS_PLACEHOLDER

## 5. Accounting invariants

No journal entry, amount, VAT or ZATCA change; no schema change; no permission or role change; sign convention follows the account's normal balance as in the ledger; reversed entries net to zero; tenant scoping comes from the scoped models and is covered by a cross-tenant test.

## 6. Risks

- The restricted figure counts only lines tagged with the user's branches; company-wide entries with no branch are not counted for them (same as every branch-filtered report).
- Receivables are the system account `1130`, as before. Tenants that remapped the receivable role to another account see only `1130` here, the same limitation as the previous KPI. The role-aware definition exists in `ArApControlBalanceService` for the fiscal close and was deliberately not reused.
- Other consumers of `GET /accounts` (the accounts screen) still show company-wide balances to restricted users; out of scope.

## 7. Recommended next step

Owner review. Then T3 from the Treasury audit (a single treasury-selection contract for postings), which still needs decision D-T3.
