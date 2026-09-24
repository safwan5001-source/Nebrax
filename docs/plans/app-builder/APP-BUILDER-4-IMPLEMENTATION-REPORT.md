# APP-BUILDER-4 — Implementation Report

STATUS: pre-merge review
DATE: 2026-09-23

## Outcome

Built the App Manager frontend (Next.js `web/`): an apps list, a path-first creation flow (Use My
Store Design / Choose Template / Start From Scratch), and an app overview/detail page — the
first user-facing App Builder UI slice, gated behind its own focused UI/UX Evidence Pass per the
horizon bootstrap's mandatory workflow. No backend change: APP-BUILDER-1's REST API already
covers create/list/show/rename/list-versions.

## Repository evidence / root cause

The horizon doc's V1 product slice ("App Manager / creation: Apps list and app overview
foundation. Create app via: Use My Store Design / Choose Template / Start From Scratch. Every path
produces a safe minimum commerce shell.") and the bootstrap's mandatory UI/UX workflow ("do not
design from memory... perform a focused current UI/UX Evidence Pass... make an explicit AWJ UX
Decision, then implement using the AWJ Design System") both directly gate this task. Per
`docs/plans/app-builder/APP-BUILDER-4-UX-EVIDENCE-PASS.md`: external interaction evidence
(WordPress.com's path-first site creation, Shopify's separated theme-library/add-theme surfaces,
general empty-state UX guidance) informed a path-first, two-route (list + create, not a combined
modal) structure; visual language is exclusively AWJ Design System components already established
in `web/src/components/nebrax` and `web/src/components/ui` (`PageHeader`, `FormPage`,
`FormSection`, `DetailPage`, `EmptyState`/`LoadingState`/`ErrorState`, `Badge`, `Card`, `Button`,
`Input`, `Label`) — no new visual primitives invented, matching AB-11 ("Builder is framework-aware
only at the runtime capability boundary").

Two scoping findings from reading `RuntimeCapabilities`/`BuilderAppService` (APP-BUILDER-1/2/3),
not new product decisions:
1. All three creation paths call the same `POST /app-builder/apps` with a different
   `creation_source`; the backend already guarantees a safe minimum schema regardless of path
   (`BuilderDraftExperienceService::minimalSafeSchema()`, seeded atomically at creation since
   APP-BUILDER-1). The two paths without real differentiated content yet (Use My Store Design,
   Choose Template — their actual sync/gallery logic is APP-BUILDER-8/9) carry an honest sub-label
   saying so in the UI, rather than implying a pipeline that does not exist yet.
2. The Builder workspace editor itself (APP-BUILDER-5) does not exist yet, so the app overview
   page states this plainly ("coming in a later task") instead of linking to a route that would
   404.

## Approach chosen

- **`/app-builder`** (list): `PageHeader` + primary "create app" action; `EmptyState` pointing at
  the same create action; app cards show creation-source badge + published/unpublished badge +
  created date, reusing `appDisplayName()` (locale-aware name) from the new `web/src/lib/app-builder.ts`
  shared types/helpers module. Access-gated by `apps_builder.view` via the same
  `hasPermission`-style helper `accounts/page.tsx` already established (owner/admin bypass +
  `permissions` array check).
- **`/app-builder/new`** (creation): `FormPage` with two `FormSection`s — path selection first
  (a `role="radiogroup"`/`role="radio"` set of three cards, keyboard/focus-ring accessible,
  matching the existing `role="switch"` custom-control precedent in `/applications`), name section
  revealed only after a path is chosen (progressive disclosure, matches the AWJ UX Decision).
  Submits `POST /app-builder/apps` and redirects to the new app's overview page.
- **`/app-builder/[id]`** (overview): `DetailPage` with a "published versions" section (reads
  `GET /app-builder/apps/{id}/versions`, empty state until APP-BUILDER-10 builds Publish) and a
  "visual editing workspace" section stating the honest coming-later status instead of a dead link.
- **Sidebar**: one new entry in the existing `sales` group (matches `commerce.app_builder`'s
  `ApplicationCatalog` group), gated by `appKey: 'commerce.app_builder'` +
  `permission: 'apps_builder.view'` — identical mechanism every other catalog-backed nav item
  already uses (`GET /applications/nav-state`).
- New translation namespace `appBuilder` (+ `nav.appBuilder`) added in parallel to both
  `web/src/messages/ar.json`/`en.json`, matching the existing `applications` namespace's structure
  and line-parity convention between the two files.

## Why this approach fits AWJ

Reuses the AWJ Design System exclusively (no new component library, no new visual pattern); keeps
Draft Experience ≠ Published Experience separation (the list/overview surfaces only ever touch
`BuilderApp`/`BuilderDraftExperience` identity, never a published version's immutable content);
introduces zero new backend surface (pure frontend consuming APP-BUILDER-1's existing API);
honest about what each creation path currently does, avoiding the "fallback must never look like
success" principle's frontend analogue (RUNTIME_COMPATIBILITY_V1.md §9, already cited in this
horizon's mobile runtime — applied here to not implying template/theme content exists yet).

## Changed files

- New: `web/src/app/(app)/app-builder/page.tsx` (list), `new/page.tsx` (creation),
  `[id]/page.tsx` (overview), and their three `*.test.tsx` files; `web/src/lib/app-builder.ts`
  (shared types/helpers); `docs/plans/app-builder/APP-BUILDER-4-UX-EVIDENCE-PASS.md`
- Modified: `web/src/components/layout/sidebar.tsx` (one new nav entry + `Smartphone` icon
  import), `web/src/messages/ar.json`/`en.json` (new `appBuilder`/`appBuilder.new`/
  `appBuilder.detail` namespaces + `nav.appBuilder` key, added in parallel to both files)
- No backend files touched — API surface unchanged from APP-BUILDER-1.

## Tests and exact results

- `npx vitest run` on the three new App Builder test files → **11/11 passed** (0 failures),
  `web/`, local. Found and fixed one real bug during this task's own test authoring (not present
  in production code): the `[id]/page.test.tsx` mock's `next-intl` translator initially created a
  new function object on every `useTranslations()` call, breaking `AppBuilderDetailPage`'s
  `useCallback`/`useEffect` dependency stability and causing an infinite re-render loop —
  confirmed test-only (the same `[params.id, t]` dependency shape already exists in
  `receipt-vouchers/[id]/page.tsx` without issue, since real `next-intl` returns a stable
  reference); fixed by memoizing one translator instance per namespace in the mock.
- `npm run build` → succeeds, zero errors, all three new routes (`/app-builder`,
  `/app-builder/new`, `/app-builder/[id]`) compile and appear in the route manifest.
- No backend files changed — full `php artisan test` not re-run for this task (would only
  re-observe the two already-documented, unrelated local-environment gaps from APP-BUILDER-1/2/3's
  reports); Web CI (`web-ci.yml`) is the authoritative check for this diff, run below.

## CI

GitHub Actions on PR head `0a14ffa72f4cb104629ce3fcf112a03a2a7ee667` (PR #975), all 6 checks
green: `php artisan test (L11, sqlite)`/`(L11, pgsql)` (both push- and pull_request-triggered
runs) and `web build (Next.js)` (both runs).

The first push (head `ee1166b`) failed `web build` with two issues: (1) a real bug in this task's
own code — `new Date(...).toLocaleDateString(locale)` tripped the repo's central-date-formatting
guardrail, fixed by routing through `formatDate()` from `@/lib/formatting` (commit `b791fc7`);
(2) a pre-existing, unrelated drift in `openapi-model.generated.ts` vs. `docs/openapi/public-api-v1.yaml`
(introduced by an already-merged Commerce Mobile task, commit `dffe6c8`, never caught because no
`web/`-touching PR had run since) — fixed by regenerating the model via `npm run openapi:generate`,
a pure mechanical transform of the already-committed YAML contract (commit `0a14ffa`). Both
documented in a PR comment before the fixes were pushed.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `0a14ffa72f4cb104629ce3fcf112a03a2a7ee667`
- Findings / resolution: No open findings. `chatgpt-codex-connector[bot]` posted only a
  usage-limit notice (did not perform a review). No human review posted. Two CI failures on the
  first push were investigated and fixed (see CI section above) before this review.

## Merge

- Merge status: **merged** via standing authority (squash, no unresolved Decision Gate, required
  CI green on exact head, no unapproved scope expansion, no production deploy/release).
- Merge SHA: `163bcc1c27ad87e874626710910a28e381029cd0`

## Post-merge review

- POST_MERGE_REVIEW: **PASS**
- `main@163bcc1` confirmed as `origin/main`'s tip at merge time, a single-parent squash (parent
  `7bf04d7`), zero content drift from the reviewed head `0a14ffa`
  (`git diff 0a14ffa72f4cb104629ce3fcf112a03a2a7ee667 origin/main -- app database routes tests docs/plans/app-builder web`
  was empty). Post-merge CI completed with both workflows green: `ci.yml` run
  [35935456801](https://github.com/safwan5001-source/Nebrax/actions/runs/35935456801)
  (sqlite/pgsql `success`) and `web-ci.yml` run
  [35935456789](https://github.com/safwan5001-source/Nebrax/actions/runs/35935456789)
  (`web build (Next.js)` `success`).
- Reviewed Merge SHA: `163bcc1c27ad87e874626710910a28e381029cd0`
- Target-branch checks/smoke: post-merge `ci.yml` run
  [35935456801](https://github.com/safwan5001-source/Nebrax/actions/runs/35935456801) and
  `web-ci.yml` run
  [35935456789](https://github.com/safwan5001-source/Nebrax/actions/runs/35935456789) — both
  `success`.
- Findings / resolution: none.

## Self-review

### Implementer

Satisfied the actual outcome (App Manager list/overview + three-path creation, all producing a
safe minimum app today) using only the AWJ Design System's existing components — no new visual
primitive invented, matching the bootstrap's "extend deliberately... rather than creating an
ad-hoc parallel UI language" fallback clause (not triggered here — nothing was missing from the
existing component set).

### Reviewer

- No code broader than the task: no Builder workspace/editor UI (APP-BUILDER-5), no
  template/theme content pipeline (APP-BUILDER-8/9), no publish flow beyond reading already-empty
  versions (APP-BUILDER-10).
- UI/UX Evidence Pass completed and documented **before** implementation, with explicit
  retained/rejected patterns and an AWJ UX Decision, per the horizon's own gate for the first major
  Builder UI slice — not skipped, not retrofitted after the fact.
- Found and fixed a real test-authoring bug (unstable mock reference) via this task's own test
  run before any external review, verified the fix against the equivalent stable-reference pattern
  already proven elsewhere in this codebase (`receipt-vouchers/[id]/page.tsx`).

### AWJ Guardian

- **No business authority claimed client-side**: creation always goes through
  `POST /app-builder/apps`; the frontend never mints an app ID or asserts a schema shape locally.
- **RTL/LTR**: all new layout uses logical properties/existing RTL-safe components; no new
  direction-specific asset. Arabic is the default rendering locale of every screenshot-equivalent
  test fixture (Arabic app names used throughout the test data).
- **Accessibility**: path cards are a real `radiogroup`/`radio` set (keyboard navigable, visible
  `focus-visible:ring-primary`), not a div-soup click target; every icon is `aria-hidden` with
  text-carrying siblings for the actual accessible name.
- **No RBAC/ApplicationCatalog/migration change**: this task touches none of those layers — the
  sidebar entry reuses the existing `commerce.app_builder` catalog key and `apps_builder.view`
  permission, both already defined in APP-BUILDER-1.

## Accounting impact

**None.** No journal entries, no monetary field, no `LedgerService` call site — this task has no
financial operation.

## Tenant / branch isolation impact

None — no model/migration/route changed. The frontend consumes APP-BUILDER-1's already
tenant-scoped (`BaseModel`/`CompanyWide`) API.

## Security / authorization impact

None beyond reusing existing gates: `apps_builder.view` (client-side pre-check + server-side
`EnsurePermission` on every API call) and `commerce.app_builder` (`EnsureApplicationActive` via
the existing nav-state endpoint). No new route, no new permission.

## Backward compatibility

Fully additive — no existing page, component, or translation key was modified in a way that
changes prior behavior (sidebar gains a new item; message files gain new namespaces).

## API / DB / migration impact

None. Zero backend files changed.

## External research used

`docs/plans/app-builder/APP-BUILDER-4-UX-EVIDENCE-PASS.md` records the external interaction
evidence (WordPress.com site-creation flow, Shopify theme library, general empty-state UX
literature) and the retained/rejected patterns/AWJ UX Decision, per Gate 1/the bootstrap's UI/UX
workflow requirement.

## Risks / remaining work

- "Use My Store Design" and "Choose Template" currently produce the identical safe-minimum shell
  as "Start From Scratch" (only `creation_source` differs) — intentional, explicitly labeled in
  the UI, and resolved by APP-BUILDER-8 (theme/store-design sync) and APP-BUILDER-9 (template
  gallery) respectively, not silently deferred.
- App overview's "visual editing workspace" section is a placeholder note until APP-BUILDER-5
  builds the actual Builder workspace shell — by design, not an oversight.
- No E2E/browser test run for this task (Playwright) — focused component tests + a full
  `npm run build` are the verification for this slice, consistent with this repo's "no automated
  frontend tests exist yet" baseline noted in `CLAUDE.md`'s "الخطوة التالية" section (this task
  adds the first App Builder-specific frontend tests, following the pattern other modules already
  use, but does not newly establish E2E coverage for the whole app).

## Discovered backlog

None new.

## Git state

- Branch: `claude/awj-app-builder-horizon-v1-e4iy21`
- PR: [#975](https://github.com/safwan5001-source/Nebrax/pull/975) (merged)
- Base SHA: `7bf04d79db941e089001e6234c478c227c8c6c73`
- Head SHA (reviewed pre-merge): `0a14ffa72f4cb104629ce3fcf112a03a2a7ee667`
- Merge SHA: `163bcc1c27ad87e874626710910a28e381029cd0`

## Recommended next dependency-ready task

`APP-BUILDER-5` — Builder workspace shell (Pages/Components/Layers, canvas, Inspector, save
state, locale/device controls). **Requires its own focused UI/UX Evidence Pass and AWJ Design
System conformance check** before implementation, per the horizon's gate — this is the second
major Builder UI slice, and the bootstrap explicitly requires repeating the evidence-pass workflow
per slice, not reusing this task's pass.
