# REM-06 / ACC-02 — Semantic VAT Account Routing: accounting contract & decision gate

STATUS: **PHASE 1 COMPLETE · OWNER DECISIONS R6-1/R6-2 = OPTION A (APPROVED), R6-3 NOT APPLICABLE · PHASE 2 IMPLEMENTED (see `REM-06-ACC-02-IMPLEMENTATION-REPORT.md`). Draft PR — not merged, not deployed.**
DATE: 2026-10-14 · ZONE: C — tax / accounting · BASE: `origin/main` @ `a8a950508d533805530c324d51595fe46cdaa682` (REM-05 merge)

> Not legal or tax advice. No statement of ZATCA compliance, filing readiness or production readiness. Owner clarification applied: all current AWJ data is experimental — this removes the need for legacy-data workarounds but **not** for correct, auditable, production-grade accounting. Nothing is deleted, reset, migrated or rewritten.

## 0. Summary

| Service | Hard-coded VAT reference (before) | Nature of the posting | Determined by approved policy? | Status |
|---|---|---|---|---|
| `ExpenseService::post` | `1150` debit (`ACC_INPUT_VAT`, L32/L153) | **Originating** document (creates input VAT) | **Yes** — same as `PurchaseService` (ACC-4: purchase VAT debits `tax_input`) | **Implemented** → `tax_input` role |
| `AssetService::post` | `1150` debit (`ACC_INPUT_VAT`, L34/L103) | **Originating** document | **Yes** — same rule | **Implemented** → `tax_input` role |
| `ReturnService::postSalesReturn` | `2120` debit (`ACC_OUTPUT_VAT`, L73/L601) | **Adjustment** document (optionally source-linked to an invoice) | **Yes — R6-1 (Option A, approved)** | **Implemented** → current `tax_output` |
| `CreditNoteService::salesLines` | `2120` debit (L53/L477) | Adjustment (source-linked to a posted invoice by default; standalone only when `sales.allow_standalone_credit_notes` is on — ADR-E, default off) | **Yes — R6-1 (Option A, approved)** | **Implemented** → current `tax_output` |
| `CreditNoteService::purchaseLines` | `1150` credit (L56/L516) | Adjustment (purchase notes may be source-linked or standalone) | **Yes — R6-2 (Option A, approved)** | **Implemented** → current `tax_input` |
| `ReturnService::postPurchaseReturn` | none — already `tax_input` role (L925) | Adjustment | **Yes — ACC-4 contract** ("reversed VAT credits `tax_input`") | unchanged (merged ACC-4 behaviour) |
| `PosExchangeService` | **no VAT posting** — its own entry is only the surplus refund Dr `1130` / Cr `1110` (L33-34, L338-345). VAT of an exchange is posted by `PosReturnService`→`ReturnService` (return leg) and `InvoiceService` (replacement leg) | — | n/a | **No VAT change needed**; its 1130/1110 are non-VAT (out of scope, §5) |

## 1. Approved policy that already governs this task

| Source | Rule | Consequence here |
|---|---|---|
| ACC-2 (`AccountRoleResolver`) | One resolution path: the explicit mapping; missing/inactive/group mapping **fails closed**; no legacy fallback | Every replaced reference must use the resolver, never fall back to `1150`/`2120` |
| ACC-4 contract (`docs/plans/accounting/ACC-4-purchase-account-routing.md` L34, L40) | Purchase Return "reversed VAT credits `tax_input`" (current role); "Existing posted … journals remain frozen. **Reversals use original concrete journal accounts.**" | Two distinct event types are already defined: a **new commercial document** resolves the role in force; a **journal reversal** (`LedgerService::reverse`) mirrors the original lines |
| ACC-5 (merged) | Sales return inventory / COGS / damage legs use the current `inventory_asset` / `cogs` / `inventory_damage_loss` roles | Same pattern already applied to the *sales* return's non-VAT legs |
| REM-05 D-6 | Valid VAT remapping is allowed now, before REM-06 | Postings after a remap must follow the remap |
| REM-05 report | Tax report = Σ over current ∪ system-default ∪ historical role accounts | Net VAT is identical whichever *role account* a posting uses; only per-account GL presentation differs |

