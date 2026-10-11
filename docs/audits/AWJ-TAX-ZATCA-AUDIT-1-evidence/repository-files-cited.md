# Repository files cited as evidence — moved from Appendix A of the audit report

141 tracked repository paths cited in the stream working papers, grouped by top-level area.

## (root) (4)

- `CLAUDE.md`
- `Dockerfile`
- `HOW_TO_RUN.md`
- `render.yaml`

## .github (1)

- `.github/workflows/ci.yml`

## app (92)

- `app/Console/Commands/GrantLegacyReachableZatcaCommand.php`
- `app/Console/Commands/RunDocumentRetentionCommand.php`
- `app/Http/Controllers/Api/CreditNoteController.php`
- `app/Http/Controllers/Api/InvoiceController.php`
- `app/Http/Controllers/Api/PosController.php`
- `app/Http/Controllers/Api/SalesConfigController.php`
- `app/Http/Controllers/Api/ZatcaCredentialController.php`
- `app/Http/Controllers/Api/ZatcaSettingsController.php`
- `app/Http/Controllers/Api/ZatcaSubmissionController.php`
- `app/Http/Middleware/EnsureApplicationActive.php`
- `app/Http/Requests/StoreCreditNoteRequest.php`
- `app/Http/Requests/StoreInvoiceRequest.php`
- `app/Http/Requests/UpdateZatcaCredentialRequest.php`
- `app/Http/Requests/UpdateZatcaSettingsRequest.php`
- `app/Http/Resources/InvoiceResource.php`
- `app/Jobs/Accounting/SendZatcaSubmission.php`
- `app/Models/BaseModel.php`
- `app/Models/CreditNote.php`
- `app/Models/Invoice.php`
- `app/Models/JournalEntry.php`
- `app/Models/Tenant.php`
- `app/Models/User.php`
- `app/Models/ZatcaCredential.php`
- `app/Models/ZatcaSubmissionAttempt.php`
- `app/Services/Accounting/AccountRoutingService.php`
- `app/Services/Accounting/ComputesLineTax.php`
- `app/Services/Accounting/CreditNoteService.php`
- `app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php`
- `app/Services/Accounting/ExpenseService.php`
- `app/Services/Accounting/InvoiceLinePrecision.php`
- `app/Services/Accounting/InvoiceService.php`
- `app/Services/Accounting/LedgerService.php`
- `app/Services/Accounting/PosExchangeService.php`
- `app/Services/Accounting/PosReturnService.php`
- `app/Services/Accounting/PosService.php`
- `app/Services/Accounting/ProcurementService.php`
- `app/Services/Accounting/PurchaseService.php`
- `app/Services/Accounting/QuoteService.php`
- `app/Services/Accounting/RecurringInvoiceService.php`
- `app/Services/Accounting/ReturnService.php`
- `app/Services/Accounting/ZatcaCredentialMaterialValidator.php`
- `app/Services/Accounting/ZatcaCredentialService.php`
- `app/Services/Accounting/ZatcaHttpTransport.php`
- `app/Services/Accounting/ZatcaInvoiceHasher.php`
- `app/Services/Accounting/ZatcaInvoiceSigner.php`
- `app/Services/Accounting/ZatcaNotificationBridge.php`
- `app/Services/Accounting/ZatcaPhaseTwoQrEncoder.php`
- `app/Services/Accounting/ZatcaQrCertificateMaterialExtractor.php`
- `app/Services/Accounting/ZatcaService.php`
- `app/Services/Accounting/ZatcaSignaturePolicy.php`
- `app/Services/Accounting/ZatcaSignaturePolicyResolver.php`
- `app/Services/Accounting/ZatcaSignedInvoiceFinalizer.php`
- `app/Services/Accounting/ZatcaSignedInvoiceQrMaterialExtractor.php`
- `app/Services/Accounting/ZatcaSigningCredentialResolver.php`
- `app/Services/Accounting/ZatcaSigningReadiness.php`
- `app/Services/Accounting/ZatcaSubmissionDispatcher.php`
- `app/Services/Accounting/ZatcaSubmissionEndpointResolver.php`
- `app/Services/Accounting/ZatcaSubmissionQueue.php`
- `app/Services/Accounting/ZatcaSubmissionService.php`
- `app/Services/Accounting/ZatcaTransportCredential.php`
- `app/Services/Accounting/ZatcaTransportCredentialResolver.php`
- `app/Services/Accounting/ZatcaTransportReadiness.php`
- `app/Services/Accounting/ZatcaTransportResult.php`
- `app/Services/Accounting/ZatcaXadesSignatureAssembler.php`
- `app/Services/Accounting/ZatcaXadesSignedPropertiesBuilder.php`
- `app/Services/Accounting/ZatcaXmlCanonicalizer.php`
- `app/Services/Accounting/ZatcaXmlDsigSignedInfoBuilder.php`
- `app/Services/Accounting/ZatcaXmlEcdsaSigner.php`
- `app/Services/Commerce/CommerceCheckoutService.php`
- `app/Services/DocumentCenter/DocumentFinancialValidator.php`
- `app/Services/DocumentCenter/DocumentRetentionRunner.php`
- `app/Services/DocumentCenter/ExpenseDocumentDraftBuilder.php`
- `app/Services/DocumentCenter/PurchaseDocumentDraftBuilder.php`
- `app/Services/FuelSaleService.php`
- `app/Services/FuelStationSettingsService.php`
- `app/Services/PrintTemplates/PrintTemplateService.php`
- `app/Services/Reporting/ReportService.php`
- `app/Services/TenantApplicationService.php`
- `app/Support/AccountingRoles.php`
- `app/Support/ApplicationCatalog.php`
- `app/Support/GeneratesDocumentNumbers.php`
- `app/Support/Money.php`
- `app/Support/NotificationActions.php`
- `app/Support/PrintTemplateContract.php`
- `app/Support/Rbac.php`
- `app/Support/RecordsRevisions.php`
- `app/Support/Settings.php`
- `app/Support/WebhookEventCatalog.php`
- `app/Support/ZatcaIcvScope.php`
- `app/Support/ZatcaSubmissionConflict.php`
- `app/Tenancy/TenantContext.php`
- `app/Tenancy/TenantScope.php`

