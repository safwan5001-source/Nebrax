# AWJ-ERP-UI-H2 · A2 audit — SALES + CUSTOMERS (group `SAL`)

> **Committed evidence:** the curated images of this report are under [`a2/sal/`](a2/sal/) (JPEG, at most 1100 px wide). References to `shots/`, `run.log`, `*.jsonl`, `wf*/` or `out-states/` point to the full local run, kept outside git for size; it is reproducible with [`tools/`](tools/README.md). The auditor's report is kept verbatim apart from evidence paths.

> Saved by the coordinator verbatim from the auditor's hand-back (the auditor's harness refused report files). P0s re-verified by the coordinator in code: SAL-01 `web/src/components/sales-config/config-form.tsx:49` `.catch(() => setValues({}))` and `config-list-editor.tsx:47` `.catch(() => setRows([]))`; SAL-02 `web/src/components/returns/create-return-dialog.tsx:86` `useState(true)` for `postNow`, `:315` posts after create; SAL-03 `web/src/app/(app)/partners/[id]/page.tsx` sums `remaining` of posted invoices client-side (root cause shared with SAL-08: invoice `remaining` ignores posted credit notes/returns).

Auditor run 2026-10-15, local isolated stack (web 127.0.0.1:3001 prod build, API 127.0.0.1:8000), tenant A, v3 surface, Arabic 1440 light unless stated. Records tagged `H2-A2-SAL`. Repository unchanged.
Scripts `scripts/` (Playwright; `lib.cjs` token injection + API helper + formatRiyal clone); step log `scripts/run.log`; raw shots `shots/` (atlas `ar1440__*`, `ar390__*`; workflows `W1…W10`; lists `L-*`; roles `S-*`; detail states `D-*`; settings-error `X-*`); curated `evidence/01…17-*.jpg`; reused `out-v3a`, `out-v3b` (EN dark), `out-states`.

**Counts: 39 findings — P0 3 · P1 11 · P2 18 · P3 7.**

## 1. Screens covered
| Module | Routes |
|---|---|
| Entry | /dashboard |
| Invoices | /invoices, /invoices/new, /invoices/:id (I3 draft, I1 posted, INV-2026-00004), /invoices/:id/edit (draft + posted), /invoices/:id/payments/new |
| Quotes | /quotes, /quotes/new, /quotes/:id |
| Credit notes | /credit-notes, /credit-notes/new (+?invoice=), /credit-notes/:id |
| Delivery notes | /delivery-notes, /new, /:id, /invoice-draft |
| Recurring | /recurring-invoices, /new, /:id |
| Payments | /payments, /payments/new, /payments/:id |
| Returns/refunds | /returns, /returns/:id, return dialog on invoice, /customer-refunds (+dialog), /customer-refunds/:id |
| Delivery / documents | /delivery-hub, /delivery-platforms, /document-design (visual + states only) |
| Sales settings | hub + designs, einvoice, fields, invoices, orders, pricelists, quotes, shipping, sources, statuses |
| Customers | /partners, /new, /:id, /:id/edit, /:id/statement, /contacts, /crm, /appointments, /customer-settings |

Not covered: `/customer-refunds/new` and `/returns/new` don't exist (created through dialogs, covered); `/integrations/delivery-platforms/*`, `/commerce/delivery`, reports belong to other groups; 320 px, 200% zoom, Ink, legacy not re-captured (§7).

## 2. State matrix
OK · ISSUE (id) · N/A · NV. "Forbidden" = staff (view-only on most of these screens).

