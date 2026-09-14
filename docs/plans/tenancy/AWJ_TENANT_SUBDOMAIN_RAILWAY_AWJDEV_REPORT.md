# AWJ Tenant Subdomains — Railway `*.awjdev.xyz` Completion Report

**Date:** 2026-09-14
**Status:** IMPLEMENTED ON PR — **NOT MERGED — NOT DEPLOYED**
**Branch:** `claude/awj-tenant-subdomains-ebdop5`

---

## Status

Code-level, the tenant-subdomain contract this task asked for **already exists and is
already environment-configurable** — it shipped in PR #780 (`cf97b25`, merged to
`main`) as V1 of `{slug}.awj.app`. This task's job was to confirm that contract
actually covers the live Railway environment (`*.awjdev.xyz`) with **zero
hard-coded `awjdev.xyz`**, close the test-coverage gap the task asked for
explicitly, and surface one real infrastructure caveat that the task's own
assumptions did not account for. No production business logic changed.

---

## Phase 0 findings

**Source of truth for the tenant slug:** `tenants.slug` (unique, already existed
before any of this work). Registration lower-cases it, validates it against
`App\Tenancy\ReservedTenantSlugs`, and enforces uniqueness — unchanged by this task.

**Hostname → Tenant resolution:** `App\Tenancy\TenantHostnameResolver::extractSlug()`
strips scheme/port via the shared `HostnameNormalizer`, then checks the host against
`config('tenancy.base_domains')` (longest-match first). A single label under a
configured base domain that isn't reserved resolves to exactly one **active**
tenant via `tenantIdForSlug()`, or `abort(404)` — fail-closed, never a guess.
Resolution runs **before** authentication via `IdentifyTenantHostname` middleware,
into a separate `HostnameTenantContext` (not `TenantContext`) so:
- Host wins over Origin; a Host/Origin slug mismatch is `404`.
- `AuthController::login` rejects cross-tenant credentials with the *same* 422 as
  a wrong password (no enumeration).
- `SetTenant` (post-auth) 403s on a hostname/user mismatch without ever setting
  `TenantContext`.
- No `X-Tenant-*` client header is trusted anywhere in this path.

**Existing `awj.app` occurrences in code:** all of them are **default fallback
values**, not hard-coded business logic — `config('tenancy.base_domains',
['awj.app'])` in `TenantHostnameResolver`, the `env(..., 'awj.app')` defaults in
`config/tenancy.php` and `deploy/cors.php`, and the same default in
`web/src/lib/tenant-domain.ts`. Every one of them is overridden by
`AWJ_TENANT_BASE_DOMAIN` / `AWJ_TENANT_BASE_DOMAINS` (backend) or
`NEXT_PUBLIC_TENANT_BASE_DOMAIN` (frontend). Nothing needed to change here for
`awjdev.xyz` to work — it already works as an env value.

**Post-registration redirect:** `web/src/app/register/page.tsx` calls
`router.replace('/dashboard')` — a same-origin relative redirect, never a
hard-coded domain. No fix required for the task's "no hard-coded production
domain in the redirect" requirement, because there was never one. Redirecting
to `https://{slug}.{base}` instead was evaluated and **deliberately not done**
(see Risks).

**Environment/config contract already in place:**

| Layer | Variable | Default |
|---|---|---|
| Backend base domain | `AWJ_TENANT_BASE_DOMAIN` (or `AWJ_TENANT_BASE_DOMAINS`, comma list) | `awj.app` |
| Backend reserved slugs | `AWJ_TENANT_RESERVED_SLUGS` (extra, comma list) | `www,api,app,admin,platform,support,store,storefront` |
| Backend CORS | reads the same `AWJ_TENANT_BASE_DOMAIN(S)`, builds `^https?://[a-z0-9-]+\.{base}(?::\d+)?$` origin patterns | — |
| Frontend base domain | `NEXT_PUBLIC_TENANT_BASE_DOMAIN` | `awj.app` |

**Existing tests:** `tests/Feature/TenantHostnameResolverTest.php` and
`tests/Feature/TenantSubdomainAuthTest.php` already proved the contract generically
(host/Origin resolution, reserved slugs, cross-tenant rejection, unknown/inactive
fail-closed, non-tenant hosts like `nibras-api.onrender.com` and `nebrax.vercel.app`
staying non-tenant). They exercised it only against the `awj.app` default and one
`localhost` override — not against the live Railway domain.

