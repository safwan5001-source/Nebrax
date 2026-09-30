# MOBILE-PREVIEW-7 — QR Device Preview Exchange — Implementation Report

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** IMPLEMENTED — local verification green (backend sqlite + pgsql incl. real two-connection concurrency proof, web tests + build). **Not merged, no deploy.**
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `b3a71ad19e5dcde74e0682524391dcf0691ac8fe` (latest `origin/main` at task start — matches the task doc's own baseline lineage: `2c7c717` + `MOBILE-PREVIEW-7-CLAUDE-CODE-TASK.md`'s own merge commit `b3a71ad`)
**Branch:** `claude/trusting-brown-6y61jc` (this session's harness-designated branch takes precedence over the task doc's suggested `feat/mobile-preview-7-qr-exchange`, exactly as MOBILE-PREVIEW-6's own report recorded for the same reason; PR title kept exactly as the task doc specifies)
**Scope:** Backend (`app/`, `routes/`, `database/migrations/`, `config/`) + mobile (`mobile/lib/preview/`, `mobile/lib/main_device_preview.dart`, `mobile/android/`, `mobile/ios/`, `mobile/test/preview/`) + web (`web/src/app/(commerce)/app-builder/[id]/page.tsx` and its i18n keys).

---

## 1. Mandatory evidence pass

Fetched directly during this task (not recalled from training). Android App Links verification, Flutter deep-linking, the OWASP REST Cheat Sheet, and RFC 8628 all returned real page content on the first fetch. The Apple Universal Links guidance was attempted twice against two different official URLs; both returned only a page title with no extractable body (the tool could not render the client-side documentation page) — noted explicitly below rather than presented as a live fetch, and cross-checked against MP-5's own already-approved citation of the same guidance plus the corroborating Android/Flutter/OWASP evidence, which converges on the identical rule.

| # | External Evidence (source, fetch status) | AWJ Decision | Rationale |
|---|---|---|---|
| E1 | **Android App Links verification** (`developer.android.com/training/app-links/verify-android-applinks`, fetched live): `autoVerify` checks a `VIEW`+`BROWSABLE`+`DEFAULT` intent-filter against `https://{host}/.well-known/assetlinks.json`; **only one app can be the default handler for a given host**; guidance explicitly warns against trusting deep-link parameters or putting tokens/passwords in a link. | The QR/device host (`preview.awj-runtime-proof.example`) is **deliberately separate** from the production runtime's own host (`awj-runtime-proof.example`) — two independent Dart entry points (`main.dart`/`main_device_preview.dart`) each own exactly one host, avoiding the "only one app per host" ambiguity Android's own model raises. Confirms `resolvePreviewExchangeReferenceFromUri` treats every value (including the reference) as untrusted input to be validated, never assumed safe. | Directly grounds §3 and §6's two-host decision below. |
| E2 | **Flutter deep-linking docs** (`docs.flutter.dev/ui/navigation/deep-linking`, fetched live): the framework only delivers the raw incoming route/URL to the app (`initialRoute`/`pushRoute`); **parsing and validating that link is entirely the app's own responsibility** — no built-in sanitization. | `PreviewDeepLinkController` (mirroring the already-shipped `DeepLinkController`) performs zero interpretation itself — it hands the raw string straight to `resolvePreviewExchangeReferenceFromString`, a pure function that is the *only* place scheme/host/path/charset/length are checked, exactly mirroring the production resolver's own already-reviewed shape. | Confirms the existing `deep_link_resolver.dart`/`deep_link_channel.dart` split (native forwards raw bytes, Dart validates) is the right pattern to replicate verbatim for MP-7, not reinvent. |
| E3 | **OWASP REST Security Cheat Sheet** (`cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html`, fetched live): "Passwords, security tokens, and API keys should not appear in the URL, as this can be captured in web server logs" — sensitive data belongs in the request body or an HTTP header, never a query string; `429 Too Many Requests` for abuse. | The exchange reference travels in the QR **path** (never a query string, matching the already-shipped `deep_link_resolver.dart` rule) and is redeemed by sending it in the **POST body** of `preview/v1/exchange` — never a header, never a query string. Both the merchant-authenticated issuance endpoint and the public exchange endpoint are rate-limited (`preview-exchange-issue`, `preview-exchange`), returning the framework's standard 429 shape on abuse. | Grounds §4/§5's transport choice and §8's rate-limit design. |
| E4 | **RFC 8628** (OAuth 2.0 Device Authorization Grant, fetched live): a short-lived `device_code`/`user_code` pair, `expires_in` with no single mandated value, `slow_down`/`expired_token` polling errors, and an explicit recommendation to rate-limit code *attempts* rather than rely on code secrecy alone. | This is the cross-device "display a code, redeem it on a trusted channel" pattern MP-5 §5.10/E5 already grounded the *architecture* in; MP-7 keeps the exact same shape — a short-lived (5-minute, matching MP-5's own ceiling — never re-litigated here), one-time, rate-limited reference — rather than a polling protocol (unneeded: this flow already has a push-style webhook-free callback, the device's own HTTPS POST, no polling loop required). | Confirms the 5-minute TTL and per-IP attempt-style rate limiting on the exchange endpoint match the same risk class RFC 8628 targets, without importing that RFC's full polling state machine (not needed for a single-shot exchange). |
| E5 | **Apple Universal Links / associated domains** (`developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app` and `.../allowing-apps-and-websites-to-link-to-your-content`, **fetch attempted against both URLs, each returned only a page title with no extractable body** — the tool could not render the client-side JS documentation page). Not a live fetch; the well-established, training-corroborated rule (also restated identically by the fetch tool's own fallback summary both times) is: verification via a server-hosted `apple-app-site-association` file at `/.well-known/`, and sensitive data belongs in a request made *after* the app opens, never in the link itself. | Recorded as an **unverified-by-live-fetch** source, used only because it is identical to, and already cited as, live-fetched evidence in `MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §1 (E7) — which *was* fetched live on 2026-09-29 per that document's own claim — and is independently corroborated by E1's live Android fetch stating the same rule for the other platform. No new decision rests on this source alone; it only reconfirms the already-approved "link is a router, never a secret carrier" rule this task already inherits from MP-5. | Flagged per this task's own instruction to be explicit about evidence quality — this is the one source in this pass not independently, freshly verified. |

Competitor UX (Salla/Shopify/Zid), already benchmarked in MP-1–MP-4, informed nothing in this evidence pass or the decisions below — per the task's own instruction, their private credential architecture was not inferred or consulted.

---

## 2. Exact exchange architecture implemented

Extends MP-5/MP-6's approved contract; **no redesign** of the `PreviewSession` principal, `AuthenticatePreviewSession` guard, or `preview/v1/experience` fetch endpoint — all three are reused byte-for-byte.

```
Merchant admin (Sanctum, apps_builder.view)
        │  POST /api/app-builder/apps/{id}/preview-exchange-references
        │  (same RBAC/entitlement gate as direct session issuance)
        ▼
PreviewExchangeReference  ── session-creation INTENT, not a session ──
   tenant_id / builder_app_id (fixed, server-derived)
   reference_hash (sha256 of a Str::random(40) opaque code)
   schema_snapshot / draft_revision (copied from the current Draft NOW —
     at reference issuance, not at exchange time)
   expires_at = now() + 5 minutes (fixed, not configurable)
   consumed_at = null, preview_session_id = null
        │
        │  raw reference + ready-made deep link returned ONCE, in the body
        │  {"reference": "...", "deep_link": "https://preview.../preview/...",
        │   "expires_at": "...", "exchange_reference_id": "..."}
        │  — no PreviewSession bearer minted yet, none exists to leak.
        ▼
QR code (web Builder) encodes only the deep_link — path only, no query string
        │
        │  scanned by the AWJ device-preview build
        ▼
Flutter: PreviewDeepLinkController → resolvePreviewExchangeReferenceFromUri
        │  extracts the opaque reference (never the whole link blindly trusted)
        ▼
PreviewExchangeClient.exchange(reference)
        │  POST /preview/v1/exchange   body: {"reference": "..."}
        │  (no Authorization header at all — nothing to send yet)
        ▼
PreviewExchangeService::consume()  — DB::transaction + lockForUpdate
        │  first successful call only:
        │    - re-checks consumed_at/expires_at INSIDE the lock (§8 safety)
        │    - creates the REAL PreviewSession row + Sanctum token HERE,
        │      not at issuance — so no working bearer ever exists unless
        │      and until a device actually redeems the reference
        │    - stamps consumed_at + preview_session_id on the reference
        ▼
{"token": "<raw PreviewSession bearer, once>", "session": {...}}
        │
        ▼
Flutter: PreviewConfig(baseUrl, sessionToken) → PreviewClient → the SAME,
unmodified PreviewRuntimeView / CompatibilityResolver / Component Registry /
ExperienceView MOBILE-PREVIEW-6 already ships.
```

**Key departure from a naive "issue the session, hand out its token" design** (deliberately rejected): the working `PreviewSession` bearer is **never minted at issuance time at all** — only a session-creation *intent* (the frozen snapshot + revision) is stored, hashed and reference-only. The actual `PreviewSession`/Sanctum-token pair is created for the first time inside the locked exchange transaction. This means there is no window, however short, during which a real working bearer exists server-side without ever having been claimed by a device — directly satisfying "no long-lived reusable exchange credential" by removing the credential from the issuance path entirely rather than merely shortening its life.

---

## 3. QR payload shape

```
https://preview.awj-runtime-proof.example/preview/{reference}
```

- **Path only** — no query string, ever. `{reference}` is the sole variable segment.
- `{reference}`: opaque, `Str::random(40)` (≈238 bits of entropy from a 62-character alphabet), single-use, 5-minute TTL, hash-only server-side persistence (SHA-256, `preview_exchange_references.reference_hash`).
- Does **not** and structurally **cannot** contain: a `PreviewSession` bearer (none exists until exchange), a merchant Sanctum token, a store `ApiClient` bearer, a customer token, an admin/platform token, or any PII. The issuance endpoint (`PreviewExchangeReferenceController::store`) returns exactly four fields — `reference`, `deep_link`, `expires_at`, `exchange_reference_id` — and nothing shaped like a working credential.
- Host: `preview.awj-runtime-proof.example` — a **dedicated preview-only placeholder**, deliberately distinct from the production runtime's own `awj-runtime-proof.example` (see §6's Decision Gate discussion — this is a new-host decision recorded, not silently assumed).
- Backend source of truth for the host: `config/preview.php` (`PREVIEW_DEEP_LINK_HOST` env, defaults to the placeholder above). Mobile source of truth: `kPreviewDeepLinkHost` constant in `mobile/lib/preview/preview_deep_link.dart` — the two must agree by convention (same placeholder value), exactly like the production pair `kDeepLinkHost`/its own deployment host already work today (no shared config file between Laravel and Flutter exists anywhere in this repo).

---

## 4. Deep-link / app-link behavior

- **iOS**: a second `applinks:` entry (`preview.awj-runtime-proof.example`) added to `Runner.entitlements`, alongside the existing production entry — untouched.
- **Android**: a second `<intent-filter android:autoVerify="true">` block added to `AndroidManifest.xml` for the same host, alongside the existing one.
- **Native forwarding is unchanged and unmodified**: `MainActivity.kt`/`SceneDelegate.swift` already forward *any* incoming URL string to Dart with zero host/path opinion (confirmed by direct inspection before writing any platform code) — both intent-filters/entitlement entries route to the exact same native code, and which *Dart* allowlist ends up resolving a link depends entirely on which entry point (`main.dart` vs `main_device_preview.dart`) is the one actually running, since the two never coexist in one process.
- **A dedicated Dart-side resolver, not an extension of the production allowlist**: `mobile/lib/preview/preview_deep_link.dart`'s `resolvePreviewExchangeReferenceFromUri` is new code, structurally parallel to (never modifying) `deeplink/deep_link_resolver.dart`'s `resolveDeepLinkUri`. It returns only a `String?` (the reference) — it cannot, even in principle, produce an `ActionRef`, so a device-preview build receiving a malformed or foreign link has no path to smuggle a navigate/openProduct/etc. action, mirroring the production resolver's own "this function's return type structurally cannot produce a destructive action" guarantee.
- **Fail-safe on anything else**: wrong scheme, wrong host (including the *production* host — the two allowlists never overlap), wrong path shape, empty/oversized/out-of-charset reference, or an unparseable string all resolve to `null` — never a crash, never a partial match (proven in `preview_deep_link_test.dart`).
- **Query parameters are never read** — an accidental `?utm_source=...&token=...` appended by a share sheet is silently ignored, matching the "no tokens in deep-link query strings" rule already shipped for production.
- **Operational gate — explicitly not resolved by this task**: neither `awj-runtime-proof.example` nor `preview.awj-runtime-proof.example` is a real, publicly hosted domain today; `autoVerify`/Apple's AASA verification cannot actually succeed until one is provisioned and hosts the matching `.well-known/assetlinks.json` / `apple-app-site-association`. This was already an open gate for the production host before this task; MP-7 adds a second host under the identical gate rather than resolving either. **A second, separate gate this task itself introduces**: `main.dart` and `main_device_preview.dart` currently share one `AndroidManifest.xml`/Xcode target/bundle identifier — there is no build-flavor or `applicationIdSuffix` separation yet, so the two binaries cannot both be installed side-by-side on one physical device today (installing one overwrites the other, since Android/iOS key app identity by package/bundle ID, not by entry point). This is fine for the code-boundary this task is asked to prove (each build resolves only its own link shape, verified in isolation), but is recorded here as a real product/build decision a future task must resolve before a merchant and a developer could run both builds on the same test device simultaneously.

---

## 5. DB / API changes

**New table**: `preview_exchange_references` (migration `2026_10_20_010000_create_preview_exchange_references_table.php`) — `id`, `tenant_id`, `builder_app_id`, `reference_hash` (unique, sha256 hex), `schema_snapshot` (json), `draft_revision`, `channel` (fixed `device`), `device_label`, `created_by`, `expires_at`, `consumed_at`, `preview_session_id` (nullable FK, set only on successful exchange). Indexes on `(tenant_id, builder_app_id)` and `expires_at`. No existing table altered.

**New merchant-admin API** (inside the existing `apps_builder`/`commerce.app_builder` route group, `routes/api.php`):
- `POST /api/app-builder/apps/{id}/preview-exchange-references` — issue a one-time reference (throttled: `preview-exchange-issue`, 20/min per user, same limiter shape as direct session issuance).

**New public Preview API surface** (`routes/api_preview.php`, `preview/v1` prefix, **zero prior authentication**):
- `POST /preview/v1/exchange` — the only new route. Throttled: `preview-exchange`, 20/min per IP (no session to key on before a successful exchange). No route/query parameter for tenant/app — the entire scope comes from the reference row itself (E6/BOLA, identical posture to `experience.show`).

**New model**: `App\Models\PreviewExchangeReference` (`CompanyWide`, same tenancy classification as `PreviewSession`). **New service**: `App\Services\AppBuilder\PreviewExchangeService` (`issueForDraft()` / `consume()`). **New controllers**: `PreviewExchangeReferenceController` (merchant), `PreviewExchangeController` (public). **New config file**: `config/preview.php` (`deep_link_host`). **Extended enum**: `PreviewSessionEvent::ACTION_EXCHANGE_CREATED` / `ACTION_EXCHANGED` (two new audit action strings on the existing append-only table — no schema change to `preview_session_events`).

No existing route's behavior changed. `PreviewSession`, `AuthenticatePreviewSession`, `PreviewSessionController`, `PreviewExperienceController`, and `preview/v1/experience` are **byte-for-byte untouched**.

---

## 6. Decision Gate review

None of the task's listed forbidden conditions were triggered. The one item worth flagging explicitly rather than silently deciding:

**A second Universal Link / App Link host, not an extension of the existing one.** Not listed among the task's enumerated Decision Gate triggers (it is not "placing the bearer in a URL," not a Tenant Isolation change, not a schema change, not a runtime redesign), and directly grounded in evidence (§1 E1: Android's own model treats "one app per host" as the default expectation) — so implemented directly rather than escalated. Recorded here per the spirit of "when in doubt, be explicit," not because the letter of any listed gate applies.