| Route | Empty | Loading | Error | Forbidden/view-only | Read-only | Validation | Long | Many |
|---|---|---|---|---|---|---|---|---|
| /dashboard | OK | OK | ISSUE 07 | ISSUE 13 | N/A | N/A | OK | ISSUE 27 |
| /invoices | OK | OK | OK retry | ISSUE 10 | OK (icons disabled on posted) | N/A | OK (ellipsis + title) | OK (30 rows, 2 pages) |
| /invoices/new | OK | OK | ISSUE 06 | ISSUE 10 | N/A | ISSUE 22 | OK | N/A |
| /invoices/:id | N/A | OK (+36) | ISSUE 21 | ISSUE 10 | OK (posted /edit → read-only detail) | N/A | OK | N/A |
| /invoices/:id/payments/new | N/A | NV | NV | ISSUE 10 | N/A | ISSUE 15 | OK | N/A |
| /quotes | OK | OK | ISSUE 06 | ISSUE 10 | N/A | N/A | OK | NV |
| /quotes/new | OK | OK | ISSUE 06 | ISSUE 10 | N/A | ISSUE 22 | OK | N/A |
| /quotes/:id | N/A | OK | ISSUE 21 | NV | OK (converted) | N/A | OK | N/A |
| /credit-notes | OK | OK | ISSUE 06 | ISSUE 10 | N/A | N/A | OK | NV |
| /credit-notes/new | OK | OK | ISSUE 06 | ISSUE 10 | N/A | ISSUE 22 | OK | N/A |
| /credit-notes/:id | N/A | OK | ISSUE 21 | NV | ISSUE 05 | N/A | OK | N/A |
| /delivery-notes | OK (best empty state) | OK | OK retry | OK | N/A | N/A | OK | NV |
| /delivery-notes/new | OK | OK | ISSUE 06 | ISSUE 10 | N/A | OK inline | OK | N/A |
| /delivery-notes/:id | N/A | OK | ISSUE 21 (raw) | NV | OK | N/A | OK | N/A |
| /delivery-notes/invoice-draft | OK | OK | OK | OK localized | N/A | ISSUE 22 | OK | N/A |
| /recurring-invoices | OK | OK | ISSUE 06 | ISSUE 10 | N/A | N/A | OK | NV |
| /recurring-invoices/new | OK | ISSUE (none) | ISSUE 06 | ISSUE 10 | N/A | OK | OK | N/A |
| /recurring-invoices/:id | N/A | OK | ISSUE 21 | NV | ISSUE 09 | N/A | OK | N/A |
| /payments | OK | OK | ISSUE 06 | ISSUE 10 | N/A | N/A | OK | ISSUE 26 |
| /payments/new | OK | ISSUE (none) | OK | ISSUE 10 | N/A | ISSUE 15 | OK | N/A |
| /payments/:id | N/A | OK | ISSUE 21 | NV | NV | N/A | OK | N/A |
| /returns | OK | OK | ISSUE 06 | OK | N/A | N/A | OK | NV |
| /returns/:id | N/A | OK | ISSUE 21 | NV | OK | N/A | OK | N/A |
| /customer-refunds | OK | ISSUE (none) | ISSUE 06 | ISSUE 06 (403 → empty + CTA) | N/A | ISSUE 22 | OK | NV |
| /customer-refunds/:id | N/A | OK | ISSUE 21 (raw) | NV | OK (reverse) | N/A | OK | N/A |
| /delivery-hub | OK | ISSUE (none) | OK | OK localized | N/A | N/A | NV | NV |
| /delivery-platforms | OK | ISSUE (none) | OK | shown to staff | N/A | N/A | NV | NV |
| /document-design | OK | OK | OK retry | shown | N/A | N/A | OK | N/A |
| /sales-settings hub | OK | none | ISSUE 06 | shown | N/A | N/A | OK | N/A |
| /sales-settings/invoices, /quotes | OK | OK | ISSUE 06 | ISSUE 10 | N/A | ISSUE 23 (quotes) | OK | N/A |
| /sales-settings/orders, fields, shipping, sources, statuses | OK | OK | **ISSUE 01** | ISSUE 10 | N/A | NV | OK | N/A |
| /sales-settings/pricelists, einvoice, designs | OK | OK | OK | shown / partial forbid | N/A | NV | OK | N/A |
| /partners | OK | OK | OK retry | ISSUE 10 | N/A | N/A | OK | OK (28 customers) |
| /partners/new | OK | none | ISSUE 06 | ISSUE 10 | N/A | ISSUE 20 | OK | N/A |
| /partners/:id | N/A | OK | ISSUE 21 | ISSUE 10 | N/A | N/A | OK | **ISSUE 03** |
| /partners/:id/edit | N/A | NV | NV | ISSUE 10 | N/A | ISSUE 20 | OK | N/A |
| /partners/:id/statement | OK | NV | NV | OK | N/A | N/A | OK | OK |
| /contacts, /crm, /appointments | OK | OK | ISSUE 06 | shown + add buttons | N/A | ISSUE 20 | NV | NV |
| /customer-settings | OK | OK | ISSUE 06 | shown, editable | N/A | NV | OK | N/A |

