# APP-BUILDER-8 — Implementation Report

STATUS: merged — post-merge CI verification pending
DATE: 2026-09-24

## Outcome

Adds a **Theme** tab to the Builder workspace's structure panel, giving merchants direct control
over `schema.theme.tokens` — the App Schema's only theme concept (a flat, unconstrained
`Map<string, string>`, already structurally validated server-side, not yet consumed by any Mobile
Runtime widget or gated by any capability/compatibility check). Two ways to edit it: a manual panel
(preset swatches, custom hex color, radius/density/product-card-style pickers) through the same
undo/redo/dirty/save pipeline APP-BUILDER-6 built for component edits, and **"Use My Store
Design"** — a one-time **Detect → Diff → Preview → Apply** sync against the Store Customizer's
real, already-shipped presentation data. A focused `APP-BUILDER-8-UX-EVIDENCE-PASS.md` was written
and completed **before** implementation, per the horizon bootstrap's mandatory workflow — judged
necessary since this is the workspace's first cross-module integration (reading another product's
live data) and its first non-component-tree editing surface.

Pure frontend — **zero backend files touched**. Both endpoints "Use My Store Design" depends on
(`GET /commerce/workspace/storefronts`, `GET /commerce/workspace/storefronts/{id}/presentation`)
already existed, already `commerce.manage`-gated; this task is entirely a client of existing
contracts, mirroring APP-BUILDER-6's zero-backend-change precedent.

## The user's explicit constraints for this task, and how each was honored

This task followed directly from the owner's resolution of the APP-BUILDER-7 Decision Escalation
(deferring Data/Actions/Conditions/Visibility as `decision_required` — see `TASK-QUEUE.md`). The
owner's message set explicit boundaries for continuing to this task:

- **"Do not invent or implement Data Source Registry, expression/condition language, or
  merchant-authored visibility semantics now."** Honored: this task never reads `DataResourceRegistry`,
  never adds a condition/expression field to `AppSchemaComponent`, and never adds a
  visibility/show-hide concept. It edits only `schema.theme` — a structurally separate, already-open
  string map that required no new App Schema field.
- **"Do not duplicate Actions already completed in APP-BUILDER-6."** Honored: no action-editing code
  was touched; the Inspector (where Actions live) is untouched except for being swapped out, not
  replaced, when the Theme tab is active.
- **"Perform a narrow dependency check [before starting]."** Performed and recorded in
  `TASK-QUEUE.md` before implementation began: confirmed `theme.tokens` is structurally independent
  of `SchemaComponent`-level fields, so this task has zero real runtime/schema dependency on the
  deferred APP-BUILDER-7 concepts.
- **"Keep APP-BUILDER-7 explicitly deferred."** `TASK-QUEUE.md`'s `APP-BUILDER-7` row status remains
  `decision_required`, untouched by this task.

## What changed

- **`web/src/lib/app-builder.ts`** — `AppSchema.theme.tokens` narrowed from `Record<string, unknown>`
  to `Record<string, string>` (matching the real Mobile Runtime `ThemeTokens` contract). New pure
  helpers: `themeTokens(schema)` (empty object when unset) and `mergeThemeTokens(schema, patch)`
  (merges without dropping untouched keys) — the theme-editing analogue of APP-BUILDER-6's
  `updateComponentById` etc., but for the schema's `theme` field instead of its `pages` tree.
