# AWJ Reporting System V2 — Reference Notes & Current Direction

**Status:** Reference / Discovery — no implementation approved
**Date:** 2026-09-09
**Scope:** Reporting UX, report catalog/navigation, mobile report viewer, filters, print/export separation, and future audit of report wiring.

> This document records the current product direction from the Daftra report references reviewed with the owner. It is **not** an instruction to copy Daftra visually or functionally, and it does **not** authorize code changes, refactoring, accounting-rule changes, merge, deploy, or production release.

---

## 1. Why this document exists

AWJ already contains multiple reporting components and report workspaces, but the owner identified two distinct concerns:

1. The reporting experience — especially report density and mobile behavior — should preserve the feel of a real accounting report.
2. There are known/observed problems in how reports are linked and organized in AWJ. These must be audited systematically rather than fixed piecemeal without a map of the reporting system.

The current phase is **reference gathering and discovery only**.

---

## 2. Core terminology

### Reports Hub / Report Catalog
The entry point that organizes reports by business/accounting category and lets users discover the report they need.

### Report Filters
The report-specific criteria shown before or alongside report results: date range, customer, branch, employee, currency, classification, status, cost center, etc.

### Report Viewer
The on-screen workspace that displays a generated report and its results.

### Report Data Grid
The tabular results inside a Report Viewer.

### Print / PDF Export
A document-generation concern separate from the interactive on-screen Report Viewer. PDF may have page orientation, font size, pagination, repeating headers, and print-specific layout.

---

## 3. Owner-approved product direction from the reviewed references

### 3.1 Reports are a system, not isolated pages

The reporting architecture should be understood as:

`Reports Hub → Report Category → Specific Report → Filters → Report Viewer → Print / Export`

AWJ should avoid making users understand where a report happens to be implemented technically. Reports should be discoverable through a coherent accounting/business taxonomy.

### 3.2 The table is the hero for operational/accounting reports

For dense operational and accounting reports, the report table/data grid is the primary content. KPI cards and charts may support a report where useful, but should not displace the underlying accounting data.

This does not mean every analytical dashboard must be a table. It means dense reports should remain dense reports.

### 3.3 Mobile reports must remain real reports

This is a key direction.

For report viewers, mobile responsiveness must **not automatically transform report rows into cards**.

Preferred behavior for dense accounting reports:

- Preserve the complete tabular report structure.
- Preserve columns by default rather than silently dropping them because the viewport is narrow.
- Allow horizontal scrolling/swiping to reach off-screen columns.
- Allow normal vertical scrolling through rows.
- Preserve row/column relationships, totals, subtotals, and numeric comparison.
- Column visibility may be user-controlled where appropriate, but responsive layout alone should not remove accounting information.
- A future enhancement may freeze/stick the primary identifying column (account/customer/product/etc.) where technically and ergonomically appropriate.

The guiding mental model is:

> On mobile, the screen is a viewport over the full report — not a reason to replace the report with cards.

This rule is specific to report viewers and should not be generalized blindly to every list/table in AWJ.

### 3.4 Report filters may remain rich on mobile

The reviewed references show that complex report filters can remain available on mobile rather than being reduced to only a date selector. Relevant filter dimensions may include dates, customer/entity, classification, employee, follow-up state, branch, column visibility, currency, cost center, and report-specific options.

AWJ should design a consistent filter architecture while still allowing report-specific fields.

### 3.5 Report Viewer and PDF are separate products/surfaces

Do not force the interactive Report Viewer and exported PDF to share one layout.

**Report Viewer priorities:**
- fast interaction;
- filtering;
- sorting where relevant;
- dense data inspection;
- horizontal navigation on mobile;
- drill-down/open-details where relevant;
- saved views where useful.

**PDF/Print priorities:**
- page orientation;
- print font size;
- pagination;
- repeated table headers;
- document identity/company information;
- subtotals/grand totals;
- print-friendly chart/table layout where the report calls for it.

PDF orientation/font controls observed in the references belong to **PDF/print export settings**, not to Report Viewer density controls.

---

## 4. Useful patterns observed in the Daftra references

These are reference observations, not copy requirements.

### 4.1 Report catalog taxonomy

The reviewed General Accounts catalog grouped reports into meaningful families instead of one undifferentiated list. Examples observed include:

- General Accounts reports
- Journal Entry reports
- Expenses by classification/entity
- Expenses by time period
- Receipt Voucher reports by classification/entity
- Receipt Voucher reports by time period

Examples of report concepts observed include tax reports, tax return, income statement, treasury/balance-style reports, profit and loss, financial movements, cash flow, assets, trial balance variants, general ledger, cost centers, journal report, chart of accounts, and entity/time-based expense/receipt reports.

The broader navigation reference also showed many top-level report families such as sales, purchases, general accounts, cheques, points/balances, employees, memberships, rentals, workflow, shipping orders, customers, inventory, and account activity.

**AWJ takeaway:** the Reports Hub must scale to many categories and many reports without becoming an unstructured long list.

Potential AWJ improvements over the reference include:
- category hierarchy;
- report search;
- favorites;
- recently used reports;
- permission-aware visibility;
- consistent naming and descriptions.

### 4.2 Summary vs details

Some references expose summary/detail modes. AWJ should treat this as a report capability, not a universal mandatory toggle. Reports that naturally support aggregation/detail can expose both.

### 4.3 Column control

Column hiding/visibility is useful for wide reports, but it should be an explicit user choice rather than an automatic mobile data-loss strategy.

### 4.4 Export and print are first-class actions

Print/export should be consistently available where the report supports it, with PDF/print-specific settings separated from the interactive viewer.

---