## 3. Workflows
| # | Workflow | Steps | Clicks | Result | Issues | Evidence |
|---|---|---|---|---|---|---|
| W1 | Invoice 2 lines + discount → draft → post → partial payment → print | List → «إنشاء فاتورة» → customer combobox → product line → «إضافة سطر» → service line → discount 50 → notes → «حفظ كمسودة» → «ترحيل الفاتورة» → confirm → «إضافة عملية دفع» → 1000 → «تأكيد التحصيل» → «طباعة» / «تنزيل PDF» / «المستند» | 11 + 2 + 2 + 1 | INV-2026-00004 2,702.50 → posted → partial (paid 1,000, remaining 1,702.50); `print()` called; PDF downloaded | 04, 11, 12, 15–19, 22, 33, 36 | W1-01…17, W1-m1…m4, ev 01/09/17 |
| W2 | Quote → convert | create → customer → product → qty → «حفظ العرض» → «تحويل إلى فاتورة» | 7 | QUO-2026-00001 117.30 → draft INV-2026-00005; quote «محوّل لفاتورة» | 24, 28 | W2-01…07 |
| W3 | Credit note on posted invoice | Invoice «⋯» → «إنشاء إشعار دائن» (prefilled) → qty 1 → reason → «حفظ الإشعار» → «ترحيل» | 5 | CN-2026-00001 506.71 posted, no confirmation; no actions after posting; invoice remaining unchanged | 05, 08, 14, 17, 24 | W3-*, ev 10 |
| W4 | DN → confirm → invoice draft | new DN → customer, product, qty, reference → «حفظ كمسودة» → «تأكيد التسليم» → invoice-draft → tick → «معاينة» → reason (required) → «إنشاء مسودة الفاتورة» | 9 | DN-2026-00001 confirmed; INV-2026-00006 1,552.50 draft | 19, 22, 32 | W4-* |
| W5 | Recurring schedule | title → customer (native select) → «شهري» → product → «حفظ القالب» | 2 + selects | Created (1,725.00); detail has only «توليد فاتورة الآن» | 09, 24 | W5-*, ev 14 |
| W6 | Standalone receipt allocated to invoice | «تسجيل دفعة» → customer → INV-2026-00001 → 500 → «نقدي» → «تأكيد العملية» | 2 + selects | REC-2026-00004 posted; INV-1 remaining 2,777.50; lands on the invoice | 15–18, 26, 29 | W6-*, ev 08 |
| W7 | Return + customer refund | Invoice «⋯» → «إنشاء مرتجع» → remove line → «إنشاء»; /customer-refunds «استرداد جديد» → customer → allocate 100 → «حفظ» → «ترحيل» | 3 + 4 | SRET-2026-00001 506.73 posted on «إنشاء»; CRF-2026-00001 100 posted (reversible) | 02, 08, 14, 29, 37 | W7-*, ev 02 |
| W8 | Customer with VAT → edit → statement range | «إضافة طرف» → invalid VAT (English error) → valid → «حفظ» (lands on list) → edit → statement 01–15/10 → «معاينة كشف الحساب» | 6 | Partner created/edited; statement 7 lines, closing 3,566.56 | 03, 20, 30, 31 | W8-*, ev 06/07/13 |
| W9 | CRM activity + appointment | dialogs with datetime-local → «حفظ» | 4 | Both saved and listed | 20, 24 | W9-* |
| W10 | Change setting and revert | quote validity 14 → 30 → save → reload → 14 | 2 per change | OK; an empty field is saved as 0 (restored) | 23 | W10-* |
| L | Search / filter / sort / paging | 22 extra invoices via the UI → 30 | — | Search, filters, header sort, 25/50 paging OK; canary search → 0 | 34, 35 | L-01…08 |
| K | Keyboard-only invoice | combobox Enter / type / ↓ / Enter | — | Works, but focus drops to `<body>` after each pick; save buttons reachable only by Shift+Tab | 12 | run.log KBD |

