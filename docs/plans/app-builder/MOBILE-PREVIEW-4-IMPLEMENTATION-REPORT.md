# MOBILE-PREVIEW-4 — Runtime Semantic Parity — Implementation Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED — CI green — PR open, **not merged, no deploy**
**Repository:** `safwan5001-source/Nebrax`
**Branch:** `feat/mobile-preview-4-runtime-semantic-parity`
**PR:** #1100
**Base SHA:** `bf023359a58f8c9bfefc526be0c77f18df4518e3` (latest `origin/main` at task start)
**Head SHA:** `49d9105c747e5f0f0b50654d6a7a58b9e61a2d7c`
**Scope:** Web (`web/`) + mobile test-only (`mobile/test/`) + shared conformance fixtures
(`contracts/app-builder/`). No `app/`/`routes/`/`database/` file touched. No `mobile/lib/`
(runtime source) file touched — the shipped Flutter runtime is unchanged.

## 1. Evidence pass

Read in full before coding: `AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`,
`REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md`, `REAL-MOBILE-PREVIEW-3-IMPLEMENTATION-
REPORT.md`, `REAL-MOBILE-PREVIEW-SALLA-MOBILE-BENCHMARK.md`, `APP-BUILDER-BENCHMARK-MATRIX.md`,
plus the actual source: `web/src/modules/app-builder/canvas.tsx`, `runtime-contract.ts`,
`web/src/lib/app-builder.ts`, `mobile/lib/schema/compatibility.dart`,
`mobile/lib/registry/component_registry.dart`, `mobile/lib/schema/registry_identifiers.dart`,
`mobile/lib/actions/app_action.dart`, `mobile/lib/app/runtime_action_handler.dart`,
`mobile/lib/app/awj_runtime_shell.dart`, `mobile/lib/app/home_screen.dart`/`cart_screen.dart`/
`product_screen.dart`, `mobile/lib/registry/experience_view.dart`, and the existing Dart test
suites (`app_action_test.dart`, `component_registry_test.dart`, `runtime_action_handler_test.dart`).

### External benchmark (official sources fetched this task)

| Source | Finding | AWJ decision |
|---|---|---|
| Flutter — Navigation/Router docs | The Router model has a real, documented split between **page-backed** routes (declarative, deep-linkable, survive back/forward) and **pageless** routes (dialogs/overlays — imperative, removed with their parent page). This is a genuine supported/unsupported distinction the framework itself draws, not a style preference. | Browser Preview's navigate dispatch must draw the *same kind* of real distinction — not "any schema page id navigates", but exactly the pageIds the shipped `RuntimeActionHandler.onNavigate` actually wires (`home`/`cart`). Anything else is flagged honestly, never silently generalized. |
| Shopify — Theme App Extension developer docs/community | A block that cannot be previewed renders **"No preview available"** rather than faking a render. A cart-based extension previewed in the theme editor **always renders against an empty cart** — a disclosed, permanent limitation, not a bug the platform tries to hide. | Confirms the "truthful limitation" pattern over "silent no-op" or "fake success" for actions Browser Preview cannot safely execute (`openProduct`/cart mutations — all need live commerce data/auth AWJ Preview intentionally doesn't have). |

Both findings are recorded in `APP-BUILDER-BENCHMARK-MATRIX.md` (rows: "App-level navigation",
"Empty/auth states", new row "Component/action registry parity"), each with Source →
AWJ Decision separated, per the matrix's own update rules. Neither implies a schema/auth/runtime
redesign — no Decision Gate triggered by this evidence.

## 2. Core semantic gap found

**Browser Preview dispatched no action at all, on any node, under any circumstance.** Tapping a
`Button`/`AddToCart`/`ProductCard`/`NavigationTarget` with a real `action` attached did nothing —
not even a no-op dispatch — because `interactive={false}` (App Preview mode, shipped in MP-3)
unconditionally stripped *all* click handling, selection and dispatch alike. This is the exact
opposite failure mode from "faking success": it under-communicated, silently, on every tap.

A second, more fundamental discovery while tracing the real dispatch path
(`mobile/lib/app/runtime_action_handler.dart`, `awj_runtime_shell.dart`): **the shipped mobile
runtime is not a generic multi-page schema renderer.** It is a fixed native 3-screen shell
(Home/Product/Cart, `RuntimePage` enum). `RuntimeActionHandler.onNavigate` is a literal
`switch (action.pageId)` with exactly two cases — `'home'` and `'cart'` — and a documented
`default: break` ("an unrecognized pageId is a schema-authoring mistake, not a runtime crash").
The App Builder's own multi-page authoring UI (arbitrary `schema.pages` keys, e.g. a merchant-
authored `"about"` or `"categories"` page) is real and already shipped — but the mobile runtime
today only ever *reaches* a page via this narrow `home`/`cart` switch or `openProduct`'s
unconditional `goToProduct`. A `navigate` action targeting any other pageId — even one that is a
perfectly real page in the schema — is a genuine, already-shipped no-op on a real device today.

