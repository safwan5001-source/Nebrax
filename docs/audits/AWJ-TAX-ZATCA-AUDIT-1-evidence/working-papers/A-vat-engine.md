> **Working paper — unedited stream output.** Written before the official-source registers existed, so regulatory citations tagged `[official-ref to confirm]` were resolved afterwards; severities, normalised statuses, re-ratings and register citations in **AWJ-TAX-ZATCA-AUDIT-1.md** and **AWJ-TAX-ZATCA-GAP-MATRIX.md** prevail where they differ. Paths of the form `<audit-workspace>/…` refer to the audit workspace (probe sources, logs, SDK runs) that is not part of the repository; the relevant extracts are in `probe-outputs.md` and `sdk-validation-extracts.md`. **Superseded after review (PR #1290):** where a paper says the web UI was only read, or implies there is no web test suite, `web-test-results.md` and `web-test-mapping.md` give the results of the Vitest and Playwright runs; where a paper attributes a test failure to the sandbox, `test-results.md` shows the controlled attribution.

# Stream A — VAT engine (AWJ-TAX-ZATCA-AUDIT-1)

Repo pinned at `0534ef16543b01c69b416b58897337e012a9d1ab`. Audit-only; nothing under the repo or harness was modified. Date 2026-10-10.

Verdict in one sentence: **AWJ's per-line integer arithmetic is correct and consistent across quotes/invoices/POS/purchases (verified numerically on SQLite and PostgreSQL), but the engine (a) has no VAT-category model, (b) rounds VAT per line instead of per document as the ZATCA XML standard requires, (c) lets the generic sales-return and credit-note paths recompute VAT from the gross unit price so tax-inclusive or header-discounted sales are reversed at the wrong VAT, and (d) emits a ZATCA XML whose monetary totals do not satisfy the standard's own arithmetic rules once any discount/shipping/adjustment/inclusive price is present.**

---

## 1. Scope & method

### 1.1 Files read in full (path — lines)

| File | Lines |
|---|---|
| app/Services/Accounting/ComputesLineTax.php | 52 |
| app/Services/Accounting/InvoiceLinePrecision.php | 71 |
| app/Services/Accounting/InvoiceService.php | 1285 |
| app/Services/Accounting/QuoteService.php | 293 |
| app/Services/Accounting/PurchaseService.php | 636 |
| app/Services/Accounting/ProcurementService.php | 407 |
| app/Services/Accounting/ReturnService.php | 853 |
| app/Services/Accounting/CreditNoteService.php | 253 |
| app/Services/Accounting/PosService.php | 775 |
| app/Services/Accounting/PosReturnService.php | 375 |
| app/Services/Accounting/PosExchangeService.php | 363 |
| app/Services/Accounting/ExpenseService.php | 228 |
| app/Services/Accounting/RecurringInvoiceService.php | 162 |
| app/Services/Accounting/ZatcaService.php | 316 |
| app/Services/FuelSaleService.php | 543 |
| app/Services/DocumentCenter/PurchaseDocumentDraftBuilder.php | 357 |
| app/Services/DocumentCenter/ExpenseDocumentDraftBuilder.php | 367 |
| app/Services/DocumentCenter/DocumentFinancialValidator.php | 249 |
| app/Support/Settings.php | 425 |
| app/Support/Money.php | 19 |
| app/Models/Invoice.php, InvoiceLine.php, Quote.php, QuoteLine.php, Purchase.php, PurchaseLine.php, ReturnDocument.php, ReturnLine.php, CreditNote.php, CreditNoteLine.php, Expense.php | 200 / 91 / 93 / 48 / 145 / 52 / 98 / 49 / 83 / 48 / 76 |
| app/Http/Requests/StoreInvoiceRequest.php, PublicStoreInvoiceRequest.php, StorePurchaseRequest.php, StoreQuoteRequest.php, StorePosSaleRequest.php, StoreReturnRequest.php, StoreCreditNoteRequest.php, StoreExpenseRequest.php, StorePosReturnRequest.php, StoreRecurringInvoiceRequest.php | 76 / 48 / 76 / 34 / 86 / 82 / 47 / 31 / 38 / 36 |
| app/Http/Controllers/Api/SalesConfigController.php | 421 |
| database/migrations/2025_01_01_000004_create_invoices.php, 000028_add_tax_inclusive_to_invoices.php, 000067_add_product_snapshots_to_invoice_lines.php, 000098_add_tax_inclusive_to_return_documents.php | 71 / 24 / 63 / 24 |
| web/src/lib/tax.ts, web/src/components/settings/tax-settings-card.tsx | 18 / 137 |
| tests/Feature/InvoiceLinePrecisionTest.php | 41 |
| docs/plans/pos/DELIVERY-DECISION-PASS-7-DG-3-TAX-POINT-REPORT.md | 704 |

### 1.2 Files read in part (targeted sections / grep with context)

app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php (986; lines 400–680), AssetService.php (219; tax lines), CustomerRefundService.php (643) and SupplierRefundService.php (474) (no tax arithmetic — grep empty), app/Services/Commerce/CommerceCheckoutService.php (1117; lines 440–520, 660–850) and CommerceCartService.php (1020), app/Services/FuelStationSettingsService.php (435; tax-mode resolver), app/Services/Reporting/ReportService.php (853; VAT report lines 470–485) and SalesReportService.php (398), app/Http/Controllers/Api/InvoiceController.php (395; store/update), PublicInvoiceController.php (178; store), AuthController.php (312; register), ReturnableController.php (unit_price lines), web/src/components/invoices/invoice-form.tsx (1192; calculation block 440–475, 560–610), web/src/app/(pos)/pos/page.tsx (2563; lineCalc 1160–1190), web/src/components/returns/create-return-dialog.tsx (469; 200–275), web/src/components/credit-notes/credit-note-form.tsx (202), web/src/modules/documents/builder/from-invoice.ts (202), storefront/src/lib/commerce/capabilities.ts (244) and storefront/src/lib/data/markets.ts (111), tests/Feature/PosCheckoutTest.php (945), ReturnFromSourceTest.php (575), ZatcaTest.php (204), InvoiceTest.php (1155; discount/inclusive tests), InteractsWithApi.php (108). Migrations grepped for `tax_rate` column type (all `unsignedSmallInteger … default(15)`).

Official texts used (local copies in `<audit-workspace>/official/R1-work/text/`, fetched by the R1 stream): `tech_xml_implementation_standard_20230519.txt` (ZATCA E-Invoicing XML Implementation Standard v1.2, §9.6, §10, §13.2 BR-CO/BR-S, BR-KSA-51..53), `vat_tax_invoicing_records_guideline_EN.txt` (ZATCA Tax Invoicing & Records Guideline v3, May 2026, §4.2.4, §7), `vat_retail_guideline_EN.txt` (ZATCA VAT Retail Guideline issue 3, May 2026, §4.3 price display / rounding). `R1-regulatory-register.md` / `R2-technical-register.md` did not exist at the time of writing; the consolidator should reconcile rule ids.

### 1.3 Probes written and run (all in `<audit-workspace>/probes/A/`, logs in `<audit-workspace>/logs/A-*.log`)

| Probe | Command (from `<harness>`) | Result |
|---|---|---|
| `expected_values.py` | `python3 -I <audit-workspace>/probes/A/expected_values.py` | independent expected values (Fraction + ROUND_HALF_UP) — printed table used below |
| `overflow_check.php`, `coercion_check.php` | `php <audit-workspace>/probes/A/<file>` | PHP 8.3.6: integer product overflow → float → `intdiv()`/`int` param **throws TypeError** (no silent wrong value); no bcmath/gmp in harness |
| `VatInvoiceEngineProbeTest.php` (S1–S18) | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/A-inv.sqlite php artisan test <audit-workspace>/probes/A/VatInvoiceEngineProbeTest.php` | 11 passed, 2 risky (print-only), 1 failed = S8 overflow (expected, see VAT-05); S8 re-run with isolation: `--filter=test_s8` |
| same on PostgreSQL | `DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=audit_a DB_USERNAME=audit DB_PASSWORD=audit php artisan test <audit-workspace>/probes/A/VatInvoiceEngineProbeTest.php` | **identical values on every scenario** (log `A-invoice-engine-pgsql.log`) |
| `VatReturnsCreditsProbeTest.php` (R1–R5) | sqlite `A-ret.sqlite` | 2 passed, 3 risky (print-only) |
| `VatPurchaseExpenseProbeTest.php` (P1–P5, E1) | sqlite `A-pur.sqlite` | 2 passed, 4 risky (print-only) |
| `VatPosProbeTest.php` (S12, S12b, R5, R6) | sqlite `A-pos.sqlite` (tenant bootstrapped like `AuthController::register()` because the harness lacks `app/Mail`) | 4 passed, 39 assertions |

"Risky" = PHPUnit label for tests that only print observations (by design). Nothing in `<repo>` or `<harness>` was changed.

### 1.4 Code-path inventory — every place that computes or persists `tax_rate` / `tax_amount` / `total`

| # | Path | Formula (exclusive) | Formula (inclusive) | Header discount | Shipping VAT | Default rate | Equivalent to InvoiceService? |
|---|---|---|---|---|---|---|---|
| 1 | `InvoiceService::applyItemsAndTotals/post` (`InvoiceService.php:487-709, 880-1062`) | `intdiv(base*rate+50,100)` per line (`:1179-1182`) | `intdiv(2*incl*rate+denom, 2*denom)` (`:1188-1196`) | `intdiv(taxGross*net, subtotal)` — truncation (`:1205-1216`) | hard-coded 15% (`:48, :691, :908`) | `Settings sales.default_tax_rate` (`:504`) | reference |
| 2 | `QuoteService::writeLines` (`QuoteService.php:232-273`, trait `ComputesLineTax.php:16-51`) | same | same | n/a (no header discount) | n/a | settings (`:239`) | **yes** (probe S17) |
| 3 | `PurchaseService::writeLines/applyHeadAdjustments/post` (`PurchaseService.php:152-248, 408-453`) | same (trait) | same (trait) | `intdiv(taxGross*net, subtotal)` with `net = subtotal − discount + shipping` (`:244-245`) | **blended line rate**, not 15% (`:244-245`) | `purchases.default_tax_rate` (`:155`) | lines yes; shipping **no** (VAT-08) |
| 4 | `ProcurementService::writeLines` (`:308-354`) | same (trait) | same (trait) | n/a | n/a | purchases setting | yes |
| 5 | `ReturnService::create/postSalesReturn/postPurchaseReturn` (`ReturnService.php:149-219, 447-453, 736-752`) | `calcTax(lineNet)` (`:177-179, :830-833`) | **none — `tax_inclusive` stored only** (`:133`) | **ignores source header discount** | n/a | **hard-coded 15** (`:154`) | **no** (VAT-01/03) |
| 6 | `PosReturnService::buildSourceItems` (`:264-328`) | pro-rata of source `line_subtotal/line_discount/line_tax` with last-part remainder (`:295-297, :321-328`) → `ReturnService` via overrides | inherits source split | n/a (POS invoices have no header discount) | n/a | source line | **yes, exact** (probe R5/R6) |
| 7 | `CreditNoteService::create/post` (`:73-115, :137-139`) | `calcTax(qty*price)` (`:84-85, :179-182`) | **none** | n/a | n/a | **hard-coded 15** (`:78`) | **no** (VAT-02) |
| 8 | `ExpenseService::create/update/post` (`:53-54, :94-95, :146-148`) | `calcTax(amount)` | **none** | n/a | n/a | hard-coded 15 | exclusive only |
| 9 | `AssetService` (`:66-67, :97-98, :199-202`) | `calcTax(cost)` | none | n/a | n/a | hard-coded 15 | exclusive only |
| 10 | `RecurringInvoiceService::create/generate` (`:60-67, :115-132`) | `calcTax(qty*price)`; `generate()` re-runs InvoiceService without `tax_inclusive` | none | n/a | n/a | hard-coded 15 | template exclusive only |
| 11 | `PosService::checkout` (`:197, :242-253`) | delegates to InvoiceService; **rate forced from `product.tax_rate`** (`:595-606`) | client flag `tax_inclusive` passed through (`:248`) | none | none | settings for description-only lines | **yes** (probe S12) |
| 12 | `PosExchangeService` (`:167-180`) | delegates to PosService | client flag (`:173`) | — | — | — | yes |
| 13 | `DeliveryNoteSalesInvoiceDraftBuilder` (`:432, :462, :569-643`) | delegates to InvoiceService | client flag (`:432`) | — | — | **hard-coded 15** (`:462`) | yes |
| 14 | `FuelSaleService::finalize` (`:157-194`) | InvoiceService with `InvoiceLinePrecision` fraction | `fuel_price_tax_mode` resolver, fail-closed (`FuelStationSettingsService.php:80-88`) | — | — | settings (`:193`) | yes |
| 15 | `DocumentFinancialValidator` (`:156-176`) | same formulas + overflow guards, ±1 halala tolerance | same | n/a | n/a | settings (`:33`) | yes (validation only) |
| 16 | `PurchaseDocumentDraftBuilder` / `ExpenseDocumentDraftBuilder` | delegate to 3 / 8; totals re-asserted vs reviewed evidence ±1 halala (`:289-298`, `:252-261`) | from reviewed `price_includes_tax` | — | — | reviewed | yes |
| 17 | `CommerceCheckoutService::revalidateAndPrice` (`:813-827`) | **no VAT at all**: `line_total = price × qty` (`:822`) | — | — | — | — | NOT IMPLEMENTED (deferred by design, VAT-16) |
| 18 | Web mirrors: `invoice-form.tsx:449-472`, `pos/page.tsx:1165-1175`, `credit-note-form.tsx:70-72`, `create-return-dialog.tsx:255-257` | `Math.round(x*rate/100)` | `Math.round(incl*rate/(100+rate))` (invoice/POS only) | `Math.floor(taxGross*net/sub)` (invoice-form `:467`) | 15 hard-coded (`invoice-form.tsx:469`) | '15' literal | display-only; server recomputes |
| 19 | Migration backfill `000067:35-46` | — | same `extractTax` | — | — | — | yes |

The core formulas are **duplicated 8× (`calcTax`) and 3× (`extractTax`)** across services (VAT-12); all copies are arithmetically identical for the valid input domain (verified by probes S1/S3/S13/S17/S12/P1).

---

## 2. Positive controls (VERIFIED IMPLEMENTED)

| Control | Evidence |
|---|---|
| Money is integer minor units end-to-end; no float/round() on money in server tax paths | `ComputesLineTax.php:16-35`, `InvoiceService.php:1179-1196`, `Money.php:11-18`; grep of `round(`/`(float)` in `app/` hits no tax formula; probes S1/S3/S13 match Python `Fraction` expectations exactly; identical on SQLite and PostgreSQL (`A-invoice-engine-pgsql.log`) |
| Per-line rounding is half-up (0.015→0.02, 0.045→0.05, 0.075→0.08) — the rounding rule the XML standard §10 mandates | probe S13; `intdiv(base*rate+50,100)` |
| Tax-inclusive extraction is exact: 100.00→13.04/86.96, 0.05→0.01/0.04, 0.01→0.00/0.01, 999.99→130.43/869.56 (= retail guideline 15/115 formula) | probe S3; `InvoiceService.php:1188-1196` |
| Line discount reduces the taxable base before VAT (999−70=929 → 139) | probe S5; `InvoiceService.php:564-586` |
| Header discount is allocated pro-rata across mixed-rate lines (largest-remainder) and VAT follows proportionally (15% line 100 + 0% line 50, 10% off → VAT 13.50) | probe S4; `InvoiceService.php:1230-1260`, `:1205-1216` |
| Totals are recomputed from lines at `post()`; header fields cannot override them; API requests carry no `subtotal/tax_amount/total` fields | `InvoiceService.php:894-916`, `StoreInvoiceRequest.php` (no totals), `PublicStoreInvoiceRequest.php:9-14`, `InvoiceController.php:115-129` (`validated()` only) |
| `tax_rate` is snapshotted per line; later changes to `sales.default_tax_rate` or `product.tax_rate` do not alter issued documents | probe S18 (old line stays 15 after default→5); column `invoice_lines.tax_rate unsignedSmallInteger` (migration 000004:55) |
| POS line tax rate is server-authoritative (`product.tax_rate` overrides the client's value) | probe S12b (client sends 0 → stored 15); `PosService.php:595-606` |
| POS checkout and `InvoiceService` produce byte-identical results for the same basket | probe S12 (5999/150/6149 both ways) |
| POS returns allocate subtotal/discount/VAT pro-rata with the final part absorbing the remainder, so Σ partial POS returns == original (11 = 4 + 7) and keep the inclusive split | probes R5, R6; `PosReturnService.php:264-328` |
| Quote → invoice conversion preserves inclusive/exclusive mode and amounts | probe S17 |
| Validation: `discount > subtotal`, negative totals, `line discount > line`, zero-line invoices are rejected; request bounds `unit_price ≤ 1e11`, `qty ≤ 1e6`, `tax_rate 0..100` keep per-line products inside 64-bit | probe S14; `InvoiceService.php:552-566, 697-699, 1208-1210`; `StoreInvoiceRequest.php:36-67`; `coercion_check.php` (1e6×1e11×15 fits) |
| QR tags 4/5 = header `total` / `tax_amount`; ledger `tax_output` (2120) credit = `tax_amount`; `total = (subtotal−discount)+shipping+tax+adjustment` holds on every posted invoice | probes S4, S14, S15 |
| Fractional quantities use exact rational pricing with a single half-up rounding at the line boundary; non-decimal denominators (1/3) fail closed at post | probe S6; `InvoiceLinePrecision.php:16-57`; `ZatcaService.php:198-229` |
| Fuel pricing: tax mode resolved server-side (station → tenant → Saudi default) and finalization fails closed when unset | `FuelStationSettingsService.php:80-88, 414-421`; `FuelSaleService.php:166, 183` |
| Document-center drafts: totals re-asserted against reviewed evidence with ±1 halala tolerance; overflow-guarded formulas | `DocumentFinancialValidator.php:11, 156-176`; `PurchaseDocumentDraftBuilder.php:289-298` |

---

## 3. Numerical experiment matrix

Inputs are halalas unless stated; "expected" = independent Fraction/Decimal ROUND_HALF_UP (`expected_values.py`). AWJ values are stored DB values after `create()`/`post()` through production services.

| # | Scenario | Inputs | Expected (subtotal / VAT / total) | AWJ stored | Match | Notes |
|---|---|---|---|---|---|---|
| 1 | 3 × 3.33 @15 excl | qty 3, 333 | 999 / 150 (149.85→150) / 1149 | 999 / 150 / 1149 | ✔ | |
| 2 | 10 lines × 0.10 @15 | 10×(1,10) | per-line: 100 / 20 / 120; **document-level (XML std §10): 100 / 15 / 115** | 100 / **20** / 120; QR tag5 "0.20" | ✘ vs document-level | VAT-04. Same basket as ONE line qty 10 gives 15 — document VAT depends on how the cashier splits lines |
| 3a | inclusive 100.00 | 10000 incl | 8696 / 1304 / 10000 | 8696 / 1304 / 10000 | ✔ | `unit_price_before_tax`=8696 |
| 3b | inclusive 0.05 / 0.01 / 999.99 | 5 / 1 / 99999 | 4/1/5 · 1/0/1 · 86956/13043/99999 | identical | ✔ | |
| 3c | inclusive 115.00, line disc 11.50 | | 9000 / 1350 / 10350 | 9000 / 1350 / 10350 | ✔ | XML emits `PriceAmount=115.00`, `LineExtensionAmount=100.00` (VAT-06) |
| 4 | 10% header discount over 15% line 100.00 + 0% line 50.00 | disc 1500 | 13500 / 1350 / 14850 | 15000(pre-disc) · disc 1500 / 1350 / 14850 | ✔ | line_tax stays 1500 (pre-discount); XML `TaxExclusiveAmount=150.00` + `TaxAmount 13.50` ≠ `TaxInclusiveAmount 148.50` (VAT-06) |
| 5 | line % discount rounding edge (7% of 9.99 → 0.70) | 3×333, disc 70 | 929 / 139 (139.35) / 1068 | 929 / 139 / 1068 | ✔ | |
| 6a | 0.333 × 1.00 | num 333/1000, 100 | 33 / 5 / 38 | 33 / 5 / 38 | ✔ | XML `InvoicedQuantity=0.333` |
| 6b | 1/3 × 1.00 | num 1/3 | 33 / 5 / 38 (draft) | draft 33/5/38; **post throws** "denominator not decimal-representable" | fail-closed | VAT-17 |
| 7 | unit price 2.335 (3–4 decimals) | — | not representable | API `integer` rule rejects; fuel `price_per_liter_minor` is integer halalas | n/a | policy: 2-decimal prices only (fine for KSA) |
| 8a | 9,999,999,999.99 @15 single line | 999999999999 | 999999999999 / 150000000000 / 1149999999999 | **TypeError at `create()` (`InvoiceService.php:1213`)** even with zero discount | ✘ | VAT-05; @0% the same amount posts fine |
| 8b | threshold | 78,400,000.00 ok; 78,500,000.00 fails; 2 lines × 25M: create ok, **post fails** (`:954`) | — | — | ✘ | single-line limit ≈ 78.4M SAR; multi-line post limit ≈ 30–43M SAR; purchases same (70M ok, 80M fails, `PurchaseService.php:245`) |
| 9 | standard + zero-rated + "exempt" lines | 100@15, 100@0, 100@0 | 30000 / 1500 / 31500 | 30000 / 1500 / 31500 | ✔ arithmetic | both 0% lines stored identically (`tax_rate=0`); no category, no VATEX, XML has no `TaxCategory`/`TaxSubtotal` (VAT-03) |
| 10a | partial API returns totalling the full invoice (7 × 0.10, VAT 11) | 7 returns of 1 | Σ VAT must equal 11 | **Σ VAT 14, Σ total 84 vs 81** | ✘ | VAT-02 (R1) |
| 10b | POS partial returns 3 + 4 of same line | | 11 | 4 + 7 = 11 | ✔ | R5 |
| 10c | API return of a tax-inclusive sale (115.00 incl) | unit_price 11500 | refund 11500 / VAT 1500 | **refund 13225 / VAT 1725** (service and HTTP `/api/returns` → 201, `/post` → 200) | ✘ | VAT-01 (R2) |
| 10d | API full return of header-discounted sale (charged 103.50, VAT 13.50) | unit_price 10000 | 103.50 / 13.50 | **115.00 / 15.00** | ✘ | VAT-01 (R3) |
| 10e | credit note referencing inclusive invoice, qty 2 > sold 1, no rate given | | capped at original | **26450 / VAT 3450**, rate defaulted to 15, no cap | ✘ | VAT-02 (R4) |
| 11a | purchase inclusive 3 × 3.33 | | 869 / 130 / 999 | 869 / 130 / 999 | ✔ | ledger 5150 869 / 1150 130 / 2110 999 |
| 11b | purchase 100@15 + 100@0 + shipping 20.00 | | shipping @15%: VAT 1800 | **1650** (7.5% blended); 0%-only purchase + shipping → **0** | ✘ policy conflict | VAT-08 (sales side charges 15% on shipping always) |
| 11c | purchase 3 × 3.33, header discount 1.00 | | net 899 → VAT 134.85 → **135** | **134** (truncation) | ✘ 1 halala | VAT-07 |
| 12 | POS vs InvoiceService same basket | A 3×3.33 disc 0.70, B 7×0.10, C 1×50.00@0 | equal | 5999 / 150 / 6149 both | ✔ | |
| 13 | half-way 0.10/0.30/0.50 @15 (1.5/4.5/7.5) | | 2 / 5 / 8 | 2 / 5 / 8 | ✔ | half-up |
| 14 | zero / negative | free item 0.00; adj −2.00 on 1.00; disc 1.50 on 1.00; adj −15.00 on 100.00 | reject / reject / reject / allowed | zero-invoice: ledger rejects ("at least two lines"); negative rejected; disc>subtotal rejected; adj −15.00 accepted (total 100.00, VAT 15.00 still posted to 2120, 5170 debit 15.00) | ✔ | adjustment is non-taxable by design; it can only over-declare VAT, never under |
| 15 | XML / QR / ledger agreement on L1 2×50.00@15 disc 10.00 + L2 1×30.00@0, header disc 5.00, shipping 10.00, adj −0.07 | | goods VAT exact 1293.75 → **1294**; +shipping 150 → 1444; total 13937 | VAT **1443** (1293 truncated), total 13936; ledger 1130 13936 / 4110 11500 / 4130 1000 / 2120 1443 / 5170 7; QR 139.36 & 14.43 agree with header; XML: `TaxExclusiveAmount 120.00`, `TaxAmount 14.43`, `TaxInclusiveAmount 139.36`, `LineExtensionAmount 100.00` (pre-discount), no AllowanceCharge/TaxSubtotal | header↔QR↔ledger ✔; XML ✘; rounding ✘ 1 halala | VAT-06, VAT-07 |
| 16 | inclusive 115.00 + header discount 11.50 | | if discount is net: 8850 / 1327.5→**1328** / 10178 | 8850(=10000−1150) / **1327** / 10177 | ✘ 1 halala; semantics ambiguous | VAT-07 (is a header discount gross or net in inclusive mode? code treats it as net) |
| 17 | quote (inclusive 3×3.33) → invoice | | same | 869/130/999 → 869/130/999 | ✔ | |
| 18 | shipping on a 0%-only invoice | 100@0 + shipping 10.00 | policy: shipping follows supply category | VAT 150 (15% hard-coded) | policy conflict | VAT-08 |

Deviation classification: 1, 3–7, 9, 12–14, 17 = correct; 2 = **policy choice that conflicts with the XML standard §10** (defect for Phase-2 XML); 8 = defect (robustness); 10a/10c/10d/10e = **defect (wrong VAT posted)**; 11b/18 = inconsistent policy; 11c/15/16 = defect (rounding mode inconsistency, 1 halala).

---

## 4. Findings (P0 → P3)

### VAT-01 — Generic sales returns recompute VAT from the gross unit price: tax-inclusive and header-discounted sales are reversed at the wrong VAT (over-refund, over-reversal of output tax)
- **Severity:** P0
- **Status:** VERIFIED DEFECT
- **Business process:** Sales return / credit against a posted invoice via `/api/returns` and the web "create return" dialog (every non-POS-session return). Purchase returns against tax-inclusive purchases run through the same `ReturnService::create()` lines and `ReturnableController` price feed, so the same over-reversal of **input** VAT is expected (code-read, not probed).
- **Official requirement:** ZATCA Tax Invoicing & Records Guideline v3 (May 2026) §7: a credit note "reflects the supplier's adjustment to decrease the consideration related to a previously issued tax invoice" and adjusts the supplier's output tax accordingly (Art. 54 Implementing Regulations, Art. 57 GCC Agreement); VAT Retail Guideline issue 3 §4.3: VAT in an inclusive price = price × 15/115. Internal invariant CLAUDE.md rule "الإجماليات مشتقة لا مُدخلة" and "القيود immutable… التصحيح بقيد عكسي".
- **Actual behavior:** `ReturnService::create()` always computes `line_tax = calcTax(qty×unit_price − line_discount, rate)` (`ReturnService.php:163-179`, `:830-833`); the `tax_inclusive` flag is persisted (`:133`) but never used; the source invoice's header discount is ignored (only qty and unit-price caps are enforced, `:366-388`). `ReturnableController.php:59` hands the UI the stored gross `unit_price` (the VAT-inclusive price for inclusive invoices) and the dialog adds VAT on top (`create-return-dialog.tsx:213, 255-257, 271-272`). Probe R2: invoice 1 × 115.00 inclusive (net 100.00, VAT 15.00) → return via service and via HTTP (`POST /api/returns` 201, `/post` 200) posts **subtotal 115.00, VAT 17.25, total 132.25**; ledger `4110 Dr 11500 / 2120 Dr 1725 / 1130 Cr 13225`. Probe R3: invoice 100.00 with header discount 10.00 (charged 103.50, VAT 13.50) → full return posts **115.00 / VAT 15.00**.
- **Expected behavior:** A return linked to a source line must derive base and VAT from the source line's stored split (`line_subtotal`, `line_discount`, `line_tax`, plus the line's share of the header discount) exactly as `PosReturnService::buildSourceItems()` already does (`PosReturnService.php:264-328`, probes R5/R6 exact), and must never exceed the source line's charged net/VAT cumulatively.
- **Evidence:** `A-returns.log` lines "R2 …", "R3 …"; code refs above.
- **Impact:** Financial/regulatory: output VAT reversed > VAT charged (VAT under-declared in the return period), AR/cash refunded above what the customer paid, customer statement wrong; triggered by the default UI flow for any tenant on inclusive pricing (the Saudi retail norm; POS defaults to the system "inclusive" tax setting). POS-session returns are unaffected.
- **Recommendation:** In `ReturnService::create()`, when `source_line_id` is present, ignore client `unit_price/tax_rate` for arithmetic and allocate from the source line (reuse `PosReturnService::allocate()`), including the source invoice's header-discount share; carry `tax_inclusive` into the computation for free returns (`splitLineTax` from `ComputesLineTax`); have `ReturnableController` expose `unit_price_before_tax`/charged VAT; cap cumulative returned VAT per source line.
- **Regression tests required:** return against inclusive invoice (full/partial) equals charged amounts; return against header-discounted invoice; purchase return against inclusive purchase; cumulative cap on VAT.
- **Dependencies:** VAT-02 (same root cause for credit notes), ZATCA stream (credit-note document type 381 + `BillingReference`, BR-KSA-56).

### VAT-02 — Credit notes do not inherit the original invoice's VAT basis: exclusive-only, hard-coded 15 %, no cap vs the referenced invoice
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Credit note (`/api/credit-notes`) referencing `original_invoice_id`; debit notes (purchase side) likewise.
- **Official requirement:** Invoicing & Records Guideline v3 §7 (credit note amends a specific tax invoice; must carry its serial number; output tax adjusted by the note); XML standard BR-KSA-56 (381/383 must reference the invoice) [consolidator to confirm exact wording].
- **Actual behavior:** `CreditNoteService::create()` computes `calcTax(qty×unit_price, rate ?? 15)` (`CreditNoteService.php:76-85`) with no inclusive mode, no lookup of the original invoice's lines/rates/charged VAT and no quantity/amount cap. Probe R4: CN against a 115.00-inclusive invoice with qty 2 (sold 1) posts **230.00 / VAT 34.50 / 264.50** (`2120 Dr 3450`). The web form defaults the unit price to `product.sale_price` (`credit-note-form.tsx:66`), i.e. the inclusive catalog price for inclusive tenants, and adds 15 % on top.
- **Expected behavior:** A CN that references an invoice should take rate, inclusive mode and (optionally) line amounts from the referenced invoice and be capped by the invoice's remaining net/VAT; a free CN should use the tenant default rate and support inclusive entry.
- **Evidence:** `A-returns.log` "R4 …"; code refs.
- **Impact:** Output VAT reversed in excess of what was charged; CN totals exceeding the invoice; later rate changes (VAT-11) would silently apply the new default to old-invoice credits.
- **Recommendation:** Resolve rate/mode/caps from `original_invoice_id` when present; use `Settings sales.default_tax_rate`; add `tax_inclusive` support via `ComputesLineTax`.
- **Regression tests required:** CN against inclusive invoice; CN qty > invoice qty rejected; CN rate inherited after default-rate change.
- **Dependencies:** VAT-01, VAT-10.

### VAT-03 — No VAT category / exemption-reason model: `tax_rate = 0` conflates zero-rated, exempt and out-of-scope supplies; VAT report is GL-only
- **Severity:** P1
- **Status:** NOT IMPLEMENTED
- **Business process:** Invoicing of exports, exempt financial/residential-rent supplies, non-taxable supplies; ZATCA XML; VAT return preparation.
- **Official requirement:** XML Implementation Standard v1.2 §9.6 (one VAT breakdown per category code + rate), BR-CO-04 (every line needs a VAT category code BT-151), BR-CO-18 (at least one VAT breakdown), R-KSA-09/R-KSA-13 (exemption reason codes at document and line level), VATEX-SA-29…36/EDU/HEA code list (standard §11); VAT return boxes separate standard-rated, zero-rated, exempt and export sales [VAT return user guide — official-ref to confirm box numbers].
- **Actual behavior:** The only tax attribute on every document line is `tax_rate` (`unsignedSmallInteger`, migrations 000004:55 and siblings; `InvoiceLine.php:26`). No column, enum or setting for category (S/Z/E/O) or exemption reason exists anywhere (`grep -rn "VATEX\|tax_category\|exempt" app/` → none). `SalesConfigController::DEFAULTS['taxes']` lists "Zero Rated" and "Tax Free" both as `rate 0` (`:35-39`) — a display preference only. `ZatcaService::buildXml()` emits no `cac:TaxSubtotal`, `cac:TaxCategory`, `cac:ClassifiedTaxCategory` or `TaxExemptionReasonCode` (`ZatcaService.php:239-313`; probe S9 "TaxCategory=ABSENT"). `ReportService` "VAT report" = net of GL accounts 1150/2120 only (`ReportService.php:472-484`).
- **Expected behavior:** Line-level category + reason code (with validation: Z/E/O require a VATEX code, S requires rate > 0), persisted as a snapshot, driving XML `TaxSubtotal`/`ClassifiedTaxCategory` and VAT-return boxes (standard, zero-rated domestic, exports, exempt).
- **Evidence:** probe S9; code refs.
- **Impact:** Regulatory: Phase-2 XML cannot be valid (BR-CO-04/18, R-KSA-13); VAT return boxes for zero-rated/exempt/export supplies cannot be produced from the data; audit trail of why VAT was not charged is missing.
- **Recommendation:** Add `tax_category` (S/Z/E/O) + `tax_exemption_reason_code` + reason text on all document lines (and header-level allowance/charge), default S/15, validated against the VATEX list; expose in UI/API; include in XML breakdown and VAT report.
- **Regression tests required:** category/reason validation; XML breakdown per category; VAT report by box.
- **Dependencies:** ZATCA stream (XML), reporting stream.

### VAT-04 — Document VAT = Σ rounded line VAT; the XML standard requires the category VAT to be rounded once at document level
- **Severity:** P1
- **Status:** VERIFIED DEFECT (policy choice that conflicts with the published standard)
- **Business process:** Every multi-line invoice/quote/purchase/return; POS baskets with low-priced items.
- **Official requirement:** XML Implementation Standard v1.2 §10 Rounding: "Rounding shall be done on the final calculation results not on any intermediate results; VAT category tax amount (BT-110) shall be rounded on document level and not as a summation of rounded Invoice line VAT amounts"; BR-CO-17 / BR-S-09 (category tax = taxable amount × rate / 100, rounded to two decimals); Invoicing & Records Guideline v3 §4.2.4 (VAT rounded to the nearest halala; the rounded figures must be the ones used in the VAT return).
- **Actual behavior:** `InvoiceService::applyItemsAndTotals()` accumulates `line_tax` per line (`:582, :610`) and `post()` sums `line_tax` (`:900`); the same in Quote/Purchase/Return/CreditNote services. Probe S2: ten lines of 0.10 @15 → stored VAT **0.20** (QR tag 5 "0.20", ledger 2120 = 20) whereas document-level rounding gives **0.15**; the identical basket entered as one line of qty 10 gives 0.15 — the tax charged depends on how the cashier splits lines.
- **Expected behavior:** Line VAT (KSA-11) may be shown per line, but BT-117/BT-110 must be `round_half_up(Σ line net of the category − allowances + charges) × rate`, and that document-level figure is what is charged, posted to 2120 and reported.
- **Evidence:** `A-invoice-engine.log` "S2 …"; standard §10 text (local copy lines 1115-1126).
- **Impact:** Regulatory: once `TaxSubtotal` is emitted, BR-S-09/BR-CO-17 will fail for any invoice where Σ rounded line VAT ≠ document-level VAT (common for retail baskets); VAT over/under-charged by up to 0.005 SAR per line.
- **Recommendation:** Compute `tax_amount` per (category, rate) from the summed taxable base at document level; keep `line_tax` for display/KSA-11; make the ledger and QR use the document figure; apply to Purchase/Return/CreditNote services; decide (documented policy) how the per-line residual is shown.
- **Regression tests required:** S2-type basket (per-line sum ≠ document) across all services; XML BR-S-09 check.
- **Dependencies:** VAT-03 (category grouping), ZATCA stream.

### VAT-05 — 64-bit overflow: invoices/purchases above ≈ 78.4 M SAR (single line) or ≈ 30–43 M SAR (multi-line, at post) crash with `TypeError`
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Large B2B / contracting / real-estate invoices and supplier bills.
- **Official requirement:** n/a — internal invariant (CLAUDE.md "النقود بالـ minor units كـ bigint").
- **Actual behavior:** `applyDiscount()` always computes `intdiv($taxGross * $net, $subtotal)` (`InvoiceService.php:1213`, called from `create()` at `:625` and `post()` at `:903`) — even with zero discount — so `0.15·S²` overflows `PHP_INT_MAX` when S > 7.84e9 halalas; `post()` also computes `intdiv($lineNet * $netSales, $subtotal)` per line (`:954`); `PurchaseService::applyHeadAdjustments()` (`:245`) and `post()` (`:449`) have the same products. PHP 8.3 turns the float product into `TypeError: intdiv(): Argument #1 must be of type int` (probe `overflow_check.php`). Probe S8: 9,999,999,999.99 @15 → TypeError at `create()`; 78,400,000.00 ok, 78,500,000.00 fails; 2 × 25,000,000.00 → draft created, **post fails**; @0% the same amount works. Purchases: 70M ok, 80M fails (probe P4).
- **Expected behavior:** Either guard the multiplication (`DocumentFinancialValidator` already has such guards, `:158-175`) and return a 422 with a clear message, or compute proportional amounts without an intermediate product (e.g., `taxGross − intdiv(taxGross*discount, subtotal)` which overflows far later, or arbitrary-precision via string arithmetic).
- **Evidence:** `A-invoice-s8.log`, `A-purchase.log` "P4 …", `A-invoice-engine-pgsql.log` (same on PG). Probed limits: single line 78.4 M ok / 78.5 M fails (create); 2 × 25 M fails at post. The lower multi-line figures quoted in the title (≈ 30–43 M SAR) are **analytic** (post-time product `lineNet × netSales > 9.22e18`, i.e. from ≈ 30.4 M SAR when one non-final line dominates), not probed.
- **Impact:** Operational: HTTP 500 / failed posting for legitimate large documents; drafts that can be created but never posted (multi-line case); no wrong money (fails closed).
- **Recommendation:** Introduce a checked-multiply helper (as in `DeliveryNoteSalesInvoiceDraftBuilder::checkedMultiply`, `:952-960`) in `ComputesLineTax` and use it in all proportional allocations; add an explicit, documented maximum document amount with a 422.
- **Regression tests required:** create+post of a 100 M SAR single line and of a 50 M SAR two-line invoice/purchase.
- **Dependencies:** none.

### VAT-06 — ZATCA XML monetary fields violate the standard's arithmetic rules as soon as a discount, shipping, adjustment or inclusive price exists
- **Severity:** P1
- **Status:** VERIFIED DEFECT (arithmetic consistency; structural gaps belong to the ZATCA stream)
- **Business process:** Every posted invoice (`InvoiceService::post()` → `ZatcaService::buildFor()`), stored in `invoices.zatca_xml`, hashed into the PIH chain.
- **Official requirement:** XML Implementation Standard v1.2: BT-131 line net amount = (net price ÷ base qty) × qty − line allowance (§9.5, local lines 666-690); BT-146 item net price is the price **without VAT**; BR-CO-10 (BT-106 = Σ BT-131), BR-CO-13 (TaxExclusiveAmount = Σ line net − allowances + charges), BR-CO-15 (TaxInclusiveAmount = TaxExclusiveAmount + TaxAmount), BR-CO-16 (PayableAmount = TaxInclusive − prepaid + rounding), BR-CO-11/12 (AllowanceTotalAmount/ChargeTotalAmount), BR-KSA-51/52/53 (line VAT and line amount with VAT mandatory for tax invoices).
- **Actual behavior:** `ZatcaService::buildXml()` emits `LineExtensionAmount = line_subtotal` (pre-line-discount gross in exclusive mode, `:245`), `PriceAmount = unit_price` (the VAT-inclusive price in inclusive mode, `:247`; the net `unit_price_before_tax` column exists but is unused), `TaxExclusiveAmount = subtotal` (pre-header-discount, excludes shipping, `:309`), `TaxInclusiveAmount = PayableAmount = total` (post-discount, +shipping, +non-taxable adjustment, `:310-311`), no `AllowanceCharge`, `AllowanceTotalAmount`, `ChargeTotalAmount`, `PayableRoundingAmount`, line `TaxTotal`, `TaxSubtotal` or `TaxCategory`. Probe S15 XML: `TaxExclusiveAmount 120.00 + TaxAmount 14.43 ≠ TaxInclusiveAmount 139.36`; `LineExtensionAmount 100.00` for a line whose net is 90.00; probe S3c: `PriceAmount 115.00` with `LineExtensionAmount 100.00`; probe S4: `150.00 + 13.50 ≠ 148.50`. Header, QR and ledger agree with each other; only the XML is inconsistent.
- **Expected behavior:** XML amounts derived from the same stored split: line net = `line_subtotal − line_discount` (exclusive) / stored net (inclusive), `PriceAmount = unit_price_before_tax`, header discount as `cac:AllowanceCharge` with `AllowanceTotalAmount`, shipping as a document charge or taxable line, adjustment as `PayableRoundingAmount` (the standard's reference sample "Standard Invoice with Payable Rounding Adjustment" passes), `TaxExclusiveAmount = Σ line net − allowance + charge`.
- **Evidence:** `A-invoice-engine.log` "S3b XML", "S4 XML", "S15 XML"; `ZatcaService.php:234-315` (comment line 232 admits "غير مُتحقَّق مقابل XSD ZATCA").
- **Impact:** Regulatory: certain rejection at Phase-2 clearance/reporting for any invoice with discounts, shipping, adjustments or inclusive pricing; the stored XML (and its hash chain) would have to be regenerated.
- **Recommendation:** Rebuild the monetary section of `buildXml()` from the line snapshot with allowance/charge/rounding elements and per-category `TaxSubtotal`; validate with the ZATCA SDK (R2 samples) in CI.
- **Regression tests required:** XML rule checks BR-CO-10/13/15/16, BR-KSA-51..53 on S3c/S4/S15-type invoices.
- **Dependencies:** VAT-03, VAT-04; ZATCA stream owns the structural remediation.

### VAT-07 — Header-discount VAT is truncated (`intdiv`), not rounded half-up; `line_tax` snapshots stay pre-discount; inclusive-mode header discount semantics undefined
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Any invoice or purchase with a document-level discount (and purchases with shipping).
- **Official requirement:** XML Implementation Standard §10 (half-up rounding on final results); Invoicing & Records Guideline §4.2.4 (nearest halala).
- **Actual behavior:** `InvoiceService::applyDiscount()` `taxNet = intdiv($taxGross*$net, $subtotal)` (`:1213`) and `PurchaseService::applyHeadAdjustments()` (`:245`) / `post()` (`:449`) truncate toward zero. Probe S15: exact 12.9375 → stored 12.93 (half-up 12.94); probe S16: 13.275 → 13.27 (half-up 13.28); probe P3: 1.3485 → 1.34 (half-up 1.35). `line_tax` is left at the pre-discount value (`:678`, S4 lines sum 1500 vs header 1350), so Σ line VAT ≠ document VAT and no line-level record of the allocated discount/VAT exists. In inclusive mode the header `discount` is subtracted from the **net** subtotal (`:1212`) while the UI lets users type a gross amount — the contract does not say which (S16).
- **Expected behavior:** Half-up rounding of the document-level VAT (consistent with VAT-04 fix); line-level allocated discount/VAT stored (needed for returns, VAT-01, and XML line amounts, VAT-06); explicit contract whether a header discount in inclusive mode is gross or net.
- **Evidence:** `A-invoice-engine.log` S15/S16, `A-purchase.log` P3; web mirror also floors (`invoice-form.tsx:467`).
- **Impact:** 1-halala systematic under-statement of VAT on discounted documents (always in the taxpayer's favour → exposure, cumulative over volume); inconsistency between line and document figures.
- **Recommendation:** `taxNet = intdiv(2*taxGross*net + subtotal, 2*subtotal)` (half-up) — or better, recompute from the discounted base per VAT-04; persist per-line `header_discount_share`/`line_tax_net`; document the inclusive-mode discount semantics in `design-system/foundations/configurable-policies.md`.
- **Regression tests required:** S15/S16/P3 values; Σ line VAT reconciliation after header discount.
- **Dependencies:** VAT-04.

### VAT-08 — Shipping VAT: hard-coded 15 % on sales (even on 0 %-only invoices, and treated as exclusive inside inclusive invoices) vs blended line rate on purchases (0 % when all lines are 0 %)
- **Severity:** P2
- **Status:** VERIFIED DEFECT (inconsistent policy)
- **Business process:** Invoices/purchases with `shipping`.
- **Official requirement:** Delivery charges follow the VAT treatment of the supply they relate to (the DG-3 report §4B itself says a delivery charge "is not presumed to be a service or a separate supply"); XML standard: a document-level charge carries its own VAT category/rate (BT-102/BT-103) and enters the category taxable amount (§9.6). [official-ref to confirm the composite-supply rule in the Implementing Regulations]
- **Actual behavior:** `InvoiceService::VAT_RATE = 15` (`:48`) applied to shipping in `create` (`:691`) and `post` (`:908`) regardless of `sales.default_tax_rate`, line rates or `tax_inclusive`; probe S18: zero-rated-only invoice + shipping 10.00 → VAT 1.50; the client mirrors it (`invoice-form.tsx:469`). `PurchaseService::applyHeadAdjustments()` taxes shipping at the weighted average line rate (`:244-245`): probe P2: 100@15 + 100@0 + shipping 20 → VAT 16.50 (7.5 % on shipping); 0 %-only + shipping → 0. In inclusive invoices the shipping amount is treated as net and VAT is added on top (`:690-696`).
- **Expected behavior:** One configurable policy (per `configurable-policies.md`): shipping as a taxable line/charge with an explicit rate/category (default: follow the standard rate for standard supplies), identical on sales and purchases, and honouring `tax_inclusive`.
- **Evidence:** `A-invoice-engine.log` S18, `A-purchase.log` P2/P2b.
- **Impact:** Wrong VAT on exports/zero-rated sales with delivery; input VAT on purchases mis-stated when lines are mixed; sales vs purchase asymmetry.
- **Recommendation:** Replace the constant with an explicit shipping tax rate/category field (default from settings), compute shipping VAT with the same inclusive/exclusive mode as the document, and use the same rule in `PurchaseService`.
- **Regression tests required:** shipping on 0 %-only invoice; shipping in inclusive invoice; purchase mixed-rate shipping.
- **Dependencies:** VAT-03.

### VAT-09 — `tax_inclusive` is client-supplied on POS checkout (and POS exchange / delivery-note drafts) while prices and rates are server-authoritative
- **Severity:** P2
- **Status:** VERIFIED DEFECT (server-authority gap)
- **Business process:** POS checkout (`POST /api/pos/checkout`), POS exchange replacement, delivery-note → invoice draft.
- **Official requirement:** n/a — internal invariant (PosService's own contract: "نسبة الضريبة مصدرها كتالوج المنتج الخادمي حصراً", `PosService.php:195-197`; CLAUDE.md rule 6 "السياسة تُضبط ولا تُفرَض" implies a tenant setting, not a per-request client flag).
- **Actual behavior:** `StorePosSaleRequest.php:25` accepts `tax_inclusive`; `PosService::checkout()` passes it straight to `InvoiceService` (`:248`); the web POS derives it from the `sales-config/taxes` preference (`tax.ts:10-18`, `pos/page.tsx:361-406`), which the server never enforces. Probe S12b: same product, same catalog price 3.33 → VAT 0.43 (flag true) vs 0.50 (flag false). The catalog price itself is enforced (`:614-658`) but its inclusive/exclusive meaning is not.
- **Expected behavior:** The inclusive/exclusive nature of catalog prices is a tenant (or price-list) setting resolved server-side; a client flag is at most a hint that must match it.
- **Evidence:** `A-pos.log` "S12b …".
- **Impact:** A buggy/malicious terminal or stale held sale (`PosHeldSaleService` snapshot carries the flag) can under-collect VAT on every sale or produce inconsistent VAT between terminals of one tenant.
- **Recommendation:** Add `sales.default_tax_inclusive` (mirror of the existing `purchases.default_tax_inclusive`) and resolve it in `PosService` / `DeliveryNoteSalesInvoiceDraftBuilder`; reject a mismatching client flag.
- **Regression tests required:** POS checkout ignores/validates the flag against the tenant setting.
- **Dependencies:** none.

### VAT-10 — Hard-coded default rate `?? 15` in six services ignores the tenant's `default_tax_rate`
- **Severity:** P3
- **Status:** VERIFIED DEFECT
- **Business process:** Returns, credit notes, expenses, assets, recurring templates, delivery-note drafts created without an explicit `tax_rate`.
- **Official requirement:** n/a — internal invariant (CLAUDE.md rule 6; `Settings::DEFAULTS sales/purchases.default_tax_rate`).
- **Actual behavior:** `ReturnService.php:154`, `CreditNoteService.php:78`, `ExpenseService.php:53, :94`, `AssetService.php:66`, `RecurringInvoiceService.php:60`, `DeliveryNoteSalesInvoiceDraftBuilder.php:462` use the literal 15; `SalesConfigController::DEFAULTS['taxes']` likewise. Probe R5: with `sales.default_tax_rate = 0`, a new invoice gets 0 but a return/credit note/recurring template/expense still get 15. Web forms also default to the literal '15' (`invoice-form.tsx:86`, `create-return-dialog.tsx:44`, `credit-note-form.tsx:24`).
- **Expected behavior:** All document services read the tenant default (sales or purchases group).
- **Evidence:** `A-returns.log` "R5 …".
- **Impact:** Policy drift when a tenant changes the default (e.g., a non-VAT-registered tenant setting 0); low because KSA standard rate is 15.
- **Recommendation:** Route all defaults through `Settings::get()`; one constant source for the statutory rate.
- **Regression tests required:** R5-type test per service.
- **Dependencies:** VAT-11.

### VAT-11 — No effective-dated rate table or rate history; a future rate change has no safe path for credit notes against old invoices
- **Severity:** P3
- **Status:** NOT IMPLEMENTED
- **Business process:** Rate change (5 % → 15 % on 2020-07-01 already happened; a future change would be handled by editing one default).
- **Official requirement:** n/a (good-practice); credit notes must carry the original invoice's rate (Guideline §7) [official-ref to confirm transitional rules].
- **Actual behavior:** Single `sales.default_tax_rate` / `purchases.default_tax_rate` with no effective date (`Settings.php:54, :163`); `tax-settings-card.tsx` stores a free list of {name, rate, inclusive} without dates; per-line snapshot (positive control) protects issued documents only. Documents dated before 2020-07-01 would default to 15 %. Credit notes recompute at the current default (VAT-02).
- **Expected behavior:** Rate table with effective dates resolved by document date; CN/returns inherit from the referenced document.
- **Evidence:** code refs; probe S18 (snapshot works).
- **Impact:** Low today; becomes P1 at the next rate change.
- **Recommendation:** Effective-dated rate catalog keyed by category; resolve by `invoice_date`.
- **Regression tests required:** rate resolution by date; CN inherits.
- **Dependencies:** VAT-02, VAT-03.

### VAT-12 — Tax formulas duplicated 8× (`calcTax`) / 3× (`extractTax`) plus web mirrors; `InvoiceService` does not use the shared trait it is documented to match
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED (shared trait exists; only 3 services use it)
- **Business process:** Maintenance of VAT arithmetic.
- **Official requirement:** n/a — internal invariant (one algorithm).
- **Actual behavior:** `ComputesLineTax` (`:16-51`) is used by Quote/Purchase/Procurement only; `InvoiceService.php:1179-1196`, `ReturnService.php:830-833`, `CreditNoteService.php:179-182`, `ExpenseService.php:208-211`, `AssetService.php:199-202`, `RecurringInvoiceService.php:158-161`, `DocumentFinancialValidator.php:156-176`, migration `000067:38-40` and the web (`invoice-form.tsx:449-458`, `pos/page.tsx:1169-1174`, `money.ts extractInclusiveTax`) each carry their own copy. All verified equivalent today (probes); a future fix (VAT-04/05/07) must be applied in every copy.
- **Expected behavior:** One server-side implementation (trait or value object) used by every document service; the web mirrors documented as display-only.
- **Evidence:** grep inventory §1.4.
- **Impact:** Divergence risk during remediation.
- **Recommendation:** Collapse into `ComputesLineTax` (with checked multiplication) and delete the copies.
- **Regression tests required:** cross-service equivalence test (same basket → same VAT in Invoice/Quote/Purchase/Return/CN).
- **Dependencies:** none.

### VAT-13 — Partial API returns accumulate per-return rounding: Σ credited VAT ≠ original VAT
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Several partial returns of one invoice line through `/api/returns` (non-POS path).
- **Official requirement:** Guideline v3 §7 (credit notes adjust a previously issued invoice's consideration/VAT; cumulative credits cannot exceed it) [official-ref to confirm cumulative-cap wording].
- **Actual behavior:** Each return recomputes `calcTax(qty × unit_price)` independently (`ReturnService.php:163-179`); probe R1: invoice 7 × 0.10 (VAT 0.11) → seven returns of 1 unit → Σ VAT **0.14**, Σ total **0.84** vs 0.81 charged. The POS path allocates exactly (R5).
- **Expected behavior:** Allocation from the source line with remainder on the final part (as `PosReturnService::allocate()`), cumulative cap.
- **Evidence:** `A-returns.log` "R1 …".
- **Impact:** Halala-level over-reversal of output VAT and AR; systematic in the taxpayer's favour.
- **Recommendation:** Fold into VAT-01 remediation.
- **Regression tests required:** R1 pattern.
- **Dependencies:** VAT-01.

### VAT-14 — Expenses and assets are exclusive-only; a VAT-inclusive receipt must be manually netted
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Expense / asset capture from supplier receipts (which in KSA retail are VAT-inclusive by law — Retail Guideline §4.3).
- **Official requirement:** Retail Guideline issue 3 §4.3 (displayed prices include VAT; VAT = price × 15/115).
- **Actual behavior:** `ExpenseService` adds VAT on top of `amount` (`:53-54`, probe E1: 115.00 entered → VAT 17.25, total 132.25); no `tax_inclusive` input (`StoreExpenseRequest.php`); `AssetService` likewise. The document-center expense draft avoids the trap by taking `subtotal_minor` from reviewed evidence (`ExpenseDocumentDraftBuilder.php:168`).
- **Expected behavior:** `tax_inclusive` (or "amount is gross") option using `extractTax`.
- **Evidence:** `A-purchase.log` "E1 …".
- **Impact:** Over-claimed input VAT when users type the receipt total.
- **Recommendation:** Add inclusive mode to Expense/Asset services via `ComputesLineTax`.
- **Regression tests required:** inclusive expense 115.00 → 100.00 / 15.00.
- **Dependencies:** VAT-12.

### VAT-15 — `sales-config/taxes` definitions are unvalidated free-form JSON that only drive a UI default
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Settings → Taxes card.
- **Official requirement:** n/a.
- **Actual behavior:** `SalesConfigController::update()` validates only `data: array|max:200` for the `taxes` section (`:61-63`); rate/inclusive are normalised client-side only (`tax-settings-card.tsx:43-49`); the "inclusive" flag of the first positive-rate entry becomes the POS/invoice default (`tax.ts:10-18`) but is never read by the backend; "Zero Rated" vs "Tax Free" are indistinguishable (VAT-03).
- **Expected behavior:** Server-validated tax catalog (name, rate, category, inclusive) consumed by the engine; or remove the card to avoid implying support.
- **Evidence:** code refs.
- **Impact:** Misleading configuration; VAT-09 attack surface.
- **Recommendation:** Merge into the VAT-03/VAT-09 settings design.
- **Dependencies:** VAT-03, VAT-09.

### VAT-16 — Commerce / storefront orders carry no VAT at all
- **Severity:** P3 (deferred by design; recorded so it is not mistaken for support)
- **Status:** NOT IMPLEMENTED
- **Business process:** Storefront cart/checkout/order.
- **Official requirement:** Retail Guideline §4.3 (displayed consumer prices must include VAT) — applies once orders become invoices.
- **Actual behavior:** `CommerceCheckoutService::revalidateAndPrice()` sets `line_total = price × qty` (`:822`); no tax field on orders; storefront declares `TAX_PRESENTATION_CAPABILITY = "deferred"` (`capabilities.ts:131-141`) while `markets.ts:43` hard-codes `tax_inclusive: true` for the AWJ-SA market.
- **Expected behavior:** Per CLAUDE.md commerce contract, VAT is determined when the canonical invoice is created; the storefront should not assert inclusive pricing it cannot source.
- **Impact:** None today (no invoice); consistency risk when order→invoice conversion is built.
- **Recommendation:** Keep deferred; derive the storefront price mode from the future `sales.default_tax_inclusive` (VAT-09).
- **Dependencies:** VAT-09, Commerce stream.

### VAT-17 — Fractional quantities with non-decimal denominators are accepted at draft but fail at post (fail-closed), no draft-time validation
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Actual behavior:** `InvoiceLinePrecision::fromItem()` accepts 1/3 (`:16-57`); `ZatcaService::lineQuantity()` throws at post (`:210-215`); probe S6b. Only internal callers (fuel: ml/1000; delivery notes: gcd-reduced sums) use fractions, so impact is nil today.
- **Recommendation:** Validate representability in `InvoiceLinePrecision`.
- **Dependencies:** none.

---

## 5. NOT VERIFIED / open questions

| Item | Why | How to obtain |
|---|---|---|
| ZATCA validator tolerance on BR-S-09 / BR-CO-17 (is a ±0.01 difference accepted?) | Standard text read says "rounded to two decimals" with no tolerance; validator behaviour not exercised (no SDK run in this stream) | Run the R2 SDK samples against an S2-type invoice XML (ZATCA stream) |
| Exact Implementing-Regulation article text for composite supplies / delivery charges (VAT-08) and credit-note cumulative caps (VAT-13) | Arabic regs text present locally but not parsed in this stream | R1 register |
| Production tenant configuration (`default_tax_rate`, inclusive preference, POS flag usage) | sandbox only | ops evidence |
| Fuel sale end-to-end arithmetic | requires station/nozzle/shift fixtures; code-read only (`FuelSaleService.php:157-194` delegates to InvoiceService with exact fraction + resolved tax mode) | run `FuelSaleServiceTest` with the ZATCA stream's fixtures |
| VAT return box mapping | no VAT-return feature exists beyond the GL net (`ReportService.php:472-484`) | reporting stream |
| PostgreSQL-only behaviour | all numeric results identical on `audit_a`; locks/partial indexes out of scope | — |

## 6. Cross-stream notes

- **ZATCA XML stream:** VAT-06 (totals/allowance/price), VAT-03 (TaxSubtotal/ClassifiedTaxCategory/VATEX), VAT-04 (document-level BT-117), BR-KSA-51..53 line TaxTotal; return/credit-note documents have **no** XML/QR/381-383 generation at all (`ReturnService`, `CreditNoteService` write none) — BR-KSA-56 `BillingReference` cannot be satisfied today.
- **Security/API stream:** VAT-09 client-controlled `tax_inclusive` (POS, exchange, delivery-note draft); `sales-config/*` free-form JSON (VAT-15).
- **Ledger/reporting stream:** 2120/1150 balances equal Σ document `tax_amount` (positive control) but will diverge from a document-level-rounded VAT if VAT-04 is fixed only in the XML; VAT report has no category boxes (VAT-03).
- **Returns/notes stream:** VAT-01/02/13 root cause is shared (`ReturnService`/`CreditNoteService` recompute instead of allocate); `PosReturnService` is the correct reference implementation.
- **Fuel stream:** inclusive mode resolver is a good pattern (fail-closed, server-side) — reuse for VAT-09.
