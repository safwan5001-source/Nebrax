# MOBILE-PREVIEW-5 — Claude Code Task

## Goal
Produce the **Preview Session Security Architecture** for AWJ Real Mobile Preview.

This is a **mandatory Decision Gate** before any preview-session token, browser real-runtime preview, QR/deep-link preview, or physical-device preview implementation.

**This task is architecture/evidence only. Do not implement the token/session system.**

## Start
- Repository: `safwan5001-source/Nebrax`
- Start from latest `origin/main`.
- Baseline at task creation:
  `c99602a5e6d64f8840ec57c4ccbe747664eac2b9`
- Verify and report the exact Base SHA before work.

## Read first
Read only the relevant App Builder / Runtime material:
- `docs/plans/app-builder/AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md`
- `docs/plans/app-builder/REAL-MOBILE-PREVIEW-3-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/MOBILE-PREVIEW-4-IMPLEMENTATION-REPORT.md`
- `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md`

Also inspect only the current auth/runtime code needed to answer the security questions:
- merchant web authentication/session boundaries
- current Commerce/mobile authentication
- runtime experience fetch
- Draft / Published handling
- tenant resolution
- relevant token issuance/revocation patterns already present in AWJ

Do not perform broad repo rediscovery.

## Evidence-first requirement
Before fixing the architecture, do a concise official-source security evidence pass.

Prefer:
- OWASP guidance relevant to bearer tokens/session management/API security
- IETF/OAuth standards relevant to short-lived scoped bearer or proof-of-possession style access, where applicable
- Apple Universal Links / associated domains
- Android App Links
- Flutter deep-link/runtime constraints
- official platform guidance for QR/deep-link preview flows when relevant

Competitor UX references such as Salla/Shopify may inform the merchant flow, but **do not infer their private credential architecture**.

Record findings as:
**External Evidence → AWJ Security Decision → Rationale**

## Questions that MUST be decided

### 1. Session issuer
Decide which trusted AWJ backend issues preview sessions.

The browser must not mint or self-sign preview credentials.

### 2. Credential shape
Decide:
- opaque random token vs signed token
- whether a server-side session record is required
- whether token identifiers/hashes are persisted
- how revocation works
- why the chosen shape fits AWJ

Do not expose long-lived credentials.

### 3. Scope
A preview credential must be narrowly scoped.

Decide the exact scope dimensions, including at minimum:
- tenant
- Builder App
- preview channel/purpose
- draft snapshot/revision
- allowed runtime/read capabilities
- optional device/session identifier if justified

Explicitly state what it **cannot** do.

### 4. Tenant Isolation
Define and prove the intended tenant isolation semantics:
- token/session belongs to exactly one tenant
- cross-tenant lookup/use fails safely
- no existence leakage
- no token can be re-targeted to another tenant/app
- tenant resolution and credential scope cannot disagree silently

### 5. Draft snapshot / revision binding
Decide whether preview points to:
- mutable Draft, or
- immutable preview snapshot/revision

Prefer reproducibility and security.

Define:
- creation
- refresh/version behavior
- stale session behavior
- Draft changes while preview is open
- guarantee that Preview never publishes Draft

### 6. TTL
Choose a short default TTL and a maximum TTL.

State why.

Do not use indefinite preview credentials.

### 7. Revocation
Define:
- manual revoke
- automatic expiry
- app/session replacement behavior
- revoke-all-for-app / revoke-all-for-tenant if justified
- what the client sees after revocation

### 8. Replay behavior
Decide whether credentials are:
- reusable during TTL, or
- constrained further by one-time exchange / device binding / nonce

Document the trade-off.

Do not invent complex crypto if ordinary short-lived scoped sessions are enough.

### 9. Browser vs physical-device contract
Decide whether:
- Browser Real Runtime Preview
- Physical Device Preview

share the same session contract or use separate grants.

Explain why.

### 10. QR / deep-link transport
Define what the QR/deep link contains.

It must **not** contain:
- merchant admin auth
- long-lived store bearer
- secrets unrelated to preview

Prefer a short-lived preview reference or exchange code if safer.

Define accidental sharing behavior.

### 11. Runtime data access
Define exactly what commerce/runtime data a preview session may access.

Separate:
- Experience/schema payload
- safe catalog/read data
- customer/private data
- cart mutations
- orders/account identity
- admin data

