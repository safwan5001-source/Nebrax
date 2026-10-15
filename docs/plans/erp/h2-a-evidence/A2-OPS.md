# AWJ-ERP-UI-H2 · A2 audit · group OPS (POS, inventory, purchases)

> **Committed evidence:** the curated images of this report are under [`a2/ops/`](a2/ops/) (JPEG, at most 1100 px wide). References to `shots/`, `run.log`, `*.jsonl`, `wf*/` or `out-states/` point to the full local run, kept outside git for size; it is reproducible with [`tools/`](tools/README.md). The auditor's report is kept verbatim apart from evidence paths.

- **Run:** 2026-10-15, local isolated environment (web on :3001, production build; API on :8000).
- **Surface:** v3, Arabic, 1440 light, unless noted.
- **Paths:** evidence images are relative to `ops/` (for example `evidence/01-….jpg`). `shots/` holds all screenshots; `run.log` is the step log.
- **Tag:** every record I created is tagged `H2-A2-OPS`.
- **Format:** each finding gives Observed (fact) separately from Direction (suggestion only).

## 1. Screens covered and not covered

**Exercised with my own browser runs:**
- **POS:**
  - `/pos` workspace, at 1440, 1280×720, 1024×768 and 390, and in English dark mode.
  - `/pos/start`, `/pos/sessions`, `/pos/sessions/:id`, `/pos/report`, `/pos/audit`.
  - `/pos/settings`, plus its `devices`, `shifts`, `configuration`, `cash-drawer` and `sound-feedback` pages; `printing` redirects to `configuration`.
- **Products:** `/products` (search, sort, filters, export dialog), `/products/new`, `/products/:id/edit` (variants, extra barcode, unit template).
- **Inventory:**
  - `/inventory-openings/import` (preview, draft and post), `/inventory-openings/:id`.
  - `/warehouses`, `/warehouses/new`, `/warehouses/:id/stock`.
  - `/stock-permits/new`, `/stock-permits/:id`, `/stocktaking/new`, `/stocktaking/:id`.
  - `/inventory`, `/inventory-settings/units`.
- **Purchases:**
  - Purchase request, RFQ, quote and order detail pages.
  - `/purchases/:id` (posting) and `/purchases/:id/payments/new`.
  - The return dialog, `/debit-notes/new`, which opens as `/credit-notes/:id` after saving.
  - `/supplier-refunds` and its detail page, `/supplier-payments`, and the supplier statement and ledger.
  - `/purchase-settings`; on `/purchases/new` only empty-form validation was run.
- **Roles:** 20 routes as `staff` and as `staff-scoped` (branch «فرع الخبر» only).

**Covered only from the baseline atlas and state probe:**
- `/products/:id`, `/products/import`, `/products/workbook-import`.
- `/inventory-openings`, `/inventory-settings`, and its `brands`, `categories` and `products` pages.
- The PO, PQ and RFQ new-document pages and their lists, `/purchases` and `/purchases/:id/edit`, `/suppliers`, `/purchase-returns`, `/debit-notes`.

**Not covered:** `/warehouses/:id`, the legacy surface, 200% zoom and the Ink theme (time).

## 2. State matrix

Legend: OK · ISSUE (finding id) · N/A · NV (not verified). Empty, loading, error and forbidden come from `out-states` plus my own probes; the other columns come from my runs.

| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /pos workspace | OK | OK | OK | NV (staff gets 403 before the workspace) | N/A | ISSUE 11 | OK | ISSUE 22 |
| /pos/start | ISSUE 27 | OK | OK | OK | N/A | ISSUE 27 | OK | N/A |
| /pos/sessions | OK | OK | OK | OK | N/A | N/A | OK | NV |
| /pos/sessions/:id | N/A | NV | NV | NV | OK | N/A | ISSUE 20 | ISSUE 34 |
| /pos/report | OK | OK | OK | OK | OK | N/A | OK | ISSUE 19 |
| /pos/audit | OK | OK | OK | OK | N/A | N/A | ISSUE 20 | ISSUE 34 |
| /pos/settings/devices | OK | OK | OK | OK | N/A | ISSUE 16 | OK | NV |
| /pos/settings/shifts | OK | NV (no skeleton) | ISSUE 12 | OK | N/A | ISSUE 16 | OK | NV |
| /products | OK | OK | OK | OK | N/A | N/A | OK | NV (only 6 products) |
| /products/new | N/A | OK | OK | OK | N/A | ISSUE 16 | OK | N/A |
| /products/:id/edit | N/A | NV | NV | NV | N/A | ISSUE 16, 08, 30 | OK | N/A |
| /warehouses (+new) | OK | OK | ISSUE 12 | OK | N/A | ISSUE 16 | OK | NV |
| /warehouses/:id/stock | NV | NV | NV | ISSUE 32 | N/A | N/A | OK | NV |
| /inventory | OK | OK | OK | OK | N/A | N/A | OK | NV |
| /stock-permits (+new, :id) | OK | OK | ISSUE 12 | OK | OK | ISSUE 14 | OK | NV |
| /stocktaking (+new, :id) | OK | OK | ISSUE 12 | OK | OK | ISSUE 13 | OK | NV |
| /inventory-openings (+import, :id) | OK | OK | OK | OK | OK | ISSUE 09, 15 | OK | NV |
| /purchase-requests | OK | OK | ISSUE 12 | OK | OK | ISSUE 16 (message stays after a valid line) | OK | NV |
| /rfq | OK | OK | ISSUE 12 | OK | ISSUE 07 | OK | OK | NV |
| /purchase-quotes, /purchase-orders | OK | OK | ISSUE 12 | OK | OK | ISSUE 16 | OK | NV |
| /purchases (+new, :id) | OK | OK | OK | OK | OK | ISSUE 16 | OK | NV |
| /purchases/:id/payments/new | N/A | NV | NV | NV | N/A | ISSUE 16 | OK | N/A |
| /purchase-returns + dialog | OK | OK | ISSUE 12 | OK | OK | ISSUE 08 | OK | NV |
| /debit-notes | OK | OK | ISSUE 12 | OK | OK | ISSUE 21 | OK | NV |
| /supplier-refunds | OK | OK | ISSUE 12 | ISSUE 12 | OK | ISSUE 08 | OK | NV |
| /supplier-payments | OK | OK | OK | OK | N/A | N/A | OK | NV |
| supplier statement and ledger | N/A | NV | NV | NV | N/A | N/A | OK | ISSUE 03 |

## 3. Workflows

| # | Workflow | Clicks and steps | Result | Findings | Evidence |
|---|---|---|---|---|---|
| 1a | Set up a POS device and shift | 2 dialogs, 6 fields | OK. The two success messages are worded differently. | 27, 36 | `shots/pos-s2/s3` |
| 1b | Open a session with a 500 cash float | 3 fields, 1 click; the sale screen opens in a new tab | OK (POS-2026-00001). Typing «abc» or «-5» disables submit with no reason given. | 27 | `shots/pos-o0`, `shots/pos-o3` |
| 1c | Search `FLT-1` (F4, type, Enter), then scan `OIL-HD-20` with nothing focused | F4 plus 2 entries | OK. Scanning while a tile has focus adds two items (finding 04). | 04 | [`02`](a2/ops/02-pos-scan-with-tile-focused-double-add.jpg) |
| 1d | Raise the line quantity, then a line discount of 5.00 | about 6 | OK. The line comes to 82.23. The quantity buttons are labelled as "return" quantity buttons. | 21 | `shots/pos-f3`, `shots/pos-f6` |
| 1e | Hold the sale, open held sales (F6), resume | 3 | OK. The held-sale card has no amount. | 24 | `shots/pos-f8`, `shots/pos-f9` |
| 1f | Pay: F9, cash, 700, confirm | 4 | **Blocked.** First the screen demands a registered customer; after choosing one, checkout returns 422. | 01, 11 | [`01`](a2/ops/01-pos-checkout-422-no-visible-error.jpg), [`04`](a2/ops/04-pos-customer-required-only-at-confirm.jpg) |
| 1g | Pay for my own product (with unit template and opening stock) | 7 | **Succeeded.** INV-2026-00008, total 45.98, change 4.02. The receipt opened. | 22, 19 | [`05`](a2/ops/05-pos-receipt-old-riyal-sign-no-change.jpg) |
| 1h | Close the session with 540 counted | 5 | Closed with a shortage of −5.98; then redirected to the dashboard. | 10, 20 | [`07`](a2/ops/07-pos-close-session-no-difference-iso-date.jpg), [`08`](a2/ops/08-pos-overflow-menu-clipped.jpg) |
| 2 | Product with variants and an extra barcode, then edit | Create, then a redirect to the list; reopen edit; add the option; add 2 values; generate variants; add the barcode; save. About 14 clicks. | OK (OPS-SHIRT). | 08, 21, 26, 30, 06 | `shots/prod-e*`, [`13`](a2/ops/13-product-option-value-button-mislabelled.jpg) |
| 3 | Inventory opening from a CSV | 5 | The mixed file previewed. The variant parent passed preview, then posting failed. The clean file posted OPN-2026-00001 for 612.50. | 02, 09, 15 | [`09`](a2/ops/09-opening-post-no-confirm-variant-error.jpg), [`10`](a2/ops/10-opening-preview-counters-wrong.jpg), `shots/io-ok-posted` |
| 4 | Transfer 5 units from the main warehouse to the sub-warehouse, then post | about 7 | OK, ST-2026-00001 for 61.25. | 02, 14 | `shots/sp-t2/t4/t6` |
| 5 | Stocktake: open, count 4, save, post | 5 | OK, STK-2026-00001: −1 unit, −12.25. | 02, 13 | [`11`](a2/ops/11-stocktake-no-value-before-post.jpg) |
| 6 | Purchase request → RFQ → quote → order → purchase invoice → post → supplier payment | about 20 | The RFQ step is a dead end (finding 07). I continued with a quote created directly: PQ → PO → BILL-2026-00003 for 142.60, then PAY-2026-00001 for 100. | 07, 28, 16 | [`12`](a2/ops/12-rfq-dead-end-supplier-required.jpg), `shots/pr-*`, `pq-*`, `po-*`, `bill-act-1-dialog`, `pay-*` |
| 7 | Purchase return (2 units), debit note, supplier refund | 3 short flows | PRET-2026-00001 28.52, DN-2026-00001 23.00 and SRF-2026-00001 28.52, all posted. | 02, 03, 08, 21 | `shots/ret-*`, `dn-*`, `sr-*` |

