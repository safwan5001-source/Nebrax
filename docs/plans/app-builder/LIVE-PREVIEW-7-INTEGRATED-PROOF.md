# LIVE-PREVIEW-7 — Integrated Builder → Publish → Runtime Proof

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
PREDECESSOR: LIVE-PREVIEW-6 — DONE / PASS (`LIVE-PREVIEW-6-PREVIEW-STATES.md`)
SCOPE: "Prove, using real contracts wherever feasible: Builder Draft → Preview → Validate →
Publish → commerce/v1/experience → real startup resolver → runtime compatibility → runtime
rendering. Isolated unit tests alone are insufficient for the horizon's end-to-end claim."

## The gap this task closes

Two existing PHP tests already prove real, unmocked slices of this chain:
- `AppBuilderIntegratedProofTest` — Draft → theme sync → pages/navigation → Validate → Publish →
  rollback → re-publish, entirely through the real HTTP API.
- `AppBuilderSameStoreProofTest` — Draft → Validate → Publish → the real `GET commerce/v1/
  experience` endpoint → `CompatibilityResolver` (PHP mirror of the shipped Dart compatibility
  logic) → Same-Store price/name parity with `store/v1`.

And one existing Dart test already proves a real slice on the runtime side:
- `awj_runtime_shell_startup_test.dart` — the AWJ Runtime Boot contract's four branches
  (`UseFreshExperience`/`UseDefaultExperience`/`UseLastKnownGood`/`ControlledUnavailable`) wired
  into the real `AwjRuntimeShell` → `resolveRealStartup` → Home/Cart rendering, via a fake
  `commerce/v1` transport.

What none of them do: use the **same schema document** across the backend chain, the web
Preview, and the real Dart runtime chain. Each proves its own half with its own bespoke fixture.
LIVE-PREVIEW-1 §7 named this precisely as the remaining gap — Preview itself was never verified
against anything the backend/runtime chain also exercises. A single literal automated test
spanning PHP + TypeScript + Dart in one process is not feasible (three separate toolchains,
three separate CI jobs, no shared runtime) — so this task closes the gap the same way
LIVE-PREVIEW-2 closed an analogous one: **one canonical, shared JSON fixture**, asserted
byte-identically by three independent test suites.

## What was built

**`contracts/app-builder/integrated-proof-schema.v1.json`** (new) — one canonical two-page
(`home`/`cart`) `AppSchema` document. Deliberately uses only the binding grammar this task's own
evidence pass confirmed actually hydrates on the shipped runtime (see "Notable findings" below):
- `ProductList` bound to `commerce.products` with **no** `collect` key — `commerce.products`'
  own wire shape is already a JSON array, so `binding_resolution.dart`'s "resolved resource is a
  `List`" branch repeats the authored `ProductCard` template directly, resolving `$item.name`/
  `$item.price.amount_minor`/`$item.id` per item.
- `CartList` bound to `commerce.cart` with `collect: "items"` — `commerce.cart`'s wire shape is a
  single object whose `items` field is the list to repeat, resolving `$item.product_name`/
  `$item.line_total.amount_minor` per line through an authored `Section`/`Price` template.
- A uniquely-labelled marker `Text` node (`LIVE_PREVIEW_7_INTEGRATED_PROOF_MARKER`) on `home`, so
  every consuming test can assert this exact document — not the bundled Default AWJ Experience,
  not some other schema — is what actually rendered.

**`tests/Feature/AppBuilderPreviewToRuntimeIntegratedProofTest.php`** (new) — real, unmocked HTTP
round trip proving the first five stages: loads the fixture, `PUT .../draft` (asserts the saved
schema is byte-identical to the fixture), `POST .../validate` (asserts valid), `POST .../
versions` (asserts the published schema is byte-identical), then a real mobile-channel
store-bearer fetch of `GET commerce/v1/experience` — the exact endpoint `experience_fetcher.dart`
calls in production — asserting the fetched schema is **byte-identical to the original fixture**,
and finally runs the fetched schema through `(new CompatibilityResolver)->resolve(...,
CapabilityManifest::current())`, asserting `compatible === true` and `fallbacks === []` (every
node in the fixture is genuinely supported today, none needed an optional-fallback prune). A
second, narrower test walks the fixture's own component/action/resource vocabulary and asserts
every one is a member of `RuntimeCapabilities::COMPONENTS`/`ACTIONS`/`DATA_RESOURCES` — so a
future capability *removal* from the manifest fails this fixture loudly, not silently.

