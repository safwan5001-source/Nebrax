# AWJ-TAX-ZATCA-AUDIT-1 — what the existing `web/` tests say about the report's web-dependent findings

Audited commit `0534ef16543b01c69b416b58897337e012a9d1ab` (a detached worktree of the audited commit, web app in `web/`).
Paths are relative to `web/` unless they start with `e2e/`, `storefront/` or `.github/`.

**Method.** Read-only mapping by a reviewer who opened every test cited here and the source it exercises (import graph + grep) and executed nothing. Run status comes from the whole-suite Vitest result (445 files, 4 117 tests, 0 failed): every Vitest test cited by title below was looked up there and is `passed`. Playwright specs were read at source level; which of them were then executed, and with what result, is in `web-test-results.md` §3 and in the addendum at the end of this file.

**Legend.**
`a` PINS_DEFECT (test would fail if the finding were fixed as recommended) ·
`b` CONTRADICTS (a sentence of the finding is wrong or overstated) ·
`c` COVERS_OK, split into `c·PC` (positive control / compliant behaviour asserted) and `c·CORR` (test corroborates the finding's factual claim without pinning the fix) ·
`d` NO_COVERAGE.
`b-source` = contradiction found by reading source while mapping tests (no test asserts it).

---

## 1. Summary table

### 1.1 Findings you listed

| Finding | Web claim in the report | Rel. | Tests cited (file:line, title) | Action on the finding text |
|---|---|---|---|---|
| PH1-01 | Print/PDF show `invoice_date` (`from-invoice.ts:167`); POS thermal prints date only (`thermal-receipt.tsx:59`). QR/XML time is backend-only. | c·CORR (date) + d (issue time, QR/XML) | `src/lib/pos-receipt.test.ts:29` "يستعمل رقم الفاتورة والتاريخ والإجماليات من الفاتورة المرحّلة…" (receipt date is the server `invoice_date` `'2026-01-15'`; `PosCheckoutInvoice` has no time field); `src/modules/documents/components/document-modern.test.tsx:342-344` (date row equals `model.meta.date`). `from-invoice.test.ts` never asserts `meta.date`. | none |
| PH1-02 | Page builds the document from live `/me` and `/partners/{id}` (`invoices/[id]/page.tsx:280,282,295-296`; `from-invoice.ts:146-164`); buyer address never mapped; only the template revision is frozen. | d (live data, reprint after edit) + c·CORR | `document-output-template.test.ts:103` "يثبّت المراجعات الثلاث للفاتورة المرحّلة ويتجاهل التعيين الحي" and `:133` "لا يعيد تفسير فاتورة مرحّلة بتعيين حي لاحق" (template design is frozen; nothing about data); `from-invoice.test.ts:43` (seller built from whatever `company` object is passed — there is no snapshot input); `pos-receipt.test.ts:76` (POS buyer = posted invoice's `partner`: name, VAT, city). No test touches `invoices/[id]/page.tsx` or buyer address (`buyer.address` is rendered only by the quotation/PO compositions, `doc-parties.tsx:330,353`). | none |
| PH1-03 | QR read only from `GET /invoices/{id}/zatca` (`page.tsx:281,295`; `qr={zatca?.qr ?? null}` at `:626,673,685`); `DocQr` draws nothing without QR (`doc-qr.tsx:43-45`); POS gets the QR from the checkout response (`pos/page.tsx:1433,1726`); Impact: "the sidebar also hides the e-invoice settings so the tenant has no cue". | d (page data flow, disabled-app 403) + c·PC (renderer) + b-source ("no cue") | `document-classic-v2.test.tsx:184-194` "لا يغيّر تركيب Classic التاريخي… QR 110" (the legacy classic composition — the default template — renders the QR, width 110, when `model.qr` is set); `document-modern.test.tsx:168-175` (QR in summary, width 76); `from-invoice.test.ts:82-104` (`model.qr` equals `{ value: 'zatca-qr' }`). e2e cannot reproduce the 403: the Demo mock always answers `/invoices/*/zatca` (`src/lib/mock-data.ts:4485`). | reword the "no cue" sentence (§4 C-3); "renders an empty box" is an empty `<div />` (cosmetic) |
| PH1-09 | none (model/DB immutability). | d (model level) + c·CORR (UI guard) | `invoice-form.test.tsx:654` "redirects a posted invoice back to its detail page instead of editing it" (client-side defence in depth only). | none |
| PH1-10 | Print/PDF/Share unconditional (`page.tsx:610-612`); draft/cancelled notice only in five v2 compositions (`doc-header.tsx:138,202,269,351,431`); default template `tax-invoice-classic` prints "فاتورة ضريبية" and the ZATCA footer (`templates.ts:123`, `doc-header.tsx:566`, `doc-footer.tsx:24-25`). | a (incidental) + c·CORR + d | **a** `document-modern.test.tsx:289` "يعزل تسميات Modern الثنائية…" renders `status: 'draft'` (`:296`) with `footerText: null` (`:294`) and requires the ZATCA QR caption and the compliance footer (`'zatca_note'`, `'footer'` in `visibleFields` `:315`, loop `:317`): it fails once drafts stop printing them, as the Recommendation asks. **c·CORR** `document-modern.test.tsx:127` "يعرض شارة المسودة والملغى فقط" (draft/cancelled badge exists, posted has none) and `:319-324`; `visual-v2.test.ts:109-122`; `templates.test.ts:17` "يبقي الافتراضي classic…" (default = `tax-invoice-classic`). **d** no test renders a draft in classic / erp / minimal / retail / legacy-modern, nor in classic-v2 / erp-v2 / minimal-v2 / retail-v2 (their badge code `doc-header.tsx:138,202,351,431` is untested). e2e (source level): `e2e/invoice-detail-interactions.spec.ts:90` expects 8 menu items on a draft (Edit, Duplicate, note, Print, PDF, Share, Excel, Delete) — needs an update only for the "restrict printing to posted" alternative. | none (minor: 7 compositions carry the notice, 5 of them invoice templates) |
| PH1-11 | POS calls `buildInvoiceDocumentModel` without `type` (`pos/page.tsx:1464-1470,1722-1728`) → default `'tax_invoice'` (`from-invoice.ts:142`) → thermal prints `dt(model.type)` (`thermal-receipt.tsx:53`), date only (`:59`). | d (title, time, thermal render) + c·PC (mapping the fix needs) + c·CORR (default) | `modules/print-templates/services/document-output-template.test.ts:36` "يربط الفاتورة المبسطة بنوع الكتالوج المستقل" / `:40` (`invoiceCatalogDocumentType('simplified')` → `'simplified_tax_invoice'`, `null` → `'tax_invoice'`); `from-invoice.test.ts:43` (`expect(model.type).toBe('tax_invoice')` at `:79`, no `type` passed). Nothing renders `ThermalReceipt`: `components/pos/receipt-dialog.test.tsx:7-28` mocks `DocumentView`; `app/(pos)/pos/page.test.tsx:37` is a mount smoke test (its header says interaction coverage is deferred); no POS e2e mentions receipt/QR/title. | none |
| PH1-13 | Landing copy (`app/page.tsx:34`, `ar.json:2425`); ZATCA footer printed by default on drafts / QR-less documents / notes (`ar.json:2186`, `visual-v2.ts:94-97`). | a (incidental) + d | `document-modern.test.tsx:289-317` as in PH1-10: a draft with `footerText: null` must show the `'footer'` label (`MODERN_FIELD_LABELS.footer` = the ZATCA sentence) — fails if the footer becomes conditional on `status === 'posted' && qr`. The landing page has no test. No other test asserts the default footer text (all other footer tests use a custom `footer_text`). | none |
| PH1-15 | v2 `mode === 'en'` renders English labels only (`modern-bilingual-label.tsx:35-36`; `use-document-label-mode.ts:16-17`); legacy follows the UI locale; "titles do include the alternate-language subtitle (`dtAlt`)". Status says "not rendered in this sandbox". | a (6 tests) + c·CORR (render-level evidence) + b-source (titles) + d | `presentation/use-document-label-mode.test.tsx:38` "يعطي الأولوية لـmodel.language=en بغضّ النظر عن UI AR" (model `type: 'tax_invoice'`, `language: 'en'` → `mode === 'en'`); English-only render of a `tax_invoice` QA model (locale en, LTR): `document-modern.test.tsx:436` (`:459` no `data-modern-bilingual`, `:462` head must not contain `'المنتج'`, `:465` totals must not contain `'الإجمالي شامل الضريبة'`), `document-classic-v2.test.tsx:164` (`:179`), `document-erp-v2.test.tsx:163` (`:178`), `document-minimal-v2.test.tsx:174` (`:189`), `document-retail-v2.test.tsx:178` (`:193`); `presentation/modern-bilingual-label.test.tsx:22` (`mode="en"` → `'Date'` only); `presentation/visual-v2.test.ts:34` (en UI + LTR → `'en'`). All six break if "treat `en` as bilingual for tax documents" is implemented in `useDocumentLabelMode`/`resolveDocumentLabelMode`; they stay green if it is done only in the backend `resolveEffectiveLanguage`. **d** the invoice builder's `language_effective` → LTR flip (`from-invoice.ts:136-139`) is untested (only purchases: `builder/from-purchase.test.ts:73`). | status upgrade: jsdom render tests already exercise and pin the behaviour (drop "not rendered in this sandbox"); reword the "titles" sentence (§4 C-2); severity unchanged (P2) |
| PH1-16 | none in the text. | d | `app/(app)/documents/settings/page.test.tsx:224` "keeps both timed-retention badges aligned with governance.policy.enabled" only checks that mocked retention fields are displayed; e2e `document-operations.spec.ts:27-40` clicks "Run retention" against the Demo mock. No test of a minimum retention period. | none |
| PH1-17 | none in the text. | d | The web has no XML/TLV code (grep `tlv`, `decodeQr`: nothing); it only renders the stored QR string. | none |
| PH2-07 | "(the UI default)" for `active_environment = developer`. | d | The page's initial state `'developer'` (`einvoice/page.tsx:64`) is replaced by the server value (`:82`); no test. | none (the default is the server's) |
| PH2-12 | none in the text. | d | No web TLV encoder/decoder; nothing to test client-side. | none |
| SEC-03 | none in the text (credential/env recovery). | d + new source-level observation | `app/(app)/sales-settings/einvoice/page.test.tsx` has three tests (lines 76, 88, 115; see NV-18 and OPS-03 rows) and no failure-path test. The page offers no credential delete/disable (only two PUTs, `einvoice/page.tsx:140,158`), consistent with the finding. **New:** in scenario (f) (`GET /zatca-credentials` → 500 after key rotation) the page loads settings and credentials with one `Promise.all` (`:104-108`), so a rejection leaves `settings === null` and only the error alert renders (`:194-195`): the credential form — the owner's only exit — is not reachable from the UI. Untested. | add the UI dead-end to the Impact (severity stays P1) |
| NV-18 (§12) | "Web secret handling… Static read only (secrets held in React state, password inputs)". | c·CORR (partially closes) + b-source ("password inputs") | `einvoice/page.test.tsx:88` "never fills secret inputs from credential metadata and only submits changed secret values": credential fixture has `has_binary_security_token/has_secret/has_private_key = true`, yet the three secret inputs start with `.value === ''` (`:96-98`) and the PUT body holds only `stage`, `current_password` and the one typed `secret` (`:104-110`). Not covered: input types (only `secret` `:220` and `current_password` `:225` are `type="password"`; the CSID token and private key are plain `<Textarea>`, `:219,221,258-260`, no masking), clearing after save/env switch (`:122-126`), browser behaviour (autofill, DevTools). `lib/__tests__/mock-data.test.ts:54` checks the Demo mock only. | status → partially verified (jsdom); reword "password inputs" (§4 C-4) |
| SEC-08 | none in the text. | d | The `zatcaAvailable === false` branch (`einvoice/page.tsx:187-193`) is untested: all three page tests stub `/applications/nav-state` → `true` (`page.test.tsx:59`). | none |
| VAT-09 | Web POS derives `tax_inclusive` from `sales-config/taxes` (`tax.ts:10-18`, `pos/page.tsx:361-406`); server never enforces. | c·CORR (flag is client state) + d (server authority, `tax.ts`) | `components/pos/use-pos-active-carts.test.ts:20` "يحفظ السلات المستقلة…" (per-cart `taxInclusive` persisted and restored, `:27-28`, `:53`); `lib/__tests__/pos-cart-snapshot.test.ts` (same flag in snapshots). Every consumer of `getSystemTaxInclusive` mocks it (`purchase-form.test.tsx:90`, `product-workspace.test.tsx:24`, `products/page.test.tsx:77`); POS page test is a mount smoke. Extra web senders of the flag, untested: delivery-note wizard checkbox (`delivery-note-invoice-draft-wizard.tsx:109,233,341`), POS exchange dialog (`pos-exchange-dialog.tsx:151`). | none |
| VAT-14 | none in the text. | d | The web expense form is exclusive-only (`app/(app)/expenses/new/page.tsx:46` default tax `'15'`, `:112-114` VAT added on top, `:187`) — corroborates the finding; tests exist only for the list and detail pages (`expenses/page.test.tsx`, `expenses/[id]/page.test.tsx`), none for create. | none |
| VAT-16 | `storefront/src/lib/commerce/capabilities.ts:131-141`, `storefront/src/lib/data/markets.ts:43` (not under `web/`). | d for `web/`; c·CORR in the separate storefront suite (not run in this audit) | `storefront/src/components/cart/__tests__/CartSummary.test.tsx:28` "shows neither a tax row nor a discount row — the API carries no such figure" supports "keep deferred". `markets.ts:43` (`tax_inclusive: true`) is untested (`storefront/src/i18n/__tests__/markets.test.ts:17` uses `false` in a fixture). | none |
| CON-06 | `REQUIRED_ITEM_COLUMNS` only `description`, `total` (`document-types.ts:145`); hard-coded "(15%)" (`ar.json:1524,2184,6291`, `visual-v2.ts:131`); thermal totals = subtotal + VAT only (`thermal-receipt.tsx:111-112`); credit-note builder passes no seller address (`from-credit-note.ts:48-56`). | a + c·PC (A4 rows) + d | **a** `registry/document-types.test.ts:68` "validates advanced block properties against the rendered contract": a `tax_invoice` items block with columns `description, product_code, barcode, price_before_tax, total` (no quantity, no unit price, no tax) is asserted `{ valid: true, errors: [] }` (`:91`) — fails if quantity/unit price/rate become required; and `:130-138` "keeps the full financial column catalog…" pins `DOCUMENT_ITEMS_COLUMN_IDS` / `DEFAULT_DOCUMENT_ITEMS_COLUMNS` with `toEqual` (no VAT-rate or line-discount column) — fails when such a column is added. **c·PC** `document-modern.test.tsx:385-395` (A4 modern-v2 totals contain discount / shipping / adjustment rows); `document-quotation-proposal.test.tsx:197` and `document-purchase-order-formal.test.tsx:212` "يخفي صف الضريبة عند الصفر…" (a rate-aware VAT row already exists for those two non-invoice compositions). **d** thermal totals (no test renders `ThermalReceipt`), the "(15%)" literal (tests read `MODERN_TOTAL_LABELS.vat` through the catalog: `document-modern.test.tsx:385-395`, `visual-v2.test.ts:91`; they couple to the key, not to the literal; the only literal in any test is a negative check for delivery notes, `e2e/document-qa.spec.ts:142`), credit-note seller address (`from-credit-note.test.ts` uses `company: { name }` only). | none; tell REM-34 that `document-types.test.ts:68-99,130-138` must change with the contract |
| CON-12 | Invoice form free field (`invoice-form.tsx:785-792`) with hint (`en.json:2270`). | d | Vitest only carries the label dictionary (`invoice-form.test.tsx:42-45`) and a draft fixture with `adjustment: '0'` (`:608`). e2e (source level) `e2e/awj-v3-h2-workspaces.spec.ts:201-202` only asserts `#adj` is attached. | none |
| SUB-01 | Page prints / PDFs / shares / thermal-prints with the local QR (`page.tsx:281,511-525,626,673,685,902-909`); POS receipt QR from checkout (`pos/page.tsx:1430-1433,1726`); no clearance state. | d (no test gates on clearance) + a (e2e lifecycle) + c·CORR | No Vitest or Playwright file mentions clearance state (only fixture labels "Standard — Clearance" / "Simplified — Reporting", `invoice-form.test.tsx:16-17`). **a (source level)** `e2e/awj-v3-h2-workspaces.spec.ts:71-72` `expect(doc.getByRole('listitem')).toHaveText([/مسودة/, /مرحّلة/])` pins a two-state document lifecycle for the posted invoice and `:75` forbids an "issued"/"صادرة" step in the rail; adding `clearance_pending/cleared` states needs an update (not a revert). **c·CORR** `e2e/invoice-detail-interactions.spec.ts:39,84` (posted invoice menu = 7 items incl. Print/PDF/Share/Excel, no gating). No web code references `zatca/submissions` or `cleared_xml` (grep). | none |
| ACC-03 / ACC-04 | `general-advanced-reports-workspace.tsx:196-204,520-522` render input/output/net VAT and the hint `ar.json:5236`. | d | `components/reports/general-advanced-reports-workspace.test.tsx` (2 tests) covers `JournalTable` only; `lib/__tests__/mock-general-reports.test.ts:19` asserts the Demo mock returns `{input_vat, output_vat, net_vat, status:'payable'}` (mock contract only); `e2e/reports.spec.ts:12,59-73` loads `/reports/general/tax-report` in Demo Mode (heading visible, no error, no overflow) — no VAT content asserted. The hint renders at `:281` (extra cite). | none |
| OPS-02 | Notification action `view_zatca_submission` maps to the invoice page (`lib/notifications.ts:74-76`) which has no submission panel; no UI. | c·CORR (mapping) + d (panel absence) | `components/layout/notification-bell.test.tsx:216` "renders a source link for a registered ZATCA submission action (PR-NOTIF-4)" asserts the link is `/invoices/inv-1`. No test for the invoice page; grep confirms no web reference to `zatca/submissions` (so "no UI" holds). | none |
| OPS-03 | Readiness blockers surfaced by the settings page. | c·CORR | `einvoice/page.test.tsx:76` "shows backend readiness blockers and keeps automatic submission unavailable": two blocker texts rendered, `automatic` option disabled (`:85`). New blocker codes need entries in `knownBlockers` (`einvoice/page.tsx:274-281`); unknown codes render the generic "unknown" text, so the finding's "each new blocker code" test belongs here. | none |
| NV-12 (§12) | "Browser rendering… draft watermark, English-only tax documents, POS receipt title, thermal truncation of QR/Arabic — Source-level only". | partially closed | Draft badge: rendered in jsdom for modern-v2 only (`document-modern.test.tsx:127,289`). English-only: rendered and pinned for five v2 compositions (PH1-15 row). POS receipt title / time: open (no `ThermalReceipt` render anywhere). Thermal truncation: open (no thermal render/print test; `e2e/document-qa.spec.ts:7` templates are erp/modern/minimal only; item descriptions use CSS `truncate`, `thermal-receipt.tsx:100`). Real-browser items (@page, QR scan, printer) cannot be closed by jsdom. | rewrite "Evidence needed": jsdom render tests exist for v2 compositions; still missing — `ThermalReceipt` render (simplified title, totals with discount/shipping/adjustment), draft render in legacy compositions, POS receipt build with `type` |

### 1.2 Other findings and controls with web evidence (found while mapping)

| Finding | Web claim | Rel. | Tests / evidence | Action |
|---|---|---|---|---|
| PH1-05 | UI selector only suggests standard/simplified (`invoice-form.tsx:712-724`). | c·CORR | `invoice-form.test.tsx:302` "suggests Standard clearance for a customer with a VAT number"; `:550` "sends an explicit ZATCA document type snapshot with the draft" (the user picks `simplified` for that VAT-registered customer and the form posts it). | none (a confirmation step would need `:550` updated) |
| PH1-06 | Printed credit note: `qr: null`, reason as note, no original invoice (`from-credit-note.ts:62,76,78`). | c·CORR + d | `modules/documents/builder/from-credit-note.test.ts:16` "defaults to SAR and rtl for a sales credit note" (`expect(model.qr).toBeNull()` `:25`); the builder has no QR/original-invoice input, so adding them will not break it. Credit-note page/print/`credit-note-document.tsx` untested. | none |
| PH1-18 | Print shows tenant currency (`from-invoice.ts:133`). | c·CORR | `from-invoice.test.ts:82` (USD tenant → `model.currency === 'USD'`), `:106` (unknown → SAR); `from-credit-note.test.ts:28,40`. | none |
| VAT-01 / VAT-02 | Return dialog / credit-note form add VAT on the stored gross price (`create-return-dialog.tsx:213,255-257,271-272`; `credit-note-form.tsx:66`). | d | No test reaches either file (import graph: no direct or transitive importer among tests). | none |
| VAT-07 / VAT-08 / VAT-10 / VAT-12 | Web mirror floors header-discount VAT (`invoice-form.tsx:467`), taxes shipping at 15 % (`:469`), defaults line tax `'15'` (`:86`), own `extractTax` copy (`:449-458`). | d (07/08/10) + c·CORR (12) | `invoice-form.test.tsx:521` "applies a header discount to the total" (95-15=80 → 92.00, exact integers, no rounding case), `:448`, `:530`; shipping input is never exercised. `lib/__tests__/money.test.ts:64-81` ("extractInclusiveTax — يطابق الـ backend": 11500@15 → 1500, 10000@15 → 1304) checks the client extraction against the backend formula. | none |
| VAT-11 / VAT-15 | `tax-settings-card.tsx` stores a free {name, rate, inclusive} list, rounds rate to an integer 0..100 client-side (`:43-49`). | d | No test reaches `tax-settings-card.tsx` or `/tax-settings`. | none |
| SUB-04 / SUB-05 / CON-13(5) | Negative greps in `web/src`: no `cleared_xml`, no `zatca/submissions`, no first-login flag, no print/export logging. | c·CORR | Re-ran the greps: all hold (the `pdf/a` grep only matches unrelated identifiers such as `pdfAlignment` and `InvoicePdfAdjustment`). No test. | none |
| SUB-08 | "The UI only warns on switching (`einvoice/page.tsx:240-241`)". | d | Source confirms: a static hint (`:240`, no fallback between environments) plus a banner shown only when `production` is selected (`:241`); no confirmation dialog. No test. | optional wording: "warns only when production is selected" |
| SUB-12 | UI disables environments without credentials (`einvoice/page.tsx:240`), server accepts them. | d (+ mock-only) | The same line shows the copy "Another environment cannot be activated until its credentials are configured" (`en.json:6035`) — a rule the API does not enforce. No page test for the option state. `lib/__tests__/mock-data.test.ts:13` "يعيد الوضع اليدوي افتراضياً…" PUTs `active_environment: 'simulation'` with no simulation credential and expects acceptance — it tests the Demo mock, which mimics the server, not the server. | none |
| CON-09 and PC-C9 | "PDF is produced client-side from the page (`invoice-pdf.ts`)"; PC-C9: "the jsPDF generator prints `input.invoice.*` and rasterises the on-page QR SVG (`invoice-pdf.ts:62-63,479-487`)". | b | See §4 C-1. | reword the evidence; conclusion stands |
| PC-C1 / PC-C5 / PC-C8 | Stored QR never recomputed; title follows `zatca_document_type`; frozen revisions; core blocks cannot be hidden. | c·PC | `from-invoice.test.ts:82-104` (QR verbatim); `document-output-template.test.ts:36,40` (type mapping), `:103,133` (frozen revisions); `registry/document-types.test.ts:57` "requires core blocks to remain visible" (`required_block_hidden:items`); `modules/credit-notes/services/credit-note-template-design.test.ts:23` (frozen revision is the complete design boundary). | add "+ Vitest" to the evidence column |
| PC-C9 | Renderers never recompute money. | c·PC | `pos-receipt.test.ts:40` "يتجاهل إجماليات سلة متلاعَباً بها…"; `from-invoice.test.ts:125` "…دون إعادة حساب"; `document-quotation-proposal.test.tsx:197`; `document-purchase-order-formal.test.tsx:212`. | keep claim; fix the jsPDF cite (C-1) |
| PC-C12 / PC-E14 | Settings never transmit; blockers shown honestly; production save needs UI confirmation (`einvoice/page.tsx:198-202,228-231`). | c·PC | `einvoice/page.test.tsx:76` (blockers), `:115` "requires explicit confirmation before production credentials can be saved" (save disabled until the confirmation is ticked, `:122-125`), `:88` (no prefill, minimal PUT body). PC-C12's evidence column says "Code reading"; PC-E14 cites only the page lines and `ZatcaCredentialTest`. | add the Vitest file to both evidence columns |
| PC-C13 | A4 shows seller VAT / CRN / national address and buyer VAT; thermal shows seller block. | c·PC (A4, modern-v2) + d (thermal) | `from-invoice.test.ts:43` (national address string built); `document-modern.test.tsx:346-356` (VAT / address values and labels present). | none |
| Report-wide | §9.5 and the Arabic executive summary say "no automated UI test suite". | b | §4 C-5. | rewrite those sentences |

---

## 2. Relevant Vitest suites by topic (counts from `logs/vitest-full.json`)

Whole suite: 445 files / 4 117 tests / all passed. Topic-relevant subset below: 56 files / 534 tests. The Vitest suite runs in CI (`.github/workflows/web-ci.yml:38`, `npm run test`).

```
A. Sales-invoice form and design picker (80)
   40  components/invoices/invoice-form.test.tsx
   15  components/invoices/invoice-form-advanced.test.tsx
    8  components/invoices/invoice-template-selector.test.tsx
    7  modules/invoices/invoice-template-selector.test.ts
    4  components/delivery-notes/delivery-note-invoice-draft-wizard.test.tsx
    6  components/documents/document-language-selector.test.tsx
B. A4 tax-document render tests, jsdom, DocumentBody (112)
   21  modules/documents/components/document-modern.test.tsx        (modern_v2; draft badge, bilingual, totals rows)
   11  .../document-classic-v2.test.tsx   11 .../document-erp-v2.test.tsx   11 .../document-minimal-v2.test.tsx
   12  .../document-retail-v2.test.tsx     6 .../document-legacy-modern.test.tsx
   15  .../document-quotation-proposal.test.tsx   16 .../document-purchase-order-formal.test.tsx   (non-invoice)
    3  .../document-body.test.ts    4 .../sections/doc-items-table.test.ts    2 .../sections/doc-parties.test.ts
C. Labels, language, presentation (46)
   22  modules/documents/presentation/visual-v2.test.ts    11 .../visual-v2-print.test.ts
    4  .../modern-bilingual-label.test.tsx    5 .../use-document-label-mode.test.tsx    4 modules/documents/templates/template-styles.test.ts
D. Registry, contract, model builders (48)
   13  modules/documents/registry/document-types.test.ts    11 .../templates.test.ts
    6  modules/documents/builder/from-invoice.test.ts    4 .../from-credit-note.test.ts    6 .../from-purchase.test.ts
    2  .../from-purchase-order.test.ts    3 .../from-quote.test.ts    3 modules/documents/qa/document-qa-fixtures.test.ts
E. Export, PDF, print (55)
   10  modules/documents/services/export/template-export-contract.test.ts   (source-text contract on 6 document pages)
   22  lib/pdf.test.ts    5 lib/__tests__/pdf-page-breaks.test.ts    3 lib/pdf-capture.test.ts    6 lib/__tests__/pdf-capture-neutralization.test.ts
    6  modules/invoices/services/invoice-pdf.test.ts    3 modules/payments/services/payment-pdf.test.ts
F. Print-template platform, frozen revisions (77)
   58  modules/print-templates/services/document-output-template.test.ts   12 .../live-template-definition.test.ts
    3  .../frozen-output-template.test.ts    4 modules/credit-notes/services/credit-note-template-design.test.ts
G. POS receipt and checkout (47)
    7  lib/pos-receipt.test.ts    5 components/pos/receipt-dialog.test.tsx (mocks DocumentView)    2 lib/__tests__/pos-checkout.test.ts
    4  lib/__tests__/pos-checkout-attempt.test.ts    1 app/(pos)/pos/page.test.tsx (mount smoke)    15 components/pos/pos-payment.test.tsx
    5  components/pos/use-pos-active-carts.test.ts    8 lib/__tests__/pos-cart-snapshot.test.ts
H. E-invoice (ZATCA) UI (26)
    3  app/(app)/sales-settings/einvoice/page.test.tsx    16 components/layout/notification-bell.test.tsx (1 ZATCA)    7 lib/__tests__/mock-data.test.ts (3 ZATCA, mock only)
I. Tax arithmetic, purchases, reports (43)
   16  lib/__tests__/money.test.ts    23 components/purchases/purchase-form.test.tsx
    2  components/reports/general-advanced-reports-workspace.test.tsx (JournalTable only)    2 lib/__tests__/mock-general-reports.test.ts
```

Tax-relevant UI code with **no** test reaching it: `app/(app)/invoices/[id]/page.tsx`, `templates/thermal-receipt.tsx` (imported by the registry, never rendered), `components/documents/tax-document.tsx`, `components/credit-notes/credit-note-document.tsx` and `credit-note-form.tsx`, `app/(app)/credit-notes/[id]/page.tsx`, `app/(app)/returns/[id]/page.tsx`, `components/returns/create-return-dialog.tsx`, `components/settings/tax-settings-card.tsx` (`/tax-settings`), `app/(app)/expenses/new/page.tsx`, `app/page.tsx` (landing). `app/(pos)/pos/page.tsx` has a mount smoke test only.

---

## 3. Playwright specs overview (source level; 66 specs — the executed subset is in `web-test-results.md`)

**Backend dependence: none of the 66 specs needs the PHP backend.** `lib/api.ts:79` routes every call to the in-bundle `mockApi` (`lib/mock-data.ts`) when `localStorage.demo === 'true'` (`lib/demo.ts`: "works entirely with local mock data without any connection to the server"); the specs seed that flag (`e2e/helpers/demo-session.ts`). The others use dev fixture routes (`/document-qa`, `/dev/customizer-*`, `/dev/trust-visual`) or stub `**/api/**` with `page.route` (ten flowers specs + `helpers/flowers-admin.ts`). So they cannot reproduce backend-driven defects (PH1-03's 403, SUB-01, PH2-07…). In CI only one spec is wired (`store-brand-qa.spec.ts`, `.github/workflows/store-brand-qa.yml:52`); the rest are manual (`playwright.config.ts` starts `next dev -p 3001`).

| Spec (static `test(` blocks) | What it asserts | Data source | Tax relevance |
|---|---|---|---|
| `awj-v3-h2-workspaces.spec.ts` (13) | Gate-ON invoice workspace: posted `inv-118` lifecycle rail lists exactly [مسودة, مرحّلة] (`:71`), no "issued" (`:75`), dock shows stored total `5,750.00` (`:79`), entries tab read-only; draft `inv-115` has no entries tab and a post button; `#print-root` stays mounted; invoice-create ids incl. `#zatca-document-type`, `#adj` attached (`:201-202`); 3 lines → dock `1,380.00` (`:217`); purchase `pu-42` shows `6,900.00` | Demo ("Runs against Demo Mode (no backend)", header comment) | SUB-01 (a), CON-12 (presence only) |
| `invoice-detail-interactions.spec.ts` (1, mobile 390) | Invoice action menu item counts: posted = 7 (`:39,84`), draft = 8 (`:90`); menu inside viewport; collapsible sections; no overflow | Demo | PH1-10 (draft menu has Print/PDF/Share) |
| `purchase-detail-interactions.spec.ts` (3) | Purchase `pu-40` menu (Add payment / Create return / Print), payment form prefilled `3450.00`, partner balance → payment links | Demo | purchases |
| `reports.spec.ts` (3 blocks = 33 routes + 2) | Every report route (incl. `/reports/general/tax-report`, `/pos/report`) loads: heading, no "تعذر تحميل التقرير", no page error, no overflow; ledger and preview interactions | Demo | ACC-03/04: smoke only |
| `document-qa.spec.ts` (5) | `/document-qa` harness: 7 document types × erp/modern/minimal × 5 scenarios, no overflow; logo/bank/stamp/signature presence; delivery note has no total / VAT row (`:141-142`); Chromium A4 print and html2canvas PDF export > 10 KB; selector labels | static fixtures `makeDocumentQaModel`, no API, no session | CON-09 (PDF path = html2canvas); no draft/QR-content assertions; thermal templates not in the matrix |
| `p47-baseline.spec.ts` (15) | Print-template centre/studio: baseline metrics, 44 px targets, keyboard flow, contrast; clicks the "فاتورة ضريبية" type button | Demo | none for tax content |
| `pos-checkout-reliability.spec.ts` (1) | Double-submit lock, delayed checkout (`window.__POS_CHECKOUT_DELAY_MS`), fail-once recovery, retryable error, captures; asserts the "Sale completed" text, not receipt content | Demo + `window.__POS_*` hooks | POS checkout; no receipt/QR/title assertion |
| `pos-session-cart-recovery.spec.ts` (1), `pos-dedicated-workspace.spec.ts` (3) | Reload restores cart, no auto-charge, offline blocks; `/pos/start` → new-tab `/pos`, failed open leaves no orphan tab | Demo | POS UX |
| `pos-interaction-mode`, `pos-responsive-mobile`, `pos-hybrid-adaptive-visual`, `pos-loss-prevention-phase4-visual`, `pos-ui-v3-visual-verify` (1 each) | Input-mode settings, mobile cart, hybrid input, loss-prevention settings, UI-v3 barcode / return quantity; screenshots into `../docs/visual-qa/…` | Demo | none for receipt content |
| `delivery-notes.fixture.spec.ts` (10) | Delivery notes list/create/confirm; wizard builds one invoice draft and never posts; permission variants | "local fixture only" Demo | VAT-09 context (draft only) |
| `document-operations.spec.ts` (3), `document-review.spec.ts` (3) | Document Center (supplier-document intake): operations / usage / governance pages, platform "Run retention" against the mock, review flow → expense draft | Demo | PH1-16 display only |
| `awj-v3-gate`, `-h3-themes`, `-h4-postures`, `-h5-hardening` (3 / 9 / 22 / 16) | v3 gate, theme, posture, contrast, zoom, RTL/LTR, long-content wrapping with the totals dock | Demo | none |
| `dashboard-main-contracts` (2), `help-center` (7) | Dashboard buttons / overflow; help centre | Demo | none |
| `cust-*` (25), `flowers-*` (17), `store-brand-qa` (6) | Storefront customizer and flowers-commerce admin visual proofs | `/dev/*` fixture routes; ten specs stub `**/api/**` | none |

---

## 4. CONTRADICTS items in detail

### C-1 — CON-09 (and PC-C9 in §7.3): the invoice PDF does not come from `invoice-pdf.ts`  [b]

*Sentence affected.* CON-09, Actual behaviour: "the PDF is produced client-side from the page (`web/src/modules/invoices/services/invoice-pdf.ts`)". PC-C9: "the jsPDF generator prints `input.invoice.*` and rasterises the on-page QR SVG (`invoice-pdf.ts:62-63,479-487`)".

*Test.* `src/modules/documents/services/export/template-export-contract.test.ts:17-22`, `it.each(documentPages)('%s يصدّر ويشارك DOM القالب نفسه')`, first entry `src/app/(app)/invoices/[id]/page.tsx` (passed in the run):

```
expect(source).toContain('documentExporter.download');
expect(source).toContain('documentExporter.share');
expect(source).not.toMatch(legacyVectorExport);
// legacyVectorExport = /createInvoicePdf|createLineDocumentPdf|createPurchaseInvoicePdf|downloadLineDocumentPdf|shareLineDocumentPdf|downloadPurchaseInvoicePdf|sharePurchaseInvoicePdf/
```

Supporting: `presentation/visual-v2-print.test.ts:100` "مسار PDF يحيّد min-height و box-shadow يدوياً (html2canvas لا يطبّق @media print)" and `lib/pdf.test.ts` (Arabic normalisation of the html2canvas clone).

*Source confirmation.* The import graph from `invoices/[id]/page.tsx` does not reach `invoice-pdf.ts`. `documentExporter` is `html2canvasExporter` (`modules/documents/services/export/index.ts:36`) → `lib/pdf.ts` `downloadPdf` / `sharePdf` → `html2canvas` + `jsPDF.addImage(img, 'PNG', …)` (raster PNG slices of the on-screen `#print-root`). The only non-test importers of `invoice-pdf.ts` are `payment-pdf.ts` (used by `payments/[id]/page.tsx`), `report-pdf.ts` (report workspaces), and two modules with no importer at all (`purchase-pdf.ts`, `line-document-pdf.ts`).

*Effect.* The conclusion (no PDF/A-3, client-side) stands and is stronger: the invoice PDF is a raster image with no text layer or embedded file. Suggested wording: "the PDF is produced client-side by rasterising the on-screen document with html2canvas and jsPDF (`modules/documents/services/export/index.ts:36`, `lib/pdf.ts`); the invoice page does not use `invoice-pdf.ts` (`template-export-contract.test.ts:17-22`)". For PC-C9 drop the jsPDF sentence or point it at `lib/pdf.ts`; the "renderers do not recompute money" claim is unaffected (Vitest evidence in §1.2).

### C-2 — PH1-15: "Titles do include the alternate-language subtitle (`dtAlt`) but field labels do not"  [b-source]

*Affected.* True for the legacy compositions (`dtAlt` is rendered as a second line at `doc-header.tsx:81,294,376,568`). In the five v2 invoice compositions the title goes through `ModernDocumentTitle` (`doc-header.tsx:118,182,248,331,411`) → `ModernBilingualLabel`, which for `mode === 'en'` returns only the English string (`presentation/modern-bilingual-label.tsx:36`: `if (mode === 'en') return <span …>{withUnit(e)}</span>`). So in a v2 composition with `language = 'en'` the title is English-only as well.

*Tests.* None asserts the v2 `h1` in English-only mode; the same component for field labels is asserted at `modern-bilingual-label.test.tsx:22` "لا يغيّر العربية أو الإنجليزية المنفردتين" (`<ModernFieldLabel field="date" mode="en" />` → `textContent === 'Date'`, `:29-30`).

*Suggested wording.* "Legacy compositions add the alternate-language title line; the v2 compositions (the ones driven by `model.language`) print an English-only title and English-only labels in `en` mode."

### C-3 — PH1-03 Impact: "the sidebar also hides the e-invoice settings so the tenant has no cue"  [b-source, no test]

*Source.* The e-invoice entry lives in the Sales-Settings hub, not the main sidebar, and is hidden while `compliance.zatca` is not enabled (`app/(app)/sales-settings/page.tsx:31`, `appKey: 'compliance.zatca'`). If the settings page is opened directly it shows an explicit notice (`einvoice/page.tsx:187-193`; `salesSettings.zatca_application_inactive` "The e-invoicing application is inactive for this tenant. Enable it before opening the ZATCA settings." and a button `zatca_open_applications` → `/applications`, `en.json:5993-5994`). `nav-state` reports `suspended` as visible (`TenantApplicationService::navVisibility`: `$enabled = $status !== 'disabled'`).

*Tests.* None: all three page tests stub nav-state `true` (`einvoice/page.test.tsx:59`).

*Suggested wording.* "…there is no cue on the invoice page (blank QR area) or in the Sales-Settings hub; the settings page, if reached directly, explains that the application is inactive and links to /applications."

### C-4 — NV-18: "(secrets held in React state, password inputs)"  [b-source]

*Source.* Five inputs hold secrets: `secret` (`type="password"`, `einvoice/page.tsx:220`) and `current_password` (`type="password"`, `:225`) are masked; the CSID `binary_security_token` and the `private_key` are plain `<Textarea>` (`SecretTextarea`, `:219,221,258-260`; `components/ui/textarea.tsx` does no masking), only `autoComplete="off"` and `spellCheck={false}`.

*Test.* `einvoice/page.test.tsx:88` casts them as `HTMLTextAreaElement` / `HTMLInputElement` (`:93-95`) and asserts only `.value === ''` (`:96-98`); it never types into the textareas and never asserts `type`.

*Suggested wording.* "secrets are held in React state; only the HMAC `secret` and the current password are password inputs, the CSID token and private key are unmasked textareas. jsdom test `einvoice/page.test.tsx:88` shows no secret is pre-filled and only changed fields are submitted; browser-level behaviour (autofill, DevTools, screen sharing) remains not verified." Possible new P3 observation: unmasked private-key textarea.

### C-5 — report-wide: "no automated UI test suite"  [b]

*Sentences affected.* Arabic executive summary (report line 200), §9.5 first bullet (line 3802), the NV-12 "Evidence needed: Render tests / manual run" cell (line 4001), §2.4 "Web UI not rendered in a browser" (line 266; still true for a real browser, but jsdom render tests exist).

*Evidence.* `logs/vitest-full.json`: 445 files, 4 117 tests, 0 failed; CI runs them (`.github/workflows/web-ci.yml:38`); 66 Playwright specs in `e2e/`, one wired in CI. The `CLAUDE.md` bullet "اختبارات آلية للواجهة (`web/`) — لا توجد اليوم" (the source of the report's claim) is stale.

*Suggested wording.* "`web/` has a Vitest suite (445 files / 4 117 tests, all passing at the audited commit, run in CI) and 66 Playwright specs that run against the in-app Demo mock. No test renders the POS thermal receipt, the invoice detail page, or the credit-note print; none asserts clearance, VAT category or draft marking outside modern-v2."

---

## 5. Where the existing tests would break if the findings were fixed as recommended (for REM planning)

| Finding / task | Tests that must change | Why |
|---|---|---|
| CON-06 / REM-34 (required columns, rate and discount columns) | `registry/document-types.test.ts:68-99` (valid layout without quantity/unit price), `:130-138` (`toEqual` on the column catalog) | contract tightens, catalog grows |
| PH1-15 / REM-34 (en → bilingual for tax docs) | `use-document-label-mode.test.tsx:38`; `document-modern.test.tsx:436`; `document-classic-v2.test.tsx:164`; `document-erp-v2.test.tsx:163`; `document-minimal-v2.test.tsx:174`; `document-retail-v2.test.tsx:178` | they pin English-only for a `tax_invoice` model (only if the change lives in the web label-mode code) |
| PH1-10 + PH1-13 / REM-34 (no footer or QR caption on drafts) | `document-modern.test.tsx:289-317` (draft model asserted to carry `zatca_note` and `footer`) | incidental coupling: switch the fixture to `posted` with a QR for the label checks and add a draft-specific assertion |
| SUB-01 / REM-24 (clearance lifecycle) | `e2e/awj-v3-h2-workspaces.spec.ts:71,75` | exact two-state lifecycle list; update, do not revert |
| PH1-10 alternative "restrict printing to posted" | `e2e/invoice-detail-interactions.spec.ts:90` | draft menu count 8 |
| PH1-05 (confirmation for simplified to a VAT-registered buyer) | `invoice-form.test.tsx:550` | selects `simplified` without a confirmation step |
| Tests that need only a one-line fixture touch | `document-modern.test.tsx:385-395`, `visual-v2.test.ts:91` | they read `MODERN_TOTAL_LABELS.vat` by key, so a rate-aware VAT label must keep or migrate that key |

---

## 6. Additional source-level observations (not derived from tests)

1. `modules/documents/templates/thermal-receipt.tsx:100` truncates every line description with CSS `truncate` (one line, ellipsis) on 58/80 mm receipts: long Arabic item names are cut on a legal receipt (relevant to CON-06 and NV-12; the receipt also never shows discount, shipping or adjustment, `:111-112`). The POS receipt invoice (`lib/pos-receipt.ts:38-69`) carries only `subtotal`, `tax_amount`, `total`, so those rows could not be printed even if the template had them.
2. `lib/tax.ts:15-17`: `getSystemTaxInclusive()` swallows every error and returns `false`, so a failed `/sales-config/taxes` call silently puts POS and the forms in exclusive mode (VAT-09 context).
3. POS QR wiring: `fetchQr` is `Promise.resolve({ qr: created.data.zatca?.qr ?? null })` (`pos/page.tsx:1433`) and never rejects, so `onQrUnavailable` (`:1448`) and the "QR unavailable" toast are unreachable in production wiring; a sale whose response has no `zatca.qr` prints a receipt without QR and without any warning. `lib/__tests__/pos-checkout.test.ts:5` exercises the failure branch only with a throwing `fetchQr` that the page never supplies.
4. `from-invoice.ts` has no `zatca_document_type`/`issued_at` input and `PosCheckoutInvoice` (`lib/pos-receipt.ts:20-30`) lacks `zatca_document_type`: PH1-11's fix needs both the resource field and the type.
5. Default compliance footer is not gated by document type: `DocFooter` falls back to `invoiceDoc.footer` (the ZATCA sentence) for quotations and purchase orders too when `footerText` is null (`doc-footer.tsx:22-25`; `from-quote.ts:84`, `from-purchase-order.ts:92`); no test asserts it.

## Appendix A — cited Vitest tests (file:line, full title, status in the run)

Line numbers are those of the `it(` / `it.each(` call. The export-contract test is an `it.each` over six document pages; only the invoice-page instance is listed.

| File:line | Title | Status |
|---|---|---|
| `lib/pos-receipt.test.ts:29` | يستعمل رقم الفاتورة والتاريخ والإجماليات من الفاتورة المرحّلة، لا من حساب محلي | passed |
| `lib/pos-receipt.test.ts:40` | يتجاهل إجماليات سلة متلاعَباً بها تماماً — لا مصدر إلا الفاتورة المرحّلة | passed |
| `lib/pos-receipt.test.ts:76` | يستعمل اسم/رقم ضريبي/مدينة العميل من الفاتورة المرحّلة نفسها | passed |
| `modules/documents/builder/from-invoice.test.ts:43` | builds the seller national address and contact details from the company profile | passed |
| `modules/documents/builder/from-invoice.test.ts:82` | uses the company currency and explicit document direction and catalog type | passed |
| `modules/documents/builder/from-invoice.test.ts:106` | falls back to SAR for an unknown company currency | passed |
| `modules/documents/builder/from-invoice.test.ts:125` | يمرّر الحالة والاستحقاق والإجماليات الاختيارية من بيانات الفاتورة القائمة دون إعادة حساب | passed |
| `modules/documents/builder/from-credit-note.test.ts:16` | defaults to SAR and rtl for a sales credit note | passed |
| `modules/documents/builder/from-purchase.test.ts:73` | reads language_effective from the API contract and flips direction to ltr for English | passed |
| `modules/documents/components/document-modern.test.tsx:127` | يعرض شارة المسودة والملغى فقط | passed |
| `modules/documents/components/document-modern.test.tsx:168` | يرسم QR بحجم Modern بجانب الملخص لا في الرأس | passed |
| `modules/documents/components/document-modern.test.tsx:289` | يعزل تسميات Modern الثنائية في عقدتين دون خلط القيمة أو فاصل نصي | passed |
| `modules/documents/components/document-modern.test.tsx:436` | يبقي العربية والإنجليزية المنفردتين بلا فاصل ثنائي ولا وسم عزل | passed |
| `modules/documents/components/document-classic-v2.test.tsx:164` | يبقي العربية والإنجليزية المنفردتين بلا وسم عزل | passed |
| `modules/documents/components/document-classic-v2.test.tsx:184` | لا يغيّر تركيب Classic التاريخي: ثلاث بطاقات وشريط هوية وQR 110 | passed |
| `modules/documents/components/document-erp-v2.test.tsx:163` | يبقي العربية والإنجليزية المنفردتين بلا وسم عزل | passed |
| `modules/documents/components/document-minimal-v2.test.tsx:174` | يبقي العربية والإنجليزية المنفردتين بلا وسم عزل | passed |
| `modules/documents/components/document-retail-v2.test.tsx:178` | يبقي العربية والإنجليزية المنفردتين بلا وسم عزل | passed |
| `modules/documents/components/document-quotation-proposal.test.tsx:197` | يخفي صف الضريبة عند الصفر ويعرض الخصم من النموذج دون إعادة حساب | passed |
| `modules/documents/components/document-purchase-order-formal.test.tsx:212` | يخفي صف الضريبة عند الصفر ويعرض الخصم من النموذج دون إعادة حساب | passed |
| `modules/documents/presentation/use-document-label-mode.test.tsx:38` | يعطي الأولوية لـmodel.language=en بغضّ النظر عن UI AR | passed |
| `modules/documents/presentation/modern-bilingual-label.test.tsx:22` | لا يغيّر العربية أو الإنجليزية المنفردتين | passed |
| `modules/documents/presentation/visual-v2.test.ts:34` | يعطي الإنجليزية عند واجهة إنجليزية ومستند LTR | passed |
| `modules/documents/presentation/visual-v2.test.ts:91` | يجعل كل تسميات الحقول والأعمدة والإجماليات والحالات ثنائية بالعربية أولاً | passed |
| `modules/documents/presentation/visual-v2.test.ts:110` | يميّز المسودة والملغى فقط ولا يوسّم المرحّل | passed |
| `modules/documents/presentation/visual-v2.test.ts:119` | يركب شارة المسودة ثنائياً بالعربية أولاً | passed |
| `modules/documents/presentation/visual-v2-print.test.ts:100` | مسار PDF يحيّد min-height و box-shadow يدوياً (html2canvas لا يطبّق @media print) | passed |
| `modules/documents/registry/document-types.test.ts:68` | validates advanced block properties against the rendered contract | passed |
| `modules/documents/registry/document-types.test.ts:130` | keeps the full financial column catalog available for builder customization | passed |
| `modules/documents/registry/document-types.test.ts:57` | requires core blocks to remain visible | passed |
| `modules/documents/registry/templates.test.ts:17` | يبقي الافتراضي classic ولا يعيد تفسير modern كـ v2 | passed |
| `modules/documents/services/export/template-export-contract.test.ts:17` | src/app/(app)/invoices/[id]/page.tsx يصدّر ويشارك DOM القالب نفسه | passed |
| `modules/documents/qa/document-qa-fixtures.test.ts:15` | يميز نماذج الأنواع التجارية ويخفي QR للمستندات غير الضريبية | passed |
| `modules/print-templates/services/document-output-template.test.ts:36` | يربط الفاتورة المبسطة بنوع الكتالوج المستقل | passed |
| `modules/print-templates/services/document-output-template.test.ts:40` | يربط الضريبية القياسية وأي قيمة أخرى بـ tax_invoice | passed |
| `modules/print-templates/services/document-output-template.test.ts:103` | يثبّت المراجعات الثلاث للفاتورة المرحّلة ويتجاهل التعيين الحي | passed |
| `modules/print-templates/services/document-output-template.test.ts:133` | لا يعيد تفسير فاتورة مرحّلة بتعيين حي لاحق | passed |
| `modules/credit-notes/services/credit-note-template-design.test.ts:23` | uses the frozen revision as the complete historical design boundary | passed |
| `components/pos/receipt-dialog.test.tsx:62` | uses the frozen thermal revision for both preview and auto/manual print | passed |
| `components/pos/receipt-dialog.test.tsx:123` | PR-4: وضع المعاينة يستبدل إطار «تم البيع» بعنوان محايد وزر «إغلاق» بدل «بيع جديد»، مع إتاحة نسخ رقم الفاتورة | passed |
| `components/pos/use-pos-active-carts.test.ts:20` | يحفظ السلات المستقلة ويستعيد السلة النشطة فقط من حمولة صالحة | passed |
| `lib/__tests__/pos-checkout.test.ts:5` | يبقي البيع ناجحاً وينظف السلة عند فشل QR ولا يعيد إرسال الدفع | passed |
| `app/(pos)/pos/page.test.tsx:37` | تُركَّب دون استثناء أو تعليق العملية (بلا جلسة/توكن — لا يوجد اتصال شبكي حقيقي) | passed |
| `components/invoices/invoice-form.test.tsx:302` | suggests Standard clearance for a customer with a VAT number | passed |
| `components/invoices/invoice-form.test.tsx:550` | sends an explicit ZATCA document type snapshot with the draft | passed |
| `components/invoices/invoice-form.test.tsx:654` | redirects a posted invoice back to its detail page instead of editing it | passed |
| `components/invoices/invoice-form.test.tsx:521` | applies a header discount to the total | passed |
| `components/invoices/invoice-form.test.tsx:530` | switches tax mode without touching the line price | passed |
| `components/invoices/invoice-form.test.tsx:448` | computes the line total from quantity, price, discount and tax | passed |
| `app/(app)/sales-settings/einvoice/page.test.tsx:76` | shows backend readiness blockers and keeps automatic submission unavailable | passed |
| `app/(app)/sales-settings/einvoice/page.test.tsx:88` | never fills secret inputs from credential metadata and only submits changed secret values | passed |
| `app/(app)/sales-settings/einvoice/page.test.tsx:115` | requires explicit confirmation before production credentials can be saved | passed |
| `components/layout/notification-bell.test.tsx:216` | renders a source link for a registered ZATCA submission action (PR-NOTIF-4) | passed |
| `lib/__tests__/mock-data.test.ts:13` | يعيد الوضع اليدوي افتراضياً ويحفظ تغيير وضع الإرسال في جلسة المعاينة | passed |
| `lib/__tests__/mock-data.test.ts:54` | يعيد بيانات اعتماد عامة فقط مع ميتاداتا الجاهزية | passed |
| `lib/__tests__/money.test.ts:64` | يستخرج 15% من مبلغ شامل | passed |
| `lib/__tests__/money.test.ts:71` | يقرّب لأقرب هللة كالـ backend | passed |
| `lib/__tests__/mock-general-reports.test.ts:19` | تعيد القيود والضريبة وكشف الأستاذ بعقود العرض المتوقعة | passed |
| `components/documents/document-language-selector.test.tsx:27` | اختيار قيمة يستدعي onChange بها فقط (لا يمس تصميم) | passed |
| `app/(app)/documents/settings/page.test.tsx:224` | keeps both timed-retention badges aligned with governance.policy.enabled | passed |

---

## Addendum — Playwright specs cited above that were executed

Results are for the audited commit in Demo Mode (see `web-test-results.md`). "Source level" in the tables above refers to how the spec was read when this mapping was written.

| Spec | Result (desktop + mobile) |
|---|---|
| `e2e/awj-v3-h2-workspaces.spec.ts` | 14 passed · 0 failed · 0 skipped |
| `e2e/invoice-detail-interactions.spec.ts` | 2 passed · 0 failed · 0 skipped |
| `e2e/purchase-detail-interactions.spec.ts` | 6 passed · 0 failed · 0 skipped |
| `e2e/reports.spec.ts` | 66 passed · 4 failed · 0 skipped |
| `e2e/document-qa.spec.ts` | 7 passed · 2 failed · 1 skipped |
| `e2e/pos-checkout-reliability.spec.ts` | 0 passed · 1 failed · 1 skipped |
| `e2e/pos-session-cart-recovery.spec.ts` | 0 passed · 1 failed · 1 skipped |
| `e2e/pos-dedicated-workspace.spec.ts` | 3 passed · 0 failed · 3 skipped |
| `e2e/pos-interaction-mode.spec.ts` | 0 passed · 1 failed · 1 skipped |
| `e2e/delivery-notes.fixture.spec.ts` | 20 passed · 0 failed · 0 skipped |
| `e2e/document-operations.spec.ts` | 6 passed · 0 failed · 0 skipped |
| `e2e/document-review.spec.ts` | 1 passed · 5 failed · 0 skipped |
| `e2e/dashboard-main-contracts.spec.ts` | 4 passed · 0 failed · 0 skipped |
| `e2e/awj-v3-gate.spec.ts` | 3 passed · 0 failed · 0 skipped |
| `e2e/awj-v3-h3-themes.spec.ts` | 9 passed · 0 failed · 0 skipped |
| `e2e/awj-v3-h4-postures.spec.ts` | 23 passed · 0 failed · 0 skipped |
| `e2e/awj-v3-h5-hardening.spec.ts` | 31 passed · 0 failed · 0 skipped |
| `e2e/p47-baseline.spec.ts` | not run |
