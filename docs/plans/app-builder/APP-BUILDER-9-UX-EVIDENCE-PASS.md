# APP-BUILDER-9 — UI/UX Evidence Pass

Written before implementation, per the horizon bootstrap's mandatory workflow. This is a "major
user-facing Builder slice" by the bootstrap's own test — it is the workspace's first surface that
edits the schema's `pages` map itself (not a page's contents), and the creation wizard's first step
that produces genuinely different starting content per path.

## Scope, fixed by evidence before design

Research (`docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1.md` task 9; architecture doc
`docs/plans/store/AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §7; direct reading of
`mobile/lib/schema/app_schema.dart`, `app/Services/AppBuilder/AppSchemaParser.php`,
`ComponentRegistry.php`, `ActionRegistry.php`) fixed what this task can honestly build, and — as
important — what it must not invent:

- **`SchemaNavigation` is deliberately minimal.** Its own doc comment in
  `mobile/lib/schema/app_schema.dart`: "`initialPageId` is the only concept needed." No route
  graph, no deep-link table, no tab-bar configuration exists in the accepted, tested contract —
  the architecture doc's own richer "Navigation — route graph/deep-link mapping" Develop-mode panel
  (§ Components | Data | Actions | Navigation | Issues | Console) is the same class of
  **not-yet-locked, aspirational** description that made `APP-BUILDER-7`'s Data/Conditions/
  Visibility ungroundable — it is not repeated here.
- **`AppSchemaParser::validate()` already enforces the entire "system page constraint" surface**
  server-side, today: `pages` must be a non-empty object; every page root's `type` must be
  `'Page'`; `navigation.initialPageId` must reference a declared page. No "required page type"
  (cart/checkout/account) concept exists anywhere in the schema, the parser, or
  `CompatibilityResolver`. "Safe system page constraints" is therefore not a new rule to invent —
  it is a **client-side guardrail that only mirrors validation the server already performs**, so
  the Builder UI never lets a merchant produce a payload the server would reject (never leaving
  zero pages, never leaving `navigation.initialPageId` dangling).
- **Page-to-page navigation is already a real, accepted, tested capability — just not a safe one
  to author today.** `ActionRegistry`'s `navigate` action (built in `APP-BUILDER-3`, editable since
  `APP-BUILDER-6`) takes one param, `pageId: string`, and two components
  (`Button`, `NavigationTarget`) are built specifically for the navigation category. But the
  Inspector's generic `ActionParamField` (`web/src/modules/app-builder/inspector.tsx`) renders
  every string param — `navigate.pageId` included — as a free-text `<Input>`, and **no layer
  anywhere cross-validates a `navigate` action's `pageId` against the schema's actual declared
  pages**. A merchant can type a dead page reference today with no warning until the native app
  hits it at runtime. This is the concrete, evidence-backed meaning of "safe navigation" this task
  closes — a UI fix over an already-accepted action, not a new one.
- **"Templates" already has a named, honest placeholder to fill.** `/app-builder/new`'s own code
  comment: all three creation paths produce the same `BuilderDraftExperienceService::minimalSafeSchema()`
  today, and the `template` path's real content is "مؤجَّل صراحةً إلى APP-BUILDER-8/9" (explicitly
  deferred to APP-BUILDER-8/9) — this is that task. The architecture doc §7 is explicit about
  shape: "A template is more than colors/screenshots. It should be representable through the same
  app contract/runtime... Do not build a separate runtime per template," and explicitly scopes V1:
  "V1 can begin with a small curated template set; marketplace/template ecosystem is later." A
  template is therefore just a complete, valid `AppSchema` JSON document — using only already-
  accepted concepts (`pages`, `theme.tokens`, components, actions) — written through the exact same
  `POST /app-builder/apps` + `PUT .../draft` calls `APP-BUILDER-8` already used unchanged. No new
  backend route, no new persisted "template" entity.

## External interaction evidence (references only — no visual identity/assets copied)

1. **A named list of pages/screens with add/remove and one marked as the entry point.** Confirmed
   as *internal* precedent, not external: this codebase's own "default/primary" pattern already
   exists for Warehouses and Branches (`is_default`/`is_main`, a badge on the list, set via the
   edit form) — reused as the *interaction shape* (one item flagged, a clear badge), not copied
   verbatim, since pages are edited inline in the workspace, not through a separate settings form.
2. **A path-first creation wizard where one path reveals an extra selection step.** Confirmed
   internal precedent: `/app-builder/new` (`APP-BUILDER-4`) already has this exact shape — path
   selector, then a conditional section appears once a path is chosen. This task extends it with
   one more conditional section for the `template` path specifically, not a new wizard shape.
3. **A small curated gallery of starting points (not a marketplace) shown as cards.** WordPress.com
   and Shopify's theme/template pickers both show a small, curated set as visual cards rather than
   a searchable catalog for a first-run choice — general evidence for keeping V1's template count
   small and card-based rather than building list/search/filter machinery this task doesn't need.

## Retained vs. rejected for this task

**Retained:**
- **Pages management in the Builder workspace's existing Pages tab**: Add page (new empty
  `{type:'Page', children:[]}` root with a generated unique id), Remove page, and "Set as home"
  (updates `navigation.initialPageId`) — new client-side helpers in `app-builder.ts`, the
  `pages`-map analogue of `APP-BUILDER-6`'s component-tree helpers (`addChildComponent` etc.),
  through the exact same undo/redo/dirty/save pipeline. Guardrails mirror the server's own
  validation exactly: the current home page cannot be removed (must set a different page as home
  first — never an auto-reassignment guess), and the last remaining page cannot be removed at all.
- **A page picker for the `navigate` action's `pageId` param**: when the Inspector renders that one
  specific param, it becomes a `<Select>` populated from the schema's real declared page ids
  instead of the generic free-text field every other string param still uses — the smallest fix
  that actually closes the dead-reference gap, not a general "reference field type" invented for
  the whole registry.
- **A small curated template set** (2–3 templates) selectable as cards in `/app-builder/new`'s
  `template` path, each a complete, valid, multi-page `AppSchema` built only from already-shipped
  component/action types (the same set `APP-BUILDER-5`'s canvas already renders) — applied via a
  second call to the existing draft-save endpoint immediately after app creation.

**Rejected for this task (explicitly deferred, not silently dropped):**
- **Page rename.** The `pages` map key doubles as the only page identity today — renaming it would
  mean cascading the update into every `navigate` action anywhere in the schema whose `pageId`
  equals the old key (or leaving them silently dangling, which is exactly the unsafe state this
  task exists to prevent). That cascade is a real, separate design question this task's own scope
  ("safe system page constraints") does not require answering today; pages get a generated id at
  creation and keep it. Recorded as an explicit gap, not an oversight.
- **A route graph, deep-link table, or tab-bar navigation editor.** Confirmed above: no such
  concept exists in the accepted contract; building one now would repeat `APP-BUILDER-7`'s mistake
  of inventing a contract "not yet locked" per the architecture doc's own §13 warning, transplanted
  to navigation instead of data/conditions.
- **A template marketplace, search, or user-submitted templates.** Architecture doc §7 explicitly
  scopes V1 to "a small curated template set" — building more is out of this task's own cited
  requirement.
- **Any change to `POST /app-builder/apps`'s request contract.** A template is applied as a second,
  ordinary draft save after creation — `creation_source: 'template'` (already stored since
  `APP-BUILDER-1`) is enough to tell the two calls apart; no `template_key` field is added to the
  creation endpoint.

## AWJ UX Decision

1. The Pages tab (already the default view of the Theme/Pages toggle built in `APP-BUILDER-8`)
   gains an "Add page" action at the top of the page list and, per page row, a small overflow
   action (Set as home / Remove) — reusing the same row-action button language `LayersTree`
   already established in `APP-BUILDER-6` (icon buttons, `aria-label`s, disabled states for
   guardrails) rather than inventing a second row-action pattern in the same workspace.
2. `/app-builder/new` gains a template-card grid, shown only when `source === 'template'`, directly
   below the existing three-path selector — mirroring that selector's own card/radio visual
   language (bordered card, selected state via `border-primary`/`bg-primary-soft`) so the wizard
   reads as one continuous decision, not two different pickers bolted together.
3. All new visual language comes from `DESIGN_SYSTEM.md`'s existing tokens/components — no new
   visual primitive invented, per Quality Gate D, matching every prior App Builder task's precedent.

## What this pass does not cover

Publish/validate/version/rollback (`APP-BUILDER-10`); the deferred `APP-BUILDER-7` concepts
(Data/Conditions/Visibility) remain entirely untouched — this task edits `schema.pages`'s map
shape and one existing action param's editing UX, never `SchemaComponent`-level Conditions/
Visibility/Data fields, and reuses (never duplicates) `APP-BUILDER-6`'s Actions editing.
