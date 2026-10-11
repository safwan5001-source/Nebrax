# Test results — existing repository tests (targeted runs)

Environment: PHP 8.3.6 (no `bcmath`), SQLite (one file per group) and PostgreSQL 16.15; code at `0534ef16543b01c69b416b58897337e012a9d1ab`; no test modified, skipped or rewritten; HTTP faked (`Http::fake`). Union of nine groups (G1–G9), deduplicated by class.

| Database | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| SQLite | 1 363 | 1 346 | 7 | 10 |
| PostgreSQL 16 | 1 363 | 1 356 | 7 | 0 |

* The 7 failures are `FuelSaleServiceTest` (all on both databases): `Call to undefined function App\Services\bcmul()` at `app/Services/FuelCostBasisService.php:380` — PHP `bcmath` is absent in the audit sandbox; it is installed by `Dockerfile:13` and listed in `.github/workflows/ci.yml:80`. The cause is shown by experiment rather than assumed (see "Full-suite runs" below): adding a `bcmath` polyfill makes these tests pass, removing it from the repaired harness brings back exactly the fuel failures, and CI — which uses the real extension — passes them at the audited commit on both databases.
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


# Full-suite runs (SQLite) — first-run failures and their attribution

Code at `0534ef16543b01c69b416b58897337e012a9d1ab`; `php artisan test` over the whole repository suite (550 test classes reported), an isolated SQLite file, HTTP faked; no test modified or skipped by the audit. **A passing suite is not evidence of regulatory compliance.**

The first whole-suite run on the assembled harness reported failures in 24 classes. The cause of each failure was established by **reproducing the failing state and changing one harness dependency at a time**, then comparing the sets of failing test identifiers — not by the fact that a later run passed. The three dependencies: **Mail** = `app/Mail` + `resources/views/emails` (in the repository, not copied into the harness) · **SDK** = Composer package `league/flysystem-aws-s3-v3` (installed by `.github/workflows/ci.yml:106`, not by `setup.sh:27`) · **bcmath** = the PHP extension (declared in `Dockerfile:13` and `.github/workflows/ci.yml:80`; a pure-PHP polyfill, `phpseclib/bcmath_compat`, stands in for it in the repaired harness).

## Runs

| # | Harness state | Scope | Tests | Passed | Failed | Skipped | Assertions |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | **R0** as assembled (no Mail, no SDK, no bcmath) | whole suite — run 1 | 5 930 | 5 748 | **124** | 58 | 37 805 |
| 2 | R0 rebuilt from the repaired harness by removing the three pieces | whole suite — reproduction | 5 930 | 5 748 | **124** | 58 | 37 805 |
| 3 | R0 + Mail | the 24 failing classes | 228 | 116 | **112** | 0 | 774 |
| 4 | R0 + SDK | the 24 failing classes | 228 | 190 | **38** | 0 | 1 815 |
| 5 | R0 + bcmath | the 24 failing classes | 228 | 130 | **98** | 0 | 926 |
| 6 | repaired − Mail (SDK + bcmath) | the 24 failing classes | 228 | 216 | **12** | 0 | 2 007 |
| 7 | repaired − bcmath (Mail + SDK) | the 24 failing classes | 228 | 202 | **26** | 0 | 1 855 |
| 8 | repaired − SDK (Mail + bcmath) | whole suite | 5 930 | 5 786 | **86** | 58 | 38 037 |
| 9 | repaired (Mail + SDK + bcmath) | the 24 failing classes | 228 | 228 | 0 | 0 | 2 047 |
| 10 | repaired (Mail + SDK + bcmath) | whole suite — run 2 | 5 930 | 5 872 | 0 | 58 | 39 114 |

Reading the table:

* **Reproducible.** Rows 1 and 2 fail the same 124 test identifiers (set equality: yes; assertions 37 805 in both), so the failures are deterministic in that state, not flaky.
* **Causal and exhaustive.** Adding one dependency to R0 (rows 3–5) fixes a subset; removing the same dependency from the repaired harness (rows 6–8) brings back that subset. The subsets partition the failures: Mail 12 + bcmath 26 + SDK 86 = 124; unattributed 0.
* **Two directions agree for 121 of the 124 tests.** The remaining 3 (`ProductMediaR2BackfillTest` ×2, `ProductMediaR2CommerceStorefrontReadTest` ×1) failed in the whole-suite runs of rows 1 and 2, pass in every 24-class subset run whatever is added or removed (rows 3–7, 9), and fail again in row 8 — the whole suite with only the SDK removed — and pass in row 10. For them only the whole-suite comparison (row 8 against row 10) is informative, and it attributes them to the SDK.
* **Independent.** CI at the same commit runs the same tests and passes them: SQLite 5 872 passed · 58 skipped · 39 114 assertions (identical to row 10); PostgreSQL 5 929 passed · 1 skipped · 39 441 assertions. A later CI run at the pull-request head `01d09e5` (24 more tests from two later storefront commits) is also green on both databases.

