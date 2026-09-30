# AWJ App Builder — Real Mobile Preview Horizon — Closure Report (MOBILE-PREVIEW-9)

**Horizon:** AWJ App Builder — Real Mobile Preview
**Task:** MOBILE-PREVIEW-9 — Closure (`docs/plans/app-builder/MOBILE-PREVIEW-9-CLAUDE-CODE-TASK.md`)
**Repository:** `safwan5001-source/Nebrax`

## Final closure status

> ## **IMPLEMENTATION COMPLETE / OPERATIONAL GATES OPEN**
>
> **Update (2026-09-30, this revision):** the owner has resolved both Decision Gates that
> previously forced status C:
>
> 1. **Build-flavor/packaging → Option A approved.** Run `main_device_preview.dart` standalone
>    for real-device verification. No Flutter flavor, `applicationId`, bundle ID, scheme, or
>    native target change is authorized or made. See §3.
> 2. **Preview domain → `preview.awjdev.xyz` approved** for development/preview verification. See
>    §4. **No DNS, hosting, AASA, `assetlinks.json`, signing, or deployment has been provisioned —
>    the owner explicitly withheld that authorization for this update.** Only the hostname
>    identity itself is decided.
>
> With both choices made, **no remaining closure step is blocked on an owner decision.** What
> remains is (a) the operational work of actually provisioning the approved domain — not yet
> authorized to execute — and (b) executing the already-written real-device matrix on Android and
> iOS — which requires a local Flutter/Android/Xcode toolchain or an extended CI job, absent from
> every sandbox this Horizon has run in through MP-4/6/7/8/9. All in-scope engineering remains
> implemented, tested, and CI-green (CODE/TEST/CI evidence complete for 11 of 12 exit criteria —
> criteria 1–9 and 11–12 all PASS).
>
> **Criterion 10 ("real Android and iOS device verification is recorded") remains OPEN** — per the
> owner's own explicit instruction, it stays open until genuine device execution is recorded, and
> this update performs none. Per the task's own model this is now squarely status **B**, not C:
> the feature implementation is complete; only real domain/device work remains, and it is now
> owner-timing-gated (provisioning) and environment-gated (toolchain), not decision-gated.

---

## 1. Base / Head SHA, branch, PR

| Item | Value |
|---|---|
| Base SHA (latest `origin/main` at MP-9 task start, owner-confirmed) | `28db328c833ed55999bd2d055af0ab36dbd4b9d4` |
| Branch | `docs/mobile-preview-9-closure` |
| PR title | `docs(app-builder): MOBILE-PREVIEW-9 horizon closure` |
| Scope | Documentation only — this closure report + no application/test/mobile/web code change |
| Head SHA | recorded in §13 once the final commit is pushed |

No application code, migration, route, or test file is added or modified by this task. Verification
in §8 re-runs **existing, already-merged** tests against the current `main` tip to reconfirm they
remain green — it does not add new tests, per the task's own "focused verification, not redesign"
framing for a closure task.

---

## 2. MOBILE-PREVIEW-1…9 — Task / PR / Merge ledger

Built from Git history and the GitHub PR record directly (`git log`, `pull_request_read` on each
PR number below), not from memory or report text alone.