No other implementation choice in this task came close to a listed gate: the working `PreviewSession` bearer is never placed in the QR/link (§2's whole point); no merchant/admin/store credential is ever forwarded to the device (the exchange endpoint accepts nothing but the opaque reference and returns only a fresh `PreviewSession` token, structurally identical to MP-6's own); Tenant Isolation is proven, not weakened (§9 below); the public App Schema is untouched; the exchange reference itself is one-time and 5-minute, and the resulting session keeps MP-6's existing 15-minute-default/60-minute-ceiling TTL — no long-lived credential anywhere in the chain; `BuilderDraftExperience`/`BuilderPublishedExperienceVersion` are never written by any code path added in this task; `preview/v1` remains fully outside `commerce/v1`; no merchant-executable code is added; the shipped mobile runtime (`main.dart`, `AwjRuntimeShell`, every existing screen) is untouched — `main_device_preview.dart` is an additive third entry point, reusing `PreviewRuntimeView`/`PreviewClient` unmodified, exactly as `main_preview.dart` already does; no Production domain/DNS work, no signing/store distribution, no deploy.

---

## 7. Files changed

### Backend
| File | Change |
|---|---|
| `database/migrations/2026_10_20_010000_create_preview_exchange_references_table.php` | New |
| `app/Models/PreviewExchangeReference.php` | New |
| `app/Models/PreviewSessionEvent.php` | +2 audit action constants (`exchange_created`, `exchanged`) |
| `app/Services/AppBuilder/PreviewExchangeService.php` | New — `issueForDraft()`/`consume()` |
| `app/Http/Controllers/Api/PreviewExchangeReferenceController.php` | New — merchant-admin issuance |
| `app/Http/Controllers/Api/PreviewExchangeController.php` | New — `preview/v1/exchange` |
| `config/preview.php` | New — `deep_link_host` |
| `routes/api.php` | +1 merchant-admin route, 1 import |
| `routes/api_preview.php` | +1 public route |
| `app/Providers/TenancyServiceProvider.php` | +2 named rate limiters (`preview-exchange-issue`, `preview-exchange`) |
| `tests/Feature/PreviewExchangeTest.php` | New — 13 focused tests |
| `tests/Feature/PreviewExchangePostgresConcurrencyTest.php` | New — 2 real two-connection concurrency tests |

