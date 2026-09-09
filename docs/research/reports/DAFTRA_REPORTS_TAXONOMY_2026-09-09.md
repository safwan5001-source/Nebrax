# DAFTRA REPORTS TAXONOMY — Reference for AWJ Reporting System V2

**Date:** 2026-09-09
**Status:** Research / reference — not an implementation specification
**Purpose:** Preserve the observed Daftra hierarchy of report domains, sub-groups, report types, filters and ordering patterns before defining AWJ's target Reports Hub.

> Evidence boundary: this document separates report groups directly observed in owner-provided Daftra screenshots from report families/report behavior confirmed in Daftra official documentation. It must not be read as proof that every Daftra tenant/plan exposes exactly the same complete catalog. Missing groups must not be invented.

## 1. Observed top-level Reports navigation

Owner-provided Daftra screenshots showed these top-level report domains, in the observed navigation order:

1. تقارير المبيعات
2. تقارير المشتريات
3. تقارير الحسابات العامة
4. تقارير الشيكات
5. تقارير الـ SMS
6. تقارير النقاط و الأرصدة
7. تقارير الموظفين
8. تقارير العضويات
9. تقارير الإيجارات
10. تقارير دورة العمل
11. تقارير أوامر الشحن
12. تقارير العملاء
13. تقارير المخزون
14. تقرير استهلاك العملات الذكية
15. سجل النشاطات للحساب

This establishes that Daftra treats reporting as a multi-domain ERP subsystem rather than one flat report list.

## 2. Confirmed hierarchy pattern

Observed/documented structure:

`Reports → Domain → Report group/family → Specific report or preset → Filters → Viewer → Print/Export`

A domain may contain several semantic report groups. Groups are not merely visual headings: they cluster reports by accounting/business question, grouping dimension, document type, or time dimension.

A crucial finding from official documentation is that several menu entries that look like separate reports can share a flexible grouping model. Therefore AWJ must distinguish:

- independent report semantic;
- grouping preset;
- time-grain preset;
- document-type preset;
- module/application-specific report.

## 3. General Accounts — directly observed group hierarchy and ordering

The following hierarchy and ordering were directly observed in the owner-provided Daftra screenshot of **تقارير الحسابات العامة**.

### 3.1 تقارير الحسابات العامة

1. تقرير الضرائب
2. إقرار ضريبي
3. قائمة الدخل
4. الخزينة العمومية
5. الربح والخسارة
6. الحركات المالية
7. تقرير التدفقات النقدية
8. الأصول

### 3.2 تقارير القيود اليومية

1. تقرير ميزان مراجعة بمجاميع وأرصدة
2. تقرير حساب مراجعة
3. تقرير ميزان مراجعة وأرصدة
4. حساب الأستاذ
5. مراكز التكلفة
6. تقرير القيد
7. دليل الحسابات العامة

### 3.3 تقارير المصاريف المقسمة

1. المصروفات حسب التصنيف
2. المصروفات حسب البائع
3. المصروفات حسب الموظف
4. المصروفات حسب العميل

### 3.4 تقارير المصروفات حسب المدة الزمنية

1. المصروفات اليومية
2. المصروفات الأسبوعية
3. المصروفات الشهرية
4. المصروفات السنوية

### 3.5 تقرير سندات القبض المقسمة

1. سندات القبض حسب التصنيف
2. سندات القبض حسب البائع
3. سندات القبض حسب الموظف
4. سندات القبض حسب العميل

### 3.6 تقرير سندات القبض بالمدة الزمنية

1. سندات القبض اليومية
2. سندات القبض الأسبوعية
3. سندات القبض الشهرية
4. سندات القبض السنوية

### Taxonomy lesson

Daftra does not organize this area only by accounting object. It also creates families by **analysis dimension** (classification/vendor/employee/customer) and by **time grain** (daily/weekly/monthly/yearly). AWJ should model these concepts as metadata/capabilities where possible rather than necessarily creating duplicated implementations for every variant.

## 4. Sales — expanded official-documentation evidence

Official Daftra documentation confirms a broad sales reporting family. The exact visual ordering of the entire Sales page is still not established, but the following report identities/presets are documented.

### 4.1 Invoice-sales analysis family

Confirmed named entries include:

- تقرير المبيعات حسب العميل;
- تقرير المبيعات حسب الموظف;
- تقرير المبيعات الشهرية;
- other time-grain sales variants are supported by the grouping model.

The official documentation shows that the sales analysis can change grouping among:

- customer;
- employee / invoice creator;
- sales representative;
- daily;
- weekly;
- monthly;
- yearly.

The customer/employee reports support **الملخص / التفاصيل**. Date range includes preset periods and custom range. Export includes Excel and PDF variants with/without charts where documented.

