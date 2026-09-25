# AWJ Runtime Boot Contract — Implementation Report (AWJ-RUNTIME-BOOT-1)

STATUS: PASS
DATE: 2026-09-25

## Objective

Turn the implicit bundled-schema fallback the previous horizon (`AWJ App Builder — Commerce Data
& Dynamic Runtime V1`) left as its own named, deferred product decision into an explicit, tested
**AWJ Runtime Boot contract**, and wire that contract into `AwjRuntimeShell`'s real boot path —
not only into a unit-tested helper.

## The AWJ Runtime Boot contract (final)

`mobile/lib/startup/last_known_good.dart`'s `resolveStartup()`:

| # | Condition | Outcome |
|---|---|---|
| 1 | Published Experience exists and is compatible | `UseFreshExperience` — run the Published Experience |
| 2 | No Published Experience (`GET commerce/v1/experience` 404) | `UseDefaultExperience` — run the bundled **Default AWJ Experience** |
| 3 | Fetch fails transiently (network/timeout/5xx/malformed) **and** a compatible, intact last-known-good cache exists | `UseLastKnownGood` — run the cached Experience |
| 4 | Fetch fails transiently **and** no usable cache exists | `ControlledUnavailable` — render a controlled unavailable state, never a guess |

The 404/no-published case is never treated as a generic fetch failure and is never routed through
last-known-good: a tenant that has genuinely never published (or has deliberately unpublished) is
not "temporarily unreachable" — there is nothing to recover from, so it always gets branch 2,
regardless of whether a stale cache happens to exist.

Existing fail-closed behavior is unchanged: a Published payload that parses but is incompatible
with this runtime's `CapabilityManifest` still falls through to a compatible cache or
`ControlledUnavailable(freshIncompatibleNoCache)` — it is never silently treated as "not published"
or default.

## What changed

### 1. Explicit "No Published Experience" outcome

`ExperienceFetchOutcome` (`mobile/lib/startup/last_known_good.dart`) gained a third variant,
`ExperienceFetchNotPublished` — a fetch that reached the server and got its documented, definitive
404 answer, structurally distinct from `ExperienceFetchFailed`'s transient failures.

`mobile/lib/startup/experience_fetcher.dart`'s `_fetch()` is the one place that draws this line: a
`CommerceApiException` with `statusCode == 404` from `GET commerce/v1/experience` maps to
`ExperienceFetchNotPublished()`; every other status/exception still maps to `ExperienceFetchFailed`
exactly as before. This is safe because `CommerceExperienceController::show` (backend,
`app/Http/Controllers/Api/CommerceExperienceController.php`) has exactly one 404 case — "no
`BuilderPublishedExperienceVersion` row for this tenant" — confirmed by
`PublicApiExceptionRenderer`'s HTTP-status → `PublicApiErrorCode::NOT_FOUND` mapping.

No public API was changed beyond adding this one new sealed-class member and its narrow mapping.

### 2. Default AWJ Experience as an explicit runtime concept

`UseDefaultExperience` (`mobile/lib/startup/last_known_good.dart`) is a new `StartupDecision`
variant — a named, first-class branch of the contract rather than an accidental "everything else"
fallback. It carries no payload: the Default AWJ Experience is still exactly `kHomeSchemaJson`/
`kCartSchemaJson` (`mobile/lib/app/runtime_schema.dart`, unchanged, per this task's own instruction
not to redesign Home/Cart UI) — the screen layer already renders these whenever no live Experience
overrides them.

### 3. Startup resolution

`resolveStartup()` now checks `ExperienceFetchNotPublished` first and returns `UseDefaultExperience`
immediately, before ever consulting the cache. Every other branch (fresh success + compatibility,
fresh failure + cache fallback, incompatible-fresh + cache fallback) is unchanged from MR-14/
APP-BUILDER-19's existing, already-tested logic.

### 4. Real runtime boot wiring

`AwjRuntimeShell` (`mobile/lib/app/awj_runtime_shell.dart`) now owns one `StartupDecision` per app
session:

- `initState()` calls `resolveRealStartup()` exactly once (fire-and-forget; `setState` on
  completion) — the *only* place in the shipped app that does.
- While resolution is pending, Home/Cart keep rendering the bundled Default AWJ Experience they
  always have (no blank/loading gate for the common case); once resolved, `_liveExperience` exposes
  the `RenderableExperience` for `UseFreshExperience`/`UseLastKnownGood` (or `null` for
  `UseDefaultExperience`).
- `ControlledUnavailable` replaces the whole Home/Product/Cart body with the existing
  `ErrorRetryView`, wired to retry `resolveRealStartup()` — this is a genuine "the backend is
  unreachable and no fallback exists" state, and Product's own data would fail to load from the
  same backend anyway.
- `HomeScreen`/`CartScreen` each gained one optional `experience` parameter: when set and it
  declares the relevant page (`home`/`cart`), that page renders instead of the bundled fixture,
  through the exact same `hydrateNode`/`resolveNodeBindings`/`ComponentView` pipeline already
  proven for the bundled schemas — no new rendering mechanism. `didUpdateWidget` re-resolves the
  base page if `experience` changes after the screen has already mounted (boot resolution is
  async and may complete after Home/Cart first render).
