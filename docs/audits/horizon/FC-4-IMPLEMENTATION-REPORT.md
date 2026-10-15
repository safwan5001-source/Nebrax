# FC-4 — Implementation report: Fiscal Close AR/AP balance as of fiscal year-end

STATUS: **IN REVIEW (Draft PR). NOT MERGED. NOT DEPLOYED.** Closes only after approved merge and verification. Production deployment and production data: NOT VERIFIED.
DATE: 2026-10-15 · ZONE: C — accounting integrity (read-only) · Horizon: TAX-ZATCA
Contract: owner decisions "Option C" with S1–S8, taken after the FC-4 accounting policy review. Predecessors: ACC-02-FC (`90b854f`, VAT line), FC-3 (`99d1c4b`, closed-year posting protection).

> A ledger control-account balance is not a partner subledger, not a list of open documents and not a reconciled receivables position. "Verified" means only that the declared account-integrity checks passed (see `not_checked`). Nothing here establishes commercial correctness of the receivables or payables figures.

## 1. What changed

The Fiscal Close readiness line `open_ar_ap` used to read **only the account currently mapped** to `accounts_receivable` / `accounts_payable`, **all time** (no year-end cut-off). After a remap it dropped the old account — which keeps receiving postings because many paths still write `1130` / `2110` directly — and it included entries dated after the year end.

It now reads the **whole role-account set, cumulative up to the fiscal year's `end_date`**.

| Decision | Implementation |
|---|---|
| Option C | New `ArApControlBalanceService::balancesAsOf(string $asOf, ?FiscalYear $year)` — read-only. Set per role = current mapping ∪ system default (1130 / 2110) ∪ every account in `account_role_mapping_events` for the role. |
| Cut-off | `journal_entries.entry_date <= end_date`, cumulative, `posted` + `reversed` (drafts are not in the ledger), all branches including branchless entries, tenant-scoped through `JournalLine`. |
| Sign | By **role**, not by account nature: receivable = debit − credit, payable = credit − debit. |
| S1 | Status `unverified`, or an unresolved role mapping ⇒ the item `open_ar_ap` moves to **warnings** (acknowledgement in the UI). `can_close` is never affected; the close still succeeds (tested). Otherwise it stays **info**. |
| S2 | An account in both sets is attributed by type (asset → receivable, liability → payable, any other type → excluded from both) so it is never counted twice — and **always** produces `unverified` (`affects_totals = true`), even at a zero balance. |
| S3 | Opposite-sign balances are disclosed (`opposite_sign`: account level and, from tagged lines, partner level) and never reclassified. They do not change the verification status. |
| S4 | Lines on role accounts without a partner id are disclosed separately (`untagged`: lines, debit, credit, net) and are **not** counted as an error. Partner opening balances are tagged, so they never appear here. No effect on the status. |
| S5 | Warnings: cash/bank account (`ar_ap_account_cash_bank`), incompatible account type (`ar_ap_account_type_mismatch`), account used by another role currently or historically — including VAT roles and their system defaults (`ar_ap_account_in_other_role`). Each carries `affects_totals`: **true** when the account has any movement up to the as-of date (⇒ `unverified`), otherwise a notice (⇒ `verified_with_notices`). |
| S6 | **Not implemented.** AR/AP mapping-write validation is a separate follow-up. |
| S7 | **Not implemented.** The hard-coded `1130` / `2110` posting paths are untouched. This is why the set must include the system account. |
| S8 | `history`: earlier fiscal years that are not closed, plus activity on role accounts dated before the year in dates no closed year protects. Disclosed in the message and in `details.history`; informational only. |

Not changed: financial posting, settlement, journals, schema / migrations, VAT or ZATCA logic, `close()` / `reopen()` / P&L / `criticalIssues()`, permissions, routes, `web/`, aging report, partner statements, `ReportService`, `VatRoleIntegrityService` (only its public `vatRoleKeys()` is read).

