# Test results — existing repository tests (targeted runs)

Environment: PHP 8.3.6 (no `bcmath`), SQLite (one file per group) and PostgreSQL 16.15; code at `0534ef16543b01c69b416b58897337e012a9d1ab`; no test modified, skipped or rewritten; HTTP faked (`Http::fake`). Union of nine groups (G1–G9), deduplicated by class.

| Database | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| SQLite | 1 363 | 1 346 | 7 | 10 |
| PostgreSQL 16 | 1 363 | 1 356 | 7 | 0 |

* The 7 failures are `FuelSaleServiceTest` (all on both databases): `Call to undefined function App\Services\bcmul()` at `app/Services/FuelCostBasisService.php:380` — PHP `bcmath` is absent in the audit sandbox; it is installed by `Dockerfile:13` and listed in `.github/workflows/ci.yml:80`. Environment limitation, not a product defect.
* The 10 SQLite skips are PostgreSQL-only concurrency tests (`AccountingPeriodLockConcurrencyTest` 3, `FiscalYearConcurrencyTest` 4, `PreviewExchangePostgresConcurrencyTest` 2, `DocumentNumberingTest` 1); all passed on PostgreSQL.
* Per-group summaries (tests/assertions):

| Group | SQLite | PostgreSQL |
|---|---|---|
| G1 ZATCA core | 112 passed (1 166 assertions) | 112 passed (1 166) |
| G2 ZATCA submission | 37 passed (206) | 37 passed (206) |
| G3 VAT documents | 150 passed, 7 failed (849) | 150 passed, 7 failed (849) |
| G4 Notes and returns | 209 passed (1 152) | 209 passed (1 152) |
| G5 POS | 122 passed (1 570) | 122 passed (1 570) |
| G6 Storefront / commerce | 168 passed (754) | 168 passed (754) |
| G7 Ledger, reports, periods | 292 passed, 7 skipped (1 711) | 299 passed (1 735) |
| G8 Tenancy, RBAC, numbering | 99 passed, 1 skipped (661) | 100 passed (663) |
| G9 Print, language, misc | 211 passed, 2 skipped (1 200) | 213 passed (1 207) |

Group figures overlap where a class matched two filters; the table below is the deduplicated per-class result.

