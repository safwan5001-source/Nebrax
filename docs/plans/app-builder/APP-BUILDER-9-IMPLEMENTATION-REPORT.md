# APP-BUILDER-9 — Implementation Report

STATUS: pre-merge review
DATE: 2026-09-24

## Outcome

Delivers "Templates + navigation/pages" (horizon doc task 9: "same schema/runtime; safe system
page constraints and minimum shell"). Three concrete pieces, each grounded directly in the real,
accepted contract rather than the architecture doc's aspirational Develop-mode description:

1. **Pages management** in the Builder workspace's existing Pages tab: Add page, Remove page, and
   "Set as home" — new client-side helpers over `schema.pages`/`navigation.initialPageId`, both
   already-real fields. Guardrails only mirror what `AppSchemaParser::validate()` already enforces
   server-side (never zero pages, never a dangling `initialPageId`) — never a new rule.
2. **A real page picker for the `navigate` action's `pageId` param** in the Inspector — the
   Inspector's generic action-param editor previously rendered every string param (this one
   included) as a free-text field, with no layer anywhere checking a `navigate` action's `pageId`
   against the schema's actual declared pages. Now, specifically for that one param, it renders as
   a `<Select>` of real page ids.
3. **A small curated template set** (2 templates: "Blank", "Catalog") selectable in
   `/app-builder/new`'s existing `template` creation path, replacing that path's honest placeholder
   ("the real template gallery is added in a later task" — this is that task). Each template is a
   complete, valid `AppSchema` built only from already-shipped component/action types, applied via
   a second call to the already-existing draft-save endpoint right after app creation.

A focused `APP-BUILDER-9-UX-EVIDENCE-PASS.md` was written and completed **before** implementation,
per the horizon bootstrap's mandatory workflow. Before that, a dependency check (recorded in
`docs/autonomous-engineering/TASK-QUEUE.md`, mirroring `APP-BUILDER-8`'s) confirmed this task
requires **no new App Schema contract** — unlike the still-deferred `APP-BUILDER-7`, every piece
above is representable in fields the parser and Dart schema already accept today.

Pure frontend — **zero backend files touched**. All three pieces are clients of endpoints that
already existed unchanged since `APP-BUILDER-1` (`PUT /app-builder/apps/{id}/draft`) and
`APP-BUILDER-4`/`APP-BUILDER-1` (`POST /app-builder/apps`).

## What changed

