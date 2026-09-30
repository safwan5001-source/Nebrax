# MOBILE-PREVIEW-8 — Claude Code Task

## Goal
Close the Real Mobile Preview horizon with **integrated proof and real-device verification** across the already-merged MP-5/6/7 architecture.

MP-8 is primarily a verification/integration task. Do not redesign the preview system unless a proven blocker requires a Decision Gate.

The proof must cover the real chain:

Merchant Builder → one-time QR/deep link → device handoff → one-time exchange → PreviewSession → preview/v1 experience → real Flutter compatibility/hydration/render path.

## Start
- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Baseline at task creation:
  `929e978cf5bbc42bcd4ebe09b71d7191aa8e559b`
- Verify and report exact Base SHA.

## Read first
- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-6-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-7-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md`

Inspect only the code needed to verify the merged flow:
- PreviewSession auth/fetch
- PreviewExchangeReference issuance/exchange
- QR/deep-link Builder UI
- Flutter device preview entry point
- Android/iOS link association config
- logging / access-log exposure
- runtime compatibility/hydration/render path

Do not broadly rediscover the repo.

## Verification principle
This task must distinguish clearly between:
1. **Code/CI proof** — automated evidence inside the repo.
2. **Operational proof** — domain association / hosting / routing evidence.
3. **Real-device proof** — actual iOS/Android device behavior.
4. **Deferred production gates** — anything that cannot be truthfully proven without signing, a real domain, or Production deployment.

Never label something "verified" if only code inspection proves it.

## Mandatory evidence pass
Use current official sources where needed:
- Apple Universal Links / AASA
- Android App Links / assetlinks.json
- Flutter deep-link handling
- OWASP / HTTP security guidance relevant to secrets in URLs/logs/history/referrers
- platform guidance for testing app links/universal links on real devices

Format:
`External Evidence → AWJ Verification Requirement → Observed Result`

External UX benchmarks (Salla/Zid/Shopify) may be used only if they help evaluate the merchant preview flow. Internal repo docs remain AWJ Source of Truth.

## MP-8 integrated verification scope

### 1. End-to-end contract trace
Trace and document the exact path from the merchant clicking "Preview on phone" to the real Flutter render.

Prove:
- merchant issuance endpoint is RBAC + tenant/app gated;
- QR contains a one-time exchange reference, not a PreviewSession bearer;
- reference is hash-only server-side;
- exchange is one-time and atomic;
- exchanged PreviewSession is `preview:read` only;
- PreviewSession is tenant/app/snapshot-bound;
- Flutter fetches `preview/v1/experience`;
- CompatibilityResolver runs;
- real Component Registry / hydration / ExperienceView path renders;
- Draft remains unpublished;
- no silent fallback to Published on preview auth failure.

### 2. Real domain / association readiness
Determine the exact current state of:
- `PREVIEW_DEEP_LINK_HOST`
- Android App Link host
- iOS Associated Domains host
- `.well-known/assetlinks.json`
- `apple-app-site-association`
- HTTPS routing
- whether the preview host is real or placeholder

If a real public host does not exist or no association files are deployed:
- do not fake a successful universal/app-link verification;
- record the operational gate precisely;
- provide the smallest required deployment/configuration plan;
- do not perform Production DNS/domain changes without explicit owner approval.

### 3. Mandatory URL/logging leakage review
This is a required follow-up from MP-7.

Current QR shape places the one-time reference in the URL path:
`https://<preview-host>/preview/<reference>`

Assess actual exposure risk for:
- reverse-proxy/access logs
- CDN/hosting request logs
- browser history
- HTTP referrer behavior
- crash/error telemetry
- analytics
- redirect chains
- screenshots/QR photographs

Verify the current repo/hosting configuration where possible.

Required decision:
- either prove the current path-based design is acceptably bounded for AWJ because the reference is one-time + 5-minute TTL + not a bearer, with safe logging controls;
- or identify a concrete P1/P2 issue and STOP for a Decision Gate before changing the exchange transport.

Do not silently redesign it.

If mitigation is needed, prefer minimal controls such as:
- no query-string secrets
- immediate native-app handling
- no analytics capture
- redacted access logs
- no redirect propagation
- strict Referrer-Policy on any browser fallback page
- generic fallback page with no credential echo

### 4. Browser fallback behavior
If an app link/universal link does not open the preview app:
- verify what happens in the browser today;
- ensure the raw reference is not echoed into page content, analytics, client logs, or redirects;
- define/implement the minimum safe fallback only if it is in-scope and does not require Production deployment;
- otherwise document the operational requirement.

Do not create a public long-lived preview page.

### 5. Real-device testability
Determine whether the current project can actually install/run the device-preview entry point on a physical device.

Verify:
- Android build command/entry point
- iOS build command/entry point
- package/bundle identifier behavior
- current shared target limitation
- whether production runtime and preview runtime can coexist side-by-side
- whether a developer can manually launch `main_device_preview.dart`
- whether a real link can reach that entry point

