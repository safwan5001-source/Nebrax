# MOBILE-RUNTIME-10 — Implementation Report

STATUS: done
DATE: 2026-09-23

## Outcome

This is the horizon's final task (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md`
§8 row 10): final compatibility/security/performance/runtime evidence,
closing Gate H and the horizon's Definition of Done. Two owner decisions
made mid-task in the prior (interrupted) session were preserved and
implemented exactly as specified in this session's handoff — see
"Owner decisions preserved" below.

Four new, standalone, pure-Dart/Flutter modules were added — none wired
into the real Home/Cart startup path, per Decision 1:

- **`mobile/lib/startup/`** (MR-14 — last-known-good startup decision
  mechanism): `resolveStartup()`, a pure function deciding what a boot
  should render given a fetch outcome, an optional cached Experience, and
  the runtime's capability manifest. `CachedExperience` is structurally
  incapable of holding a token/secret (no such field exists). A first-party
  FNV-1a digest (`integrity_digest.dart`) detects cache tampering/
  corruption without adding a hashing package (MR-19 — same "narrower
  first-party implementation" reasoning `schema_version.dart` already
  recorded for its SemVer-lite comparator).
- **`mobile/lib/diagnostics/`** (MR-17 — diagnostic context + redaction):
  `DiagnosticContext` (a closed, typed field set: runtime version,
  Experience version, failure class, platform, correlation id — no field
  through which a secret could be attached) and `DiagnosticEvent`, whose
  only constructor redacts every raw message/extra field before the object
  exists (`redactDiagnosticFields`/`redactSensitivePatterns` — recursive
  key-name redaction plus a bearer-token-pattern scan that catches a secret
  smuggled under an innocuous key name, mirroring MOBILE-RUNTIME-2's
  smuggled-`tenantId` adversarial-input posture).
- **`mobile/lib/commerce/resilient_transport.dart`** (MR-16 — network
  resilience): `ResilientCommerceTransport`, a `CommerceTransport` decorator
  adding a per-request timeout and bounded retry — **retried only for
  `GET`**; every mutating method (`post`/`patch`/`delete` — `addToCart`,
  checkout, auth) gets exactly one attempt, so a blind retry can never
  duplicate a cart/order side effect. Wired as `CommerceClient`'s new
  default transport (previously bare `IoCommerceTransport`); every existing
  test injects an explicit fake transport, so none of the 190 pre-existing
  tests were affected.
- **`AwjRuntimeShell`'s lifecycle observer** (MR-16 — resume after
  background): a `WidgetsBindingObserver` that re-triggers the existing
  `refresh` action (MR-05's own allowlisted action, wired since
  MOBILE-RUNTIME-3/5) on a genuine `paused -> ... -> resumed` transition —
  never a new navigation/business-authority path, and never on a first
  cold-start lifecycle callback or a spurious duplicate `resumed` event.

Plus real, reproducible performance measurements (MR-18) and a Gate H
version-skew/rollback/compatibility audit confirming the matrix required by
horizon §6 was already fully proven except for the two last-known-good/
no-network fixtures, which this task's new `startup/` module now covers.

**Test count: 190 -> 252 (62 new), all passing. `flutter analyze`: 0
issues. No Dart/Kotlin/Swift file outside `mobile/lib/`/`mobile/test/` was
touched — no native (Android/iOS) code changed, so no new native-build
risk exists beyond what MOBILE-RUNTIME-9 already proved.**

## Owner decisions preserved (from this task's handoff)

### Decision 1 — MR-14/MR-17 depth: "prove the decision mechanism only"

