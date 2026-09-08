# AWJ Design System V2 — Navigation Information Architecture Audit

**Status:** AUDIT / INPUT TO APP SHELL V2 — NOT AN IMPLEMENTATION AUTHORIZATION
**Date:** 2026-09-08
**Scope:** Current AWJ ERP navigation information architecture as implemented on `main`, with candidate V2 restructuring principles. No route, permission, entitlement, backend, accounting, database, or production behavior is changed by this document.

## 1. Purpose

This audit grounds the future **AWJ App Shell V2** in the application that actually exists.

It follows:

- `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`
- `AWJ_V2_DESIGN_QUALITY_BAR.md`
- `AWJ_ERP_UX_REFERENCE_RESEARCH.md`
- `AWJ_APP_SHELL_V2_RESEARCH.md`
- `AWJ_APP_SHELL_V2_SPEC.md`

The goal is to answer **what belongs in global navigation, how it should be grouped, and what should move into page/workspace-level navigation** before final visual design of the Sidebar.

## 2. Current implementation source of truth

The primary implementation audited is:

`web/src/components/layout/sidebar.tsx`

Supporting navigation behavior includes:

- `web/src/components/layout/nav-visibility.ts`
- `web/src/lib/pos-workspace.ts`
- `web/src/app/(app)/layout.tsx`
- the dedicated `(fuel)` / POS workspace layouts where applicable.

The current Sidebar is not merely decorative navigation. Its visibility can depend on application entitlement (`appKey`) and RBAC permission (`permission`). That distinction must survive any V2 redesign.

**Security rule:** navigation visibility is convenience and discoverability only. It must never become an authorization boundary; server-side authorization remains authoritative.

## 3. Current global navigation inventory

The current Sidebar exposes the following primary groups:

1. Sales
2. POS
3. Customers
4. Inventory
5. Purchases
6. Accounting
7. Finance
8. HR
9. Operations
10. Logistics
11. Fuel Stations
12. Branches
13. Settings
14. Developer

The implementation also visually clusters these into four non-interactive super-groups:

- Revenue: Sales, POS, Customers
- Operations: Inventory, Purchases, Logistics, Fuel Stations
- Finance: Accounting, Finance, HR, Operations
- Admin: Branches, Settings, Developer

This is already an important architectural improvement over an unstructured flat menu: the super-group labels are deliberately non-interactive so they do not create a third navigation depth.

## 4. Current route density

The current global Sidebar is carrying both **destinations** and many **task shortcuts**.

Examples:

- Sales includes both `/invoices` and `/invoices/new`, both `/quotes` and `/quotes/new`.
- Customers includes both `/partners` and `/partners/new`.
- Branches includes both `/branches` and `/branches/new`.
- Accounting exposes the Accounting Settings hub plus direct entries to Period Locks and Fiscal Years.
- HR exposes multiple tabs of one `/hr` workspace as if they were separate global destinations.
- Settings contains Reports alongside configuration destinations.

This produces fast direct access, but it also makes the global navigation responsible for too many page-local/task-level choices.

## 5. Major audit findings

### Finding A — the current Sidebar is functionally rich but globally overloaded

The present model mixes four different concepts:

1. Business domains/modules.
2. Stable destination pages/workspaces.
3. Creation actions such as “new invoice”.
4. Deep settings/sub-pages and workspace tabs.

These should not automatically have equal weight in the V2 global navigation.

**V2 principle:** global navigation should primarily expose stable destinations. High-frequency creation should be available through page/workspace command surfaces, global quick-create/command mechanisms if approved, and contextual actions — not by duplicating every list/create pair in the Sidebar.

### Finding B — direct “create” links are candidates for removal from primary navigation

Examples include invoice, quote, customer, and branch creation.

Removing them from the future primary tree does **not** mean making creation slower. The V2 design should preserve or improve speed through:

- prominent create actions in the relevant List Workspace;
- contextual command bars;
- keyboard-accessible global command/quick-create if later approved;
- recent/favorite destinations where useful.

The target is fewer global entries without increasing task friction.

### Finding C — Settings is currently both configuration and a miscellaneous bucket

`/reports` is currently inside Settings even though reports are a first-class ERP working surface, not configuration.

