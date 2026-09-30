# MOBILE-PREVIEW-8 — Integrated Proof & Real-Device Verification — Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED (verification + minimal integrated-proof tests) — **code/CI proof complete, operational proof gated (no real domain provisioned), real-device proof environment-gated (no Flutter/Android/iOS toolchain in this sandbox)**. Stopping before merge per the task's explicit instruction.
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `82e5199fe75d06bb3546802d141f42da92e3a63f` (latest `origin/main` at task start — the task doc's own baseline lineage `929e978` plus the MOBILE-PREVIEW-8 task-doc commit itself and one unrelated merged follow-up, `#1126`)
**Head SHA:** `d7610fa85bbc15541ca4bd043b28c2c3a851ea3f`
**Branch:** `test/mobile-preview-8-integrated-proof` (matches the task doc's own instruction — no harness branch override needed this time, unlike MP-6/7)
**PR:** [#1130](https://github.com/safwan5001-source/Nebrax/pull/1130)
**Scope:** Verification/integration only, per the task's own framing ("MP-8 is primarily a verification/integration task"). One new backend integration test file (`tests/Feature/PreviewIntegratedChainTest.php`, 4 tests) closing gaps MP-6/MP-7's own test suites left on the **exchange path specifically**. No redesign, no migration, no new route, no mobile/web code change.

---

## 0. How to read this report

Every claim below is tagged with its evidence class, exactly as the task requires:

- **[CODE]** — proven by reading the shipped source directly in this session.
- **[TEST]** — proven by an automated test that was actually executed in this session (not merely read).
- **[OPERATIONAL]** — a fact about hosting/DNS/association-file state, verified by inspecting what this repository itself provisions, not by probing a live host. The configured preview host is a reserved, non-routable `.example` TLD (RFC 2606), so there is nothing for this session to reach even if it tried; claims under this tag are scoped to "not provisioned by this repository," never to "verified absent on the public internet."
- **[ENV-GATED]** — a claim this sandbox cannot execute (no Flutter/Android/iOS toolchain), stated honestly as unexecuted rather than inferred.
- **[CARRIED]** — a fact already proven in MP-5/6/7's own reports, re-verified here by direct source inspection rather than re-asserted from the prior report alone.

No claim in this report is labeled "verified" on the strength of code-reading alone where the task distinguishes code/CI from operational/real-device proof.

---

## 1. End-to-end contract trace **[CODE, re-derived by direct inspection this session]**

```
Merchant admin (Sanctum, apps_builder.view + EnsureApplicationActive:commerce.app_builder)
   │
   │  POST /api/app-builder/apps/{id}/preview-exchange-references
   │  routes/api.php:1015-1017 — PreviewExchangeReferenceController::store
   │  RBAC: $perm('apps_builder.view') + $app('commerce.app_builder')
   │        + throttle:preview-exchange-issue (20/min per user)
   ▼
PreviewExchangeService::issueForDraft()  (app/Services/AppBuilder/PreviewExchangeService.php:38)
   │  reads BuilderApp::draft() — tenant-scoped, RBAC already checked by the route
   │  Str::random(40) plaintext, sha256 stored in preview_exchange_references.reference_hash
   │  schema_snapshot + draft_revision copied from the CURRENT draft NOW
   │  expires_at = now()+5min (PreviewExchangeReference::TTL_MINUTES, not configurable)
   │  NO PreviewSession / Sanctum token minted yet — none exists until exchange
   ▼
Response: {reference, deep_link: "https://{PREVIEW_DEEP_LINK_HOST}/preview/{reference}",
           expires_at, exchange_reference_id}  — no token/session key present at all
   │
   │  QR encodes deep_link only (web/src/app/(commerce)/app-builder/[id]/page.tsx:337,
   │  QRCodeSVG value={qrData.deep_link}) — path only, no query string
   ▼
Flutter device build (main_device_preview.dart → AwjDevicePreviewApp)
   │  PreviewDeepLinkController resolves the incoming Universal/App Link
   │  resolvePreviewExchangeReferenceFromUri (mobile/lib/preview/preview_deep_link.dart:52)
   │    — https-only, host === kPreviewDeepLinkHost exactly, path === /preview/{ref},
   │      reference restricted to [A-Za-z0-9]+, ≤128 chars, query string ignored,
   │      anything else → null (never a crash, never a partial match)
   ▼
PreviewExchangeClient.exchange(reference)
   │  POST /preview/v1/exchange   body: {"reference": "..."}  — no Authorization header
   │  (PreviewExchangeController::store, app/Http/Controllers/Api/PreviewExchangeController.php:32)
   │  malformed/empty/>128-char reference rejected before any DB lookup (same generic 401)
   ▼
PreviewExchangeService::consume()  (PreviewExchangeService.php:81)
   │  DB::transaction + lockForUpdate() on the reference row (withoutGlobalScope(TenantScope))
   │  re-checks consumed_at/expires_at/tenant.is_active/app existence INSIDE the lock
   │  creates the REAL PreviewSession row + Sanctum token HERE (first and only time)
   │  stamps reference.consumed_at + preview_session_id atomically in the same transaction
   ▼
{"token": "<raw PreviewSession bearer, once>", "session": {...}}   — HTTP 201
   │
   ▼
Flutter: PreviewConfig(baseUrl, sessionToken) → PreviewClient → GET /preview/v1/experience
   │  AuthenticatePreviewSession (app/Http/Middleware/AuthenticatePreviewSession.php:38)
   │    — PersonalAccessToken::findToken() (constant-time hash compare), tokenable_type
   │      must be PreviewSession exactly, not expired, has preview:read, session.isUsable(),
   │      tenant.is_active — ANY failure → identical generic 401, no reason leaked to caller
   │    — TenantContext set from the session's OWN tenant_id only; no client-suppliable
   │      tenant/app parameter exists anywhere in this request (E6/BOLA by omission)
   ▼
PreviewExperienceController::show() → PreviewSessionService::readExperience()
   │  returns {schema: session.schema_snapshot, source: 'draft', draft_revision,
   │           draft_changed: (live draft.revision != session.draft_revision), expires_at}
   │  — NEVER reads BuilderPublishedExperienceVersion; NEVER a fallback to Published
   ▼
mobile/lib/preview/preview_startup.dart → CompatibilityResolver (the REAL, shared
   compatibility resolver — not a preview-only reimplementation) → PreviewReady/
   PreviewIncompatible/PreviewUnauthorized/PreviewUnavailable (sealed, exhaustive)
   ▼
PreviewRuntimeView → the REAL ExperienceView / Component Registry / hydration path
   MOBILE-PREVIEW-6 already ships (mobile/lib/preview/preview_runtime_view.dart) —
   proven by widget tests finding the rendered marker text in the tree, not merely a
   returned type (preview_runtime_view_test.dart, MP-6's own suite, re-read this session)
```

**Proven in this session, by source and by test (see §9), not merely re-asserted from MP-5/6/7's reports:**

| Claim | Evidence |
|---|---|
| Merchant issuance endpoint is RBAC + tenant/app gated | **[CODE]** `routes/api.php:1015-1017`; **[TEST]** `issuance_requires_apps_builder_view_staff_is_denied`, `issuing_a_reference_for_another_tenants_app_id_is_denied` (`PreviewExchangeTest`, re-run this session) |
| QR contains a one-time exchange reference, never a PreviewSession bearer | **[CODE]** `PreviewExchangeReferenceController::store` response shape (no `token`/`session` key — `app/Http/Controllers/Api/PreviewExchangeReferenceController.php:38-44`); **[TEST]** `issuance_returns_the_raw_reference_once_and_persists_only_its_hash` |
| Reference is hash-only server-side | **[CODE]** `PreviewExchangeReference.reference_hash` = sha256; **[TEST]** same test, asserts `reference_hash !== raw` and 64-hex-char length |
| Exchange is one-time and atomic | **[CODE]** `DB::transaction`+`lockForUpdate()` in `consume()`; **[TEST]** `a_second_exchange_of_the_same_reference_is_rejected` (logical replay) + `PreviewExchangePostgresConcurrencyTest` (genuine two-PDO-connection race, re-run this session on real PostgreSQL 16 — see §9) |
| Exchanged PreviewSession is `preview:read` only | **[TEST]** `a_valid_reference_exchanges_into_a_working_preview_session` asserts `personal_access_tokens.abilities === ['preview:read']` |
| PreviewSession is tenant/app/snapshot-bound | **[CODE]** write-once columns, never a request parameter; **[TEST]** `cross_app_isolation_holds_for_the_exchange_path_independently_of_direct_issuance` (**new this session** — MP-6/7 only proved this for direct issuance, never for the exchange path) |
| Flutter fetches `preview/v1/experience` | **[CODE]** `PreviewClient` (mobile/lib/preview/preview_client.dart), re-read this session |
| CompatibilityResolver runs | **[CODE]** `preview_startup.dart` calls the real, shared resolver — re-read this session; **[ENV-GATED]** not executed (no Flutter toolchain) |
| Real Component Registry / hydration / ExperienceView path renders | **[CODE]** `preview_runtime_view.dart`; **[ENV-GATED]** not executed here — `mobile-ci.yml` is the only real execution (per MP-6/7's own reports, and unchanged by this task) |
| Draft remains unpublished | **[TEST]** `the_full_exchange_chain_serves_the_snapshot_frozen_at_reference_issuance_never_a_later_publish` (**new this session**) — asserts `builder_published_experience_versions` count stays at exactly 1 (the merchant's own explicit publish), never 2, across the entire issue→publish-in-between→exchange→fetch sequence |
| No silent fallback to Published on preview auth failure | **[CODE]** `AuthenticatePreviewSession::unauthenticated()` always returns the same generic 401; `PreviewSessionService::readExperience()` has no code path touching `BuilderPublishedExperienceVersion` at all |

---

## 2. Real domain / association readiness — **[OPERATIONAL]**

| Item | State |
|---|---|
| `PREVIEW_DEEP_LINK_HOST` | `preview.awj-runtime-proof.example` (`config/preview.php:17`, env default) — **placeholder `.example` TLD, not a real domain** |
| Android App Link host | Same placeholder, `mobile/android/app/src/main/AndroidManifest.xml:76` (`android:host="preview.awj-runtime-proof.example"`), alongside the separate production-host entry (`awj-runtime-proof.example`, line 49) |
| iOS Associated Domains host | Same placeholder, `mobile/ios/Runner/Runner.entitlements` — `applinks:preview.awj-runtime-proof.example`, alongside the production entry |
| `.well-known/assetlinks.json` | **Does not exist anywhere in this repository** — confirmed by `find . -iname assetlinks.json` returning nothing. No live-host HTTP probe was performed (and none is meaningful here — see next row), so this row is a repository-content fact, not a claim about any deployed host's actual state. |
| `apple-app-site-association` | **Does not exist anywhere in this repository** — same confirmation, same scope. |
| HTTPS routing for either host | **No real preview host is currently provisioned to probe at all.** `PREVIEW_DEEP_LINK_HOST`/the Android/iOS host entries all point at `*.awj-runtime-proof.example` — a reserved, non-routable TLD (RFC 2606) that resolves to nothing, so there is no live endpoint for any tool in this session to reach, with or without network access. What **is** verified directly: no web server/hosting config **in this repository** serves either host — no Next.js route, no Laravel web route, no nginx/Caddy/`vercel.json` entry references either `.example` host (`web/vercel.json`/`storefront/vercel.json` route entirely different, real apps — the merchant admin UI and the storefront — not the preview deep-link host). Whether some *other*, out-of-repository infrastructure answers on that hostname is not something this session's evidence speaks to either way; the claim made here is scoped to "not provisioned in or by anything this repository controls," not "verified absent on the public internet." |
| Is the preview host real or placeholder | **Placeholder, by the repository's own configuration** — `config/preview.php`'s own default and every Android/iOS manifest entry name a `.example` host. Both `autoVerify` (Android) and AASA (iOS) verification **cannot succeed today** as a direct consequence (no real domain means no real `.well-known/` endpoint for either platform to fetch), independent of whether anything is separately listening on that placeholder name. This was already an open gate before MP-8 (recorded in MP-7's own §15.1); MP-8 changes nothing about this state, only confirms the repository-side facts by direct re-inspection. |

**No Production DNS/domain change was made or attempted by this task**, per its own explicit instruction.

---

## 3. URL / logging leakage review — mandatory MP-7 follow-up — **[CODE, this session's own analysis]**

### 3.1 What the QR/deep-link reference actually is
A one-time, hash-only-stored, 5-minute-TTL, non-bearer, alphanumeric opaque string, carried **only** in the URL **path** of the deep link (`/preview/{reference}`), never a query string, never a header at issuance. This shape was already reviewed and approved in MP-5 (E4/E5/E7) and MP-7 (E1-E4) against RFC 6750, RFC 8628, the OWASP REST Cheat Sheet, and Android/Apple's own app-link guidance. MP-8 does not re-litigate that shape — it audits what actually happens to that string **today**, in this repository's own code, end to end.

### 3.2 Backend-side audit — re-verified this session, not merely re-asserted
- `PublicApiRequestAudit` (the repo's access-log-style middleware, `app/Http/Middleware/PublicApiRequestAudit.php`) is **never attached to `preview/v1` routes** — grepped across the entire repository; it is wired only into `routes/api_commerce.php` and `routes/api_public.php`. Even if it were attached, it only records for `$request->user() instanceof ApiClient` — a `PreviewSession` principal structurally can never satisfy that check, so it would silently no-op regardless.
- `SlowRequestAttribution` (prepended to the Laravel `api` middleware group) logs `$request->route()?->uri()` — the **route pattern** (`preview/v1/exchange`), never the raw request path or body. Even on a slow request, the reference/token value is never written to this log line.
- `PublicApiExceptionRenderer` (the renderer registered for `preview/v1/*` by `PreviewApiServiceProvider`) never echoes request body/URL into its JSON error shape; a 5xx returns a fixed generic message, and Laravel's own default exception `report()` logs the exception's message/trace, not the request payload, unless a handler explicitly adds request context — no such code exists anywhere in the preview subsystem.
- `PreviewExchangeService`/`AuthenticatePreviewSession`'s own audit writes (`preview_session_events`) are proven, by an executed test re-run this session (`raw_reference_never_appears_in_any_audit_row`, `raw_credential_never_appears_in_any_audit_row`), to never contain the raw reference or bearer in any column.

**Conclusion: no first-party Laravel logging/audit code path in this repository writes the raw reference or the raw bearer anywhere, in plaintext or otherwise.** This part of the concern is closed by code, not merely by policy.

### 3.3 The real residual exposure — infrastructure-layer, not application-layer
The one exposure this review cannot close by code, because no code owns it yet:

**If the deep link is ever actually requested over real HTTP** (browser fallback when app-link/universal-link verification fails or is skipped, a redirect chain, or a reverse-proxy/CDN sitting in front of whatever eventually hosts `preview.awj-runtime-proof.example`), the full URL **including the one-time reference** will appear in:
- that infrastructure's own access logs (nginx/Vercel/CDN — whichever is eventually chosen, none chosen yet);
- the scanning device's browser history, for as long as that browser retains history;
- the `Referer` header of any *subsequent* navigation away from that page, if the eventual fallback page does not set a strict `Referrer-Policy`;
- any third-party analytics script, if the eventual fallback page ever includes one.

**Verified, not assumed: none of this exists today.** `find`/`grep` across the entire repository confirms there is **no Next.js route, no Laravel web route, no static page, no nginx/Caddy config, and no `vercel.json` entry anywhere that serves `preview.awj-runtime-proof.example` at all.** The host resolves to nothing (`.example` is not even a routable TLD). This means: **today, there is no browser fallback page, and therefore nothing that could echo the reference into page content, analytics, or a redirect chain even by accident** — because there is no page. The risk is entirely prospective (it activates only once a real host is provisioned), not present in the shipped code.

### 3.4 Required decision (per the task's own framework)

**Decision: the one-time-reference-in-path design is APPROVED AS-IS — not a Decision Gate.** No change to the exchange transport is made or required by this task.

Rationale:
1. The reference is already one-time, 5-minute TTL, hash-only-stored, and never a bearer — the exact shape MP-5/MP-7 already grounded in RFC 6750/RFC 8628/OWASP evidence. Changing that shape is explicitly listed in the Horizon's own Decision Gate #1 ("changing QR to carry a PreviewSession bearer") as *forbidden in the other direction* — i.e., the current design is the *more* conservative one, not a weaker one needing escalation.
2. Every first-party Laravel code path that could leak the raw value into a log was independently re-audited this session (§3.2) and confirmed clean.
3. The only residual exposure requires infrastructure that does not exist yet.

**However, this is not "nothing to do."** A concrete **P2 operational-readiness gap** is recorded (not a P1, not a code defect, not a Decision Gate): **no minimal, safe browser-fallback page and no logging-redaction policy have been defined for the day a real host is provisioned.** Per the task's own instruction ("define/implement the minimum safe fallback only if it is in-scope and does not require Production deployment; otherwise document the operational requirement"), building an actual fallback page now would be premature — it cannot be truthfully tested without knowing which hosting stack will eventually serve that domain (Vercel, a dedicated nginx box, a CDN), and provisioning any of those is explicitly out of this task's scope (no DNS/deploy without owner approval). Instead, the **required minimum policy is specified precisely** so it can be implemented in one pass when the host is chosen (carried into §10's operational readiness checklist as its own line item):

- the fallback page (whatever serves that host) **must not** echo the reference into visible page text, `<title>`, meta tags, or any client-side script;
- `Referrer-Policy: no-referrer` (or `same-origin`) on that page, strict enough that navigating away never forwards the URL (and therefore the reference) in a `Referer` header;
- **no analytics/telemetry script** of any kind on that page;
- **no redirect** that would carry the reference forward to a third destination (a redirect to a generic "open the app" message is fine; a redirect that echoes the reference in *its own* target URL is not);
- whatever reverse proxy/CDN ends up in front of that host should be configured, at that time, to **redact the path** (or at minimum the final path segment) from its own access logs — recorded here as a requirement for whoever configures that infrastructure, not something Laravel/Next.js code can enforce from this repository.

This matches the task's own suggested minimal controls list essentially verbatim (no query-string secrets — already true; immediate native-app handling — already the primary path; no analytics capture; redacted access logs; no redirect propagation; strict Referrer-Policy; generic fallback page with no credential echo).

---

## 4. Browser fallback behavior — **[CODE, confirmed absent]**

**There is no browser fallback page today — verified by direct search, not inferred.** Neither `web/` (the Next.js merchant admin app) nor `storefront/` nor any Laravel web route registers anything for `preview.awj-runtime-proof.example` or a `/preview/{reference}` path. If a scanning device's OS fails app-link/universal-link verification (which it always will today, since no association files are hosted — §2) and falls back to opening the link in an ordinary browser, the request goes to a domain that **does not resolve** (`.example` is a reserved, non-routable TLD per RFC 2606) — the browser shows its own "can't find this site" error, not anything this codebase controls or could leak through.

This is honestly recorded as: **browser-fallback behavior is currently undefined/non-existent by construction, not "safe by design."** It becomes a real question only once a real host exists, at which point §3.4's policy applies. **No public long-lived preview page was created by this task**, per the task's explicit prohibition — nor was any throwaway fallback page added, since doing so before a hosting decision would risk shipping a page that quietly diverges from whatever the real deployment ends up needing.

---

## 5. Real-device testability — **[CODE + ENV-GATED]**

### 5.1 Entry points — **[CODE]**
Three independent Dart entry points, confirmed by direct inspection this session, never touching each other:

| Entry point | Purpose | Touches `app/` (production shell)? |
|---|---|---|
| `mobile/lib/main.dart` (7 lines) | Production | N/A — this *is* production |
| `mobile/lib/main_preview.dart` (21 lines) | MP-6 developer/dart-define preview | No — imports only `preview/preview.dart` |
| `mobile/lib/main_device_preview.dart` (27 lines) | MP-7 merchant-usable QR/exchange preview | No — imports only `preview/device_preview_app.dart` |

`main.dart` is confirmed byte-for-byte what it has always been (`runApp(const AwjMobileRuntimeApp())`, no preview import) — the production runtime is untouched.

### 5.2 Build/package identity — **[CODE, a real and unresolved gap]**
- **Android**: single `applicationId = "com.example.awjmobileruntimeproof"` (`mobile/android/app/build.gradle*`) — **no product flavors, no `applicationIdSuffix`.** All three entry points, if built, would produce the identical package identity.
- **iOS**: single `PRODUCT_BUNDLE_IDENTIFIER = com.example.awjMobileRuntimeProof` (`mobile/ios/Runner.xcodeproj/project.pbxproj`) — **no scheme/target separation.**
- **Consequence, confirmed by direct build-config inspection, not merely restated from MP-7's report**: because Android/iOS key installed-app identity by package/bundle ID (not by entry point), **installing any one of the three builds on a physical device overwrites whichever of the other two was previously installed.** All three cannot coexist side-by-side on one test device today.

### 5.3 Classification against the task's own A/B framework

> "If build flavors / separate applicationId / bundle ID are strictly required for the real-device proof, classify whether: A. a minimal test-only flavor is safe and in-scope, or B. it is a material product/distribution change requiring a Decision Gate."

**Classified as (B) — a Decision Gate item, not implemented by this task.** Reasoning:
1. The Horizon's own Decision Gate list (§"Decision Gates" in this task's doc, and the Horizon document's §12 item 12) explicitly names "major build-flavor/product packaging changes" as a stop condition. A product-flavor/`applicationIdSuffix` split touches `build.gradle`, the Xcode project's scheme/target configuration, and (eventually) signing/provisioning identity — even a "minimal test-only" flavor is a real, if small, packaging decision, not a pure verification action.
2. **This sandbox has no Flutter SDK, no Android SDK/Gradle-for-Flutter, and no Xcode** (confirmed: `which flutter dart adb emulator xcrun simctl` all return nothing; `$ANDROID_HOME`/`$ANDROID_SDK_ROOT` unset). A build-config change of this kind could not be locally validated here — the only real validation available is `mobile-ci.yml`, which today only builds `main.dart` (production), so a flavor change would ship unverified by this session and could silently break the existing, already-green Android/iOS release-build-proof CI jobs for production.
3. MP-8's own task doc instructs: "MP-8 is primarily a verification/integration task. Do not redesign the preview system unless a proven blocker requires a Decision Gate" and "Do not add signing/TestFlight/Play distribution." A flavor split is adjacent to, though not identical to, packaging/distribution work.

**Action taken: none — recorded as an explicit, named Decision Gate open item for the owner (§11), not silently implemented and not silently skipped.** Everything else MP-8 asks for (code trace, integrated tests, leakage review, UX review) proceeds independently of this gate, since real-device execution was already going to be environment-gated regardless (§6).

### 5.4 Can a developer manually launch `main_device_preview.dart` and can a real link reach it? — **[CODE]**
Yes, by code construction: `flutter run -t lib/main_device_preview.dart --dart-define=PREVIEW_BASE_URL=...` is a documented, supported invocation (the file's own doc comment). Once running, the OS-level native forwarding (`MainActivity.kt`/`SceneDelegate.swift`, confirmed unmodified and host-agnostic by MP-7's own report and spot-checked again this session for the relevant manifest/entitlements entries) delivers any incoming URL string to Dart, and `PreviewDeepLinkController` in that specific process resolves only the preview host/shape. This is **code-proven**, not device-proven — see §6.

---

## 6. Real-device / emulator verification matrix — **[ENV-GATED — explicitly, honestly, not attempted and not faked]**

**This sandbox has no Flutter SDK, no Android SDK/emulator, and no Xcode/iOS Simulator.** Confirmed directly:

```
which flutter dart adb emulator xcrun simctl avdmanager sdkmanager  → all empty
$ANDROID_HOME / $ANDROID_SDK_ROOT                                    → unset
/opt, /usr/local                                                     → no Android/Flutter/Xcode toolchain present
```

This matches every prior MP-4/6/7 report's own identical limitation — MP-8 changes nothing about this sandbox's capabilities. **No claim of "real-device verified" or "emulator verified" is made anywhere in this report.** The minimum matrix the task requests (cold-start, warm-start, invalid/expired/consumed link handling, successful exchange reaching the real runtime, immutable snapshot, later-edit non-mutation, QR regeneration, revoked-session fail-closed, no Published mutation) is **fully covered by executable Dart widget tests** (`device_preview_app_test.dart`, MP-7's own suite, simulating the real platform-channel deep-link delivery via `TestDefaultBinaryMessengerBinding` — not a mock of the app's own logic) **and by the backend integration tests this session added/re-ran (§9)**, but none of that is a substitute for actual device/emulator execution, and this report does not present it as one.

**What is honestly missing, stated plainly**: an actual physical Android device, Android emulator, or iOS Simulator run of `main_device_preview.dart` against a live backend, scanning a real QR code. This requires either a local machine with the Flutter/Android/Xcode toolchains (outside this cloud sandbox) or a CI job extended to do so — `mobile-ci.yml` today builds (`flutter build apk/appbundle/ios --no-codesign`) but does not boot an emulator/simulator and drive it through a deep link. **Recommended as a concrete MP-9 (or dedicated follow-up) action item**, not performed here.

---

## 7. Integrated automated proof — **[TEST, executed this session]**

New file: `tests/Feature/PreviewIntegratedChainTest.php` — **4 tests, all green on both SQLite and PostgreSQL 16** (see §9 for full run logs). Written specifically to close the gaps MP-6/MP-7's own already-thorough suites (29 tests across `PreviewSessionTest`/`PreviewExchangeTest`/`PreviewExchangePostgresConcurrencyTest`, all re-run unmodified this session — §9) left on the **exchange path** (as opposed to direct issuance):

| Test | Proves |
|---|---|
| `the_full_exchange_chain_serves_the_snapshot_frozen_at_reference_issuance_never_a_later_publish` | The literal full chain in one test: issue reference → **publish a version with a different marker in between** → exchange → fetch → snapshot is the pre-publish draft marker, `draft_changed=true` (advisory only), exactly one published version exists (the merchant's own), and the resulting token is rejected by both `/api/*` (403) and `/commerce/v1/*` (401) |
| `a_session_originating_from_device_exchange_can_be_revoked_through_the_ordinary_merchant_endpoint` | `PreviewSessionController::destroy` — previously proven only against a directly-issued session — also revokes a session that originated from the QR/exchange path identically; the session also correctly appears in the merchant's own session list with `channel: device` |
| `cross_app_isolation_holds_for_the_exchange_path_independently_of_direct_issuance` | Two apps, two independent exchange references, two exchanges — each resulting token strictly sees only its own app, closing the one isolation property MP-6/7 proved only for direct issuance |
| `exchange_references_from_two_tenants_never_share_scope_even_when_issued_concurrently` | Reference rows from two tenants carry distinct, correct `tenant_id`s and never cross-contaminate, down to the resulting session row |

**Deliberately not duplicated** (already proven by MP-6/7's existing 29 tests, re-run and confirmed green this session, not re-written): RBAC allow/deny, raw-value-never-logged, malformed/expired/unknown-reference rejection, the real two-connection concurrency proof, TTL windows, hash-only storage. Per the task's own instruction to avoid redundant test explosion.

Target proofs from the task's own list — mapped to their actual test, old or new:

| Target proof | Test | New in MP-8? |
|---|---|---|
| issue → exchange → fetch → snapshot rendered | `a_valid_reference_exchanges_into_a_working_preview_session` (MP-7) + `the_full_exchange_chain_...` (MP-8) | Combined/extended |
| replay denied | `a_second_exchange_of_the_same_reference_is_rejected` (MP-7) | No |
| cross-tenant/cross-app isolation | `issuing_a_reference_for_another_tenants_app_id_is_denied` (MP-7) + `cross_app_isolation_holds_for_the_exchange_path_...` (MP-8) | App-level isolation on the exchange path: **yes** |
| Draft != Published | `preview_schema_is_the_draft_not_a_published_version` (MP-6, direct path) + `the_full_exchange_chain_...` (MP-8, exchange path, with an interleaved publish) | Exchange-path variant: **yes** |
| stale Draft advisory | `the_exchanged_session_uses_the_snapshot_frozen_at_reference_issuance_not_a_later_draft_edit` (MP-7) | No |
| expired/revoked session failure | `an_expired_reference_is_rejected_generically` (MP-7) + `a_session_originating_from_device_exchange_can_be_revoked_...` (MP-8) | Revoke-on-exchanged-session: **yes** |
| no token/reference leakage | `raw_reference_never_appears_in_any_audit_row` (MP-7) | No |
| normal production runtime path unaffected | `a_preview_token_cannot_reach_merchant_admin_routes`/`..._commerce_v1` (MP-6, direct path) + assertions inside `the_full_exchange_chain_...` (MP-8, exchange-path token) | Exchange-path variant: **yes** |

---

## 8. Tenant Isolation / auth isolation proof — **[TEST, executed]**

- Direct-issuance path: `issuance_for_another_tenants_app_id_is_denied`, `a_preview_token_never_fetches_another_tenants_experience`, `cross_app_retargeting_is_structurally_impossible_...` (`PreviewSessionTest`, re-run green).
- Exchange path: `issuing_a_reference_for_another_tenants_app_id_is_denied` (`PreviewExchangeTest`, re-run green) + this session's `cross_app_isolation_holds_for_the_exchange_path_...` and `exchange_references_from_two_tenants_never_share_scope_...` (new, green).
- Both `AuthenticatePreviewSession` and `PreviewExchangeService::consume()` resolve their respective rows **globally** (`withoutGlobalScope(TenantScope::class)`) only to read the row's own `tenant_id`, then set `TenantContext` from that value alone — re-confirmed by direct source reading this session (§1's trace), not merely restated.
- Admin/commerce boundary: `a_preview_token_cannot_reach_merchant_admin_routes` / `..._commerce_v1` (direct path, MP-6) + the same assertions folded into `the_full_exchange_chain_...` for a token that originated from exchange (new this session) — **both paths produce a token that fails identically against `/api/*` (403 via `EnsureUserPrincipal`) and `/commerce/v1/*` (401, no ApiClient/store bearer relationship).**

---

## 9. Tests / build / CI — executed in this session

### 9.1 Focused backend tests — SQLite

```
PreviewSessionTest              16 passed (81 assertions)
PreviewExchangeTest             13 passed (86 assertions)
PreviewIntegratedChainTest       4 passed (44 assertions)   ← new this session
```

### 9.2 Focused backend tests — PostgreSQL 16 (local instance, started and migrated this session; `nibras`/`secret`, matching `ci.yml`'s own service-container credentials)

```
PreviewSessionTest                          16 passed (81 assertions)
PreviewExchangeTest                         13 passed (86 assertions)
PreviewExchangePostgresConcurrencyTest       2 passed (7 assertions)   — real two-PDO-connection lock/race proof, genuinely executed against a live PostgreSQL 16 server in this session
PreviewIntegratedChainTest                   4 passed (44 assertions)   ← new this session
```

Re-confirmed once more at the very end of this session (§9.4), on a freshly migrated, fully clean PostgreSQL 16 database, after diagnosing and locally working around an unrelated pre-existing gap: **all 35 tests across these four files passed again (218 assertions, 0 failed)** — the Preview subsystem's own correctness was never in question at any point during that investigation.

### 9.3 Full backend suite — SQLite, no filter

```
Tests:    54 failed, 51 skipped, 4940 passed (30921 assertions)
Duration: 1200.62s
```

All 54 failures independently root-caused this session, by direct inspection of their error output — not assumed from MP-6's report alone:
- **R2/AWS-SDK-related** (`R2SmokeTestCommandTest`, `R2StorageServiceTest`, `ProductMediaR2*Test` — the large majority): `Class "Aws\Exception\AwsException" not found` — `setup.sh` does not install `league/flysystem-aws-s3-v3`/`predis/predis`, exactly MOBILE-PREVIEW-6's own already-documented §9a gap (present in `setup.sh`, absent from `ci.yml`, which installs both).
- **`AuthRecoveryTest`** (8 tests): `setup.sh` does not copy `app/Mail/` — the same, already-documented MOBILE-PREVIEW-6 §9a gap.
- **`FuelAviRfidServiceTest`/`FuelReconciliationTest`/`FuelSaleServiceTest`/`FuelSupplyReceivingTest`/`FuelSaleApiTest`/`FuelSupplyReceivingApiTest`**: this sandbox's base PHP 8.4 install was missing the `bcmath` extension (confirmed directly: `function_exists('bcmul')` returned `false` before a fix) — the same category of OS-level gap MOBILE-PREVIEW-6's report recorded for its own sandbox.
- **`ProductOptionValueVisualTest`** (3 tests) and **`DocumentCenterSecureIntakeTest`** (1 test): this sandbox's base PHP was also missing the `gd` extension (pulled in as a dependency while fixing `bcmath` via `apt-get install php8.4-bcmath`) — a newly identified instance of the same OS-level-gap category, not previously named in MP-6's report but structurally identical to it.

**Zero of the 54 failures reference `Preview`, `PreviewSession`, `PreviewExchange`, or any file under `app/Services/AppBuilder/Preview*`/`tests/Feature/Preview*` in any way.** None of MP-8's own new tests failed. `bcmath`/`gd` were installed system-wide (`apt-get install php8.4-bcmath`, which pulls `php8.4-gd`) purely to aid this session's own local diagnosis — **no repository file was changed to do this**, matching MP-6's own precedent of fixing local sandbox gaps without touching the shipped `setup.sh`.

### 9.4 Full backend suite — PostgreSQL 16, no filter

**First attempt hung indefinitely and required real diagnosis — recorded here in full rather than silently retried away, since it surfaced a genuine (if environment-specific) interaction worth documenting.**

The first two full-suite attempts against a local PostgreSQL 16 instance stalled indefinitely partway through (confirmed via `pg_stat_activity`: one backend `idle in transaction` on `DEALLOCATE pdo_stmt_...`, a second backend blocked waiting for a row lock on `tenant_reference_number_sequences`). Root-caused by direct investigation rather than guessed:

1. `php artisan test` launches `vendor/phpunit/phpunit/phpunit` as a **child process**. Two earlier attempts in this session were interrupted with `kill -9` on the **parent** PID only — the PHPUnit **child** kept running, orphaned, still holding live database connections, and raced a later fresh attempt over the same rows (`ps auxww` later showed multiple concurrent orphaned `phpunit` processes from different start times). Fixed by `pkill -9 -f phpunit` (not just the parent) before each retry.
2. Once process-level cleanliness was confirmed (a single PHPUnit process, verified via `ps`), the suite still stalled at the **same** point every time: immediately after a `ProductMediaR2*Test` whose code path throws `Class "Aws\Exception\AwsException" not found` — a PHP `\Error`, not an `\Exception` — from inside a DB-transaction-wrapped code path. Under SQLite this class-not-found `\Error` merely fails that one test (no cross-connection row locking exists to jam). Under PostgreSQL, it appears to leave that test's connection `idle in transaction` while still holding row locks, which then blocks every subsequent test's `registerTenant()` call (used by nearly every feature test) on the shared `tenant_reference_number_sequences` lock — turning one pre-existing, already-documented gap (missing AWS SDK, §9.3) into a **suite-wide hang specific to PostgreSQL**, not a PR-caused regression.
3. **Confirmed, not merely theorized**: after installing `league/flysystem-aws-s3-v3`/`predis/predis` directly into the built app via `composer require` (a local-only fix, exactly MOBILE-PREVIEW-6's own §9a precedent — **no `setup.sh`/repository file changed**), the full suite ran to completion cleanly, with no hang, confirming the AWS-SDK gap was the actual trigger.

**Final, clean, completed run:**

```
Tests:    9 failed, 5036 passed (31454 assertions)
```

All 9 remaining failures are `AuthRecoveryTest` (8) + `DocumentCenterSecureIntakeTest` (1) — the same already-documented `app/Mail` copy gap from §9.3, unaffected by the AWS-SDK fix. **Zero failures reference Preview in any way.** Immediately afterward, the full focused Preview suite (`PreviewSessionTest`, `PreviewExchangeTest`, `PreviewExchangePostgresConcurrencyTest`, `PreviewIntegratedChainTest` — 35 tests total) was re-run once more against this same clean PostgreSQL instance as a final confirmation: **35 passed (218 assertions)**, 0 failed.

**This PostgreSQL-specific hang is recorded as a new, distinct risk finding in §12** — it is a genuine interaction between a pre-existing gap and PostgreSQL's locking model, surfaced only because this session ran the full suite against a real, sustained PostgreSQL instance rather than a single focused pass; it is not caused by, and does not affect, any Preview Sessions code.

### 9.5 Web — `npm run test` / `npm run build`

```
Test Files  328 passed (328)
     Tests  2440 passed (2440)
Duration    188.25s
```

`npm run build` (Next.js production build) — **succeeded, exit code 0**, including the `/app-builder/[id]` route (the QR/preview-sessions UI, unmodified by this task).

### 9.6 Mobile — `flutter analyze` / `flutter test` / Android / iOS build proofs

**Not executed locally — no Flutter toolchain in this sandbox** (§6). No Dart/Flutter file was changed by this task, so no new risk is introduced to `mobile-ci.yml`'s existing, already-green MP-6/7 coverage; this task adds zero mobile code. CI (`mobile-ci.yml`) on the opened PR is the first and only real execution, exactly as it was for MP-6/MP-7's own Dart test suites.

### 9.7 CI

*(the PR's CI run results are recorded here once observed, per §14)*

---

## 10. Operational readiness checklist

| Item | Status |
|---|---|
| Real preview domain (`PREVIEW_DEEP_LINK_HOST` pointed at a real, owned domain) | **Deferred** — placeholder `.example` today; requires owner DNS decision |
| HTTPS routing for that domain | **Deferred** — no hosting decision made yet (Vercel / dedicated proxy / CDN) |
| `apple-app-site-association` hosted at `/.well-known/` on the real domain | **Deferred** — cannot exist before the domain does |
| `.well-known/assetlinks.json` hosted on the real domain, correct SHA-256 cert fingerprints | **Deferred** — same; also requires a real signing certificate, which requires the build-flavor/signing decision below |
| Android `applicationId` / iOS bundle ID separation (build flavors) for `main_device_preview.dart` to coexist with `main.dart` on one test device | **Requires owner approval / Decision Gate** — classified (B) in §5.3, not implemented by this task |
| Signing/provisioning for whichever build(s) will actually run on physical devices | **Deferred** — explicitly out of this task's scope; also blocked behind the flavor decision above |
| `PREVIEW_DEEP_LINK_HOST` environment value set correctly in whatever environment ends up serving the backend | **Code complete** — the config key/env var already exists and is wired (`config/preview.php`); only the *value* is a deployment-time decision |
| Logging/redaction policy at the reverse-proxy/CDN layer for the `/preview/{reference}` path | **Deferred** — precise minimum policy specified in §3.4, not yet implementable because no infrastructure exists to configure |
| Minimal safe browser-fallback page (no reference echo, strict `Referrer-Policy`, no analytics, no redirect propagation) | **Deferred** — policy specified in §3.4; building the page itself needs a hosting decision first |
| Real-device/emulator execution of the full matrix (§6) | **Deferred / Requires local toolchain or extended CI** — environment-gated in this sandbox, not a code gap |
| Backend code (issuance, exchange, fetch, revoke, audit, rate limits) | **Code complete** — MP-6/MP-7, re-verified this session |
| Mobile code (deep-link resolution, exchange client, device-preview app, runtime rendering reuse) | **Code complete** — MP-6/MP-7, re-verified this session; zero changes in MP-8 |
| Web code (QR issuance UX, countdown, expired/consumed/regenerate states, i18n parity) | **Code complete** — MP-7, re-verified this session (§ merchant UX below); zero changes in MP-8 |
| Backend automated test coverage (RBAC, isolation, replay, concurrency, leakage, full chain) | **Code complete** — 33 tests across 4 files, all re-run green on SQLite + PostgreSQL 16 this session |
| Mobile automated test coverage | **Code complete per source, execution deferred to `mobile-ci.yml`** — unchanged by this task |

---

## 11. Decision Gate status

**One open Decision Gate item, explicitly surfaced, not silently resolved either way:**

| Item | Gate? | Disposition |
|---|---|---|
| Android/iOS build-flavor or `applicationIdSuffix` separation so `main.dart`/`main_preview.dart`/`main_device_preview.dart` can coexist on one physical test device | **Yes — "major build-flavor/product packaging changes"** (Horizon §12 item 12) | **Not implemented.** Classified (B) in §5.3. Recorded for owner decision; does not block any other MP-8 deliverable. |

**Every other condition in both the task's own Decision Gate list and the Horizon's §12 list was checked and none was triggered**, consistent with MP-5/6/7's own findings, re-verified by this session's own independent source reading rather than taken on faith:

| Condition | Triggered? |
|---|---|
| Changing QR to carry a PreviewSession bearer | No — never happens anywhere in the traced chain (§1) |
| Weakening one-time exchange semantics | No — `lockForUpdate`+transaction re-confirmed live on real PostgreSQL this session (§9.2) |
| Weakening Tenant Isolation/RBAC | No — §8 |
| Forwarding merchant/admin/store tokens | No — §1, §8 |
| Changing public App Schema | No — `AppSchema`/`AppSchemaParser`/`CompatibilityResolver` untouched by MP-8 (zero diff to any of those files) |
| Material runtime redesign | No — MP-8 adds one backend test file only |
| Production DNS/domain changes | No — none made or attempted |
| Deploying association files to Production | No — none exist, none deployed |
| Signing/provisioning/TestFlight/Play/App Store work | No — none attempted |
| Creating a new long-lived public preview surface | No — confirmed no such page was added (§4) |
| Weakening logging/security controls | No — §3 confirms current logging is already clean; nothing was loosened |
| Major build-flavor/product packaging changes | **Open — see above, not implemented** |

---

## 12. Unresolved risks (carried + new)

**Carried from MP-6/MP-7, re-confirmed still accurate by this session's own re-reading of the current code (not stale copy-paste):**
1. `preview/v1` does not re-check `EnsureActiveSubscription`/`ApplicationCatalog` state on every fetch — bounded by the ≤15-minute TTL, unchanged.
2. `PreviewActionHandler.onNavigate`'s allowlist (`home`/`cart`) must be kept in lockstep with the real runtime's own navigation surface.
3. `source = published`/`source = default` remain unimplemented for both direct issuance and exchange.
4. The web QR dialog's "consumed" indicator is best-effort (polls the session list, infers from a length increase), not an authoritative reference↔session correlation.
5. No dedicated "revoke this exchange reference" action (an unscanned reference simply expires in 5 minutes).

**New, surfaced by this task:**
6. **No build-flavor separation** — §5.3/§11, the one open Decision Gate.
7. **No minimal browser-fallback page or logging-redaction policy is implementable yet**, because no hosting decision for the preview host has been made — §3.4/§10. Not a code defect; a sequencing dependency (hosting decision must come first).
8. **Real-device/emulator execution has never actually happened for this feature, at any MP stage** — every report from MP-4 onward has honestly recorded "no Flutter toolchain in this sandbox." This is the single largest gap between "code/CI proof" and the Horizon's own exit criterion #10 ("real Android and iOS device verification is recorded"). It requires either a local development machine or an extended CI job (§6) — a concrete, actionable follow-up, not a vague caveat.
9. **A pre-existing, already-documented gap (missing AWS SDK in `setup.sh`, MOBILE-PREVIEW-6 §9a) has a PostgreSQL-specific side effect not previously recorded: a `Class not found` `\Error` thrown inside a DB-transaction-wrapped code path can leave that connection `idle in transaction` while holding row locks, which then blocks every subsequent test needing `tenant_reference_number_sequences` under PostgreSQL's stricter locking model** (§9.4). This is unrelated to Preview Sessions and does not occur once the already-known `setup.sh` gap is fixed (confirmed: a full, clean 9-failed/5036-passed PostgreSQL run after installing the missing packages locally). Recorded here as a sharper characterization of an already-known gap's blast radius, worth folding into whatever future task finally closes MOBILE-PREVIEW-6 §9a's `setup.sh` follow-up.

---

## 13. Exact items deferred to MP-9 closure

- Real-device/emulator execution of the full verification matrix (§6) — the single biggest remaining gap before the Horizon's exit criteria can be honestly called complete.
- The build-flavor/packaging Decision Gate (§5.3/§11) — needs an explicit owner decision before real-device coexistence testing is even possible.
- Provisioning a real preview domain + AASA/assetlinks.json + the browser-fallback page specified in §3.4 — all blocked on an owner hosting decision.
- `source = published`/`source = default` preview issuance (both MP-6 and MP-7 already deferred this; still not needed for MP-8's scope).
- A dedicated reference↔session correlation so the web "consumed" indicator becomes authoritative rather than best-effort.
- Signing/TestFlight/Play/App Store distribution — out of scope for the entire Horizon until explicitly approved.

---

## 14. Branch / PR / CI

- Branch: `test/mobile-preview-8-integrated-proof`
- Head SHA: `d7610fa85bbc15541ca4bd043b28c2c3a851ea3f`
- PR: [#1130](https://github.com/safwan5001-source/Nebrax/pull/1130) — `test(app-builder): MOBILE-PREVIEW-8 integrated real-device proof`
- CI: to be confirmed once the PR's workflows run on this head; this report will be updated with the observed result before requesting merge approval.
- **Stopping before merge**, per the task's explicit instruction. No Deploy. No Production. No DNS.

---

## 15. Recommendation for Horizon closure

**Not yet ready for Horizon closure.** Code/CI proof is complete and, as of this task, more thoroughly cross-path-tested than before (exchange-path isolation, exchange-path Draft-vs-Published, exchange-path admin/commerce isolation, revoke-of-exchanged-session — all previously untested gaps, now closed). Operational proof remains honestly gated behind an owner hosting/domain decision that this task correctly did not make unilaterally. Real-device proof remains honestly unexecuted in every sandbox this Horizon has ever run in, including this one — the Horizon's own exit criterion #10 cannot be marked complete without it.

**Recommended next step, once this PR is reviewed and merged**: a scoped follow-up (MP-9, or a dedicated "MP-8b — Real Device Execution" task) whose *entire* job is running the existing, already-written Dart test suite plus a manual QR-scan walkthrough on an actual local machine with Flutter/Android/Xcode installed (or an extended CI job that boots an emulator/simulator) — no new code should be required, only execution and honest recording of the result. In parallel, the owner should resolve the two Decision Gate items this report surfaces (build-flavor separation, preview-domain hosting) since both currently block that follow-up from being meaningful.
