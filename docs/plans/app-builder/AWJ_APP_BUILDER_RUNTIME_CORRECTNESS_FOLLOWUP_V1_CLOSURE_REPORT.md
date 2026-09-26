# AWJ App Builder — Runtime Correctness Follow-up V1 — Closure Report (RUNTIME-CORRECTNESS-5)

STATUS: **CLOSED / PASS**
DATE: 2026-09-26
HORIZON: `AWJ_APP_BUILDER_RUNTIME_CORRECTNESS_FOLLOWUP_V1.md`

## Horizon outcome

**AWJ App Builder — Runtime Correctness Follow-up V1 is CLOSED.** All 5 tasks (RUNTIME-CORRECTNESS-1
through RUNTIME-CORRECTNESS-5) are complete. This Horizon closed the two narrow correctness/
truthfulness findings LIVE-PREVIEW-7 carried forward at its own closure: two integrated-proof tests'
doc comments overclaimed on-device rendering behavior they never actually asserted, and live
`CartSummary` recomputation depended on a single hardcoded node id that only the bundled Default AWJ
Experience happened to use. Both are now fixed — the proof wording is truthful and the fix is
generic, proven through the real runtime path, with the Default Experience and every historical
Published Experience unaffected.

## 1. Task-by-task ledger

| Task | PR | Base SHA | Head SHA | Merge SHA | CI |
|---|---|---|---|---|---|
| RUNTIME-CORRECTNESS-1 | #1034 | `52d1ede313196c4042fe47c44b2c6fcd57af8c84` | `87febccee7e6ac39300ebeae1cd36e78fd929227` | `110dc0d944ee821160c4cb2290d6471be8cabab0` | 4/4 green (`php artisan test` L11 sqlite/pgsql) |
| RUNTIME-CORRECTNESS-2 | #1036 | `110dc0d944ee821160c4cb2290d6471be8cabab0` | `b0e54567bb6b9a305f16e7f52012cfe19ae0468a` | `4dba0cd00d08e0775906d6e93a61686982b9cd17` | 4/4 green (pull_request-triggered head) |
| RUNTIME-CORRECTNESS-3 | #1037 | `4dba0cd00d08e0775906d6e93a61686982b9cd17` | `f286f67637c7d34a5d5590066a53f1343b6cdc9e` | `4ad00ada9bcb484541fe56f2b8ac93987364e4b8` | 12/12 green (mobile analyze+test, Android/iOS release builds, php, web, storefront) |
| RUNTIME-CORRECTNESS-4 | #1038 | `4ad00ada9bcb484541fe56f2b8ac93987364e4b8` | `b74f1c4870ae3e80682320be6350cc032a80be01` | `07f9769463134b6c388ef31845289474bcf6d396` | 10/10 green (mobile analyze+test, Android/iOS release builds, php) |
| RUNTIME-CORRECTNESS-5 | this document + durable-state update only (no code) | `07f9769463134b6c388ef31845289474bcf6d396` | — | — | n/a |

Every merge above is independently verified via the merge tool's own response (`merged: true`,
matching `expectedHeadSha`) and confirmed by the next task's `git log` on the freshly-fetched `main`.
No PR was force-merged or merged with unresolved CI. Each PR's full evidence — focused rationale,
Decision Gate check, test results — is recorded in its own section of the Horizon document's
"Current durable state" log; this table is the index.

**No CI-red fix cycle occurred anywhere in this Horizon.** Every PR was green on its first push.
RUNTIME-CORRECTNESS-3 and RUNTIME-CORRECTNESS-4 were of particular note because this session's
sandbox has no local Flutter/Dart SDK (a pre-existing constraint the predecessor horizon also
recorded) — their Dart code and every rendered-string assertion were verified by manual trace
against real source implementations and fixture JSON before push, then confirmed correct by
GitHub CI's `mobile (analyze + test)` job on the first attempt, with no correction needed.

## 2. Exit criteria — evidenced

1. **The two LIVE-PREVIEW-7 findings are re-confirmed against current `main`** —
   `RUNTIME-CORRECTNESS-1-EVIDENCE-PASS.md` re-derived both findings from the actual current code
   (not merely cited the prior closure report): Finding A pinpointed to the exact doc-comment
   overclaims in `AppBuilderIntegratedProofTest.php`/`AppBuilderSameStoreProofTest.php`, with the
   real Dart binding grammar traced to prove `itemProps` on a list-shaped resource is not even read
   by the real runtime for this exact authored shape. Finding B pinpointed to the single hardcoded
   id `cart_screen.dart:195`'s `hydrateNode(..., 'slot.cart.summary', ...)`.
