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

Warning codes (any one ⇒ `verified: false`): `vat_role_accounts_overlap`, `vat_account_type_mismatch`, `vat_account_cash_bank`, `vat_account_mapped_to_other_role`, `vat_account_pre_mapping_activity`, `vat_account_unaudited_history`, `vat_account_non_vat_source` (period/branch-scoped; sources that never carry VAT: payments, payroll, stock movements/permits/counts, inventory openings, cash/bank transfers — a **deny**-list, so an unlisted legitimate source is never a false alarm).

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
2. **Fiscal Close.** `FiscalCloseService::roleBalance` reads **only the current role account**, so the close readiness `vat_balances` line shows 150.00 where the report shows 300.00 after a remap (test `fiscal_close_reads_only_the_current_role_account…`). Informational line only (not a blocker); **not modified** per scope; unify under REM-06.
3. **Contaminated history is sticky.** Warnings persist after the tenant remaps away from a contaminated account; clearing needs an attestation mechanism (schema + decision) — deferred.
4. **Unknown blast radius.** No production visibility; the read-only operator audit is specified (decision report §5.3) but **not shipped or run**. Enforcement only affects future writes; the report change is identical for non-remapped tenants.
5. **P4 strictness.** A tenant with an already-used custom VAT account must move to a clean account (ordinary journal entry) — by design (D-3).
6. **Other roles** (AR/AP/revenue…) still lack *type* validation; only the VAT-reserved rule applies to them. Recommend a follow-up slice.
7. **Report cost.** `taxReport` adds ~5 tenant-scoped queries (mappings, events, accounts, cash/bank, 2 aggregates). Negligible at current scale; no N+1.

## 8. Tests and results

SEE_TEST_RESULTS

## 9. CI / Build status

SEE_CI_STATUS

## 10. Branch / PR / SHAs

SEE_BRANCH_INFO

## 11. Next recommended step

1. Owner review of this Draft PR (accounting rules in §3, report contract in §4).
2. **REM-06** (semantic routing of the remaining hard-coded VAT posters and the Fiscal Close VAT control line) — removes risks 1–2.
3. Operator-run read-only audit of remapped tenants (no production access from this work) before rollout.
4. Optional: attestation to clear historical `unverified`, and type validation for the remaining roles.
