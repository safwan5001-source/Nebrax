# APP-BUILDER-6 — Implementation Report

STATUS: merged — post-merge review PASS
DATE: 2026-09-24

## Outcome

Turned APP-BUILDER-5's read-only Builder workspace shell into a real editor: select/add/remove/
reorder, inline typed property and action-param editing, a bounded undo/redo history, and explicit
Draft/Unsaved/Saving/Saved state with a Save action — per the horizon's task 6 line
("select/add/remove/reorder, property edits, bounded drag/direct manipulation, undo/redo,
dirty/save semantics"). A focused `APP-BUILDER-6-UX-EVIDENCE-PASS.md` was written and completed
**before** implementation, per the horizon bootstrap's mandatory workflow — this task was judged to
need its own pass (an open question APP-BUILDER-5's own evidence pass explicitly left for this
task to answer) since it introduces the workspace's first destructive/undoable actions and its
first form inputs, a materially different interaction problem than APP-BUILDER-5's read-only shell.

Pure frontend — **zero backend files touched**. `PUT /app-builder/apps/{id}/draft` (built in
APP-BUILDER-1, validated via `BuilderDraftExperienceService::save()` → `AppSchemaParser::validate()`)
already existed and needed no change; this task is entirely a client of that existing contract.

## What changed

- **`web/src/lib/app-builder.ts`** — new pure, immutable tree-edit helpers: `findParentId`,
  `updateComponentById`, `addChildComponent`, `removeComponentById`, `reorderChildren`,
  `moveSibling`, `generateComponentId`, `createComponentFromDefinition`. None mutate their input;
  each returns a new root, keeping the page's undo/redo stack a plain array of past `AppSchema`
  snapshots.
- **`web/src/modules/app-builder/inspector.tsx`** — rewritten from read-only display rows to
  inline editable fields, one control per registry `PropType`/action-param type: `string`→text
  input (`Textarea` for `text`/`description` keys specifically), `assetUrl`→URL-hinted text input,
  `integer`→number input (honoring `min_value` on action params), `amountMinor`→a Riyal-denominated
  number input converted to/from minor units at the edit boundary (`Math.round(major * 100)`,
  matching `products/[id]/page.tsx`'s existing convention), `stringList`→a minimal add/remove row
  list. A prop's `enum_values` (`Text.style`, `Button.style`) always renders as a `<Select>` of
  exactly those values, never free text. Gained: an action-type `<Select>` (attach/detach/change,
  re-seeding params from registry defaults on type change), Add-child (only when
  `children_rule.kind === 'unboundedAny'`, seeded from registry prop defaults via
  `createComponentFromDefinition`), and Remove-component. A component's own
  `injected_runtime_action_params` (today only `Quantity`'s `quantity`) are filtered out of the
  editable action-param list — the schema author never sets that key, the runtime injects it live.
  Kept (fixed a real regression found during self-review, see below): the "action type not
  recognized by the registry" fallback message APP-BUILDER-5 already had.
- **`web/src/modules/app-builder/layers-tree.tsx`** — reorder added: a drag handle
  (`@dnd-kit/core`/`@dnd-kit/sortable`/`@dnd-kit/utilities`, already a dependency — reused
  verbatim from `web/src/components/settings/section-designer.tsx`'s existing pattern, no new
  package) plus up/down buttons, both **bounded to the same parent's children only** — no
  cross-parent drag, matching the horizon's "bounded drag" wording literally and the evidence
  pass's explicit rejection of free-form canvas drop targets.
- **`web/src/app/(app)/app-builder/[id]/builder/page.tsx`** — owns the live editable `schema`
  state (separate from nothing else — APP-BUILDER-5 read `draft.schema` directly; this task
  promotes it to its own `useState`), a bounded (50-entry) undo/redo stack held in refs (mutated
  synchronously in real event handlers, never inside a `setState` updater function — see the
  Strict-Mode hazard note below), `dirty`/`saving` state, `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`
  keyboard shortcuts (ignored while focus is in an input/textarea/select), a `beforeunload` guard
  while dirty, and an explicit Save button calling the existing `PUT .../draft` endpoint. Header
  gained Undo/Redo icon buttons (disabled when their stack is empty) and a state-driven badge
  (`Saved` / `Unsaved changes` / `Saving…`) replacing APP-BUILDER-5's static `Saved` badge.
- **`web/src/messages/ar.json` / `en.json`** — new keys under `appBuilder.builder`:
  `unsavedBadge`, `savingBadge`, `saveSuccessTitle`, `saveErrorTitle`, `undoLabel`, `redoLabel`,
  `moveUpLabel`, `moveDownLabel`, `dragLabel`, `injectedParamNote`, `addChildTitle`,
  `addChildPlaceholder`, `addChildAction`, `removeComponent`. `noAction`'s text was shortened
  (`"No action attached."` → `"No action"` / `"لا يوجد إجراء مرفق."` → `"بلا إجراء"`) since the
  same key is now also a `<select>` option label, where the longer sentence doesn't fit.

## A real bug caught during self-review (before any external review)

While reviewing the Inspector rewrite against APP-BUILDER-5's original behavior, found that the
"action type not recognized by the registry" fallback (shown when `node.action` exists but its
`type` isn't in `ActionRegistry` — e.g. a schema edited outside the Builder, or a future registry
drift) had been silently dropped in the rewrite: the new action-editing block only rendered when
`node.action && actionDefinition` both held, with no `else` branch. Fixed by restoring the
`inspectorUnknownType` message for `node.action && !actionDefinition`, matching the defensiveness
APP-BUILDER-5 already established.

## A React Strict-Mode hazard avoided by design, not caught by a failure

The undo/redo stacks are held in `useRef` (not `useState`) and mutated as a side effect of an
edit. The **first draft** of `applyPageEdit`/`undo`/`redo` mutated these refs *inside* the
`setSchema((current) => ...)` updater-function form — a real risk, since React 18 Strict Mode
intentionally double-invokes updater functions in development to surface exactly this class of bug,
which would have silently corrupted the history stack (duplicate pushes) the first time a
developer ran this page locally in dev mode. Caught and fixed before writing any test, by
refactoring all three functions to read `schema` from the closure directly and call `setSchema`/
`setDirty` with plain values (not updater functions) — refs are now mutated once, synchronously, in
the same event-handler tick that calls the (single-invocation) state setters.

## Tests and exact results

- `npx vitest run src/lib/app-builder.test.ts` → **17/17 passed** — new unit tests for every tree
  helper (nested update/no-op-on-missing-id, append/create-children-array, remove top-level/nested,
  reorder/drop-unknown-id, move-up/down/boundary-no-op, id-generation uniqueness, prop-seeding
  from registry defaults including the null-default-omitted case).
- `npx vitest run "src/app/(app)/app-builder/[id]/builder/page.test.tsx"` → **9/9 passed** (was
  3/3 from APP-BUILDER-5): the 3 original read-only-shell tests still pass unchanged, plus 6 new —
  editing a text prop (updates canvas, marks unsaved), removing the selected component (drops it,
  selects its actual parent via `findParentId` — not always the page root), adding a child to a
  container (selects the new node, marks unsaved), undo/redo round-trip, the move-down button
  reordering siblings bounded to their shared parent, and saving (calls the existing `PUT` draft
  endpoint, clears the unsaved badge, calls the success toast).
- `npx vitest run` (full frontend suite) → **2037/2037 passed** (295 files) — zero regressions
  anywhere else in the codebase.
- `npm run build` → succeeds; `/app-builder/[id]/builder` present in the route manifest (10.6 kB,
  up from 7.11 kB — the added editing UI, `@dnd-kit` already shared-chunked elsewhere).
- `php artisan test` (full backend suite, no filter) — run despite zero backend files touched, per
  the mandatory pre-commit protocol: **4630 passed / 35 failed / 49 skipped**. All 35 failures are
  the same pre-existing local-environment-only set documented in every prior App Builder task's
  report (missing `bcmath` extension, `setup.sh`'s `app/Mail` copy gap); the previously-seen
  EC-keypair-generation flake (`ZatcaQrCertificateMaterialExtractorTest`) did not reproduce this
  run, consistent with it being an unseeded-random flake, not a real failure. `diff -rq` against
  the built Laravel project's `app/` confirmed zero source drift beyond that known gap before this
  run — no backend regression is possible from a diff this task never touched.

## Accounting impact

**None.** This task adds no route, no model, no migration, no journal-affecting operation — a
pure frontend editor against an already-existing, already-validated persistence endpoint.

## CI

**PASS.** PR #979, head `15af3b1382b68f2a1d151a6439652bda1efd8a34`. All 6 required checks green:
`ci.yml` (`php artisan test (L11, sqlite)` and `(L11, pgsql)`, both `success`) and `web-ci.yml`
(`web build (Next.js)`, `success`). `mergeable_state: clean`, no open review threads (one bot
comment from `chatgpt-codex-connector[bot]` reporting it had hit its own usage limit and performed
no review — not actionable).

## Pre-merge review

**PASS.** `PRE_MERGE_REVIEW: PASS` — CI green on the exact reviewed head (`15af3b1`), no merge
conflict, no open review comments/threads requiring action, self-review (below) complete.

## Post-merge review

**PASS.** PR #979 merged via squash: Merge SHA `08c143b614be7f2b303528a17a13e862c08b6261`.
Confirmed `main@08c143b` was `origin/main`'s tip at merge time, a single-parent squash (parent
`84d528a`, the pre-merge tip), zero content drift from the reviewed head (`git diff 15af3b1
origin/main -- app database routes tests docs/plans/app-builder web` empty). Post-merge CI on the
merge commit itself: `ci.yml` run
[35959372930](https://github.com/safwan5001-source/Nebrax/actions/runs/35959372930) (sqlite/pgsql
both `success`) and `web-ci.yml` run
[35959372931](https://github.com/safwan5001-source/Nebrax/actions/runs/35959372931) (`web build
(Next.js)`, `success`) — both green. `POST_MERGE_REVIEW: PASS`.

## Self-review

### Implementer

Built a real, working editor — not a mockup: every affordance (add/remove/reorder/edit/undo/redo/
save) is backed by a real state transition and, for save, a real network call to an
already-existing, already-tested endpoint. No capability implied that doesn't exist: the canvas
still does not support free-form drag-and-drop (explicitly rejected in the evidence pass), and
Conditions/Visibility/Data/Actions-in-Develop-mode remain untouched (APP-BUILDER-7).

### Reviewer

- No code broader than the task: no theme editing (APP-BUILDER-8), no template browsing
  (APP-BUILDER-9), no publish/validate/version/rollback UI (APP-BUILDER-10). No backend contract
  change — `PUT .../draft`'s existing shape (`{ schema }` in, full draft resource out) was reused
  exactly as built in APP-BUILDER-1.
- No restriction invented beyond registry evidence: which component types may be added under which
  parent is bounded only by `children_rule.kind` (`none`/`unboundedAny`), exactly as
  `AppSchemaParser`/`ComponentRegistry` already define — no parent→allowed-children matrix was
  invented (verified: none exists in either file).
- Caught and fixed one real regression (the dropped unknown-action-type fallback) and one real
  correctness hazard (the Strict-Mode-unsafe ref mutation inside a `setState` updater) before any
  external review, both documented above with direct evidence, not guessed.
- UI/UX Evidence Pass completed and documented **before** implementation, external evidence (Figma/
  Webflow/WordPress/Notion patterns) separated truthfully from the one *internal* precedent reused
  verbatim (`section-designer.tsx`'s `@dnd-kit` pattern), per Quality Gate D.

### AWJ Guardian

- Tenant/RBAC/branch isolation: untouched — no new route, no new permission, no new model.
- App Schema stays declarative/untrusted configuration: every edit still produces plain JSON
  (`AppSchemaComponent`/`AppSchemaActionRef` — string/number/array/object values only) validated
  server-side by the same `AppSchemaParser::validate()` the draft endpoint already called before
  this task; no new code path bypasses it, and the client-side editor cannot itself decide a
  malformed schema is acceptable — the existing server validation is still the source of truth at
  save time.
- No commerce/accounting/payment semantics touched. No production deploy/release. No App Factory/
  signing/store-submission surface touched.
- Publish/compatibility (`CompatibilityResolver`) remains untouched and still runs only at publish
  time (APP-BUILDER-10) — a draft this task can now produce (e.g. an `assetUrl` prop left at a
  non-`https://` value, or a component type the runtime doesn't yet support) is structurally valid
  JSON today and will correctly fail closed at publish time later, exactly as designed since
  APP-BUILDER-2. This task does not need to anticipate publish-time validation — that boundary is
  deliberate, not a gap.

## What this task does not cover

Conditions/Visibility, Data binding, Develop mode (APP-BUILDER-7); theme editing/Use My Store
Design (APP-BUILDER-8); template browsing/multi-page navigation management (APP-BUILDER-9);
validate/publish/version/rollback (APP-BUILDER-10). Free-form pixel drag-and-drop onto the canvas,
multi-select/bulk edit, and concurrent-edit conflict resolution were evaluated and explicitly
rejected for this task in `APP-BUILDER-6-UX-EVIDENCE-PASS.md`, not silently dropped.
