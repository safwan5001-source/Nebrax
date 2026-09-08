# AWJ Design System V2 — Blueprint

**Status:** DRAFT / DESIGN DIRECTION
**Date:** 2026-09-08
**Scope:** Design and UX architecture only. No production UI implementation is approved by this document.

> This document preserves the current agreed design direction so it does not depend on chat history. It is a living design reference and must be updated when Safwan approves a material design decision.

## 1. Current decision

AWJ V2 will **not** visually clone Microsoft Dynamics 365 and will **not** adopt the experimental Stitch invoice screen as a final design.

The direction is:

1. **AWJ visual concepts created on 2026-09-06** are the primary visual starting point. The representative concepts currently cover:
   - Sales invoice — desktop.
   - Product create/master record — desktop and mobile.
   - Customer create/master record — desktop and mobile.
2. **Microsoft Dynamics 365 Finance & Operations** is a structural/ERP UX reference, especially for disciplined page/form patterns, business workflows, document entry, grids, lookups, contextual actions, master records, and information density.
3. **The existing AWJ design system and production code** remain the implementation/technical baseline. V2 should evolve them rather than unnecessarily rebuild the product.
4. The experimental Stitch work is useful exploration only. It helped validate ERP density, line-item prominence, contextual commands, RTL behavior, and the rule against duplicate navigation, but it is not a final production specification.

Formula:

**Existing AWJ identity + 2026-09-06 AWJ concepts + Dynamics pattern discipline = AWJ Design System V2**

Not: “Dynamics in Arabic”.

## 2. Product design principles

AWJ is a daily-use accounting and ERP tool. Priorities, in order:

1. Clarity.
2. Productivity and speed.
3. Appropriate information density.
4. Accounting confidence and precision.
5. Consistency.
6. Accessibility.
7. Visual polish without decoration for its own sake.

Avoid generic SaaS dashboard styling, excessive whitespace, oversized cards/controls, gradients, glass effects, heavy shadows, decorative icon containers, unnecessary animations, and arbitrary colors.

The mandatory visual and implementation quality bar is defined separately in `AWJ_V2_DESIGN_QUALITY_BAR.md` and applies to all V2 patterns and implementations.

## 3. Existing design foundations to preserve initially

Unless a later approved V2 decision explicitly changes them:

- Arabic-first and RTL-first; English mirrors correctly.
- IBM Plex Sans Arabic for UI text.
- IBM Plex Mono for monetary values, quantities, account codes, SKUs, and document numbers where appropriate.
- Primary light brand blue: `#1E40AF`.
- Primary dark brand blue: `#4F8CFF`.
- Semantic positive/negative/warning colors remain semantic, not decorative branding.
- Light and dark themes.
- Lucide line icons.
- Default radius approximately 8px.
- Semantic Tailwind/CSS tokens rather than raw component colors.
- shadcn/ui as the existing component foundation.
- TanStack-based data-table direction.
- react-hook-form + zod form direction.

V2 is primarily an evolution of **screen architecture, reusable page patterns, component behavior, density, and responsive behavior**, not a rebrand.

## 4. AWJ application shell

AWJ must have one clear navigation hierarchy.

### 4.1 Persistent Sidebar

Purpose: **Where can I go?**

The sidebar is the primary application/module navigation. Do not duplicate module navigation in a Dynamics-style global top ribbon.

The final V2 sidebar visual treatment remains an open design decision unless separately approved.

### 4.2 Global Header

Reserved for global/product-level utilities such as global search, notifications, account/user controls, language, and appearance where appropriate.

### 4.3 Page Header

Purpose: **Where am I?**

Contains page/document identity, useful context such as number/status when applicable, and appropriate hierarchy/breadcrumb information.

### 4.4 Contextual Command Bar

Purpose: **What can I do here?**

Contains actions for the current record/document/workspace only. It must not become another application navigation bar.

Examples for a sales invoice may include Save Draft, Issue/Post, Preview, Print, Send, and More Actions, subject to the actual AWJ business workflow.

Rule: prefer one visually dominant primary action where practical; secondary and overflow actions follow a consistent hierarchy.

## 5. Pattern-first screen architecture

AWJ may ultimately contain hundreds of screens, but it must **not contain hundreds of independently invented UI designs**.

Every appropriate product screen should be classified into an approved reusable ERP page/workspace pattern before screen-specific design or implementation begins. The pattern supplies the shared design grammar, structure, behavior, responsive rules, states, and reusable components; the screen supplies its business-specific data, rules, actions, and exceptions.

The architectural chain is:

