# REPORTS-AUDIT-2 — Deep Report Contract Audit

**Date:** 2026-09-09
**Status:** IN PROGRESS — research/audit only
**Scope:** Filters → Viewer → Document/Export → AWJ API/scope/permission mapping
**Implementation:** NOT AUTHORIZED

## 1. Purpose

Build an evidence-backed report-by-report matrix before AWJ Reports Hub V2 implementation. Daftra is a UX/product reference only; AWJ accounting invariants, tenant isolation, branch/warehouse scope, permissions, entitlements and backward compatibility remain authoritative.

Status vocabulary:
- **Verified Working** — statically supported by current AWJ code/tests.
- **Verified Gap** — a concrete mismatch/absence is evidenced.
- **Needs Runtime Verification** — static evidence is insufficient.

Priority:
- **P0** accounting/security/tenant/scope
- **P1** semantic routing/wiring
- **P2** filter/viewer/mobile/export consistency
- **P3** taxonomy/presentation

## 2. Audit dimensions per report

`Domain → Group → Order → Report → Filter Contract → Grouping → Summary/Details → Columns → Viewer → Mobile → CSV → Excel → PDF → Print → PDF chart/orientation/font/pagination → AWJ Route → API → Permission → Entitlement → Tenant/Branch/Warehouse scope → Tests → Status → Priority`

## 3. Sales — first deep pass

### 3.1 Daftra screenshot-confirmed families

1. تقارير متابعة الفواتير المقسمة
2. تقارير مبيعات المنتجات بالمدة الزمنية
3. تقارير الفواتير حسب المدة الزمنية
4. تقارير المدفوعات المقسمة
5. تقارير المدفوعات بالمدة الزمنية
6. أرباح مبيعات الأصناف
7. تقارير الربح حسب الفترة
8. تقارير مبيعات البنود المقسمة

The exact entries/order are maintained in `DAFTRA_REPORTS_TAXONOMY_2026-09-09.md`.

## 4. Daftra Sales Filter Contract — official-document evidence

### 4.1 Sales by customer

Official documentation confirms:
- summary = totals grouped by customer;
- details = individual invoices;
- date from/to with preset/custom ranges;
- shipping option;
- one-or-more branches;
- enabled invoice custom fields can become filters;
- grouping can switch among customer, employee, salesperson, daily, weekly, monthly, yearly;
- CSV, Excel, PDF with chart, PDF without chart, Print;
- charts summarize paid/unpaid/returned/total behavior.

**Implication:** the named catalog report is both a report entry and a preset over a broader grouping-capable invoice-sales analysis contract.

### 4.2 Sales by employee

Official documentation confirms:
- summary/details;
- date range;
- same broader grouping family (customer/employee/salesperson/time grains);
- CSV/Excel/PDF with chart/PDF without chart/Print.

### 4.3 Net sales invoice position

Official documentation confirms a distinct invoice-position semantic with at least:
- date from/to;
- payment status;
- customer;
- electronic-invoice/ZATCA status;
- financial position including gross/paid/returns/net remaining.

**Classification:** independent semantic report, not merely a grouping preset.

### 4.4 Payments by customer / employee

Official documentation confirms:
- summary/details;
- invoice creator filter;
- customer/customer classification where documented;
- date range;
- sales/order source where documented;
- branch;
- payment method context;
- grouping options: daily, weekly, monthly, yearly, invoice creator employee, collected-by employee, customer, method;
- CSV/Excel/PDF with chart/PDF without chart/Print;
- detail rows retain invoice/date/customer/payment-method/reference/amount context;
- return/refund values can be negative and group/grand totals are explicit.

### 4.5 Item sales by salesperson

Official documentation confirms filters including:
- item/product;
- source document type: invoice, returned invoice, debit note, credit note.

This demonstrates that document type is part of the item-sales Filter Contract and can change the included business events.

## 5. AWJ Sales current contract — static code evidence

Current `SalesReportView` supports only:
- `period`
- `customer`
- `product`
- `classification`
- `salesperson`
- `profit`
- `payments`

All call one endpoint family: `/reports/sales?view=...`.

### 5.1 Current AWJ filter query

The workspace currently sends:
- `from`
- `to`
- `branch_id[]`
- `customer_id`
- `customer_classification_id`
- `product_id`
- `product_category_id`
- `classification_id`
- `salesperson_id`
- `payment_status`
- `receipt_method`
- `interval` only for period/profit/payments.

The filter UI also loads customer, product, employee, product category, customer classification and sales-invoice classification option sources.

### 5.2 Current AWJ Filter Contract gaps — preliminary

**Verified Gap — P2:** Daftra's documented sales-by-customer shipping-option filter is not represented in the current AWJ Sales filter state/query.

**Verified Gap — P2:** Daftra supports invoice custom fields as report filters when configured; no equivalent dynamic custom-field filter is represented in current AWJ Sales filter state/query.

**Verified Gap — P2/P1:** Daftra's payment grouping model includes invoice creator vs collected-by employee vs customer vs method vs time. Current AWJ exposes one `payments` view with `interval` and a restricted receipt method filter; static code does not expose the same grouping dimensions.

**Verified Gap — P2:** current AWJ `receiptMethod` UI is constrained to `cash | bank`; Daftra documentation shows a broader payment-method universe. AWJ's actual configured payment-method domain must be audited before deciding target behavior.