If build flavors / separate applicationId / bundle ID are strictly required for the real-device proof, classify whether:
A. a minimal test-only flavor is safe and in-scope, or
B. it is a material product/distribution change requiring a Decision Gate.

Do not add signing/TestFlight/Play distribution.

### 6. Real-device verification matrix
Where tooling/environment permits, execute a real-device or emulator/simulator proof.

Minimum matrix:
- Android cold-start from valid preview link
- Android warm-start from valid preview link
- invalid/wrong-host link ignored
- expired exchange shows controlled state
- already-consumed exchange shows controlled state
- successful exchange reaches real PreviewRuntimeView
- immutable Draft snapshot renders
- later Draft edit does not mutate current device preview
- regenerated QR can open a newer snapshot
- revoked/expired PreviewSession fails closed
- no Published mutation

For iOS:
- run equivalent checks on real device/simulator where technically possible;
- if Universal Link verification cannot be proven without a real signed associated-domain setup, state exactly what is code-proven vs operationally unproven.

No claim of "real-device verified" without actual device/emulator evidence.

### 7. Integrated automated proof
Add only the missing automated tests necessary to prove the full chain.

Prefer integration tests that reuse existing services/routes rather than duplicate MP-6/7 unit tests.

Target proofs:
- issue exchange reference → exchange → fetch experience → snapshot marker rendered/consumed by runtime-facing contract
- replay denied
- cross-tenant/cross-app isolation
- Draft != Published
- stale Draft advisory behavior
- expired/revoked session failure
- no token/reference leakage
- normal production runtime path unaffected

Avoid redundant test explosion.

### 8. Merchant UX verification
Verify the current Builder "Preview on phone" UX against the approved MP-1 benchmark and AWJ design principles.

Check:
- clear action
- QR readable
- temporary/one-time copy clear
- countdown
- expired state
- regenerate
- connected/consumed state honesty
- RTL/LTR
- desktop/mobile-admin responsiveness
- no raw PreviewSession bearer in normal merchant flow
- no unsupported success claims

Do not redesign unless a real usability bug is found.

### 9. Production/runtime isolation
Prove:
- production `main.dart` behavior remains unchanged;
- device preview entry point is additive;
- normal Commerce API auth remains separate;
- PreviewSession cannot reach admin/commerce/customer/platform surfaces;
- preview code does not alter accounting/financial behavior;
- no Tenant Isolation weakening.

### 10. Operational readiness checklist
Produce a concrete checklist for what is still required before a true external real-device preview can be enabled:
- real preview domain
- HTTPS
- AASA
- assetlinks.json
- package/bundle IDs / fingerprints
- signing where required
- environment values
- logging/redaction policy
- routing/fallback policy
- rollout verification

Clearly mark each item:
`Code complete / Operationally gated / Requires owner approval / Deferred`

## Tests / verification
Run progressively:
1. focused backend PreviewSession + PreviewExchange tests on sqlite
2. focused pgsql security/concurrency tests
3. focused Flutter preview/deep-link tests
4. focused web QR tests
5. any new integrated proof tests
6. full backend sqlite + pgsql
7. mobile analyze + test
8. Android/iOS build proofs
9. full web tests + production build
10. real-device/emulator proof if environment permits
11. full CI

Do not reduce coverage for auth/security/Tenant Isolation.

## Decision Gates
STOP and report before implementation if MP-8 requires:
- changing QR to carry a PreviewSession bearer
- weakening one-time exchange semantics
- weakening Tenant Isolation/RBAC
- forwarding merchant/admin/store tokens
- changing public App Schema
- material runtime redesign
- Production DNS/domain changes
- deploying association files to Production
- signing/provisioning/TestFlight/Play/App Store work
- creating a new long-lived public preview surface
- weakening logging/security controls
- major build-flavor/product packaging changes

## Explicit non-goals
- no Production deploy
- no DNS changes without owner approval
- no App Store / Play submission
- no signing automation
- no Flutter Web
- no customer identity expansion
- no unrelated Store Customizer work
- no unrelated setup/build drift fixes
- no new live commerce/customer data in Preview

## Branch / PR
Use one branch:
`test/mobile-preview-8-integrated-proof`

Open one PR:
`test(app-builder): MOBILE-PREVIEW-8 integrated real-device proof`

## Horizon workflow
latest main → evidence/operational trace → integrated automated proof → real-device/emulator verification where possible → focused fixes only → PR → CI → owner review.

Stop before merge unless explicit approval exists.

No Deploy. No Production.

## Final report
Create:
`docs/plans/app-builder/MOBILE-PREVIEW-8-INTEGRATED-PROOF-REPORT.md`

Include:
- Base / Head SHA
- Branch / PR
- code/CI vs operational vs real-device evidence separation
- end-to-end contract trace
- domain association status
- URL/logging leakage assessment
- browser fallback result
- device-installability result
- Android/iOS real-device matrix
- automated integration proof
- Tenant Isolation / auth isolation proof
- Draft != Published proof
- UX verification
- tests/build/CI
- operational readiness checklist
- Decision Gate status
- unresolved risks
- exact items deferred to MP-9 closure
- recommendation for horizon closure
