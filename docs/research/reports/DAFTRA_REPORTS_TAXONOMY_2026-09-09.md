# DAFTRA REPORTS TAXONOMY — Reference for AWJ Reporting System V2

**Date:** 2026-09-09
**Status:** Research / reference — not an implementation specification
**Purpose:** Preserve Daftra report hierarchy, groups, report types and ordering before defining AWJ Reports Hub V2.

> Evidence rule: owner-provided screenshots are authoritative for the visible hierarchy/order in that observed tenant. Official Daftra documentation is used for report behavior/filters. Missing items must not be invented.

## 1. Observed top-level Reports navigation

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

## 2. Taxonomy model

`Reports → Domain → Visible group/family → Named report/preset → Filters → Viewer → Print/Export`

AWJ must distinguish independent report semantics from grouping presets, time-grain presets and module-specific reports.

## 3. General Accounts — observed hierarchy

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

## 4. Sales — DIRECTLY OBSERVED hierarchy/order (owner screenshot 2026-09-09)

The following is now screenshot-confirmed and replaces the previous “exact Sales order unverified” gap.

### 4.1 تقارير متابعة الفواتير المقسمة
1. المبيعات حسب العميل
2. المبيعات حسب الموظف
3. المبيعات حسب مندوب المبيعات
4. تقرير إرسال الفواتير إلى هيئة الزكاة
5. Invoice-Returns Cross-Reference
6. تقرير صافي وضع الفواتير

### 4.2 تقارير مبيعات المنتجات بالمدة الزمنية
1. المبيعات اليومية للمنتجات
2. المبيعات الأسبوعية للمنتجات
3. المبيعات الشهرية للمنتجات
4. المبيعات السنوية للمنتجات

### 4.3 تقارير الفواتير حسب المدة الزمنية
1. المبيعات اليومية
2. المبيعات الأسبوعية
3. المبيعات الشهرية
4. المبيعات السنوية

### 4.4 تقارير المدفوعات المقسمة
1. المدفوعات حسب العميل
2. المدفوعات حسب الموظف
3. المدفوعات حسب طريقة الدفع
4. الدفعات المقدمة

### 4.5 تقارير المدفوعات بالمدة الزمنية
1. المدفوعات اليومية
2. المدفوعات الأسبوعية
3. المدفوعات الشهرية
4. المدفوعات السنوية

### 4.6 أرباح مبيعات الأصناف
1. أرباح مبيعات الأصناف - المنتجات
2. أرباح مبيعات الأصناف - العميل
3. أرباح مبيعات الأصناف - موظف
4. أرباح مبيعات الأصناف - مسؤول مبيعات

### 4.7 تقارير الربح حسب الفترة
1. الأرباح يومية
2. الأرباح الأسبوعية
3. الأرباح السنوية

> Screenshot observation: no monthly-profit row is visible in the supplied capture. Do not add one without evidence.

### 4.8 تقارير مبيعات البنود المقسمة
1. مبيعات البنود حسب البند
2. مبيعات البنود حسب التصنيف
3. مبيعات البنود حسب الماركة
4. مبيعات البنود حسب الموظف
5. مبيعات البنود حسب مندوب المبيعات
6. مبيعات البنود حسب العميل

### Sales structural finding
Sales visibly uses multiple parallel families: invoice follow-up, product sales by time, invoices by time, payments by dimension, payments by time, item profitability, profit by period, and item sales by dimension. This confirms that the Reports Hub hierarchy is meaningful product structure, not merely decoration.

## 5. Purchases — DIRECTLY OBSERVED hierarchy/order (owner screenshot 2026-09-09)

### 5.1 تقارير متابعة المشتريات المقسمة
1. المشتريات حسب المورد
2. المشتريات حسب الموظف
3. Purchase Invoice Net Position

### 5.2 تقارير الموردين
1. دليل الموردين
2. أرصدة الموردين
3. أعمار المدين (حساب الأستاذ)
4. مشتريات الموردين
5. Purchase Order Payments
6. كشف حساب الموردين

### 5.3 تقرير مشتريات المنتجات
1. تقرير مشتريات المنتجات حسب المنتج
2. تقرير مشتريات المنتجات حسب المورد
3. تقرير مشتريات المنتجات حسب الموظف

### 5.4 تقارير المدفوعات بالمدة الزمنية
1. المدفوعات اليومية
2. المدفوعات الأسبوعية
3. المدفوعات الشهرية
4. المدفوعات السنوية

### Purchases structural finding
Supplier reports form a first-class family separate from invoice-follow-up and purchased-product analytics. AWJ should not route a named supplier statement to a generic supplier directory and consider the report complete.

## 6. Customers — DIRECTLY OBSERVED hierarchy/order (owner screenshot 2026-09-09)

Visible page title: **تقارير العملاء**.

### 6.1 تقارير العملاء
1. أعمار الديون (الفواتير)
2. أعمار الديون (حساب الأستاذ)
3. دليل العملاء
4. أرصدة العملاء
5. مبيعات العملاء
6. مدفوعات العملاء
7. كشف حساب العملاء
8. مواعيد العملاء

### Customers structural finding
Two debt-aging semantics are deliberately exposed: invoice aging and ledger aging. They must not be collapsed merely because both are “aging”. Directory, balances, sales, payments, statement and appointments are also separate visible report identities.