## 4. Consistency notes
1. **Document forms:** invoice is on the v3 Document Workspace; quote, credit note, recurring, delivery note and payments use older card forms (single bottom save, no lifecycle, static totals). Customer picker is a Combobox on invoice/quote/DN but a native select on credit note, recurring, payments, refund, CRM, appointments; product picker native on recurring.
2. **Detail headers:** invoice stepper + toolbar; quote/CN/recurring number + inline status with side actions; DN status block; return print/PDF only; refund back link + «ترحيل».
3. **Lists:** credit notes sort bar outside the card, footer «0 · صفحة 1 من 1»; delivery notes own filter bar (تطبيق/مسح, date range), header shown when empty, richer empty state with CTA; customer refunds a third layout (status select, unlabeled search, CSV).
4. **Confirmation before posting:** only invoice posting from the detail page asks first. Invoice «حفظ وترحيل», credit-note post, return create, DN confirm, refund post and receipt confirm go through immediately.
5. **Validation:** six patterns (22).
6. **Badges:** posted green text, draft bordered pill, partial orange text; green on non-financial states.
7. **Money:** screens use the riyal sign U+20C1; document previews and PDFs use ﷼ (U+FDFC); payment inputs and partner summary use «SAR»; dashboard tiles «3,028.5».
8. **Default customer:** invoice → «Al Khobar Trading Est.»; DN → «شركة الخليج الشرقي…»; quote, CN, recurring, payment empty.
9. **Settings layouts:** widths differ; /customer-settings has no back arrow.
10. **Sidebar:** two sub-items highlighted on create routes.

## 5. Financial-number parity
Exact matches with `formatRiyal(api)`: INV-2026-00004 (subtotal, discount, tax, total, line totals, unit prices, paid, remaining) on detail, document tab and list; quote 102.00 / 15.30 / 117.30; INV-2026-00005; DN invoice 1,552.50; recurring 1,725.00; return 440.63 / 66.10 / 506.73; refund 100.00; credit-note total 506.71; payment-form remaining dropdown; dashboard AR 6,235.74, net −7,055.77, sales 6,723.23; cash + bank −4,794.02 matches but is summed in the browser.
Mismatch: **partner C1** «المبلغ المستحق 4,480.00» vs ledger closing **3,566.56** (03). Symbol deviations: ﷼ in previews; «SAR» in payment inputs (17).

## 6. Findings

### P0
- **H2-SAL-01 · P0 · Sales-config settings render a blank savable form after a load error; Save overwrites real config** — /sales-settings/orders, statuses (same pattern on fields, shipping, sources). With GET 500 the form is empty with no error; Save sends `PUT {"prefix":"","auto_convert":false,"require_approval":false}` (real value «SO»); statuses sends `PUT {"data":[]}`; UI shows «تم التحديث بنجاح». Writes intercepted in the test. ev 03, X-err-save-*.png, run.log ERRSAVE. Direction: no editable state until the load succeeds.
- **H2-SAL-02 · P0 · Return dialog posts on «إنشاء» («ترحيل فوري» pre-checked), no confirmation, no API cancel/reverse** — return dialog (from invoice detail or /returns). SRET-2026-00001 506.73 posted; posted detail offers only print/PDF/share (routes/api.php 1468–1471). ev 02, W7-04. Direction: default to draft or label «إنشاء وترحيل» with confirmation.
- **H2-SAL-03 · P0 · Partner detail computes amount due client-side and shows the wrong number** — /partners/:id. C1 shows «مفتوح/المبلغ المستحق 4,480.00» while the ledger statement closes at 3,566.56; summary row doesn't add up (5,980 − 506.73 − 1,500 − 506.71 ≠ 4,480); «−0.00» in red. Code sums `Number()` over unpaginated lists (`partners/[id]/page.tsx` 126–151, 436–466). ev 06 vs ev 07. Direction: use the server balance.

