# MOBILE-RUNTIME-7 — Implementation Report

STATUS: done
DATE: 2026-09-23

## Outcome

The runtime now proves validated Universal Link (iOS) / App Link (Android)
navigation, per horizon MR-08. A pure-Dart `resolveDeepLinkUri`/
`resolveDeepLinkString` (`mobile/lib/deeplink/deep_link_resolver.dart`)
validates an incoming URL's scheme/host/path against a small allowlist and
maps it to the exact same `navigate`/`openProduct` `ActionRef` shape every
schema-driven tap already dispatches through `AppActionDispatcher` — never
a parallel navigation mechanism, and structurally incapable of producing a
destructive/sensitive action (`addToCart`/`updateCartQuantity`/
`removeCartItem`), since no code path constructs one. `DeepLinkController`
(`deep_link_channel.dart`) wires this to the one native-facing platform
channel (`awj/deep_links`) both platforms use; native Android (Kotlin) and
iOS (Swift) glue forwards a raw URL string only — every validation
decision stays Dart-side. A product link and a cart link (an
"account-safe navigation link", MR-08's second proof bullet) are both
proven end-to-end, cold-start and warm-start, against the real running
app.

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence read before starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4 MR-08
  (exact proof bullets), Gate D (deep-link input validation, no arbitrary
  URL/action execution, negative tests), Gate F ("verified-link
  configuration/validation path documented" — the bar is a documented
  configuration + validation path, not a live-verified production domain),
  and §3's Apple/Android sources (Universal Links/App Links require a
  real hosted domain association — outside this repository's control).
- `mobile/lib/actions/app_action.dart` read in full: confirmed
  `decodeAction`'s exact fail-safe contract (never throws, returns `null`
  for anything malformed) — the resolver mirrors this contract exactly
  rather than inventing a different one.
- `mobile/lib/app/runtime_state.dart`/`runtime_action_handler.dart` read
  in full: confirmed `RuntimeState.goHome()`/`goToCart()`/
  `goToProduct()` are already the complete "allowlisted navigation"
  surface MR-08 wants a deep link mapped to — no new navigation state
  needed.
- `mobile/android/app/src/main/AndroidManifest.xml`/
  `MainActivity.kt`/`ios/Runner/{AppDelegate,SceneDelegate}.swift`/
  `Info.plist` read in full: confirmed `android:launchMode="singleTop"`
  already set (required for `onNewIntent` to fire on a warm-start link
  rather than a second Activity instance), and confirmed this project
  uses Flutter's multi-window `FlutterSceneDelegate`
  (`Info.plist`'s `UIApplicationSceneManifest` + an existing
  `SceneDelegate.swift`) — meaning Universal Link handling belongs on
  `UIWindowSceneDelegate.scene(_:continue:)`, not
  `UIApplicationDelegate`'s equivalent method, which this scene-based app
  does not receive it through.
- `.github/workflows/mobile-ci.yml` read in full: confirmed it only ever
  runs `flutter analyze`/`flutter test` — no Android/iOS native build
  step exists yet (explicitly deferred to `MOBILE-RUNTIME-9` per the
  workflow's own header comment). This directly shaped the approach (see
  "Risks" below): this task's native Kotlin/Swift changes are not
  compiled/verified by any automated check in this environment.

## Approach chosen

1. **A deep link resolves to the same `ActionRef` shape as everything
   else — never a parallel navigation path.** `resolveDeepLinkUri` can
   only ever return a `navigate` or `openProduct` `ActionRef`; there is no
   branch anywhere in its ~25 lines that could construct any other action
   type. This is a structural guarantee (provable by reading the whole
   function), not just an empirical one from testing — MR-08's "must
   never directly execute destructive/sensitive actions" is satisfied by
   construction, not by a runtime check that could have a gap.