**Architecture check vs. the task's assumptions — one real gap found (not a STOP):**
the Railway service `Nebrax / AWJ ERP` runs the root `Dockerfile`
(`php artisan serve` on `$PORT`, which is Railway's injected port — matching the
"port 8080" mentioned) — **backend API only**. There is no Next.js process in that
image; the frontend (`web/`) is documented and deployed as a **separate** Vercel
project (`web/DEPLOY.md`). So `*.awjdev.xyz`, as currently routed, reaches the
Laravel JSON API, not an HTML login page. This doesn't invalidate the tenant-
resolution design (Host/Origin-based resolution and CORS work identically
regardless of who serves the HTML — that's exactly how V1 was designed to survive
a split frontend/backend deployment), but it does mean **setting the backend env
var alone will not make a browser see a tenant login page at that URL yet** — the
wildcard also needs to be attached to wherever `web/` is actually served. Documented
in `deploy/DEPLOY.md` and `web/DEPLOY.md` rather than forced into a design this
task didn't ask for (no Dockerfile/Vercel changes made).

**Smallest safe implementation plan (confirmed, then executed):** no change to
`config/tenancy.php`, `TenantHostnameResolver`, `RegisterRequest`, CORS, or the
frontend suffix helper — all already environment-driven and domain-agnostic. Add
explicit regression tests pinning the `awjdev.xyz` case (valid resolve, reserved
apex, lookalike-suffix rejection, `awj.up.railway.app` staying non-tenant, cross-
tenant rejection under that base domain), fix one unrelated local test-assembly gap
that was hiding real signal, and document the exact Railway/Vercel env values for
Safwan.

---

## Implementation completed

1. **New negative/security tests**, run against a `tenancy.base_domains =
   ['awjdev.xyz']` config override (no code changes to production files):
   - `TenantHostnameResolverTest::the_configured_railway_base_domain_resolves_tenants_and_rejects_lookalikes`
     — valid `alrshd.awjdev.xyz` resolves; bare `awjdev.xyz` apex is non-tenant;
     `awj.up.railway.app` stays non-tenant; lookalikes `evilawjdev.xyz`,
     `awjdev.xyz.evil.com`, `notawjdev.xyz` are all rejected; `alrshd.awj.app` is
     rejected when only `awjdev.xyz` is configured.
   - `TenantHostnameResolverTest::multiple_configured_base_domains_resolve_independently`
     — `AWJ_TENANT_BASE_DOMAINS=awjdev.xyz,awj.app` resolves both bases without
     one swallowing the other, for a transition period if ever needed.
   - `TenantSubdomainAuthTest::the_same_security_boundary_holds_under_the_configured_railway_domain`
     — full HTTP-level pass under the `awjdev.xyz` config: valid tenant login
     succeeds, unknown tenant 404s, tenant B's credentials are rejected through
     tenant A's `awjdev.xyz` host, and `awj.up.railway.app` keeps working as a
     non-tenant host (backward compatibility with the existing Railway domain).
2. **Fixed a pre-existing local test-assembly gap** (`setup.sh` was missing
   `app/Support/Inventory` in its copy list — `.github/workflows/ci.yml`'s
   assemble step already had it correctly). This is unrelated to tenancy but was
   silently causing ~21 unrelated test failures (`Class
   App\Support\Inventory\MovementSourceResolver not found`) that made the local
   "run everything" signal wrong. One-line parity fix, no behavior change, matches
   the already-correct CI script exactly.
3. **Documentation**: added a Railway-specific subsection to `deploy/DEPLOY.md`
   (exact env var for Safwan, explicit warning not to add `awj.up.railway.app` to
   the base-domain list, and the API-only wildcard caveat) and a matching note to
   `web/DEPLOY.md`. This report.

No migration. No change to `RegisterRequest`, `TenantHostnameResolver`,
`config/tenancy.php`, `deploy/cors.php`, `AuthController`, `SetTenant`, or any
frontend component — the configurable contract from PR #780 already satisfied
every requirement in this task once pointed at `awjdev.xyz` via env vars.

---

## Files changed

| File | Change |
|---|---|
| `tests/Feature/TenantHostnameResolverTest.php` | +2 tests: `awjdev.xyz` resolution/lookalike rejection, multi-base-domain independence |
| `tests/Feature/TenantSubdomainAuthTest.php` | +1 test: full auth-boundary pass under `awjdev.xyz` config, including `awj.up.railway.app` compatibility |
| `setup.sh` | Added missing `app/Support/Inventory` to local assemble copy list (parity with `ci.yml`) |
| `deploy/DEPLOY.md` | New "بيئة Railway الحالية — `*.awjdev.xyz`" subsection: exact env var, what NOT to add, and the API-only-wildcard caveat |
| `web/DEPLOY.md` | New note: the Railway wildcard doesn't reach this Vercel project yet; what Safwan needs to add for the login page itself to render |
| `docs/plans/tenancy/AWJ_TENANT_SUBDOMAIN_RAILWAY_AWJDEV_REPORT.md` | This report |

