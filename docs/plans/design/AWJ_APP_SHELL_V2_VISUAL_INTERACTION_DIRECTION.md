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

Modernity should come from:

- excellent hierarchy;
- responsive composition;
- precise spacing;
- strong search/navigation behavior;
- state continuity;
- keyboard/touch/accessibility quality;
- deliberate Arabic RTL behavior;
- refined interaction feedback;
- consistent component behavior.

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

Examples:

- active company/branch context: global;
- current invoice status: page/document;
- post/save/print invoice: contextual command;
- invoice line editing: workspace;
- module destination: primary navigation.

This prevents duplicate controls and ambiguous ownership.

## 4. Primary Navigation visual direction

### 4.1 Arabic-first placement

**Proposed direction:** Primary Navigation is on the **right in Arabic RTL** and mirrors to the **left in English LTR**.

This is a proposed visual direction, not yet owner-approved production behavior.

The entire shell must be logically mirrored, not merely CSS-flipped. Directional icons, drawer motion, chevrons, focus order, drilldown cues, and panel relationships must be reviewed individually.

### 4.2 Expanded navigation is the desktop baseline

For normal desktop/laptop working conditions, the baseline should be an expanded navigation state with readable Arabic labels.

Why:

- AWJ contains semantically close financial/business domains;
- icon-only navigation increases memorization cost;
- Arabic labels are important orientation signals;
- accounting software benefits from predictable explicit naming.

A compact icon rail is **not approved as a mandatory state**. It may be prototyped only if it provides meaningful workspace gain without harming recognition/accessibility.

### 4.3 Width

No exact production width is approved yet.

Prototype the narrowest expanded width that comfortably supports real Arabic labels, active states, grouping, badges/indicators where justified, and browser text scaling.

Do not select a width merely because it matches the 2026-09-06 concepts or another ERP.

Validation must include long Arabic labels and 125–200% browser/text scaling scenarios.

### 4.4 Visual treatment

Target:

- low visual noise;
- clear separation from workspace without a heavy wall;
- restrained borders/surface contrast;
- no large colored icon tiles;
- Lucide-style line icons consistent with AWJ;
- labels carry meaning; icons assist recognition;
- active destination visible without relying on color alone;
- hover/focus states subtle but unmistakable;
- section labels quiet and non-interactive;
- no accordion theatrics.

The navigation should feel dense enough for ERP but not compressed to the point of touch/accessibility failure.

### 4.5 Grouping

Use the Navigation IA V2 content model.

Prototype quiet non-interactive section labels rather than a third interactive hierarchy level.

Candidate scanning groups:

- Core business.
- Financial.
- People & Operations.
- Administration.

Exact Arabic wording remains open and should be tested with the actual menu content.

### 4.6 Active state

The active state should communicate location through at least two cues, for example:

- tonal surface/background change;
- stronger text/icon emphasis;
- a restrained positional indicator if it improves scanning.

Do not use a large saturated block that visually dominates the workspace.

The active state must remain clear in light/dark themes and high zoom.

## 5. Global Header visual direction

### 5.1 Role

The Global Header should be **small, stable, and genuinely global**.

It should not become a second module-navigation row or a place to dump current-page actions.

### 5.2 Candidate contents

The prototype should evaluate:

- AWJ identity / product mark;
- global search / command entry;
- current company/legal-entity context where applicable;
- active branch context where applicable;
- notifications;
- Help Center;
- user/account menu;
- language/appearance controls, likely through user/settings affordances rather than permanent clutter.

Exact order and placement remain open until prototype review.

### 5.3 Context visibility

Company and branch context must be understandable without consuming excessive header width.

Critical requirement:

**the user should be able to tell which business context they are operating in before performing a sensitive transaction.**

The visual design must distinguish:

- switching active working context;
- entering branch/company administration.

These are different operations.

### 5.4 Search

Search is a first-class productivity capability.

The visual prototype should reserve a strong but compact search affordance that can support AWJ's existing global business-object search direction.

Navigation discovery and business-object search are conceptually distinct even if a future command surface coordinates them.

Do not make search disappear at laptop/tablet widths simply to keep the header visually clean. It may compact into an icon/trigger, but its availability must remain obvious and keyboard-accessible.

## 6. Page Header direction

The Page Header belongs to the current workspace, not the global shell.

