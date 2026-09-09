# Daftra Reports — PDF / Print / Export Reference

**Date:** 2026-09-09
**Status:** Research reference — no AWJ implementation authorized
**Purpose:** Record verified Daftra report document/export behavior to inform AWJ Reporting System V2 without conflating the interactive Report Viewer with PDF/print rendering.

## 1. Evidence boundary

This document distinguishes three evidence classes:

1. **Official Daftra documentation** — behavior explicitly described in public documentation.
2. **Owner-provided Daftra screenshots/PDF exports** — direct observed output reviewed during AWJ discovery.
3. **AWJ design inference** — recommended engineering principles derived from the evidence; these are not claims about undocumented Daftra internals.

We must not claim that Daftra uses a particular PDF engine, HTML/CSS library, pagination algorithm, browser renderer, or font-embedding implementation unless documented evidence is found. The public documentation reviewed describes user-facing behavior, not the internal rendering stack.

---

## 2. Verified export surface from official documentation

Across the reviewed Daftra report documentation, export/print is a recurring first-class report capability.

Common actions documented:

- Print
- CSV
- Excel
- PDF

Several analytical reports additionally distinguish:

- **PDF with chart**
- **PDF without chart**

This is explicitly documented for report families including sales and payment-style reports. The important architectural implication for AWJ is that the report's export contract can have variants; PDF is not necessarily a blind screenshot of the screen.

Examples reviewed in official Daftra documentation include:

- Customer statement: Print + CSV + Excel + PDF, with PDF page orientation and font-size settings.
- Supplier statement: Print + CSV + Excel + PDF, with PDF page orientation and font-size settings.
- Sales by customer: Print + CSV + Excel + PDF with chart + PDF without chart.
- Sales by employee: PDF with/without chart variants.
- Weekly payments: PDF with/without chart variants.
- Customer payments: PDF and PDF without chart.
- Purchase invoice payments: PDF and PDF without chart.
- Payroll: PDF and PDF without chart.
- Inventory movement details: Print + CSV + Excel + PDF.
- Balance sheet: Print + PDF + CSV + Excel.

---

## 3. Verified PDF settings

Official Daftra documentation for customer/supplier statements explicitly describes a settings control adjacent to PDF export with:

- **Page orientation:** portrait or landscape.
- **Font size:** configurable.

Owner-provided Daftra screenshots independently showed the PDF settings modal with page-orientation options and a font-size value.

### AWJ implication

Orientation and print font size belong to the **document/export renderer**, not to Report Viewer density. A wide report can remain interactive and horizontally scrollable on screen while its PDF chooses landscape orientation and an appropriate print font size.

---

## 4. Report Viewer is not the PDF document

The evidence supports a strict separation:

### Interactive Report Viewer

Optimized for:

- filters;
- live result refresh;
- summary/details switching where applicable;
- drill-down links;
- column visibility;
- horizontal navigation on narrow screens;
- operational inspection.

### PDF / Print document

Optimized for:

- physical page geometry;
- page orientation;
- print font size;
- pagination;
- repeated table context;
- grouping/subtotals/grand totals;
- stable company/report identity;
- chart inclusion/exclusion;
- deterministic printable output.

AWJ must not implement report PDF as a raw screenshot of the interactive viewport.

---

## 5. Observed structure of owner-provided Daftra PDFs

The Daftra PDF exports reviewed with the owner provide important output evidence beyond the public documentation.

### 5.1 First-page report identity

Observed reports establish document identity before/around the detailed data, including report/company context and the report period.

### 5.2 Charts where the report supports them

A reviewed detailed sales-by-customer PDF included analytical charts on the first page before the long detailed table. Official Daftra documentation separately confirms that some reports allow exporting PDF with or without charts.

Therefore charts are a report/export capability, not a mandatory component of every PDF.

### 5.3 Multi-page dense tables

Long reports continue across multiple physical pages instead of compressing the entire report until unreadable.

### 5.4 Repeated table context

The reviewed multi-page exports preserve table readability across page boundaries by carrying the table structure/header context into continued pages.

### 5.5 Grouped report sections

The reviewed detailed sales-by-customer export groups transactions under the relevant customer rather than flattening the whole report into an unstructured stream.

