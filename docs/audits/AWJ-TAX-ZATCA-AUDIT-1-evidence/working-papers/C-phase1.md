> **Working paper — unedited stream output.** Written before the official-source registers existed, so regulatory citations tagged `[official-ref to confirm]` were resolved afterwards; severities, normalised statuses, re-ratings and register citations in **AWJ-TAX-ZATCA-AUDIT-1.md** and **AWJ-TAX-ZATCA-GAP-MATRIX.md** prevail where they differ. Paths of the form `<audit-workspace>/…` refer to the audit workspace (probe sources, logs, SDK runs) that is not part of the repository; the relevant extracts are in `probe-outputs.md` and `sdk-validation-extracts.md`. **Superseded after review (PR #1290):** where a paper says the web UI was only read, or implies there is no web test suite, `web-test-results.md` and `web-test-mapping.md` give the results of the Vitest and Playwright runs; where a paper attributes a test failure to the sandbox, `test-results.md` shows the controlled attribution.

# Stream C — ZATCA Phase 1 (Generation) & document rendering/preservation

Audit: AWJ-TAX-ZATCA-AUDIT-1 · Repo `<repo>` @ `0534ef16543b01c69b416b58897337e012a9d1ab` · Date 2026-10-10 · Prefix `PH1-`
Official registers `<audit-workspace>/official/R1-*.md` / `R2-*.md` did **not** exist when this stream ran; every regulatory citation below is tagged `[official-ref to confirm]` for the consolidator.

---

## 1. Scope & method

### 1.1 Files read (whole-file unless noted; line counts from `wc -l`)

Backend (PHP):
- `app/Services/Accounting/ZatcaService.php` (316) — Phase-1 QR/TLV, XML builder, ICV/PIH
- `app/Services/Accounting/InvoiceService.php` (1285) — create/update/duplicate/deleteDraft/post, numbering
- `app/Services/Accounting/ZatcaSignedInvoiceFinalizer.php` (132), `ZatcaPhaseTwoQrEncoder.php` (104) — what changes once a credential row exists
- `app/Services/Accounting/CreditNoteService.php` (253), `PosService.php` (775), `PosReturnService.php` (375, lines 140-185), `ReturnService.php` (853, lines 85-140 + grep)
- `app/Services/PrintTemplates/PrintTemplateService.php` (361), `app/Support/PrintTemplateContract.php` (411), `docs/PRINT_TEMPLATE_PLATFORM.md` (207)
- `app/Models/Invoice.php` (200), `InvoiceLine.php` (91), `Tenant.php` (46), `Branch.php` (127), `Partner.php` (107), `CreditNote.php` (83), `ReturnDocument.php` (60 of ~), `DocumentRevision.php` (81)
- `app/Support/GeneratesDocumentNumbers.php` (167), `DocumentNumberingCatalog.php` (503), `ZatcaIcvScope.php` (104), `Settings.php` (425), `CompanyProfile.php` (77), `RecordsRevisions.php` (101)
- `app/Http/Controllers/Api/InvoiceController.php` (395), `NumberingSettingsController.php` (48), `CompanyController.php` (40), `CreditNoteController.php` (58), `ZatcaSettingsController.php`, `PublicInvoiceController.php` (178), `PosController.php` (lines 320-480)
- `app/Http/Requests/StoreInvoiceRequest.php` (76), `UpdateCompanyRequest.php` (37), `StorePartnerRequest.php` (44), `UpdatePartnerRequest.php` (41), `PublicStorePartnerRequest.php` (45), `StoreBranchRequest.php` (33), `PlatformTenantUpdateRequest.php` (38), `UpdateNumberingSettingsRequest.php` (62), `UpdateZatcaSettingsRequest.php` (52), `PublicStoreInvoiceRequest.php` (48), `RegisterRequest.php` (grep)
- `app/Http/Resources/InvoiceResource.php` (142), `CreditNoteResource.php` (36)
- `app/Http/Middleware/EnsureApplicationActive.php` (65, grep), `app/Services/TenantApplicationService.php` (519, grep), `app/Support/ApplicationCatalog.php` (lines 85-110), `app/Support/Rbac.php` (lines 25-85)
- `app/Services/DocumentCenter/DocumentRetentionRunner.php` (269, grep), `DocumentRetentionPlanner.php` (grep), `DocumentRetentionPolicyService.php` (37), `app/Console/Commands/RunDocumentRetentionCommand.php` (69), `config/document_center.php` (45), `config/zatca.php` (64), `render.yaml` (64)
- Migrations: `000001` (tenants, grep), `000003` (partners, grep), `000004` (invoices, grep), `000012`, `000013`, `000018` (credit_notes), `000031` (branches), `000053` (branch-scoped numbering + ICV unique), `000129`, `000132`
- `routes/api.php` (grep of invoice/zatca/numbering routes), `routes/api_public.php` (grep)
- Tests: `tests/Feature/ZatcaTest.php` (204), `DocumentNumberingTest.php` (382, lines 60-135/170-260/345-382), `NumberingSettingsTest.php` (method list), `InvoiceTest.php` (method list), `PrintTemplateTest.php` (method list), `PosCheckoutTest.php` (lines 1-120), `InteractsWithApi.php` (108, lines 54-80)

Web (TypeScript/React):
- `web/src/modules/documents/builder/from-invoice.ts` (202), `from-credit-note.ts` (84), `types/index.ts` (330)
- `web/src/modules/documents/components/sections/doc-qr.tsx` (48), `doc-summary.tsx` (lines 1-45), `doc-parties.tsx` (376, grep), `doc-header.tsx` (579, grep), `doc-totals.tsx` (grep), `doc-items-table.tsx` (lines 1-200), `doc-info-row.tsx` (23), `doc-footer.tsx` (grep)
- `web/src/modules/documents/components/document-body.tsx` (128, grep), `document-view.tsx` (grep), `templates/thermal-receipt.tsx` (141), `templates/tax-invoice-classic-v2.tsx` (10; the other nine `tax-invoice-*.tsx` are identical 10-line wrappers around `DocumentBody`), `registry/document-types.ts` (439, grep), `registry/templates.ts` (148, grep), `presentation/visual-v2.ts` / `modern-bilingual-label.tsx` / `use-document-label-mode.ts` (grep)
- `web/src/app/(app)/invoices/[id]/page.tsx` (1113, lines 276-315, 600-700 + grep), `web/src/app/(app)/sales-settings/einvoice/page.tsx` (283), `web/src/app/(pos)/pos/page.tsx` (2563, lines 1430-1480, 1717-1735 + grep), `web/src/lib/pos-receipt.ts` (79), `web/src/components/pos/pos-invoice-details.tsx` (253), `receipt-dialog.tsx` (grep), `web/src/modules/invoices/services/invoice-pdf.ts` (592, grep), `web/src/components/documents/tax-document.tsx` (183, grep), `web/src/components/invoices/invoice-form.tsx` (grep), `web/src/messages/ar.json` / `en.json` (targeted extraction), `local-hardware-bridge/bridge.mjs` (grep)

### 1.2 Probes written (<audit-workspace>/probes/C/) and commands run

```bash
SCR=<audit-workspace>
cd <harness>
# Probe 1 — QR/TLV/timestamp/timezone/snapshot/mutation guards (sqlite)
DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/C-probe1.sqlite php artisan test <audit-workspace>/probes/C/CPhase1QrProbeTest.php
#   → 10 test methods; all behaviours printed as [C-PROBE] lines; log: <audit-workspace>/logs/C-probe1.log
# Probe 2 — numbering (PostgreSQL audit_c)
DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=audit_c DB_USERNAME=audit DB_PASSWORD=audit \
  php artisan test <audit-workspace>/probes/C/CNumberingProbeTest.php         # 5 passed (after fixing my own anchor-visibility setup); log C-probe2-pg.log
# Probe 3 — POS checkout / API guards / app-gated QR (sqlite, uses InteractsWithApi::registerTenant)
DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/C-probe3.sqlite php artisan test <audit-workspace>/probes/C/CPosApiProbeTest.php   # 2 passed; log C-probe3.log
```

Existing tests run (exact filters; what they assert is stated where relied upon):
| Test | Driver | Result |
|---|---|---|
| `--filter='ZatcaTest'` | sqlite | **10 passed** (TLV 5 tags, amounts, hash = C14N11 SHA-256 of stored XML, classification snapshot, request validation of `zatca_document_type`) |
| `--filter='DocumentNumberingTest'` | **pgsql** | **11 passed** incl. `two_concurrent_requests_cannot_take_the_same_number` (not skipped on PG), `the_unique_constraint_rejects_a_duplicate_number`, `the_zatca_counter_cannot_be_duplicated`, `the_zatca_counter_stays_tenant_wide_while_numbers_split_by_branch` |
| `--filter='NumberingSettingsTest'` | **pgsql** | **17 passed** (prefix/suffix editing, catalog excludes ICV, permission `company.manage`) |
| `--filter='InvoiceTest::(a_posted_invoice_cannot_be_edited\|a_posted_invoice_cannot_be_deleted\|a_draft_invoice_can_be_deleted_with_its_lines\|totals_are_derived_from_lines_even_if_the_header_is_tampered\|posting_an_invoice_freezes_the_published_print_template_revision\|posting_a_simplified_invoice_freezes_simplified_assignments_over_tax_invoice\|it_duplicates_a_posted_paid_invoice_into_a_clean_editable_draft)'` | sqlite | **7 passed** |
| `--filter='PrintTemplateTest::(invoice_document_type_maps_zatca_simplified_independently\|template_layout_rejects_unsupported_duplicate_and_hidden_required_blocks\|publishing_freezes_the_revision_and_a_later_edit_creates_a_new_draft)'` | sqlite | **3 passed** |
| `--filter='PosCheckoutIdempotencyTest'` | sqlite | **7 passed** incl. `replay_does_not_duplicate_stock_or_journal_or_zatca_fields` |

Key probe outputs (verbatim from logs):
```
[C-PROBE] app.timezone: UTC
[C-PROBE] invoice_date (printed date): 2026-09-15 | created_at: 2026-10-01 09:00:00 | QR tag3: 2026-10-01T09:00:00+00:00 | XML IssueDate/Time: ["2026-10-01","09:00:00"] | journal entry_date: 2026-09-15   (posted on 2026-10-05 14:30)
[C-PROBE] Asia/Riyadh: QR tag3: 2026-10-01T12:00:00+03:00
[C-PROBE] seller name bytes: 260 | TLV tag1 length byte: 4 | decoded tags present: [1,217,133] | decoded tag2 (expected VAT): null
[C-PROBE] no-VAT tenant: status: posted | QR tag2: "" | XML CompanyID: ""
[C-PROBE] zero-tax/large: QR tag4/tag5: ["3000000.12","0.02"] | XML cbc:ID == number: true
[C-PROBE] XML structural inventory: TaxSubtotal=false, line tax=false, seller PostalAddress=false, PartyIdentification(CRN)=false, InvoiceLine TaxTotal=false, AllowanceCharge=false, ActualDeliveryDate=false, PaymentMeans=false, TaxCurrencyCode=false, BillingReference=false, ProfileID=reporting:1.0, InvoiceTypeCode=0200000/388
[C-PROBE] large multi-line post: TypeError: intdiv(): Argument #1 ($num1) must be of type int, float given | draft still draft after failed post?: draft
[C-PROBE] standard w/o buyer VAT: status/type: ["posted","standard"] | buyer XML: <cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>عميل تجزئة</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party>
[C-PROBE] VAT buyer auto: type: standard | XML contains buyer VAT?: false
[C-PROBE] alpha VAT partner: stored vat / type: ["ABCDEFGHIJKLMNO","simplified"]
[C-PROBE] stored QR unchanged after rename: true | stored XML unchanged: true | qrFor(live) == stored: false | invoice seller/buyer snapshot columns: []
[C-PROBE] mutation guards: service.update blocked; service.deleteDraft blocked; model.update(total,zatca_document_type,zatca_qr,number) → [1,"standard","TAMPERED","X-1"]; model.delete → row gone, journal entry still exists, lines cascade-deleted; invoices uses SoftDeletes? false
[C-PROBE] draft number / qr / xml / icv: ["INV-2026-00001",null,null,null]
[C-PROBE] credit_notes zatca/qr columns: [] | return_documents zatca/qr columns: [] | credit note posted: number/original_invoice_id/reason: ["CN-2026-00001",null,null]
[C-NUM] sequence after posting A,C and deleting draft B: A=INV-2026-00001 B(deleted)=00002 C=00003 D=00004 → numbers in DB [00001,00003,00004]
[C-NUM] last draft deleted → next number: ["INV-2026-00002","INV-2026-00002"]
[C-NUM] mid-year prefix/suffix change: [INV-2026-00001, INV-2026-00002, FAT-2026-00001, FAT-2026-00001-JED, INV-2026-00003] | next year restarts: INV-2027-00001
[C-NUM] service create with explicit number: MANUAL-7 | duplicate (branch_id NULL): rejected 23505 invoices_tenant_id_number_branchless_unique
[C-NUM] invoices unique indexes (pg): (tenant_id, branch_id, number) · (tenant_id, zatca_icv) · (tenant_id, number) WHERE branch_id IS NULL
[C-NUM] rival blocked on tenant anchor: true
[C-POS] POS walk-in: ["simplified","posted","INV-2026-00001",qr=true] | POS VAT-registered buyer: standard
[C-POS] POS QR tag3 / created_at / invoice_date: ["2026-10-10T12:39:51+00:00","2026-10-10 12:39:51","2026-10-10"] | checkout response keys exposing issue time: []
[C-POS] company vat_number accepted by PUT /company (5 digits): 12345 | next invoice QR tag1/tag2 after bad VAT saved: ["اسم تجاري جديد","12345"]
[C-POS] API guards after posting: PUT 422, DELETE 422, PUT classification 422, POST post-again 422
[C-POS] POST /invoices with number/status/zatca_qr/back-date: ["INV-2020-00001","draft",null,"2020-01-01"] | back-dated invoice QR tag3 vs invoice_date: ["2026-10-10T12:39:52+00:00","2020-01-01"]
[C-POS] nav-state compliance.zatca for a fresh tenant: false | posted invoice has stored QR in InvoiceResource? true | GET /invoices/{id}/zatca status: 403 "هذه القدرة غير مفعّلة لهذه المؤسسة."
```

---

## 2. Positive controls (VERIFIED IMPLEMENTED)

| # | Control | Evidence |
|---|---|---|
| PC-1 | **Phase-1 QR is computed once at posting and stored** (`invoices.zatca_qr`); it is never recomputed on render. `qrFor()` has a single caller (`buildFor`, `ZatcaService.php:82`); the API (`InvoiceController::zatca` `:341-359`, `InvoiceResource.php:128-139`) and all renderers (`invoices/[id]/page.tsx:626,673,685`; `pos/page.tsx:1468,1726`; `doc-qr.tsx:20,37`) read the stored value. | Probe 1 `stored_qr_and_xml_survive_tenant_rename…`: stored QR/XML unchanged after tenant/partner rename; Probe 3: `/zatca` returns stored QR after company rename. |
| PC-2 | TLV encoding uses **UTF-8 byte length** (`strlen`), amounts are formatted from integer halalas without float (`ZatcaService.php:181-195`), 5 tags in order 1..5. | `ZatcaTest` (10 passed: `tlv_encodes_tag_length_and_value`, `amount_is_formatted…`, `qr_decodes_to_the_five_mandatory_tlv_fields`). Probe 1 zero-tax: tag5 `0.02`, tag4 `3000000.12`. |
| PC-3 | **Invoice totals are derived from lines before QR/XML/ledger** (`InvoiceService.php:894-916`, `:1023-1026`); header tampering cannot reach the QR. | `InvoiceTest::totals_are_derived_from_lines_even_if_the_header_is_tampered` passed. |
| PC-4 | **Service + API immutability after posting**: `update()` `:163-165`, `deleteDraft()` `:462-464`, controller `update/destroy` route through the service (`InvoiceController.php:289,326`); re-posting blocked by `lockForUpdate` + re-check (`:889-892`). | `InvoiceTest::a_posted_invoice_cannot_be_edited/_deleted` passed; Probe 3: PUT/DELETE/classification/post-again all 422. |
| PC-5 | `zatca_document_type` is a **stored snapshot** decided at draft, re-derived only when null (`InvoiceService.php:429-447`, `:1020`); request validation restricts it to `standard\|simplified` (`StoreInvoiceRequest.php:19`); the printed title follows it (`PrintTemplateContract::invoiceDocumentType` `:158-161` → `documentTypes.tax_invoice` = "فاتورة ضريبية" / `simplified_tax_invoice` = "فاتورة ضريبية مبسطة", `ar.json`); the A4 page passes `documentType={catalogType}` (`invoices/[id]/page.tsx:485,640`). | `ZatcaTest` classification tests; `PrintTemplateTest::invoice_document_type_maps_zatca_simplified_independently`. |
| PC-6 | **Numbering is DB-guarded and serialised**: unique `(tenant_id, branch_id, number)` + partial unique `(tenant_id, number) WHERE branch_id IS NULL` + unique `(tenant_id, zatca_icv)` (migration `000053:57-70,105-114`); allocation locks the tenant/branch anchor row (`GeneratesDocumentNumbers.php:153-166`); `max()+1` with length-aware ordering (`:95-107`). Number printed == `cbc:ID` in XML (`ZatcaService.php:268`). | PG: `DocumentNumberingTest` 11 passed incl. real concurrency; Probe 2 listed the three unique indexes on PG and confirmed the rival connection blocks on the anchor. Probe 1: `XML cbc:ID == number: true`. |
| PC-7 | **ICV is tenant-wide and locked** (`ZatcaService.php:59-75`), separate from document numbering, with a runtime guard preventing per-branch ICV until `branches.vat_number` + a branch-aware unique index exist (`ZatcaIcvScope.php:54-103`; `UpdateZatcaSettingsRequest::withValidator`). | `DocumentNumberingTest::the_zatca_counter_stays_tenant_wide_while_numbers_split_by_branch` passed on PG. |
| PC-8 | **Print-template revisions are frozen at posting** for print/pdf/thermal (`InvoiceService::freezeOutputRevisionIds` `:395-422`, `:1038-1040`; `CreditNoteService.php:159-167`); a template cannot hide QR/totals: web `sections` only carries `{logo}` (`document-view.tsx:37`), QR lives inside the `summary` block (`doc-summary.tsx:20`, `document-body.tsx:73`) and `summary`/`header`/`parties`/`items`/`footer` are server-required for invoices (`PrintTemplateContract::layoutContract` `:374-388`). | `InvoiceTest::posting_an_invoice_freezes_the_published_print_template_revision`; `PrintTemplateTest::template_layout_rejects_unsupported_duplicate_and_hidden_required_blocks` passed. |
| PC-9 | **Renderers do not recompute money**: `from-invoice.ts:185-192` maps the API's stored strings with `riyalToMinor`; totals/lines are stored values (`doc-totals.tsx:104-133`); the jsPDF generator prints `input.invoice.*` and rasterises the on-page QR SVG (`invoice-pdf.ts:62-63,479-487`); POS receipt reads only server values (`pos-receipt.ts:42-67`). | Code reading; `InvoiceDetail` comment "قراءة فقط" (`pos-invoice-details.tsx:27-32`). |
| PC-10 | The Public API cannot post, cannot set `number`/`status`/`zatca_*` (`PublicStoreInvoiceRequest.php:7-16`, `PublicInvoiceController.php:96-146`); the internal API strips `number`/`status`/`zatca_qr` (`StoreInvoiceRequest` whitelist). | Probe 3: `POST /invoices` with `number=HACK-1,status=posted,zatca_qr=X` → `INV-2020-00001`, `draft`, `null`. |
| PC-11 | **POS checkout is atomic and idempotent**, invoices are created+posted in one transaction (`PosService.php:242-253`), QR is in the checkout response (`InvoiceResource`), replays don't duplicate ZATCA fields. | `PosCheckoutIdempotencyTest` 7 passed. |
| PC-12 | Changing the e-invoice settings never transmits anything (`ZatcaSettingsController::update` only writes settings); readiness blockers are shown honestly in the UI (`einvoice/page.tsx:198-202,272-283`). | Code reading. |
| PC-13 | The web renderer exposes seller VAT/CRN/national address and buyer VAT on A4 (`doc-parties.tsx:39-43,66`, `doc-header.tsx:110-112`) and seller VAT/CRN/address + title + number + date + buyer + lines + totals + QR on thermal (`thermal-receipt.tsx:38-125`), across all ten `tax-invoice-*` templates (identical `DocumentBody` wrappers). | Code reading. |

---

## 3. Findings (P0 → P3)

### PH1-01 — Invoice issue date/time in QR and XML is the draft-creation timestamp, not the invoice date shown to the customer nor the posting time
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Invoice issuance (sales module, Public-API drafts, recurring invoices); back-dated and late-posted invoices.
- **Official requirement:** QR tag 3 = "Time stamp of the invoice (date and time)"; XML `IssueDate`/`IssueTime` = invoice issue date/time (E-Invoicing Implementation Resolution, Annex 2 Phase-1 mandatory fields; Security Features / QR specification) `[official-ref to confirm]`. VAT Implementing Regulations Art. 53(5) "date of issue" `[official-ref to confirm]`.
- **Actual behavior:** `ZatcaService::qrFor` uses `$invoice->created_at->toIso8601String()` (`app/Services/Accounting/ZatcaService.php:163`) and `buildXml` uses the same `created_at` for `IssueDate`/`IssueTime` (`:253,270-271`). `created_at` is set when the **draft** is created, while the printed document and the ledger use `invoice_date` (`from-invoice.ts:167`, `InvoiceService.php:1005`). Probe 1: draft created 2026-10-01 09:00, `invoice_date` 2026-09-15, posted 2026-10-05 → QR tag3 `2026-10-01T09:00:00+00:00`, XML `IssueDate 2026-10-01`, journal `2026-09-15`. Probe 3: a draft back-dated to `2020-01-01` posted today → QR `2026-10-10T12:39:52+00:00` vs printed date `2020-01-01`. The posting (issue) moment itself is recorded nowhere on the invoice.
- **Expected behavior:** One issue timestamp captured at posting (the legal issue moment), stored on the invoice, used for QR tag 3, XML `IssueDate/IssueTime`, and shown on the document; `invoice_date` must either equal it or be validated against it (back-dating policy).
- **Evidence:** `ZatcaService.php:163,253,270-271`; `InvoiceService.php:83,98,111,1005`; `from-invoice.ts:165-170`; Probe 1 `qr_timestamp_is_draft_creation_time_not_invoice_date_nor_posting_time`; Probe 3 `[C-POS] back-dated…`.
- **Impact:** Regulatory — QR/XML contradict the human-readable invoice; a customer scanning the QR sees a different date; Phase-2 reporting would carry a wrong issue date (XML hash/PIH chain are built on it, so it cannot be corrected later). Operational — drafts held for days produce "issued" timestamps in the past.
- **Recommendation:** Add `issued_at` (UTC) set inside `post()`; derive QR tag 3, XML `IssueDate/IssueTime` and the printed issue date/time from it; decide (configurable policy per CLAUDE.md rule 6) whether `invoice_date` may differ from `issued_at`, and if so render both.
- **Regression tests required:** draft created day D, posted day D+4 → QR tag3/XML date == posting time; back-dated draft rejected or rendered with both dates; POS QR == checkout time.
- **Dependencies:** PH1-14 (offset format), Stream D (XML content).

### PH1-02 — Seller and buyer identity printed on issued invoices is read live; reprints change after a company/partner edit while the stored QR keeps the old data
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Reprint / PDF / share of an issued invoice after editing the company profile or the customer record.
- **Official requirement:** Tax invoice content must be preserved as issued; integrity of the invoice copy for 6 years (VAT Implementing Regulations Art. 53, Art. 66; E-Invoicing Regulation Art. 4/5 integrity & tamper-proof requirements) `[official-ref to confirm]`.
- **Actual behavior:** The invoice page builds the document from `/me` (live company profile) and `/partners/{id}` (live partner) (`invoices/[id]/page.tsx:280,282,295-296`; `from-invoice.ts:146-164`). There are **no snapshot columns** for seller/buyer on `invoices` (Probe 1: `invoice seller/buyer snapshot columns: []`). Only the template revision is frozen (`docs/PRINT_TEMPLATE_PLATFORM.md:7`), not the data. After `tenant->update(['name'=>…,'vat_number'=>…])` the stored QR/XML still carry the old name/VAT (Probe 1), so a reprint shows a seller name/VAT/address that no longer matches its own QR. Buyer address is never printed at all (builder only maps `name`, `vat_number`, `city` — `from-invoice.ts:160-164`; `InvoiceController::show` loads `partner:id,name,vat_number,city` `:150`).
- **Expected behavior:** Freeze seller (legal name, VAT, CRN, national address) and buyer (name, VAT, address) on the invoice at posting; renderers must read the frozen copy; QR must be built from the same frozen copy.
- **Evidence:** as above; `Tenant.php:19-23` (no legal/trade-name distinction, only `name`); `CompanyProfile.php:17-37` (address lives in `tenants.settings.company`, editable any time via `CompanyController.php:24-33`).
- **Impact:** Regulatory/legal — issued-invoice content is not preserved as issued; audit trail mismatch between QR and visible content; Phase-2 cleared XML would also diverge from the print.
- **Recommendation:** Add `seller_snapshot`/`buyer_snapshot` JSON (or columns) written in `post()`; expose them in `InvoiceResource`; make `from-invoice.ts` prefer the snapshot; document that profile edits do not affect issued invoices.
- **Regression tests required:** post → rename tenant/partner → `GET /invoices/{id}` still returns issue-time seller/buyer; renderer unit test uses snapshot.
- **Dependencies:** PH1-01.

### PH1-03 — E-invoicing is an optional "application"; fresh tenants start with it disabled, the QR endpoint returns 403, and A4/PDF invoices are rendered without the QR code
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Any tenant registered after `2026-08-21` (enforcement cutover) that has not explicitly enabled `compliance.zatca`; standard and simplified invoices printed/exported from `/invoices/{id}`.
- **Official requirement:** Phase 1 (generation) mandatory for all VAT-registered persons since 4 Dec 2021; QR code mandatory on simplified tax invoices (and their notes), recommended/required per spec on standard `[official-ref to confirm]`.
- **Actual behavior:** `ApplicationCatalog` declares `compliance.zatca` with `mandatory => false` (`app/Support/ApplicationCatalog.php:91-96`); `TenantApplicationService::ENFORCEMENT_CUTOVER_AT = '2026-08-21'` (`:51,243`) means post-cutover tenants start disabled. `GET invoices/{id}/zatca` is guarded by `$app('compliance.zatca')` (`routes/api.php:678`) → `EnsureApplicationActive` aborts 403 (`:42`). The invoice page obtains the QR **only** from that endpoint (`invoices/[id]/page.tsx:281,295`; no fallback to `invoice.zatca.qr`), so `zatca` stays `null` and `DocQr` renders an empty box (`doc-qr.tsx:43-45`). Probe 3 (`registerTenant(..., autoEnableApplications=false)` = real registration path): `nav-state compliance.zatca = false`; posted invoice **has** a stored QR in `InvoiceResource`; `GET /invoices/{id}/zatca → 403`. POS receipts are unaffected (QR comes from the checkout response, `pos/page.tsx:1430-1433`).
- **Expected behavior:** QR generation and display must not be switchable off for a KSA VAT-registered tenant; at minimum the renderer must fall back to `invoice.zatca.qr` (already in the resource) and the catalog entry should be mandatory.
- **Evidence:** as cited; Probe 3 `a_tenant_that_never_enabled_the_optional_zatca_app_cannot_fetch_the_qr…`.
- **Impact:** Regulatory — tax invoices issued without the mandatory QR by default for new tenants; the sidebar also hides the e-invoice settings so the tenant has no cue.
- **Recommendation:** Make `compliance.zatca` mandatory (or at least default-enabled for KSA tenants); read `qr` from `InvoiceResource.zatca.qr` on the invoice page; keep the `/zatca` endpoint for XML/hash details only.
- **Regression tests required:** fresh tenant (no app enablement) → invoice page data source contains QR; web test that `DocQr` renders when `invoice.zatca.qr` is present.
- **Dependencies:** none.

### PH1-04 — Seller VAT number is neither format-validated nor required at issuance; invoices are issued with an empty or malformed VAT number in QR, XML and print
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Company profile editing, registration, posting.
- **Official requirement:** Tax invoice must show the supplier's VAT registration number; TIN is 15 digits starting and ending with 3 (QR spec validates `^3\d{13}3$`) `[official-ref to confirm]`.
- **Actual behavior:** `UpdateCompanyRequest.php:18` validates `vat_number` only as `nullable|string|max:20` (DB column is `string(15)`, migration `000001:16` → values of 16-20 chars would fail at DB level on PostgreSQL = 500, NOT VERIFIED); `RegisterRequest.php:28` only `size:15` (letters accepted); `PlatformTenantUpdateRequest` does not touch it. `ZatcaService::qrFor/buildXml` fall back to `''` (`:162,296`) and `InvoiceService::post` has no precondition on seller VAT. Probe 1: tenant with `vat_number=null` → invoice **posted**, QR tag2 = `""`, XML `CompanyID` empty. Probe 3: `PUT /company {vat_number: "12345"}` → 200; the next invoice's QR tag2 = `12345`. The Phase-2 encoder would reject this (`ZatcaPhaseTwoQrEncoder.php:32-34`), so behaviour differs between phases. Buyer VAT (`StorePartnerRequest.php:22`, `PublicStorePartnerRequest.php:30`) is `size:15` only; `ABCDEFGHIJKLMNO` is stored and silently classified "simplified" (`InvoiceService.php:446`).
- **Expected behavior:** Validate `^3\d{13}3$` on tenant and partner VAT numbers; refuse to post a tax invoice when the seller VAT is missing/invalid (configurable only for non-registered sellers, which is a different document type).
- **Evidence:** cited lines; Probe 1 `seller_without_vat_number_still_posts_and_qr_tag2_is_empty`; Probe 3 `[C-POS] company vat_number accepted … 12345`.
- **Impact:** Regulatory — invalid tax invoices (Art. 53) and QR codes that fail the official validator; financial — buyer cannot recover input VAT on an invoice lacking a valid supplier TIN.
- **Recommendation:** Shared `SaudiVatNumber` rule applied in `UpdateCompanyRequest`, `RegisterRequest`, `StorePartnerRequest`, `PublicStorePartnerRequest`; posting precondition in `InvoiceService::post` (fail closed with a clear message).
- **Regression tests required:** company update with `12345`/letters → 422; post with empty seller VAT → RuntimeException; QR tag2 matches `^3\d{13}3$`.
- **Dependencies:** PH1-02 (snapshot), Stream D (Phase-2 encoder parity).

### PH1-05 — Standard vs simplified classification is advisory only: standard invoices can be issued without buyer VAT/address, simplified invoices to VAT-registered buyers, and the XML/print omit mandatory buyer data
- **Severity:** P1
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** B2B invoicing (standard tax invoice), POS sales to VAT-registered customers, manual override in the invoice form.
- **Official requirement:** Standard tax invoice must carry buyer name, address and VAT number (Art. 53(5)); simplified invoices are for B2C; business buyers need a standard invoice to deduct input VAT `[official-ref to confirm]`.
- **Actual behavior:** Classification is a suggestion from the partner VAT regex, overridable by any explicit value (`InvoiceService.php:431-446`; UI selector `invoice-form.tsx:712-724`). No validation at create or post that a `standard` invoice has buyer VAT + address, nor that a `simplified` one is B2C. Probe 1: explicit `standard` for a buyer with no VAT/address → posted; buyer VAT present in DB but **absent from XML** (`buildXml` writes only `RegistrationName`, `ZatcaService.php:300-304`); `ZatcaTest::an_explicit_document_type_overrides_the_customer_suggestion` proves simplified-to-VAT-buyer is accepted. Printed A4 shows buyer VAT (live) but **never** the buyer address (PH1-02). POS auto-classifies a VAT-registered walk-in as `standard` (Probe 3) with a thermal receipt and no buyer address — a standard tax invoice rendered as a receipt.
- **Expected behavior:** Posting a `standard` invoice must require buyer name + national address + VAT number (or CRN/other ID when not VAT-registered) and render them; a `simplified` invoice to a VAT-registered buyer should at least warn/require confirmation (policy per CLAUDE.md rule 6).
- **Evidence:** cited lines; Probe 1 `explicit_standard_posts_without_buyer_vat_or_address…`; Probe 3 `POS VAT-registered buyer: standard`.
- **Impact:** Regulatory — invalid standard tax invoices; Phase-2 clearance of such XML would be rejected; buyer input-VAT recovery risk.
- **Recommendation:** Posting preconditions by `zatca_document_type`; map buyer VAT/address into XML and into the printed parties block; POS: restrict to simplified unless buyer data is complete.
- **Regression tests required:** standard without buyer VAT/address → 422; XML of standard contains `PartyTaxScheme/CompanyID` + `PostalAddress` for buyer; print snapshot includes buyer address.
- **Dependencies:** PH1-02, Stream D.

### PH1-06 — Credit notes and sales returns are issued without QR, without a mandatory reference to the original invoice and without a mandatory reason
- **Severity:** P1
- **Status:** NOT IMPLEMENTED
- **Business process:** `CreditNote` (financial credit/debit notes), `ReturnDocument` (sales returns = credit notes with stock), POS returns/exchanges.
- **Official requirement:** Credit/debit notes must reference the original invoice and state the reason; e-notes associated with simplified invoices carry a QR; notes are e-invoices under the regulation `[official-ref to confirm]` (VAT IR Art. 54; E-Invoicing Resolution Annex 2 "billing reference").
- **Actual behavior:** `credit_notes` and `return_documents` have no `zatca_*`/`qr`/`uuid` columns (Probe 1 schema listing; models `CreditNote.php:22-27`, `ReturnDocument.php:25-32`); `CreditNoteService::create/post` never calls `ZatcaService` (`:50-176`); `original_invoice_id` and `reason` are nullable (`migration 000018:29-30`, `CreditNoteService.php:67-68`) — Probe 1 posted `CN-2026-00001` with both `null`. Sales returns need a source only if `sales.require_return_source` is set, default `false` (`Settings.php:76`, `ReturnService.php` resolveSource). The printed credit note has `qr: null` and shows only `reason` as a note; no original-invoice number (`from-credit-note.ts:62,76,78`). ICV/PIH chain therefore never includes notes.
- **Expected behavior:** Notes generated through the same e-invoice pipeline (QR, UUID, ICV, XML with `BillingReference`, type code 381/383), with mandatory original-invoice reference and reason, rendered on the document.
- **Evidence:** cited lines; Probe 1 `drafts_carry_a_legal_number…` output.
- **Impact:** Regulatory — non-compliant credit/debit notes (Phase 1 and Phase 2); the Phase-2 hash chain is incomplete by design.
- **Recommendation:** Extend `ZatcaService::buildFor` to a document-type-aware builder used by `CreditNoteService::post` and `ReturnService::post`; make `original_invoice_id`+`reason` required for sales notes (policy only for standalone commercial settlements); print reference + QR.
- **Regression tests required:** posted credit note has QR/ICV/XML with `BillingReference`; note without reason/reference rejected.
- **Dependencies:** PH1-01, Stream D (XML).

### PH1-07 — TLV length byte silently overflows for values > 255 bytes (seller names ≥ 128 Arabic characters), producing an unreadable QR
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Posting for tenants with long legal names (column allows 255 characters = up to 510 UTF-8 bytes).
- **Official requirement:** TLV length is a single byte; values must be ≤ 255 bytes (Security Features / QR spec) `[official-ref to confirm]`.
- **Actual behavior:** `ZatcaService::tlv` = `chr($tag) . chr(strlen($value)) . $value` (`:183`); PHP `chr()` wraps modulo 256 with no check. Probe 1: 130-char Arabic name (260 bytes) → length byte `4`, decoder reads tags `[1,217,133]`, VAT tag unreadable. The Phase-2 encoder does enforce 1..255 (`ZatcaPhaseTwoQrEncoder.php:95-103`), so only Phase-1 tenants are exposed.
- **Expected behavior:** Reject (or truncate per spec guidance) values > 255 bytes at posting with a clear error.
- **Evidence:** cited; Probe 1 `tlv_length_byte_overflows…`.
- **Impact:** Regulatory — invalid QR; silent (invoice posts normally).
- **Recommendation:** Validate byte length in `tlv()` (throw) and add a company-profile validation on the UTF-8 byte length of `name`.
- **Regression tests required:** name of 256 bytes → RuntimeException at post / 422 at profile save.
- **Dependencies:** PH1-04.

### PH1-08 — Posting a multi-line invoice whose subtotal exceeds ≈ 30.4 million SAR fails with a TypeError (integer overflow in revenue proration)
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Large B2B invoices (contracting, fuel, wholesale) with ≥ 2 lines.
- **Official requirement:** n/a – internal invariant (CLAUDE.md: money as int, no float).
- **Actual behavior:** `intdiv($lineNet * $netSales, $subtotal)` (`InvoiceService.php:954`) multiplies two halala amounts; when the product exceeds `PHP_INT_MAX` PHP returns a float and `intdiv` throws `TypeError`. Request validation allows `unit_price` up to 1e11 halalas (`StoreInvoiceRequest.php:66`). Probe 1: two lines of 30,000,000.00 SAR → `TypeError: intdiv(): Argument #1 must be of type int, float given`; transaction rolled back, draft remains `draft` (fail-closed, no wrong money).
- **Expected behavior:** Overflow-safe proration (e.g., `bcmul`/`gmp` or incremental allocation) or an explicit validated ceiling.
- **Evidence:** Probe 1 `posting_a_multi_line_invoice_above_roughly_30m_sar_overflows_integer_proration`.
- **Impact:** Operational — such invoices cannot be issued (HTTP 500 via `domain()` wrapper not shown; TypeError is not a RuntimeException); a workaround (splitting) exists.
- **Recommendation:** Use `bcmath`/`gmp` for the cross-multiplication or largest-remainder on `intdiv($lineNet, …)` ordering; add a guard test. Cross-stream: the same pattern exists in `allocateHeaderDiscountToLines` (`:1240`) and `splitAllocatedAmount` (`:1084`).
- **Regression tests required:** two-line 30M SAR invoice posts; sum of prorated revenue == netSales.
- **Dependencies:** Stream A/B (money engine).

### PH1-09 — Immutability of issued invoices is enforced only in `InvoiceService`/API: the model accepts direct updates and hard deletes, there is no soft delete, and the revision log ignores ZATCA fields
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Any non-service write path (artisan commands, jobs, future controllers, tinker, bulk ops).
- **Official requirement:** Issued e-invoices must be tamper-proof and retained unaltered `[official-ref to confirm]` (E-Invoicing Regulation Art. 5; VAT IR Art. 66).
- **Actual behavior:** `Invoice` has no `booted()` guard and no `SoftDeletes` (`app/Models/Invoice.php:18-23`). Probe 1: `Invoice::find()->update(['total'=>1,'zatca_document_type'=>'standard','zatca_qr'=>'TAMPERED','number'=>'X-1'])` succeeds; `->delete()` removes the posted invoice and its lines (cascade) while the journal entry survives orphaned. `RecordsRevisions` deliberately skips `zatca_xml`, `zatca_qr`, `zatca_previous_hash` (`app/Support/RecordsRevisions.php:28-30`), so a QR/XML change leaves no revision trace, and revisions themselves are pruned after 730 days (`DocumentRevision.php:56`). Compare `InvoiceLine::booted()` which does guard delivery-note-linked lines (`InvoiceLine.php:33-45`).
- **Expected behavior:** Model-level guard (`updating`/`deleting`) rejecting changes to money/ZATCA/number fields once `status='posted'`; soft delete at most; revision log covering hash changes.
- **Evidence:** Probe 1 `post_issue_mutation_guards_exist_in_service_only_not_in_model`.
- **Impact:** Security/regulatory — defence in depth missing; silent destruction possible from any future code path.
- **Recommendation:** Add a `PostedInvoiceIsImmutable` model observer; `SoftDeletes` + `restrictOnDelete` for `journal_entries`; include `zatca_hash`/`zatca_qr` in revisions.
- **Regression tests required:** model update/delete on posted invoice throws.
- **Dependencies:** none.

### PH1-10 — Drafts can be printed/exported as "فاتورة ضريبية" with an allocated legal number, the ZATCA compliance footer, and no draft marking in the default template
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Invoice drafts (sales module, Public-API drafts) printed or shared before posting.
- **Official requirement:** Only issued invoices are tax invoices; documents that are not tax invoices must not be presented as such `[official-ref to confirm]`.
- **Actual behavior:** Number is allocated at draft creation (`InvoiceService.php:98`; Probe 1 `draft number INV-2026-00001, qr null`). Print/PDF/Share actions are unconditional on the invoice page (`invoices/[id]/page.tsx:610-612`). The draft/cancelled notice exists only in the five v2 compositions (`doc-header.tsx:138,202,269,351,431`); the default template is the legacy `tax-invoice-classic` (`registry/templates.ts:123`) which prints the title "فاتورة ضريبية" (`doc-header.tsx:566`) and the footer "هذه فاتورة إلكترونية صادرة وفق متطلبات هيئة الزكاة…" (`doc-footer.tsx:24-25` → `ar.json:2186`). Deleting the draft later frees/reuses its number (PH1-12), so a printed draft and a later issued invoice can share a number.
- **Expected behavior:** Drafts print with a prominent "مسودة — ليست فاتورة ضريبية" watermark in every template, without the compliance footer, or printing is restricted to posted documents.
- **Evidence:** cited; Probe 1/2 outputs.
- **Impact:** Regulatory/operational — pseudo-invoices in circulation; number collisions with real invoices.
- **Recommendation:** Watermark in `DocumentBody` for `status!=='posted'` regardless of composition; suppress footer claim and QR note for drafts; consider allocating the number at posting (PH1-12).
- **Regression tests required:** web render test: draft → watermark present in classic/erp/modern/minimal/retail; footer absent.
- **Dependencies:** PH1-12, PH1-13.

### PH1-11 — POS thermal receipt is titled "فاتورة ضريبية" (standard) for simplified invoices and shows date only (no issue time)
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** POS checkout receipt and reprint.
- **Official requirement:** Simplified tax invoice must be titled as such and show date and time of issue `[official-ref to confirm]` (Annex 2 Phase-1 fields).
- **Actual behavior:** `pos/page.tsx:1464-1470` and `:1722-1728` call `buildInvoiceDocumentModel` without `type`, so the model defaults to `'tax_invoice'` (`from-invoice.ts:142`) and `thermal-receipt.tsx:53` prints `dt('tax_invoice')` = "فاتورة ضريبية" although the invoice is `simplified` (Probe 3). The receipt prints `meta.date = invoice_date` only (`thermal-receipt.tsx:59`); the checkout response exposes no issue time (Probe 3: no `created_at`/`issued_at` keys).
- **Expected behavior:** Title derived from `zatca_document_type`; date **and** time of issue on the receipt.
- **Evidence:** cited lines; Probe 3.
- **Impact:** Regulatory — wrong document title on every B2C receipt; missing time.
- **Recommendation:** Pass `type: invoiceCatalogDocumentType(created.zatca_document_type)`; add `issued_at` to `InvoiceResource` and render `HH:mm` on thermal.
- **Regression tests required:** receipt builder test for simplified → "فاتورة ضريبية مبسطة"; time rendered.
- **Dependencies:** PH1-01.

### PH1-12 — Invoice numbers are allocated at draft, reused/gapped by draft deletion, restarted by mid-year prefix/suffix edits and per branch, and callers may inject arbitrary numbers at service level
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Numbering settings, draft lifecycle, multi-branch sales.
- **Official requirement:** Sequential invoice numbering without gaps per series; e-invoice counter per solution unit `[official-ref to confirm]` (E-Invoicing Implementation Resolution; Art. 53(5)(b) "sequential number").
- **Actual behavior (PG probe):** middle draft deleted after neighbours posted → permanent gap (`00001,00003,00004`); last draft deleted → number reused; `sales.invoice_prefix` edit mid-year → new series `FAT-2026-00001` while `INV-…` continues later (`00003`); suffix `-JED` accepted (`UpdateNumberingSettingsRequest.php:23-24`); `InvoiceService::create(['number'=>'MANUAL-7'])` accepted (`InvoiceService.php:98`; stripped only at HTTP layer). Each branch keeps an independent series (`GeneratesDocumentNumbers.php:67-89`; `DocumentNumberingTest` passed) while ICV is tenant-wide. Status `cancelled` exists in the enum (`migration 000004:26`) and filters but no code path sets it (grep).
- **Expected behavior:** Legal number assigned at issuance (post), gap-free per legal series; prefix/suffix edits versioned (new series only at year start) or blocked once invoices exist; no caller-supplied numbers for sales invoices.
- **Evidence:** Probe 2 outputs; `DocumentNumberingTest::deleting_the_last_document_frees_its_number` (documents the reuse as intended).
- **Impact:** Regulatory — gaps/reuse must be explainable at audit; drafts printed with numbers (PH1-10) later issued to other invoices.
- **Recommendation:** Allocate `number` in `post()` (keep a separate draft reference); lock prefix/suffix for a series once used in the current year (or make changes effective next year); drop `$data['number']` for invoices.
- **Regression tests required:** draft has no number; two drafts posted in reverse order get ascending numbers; prefix change after first invoice rejected.
- **Dependencies:** PH1-10.

### PH1-13 — Compliance over-claims in product copy: landing page "متوافقة مع المرحلتين" and a ZATCA footer printed on every document
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Marketing landing page; every printed invoice/credit note footer (v1 `t('footer')`, v2 `ModernFieldLabel footer`).
- **Official requirement:** n/a – truthful representation; Phase-2 compliance requires CSID onboarding, validated XML and clearance/reporting, none of which is complete (CLAUDE.md "المؤجَّل بصراحة").
- **Actual behavior:** `ar.json:2425` "فواتير ضريبية متوافقة مع المرحلتين، ورمز QR، وسلسلة هاش PIH." / `en.json:2425` "Tax invoices aligned with both phases…" (`web/src/app/page.tsx:34`). Footer `ar.json:2186` / `visual-v2.ts:94-97` "هذه فاتورة إلكترونية صادرة وفق متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA)." is printed by default on drafts, on invoices without QR (PH1-03), with empty VAT (PH1-04), and on credit notes without QR (PH1-06). The XML itself is annotated "تمثيل بنيوي — غير مُتحقَّق مقابل XSD" (`ZatcaService.php:232`).
- **Expected behavior:** Claims limited to what is verified (Phase-1 QR generation); footer only on issued documents that carry a QR.
- **Evidence:** cited.
- **Impact:** Legal/reputational; auditors and customers misled.
- **Recommendation:** Reword landing copy; make the footer conditional on `status==='posted' && qr`.
- **Regression tests required:** render test: draft/no-QR document has no compliance footer.
- **Dependencies:** PH1-03, PH1-10.

### PH1-14 — QR timestamp offset follows the server timezone (`+00:00`/`+03:00` form) and ignores `tenants.timezone`; inconsistent with the Phase-2 encoder (`Z`)
- **Severity:** P3
- **Status:** VERIFIED DEFECT
- **Business process:** QR generation.
- **Official requirement:** QR tag 3 timestamp format per Security Features spec (examples use `YYYY-MM-DDThh:mm:ssZ`) `[official-ref to confirm]`.
- **Actual behavior:** `toIso8601String()` (`ZatcaService.php:163`) yields `2026-10-01T09:00:00+00:00` under the harness default `APP_TIMEZONE=UTC` (`<harness>/config/app.php:68`) and `…T12:00:00+03:00` under `Asia/Riyadh` (Probe 1). `tenants.timezone` (default `Asia/Riyadh`, migration `000001:20`, exposed via `CompanyProfile`) is never consulted. The Phase-2 encoder normalises to UTC `Z` (`ZatcaPhaseTwoQrEncoder.php:56-58`). `render.yaml`/`Dockerfile` set no `APP_TIMEZONE` (production value NOT VERIFIED).
- **Expected behavior:** One canonical UTC `Z` format for both phases, derived from the issue instant (PH1-01).
- **Evidence:** Probe 1 `qr_timestamp_offset_follows_app_timezone`.
- **Impact:** Interop with QR validators that expect the documented format; cross-phase inconsistency.
- **Recommendation:** Reuse the Phase-2 formatting for Phase-1.
- **Regression tests required:** tag3 matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.
- **Dependencies:** PH1-01.

### PH1-15 — Document language `en` produces an English-only tax invoice (Arabic dropped)
- **Severity:** P2
- **Status:** VERIFIED DEFECT (code-level; not rendered in this sandbox)
- **Business process:** Invoice drafting with `language: 'en'` (per-invoice or tenant default `documents.default_language`).
- **Official requirement:** Tax invoices must be issued in Arabic (other languages may be added) — VAT IR Art. 53(1) `[official-ref to confirm]`.
- **Actual behavior:** `PrintTemplateContract::DOCUMENT_LANGUAGES = ['ar','en','bilingual']` (`:47`), frozen at posting (`InvoiceService.php:379-386,1041`). In v2 compositions `mode === 'en'` renders English labels only (`modern-bilingual-label.tsx:35-36`; `use-document-label-mode.ts:16-17`); legacy compositions follow the UI locale (`doc-header.tsx:24`), so an English-UI user prints English-only labels regardless of language setting. Titles do include the alternate-language subtitle (`dtAlt`) but field labels do not.
- **Expected behavior:** `en` must still render Arabic (i.e., behave as bilingual) for tax invoices/notes.
- **Evidence:** cited.
- **Impact:** Regulatory — invalid invoice language.
- **Recommendation:** Treat `en` as `bilingual` for `tax_invoice`/`simplified_tax_invoice`/notes; keep `en` only for commercial documents.
- **Regression tests required:** web render test asserting Arabic labels present when `language='en'` for tax documents.
- **Dependencies:** none.

### PH1-16 — Retention/preservation: 365-day governed purge of Document-Center files, local disk storage, no archive/bulk export of XML/QR, single-invoice retrieval only
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED / NOT VERIFIED (production)
- **Business process:** Retention of tax records (issued e-invoices + received supplier invoices uploaded to the Document Center), ZATCA inspection requests.
- **Official requirement:** Retain tax invoices, notes and related records for ≥ 6 years, electronically retrievable `[official-ref to confirm]` (VAT IR Art. 66; E-Invoicing Regulation Art. 5/6 storage & archival).
- **Actual behavior:** `DOCUMENT_RETENTION_DAYS=365` in `render.yaml:41-42` → `config/document_center.php:41`; `DocumentRetentionPolicyService::effective()` enables the policy by default (`:19`). `documents:retention-run --apply` (artisan) or the platform endpoint `POST platform/document-retention-runs` (`routes/api.php:344`) deletes `DocumentFile` objects older than the cutoff (`DocumentRetentionRunner.php:59-75,193`). The planner is deliberately narrow (`DocumentRetentionPlanner.php:26-50`): a file is eligible only when its batch is `archived`/`cancelled`/`duplicate`, has **no** `DocumentTransactionLink`, no active hold, no running processing. So received supplier invoices that were linked to a purchase/expense are protected, but uploaded tax documents that were **archived without linking** (receipts, invoices kept "for the record") become purgeable after 365 days. No scheduler entry exists in `routes/console.php` (manual/governed runs only). The purge never targets `invoices.zatca_xml/qr` (no job touches those; Probe 1 schema + grep). Storage is `local` (`render.yaml:37-40`, `config/document_center.php:9-10`; durable S3/R2 "مؤجل") on a Render free web service — durability NOT VERIFIED. XML/QR retrieval exists only per invoice (`GET /invoices/{id}/zatca`) with no bulk export, archive format, or integrity report; `DocumentRevision` audit rows are pruned after 730 days. Tenant hard deletion would cascade to invoices (`migration 000004` FK `cascadeOnDelete`); `Tenant` uses `SoftDeletes` and no platform endpoint force-deletes (`PlatformTenantUpdateRequest` only plan/trial/is_active) — residual risk only.
- **Expected behavior:** ≥ 6-year retention for tax-relevant document classes (policy by document type), durable object storage, periodic export/archive of XML+QR+PDF with hashes.
- **Evidence:** cited.
- **Impact:** Regulatory — records may be purged after one year; data-loss risk on ephemeral disk.
- **Recommendation:** Document-type-aware retention (never < 6y for invoices/receipts), block purge of files classified as tax invoices, enable durable storage before production, add `zatca:export` command.
- **Regression tests required:** retention planner refuses tax-invoice document types < 6 years.
- **Dependencies:** Stream D (XML archival), ops.

### PH1-17 — Phase-1-only XML is a structural stub (no XSD validation; missing tax breakdown, seller address/CRN, buyer VAT/address, delivery date, payment means, currency as SAR hard-coded) while being hashed into the PIH chain
- **Severity:** P2 (for this stream; Stream D owns Phase-2 content)
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Every posting (with or without credential) stores `zatca_xml` and its hash; the PIH chain is derived from it (`ZatcaService.php:140-151`).
- **Official requirement:** UBL 2.1 KSA e-invoice XML content (Annex 2 fields; XSD/EN16931-KSA rules) `[official-ref to confirm]`.
- **Actual behavior:** Probe 1 inventory: no `TaxSubtotal`, no line `TaxTotal`/`ClassifiedTaxCategory`, no `PostalAddress`, no `PartyIdentification` (CRN), buyer only `RegistrationName`, no `AllowanceCharge` (discounts/shipping are not represented), no `ActualDeliveryDate`, no `PaymentMeans`, `DocumentCurrencyCode` hard-coded `SAR` (`:273`) while `tenants.currency` is editable (`CompanyProfile`), `ProfileID reporting:1.0` for standard too. The comment at `:232` acknowledges "غير مُتحقَّق مقابل XSD".
- **Expected behavior:** Valid KSA UBL built from the issue-time snapshot; validated against XSD/schematron before the hash is committed, since the chain cannot be repaired.
- **Evidence:** Probe 1 `zero_tax_and_large_totals_format_and_xml_content_inventory`.
- **Impact:** Regulatory — every historical XML is non-compliant yet hashed into the PIH chain; Phase-2 go-live inherits an invalid chain.
- **Recommendation:** See Stream D; at minimum stop hashing a stub for Phase-1-only tenants, or version the XML and restart the chain at Phase-2 onboarding.
- **Regression tests required:** XSD validation test fixture.
- **Dependencies:** Stream D.

### PH1-18 — Currency: QR/XML assume SAR regardless of tenant currency
- **Severity:** P3
- **Status:** VERIFIED DEFECT
- **Business process:** Tenants whose `currency` ≠ SAR (`Tenant` fillable `currency`, UI formats by `company.currency` `from-invoice.ts:133`).
- **Official requirement:** Amounts in QR/XML are SAR (`currencyID="SAR"`), with conversion rules for foreign-currency invoices `[official-ref to confirm]`.
- **Actual behavior:** No FX handling; the print shows the tenant currency while QR tags 4/5 and XML state SAR amounts numerically equal to the foreign amounts.
- **Expected behavior:** Either restrict KSA e-invoicing tenants to SAR or implement conversion (`TaxCurrencyCode`/exchange rate) and print SAR VAT totals.
- **Evidence:** `ZatcaService.php:245,247,273,306-311`; `from-invoice.ts:133`.
- **Impact:** Regulatory for non-SAR tenants only.
- **Recommendation:** Validation in `UpdateCompanyRequest` tied to KSA tax profile.
- **Regression tests required:** non-SAR tenant posting → rejected or converted.
- **Dependencies:** Stream A.

### PH1-19 — Phase-1-only tenants: what is actually produced (documentation finding)
- **Severity:** P3
- **Status:** VERIFIED IMPLEMENTED (behaviour) / documentation gap
- **Business process:** Tenants without any `ZatcaCredential` row.
- **Official requirement:** n/a.
- **Actual behavior:** `buildFor` generates: UUID, tenant-wide ICV, PIH from the previous stored XML (genesis `base64(sha256("0"))`), the stub UBL XML (PH1-17), its C14N-1.1 SHA-256 hash, and the 5-tag Phase-1 QR embedded into the XML (`ZatcaService.php:38-108`). Once **any** credential row exists for the tenant the signed Phase-2 path is mandatory and fails closed (`:89-105`). Nothing is transmitted (`config/zatca.php:58` dispatch disabled by default). The settings UI labels this honestly (readiness blockers), but no document tells the tenant that their stored "e-invoice" is Phase-1-only and unvalidated.
- **Expected behavior:** Tenant-facing status (Phase-1 only / Phase-2 onboarded) on the invoice and settings pages.
- **Evidence:** cited.
- **Impact:** Operational clarity.
- **Recommendation:** Expose `zatca_mode` in `InvoiceResource.zatca`.
- **Regression tests required:** none.
- **Dependencies:** PH1-13.

---

## 4. NOT VERIFIED / open questions

1. **Production timezone, storage durability, retention execution** — `render.yaml` sets no `APP_TIMEZONE` (Laravel default UTC assumed), `DOCUMENT_STORAGE_DRIVER=local` on a Render free plan; `routes/console.php` contains no schedule for `documents:retention-run`, so purges happen only when an operator runs the command or the platform endpoint (`routes/api.php:344`) — whether that happens in production is unknown. Obtain production env + operator runbook.
2. **PostgreSQL length enforcement** on `tenants.vat_number` (`string(15)`) with `max:20` validation — expected DB error 500 for 16-20 chars; not probed on PG (would need an API probe on PG).
3. **Official text** for: QR timestamp format and tag semantics (R2), Annex-2 mandatory fields for simplified invoices (time of issue), Arabic-language requirement, sequential-numbering rule, 6-year retention, QR requirement on standard invoices and on notes (R1). All findings above tagged accordingly.
4. **Rendering not executed**: web assertions (draft watermark coverage, English-only labels, POS receipt title) are from source reading, not from a browser render; a Vitest/Playwright run would make them VERIFIED at runtime.
5. **Whether any platform/ops path hard-deletes tenants** (cascade to invoices) — none found in `app/Http/Controllers/Api/Platform*`; artisan/tinker paths not enumerable.
6. **Thermal printing path**: `local-hardware-bridge` only sends ESC/POS drawer pulses; receipt printing is browser `window.print` of the thermal template — printer-side truncation of long QR/Arabic not testable here.

## 5. Cross-stream notes

- **Stream A/B (VAT engine/money):** PH1-08 integer overflow at `InvoiceService.php:954` (also `:1084`, `:1240` pattern); `applyDiscount` net method and `calcTax` rounding per line vs document are outside this stream. Zero-rate lines are emitted with `tax_rate=0` but no exemption/zero-rate reason code exists anywhere (needed for XML `TaxCategory`/`TaxExemptionReasonCode`).
- **Stream D (Phase 2 / XML / signing):** PH1-01 (issue time feeds XML and the signed properties), PH1-05/PH1-06/PH1-17 (XML content, notes not in chain), PH1-14 (timestamp format parity with `ZatcaPhaseTwoQrEncoder`), PH1-04 (encoder rejects what Phase-1 accepts → first signed invoice of a tenant with a bad VAT fails closed at posting — which blocks all invoicing once a credential row exists).
- **Stream E (security/RBAC/multi-tenant):** `zatca.view` is granted to every built-in role incl. `staff` (`Rbac.php:36,43,79`) — XML/hash exposure to all staff; `GET /invoices/{id}/zatca` is branch-scoped (`visibleInvoice`) but `InvoiceController::update/destroy/post` use `Invoice::findOrFail` without branch scoping (`:275,325,333`).
- **Stream F/ops:** PH1-16 storage/retention; `DOCUMENT_RETENTION_DAYS` applies to received-invoice scans.
