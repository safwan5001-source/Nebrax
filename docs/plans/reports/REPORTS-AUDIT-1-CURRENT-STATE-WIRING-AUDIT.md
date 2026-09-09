# REPORTS-AUDIT-1 — AWJ Reporting Current-State & Wiring Audit

**Status:** Inspection / documentation only — no production code changes
**Date:** 2026-09-09
**Repository:** `safwan5001-source/Nebrax`
**Reference:** `docs/plans/reports/AWJ_REPORTING_SYSTEM_V2_REFERENCE_NOTES.md`
**External research reference:** `docs/research/reports/DAFTRA_REPORTING_DOCUMENTATION_REVIEW_2026-09-09.md`

> This audit records repository evidence about the current AWJ reporting catalog and wiring. It does not authorize implementation, accounting changes, merge, deploy, or production release.

## 1. Audit classification

Each finding is classified as:

- **Verified Working** — repository evidence establishes the intended route/workspace/API wiring and, where material, tests exist.
- **Verified Gap** — repository evidence establishes a structural/catalog gap or duplicate/misdirected semantic destination.
- **Needs Runtime Verification** — static code is insufficient to prove the user-visible behavior is correct or broken.

A link is not called broken merely because its architecture differs from Daftra.

## 2. Current Reports Hub inventory

`report-catalog.tsx` defines only five top-level categories:

1. Sales
2. Purchases
3. General Accounts
4. Customers
5. Inventory

This is materially narrower than the report-family breadth recorded in the Daftra research reference. That comparison is a product-coverage observation, not proof that AWJ must implement every Daftra category.

### 2.1 Sales catalog

| Catalog item | Frontend destination | Static status |
|---|---|---|
| POS session | `/pos/report` | Needs Runtime Verification — external to shared report route family |
| Sales by period | `/reports/sales/by-period` | Verified Working wiring |
| Sales by customer | `/reports/sales/by-customer` | Verified Working wiring |
| Sales by product | `/reports/sales/by-product` | Verified Working wiring |
| Sales by classification | `/reports/sales/by-classification` | Verified Working wiring |
| Sales by representative | `/reports/sales/by-salesperson` | Verified Working wiring |
| Sales profitability | `/reports/sales/profitability` | Verified Working wiring |
| Sales payments by period | `/reports/sales/payments` | Verified Working wiring |

The dynamic sales route maps all seven `/reports/sales/*` slugs above to `SalesReportsWorkspace` views. The workspace calls one shared API contract, `/reports/sales`, with a `view` query parameter and report-specific filters.

Observed sales filter contract includes date range, branch IDs, customer, customer classification, product, product category, classification, salesperson, payment status, receipt method, and interval where applicable.

Sales customer/product rows also provide drill-down links to `/partners/{id}` and `/products/{id}` respectively.

The workspace provides CSV, PDF, PDF sharing, print and preview actions. Customer/product/salesperson reports expose presentation modes (summary/detail) in the UI.

**Important implementation note:** a source comment explicitly states that preview/mock mode does not yet have a sales-report API source and invalid/incomplete responses are surfaced as an explicit load failure rather than treated as a real report. This is not a production API wiring failure by itself.

### 2.2 Purchases catalog

| Catalog item | Frontend destination | Static status |
|---|---|---|
| Supplier aging | `/reports/purchases/aging` | Verified Working route wiring; API behavior separately tested |
| Supplier statement | `/suppliers` | **Verified Gap — semantic catalog destination is not a dedicated Report Viewer** |
| Purchases by period | `/reports/purchases/by-period` | Verified Working wiring |
| Purchases by supplier | `/reports/purchases/by-supplier` | Verified Working wiring |
| Purchases by product | `/reports/purchases/by-product` | Verified Working wiring |
| Purchases by classification | `/reports/purchases/by-classification` | Verified Working wiring |
| Purchases by employee | `/reports/purchases/by-employee` | Verified Working wiring |
| Supplier balances | `/reports/purchases/balances` | Verified Working wiring |
| Supplier payments | `/reports/purchases/payments` | Verified Working wiring |

The dynamic purchases route maps seven report slugs to `PurchasesReportsWorkspace`. Supplier aging is a separate route using `ReportsWorkspace` with `fixedAgingType="payable"`.

The backend exposes `/reports/purchases` behind `reports.view`; a separate creators endpoint also exists.

**Gap interpretation:** the catalog labels `supplierStatement` as an available report but sends the user to the general suppliers area. Static inspection cannot prove whether a statement is immediately accessible there. Therefore the catalog/report semantic mismatch is verified, while the user-visible severity still needs runtime verification.

### 2.3 General Accounts catalog

