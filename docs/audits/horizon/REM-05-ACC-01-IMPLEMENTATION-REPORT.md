# REM-05 / ACC-01 — Implementation Report: VAT account roles & tax-report accuracy

STATUS: **IN REVIEW (Draft PR). NOT MERGED. NOT DEPLOYED.** Closes only after approved merge and verification.
DATE: 2026-10-14 · ZONE: C — tax / accounting
Decisions: `REM-05-ACC-01-ACCOUNTING-DECISION-REPORT.md` §11 (D-1…D-6 approved by the owner; D-5 with safeguards).

> Not legal or tax advice. No statement of ZATCA Phase 2 compliance or production readiness is made. The tax report is a **control summary of ledger movements**, not a VAT return (return/filing is REM-28).

## 1. What was implemented

| # | Requirement | Result |
|---|---|---|
| 3 | VAT-role eligibility with HTTP 422 | `PUT/DELETE /accounting-settings/account-routing/{role}` now rejects ineligible targets with `422 {"message": <Arabic text>, "reason": <stable code>}` (see §3). `reason` is an additive field; `message` keeps the existing shape. |
| 4 | Conflicting assignments incl. concurrent PostgreSQL changes | Eligibility is evaluated **inside** the existing transaction **after** the tenant-row `FOR UPDATE` lock (same lock the ledger posting anchor uses). Two concurrent mappings of one account: exactly one wins, the other gets a 422. Proven with real forked processes on PostgreSQL, and by a mutation check (without the lock, both win and the test fails). |
| 5 | Report uses role-account history, incl. system defaults | `ReportService::taxReport` sums `S(role)` = current mapping ∪ system default account (`1150`/`2120`) ∪ every account in `account_role_mapping_events` for the role. |
| 6 | Ambiguous / contaminated histories ⇒ additive warnings | `verification`, `warnings[]`, `accounts{}` on the tax report; `mapping.violations[]` on the routing list (§4). |
| 7 | Default tenants unchanged | For a tenant that never remapped the four original fields are byte-identical; `verification.verified = true`, `warnings = []`. |
| 8 | Posted entries, VAT calculation, balances, posting logic untouched | No posting/ledger/resolver code changed; a test snapshots every entry/line/mapping/event before and after rejected and valid operations. |
| 9 | `FiscalCloseService` and hard-coded VAT posters (REM-06) untouched | Confirmed by diff; dependency documented and tested (§7). |
| 10 | Documentation | Decision report §11–§12, this report, backlog status block. |

Web (additive, tolerant of older APIs): the routing page shows `mapping.violations`; the VAT report card shows an **Unverified** badge and each warning when `verification.verified === false`.

## 2. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/VatRoleIntegrityService.php` (new) | Eligibility rules (write), violation listing (read), report scope + contamination detectors. Read-only; never writes. |
| `app/Services/Accounting/VatRoleMappingException.php` (new) | `RuntimeException` subclass carrying the stable `reason`. |
| `app/Services/Accounting/AccountRoutingService.php` | Inject the integrity service; validate inside the locked transaction (`setMapping`, `reset`); add `mapping.violations`. |
| `app/Http/Controllers/Api/AccountRoutingController.php` | 422 with `reason` for `VatRoleMappingException`; other errors keep the existing `domain()` path. |
| `app/Services/Reporting/ReportService.php` | `taxReport` over the role-account set; additive keys. |
| `app/Http/Controllers/Api/ReportController.php` | Pass through `verification`, `warnings`, `accounts`. |
| `tests/Feature/VatRoleIntegrityTest.php` (new, 27 tests) | SQLite + PostgreSQL. |
| `tests/Feature/VatRoleIntegrityPostgresTest.php` (new, 2 tests) | Forked-process concurrency (PostgreSQL only; skipped on SQLite). |
| `web/src/app/(app)/accounting-settings/account-routing/page.tsx` (+test) | Show violations. |
| `web/src/components/reports/general-advanced-reports-workspace.tsx` (+test) | `TaxCard` unverified notice (exported for testing). |
| `web/src/messages/{ar,en}.json` | 3 keys. |
| `docs/audits/horizon/*` | Decision report update, this report, backlog block. |

No migration, no schema change, no new route, no permission change.

## 3. Rules and the 422 contract

