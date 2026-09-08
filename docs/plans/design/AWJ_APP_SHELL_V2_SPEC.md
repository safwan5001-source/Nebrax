# AWJ Design System V2 — App Shell Specification

**Status:** DRAFT SPECIFICATION / OWNER REVIEW REQUIRED
**Date:** 2026-09-08
**Scope:** App Shell and navigation architecture only. No production implementation is authorized.

## 1. Purpose and authority

This specification converts the approved AWJ V2 direction and current App Shell research into a concrete baseline for the future shell.

It is governed by:

1. `AWJ_DESIGN_SYSTEM_V2_BLUEPRINT.md`
2. `AWJ_V2_DESIGN_QUALITY_BAR.md`
3. `AWJ_APP_SHELL_V2_RESEARCH.md`
4. `AWJ_ERP_UX_REFERENCE_RESEARCH.md`

The 2026-09-06 concept screenshots remain visual references for the workspace only. Their sidebar/global-header treatment is not automatically approved.

## 2. Core shell principle

The App Shell must be **quiet, compact, shallow, RTL-native, permission-aware, search-friendly, and aggressively protective of the working surface**.

The shell exists to orient and move the user. It must not compete visually or spatially with invoices, journals, grids, reports, settings, or operational workspaces.

Modernity must come from interaction quality, responsive composition, accessibility, search, hierarchy, state continuity, and visual craft — not decorative effects.

## 3. Ownership model

AWJ V2 uses five distinct ownership layers:

1. **Primary Navigation** — where can I go?
2. **Global Header** — global context and utilities.
3. **Page Header** — where am I?
4. **Contextual Command Bar** — what can I do here?
5. **Pattern-owned Workspace** — the actual business task.

An optional contextual panel may exist only when the workflow materially benefits from it.

No layer should duplicate another layer's responsibility.

## 4. Primary Navigation — baseline decisions

### 4.1 Role

Primary Navigation is the single application/module navigation surface. AWJ must not duplicate the module tree in the Global Header.

### 4.2 Placement and direction

- Arabic/RTL: navigation is anchored to the **right** side of the viewport.
- English/LTR: it mirrors to the **left** side.
- Overlay entrance/exit follows the corresponding logical start side.
- Directional chevrons and drill-down indicators mirror semantically.
- Non-directional icons do not mirror mechanically.

### 4.3 Hierarchy depth

The persistent shell navigation should expose no more than **two meaningful navigation tiers**.

Deeper task hierarchy belongs inside the destination workspace/page rather than becoming a deeply nested sidebar tree.

This is an AWJ rule, not a literal Carbon implementation copy.

### 4.4 Navigation contents

The navigation model should expose business destinations, not repository routes.

Required principles:

- Group by real AWJ business domains and user mental models.
- Respect permissions and entitlements when presenting destinations.
- Never treat hidden navigation as an authorization boundary; backend authorization remains authoritative.
- Do not expose every technical route simply because it exists.
- Do not place record/document actions in the navigation.

Exact module grouping and labels require a separate information-architecture pass against the real AWJ route/module inventory before implementation.

### 4.5 Expanded and compact states

AWJ V2 supports an **expanded persistent navigation state** on sufficiently large working surfaces.

A compact state may be supported on desktop/laptop only if real usability testing shows it preserves comprehension and materially increases workspace. It is **not mandatory** and must not become an icon-memory test.

Therefore:

- Expanded navigation with text labels is the baseline.
- Exact expanded width is a token/spec decision to be validated in prototype, not frozen in this document.
- An icon-only compact rail is not approved by default.
- If a compact state is introduced later, accessible names, tooltips where appropriate, keyboard/focus behavior, and clear current-location signaling are mandatory.

### 4.6 Favorites and recent destinations

Favorites/Recent are **approved as a capability direction**, informed by mature ERP navigation, but not as permanent top-level visual sections.

The detailed placement must avoid cluttering the primary module hierarchy. A later prototype should test whether they belong in navigation, search/command experience, or a lightweight quick-access surface.

## 5. Global Header — baseline decisions

### 5.1 Role

The Global Header is persistent but visually restrained. It contains only global/product-level context and utilities.

### 5.2 Candidate persistent utilities

The shell must provide access to:

- Global search.
- Notifications/alerts.
- User/account controls.
- Company/legal-entity context where applicable.
- Branch context where it is truly session/global in scope.
- Help.
- Language and appearance controls.

Not every utility must remain individually visible at every viewport. Lower-priority utilities may move to overflow/user menu while remaining easy to discover.

### 5.3 Forbidden contents

Do not place in the Global Header:

- Module-tree duplication.
- Current invoice/document actions.
- Page filters.
- Grid actions.
- Record-local state/actions.
- Decorative branding that materially consumes working height.

### 5.4 Height

The Global Header must be compact and fixed-height within a given responsive state, but the exact token is deferred to visual prototype/testing.

A large marketing-style header is prohibited.

## 6. Global context: tenant/company/branch

