# MOBILE-PREVIEW-10A — Real Device Verification Readiness

**Horizon:** AWJ App Builder — Real Mobile Preview
**Task:** MOBILE-PREVIEW-10A (readiness/evidence only — no implementation, no provisioning)
**Repository:** `safwan5001-source/Nebrax`
**Base:** `main` @ `7078fcfa1d8eb18cbbf985b0cdfda205c30b6f66` (merged PR #1137, APP-BUILDER-PREVIEW-UX-1)
**Scope:** Closure Criterion #10 of `AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md` only.

---

## 1. Executive status

**Criterion #10 status: `OPEN`.** It must stay `OPEN` until real Android **and** real iOS
physical-device verification has actually been executed and recorded. Nothing in this
document changes that — this is a readiness audit, not an execution.

Both engineering decisions that previously blocked progress are now resolved by the owner
(Option A packaging; hostname `preview.awjdev.xyz`), but **neither decision has been
provisioned or wired into the repository yet**. The single largest, concrete finding of this
audit is:

> The code today is still hardwired to a placeholder preview host —
> `preview.awj-runtime-proof.example` (an IANA-reserved `.example` domain) — in three places
> (Android manifest, iOS entitlements, and the Flutter deep-link constant). **`preview.awjdev.xyz`
> appears nowhere in the repository.** Wiring the owner-approved hostname into those three places
> is a small, mechanical, non-flavor, non-identifier source change — but it is still a repository
> change beyond docs, so per this task's stop conditions it is **flagged, not made**, here. See
> §7 and §17.

Everything else that eleven of the twelve Horizon exit criteria require (security architecture,
QR/exchange flow, tenant isolation, backward compatibility, honest runtime-truth UX) is
implemented, unit/integration/concurrency-tested, and green in CI. What is categorically missing
is anything that can only be produced by a human holding a real Android phone and a real iPhone —
no amount of source review, static analysis, or CI closes that gap, and this document does not
pretend otherwise.

---

## 2. Current verified repository state

### 2.1 Three independent Dart entry points (confirmed, all read in full)

| File | Role | Bearer source | Flavor |
|---|---|---|---|
| `mobile/lib/main.dart` | Production | N/A | none |
| `mobile/lib/main_preview.dart` (MOBILE-PREVIEW-6) | Developer preview | `--dart-define=PREVIEW_SESSION_TOKEN=<raw bearer>` (manually copied) | none |
| `mobile/lib/main_device_preview.dart` (MOBILE-PREVIEW-7) | **Merchant QR/exchange preview — the real-device verification entry point** | Obtained at runtime via the one-time exchange flow; reads only `--dart-define=PREVIEW_BASE_URL` (default `https://commerce.invalid/preview/v1`) | none |

`main_device_preview.dart` is confirmed separate from `main.dart`, confirmed to render the
**real, unforked** preview runtime (`PreviewRuntimeView` + `ExperienceView` + the live
Component Registry — the same code path `main_preview.dart` uses), and confirmed to consume the
deep-link/exchange flow end-to-end through `AwjDevicePreviewApp`
(`mobile/lib/preview/device_preview_app.dart`), an explicit five-state machine
(`waitingForLink → exchanging → ready | invalid | unavailable`).

**No Flutter flavor exists anywhere in the mobile project** — `pubspec.yaml` has no flavor
sections, `android/app/build.gradle.kts` has no `productFlavors` block, and both the Android
manifest and iOS entitlements carry an explicit in-repo comment stating production and
device-preview "share one Xcode target/bundle until a future task introduces build-flavor
separation." This matches Option A exactly: **no flavor work is required or implicated** by
this readiness pass.

### 2.2 Deep-link → exchange → runtime chain (confirmed end to end)

1. **Deep link received** — `PreviewDeepLinkController` (`preview_deep_link_channel.dart`)
   listens on the same native `MethodChannel('awj/deep_links')` the production deep-link
   controller uses (Android `MainActivity.kt` and iOS `SceneDelegate.swift` both forward raw
   URL strings over this one channel, with **no native-side validation or allowlisting** —
   that logic lives entirely in Dart).
2. **Link parsed** — `preview_deep_link.dart` only recognizes
   `https://{kPreviewDeepLinkHost}/preview/{reference}` where
   `kPreviewDeepLinkHost = 'preview.awj-runtime-proof.example'` (placeholder, see §7), the
   reference matches `^[A-Za-z0-9]+$`, length ≤ 128, and query parameters are ignored.
3. **Exchange call** — `PreviewExchangeClient.exchange(reference)` issues
   `POST {PREVIEW_BASE_URL}/exchange` with body `{"reference": "..."}` — **never** a query
   string, **never** an `Authorization` header. A 401 maps to `PreviewExchangeInvalid`; any
   other non-2xx maps to `PreviewExchangeUnavailable('http_<code>')`; a 2xx with a token maps to
   `PreviewExchangeSucceeded(sessionToken)`.
4. **Backend consumption** — `PreviewExchangeService::consume()` runs inside `DB::transaction()`
   with `lockForUpdate()` on the reference row, checks consumed/expired/tenant-inactive/
   app-missing in order (each rejection recorded internally with a reason code, but every
   rejection surfaces to the client as the same generic 401), and on success mints a **new**
   `PreviewSession` (`expires_at = now()->addMinutes(15)`) and a Sanctum token scoped to exactly
   `preview:read`. Postgres-specific concurrency test
   (`tests/Feature/PreviewExchangePostgresConcurrencyTest.php`) proves the lock genuinely blocks
   a second real PDO connection — not a single-connection approximation.
5. **Runtime render** — the resulting bearer is held only in memory
   (`PreviewConfig.sessionToken`); the class doc explicitly states it is "never written back
   into a URI, SharedPreferences, or any log line." `PreviewRuntimeView` then fetches
   `GET {PREVIEW_BASE_URL}/experience` with `Authorization: Bearer <token>` and renders one of
   four states (`Unauthorized` / `Incompatible` / `Unavailable` / `Ready` →
   `ExperienceView` + `AppActionDispatcher`), with **no last-known-good cache and no silent
   fallback to a bundled default experience** — by design, a broken fetch shows a controlled
   error, never a fake success.

### 2.3 Security contract (quoted, current, matches code)

From the MOBILE-PREVIEW-9 closure report (§7), independently re-verified against live source by
this audit:

> `PreviewSession` is the fifth application of AWJ's existing scoped-token pattern: an opaque
> Sanctum bearer, single `preview:read` ability (never intersecting `Rbac::MATRIX`), write-once
> `tenant_id`/`builder_app_id`, an immutable Draft snapshot bound at issuance, ≤60-minute TTL
> ceiling (15-minute default), kept on a dedicated `preview/v1` surface entirely outside
> `commerce/v1`. The QR/device flow never carries the bearer itself — only a one-time, 5-minute,
> hash-only-stored exchange reference in the URL path, redeemed via an atomically locked
> consumption that mints the real session for the first time only on successful exchange.

Confirmed directly in code: `PreviewExchangeReference::TTL_MINUTES = 5` (fixed, not
configurable); `reference_hash = hash('sha256', Str::random(40))` (~238 bits entropy, raw value
never persisted); `PreviewSession::DEFAULT_TTL_MINUTES = 15`, `MAX_TTL_MINUTES = 60`;
`PreviewSession::ABILITY_READ = 'preview:read'`. All failure modes (expired, consumed, unknown,
malformed, wrong-tenant) collapse to one generic 401 response — confirmed by
`tests/Feature/PreviewExchangeTest.php` and `AuthenticatePreviewSession.php`.

### 2.4 Test coverage (backend + mobile, all pre-existing and CI-green)

- **Backend:** `PreviewExchangeTest.php` (317 lines), `PreviewExchangePostgresConcurrencyTest.php`
  (203 lines, Postgres-only), `PreviewSessionTest.php` (357 lines),
  `PreviewIntegratedChainTest.php` (231 lines) — RBAC, tenant isolation, one-time consumption,
  TTL enforcement, draft-snapshot freezing, and audit-trail redaction (raw reference/token never
  appears in `PreviewSessionEvent` rows).
- **Mobile:** `device_preview_app_test.dart`, `preview_exchange_client_test.dart`,
  `preview_deep_link_test.dart`, `preview_client_test.dart`, `preview_startup_test.dart`,
  `preview_runtime_view_test.dart`, `preview_action_handler_test.dart` — widget/unit coverage of
  every state transition, including a second link after a successful exchange never re-triggering
  a second exchange, and the production vs. preview deep-link allowlists never overlapping.

**None of this is, or claims to be, device verification.** It is exactly the "CODE + TEST + CI"
evidence the closure report already credits toward criteria 1–9 and 11–12 — criterion #10
explicitly excludes it.

---

## 3. Android readiness

| Item | Current state | Source |
|---|---|---|
| `applicationId` / `namespace` | `com.example.awjmobileruntimeproof` — in-repo comment calls it an "explicitly temporary proof identifier... Production Application ID remains an owner Decision Gate." Owner Decision #1 (Option A) keeps this unchanged for this verification pass. | `mobile/android/app/build.gradle.kts:8,24` |
| Manifest intent-filters | 3 total: launcher; production App Link (`autoVerify="true"`, host `awj-runtime-proof.example`); device-preview App Link (`autoVerify="true"`, host `preview.awj-runtime-proof.example`). Both non-launcher filters carry an in-repo comment stating `autoVerify` "cannot actually succeed until a real domain hosts the matching `.well-known/assetlinks.json`." | `mobile/android/app/src/main/AndroidManifest.xml:30-33,34-49,51-76` |
| `preview.awjdev.xyz` present? | **No.** `grep -rniI "awjdev" mobile/android` returns zero matches anywhere in the Android tree. | confirmed by direct grep |
| `assetlinks.json` in repo | Not present anywhere in the repository. | confirmed absent |
| Release signing | `signingConfig = signingConfigs.getByName("debug")` with a literal `// TODO: Add your own signing config for the release build`. Release builds today are debug-signed. | `mobile/android/app/build.gradle.kts:38-42` |
| Gradle wrapper | **Absent.** No `gradlew`/`gradlew.bat` present in this checkout; `.gitignore` lists them (along with `gradle-wrapper.jar`/`local.properties`) as untracked, confirming they are generated artifacts, not committed source — it does not by itself establish which command regenerates them. | confirmed via Glob + `.gitignore` |

### Exact `assetlinks.json` relationship required

Android App Links verification (per `developer.android.com/training/app-links` and the Flutter
`set-up-app-links` cookbook, both fetched directly — see §External Evidence) requires:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.example.awjmobileruntimeproof",
    "sha256_cert_fingerprints": ["<SHA-256 fingerprint of the key that signs the installed build>"]
  }
}]
```

hosted at `https://preview.awjdev.xyz/.well-known/assetlinks.json`, served over HTTPS, as
`application/json`, with no redirect. `sha256_cert_fingerprints` is a property of the signing
**certificate**, not of the `applicationId` — the array must list the fingerprint of whichever
certificate actually signs the test build installed on-device, and must hold more than one entry
only if more than one signing certificate needs to be trusted (e.g. Play App Signing's upload key
alongside its own signing key). For this verification pass, exactly one fingerprint is needed:
the one for the certificate used to sign the installed APK (see below).

