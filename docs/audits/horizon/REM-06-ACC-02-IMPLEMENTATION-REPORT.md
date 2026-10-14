# REM-06 / ACC-02 — Implementation Report: semantic VAT account routing

STATUS: **MERGED** (PR #1473, merge `76b05f69a32fb7d2c5d741708661261dfc01d6cf`) · **CI verified** · **Production deployment NOT VERIFIED**

> **Status correction (2026-10-14, post-merge).** This report was authored while the change was a Draft PR ("NOT MERGED"). Current verified state: PR #1473 merged, merge SHA `76b05f69a32fb7d2c5d741708661261dfc01d6cf`, post-merge `CI` run #9596 (sqlite + pgsql) success; **production deployment NOT VERIFIED**. On the PR head `cb3779a` the first pgsql attempt hit the 60-minute job timeout (cause undetermined) and passed on re-run. The Fiscal Close VAT line follow-up (§9 item 1) remains open. The body below is otherwise unchanged and still describes the state at authoring; where it says "Draft" or "not merged" this note supersedes it. Cross-horizon status: `TAX-ZATCA-RECONCILIATION-AUDIT.md`.
DATE: 2026-10-14 · ZONE: C — tax / accounting
Contract & decisions: `REM-06-ACC-02-ACCOUNTING-DECISION-REPORT.md` (R6-1/R6-2 = Option A approved; R6-3 not applicable).

> Not legal or tax advice. Nothing here establishes ZATCA compliance, filing readiness or production readiness. All current AWJ data is experimental per the owner; nothing was deleted, reset, migrated or rewritten.

## 1. What was implemented

New commercial documents resolve the VAT role **in force at posting time** through the existing `AccountRoleResolver` (no inheritance of the source document's account). Missing or inactive mapping ⇒ fail closed (no entry, document stays draft). Amounts, rounding, totals, partner/cost-centre/branch tagging, transaction boundaries and every non-VAT account are unchanged.

| Service | Before | After | Policy |
|---|---|---|---|
| `ExpenseService::post` | Dr `1150` (code) | Dr `tax_input` role | originating document (as `PurchaseService`, ACC-4) |
| `AssetService::post` | Dr `1150` | Dr `tax_input` role | originating document |
| `ReturnService::postSalesReturn` | Dr `2120` | Dr `tax_output` role | R6-1 |
| `CreditNoteService::salesLines` | Dr `2120` | Dr `tax_output` role | R6-1 (source-linked and standalone) |
| `CreditNoteService::purchaseLines` | Cr `1150` | Cr `tax_input` role | R6-2 |
| `ReturnService::postPurchaseReturn` | Cr `tax_input` role | unchanged | ACC-4 preserved |
| `PosExchangeService` | no VAT posting | **unchanged** (return leg → `ReturnService`, replacement leg → `InvoiceService`) | — |
| `LedgerService::reverse` | mirrors original lines | unchanged | original concrete accounts preserved |
| `FiscalCloseService` | reads current role account only | **unchanged** | follow-up |

## 2. Changed files

| File | Change |
|---|---|
| `app/Services/Accounting/ExpenseService.php` | inject `AccountRoleResolver`; `tax_input` |
| `app/Services/Accounting/AssetService.php` | same |
| `app/Services/Accounting/ReturnService.php` | `ACC_OUTPUT_VAT` removed; `tax_output` role (resolver already injected) |
| `app/Services/Accounting/CreditNoteService.php` | inject resolver; `ACC_OUTPUT_VAT`/`ACC_INPUT_VAT` removed; roles |
| `tests/Feature/VatSemanticRoutingTest.php` (new, 11) | expense & asset routing |
| `tests/Feature/VatAdjustmentRoutingTest.php` (new, 15) | returns, notes, reversals, fail-closed, isolation |
| `tests/Feature/VatPosExchangeRoutingTest.php` (new, 1) | POS exchange legs |
| `tests/Feature/VatAdjustmentRoutingPostgresTest.php` (new, 1) | remap ↔ return post race (PostgreSQL) |
| `tests/Feature/VatRoleIntegrityTest.php` | **one REM-05 test updated** (see §6) |
| `docs/audits/horizon/REM-06-*.md`, `TAX-HZ-00-REMEDIATION-BACKLOG.md`, `CLAUDE.md` | decisions, reports, status |

Not changed: `PosExchangeService`, `FiscalCloseService`, `LedgerService`, `AccountRoleResolver`, `VatRoleIntegrityService`, schema/migrations, routes, APIs, permissions, VAT rates/rounding, ZATCA XML/QR/ICV/PIH/submission, GitHub settings, `web/`.

## 3. Final journal tables (halalas; sale 1,000.00 + 15 % posted on `2120`, `tax_output` then remapped to `2125`)

| Document | Account | Debit | Credit |
|---|---|---:|---:|
| Sales return — default mapping (identical to before) | 4110 | 100000 | |
| | 2120 | 15000 | |
| | 1130 | | 115000 |
| Sales return — **after remap** | 4110 | 100000 | |
| | **2125** | 15000 | |
| | 1130 | | 115000 |
| Sales credit note — after remap (source-linked and standalone) | 4110 / **2125** / 1130 | 100000 / 15000 / – | – / – / 115000 |
| Purchase debit note — default | 2110 | 115000 | |
| | 5115 | | 100000 |
| | 1150 | | 15000 |
| Purchase debit note — after `tax_input` → 1158 | 2110 / 5115 / **1158** | 115000 / – / – | – / 100000 / 15000 |
| Purchase return (ACC-4) — after remap | **1158** | | 15000 |
| Expense 1,000.00 + 15 % cash — after `tax_input` → 1158 | 5130 / **1158** / 1110 | 100000 / 15000 / – | – / – / 115000 |
| Asset 10,000.00 + 15 % cash — after remap | 1210 / **1158** / 1110 | 1000000 / 150000 / – | – / – / 1150000 |
| Rounding case 333.33 @ 15 % → 50.00 (after remap) | 4110 / 2125 / 1130 | 33333 / 5000 / – | – / – / 38333 |
| `LedgerService::reverse` of the sales return, after remap | 2120 (**original**) | | 15000 |
| POS exchange (100.00 → 100.00), return leg, after remap | 4110 / **2125** / 1130·1110 | 10000 / 1500 / – | – / – / 11500 |
| POS exchange, replacement invoice leg | 2125 | | 1500 |

Resulting balances / reconciliation (invoice → remap → full return): `2120` Cr 150.00, `2125` Dr 150.00; REM-05 report output VAT **0.00, `verified`**; Fiscal Close line (current account only) −150.00 and REM-05 `disclosures[]` = {current −15000, set 0, difference 15000} — **still disclosed, not reconciled**. POS exchange: `2125` net 0, `2120` Cr 15.00, report 15.00 `verified`. Σ debit = Σ credit asserted in every test and over the whole ledger.

## 4. Backward compatibility, isolation, safety

* **Default mappings:** journals are byte-identical to `main` (asserted per document type). **Posted records:** untouched (invoice journal compared before/after; reversal mirrors original accounts).
* **Tenant isolation:** mapping and accounts resolve through tenant-scoped models; a test remaps tenant A and posts a return in tenant B — B stays on its own `2120`, A's `2125` is invisible to B.
* **Branch:** the VAT role is company-wide (`CompanyWide` mapping); the entry keeps its branch tag (VAT line carries the branch id); report branch filters unaffected.
* **Fail closed / atomic:** inactive or unmapped role ⇒ exception/422, no journal entry, document remains draft, balances untouched; zero-VAT documents need no mapping.
* **No duplicate postings:** re-posting a posted document is rejected; exactly one entry per source.
* **Concurrency (PostgreSQL):** 5 rounds of a real forked-process `ReturnService::post` vs `setMapping('tax_output', …)`: both succeed, no `40P01`, exactly one balanced entry per return, the VAT line lands on exactly one of the two valid accounts, and the REM-05 report is `0.00 / verified` whichever order won.
* **Unchanged on purpose:** VAT calculation, rates, rounding, document totals, non-VAT hard-coded accounts.

## 5. Tests and results

| Run | Result |
|---|---|
| New tests (17) — SQLite | ✅ 16 + 1 PG-only skipped |
| New tests + `VatRoleIntegrity*` + `PostgresTestLockTimeout` — PostgreSQL (local, `PGOPTIONS='-c lock_timeout=60s'` as in `ci.yml`) | ✅ 69 passed |
| **Mutation check:** old `ReturnService`/`CreditNoteService` against the new tests | 10 of 16 fail ⇒ the tests detect the change |
| Existing `Return*`, `CreditNote*`, `PosReturn*`, `PosExchange*`, `Refund*` suites | ✅ 581 passed (unchanged) |
| Local full `php artisan test` (SQLite), head `b09559c` | 6,800 passed · 94 skipped · 27 failed = 26 Fuel tests (PHP `bcmath` absent in this sandbox; same as `main`) + 1 REM-05 test fixed in `7032340` (§6) |
| Local PostgreSQL broad subset | all green except the 5 Fuel/`bcmath` tests, the lock-timeout guard (needs `PGOPTIONS`, set in CI) and the same REM-05 test, now fixed |
| Web | no frontend change ⇒ Web CI not required |

## 6. Transparency: one existing test changed

`VatRoleIntegrityTest::a_credit_note_posted_to_the_hard_coded_account_after_a_remap_is_still_reported` (REM-05) asserted the *old* behaviour — credit note debits hard-coded `2120` — which R6-1 intentionally replaces. CI on `b09559c` was red because of it. It now asserts the same scenario under the approved behaviour (note debits `2125`; report 0.00 `verified`; GL split 2120/2125; Fiscal Close disclosure {−15000, 0, 15000}). The assertions on totals, balance, verification and disclosure were kept; only the account expectation changed.

## 7. CI / Build

| Head | sqlite | pgsql | CI Gate | Note |
|---|---|---|---|---|
| `da92e24` (expense/asset only) | see PR checks | see PR checks | see PR checks | superseded |
| `b09559c` (returns + notes) | ❌ | ❌ | ❌ | one REM-05 test asserted the old hard-coded `2120` (§6) |
| `7032340` (test updated) | pending at the time of writing | pending | pending | final results are recorded on the PR |
| `cb3779a` (final PR head, report-only on top of `7032340`) | ✅ attempt 1 | ✅ attempt 2 (attempt 1 hit the 60-minute job timeout and was cancelled; cause undetermined — not a lock wait, not a code regression; test hang vs runner stall unknown) | ✅ re-run (the first Gate run failed only because of the cancelled pgsql job) | recorded 2026-10-14 from the GitHub Actions API; post-merge `CI` run #9596 on `76b05f6` also ✅ (sqlite + pgsql) |

Web CI: not applicable (no `web/` change). The final head is re-verified on the PR; see the closing PR comment.

## 8. Branch / PR / SHAs

| Item | Value |
|---|---|
| Branch | `feat/rem06-acc02-semantic-vat-routing` |
| PR | #1473 (Draft) → `main` — https://github.com/safwan5001-source/Nebrax/pull/1473 |
| Base | `main` @ `a8a950508d533805530c324d51595fe46cdaa682` (REM-05 merge) |
| Code head | `70323403d277893486cd0af50c7a8a805b956f64` |
| Final head | head of PR #1473 (code head + report-only commits); recorded on the PR |

## 9. Remaining risks and follow-ups

1. **Fiscal Close (separate follow-up, not modified):** `FiscalCloseService::roleBalance` reads only the current role account. After any remap the readiness VAT line differs from the REM-05 report by the pre-remap balance; REM-05 `disclosures[]` states the numbers. Reconciling (or showing the disclosure on the Fiscal Close screen) needs an approved change to `FiscalCloseService`.
2. **Account-level residuals after a remap** are by design under Option A (R6-1); any reclassification must be an explicit journal entry — never automatic. Nothing transfers historical balances.
3. **Non-VAT hard-coded accounts** remain (cash `1110`/`1120`, receivable `1130`, sales `4110`, payable `2110`, `5115`, `5116`, `1230`/`5160`…): a separate policy-bearing task (some are the `CashBankAccount` authority).
4. **Resolver read vs. post** inside one transaction uses the mapping valid at read time (same as `InvoiceService`/`PurchaseService`); the PostgreSQL race test shows consistent outcomes.
5. **Observation, not fixed (out of scope):** `Expense::nextDocumentNumber` produced a duplicate `EXP-YYYY-00001` when the active branch context changed between two expenses of the same tenant/year (hit `expenses(tenant_id, number)` unique constraint on SQLite). Worth a separate numbering review.
6. **Production exposure unknown** (no production access; read-only audits not run).
7. Passing these tests establishes routing correctness only — not ZATCA compliance, filing readiness or deployment readiness.

## 10. Recommended next task

Owner review of #1473 → merge decision; then a scoped **Fiscal Close VAT line** task (approve touching `FiscalCloseService` to read the role-account set or disclose the difference) and, separately, a policy task for the remaining non-VAT hard-coded accounts.