## 5. Current AWJ implementation facts already identified

The following facts were observed in the repository during this discovery session and must be re-verified during the formal audit before implementation decisions are made.

### 5.1 Existing shared reporting pieces

AWJ already has shared/reporting infrastructure including concepts/components such as:

- `ReportFilters`
- `ReportDataTable`
- `ReportResultsTable`
- `ReportSavedViewsMenu` / saved report views
- `ReportsWorkspace`
- specialized report workspaces/filters for several domains
- report PDF generation/export paths

This means Reports V2 should prefer evolution/consolidation over rebuilding everything from zero.

### 5.2 Current mobile behavior conflicts with the new direction

At the time of this note, `ReportResultsTable` renders approximately as:

- mobile (`< md`) → `ReportMobileRows`
- desktop (`md+`) → `ReportDataTable`

The current `reports-workspace.tsx` also contains an explicit design comment describing dense tables as a desktop concern and touch-friendly rows as a screen priority.

This conflicts with the newly clarified product direction for dense accounting reports.

**Future audit question:** determine every report path that uses this behavior and whether any report already implements a full horizontally scrollable table on mobile.

### 5.3 Existing strengths should be preserved

The existing report table layer already appears to support useful capabilities such as compact density, column visibility, sorting, column ordering/sizing, saved views, totals, and row/detail actions in relevant paths.

Do not discard these capabilities merely to imitate another product's UI.

---

## 6. Known concern: report wiring / linkage

The owner reports problems with report linking in AWJ.

Do **not** assume the cause is only navigation. A formal audit must map each report end-to-end across:

1. Reports Hub/category placement
2. navigation/menu link
3. frontend route
4. report component/workspace
5. filters
6. API endpoint(s)
7. permissions/RBAC
8. tenant/company/branch scope
9. accounting/data source
10. drill-down/detail links
11. export/print paths
12. mobile behavior
13. empty/error/loading states

The audit should identify:

- broken links;
- wrong destinations;
- reports implemented but not discoverable;
- menu/catalog entries without a valid implementation;
- duplicate or overlapping reports;
- inconsistent naming;
- inconsistent filters;
- permission mismatches;
- branch/tenant scoping risks;
- endpoints used by multiple reports with incompatible assumptions;
- missing export/print wiring;
- disconnected detail/drill-down paths.

**Important:** reporting changes must not alter accounting semantics merely to make navigation/UI consistent.

---

## 7. Required formal audit before Reports V2 implementation

Create a complete report inventory with at least these columns:

| Field | Purpose |
|---|---|
| Report ID / key | Stable internal identifier if available |
| Arabic name | User-facing Arabic name |
| English name | User-facing English name |
| Category | Reports Hub taxonomy |
| Frontend route | Where it opens |
| Component/workspace | Main UI implementation |
| API endpoint(s) | Data source |
| Permission(s) | Required RBAC |
| Tenant scope | Isolation expectations |
| Branch scope | Branch filtering/aggregation behavior |
| Filters | Supported report criteria |
| Viewer type | Table / financial statement / analytical / other |
| Mobile behavior | Full table / cards / custom |
| Drill-down | Destination and behavior |
| Export | CSV/Excel/PDF/print support |
| Status | Working / broken / partial / orphaned / duplicate |
| Evidence | Files/tests/routes used to verify |

The audit must be evidence-based. Do not mark a report broken solely because its structure looks unusual.

---

## 8. Proposed future architecture direction — not yet approved for implementation

A likely target structure is:

### A. Reports Hub
- categorized report catalog;
- search;
- favorites/recent reports where justified;
- permission-aware report discovery;
- Arabic/English naming;
- scalable hierarchy for many domains.

### B. Shared Report Shell
- title/context;
- report actions;
- filter entry point;
- loading/error/empty states;
- consistent export/print actions.

### C. Shared Filter Framework
- common filters (date, branch, currency, etc.);
- report-specific extensions;
- mobile-friendly presentation;
- explicit apply/reset semantics where appropriate.

### D. Report Viewer Types
Not every report should be forced into one renderer. Candidate types:

1. Dense tabular report
2. Structured financial statement
3. Grouped/detail report
4. Analytical report with supporting charts

### E. Dense Mobile Report Grid
For tabular accounting reports:
- same logical columns as desktop by default;
- horizontal overflow/swipe;
- vertical scroll;
- totals/subtotals preserved;
- explicit column controls;
- investigate sticky primary column/header;
- RTL/LTR correctness;
- touch usability without replacing the grid with cards.

### F. Print / Export Pipeline
Independent print/PDF layout with report-specific document rules and consistent export controls.

---

## 9. Safety and compatibility constraints

Any future implementation must preserve:

- accounting accuracy;
- tenant isolation;
- branch/company scoping;
- permission enforcement;
- API backward compatibility unless explicitly approved;
- existing report semantics and totals;
- existing exports unless deliberately replaced and verified;
- RTL/LTR behavior;
- tests for financial/security-sensitive report paths.

No broad refactor should be bundled into a report-link fix without explicit approval.

---

## 10. Next step

**Next recommended task: `REPORTS-AUDIT-1 — AWJ Reporting Current-State & Wiring Audit`.**

This task should be **inspection/documentation only** first:

- inventory every report;
- map catalog/navigation → route → component → API → permission → scope → export;
- identify broken/orphaned/duplicated/inconsistent wiring;
- document current mobile renderer per report;
- compare the resulting inventory against the product direction in this file;
- produce a prioritized gap analysis.

Do not change production code during the audit.

After the audit is reviewed and approved, create a phased Reports V2 implementation plan with small PRs. Do not merge or deploy without explicit owner approval.
