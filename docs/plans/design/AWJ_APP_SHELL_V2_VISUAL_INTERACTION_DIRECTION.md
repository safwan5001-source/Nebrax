# AWJ Design System V2 — App Shell Visual & Interaction Direction

**Status:** DESIGN DIRECTION / PROPOSAL FOR OWNER REVIEW — NOT PRODUCTION IMPLEMENTATION APPROVAL
**Date:** 2026-09-08
**Scope:** Visual and interaction direction for the AWJ App Shell V2, grounded in the approved design-system principles, current AWJ application, App Shell research, and Navigation IA V2 proposal.

This document does not change production UI, routes, permissions, entitlements, APIs, accounting behavior, database structures, or tenant isolation.

## 1. References and authority

This direction follows:

1. `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`
2. `AWJ_V2_DESIGN_QUALITY_BAR.md`
3. `AWJ_ERP_UX_REFERENCE_RESEARCH.md`
4. `AWJ_APP_SHELL_V2_RESEARCH.md`
5. `AWJ_APP_SHELL_V2_SPEC.md`
6. `AWJ_NAVIGATION_IA_AUDIT.md`
7. `AWJ_NAVIGATION_IA_V2_PROPOSAL.md`
8. AWJ V2 visual reference concepts dated 2026-09-06, with the explicit rule that their Sidebar and Global Header are not automatically approved.

If a visual concept conflicts with an explicit Blueprint/spec decision, the explicit decision wins.

## 2. Design intent

The AWJ shell should feel like a mature daily ERP tool:

**quiet, compact, stable, fast, RTL-native, role-aware, and protective of the working surface.**

The shell is not the visual hero. The invoice, journal, grid, report, product record, customer record, or POS workspace is the hero.

Modernity should come from excellent hierarchy, responsive composition, precise spacing, strong search/navigation behavior, state continuity, keyboard/touch/accessibility quality, deliberate Arabic RTL behavior, refined interaction feedback, and consistent component behavior.

It should not come from glass effects, gradients, oversized chrome, decorative icon containers, excessive pills, floating novelty, or generic AI-dashboard styling.

## 3. Shell anatomy

The visual shell is composed of five ownership layers:

1. **Primary Navigation / Sidebar** — where can I go?
2. **Global Header** — global context and utilities.
3. **Page Header** — where am I?
4. **Contextual Command Bar** — what can I do here?
5. **Workspace Surface** — the actual ERP work.

An optional contextual side panel may be used only when a workflow materially benefits from persistent supporting context. It must not become permanent decorative chrome.

### Ownership rule

A control should live at the highest layer where its meaning is truly global — and no higher.

Examples: active company/branch context is global; current invoice status is page/document context; post/save/print belongs to contextual commands; invoice line editing belongs to the workspace; module destinations belong to primary navigation.

## 4. Primary Navigation visual direction

### 4.1 Arabic-first placement

**Proposed direction:** Primary Navigation is on the **right in Arabic RTL** and mirrors to the **left in English LTR**.

This is a proposed visual direction, not yet owner-approved production behavior.

The entire shell must be logically mirrored, not merely CSS-flipped. Directional icons, drawer motion, chevrons, focus order, drilldown cues, and panel relationships must be reviewed individually.

### 4.2 Expanded navigation is the desktop baseline

For normal desktop/laptop working conditions, the baseline should be an expanded navigation state with readable Arabic labels.

AWJ contains semantically close financial/business domains; icon-only navigation increases memorization cost; Arabic labels are important orientation signals; accounting software benefits from predictable explicit naming.

A compact icon rail is **not approved as a mandatory state**. It may be prototyped only if it provides meaningful workspace gain without harming recognition/accessibility.

### 4.3 Width

No exact production width is approved yet. Prototype the narrowest expanded width that comfortably supports real Arabic labels, active states, grouping, badges/indicators where justified, and browser text scaling.

Do not select a width merely because it matches the 2026-09-06 concepts or another ERP. Validation must include long Arabic labels and 125–200% browser/text scaling scenarios.

### 4.4 Visual treatment

