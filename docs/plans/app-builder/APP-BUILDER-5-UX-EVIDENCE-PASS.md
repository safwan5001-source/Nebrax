# APP-BUILDER-5 — Focused UI/UX Evidence Pass

**Slice:** Builder workspace shell — Pages/Components/Layers, canvas, Inspector, save state,
locale/device controls, responsive admin baseline.
**Date:** 2026-09-24
**Rule applied:** `AWJ_APP_BUILDER_HORIZON_V1_BOOTSTRAP.md`'s mandatory UI/UX workflow — a
focused pass for this exact interaction problem, not a reuse of APP-BUILDER-4's pass (that one
covered a list + a path-picker form; this one covers a structural editor workspace, a materially
different interaction problem).

## Interaction problem

A workspace where a merchant browses their app's pages, sees the selected page's component
structure, previews it at different device widths and locales, and inspects a selected
component's current configuration — **without editing anything yet** (add/remove/drag/property
edits are explicitly APP-BUILDER-6, per the horizon's own task split: "Builder workspace shell"
vs. "Visual editing + history" are two separate, sequenced tasks). The core UX risk is building a
shell that *looks* editable when it isn't — a selected-but-inert Inspector must read as "nothing
to change yet" (task 6 not built), not as a broken form.

## External interaction evidence (references only — no visual identity/assets copied)

1. **Collapsible three-pane editor layout.** Structural/content browser pane (left) + content
   canvas (center) + selected-item properties pane (right), both side panes independently
   collapsible. This exact shape recurs across Oracle Visual Builder/Page Designer's Property
   Inspector docs, Divi's Layers Panel documentation, and Sitecore's Page Builder interface docs —
   confirming it as a converged, not idiosyncratic, pattern for structural content editors.
2. **Layers panel as structural navigation, not just a list.** A tree that mirrors the canvas's
   actual nesting, used for selection (click a layer → canvas highlights it, and the reverse),
   independent of whether editing is available yet.
3. **Properties/Inspector pane scoped to the current selection.** Empty/placeholder state when
   nothing is selected — never a panel that renders empty fields as if something failed to load.

Sources: https://docs.oracle.com/en/cloud/paas/visual-builder/visualbuilder-building-appui/page-designer-property-inspector.html,
https://docs.oracle.com/en/cloud/paas/integration-cloud/visual-developer/page-designer-property-inspector.html,
https://doc.sitecore.com/sai/en/users/sitecoreai/build-pages/working-with-the-page-builder/understanding-the-builder-s-interface.html

## Internal precedent (same codebase, same design system — not a different product's identity)

`web/src/modules/store-experience-builder/ExperienceBuilder.tsx` (the Store Customizer, already
built and shipped in this exact codebase) already solves the **generic workspace chrome** this
slice needs, proven in production: a header with exit/title/dirty-status badge/device toggle
(`desktop`/`tablet`/`mobile`, `PREVIEW_WIDTHS = {mobile: 390, tablet: 768, desktop: 1280}`)/
save button; a left nav rail + panel-specific `aside`; a responsive mobile fallback that collapses
side panels into an edit/preview pane toggle below `lg`. Per CLAUDE.md, **Store Customizer ≠ App
Builder as products** (different data model — presentation config sections vs. App Schema
pages/components — and this task never imports or extends Customizer code), but the *interaction
shape* for "workspace chrome around a device-width canvas with save state" is proven, accessible,
RTL-correct, and already accepted in production here. Reusing the shape (header
layout/device-toggle/dirty-badge pattern), rebuilt fresh for App Builder's own data model, is
exactly the kind of internal precedent this horizon's evidence-pass rule expects to be checked
before external research — not a shortcut around it.

## Retained patterns

- **Three collapsible panes**: Pages+Layers (left, combined — a page picker above a component
  tree of the selected page, since "Pages/Components/Layers" in the horizon task line names three
  closely related structural views, not three separate panels demanding independent screen real
  estate at this stage), Canvas (center), Inspector (right).
- **Device-width canvas toggle** (`mobile`/`tablet`/`desktop`), reusing the exact preview-width
  constants already proven in `ExperienceBuilder.tsx` (`390`/`768`/`1280`) — no reason to invent
  different breakpoints for the same physical problem (previewing a mobile-first experience at
  representative widths).
- **Locale toggle** (`ar`/`en`) drives canvas RTL/LTR direction — App Schema itself carries no
  locale (props are plain strings, not `{ar, en}` pairs, per the real, tested schema contract);
  this toggle previews **direction/layout mirroring** of the AWJ Design System chrome around the
  canvas, not per-string localized content (that App Schema capability does not exist yet).
