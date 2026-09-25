# AWJ App Builder — Live Runtime & Preview V1

**Status:** APPROVED / READY  
**Starting main SHA:** `21c012ef343c755feab012c5d41bd8649e6d549c`  
**Predecessor:** Commerce Data & Dynamic Runtime V1 — CLOSED / PASS  
**Runtime Boot prerequisite:** APP RUNTIME BOOT-1 / PR #1011 — CLOSED / PASS

## Goal

Close the product/runtime loop between Builder, Preview, validation, publishing, and the real AWJ mobile runtime:

```
Builder Draft → Preview → Validate → Publish
→ commerce/v1/experience → Runtime compatibility → Runtime rendering
```

This horizon proves that merchants can preview and publish the same supported declarative semantics that the real AWJ mobile runtime consumes. It does not enter App Factory, signing, distribution, or store submission.

## Locked starting contracts

- `commerce/v1` remains the mobile Commerce API surface.
- Runtime boot contract:
  - Published Experience → `UseFreshExperience`
  - No Published Experience / 404 → `UseDefaultExperience`
  - transient fetch failure + compatible LKG → `UseLastKnownGood`
  - transient fetch failure + no compatible LKG → `ControlledUnavailable`
- 404/no-published is a normal product state, not a fetch failure and never an LKG path.
- Default AWJ Experience is an explicit bundled product/runtime concept.
- Schema remains declarative, versioned, capability-gated, tenant-isolated, and untrusted configuration.
- Capability negotiation remains fail-closed.
- Preserve existing `itemProps`, `binding.collect`, and `$item.*` semantics.
- Current proven runtime resources/features remain limited to already activated capabilities.
- Product route context such as `$route.productId` remains out.
- `customer.profile` and `customer.orders` remain out until customer identity/login is deliberately introduced.
- No arbitrary merchant JavaScript/Dart, eval, SQL, arbitrary HTTP, or executable plugins.
- Tenant Isolation, RBAC, and Commerce authorization must remain intact.
- One Commerce Core, multiple presentation channels: Preview may differ visually from Flutter, but must not invent separate commerce truth or schema semantics.

## Execution model

Execute this horizon as small evidence-driven tasks. Do not implement the entire horizon in one PR. Each task starts from the verified evidence of the prior task. Update this durable state after each completed task with PR, base/head/merge SHA, tests, CI, remaining gaps, and next-task readiness.

Standing authority covers implementation, tests, commits, PRs, merging green dependency-safe task PRs, post-merge verification, and durable documentation within this approved horizon. It does **not** authorize Production deployment, mobile distribution, signing, TestFlight, Play distribution, or App Store/Google Play submission.

## Task queue

| Task | Purpose | State |
|---|---|---|
| LIVE-PREVIEW-1 | Preview Contract Evidence Pass | **DONE / PASS** — see `LIVE-PREVIEW-1-EVIDENCE-PASS.md` |
| LIVE-PREVIEW-2 | Preview / Runtime Semantic Parity Foundation | **DONE / PASS** — see `LIVE-PREVIEW-2-PARITY-FOUNDATION.md` |
| LIVE-PREVIEW-3 | Binding + Collection Preview Parity | **DONE / PASS** — see `LIVE-PREVIEW-3-BINDING-COLLECTION-PARITY.md` |
| LIVE-PREVIEW-4 | Action + Theme + Supported Visibility Parity | **DONE / PASS** — see `LIVE-PREVIEW-4-ACTION-THEME-VISIBILITY-PARITY.md` |
| LIVE-PREVIEW-5 | Runtime-Aware Pre-Publish Validation | **DONE / PASS** — see `LIVE-PREVIEW-5-PREPUBLISH-VALIDATION.md` |
| LIVE-PREVIEW-6 | Draft / Default / Published Preview States | **DONE / PASS** — see `LIVE-PREVIEW-6-PREVIEW-STATES.md` |
| LIVE-PREVIEW-7 | Integrated Builder → Publish → Runtime Proof | **DONE / PASS** — see `LIVE-PREVIEW-7-INTEGRATED-PROOF.md` |
| LIVE-PREVIEW-8 | Horizon Closure / Durable Documentation | READY |

