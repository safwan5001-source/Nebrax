# AWJ Autonomous Engineering — Current State

> This file is a durable resume point, not a substitute for Git/GitHub evidence.

LAST_UPDATED: 2026-09-25 (**AWJ Storefront Visual Completion Horizon implementation-ready queue is done.** #1015 `ec2aad3cacc988417971489d46c9125da838c8d8`, #1016 `2e1225f39e553103ef628e25438461d4cd7d2abe`, #1017 `6b8869e8694c3b897eed4f75bbf1af07b708f1e4`, #1020 `395b163c0bc2f22e6086e3e4f5422fa612c7a2a3`, #1021 `58567bb0ce3b8ccb62dae2668aafa56cf4ccf64d`. PRE_MERGE_REVIEW and POST_MERGE_REVIEW passed on each exact SHA. No deploy. Remaining items are BACKEND_GATED, PRODUCT_DECISION_REQUIRED, or DEFERRED. Do not start them without a Decision Packet.)

## Previous snapshot

LAST_UPDATED: 2026-09-24 (**AWJ App Builder Horizon V1 is CLOSED.** All 12 tasks resolved: APP-BUILDER-1/2/3/4/5/6/8/9/10/11/12 done, APP-BUILDER-7 explicitly deferred as a genuine Decision Escalation Gate. APP-BUILDER-7 (Data/Actions/Conditions/Visibility) evaluated for implementation and found NOT READY: three of its four named concepts (Data, Conditions, Visibility) have no backing in the accepted, tested App Schema contract, and building them requires inventing an expression/condition engine or a Data Source Registry contract, both explicitly "not yet locked" in the accepted architecture doc. Owner decision (2026-09-24): keep APP-BUILDER-7 explicitly deferred (decision_required, not completed, not permanently skipped) — table updated, APP-BUILDER-8/9/10 completed in sequence after narrow dependency checks each found no real runtime/schema dependency on APP-BUILDER-7 (PR #983, #985, #988). APP-BUILDER-11's original "bind real Commerce resource / proven Flutter runtime consumes" line was found genuinely unsatisfiable inside the accepted contract (the identical undecided Data Source Registry boundary as APP-BUILDER-7) and escalated; owner decision (2026-09-24, option 2): redefined as an Integrated Proof of the currently accepted and actually implemented App Builder contract, completed (PR #990) with the real-Commerce-binding/live-runtime portion carried forward as a deferred/decision_required follow-up track alongside APP-BUILDER-7. APP-BUILDER-12 (Horizon closure, PR #991) produced the horizon's final closure report distinguishing completed capabilities from this one connected deferred architecture track, plus known limitations, out-of-scope boundary, and next-horizon recommendation. Per the horizon bootstrap's own "Horizon End" rule, this session now STOPS — no automatic continuation to Preview & Testing or any new horizon without explicit owner/ChatGPT-reviewed authorization. Prior AWJ Mobile Runtime Proof Horizon V1 (below) is fully closed and was this horizon's accepted input.)
LAYER_VERSION: V1
STATUS: OPEN — AWJ Storefront Visual Completion Horizon (`docs/plans/store/AWJ_STOREFRONT_VISUAL_COMPLETION_HORIZON.md`). App Builder Horizon V1 below remains CLOSED.

## Current objective

AWJ Storefront Visual Completion Horizon implementation-ready work is merged: evidence, homepage deletion fidelity, customizer chrome, designed `not-found`, and published `density`/`productCard` padding. No further dependency-ready task remains inside this horizon. Per-instance section content, branding object storage, undo/version history, Market, and Floral stay behind a Decision Gate or explicit deferral. No deploy. The App Builder horizon below is closed history.

## AWJ App Builder Horizon V1 — execution log

- `APP-BUILDER-1` (Domain/persistence foundation) is **done**: tenant-scoped `BuilderApp` (identity), `BuilderDraftExperience` (mutable working copy, one per app, seeded atomically at creation with a minimal safe App Schema V1 shell per `APP_SCHEMA_V1.md` §4), and `BuilderPublishedExperienceVersion` (immutable, sequentially versioned per app under a row-locked transaction, no update/delete possible after creation) — all `CompanyWide` (mirrors `commerce.storefront`'s classification). `AppSchemaStructuralValidator` checks only the top-level App Schema shape (known keys, `defaultLocale` ∈ `locales`, basic types, a 1 MiB defensive size bound); deep component/action/resource validation is explicitly deferred to `APP-BUILDER-2`/`3`. New RBAC permissions `apps_builder.view`/`apps_builder.manage`/`apps_builder.publish` (publish kept separate — irreversible, customer-facing; not related to the pre-existing `apps.view`/`apps.manage`, which gate `TenantApplicationService`'s unrelated catalog enable/disable concept). New `ApplicationCatalog` key `commerce.app_builder` (group `sales`, `built`, optional, no dependencies), gated via `EnsureApplicationActive`. REST API under `/api/app-builder/apps/*`. Registered the new `app/Services/AppBuilder` directory in the three copy-list scripts this repo's CI guard requires (`ci.yml`, `setup.sh`, `deploy/assemble.sh`). 12 new focused tests (tenant isolation, RBAC negatives, capability gating, structural-validation negatives including an attempted `tenantId`-smuggling test, immutability, race-safe concurrent-publish version numbering) + `ApplicationCatalogTest`/`TenantApplicationTest`'s exhaustive-key fixtures updated for the new catalog entry (44→45). No accounting impact — purely additive, no existing route/model/migration/permission changed. PR #969 merged: Merge SHA `0560429d5987d89549e9e436dc86d2504634eb38`, a confirmed single-parent squash onto `main` (parent `4010305`, this horizon's own base SHA), zero content drift from the reviewed head `869cde3`. Post-merge CI green on the merge commit itself (`ci.yml` run [35916107117](https://github.com/safwan5001-source/Nebrax/actions/runs/35916107117), both `sqlite`/`pgsql` jobs `conclusion: success`). `POST_MERGE_REVIEW: PASS`. A local full-suite run surfaced 35 unrelated pre-existing local-environment-only failures (missing `bcmath` PHP extension; `setup.sh` never copying `app/Mail/*.php`, unlike `ci.yml`/`deploy/assemble.sh`) — both root-caused with direct evidence, confirmed not to reproduce on real CI, and recorded as discovered backlog (the `setup.sh` gap) rather than fixed in this task (out of scope). Full evidence: `docs/plans/app-builder/APP-BUILDER-1-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-2` (Schema validation + runtime capability contract) is **done**: realigned the backend App Schema validator to the real, already-tested Mobile Runtime contract (`mobile/lib/schema/app_schema.dart` etc.) instead of the illustrative architecture-doc shape APP-BUILDER-1 had used — the horizon's own anti-duplication rule ("do not invent a second schema/runtime contract") required this correction once the actual Dart source was read. Added `SchemaVersion` (x.y.z comparator), `RuntimeCapabilities` (byte-for-byte mirror of `registry_identifiers.dart`'s 15 components/6 actions/1 native capability), `AppSchemaParser` (replaces `AppSchemaStructuralValidator`; full recursive structural validation matching `AppSchema._fromJson()`'s field allowlists and size/depth budgets at every level), `CapabilityManifest`/`CompatibilityResult`/`CompatibilityResolver` (PHP port of `capability_manifest.dart`/`compatibility.dart`, called only at publish time — a required-but-unsupported component/action fails the whole document closed, an optional one safely falls back). `BuilderDraftExperience`'s schema shape/version corrected accordingly (`1.0.0`, not `1.0`). Found and fixed one real bug via this task's own tests before any external review: `CompatibilityResolver::resolve()`'s page-root check compared against `null` but `resolveComponent()` returns `bool`, making the fail-closed path dead code. 44 new/updated tests — `AppSchemaParserTest` (16) and `CompatibilityResolverTest` (10) deliberately mirror `mobile/test/schema/schema_parser_test.dart`/`compatibility_test.dart`'s own test names — plus full guard-test regression (55/55, confirming no tenant/RBAC/ApplicationCatalog impact). No accounting impact; no route/migration/API-shape change. PR #971 merged: Merge SHA `8844881de5171055342b397294d8d8fd7ae1e33f`, a confirmed single-parent squash onto `main` (parent `9c5a5b9`), zero content drift from the reviewed head `30abaa3`. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/app-builder/APP-BUILDER-2-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-3` (Component/Action/Data Resource registries) is **done**: added `ComponentRegistry`/`ActionRegistry` — full per-identifier metadata (props, children rules, actionability, typed action params) for all 15 components/6 actions, every field read directly off `mobile/lib/registry/component_widgets.dart`/`mobile/lib/actions/app_action.dart` (not the illustrative `COMPONENT_REGISTRY_V1.md`/`ACTION_REGISTRY_V1.md`). Two evidence-grounded scoping findings, neither a Decision Gate: (1) the real, tested schema contract has no `bindings` field (`SchemaComponent._allowedKeys` = `type/id/optional/props/children/action` only) — no "Bindings" metadata invented; (2) no `COMMERCE_MOBILE_API_READINESS.md` exists and the closed Mobile Runtime horizon never built live data binding, so `DataResourceRegistry::RESOURCES` ships intentionally empty (guarded by a test) instead of populated with speculative resources. No change to `AppSchemaParser`/`CompatibilityResolver` — pure additive read metadata for a future Inspector (first real consumer: `APP-BUILDER-5`). 14 new focused tests (parity guards mirroring the Dart suite's own `RuntimeCapabilities` key-set assertions), zero modified files. Full local suite: zero regressions (35 pre-existing unrelated `bcmath`/`app/Mail` local-environment failures, same as APP-BUILDER-1/2). PR #973 merged: Merge SHA `4256d0aadb1a53f5288d054d5d937cd85ddf4d97`, a confirmed single-parent squash onto `main` (parent `6e15810`), zero content drift from the reviewed head `82cbc1a`. Post-merge CI green on the merge commit (`ci.yml` run [35931041709](https://github.com/safwan5001-source/Nebrax/actions/runs/35931041709), both `sqlite`/`pgsql` jobs `success`). `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/app-builder/APP-BUILDER-3-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-4` (App Manager + creation wizard) is **done**: the first user-facing App Builder UI slice, gated behind a focused UI/UX Evidence Pass (`APP-BUILDER-4-UX-EVIDENCE-PASS.md`) completed **before** implementation per the horizon bootstrap's mandatory workflow — external interaction evidence (WordPress.com site creation, Shopify theme library, empty-state UX literature), retained/rejected patterns, and an explicit AWJ UX Decision, all built from the AWJ Design System's existing components exclusively (no new visual primitive invented). Built `/app-builder` (list), `/app-builder/new` (path-first creation: Use My Store Design / Choose Template / Start From Scratch, all producing the same safe-minimum shell today via APP-BUILDER-1's existing `POST /app-builder/apps`, honestly labeled), `/app-builder/[id]` (overview, with a plain "coming in a later task" note instead of a dead link to the not-yet-built Builder workspace). Pure frontend — zero backend files touched, zero API change. Sidebar entry added to the `sales` group via the existing `commerce.app_builder`/`apps_builder.view` gating mechanism. 11 new focused tests, all passing; found and fixed one real test-mock bug (an unstable `next-intl` mock reference causing an infinite re-render loop in the test harness only — confirmed not a production-code issue, since the same `useCallback` dependency shape already exists safely in `receipt-vouchers/[id]/page.tsx` against the real, stable `next-intl`). `npm run build` succeeds. CI red on the PR surfaced two failures: one real (own) bug — `new Date(...).toLocaleDateString()` used directly instead of the required `formatDate` helper, tripping the repo's date-formatting guardrail test — fixed directly; and one pre-existing, unrelated drift — `openapi-model.generated.ts` never regenerated after an earlier already-merged Commerce Mobile task added `cart_merged` to the source YAML — fixed mechanically via `npm run openapi:generate` with a transparent PR comment explaining both fixes before pushing. PR #975 merged: Merge SHA `163bcc1c27ad87e874626710910a28e381029cd0`. Docs follow-up PR #976 merged: Merge SHA `ca20ae4023b8548c59e3003d89816dde95f8f5d0`. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/app-builder/APP-BUILDER-4-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-5` (Builder workspace shell) is **done**: a focused UI/UX Evidence Pass (`APP-BUILDER-5-UX-EVIDENCE-PASS.md`) written before implementation, explicitly scoping this task to a read-only workspace shell — Pages/Layers tree, canvas preview, Inspector, locale (ar/en) and device (mobile/tablet/desktop) preview controls, responsive admin baseline — with all editing interactivity (add/remove/reorder, property edits, drag, undo/redo, save) explicitly deferred to `APP-BUILDER-6` per the horizon's own task-queue split, preventing scope creep into a full editor. Backend: new `AppBuilderRegistryController`/`GET /app-builder/registries` route (gated by `apps_builder.view` + `commerce.app_builder`) exposing APP-BUILDER-3's `ComponentRegistry`/`ActionRegistry` over HTTP for the first time — a pure read/serialize layer, zero registry/schema/domain logic changed. Frontend: `AppBuilderCanvas` (15-case component-type switch rendering the draft's real App Schema tree, money shown via `formatRiyal(amountMinor / 100)` per the runtime's minor-units convention), `LayersTree` (click-to-select), `Inspector` (props/action detail keyed off the live registry response, including an explicit "not recognized by the registry" state for a schema referencing an unknown type), assembled into `/app-builder/[id]/builder`, a full-height workspace page inside the standard sidebar/topbar shell (`-m-4 sm:-m-6` canceling ambient padding, `h-[80vh] min-h-[560px]`, not a chrome-less route group). `/app-builder/[id]`'s placeholder "coming in a later task" note replaced with a real "Open the builder" link. 4 new backend tests + 3 new frontend workspace tests + 2 updated detail-page tests, all passing; one genuine test-environment artifact diagnosed via `console.trace()` (a stray zero-argument mock invocation from Vitest/RTL's own async teardown machinery, confirmed via debug logging not to originate from the page's real `Promise.all` call sites) and handled with a defensive test-side guard rather than a production-code change. `npm run build` succeeds. PR #977 merged: Merge SHA `f48d583f0041caf909a61c4658aa7d1b89c0a604`. Docs follow-up PR #978 merged: Merge SHA `84d528a1a04568274762129786e1eb7c4bf14302`. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/app-builder/APP-BUILDER-5-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-6` (Visual editing + history) is **done**: a focused UI/UX Evidence Pass (`APP-BUILDER-6-UX-EVIDENCE-PASS.md`) written before implementation — judged necessary since APP-BUILDER-5's own pass left this as an open scope question, and this task's interaction problem (the workspace's first destructive/undoable actions and its first form inputs) is materially different from a read-only shell. Turned the APP-BUILDER-5 shell into a real editor: select/add/remove/reorder (bounded to same-parent siblings only, via `@dnd-kit` reused verbatim from `web/src/components/settings/section-designer.tsx`'s existing internal pattern — no new dependency), inline typed property/action-param editing in the Inspector (one control per registry `PropType`: text/URL-hinted/number/Riyal-denominated-number/add-remove-row-list, `enum_values` always as a `<Select>`, a component's `injected_runtime_action_params` never shown editable), a bounded 50-entry undo/redo history (`Ctrl/Cmd+Z`/`Ctrl/Cmd+Shift+Z` plus toolbar buttons), and explicit Draft/Unsaved/Saving/Saved header state with a Save button calling APP-BUILDER-1's existing `PUT /app-builder/apps/{id}/draft` completely unchanged. Pure frontend — zero backend files touched. New pure/immutable tree-edit helpers in `web/src/lib/app-builder.ts` (`updateComponentById`/`addChildComponent`/`removeComponentById`/`reorderChildren`/`moveSibling`/`findParentId`/`createComponentFromDefinition`). Caught and fixed two real issues via self-review before any external review: a dropped "action type not recognized by the registry" fallback message (a real regression against APP-BUILDER-5's already-shipped defensiveness), and a React Strict-Mode hazard — the undo/redo refs were originally mutated inside a `setState` updater function, which Strict Mode double-invokes in development and would have silently corrupted the history stack; fixed by design (refs mutated once, synchronously, alongside plain-value state setters) before any test was written. 17 new tree-helper unit tests + 9/9 workspace tests (up from 3/3), full frontend suite 2037/2037 passing, `npm run build` succeeds, full backend suite unaffected (4630 passed, same pre-existing unrelated local-environment failure set — confirmed via `diff -rq` against the built project that zero backend source was touched). PR #979 merged: Merge SHA `08c143b614be7f2b303528a17a13e862c08b6261`. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/app-builder/APP-BUILDER-6-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-7` (Data/Actions/Conditions/Visibility — Develop mode) is **deferred**
  (`decision_required`, not completed, not permanently skipped): evaluated for implementation and
  found not ready — a genuine Decision Escalation Gate, since three of its four named concepts
  (Data, Conditions, Visibility) have no backing in the accepted, tested App Schema contract, and
  building them requires inventing an expression/condition engine or a Data Source Registry
  contract, both explicitly "not yet locked" in the accepted architecture doc. Owner decision
  (2026-09-24, option 2): keep it explicitly deferred, return to it through its own dedicated
  architecture/evidence decision before implementation. See `TASK-QUEUE.md` for the full finding.
- `APP-BUILDER-8` (Theme + Use My Store Design) is **done**: a focused UI/UX Evidence Pass
  (`APP-BUILDER-8-UX-EVIDENCE-PASS.md`) written before implementation, judged necessary as this
  task's first cross-module integration (reading Store Customizer's live data) and first
  non-component-tree editing surface. Performed a narrow dependency check confirming zero real
  runtime/schema dependency on the deferred `APP-BUILDER-7`, per the owner's explicit resolution.
  Added a **Theme** tab to the Builder workspace's structure panel, editing `schema.theme.tokens`
  (a flat, unconstrained `Map<string, string>`, already validated server-side — no new
  schema/contract): manual preset/color/radius/density/product-card-style editing through the same
  undo/redo/dirty/save pipeline `APP-BUILDER-6` built, plus **"Use My Store Design"** — a one-time
  Detect → Diff → Preview → Apply sync against the Store Customizer's real, already-shipped
  presentation data (`GET /commerce/workspace/storefronts`, `GET .../presentation`, both existing,
  `commerce.manage`-gated routes, no new backend), reading the **published** config over the draft.
  Canvas preview reflects the theme's primary color live via CSS custom properties (existing
  Tailwind `var(--primary)` mapping); radius/density/product-card tokens are persisted/diffed/
  synced but not yet visually reflected in the canvas (`borderRadius.DEFAULT` is a fixed Tailwind
  value, not var-driven) — an explicit, scoped gap, not silently dropped. Pure frontend — zero
  backend files touched. Caught and fixed one real bug via self-review before any external review:
  `theme.sync.title` and `theme.sync.action` were translated to the identical string in both
  `ar.json`/`en.json`, causing a test to bind its "detect" click to the wrong (non-interactive)
  element; fixed by giving the static heading its own distinct copy. Reuses the Store Customizer's
  own `presentationCssVars`/`THEME_PRESETS` color-derivation utilities directly (a deliberate,
  evidence-justified exception to "no Customizer code inherited automatically" — that boundary is
  about not mechanically copying Customizer's UI/UX, not about refusing a correct, tested
  color-math utility for a feature whose entire purpose is reading Customizer's real data
  honestly). 4 new `app-builder.ts` unit tests (21/21 total) + 5 new workspace tests (14/14 total),
  full frontend suite 2046/2046 passing, `npm run build` succeeds, `ar.json`/`en.json` key parity
  verified, full backend suite unaffected (4630 passed / 35 pre-existing-failure baseline
  unchanged, zero backend source drift — confirmed via `diff -rq` against the built project). PR
  #983 merged: Merge SHA `1248223dd1668ad840f2b39f21e3de5a6d86755b`. `POST_MERGE_REVIEW: PASS`.
  Full evidence: `docs/plans/app-builder/APP-BUILDER-8-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-9` (Templates + navigation/pages) is **done**: a focused UI/UX Evidence Pass
  (`APP-BUILDER-9-UX-EVIDENCE-PASS.md`) written before implementation. A dependency check
  confirmed no real runtime/schema dependency on the deferred `APP-BUILDER-7` and, unlike it, no
  new App Schema contract required at all — `SchemaNavigation` is documented as "deliberately
  minimal" in its own Dart source, and `AppSchemaParser::validate()` already enforces the entire
  "system page constraint" surface server-side (non-empty `pages`, every root `type: 'Page'`,
  `navigation.initialPageId` referencing a declared page). Added page add/remove/set-home to the
  Builder workspace's Pages tab (new `pages`-map helpers in `app-builder.ts`, the `pages`-map
  analogue of `APP-BUILDER-6`'s component-tree helpers; guardrails only mirror the server's own
  checks — never a new rule). Gave the Inspector's `navigate` action `pageId` param a real picker
  of the schema's declared pages, replacing a free-text field that had no validation against real
  pages anywhere (`ActionRegistry`'s `navigate` action was already real and editable since
  `APP-BUILDER-6`). Added a small curated template set (Blank, Catalog) to `/app-builder/new`'s
  `template` creation path, replacing its honest "added in a later task" placeholder — each a
  complete, valid `AppSchema` from already-shipped component/action types, applied via a second
  `PUT .../draft` call right after app creation; Catalog's `Button`→`navigate` action doubles as a
  live demonstration of the new page navigation. Pure frontend — zero backend files touched. 7 new
  `app-builder.ts` unit tests (28/28 total) + 4 new Builder-workspace tests (18/18 total) + 2 new
  creation-wizard tests (5/5 total), full frontend suite 2060/2060 passing, `npm run build`
  succeeds, `ar.json`/`en.json` key parity verified, full backend suite unaffected (4630 passed /
  35 pre-existing-failure baseline unchanged, zero backend source drift). PR #985 merged (also
  carrying `APP-BUILDER-8`'s post-merge documentation, pushed to the same still-open branch before
  that earlier docs-only PR had merged): Merge SHA `c054c9c2425e0f1f6172cee437d9fc2415073b66`,
  confirmed zero content drift via a path-restricted diff despite two unrelated commits landing on
  `main` between implementation and merge. `POST_MERGE_REVIEW: PASS`. Full evidence:
  `docs/plans/app-builder/APP-BUILDER-9-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-10` (Validate/Publish/Version/Rollback foundation) is **done**: a dependency check
  confirmed no real runtime/schema dependency on the deferred `APP-BUILDER-7` — validate/publish/
  rollback all operate on the whole schema as an already-validated opaque document, never touching
  `SchemaComponent`-level Actions/Conditions/Visibility/Data. The first task this horizon touches
  backend files since `APP-BUILDER-2`: a new `POST .../validate` endpoint (refactored out of
  `publish()`'s existing two checks — `AppSchemaParser::validate()` then
  `CompatibilityResolver::resolve()` — creates no version row, gated by `apps_builder.manage` since
  it mutates nothing). A focused UI/UX Evidence Pass (`APP-BUILDER-10-UX-EVIDENCE-PASS.md`) written
  before implementation. Added a "Publish" dialog to the Builder workspace header (beside Save) that
  auto-runs Validate, shows its result, takes an optional note, and only enables confirm once
  validation passes — disabled, with a visible reason, while the draft has unsaved changes (a real
  correctness guardrail: `publish()` reads the *saved* draft, not in-memory edits) or without
  `apps_builder.publish`. Added `/app-builder/[id]/versions`: every published version with its note
  and publisher (`published_by_name`, already stored but never exposed) and a "Restore to draft"
  action that writes the historical schema back via the existing `PUT .../draft` and redirects into
  the Builder workspace — never auto-publishing; the existing publish pipeline's compatibility check
  applies automatically on the merchant's next explicit publish, satisfying "compatibility-safe
  rollback within contract" with zero new validation logic. Caught and fixed one real bug via
  self-review before any external review: the Resource's first draft used `whenLoaded('publisher',
  ...)` for `published_by_name`, correct for `index()`/`show()` (both eager-load the relation) but
  silently `null` for `store()`'s freshly-created response — fixed by resolving `$this->publisher?->name`
  directly. 4 new `BuilderAppTest` cases (22/22 total) + 97/97 across the full App
  Builder/RBAC/tenancy test slice, 4 new Builder-page tests (22/22 total) + 4 new versions-page
  tests (new file) + 3/3 detail-page tests, full frontend suite 2076/2076 passing, `npm run build`
  succeeds, `ar.json`/`en.json` key parity verified, full backend suite 4634 passed / 35
  pre-existing-failure baseline unchanged (zero backend source drift, +4 matching this task's new
  tests exactly). PR #988 merged (also carrying `APP-BUILDER-9`'s post-merge documentation and this
  task's own dependency check, pushed to the same still-open branch before that earlier docs-only
  content had merged): squash SHA `b69f98125d0b9010986cd7df16247dea68d4e0e4`, confirmed
  single-parent squash and zero content drift from the reviewed pre-merge head `10babae` via a
  path-restricted diff, post-merge CI green on the merge commit itself (`ci.yml` run `35989443086`
  sqlite+pgsql both success, `web-ci.yml` run `35989443048` success). `POST_MERGE_REVIEW: PASS`.
  Full evidence: `docs/plans/app-builder/APP-BUILDER-10-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-11` (Integrated vertical proof + UX/security closure) is **done** under an
  owner-redefined scope (2026-09-24, option 2): a dependency check found the horizon doc's
  original task-11 line ("bind real Commerce resource... proven Flutter runtime consumes") is not
  satisfiable inside the accepted, tested contract — a schema `bindings` key is structurally
  rejected, `DataResourceRegistry::RESOURCES` is deliberately empty, every registered `Action` is
  `DISPATCH_PROVEN_NOOP`, and the architecture doc lists "exact Data Source Registry contract" as
  explicitly not locked, the same undecided item that made `APP-BUILDER-7` a Decision Escalation
  Gate. Escalated to the owner; redefined as an **Integrated Proof of the currently accepted and
  actually implemented App Builder contract**. Delivered exactly that: one new test file,
  `tests/Feature/AppBuilderIntegratedProofTest.php`, driving the real, already-shipped HTTP
  contract through one connected merchant journey (create → edit → theme sync from a real seeded
  `Storefront`/presentation → pages/navigation → Validate → Publish → immutable version → restore
  to draft → revalidate → Publish again, proving an exact round trip) plus tenant-isolation and
  RBAC coverage across every surface the proof touches, plus an explicit boundary test proving
  `bindings` is still rejected and `DataResourceRegistry` stays empty after the full lifecycle
  runs. Zero production code changed. Full redefinition record:
  `docs/plans/app-builder/APP-BUILDER-11-UX-EVIDENCE-PASS.md`. The original task-11 intent's
  real-Commerce-binding/live-runtime portion is recorded as a connected deferred/`decision_required`
  follow-up track with `APP-BUILDER-7`, carried into `APP-BUILDER-12`'s closure report — not
  silently dropped, not marked done. 4/4 new tests passed (61 assertions), 126/126 across the full
  App Builder/Commerce-workspace regression slice, full frontend suite 2076/2076 passing
  (unaffected), full backend suite 4638 passed / 35 pre-existing-failure baseline unchanged (zero
  backend source drift). PR #990 merged: squash SHA `a7a2e0c35ee5a0a2ddebe7aaf23e281f861ce744`,
  confirmed single-parent squash and zero content drift from the reviewed pre-merge head `9ce280c`
  via a path-restricted diff, post-merge CI green on the merge commit itself (`ci.yml` run
  `36003417429` sqlite+pgsql both success; no `web-ci.yml` run expected or triggered since the
  diff touches only `tests/Feature/` and `docs/`). `POST_MERGE_REVIEW: PASS`. Full evidence:
  `docs/plans/app-builder/APP-BUILDER-11-IMPLEMENTATION-REPORT.md`.
- `APP-BUILDER-12` (Horizon closure) is **done** — the horizon's mandatory final task. Produced
  `docs/plans/app-builder/APP-BUILDER-12-HORIZON-CLOSURE-REPORT.md`: a full closure report covering
  all 11 completed tasks with their PR/merge-SHA evidence, cumulative tenant/RBAC/App-Schema
  security evidence, accessibility/bidi evidence, runtime compatibility evidence, cumulative
  regression evidence, one connected deferred architecture track (`APP-BUILDER-7`'s Data/Actions/
  Conditions/Visibility plus `APP-BUILDER-11`'s original real-Commerce-binding/live-runtime clause
  — both tied to the same unlocked Data Source Registry boundary, never independently reinterpreted
  or silently dropped), known limitations carried forward (`APP-BUILDER-8`'s canvas token-rendering
  gap; the pre-existing local `bcmath`/`setup.sh` environment gap — neither an App Builder defect),
  the horizon's explicit out-of-scope boundary (App Factory, signing, submission, production
  release, etc. — none touched), and a next-horizon recommendation (a dedicated Data Source
  Registry decision track, a corresponding Mobile Runtime dispatch follow-on, the small canvas
  token-rendering follow-up, and the still-not-started Preview & Testing horizon). PR #991 merged
  (also carrying `APP-BUILDER-11`'s own post-merge documentation, pushed to the same still-open
  branch before that earlier docs-only content had merged): squash SHA
  `ac6c375f669adfbcb9dc301c8296c42d8506c4b3`, confirmed single-parent squash and zero content drift
  from the reviewed pre-merge head `9d0828d` via a path-restricted diff, post-merge CI green on the
  merge commit itself (`ci.yml` run `36009975210` sqlite+pgsql both success). `POST_MERGE_REVIEW:
  PASS`.

**AWJ App Builder Horizon V1 is CLOSED.** Per the horizon bootstrap's own "Horizon End" rule, this
session STOPS here — no automatic continuation to Preview & Testing or any new horizon.

## AWJ Mobile Runtime Proof Horizon V1 (closed) — execution log

## AWJ Mobile Runtime Proof Horizon V1 — execution log

- `MOBILE-RUNTIME-1` (Flutter workspace + toolchain proof) is **done**: `mobile/` created via `flutter create --platforms=android,ios` on Flutter `3.47.5` stable (Dart `3.13.4`) — the current stable release as of 2026-09-22, verified against `storage.googleapis.com/flutter_infra_release/releases/releases_linux.json`. `flutter analyze` reports 0 issues, `flutter test` 2/2 passing on a minimal placeholder shell (`lib/app.dart`/`lib/main.dart`) that defaults to Arabic + RTL via a plain `Directionality` override (full `flutter_localizations` deferred to `MOBILE-RUNTIME-6` per plan). No App Schema, Commerce API call, or screens yet — deliberately out of this task's scope. CI added (`.github/workflows/mobile-ci.yml`, `subosito/flutter-action@v2` pinned to the same exact version, `analyze` + `test` on `mobile/**` changes). No non-trivial dependency added (only `flutter create`'s stock `cupertino_icons`/`flutter_lints` defaults — reviewed in `mobile/README.md` per MR-19). Performance measurement method + provisional budgets recorded per MR-18: `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md`. **Owner-directed correction before merge:** the first draft's `sa.nebrax` Android/iOS identity and the shell's `'نبراس — AWJ Mobile Runtime'` UI text both carried the legacy `Nebrax` name into a durable product identity — corrected to `com.example.awjmobileruntimeproof` (Apple/Google's own placeholder-identity convention, since no canonical AWJ mobile namespace is documented anywhere — only the unrelated web tenant-subdomain domain `awj.app`) and `'أَوْج — AWJ Mobile Runtime'` respectively; the production Bundle/Application ID is recorded as an explicit open Decision Gate in `mobile/README.md`, not resolved by this task. PR #948 merged: Merge SHA `761d546c82b868850ed71889f49c8909dec0063b`, a confirmed single-parent squash onto `main` (`git log origin/main -1 --format='%P'` → `51a8068`), zero content drift from the reviewed head (`git diff` on all touched paths empty). Post-merge CI green on both required workflows for this exact `head_sha` — `ci.yml` run [35787428229](https://github.com/safwan5001-source/Nebrax/actions/runs/35787428229) and `mobile-ci.yml` run [35787428480](https://github.com/safwan5001-source/Nebrax/actions/runs/35787428480), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-1-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-2` (App Schema + compatibility kernel) is **done**: pure-Dart App Schema parser/validator + runtime-compatibility resolver under `mobile/lib/schema/` (`app_schema.dart`, `capability_manifest.dart`, `compatibility.dart`, `registry_identifiers.dart`, `schema_version.dart`). Strict key-allowlist JSON parsing rejects unknown fields (including a smuggled `tenantId` override, tested explicitly), malformed structure, and oversized/too-deep trees; a fixed `RuntimeCapabilities` component/action identifier registry (copied verbatim from horizon MR-04/MR-05) backs a fail-closed-by-default `CompatibilityResolver` (`optional: false` is the default — an unsupported *required* component/action fails the whole document closed; only an explicitly-optional node/subtree is safely omitted); `selectRollbackTarget` picks the newest schema a manifest can actually render, never an incompatible one. No new dependency (first-party ~50-line SemVer-lite comparator instead of a package, per MR-19). 35/35 tests passing (33 new: parser negatives, version-skew both directions, iOS/Android capability divergence, rollback selection), `flutter analyze` 0 issues. No accounting/tenant/API/DB code touched — pure offline Dart, not yet wired into the app shell (rendering/dispatch is `MOBILE-RUNTIME-3`). PR #950 merged: Merge SHA `12ae268ff0f60b6f7d1044d58bd87b4dcb01eb10`, a confirmed single-parent squash onto `main` (parent `12109a2`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `mobile-ci.yml` run [35798761468](https://github.com/safwan5001-source/Nebrax/actions/runs/35798761468) and `ci.yml` run [35798761453](https://github.com/safwan5001-source/Nebrax/actions/runs/35798761453), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-2-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-3` (Component + Action Registry) is **done**: typed Flutter Component Registry (`mobile/lib/registry/`) and typed Action Registry (`mobile/lib/actions/`) rendering/dispatching exactly the horizon's MR-04 (15 components) / MR-05 (6 actions) allowlists against the MOBILE-RUNTIME-2 kernel's output. Sealed `AppAction` hierarchy + `decodeAction(ActionRef)` returns `null` (never throws) for a type-supported-but-malformed action; `AppActionDispatcher` dispatches via an exhaustive switch to a typed `ActionHandler` (`NoopActionHandler` is the temporary default until MOBILE-RUNTIME-4/5 wires real Commerce effects — renamed from the more obvious `ActionDispatcher` after `flutter analyze` caught a name collision with Flutter's own `widgets.dart` class of that name). `ComponentRegistry.builders` covers exactly `RuntimeCapabilities.components` (enforced by a dedicated test, as is `decodeAction`'s coverage of `RuntimeCapabilities.actions`) — every prop accessor is defensive (never throws on a missing/wrong-typed value), `Image` accepts only `https://` URLs, money is shown via `formatMinorAmount` display-only (no arithmetic anywhere, consistent with CLAUDE.md's minor-units rule). `VariantSelector`/`Quantity` hold local ephemeral UI state per MR-06 — `VariantSelector` never dispatches, `Quantity` only requests a schema-bounded change. `ExperienceView` is the minimal glue rendering one `RenderableExperience` page through the registry. A deliberate scope boundary recorded in the report: `AddToCart` does not read a sibling `Quantity`'s live value — that cross-component wiring is deferred to MOBILE-RUNTIME-5's Product screen controller. No new dependency. 72/72 tests passing (37 new), `flutter analyze` 0 issues. No accounting/tenant/API/DB code touched — no Commerce API call, no real navigation, no localization yet. PR #952 merged: Merge SHA `b7637f3990702a2cd6277422493dae3eda3b3ced`, a confirmed single-parent squash onto `main` (parent `9d21705`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `ci.yml` run [35814402337](https://github.com/safwan5001-source/Nebrax/actions/runs/35814402337) and `mobile-ci.yml` run [35814402408](https://github.com/safwan5001-source/Nebrax/actions/runs/35814402408), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-3-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-4` (Commerce OpenAPI client + secure session boundary) is **done**: typed Dart client (`mobile/lib/commerce/`) for the tenant-facing `/commerce/v1` surface (`docs/openapi/commerce-api-v1.yaml`), scoped to Storefront/Catalog/Media (read), Cart (write, optional customer identity), and customer auth (register/login/OTP/logout/me) — what MOBILE-RUNTIME-5's Home/Product/Cart slice and MR-07 need. Checkout/payments/orders/addresses are explicitly out of scope (not on Gate C's bar or MR-05's action allowlist). `CommerceClient` is the only place a customer/cart token is ever seen in cleartext — every method reads/writes a new `SecureSessionStore` internally, no method returns a raw token, a `401` on a customer-tier call clears a stale token automatically, and `logoutCustomer` clears locally only after a successful server response (both outcomes tested). `CommerceTransport` is `dart:io HttpClient` directly (no HTTP package — MR-02's Android/iOS-only scope makes one unnecessary; kept as an interface so tests run against a scripted `FakeCommerceTransport`). One new dependency, `flutter_secure_storage: ^11.2.0` (iOS Keychain/Android Keystore-backed), with its MR-19 license/maintenance/platform/native-permission review recorded in the report (BSD-3-Clause, 160 pub points, Android `minSdkVersion` 24 already satisfies the package's minimum 23). `GET /products/{id}`'s `oneOf` response is modeled as a sealed `CommerceProductDetail` (`CommerceSimpleProduct`/`CommerceVariantManagedProduct`), discriminated by `is_variant_managed`. Response parsing is forward-compatible (unknown fields ignored, a trusted first-party server) but still defensive (every documented field type-checked, `CommerceProtocolException` on mismatch) — a deliberately different posture from MOBILE-RUNTIME-2's adversarial-input schema parser. 101/101 tests passing (29 new: 20 client + 5 model-parsing + 4 mocking `flutter_secure_storage`'s own method channel), `flutter analyze` 0 issues. No UI consumes this client yet. No accounting-affecting operation exists in this diff (no checkout/payment/order call implemented). PR #954 merged: Merge SHA `b645d33b84cfaa85266122f1ea0272c28ee79158`, a confirmed single-parent squash onto `main` (parent `2276fc6`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `ci.yml` run [35823026097](https://github.com/safwan5001-source/Nebrax/actions/runs/35823026097) and `mobile-ci.yml` run [35823026148](https://github.com/safwan5001-source/Nebrax/actions/runs/35823026148), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. **Continuation-mechanism finding recorded during this task** (applies horizon-wide): `ScheduleWakeup` fallback wake-ups did not reliably fire during this task's CI waits — the session sat idle past a scheduled wake time and was only resumed by an unrelated `SessionStart:resume` hook. Per owner instruction, the remainder of this horizon uses `subscribe_pr_activity` (event-driven) as the primary continuation trigger with `send_later`/`create_trigger` (`claude-code-remote` MCP server, which documents surviving container restarts) as the fallback instead of `ScheduleWakeup`. No architecture/infrastructure change was made to work around this — only which existing tool schedules the fallback check-in; the residual risk of both mechanisms failing to fire is not fully eliminated. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-4-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-5` (Home/Product/Cart vertical UI) is **done**: real Home/Product/Cart screens (`mobile/lib/app/`) wiring the App Schema/compatibility kernel (MOBILE-RUNTIME-2), Component/Action Registry (MOBILE-RUNTIME-3), and `CommerceClient` (MOBILE-RUNTIME-4) into the horizon's §5 vertical proof slice: boot → compatibility → Home from App Schema → live product list → Product screen (variant/quantity/availability) → Add to Cart → Cart read/update/remove. Home and Cart parse a real bundled App Schema (`kHomeSchemaJson`/`kCartSchemaJson`) resolved via `CompatibilityResolver`, with live Commerce data hydrated into declared empty "data slot" nodes (`experience_hydration.dart`'s `hydrateNode`) rather than any templating mechanism (MR-04 forbids remote expressions). Product deliberately bypasses schema parsing — it is single-instance/parameterized by whichever `productId` was tapped — and builds its `SchemaComponent` tree directly in Dart through the identical Component Registry/Action Dispatcher, a documented architecture asymmetry (see `product_screen.dart`'s own doc comment). `RuntimeActionHandler` replaces `NoopActionHandler`: cart-mutating actions call `CommerceClient` and only mark the cart changed *after* a successful response, with failures surfaced via a `SnackBar`. The MOBILE-RUNTIME-3-flagged "`Quantity` → `AddToCart` sibling wiring" gap is resolved by a screen-owned `_PurchasePanel` (schema props are JSON-safe scalars only, so no schema node can observe a sibling's live state) that dispatches one fully-populated `addToCart` action through the same typed `AppActionDispatcher`. No new dependency. 116/116 tests passing (15 new, including one end-to-end test driving the full Home→Product→Add to Cart→Cart→Remove flow against a fake `/commerce/v1` server), `flutter analyze` 0 issues. No accounting-affecting operation exists yet (no checkout/payment/order call). PR #956 merged: Merge SHA `5b2815a353bebc6a136ba682ef0b874f22c0e9ff`, a confirmed single-parent squash onto `main` (parent `226fde8`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `ci.yml` run [35831150418](https://github.com/safwan5001-source/Nebrax/actions/runs/35831150418) and `mobile-ci.yml` run [35831150445](https://github.com/safwan5001-source/Nebrax/actions/runs/35831150445), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. **Continuation-mechanism follow-up**: the `subscribe_pr_activity` + `send_later` combination (adopted during MOBILE-RUNTIME-4) worked reliably across this task's full PR lifecycle. One operational note: after a squash merge, the source branch's remote ref is never a fast-forward ancestor of the new squash commit, so resetting the local branch to `origin/main` for the next task always needs `--force-with-lease` on the next push (a plain push was rejected mid-task and immediately retried correctly). Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-5-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-6` (ar/en + RTL/LTR + theme/accessibility) is **done**: `AwjMobileRuntimeApp` (`mobile/lib/app.dart`) is now stateful, owning one `Locale` above `MaterialApp` — drives `MaterialApp.locale`/`localizationsDelegates`/`supportedLocales` and a locale-driven `Directionality`; `AwjRuntimeShell` gained an app-bar toggle that flips locale/direction at runtime and calls `CommerceClient.setLocale`, keeping every request's `Accept-Language` header aligned with the already-accepted server-side locale contract (`ADR-12-COMMERCE-API-LOCALE-RESOLUTION.md`, `COM-MOBILE-I18N-1`). A new `RuntimeStrings` class (`mobile/lib/app/runtime_strings.dart`) holds this runtime's own UI chrome text only (ar/en) — product names keep using the Commerce API's own bilingual `name`/`name_en` fields via `localizedProductName`, never a client-side re-translation of business data. Building the required large-text-resilience test surfaced two genuine MR-11 gaps, both fixed: `NavigationTarget`'s chevron was a direction-only glyph (now picks left/right from ambient `Directionality`), and `ProductList`'s fixed `height: 220` horizontal scroller overflowed real card content at an accessibility text scale (now a `Row` in a horizontal `SingleChildScrollView`, sized to actual content — a latent bug present since MOBILE-RUNTIME-3, not introduced here). One new dependency, `flutter_localizations` (Flutter SDK package, not pub.dev-versioned — no MR-19 review needed). 123/123 tests passing (7 new: locale toggle/direction/product-name switching, `Accept-Language` header verification, VoiceOver/TalkBack smoke proxy via `SemanticsTester`/`find.byTooltip`, large-text resilience, touch-target/focus sanity, direction-aware chevron), `flutter analyze` 0 issues. No accounting-affecting operation exists yet. PR #958 merged: Merge SHA `1dfce398a9efc1afccdb91b250015e2cf5c462d5`, a confirmed single-parent squash onto `main` (parent `ace1cff`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `mobile-ci.yml` run [35839084209](https://github.com/safwan5001-source/Nebrax/actions/runs/35839084209) and `ci.yml` run [35839084178](https://github.com/safwan5001-source/Nebrax/actions/runs/35839084178), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. **Flake investigated and confirmed during this task's post-merge docs follow-up:** an unrelated docs-only commit's `ci.yml` run hit one failure in the pre-existing `Tests\Feature\ZatcaQrCertificateMaterialExtractorTest` (random EC keypair generation with no fixed seed occasionally produces a leading-zero-byte coordinate mismatch); root-caused, confirmed not a regression (identical code had just passed on the merge SHA), and a single `rerun_failed_jobs` reproduced clean — no code change made. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-6-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-7` (Universal/App Links) is **done**: validated deep link navigation (MR-08). A pure-Dart `resolveDeepLinkUri`/`resolveDeepLinkString` (`mobile/lib/deeplink/deep_link_resolver.dart`) validates an incoming URL's scheme/host/path against a small allowlist and maps it to the exact same `navigate`/`openProduct` `ActionRef` shape every schema-driven tap already dispatches through `AppActionDispatcher` — structurally incapable of producing a destructive/sensitive action (no code path constructs one) and never reads query parameters (MR-07's "no tokens in deep-link query strings" satisfied structurally). `DeepLinkController` (`deep_link_channel.dart`) wires this to one platform channel (`awj/deep_links`); native Android (`MainActivity.kt`) and iOS (`SceneDelegate.swift`, this project's scene-based `FlutterSceneDelegate`) glue only ever forwards a raw URL string, validating nothing itself. A product link and a cart link (the "account-safe navigation link" MR-08 asks for) are both proven end-to-end, cold-start and warm-start, against the real running app. Uses a placeholder `.example` domain (RFC 2606), same convention as MOBILE-RUNTIME-1's Bundle ID — the real domain/hosting its `.well-known` association files is an explicit open Decision Gate. **Acknowledged risk, not a silent gap:** `mobile-ci.yml` only runs `flutter analyze`/`flutter test` — no Android/iOS native build exists until `MOBILE-RUNTIME-9`, so this task's Kotlin/Swift changes are not compiled/verified by any automated check in this environment. 151/151 tests passing (28 new: 19 resolver unit tests including malicious-host/oversized-id/destructive-action negatives, 6 platform-channel contract tests, 3 end-to-end navigation tests), `flutter analyze` 0 issues, no new dependency. PR #960 merged: Merge SHA `4929e9106e07c743a1c3814ae019064b2d625812`, a confirmed single-parent squash onto `main` (parent `efa7a18`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `mobile-ci.yml` run [35848544132](https://github.com/safwan5001-source/Nebrax/actions/runs/35848544132) and `ci.yml` run [35848543962](https://github.com/safwan5001-source/Nebrax/actions/runs/35848543962), both `conclusion: success` (the `pgsql` job ran unusually long, ~20min; confirmed actively progressing via `get_job_logs` mid-wait rather than assumed hung) — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-7-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-8` (Push adapter + notification routing proof) is **done**: proves a provider-agnostic push boundary and one safe notification-tap navigation path (MR-09). `PushAdapter` (`mobile/lib/push/push_adapter.dart`) is a pure Dart interface shaped like every major push provider's real delivery model (permission, token, cold/warm-start tap, foreground arrival) — nothing outside `lib/push/` may reference a vendor SDK type. `resolvePushPayload` maps a notification's `data` payload to the exact same `navigate`/`openProduct` `ActionRef` shape `resolveDeepLinkUri` already produces for deep links — structurally incapable of producing a destructive action. `PushController` dispatches only on a tap (`getInitialMessage`/`onMessageOpenedApp`), never on mere foreground arrival — arrival is not a command, the same principle MR-08 applies to deep links. `ChannelPushAdapter` is the one concrete adapter this task ships: a first-party `MethodChannel` (`awj/push`), **no vendor push SDK added anywhere** (`pubspec.yaml`, every Android `build.gradle*`, iOS `Podfile*` all diff-empty) — Firebase Cloud Messaging (or any provider) integration is left as an explicit, undecided Decision Gate per MR-09/MR-19/horizon §10, deliberately **not** adopted on this task's own initiative since doing so (a real Firebase project/credentials, a Gradle plugin, a CocoaPod wired into the release build) is exactly the "strategic dependency lock-in"/"permanent push/messaging vendor commitment" those rules require Safwan's approval for. Native Android (`MainActivity.kt`)/iOS (`AppDelegate.swift`) glue implements real, standard-library notification *permission* handling only (`POST_NOTIFICATIONS` runtime permission, `UNUserNotificationCenter.requestAuthorization`) — no push-transport SDK referenced anywhere; `getToken`/`getInitialMessage` are wired but return `null`, honestly inert until a provider is chosen. `CapabilityManifest` gained a `nativeCapabilities` namespace (`push.notifications`, default `const {}` so no existing manifest construction broke) so a schema can assert this routing capability as a prerequisite; a dedicated `compatibility_test.dart` group proves MR-15's native capability rollout ordering (a schema requiring a not-yet-shipped version, or targeting a platform manifest that hasn't shipped the capability at all, is rejected closed) and Gate F's iOS/Android divergence requirement (the identical schema is simultaneously renderable on one platform's manifest and incompatible on the other's, via the same synthetic-per-platform-manifest technique already established for `AddToCart`). **Acknowledged risk, not a silent gap:** identical to MOBILE-RUNTIME-7's precedent, `mobile-ci.yml` only runs `flutter analyze`/`flutter test` — the native permission-handling Kotlin/Swift code is not compiled/verified by this environment until `MOBILE-RUNTIME-9`. 190/190 tests passing (39 new: 11 payload-resolver unit tests, 13 platform-channel contract tests, 7 controller-lifecycle tests against a fake adapter, 4 end-to-end navigation tests, 4 capability-rollout-ordering tests), `flutter analyze` 0 issues, no new dependency. PR #962 merged: Merge SHA `9a1e45b90643bc81f4dbf5085cbaaeda2daf3213`, a confirmed single-parent squash onto `main` (parent `b20c9a1`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `mobile-ci.yml` run [35866715666](https://github.com/safwan5001-source/Nebrax/actions/runs/35866715666) and `ci.yml` run [35866715709](https://github.com/safwan5001-source/Nebrax/actions/runs/35866715709), both `conclusion: success` — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-8-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-9` (Android/iOS release-build proof) is **done**: proves horizon MR-12/Gate G's release-mode buildability requirement via two new `mobile-ci.yml` jobs. `android-release-build` (`ubuntu-latest`) runs `flutter build apk --release` + `flutter build appbundle --release`, using the stock `flutter create` template's debug-signed release `buildType` (`android/app/build.gradle.kts`, unchanged) — real Release-configuration builds within non-production credentials, never a production/store key. `ios-release-build` (`macos-latest`, new to this repo's mobile CI) runs `flutter build ios --release --no-codesign` — Gate G's "maximum non-signing level available": a real Release-configuration `Runner.app` with code signing skipped entirely, no Apple Developer account/certificate/provisioning profile anywhere. Both exact commands were already documented in `mobile/README.md` back in MOBILE-RUNTIME-1, labeled "(Gate G, task 9)". **This session's own Linux environment has no Android SDK and no Xcode**, so this PR's own CI run was the first real compile-time verification either build ever had — and it caught a genuine, pre-existing Swift compile bug in `AppDelegate.swift` (MOBILE-RUNTIME-8's `FlutterPluginRegistry.registrar(forPlugin:)` call needed an optional unwrap it was missing), fixed with a `guard let`. After the fix, both release-build jobs passed on both push and PR events — the first confirmed, real Gate G evidence for either platform. One `ci.yml` `pgsql` job separately hit the exact same known EC-keypair-generation flake already root-caused in MOBILE-RUNTIME-6's report (unrelated to this PR's CI-workflow/README/Swift-fix/docs-only diff); a single `rerun_failed_jobs` came back clean, confirming rather than dismissing the diagnosis. Both new jobs upload their build output as a CI artifact (`android-release-build` 70,202,189 bytes zipped APK+AAB; `ios-release-build` 7,032,678 bytes zipped `Runner.app`) so MOBILE-RUNTIME-10 (MR-18, release artifact/binary size) can measure real sizes without re-running either build. No Dart/Kotlin/Swift source touched beyond the one-line Swift fix; no new dependency; 190/190 tests still passing, 0 analyze issues. PR #964 merged: Merge SHA `4b8bc4fda04ff960da691f43d625dccda2c54eea`, a confirmed single-parent squash onto `main` (parent `3a3650b`), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `mobile-ci.yml` run [35881295286](https://github.com/safwan5001-source/Nebrax/actions/runs/35881295286) and `ci.yml` run [35881295172](https://github.com/safwan5001-source/Nebrax/actions/runs/35881295172), both `conclusion: success` (including both release-build jobs green on the merge commit itself) — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-9-IMPLEMENTATION-REPORT.md`.
- `MOBILE-RUNTIME-10` (Final compatibility/security/performance/runtime evidence + horizon closure) is **done — this closes AWJ Mobile Runtime Proof Horizon V1**: this was a session handoff from a prior session that hit its weekly usage limit mid-task; the new session verified the handoff checkpoint against live repository/GitHub state before proceeding (base SHA, PR #965 merge SHA, and "no MOBILE-RUNTIME-10 PR yet" were all independently confirmed, not trusted blindly) and preserved both owner decisions recorded in the handoff exactly. Four new standalone modules: `mobile/lib/startup/` (MR-14 last-known-good startup decision mechanism, `resolveStartup()`) and `mobile/lib/diagnostics/` (MR-17 diagnostic context + redaction) are real, thoroughly tested primitives with **zero production call site** (confirmed by grep) — per the preserved "prove the decision mechanism only" decision, no remote Published Experience fetch flow was invented and no wiring into the real Home/Cart startup path was made. `mobile/lib/commerce/resilient_transport.dart` (MR-16) adds per-request timeout + bounded retry to `CommerceClient`'s default transport, retried only for `GET` — a mutating request (`addToCart`, checkout, auth) always gets exactly one attempt, so a blind retry can never duplicate a side effect. `AwjRuntimeShell` gained a `WidgetsBindingObserver` (MR-16) that re-triggers the existing `refresh` action on a genuine background-resume transition. A Gate H audit found horizon §6's 13-fixture version-skew/rollback/compatibility matrix already 11/13 proven by MOBILE-RUNTIME-2/8's existing tests; this task's `startup/` module closes the remaining two (no-network startup with/without a compatible last-known-good). Per the preserved "document the limitation, measure what's device-independent" performance decision: real measurements for schema parse/resolve wall-clock (pure Dart, `Stopwatch`), `flutter analyze`/`test`, and release artifact sizes from this task's own fresh CI build (70,209,077 bytes zipped Android APK+AAB; 7,036,117 bytes zipped iOS `Runner.app`) — every device-backed metric (cold/warm `timeToFirstFrameMicros`, device-measured render, scroll/jank) is recorded as explicitly NOT MEASURED with the exact reason (no Android emulator/iOS Simulator/physical device in this environment; no such CI infrastructure was added, per explicit owner instruction not to provision one for this final proof task) rather than fabricated. One real bug caught during self-review before any external review: `resolveStartup`'s fresh-incompatible-fetch fallback originally mislabeled a specific cache failure reason as a generic "no cache" one — fixed, with a regression test. 252/252 tests passing (62 new, up from 190), `flutter analyze` 0 issues, no native (Kotlin/Swift) code touched. PR #966 merged: Merge SHA `95198157f1b64e0e437675d9c0e01f45479d776d`, a confirmed single-parent squash onto `main` (parent `beea79f`, this session's own verified base), zero content drift from the reviewed head. Post-merge CI green on both required workflows — `mobile-ci.yml` run [35899315030](https://github.com/safwan5001-source/Nebrax/actions/runs/35899315030) and `ci.yml` run [35899315224](https://github.com/safwan5001-source/Nebrax/actions/runs/35899315224), both `conclusion: success` (including both release-build jobs on the merge commit itself) — plus a targeted post-merge `flutter analyze`/`flutter test` smoke re-run, both green. `POST_MERGE_REVIEW: PASS`. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-10-IMPLEMENTATION-REPORT.md`. **Full horizon closure report** (Flutter viability conclusion, all 10 Merge SHAs, remaining Decision Gates, next recommended horizon): `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md`. Per the horizon's own closure rule, this session does **not** automatically start the next horizon (App Builder or otherwise) — that requires Safwan/ChatGPT review and authorization.

## Confirmed repository context

- Existing `docs/agent-workspace/` contains the earlier ChatGPT ↔ Claude orchestration protocol and operational evidence.
- Existing `.claude/AGENT_ORCHESTRATION.md` is the older orchestration entrypoint.
- The new `docs/autonomous-engineering/` layer is additive. It does not erase historical orchestration evidence.
- PR #887 (App Builder architecture + Commerce Mobile API readiness) is merged and post-merge reviewed; Merge SHA: `f43a8e0db36952f3007557fc127c3a6a28de0700`.
- PR #890 (Autonomous Engineering V1) is merged and post-merge reviewed; Merge SHA: `587ed50c152450ee8c354486648a75f31a3d24a6`.
- `COM-MOBILE-MEDIA-1` (mobile-authorized product media, `/commerce/v1/media/{id}`) is **done**: PR #911 merged and post-merge reviewed; Merge SHA: `8386ece721f3e6b37c9f2ff8db64f10e2b44d9c4`. Along the way it also fixed a pre-existing production defect (`disk = 'document'` media returning a 500) in the already-shipped `StorefrontMediaController` for `/store/v1`, discovered via automated review while building the mobile equivalent. Full evidence: `docs/plans/commerce/COM-MOBILE-MEDIA-1-IMPLEMENTATION-REPORT.md`.
- Docs-only follow-up PR #915 merged; Merge SHA: `c91f873276abdacafebd789f8bc953aea4690840`.
- `COM-MOBILE-VARIANTS-1` (variant/options/UOM mobile contract) is **done**: PR #916 merged and post-merge reviewed; Merge SHA: `40445016973d050963d25519ed15ba05e0de6b66`. Discovered backlog: alternate-unit (UOM) selection contract, needed by both `/store/v1` and `/commerce/v1`, not yet designed. Full evidence: `docs/plans/commerce/COM-MOBILE-VARIANTS-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-AUTH-1` evaluated for promotion and found **not ready**: `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md` (Accepted, 2026-09-09) fixes the conceptual identity boundary (Commerce Authentication Identity / Customer Account / ERP User / Partner stay distinct; tenant-scoped; ownership-based authorization) but explicitly lists as **non-decisions**: authentication framework/provider, SMS/OTP provider, password-vs-passwordless default, and token/session format. This is a genuine Decision Escalation Gate (Tenant/Auth architecture + potential paid third-party vendor commitment), not an evidence gap Claude can resolve — see Decision Escalation packet delivered to Safwan.
- Safwan resolved the Decision Escalation (`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`): support phone+OTP (primary) and email+password (alternative), provider-neutral OTP with no real vendor integrated yet. Recorded durably in `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`. `COM-MOBILE-AUTH-1` (customer mobile auth + profile) is **done**: PR #920 merged and post-merge reviewed; Merge SHA: `a8f83b170eb2f696541e9f4d48d3db407ab02dd5`. Reuses the existing, previously-unwired `/customer/v1` identity stack unmodified, extended into `/commerce/v1` via a new `X-Customer-Token` header + `AuthenticateCommerceCustomer` middleware, plus new OTP scaffolding. 24 focused tests + full `Customer|Commerce` regression green on SQLite and PostgreSQL (post two Codex review rounds that found and fixed 4 real issues: a dropped audit trail, a partner-linking dead-end for phone-only customers, an OTP-issuance concurrency race, and a shared-quota rate-limit gap — plus a fifth, self-found security fix closing an account-boundary leak via an unverified self-declared phone). One merge conflict against `main` (trivial import-ordering clash with a concurrently-merged PR) resolved before merge. Full evidence: `docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`.
- Safwan resolved both remaining Decision Escalations (owner decision, 2026-09-21):
  - **`COM-MOBILE-CART-IDENTITY-1-MERGE-POLICY`** — Merge policy (not claim-replace), recorded durably in `docs/plans/store/ADR-07-COMMERCE-CART-MERGE-POLICY.md`. `COM-MOBILE-CART-IDENTITY-1` promoted to `ready`.
  - **`COM-MOBILE-CUSTOMER-1-ADDRESS-SCHEMA`** — a dedicated `CustomerIdentity`-owned address table (not `Partner`), with Saudi-National-Address-aware fields, recorded durably in `docs/plans/store/ADR-08-COMMERCE-CUSTOMER-ADDRESS-SCHEMA.md`. Task split approved: `COM-MOBILE-CUSTOMER-1` retired, replaced by `COM-MOBILE-ORDER-HISTORY-1` and `COM-MOBILE-ADDRESSES-1`, both promoted to `ready`.
  - See `TASK-QUEUE.md` for full resolution detail.
- `COM-MOBILE-CART-IDENTITY-1` (guest → authenticated customer cart transition) is **done**: PR #924 merged and post-merge reviewed; Merge SHA: `dffe6c86017e88019a82fceb2b0214d8a895b332`. Implements ADR-07's Merge policy across both cart and checkout entry points. Went through 11 rounds of automated (Codex) review — every non-optional finding verified and fixed, except one ("merge carts before authenticated checkout completion") verified and explicitly declined with reasoning posted on its PR thread, since the literal fix would have orphaned the checkout being completed or violated the one-active-cart-per-customer invariant. 35 focused tests + full `Commerce|Customer|Storefront` regression: 931 passed/25 skipped on SQLite, 956 passed on PostgreSQL, 0 failed. Full evidence: `docs/plans/commerce/COM-MOBILE-CART-IDENTITY-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-ADDRESSES-1` (Commerce customer address book) is **done**: PR #929 merged and post-merge reviewed; Merge SHA: `482c33053a07cad8bdcf79790e6125e31d4db895`. Implements ADR-08: a dedicated `CommerceCustomerAddress` book owned by `CustomerIdentity` (not `Partner`), country-aware Saudi National Address validation, DB-enforced default-shipping/default-billing exclusivity, plus the deferred "select a saved address at checkout" feature (unblocked by CART-IDENTITY-1's `EstablishCommerceCustomerContextIfPresent`), copying field values in rather than storing a reference (Order Snapshot Rule). Went through 3 rounds of automated (Codex) review — all 8 findings across the 3 rounds verified and fixed (validation gaps, two concurrency races the earlier fixes themselves exposed, Saudi format/shape validation, and an order-snapshot region/additional_number propagation gap) — before Codex exhausted its review usage limit for this account, closing the review cycle. 17 + 4 focused tests + full `Commerce|Customer|Storefront` regression: 936 passed/25 skipped on SQLite, 961 passed on PostgreSQL, 0 failed. Full evidence: `docs/plans/commerce/COM-MOBILE-ADDRESSES-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-ORDER-HISTORY-1` (authenticated customer order history) is **done**: PR #932 merged and post-merge reviewed; Merge SHA: `1813c63721eaa1859566b5533c86a18df7a31679`. Closes `CommerceOrderService::createFromCheckout()`'s `CustomerContext`-sourcing gap (a confirmed order always had `customer_identity_id = null` before this, regardless of the completing bearer — both prior tasks' reports had flagged it). Adds `GET /commerce/v1/me/orders` (list) and `GET /commerce/v1/me/orders/{id}` (detail), both under the existing `X-Customer-Token` required-auth group, deliberately separate from the guest signed-reference order-status endpoint. Along the way, found and fixed a real shape-drift bug: `CommerceCheckoutController::complete()` kept its own independent copy of `CommerceOrderSerializer`'s shape that had already silently diverged — replaced with a direct call to the shared serializer. 10 new tests + full `Commerce|Customer|Storefront` regression: 946 passed on SQLite, 971 passed on PostgreSQL, 0 failed. This closes the full three-way split from the former `COM-MOBILE-CUSTOMER-1` — all three (`COM-MOBILE-CART-IDENTITY-1`, `COM-MOBILE-ADDRESSES-1`, `COM-MOBILE-ORDER-HISTORY-1`) are now `done`. Full evidence: `docs/plans/commerce/COM-MOBILE-ORDER-HISTORY-1-IMPLEMENTATION-REPORT.md`.
- A Decision/Evidence Packet was prepared for the five remaining rows (Payments, Shipping, Promotions, I18n, Vertical Slice), then **five decisions resolved by Safwan** (owner decision, 2026-09-22):
  - **`COM-MOBILE-PAYMENTS-PROVIDER`** (partially resolved) — `docs/plans/store/ADR-09-COMMERCE-PAYMENT-INTENT-V1-SCOPE.md`: implement ADR-04's Payment Intent boundary now, bounded to COD/Pay on Pickup (no vendor); wire the existing `PaymentMethodChannelAvailabilityService` in; no parallel ledger. Provider/vendor selection remains open. `COM-MOBILE-PAYMENTS-1` promoted to `ready`.
  - **`COM-MOBILE-SHIPPING-CARRIER`** (partially resolved) — `docs/plans/store/ADR-10-COMMERCE-SHIPPING-RATE-V1-SCOPE.md`: merchant-configurable shipping zones/rates now (server-authoritative, reuses Saudi National Address fields, replaces hardcoded `delivery_amount_minor = 0`); no carrier integration. Carrier selection remains open. `COM-MOBILE-SHIPPING-1` promoted to `ready`.
  - **`COM-MOBILE-PROMO-SCOPE`** (resolved — deferred) — `docs/plans/store/ADR-11-COMMERCE-PROMOTIONS-DEFERRAL.md`: explicitly out of scope for this horizon, a deliberate deferral. `COM-MOBILE-PROMO-1` marked `deferred`.
  - **`COM-MOBILE-I18N-FALLBACK-DEFAULT`** (resolved) — `docs/plans/store/ADR-12-COMMERCE-API-LOCALE-RESOLUTION.md`: shared `Accept-Language` resolver, `ar`/`en` supported, `ar` default, backward-compatible. `COM-MOBILE-I18N-1` promoted to `ready`.
  - **`COM-MOBILE-VERTICAL-SLICE-SCOPE`** (resolved) — `docs/plans/store/ADR-13-COMMERCE-MOBILE-VERTICAL-SLICE-PARTIAL-SCOPE.md`: a partial slice (guest + authenticated journeys, currently-merged capabilities only) + `/commerce/v1` OpenAPI contract accepted as its own deliverable now; full slice remains gated on Payments/Shipping landing. `COM-MOBILE-VERTICAL-TEST-1` promoted to `ready`.
  - Cross-cutting rule (no dedicated ADR): Payments/Shipping/locale/future-promotions are shared AWJ Commerce/platform authorities, reusable by Commerce Core, Web Storefront, Mobile, and future App Builder — never mobile-only business logic.
  - Messaging Foundation flag (no ADR, recorded as backlog): any customer-facing SMS/email/push need discovered while building Payments/Shipping must not become a feature-specific integration — record it for the future shared AWJ Messaging/Communications Foundation instead. A real SMS provider remains a separate, unscheduled decision.
  - No production vendor, credential, or external activation is authorized by any of these five decisions. See `TASK-QUEUE.md` for full resolution detail.
- `COM-MOBILE-I18N-1` (shared Accept-Language locale resolution) is **done**: PR #935 merged; Merge SHA: `220fffb2fb4bcdc9ce0819ae089b42d9e145af1f`. Implements `ADR-12`: `App\Support\CommerceLocale` (pure RFC 9110 §12.5.4 resolver, `ar`/`en`, `ar` default) + `App\Http\Middleware\ResolveCommerceLocale`, wired into the one shared route-registration middleware array both `CommerceApiServiceProvider` and `StorefrontApiServiceProvider` already use — one insertion point for `/commerce/v1` and `/store/v1` alike. Adds `Content-Language` response header only; fully backward compatible. 15 new tests; full `Commerce|Customer|Storefront` regression: 961 passed on SQLite, 986 passed on PostgreSQL, 0 failed. Full evidence: `docs/plans/commerce/COM-MOBILE-I18N-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-SHIPPING-1` (merchant-configurable shipping zones/rates) is **done**: PR #937 merged; Merge SHA: `5980ee4559632df134a268546e688d56e99e9217`. Implements `ADR-10`: `CommerceShippingZone` (`CompanyWide`) + `ShippingRateService` (city match, then region, then `0`), consumed identically by `/commerce/v1` and `/store/v1` via `CommerceCheckoutService`, which recomputes the amount from either `updateAddress()` or `updateDelivery()` (independently-orderable). Discovered and closed a deeper pre-existing gap: `commerce_orders` had no `delivery_amount_minor` column at all, so a resolved shipping charge was silently dropped at order creation even before this task — `CommerceOrderService::createFromCheckout()` now folds it into `total`. Merchant configuration via `commerce/workspace/shipping-zones` (RBAC `commerce.manage`, reused). Three rounds of automated (Codex) review, four findings all verified and fixed: a case-insensitive uniqueness race closed at the DB level (`match_value_normalized` + unique index, not just an app-level precheck), a `rate_amount_minor` cap plus — found only after that first fix — a genuine `bigint` overflow in the combined order total (guarded with a checked-arithmetic helper that fails closed rather than let PHP silently promote to `float`), a malformed-UUID 500 on the merchant routes, and a real billing-transparency gap in the live `/store/v1` storefront checkout (review stage/order summary were still showing a static "pending" placeholder for a charge already committed server-side — fixed to show the real amount). 18 new backend tests + storefront `pnpm test` (572 passed)/`tsc`/`biome`/`build`; full `Commerce|Customer|Storefront|BranchIsolationGuard` regression: 967 passed on SQLite, 992 passed on PostgreSQL, 0 failed. `POST_MERGE_REVIEW: PASS` (Merge SHA `5980ee4559632df134a268546e688d56e99e9217`): `main` confirmed to contain this commit as its own history (a squash merge, one commit — `git log --parents` shows a single parent `6be5d7d`, this session's standard merge method); post-merge CI on that exact SHA (triggered by the push-to-`main` event, a separate later workflow run from the PR's own pre-merge head check) re-ran and passed on all three required jobs — verified via the GitHub Actions API, runs [35724653563](https://github.com/safwan5001-source/Nebrax/actions/runs/35724653563) (sqlite+pgsql) and [35724653544](https://github.com/safwan5001-source/Nebrax/actions/runs/35724653544) (storefront), all `conclusion: success`; a subsequent focused `Commerce|Customer|Storefront|BranchIsolationGuard` regression from a branch based directly on that commit stayed green (997 passed on SQLite, 1007 passed on PostgreSQL, 0 failed, run 2026-09-22 while starting `COM-MOBILE-PAYMENTS-1`) — no unexpected integration change. (An earlier version of this evidence wrongly called this a non-squash 4-parent merge; corrected after Codex review caught the impossible ancestry on PR #938.) Full evidence: `docs/plans/commerce/COM-MOBILE-SHIPPING-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-PAYMENTS-1` (Payment Intent foundation, COD/Pay on Pickup) is **done**: PR #940 merged; Merge SHA: `b025f363c218c58096c70dba0ff0d74a7c6e7093`. Implements `ADR-04`'s `Commerce Order → Payment Intent → ... → Successful Settlement` boundary for the first time, bounded to `ADR-09`'s V1 scope: `CommercePaymentIntent` (`CompanyWide`) + `CommercePaymentIntentService`, `method` (`cod`/`pay_on_pickup`) derived from delivery method, never marked paid at creation. `payment_method_id` is an independent optional customer choice gated by the existing `PaymentMethodChannelAvailabilityService` (wired unchanged, ADR-09 §3) — made optional by necessity: `CashBankAccountService` seeds every default `PaymentMethod` with `available_online = false`, so requiring selection at completion broke 60 existing tests before being reverted to the optional design shipped here. New routes on both `/commerce/v1` and `/store/v1`: `GET payment-methods`, `PATCH checkout/payment`. One round of automated (Codex) review, three findings verified and fixed: completion didn't revalidate channel availability for an already-selected method (could accept a method disabled between selection and completion), `collect`/`cancel` weren't atomic (checked the caller's possibly-stale in-memory status instead of a locked DB row), and the empty-checkout response omitted the `payment` key the frontend now expects always-present. 19 backend tests + storefront `pnpm test` (573 passed)/`tsc`/`biome`/`build`/`check:locales`; full `Commerce|Customer|Storefront|BranchIsolationGuard` regression: 1001 passed on SQLite, 1011 passed on PostgreSQL, 0 failed. `POST_MERGE_REVIEW: PASS` (Merge SHA `b025f363c218c58096c70dba0ff0d74a7c6e7093`, Gate 11): confirmed as `origin/main`'s tip and a squash merge with single parent `7ada1392eedc245ba0077de6391121adc51dfd25`; its tree diffs identical to zero against the PR's pre-merge head `8218ee446995b46b3a5c66002c8d22590afe95de` for every changed path, confirming the squash preserved the reviewed content exactly; post-merge CI on this exact SHA passed on all three required jobs — verified via the GitHub Actions API, runs [35737658191](https://github.com/safwan5001-source/Nebrax/actions/runs/35737658191) (sqlite+pgsql) and [35737658229](https://github.com/safwan5001-source/Nebrax/actions/runs/35737658229) (storefront), all `conclusion: success`. Full evidence: `docs/plans/commerce/COM-MOBILE-PAYMENTS-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-VERTICAL-TEST-1` (ADR-13 partial-scope vertical slice: `/commerce/v1` OpenAPI contract + guest/authenticated journey tests) is **done**: three stacked PRs merged in sequence — #942 (1/3, contract, Merge SHA `b7d16ecb75808c3622d3c5782c451c21b71e0f0f`), #943 (2/3, guest journey, Merge SHA `c05c62e392f7f33fe57fcb1f8ff1fe97a1a66740`), #944 (3/3, authenticated journey, Merge SHA `b8e1a121f202eb9cb967bcb056092f8a2305a5c9`), each a confirmed single-parent squash merge (`git log --parents`). The task's real scope (31 routes, ~10 resource types with genuinely conditional shapes) proved disproportionately large mid-task; two explicit questions were put to Safwan via `AskUserQuestion` rather than silently grinding or cutting corners — **"full field-level rigor"** (match `PublicApiOpenApiContractTest`'s own convention exactly) and **"split into 3 PRs"** (contract → guest journey → authenticated journey, each reviewed/merged before the next). Both journeys incorporate Shipping (ADR-10) and Payments (ADR-09) per ADR-13 §5's own incremental-extension instruction. Discovered and closed two real pre-existing bugs: `CommerceCustomerAddressController` had no `rejectUnknown()` guard (an undocumented field was silently accepted, not rejected); `CommerceCheckoutService::emptyResponse()`'s address block was missing `building_no`/`additional_number`, violating the endpoint's own documented invariant. Three rounds of automated (Codex) review across the stack found and fixed 7 real findings total (an `allOf`/`additionalProperties:false` schema incompatibility, a wrong-schema `Order.payment` reference, an undocumented optional `X-Customer-Token` parameter, a non-nullable `Cart.status` contradicting its own `emptyResponse()`, the two bugs above, plus — on a second review pass of the contract test's own newly-written recursive schema validator — a null-handling gap and a `$ref` type-checking gap, whose proper fix then surfaced two further genuine schema-accuracy bugs, `unit_name` wrongly typed non-nullable). Codex then reported its review-usage limit exhausted for this account. Final `Commerce|Customer|Storefront|BranchIsolationGuard` regression: 1036 passed on SQLite, 1046 passed on PostgreSQL, 0 failed. `POST_MERGE_REVIEW: PASS` on the final merge (Gate 11): `main` confirmed to contain `b8e1a12` as its tip; post-merge CI on that exact SHA passed — verified via the GitHub Actions API, run [35763886208](https://github.com/safwan5001-source/Nebrax/actions/runs/35763886208), `conclusion: success`. **This closes the entire currently-authorized Commerce Mobile API readiness horizon** — Payments, Shipping, I18N, and the Vertical Slice are all `done`; `COM-MOBILE-PROMO-1` remains explicitly `deferred` (ADR-11). No row in the Commerce Mobile prerequisites table remains `ready`. Full evidence: `docs/plans/commerce/COM-MOBILE-VERTICAL-TEST-1-IMPLEMENTATION-REPORT.md`.

## Current execution horizon

- Horizon: **AWJ App Builder Horizon V1** — **ACTIVE** (authorized 2026-09-23).
  Source: `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1.md`, launched via
  `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1_BOOTSTRAP.md`. Starts from
  `main@4010305be21d63f7249fa7c1fd287f60e2fa720a` (merged PR #968, "docs:
  authorize AWJ App Builder Horizon V1"). The prior AWJ Mobile Runtime Proof
  Horizon V1 (below) is fully closed and is this horizon's accepted input/
  execution layer, not something it reopens.
- First executable task: `APP-BUILDER-1` (Domain/persistence foundation) —
  **done** (PR #969, Merge SHA `0560429`). Full evidence: "AWJ App Builder
  Horizon V1" log above, `docs/plans/app-builder/APP-BUILDER-1-IMPLEMENTATION-REPORT.md`.
- Second executable task: `APP-BUILDER-2` (Schema validation + runtime
  capability contract) — **done** (PR #971, Merge SHA `8844881`). Full
  evidence: "AWJ App Builder Horizon V1" log above,
  `docs/plans/app-builder/APP-BUILDER-2-IMPLEMENTATION-REPORT.md`.
- Third executable task: `APP-BUILDER-3` (Component/Action/Data Resource
  registries) — **done** (PR #973, Merge SHA `4256d0a`). Full evidence:
  "AWJ App Builder Horizon V1" log above,
  `docs/plans/app-builder/APP-BUILDER-3-IMPLEMENTATION-REPORT.md`.
- Fourth executable task: `APP-BUILDER-4` (App Manager + creation wizard) —
  **done** (PR #975, Merge SHA `163bcc1`; docs follow-up PR #976, Merge SHA
  `ca20ae4`). First App Builder frontend slice — UI/UX Evidence Pass
  completed before implementation. Full evidence: "AWJ App Builder Horizon
  V1" log above, `docs/plans/app-builder/APP-BUILDER-4-IMPLEMENTATION-REPORT.md`.
- Fifth executable task: `APP-BUILDER-5` (Builder workspace shell) —
  **done** (PR #977, Merge SHA `f48d583`). Read-only workspace shell
  (Pages/Layers, canvas, Inspector, locale/device
  controls) — its own focused UI/UX Evidence Pass completed before
  implementation; all editing interactivity deferred to `APP-BUILDER-6` per
  the task-queue split. Full evidence: "AWJ App Builder Horizon V1" log
  above, `docs/plans/app-builder/APP-BUILDER-5-IMPLEMENTATION-REPORT.md`.
- Sixth executable task: `APP-BUILDER-6` (Visual editing + history) —
  **done** (PR #979, Merge SHA `08c143b`).
  Turned the read-only shell into a real editor (select/add/remove/reorder,
  inline property/action editing, bounded undo/redo, explicit save) — its
  own focused UI/UX Evidence Pass completed before implementation, judged
  necessary since it introduces the workspace's first destructive/undoable
  actions and first form inputs. Full evidence: "AWJ App Builder Horizon
  V1" log above, `docs/plans/app-builder/APP-BUILDER-6-IMPLEMENTATION-REPORT.md`.
- Seventh executable task: `APP-BUILDER-7` (Data/Actions/Conditions/
  Visibility, Develop mode) — **decision_required**, explicitly deferred
  (not completed, not permanently skipped). Evaluated for implementation
  and found not ready: three of its four named concepts have no backing in
  the accepted App Schema contract, and building them would mean inventing
  an expression/condition engine or a Data Source Registry contract — both
  explicitly "not yet locked" per the architecture doc. Owner decision
  (2026-09-24, option 2): defer and continue the horizon; return to
  APP-BUILDER-7 through its own dedicated architecture/evidence decision
  before implementation. Full evidence:
  `docs/autonomous-engineering/TASK-QUEUE.md`.
- Eighth executable task: `APP-BUILDER-8` (Theme + Use My Store Design) —
  **done** (PR #983, Merge SHA `1248223`). Dependency check confirmed no
  real runtime/schema dependency on `APP-BUILDER-7` (its content operates
  entirely on the App Schema's `theme.tokens` field and Store Customizer's
  existing theme data, never on `SchemaComponent`-level Actions/Conditions/
  Visibility/Data); promoted to `ready` on `APP-BUILDER-6` alone, then
  implemented: a Theme tab (manual editing + "Use My Store Design"
  Detect/Diff/Preview/Apply sync), its own focused UI/UX Evidence Pass
  completed before implementation. Full evidence: "AWJ App Builder Horizon
  V1" log above, `docs/plans/app-builder/APP-BUILDER-8-IMPLEMENTATION-REPORT.md`.
- Ninth executable task: `APP-BUILDER-9` (Templates + navigation/pages) —
  **done** (PR #985, Merge SHA `c054c9c`). Dependency check confirmed no
  real runtime/schema dependency on `APP-BUILDER-7`, and — unlike it — no
  new App Schema contract required at all (`AppSchemaParser::validate()`
  already enforces the full "system page constraint" surface); promoted
  to `ready` on `APP-BUILDER-8` alone, then implemented: Pages-tab
  add/remove/set-home, a real page picker for the `navigate` action's
  `pageId` param, and a small curated template set (Blank, Catalog) in the
  creation wizard, its own focused UI/UX Evidence Pass completed before
  implementation. Full evidence: "AWJ App Builder Horizon V1" log above,
  `docs/plans/app-builder/APP-BUILDER-9-IMPLEMENTATION-REPORT.md`.
- Tenth executable task: `APP-BUILDER-10` (Validate/Publish/Version/Rollback
  foundation) — **done** (PR #988, squash SHA `b69f9812`). Dependency check
  confirmed no real runtime/schema dependency on `APP-BUILDER-7` — the first
  task this horizon touches backend files since `APP-BUILDER-2`: a
  validate-only endpoint refactored out of `publish()`'s existing checks, a
  Publish dialog in the Builder workspace header, and a
  `/app-builder/[id]/versions` page with a "Restore to draft" action that
  never auto-publishes, its own focused UI/UX Evidence Pass completed before
  implementation. Full evidence: "AWJ App Builder Horizon V1" log above,
  `docs/plans/app-builder/APP-BUILDER-10-IMPLEMENTATION-REPORT.md`.
- Eleventh executable task: `APP-BUILDER-11` (Integrated vertical proof +
  UX/security closure) — **done** under an owner-redefined scope (PR #990,
  squash SHA `a7a2e0c3`). The original task-11 line ("bind real Commerce
  resource... proven Flutter runtime consumes") was found not satisfiable
  inside the accepted, tested contract and escalated; redefined as an
  Integrated Proof of the currently accepted and actually implemented App
  Builder contract, delivered as one new test file proving the full real
  lifecycle (create → edit → theme sync from a real store → pages/navigation
  → Validate → Publish → immutable version → restore → revalidate → publish
  again) plus tenant/RBAC/deferred-boundary evidence, with zero production
  code changed. The real-Commerce-binding/live-runtime portion of the
  original intent is carried forward as a deferred/`decision_required`
  follow-up track alongside `APP-BUILDER-7`, into `APP-BUILDER-12`'s closure
  report. Full evidence: "AWJ App Builder Horizon V1" log above,
  `docs/plans/app-builder/APP-BUILDER-11-IMPLEMENTATION-REPORT.md`.
- Remaining task `APP-BUILDER-12`: see
  `docs/autonomous-engineering/TASK-QUEUE.md` for the full dependency-ordered
  table and promotion evidence.
- Implementation merge: standing authority after mandatory final-head
  pre-merge review, required green CI, no unresolved Decision Gate, and
  mandatory post-merge review.
- Deploy / production release / destructive production operation / App
  Factory / signing / store submission: not authorized without Safwan's
  explicit approval — explicitly out of this horizon's scope per its own
  document.

### Previous (closed) horizon — AWJ Mobile Runtime Proof Horizon V1

- Horizon: **AWJ Mobile Runtime Proof Horizon V1** — **CLOSED** (2026-09-23).
  Source: `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md`,
  launched via `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_BOOTSTRAP.md`.
  Starts from `main@51a80685289aecdc7354ebcd8d1a32a2c92ac449` (merged PR
  #947, "docs: authorize AWJ Mobile Runtime Proof Horizon V1"). The prior
  Commerce Mobile API readiness closure V1 horizon (below) is fully closed
  and is this horizon's accepted input, not something it reopens.
- First executable task: `MOBILE-RUNTIME-1` (Flutter workspace + toolchain
  proof) — **done** (PR #948, Merge SHA `761d546`).
- Second executable task: `MOBILE-RUNTIME-2` (App Schema + compatibility
  kernel) — **done** (PR #950, Merge SHA `12ae268`).
- Third executable task: `MOBILE-RUNTIME-3` (Component + Action Registry) —
  **done** (PR #952, Merge SHA `b7637f3`).
- Fourth executable task: `MOBILE-RUNTIME-4` (Commerce OpenAPI client +
  secure session boundary) — **done** (PR #954, Merge SHA `b645d33`).
- Fifth executable task: `MOBILE-RUNTIME-5` (Home/Product/Cart vertical UI)
  — **done** (PR #956, Merge SHA `5b2815a`).
- Sixth executable task: `MOBILE-RUNTIME-6` (ar/en + RTL/LTR + theme/
  accessibility) — **done** (PR #958, Merge SHA `1dfce39`).
- Seventh executable task: `MOBILE-RUNTIME-7` (Universal/App Links) —
  **done** (PR #960, Merge SHA `4929e91`).
- Eighth executable task: `MOBILE-RUNTIME-8` (Push adapter + notification
  routing proof) — **done** (PR #962, Merge SHA `9a1e45b`).
- Ninth executable task: `MOBILE-RUNTIME-9` (Android/iOS release-build
  proof) — **done** (PR #964, Merge SHA `4b8bc4f`).
- Tenth executable task: `MOBILE-RUNTIME-10` (Final compatibility/
  security/performance/runtime evidence + horizon closure report) —
  **done** (PR #966, Merge SHA `9519815`). This was the horizon's final
  task (§8 row 10). **This closes AWJ Mobile Runtime Proof Horizon V1.**
  Full evidence: "AWJ Mobile Runtime Proof Horizon V1" log above,
  `docs/plans/mobile/MOBILE-RUNTIME-10-IMPLEMENTATION-REPORT.md`, and the
  full closure report
  `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md`.
  Per the horizon's own closure rule (`AWJ-HORIZON-SYSTEM.md` §"إغلاق
  الأفق"), this session does not automatically start a new horizon —
  continuation (e.g. App Builder) requires Safwan/ChatGPT review of the
  closure report and explicit authorization of the next horizon.

### Previous (closed) horizon — Commerce Mobile API readiness closure V1

- Horizon: Commerce Mobile API readiness closure V1.
- First executable task: `COM-MOBILE-MEDIA-1` — **done**.
- Second executable task: `COM-MOBILE-VARIANTS-1` — **done**.
- Third executable task: `COM-MOBILE-AUTH-1` — **done**.
- Fourth executable task: `COM-MOBILE-CART-IDENTITY-1` — **done**.
- Fifth executable task: `COM-MOBILE-ADDRESSES-1` — **done**.
- Sixth executable task: `COM-MOBILE-ORDER-HISTORY-1` — **done**.
- Seventh executable task: `COM-MOBILE-I18N-1` — **done**.
- Eighth executable task: `COM-MOBILE-SHIPPING-1` — **done**.
- Ninth executable task: `COM-MOBILE-PAYMENTS-1` — **done**.
- Tenth executable task: `COM-MOBILE-VERTICAL-TEST-1` — **done**.
- No candidate remains `ready` — the authorized Commerce Mobile API readiness horizon is fully closed. `COM-MOBILE-PROMO-1` is `deferred` (ADR-11) — explicitly out of scope, not pending. Continuation requires a new owner-authorized horizon or task.
- Implementation merge: standing authority after mandatory final-head pre-merge review, required green CI, no unresolved Decision Gate, and mandatory post-merge review.
- Deploy / production release / destructive production operation: not authorized without Safwan's explicit approval.

## Completed in this layer

- Start-here/source-of-truth order.
- Autonomous engineering protocol.
- Decision escalation rules.
- Quality gates.
- Master execution-plan format and initial Commerce Mobile horizon seed.
- Durable current-state convention.
- Durable queue convention.
- ADR convention.
- Implementation report convention.
- Claude autonomous entrypoint/bootstrap.
- Legacy orchestration compatibility/mode selection.
- Standing merge authority with review/CI/Decision Gate safeguards.

## Authorization boundary

Authorized (current horizon: AWJ App Builder Horizon V1):
- sequential implementation work required to satisfy the documented App Builder V1 task queue
  (`APP-BUILDER-1` through `APP-BUILDER-12`) and its Definition of Done;
- only tasks promoted to `ready` after current-main dependency/evidence validation;
- routine engineering choices inside each task's documented outcome/invariants;
- focused UI/UX Evidence Pass + AWJ Design System conformance for each major Builder UI slice, per
  the horizon document's mandatory workflow.

Not authorized:
- App Factory / build farm, Apple/Google signing/account ownership, App Store/Google Play
  submission/release, production rollout — explicitly out of this horizon's scope;
- deploy or production release;
- destructive production operations;
- silent resolution of material accounting/payment/auth/tenant/security/strategic decisions;
- arbitrary-code/plugin/runtime execution in the App Schema;
- material scope expansion outside this horizon (e.g. Preview & Testing infrastructure, broad
  Store Customizer redesign — both explicitly out of scope per the horizon document).

## Resume rule

A future agent should:
1. verify this file against the actual PR/branch/repository state;
2. correct stale factual metadata rather than trusting it blindly;
3. read the active queue item;
4. continue only within its authorized horizon.

---

## AWJ App Builder — Commerce Data & Dynamic Runtime V1 (new horizon, Phase 1)

LAST_UPDATED: 2026-09-24
STATUS: **Decision Gate approved (Option A, with amendments) — ADR-01 recorded, horizon ACTIVE.**
See `docs/plans/app-builder/ADR-01-APP-BUILDER-COMMERCE-DATA-RUNTIME-V1.md` for the full decision
record. Implementation is now authorized and in progress; see `TASK-QUEUE.md` for live task status.

Owner decision (2026-09-24): Option A adopted. Decision Point 1 = **YES** — the live Published
Schema → fetch → verified on-device cache / Last Known Good loop is in scope and required for this
horizon. Decision Point 2 = **EXCLUDE** `commerce.customer.profile`/`commerce.orders` from V1.
Conditions/Visibility stays closed, typed, and allowlisted — no expression language, eval, or
arbitrary JS/HTTP/GraphQL/SQL. `commerce/v1` is confirmed as the mobile App Builder commerce API
contract; Storefront Web and Mobile App remain presentation channels over the same authoritative
AWJ Commerce Core. Amendment: the current build-time `COMMERCE_STORE_BEARER_TOKEN` mechanism is
current-state evidence, not a locked architecture assumption — credential provisioning/rotation/
revocation is an explicit future App Factory/security-lifecycle boundary, not in scope here.
`APP-BUILDER-21` (UX/localization) and `APP-BUILDER-22` (theme rendering gap) are mandatory horizon
deliverables, not optional follow-ons.

Owner-issued mission continues Horizon V1's connected deferred track (`APP-BUILDER-7` +
`APP-BUILDER-11`'s real-Commerce-binding clause): lock a Data Resource Registry contract, connect
App Builder components to real AWJ Commerce data, implement constrained Conditions/Visibility,
implement real Commerce runtime dispatch, prove the mobile experience shares one Commerce Core with
the AWJ Store, complete an App Builder UX/localization pass, and close the theme-token canvas
rendering gap.

## Execution log

`APP-BUILDER-13` (Data Resource Registry V1 foundation) is **done**: PR #993 merged (squash Merge
SHA `ed6c485b317a15a67a742db1ae2c05b1f4e44ea0`, confirmed single-parent squash onto `main`, parent
`7e41f97`), post-merge CI green (`ci.yml` sqlite+pgsql both `success`). This PR also carried the
horizon's Phase 1 evidence pack and `ADR-01` as earlier commits on the same branch. Populated
`DataResourceRegistry::RESOURCES` with the ADR-01-locked V1 scope (`commerce.categories`,
`commerce.products`, `commerce.cart`), each field/filter/sort/pagination/auth requirement read
directly off the real `commerce/v1` controllers, not invented; new `ResourceDefinition`/
`ResourceFieldDefinition`/`ResourceFieldType`/`ResourceQueryParamDefinition` classes mirror the
existing `ComponentDefinition`/`PropDefinition`/`PropType` pattern. Purely descriptive metadata —
`AppSchemaParser`/`CompatibilityResolver` untouched (`APP-BUILDER-14`'s job). CI caught one real
pre-merge regression: `AppBuilderIntegratedProofTest`'s `APP-BUILDER-11` boundary assertion (that
`DataResourceRegistry::RESOURCES` stays empty) needed updating for the now-intentionally-populated
registry — fixed in the same PR; the still-valid "`bindings` key structurally rejected" assertion in
that same test was left unchanged. 10 new focused tests (`DataResourceRegistryTest`) + full
`AppBuilder*` regression green. No accounting impact. `APP-BUILDER-14` promoted to `ready`. Full
evidence in `TASK-QUEUE.md`'s horizon section.

Durable records for this phase:
- `docs/plans/app-builder/AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_BOOTSTRAP.md` — mission record.
- `docs/plans/app-builder/AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` — full evidence pass
  (backend App Builder contract, Flutter mobile runtime, real `commerce/v1` API surface, Builder UX
  localization gap, theme-token rendering gap), external evidence (Shopify, Builder.io,
  server-driven-UI "Blueprint" pattern, Apple/Google downloaded-code policy), proposed architecture
  for the Data Resource Registry / App Schema binding / Conditions-Visibility / real dispatch /
  mobile resolution pipeline / versioning, an Update/Release Matrix, Same-Store Proof plan,
  Security/Tenant-Isolation and backward-compatibility analysis, and the open Decision Escalation
  Packet (`ADR-APP-BUILDER-COMMERCE-RUNTIME-V1-01`).

Key evidence findings (see the evidence doc for full citations):
- `DataResourceRegistry::RESOURCES` is a deliberate empty stub today; the schema contract's closed
  key-list structurally forbids `binding`/`condition`/`visibility` keys — confirms `APP-BUILDER-7`'s
  original deferral was correct, not overcautious.
- The already-closed Mobile Runtime horizon independently built **real** `commerce/v1` data
  fetching and **real** cart-action dispatch (`RuntimeActionHandler`) — but entirely through
  hand-written per-screen Dart code (`home_screen.dart`/`product_screen.dart`/`cart_screen.dart`),
  never through the schema. The backend App Builder contract's `DISPATCH_PROVEN_NOOP` label
  describes the schema/canvas contract only, not the shipped runtime, which already dispatches real
  commerce actions outside that contract.
- `commerce/v1` (contract at `docs/openapi/commerce-api-v1.yaml`) is the one real API surface to
  bind to — not `store/v1`, and not the still-Spree-transitional `storefront/` app.
- No live publish → fetch → on-device-cache loop exists for the mobile runtime
  (`mobile/lib/startup/last_known_good.dart` is a fully designed, unit-tested decision mechanism
  with zero real I/O wired) — flagged as the evidence doc's Decision Point 1, since without it any
  new binding/visibility mechanism only ever runs against a schema baked into a native build.

**Owner clarification (2026-09-24, `ADR-01` amendment, PR #995 merged, squash Merge SHA
`fbccc252d0d75109279ce03fad65ed3bd2677226`)**: Storefront Web feature/UI completeness is never a
prerequisite for App Builder/Mobile Runtime work — the two channels share Commerce truth (`commerce/v1`),
not a release schedule. A missing Commerce capability is recorded as an explicit gap, never
substituted with an app-specific invention; escalate only if it blocks this horizon's approved
scope. Binding on `APP-BUILDER-15`..`23`.

`APP-BUILDER-14` (App Schema binding contract) is **done**: PR #994 merged (squash Merge SHA
`57d474e8042466afa52e0f76773f5b57eee7f3bd`, confirmed single-parent squash onto `main`, parent
`fbccc25`). Adds the optional `binding` component-node key to `AppSchemaParser` (closed sub-shape:
`resource`/`query`/`itemProps`, JSON-safe only) and resolves it in `CompatibilityResolver` via the
same optional-prune/required-fail-closed mechanism already used for `type`/`action.type` — unknown
resource, a component not registered to bind it (`ComponentRegistry::bindableResources`), an
`itemProps`/`query` key the resource doesn't expose, or a runtime not yet declaring the resource
(`CapabilityManifest::resourceVersion()`) are all "unsupported". `RuntimeCapabilities::DATA_RESOURCES`
stays deliberately empty — no Flutter Runtime consumes a real binding yet — so every binding today
correctly fails at publish time until `APP-BUILDER-17` updates this constant **and**
`mobile/lib/schema/registry_identifiers.dart` together, with real CI-verified Dart changes (this
session has no Flutter SDK to verify Dart locally, so that mirroring is correctly deferred rather
than pushed unverified). Fixed one real design gap found during implementation: `itemProps`
prop-key validation only applies when the bound component declares its own props
(`ProductDetail`/`CartSummary`) — `ProductList`/`CartList` are pure containers with no props of
their own, so only their resource-field validation applies. 37 new/updated tests, full `AppBuilder*`
regression green. No accounting impact. `APP-BUILDER-16` (Conditions/Visibility) is `in_progress`,
independent of `APP-BUILDER-15`/`17`.

`APP-BUILDER-16` (backend schema/compatibility contract) is **done**: PR #996 merged (squash Merge
SHA `22156e493ef830a34a372b5c74643ab20e37632f`, confirmed single-parent squash onto `main`, parent
`57d474e`). Adds the optional `visibility` component-node key (`ADR-01` §3.3): a closed, typed
condition tree (`all`/`any` combinators or a `{signal, operator, value?}` leaf), bounded depth/
branch count, no expression engine. New `VisibilitySignal`/`VisibilityOperator` closed vocabularies.
`CompatibilityResolver` resolves it through the same optional-prune/required-fail-closed mechanism
as `type`/`action.type`/`binding`; `RuntimeCapabilities::SCHEMA_FEATURES` stays deliberately empty
until `APP-BUILDER-17` (same reasoning as `DATA_RESOURCES`). Visibility is presentation-only by
construction — no authorization touched. 46 new tests, full regression green. Inspector UX for
authoring conditions deferred to land with `APP-BUILDER-15`'s binding editor (not silently dropped
— both are the same Inspector surface with no backend dependency blocking either). No accounting
impact.

`APP-BUILDER-21` (UX/localization) and `APP-BUILDER-22` (theme-token canvas/runtime rendering fix,
`AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` §11) are **done**: PR #997 merged (squash Merge SHA
`8dbff6fbd197f5a5b1ba47ce398a6792ecd90db5`, confirmed single-parent squash onto `main`, parent
`22156e4`).

`APP-BUILDER-21`: adds a `Label(ar, en)` value object to every `ComponentRegistry`/`ActionRegistry`
definition and every prop/action-param (15 components, 6 actions), serialized by
`AppBuilderRegistryController` alongside the existing `bindable_resources`. No schema identifier
renamed anywhere — `type`/prop keys/action-param keys are unchanged, so published experiences and
the `commerce/v1`/binding contracts are untouched. Frontend: a shared `registryLabel(label, locale)`
helper (`web/src/lib/app-builder.ts`) renders the localized label in the Inspector (prop rows,
action-param rows, action-type select, add-child select) and the LayersTree node badges; raw
identifiers are preserved everywhere as `title` tooltips for merchants/developers who need the
underlying key. The Canvas type-tag badge uses the actual UI locale (`useLocale()`) rather than the
content-preview locale toggle — a real distinction found during implementation: the badge is Builder
chrome, not simulated storefront content. Backend: `ComponentRegistryTest`/`ActionRegistryTest`
assert label completeness (non-empty `ar`+`en`) on every definition/prop/param;
`AppBuilderRegistryTest` asserts HTTP exposure. Frontend: full `app-builder.test.ts` + builder
`page.test.tsx` suites updated to assert localized rendering. No accounting impact — UI/localization
only, no new financial postings.

`APP-BUILDER-22`: `tailwind.config.ts`'s `borderRadius.DEFAULT` stays a fixed `0.5rem` on purpose (it
backs the bare `rounded` class used across ~286 files app-wide; making it var-driven would break
every screen outside the Builder wherever `--canvas-radius` is unset). Instead, an additive `canvas`
radius scale value (`rounded-canvas` → `var(--canvas-radius, 0.5rem)`) was added — zero blast radius
anywhere it isn't explicitly used, verified by the full frontend suite staying green (2076/2076)
after the change. `canvas.tsx`'s `themeCssVars()` now sets `--canvas-radius` from
`theme.tokens.radius` (via the same `RADIUS_PRESETS`/`radiusToken` already used by
`theme-panel.tsx`), and the merchant-content elements that previously used bare `rounded`
(`Quantity`'s +/- controls, `AddToCart`, the generic `Button` component) now use `rounded-canvas`.
Builder chrome (`NodeFrame`'s selection ring, `TypeTag`'s badge) is deliberately left on the editor's
own fixed `rounded` — it isn't merchant content. On the Flutter side: `theme.tokens` was already
parsed and validated (`MOBILE-RUNTIME-2`) but nothing ever read it — `ThemeData` used an unrelated
hardcoded literal. `app.dart` gains a pure, defensive `themeSeedColorFromSchema(String)` (same
"malformed input never crashes boot, falls back to the safe default" posture as
`component_widgets.dart`'s prop reads) that reads `theme.tokens.colorPrimary` from the bundled
`kHomeSchemaJson` and seeds `ThemeData.colorSchemeSeed` with it — replacing the previous disconnected
literal. Deliberately scoped to what the runtime's *current* architecture actually supports today:
the mobile runtime still boots from a compile-time-bundled schema constant (the live publish → fetch
→ cache loop is `APP-BUILDER-19`, not yet built), so there is no live-fetched schema to thread
through `MaterialApp`'s root state yet. No new theme token key was introduced (`colorPrimary` is the
only one the bundled schema already carries) — "no token redesign," per the evidence. 5 new focused
tests (`theme_seed_test.dart`) plus one widget-level assertion in `widget_test.dart` that
`Theme.of(context).colorScheme.primary` matches the same seed computation; both were **verified via
`mobile-ci.yml` post-merge (green)** since this session has no Flutter SDK to verify locally. No
accounting impact.

`APP-BUILDER-15` (Builder Data UX — Inspector binding/visibility editor) is **done**: PR #998 merged
(squash Merge SHA `ef757bd79f39c199047893bea735b90ef8284005`, confirmed single-parent squash onto
`main`, parent `8dbff6f`). Backend: `AppBuilderRegistryController` now also serializes `resources`
(`DataResourceRegistry::definitions()` — id/version/shape/paginated/fields/query_params),
`visibility_signals` (`VisibilitySignal::ALL`), and `visibility_operators` (`VisibilityOperator::ALL`
with a derived `value_arity: none|single|list`), plus `bindable_resources` on each component (the
field already existed on `ComponentDefinition` since `APP-BUILDER-14` but was never exposed over HTTP
until now). 7 new focused tests in `AppBuilderRegistryTest`. Frontend (`web/src/lib/app-builder.ts`,
`inspector.tsx`): `AppSchemaBinding`/`VisibilityNode` (a closed `{all}`/`{any}`/
`{signal,operator,value?}` union, matching `AppSchemaParser` exactly) added to the schema types; a
new `BindingEditor` (resource picker → filter/sort fields → per-prop field mapping) renders under any
component whose registry entry declares `bindable_resources`; a new `VisibilityEditor` edits a
**flat** condition shape only — one leaf, or one combinator wrapping N leaves, no nesting — which
covers every realistic case without building a full tree editor; a condition that arrived via the API
in a shape deeper than that (only possible today by editing the draft directly through the API, since
this editor never produces one) renders as a read-only "too advanced for this editor" state with a
reset button, never a silent misread. One real, deliberate scope decision made during implementation:
`commerce.products`'s `category_id` filter is structurally valid per `DataResourceRegistry` but its
only documented intended value (`$route.categoryId`) is a navigation-context reference that doesn't
exist as a runtime concept anywhere yet (no schema/runtime mechanism resolves it) — the editor
excludes it from the buildable query UI rather than inventing a context-passing mechanism ahead of a
task that would actually design one; recorded here as a Commerce/runtime dependency, not silently
worked around. 5 new frontend tests in the builder `page.test.tsx` covering: bindable-vs-non-bindable
Inspector state, choosing a resource revealing filter/sort fields, field-mapping rows keyed to the
component's own props, visibility "always" → "all of these" transitions, and value-field visibility
keyed to each operator's arity. Verified: 93 targeted backend tests green, full frontend suite (2081
tests), `tsc --noEmit`, and `npm run build` all green; `en.json`/`ar.json` key parity verified for the
new `binding`/`visibility` translation subtrees. No accounting impact — Builder authoring UI only;
the binding/visibility data itself has no runtime effect yet (`RuntimeCapabilities::DATA_RESOURCES`/
`SCHEMA_FEATURES` stay empty until `APP-BUILDER-17`), consistent with the note already in
`APP-BUILDER-14`'s entry above.

**`APP-BUILDER-17` is investigated and re-scoped into three slices** (this session has no Flutter
SDK to verify Dart changes locally, so each slice is kept independently small and CI-verified —
`mobile-ci.yml`'s `mobile (analyze + test)` job has proven reliable across two prior Dart pushes on
this horizon). Investigation found the task's one-line description ("mobile runtime binding/
visibility resolver") undersells its real scope: the Dart-side schema parser
(`mobile/lib/schema/app_schema.dart`) had **no knowledge of `binding`/`visibility` at all** —
`SchemaComponent._allowedKeys` only listed `{type, id, optional, props, children, action}` — so the
full task spans (a) parser support, (b) `CompatibilityResolver`/`RuntimeCapabilities` gating, and
(c) an actual resource-fetch + visibility-evaluation layer replacing `HomeScreen`/`CartScreen`'s
hand-written slot hydration, **plus flipping `RuntimeCapabilities::DATA_RESOURCES`/`SCHEMA_FEATURES`
server-side (PHP)** — a production-wide gate on what every tenant can publish, which should not move
ahead of a verified, shipped mobile release. Slicing:

- **Slice 1 (this entry) — parser support, merged.** PR #999 merged (squash SHA
  `30af97e0b19b5b94274545b4240a56b82e3e779d`, parent `ef757bd79f39c199047893bea735b90ef8284005` —
  confirmed single-parent squash onto `main`); post-merge CI (`ci.yml` pgsql+sqlite, `mobile-ci.yml`)
  both green on the merge commit. `web-ci.yml` did not run for this push — expected, since the diff
  touches only `mobile/*` and docs, and that workflow is path-filtered to `web/` changes (same as
  `APP-BUILDER-16`'s Dart/backend-only merge). Adds `SchemaBinding` and
  `VisibilityNode` (mirroring
  `AppSchemaParser::validateBinding`/`validateVisibility` exactly, including the `MAX_CONDITION_DEPTH`
  (4)/`MAX_CONDITION_BRANCHES` (16) limits) to `mobile/lib/schema/app_schema.dart`; `SchemaComponent`
  gains optional `binding`/`visibility` fields, both preserved through `withChildren()`. **Dormant by
  construction**: `CompatibilityResolver` (Dart) is untouched and does not read either field, so this
  slice changes nothing about what the resolver considers compatible; the two bundled schemas
  (`kHomeSchemaJson`/`kCartSchemaJson`) declare neither key, so no existing behavior changes either.
  The only real effect: a schema that *would* declare `binding`/`visibility` now parses structurally
  instead of being rejected with `unknown_field` — safe today only because the device never parses
  anything but those two bundled constants (no live-fetch mechanism exists — that is
  `APP-BUILDER-19`). 15 new Dart tests in `mobile/test/schema/schema_binding_visibility_test.dart`,
  mirroring `AppSchemaParserTest.php`'s binding/visibility coverage case-for-case. **Not verified
  locally** (no Flutter SDK); relies on CI.
- **Slice 2 — compatibility gating, done.** `mobile/lib/schema/registry_identifiers.dart`'s
  `RuntimeCapabilities` gains `dataResources`/`schemaFeatures` maps (**both empty by design, still**
  — mirrors `RuntimeCapabilities::DATA_RESOURCES`/`SCHEMA_FEATURES` (PHP) literally, same reasoning:
  no component here resolves a real `binding` or evaluates a real `visibility` tree yet). `mobile/lib/
  schema/capability_manifest.dart`'s `CapabilityManifest` gains matching `dataResources`/
  `schemaFeatures` fields, `resourceVersion()`/`schemaFeatureVersion()` accessors, and
  `namedCapabilityVersion()`'s fallback order extended to both — mirrors `CapabilityManifest` (PHP)
  literally. New `mobile/lib/schema/visibility_vocabulary.dart` ports `VisibilitySignal`/
  `VisibilityOperator`'s closed vocabularies (PHP) into Dart — needed only by the *semantic* half of
  visibility validity, which has no registry dependency, unlike binding.
  `mobile/lib/schema/compatibility.dart`'s `CompatibilityResolver._resolveComponent` now also treats
  an unsupported `binding`/`visibility` exactly like an unsupported component/action: pruned if
  optional, fails the whole document closed if required — closing slice 1's "parses but isn't gated"
  dormancy. **Deliberate scope reduction, recorded explicitly**: `_bindingSupported()` is a
  capability-gate-only check (`manifest.resourceVersion(binding.resource) != null`) — it does **not**
  port `CompatibilityResolver::bindingSupported()`'s (PHP) fuller structural checks (resource exists
  in `DataResourceRegistry`, the component's registry entry allows binding to it, `itemProps`/`query`
  name real fields/params), because those depend on a Data Resource Registry + Component Registry
  that don't exist in Dart yet, and since `dataResources` stays empty, every one of those checks would
  be moot today regardless of their answer — the capability gate alone already produces PHP's identical
  net effect. Building those registries now would duplicate slice 3's own job (it needs them anyway to
  wire the real `commerce/v1` consumption they exist to serve); port the fuller check there instead.
  `_visibilitySupported()`/`_visibilityConditionValid()` **are** fully ported (capability gate +
  complete semantic validity — signal/operator vocabulary, value arity per operator), since neither
  needs an undone registry. 24 new/updated Dart tests in `mobile/test/schema/compatibility_test.dart`
  mirroring `CompatibilityResolverTest.php`'s binding/visibility-gating coverage case-for-case (the
  scope-appropriate subset — the PHP tests that depend on `DataResourceRegistry`/`ComponentRegistry`
  structural checks have no Dart equivalent yet, by the same deliberate deferral above), plus a guard-
  rail test asserting `CapabilityManifest.current()` still reports both maps empty. **Not verified
  locally** (no Flutter SDK); relies on CI. Important ordering note for whoever picks up slice 3:
  **slice 2 must land before slice 3's server-side capability flip**, not after — flipping
  `RuntimeCapabilities::DATA_RESOURCES`/`SCHEMA_FEATURES` server-side while an already-installed
  mobile build only had slice 1 (parses but never gated or resolved) would have let that old build
  accept a binding/visibility node as "compatible" while silently doing nothing with it.
- **Slice 3 — generic `binding.collect` mechanism + resolution pipeline, done (partial slice-3
  scope, by explicit owner Decision Gate).** PR #1004 merged (squash SHA
  `c273550d76c35b78be6b3dfc797db34f8e521178`, parent `f8749a86945824faa235d3fb25f19721bb6c8b3b`,
  confirmed single-parent squash onto `main`; post-merge CI green on `ci.yml` pgsql+sqlite and
  `mobile-ci.yml`). Before implementing, a readiness/evidence check surfaced a genuine architecture
  gap: Cart's per-line UI is a multi-component composite (`Text`/`Price`/`Quantity`/`Button`), not a
  1:1 item→component mapping like Home's `ProductList`→`ProductCard`, which the existing flat
  `binding.itemProps` contract cannot express. A Decision Gate report (evidence, viable mechanisms,
  security/versioning/Tenant-Isolation implications) was delivered and the owner approved, with
  amendments, a generic `binding.collect` field: a dotted path naming a `LIST`-typed field on the
  bound resource, whose node's single authored child (an item template, possibly a composite
  subtree) is repeated once per collected entry, substituting `$item.<field>` throughout that
  template's props and action params — **not** a `commerce.cart.items` pseudo-resource, and
  `itemProps` is preserved unchanged (proven by a dedicated backward-compatibility test on both
  sides).
  - **PHP**: `AppSchemaParser` validates `binding.collect` structurally (non-empty string or
    absent); `ResourceDefinition::fieldType()` added; `CompatibilityResolver::bindingSupported()`
    fails `collect` closed unless its target is a declared readable `LIST`-typed field **and** the
    manifest separately declares `schemaFeatureVersion('binding.collect')` — mirrors the exact
    "old/basic-binding runtime rejects collect-dependent schemas" fail-closed shape MR-15 already
    established for `push.notifications`.
  - **Dart**: `SchemaBinding` gains the same structural `collect` field; new
    `mobile/lib/schema/data_resource_registry.dart` (a lean mirror of PHP's `DataResourceRegistry`,
    scoped to exactly what `collect`'s LIST-type validation needs — the fuller `itemProps`/`query`
    structural port against a Component Registry remains the same slice-2-documented deferral, not
    resolved by this task); `CompatibilityResolver._bindingSupported()` mirrors the same fail-closed
    gate. New `mobile/lib/app/binding_resolution.dart` — the actual runtime hydration pipeline
    (`readFieldPath`, `substituteItemRefsInProps`/`InAction`, `resolveNodeBindings`,
    `evaluateVisibility`, `pruneInvisible`) that turns a compatibility-approved binding tree into an
    ordinary, fully-literal `SchemaComponent` tree — `decodeAction`/`AppActionDispatcher` need zero
    changes, since `$item.*` substitution happens upstream of dispatch, exactly as §3.4 of the
    evidence doc anticipated ("an extension of existing code, not new dispatch logic").
    `CommerceClient.fetchBindingResource()` added — a raw (untyped) JSON fetch for
    `commerce.categories`/`commerce.products`/`commerce.cart`, deliberately bypassing typed models so
    `$item.*` resolves against actual wire field names (snake_case) rather than risking drift against
    Dart's camelCase models.
  - **Deliberate, owner-directed scope narrowing — this is *not* the full slice 3 the earlier entry
    above described.** The Decision Gate approval was explicit: "Keep the server-side capability flip
    DISABLED. This slice may implement and prove the mobile runtime, but publishing these
    capabilities server-side remains gated until the required shipped/proven mobile-runtime condition
    from the approved architecture is satisfied." Consequently `RuntimeCapabilities.dataResources`/
    `schemaFeatures` stay **empty on both PHP and Dart sides** — unchanged by this task — and
    `kHomeSchemaJson`/`kCartSchemaJson`/`home_screen.dart`/`cart_screen.dart` were **deliberately left
    untouched**: `CapabilityManifest.current()` still declares no data resources/schema features, so
    wiring the bundled schema to `binding.collect` today would prune/fail it, not light it up. The
    mechanism is instead proven end-to-end — including real `ComponentView` rendering and real action
    dispatch (`openProduct`/`updateCartQuantity`/`removeCartItem` all firing with `$item.*`-resolved
    params) for Home's `ProductList` and Cart's `CartList` shapes — via new tests that construct a
    manifest simulating a future runtime with the capability shipped
    (`mobile/test/app/binding_resolution_test.dart`, `binding_resolution_widget_test.dart`).
    `ProductScreen`/route context (`$route.productId`) and item-scoped `visibility` remain explicitly
    out of scope, per the same Decision Gate.
  - **Slice 3b — screen rewiring, done.** PR #1006 merged (squash SHA
    `88612093de458d0b3b7a2d365c9fafc9a1451c9c`, confirmed single-parent squash onto `main`, parent
    `647af264...`; post-merge `Mobile CI` run `36131595231` green — `mobile (analyze + test)`,
    `mobile (Android release build proof)`, and `mobile (iOS release build proof)` all succeeded on
    the merge commit itself). Owner-directed staged proof sequence (see the user's exact instruction
    quoted in the session record): prove the real mobile runtime end-to-end using only the app's own
    bundled schemas, before any server-side capability flip. `HomeScreen`/`CartScreen` now call
    `CommerceClient.fetchBindingResource()` + `resolveNodeBindings()` for real; `kHomeSchemaJson`'s
    `ProductList` declares `binding: {resource: "commerce.products"}` with a `ProductCard` item
    template, `kCartSchemaJson`'s `CartList` declares `binding: {resource: "commerce.cart", collect:
    "items"}` with a composite `Section` item template — both using real `$item.*` substitution,
    including action params (`openProduct.productId`, `updateCartQuantity.cartItemId/quantity`,
    `removeCartItem.cartItemId`). **`RuntimeCapabilities.dataResources`/`schemaFeatures` (Dart only)**
    flipped to `{'commerce.products': 1, 'commerce.cart': 1}`/`{'binding.collect': 1}` — exactly what
    these two bundled schemas use; **PHP's constants stayed empty in this PR**, so the server still
    refused to publish anything requiring these capabilities to any tenant on any client version. Two
    real bugs caught by CI and fixed in the same PR: `HomeScreen` baked the locale-picked
    `display_name` into fetched data instead of recomputing it in `build()` (broke locale-toggle
    reactivity); a `CompatibilityResolverTest`-mirroring Dart test relied on `manifestOf()`'s
    `schemaFeatures` default meaning "empty," which broke once that default became genuinely
    non-empty. `vertical_slice_test.dart` extended with a quantity-increment step proving `$item.id`
    resolves into a real `updateCartQuantity` dispatch → PATCH → re-fetch → re-render end-to-end.
  - **Slice 3c — server-side capability flip + `APP-BUILDER-18`, done.** PR #1007 merged (squash SHA
    `afaab2256c282bcf8928c4fc2a9eb93b413dfa5e`, confirmed single-parent squash onto `main`, parent
    `8861209...`; post-merge `ci.yml` run `36137485842` green on both `pgsql`/`sqlite`). **Owner
    decision (2026-09-25)**, following a requested narrow evidence pass: the "shipped, verified
    mobile release" milestone that gated this flip is satisfied by this repository's own established
    Gate G/H precedent (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md` — the entire Mobile
    Runtime Proof V1 horizon was already closed on CI-only release-build/test evidence, explicitly
    without any real-device/emulator/simulator installation, per an earlier explicit owner decision),
    now independently re-met on PR #1006's own merge commit. No real-device or store distribution was
    required for this specific flip. A **separate, explicitly recorded operational requirement**
    (`RuntimeCapabilities::DATA_RESOURCES`'s own doc comment) obligates real-device verification
    against a real, safely controlled `commerce/v1` tenant — covering Home, Cart, network behavior,
    binding hydration, rendering, and mutation/action flows — before the *first actual mobile
    distribution* (internal, store, or otherwise); this is not silently dropped, but is not a blocker
    for this horizon.
    - `RuntimeCapabilities::DATA_RESOURCES`/`SCHEMA_FEATURES` (PHP) now mirror Dart's
      `registry_identifiers.dart` exactly: `{'commerce.products': 1, 'commerce.cart': 1}`/
      `{'binding.collect': 1}` — not the full three-resource `DataResourceRegistry` catalog
      (`commerce.categories` stays out: no component is registered to bind it, and no shipped mobile
      build consumes it) and not `visibility` (no bundled schema uses it). `CompatibilityResolver`'s
      existing fail-closed collect-vs-basic-binding gate needed zero code changes — verified by two
      fixed tests (switched from `CapabilityManifest::current()`, now genuinely compatible, to an
      explicit "no data resources" manifest simulating an older runtime) plus three new tests proving
      a `commerce.products` binding and a `commerce.cart`/`collect: "items"` binding are compatible
      on the actual shipped runtime.
    - `AppBuilderIntegratedProofTest`'s architectural-boundary test updated: a `ProductList` bound to
      `commerce.products` now saves, validates, **and publishes** successfully end-to-end through the
      real HTTP API — the boundary this test polices genuinely moved from "accepted structurally,
      rejected at publish" to "accepted and published."
    - **`APP-BUILDER-18`** (evidence doc §3.4 DoD: "once an action is reachable end-to-end through a
      bound, schema-declared path, `ActionRegistry.dispatchStatus` updates to `DISPATCH_LIVE`"): new
      `ActionDefinition::DISPATCH_LIVE` constant; `openProduct`/`updateCartQuantity`/`removeCartItem`
      flipped to it — the three actions PR #1006's bundled schemas actually resolve via `$item.*`
      binding substitution, proven end-to-end by `vertical_slice_test.dart`. `navigate`/`refresh`
      stay `DISPATCH_PROVEN_NOOP` (never binding-dependent — no item data involved in either);
      `addToCart` stays `DISPATCH_PROVEN_NOOP` (dispatched only from `ProductScreen`'s screen-owned
      Dart tree, which deliberately does not parse an `AppSchema`/consume `binding` at all — see its
      own doc comment). This label describes the App Builder schema/canvas contract specifically; it
      is independent of the mobile runtime's hand-written screens already dispatching real Commerce
      actions via `RuntimeActionHandler`, true since the separately-closed Mobile Runtime Proof V1
      horizon — stale doc comments claiming otherwise (`MOBILE-RUNTIME-4/5 لم يُبنَيا`,
      `NoopActionHandler` as the only handler) were removed from `ActionRegistry.php`/
      `ActionDefinition.php` as part of this task.
    - Tests: full local suite green (4710 passed, 29572 assertions; the same pre-existing local-only
      `bcmath`-extension failures as every prior entry, absent in CI). No `mobile/`/`web/` files
      touched — `mobile-ci.yml`/`web-ci.yml` correctly did not run.
  - `APP-BUILDER-17` is now **fully `done`** across all slices (1, 2, 3, 3b, 3c) — no further slice
    remains. `APP-BUILDER-18` is **`done`**. `APP-BUILDER-20` (Same-Store integrated proof) is now
    **`ready`** — its dependencies (`APP-BUILDER-18`, `APP-BUILDER-19`) are both `done`. See
    `TASK-QUEUE.md`'s matching entry for the queue-level status update.
  - Tests: PHP (`AppSchemaParserTest`, `CompatibilityResolverTest`) + Dart (`compatibility_test.dart`,
    `commerce_client_test.dart`, `binding_resolution_test.dart`, `binding_resolution_widget_test.dart`)
    — parser validation, unknown/non-LIST/unknown-feature `collect` rejection, old/basic-binding-
    runtime rejection, `itemProps` backward compatibility, `ProductList`/`CartList` collection
    hydration, composite child-template repetition, recursive `$item.*` prop/action-param
    substitution (including out-of-contract references failing closed to `null`, never throwing),
    and real widget rendering/dispatch for both Home and Cart shapes. One real bug found and fixed
    during CI (not caught by local review, since no Flutter SDK exists in this session): the
    collect/list-repeat container was rebuilt via `node.withChildren(...)`, which copies
    `SchemaComponent.binding` verbatim, so the resolved node still carried its now-consumed binding —
    fixed to rebuild the container explicitly with `binding: null`. Full `php artisan test` run
    locally: 4707 passed; remaining 27 failures are pre-existing and unrelated (`Fuel*`/
    `FuelCostBasisService` — the `bcmath` PHP extension is absent from this sandbox; one
    `DocumentCenterSecureIntakeTest` PDF-fixture case) — confirmed via CI's own fresh build passing
    cleanly on both engines. Two pre-existing local-build sync gaps unrelated to this diff
    (`app/Mail/AuthActionMail.php`, `resources/views/emails/auth-action.blade.php`, both present in
    the core repo but missing from this session's locally-built copy) were synced to get an accurate
    local signal; not part of this PR's diff.

**`APP-BUILDER-19` — live publish → fetch → on-device-cache loop, done** (ADR-01 §8 Decision Point 1
= yes). Independent of `APP-BUILDER-17`/`18` (depends only on ADR-01 itself) — correctly buildable
before either lands. Wires real I/O around `last_known_good.dart`'s `resolveStartup`, a pure decision
function that was fully designed/unit-tested with **zero** I/O of its own since MOBILE-RUNTIME-10;
`resolveStartup` itself is untouched by this task.

- **Backend**: `GET commerce/v1/experience` (`CommerceExperienceController`, same read-tier
  middleware chain as `storefront`/`categories`/`products` — no cart identity needed). Returns the
  tenant's `BuilderPublishedExperienceVersion` schema document as-is (it already embeds its own
  `schemaVersion`, exactly what `AppSchema.parse` expects with no extra wrapping). **Interim V1
  selection policy, not a permanent product invariant**: `builder_apps.tenant_id` carries no unique
  constraint (a merchant may create more than one `BuilderApp` — free-form authoring tool,
  `BuilderAppController::store()` has no "one app only" guard) and no `is_live`/"active app" column
  exists. "The live experience" is defined here, for V1 only, as **the most recently published
  version across all of the tenant's `BuilderApp`s combined** (`ORDER BY published_at DESC`) —
  matching the merchant's expected mental model (publish a version, it's what's live) with zero
  schema change. The moment a real tenant needs more than one concurrently-live app, this policy is
  meant to be replaced by an explicit `is_live` column on `BuilderApp` — the response shape
  (`data.version`/`schema_version`/`published_at`/`schema`) does not change, only the selection query
  does. Do not treat "most recently published = live" as a fixed architectural fact anywhere else in
  the codebase. 404 (`not_found`) when a
  tenant has never published anything — mapped by `PublicApiExceptionRenderer` automatically via
  `abort(404, ...)`, no new `PublicApiErrorCode`. New `ExperienceResponse` schema + `/experience` path
  added to `docs/openapi/commerce-api-v1.yaml` (`AppBuilder` tag) — `CommerceApiOpenApiContractTest`'s
  path/tier-matching assertions cover it like every other commerce/v1 route. 4 new focused tests in
  `CommerceExperienceApiTest` (latest-across-apps selection, tenant isolation, 404 on never-published,
  401 unauthenticated).
- **Mobile**: `CommerceClient.getExperienceSchemaJson()` — a plain read-tier method alongside
  `getStorefront()`, returning `data.schema` re-encoded as raw JSON text (not a parsed `Map`, not a
  typed model — App Schema parsing stays `mobile/lib/schema/`'s job, not this transport layer's).
  Throws exactly like every other `CommerceClient` method; a new `startup/experience_fetcher.dart` is
  the *only* place that catches those exceptions and maps them to `ExperienceFetchOutcome` (a stable
  `reason` code per `ExperienceFetchFailed`'s own contract — never a raw message/URL). A new
  `startup/experience_cache.dart` (`ExperienceCache` interface + `InMemoryExperienceCache` for tests +
  `FileExperienceCache` for real devices) is the real on-device persistence `last_known_good.dart`
  never had. **Deliberately not `flutter_secure_storage`-backed**: a cached Experience carries no
  customer secret (MR-14's own framing), and a full App Schema document is a poor fit for a platform
  Keychain/EncryptedSharedPreferences entry's reliable per-item size limits — `path_provider` (new
  dependency, `^2.1.5`) is the narrowest first-party addition for "the app's own sandboxed writable
  directory," the same "narrower first-party" reasoning (MR-19) that already justified adding
  `flutter_secure_storage` itself for MR-07. `resolveRealStartup()` orchestrates: read cache (a
  storage failure degrades to "no cache," never an uncaught exception) → fetch → `resolveStartup()`
  (unchanged) → on `UseFreshExperience` only, best-effort write the fresh bytes back to cache (a write
  failure never discards an otherwise-good decision this boot must still render). 3 new tests in
  `CommerceClient`'s own suite (success/404/malformed-body), a new `experience_cache_test.dart`
  (round-trip, overwrite, clear, corrupt-file-reads-as-null), and a new `experience_fetcher_test.dart`
  (fresh success caches; last-known-good reuse never re-stamps `cachedAt`; incompatible-fresh-with-
  cache falls back without overwriting; a throwing cache never crashes startup) — **not verified
  locally** (no Flutter SDK in this session, same constraint as every other Dart change this horizon);
  relies on `mobile-ci.yml`.
- **Deliberately out of scope for this task** (left to `APP-BUILDER-17` slice 3 /
  `APP-BUILDER-20`, per those tasks' own entries above): `HomeScreen`/`CartScreen`/`ProductScreen`
  still render their bundled `kHomeSchemaJson`/`kCartSchemaJson` fixtures, not whatever this fetch
  loop retrieves — `resolveRealStartup()` is wired and independently tested/proven, but nothing in the
  shipped app boot sequence calls it yet. Wiring it into `AwjRuntimeShell`'s actual startup path and
  rendering its `StartupDecision` is explicitly the same "prove the generated mobile experience
  consumes the same Commerce Core via true no-code publish" integration `APP-BUILDER-20`'s Same-Store
  proof already exists to do, once `APP-BUILDER-17`/`18` also land — bolting a partial UI integration
  onto this task would duplicate that work ahead of the pieces it depends on.

TASK-QUEUE.md records the finalized task decomposition (`APP-BUILDER-13`..`APP-BUILDER-23`) under
the horizon header, promoted to `ready` in dependency order per ADR-01.

**`APP-BUILDER-20` — Same-Store integrated proof, done.** PR #1009 merged (squash SHA
`e909d6385ecdf5226ea37fdb609ec7b85d61a05b`, confirmed single-parent squash onto `main`, parent
`223ad83b`; post-merge `ci.yml` sqlite+pgsql green on the merge commit itself). `ADR-01`'s own
amendment scopes this precisely: prove Storefront Web (`store/v1`) and the Mobile App (`commerce/v1`)
consume the same Commerce Core data/business rules — shared models, shared price/availability
resolvers, shared tenant/channel boundary — not that Storefront Web is feature-complete.

New `AppBuilderSameStoreProofTest` proves it end-to-end with real HTTP round trips, no mocking: one
product created and published to both a `web` and a `mobile` `SalesChannel` under the same tenant; an
App Builder Experience authored with a real `ProductList` → `commerce.products` binding (`itemProps`
mapping `title`/`amountMinor`), published through the real draft → validate → publish HTTP pipeline;
fetched back through the exact `GET commerce/v1/experience` endpoint `experience_fetcher.dart`'s
`resolveRealStartup()` calls in production, then re-resolved through the same
`CompatibilityResolver`/`CapabilityManifest::current()` the shipped mobile runtime uses — proving, for
the first time, that the full publish → fetch → compatibility pipeline works over a real HTTP round
trip, not only against a fake transport in a Dart widget test
(`mobile/test/app/vertical_slice_test.dart`). `GET commerce/v1/products` and `GET store/v1/products`
are then compared directly for the identical product: same `id`/`name`/`price` — and, since
`CommerceProductController` and `StorefrontProductController` both format their response through the
same `StorefrontProductResource` and resolve through the same `CommercePriceResolver`/
`AvailableToSellService`, a live price change on the product with **zero republish** is reflected on
both channels immediately on the very next read (the Update/Release Matrix's Category A, evidence doc
§4 — "resolved live by `BindingResolver` at render time").

**Deliberately out of scope, recorded explicitly in the test's own doc comment, not silently
dropped**: this does **not** wire `resolveRealStartup()` into `AwjRuntimeShell`'s actual shipped boot
sequence — `HomeScreen`/`CartScreen` still render the bundled `kHomeSchemaJson`/`kCartSchemaJson`
fixtures by default. Doing so today would mean every tenant that has never published an App Builder
Experience (currently: all of them, since `GET commerce/v1/experience` 404s with no
`BuilderPublishedExperienceVersion` row at all) would see a `ControlledUnavailable` screen instead of
the working bundled demo — `ExperienceFetchOutcome`/`resolveStartup` has no "nothing published yet"
outcome distinct from a genuine fetch failure, and `resolveStartup`'s only fallback for "fetch failed,
no cache" is `ControlledUnavailable`. Resolving that fallback-UX product decision (render the bundled
demo as an implicit default vs. a distinct "not configured" state vs. something else) is a real,
unresolved product decision this task does not invent an answer for — it is recorded here as the named
prerequisite for that specific future wiring, exactly the discipline `APP-BUILDER-13`'s excluded
`commerce.promotions`/`commerce.categories.name_en` gaps already established for this horizon.

1 new focused test (21 assertions). Full local suite: 4711 passed (one more than the prior 4710
baseline — exactly this test), 29593 assertions (21 more than baseline — exactly this test's own
assertions), same 27 pre-existing local-only `bcmath`-extension failures, 49 skipped. No `mobile/`/
`web/` files touched — `mobile-ci.yml`/`web-ci.yml` correctly did not run. No accounting impact.

## Horizon closed — AWJ App Builder — Commerce Data & Dynamic Runtime V1

All 11 tasks (`APP-BUILDER-13` through `APP-BUILDER-23`) are `done`. Full closure report:
`docs/plans/app-builder/AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_CLOSURE_REPORT.md`. Two product decisions
remain named and owner-gated, neither blocking this horizon's own closure: (1) real-device
verification against a real, safely controlled `commerce/v1` tenant before any actual mobile
distribution (`RuntimeCapabilities::DATA_RESOURCES`'s own doc comment); (2) the "no Experience
published yet" fallback-UX decision before `resolveRealStartup()` is wired into `AwjRuntimeShell`'s
shipped boot path (`AppBuilderSameStoreProofTest`'s own doc comment, above). Per
`AWJ-HORIZON-SYSTEM.md`'s own "Horizon End" instruction, this session stops here rather than starting
a new horizon on its own initiative.

## Horizon: AWJ App Builder — Live Runtime Boot / Default Experience (AWJ-RUNTIME-BOOT-1)

**`AWJ-RUNTIME-BOOT-1` — done.** Resolves deferred item (2) above: the "no Experience published yet"
fallback-UX decision is now explicit and shipped as the **AWJ Runtime Boot contract**. Full detail:
`docs/plans/mobile/AWJ-RUNTIME-BOOT-1-IMPLEMENTATION-REPORT.md`.

Summary: `ExperienceFetchOutcome` gained `ExperienceFetchNotPublished` (mobile's `experience_fetcher.dart`
maps `GET commerce/v1/experience`'s 404 to it, distinct from any other fetch failure);
`resolveStartup()` gained `UseDefaultExperience`, returned immediately for that outcome, never
routed through last-known-good. `AwjRuntimeShell` now calls `resolveRealStartup()` once per app
session and renders Published/Default AWJ Experience/LastKnownGood/`ControlledUnavailable`
accordingly, through the existing `HomeScreen`/`CartScreen` rendering pipeline (each screen gained
one optional injected-experience parameter, no UI redesign). `ProductScreen`/`$route.productId`,
deep link/push navigation, and tenant isolation/RBAC are unchanged.

Tests: `test/startup/` 33 passed; new `test/app/awj_runtime_shell_startup_test.dart` proves all four
contract branches against the real shell (4 passed); full local `flutter test` 356 passed, 0 failed;
`flutter analyze` clean. Six existing app-level widget tests updated to pass an explicit
`InMemoryExperienceCache` (the production `FileExperienceCache` default depends on `path_provider`'s
platform channel, which hangs rather than erroring under plain `flutter_test` with no mock) and, for
fake servers with no `experience` route, an explicit 404 matching real backend behavior.

Real-device verification before any actual mobile distribution remains owed and unresolved by this
task, as previously recorded — this task is web/API-boundary logic plus widget tests only.
