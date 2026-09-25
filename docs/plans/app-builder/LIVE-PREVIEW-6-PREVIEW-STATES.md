# LIVE-PREVIEW-6 — Draft / Default / Published Preview States

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
PREDECESSOR: LIVE-PREVIEW-5 — DONE / PASS (`LIVE-PREVIEW-5-PREPUBLISH-VALIDATION.md`)
SCOPE: "Make Draft, Default AWJ Experience, and Published Preview states unambiguous. Never
imply that a Draft is an actual production/mobile release. Build any missing in-scope
state-selection or presentation wiring required to satisfy the task."

## The gap (established by LIVE-PREVIEW-1 §7, closed here)

Before this task, `AppBuilderWorkspacePage`'s canvas only ever rendered one thing: the live
draft (`schema` state, mutated by every `apply*` call). A merchant had no way inside the
Builder to see either (a) what a customer actually sees *today* if they have never published
— the mobile app's own bundled **Default AWJ Experience** (`kHomeSchemaJson`/`kCartSchemaJson`
in `mobile/lib/app/runtime_schema.dart`) — or (b) their own **last published version**, as
opposed to whatever unsaved edits currently sit in the draft. Both of those omissions are the
exact ambiguity this task's charter names: a Draft rendering in the same canvas, with no visual
distinction, risks being read as "what's live."

## What was built