### Signing certificate fingerprint — exact source needed

- **Debug/local physical-device verification (the realistic path for this pass, since release
  signing is still debug-keyed):** `keytool -list -v -keystore <path-to-debug.keystore> -alias androiddebugkey -storepass android -keypass android`, run **on whichever machine builds and
  installs the APK onto the test phone** — a debug keystore is normally machine-generated and
  not committed to the repo, so the fingerprint is per-build-machine, not a fixed repo constant.
  This must be captured fresh at execution time, not assumed from any prior value.
- **Release-signed verification, if ever needed later:** requires `keytool -list -v -keystore
  <release-keystore>` against the actual release signing key — which does not exist in this
  repository today (debug signing is currently used for release builds). **Not required for
  Criterion #10**, which only needs one real, verifiable installation — but flagged because a
  reviewer might otherwise assume "release-signed" is the bar.
- **Not invented here.** No fingerprint value appears anywhere in this document; it is a required
  operational input captured at execution time.

---

## 4. iOS readiness

| Item | Current state | Source |
|---|---|---|
| Bundle identifier | `com.example.awjMobileRuntimeProof` (Runner target); `.RunnerTests` suffix for the test target. Owner Decision #1 keeps this unchanged. | `mobile/ios/Runner.xcodeproj/project.pbxproj:387,403,420,435,569,592` |
| Associated Domains entitlement | Two `applinks:` entries: `applinks:awj-runtime-proof.example` (production), `applinks:preview.awj-runtime-proof.example` (device-preview). Same "cannot verify until real domain hosts AASA" comment as Android. | `mobile/ios/Runner/Runner.entitlements:7,18` |
| `preview.awjdev.xyz` present? | **No.** Zero matches in `mobile/ios` tree. | confirmed by direct grep |
| URL scheme fallback | **None exists.** `Info.plist` has no `CFBundleURLTypes` key — Universal Links are the *only* way into this app from outside; there is no custom-scheme fallback. | `mobile/ios/Runner/Info.plist` (71 lines, read in full) |
| Code signing | `CODE_SIGN_STYLE = Automatic`; `DEVELOPMENT_TEAM` **does not appear anywhere** in `project.pbxproj` (zero matches). No Apple Developer Team is configured. | confirmed by direct grep |
| AASA in repo | Not present anywhere in the repository. | confirmed absent |