### 5.6 Subtotals and grand totals

Grouped sections contain subtotals where appropriate, and the report ends with overall totals. This is essential accounting/report-document behavior.

### 5.7 Negative/return semantics

Returns/credit-like values are visually distinguishable in reviewed output. AWJ should preserve semantic sign and document meaning; color alone must never be the only carrier of meaning.

---

## 6. Why the PDFs remain readable instead of being visually crushed

The evidence does **not** reveal Daftra's internal implementation. However, the resulting behavior demonstrates several document-level properties AWJ should require:

1. **Pagination instead of viewport capture.** Long data flows into pages.
2. **Document-specific column layout.** Screen width is not treated as the PDF width.
3. **Orientation control.** Wide reports can use landscape.
4. **Font-size control.** The user can tune document density/readability.
5. **Repeatable table structure.** Continued pages retain context.
6. **Group-aware page flow.** Groups, details and totals remain understandable across pages.
7. **Separate chart variant.** Users can omit charts when tabular data is the objective.
8. **Stable totals.** Totals are part of the report document, not incidental UI cards.

These are output requirements; they do not imply a specific renderer technology.

---

## 7. AWJ PDF renderer requirements for Reports V2

The following are proposed AWJ requirements derived from the reference and AWJ accounting constraints.

### 7.1 Deterministic document contract

A report export should be generated from a normalized `ReportDocument`-style data contract rather than directly from visible DOM state.

Candidate contract concepts:

- report ID/type;
- localized title;
- company identity;
- period/as-of date;
- applied filter summary;
- currency context;
- columns and alignment;
- groups;
- rows;
- subtotals;
- grand totals;
- optional chart blocks;
- orientation preference;
- print font size/density;
- footer/page-number metadata.

This is a proposed AWJ architecture, not a claim about Daftra internals.

### 7.2 Screen/PDF data parity

For identical report filters and permissions:

- PDF totals must equal screen totals.
- CSV/Excel totals/data semantics must not silently differ.
- hidden screen columns should not automatically mean omitted PDF columns unless export behavior explicitly says so.
- summary/detail export must clearly correspond to the selected export mode.

### 7.3 Pagination rules

The renderer should support:

- automatic page breaks;
- repeated table headers on new pages;
- avoidance of orphaned group headings where feasible;
- preservation of subtotal association with its group;
- grand total at the logical report end;
- page numbering;
- predictable margins/header/footer regions.

### 7.4 Wide-table rules

Do not solve a wide table by uncontrolled scaling to microscopic text.

Preferred decision order:

1. choose appropriate orientation;
2. use document-specific column widths;
3. wrap textual columns where safe;
4. keep numeric columns aligned and stable;
5. allow user-controlled print font size within safe bounds;
6. only omit columns when the report/export contract explicitly permits it.

### 7.5 RTL/LTR requirements

Arabic reports must be validated for:

- RTL text direction;
- correct Arabic shaping;
- no disconnected glyphs;
- numeric alignment;
- mixed Arabic/Latin codes and invoice numbers;
- currency symbols;
- parentheses/minus signs for negative values;
- table header alignment;
- page-number/footer placement.

English exports must remain correctly LTR. Bilingual company/customer/product data must not corrupt layout.

### 7.6 Accounting formatting

Financial document rendering must have explicit formatting rules for:

- decimal precision;
- thousands separators;
- zero values;
- negative amounts;
- debit/credit columns;
- currency labels;
- subtotals;
- grand totals;
- opening/previous balances;
- return/credit-note semantics.

No visual renderer may recalculate accounting values independently from the authoritative report data.

---

## 8. Print behavior

Official Daftra documentation consistently exposes a direct **Print** action separately from export options.

For AWJ, direct print should use the same authoritative report-document contract as PDF wherever possible, even if browser print and downloaded PDF use different technical paths.

Required parity:

- same report identity;
- same filters;
- same data scope;
- same totals;
- same grouping semantics;
- same orientation intent;
- no interactive controls in printed output.

Print preview must not accidentally include application navigation, filter controls, buttons, drawers, sticky UI, hover-only content, or horizontally clipped screen tables.

---

## 9. Export variants