It should carry only the information needed to establish location/context, such as:

- page/document title;
- compact breadcrumbs when they materially help orientation;
- document number/status or record identity where appropriate;
- a concise supporting description only when useful.

Avoid giant SaaS-style page titles and repeated descriptions that consume vertical working space.

On constrained-height laptops, the Page Header must be particularly disciplined.

## 7. Contextual Command Bar direction

The Command Bar owns actions for the current record/workspace.

Examples:

- Save.
- Post.
- Approve.
- Print/PDF.
- Duplicate.
- More actions.
- Create/add where appropriate.

Principles:

- prioritize frequent/important actions;
- preserve dangerous/destructive distinction;
- overflow secondary actions deliberately;
- do not scatter the same primary action across Sidebar, Global Header, Page Header, and body;
- keyboard operation and visible focus are mandatory;
- financial/accounting state must determine action availability truthfully.

The exact command layout is pattern-owned: Document Workspace, Master Record, List, Report, Settings, and Operational workspaces may differ within a shared interaction grammar.

## 8. Workspace frame

The shell should maximize usable working area.

### Desktop/laptop

- workspace uses remaining width efficiently;
- avoid decorative max-width containers on data-dense screens;
- lists/grids/reports/documents can use broad width where needed;
- forms may use controlled readable widths/columns according to their pattern;
- fixed shell heights must be budgeted together so short laptops do not become scroll traps.

### Surface hierarchy

Use AWJ's existing token philosophy:

- restrained page background;
- clear surface/background distinction;
- subtle borders;
- minimal shadow;
- no gradients/glass.

The shell must remain visually secondary to the data.

## 9. Responsive shell states

Breakpoints must ultimately be content-pressure-driven, not copied from device marketing names.

### State A — Persistent expanded

Best for wide/standard desktop and laptops where the workspace remains productive.

- full navigation labels;
- stable Global Header;
- workspace fills remainder.

### State B — Compact/persistent candidate

Optional state for constrained width only if prototype testing proves it useful.

Possible behaviors:

- narrower labeled navigation;
- or compact rail with explicit accessible label discovery.

This state is **experimental**, not mandatory. If recognition cost is worse than the saved width, skip it.

### State C — Overlay navigation

For tablet, high zoom/text scaling, or intermediate widths where persistent navigation harms the workspace.

- menu trigger remains globally available;
- navigation opens as an overlay/drawer;
- focus moves into the drawer;
- Escape/backdrop/close behavior is defined;
- closing restores focus to the trigger;
- underlying workspace is not interactable while modal drawer semantics apply.

### State D — Phone shell

- non-persistent primary navigation;
- compact global utilities;
- current context remains visible enough for safe work;
- page/workspace patterns recompose independently;
- do not turn every page into generic cards;
- high-frequency actions remain reachable without excessive menu drilling.

## 10. Height-responsive behavior

Width alone is insufficient.

The shell must explicitly support short laptop/browser viewports.

Rules:

- avoid stacking tall Global Header + tall Page Header + tall Command Bar;
- sticky/fixed elements must earn their vertical cost;
- Sidebar footer/profile controls must not push core navigation off-screen without a usable scroll model;
- active destination must remain reachable/visible;
- menus/popovers must respect available viewport height;
- workspace should receive the largest practical vertical budget.

A design that works at 1440×1000 but becomes cramped at a common laptop-height viewport fails the Quality Bar.

## 11. Navigation motion and feedback

Motion should explain state, not decorate it.

Use restrained transitions for:

- opening/closing overlay navigation;
- expanding a justified navigation disclosure;
- popovers/menus;
- contextual panel entry/exit.

Avoid:

- springy playful movement;
- slow sidebar animation;
- animated gradients;
- attention-seeking active indicators;
- motion that delays accounting work.

Respect reduced-motion preferences.

## 12. Accessibility interaction contract

The shell prototype/spec must demonstrate:

- semantic navigation landmark;
- current page via `aria-current` or equivalent semantics;
- disclosure state via `aria-expanded` where applicable;
- logical keyboard tab order in RTL and LTR;
- visible focus on every interactive control;
- accessible names for icon-only controls;
- no hover-only required interaction;
- mobile drawer focus management;
- Escape close where appropriate;
- screen-reader understandable company/branch context;
- active state not conveyed by color alone;
- zoom/text scaling without lost functionality;
- adequate touch targets on tablet/phone;
- reduced-motion support.

