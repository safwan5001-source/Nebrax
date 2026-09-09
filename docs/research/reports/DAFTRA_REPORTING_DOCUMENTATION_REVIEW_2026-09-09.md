# Daftra Reporting — Documentation Review for AWJ

**Date:** 2026-09-09
**Status:** Research reference only — no implementation approval
**Purpose:** Evidence-based review of Daftra's public reporting documentation to inform AWJ Reporting System V2.

> This file documents behaviors supported by Daftra's public documentation reviewed on 2026-09-09. It is not a requirement to copy Daftra and does not authorize changes to accounting logic, APIs, database schema, permissions, merge, deploy, or production.

---

## 1. Executive findings

The reviewed documentation supports a consistent reporting model across accounting, sales, purchases, customers, inventory, payments, expenses, and cost centers:

`Reports → Report family → Report → Filters → Generate/refresh → Results → Print/Export`

The strongest reusable patterns are:

1. **Large report catalog grouped by business domain.** Reports are discovered through families such as General Accounts, Sales, Purchases, Customers, and Inventory.
2. **Rich report-specific filters.** Date, branch, account, entity, employee, warehouse, cost center, currency, tags, document type, grouping, ordering, and column visibility appear where relevant.
3. **Summary/detail is a first-class capability on reports where aggregation makes sense.**
4. **Grouping is configurable on many reports**, sometimes changing the same underlying report between entity and time-based views.
5. **Column visibility is explicit user control** on wide reports.
6. **Tables remain the authoritative result surface.** Charts may supplement reports, while export can sometimes include or omit charts.
7. **Print/export is consistently exposed**, commonly CSV, Excel and PDF.
8. **Accounting reports preserve accounting semantics**, e.g. prior balance in General Ledger, account levels in Trial Balance, approved journal entries only in Journal Entries report, and cost-center filtering/grouping.
9. **Branches are a recurring reporting dimension**, but branch semantics differ by report (account branch, journal branch, transaction branch, etc.).
10. The documentation supports rich on-screen reports, but it does **not** provide a formal design-system specification for row height, font size, responsive breakpoints, or mobile horizontal-scroll behavior. The mobile full-table swipe behavior observed by the owner is therefore recorded separately as direct product observation, not as a claim derived from the public docs.

---

## 2. Report catalog / taxonomy evidence

### General Accounts
Public documentation confirms a General Accounts reporting family containing reports such as:
- Trial Balance — balances;
- Trial Balance — totals and balances;
- General Ledger;
- Review Account;
- Journal Entries;
- Cost Centers;
- Cash Flow;
- Balance Sheet;
- Expenses reports.

The owner-provided product screenshots show additional catalog entries and subgrouping. Screenshot-derived catalog observations must remain distinguished from public-doc evidence.

### Sales
Reviewed documentation includes:
- Sales by customer;
- Sales by employee;
- Item sales by sales representative;
- Payments by customer;
- Payments by employee;
- Net Sales Invoice Position.

### Purchases
Reviewed documentation includes:
- Purchases by employee;
- Product purchases by employee;
- Supplier purchases;
- Daily payments;
- Supplier balances;
- Purchase invoice payments;
- Supplier debt aging (General Ledger model);
- Net Purchase Invoice Position.

### Customers
Reviewed documentation includes:
- Customer sales;
- Customer payments;
- Customer balances;
- Customer debt aging.

### Inventory
Reviewed documentation includes:
- Detailed Inventory Movement;
- Inventory Operations Summary.

**AWJ implication:** the Reports Hub must support a growing, categorized catalog. A flat menu will not scale well.

---

## 3. Common report lifecycle

Across the reviewed docs, the recurring workflow is:

1. Open **Reports**.
2. Select a report family.
3. Select a specific report.
4. Configure report-specific filters.
5. Press **View Report / Show Report / Search** to refresh results.
6. Inspect tabular results, grouping, totals and/or charts.
7. Print or export.

This suggests a stable conceptual contract for AWJ even if individual reports have different filters/renderers.

---

## 4. Filter architecture observed

Daftra does not force every report into the same filter set. Instead, common dimensions are reused and specialized filters appear where meaningful.

### Common dimensions
- date from/to;
- branch;
- entity (customer/supplier/product/account/employee);
- currency;
- grouping;
- column visibility.

### Accounting-specific dimensions
- main vs sub account;
- specific account/main account;
- account level;
- account branch;
- journal-entry branch;
- cost center;
- tags;
- show all accounts / accounts with transactions / hide zero accounts / hide zero balances;
- fiscal year where applicable.