**Needs Runtime Verification — P0/P2:** branch selection is sent by the UI, but backend enforcement/intersection with authenticated tenant/user branch scope must be verified in the controller/service/tests before calling it safe.

**Needs Runtime Verification — P2:** payment status exists in AWJ state/query, but report-specific applicability and backend handling must be verified.

### 5.3 Current AWJ Viewer/Document contract

Static code confirms:
- summary metrics precede result surface;
- customer/product rows can drill to partner/product records;
- CSV export exists;
- PDF generation/download/share exists;
- Print exists;
- Preview exists;
- presentation summary/detail control exists only for customer/product/salesperson analytics;
- export document is separately constructed from the screen report data.

**Verified Gap — P2:** current export actions expose CSV/PDF/Print but no Excel action in the Sales workspace, while Daftra official documentation exposes Excel across the compared sales reports.

**Verified Gap — P2:** current Sales PDF action has one generated PDF path; no explicit with-chart/without-chart variants are exposed in this workspace.

**Verified Gap — P2:** the current Print call uses fixed A4 dimensions (`210 × 297 mm`); no user-facing portrait/landscape or report print-font-size control is visible in this workspace.

**Verified Gap — P2:** presentation mode is explicitly marked presentation-only and independent of the current export contract. Therefore screen Summary/Details does not yet prove corresponding summary/detail export parity.

## 6. Mobile Viewer finding

The existing report system has a known cross-report mismatch: `ReportResultsTable` switches to `ReportMobileRows` on mobile while desktop uses `ReportDataTable`.

Owner-approved Reports V2 direction, based on observed Daftra mobile reports:
- financial/report tables remain real tables on mobile;
- horizontal scrolling is allowed;
- columns are not automatically converted to cards or removed merely because the viewport is narrow;
- optional column chooser may be provided;
- a sticky primary identifier column may be considered as an AWJ enhancement.

**Verified Gap — P2:** current report mobile presentation conflicts with the approved Reports V2 viewer contract.

## 7. Sales report identity mapping — preliminary

| Daftra semantic/preset | AWJ current closest view | Preliminary status |
|---|---|---|
| المبيعات حسب العميل | `customer` | Exists, contract parity incomplete |
| المبيعات حسب الموظف | no explicit employee view | Verified Gap / inspect salesperson semantics |
| المبيعات حسب مندوب المبيعات | `salesperson` | Exists, contract parity incomplete |
| صافي وضع الفواتير | none visible in SalesReportView | Verified Gap |
| المبيعات اليومية/الأسبوعية/الشهرية/السنوية | `period` + interval | Shared-engine pattern exists |
| مبيعات المنتجات حسب الزمن | `product` does not itself carry interval in current query | Verified Gap / semantic review |
| المدفوعات حسب العميل/الموظف/الطريقة | `payments` | Partial shared engine; grouping parity incomplete |
| المدفوعات حسب الزمن | `payments` + interval | Shared-engine pattern exists |
| أرباح مبيعات الأصناف | `profit` is period-oriented in current document shape | Needs semantic mapping |
| الأرباح حسب الفترة | `profit` + interval | Exists conceptually |
| مبيعات البنود حسب البند | `product` | Partial |
| حسب التصنيف | `classification` | Partial |
| حسب الماركة | none evidenced | Verified Gap |
| حسب الموظف | none explicit | Verified Gap |
| حسب مندوب المبيعات | `salesperson` is invoice-sales view, not proven item-sales grouping | Needs semantic mapping |
| حسب العميل | `customer` is invoice-sales view, not proven item-sales grouping | Needs semantic mapping |
| إرسال الفواتير إلى هيئة الزكاة | no equivalent evidenced in current sales views | Needs target decision; ZATCA-specific |
| Invoice-Returns Cross-Reference | no equivalent evidenced | Needs target decision |

Important: “missing compared with Daftra” does **not** automatically mean AWJ should implement it. Target scope requires owner approval and AWJ business/accounting semantics.

## 8. Security/accounting questions that must be answered before implementation

For `/reports/sales` inspect:
1. tenant predicate source and whether tenant ID can ever be user-controlled;
2. branch filter authorization/intersection;
3. handling of no branch filter;
4. customer/product/classification IDs from another tenant;
5. employee/salesperson IDs from another tenant;
6. financial sign treatment for returns/credit/debit notes;
7. posted/draft/cancelled document inclusion rules;
8. payment/refund inclusion rules;
9. currency behavior;
10. cost/profit permission (`products.view_cost` or equivalent) for profitability reports;
11. report endpoint permission (`reports.view`) and entitlement behavior;
12. export parity: export must not reveal fields hidden on screen by permission.

Any uncertainty in these areas remains **P0 Needs Runtime/Code Verification**, not an assumed pass.

## 9. Next audit sequence

1. Finish Sales backend/controller/service/test scope audit.
2. Deep-audit Purchases filters/viewer/export/scope.
3. General Accounts — highest accounting sensitivity.
4. Customers.
5. Inventory — include warehouse scope and cost visibility.
6. Consolidate final `Daftra reference → AWJ current → AWJ target` matrix.

## 10. No implementation decision

This document records evidence and gaps only. It does not authorize endpoint changes, financial-rule changes, schema changes, UI implementation, merge or deployment.