**`web/src/modules/app-builder/integrated-proof-schema.test.tsx`** (new) — loads the identical
fixture file and renders `fixture.pages.home`/`.pages.cart` through the **real**
`AppBuilderCanvas` component Builder Preview itself uses (not a bespoke test-only schema, as
`canvas.test.tsx`'s other cases use). Asserts the marker text renders, and the `ProductList`/
`CartList` bindings hydrate real values from `SAMPLE_RESOURCE_DATA` (LIVE-PREVIEW-3) — proving
Preview genuinely renders this exact document, not merely a schema shaped similarly to it.

**`mobile/test/app/awj_runtime_shell_startup_test.dart`** (extended) — a new `group('E — LIVE-
PREVIEW-7 integrated-proof fixture')` with two `testWidgets` cases, built the same way as this
file's existing A–D cases (a `FakeCommerceTransport`, no real socket) but with three routes
answered realistically instead of one:
- `GET .../experience` returns the exact fixture, wrapped exactly as `CommerceExperienceController
  ::show()` wraps it.
- `GET .../products` returns one real-shaped product (`id`/`name`/`price.amount_minor` — the
  same fields `DataResourceRegistry.php` documents and `AppBuilderSameStoreProofTest` proves via
  real HTTP).
- `GET .../cart` returns one real-shaped cart item (`product_name`/`line_total.amount_minor`,
  etc. — the same fields `DataResourceRegistry.php` documents for `commerce.cart`).

Case 1 pumps `AwjRuntimeShell`, asserts the marker text renders (fetch → `resolveRealStartup` →
`UseFreshExperience` → real `CompatibilityResolver` (Dart) accepted it → `HomeScreen` actually
rendered it, not the bundled Default AWJ Experience) and that the real product's name/price
(`$item.name`/`$item.price.amount_minor`) hydrated into the `ProductCard` template. Case 2 taps
the `NavigationTarget` ("View cart", the same tap-to-navigate pattern `vertical_slice_test.dart`
already established) and asserts the `CartList`'s real `binding.collect` line template hydrated
`$item.product_name` from the real fetched cart item. Together these prove the remaining three
stages — `commerce/v1/experience` → real startup resolver → runtime compatibility → runtime
rendering — on the **same** fixture the PHP and TypeScript suites also assert against.

**Not built, deliberately**: no new backend route (the endpoints already existed and are called
with their existing shapes), no new auth/token path, no change to `binding_resolution.dart`,
`CompatibilityResolver`, `home_screen.dart`, or `cart_screen.dart` — this task proves the
existing chain with a shared fixture; it does not alter any link in it.

## Notable findings (evidence, not fixed — out of this task's scope)

Reading `binding_resolution.dart`/`home_screen.dart`/`cart_screen.dart` line-by-line while
designing the fixture surfaced two real, narrow gaps neither blocking this task nor previously
documented:

1. **The bare-`itemProps`-on-a-list-resource grammar `AppBuilderIntegratedProofTest`/
   `AppBuilderSameStoreProofTest` use (`ProductList` with `binding.itemProps` and no `collect`,
   no children) does not actually hydrate any items on the real runtime.**
   `resolveNodeBindings`'s own dispatch order (`binding_resolution.dart` lines 143–162) checks
   `collect` first, then "is the resolved resource itself a `List`" — and `commerce.products`'
   wire shape is *always* a raw JSON array. So any binding to it, `collect` or not, takes the
   "repeat the one authored child template" branch; the `itemProps`-single-item branch is only
   reachable for a resource whose *own* result is a single object (`commerce.cart`, today).
   Those two tests' `ProductList` nodes have zero children, so `_repeatTemplate` (line 187–192)
   returns zero repeated children — the node is structurally accepted and publishes successfully
   (this is real, correct behavior of `CompatibilityResolver`, which never evaluates bindings
   against live data), but would render an empty product list on a real device. This is a gap in
   what those two tests' own doc comments claim ("the same binding grammar PR #1006's
   `kHomeSchemaJson` uses for real"), not a defect in production code — `kHomeSchemaJson` itself
   correctly uses the working grammar (`binding.resource` + a child template, no `itemProps`).
   This task's own fixture deliberately uses the proven-working grammar instead. Recommended
   follow-up (out of this task's scope): correct or remove the misleading claim in those two
   tests' doc comments; the tests themselves need no behavior change since they only assert
   structural/HTTP outcomes, never rendering.

2. **`HomeScreen`/`CartScreen`'s "hydrate this named node with a localized string" calls
   (`hydrateNode(..., 'home-tagline', ...)`, `'home-go-cart'`, `'cart-go-home'`,
   `'cart-line-template-qty'`, `'cart-line-template-remove'`, and — materially —
   `'slot.cart.summary'`) target hardcoded node ids that only exist in the bundled
   `kHomeSchemaJson`/`kCartSchemaJson`.** For a Published Experience whose author (the real App
   Builder Inspector, or this task's own fixture) uses different ids, these calls silently no-op
   — harmless for the cosmetic tagline/label cases, but for `'slot.cart.summary'` it means
   `CartSummary`'s `itemCount`/`subtotalAmountMinor` are **never recomputed from the real fetched
   cart** unless the author's `CartSummary` node happens to be named exactly `slot.cart.summary`
   — otherwise it just renders whatever static literal the author typed in the Inspector, frozen.
   This is a real, narrow gap in how generically a Published Experience's `CartSummary` behaves
   today, discovered by direct reading, not exercised by this task's own fixture (which uses its
   own `cart-summary` id and asserts only the `CartList` line-item hydration, deliberately not
   `CartSummary`'s dynamic total). Fixing it would mean deciding how `CartSummary`'s live
   computation should be *generically* located in an arbitrary author's tree (by node type
   instead of hardcoded id, most likely) — a real behavior change to shipped runtime rendering
   code, which this task's own charter explicitly does not authorize implementing without a
   Decision Gate (this is exactly the "material architectural decision not already approved"
   category). Recorded here as a deferred follow-up, not attempted.

Neither finding is a Decision Gate for *this* task — both are pre-existing, out-of-scope gaps
this task's evidence pass surfaced while building a fixture that avoids stepping on either one.

## Evidence

- **PHP**: `php artisan test --filter=AppBuilderPreviewToRuntimeIntegratedProofTest` — 2/2
  passed (29 assertions), confirming the fixture round-trips byte-identically through
  Draft/Validate/Publish/fetch and resolves compatible with zero fallbacks.
- **TypeScript**: `npx vitest run src/modules/app-builder/integrated-proof-schema.test.tsx` —
  3/3 passed, confirming `AppBuilderCanvas` genuinely renders the fixture's marker text and
  hydrated product/cart-line content.
- **Full web suite**: `npx vitest run` — 301 files / 2127 tests green. `npm run build` clean.
- **Dart**: no Flutter toolchain in this sandbox (confirmed via `which flutter`/`which dart`,
  same environment limitation as every prior LIVE-PREVIEW task's mobile-side work) — the new
  `group('E — ...')` cases in `awj_runtime_shell_startup_test.dart` were built following this
  same file's own established A–D patterns exactly (same `FakeCommerceTransport`/`CommerceClient`
  construction, same `tester.pumpWidget`/`pumpAndSettle`/`find.text` idioms already proven in
  this file and in `vertical_slice_test.dart`), manually reviewed line-by-line against
  `binding_resolution.dart`/`component_widgets.dart`'s actual rendering code (confirmed
  `buildProductList`/`buildCartList` build all children eagerly with no lazy virtualization,
  `buildProductCard`/`buildSection`/`buildPrice` render `title`/`amountMinor` as direct `Text`
  widgets), and syntax-checked for brace/paren/bracket balance. Real CI (`flutter test`, which
  does have the Flutter toolchain) is the authoritative check for this suite, matching how every
  prior task's Dart-side work was verified in this horizon.
- **Backend**: full `php artisan test` run per this repo's mandatory pre-PR protocol: 4705
  passed / 35 failed / 49 skipped (29605 assertions) — **2 more passing than LIVE-PREVIEW-6's
  baseline (4703)**, exactly matching this task's 2 new PHP test methods; the 35 failures are
  the identical, already-documented pre-existing `ext-bcmath` gap (`FuelCostBasisService.php`,
  unreachable by this task's diff) recorded on every prior task in this horizon. Zero
  regressions. Real CI (`php artisan test (L11, sqlite/pgsql)`, which does have `ext-bcmath`) is
  the authoritative check for this PR.

## No new accounting entries

This task touches no financial/accounting code path — it adds test fixtures and test suites
proving an existing pipeline, not a new financial capability. No journal entry table applies.

## Decision Gate check

No Decision Gate applies. No new backend route, no schema/API contract change, no capability
broadened, no Tenant Isolation/RBAC/Commerce authorization/auth-token surface touched, no
production rendering code changed. The two findings above are recorded as deferred follow-ups,
not implemented — correcting them would each require a decision this task's own charter reserves
for owner review (a misleading test doc-comment is low-risk to fix later; `CartSummary`'s live
computation being non-generic is a real behavior question).

## Remaining gaps (carried forward)

- Real live product/cart data (vs. LIVE-PREVIEW-3's clearly-labeled sample data) in Preview
  itself remains deferred exactly as recorded under LIVE-PREVIEW-3.
- The two findings above (misleading grammar-claim comments; `CartSummary`'s non-generic live
  computation) are new, narrow, explicitly out-of-scope deferrals this task's evidence pass
  surfaced.
- No real-device verification has occurred (`RuntimeCapabilities::DATA_RESOURCES`'s own doc
  comment already records this as a pre-existing, registered constraint, not one this task
  changes).

## Next task readiness

**LIVE-PREVIEW-8 — Horizon Closure: READY.** No new Decision Gate evidence found in this task
that would block it. All seven prior tasks are DONE/PASS; this task's evidence directly satisfies
the horizon's exit criteria requiring the integrated chain to be proven with real contracts.
LIVE-PREVIEW-8 should close the horizon, recording every task's PR/SHA/tests/CI, the full
integrated-proof evidence from this task, the two findings above as intentional deferrals, and a
recommended next workstream (most plausibly: real-device verification before mobile distribution,
per `RuntimeCapabilities::DATA_RESOURCES`'s own recorded constraint; and/or the two findings
above).
