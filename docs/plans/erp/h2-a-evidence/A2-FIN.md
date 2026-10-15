# AWJ-ERP-UI-H2 · A2 audit — Group FIN (Accounting · Finance · Reports · HR)

> **Committed evidence:** the curated images of this report are under [`a2/fin/`](a2/fin/) (JPEG, at most 1100 px wide). References to `shots/`, `run.log`, `*.jsonl`, `wf*/` or `out-states/` point to the full local run, kept outside git for size; it is reproducible with [`tools/`](tools/README.md). The auditor's report is kept verbatim apart from evidence paths.

> Saved by the coordinator verbatim from the auditor's hand-back (the auditor's harness refused report files). P0s re-verified by the coordinator in code: `web/src/components/hr/run-detail-dialog.tsx:74` posts `/payroll-runs/{id}/{post|pay…}` with no `useConfirm`; `web/src/app/(app)/cash-and-bank/transfer/page.tsx:49` POSTs `/cash-bank-transfers` with no confirmation.

Run: v3 surface (`awj:ui-version=3`), production build :3001, local API :8000 (shared, single-threaded), 2026-10-15. Users: tenant A owner (workflows); `staff` (15 view permissions) and branch-scoped staff («فرع الخبر») for permissions/scope; tenant-B canary searched. Records tagged `H2-A2-FIN`. Repository untouched. Paths relative to `a2/fin/`: [`a2/fin/NN-*.jpg`](a2/fin/) (15), `shots/{ar1440,ar390,en1440,staff1440}__<route>.png` (atlas, 288 loads of 72 static routes), `shots/detail-{loading,error,notfound,staff,m390}__*.png`, `wf/<workflow>/NN-*.png` + `log.json`, `$S/out-states/shots/{empty,loading,error,forbidden}__<route>.png`.

**Counts: 35 findings — P0 2 · P1 5 · P2 21 · P3 7.**

## 1. Screens covered
Accounting: `/accounts`, `/journal-entries` (+`:id`), `/manual-journals` (+`new`, `?edit=`, `:id`), `/cost-centers`, `/assets`, `/assets/new`, `/accounting-settings` + 3 sub-pages, `/numbering-settings`.
Finance: `/expenses` (+`new`, `:id`, `categories`), `/receipt-vouchers` (+`new`, `:id`), `/cash-and-bank` (+`new?type=cash|bank`, `:id`, `transfer`), `/employee-custodies` (+`new`, `:id`), `/finance-settings` + 2 sub-pages, `/payment-methods`, `/financial-alerts`.
Reports: `/reports`, 5 category pages, `/reports/settings/classifications`, `/reports/classification-analytics`, all 36 report pages (each opened, then an empty period Jan 2020 and Oct 2026; inverted range on 4; 5 at 390).
HR: `/hr` (7 tabs), `/hr/employees/:id` (all tabs), `/users`, `/roles`.
Not covered: leave/request/attachment dialogs on the employee page; POS reports (POS group). There is no `/assets/:id` route.

## 2. State matrix
OK · ISSUE (Fnn) · N/A · NV. forbidden = staff; read-only = posted/reversed document.

