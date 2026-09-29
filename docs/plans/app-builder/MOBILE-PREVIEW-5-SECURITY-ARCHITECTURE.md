# MOBILE-PREVIEW-5 — Preview Session Security Architecture

**Horizon:** AWJ App Builder — Real Mobile Preview
**Status:** ARCHITECTURE / SECURITY DECISION GATE — **awaiting owner review**
**Repository:** `safwan5001-source/Nebrax`
**Base SHA (latest `origin/main` at task start):** `8a17f7792078f2f59a2408336bc7e488d01e77ef`
**Branch:** `docs/mobile-preview-5-security-architecture`
**Scope:** Architecture and evidence only. **No controllers, routes, migrations, token issuance
code, QR UI, deep links, or Flutter preview consumer are implemented by this task.**

> This document is deliberately conservative: every decision below is justified either by an
> official external source or by an existing, already-shipped AWJ pattern. Where AWJ already has
> a working precedent, this architecture **extends that precedent** rather than inventing a new
> mechanism — per the Horizon's own rule against a second, competing truth.

---

## 0. How to read this document

Each of the task's 15 numbered decisions is answered under §5. Evidence that grounds those
decisions is presented first (§1–§3) so the decisions in §5 can cite it by name instead of
re-arguing it. §6 is the threat model, §7 the future negative-test matrix, §8 the UX states, §9
the data-access matrix, §10 audit/rate-limits, §11 the DB/API impact forecast, §12 rejected
alternatives, §13 the Decision Gate result, §14 the MP-6 implementation boundary, §15 open
questions/risks.

---

## 1. Official-source security evidence pass

Per the task's evidence-first requirement, prefer OWASP/IETF/platform-official sources over
competitor UX inference. All sources below were fetched directly (not recalled from training) on
2026-09-29.

| # | External Evidence (source) | AWJ Security Decision | Rationale |
|---|---|---|---|
| E1 | OWASP Session Management Cheat Sheet: session identifiers need ≥64 bits of entropy from a CSPRNG; session state/meaning belongs server-side, never encoded in the identifier itself. | Preview credential is an opaque, server-random Sanctum personal access token (Sanctum already uses a CSPRNG-backed random secret plus SHA-256 hash storage); no session data is encoded in the token itself — everything lives in the new `preview_sessions` row. | Matches AWJ's own existing token shape (`ApiClient`, `CustomerIdentity`) rather than inventing a self-describing credential. |
| E2 | OWASP Session Management Cheat Sheet: idle timeout 2–5 min for high-value apps, absolute timeout scaled to expected session length; termination must invalidate server-side state, not just the client. | Preview sessions get a short absolute TTL (§5.6) enforced server-side (Sanctum `expires_at` + a mirrored `preview_sessions.expires_at`); revocation deletes the server-side token row, not just a client-side flag. | A preview session is closer to "high-value, short single-purpose action" than to an all-day office session, so the tighter end of OWASP's range applies. |
| E3 | OWASP REST Security Cheat Sheet: credentials/tokens must never appear in a URL (web server/proxy logs capture them); JWT revocation needs a denylist keyed on `jti`/`aud` to work at all. | Bearer token always travels in the `Authorization` header, never a query string; opaque token chosen over a self-contained JWT specifically because Sanctum's DB-row model revokes instantly by deleting the row — no denylist infrastructure to build or forget. | Directly rules out one candidate shape (JWT) in §12. |
| E4 | RFC 6750 (OAuth 2.0 Bearer Token Usage) §5: four token threats (manufacture, disclosure, redirect, replay); tokens intended for a browser client **SHOULD** be short-lived (≤1 hour); bearer tokens **SHOULD NOT** appear in page URLs; TLS is mandatory. | Maximum TTL ceiling of 60 minutes (§5.6); Authorization-header-only transport; TLS assumed for every preview endpoint (same as every other AWJ API surface). | This is the primary basis for the TTL ceiling and the "no token in a link" rule reused from AWJ's own mobile deep-link code (E7). |
| E5 | RFC 8628 (OAuth 2.0 Device Authorization Grant): a device-displayed code, approved on a second trusted device; short `expires_in` (illustrative default 1800s); polling with `slow_down`/`expired_token`; user-code entropy + rate-limiting recommended; recommends displaying context so the approving human can verify what they're approving; explicitly warns about a bystander completing approval faster than the intended user ("session hijacking" via the unsecured display channel). | QR/deep-link transport (§5.10) is modeled as a short-lived, one-time **exchange reference**, not the bearer itself — same "display-then-approve, then exchange" shape, but tightened to a 5-minute reference TTL because AWJ's case has no separate user-approval step (the merchant is already authenticated when they generate the code). | This is the cross-device pattern that legitimizes "put a code in a QR, exchange it for the real credential later" instead of embedding a bearer directly. |
| E6 | OWASP API Security Top 10 — Broken Object Level Authorization (BOLA): comparing a caller's own ID against a requested object ID is not sufficient; enforce authorization on every object access using unpredictable IDs, not client-supplied ones. | The preview fetch/exchange endpoints take **no client-supplied tenant/app/draft identifier at all** — every scope boundary is read from the authenticated token's own server-side row (§5.3–§5.4), so there is no ID parameter left for an attacker to manipulate. | This is stronger than "check the ID matches" — it removes the ID parameter from the request surface entirely, which is the most robust BOLA mitigation available. |
| E7 | Apple Universal Links / associated domains: verification happens via a server-hosted `apple-app-site-association` file; the link itself is only a routing mechanism, and sensitive data belongs in a request made after the app opens, not in the link. Android App Links: an unverified deep link can be intercepted by another app; `assetlinks.json` verification is required before a link can be trusted for anything sensitive; never put a secret in an unverified link. Flutter deep-linking docs: the framework delivers the raw path/URL to the app (`initialRoute`/`pushRoute`/Router); parameter validation is the app's own responsibility. | The preview QR/deep link carries only an opaque, short-lived, one-time reference in the **path**, never in the query string, and never the bearer itself — consistent with both platforms' own guidance that a link is a router, not a credential carrier. | Confirms AWJ's own already-shipped rule in `mobile/lib/deeplink/deep_link_resolver.dart` ("no tokens in deep-link query strings") is exactly the right posture, and extends it rather than contradicting it. |

Competitor UX (Salla/Shopify/Zid), already benchmarked in MP-1/MP-2/MP-3/MP-4, informed nothing in
this security architecture — per the task's own instruction, their private credential design was
not inferred or consulted, and is not the basis for any decision above.

---

## 2. Current auth-boundary evidence (this repository, as of Base SHA)

Traced directly plus verified via an independent Explore pass; every claim below is a fact about
already-shipped code, not a proposal.

### 2.1 Merchant web/admin authentication
- `AuthController::login()`/`register()` issue a Sanctum personal access token via
  `$user->createToken('api', ['*'], now()->addDays(7))` (`app/Http/Controllers/Api/AuthController.php:287`,
  `TOKEN_TTL_DAYS = 7`) — **unrestricted abilities (`['*']`)**, 7-day TTL, plaintext shown once.
  `logout()` deletes `currentAccessToken()`; `resetPassword()` deletes **all** of the user's tokens.