**Keyboard-only use of POS:** F4, typing, Enter, the scanner, F6, F7 and F9 all work. When the payment screen opens, keyboard focus stays on the page body, so choosing a payment method and confirming needs Tab or a pointer (finding 24).

## 4. Number parity

Every number checked matched the API, formatted with `formatRiyal` and the U+20C1 sign, except finding 03:
- INV-2026-00008: 39.98, 6.00 and 45.98.
- Session POS-2026-00001: 500.00, 545.98, 540.00 and −5.98.
- Opening 612.50 and stock permit 61.25. For the permit, the UI multiplies quantity by unit cost itself, because the API's line `total_cost` is empty.
- Stocktake −12.25.
- PR, PQ, PO and BILL: 124.00, 18.60 and 142.60; after the payment, paid 100.00 and remaining 42.60.
- Return 28.52, debit note 23.00, refund 28.52.
- The product list: prices for all 6 products and the stock figure of 55.

The POS cart total is calculated in the browser (`page.tsx:1166`) and matched the server for every cart I tested.

## 5. Consistency notes
- **Confirmation before posting:**
  - Only the purchase invoice asks for confirmation before posting.
  - The opening, permit, stocktake, debit note and refund post without asking, and the purchase return posts the moment it is created (finding 02).
- **Form validation follows four patterns:**
  1. A disabled submit with no reason: purchase invoice, PO and PQ new pages; new warehouse; units, categories and brands; POS start; the device and shift dialogs.
  2. A form-level red line, «أضف سطراً واحداً على الأقل بسعر صحيح»: PR, RFQ, stock permit and debit note. On the PR page the line stays visible after the form becomes valid.
  3. The server's English message in a toast: product creation.
  4. A bare «تعذّر الحفظ»: the purchase payment.
- **Lists:** `/supplier-refunds` lacks the branch filter, sorting, paging and advanced filter that every other purchase list has. Debit notes are created on a separate page; returns and refunds are created in dialogs.
- **Procurement documents vs the purchase invoice:**
  - PR, RFQ, PQ and PO use a simple form with no warehouse, payment terms or totals panel.
  - `/purchases/new` is the full document workspace.
  - The invoice generated from the PO has no warehouse (`warehouse_id: null`).
- **Product images:** the create page uses a browser-default file picker in English. The edit page uses the designed uploader, with a 553 px empty drop area.
- **Money formats:**
  - Most screens use `formatRiyal` with the U+20C1 sign.
  - `/pos/report` uses the short format («200 ⃁»).
  - The POS receipt and the debit-note document use the old ﷼ sign.
  - The payment form adds «SAR».
- **Success messages:** most actions show «تم التحديث بنجاح»; the opening and the payment use their own wording.

## 6. Findings