**Interpretation:** these are strong candidates for named catalog presets over a shared analytical engine, not necessarily seven unrelated backend calculations.

### 4.2 Product/item sales family

Confirmed named entries include:

- المبيعات اليومية للمنتجات;
- مبيعات البنود حسب مندوب المبيعات.

Documented filters/capabilities include product/item selection and, in relevant reports, document type such as invoice, returned invoice, debit note and credit note. Item reports can expose detail rows tied to invoice/customer/employee context.

### 4.3 Customer receipt/payment analysis under Sales

Official documentation confirms named entries including:

- المدفوعات حسب العميل;
- المدفوعات حسب الموظف;
- المدفوعات حسب طريقة الدفع;
- المدفوعات الأسبوعية;
- الدفعات المقدمة.

The payment-analysis grouping model includes documented dimensions such as:

- daily;
- weekly;
- monthly;
- yearly;
- invoice creator employee;
- collected-by employee;
- customer;
- payment method.

These reports support summary/detail in documented cases and export/print actions.

### 4.4 Special/entitlement sales reports

Official documentation confirms at least one special report:

- تقرير مبيعات بحالة الدفع – خاص / Sales report by invoice type and payment status.

It requires activation through application management before access. This is important for AWJ registry design: **report availability can depend on an application/entitlement, not permission alone**.

### Sales taxonomy conclusion

The Sales domain should not be modeled as one flat set of hard-coded URLs. It has at least four semantic families:

1. invoice sales analysis;
2. item/product sales analysis;
3. receipts/payment analysis;
4. special/application-enabled reports.

Exact Daftra display order remains unverified unless directly observed.

## 5. Purchases — expanded official-documentation evidence

### 5.1 Purchase invoice analysis

Confirmed named entries include:

- مشتريات الموردين;
- المشتريات حسب الموظف;
- صافي وضع فواتير المشتريات.

Documented filters across this family include date range, invoice/payment status, supplier and invoice creator/employee where applicable.

### 5.2 Purchased-product analysis

Confirmed named entries include:

- مشتريات المنتجات حسب المنتج;
- مشتريات المنتجات حسب المورد;
- مشتريات المنتجات حسب الموظف.

The official documentation exposes a flexible `تجميع حسب` model including:

- product;
- supplier;
- employee;
- daily;
- weekly;
- monthly;
- yearly.

Documented filters include supplier, staff, products, date from/to and ordering. The detailed rows include item/product code, source document type, employee, supplier, unit price, taxes, quantity and total, with group subtotals and a final total.

### 5.3 Supplier payment analysis

Confirmed named/time entries include:

- المدفوعات اليومية;
- other payment time-grain variants are indicated by the documented grouping/time pattern.

The report describes supplier payments grouped by day or another time grain and includes supplier, employee, payment method and amount context.

### Purchases taxonomy conclusion

At least three semantic families are confirmed:

1. purchase invoices / supplier purchases;
2. purchased-product analytics;
3. supplier payments.

As with Sales, many apparent report variants should be evaluated as presets over shared grouping capabilities before AWJ creates separate implementations.

## 6. Customers — expanded official-documentation evidence

Confirmed customer report identities now include:

- أرصدة العملاء;
- مدفوعات العملاء;
- مواعيد العملاء;
- أقساط العملاء;
- customer debt aging / ledger aging from earlier research;
- customer statement/account-ledger style reporting from earlier research.

### 6.1 Customer balances

Documented filters include at least:

- date from/to;
- customer;
- customer classification;
- hide zero balance;
- show details;
- employee;
- additional filters recorded in the separate filter research/screenshots such as branch/currency/column visibility where evidenced.

The result contains prior/opening balance, sales, returns, net sales, payments, adjustments and ending balance, plus a final totals row.

### 6.2 Customer payments

This report is explicitly located under **تقارير العملاء** and displays collected customer payments with payment method, receiving treasury and collection employee context. This is distinct in catalog semantics from Sales-domain payment-analysis presets even where underlying payment data overlaps.

### 6.3 Customer appointments

Documented as a customer-domain report. It supports customer filtering and detail display. The table contains customer, date, start/end time, action, status, responsible employee(s), notes and branch. Export: CSV, Excel, PDF plus print.

### 6.4 Customer installments

Confirmed report: **أقساط العملاء**.

Documented filters include:

- customer;
- branch;
- grouping by customer / due date / status;
- currency, including conversion to a selected currency versus separate currency tables.

This is a useful reference for AWJ because currency presentation is part of the report contract, not merely formatting.

### Customers taxonomy conclusion

Customer reporting is not just “customer sales.” It contains at least:

1. balances/account position;
2. collections/payments;
3. aging/receivables;
4. statements/account movement;
5. appointments/CRM activity;
6. installments where the relevant module is enabled.

