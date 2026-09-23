# MOBILE-RUNTIME-8 — Implementation Report

STATUS: in progress (CI pending)
DATE: 2026-09-23

## Outcome

The runtime now proves a provider-agnostic push adapter boundary and one
safe notification-tap-to-navigation path, per horizon MR-09. `PushAdapter`
(`mobile/lib/push/push_adapter.dart`) is a pure Dart interface shaped like
every major push provider's real delivery model (permission, token,
cold-start launch message, warm-start tap, foreground arrival) — nothing
outside `lib/push/` may reference a vendor SDK type. `resolvePushPayload`
(`push_payload_resolver.dart`) maps a notification's `data` payload to the
exact same `navigate`/`openProduct` `ActionRef` shape `resolveDeepLinkUri`
already produces for deep links (MOBILE-RUNTIME-7) — structurally incapable
of producing a destructive/sensitive action. `PushController` wires a tap
(cold-start `getInitialMessage`, warm-start `onMessageOpenedApp`) through
the exact same `AppActionDispatcher.dispatch` every other navigation path
uses; a message that merely *arrives* in the foreground is deliberately
never dispatched (arrival is not a command). `ChannelPushAdapter` is the
one concrete adapter this horizon proves: a first-party `MethodChannel`
(`awj/push`), no vendor push SDK added to `pubspec.yaml` or the native
build — Firebase Cloud Messaging (or any provider) integration is an
explicit, undecided Decision Gate (MR-09/MR-19/§10), not something this
task adopts on its own initiative. Native Android/iOS glue implements real,
standard-library notification *permission* handling
(`POST_NOTIFICATIONS`/`UNUserNotificationCenter`) with no push transport
SDK involved — `getToken`/`getInitialMessage` are wired but return `null`,
structurally ready and documented as inert until a concrete provider is
chosen. `CapabilityManifest` gained a `nativeCapabilities` namespace
(`push.notifications`) so a Published Experience can assert this routing
capability as a prerequisite, and a dedicated test suite proves MR-15's
native capability rollout ordering (a schema requiring a not-yet-shipped
capability version, or targeting a platform that has not yet shipped it at
all, is rejected closed) plus Gate F's iOS/Android divergence requirement.

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence read before starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` read for MR-09
  (exact proof bullets: "prove a provider adapter boundary and one safe
  notification-to-navigation path"; "FCM may be used as the proof
  transport... but this does not make Firebase the permanent AWJ
  Messaging architecture... any permanent messaging/provider choice is a
  Decision Gate"), MR-15 (native capability rollout ordering), MR-19
  (dependency/license/supply-chain gate — "strategic dependency lock-in is
  a Decision Gate"), Gate F (native capability proof: push adapter proof,
  lifecycle handling, iOS/Android divergence represented), §9 Definition
  of Done ("push adapter/navigation proof passes **without making a
  permanent messaging-provider decision**"), and §10 Decision Gates
  ("permanent push/messaging vendor commitment").
- `mobile/lib/deeplink/deep_link_resolver.dart`, `deep_link_channel.dart`,
  and `mobile/lib/app/awj_runtime_shell.dart` read in full: MOBILE-RUNTIME-7
  established the exact template this task reuses — a pure-Dart resolver
  that can only construct `navigate`/`openProduct` `ActionRef`s, a
  `MethodChannel` wrapper with fail-safe `MissingPluginException`/
  `PlatformException` handling, wired into the shell via the same
  `AppActionDispatcher.dispatch` callback.
- `mobile/lib/schema/capability_manifest.dart`/`compatibility.dart`/
  `registry_identifiers.dart` read in full: confirmed
  `CapabilityManifest.namedCapabilityVersion`'s own doc comment already
  anticipated a third capability namespace "if a real need for one
  appears" (distinct from renderable components/dispatchable actions) —
  push is exactly that real need, so this task adds `nativeCapabilities`
  rather than misusing `components`/`actions` for a capability that is
  neither.
- `test/schema/compatibility_test.dart` read in full: confirmed the
  existing "iOS/Android capability divergence" test pattern (constructing
  synthetic per-platform manifests via `manifestOf`, rather than claiming
  real current-build divergence) — this task's rollout-ordering tests
  follow the identical pattern.
- `mobile/ios/Runner/AppDelegate.swift`, `android/app/src/main/kotlin/.../
  MainActivity.kt`, `AndroidManifest.xml` read in full: confirmed no
  push-related native code, permission, or dependency existed anywhere
  (no `google-services.json`, no Firebase Gradle plugin, no APNs
  entitlement) — this task's native additions are genuinely new, not an
  extension of anything already there.
- `mobile/pubspec.yaml` read in full: confirmed no push/messaging package
  of any kind is a dependency today — this task adds none.
- `.github/workflows/mobile-ci.yml` re-confirmed: still only
  `flutter analyze`/`flutter test`, no native build — same acknowledged,
  documented native-code-unverified risk as MOBILE-RUNTIME-7.

## Approach chosen

1. **Provider-agnostic boundary first, concrete transport second — and the
   concrete transport this task ships is *not* a real push provider.**
   `PushAdapter` is an abstract interface; `ChannelPushAdapter` is the only
   implementation, built on a first-party `MethodChannel` exactly like
   `DeepLinkController`. Adding a real transport (Firebase Cloud
   Messaging or any alternative) requires a Firebase/APNs project and
   credentials this environment has neither access to nor authority to
   create, and would add a genuine Flutter *and* native dependency
   (Gradle plugin, CocoaPod) wired into the release build — precisely the
   "strategic dependency lock-in" (MR-19) and "permanent push/messaging
   vendor commitment" (§10) MR-09 itself flags as a Decision Gate. This
   was evaluated and deliberately **not** adopted on this task's own
   initiative; see "Risks / remaining work" and "Discovered backlog"
   below for the explicit follow-up this leaves open.
2. **A notification tap resolves to the same `ActionRef` shape as
   everything else — never a parallel navigation path.**
   `resolvePushPayload` can only ever return a `navigate` or `openProduct`
   `ActionRef`; there is no branch that could construct any other action
   type — the identical structural guarantee MOBILE-RUNTIME-7 established
   for deep links, reused verbatim for the identical reason.
3. **Arrival is not a command.** `PushController` deliberately never
   dispatches navigation from `onForegroundMessage` — only a tap
   (`getInitialMessage` for cold start, `onMessageOpenedApp` for warm
   start) reaches `onAction`. This mirrors MR-08's own principle for deep
   links (only an explicit user action navigates) applied to push's one
   genuinely new case: a message that merely *arrives* while the app is
   already open.
4. **A native capability namespace, not a misuse of components/actions.**
   Push routing is neither a renderable `SchemaComponent` nor a
   dispatchable `AppAction` — it is a runtime capability a schema might
   need to assert as a precondition (MR-15). `CapabilityManifest` gained
   `nativeCapabilities` (default `const {}`, so no existing manual
   manifest construction breaks) with one entry,
   `'push.notifications': 1`, checked by `namedCapabilityVersion` exactly
   like the other two maps.
5. **iOS/Android divergence represented at two levels.** (a) Permission
   *model*: `PushPermissionStatus` has four states, not a bool —
   `provisional` exists only on iOS, and Android below API 33 never
   prompts at all (`ChannelPushAdapter`/native glue documents both). (b)
   Rollout *mechanism*: `compatibility_test.dart` proves — via the same
   synthetic-per-platform-manifest technique already established for
   `AddToCart` — that push routing can be shipped on one platform before
   the other, and a schema requiring it is correctly rejected closed on
   whichever platform hasn't shipped it yet (Gate F: "iOS/Android
   capability divergence is represented rather than assumed equal").
6. **Native glue implements real permission handling, nothing else.**
   `MainActivity.kt`'s `requestPermission` uses genuine
   `ActivityCompat`/`ContextCompat` `POST_NOTIFICATIONS` runtime-permission
   handling (API 33+; implicitly granted below that, matching real Android
   behavior) — no Firebase class referenced anywhere, since none is
   linked. `AppDelegate.swift`'s `requestPermission` uses genuine
   `UNUserNotificationCenter.requestAuthorization` — again no push SDK
   needed for *asking permission*, only for *receiving* a real push later.
   `getToken`/`getInitialMessage` on both platforms return `nil`/`null`
   today: structurally wired, honestly inert, documented as such in both
   files' own doc comments (mirroring exactly how MOBILE-RUNTIME-7's
   native code is written correctly but not compiled/verified by this
   environment).
7. **No new dependency.** `MethodChannel`/`FlutterMethodChannel`,
   `ActivityCompat`, `UNUserNotificationCenter` are all first-party
   Flutter/Android/iOS-SDK APIs already available with no `pubspec.yaml`
   change — consistent with this horizon's "no new dependency wherever the
   first-party platform API already covers the need" pattern.

## Why this approach fits AWJ

- MR-09 is satisfied to the letter: a provider adapter boundary exists,
  one safe notification-to-navigation path is proven end-to-end, FCM (or
  any vendor) is not adopted, and no feature-specific business
  notification logic exists anywhere (the resolver only ever knows
  `navigate`/`openProduct`, identical to every other action surface).
- MR-03 (Commerce contract is authoritative) is untouched: a push payload
  never carries a price/stock value — it only ever selects *which
  already-existing screen* to show, via the same `ActionRef` pipeline that
  fetches real data from `CommerceClient`.
- MR-06 (state separation) holds: a push-driven `productId`/`pageId`
  becomes `RuntimeState` navigation through the exact same
  `RuntimeActionHandler` path a schema-driven tap or deep link already
  uses.
- MR-07 (secure session material) is respected: `PushAdapter.getToken`'s
  own doc comment states the registration token is never logged, never
  embedded in App Schema, never written to plain shared preferences — the
  same boundary a session token gets, deliberately extended to this new
  opaque value.
- MR-19/§10 (dependency lock-in / permanent vendor commitment) is honored
  by *not* building what would have made the proof superficially more
  "real" — a genuine Firebase integration — since doing so on this task's
  own initiative would itself violate the rule it is trying to prove
  compliance with.
- Fail-closed/fail-safe carries through unchanged: a malformed payload, a
  missing native side, or an unrecognized value all resolve to `null`/no
  dispatch — never a crash, never a guess.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.

## Changed files

```
mobile/lib/push/push_message.dart              (new — normalized push payload shape)
mobile/lib/push/push_payload_resolver.dart     (new — pure-Dart payload validation/mapping)
mobile/lib/push/push_adapter.dart              (new — provider-agnostic interface + PushPermissionStatus)
mobile/lib/push/push_channel_adapter.dart      (new — MethodChannel-backed concrete adapter, fail-safe)
mobile/lib/push/push_controller.dart           (new — wires adapter taps to AppActionDispatcher)
mobile/lib/app/awj_runtime_shell.dart          (wires PushController.start() alongside DeepLinkController)
mobile/lib/schema/capability_manifest.dart     (new nativeCapabilities namespace + namedCapabilityVersion)
mobile/lib/schema/registry_identifiers.dart    (RuntimeCapabilities.nativeCapabilities = {'push.notifications': 1})
mobile/android/app/src/main/AndroidManifest.xml                (POST_NOTIFICATIONS permission)
mobile/android/app/src/main/kotlin/.../MainActivity.kt         (awj/push channel: real permission handling, inert token/message)
mobile/ios/Runner/AppDelegate.swift            (awj/push channel: real permission handling, inert token/message)
mobile/test/push/push_message... (payload/adapter/controller/fake — see below)
mobile/test/push/push_payload_resolver_test.dart   (new — 11 tests)
mobile/test/push/push_channel_adapter_test.dart    (new — 13 tests)
mobile/test/push/fake_push_adapter.dart            (new — PushAdapter test double)
mobile/test/push/push_controller_test.dart         (new — 7 tests)
mobile/test/app/push_navigation_test.dart          (new — 4 end-to-end tests)
mobile/test/schema/compatibility_test.dart         (new — 4 rollout-ordering tests; manifestOf gained nativeCapabilities param)
docs/plans/mobile/MOBILE-RUNTIME-8-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 6.6s)