| Role | Rule | `reason` |
|---|---|---|
| `tax_output` | type must be `liability` | `vat_type_mismatch` |
| `tax_input` | type must be `asset` | `vat_type_mismatch` |
| both | not the other VAT role's current account | `vat_roles_must_differ` |
| both | not in the other VAT role's history/default | `vat_account_reserved_by_other_vat_role` |
| both | not a cash/bank account (bound record **or** `1110`/`1120`) | `vat_cash_bank_account` |
| both | not currently mapped to any other role | `vat_account_in_other_role` |
| both | clean (no journal lines) unless in the role's own set (current, system default, history) | `vat_account_not_clean` |
| any other role | must not take a VAT-reserved account (1150/2120 or any account in a VAT role's history) | `account_reserved_for_vat` |
| both | existing checks: exists in tenant, active, not a group | unchanged `422` message, no `reason` |

First failing rule wins (order above). `DELETE` (reset) runs the same checks with the system default as target (cleanliness waived).

## 4. Report contract (additive)

```jsonc
// GET /api/reports/tax-report
{ "input_vat": "75.00", "output_vat": "150.00", "net_vat": "75.00", "status": "payable",   // unchanged
  "verification": { "verified": true, "status": "verified", "issues": 0 },                  // new
  "warnings": [],                                                                           // new: [{code, role_key, account_id, account_code, message}]
  "accounts": { "input": [{"account_id","code","name","sources":["current","system_default","history"]}], "output": [...] } } // new
```

Warning codes (any warning ⇒ `verified: false`; the **status** distinguishes whether it touches the reported figures — see §12): `vat_role_accounts_overlap`, `vat_account_type_mismatch`, `vat_account_cash_bank`, `vat_account_mapped_to_other_role`, `vat_account_pre_mapping_activity`, `vat_account_unaudited_history`, `vat_account_non_vat_source` (period/branch-scoped; sources that never carry VAT: payments, payroll, stock movements/permits/counts, inventory openings, cash/bank transfers — a **deny**-list, so an unlisted legitimate source is never a false alarm).

`GET /api/accounting-settings/account-routing` → each `roles[].mapping` gains `violations: [{code, message}]` (`[]` when compliant). `state` keeps its meaning (see decision report §11, deviation 1).

## 5. Accounting examples and journal-impact analysis

**This change posts nothing and rewrites nothing.** There is no new financial operation, so there is no new journal entry. The entries below are the *existing* ones, shown to prove where VAT lands and how the report reads them.

| Operation (existing posting, unchanged) | Account | Debit | Credit |
|---|---|---:|---:|
| Credit sale 1,000.00 + 15 % VAT (mapped `tax_output` = custom `2125`) | 1130 Receivable | 1,150.00 | |
| | 4110 Sales | | 1,000.00 |
| | **2125** (role `tax_output`) | | 150.00 |
| Purchase 1,000.00 + 15 % VAT (mapped `tax_input` = custom `1158`) | purchase expense / inventory (by product) | 1,000.00 | |
| | **1158** (role `tax_input`) | 150.00 | |
| | 2110 Payable | | 1,150.00 |
| Credit note on that sale (REM-06: hard-coded `2120`) | 4110 Sales | 1,000.00 | |
| | **2120** (system, hard-coded) | 150.00 | |
| | 1130 Receivable | | 1,150.00 |
| Reversal of a posted invoice entry | exact mirror of the original lines | | |

Report reading (all amounts in SAR):

| Scenario | Before (code-based `2120`) | After (role-account set) |
|---|---:|---:|
| Default tenant, one sale + one purchase 500.00 | out 150.00 / in 75.00 | **identical**, `verified` |
| Jan sale on `2120`; remap to `2125`; Feb sale on `2125` | out **150.00** (Feb VAT invisible) | out **300.00**; Jan-only 150.00; Feb-only 150.00 |
| Three remaps + reset (4 periods, 1 sale + 1 purchase each) | under-stated | out 600.00, in 600.00, net 0.00; each month 150.00/150.00 |
| Full credit note after remap (original on `2125`, note on `2120`) | out −150.00 (wrong sign/basis) | out **0.00** (150.00 credit − 150.00 debit), `verified` |
| Invoice posted then reversed | — | out 0.00 |
| Legacy: `tax_input` mapped to `2120` | in = `1150` only (mapping ignored) | same figures (`2120` attributed to output only, no double count) but **unverified** (`vat_role_accounts_overlap`) |

Effects: trial balance, balance sheet, ledger and every account balance are **unchanged** (no entry touched; Σ debit = Σ credit asserted after each scenario). Only the *tax report* figure changes, and only for tenants that previously remapped a VAT role.

## 6. Existing invalid assignments (grandfathering)

* A legacy mapping (e.g. `tax_output` → a revenue account) **still posts invoices** (test posts one and sees the VAT credited to it).
* It is flagged in `account-routing` (`violations`) and in the tax report (`unverified` + warnings).
* It can only be changed to a rule-compliant account; rejected attempts leave mappings, events and ledger byte-identical (test).

## 7. Remaining risks — REM-06 and Fiscal Close

1. **Hard-coded VAT posters (REM-06).** `CreditNoteService`, `ReturnService` (sales side), `ExpenseService`, `AssetService`, `PosExchangeService` still post to `2120`/`1150` regardless of mapping. After a remap the **report is complete** (system accounts are in the set), but **GL-by-account is split** across the old and new account. Tested.
2. **Fiscal Close.** `FiscalCloseService::roleBalance` reads **only the current role account**, so the close readiness `vat_balances` line shows 150.00 where the report shows 300.00 after a remap (test `fiscal_close_reads_only_the_current_role_account…`). Informational line only (not a blocker); **not modified** per scope; unify under REM-06. Since review round 1 the **tax report discloses** the difference (§12); the Fiscal Close screen itself does not (that needs a change in `FiscalCloseService` — owner approval required).
3. **Contaminated history stays visible.** Warnings persist after the tenant remaps away from a contaminated account. Since review round 1 they only turn a period `unverified` when the account actually moved in that period (§12); a durable *clean* verdict still needs an attestation mechanism (schema + decision) — deferred.
4. **Unknown blast radius.** No production visibility; the read-only operator audit is specified (decision report §5.3) but **not shipped or run**. Enforcement only affects future writes; the report change is identical for non-remapped tenants.
5. **P4 strictness.** A tenant with an already-used custom VAT account must move to a clean account (ordinary journal entry) — by design (D-3).
6. **Other roles** (AR/AP/revenue…) still lack *type* validation; only the VAT-reserved rule applies to them. Recommend a follow-up slice.
7. **Report cost.** `taxReport` adds ~5 tenant-scoped queries (mappings, events, accounts, cash/bank, 2 aggregates). Negligible at current scale; no N+1.

## 8. Tests and results

| Suite | Result |
|---|---|
| `VatRoleIntegrityTest` (27) — each invalid category ⇒ 422 + `reason` (every non-liability/non-asset type, other VAT role's system account, cash/bank by record and by system code, other-role account, shared account, other-role history, VAT-reserved account to another role, unclean target; clean/system/own-history exemptions; inactive/group/foreign); valid custom mappings (+ posting lands there); reset; default tenant unchanged & verified; **report before/after remap and per period**; multiple remaps (history chain, input & output); reversal nets to zero; credit note via hard-coded `2120` after remap still counted; branch filter; overlap, type/cash-bank/other-role contamination, pre-mapping activity, unaudited history, non-VAT source (period-scoped); legacy invalid mapping still posts + flagged; no mapping/event/ledger rewrite (full snapshot compare); tenant isolation; Fiscal Close dependency | SQLite ✅ 27/27 · PostgreSQL ✅ 27/27 (local) |
| `VatRoleIntegrityPostgresTest` (2) — 5 rounds of `tax_input` vs another role racing for one account via forked processes (exactly one winner, no 40P01); mapping vs ledger post on the same clean account | PostgreSQL ✅. **Mutation check:** with the tenant lock removed both mappings win and the test fails ⇒ the test is live |
| Existing accounting regressions (`AccountRoutingTest`, `SalesPaymentAccountRoutingTest`, `PurchaseAccountRoutingTest`, `InventoryCogsAccountRoutingTest`, `GeneralReportTest`, credit-note/return/fiscal-year suites) | ✅ unchanged and green (no existing test was edited) |
| Web: `account-routing` page (6), `TaxCard` (2 new), accounting-settings + reports + lib suites (73 files / 456 tests) | ✅ · `next build` ✅ |
| Local full `php artisan test` (SQLite) | 6,725 passed · 91 skipped · 38 failed — **all 38 environmental, none in touched code**: 26 Fuel tests need PHP `bcmath` (absent in this sandbox; CI installs it, `ci.yml` L97); 12 (`AuthRecoveryTest`, `UserInvitationTest`, `ResendMailTransportTest`) failed only because the local Laravel overlay lacked `app/Mail` + `resources/views` — after syncing them those 24 tests pass |
| Local PostgreSQL accounting subset | run interrupted before its summary; the only failures seen were the same Fuel/`bcmath` cases. CI pgsql (full suite) is authoritative |

#### Final verification after review rounds 1–2 (code head `0a76049`, `main` @ `51851c0` merged in)

| Run | Result |
|---|---|
| `VatRoleIntegrityTest` (36) + `VatRoleIntegrityPostgresTest` (2) | SQLite ✅ 36/36 · PostgreSQL ✅ (forked-process concurrency included) |
| Local full `php artisan test` (SQLite) | 6,774 passed · 93 skipped · **26 failed — all in 6 Fuel test classes that need PHP `bcmath`** (not installed in this sandbox; `ci.yml` installs it). None in accounting/report/routing code |
| Local PostgreSQL accounting subset (`VatRole`, `AccountRouting`, `GeneralReport`, `FiscalYear`, `CreditNote`, `ReturnSourceVat`, Sales/Purchase routing) | 314 passed · 1 skipped · 0 failed |
| Web (`vitest run`, all) | 591 files · 6,362 tests ✅ · `next build` ✅ (`tsc` clean for the touched files) |
| `FiscalCloseService`, Fiscal Close screen | **not modified** (`git diff origin/main` empty for both) |

**CI (GitHub Actions) is the authoritative full run** — see §9.

## 9. CI / Build status

| Head | `php artisan test (L11, sqlite)` | `(L11, pgsql)` | `CI Gate` | `web build (Next.js)` |
|---|---|---|---|---|
| `3a5951e` (first implementation) | ✅ | ✅ | ✅ | ✅ |
| `faa9308` (docs) | ✅ | ✅ | ✅ | ✅ |
| `72a27b8` (review round 1 + main merge) | superseded | superseded | superseded | superseded (its check suite completed with no failure; per-job results not recorded here) |
| **`0a76049` (code head, review round 2)** | ✅ | ✅ | ✅ | ✅ (both web jobs) |

The ZATCA SDK advisory workflow is not triggered (no path match). The final head adds only this report on top of `0a76049`; its CI is re-checked and noted on the PR.

## 10. Branch / PR / SHAs

| Item | Value |
|---|---|
| Branch | `feat/rem05-acc01-vat-role-integrity` |
| PR | #1457 (Draft, **not merged, not deployed**) → `main`. Supersedes Phase-1 docs PR #1453 (its commit is included; #1453 left open) |
| Original base | `main` @ `a9f4acfc7a8b4fbc4353dccb04705184c1f5d10c` |
| Current base merged in | `main` @ `51851c0` (REM-04 follow-up #1461), merge commit `d3a6774` — no conflicts |
| Code head (verified by CI, all four checks green) | `0a7604913ecb85cb8f440b6b0c178bf01942361a` |
| Final head | head of PR #1457 = `0a76049` + one docs-only commit (this report); no code change |

## 12. Review round 1 — verification semantics, historical overlap, Fiscal Close disclosure

Scope: report layer only (`VatRoleIntegrityService`, `ReportService::taxReport`, `ReportController`, web `TaxCard`). **No** change to posting, `FiscalCloseService`, REM-06 posters, schema, routes or permissions. The PR carried no recorded review comments; the three items were taken from the owner's titles and interpreted as below — please correct the interpretation if it differs.

| # | Review item | Change |
|---|---|---|
| 1 | VAT report verification semantics | `verified` used to read as "the VAT is correct". It now means only *passed the listed role-account integrity checks*. `verification` gains `basis: role_account_integrity`, `checks[]` (each detector: `passed` / `notice` / `failed`) and `not_checked[]` (`invoice_to_ledger_reconciliation`, `manual_journal_content`, `zatca_clearance`, `vat_return_filing`) so the response states what was **not** verified. Status is tri-state: `verified` · `verified_with_notices` · `unverified`; `verified` (boolean) stays conservative — `true` only when there is no warning at all. `issues` now counts warnings that affect the reported totals, `notices` the rest. |
| 2 | Historical overlap / unverified warnings | Every warning carries `affects_totals`: true when its account has movement inside the requested scope (period **and** branch filter), false otherwise. A historical overlap or a contaminated old account therefore makes only the periods where it moved `unverified`; other periods are `verified_with_notices` and the warning remains listed (never hidden). Overlap attribution by account type is unchanged. |
| 3 | Fiscal Close discrepancy disclosure | New additive `disclosures[]` on the tax report: per VAT role, `fiscal_close_vat_control_differs` with `current_account_code`, `current_balance` (exactly what Fiscal Close readiness shows: current role account, all time, all branches), `set_balance` (the report's role-account set on the same basis), `difference` and an Arabic message. Independent of the selected period, and it does **not** change the verification state. A test asserts the disclosed `current_balance` equals the number `FiscalCloseService::readiness` returns. |

Web: `TaxCard` shows a red alert only for `unverified`, a neutral notice (with the unaffected warnings) for `verified_with_notices`, and a separate "Difference from the Fiscal Close line" block; older APIs without `status` keep working.

Accounting example (default chart; sale 1,000.00 + 15 % on 2026-01-10 credited to a legacy revenue-typed `tax_output` account `4999`, remap to liability `2125` before the 2026-02-10 sale):

| Request | output VAT | status | note |
|---|---:|---|---|
| January | 150.00 | `unverified` | `4999` moved (type mismatch affects totals) |
| February | 150.00 | `verified_with_notices` (`verified:false`) | `4999` has no February movement ⇒ `affects_totals:false` |
| All time | 300.00 | `unverified` | |

Journal impact: none (read-only). Tests added (4, SQLite + PostgreSQL): `verification_declares_what_was_checked_and_what_was_not`, `a_contaminated_historical_account_only_taints_the_periods_it_moved_in`, `a_historical_role_overlap_is_a_notice_without_movement_and_a_failure_with_movement`, `the_report_discloses_the_fiscal_close_vat_line_difference_with_the_same_numbers_the_close_shows`; web: 3 new `TaxCard` tests.

### Owner decisions on review round 1 (recorded)

1. **Verification semantics — APPROVED.** `verified` refers only to VAT role-account integrity; never filing readiness, ledger reconciliation or ZATCA compliance. Enforced in the contract (`basis`, `checks`, `not_checked` in every status) and in the UI (a permanent scope caption under the report heading).
2. **Period-aware warnings — APPROVED CONDITIONALLY.** An issue outside the requested figures may be a historical notice; **any issue that affects the requested figures keeps them `unverified`**. Condition met and tested (see below).
3. **Fiscal Close disclosure — APPROVED IN THE VAT REPORT ONLY.** `FiscalCloseService` and the Fiscal Close screen are **not** modified in REM-05; showing the disclosure there is deferred to REM-06 or a separate approved task.

`verified_with_notices` therefore means only *"role-account checks passed; some warnings concern accounts with no movement in this scope"*. It never implies filing readiness or a completed Fiscal Close reconciliation, and a real reconciliation discrepancy stays disclosed (`disclosures[]`, warning-toned block) in every status.

Review-round-2 tests (SQLite + PostgreSQL), all asserting both sides of the boundary:
`period_boundaries_are_inclusive_and_any_movement_in_scope_keeps_the_figures_unverified` (single-day scope, inclusive `from`/`to`, month boundary 31 Jan/1 Feb, all-time) ·
`a_reversed_movement_still_counts_as_movement_in_both_the_original_and_the_reversal_period` (net-zero all-time stays unverified; reversal-only month unverified; later month notice) ·
`a_historical_role_overlap_respects_the_same_inclusive_boundaries` ·
`the_branch_filter_decides_whether_a_contaminated_account_moved_in_scope` (movement in branch A / unallocated line; branch B ⇒ notice; no filter ⇒ unverified) ·
`verification_and_warnings_never_cross_tenants` · plus `not_checked` asserted in the notices state. Web: 5 `TaxCard` tests (states, scope caption, disclosure kept in every state).

### Outstanding risks after review rounds 1–2

1. **REM-06 / Fiscal Close (unchanged, deferred by owner decision).** After a remap the ledger is split across old/new accounts and the Fiscal Close readiness line still shows the current role account only. REM-05 *discloses* the difference in the VAT report; it does not show it on the Fiscal Close screen and does not reconcile it.
2. **`verified_with_notices` is not clearance.** It means only that role-account checks passed and the warnings concern accounts with no movement in the requested scope; the report's `not_checked` list and the scope caption say so. A downstream consumer must not treat it as filing readiness.
3. **Movement-based scoping is conservative, not exhaustive.** A warning on an account that moved in scope always keeps the figures `unverified`, even if the contaminating lines are outside the scope (pre-mapping activity cannot be dated per line). A durable clean verdict still needs an attestation mechanism — deferred.
4. **Deny-list source detector** (`vat_account_non_vat_source`) only catches known non-VAT sources; unknown contamination by a legitimate-looking source is not detectable here.
5. **Local environment gaps** (not product issues): PHP `bcmath` absent (26 Fuel tests); CI is authoritative for those.
6. **Production blast radius unknown** — no production access; the read-only operator audit is specified, not run.

## 11. Next recommended step

1. Owner review of this Draft PR (accounting rules in §3, report contract in §4 and §12). **Stop here — no merge/deploy without explicit approval.**
2. **REM-06** (semantic routing of the remaining hard-coded VAT posters and the Fiscal Close VAT control line) — removes risks 1–2.
3. Operator-run read-only audit of remapped tenants (no production access from this work) before rollout.
4. Optional: attestation to clear historical `unverified`, and type validation for the remaining roles.