**AWJ Screen → Approved Page/Workspace Pattern → Shared Components → Design Tokens**

This is a mandatory consistency principle, not merely an implementation optimization.

Consequences:

- Do not design or generate each new screen from a blank canvas when an approved pattern applies.
- Do not force unrelated workflows into the same pattern merely for visual uniformity.
- Screen-specific differences are expected when required by accounting, business workflow, data relationships, security, permissions, or usability.
- Improvements to a shared interaction such as Command Bar behavior, lookup behavior, validation presentation, responsive composition, or grid interaction should normally be solved at the appropriate pattern/component level and inherited by the applicable screen family.
- AI-assisted tools, Claude, Cursor, or other implementation agents must not invent a fresh visual grammar per screen. They must follow the approved pattern and shared components unless an explicit design exception is approved.
- A representative concept can become the reference implementation for a pattern family after review; it does not mean every member of that family has identical content or workflow.

### 5.1 Reference implementation principle

The first thoroughly specified and reviewed screen in a pattern family should be used to validate the pattern itself, not merely that single screen.

For the initial Document Workspace Pattern V2, the 2026-09-06 sales-invoice concept is the primary visual starting point. The resulting specification must be general enough to govern applicable document families such as sales invoices, purchase invoices, quotations, orders, credit/debit notes, and other line-based business documents while preserving each document's real workflow and accounting differences.

A reference implementation is therefore a **pattern proving ground**, not a template to copy blindly.

## 6. Core AWJ V2 page patterns

Rather than independently designing every screen, screens should map to a small number of reusable ERP patterns.

### 6.1 Document Workspace Pattern

Primary reference concept: sales invoice.

Intended family includes, where functionally appropriate:
- Sales invoices.
- Purchase invoices.
- Quotations.
- Sales/purchase orders.
- Credit/debit notes.
- Other line-based business documents.

Typical hierarchy:

1. Page Header.
2. Contextual Command Bar.
3. Core document metadata.
4. Customer/supplier/party information.
5. **Line-items grid as the primary working surface.**
6. Notes/terms/supporting information.
7. Totals, tax and financial summary.
8. Document-specific footer/secondary information where required.

The line-items grid is the hero working surface. Do not sacrifice it for decorative cards or oversized header sections.

### 6.2 Master Record Pattern

Primary reference concepts: customer and product.

Intended for master-data entities such as customers, suppliers, products, and other appropriate master records.

Typical hierarchy:

1. Page Header.
2. Contextual Command Bar.
3. Identity/summary information.
4. Tabs or structured sections.
5. Primary data.
6. Secondary domain-specific data.
7. Related records/activity/transactions where useful.

Customer and product screens should share the same design grammar without forcing identical content structures.

### 6.3 List Workspace Pattern

Intended for invoice, customer, product, supplier, journal, payment, and similar record collections.

Typical hierarchy:

1. Page Header + primary create action where applicable.
2. Search.
3. Filters/filter chips and advanced filtering.
4. Data Grid.
5. Pagination/status controls.

The Data Grid is primary. Do not automatically place dashboard KPI cards above every list.

### 6.4 Report Workspace Pattern

Typical hierarchy:

1. Report identity.
2. Period/branch/context filters.
3. Compact KPI summary where useful.
4. Visualization where it materially aids interpretation.
5. Detailed data grid supporting the reported numbers.

Charts assist understanding; detailed tables remain essential for accounting confidence.

### 6.5 Settings Workspace Pattern

Use clear logical sections, descriptions, fields/toggles, and explicit save behavior. Long settings areas should be structured rather than becoming one undifferentiated form.

### 6.6 Operational Workspace Pattern

Reserved for workflows whose interaction model differs substantially from CRUD/master-data screens, especially POS and other high-frequency operational surfaces. Do not force Document or Master Record patterns onto these workflows when inappropriate.

## 7. Forms V2 direction

Target **balanced ERP density**: denser than generic SaaS forms but more readable than an excessively compressed enterprise form.

Desktop should use efficient two-column layouts where appropriate and three columns for short, strongly related fields only when readability remains high. Important fields may span additional width.

Lookups are first-class controls for high-cardinality business entities such as customers, products, accounts, warehouses, etc. Do not model large business datasets as simplistic giant select menus.

Required, validation, disabled, read-only, loading, error, and permission states must be designed explicitly.

## 8. Data Grid V2 direction

The unified grid specification should eventually cover, as applicable:

- Search.
- Sorting.
- Advanced filtering/filter chips.
- Column visibility.
- Column resizing.
- Selection and bulk actions.
- Pagination.
- Export.
- Sticky headers where useful.
- Hover/focus/selection states.
- Loading, empty, and error states.
- Keyboard navigation for high-frequency workflows.
- Inline editing for document line grids where appropriate.

Financial numbers should be easy to scan, consistently aligned, and use the established financial-number conventions. Color alone must never communicate financial meaning.

## 9. Responsive strategy

Responsive behavior is **pattern-specific**, not merely desktop shrinking and not an unconditional “tables become cards” rule.

The complete viewport/device coverage requirements are governed by `AWJ_V2_DESIGN_QUALITY_BAR.md`. Pattern specifications must account for the relevant continuum of widths/heights rather than validating only a few showcase screenshots.

### Desktop / Laptop

Primary productivity target. Preserve density, keyboard workflows, wide data grids, and efficient use of available workspace. Laptop and constrained-height desktop environments must be treated as first-class productivity contexts, not assumed equivalent to a large monitor.

### Tablet / iPad

Deliberately adapt navigation, command placement, sections, and grids while preserving serious ERP productivity in both relevant orientations.

### Mobile

Recompose layouts for touch and narrow widths. Master records may use structured sections/accordions. Lists may use compact record representations where appropriate. Complex financial/document tables must be evaluated individually; do not automatically convert every table into large cards if that damages scanability or data relationships.

## 10. Lessons retained from the Stitch exploration

The Stitch prototype is not final, but it established useful constraints:

- Do not duplicate module navigation in the top bar when AWJ already has persistent sidebar navigation.
- Contextual document actions belong in the Page Header/Command Bar area.
- The line-items grid deserves substantial workspace.
- Excessive borders and excessive compression reduce usability.
- Dynamics-style density should be interpreted, not copied.
- AWJ should remain visually calmer and clearer than a literal Dynamics clone.

## 11. Microsoft Dynamics reference policy

Dynamics 365 Finance & Operations is a **structural and behavioral ERP reference**, not a branding target.

Study it for:

- Page/form pattern discipline.
- Document workflows.
- Master records.
- Data-grid prominence.
- Lookups.
- Contextual commands.
- Information hierarchy and density.
- Efficient enterprise workflows.

Do not copy Microsoft branding, proprietary visual identity, colors, typography, icons, or global navigation literally.

## 12. What is explicitly NOT approved by this blueprint

This document does not authorize:

- Production implementation.
- Repository-wide UI refactoring.
- Database/API/accounting-rule changes.
- Changes to tenant isolation or security behavior.
- Merge, deployment, or production release.
- Treating generated Stitch screens as final specifications.
- Replacing existing AWJ components before an implementation audit establishes what can be reused.

## 13. Planned next design task

The next recommended design task is to specify the **AWJ Document Workspace Pattern V2** in detail, using the 2026-09-06 sales-invoice concept as the primary visual starting point and Dynamics only as an ERP-pattern reference.

That specification should cover desktop/laptop/tablet/mobile structure, Page Header, Command Bar, document metadata, party/customer lookup, line-items grid, totals, states, validation, keyboard/touch behavior, and responsive behavior.

It must produce a reusable pattern specification rather than a one-off sales-invoice design.

Only after the pattern is reviewed and approved should implementation planning begin.

## 14. Decision log

### 2026-09-07 — Initial V2 direction

- Existing AWJ identity remains the visual foundation.
- 2026-09-06 AWJ concepts are the current visual starting point.
- Dynamics is an ERP UX/pattern reference, not a visual clone target.
- Stitch invoice is exploratory and not final.
- AWJ V2 should be driven by reusable page patterns rather than screen-by-screen redesign.
- Six initial page-pattern families: Document, Master Record, List, Report, Settings, Operational.
- Single primary application navigation via Sidebar; no duplicate top module navigation.
- Responsive behavior becomes pattern-specific; “all tables become cards” is not a universal V2 rule.

### 2026-09-08 — Pattern-first architecture formalized

- AWJ may contain hundreds of screens, but they must derive from a controlled set of approved reusable patterns rather than hundreds of independent designs.
- Formal architecture: **Screen → Pattern → Components → Tokens**.
- Pattern consistency is mandatory while business-specific differences remain first-class.
- The first representative screen in a family validates the reusable pattern rather than becoming a blind copy template.
- Sales Invoice is the initial proving ground for Document Workspace Pattern V2.
- AI-assisted design/implementation agents must follow approved patterns and shared components rather than inventing screen-specific visual grammars.

---

**Owner approval required before implementation, merge, deployment, or production release.**
