# AWJ App Builder — Commerce Data & Dynamic Runtime V1 — Closure Report (APP-BUILDER-23)

STATUS: merged — post-merge review PASS
DATE: 2026-09-25

## Horizon outcome

**AWJ App Builder — Commerce Data & Dynamic Runtime V1 is CLOSED.** All 11 tasks in the
Decision-Gate-approved queue (`APP-BUILDER-13` through `APP-BUILDER-23`) are complete. The horizon
delivered exactly what `ADR-01` (Option A, Decision Point 1 = YES, Decision Point 2 = exclude)
approved: a real, tenant-isolated, fail-closed-versioned `binding`/`visibility` contract on the App
Schema; a generalized mobile runtime resolver replacing three duplicated hand-written screen
implementations; real schema-declared action dispatch reachable through a bound path; a real live
publish → fetch → on-device-cache loop; and — via a staged, owner-directed proof sequence rather than
a single flip — the server-side capability gate that makes all of it actually publishable to real
tenants today.

This horizon also closes the connected deferred track `AWJ App Builder Horizon V1`'s own closure
report (`APP-BUILDER-12-HORIZON-CLOSURE-REPORT.md`) left open: "`APP-BUILDER-7`'s Data/Actions/
Conditions/Visibility" and "`APP-BUILDER-11`'s live-Commerce-binding clause." Both are now resolved
for real, not reinterpreted or satisfied with a fixture.

## What is COMPLETE — proven by the current, accepted, and now-active App Builder contract

| Task | Outcome | PR (squash Merge SHA) |
|---|---|---|
| APP-BUILDER-13 | Data Resource Registry V1 — `commerce.categories`/`commerce.products`/`commerce.cart` populated from a direct read of the real `commerce/v1` controllers | #993 (`ed6c485b317a15a67a742db1ae2c05b1f4e44ea0`) |
| APP-BUILDER-14 | App Schema `binding` contract — `AppSchemaParser` optional key + `CompatibilityResolver` resource/field-allowlist resolution | #994 (`57d474e8042466afa52e0f76773f5b57eee7f3bd`) |
| APP-BUILDER-16 | Conditions/Visibility contract — closed/typed/allowlisted condition tree, no expression engine | #996 (`22156e493ef830a34a372b5c74643ab20e37632f`) |
| APP-BUILDER-21 | App Builder UX/localization pass — bilingual `Label` on every registry definition | #997 (`8dbff6fbd197f5a5b1ba47ce398a6792ecd90db5`) |
| APP-BUILDER-22 | Canvas + Flutter theme-token rendering fix | same PR #997 |
| APP-BUILDER-15 | Builder Data UX — Inspector binding/visibility editor | #998 (`ef757bd79f39c199047893bea735b90ef8284005`) |
| APP-BUILDER-17 slice 1 | Dart schema parser support for `binding`/`visibility` | #999 (`30af97e0b19b5b94274545b4240a56b82e3e779d`) |
| APP-BUILDER-19 | Live publish → fetch → on-device-cache loop (Last Known Good) | #1000 (`e7fd599ee7fc914c0832b740f51e02e9ad93a4ef`) |
| APP-BUILDER-17 slice 2 | Dart `CompatibilityResolver`/`RuntimeCapabilities` gating | #1002 (`f1090992a21d5c619b596209dac4afc56678a767`) |
| APP-BUILDER-17 slice 3 | Generic `binding.collect` collection/template mechanism (owner-approved Decision Gate) | #1004 (`c273550d76c35b78be6b3dfc797db34f8e521178`) |
| APP-BUILDER-17 slice 3b | Screen rewiring — `HomeScreen`/`CartScreen` call the real binding runtime; Dart-only capability flip | #1006 (`88612093de458d0b3b7a2d365c9fafc9a1451c9c`) |
| APP-BUILDER-17 slice 3c + APP-BUILDER-18 | Server-side `RuntimeCapabilities` flip (owner decision, Gate G/H precedent) + `ActionRegistry.DISPATCH_LIVE` | #1007 (`afaab2256c282bcf8928c4fc2a9eb93b413dfa5e`) |
| APP-BUILDER-20 | Same-Store integrated proof — real HTTP round trip across `commerce/v1`/`store/v1`/App Builder publish/fetch | #1009 (`e909d6385ecdf5226ea37fdb609ec7b85d61a05b`) |
| APP-BUILDER-23 | This closure report | (pending) |