### Exact AASA structure required

Per `developer.apple.com` (Associated Domains / Universal Links, fetched directly) and Flutter's
own `set-up-universal-links` cookbook:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appIDs": ["<TEAMID>.com.example.awjMobileRuntimeProof"],
        "components": [
          { "/": "/preview/*" }
        ]
      }
    ]
  }
}
```

Hosted at `https://preview.awjdev.xyz/.well-known/apple-app-site-association` (Apple checks
`.well-known` first, falls back to domain root only if `.well-known` is absent or a standard
404 — hosting in both places is harmless but not required once `.well-known` works), served as
`application/json`, **no file extension**, **no redirect of any kind** (Apple's crawler does not
follow redirects — not even a trailing-slash redirect), ≤128 KB, HTTPS only. `apps: []` is a
required key even though empty. `components` with `"/": "/preview/*"` scopes Universal Links to
only the preview path — the production host's own, separate AASA entry is out of scope here.

### Team ID / signing identity — not available in-repo

`project.pbxproj` has **no `DEVELOPMENT_TEAM` value at all** — not a placeholder, genuinely
absent. This means:

- The `appIDs` value in the AASA file above cannot be completed without a real Apple Developer
  Team ID, which does not exist anywhere in this repository and is **not invented here**.
- A real-device iOS build cannot be code-signed as-is; Xcode's "Automatic" signing will prompt for
  a team the first time a real device target is selected — this requires an actual Apple
  Developer account (free or paid) attached to the Xcode session that performs the build. This is
  a required operational input, not a repository gap to fix with a code change.