Anything not explicitly approved should fail closed.

### 12. Audit / observability
Define minimum audit events:
- created
- opened/exchanged
- refreshed
- revoked
- expired
- rejected cross-tenant / wrong-app / wrong-scope attempts

Do not log raw credentials.

### 13. Rate limiting / abuse controls
Define issuance and consumption limits sufficient to reduce brute force / link spraying / abuse without damaging normal preview UX.

### 14. Storage
Decide where the server-side preview session/snapshot metadata lives.

If a DB migration/schema change would be needed later, document it only.
**Do not implement migrations in MP-5.**

### 15. Failure semantics
Define safe user/runtime behavior for:
- expired
- revoked
- unknown
- wrong tenant
- wrong app
- stale snapshot
- incompatible schema
- unavailable backend

No silent fallback to Published if that could misrepresent Draft Preview.

## Threat model
The architecture report must include at least:
- stolen/shared QR link
- leaked browser history/referrer
- token replay
- cross-tenant substitution
- app-id tampering
- draft revision tampering
- privilege escalation toward admin APIs
- using a preview token as a normal storefront token
- long-lived token leakage
- log leakage
- race between refresh/revoke/open
- malicious/unsupported schema behavior
- expired/revoked token still cached on device

For each:
**Threat → Control → Residual Risk**

## Required negative tests — design now, implementation later
Specify test cases for future MP-6/7/8, including:
- tenant A token cannot access tenant B
- app A token cannot access app B
- expired token rejected
- revoked token rejected
- malformed/unknown token rejected
- wrong draft revision rejected
- Preview does not mutate Published
- token cannot call admin endpoints
- token cannot obtain broader Commerce access than its scope
- raw credential never appears in logs
- repeated QR use follows the approved replay policy

## UX security behavior
Define merchant-facing states:
- session creating
- ready
- expires at / expires in
- refresh/regenerate
- revoke
- expired
- revoked
- unavailable
- incompatible

Security copy should be clear and not expose internal credential details.

## Decision Gate rules
STOP and report before implementation if the proposed architecture requires any of:
- forwarding admin/Sanctum credentials to mobile/browser runtime
- exposing current store bearer tokens
- weakening Tenant Isolation
- weakening RBAC or Commerce authorization
- public App Schema changes
- publishing Draft to make Preview work
- long-lived reusable credentials
- arbitrary executable merchant code
- material redesign of mobile auth/runtime
- signing/TestFlight/Play/App Store/Production work

## Explicit non-goals
Do not implement:
- controllers/routes for preview sessions
- token issuance code
- migrations
- QR UI
- deep links
- Flutter preview-session consumer
- browser Flutter Web runtime
- physical-device preview
- customer identity/login
- app-store distribution
- Production deploy

## Deliverables
Create:

1. `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`
2. Update `docs/plans/app-builder/APP-BUILDER-BENCHMARK-MATRIX.md` only if durable UX/security benchmark findings are worth retaining.

The architecture document must contain:
- current auth-boundary evidence
- official-source evidence
- chosen architecture
- rejected alternatives and why
- token/session lifecycle
- tenant/app/revision binding
- TTL/revocation/replay
- browser/device relationship
- QR/deep-link transport design
- data-access matrix
- threat model
- audit/rate-limit requirements
- future test matrix
- DB/API impact forecast (documentation only)
- Decision Gate result
- exact implementation boundary for MP-6
- risks/open questions

## Branch / PR
Use one branch:
`docs/mobile-preview-5-security-architecture`

Open one PR:
`docs(app-builder): MOBILE-PREVIEW-5 preview session security architecture`

## Horizon workflow
evidence → auth-boundary trace → threat model → alternatives → AWJ decision → report → PR → CI/findings → ready for owner review.

This task must stop at the **security Decision Gate**.
Do not start MP-6 automatically.

No Merge. No Deploy. No Production.

## Final report
Return Markdown with:
- Base / Head SHA
- Branch / PR
- evidence sources reviewed
- auth boundaries found
- selected architecture
- rejected alternatives
- tenant isolation decision
- credential/session lifecycle
- TTL/revocation/replay decisions
- data-access scope
- threat model summary
- DB/API impact forecast
- tests specified
- CI status
- Decision Gate status
- unresolved risks/questions
- explicit recommendation for MP-6