Scope must be unmistakable.

### 6.1 Tenant/company/legal entity

Where users can operate across companies/legal entities, the current context must be visible and changing it must be deliberate.

The selector must never visually imply that it changes only the current page when it actually changes the broader application context.

### 6.2 Branch

Branch placement depends on actual AWJ semantics:

- If branch is a global/session context, it belongs with global context.
- If branch is merely a filter or document field for a particular workflow, it belongs to that page/pattern instead.

Do not create a universal branch selector until the real semantics are verified during implementation planning.

### 6.3 Safety

Changing company/branch context must not silently discard unsaved work. The future implementation specification must define unsaved-change guards and context-switch consequences.

## 7. Search architecture

AWJ distinguishes two search intents:

1. **Navigation Search** — find and open pages/workspaces.
2. **Business-object Search** — find customers, suppliers, products, invoices, purchase documents, journals, and other permitted records.

The user may eventually access both through one global search/command surface, but the result types must remain semantically distinct.

Requirements:

- Permission-aware results.
- Arabic and English text support.
- Document/account/product codes and numbers.
- Keyboard-first activation on desktop/laptop.
- Touch-first usability on tablet/mobile.
- Result type and destination clarity.
- Search must remain reachable at constrained widths rather than disappearing.
- Route/page search must not be confused with record search.

The existing AWJ Global Search should be audited for reuse before building a replacement.

## 8. Page Header boundary

Page Header belongs to the page/pattern, not the global shell.

It owns:

- Page/document/record title.
- Number or identifier where useful.
- Status/context where useful.
- Breadcrumb/hierarchy when it materially aids orientation.

Breadcrumbs are **conditional**, not mandatory decoration on every page. Do not spend vertical space on breadcrumbs when the hierarchy is already obvious.

## 9. Contextual Command Bar boundary

The Contextual Command Bar owns current page/record/document actions.

Examples include Save Draft, Post/Issue, Preview, Print, Send, Export, or More Actions when those actions are valid for the pattern/workflow.

Rules:

- Prefer one clear primary action where practical.
- Secondary actions follow a stable hierarchy.
- Rare actions move to overflow.
- Do not leak these actions into the Global Header.
- Responsive collapse of page actions is independent of global utility collapse.

## 10. Responsive shell state model

Breakpoints must ultimately be content-driven and validated against real AWJ screens. Device names below describe expected behavior, not hard-coded CSS breakpoints.

### 10.1 Wide/standard desktop

Baseline:

- Persistent expanded navigation.
- Compact Global Header.
- Full workspace productivity.
- Extra width belongs primarily to the workspace, not shell chrome.

Optional compact navigation can be tested but is not required.

### 10.2 Laptop / constrained-height desktop

Baseline:

- Persistent navigation remains viable when content width allows.
- Fixed vertical chrome must be minimized.
- Global Header + Page Header + Command Bar must be evaluated as one vertical budget.
- Short-height viewports are mandatory acceptance cases.

### 10.3 Tablet landscape

The shell may retain persistent navigation only when the remaining workspace stays productive. Otherwise navigation becomes an overlay/drawer.

Do not choose behavior solely because the device is called a tablet.

### 10.4 Tablet portrait

Baseline candidate: non-persistent overlay navigation unless prototype evidence shows a persistent state remains clearly superior for a specific width/content combination.

Tablet remains a serious ERP working surface; page patterns must not collapse prematurely into phone layouts.

### 10.5 Phone

- Navigation is non-persistent.
- It opens as a modal/overlay drawer from logical start.
- Main content is not permanently compressed by navigation.
- Current page/workflow remains obvious after closing navigation.
- Global utilities are prioritized and overflow deliberately.
- Search remains directly reachable.

### 10.6 Zoom/text scaling/intermediate widths

Persistent navigation must transition to overlay when available content space becomes insufficient, including high browser zoom/text scaling scenarios.

The transition must be based on layout pressure, not user-agent detection.

## 11. Navigation overlay behavior

For non-persistent navigation:

- Trigger has an accessible name and expanded state.
- Opening moves focus into the navigation appropriately.
- Focus is contained when modal behavior applies.
- Escape closes where platform conventions support it.
- Closing returns focus to the invoking control when appropriate.
- Background interaction is prevented when the drawer is modal.
- Current destination remains programmatically indicated.
- Drawer direction follows RTL/LTR logical start.
- Motion is short and respects reduced-motion preferences.

## 12. Accessibility requirements

Mandatory shell acceptance criteria:

- Semantic navigation landmarks.
- Skip-to-main-content capability for keyboard users.
- `aria-current` or equivalent current-destination semantics.
- Expand/collapse state exposed programmatically.
- Complete keyboard access without hover dependency.
- Visible focus states.
- Icon-only controls have accessible names.
- Active/current state is not color-only.
- Logical DOM/focus order in RTL and LTR.
- Screen-reader behavior tested for navigation state changes.
- Zoom and text scaling included in QA.
- Touch targets remain usable without making desktop density unnecessarily large.
- Reduced motion respected.