Docs-only durable-state updates recording the above (no code): PR #995 (`ADR-01` Storefront-completeness
amendment), PR #1005 (slice 3 completion), PR #1008 (slices 3b/3c completion).

Every merge above is independently verified: single-parent squash onto `main`, and post-merge CI green
on the merge commit itself (`ci.yml` sqlite+pgsql for backend-touching PRs; `mobile-ci.yml` — including
both Android/iOS release-build-proof jobs — for mobile-touching PRs).

### Security / tenant isolation

Every App Builder route stays `TenantContext`-scoped (`BaseModel`/`TenantScope`), unchanged from the
already-closed `AWJ App Builder Horizon V1`. The new `commerce/v1/experience` endpoint
(`CommerceExperienceController`, `APP-BUILDER-19`) reuses the exact same `AuthenticateApiClient` →
`ResolveCommerceChannel` chain every other `commerce/v1` read route uses — no new auth mechanism, no
client-supplied tenant id anywhere. `BindingResolver`/`resolveNodeBindings` (mobile) only ever call the
same fixed, store-bearer-scoped `commerce/v1` base URL the client already used before this horizon —
nothing about tenant resolution moved into the schema or the resolver.

### RBAC

Unchanged: `apps_builder.view`/`.manage`/`.publish` from the prior horizon govern every authoring/
publish route this horizon added or extended (`binding`/`visibility` editing, validate, publish). No
new permission was introduced or needed.

### App Schema stays declarative, untrusted configuration

Still non-negotiable, and now proven under real load: `binding`/`visibility` are closed, typed,
allowlisted schema keys — never an expression language, never a route to arbitrary code, never a
direct database reach. `$item.<field>` substitution (the `binding.collect` mechanism) resolves only
against fields a resource's own `ResourceDefinition` declares readable; an out-of-contract reference
fails closed to `null`, never throws, never leaks another field. `CompatibilityResolver`'s fail-closed
prune/reject rule — proven since the prior horizon for `type`/`action.type` — was extended to
`binding`/`visibility`/`binding.collect` without a single new failure mode invented; every gate is the
same optional-prune-required-fails-closed shape, verified identically in PHP and Dart.

### Runtime compatibility / staged capability rollout

The single most consequential decision of this horizon: **whether to flip the server-side publish gate
(`RuntimeCapabilities::DATA_RESOURCES`/`SCHEMA_FEATURES`) the moment the mechanism was built, or only
once real evidence of a "shipped, verified mobile release" existed.** The user's explicit direction was
to treat this as a proof/activation sequencing problem, not owner permission to bypass the safety gate —
resulting in a staged sequence across three PRs (slice 3 → 3b → 3c) rather than one flip:

1. **Slice 3** proved the mechanism (real `ComponentView` rendering, real action dispatch with
   `$item.*`-resolved params) against a manifest *simulating* a future capable runtime — the shipped
   app's own manifest, and both PHP and Dart capability constants, stayed untouched.
2. **Slice 3b** wired the mechanism into the real `HomeScreen`/`CartScreen` against the app's own
   bundled schemas, flipping only the Dart-side manifest (self-declaration of what *this build*
   consumes) — PHP's publish gate stayed closed, so the server still refused to publish anything
   requiring these capabilities to any tenant on any client version.
3. Before flipping the server side, a requested **narrow evidence pass** determined the exact bar this
   repository's own precedent already sets for "shipped, verified mobile release": this repo's own
   `AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md` closed an entire prior horizon using only
   CI-verified release-mode build proof (`flutter build apk/appbundle --release`,
   `flutter build ios --release --no-codesign`) and widget/unit test coverage — explicitly without any
   real-device/emulator/simulator installation, per an earlier explicit owner decision, with
   device-backed metrics honestly recorded as "NOT MEASURED" rather than fabricated. **Slice 3c**
   applied that same, already-established bar (now independently re-met on slice 3b's own merge
   commit) to flip `RuntimeCapabilities::DATA_RESOURCES`/`SCHEMA_FEATURES` (PHP) and
   `ActionRegistry.dispatchStatus` (`DISPATCH_LIVE` for the three actions actually proven reachable
   through a bound path) — with an explicit, separately recorded operational requirement that
   real-device verification against a real, safely controlled `commerce/v1` tenant is still owed
   **before the first actual mobile distribution** (internal, store, or otherwise), never silently
   dropped.