### Sales/customer dimensions
- customer/customer classification;
- invoice creator;
- sales representative;
- payment collector;
- payment method;
- treasury;
- document type;
- follow-up/status dimensions where applicable.

### Purchase dimensions
- supplier;
- employee;
- product;
- payment dimensions;
- branch;
- document-type-related exclusions.

### Inventory dimensions
Detailed Inventory Movement documents:
- date range;
- product;
- warehouse;
- movement type.

Movement types documented include sales/purchase invoices and returns, assembled products, stock permits, stocktakes, transfers, manufacturing orders, and manual adjustments.

**AWJ implication:** build a shared filter framework with typed report-specific extensions; do not create one giant universal filter form.

---

## 5. Summary vs details

This is explicitly documented on several report families.

Examples:
- Payments by employee: summary shows total payments per employee; details shows each payment with invoice/customer/method information.
- Payments by customer: summary shows total per customer; details shows individual payment records.
- Expenses: documentation supports summary vs detailed presentation.
- Customer Balances: documentation supports summary totals per customer vs transaction-level details.

**Conclusion:** `summary/details` should be modeled as an optional report capability. It is not justified as a mandatory control on every report.

---

## 6. Grouping as a core reporting capability

Grouping is not merely presentation decoration; it can change the analytical meaning of the report.

### Sales
Sales documentation states that grouping can change between customer, employee, sales representative, or time period (daily/weekly/monthly/yearly), depending on the report.

### Payments
Payments by employee documents grouping options including daily, weekly, monthly, yearly, invoice creator employee, collector employee, customer, and payment method.

Customer payments documents grouping by customer, treasury, payment method, or branch, plus ordering by date ascending/descending.

### Cost Centers
Cost Center report supports grouping by cost centers, subaccounts, or time period.

### Expenses
Time-based expense reporting supports daily/weekly/monthly/yearly views and other dimensions such as classification, employee, vendor, treasury, and branch.

**AWJ implication:** grouping should be represented as report metadata/capability rather than implemented ad hoc in unrelated pages.

---

## 7. Column visibility and wide reports

Public docs explicitly document **Hide Columns** on multiple reports.

### Customer Balances
Documented hideable columns include code, account number, name, customer branch, manual status, employee, prior balance, total sales, total returns, net sales, total payments, adjustments, and balance.

### Customer Payments
Documented hideable columns include ID, date, customer code/name, type, document number, payment method, treasury, amount, employee, collected by, branch, and added by.

### Net invoice-position reports
Sales and purchase net-position documentation includes a Hide Columns filter.

**Conclusion for AWJ:** wide reports are expected to remain information-rich, while the user can explicitly control visibility. Responsive behavior should not silently delete financial columns.

---

## 8. General Ledger behavior

The General Ledger documentation is especially relevant to AWJ accounting reports.

Documented filters include:
- date range;
- main/sub account type;
- account selection;
- account branch;
- added by;
- journal branch;
- one or more cost centers;
- account visibility mode (all, accounts with transactions, hide zero accounts, hide zero balances).

The documentation states that the report begins with the **prior balance** before displaying movements in the selected period.

**AWJ requirement candidate:** when auditing AWJ General Ledger, verify opening/prior balance semantics, branch semantics, cost-center filtering, and zero-account visibility separately; these are accounting behaviors, not UI details.

---

## 9. Trial Balance behavior

Reviewed documentation confirms multiple Trial Balance forms rather than one generic table:

- balances only;
- totals and balances;
- account-level selection.

Filters documented across these forms include:
- period;
- account type;
- account/main account;
- account branch;
- account level;
- cost centers;
- tags;
- prior-balance presentation mode (net balances vs debit/credit shown separately).

**AWJ implication:** do not collapse distinct accounting report semantics merely to simplify navigation. The catalog may unify discovery while preserving separate report definitions.

---

## 10. Journal Entries report behavior

The Journal Entries report supports cost-center filtering and grouping by journal entry or branch.

A critical documented accounting rule: **draft journal entries do not affect the Journal Entries report until they are approved/saved as an approved journal entry.**

**AWJ audit checkpoint:** report inclusion must be checked against AWJ journal lifecycle/status rules. Do not infer that every stored journal-like record belongs in financial reports.

---

## 11. Cost Center reporting