**H2-OPS-01 · P0 · POS checkout fails for any product without a unit template**
- **Observed:**
  - The cart sends the unit name `"piece"` (or «حبة»), and `POST /pos/checkout` returns 422 «الوحدة «piece» غير متاحة: لا قالب وحدات على المنتج «Filter».».
  - All 4 seeded products, and a product I created in the UI, fail this way.
  - A sale went through only after I attached a unit template.
  - At 1440×900 no error appears on screen; the message exists only in the page code.
  - In the backend, `UnitConversion::resolve` rejects any unit name when there is no template. The delivery-note path maps the product's own base unit to `null`; the POS path does not.
- **Evidence:** [`01-pos-checkout-422-no-visible-error`](a2/ops/01-pos-checkout-422-no-visible-error.jpg), `run.log`
- **Why it matters:** POS cannot complete a sale for the default kind of product.
- **Direction:** send `null` for the base unit, or resolve it on the server; show the checkout error inside the payment pane.

**H2-OPS-02 · P0 · Irreversible inventory and purchase actions run without confirmation**
- **Observed (one click, no dialog, no browser confirm):**
  - Opening: «ترحيل المستند», and «حذف المسودة», which deletes immediately.
  - Stock permit: «ترحيل».
  - Stocktake: «ترحيل الفرق».
  - Debit note: «ترحيل».
  - Purchase return: «ترحيل فوري» is checked by default, so «إنشاء» creates and posts at once.
  - Supplier refund: «ترحيل».
  - The purchase invoice does show a confirmation dialog.
- **Evidence:** `run.log` («NO dialog»), [`09`](a2/ops/09-opening-post-no-confirm-variant-error.jpg), `shots/sp-t5`, `shots/stk-3`, `shots/io-del-confirm`, `shots/bill-act-1-dialog` (the dialog that exists)
- **Why it matters:** posting changes stock and the ledger, and undoing it needs a reversing entry; a deleted draft cannot be recovered.
- **Direction:** use the purchase invoice's confirmation dialog for every post and delete; make immediate posting opt-in.

**H2-OPS-03 · P0 · The supplier statement and ledger omit a posted supplier refund**
- **Observed:**
  - The page requests `/reports/partner-statement/:id?partner_role=supplier`, which returns 4 rows with a closing balance of 8.92.
  - Without the role filter, the API returns 5 rows, including JE-2026-00034 «استرداد مورّد SRF-2026-00001» (a 28.52 credit to account 2110 with the partner set), and a closing balance of −19.60.
  - The screen labels 8.92 «الرصيد الدائن الختامي» (closing credit balance), but 8.92 is a debit position.
- **Evidence:** `run.log`, `shots/sup-statement-recheck.png`, `shots/sup-ledger-recheck.png`
- **Why it matters:** the supplier's balance is wrong on a financial statement.
- **Direction:** fix the backend role filter so it includes refund journal entries; review the closing-balance label and its sign.

**H2-OPS-04 · P1 · A barcode scan while a tile has focus adds two items**
- **Observed:** I tapped «ديزل 91 لتر» and then scanned `FLT-1`. The cart now held Filter ×1 and diesel ×2: the Enter at the end of the scan also activated the focused tile.
- **Evidence:** `evidence/02-…`
- **Why it matters:** the cart silently gains an item, so the customer is overcharged.
- **Direction:** have the scanner consume its final Enter, or move focus off the tile after a tap.

**H2-OPS-05 · P1 · The amount due is invisible on the payment screen below 1024 px**
- **Observed:** the 36 px total is drawn in `rgb(242,246,253)` on a white card in the mobile summary. The dark "outcome" surface is applied to a hidden 0×0 element instead.
- **Evidence:** `evidence/03-…`
- **Why it matters:** fails WCAG 1.4.3 contrast; cashiers on phones or portrait tablets cannot read what is owed.
- **Direction:** give the visible summary the dark background, or use normal text color on the white card.

**H2-OPS-06 · P1 · A priced extra barcode adds the variant at the wrong price**
- **Observed:**
  - Barcode 6281000000024 is set to the «أحمر» variant at 80.00, and the variant picker shows 80.00.
  - Scanning it adds the item at 75.50.
  - Checkout then returns 422 «سعر المنتج لا يطابق قائمة السعر…».
- **Evidence:** `shots/pos-g1-variant-scan.png`, `shots/pos-k1-variant-picker.png`
- **Why it matters:** the cart shows a price the server will refuse, and the sale cannot complete.
- **Direction:** price scanned barcodes from the same source the variant picker uses.