Document Design, Numbering, Tax, Payment Methods, Applications, and Account/System settings are configuration concerns. Reports should be evaluated as a first-class global destination or reporting workspace rather than remaining under Settings solely because the current Sidebar places it there.

### Finding D — Accounting governance pages need semantic care

Period Locks and Fiscal Years have intentionally independent permissions from the general Accounting Settings permission. This is a real security/governance distinction and must not be lost by visual regrouping.

V2 may present them inside an Accounting/Settings workspace hierarchy while still preserving their independent permission gates and direct routes.

**Do not infer authorization inheritance from visual nesting.**

### Finding E — HR already behaves like a workspace internally

Attendance, payroll runs, requests, and employee access are tabs/views within `/hr`, while the Sidebar currently exposes several as individual entries.

This is strong evidence for the V2 pattern-first approach: global navigation can lead to an HR workspace, and the workspace can own its internal task navigation.

### Finding F — Fuel Stations validates specialized workspace navigation

Fuel Stations intentionally has one global entry and owns detailed operational navigation inside its specialized workspace.

This is a strong precedent for V2: not every sub-capability needs a global Sidebar item.

### Finding G — POS is a distinct high-frequency operational workspace

POS has its own launch/session/report/audit/settings concerns and dedicated workspace behavior. It should not be forced into exactly the same navigation treatment as ordinary CRUD modules.

V2 should preserve the distinction between entering POS and navigating within POS.

### Finding H — “Operations” is semantically overloaded

The word appears both as a super-group concept and as a concrete group containing Document Center plus several future/unbuilt operational capabilities.

This can make the IA ambiguous. V2 should use clearer domain naming and avoid the same label representing both a broad category and a specific module bucket.

### Finding I — built and future/unbuilt entries coexist

Some current entries are intentionally marked without `built: true`, including examples under Operations and Logistics and Cheques.

V2 must decide whether future capabilities belong in normal production navigation at all. A mature ERP should not make primary navigation noisy with unavailable destinations unless there is a deliberate product-discovery reason and a clearly designed unavailable state.

### Finding J — entitlement and RBAC filtering are first-class IA inputs

Groups/items may disappear based on commercial application entitlement or user permission. Therefore V2 cannot be designed from a static screenshot alone.

The IA must remain coherent when:

- a whole application is disabled;
- individual sensitive entries are permission-hidden;
- a user has a small subset of modules;
- an administrator sees nearly everything.

Empty group headers must never remain after filtering.

## 6. Candidate V2 navigation model

This is a **candidate IA**, not owner-approved final navigation.

### 6.1 Global destinations

The primary Sidebar should favor durable business destinations such as:

- Home / Dashboard
- Sales
- Customers
- Purchases
- Products & Inventory
- Accounting & Finance
- Reports
- HR
- Operations / specialized workspaces as enabled
- POS as enabled
- Administration / Settings
- Developer as permitted

This is intentionally shorter than the current route-level inventory.

### 6.2 Module/workspace-owned navigation

Once inside a domain, its List/Workspace/Settings pattern can expose the relevant second-level tasks.

Examples:

**Sales workspace/list family** may own invoices, quotes, credit notes, returns, recurring invoices, customer payments, delivery notes, and sales settings entry points.

**Purchases** may own purchase requests, RFQs, supplier quotes, purchase orders, purchase invoices, returns, debit notes, suppliers, payments, refunds, and settings.

**Accounting & Finance** requires further domain review before deciding whether Accounting and Finance remain separate top-level destinations or become a coordinated financial area. This must not blur accounting semantics or permissions.

**HR** should likely own its attendance/payroll/contracts/requests views internally rather than using the global Sidebar as a tab bar.

**Fuel Stations** should retain one global workspace entry and internal operational navigation.

### 6.3 Create actions

Candidate rule:

**Do not duplicate a stable list destination and its `new` route in the primary Sidebar by default.**

Creation belongs primarily to the destination/workspace's command model. Exceptions require evidence that a direct global create shortcut materially improves a high-frequency workflow.

POS “Start selling” is a possible exception because it is an operational launch action rather than ordinary record creation.

## 7. Candidate top-level taxonomy

A cleaner V2 taxonomy to prototype is:

| Candidate area | Purpose | Notes |
|---|---|---|
| Home | overview and return point | role-aware content can live in workspace, not menu depth |
| Sales | revenue documents and sales workflows | creation actions move inward by default |
| Customers | customer/CRM relationship work | CRM visibility remains entitlement-aware |
| Purchases | procure-to-pay workflow | keep commercial entitlement filtering |
| Products & Inventory | product master + stock operations | exact split/merge requires pattern review |
| Accounting | ledger, journals, accounting governance | accounting precision and permissions first |
| Finance | cash/bank, expenses, vouchers, custodies | whether it remains separate is an open decision |
| Reports | cross-domain reporting workspace | candidate move out of Settings |
| HR | employee/payroll workspace | internal tabs should be workspace-owned |
| POS | specialized operational workspace | entitlement-aware |
| Specialized Operations | Document Center / Fuel / future enabled verticals | avoid generic dumping ground |
| Administration | branches, system/configuration applications | branch active-context switch remains separate from branch administration |
| Developer | integration/developer workspace | permission-gated |

This table is an IA hypothesis for prototyping, not a final menu contract.

## 8. Important distinctions V2 must preserve

### Active branch context vs branch administration

The current implementation explicitly distinguishes branch administration routes from the active-branch switcher in the top/user context.

V2 must keep this distinction obvious. A user changing the **active working branch** is not the same operation as entering **Branch Administration**.

### Application entitlement vs permission

`appKey` and `permission` are different concepts and must remain different:

- entitlement determines whether a commercial/application capability is available to the tenant/company context;
- RBAC determines whether the current user may access a protected capability.

The visual IA may hide both kinds of unavailable destinations, but the underlying semantics must never be collapsed into one generic “visibility” rule.

### Workspace navigation vs global navigation

Dedicated workspaces such as Fuel and POS demonstrate that a global Sidebar should launch the work area; detailed workflow navigation can live inside it.

This principle should be applied carefully to reduce global-menu entropy across AWJ.

## 9. Sidebar V2 density target

The goal is **not** the smallest possible menu.

The goal is a menu that a frequent AWJ user can scan quickly without losing important destinations.

Candidate constraints:

- global hierarchy should remain shallow;
- avoid a third interactive nesting level;
- avoid showing both list and create entries unless justified;
- avoid showing page tabs as global destinations unless they are truly independent destinations;
- do not make Settings a catch-all;
- do not expose unavailable/future routes as normal operational choices by default;
- preserve direct access to genuinely high-frequency operational launches;
- support permission/entitlement-filtered variants without broken grouping.

## 10. Responsive implications

A cleaner IA directly improves responsive shell quality.

Fewer, more durable global destinations mean:

- mobile/tablet drawers become easier to scan;
- icon-only compact states, if eventually approved, have less ambiguity;
- Arabic labels have more room;
- zoom/text scaling creates less pressure;
- internal workspace navigation can recompose according to the page pattern instead of forcing the global drawer to carry every task.

No final Sidebar width, compact rail, breakpoint, or visual treatment is approved by this audit.

## 11. Proposed next validation

Before finalizing the IA, perform a route-and-usage validation against the actual application for the highest-value areas:

1. Sales.
2. Purchases.
3. Products & Inventory.
4. Accounting & Finance.
5. Reports.
6. HR.
7. Settings/Administration.
8. POS and specialized workspaces.

For each, verify:

- which destinations are truly independent pages;
- which are tabs/subviews;
- which are creation actions;
- which are settings;
- which are permission/entitlement sensitive;
- which are high-frequency enough to justify direct global access;
- which future/unbuilt destinations should not participate in V2 production navigation.

## 12. Audit verdict

AWJ does **not** need a more decorative version of the current long Sidebar.

It needs a clearer boundary between:

**Global destination → Module/Workspace → Page Pattern → Contextual actions**

The existing implementation already contains useful architectural clues: shallow super-grouping, entitlement/RBAC-aware visibility, dedicated Fuel/POS workspaces, and a separate active-branch concept. V2 should preserve those strengths while reducing route/task duplication and moving internal workflow navigation to the workspace that owns it.

The immediate next step is to validate the candidate taxonomy against actual high-value routes and then produce the first **AWJ Navigation IA V2 proposal** for owner review. Only after that should the visual Sidebar prototype be treated as meaningful.

---

**No implementation, merge, deployment, route removal, permission change, entitlement change, accounting change, API change, database change, or tenant-isolation change is authorized by this audit.**
