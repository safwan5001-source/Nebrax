# Web test results — Vitest and Playwright at the audited commit

Audited commit `0534ef16543b01c69b416b58897337e012a9d1ab`. Added in the review round of PR #1290 in answer to the comment that the report wrongly said `web/` has no automated UI tests. **A passing UI suite is not evidence of regulatory compliance**: the Vitest tests run in jsdom and the Playwright specs run on an in-bundle mock API, not against a live backend.

## 1. Summary

| Suite | Scope | Tests | Passed | Failed | Skipped | Where it ran |
|---|---|---:|---:|---:|---:|---|
| Vitest 2.1.9 (jsdom / node) | the whole suite — `npm run test` (`vitest run`) | 4 117 in 445 files | 4 117 | 0 | 0 | sandbox, 184.26 s; **CI (`Web CI`, run 38049588265) at the same commit: same counts, 150.9 s** |
| Playwright 1.62.1 (Chromium; desktop 1440×960 and mobile 390×844 projects) | 17 of the 66 specs in `web/e2e` (selection in §3) | 216 | 194 | 15 | 7 | sandbox only — the Playwright suite is not part of the default CI. Counts are the **first run**; after the failing tests were re-run alone, 195 passed and 14 failed (one intermittent failure passed on re-run) |

The audited checkout was not written to: the web tests ran in a detached `git worktree` of the audited commit (`npm ci` from `web/package-lock.json`, 294 packages; Node v22.22.0, npm 10.9.4). Playwright used the sandbox Chromium (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`) against `next dev -p 3001`, with `--timeout=120000` (the config default is 30 s). No test, source file or configuration was modified; the screenshots and reports the specs write were produced inside the scratch worktree and discarded with it.

## 2. Vitest — the files relevant to the audit (by topic)

The whole suite passed (4 117 tests). The 56 files below (534 tests) are the ones that touch invoices, tax documents, labels, export/print, POS receipts, e-invoice settings, tax arithmetic, purchases and reports; every Vitest test cited in `web-test-mapping.md` was looked up in the result file and passed. Counts are per file.

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

## 3. Playwright

### 3.1 Selection

All 66 specs run in Demo Mode (an in-bundle mock API switched on by `localStorage.demo = "true"`, `web/src/lib/api.ts:79`) or on dev fixture routes, so none needs the PHP backend and none can reproduce a backend-driven defect (the 403 of PH1-03, SUB-01, PH2-07, …). The selection covers the screens that show or produce tax documents and the flows around them: invoice and purchase detail, the invoice/purchase workspaces of the AWJ v3 shell (lifecycle rail, totals dock, themes, postures, hardening), document QA / operations / review, delivery notes, POS checkout/session/mode/workspace, reports (33 routes including the tax report) and the dashboard. The `cust-*`, `flowers-*`, `store-brand-qa`, `help-center` and the remaining POS visual-proof specs concern the storefront customizer, flowers commerce and screenshots, and were not run.

### 3.2 Results by spec

"First run" = the batch run; "isolated re-run" = the failing specs re-run on their own, each with a fresh dev server (§3.3). Skips are the specs' own `test.skip` conditions for the mobile project (desktop-only tests).

| Spec | Tests (desktop + mobile) | First run: passed · failed · skipped | After isolated re-run: passed · failed · skipped | Tax relevance |
|---|---:|---|---|---|
| `e2e/document-qa.spec.ts` | 10 | 7 · 2 · 1 | 7 · 2 · 1 | A4 document QA matrix, PDF export: CON-06, CON-09 |
| `e2e/invoice-detail-interactions.spec.ts` | 2 | 2 · 0 · 0 | not re-run | invoice detail menu: PH1-10, SUB-01 context |
| `e2e/purchase-detail-interactions.spec.ts` | 6 | 6 · 0 · 0 | not re-run | purchase detail |
| `e2e/dashboard-main-contracts.spec.ts` | 4 | 4 · 0 · 0 | not re-run | dashboard |
| `e2e/delivery-notes.fixture.spec.ts` | 20 | 20 · 0 · 0 | not re-run | delivery notes → invoice draft: VAT-09 context |
| `e2e/document-operations.spec.ts` | 6 | 6 · 0 · 0 | not re-run | Document Center operations (supplier-document intake): PH1-16 display |
| `e2e/document-review.spec.ts` | 6 | 1 · 5 · 0 | 1 · 5 · 0 | Document Center review → purchase/expense draft |
| `e2e/pos-checkout-reliability.spec.ts` | 2 | 0 · 1 · 1 | 0 · 1 · 1 | POS checkout (no receipt/QR assertion) |
| `e2e/pos-dedicated-workspace.spec.ts` | 6 | 3 · 0 · 3 | not re-run | POS workspace |
| `e2e/pos-interaction-mode.spec.ts` | 2 | 0 · 1 · 1 | 0 · 1 · 1 | POS input modes |
| `e2e/pos-session-cart-recovery.spec.ts` | 2 | 0 · 1 · 1 | 0 · 1 · 1 | POS session and cart |
| `e2e/reports.spec.ts` | 70 | 66 · 4 · 0 | 66 · 4 · 0 | reports incl. `/reports/general/tax-report`: ACC-03/04 smoke only |
| `e2e/awj-v3-gate.spec.ts` | 3 | 3 · 0 · 0 | not re-run | v3 gate (desktop project only) |
| `e2e/awj-v3-h2-workspaces.spec.ts` | 14 | 14 · 0 · 0 | not re-run | invoice workspace: lifecycle rail (SUB-01), totals dock, `#adj` (CON-12) (desktop project only) |
| `e2e/awj-v3-h3-themes.spec.ts` | 9 | 9 · 0 · 0 | not re-run | v3 themes (desktop project only) |
| `e2e/awj-v3-h4-postures.spec.ts` | 23 | 23 · 0 · 0 | not re-run | v3 postures (desktop project only) |
| `e2e/awj-v3-h5-hardening.spec.ts` | 31 | 30 · 1 · 0 | 31 · 0 · 0 | v3 hardening incl. contrast scans of `/invoices`, `/invoices/new`, `/invoices/inv-118` (desktop project only) |

### 3.3 Failures: what was observed and what was established

Every failure is reported as a failure. For each, the table gives the proximate assertion, what was examined, and whether the cause is **evidenced** (shown by the failure artefacts plus the source, and reproduced when the spec was re-run alone) or **not established**; no spec or source file was modified to confirm a cause. None of these specs asserts VAT, tax-invoice, ZATCA or QR content, none of them runs against the backend, and the sandbox environment was not found responsible for any of them.

| Spec (projects) | Re-run alone | Proximate error | Evidence | Cause |
|---|---|---|---|---|
| `e2e/document-qa.spec.ts:89` (desktop, mobile) | failed again | the orthogonal-matrix test fails on `expect(metrics.rootHeight).toBeGreaterThan(2_000)` (`:113`) | The trace shows the failing combination: the last navigation is `/document-qa?type=delivery_note&template=tax-invoice-erp&direction=rtl&scenario=multipage`; the 54 combinations before it (including `multipage` for the other six document types) passed. The spec applies one `> 2000` height threshold to every type, and the delivery-note layout has no totals/VAT block (`document-qa.spec.ts:141-142`). Both projects fail identically because the test opens its own 1440×960 page. | Failing combination identified from the trace; why the delivery note is 147 px short of the threshold was not investigated, so the cause is not established (no tax content is involved). |
| `e2e/document-review.spec.ts:26` (desktop, mobile) | failed again | desktop: `getByRole('button', { name: 'إكمال المراجعة' })` not found within 5 s (`:54`); mobile: `p:visible` containing the supplier name not found (`:35`) | Desktop snapshot at the failure: the page still lists an unresolved line-item match (`sku_exact`, «مطابقة غير محسومة») and the message «أكمل المطابقات والمشكلات المانعة قبل إكمال المراجعة»; the spec confirms only the supplier match, so the completion button is never offered. Mobile snapshot: a tab layout with «معاينة آمنة» selected; the fields sit in the «التفاصيل» tab, which the spec opens only after the failing check. | Cause evidenced by the failure snapshot and the source (spec out of step with the Demo fixture and the mobile tab layout); the spec was not modified to confirm. |
| `e2e/document-review.spec.ts:88` (desktop, mobile) | failed again | `getByRole('dialog', { name: 'إنشاء مسودة مصروف' })` not visible within 5 s (`:99`) | The snapshot shows `dialog "معاينة المسودة"`: the button now opens `DraftPreviewDialog` first (`review-workspace.tsx:127,163`; title key `draftPreviewTitle`), and the dialog named «إنشاء مسودة مصروف» exists only after the preview is confirmed (`:378`). The spec does not confirm the preview. | Cause evidenced by the failure snapshot and the source (spec out of step with the draft-preview step); the spec was not modified to confirm. |
| `e2e/pos-checkout-reliability.spec.ts:18` (desktop) | failed again | 7-minute test timeout waiting for the customer button `/مؤسسة الخليج\|Gulf/` in the customer dialog (`:233`) | The failure screenshot shows the dialog with «لا عملاء مطابقون». `customer-picker.tsx:44` keeps only partners with `p.is_active` and type customer/both, while `MockPartner` (`mock-data.ts:18-40`) has no `is_active` property, so the Demo-mode picker never lists a customer. | Cause evidenced by the failure screenshot and the source (a Demo-fixture defect); the code was not modified to confirm. |
| `e2e/pos-interaction-mode.spec.ts:17` (desktop) | failed again | the console-clean assertion failed on the next-intl `INVALID_KEY` message (six message keys that contain a dot, listed in the failure text) | The failure text is the `INVALID_KEY` error itself. `use-intl` validates message keys only in its development build (`dist/development/initializeConfig-*.js` contains the check, `dist/production/` does not) and Playwright starts `next dev`; the production build run by Web CI is unaffected. | Cause evidenced by the failure text and the library source (a product-side message-key defect visible only in dev mode). |
| `e2e/pos-session-cart-recovery.spec.ts:19` (desktop) | failed again | 7-minute test timeout waiting for the customer button `/مؤسسة الخليج\|Gulf/` in the customer dialog (`:217`) | Same as `pos-checkout-reliability.spec.ts:18`: the dialog shows «لا عملاء مطابقون» because the Demo partners carry no `is_active` (`customer-picker.tsx:44`, `mock-data.ts:18-40`). | Cause evidenced by the failure screenshot and the source (a Demo-fixture defect); the code was not modified to confirm. |
| `e2e/reports.spec.ts:75` (desktop, mobile) | failed again | `selectOption('a4110')` on `#ledger-account` finds no such option for the 120 s test timeout (`:78`) | The failure snapshot lists only «اختر حساباً», «5130 — مصروف الخدمات» and «5190 — مصروف المرافق». In Demo Mode `GET /accounts` is answered first by `handleDocumentReviewDemo` (`mock-data.ts:3039`; two expense accounts, `document-review-demo.ts:323-327`), before the full chart handler (`mock-data.ts:4259`, which defines `a4110`). | Cause evidenced by the failure snapshot and the source (a Demo-fixture defect); the code was not modified to confirm. |
| `e2e/reports.spec.ts:86` (desktop, mobile) | failed again | `getByText('تفاصيل التقرير', { exact: true })` not found within 5 s on `/reports/sales/by-customer` (`:90`) | The snapshot shows the page with its presentation-mode radio group on «ملخص»; `sales-reports-workspace.tsx:314` titles the card `supportsPresentationModes ? t('summary') : t('details')`, so «تفاصيل التقرير» appears only for views without presentation modes. The page itself rendered completely (data, filters, table). | Cause evidenced by the failure snapshot and the source (spec out of step with the report layout); the spec was not modified to confirm. |
| `e2e/document-review.spec.ts:74` (mobile) | failed again | mobile only: `getByRole('button', { name: 'تعديل' }).first()` not found for the 120 s test timeout (`:78`) | Mobile snapshot: tab layout with «معاينة آمنة» selected; the «تعديل» buttons are inside the «التفاصيل» tab, which this test never opens. The same test passes on desktop, where all sections are rendered. | Cause evidenced by the failure snapshot (spec out of step with the mobile layout); the spec was not modified to confirm. |
| `e2e/awj-v3-h5-hardening.spec.ts:51` (desktop) | passed in the re-run for desktop | the notification-menu contrast scan found six text pairs below 4.5:1 (3.9–4.48 on white: the «تنبيهات»/«تحديثات» tabs, two badges, a muted date and a muted sentence) (`:51`) | Failed once in the batch run (desktop). Re-run alone it passed (6.5 s) and re-run in sequence with the three preceding contrast tests of the same file it passed (3.8 s). The failure artefact shows the violating pairs with the Default muted colour `rgb(88, 97, 114)` on white. | Not reproduced on two re-runs, so the failure is intermittent and its cause is not established (no tax content is involved). |

### 3.4 Not run, or stopped

* **`e2e/p47-baseline.spec.ts` — started and stopped.** The print-template centre/studio baseline (no tax content) was part of the AWJ v3 batch; after 12 of its 15 desktop tests (5 passed · 7 failed) the batch was stopped, because each remaining test waits 2 minutes. Six of the 7 failures are a click on «التالي» that never lands — the Next.js dev overlay (`<nextjs-portal>` from `data-nextjs-dev-overlay`) intercepts pointer events; one (`:224`) measures a 32 px wide menu button against the 44 px touch-target rule. These results are **not counted** in the totals above and the failures were not re-run alone.
* The mobile project was not run for the AWJ v3 specs (`awj-v3-*`): their desktop results are complete; the specs set their own viewport matrices.
* 48 of the 66 specs (storefront customizer `cust-*`, flowers commerce `flowers-*`, `store-brand-qa`, `help-center`, the POS visual-proof and responsive specs) and the `storefront/` and `mobile/` suites — outside the tax/ZATCA scope of this audit.
* `npm run build` — not run in the sandbox; `Web CI` built the audited commit successfully (run 38049588265).

## 4. Observations from the runs (not tax findings)

* **Dotted message keys.** `next dev` logs a next-intl `INVALID_KEY` error for six keys that contain a dot — `appBuilder.builder.visibility.signalOption`: `cart.itemCount`, `customer.isAuthenticated`, `product.inStock`; `developer.events`: `partner.created`, `product.created`, `invoice.created` (in `ar.json` and `en.json`). The validation exists only in the development build of `use-intl` (`dist/development/initializeConfig-*.js` contains the message text, `dist/production/` does not), so the production build and Web CI are unaffected; specs that assert a console-clean page fail in dev mode (`pos-interaction-mode.spec.ts:17`).
* **Demo-mode handlers.** `GET /accounts` in Demo Mode is answered by the document-review demo handler (two expense accounts, `document-review-demo.ts:323-327`) before the full chart handler (`mock-data.ts:3039` precedes `:4259`), and the mock partners have no `is_active` while the POS customer picker keeps only active partners (`customer-picker.tsx:44`). Both are defects of the Demo fixtures, not of the sandbox; they make several Demo-mode specs unable to pass at this commit.
* **CLAUDE.md** still says the web app has no automated tests (the project instructions list them under "deferred"); that line is stale.

## 5. How to reproduce

```bash
cd web && npm ci
npm run test                                    # Vitest: 445 files / 4 117 tests
npx playwright test e2e/<spec>.spec.ts --timeout=120000   # starts `next dev -p 3001`; Demo Mode, no backend
```