- Tenant is resolved from the authenticated user, never from a client-supplied parameter:
  `SetTenant` middleware (`app/Http/Middleware/SetTenant.php`) reads `$request->user()->tenant_id`,
  cross-checks it against any subdomain-resolved `HostnameTenantContext`, and **fails closed with a
  generic message on any mismatch** — no silent fallback, no existence leakage.
- `TenantScope` (`app/Tenancy/TenantScope.php`) injects `WHERE tenant_id = ?` into every query on a
  model using `BelongsToTenant`, automatically, whenever `TenantContext::has()` is true.
- `web/src/lib/api.ts` stores the token in `localStorage` and sends it as `Authorization: Bearer`.

### 2.2 Existing scoped/short-lived token precedent (the pattern MP-5 extends)
AWJ already has **four** independent Sanctum-authenticatable principal types, each with its own
narrow ability vocabulary — this is a mature, repeated pattern, not a one-off:

| Principal | Ability shape | TTL | Middleware |
|---|---|---|---|
| `User` (merchant) | `['*']` (unrestricted) | 7 days | `SetTenant` + `EnsurePermission:<perm>` |
| `ApiClient` (M2M developer/mobile-store keys) | exact-match `PublicApiScope` enum (`partners:read`, `products:write`, …) — **wildcard explicitly rejected** by `PublicApiScope::sanitize()` | caller-supplied `expiresAt` (`ApiClientKeyService::issueKey()`) | `AuthenticateApiClient` + `EnsureApiScope:<scope>` |
| `CustomerIdentity` (B2B self-service customer) | single fixed ability `customer:access` | 7 days | `EnsureCustomerPrincipal` (`tokenCan('customer:access')`) |
| `PlatformAdministrator` (internal ops console) | `platform:read` / `platform:manage` | 7 days | `EnsurePlatformAdministrator` (`tokenCan($ability)`) |

`AuthenticateApiClient` is the clearest existing precedent for a token bound to exactly one
tenant with fail-safe cross-tenant semantics: it resolves the `ApiClient` row **globally** (bypassing
`TenantScope`, by design, since no tenant context exists yet), then derives tenant **only** from
that row's own `tenant_id` — documented in the class itself as "the client cannot switch its tenant
externally" — and every failure path (missing/expired/wrong-type token, inactive client, inactive
tenant) returns the same generic response, leaking no distinction between "wrong tenant" and
"no such token."

`EnsureApiScope` enforces **exact-match, no-wildcard** ability checks
(`in_array($scope, $granted, true)`) and treats an unrecognized scope name as a configuration error
that fails closed.

### 2.3 Existing non-Sanctum, single-use, hashed token precedent
`auth_action_tokens` (migration `2026_09_12_120000_create_auth_action_tokens_table.php`,
service `AuthRecoveryService`): `tenant_id`, `user_id`, `type`, `token_hash` (SHA-256 hex, 64 chars),
`expires_at` (required), `used_at` (nullable — one-time-use marker). `issue()` invalidates any prior
un-used token of the same type before minting a new one; `consume()` runs inside a transaction with
`lockForUpdate()`, checks hash + expiry + un-used, and additionally re-verifies the token's tenant
against the **current request's hostname-resolved tenant** (`matchesHostname()`) before returning a
user — closing exactly the "tenant resolution and credential scope must not disagree silently" gap
MP-5 is asked to solve for preview sessions too.

A sibling table, `customer_otp_codes`, adds an `attempts` counter and a partial unique index
enforcing "one active code per phone+purpose" at the database level — the repo's existing shape for
rate-limiting a short, guessable, single-use code, which §5.13/§10 reuse for the QR exchange
reference.

### 2.4 Tenant isolation primitives
- `TenantContext` — per-request singleton, no cross-request leakage by construction.
- `TenantScope` — global Eloquent scope, applied only when `TenantContext::has()`.
- `BelongsToTenant` — trait registering `TenantScope` and auto-filling `tenant_id` on create.
- `PublicApiController::assertTenantOwned()` — the repo's own idiom for "resolve strictly inside
  the caller's tenant scope, or return a generic not-found — never a distinguishable 403 vs 404."

### 2.5 Commerce/storefront runtime auth (three parallel, already-independent paths)
1. **B2B self-service customer** (`customer/v1/{tenantSlug}`) — `CustomerIdentity` + `customer:access`.
2. **Public/mobile Commerce API** (`commerce/v1`) — two layers: every route requires
   `AuthenticateApiClient` (the "mobile store bearer"); a customer identity is a **second, optional**
   Sanctum token carried in a separate `X-Customer-Token` header (never `Authorization`, which
   already carries the store bearer).
3. **Anonymous public storefront** (`store/v1`, unrelated `StorefrontPresentation` system) — no
   auth at all; tenant resolved purely from the `Host` header.

None of these three is a fit for Draft App Builder preview: (1)/(3) have no concept of App Builder
experiences at all; (2)'s `GET commerce/v1/experience` (`CommerceExperienceController::show()`)
**requires the ApiClient store bearer** and **only ever returns the latest `BuilderPublishedExperienceVersion`** — it has no Draft path, and layering Draft preview onto it would force every
Browser/Device Preview client to first be provisioned with a real store bearer, which is exactly
the hard boundary MP-2's evidence flagged as unacceptable (`runtime_config.dart` embeds
`COMMERCE_STORE_BEARER_TOKEN`; embedding it in a browser-delivered bundle is unacceptable). **§5.1
below deliberately keeps preview sessions on their own route surface, outside `commerce/v1`,
specifically to avoid this coupling.**

### 2.6 Draft vs. Published domain model (App Builder — the system MP-5 concerns)
- `BuilderDraftExperience` — **exactly one row per `builder_app_id`** (`unique(builder_app_id)`),
  mutable, with an integer `revision` counter incremented on every save
  (`BuilderDraftExperienceService::save()`: `'revision' => $draft->revision + 1`). No history table —
  saving overwrites the row in place.
- `BuilderPublishedExperienceVersion` — **immutable at the model level**: `booted()` throws
  `LogicException` on any `updating`/`deleting` call, not merely at the service layer. Versions are
  per-app sequential integers (`unique(builder_app_id, version)`), each carrying its own `schema`
  **snapshot** copied at publish time.
- Today's "live experience" policy (`CommerceExperienceController`) is an explicitly-labeled
  temporary heuristic ("most recently published version across all of the tenant's apps") — not a
  concept preview needs to depend on, since preview is scoped to one specific `builder_app_id`
  chosen by the merchant, not "whichever app is live."
- A **separate, unrelated** Draft/Published system exists for the web storefront theme
  (`StorefrontPresentation`/`StorefrontPresentationVersion`, pointer-column-derived status, no
  stored `status` column) — out of scope for MP-5, which concerns the App Builder mobile
  Experience only. Do not conflate the two when implementing MP-6.