Exact visual group headings/order still require direct observation.

## 7. Inventory — expanded official-documentation evidence

Official documentation now confirms several distinct inventory report semantics.

### 7.1 Inventory value

Confirmed report: **قيمة المخزون التقديرية**.

It calculates estimated financial inventory value based on purchase price or average purchase price and is used to compare expected selling value, purchase value and expected profit. Supplier filtering is documented; additional filter details must be taken only from the source when confirmed.

### 7.2 Inventory movement — detailed chronological view

Confirmed report: **الحركة التفصيلية للمخزون**.

It begins with opening quantity before the selected period and then lists movement rows. Documented dimensions include date range and the resulting rows expose time, movement/source type, product code, product, incoming quantity, outgoing quantity, notes and warehouse. Export: CSV, Excel, PDF plus print.

### 7.3 Per-product movement valuation

Confirmed report: **تفاصيل حركات المخزون لكل منتج**.

This is semantically richer than a generic movement list. Rows include source document, warehouse, movement quantity, unit price, stock after movement, average cost, movement value, total price and inventory value after movement.

**AWJ warning:** do not collapse this into a simple movement table if AWJ needs historical valuation auditability.

### 7.4 Inventory operations summary

Confirmed report: **ملخص عمليات المخزون**.

It summarizes incoming/outgoing movements by movement source such as purchase/sales invoices, returns, transfers and manual adjustments over a selected period.

### 7.5 Inventory aging

Confirmed report: **أعمار المخزون**.

Documentation confirms an `حتى تاريخ` cut-off and, when branches are enabled, grouping by products or branch. Rows can be warehouse-specific, with a separate row for the same product in different warehouses.

### 7.6 Inventory turnover

Confirmed report: **معدل دوران المخزون**.

Documented workflow includes date range plus warehouse/products selection. It measures product movement/turnover performance rather than merely current stock.

### Inventory taxonomy conclusion

At least six distinct semantic report families/identities are confirmed:

1. inventory valuation;
2. detailed movement ledger;
3. per-product movement/valuation audit;
4. operations summary by source;
5. inventory aging;
6. inventory turnover.

This confirms that AWJ's current catalog entries `stockBalances`, `inventoryValue`, `movements`, `operations`, `aging`, `turnover`, etc. should be reviewed semantically rather than mapped only by similar names.

## 8. Accounting reports — documented semantic families

Official documentation and owner screenshots confirm important accounting report concepts including:

- General Ledger / حساب الأستاذ;
- Trial Balance / ميزان المراجعة;
- Review Account / حساب مراجعة;
- Journal Entries / القيود اليومية;
- Cost Centers / مراكز التكلفة;
- Cash Flow / التدفقات النقدية;
- Balance Sheet / الميزانية العمومية;
- tax-related reporting;
- expenses split by business dimension;
- expenses split by time grain;
- receipt vouchers split by business dimension;
- receipt vouchers split by time grain.

These reports have distinct accounting semantics even if they share filters/viewer components. AWJ must not collapse them merely for UI simplicity.

## 9. Cross-domain taxonomy model extracted from Daftra

The evidence now supports a more precise taxonomy model:

### Level 1 — Domain

Examples: Sales, Purchases, General Accounts, Customers, Inventory.

### Level 2 — Semantic family

Examples:

- invoice analysis;
- item/product analysis;
- payments/collections;
- financial statements;
- journal/ledger reports;
- balances;
- aging;
- movements;
- valuation;
- operational/CRM reports.

### Level 3 — Named report / preset

Examples:

- sales by customer;
- sales by employee;
- monthly sales;
- purchases by supplier;
- product purchases by employee;
- expenses by classification;
- daily expenses.

### Level 4 — Runtime dimensions

Examples:

- grouping;
- time grain;
- summary/detail;
- currency mode;
- branch;
- cost center;
- visible columns;
- sort/order.

This distinction is critical. A named menu entry does not necessarily require a unique backend endpoint.

## 10. Ordering principles extracted from the reference

The observed Daftra organization suggests these useful ordering principles:

1. **Domain first** — sales, purchases, accounting, customers, inventory, etc.
2. **Question/family second** — financial statements, journal reports, invoice analysis, product analysis, payments, expenses, receipts, balances, aging, movements.
3. **Variant/dimension third** — by customer/vendor/employee/classification/payment method or by daily/weekly/monthly/yearly grain.
4. **Specific report/preset last** — opening the report then reveals its filter contract and viewer.

This is substantially more scalable than one flat list.

## 11. Relationship to filters — evidence matrix

Taxonomy and filters must be designed together.