Cost Center report documentation supports:
- grouping by cost centers, subaccounts, or time period;
- main cost center;
- sub cost center;
- subaccount;
- date range;
- one or more branches;
- print/export CSV, Excel, PDF.

Separate Daftra documentation also exposes cost-center movements and access to the Cost Center report from cost-center management, indicating that reports can have more than one contextual entry point.

**AWJ implication:** a report may be discoverable from Reports Hub and contextually from its domain page, but both should resolve to the same canonical report definition/route where possible.

---

## 12. Cash Flow and Balance Sheet

### Cash Flow
Documentation confirms:
- access under General Accounts reports;
- date range;
- branch filtering;
- account customization controlling account visibility.

### Balance Sheet
Documentation confirms:
- period from/to;
- account hierarchy levels (1–5/default levels);
- cost centers including transactions without cost centers;
- fiscal-year selector when fiscal years have been closed;
- vertical and horizontal report presentation modes.

**AWJ implication:** structured financial statements need a renderer different from generic transaction grids. Report Viewer V2 should support multiple renderer types under one reporting architecture.

---

## 13. Inventory reporting

### Detailed Inventory Movement
The documented report includes an opening quantity before the selected start date, followed by individual movements.

Documented columns:
- time;
- movement type;
- product code;
- product;
- incoming;
- outgoing;
- notes;
- warehouse.

### Inventory Operations Summary
Documentation describes movement summarized by source/type with incoming/outgoing groupings and total movement.

**AWJ implication:** inventory reports need traceability back to movement source and must preserve unit/quantity semantics. Do not treat them as generic sales tables.

---

## 14. Customer/Supplier balance patterns

### Customer Balances
The documentation describes a row per customer summarizing account movement over the selected period and supports summary/details, column visibility, print/export.

The owner-provided screenshots show a particularly wide customer-balance table containing identity/account fields plus prior balance, sales, returns, payments, adjustments and resulting balance. On mobile, the owner directly observed the full table remaining available through horizontal swipe.

### Supplier Balances
Documentation describes prior balance, total purchases, returns, payments, adjustments, and current balance for each supplier.

**AWJ implication:** customer and supplier balance reports should be modeled symmetrically where accounting semantics permit, while preserving their actual debit/credit meaning.

---

## 15. Export and print behavior

Across the reviewed documentation, report actions repeatedly include:
- Print;
- CSV;
- Excel;
- PDF.

Some sales/payment reports document:
- PDF with chart;
- PDF without chart.

This supports the conclusion that charts are optional supporting output rather than a replacement for tabular data.

The owner's direct screenshots also show PDF/print configuration including page orientation and font size. Those controls are **export/print settings**, not evidence of Report Viewer density settings.

**AWJ implication:** define export capabilities per report and keep print/PDF rendering separate from interactive screen rendering.

---

## 16. Mobile behavior — evidence boundary

### Supported by owner's direct product observation
The owner demonstrated Daftra on mobile where a wide report remains a full table and is navigated horizontally by swiping left/right while vertical scrolling moves through rows.

### Not established by public documentation reviewed
The reviewed public docs do not define:
- CSS breakpoints;
- exact table minimum widths;
- row heights;
- mobile font sizes;
- sticky-column behavior;
- a formal rule that every Daftra report uses horizontal overflow on mobile.

Therefore AWJ may adopt the observed behavior as a product direction, but must not describe it as a formally documented Daftra design-system rule.

---

## 17. Important semantic cautions learned from Daftra docs

1. **Branch is not one universal field.** General Ledger distinguishes account branch and journal-entry branch. AWJ must map branch semantics report-by-report.
2. **Expenses report scope can differ from accounting-ledger scope.** Daftra's expenses report documentation notes that it includes expenses recorded through the Expenses section and not expenses recorded as journal entries; the General Ledger is used to see all expenses. AWJ must document its own source-of-truth semantics instead of copying this behavior blindly.
3. **Draft/approved state matters.** Journal report inclusion depends on approved journal status in Daftra.
4. **Opening/prior values matter.** General Ledger and inventory movement reports explicitly include prior/opening values.
5. **Grouping can materially change interpretation.** It should be tested, not treated as cosmetic UI.
6. **Financial statements may need hierarchy/structured rendering**, not a generic DataTable.

---

## 18. Recommended AWJ capability model derived from the research

Each AWJ report definition should eventually be able to declare capabilities such as:

- category;
- renderer type;
- supported common filters;
- specialized filters;
- grouping options;
- ordering options;
- summary/detail support;
- column visibility;
- hierarchy/levels;
- totals/subtotals;
- opening/prior balance behavior;
- contextual drill-down links;
- branch semantics;
- cost-center semantics;
- export formats;
- chart support;
- mobile overflow strategy;
- permissions;
- tenant/company scope.

This is a design direction only. Do not introduce a new schema/API until the AWJ current-state audit proves it is necessary.

---

## 19. Public documentation sources reviewed

Official Daftra documentation reviewed on 2026-09-09:

- Sales by employee — https://docs.daftra.com/tutorial/تقرير-المبيعات-حسب-الموظف/
- Sales by customer — https://docs.daftra.com/tutorial/تقرير-المبيعات-حسب-العميل/
- Payments by employee — https://docs.daftra.com/tutorial/عرض-تقرير-المدفوعات-حسب-الموظف/
- Payments by customer — https://docs.daftra.com/tutorial/عرض-تقرير-المدفوعات-حسب-العميل/
- Cash Flow — https://docs.daftra.com/tutorial/تقرير-التدفقات-النقدية-في-دفترة-وكيفي/
- Purchases by employee — https://docs.daftra.com/tutorial/عرض-تقرير-المشتريات-حسب-الموظف/
- Customer Payments — https://docs.daftra.com/tutorial/عرض-تقرير-مدفوعات-العملاء/
- Expenses reports — https://docs.daftra.com/tutorial/تقارير-المصاريف/
- Expenses by time period — https://docs.daftra.com/tutorial/تقارير-المصروفات-حسب-المدة-الزمنية/
- Trial Balance — balances — https://docs.daftra.com/tutorial/عرض-تقرير-ميزان-مراجعة-أرصدة-2/
- Review Account — https://docs.daftra.com/tutorial/عرض-تقرير-حساب-مراجعة/
- Trial Balance — totals and balances — https://docs.daftra.com/tutorial/عرض-تقرير-ميزان-المراجعة-مجاميع-وأرصد/
- Trial Balance by level — https://docs.daftra.com/tutorial/عرض-تقرير-ميزان-المراجعة-بحسب-المستوي/
- Detailed Inventory Movement — https://docs.daftra.com/tutorial/عرض-تقرير-الحركة-التفصيلية-للمخزون/
- Customer Balances — https://docs.daftra.com/tutorial/عرض-تقرير-أرصدة-العملاء/
- Cost Centers report — https://docs.daftra.com/tutorial/عرض-تقرير-مراكز-التكلفة/
- General Ledger — https://docs.daftra.com/tutorial/عرض-تقرير-حساب-الأستاذ/
- Balance Sheet — https://docs.daftra.com/tutorial/عرض-تقرير-الميزانية-العمومية/
- Journal Entries — https://docs.daftra.com/tutorial/عرض-تقرير-قيود-اليومية/
- Inventory Operations Summary — https://docs.daftra.com/tutorial/عرض-تقرير-ملخص-عمليات-المخزون/
- Customer debt aging — https://docs.daftra.com/tutorial/تقرير-أعمار-الديون-حساب-الأستاذ/
- Supplier debt aging — https://docs.daftra.com/tutorial/عرض-تقرير-أعمار-المدين-للموردين-حساب-الا/
- Supplier Balances — https://docs.daftra.com/tutorial/عرض-تقرير-أرصدة-الموردين/
- Purchase invoice payments — https://docs.daftra.com/tutorial/عرض-تقرير-مدفوعات-فواتير-الشراء/
- Customer Sales — https://docs.daftra.com/tutorial/عرض-تقرير-مبيعات-العملاء/
- Supplier Purchases — https://docs.daftra.com/tutorial/عرض-تقرير-مشتريات-الموردين/
- Net Sales Invoice Position — https://docs.daftra.com/tutorial/عرض-تقرير-صافي-وضع-فواتير-المبيعات/
- Net Purchase Invoice Position — https://docs.daftra.com/tutorial/تقرير-صافي-وضع-فواتير-المشتريات/
- Cost Center guide — https://docs.daftra.com/user_manual/دليل-مراكز-التكلفة-في-دفترة/

---

## 20. Next use of this research

Use this research as an input to `REPORTS-AUDIT-1 — AWJ Reporting Current-State & Wiring Audit`.

The audit must compare AWJ against **capabilities and accounting semantics**, not against Daftra screen styling. Any difference may be intentional and should be classified before proposing a change.