---

## 5. `preview.awjdev.xyz` host requirements

Nothing below is provisioned. This is the exact checklist for what must exist before Criterion
#10's App Link / Universal Link path can be genuinely exercised (as opposed to the
intent-bypass workaround in §11/§12).

1. **HTTPS** — mandatory; both association files and the fallback page must be served over TLS.
2. **`/.well-known/assetlinks.json`** — exact schema in §3, `application/json`, no redirect, no
   auth.
3. **`/.well-known/apple-app-site-association`** — exact schema in §4, `application/json`, no
   extension, no redirect, ≤128 KB.
4. **Root-path AASA** — not required in addition to `.well-known`, per Apple's own fallback order;
   skip unless `.well-known` proves unreliable in practice.
5. **Content-type** — `application/json` for both association files; no specific requirement
   found for the fallback page beyond standard `text/html`.
6. **Redirects to avoid** — none on either association file path, and none on `/preview/{reference}`
   that would carry the reference forward (e.g. no 301 appending the reference to a Play
   Store / App Store URL).
7. **Fallback route `/preview/{reference}`** — see exact response-behavior table in §10.
8. **Security headers** — `Referrer-Policy: no-referrer` (see §8), `X-Content-Type-Options: nosniff`,
   and a restrictive CSP that allows no third-party script execution on this one path.
9. **Log-redaction** — redact or hash the final path segment (the reference) in reverse-proxy/CDN
   access logs; do not rely on the application layer alone (it already does not log the raw value
   — see §2.3).
10. **Analytics/telemetry** — none on this path. If a shared site-wide template normally injects
    an analytics snippet, this path needs an explicit exemption.
11. **Response behavior** — see §10.

None of items 1–11 are provisioned, deployed, or configured anywhere today. This section is the
checklist for the operational phase, not a statement of current state.

---

## 6. Association-file requirements (consolidated)

| File | Path | Format | Hard constraints |
|---|---|---|---|
| `assetlinks.json` | `/.well-known/assetlinks.json` | JSON array, `delegate_permission/common.handle_all_urls` | HTTPS, no redirect, public, exact `package_name` + `sha256_cert_fingerprints` match |
| `apple-app-site-association` | `/.well-known/apple-app-site-association` | JSON object, `applinks.details[].appIDs` + `components` | HTTPS, no redirect, no extension, ≤128 KB, `apps: []` required |

Both files are **inert today** — their correctness cannot be verified until they are actually
hosted, because both Android's and iOS's verification crawlers only run against a real, live
HTTPS endpoint.

---

## 7. Signing/identity inputs still needed

These are genuinely external inputs — not repository gaps, not invented here:

1. **Android signing certificate SHA-256 fingerprint** — captured at build time from whichever
   keystore signs the test APK (see §3). Not a fixed value; not committed to the repo by design
   (debug keystores are machine-local).
2. **Apple Developer Team ID** — absent from `project.pbxproj` entirely. Required to complete
   both the AASA `appIDs` value and to code-sign any real-device/TestFlight iOS build. Requires
   an actual Apple Developer account.
3. **Hosting target for `preview.awjdev.xyz`** — DNS + TLS + where the association files and
   fallback page are actually served from (reverse proxy, static host, Laravel route, etc.) is
   an infrastructure decision this task does not make (see Stop Conditions).
4. **Three hardcoded host strings that must change together** before any real App Link/Universal
   Link test can work (flagged, not changed, per scope):
   - `mobile/android/app/src/main/AndroidManifest.xml:76` (device-preview intent-filter
     `android:host`)
   - `mobile/ios/Runner/Runner.entitlements:18` (device-preview `applinks:` entry)
   - `mobile/lib/preview/preview_deep_link.dart:24` (`kPreviewDeepLinkHost` constant)

   A fourth location, `config/preview.php:17` (`PREVIEW_DEEP_LINK_HOST` default), is already
   **env-overridable** — it needs an environment variable set wherever the backend serving the
   exchange API runs, not a source change. The three above are compiled-in constants and
   genuinely require a source edit to point at `preview.awjdev.xyz` instead of the current
   `preview.awj-runtime-proof.example` placeholder. **This document does not make that edit** —
   see §17 for why, and the recommended next step.

---

## 8. Reference URL security review

Trace: merchant dashboard → `POST .../preview-exchange-references` → QR (`deep_link` value) →
phone OS → device app → `POST /preview/v1/exchange` → `PreviewSession` → `GET /experience`.

