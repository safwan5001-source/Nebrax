# AWJ App Builder — Runtime Correctness Follow-up V1

**Status:** APPROVED / READY  
**Starting main SHA:** `298908cb3d5c8809f6bce34e1abacc6c2f1a0695`  
**Predecessor:** AWJ App Builder — Live Runtime & Preview V1 — CLOSED / PASS  
**Predecessor closure merge:** `52c6a19fffb736a6c72ea88393006ab338ff1339` (PR #1030)  
**Source of truth for predecessor findings:** `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1_CLOSURE_REPORT.md`

## Goal

Close the two narrow correctness/truthfulness findings surfaced by LIVE-PREVIEW-7 without reopening
the completed Live Runtime & Preview V1 horizon and without mixing in the separate live-Preview-data
authentication decision.

This follow-up is intentionally small:

1. make the integrated proof/tests say only what they actually prove; and
2. make live `CartSummary` recomputation work for generically-authored Published Experiences
   instead of depending on the bundled Default schema's hardcoded node id.

The target end-state is:

```
Published Experience with arbitrary valid CartSummary node id
→ real runtime hydration
→ live cart itemCount/subtotal recomputed correctly
→ runtime rendering verified
```

while preserving current security, compatibility, Tenant Isolation, and Commerce authorization
contracts.

## Why this horizon exists

LIVE-PREVIEW-7 closed successfully, but its closure report intentionally carried forward two
findings:

1. Two existing integrated-proof tests use an `itemProps`-on-list-resource grammar in comments/
   framing that overstates what the real runtime actually hydrates. Those tests are still valid for
   the assertions they make, but their documentation must not claim on-device rendering behavior
   they do not prove.
2. Runtime hydration currently contains hardcoded-node-id behavior, most materially for
   `slot.cart.summary`. A generically-authored Published Experience can therefore contain a valid
   `CartSummary` with a different id and render stale/static `itemCount`/`subtotal` instead of
   live cart-derived values.

These are follow-up correctness issues, not evidence that the predecessor horizon failed. They were
explicitly documented as deferrals at closure.

## Locked contracts and guardrails

- Preserve the existing declarative schema model.
- Preserve existing schema versioning and capability negotiation.
- Preserve fail-closed compatibility behavior.
- Preserve `commerce/v1` as the mobile Commerce API surface.
- Preserve current store-bearer authentication boundaries.
- Preserve Tenant Isolation, RBAC, and Commerce authorization.
- Do not introduce customer identity/login, product route context, arbitrary merchant code, eval,
  SQL, arbitrary HTTP, or executable plugins.
- Do not change financial/accounting rules.
- Do not broaden this horizon into real live product/cart data in Builder Preview.
- Do not broaden this horizon into theme-token wiring or visibility support.
- Do not perform unrelated runtime refactors.
- Do not require Production deployment, signing, mobile distribution, TestFlight/Play distribution,
  or App Store/Google Play submission.
- Real-device verification remains a later pre-distribution gate; repository CI/release-build proof
  is sufficient engineering evidence for this horizon.

## Execution model

Execute as a small evidence-driven Horizon. Do not implement everything in one PR unless the
evidence proves the change is genuinely trivial and inseparable.

Standing authority covers:

- focused inspection required for the current task;
- implementation of missing in-scope code;
- tests and test harnesses;
- commits and small PRs;
- fixing in-scope CI failures;
- merging green, dependency-safe PRs with no unresolved review issue or Decision Gate;
- updating this durable state after each task;
- continuing automatically to the next READY task.

Do **not** stop merely because required implementation is missing. Build the missing implementation
when it is a normal in-scope detail and follows existing architecture/contracts.

Stop only for a genuine Decision Gate, a real blocker, or scope crossing as defined below.

## Task queue

| Task | Purpose | State |
|---|---|---|
| RUNTIME-CORRECTNESS-1 | Evidence lock for the two LIVE-PREVIEW-7 findings | **DONE** |
| RUNTIME-CORRECTNESS-2 | Correct proof/test overclaims without weakening assertions | **DONE** |
| RUNTIME-CORRECTNESS-3 | Generic CartSummary live hydration | **READY** (implementation pushed, PR pending CI) |
| RUNTIME-CORRECTNESS-4 | Integrated runtime proof for arbitrary CartSummary ids | BLOCKED on RC-3 |
| RUNTIME-CORRECTNESS-5 | Horizon closure / durable documentation | BLOCKED on RC-4 |

## RUNTIME-CORRECTNESS-1 — Evidence lock

Inspect only the files needed to confirm the two predecessor findings and the exact runtime path.

Required evidence:

- identify the exact tests/comments that overclaim `itemProps`-on-list-resource runtime hydration;
- identify what those tests actually assert today;
- identify the real Dart/runtime binding grammar used when list resources are hydrated;
- trace `CartSummary` from published schema → startup/runtime shell → hydration → rendered props;
- identify every hardcoded node-id dependency involved in live cart summary recomputation;
- determine whether the smallest safe generic fix can use existing node type/structure semantics
  without changing schema/API contracts;
- identify existing tests that should be extended rather than duplicated.

Deliver a short evidence report and either:

- `RUNTIME-CORRECTNESS-2 READY`, or
- a narrow Decision Gate with concrete evidence.

**Do not perform broad App Builder or runtime discovery.**

## RUNTIME-CORRECTNESS-2 — Proof truthfulness

Correct misleading comments, test descriptions, fixture documentation, or evidence wording that
claims more than the assertions prove.

Requirements:

- do not delete or weaken useful assertions;
- do not rewrite a valid structural/publish/fetch proof into a rendering proof unless rendering is
  actually asserted;
- distinguish clearly between:
  - structurally valid schema;
  - successful Validate/Publish/fetch;
  - binding grammar acceptance;
  - actual on-device hydration/rendering;
- if a tiny assertion can safely prove the intended claim using existing contracts, add it;
  otherwise make the wording truthful rather than inventing a broader test.

This task must not change runtime behavior unless RC-1 proves a tiny inseparable fix is necessary.

## RUNTIME-CORRECTNESS-3 — Generic CartSummary live hydration

Replace the proven hardcoded-id dependency for live `CartSummary` values with the smallest generic
runtime mechanism consistent with the existing schema/component model.

Required behavior:

- a valid Published Experience may use an arbitrary schema node id for `CartSummary`;
- the real runtime still recomputes live `itemCount` and `subtotal` from current cart data;
- the mechanism must not require merchants to know or reuse bundled Default-schema ids;
- existing bundled Default Experience behavior must remain unchanged;
- Home/Cart runtime behavior must remain backward compatible;
- no schema field, public API, auth path, permission, or capability expansion merely to solve node
  lookup;
- do not special-case one new arbitrary id;
- prefer an existing generic tree/component traversal mechanism if one already exists;
- if multiple `CartSummary` nodes are valid, behavior must be explicit and deterministic.

### Decision Gate inside RC-3

Stop before implementation if evidence shows that generic hydration requires a product decision
about ambiguous semantics, for example:

- multiple `CartSummary` nodes have materially different intended data contexts;
- node type alone is insufficient and a new schema identifier/role is required;
- fixing the issue requires changing public schema/API contracts;
- the existing hydration architecture cannot support a generic fix without a material runtime
  redesign.

Do not silently invent a new schema role or contract.

## RUNTIME-CORRECTNESS-4 — Integrated proof

Prove the fix against the real runtime path, not only helper/unit tests.

Minimum proof:

1. use a valid Published Experience fixture whose `CartSummary` id is deliberately different from
   the bundled Default schema id;
2. pass it through the existing compatibility path;
3. load it through the real startup/runtime flow used by current repository tests;
4. hydrate with cart data containing deterministic item count/subtotal values;
5. assert the real rendered/runtime-visible `CartSummary` values reflect that live cart data;
6. prove the bundled Default Experience still behaves correctly;
7. prove incompatible schemas still fail closed;
8. run the relevant Dart/mobile tests and release-build proof in CI when touched paths require it.

Reuse the existing LIVE-PREVIEW-7 integrated-proof infrastructure wherever possible. Do not create
a second parallel runtime harness unless evidence proves the existing one cannot express this case.

Isolated unit tests alone are insufficient for this task.

## RUNTIME-CORRECTNESS-5 — Closure

Close only when the actual evidence supports closure.

The closure report must include:

- task-by-task PR ledger;
- Base SHA, Head SHA, Merge SHA;
- focused and broader test results;
- CI evidence;
- exact runtime behavior before/after;
- backward-compatibility evidence;
- security/Tenant Isolation/RBAC/Commerce authorization statement;
- any remaining intentional deferrals;
- whether real-device verification is still pending;
- exact recommended next workstream.

Do not mark a deferred or unproven capability as complete.

## Decision Gates

Stop and report a narrow evidence-based Decision Gate instead of making a speculative change if:

1. the generic `CartSummary` fix requires a new public schema/API field or semantic role;
2. multiple valid `CartSummary` instances require a product rule that does not already exist;
3. a fix requires changing authentication, token issuance/forwarding, RBAC, Tenant Isolation, or
   Commerce authorization;
4. compatibility/fail-closed behavior would need to weaken;
5. the task would require customer identity, product route context, or another capability outside
   this horizon;
6. the task would require a material runtime architecture redesign rather than a narrow generic
   hydration fix;
7. the solution requires arbitrary executable merchant code;
8. scope expands into live Builder Preview data, theme wiring, visibility support, App Factory,
   signing, distribution, store submission, or Production deployment.

Sensitivity alone is not a Decision Gate. Missing ordinary implementation is work to complete.

## Non-goals

- Real live product/cart data in Builder Preview
- Store-bearer token minting/forwarding from the merchant Builder session
- New Sanctum proxy endpoint for Preview
- Theme token wiring to mobile runtime
- Visibility runtime support
- Customer identity/login
- Product route-context expansion
- App Factory
- Native project generation
- Signing/certificates/profiles
- TestFlight/Play distribution
- App Store/Google Play submission
- Production deployment
- Broad runtime refactoring
- Unrelated ERP work

## Testing and CI

Use progressive testing:

1. focused tests for the changed runtime/helper behavior;
2. existing App Builder/runtime contract tests affected by the change;
3. integrated proof;
4. Dart analyze/tests where applicable;
5. Android/iOS release-build proof when the mobile workflow is triggered or when runtime code
   changes materially;
6. broader affected suites;
7. GitHub CI;
8. post-merge verification.

Do not weaken tests to obtain green CI.

If CI fails:

- inspect the failing job/log only first;
- fix failures only when they are caused by this horizon;
- prove unrelated failures are unrelated;
- do not modify unrelated code merely to make CI green;
- avoid unnecessary polling.

## Security and tenant guarantees

This horizon is expected to be runtime-local and test/documentation focused. It must not require a
new backend authorization path.

If implementation unexpectedly touches backend tenant-scoped data access:

- preserve `TenantScope` / `BelongsToTenant`;
- preserve existing authorization middleware/permissions;
- add or retain cross-tenant negative coverage;
- treat any required authorization-model change as a Decision Gate.

No financial/accounting code should be touched.

## Backward compatibility

The generic fix must preserve:

- the bundled Default AWJ Experience;
- existing Published Experiences using the historical hardcoded ids;
- current Home/Cart rendering;
- current action/binding/compatibility behavior;
- existing mobile boot fallback behavior.

A generic solution must be additive in behavior: previously-working valid schemas continue to work,
and generically-authored valid `CartSummary` ids gain correct live recomputation.

## Exit criteria

The Horizon is CLOSED / PASS only when evidence proves:

1. the two LIVE-PREVIEW-7 findings are re-confirmed against current main;
2. test/evidence wording no longer overclaims runtime behavior;
3. no useful existing assertion was weakened to achieve that correction;
4. a valid Published Experience can use a non-default `CartSummary` id and receive correct live
   `itemCount`/`subtotal` hydration;
5. bundled Default Experience behavior remains green;
6. runtime compatibility/fail-closed behavior remains green;
7. integrated proof exercises the real runtime path, not only helper/unit tests;
8. relevant mobile/release-build CI is green;
9. Tenant Isolation/security/auth/RBAC/Commerce authorization contracts remain unchanged and intact;
10. all intentional deferrals and remaining risks are documented.

## Real-device gate

Real-device verification remains mandatory before the first actual mobile distribution, exactly as
recorded by the predecessor horizon. This follow-up does not authorize distribution.

Do not block this Horizon solely because no real-device session is available if repository
release-mode CI/build proof is green and the task does not require device-only behavior.

## Current durable state

- Starting main SHA: `298908cb3d5c8809f6bce34e1abacc6c2f1a0695`
- Predecessor Live Runtime & Preview V1: **CLOSED / PASS**
- Predecessor closure PR: #1030
- Predecessor closure merge SHA: `52c6a19fffb736a6c72ea88393006ab338ff1339`
- Finding A: existing integrated-proof wording overclaims `itemProps`-on-list-resource on-device
  hydration relative to what those tests actually assert.
- Finding B: live `CartSummary` recomputation depends on bundled Default-schema hardcoded node ids,
  most materially `slot.cart.summary`, so a generically-authored Published Experience may retain
  static cart summary values.
- Live Preview real-data/auth question remains explicitly deferred to a **separate future
  workstream** and must not be pulled into this one.

### RUNTIME-CORRECTNESS-1 — DONE

- PR: #1034 (docs-only)
- Base SHA: `52d1ede313196c4042fe47c44b2c6fcd57af8c84`
- Head SHA: `87febccee7e6ac39300ebeae1cd36e78fd929227`
- Merge SHA: `110dc0d944ee821160c4cb2290d6471be8cabab0` (squash merge)
- CI: 4/4 checks green (`php artisan test` L11 sqlite/pgsql, run twice — both pushes to the PR)
- Evidence report: `docs/plans/app-builder/RUNTIME-CORRECTNESS-1-EVIDENCE-PASS.md`
- Scope: evidence only, no runtime/test code changed.
- Result: both LIVE-PREVIEW-7 findings re-confirmed against current `main`. Finding A pinpointed to
  exact doc-comment overclaims in `AppBuilderIntegratedProofTest.php`/`AppBuilderSameStoreProofTest.php`.
  Finding B pinpointed to the single hardcoded id `'slot.cart.summary'` at `cart_screen.dart:195`.
  Confirmed the shared LIVE-PREVIEW-7 fixture (`contracts/app-builder/integrated-proof-schema.v1.json`)
  already authors its `CartSummary` node under a *different* id (`cart-summary`), so it is already a
  ready-made arbitrary-id fixture for RC-4's integrated proof — no new fixture needed.
  Confirmed the generic fix can key off `SchemaComponent.type == 'CartSummary'` (already a
  capability-gated identifier) with no new schema/API field, and that no schema in this repository
  authors more than one `CartSummary` node, so no multi-node ambiguity exists to gate on.
- Decision Gate check: all 8 gates checked, none triggered.
- No tests run (docs-only change); no runtime/behavior change.
- Risks: none introduced. No new deferrals beyond what LIVE-PREVIEW-8 already recorded.
- Review: one automated comment (`chatgpt-codex-connector[bot]`) reporting its own usage-limit
  exhaustion, not a review finding — no action needed.

### RUNTIME-CORRECTNESS-2 — DONE

- PR: #1036
- Base SHA: `110dc0d944ee821160c4cb2290d6471be8cabab0`
- Head SHA: `b0e54567bb6b9a305f16e7f52012cfe19ae0468a`
- Merge SHA: `4dba0cd00d08e0775906d6e93a61686982b9cd17` (squash merge)
- CI: green (4/4 pull_request-triggered `php artisan test` L11 sqlite/pgsql checks on the final head)
- Scope: doc-comment wording corrections only in
  `tests/Feature/AppBuilderIntegratedProofTest.php` and `tests/Feature/AppBuilderSameStoreProofTest.php`
  — no assertion removed, weakened, or added; no runtime/behavior change (RC-1 found no tiny
  inseparable fix was needed, so none was made here).
- Result: both overclaiming comments corrected to distinguish structural validity, successful
  Validate/Publish/fetch, `CompatibilityResolver`'s structural/capability verdict, and actual
  on-device rendering — pointing to the real integrated-runtime proof
  (`mobile/test/app/awj_runtime_shell_startup_test.dart` group E) for the claim they no longer make
  themselves.
- Tests: focused `--filter=AppBuilderIntegratedProofTest` (4 passed, 67 assertions) and
  `--filter=AppBuilderSameStoreProofTest` (1 passed, 21 assertions) — both assertion counts
  unchanged from pre-change baseline, confirming no assertion was added/removed. Broader
  `--filter=AppBuilder` (16 passed, 177 assertions) all green. Full local suite attempted
  (4706 passed / 35 failed / 49 skipped) — all 35 failures are pre-existing local-sandbox-only
  issues unrelated to this change and unrelated to App Builder: most (Fuel* tests) are
  `Call to undefined function App\Services\bcmul()` because this sandbox's PHP build has no
  `bcmath` extension loaded (confirmed via `php -m`); the remainder (`AuthRecoveryTest`,
  `DocumentCenterSecureIntakeTest`) are mail-fake/other local config gaps. GitHub CI (full PHP
  extension set) is the authoritative full-suite signal, and this PR's own CI was green (above).
- Decision Gate check: not applicable (docs/comments only).
- Risks: none introduced.

### RUNTIME-CORRECTNESS-3 — READY (implementation pushed, PR pending CI)

- Base SHA: `4dba0cd00d08e0775906d6e93a61686982b9cd17`
- Scope: `mobile/lib/app/experience_hydration.dart` (new `hydrateNodesByType` function, the
  type-keyed counterpart to the existing id-keyed `hydrateNode`), `mobile/lib/app/cart_screen.dart`
  (one call site: `hydrateNode(..., 'slot.cart.summary', ...)` → `hydrateNodesByType(...,
  'CartSummary', ...)`), and `mobile/test/app/experience_hydration_test.dart` (5 new focused unit
  tests). No schema/API change; no other file touched.
- Result: `CartSummary`'s live `itemCount`/`subtotalAmountMinor`/`summaryLabel` now reach any
  `CartSummary` node regardless of its authored `id` — keyed off `SchemaComponent.type` (already a
  required, capability-gated field), not a hardcoded slot id. `hydrateNodesByType` reuses
  `hydrateNode`'s exact recursive shape (same fail-safe-on-no-match contract, same "apply to every
  matching node across sibling subtrees" behavior — already true of the original id-keyed walk, so
  a schema with more than one `CartSummary` node gets deterministic, non-special-cased behavior for
  free, per RC-1's evidence that no repository schema does this today anyway).
- Tests added (all mirror the existing id-keyed `hydrateNode` test shapes 1:1): a `CartSummary`
  under a merchant-authored, non-default id is hydrated; a deeply nested `CartSummary` is found by
  type; two `CartSummary` nodes both receive the transform; no match leaves the tree unchanged
  (fail-safe); the root node itself can be the match.
- Tests run: **could not run `flutter test`/`flutter analyze` locally — no Flutter/Dart SDK is
  installed in this sandbox** (consistent with the predecessor horizon's own recorded constraint:
  "this sandbox had no Flutter toolchain throughout the horizon"). Verified by manual review only:
  brace/paren balance, type-checked field usage against `SchemaComponent`'s real constructor
  signature, and cross-referencing every other `slot.cart.summary`/`CartSummary` reference in
  `mobile/` to confirm no other file depends on the old id-keyed call. **GitHub CI's `mobile
  (analyze + test)` job is the authoritative verification for this task** — the same precedent
  LIVE-PREVIEW-7 established for its own new Dart test code.
- Decision Gate check: no schema/API field added; no multi-`CartSummary` product-semantics decision
  needed (RC-1 confirmed none exists today, and the walk's existing "apply to every match" behavior
  handles it without a new rule); no auth/RBAC/Tenant Isolation/Commerce authorization touched; no
  compatibility/fail-closed behavior weakened (`hydrateNodesByType`'s no-match case is unchanged
  from `hydrateNode`'s); no runtime architecture redesign (one new ~10-line pure function, one call
  site changed); no executable merchant code; no scope creep into Preview/theme/visibility/App
  Factory/distribution. **No gate triggered.**
- Risks: this task's own Dart changes are unverified by this session pending real CI (see above) —
  flagged explicitly rather than claimed as tested; low risk given the mechanical nature of the
  change and the exact-precedent reuse of `hydrateNode`'s already-proven shape.
- Next task: **RUNTIME-CORRECTNESS-4 — Integrated proof** (blocked until this PR's CI, especially
  the `mobile (analyze + test)` job, is confirmed green and merged).

## Autonomous execution instruction

Once this Horizon document is merged, continue autonomously from RUNTIME-CORRECTNESS-1 through
RUNTIME-CORRECTNESS-5.

For each READY task:

```
inspect only required evidence
→ implement required in-scope work
→ focused tests
→ broader affected tests / analyze / build
→ small PR
→ CI
→ merge when green and safe
→ durable-state update
→ next READY task
```

Do not request routine approval between tasks.

Build missing ordinary implementation when necessary.

Report back only at meaningful milestones:

- a task merged and the next task started;
- a genuine Decision Gate;
- a real blocker;
- or Horizon closure candidate.

No Production deploy, mobile distribution, signing, TestFlight/Play distribution, or store
submission is authorized by this Horizon.