**H2-OPS-07 · P1 · The RFQ is a dead end**
- **Observed:** «تسجيل عرض مورّد» returns 422 «هذا المستند يلزمه مورّد محدَّد.», but the RFQ has no supplier field (neither on `/rfq/new` nor on the detail page) and no edit action.
- **Evidence:** `evidence/12-…`
- **Why it matters:** the purchase request → RFQ → quote path cannot be completed.
- **Direction:** collect the supplier on the RFQ, or when recording the quote.

**H2-OPS-08 · P1 · Form controls without accessible names (WCAG A 4.1.2)**
- **Observed:**
  - The delete (trash) button on each variant row has no name.
  - In the purchase return dialog, the price and tax % inputs have no name.
  - In the refund dialog, the allocation input has no name.
  - Stocktake count inputs are named only by their placeholder «لم يُعدّ», so a screen reader cannot tell which product each count belongs to.
  - The baseline crawl missed these: the seeded products have no variants, and the dialogs were closed.
- **Evidence:** `run.log` (w_prod8, w_ret2, w_sr2)
- **Direction:** add labels that include the row's product or variant name.

**H2-OPS-09 · P1 · Opening stock for variant products: preview passes, posting fails**
- **Observed:**
  - The preview marks parent SKU `OPS-SHIRT` as «صالح» (valid).
  - Posting then returns 422 «…المنتج الأب … مُدار بالمتغيّرات — حدّد المتغيّر».
  - The variant SKU itself is reported as «لا يوجد صنف بهذا الرمز» (no product with this code).
- **Evidence:** [`09`](a2/ops/09-opening-post-no-confirm-variant-error.jpg), [`10`](a2/ops/10-opening-preview-counters-wrong.jpg)
- **Why it matters:** variant stock cannot be opened through the wizard, and the preview claims a row is valid when it is not.
- **Direction:** apply the posting rule during preview; accept variant SKUs.

**H2-OPS-10 · P1 · Closing a session with no visible difference and no confirmation**
- **Observed:**
  - The close dialog shows «المتوقع 545.98». After I entered 540 it showed no difference, and the submit button closed the session straight away.
  - The API recorded a −5.98 shortage.
  - The app then jumped to the dashboard with no Z report.
  - The opening time is shown raw: «2026-10-15T16:19:05+00:00».
- **Evidence:** [`07`](a2/ops/07-pos-close-session-no-difference-iso-date.jpg)
- **Why it matters:** a cash shortage is submitted without the cashier ever seeing it.
- **Direction:** show the live over/short amount, confirm when it is not zero, and land on the session's Z report.

**H2-OPS-11 · P2 · A walk-in sale needs a customer, but you only learn this at confirm**
- **Observed:**
  - The confirm button is enabled, yet clicking it opens the customer picker with «اختر عميلاً مسجلاً قبل تأكيد الدفع.».
  - The held-sales list calls the same cart «عميل نقدي» (walk-in customer).
  - The POS config holds the default-customer label «عميل نقدي (POS)», but no default customer is actually assigned (its id is null).
- **Evidence:** [`04`](a2/ops/04-pos-customer-required-only-at-confirm.jpg)

**H2-OPS-12 · P2 · Lists show "no records" when the server errors (500) or refuses access (403)**
- **Observed:**
  - With a simulated 500, these lists show the normal "empty" screen with a create button:
    - purchase orders, quotes, requests, RFQs and returns
    - debit notes and supplier refunds
    - stock permits and stocktakes
    - suppliers, warehouses and POS shifts
  - Products, purchases, inventory, supplier payments and POS sessions correctly show an error with a retry button.
  - Staff on `/supplier-refunds` get a 403 that is shown as empty, with a create button.
- **Evidence:** [`15`](a2/ops/15-list-500-shown-as-empty.jpg), [`16`](a2/ops/16-staff-403-shown-as-empty-with-cta.jpg)
- **Direction:** run all lists through the shared error / forbidden / empty handling.

**H2-OPS-13 · P2 · Stocktake review hides the money impact until after posting**
- **Observed:** before posting, the value column shows «—» and the net difference shows 0.00; −12.25 appears only once posted. «المعدود 1 / 1» is ambiguous.
- **Evidence:** [`11`](a2/ops/11-stocktake-no-value-before-post.jpg)
- **Direction:** show a provisional value at review time.

**H2-OPS-14 · P2 · Stock permit draft shows cost 0.00, and quantities above stock are not flagged**
- **Observed:**
  - The form showed 61.25, but the saved draft shows cost 0.00.
  - Entering 999 when only 48 are available raises no warning.
