# ACC-02-FC — Implementation report: Fiscal Close VAT balances as of fiscal year-end

STATUS: **IN REVIEW (Draft PR). NOT MERGED. NOT DEPLOYED.** Closes only after approved merge and verification. Production deployment and production data: NOT VERIFIED.
DATE: 2026-10-15 · ZONE: C — tax / accounting · Horizon: TAX-ZATCA
Contract: owner decisions FC-1 (Option C), FC-1a, FC-1b, FC-1c, FC-1d, FC-2, taken after the ACC-02-FC Phase 1 policy review and the FC-2 year-end contract review. Predecessors: REM-05 (`a8a9505`), REM-06 (`76b05f6`), reconciliation audit (`22f9184`).

> A ledger control balance is not a VAT return, a ZATCA status or a filing-ready figure. "Verified" means the declared account-integrity checks passed (see `not_checked`). Nothing here establishes ZATCA compliance or production readiness.

## 1. What changed

The Fiscal Close readiness line `vat_balances` used to read **only the account currently mapped** to `tax_output`/`tax_input`, **all time**, so after a remap it disagreed with the REM-05 VAT report (disclosed by `fiscal_close_vat_control_differs`). It now reads the **whole REM-05 role-account set, cumulative up to the fiscal year's `end_date`**.

| Decision | Implementation |
|---|---|
| FC-1 (Option C) | `VatRoleIntegrityService::balancesAsOf(string $asOf)` — set = current mapping ∪ system default ∪ mapping history, overlap attributed by type (no double count), with REM-05 verification and a per-account breakdown. `FiscalCloseService::vatItems()` renders it. |
| FC-1a | `verified` / `verified_with_notices` ⇒ **info**; `unverified` ⇒ the same item `vat_balances` moves to **warnings** (UI acknowledgement). `can_close` is never affected; the close still succeeds (tested). |
| FC-1b | `reportScope()['disclosures']` is now always `[]` and `fiscalCloseDisclosures()` is removed — **after** the oracle tests proved Fiscal Close = `taxReport(to=end_date)` = balance-sheet rows. The `disclosures` key stays in `GET /reports/tax-report`. Every other VAT warning/disclosure is untouched. |
| FC-1c | `details.tax_output` / `details.tax_input` keep their names and integer-halala type; their **value changes** (set balance as of year-end). Added: `basis`, `accounts`, `current_account`, `mapping_state`, `verification`, `warnings`, `not_checked`. |
| FC-1d | Unmapped / inactive / group / missing role ⇒ the historical set balance is **still shown**, `mapping_state` names the problem, the item is a **warning**, and the message states that new VAT postings fail closed (REM-06). |
| FC-2 | Cut-off `journal_entries.entry_date <= fiscal_years.end_date`, cumulative (no lower bound), `posted` + `reversed`, company-wide (no branch filter), tenant-scoped. Output = credit − debit; input = debit − credit. |
| AR/AP | Calculation **unchanged**. The item gains `details.basis = "all_time_current_account"` and a message saying the figures are cumulative to date for the current account, not as of year-end. FC-4 owns any change. |

Not changed: financial posting, journals, schema/migrations, VAT rates, ZATCA XML/QR/signature/submission, `close()`/`reopen()`/P&L/`criticalIssues()`, permissions, routes, `web/`.

## 2. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/VatRoleIntegrityService.php` | `balancesAsOf()` added; `reportScope()` delegates to a private `scopeFor()` (single snapshot reuse); `fiscalCloseDisclosures()` removed; `disclosures` is `[]` |
| `app/Services/Accounting/FiscalCloseService.php` | `VatRoleIntegrityService` injected; VAT block → `vatItems()`; AR/AP basis + wording; `roleBalance()` kept for AR/AP |
| `app/Services/Reporting/ReportService.php`, `app/Http/Controllers/Api/ReportController.php` | comments only (the `disclosures` key is retained) |
| `tests/Feature/FiscalCloseVatAsOfTest.php` (new, 23) | T1–T23 |
| `tests/Feature/VatRoleIntegrityTest.php` | 3 tests rewritten (see §6) |
| `tests/Feature/VatAdjustmentRoutingTest.php`, `VatSemanticRoutingTest.php` | 1 test each rewritten (see §6) |
| `CLAUDE.md`, this report | documentation |