- **`web/src/lib/app-builder.ts`** — new pure, immutable page-map helpers, the `pages`-map analogue
  of `APP-BUILDER-6`'s component-tree helpers: `generatePageId()`, `addPage(schema, pageId)` (a new
  empty `{type:'Page', children:[]}` root), `removePage(schema, pageId)` (silent no-op if it is the
  last page or the current home page — never a guess at reassignment), `setInitialPage(schema,
  pageId)` (silent no-op if `pageId` isn't a declared page).
- **`web/src/app/(app)/app-builder/[id]/builder/page.tsx`** — Pages tab gains an "Add page" button
  and, per page row, a "Set as home" icon button (hidden for the current home page) and a "Remove"
  icon button (disabled when removal would be a no-op) — the same icon-button row-action language
  `LayersTree` already established in `APP-BUILDER-6`. New `applyPagesEdit` history/dirty helper
  (mirrors `applyThemeEdit`'s pattern, operating on the whole schema instead of one page's tree) and
  `addNewPage`/`deletePage`/`makeInitialPage` handlers. Removing the currently-selected page falls
  selection back to the (unchanged, since removing home itself is blocked) home page.
- **`web/src/modules/app-builder/inspector.tsx`** — `Inspector` gained a required `pageIds: string[]`
  prop, threaded down through `ActionParamRow`/`ActionParamField`. When rendering the `navigate`
  action's `pageId` param specifically, `ActionParamField` renders a `<Select>` of `pageIds` instead
  of the generic text `<Input>` every other string param still uses.
- **`web/src/modules/app-builder/templates.ts`** (new) — `APP_BUILDER_TEMPLATES`: "Blank" (one home
  page, a welcome `Section`/`Text`) and "Catalog" (a `ProductList` of `ProductCard`s plus a `Button`
  whose `navigate` action links to a second `cart` page containing `CartList`/`CartSummary`) — the
  Catalog template doubles as a live demonstration of the new real page-to-page navigation. All
  prices are explicit placeholder demo values (no product-data binding exists —
  `DataResourceRegistry` is still empty by `APP-BUILDER-3`'s own decision); the merchant edits them
  after applying the template, same as any other prop.
- **`web/src/app/(app)/app-builder/new/page.tsx`** — a new conditional `FormSection` (shown only
  when `source === 'template'`) renders `APP_BUILDER_TEMPLATES` as a card grid, mirroring the path
  selector's own card/radio visual language. Submit now validates a template is chosen before
  enabling Create when that path is active, and — only for the `template` source — makes a second
  `PUT .../draft` call right after `POST /app-builder/apps` succeeds, seeding the chosen template's
  schema. That seed call's own failure is swallowed (`.catch(() => undefined)`) and navigation
  proceeds regardless: the app was already created successfully at that point, so the same
  fail-into-a-safe-existing-state posture `APP-BUILDER-8`'s "Use My Store Design" already
  established applies here — never block navigation over a non-critical enhancement failing.
- **`web/src/messages/ar.json` / `en.json`** — new `appBuilder.builder.pages.*` keys (add/set-home/
  remove/picker-placeholder labels) and new `appBuilder.new.templateSectionTitle` /
  `templateRequired` / `templates.{blank,catalog}{Name,Description}` keys. Updated
  `storeDesignDescription`/`templateDescription` (previously "added in a later task" placeholders)
  to describe what's now actually real, without overclaiming: store-design sync still happens
  inside the Builder workspace (`APP-BUILDER-8`, already shipped), not at creation time — this
  task never changes that path's creation-time behavior, only its honest description.

## Tests and exact results

- `npx vitest run src/lib/app-builder.test.ts` → **28/28 passed** (was 21/21 — 7 new: `generatePageId`
  uniqueness; `addPage` adds without mutating the original; `removePage` removes a non-home page /
  no-ops on the home page / no-ops on the only page; `setInitialPage` sets a declared page / no-ops
  on an undeclared id).
- `npx vitest run "src/app/(app)/app-builder/[id]/builder/page.test.tsx"` → **18/18 passed** (was
  14/14 — 4 new: adding a page creates and selects a new empty page; the home page cannot be
  removed and removing another page works; setting a different page as home moves the removability
  guardrail with it; the `navigate` action's `pageId` param renders as a real-page picker).
- `npx vitest run "src/app/(app)/app-builder/new/page.test.tsx"` → **5/5 passed** (was 3/3 — 2 new:
  the template path requires picking a template before Create enables; creating from the Catalog
  template calls `POST /app-builder/apps` then `PUT .../draft` with the two-page seeded schema,
  then redirects).
- `npx vitest run` (full frontend suite) → **2060/2060 passed** (295 files) — zero regressions
  anywhere else in the codebase.
- Manual `ar.json`/`en.json` key-parity check → **0 missing in either direction**; the codebase's
  own `i18n-keys.test.ts` guard test is included in the full suite run above and passed.
- `npm run build` → succeeds, exit code 0, zero errors.
- `php artisan test` (full backend suite, no filter) — run despite zero backend files touched, per
  the mandatory pre-commit protocol: **4630 passed / 35 failed / 49 skipped** (29,187 assertions).
  All 35 failures are the same pre-existing local-environment-only set documented in every prior
  App Builder task's report (missing `bcmath` PHP extension breaking `Fuel*` services' fixed-point
  arithmetic; `setup.sh`'s `app/Mail` copy gap). `diff -rq` against the built Laravel project's
  `app/` confirmed the only differences are that same known gap plus Laravel's own unmodified
  scaffolding files (`Http/Controllers/Controller.php`, `Providers/AppServiceProvider.php`) — zero
  source drift from this task, which never touched a backend file.

## CI

**PASS.** PR #985 (this PR grew to carry both `APP-BUILDER-8`'s post-merge docs and the full
`APP-BUILDER-9` implementation — see its description for why), final head
`0312ad065b8854115d3352fe7b91747cf0d24c1e`. All 6 check runs green across both pushed commits:
`ci.yml` (`php artisan test (L11, sqlite)` and `(L11, pgsql)`, both `success`) and `web-ci.yml`
(`web build (Next.js)`, `success`). `mergeable_state: clean`, no open review threads (one bot
comment from `chatgpt-codex-connector[bot]` reporting it had hit its own usage limit and performed
no review — not actionable, same pattern as every prior App Builder PR).

## Pre-merge review

**PASS.** `PRE_MERGE_REVIEW: PASS` — CI green on the exact reviewed head (`0312ad0`), no merge
conflict, no open review comments/threads requiring action, self-review (below) complete.

## Accounting impact

**None.** This task adds no route, no model, no migration, no journal-affecting operation — a pure
frontend editor writing to already-existing, already-validated schema fields
(`PUT /app-builder/apps/{id}/draft`, unchanged since `APP-BUILDER-1`) and reusing
`POST /app-builder/apps` (unchanged since `APP-BUILDER-1`/`APP-BUILDER-4`) exactly as before.

## Self-review

### Implementer

Built three real, working features — not mockups: page add/remove/set-home each produce a real
schema change through the same undo/redo/dirty/save pipeline every other Builder edit uses; the
`navigate` picker reads the schema's actual `pages` keys, not a hardcoded list; templates are real,
complete, valid `AppSchema` documents applied through the real draft-save endpoint, not placeholder
JSON that would fail validation. No capability implied that doesn't exist: page rename was
explicitly evaluated and rejected for this task (see evidence pass) rather than half-built, and the
templates' commerce content is honestly static (no data binding exists yet).

### Reviewer

- No code broader than the task: no publish/validate/version/rollback UI (`APP-BUILDER-10`), no
  Data/Conditions/Visibility work (`APP-BUILDER-7`, still `decision_required`). The Inspector's
  Actions editing (`APP-BUILDER-6`) is extended by one param-specific render branch, never
  duplicated or rewritten.
- No new App Schema contract invented: `pages`/`navigation.initialPageId`/the `navigate` action's
  `pageId` param are all unchanged fields from the already-accepted, already-tested contract; the
  guardrails in `removePage`/`setInitialPage` only prevent states the server would already reject
  (verified directly against `AppSchemaParser::validate()`'s exact checks, cited in the evidence
  pass) — no new validation rule invented client- or server-side.
- Templates verified structurally valid against the real `ComponentRegistry.php` prop requirements
  for every component type used (`Page`, `Section`, `Text`, `ProductList`, `ProductCard`, `Button`,
  `CartList`, `CartSummary`) — every required prop is present, matching what
  `AppSchemaParser::validate()` and the real Mobile Runtime widgets expect, not just what compiles
  in TypeScript.
- The template-seeding call's failure-swallowing (`.catch(() => undefined)`) was a deliberate,
  documented choice, not a silently dropped error path: the alternative (blocking navigation after
  the app already exists) would strand the merchant on a form for a already-created app with no way
  back without navigating away manually — worse than landing on the app with its safe default shell
  instead of the chosen template.
- UI/UX Evidence Pass completed and documented **before** implementation; internal precedents
  (Warehouses/Branches "default" badge pattern, the wizard's own existing card/radio selector,
  `LayersTree`'s row-action icon-button language) cited with file references, external evidence
  (WordPress.com/Shopify curated template pickers) kept explicitly separate, per Quality Gate D.

### AWJ Guardian

- Tenant/RBAC/branch isolation: untouched — no new route, no new permission, no new model. Both
  endpoints this task calls (`POST /app-builder/apps`, `PUT .../draft`) were already gated
  identically before this task existed.
- App Schema stays declarative/untrusted configuration: every page-map edit and every seeded
  template still produces plain JSON validated server-side by the same `AppSchemaParser::validate()`
  the draft endpoint already called before this task; the client cannot itself decide a malformed
  page structure is acceptable — the existing server validation remains the source of truth at
  save time, for both hand-edited pages and template-seeded ones.
- Confirmed directly against `mobile/lib/schema/app_schema.dart` and `AppSchemaParser.php` (not
  from the architecture doc's aspirational Navigation panel description) that no route-graph,
  deep-link table, or tab-bar configuration concept was invented — `navigation` stays exactly
  `{initialPageId: string}`, unchanged.