### LIVE-PREVIEW-1 — Preview Contract Evidence Pass

Inspect only the files/contracts necessary to establish current Builder Preview versus proven Flutter Runtime behavior. Determine:

- what Preview currently renders and which schema/version it consumes;
- current Preview interpretation of component structure and theme tokens;
- bindings, `binding.collect`, `itemProps`, and `$item.*`;
- visibility semantics;
- action representation/dispatch semantics;
- compatibility/capability checks;
- whether Default AWJ Experience can be previewed;
- concrete places where Preview and live runtime can diverge;
- security/Tenant Isolation implications.

Deliver an evidence-backed gap matrix, the smallest recommended parity approach, and either `LIVE-PREVIEW-2 READY` or a Decision Gate.

**Evidence pass only. Do not rewrite Preview in this task.**

### LIVE-PREVIEW-2 — Preview / Runtime Semantic Parity Foundation

After LP-1 review, establish the smallest shared/derived contract needed so Preview does not become an independent schema interpreter. Semantic parity is required; pixel-identical Web/Flutter rendering is not.

### LIVE-PREVIEW-3 — Binding + Collection Preview Parity

Prove supported Preview semantics for `commerce.products`, `commerce.cart`, `binding.collect`, `itemProps`, and item-scoped substitution already supported by Runtime.

### LIVE-PREVIEW-4 — Action + Theme + Supported Visibility Parity

Align only already-supported action/theme/visibility semantics. Unsupported capabilities must be explicit/fail-closed rather than simulated as working.

### LIVE-PREVIEW-5 — Runtime-Aware Pre-Publish Validation

Inspect existing validation first. Strengthen the existing Validate → Publish boundary only where evidence shows a gap. Reuse existing schema/version/capability contracts; do not create duplicate validators.

### LIVE-PREVIEW-6 — Preview States

Make Draft, Default AWJ Experience, and currently Published Experience states unambiguous where appropriate. Preview must never imply that a draft is an actual production/mobile release.

### LIVE-PREVIEW-7 — Integrated Proof

Prove, using real contracts wherever feasible:

```
Builder Draft
→ Preview
→ Validate
→ Publish
→ commerce/v1/experience
→ real startup resolver
→ runtime compatibility
→ runtime rendering
```

Isolated unit tests alone are insufficient for the horizon's end-to-end claim.