### Accounting
| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /accounts | OK | NV | OK (retry) | OK view; ISSUE F09 | N/A | ISSUE F14 | OK | OK (tree + search) |
| /journal-entries | OK | NV | OK | ISSUE F09 | N/A | N/A | OK | OK (28 rows, pagination); ISSUE F11 |
| /journal-entries/:id | N/A | OK skeleton | ISSUE F08 | OK | ISSUE F10 | N/A | OK | OK |
| /manual-journals | OK | NV | ISSUE F05 | ISSUE F09 | N/A | N/A | OK | NV |
| /manual-journals/new (+edit) | OK | ISSUE F18 | NV | ISSUE F09 | OK | ISSUE F06, F18 | OK | ISSUE F27 |
| /manual-journals/:id | N/A | OK | ISSUE F08 | OK | OK; ISSUE F12 | N/A | OK | OK |
| /cost-centers | OK | NV | ISSUE F05 | ISSUE F09 | N/A | ISSUE F14 | OK | NV |
| /assets | OK | ISSUE F05 | ISSUE F05 | ISSUE F09 | N/A | N/A | NV | NV |
| /assets/new | OK | NV | NV | ISSUE F09 | N/A | ISSUE F14 | NV | NV |
| /accounting-settings/* | OK | NV | OK | OK (localized forbidden) | N/A | ISSUE F14 | OK | N/A |
| /numbering-settings | OK | NV | ISSUE F04 (endless skeleton) | ISSUE F09 | N/A | NV | OK | N/A |

### Finance
| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /expenses | OK | NV | OK | ISSUE F09 | N/A | N/A | OK | NV |
| /expenses/new | OK | NV | NV | ISSUE F09 (403 only after submit) | N/A | ISSUE F08, F14 | OK | ISSUE F27 |
| /expenses/:id | N/A | OK | ISSUE F08 | OK | OK; ISSUE F10 | N/A | OK | N/A |
| /expenses/categories | OK | NV | OK | ISSUE F09 | N/A | OK | NV | NV |
| /receipt-vouchers | OK | NV | OK | ISSUE F09 | N/A | N/A | OK | NV |
| /receipt-vouchers/new | OK | NV | NV | ISSUE F09 | N/A | ISSUE F14 | OK | ISSUE F27 |
| /receipt-vouchers/:id | N/A | OK | ISSUE F08 | OK | OK; ISSUE F10 | N/A | OK | N/A |
| /cash-and-bank | OK | NV | ISSUE F05 | ISSUE F09 | N/A | N/A | OK | NV |
| /cash-and-bank/new | OK | NV | NV | ISSUE F09 | N/A | ISSUE F14 | NV | N/A |
| /cash-and-bank/:id | N/A | OK | OK (localized) | ISSUE F09 | N/A | N/A | OK | ISSUE F22 |
| /cash-and-bank/transfer | OK | OK | NV | ISSUE F09, F16 | N/A | ISSUE F08, F14 | OK | N/A |
| /employee-custodies | OK | ISSUE F05 | ISSUE F05 | ISSUE F09 | N/A | N/A | OK | ISSUE F19 |
| /employee-custodies/new | OK | NV | ISSUE F05 | ISSUE F09 | N/A | ISSUE F14, F17 | OK | ISSUE F27 |
| /employee-custodies/:id | N/A | OK | ISSUE F08 | ISSUE F09 | OK | OK | OK | ISSUE F23 |
| /finance-settings/* | OK | NV | OK | ISSUE F09 | N/A | OK | OK | NV |
| /payment-methods | NV | NV | OK | ISSUE F09 | N/A | OK | OK | NV |
| /financial-alerts | OK | OK | OK | OK | N/A | N/A | NV | NV |

### Reports
| Route(s) | empty | loading | error | forbidden | read-only | validation (inverted range) | long | many |
|---|---|---|---|---|---|---|---|---|
| trial-balance | OK | OK | ISSUE F04 (blank card) | OK (scoped staff 0.00) | N/A | ISSUE F13 | OK | OK |
| income-statement, balance-sheet | OK | OK | ISSUE F04 (false «لا توجد أرصدة») | OK | N/A | NV | OK | OK |
| cash-flow, tax-report, journal-entries | OK | OK | OK | OK | N/A | ISSUE F13 | OK | OK (52 rows) |
| cost-center-profitability | OK | OK | ISSUE F04 (endless skeleton) | OK | N/A | NV | OK | NV |
| account-ledger | OK (prompt to pick an account) | NV | NV | OK | N/A | NV | OK | NV |
| customers/aging, purchases/aging | ISSUE F03 | OK | ISSUE F04 (endless skeleton) | OK | N/A | ISSUE F03 | OK | NV |
| sales/* (8), purchases/* (7), customers/* (4) | OK | OK | OK | OK | N/A | ISSUE F13 | OK | OK |
| inventory movements, operations, stocktakes | OK | OK | OK | OK | N/A | ISSUE F13 | OK | NV |
| inventory value, warehouses | N/A (snapshot) | OK | OK | OK | N/A | N/A | OK | NV |
| classification-analytics, delivery-channel | OK | OK | OK | OK | N/A | ISSUE F13 | OK | NV; ISSUE F26 |

### HR
| Route | empty | loading | error | forbidden | read-only | validation | long | many |
|---|---|---|---|---|---|---|---|---|
| /hr | OK | ISSUE F05 | ISSUE F05 | ISSUE F09 | N/A | ISSUE F14 | OK | NV |
| /hr/employees/:id | N/A | OK | ISSUE F05 | ISSUE F09 | N/A | OK | OK | NV |
| /users | N/A | NV | OK | OK | N/A | ISSUE F14 | OK | NV |
| /roles | N/A | NV | OK | OK | N/A | OK | OK | OK (134 permissions, search) |

## 3. Workflows (AR 1440, owner)

| # | Workflow | Steps | Clicks | Result | Issues | Evidence |
|---|---|---|---|---|---|---|
| 1 | Manual journal | New → empty submit («اختر حساباً لكل سطر قبل الحفظ.») → unbalanced draft saved (by design) → post rejected with the halalas message → edit → balance → save → post (no confirm) → JE-00006 → JE list/detail → reverse dialog (reason ≥ 3 chars) → «معكوس» | 7 to posted, +2 to correct, 4 to reverse | OK; amounts equal the API | F06 F07 F10 F11 F12 F18 F20 | wf/mj2, wf/mj0, wf/je; evidence 02, 09, 15 |
| 2 | Expense | Cost centre via dialog → new expense → no amount («أدخل مبلغاً موجباً») → «abc» amount (raw English error) → inline new category → 230 + 15% VAT + cost centre → save (lands on list) → open → post with confirm | 11 | EXP-00001 230.00 / 34.50 / 264.50 = API; its JE-00008 exists in the API but is not visible from the expense | F08 F10 F14 F27 | wf/exp; evidence 10, 11 |
| 3 | Receipt voucher | New (save disabled until a customer) → C2 → invoice option «المتبقي: 205.28 ⃁» auto-fills → changed to 50 → save → post with confirm | 6 | REC-00003, 50.00 allocated to INV-00002 (now partial) | F10 F21 F27 | wf/rv |
| 4 | Cash & bank | Add treasury via menu → empty submit (native bubble) → saved (ledger account 1111 created) → transfer 999,999 rejected with a clear message → «abc» date (raw English error) → 25.50 transferred with no confirm | 8 | CBT-00001; balances 974.50 / 25.50 = API | F02 F08 F16 F22 | wf/cash, wf/cash2; evidence 12 |
| 5 | Employee custody | Create settlement type → new custody (save disabled until employee) → 20.00 → post with confirm → settlement 25 rejected («يتجاوز الرصيد المتبقي») → 12.25 to 5150 posted | 12 | CST-00001 remaining 7.75 = API | F14 F17 F19 F23 | wf/cus; evidence 07, 13 |
| 6 | Reports | 36 opened; empty and Oct periods; inverted range on 4; trial-balance parity owner + scoped staff; EN dark trial balance; 390 captures | 2–3 per report | Analysis-first everywhere (A4 preview only behind «معاينة التقرير»); trial balance 12/12 rows and 26,511.34 = API | F03 F04 F13 F26 F29 | wf/reports, wf/tb-*, wf/rep-range, wf/rep390; evidence 03, 04, 14 |
| 7 | HR | Add employee → 6,000 contract → new payroll run → post accrual (no confirm) → pay cash (no confirm) → other tabs → users → custom role «H2-A2-FIN دور مخصص» (not assigned) | 14 | PR-00001 paid; 6,000.00 = API; accrual JE dated 2026-10-31 | F01 F05 F09 F28 F30 | wf/hr, wf/hr2, wf/role, wf/val; evidence 01 |

Keyboard: manual-journal tab order logical; Enter does not submit; other forms not tested by keyboard. 390: no horizontal overflow on any route in the group; lists become cards. Isolation: tenant-B canary nowhere; scoped staff trial balance 0.00 = API.

## 4. Consistency notes
1. **Create-form layouts differ:** `FormPage` with bottom actions (manual journal wide, expense with aside, receipt narrow); local layouts with Save at the top (cash-and-bank new and transfer, 3xl); custody card stack with «رجوع» instead of «إلغاء» (4xl); `/assets/new` narrow column.
2. **Post confirmation:** expense, receipt, custody confirm; manual journal, transfer, payroll post/pay, settlement and the policy toggle do not.
3. **Validation:** three patterns (F14).
4. **Ledger links:** no posted document links to its journal entry (F10).
5. **Status colours:** journal list «عكسي» red text, «آلي» green text, «يدوي» badge; payroll and custody statuses coloured text; badges elsewhere.
6. **Report families:** general reports have no back link/description; others have back link, description and summary/details toggle; delivery-channel and classification analytics export CSV only.
7. **Date formats:** inputs DD/MM/YYYY, tables YYYY-MM-DD, scope chip DD-MM-YYYY on aging but YYYY-MM-DD on trial balance.
8. **HR lists** use the older `DataTable` and a hand-built tab strip; every other list uses the v3 list (filters, sort, pagination).
9. **Mobile primary action:** full-width on some lists, half-width on expenses, small inline «إضافة» on cash-and-bank and HR.

## 5. Findings

### P0
- **H2-FIN-01 · P0 · Payroll accrual and payment post on one click** — `/hr?tab=runs` (run dialog). «ترحيل الاستحقاق» and «صرف نقداً» run immediately: no confirmation, no undo, only the toast «تم التحديث بنجاح»; cash and bank buttons side by side. Test: 6,000.00 left the cash account. Evidence [`01`](a2/fin/01-payroll-post-pay-no-confirm.jpg), `wf/hr2/09-11`. Direction: shared confirm dialog showing amount, method and treasury.
- **H2-FIN-02 · P0 · Treasury transfer posts with no confirmation and cannot be reversed in the UI** — `/cash-and-bank/transfer`. Evidence `wf/cash2/02-03`.

### P1
- **H2-FIN-03 · P1 · Aging reports ignore the period they display** — customer and supplier aging; chip «31-01-2020 ← 01-01-2020» but totals stay 4,635.28 / 15,525.00; requests `GET /reports/aging/{receivable,payable}` carry no dates. [`03`](a2/fin/03-aging-ignores-period.jpg).
- **H2-FIN-04 · P1 · Reports on a server error show false or empty content** — income statement and balance sheet «لا توجد أرصدة»; trial balance blank card; cost-centre profitability, both aging reports and numbering settings endless skeleton; sales reports handle it correctly («تعذر تحميل التقرير… إعادة المحاولة»). [`04`](a2/fin/04-income-statement-500-false-empty.jpg), `out-states/shots/error__reports_general_trial_balance.png`.
- **H2-FIN-05 · P1 · Lists and HR show a false empty state on error/loading** — on error: assets, cash-and-bank, cost centres, custodies, HR show «no records»; manual journals «no records» + raw «Server Error» toast; employee page «لم يُعثر على هذا الموظف.» without retry. While loading: assets, HR, custodies show empty text or a blank table instead of a skeleton. [`05`](a2/fin/05-assets-500-false-empty.jpg), `out-states/shots/{error,loading}__hr.png`, `shots/detail-error__hr_employees_id.png`.
- **H2-FIN-06 · P1 · Unbalanced-journal rejection shows halalas** — «القيد غير متوازن: مدين 15075 ≠ دائن 10000.» next to 150.75 ⃁ / 100.00 ⃁. [`02`](a2/fin/02-mj-unbalanced-halalas-msg.jpg).
- **H2-FIN-07 · P1 · Manual journal «ترحيل القيد» posts with no confirmation** (expense, receipt, custody confirm). `wf/mj2/06`, `wf/exp/12`.

### P2
- **H2-FIN-08** Raw backend/English messages: unknown id on 5 detail pages → «No query results for model [App\Models\…].» with a pointless «إعادة المحاولة»; server error → «Server Error»; expense «abc» → `amount=NaN` → «The amount field must be an integer.»; transfer date «abc» → «The transfer date field must be a valid date.»; native bubbles «Please fill out this field.»; `/cash-and-bank/:id` handles both correctly. [`06`](a2/fin/06-detail-notfound-raw-model.jpg), [`11`](a2/fin/11-expense-raw-english-validation.jpg), `details.json`.
- **H2-FIN-09** View-only staff sees create/manage controls everywhere (create buttons, full forms, transfer-page policy switch, numbering «حفظ», alert «حفظ الإعدادات», classification «حفظ السياسة», treasury edit/disable/delete/make-main, custody «إضافة تسوية», employee «تعديل»); forbidden learnt only after submit (403 «ليس لديك صلاحية لتنفيذ هذا الإجراء.»); `/users`, `/roles` gate correctly. [`08`](a2/fin/08-staff-sees-transfer-and-policy-toggle.jpg), `wf/staff`, `shots/detail-staff__*`.
- **H2-FIN-10** Posted documents don't link to their journal entry: expense/receipt/custody say an entry was created with no JE number/link; manual journal shows the JE as raw UUID; no link to the reversal; JE detail has no reverse action; transfers and payroll expose no JE. [`10`](a2/fin/10-expense-posted-no-journal-link.jpg), `wf/je/02`.
- **H2-FIN-11** Journal-entries source filter lists raw class names (`CashBankTransfer`, `EmployeeCustodySettlement`, `ManualJournal`, `PayrollRun`…). `wf/lists1440/log.json`.
- **H2-FIN-12** Red/green without a financial sign: debit red / credit green on manual-journal and JE line tables (incl. the «—» placeholder); journal kinds «عكسي» red, «آلي» green; income statement «إجمالي المصروفات» red; reversed-journal banner in the error tone. [`09`](a2/fin/09-je-list-kind-colours.jpg), `wf/je/01`.
- **H2-FIN-13** Inverted date range not validated: trial balance says «متوازن» and «لا توجد أرصدة»; other reports say «تعذر تحميل التقرير. تحقق من اتصالك…» although the API returned 422. [`14`](a2/fin/14-report-inverted-range-connection-msg.jpg), `wf/rep-range`.
- **H2-FIN-14** Three validation patterns, no required markers: disabled Save unexplained (assets, receipt, custody, period lock, fiscal year, roles, add account); inline message (manual journal, expense, payment method, categories, settlement types); native bubbles (cost centre, treasury, transfer, employee, shift, attendance, users); receipt without amount → generic «saveFailed». `wf/val/log.json`.
- **H2-FIN-15** Create forms use different scaffolds (§4.1).
- **H2-FIN-16** Company-wide negative-balance toggle «السماح بتحويل يتجاوز الرصيد المتاح» on the transfer form saves instantly (`PUT /settings/finance`) without confirmation, visible to staff.
- **H2-FIN-17** Invisible «مسودة» badge (`bg-muted` + `text-muted`) in `employee-custodies/new` and `components/payments/{document,general}-payment-form.tsx`. [`07`](a2/fin/07-custody-invisible-draft-badge.jpg).
- **H2-FIN-18** Manual-journal editor: edit form shows today's defaults until the draft loads (no loading state) then overwrites; an error raised before load stays after data arrives; all-zero drafts accepted (201), rejected only at posting («القيد لا يمكن أن يكون صفرياً.»). [`15`](a2/fin/15-mj-edit-race-stale-error.jpg), `wf/mj`, `wf/mj0`.
- **H2-FIN-19** Custody list filter labelled «مسوّاة» displays «مسوّاة» while the list shows an open custody. [`13`](a2/fin/13-custody-filter-ambiguous.jpg).
- **H2-FIN-20** `/manual-journals` and `/journal-entries` both titled «القيود اليومية» («Journal Entries» in EN).
- **H2-FIN-21** Configured payment methods ignored: the four in `/payment-methods` (incl. شيك, بطاقة ائتمان) never appear; receipt offers only cash/bank and stores `payment_method_id: null`; expense and custody have hard-coded lists.
- **H2-FIN-22** Treasury page lists transfers only, not the receipts/expenses/payroll that moved the balance (e.g. −5,768.52 ⃁); with no transfers it wrongly says «لا توجد خزائن أو حسابات بنكية بعد.». [`12`](a2/fin/12-treasury-detail-no-movements.jpg).
- **H2-FIN-23** Custody settlement allows any of ~35 posting accounts (incl. VAT output, revenue, capital); amount not prefilled with the remaining balance.
- **H2-FIN-24** Chart of accounts sums group balances in the browser (API returns "0.00" for groups; correct today); contra accounts (e.g. 1230) would be added with the wrong sign. `wf/accounts/log.json`.
- **H2-FIN-25** Shared date input: `components/ui/input.tsx:179` hard-codes `aria-label="فتح التقويم الميلادي"` (Arabic in EN on every date field); the field accepts and sends any text.
- **H2-FIN-26** Report families differ in chrome and exports (§4.6, §4.7).
- **H2-FIN-27** Long lists use native selects with no search (customers 29, accounts ~35, employees, settlement accounts).
- **H2-FIN-28** HR uses an older list/tab pattern; tabs clipped at 390; a payroll run exists only inside a dialog (no URL, no document page).

### P3
- **H2-FIN-29** Trial-balance KPI shows «متوازن» in the monospaced number font; «ميزان المراجعة متوازن» appears twice.
- **H2-FIN-30** `/hr`: two sidebar items highlighted (شؤون الموظفين + إدارة العقود); payroll tab highlights none.
- **H2-FIN-31** Field styling differs: expense textarea grey vs white inputs; receipt amount lacks the riyal suffix; number-preview fields look editable.
- **H2-FIN-32** Roles screen shows raw permission keys; system role names stay Arabic in EN.
- **H2-FIN-33** Manual-journal editor: Enter doesn't submit; the difference shows an absolute value without saying which side is heavier.
- **H2-FIN-34** Income statement «المقارنة» label beside its select while other labels are stacked above.
- **H2-FIN-35** Mobile primary action placed differently across lists.

Already known, not re-reported: D-ERP-UX-01 (Arabic account names in EN).

## 6. Number parity
Equal to the API: MJE-00001/JE-00006 150.75 · EXP-00001 230.00 / 34.50 / 264.50 · REC-00003 50.00 and invoice remaining 205.28 · treasuries 974.50 / −5,768.52 / 25.50 · CST-00001 20.00 / 12.25 / 7.75 · PR-00001 6,000.00 · trial balance 12 rows + 26,511.34 row by row (owner), 0.00 (scoped staff). Exceptions: group balances computed in the browser (F24); rejection message in halalas (F06).

## 7. Not verified
Workflows end-to-end at 390; keyboard beyond the manual-journal form; CSV/PDF/share/print/preview output; period locks, fiscal years, account routing, numbering save, alert scan, creating payment methods/users/assets (tenant-wide; only empty-submit validation); assigning the custom role; legacy regression; contra-account group sums; some list loading states; screen readers, other browsers, production volumes.

## 8. Records created (tenant A)
MJE-2026-00001 posted then reversed (JE-00006 / JE-00007) · one untagged all-zero draft (deleted via UI) · cost centre H2FIN + expense category · EXP-2026-00001 · REC-2026-00003 (50.00 on INV-2026-00002) · treasury 1111 + CBT-2026-00001 · settlement type · EMP-00001 + contract + PR-2026-00001 (paid cash) · CST-2026-00001 + CSTL-2026-00001 · role «H2-A2-FIN دور مخصص» (not assigned) · a staff expense attempt refused (403), nothing created.

## Evidence index (committed)

- [`01-payroll-post-pay-no-confirm.jpg`](a2/fin/01-payroll-post-pay-no-confirm.jpg)
- [`02-mj-unbalanced-halalas-msg.jpg`](a2/fin/02-mj-unbalanced-halalas-msg.jpg)
- [`03-aging-ignores-period.jpg`](a2/fin/03-aging-ignores-period.jpg)
- [`04-income-statement-500-false-empty.jpg`](a2/fin/04-income-statement-500-false-empty.jpg)
- [`05-assets-500-false-empty.jpg`](a2/fin/05-assets-500-false-empty.jpg)
- [`06-detail-notfound-raw-model.jpg`](a2/fin/06-detail-notfound-raw-model.jpg)
- [`07-custody-invisible-draft-badge.jpg`](a2/fin/07-custody-invisible-draft-badge.jpg)
- [`08-staff-sees-transfer-and-policy-toggle.jpg`](a2/fin/08-staff-sees-transfer-and-policy-toggle.jpg)
- [`09-je-list-kind-colours.jpg`](a2/fin/09-je-list-kind-colours.jpg)
- [`10-expense-posted-no-journal-link.jpg`](a2/fin/10-expense-posted-no-journal-link.jpg)
- [`11-expense-raw-english-validation.jpg`](a2/fin/11-expense-raw-english-validation.jpg)
- [`12-treasury-detail-no-movements.jpg`](a2/fin/12-treasury-detail-no-movements.jpg)
- [`13-custody-filter-ambiguous.jpg`](a2/fin/13-custody-filter-ambiguous.jpg)
- [`14-report-inverted-range-connection-msg.jpg`](a2/fin/14-report-inverted-range-connection-msg.jpg)
- [`15-mj-edit-race-stale-error.jpg`](a2/fin/15-mj-edit-race-stale-error.jpg)
