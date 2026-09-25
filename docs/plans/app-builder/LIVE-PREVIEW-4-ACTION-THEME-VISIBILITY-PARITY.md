# LIVE-PREVIEW-4 — Action + Theme + Supported Visibility Parity

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
PREDECESSOR: LIVE-PREVIEW-3 — DONE / PASS (`LIVE-PREVIEW-3-BINDING-COLLECTION-PARITY.md`)
SCOPE: "Align only already-supported action/theme/visibility semantics. Unsupported capabilities
must be explicit/fail-closed rather than simulated as working" (horizon task text), plus the
explicit continuation instruction: *"Preview must never simulate or imply runtime support for a
capability the real Flutter runtime does not actually support. Unsupported capabilities must
remain explicit/fail-closed."*

## The central design decision this task turned on

`web/src/modules/app-builder/runtime-contract.ts` (LIVE-PREVIEW-2) already contains a fully
correct, conformance-tested `evaluateVisibility`/`pruneInvisible` pair. The obvious-looking next
step — wire it into `canvas.tsx` exactly like LIVE-PREVIEW-3 wired `resolveNodeBindings` — is
**wrong**, and this task deliberately does not do it. Reason: `RuntimeCapabilities.schemaFeatures`
(both `mobile/lib/schema/registry_identifiers.dart` and the PHP mirror) does **not** include
`'visibility'` — the real runtime does not evaluate visibility conditions at all today. Making
Preview conditionally show/hide content based on `visibility` would be simulating a capability
that does not exist on any real device, which is exactly what this task's own instruction
forbids. This is the direct opposite of `binding`/`collect` in LIVE-PREVIEW-3, where
`dataResources`/`schemaFeatures['binding.collect']` **are** populated — that capability really is
live, so wiring it in was alignment, not simulation. The same `runtime-contract.ts` module holds
both a genuinely-supported capability (binding) and a not-yet-supported one (visibility); this
task treats them oppositely on purpose.

## What was built (all `web/` only — no backend, no mobile file touched)

1. **Action inert/wired parity** (`canvas.tsx`) — mirrors `component_widgets.dart`'s real
   behavior: `_ActionTappable` (`ProductCard`, `NavigationTarget`) and native
   `onPressed: action == null ? null : ...` (`Button`, `AddToCart`) both render visibly
   differently when no `action` is attached. Preview now applies `opacity-50` to exactly these
   four component types' wrapper when `!node.action`, and leaves them at full opacity when an
   action is present — a merchant can now see, in Preview, whether a button/card/nav row they
   configured is actually wired to do anything, matching the real app's "the two states are
   visibly different" requirement (MR-11, cited in the Dart source's own doc comment). `Quantity`
   is deliberately **not** touched — its real widget (`_QuantityWidget`) never dims based on
   action presence (its +/− controls are gated by `min`/`max` only; the action, when present, is
   dispatched as a side effect of a local-state change, not a precondition for interactivity).

2. **Visibility — explicit, not simulated** (`canvas.tsx`) — a new, **always-visible** (not
   hover-gated, unlike the existing type-label badge) `UnsupportedVisibilityBadge` renders on any
   node that carries a `visibility` condition, reading (English) *"Visibility condition not yet
   active"* / (Arabic) *"شرط ظهور غير مُفعَّل بعد"* — new `visibilityUnsupportedBadge` i18n key,
   both locales. The node's content is **always rendered regardless of the condition** — no
   `evaluateVisibility`/`pruneInvisible` call anywhere in the render path. This is the literal
   "explicit/fail-closed rather than simulated as working" instruction: fail-closed here means
   *always show + always flag*, not *guess and hide*, since guessing which way an unimplemented
   condition "should" resolve would itself be a simulation.