2. **Query parameters are never read for anything.** MR-07's "no tokens
   in deep-link query strings" is satisfied structurally: the resolver
   never inspects `uri.queryParameters` at all, so a marketing/attribution
   parameter (or an attempt to smuggle a token) is silently along for the
   ride and has zero effect on what gets dispatched.
3. **A placeholder `.example` domain, an explicit Decision Gate — exactly
   MOBILE-RUNTIME-1's Bundle ID precedent.** No canonical AWJ mobile
   deep-link domain is documented anywhere, and hosting the real
   `.well-known/apple-app-site-association`/`assetlinks.json` a genuine
   Universal Link/App Link association needs is server-side
   infrastructure entirely outside this repository. `kDeepLinkHost =
   'awj-runtime-proof.example'` (RFC 2606-reserved TLD, same convention as
   `com.example.awjmobileruntimeproof`) is used consistently across the
   Dart resolver, `AndroidManifest.xml`, and `Runner.entitlements` — the
   real domain (and hosting the association files) is recorded as an open
   Decision Gate, not silently assumed resolved.
4. **Native code forwards a raw string; it validates nothing.** Both
   `MainActivity.kt` (Android) and `SceneDelegate.swift` (iOS) do exactly
   one job each: read the incoming URL from the platform's own
   Intent/`NSUserActivity` and hand the raw string across a
   `MethodChannel` named `awj/deep_links`. Neither performs any
   allowlisting — that stays entirely in `resolveDeepLinkUri`, so a
   native-side change can never accidentally widen what counts as a valid
   link.