## 3. Before / after (amounts in SAR; examples taken from the tests)

| Scenario | Fiscal Close **before** | Fiscal Close **after** | REM-05 report to=end |
|---|---:|---:|---:|
| T2: 150.00 on 2120, remap → 2125, then 300.00 on 2125 (2026) | 300.00 (2125 only) | **450.00** (2120 150 + 2125 300) | 450.00 |
| T4: 2120 100 → 2125 200 → back to 2120 +50 | 150.00 | **350.00** | 350.00 |
| T9: 150.00 in 2026 + 150.00 dated 2027-01-03, year 2026 | 300.00 (all time) | **150.00** | 150.00 |
| T13: invoice 150.00 (2026), remap, credit note in 2027, year 2027 | −150.00 | **0.00** | 0.00 |
| T12: 150.00 on 2026-12-20, reversed 2027-01-05 — year 2026 / 2027 | all time | **150.00 / 0.00** | 150.00 / 0.00 |

Sign/presentation: for a legacy wrong-type mapping (T19: an asset account mapped to `tax_output`, net debit 200.00) Fiscal Close and the report show **−200.00** (role sign), while the balance sheet shows the account under assets as **+200.00**. The oracle test asserts both numbers explicitly instead of relaxing the comparison.

## 4. API contract

`GET /api/accounting-settings/fiscal-years/{id}/readiness` → `data.readiness.{info|warnings}[code=vat_balances].details`:

```
tax_output, tax_input        int halalas — CHANGED SEMANTICS: role-account-set balance as of end_date
basis                        {accounts: "vat_role_account_set", as_of, cutoff: "entry_date", cumulative: true,
                              statuses: ["posted","reversed"], branches: "all",
                              sign: {tax_output: "credit_minus_debit", tax_input: "debit_minus_credit"}}
mapping_state                {tax_output|tax_input: resolved|unmapped|inactive|group|missing}
accounts                     {role: [{account_id, code, name, sources, balance}]}   sorted by code
current_account              {role: {account_id, code, name, balance} | null}        old figure, as of end_date
verification, warnings, not_checked      REM-05 shapes, unchanged
```
`open_ar_ap.details` gains `basis: "all_time_current_account"`. `GET /api/reports/tax-report` keeps `disclosures` (now `[]`). The item can now be in `warnings` instead of `info`; the web page renders items generically, so no web change was needed.

## 5. Financial impact

**No financial operation, journal entry or posting changed** — read-only change. No journal table applies. Asserted by test T23 (ledger snapshot before/after a readiness call is identical) and T21 (the closing entry contains no VAT line).

## 6. Tests replaced (documented)

| Test | Why it changed |
|---|---|
| `VatRoleIntegrityTest::the_report_discloses_the_fiscal_close_vat_line_difference…` → `…no_longer_discloses…` | pinned `fiscal_close_vat_control_differs` {15000, 30000, 15000}; the behaviour is removed. Now asserts `disclosures = []`, Fiscal Close = report (30000 / 15000) and keeps 15000 / 7500 as `current_account`. |
| `VatRoleIntegrityTest::fiscal_close_reads_only_the_current_role_account…` → `…reads_the_full_role_account_set_as_of_the_year_end` | pinned 15000 vs 30000; now asserts 30000 = report. |
| `VatRoleIntegrityTest::a_credit_note_after_a_remap_uses_the_current_role…` | disclosure assertion {−15000, 0, 15000} replaced by `[]` + Fiscal Close = report (0); −15000 kept as `current_account`. Totals / balance / verification assertions unchanged. |
| `VatAdjustmentRoutingTest::a_sales_return_after_a_remap_debits_the_current_role…` | same replacement ({−15000, 0, 15000}). |
| `VatSemanticRoutingTest::post_remap_expenses_close_the_fiscal_close_gap…` → `…feed_the_input_vat_set_and_the_fiscal_close_line_matches_the_report` | pinned {15000, 30000, 15000}; now asserts 30000 = report and `current_account` 15000. |