| Catalog item | Frontend destination | Static status |
|---|---|---|
| Trial balance | `/reports/general/trial-balance` | Verified Working wiring |
| Income statement | `/reports/general/income-statement` | Verified Working wiring |
| Balance sheet | `/reports/general/balance-sheet` | Verified Working wiring |
| Cost-center profitability | `/reports/general/cost-center-profitability` | Verified Working wiring |
| Classification analytics | `/reports/classification-analytics` | Needs separate route/workspace audit |
| Account ledger | `/reports/general/account-ledger` | Verified Working route/API wiring |
| Cash flow | `/reports/general/cash-flow` | Verified Working route wiring |
| Journal entries | `/reports/general/journal-entries` | Verified Working route wiring |
| Tax report | `/reports/general/tax-report` | Verified Working route wiring |

General Accounts currently uses two renderer/workspace families:

- `ReportsWorkspace`: trial balance, income statement, balance sheet, cost-center profitability.
- `GeneralAdvancedReportsWorkspace`: account ledger, cash flow, journal entries, tax report.

Backend evidence confirms report endpoints protected by `reports.view`, including trial balance, income statement, balance sheet and account ledger. Existing tests exercise trial balance branch behavior and balance invariants.

**Conclusion:** the split between standard and advanced workspaces is architectural fragmentation, but it is **not** classified as a bug without behavioral evidence.

### 2.4 Customers catalog

| Catalog item | Frontend destination | Static status |
|---|---|---|
| Customer aging | `/reports/customers/aging` | Verified Working route wiring; API behavior separately tested |
| Customer statement | `/partners` | **Verified Gap — semantic catalog destination is not a dedicated Report Viewer** |
| Customer directory | `/partners` | **Verified Gap — same destination as customer statement** |
| Customer balances | `/reports/customers/balances` | Verified Working wiring |
| Customer sales | `/reports/customers/sales` | Verified Working wiring |
| Customer payments | `/reports/customers/payments` | Verified Working wiring |
| Customer appointments | `/reports/customers/appointments` | Verified Working wiring |

The dynamic customers route only recognizes `sales`, `balances`, `payments`, and `appointments`. Customer aging is a dedicated route using `ReportsWorkspace` with `fixedAgingType="receivable"`.

The backend exposes `/reports/customers` behind `reports.view`.

Aging is backed by `/api/reports/aging/receivable` / payable behavior. Existing feature tests verify authentication contract and branch partner isolation for receivable aging.

**Key catalog issue:** two distinct available report concepts — customer statement and customer directory — both resolve to the same generic `/partners` page. This is a concrete catalog/wiring design gap. Runtime verification is still required to determine whether the partners page provides contextual paths that partially mitigate it.

### 2.5 Inventory catalog

| Catalog item | Frontend destination | Static status |
|---|---|---|
| Stock balances | `/reports/inventory/value` | **Verified Gap — duplicates Inventory Value destination** |
| Product movements | `/reports/inventory/movements` | Verified Working wiring |
| Stock count | `/reports/inventory/stocktakes` | Verified Working wiring |
| Inventory value | `/reports/inventory/value` | Verified Working wiring |
| Inventory operations | `/reports/inventory/operations` | Verified Working wiring |
| Warehouse balances | `/reports/inventory/warehouses` | Verified Working wiring |
| Inventory aging | none | Explicit `soon` — not a broken link |
| Inventory turnover | none | Explicit `soon` — not a broken link |

The dynamic inventory route recognizes `value`, `warehouses`, `movements`, `operations`, and `stocktakes`, all using `InventoryReportsWorkspace`.

The backend exposes `/reports/inventory` behind both `reports.view` and the `inventory.core` application entitlement.

**Concrete catalog issue:** `stockBalances` and `inventoryValue` are presented as two available reports but both open the same `value` report route. This may be an intentional alias, but the catalog currently communicates two distinct report concepts without distinct behavior. Treat as a verified product/wiring gap pending owner decision on whether they should be aliases or separate reports.

## 3. Backend permission and entitlement wiring

Repository evidence confirms shared report endpoints are permission-gated with `reports.view` for sales, purchases, customers, classification analytics, and core accounting reports.

Inventory additionally requires the `inventory.core` application entitlement.

This is a strength and must not be weakened during Reports V2 consolidation.

A later security audit must still verify that each controller/service applies the correct tenant/company/branch/warehouse scope internally. Route middleware alone is not sufficient evidence for data isolation.

## 4. Branch and scope evidence

There is existing test evidence that financial reports are not completely untested around branch behavior:

- Trial balance is exercised with branch filters and balance assertions.
- Document branch scope tests verify financial report totals/balance under branch context.
- Receivable aging has branch partner-isolation coverage.

This means Reports V2 must preserve these contracts and should not replace report endpoints merely for UI uniformity.

## 5. Confirmed structural findings

### P1 — preserve, not a defect

1. `reports.view` is consistently visible on major report API routes inspected.
2. Inventory reporting has an additional application entitlement guard.
3. Core financial reports have existing branch/accounting test coverage.
4. Sales report rows have explicit customer/product drill-down wiring.
5. Sales export/print actions are already first-class and should be evolved rather than rebuilt without reason.