| Location | Can the raw reference appear here? | Classification | Basis |
|---|---|---|---|
| Merchant's own browser (API response body) | Yes — `{reference, deep_link, ...}` returned to the authenticated merchant session | Expected | `PreviewExchangeReferenceController.php:38-44`; same-origin, already-authenticated, 5-minute life |
| QR code image (client-rendered SVG) | Yes — that is the delivery mechanism | Expected | `preview-on-phone.tsx:179`, `QRCodeSVG value={qrData.deep_link}` |
| Merchant dashboard URL / browser history | No | Avoided by design | QR is rendered from in-memory state; the dashboard's own URL never embeds the reference |
| Laravel application logs | No | Avoided by design (confirmed) | MOBILE-PREVIEW-8 audit + `PreviewSessionEvent` tests: raw reference/token never written to any log or audit row |
| Phone's deep-link resolution (verified App Link/Universal Link, success case) | No — OS intercepts the tap before any HTTP request; the URL never crosses the network | Expected | Standard Android App Links / iOS Universal Links behavior (OS-level interception), confirmed by Flutter's own cookbooks |
| Reverse proxy / CDN access logs at `preview.awjdev.xyz` (fallback case: unverified link, app not installed, or link opened directly in a browser) | **Yes** — a real HTTP GET to `/preview/{reference}` is the one scenario where the reference crosses the network and lands in a standard access log by default | **Operationally controllable, not yet controlled** | Flagged by MOBILE-PREVIEW-8; no infra exists yet to configure, so the control is specified but not implemented (§5 item 9) |
| `Referer` header to a subresource/third party loaded from the fallback page | Only if the fallback page loads any cross-origin or even same-origin subresource without a referrer policy | **Avoidable** | MDN: default `strict-origin-when-cross-origin` sends the full path on *same-origin* requests; `no-referrer` eliminates this entirely. OWASP REST Security Cheat Sheet independently recommends `Referrer-Policy: no-referrer` for exactly this class of problem |
| Redirects carrying the reference forward | Only if the fallback page or exchange flow ever issues a redirect that appends/forwards the reference | **Avoidable** — must not exist | No redirect on this path is specified anywhere in the design; this document reaffirms none should be added |
| Analytics/telemetry auto-capturing `window.location.href` | Possible by default in most analytics SDKs if one is ever added to this path | **Avoidable** | Must explicitly exclude this path from any analytics; not yet relevant since no host/page exists |
| Crash-reporting SDK breadcrumbs (mobile app) capturing the deep-link URI | **Not verified either way** — no crash-reporting SDK integration was found or ruled out in the `preview/` directory during this audit | **Unknown — must be checked during execution** | Gap, not a finding; flagged explicitly rather than assumed |
| Page content / title echoing the reference back | Would be avoidable if it existed | **Avoidable — must not be built this way** | Fallback page (not yet built) must never render the reference value in visible text or `<title>` |
| Support/debug tooling | No raw value surfaces — only reason codes (`consumed`, `expired`, `tenant_inactive`, `app_missing`) | Avoided by design (confirmed) | `PreviewExchangeService::consume()` records reason codes, never the plaintext reference, in `recordRejected()` |

**No speculative claims:** every "Expected" and "Avoided by design" row above is backed by a
specific file:line or test already in the repository. Every "Avoidable"/"Operationally
controllable" row is a requirement for the not-yet-built hosting layer, not a claim that it is
already satisfied.

---

## 9. Required logging/redaction controls

1. Reverse-proxy/CDN access logs for `/preview/{reference}` must redact or hash the final path
   segment — do not rely on the application layer, which cannot see requests the OS intercepts
   before they reach the server, and which the fallback page itself must not log server-side
   either.
2. No analytics/telemetry pipeline may be attached to `/preview/{reference}` or to the two
   association-file paths.
3. Any crash-reporting SDK present in the mobile app (status unverified — see §8) must be
   confirmed not to capture the raw deep-link URI in breadcrumbs, or must have this one path
   explicitly scrubbed.
4. `Referrer-Policy: no-referrer` on the fallback page's HTTP response, confirmed against MDN and
   OWASP as the correct, most restrictive directive for a URL carrying a one-time credential-like
   value.
5. The existing application-layer behavior (no raw value in Laravel logs or audit rows) must not
   regress when the fallback page/host is eventually built — i.e., the new infrastructure layer
   should not introduce a server-side log line that re-captures what the application layer
   deliberately avoids.

---

## 10. Fallback page security/UX contract