- **`web/src/modules/app-builder/theme-panel.tsx`** (new) — `ThemePanel` component. Preset swatches
  (5 AWJ presets, reusing `THEME_PRESETS`/`presentationCssVars` directly from the Store Customizer's
  own `presentation/tokens.ts` — the real, already-tested WCAG-contrast color-derivation function,
  not reimplemented), a native `<input type="color">` + hex text field, and `SegmentedField`
  (2–3-option button groups, the same `aria-pressed` pattern APP-BUILDER-5/6 already shipped for
  locale/device toggles) for radius/density/product-card-style. "Use My Store Design" section driven
  by a `SyncState` union (`idle → detecting → reviewing → applying`, with `choosingStore` when more
  than one storefront exists and `error` for a failed/forbidden read): `startDetect()` calls
  `loadCommerceStoreCatalog()`; a single store auto-proceeds, multiple stores show a picker;
  `detectFromStore(id)` calls `loadStorefrontPresentation(id)`, prefers the **published** config
  over the draft (a merchant syncing "my store design" means what's live, not an unpublished draft),
  maps it to token keys via `tokensFromPresentation()`, and enters `reviewing`; the diff table shows
  only keys whose proposed value differs from the current one; `applyReview()` merges the proposed
  tokens via the same `onChange` callback the manual panel uses, so **Undo reverts a sync exactly
  like it reverts any other edit**.
- **`web/src/modules/app-builder/canvas.tsx`** — `themeCssVars(tokens)` derives `--primary`/
  `--primary-foreground` from `tokens.primaryColor` (validated as a 6-digit hex) via the same
  `presentationCssVars` function, applied as inline `style` on the canvas's root wrapper.
  `AppBuilderCanvas` gained an optional `themeTokens` prop. Every existing `bg-primary`/
  `text-primary-foreground` class already resolves through `var(--primary)`/
  `var(--primary-foreground)` (`tailwind.config.ts`), so this is a one-place override, not a
  per-component rewrite. **Radius/density/product-card-style tokens are persisted, diffed, and
  synced but do not yet visually change the canvas** — `tailwind.config.ts`'s `borderRadius.DEFAULT`
  is a fixed value, not CSS-variable-driven; making every `rounded-*` class across the 15-component
  switch variable-driven is a materially larger, canvas-wide change outside this task's own
  initiative. Recorded as an explicit, scoped gap in the evidence pass and here — not silently
  dropped.
- **`web/src/app/(app)/app-builder/[id]/builder/page.tsx`** — the structure panel's top row gained a
  Pages/Theme toggle (`StructureMode`). Selecting "Theme" swaps the Inspector for `ThemePanel` and
  replaces the Pages/Layers content with a short description (the Layers tree is not shown while on
  the Theme tab — there is nothing page/component-scoped to browse there). `applyThemeEdit` mirrors
  `applyPageEdit`'s history/dirty pattern exactly, calling `mergeThemeTokens` instead of a tree
  helper. Selecting a component — from the Layers tree **or the canvas** — now always returns to
  the Pages tab and the per-component Inspector via a new `selectComponent(id)` wrapper, so a
  selection made while looking at the Theme tab is never silently hidden behind it.
  `previewThemeTokens` (set by `ThemePanel`'s `onPreview` during a pending "Use My Store Design"
  review) is passed to the canvas in place of the schema's committed tokens, so Preview is a real,
  temporary visual state, not just a diff table; it clears automatically when leaving the Theme tab.
- **`web/src/messages/ar.json` / `en.json`** — new `appBuilder.builder.theme` namespace: tab
  label/description, preset names, field labels, radius/density/product-card option labels, and a
  `sync.*` block for the Detect/Diff/Preview/Apply flow's copy.

## A real bug caught during self-review (before any external review)

`theme.sync.title` (a static heading above the "Use My Store Design" button) and `theme.sync.action`
(the button's own label) were both translated to the identical string "Use my store design" in both
`ar.json` and `en.json`. Not a functional bug in the shipped UI — a sighted user reads the heading
and the button as two adjacent, differently-styled pieces of text and is not confused — but it broke
this task's own test suite: `screen.findAllByText('Use my store design')` matched the static
heading first (DOM order), so a test's destructured `detectButton` was actually bound to the
non-interactive `<p>`, and clicking it did nothing, leaving the sync state stuck at `idle` forever.
Diagnosed via a temporary `console.log(document.body.innerHTML)` after the click, which showed the
idle button still present instead of the "detecting"/diff state the test expected. Fixed by renaming
`theme.sync.title` to "Store design sync" / "مزامنة تصميم المتجر" — a small copy change that also
makes the heading a real English/Arabic distinct label, not a workaround limited to the test.

## Tests and exact results

- `npx vitest run src/lib/app-builder.test.ts` → **21/21 passed** (was 17/17 — 4 new: `themeTokens`
  returns `{}` when unset / returns the existing map; `mergeThemeTokens` adds tokens to a themeless
  schema / merges without dropping untouched keys).
- `npx vitest run "src/app/(app)/app-builder/[id]/builder/page.test.tsx"` → **14/14 passed** (was
  9/9 — 5 new: preset selection marks the draft dirty and seeds the hex field; switching
  Pages → Theme → back to Pages (via clicking a component's type tag on the **canvas**, since the
  Pages tree is not rendered while on the Theme tab) shows the Inspector, not the Theme panel;
  single-store detect → diff → Apply (asserts the **published** presentation, not the draft, wins,
  and that the diff table clears after Apply); a store picker appears when more than one storefront
  is detected; a forbidden presentation read shows a clear message, not a crash).
- `npx vitest run` (full frontend suite) → **2046/2046 passed** (295 files) — zero regressions
  anywhere else in the codebase.
- Manual `ar.json`/`en.json` key-parity check (every leaf key present in both files) → **0 missing
  in either direction**; the codebase's own `i18n-keys.test.ts` guard test is included in the full
  suite run above and passed.
- `npm run build` → succeeds, zero errors.
- `php artisan test` (full backend suite, no filter) — run despite zero backend files touched, per
  the mandatory pre-commit protocol: **4630 passed / 35 failed / 49 skipped** (29,187 assertions).
  All 35 failures are the same pre-existing local-environment-only set documented in every prior App
  Builder task's report (missing `bcmath` PHP extension breaking `Fuel*` services' fixed-point
  arithmetic; `setup.sh`'s `app/Mail` copy gap). `diff -rq` against the built Laravel project's
  `app/` confirmed the only differences are that same known gap plus Laravel's own unmodified
  scaffolding files (`Http/Controllers/Controller.php`, `Providers/AppServiceProvider.php`) — zero
  source drift from this task, which never touched a backend file.

## CI

**PASS.** PR #983, final head `4c28197c2ee77e0192544dcf6406b1cfa252b9a1`. All 5 required checks
green: `ci.yml` (`php artisan test (L11, sqlite)` and `(L11, pgsql)`, both `success`) and
`web-ci.yml` (`web build (Next.js)`, `success`). `mergeable_state: clean`, no open review threads
(one bot comment from `chatgpt-codex-connector[bot]` reporting it had hit its own usage limit and
performed no review — not actionable, same pattern as every prior App Builder PR).

## Pre-merge review

**PASS.** `PRE_MERGE_REVIEW: PASS` — CI green on the exact reviewed head (`4c28197`), no merge
conflict, no open review comments/threads requiring action, self-review (below) complete.

## Post-merge review

PR #983 merged via squash: Merge SHA `1248223dd1668ad840f2b39f21e3de5a6d86755b`. Confirmed
`main@1248223` was `origin/main`'s tip at merge time, a single-parent squash (parent
`a322d1c21c663c804dd258eddde96cf523a4a268`, the pre-merge tip), zero content drift from the
reviewed head (`diff` of `git diff a322d1c 4c28197 -- app database routes tests
docs/plans/app-builder web` against the equivalent diff onto the merge commit — identical).
Post-merge CI on the merge commit itself was still running as of this write: `ci.yml` run
[35968746817](https://github.com/safwan5001-source/Nebrax/actions/runs/35968746817) and `web-ci.yml`
run [35968746879](https://github.com/safwan5001-source/Nebrax/actions/runs/35968746879) — both
in progress, neither red. **`POST_MERGE_REVIEW` to be confirmed and recorded in a follow-up
docs-only commit once both runs complete**, per this horizon's established pattern of not pushing
further to an already-merged PR's now-closed branch.

## Accounting impact

**None.** This task adds no route, no model, no migration, no journal-affecting operation — a pure
frontend editor writing to an already-existing, already-validated schema field
(`PUT /app-builder/apps/{id}/draft`, unchanged since APP-BUILDER-1) plus two already-existing,
already-permission-gated read-only Store Customizer endpoints.

## Self-review

### Implementer

Built a real, working feature — not a mockup: every affordance (manual token edit, preset select,
detect/diff/preview/apply) is backed by a real state transition, and Apply produces the identical
draft-schema write path every other Builder edit already uses. No capability implied that doesn't
exist: the canvas explicitly does not yet reflect radius/density/product-card tokens visually, and
this gap is documented in three places (evidence pass, implementation report, code comment) rather
than glossed over.

### Reviewer

- No code broader than the task: no template/navigation work (APP-BUILDER-9), no publish/validate/
  version/rollback UI (APP-BUILDER-10), no Data/Actions/Conditions/Visibility work
  (APP-BUILDER-7, still deferred). Actions editing (the Inspector) is swapped out when the Theme tab
  is active, never modified.
- No new App Schema contract invented: `theme.tokens`'s shape (`Record<string, string>`) is
  unchanged from what `AppSchemaParser::validateTheme()` already accepts; the token *keys* chosen
  (`primaryColor`, `radius`, `density`, `productCardStyle`, `themePreset`, `fontPreset`,
  `accentColor`, `displayName`) are a naming decision inside an already-open, already-unconstrained
  string map — not a new field, not a new validation rule, not a Data Source Registry, not an
  expression/condition language, not a visibility concept. This is the exact distinction the
  evidence pass draws against APP-BUILDER-7's blocked work, and it holds under review.
  Explicitly imports pure utility functions/types from the Store Customizer's
  `presentation/tokens.ts` (`THEME_PRESETS`, `presentationCssVars`, `isSafeHexColor`, etc.) — a
  deliberate, evidence-justified exception to the "Store Customizer ≠ App Builder, no Customizer
  code inherited automatically" boundary APP-BUILDER-5's report first stated: that boundary is about
  not *mechanically copying Customizer's UI/UX* (the AWJ UX Decision rebuilds the actual controls in
  AWJ Design System tokens, per the evidence pass), not about refusing to reuse a correct, tested
  color-math utility for a feature — "Use My Store Design" — whose entire purpose, per the
  architecture doc's own §6, is reading Store Customizer's real data honestly rather than
  reinventing WCAG contrast math badly.
- "Use My Store Design" reads the **published** presentation config, falling back to the draft only
  if nothing is published yet — deliberate: a merchant asking to sync "my store design" means what
  customers currently see, not a work-in-progress the merchant may not intend to ship yet.
- Fails closed, not open: a `commerce.manage`-forbidden read shows a clear, translated error, never
  a silent no-op or an empty state indistinguishable from "no store exists."
- UI/UX Evidence Pass completed and documented **before** implementation; external evidence
  (WordPress.com/Shopify's copy-then-review patterns) kept explicitly separate from the *internal*
  precedents actually reused (Store Customizer's own `ThemePanel`/`Segmented` controls, Product
  Import's stepper as the closest — imperfect — Detect/Diff/Preview/Apply precedent), per Quality
  Gate D.

### AWJ Guardian

- Tenant/RBAC/branch isolation: untouched — no new route, no new permission, no new model. The two
  endpoints this task reads were already gated by `commerce.manage` before this task existed.
- App Schema stays declarative/untrusted configuration: `theme.tokens` is still plain
  string-to-string JSON, still validated server-side by `AppSchemaParser::validate()` at save time —
  no new client-side trust boundary, no bypass of existing validation.
- Verified directly against the accepted architecture doc (`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`
  §6) that "Use My Store Design" implements exactly the doc's own named preferred default ("Review
  Changes" mode) and does not implement the two modes the doc leaves undecided ("Linked" continuous
  sync, full override/provenance tracking) — both would require a new persisted schema field this
  task does not add.
- Confirmed the owner's constraints from the APP-BUILDER-7 resolution message were honored line by
  line (see the dedicated section above) — no Data Source Registry, no expression/condition
  language, no visibility semantics, no Actions duplication, APP-BUILDER-7 left explicitly
  `decision_required` in `TASK-QUEUE.md`.