- The Draft read endpoint (`BuilderDraftExperienceController::show()`) is merchant-admin-only:
  `auth:sanctum` + `EnsureUserPrincipal` + `SetTenant` + `EnsurePermission('apps_builder.view')` +
  `EnsureCommercialApplicationAccess('commerce.app_builder')`. **There is currently no runtime/
  mobile/browser-reachable endpoint that serves Draft content at all** — this is precisely the gap
  Real Mobile Preview needs to fill, safely.

### 2.7 Existing deep-link precedent (mobile runtime, already shipped)
`mobile/lib/deeplink/deep_link_resolver.dart` — fixed placeholder host
(`awj-runtime-proof.example`, flagged in its own docblock as an open Decision Gate until a real
domain is provisioned), `https`-only, an allowlist of exactly three path shapes
(`home`/`cart`/`product/{id}`), **all query parameters ignored**, with an explicit, already-reviewed
rule stated in the source: *"no tokens in deep-link query strings"* and *"a deep link must never
directly execute destructive/sensitive actions."* Malformed/unrecognized input returns `null` — a
silent, safe no-op, never a crash. No QR-code precedent exists anywhere in the repository outside
ZATCA e-invoice QR (an unrelated tax feature).

---

## 3. Chosen architecture — overview

**A new, dedicated Sanctum-authenticatable principal: `PreviewSession`.**

This is the fifth member of the pattern in §2.2, not a new mechanism:

```
Merchant admin session (Sanctum, ['*'], 7d)
        │  issues (RBAC + commercial-gate checked)
        ▼
PreviewSession row  ── one per issued preview ──►  Sanctum token (tokenable = PreviewSession)
   tenant_id (fixed)                                  ability: preview:read only
   builder_app_id (fixed)                             TTL ≤ 60 min (default 15 min)
   source: draft | published | default
   schema_snapshot (copied at issuance, draft only)
   draft_revision (copied at issuance, draft only)
   published_version_id (published only)
   channel: browser | device
        │
        ▼
New route surface, OUTSIDE commerce/v1 (no ApiClient/store-bearer dependency):
  GET  /preview/v1/experience      — Authorization: Bearer <preview token> only
  POST /preview/v1/exchange        — device channel: one-time reference → preview token
```

Key properties, each justified in §5:
- The browser/device client never mints or self-signs anything — only the Laravel backend, via an
  RBAC- and commercial-entitlement-gated merchant-admin endpoint, issues sessions (§5.1).
- The credential is an opaque Sanctum bearer token with a single non-wildcard ability
  (`preview:read`), following the `ApiClient`/`PublicApiScope` shape exactly, not a self-contained
  JWT (§5.2, §12).
- Scope is exhaustive and fixed at issuance: tenant, app, source, and — for Draft — an immutable
  snapshot, never a live pointer (§5.3, §5.5).
- Tenant isolation reuses `TenantScope`/`SetTenant`'s fail-closed shape via a new, structurally
  identical `SetTenantFromPreviewSession` middleware (§5.4).
- The QR/device flow never puts the bearer in the link — only a one-time, short-lived exchange
  reference, modeled on `auth_action_tokens`/`customer_otp_codes` (§5.10).
- Preview stays entirely off the `commerce/v1` store-bearer-gated surface, so Browser/Device
  Preview never needs a real mobile store bearer provisioned — resolving the exact hard boundary
  MP-2's evidence flagged (§2.5).

---

## 4. Evidence → Decision cross-reference

| Decision area | Grounded in |
|---|---|
| Credential shape (opaque, not JWT) | E1, E3, §2.2, §2.3 |
| TTL ceiling | E2, E4 |
| QR/device exchange, not embedded bearer | E5, E7, §2.7 |
| No client-supplied scope parameters | E6 |
| Tenant isolation fail-closed shape | §2.1, §2.2, §2.4 |
| Draft snapshot immutability | §2.6 |
| Keeping preview off `commerce/v1` | §2.5 |

---

## 5. The 15 required decisions

### 5.1 Session issuer
The Laravel backend — and only the Laravel backend — issues preview sessions, via a new
merchant-admin-authenticated endpoint (future MP-6 surface, not built here) gated exactly like the
existing Draft read endpoint: `auth:sanctum` + `EnsureUserPrincipal` + `SetTenant` +
`EnsurePermission('apps_builder.view')` + `EnsureCommercialApplicationAccess('commerce.app_builder')`.
The browser/mobile client sends a request and receives an opaque token in the response body; it
never constructs, signs, or derives a credential itself. This mirrors every existing AWJ token
issuer (`AuthController`, `ApiClientKeyService`, `CustomerAuthenticationService`,
`PlatformAuthController`) — all server-side, none client-derived.

### 5.2 Credential shape
- **Opaque random Sanctum personal access token**, not a self-contained signed/JWT token.
  Rationale: E3 (JWT revocation needs a denylist keyed on `jti`; Sanctum's DB-row model revokes
  instantly by deleting the row) and E1 (session meaning belongs server-side, not encoded in the
  token). JWT is formally rejected as an alternative in §12.