`commerce.categories` and `visibility` deliberately stay out of both `RuntimeCapabilities` constants —
no bundled schema uses either, and declaring support for something nothing consumes would be inventing
a capability ahead of a real use, the same restraint already exercised throughout this horizon.

### Same-Store proof

`APP-BUILDER-20`'s `AppBuilderSameStoreProofTest` proves, with real HTTP round trips and no mocking,
that `store/v1` (Storefront Web) and `commerce/v1` (the surface an App-Builder-published `binding`
resolves against) consume the *same* Commerce Core data and business rules — the exact demonstration
`ADR-01`'s amendment requires, without needing the still-mid-migration Spree-based `storefront/`
application to be feature-complete. It also proves, for the first time end-to-end, that a real
published Experience fetched through the real `GET commerce/v1/experience` endpoint is genuinely
renderable on the shipped runtime's own `CapabilityManifest::current()` — not only structurally
accepted at draft time.

### Regression evidence (cumulative, this horizon)

Every task's own PR ran the full local backend suite; final state after `APP-BUILDER-20` (PR #1009):
**4711 passed, 27 pre-existing failures (missing `bcmath` PHP extension in the local sandbox —
present since before this horizon, confirmed absent on CI, which installs `bcmath`), 49 skipped**, and
CI green (`ci.yml` sqlite+pgsql) on every merge commit. Mobile-touching PRs additionally passed
`flutter analyze`/`flutter test` and both Android/iOS release-build-proof jobs on `mobile-ci.yml`. No
`web/` file was touched by this horizon — `web-ci.yml` correctly never ran.

## What is DEFERRED — named, not silently dropped

1. **Real-device verification before the first actual mobile distribution.** Recorded explicitly on
   `RuntimeCapabilities::DATA_RESOURCES`'s own doc comment (PR #1007): a real device/emulator run
   against a real, safely controlled `commerce/v1` tenant, covering Home, Cart, network behavior,
   binding hydration, rendering, and mutation/action flows, is owed before any internal distribution,
   store submission, or production release — not before this horizon's own server-side flip, per the
   owner's own decision that this repository's established CI-only evidence bar already satisfies that
   flip's precondition.
2. **Wiring `resolveRealStartup()` into `AwjRuntimeShell`'s actual shipped boot sequence.** Recorded
   explicitly on `AppBuilderSameStoreProofTest`'s own doc comment (PR #1009): `HomeScreen`/`CartScreen`
   still render the bundled `kHomeSchemaJson`/`kCartSchemaJson` fixtures by default, not a live-fetched
   Experience. Wiring this today would mean every tenant that has never published an App Builder
   Experience (currently: all of them — `GET commerce/v1/experience` 404s with no
   `BuilderPublishedExperienceVersion` row) sees a `ControlledUnavailable` screen instead of the working
   bundled demo, since `ExperienceFetchOutcome`/`resolveStartup` has no "nothing published yet" outcome
   distinct from a genuine fetch failure. **This is a real, unresolved product decision** — render the
   bundled demo as an implicit default, show a distinct "not configured" state, or something else — not
   invented an answer for by this horizon.
3. **`commerce.customer.profile`/`commerce.orders`** — `ADR-01` Decision Point 2, confirmed excluded
   from V1: real `commerce/v1` endpoints exist, but no login UI exists in `mobile/` yet, so binding
   customer data today would be speculative.
4. **`ProductScreen`/route context (`$route.productId`) binding and item-scoped `visibility`** — out of
   scope per the same Decision Gate that approved `binding.collect`; `ProductScreen` remains a
   screen-owned Dart tree (its own doc comment explains why: a single-instance page parameterized by a
   tapped id has no safe schema-templating mechanism without inventing exactly the kind of "arbitrary
   expression" surface `MR-04` rules out).

These four are not one connected track the way the prior horizon's two deferred items were — each has
its own independent trigger for when it becomes relevant (an actual distribution decision; a resolved
fallback-UX product decision; a login flow; a `ProductScreen` schema-templating decision).

## Known limitations carried forward (not blockers, not silently dropped)

- **`commerce.promotions` does not exist as a backend resource** and **`commerce.categories` lacks
  `name_en`** — both recorded gaps from the original evidence pass (`AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md`
  §3.1), never worked around with an invented substitute.
- **Local test-environment gap** (present since before this horizon): the local sandbox's PHP lacks the
  `bcmath` extension, causing the same 27 `FuelSupplyReceivingTest`/`FuelCostBasisService` failures in
  every run this horizon's own full-suite checks reported. Confirmed absent on real CI (which installs
  `bcmath` per `ci.yml`/`Dockerfile`) at every merge.