| Task | PR | Merge commit (`main`) | Base SHA | Report / artifact | Main deliverable | Decision Gate | Carried-forward open items |
|---|---|---|---|---|---|---|---|
| **MP-1** — Evidence & UX benchmark | [#1043](https://github.com/safwan5001-source/Nebrax/pull/1043) | merged 2026-09-26T08:57:48Z | `0f36355` | `REAL-MOBILE-PREVIEW-1-EVIDENCE-PASS.md` | Salla/Shopify/Flutter evidence pass; Design vs Preview UX decision | None | — |
| **MP-2** — Runtime/preview architecture evidence | [#1045](https://github.com/safwan5001-source/Nebrax/pull/1045) | merged 2026-09-26T09:28:31Z | `4215519` | `REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md` | **Hybrid architecture decision**: React Design Canvas → React Browser Preview → Flutter Real Runtime Preview → Flutter Physical Device Preview; Flutter Web deferred | None | Flutter Web deferral (still deferred, MP-9 does not revisit) |
| **MP-3** — Browser App Preview shell | [#1097](https://github.com/safwan5001-source/Nebrax/pull/1097) | merged 2026-09-29T01:25:12Z | `ab88efc` | `REAL-MOBILE-PREVIEW-3-IMPLEMENTATION-REPORT.md` | Design/App Preview switch, `DeviceFrame`, Full Preview, Browser Preview truth badge | None | — |
| **MP-4** — Runtime semantic parity | [#1100](https://github.com/safwan5001-source/Nebrax/pull/1100) | merged 2026-09-29T05:05:01Z | `bf02335` | `MOBILE-PREVIEW-4-IMPLEMENTATION-REPORT.md` | Real action dispatch (navigate/openProduct/cart) honestly limited to the shipped runtime's actual `home`/`cart` allowlist; registry-identifier conformance fixtures | None | Empty-cart/empty-list sample-data limitation (unsolved, not blocking) |
| **MP-5** — Preview Session security architecture | [#1106](https://github.com/safwan5001-source/Nebrax/pull/1106) | merged 2026-09-29T06:12:34Z | `8a17f77` | `MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` | `PreviewSession` Sanctum principal design (15 required decisions), threat model, Decision Gate **PASS** | Mandatory gate — **PASS**, no forbidden condition triggered | Hosting topology, Flutter Web browser custody, central ability registry — all explicitly deferred |
| **MP-6** — Real Runtime Preview | [#1109](https://github.com/safwan5001-source/Nebrax/pull/1109) | merged 2026-09-30T13:19:30Z | `7bd9e90` | `MOBILE-PREVIEW-6-IMPLEMENTATION-REPORT.md` | `PreviewSession`/`AuthenticatePreviewSession`/`preview/v1/experience`; real `CompatibilityResolver`/`ExperienceView` rendering via `main_preview.dart` | None (RBAC scope-comparison reasoning recorded explicitly) | `setup.sh` drift (App Mail/AWS SDK) — unrelated, separately tracked |
| **MP-7** — QR device preview exchange | [#1121](https://github.com/safwan5001-source/Nebrax/pull/1121) | merged 2026-09-30T15:37:18Z | `b3a71ad` | `MOBILE-PREVIEW-7-IMPLEMENTATION-REPORT.md` | `preview_exchange_references`, one-time exchange, `main_device_preview.dart`, dedicated preview Universal/App Link host | One non-forbidden item recorded transparently (second deep-link host — not a listed gate) | Build-flavor/packaging gap first surfaced (§15.2 of its report) |
| **MP-8** — Integrated proof & real-device verification | [#1130](https://github.com/safwan5001-source/Nebrax/pull/1130) | merged 2026-09-30T20:29:26Z | `82e5199` | `MOBILE-PREVIEW-8-INTEGRATED-PROOF-REPORT.md` | Exchange-path integration tests (4 new), full URL/logging leakage audit, exact packaging/domain gates named | **Build-flavor Decision Gate opened, not resolved** — classified (B) | Real-device execution (criterion 10), packaging gate, domain/hosting gate — all carried to MP-9 |
| **MP-9** — Closure (this task) | [#1132](https://github.com/safwan5001-source/Nebrax/pull/1132) | *pending* | `28db328` | This report | Ledger, exit-criteria audit, two Decision Packets, closure status | **Both Decision Gates presented and subsequently resolved by the owner** (Option A packaging; `preview.awjdev.xyz` domain — see §3/§4) | Real-device execution (criterion 10) and domain/AASA/assetlinks provisioning — neither yet performed; both now unblocked to proceed whenever toolchain/authorization exist |

All eight prior PRs are confirmed **merged** (not merely opened) by direct query of the GitHub PR
API at the time of this report — `merged: true` for every one of #1043/#1045/#1097/#1100/#1106/
#1109/#1121/#1130.

---

## 3. Build-flavor / packaging Decision Gate — **RESOLVED by owner**

> **Owner decision (2026-09-30): Option A approved.** Run `main_device_preview.dart` standalone
> for real-device verification. Do not introduce a new Flutter flavor, `applicationId`, bundle ID,
> scheme, or native target. No code change is required to act on this decision — Option A is, by
> construction (§3.1), exactly how `main_device_preview.dart` already runs today. This section is
> kept in full below as the evidence record the decision was made against; it is no longer an open
> packet awaiting a choice.

### 3.1 Exact current state (re-verified directly this session, not restated from MP-8 alone)

| Item | Current value | Source |
|---|---|---|
| Android `applicationId` | `com.example.awjmobileruntimeproof` — one value, no product flavors, no `applicationIdSuffix` | `mobile/android/app/build.gradle*:24` |
| iOS `PRODUCT_BUNDLE_IDENTIFIER` | `com.example.awjMobileRuntimeProof` — one value, no scheme/target separation (a `RunnerTests` variant exists, itself a suffix of the same identifier, not a product variant) | `mobile/ios/Runner.xcodeproj/project.pbxproj:387,403,420` |
| Entry points | Three independent Dart `main()` files, confirmed unmodified relative to each other: `mobile/lib/main.dart` (production, 7 lines, `runApp(const AwjMobileRuntimeApp())`), `mobile/lib/main_preview.dart` (MP-6, developer/dart-define preview), `mobile/lib/main_device_preview.dart` (MP-7, merchant-usable QR/exchange preview) | Direct file read this session |
| How each is launched today | `flutter run -t lib/<entry>.dart [--dart-define=...]` — a standard, supported Flutter invocation selecting which `main()` to compile/run; no build-flavor machinery is involved in selecting the entry point itself | `main_device_preview.dart`'s own doc comment; `mobile-ci.yml` builds only `main.dart` |
| Can a developer run the device-preview entry point alone, without any package identity change? | **Yes.** `flutter run -t lib/main_device_preview.dart --dart-define=PREVIEW_BASE_URL=...` installs and runs standalone on a device/emulator today, using the existing single `applicationId`/bundle ID. Nothing about running *this one build alone* requires a packaging change. | Direct construction-level code read this session (§5.4 of MP-8's own report, re-confirmed) |
| Can production (`main.dart`) and the device-preview build coexist **side-by-side, installed at the same time, on one physical device** today? | **No.** Android/iOS key installed-app identity by package/bundle ID, not by which Dart entry point produced the binary. Installing any one of the three builds **overwrites** whichever of the other two was previously installed under the same identity. | Direct build-config inspection this session; matches MP-7 §15.2 and MP-8 §5.2 verbatim |

### 3.2 Does the Horizon's *minimum* real-device proof matrix actually require side-by-side coexistence?

Re-reading the Horizon's §"Real-device execution" minimum list item by item (install/run the
device-preview entry point; cold start; warm start; wrong-host link ignored; expired reference
controlled; already-consumed reference controlled; successful exchange reaches
`PreviewRuntimeView`; frozen Draft snapshot renders; later Draft edit does not mutate current
preview; regenerated QR opens newer snapshot; revoked/expired PreviewSession fails closed; no
Published mutation) — **every single item is fully exercisable with only `main_device_preview.dart`
installed, alone, on one device.** None of the twelve checks requires `main.dart` (production) to
be simultaneously present on the same physical device.

**What coexistence would additionally prove, but the minimum matrix does not require**: that a
merchant or tester who already has the *real* AWJ app installed on their own phone can also
temporarily preview a Draft without disturbing their existing production install — a realistic
future merchant-facing scenario, but not literally what the Horizon's exit criterion 10 or MP-8's
own matrix asks for today.

### 3.3 Options (as the task's own template requires, compared, not chosen)

**Option A — temporary/manual entry-point execution (no durable flavor/package redesign)**
- Use the existing single `applicationId`/bundle ID exactly as shipped today.
- Run `main_device_preview.dart` **alone** on a device/emulator (no `main.dart` installed
  simultaneously) to execute the full minimum matrix in §3.2.
- **Sufficient to honestly close criterion 10's literal wording** — it does not require pretending
  coexistence when the matrix never needed it.
- Zero packaging/signing/scheme surface touched; nothing to re-review from a Decision Gate
  standpoint once approved.
- **Does not** prove merchant-realistic side-by-side coexistence; that remains open if ever needed.

**Option B — dedicated test-only preview flavor**
- A separate Android `applicationIdSuffix` (e.g. `.devicepreview`) and, where needed, a separate
  iOS bundle identifier/scheme for `main_device_preview.dart` specifically.
- No App Store/Play distribution; strictly additive, non-production.
- Enables true side-by-side installs (production + preview on one test device at once) and any
  future merchant-facing "preview alongside my real app" scenario.
- **Touches `build.gradle`, the Xcode project's scheme/target configuration, and — eventually —
  a second signing identity** — exactly the kind of change the Horizon's own §12 item 12 and this
  task's §11 list name as a Decision Gate trigger ("build flavor / applicationId / bundle-ID /
  native target redesign without owner approval"), independent of how small the diff would be.
- `mobile-ci.yml` today only builds/validates `main.dart`; a flavor split would ship its first real
  validation as this session's own change, with no local Flutter toolchain available anywhere in
  this Horizon's history to pre-validate it (§3.4).

**Option C — defer physical-device coexistence entirely**
- Closure status remains OPEN/PARTIAL (which, per §9 below, it already must, for other reasons
  too).
- No further packaging action taken at all until the owner decides otherwise.

### 3.4 Disposition

This task did **not** implement Option B (or any equivalent packaging change) — doing so without
owner approval was exactly the condition both the Horizon's §12 item 12 and this task's own §11
listed the change under, and the owner's decision (above) confirms Option A, not B, so Option B
remains permanently out of scope unless separately revisited.

**Additional, orthogonal constraint, stated plainly, unaffected by this decision**: no sandbox this
Horizon has run in (MP-4, MP-6, MP-7, MP-8, and this MP-9 session, re-confirmed directly: `which
flutter dart adb emulator xcrun simctl avdmanager sdkmanager` all return nothing;
`$ANDROID_HOME`/`$ANDROID_SDK_ROOT` unset) has a Flutter/Android/Xcode toolchain. **Resolving this
Decision Gate does not by itself unblock real-device execution** — it only removes the packaging
question as a blocker so that whoever *does* have local tooling, or an extended CI job, can proceed
without a further approval round.

**Decision recorded**: the owner selected Option A. No `build.gradle`/Xcode project change is
authorized by this decision, and none was made.

---

## 4. Preview domain / association Decision Gate — **Hostname RESOLVED by owner; provisioning still withheld**

> **Owner decision (2026-09-30): hostname approved — `preview.awjdev.xyz`**, for
> development/preview verification. This resolves the *naming* question this packet asked. It does
> **not** authorize provisioning: **no DNS record, hosting project, `apple-app-site-association`,
> `assetlinks.json`, signing identity, or deployment has been created by this update**, per the
> owner's explicit instruction. Hosting-target selection (§4.2), AASA/assetlinks content, the
> signing-fingerprint dependency, and the fallback page all remain to be executed as a distinct,
> separately-authorized follow-up action — not a further Decision Gate on identity, since the host
> name itself is now fixed.

### 4.1 Exact current state (re-verified directly this session)

| Item | State |
|---|---|
| `PREVIEW_DEEP_LINK_HOST` (code default, **unchanged by this update**) | `preview.awj-runtime-proof.example` (`config/preview.php:17`) — a reserved, non-routable `.example` TLD (RFC 2606), unchanged since MP-7. This is intentionally **not** changed to the approved hostname yet — wiring the real value in without the domain being provisioned would make the deep link resolve nowhere, and the owner explicitly withheld provisioning authorization this round. |
| **Owner-approved future hostname (not yet wired anywhere)** | **`preview.awjdev.xyz`** — decided this session for development/preview verification; to be set as the `PREVIEW_DEEP_LINK_HOST` env value (not the code default) once DNS/hosting is actually provisioned |
| Android App Link host | Still the placeholder, alongside the separate production-host entry, `mobile/android/app/src/main/AndroidManifest.xml` — unchanged |
| iOS Associated Domains host | Still the placeholder, alongside the production entry, `mobile/ios/Runner/Runner.entitlements` — unchanged |
| `.well-known/assetlinks.json` | **Does not exist anywhere in this repository** — `find . -iname assetlinks.json` returns nothing, re-confirmed this session |
| `apple-app-site-association` | **Does not exist anywhere in this repository** — same confirmation |
| Any web route (Next.js, Laravel, nginx/Caddy/`vercel.json`) serving either preview host or `preview.awjdev.xyz` | **None** — `web/vercel.json`/`storefront/vercel.json` reference entirely different, real, already-deployed apps; no entry for any preview host anywhere |
| Is the preview host real or placeholder, today | **Still a placeholder in code and DNS** — a real hostname has been *approved*, but nothing has been *provisioned* |

### 4.2 Packet contents (per the task's own required list) — hostname line now resolved

- **Proposed real preview hostname pattern — RESOLVED: `preview.awjdev.xyz`.** Approved by the
  owner this session for development/preview verification. It is a dedicated subdomain distinct
  from both the production runtime's own future host and the merchant-admin/storefront hosts
  already live on Vercel, matching the separation rationale this packet originally recommended.
- **Hosting target options already compatible with AWJ infrastructure** — `web/` and `storefront/`
  already deploy via `vercel.json`-driven Vercel projects (confirmed present in both directories);
  a dedicated minimal fallback page (per §4.3) could be a third, equally minimal Vercel project on
  the same account, or a small dedicated reverse-proxy/CDN entry if the owner prefers infrastructure
  outside Vercel. Both are "already compatible" in the sense that no new hosting *account* or
  platform is required; which one is still an owner choice.
- **Required HTTPS routing**: the host must terminate TLS and route `GET /.well-known/
  apple-app-site-association` and `GET /.well-known/assetlinks.json` as static files, plus whatever
  minimal fallback page serves `/preview/{reference}` when app-link/universal-link verification is
  skipped or fails.
- **AASA requirements**: a `apple-app-site-association` JSON document (no file extension, served
  with `Content-Type: application/json`, no redirect) naming the app's Team ID + bundle identifier
  and the `/preview/*` path pattern — requires the final iOS bundle identifier to be fixed first,
  which depends on §3's packaging decision.
- **Android assetlinks requirements**: `assetlinks.json` naming the app's `package_name` (same
  dependency on §3) and the **SHA-256 certificate fingerprint of the signing key** that will
  actually sign the installed build — which requires a signing decision this Horizon has
  explicitly deferred (§7 below) and this task explicitly does not make.
- **Certificate/signing dependency**: real Android App Link verification and real iOS Universal
  Link verification **both** require a real, stable signing identity for whichever build
  (production, or the Option A/B preview build from §3) will actually be installed and scanned —
  this is why the packaging and domain gates are linked, not independent.
- **Fallback-page requirements**: exactly the minimum policy MP-8 §3.4 already specified, carried
  forward unchanged here (no reference echo in page text/title/meta/script; no analytics/telemetry
  of any kind; no redirect that would carry the reference to a third destination; a generic
  "open the app" message is fine).
- **Access-log redaction requirements**: whichever reverse proxy/CDN ends up in front of the host
  should redact the path, or at minimum the final path segment (the one-time reference), from its
  own access logs — a requirement for whoever configures that infrastructure, not something
  Laravel/Next.js code in this repository can enforce.
- **`Referrer-Policy`**: `no-referrer` (or a stricter/equivalent value) on the fallback page, so
  navigating away from it never forwards the reference in a `Referer` header.
- **Analytics/telemetry prohibition**: no analytics or telemetry script of any kind on the
  reference-bearing fallback page.
- **Rollback/disable plan**: reverting `PREVIEW_DEEP_LINK_HOST` to the placeholder value (or unsetting the env var, which falls back to the placeholder by the config's own default) immediately
  makes both App Link/Universal Link verification fail closed again and the deep link non-routable
  — no code change needed to roll back, only an environment-variable change plus removing the
  hosted association files/fallback page from whatever infrastructure was chosen.

### 4.3 What this update did **not** do, and why

No DNS record, hosting project, association file, or fallback page was created, deployed, or
even drafted as a runnable artifact by this update — doing so without the owner's explicit approval
is precisely what this task's §4 and the Horizon's own §12 forbid, and the owner's own instruction
this round was explicit: approve the hostname, do not provision anything yet. The minimum
fallback-page *policy* remains specified above (unchanged from MP-8) so it can be implemented in
one pass once provisioning is authorized — building the page itself now, before that authorization,
would risk shipping something unused or that quietly diverges from whatever the real deployment
ends up needing.

**Decision recorded**: hostname = `preview.awjdev.xyz`. **Still outstanding, as separate
follow-up authorizations (not further identity decisions)**: (a) the specific hosting target
(Vercel project vs. dedicated proxy/CDN), (b) the signing identity that will back the SHA-256
fingerprint in `assetlinks.json` (tied to §3's now-resolved packaging decision, since Option A
keeps the existing single `applicationId`/bundle ID), and (c) explicit go-ahead to actually
provision DNS, host the association files, and build the fallback page to the policy above.

---

## 5. Exit-criteria audit

Evaluated individually, per the task's required format. Every CODE/TEST/CI claim below was
**re-verified directly this session** (source reads, or tests actually executed against the
current `main` tip — see §8), not merely copied from a prior report.

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Design Canvas and App Preview are visibly distinct | **CODE** — `web/src/app/(commerce)/app-builder/[id]/page.tsx`'s Design/App Preview switch (MP-3); **TEST** — `page.test.tsx`/`canvas.test.tsx`/`device-frame.test.tsx` green (§8.3) | **PASS** |
| 2 | App Preview has a clear device-oriented UX | **CODE** — `DeviceFrame` (responsive bezel, iPhone/Android presets), Full Preview overlay (MP-3) | **PASS** |
| 3 | Preview truth level is honestly communicated | **CODE** — explicit "Browser Preview" truth badge (MP-3), never labeled "exact native preview"; device-channel QR flow labeled "Preview on phone" (MP-7), not "final app" | **PASS** |
| 4 | Supported runtime semantics are shared/conformance-tested | **CODE** — `contracts/app-builder/registry-identifiers.v1.json` + `action-navigation-conformance.v1.json` fixtures (MP-4); **TEST** — web action-semantics/registry-identifier tests green (§8.3) | **PASS** |
| 5 | Unsupported features do not masquerade as working | **CODE** — `openProduct`/`addToCart`/`updateCartQuantity`/`removeCartItem` show an explicit "unavailable — requires live data" notice rather than a fake success (MP-4); navigate outside the real `home`/`cart` allowlist shows a truthful "not supported" notice, never a generic router | **PASS** |
| 6 | Real-runtime preview uses the actual Flutter compatibility/render path | **CODE** — `preview_startup.dart` delegates to the real, shared `CompatibilityResolver`; `preview_runtime_view.dart` renders through the real `ExperienceView`/Component Registry, not a preview-only reimplementation (MP-6, re-confirmed by direct source read this session); **CI** — `mobile-ci.yml` `flutter analyze`/`flutter test` green on PR #1109/#1121 (460/460 Dart tests) | **PASS (CODE + CI)** — not independently re-executed by real device (see #10) |
| 7 | Draft Preview does not mutate Published Experience | **CODE** — no code path in the preview subsystem writes `BuilderPublishedExperienceVersion` (re-confirmed by direct source read this session); **TEST** — `preview_never_publishes_the_draft`, `the_full_exchange_chain_serves_the_snapshot_frozen_at_reference_issuance_never_a_later_publish` (re-run green this session, §8.1) | **PASS** |
| 8 | Preview auth/session is tenant-isolated, scoped, short-lived, and tested | **CODE** — disjoint `PreviewSession` Sanctum principal, write-once tenant/app binding, ≤60-min TTL ceiling, 5-min one-time exchange reference (MP-5/6/7); **TEST** — full tenant/app isolation + cross-tenant/cross-app suites re-run green on SQLite **and real PostgreSQL 16** this session, including the genuine two-connection concurrency proof (§8.1–§8.2) | **PASS** |
| 9 | QR/open-on-phone flow works safely | **CODE** — one-time, hash-only, 5-minute exchange reference, never the bearer, in the URL path only (MP-7); **TEST** — `PreviewExchangeTest`/`PreviewExchangePostgresConcurrencyTest` re-run green this session (§8.1–§8.2); **CI** — Android/iOS release build proofs green on PR #1121 | **PASS (CODE + TEST + CI)** — QR flow's *code* path is proven; a real phone has never scanned it (see #10) |
| 10 | **Real Android and iOS device verification is recorded** | **ENVIRONMENT-GATED, not attempted, not faked.** No Flutter/Android/Xcode toolchain exists in this sandbox (re-confirmed this session: `which flutter dart adb emulator xcrun simctl avdmanager sdkmanager` all empty) or in any prior MP-4/6/7/8 sandbox. **Update:** the two Decision Gates that previously also blocked this criterion are now resolved by the owner — packaging Option A approved (§3), preview hostname `preview.awjdev.xyz` approved (§4) — but neither has been *provisioned/executed* yet (DNS/hosting/AASA/assetlinks remain unprovisioned by explicit owner instruction; no device/emulator run has occurred). **Source inspection, Dart widget tests, and release-build proofs — however thorough — are explicitly not accepted as satisfying this criterion**, per the task's own rule, and per the owner's explicit instruction this criterion stays OPEN until genuine device execution is recorded. | **OPEN** |
| 11 | Existing Builder and runtime behavior remain backward compatible | **CODE** — `main.dart` confirmed byte-identical to its pre-Horizon shape (`runApp(const AwjMobileRuntimeApp())`, no preview import); no file under `mobile/lib/app/` touched by MP-3–MP-8; no existing route's behavior changed by any MP-3–MP-8 diff (re-confirmed by direct source read this session, §9 below); **TEST/CI** — full backend + web suites carry zero new failures attributable to Preview across every MP report and this session's own reconfirmation (§8) | **PASS** |
| 12 | Closure report documents remaining limitations and distribution boundaries | This report (§10, §11, §12) | **PASS** (by virtue of this report existing and being honest about #10) |

**11 of 12 criteria PASS (1–9 and 11–12). Criterion 10 is OPEN. The Horizon cannot be marked CLOSED
while any mandatory criterion is OPEN**, per this task's own closure model — this alone already
forces status B or C. With both §3/§4 Decision Gates now resolved by the owner (no choice remains
unmade), the correct status is **B**, not C: nothing further is blocked on a decision, only on
provisioning authorization and toolchain availability.

---

## 6. Preview truth levels actually delivered

| Level | Delivered? | Evidence |
|---|---|---|
| **A — Design Canvas** | ✅ Delivered, pre-existing, unchanged by this Horizon | Existing Builder Canvas, confirmed untouched |
| **B — Browser Mobile Preview** | ✅ Delivered | MP-3 (device-frame shell, Design/Preview switch) + MP-4 (real action dispatch honestly limited to the real runtime's allowlist) |
| **C — Real Runtime Preview** | ✅ Delivered, CODE+CI proven, **not independently device/emulator-executed** | MP-6 (`main_preview.dart` → real `CompatibilityResolver`/`ExperienceView`) + MP-7 (`main_device_preview.dart` via QR/exchange) — both wire the actual Flutter rendering kernel, proven by widget tests finding real rendered markers in the tree (not a mocked return type), and by `mobile-ci.yml`'s `flutter test`/build-proof jobs, but never executed against a live emulator/simulator/device in any sandbox this Horizon has used |
| **D — Physical Device Preview** | ❌ **Not verified. Explicitly marked NOT VERIFIED / OPEN**, per this task's own instruction for when Level D lacks actual evidence | No physical Android device, Android emulator, or iOS Simulator has ever booted and executed the preview flow, in this or any prior MP session |

---

## 7. Security architecture summary

`PreviewSession` is the fifth application of AWJ's existing scoped-token pattern (alongside
`User`/`ApiClient`/`CustomerIdentity`/`PlatformAdministrator`): an opaque Sanctum bearer, single
`preview:read` ability (never intersecting `Rbac::MATRIX`), write-once `tenant_id`/`builder_app_id`,
an immutable Draft snapshot bound at issuance, ≤60-minute TTL ceiling (15-minute default), kept on a
dedicated `preview/v1` surface entirely outside `commerce/v1` so preview never needs a real store
bearer. The QR/device flow never carries the bearer itself — only a one-time, 5-minute,
hash-only-stored exchange reference in the URL **path**, redeemed via an atomically locked
(`lockForUpdate` + transaction) consumption that mints the real session for the first time only on
successful exchange. Full 15-decision architecture, threat model (14 threats), and rejected
alternatives (JWT, scoped-down merchant token, embedded bearer, hardware device binding,
`commerce/v1` layering) are in `MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`. Decision Gate result at
MP-5 time: **PASS** — reconfirmed by this task's own independent re-reading of the current code
(§8, §9), not merely re-asserted.

---

## 8. Tests — re-executed this session against the current `main` tip (Base SHA `28db328`)

No test file is new in this task; every test below already exists in `main` from MP-6/7/8. They
were re-run here specifically to confirm the closure claims in §5/§9 hold on the *current* tip, not
only at each prior task's own merge point.

### 8.1 Focused backend tests — SQLite

```
PreviewSessionTest              16 passed (81 assertions)
PreviewExchangeTest             13 passed (86 assertions)
PreviewIntegratedChainTest       4 passed (44 assertions)
```

### 8.2 Focused backend tests — PostgreSQL 16 (local instance, started and migrated this session)

```
PreviewSessionTest                          16 passed (81 assertions)
PreviewExchangeTest                         13 passed (86 assertions)
PreviewExchangePostgresConcurrencyTest       2 passed (7 assertions)  — genuine two-PDO-connection
                                                                         lock/race proof, executed
                                                                         against a real PostgreSQL 16
                                                                         server this session
PreviewIntegratedChainTest                   4 passed (44 assertions)
```

**35/35 green on both databases, 218 assertions, 0 failed** — identical result shape to MP-8's own
re-run, now reconfirmed a second time at MP-9's own base commit.

### 8.3 Full unfiltered backend suite — SQLite (mandatory pre-PR gate per `CLAUDE.md`)

Run twice this session on a freshly rebuilt SQLite database (the first attempt collided with a
stray duplicate `php artisan test` process from this same session, corrupting the on-disk SQLite
file mid-write — `database disk image is malformed`; the database was rebuilt via
`migrate:fresh` and the suite re-run once, cleanly, with the collision confirmed not to recur):

```
Tests:    55 failed, 51 skipped, 4942 passed (30940 assertions)
Duration: 928.84s
```

**Zero of the 55 failures reference `Preview`, `PreviewSession`, `PreviewExchange`, or any file
under `app/Services/AppBuilder/Preview*`/`tests/Feature/Preview*`** — confirmed by grepping the
full failure list, not merely the tail. Every failure falls into the same four already-documented,
pre-existing sandbox/environment gaps MOBILE-PREVIEW-6 §9a and MOBILE-PREVIEW-8 §9.3 already
recorded, re-confirmed by category this session:

| Category | Count | Root cause (already documented) |
|---|---|---|
| `ProductMediaR2*Test`, `R2SmokeTestCommandTest`, `R2StorageServiceTest` | 14 | `setup.sh` does not install `league/flysystem-aws-s3-v3`/`predis/predis` (`Class "Aws\Exception\AwsException" not found`) — MOBILE-PREVIEW-6 §9a |
| `AuthRecoveryTest` | 9 | `setup.sh` does not copy `app/Mail/` — MOBILE-PREVIEW-6 §9a. (One additional case beyond MP-8's own count of 8 traces to a new diagnostic-logging line added by an unrelated, already-merged PR, `63cf51e`, not to anything in this task's diff.) |
| `Fuel*ServiceTest`/`FuelReconciliationTest`/`FuelSupplyReceiving*Test`/`FuelAviRfidServiceTest`/`FuelSaleApiTest` | 26 | This sandbox's base PHP 8.4 install is missing the `bcmath` extension — MOBILE-PREVIEW-8 §9.3 |
| `ProductOptionValueVisualTest`, `DocumentCenterSecureIntakeTest` | 6 | Same sandbox missing the `gd` extension — MOBILE-PREVIEW-8 §9.3 |

No repository file (including `setup.sh`) was changed to investigate or characterize this, matching
MOBILE-PREVIEW-6/8's own precedent of diagnosing local-sandbox-only gaps without touching the
shipped install script. This full-suite run satisfies this repository's own mandatory pre-PR gate
(`php artisan test`, no `--filter`, full run) for this task's diff, which is itself documentation-only and could not plausibly introduce any of the 55 pre-existing failures above.

### 8.4 Web / mobile

Not re-run in full by this task: this closure task changes no web/mobile source file, and MP-8
already re-ran the full web suite (2440 tests) and confirmed the Dart suite via CI (460/460) at a
base commit one PR before this one — nothing in this PR's diff (a documentation file) can affect
either. Full CI (§14) re-confirms `ci.yml`'s backend suite on the PR itself; `web-ci.yml`/
`mobile-ci.yml` are path-filtered to `web/**`/`mobile/**`/`contracts/app-builder/**` (confirmed by
direct inspection of their `on.pull_request.paths` triggers) and correctly will not run against a
docs-only diff — consistent with, not a gap introduced by, this task.

### 8.5 Real-device / emulator / simulator execution

**Not performed.** No Flutter SDK, Android SDK/emulator, or Xcode/iOS Simulator exists in this
sandbox (re-confirmed: `which flutter dart adb emulator xcrun simctl avdmanager sdkmanager` all
empty; `$ANDROID_HOME`/`$ANDROID_SDK_ROOT` unset). This matches every prior MP-4/6/7/8 report's own
identical limitation. No claim of "real-device verified" or "emulator verified" is made anywhere in
this report.

---

## 9. Regression / backward-compatibility proof

Narrowest necessary checks, per the task's own instruction not to reopen unrelated
setup/environment defects:

| Check | Result |
|---|---|
| Production `mobile/lib/main.dart` unchanged in behavior | **CODE** — confirmed byte-identical this session: 7 lines, `runApp(const AwjMobileRuntimeApp())`, no preview import |
| Design Canvas remains available | **CODE** — the Design/App Preview switch (MP-3) is additive; the pre-existing Canvas route/component is untouched |
| Browser App Preview remains distinct | **CODE** — explicit truth badge, non-editing chrome removed only while Preview is active (MP-3) |
| Published Experience runtime remains unchanged | **CODE** — zero diff to `CommerceExperienceController`/`BuilderPublishedExperienceVersion` across MP-5–MP-8 (confirmed by source read this session) |
| Default AWJ Experience remains unchanged | **CODE** — no MP-3–MP-8 diff touches the bundled default-experience path |
| Last Known Good behavior remains unchanged | **CODE** — no diff to that subsystem across any MP task |
| No preview flow publishes Draft | **TEST** — re-run green this session (§8.1–§8.2) |
| Preview auth cannot access merchant admin / commerce / customer surfaces | **TEST** — `a_preview_token_cannot_reach_merchant_admin_routes`/`..._commerce_v1` re-run green this session |
| Tenant Isolation remains fail-closed | **TEST** — cross-tenant/cross-app suites re-run green this session, both databases |
| No accounting/financial code path changed | **CODE** — `grep` across every `Preview*.php` file confirms no call to `LedgerService::post`/`journal_entries`/`journal_lines` (re-confirmed this session); this closure task itself adds no application code at all |

No unrelated setup/environment defect was reopened or re-investigated by this task (the
already-documented `setup.sh` `app/Mail`/AWS-SDK gap from MOBILE-PREVIEW-6 §9a remains a separate,
untouched follow-up item, not addressed here, per the task's explicit instruction not to modify
`setup.sh` or fix unrelated issues).

---

## 10. Operational readiness checklist

| Item | Status |
|---|---|
| Real preview domain provisioned | **Hostname decided (`preview.awjdev.xyz`, §4) — provisioning itself not yet authorized** |
| HTTPS routing for that domain | **Deferred — depends on the still-open hosting-target choice (§4.2)** |
| `apple-app-site-association` hosted at `/.well-known/` | **Deferred — cannot exist before provisioning is authorized and performed** |
| `.well-known/assetlinks.json` with correct SHA-256 fingerprint | **Deferred — packaging identity is now fixed (Option A, §3), so the app identity to fingerprint is known; the signing identity itself is still undecided** |
| Android `applicationId`/iOS bundle-ID separation for device-preview coexistence | **Resolved — Option A approved (§3): no separation, run `main_device_preview.dart` standalone** |
| Signing/provisioning for whichever build runs on physical devices | **Deferred — explicitly out of this Horizon's scope until separately approved** |
| `PREVIEW_DEEP_LINK_HOST` env wiring | **Code complete; target value decided (`preview.awjdev.xyz`) but not yet set — wiring the real value before the domain resolves would break the deep link** |
| Logging/redaction policy at the reverse-proxy/CDN layer | **Specified (§4.2), not yet implementable — no infrastructure exists to configure** |
| Minimal safe browser-fallback page | **Specified (§4.2), not built — needs hosting-target selection and provisioning authorization first** |
| Real-device/emulator execution of the full matrix | **No longer Decision-Gate-blocked — both gates resolved. Still environment-gated (no toolchain in any sandbox this Horizon has used) and, for the domain-dependent parts (real App Link/Universal Link verification), still blocked on provisioning** |
| Backend code (issuance, exchange, fetch, revoke, audit, rate limits) | **Code complete**, re-verified this session |
| Mobile code (deep-link resolution, exchange client, device-preview app, runtime rendering reuse) | **Code complete**, re-verified this session; zero changes in MP-9 |
| Web code (QR issuance UX, countdown, expired/consumed/regenerate states, i18n parity) | **Code complete**, zero changes in MP-9 |
| Backend automated test coverage | **Code complete** — 35 tests across 4 files, all green on SQLite + real PostgreSQL 16, reconfirmed this session |
| Mobile automated test coverage | **Code complete per source; execution deferred to `mobile-ci.yml`**, unchanged by this task |

---

## 11. Known limitations (carried forward, none newly introduced by MP-9)

1. `preview/v1` does not re-check `EnsureActiveSubscription`/`ApplicationCatalog` state on every
   fetch — bounded by the ≤15-minute default TTL.
2. `PreviewActionHandler.onNavigate`'s allowlist (`home`/`cart`) must be kept in lockstep with the
   real runtime's own navigation surface as it grows.
3. `source = published`/`source = default` remain unimplemented for both direct issuance and
   exchange.
4. The web QR dialog's "consumed" indicator is best-effort (infers from a session-list length
   increase), not an authoritative reference↔session correlation.
5. No dedicated "revoke this exchange reference" action — an unscanned reference simply expires
   in 5 minutes.
6. ~~No Android/iOS build-flavor separation (§3)~~ — **resolved**: owner approved Option A
   (no separation; run `main_device_preview.dart` standalone). Merchant-realistic
   production+preview side-by-side coexistence remains unsupported by design, not by omission.
7. No real preview domain/hosting/association files provisioned yet (§4) — hostname is now decided
   (`preview.awjdev.xyz`), but DNS/hosting/AASA/`assetlinks.json` remain unprovisioned by explicit
   owner instruction, so real-device link verification still cannot succeed today.
8. **Real-device/emulator execution has never happened for this feature, at any MP stage** — every
   report from MP-4 through this MP-9 session has honestly recorded "no Flutter toolchain in this
   sandbox." This is the single largest gap between "code/CI proof" and the Horizon's own exit
   criterion 10.
9. Empty-cart/empty-list sample-data preview state remains undemonstrable with today's always-non-empty sample data (MP-4, unsolved, non-blocking).

---

## 12. Explicitly deferred — signing / TestFlight / Play / App Store

Unchanged, and **not addressed, revisited, or brought closer by this task**: mobile app signing
automation, TestFlight submission, Google Play Console submission, App Store/Google Play binary
distribution, and any Production release/deploy pipeline. None of these is authorized by this
Horizon at any point without a separate, explicit owner approval — this closure report does not
open that door.

---

## 13. Owner Decision Gates and their disposition

| Gate | Raised by | Disposition at MP-9 closure |
|---|---|---|
| Preview Session security architecture (session issuer, credential shape, scope, TTL, etc.) | MP-5 | **Resolved — PASS.** Implemented exactly as designed in MP-6/7, re-verified this session. No re-litigation needed. |
| Build-flavor / `applicationId`/bundle-ID packaging separation | First surfaced MP-7 §15.2, formally opened MP-8 §5.3/§11 | **RESOLVED — owner approved Option A** (2026-09-30): run `main_device_preview.dart` standalone; no flavor/applicationId/bundle-ID/scheme/native-target change authorized or made. §3. |
| Preview domain / hosting / AASA / assetlinks | First surfaced MP-5/MP-7, formally opened MP-8 §2/§10 | **PARTIALLY RESOLVED — owner approved hostname** (2026-09-30): `preview.awjdev.xyz`. Hosting-target selection, signing identity, and provisioning authorization remain open as separate, non-identity follow-up items. §4. |
| URL/reference security design (one-time-reference-in-path) | MP-7, reviewed again MP-8 §3 | **Re-confirmed APPROVED AS-IS this session** — no new evidence surfaced that the design itself is unsafe; not re-opened as a gate. |

**Both Decision Gates that previously blocked closure (packaging, domain identity) are now resolved
by the owner's explicit choices, recorded above.** What remains — provisioning the approved domain,
and executing real-device verification — is operational/environment work, not a further decision,
except for the still-separate hosting-target/signing/provisioning-authorization items named in §4.3.

---

## 14. CI

Every commit pushed on this branch has run `ci.yml` (backend, sqlite + pgsql, no path filter) and
returned green (`conclusion: success`), including the prior heads that carried the full-suite
reconfirmation (§8.3) and the exit-criteria-count fix. This revision (owner-decision update, docs
only) is expected to be green on the same basis; `web-ci.yml`/`mobile-ci.yml` (both
path-filtered to `web/**`/`mobile/**`/`contracts/app-builder/**`) are expected **not** to trigger,
since this PR touches only `docs/plans/app-builder/`.

---

## 15. Next recommended Horizon

Both Decision Gates are now resolved (§3, §4). Remaining work is operational/environment execution,
not further decisions:

1. **Immediate, whenever the owner separately authorizes it**: provision `preview.awjdev.xyz` —
   DNS, HTTPS routing, hosting-target selection (§4.2), `apple-app-site-association`,
   `assetlinks.json` (needs a signing identity decided first), and the minimal fallback page to the
   policy already specified (§4.2). This is a distinct authorization from today's hostname approval.
2. **In parallel or after**: whichever engineer/session has access to a real Flutter/Android/Xcode
   toolchain (a local development machine, or an extended CI job that boots an emulator/simulator)
   runs `main_device_preview.dart` standalone (Option A, §3) through the existing, already-written
   real-device matrix — no new application code should be required, only execution and honest
   recording of the result. Cold-start/warm-start/wrong-host/expired/consumed/exchange/snapshot/
   revoke checks (§3.2) do not require the domain to be provisioned first (they can run with a
   directly-invoked dev build); only genuine App-Link/Universal-Link **verification** specifically
   needs step 1 done first.
3. **After criterion 10 closes** (genuine Android + iOS device execution recorded): re-issue this
   closure report (or a short MP-10 addendum) to move the Horizon from B to CLOSED/PASS — no other
   criterion is expected to require new work at that point.
4. **Separately, unrelated to this Horizon**: the `setup.sh` drift documented since MOBILE-PREVIEW-6
   §9a (`app/Mail` copy, AWS SDK/Redis composer packages) remains open and safe to schedule
   independently at any time.
5. **Not recommended before the above**: starting a new Horizon-scale App Builder initiative while
   criterion 10 remains open — the Horizon's own exit criteria treat real-device proof as mandatory,
   not optional polish.