- **A server-side session record is required** — and is more than "the Sanctum token row." A new
  `PreviewSession` Eloquent model (the row Sanctum's polymorphic `tokenable` points at) carries the
  tenant/app/source/snapshot/channel/audit metadata that Sanctum's own `personal_access_tokens`
  table has no columns for — exactly how `ApiClient`/`CustomerIdentity`/`PlatformAdministrator`
  already work.
- **Token identifiers/hashes**: Sanctum already stores only a SHA-256 hash in
  `personal_access_tokens.hashed_token` (never plaintext); the plaintext is returned exactly once
  at issuance (`NewAccessToken->plainTextToken`) and is never persisted, logged, or reconstructed —
  the same discipline `ApiClientKeyService`'s own docblock states explicitly ("لا يُخزَّن ولا
  يُسجَّل").
- **Revocation**: delete the Sanctum token row(s) for the session (`$session->tokens()->delete()`,
  exactly `ApiClientKeyService::revokeKey()`'s shape) **and** stamp `preview_sessions.revoked_at`,
  so "revoked" is distinguishable from "expired" or "never existed" in the audit trail even though
  both fail identically to a caller (§5.15).
- **Why this shape fits AWJ**: it is the fifth application of a four-times-proven pattern in this
  exact codebase (§2.2), reuses Sanctum's existing hashing/expiry/ability machinery for free, and
  needs zero new cryptographic code — directly satisfying the task's "do not invent complex crypto
  if ordinary short-lived scoped sessions are enough."
- No long-lived credential is ever issued (enforced by §5.6's TTL ceiling, not by client trust).

### 5.3 Scope
A preview credential's scope is **fixed entirely server-side at issuance** and never
client-adjustable:

| Dimension | Value |
|---|---|
| Tenant | exactly one `tenant_id`, set at issuance, never a request parameter |
| Builder App | exactly one `builder_app_id`, set at issuance, never a request parameter |
| Preview channel/purpose | `channel` ∈ {`browser`, `device`}; purpose is fixed to a single value (`app_preview`) in V1 — no other purpose exists yet, so there is nothing to under-scope |
| Draft snapshot/revision | `source` ∈ {`draft`, `published`, `default`}; for `draft`, an immutable `schema_snapshot` + `draft_revision` copied at issuance (§5.5); for `published`, a fixed `published_version_id` |
| Allowed runtime/read capability | a single Sanctum ability, `preview:read` — read-only fetch of the bound snapshot plus whatever client-side sample data Browser Preview already renders (§9) |
| Device/session identifier | optional `device_label` — a merchant-supplied free-text label shown in the revoke UI (e.g. "Safwan's iPhone"); **not** a device fingerprint or hardware-binding mechanism (justified in §5.8) |

**Explicitly cannot:**
- authenticate as the merchant `User` (disjoint tokenable type; `EnsurePermission`/`Rbac::MATRIX`
  never consult a `PreviewSession` token);
- call any `/api/*` merchant-admin route, or any `commerce/v1` route (disjoint guard; no store
  bearer is ever attached to it);
- write to `BuilderDraftExperience` or `BuilderPublishedExperienceVersion` (the ability vocabulary
  contains no write ability, ever — not merely "not granted this time");
- read any other `builder_app_id`, even within the same tenant, or any other tenant's data;
- reach customer PII, orders, cart mutation, or admin dashboards (§9).

### 5.4 Tenant isolation
- **Exactly one tenant per session**: `preview_sessions.tenant_id` is a required, immutable FK, set
  once at issuance from the issuing merchant's own `TenantContext` — identical to how `ApiClient`
  and `CustomerIdentity` rows are tenant-bound today.
- **New middleware, same fail-closed shape as `SetTenant`**: `AuthenticatePreviewSession` (a
  dedicated Sanctum guard resolving `PreviewSession` as the `tokenable`, mirroring
  `AuthenticateApiClient`'s pattern of resolving the row globally — bypassing `TenantScope` — before
  any tenant context exists) followed by `SetTenantFromPreviewSession`, which sets `TenantContext`
  from the resolved session's own `tenant_id` and, if a `HostnameTenantContext` is also present on
  the same request, rejects on any mismatch with the same generic 403 `SetTenant` already uses —
  no silent fallback, ever.
- **Cross-tenant lookup fails safe, with no existence leakage**: once `TenantContext` is set to the
  token's own tenant, every model the fetch endpoint touches (`BuilderApp`,
  `BuilderPublishedExperienceVersion`) is read through ordinary `TenantScope`-scoped Eloquent
  queries — never `withoutGlobalScope`, never raw SQL. A token minted for tenant A cannot be used
  to see tenant B's data because `TenantContext` never becomes B, and the fetch endpoint accepts no
  tenant/app parameter to redirect it (§4's E6 cross-reference).
- **No re-targeting**: `tenant_id`/`builder_app_id` are write-once at issuance; the fetch/exchange
  endpoints read them only from the authenticated token's own row, never from the request body,
  query string, or headers — closing the exact BOLA pattern E6 warns about by removing the
  parameter rather than merely validating it.
- **Tenant resolution vs. credential scope cannot disagree silently**: same defense `SetTenant`
  already has against a `HostnameTenantContext` mismatch, applied identically here. This only
  becomes reachable if a future task ever exposes preview endpoints on a tenant subdomain rather
  than a dedicated preview host — flagged as an open question in §15 since MP-5 does not decide the
  hosting topology.

### 5.5 Draft snapshot / revision binding
**Decision: immutable snapshot, not a mutable draft pointer** — the task's own stated preference,
and the only option consistent with §2.6's finding that `BuilderDraftExperience` is a single
mutable row with no history table.

- **Creation**: at issuance, for `source = draft`, the issuing endpoint copies the *current*
  `BuilderDraftExperience.schema` **and** its `revision` integer into the new
  `PreviewSession.schema_snapshot` / `draft_revision` columns. For `source = published`, only a
  `published_version_id` FK is stored (no copy needed — `BuilderPublishedExperienceVersion` is
  already immutable). For `source = default`, no reference is needed at all (the bundled default
  experience is static).
- **Refresh/version behavior**: a preview session never auto-follows later draft saves. A merchant
  who edits Draft again while a session is open must explicitly regenerate it — an explicit
  "Regenerate Preview" action that issues a new session (with a fresh snapshot) and revokes the old
  one, using the same overlap-safe ordering `ApiClientKeyService::rotateKey()` already uses (issue
  first, revoke second, so nothing is briefly unauthenticated).
- **Stale session behavior**: a session is never invalidated merely because the draft changed
  underneath it — it continues serving its own frozen snapshot for the rest of its TTL. The fetch
  endpoint compares the session's stored `draft_revision` against the *live* draft's current
  `revision` at request time (a cheap read, not a stored/duplicated value) and returns an advisory
  "Draft changed since this preview was generated" flag — advisory only, never blocking, never
  auto-swapping content.
- **Draft changes while a preview session is open**: no effect on already-issued snapshots (see
  above) — this is the reproducibility guarantee the task asks for.
- **Guarantee that Preview never publishes Draft**: the entire preview subsystem (issuance,
  exchange, fetch) is read-only with respect to `BuilderDraftExperience`/
  `BuilderPublishedExperienceVersion` — no code path in this architecture writes to either table.
  This is the same guarantee MP-3/MP-4 already proved for Browser Preview's client-side behavior,
  now extended to the new backend surface that would carry live data.

### 5.6 TTL
| Credential | Default TTL | Maximum TTL |
|---|---|---|
| Browser preview session | 15 minutes | 60 minutes (hard ceiling, no extension beyond it) |
| QR/deep-link exchange reference (§5.10) | 5 minutes | 5 minutes (not configurable — it is a one-time code, not a working session) |
| Device preview session (post-exchange) | 15 minutes | 60 minutes |

**Why**: RFC 6750 (E4) recommends ≤1 hour for browser-context bearer tokens; this architecture
takes 60 minutes as the outer ceiling and defaults well inside it (15 minutes) because a preview
session is opened, used briefly, and closed — not a working session someone leaves open all day
(OWASP's own "scale timeout to expected use," E2). The QR reference gets an even shorter,
non-adjustable 5-minute window because RFC 8628 (E5) treats the human-approval window as the
highest-risk moment (a bystander could complete the exchange before the intended person). **No
preview credential of any kind is ever issued without an expiry**, and no "remember me"/indefinite
variant exists.

### 5.7 Revocation
- **Manual revoke**: a merchant-facing "Revoke" action on any listed `PreviewSession` — deletes its
  Sanctum token(s) and stamps `revoked_at`.
- **Automatic expiry**: enforced on every request via Sanctum's native `expires_at` check (already
  load-bearing for `ApiClient` keys) plus the mirrored `preview_sessions.expires_at`, so the audit
  trail survives even after Sanctum's own token-pruning housekeeping removes the underlying token
  row.
- **App/session replacement**: issuing a new session for the same `builder_app_id` does **not**
  auto-revoke older ones (concurrent browser + phone previews are legitimate) — but "Regenerate"
  (§5.5) is an explicit revoke-and-reissue in one step.
- **Revoke-all-for-app**: justified and included — disabling/deleting a `BuilderApp`, or an
  explicit "revoke all previews for this app" action, revokes every active `PreviewSession` for
  that `builder_app_id` in one transaction.
- **Revoke-all-for-tenant**: not built as a dedicated action in MP-5/6 — no evidenced need yet
  (every session already expires within 60 minutes, unlike a merchant's own 7-day admin token) —
  but every row already carries `tenant_id`, so adding it later is a single indexed sweep, not a
  schema change.
- **What the client sees after revocation**: identical to expired/unknown (§5.15) — a generic
  "this preview is no longer available" state, never a state-specific message that would leak
  *why* the token stopped working.

### 5.8 Replay behavior
**Decision: reusable during TTL** for both browser and device *working* sessions — not one-time-use,
and not device-bound in V1.

Rationale: a read-only, non-mutating, ≤60-minute credential with one-click revocation already
satisfies OWASP/RFC 6750's threat model for this risk class (E1–E4); requiring one-time exchange or
device binding for *every* preview request would be the "complex crypto the task says not to invent
when ordinary short-lived scoped sessions are enough." A merchant reopening the same browser tab,
or resuming the same phone app session after backgrounding it, should not need to re-authenticate.

The one place a genuine **one-time exchange** is used is the QR/deep-link reference itself (§5.10):
the reference is consumed atomically (`lockForUpdate`, mirroring `AuthRecoveryService::consume()`)
on its first successful exchange and cannot be redeemed a second time. This bounds "someone
screenshots the QR after it's already been scanned" without forcing the resulting *session* to be
single-use too.

**Trade-off, stated plainly**: a captured working-session token is usable by anyone until expiry or
revoke. Accepted because (a) TTL is short, (b) scope is strictly read-only, (c) revocation is
one click and instant, (d) this is exactly the risk class RFC 6750/OWASP treat as adequately
mitigated by short-lived bearer alone, and (e) no customer/financial/mutating data is ever reachable
through this credential (§9).

### 5.9 Browser vs. physical-device contract
**Decision: the same session contract**, differentiated only by a `channel` column
(`browser`/`device`) recorded at issuance — same `PreviewSession` model, same Sanctum guard, same
ability, same TTL family, same fetch endpoint contract.

- **Browser Real Runtime Preview** (Flutter Web, future MP-6+): would consume the token from
  browser-side JS/Dart. Deferred exactly as MP-2 already decided — Flutter Web's `dart:io`-based
  transport/cache are not browser-safe today, so this contract exists but is not yet wired to a
  concrete client; how the token avoids ordinary `localStorage`/page-source exposure in that
  specific client is an open item for whichever task actually builds Flutter Web preview (§15).
- **Physical Device Preview**: the token, once obtained via the QR/exchange flow (§5.10), is stored
  using the runtime's existing `FlutterSecureSessionStore` interface (iOS Keychain / Android
  Keystore) — the same secure-storage seam MP-2's evidence already identified as reusable, now
  finally justified because this is a real (if narrow) bearer credential, unlike the sample-data
  preview that existed before MP-5.

**Why one contract, not two**: a second contract would duplicate tenant/app/revision binding logic,
double the audit/revocation surface, and risk exactly the "second runtime truth" the Horizon
forbids (§4, Decision Gate #9) — MP-2's Hybrid decision already established that Browser Preview and
Real/Device Preview must share data contracts; a credential is a data contract in this sense.

### 5.10 QR / deep-link transport
Directly extends the already-shipped `mobile/lib/deeplink/deep_link_resolver.dart` rule ("no tokens
in deep-link query strings") rather than contradicting it:

- The QR encodes a URL on the existing Universal Link/App Link host pattern
  (`https://{deep-link-host}/preview/{reference}` — a new path shape a future task adds to
  `resolveDeepLinkUri`'s allowlist, still fail-safe/`null` on anything malformed).
- `{reference}` is a short-lived (5 minutes, §5.6), single-use, **opaque** reference code — never
  the bearer token, never any self-describing string. It identifies a not-yet-exchanged
  `PreviewSession` row.
- The consuming app resolves the link, then calls a dedicated exchange endpoint
  (`POST /preview/v1/exchange`, future MP-6/7 surface) over HTTPS, sending `{reference}` in the
  **request body** — never the URL — per E4/E7, and receives the real bearer exactly once.
- **Must not contain, and structurally cannot contain**: merchant admin auth (never constructed
  for this flow at all — §5.3's disjoint-ability guarantee), a long-lived store bearer (the
  exchanged token has the same ≤60-minute ceiling as any other preview session), or any secret
  unrelated to preview.
- **Accidental sharing behavior**: because the link carries only the one-time reference, forwarding
  it before it is scanned lets whoever scans it *first* complete the exchange instead of the
  intended merchant — the same residual risk RFC 8628 (E5) documents for device codes generally.
  Mitigated by the short 5-minute window and by showing the merchant, at generation time, which
  tenant/app the code is for (E5's "display device information, ask the user to verify" pattern),
  so an accidental open is at least self-evidently scoped to preview only. Once exchanged, the
  reference is immediately consumed and cannot be reused by a second scanner — the deliberate
  one-time step referenced in §5.8.
- Rate-limiting/abuse on the exchange endpoint reuses the `customer_otp_codes` shape (an `attempts`
  counter plus a short window) rather than inventing a new pattern (§5.13).

### 5.11 Runtime data access
See the full matrix in §9. Summary: only the bound schema snapshot (and whatever sample data
Browser Preview already renders client-side) is reachable. Customer/private data, cart mutation,
orders/account identity, and all admin data are **structurally unreachable** — not merely
unauthorized — because the token's ability vocabulary contains nothing that any of those routes
check for, and none of those routes accept a `PreviewSession`-tokenable request at all.

### 5.12 Audit / observability
Minimum events, written to a new append-only `preview_session_events` table (modeled on the
existing "write-once, no update path" discipline `TenantApplicationEvent` already uses elsewhere in
this codebase):

- `preview_session.created` — tenant_id, builder_app_id, source, channel, created_by (merchant user
  id), expires_at.
- `preview_session.exchanged` — device channel only; which reference was redeemed (by id, not
  value).
- `preview_session.opened` — first successful fetch.
- `preview_session.refreshed` — old session id → new session id (Regenerate action).
- `preview_session.revoked` — by whom; manual vs. cascade-from-app-disable/delete.
- `preview_session.expired` — recorded lazily at the first rejected-due-to-expiry request, not via
  a cron sweep (no new scheduler dependency introduced for this).
- `preview_session.rejected` — cross-tenant attempt, wrong-app attempt, unknown/malformed token,
  each with whatever context is safely resolvable (attempted tenant/app if any, reason code) —
  **never** the raw token or reference value.

**Raw credentials are never logged** — neither the plaintext bearer nor the plaintext QR reference
appears in any log, audit row, or exception report; only opaque row ids are recorded, matching
`ApiClientKeyService`'s existing "never stored, never logged" discipline for plaintext API keys.

### 5.13 Rate limiting / abuse controls
- **Issuance** (merchant-authenticated): throttled per tenant and per user (e.g., a double-digit
  cap per hour — a tunable policy constant, not a schema commitment) — generous enough for normal
  iterative preview use, tight enough to blunt scripted abuse of an already-authenticated endpoint.
- **Exchange** (`POST /preview/v1/exchange`, reachable pre-auth by an unauthenticated device):
  reuses the `customer_otp_codes` shape — a small `attempts` counter on the reference row plus a
  short absolute window (its own 5-minute TTL already bounds this tightly) — and a per-source-IP
  throttle independent of the issuance limit, since this endpoint has no merchant session to key
  on.
- **Fetch** (`GET /preview/v1/experience`): an ordinary per-token rate limit, consistent with the
  existing `EnforcePublicApiRateLimit` pattern already used on `commerce/v1`, sized to comfortably
  exceed normal preview polling/refresh behavior.
- All numeric limits above are illustrative policy constants for MP-6 to tune, not values this
  architecture document locks in permanently.

### 5.14 Storage
**Documentation only — no migration is implemented in MP-5.** Forecast for MP-6:

- **`preview_sessions`** (new table): `id` (uuid), `tenant_id`, `builder_app_id`, `source`
  (`draft`/`published`/`default`), `schema_snapshot` (json, nullable — populated iff
  `source = draft`), `draft_revision` (int, nullable), `published_version_id` (nullable FK), `channel`
  (`browser`/`device`), `device_label` (nullable string), `created_by` (user id FK), `expires_at`,
  `revoked_at` (nullable), `last_used_at` (nullable), timestamps. Indexes on `(tenant_id,
  builder_app_id)` and `expires_at`.
- **Sanctum's own `personal_access_tokens`** — no new token-storage mechanism; a
  `tokenable_type = PreviewSession` row is created exactly like `ApiClient`/`CustomerIdentity`/
  `PlatformAdministrator` already do. No migration needed for this part at all.
- **`preview_session_events`** (new table, append-only, no update path) — the audit log from
  §5.12.
- **`preview_exchange_references`** (new table, small) — `id`, `preview_session_id` (FK),
  `reference_hash` (sha256, same shape as `auth_action_tokens.token_hash`), `attempts` (tinyint,
  same shape as `customer_otp_codes.attempts`), `expires_at`, `used_at` (nullable).

No `opening_quantity`/schema-unrelated columns are touched; this is entirely additive and does not
alter `BuilderDraftExperience`, `BuilderPublishedExperienceVersion`, or any existing table.

### 5.15 Failure semantics
| Condition | Behavior |
|---|---|
| Expired | Generic "this preview is no longer available" — same shape as revoked/unknown. |
| Revoked | Identical generic shape — no wording that would let a client fingerprint the cause. |
| Unknown/malformed token | Same generic shape; malformed input is rejected on format/length before any DB lookup. |
| Wrong tenant (session's own tenant inactive, or a hostname mismatch if ever exposed on a tenant subdomain) | Same generic shape — no existence leakage, matching `SetTenant`'s own uniform 403. |
| Wrong app | Structurally unreachable, since the fetch endpoint accepts no client-supplied app id — listed here only for the negative-test matrix (§7). |
| Stale snapshot (Draft has moved on since issuance) | **Not a failure** — served as-is (§5.5), with an advisory "Draft changed" banner computed at request time; never blocks, never silently swaps content. |
| Incompatible schema (bound snapshot fails `CompatibilityResolver`/`AppSchemaParser` against the requesting runtime's capability manifest) | Reuses the Horizon's existing fail-closed `ControlledUnavailable`/incompatible outcome — never reinvented, never silently substitutes Published or Default. |
| Backend unavailable | The existing client-side "unavailable" state already shipped in MP-3 — no client-side caching of a previously-successful fetch that could mask staleness, and no fallback to Published "to make it work anyway" (explicit Horizon/task requirement). |

---

## 6. Threat model

| # | Threat | Control | Residual Risk |
|---|---|---|---|
| 1 | Stolen/shared QR link | One-time, 5-minute exchange reference (§5.10); tenant/app name shown at generation so a legitimate holder notices anything off. | Someone with brief access before the intended scan can complete the one-time exchange instead — low, tightly time-boxed. |
| 2 | Leaked browser history/referrer | Bearer only ever in the `Authorization` header (E4); no preview identifier is placed in the app-builder route's own URL either — unchanged from MP-3/4. | None material identified. |
| 3 | Token replay | Reusable-within-TTL by explicit design (§5.8) — read-only scope, ≤60-minute ceiling, instant one-click revocation. | A captured token is usable until expiry/revoke — accepted, matches OWASP/RFC guidance for this risk class. |
| 4 | Cross-tenant substitution | `tenant_id` fixed at issuance; every touched model is `TenantScope`-scoped; fail-closed `SetTenantFromPreviewSession`; no client-suppliable tenant/app parameter anywhere (§5.4, E6). | None identified beyond the general TenantScope-bypass risk every module already carries (a raw/unscoped query bug) — not new to preview. |
| 5 | App-id tampering | `builder_app_id` fixed at issuance, never a request parameter. | None. |
| 6 | Draft revision tampering | Snapshot copied server-side from the DB's own draft row at issuance; never client-supplied. | None — changing what a session shows requires the merchant's own admin auth to issue a new one. |
| 7 | Privilege escalation toward admin APIs | Disjoint Sanctum guard/ability namespace — `preview:read` never appears in `Rbac::MATRIX`/`EnsurePermission`; admin routes require the default guard's `User` tokenable, which a `PreviewSession` token cannot satisfy. | None identified, contingent on the guard wiring staying disjoint at MP-6 implementation time — flagged as an implementation-review item. |
| 8 | Using a preview token as a normal storefront token | `commerce/v1/customer/*` requires `tokenCan('customer:access')` on a `CustomerIdentity` tokenable; `commerce/v1` in general requires the `ApiClient` store bearer. A `PreviewSession` token has neither the right tokenable type nor either ability. | None, same reasoning as #7. |
| 9 | Long-lived token leakage | Hard 60-minute ceiling, no "remember me," Sanctum `expires_at` enforced identically to `ApiClientKeyService`. | Within the ≤60-minute window, a leaked token is usable — bounded, accepted (see #3). |
| 10 | Log leakage | Raw token/reference never logged anywhere; audit trail stores only opaque ids, matching `ApiClientKeyService`'s existing discipline. | Relies on future code not adding ad hoc debug logging of full request payloads — an implementation/review concern, not an architecture gap. |
| 11 | Race between refresh/revoke/open | `lockForUpdate` on exchange-reference consumption (mirrors `AuthRecoveryService::consume()`); "issue new, then revoke old" ordering for Regenerate (mirrors `ApiClientKeyService::rotateKey()`). | None identified for the documented flows. |
| 12 | Malicious/unsupported schema behavior | Reuses the existing, already-proven fail-closed `CompatibilityResolver`/`AppSchemaParser` — the bound snapshot is the exact same content already validated by `BuilderDraftExperienceService::save()` at save time. | None beyond whatever residual risk the existing parser/resolver already carries — out of MP-5's scope to re-audit. |
| 13 | Expired/revoked token still cached on device | Server-side check on every request (Sanctum `expires_at` + `preview_sessions.revoked_at`) — no client-trusted "still valid" flag. | The client may show stale local UI for a moment before the next network call surfaces the generic "no longer available" state — cosmetic, not a security gap. |
| 14 | Log leakage via QR reference exchange failures | Failed exchange attempts log only the reference's row id and an attempt count, never the reference value itself (same shape as `customer_otp_codes`). | None identified. |

---

## 7. Required negative tests — specified now, implemented in MP-6/7/8

| Test | Exercises | Expected outcome (per §5.15) |
|---|---|---|
| Tenant A token cannot access tenant B's preview | §5.4 | Generic "not available" — no existence leak of B's app/tenant |
| App A token cannot access app B (same tenant) | §5.3, §5.4 | Same generic outcome — structurally impossible since app id is server-fixed, but tested as a regression guard |
| Expired token rejected | §5.6, §5.15 | Generic "not available" |
| Revoked token rejected | §5.7, §5.15 | Same generic outcome, indistinguishable from expired to the caller |
| Malformed/unknown token rejected | §5.15 | Rejected before any DB lookup; same generic outcome |
| Wrong draft revision rejected / handled | §5.5 | Not a hard rejection — advisory "draft changed" banner only; a dedicated test proves the banner appears without blocking or substituting content |
| Preview does not mutate Published | §5.5 | No `BuilderPublishedExperienceVersion` row is created/changed by any preview-subsystem call, under any input |
| Token cannot call admin endpoints | §5.3, threat #7 | 401/403 from every `/api/*` merchant route when presented a `PreviewSession` token |
| Token cannot obtain broader Commerce access than its scope | §5.3, threat #8 | 401/403 from every `commerce/v1` route when presented a `PreviewSession` token |
| Raw credential never appears in logs | §5.12, threat #10 | Log/audit-row assertions across issuance, exchange, fetch, and rejection paths contain no plaintext token/reference substring |
| Repeated QR use follows the approved replay policy | §5.8, §5.10 | First exchange succeeds and consumes the reference; a second exchange of the same reference is rejected; the resulting *session* itself remains reusable within its own TTL per §5.8 |

---

## 8. UX security behavior (merchant-facing states)

| State | Arabic | English | Notes |
|---|---|---|---|
| Session creating | جارٍ إنشاء جلسة المعاينة… | Creating preview session… | No credential details shown. |
| Ready | المعاينة جاهزة | Preview ready | Shows tenant/app name and channel (browser/device), never the token. |
| Expires at / expires in | تنتهي خلال… / تنتهي في… | Expires in… / Expires at… | Relative + absolute time, refreshed client-side, never silently extended. |
| Refresh/regenerate | تجديد المعاينة | Regenerate preview | Explicitly revokes the old session and issues a new one with a fresh snapshot (§5.5, §5.7) — copy should say so, not imply a "soft refresh." |
| Revoke | إلغاء المعاينة | Revoke preview | Immediate; the row moves to a "Revoked" state in the list, distinguishable to the merchant (not to the failed client — §5.15). |
| Expired | انتهت صلاحية هذه المعاينة | This preview has expired | Same generic client-facing failure as revoked/unknown (§5.15); the merchant-facing *list* may still show "Expired" specifically for their own bookkeeping — the asymmetry is intentional (§5.15's no-leak rule applies to the *unauthenticated caller*, not the authenticated merchant viewing their own session list). |
| Revoked | تم إلغاء هذه المعاينة | This preview was revoked | Same distinction as above. |
| Unavailable | تعذّر الوصول إلى خدمة المعاينة حالياً | Preview service is currently unavailable | Backend-unavailable failure mode (§5.15) — never falls back to Published. |
| Incompatible | هذا الإصدار غير متوافق مع عارض المعاينة | This version isn't compatible with the preview renderer | Reuses the existing fail-closed incompatible-schema copy pattern already established by the Horizon — no new wording invented that could imply partial success. |

Security copy never names the credential mechanism (no "token," "bearer," "session id" shown to the
merchant) and never distinguishes "expired" from "revoked" from "unknown" in any surface an
*unauthenticated* preview client can see.

---

## 9. Data-access matrix

| Data category | Preview session access | Basis |
|---|---|---|
| Experience/schema payload (the bound snapshot) | ✅ Read-only | §5.3, §5.5 — the entire purpose of the credential |
| Safe catalog/read sample data (the client-side sample data Browser Preview already renders) | ✅ Read-only, unchanged from MP-3/4 — no new live-data path opened by MP-5/6 | §2.6, MP-4 report §7 |
| Live/real catalog data | ❌ Not in MP-5/6 scope — would require an explicit future decision, not implied by this architecture | Fail-closed by omission |
| Customer/private data | ❌ Never | §5.3, §9 |
| Cart mutations | ❌ Never | Matches MP-4's already-shipped "requires-live-data" honest-unavailable outcome |
| Orders/account identity | ❌ Never | §5.3 |
| Admin data (`/api/*`, any `Rbac` permission surface) | ❌ Never — structurally unreachable, not merely unauthorized | Threat #7 |

Anything not explicitly listed above fails closed by construction: the fetch endpoint is a single
narrow read (schema snapshot only), not a general-purpose Commerce API gateway.

---

## 10. Audit / rate-limit requirements

Consolidated from §5.12/§5.13 — implementation-ready summary for MP-6:

- Append-only `preview_session_events` table; every lifecycle transition writes exactly one row;
  no row is ever updated after insert.
- No raw token/reference value is ever persisted outside the hashed Sanctum/`preview_exchange_references` columns, and never inside any log line, audit row, or exception report.
- Three independent rate-limit surfaces (issuance, exchange, fetch), each reusing an existing
  in-repo throttling idiom (`throttle` middleware for issuance, `customer_otp_codes`-style attempt
  counting for exchange, `EnforcePublicApiRateLimit`-style token-bucket for fetch) rather than a
  new limiter mechanism.

---

## 11. DB/API impact forecast (documentation only — no migration in MP-5)

**New tables** (§5.14): `preview_sessions`, `preview_session_events`,
`preview_exchange_references`. **No existing table is altered.**

**New API surface** (not implemented in MP-5): a merchant-admin issuance endpoint under the
existing `/api/*` surface (reusing `apps_builder.view` + `EnsureCommercialApplicationAccess`), and a
new, dedicated `preview/v1` surface — deliberately **not** nested under `commerce/v1` — exposing
only `GET /preview/v1/experience` and `POST /preview/v1/exchange`, each requiring the new
`AuthenticatePreviewSession` guard and nothing else from the existing `commerce/v1` middleware
stack (no `AuthenticateApiClient`, no store bearer dependency at all).

**New Sanctum ability**: `preview:read` — added to whatever central ability/scope registry MP-6
chooses to keep it discoverable (the repository does not currently have a single registry spanning
all four existing principal types' abilities; MP-6 should decide whether `preview:read` belongs
in a new dedicated enum, mirroring `PublicApiScope`, or stays a plain string constant given it is
the only ability this principal type will ever need in V1).

---

## 12. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Self-contained signed JWT preview token | Revocation would require a denylist keyed on `jti` (E3) — added infrastructure with no benefit over Sanctum's existing instant-revoke-by-delete model, which this codebase already uses successfully four times over (§2.2). |
| Reuse the merchant's own admin Sanctum token, scoped down via abilities only, no new principal type | Mixes principal types under one `tokenable`; the existing merchant token already uses `['*']` in production, so "scoping down" would require auditing every `EnsurePermission` check for accidental ability leakage rather than starting from zero — a strictly worse security posture than a disjoint principal. |
| Embed the bearer token directly in the QR code/deep link | Violates RFC 6750's "not in a URL" guidance (E4) and directly contradicts AWJ's own already-shipped, already-reviewed deep-link rule ("no tokens in deep-link query strings," §2.7). |
| Device binding / hardware attestation on every request | Disproportionate complexity for a read-only, non-mutating, ≤60-minute credential — exactly the "complex crypto" the task instructs against inventing when ordinary short-lived scoped sessions suffice (§5.8). Revisit only if real-world abuse telemetry justifies it post-launch. |
| One-time-use working session (not just the QR reference) | Would break ordinary "reopen the same browser tab" / "resume the same phone app" UX for no security gain proportionate to the cost, given the credential is already read-only and short-lived (§5.8). |
| Mutable "live draft pointer" preview (no snapshot) | Breaks reproducibility and security together — a merchant editing Draft mid-preview would silently change what an already-open/shared preview shows, exactly what the task instructs against ("Prefer reproducibility and security," §5.5). |
| Layering preview auth onto `commerce/v1` (requiring the ApiClient store bearer as a prerequisite) | Forces every Browser/Device Preview client to be provisioned with a real mobile store bearer just to preview a Draft — exactly the hard boundary MP-2's evidence already flagged as unacceptable (§2.5). |
| Encrypted-cast reversible secret (like `webhook_endpoints.secret`) | Reversibility is needed only when the server must later recompute something from the secret (HMAC signing); a preview credential is presented back as itself, so a one-way hash (Sanctum's own model) is strictly sufficient and simpler. |

---

## 13. Decision Gate result

Checked against every condition in the task's Decision Gate list (§"Decision Gate rules") and the
Horizon's own §12 gate list:

| Condition | Triggered? |
|---|---|
| Forwarding admin/Sanctum credentials to mobile/browser runtime | **No** — disjoint principal/ability namespace (§5.1, §5.3, threat #7) |
| Exposing current store bearer tokens | **No** — preview is deliberately kept off `commerce/v1` (§2.5, §11) |
| Weakening Tenant Isolation | **No** — reuses/extends `TenantScope`/`SetTenant`'s existing fail-closed shape (§5.4) |
| Weakening RBAC or Commerce authorization | **No** — issuance stays RBAC- and commercial-entitlement-gated exactly like the existing Draft read endpoint (§5.1); the new ability namespace never intersects `Rbac::MATRIX` |
| Public App Schema changes | **No** — `AppSchema`/`AppSchemaParser`/`CompatibilityResolver` untouched |
| Publishing Draft to make Preview work | **No** — the entire subsystem is read-only w.r.t. both experience tables (§5.5) |
| Long-lived reusable credentials | **No** — 60-minute hard ceiling, no indefinite variant (§5.6) |
| Arbitrary executable merchant code | **No** — not applicable to this architecture |
| Material redesign of mobile auth/runtime | **No** — additive: one new Sanctum guard, one new deep-link path shape appended to an existing allowlist (§2.7, §5.10) |
| Signing/TestFlight/Play/App Store/Production work | **No** — none proposed or implied |

**Result: PASS.** This architecture does not require owner escalation on any forbidden condition.
It is presented for the mandatory Decision Gate **review and sign-off** the Horizon requires before
any implementation begins — not because a forbidden condition was found, but because MP-5 is
itself defined as a mandatory gate regardless of outcome.

---

## 14. Exact implementation boundary for MP-6

**MP-6 ("Real Runtime Preview") may implement, once this architecture is approved:**
- the `preview_sessions` / `preview_session_events` / `preview_exchange_references` migrations
  (§5.14);
- the `PreviewSession` Eloquent model + `AuthenticatePreviewSession` guard +
  `SetTenantFromPreviewSession` middleware (§5.4);
- the merchant-admin issuance endpoint (§5.1) and the `preview/v1` fetch/exchange endpoints
  (§5.10, §11) — read-only, exactly as scoped in §5.3/§9;
- the `preview:read` ability and its enforcement middleware (§11);
- wiring the actual Flutter runtime (per MP-2's Hybrid decision) to consume a preview session over
  this contract for Real Runtime Preview specifically — **not** Flutter Web, and **not**
  QR/physical-device**, both of which remain MP-7/8's scope.

**MP-6 must not**: implement the QR/deep-link UI or exchange consumption flow (MP-7), implement
physical-device preview (MP-8), touch `commerce/v1`'s existing store-bearer contract, or alter
`BuilderDraftExperience`/`BuilderPublishedExperienceVersion` in any way.

---

## 15. Risks / open questions

1. **Hosting topology for `preview/v1`** (dedicated preview host vs. tenant subdomain) is not
   decided here — if a future task exposes it on a tenant subdomain, `SetTenantFromPreviewSession`
   must also cross-check `HostnameTenantContext` exactly as `SetTenant` does (§5.4 already
   anticipates this, but the routing decision itself is open).
2. **Which app consumes an exchanged device-channel token** (a dedicated "AWJ Preview" app vs. an
   app-specific development build) is a product/build decision the Horizon raised (MP-2 §11) but
   MP-5 does not resolve — whichever is chosen must use `FlutterSecureSessionStore` (§5.9).
2a. **Browser-side custody of a Flutter Web preview token** (how it avoids exposure via
  `localStorage`/page source/a same-origin script or extension) is explicitly deferred to whichever
  task actually builds Flutter Web preview, consistent with MP-2's own deferral of Flutter Web
  itself — this architecture only fixes the credential's *server-side* shape, not its future
  browser-side custody mechanism.
3. **Central ability/scope registry**: `preview:read` is the fifth distinct ability vocabulary in
   this codebase (after merchant `['*']`, `PublicApiScope`, `customer:access`,
   `platform:read`/`platform:manage`) with no single enum spanning all of them — MP-6 should decide
   whether that consolidation is worth doing now or remains deferred.
4. **Exact numeric policy constants** (issuance rate limit, exchange attempt cap, fetch throttle)
   are illustrative in this document (§5.13) and should be confirmed/tuned during MP-6
   implementation against real usage patterns, not treated as final.
5. **RBAC permission tier for issuance** (`apps_builder.view` vs. a stricter tier): this document
   recommends reusing the confirmed existing `apps_builder.view` gate (since issuing a preview does
   not mutate the app) but flags this as an MP-6 confirmation item against the authoritative
   `Rbac::PERMISSIONS` list at implementation time.
6. **Live real-catalog data in preview** (beyond the client-side sample data already shipped) is
   out of scope for this architecture entirely — if a future task wants it, it needs its own
   Decision Gate pass, since it would add a new data-access row to §9 that does not exist today.

---

## Recommendation

**Proceed to MP-6** under the architecture in §3–§5, once the owner has reviewed and approved this
Decision Gate. No code, migration, or route from this architecture is implemented by MP-5 itself.
