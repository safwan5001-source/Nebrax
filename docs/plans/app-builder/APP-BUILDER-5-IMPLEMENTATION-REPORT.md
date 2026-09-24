# APP-BUILDER-5 — Implementation Report

STATUS: pre-merge review
DATE: 2026-09-24

## Outcome

Built the Builder workspace shell: a read-only three-pane workspace (Pages/Layers, Canvas,
Inspector) with locale/device preview controls, a Draft/Saved status badge, and a responsive
mobile admin baseline. Editing itself (add/remove/reorder/property edits, undo/redo) is
explicitly APP-BUILDER-6, per the horizon's own task split — this task never renders an editable
form field. Completed a focused UI/UX Evidence Pass before implementation
(`APP-BUILDER-5-UX-EVIDENCE-PASS.md`), per the horizon bootstrap's mandatory workflow.

## Repository evidence / root cause

Horizon doc task 5 outcome line: "Pages/Components/Layers, canvas, Inspector, save state,
locale/device controls, responsive admin baseline" — a structural shell, with the interactive
editing behavior explicitly deferred to task 6 ("select/add/remove/reorder... bounded drag/direct
manipulation, undo/redo"). This scoping is load-bearing: it means the Inspector this task builds
is **read-only** (AB-05's "metadata-driven Inspector" requirement is satisfied by displaying
registry-driven prop/action metadata against current values, not by requiring editable fields
that task 6 hasn't built yet).

Two research findings shaped the approach:
1. **APP-BUILDER-3's own report flagged its own deferred work**: "First real consumer of these
   registries is APP-BUILDER-5 (Builder workspace shell, Inspector) — until then this is a
   proven-but-unused contract." This task is that consumer — it required a new backend piece
   (serializing `ComponentRegistry`/`ActionRegistry` to JSON) that no prior task built, since no
   prior task needed to read registry metadata over HTTP.
2. **Internal precedent**: `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` (the
   Store Customizer, already shipped in this codebase) already proves the generic workspace-chrome
   pattern this task needs — device toggle (`mobile`/`tablet`/`desktop`, `390`/`768`/`1280`px),
   dirty/saved status badge, responsive mobile-pane collapsing. Per CLAUDE.md, Store Customizer and
   App Builder remain distinct products (different data model — presentation-config sections vs.
   App Schema pages/components — and no Customizer code is imported); only the *interaction shape*
   is reused, rebuilt fresh for App Builder's own data. See the UX Evidence Pass for the full
   external-evidence + internal-precedent breakdown.

## Approach chosen

- **Backend**: `AppBuilderRegistryController::index()` (new) serializes
  `ComponentRegistry::definitions()`/`ActionRegistry::definitions()` (APP-BUILDER-3) to JSON —
  plain array mapping, not an Eloquent `JsonResource` (the source objects are value objects, not
  models). Route `GET /app-builder/registries`, gated by the same `apps_builder.view` +
  `commerce.app_builder` middleware pair every other app-builder route already uses. Static
  platform metadata — no tenant scoping needed (identical for every tenant), unlike every other
  app-builder endpoint.
- **Canvas** (`web/src/modules/app-builder/canvas.tsx`): a recursive, framework-neutral renderer
  — one case per one of the 15 real component types, each reading `props`/`children` with the
  exact same defensive fallback semantics as `component_widgets.dart` (missing/wrong-typed prop →
  safe default, never a crash). Money values use `formatRiyal(amountMinor / 100)` (converts
  minor→major units, matches `DESIGN_SYSTEM.md`'s mandatory Saudi Riyal symbol rule — no
  hand-rolled currency formatting). Device-width framing reuses the exact preview-width constants
  already proven in `ExperienceBuilder.tsx` (`mobile: 390, tablet: 768, desktop: 1280`).
- **Layers tree** (`web/src/modules/app-builder/layers-tree.tsx`): a real `role="tree"`/
  `"treeitem"` structure, `aria-selected`, keyboard-activatable (Enter/Space) — no collapse/expand
  (today's real schemas are trivially small per `minimalSafeSchema()`; adding that complexity now
  would be premature, per this repo's "no unnecessary abstraction" principle).
- **Inspector** (`web/src/modules/app-builder/inspector.tsx`): looks up the selected node's type in
  the fetched registries, renders its prop list (key/type/required/current-value) and, if
  actionable, its attached action's typed param list — **read-only display**, zero `<input>`.
- **Workspace page** (`/app-builder/[id]/builder`): loads app + draft + registries in parallel,
  defaults selection to `navigation.initialPageId`'s root; header has back/name/Saved badge/
  locale toggle/device toggle; body is three fixed-width panes on `lg`+, collapsing to a
  canvas-primary + switchable structure/inspector bottom panel below `lg` (the responsive admin
  baseline Quality Gate D requires). The page cancels `(app)/layout.tsx`'s content padding
  (`-m-4 sm:-m-6`) so the workspace reaches the shell's edges, using a fixed `80vh`/`min-h-[560px]`
  height rather than a `100vh` calc — this route stays inside the standard sidebar/topbar layout
  (unlike the Customizer's own chrome-less `(commerce)` route group), so a precise viewport
  calculation would double-count that chrome.
- **Overview page updated**: `/app-builder/[id]`'s former "coming in a later task" placeholder is
  replaced with a real primary action ("Open the builder") linking to the new route — the
  honesty principle this replaces ("never a dead link to a screen that doesn't exist") is
  satisfied precisely because the screen now exists.

## Why this approach fits AWJ

AB-05 (metadata-driven Inspector) and AB-11 (framework-aware only at the runtime boundary) are
both directly satisfied: the Inspector's entire content comes from `ComponentRegistry`/
`ActionRegistry`, and the canvas never claims to be a literal Flutter render. Quality Gate D's
"dense, professional AWJ workspace... keyboard/mouse desktop path... responsive/mobile management
path... accessible controls/labels/focus... clear Draft/Saved/Validation/Published state" is
satisfied structurally now (the shell), with editing depth explicitly deferred to task 6 rather
than half-built here.

## Changed files

- New (backend): `app/Http/Controllers/Api/AppBuilderRegistryController.php`
- Modified (backend): `routes/api.php` (new route + `use` import)
- New tests (backend): `tests/Feature/AppBuilderRegistryTest.php` (4 tests)
- New (frontend): `web/src/modules/app-builder/canvas.tsx`, `layers-tree.tsx`, `inspector.tsx`;
  `web/src/app/(app)/app-builder/[id]/builder/page.tsx` + `page.test.tsx` (3 tests);
  `docs/plans/app-builder/APP-BUILDER-5-UX-EVIDENCE-PASS.md`
- Modified (frontend): `web/src/lib/app-builder.ts` (App Schema + registry types,
  `findComponentById`), `web/src/app/(app)/app-builder/[id]/page.tsx` (placeholder → real "Open
  the builder" action) + its test, `web/src/messages/ar.json`/`en.json` (new `appBuilder.builder`
  namespace; removed the now-dead `builderComingSoon*` keys; added `appBuilder.openBuilder`).

## Tests and exact results

- `php artisan test --filter=AppBuilderRegistryTest` → **4/4 passed** (SQLite, local): full
  identifier-set parity with `RuntimeCapabilities`, a component definition's typed props/children
  rule, an action definition's typed params/dispatch status, RBAC denial for `staff` without the
  permission.
- `php artisan test --filter="BuilderAppTest|AppSchemaParserTest|CompatibilityResolverTest|ComponentRegistryTest|ActionRegistryTest|DataResourceRegistryTest|AppBuilderRegistryTest|BranchIsolationGuardTest|ApplicationCatalogTest|TenantApplicationTest"`
  → **93/93 passed** (515 assertions) — confirms zero regression to tenant/RBAC/ApplicationCatalog
  or any prior App Builder task.
- `npx vitest run src/app/(app)/app-builder` → **14/14 passed** (4 test files: list, new,
  overview, workspace). Two real test-authoring issues found and fixed during this task (both
  confirmed test-only, not production bugs): (1) the workspace test's initial "wait for load"
  anchor used the app's English name, which never renders because `previewLocale` defaults to
  `'ar'` — fixed by anchoring on a locale-independent schema value (the Section's `title` prop)
  instead; (2) a `Promise.all([...])`-of-three-calls test that rejected all three uniformly via
  `mockRejectedValue` produced two additional "unhandled rejection" promise objects that
  `Promise.all` itself never awaits individually — Vitest reported this as a spurious failure even
  though the page's own `.catch()` correctly handles the aggregate rejection; fixed by rejecting
  only the first call and resolving the rest, a pattern novel to this task since no prior
  `Promise.all`-based test in this codebase combines three concurrent calls with a uniform-
  rejection assertion.
- `npm run build` → succeeds, zero errors; all four App Builder routes
  (`/app-builder`, `/app-builder/new`, `/app-builder/[id]`, `/app-builder/[id]/builder`) compile
  and appear in the route manifest.
- `npx vitest run src/lib/__tests__/date-formatting-guardrail.test.ts` → still passes (this task's
  new files use no raw `Date#toLocale*String`, learned from APP-BUILDER-4's own CI-red fix).

## CI

Pending — will be recorded once GitHub Actions (`ci.yml` + `web-ci.yml`, this PR touches both
`app/`/`routes/`/`tests/` and `web/`) run on this PR's head is observed, per the truthfulness rule.

## Pre-merge review

Pending — to be completed after CI is confirmed green on the exact reviewed head.

## Self-review

### Implementer

Satisfied the actual outcome (a real, working, read-only workspace shell — not a mockup) using
the AWJ Design System's existing components/tokens exclusively, with the honesty discipline
APP-BUILDER-4 already established (no capability implied that doesn't exist yet: no editable
Inspector field, no drag handle, no add/remove control).

### Reviewer

- No code broader than the task: no property editing, no add/remove/reorder, no undo/redo, no
  drag/direct manipulation — all explicitly APP-BUILDER-6. No theme editing (APP-BUILDER-8), no
  template browsing (APP-BUILDER-9), no publish flow beyond what APP-BUILDER-4 already built.
- UI/UX Evidence Pass completed and documented **before** implementation, with its own external
  evidence (Oracle Visual Builder/Page Designer docs, Sitecore Page Builder docs) *and* explicit
  internal precedent (`ExperienceBuilder.tsx`) distinguished from each other truthfully, per
  Quality Gate D's "External Evidence / AWJ UX Decision / Open Decision are separated truthfully."
- Found and fixed two real test-authoring bugs via this task's own test runs before any external
  review, both confirmed test-only through direct evidence (not guessed) before being written off
  as non-production issues.

### AWJ Guardian

- **No business authority claimed client-side**: the workspace only reads (`GET`) — no draft
  mutation endpoint is called from this task's code; `BuilderDraftExperienceController::update()`
  (APP-BUILDER-1) remains untouched and unused until APP-BUILDER-6 needs it.
- **No fabricated capability**: the canvas/layers/Inspector are visibly read-only (no input
  fields, no drag affordances) — a merchant cannot be misled into thinking they can edit yet.
- **RTL/LTR**: the workspace's own chrome is `dir="rtl"` (matches this repo's Arabic-first
  default); the canvas's preview frame independently sets its own `dir` from the `previewLocale`
  toggle, so a merchant can preview LTR content without flipping the whole admin UI.
- **Accessibility**: layer-tree nodes are real `treeitem`s (keyboard Enter/Space-activatable,
  `aria-selected`); canvas nodes are real, focusable, `Enter`/`Space`-activatable buttons with a
  visible type-tag badge on selection — not a bare `onClick` div with no semantics.
- **No tenant/RBAC/ApplicationCatalog/migration change beyond the new registry route**: that
  route reuses the exact existing `apps_builder.view`/`commerce.app_builder` gate pair; no new
  permission, no new catalog key, no migration.

## Accounting impact

**None.** No journal entries, no monetary field mutated, no `LedgerService` call site. The
canvas's `formatRiyal(amountMinor / 100)` calls are read-only display formatting of values already
present in the schema (authored in a future task) or fixture data — never a computed total.

## Tenant / branch isolation impact

None — no model/migration changed. The new registry endpoint is deliberately *not*
tenant-scoped (static platform metadata identical for every tenant, matching how
`RuntimeCapabilities` itself has never been tenant-scoped since APP-BUILDER-2).

## Security / authorization impact

None beyond reusing the existing `apps_builder.view` + `commerce.app_builder` gate on the one new
route. No new permission, no new route accepting mutation.

## Backward compatibility

Fully additive on the backend (new controller, new route). On the frontend, one existing page
(`/app-builder/[id]`) had its placeholder note replaced with a real action — not a behavior
regression, the explicit intended outcome of this task landing.

## API / DB / migration impact

One new read-only route (`GET /app-builder/registries`). No migration, no existing route/request/
response shape changed.

## External research used

`docs/plans/app-builder/APP-BUILDER-5-UX-EVIDENCE-PASS.md` records the external interaction
evidence (Oracle Visual Builder/Page Designer Property Inspector docs, Sitecore Page Builder
interface docs) and internal precedent (`ExperienceBuilder.tsx`), with retained/rejected patterns
and an explicit AWJ UX Decision, per Gate 1/the bootstrap's UI/UX workflow requirement.

## Risks / remaining work

- The canvas's 15 component renderers are visual **approximations**, not pixel-accurate previews
  of the actual Flutter runtime — by design (AB-11), but worth flagging so a future task doesn't
  mistake canvas fidelity for a Flutter-parity requirement.
- Layer-tree collapse/expand, canvas-direct multi-select, and keyboard arrow-navigation within the
  tree are not built — today's real schemas are trivially small, and building that complexity
  before real authored content exists (task 6+) would be premature per this repo's own
  anti-abstraction principle. Flagged here so it isn't silently forgotten if trees grow.
- The responsive mobile baseline uses a fixed `38vh` bottom panel height rather than a
  drag-resizable sheet — a reasonable V1 shell choice, not treated as a finished mobile authoring
  experience (task 6 may need to revisit given real editing controls' space requirements).

## Discovered backlog

None new.

## Git state

- Branch: `claude/awj-app-builder-horizon-v1-e4iy21`
- PR: pending (to be opened after this report is committed)
- Base SHA: `ca20ae4023b8548c59e3003d89816dde95f8f5d0`

## Recommended next dependency-ready task

`APP-BUILDER-6` — Visual editing + history (select/add/remove/reorder, property edits, bounded
drag/direct manipulation, undo/redo, dirty/save semantics) — builds directly on this task's
Inspector (turning its read-only rows into editable fields) and canvas (turning selection into
manipulation). Whether this slice needs its own UI/UX Evidence Pass is a scope question for that
task, not pre-answered here (see this task's Evidence Pass "What this pass does not cover").