## 7. Inventory — DIRECTLY OBSERVED hierarchy/order (owner screenshot 2026-09-09)

Visible page title: **تقارير المخزون**.

### 7.1 المخزون
1. ورقة الجرد
2. ملخص عمليات المخزون
3. الحركة التفصيلية للمخزون
4. قيمة المخزون
5. ملخص رصيد المخازن
6. ميزان مراجعة منتجات
7. تفاصيل حركات المخزون لكل منتج
8. أعمار المخزون
9. معدل دوران المخزون

### Inventory structural finding
The screenshot confirms nine visible inventory report identities. In particular, **قيمة المخزون** and **ملخص رصيد المخازن** are distinct catalog entries, strengthening the existing AWJ audit finding that mapping separate concepts to the same `/reports/inventory/value` route requires semantic review. Likewise, generic movement, per-product movement detail, operations summary, stocktake, aging and turnover are separate report concepts.

## 8. Evidence from official documentation — behavior, not menu ordering

Official Daftra documentation reviewed separately confirms behavior such as:
- sales grouping by customer/employee/salesperson/time grain;
- purchase-product grouping by product/supplier/employee/time grain;
- customer balances and payments filters;
- General Ledger, Trial Balance, Balance Sheet, Cost Centers and Journal Entries semantics;
- detailed inventory movement and per-product valuation semantics;
- CSV/Excel/PDF/Print capabilities across many reports;
- PDF orientation/font-size settings where documented;
- PDF with/without chart variants on analytical reports where documented.

These documentation-derived capabilities must be joined to the screenshot-derived hierarchy in the future per-report evidence matrix.

## 9. Cross-domain taxonomy model now confirmed

### Level 1 — Domain
Sales / Purchases / General Accounts / Customers / Inventory / other modules.

### Level 2 — Visible family/group
Examples: invoice follow-up, supplier reports, payments by time, item sales by dimension, journal reports, inventory.

### Level 3 — Named report or preset
Examples: sales by customer, daily sales, supplier balances, customer statement, inventory aging.

### Level 4 — Runtime dimensions
Filters, grouping, time grain, summary/detail, currency, branch, warehouse, cost center, visible columns.

### Level 5 — Output contract
Viewer, drill-down, mobile behavior, PDF/Print, Excel/CSV, charts, orientation, pagination, repeated headers, totals.

## 10. Implication for AWJ Registry

A future authoritative registry should represent at least:
- stable report ID;
- domain;
- family/group;
- display order;
- semantic type (`independent`, `grouping-preset`, `time-preset`, `module-report`);
- route/API;
- permission;
- entitlement;
- tenant/company/branch/warehouse scope;
- filter contract;
- grouping/time-grain capabilities;
- viewer type;
- summary/detail;
- columns/column visibility;
- drill-down;
- mobile behavior;
- CSV/Excel/PDF/Print capabilities;
- PDF chart/orientation/font/pagination capabilities;
- status and evidence level.

## 11. AWJ comparison — current known gaps

Current AWJ catalog has only five top-level categories: Sales, Purchases, General Accounts, Customers, Inventory.

Known semantic/wiring concerns from REPORTS-AUDIT-1 include:
- customerStatement and customerDirectory both route to `/partners`;
- supplierStatement routes to `/suppliers`;
- stockBalances and inventoryValue both route to `/reports/inventory/value`;
- current report mobile results use `ReportMobileRows` rather than preserving the real full-width report grid approved for Reports V2.

The new screenshots materially increase confidence in the first three findings because Daftra visibly treats those entries as distinct report identities.

## 12. Remaining evidence gaps

After the 2026-09-09 screenshots, exact hierarchy/order is now directly observed for:
- General Accounts;
- Sales;
- Purchases;
- Customers;
- Inventory.

Still to capture if available:
- Cheques;
- SMS;
- points/balances;
- Employees;
- Memberships;
- Rentals;
- Workflow;
- Shipping Orders;
- smart-currency consumption/activity log placement and behavior;
- plan/module-dependent visibility.

## 13. Next evidence matrix

For every screenshot-confirmed report, REPORTS-AUDIT-2 should record:

`Daftra Domain → Group → Display Order → Report → Filters → Grouping → Summary/Details → Columns → Viewer → Mobile → PDF → Print → Excel/CSV → AWJ Current Route/API → Permission → Entitlement → Scope → Tests → Gap → Priority`

Statuses:
- **Verified Working**
- **Verified Gap**
- **Needs Runtime Verification**

Priority:
- **P0** accounting/security/tenant/scope
- **P1** wrong/missing semantic wiring
- **P2** filters/viewer/mobile/export consistency
- **P3** taxonomy/presentation improvements

## 14. Decision gate

Before implementing Reports Hub V2:
1. capture remaining hierarchy evidence where available;
2. complete REPORTS-AUDIT-2 scope/permission/API/filter/export audit;
3. build `Daftra reference → AWJ current → AWJ target` mapping;
4. owner approves AWJ taxonomy;
5. only then implement in small PRs.

## 15. Safety rule

Daftra is a UX/product reference, not AWJ's accounting authority. AWJ accounting invariants, tenant isolation, branch/warehouse scope, permissions, entitlements and backward compatibility remain authoritative.