| Scenario | Required behavior |
|---|---|
| Reference valid, app installed, link verified | OS intercepts before any HTTP request — the fallback page is never hit. No page to design for this case. |
| Reference valid, app **not** installed | Generic "open this on your phone" page with store badges (Play Store / App Store); does not display, echo, or title-encode the reference; no redirect that forwards the reference to the store URL. |
| Reference expired | Generic message ("this preview link has expired") — must not reveal *why* in a way that distinguishes expired vs. consumed vs. unknown (matches the backend's own generic-401 design in §2.3). |
| Reference already consumed | Same generic message as expired — no distinguishing signal. |
| Browser opened the URL directly (desktop, or App Link/Universal Link unverified) | Same generic page; must not attempt to call the exchange API from the fallback page itself (the exchange is an app-only, bearer-issuing action — a web page performing it would create a new, uncontrolled exposure surface for the resulting token). |
| Any of the above | `Referrer-Policy: no-referrer`, no analytics, no third-party subresources, no redirects, content-type `text/html`, HTTPS only. |

---

## 11. Android physical-device test plan

**Prerequisites**
- A real Android phone (not an emulator) with Developer Options + USB debugging enabled.
- `flutter`, Android SDK platform-tools (`adb`), and a valid Flutter-generated Android Gradle
  wrapper/platform scaffold present before building — absent in this checkout today (see §2). If
  absent in a fresh checkout, restore/regenerate the Flutter Android platform scaffold using the
  repository's pinned Flutter version and its established project-generation procedure, taking
  care not to overwrite AWJ's native customizations (the manifest's App Link intent-filters, the
  `applicationId`, etc.) — do not run a blind, destructive `flutter create .` over the existing
  `android/` tree. Only once the scaffold is valid should `flutter pub get` be run, to resolve
  Dart/Flutter package dependencies.
- Either: (a) `preview.awjdev.xyz` hosting `assetlinks.json` with a fingerprint matching the
  exact keystore used to sign the test build, for a genuine App Link test; or (b) the
  `adb`-based intent-bypass method below, which proves the Flutter-side handling but **does not**
  prove App Link verification.

**Steps**
1. `cd mobile`; confirm the Android Gradle wrapper/platform scaffold is valid (restore/regenerate
   per the prerequisites above if it is missing or stale), then run `flutter pub get` and confirm
   no errors.
2. `flutter devices` — confirm the physical phone is listed.
3. `flutter run --target lib/main_device_preview.dart --dart-define=PREVIEW_BASE_URL=https://<reachable-backend-host>/preview/v1 -d <device-id>` — installs and launches the standalone verification entry point. This is the literal, un-reinterpreted meaning of Option A: no flavor flag, no changed `applicationId`.
4. From the AWJ web dashboard, open "Preview on Phone" for a real builder app/draft and let it
   issue a real exchange reference + QR.
5. **If real App Link hosting is live:** scan the QR with the phone's camera; confirm the OS
   offers/auto-opens the AWJ app (not a browser) — this is the only step that genuinely exercises
   App Link verification.
   **If hosting is not yet live:** use
   `adb shell 'am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://<deep-link-host>/preview/<reference>"' com.example.awjmobileruntimeproof`
   to simulate the intent directly — record explicitly in the evidence that this method bypasses
   OS-level App Link verification and only proves the Flutter-side parse/exchange/render chain.
6. Confirm the app transitions `waitingForLink → exchanging → ready` and renders the real
   experience (not a placeholder).
7. **One-time-use proof:** reopen the same deep link a second time (same reference) — confirm the
   app (or a fresh `adb` replay) reaches the `invalid` state, and confirm via a backend check
   (or a second `PreviewSession` count) that no second session was created.
8. **Expiry proof:** issue a new reference, wait past 5 minutes without exchanging it, then
   attempt the exchange — confirm the `invalid` state.
9. **Revocation proof:** issue + exchange a reference, then call the merchant
   `DELETE .../preview-sessions/{id}` endpoint for the resulting session, then attempt
   `GET /experience` from the device — confirm it now fails.
10. **Cross-tenant/cross-app negative check (safely feasible):** attempt to exchange a reference
    issued for Tenant/App A against a device session context associated with Tenant/App B's
    backend credentials, if a second test tenant is available — confirm generic rejection, not a
    distinguishing error.

**Evidence to record:** screen recording or timestamped screenshots of each state transition;
`adb logcat` excerpt showing the intent was received (not the full log, and never showing the
raw reference in anything that will be retained — redact it from saved logs); the exact
`flutter run` invocation used; the device model/Android version; confirmation of installed
package/signature; the backend `PreviewSession`/`PreviewExchangeReference` row states
before/after (via an authenticated admin query, not raw DB dump) for the one-time-use, expiry,
and revocation proofs.

---

## 12. iOS physical-device test plan

