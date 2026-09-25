# LIVE-PREVIEW-2 — Preview / Runtime Semantic Parity Foundation

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
PREDECESSOR: LIVE-PREVIEW-1 — DONE / PASS (`LIVE-PREVIEW-1-EVIDENCE-PASS.md`)

## What this task builds, and what it deliberately does not

Per the horizon's own task breakdown, LIVE-PREVIEW-2 establishes **the smallest shared/derived
contract** so Preview does not become an independent schema interpreter — it does not yet wire
that contract into `canvas.tsx`'s actual rendering (that is LIVE-PREVIEW-3's binding/collection
job and LIVE-PREVIEW-4's action/theme/visibility job). This keeps the PR small and task-scoped,
matches the horizon's "small evidence-driven tasks" execution model, and means the risk surface
of this change is fully contained to two new files plus one additive type change — nothing a
merchant's existing Preview session renders today is touched.

## What was built

1. **`web/src/modules/app-builder/runtime-contract.ts`** — a narrow, pure TypeScript port of
   `mobile/lib/app/binding_resolution.dart`'s binding-resolution and visibility-evaluation
   pipeline: `readFieldPath`, `substituteItemRefsInProps`/`substituteItemRefsInAction`,
   `resolveNodeBindings`, `evaluateVisibility`, `pruneInvisible`. Every fail-closed rule the LP-1
   evidence pass documented is preserved exactly, not loosened:
   - `binding.collect` targeting a runtime value that isn't a list fails closed to zero items.
   - A `collect` binding with zero or more-than-one authored template child fails closed to zero
     children (no well-defined template to repeat).
   - `$item.<field>` substitution is exact-string-only (a value merely starting with the prefix
     is still treated as a reference per the Dart source's own literal behavior — this port
     matches the *executable* Dart behavior, not a doc comment describing intent more loosely).
   - A missing field/resource resolves to `null`, never throws, never leaks a raw `"$item..."`
     placeholder string.
   - `evaluateVisibility` treats an operator outside the closed `VisibilityOperator` set as
     `false` (hidden) — matching the Dart source's own "unreachable once past
     `CompatibilityResolver` — fails closed regardless" comment.
   - `pruneInvisible` remains presentation-only: dropping a node here is documented as never
     authorization and never a substitute for it.

2. **`contracts/app-builder/binding-visibility-conformance.v1.json`** — a single canonical
   fixture (8 binding cases, 15 visibility cases) covering every fail-closed rule above, plus the
   ordinary repeat/substitution/id-disambiguation paths. This is the mechanism that satisfies the
   task's explicit constraint — *"establish a narrow, testable conformance contract so drift is
   detectable... prefer shared canonical fixtures"* — rather than two independently-maintained
   test suites whose expectations could silently diverge:
   - `web/src/modules/app-builder/runtime-contract.test.ts` loads this file and asserts the
     TypeScript port against it (24 tests, all passing locally — see `Evidence` below).
   - `mobile/test/app/binding_visibility_conformance_test.dart` loads the **same** file and
     asserts the real Dart source (`resolveNodeBindings`/`evaluateVisibility`) against it.
   - Both `.github/workflows/mobile-ci.yml` and `.github/workflows/web-ci.yml` now trigger on any
     change to `contracts/app-builder/**`, not only on changes to `mobile/**`/`web/**`
     respectively — a fixture-only edit (e.g. adding a case that captures a real behavior change)
     re-runs both suites, so a change to one side without a matching change to the other fails
     that side's own conformance test in CI, not silently.