This meant the honest fix was **not** "make Preview navigate to any schema page" (that would
invent a second, richer navigation truth the real app doesn't have — exactly what the Horizon's
hard boundaries forbid) but "make Preview dispatch for real, using the exact same narrow
allowlist, and say so plainly when a target isn't in it."

A third gap: `openProduct`/`addToCart`/`updateCartQuantity`/`removeCartItem` all either fetch live
commerce data (destination `ProductScreen`) or mutate it via `CommerceClient` (a real network
call) on the shipped runtime. Preview has no live commerce/auth path (locked since LIVE-PREVIEW-3/
the Horizon's own hard boundaries) — so these needed an honest "unavailable" outcome, never a
fake render or a fake mutation.

## 3. Fixes

1. **Real dispatch wiring in Browser Preview** (`web/src/modules/app-builder/canvas.tsx`):
   `AppBuilderCanvas`/`CanvasComponentNode`/`NodeFrame` gained one new optional prop,
   `onAction?: (action) => void`. In `interactive={false}` mode only, a node whose schema
   declares an `action` (and only then) becomes a real, keyboard-accessible tappable element that
   calls `onAction(node.action)` — no visual chrome added (no selection ring, no type tag; a node
   with no `action` is exactly as inert as before, `IgnorePointer`-equivalent). Design mode
   (`interactive={true}`) is completely unchanged: no `onAction` is ever passed there, so every
   existing call site behaves identically. The already-resolved action (post
   `substituteItemRefsInAction`, e.g. a cart line's `$item.cartItemId`) is what reaches `onAction`
   — no new substitution logic needed.

2. **`action-semantics.ts`** (new): a literal TypeScript port of `mobile/lib/actions/app_action.dart`'s
   `decodeAction` (`decodeAppAction`) plus a Browser-Preview-only classifier
   (`resolvePreviewActionOutcome`) that turns a decoded action into exactly one of five honest
   outcomes: `navigate` (pageId is `home`/`cart` — the runtime's real, wired targets),
   `navigate-unsupported` (a well-formed navigate target the runtime doesn't wire up),
   `requires-live-data` (`openProduct`/cart mutations — needs a live network/auth boundary Preview
   doesn't have), `safe-noop` (`refresh` — the real handler never touches the network either, so
   silence here is itself honest), and `inert` (malformed/unknown — the real dispatcher also does
   nothing).

3. **Builder page wiring** (`web/src/app/(commerce)/app-builder/[id]/builder/page.tsx`):
   `handlePreviewAction` resolves the outcome and does exactly one of: switch the visible page
   (`setSelectedPageId` in Draft — reusing the same state Design mode already relies on, per
   MP-3's own "no second viewed-page variable" architecture; `setViewedPageId` in
   Published/Default), show a `warning`-toned toast naming the unsupported pageId, show a toast
   naming the action as unavailable in Preview, or do nothing (`safe-noop`/`inert`) — matching the
   real runtime's own silence exactly. Wired only to `previewCanvasArea` (shared by normal Preview
   and Full Preview) — Design mode's own canvas calls never receive `onAction`.

4. **Shared conformance fixtures** (extends the existing LIVE-PREVIEW-2 pattern —
   `binding-visibility-conformance.v1.json` — rather than inventing a new mechanism):
   - `contracts/app-builder/action-navigation-conformance.v1.json` — 20 cases covering every
     action type's valid/malformed decode, plus the exact `navigate` support split. Consumed by
     `web/src/modules/app-builder/action-semantics.test.ts` (decode + preview-outcome) and the new
     `mobile/test/actions/action_navigation_conformance_test.dart` (decode against the real
     `decodeAction`, **and** the `navigate`/`navigate-unsupported` split against the real
     `RuntimeActionHandler.onNavigate` + a fresh `RuntimeState` — not merely documented, actually
     dispatched and asserted).
   - `contracts/app-builder/registry-identifiers.v1.json` — the 15 component / 6 action
     identifiers, mirroring `mobile/lib/schema/registry_identifiers.dart`'s
     `RuntimeCapabilities`. Consumed by new `web/src/modules/app-builder/registry-identifiers.ts`
     (`KNOWN_COMPONENT_TYPES`/`KNOWN_ACTION_TYPES`) + `.test.tsx` (set-equality against the
     fixture, and a smoke render proving `canvas.tsx`'s `switch` never falls into its
     raw-type-string `default:` branch for any of them) and the new
     `mobile/test/registry/registry_identifiers_conformance_test.dart` (set-equality against
     `RuntimeCapabilities` itself). This closes Horizon requirement #5 ("verify Browser Preview
     coverage against runtime-supported component identifiers... no second independent component
     contract") as an enforced regression guard, not just a one-time manual read (the research
     pass found the two allowlists already matched — 15 components, 6 actions, no drift — this
     fixture is what keeps that true going forward).

## 4. Files changed

| File | Change |
|---|---|
| `web/src/modules/app-builder/canvas.tsx` | `onAction` prop threaded through `AppBuilderCanvas`/`CanvasComponentNode`/`NodeFrame`; dispatches on tap only when `interactive=false` and the node has an `action`. |
| `web/src/modules/app-builder/action-semantics.ts` | **New.** `decodeAppAction` (port of `app_action.dart`) + `resolvePreviewActionOutcome` (Preview-only classifier). |
| `web/src/modules/app-builder/registry-identifiers.ts` | **New.** `KNOWN_COMPONENT_TYPES`/`KNOWN_ACTION_TYPES` constants. |
| `web/src/app/(commerce)/app-builder/[id]/builder/page.tsx` | `handlePreviewAction`; wired to `previewCanvasArea`'s `AppBuilderCanvas` only; new toast copy keys. |
| `web/src/messages/ar.json` / `en.json` | New `appBuilder.builder.preview.limitation.{navigateUnsupportedTitle,navigateUnsupportedDescription,requiresLiveDataTitle}` keys, both languages. |
| `contracts/app-builder/action-navigation-conformance.v1.json` | **New.** Shared fixture (20 cases). |
| `contracts/app-builder/registry-identifiers.v1.json` | **New.** Shared fixture (15 components, 6 actions). |
| `web/src/modules/app-builder/action-semantics.test.ts` | **New.** 41 tests (20 cases × decode + previewOutcome, +1 non-empty-fixture guard). |
| `web/src/modules/app-builder/registry-identifiers.test.tsx` | **New.** 3 tests (component set equality, action set equality, per-type smoke render). |
| `web/src/app/(commerce)/app-builder/[id]/builder/page.test.tsx` | +4 tests (navigate-supported switches page; navigate-unsupported shows notice, no switch; requires-live-data shows notice; Design mode unaffected). `toastFns` mock extended with `toast: vi.fn()`. |
| `mobile/test/actions/action_navigation_conformance_test.dart` | **New.** Fixture-driven decode conformance + real `RuntimeActionHandler`/`RuntimeState` navigate-support conformance. |
| `mobile/test/registry/registry_identifiers_conformance_test.dart` | **New.** `RuntimeCapabilities` set-equality against the shared fixture. |
| `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md` | Updated "App-level navigation"/"Empty/auth states" rows to MP-4 delivered (with the new external evidence); added "Component/action registry parity" row. |

No file under `mobile/lib/` (runtime source), `app/`, `routes/`, or `database/` was touched.

## 5. MP-4 scope checklist

| # | Requirement | Status |
|---|---|---|
| 1 | Navigation — same declarative intent as shipped runtime; no invented routes; truthful limitation for unsupported/native-only | ✅ `navigate` only ever "works" for `home`/`cart` (the real allowlist); any other pageId shows a truthful notice, never a silent or fabricated switch |
| 2 | Actions — match runtime availability/disabled; no fake mutations; live-auth actions stay unavailable | ✅ `openProduct`/`addToCart`/`updateCartQuantity`/`removeCartItem` show "unavailable — requires live data"; no network call is ever made from Preview |
| 3 | Bindings — preserve `itemProps`/`binding.collect`/`$item.*` | ✅ unchanged — dispatch reads the already-resolved (post-substitution) action; `runtime-contract.ts` untouched |
| 4 | Collections/repeated nodes — conformance vs. shared fixtures | ✅ unchanged (existing `binding-visibility-conformance.v1.json` suite still 24/24 green); dispatch on a repeated node's `Button`/`Quantity` etc. carries its per-item substituted params exactly as before |
| 5 | Component registry identifiers — verify coverage; no second contract; honest gaps | ✅ new shared fixture + tests on both sides; confirmed 15/15 components, 6/6 actions match with no drift, now enforced going forward |
| 6 | Capability states — fail-closed; no simulated support | ✅ unchanged (`visibility` still never evaluated, still badge-disclosed — `canvas.test.tsx`'s existing suite proves this untouched); new action outcomes never claim success for something the runtime can't do |
| 7 | Preview states — truthful empty/auth-dependent states for existing pages | ⚠️ Partial — see §7 below |

## 6. Tests

- **Focused, new:** 41 (`action-semantics.test.ts`) + 3 (`registry-identifiers.test.tsx`) + 4
  (`page.test.tsx`) = **48 new web tests, all passing.**
- **Mobile, new:** `action_navigation_conformance_test.dart` (20 decode cases + 3 navigate-support
  dispatch cases) and `registry_identifiers_conformance_test.dart` (2 set-equality cases), written
  directly against the same method signatures already exercised by
  `app_action_test.dart`/`runtime_action_handler_test.dart`/`component_registry_test.dart`. Could
  not be run locally (no Flutter toolchain in this sandbox); `mobile-ci.yml`'s `flutter analyze`
  caught one real type error on first push (`test()`'s description parameter is `Object`, not
  `Object?` — a fixture-driven test id needed an explicit `as String` cast), fixed in commit
  `49d9105`. `flutter analyze` and `flutter test` (both duplicate CI trigger sets) and the
  Android/iOS release build proofs are now **green** on the current head.
- **Broader, same files:** `canvas.test.tsx` 14/14, `runtime-contract.test.ts` 24/24 — both
  unchanged and still green, confirming binding/visibility/collection semantics are untouched.
- **Full web suite:** `npm run test` (Vitest) — **320 test files, 2313 tests, all green**
  (baseline before this task: 318 files / 2265 tests per MP-3's own report — the +2 files/+48
  tests are exactly this task's new suites).
- **Translation-key guard:** `src/lib/__tests__/i18n-keys.test.ts` 5/5 — new keys resolve in both
  `ar.json`/`en.json`, no duplicates, trees stay structurally identical.
- **TypeScript/build:** `npm run build` (Next.js production build) completed with no errors,
  including the `/app-builder/[id]/builder` route.
- **Lint:** not part of this repo's web CI (`web-ci.yml` runs `npm run test` + `npm run build`
  only — confirmed by MP-3's own report; unchanged here).
- **CI (PR #1100, head `49d9105`):** all 11 check runs green —
  `web build (Next.js)`, `php artisan test (L11, sqlite)`, `php artisan test (L11, pgsql)`,
  `mobile (analyze + test)`, `mobile (Android release build proof)`,
  `mobile (iOS release build proof)`. (The PHP checks are unaffected by this PR — no backend file
  is touched — and pass as expected.) `mergeable_state: clean`, no merge conflict with `main`.
  One transient GitHub Actions runner-provisioning outage affected the very first CI attempt
  (every check failed in ~3-4s with no runner assigned, before any checkout ran); confirmed
  infra-side (not this PR's diff — `main`'s own CI was unaffected minutes earlier) and resolved
  on GitHub's side, then re-run clean.

## 7. Known limitation (not solved by this task)

Browser Preview's sample commerce data (`sample-resource-data.ts`) is always non-empty. A
merchant-authored "empty cart" or "no products" state — real, meaningful preview states per the
Horizon's own §MP-4 scope and the Salla benchmark's B4 — cannot be honestly demonstrated in
Preview today, because there is no empty-data variant to switch to. This is not a regression from
this task (it pre-dates it) and is not something a "fake it" fix belongs in — it needs a real,
separately-scoped decision (e.g. a Preview-only "populated/empty sample data" toggle) rather than
being bolted on here. Recorded as a durable, evidenced gap in `APP-BUILDER-BENCHMARK-MATRIX.md`
("Empty/auth states" row) rather than silently left undocumented.

Also not solved (correctly, per Horizon boundaries): Preview's navigate-page fallback for
Published/Default sources, when the target pageId (`home`/`cart`) isn't declared by the currently
viewed schema, reuses the existing `effectiveViewedPageId` → schema's own `initialPageId` fallback
(safe, no crash, no fabricated content) rather than precisely reproducing the real runtime's own
finer-grained behavior (native Home/Cart screens fall back to the *bundled Default AWJ Experience*
specifically for that slot). Both are safe, honest, non-crashing outcomes; the real one is simply
more precise than this task chose to reproduce, to avoid grafting Default-schema substitution
logic into Draft/Published/Default page resolution for marginal added fidelity.

## 8. Decision Gate check (Horizon §12, all 12 gates)

| # | Gate | Triggered? |
|---|---|---|
| 1 | Changing the public App Schema contract | No |
| 2 | Weakening fail-closed compatibility | No — `CompatibilityResolver`/`resolveNodeBindings`/`evaluateVisibility` untouched |
| 3 | Changing Tenant Isolation behavior | No — no backend touched |
| 4 | Changing RBAC/Commerce authorization semantics | No |
| 5 | Forwarding merchant/admin auth to a mobile runtime | No |
| 6 | Exposing long-lived store credentials | No |
| 7 | New token/session architecture | No |
| 8 | Publishing Draft as a side effect of Preview | No — dispatch only ever changes local `selectedPageId`/`viewedPageId`/shows a toast; no API call |
| 9 | Building a second independent component/runtime contract | No — dispatch reuses the exact same 15/6 identifiers, now fixture-enforced; navigate support is the real, narrower allowlist, not a wider invented one |
| 10 | Arbitrary executable merchant code | No |
| 11 | Material mobile runtime redesign | No — no file under `mobile/lib/` touched; two new `mobile/test/` files only |
| 12 | Mobile signing/TestFlight/Play/App Store/Production release | No |

**No Decision Gate triggered.**

## 9. Backward compatibility

- Design mode is unchanged: `onAction` is never passed there, so `NodeFrame`'s `interactive=true`
  branch is byte-identical to before.
- Every existing MP-3 test (17 focused + all pre-existing) stays green unmodified.
- No existing API call, App Schema shape, or Draft/Published/Default semantics changed.
- No new network request anywhere in this feature — Preview action dispatch is 100% local
  state + a toast; it never calls `api(...)`.

## 10. Risks / remaining limitations

- The empty-sample-data limitation (§7) means "truthful empty cart/orders" preview states remain
  aspirational, not delivered, despite the dispatch/navigation work landing.
- The Draft-mode navigate-to-nonexistent-page fallback (empty-page state) and Published/Default's
  fallback-to-initial-page are both safe but slightly different from each other and from the real
  runtime's own Default-substitution behavior — documented in §7, not hidden.

## 11. Explicit MP-5+ deferrals (unchanged from the Horizon)

Preview-session tokens, live merchant commerce data, store-bearer forwarding, admin Sanctum
forwarding, Flutter Web embedding, QR/deep links, physical-device preview, signing/distribution,
theme/runtime redesign — all remain MOBILE-PREVIEW-5 through -8's scope, gated behind MP-5's
mandatory security Decision Gate, exactly as the Horizon requires. Nothing in this task pre-decides
any of them.

## 12. Next step

- PR #1100 open against `main`, **all 11 CI checks green**, `mergeable_state: clean`.
- **Not merged. No deploy.** Stopping here per the task's instructions — awaiting the owner's
  explicit merge approval.
- Recommended next task per the Horizon: **MOBILE-PREVIEW-5 — Preview Session security
  architecture** (the mandatory Decision Gate before any real-runtime/physical-device preview
  work), or, if preferred first, a small standalone follow-up to add an empty/populated
  sample-data toggle to close this task's one documented limitation (§7) without touching auth.