## config (2)

- `config/document_center.php`
- `config/zatca.php`

## database (3)

- `database/migrations/2025_01_01_000002_create_accounting_core.php`
- `database/migrations/2025_01_01_000004_create_invoices.php`
- `database/migrations/2025_01_01_000131_create_zatca_credentials_table.php`

## deploy (4)

- `deploy/DEPLOY.md`
- `deploy/assemble.sh`
- `deploy/cors.php`
- `deploy/entrypoint.sh`

## docs (4)

- `docs/PRINT_TEMPLATE_PLATFORM.md`
- `docs/agent-workspace/DECISIONS.md`
- `docs/plans/alerts-notifications/AWJ_NOTIFICATIONS_PR_NOTIF_4_IMPLEMENTATION_REPORT.md`
- `docs/plans/pos/DELIVERY-DECISION-PASS-7-DG-3-TAX-POINT-REPORT.md`

## routes (3)

- `routes/api.php`
- `routes/api_public.php`
- `routes/console.php`

## storefront (3)

- `storefront/src/components/checkout/awj/Confirmation.tsx`
- `storefront/src/lib/commerce/capabilities.ts`
- `storefront/src/lib/data/markets.ts`

## tests (5)

- `tests/Feature/InteractsWithApi.php`
- `tests/Feature/InventoryStatePostgresConcurrencyTest.php`
- `tests/Feature/InvoiceLinePrecisionTest.php`
- `tests/Feature/PosCheckoutTest.php`
- `tests/Feature/ZatcaTest.php`

## web (20)

- `web/src/app/(app)/invoices/[id]/page.tsx`
- `web/src/app/(app)/sales-settings/einvoice/page.tsx`
- `web/src/app/(pos)/pos/page.tsx`
- `web/src/app/page.tsx`
- `web/src/components/credit-notes/credit-note-form.tsx`
- `web/src/components/documents/tax-document.tsx`
- `web/src/components/invoices/invoice-form.tsx`
- `web/src/components/pos/pos-invoice-details.tsx`
- `web/src/components/reports/general-advanced-reports-workspace.tsx`
- `web/src/components/returns/create-return-dialog.tsx`
- `web/src/components/settings/tax-settings-card.tsx`
- `web/src/lib/notifications.ts`
- `web/src/lib/pos-receipt.ts`
- `web/src/lib/tax.ts`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`
- `web/src/modules/documents/builder/from-invoice.ts`
- `web/src/modules/documents/components/document-body.tsx`
- `web/src/modules/documents/components/sections/doc-qr.tsx`
- `web/src/modules/invoices/services/invoice-pdf.ts`