3. **`web/src/lib/app-builder.ts`**: added `AppSchemaBinding.collect?: string` — the TypeScript
   schema type was missing this field entirely (LP-1 evidence, confirmed again here: zero
   references to `collect` anywhere under `web/` before this change), even though
   `mobile/lib/schema/app_schema.dart`'s `SchemaBinding.collect` has existed since
   `APP-BUILDER-17` slice 3 and is already capability-gated and live for
   `commerce.products`/`commerce.cart`. Additive only — no existing field's shape or validation
   changed; this is a prerequisite for the new module to even type-represent what it resolves,
   not a behavior change to any shipped code path (the Inspector still does not expose authoring
   `collect` — extending it is explicitly deferred to LP-3, which is where "Binding + Collection
   Preview Parity" actually lands in the Builder UI).

## Why this satisfies Decision Gate 2 rather than triggering it

The task's explicit constraint was: *do not create an independently evolving TypeScript
interpretation of the Flutter runtime contract*. This is the same shape of risk Decision Gate 2
names (*"parity would require a second independent interpreter rather than sharing/deriving the
established contract"*). Two things keep this a **derived port**, not an independent
interpreter:

- The algorithm itself is unchanged — every function above is a line-for-line structural mirror
  of its Dart counterpart, called out in `runtime-contract.ts`'s own header comment as such,
  matching this codebase's own established pattern for exactly this kind of cross-runtime mirror
  (`CompatibilityResolver.php`/`compatibility.dart`, `RuntimeCapabilities.php`/
  `registry_identifiers.dart`, `VisibilitySignal.php`/`visibility_vocabulary.dart` — each already
  documents itself the same way).
- Unlike those PHP/Dart pairs — which have historically relied on each side's own independent
  hand-written test expectations staying in sync by convention and code review alone — this pair
  additionally has a **machine-checked** conformance mechanism: one canonical fixture, asserted
  from both languages, wired into both CI triggers. This is strictly stronger than the existing
  precedent, per the task's own instruction to "establish a narrow, testable conformance
  contract so drift is detectable."

## Evidence

- **Focused**: `npx vitest run src/modules/app-builder/runtime-contract.test.ts` — 24/24 passed.
- **Relevant broader (web)**: `npm run test -- --run` (full web suite) — 297 files / 2105 tests
  passed, including the pre-existing `app-builder.test.ts` (28 tests, unaffected by the additive
  `AppSchemaBinding.collect` field).
- **Typecheck/build**: `npm run build` — succeeded (Next.js build + TypeScript check across the
  whole `web/` project).
- **Mobile (Dart)**: not runnable in this session (no local Flutter/Dart toolchain available) —
  verified by careful line-for-line manual cross-reference against
  `mobile/lib/app/binding_resolution.dart` and the existing test conventions in
  `mobile/test/app/binding_resolution_test.dart`/`mobile/test/schema/test_schemas.dart`
  (`VisibilityNode`/`SchemaComponent` have library-private constructors, so the new
  conformance test wraps each fixture case through `AppSchema.parse`, exactly like its
  neighbors). **Authoritative verification is `mobile-ci.yml`'s `flutter analyze` + `flutter
  test` run on the PR** — see the PR's CI status for the actual result; this document records
  what CI reported, not a local claim, per the horizon's own "focused tests → ... → CI →
  post-merge verification" protocol.

## Fail-closed / capability scope check (task's explicit constraints)

- **No runtime capability broadened**: nothing here changes `RuntimeCapabilities`
  (Dart or PHP), `CapabilityManifest`, or what `CompatibilityResolver` accepts at publish. The
  new TypeScript module is inert until LP-3/LP-4 wire it into Preview's render path — it cannot
  today cause Preview to show, or a merchant to publish, anything it couldn't before.
- **Fail-closed semantics preserved exactly**: see the fixture's four dedicated fail-closed
  binding cases (`collect-target-not-a-list-fails-closed`,
  `collect-with-no-template-child-fails-closed`,
  `collect-with-ambiguous-multiple-template-children-fails-closed`,
  `single-item-itemProps-missing-resource-fails-closed-to-null`) and one dedicated visibility
  case (`unknown-operator-fails-closed-to-hidden`) — each asserts the *same* "never throw, fail
  closed to empty/null/hidden" outcome the Dart source guarantees.
- **No public schema/API contract change**: `AppSchemaBinding.collect` is a new optional field on
  an existing, already-optional-everywhere client-side TypeScript type — it does not touch any
  HTTP contract, `AppSchemaParser`, or `CompatibilityResolver`.
- **Tenant Isolation/RBAC/Commerce authorization**: untouched — this task adds no new route, no
  new data fetch, and no new authorization surface.

## Decision Gate check

None of the horizon's 8 Decision Gates apply — see the "Decision Gate 2" discussion above for
the one most directly relevant; the others are unaffected by a change with zero new routes,
zero schema/API changes, and zero rendering behavior change.

## Remaining gaps (unchanged from LP-1, now with a foundation to close them)

`canvas.tsx` still does not call `resolveNodeBindings`/`evaluateVisibility`/`pruneInvisible` —
Preview's actual rendering is exactly as documented in `LIVE-PREVIEW-1-EVIDENCE-PASS.md` until
LIVE-PREVIEW-3/4 wire this module in. The Inspector still does not expose authoring
`binding.collect`. The stale `binding.runtimeNote` Inspector copy (LP-1 §3/§8 row 10) is
unchanged. The theme-token key mismatch (`primaryColor` vs. `colorPrimary`) is unchanged and
out of this task's scope (LP-2 is binding/visibility foundation only, per the horizon's own
task-4 framing for theme).

## Next task readiness

**LIVE-PREVIEW-3 — Binding + Collection Preview Parity: READY.** The shared contract this task
required exists, is tested, and is conformance-checked against the real runtime. LP-3's job is
now concretely scoped: fetch real (or realistic sample) `commerce.products`/`commerce.cart` data
through the tenant-scoped commerce endpoints already used elsewhere (per LP-1 §11's own
recommendation — never a new unscoped read path), and call `resolveNodeBindings` from
`canvas.tsx` before rendering a bound subtree.