## 2. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/ArApControlBalanceService.php` (new) | The read-only service |
| `app/Services/Accounting/FiscalCloseService.php` | Injects the service; `open_ar_ap` block → `arApItems()`; `roleBalance()` removed (no other caller) |
| `tests/Feature/FiscalCloseArApAsOfTest.php` (new, 33 tests) | T1–T21 + additions |
| `tests/Feature/FiscalCloseVatAsOfTest.php` | `t20` rewritten — see §7 |
| `CLAUDE.md`, `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md`, `docs/audits/horizon/ACC-02-FC-IMPLEMENTATION-REPORT.md` (one note), this report | documentation / status (FC-3 recorded as merged #1505) |

## 3. Accounting examples — before and after (SAR; halalas in brackets)

No new financial operation exists, so there are **no new journal entries**. The postings below are the existing ones used by the tests; what changes is only how the readiness line adds them up. Year = 2026; "today" in the tests is 2027-03-15.

**T3 — remap + paths that write `1130` directly + settlement after year-end**

| Date | Operation (existing posting path) | Debit | Credit | Amount |
|---|---|---|---|---:|
| 2026-01-01 | Customer opening balance (`PartnerService`, hard-coded) | 1130 | 3130 | 500.00 (50000) |
| 2026-03-01 | Invoice i1 | 1130 | 4110 / 2120 | 1,150.00 (115000) |
| — | *Role `accounts_receivable` remapped 1130 → 1131* | | | |
| 2026-07-01 | Invoice i2 (resolves the role) | 1131 | 4110 / 2120 | 1,150.00 (115000) |
| 2026-08-01 | Full sales return of i1 (`ReturnService`, hard-coded) | 4110 / 2120 | 1130 | 1,150.00 (115000) |
| 2027-01-15 | Receipt for i2 (after year-end) | bank | 1131 | 1,150.00 (115000) |

| `open_ar_ap.receivable` for 2026 | SAR | halalas |
|---|---:|---:|
| **Before** (current account 1131, all time) | **0.00** | 0 |
| **After** (1130: 500.00 + 1131: 1,150.00, as of 2026-12-31) | **1,650.00** | **165000** |
| Balance sheet 2026-12-31, rows 1130 + 1131 (consistency check) | 1,650.00 | 165000 |

**T2 — settlement after year-end:** invoice 2026-03-01 (1,150.00) paid 2027-01-15. Before: 0.00; after: **1,150.00** as of 2026-12-31 (and 0.00 as of 2027-12-31). Same for a supplier bill paid in 2027.

**T7 — notes posting to the system account after a remap:** invoice 1,150.00 (1130), remap to 1131, partial credit note 575.00 → posts credit to `1130` (hard-coded). Before: current account 1131 = 0.00; after: **575.00** (57500). Mirror case for a purchase debit note against `2110` after `2110 → 2111`.

**T8 / T9 — opposite sign:** a standalone sales return of 230.00 leaves a customer credit of **−230.00** (−23000): shown as `receivable = −23000` with `opposite_sign` (account `1130`, 1 partner, 23000), not reclassified; after a cash refund of 230.00 the figure is 0.00 and the disclosure is empty. The supplier mirror gives `payable = −23000` until the supplier refund.

**T11 — contamination:** receivable remapped to the cash account `1110` with a cash sale of 300.00: figure 300.00 is shown, status `unverified`, item moves to warnings, `can_close` stays `true`, and the year closes normally.

**T12 — overlap:** payable remapped to `1130`: `1130` is attributed to receivable (asset), excluded from payable, and the status is `unverified` even with no movement at all.

## 4. API compatibility

Preserved: item code `open_ar_ap`; keys `details.receivable` and `details.payable` (integers, halalas); `details.basis` (string); the readiness envelope `{blockers, warnings, info, can_close}` and the item shape `{severity, code, message, details}`; informational severity when the integrity checks pass; `can_close`.

Changed (stated decision, same pattern as ACC-02-FC FC-1c): the **meaning** of `receivable` / `payable` (role-account set as of `end_date` instead of the current account over all time), `basis` = `role_account_set_as_of_end_date` (was `all_time_current_account`), and the message text. The item is also now emitted when only one role resolves (as before) and is omitted only when neither role has any account.

Added (all inside `details`): `as_of`, `accounts` (`receivable` / `payable` lists: account id, code, name, type, active, group, `sources` ∈ current / system_default / history, `counted`, `balance`), `current_account`, `mapping_state`, `verification` (`status`, `verified`, `issues`, `notices`, `basis`, `checks`, `not_checked`), `warnings` (each with `code`, account, `roles`, `message`, `affects_totals`), `untagged`, `opposite_sign`, `history`, `not_checked`.

No other endpoint changes: balance sheet, partner statement, aging, tax report and `vat_balances` are untouched. The web UI renders only `message` for readiness items, so it needs no change.

## 5. Integrity checks and what they cannot prove

| Check | Result | Effect |
|---|---|---|
| `ar_ap_role_accounts_overlap` | warning per account | always `unverified` |
| `ar_ap_account_type_mismatch` (receivable ⇒ asset, payable ⇒ liability) | warning | `unverified` if the account moved up to the date, else notice |
| `ar_ap_account_cash_bank` (cash/bank records and system codes 1110 / 1120) | warning | same |
| `ar_ap_account_in_other_role` (current mapping or mapping history of any other role; VAT system defaults) | warning | same |
| `ar_ap_untagged_lines`, `ar_ap_opposite_sign` | `info` when present | disclosure only |

Reuse: the role-set construction follows `VatRoleIntegrityService` (REM-05) and the verification vocabulary follows it too (`verified` / `verified_with_notices` / `unverified`).

`not_checked` is returned on every response: `partner_subledger_reconciliation` (②), `open_documents_reconciliation` (③), `aging_report_agreement`, `manual_journal_content`, `pre_mapping_activity`, `direct_database_changes`.

**Matching the balance sheet is an internal ledger-consistency check only.** The tests assert it, and the message says so. The integrity checks cannot certify that each line belongs to the right customer or supplier, that the figure equals open invoices and bills, or that nothing was changed outside `AccountRoutingService`. The figure is therefore **never labelled reconciled or commercially verified**.

Known limits of the disclosures: `history.balances_can_still_change` is false for a first fiscal year with no earlier activity, but an entry dated before the first fiscal year can still be posted later (no year covers those dates); period locks are not considered.

## 6. Tests

`FiscalCloseArApAsOfTest` — 33 tests (SQLite and PostgreSQL), mapping to the approved T1–T21:

| # | Scenario |
|---|---|
| T1 | Real invoice + bill: year-end figures, `verified`, balance-sheet agreement, `can_close` |
| T2 | Settlement after year-end (customer receipt and supplier payment) |
| T3 | Remap + hard-coded paths + opening balance + settlement after year-end (the table above) |
| T4 | Two remaps then reset: set {1130, 1131, 1132}, sources, current account |
| T5 | FC-3: backdated entry rejected in the closed year (figure stable), reopen → post → re-close |
| T6 | Same-year and cross-year reversals (original and reversal both in the ledger) |
| T7 | Partial credit note and debit note after remaps |
| T8 / T9 | Customer credit / supplier debit balances: disclosed, not reclassified; cleared by refunds |
| T10 / T10b | Untagged manual lines disclosed; partner opening balances not reported as untagged |
| T11 / T11b | Cash account with movement ⇒ unverified, closing still works; bank account without movement ⇒ notice |
| T12 / T12b / T12c | Overlap attributed by type; unverified at zero balance; non-attributable type excluded from both |
| T13 | Tenant isolation (other tenant's entries and remaps) |
| T14 | Branch entries, branchless entries and an active branch context |
| T15 / T15b / T15c | Opening balances before the first year; prior open years disclosed until closed; first year with nothing earlier |
| T16 | Every per-account row equals its balance-sheet row |
| T17 | Limits: partner-tagged line outside the set (statement ≠ role balance), `not_checked`, message wording |
| T18 | HTTP readiness endpoint: item code, integer fields, envelope, additive keys, VAT line untouched |
| T19 | Close → reopen → re-close: same figures; close entry never touches AR/AP |
| T20 / T20b | Inactive current account; missing mapping: historical balance shown with a warning |
| T21 | Drafts excluded; posted and reversed included |
| Extras | T22 incompatible type, T23 account of another role, T24 read-only, T25 unverified figure never blocks the close, T26 tenant with no AR/AP account gets no item |

Local results (SQLite and PostgreSQL 16, this environment lacks `bcmath`, so the 26 known Fuel tests fail locally and pass in CI):

| Run | Result |
|---|---|
| `FiscalCloseArApAsOfTest` | 33 passed (216 assertions) |
| Focused (FiscalYear / FiscalClose / VatRole / VatAdjustment / Ledger / PeriodLock / AccountingDate / AccountRouting / AccountRole) — SQLite | 298 passed, 12 skipped |
| Same focused set — PostgreSQL | 310 passed |
| Full SQLite suite | 7085 passed, 132 skipped, 26 failed — all 26 are the known Fuel tests needing `bcmath` (`bcmul`), absent locally and installed in CI |
| Full PostgreSQL suite | 7213 passed, 3 skipped, 27 failed — the same 26 Fuel/`bcmath` tests plus `StorefrontMediaApiTest › the library lists newest first with cursor pagination…` (`PDOException HY093` in a media query). That test fails identically with FC-4 removed (checked locally against `origin/main` code) and passes in CI on `main` (run #9658 on `99d1c4b`), so it is a local-environment difference unrelated to this change |
| CI (sqlite, pgsql) and CI Gate on the final head | recorded in the PR (see §9) |

## 7. Existing test updated, with justification

`FiscalCloseVatAsOfTest::t20` (renamed `t20_receivables_and_payables_use_the_year_end_role_account_set_basis_and_say_so`) pinned the **obsolete** semantics deliberately introduced by ACC-02-FC as a placeholder ("cumulative to date for the current account only; FC-4 owns any change"): receivable `107000 + 15000 + 9000`, `basis = all_time_current_account`, and the message "ليست كما في نهاية السنة المالية". The approved FC-4 decision replaces exactly that. The rewritten test asserts the new contract on the same fixtures: 2027 entries no longer enter the 2026 figure (receivable `115000`), `basis`, `as_of`, and the message, and it still asserts the item is neither a warning nor a blocker for a verified tenant. No other existing test changed; `FiscalYearReopenTest::open_receivables_and_payables_are_informational_never_blocking` passes unmodified.

## 8. Remaining risks and follow-up tasks

- **S7 (high priority, separate):** while `ReturnService` (sales), `CreditNoteService`, `PosExchangeService`, `PartnerService` (opening balances), `ExpenseService`, `AssetService`, `InventoryService`, `FuelSupplyReceivingService` and `CorporateFuelAuthorizationService` write `1130` / `2110` directly, a remap splits the balance across accounts permanently. FC-4 reads the whole set so the year-end figure stays right, but the split itself is not repaired.
- **S6 (separate):** AR/AP remapping accepts any active, non-group, non-VAT-reserved account (no type, clean-target or uniqueness rule). FC-4 detects the consequences; it does not prevent them.
- Partner-subledger, open-document and aging reconciliation (②, ③, ④) are still absent; aging uses the document state now, not "as of".
- The figure is cumulative from the start of time: a backdated entry into any year that is not closed changes it (disclosed through `history`).
- `year_not_ended`-style behaviour from FC-3 is unchanged.
- Production data: NOT VERIFIED. Tenants that already remapped these roles will see different `open_ar_ap` numbers on the next readiness call; this is intended and read-only.

## 9. Branch / PR / SHAs

- Branch: `feat/fc4-ar-ap-year-end-control-balance`
- Base SHA: `99d1c4b722eff5cc50f959c721dd5781b7cb0bc9` (`main`, FC-3 merge)
- PR / Head SHA / full-suite and CI Gate results: recorded in the PR.

## 10. Recommended next step

Owner review of the Draft PR. Then, as separate tasks: S7 (route the hard-coded paths through the role resolver) before S6, then the subledger / open-document reconciliation scoping.