Target low visual noise, clear separation from workspace without a heavy wall, restrained borders/surface contrast, no large colored icon tiles, Lucide-style line icons consistent with AWJ, labels as the primary meaning carrier, unmistakable hover/focus/current states, quiet non-interactive section labels, and no accordion theatrics.

The active destination must remain clear in light/dark themes and high zoom and must not rely on color alone.

### 4.5 Sidebar surface color — research-informed position

**Do not assume that a colored or dark Sidebar is inherently more modern or more appropriate for AWJ.**

Current enterprise shell guidance demonstrates that a neutral navigation surface with strong state treatment is a valid modern approach. AWJ's shell should therefore treat Sidebar color as a visual hypothesis to validate, not a branding requirement.

The default direction for the next prototype is:

- preserve a **neutral/quiet Sidebar candidate as the primary baseline**;
- compare a restrained AWJ brand-tinted candidate only if it improves orientation without competing with financial data;
- keep brand color concentrated where it carries interaction or state meaning;
- reject large saturated navigation surfaces if they dominate long daily ERP sessions or reduce the prominence of workspace data;
- evaluate light and dark themes independently rather than mechanically inverting the same treatment.

The final decision must be based on long-session comfort, navigation/workspace separation, active-state clarity, RTL readability, accessibility, and full viewport behavior — not a single attractive mockup.

### 4.6 Grouping

Use the Navigation IA V2 content model. Prototype quiet non-interactive section labels rather than a third interactive hierarchy level.

Candidate scanning groups: Core business; Financial; People & Operations; Administration. Exact Arabic wording remains open and should be tested with the actual menu content.

## 5. Global Header visual direction

The Global Header should be **small, stable, and genuinely global**. It should not become a second module-navigation row or a place to dump current-page actions.

Candidate contents include AWJ identity/product mark, global search/command entry, current company/legal-entity context where applicable, active branch context where applicable, notifications, Help Center, user/account menu, and language/appearance controls through appropriately compact affordances.

Company and branch context must be understandable without consuming excessive header width. The user should be able to tell which business context they are operating in before performing a sensitive transaction. Switching active context and entering branch/company administration are different operations and must remain distinguishable.

Search is a first-class productivity capability. Navigation discovery and business-object search are conceptually distinct even if a future command surface coordinates them. Search must not simply disappear at laptop/tablet widths to keep the header visually clean; it may compact into an obvious keyboard-accessible trigger.

## 6. Page Header direction

The Page Header belongs to the current workspace, not the global shell. It should carry only the information needed to establish location/context: page/document title, compact breadcrumbs when useful, document number/status or record identity where appropriate, and concise supporting text only when useful.

Avoid giant SaaS-style page titles and repeated descriptions that consume vertical working space. On constrained-height laptops, the Page Header must be particularly disciplined.

## 7. Contextual Command Bar direction

The Command Bar owns actions for the current record/workspace: Save, Post, Approve, Print/PDF, Duplicate, More actions, Create/Add where appropriate, and similar contextual operations.

Prioritize frequent/important actions, preserve destructive distinction, overflow secondary actions deliberately, avoid duplicating the same primary action across shell layers, require keyboard operation/visible focus, and reflect financial/accounting state truthfully.

The exact command layout is pattern-owned: Document Workspace, Master Record, List, Report, Settings, and Operational workspaces may differ within a shared interaction grammar.

## 8. Workspace frame

The shell should maximize usable working area. Desktop/laptop workspaces should use remaining width efficiently; data-dense screens should not be trapped in decorative max-width containers; lists/grids/reports/documents may use broad width; forms may use controlled widths/columns according to their pattern; fixed shell heights must be budgeted together so short laptops do not become scroll traps.

Use AWJ's existing token philosophy: restrained page background, clear surface/background distinction, subtle borders, minimal shadow, no gradients/glass. The shell remains visually secondary to the data.

## 9. Responsive shell states

Breakpoints must ultimately be content-pressure-driven, not copied from device marketing names.

### State A — Persistent expanded

Best for wide/standard desktop and laptops where the workspace remains productive: full navigation labels, stable Global Header, workspace fills remainder.

### State B — Compact/persistent candidate

