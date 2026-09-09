# DAFTRA REPORTS TAXONOMY — Reference for AWJ Reporting System V2

**Date:** 2026-09-09
**Status:** Research / reference — not an implementation specification
**Purpose:** Preserve the observed Daftra hierarchy of report domains, sub-groups, report types and ordering patterns before defining AWJ's target Reports Hub.

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

Observed structure:

`Reports → Domain → Report group/family → Specific report → Filters → Viewer → Print/Export`

A domain may contain several semantic report groups. Groups are not merely visual headings: they cluster reports by accounting/business question, grouping dimension, or time dimension.

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

## 4. Sales — documented report-family patterns

Official Daftra documentation confirms sales reports that can be analyzed/grouped by dimensions such as:

- customer;
- employee / invoice creator;
- sales representative;
- product or sales subject where applicable;
- time: daily / weekly / monthly / yearly.

Confirmed examples include sales by customer and sales by employee. Some reports permit changing grouping rather than requiring an entirely separate calculation engine.

**AWJ lesson:** distinguish `report identity` from `grouping dimension`. A Reports Hub may expose convenient named entries while internally sharing one report contract.

## 5. Customer report family — documented/observed capabilities

Confirmed customer-report concepts include:

- customer balances;
- customer payments;
- customer sales analysis;
- customer debt aging / ledger aging;
- customer statement/account-ledger style reporting.

The observed Customer Balances report includes a rich full-width table and supports summary/detail behavior and column visibility. Owner-provided mobile screenshots establish that the live report remains a full horizontally scrollable report table rather than being transformed into cards.

## 6. Supplier / purchases report family

Confirmed concepts from official documentation and existing research include:

- supplier statement/account movement;
- supplier debt aging;
- purchases analysis by dimensions/time where available;
- supplier-related balances/payments.

Do not infer an exact complete sub-group order until directly observed or documented.

## 7. Inventory report family

Official Daftra documentation confirms at least the detailed inventory movement report with filtering by date/product/warehouse/movement type and an opening quantity followed by movement rows.

Other inventory report names observed in Daftra navigation/research must be recorded only when supported by screenshots or official documentation. Do not manufacture a complete inventory taxonomy from generic ERP knowledge.

## 8. Accounting reports — documented semantic families

Official documentation confirms important accounting report concepts including:

- General Ledger / حساب الأستاذ;
- Trial Balance / ميزان المراجعة;
- Review Account / حساب مراجعة;
- Journal Entries / القيود اليومية;
- Cost Centers / مراكز التكلفة;
- Cash Flow / التدفقات النقدية;
- Balance Sheet / الميزانية العمومية;
- tax-related reporting.

These reports have distinct accounting semantics even if they share filters/viewer components. AWJ must not collapse them merely for UI simplicity.

## 9. Ordering principles extracted from the reference

The observed Daftra organization suggests these useful ordering principles:

1. **Domain first** — sales, purchases, accounting, customers, inventory, etc.
2. **Question/family second** — financial statements, journal reports, expenses, receipts, balances, aging, movements.
3. **Variant/dimension third** — by customer/vendor/employee/classification or by daily/weekly/monthly/yearly grain.
4. **Specific report last** — opening the actual report then reveals its filter contract and viewer.

This is substantially more scalable than one flat list.

## 10. Relationship to filters

Taxonomy and filters must be designed together.

A named report may be:

- a truly distinct accounting report;
- a presentation preset over a shared report engine;
- a grouping preset (`by customer`, `by employee`, etc.);
- a time-grain preset (`daily`, `weekly`, `monthly`, `yearly`).

AWJ must identify which case applies before creating separate endpoints or duplicated code.

## 11. Relationship to Viewer / PDF / export

Each taxonomy entry should ultimately reference three independent contracts:

1. **Filter Contract** — scope, dimensions, grouping, detail/summary, visible columns.
2. **Viewer Contract** — table/statement/analytics presentation and drill-down behavior.
3. **Document/Export Contract** — PDF/print/Excel/CSV behavior, orientation, pagination, repeated headers, subtotals/totals and chart inclusion where relevant.

Taxonomy must not encode PDF layout directly.

## 12. Proposed AWJ report-registry metadata — design input only

A future AWJ authoritative report registry should be capable of representing at least:

- stable report ID;
- domain/category;
- group/family;
- display order;
- route;
- permission;
- application entitlement;
- report semantic type;
- supported grouping dimensions;
- supported time grains;
- filter schema/contract;
- viewer type;
- summary/detail capability;
- column visibility capability;
- drill-down targets;
- PDF/print capability;
- Excel/CSV capability;
- mobile behavior;
- status: ready / planned / hidden;
- accounting/security notes.

This is intentionally metadata-oriented so AWJ can avoid hard-coding unrelated catalog, routing and permission definitions in multiple places.

## 13. Current AWJ comparison — high level

Current AWJ `report-catalog.tsx` has only five top-level categories:

- Sales
- Purchases
- General Accounts
- Customers
- Inventory

REPORTS-AUDIT-1 already found semantic destination duplication/gaps for customer statement/directory, supplier statement, and stock balances/inventory value.

The Daftra taxonomy reference strengthens the case for an authoritative AWJ taxonomy/registry, but does **not** justify copying every Daftra report.

## 14. Evidence still needed before declaring Daftra taxonomy complete

The following remain explicit research gaps:

- exact full report list and sub-group ordering under Sales;
- exact full report list and sub-group ordering under Purchases;
- exact full report list and sub-group ordering under Customers;
- exact full report list and sub-group ordering under Inventory;
- exact sub-groups for Cheques, SMS, points/balances, Employees, Memberships, Rentals, Workflow and Shipping Orders;
- plan/module-dependent visibility differences;
- whether some menu entries are aliases/presets versus independent report engines.

These gaps must be filled only from official Daftra documentation or direct screenshots/product observation. They must not be guessed.

## 15. AWJ decision gate

Before implementing Reports Hub V2:

1. Complete the Daftra evidence matrix as far as authoritative sources permit.
2. Complete AWJ REPORTS-AUDIT-2 for API/scope/permission/filter/export behavior.
3. Build `Daftra reference → AWJ current → AWJ target` mapping.
4. Owner approves AWJ taxonomy.
5. Only then implement registry/catalog/link/mobile changes in small PRs.

## 16. Safety rule

Daftra is a UX/product reference, not AWJ's accounting authority. AWJ's existing accounting invariants, tenant isolation, branch/warehouse scope, permissions, entitlements and backward compatibility remain authoritative.
