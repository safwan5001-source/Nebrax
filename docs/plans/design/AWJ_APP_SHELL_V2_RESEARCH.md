# AWJ Design System V2 — App Shell & Navigation Research

**Status:** RESEARCH / NOT YET AN APPROVED VISUAL SPEC
**Date:** 2026-09-08
**Scope:** App Shell, primary navigation, global utilities, responsive shell behavior, accessibility, and navigation architecture. No production implementation is authorized.

## 1. Purpose

This document converts current enterprise UI/UX research into evidence and candidate rules for the future **AWJ App Shell V2**.

It intentionally does **not** approve the exact sidebar or global-header appearance shown in the 2026-09-06 AWJ concepts. Those remain visual reference concepts only. Exact sidebar width, colors, grouping, icons, hierarchy, active states, labels, header height, utility placement, and shell spacing remain open design decisions until an App Shell V2 specification is reviewed and approved.

This research is governed by:

- `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`
- `AWJ_V2_DESIGN_QUALITY_BAR.md`
- `AWJ_ERP_UX_REFERENCE_RESEARCH.md`

The Freshness & Modernity Gate applies throughout.

## 2. Research conclusion

The strongest current direction is **not** to copy one vendor shell.

AWJ should combine:

- Dynamics 365 Finance & Operations: role-aware ERP navigation, activity-oriented workspaces, favorites/recent destinations, navigation search, and permission-aware information architecture.
- SAP Fiori: strict separation between shell-level services and app/page content, responsive page composition, drill-down/list-detail behavior, and explicit RTL behavior.
- IBM Carbon: current shell accessibility behavior, keyboard semantics, responsive collapse/overlay behavior, and disciplined hierarchy depth.
- Odoo: web-first continuity across devices and low-friction access to business applications, while avoiding third-party theme trends as architectural evidence.
- AWJ's own needs: Arabic-first RTL, accounting productivity, tenant/company/branch context, global business-object search, dense working surfaces, and a distinctive restrained visual identity.

No vendor shell should be visually cloned.

## 3. Source freshness classification

### Microsoft Dynamics 365 Finance & Operations

**Classification:** Current/durable structural reference.

Current Microsoft documentation describes navigation through dashboard, navigation pane, workspaces, favorites, recent pages, modules, and navigation search. Workspaces are activity-oriented and permission/role aware. Microsoft also documents responsive page-layout behavior through available-space-driven column flow.

**AWJ interpretation:** retain the structural discipline, but do not copy the Dynamics navigation pane, dashboard tiles, Microsoft visual language, or historical desktop conventions literally.

Sources:
- https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/page-navigation
- https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/build-workspaces
- https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/page-layout

### SAP Fiori

**Classification:** Durable enterprise UX reference; individual pages must be freshness-checked because the guideline archive includes multiple SAPUI5 generations.

The current/recent Flexible Column Layout guidance remains especially useful: desktop can expose multiple related columns, tablet reduces simultaneous columns, and phone becomes a single full-screen navigation level. It explicitly reverses drill-down direction for RTL. SAP also separates shell-level services such as home/search/settings/help from the app's own floorplan.

**AWJ interpretation:** adopt the principle of shell/page separation and content-driven recomposition. Do not import SAP Launchpad architecture or old Shell Bar visuals wholesale.

Sources:
- https://experience.sap.com/fiori-design-web/flexible-column-layout/
- https://experience.sap.com/fiori-design-web/flexible-column-layout-web-component/
- https://experience.sap.com/fiori-design-web/navigation/

### IBM Carbon

**Classification:** Current modern reference. UI Shell documentation observed as updated 2026-08-27.

Carbon's current UI Shell guidance separates Header, Left Panel, and optional Right Panel. It recommends the left panel for sufficiently large/frequently switched secondary navigation, limits the left panel to two navigation tiers, and recommends moving deeper structure into the page. On smaller screens or high zoom, the persistent left panel becomes a hamburger-triggered overlay. Its accessibility guidance specifies semantic navigation, `aria-expanded`, `aria-current`, keyboard operation, focus handling, and screen-reader testing.

**AWJ interpretation:** this is strong evidence for shell accessibility and responsive behavior, not for Carbon's visual styling.

Sources:
- https://carbondesignsystem.com/components/UI-shell-left-panel/usage/
- https://carbondesignsystem.com/components/UI-shell-left-panel/accessibility/
- https://carbondesignsystem.com/components/UI-shell-header/style/
- https://carbondesignsystem.com/components/UI-shell-header/accessibility/

### Odoo 19

**Classification:** Current web-platform reference; limited value as an official shell-design specification.

Odoo 19 documents its web client as a single-page application and exposes separate areas for views, search/control panel, navbar, user menu, and action services. Odoo recommends its PWA across devices. Third-party Odoo themes show contemporary sidebar/tab/glass trends, but these are **not official UX evidence** and must not drive AWJ architecture.

**AWJ interpretation:** useful evidence for web-first continuity and business-app simplicity. Do not treat marketplace themes or glassmorphism as a quality benchmark.