### P1
- **H2-SAL-04** Cancel in the post/delete confirmation is labelled «إعادة المحاولة» (`invoices/[id]/page.tsx:720` uses `t('retry')`). ev 01.
- **H2-SAL-05** Credit note posts with no confirmation; no edit/delete/reverse path (API: index/show/store/post only, routes 734–742). Same no-confirm on invoice «حفظ وترحيل», DN confirm, refund post, receipt confirm. ev 10, W3-04/06.
- **H2-SAL-06** Server errors (and a 403) shown as «no records»/blank: lists /payments, /quotes, /credit-notes, /recurring-invoices, /returns, /customer-refunds, /contacts, /crm, /appointments; customer refunds for staff 403 → «لا توجد استردادات عملاء» + active «استرداد جديد»; blank on error: hub, /sales-settings/invoices, /sales-settings/quotes, /customer-settings; forms usable with empty pickers: /invoices/new, /quotes/new, /credit-notes/new, /recurring-invoices/new, /partners/new. ev 04, out-states forbidden__customer_refunds.png.
- **H2-SAL-07** Dashboard shows «0 ⃁» on every KPI when page APIs fail; no error. ev 05.
- **H2-SAL-08** Invoice «المتبقي» ignores posted credit notes and returns, and the invoice shows no link to them (INV-2026-00004 still 1,702.50 «جزئية» after CN 506.71 + return 506.73; payment form still pre-fills 1,702.50). **Needs owner/ADR decision.** W3-07, run.log W7b.
- **H2-SAL-09** Recurring schedule can't be stopped/paused/edited/deleted (UI only «توليد فاتورة الآن»; DELETE exists in the API but is never called; no history). ev 14.
- **H2-SAL-10** View-only staff see create/edit/post/payment/delete actions and full forms; 403 «ليس لديك صلاحية لتنفيذ هذا الإجراء.» only after save (invoices list/new/detail/payment, partners, sales settings, customer settings, CRM, appointments). ev 11, S-01…S-13.
- **H2-SAL-11** Default document date is the UTC date (`new Date().toISOString().slice(0,10)`): at Asia/Riyadh 2026-10-16 01:30, /invoices/new, /payments/new, /quotes/new prefill 15/10/2026. run.log, shots/TZ-quote-date.png.
- **H2-SAL-12** Shared Combobox drops focus to `<body>` after keyboard selection (WCAG 2.4.3 A) on /invoices/new, /quotes/new, /delivery-notes/new. run.log KBD.
- **H2-SAL-13 (owner decision)** Branch-scoped user sees tenant-wide cash and receivables on the dashboard («النقد والبنك −4,794.02», «ذمم العملاء 6,235.74») while seeing 0 invoices; /api/accounts returns identical balances for owner and scoped tokens. ev 12.
- **H2-SAL-14** Credit note and return for the same line round differently: CN 440.62 / 66.09 / 506.71 vs return 440.63 / 66.10 / 506.73 (backend). W3-06, W7-04.

### P2
- **H2-SAL-15** Payment forms: invalid amount / over-remaining / missing partner → generic «تعذّر الحفظ»; no field marked; message stays after the fix (`document-payment-form.tsx:169`). ev 09, W6-03/04.
- **H2-SAL-16** «مسودة» pill invisible (bg-muted + text-muted, 1.00:1 light and dark): `document-payment-form.tsx:233`, `general-payment-form.tsx:203`, `employee-custodies/new/page.tsx:133`. ev 08.
- **H2-SAL-17** Currency inconsistent: ﷼ in document previews/PDF (`modules/documents/constants/currencies.ts:21`); «SAR» in payment inputs and partner summary; dashboard «3,028.5». W1-15, ev 08–10.
- **H2-SAL-18** Receipt method defaults to the alphabetically first («بطاقة ائتمان») and switches the account to the bank (`document-payment-form.tsx:135`).
- **H2-SAL-19** New invoice and DN pre-select a customer the user didn't choose (a different one on each); on the invoice it also sets the ZATCA type. ar1440__invoices_new.png.
- **H2-SAL-20** Validation messages in English or native bubbles: «The vat number field must be 15 characters.» (no client 15-digit check); «Please fill out this field.» in CRM/appointments/contacts. ev 13.
- **H2-SAL-21** Detail error/not-found states inconsistent, wrong or raw, no h1: 500 → «غير موجود» on quotes, CN, recurring, partners; 404 → «تعذّر تحميل» on invoice and payment; return page «الفاتورة غير موجودة»; DN and refund raw «Server Error» / «No query results for model [App\Models\DeliveryNote]…»; branch-scoped user opening I1 → «تعذّر تحميل الفاتورة». ev 16, D-*, S-09.
- **H2-SAL-22** Six validation patterns across create forms: invoice message at the bottom far from the line (ev 17); submit disabled with no reason (quote, CN, partner, refund, DN→invoice); inline (DN); bottom (recurring); generic (payments); native (CRM).
- **H2-SAL-23** Settings: empty number saved as 0 with a success toast; no unsaved-change guard (quote_validity_days 0, restored). W10-02.
- **H2-SAL-24** Document forms and pickers off-pattern (§4.1); native datetime-local in CRM/appointments.
- **H2-SAL-25** List drift (§4.3). ev 15, ar390__*.
- **H2-SAL-26** Payments list has no status column (draft and posted receipts look the same); title «المدفوعات» vs menu «مدفوعات العملاء». W6-06.
- **H2-SAL-27** Dashboard «حالة سداد الفواتير» counts drafts as «غير مدفوعة» (26).
- **H2-SAL-28** Quotation preview carries the ZATCA e-invoice footer; «صالح حتى» empty in the form but saved as +14 days. W2-03/04.
- **H2-SAL-29** No navigation/link to the created document: receipt → lands on the invoice; return → stays on the invoice; refund → stays on the list. W6-05, W7-03, W7-12.
- **H2-SAL-30** Partner detail: red/green on 0.00; «−0.00»; «آخر عملية دفع» shows a draft receipt; the page fetches all tenant documents unpaginated (`InvoiceController:114`) and filters in the browser.
- **H2-SAL-31** Partner create returns to the list; edit returns to the detail.
- **H2-SAL-32** DN→invoice page stays submittable after success (second click returned the same draft; server idempotent); summary «الكمية: 1» vs line quantity 3; unit «piece». W4-09, W4-11.