### Mobile
| File | Change |
|---|---|
| `mobile/lib/preview/preview_deep_link.dart` | New — dedicated preview-only resolver (opaque reference, not `ActionRef`) |
| `mobile/lib/preview/preview_deep_link_channel.dart` | New — device-preview-only platform channel listener |
| `mobile/lib/preview/preview_exchange_outcome.dart` | New — exchange outcome sealed classes |
| `mobile/lib/preview/preview_exchange_client.dart` | New — typed `preview/v1/exchange` client |
| `mobile/lib/preview/device_preview_app.dart` | New — `AwjDevicePreviewApp` state machine (waiting → exchanging → ready/invalid/unavailable) |
| `mobile/lib/main_device_preview.dart` | New — merchant-usable device entry point |
| `mobile/lib/preview/preview.dart` | +6 barrel exports |
| `mobile/android/app/src/main/AndroidManifest.xml` | +1 intent-filter (dedicated preview host) |
| `mobile/ios/Runner/Runner.entitlements` | +1 associated-domain entry |
| `mobile/test/preview/preview_deep_link_test.dart` | New — 10 tests |
| `mobile/test/preview/preview_exchange_client_test.dart` | New — 6 tests |
| `mobile/test/preview/device_preview_app_test.dart` | New — 6 widget tests |