- **Draft/Saved status badge** in the header, matching the exact `dirty ? warning : positive`
  tone convention `ExperienceBuilder.tsx` already established — reused pattern, not new
  vocabulary. Since this shell has no editing yet, the badge always reads "Saved" today (task 6
  introduces the first way to make it dirty); the component is still built now so task 6 does not
  need to touch workspace chrome.
- **Selection state**: clicking a layer-tree node or (later, task 6) a canvas node sets the
  selected component id; Inspector reads that selection and shows its registry-driven prop list
  (key, type, current value, required/optional) — **read-only** today, matching AB-05's metadata-
  driven-Inspector requirement without pretending editing exists before task 6 builds it.
- **Framework-neutral canvas rendering.** The canvas renders each of the 15
  `RuntimeCapabilities`/`ComponentRegistry` component types as a plain React/Tailwind
  approximation (a labelled box, not a literal Flutter render) — matches AB-11 ("Builder is
  framework-aware only at the runtime capability boundary"); the canvas is a structural preview
  for authoring, not a pixel-exact device simulator.

## Rejected patterns

- **A fourth, separately-scrolling "Components" pane** distinct from "Layers" (seen in some
  external tools as a component-palette-to-drag-in). Rejected for this task: dragging a new
  component onto the canvas is explicitly APP-BUILDER-6 ("select/add/remove/reorder... bounded
  drag/direct manipulation"); building a component palette now with nothing to do with it would
  imply capability that does not exist yet, violating the same "fallback must never look like
  success" honesty principle already applied in APP-BUILDER-4.
- **Editable Inspector fields** (inputs, dropdowns) for props. Rejected for this task on the same
  grounds — task 6 owns property edits. The Inspector here is a typed, read-only display.
- **Copying Store Customizer's visual styling** (its specific colors/spacing choices in
  `ExperienceBuilder.tsx`, some of which predate the current `DESIGN_SYSTEM.md` token set and use
  raw `neutral-*`/`white` classes rather than `--surface`/`--border`/`--muted` tokens). Only the
  *layout shape* is retained; visual language is `DESIGN_SYSTEM.md`'s current token set
  exclusively, matching Quality Gate D ("final implementation conforms to AWJ Design System... no
  parallel ad-hoc design language").

## AWJ UX Decision

1. **Route**: `/app-builder/[id]/builder` — a distinct workspace route from the overview
   (`/app-builder/[id]`), matching the horizon's own Draft ≠ Published ≠ overview separation.
   `/app-builder/[id]`'s existing "coming in a later task" note is replaced with a real link now
   that the route exists.
2. **Layout** (desktop, `lg` and up): fixed-height flex column — header (back, app name, Draft/
   Saved badge, locale toggle, device toggle) → body (`flex`: left panel `~240px` fixed width
   with Pages list above a Layers tree of the selected page; center canvas, horizontally centered
   at the active device width, scrollable; right panel `~280px` fixed width Inspector).
3. **Responsive/mobile admin baseline** (below `lg`, per Quality Gate D's explicit "responsive/
   mobile management path"): side panels collapse behind a bottom tab bar (`الصفحات`/`الطبقات`/
   `الخصائص`) that swaps which panel occupies the screen below the canvas — canvas remains
   visible and primary, matching `ExperienceBuilder.tsx`'s proven `mobilePane`/`mobileSheet`
   pattern conceptually (not its code).
4. **Accessibility**: layer-tree nodes are a real `tree`/`treeitem` ARIA structure (keyboard
   arrow-navigable, `aria-selected`), matching the `radiogroup` precedent APP-BUILDER-4 already
   established for a different custom-control need. Canvas nodes are focusable/selectable via the
   layer tree at minimum in this task (canvas-direct click-to-select is a nice-to-have added only
   if trivial; not a hard requirement since task 6 owns canvas interaction depth).
5. **Key states**: loading (skeleton), error (retry), empty page (canvas shows a neutral "empty
   page" placeholder, not a blank white rectangle that looks broken), no-selection Inspector
   (placeholder text, not empty form fields).
6. **AWJ Design System components reused**: `Badge` (draft/saved status), `Button`, existing
   `LoadingState`/`ErrorState`. No new visual primitive invented beyond what this slice's tree/
   canvas structure genuinely requires (a tree-item row, a device-frame wrapper) — both built from
   existing tokens (`border-border`, `bg-surface`, `text-muted`, `bg-primary-soft`), not new colors.

## What this pass does not cover

Actual editing interactions (select-to-edit property forms, add/remove/reorder, drag/direct
manipulation, undo/redo) get their own focused pass consideration at APP-BUILDER-6 if the
horizon's evidence-pass rule is judged to require it for that slice too (a Decision Gate/scope
question for that task, not pre-answered here). Theme editing (APP-BUILDER-8) and template
browsing (APP-BUILDER-9) are explicitly out of this pass's scope.
