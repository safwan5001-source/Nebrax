# AWJ Mobile Runtime Proof Horizon V1 — Closure Report

STATUS: HORIZON CLOSED
DATE: 2026-09-23
Process: نظام الأفق / AWJ Autonomous Engineering Horizon
Source: `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md`

## 1. What was proven

AWJ can run a trusted, native Flutter mobile commerce runtime on iOS and
Android that:

- boots, resolves runtime/schema compatibility, and renders an AWJ-owned
  versioned App Schema (Home/Cart) through a typed Component + Action
  Registry (15 components, 6 actions, exactly horizon MR-04/MR-05's
  allowlists) — `mobile/lib/schema/`, `mobile/lib/registry/`,
  `mobile/lib/actions/`;
- consumes the real, already-shipped `/commerce/v1` contract for a live
  Home -> Product -> Add to Cart -> Cart read/update/remove vertical slice,
  with server remaining sole authority for tenant/pricing/stock/order —
  `mobile/lib/commerce/`, `mobile/lib/app/`;
- keeps customer/cart session material behind a platform-secure-storage
  abstraction (iOS Keychain / Android Keystore via `flutter_secure_storage`),
  never in schema, logs, or deep-link query strings;
- supports Arabic (default) and English with true RTL/LTR, large-text
  resilience, and semantic accessibility labels;
- routes a validated Android App Link / iOS Universal Link, and a
  validated push-notification tap, through the exact same allowlisted
  `navigate`/`openProduct` action pipeline every schema-driven tap already
  uses — structurally incapable of a destructive action;
- builds in release mode for both Android (APK+AAB, debug-signed proof)
  and iOS (unsigned `Runner.app`, `--no-codesign`) in CI, with real,
  reproducible artifact-size evidence;
- makes deterministic, evidenced compatibility decisions from an explicit
  per-platform capability manifest — version-skew, rollback-to-compatible-
  only, and iOS/Android capability divergence are all proven, not assumed;
- proves (as a standalone, tested decision mechanism, not yet wired to a
  real remote fetch — see §9) how a boot should behave when a Published
  Experience cannot be fetched: render a compatible last-known-good cache,
  or fail closed to a controlled-unavailable state, never guess;
- proves real, safe network resilience (bounded retry on `GET` only, never
  on a mutating request) and a real app-lifecycle resume-refresh path;
- defines a structured, typed diagnostic-context shape with redaction that
  survives adversarial (smuggled-secret) input, with no crash/telemetry
  vendor adopted.