- **Evidence:** `shots/sp-t2`, `shots/sp-t4`, `shots/sp-t6`

**H2-OPS-15 · P2 · Opening preview counters contradict the rows**
- **Observed:** the counter «أصناف غير موجودة» shows 0 while two rows say the product was not found; the API also reports 0.
- **Evidence:** [`10`](a2/ops/10-opening-preview-counters-wrong.jpg)

**H2-OPS-16 · P2 · Validation feedback is inconsistent and sometimes untranslated**
- **Observed:**
  - There are four different patterns (section 5).
  - Creating a product with bad prices shows «The sale price field is required. (and 1 more error)» in English, with no field marked.
  - An overpayment shows only «تعذّر الحفظ» (could not save).
- **Evidence:** [`14`](a2/ops/14-product-create-english-server-validation.jpg), `shots/pay-2-overpay.png`, `shots/valid-*.png`

**H2-OPS-17 · P2 · Arabic labels in the numeric font lose their letter joining**
- **Observed:** these Arabic texts are set in the monospaced number style, so the letters come apart:
  - «المبلغ بالضبط», «نفد المخزون»
  - «الرقم الضريبي:», «المتوقع:»
  - «0 من 8 صور محددة»
- **Evidence:** [`05`](a2/ops/05-pos-receipt-old-riyal-sign-no-change.jpg), [`06`](a2/ops/06-pos-1280x720-result-strip-offscreen.jpg), `shots/pos-k1-variant-picker.png`
- **Direction:** apply the numeric style to the digits only.

**H2-OPS-18 · P2 · Minus signs end up on the wrong side of the number**
- **Observed:**
  - The POS discount shows as «5.00-» (and in green).
  - The stocktake difference shows as «1-», and «12.25-» wraps at 390.
  - FOUNDATIONS §5 rule 5 requires the sign to sit inside the number's direction isolation.

**H2-OPS-19 · P2 · Money formatting differs from the standard formatter**
- **Observed:**
  - The receipt and the debit-note document use «45.98 ﷼» with the old sign.
  - `/pos/report` shows «200 ⃁» and «0 ⃁» in short format.
  - The payment form adds «SAR».
  - The values are right; only the format differs.
- **Evidence:** [`05`](a2/ops/05-pos-receipt-old-riyal-sign-no-change.jpg), `shots/dn-2-saved.png`

**H2-OPS-20 · P2 · Raw codes and untranslated text in the Arabic UI**
- **Observed:**
  - The default unit `piece` appears as-is in the cart, payment screen and receipt.
  - The session timeline shows English event codes: «cart created», «item added», «item quantity changed».
  - The procurement change log shows raw statuses: draft → submitted → approved.
  - `/pos/audit` displays the raw key `posAudit.eventLabels.session_handover_submitted`.
  - Dates appear in ISO format.
- **Evidence:** `shots/c-sess-0.png`, [`12`](a2/ops/12-rfq-dead-end-supplier-required.jpg)