$ flutter test
...
00:10 +190: All tests passed!
```

190 tests total: 39 new (11 `push_payload_resolver_test.dart` + 13
`push_channel_adapter_test.dart` + 7 `push_controller_test.dart` + 4
`push_navigation_test.dart` + 4 `compatibility_test.dart` rollout-ordering)
on top of the 151 carried over from MOBILE-RUNTIME-1–7. All green,
including:
- every documented valid payload shape (`navigate`, `openProduct`, extra
  ignored fields);
- malformed/malicious negatives: empty payload, unrecognized `type`,
  missing/empty `pageId`/`productId`, an oversized `productId`;
- a dedicated test asserting no sampled adversarial payload
  (`addToCart`/`updateCartQuantity`/`removeCartItem`) can ever resolve to
  anything but `navigate`/`openProduct`;
- `ChannelPushAdapter`'s full contract mocked at the platform-channel
  level (the same `TestDefaultBinaryMessengerBinding` technique
  MOBILE-RUNTIME-7 established): every `requestPermission` reply string
  maps to the correct `PushPermissionStatus`, an unrecognized reply falls
  back to `notDetermined`, `getToken`/`getInitialMessage` round-trip or
  fail safely to `null`, `onForegroundMessage`/`onMessageOpenedApp` decode
  a native Map (dropping non-string values defensively) or are silently
  ignored for a malformed non-Map call, and no native side registered at
  all never throws;
- `PushController`'s lifecycle proven against a fake adapter in isolation:
  `initialize`+`requestPermission` called exactly once, cold-start
  dispatch via `getInitialMessage`, warm-start dispatch via
  `onMessageOpenedApp`, a payload failing the allowlist dispatches
  nothing, and — the one behavior genuinely new to push versus deep
  links — a foreground-arrival message never dispatches navigation;
- a genuine end-to-end proof (`push_navigation_test.dart`) driving the
  real `AwjMobileRuntimeApp`: a simulated cold-start product notification
  opens directly on that product's real (fake-server-provided) detail
  screen; a simulated warm-start cart-notification tap navigates away
  from an already-showing Home to Cart; a foreground-arrival message
  leaves Home showing untouched; a payload failing the allowlist is
  silently ignored;
- `compatibility_test.dart`'s new group proves MR-15's rollout ordering
  end-to-end through the real `CompatibilityResolver`: the current
  runtime satisfies a schema requiring `push.notifications` v1; a schema
  requiring a not-yet-shipped v2 is rejected closed
  (`missingRequiredCapability`); a runtime manifest that has not shipped
  push routing at all is rejected closed even though the schema only asks
  for v1; and — Gate F's divergence requirement — the identical schema is
  simultaneously `RenderableExperience` on a manifest representing
  Android (shipped) and `IncompatibleExperience` on a manifest
  representing iOS (not yet shipped), proving the resolver enforces this
  per-platform rather than assuming both platforms roll out together.

## Build / lint / typecheck

`flutter analyze` (above, 0 issues). No native Android/iOS build
attempted — `mobile-ci.yml` does not run one (deferred to
MOBILE-RUNTIME-9), and this session's environment has no Android
SDK/Xcode toolchain to run one manually either. See "Risks / remaining
work" below.

## CI

_Pending — filled in once PR CI completes, per this horizon's established
two-PR pattern (implementation PR, then a docs-only follow-up recording
final CI/merge/post-merge evidence)._

## Pre-merge review

_Pending._

## Merge

_Pending._

## Post-merge review

_Pending._

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-8's outcome ("provider-bounded push/
navigation") and MR-09's exact proof bullets? "Prove a provider adapter
boundary" ✓ (`PushAdapter`, one concrete non-vendor implementation);
"one safe notification-to-navigation path" ✓ (proven end-to-end, cold and
warm start); "FCM may be used as proof transport... does not make
Firebase permanent... must not create feature-specific business
notification logic" ✓ satisfied by *not* adding FCM at all — the boundary
is proven without it, which is a stronger compliance than adding FCM
behind the interface would have been, since it removes any risk of the
interface accidentally leaking vendor-specific shape; "any permanent
messaging/provider choice is a Decision Gate" ✓ respected — no such
choice was made, and the report says so explicitly rather than
implying otherwise. Did I reuse existing authority instead of
duplicating? Yes — zero new dispatch mechanism; `resolvePushPayload`/
`PushController`/`ChannelPushAdapter` are structurally the deep-link
task's own pattern, re-derived for push's one genuinely different
lifecycle case (foreground arrival) rather than copied blindly where it
didn't apply.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that `pubspec.yaml`/native build files gained **no** push
SDK dependency — confirmed by reading the full diff, not just the Dart
files; (2) that `resolvePushPayload` has no branch that could construct a
destructive `ActionRef`, confirmed by reading the whole ~20-line function
directly, mirroring exactly how `deep_link_resolver.dart` was reviewed;
(3) that `onForegroundMessage` is provably never wired to `onAction`
anywhere in `PushController` — confirmed by reading the whole class, and
by a dedicated failing-would-be-visible test; (4) that native Kotlin/Swift
`requestPermission` code does not reference any Firebase/vendor SDK type
— confirmed by reading both files in full, only standard-library
`ActivityCompat`/`UNUserNotificationCenter` APIs are used; (5) that
`CapabilityManifest`'s new `nativeCapabilities` field defaults to `const
{}` so it cannot silently change behavior for any existing manual
manifest construction in this codebase — confirmed no other test's
`manifestOf`/direct-constructor call broke (full suite green). Is any
code broader than the task? No native release-build changes beyond what
`awj/push`'s permission wiring requires (that's MOBILE-RUNTIME-9's
job); no actual push-transport integration (that remains an open,
explicitly flagged Decision Gate). Are tests proving behavior rather than
implementation trivia? Yes — the end-to-end test asserts on rendered
screen content, and the rollout-ordering tests assert on the
`CompatibilityResolver`'s actual `Renderable`/`Incompatible` outcome, not
on internal map contents.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — a push payload
carries no tenant identity of any kind; tenant resolution remains
entirely server-side via the store bearer token (MOBILE-RUNTIME-4),
untouched by this task. Is any financial value computed with unsafe types
or client authority? No — this task computes nothing; it only routes to
an already-existing screen that itself fetches real data. Can
authorization be bypassed? No — a push payload can only ever produce
`navigate`/`openProduct`, identical validation to every other entry
point; nothing here can reach `addToCart`/`removeCartItem`/etc. or any
session/token API. Could a malicious/spoofed push payload achieve
anything beyond opening a wrong-but-harmless screen? No — the worst a
crafted payload can do is fail to resolve (no-op) or resolve to a
`productId` that simply 404s against `CommerceClient.getProduct`
(already-tested `ErrorRetryView` path). Are secrets/PII exposed? None —
the registration token is never logged/embedded/written to plain storage
anywhere in this diff (confirmed by reading `getToken`'s only two call
sites: the adapter itself and its doc comment forbidding exactly this).
Is a permanent vendor/provider commitment being smuggled in under cover
of "proof"? No — checked explicitly: no `firebase_messaging`/
`firebase_core` (or equivalent) in `pubspec.yaml`, no Firebase Gradle
plugin in any `build.gradle*`, no `google-services.json`, no Firebase
CocoaPod or APNs entitlement in the iOS project — the proof transport is
entirely first-party `MethodChannel`.

## Accounting impact

None — this task adds no financial operation of any kind; it only routes
notification taps to already-existing screens.

## Tenant / branch isolation impact

None — tenant/channel resolution remains entirely server-side via the
store bearer token (MOBILE-RUNTIME-4, untouched); a push payload carries
no tenant-identifying information of any kind.

## Security / authorization impact

Positive, structural: MR-09's adapter-boundary requirement and the
"never a destructive action" principle carried over from MR-08 are both
satisfied by the resolver's own code shape (no branch can construct a
destructive `ActionRef`) rather than by a runtime check that could have a
gap. Native permission-handling code carries zero business logic to
duplicate/drift, and explicitly does not reference any vendor SDK.

## Backward compatibility

`AwjRuntimeShell`'s constructor is unchanged (no new parameter) —
`PushController`/`ChannelPushAdapter` are constructed and started
internally, not injected, so no existing caller needs updating.
`CapabilityManifest`'s new `nativeCapabilities` field has a default value
(`const {}`), so every existing call site (production and test) that
built a manifest without it continues to compile and behave identically —
confirmed by the full suite passing unchanged for every pre-existing
`compatibility_test.dart` case. `MainActivity.kt`/`AppDelegate.swift`
gained new methods/channels but kept every existing one — additive, not a
breaking change to either native entry point.

## API / DB / migration impact

None — this is mobile-side routing code against an already-existing,
unmodified action-dispatch pipeline (MOBILE-RUNTIME-3/5/7); no server-side
file was touched.

## External research used

None new beyond what the horizon doc's own §3/MR-09 already discusses
(Firebase Cloud Messaging's documented Flutter integration, read at
horizon authorization time as evidence for a feasible proof path — not
fetched fresh for this task, and not adopted). Platform APIs used
(`MethodChannel`, `ActivityCompat`/`ContextCompat` runtime permissions,
`UNUserNotificationCenter.requestAuthorization`) are all stable,
long-standing, officially documented first-party APIs — no third-party
push package evaluated or adopted.

## Risks / remaining work

- **No real push transport is wired.** `getToken`/`getInitialMessage`
  return `null` on both platforms today, and `onForegroundMessage`/
  `onMessageOpenedApp` never fire outside a test's simulated platform-
  channel call — there is no live SDK (Firebase or otherwise) delivering
  an actual push in this build. This is the deliberate, documented
  consequence of not making a permanent-provider Decision Gate choice
  autonomously (see "Approach chosen" #1); it is not an oversight, and is
  the correct state for this horizon to be in until Safwan decides a
  provider.
- **Native Kotlin/Swift permission-handling code is not compiled/verified
  by this environment**, for the identical reason and with the identical
  acknowledgement as MOBILE-RUNTIME-7's deep-link native code:
  `mobile-ci.yml` runs only `flutter analyze`/`flutter test`, and no
  Android SDK/Xcode toolchain exists in this session to build natively.
  Written as carefully and idiomatically as verifiable by reading
  Android/Apple's own documented APIs; a compile-time mistake would not
  surface until MOBILE-RUNTIME-9 actually builds the app.
- **The `push.notifications` capability's real-world "ship" moment is
  this task itself** — `CapabilityManifest.current()` for both iOS and
  Android now reports it, meaning any *future* schema is free to declare
  `requiredCapabilities: {"push.notifications": 1}`. No such schema exists
  yet in this horizon's own fixtures/tests beyond the dedicated
  rollout-ordering proof, which is intentional (this task proves the
  *mechanism*, not a real feature that needs it).

## Discovered backlog

- A concrete `FcmPushAdapter` (or an adapter for whichever provider
  Safwan eventually chooses) implementing `PushAdapter` is the natural
  next step once that Decision Gate is resolved — the interface, the
  resolver, and the controller need zero changes to accept it.
- No UI exists yet for a merchant/tenant to actually *send* a push (that
  is a backend/ops concern entirely outside this horizon's mobile-runtime
  scope) — this task only proves the client-side receive/route boundary.
- Real push delivery would also need a documented decision on *when* to
  call `requestPermission()` (this proof asks once at launch, the
  simplest default — see `PushController.start()`'s own doc comment) —
  contextual/deferred asking is a product/UX decision, not a runtime
  boundary concern, and is explicitly left open for whoever builds the
  real feature this boundary eventually serves.

## Continuation-mechanism follow-up

`subscribe_pr_activity` + `send_later` continue to be used as the primary/
fallback continuation strategy for this task's CI wait, per the standing
horizon instruction (no `ScheduleWakeup`).

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- Base SHA: `b20c9a1c473aec81f88c85f280943d458d427110` (`origin/main`, PR #961)
- Head SHA: _pending push_
- PR: _pending_

## Recommended next dependency-ready task

`MOBILE-RUNTIME-9` (Android/iOS release-build proof) — depends on 6, 7, 8
per the horizon's dependency table (§8 row 9); 6 and 7 are done, and this
task (once merged) completes the dependency set.