| Test class | SQLite (tests / fail / skip) | PostgreSQL (tests / fail / skip) |
|---|---|---|
| AccountManagementTest | 10 / 0 / 0 | 10 / 0 / 0 |
| AccountRoutingTest | 22 / 0 / 0 | 22 / 0 / 0 |
| AccountingPeriodLockConcurrencyTest | 3 / 0 / 3 | 3 / 0 / 0 |
| AccountingPeriodLockTest | 36 / 0 / 0 | 36 / 0 / 0 |
| AccountingSettingsRbacTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ApiInvoiceTest | 9 / 0 / 0 | 9 / 0 / 0 |
| ApiRbacTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ApiReportsTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ApiTenantIsolationTest | 5 / 0 / 0 | 5 / 0 / 0 |
| BranchIsolationGuardTest | 4 / 0 / 0 | 4 / 0 / 0 |
| BranchOperationalIsolationTest | 8 / 0 / 0 | 8 / 0 / 0 |
| BranchTest | 14 / 0 / 0 | 14 / 0 / 0 |
| CommerceCheckoutApiTest | 23 / 0 / 0 | 23 / 0 / 0 |
| CommerceOrderOwnershipTest | 16 / 0 / 0 | 16 / 0 / 0 |
| CommerceOrderServiceTest | 31 / 0 / 0 | 31 / 0 / 0 |
| CommerceOrderSnapshotTest | 30 / 0 / 0 | 30 / 0 / 0 |
| CommercePaymentIntentTest | 19 / 0 / 0 | 19 / 0 / 0 |
| CreditNotePostingOwnershipTest | 5 / 0 / 0 | 5 / 0 / 0 |
| CreditNoteSourceOwnershipTest | 8 / 0 / 0 | 8 / 0 / 0 |
| CreditNoteTest | 11 / 0 / 0 | 11 / 0 / 0 |
| CustomerRefundTest | 47 / 0 / 0 | 47 / 0 / 0 |
| DebitNoteTest | 8 / 0 / 0 | 8 / 0 / 0 |
| DeliveryNoteInvoiceDraftBuilderTest | 19 / 0 / 0 | 19 / 0 / 0 |
| DeliveryNoteTest | 11 / 0 / 0 | 11 / 0 / 0 |
| DocumentBranchScopeTest | 13 / 0 / 0 | 13 / 0 / 0 |
| DocumentConversionReturnIntegrityTest | 17 / 0 / 0 | 17 / 0 / 0 |
| DocumentFinancialValidatorTest | 10 / 0 / 0 | 10 / 0 / 0 |
| DocumentNumberingTest | 11 / 0 / 1 | 11 / 0 / 0 |
| DocumentRevisionTest | 11 / 0 / 0 | 11 / 0 / 0 |
| ExpenseTest | 7 / 0 / 0 | 7 / 0 / 0 |
| FiscalYearCloseTest | 29 / 0 / 0 | 29 / 0 / 0 |
| FiscalYearConcurrencyTest | 4 / 0 / 4 | 4 / 0 / 0 |
| FiscalYearReopenTest | 28 / 0 / 0 | 28 / 0 / 0 |
| FuelSaleServiceTest | 7 / 7 / 0 | 7 / 7 / 0 |
| GeneralReportTest | 4 / 0 / 0 | 4 / 0 / 0 |
| GrantLegacyReachableZatcaCommandTest | 4 / 0 / 0 | 4 / 0 / 0 |
| InventoryCogsAccountRoutingTest | 22 / 0 / 0 | 22 / 0 / 0 |
| InvoiceAppointmentTest | 3 / 0 / 0 | 3 / 0 / 0 |
| InvoiceCostCenterAllocationTest | 4 / 0 / 0 | 4 / 0 / 0 |
| InvoiceDocumentLanguageApiTest | 6 / 0 / 0 | 6 / 0 / 0 |
| InvoiceDocumentLanguageTest | 15 / 0 / 0 | 15 / 0 / 0 |
| InvoiceInventoryApiTest | 2 / 0 / 0 | 2 / 0 / 0 |
| InvoiceLinePrecisionTest | 2 / 0 / 0 | 2 / 0 / 0 |
| InvoiceNoteApiTest | 3 / 0 / 0 | 3 / 0 / 0 |
| InvoiceRelationsApiTest | 3 / 0 / 0 | 3 / 0 / 0 |
| InvoiceShowIncludesPartnerTest | 1 / 0 / 0 | 1 / 0 / 0 |
| InvoiceTemplateOverrideTest | 14 / 0 / 0 | 14 / 0 / 0 |
| InvoiceTest | 47 / 0 / 0 | 47 / 0 / 0 |
| LedgerTest | 5 / 0 / 0 | 5 / 0 / 0 |
| NumberingSettingsTest | 17 / 0 / 0 | 17 / 0 / 0 |
| PaymentGatewaySettlementAccountingTest | 20 / 0 / 0 | 20 / 0 / 0 |
| PaymentReversalTest | 6 / 0 / 0 | 6 / 0 / 0 |
| PaymentTest | 22 / 0 / 0 | 22 / 0 / 0 |
| PosCheckoutIdempotencyTest | 7 / 0 / 0 | 7 / 0 / 0 |
| PosCheckoutTest | 29 / 0 / 0 | 29 / 0 / 0 |
| PosDeliveryPlatformCheckoutTest | 15 / 0 / 0 | 15 / 0 / 0 |
| PosHeldSaleTest | 3 / 0 / 0 | 3 / 0 / 0 |
| PosInvoiceBranchAccessTest | 7 / 0 / 0 | 7 / 0 / 0 |
| PosRecentInvoicesTest | 2 / 0 / 0 | 2 / 0 / 0 |
| PosReturnExchangeIdempotencyTest | 13 / 0 / 0 | 13 / 0 / 0 |
| PosReturnTest | 10 / 0 / 0 | 10 / 0 / 0 |
| PosReturnUomTest | 6 / 0 / 0 | 6 / 0 / 0 |
| PosSessionCloseHandoverTest | 4 / 0 / 0 | 4 / 0 / 0 |
| PosSessionTest | 36 / 0 / 0 | 36 / 0 / 0 |
| PosVariantCheckoutTest | 19 / 0 / 0 | 19 / 0 / 0 |
| PreviewExchangePostgresConcurrencyTest | 2 / 0 / 2 | 2 / 0 / 0 |
| PrintTemplateTest | 20 / 0 / 0 | 20 / 0 / 0 |
| PublicApiIdempotencyTest | 13 / 0 / 0 | 13 / 0 / 0 |
| PublicApiInvoiceWriteTest | 16 / 0 / 0 | 16 / 0 / 0 |
| PurchaseAccountRoutingTest | 18 / 0 / 0 | 18 / 0 / 0 |
| PurchaseDiscountShippingTest | 12 / 0 / 0 | 12 / 0 / 0 |
| PurchaseDocumentLanguageApiTest | 8 / 0 / 0 | 8 / 0 / 0 |
| PurchaseDocumentLanguageTest | 15 / 0 / 0 | 15 / 0 / 0 |
| PurchaseEditDeleteTest | 8 / 0 / 0 | 8 / 0 / 0 |
| PurchasePaidOnPostTest | 21 / 0 / 0 | 21 / 0 / 0 |
| PurchaseReportTest | 4 / 0 / 0 | 4 / 0 / 0 |
| PurchaseTest | 11 / 0 / 0 | 11 / 0 / 0 |
| PurchaseWithProductTest | 10 / 0 / 0 | 10 / 0 / 0 |
| QuoteTest | 9 / 0 / 0 | 9 / 0 / 0 |
| RecurringInvoiceTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ReportEffectiveScopeTest | 34 / 0 / 0 | 34 / 0 / 0 |
| ReportStatementsTest | 5 / 0 / 0 | 5 / 0 / 0 |
| ReturnFromSourceTest | 28 / 0 / 0 | 28 / 0 / 0 |
| ReturnTest | 11 / 0 / 0 | 11 / 0 / 0 |
| ReturnWithProductTest | 12 / 0 / 0 | 12 / 0 / 0 |
| SalesPaymentAccountRoutingTest | 18 / 0 / 0 | 18 / 0 / 0 |
| SalesReportTest | 5 / 0 / 0 | 5 / 0 / 0 |
| StorefrontCheckoutApiTest | 17 / 0 / 0 | 17 / 0 / 0 |
| StorefrontCheckoutCompletionApiTest | 15 / 0 / 0 | 15 / 0 / 0 |
| StorefrontVariantCommerceTest | 17 / 0 / 0 | 17 / 0 / 0 |
| SupplierPaymentTest | 9 / 0 / 0 | 9 / 0 / 0 |
| SupplierRefundTest | 33 / 0 / 0 | 33 / 0 / 0 |
| TenantReferenceNumberTest | 5 / 0 / 0 | 5 / 0 / 0 |
| ZatcaCredentialTest | 11 / 0 / 0 | 11 / 0 / 0 |
| ZatcaHttpTransportTest | 5 / 0 / 0 | 5 / 0 / 0 |
| ZatcaIcvScopeTest | 10 / 0 / 0 | 10 / 0 / 0 |
| ZatcaInvoiceHasherTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaInvoiceSignerTest | 2 / 0 / 0 | 2 / 0 / 0 |
| ZatcaNotificationBridgeTest | 9 / 0 / 0 | 9 / 0 / 0 |
| ZatcaPhase2Test | 8 / 0 / 0 | 8 / 0 / 0 |
| ZatcaPhaseTwoQrEncoderTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ZatcaQrCertificateMaterialExtractorTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaQrCredentialMaterialResolverTest | 1 / 0 / 0 | 1 / 0 / 0 |
| ZatcaSignaturePolicyResolverTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaSignedInvoiceFinalizerTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaSignedInvoicePostingTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaSignedInvoiceQrMaterialExtractorTest | 19 / 0 / 0 | 19 / 0 / 0 |
| ZatcaSigningCredentialResolverTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ZatcaSigningReadinessTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaSubmissionAttemptTest | 8 / 0 / 0 | 8 / 0 / 0 |
| ZatcaSubmissionDispatcherTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ZatcaSubmissionRecoveryTest | 4 / 0 / 0 | 4 / 0 / 0 |
| ZatcaTest | 10 / 0 / 0 | 10 / 0 / 0 |
| ZatcaTransportCredentialResolverTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaXadesSignatureAssemblerTest | 5 / 0 / 0 | 5 / 0 / 0 |
| ZatcaXadesSignedPropertiesBuilderTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaXmlCanonicalizerContextTest | 5 / 0 / 0 | 5 / 0 / 0 |
| ZatcaXmlDsigSignedInfoBuilderTest | 3 / 0 / 0 | 3 / 0 / 0 |
| ZatcaXmlEcdsaSignerTest | 9 / 0 / 0 | 9 / 0 / 0 |
| **TOTAL (119 classes)** | **1363 / 7 / 10** | **1363 / 7 / 0** |