### P3
- **H2-SAL-33** Two sidebar items highlighted on create routes.
- **H2-SAL-34** Three sort controls per list; «4 نتيجة» grammar.
- **H2-SAL-35** Badge styling varies by tone; green on non-financial states.
- **H2-SAL-36** Blank main area ~1.5 s on client navigation to /invoices/:id (measured while crawlers ran). shots/blank-1500.png.
- **H2-SAL-37** Return dialog line inputs have no column headers.
- **H2-SAL-38** Settings page widths and back link vary.
- **H2-SAL-39** «إنشاء مسودة فاتورة» (from DN) sits among the new-invoice save actions.

## 7. Not verified
Legacy surface for these flows; 320 px; 200% zoom; Ink (EN-dark 1440 reviewed for invoice and partner detail: 03 and 30 reproduce). Full data entry at 390 (screens captured; no overflow on any of the 44 routes). Payment detail post/reverse; quote «إصدار للطباعة». Delivery hub, delivery platforms and document-design workflows. ZATCA artifacts beyond the QR in the preview. Recurring scheduler auto-run (`QUEUE_CONNECTION=sync`). Staff on other dynamic detail routes. Invoice create-then-post failure path (read in code, not reproduced).

## 8. Records left in tenant A
~30 invoices tagged `H2-A2-SAL` (22 only for paging), CN-2026-00001, SRET-2026-00001, CRF-2026-00001, DN-2026-00001/2, REC-2026-00004, one recurring schedule, one partner, one CRM activity, one appointment. Quote-validity setting changed and restored to 14.

## Evidence index (committed)

- [`01-post-confirm-cancel-says-retry.jpg`](a2/sal/01-post-confirm-cancel-says-retry.jpg)
- [`02-return-dialog-post-immediately-prechecked.jpg`](a2/sal/02-return-dialog-post-immediately-prechecked.jpg)
- [`03-settings-orders-blank-after-load-error.jpg`](a2/sal/03-settings-orders-blank-after-load-error.jpg)
- [`04-payments-500-shown-as-empty.jpg`](a2/sal/04-payments-500-shown-as-empty.jpg)
- [`05-dashboard-500-shown-as-zero.jpg`](a2/sal/05-dashboard-500-shown-as-zero.jpg)
- [`06-partner-summary-4480-vs-ledger.jpg`](a2/sal/06-partner-summary-4480-vs-ledger.jpg)
- [`07-statement-closing-3566.jpg`](a2/sal/07-statement-closing-3566.jpg)
- [`08-payment-form-invisible-draft-pill-SAR.jpg`](a2/sal/08-payment-form-invisible-draft-pill-SAR.jpg)
- [`09-payment-overpay-generic-error.jpg`](a2/sal/09-payment-overpay-generic-error.jpg)
- [`10-credit-note-posted-no-actions-legacy-riyal.jpg`](a2/sal/10-credit-note-posted-no-actions-legacy-riyal.jpg)
- [`11-staff-403-after-full-form.jpg`](a2/sal/11-staff-403-after-full-form.jpg)
- [`12-branch-scoped-dashboard-tenant-balances.jpg`](a2/sal/12-branch-scoped-dashboard-tenant-balances.jpg)
- [`13-vat-error-english.jpg`](a2/sal/13-vat-error-english.jpg)
- [`14-recurring-no-stop-edit.jpg`](a2/sal/14-recurring-no-stop-edit.jpg)
- [`15-list-pattern-drift.jpg`](a2/sal/15-list-pattern-drift.jpg)
- [`16-dn-notfound-raw-exception.jpg`](a2/sal/16-dn-notfound-raw-exception.jpg)
- [`17-invoice-validation-far-from-lines.jpg`](a2/sal/17-invoice-validation-far-from-lines.jpg)
