# AWJ ERP UX Reference Research

**Status:** RESEARCH BASELINE — LIVING DOCUMENT  
**Date:** 2026-09-08  
**Scope:** Evidence and design research for AWJ Design System V2. This document does not approve production implementation.

## 1. Purpose

This document records current enterprise UI/UX evidence that may inform AWJ V2. It exists to prevent design decisions from being based on screenshots, memory, fashion, or a single vendor.

The research question is not “Which ERP should AWJ copy?” It is:

> What is the best current solution for each AWJ ERP interaction problem, after separating durable enterprise principles from legacy conventions and short-lived visual trends?

This document is subordinate to:

- `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`
- `AWJ_V2_DESIGN_QUALITY_BAR.md`

The mandatory Freshness & Modernity Gate in the Quality Bar applies to every reference-derived recommendation below.

## 2. Research method

For material design decisions:

1. Prefer current official vendor/design-system documentation.
2. Check current support/deprecation status where relevant.
3. Separate structural/behavioral principles from vendor branding.
4. Compare more than one credible enterprise reference where the decision is important.
5. Evaluate desktop, laptop, tablet, mobile, intermediate viewports, constrained height, touch, pointer, keyboard, zoom/text scaling, localization and RTL implications.
6. Record what AWJ should adopt, reinterpret, or reject.
7. Do not convert research findings directly into production code. Findings must first become an approved AWJ pattern/component specification.

Reference status labels used here:

- **CURRENT** — current supported guidance/experience suitable for active consideration.
- **DURABLE** — older or long-standing principle that remains useful.
- **LEGACY / DEPRECATED** — should not be adopted as a modern target.
- **SUPERSEDED** — newer official guidance/pattern should normally be preferred.

## 3. Current reference portfolio

AWJ should deliberately use a portfolio rather than a single visual model.

| Reference | Primary value to AWJ | Policy |
|---|---|---|
| Microsoft Dynamics 365 Finance & Operations | ERP form/page discipline, transactional structures, workspaces, lookups, data density, business actions | Structural/behavioral reference; never a visual clone |
| SAP Fiori | Detailed UX rules, object/list floorplans, progressive disclosure, responsive forms, action hierarchy | Strong UX-rule reference |
| Oracle Redwood | Modern enterprise page-template architecture, consistency, responsive/internationalized enterprise polish | Modern enterprise architecture/polish reference |
| Odoo 19 | Simple record/list/form mental models, low-friction business workflows, view reuse | Secondary simplicity/workflow reference |
| IBM Carbon | Current data-heavy enterprise component behavior, accessibility, density and table interaction | Cross-industry enterprise component reference; not an ERP product model |
| AWJ 2026-09-06 concepts | AWJ-specific visual direction for invoice, product and customer workspaces | Primary AWJ visual reference, subject to Blueprint constraints |

No row in this table grants authority to copy a vendor's branding, navigation, typography, colors, iconography, or historical constraints.

## 4. Microsoft Dynamics 365 Finance & Operations

### 4.1 What remains valuable

Microsoft's Finance & Operations documentation continues to use explicit form patterns and subpatterns for recurring enterprise structures. Current documentation also states that adherence to form patterns gives responsive layout benefits, while custom forms make the developer responsible for correct responsive behavior.

Useful AWJ lessons:

- Treat recurring ERP screens as governed patterns, not independent canvases.
- Use purpose-specific patterns for transactions, details, lists, workspaces, setup and lookups.
- Make the main business activity obvious rather than mixing unrelated workflows into one giant form.
- Keep data grids, record actions and contextual information structurally disciplined.
- Treat lookups as serious business controls rather than giant generic selects.
- Responsive layout must be a property of the pattern, not an afterthought added per screen.

### 4.2 Important freshness finding

The Dynamics List Page guidance is especially useful as evidence that even a mature ERP's own patterns evolve: current guidance discourages the List Page pattern when there is a 1:1 correspondence between the list and a details page, reserving it for cases where that relationship does not hold cleanly.

**AWJ implication:** never freeze “Dynamics-style list page” as a universal AWJ rule. We should extract the durable browsing/search/filter/action principles while choosing the most current AWJ composition for each list family.

### 4.3 Responsive evidence

Current Microsoft documentation includes explicit testing guidance for custom patterns and identifies failures such as content not adapting to available space, fill controls failing to consume available dimensions, unnecessary scrollbars, toolbar overflow and grid minimum-height problems.

**AWJ implication:** responsive QA must include both width and height constraints, toolbar/action overflow, grid fill behavior, nested scrolling and zoom — not only breakpoint screenshots.

### 4.4 Settings/configuration lesson

The Table of Contents form pattern is intended for logically related setup/configuration areas and uses structured sections rather than one undifferentiated settings form.

**AWJ interpretation:** useful structural evidence for Settings Workspace V2, but exact tabs/navigation presentation must be designed for AWJ rather than copied.

### 4.5 Official sources