> **Note (owner decision resolving LIVE-PREVIEW-3's Decision Gate, 2026-09-25):** LIVE-PREVIEW-3
> proves binding/collection resolution semantics using clearly labeled representative/sample
> data (not live merchant data) — see "Current durable state" below. That sample-data proof does
> **not** satisfy this task. LIVE-PREVIEW-7 still requires real contracts wherever feasible, and
> must not claim LP-3's sample-data evidence as proof of live merchant-data Preview parity.

### LIVE-PREVIEW-8 — Closure

Close only after exit criteria are evidenced and durable state records all intentional deferrals.

## Decision Gates

Stop and report a narrow evidence-based Decision Gate rather than implementing speculative architecture if:

1. Preview and Flutter require fundamentally incompatible schema semantics.
2. Parity would require a second independent interpreter rather than sharing/deriving the established contract.
3. A required runtime feature is not capability-gated.
4. The task requires Product route context or customer identity outside this horizon.
5. Pre-publish safety requires a material public schema/API contract change.
6. Tenant Isolation, RBAC, or Commerce authorization would need to change.
7. The solution requires arbitrary executable merchant code.
8. Scope expands into App Factory, signing, distribution, store submission, or Production deployment.

## Non-goals

- App Factory / native project generation / white-label generation
- Apple or Android signing
- certificates/profiles
- TestFlight / Play Internal Testing
- App Store / Google Play submission
- Production mobile release/deployment
- arbitrary merchant code or general-purpose expression engine
- customer identity/login, customer profile/orders
- Product route-context expansion
- broad storefront redesign
- unrelated ERP refactoring

## Testing and CI

For implementation tasks: focused tests → relevant integration/widget tests → analyze/typecheck → broader affected suite → CI → post-merge verification.

Do not weaken tests for Tenant Isolation, security, schema compatibility, runtime fallback, or publishing. Do not repeatedly poll CI. An unrelated pre-existing failure must be proven unrelated before any out-of-scope change is considered.

## Real-device gate

Repository release-mode CI/build proof remains valid engineering evidence during this horizon. Separately, **real-device verification is mandatory before the first actual mobile distribution**. That later operational gate should use a controlled real tenant and cover startup, Published/Default behavior, network/LKG behavior where safely testable, Home/Cart rendering, bindings/collection hydration, and actions/mutations.

This horizon does not authorize distribution.

## Exit criteria

The horizon is CLOSED / PASS only when evidence proves:

1. the real mobile boot contract remains green;
2. Preview semantics are documented and aligned with the supported Runtime contract;
3. supported binding/collection semantics do not silently diverge;
4. supported actions/theme/visibility do not silently diverge;
5. pre-publish validation rejects unsupported/incompatible Runtime schemas fail-closed;
6. Draft / Default / Published Preview states are unambiguous;
7. integrated evidence proves Builder → Preview → Validate → Publish → `commerce/v1/experience` → Runtime;
8. relevant CI is green;
9. Tenant Isolation/security guarantees remain intact;
10. intentional deferrals are explicitly documented.

## Current durable state

- Starting main SHA: `21c012ef343c755feab012c5d41bd8649e6d549c`
- APP RUNTIME BOOT-1: PASS
- PR #1011: merged
- Backend CI: green
- Mobile CI: green
- Android/iOS release-build proof: green
- **LIVE-PREVIEW-1: DONE / PASS** (evidence-only, no code changed) — full report:
  `docs/plans/app-builder/LIVE-PREVIEW-1-EVIDENCE-PASS.md`. Headline findings: Preview
  (`web/src/modules/app-builder/canvas.tsx`) renders the live draft's component/theme structure
  correctly (registry parity confirmed), but never evaluates `binding`/`collect`/`itemProps`/
  `$item.*` (already live for `commerce.products`/`commerce.cart`), never evaluates
  `visibility`, never dispatches/distinguishes wired-vs-inert `action`s, never runs
  `CompatibilityResolver` during editing (only at explicit Validate/Publish, where it already IS
  the real, shared check), cannot preview a Published version or the Default AWJ Experience, and
  the Theme panel's tokens have ~zero live effect on the shipped runtime today (key mismatch:
  Builder writes `primaryColor`, runtime reads `colorPrimary` from the bundled Default schema
  only, never from a tenant's published experience). No Decision Gate triggered (all 8 checked).
- **LIVE-PREVIEW-2: DONE / PASS** — full report:
  `docs/plans/app-builder/LIVE-PREVIEW-2-PARITY-FOUNDATION.md`. PR #1014. Base SHA:
  `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4`. **Merge SHA: `53bfc74dd7b6bc77fa4ff6fdf08bf0625ca136c9`**
  (squash-merged; verified via `get_commit` against `main`). Adds
  `web/src/modules/app-builder/runtime-contract.ts` (a documented, narrow TypeScript port of
  `mobile/lib/app/binding_resolution.dart`'s binding resolution + visibility evaluation — not yet
  wired into `canvas.tsx`, per the horizon's own LP-2/LP-3 split), a single canonical conformance
  fixture (`contracts/app-builder/binding-visibility-conformance.v1.json`, 23 cases) asserted from
  both `web/src/modules/app-builder/runtime-contract.test.ts` and
  `mobile/test/app/binding_visibility_conformance_test.dart`, both CI workflows' path triggers
  extended to cover the shared fixture, and an additive `AppSchemaBinding.collect` field on the
  web schema type (was missing entirely). **CI evidence (all green on PR head
  `644ad7bffe53836b3b3b19c332bec64cbfb91dc9`, 12/12 check runs)**: `mobile (analyze + test)` ✅
  (the authoritative confirmation that `binding_visibility_conformance_test.dart` passes —
  unverifiable locally, no Flutter toolchain in-session), `mobile (Android/iOS release build
  proof)` ✅, `web build (Next.js)` ✅, `php artisan test (L11, sqlite/pgsql)` ✅ (unaffected,
  triggered because `ci.yml` has no path filter). No Decision Gate triggered; no capability
  broadened; fail-closed semantics preserved (see the report's dedicated fixture cases).
- **LIVE-PREVIEW-3 — Binding + Collection Preview Parity: DECISION GATE RESOLVED (owner decision,
  2026-09-25) — Option 3 approved, then implemented. DONE / PASS — see below for PR/evidence.**
  While scoping which data LP-3 should feed `resolveNodeBindings` for a live Preview render,
  reading `app/Services/AppBuilder/DataResourceRegistry.php` found that `commerce.products`
  resolves to `GET commerce/v1/products` (`CommerceProductController`) — the **public
  `commerce/v1` storefront surface**, authenticated by `ResourceDefinition::AUTH_STORE_BEARER`
  (a per-channel store-bearer token; the same surface the real Flutter runtime itself calls),
  **not** the merchant's own Sanctum session the Builder UI is authenticated with. This is a
  materially different situation from the one LIVE-PREVIEW-1 §11 anticipated and recommended
  ("reuse the tenant-scoped, already-authorized commerce endpoints... exactly as `ThemePanel`'s
  'Use my store design' flow already does") — that flow calls `commerce/workspace/*`
  (`commerce.manage`-gated, same Sanctum auth as the rest of the app); there is no equivalent
  Sanctum-authenticated internal endpoint already in use by the web app for reading
  `commerce/v1/products`-shaped product data. Three options were put to the owner:
  (a) mint/forward a store-bearer token from a merchant's Builder session (a new,
  security-sensitive auth path); (b) a new Sanctum-authenticated internal endpoint proxying
  `commerce/v1/products`-equivalent data (new API surface); (c) representative/sample data only,
  shaped to the real resource contracts, for both `commerce.products` and `commerce.cart`.

  **Owner approved option (c).** LIVE-PREVIEW-3's scope is therefore fixed as follows:
  - Preview feeds `resolveNodeBindings` **clearly labeled representative/sample data**, shaped to
    exactly match `DataResourceRegistry`'s real field contracts for `commerce.products` (list
    shape: `id/name/description/sku/category/price/in_stock/thumbnail_url/...`) and
    `commerce.cart` (single shape: `status/items/subtotal/currency/...`) — sufficient to prove
    `binding.collect`, `itemProps`, and `$item.*` resolve identically to the real runtime for any
    schema that declares them, without claiming the *values* shown are a real tenant's data.
  - **Sample/representative data is not live merchant data**, and **Preview must visibly
    communicate this** (a persistent, unambiguous label/badge in the bound-preview UI — never a
    silent assumption merchants could mistake for their real catalog/cart).
  - **No store-bearer token minting or forwarding**, from the Builder session or anywhere else in
    this task.
  - **No new Sanctum-authenticated internal proxy endpoint**, or any other new backend route, for
    fetching real commerce data into Preview.
  - **No RBAC, Tenant Isolation, Commerce authorization, public API, or schema-surface expansion**
    of any kind in this task — `resolveNodeBindings`'s pure function signature already accepts
    caller-supplied `resourceData`; LP-3 only needs to supply that argument, never a new fetch
    path, new route, new permission, or new schema field beyond LP-2's already-landed
    `AppSchemaBinding.collect`.
  - **Real live product/cart data in Builder Preview is intentionally deferred** to a separately
    scoped follow-up task, not silently dropped — to be scoped only after a deliberate decision
    on which of options (a)/(b) above (or another mechanism) is acceptable, outside this horizon
    task unless the owner later folds it back in explicitly.
  - **This does not touch LIVE-PREVIEW-7 or the horizon's exit criteria.** LIVE-PREVIEW-7 must
    still prove the integrated Builder → Preview → Validate → Publish → `commerce/v1/experience`
    → real startup resolver → runtime compatibility → runtime rendering flow using real contracts
    wherever feasible (its own text, unchanged, below). LP-3's sample data proves Preview's
    *binding/collection resolution semantics* match the runtime's, in isolation from live data —
    it must never be cited, here or in LP-7/LP-8, as evidence that Preview shows live merchant
    data, and does not relax exit-criteria item 7's own "integrated evidence... using real
    contracts" bar.

  **Implementation — DONE / PASS.** Full report: `docs/plans/app-builder/
  LIVE-PREVIEW-3-BINDING-COLLECTION-PARITY.md`. PR #1019 (squash-merged). Base SHA:
  `41b53fdb96a828276c6e1a1b532126302325f403`. **Merge SHA:
  `e906d48c022fbfd8f3671833b7db78caebd87dd5`** (verified via `get_commit` against `main`).
  CI: 6/6 checks green (`web build (Next.js)` ×2, `php artisan test (L11, sqlite/pgsql)` ×2 —
  unaffected, `ci.yml` has no path filter; `mobile-ci.yml` correctly did not trigger — web-only
  diff). Adds `web/src/modules/app-builder/
  sample-resource-data.ts` (static, hardcoded, field-for-field matching
  `DataResourceRegistry`'s real contracts — no fetch, no network, no store-bearer token) and
  wires it through LP-2's `resolveNodeBindings` into `canvas.tsx`'s render path, plus a
  persistent "sample data, not live" banner (new `sampleDataBanner` i18n key, both locales)
  whenever the current page has any `binding` node, plus a `knownIds`/`selectFallbackId` fix so
  clicking a repeated (`binding.collect`) instance in Preview maps back to the bound container's
  real schema id instead of a synthetic, non-existent one. Web-only change — no backend, no
  mobile file touched; `web-ci.yml` is the only relevant CI. Evidence: focused
  `src/modules/app-builder` suite 3 files / 32 tests green (24 pre-existing + 3 new
  `sample-resource-data.test.ts` + 5 new `canvas.test.tsx`), broader app-builder suite 7 files /
  73 tests green (including the pre-existing 27-test `builder/page.test.tsx`, unaffected), full
  web suite 298 files / 2111 tests green, `npm run build` clean. No Decision Gate triggered by
  the implementation itself (the gate was already resolved above); no capability broadened; all
  six owner-mandated guardrails verified against the actual diff (see the report's own
  "Owner-mandated guardrails — verified, not just asserted" section).
- **LIVE-PREVIEW-4 — Action + Theme + Supported Visibility Parity: DONE / PASS.** Full report:
  `docs/plans/app-builder/LIVE-PREVIEW-4-ACTION-THEME-VISIBILITY-PARITY.md`. PR #1022
  (squash-merged). Base SHA: `e906d48c022fbfd8f3671833b7db78caebd87dd5`. **Merge SHA:
  `fcb0e20b2b5c4cad8df9469e18d6d0d23002e2c9`** (verified via `get_commit` against `main`; two
  unrelated storefront PRs, #1020/#1021, landed on `main` between LP-3 and LP-4 — merged cleanly,
  no conflict). CI: 6/6 checks green. **Deliberately does
  not** wire `evaluateVisibility`/`pruneInvisible` into rendering — `RuntimeCapabilities.
  schemaFeatures` has no `'visibility'` entry on either Dart or PHP side, so the real runtime
  does not evaluate visibility at all today; doing so in Preview would simulate an unsupported
  capability, which this task's own governing instruction forbids. Instead: (1) actionable
  components (`Button`/`AddToCart`/`ProductCard`/`NavigationTarget`) now dim to 50% opacity when
  `!node.action`, matching `component_widgets.dart`'s real inert-vs-wired visual distinction —
  `Quantity` deliberately excluded (its real widget never dims on action absence); (2) any node
  carrying `visibility` gets an always-visible "not yet active" badge while still always
  rendering unconditionally — explicit-and-unevaluated, never simulated; (3) `ThemePanel` gains
  a `runtimeNote` (matching binding/visibility's existing pattern) stating plainly that a
  published experience's colors do not reach the shipped app yet — the `primaryColor`/
  `colorPrimary` key mismatch is deliberately **not** "fixed" by renaming, since
  `mobile/lib/app.dart` seeds its color only once from the bundled compile-time Default schema
  (`kHomeSchemaJson`), never from any tenant's own published/fetched experience — a key rename
  would falsely imply a capability that doesn't exist end-to-end; the real gap is a mobile-side
  architecture question, recorded as an out-of-scope deferral, not silently dropped. Web-only
  change — no backend, no mobile file touched. Evidence: focused `canvas.test.tsx` 9/9 (4 new),
  broader app-builder suite 8 files / 80 tests green, full web suite 299 files / 2118 tests
  green, `npm run build` clean. No Decision Gate triggered; no capability broadened (this task
  narrows an implicit overclaim, if anything).
- **LIVE-PREVIEW-5 — Runtime-Aware Pre-Publish Validation: DONE / PASS.** PR #1024
  (squash-merged). Full report: `docs/plans/app-builder/
  LIVE-PREVIEW-5-PREPUBLISH-VALIDATION.md`. Base SHA: `fcb0e20b2b5c4cad8df9469e18d6d0d23002e2c9`.
  **Merge SHA: `d565161dff81b65174fbb2fab443871176eb3940`** (verified via `get_commit`). CI: 4/4
  checks green (`php artisan test (L11, sqlite/pgsql)` ×2). Inspected first, per the task's own
  instruction — the Validate/Publish gate itself
  (`BuilderPublishedExperienceVersionService` → real, shared `CompatibilityResolver`) was
  already correct (LP-1 §6); the actual gap found was diagnostic, not behavioral: a *required*
  (non-optional) unsupported node's publish failure named only the page, never the offending
  node, unlike the already-detailed optional/fallback path. `CompatibilityResolver.php`'s
  `resolveComponent()` gained one by-reference output parameter recording the exact
  `componentId`/`componentType` at the point of failure (cleared when absorbed as a safe
  optional fallback instead), and `resolve()`'s message now names it. `reason` constants and
  every compatible/incompatible/fallback code path are otherwise byte-for-byte unchanged — one
  string got more specific, nothing else. PHP-only change; `mobile/lib/schema/compatibility.dart`
  deliberately left as-is (that message is never merchant-facing — mobile only shows a generic
  `ControlledUnavailable` state, proven under the separate, already-closed APP RUNTIME BOOT-1
  horizon). Evidence: `php artisan test --filter=CompatibilityResolverTest` 38/38 (59
  assertions); `--filter="AppSchemaParserTest|AppBuilderIntegratedProofTest|
  AppBuilderSameStoreProofTest|BuilderAppTest|AppBuilderRegistryTest"` 67/67 (251 assertions).
  Full local `php artisan test`: 4703 passed / 35 failed / 49 skipped — **all 35 failures
  confirmed unrelated**: `Call to undefined function App\Services\bcmul()` — this session's
  sandbox PHP build has no `ext-bcmath` (`php -m` confirms), and `bcmul`/`bcadd`/`bcdiv`/`bcsub`/
  `bccomp` are used **only** in `app/Services/FuelCostBasisService.php` (Fuel/Petroleum
  logistics costing — `grep -rl bcmul app/Services` returns exactly that one file), consumed
  only by `FuelAviRfidServiceTest`/`FuelReconciliationTest`/`FuelSupplyReceivingTest`/
  `FuelSupplyReceivingApiTest`/`FuelSaleServiceTest`/`FuelSaleApiTest` — none of which this
  task's one-file diff (`CompatibilityResolver.php`) could plausibly touch, and all of which
  already passed on every prior PR's real `ci.yml` run this session (which does have
  `ext-bcmath`). Real CI (`php artisan test (L11, sqlite/pgsql)`) is the authoritative check for
  this PR, matching how Dart/Flutter's absence was handled in LP-2/LP-3. No Decision Gate
  triggered; no schema/API/RBAC/Tenant Isolation/Commerce authorization change; no financial/
  accounting rule changed (this file has no ledger-affecting code path).
- **LIVE-PREVIEW-6 — Draft / Default / Published Preview States: DONE / PASS** (implementation
  complete; PR pending). Full report: `docs/plans/app-builder/LIVE-PREVIEW-6-PREVIEW-STATES.md`.
  Base SHA: `d565161dff81b65174fbb2fab443871176eb3940` (LP-5's merge commit). Closed the gap
  LIVE-PREVIEW-1 §7 identified: Preview had no way to show either the Default AWJ Experience
  (the mobile app's own bundled `kHomeSchemaJson`/`kCartSchemaJson`) or a merchant's last
  Published version — only the live draft, unlabeled as such. Built (1)
  `web/src/modules/app-builder/default-experience.ts`: a static, client-side-only, byte-identical
  mirror of the bundled mobile schema, verified against `mobile/lib/app/runtime_schema.dart`'s
  plain-text source via a new conformance test (same discipline as LP-2's fixture — no Flutter
  toolchain needed since it's a compile-time string literal); (2) a 3-way Draft/Published/Default
  switcher in `builder/page.tsx`, reusing the **existing** `GET .../versions` +
  `GET .../versions/{version}` endpoints (no new backend route) to fetch/cache the latest
  published version; (3) every edit affordance (Save/Undo/Redo/Publish/page add-remove/Inspector)
  disabled and swapped for read-only panels whenever a non-draft state is viewed — no code path
  can reach an `apply*` mutator against a non-draft schema; (4) a persistent `stateBanner` on
  `AppBuilderCanvas` (new optional prop) naming which version is shown, with the draft banner
  explicitly stating it is "not a live version in the mobile app." Web-only change — no backend,
  no mobile file touched. Evidence: `default-experience.test.ts` 3/3 new; `page.test.tsx` 3 new
  cases (Default renders with zero extra API calls; Published fetches list-then-detail and
  disables all edit controls; Published tab disabled with no published version) alongside all 27
  pre-existing cases unmodified — 30/30; broader app-builder suite 9 files / 86 tests green; full
  web suite 300 files / 2124 tests green; `npm run build` clean. No Decision Gate triggered: no
  new route, no schema/API contract change (existing endpoints, existing shapes), no capability
  broadened (strictly read-only presentation of already-returned data), no Tenant
  Isolation/RBAC/Commerce authorization/auth-token surface touched.
- **LIVE-PREVIEW-6 — Draft / Default / Published Preview States: DONE / PASS.** PR #1026
  (squash-merged). **Merge SHA: `d3dcf8f803034a9296aada58fcb89fbb437f52a8`** (verified via
  `get_commit`). CI: 6/6 checks green (`php artisan test (L11, sqlite/pgsql)` ×2, `web build
  (Next.js)` ×2 across two workflow triggers). Full report in the LIVE-PREVIEW-6 entry above.
- **LIVE-PREVIEW-7 — Integrated Builder → Publish → Runtime Proof: DONE / PASS** (implementation
  complete; PR pending). Full report: `docs/plans/app-builder/LIVE-PREVIEW-7-INTEGRATED-PROOF.md`.
  Base SHA: `d3dcf8f803034a9296aada58fcb89fbb437f52a8` (LP-6's merge commit). Closed the gap
  LIVE-PREVIEW-1 §7 named: no test previously used the *same* schema document across the backend
  chain, Preview, and the real Dart runtime chain — each existing proof test
  (`AppBuilderIntegratedProofTest`, `AppBuilderSameStoreProofTest`, `awj_runtime_shell_startup_
  test.dart`) used its own bespoke fixture. Built one canonical shared fixture,
  `contracts/app-builder/integrated-proof-schema.v1.json`, asserted byte-identically by three new
  test suites: (1) `AppBuilderPreviewToRuntimeIntegratedProofTest.php` — real HTTP round trip,
  Draft → Validate → Publish → real `GET commerce/v1/experience` fetch → `CompatibilityResolver`,
  asserting byte-identical schema at every stage and `compatible === true` with zero fallbacks;
  (2) `web/.../integrated-proof-schema.test.tsx` — renders the fixture through the real
  `AppBuilderCanvas` Preview component, asserting the marker text and real hydrated
  product/cart-line content; (3) a new `group('E — ...')` in
  `awj_runtime_shell_startup_test.dart` — a fake `commerce/v1` transport serving the fixture plus
  real-shaped product/cart data, pumping the real `AwjRuntimeShell`, asserting the marker text and
  hydrated bindings render via the real startup resolver/compatibility/rendering pipeline, then
  tapping through to Cart to prove `binding.collect` there too. Same-fixture discipline mirrors
  LIVE-PREVIEW-2's shared-conformance-fixture pattern, applied to one whole document instead of
  individual cases — no single test can span PHP/TypeScript/Dart in one process. Deliberately uses
  only the binding grammar proven to actually hydrate on-device (`binding.resource` + child
  template, no bare `collect`-free `itemProps` on a list-shaped resource) — the evidence pass
  reading `binding_resolution.dart` line-by-line found that the OTHER two existing PHP proof
  tests' own `itemProps`-on-`ProductList`-with-no-children grammar does **not** actually hydrate
  any items on the real runtime (structurally valid, publishes successfully, renders empty on
  device) — recorded as an out-of-scope finding (those tests' own doc comments overclaim; no
  behavior change needed since they never assert rendering). A second finding: `HomeScreen`/
  `CartScreen`'s `hydrateNode(..., 'slot.cart.summary', ...)`-style calls target hardcoded ids
  from the bundled default schema only, so a generically-authored Published Experience's
  `CartSummary` never gets its `itemCount`/`subtotal` live-recomputed unless it happens to reuse
  that exact id — recorded as a deferred architectural question (fixing it generically is a real
  runtime-rendering behavior change, reserved for owner review), not attempted. No PHP file in
  the existing pipeline was modified — only new fixtures/tests added. Evidence: PHP
  `--filter=AppBuilderPreviewToRuntimeIntegratedProofTest` 2/2 (29 assertions); web
  `integrated-proof-schema.test.tsx` 3/3; full web suite 301 files / 2127 tests green; `npm run
  build` clean; full `php artisan test`: 4705 passed / 35 failed / 49 skipped (29605 assertions)
  — 2 more passing than LP-6's 4703 baseline, matching this task's 2 new PHP tests, identical
  pre-existing bcmath failures, zero regressions; Dart suite reviewed
  line-by-line against real rendering code (no Flutter toolchain in this sandbox, same
  environment limitation as every prior task's mobile-side work — real CI is authoritative). No
  Decision Gate triggered: no new route, no schema/API/auth change, no capability broadened, no
  Tenant Isolation/RBAC/Commerce authorization touched, no production rendering code changed —
  both findings above are recorded, not implemented.
- Next task once LP-7's PR merges: **LIVE-PREVIEW-8 — Horizon Closure / Durable Documentation**.