No file under `mobile/lib/app/` (the production `AwjRuntimeShell`), `mobile/lib/main.dart`, or `mobile/lib/main_preview.dart` was touched.

### Web
| File | Change |
|---|---|
| `web/src/app/(commerce)/app-builder/[id]/page.tsx` | New "Preview on phone" QR flow: issue exchange reference → QR (`qrcode.react`) + copyable deep link → live countdown → expired/consumed states → regenerate |
| `web/src/messages/ar.json` / `en.json` | +15 `appBuilder.detail.previewSessions.qr*` keys, both languages, identical key sets |
| `web/src/app/(commerce)/app-builder/[id]/page.test.tsx` | +6 tests for the QR flow |

---

## 8. Backend tests — sqlite + pgsql

`tests/Feature/PreviewExchangeTest.php` — **13/13 green** on both databases (run against the exact `setup.sh`-assembled app, no local patching beyond this PR's own diff):
- SQLite: `Tests: 13 passed (86 assertions)`
- PostgreSQL 16: `Tests: 13 passed (86 assertions)` (run together with `PreviewSessionTest`/`PreviewExchangePostgresConcurrencyTest`: `Tests: 31 passed (174 assertions)`)

`tests/Feature/PreviewSessionTest.php` (MOBILE-PREVIEW-6's own suite) — still **16/16 green** on both databases, confirming no regression to the direct-issuance path this task deliberately left untouched.

Coverage against the task's minimum bar:

| Requirement | Test |
|---|---|
| Authorized exchange creation | `issuance_returns_the_raw_reference_once_and_persists_only_its_hash`, `a_custom_role_granted_only_apps_builder_view_may_issue_an_exchange_reference` |
| Unauthorized/RBAC denial | `issuance_requires_apps_builder_view_staff_is_denied` |
| Cross-tenant creation denial | `issuing_a_reference_for_another_tenants_app_id_is_denied` |
| Raw exchange reference returned once | `issuance_returns_the_raw_reference_once_and_persists_only_its_hash` (asserts the response never contains `token`/`session` keys either) |
| Hash-only/server-safe persistence | Same test — `reference_hash` is a distinct 64-hex-char SHA-256, never equal to the raw value |
| 5-minute expiry behavior | `the_exchange_reference_expires_in_five_minutes` |
| Successful one-time exchange | `a_valid_reference_exchanges_into_a_working_preview_session` |
| Replay rejection | `a_second_exchange_of_the_same_reference_is_rejected` |
| Concurrent double-exchange safety | `PreviewExchangePostgresConcurrencyTest` (§10 below) |
| Malformed/unknown/expired/consumed rejection | `an_unknown_or_malformed_reference_is_rejected_with_the_same_generic_shape`, `an_expired_reference_is_rejected_generically` |
| Cross-tenant/cross-app retarget impossible | Structurally impossible — the exchange endpoint accepts no tenant/app parameter at all; `a_valid_reference_exchanges_into_a_working_preview_session` and `the_exchanged_session_uses_the_snapshot_frozen_at_reference_issuance_not_a_later_draft_edit` prove the resulting session only ever reflects the reference's own bound app/snapshot |
| Issued PreviewSession has only `preview:read` | `a_valid_reference_exchanges_into_a_working_preview_session` (asserts `personal_access_tokens.abilities === ['preview:read']`) |
| Resulting session uses the intended immutable snapshot | `the_exchanged_session_uses_the_snapshot_frozen_at_reference_issuance_not_a_later_draft_edit` |
| Merchant/admin/store tokens never accepted by exchange endpoint | `merchant_admin_and_store_bearer_tokens_are_never_accepted_as_an_exchange_reference` |
| Raw exchange reference absent from audit/log payloads | `raw_reference_never_appears_in_any_audit_row` (checks both a failed and a successful attempt's audit rows) |

---

## 9. Replay/concurrency proof

`tests/Feature/PreviewExchangePostgresConcurrencyTest.php` — real two-PDO-connection proof on PostgreSQL 16, structurally identical to the already-established `AccountingPeriodLockConcurrencyTest` (ACC-6) pattern (a genuinely independent rival connection commits the shared anchor row outside `RefreshDatabase`'s transaction, then holds a real row lock):

1. **`consuming_a_reference_waits_for_the_row_lock_held_by_another_connection`** — a rival connection holds `SELECT ... FOR UPDATE` on the reference row; `PreviewExchangeService::consume()` genuinely **blocks** (a short `lock_timeout` turns the wait into an assertable `QueryException` containing "lock timeout" rather than a hang); zero partial `PreviewSession` rows exist after the timeout (the transaction rolled back cleanly); once the rival releases the lock, a real consume succeeds normally.
2. **`a_concurrent_winning_exchange_leaves_no_room_for_a_second_session_from_the_same_reference`** — the rival, while still holding the row lock, performs the *actual* winning consumption (inserts a real `preview_sessions` row, stamps `consumed_at`/`preview_session_id`) and only then commits. Our own attempt is proven to have waited for that exact commit (not raced past it), and — critically — a fresh consume attempt *after* the rival's commit is rejected (`consumed`), never minting a second session. Final assertion: exactly **one** `preview_sessions` row exists for the app, not two.

This proves the task's exact requirement — "concurrent double-exchange cannot mint two usable sessions" — with a genuine race, not a single-connection approximation.

---

## 10. Tenant Isolation proof

- `issuing_a_reference_for_another_tenants_app_id_is_denied` — tenant B cannot even issue a reference against tenant A's `builder_app_id` (404, `TenantScope`-backed `findOrFail`, identical to MP-6's own `issuance_for_another_tenants_app_id_is_denied`).
- `a_valid_reference_exchanges_into_a_working_preview_session` / `the_exchanged_session_uses_the_snapshot_frozen_at_reference_issuance_not_a_later_draft_edit` — the resulting session strictly reflects the tenant/app/snapshot the *reference* was issued for; the exchange endpoint accepts no tenant/app/session parameter of any kind for a caller to manipulate (E6/BOLA — the parameter simply does not exist in the request, same posture as `preview/v1/experience` itself).
- `PreviewExchangeService::consume()` resolves the reference row **globally** (`withoutGlobalScope(TenantScope::class)`) only to read its own `tenant_id`/`builder_app_id` — identical fail-closed shape to `AuthenticatePreviewSession`'s own resolution of a `PreviewSession` token. No code path in the exchange subsystem ever calls `withoutGlobalScope` again after that point, and the resulting `PreviewSession` row is created through the ordinary tenant-scoped model exactly as MP-6's direct-issuance path already does.
- Cross-app retargeting is structurally impossible for the same reason MP-6 already proved it for direct issuance: `builder_app_id` is fixed at reference-issuance time and never re-read from any later request.

---

## 11. Flutter tests / builds

**Could not be run locally** — no Flutter toolchain in this sandbox (same limitation MOBILE-PREVIEW-4's/MOBILE-PREVIEW-6's own reports recorded). Written directly against the real, already-exercised APIs (`resolveDeepLinkUri`'s own sibling shape, `CommerceTransport`/`FakeCommerceTransport`, `PreviewRuntimeView`, `TestDefaultBinaryMessengerBinding`'s platform-channel simulation exactly as `app/deep_link_navigation_test.dart` already establishes), and self-reviewed line-by-line against the codebase's existing Dart style (e.g. `is`/`as` narrowing on sealed-class outcomes rather than Dart 3 pattern-matching `switch`, matching `preview_startup.dart`'s own established convention, specifically to avoid the exact class of `flutter analyze` surprise MOBILE-PREVIEW-6's own report recorded — an import miss `flutter analyze` caught that static self-review had missed).

- `preview_deep_link_test.dart` (10): the one allowlisted shape resolves; wrong scheme rejected; **the production runtime's own host is rejected too** (the two allowlists never overlap — a dedicated regression guard); unrecognized path shapes (`/home`, `/preview`, `/preview/a/b`) rejected; empty reference segment rejected; out-of-charset reference rejected (`abc-123`, percent-encoded); pathologically long reference rejected; query parameters ignored entirely (still resolves the reference, proving they are never consulted); a trailing slash does not change resolution; unparseable string input never throws.
- `preview_exchange_client_test.dart` (6): reference sent in the request body only — never a query string, never an `Authorization` header; a successful exchange yields `PreviewExchangeSucceeded` carrying the real bearer; 401 → `PreviewExchangeInvalid` regardless of body; non-2xx/401 → `PreviewExchangeUnavailable`; malformed body → `PreviewExchangeUnavailable`; a 2xx body missing a usable token → `PreviewExchangeUnavailable`, never a fabricated session.
- `device_preview_app_test.dart` (6, widget tests, real platform-channel simulation): shows the waiting-for-link state before any link arrives; a cold-start valid link exchanges and hands off to the **real, unmodified** `PreviewRuntimeView` (found by type, proving no forked rendering path); a warm-start link with the wrong host is silently ignored (stays waiting, zero exchange requests sent); an invalid/expired/consumed reference (401) shows the controlled "code no longer valid" state, never the runtime; a transport/protocol failure shows the controlled "unavailable" state, never a crash; a second link delivered after a successful exchange never re-triggers a second exchange (exactly one request sent, runtime still showing).

---

## 12. Web tests / build

- `npm run test` (full suite) — **327 test files / 2438 tests, all green** (baseline before this task: 321 files / 2336 tests per MOBILE-PREVIEW-6's own report — the delta here is this task's own +6 new tests in `page.test.tsx`, and the i18n-keys-parity guard stays green with the new 15-key `qr*` block present identically in `ar.json`/`en.json`).
- `npm run build` (Next.js production build) — **succeeded, exit code 0**, including the updated `/app-builder/[id]` route.

---

## 13. Token/reference leakage proof

- `raw_reference_never_appears_in_any_audit_row` — issues a reference, attempts one wrong guess, then a successful exchange, and asserts every `preview_session_events` row (both `exchange_created`→`created`/`exchanged` and the failed attempt's `rejected` row) contains no substring match of either the raw exchange reference or the resulting raw session bearer, in any column.
- `issuance_returns_the_raw_reference_once_and_persists_only_its_hash` — `preview_exchange_references.reference_hash` is a 64-hex-char SHA-256, never equal to the raw value; the issuance response body contains no `token`/`session` key at all (nothing shaped like a working credential to leak in the first place).
- Web: the QR dialog never renders the raw exchange reference as plain copyable text (the "copy link" action copies the full `deep_link` URL, and the raw `reference` string is never shown standalone) — `requests_a_one_time_exchange_reference_and_shows_only_the_deep_link` asserts the raw reference string is not present anywhere as bare text; the dialog never stores anything in `localStorage`/`sessionStorage` (no such call exists in the new code).
- Mobile: the exchange client sends the reference only to the `preview/v1/exchange` path in a POST body, never a query string (`preview_exchange_client_test.dart`); the exchanged bearer is held only in the in-memory `PreviewConfig`/`PreviewClient` for the process lifetime and is never written back into a `Uri`, `SharedPreferences`, or any log statement.
- Residual risk, stated plainly: the QR *code itself*, once displayed, is a photographable image for its 5-minute window — the same residual risk RFC 8628 documents for any human-visible device code, mitigated identically (short TTL, one-time consumption, the merchant sees which tenant/app it's generating a code for before showing it).

---

## 14. CI

Not yet observed on this PR's actual GitHub Actions run — this section will be confirmed once the PR is opened and CI reports. Locally reproduced ahead of CI (§8–§12 above): backend sqlite + pgsql (including the real two-connection concurrency proof), web full test suite + production build. Flutter `analyze`/`test`/Android+iOS build proofs are **not** run locally (no toolchain in this sandbox) and rely on `mobile-ci.yml` as the first real execution — flagged explicitly, not glossed over, exactly as MOBILE-PREVIEW-6's own report did for the same limitation.

---

## 15. Operational / domain association gates

1. Neither `awj-runtime-proof.example` nor the new `preview.awj-runtime-proof.example` is a real, publicly hosted domain — `autoVerify`/AASA verification cannot succeed for either until one is provisioned. This was already an open gate before this task (production host); MP-7 adds a second host under the identical, already-accepted gate.
2. `main.dart` and `main_device_preview.dart` currently share one Android package / iOS bundle identifier (no build-flavor separation) — both binaries cannot be installed side-by-side on one physical test device today. A future task should introduce a distinct `applicationIdSuffix`/product flavor (or equivalent) before that becomes a real testing need.
3. No signing/provisioning automation, no App Store/Play distribution, no Production deployment — none proposed or implied by this task.

---

## 16. Decision Gate status

None triggered — see §6 for the full walk-through against every condition the task lists, and the one non-triggering item (a second, dedicated deep-link host) recorded transparently rather than decided silently.

---

## 17. Risks / remaining limitations

1. **No Flutter toolchain in this sandbox** — the Dart/Flutter test suite (22 tests across 3 new files) is written and self-reviewed but not executed locally; `mobile-ci.yml` is the first real execution, exactly as MOBILE-PREVIEW-6's own report recorded for its own Dart tests.
2. **The "consumed" indicator in the web QR dialog is best-effort, not authoritative.** It polls the merchant's own existing preview-sessions list (no new API surface was added purely for this) and infers "connected" from the list's length increasing — there is no direct reference→session correlation in `PreviewSessionResource` today. If two devices scan two different QR codes for the same app in quick succession, either could be the one that flips the indicator. This is a UX nicety, not a security boundary — the actual exchange/session security proofs in §9/§10 do not depend on it.
3. **No dedicated "revoke this exchange reference" action.** A generated-but-unscanned reference simply expires after 5 minutes; the task's UX minimum bar lists revoke/cancel "where applicable" — closing the dialog is the only cancel affordance today (the reference still expires on its own regardless). Adding an explicit revoke would need a new endpoint not currently justified by any negative test requiring it.
4. **Two Universal Link / App Link hosts, one shared native project.** See §15.2 — a real product/build decision (build flavors) is deferred, not resolved.
5. **`source = published`/`source = default` exchange issuance is not implemented**, matching MOBILE-PREVIEW-6's own identical limitation for direct issuance (`PreviewExchangeService::issueForDraft()` only, mirroring `PreviewSessionService::issueForDraft()`) — out of this task's literal scope ("QR/deep-link one-time exchange for **physical-device pairing**" of the current Draft).
6. **The 5-minute exchange-reference TTL is not configurable**, by design (§1 E4's rationale) — this matches the task's own instruction ("Default exchange TTL target: 5 minutes unless repo evidence requires a smaller safe value"; no evidence surfaced requiring a smaller value).

---

## 18. Explicit MP-8+ deferrals

Real physical-device end-to-end proof against an actual provisioned domain (AASA/assetlinks.json hosted for real), signing/TestFlight/Play distribution, build-flavor separation between `main.dart`/`main_device_preview.dart`, an explicit revoke-exchange-reference action, a direct reference↔session correlation in the resource layer (to make the web "consumed" indicator authoritative rather than best-effort), and `source = published`/`default` exchange issuance — all remain out of MP-7, unchanged from this task's own explicit non-goals list.

---

## 19. Next step

- Branch `claude/trusting-brown-6y61jc` pushed; PR to be opened against `main`, titled `feat(app-builder): MOBILE-PREVIEW-7 QR device preview exchange`, per the task's own branch/PR instruction (harness-designated branch, task-doc-specified title).
- **Stopping before merge**, per the task's explicit instruction. No Deploy. No Production.
- Recommended next step per the Horizon: confirm CI green (backend sqlite+pgsql, `mobile-ci.yml` analyze+test+Android/iOS build proofs, web build+test), address any findings, then this PR is ready for owner review and merge.