The Daftra reference supports the idea that export capabilities are report-specific.

Proposed AWJ capability metadata:

```text
supportsCsv
supportsExcel
supportsPdf
supportsPrint
supportsPdfWithCharts
supportsPdfWithoutCharts
supportsSummaryExport
supportsDetailExport
supportsOrientation
supportsPrintFontSize
```

Do not expose an option unless that report/export path is actually supported and tested.

---

## 10. Anti-distortion / anti-corruption acceptance criteria

A report PDF/print implementation should not be considered complete merely because a file downloads.

Minimum acceptance criteria:

### Layout

- no clipped columns;
- no content outside page bounds;
- no overlapping text;
- no broken Arabic shaping;
- no unreadably tiny automatic scaling;
- no blank trailing pages caused by layout bugs;
- no missing repeated headers on long tables where context is required;
- no totals detached ambiguously from their group.

### Data

- screen/PDF totals match for the same scope;
- row counts/group counts are explainable;
- debit/credit and positive/negative semantics are preserved;
- branch/tenant/warehouse filters are identical to the authoritative report query;
- permission-redacted fields remain redacted in export;
- export cannot bypass a permission enforced on screen/API.

### Localization

- Arabic and English tested separately;
- mixed-content values tested;
- long customer/product/account names tested;
- large numeric values tested;
- zero/negative values tested.

### Pagination stress cases

Test at minimum:

- one-row report;
- exactly one-page report;
- row crossing page boundary;
- multi-page report;
- very long report;
- wide-column report;
- grouped report where a group spans pages;
- subtotal near a page boundary;
- grand total near a page boundary;
- report with charts;
- same report without charts.

---

## 11. Required automated and visual verification for AWJ

Because PDF quality is partly visual, unit tests alone are insufficient.

Recommended verification layers:

1. **Data-contract tests** — authoritative rows/totals/scope.
2. **Permission/scope tests** — tenant/branch/warehouse/cost visibility.
3. **PDF generation tests** — file generated and structurally valid.
4. **Content assertions** — expected title/totals/critical labels present.
5. **Pagination fixtures** — deterministic long/grouped/wide datasets.
6. **Visual regression/reference rendering** for representative Arabic and English reports where tooling permits.
7. **Manual production-like print check** before declaring a new report renderer complete.

Financial/security-sensitive tests must not be reduced to make the PDF layer easier to ship.

---

## 12. Relationship to REPORTS-AUDIT-2

`REPORTS-AUDIT-2` should now audit three independent contracts per report:

### A. Filter Contract
What filters/grouping/summary-detail/column controls the report supports.

### B. Viewer Contract
How results are displayed and navigated on desktop/tablet/mobile.

### C. Document Contract
What print/PDF/CSV/Excel variants exist, how document layout is configured, and whether output preserves scope/totals/permissions without clipping or distortion.

For each AWJ report, the audit matrix should record:

- current export actions;
- current PDF generator/path;
- current print path;
- chart inclusion support;
- orientation support;
- print font-size support;
- repeated-header behavior;
- grouping/subtotal/grand-total support;
- RTL/LTR validation evidence;
- pagination evidence;
- screen/export data parity tests;
- known distortion risks.

---

## 13. Official Daftra documentation reviewed for this document

Public Daftra documentation pages reviewed include:

- Customer Statement report
- Supplier Statement report
- Sales by Customer report
- Sales by Employee report
- Daily Sales report
- Weekly Payments report
- Customer Payments report
- Purchase Invoice Payments report
- Product Purchases by Product report
- Payroll report
- Detailed Inventory Movements per Product report
- Customer Balances report
- Balance Sheet report
- Attendance report examples

The documentation consistently establishes export/print behavior but does **not** expose the internal PDF rendering technology. AWJ should copy the successful user-facing principles, not invent assumptions about Daftra's implementation.

## 14. Decision for AWJ

Treat **Report Viewer**, **PDF/Print**, and **CSV/Excel data export** as related but distinct output surfaces sharing one authoritative report data/scope contract.

The objective is not visual imitation. The objective is reliable accounting documents that remain readable across page sizes, languages, long datasets, wide tables and grouped reports — without clipping, accidental omissions, permission leaks, or accounting divergence.