No assertion about totals, balance, verification status or warnings was weakened. The existing `FiscalYearReopenTest` VAT/AR-AP tests pass **unchanged**.

## 7. Tests and results

`FiscalCloseVatAsOfTest` (23): default and remapped sets (T1, T2, T4), cross-year return / credit note / debit note (T3, T13, T14), overlap (T5), contamination before / after year-end and undetected manual journals (T6–T8), cut-off, backdating and period lock (T9, T10), same- and later-year reversals (T11, T12), tenant isolation and branch aggregation (T15, T16), inactive / unmapped / wrong-type roles (T17–T19), AR/AP basis (T20), close and reopen (T21), API contract (T23, T23b). Every scenario that carries a balance runs `assertOracles()` against `taxReport(to=end_date)` and the balance-sheet rows; the breakdown must sum to the role total with no duplicate account.

Mutation checks (local): removing the `entry_date` cut-off fails 8 tests; reading the current account only fails 12 — the suite detects both regressions.

| Run | Result |
|---|---|
| New `FiscalCloseVatAsOfTest` — SQLite | ✅ 23 passed (358 assertions) |
| Focused related suites (`FiscalYear|FiscalClose|VatRole|VatSemantic|VatAdjustment|VatPos|Report|Tax`) — SQLite | ✅ 382 passed, 14 skipped; 1 failed = `FuelSaleServiceTest` (PHP `bcmath` absent in this sandbox) |
| Same set + `PostgresTestLockTimeout` — local PostgreSQL 16 (`lock_timeout=60s` as in `ci.yml`) | ✅ 397 passed, 1 skipped; same single `bcmath` failure |
| Local full `php artisan test` — SQLite | 6,911 passed · 99 skipped · **26 failed = the 26 known Fuel / `bcmath` tests** (`FuelAviRfid` 3, `FuelReconciliation` 8, `FuelSaleApi` 1, `FuelSaleService` 7, `FuelSupplyReceivingApi` 2, `FuelSupplyReceiving` 5), identical to `main` in this sandbox; CI has `bcmath` |
| Mutation checks | cut-off removed ⇒ 8 failures; current-account-only ⇒ 12 failures |
| Required CI (SQLite, PostgreSQL, CI Gate) on the final head | recorded on the PR — see the closing PR comment |


## 8. Remaining risks and exclusions

* **FC-3 (not built):** no VAT / AR-AP snapshot is stored at close. Readiness is recomputed live, so an entry **backdated into a closed year** changes that year's figure unless an accounting period lock covers its date (a closed fiscal year does not by itself block posting). The close event records P&L only.
* **FC-4 (not built):** AR/AP stay all-time and current-account-only; they are labelled, not reconciled, and sit beside a VAT line that is as-of year-end.
* **Undetected contamination:** a manual journal on a clean VAT account counts and still reads `verified` (T8); `not_checked` states the limit.
* **Set membership uses today's mapping history:** an account mapped after year-end contributes only if entries dated on or before year-end sit on it.
* **No VAT return liability, period freeze or filing readiness** — REM-28 / ADR-G.
* Production exposure NOT VERIFIED (no production access); no data was touched.

## 9. Branch / PR / SHAs

| Item | Value |
|---|---|
| Branch | `feat/acc02-fc-fiscal-close-vat-as-of` |
| PR | Draft, → `main` (number and link on the PR itself) |
| Base | `main` @ `ebdfdae649b816891c43bfdaa1759af49674c5a2` (contains the reconciliation audit `22f9184`) |
| Head | the PR head (code + this report); a file cannot name its own commit — recorded in the PR description / closing comment |

## 10. Recommended next step

Owner review of the Draft PR. Then decide FC-3 (stored close snapshot) and FC-4 (AR/AP basis) separately; REM-28 is the prerequisite for any claim about a VAT position for a return period.