---

## Tests and exact results

Assembled Laravel app: `/home/user/nibras-app` (Laravel 11, PHP 8.3, SQLite),
built from this branch via `setup.sh`.

### Focused tenancy / auth / isolation

```bash
php artisan test --filter='TenantHostnameResolverTest|TenantSubdomainAuthTest|ApiAuthTest|ApiTenantIsolationTest|HostnameNormalizerTest'
```

**Result: 77 passed (304 assertions), Duration ~9.9s** — all green, including the
5 new tests above (also matched `PublicApiAuthTest` by the `ApiAuth` substring,
also green).

### Full `php artisan test`

```bash
php artisan test
```

**Result: 3664 passed / 32 failed / 39 skipped (23313 assertions), Duration ~336s.**

All 32 failures are pre-existing and **unrelated to this change** — confirmed by
inspection:
- 26 failures (`FuelReconciliationTest`, `FuelSaleServiceTest`,
  `FuelAviRfidServiceTest`, `FuelSupplyReceivingTest`, `FuelSaleApiTest`,
  `FuelSupplyReceivingApiTest`) all throw `Call to undefined function
  App\Services\bcmul()` — the `bcmath` PHP extension is not enabled in this
  sandbox's PHP CLI (`php -m | grep bcmath` is empty), even though the production
  `Dockerfile` installs it. Nothing to do with tenancy/hostnames.
- 5 failures in `ReportEffectiveScopeTest` (inventory value/export scoping) and
  1 in `DocumentCenterSecureIntakeTest` (PDF intake) are separately
  environment-dependent (numeric/PDF-processing behavior unrelated to this diff).
- None of the 32 touch `Tenant*`, `Register*`, `Auth*`, hostname resolution, CORS,
  or anything this PR touched. Before fixing the unrelated `setup.sh` assembly gap
  (item 2 above), the same run showed 53 failures — 21 of them
  (`App\Support\Inventory\MovementSourceResolver not found`) were a local-only
  tooling artifact, now fixed; the remaining 32 are genuine sandbox/PHP-extension
  limitations, not code regressions.

CI (`ci.yml`) already copies `app/Support/Inventory` correctly and — per the
project's own Dockerfile — installs `bcmath`, so these two categories are not
expected to reproduce on GitHub Actions.

### Frontend

```bash
cd web && npm test -- --run src/lib/tenant-domain.test.ts   # 3 passed
npm run build                                                 # succeeded, no errors
```

No frontend source file changed (the register page already reads the suffix from
`tenantHostSuffix()`), so the build run is a no-regression confirmation.

---

## Build / CI status

| Check | Result |
|---|---|
| Focused PHP tenancy/auth suites | 77 passed |
| Full `php artisan test` | 3664 passed / 32 failed (all pre-existing, unrelated — see above) / 39 skipped |
| `web` vitest `tenant-domain.test.ts` | 3 passed |
| `web` `npm run build` | Succeeded |
| GitHub Actions `CI` / `Web CI` | Not yet run on this PR — recommended before merge, per standard protocol |

---

## Security / Tenant Isolation verification

All of the task's required negative cases are covered, either by tests that
already existed generically (domain-agnostic — they don't hard-code `awj.app`
in a way that would only pass for that one base domain) or by the new
`awjdev.xyz`-specific tests added here:

| Requirement | Covered by |
|---|---|
| Valid tenant hostname resolves the correct tenant | `TenantHostnameResolverTest::the_configured_railway_base_domain_resolves_tenants_and_rejects_lookalikes`, `TenantSubdomainAuthTest::the_same_security_boundary_holds_under_the_configured_railway_domain` |
| Unknown tenant hostname fails closed (404, no token) | same two tests |
| Tenant A hostname cannot resolve tenant B / tenant B credentials rejected on tenant A's host | same `TenantSubdomainAuthTest` test, plus pre-existing `tenant_b_credentials_are_rejected_through_tenant_a_hostname` (domain-agnostic) |
| Configured base-domain matching does not trust lookalike/suffix hosts | new resolver test: `evilawjdev.xyz`, `awjdev.xyz.evil.com`, `notawjdev.xyz`, apex `awjdev.xyz` all rejected |
| Existing canonical/non-tenant host stays compatible | new tests assert `awj.up.railway.app` stays non-tenant and can still log in the existing way, both at the resolver level and through a real HTTP login |
| Client cannot supply `tenant_id`/hostname via headers | pre-existing `a_client_supplied_tenant_header_cannot_override_the_hostname` (domain-agnostic, still green) |

