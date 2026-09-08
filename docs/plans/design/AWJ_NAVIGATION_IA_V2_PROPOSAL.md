# AWJ Design System V2 — Navigation IA V2 Proposal

**Status:** PROPOSAL FOR OWNER REVIEW — NOT IMPLEMENTATION APPROVAL
**Date:** 2026-09-08
**Scope:** Proposed global navigation information architecture derived from the current AWJ application and the Navigation IA audit. No routes, permissions, entitlements, accounting behavior, APIs, database structures, or production UI are changed by this document.

## 1. Decision objective

AWJ V2 should reduce global navigation entropy without reducing operational speed.

The proposed hierarchy is:

**Global Destination → Module / Workspace → Page Pattern → Contextual Actions**

The Sidebar should answer **“Where can I go?”**. It should not become a permanent catalog of every route, create action, tab, report, and setting in the product.

## 2. Evidence from current AWJ

The current `web/src/components/layout/sidebar.tsx` exposes 14 business/admin groups and many route-level shortcuts. It already contains valuable behavior that V2 must preserve:

- application-entitlement-aware visibility via `appKey`;
- RBAC-aware visibility via `permission`;
- non-interactive super-group labels rather than a third interactive nesting level;
- a dedicated Fuel Stations workspace with one global entry;
- specialized POS workspace behavior;
- branch administration separated conceptually from the active branch context;
- direct permission gates for sensitive accounting governance destinations such as Period Locks and Fiscal Years.

The current Reports implementation is also clearly a first-class workspace rather than a settings page: `/reports` renders a catalog with Sales, Purchases, General, Customers, and Inventory categories and routes into dedicated report pages/workspaces.

## 3. Proposed primary navigation

The V2 Sidebar should prototype the following primary destinations, subject to entitlement/RBAC filtering:

| Order | Destination | Role in IA |
|---:|---|---|
| 1 | Home | role-aware overview / return point |
| 2 | Sales | sales documents and revenue workflow workspace |
| 3 | Customers | customer master, contacts, appointments, CRM |
| 4 | Purchases | procure-to-pay workspace |
| 5 | Products & Inventory | product master and stock operations |
| 6 | Accounting | ledger, journals, assets, cost centers, accounting governance |
| 7 | Finance | cash/bank, expenses, vouchers, custodies |
| 8 | Reports | cross-domain report catalog/workspaces |
| 9 | HR | employee/payroll/attendance/request workspace |
| 10 | POS | operational sales workspace, when enabled |
| 11 | Specialized Operations | enabled specialist workspaces such as Document Center and Fuel Stations |
| 12 | Administration | branch administration and system/business configuration |
| 13 | Developer | integration/developer workspace when permitted |

This is intentionally a destination-level model. It is not a proposal to rename or remove routes.

## 4. Proposed destination ownership

### Home

Global entry:

- Dashboard / Home.

Home should not become a second navigation catalog. It may provide role-aware summaries, recent work, alerts, shortcuts, and business state while global navigation remains authoritative.

### Sales

Global entry:

- Sales workspace / primary sales destination.

Workspace-owned destinations/actions:

- Sales invoices.
- Delivery notes.
- Quotes.
- Credit notes.
- Sales returns.
- Recurring invoices.
- Customer payments.
- Sales settings entry.
- Create invoice / create quote actions.

**V2 change in responsibility:** `/invoices/new` and `/quotes/new` should not be duplicated in the global Sidebar by default. Creation remains fast through the Sales/List Workspace command model.

### Customers

Global entry:

- Customers workspace / customer list.

Workspace-owned:

- Customer master records.
- Contacts.
- Appointments.
- CRM when entitled.
- Customer settings.
- Create customer.

`/partners/new` becomes a contextual/list action by default rather than a separate global destination.

### Purchases

Global entry:

- Purchases workspace.

Workspace-owned:

- Purchase requests.
- RFQs.
- Purchase quotes.
- Purchase orders.
- Purchase invoices.
- Purchase returns.
- Debit notes.
- Suppliers.
- Supplier payments.
- Supplier refunds.
- Purchase settings.

Independent permissions such as `supplier_refunds.view` remain authoritative even if the item is visually nested within the Purchases workspace.

### Products & Inventory

Global entry:

- Products & Inventory workspace.

Workspace-owned:

- Products.
- Stock balances.
- Warehouses.
- Stock permits.
- Stocktaking.
- Inventory openings.
- Inventory settings.

The exact UX may expose **Products** and **Inventory** as strong internal sections because product master work and stock operations are distinct, but the global Sidebar does not need to duplicate every stock route.