## 2. Implemented in this PR (policy-determined only)

`ExpenseService` and `AssetService` inject `AccountRoleResolver` and debit `resolve('tax_input')` instead of the `1150` code. Amount, rate, rounding (`calcTax`), credit account, partner dimension, cost centre, branch tag and transaction boundaries are unchanged. A zero-rate document still has no VAT line and therefore needs no mapping.

Expense 1,000.00 + 15 % paid in cash (amounts in SAR):

| Account | Before REM-06 (any mapping) | After — default mapping | After — `tax_input` remapped to `1158` |
|---|---|---|---|
| 5130 expense | Dr 1,000.00 | Dr 1,000.00 | Dr 1,000.00 |
| Input VAT | Dr 150.00 on **1150 always** | Dr 150.00 on 1150 | Dr 150.00 on **1158** |
| 1110 cash | Cr 1,150.00 | Cr 1,150.00 | Cr 1,150.00 |

Asset acquisition 10,000.00 + 15 %: Dr 1210 10,000.00 · Dr `tax_input` 1,500.00 · Cr 1110 11,500.00 (same pattern).

Effects: default tenants post byte-identical journals; after a remap new input VAT lands in the configured account (previously it silently went to `1150`); invalid/unmapped `tax_input` now blocks the posting atomically (document stays draft, no entry) instead of posting to `1150` behind the configuration; REM-05 `disclosures` shrink because the current account now carries post-remap expense VAT. Existing posted entries are untouched.

## 3. Decision gate — sales returns and credit/debit notes (RESOLVED: Option A approved — see §3b)

The question is **which output/input VAT account an adjustment document uses after the VAT role has been remapped since the original invoice/purchase**. VAT amounts are not in question (they are already inherited from the source line — REM-01/REM-02).

### Options

* **A — Role in force at posting (current role).** Sales return and sales credit note debit `resolve('tax_output')`; purchase credit (debit) note credits `resolve('tax_input')`. Identical to the merged ACC-4 purchase-return rule and to the ACC-5 non-VAT legs.
* **B — Inherit the source document's VAT account.** For source-linked documents, reuse the account of the VAT line in the source invoice/purchase journal; standalone documents fall back to the current role (they have no source).
* **C — Hybrid.** Inherit when the source VAT account is still active and still in the role's REM-05 account set; otherwise use the current role.

### Example — invoice before the remap, full return after it

Invoice 2026-01-10: 1,000.00 + 150.00 VAT, VAT credited to `2120`. On 2026-02-01 `tax_output` is remapped to `2125`. Return of the whole invoice on 2026-02-15:

| Line | Option A | Option B / C |
|---|---|---|
| Dr 4110 sales | 1,000.00 | 1,000.00 |
| Dr output VAT | **2125** 150.00 | **2120** 150.00 |
| Cr 1130 receivable | 1,150.00 | 1,150.00 |

| Resulting balance | Option A | Option B / C |
|---|---|---|
| 2120 | Cr 150.00 (residual) | 0.00 |
| 2125 | Dr 150.00 | 0.00 |
| REM-05 tax report (role set) | output VAT 0.00, verified | output VAT 0.00, verified |
| Fiscal Close VAT line (reads current account `2125` only) | −150.00; REM-05 disclosure shows the 150.00 difference | 0.00; no disclosure |