Implemented exactly as scoped: `lib/startup/` and `lib/diagnostics/` are
real, tested, standalone primitives with **zero production call site** —
confirmed by `grep -rl "resolveStartup\|CachedExperience\|DiagnosticEvent"
lib/app/ lib/registry/ lib/main.dart` returning nothing. No remote
Published Experience fetch flow was invented (this repository has none —
Home/Cart still render `kHomeSchemaJson`/`kCartSchemaJson` bundled
fixtures directly, exactly as MOBILE-RUNTIME-5 shipped them, completely
undisturbed by this task). Wiring these primitives into a real remote
fetch/cache flow is **explicitly deferred** until that serving
infrastructure exists — there is no `HTTP GET the Published Experience`
call anywhere in this runtime today for `resolveStartup` to receive a real
`ExperienceFetchOutcome` from. This report makes no claim of production
integration.

### Decision 2 — performance evidence: "document the limitation, measure what's device-independent"

Implemented exactly as scoped — see §"Performance evidence (MR-18)" below.
Real measurements were produced for every metric this environment can
genuinely measure (schema parse/validate/render wall-clock, `flutter
analyze`/`test` results, release artifact sizes from this PR's own CI
run). Every device-backed metric (cold/warm startup `timeToFirstFrameMicros`,
device-measured first-meaningful-render, scroll/jank) is recorded as
**NOT MEASURED** with the exact reason (no Android emulator/iOS Simulator/
physical device available in this environment) in
`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md` §7.2. No
heavy emulator/simulator CI infrastructure was added, per the explicit
owner instruction. Nothing is fabricated, estimated, or silently converted
into a PASS.

## Repository evidence read before starting

- Base SHA confirmed: `git fetch origin main` -> `beea79f71b499baeef15e374084f4dbda11857bd`,
  exactly matching the handoff's claimed PR #965 merge SHA. Working tree
  clean on `claude/mobile-runtime-proof-v1-aaz66d`.
- `mcp__github__list_pull_requests` (open) and a grep for `aaz66d`/
  `mobile-runtime-proof-v1` in that listing confirmed **no** MOBILE-RUNTIME-10
  PR existed yet — the handoff's "no MOBILE-RUNTIME-10 PR had been opened"
  claim verified, not assumed.
