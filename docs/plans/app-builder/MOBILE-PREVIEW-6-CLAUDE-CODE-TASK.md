# MOBILE-PREVIEW-6 — Claude Code Task

## Goal
Implement **Real Runtime Preview** using the approved MOBILE-PREVIEW-5 security architecture.

This is the first implementation slice that may add the preview-session backend and wire the real Flutter runtime to consume it.

Do **not** redesign MP-5. Implement the approved contract faithfully.

## Start
- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Baseline at task creation:
  `a774fa9afaf465bfbcf01443c1c5251ea457901b`
- Verify and report exact Base SHA.

## Read first
- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-4-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md`
- `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md`

Inspect only the auth/runtime/model/routes/tests needed for MP-6. Do not broadly rediscover the repo.

## Mandatory first decision — RBAC for Preview Session issuance
Before writing the issuance endpoint, inspect the current Builder permissions and decide the narrowest existing or new permission that correctly represents:

> "may create a runtime preview session for an unpublished Draft"

Do **not** silently reuse `apps_builder.view` unless evidence proves it is semantically appropriate.

If a new permission is needed:
- document why;
- preserve backward compatibility;
- add focused RBAC tests;
- do not broaden existing roles implicitly.

If this materially changes the approved security model, STOP at a Decision Gate before implementation.

## Approved MP-5 architecture — MUST PRESERVE
Implement these decisions unless a proven blocker requires owner review:

- New `PreviewSession` authentication principal.
- Opaque random bearer credential.
- Sanctum-compatible hashed storage; raw bearer shown once only.
- Single narrow runtime ability: `preview:read`.
- One tenant per session.
- One Builder App per session.
- Bound to one immutable Draft snapshot/revision.
- Default TTL 15 minutes.
- Hard maximum TTL 60 minutes.
- Revocable.
- Working session reusable only within TTL.
- Preview runtime surface stays separate from `commerce/v1`.
- Preview must not require or expose store bearer credentials.
- Preview must not forward merchant/admin auth.
- No tenant/app identifier is trusted from client request parameters after authentication.
- No fallback from invalid/expired preview to Published that could misrepresent Draft.
- QR/deep-link one-time exchange design remains MP-7 unless a minimal internal exchange primitive is strictly required by MP-6; if so, STOP and report before expanding scope.

## MP-6 implementation scope

### 1. Persistence
Implement the minimum approved persistence for:
- preview sessions
- immutable snapshot payload/reference
- audit/session metadata required by MP-5

Use the architecture report as source of truth.

Do not add unrelated schema changes.

### 2. Preview session issuance
Create the merchant-authenticated endpoint/service that:
- requires the approved Builder preview permission;
- resolves tenant from authenticated merchant context;
- resolves the target Builder App inside that tenant;
- snapshots the current Draft immutably;
- issues the opaque PreviewSession credential;
- persists only hashed token material;
- returns raw credential once;
- returns expiry metadata;
- never publishes Draft.

### 3. Preview runtime authentication
Add the narrow preview auth path:
- authenticate PreviewSession token;
- verify not expired/revoked;
- bind tenant from the authenticated session record;
- bind app/snapshot from session record;
- apply only `preview:read`;
- fail closed on mismatch/invalid state.

Do not route this through current store bearer auth.

### 4. Preview runtime fetch surface
Add the minimum `preview/v1` read endpoint(s) needed by the actual Flutter runtime to obtain:
- the bound immutable experience/schema snapshot;
- only explicitly approved safe preview metadata.

Do not expose admin data, customer identity, orders, or cart mutation.

### 5. Flutter real-runtime wiring
Wire the actual Flutter runtime to:
- accept a PreviewSession credential through a safe development/preview entry path;
- fetch from `preview/v1`;
- run the actual compatibility resolver;
- use the actual runtime registry;
- use the actual hydration/render path;
- show controlled unavailable/expired/revoked/incompatible states.

Do not build Flutter Web in MP-6.

Do not implement QR/open-on-phone UX in MP-6.

### 6. Draft snapshot behavior
Prove:
- Draft changes after session creation do not mutate the existing session snapshot;
- a newly issued/refreshed session can point at a newer snapshot;
- Published remains unchanged;
- Default fallback remains unchanged outside preview mode.

### 7. Security / Tenant Isolation
Implement and prove:
- tenant A PreviewSession cannot fetch tenant B;
- app A session cannot be retargeted to app B;
- wrong tenant/app input is not even part of the trusted fetch path;
- expired token rejected;
- revoked token rejected;
- malformed/unknown token rejected;
- token cannot call merchant/admin endpoints;
- token cannot call normal `commerce/v1` endpoints unless separately authenticated there;
- no raw token written to logs.

### 8. Failure semantics
Implement explicit runtime outcomes for:
- expired
- revoked
- unknown
- unavailable backend
- incompatible snapshot
- missing snapshot/session corruption

Do not silently fall back to Published inside Preview.

## Explicitly out of scope
Do not implement:
- QR UI
- user-facing "Preview on phone" flow
- Apple/Android deep-link transport
- one-time exchange UX
- physical-device pairing UX
- Flutter Web embedding
- customer login/identity
- live cart/order/account features
- signing/TestFlight/Play/App Store work
- Production deploy
- unrelated App Builder or Store Customizer refactors

## Tests — minimum bar

### Backend
Focused tests must include:
- issuance permission allowed/denied
- cross-tenant issuance denial
- immutable snapshot creation
- raw bearer returned once / hash persisted
- expiry
- revocation
- cross-tenant runtime fetch denial
- cross-app retargeting impossible
- malformed/unknown token denial
- preview token cannot reach admin routes
- preview token cannot impersonate normal Commerce auth
- Draft != Published proof
- Draft mutation after issuance does not mutate snapshot
- raw credential absent from logs where testable

Run both sqlite and pgsql for the security/tenant-isolation suite.

### Flutter
Add focused tests proving:
- PreviewSession fetch path
- actual CompatibilityResolver used
- actual runtime component registry used
- immutable preview payload rendered
- expired/revoked/unavailable/incompatible states are controlled
- normal Published startup path remains unchanged when preview mode is absent

### Web
Only add/change web code if required for session issuance UX or internal integration.
No broad Builder redesign in MP-6.

## Progressive verification
Run:
1. focused backend security/Tenant Isolation tests;
2. focused Flutter preview tests;
3. relevant broader backend suites;
4. mobile analyze + test;
5. Android/iOS build proof if touched runtime code requires it;
6. web tests/build only if web touched;
7. full CI.

Do not reduce test coverage for auth/security/Tenant Isolation.

## Decision Gates
STOP and report before continuing if implementation requires:
- forwarding admin/Sanctum merchant tokens to Flutter runtime
- exposing store bearer credentials
- weakening Tenant Isolation
- broadening RBAC implicitly
- changing public App Schema
- mutable live-Draft preview pointer instead of immutable snapshot
- long-lived preview credentials
- collapsing `preview/v1` into `commerce/v1`
- arbitrary executable merchant code
- material mobile runtime redesign
- QR/deep-link/physical-device scope expansion
- signing/distribution/Production work

## Branch / PR
Use one branch:
`feat/mobile-preview-6-real-runtime-preview`

Open one PR:
`feat(app-builder): MOBILE-PREVIEW-6 real runtime preview`

## Horizon workflow
latest main → focused evidence/reuse trace → RBAC decision → implementation → focused tests → broader relevant tests/build → PR → CI → fix only in-scope findings → ready for closure.

Stop before merge unless explicit approval exists.

No Deploy. No Production.

## Final report
Create:
`docs/plans/app-builder/MOBILE-PREVIEW-6-IMPLEMENTATION-REPORT.md`

Report:
- Base / Head SHA
- Branch / PR
- RBAC decision and rationale
- exact MP-5 contract implemented
- DB/API changes
- files changed
- backend tests/results
- Flutter tests/results
- mobile/web build results
- CI
- Tenant Isolation proof
- Draft != Published proof
- token leakage/logging proof
- Decision Gate status
- risks/remaining limitations
- explicit MP-7 deferrals
- next step