### Accounting

Global entry:

- Accounting workspace.

Workspace-owned:

- Chart of accounts.
- Manual journals.
- Assets.
- Cost centers.
- Cheques when production-ready.
- Accounting settings.
- Period locks.
- Fiscal years.

**Critical:** visual nesting must not imply permission inheritance. `accounting_settings.view`, `accounting_period_locks.view`, and `fiscal_years.view` remain independent security authorities where currently defined.

### Finance

Global entry:

- Finance workspace.

Workspace-owned:

- Expenses.
- Receipt vouchers.
- Cash & Bank.
- Employee custodies.
- Finance settings.

**Decision retained:** Accounting and Finance remain separate top-level candidates for now. They should not be merged merely to reduce menu count. Their workflows and accounting semantics must be reviewed before any future consolidation.

### Reports

Global entry:

- Reports.

This should move conceptually out of Settings.

The current product already has a real report catalog with categories:

- Sales.
- Purchases.
- General / financial.
- Customers.
- Inventory.

The Reports workspace owns report discovery, categories, report filters, report pages, exports/actions, and report-specific settings where appropriate.

A report can also be contextually linked from its owning business workspace without duplicating every report in the global Sidebar.

### HR

Global entry:

- HR workspace.

Workspace-owned:

- Employees.
- Attendance.
- Payroll runs.
- Contracts through employee context.
- Requests.

The current app already represents several of these as `/hr` tabs/query states. V2 should stop using the global Sidebar as an HR tab bar.

### POS

Global entry:

- POS / Start selling, when entitled.

POS is a justified operational exception to ordinary CRUD navigation. Entering the selling workspace is itself a high-frequency action.

POS-owned navigation:

- Session management.
- POS report.
- Audit where permitted.
- POS settings.

The exact placement of these inside POS remains a specialized Operational Workspace design decision.

### Specialized Operations

This is not intended as a miscellaneous dumping ground.

Eligible global entries are specialized, enabled workspaces that genuinely need distinct operating surfaces, currently including candidates such as:

- Document Center, when entitled/permitted.
- Fuel Stations, when entitled.

Future Work Orders, Workflow, Bookings, Rentals, Leases, Time Tracking, Manufacturing, Fleet, and Shipping should **not automatically appear in production primary navigation merely because placeholder routes/definitions exist**. They should join the IA only when product-ready and intentionally classified.

A final label better than “Specialized Operations” may be chosen after enabled product capabilities are known. Avoid reusing “Operations” for both a broad super-category and a miscellaneous module group.

### Administration

Global entry:

- Administration / Settings.

Workspace-owned:

- Branch administration.
- Document design.
- Numbering settings.
- Tax settings.
- Payment methods.
- Applications / entitlements management.
- Account/system settings.
- Other approved settings hubs.

**Active branch selection remains global context, not branch administration.** Switching the current working branch must remain semantically distinct from configuring branches.

Reports should not live here.

### Developer

Global entry, permission-gated:

- Developer workspace.

Workspace-owned:

- Overview.
- API keys.
- API documentation.
- Webhooks.
- Security.

`developer.view` remains the visibility/security prerequisite currently used for this area.

## 5. Proposed grouping model

Do not introduce a third interactive tree level.

If visual section labels are useful, prototype quiet, non-interactive grouping such as:

**Core business**
- Home
- Sales
- Customers
- Purchases
- Products & Inventory

**Financial**
- Accounting
- Finance
- Reports

**People & Operations**
- HR
- POS (if enabled)
- enabled specialized workspaces

**Administration**
- Administration
- Developer (if permitted)

These labels are scanning aids only. They are not expandable parent routes.

The exact labels are not yet approved and must be tested in Arabic first.

## 6. Creation and quick-action policy

Default V2 rule:

**Do not show both a stable destination and its `new` route as separate primary Sidebar items.**

Creation speed should instead be provided by:

- primary action in List Workspace/Page Header;
- contextual Command Bar;
- keyboard shortcut where appropriate;
- global command/quick-create only if later specified and approved;
- favorites/recent features if later approved.

Possible exceptions require high-frequency operational evidence. POS launch is the clearest current exception.

## 7. Reports policy

Reports are a first-class destination.

The current code already supports a catalog and category routes rather than one isolated report screen. Therefore V2 should treat reporting as a **Report Workspace family** with:

- category discovery;
- search/favorites/recent reports if later justified;
- domain contextual links;
- report filters/actions owned by the report page;
- no requirement to list every report globally.

