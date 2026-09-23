# APP-BUILDER-4 — Focused UI/UX Evidence Pass

**Slice:** App Manager (apps list/overview) + creation wizard (Use My Store Design / Choose
Template / Start From Scratch).
**Date:** 2026-09-23
**Rule applied:** `AWJ_APP_BUILDER_HORIZON_V1_BOOTSTRAP.md`'s mandatory UI/UX workflow — a
focused pass for this exact interaction problem, not a reuse of the horizon-wide evidence pass
(`AWJ_APP_BUILDER_HORIZON_V1_EVIDENCE.md`, which covers architecture, not this slice's UI).

## Interaction problem

Two distinct screens: (1) a list of the tenant's apps with their status, and (2) a path-first
creation flow where the merchant picks one of three starting points before naming the app. The
core UX risk is the three-path choice: presenting three options with materially different scope
(two of which — Use My Store Design, Choose Template — do not yet have differentiated content
behind them; APP-BUILDER-8/9 build that) without misleading the merchant about what happens next.

## External interaction evidence (references only — no visual identity/assets copied)

1. **WordPress.com "Add new site" flow.** Presents distinct starting points (build with a theme,
   blank canvas, or import an existing site) as the first decision, before any naming/detail step.
   Confirms: path-first, then identity — not identity-first with a path picker buried in a form.
2. **Shopify theme library.** Installed items shown as a list/grid with a primary per-item action
   ("Customize") and status; adding new items is a separate, explicit action ("Add theme") that
   itself branches into sub-paths (explore free themes / theme store / import). Confirms: the list
   screen and the creation screen are properly separate surfaces, not one combined page.
3. **Empty-state design guidance (UXPin, Eleken — general UX literature, not a specific product).**
   An empty list should orient a first-time user toward the single next action, not just say
   "nothing here." Confirms the Apps list page's empty state must point directly at "create app,"
   not a generic placeholder.

Sources: https://developer.wordpress.com/docs/get-started/build-new-or-migrate/build-new/,
https://help.shopify.com/en/manual/online-store/themes/adding-themes,
https://www.uxpin.com/studio/blog/ux-best-practices-designing-the-overlooked-empty-states/

## Retained patterns

- **Path-first creation, identity second.** Three large, equally-weighted choice cards (not a
  dropdown, not radio buttons) as the first screen of creation; naming is a second, separate step
  reached only after a path is chosen. Matches WordPress.com's ordering and this repo's own
  progressive-disclosure principle (CLAUDE.md AB-10 equivalent for App Builder: AB-10
  "progressive disclosure").
- **List screen and creation screen are separate routes**, not a combined page/modal — matches
  Shopify's theme library separation and this repo's own established pattern (`/products` list vs.
  `/products/import` wizard is a structurally identical precedent already in this codebase).
- **Honest scope labeling on the two not-yet-differentiated paths.** "Use My Store Design" and
  "Choose Template" each carry a short sub-label stating their current V1 behavior (a safe minimum
  shell today; the branded/template content sync itself lands in APP-BUILDER-8/9) rather than
  implying an already-built content pipeline. This is an AWJ-specific addition beyond the external
  references — none of them had this exact "the path exists in the UI before its full backend
  differentiation ships" situation, so no external precedent overrides the honesty requirement
  already fixed by this repo's truthfulness convention.
- **Directly-actionable empty state** on the Apps list ("no apps yet" + the same primary create
  action, not a dead illustration).

## Rejected patterns

- **A single combined "new app" modal with the path picker as one of several form fields.**
  Rejected: buries the most consequential decision (which creation path) among lower-stakes fields
  (name), and doesn't scale to explaining what each path currently does — needs breathing room a
  modal doesn't give.
- **AI-prompt-to-app generation** (seen in current SaaS app-builder marketing, e.g. Lovable/Bubble
  AI-assisted flows). Explicitly out of scope: no such capability exists in this horizon, and nothing
  in `AWJ_APP_BUILDER_HORIZON_V1.md`'s V1 product slice authorizes generative content creation —
  would be a scope expansion, not a UI pattern choice.
- **Copying Shopify/WordPress visual identity** (their card styling, colors, iconography). Only the
  *interaction shape* (path-first, separate list/create surfaces) is retained, per the bootstrap
  doc's "external products are interaction evidence only" rule. Visual language is AWJ Design
  System's existing tokens/components only (`DESIGN_SYSTEM.md`).

## AWJ UX Decision

1. **Apps list** (`/app-builder`): `PageHeader` + primary "create app" action, `DataTable`-free
   simple card/row list (small expected volume — no pagination/filter complexity warranted for V1
   plural apps per tenant), `EmptyState` pointing at the same create action, `LoadingState`,
   `ErrorState` — reusing `@/components/nebrax` exactly as `/applications` and other list screens
   already do.
2. **Creation flow** (`/app-builder/new`): two-section `FormPage` — section 1 is the three path
   cards (radio-group semantics: one selectable card per path, each with an icon, title, one-line
   description, and for the two V1-limited paths, the honest sub-label above); section 2 (revealed
   once a path is chosen) is the name field (`name`, `name_en`) using existing `Input`/`Label`
   components. `FormActions` for the submit bar (matches every other creation form in `web/`).
3. **App overview** (`/app-builder/[id]`): `DetailPage` — title = app name, badge = creation
   source, meta = created date, sections = "published versions" (empty in V1 until
   APP-BUILDER-10) and a note pointing at the Builder workspace as "coming in APP-BUILDER-5" (no
   dead link — the editor route does not exist yet).
4. **Sidebar**: one entry in the existing `sales` group (matches `commerce.app_builder`'s
   `ApplicationCatalog` group), gated by `appKey: 'commerce.app_builder'` and
   `permission: 'apps_builder.view'` — identical gating mechanism every other catalog-backed nav
   item already uses (`sidebar.tsx`'s `GROUPS` array, `GET /applications/nav-state`).
5. **RTL/LTR**: all layout via logical properties (`ms-`/`me-`/`start-`/`end-`) already enforced
   codebase-wide; no new direction-specific asset (icons are symmetric `lucide-react` glyphs).
6. **Accessibility**: path cards are a `role="radiogroup"`/`role="radio"` set (keyboard
   arrow-navigable, single selection, visible focus ring via `--primary`), matching the existing
   `role="switch"` pattern already used in `/applications`'s toggle for an analogous
   custom-control accessibility need.
7. **Key states**: loading (skeleton list), empty (list), error (list + form submit), disabled
   submit until a path + valid name are both set, inline validation error text under the name
   field (matches `StoreBuilderAppRequest`'s required `name`).

## What this pass does not cover

Template gallery content, "Use My Store Design" detection/diff/preview/apply UI, and the Builder
workspace editor itself each get their **own** focused UI/UX Evidence Pass at APP-BUILDER-8/9/5
respectively, per the bootstrap doc's explicit "one horizon-wide benchmark is insufficient. Repeat
this per major slice" rule — this pass does not attempt to pre-design them.