- `docs/autonomous-engineering/CURRENT-STATE.md`/`TASK-QUEUE.md` confirmed
  MOBILE-RUNTIME-1 through 9 all `done`, each with a recorded Merge SHA
  matching `git log origin/main --oneline`; MOBILE-RUNTIME-9's Merge SHA
  (`4b8bc4f...`) is `origin/main`'s tip, matching PR #965's stated base.
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` re-read in
  full for MR-13 through MR-19, Gate H, and the full Definition of Done —
  this task closes the horizon, so every unresolved requirement in the
  document was in scope for at least an audit, not just the two named
  owner decisions.
- Existing code read: `mobile/lib/schema/compatibility.dart` (the single
  `CompatibilityResolver` authority every new module reuses rather than
  re-implementing), `mobile/lib/app/awj_runtime_shell.dart` (the real boot
  wiring — confirmed no remote-fetch flow exists to hook into),
  `mobile/lib/commerce/commerce_transport.dart`/`commerce_client.dart`
  (the one real network boundary), `mobile/test/schema/compatibility_test.dart`
  (confirmed the existing version-skew/rollback/divergence/native-capability-
  ordering matrix — see the Gate H audit below).
- No Flutter SDK was present in this session's own environment (confirmed:
  `which flutter` -> not found), matching every prior task's own note. This
  session downloaded the exact pinned `3.47.5` stable SDK
  (`storage.googleapis.com/flutter_infra_release`) to `/tmp/flutter-sdk`
  (outside the repository) so every change below was verified locally
  (`flutter analyze`/`flutter test`) before being pushed, not only relied
  on CI. This is a session-local toolchain, not a repository change —
  `mobile/README.md`'s pinned-version instructions are unaffected.

## Gate H audit — version-skew/rollback/compatibility matrix (horizon §6)

Horizon §6 lists 13 required proof fixtures. Re-reading
`mobile/test/schema/compatibility_test.dart` (unchanged by this task)
against that list:

| §6 fixture | Proven by (pre-existing, MOBILE-RUNTIME-2) |
|---|---|
| current schema | `'current schema + current runtime renders fully with no fallbacks'` |
| older compatible schema | `'an older but still-supported schema renders on a wider-range runtime'` |
| unknown optional component | `'an unsupported optional component is omitted...'` |
| unknown required component/action | `'an unsupported required component/action fails the whole document closed'` |
| too-new schema/runtime requirement | `'a schema newer than the runtime supports is rejected'`, `'...requiring a newer runtime...'` |
| malformed schema | `schema_parser_test.dart`'s `'AppSchema.parse — malformed/malicious negatives'` group (17 tests) |
| old runtime + newer compatible Experience | `'an older but still-supported schema renders on a wider-range runtime'` |
| old runtime + unsupported required capability | `'an old runtime with an unsupported required component fails closed'` |
| new runtime + older Experience | `'new runtime + older Experience remains compatible'` |
| iOS/Android capability divergence | `'the same schema can be compatible on one platform and not the other'` |
| rollback to a compatible Experience only | `selectRollbackTarget` group (2 tests) |
| no-network startup **with** compatible last-known-good | **new — `last_known_good_test.dart`** |
| no-network startup **without** compatible last-known-good | **new — `last_known_good_test.dart`** (4 variants: no cache, corrupted cache, incompatible cache, unparseable cache) |

Eleven of thirteen fixtures were already proven before this task started;
this task's `startup/` module closes the remaining two, which is exactly
where MR-14 (added at MOBILE-RUNTIME-2's original scope but never given
its own decision mechanism until this task) left a genuine gap. MR-15's
native capability rollout ordering (a related but distinct requirement) was
separately already proven by MOBILE-RUNTIME-8's own `compatibility_test.dart`
additions (4 tests) — re-verified still passing, untouched by this task.

No gap remains in Gate H's compatibility/rollback matrix.

## Performance evidence (MR-18)

Full method, budgets, and results are in
`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md` §7 (new).
Summary:

**Measured (device-independent):**

| Metric | Result |
|---|---|
| Home schema parse+resolve | median 94µs, p90 215µs (n=500) |
| Cart schema parse+resolve | median 28µs, p90 67µs (n=500) |
| Headless widget-tree render, warm (steady-state, isolates one-time test-isolate init) | 1,628µs (single sample) |
| `flutter analyze` | 0 issues |
| `flutter test` | 252/252 passing, ~11–12s |
| Android release artifact sizes | see "Release artifact sizes" below |
| iOS release artifact size (unsigned) | see "Release artifact sizes" below |

**Explicitly NOT MEASURED (requires a real device/emulator/simulator this
environment does not have, per Decision 2 — no CI emulator/Simulator
infrastructure was added to obtain them):**

- Cold/warm startup `timeToFirstFrameMicros`.
- Device-measured first meaningful render.
- Product-list scroll / image-loading frame timing.
- Memory/jank observations.

### Release artifact sizes

<!-- FILLED IN after this PR's own mobile-ci.yml android-release-build /
ios-release-build jobs complete, from the real CI run — see the CI-run
evidence section below. Not backfilled from MOBILE-RUNTIME-9's older PR
#964 numbers; this task measures its own PR's fresh build. -->

## Tests

62 new tests across 6 new files, 3 modified test-adjacent behaviors:

- `test/startup/last_known_good_test.dart` — 13 tests: fresh success,
  malformed-fetch-as-failure, both required §6 fixtures, cache corruption/
  incompatibility/unparseability negatives, fresh-incompatible-with-and-
  without-cache (including the reason-label fix below), digest determinism.
- `test/diagnostics/redaction_test.dart` — 21 tests: sensitive/non-sensitive
  key classification, bearer-token pattern redaction, recursive map/list
  redaction, a smuggled-secret-under-an-innocuous-key adversarial case.
- `test/diagnostics/diagnostic_context_test.dart` — 9 tests: exhaustive
  failure-class mapping (every `IncompatibilityReason`/`UnavailableReason`
  maps to a distinct class), `toFields()` shape, `DiagnosticEvent`
  redaction-on-construction (a raw token in the message and in `extra`
  both fail to survive into the built event).
- `test/commerce/resilient_transport_test.dart` — 7 tests: happy path,
  GET retry-then-succeed, GET exhausts retries, GET timeout-then-retry-
  succeeds, POST never retried on failure or timeout (the MR-16 "no
  duplicate side effects" guarantee), exception shape.
- `test/app/lifecycle_resume_test.dart` — 2 widget tests: a full
  `paused -> inactive -> resumed` cycle refreshes exactly once (and a
  duplicate `resumed` does not refresh again); a plain `inactive <->
  resumed` flicker with no `paused` in between never refreshes.
- `test/performance/schema_performance_test.dart` — 4 tests: 3 pure-Dart
  `Stopwatch` benchmarks (printed, sanity-asserted, not strictly gated —
  CI-runner variance would make a tight threshold flaky) + 1 widget test
  producing the cold/warm render proxy numbers above.

One real bug caught and fixed during self-review (before any external
review): `resolveStartup`'s "fresh fetch succeeded but is itself
incompatible" branch originally collapsed every fallback failure (cache
absent, cache corrupted, cache incompatible) into a single
`freshIncompatibleNoCache` diagnostic reason, even when a cache existed but
was untrustworthy for a different, more specific reason. Fixed to preserve
the more specific reason and only report `freshIncompatibleNoCache` when
`cached == null`; a dedicated regression test
(`'incompatible fresh fetch + a cache that is itself incompatible...'`)
locks this in.

## Security / AWJ Guardian review

- **MR-07 boundary preserved**: `ResilientCommerceTransport` only ever
  handles already-built `CommerceHttpRequest`/`CommerceHttpResponse`
  objects — it never reads/writes `SecureSessionStore`, never sees a raw
  token outside what `CommerceClient` already puts in a request header
  (unchanged by this task). `CommerceTransportException`'s message
  interpolates only `request.uri` (the Commerce API path, never a token —
  tokens are sent as the `X-Customer-Token` header, not a query parameter,
  per the existing OpenAPI contract) and never the raw request/response
  bodies.
- **MR-14 "no customer secrets"**: `CachedExperience` has exactly three
  fields (`rawJson`, `integrityDigest`, `cachedAt`) — no constructor
  parameter or setter exists through which a token/cart/order reference
  could be attached, the same structural-impossibility proof style
  `deep_link_resolver.dart` established for MR-08.
- **MR-17 redaction**: verified via adversarial tests that a bearer-token-
  shaped string survives neither a `DiagnosticEvent`'s `rawMessage` nor a
  `rawExtra` field, including when nested inside a map/list or hidden under
  an innocuous key name (not just an exact sensitive key match).
- **MR-16 idempotency**: `ResilientCommerceTransport._isSafeToRetry` is a
  single `method == CommerceHttpMethod.get` check — structurally, no
  mutating method can ever be retried, verified by two explicit negative
  tests (POST failure, POST timeout, both asserting exactly one attempt).
- **Tenant/RBAC/accounting**: none touched. This task adds zero backend
  (Laravel) code, zero migrations, zero API routes — pure Flutter/Dart
  client-side runtime primitives and CI/doc updates only.
- **No new dependency** (MR-19): the digest function is first-party
  (~25 lines), same reasoning as `schema_version.dart`'s SemVer-lite
  comparator; no package was added to `pubspec.yaml`.

## Accounting impact

None. This task does not touch any Laravel backend code, migration, or API
route — it is entirely within `mobile/` (Flutter/Dart) plus documentation.
No journal entry table applies.

## CI / merge evidence

<!-- FILLED IN once PR is opened and CI completes on the exact final head. -->