3. **Theme — explicit runtime note, no key rename** (`theme-panel.tsx`) — a new, always-visible
   `runtimeNote` (matching the Inspector's existing `binding.runtimeNote`/`visibility.runtimeNote`
   pattern exactly) now appears at the top of the Theme panel: *"Not yet active in the mobile
   app — a published experience's colors are not applied to the real app's appearance yet."*
   **Deliberately not attempted**: renaming/mirroring the Builder's `primaryColor` token key to
   the one key the real runtime's `themeSeedColorFromSchema` reads (`colorPrimary`,
   `mobile/lib/app.dart`). Investigation found this key-name fix would not actually restore any
   working behavior worth implying: `_seedColor` is computed **once, from `kHomeSchemaJson`
   only** — the bundled compile-time Default schema — never from whatever experience
   `resolveStartup` actually renders (Fresh/LastKnownGood/Default) for a real tenant. A tenant's
   own published theme has **no path to the shipped app's `ThemeData` at all** today, regardless
   of key naming; "fixing" only the key would risk implying a working feature (or inviting a
   follow-up task to assume it works) when the underlying gap is a mobile-side architecture
   question (should a resolved experience's theme ever seed `ThemeData`, and how, given the
   runtime currently only branches on which *content* to render, not which *theme*) that belongs
   to its own separately-scoped decision, not a quiet key rename buried in a "parity" task. The
   explicit runtime note is the whole, correct scope for LIVE-PREVIEW-4's theme alignment: state
   plainly that this doesn't work yet, exactly as the binding/visibility panels already do for
   their own not-yet-wired parts.

## Evidence

- **Focused**: `npx vitest run src/modules/app-builder/canvas.test.tsx` — 9/9 passed (5
  pre-existing LIVE-PREVIEW-3 tests + 4 new: action-dimmed, action-wired-not-dimmed,
  visibility-badge-shown-and-content-still-renders, no-badge-when-no-visibility).
- **Relevant broader**: `npx vitest run src/modules/app-builder "src/app/(app)/app-builder"` — 8
  files / 80 tests passed, including the pre-existing 27-test `builder/page.test.tsx` (its
  mock translation dictionary extended with `theme.runtimeNote` for completeness; no assertion
  changed or removed).
- **Full suite**: `npm run test -- --run` — 299 files / 2118 tests passed.
- **Typecheck/build**: `npm run build` — clean.
- Web-only change — only `web-ci.yml` is relevant.

## Explicit non-simulation check (this task's own governing rule)

- Visibility: never evaluated conditionally anywhere in this diff — confirmed by the new test
  asserting the flagged node's content renders with **no signal input supplied at all** to
  `AppBuilderCanvas`, proving nothing is being guessed or evaluated.
- Theme: no claim added anywhere that a published experience's colors reach the shipped app —
  the new copy says the opposite, explicitly.
- Action: the dimming reflects only whether `node.action` is *present* (a structural schema
  fact, already true on both Preview and the real runtime today) — it makes no claim about
  what tapping a wired action actually *does* server-side (still `provenNoop` on the real
  runtime's dispatch layer; Preview doesn't dispatch anything at all, unchanged from before).

## Remaining gaps (carried forward, unchanged in nature by this task)

- Real live product/cart data in Preview — deferred (LIVE-PREVIEW-3's own recorded deferral).
- Visibility evaluation itself — genuinely unsupported on the real runtime; will only become an
  "align it" task once `RuntimeCapabilities.schemaFeatures['visibility']` is actually populated
  on both Dart and PHP sides (mirroring how `binding.collect` was promoted in `APP-BUILDER-17`).
- Theme-from-published-experience reaching the shipped app's `ThemeData` at all — a mobile-side
  architecture question, out of this web-only task's scope, not silently dropped.
- Action dispatch itself remains `provenNoop` on the real runtime (MOBILE-RUNTIME-4/5's own
  scope, predates and is outside this horizon) — Preview's inert/wired fix only aligns the
  *visual* state, never claims a wired action does anything.
- Compatibility gating still runs only at explicit Validate/Publish, not live during editing
  (LIVE-PREVIEW-5's job).

## Decision Gate check

No Decision Gate applies. No capability broadened (if anything, this task narrows an implicit
overclaim: unbadged, undimmed rendering previously implied more runtime support than exists). No
schema/API/auth/RBAC/Tenant Isolation/Commerce authorization change. No backend or mobile file
touched.

## Next task readiness

**LIVE-PREVIEW-5 — Runtime-Aware Pre-Publish Validation: READY.** Per its own task text: *"Inspect
existing validation first... reuse existing schema/version/capability contracts; do not create
duplicate validators."* LIVE-PREVIEW-1 §6 already found `BuilderPublishedExperienceVersionService`
runs the real, shared `CompatibilityResolver` at Validate/Publish — LIVE-PREVIEW-5's evidence-first
framing fits directly after this task's own action/theme/visibility alignment work, with no new
Decision Gate evidence found here that would block it.