## 13. Visual freshness gate

Before approving the shell, compare each material visual/interaction choice against current enterprise guidance rather than copying historical ERP conventions.

Evaluate:

- whether the pattern is still actively supported;
- whether a newer alternative improves accessibility or responsive behavior;
- whether it works with Arabic RTL;
- whether it protects data density and accounting productivity;
- whether it survives laptop/tablet/mobile/zoom;
- whether it will remain maintainable within AWJ's Next.js/Tailwind/shadcn architecture.

Newer is not automatically better, and older is not automatically obsolete. The target is the best current solution for AWJ.

## 14. Prototype content scenarios

A meaningful visual prototype must not use one idealized menu/data state.

Prototype at least:

### Persona/menu shape 1 — broad administrator/accountant

Most core, financial, reporting, and administration destinations visible.

### Persona/menu shape 2 — sales user

Sales, Customers, relevant Products/Reports, POS if entitled; sensitive accounting/admin destinations absent.

### Persona/menu shape 3 — inventory/purchasing user

Purchases, Products & Inventory, relevant Reports; limited financial/admin access.

### Persona/menu shape 4 — specialized/restricted user

Only a small number of operational destinations visible.

The shell should look intentional in all four states.

## 15. Required viewport prototype matrix

At minimum, visual validation must cover:

- wide desktop;
- standard desktop;
- constrained-height laptop;
- tablet landscape;
- tablet portrait;
- large phone;
- standard/narrow phone;
- at least one intermediate width where navigation changes mode;
- browser zoom/text scaling stress state;
- Arabic RTL;
- English LTR mirror.

Do not create one desktop and one phone screenshot and call the shell responsive.

## 16. Prototype visual brief

The first high-fidelity shell prototype should use a real AWJ work surface rather than placeholder dashboard cards.

Recommended primary proving screen:

**Sales Invoice / Document Workspace**

Why:

- it is one of the strongest existing AWJ V2 visual references;
- it stresses horizontal and vertical workspace capacity;
- it exposes Global Header, Page Header, Command Bar, document form, line grid, totals, and contextual actions together;
- it makes an oversized or noisy shell immediately obvious.

Secondary proving screens:

- Product Master Record.
- Customer Master Record.
- Reports workspace/list.

The same shell must support all of them without inventing a new global grammar per screen.

## 17. Explicit non-approvals

This direction does **not** approve:

- the Sidebar shown in the 2026-09-06 reference concepts as-is;
- the Global Header shown in those concepts as-is;
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

## 18. Proposed visual decision set for owner review

The following are now mature enough to review as a set:

1. **Arabic Sidebar on the right; English mirrors left.** — PROPOSED.
2. **Expanded labeled navigation is the desktop baseline.** — PROPOSED.
3. **No mandatory icon-only rail.** — PROPOSED; prototype only if useful.
4. **Global Header is compact and global-only.** — PROPOSED.
5. **Reports is a first-class navigation destination.** — PROPOSED from IA.
6. **Ordinary create routes move out of primary Sidebar.** — PROPOSED from IA.
7. **Workspace owns internal module navigation.** — PROPOSED.
8. **Navigation switches to overlay when content pressure/zoom makes persistence harmful.** — PROPOSED.
9. **Shell visual language is quiet/flat/precise; no decorative modernity.** — PROPOSED.
10. **Sales Invoice is the first shell proving screen.** — PROPOSED.

None of these authorizes production implementation until owner approval and prototype review.

## 19. Next deliverable

After owner agreement with this direction, produce a **high-fidelity AWJ App Shell V2 reference prototype/visual specification** using the Sales Invoice Document Workspace as the proving surface.

That prototype should explicitly show:

- Arabic RTL desktop/laptop shell;
- Sidebar expanded and overlay state;
- compact Global Header;
- active company/branch context;
- global search affordance;
- Page Header + Command Bar ownership;
- realistic invoice workspace density;
- tablet and phone recomposition;
- permission-restricted navigation example;
- light/dark compatibility direction.

Only after visual/prototype approval should implementation planning begin.

---

**No production implementation, merge, deployment, route change, permission change, entitlement change, accounting change, API change, database change, or tenant-isolation change is authorized by this document.**