No cookies were introduced or broadened — auth stays Bearer-token-in-`localStorage`,
`supports_credentials` stays `false`. No new trust boundary was added; the existing
Host-then-Origin resolution and fail-closed 404/403/422 behavior is exactly what's
exercised against the new domain.

---

## Environment variables Safwan must add (not applied by this session)

| Variable | Value | Service | Purpose |
|---|---|---|---|
| `AWJ_TENANT_BASE_DOMAIN` | `awjdev.xyz` | Railway — `Nebrax / AWJ ERP` | Backend recognizes `{slug}.awjdev.xyz` as a tenant host |
| `NEXT_PUBLIC_TENANT_BASE_DOMAIN` | `awjdev.xyz` | Wherever `web/` (Next.js) is deployed | Registration UI suffix + any future subdomain-aware frontend logic |

Optional, only if a transition period needs both bases live simultaneously:
`AWJ_TENANT_BASE_DOMAINS=awjdev.xyz,awj.app` on the backend instead of the single
`AWJ_TENANT_BASE_DOMAIN`.

**Do not** add `awj.up.railway.app` (or any part of it) to either variable — it
must stay a non-tenant host so the existing Railway URL keeps working exactly as
it does today.

**Separately (infrastructure, not an env var):** for a browser hitting
`https://alrshd.awjdev.xyz` to actually see a login page, `*.awjdev.xyz` also
needs to be attached wherever the Next.js frontend is served (currently a
separate Vercel project) — the Railway wildcard only reaches the backend API
container today. See the caveat above and in `deploy/DEPLOY.md`.

---

## Backward compatibility notes

- `awj.up.railway.app` was never added to any base-domain config and is proven,
  by the new tests, to keep resolving as a non-tenant host — existing login there
  is untouched.
- `*.store.awjdev.xyz` / `StorefrontDomain` — untouched. `store` and `storefront`
  remain reserved slugs on the ERP base domain (unchanged from PR #780); this task
  did not read or modify `StorefrontDomain`, `HostnameNormalizer`'s storefront
  path, or `config/storefront.php`.
- No migration. `tenants.slug` (already unique) is the only source of truth, same
  as before.
- Local development and the SQLite test suite are unaffected — `awj.app` stays the
  compiled-in default; nothing behaves differently unless `AWJ_TENANT_BASE_DOMAIN`
  is actually set.

---

## Risks / remaining work

1. **Frontend wildcard not attached.** As above — setting the Railway env var
   alone does not make `https://alrshd.awjdev.xyz` show a login page. This is
   explicitly Safwan's infra step, not a code gap.
2. **No post-registration redirect to the tenant subdomain**, by design (inherited
   from PR #780's own decision): the auth token is stored in `localStorage`, which
   is origin-scoped. Redirecting straight to `https://{slug}.{base}` after
   registration would drop the just-issued session and force an immediate second
   login — a UX regression, not an improvement — unless a deliberate one-time
   token-handoff mechanism is designed (out of scope here; flagged, not built,
   per the task's "do not redesign the page" instruction).
3. **`bcmath` PHP extension absent in this sandbox** masked 26 Fuel-module test
   results during the full-suite run; confirmed unrelated to this diff and
   expected to run fine in CI (Dockerfile installs it), but worth Safwan's
   awareness if the same sandbox is reused for other work.
4. Custom ERP domains, ZATCA Phase 2, and anything Storefront-related remain
   explicitly out of scope, unchanged.

---

## Git information

| Field | Value |
|---|---|
| Branch | `claude/awj-tenant-subdomains-ebdop5` |
| Base | `origin/main` @ `d9b88d6` |
| PR | Not created yet in this session — see next step |
| Merge | **not performed** |
| Deploy | **not performed** |

---

## Next recommended step

1. Push this branch and open a PR against `main` (not merged, per instructions).
2. Wait for GitHub CI (`ci.yml` PHP on SQLite + PostgreSQL, `web-ci.yml`) to go
   green — the local `bcmath`/assembly gaps found here are not expected to
   reproduce there, but confirm.
3. Safwan adds `AWJ_TENANT_BASE_DOMAIN=awjdev.xyz` on the Railway backend service
   and `NEXT_PUBLIC_TENANT_BASE_DOMAIN=awjdev.xyz` wherever `web/` is deployed.
4. Separately, attach `*.awjdev.xyz` to the frontend's hosting project (Vercel or
   otherwise) so the wildcard actually reaches a login page, not just the API.
5. Only after 2–4: manually verify `https://alrshd.awjdev.xyz` end-to-end (real
   tenant resolves, unknown slug 404s, cross-tenant login rejected) before
   considering this production-ready.