Sources:
- https://www.odoo.com/documentation/19.0/developer/reference/frontend/framework_overview.html
- https://www.odoo.com/documentation/19.0/administration/mobile.html

## 4. Candidate AWJ shell architecture

The current candidate architecture is:

1. **Primary Navigation / Sidebar** — where can I go?
2. **Global Header** — global context and utilities.
3. **Page Header** — where am I?
4. **Contextual Command Bar** — what can I do here?
5. **Workspace Content** — the actual pattern-owned working surface.
6. **Optional contextual panel** — only when a workflow materially benefits from related information/actions; never a permanent decorative column.

This preserves the Blueprint's single-navigation rule: do not duplicate the module tree in both sidebar and top header.

## 5. Primary Navigation — candidate rules

### 5.1 Purpose

Primary navigation should answer **where can I go?** and expose destinations permitted for the current user/context.

It should not contain current-record actions, filters, document commands, or page-local tools.

### 5.2 Information architecture

Candidate principles:

- Prefer a shallow, comprehensible hierarchy.
- Avoid deep nested menu trees. Carbon's current two-tier left-panel limit is a useful warning against shell-level hierarchy creep.
- Deeper task structure belongs inside a module/workspace/list/settings page rather than endlessly nested sidebar groups.
- Navigation visibility must respect AWJ permissions/entitlements, but hiding navigation is not itself an authorization boundary; backend authorization remains authoritative.
- Module grouping should reflect real AWJ business domains and user mental models, not repository/code structure.
- Do not expose every route merely because it exists.
- Frequently used destinations may benefit from favorites/recent access, informed by Dynamics, but this is a candidate capability rather than an approved V2 requirement.

### 5.3 Expanded/collapsed behavior

Do not approve a fixed sidebar width yet.

The final spec should evaluate at least:

- Expanded navigation with labels.
- Compact/collapsed state where it remains unambiguous and accessible.
- User-controlled persistence where useful.
- Automatic transition to overlay/drawer behavior when the viewport, zoom, or content width no longer supports a persistent panel.

A compact icon-only rail must not depend on users memorizing ambiguous icons. If used, labels/tooltips and keyboard/focus behavior are mandatory.

### 5.4 RTL

Arabic is the primary composition, not an afterthought.

The final shell must define:

- Navigation panel placement in RTL and LTR.
- Chevron/expand direction.
- Drawer entrance/exit direction.
- Breadcrumb/drill-down direction.
- Icon mirroring policy: directional icons mirror where semantically required; non-directional icons do not mirror mechanically.
- Focus and keyboard order following logical document order rather than merely visual placement.

SAP's explicit RTL reversal in multi-column drill-down is evidence that directionality must be designed behaviorally, not just by CSS mirroring.

## 6. Global Header — candidate rules

The Global Header should remain **small, stable, and global**.

Candidate global concerns include:

- AWJ/product identity where needed.
- Global search.
- Notifications/alerts.
- User/account menu.
- Company/tenant/legal-entity context when appropriate.
- Branch context when genuinely global to the current session/workspace.
- Language/appearance access where appropriate.
- Help/global assistance.

Do not place module navigation or current-document actions in the Global Header merely because space exists.

The final specification must determine which global controls deserve persistent visibility and which move to overflow at constrained widths. Search is high-value and should degrade deliberately rather than disappear without a clear access path.

## 7. Search and navigation discovery

Dynamics' navigation search and SAP's enterprise-search model reinforce a useful distinction for AWJ:

- **Navigation discovery:** find a page/module/workspace.
- **Business-object search:** find customers, suppliers, products, invoices, purchase documents, journals, etc.

AWJ already has a Global Search direction. App Shell V2 should decide whether these are presented through one unified command/search experience or clearly coordinated surfaces, but must avoid confusing route search with business-record search.

Search behavior must support keyboard access, touch, Arabic text, English text, codes/document numbers, and permission-aware results.

## 8. Page Header and Contextual Command Bar boundary

The shell must not consume the page's identity or actions.

**Page Header:** title, record/document identity, status/context, breadcrumbs or hierarchy where useful.

**Contextual Command Bar:** actions for the current page/record/document only.

This separation prevents a common ERP failure where global navigation, record identity, and actions become one overloaded toolbar.

On constrained screens, contextual actions may collapse/recompose independently of global shell utilities.

## 9. Workspace-first rule

The shell exists to support the working surface, not dominate it.

For AWJ, especially invoices, journals, reports, grids, inventory operations, and POS-adjacent workflows:

- Preserve maximum useful workspace width and height.
- Avoid oversized shell chrome.
- Avoid redundant headers.
- Avoid permanent panels that reduce the line-item/data-grid surface without material benefit.
- Constrained-height laptop viewports are first-class; shell height is as important as shell width.
- Sticky/fixed shell regions must be budgeted together so they do not leave a tiny scrollable content viewport.

## 10. Responsive shell behavior — required scenarios

The final App Shell V2 spec must validate behavior across a continuum, not only named devices.

### Wide desktop