**Flutter viability conclusion: proven.** Across 10 tasks and 252 tests,
Flutter never failed a material architecture proof gate. No fallback to
React Native was triggered (`MR-01`'s only trigger condition). The one
gate this horizon could not close was device-backed performance
measurement — an environment limitation (§8), not a Flutter defect.

This is a runtime proof, not the App Builder editor, App Factory, or a
production store release — none of those were attempted, per the horizon's
explicit scope.

## 2. All PRs / Merge SHAs

| Task | PR | Merge SHA | Outcome |
|---|---|---|---|
| MOBILE-RUNTIME-1 | #948 | `761d546c82b868850ed71889f49c8909dec0063b` | Flutter workspace + toolchain proof |
| MOBILE-RUNTIME-2 | #950 | `12ae268ff0f60b6f7d1044d58bd87b4dcb01eb10` | App Schema + compatibility kernel |
| MOBILE-RUNTIME-3 | #952 | `b7637f3990702a2cd6277422493dae3eda3b3ced` | Component + Action Registry |
| MOBILE-RUNTIME-4 | #954 | `b645d33b84cfaa85266122f1ea0272c28ee79158` | Commerce OpenAPI client + secure session |
| MOBILE-RUNTIME-5 | #956 | `5b2815a353bebc6a136ba682ef0b874f22c0e9ff` | Home/Product/Cart vertical UI |
| MOBILE-RUNTIME-6 | #958 | `1dfce398a9efc1afccdb91b250015e2cf5c462d5` | ar/en + RTL/LTR + accessibility |
| MOBILE-RUNTIME-7 | #960 | `4929e9106e07c743a1c3814ae019064b2d625812` | Universal/App Links |
| MOBILE-RUNTIME-8 | #962 | `9a1e45b90643bc81f4dbf5085cbaaeda2daf3213` | Push adapter + notification routing |
| MOBILE-RUNTIME-9 | #964 | `4b8bc4fda04ff960da691f43d625dccda2c54eea` | Android/iOS release-build proof |
| MOBILE-RUNTIME-10 | #966 | `95198157f1b64e0e437675d9c0e01f45479d776d` | Final compatibility/security/performance evidence + closure |

Every merge above is a confirmed single-parent squash onto `main` with
zero content drift from its own reviewed pre-merge head (verified per-task
in each task's implementation report, re-verified for task 10 in this
session — see `MOBILE-RUNTIME-10-IMPLEMENTATION-REPORT.md`'s "CI / merge
evidence" section). No history on `main` was rewritten. `main` currently
sits at `95198157f1b64e0e437675d9c0e01f45479d776d`, plus this closure PR.

## 3. Files/components introduced

```
mobile/
  lib/
    schema/        App Schema parser/validator, SchemaVersion, CapabilityManifest,
                    CompatibilityResolver, RuntimeCapabilities identifiers (MOBILE-RUNTIME-2)
    registry/       Typed Component Registry + ExperienceView (MOBILE-RUNTIME-3)
    actions/        Sealed AppAction hierarchy + AppActionDispatcher (MOBILE-RUNTIME-3)
    commerce/       CommerceClient (/commerce/v1), SecureSessionStore,
                    ResilientCommerceTransport (MOBILE-RUNTIME-4, -10)
    app/            AwjMobileRuntimeApp, AwjRuntimeShell, Home/Product/Cart screens,
                    RuntimeState, RuntimeStrings, lifecycle resume observer
                    (MOBILE-RUNTIME-5, -6, -10)
    deeplink/       resolveDeepLinkUri/String + DeepLinkController (MOBILE-RUNTIME-7)
    push/           PushAdapter interface + ChannelPushAdapter + PushController
                    (MOBILE-RUNTIME-8)
    startup/        Last-known-good startup decision mechanism (MOBILE-RUNTIME-10, MR-14)
    diagnostics/    DiagnosticContext + redaction (MOBILE-RUNTIME-10, MR-17)
  android/, ios/    Native glue: deep-link (MainActivity.kt/SceneDelegate.swift),
                    push permission handling (MainActivity.kt/AppDelegate.swift)
                    (MOBILE-RUNTIME-7, -8; compiled/verified starting MOBILE-RUNTIME-9)
  test/             252 tests mirroring the lib/ tree 1:1, plus test/performance/
                    (MOBILE-RUNTIME-10)
.github/workflows/mobile-ci.yml   analyze+test (task 1) + Android/iOS release-build
                                   proof jobs (task 9)
docs/plans/mobile/                Horizon doc, bootstrap, performance baseline,
                                   10 implementation reports, this closure report
```

No code was added to `web/`, `storefront/`, or the Laravel backend by this
horizon — `mobile/` is fully isolated, per MR-02.

## 4. Tests and exact results

Test count grew monotonically task over task, never regressed:

| Task | Total tests | New this task |
|---|---|---|
| 1 | 2 | 2 |
| 2 | 35 | 33 |
| 3 | 72 | 37 |
| 4 | 101 | 29 |
| 5 | 116 | 15 |
| 6 | 123 | 7 |
| 7 | 151 | 28 |
| 8 | 190 | 39 |
| 9 | 190 | 0 (CI-workflow task) |
| 10 | **252** | **62** |

Final state: **252/252 passing**, **0 `flutter analyze` issues**, verified
both pre-merge (this session's local Flutter 3.47.5 SDK, matching the
pinned CI version exactly) and post-merge (CI on the actual merge commit,
plus a local smoke re-run against the merged tree).

## 5. Android/iOS build evidence

Proven by MOBILE-RUNTIME-9, re-confirmed green on every subsequent merge
including this horizon's final merge commit:

- **Android**: `flutter build apk --release` + `flutter build appbundle
  --release`, debug-signed per the stock `flutter create` template
  (`android/app/build.gradle.kts`'s own comment documents this — never a
  production/store key).
- **iOS**: `flutter build ios --release --no-codesign` — a real
  Release-configuration `Runner.app`, code signing entirely skipped, no
  Apple Developer account/certificate/provisioning profile anywhere in
  this repository.

MOBILE-RUNTIME-9's own PR was the first real compile-time verification
either native platform's Kotlin/Swift glue (added in tasks 7/8) had ever
had in this environment (no local Android SDK/Xcode) — it caught and fixed
one genuine pre-existing Swift compile bug (`AppDelegate.swift`'s unhandled
optional plugin registrar).

Store signing, App Store/Google Play submission, and production release
were never attempted — explicitly out of scope for the entire horizon.

## 6. RTL/LTR/accessibility evidence

MOBILE-RUNTIME-6: Arabic default + English toggle, true `Directionality`-
driven RTL/LTR (not a device-locale-only choice), `Accept-Language` header
kept aligned with the server's own locale contract (`ADR-12`). Accessibility
evidence: semantic labels, a VoiceOver/TalkBack smoke proxy
(`SemanticsTester`/`find.byTooltip`), large-text resilience (which itself
surfaced and fixed two genuine pre-existing MR-11 gaps — a direction-only
navigation chevron and a fixed-height product-list overflow), and
touch-target/focus sanity.

## 7. Deep-link/push evidence

- MOBILE-RUNTIME-7: Android App Links / iOS Universal Links. A pure-Dart
  resolver validates scheme/host/path against a small allowlist and maps
  only to `navigate`/`openProduct` — structurally incapable of producing a
  destructive action (no code path constructs one), never reads query
  parameters. Proven end-to-end, cold-start and warm-start, product link
  and cart (account-safe) link.
- MOBILE-RUNTIME-8: a provider-agnostic push boundary (`PushAdapter`
  interface) with one concrete first-party `MethodChannel` adapter — **no
  vendor push SDK (Firebase or otherwise) was ever added** to this
  repository. A notification tap resolves through the identical resolver
  shape deep links use. Dispatch happens only on a tap, never on mere
  foreground arrival. Permanent push/messaging vendor selection remains an
  open, undecided Decision Gate (§10), by design.

Native Kotlin/Swift glue for both was compile-verified starting
MOBILE-RUNTIME-9's CI (no earlier task's environment could compile it).

## 8. Security / AWJ Guardian findings (horizon-wide)

No cross-task security finding remained open at horizon close. Recurring
guardrails verified task over task and re-confirmed at closure:

- No parallel pricing/stock/payment/order logic exists in Dart anywhere —
  `CommerceClient` is a thin typed wrapper over the server-authoritative
  `/commerce/v1` contract.
- Customer/cart tokens are only ever handled by `CommerceClient` internally
  via `SecureSessionStore` — never returned to a caller, never logged,
  never in a deep-link query string, never in the App Schema.
- Every schema/action input with security significance fails closed
  (`CompatibilityResolver`'s fail-closed rule; `decodeAction` returns
  `null` rather than throwing/guessing on a malformed-but-type-known
  action).
- MOBILE-RUNTIME-10 added: `CachedExperience` (MR-14) is structurally
  incapable of holding a secret (no such field exists on the type);
  `DiagnosticEvent` (MR-17) redacts every raw message/extra field on
  construction, verified against an adversarial smuggled-token test
  mirroring MOBILE-RUNTIME-2's original smuggled-`tenantId` test;
  `ResilientCommerceTransport` (MR-16) can never retry a mutating request,
  verified by explicit negative tests.
- Zero Laravel backend/migration/API-route code was touched by this
  horizon — no accounting, tenant, or RBAC surface was at risk at any
  point.

## 9. Runtime compatibility results

Capability manifest: `CapabilityManifest.current(RuntimePlatform)` —
one manifest per platform build (never a single shared "the app" set),
carrying component/action/native-capability version maps
(`RuntimeCapabilities`) plus a min/max supported schema range and the
runtime's own version. `CompatibilityResolver.resolve()` is the single,
pure authority every compatibility decision in this runtime goes through
— schema/action rendering, rollback selection, and (as of this task) the
last-known-good startup decision all delegate to it rather than
re-implementing the rule.

**Version-skew / rollback / compatibility matrix — horizon §6's 13
required fixtures, all proven** (11 by MOBILE-RUNTIME-2/8's existing
tests, re-verified unchanged at closure; the final 2 closed by
MOBILE-RUNTIME-10's `startup/` module — see that task's implementation
report §"Gate H audit" for the full fixture-to-test mapping table):
current schema; older compatible schema; unknown optional component;
unknown required component/action; too-new schema/runtime; malformed
schema; old runtime + newer compatible Experience; old runtime +
unsupported required capability; new runtime + older Experience; iOS/
Android capability divergence; rollback to a compatible Experience only;
**no-network startup with compatible last-known-good**; **no-network
startup without a compatible last-known-good**.

MR-15 (native capability rollout ordering: a Published Experience must
never require a native capability before a supporting binary is safely
available) proven by MOBILE-RUNTIME-8's `compatibility_test.dart`
additions — a schema requiring a not-yet-shipped capability version, or
targeting a platform manifest that has not shipped it at all, is rejected
closed; iOS/Android rollout can diverge and is represented, not assumed
equal.

## 10. Last-known-good / no-network startup evidence

MOBILE-RUNTIME-10, per the preserved owner decision ("prove the decision
mechanism only"): `mobile/lib/startup/last_known_good.dart`'s
`resolveStartup()` is a pure function — same inputs, same output, no I/O —
deciding, from a fetch outcome + an optional cached Experience + the
current capability manifest:

- fresh fetch succeeded + compatible → render it;
- fetch failed + a compatible, integrity-intact cache exists → render the
  cache, flagged `revalidateWhenOnline: true` (presentation recovery only
  — never treated as current business authority);
- fetch failed + no cache, or a cache that is corrupted/unparseable/
  incompatible → a controlled-unavailable state, never a guess, never a
  stale render.

13 dedicated tests, including the tamper-detection case (a cache whose
bytes were altered after capture is rejected via a first-party FNV-1a
integrity digest) and the case that most needed a self-review fix: a
fresh-but-incompatible fetch falling back to a cache that is *itself*
incompatible must report that specific reason, not a generic "no cache"
label — caught and fixed before any external review, with a regression
test locking it in.

**Explicitly not yet wired to a real remote fetch**: this repository has
no remote Published Experience serving infrastructure today — Home/Cart
still render `kHomeSchemaJson`/`kCartSchemaJson` bundled fixtures directly,
exactly as MOBILE-RUNTIME-5 shipped them, completely undisturbed by this
task. Wiring `resolveStartup` into a real fetch/cache flow is deferred
until that serving infrastructure exists (App Builder horizon or later).

## 11. Cold-start/resume/network-interruption/retry evidence

- **Resume after background** (MR-16): `AwjRuntimeShell` gained a
  `WidgetsBindingObserver` that re-triggers the existing, already-proven
  `refresh` action on a genuine `paused -> ... -> resumed` transition
  (tolerant of the real `inactive` transient state Flutter's own lifecycle
  order inserts) — never on cold start, never on a duplicate `resumed`
  event, never a new navigation/business-authority path. 2 widget tests.
- **Network interruption / request timeout / safe retry** (MR-16):
  `ResilientCommerceTransport` wraps the one real network transport with a
  15s timeout and bounded retry — **`GET` only**; every mutating request
  gets exactly one attempt. 7 tests, including the two explicit "a
  mutating request is never retried, on failure or on timeout" negatives
  that make MR-16's "no duplicate side effects" guarantee structural
  rather than a convention to remember.
- **Token/session recovery**: already proven by MOBILE-RUNTIME-4 — a 401
  on a customer-tier call clears a stale token automatically.
- **Cold start** (schema/parse path only — see §12 for the device-backed
  limitation): proven at the pure-Dart level via `test/performance/
  schema_performance_test.dart`'s Stopwatch measurements, and functionally
  via the existing end-to-end `vertical_slice_test.dart` (boot -> Home ->
  Product -> Add to Cart -> Cart -> Remove against a fake server).

## 12. Performance measurements (MR-18)

Full detail: `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md`
§7. Per the preserved owner decision ("document the limitation, measure
what's device-independent"):

**Measured, real, device-independent:**
- Home schema parse+resolve: median 94µs, p90 215µs (n=500).
- Cart schema parse+resolve: median 28µs, p90 67µs (n=500).
- Headless widget-tree render, steady-state: 1,628µs (single sample,
  isolates one-time test-harness init from actual rebuild cost).
- `flutter analyze`: 0 issues. `flutter test`: 252/252 passing, ~11–12s.
- Android release artifact bundle (APK+AAB, zipped): 70,209,077 bytes.
- iOS release artifact (`Runner.app`, zipped, unsigned): 7,036,117 bytes.
  Both from this task's own fresh CI build — individual unzipped file
  sizes could not be measured in this session (the artifact-download
  redirect target, an Azure blob storage host, is denied by this
  environment's egress network policy — confirmed via the proxy's own
  status endpoint, not assumed).

**Explicitly NOT MEASURED** (requires a real Android emulator/iOS
Simulator/physical device this environment does not have; no such CI
infrastructure was added, per explicit owner instruction not to provision
one for this final proof task):
- Cold/warm startup `timeToFirstFrameMicros`.
- Device-measured first meaningful render (with real network + image
  decode).
- Product-list scroll / image-loading frame timing.
- Memory/jank observations.

None of §4's device-dependent provisional budgets are marked "met" or
"missed" — they are marked not measurable in this environment, exactly as
MOBILE-RUNTIME-1's own baseline document instructed rather than fabricated.

## 13. Dependency/license/security review summary

Only two non-trivial dependencies were added across the entire horizon,
each with its own MR-19 review recorded in its task's report:

- `flutter_secure_storage` (MOBILE-RUNTIME-4): BSD-3-Clause, 160 pub
  points, iOS Keychain/Android Keystore-backed, Android `minSdkVersion 24`
  already satisfies its minimum 23.
- `flutter_localizations` (MOBILE-RUNTIME-6): Flutter SDK package, not
  pub.dev-versioned, no MR-19 review needed (first-party framework
  package).

Every other capability that might normally reach for a package was
implemented first-party instead, each with its own recorded reasoning:
the SemVer-lite comparator (`schema_version.dart`, task 2), the FNV-1a
integrity digest (`integrity_digest.dart`, task 10) — no hashing package
added. **No vendor push/messaging SDK was ever added** (task 8) — that
remains an open Decision Gate by design, not an oversight.

## 14. Flutter viability conclusion

**Proven, with evidence, not assumed.** Ten tasks, zero abandoned
architecture, zero fallback-to-React-Native trigger (MR-01's only
condition for one). The framework handled everything this horizon asked
of it: a versioned schema/compatibility kernel, a typed rendering/action
registry, a real typed OpenAPI-contract client, secure storage, full
RTL/LTR + accessibility, native deep-link/push glue on both platforms, and
release-mode builds for both platforms — all without weakening
correctness, accessibility, or security to hit a budget. The only
uncrossed line was device-backed performance measurement, purely an
environment-provisioning limitation this horizon was explicitly told not
to solve by adding CI emulator/Simulator infrastructure — not evidence
against Flutter itself.

## 15. Known limitations / deferred items

- **No real remote Published Experience serving infrastructure exists.**
  `startup/`'s last-known-good mechanism is proven in isolation; wiring it
  into a real fetch/cache flow is deferred to whichever future horizon
  builds that serving layer (most likely the App Builder horizon).
- **Device-backed performance metrics are unmeasured** (§12) — this
  environment has no Android emulator/iOS Simulator/physical device, and
  none was provisioned for this task by explicit owner instruction.
- **Individual unzipped release-artifact file sizes are unmeasured** — the
  artifact-download redirect target is blocked by this environment's
  network policy; only the zipped bundle size from the GitHub Actions API
  was obtainable.
- **No production Bundle ID/Application ID** — still
  `com.example.awjmobileruntimeproof` (MOBILE-RUNTIME-1's placeholder,
  Apple/Google's own documented placeholder convention), an explicit open
  Decision Gate.
- **No production deep-link domain** — still the RFC 2606 `.example`
  placeholder (MOBILE-RUNTIME-7), an explicit open Decision Gate.
- **No permanent push/messaging provider** — the push boundary is
  provider-agnostic by design; no vendor was ever integrated (MOBILE-
  RUNTIME-8), an explicit open Decision Gate.
- **Checkout/payment UI was never built** — the horizon's own §5 made this
  explicitly optional ("not required to make this proof pass unless
  implementation evidence shows it is necessary"), and no runtime
  primitive ever needed it.
- **Promotions remain out of scope** — inherited as already-deferred from
  the prior Commerce Mobile API readiness horizon (`ADR-11`).

## 16. Remaining Decision Gates (owner-only, none blocking horizon closure)

- Flutter-vs-React-Native: resolved by evidence — Flutter stays. Not a
  live gate.
- Permanent push/messaging vendor commitment (e.g. Firebase Cloud
  Messaging) — undecided, no vendor integrated.
- Payment provider / native payment SDK commitment — untouched by this
  horizon entirely.
- Apple/Google account ownership, signing, and production release — never
  attempted, owner-gated as always.
- Production Bundle ID/Application ID and production deep-link domain —
  both still explicit placeholders.
- Wiring the last-known-good startup mechanism into a real remote
  Published Experience fetch flow — deferred until that serving
  infrastructure exists (likely the App Builder horizon).

None of these block calling `AWJ Mobile Runtime Proof Horizon V1` complete
— the horizon's own Definition of Done never required resolving them, only
proving the mechanisms and leaving the commitments explicit and
un-silently-defaulted.

## 17. Next recommended horizon

Per the task's own instruction: **do not automatically start App Builder
or any other new horizon.** This closure report, together with the 10
implementation reports and the performance baseline's §7 results, is ready
for Safwan and ChatGPT to review before authorizing App Builder or any
other next horizon. The most natural next step this evidence points toward
is **App Builder** (`docs/plans/store/AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`),
since this proof's own architecture (`Builder -> Versioned App Schema ->
validation/compatibility -> Trusted Mobile Runtime -> native UI`) was
built specifically to become App Builder's execution layer — but that
authorization decision belongs to the owner, not this session.

## Horizon End

STATUS: **HORIZON CLOSED — awaiting owner/ChatGPT review before any new
horizon is authorized.**
