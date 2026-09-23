# MOBILE-RUNTIME-4 — Implementation Report

STATUS: done
DATE: 2026-09-23

## Outcome

A typed Dart client for the tenant-facing `/commerce/v1` surface
(`docs/openapi/commerce-api-v1.yaml`) exists at `mobile/lib/commerce/`,
covering Storefront/Catalog/Media (read), Cart (write, optional customer
identity), and customer authentication (register/login/OTP/logout/me) —
exactly what MOBILE-RUNTIME-5's Home/Product/Cart vertical slice and MR-07's
secure-session proof need. Checkout, payment-method selection, guest/
customer order history, and the saved-address book are the documented
contract's business but are **not** implemented here — see "Scope boundary"
below. A platform-secure-storage boundary (`SecureSessionStore`) now holds
the only two pieces of session material this runtime has: the customer's
own `customer:access` token and the guest/customer cart identity token. No
UI consumes this client yet — that is MOBILE-RUNTIME-5.

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence read before starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4 MR-03
  (Commerce contract is authoritative — no parallel backend, no client-side
  pricing/stock/payment/shipping logic), MR-06 (state separation), MR-07
  (secure session material — Keychain/Keystore-backed, never in schema/
  logs/analytics/deep-link query strings/plain prefs), MR-19 (dependency
  gate); §7 Gate C (Commerce integration: typed client against the
  committed OpenAPI contract, tenant/channel server-resolved, explicit
  error envelope, Home/Product/Cart proof green).
- `docs/openapi/commerce-api-v1.yaml` (1883 lines) read in full: the four
  auth tiers (store bearer always; optional `X-Customer-Token` on Read/
  Write; `X-Customer-Token` required on Customer-required routes;
  Sensitive-tier auth entry points needing neither), the `X-Cart-Token`
  guest-identity header (never a cookie, never `Authorization`), the
  `{ data, meta }` / `{ error, meta }` envelopes, and every schema this
  task's endpoints use (`Money`, `Category`, `ProductListItem`/
  `ProductDetail`/`ProductVariantDetail` — a `oneOf` discriminated by
  `is_variant_managed` — `Cart`/`CartItem`, `CustomerIdentity`,
  `TokenAuthResponse`, `MeResponse`, `Error`'s 17-value `code` enum).
- No existing `lib/commerce/` — confirmed via `find`.

## Scope boundary (explicit)

Implemented: `GET storefront`, `GET/POST categories(/{id})`, `GET
products(/{id})`, `GET cart`, `POST cart/items`, `PATCH/DELETE
cart/items/{item}`, `POST auth/register`, `POST auth/login`, `POST
auth/otp/request`, `POST auth/otp/verify`, `POST auth/logout`, `GET me`.
`mediaUri()` builds the `/media/{id}` URL (that route streams raw bytes,
never a JSON envelope, so it does not fit this client's envelope-parsing
path) for MOBILE-RUNTIME-5 to issue directly once there is an `Image`
widget to wire it into.