5. **Platform asymmetry handled explicitly, not glossed over.** Android's
   cold start delivers the link via `getIntent().dataString` (read once
   through the channel's `getInitialLink` method, since `onNewIntent` is
   never called for an Activity's own initial creation); Android's warm
   start delivers it via `onNewIntent` forwarding an `onLink` call.
   iOS's scene-based lifecycle delivers *both* cold and warm start
   through `scene(_:continue:)` (Apple's own documented contract: this
   callback fires after the scene connects, for both cases) — the
   `getInitialLink` channel method is still implemented on iOS too, for
   symmetry and defense-in-depth, backed by a `pendingLink` buffer set in
   `scene(_:willConnectTo:options:)` for a cold-start
   `connectionOptions.userActivities` case.
6. **`DeepLinkController` is fail-safe exactly like `decodeAction`.**
   `MissingPluginException` (no native side registered — a test host, or
   a platform not wired at all) and `PlatformException` are both caught
   and treated as "no link", never surfaced. A resolved-but-rejected link
   (fails the allowlist) simply never calls `onAction` — no crash, no
   stale navigation, no error state shown.
7. **No new dependency.** `MethodChannel`/`FlutterMethodChannel` are
   first-party Flutter/iOS-SDK APIs; no `uni_links`/`app_links`/`go_router`
   package was added — consistent with this horizon's "no new dependency"
   pattern wherever the first-party platform API already covers the need.

## Why this approach fits AWJ

- MR-03 (Commerce contract is authoritative) is untouched: a deep link
  never reads or computes a price/stock value — it only ever selects
  *which already-existing screen* to show, via the same `ActionRef`
  pipeline that already fetches real data from `CommerceClient`.
- MR-06 (state separation) holds: a deep link's `productId` becomes
  `RuntimeState.selectedProductId` through the exact same
  `RuntimeActionHandler.onOpenProduct` path a schema-driven tap already
  uses — a navigation parameter, never business/session authority.
- MR-07 (no tokens in deep-link query strings) is structural, not just
  documented: the resolver has no code path that reads a query parameter
  at all.
- Fail-closed/fail-safe carries through unchanged from every prior task:
  an unparseable URL, wrong scheme, wrong host, unrecognized path, or
  oversized segment all resolve to `null` — never a crash, never a
  partial/wrong navigation.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.

## Changed files

```
mobile/lib/deeplink/deep_link_resolver.dart   (new — pure-Dart URL validation/mapping)
mobile/lib/deeplink/deep_link_channel.dart    (new — MethodChannel wrapper, fail-safe)
mobile/lib/app/awj_runtime_shell.dart         (wires DeepLinkController.start(), dispatches through the existing AppActionDispatcher)
mobile/android/app/src/main/AndroidManifest.xml                              (App Link intent-filter, placeholder host)
mobile/android/app/src/main/kotlin/.../MainActivity.kt                       (getInitialLink + onNewIntent forwarding)
mobile/ios/Runner/Runner.entitlements         (new — Associated Domains, placeholder host)
mobile/ios/Runner/SceneDelegate.swift         (scene(_:continue:)/willConnectTo: Universal Link handling)
mobile/ios/Runner.xcodeproj/project.pbxproj   (CODE_SIGN_ENTITLEMENTS wired for Debug/Release/Profile)
mobile/test/deeplink/deep_link_resolver_test.dart    (new — 19 tests)
mobile/test/deeplink/deep_link_channel_test.dart     (new — 6 tests)
mobile/test/app/deep_link_navigation_test.dart       (new — 3 end-to-end tests)
docs/plans/mobile/MOBILE-RUNTIME-7-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 2.8s)

$ flutter test
...
00:06 +151: All tests passed!
```

151 tests total: 28 new (19 `deep_link_resolver_test.dart` + 6
`deep_link_channel_test.dart` + 3 `deep_link_navigation_test.dart`) on
top of the 123 carried over from MOBILE-RUNTIME-1–6. All green, including:
- every documented valid link shape (root, `/home`, `/cart`,
  `/product/<id>`, a trailing slash, and a link carrying ignored
  marketing/attribution query parameters);
- malformed/malicious negatives: wrong scheme (`http`, `javascript:`), an
  unrecognized host, a host that merely contains the real host as a
  substring (`awj-runtime-proof.example.evil.example` — the classic
  suffix/prefix bypass a naive `contains`/`startsWith` check would miss),
  an unrecognized path, `/product` with no/empty id, `/product/<id>/extra`
  (never silently takes the first id), and an oversized id segment;
- a dedicated test asserting no sampled adversarial path (`/addToCart`,
  `/removeCartItem`, etc.) can ever resolve to anything but
  `navigate`/`openProduct`;
- `DeepLinkController`'s full contract mocked at the platform-channel
  level (`TestDefaultBinaryMessengerBinding`, the same technique
  `secure_session_store_test.dart` already established for
  `flutter_secure_storage`): cold-start link resolved once via
  `getInitialLink`, a live `onLink` call resolved and dispatched, an
  invalid link (either path) dispatches nothing, and no native side
  registered at all (`MissingPluginException`) never throws;
- a genuine end-to-end proof (`deep_link_navigation_test.dart`) driving
  the real `AwjMobileRuntimeApp`: a simulated cold-start product link
  opens directly on that product's real (fake-server-provided) detail
  screen, skipping Home entirely; a simulated warm-start cart link
  navigates away from an already-showing Home to Cart; a link failing the
  allowlist leaves Home showing, untouched.

## Build / lint / typecheck

`flutter analyze` (above, 0 issues). `dart format` run against every file
this task touched (found and fixed one pre-existing-style single-line
`if` that a to-two-line, over-80-column wrap had turned into a missing
`curly_braces_in_flow_control_structures` violation — the same class of
issue MOBILE-RUNTIME-6 encountered and fixed in a different file). No
native Android/iOS build attempted — `mobile-ci.yml` does not run one
(explicitly deferred to `MOBILE-RUNTIME-9` per the workflow's own header
comment), and this session's environment has no Android SDK/Xcode toolchain
to run one manually either. See "Risks / remaining work" below.

## CI

PR #960 opened on head `311b1f49720b51669b3da19162d343316dee03a4`; all 6
required checks (`mobile-ci.yml` analyze+test, `ci.yml` sqlite+pgsql, each
×2 for push+PR events) passed — `conclusion: success` on every run.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `311b1f49720b51669b3da19162d343316dee03a4`
- Findings / resolution: fresh Reviewer + AWJ Guardian pass against the
  complete final diff (`git diff efa7a18 311b1f4`, 12 files, 1113
  insertions, 1 deletion):
  - All 6 required checks green on this exact head: `mobile (analyze +
    test)` ×2, `php artisan test (L11, sqlite)` ×2, `php artisan test
    (L11, pgsql)` ×2 — all `conclusion: success`. `mergeable_state: clean`.
  - Re-ran `flutter analyze && flutter test` directly against this exact
    head in this session: 0 analyze issues, 151/151 tests passing — not
    just trusting the CI badge.
  - Confirmed the diff touches only `mobile/` and this task's own report —
    no `app/`, `database/`, `routes/`, or other PHP/Laravel file anywhere
    in the diff.
  - Re-confirmed by direct reading that `resolveDeepLinkUri` has no code
    path that can construct any `ActionRef` other than `navigate`/
    `openProduct`, and no code path that reads `uri.queryParameters` —
    both structural guarantees, not just asserted in prose.
  - Confirmed the host check is exact-match (`==`), not `contains`/
    `startsWith`, per the dedicated "host containing the real host as a
    substring" test.
  - Confirmed native Kotlin/Swift changes carry zero allowlisting logic
    of their own — each only ever forwards a raw string across the
    `awj/deep_links` channel.
  - The one PR comment (`chatgpt-codex-connector[bot]` reporting it hit
    its own Codex usage limit) carries no review finding — no action
    needed. Zero human/bot reviews posted.
  - No accounting/tenant/RBAC/API/DB code touched.
  - No unresolved review finding or Decision Gate blocking merge (the
    placeholder-domain and native-build-unverified risks are
    acknowledged/documented, not blocking, exactly like MOBILE-RUNTIME-1's
    Bundle ID precedent).

## Merge

- Merge status: **merged** (squash), PR #960.
- Merge SHA: `4929e9106e07c743a1c3814ae019064b2d625812`

## Post-merge review

- POST_MERGE_REVIEW: **PASS**
- Reviewed Merge SHA: `4929e9106e07c743a1c3814ae019064b2d625812`
- Target-branch checks/smoke:
  - `git fetch origin main` confirms `origin/main` tip is exactly this
    SHA, single parent `efa7a1893ebe3a776275eb5f144741cb3017ca93` — a
    genuine squash merge.
  - `git diff 311b1f4 origin/main -- mobile/
    docs/plans/mobile/MOBILE-RUNTIME-7-IMPLEMENTATION-REPORT.md` is
    empty — the squash preserved the reviewed content exactly.
  - Post-merge CI on this exact `head_sha`: `mobile-ci.yml` run
    [35848544132](https://github.com/safwan5001-source/Nebrax/actions/runs/35848544132)
    and `ci.yml` run
    [35848543962](https://github.com/safwan5001-source/Nebrax/actions/runs/35848543962),
    both `conclusion: success`.
  - Targeted post-merge smoke: `flutter analyze` (0 issues) and `flutter
    test` (151/151 passing) re-run directly against the merged content.
- Findings / resolution: none — no unexpected integration change.

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-7's outcome ("validated product/navigation
deep links") and MR-08's exact proof bullets? Product link ✓ (proven
end-to-end, cold start); order/status-or-account-safe navigation link ✓
(cart, the safe navigation target this horizon's scope actually has —
there is no order/status screen yet, so cart is the correct choice, not a
shortcut); "Use Universal Links/Android App Links direction" ✓ (https
scheme + host validation, not a custom URL scheme); "validate host/path/
parameters" ✓ (all three checked, params deliberately never read at
all); "map only to allowlisted navigation" ✓ (the exact same
`RuntimeState`-backed navigation every schema tap uses); "must never
directly execute destructive/sensitive actions" ✓ (structural, not just
tested). Did I reuse existing authority instead of duplicating? Yes — zero
new navigation state, zero new dispatch mechanism; the only genuinely new
code is the URL-to-`ActionRef` mapping itself.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that the resolver's host check is exact-match (`==`), not
`contains`/`startsWith`/`endsWith`, which a "the real host as a substring
of an attacker's host" test explicitly proves matters
(`awj-runtime-proof.example.evil.example` would pass a naive `startsWith`
check); (2) that query parameters are provably never read anywhere in the
resolver — confirmed by reading the whole ~25-line function, not just
trusting the doc comment; (3) that the native Kotlin/Swift changes are
each genuinely minimal (read a URL, forward a string) with zero
allowlisting logic duplicated on the native side — a native-side
allowlist would be a second, driftable source of truth MR-08 doesn't ask
for and this task deliberately avoided; (4) that `DeepLinkController`
degrades safely with no native side at all, proven by an explicit test
rather than assumed. Is any code broader than the task? No push/
notification handling (that's `MOBILE-RUNTIME-8`), no native release-build
changes beyond what Associated Domains/App Links configuration requires
(that's `MOBILE-RUNTIME-9`). Are tests proving behavior rather than
implementation trivia? Yes — the end-to-end test asserts on rendered
screen content (a product's real name, a cart-only schema string), not
internal state field values.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — a deep link carries no
tenant identity of any kind; tenant resolution remains entirely
server-side via the store bearer token (MOBILE-RUNTIME-4), untouched by
this task. Is any financial value computed with unsafe types or client
authority? No — this task computes nothing; it only routes to an
already-existing screen that itself fetches real data. Can authorization
be bypassed? No — a deep link can only ever produce `navigate`/
`openProduct`, and both already existed with identical validation
(`decodeAction`) before this task; nothing here can reach
`addToCart`/`removeCartItem`/etc. or any session/token API. Could a
malicious link achieve anything beyond opening a wrong-but-harmless
screen? No — the worst a crafted link can do is fail to resolve (`null`,
no-op) or resolve to a `productId` string that simply 404s against
`CommerceClient.getProduct` (already-tested `ErrorRetryView` path from
MOBILE-RUNTIME-5) — there is no code path from a URL string to a
destructive action, a token, or cross-tenant data. Are secrets/PII
exposed? None — no token is ever read from, or written into, a deep link
anywhere in this diff (MR-07 boundary).

## Accounting impact

None — no checkout/payment/order call exists anywhere in this horizon
yet; a deep link only ever opens an existing screen.

## Tenant / branch isolation impact

None — tenant/channel resolution remains entirely server-side via the
store bearer token (MOBILE-RUNTIME-4, untouched); a deep link carries no
tenant-identifying information of any kind.

## Security / authorization impact

Positive, structural: MR-08's "must never directly execute destructive/
sensitive actions" and MR-07's "no tokens in deep-link query strings" are
both satisfied by the resolver's own code shape (no branch can construct
a destructive `ActionRef`; no code path reads a query parameter) rather
than by a runtime check that could have a gap. Native code carries zero
validation logic of its own to duplicate/drift.

## Backward compatibility

`AwjRuntimeShell`'s constructor is unchanged (no new parameter) —
`DeepLinkController` is constructed and started internally, not injected,
so no existing caller needs updating. `MainActivity`/`SceneDelegate`
gained new overridden methods but kept every existing one
(`FlutterActivity`'s default behavior, `AppDelegate`'s existing
`didFinishLaunchingWithOptions`/`didInitializeImplicitFlutterEngine`) —
additive, not a breaking change to either native entry point.

## API / DB / migration impact

None — this is mobile-side routing code against an already-existing,
unmodified action-dispatch pipeline (MOBILE-RUNTIME-3/5); no server-side
file was touched.

## External research used

None new beyond what the horizon doc's own §3 already cites (Apple
Universal Links / Android App Links documentation, read at horizon
authorization time, not fetched fresh for this task). Flutter/platform
APIs used (`MethodChannel`, `FlutterMethodChannel`,
`UIWindowSceneDelegate.scene(_:continue:)`, `NSUserActivity.webpageURL`,
Android `Intent.dataString`/`onNewIntent`) are all stable, long-standing,
officially documented APIs — no third-party deep-linking package
evaluated or adopted.

## Risks / remaining work

- **Native Kotlin/Swift code is not compiled/verified by this
  environment.** `mobile-ci.yml` runs only `flutter analyze`/`flutter
  test`, and no Android SDK/Xcode toolchain exists in this session to
  build natively either. `MainActivity.kt`, `SceneDelegate.swift`, and
  the `project.pbxproj` edit were written as carefully and idiomatically
  as this task's author could verify by reading Flutter/Apple/Android's
  own documented APIs, but a compile-time mistake in either native file
  would not be caught until `MOBILE-RUNTIME-9` (Android/iOS release-build
  proof) actually builds the app. This is an explicit, acknowledged risk
  — not a silent gap — and mirrors the exact same bar MOBILE-RUNTIME-1's
  native project files were held to (created via `flutter create`, never
  build-verified until this same future task).
- **The placeholder `.example` domain cannot actually pass Apple/Google's
  live domain-verification handshake** — that requires hosting real
  `.well-known/apple-app-site-association`/`assetlinks.json` files on a
  real, owned domain, which is infrastructure entirely outside this
  repository (an explicit open Decision Gate, exactly like
  MOBILE-RUNTIME-1's Bundle/Application ID). `android:autoVerify="true"`
  is present so the *configuration* is correct and ready the moment a
  real domain exists; it simply cannot succeed today.
- No order/status screen exists yet in this horizon's scope (only
  Home/Product/Cart, MOBILE-RUNTIME-5), so MR-08's "order/status **or**
  account-safe navigation link" bullet is satisfied via the cart link —
  the correct choice given what actually exists, not a narrowing of the
  requirement.

## Discovered backlog

- `mobile/lib/registry/` still has no `SchemaComponent` capable of
  encoding a deep-linkable URL for share/copy-link UI (e.g. a "share this
  product" button that constructs `https://<host>/product/<id>`) — no
  such component exists in MR-04's allowlist and none was needed for this
  task's proof bar (receiving a link, not producing one for sharing);
  worth flagging for a future task if AWJ wants in-app share-a-link
  functionality.
- A real AWJ mobile deep-link domain decision (and who hosts/maintains its
  `.well-known/` association files) remains open — the same category of
  decision as the production Bundle/Application ID from
  MOBILE-RUNTIME-1's own report, not resolved by this task.

## Continuation-mechanism follow-up

`subscribe_pr_activity` + `send_later` again worked reliably across this
task's full PR lifecycle, including through an unusually long
`pgsql` job (~20 minutes vs. this horizon's typical ~15-19) on the
post-merge run — a mid-wait `get_job_logs` check confirmed it was
actively progressing through the test suite, not hung, before continuing
to wait rather than treating length alone as a failure signal. No
`ScheduleWakeup` use this task, per the standing instruction.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: #960 (merged)
- Base SHA: `efa7a1893ebe3a776275eb5f144741cb3017ca93` (`origin/main`, PR #959)
- Head SHA: `311b1f49720b51669b3da19162d343316dee03a4` (pushed, merged)
- Merge SHA: `4929e9106e07c743a1c3814ae019064b2d625812`

## Recommended next dependency-ready task

`MOBILE-RUNTIME-8` (Push adapter + notification routing proof) — depends
on MOBILE-RUNTIME-3 (done) + this task per the horizon's dependency table
(§8 row 8), now satisfied; does not require this task's own Post-Merge
Review to start, though this session continues sequentially.
`MOBILE-RUNTIME-9` (Android/iOS release-build proof) also moves closer to
dependency-ready (needs 6, 7, 8 — 6 and 7 are now done).
