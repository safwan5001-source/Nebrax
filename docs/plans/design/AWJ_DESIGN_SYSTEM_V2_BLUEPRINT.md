# AWJ Design System V2 — Blueprint

**Status:** DRAFT / DESIGN DIRECTION
**Date:** 2026-09-08 (updated)
**Scope:** Design and UX architecture only. No production UI implementation is approved by this document.

> This document preserves the current agreed design direction so it does not depend on chat history. It is a living design reference and must be updated when Safwan approves a material design decision.

## 1. Current decision

AWJ V2 will **not** visually clone Microsoft Dynamics 365 and will **not** adopt the experimental Stitch invoice screen as a final design.

The direction is:

1. **AWJ visual concepts created on 2026-09-06** are the primary visual starting point. See [§2 Visual Reference Concepts](#2-visual-reference-concepts) for the saved images and their scope of adoption.
2. **Microsoft Dynamics 365 Finance & Operations** is a structural/ERP UX reference, especially for disciplined page/form patterns, business workflows, document entry, grids, lookups, contextual actions, master records, and information density.
3. **The existing AWJ design system and production code** remain the implementation/technical baseline. V2 should evolve them rather than unnecessarily rebuild the product.
4. The experimental Stitch work is useful exploration only. It helped validate ERP density, line-item prominence, contextual commands, RTL behavior, and the rule against duplicate navigation, but it is not a final production specification.

Formula:

**Existing AWJ identity + 2026-09-06 AWJ concepts + Dynamics pattern discipline = AWJ Design System V2**

Not: “Dynamics in Arabic”.

## 2. Visual Reference Concepts

**AWJ V2 Visual Reference Concepts — 2026-09-06.** Three concept images were produced on 2026-09-06 during V2 direction exploration and are preserved here so future design decisions do not depend on chat history:

1. [`references/awj-v2-sales-invoice-desktop.jpeg`](references/awj-v2-sales-invoice-desktop.jpeg) — AWJ Sales Invoice Concept — Desktop.
2. [`references/awj-v2-product-master-desktop-mobile.jpeg`](references/awj-v2-product-master-desktop-mobile.jpeg) — AWJ Product Create / Master Record Concept — Desktop + Mobile.
3. [`references/awj-v2-customer-master-desktop-mobile.jpeg`](references/awj-v2-customer-master-desktop-mobile.jpeg) — AWJ Customer Create / Master Record Concept — Desktop + Mobile.

These represent the **current visual starting point** for V2 direction — not a production implementation, and not final specifications for every element shown in them.

### 2.1 What these concepts are used for

The concepts are used primarily as a reference for the **main workspace**, specifically:

- Information hierarchy.
- ERP information density.
- Document/form composition.
- Field sizing and grouping.
- Section hierarchy.
- Tabs/sections.
- Contextual page actions.
- Line-item grid prominence.
- Totals and supporting information.
- Master-record composition.
- Desktop/mobile responsive composition.
- Overall clarity and daily ERP usability.

This is the visual direction the team intends to keep studying and evolving. It does **not** mean every pixel, measurement, or control shown is final or approved.

### 2.2 Sidebar — OPEN DESIGN DECISION

**IMPORTANT:** The sidebar / primary navigation shown in the three concept images is **not approved** as the final AWJ V2 design.

None of the following is documented as a final requirement on the basis of appearing in these images:

- Sidebar width.
- Sidebar colors.
- Navigation grouping.
- Navigation labels.
- Icons.
- Active states.
- Spacing.
- Hierarchy.
- Visual treatment.
- Collapse behavior.
- Positioning.

**AWJ V2 Sidebar remains an OPEN DESIGN DECISION.** It will be designed and reviewed independently as part of a future App Shell / Sidebar specification. (Note: §4.1 below records the already-approved *structural* decision that a persistent sidebar is the primary navigation surface and that module navigation must not be duplicated in a top ribbon — that structural decision predates and is independent of these images and remains in force. What is open is the sidebar's visual and interaction design, not whether it exists.)

### 2.3 Global Header / App Shell — not fully approved

The Global Header and App Shell shown in the concept images are likewise **not final specifications**. Appearing in these images does not by itself approve:

- Global search placement.
- User/account placement.
- Notifications placement.
- Theme/language control placement.
- Header height.
- Global action placement.
- Exact shell spacing.
- Desktop shell composition.

These elements will be reviewed as part of a future **AWJ App Shell V2** effort.

The already-approved hierarchy decision in §4 (Primary Navigation / Global Header / Page Header / Contextual Command Bar / Workspace, and no duplicate module navigation) remains in force and is not superseded by these images.

### 2.4 Stitch exploration status

The earlier Stitch invoice-screen exploration referenced throughout this document (see §9) is **exploratory only** and is not a final AWJ V2 design. It is not superseded or replaced by the three concept images above — it is a separate, earlier, non-binding exploration. Lessons already captured from it in §9 remain retained; no new lessons are inferred from it beyond what is already documented there.

### 2.5 Precedence / authority order

To avoid future ambiguity, design authority is ordered as follows, highest first:

1. **Explicit approved decisions in this document** (`AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`).
2. **Future approved AWJ V2 pattern specifications** (e.g. a later-approved Document Workspace Pattern V2 spec, or App Shell V2 spec).
3. **The three AWJ Visual Reference Concepts** (§2 above) as visual-direction references, within the scope defined in §2.1.
4. **Microsoft Dynamics 365** as a structural/ERP UX reference only (see §10).
5. **The Stitch exploration** as non-binding exploratory material (see §9, §2.4).

**If an element visible in a screenshot conflicts with an explicit decision in this Blueprint, the Blueprint wins.** A visual element appearing in a reference image is not, by itself, grounds to infer a new requirement — it must be explicitly promoted to a decision in this document (or a future approved pattern spec) before it is binding.

## 3. Product design principles

AWJ is a daily-use accounting and ERP tool. Priorities, in order:

1. Clarity.
2. Productivity and speed.
3. Appropriate information density.
4. Accounting confidence and precision.
5. Consistency.
6. Accessibility.
7. Visual polish without decoration for its own sake.

Avoid generic SaaS dashboard styling, excessive whitespace, oversized cards/controls, gradients, glass effects, heavy shadows, decorative icon containers, unnecessary animations, and arbitrary colors.

## 4. Existing design foundations to preserve initially

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

V2 is primarily an evolution of **screen architecture, reusable page patterns, component behavior, density, and responsive behavior**, not a rebrand. This task does not change any of the above.

## 5. AWJ application shell

AWJ must have one clear navigation hierarchy.

### 5.1 Persistent Sidebar

Purpose: **Where can I go?**

The sidebar is the primary application/module navigation. Do not duplicate module navigation in a Dynamics-style global top ribbon.

This is a structural decision only — the sidebar's visual design (width, colors, grouping, labels, icons, states, spacing, collapse behavior, positioning) is an **OPEN DESIGN DECISION**; see §2.2.

### 5.2 Global Header

Reserved for global/product-level utilities such as global search, notifications, account/user controls, language, and appearance where appropriate.

Exact placement and composition of these utilities is not finalized; see §2.3.

### 5.3 Page Header

Purpose: **Where am I?**

Contains page/document identity, useful context such as number/status when applicable, and appropriate hierarchy/breadcrumb information.

### 5.4 Contextual Command Bar

Purpose: **What can I do here?**

Contains actions for the current record/document/workspace only. It must not become another application navigation bar.

Examples for a sales invoice may include Save Draft, Issue/Post, Preview, Print, Send, and More Actions, subject to the actual AWJ business workflow.

Rule: prefer one visually dominant primary action where practical; secondary and overflow actions follow a consistent hierarchy.

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

### Desktop

Primary productivity target. Preserve density, keyboard workflows, wide data grids, and efficient use of available workspace.

### Tablet / iPad

Deliberately adapt navigation, command placement, sections, and grids while preserving serious ERP productivity.

### Mobile

Recompose layouts for touch and narrow widths. Master records may use structured sections/accordions. Lists may use compact record representations where appropriate. Complex financial/document tables must be evaluated individually; do not automatically convert every table into large cards if that damages scanability or data relationships.

## 10. Lessons retained from the Stitch exploration

**Status: EXPLORATORY ONLY — not a final AWJ V2 design.** See §2.4.

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
- Treating the 2026-09-06 Visual Reference Concepts (§2) as final specifications for every element shown in them — in particular the Sidebar (§2.2) and Global Header / App Shell (§2.3) remain open.
- Replacing existing AWJ components before an implementation audit establishes what can be reused.

## 13. Planned next design task

The next recommended design task is to specify the **AWJ Document Workspace Pattern V2** in detail, using the 2026-09-06 sales-invoice concept as the primary visual starting point and Dynamics only as an ERP-pattern reference.

That specification should cover desktop/tablet/mobile structure, Page Header, Command Bar, document metadata, party/customer lookup, line-items grid, totals, states, validation, keyboard/touch behavior, and responsive behavior.

Only after the pattern is reviewed and approved should implementation planning begin. This requires a separate decision from Safwan and is not started by this document.

## 14. Decision log

### 2026-09-08 — Visual Reference Concepts preserved

- Saved the three 2026-09-06 AWJ V2 Visual Reference Concepts to `docs/plans/design/references/` and linked them from this Blueprint (§2).
- Documented their scope of adoption: main-workspace direction (information hierarchy, density, composition, field grouping, line-item grid prominence, totals, master-record composition, responsive composition) — not pixel-final specifications.
- Documented the Sidebar shown in the concepts as an explicit OPEN DESIGN DECISION, distinct from the already-approved structural decision that a persistent sidebar is the primary navigation surface.
- Documented the Global Header / App Shell shown in the concepts as not fully approved; deferred to a future AWJ App Shell V2 effort.
- Documented the Stitch exploration as exploratory-only and not superseded by, or a substitute for, the new concept images.
- Recorded an explicit precedence/authority order for design references, with this Blueprint's explicit decisions always winning over anything shown only in a reference screenshot.

### 2026-09-07 — Initial V2 direction

- Existing AWJ identity remains the visual foundation.
- 2026-09-06 AWJ concepts are the current visual starting point.
- Dynamics is an ERP UX/pattern reference, not a visual clone target.
- Stitch invoice is exploratory and not final.
- AWJ V2 should be driven by reusable page patterns rather than screen-by-screen redesign.
- Six initial page-pattern families: Document, Master Record, List, Report, Settings, Operational.
- Single primary application navigation via Sidebar; no duplicate top module navigation.
- Responsive behavior becomes pattern-specific; “all tables become cards” is not a universal V2 rule.

---

**Owner approval required before implementation, merge, deployment, or production release.**