**`web/src/modules/app-builder/default-experience.ts`** (new) — `DEFAULT_APP_EXPERIENCE`, a
static, client-side-only, read-only `AppSchema` constant that is a byte-identical mirror of the
real runtime's own bundled `kHomeSchemaJson`/`kCartSchemaJson`, combined under one
`navigation.initialPageId: 'home'` (a Builder-side-only convenience — the real runtime still
treats them as two independently parsed documents; see the file's own header comment). No new
backend route, no new API surface, no new schema field — LIVE-PREVIEW-1 §7 confirmed a
repo-wide search found zero prior representation of this schema anywhere outside `mobile/lib`.

**Conformance, not independent duplication** (same discipline LIVE-PREVIEW-2 established for
`runtime-contract.ts`): `web/src/modules/app-builder/default-experience.test.ts` reads
`mobile/lib/app/runtime_schema.dart` as plain text — no Flutter/Dart toolchain needed, since the
schema is a compile-time triple-quoted Dart string literal — extracts both JSON blocks via
regex, and deep-equals them against `DEFAULT_APP_EXPERIENCE.pages.home`/`.pages.cart`. If the
bundled mobile schema ever changes, this test fails until the TS constant is updated to match.

**`web/src/modules/app-builder/canvas.tsx`** — `AppBuilderCanvas` gained one new optional prop,
`stateBanner?: string`, rendered as a persistent banner strip above the existing sample-data
banner. It answers a different question than that banner ("which version am I looking at?" vs.
"is this data real?") and is computed entirely by the caller — `canvas.tsx` itself has no
knowledge of draft/published/default state.

**`web/src/app/(app)/app-builder/[id]/builder/page.tsx`** — the actual state-selection wiring:
- New `PreviewState = 'draft' | 'published' | 'default'` and a 3-way switcher button group in
  the header, next to the locale/device toggles.
- `switchPreviewState(next)` reuses the **existing** `GET /app-builder/apps/{id}/versions`
  (list) and `GET /app-builder/apps/{id}/versions/{version}` (full schema) endpoints — the same
  ones the pre-existing version-history page already calls — to fetch and cache the latest
  published version once per draft-load (invalidated on a new successful publish, so it never
  goes stale). No new backend route was needed or added.
- `viewedSchema`/`viewedPageRoot`/`isDraftView` are purely derived, computed values — `draft`
  keeps rendering the existing `schema`/`selectedPageId`/`selectedComponentId` state exactly as
  before (zero change to that path); `published`/`default` render `viewedSchema` through a
  **separate**, independently-tracked `viewedPageId`, so switching states never perturbs the
  draft's own selection.
- **Every** edit affordance (Save, Undo, Redo, Publish, the Pages panel's add/remove/set-home
  buttons, the Inspector) is `disabled`/swapped-out whenever `!isDraftView` — not merely
  visually muted. The structure and inspector panels are replaced wholesale with read-only
  equivalents (`readOnlyPagePanel`: page-switcher only; `readOnlyNotice`: a plain "read-only,
  switch to Draft to edit" message) rather than the same panels with edit handlers stubbed out,
  so there is no code path where a click against a non-draft schema could reach an `apply*`
  function. `applyPageEdit`/`applyThemeEdit`/`applyPagesEdit`/`handleSave`/`confirmPublish`
  remain wired exclusively to the `schema` (draft) state, unchanged.
- The Published tab itself is `disabled` when `app.latest_published_version` is falsy, with a
  tooltip explaining why — never renders an empty/broken state for a tenant that has never
  published.

**`web/src/messages/ar.json` / `en.json`** — new `appBuilder.builder.previewState.*` keys:
tab labels (`draft`/`published`/`default`), the three per-state banner strings (the draft
banner explicitly says "being edited, not a live version in the mobile app" — directly
implementing this task's "never imply Draft is production" instruction), and the
error/read-only/disabled-tooltip strings.

## Evidence

- **New tests**: `default-experience.test.ts` — 3/3 passed (home page matches, cart page
  matches, single navigable two-page document). `page.test.tsx` — 3 new cases added under a
  `describe('preview state switcher')` block, each with its own local `api.mockImplementation`
  (the shared `mockApi()` helper treats any path ending in `/versions` as the single-object
  publish response, which would answer the switcher's `GET .../versions` list call with the
  wrong shape):
  1. Switching to Default renders `DEFAULT_APP_EXPERIENCE`'s home content (`أَوْج`), shows the
     default banner, triggers **zero** additional API calls, and swaps in the read-only panels.
  2. Switching to Published (with `latest_published_version` set) calls `GET .../versions` then
     `GET .../versions/{version}`, renders that schema, shows the published+version banner, and
     confirms Save/Undo are disabled and the Pages "Add page" button is absent.
  3. The Published tab is `disabled` when `app.latest_published_version` is `null`.
- **No regressions**: all 27 pre-existing tests in `page.test.tsx` passed with **zero**
  modification — `page.test.tsx` now 30/30. Broader app-builder suite: 9 files / 86 tests green
  (`default-experience.test.ts`, `runtime-contract.test.ts`, `sample-resource-data.test.ts`,
  `page.test.tsx`, `canvas.test.tsx`, and the four other App Builder page suites).
- **Full web suite**: `npx vitest run` — 300 files / 2124 tests, all green.
- **Build**: `npm run build` — clean, no new errors or warnings.
- **Backend**: no PHP files touched by this task (confirmed via `git status --short -- app/
  database/ routes/ tests/` — empty). Full `php artisan test` run per this repo's mandatory
  pre-PR protocol: 4703 passed / 35 failed / 49 skipped (29576 assertions) — **identical failure
  count and cause to LIVE-PREVIEW-5's already-documented run**: `Call to undefined function
  App\Services\bcmul()`, this sandbox's pre-existing missing `ext-bcmath`, confined to
  `FuelCostBasisService.php` (Fuel/Petroleum logistics costing), unreachable by this task's
  web-only diff. Real CI (`php artisan test (L11, sqlite/pgsql)`, which does have `ext-bcmath`)
  is the authoritative check for this PR.

## No new accounting entries

This task touches no financial/accounting code path and no PHP file at all — it is a Builder UI
state-selection feature reusing two pre-existing read-only endpoints. No journal entry table
applies.

## Decision Gate check

No Decision Gate applies. No new backend route, no schema/API contract change (both endpoints
called already existed and are called with their existing shapes), no capability broadened (the
new states are strictly read-only presentations of data the endpoints already returned), no
Tenant Isolation/RBAC/Commerce authorization surface touched, no auth/token path changed. The
Default AWJ Experience mirror is client-side-only static data, not a new resource.

## Remaining gaps (carried forward, unchanged in nature)

- Real live product/cart data (vs. LIVE-PREVIEW-3's clearly-labeled sample data), visibility
  evaluation, and theme-to-shipped-app wiring remain deferred exactly as recorded under
  LIVE-PREVIEW-3/4. Switching to "Published" or "Default" still resolves bindings against the
  same `SAMPLE_RESOURCE_DATA`, not live merchant data — this task does not claim otherwise.
- The Default AWJ Experience mirror is intentionally not mechanically re-synced on every mobile
  build automatically; the conformance test only fails loudly if it drifts, per the same
  discipline as `runtime-contract.ts`'s fixture.

## Next task readiness

**LIVE-PREVIEW-7 — Integrated Proof: READY.** No new Decision Gate evidence found in this task
that would block it. LIVE-PREVIEW-7 must now prove the integrated flow (Builder Draft → Preview
→ Validate → Publish → `commerce/v1/experience` → real startup resolver → runtime compatibility
→ runtime rendering) using real contracts wherever feasible, and must not claim LIVE-PREVIEW-3's
sample data proves live-merchant-data Preview parity.