Optional for constrained width only if prototype testing proves it useful. It may be a narrower labeled navigation or a compact rail with explicit accessible label discovery. This state is experimental, not mandatory; if recognition cost exceeds the saved width, skip it.

### State C — Overlay navigation

For tablet, high zoom/text scaling, or intermediate widths where persistent navigation harms the workspace: menu trigger remains globally available; navigation opens as overlay/drawer; focus moves into it; Escape/backdrop/close behavior is defined; closing restores focus; underlying workspace is not interactable when modal drawer semantics apply.

### State D — Phone shell

The phone shell uses **non-persistent global navigation** with a compact Mobile Header plus a full Navigation Drawer/Search path. The page/workspace pattern then recomposes independently.

**A persistent global Bottom Navigation bar is not the default AWJ mobile model.** AWJ has too many role-dependent ERP destinations for a small fixed tab bar to represent the global IA truthfully. The Sidebar must not be mechanically converted into 3–5 bottom icons.

High-frequency actions must remain reachable without excessive menu drilling, but that requirement is solved by contextual pattern actions, search/command affordances, and specialized operational patterns — not by misrepresenting the global IA.

## 10. Mobile bottom-area policy — research-informed

The bottom edge of a phone is valuable interaction space. In AWJ it should be **pattern-owned, not globally reserved for navigation**.

### Default rule

**Mobile Global Navigation = compact Header + Navigation Drawer/Search.**

**Mobile Bottom Area = Contextual Actions when the current Page Pattern genuinely benefits from them.**

Examples:

- Sales Invoice may expose draft/save/post or other approved document actions in a mobile action area when this materially improves completion speed.
- POS may use the bottom region for checkout/payment/high-frequency operational actions because POS is a specialized Operational Workspace.
- A report may use no bottom action area at all.
- A read-only master record may not need persistent bottom actions.

### What not to do

Do not create a global `Home | Sales | More` bar merely because it is familiar in consumer mobile apps. Do not reserve vertical space for global tabs when the current ERP task benefits more from contextual actions. Do not mix global destinations and current-record actions in the same bottom bar.

### Exceptions

A future role-specific or specialized workflow may justify a small bottom navigation model, but it must be documented as a deliberate **Operational Workspace exception**, not a new global App Shell rule.

## 11. Height-responsive behavior

Width alone is insufficient. The shell must explicitly support short laptop/browser viewports.

Avoid stacking tall Global Header + Page Header + Command Bar; sticky/fixed elements must earn their vertical cost; Sidebar footer/profile controls must not push core navigation off-screen without a usable scroll model; active destination must remain reachable; menus/popovers must respect available viewport height; workspace receives the largest practical vertical budget.

A design that works at a tall mockup viewport but becomes cramped on a common short laptop fails the Quality Bar.

## 12. Navigation motion and feedback

Motion should explain state, not decorate it. Use restrained transitions for opening/closing overlay navigation, justified disclosures, popovers/menus, and contextual panels. Avoid springy playful movement, slow Sidebar animation, animated gradients, attention-seeking indicators, or motion that delays accounting work. Respect reduced-motion preferences.

## 13. Accessibility interaction contract

The shell prototype/spec must demonstrate semantic navigation landmarks, current-page semantics, disclosure state semantics, logical keyboard order in RTL/LTR, visible focus, accessible names for icon-only controls, no hover-only required interaction, mobile drawer focus management, Escape close where appropriate, understandable company/branch context, active state not conveyed by color alone, zoom/text scaling without lost functionality, adequate touch targets, and reduced-motion support.

## 14. Visual freshness gate

Before approving the shell, compare each material visual/interaction choice against current enterprise guidance rather than copying historical ERP conventions.

Evaluate current support status, newer accessibility/responsive alternatives, Arabic RTL fitness, data-density/accounting productivity, laptop/tablet/mobile/zoom behavior, and maintainability within AWJ's Next.js/Tailwind/shadcn architecture.

Newer is not automatically better, and older is not automatically obsolete. The target is the best current solution for AWJ.

## 15. Prototype content scenarios

A meaningful visual prototype must not use one idealized menu/data state. Prototype at least:

1. **Broad administrator/accountant** — most core, financial, reporting, administration destinations.
2. **Sales user** — Sales, Customers, relevant Products/Reports, POS if entitled; sensitive accounting/admin absent.
3. **Inventory/purchasing user** — Purchases, Products & Inventory, relevant Reports; limited financial/admin.
4. **Specialized/restricted user** — only a small number of operational destinations.

The shell should look intentional in all four states.

## 16. Required viewport prototype matrix

At minimum: wide desktop, standard desktop, constrained-height laptop, tablet landscape, tablet portrait, large phone, standard/narrow phone, an intermediate width where navigation changes mode, browser zoom/text scaling stress state, Arabic RTL, and English LTR mirror.

Do not create one desktop and one phone screenshot and call the shell responsive.

## 17. Prototype visual brief

The first high-fidelity shell prototype should use a real AWJ work surface rather than placeholder dashboard cards.

Recommended primary proving screen: **Sales Invoice / Document Workspace** because it stresses horizontal/vertical workspace capacity and exposes Global Header, Page Header, Command Bar, document form, line grid, totals, and contextual actions together.

Secondary proving screens: Product Master Record, Customer Master Record, Reports workspace/list. The same shell must support all of them without inventing a new global grammar per screen.

For the mobile Sales Invoice prototype, do **not** include a persistent global Bottom Navigation bar by default. Demonstrate compact Header + Drawer/Search, and separately test a pattern-owned contextual bottom action area if useful.

## 18. Explicit non-approvals

This direction does **not** approve:

- the Sidebar shown in the 2026-09-06 reference concepts as-is;
- the Global Header shown in those concepts as-is;
- the global mobile Bottom Navigation shown in the first App Shell reference image;
- Microsoft Dynamics colors/navigation visuals;
- SAP Launchpad visuals;
- Oracle Redwood styling as an AWJ skin;
- Odoo marketplace themes;
- glassmorphism;
- gradients/glow;
- exact Sidebar width;
- exact Header height;
- exact icon set per destination;
- compact icon rail;
- Favorites/Recent;
- global Quick Create;
- exact company/branch selector UI;
- final search/command UI;
- implementation in production.

## 19. Proposed visual decision set for owner review

1. **Arabic Sidebar on the right; English mirrors left.** — PROPOSED.
2. **Expanded labeled navigation is the desktop baseline.** — PROPOSED.
3. **Neutral/quiet Sidebar is the baseline visual candidate; colored Sidebar remains a comparison candidate, not a requirement.** — PROPOSED.
4. **No mandatory icon-only rail.** — PROPOSED; prototype only if useful.
5. **Global Header is compact and global-only.** — PROPOSED.
6. **Reports is a first-class navigation destination.** — PROPOSED from IA.
7. **Ordinary create routes move out of primary Sidebar.** — PROPOSED from IA.
8. **Workspace owns internal module navigation.** — PROPOSED.
9. **Navigation switches to overlay when content pressure/zoom makes persistence harmful.** — PROPOSED.
10. **Mobile global navigation is Header + Drawer/Search, not persistent Bottom Navigation by default.** — PROPOSED after reference research.
11. **Phone bottom area is pattern-owned for contextual actions when useful.** — PROPOSED.
12. **Shell visual language is quiet/flat/precise; no decorative modernity.** — PROPOSED.
13. **Sales Invoice is the first shell proving screen.** — PROPOSED.

None of these authorizes production implementation until owner approval and prototype review.

## 20. Next deliverable

After owner agreement with this direction, produce a **high-fidelity AWJ App Shell V2 reference prototype/visual specification** using the Sales Invoice Document Workspace as the proving surface.

That prototype should explicitly show Arabic RTL desktop/laptop shell, Sidebar expanded and overlay state, compact Global Header, active company/branch context, global search affordance, Page Header + Command Bar ownership, realistic invoice workspace density, tablet and phone recomposition, permission-restricted navigation example, light/dark compatibility direction, and the mobile Header + Drawer model without global Bottom Navigation.

Only after visual/prototype approval should implementation planning begin.

---

**No production implementation, merge, deployment, route change, permission change, entitlement change, accounting change, API change, database change, or tenant-isolation change is authorized by this document.**
