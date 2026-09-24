# APP-BUILDER-6 — UI/UX Evidence Pass

Written before implementation, per the horizon bootstrap's mandatory workflow: "For every major
user-facing Builder slice... perform a focused current UI/UX Evidence Pass for the exact
interaction problem... Repeat this per major slice; one horizon-wide benchmark is insufficient."

## Why this slice needs its own pass

APP-BUILDER-5's evidence pass explicitly scoped itself to a **read-only** shell and listed
editable Inspector fields, add/remove, and drag reorder as rejected-for-that-task — deferred here.
The interaction problem this task solves (turning a display into something the user *changes*, with
history and explicit save) is materially different from APP-BUILDER-5's (turning schema data into a
*legible* structural view). It is a "major user-facing Builder slice" by the bootstrap's own test:
it introduces the workspace's first destructive/undoable actions and its first form inputs.

## External interaction evidence (references only — no visual identity/assets copied)

1. **Inline, type-driven property editing.** Figma's and Webflow's property panels render a
   different control per value type (text field, number stepper, dropdown for a fixed set of
   options) directly in the same pane that, moments earlier, showed a read-only value — the
   panel's *shape* does not change between read and edit, only whether its fields are inert.
   Confirms the AWJ-4/5 "fallback must never look like success" principle in reverse: the panel
   built in APP-BUILDER-5 was deliberately shaped like the panel this task activates, not rebuilt.