- Production default cache is a real `FileExperienceCache()`; `AwjRuntimeShell`/`AwjMobileRuntimeApp`
  both expose a test-only `experienceCache` override, mirroring the existing `client` override.

`ProductScreen`, `$route.productId`, deep link/push navigation, customer identity, and App Factory/
signing/store release are all untouched, per this task's explicit boundary.

## Files changed

- `mobile/lib/startup/last_known_good.dart` — `ExperienceFetchNotPublished`, `UseDefaultExperience`,
  `resolveStartup()` branch.
- `mobile/lib/startup/experience_fetcher.dart` — 404 → `ExperienceFetchNotPublished` mapping.
- `mobile/lib/app/awj_runtime_shell.dart` — real boot wiring (`_resolveStartupExperience`,
  `_liveExperience`, `ControlledUnavailable` body, `experienceCache` test override).
- `mobile/lib/app/home_screen.dart`, `mobile/lib/app/cart_screen.dart` — optional `experience`
  override + `didUpdateWidget`.
- `mobile/lib/app.dart` — `experienceCache` passthrough on `AwjMobileRuntimeApp` (test-only).
- `tests/Feature/AppBuilderSameStoreProofTest.php` — doc comment updated: the deferred item it
  named is now resolved, pointing here.
- Tests: `mobile/test/startup/last_known_good_test.dart`, `mobile/test/startup/experience_fetcher_test.dart`
  (new branch coverage + corrected the one existing test that encoded the old, now-superseded
  "404 falls back to last-known-good" behavior), new `mobile/test/app/awj_runtime_shell_startup_test.dart`
  (real-shell integration proof for all four branches). Six existing app-level widget test files
  (`vertical_slice_test.dart`, `deep_link_navigation_test.dart`, `push_navigation_test.dart`,
  `localization_test.dart`, `lifecycle_resume_test.dart`, `widget_test.dart`) updated to pass an
  explicit `InMemoryExperienceCache` and, where their fake server had no `experience` route handler,
  an explicit 404 response for it — matching real backend behavior and avoiding the production
  `FileExperienceCache` default's `path_provider` platform channel, which has no host to answer it
  under `flutter_test`.

## Tests

- **Focused startup/resolver tests** (`flutter test test/startup/`): 33 passed, 0 failed.
- **AwjRuntimeShell integration tests** (`flutter test test/app/awj_runtime_shell_startup_test.dart`):
  4 passed, 0 failed — one per contract branch (A: Published renders and bundled text is absent;
  B: 404 renders the Default AWJ Experience, not an error; C: transient failure + cache renders the
  cached Experience; D: transient failure + no cache renders `ControlledUnavailable`, never Home/Cart).
- **Full local suite** (`flutter test`): 356 passed, 0 failed.
- **`flutter analyze`**: no issues found.

Run locally with Flutter 3.47.5 (stable) — the same version pinned in `mobile-ci.yml` — since this
sandbox has no pre-installed Flutter SDK.

## Build / CI

Not yet observed on GitHub Actions from this session (PR not yet opened at the time of writing this
report). `mobile-ci.yml`'s `check` job (`flutter analyze` + `flutter test`) covers everything run
above; the Android/iOS release-build-proof jobs are unaffected by this change (no native/platform
code touched) and were not re-run locally.

## Security / Tenant Isolation

Unchanged. `resolveRealStartup()` still calls the same `commerce/v1` surface through the same
`CommerceClient`/tenant-scoped `AuthenticateApiClient` → `ResolveCommerceChannel` chain as before;
no new endpoint, no new auth mechanism, no client-supplied tenant id. The Default AWJ Experience is
still a compile-time bundled constant, never fetched or evaluated as code. No `eval`, no arbitrary
merchant code/HTTP/SQL introduced.

## Risks / Remaining

- Real-device verification (Android/iOS, a real `commerce/v1` tenant) before any actual mobile
  distribution remains owed, per the prior horizon's own recorded operational requirement —
  unaffected and unresolved by this task, which is web/API-boundary logic plus widget tests only.
- If a Published Experience declares a `home`/`cart` page whose node ids don't match the bundled
  schema's own hydration targets (`home-tagline`, `cart-line-template-qty`, ...), those specific
  localized-label hydrations become no-ops (fail-safe, per `hydrateNode`'s own contract) — the
  page still renders, just without runtime-supplied locale overrides on those particular nodes.
  This is an existing property of `hydrateNode`, not new behavior introduced here.

## Git

- Branch: `claude/awj-runtime-boot-contract-uqytr0`
- Base: `main` (this session's starting point)
- PR / merge SHA: recorded once opened/merged (see this task's final chat report)

## Next step

Real-device verification against a real, safely controlled `commerce/v1` tenant (Home, Cart,
Published/Default/LastKnownGood/ControlledUnavailable, network behavior, binding hydration,
mutation/action flows) before any actual mobile distribution — the one operational requirement the
prior horizon named and this task does not remove.