This aligns navigation with the Blueprint's `Report Workspace` pattern family.

## 8. Future/unbuilt capability policy

Primary production navigation should represent usable product capability.

Default rule:

- `built: false` / unbuilt/future destinations do not appear as ordinary operational navigation in V2.
- Product discovery for unavailable applications, if desired, belongs in Applications/Administration or another deliberate commercial-discovery surface.
- Do not pollute daily ERP navigation with “coming soon” entries merely to advertise roadmap breadth.

This rule is IA guidance only; it does not authorize removing current entries from production.

## 9. Entitlement and RBAC invariants

Any V2 implementation must preserve these invariants:

1. Application entitlement and RBAC permission remain separate concepts.
2. Server-side authorization remains authoritative.
3. Hidden/disabled applications do not leave empty navigation groups.
4. Permission filtering must produce a coherent menu for restricted users.
5. Admin users with broad access must still receive a scannable IA rather than a giant route dump.
6. Visual nesting never grants, widens, or implies permissions.
7. Tenant isolation is untouched by navigation design.

## 10. RTL and responsive implications

This IA is deliberately shorter so that the visual shell can work better across real screens.

Arabic-first requirements:

- test actual Arabic destination labels before locking widths;
- keep section labels short and meaningful;
- do not depend on icons alone to disambiguate similar financial areas;
- logical reading/focus order must remain correct in RTL.

Responsive requirements:

- desktop/laptop may use persistent navigation when workspace width permits;
- tablet/zoom/text scaling can transition to overlay based on content pressure;
- phone uses non-persistent navigation;
- module/workspace-owned navigation recomposes independently of the global Sidebar;
- no need to expose all module internals in the mobile global drawer.

## 11. What is intentionally not decided yet

This proposal does **not** approve:

- exact Sidebar width;
- exact icons;
- exact colors/borders/background;
- compact icon rail;
- exact Global Header height;
- exact Arabic labels for every candidate area;
- Favorites/Recent implementation;
- global quick-create implementation;
- exact Search/Command integration;
- exact Administration information architecture;
- merging Accounting with Finance;
- final label for specialized operational workspaces;
- route migrations or redirects;
- removal of any current production link.

These require subsequent design/product review.

## 12. Recommended prototype states

Before visual approval, the App Shell prototype should test the same IA under at least four permission/product shapes:

1. **Broad admin/accountant:** most core and financial areas visible.
2. **Sales user:** Sales, Customers, Products where needed, Reports subset, POS if entitled.
3. **Inventory/purchasing user:** Purchases, Products & Inventory, relevant Reports.
4. **Restricted/specialized user:** one or two operational workspaces only.

This prevents designing a Sidebar that looks elegant only with one idealized menu length.

It must also be tested at desktop, constrained-height laptop, tablet landscape/portrait, phone, zoom/text scaling, Arabic RTL, and English LTR.

## 13. Owner review questions

The next owner review should focus on product IA rather than visual styling:

1. Should **Reports** become a first-class global destination? **Recommendation: yes.**
2. Should ordinary **Create** links disappear from the global Sidebar and move to workspace commands? **Recommendation: yes, with operational exceptions such as POS.**
3. Should **HR** have one global entry and own its internal tabs? **Recommendation: yes.**
4. Should **Fuel Stations** retain one global workspace entry? **Recommendation: yes.**
5. Should **Accounting** and **Finance** remain separate for V2 initially? **Recommendation: yes until a dedicated financial IA review proves a merge improves clarity without semantic loss.**
6. Should unavailable/future modules disappear from ordinary production navigation? **Recommendation: yes; expose product discovery elsewhere if needed.**
7. Should **Products & Inventory** be one top-level destination with strong internal sections? **Recommendation: prototype this, then validate against real daily workflows before approval.**

## 14. Proposal verdict

The proposed V2 navigation is not “fewer features.” It is a clearer ownership model.

The user should navigate globally to the **business area**, then let that area's approved Workspace/Page Pattern expose its real tasks and contextual actions.

This creates a shell that can remain compact and stable even as AWJ grows, while permissions, entitlements, accounting governance, and specialized operational workspaces retain their real semantics.

**Recommended next design step after owner agreement:** use this IA as the content model for the first **App Shell V2 visual prototype/spec refinement**, then validate it across permission shapes and the full responsive matrix before any production implementation.

---

**No implementation, merge, deployment, route removal, permission change, entitlement change, accounting change, API change, database change, or tenant-isolation change is authorized by this proposal.**