2. **Global undo/redo via a bounded history stack with toolbar affordances.** Figma, Google Docs
   and VS Code all expose undo/redo as toolbar buttons (disabled when the relevant stack is empty)
   *and* the platform keyboard shortcut (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`) — never one without the
   other, since a workspace with keyboard focus inside a text field still needs a discoverable
   button for a mouse-only user.
3. **Explicit save, not silent autosave, for a single-writer draft with no conflict resolution
   built yet.** WordPress's block editor and Webflow's Designer both show an explicit
   "Update"/dirty-state indicator and a deliberate save action rather than autosaving on every
   keystroke — appropriate here specifically because `BuilderDraftExperienceService::save()`
   increments `revision` with no compare-and-swap against a client-known revision (APP-BUILDER-1);
   autosave-on-every-keystroke would race that counter far more than an explicit, infrequent save.
4. **Bounded drag reorder + keyboard-accessible alternative, siblings only.** Confirmed as an
   *internal* precedent already proven in this exact codebase: `web/src/components/settings/
   section-designer.tsx` (`@dnd-kit/core` + `@dnd-kit/sortable`, already a dependency — no new
   package) reorders a flat list via drag *and* explicit up/down buttons, both bounded to the same
   list. This task reuses the identical library and the identical two-affordance pattern, extended
   to a tree (bounded to same-parent siblings — no cross-parent drop, matching the horizon's
   "bounded drag" wording literally).
5. **Add-child via a type picker scoped to the current container, not a global canvas drop zone.**
   Notion's slash menu and WordPress's block inserter both resolve "what can I add here" from the
   currently selected/focused container, not a floating global palette — avoids building a
   full drag-from-palette-onto-canvas interaction (a materially bigger, unproven-here surface) for
   a V1 whose own horizon line reads "select/add/remove/reorder", not "drag-to-insert".

## Retained vs. rejected for this task

**Retained:**
- Inline editable Inspector fields, one control per registry `PropType`/action-param type
  (`string`→text input, `assetUrl`→URL-hinted text input, `integer`→number input honoring
  `min_value` where the registry declares one, `amountMinor`→a Riyal-denominated input converted
  to/from minor units at the edit boundary exactly like every other SAR field in this codebase
  — `products/[id]/page.tsx`'s `Math.round(Number(value) * 100)` pattern — `stringList`→a minimal
  add/remove row list, the only real consumer being `VariantSelector.options`). A prop's
  `enum_values` (`Text.style`, `Button.style`) renders as a `<Select>` of exactly those values,
  never free text, so the Inspector cannot produce a value the runtime widget doesn't defensively
  expect.
- Add child (only on a node whose `children_rule.kind === 'unboundedAny'`), Remove component (any
  non-root node), Move up/down + drag reorder (bounded to siblings), seeded from
  `registries.components[type].props[*].default` so a newly added node renders visibly in the
  canvas immediately rather than as an empty placeholder.
- Attach/detach/change an action on any `actionable` component, editing its params the same
  type-driven way — except a component's own `injected_runtime_action_params` (today only
  `Quantity`'s `quantity`) are never shown as editable fields, since the schema author never sets
  that key — the runtime injects it live (`ComponentRegistry`'s own documented contract).
- Global undo/redo (bounded stack, V1-appropriate — not a persisted/cross-session history) as both
  toolbar buttons and `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`, ignored while focus is inside a text
  input/textarea/select so typing "z" is never hijacked.
- Explicit Draft/Unsaved/Saving/Saved header state + an explicit Save action, and a
  `beforeunload` warning while dirty — no autosave, for the revision-race reason in evidence #3.

**Rejected for this task (explicitly deferred, not silently dropped):**
- **Restricting which component types may be added under which parent** beyond the registry's own
  `none`/`unboundedAny` distinction. Nothing in `AppSchemaParser` or `ComponentRegistry` encodes a
  parent→allowed-children matrix today (verified by reading both), and `suggested_child_type` is
  named *suggested* — inventing an enforced matrix here would be a new validation rule this task
  has no evidence basis for. `suggested_child_type` is used only to pre-select the type picker's
  default option.
- **Free-form/pixel drag-and-drop onto the canvas** (drop a palette item anywhere on the rendered
  preview). Rejected on the same "fallback must never look like success" ground APP-BUILDER-5
  already applied: the canvas is a framework-neutral approximation (AB-11), not a real Flutter
  render target, so a literal pixel-position drop target would imply spatial precision the runtime
  cannot honor. Structural reorder within the Layers tree is the bounded alternative the horizon
  line itself names ("bounded drag/direct manipulation").
- **Multi-select / bulk edit.** Not in the horizon line for this task, and every registry-driven
  Inspector affordance above assumes exactly one selected node.
- **Conflict resolution for concurrent edits** (optimistic-lock revision mismatch UI). No two-writer
  scenario exists in the shipped product yet (single admin session per tenant editing a draft); an
  explicit save with no autosave (evidence #3) already minimizes exposure. A real fix — read-modify
  compare-and-swap against `revision` — is a backend contract change out of this frontend-only
  task's scope.

## AWJ UX Decision

1. Keep APP-BUILDER-5's three-pane shell, route, and responsive/mobile-tab structure unchanged —
   this task changes what the panes *do*, not their layout.
2. Header gains: Undo/Redo icon buttons (disabled when their stack is empty) and a Save button,
   replacing the static `savedBadge` with a state-driven badge (`Saved` / `Unsaved changes` /
   `Saving…`).
3. Inspector's read-only rows become inline form controls, keeping the exact same visual density
   and layout it already had (label above value, full-width) — only the value slot becomes
   interactive. Add-child and Remove-component controls live at the bottom of the Inspector,
   scoped to the current selection, per evidence #5.
4. LayersTree rows gain a drag handle + up/down buttons per evidence #4's internal precedent,
   reusing `@dnd-kit` exactly as `section-designer.tsx` already does — no new dependency, no new
   interaction vocabulary introduced to this codebase.
5. All new visual language comes from `DESIGN_SYSTEM.md`'s existing tokens/components
   (`Input`, `Textarea`, `Select`, `Button`, the AWJ `--primary`/`--surface`/`--border` tokens) —
   no parallel design language, per Quality Gate D.

## What this pass does not cover

Conditions/Visibility, Data binding, and Develop mode (APP-BUILDER-7); theme editing
(APP-BUILDER-8); template browsing/page management beyond the single-page tree this task edits
(APP-BUILDER-9); publish/validate/version/rollback (APP-BUILDER-10). Whether those slices need
their own passes is each task's own scope question, per this same rule, not pre-answered here.