(Today's code behaves like B **only by accident**: it always hits `2120`, so an invoice posted *after* the remap on `2125` and returned later is debited to `2120` — the split REM-06 exists to remove.)

### Implications

| Criterion | A — current role | B — inherit | C — hybrid |
|---|---|---|---|
| Net VAT / REM-05 report | exact | exact | exact |
| Per-account GL symmetry per document | no (residuals across old/new accounts after a remap) | yes | yes while the old account is valid |
| Consistency with merged code | **matches ACC-4 purchase return and ACC-5** | requires changing the merged purchase-return rule too, or leaving the two sides asymmetric | same as B |
| Standalone returns / purchase notes | natural | still current role ⇒ two rules in one service | two rules |
| Old account deactivated later | unaffected | **posting fails** (`LedgerService` rejects inactive accounts) — the return is blocked | silently switches rule ⇒ conflicts with "no silent fallback" unless disclosed |
| Legacy invalid source mapping (e.g. VAT on a revenue-typed account) | stops spreading the contamination | **perpetuates** it | perpetuates while "valid" |
| Mechanism | resolver only | must identify the VAT line inside the source journal (no line marker exists; inferred from the role set / mapping history at posting time) | same as B + a validity test |
| Typical ERP practice *(external, not verified in this session)* | tax account determined from the configuration at the adjustment's posting date | — | — |

**Recommendation: Option A**, applied to sales returns and to sales and purchase credit/debit notes. It extends a rule the owner already approved (ACC-4) to the symmetric documents, keeps one rule per service, needs no inference over historical journal lines, never blocks a return because an old account was closed, stops legacy contamination, and the REM-05 report and disclosure already make the account-level residual visible. **Journal reversals** (`LedgerService::reverse`) keep inheriting the original concrete accounts (ACC-4 L40) — this satisfies "original-document account inheritance" for reversals without a new mechanism.

### Owner decisions required

| ID | Decision | Recommendation |
|---|---|---|
| **R6-1** | Account for the VAT leg of **sales returns** and **sales credit notes** after a remap: A / B / C | **A** |
| **R6-2** | Account for the VAT leg of **purchase credit (debit) notes**: A / B / C — and, if B or C, whether the merged ACC-4 purchase-return rule should change to match | **A** (no change to ACC-4) |
| **R6-3** | Only if B or C: behaviour when the inherited account is inactive/invalid — fail closed (blocks the return) or fall back to the current role **with** an explicit disclosure | n/a under A |

Not decisions (already determined): Expense/Asset → current `tax_input` (implemented); standalone documents → current role; unmapped/invalid mappings fail closed; reversals mirror original lines; no data migration, no historical rewrite, `FiscalCloseService` untouched.

## 3b. Owner decisions (recorded) and final journal tables

| ID | Decision |
|---|---|
| **R6-1** | **Option A — APPROVED.** Sales returns and sales credit notes resolve the **current `tax_output`** role at posting time. |
| **R6-2** | **Option A — APPROVED.** Purchase credit/debit notes resolve the **current `tax_input`** role at posting time. The ACC-4 purchase-return policy is preserved. |
| **R6-3** | **Not applicable.** Source-linked adjustment documents do **not** inherit the original VAT account. |
| Distinction | New commercial adjustment documents use the current role. True journal reversals (`LedgerService::reverse`) preserve the original concrete journal accounts. |

Final journals (halalas; invoice 1,000.00 + 15 % posted on `2120` before `tax_output` is remapped to `2125`):

| Document | Account | Debit | Credit | Note |
|---|---|---:|---:|---|
| Sales return, default mapping | 4110 | 100000 | | identical to before |
| | 2120 (`tax_output`) | 15000 | | |
| | 1130 | | 115000 | |
| Sales return **after remap** | 4110 | 100000 | | |
| | **2125** (`tax_output`) | 15000 | | was hard-coded 2120 |
| | 1130 | | 115000 | invoice journal untouched |
| Sales credit note (source-linked or standalone) after remap | 4110 / **2125** / 1130 | 100000 / 15000 / – | – / – / 115000 | same shape |
| Purchase debit note, default | 2110 | 115000 | | |
| | 5115 | | 100000 | |
| | 1150 (`tax_input`) | | 15000 | |
| Purchase debit note **after remap** to `1158` | 2110 / 5115 / **1158** | 115000 / – / – | – / 100000 / 15000 | was hard-coded 1150 |
| Purchase return (ACC-4, unchanged) after remap | **1158** | | 15000 | already role-based |
| `LedgerService::reverse` of the sales return after remap | 2120 (original) | | 15000 | mirrors the **original** lines, never 2125 |
| POS exchange (100.00 → 100.00 replacement), return leg after remap | 4110 / **2125** / 1130·1110 | 10000 / 1500 / – | – / – / 11500 | via `ReturnService` |
| POS exchange, replacement leg | 2125 | | 1500 | via `InvoiceService` (unchanged) |

Balances after "invoice → remap → full return": `2120` Cr 150.00, `2125` Dr 150.00; REM-05 report output VAT = 0.00, `verified`; the Fiscal Close line (current account only) shows −150.00 and the REM-05 `disclosures[]` reports the 150.00 difference (current −15000, set 0, difference 15000 halalas). No automatic transfer, no rewrite.

## 4. Per-service contract details

| Service | Unmapped / invalid role | Tenant isolation | Branch | VAT report (REM-05) | Fiscal Close | Backward compatibility |
|---|---|---|---|---|---|---|
| Expense / Asset (implemented) | fail closed, no entry, document stays draft | mapping and account resolved through tenant-scoped models | branch tag of the entry unchanged | counted via the role set; disclosure shrinks | not modified; still reads the current account (now correct for new postings) | default mapping ⇒ identical journals; only remapped tenants change, as D-6 intends |
| Sales return / sales note (pending R6-1) | under A: fail closed | same | unchanged | counted either way | A leaves residuals visible via disclosure | default mapping ⇒ identical journals under every option |
| Purchase note (pending R6-2) | under A: fail closed | same | unchanged | counted either way | as above | as above |

## 5. Found and left out of scope (non-VAT hard-coded accounts)

`ReturnService` sales side `1110`/`1130`/`4110`, `5116`; `CreditNoteService` `1110`/`1130`/`4110`/`2110`/`5115`; `ExpenseService`/`AssetService` credit side `1110`/`1120`/`2110`, depreciation `1230`/`5160`; `PosExchangeService` surplus refund `1130`/`1110`. These are not VAT accounts; routing them is a separate, policy-bearing task (some are cash/bank, whose authority is `CashBankAccount`, not a role).

Observation (not investigated, out of scope): in a test that switches branch context between two expenses of the same year, `Expense::nextDocumentNumber` produced `EXP-2026-00001` twice and hit the `expenses(tenant_id, number)` unique constraint on SQLite. Worth a separate look at branch-scoped numbering vs. that index.

## 6. Tests (this PR so far)

`tests/Feature/VatSemanticRoutingTest.php` (11, SQLite + PostgreSQL): default-mapping journals byte-identical (exact debit/credit table); remapped `tax_input` used; four sequential remaps incl. reset, each document on the role in force, earlier entries unchanged, REM-05 report 600.00 verified; rounding (333.33 × 15 % ⇒ 50.00) and zero-rate (no VAT line) unchanged; inactive mapped account ⇒ fail closed, no entry, draft kept, nothing on 1150; unmapped role ⇒ fail closed; zero-rate needs no mapping; asset acquisition default + remapped with exact amounts; invalid mapping blocks asset atomically; cross-tenant isolation; Fiscal Close disclosure now limited to pre-remap VAT. Existing suites `Expense*`, `Asset*`, `BranchAssetHrIsolationTest`, `DocumentExpenseDraftBuilderTest`, `CostCenterReportTest`: 94 passed, unchanged.

Local full `php artisan test` (SQLite) on `dfec09d`: 6,785 passed · 93 skipped · 26 failed — all 26 in the 6 Fuel test classes that need PHP `bcmath`, absent in this sandbox (CI installs it); identical to `main`. PostgreSQL (focused: routing, REM-05, Expense, Asset, cost-centre): 66 passed. CI on the PR head is authoritative.

The return / credit-note / POS-exchange / concurrency tests were added after the decision: `VatAdjustmentRoutingTest` (15), `VatPosExchangeRoutingTest` (1), `VatAdjustmentRoutingPostgresTest` (1) — see the implementation report.

## 7. Risks

1. (Resolved) Sales returns and credit/debit notes now follow Option A.
2. Option A leaves account-level residuals after a remap; REM-05 already discloses them; any reclassification is an ordinary, explicit journal entry (never automatic).
3. A remap committed between the resolver read and the ledger post inside one posting transaction uses the account valid at read time (same as `InvoiceService`/`PurchaseService`).
4. Fiscal Close still reads only the current account (not modified here — separate follow-up).