### P2 — verified product/wiring gaps

1. **Customer Statement → `/partners`** instead of a dedicated report destination.
2. **Customer Directory → `/partners`**, identical destination to Customer Statement despite being presented as a distinct report.
3. **Supplier Statement → `/suppliers`** instead of a dedicated report destination.
4. **Stock Balances and Inventory Value → identical `/reports/inventory/value` destination** while presented as distinct reports.
5. Reports Hub taxonomy has only five top-level categories; current report implementations are therefore not yet modeled as a broad ERP reporting subsystem comparable to the documented reference breadth.

Items 1–4 are static catalog/wiring facts. Whether each requires a new report implementation versus a renamed/deep-linked catalog item is a product decision and must not be guessed.

### P2 — architecture consistency gaps

1. General reports are split between `ReportsWorkspace` and `GeneralAdvancedReportsWorkspace`.
2. Aging reports are special routes into `ReportsWorkspace`, while customer/purchase domain reports use dedicated workspaces.
3. POS reporting lives outside the shared `/reports/...` route family.
4. The catalog itself is a hard-coded array of report definitions rather than a single registry demonstrably shared with route/API/permission metadata.

These are maintainability/discoverability risks, not automatically user-facing bugs.

## 6. Mobile Report Viewer finding

The separate Reporting V2 reference already records the confirmed current pattern in the shared result layer:

- mobile (`< md`) → mobile rows representation;
- desktop (`md+`) → dense `ReportDataTable`.

This conflicts with the owner-approved direction for dense accounting reports: retain the real table on mobile and use horizontal scrolling instead of automatic card/row transformation.

This should be fixed only after identifying every report using the shared result component, so ordinary non-report lists are not affected.

## 7. Comparison with Daftra documentation — bounded conclusions

The Daftra documentation research establishes reusable reporting capabilities such as rich report-specific filters, grouping dimensions, summary/detail modes in applicable reports, column visibility, accounting opening/previous balances, and first-class export/print.

AWJ already has portions of these capabilities. The primary current gap is therefore **not simply “AWJ lacks reports.”** It is a combination of:

- catalog breadth/taxonomy;
- semantic linking/discoverability;
- inconsistent workspace families;
- incomplete report concepts/aliases;
- mobile viewer behavior;
- need for an authoritative report registry/inventory;
- need to verify scope/permissions/export end-to-end per report.

Do not copy Daftra's report list mechanically. AWJ report scope must follow AWJ modules, accounting model, entitlements, and customer needs.

## 8. Items still requiring deeper audit/runtime evidence

Before implementation planning is considered final, verify:

1. Every report workspace's exact API query contract.
2. Every report controller/service's tenant/company/branch/warehouse scoping.
3. Permission-denied behavior at both catalog and direct-route levels.
4. Whether catalog hides reports the actor cannot use, or only blocks after navigation.
5. Customer/Supplier statement UX reached from `/partners` and `/suppliers`.
6. Whether `stockBalances` and `inventoryValue` are intentionally identical aliases.
7. Classification Analytics end-to-end wiring.
8. POS report integration and permission model.
9. Export/print parity across all report families, not just sales.
10. All drill-down links and whether they preserve scope/date/filter context.
11. Saved Views behavior across report families.
12. Actual mobile rendering for each viewer type.
13. Arabic/English route labels and report titles.
14. Empty/error/loading states.
15. Runtime link checks for every `ready` catalog entry.

## 9. Recommended implementation sequence — not authorized yet

Do not start code changes from this audit without owner approval.

Recommended future sequence:

1. **REPORTS-AUDIT-2 — Deep Scope/Permission/API Audit**
   - inspect controllers/services/tests for every report family;
   - prove tenant/branch/warehouse semantics;
   - complete the report registry matrix.

2. **REPORTS-ARCH-1 — Authoritative Report Registry & Taxonomy Design**
   - design one source of truth for catalog metadata, routes, permissions, entitlements, viewer type and export capabilities;
   - no accounting semantic changes.

3. **REPORTS-LINK-1 — Catalog Link Corrections**
   - resolve statement/directory/stock-value semantic duplicates with owner-approved behavior;
   - small PR, no unrelated refactor.

4. **REPORTS-MOBILE-1 — Dense Report Grid on Mobile**
   - report viewers only;
   - preserve complete table semantics and horizontal swipe/scroll;
   - do not globally alter ordinary application tables.

5. Subsequent report-coverage PRs only after the registry and gap matrix are approved.

## 10. Audit conclusion

AWJ already has a meaningful reporting foundation. The repository does **not** support the conclusion that the reporting system should be rebuilt from zero.

However, the owner-reported linking concern is substantiated at the catalog level: several items advertised as distinct, ready reports either route to generic entity pages or share an identical destination with another report concept.

The safest direction is to preserve the tested accounting/report APIs, create an authoritative report map, correct semantic catalog wiring in small steps, and separately modernize the Report Viewer/mobile behavior.