- Persistent navigation can be viable.
- Do not stretch navigation just because width is available.
- Workspace should gain the majority of extra width.

### Standard desktop

- Full productivity target.
- Global utilities remain quickly accessible.
- Shell chrome remains compact.

### Laptop / constrained height

- Explicitly test short vertical viewports.
- Avoid stacking Global Header + large Page Header + large Command Bar into excessive fixed chrome.
- Page-local sections may need compact/sticky behavior independent of the global shell.

### Tablet landscape

- Persistent or compact navigation is a design decision based on remaining workspace, not a device-name rule.
- Touch targets and pointer use can coexist.

### Tablet portrait

- Likely transition toward overlay/drawer navigation when persistent navigation materially harms the working surface.
- Preserve serious ERP use rather than turning the app into a phone UI prematurely.

### Phone

- Primary navigation should be non-persistent and invoked deliberately.
- Current workflow/page context must remain clear after the navigation closes.
- Global utilities need prioritized overflow rather than indiscriminate hiding.
- Page patterns recompose independently; the shell must not dictate that all content becomes cards.

### Intermediate widths / zoom / text scaling

- Collapse decisions should be driven by available space and content pressure.
- High browser zoom can require the same overlay behavior as a narrow viewport; Carbon's current guidance explicitly demonstrates this principle.
- Long Arabic labels and localization expansion must be stress-tested before breakpoints are considered stable.

## 11. Accessibility baseline for the shell

Candidate mandatory requirements for the future spec:

- Semantic `<nav>` landmarks with meaningful labels.
- Current destination exposed programmatically (`aria-current` or equivalent semantics).
- Expandable groups expose expanded/collapsed state.
- Full keyboard access without hover dependency.
- Visible, consistent focus treatment.
- Focus management when opening/closing mobile navigation overlays.
- Escape behavior where appropriate.
- Screen-reader names for icon-only actions.
- No color-only active-state communication.
- Logical focus order in RTL and LTR.
- Reduced-motion respect for shell transitions.
- Zoom/text-scaling behavior included in acceptance tests.

Carbon's 2026 shell documentation is a strong current implementation reference for this area.

## 12. What AWJ should explicitly avoid

Do not approve by default:

- Dynamics' exact navigation pane or dashboard visuals.
- SAP Launchpad as AWJ's product architecture.
- Odoo marketplace themes as design authority.
- Glassmorphism, frosted sidebars, decorative gradients, or trendy shell effects merely to look current.
- Deep three/four/five-level sidebar nesting.
- Duplicate module navigation in both header and sidebar.
- A giant sidebar that permanently steals invoice/grid workspace.
- A tiny icon rail whose meaning depends on memorization.
- Desktop-only hover navigation.
- Hard-coded device breakpoints without testing content pressure.
- A shell that changes unpredictably between modules.
- Page-specific buttons leaking into global navigation.
- Tenant/company/branch selectors whose scope is visually ambiguous.

## 13. Open AWJ decisions — deliberately not resolved by research

The following require an actual AWJ App Shell V2 design/specification and owner review:

1. Exact sidebar placement in Arabic RTL and corresponding LTR mirror.
2. Expanded width and compact width.
3. Whether compact icon rail is useful at all.
4. Module grouping and labels.
5. Favorites/recent destinations.
6. Exact Global Header height.
7. Logo/product-name treatment.
8. Search presentation and whether route search and record search are unified.
9. Company/tenant/legal-entity selector placement.
10. Branch selector placement and scope signaling.
11. Notifications placement and behavior.
12. User/language/theme/help placement.
13. Breadcrumb policy.
14. Persistent vs overlay thresholds based on real AWJ content.
15. Tablet-specific shell behavior.
16. Phone shell composition.
17. Multi-window/tab behavior and whether any workspace continuity features are needed.
18. Optional contextual/right panel policy.

None of these should be inferred as approved from the concept screenshots.

## 14. Recommended next design deliverable

Create **`AWJ_APP_SHELL_V2_SPEC.md`** only after the research is reviewed.

That specification should turn these candidate rules into explicit AWJ decisions, including:

- anatomy and ownership boundaries;
- navigation IA;
- exact states;
- responsive/container behavior;
- RTL/LTR behavior;
- keyboard/touch/focus behavior;
- global context selectors;
- global search integration;
- accessibility acceptance criteria;
- viewport/zoom/text-scale test matrix;
- visual reference/prototype requirements.

Only after that specification is approved should production shell implementation be planned.

## 15. Research verdict

The strongest App Shell for AWJ is likely to be **quiet, compact, shallow, role-aware, search-friendly, RTL-native, and aggressively protective of the working surface**.

Modernity should come from excellent responsive composition, accessibility, information architecture, state continuity, search, and interaction quality — not from visual effects.

The shell should feel almost invisible during serious accounting work: always understandable, always available, but never competing with the invoice, grid, report, journal, or operational task the user is actually trying to complete.

---

**No implementation, merge, deployment, accounting change, API change, database change, permission change, or tenant-isolation change is authorized by this research document.**
