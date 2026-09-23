# MOBILE-RUNTIME-3 — Implementation Report

STATUS: done
DATE: 2026-09-23

## Outcome

A typed Flutter Component Registry (`mobile/lib/registry/`) and typed Action
Registry (`mobile/lib/actions/`) exist, rendering/dispatching exactly the
horizon's MR-04/MR-05 allowlists against the MOBILE-RUNTIME-2 schema/
compatibility kernel's output. No Commerce API call, no real navigation
between pages, and no ar/en localization exist yet — those remain
MOBILE-RUNTIME-4/5/6/7.

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence checked before
starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4 MR-04
  (component candidate list) and MR-05 (action allowlist) fix the exact 15
  component type names and 6 action type names this task must implement —
  already mirrored as bare identifiers in
  `mobile/lib/schema/registry_identifiers.dart` (MOBILE-RUNTIME-2).
- `mobile/lib/schema/` (merged, PR #950) — `SchemaComponent`, `ActionRef`,
  `CompatibilityResolver`, `RenderableExperience` already exist and were
  read in full before designing this task's builders against them.
- No existing `lib/registry/` or `lib/actions/` — confirmed via `ls`.

## Approach chosen

1. **Typed Action Registry first** (`lib/actions/app_action.dart`): a sealed
   `AppAction` class (`NavigateAction`, `OpenProductAction`,
   `AddToCartAction`, `UpdateCartQuantityAction`, `RemoveCartItemAction`,
   `RefreshAction`) plus `decodeAction(ActionRef) -> AppAction?`. This is
   deliberately defense-in-depth: `CompatibilityResolver` (MOBILE-RUNTIME-2)
   already excludes a node whose action *type* is unsupported, but has no
   opinion on whether that action's `params` are well-formed for the type —
   `decodeAction` returns `null` (never throws) for a type-supported but
   malformed action (e.g. `addToCart` with no `productId`), so a tap can
   never crash the app over bad schema data.
2. **`AppActionDispatcher`** (`lib/actions/action_dispatcher.dart`): decodes
   then dispatches to a typed `ActionHandler` interface via an exhaustive
   `switch` over the sealed class (the Dart analyzer enforces every action
   type is handled — adding a new `AppAction` subtype without updating the
   switch is a compile error, not a silent gap). Renamed from the more
   obvious `ActionDispatcher` to `AppActionDispatcher` after `flutter
   analyze` caught a name collision with `package:flutter/widgets.dart`'s
   own unrelated `ActionDispatcher` (part of Flutter's Actions/Intent
   framework) — recorded here since it is exactly the kind of naming trap
   worth flagging for later tasks.
3. **`NoopActionHandler`**: the temporary default implementation — every
   method is a no-op `Future<void>`. This is the honest state of the app
   at this point in the horizon: a tap dispatches a correctly-typed,
   correctly-decoded action, and nothing observable happens yet, because
   no real Commerce wiring exists until MOBILE-RUNTIME-4/5. A
   `RecordingActionHandler` test double (under `test/`, not shipped) proves
   the dispatch pipeline end-to-end.
4. **Typed Component Registry** (`lib/registry/`): `ComponentRegistry.builders`
   is a `Map<String, ComponentBuilder>` covering exactly the 15 MR-04
   identifiers. `ComponentView` looks up a node's `type` in this map and
   renders nothing (never throws) for an unrecognized type — defense in
   depth again, since a resolved `RenderableExperience` should never
   contain an unsupported type, but this widget does not blindly trust
   that upstream guarantee.
5. **Props are read defensively, never trusted at their declared type**:
   every prop accessor (`_stringProp`, `_intProp`, `_stringListProp`, …)
   falls back to a safe default on a missing or wrong-typed value rather
   than throwing during `build()`. The schema layer guarantees JSON-safe
   *shapes*; it does not guarantee a specific component instance set the
   exact keys/types a given widget expects.
6. **Image accepts only `https://` URLs**: a non-`https` value renders the
   same safe placeholder as a network failure, never attempting the
   request. This is a structural guard, not a business decision — a
   published schema is untrusted content, and restricting the scheme is a
   free, cheap defense against anything other than a plain remote-image
   fetch (which the App Builder architecture doc explicitly allows as
   "Experience-only" content, distinct from an *action* performing
   arbitrary HTTP).
7. **Money stays in minor units end-to-end**: `Price`/`ProductCard`/
   `CartSummary` all take an `amountMinor` integer prop and format it for
   display (`formatMinorAmount`) — no widget performs arithmetic to derive
   a total; every amount shown is either schema-declared now or, later,
   sourced directly from a Commerce API response field, consistent with
   CLAUDE.md's "الإجماليات مشتقة لا مُدخلة" even though this proof layer
   computes no business totals at all.
8. **Ephemeral UI state never becomes business authority (MR-06)**:
   `VariantSelector`'s selection and `Quantity`'s current value are local
   `StatefulWidget` state. `VariantSelector` never dispatches an action by
   itself (tested explicitly). `Quantity` dispatches `updateCartQuantity`
   *only* when the schema attached that action to it, and only overlays the
   live, schema-bounded (`min`/`max` are schema props, not client-invented)
   quantity onto the schema-declared base params (e.g. `cartItemId`) — the
   tap still only *requests* a change; nothing here treats the local click
   as an already-succeeded cart mutation.
9. **Scope boundary, deliberately not closed in this task**: `AddToCart`
   dispatches its schema-declared `action` as-is (static params, e.g. a
   fixed `quantity` the schema author set) — it does **not** read a sibling
   `Quantity` widget's live value. Wiring "read the selected quantity from
   a sibling component" is real page-level state coordination that belongs
   to MOBILE-RUNTIME-5's actual Product screen controller, not to a
   self-contained, individually-testable component builder. Recorded
   explicitly in Discovered backlog below so it is not mistaken for an
   oversight.
10. **`ExperienceView`** (`lib/registry/experience_view.dart`): the minimal
    glue rendering one page of a `RenderableExperience` through the
    Component Registry, dispatching via an `AppActionDispatcher`. Proves
    the two kernels (schema/compatibility + component/action) compose
    end-to-end without implementing real navigation, Commerce data, or
    localization — an unknown `pageId` renders a controlled Arabic message
    rather than throwing.
11. **No new dependency.**

## Why this approach fits AWJ

- The Component Registry's identifier set is asserted equal to
  `RuntimeCapabilities.components` by a dedicated test — the capability
  manifest (which later tasks and, eventually, a real server-side
  compatibility check will read) can never claim to support a component
  this registry cannot actually render, and vice versa. Same guarantee for
  actions via `RuntimeCapabilities.actions`.
- Fail-closed-by-default carries through from MOBILE-RUNTIME-2 into this
  task's own defensive prop/action handling — nothing here weakens that
  posture to make rendering more convenient.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.
  Zero network code. Zero business computation.

## Changed files

```
mobile/lib/actions/app_action.dart            (new)
mobile/lib/actions/action_dispatcher.dart     (new)
mobile/lib/actions/actions.dart               (new — barrel export)
mobile/lib/registry/component_registry.dart   (new)
mobile/lib/registry/component_widgets.dart    (new)
mobile/lib/registry/experience_view.dart      (new)
mobile/lib/registry/registry.dart             (new — barrel export)
mobile/test/actions/recording_action_handler.dart  (new — test double)
mobile/test/actions/app_action_test.dart      (new — 21 tests)
mobile/test/registry/component_registry_test.dart  (new — 17 tests)
docs/plans/mobile/MOBILE-RUNTIME-3-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 5.5s)

$ flutter test
...
00:02 +72: All tests passed!
```

72 tests total: 37 new (21 in `app_action_test.dart` + 16 in
`component_registry_test.dart`, verified by direct `grep -c` count against
each file, not just the runner's running tally) on top of the 35 carried
over from MOBILE-RUNTIME-1/2 (17 parser + 16 compatibility + 2 shell). All
green, including a self-check test that `ComponentRegistry.builders`
exactly covers `RuntimeCapabilities.components`, and one that
`decodeAction` exactly covers `RuntimeCapabilities.actions`.

## Build / lint / typecheck

`flutter analyze` (above). No build attempted — out of this task's scope.

## CI

PR #952 opened on head `4847b31cbd760bc6e4374b795f566c2f4ecd10ec`; all 6
required checks (`mobile-ci.yml` analyze+test, `ci.yml` sqlite+pgsql, each
×2 for push+PR events) passed — `conclusion: success` on every run.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `4847b31cbd760bc6e4374b795f566c2f4ecd10ec`
- Findings / resolution: fresh Reviewer + AWJ Guardian pass against the
  complete final diff (`git diff 9d21705 4847b31`, 11 files, 1493
  insertions, 0 deletions):
  - All 6 required checks green on this exact head: `mobile (analyze +
    test)` ×2, `php artisan test (L11, sqlite)` ×2, `php artisan test
    (L11, pgsql)` ×2 — all `conclusion: success`. `mergeable_state: clean`.
  - Diff contains exactly the files this task's own change list names —
    no Commerce API code, no real navigation, no localization introduced
    ahead of MOBILE-RUNTIME-4/5/6/7's scope.
  - Confirmed by direct inspection that `ComponentRegistry.builders`
    covers exactly `RuntimeCapabilities.components` and `decodeAction`'s
    switch covers exactly `RuntimeCapabilities.actions`, each backed by a
    dedicated test that would fail on any future drift.
  - Confirmed `Image`'s `https://`-only guard and every prop accessor's
    defensive fallback are real properties of the code, not just
    assumptions the tests happen to exercise.
  - No accounting/tenant/RBAC/API/DB code touched.
  - No unresolved review finding or Decision Gate.

## Merge

- Merge status: **merged** (squash), PR #952.
- Merge SHA: `b7637f3990702a2cd6277422493dae3eda3b3ced`

## Post-merge review

- POST_MERGE_REVIEW: **PASS**
- Reviewed Merge SHA: `b7637f3990702a2cd6277422493dae3eda3b3ced`
- Target-branch checks/smoke:
  - `git fetch origin main` confirms `origin/main` tip is exactly this SHA,
    single parent `9d2170575494f0bc224de181b31873d55d70b58d` — a genuine
    squash merge.
  - `git diff 4847b31cbd760bc6e4374b795f566c2f4ecd10ec origin/main --
    mobile/lib/actions mobile/lib/registry mobile/test/actions
    mobile/test/registry docs/plans/mobile` is empty — the squash preserved
    the reviewed content exactly.
  - Post-merge CI on this exact `head_sha`: `ci.yml` run
    [35814402337](https://github.com/safwan5001-source/Nebrax/actions/runs/35814402337)
    and `mobile-ci.yml` run
    [35814402408](https://github.com/safwan5001-source/Nebrax/actions/runs/35814402408),
    both `conclusion: success`.
  - Targeted post-merge smoke: `flutter analyze` (0 issues) and `flutter
    test` (72/72 passing) re-run directly against the merged content.
- Findings / resolution: none — no unexpected integration change.

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-3's outcome ("allowlisted typed rendering/
actions") and Gate B ("typed Component Registry", "typed Action Registry")?
Yes, with both allowlists cross-checked by dedicated tests against
MOBILE-RUNTIME-2's `RuntimeCapabilities`. Is there a simpler design?
Considered a single giant `switch` instead of a `Map<String, Builder>` for
the Component Registry — kept the map because the coverage-equality test
(`.keys.toSet()`) is trivial against a map and awkward against a switch's
case list. Did I reuse existing authority instead of duplicating business
logic? Yes — no pricing/stock/cart logic is computed anywhere; every
commerce-shaped component only formats already-given values.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that no prop accessor can throw a `TypeError` during `build()`
— every one of the six is a narrow `is` check with a fallback, verified by
a test that omits a required prop (`Text` with no `text`) and asserts
`tester.takeException()` is `null`; (2) that `ComponentView`'s unknown-type
path is actually exercised, not just theoretically safe — tested directly
with a fabricated `SomeFutureWidget` type; (3) that the `AddToCart`/
`Quantity` scope boundary (item 9 above) is a recorded decision, not a gap
someone finds later and has to guess about. Is any code broader than the
task? No Commerce client, no real navigation, no localization exists in
this diff. Are tests proving behavior rather than implementation trivia?
Yes — every widget test asserts on rendered text/dispatched actions, not
on internal widget-tree shape beyond what's needed to find them.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — no network/tenant
context exists in this pure-widget/dispatch layer. Is any financial value
computed with unsafe types or client authority? No — `formatMinorAmount`
only divides/formats a single already-provided integer; no widget sums,
multiplies, or otherwise derives a total. Can authorization be bypassed?
Not applicable — no auth exists yet (MOBILE-RUNTIME-4), and no action
handler performs any effect yet (`NoopActionHandler`). Could a locally
selected quantity/variant become business authority? No — `VariantSelector`
never dispatches; `Quantity` only *requests* a change via a schema-declared
action, bounded by schema-declared min/max, and no widget marks anything
"added"/"updated" until a real handler (later task) confirms it
server-side. Could retries duplicate side effects? No side effects exist
yet. Are secrets/PII exposed? None exist in this layer.

## Accounting impact

None.

## Tenant / branch isolation impact

None — no network call, no data access.

## Security / authorization impact

Positive, structural: `Image` restricted to `https://`; every action
dispatch passes through a single typed, validated decode step that fails
safe (never throws, never executes an unrecognized type) rather than
trusting the schema's own claimed action type at face value.

## Backward compatibility

Fully preserved — no existing file outside the two new directories was
modified.

## API / DB / migration impact

None.

## External research used

None new — this task implements already-accepted AWJ contracts (MR-04/
MR-05, MOBILE-RUNTIME-2's kernel) rather than adopting external platform
behavior. Flutter widget APIs used (`ListView`, `Image.network`,
`ChoiceChip`, `IconButton`, sealed-class `switch`) are all stable,
long-standing framework APIs, not something requiring a fresh compatibility
check.

## Risks / remaining work

- The `AddToCart` + `Quantity` sibling-state-coordination gap (item 9 above)
  is intentionally deferred to MOBILE-RUNTIME-5, not resolved here.

## Discovered backlog

- MOBILE-RUNTIME-5 (Home/Product/Cart vertical UI) will need a page-level
  state coordinator so a `Quantity` selection can flow into a sibling
  `AddToCart` tap's dispatched params — this task's components are
  individually correct and testable but deliberately do not attempt that
  cross-component wiring themselves.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: (recorded once opened)
- Base SHA: `9d2170575494f0bc224de181b31873d55d70b58d` (`origin/main`, PR #951)
- Head SHA: `6b5a4ccc74d63d3f49abce9b2ceb72cc861f37d5` (pushed)

## Recommended next dependency-ready task

`MOBILE-RUNTIME-4` (Commerce OpenAPI client + secure session boundary) —
depends only on `MOBILE-RUNTIME-1` per the horizon's dependency table and
does not require this task's Post-Merge Review to start, though this
session continues sequentially. `MOBILE-RUNTIME-5` requires both this task
and `MOBILE-RUNTIME-4` merged.