**H2-OPS-21 · P2 · Wrong or copied labels**
- **Observed:**
  - The button that adds an option value reads «إضافة منتج» (add product).
  - The supplier dropdowns on PO, PQ and debit note say «اختر العميل» (choose customer).
  - A debit-note type reads «تخفيض ذمة العميل» (reduce the customer's balance).
  - The sale quantity buttons are named «إنقاص/زيادة كمية المرتجع», i.e. return quantity (`page.tsx:1968`).
  - The warehouse's branch field is labelled «إدارة الفروع».
  - The debit-note document footer claims it is a ZATCA e-invoice.
  - A saved debit note opens at `/credit-notes/:id`.
- **Evidence:** [`13`](a2/ops/13-product-option-value-button-mislabelled.jpg), `shots/dn-2-saved.png`

**H2-OPS-22 · P2 · POS payment and result layout at common screen heights**
- **Observed:**
  - At 1440×900 the sticky confirm bar cuts off the Paid / Remaining / Change strip; at 1280×720 the quick amounts and the whole strip are below the fold.
  - Notifications appear at the bottom-start corner and cover the Pay button and total.
  - The success screen shows neither the amount paid nor the change, and «طباعة» (print) is the main action rather than «بيع جديد» (new sale).
  - The cart shows «1 × 25.50» next to 29.33 with no hint that tax is included, and there is no subtotal / discount / tax block before payment.
- **Evidence:** [`06`](a2/ops/06-pos-1280x720-result-strip-offscreen.jpg), `shots/pos-f10-payment.png`, `shots/pos-w3-scan-oil.png`, [`05`](a2/ops/05-pos-receipt-old-riyal-sign-no-change.jpg)

**H2-OPS-23 · P2 · POS search box and menu at the edges**
- **Observed:**
  - At 390 the search box shrinks to 43 px.
  - The ⋯ overflow menu runs off the left edge at 1440 in RTL.
- **Evidence:** `shots/pos-r-390-cart.png`, [`08`](a2/ops/08-pos-overflow-menu-clipped.jpg)

**H2-OPS-24 · P2 · Payment entry and held sales**
- **Observed:**
  - When the payment screen opens, focus stays on the page body and the default method is «بطاقة ائتمان» (credit card).
  - Held-sale cards show no amount.
  - «4 وحدة» uses the wrong plural.

**H2-OPS-25 · P2 · An out-of-stock tile can still be added to the cart**
- **Observed:**
  - A tile marked «نفد المخزون» adds to the cart and fails only at checkout.
  - The Floor contract (§6.2) says such a tile should be disabled, with the reason shown.
- **Evidence:** `shots/pos-k2-after-confirm.png`

**H2-OPS-26 · P2 · Creating a product with variants takes extra trips**
- **Observed:**
  - After create, the app goes to the product list, not the new product.
  - Variants require «احفظ المنتج أولاً» (save first), so the user must find the product again.
  - The create page's image picker is a browser default in English; the edit page has the designed uploader with a 553 px empty drop area.
  - «التراجع عن المتغيّرات» (undo variants) looks like plain text, not a button.

**H2-OPS-27 · P2 · `/pos/start` dead end and silent form**
- **Observed:**
  - With no device or shift set up, the page explains the problem but gives no link to settings.
  - An invalid cash float disables the button without saying why.
  - The card sits low on the page.
- **Evidence:** `shots/x-_pos_start.png`, `shots/pos-o0-invalid-cash.png`

**H2-OPS-28 · P2 · Procurement status changes are click-heavy and silent**
- **Observed:**
  - It takes 11 status clicks before a purchase invoice exists.
  - Every change shows the same message, «تم التحديث بنجاح», and none asks for confirmation.
  - The invoice generated from the PO has no warehouse.

**H2-OPS-29 · P2 · `/supplier-refunds` does not follow the list pattern**
- **Observed:**
  - The page has no branch filter, sorting, paging or advanced filter.
  - The page title and the sidebar label also differ.

**H2-OPS-30 · P2 · Variant controls are too small (WCAG 2.5.8)**
- **Observed:** the variant color/appearance edit control is 20×16 px and the remove control is 20×20 px.

**H2-OPS-31 · P2 · POS product tile names start with the company name**
- **Observed:**
  - Screen readers hear each tile as «نبراس الطموح aFilter25.50 ⃁», because the company name comes from the placeholder image's alt text.
  - The variant picker shows the company name as visible text.

**H2-OPS-32 · P2 (owner decision) · Branch-restricted staff can read another branch's warehouse stock**
- **Observed:**
  - Staff limited to «فرع الخبر» can see the main branch's warehouses and their stock (51 units).
  - Warehouses are company-wide by design, so this is not a leak under the current rules.
  - Purchase and stock documents are correctly hidden from this user.

**H2-OPS-33 · P2 · An out-of-scope document link shows a useless retry**
- **Observed:** branch-restricted staff opening another branch's purchase invoice see «تعذّر تحميل الفاتورة» with a retry button that cannot help, and no page heading.

**H2-OPS-34 · P2 · Long event logs are not paginated**
- **Observed:** the session detail page is 4,790 px tall, and the `/pos/audit` page lists every event in one go.

**H2-OPS-35 · P2 · Other Floor-posture gaps**
- **Observed:**
  - The cart has no subtotal / discount / tax block.
  - Discounts are shown in green.
  - The profile avatar shows «ال», the first two letters of «المالك».

**H2-OPS-36 · P3 · Polish bundle**
1. Success messages are worded differently for the same action.
2. Wrong plurals: «5 نتيجة», «3 صف».
3. «محوّل من» (converted from) appears twice on detail pages.
4. Variant picker prices have no currency sign.
5. The product edit page has several primary-style buttons.
6. The opening number was reused after a draft was deleted (by design).
7. The return dialog gives no link to the new return.
8. The «المبلغ بالضبط» (exact amount) pill is wider than the others.
9. The «تفاصيل الجلسة» link is only 16 px tall.

## 7. Isolation and roles

- **Tenant B:** its canary partner never appeared in any supplier dropdown, customer picker or list.
- **Staff with no branch restriction:** sees all of tenant A, which is correct by design.
  - POS shows a localized "no permission" state.
  - `/supplier-refunds` shows a 403 as an empty list (finding 12).
- **Staff restricted to «فرع الخبر»:** sees none of the main branch's documents.
  - Company-wide warehouse stock is still visible (finding 32).
  - Opening a document by direct link shows a generic retry (finding 33).

## 8. Records created in tenant A (all tagged `H2-A2-OPS`)

- **POS setup:** device OPS1 and shift OPSAM.
- **POS sessions:**
  - POS-2026-00001: closed with a −5.98 shortage; manager approval still pending.
  - POS-2026-00002: closed.
- **POS sale:** INV-2026-00008, 45.98.
- **Products and units:**
  - OPS-SHIRT (two variants, extra barcode).
  - OPS-BRK-1.
  - One unit template.
- **Opening:** OPN-2026-00001 posted. An earlier draft was deleted.
- **Warehouse:** 00002.
- **Stock documents:**
  - Stock permit ST-2026-00001, posted.
  - Stocktake STK-2026-00001, posted.
  - STK-2026-00002: an **unintended draft** on the main warehouse, created by my validation probe because opening a count sheet saves it immediately.
- **Purchasing:**
  - PR-2026-00001.
  - RFQ-2026-00001 (stuck).
  - PQ-2026-00001 → PO-2026-00001 → BILL-2026-00003, posted.
- **Payments, returns and notes (all posted):** PAY-2026-00001, PRET-2026-00001, DN-2026-00001, SRF-2026-00001.
- **Re-saved with unchanged values:** purchase settings and POS configuration.

## 9. Not verified

- **Not run (time):** the legacy surface, 200% zoom and the Ink theme.
- **POS features not exercised:** returns and exchange, cash drawer (no bridge), sound, offline, printing, handover and variance approval.
- **Staff selling in POS:** not possible, because staff get 403 on devices and shifts.
- **Not executed:** the product import wizards and checking an exported file.
- **Many rows:** the seed is too small for many-row and pagination checks in this group.

## Evidence index (committed)

- [`01-pos-checkout-422-no-visible-error.jpg`](a2/ops/01-pos-checkout-422-no-visible-error.jpg)
- [`02-pos-scan-with-tile-focused-double-add.jpg`](a2/ops/02-pos-scan-with-tile-focused-double-add.jpg)
- [`03-pos-390-amount-due-invisible.jpg`](a2/ops/03-pos-390-amount-due-invisible.jpg)
- [`04-pos-customer-required-only-at-confirm.jpg`](a2/ops/04-pos-customer-required-only-at-confirm.jpg)
- [`05-pos-receipt-old-riyal-sign-no-change.jpg`](a2/ops/05-pos-receipt-old-riyal-sign-no-change.jpg)
- [`06-pos-1280x720-result-strip-offscreen.jpg`](a2/ops/06-pos-1280x720-result-strip-offscreen.jpg)
- [`07-pos-close-session-no-difference-iso-date.jpg`](a2/ops/07-pos-close-session-no-difference-iso-date.jpg)
- [`08-pos-overflow-menu-clipped.jpg`](a2/ops/08-pos-overflow-menu-clipped.jpg)
- [`09-opening-post-no-confirm-variant-error.jpg`](a2/ops/09-opening-post-no-confirm-variant-error.jpg)
- [`10-opening-preview-counters-wrong.jpg`](a2/ops/10-opening-preview-counters-wrong.jpg)
- [`11-stocktake-no-value-before-post.jpg`](a2/ops/11-stocktake-no-value-before-post.jpg)
- [`12-rfq-dead-end-supplier-required.jpg`](a2/ops/12-rfq-dead-end-supplier-required.jpg)
- [`13-product-option-value-button-mislabelled.jpg`](a2/ops/13-product-option-value-button-mislabelled.jpg)
- [`14-product-create-english-server-validation.jpg`](a2/ops/14-product-create-english-server-validation.jpg)
- [`15-list-500-shown-as-empty.jpg`](a2/ops/15-list-500-shown-as-empty.jpg)
- [`16-staff-403-shown-as-empty-with-cta.jpg`](a2/ops/16-staff-403-shown-as-empty-with-cta.jpg)
