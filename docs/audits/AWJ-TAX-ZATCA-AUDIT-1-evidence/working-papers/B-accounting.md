> **Working paper — unedited stream output.** Written before the official-source registers existed, so regulatory citations tagged `[official-ref to confirm]` were resolved afterwards; severities, normalised statuses, re-ratings and register citations in **AWJ-TAX-ZATCA-AUDIT-1.md** and **AWJ-TAX-ZATCA-GAP-MATRIX.md** prevail where they differ. Paths of the form `<audit-workspace>/…` refer to the audit workspace (probe sources, logs, SDK runs) that is not part of the repository; the relevant extracts are in `probe-outputs.md` and `sdk-validation-extracts.md`. **Superseded after review (PR #1290):** where a paper says the web UI was only read, or implies there is no web test suite, `web-test-results.md` and `web-test-mapping.md` give the results of the Vitest and Playwright runs; where a paper attributes a test failure to the sandbox, `test-results.md` shows the controlled attribution.

# Stream B — Accounting integration & VAT reporting (AWJ-TAX-ZATCA-AUDIT-1)

Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`. Audit date 2026-10-10. Prefix `ACC-`.
Verdict on the reporting question: **the system reconciles VAT in the ledger correctly, but it does NOT produce an auditable Saudi VAT return — it produces a 3-number control summary (input, output, net) read from two fixed account codes.** Details in ACC-03/ACC-04.

---

## 1. Scope & method

### 1.1 Files read (pinned repo, `path` — lines)
Fully read:
- `app/Services/Accounting/LedgerService.php` (231), `AccountingDateGuard.php` (116), `AccountingPeriodLockService.php` (213), `AccountRoutingService.php` (240), `AccountRoleResolver.php` (52), `AccountRoleMappingSeeder.php` (53), `ChartOfAccountsSeeder.php` (126)
- `app/Services/Accounting/InvoiceService.php` (1285), `PurchaseService.php` (636), `ExpenseService.php` (228), `CreditNoteService.php` (253), `CreditNoteOwnershipResolver.php` (74), `ReturnService.php` (853), `PosService.php` (775), `PosReturnService.php` (375), `PosExchangeService.php` (363), `ManualJournalService.php` (189), `FiscalCloseService.php` (684), `PaymentReversalService.php` (124), `PaymentGatewaySettlementService.php` (351)
- `app/Services/Reporting/ReportService.php` (853)
- `app/Models/JournalEntry.php` (33), `JournalLine.php` (40), `AccountBalance.php` (18), `Account.php` (61), `Invoice.php` (200), `CreditNote.php` (83), `DocumentRevision.php` (81), `BaseModel.php` (16)
- `app/Support/AccountingRoles.php` (233), `FiscalCloseJournals.php` (71), `RecordsRevisions.php` (101); `app/Tenancy/TenantScope.php` (21), `BelongsToTenant.php` (25)
- `app/Http/Controllers/Api/CreditNoteController.php` (58), `app/Http/Requests/StoreCreditNoteRequest.php` (47), `GeneralReportRequest.php` (25)
- `database/migrations/2025_01_01_000002_create_accounting_core.php` (118), `000004_create_invoices.php` (71), `000018_create_credit_notes.php` (63), `2026_09_09_010000_create_accounting_period_lock_tables.php` (60), `2026_09_10_010000_create_fiscal_year_tables.php` (94)
- `docs/plans/accounting/ACC-1/2/3/4/6.md`, `FISCAL-1.md`

Partially read (targeted sections): `PosSessionService.php` L600-690 of 997 (variance posting), `PaymentService.php` L271-400 of 580 (post), `AssetService.php` L85-135, `InventoryService.php` L400-430, `FiscalYearService.php` (update guard), `AccountManagementService.php` L105-135, `JournalEntryController.php` L15-75 + method list, `InvoiceController.php` (method list), `ReportController.php` L198-208, `FinancialControlService.php` L1-60, `Commerce/CommerceOrderService.php` + `CommerceCheckoutService.php` + `CommercePaymentIntentService.php` (grep for invoice/ledger calls), `StorefrontCheckoutController.php` L31, `routes/api.php` (reports/invoices/credit-notes/journals/locks/fiscal routes), `web/src/components/reports/general-advanced-reports-workspace.tsx` (tax tab L145, L196-204, L520-522), `web/src/messages/{ar,en}.json` L5230-5236, `Settings.php` (tax defaults L54/L163), `StoreInvoiceRequest.php` L67, tests `GeneralReportTest.php` L127-170, `AccountingPeriodLockConcurrencyTest.php`, `AccountRoutingTest.php`/`SalesPaymentAccountRoutingTest.php` (method lists), `ApiTenantIsolationTest.php`, `PosCheckoutTest.php` helpers, `InteractsWithApi.php`.
Grep sweeps (whole `app/`): direct journal writes (`JournalEntry::create|JournalLine::create|insert` → only `LedgerService` L61/75/122/133), `withoutGlobalScope(s)|DB::table|DB::select|toBase()|DB::raw` in accounting/reporting, hard-coded VAT codes/rates, `CREATE TRIGGER|DB::unprepared` in migrations (none), `'cancelled'` usage for invoices (none), Commerce → `InvoiceService` (none).

### 1.2 Probes written & run (all in `<audit-workspace>/probes/B/`, logs in `<audit-workspace>/logs/B-*.log`)
`SCR=<audit-workspace>`; run from `<harness>`.

| Probe | Command | Result |
|---|---|---|
| `BMixedScenarioProbeTest.php` (2 tenants; purchase w/ discount, cash invoice, 0%+15%+discount+shipping credit invoice, tax-inclusive invoice, expense, partial credit note, partial sales return, partial purchase return, manual VAT journal + reversal; TB / AccountBalance / VAT-vs-documents / period filter / tenant isolation / no-context hazard) | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/B-mix.sqlite php artisan test <audit-workspace>/probes/B/BMixedScenarioProbeTest.php` and same with `DB_CONNECTION=pgsql … DB_DATABASE=audit_b` | PASS on SQLite and PostgreSQL (10 assertions). Key output: TB March 371,323 = 371,323 balanced; Σ lines 717,777/717,777; AccountBalance mismatches `[]`; 2120 movement dr 11,500 / cr 45,300 → net 33,800 = Σ docs (I1 15,000 + I2 14,300 + I3 15,000 − CN 3,000 − R1 7,500); 1150 net 11,250 = P1 15,750 + E1 3,000 − PR 7,500; `taxReport(March)` = {input 11,250, output 33,800, net 22,550}; tenant B report 6,000/0; **no tenant context → `taxReport` returned {input 11,250 (A), output 6,000 (B)}, trial balance 15 rows merged across tenants**; VAT-line `branch_id` = NULL for service-level posts. |
| `BRoutingVatProbeTest.php` | `… DB_DATABASE=<audit-workspace>/db/B-route.sqlite php artisan test <audit-workspace>/probes/B/BRoutingVatProbeTest.php` | PASS. `PUT /api/accounting-settings/account-routing/tax_output` with account **4110 (revenue)** → **HTTP 200**; invoice journal `[1110 dr 115000][4110 cr 100000][4110 cr 15000]`; `taxReport` output_vat **0** while `invoices.tax_amount` = 15,000; credit note still debits **2120** → output_vat **−15,000**; sales return debits 2120; `setMapping('tax_output', 1150)` ACCEPTED; `setMapping('tax_input', 2120)` ACCEPTED; `setMapping('tax_input', 1110 cash)` ACCEPTED → purchase input VAT debited to **1110**; expense still debits 1150. |
| `BImmutabilityProbeTest.php` | `… DB_DATABASE=<audit-workspace>/db/B-imm.sqlite php artisan test <audit-workspace>/probes/B/BImmutabilityProbeTest.php` | PASS. Double `POST /invoices/{id}/post` → 422; `PUT` posted → 422; `DELETE` posted → 422; service re-post → RuntimeException; 1 journal per invoice. **Eloquent `update()` on posted invoice (tax_amount→1, total→1, invoice_date→2025-01-01) returned true**; `JournalLine->update(['credit'=>0])` true; `JournalEntry->update(['entry_date','status'=>'draft'])` true; `JournalEntry->delete()` true (lines cascaded, invoice still `posted` with `journal_entry_id = null`, AccountBalance 2120 stayed 15,000). `FinancialControlService::scan(true)` detected 1 (`posted_source_without_journal`). Credit note 10× original invoice → 201/200; credit note against a **draft** invoice → 201/200; credit note whose partner ≠ invoice partner → 201. Cross-tenant HTTP: account-ledger 404, invoice accounting 404, partner statement 404, tax report zeros, journal list 0. |
| `BPeriodLockProbeTest.php` | `… DB_DATABASE=<audit-workspace>/db/B-lock.sqlite php artisan test <audit-workspace>/probes/B/BPeriodLockProbeTest.php` | PASS. Lock Jan: draft dated 2026-01-15 created; post → `AccountingPeriodLockedException`, draft stays draft with no journal; reversal dated inside lock blocked; default-dated reversal ok (2026-10-10). Invoice dated 2026-03-15 posted on 2026-10-10 → `entry_date` 2026-03-15, `posted_at` 2026-10-10 → appears in March tax report, not October. **Future-dated invoice (2027-06-01) posted: ACCEPTED.** After releasing the lock, a credit note dated 2026-01-20 changed the "filed" January output VAT from 15,000 to **0**. No `VatReturn`/`TaxPeriod`/`TaxReturn` model exists. |
| `BPosApiProbeTest.php` | `… DB_DATABASE=<audit-workspace>/db/B-pos.sqlite php artisan test <audit-workspace>/probes/B/BPosApiProbeTest.php` | PASS. Checkout 2×10,000@15 with cash 10,000 + card 13,000 → credit invoice posted, journal `[1130 dr 23000][4110 cr 20000][2120 cr 3000]` all `branch=set`; two posted receipts (1110/1120 vs 1130); idempotent replay returns same invoice; **client `tax_rate=0` on a 15% product → invoice tax 15.00 (server rate wins)**; POS cash return blocked by cash-refund policy (refund > cash received) — expected; session close → 200 and **0 new journal entries**; `/api/reports/tax-report` output 60.00 = 6,000 halalas. |
| `B-double-post-pg.php` (standalone, `pcntl_fork`, 3 racing processes) | `DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=audit_b DB_USERNAME=audit DB_PASSWORD=audit php <audit-workspace>/probes/B/B-double-post-pg.php` | S1 invoice: `["OK posted","ERR …غير مسوّدة","ERR …غير مسوّدة"]`, **1 journal**; S2 purchase: 1 journal; S3 reverse same entry ×3: 1 reversal, original `reversed`; S4 lock-vs-post ×3 rounds: lock won each round, invoice not posted while lock active (no leak); ledger Σ 126,700 = 126,700; duplicate journal numbers 0. |

Existing repo tests run (targeted only):
- PostgreSQL `audit_b`: `php artisan test --filter='AccountingPeriodLockConcurrencyTest|FiscalYearConcurrencyTest'` → **7 passed (24 assertions)** (these are PG-only two-connection lock tests; they ran for real, not skipped).
- PostgreSQL `audit_b`: `--filter='LedgerTest|GeneralReportTest|AccountingPeriodLockTest|FiscalYearCloseTest|PaymentReversalTest|CreditNoteTest|DebitNoteTest|SalesPaymentAccountRoutingTest'` → **117 passed (484 assertions)**.
- Note what `GeneralReportTest::tax_report_uses_only_posted_vat_account_movements` asserts (L127-152): only that `taxReport` sums account **codes** 1150/2120 for two hand-posted journals; it does not assert any document classification or routing behaviour.

Official sources used: ZATCA *VAT Guideline for Tax Invoicing and Records*, Version 3, May 2026 (English, extracted at `<audit-workspace>/official/R1-work/text/vat_tax_invoicing_records_guideline_EN.txt`; Arabic prevails): §4.5.1 Date of Supply (L910-930), §7 Credit and Debit Notes (L1314-1345, citing Implementing Regulations Art. 53/54 and Unified Agreement Art. 57), §7 table "Tax treatment in the Tax Return" (L1384-1400). Everything else is tagged `[official-ref to confirm]`.

---

## 2. Positive controls (VERIFIED IMPLEMENTED)

- **PC-1 Balanced entries enforced in one engine.** `LedgerService::validateBalanced` rejects <2 lines, negative amounts, dr+cr on one line, Σdr≠Σcr, zero entries (`LedgerService.php:158-187`); only `LedgerService` writes `journal_entries`/`journal_lines` (grep: `L61,75,122,133`; no other `JournalEntry::create`/`JournalLine::create`/raw insert in `app/`). Probe: Σ debit = Σ credit on both engines; `LedgerTest` green on PG.
- **PC-2 Totals derived from lines before posting.** `InvoiceService::post` recomputes subtotal/VAT/total from lines and writes them back (`L897-916`, `L1035-1056`); `PurchaseService::post` recomputes VAT on the post-discount base (`L415-452`, `L564-578`); `CreditNoteService::post` (`L136-139`), `ReturnService` (`L451-453`, `L736-752`), `ExpenseService::post` (`L146-148`). Probe: ledger VAT == stored `tax_amount` for every document type exercised.
- **PC-3 Idempotent posting & status machine, proven under real concurrency.** `lockForUpdate` + in-transaction status re-check in `InvoiceService.php:889-892`, `PurchaseService.php:395-398`, `ReturnService.php:403-406`, `PaymentService.php:279-282`, `ManualJournalService.php:112-115`, `LedgerService::reverse` `L112-115`; POS idempotency keys with checksum + unique constraint (`PosService.php:164-174`, `L97-113`). PG script: 3 processes racing `post()`/`reverse()` → exactly one journal / one reversal; API double-post → 422.
- **PC-4 Period locks enforced inside the engine for post and reverse, serialized on the tenant row.** `LedgerService.php:59,120` → `AccountingDateGuard::assertOpen` (`L46-62`), tenant filtered explicitly (`L67-84`), anchor lock (`L112-115`); lock CRUD has no delete and no overlap (`AccountingPeriodLockService.php:57-137`). Probes + repo PG tests (7 passed) + PG race S4.
- **PC-5 VAT postings reconcile to document totals; cache consistent.** Mixed scenario on SQLite and PG: 2120 net credit = Σ(invoice VAT) − Σ(credit-note VAT) − Σ(sales-return VAT); 1150 net debit = Σ(purchase VAT) + Σ(expense VAT) − Σ(purchase-return VAT); `AccountBalance` (`LedgerService::applyToBalance` L207-222) matched Σ lines for every account; trial balance balanced.
- **PC-6 Source linkage.** Every document journal carries `source_type/source_id` (Invoice L1007-1008, Purchase L504-505, CreditNote L151-152, Return L473-474/793-794, Expense L166-167, Payment L373-378, ManualJournal L133-134, FiscalYearClose L254-255, PosSession L653-660, Asset L113-120); reversals carry `reversal_of` (`LedgerService.php:127`). `FinancialControlService` detects posted documents whose journal is missing (probe: `posted_source_without_journal`).
- **PC-7 Tenant isolation over HTTP.** Probe: tenant B gets 404 on A's account ledger / invoice accounting / partner statement, zeros on tax report, empty journal list. `AccountingDateGuard` and `FiscalCloseJournals::exclude` filter tenant explicitly even where `TenantScope` would not (`AccountingDateGuard.php:67-80`, `FiscalCloseJournals.php:52`). Cross-tenant readers in console paths (`ReceivablesNotificationService.php:20-22`, `ZatcaNotificationBridge.php:59-69`) always add `where('tenant_id', …)`.
- **PC-8 Period attribution by document date, not posting day.** `entry_date` = `invoice_date` / `purchase_date` / `note_date` / `return_date` / `expense_date` / `payment_date` (refs above); reports filter on `journal_entries.entry_date` (`ReportService.php:296-301`). Probe: March-dated invoice posted in October lands in March.
- **PC-9 POS.** Server-authoritative tax rate (`PosService.php:595-606`; probe: client 0% ignored), sale = posted credit invoice via `InvoiceService` + one receipt per tender via `PaymentService` (`L242-307`), branch tagged on every line over HTTP, session close/variance posts only cash-vs-5170 (`PosSessionService.php:606-683`, engine call at L653) — no VAT effect.
- **PC-10 Gateway fee VAT is not posted silently.** `PaymentGatewaySettlementService.php:49-53` throws if `provider_fee_tax > 0`; deductions/credits refused (`L160-173`); fee ex-tax goes to `provider_fee_expense` only (`L279-300`). Consistent with CLAUDE.md "deferred".
- **PC-11 Fiscal close keeps VAT out, structurally.** Only `revenue`/`expense` types are closed (`FiscalCloseService.php:360-406`); blockers include unbalanced year ledger, active lock on close date, posted documents without journal (`L444-537`); reopen reverses the stored close journal at the original date through the engine (`L310-329`); readiness labels VAT balances as local book balances, not ZATCA status (`L176-188`). `FiscalYearCloseTest`/`FiscalYearConcurrencyTest` green on PG.
- **PC-12 System VAT accounts cannot be re-coded.** `AccountManagementService::update` refuses system accounts (`L109-111`) and code/type changes on accounts with history (`L120-130`); `Account` deletion guarded (`Account.php:25-40`). So the code-based tax report cannot be broken by renaming 1150/2120 — only by routing (ACC-01).
- **PC-13 No invoice void/edit path exists after posting.** `invoices.status` enum has `cancelled` (`migration 000004 L26`) but no service/controller sets it; only credit notes/returns correct a posted invoice; no generic journal-reverse endpoint (`JournalEntryController` has only `index/show`; `routes/api.php:565-566`).
- **PC-14 Commerce boundary respected.** No Commerce service calls `InvoiceService`/`LedgerService` (`CommerceOrderService.php:25-26`, `CommercePaymentIntentService.php:25`, `StorefrontCheckoutController.php:31`; grep confirms). Nothing in storefront writes VAT (see ACC-08 for the consequence).

---

## 3. Findings

### ACC-01 — VAT roles can be routed into any posting account; the tax report reads fixed codes, so VAT silently vanishes from the return
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Accounting Settings → Account Routing (`tax_output`, `tax_input`); sales/purchase posting; VAT report.
- **Official requirement:** Output tax must be declared in the return for the period (Guideline v3 May 2026 §4.5.1 L924-930; Implementing Regulations filing/return rules `[official-ref to confirm]`). Internal invariant: CLAUDE.md rules 1–2 (balanced, derived totals) are met, but the reporting invariant "VAT report = VAT posted" is not guaranteed.
- **Actual behavior:** `AccountRoutingService::assertEligibleAccount` checks only tenant ownership, `is_active`, `!is_group` (`L180-194`); `AccountRoleResolver::resolve` likewise (`L24-51`); the catalog carries no required account class (`AccountingRoles.php:99-116`). `ReportService::taxReport` hard-codes codes `'1150'`/`'2120'` (`L475-487`) instead of resolving the roles. Probe: owner maps `tax_output`→4110 (revenue) via `PUT /api/accounting-settings/account-routing/tax_output` → **200**; the next invoice posts VAT as a second credit on 4110; tax report shows output VAT **0** (invoice says 15,000) and revenue is overstated by the VAT; mapping `tax_output`→1150 (merging input and output), `tax_input`→2120, and `tax_input`→1110 (cash) were all accepted, after which a purchase debited "input VAT" to **cash**.
- **Expected behavior:** `tax_output` restricted to active posting accounts of type `liability`, `tax_input` to type `asset`, the two never the same account; the VAT report resolves the roles (or at least warns when mapped accounts ≠ 1150/2120); a remap of a VAT role should be audited as a tax-relevant event.
- **Evidence:** `app/Services/Accounting/AccountRoutingService.php:180-194`; `AccountRoleResolver.php:24-51`; `app/Support/AccountingRoles.php:99-116`; `app/Services/Reporting/ReportService.php:475-487`; probe `BRoutingVatProbeTest` output (§1.2); `SalesPaymentAccountRoutingTest::mapped_tax_output_is_used_with_unchanged_vat_amount` (L190-203) only checks that the mapped account receives the amount — no type check exists in any test.
- **Impact:** regulatory (under-declared output VAT / over-declared input VAT with no error), financial (revenue misstated), audit (books look "mapped", not wrong).
- **Recommendation:** add an `account_type` constraint per role in `AccountingRoles` and enforce it in `AccountRoutingService`/`AccountRoleResolver`; forbid identical accounts for `tax_input` and `tax_output`; make `taxReport` role-based; emit a warning in the routing UI for tax roles.
- **Regression tests required:** mapping `tax_output` to asset/revenue/expense/equity rejected (API 422 + service); `tax_input`↔`tax_output` same-account rejected; `taxReport` equals Σ invoice VAT after a legitimate remap to another liability account; API 200 only for valid class.
- **Dependencies:** ACC-02 (the hard-coded services must also follow the role, otherwise a valid remap still splits VAT).

### ACC-02 — Semantic routing adopted only partially: credit notes, sales returns, expenses, assets and POS exchanges still post to hard-coded VAT/AR codes
- **Severity:** P1
- **Status:** PARTIALLY IMPLEMENTED (VERIFIED DEFECT when any tax role is remapped)
- **Business process:** VAT adjustments (credit/debit notes, returns), expenses, asset acquisition, POS exchange surplus.
- **Official requirement:** n/a – internal invariant (ACC-3/ACC-4 contracts: "preserve journal economics", one routing truth per tenant).
- **Actual behavior:** `InvoiceService`, `PurchaseService`, `PaymentService`, purchase-return side of `ReturnService` resolve roles; but `CreditNoteService` uses constants `2120/1150/4110/1130/2110/1110/5115` (`L32-38`, `L190-204`, `L229-235`), `ReturnService` sales side uses `2120/4110/1130/1110` (`L69-72`, `L456-468`), `ExpenseService` `1150/1110/1120/2110` (`L29-33`, `L153-156`), `AssetService` `1150` (`L34`, `L102-104`), `PosExchangeService` `1130/1110` (`L33-34`, `L335-342`). Probe: with `tax_output` remapped, the invoice credited VAT to the mapped account while the credit note and the sales return debited 2120 — the control account can never net to zero and the code-based report went negative (−15,000).
- **Expected behavior:** every VAT/AR/AP line resolves the same semantic role as the originating document (ACC-3 §"Invoice routing contract", ACC-4 "symmetry" comment in `PurchaseService.php:39-40`).
- **Evidence:** file/line refs above; `BRoutingVatProbeTest` output lines "credit note journal lines", "sales return journal lines", "expense journal lines".
- **Impact:** financial/regulatory: after any remap, output VAT and its adjustments live in different accounts; reports and the VAT control reconciliation (PC-5) break; credit-note VAT may be reversed from an account that never received it.
- **Recommendation:** route `CreditNoteService`, `ReturnService` (sales), `ExpenseService`, `AssetService`, `PosExchangeService` through `AccountRoleResolver` for `tax_output`/`tax_input`/`accounts_receivable`/`accounts_payable`; keep cash via `CashBankAccountService`.
- **Regression tests required:** for each service: mapped vs unmapped state hits the same account the originating invoice/purchase used; tenant-isolation of mappings; reversal uses original concrete accounts.
- **Dependencies:** ACC-01.

### ACC-03 — No Saudi VAT return: the "tax report" is three numbers from two account codes, with no boxes, classification, drill-down, reconciliation, export or filing state
- **Severity:** P1
- **Status:** NOT IMPLEMENTED (reporting capability); the three numbers it shows are correct (PC-5)
- **Business process:** VAT reporting / return preparation (web `/reports/general/tax-report`, API `GET /api/reports/tax-report`).
- **Official requirement:** ZATCA VAT return form boxes `[official-ref to confirm]`: standard-rated sales; sales to registered customers in other GCC states; zero-rated domestic sales; exports; exempt sales; total sales; standard-rated domestic purchases; imports subject to VAT paid at customs; imports subject to reverse charge; zero-rated purchases; exempt purchases; total purchases; total VAT due; corrections from previous period; VAT credit carried forward; net VAT due/(refund). Return period monthly if annual taxable supplies > SAR 40m else quarterly (Implementing Regulations Art. 62 `[official-ref to confirm]`); adjustments reported in the period of the credit/debit note (Guideline v3 §7 table L1384-1400); records retained 6 years (Implementing Regulations Art. 66 `[official-ref to confirm]`).
- **Actual behavior:** `ReportService::taxReport` (`L475-487`) returns `input_vat`, `output_vat`, `net_vat`, `status` from the net movement of codes 1150/2120; controller maps to riyals (`ReportController.php:198-208`); request accepts free `from/to`, branch ids, account id (`GeneralReportRequest.php:17-23`); UI renders two rows + net and the hint "control summary… not a tax filing" (`general-advanced-reports-workspace.tsx:196-204, 520-522`; `ar.json:5236`). No report route exports (`routes/api.php:1651-1660`, no `export`). Invoice lines carry only an integer `tax_rate` 0..100 (`StoreInvoiceRequest.php:67`; `migration 000004 L55`); no tax-category/exemption-reason/export flag on invoices, lines, products or partners (grep: only `fuel_products.tax_category`); `partners.country` exists (migration 000003 L33) but is unused by any report. No reverse-charge/import mechanism, no bad-debt relief, no carry-forward, no period presets, no drill-down from the figures to documents, no document-level VAT listing, no reconciliation view (report ↔ GL ↔ documents), no freeze/snapshot of a filed period.
  Capability matrix (official box → AWJ): standard-rated sales → **derivable only as "all sales"** (no split by rate); zero-rated domestic → **missing** (0% lines are indistinguishable from exempt); exports → **missing**; exempt → **missing**; total sales → derivable from invoices but not shown; standard-rated purchases → **not shown** (only the VAT amount); imports/customs VAT → **missing**; reverse charge → **missing**; zero-rated/exempt purchases → **missing**; adjustments (credit/debit notes) → **netted invisibly** into output/input; total VAT due / net → **shown**; carry-forward → **missing** (status "recoverable" only); period selection → free dates, no monthly/quarterly; tax-point basis → document date (PC-8), not configurable, no payment-basis; drill-down → **missing**; GL reconciliation → **missing**; rounding → halalas, no SAR rounding rule per box; reproducibility/freeze → **missing** (ACC-04).
- **Expected behavior:** a VAT return workspace that classifies every posted document line (standard/zero/exempt/export/out-of-scope, reverse charge, import), aggregates per statutory period, exposes drill-down and a GL reconciliation, supports adjustments and carry-forward, and snapshots a filed period.
- **Evidence:** refs above; `BMixedScenarioProbeTest` shows a 0%-rated line and a 15% line in one invoice both land only in 4110 with no classification retained anywhere but `invoice_lines.tax_rate`.
- **Impact:** regulatory/operational: the return must be prepared outside the system; zero-rated vs exempt cannot be separated; any claim of "VAT return ready" would be false (the UI is honest about this).
- **Recommendation:** add a tax-category dimension (line-level, with product/partner defaults), a `VatPeriod` entity (monthly/quarterly, status open/filed/amended, snapshot of box values and document list), box mapping rules, drill-down endpoints, GL↔return reconciliation, CSV/PDF export. Keep the current card as "VAT control accounts".
- **Regression tests required:** box totals from a fixture set covering each category; adjustments in period of note; period snapshot immutability; reconciliation = 0 after mixed scenario.
- **Dependencies:** ACC-01/02 (report must be role-based), ACC-04.

### ACC-04 — No VAT-period freeze: filed figures drift through back-dated documents; the only barrier is the manual company-wide accounting lock; future-dated invoices are accepted
- **Severity:** P1
- **Status:** NOT IMPLEMENTED (VAT period control); period lock itself VERIFIED IMPLEMENTED (PC-4)
- **Business process:** Posting after a return is filed; corrections; issue-date control.
- **Official requirement:** Tax becomes due on the earliest of supply, invoice issuance, or receipt of consideration (Guideline v3 §4.5.1 L911-921, citing the VAT Law); output tax is declared in the period the invoice was issued (L924-930); a credit note issued after submission is adjusted in the period it was issued (§7 table L1384-1400). A filed period must therefore be reproducible and later corrections must land in their own period `[official-ref to confirm: Implementing Regulations Art. 63 — correction of returns]`.
- **Actual behavior:** there is no VAT period entity or filing status (probe: no `VatReturn`/`TaxPeriod`/`TaxReturn` model). Any user with `invoices.manage` can post a document whose `invoice_date`/`note_date`/`return_date` is in an already-filed month (the ledger date follows the document date, PC-8) unless an accounting lock covering that range exists; locks are optional, company-wide, created/released by `accounting_period_locks.manage` with no VAT semantics (`routes/api.php:644-647`). Probe: Jan output VAT 15,000 "filed", lock released for a correction, a credit note dated 2026-01-20 posted → January output VAT **0** — the previously filed figure is no longer reproducible. No validation that a document date is not in the future: an invoice dated 2027-06-01 posted on 2026-10-10 → recognized VAT in a future period (also a ZATCA issue-date problem — cross-stream).
- **Expected behavior:** VAT period with status; posting a VAT-relevant document into a filed period either blocked or forced to the open period with an "adjustment of prior period" marker; issue date ≤ today (configurable tolerance); amendments tracked.
- **Evidence:** `BPeriodLockProbeTest` output; `AccountingPeriodLockService.php:106-137` (release has no VAT awareness); `InvoiceService::create/update` accept any `invoice_date` (`L83`, `L202`), no `today` bound; `ReportService.php:296-301`.
- **Impact:** regulatory (unreproducible returns, under/over-declaration without audit trail), operational (accountants must remember to lock months manually).
- **Recommendation:** implement `VatPeriod` (see ACC-03) and have `AccountingDateGuard` (or a sibling `VatPeriodGuard`) consult it for VAT-bearing sources; add issue-date validation (no future dates; back-dating only into open VAT periods); auto-create the accounting lock when a period is marked filed.
- **Regression tests required:** post/CN/return into filed period rejected or redirected; future-dated invoice rejected; filed snapshot unchanged after later corrections.
- **Dependencies:** ACC-03.

### ACC-05 — Immutability of posted documents and journals is enforced only by service convention; model and database allow edits/deletes and leave balances stale
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Data integrity of posted invoices/journals (VAT history).
- **Official requirement:** n/a – internal invariant (CLAUDE.md rule 3 "القيود immutable بعد الترحيل"); record integrity for 6 years `[official-ref to confirm: Implementing Regulations Art. 66]`.
- **Actual behavior:** `JournalEntry`/`JournalLine` have no `updating/deleting` guards (`JournalEntry.php:1-33`, `JournalLine.php:1-40`), no DB triggers (grep migrations: none), `journal_entries.status` enum even allows `draft` (`migration 000002 L55`). Invoice money fields are fillable and unguarded (`Invoice.php:25-37`). Probe: Eloquent `update()` changed a posted invoice's `tax_amount/total/invoice_date`; a VAT journal line's credit was set to 0; a posted entry's `entry_date/status` changed; the entry was deleted with its lines while the invoice stayed `posted` and `AccountBalance` kept the old 15,000. Only detective controls exist: `RecordsRevisions` (invoice/purchase/quote/procurement/stocktake/stock-permit only — `DocumentRevision.php:38-45`, pruned after 730 days `L56`, `L66-69`) and `FinancialControlService` (orphan-journal rule, probe detected it; no rule for AccountBalance ≠ Σ lines or document VAT ≠ journal VAT).
- **Expected behavior:** model-level guards (`booted()` on `JournalEntry`/`JournalLine`, and on money/date/status fields of posted documents) mirroring `Account::booted()` (`Account.php:26-40`), plus PostgreSQL triggers/row-level rules as defence in depth; an integrity check for `AccountBalance` vs Σ lines and document VAT vs journal VAT.
- **Evidence:** `BImmutabilityProbeTest` output; refs above; `JournalEntry.php:14-17` (money/status/date all fillable), `Account.php:25-40` (the only model in the core with lifecycle guards).
- **Impact:** any non-HTTP writer (import job, command, future Commerce slice, a developer "fix" in tinker) can corrupt VAT history silently; blast radius limited today because HTTP paths are guarded (PC-3) and no such writer exists in `app/Jobs/Accounting` (only `SendZatcaSubmission`).
- **Recommendation:** add guards + DB-level protection; extend `FinancialControlService` with `account_balance_drift` and `document_vat_vs_journal` rules; extend `DocumentRevision::TYPES` to credit notes/returns/expenses/manual journals and align retention with statutory record keeping.
- **Regression tests required:** Eloquent update/delete of posted journal rows throws; posted invoice money fields immutable at model level; integrity rules fire on injected drift.
- **Dependencies:** none.

### ACC-06 — Credit notes are unbounded and unanchored: amount may exceed the original invoice, the "original" may be a never-issued draft, the partner may differ
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Credit/debit notes (VAT adjustments).
- **Official requirement:** A credit/debit note must correct a *previously issued* tax invoice, comply with Art. 53 and state the serial number of the invoice it amends (Guideline v3 §7 L1323-1337, Implementing Regulations Art. 54; Unified Agreement Art. 57); §7.1 lists the permitted cases "where a tax invoice has been issued" (L1338-1345).
- **Actual behavior:** `StoreCreditNoteRequest` validates only shape (`L15-36`); `CreditNoteOwnershipResolver::resolve` only checks the referenced invoice exists in the tenant (`L55 Invoice::findOrFail`) — not that it is posted, not that it belongs to the note's partner, not cumulative amounts; `CreditNoteService::post` recomputes totals from its own lines only (`L136-139`). Probe: CN of 10× the invoice → created and posted; CN against a draft invoice → posted; CN with another partner → created. Contrast: `ReturnService::assertWithinSource` enforces quantity, price and cumulative caps (`L319-390`). Also `original_invoice_id` is `nullable` with `nullOnDelete` (migration 000018 L30) — the reference can silently vanish. (A credit note also has no `tax_inclusive`/discount model, so its VAT cannot mirror the invoice it adjusts — arithmetic owned by Stream A.)
- **Expected behavior:** when `original_invoice_id` is given: invoice must be posted, same partner, cumulative (CN + returns) ≤ invoice totals per tax rate; a free-standing CN must be an explicit, audited choice.
- **Evidence:** refs above; `BImmutabilityProbeTest` lines "CN 10x…", "CN against a DRAFT…", "CN whose partner ≠ …".
- **Impact:** regulatory (adjustments box can exceed declared output VAT; note referencing a non-issued invoice), financial (customer balances), fraud (credit to another customer against a real invoice).
- **Recommendation:** add source validation and cumulative caps analogous to `ReturnService`; make `original_invoice_id` `restrictOnDelete`; optional setting "require source for credit notes" (configurable-policy rule).
- **Regression tests required:** over-credit rejected; draft original rejected; partner mismatch rejected; cumulative CN+return cap.
- **Dependencies:** cross-stream A (VAT arithmetic of notes), stream for ZATCA note references.

### ACC-07 — `TenantScope` is a silent no-op without a tenant context and the report layer does not assert one: non-HTTP callers get cross-tenant or arbitrary-tenant figures
- **Severity:** P2
- **Status:** VERIFIED DEFECT (design/defence-in-depth); no HTTP exposure found
- **Business process:** Reports/VAT figures computed outside a request (commands, jobs, future schedulers).
- **Official requirement:** n/a – internal invariant (CLAUDE.md rule 4 "العزل تلقائي").
- **Actual behavior:** `TenantScope::apply` adds the tenant filter only `if ($ctx->has())` (`TenantScope.php:18-19`); `ReportService` never checks the context (`L53-88`, `L280-326`). Probe (SQLite and PG): with the context forgotten, `taxReport` returned input VAT of tenant A and output VAT of tenant B (`keyBy(code)` collapsed the two tenants' 2120 rows), and `trialBalance` merged 15 rows from both tenants. Mitigations present: `SetTenant` middleware on HTTP; every console command sets the context per tenant (`ScanFinancialControlsCommand`, `ScanReceivablesNotificationsCommand`, …); `AccountingDateGuard`/`FiscalCloseJournals` filter explicitly. The codebase already acknowledges the hazard (`AccountingDateGuard.php:69-71`).
- **Expected behavior:** reporting/financial services require an explicit tenant (throw when `TenantContext` is empty) or `TenantScope` fails closed outside the console bootstrap.
- **Evidence:** `BMixedScenarioProbeTest` lines "taxReport with NO tenant context", "trialBalance with NO tenant context rows: 15"; refs above.
- **Impact:** security/financial if any future job, export, or AI/document-centre feature calls reports without setting the context; today no such caller was found (NOT VERIFIED for production schedulers/queues).
- **Recommendation:** add a `requireTenant()` guard in `ReportService`, `FinancialControlService`, `FiscalCloseService` (already has `tenantId()`), and consider making `TenantScope` throw in non-console, non-platform contexts.
- **Regression tests required:** `ReportService::taxReport()` without context throws; two-tenant aggregate never returned.
- **Dependencies:** none.

### ACC-08 — Storefront/commerce sales never reach VAT recognition: no order→invoice path exists, so online sales are untaxed in the ledger and absent from the VAT figures until someone manually invoices
- **Severity:** P2
- **Status:** NOT IMPLEMENTED (consistent with CLAUDE.md "CommerceOrder ≠ Invoice", but the VAT consequence is undocumented)
- **Business process:** Storefront checkout → order → payment intent → fulfilment.
- **Official requirement:** Tax due at the earliest of supply, invoice, or receipt of consideration (Guideline v3 §4.5.1 L911-921) — an online order paid at checkout creates a tax point at payment `[official-ref to confirm: Implementing Regulations Art. 20-23]`.
- **Actual behavior:** `CommerceOrderService`/`CommerceCheckoutService`/`CommercePaymentIntentService` explicitly do not call `InvoiceService`/`LedgerService`/`PaymentService` (`CommerceOrderService.php:25-26`; `CommercePaymentIntentService.php:25` "optional"); no service converts a `CommerceOrder` into an `Invoice` (grep `CommerceOrder` in `app/Services/Accounting`: none). Therefore a paid storefront order creates neither output VAT nor revenue until an ERP invoice is created by hand; nothing ties the eventual invoice to the order for tax-point purposes.
- **Expected behavior:** a documented, idempotent "order → tax invoice" service (ADR) that fixes the tax point at payment/delivery per policy and posts through `InvoiceService`.
- **Evidence:** refs above; CLAUDE.md "عقود Commerce غير القابلة للكسر" items 1 and 9.
- **Impact:** regulatory (unreported output VAT on online sales), operational (manual invoicing), ZATCA (no e-invoice for storefront sales — cross-stream).
- **Recommendation:** decide the ADR (CLAUDE.md item 9 requires one) and implement the conversion with tax-point policy; until then, surface storefront paid orders without invoice in the VAT workspace as a warning.
- **Regression tests required:** paid order → exactly one posted invoice with matching VAT; idempotent on retry; tax point date.
- **Dependencies:** ACC-03/04; Commerce ADRs.

### ACC-09 — Reversal journals carry no `source_type/source_id`
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Reversals (payments, refunds, manual journals, fiscal reopen).
- **Official requirement:** n/a – internal invariant (CLAUDE.md "مربوط بمصدره عبر source_type و source_id").
- **Actual behavior:** `LedgerService::reverse` creates the reversal with only `reversal_of` (`L122-129`); probe: 1 journal without `source_type` after one manual reversal. `partnerStatementSource` returns `null` for such lines (`ReportService.php:695-699`); journal listings cannot filter reversals by document. `FiscalCloseJournals` works around it by joining on `reversal_of` (`L46-55`).
- **Expected behavior:** copy `source_type/source_id` (and `created_by`) from the original onto the reversal, keep `reversal_of`.
- **Evidence:** refs above; `BMixedScenarioProbeTest` "journal entries without source_type: 1".
- **Impact:** audit/operational (traceability of corrections in statements and listings).
- **Recommendation:** populate source on reversals; `JournalEntryController` filter `entry_kind=reversal` already exists and can then link to the document.
- **Regression tests required:** reversal entry carries original source + reversal_of.
- **Dependencies:** none.

### ACC-10 — Document change log pruned after 2 years and does not cover VAT adjustment documents
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Audit trail of document edits.
- **Official requirement:** Records and invoices retained for at least six years `[official-ref to confirm: Implementing Regulations Art. 66]`.
- **Actual behavior:** `DocumentRevision::RETENTION_DAYS = 730`, `Prunable` (`DocumentRevision.php:56`, `L66-69`, comment says the period is "closed for tax" after two years); `TYPES` covers invoice/purchase/quote/procurement/stocktake/stock_permit only (`L38-45`); credit notes, returns, expenses, payments, manual journals have no revision log. The log is the only trace of model-level edits (ACC-05).
- **Expected behavior:** retention ≥ statutory period for anything that evidences a tax figure; coverage of all VAT-bearing documents.
- **Evidence:** refs above; `BImmutabilityProbeTest` "DocumentRevision rows before/after: [2,3]".
- **Impact:** audit (loss of evidence after 2 years), low likelihood of regulatory impact since the documents themselves are kept.
- **Recommendation:** make retention configurable with a 6-year floor for financial documents; extend `TYPES`.
- **Regression tests required:** prune respects floor; revision written for credit note/return/expense edits.
- **Dependencies:** ACC-05.

### ACC-11 — Manual journals can adjust VAT control accounts without any tax classification or reason code
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Manual tax adjustments.
- **Official requirement:** Adjustments must be evidenced (credit/debit notes for supplies — Guideline v3 §7); other corrections need an audit trail `[official-ref to confirm]`.
- **Actual behavior:** `ManualJournalService::post` accepts any active posting account including 1150/2120 (`L105-148`); the only metadata is free-text description; the tax report nets such lines into "output/input VAT" indistinguishably (probe: manual VAT journal moved the report by ±1,000 until reversed). Period locks apply (PC-4), RBAC `accounts.manage` applies (`routes/api.php:571-575`).
- **Expected behavior:** manual postings to VAT control accounts flagged as "VAT adjustment" with mandatory reason/category and visible as a separate line in the VAT workspace.
- **Evidence:** refs above; `BMixedScenarioProbeTest` step 9.
- **Impact:** audit/regulatory (unexplained movements in the control accounts).
- **Recommendation:** add an adjustment category + reason on manual journal lines hitting tax roles; show them separately in ACC-03's workspace.
- **Regression tests required:** manual VAT line requires reason; report shows it as adjustment.
- **Dependencies:** ACC-03.

### ACC-12 — Branch-filtered VAT report silently drops company-wide (null-branch) VAT lines
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Tax report with `branch_id[]` filter; service/console postings.
- **Official requirement:** n/a – internal invariant (CLAUDE.md branch rules; null-branch semantics in `LedgerService.php:47-53`).
- **Actual behavior:** VAT lines posted without a `BranchContext` (service/console/queue callers, fiscal close explicit `branch_id => null`) carry `branch_id = NULL` (probe: all VAT lines NULL at service level; all set over HTTP). `movementsByAccount` with a branch filter uses `whereIn(branch_id, …)` (`ReportService.php:289-293`) which excludes NULL rows; `incomeStatement` adds an explicit `unallocated` block for this (`L118-132`) but `taxReport` does not. A branch-restricted user (`branchIds` L827-833 forces their branches) therefore never sees company-wide VAT lines.
- **Expected behavior:** tax report (and ACC-03 workspace) report an "unallocated/company-wide" VAT bucket when filtered by branch.
- **Evidence:** refs above; `BMixedScenarioProbeTest` "branch_id values on VAT lines: [NULL]"; `BPosApiProbeTest` "branch=set".
- **Impact:** operational (branch managers under-see VAT), low regulatory impact (the company-wide report is complete).
- **Recommendation:** mirror the income statement's `unallocated` handling in `taxReport`.
- **Regression tests required:** branch-filtered tax report returns `unallocated` sums for null-branch VAT lines.
- **Dependencies:** ACC-03.

---

## 4. NOT VERIFIED / open questions

- **Production configuration** (queue driver, schedulers, which commands run, PostgreSQL version/locks in prod, `APP_TIMEZONE`): not available; all PG evidence is from the sandbox `audit_b` (PostgreSQL 16.15).
- **Queue retry duplicate posting:** no accounting job posts to the ledger (`app/Jobs/Accounting` has only `SendZatcaSubmission`), `QUEUE_CONNECTION=sync` per CLAUDE.md; nothing to test today — re-verify when background posting (bulk import) is introduced.
- **Unique constraint on `(source_type, source_id)`:** only a non-unique index exists (`migration 000002 L66`); the one-journal-per-document guarantee rests on `lockForUpdate` + status re-check (proven on PG). Whether a partial unique index would be acceptable (sales returns legitimately create two entries per document: `ReturnService.php:470-476, 542-551`) is a design question, not a defect.
- **ACC-07 in production paths:** no caller without tenant context was found in `app/Console`; third-party/queued/AI document-centre entry points not exhaustively traced.
- **Tax-point rules beyond invoice date** (advance payments creating a tax point before the invoice — Guideline §4.5.1 L911-921): `PaymentService` posts receipts to AR only (`L350-371`), never VAT; whether AWJ customers take deposits before invoicing is a business-usage question — the system has no "advance receipt VAT" mechanism at all (would be a P2 if deposits are in scope; flagged for the consolidator).
- **Retention article number and return-box list** are cited from memory (`[official-ref to confirm]`); the R1 register was not available at the time of writing — only raw extracted guideline text in `<audit-workspace>/official/R1-work/text/`.
- **Fuel station sales** (`FuelSaleService`) post through `InvoiceService::post` with a custom COGS resolver (`FuelSaleService.php:173-205`); VAT behaviour therefore inherits PC-2/PC-5 but was not exercised by a probe.

## 5. Cross-stream notes

- **Stream A (arithmetic):** (a) shipping VAT is a fixed 15% (`InvoiceService.php:48, 691, 908`) even on a 0%-only invoice (probe I2: 14,300 = 14,000 goods + 300 shipping); (b) `CreditNoteService`, `ExpenseService`, `AssetService`, `ReturnService::create`, `RecurringInvoiceService`, `DeliveryNoteSalesInvoiceDraftBuilder` default `tax_rate ?? 15` while invoices/purchases use `Settings` (`CreditNoteService.php:78`, `ExpenseService.php:53/94`, `AssetService.php:66`, `ReturnService.php:154`, `RecurringInvoiceService.php:60`, `DeliveryNoteSalesInvoiceDraftBuilder.php:462`); (c) a partial sales return linked to a discounted invoice reverses VAT on the undiscounted line price (probe: return VAT 7,500 for a line whose invoice VAT share was 7,000 after the header discount) — `ReturnService::create` L163-179 only applies the discount share when `PosReturnService` passes overrides; the public API path does not; (d) credit notes have no inclusive/discount model (ACC-06).
- **Stream ZATCA/e-invoicing:** future-dated invoices are accepted and get ZATCA artefacts at posting (ACC-04); credit notes can reference draft invoices (ACC-06) — check what the note XML's billing reference carries; storefront sales have no e-invoice path (ACC-08); confirm whether `zatca_document_type` standard/simplified and the 0% lines carry a tax-category code (no exemption-reason field exists — ACC-03).
- **Security stream:** ACC-07 (scope no-op without context); the routing endpoints are owner/admin only (`accounting_settings.manage`, `Rbac.php:150`), so ACC-01 is an insider/misconfiguration risk rather than an external one.
- **Consolidator:** PC-3/PC-4 concurrency results come from real PostgreSQL runs (sandbox) — they can be reported as VERIFIED on PG, not just SQLite.