| Family | Confirmed filter/dimension examples |
|---|---|
| Sales invoice analysis | date range, customer/employee/sales rep grouping, daily/weekly/monthly/yearly, summary/detail |
| Sales payments | invoice creator, collector, customer, payment method, time grain, summary/detail |
| Purchase invoice analysis | date range, payment/status, supplier, employee |
| Purchased products | supplier, employee, products, date range, grouping, ordering |
| Customer balances | date range, customer, classification, zero-balance toggle, details, employee; branch/currency/columns where separately evidenced |
| Customer installments | customer, branch, group by customer/due date/status, currency mode |
| Inventory movement | date range plus product/warehouse/movement dimensions where documented in the detailed research |
| Inventory aging | cut-off date, products/branch grouping when branches enabled |
| Inventory turnover | date range, warehouse, products |
| Accounting | report-specific date/account hierarchy/branch/cost-center/fiscal-period dimensions; never assume one universal filter set |

A named report may therefore be:

- a truly distinct accounting/business report;
- a presentation preset over a shared report engine;
- a grouping preset (`by customer`, `by employee`, etc.);
- a time-grain preset (`daily`, `weekly`, `monthly`, `yearly`);
- an entitlement/application-specific report.

AWJ must identify which case applies before creating separate endpoints or duplicated code.

## 12. Relationship to Viewer / PDF / export

Each taxonomy entry should ultimately reference three independent contracts:

1. **Filter Contract** — scope, dimensions, grouping, detail/summary, visible columns.
2. **Viewer Contract** — table/statement/analytics presentation and drill-down behavior.
3. **Document/Export Contract** — PDF/print/Excel/CSV behavior, orientation, pagination, repeated headers, subtotals/totals and chart inclusion where relevant.

Taxonomy must not encode PDF layout directly.

Confirmed patterns include:

- summary/detail switching in multiple sales/purchase/payment reports;
- group subtotals + final totals in purchased-product reports;
- PDF with chart / PDF without chart in applicable analytical reports;
- CSV/Excel/PDF export in many operational reports;
- opening/prior quantity or balance in movement/accounting-style reports.

## 13. Proposed AWJ report-registry metadata — design input only

A future AWJ authoritative report registry should be capable of representing at least:

- stable report ID;
- domain/category;
- group/family;
- display order;
- route;
- permission;
- application entitlement;
- report semantic type;
- preset-of / engine ID;
- supported grouping dimensions;
- supported time grains;
- filter schema/contract;
- viewer type;
- summary/detail capability;
- column visibility capability;
- drill-down targets;
- opening/prior balance/quantity semantics;
- subtotal/grand-total semantics;
- PDF/print capability;
- PDF chart inclusion modes;
- Excel/CSV capability;
- currency mode;
- mobile behavior;
- status: ready / planned / hidden;
- accounting/security notes.

This is intentionally metadata-oriented so AWJ can avoid hard-coding unrelated catalog, routing and permission definitions in multiple places.

## 14. Current AWJ comparison — high level

Current AWJ `report-catalog.tsx` has only five top-level categories:

- Sales
- Purchases
- General Accounts
- Customers
- Inventory

REPORTS-AUDIT-1 already found semantic destination duplication/gaps for customer statement/directory, supplier statement, and stock balances/inventory value.

The expanded Daftra evidence shows that the important comparison is not raw report count. AWJ must compare:

`semantic family → named preset → filters/grouping → viewer → document/export → scope/permission`.

This avoids both under-building and blindly cloning Daftra's menu.

## 15. Evidence still needed before declaring Daftra taxonomy complete

Still explicit research gaps:

- exact full visual list and ordering under Sales;
- exact full visual list and ordering under Purchases;
- exact full visual group headings/order under Customers;
- exact full visual group headings/order under Inventory;
- exact sub-groups for Cheques, SMS, points/balances, Employees, Memberships, Rentals, Workflow and Shipping Orders;
- plan/module-dependent visibility differences;
- complete filter contract for every documented report;
- exact PDF/print settings per report where they differ;
- whether every named time/dimension variant is a menu entry or only a runtime grouping choice.

These gaps must be filled only from official Daftra documentation or direct screenshots/product observation. They must not be guessed.

## 16. AWJ decision gate

Before implementing Reports Hub V2:

1. Complete the Daftra evidence matrix as far as authoritative sources permit.
2. Complete AWJ REPORTS-AUDIT-2 for API/scope/permission/filter/export behavior.
3. Build `Daftra reference → AWJ current → AWJ target` mapping.
4. Explicitly classify each AWJ target item as `independent report` or `preset/grouping view`.
5. Owner approves AWJ taxonomy.
6. Only then implement registry/catalog/link/mobile changes in small PRs.

## 17. Safety rule

Daftra is a UX/product reference, not AWJ's accounting authority. AWJ's existing accounting invariants, tenant isolation, branch/warehouse scope, permissions, entitlements and backward compatibility remain authoritative.