- UI/form patterns: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/user-interface-development-home-page
- Operational workspaces: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/build-workspaces
- Page layout/responsive columns: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/page-layout
- List Page pattern: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/list-page-form-pattern
- Lookup pattern: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/lookup-form-pattern
- Table of Contents/settings pattern: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/table-of-contents-form-pattern
- Custom-pattern responsive testing: https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/testing-forms-custom-patterns

**Research status:** CURRENT for the cited web-client/form guidance. Any deprecated dedicated mobile platform must not be treated as AWJ's modern mobile target.

## 5. SAP Fiori

SAP Fiori's current web design guidance is valuable because it documents not only components but floorplans and detailed UX behavior.

### 5.1 Object Page

The Object Page is a strong comparison point for AWJ Master Record and some record-detail experiences. Useful principles include:

- Header content should provide essential context rather than becoming a second full page.
- Long records should be divided into meaningful sections with progressive disclosure.
- Forms deliberately adapt column count by available width rather than mechanically shrinking.
- Top-aligned labels can improve localization resilience and long-label handling.
- Actions should be prioritized by importance/frequency instead of giving every action equal visual weight.
- Tables within object experiences need deliberate strategies for large item counts rather than unlimited inline expansion.
- Responsive behavior is part of the floorplan.

### 5.2 List Report

The List Report floorplan reinforces a coherent combination of filtering/searching/sorting and tabular results leading into record details.

**AWJ interpretation:** useful evidence for List Workspace and Report Workspace, but AWJ must preserve accounting density and avoid unnecessary analytical decoration above transactional lists.

### 5.3 Official sources

- Object Page: https://experience.sap.com/fiori-design-web/object-page/
- List Report floorplan: https://experience.sap.com/fiori-design-web/list-report-floorplan-sap-fiori-element/

**Research status:** CURRENT design-guideline reference. Further pattern-by-pattern extraction is required before AWJ specifications are finalized.

## 6. Oracle Redwood

Oracle Redwood is valuable as a modern enterprise reference because its design architecture emphasizes higher-level page templates and patterns rather than assembling every enterprise screen from low-level components.

Useful AWJ lessons:

- Prefer reusable page-level templates/patterns for common enterprise intents.
- Encode recurring behaviors such as page structure, drawers, headers, spacing and unsaved-change handling at an appropriate shared level.
- Responsiveness, accessibility and internationalization should be built into reusable system primitives rather than repeatedly solved by feature teams.
- Modern enterprise polish can coexist with standardized workflow structures.

**AWJ interpretation:** Redwood is particularly useful when we later define App Shell V2, page-template anatomy, overlays/panels and modern visual craft. It should not override AWJ's denser accounting/productivity requirements.

Official sources:

- Components, templates and patterns: https://redwood.oracle.com/?pageId=CORE6CE1FA0A24ED4DC68345E7E282654819&shell=simple-content
- Redwood toolkit: https://redwood.oracle.com/?pageId=CORECDBC4C6D38D74839978B85DB7FDAFD35&shell=simple-content
- Redwood development guidance: https://redwood.oracle.com/?pageId=CORE6F5A8F43C163463698BAF0E47931C2A1&shell=getting-started
- Oracle Redwood adoption: https://docs.oracle.com/en/cloud/saas/readiness/redwood-adoption/index.html

**Research status:** CURRENT architecture/polish reference. Some Redwood documentation is JavaScript-rendered; claims used in final pattern specs should be revalidated against accessible current official material when needed.

## 7. Odoo 19

Odoo 19's current developer documentation continues to expose a relatively direct view model: records can be represented through form, list, search, kanban, graph, pivot, calendar and other view types. Form views are structured with semantic groups/notebooks/fields/buttons, while list views support actions such as creation/editing, inline editing, grouping, ordering and multi-edit behavior.

Useful AWJ lessons:

- Keep common business record mental models understandable.
- Reuse view structures instead of creating bespoke screen architecture for every entity.
- Inline editing can be valuable when it matches the business task.
- Search/list/form transitions should remain low-friction.

What not to infer:

- Odoo's current architecture does not automatically establish the visual quality bar for AWJ.
- Odoo is not the primary reference for AWJ App Shell, high-density accounting grid behavior, or premium visual direction.

Official sources:

- Odoo 19 backend views: https://www.odoo.com/documentation/19.0/developer/tutorials/backend.html
- Odoo 19 view architectures: https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_architectures.html
- Odoo 19 view records/types: https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_records.html

**Research status:** CURRENT (Odoo 19) secondary reference.

## 8. IBM Carbon — enterprise data-heavy reference

Carbon is not an ERP product and must not define AWJ's product architecture. It is nevertheless a useful current reference for enterprise component behavior, especially Data Grid V2.

As of the current documentation reviewed on 2026-09-08, Carbon's Data Table guidance was updated on 2026-08-27 and documents:

- Five row-size options, supporting deliberate density rather than one universal row height.
- A table toolbar for search, filtering, settings and other global table actions.
- Sorting, selection, expansion, pagination, batch actions and inline row actions.
- Progressive disclosure for supplementary row information.
- A recommendation to give data tables substantial page width and avoid cramping them inside small nested containers.
- Persistent row actions on touch/mobile when hover is unavailable.
- Skeleton loading for expected table loading delays.
- Explicit accessibility testing statuses covering default/advanced states, screen readers and keyboard navigation.