## 13. Workspace protection rules

The following are mandatory:

- No redundant global/module navigation bars.
- No oversized sidebar solely for aesthetics.
- No permanent decorative right/left panels.
- No shell cards, gradients, glass, glow, or large shadows for visual novelty.
- No unnecessary vertical stacking of headers/toolbars.
- Invoice/document line grids and dense data grids must retain maximum practical area.
- Shell changes must be tested on constrained-height laptops, not only 1440p/large monitors.

## 14. Optional contextual panel

A contextual side panel is permitted only when it supports a real task such as related details, assistance, activity, preview, or review context.

It must:

- Be pattern/workflow-owned rather than global decoration.
- Be dismissible or adaptive where appropriate.
- Never permanently consume space without measurable workflow value.
- Recompose to overlay/full-screen behavior when narrow.

No permanent global right panel is approved.

## 15. Visual direction

The exact final visual design still requires prototypes, but the shell must follow these constraints:

- Existing AWJ identity remains the foundation.
- Restrained surfaces and borders.
- High-quality typography and alignment.
- Clear current destination without loud color blocks.
- Lucide line-icon direction remains unless separately changed.
- No Microsoft/SAP/Oracle/Carbon visual cloning.
- No generic AI dashboard shell.
- No decorative colored icon boxes.
- No glassmorphism/gradient shell treatment.

## 16. Information architecture work required before implementation

Before production implementation, inspect the actual AWJ navigation inventory and map every user-facing destination to:

- business domain/module;
- page pattern;
- permission/entitlement;
- primary vs secondary destination;
- whether it belongs in persistent navigation, workspace navigation, settings, search-only discovery, or contextual navigation;
- Arabic and English label;
- icon if needed.

This audit must not change permissions or backend authorization semantics.

## 17. Prototype/test matrix

The App Shell prototype must be tested at minimum against representative real AWJ patterns:

- Document Workspace: Sales Invoice.
- Master Record: Product or Customer.
- List Workspace: a dense invoice/product list.
- Report Workspace: a data-heavy report.
- Settings Workspace: long settings/navigation content.
- Operational Workspace: POS or another high-frequency workflow where the standard shell may adapt.

Viewport/stress coverage must include:

- wide desktop;
- standard desktop;
- constrained-height laptop;
- tablet landscape;
- tablet portrait;
- large phone;
- standard phone;
- narrow phone;
- intermediate widths;
- browser zoom/text scaling;
- long Arabic labels;
- English LTR;
- permission-reduced navigation;
- long company/branch names;
- empty and high-count notification states.

## 18. Explicitly deferred decisions

The following are intentionally not frozen until prototypes and the real navigation inventory are reviewed:

1. Exact navigation width.
2. Exact Global Header height.
3. Exact visual styling of active navigation.
4. Whether a compact desktop rail provides enough value to justify it.
5. Exact module grouping/labels.
6. Exact Favorites/Recent placement.
7. Exact unified-search presentation.
8. Exact company/branch selector UI.
9. Exact notification surface.
10. Exact tablet transition thresholds.
11. Exact contextual-panel visual implementation.
12. Exact logo/wordmark treatment in expanded/constrained states.

These are deferred deliberately; concept screenshots must not be used to silently fill them in.

## 19. Freshness rule

Before implementation, any external reference used to justify a shell behavior must pass the Freshness & Modernity Gate in `AWJ_V2_DESIGN_QUALITY_BAR.md`.

Current research supports the durable principles in this spec, but implementation must not reproduce legacy vendor chrome simply because it is familiar.

## 20. Implementation gate

This document does **not** authorize production implementation.

Before implementation:

1. Owner reviews this baseline.
2. Actual AWJ navigation inventory is audited.
3. Visual shell prototypes are produced and reviewed across the test matrix.
4. Open visual/token decisions are resolved.
5. Existing AWJ shell/search/navigation components are audited for reuse/evolution.
6. A scoped implementation plan/PR sequence is approved.

No database, accounting, API, permission, tenant-isolation, merge, deploy, or production-release change is authorized here.

## 21. Proposed decision summary

Subject to owner review, AWJ App Shell V2 should use:

- One primary navigation surface.
- Right-side navigation in Arabic RTL, mirrored left in English LTR.
- Maximum two shell navigation tiers.
- Expanded labeled navigation as desktop baseline.
- No mandatory icon-only rail.
- Compact, global-only header.
- Clear separation of global context, page identity, and contextual actions.
- Navigation search and business-object search as distinct intents, even if eventually unified in one interaction surface.
- Overlay navigation when content pressure, viewport width, zoom, or text scaling makes persistence harmful.
- Strong keyboard/focus/screen-reader semantics.
- Conditional breadcrumbs.
- No permanent global contextual side panel.
- Workspace area prioritized over shell chrome.

---

**Owner approval is required before this draft becomes an approved AWJ V2 shell specification or before any production implementation begins.**