- **Storefront Web (`storefront/`) mid-Spree-migration incompleteness** is explicitly, per the `ADR-01`
  amendment, never a blocker or pacing dependency for any task in this horizon — reaffirmed rather than
  newly decided.

## Explicitly out of scope for this horizon (unchanged, never touched)

Per `ADR-01`'s own boundary, none of the following were built or approached: App Factory/build farm,
Apple/Google signing or account ownership, App Store/Google Play submission or production release,
production deployment, a general-purpose expression/condition engine (visibility stays a closed,
enumerated vocabulary), arbitrary merchant code/HTTP/SQL/eval, `commerce.customer.profile`/
`commerce.orders` binding, a parallel Commerce data path bypassing `commerce/v1`'s authoritative
resolvers.

## Next-horizon recommendation

1. **Resolve the "no Experience published yet" fallback-UX product decision** (item 2 above) — this is
   the single blocker between the mechanism this horizon proved and an actual live, wired mobile boot
   path. Recommend deciding this before scheduling any follow-on task that touches `AwjRuntimeShell`'s
   boot sequence.
2. **Real-device verification pass** (item 1 above) before any internal distribution, store submission,
   or production release is even considered — an owner-gated action requiring credentials/a device this
   coding session does not have.
3. **A login/customer-identity flow in `mobile/`**, if the product direction ever wants
   `commerce.customer.profile`/`commerce.orders` bound — currently has no prerequisite work started.
4. **App Factory / signing / store submission** remains explicitly not started, per this horizon's own
   boundary — a separate authorization decision for the owner.

## Merge and post-merge review

This closure report is being merged as its own docs-only PR onto `origin/main` at
`e909d6385ecdf5226ea37fdb609ec7b85d61a05b` (PR #1009's own merge commit).

- **Single-parent squash confirmed** for every PR cited in the table above via `git log --parents -1`
  on each respective merge commit (verified individually at the time each PR was merged, per this
  horizon's own session record).
- **Post-merge CI confirmed green on the merge commit itself** for every PR cited above —
  `ci.yml` (sqlite+pgsql) for every backend-touching PR, `mobile-ci.yml` (analyze+test, Android release
  build, iOS release build) for every mobile-touching PR.

**POST_MERGE_REVIEW: PASS.**

## Self-review

### Implementer

Closed the horizon honestly: the one genuinely consequential decision (when to flip the server-side
publish gate) was escalated rather than resolved unilaterally, resolved by the owner against this
repository's own established precedent rather than a newly invented bar, and the two real remaining
gaps (real-device verification, the boot-path fallback-UX decision) are named precisely rather than
implied as "basically done."

### Reviewer

- Verified every PR number and merge SHA cited above against `docs/autonomous-engineering/
  CURRENT-STATE.md`/`TASK-QUEUE.md`'s own execution log — none guessed or reconstructed from memory.
- Confirmed the staged capability-rollout narrative (slice 3 → 3b → 3c) matches the actual sequence of
  owner instructions and merged PRs, not a retroactively simplified story.
- Confirmed the two deferred product decisions (real-device verification; boot-path fallback UX) are
  each named on the exact file/PR that first surfaced them, not newly invented for this report.

### AWJ Guardian

- Tenant/RBAC/App-Schema-declarative-only invariants held across every task in this horizon, verified
  fresh at each merge and re-verified end to end by `APP-BUILDER-20`'s Same-Store integrated proof.
- No production deploy, release, App Factory, or signing/submission step was taken or approached at any
  point in this horizon.
- The server-side capability flip (`APP-BUILDER-17` slice 3c) was made only after an explicit owner
  decision grounded in this repository's own established precedent — never inferred or assumed by this
  session on its own authority.