**Not implemented**: `checkout*`, `payment-methods`, `orders/{id}`,
`addresses*`, `me/orders*`. None of these are on Gate C's own bar
("Home/Product/Cart proof green") or MR-05's action allowlist
(`addToCart`/`updateCartQuantity`/`removeCartItem`/`navigate`/
`openProduct`/`refresh` — no checkout/payment/order action exists in this
horizon's allowlist at all). Adding them now would be scope creep ahead of
a task that actually needs them; they remain available in
`docs/openapi/commerce-api-v1.yaml` for whichever future task (outside this
horizon's 10-task queue) takes on checkout.

## Approach chosen

1. **No new HTTP dependency — `dart:io HttpClient` directly**
   (`commerce_transport.dart`). This workspace targets Android/iOS only
   (MR-02); `dart:io` is always available there. Per MR-19's "whether a
   narrower first-party/framework implementation is reasonable" test, a
   package (`http`, `dio`, …) buys nothing here that the SDK doesn't
   already give for plain JSON-over-HTTPS. `CommerceTransport` is still an
   interface — not a direct `CommerceClient` → `dart:io` coupling — so
   `flutter test` (no real sockets, and this repository's CI has no network
   path to any Commerce deployment) can exercise the client's auth/
   session/error-mapping logic against a scripted `FakeCommerceTransport`,
   the same test-double pattern MOBILE-RUNTIME-3 used for
   `ActionHandler`/`ComponentBuilder`.
2. **One new dependency — `flutter_secure_storage: ^11.2.0`** — for MR-07.
   Dependency review (MR-19):
   - **Why needed**: Flutter/Dart has no built-in Keychain (iOS)/Keystore-
     backed storage (Android) API; MR-07 explicitly requires one, and
     `dart:io`/`shared_preferences`-style storage is plaintext-on-disk, the
     exact thing MR-07 forbids.
   - **License**: BSD-3-Clause — compatible with commercial SaaS/mobile
     distribution.
   - **Maintenance**: 11.2.0 published days before this task, 160 pub
     points, 4.49k likes, 4.37M downloads — the de facto standard package
     for this exact need, actively maintained.
   - **Platform support**: Android, iOS, plus Linux/macOS/Windows/Web (only
     Android/iOS are this workspace's targets — MR-02).
   - **Security implications / native permissions**: wraps
     `EncryptedSharedPreferences` (Android) / Keychain (iOS) by default.
     This task uses only the package's default options — no biometric
     gating, no custom access group — so it requires **no** extra native
     permission beyond what the package declares unconditionally (the
     `USE_BIOMETRIC`/`USE_FINGERPRINT` Android permissions and Keychain-
     Sharing entitlement it documents are opt-in for biometric/shared-
     keychain configurations this task does not use). Android's default
     `minSdkVersion` for this Flutter version (3.47.5) is 24
     (`FlutterExtension.kt`), already above the package's minimum
     supported SDK 23 — verified by reading the Flutter Gradle plugin
     source directly rather than assuming.
   - **Narrower alternative considered**: hand-rolling Keychain/Keystore
     access via platform channels. Rejected — that is exactly the
     well-scoped, single-purpose native integration this package already
     is; reimplementing it would add native Kotlin/Swift code with no
     compatibility/test-coverage benefit over the maintained package.
   - Pinned via `pubspec.yaml`/`pubspec.lock` through the normal
     `flutter pub add` mechanism (no manual edits to the lockfile).
3. **`SecureSessionStore`** (`secure_session_store.dart`): an interface
   with exactly two fields — customer token, cart token — plus `clear()`.
   `FlutterSecureSessionStore` is the real, `flutter_secure_storage`-backed
   implementation; `InMemorySecureSessionStore` is a pure-Dart double for
   tests (and is never reachable from `CommerceClient`'s own defaults —
   every test constructs it explicitly, so app code cannot reach for it by
   accident). Writing `null` deletes the key rather than storing the
   literal string `"null"` — verified against the real plugin's own method
   channel (`secure_session_store_test.dart`), not just asserted in
   prose.
4. **`CommerceClient` is the only place that ever sees a token in
   cleartext** (`commerce_client.dart`). Every method reads/writes
   `SecureSessionStore` internally:
   - `loginCustomer`/`verifyOtp` persist the returned token and return only
     `CommerceCustomerIdentity` — the raw token never reaches the caller,
     so it structurally cannot end up in a log line, an analytics event, or
     a deep-link query string built from a method's return value.
   - `logoutCustomer` clears the local token **only after** a successful
     server response — an unreachable server should not silently strand
     the app "logged out locally, still valid server-side"; the caller may
     retry. Proven both ways in tests (success clears, failure preserves).
   - A `401` on any call that sent `X-Customer-Token` clears it locally —
     the token is stale/foreign and resending it would just repeat the
     failure; this is a defensive cleanup, not new business behavior.
   - `getMe`/`logoutCustomer` (Customer-required tier) throw
     `MissingCustomerSessionException` **before** any network call when no
     token is stored, rather than sending a request guaranteed to 401.
5. **Three-tier `X-Customer-Token` policy** (`_CustomerTokenPolicy`) mirrors
   the OpenAPI contract's own tiers exactly: `none` (Sensitive —
   register/login/OTP never send a token, because a customer cannot have
   one yet), `optional` (Read/Write on Cart — sent if stored, but a missing
   token never blocks the call, staying guest-usable per the contract),
   `required` (Customer-required — `me`/`logout`).
6. **`X-Cart-Token` round-trips automatically.** Every request attaches the
   stored cart token if present; every response's `X-Cart-Token` header (if
   present) is written back to the store before the envelope is even
   parsed — so a first `addCartItem` call that mints a brand-new cart token
   is captured the same way an existing-cart response is, with no special
   case in the calling code.
7. **`CommerceProductDetail` sealed class** discriminates the `/products/{id}`
   `oneOf` response by `is_variant_managed`, matching the OpenAPI schema's
   own documented rule exactly (`CommerceSimpleProduct` /
   `CommerceVariantManagedProduct`, the latter carrying `options`/
   `variants`) — an exhaustive `switch` over the result is a compile error
   if a third variant is ever added, the same guarantee MOBILE-RUNTIME-3's
   `AppAction` switch already relies on.
8. **Forward-compatible, still-defensive response parsing**
   (`commerce_models.dart`): unlike `app_schema.dart`'s strict allowlist
   parsing (untrusted, potentially adversarial CMS-authored input), this
   parses a *trusted first-party server's* own documented contract —
   unknown/additional fields are silently ignored (a newer server can add
   fields without breaking an older client), but every documented field is
   still presence/type-checked, and any mismatch raises
   `CommerceProtocolException` rather than a raw `TypeError`/
   `NoSuchMethodError` escaping this layer. This is a deliberate,
   documented difference in posture from MOBILE-RUNTIME-2's schema parser,
   not an inconsistency.
9. **Money stays in integer minor units end-to-end**: `CommerceMoney`
   carries `amountMinor`/`currency` straight from the wire; nothing in this
   client adds, multiplies, or otherwise derives a monetary value —
   consistent with CLAUDE.md's global money rule and MOBILE-RUNTIME-3's own
   `formatMinorAmount` (display-only, in the registry layer, untouched by
   this task).
10. **`CommerceErrorCode.fromWire`** maps all 17 documented `Error.code`
    values and falls back to `unknown` for anything else — the same
    fail-safe-on-drift posture as `decodeAction`/`CompatibilityResolver`:
    a future server adding an 18th code can never crash this client's
    error handling.

## Why this approach fits AWJ

- MR-03 is fully honored: no pricing/stock/payment/shipping rule is
  computed client-side; every `CommerceClient` method returns exactly what
  the server sent, parsed but not derived. Tenant/channel resolution stays
  entirely server-side (the store bearer token resolves it; this client
  has no tenant-selection concept at all).
- MR-06 (state separation) is structural: every return type is an
  immutable value object; `CommerceClient` itself holds no mutable
  business-state cache between calls — only the transport and the
  injected `SecureSessionStore`/`CommerceConfig` references.
- MR-07 is enforced by construction, not by convention: there is exactly
  one file (`commerce_client.dart`) that can read/write a token, and no
  method signature anywhere in this diff returns a raw token string.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.

## Changed files

```
mobile/lib/commerce/commerce_client.dart          (new)
mobile/lib/commerce/commerce_config.dart          (new)
mobile/lib/commerce/commerce_error.dart           (new)
mobile/lib/commerce/commerce_models.dart          (new)
mobile/lib/commerce/commerce_transport.dart       (new)
mobile/lib/commerce/secure_session_store.dart     (new)
mobile/lib/commerce/commerce.dart                 (new — barrel export)
mobile/test/commerce/fake_transport.dart          (new — test double + fixtures)
mobile/test/commerce/commerce_client_test.dart    (new — 20 tests)
mobile/test/commerce/commerce_models_test.dart    (new — 5 tests)
mobile/test/commerce/secure_session_store_test.dart  (new — 4 tests)
mobile/pubspec.yaml                               (+flutter_secure_storage: ^11.2.0)
mobile/pubspec.lock                               (regenerated via `flutter pub add`)
docs/plans/mobile/MOBILE-RUNTIME-4-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 0.6s)

$ flutter test
...
00:02 +101: All tests passed!
```

101 tests total: 29 new (20 in `commerce_client_test.dart` + 5 in
`commerce_models_test.dart` + 4 in `secure_session_store_test.dart`,
verified by direct `grep -c` count against each file) on top of the 72
carried over from MOBILE-RUNTIME-1/2/3. All green, including:
- every auth-tier policy (`none`/`optional`/`required`) proven by request-
  header assertions against the recorded `FakeCommerceTransport` requests,
  not just by return-value checks;
- the `oneOf` product-detail discriminator proven both ways (simple and
  variant-managed);
- token lifecycle proven end-to-end: login/OTP-verify persist, a 401
  clears, logout clears only on success;
- `FlutterSecureSessionStore` proven against the real plugin's own
  `MethodChannel` (mocked, no device/emulator available — same documented
  gap as MOBILE-RUNTIME-1's performance baseline) rather than merely
  trusted by inspection: write→read round-trips, a null write deletes
  (never stores the string `"null"`), the two fields use distinct keys,
  and `clear()` removes both.

## Build / lint / typecheck

`flutter analyze` (above, 0 issues — including Dart 3.8's null-aware
collection-element lint, applied throughout the new query/body-building
code). No native build attempted — out of this task's scope
(MOBILE-RUNTIME-9).

## CI

PR #954 opened on head `59e6baef38e6f73b9735a20d236756805978272b`; all 5
required checks (`mobile-ci.yml` analyze+test, `ci.yml` sqlite+pgsql ×2 for
push+PR events) passed — `conclusion: success` on every run.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `d715e7e` (code reviewed at `59e6baef38e6f73b9735a20d236756805978272b`;
  the one commit on top of that, `d715e7e`, is this section's own docs-only
  addition to this report — `git diff 59e6bae d715e7e --stat` touches only
  this file, zero code drift)
- Findings / resolution: fresh Reviewer + AWJ Guardian pass against the
  complete final code diff (`git diff 2276fc6 59e6bae`, 14 files, 2925
  insertions, 1 deletion):
  - All 5 required checks green on this exact head: `mobile (analyze +
    test)`, `php artisan test (L11, sqlite)` ×2, `php artisan test (L11,
    pgsql)` ×2 — all `conclusion: success`. `mergeable_state: clean`.
  - Diff contains exactly the files this task's own change list names —
    no checkout/payment/order/address code, no UI wiring, ahead of
    MOBILE-RUNTIME-5's scope.
  - Re-ran `flutter pub get && flutter analyze && flutter test` directly
    against this exact head in a fresh container (session resumed mid-CI-
    wait): 0 analyze issues, 101/101 tests passing — not just trusting the
    CI badge.
  - Confirmed by direct inspection that `CommerceClient` never returns a
    raw token from any public method (grepped every method's return type),
    that `logoutCustomer`'s success/failure token-clearing split and the
    401-clears-stale-token behavior are each backed by a dedicated test,
    and that path-segment building in `_send` never double-encodes (raw
    segments passed to `Uri.replace(pathSegments: ...)`, never pre-encoded
    then split).
  - Confirmed the `flutter_secure_storage` MR-19 dependency review in this
    report is complete (license, maintenance, platform, permissions,
    narrower-alternative consideration) and that Android's default
    `minSdkVersion` (24) already satisfies the package's minimum (23).
  - The one PR comment (`chatgpt-codex-connector[bot]` reporting it hit its
    own Codex usage limit) carries no review finding — no action needed.
  - No accounting/tenant/RBAC/API/DB code touched.
  - No unresolved review finding or Decision Gate.

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-4's outcome ("typed client + secure session
abstraction") and Gate C/D? Yes: a typed client against the committed
OpenAPI contract, explicit error-envelope handling, and a secure token/
session abstraction with negative tests (missing-session, 401-clears,
failure-preserves). Is there a simpler design than the three-tier
`_CustomerTokenPolicy` enum? Considered three separate boolean flags
(`sendCartToken`, `customerTokenRequired`, `customerTokenOptional`) —
rejected because that allows an invalid combination (both required and
optional true) the enum makes structurally impossible. Did I reuse
existing patterns instead of inventing new ones? Yes — the
interface-plus-fake-double pattern for `CommerceTransport`/
`SecureSessionStore` mirrors `ActionHandler`/`ComponentBuilder` from
MOBILE-RUNTIME-3 exactly.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that path segments are never manually percent-encoded before
being handed to `Uri.replace(pathSegments: ...)` — an earlier draft did
`Uri.encodeComponent(id)` then `.split('/')`, which double-encodes since
`pathSegments` already encodes each segment; caught during self-review and
fixed by passing raw segment lists throughout `_send` instead of
interpolated path strings, verified by the `getCategory`/`getProduct`/
`updateCartItem`/`removeCartItem` request-URI assertions in the test
suite; (2) that no method returns a raw token — grepped every public
method's return type by hand; (3) that `logoutCustomer`'s success/failure
token-clearing split is actually exercised by two separate tests, not
just documented in a comment; (4) that the `flutter_secure_storage`
dependency review above is a real record (license/maintenance/platform/
permissions/native-alternative), not a rubber stamp. Is any code broader
than the task? No checkout/payment/order/address code exists in this
diff — see "Scope boundary" above. Are tests proving behavior rather than
implementation trivia? Yes — every test asserts on either the recorded
outbound request (headers/URI/body) or the parsed return value/thrown
exception, never on private state.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable at this layer — tenant
resolution is entirely server-side via the store bearer token, which this
client treats as an opaque, injected value; no tenant-selection code
exists here to get wrong. Is any financial value computed with unsafe
types or client authority? No — `CommerceMoney` is a pass-through
(`amountMinor` + `currency`), never summed/multiplied/derived. Can
authorization be bypassed? No — every method that needs `X-Customer-Token`
either attaches the stored one or refuses to send the request at all
(`MissingCustomerSessionException`); nothing fabricates or guesses a
token. Could a locally cached value become business authority? No —
`CommerceClient` caches nothing; every call is a fresh request, and the
only "cache" is the two secure-session tokens, which are opaque
credentials, not business data. Are secrets/PII exposed? The store bearer
token and customer token are the only secrets in this layer; neither is
ever logged (no `print`/logging call exists in this diff), returned to a
caller, or written anywhere but `SecureSessionStore`. Could retries
duplicate side effects? `addCartItem`/`updateCartItem`/`removeCartItem`
match the contract's own idempotency story exactly (cart resolves by
token, updates are plain overwrites) — this client adds no retry logic of
its own that could double-submit.

## Accounting impact

None — this client performs no accounting-affecting operation (no
checkout/payment/order call exists in this diff).

## Tenant / branch isolation impact

None from this runtime's own code — tenant/channel resolution is entirely
server-side via the store bearer token this client treats as opaque
configuration.

## Security / authorization impact

Positive, structural: introduces the runtime's first platform-secure-
storage boundary (MR-07) and centralizes every customer/cart token
read/write behind one file, with negative tests for the missing-session,
stale-token-401, and failed-logout-preserves-token cases. No token is ever
returned to a caller, logged, or persisted outside `SecureSessionStore`.

## Backward compatibility

Fully preserved — no existing file outside the new `lib/commerce/`/
`test/commerce/` directories was modified except `pubspec.yaml`/
`pubspec.lock` (dependency addition only).

## API / DB / migration impact

None — this is a mobile-side HTTP client against an already-published,
unmodified OpenAPI contract; no server-side file was touched.

## External research used

- `pub.dev/packages/flutter_secure_storage` — license, current version,
  maintenance signal, platform support, and native-permission surface,
  fetched and recorded in the dependency review above (MR-19) before
  adding the dependency.
- Dart's null-aware-elements language feature (`?key: value` map syntax,
  available in this project's `sdk: ^3.13.4`) — verified by direct
  experimentation (a scratch `dart run`) before applying it, rather than
  assuming the exact syntax the analyzer's `use_null_aware_elements` lint
  was hinting at.
- Flutter Gradle plugin source
  (`packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt`) —
  read directly to confirm this Flutter version's default Android
  `minSdkVersion` (24) already satisfies `flutter_secure_storage`'s
  minimum (23), rather than assuming compatibility.

## Risks / remaining work

- `flutter_secure_storage`'s actual Keychain/Keystore behavior is untested
  on a real device/emulator (none available in this environment) — only
  its method-channel contract is verified. This is the same category of
  gap MOBILE-RUNTIME-1's performance baseline already documented and
  explicitly deferred to a task with real device/emulator access
  (MOBILE-RUNTIME-9/10).
- No UI consumes `CommerceClient` yet; MOBILE-RUNTIME-5 is where a real
  network round-trip against a live `/commerce/v1` deployment would first
  be exercisable (still out of this proof horizon's reach without a
  deployed environment/tenant to point at).

## Discovered backlog

- Checkout/payment/order-history/address-book client methods (documented
  in `docs/openapi/commerce-api-v1.yaml` but out of this task's scope —
  see "Scope boundary") for whichever future task takes on checkout.
- `mediaUri()` currently just builds the URL; MOBILE-RUNTIME-5 will need
  to decide how an authenticated `Image.network`-style widget attaches the
  same `Authorization`/store-bearer header this client uses for JSON
  calls, since `Image.network` alone has no header-injection hook without
  a custom `HttpClient`-backed image provider.

## Merge

- Merge status: **merged** (squash), PR #954.
- Merge SHA: `b645d33b84cfaa85266122f1ea0272c28ee79158`

## Post-merge review

- POST_MERGE_REVIEW: **PASS**
- Reviewed Merge SHA: `b645d33b84cfaa85266122f1ea0272c28ee79158`
- Target-branch checks/smoke:
  - `git fetch origin main` confirms `origin/main` tip is exactly this SHA,
    single parent `2276fc66aa190e696e2fff39ef5bdbc8faf0cea5` — a genuine
    squash merge.
  - `git diff 20c8d9397199b3e030842e0afd7ef43e261f211e origin/main --
    mobile/lib/commerce mobile/test/commerce mobile/pubspec.yaml
    mobile/pubspec.lock docs/plans/mobile/MOBILE-RUNTIME-4-IMPLEMENTATION-REPORT.md`
    is empty — the squash preserved the reviewed content exactly.
  - Post-merge CI on this exact `head_sha`: `ci.yml` run
    [35823026097](https://github.com/safwan5001-source/Nebrax/actions/runs/35823026097)
    and `mobile-ci.yml` run
    [35823026148](https://github.com/safwan5001-source/Nebrax/actions/runs/35823026148),
    both `conclusion: success`.
  - Targeted post-merge smoke: `flutter analyze` (0 issues) and `flutter
    test` (101/101 passing) re-run directly against the merged content.
- Findings / resolution: none — no unexpected integration change.

## Continuation-mechanism note (horizon-wide, not specific to this task)

This task's CI wait exposed that `ScheduleWakeup` fallback wake-ups do not
reliably fire in this environment — the session went idle past at least
one scheduled wake time without resuming, and durable-state updates for
this task were still pending when the session was later resumed by an
unrelated `SessionStart:resume` hook rather than by the schedule itself.
Per explicit owner instruction, the continuation strategy for the rest of
this horizon is: `subscribe_pr_activity` (event-driven, GitHub-pushed) as
the primary trigger, with `send_later`/`create_trigger`
(`claude-code-remote` MCP server) as the fallback instead of
`ScheduleWakeup` — `send_later`'s own documentation states delivery
"survives container restarts", which `ScheduleWakeup` does not claim. No
application architecture or infrastructure was changed to work around
this; it is purely a change in which of this session's own existing tools
schedules the fallback check-in. If neither mechanism fires, the session
remains blocked until the owner manually resumes it — that residual risk
is inherent to this platform's session-resumption model and is not fully
eliminated by this change, only reduced.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: #954 (merged)
- Base SHA: `2276fc66aa190e696e2fff39ef5bdbc8faf0cea5` (`origin/main`, PR #953)
- Head SHA: `20c8d9397199b3e030842e0afd7ef43e261f211e` (reviewed; merged as `b645d33b84cfaa85266122f1ea0272c28ee79158`)

## Recommended next dependency-ready task

`MOBILE-RUNTIME-5` (Home/Product/Cart vertical UI) — depends on both this
task and `MOBILE-RUNTIME-3` (merged) per the horizon's dependency table,
and does not require this task's own Post-Merge Review to start, though
this session continues sequentially.
