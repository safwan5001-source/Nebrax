# MOBILE-PREVIEW-7 — Claude Code Task

## Goal
Implement the **merchant-usable physical-device preview handoff** on top of the already-merged MOBILE-PREVIEW-6 runtime preview foundation.

MP-7 adds:
- one-time exchange references,
- QR generation/presentation in the Builder,
- deep-link/app-link transport,
- secure exchange into a short-lived PreviewSession,
- physical-device preview entry wiring.

Do **not** redesign the MP-5 security model or MP-6 runtime.

## Start
- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Baseline at task creation:
  `2c7c717a9e63d1a691dca1885bdf414510cc27e3`
- Verify and report exact Base SHA.

## Read first
- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-6-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md`
- `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md`

Inspect only the code needed for:
- PreviewSession issuance/fetch,
- existing deep-link resolver,
- Flutter app-link/deep-link handling,
- Builder detail/builder preview UX,
- tenant/app/runtime security boundaries.

Do not broadly rediscover the repository.

## Mandatory evidence pass
Before implementation, verify current official guidance relevant to:
- Apple Universal Links / associated domains
- Android App Links / asset links
- Flutter deep-link handling
- OWASP guidance for bearer/session leakage via URLs/history/referrer
- RFC / OAuth guidance relevant to short-lived one-time device/browser exchange codes

Use the format:
`External Evidence → AWJ Decision → Rationale`

Competitor UX evidence (Salla/Shopify/Zid) may inform merchant flow, but do **not** infer their private credential architecture.

## Approved security contract — MUST PRESERVE
From MP-5/MP-6:

- PreviewSession is a separate principal.
- Working bearer is opaque, hashed server-side, `preview:read` only.
- Working bearer is never put in QR payloads, deep-link query strings, browser history, logs, or referrers.
- Session is tenant-bound, app-bound, immutable-snapshot-bound, short-lived.
- Preview remains separate from `commerce/v1`.
- No merchant/admin/store bearer may be forwarded to Flutter.
- No client-controlled tenant/app retargeting after authentication.
- Invalid/expired/revoked preview must fail closed.
- Draft preview must never publish Draft.
- QR/device handoff must use a **one-time exchange reference** with a short TTL.
- No long-lived reusable exchange credential.

## MP-7 implementation scope

### 1. One-time exchange persistence
Implement the minimum approved persistence for preview exchange references.

Required properties:
- opaque random reference/code
- hash-only persistence where feasible
- one tenant
- one Builder App
- one target PreviewSession or one immutable Draft snapshot/session-creation intent, according to the approved MP-5 architecture
- created timestamp
- expiry timestamp
- consumed timestamp / single-use state
- optional created_by / device label if already approved
- audit events without raw secret material

Default exchange TTL target: **5 minutes** unless repo evidence requires a smaller safe value.

### 2. Merchant-authenticated exchange creation
Add the minimum merchant endpoint/service to create a one-time exchange reference for an authorized preview.

Requirements:
- same or stricter RBAC boundary as MP-6 preview-session issuance
- tenant/app resolved server-side
- no Draft publication
- no long-lived secret returned
- raw exchange reference returned only once
- appropriate rate limiting
- audit event

### 3. Exchange endpoint
Implement a narrow public/device-facing exchange route under the preview surface, e.g.:
`POST /preview/v1/exchange`

It must:
- accept only the one-time exchange reference;
- atomically consume it;
- reject replay;
- reject expired/revoked/unknown references;
- issue or return the short-lived PreviewSession bearer according to the approved architecture;
- never accept tenant/app IDs as trusted retargeting inputs;
- never expose merchant/admin/store credentials;
- rate-limit abuse;
- avoid raw secret logging.

If the implementation needs to materially diverge from the approved MP-5 exchange model, STOP at a Decision Gate.

### 4. QR payload
The QR code must contain only a safe launch URI/reference.

It must **not** contain:
- PreviewSession bearer
- merchant Sanctum token
- store bearer
- customer token
- admin/platform token
- raw tenant/app credentials
- unnecessary PII

Prefer a compact deep-link / universal-link form that carries the one-time exchange reference only.

Document the exact payload shape.

### 5. Builder UX
Add a merchant-facing flow to the relevant App Builder preview surface.

Minimum UX:
- "Preview on phone" / equivalent action
- session/exchange creation state
- QR display
- explicit expiry countdown/copy
- regenerate/retry
- expired state
- consumed/opened state when observable
- revoke/cancel where applicable
- clear note that the QR is temporary
- no raw PreviewSession bearer shown to merchants in the normal QR flow

Reuse AWJ design system components. Keep it dense, clear, accounting-product-grade, not flashy.

Do not redesign the overall Builder.

### 6. Flutter physical-device handoff
Wire the actual mobile preview app/runtime to:
- receive the approved deep link/app link;
- extract the one-time exchange reference;
- exchange it over HTTPS;
- receive the short-lived PreviewSession credential;
- keep the credential out of URL/history after exchange;
- start the real MP-6 Preview runtime;
- reuse the real CompatibilityResolver / Component Registry / hydration / ExperienceView path;
- show controlled states for expired/used/invalid exchange.

Do not fork the runtime contract.

### 7. Deep-link platform configuration
Add only the minimum development/preview configuration required for:
- iOS Universal Links / associated domains
- Android App Links / intent filters / asset-links assumptions
- Flutter route/deep-link handling

If a real public domain / association file deployment is required but not yet approved or available, implement the code/config boundary and document the operational gate rather than faking Production readiness.

No signing/store distribution.

### 8. Replay and race safety
Prove:
- first valid exchange consumes the reference;
- second use fails;
- concurrent double-exchange cannot mint two usable sessions;
- expired reference fails;
- wrong/malformed reference fails generically;
- consumed reference cannot be reactivated;
- revoke/expiry races are fail-closed.

Use DB transaction/locking or equivalent server-side atomicity.

### 9. Tenant Isolation / cross-app safety
Prove:
- tenant A exchange cannot reveal tenant B data;
- app A exchange cannot be retargeted to app B;
- no tenant/app identifier is trusted from QR/device request;
- resulting PreviewSession remains scoped exactly as MP-6.

### 10. Logging/privacy
Prove raw exchange references and PreviewSession bearers are absent from:
- audit event payloads
- server logs where testable
- URL query strings if avoidable
- frontend persistent storage
- analytics/event instrumentation

Prefer path fragment or app-link strategy that minimizes browser referrer/history exposure. Document unavoidable residual risk.

## Tests — minimum bar

### Backend
Add focused tests for:
- authorized exchange creation
- unauthorized/RBAC denial
- cross-tenant creation denial
- raw exchange reference returned once
- hash-only/server-safe persistence
- 5-minute expiry behavior
- successful one-time exchange
- replay rejection
- concurrent double-exchange safety
- malformed/unknown/expired/consumed rejection
- cross-tenant/cross-app retarget impossible
- issued PreviewSession has only `preview:read`
- resulting session uses the intended immutable snapshot
- merchant/admin/store tokens never accepted by exchange endpoint
- raw exchange reference absent from audit/log payloads

Run security/Tenant Isolation suite on sqlite and pgsql.

### Flutter
Add focused tests proving:
- deep link parses only approved payload
- malformed/foreign links rejected
- exchange client sends reference only to expected preview endpoint
- bearer never placed back into URI
- successful exchange enters real preview runtime
- expired/consumed/invalid exchange shows controlled UI
- normal production `main.dart` path remains unaffected

### Web
Add focused tests proving:
- QR flow creates exchange reference, not raw PreviewSession bearer
- expiry/regenerate states
- no long-lived secret stored client-side
- no unsupported fake success
- mobile/desktop responsive behavior if touched

### Build / CI
Progressively run:
1. focused backend security tests
2. pgsql focused security tests
3. focused Flutter tests
4. focused web tests
5. relevant backend broader suite
6. mobile analyze + test
7. Android/iOS build proofs
8. web full tests + production build
9. full CI

Do not reduce testing for auth/security/Tenant Isolation.

## Decision Gates
STOP and report before continuing if MP-7 requires:
- placing PreviewSession bearer in QR/deep-link URL
- forwarding merchant/admin/store credentials
- weakening Tenant Isolation
- changing public App Schema
- long-lived exchange/session credentials
- mutable live-Draft pointer replacing immutable snapshot
- collapsing preview routes into `commerce/v1`
- adding executable merchant code
- material redesign of shipped mobile runtime
- Production domain/DNS changes
- signing/TestFlight/Play/App Store work
- Production deployment

## Explicit non-goals
Do not implement:
- Flutter Web
- App Store / Play distribution
- signing/provisioning automation
- customer identity/login
- live orders/account features
- unrelated Store Customizer work
- unrelated setup/build drift fixes
- production deploy
- MP-8 integrated real-device closure evidence beyond what is needed to make MP-7 testable

## Branch / PR
Use one branch:
`feat/mobile-preview-7-qr-exchange`

Open one PR:
`feat(app-builder): MOBILE-PREVIEW-7 QR device preview exchange`

## Horizon workflow
latest main → evidence pass → exact auth/deep-link trace → implementation → focused security tests → mobile/web tests → builds → PR → CI → address only in-scope findings → ready for owner review.

Stop before merge unless explicit approval exists.

No Deploy. No Production.

## Final report
Create:
`docs/plans/app-builder/MOBILE-PREVIEW-7-IMPLEMENTATION-REPORT.md`

Include:
- Base / Head SHA
- Branch / PR
- official evidence reviewed
- exact exchange architecture implemented
- QR payload shape
- deep-link / app-link behavior
- DB/API changes
- files changed
- backend sqlite+pgsql security tests
- replay/concurrency proof
- Tenant Isolation proof
- Flutter tests/builds
- web tests/build
- token/reference leakage proof
- CI
- operational/domain association gates
- Decision Gate status
- risks/remaining limitations
- explicit MP-8 deferrals
- next step