# Full-suite runs (SQLite)

Code at `0534ef16543b01c69b416b58897337e012a9d1ab`; `php artisan test` over the whole repository suite (550 test classes reported), an isolated SQLite file, HTTP faked; no test modified or skipped by the audit. The suite is not evidence of regulatory compliance.

## Run 1 — first full run on the assembled harness

**5 930 tests: 5 748 passed · 124 failed · 58 skipped.** All 124 failures are in 24 classes outside the tax, ZATCA and accounting surfaces; none is in a class selected for the targeted runs except `FuelSaleServiceTest`.

| Class | Failed in run 1 | First error (truncated) | After harness repair |
|---|---:|---|---|
| `AuthRecoveryTest` | 8 | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | 9 passed |
| `FuelAviRfidServiceTest` | 3 | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 3 passed |
| `FuelReconciliationTest` | 8 | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 11 passed |
| `FuelSaleApiTest` | 1 | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 1 passed |
| `FuelSaleServiceTest` | 7 | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 7 passed |
| `FuelSupplyReceivingApiTest` | 2 | `Expected response status code [200] but received 500. Failed asserting that 500 is identical to 200.` | 4 passed |
| `FuelSupplyReceivingTest` | 5 | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 7 passed |
| `ProductMediaR2BackfillTest` | 7 | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BackfillTest.php:203` | 14 passed |
| `ProductMediaR2BulkCleanupSemanticsTest` | 2 | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BulkCleanupSemanticsTest.php:118` | 3 passed |
| `ProductMediaR2CommerceStorefrontReadTest` | 1 | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, SQL: insert into "tenants" ("is_active", "plan", "currency",` | 2 passed |
| `ProductMediaR2DeleteTest` | 1 | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2DeleteTest.php:120` | 3 passed |
| `ProductMediaR2ReadTest` | 2 | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | 3 passed |
| `ProductMediaR2WriteTest` | 1 | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2WriteTest.php:141` | 4 passed |
| `ProductOptionValueVisualTest` | 1 | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | 21 passed |
| `R2SmokeTestCommandTest` | 2 | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2SmokeTestCommandTest.php:157` | 5 passed |
| `R2StorageServiceTest` | 1 | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2StorageServiceTest.php:89` | 6 passed |
| `ResendMailTransportTest` | 1 | `Failed asserting that actual size 0 matches expected size 1. <harness>/tests/Feature/ResendMailTransportTest.php:109` | 7 passed |
| `StorefrontMediaApiTest` | 24 | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 41 passed |
| `StorefrontMediaBackgroundContrastTest` | 8 | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 8 passed |
| `StorefrontMediaDeliveryTest` | 10 | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 12 passed |
| `StorefrontMediaDerivativeTest` | 17 | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 36 passed |
| `StorefrontMediaEvidenceBackfillTest` | 3 | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 4 passed |
| `StorefrontMediaRefTest` | 6 | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 9 passed |
| `UserInvitationTest` | 3 | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | 8 passed |

## Harness repair (test harness only — the audited repository was not touched)

The failures trace to gaps in the assembled Laravel harness, not to the audited code:

1. **`bcmath`** is absent from the sandbox PHP (`Call to undefined function App\Services\bcmul()`); `Dockerfile:13` and `.github/workflows/ci.yml:80` install it. A pure-PHP polyfill (`phpseclib/bcmath_compat`) was installed in the harness for the re-run; it is not the extension CI uses (NV-13).
2. **`app/Mail` and `resources/views/emails`** exist in the repository but had not been copied into the harness (`Class "App\Mail\AuthActionMail" not found`); they were copied unchanged.
3. **`league/flysystem-aws-s3-v3`** is installed by `.github/workflows/ci.yml:106` but not by `setup.sh:27` (`Class "Aws\Exception\AwsException" not found`); installed in the harness as CI does.
4. Several tests reported SQLite `database is locked` and `Undefined array key "data"` in run 1 and passed after the repair; the individual cause was not isolated.

**Re-run of the 24 failing classes after the repair:** 228 tests — 228 passed · 0 failed · 0 skipped.

## Run 2 — clean full run on the repaired harness

**5 930 tests: 5 872 passed · 0 failed · 58 skipped** (550 classes).