## Why `database is locked` appears

Seven failures carry `SQLSTATE[HY000]: General error: 5 database is locked` on `insert into "tenants"`. In the pre-repair state `ProductMediaR2ReadTest`, run on its own, passes its first test, fails the second with `Class "Aws\Exception\AwsException" not found` and the third with `database is locked`; the third test passes when run alone. The error text and this sequence are consistent with an uncaught `Error` leaving the file-based SQLite write lock held for the next test of the same process. It was shown that way for `ProductMediaR2ReadTest`; for the other six it is inferred, not isolated test by test. With the SDK present none of the seven occurs (row 10, row 9 and CI).

## Failing classes: cause and result

"After repair" is row 9 (the 24 classes on the repaired harness).

| Class | Failed in run 1 | Cause | First error (truncated) | After repair |
|---|---:|---|---|---|
| `AuthRecoveryTest` | 8 | Mail | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | 9 passed |
| `FuelAviRfidServiceTest` | 3 | bcmath | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 3 passed |
| `FuelReconciliationTest` | 8 | bcmath | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 11 passed |
| `FuelSaleApiTest` | 1 | bcmath | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 1 passed |
| `FuelSaleServiceTest` | 7 | bcmath | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 7 passed |
| `FuelSupplyReceivingApiTest` | 2 | bcmath | `Expected response status code [200] but received 500. Failed asserting that 500 is identical to 200.` | 4 passed |
| `FuelSupplyReceivingTest` | 5 | bcmath | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380` | 7 passed |
| `ProductMediaR2BackfillTest` | 7 | SDK | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BackfillTest.php:203` | 14 passed |
| `ProductMediaR2BulkCleanupSemanticsTest` | 2 | SDK | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BulkCleanupSemanticsTest.php:118` | 3 passed |
| `ProductMediaR2CommerceStorefrontReadTest` | 1 | SDK | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, SQL: insert into "tenants" ("is_active",` | 2 passed |
| `ProductMediaR2DeleteTest` | 1 | SDK | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2DeleteTest.php:120` | 3 passed |
| `ProductMediaR2ReadTest` | 2 | SDK | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | 3 passed |
| `ProductMediaR2WriteTest` | 1 | SDK | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2WriteTest.php:141` | 4 passed |
| `ProductOptionValueVisualTest` | 1 | SDK | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | 21 passed |
| `R2SmokeTestCommandTest` | 2 | SDK | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2SmokeTestCommandTest.php:157` | 5 passed |
| `R2StorageServiceTest` | 1 | SDK | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2StorageServiceTest.php:89` | 6 passed |
| `ResendMailTransportTest` | 1 | Mail | `Failed asserting that actual size 0 matches expected size 1. <harness>/tests/Feature/ResendMailTransportTest.php:109` | 7 passed |
| `StorefrontMediaApiTest` | 24 | SDK | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 41 passed |
| `StorefrontMediaBackgroundContrastTest` | 8 | SDK | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 8 passed |
| `StorefrontMediaDeliveryTest` | 10 | SDK | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 12 passed |
| `StorefrontMediaDerivativeTest` | 17 | SDK | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 36 passed |
| `StorefrontMediaEvidenceBackfillTest` | 3 | SDK | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 4 passed |
| `StorefrontMediaRefTest` | 6 | SDK | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootstrap/HandleExceptions.php:258` | 9 passed |
| `UserInvitationTest` | 3 | Mail | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | 8 passed |

## Per-test attribution (all 124 first-run failures)

`pass`/`**FAIL**`/`skip` per harness state, using the numbering of the Runs table (3 = R0 + Mail, 4 = R0 + SDK, 5 = R0 + bcmath, 6 = repaired − Mail, 7 = repaired − bcmath, 8 = repaired − SDK, 10 = repaired, whole suite); `—` = the test was not part of that run. Rows 1 and 2 are `**FAIL**` for every test listed.

| Test | First error (run 1, truncated) | 3 | 4 | 5 | 6 | 7 | 8 | 10 | Cause |
|---|---|---|---|---|---|---|---|---|---|
| `AuthRecoveryTest::email_verification_is_single_use_and_resend_is_rate_limited` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::expired_reset_token_is_rejected` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::forgot_password_without_tenant_context_does_not_issue_a_global_token` | `The expected [App\Mail\AuthActionMail] mailable was sent 0 times instead of 1 times. Failed asserting that 0 i…` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::generated_links_use_the_tenant_frontend_hostname` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::reset_token_changes_password_and_is_single_use` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::tenant_bound_token_fails_without_hostname_context` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::token_from_tenant_a_cannot_be_used_on_tenant_b` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `AuthRecoveryTest::verification_token_is_rejected_on_other_tenant_and_without_context` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `ResendMailTransportTest::a_valid_tenant_forgot_password_sends_exactly_one_https_request_to_rese` | `Failed asserting that actual size 0 matches expected size 1. <harness>/tests/Feature/ResendMailTransportTest.p…` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `UserInvitationTest::authorized_admin_can_create_a_user_and_send_a_secure_invitation_withou` | `The expected [App\Mail\AuthActionMail] mailable was not sent. Failed asserting that false is true.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `UserInvitationTest::resend_keeps_the_current_password_unchanged_and_is_rate_limited` | `Expected response status code [200] but received 503. Failed asserting that 503 is identical to 200.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `UserInvitationTest::successful_resend_commits_new_invitation_and_retires_the_previous_one` | `Expected response status code [200] but received 503. Failed asserting that 503 is identical to 200.` | pass | **FAIL** | **FAIL** | **FAIL** | pass | pass | pass | Mail |
| `ProductMediaR2BackfillTest::a_failed_orphan_cleanup_is_reported_not_silently_swallowed` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BackfillTest.php:345…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BackfillTest::a_non_404_exists_check_failure_after_put_deletes_the_orphaned_r2_objec` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BackfillTest::a_non_404_exists_check_failure_whose_orphan_cleanup_also_fails_is_repo` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BackfillTest::a_read_back_failure_after_put_deletes_the_orphaned_r2_object` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BackfillTest::an_exists_verification_failure_after_put_deletes_the_orphaned_r2_objec` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BackfillTest.php:203…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BackfillTest::it_only_ever_touches_product_media_rows_never_other_domains` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | pass | pass | pass | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BackfillTest::the_limit_option_is_bounded` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | pass | pass | pass | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BulkCleanupSemanticsTest::an_r2_storage_failure_during_bulk_cleanup_is_reported_but_never_thrown` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2BulkCleanupSemantics…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2BulkCleanupSemanticsTest::by_contrast_the_direct_single_delete_path_throws_on_storage_failure_an` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2CommerceStorefrontReadTest::the_mobile_commerce_media_route_serves_r2_backed_bytes_for_a_published` | `Illuminate\Database\QueryException: SQLSTATE[HY000]: General error: 5 database is locked (Connection: sqlite, …` | pass | pass | pass | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2DeleteTest::a_failed_r2_delete_does_not_remove_the_product_media_row` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2DeleteTest.php:120…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2ReadTest::a_missing_r2_object_returns_a_clean_404_not_an_internal_error` | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2ReadTest::legacy_and_r2_media_coexist_and_both_serve_correctly_for_the_same_prod` | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductMediaR2WriteTest::an_r2_write_failure_does_not_create_a_product_media_row` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/ProductMediaR2WriteTest.php:141…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `ProductOptionValueVisualTest::existing_text_only_option_values_still_work_without_any_visual_field` | `Expected response status code [201] but received 500. Failed asserting that 500 is identical to 201.` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `R2SmokeTestCommandTest::test_happy_path_uses_internal_system_key_and_only_allowed_operations` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2SmokeTestCommandTest.php:157…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `R2SmokeTestCommandTest::test_read_mismatch_fails_and_cleanup_attempts_the_exact_key` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2SmokeTestCommandTest.php:157…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `R2StorageServiceTest::test_exists_returns_false_for_missing_object_without_acl_call` | `Error: Class "Aws\Exception\AwsException" not found <harness>/tests/Feature/R2StorageServiceTest.php:89…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_jpeg_upload_stores_the_original_and_the_full_variant_ladder_under_th` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_mixed_batch_reports_each_file_independently` | `Expected response status code [201] but received 503. Failed asserting that 503 is identical to 201.` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_reference_in_another_tenant_does_not_block_deletion` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_referenced_asset_cannot_be_deleted_and_the_409_lists_every_place_it_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_signed_link_never_serves_the_original_or_an_unlisted_variant` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_single_asset_can_be_read_with_its_usage_count_and_the_same_safe_shap` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::a_variant_failure_marks_the_asset_failed_cleans_partial_files_and_retr` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::an_image_that_passes_the_header_checks_but_cannot_be_decoded_becomes_a` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::an_image_too_large_for_the_decode_budget_is_refused_up_front_and_rotat` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::an_unreferenced_asset_is_soft_deleted_and_stops_serving` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::another_tenant_can_neither_see_nor_touch_the_asset` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::exif_orientation_is_applied_to_every_variant` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::identical_bytes_in_the_same_tenant_return_the_existing_asset` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::identical_bytes_in_two_tenants_never_share_an_asset` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::png_with_alpha_and_webp_sources_are_accepted_and_alpha_is_flattened_fo` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::reading_a_single_asset_is_a_uniform_404_for_foreign_deleted_or_unknown` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::rename_and_locale_alt_text_are_updatable_and_nothing_else` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::responses_never_expose_storage_paths_buckets_hashes_or_keys` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::roles_without_commerce_manage_and_unauthenticated_callers_are_refused` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::the_ladder_never_upscales_and_adds_the_source_width_as_its_top_rung` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::the_library_lists_newest_first_with_cursor_pagination_and_searches_nam` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::the_per_tenant_asset_and_byte_quotas_are_enforced_before_any_storage_w` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::the_signed_link_serves_a_private_variant_and_rejects_tampering_and_exp` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaApiTest::the_unused_filter_and_usage_count_follow_real_references` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::a_black_to_white_picture_is_unprovable_until_an_overlay_darkens_it` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::a_dark_picture_proves_the_automatic_foreground_and_publishes` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::a_hidden_section_never_blocks_and_other_types_cannot_carry_a_picture` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::a_stored_margin_narrower_than_the_code_never_narrows_the_proof` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::a_transformed_picture_is_proven_by_its_own_derivative_evidence_not_the` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::an_unknown_deleted_or_unready_asset_is_unprovable` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::missing_old_malformed_or_translucent_evidence_is_never_taken_as_proof` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaBackgroundContrastTest::the_phone_picture_is_judged_with_the_default_one` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::a_published_base_variant_is_served_privately_with_a_content_etag_and_u` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::a_ready_derivative_passes_and_a_failed_or_pending_one_is_refused_witho` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::a_storage_failure_keeps_the_asset_deleted_for_the_next_run_instead_of_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::a_transform_derivative_is_served_only_through_its_own_row_width_and_fo` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::alt_is_resolved_per_locale_decorative_is_exempt_and_arabic_never_stand` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::everything_that_should_not_be_served_is_one_uniform_404` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::orphan_derivatives_are_reaped_after_the_grace_unless_any_document_stil` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::the_publish_gate_names_the_path_and_a_stable_code_for_every_media_prob` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::the_published_media_set_follows_published_config_through_every_write_p` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDeliveryTest::the_reconciler_purges_due_deleted_assets_completely_and_leaves_everyth` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::a_crashed_request_cannot_leave_a_usage_permanently_pending` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::a_deleted_asset_cannot_be_given_new_derivatives` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::a_live_lease_held_by_another_request_is_respected_and_never_double_gen` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::a_realistic_maximum_document_reaches_a_terminal_state_for_every_usage_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::a_storage_failure_ends_every_row_failed_with_a_stable_code_cleans_up_a` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::a_user_rotation_is_costed_like_an_exif_rotation_and_an_oversized_decod` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::abuse_bounds_stop_unbounded_growth_but_never_block_an_existing_usage` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::derivatives_are_tenant_isolated_for_ensure_status_and_signed_reads` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::ensure_is_idempotent_and_two_usages_of_one_asset_never_overwrite_each_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::ensure_renders_eight_files_from_one_decode_under_the_tenant_prefix_and` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::roles_without_commerce_manage_self_service_and_anonymous_callers_are_r` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::status_is_a_pure_read_and_never_generates_even_for_a_missing_or_failed` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::the_default_frame_and_unready_or_unavailable_media_are_refused_with_st` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::the_editor_reads_the_same_contrast_bounds_the_publish_gate_uses_for_a_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::the_signed_read_404s_for_anything_not_ready_or_not_a_derivative_file_n` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::the_signed_read_serves_the_rendered_bytes_privately_and_404s_once_the_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaDerivativeTest::validation_names_the_offending_path_and_unknown_body_keys_are_rejected` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaEvidenceBackfillTest::a_permanently_unreadable_prefix_is_skipped_by_the_cursor_and_work_stay` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaEvidenceBackfillTest::an_unreadable_file_leaves_the_evidence_empty_and_is_reported` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaEvidenceBackfillTest::it_measures_the_served_files_for_assets_and_derivatives_and_only_insid` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaRefTest::a_transformed_usage_resolves_to_its_own_derivative_sources_at_their_re` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaRefTest::anything_that_cannot_be_resolved_is_omitted_never_guessed` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaRefTest::only_section_background_pictures_carry_contrast_bounds_and_only_when_t` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaRefTest::repeated_background_references_cost_one_media_query_and_no_derivative_` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaRefTest::the_public_config_resolves_published_media_to_proxy_sources_and_per_lo` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `StorefrontMediaRefTest::the_resolver_is_pure_over_the_published_document_and_keys_by_reference` | `ErrorException: Undefined array key "data" <harness>/vendor/laravel/framework/src/Illuminate/Foundation/Bootst…` | **FAIL** | pass | **FAIL** | pass | pass | **FAIL** | pass | SDK |
| `FuelAviRfidServiceTest::an_authorization_cannot_be_reused_or_overridden_by_client_references` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelAviRfidServiceTest::approved_vehicle_identity_is_auditable_and_can_feed_the_existing_sale_` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelAviRfidServiceTest::the_engine_records_explicit_denials_for_dual_identity_blacklist_and_ca` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::a_measurement_cannot_be_reused_for_a_second_reconciliation` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::approved_reconciliation_and_operational_ledger_are_immutable` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::explicit_approval_of_a_surplus_uses_the_opposite_inventory_variance_di` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::official_reconciliation_rejects_a_fuel_product_not_mapped_to_millilite` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::physical_evidence_is_separate_until_explicit_approval_then_creates_sto` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::source_totals_cannot_be_injected_before_delivery_sale_or_transfer_cycl` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::station_warehouse_cannot_change_once_it_has_operational_ledger_history` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelReconciliationTest::tenant_defaults_and_station_overrides_are_resolved_and_audited` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleApiTest::fuel_sale_api_enforces_exact_permissions_and_finalizes_only_from_the_s` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_collects_an_official_cash_receipt_without_mutating_cycle_four_opera` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_collects_official_cash_when_deposit_scope_user_matches_the_authenti` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_denies_official_cash_collection_when_deposit_scope_user_does_not_ma` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_finalizes_a_fractional_fuel_sale_once_to_a_credit_invoice_and_exact` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_resolves_station_price_before_tenant_default_and_fails_closed_witho` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_snapshots_the_station_tax_mode_and_uses_invoice_vat_without_reinter` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSaleServiceTest::it_uses_audited_contract_pricing_and_blocks_credit_and_card_limit_befo` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingApiTest::authorized_api_creates_and_approves_fuel_delivery_with_explicit_grni_r` | `Expected response status code [200] but received 500. Failed asserting that 500 is identical to 200.` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingApiTest::supplier_invoice_api_matches_an_approved_delivery_without_a_second_inv` | `Expected response status code [200] but received 500. Failed asserting that 500 is identical to 200.` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingTest::approved_fuel_receipt_posts_inventory_to_explicit_grni_and_records_exa` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingTest::exact_supplier_invoice_match_clears_grni_to_payable_without_second_sto` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingTest::multiple_exactly_priced_receipts_keep_a_rational_cost_pool_without_rou` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingTest::rational_cost_basis_carries_fractional_halala_deterministically_until_` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
| `FuelSupplyReceivingTest::value_variance_clears_only_the_safe_part_and_never_revalues_inventory_` | `Error: Call to undefined function App\Services\bcmul() <harness>/app/Services/FuelCostBasisService.php:380…` | **FAIL** | **FAIL** | pass | pass | **FAIL** | pass | pass | bcmath |