**AWJ interpretation:** Carbon is strong evidence for treating the Data Grid as a first-class interaction system with density, toolbar, batch-mode, touch and accessibility behavior — not merely a styled HTML table. AWJ's accounting-specific requirements still govern financial alignment, totals, inline document editing, permissions and Arabic RTL.

Official source:

- Data table usage: https://carbondesignsystem.com/components/data-table/usage/

**Research status:** CURRENT cross-industry enterprise component reference; last-updated date observed: 2026-08-27.

## 9. Cross-reference findings already strong enough to guide AWJ

The following are research-backed directions, but they still require pattern-level specification before implementation:

### 9.1 Pattern-first architecture is confirmed

Multiple mature enterprise systems converge on reusable higher-level structures:

- Dynamics: form patterns/subpatterns.
- SAP: floorplans.
- Oracle: page templates/patterns.
- Odoo: reusable view types/architectures.

This supports the existing AWJ architecture:

**Screen → Pattern → Components → Tokens**

### 9.2 Data-heavy surfaces deserve first-class space

Dynamics and Carbon both reinforce that grids are primary enterprise working surfaces. AWJ should not squeeze core accounting tables into decorative cards or secondary containers.

### 9.3 Responsive behavior belongs to the pattern/component

Dynamics responsive form guidance, SAP responsive floorplans, Redwood's adaptive system direction and Carbon touch/accessibility behaviors all support AWJ's rule that responsive behavior must be designed into shared patterns/components.

### 9.4 Action hierarchy must be deliberate

Enterprise references consistently distinguish global/page/table/record actions. AWJ should avoid action duplication and equal visual weight for every command.

### 9.5 Progressive disclosure is useful, but must preserve accounting relationships

Object pages, expandable tables, previews and structured settings all support revealing secondary information when needed. AWJ must use this selectively; primary financial relationships and required controls must not disappear merely to make the interface look clean.

### 9.6 Modernity is not visual fashion

The strongest current references still emphasize efficiency, responsive behavior, accessibility, structured actions and reusable patterns. This supports AWJ's decision to reject decorative “modern SaaS” conventions when they reduce ERP productivity.

## 10. Preliminary mapping to AWJ V2 pattern families

| AWJ pattern | Highest-value references to study next |
|---|---|
| App Shell / Navigation | Current enterprise navigation guidance from Dynamics, SAP and Redwood; AWJ-specific search/notifications/company/branch context |
| Document Workspace | Dynamics transaction/details patterns + SAP object/action principles + AWJ sales-invoice concept |
| Master Record | SAP Object Page + Dynamics Details Master + AWJ product/customer concepts |
| List Workspace | Dynamics current list guidance + SAP List Report + Carbon Data Table |
| Report Workspace | SAP List Report/analytical guidance + enterprise table/filter patterns |
| Settings Workspace | Dynamics Table of Contents + modern page/section patterns |
| Operational Workspace | Workflow-specific research; POS must not be forced into CRUD patterns |
| Data Grid V2 | Carbon Data Table + Dynamics grids + SAP table guidance + AWJ accounting requirements |

## 11. What is not yet complete

This baseline does **not** mean the reference research is finished. Before each AWJ pattern is approved, the next research pass should inspect the exact problem being designed.

Still required in depth:

- App Shell/navigation across current enterprise systems.
- Command/action hierarchy and overflow behavior.
- Search and high-cardinality business lookups.
- Unsaved changes, validation, errors and destructive actions.
- Dense financial tables and editable line-item grids.
- Report filters and drill-down.
- Dashboard/workspace composition without generic KPI-card inflation.
- Settings/configuration navigation.
- POS/operational interaction patterns.
- Keyboard-first ERP workflows.
- Touch behavior and tablet productivity.
- Arabic RTL and localization stress cases.
- Accessibility, zoom and text scaling.
- Short-height laptop behavior and nested scrolling.
- Modern responsive/container strategies at intermediate viewport sizes.

## 12. Next recommended research/design sequence

1. **App Shell & Navigation research/specification** — because sidebar/global header visuals remain explicitly open decisions.
2. **Document Workspace V2 research/specification** — use Sales Invoice as the proving ground for the reusable document family.
3. **Data Grid V2 foundation** — in parallel with Document Workspace where line-item behavior requires it.
4. Master Record V2.
5. List Workspace V2.
6. Report Workspace V2.
7. Settings Workspace V2.
8. Operational/POS pattern work as a distinct interaction family.

Each stage must pass the Quality Bar and Freshness & Modernity Gate before implementation planning.

---

**Research rule:** AWJ should inherit the best current enterprise thinking, not another product's accumulated history. Durable principles may be retained; legacy conventions must be challenged; newer alternatives must be evaluated; visual trends must earn their place through measurable workflow value.