2. **Test/evidence wording no longer overclaims runtime behavior** — RUNTIME-CORRECTNESS-2 (#1036)
   rewrote both comments to distinguish structural validity, successful Validate/Publish/fetch,
   `CompatibilityResolver`'s structural/capability verdict, and actual on-device rendering, pointing
   to the real integrated-runtime proof location instead of claiming it themselves.
3. **No useful existing assertion was weakened** — confirmed by assertion-count parity: focused
   `AppBuilderIntegratedProofTest` (67 assertions) and `AppBuilderSameStoreProofTest` (21 assertions)
   were identical before and after RC-2's wording-only change; broader `--filter=AppBuilder`
   (16 tests, 177 assertions) all green, unchanged.
4. **A valid Published Experience can use a non-default `CartSummary` id and receive correct live
   `itemCount`/`subtotal` hydration** — RUNTIME-CORRECTNESS-3 (#1037) replaced the hardcoded-id
   lookup with `hydrateNodesByType(..., 'CartSummary', ...)`, keyed off `SchemaComponent.type`
   (already a required, capability-gated field — no new schema/API surface). RUNTIME-CORRECTNESS-4
   (#1038) proved it through the real runtime: the shared fixture's `CartSummary` node (id
   `cart-summary`, not the Default schema's `slot.cart.summary`) now renders the live-fetched
   cart's real `itemCount`/`subtotalAmountMinor` (`'عنصر واحد'`, `'123.45'`), not its static
   authored `0`/`0` values.
5. **Bundled Default Experience behavior remains green** — RC-4 extended test B to navigate the
   Default AWJ Experience's own Cart screen and confirmed its historical `slot.cart.summary` id is
   still found and live-hydrated by the new type-keyed lookup (`'لا عناصر'`, computed from the fake
   server's empty cart) — proven integration-style, not merely asserted unaffected.
6. **Runtime compatibility/fail-closed behavior remains green** — `hydrateNodesByType` runs strictly
   after `CompatibilityResolver` already accepted the tree (unchanged call order); its own
   no-match case is fail-safe (returns the tree unchanged), identical to the pre-existing
   `hydrateNode`'s contract. Existing fail-closed coverage (`compatibility_test.dart`,
   `last_known_good_test.dart`, `experience_fetcher_test.dart`) was verified untouched and
   unaffected rather than duplicated, and passed on every PR's CI as part of the full `mobile`
   suite.
7. **Integrated proof exercises the real runtime path, not only helper/unit tests** —
   RUNTIME-CORRECTNESS-4's proof boots the real `AwjRuntimeShell` via the existing `_shell()`
   helper against a real fake `commerce/v1` HTTP server, navigates through real widget taps, and
   asserts real rendered text — not a call to `hydrateNodesByType` in isolation. (RC-3's own unit
   tests in `experience_hydration_test.dart` additionally cover the pure-function contract, but
   RC-4 is the one that proves the fix end-to-end.)
8. **Relevant mobile/release-build CI is green** — every PR touching `mobile/` (RC-3, RC-4)
   triggered and passed `mobile (analyze + test)`, `mobile (Android release build proof)`, and
   `mobile (iOS release build proof)` — recorded in the ledger above.
9. **Tenant Isolation/security/auth/RBAC/Commerce authorization contracts remain unchanged and
   intact** — no task in this Horizon touched `TenantScope`/`BelongsToTenant`, `Rbac::MATRIX`/
   `EnsurePermission`, Sanctum or the `commerce/v1` store-bearer mechanism, or any backend
   authorization path. RC-1/RC-2 were docs/PHP-comment-only; RC-3/RC-4 were entirely
   client-side Dart changes inside the mobile runtime's post-compatibility hydration stage, which
   has no access to or interaction with any authorization boundary. Every task's Decision Gate
   check (recorded in the Horizon document's durable state) confirms this explicitly.
10. **All intentional deferrals and remaining risks are documented** — see §4 below.

All ten criteria are evidenced. **Horizon status: CLOSED / PASS.**

## 3. Exact runtime behavior — before / after

**Before this Horizon:**

- A `ProductList` bound to a list-shaped resource (e.g. `commerce.products`) with an `itemProps`
  key and no authored item-template child would publish successfully and pass
  `CompatibilityResolver`, but two integrated-proof tests' own doc comments claimed this proved
  "live"/"genuinely renderable" data binding — it did not; the real runtime's list-repeat branch
  never reads `itemProps` for this shape and would render zero items.
- A `CartSummary` node's live `itemCount`/`subtotalAmountMinor`/`summaryLabel` reached the render
  **only** if the schema author happened to give that node the exact id `slot.cart.summary` — the
  bundled Default AWJ Experience's own id. Any other valid, generically-authored `CartSummary` id
  (confirmed to already exist in the shared LIVE-PREVIEW-7 fixture, id `cart-summary`) kept its
  static, authored-time values (`itemCount: 0`, `subtotalAmountMinor: 0`) forever, regardless of
  the real cart's actual contents.

**After this Horizon:**

- The two tests' doc comments state plainly what they prove (structural acceptance +
  Draft/Validate/Publish/fetch success + `CompatibilityResolver`'s structural/capability verdict)
  and point to the real rendering-proof location instead of claiming it themselves. No behavior
  changed; the wording is now truthful.
- `CartSummary`'s live values reach **any** node of type `CartSummary`, regardless of its authored
  `id` — proven for both a non-default, generically-authored id and the bundled Default schema's
  own historical id, in the same PR, through the real runtime.

## 4. Intentional deferrals (complete list)

- **Real live product/cart data in Builder Preview** — pre-existing deferral from the predecessor
  Live Runtime & Preview V1 horizon (LIVE-PREVIEW-3's Decision Gate), explicitly out of this
  Horizon's scope per its own locked contracts ("do not broaden this horizon into real live
  product/cart data in Builder Preview"). Unchanged by this Horizon.
- **Theme-token wiring, visibility runtime support, customer identity/login, product route-context
  expansion, App Factory, native project generation, signing/certificates, TestFlight/Play
  distribution, App Store/Google Play submission, Production deployment** — all pre-existing,
  explicitly out of scope per this Horizon's own locked contracts and non-goals list. Not
  approached.
- **A schema authoring more than one `CartSummary` node per page** — no repository schema does
  this today (confirmed by RC-1's evidence pass across the bundled Default schema and every
  `contracts/app-builder/*.json` fixture). The generic fix's existing "apply the transform to
  every matching node" behavior would handle this deterministically and additively if it ever
  occurred, per RC-1's analysis, but this remains unexercised by any real schema — a genuine gap
  in coverage, not a known defect. If a future horizon ever needs multiple `CartSummary` nodes
  with materially different intended data contexts (e.g. per-category subtotals), that would be a
  new product decision requiring its own Decision Gate, exactly as this Horizon's own Decision
  Gate list anticipated.
- **`ProductList`/`CartList` other single-item-binding edge cases** — this Horizon fixed
  `CartSummary` specifically because it was the one component the predecessor horizon's evidence
  named. Whether any other component type has a similar hardcoded-id dependency elsewhere in the
  runtime was not investigated — out of this Horizon's narrow scope (RC-1 was explicitly told not
  to perform broad App Builder or runtime discovery).
- **Real-device verification** — has not occurred for this Horizon's changes, consistent with the
  pre-existing constraint recorded before this Horizon began (and before the predecessor horizon).
  CI/release-build proof (green on every PR touching `mobile/`) is accepted engineering evidence
  for this Horizon; real-device verification against a real, controlled tenant remains mandatory
  before any actual mobile distribution.
- **No mobile signing, distribution, TestFlight/Play submission, or Production deployment** —
  never in scope for this Horizon; not approached.

## 5. Backward-compatibility evidence

- **Existing Published Experiences using the historical hardcoded id** (`slot.cart.summary`):
  proven still working via RUNTIME-CORRECTNESS-4's extension of test B — the bundled Default AWJ
  Experience's own Cart screen, navigated to through the real runtime, still shows the correct
  live-computed summary text for its historically-id'd `CartSummary` node.
  `hydrateNodesByType`'s type-based match makes the specific id irrelevant, so this is a structural
  guarantee, not a coincidence: any id, including the historical one, is found the same way.
- **Bundled Default Experience**: identical component tree, identical hydration call sites for
  every other slot (`home-tagline`, `home-go-cart`, `cart-go-home`, `cart-line-template-qty`,
  `cart-line-template-remove` all remain on the unchanged id-keyed `hydrateNode`); only the one
  `CartSummary` call site changed lookup mechanism.
- **Home/Cart runtime behavior**: unaffected outside the one changed call site — `ProductList`/
  `CartList` binding resolution (`binding_resolution.dart`), navigation, and action dispatch were
  not touched by any task in this Horizon.
- **Action/binding/compatibility behavior**: unchanged — `CompatibilityResolver`,
  `resolveNodeBindings`, and `AppSchemaParser` were not modified by any task.
- **Existing mobile boot fallback behavior** (the AWJ Runtime Boot contract's four branches: A/B/C/D
  in `awj_runtime_shell_startup_test.dart`): all four remained green on every PR's CI; test B was
  extended, not altered in its existing assertions.

## 6. Security / Tenant Isolation / RBAC / Commerce authorization status

**Unchanged and intact.** No task in this Horizon touched `TenantScope`, `BelongsToTenant`,
`Rbac::MATRIX`/`EnsurePermission`, Sanctum, the `commerce/v1` store-bearer authentication mechanism,
or any backend authorization path:

- RUNTIME-CORRECTNESS-1 was evidence-only (no code).
- RUNTIME-CORRECTNESS-2 changed only PHP doc-comment text inside two existing test methods — no
  test setup, fixture, or assertion touching tenancy/auth/RBAC was altered.
- RUNTIME-CORRECTNESS-3 and RUNTIME-CORRECTNESS-4 are entirely client-side Dart changes confined to
  the mobile runtime's post-compatibility hydration stage (`experience_hydration.dart`,
  `cart_screen.dart`, and their tests) — a purely local, purely structural tree transform that runs
  strictly after fetch, cache, and `CompatibilityResolver` have already resolved the experience.
  This stage has no network access, no token handling, and no interaction with any backend
  authorization boundary.

Every task's own Decision Gate check (recorded in the Horizon document's durable state) confirms
this explicitly, and none of the 8 Decision Gates defined by this Horizon were ever triggered.

## 7. Risks

**None carried forward that were newly introduced by this Horizon.** All risks below are either
pre-existing (unaffected by this Horizon's work) or were fully resolved by CI before merge:

- The two LIVE-PREVIEW-7 findings that motivated this Horizon are now fixed, not merely documented
  — no residual risk from them remains.
- This session's sandbox has no local Flutter/Dart SDK, so RUNTIME-CORRECTNESS-3/4's Dart changes
  could only be verified by manual trace before push — both were confirmed correct by real CI
  (`mobile (analyze + test)`) on the first attempt with no fix cycle, but this working pattern
  (push-then-verify rather than verify-then-push) is worth naming as this Horizon's one procedural
  risk, now retired by the clean outcome.
- No real-device verification exists yet for this Horizon's changes — the same pre-existing,
  unrelaxed constraint the predecessor horizon recorded.
- The "more than one `CartSummary` node" case remains untested by any real schema (§4) — low risk,
  since the underlying mechanism is already deterministic and additive for that case per RC-1's
  analysis, but genuinely unexercised.

## 8. Real-device verification status

**Still pending**, unchanged from the predecessor horizon's own recorded status. Real-device
verification against a real, controlled tenant remains mandatory before any actual mobile
distribution. Repository CI/release-build proof (green on every PR in this Horizon that touched
`mobile/`) is accepted engineering evidence for this Horizon specifically, per the Horizon's own
"Real-device gate" section — this Horizon does not authorize or relax that constraint.

## 9. Recommended next workstream

In priority order:

1. **Real live product/cart data in Builder Preview** — the highest-value deferred item carried
   forward from the predecessor horizon (LIVE-PREVIEW-8 §6), still unresolved: requires a scoped
   Decision Gate of its own (token-minting vs. a new proxy endpoint vs. another approach) to
   resolve the store-bearer-token auth-boundary question LIVE-PREVIEW-3 originally deferred.
2. **Real-device verification** before any future mobile distribution — the standing constraint
   neither this Horizon nor its predecessor changed or attempted to relax.
3. **Theme-token wiring** from a published experience to the shipped app (`colorPrimary` gap) —
   a mobile-side architectural question, carried forward unresolved from the predecessor horizon.
4. If a real product need for multiple `CartSummary` nodes with distinct data contexts ever
   surfaces, scope it as its own narrow Decision Gate rather than folding it into an unrelated
   horizon — RC-1's evidence already establishes that today's generic mechanism handles the
   "identical aggregate everywhere" case for free, so only a materially different semantic (e.g.
   per-category subtotals) would need new design work.

This Horizon does not authorize or recommend Production deployment or mobile distribution as an
immediate next step — item 2 above is a prerequisite to either, exactly as the predecessor horizon
also concluded.
