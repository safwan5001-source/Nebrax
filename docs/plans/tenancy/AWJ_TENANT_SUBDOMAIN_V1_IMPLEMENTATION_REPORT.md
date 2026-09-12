# AWJ Tenant Subdomain V1 — Implementation Report

**Date:** 2026-09-12
**Status:** IMPLEMENTED ON PR — **NOT MERGED — NOT DEPLOYED**
**Branch:** `feat/awj-tenant-subdomain-v1`
**PR:** [#780](https://github.com/safwan5001-source/Nebrax/pull/780)
**Base SHA:** `50b11b88761682597a418f1c2d465fce2a45e4f8` (`origin/main`, PR-INV-MOV-1 / #773)
**Head SHA:** `e9b0cbea63d049bcad952fb1a490b55dca7d483a` (implementation). Docs-only SHA is the current branch tip after this PR record.

---

## Summary

V1 makes `{tenant-slug}.awj.app` a real tenant-resolution **and authentication** boundary for AWJ ERP staff login, without redesigning `TenantContext` / `TenantScope` / `SetTenant`.

Example: slug `alnoor` → `alnoor.awj.app`. Registration already stored `Tenant.slug`; login previously authenticated globally by email and derived the tenant from `user.tenant_id`. That non-tenant login path is preserved. Tenant-subdomain mode is additive and fail-closed.

Implemented in application code:

- Configurable AWJ-controlled base domain (`AWJ_TENANT_BASE_DOMAIN` / `AWJ_TENANT_BASE_DOMAINS`, default `awj.app`).
- Hostname → slug → exactly one active `Tenant` via existing `tenants.slug`.
- Identification **before** staff login (`IdentifyTenantHostname`).
- Cross-tenant credentials rejected with the same 422 as a bad password.
- Unknown `{slug}.awj.app` returns a non-enumerating 404.
- Reserved infrastructure slugs rejected at registration and treated as non-tenant hosts.
- Registration UI suffix changed from `.nebrax.app` to configurable `.awj.app`.
- CORS origin patterns for `https://{slug}.{base}` without broadening cookies to `.awj.app`.

Not implemented (out of scope, as specified):

- Custom ERP domains (`erp.customer.com`).
- Wildcard DNS / TLS / Vercel domain attach (documented only; not executed).
- Merge or deploy.

---

## Architecture

ERP tenant hosts and Commerce storefront hosts remain **different concepts**.

| Concern | Source of authority | Example |
|---|---|---|
| ERP staff tenant (this PR) | `tenants.slug` under a configurable AWJ base | `alnoor.awj.app` |
| Commerce storefront (unchanged) | persisted `StorefrontDomain.hostname` | custom shop host / future `{slug}.store.awj.app` |

`HostnameNormalizer` is reused for incoming host strings. ERP login domains are **not** rows in `StorefrontDomain`.

### Request flow

```
HTTP request
  → IdentifyTenantHostname          # before auth
       TenantHostnameResolver
         Host first (getHost)
         then Origin host           # JS cannot spoof Origin
         conflict of two tenant slugs → 404
         reserved / apex / non-base → non-tenant (null)
         `{slug}.{base}` unknown or inactive → 404
       HostnameTenantContext.set    # NOT TenantContext
  → login / other unauthenticated routes
       AuthController::login
         password check
         if HostnameTenantContext set: user.tenant_id must match (else 422)
         then is_active / subscription
  → authenticated routes
       SetTenant
         if HostnameTenantContext set: must equal user.tenant_id (else 403, no TenantContext)
         else TenantContext from user.tenant_id (existing path)
       TenantScope isolation (unchanged)
```

`HostnameTenantContext` is a request-scoped singleton **separate** from `TenantContext` so:

1. Tenant identity is known before login.
2. `SetTenant` still establishes isolation **after** auth.
3. A mismatch never silently switches the hostname tenant to the user's tenant.

### Host vs Origin

The Next.js frontend on Vercel and the Laravel API on Render/Railway are different hosts. A browser on `https://alnoor.awj.app` calls `https://<api-host>/api/login`. Laravel's `$request->getHost()` is then the API host (non-tenant). The browser sends `Origin: https://alnoor.awj.app`, which cannot be set by page JavaScript.

Resolver rule: Host slug wins if present; otherwise Origin slug. If both are tenant slugs and they disagree → 404. Client headers such as `X-Tenant-Slug` are ignored.

### Non-tenant mode (backward compatible)

Apex `awj.app`, reserved labels (`www`, `api`, `app`, …), Render (`nibras-api.onrender.com`), Vercel preview (`*.vercel.app`), `localhost`, and IPs do **not** enter tenant-subdomain mode. Existing email/password login continues to resolve the tenant from `user.tenant_id`.

### Config

- `config/tenancy.php` — `base_domains`, `reserved_slugs`.
- `AWJ_TENANT_BASE_DOMAIN` (single, default `awj.app`) or `AWJ_TENANT_BASE_DOMAINS` (comma list, e.g. `awj.app,localhost,awj.test`).
- `AWJ_TENANT_RESERVED_SLUGS` — extra reserved labels.
- Frontend: `NEXT_PUBLIC_TENANT_BASE_DOMAIN` (default `awj.app`) via `web/src/lib/tenant-domain.ts`.

Single-label base `localhost` is allowed as a **base domain** only (`alnoor.localhost`). Incoming tenant hosts still go through `HostnameNormalizer`, which continues to reject single-label identities for Storefront.

V1 extracts one label only. `foo.bar.awj.app` is not a tenant host.

---

## Security

### Cross-tenant authentication

A user of Tenant B **cannot** authenticate through Tenant A's hostname, even with valid Tenant B credentials. `AuthController::login` compares `user.tenant_id` to `HostnameTenantContext` **after** the password check and **before** `is_active`. Failure uses the same 422 message as a wrong password (`بيانات الدخول غير صحيحة.`) so the response does not reveal that the account exists on another tenant.

Failed cross-tenant login does not set `TenantContext` and does not issue a token.

### Fail-closed unknown / malformed / inactive

| Input | Result |
|---|---|
| `does-not-exist.awj.app` | 404, generic message, no token, no TenantContext |
| inactive tenant slug | 404 (resolver requires `is_active` and exactly one match) |
| malformed host (`shop..awj.app`, empty) | non-tenant or 404; never guessed |
| reserved slug host (`api.awj.app`) | non-tenant mode (existing login path) |
| Host slug ≠ Origin slug | 404 |
| Bearer token of B on host of A | 403 from `SetTenant`; `TenantContext` never set; body does not leak B or A data |

### Reserved slugs (centralized)

`www`, `api`, `app`, `admin`, `platform`, `support`, plus `store` and `storefront` (Commerce collision reduction on the same parent). Extra values via `AWJ_TENANT_RESERVED_SLUGS`. Registration `Rule::notIn`; resolver treats them as non-tenant.

### Cookies / CORS / CSRF / Sanctum

Staff auth is Sanctum **Bearer tokens** stored in `localStorage` (origin-scoped). Cookies were **not** broadened to `.awj.app`. `supports_credentials` remains `false`. CORS adds regex origin patterns `^https?://[a-z0-9-]+\.{base}(?::\d+)?$` so tenant SPAs can call the API without listing every slug in `FRONTEND_URL`.

No `X-Tenant-*` client header is trusted.

### What this PR does not claim

Browser enforcement of `alnoor.awj.app` in production still requires wildcard DNS + Vercel `*.awj.app` (see Infrastructure). Until that is attached, users continue to log in on the current non-tenant frontend host; the API already rejects cross-tenant Host/Origin combinations.

---

## Files changed

### New

| File | Purpose |
|---|---|
| `config/tenancy.php` | Configurable base domains + reserved slugs |
| `app/Tenancy/ReservedTenantSlugs.php` | Central reserved-slug policy |
| `app/Tenancy/HostnameTenantContext.php` | Pre-auth hostname tenant (not TenantContext) |
| `app/Tenancy/TenantHostnameResolver.php` | Host/Origin → slug → active Tenant |
| `app/Http/Middleware/IdentifyTenantHostname.php` | Resolve before auth; never sets TenantContext |
| `tests/Feature/TenantHostnameResolverTest.php` | Resolution / reserved / malformed / local base |
| `tests/Feature/TenantSubdomainAuthTest.php` | Auth boundary, isolation, backward-compat |
| `web/src/lib/tenant-domain.ts` | Frontend base-domain + reserved-slug helpers |
| `web/src/lib/tenant-domain.test.ts` | Suffix / reserved / no `.nebrax.app` |
| `docs/plans/tenancy/AWJ_TENANT_SUBDOMAIN_V1_IMPLEMENTATION_REPORT.md` | This report |

### Modified

| File | Purpose |
|---|---|
| `routes/api.php` | `IdentifyTenantHostname` on the ForceJsonResponse group |
| `app/Providers/TenancyServiceProvider.php` | Singleton `HostnameTenantContext` |
| `app/Http/Controllers/Api/AuthController.php` | Hostname tenant must match user; same 422 as bad password |
| `app/Http/Middleware/SetTenant.php` | Hostname mismatch → 403, no TenantContext |
| `app/Http/Requests/RegisterRequest.php` | Lowercase slug; `notIn` reserved; uniqueness preserved |
| `app/Support/HostnameNormalizer.php` | Docblock: ERP resolver is a caller; no parsing fork |
| `deploy/cors.php` | Tenant origin patterns; credentials still false |
| `deploy/DEPLOY.md` | Env vars + DNS/TLS/Vercel work **not executed** |
| `render.yaml` | `AWJ_TENANT_BASE_DOMAIN=awj.app` (does not change DNS) |
| `web/DEPLOY.md` | `NEXT_PUBLIC_TENANT_BASE_DOMAIN`; wildcard still manual |
| `web/src/app/register/page.tsx` | Suffix via `tenantHostSuffix()`; reserved-slug refine |
| `web/src/messages/ar.json` | `slug_reserved` |
| `web/src/messages/en.json` | `slug_reserved` |

No accounting, ZATCA, inventory, POS, or StorefrontDomain semantics were changed. No migration: existing `tenants.slug` (unique) is reused. Assemble/CI already copy `app/Tenancy/*.php`, `app/Http/Middleware/*.php`, and `config/*.php` — no new directory, no allowlist change.

---

## Tests

Assembled Laravel app: `/tmp/nibras-app` (Laravel 11.56.1, PHP 8.2.32, SQLite). Commands run from that app after copying this branch's core files.

### Focused tenancy / auth / isolation (this PR)

```bash
php artisan test --filter='TenantHostnameResolverTest|TenantSubdomainAuthTest|ApiAuthTest|ApiTenantIsolationTest|HostnameNormalizerTest'
```

**Result: 74 passed (281 assertions), Duration 9.22s**

Breakdown:

| Suite | Tests | Notes |
|---|---|---|
| `TenantHostnameResolverTest` | 5 | valid slug; unknown/malformed; reserved; normalizer reuse; `alnoor.localhost` |
| `TenantSubdomainAuthTest` | 16 | A/B login, cross-tenant 422, unknown 404, Origin boundary, header ignored, partners leak-proof, inactive 404, non-tenant login still works |
| `ApiAuthTest` | 10 | existing register/login/me/logout |
| `ApiTenantIsolationTest` | 5 | existing partner isolation |
| `HostnameNormalizerTest` | 16 | shared normalizer unchanged |
| `PublicApiAuthTest` | 22 | matched by `ApiAuth` substring; still green |

Exact `--filter` also matched `PublicApiAuthTest` (name contains `ApiAuth`). Intended new+legacy core without that extra file: 52 tests, all passing inside the 74.

### Storefront resolution (must not couple)

```bash
php artisan test --filter='StorefrontDomainResolutionApiTest|CustomerAuthTest|LedgerIsolation'
```

**Result: 17 passed (38 assertions), Duration 5.90s** — `StorefrontDomainResolutionApiTest` only (`CustomerAuthTest` / `LedgerIsolation` names not present as those class titles). Storefront still fail-closes on unknown/malformed/inactive hosts and ignores client tenant headers.

### Frontend

```bash
cd web && npm test -- --run src/lib/tenant-domain.test.ts
```

**Result: 3 passed (3), Duration 648ms.**

### Full `php artisan test`

Not completed in this sandbox. A prior unfiltered run produced compact PHPUnit output with many `⨯` after ~5 minutes in an incompletely assembled local tree (missing xmllint / production-parity extensions). CI on GitHub (`php artisan test` SQLite + PostgreSQL 16) is the intended full gate. Focused security suites above are green locally.

---

## Build / CI

| Check | Result |
|---|---|
| PHP focused suites (commands above) | 74 + 17 passed |
| `web` vitest `tenant-domain.test.ts` | 3 passed |
| `web` `npm run lint` / `npm run build` locally | **Not a valid signal here.** Next inferred `/workspace/package-lock.json` (App Builder parent lockfile) and could not find `pages`/`app` at that root. Pre-existing sandbox layout; not caused by this PR's files. |
| GitHub Actions `CI` (`ci.yml`) | Runs on push/PR: assemble core → `php artisan test` on SQLite **and** PostgreSQL 16. New files are in existing copy globs. Status recorded after CI runs on the PR. |
| GitHub Actions `Web CI` (`web-ci.yml`) | `npm ci` + `npm test` + `npm run build` in `web/` (no parent lockfile). Status recorded after CI runs on the PR. |

No production assemble-allowlist change required (`app/Tenancy`, `app/Http/Middleware`, `config/` already copied by `setup.sh`, `deploy/assemble.sh`, and `.github/workflows/ci.yml`).

---

## Infrastructure required

Clearly distinguished:

| Item | In code | Verified by tests | Still requires operator action |
|---|---|---|---|
| `{slug}.awj.app` resolution | yes | yes | — |
| Cross-tenant login rejection | yes | yes | — |
| Reserved slugs | yes | yes | add extras via env if needed |
| Registration suffix `.awj.app` | yes | vitest | — |
| CORS patterns for tenant origins | yes | (unit via login Origin tests) | set `FRONTEND_URL` for apex/app/preview |
| `AWJ_TENANT_BASE_DOMAIN` on Render blueprint | yes (`render.yaml`) | — | Render apply **not executed** |
| DNS `*.awj.app` | documented only | — | **Safwan** |
| Wildcard TLS | documented only | — | **Safwan** |
| Vercel `awj.app` + `*.awj.app` | documented only | — | **Safwan** |
| API hostname `api.awj.app` | reserved slug; not bound | — | optional, **Safwan** |
| Cookie domain `.awj.app` | **not done** (correct) | Bearer localStorage | do not broaden |

Exact remaining operator work (do **not** execute from this PR):

1. **DNS:** at the `awj.app` registrar, create a wildcard record `*.awj.app` (and apex `awj.app`) pointing at Vercel for the ERP UI. Optionally point `api.awj.app` at Render/Railway. V1 is a single label; `*.awj.app` does not cover `foo.bar.awj.app`.
2. **TLS:** certificate covering `awj.app` and `*.awj.app` (Vercel / host automatic is fine).
3. **Vercel (`web/`):** Project → Domains → add `awj.app` and `*.awj.app`. Env `NEXT_PUBLIC_TENANT_BASE_DOMAIN=awj.app`, `NEXT_PUBLIC_API_URL=https://<api-host>/api`. Root Directory remains `web`.
4. **API (Render/Railway):** env `AWJ_TENANT_BASE_DOMAIN=awj.app`. `FRONTEND_URL` should include non-tenant UI origins (`https://app.awj.app`, `https://awj.app`, current Vercel URL). Tenant origins are covered by CORS patterns. Do **not** set `SESSION_DOMAIN=.awj.app`.
5. **Preview / local:** `AWJ_TENANT_BASE_DOMAINS=awj.app,localhost` (or `awj.test`) and `NEXT_PUBLIC_TENANT_BASE_DOMAIN=localhost` for `alnoor.localhost`. Vercel preview URLs stay non-tenant hosts.

This PR does not modify production DNS, certificates, or live Vercel/Render settings.

---

## Risks / remaining work

1. **Wildcard DNS + Vercel `*.awj.app` not attached.** Until then, the hostname boundary is enforced on the API whenever Host or Origin is a tenant host, but browsers still use the current frontend host.
2. **No post-registration redirect** to `{slug}.awj.app`. Existing flow still `router.replace('/dashboard')` on the current origin. Minimum frontend change by design; a later onboarding PR can send the owner to their subdomain after DNS exists.
3. **Storefront hostname collision.** `store` / `storefront` are reserved on `awj.app`. Commerce custom domains are unchanged. A future `{slug}.store.awj.app` pattern needs a **different** base, not `StorefrontDomain` rows for ERP slugs.
4. **Case of existing slugs.** New registrations are lowercased. Resolver matches `lower(slug)`. Postgres `UNIQUE` on `tenants.slug` is case-sensitive; mixed-case duplicates from before this PR are unlikely but would fail-closed (resolver requires exactly one active match).
5. **Full local PHPUnit** not green-gated in this sandbox; CI is the full suite.
6. Custom ERP domains remain out of scope.

---

## Git information

| Field | Value |
|---|---|
| Branch | `feat/awj-tenant-subdomain-v1` |
| Base | `origin/main` @ `50b11b88761682597a418f1c2d465fce2a45e4f8` |
| PR | [#780](https://github.com/safwan5001-source/Nebrax/pull/780) |
| Implementation SHA | `e9b0cbea63d049bcad952fb1a490b55dca7d483a` |
| Head SHA | `e9b0cbea63d049bcad952fb1a490b55dca7d483a` (code); this docs commit is additive |
| Merge | **not performed** |
| Deploy | **not performed** |

---

## Next step

The smallest recommended next action: **review [PR #780](https://github.com/safwan5001-source/Nebrax/pull/780), wait for GitHub CI (PHP SQLite + PostgreSQL and Web CI) to go green, then attach `*.awj.app` DNS + Vercel domains in a separate ops pass — do not merge until CI is green and the security review of the hostname boundary is accepted.**