**Prerequisites**
- A real iPhone (not the Simulator — `xcrun simctl openurl` only works on Simulator and does not
  exercise real Universal Link verification or a real device's network/App stack).
- A Mac with Xcode, and an Apple Developer account/Team ID attached (absent from the repo today —
  see §4/§7).
- `preview.awjdev.xyz` hosting a correct AASA file is a **hard requirement** for any real test
  here, because, unlike Android, **this app has no custom URL scheme fallback** (confirmed,
  `Info.plist` has no `CFBundleURLTypes`). Without real AASA hosting, there is categorically no
  way to deep-link into this app on a real iPhone — not even an intent-bypass equivalent exists
  for iOS the way `adb am start` exists for Android.

**Steps**
1. Set `DEVELOPMENT_TEAM` in Xcode (Signing & Capabilities) to a real team; confirm the
   Associated Domains capability still lists both `applinks:` entries as already present in
   `Runner.entitlements`.
2. Build and run `main_device_preview.dart` directly onto the physical iPhone via Xcode or
   `flutter run --target lib/main_device_preview.dart --dart-define=PREVIEW_BASE_URL=... -d <device-id>`.
3. From the dashboard, issue a real exchange reference + QR as in the Android plan.
4. Open the Camera app (or Notes, per Flutter's own cookbook guidance) and tap the resulting
   `https://preview.awjdev.xyz/preview/{reference}` link — confirm the OS offers/launches the AWJ
   app directly (true Universal Link behavior), not Safari.
5. Confirm the same `waitingForLink → exchanging → ready` transition and real experience render
   as the Android plan.
6. Repeat the one-time-use, expiry, and revocation proofs from §11 steps 7–9, substituting the
   iPhone as the device under test.
7. **Negative case to also capture:** tap the same link again from a different app (e.g. Messages)
   after revoking AASA trust is not practical to simulate safely — instead, capture the
   **expired/consumed** generic-rejection screen as the negative evidence for iOS, matching the
   Android proof.

**Evidence to record:** screen recording of the Universal Link tap → app launch → rendered
experience; device model/iOS version; confirmation the Associated Domains capability resolved
(Xcode's own "Associated Domains" debug console output, or `Settings → Developer → Universal
Links → Diagnostics` on iOS 16+, which reports AASA fetch success/failure without needing
third-party tools); the exact build/run invocation; backend row states before/after for the
one-time-use and expiry proofs, as in §11.

**Explicit non-claim:** this task does not claim iOS has been verified. The plan above cannot be
executed in this sandbox at all (no macOS/Xcode, see §13), and even outside this sandbox it
cannot be executed until `preview.awjdev.xyz` hosts a real, correct AASA file with a real Team ID.

---

## 13. Build/tooling readiness performed in this environment

| Toolchain | Status in this sandbox | What was attempted |
|---|---|---|
| Flutter | **Not installed.** `which flutter` → empty; `flutter --version` → `command not found`. | `flutter analyze`/`flutter test` could not be run. |
| Android Gradle | **Not feasible.** No `gradlew`/platform scaffold present in this checkout (it is `.gitignore`d as a generated artifact, and no Flutter toolchain is available here to regenerate it — see Flutter row above); `ANDROID_HOME`/`ANDROID_SDK_ROOT` unset; no Android SDK found anywhere on the filesystem. Java and a standalone Gradle binary exist, but a build needs both the scaffold and the SDK, neither present. | No build attempted beyond this diagnostic, per the task's "do not spend time forcing unavailable toolchains" instruction. |
| Xcode / iOS | **Categorically impossible** — this is a Linux container; iOS tooling requires macOS regardless of repo state. | Not attempted. |

**No widget test, unit test, emulator run, or static analysis was executed as part of this
specific audit** (the existing test suite already in the repo, enumerated in §2.4, was read but
not re-run here, since re-running it would still only be CODE+CI evidence — already credited
toward criteria 1–9, never toward criterion #10). This section exists to record precisely what
could and could not be exercised in this sandbox, not to substitute for it.

---

## 14. What can be proven now

- The exchange/security architecture is sound, tenant-isolated, one-time, short-lived, and
  already proven under real Postgres row-locking concurrency (not simulated).
- The real (unforked) Flutter runtime renders correctly given a valid session, proven by widget
  tests reading actual rendered marker text from the component tree.
- `main_device_preview.dart` is a legitimate, already-built, standalone verification entry point
  requiring no new flavor, consistent with Option A.
- No raw exchange reference or session bearer is ever written to a first-party Laravel log or
  audit row — proven by code and test, not merely claimed.
- Both platforms' App Link/Universal Link configuration is syntactically present but **points at
  a placeholder domain** and cannot verify against anything real today.

## 15. What cannot be proven without real devices

- That a real Android OS actually resolves and verifies the App Link, as opposed to the
  Flutter-side parser merely accepting a manually-constructed intent.
- That a real iPhone's Universal Link / AASA verification succeeds at all — this is the one
  platform with zero fallback path, so it is also the one guaranteed to produce a hard "nothing
  works" signal if hosting/AASA/Team ID are not all correct simultaneously.
- That the full exchange → render chain behaves identically under real mobile network conditions
  (latency, backgrounding, connectivity loss mid-exchange) rather than the test harness's
  synchronous request/response.
- That real crash-reporting/telemetry integrations (if any exist or are added) do not leak the
  reference — flagged as unverified in §8, not assumed either way.

## 16. Owner approval gates

Already granted (quoted in the task body, reconfirmed against the closure report):
1. Packaging = Option A (`main_device_preview.dart` standalone; no flavor; no identifier change).
2. Preview domain identity = `preview.awjdev.xyz` (naming only).

Still required before Criterion #10 can be executed:
1. Explicit authorization to provision DNS/hosting/TLS for `preview.awjdev.xyz` (owner stated
   this is *not yet granted* even though the hostname is approved).
2. Explicit authorization for the small source edit in §7 item 4 (three hardcoded placeholder
   hosts → `preview.awjdev.xyz`) — this is a repository change beyond docs/evidence and this task
   does not make it.
3. An Apple Developer Team ID / account to attach to the iOS build.
4. A decision on whether the Android test build is debug-signed (sufficient for this one-time
   verification) or whether a real release signing key should be introduced now — Option A did
   not address signing, only packaging.

## 17. Operational prerequisites

- A machine with a working Flutter/Android/Xcode toolchain (absent in every sandbox this Horizon
  has run in, confirmed again in §13).
- Hosting for `preview.awjdev.xyz` capable of serving two static association files plus one
  small, header-controlled fallback page, reachable over HTTPS.
- A physical Android phone and a physical iPhone, plus whatever device-management process the
  owner uses for test devices.
- The source edit described in §7 item 4, under its own explicit owner approval, as its own
  small, reviewable change — not bundled into this docs-only PR.

## 18. Exact recommended next step

1. Owner reviews and approves (or amends) this readiness document.
2. Owner explicitly authorizes: (a) provisioning `preview.awjdev.xyz` hosting + TLS, and
   (b) the three-file placeholder-host source edit in §7 item 4, as a **separate, small,
   reviewable PR** — not part of this one.
3. Once both are authorized and executed, build and distribute `main_device_preview.dart` to a
   real Android phone and a real iPhone per §11/§12, and record the evidence listed there.
4. File the resulting evidence (recordings/screenshots/log excerpts) as the actual Criterion #10
   closure artifact — only then does Criterion #10 move from `OPEN` to `PASS`.

## 19. Criterion #10 status

**`OPEN`.** Unchanged by this document, as required by this task's own rule. No repository code
was changed to produce this readiness package; no device execution occurred or is claimed.

---

## External Evidence → AWJ Verification Requirement → Observed Repository State → Remaining Gap

| External Evidence (primary source) | AWJ Verification Requirement | Observed Repository State | Remaining Gap |
|---|---|---|---|
| Android: App Link auto-verification needs `android:autoVerify="true"` + a matching `assetlinks.json` at `/.well-known/` on the declared host ([Android App Links verification](https://developer.android.com/training/app-links/verify-android-applinks)) | Preview-channel intent-filter must declare `autoVerify="true"` for `preview.awjdev.xyz` and that host must serve a correct `assetlinks.json` | `autoVerify="true"` present, but host is the placeholder `preview.awj-runtime-proof.example`; no `assetlinks.json` anywhere | Host string must change (owner approval needed, §7); file must be hosted (not provisioned) |
| Android: SHA-256 cert fingerprint obtained via `keytool -list -v -keystore ...` ([Flutter: Set up App Links](https://docs.flutter.dev/cookbook/navigation/set-up-app-links)) | `assetlinks.json` must list the fingerprint of the exact key signing the installed test build | Release build currently debug-signed (`build.gradle.kts:38-42`); no fingerprint recorded anywhere | Fingerprint must be captured fresh at build time; not invented here |
| Apple: Associated Domains entitlement uses `applinks:<domain>`; AASA lives at `/.well-known/apple-app-site-association`, HTTPS only, no redirect, ≤128 KB, `apps: []` required ([Apple: Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains); [Flutter: Set up Universal Links](https://docs.flutter.dev/cookbook/navigation/set-up-universal-links)) | Device-preview `applinks:` entry must target `preview.awjdev.xyz`; that host must serve a correct AASA naming a real `TEAMID.bundleID` | `applinks:preview.awj-runtime-proof.example` present (placeholder); no AASA anywhere; no `DEVELOPMENT_TEAM` anywhere in `project.pbxproj` | Host + Team ID both required before AASA can even be drafted correctly; neither provisioned |
| Apple: Universal Links have **no scheme fallback** — an app with no `CFBundleURLTypes` can only be opened via a verified Universal Link ([Apple: Supporting universal links](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)) | iOS real-device test requires fully working AASA hosting; no `adb`-equivalent bypass exists | `Info.plist` confirmed to have no `CFBundleURLTypes` | iOS verification is **entirely blocked** until hosting is live — stronger gap than Android's |
| OWASP REST Security Cheat Sheet: tokens/credentials must not appear in URLs; recommends `Referrer-Policy: no-referrer` for such pages | Fallback page at `/preview/{reference}` must not leak the reference via the `Referer` header | No fallback page exists yet | Header must be set once the page is built; specified here, not yet implemented |
| MDN: `Referrer-Policy: no-referrer` omits the header entirely on every navigation; the browser **default** (`strict-origin-when-cross-origin`) still sends the full path on same-origin requests | Any same-origin subresource on the fallback page would otherwise leak the reference even under browser defaults | N/A — no page exists yet | Confirms `no-referrer` is not optional hardening but a correctness requirement given same-origin leakage risk |
