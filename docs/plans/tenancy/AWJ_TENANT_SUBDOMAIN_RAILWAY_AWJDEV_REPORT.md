# AWJ Tenant Subdomains — Railway `*.awjdev.xyz` Completion Report

**Date:** 2026-09-14 (updated same day — infrastructure-finding correction)
**Status:** IMPLEMENTED ON PR — **NOT MERGED — NOT DEPLOYED**
**Branch:** `claude/awj-tenant-subdomains-ebdop5`
**PR:** [#816](https://github.com/safwan5001-source/Nebrax/pull/816)

---

## Status

Code-level, the tenant-subdomain contract this task asked for **already exists and is
already environment-configurable** — it shipped in PR #780 (`cf97b25`, merged to
`main`) as V1 of `{slug}.awj.app`. This task's job was to confirm that contract
actually covers the live Railway environment (`*.awjdev.xyz`) with **zero
hard-coded `awjdev.xyz`**, close the test-coverage gap the task asked for
explicitly, and document the exact env vars needed. No production business
logic changed in this PR at any point, in either pass.

This revision **corrects one infrastructure claim** made in the first version of
this report, after live evidence proved it wrong. See below.

---

## Infrastructure finding correction

**What the previous version of this report got wrong:** it concluded, from the
root `Dockerfile` alone (`php artisan serve` — a Laravel-only image, no Next.js
process in it), that the Railway service serves the backend API exclusively, and
that `*.awjdev.xyz` therefore reaches JSON only — not an HTML page — and that
Vercel would need the wildcard attached separately for a login page to render.
That inference was reasonable from the repository alone, but it is **not what is
actually deployed**, and the report stated it too confidently as if the repository
proved it.

**What live evidence actually proves:** `https://alrshd.awjdev.xyz` was tested
directly and returns the full AWJ HTML frontend over HTTPS, at that exact
hostname. This proves:

1. DNS resolution for `alrshd.awjdev.xyz` works.
2. TLS works.
3. The Railway wildcard routing works.
4. The request reaches a service that renders full HTML (Next.js output), not a
   bare JSON API.
5. It is **not** merely hitting the Laravel API.

**What the repository can and cannot prove about *why*:** this core repo contains
no `routes/web.php`, no `public/` HTML, and no static Next.js export
(`web/next.config.mjs` has no `output: 'export'`) that could be baked into the
Laravel image — so the Laravel core by itself cannot explain how HTML is being
served at that host. That rules out "Laravel is quietly also serving the frontend
via this Dockerfile" as the explanation. Beyond that, **the repository does not
contain enough evidence to prove which runtime is currently serving
`alrshd.awjdev.xyz` in production** — it could be the documented Vercel
deployment (`web/vercel.json`, `web/DEPLOY.md`) already having the wildcard
attached, a different Railway service not represented in this repo, or some other
routing/proxy layer. **This report does not guess which one it is, and does not
recommend attaching the wildcard to Vercel** — that instruction from the first
version is retracted as unsupported. No DNS, Railway, or Vercel change is
requested by this correction.

---

## Tenant-host finding

**Why the public landing page renders at `alrshd.awjdev.xyz` instead of a
tenant-specific view:** inspecting `web/src/app/` shows **no `middleware.ts`**
and no other hostname-aware routing anywhere in the Next.js app. The root route
(`web/src/app/page.tsx`) is a static marketing/landing page that renders
identically regardless of the request's `Host` header — there is no code path in
the frontend that branches on subdomain. Grepping the entire `web/src` tree for
consumers of the tenant-domain helpers confirms `NEXT_PUBLIC_TENANT_BASE_DOMAIN`
is read in exactly one place, `web/src/lib/tenant-domain.ts`
(`tenantHostSuffix()`), and used only to render the `.{base}` suffix text next to
"صفحة الدخول" on the **registration form**. It does not drive any redirect,
route guard, or conditional rendering.

**Conclusion:** the public landing page appearing at `alrshd.awjdev.xyz` is
**expected behavior under the existing PR #780 architecture, regardless of
whether `AWJ_TENANT_BASE_DOMAIN` / `NEXT_PUBLIC_TENANT_BASE_DOMAIN` are set to
`awjdev.xyz` or not.** Setting those variables will not change what `/` renders
on that host — there is no frontend logic that would react to it. This is **not
a missing-configuration symptom**; it is a scope boundary that already existed
before this task: PR #780 built tenant recognition as a **backend** (Laravel API)
concern only — resolved from `Host` then `Origin` during actual API calls (login,
authenticated requests) — and deliberately did not build any frontend
hostname-based routing or a distinct "tenant landing" experience. The previous
version of this report's own "Risks" section already flagged this as inherited,
unimplemented scope (item 2, no post-registration redirect); this pass confirms
the same gap also explains the landing-page observation.

**What setting the variables *does* affect:** once `AWJ_TENANT_BASE_DOMAIN=awjdev.xyz`
is set on the backend, an API call made from the `alrshd.awjdev.xyz` origin (e.g.
the browser's `Origin` header when the page's JS calls `/api/login`) will let
`TenantHostnameResolver` recognize `alrshd` as the tenant slug and enforce the
cross-tenant/unknown-tenant/fail-closed rules described below — **but the page
itself will still visually be the same generic landing page**, because nothing
routes differently. Whether the *user experience* (redirecting to a login form,
or otherwise making the tenant context visible pre-auth) should change is a
frontend-routing decision outside this task's corrected scope — it was outside
scope in the original PR #780 too, and remains so here.

**Are both variables required?** They serve different, independent purposes and
neither substitutes for the other:
- `AWJ_TENANT_BASE_DOMAIN` (Laravel `config/tenancy.php`, also read by
  `deploy/cors.php`): required for the **backend** to recognize
  `{slug}.awjdev.xyz` as a tenant host at all (`TenantHostnameResolver`) and to
  allow tenant-subdomain browser origins through CORS. Without it, `awjdev.xyz`
  hosts stay in the existing non-tenant mode (email-derived tenant, current
  behavior — not broken, just not subdomain-aware).
- `NEXT_PUBLIC_TENANT_BASE_DOMAIN` (Next.js, build-time): only affects the
  registration form's displayed suffix text. Without it, the suffix falls back to
  the compiled-in default (`awj.app`) — cosmetic only, not a resolution failure.

Setting both to `awjdev.xyz` is **sufficient**, under the existing PR #780
architecture, to make backend tenant-host recognition work end-to-end for that
domain and to make the registration form display the correct suffix. It is
**not** sufficient to make the initial page render differently per tenant host —
that was never built, in either PR.

**No regression found.** Nothing above indicates a bug in the already-approved
PR #780 contract; the behavior is exactly what that design intended and
documented. No application code was changed as a result of this investigation.

---

## Environment configuration

| Variable | Required value | Runtime that consumes it | Effect |
|---|---|---|---|
| `AWJ_TENANT_BASE_DOMAIN` | `awjdev.xyz` | The deployed Laravel/API runtime (`config/tenancy.php`, `deploy/cors.php`) — repository does not prove which infrastructure this is; set it on whichever service actually runs `php artisan serve` for this app | Backend recognizes `{slug}.awjdev.xyz` as a tenant host; CORS allows tenant-subdomain browser origins |
| `NEXT_PUBLIC_TENANT_BASE_DOMAIN` | `awjdev.xyz` | The deployed Next.js runtime (`web/src/lib/tenant-domain.ts`) — repository documents Vercel (`web/vercel.json`, `web/DEPLOY.md`) as the intended target, but cannot prove that is what currently serves `alrshd.awjdev.xyz` live | Registration form displays the correct `.awjdev.xyz` suffix |

Optional (only if both `awjdev.xyz` and `awj.app` must resolve simultaneously
during a transition): `AWJ_TENANT_BASE_DOMAINS=awjdev.xyz,awj.app` on the backend,
in place of the single `AWJ_TENANT_BASE_DOMAIN`.

No new variables invented. No Railway/Vercel configuration was changed by this
session — this table is a report for Safwan to apply manually.

---

## Files changed (this correction pass)

| File | Change |
|---|---|
| `deploy/DEPLOY.md` | Corrected the Railway subsection: removed the unsupported "API-only, Vercel must receive the wildcard" claim; documented the live-evidence finding, what the repo can/cannot prove about the serving runtime, and that both env vars are still needed regardless |
| `web/DEPLOY.md` | Corrected the matching frontend-side note with the same live-evidence finding and the "landing page is expected regardless of config" clarification |
| `docs/plans/tenancy/AWJ_TENANT_SUBDOMAIN_RAILWAY_AWJDEV_REPORT.md` | This report, rewritten with the correction |

No test files changed in this pass — the tests added in the prior pass (5 new
tests in `TenantHostnameResolverTest.php` and `TenantSubdomainAuthTest.php`) are
resolver/auth-level and already domain-agnostic at the code level; they were not
testing frontend routing or landing-page rendering, so the corrected
understanding does not invalidate them.

---

## Tests

No application or test code changed in this correction — only documentation. Per
the instruction to run only tests relevant to an actual change, and since none
were made, the previously reported focused-suite result stands and was not
re-run in this pass:

- Focused tenancy/auth suite (`TenantHostnameResolverTest`, `TenantSubdomainAuthTest`,
  `ApiAuthTest`, `ApiTenantIsolationTest`, `HostnameNormalizerTest`): **77/77
  passed**, unchanged from the previous report.
- Frontend `tenant-domain.test.ts`: **3/3 passed**, unchanged.

The full-suite pre-existing failures (`bcmath` extension absent in this sandbox,
etc.) reported previously were left as-is, per instruction not to spend effort
re-chasing unrelated failures in this pass.

---

## Security / Tenant Isolation

**No security boundary changed.** This pass made no changes to
`TenantHostnameResolver`, `IdentifyTenantHostname`, `AuthController`, `SetTenant`,
`config/tenancy.php`, `deploy/cors.php`, or any frontend routing/auth code —
documentation only. The Host-then-Origin resolution, fail-closed 404 on
unknown/inactive tenants, 422-on-cross-tenant-credentials (same message as a
wrong password), 403-on-hostname/user mismatch post-auth, and rejection of
client-supplied `X-Tenant-*` headers all remain exactly as verified in the prior
pass — none of that logic is affected by which runtime happens to render the
public landing page.

---

## Backward compatibility

**`awj.up.railway.app`:** unaffected by this correction. No base-domain
configuration change was made or recommended. The resolver tests added in the
prior pass (`TenantHostnameResolverTest`, `TenantSubdomainAuthTest`) already
assert `awj.up.railway.app` stays a non-tenant host under an `awjdev.xyz`-only
`tenancy.base_domains` config — that guarantee is untouched by this correction and
remains true regardless of which runtime turns out to be serving
`alrshd.awjdev.xyz`. Do not add `awj.up.railway.app` to `AWJ_TENANT_BASE_DOMAIN`
or `AWJ_TENANT_BASE_DOMAINS` — same guidance as before, unchanged.

---

## Remaining production verification

Once Safwan applies `AWJ_TENANT_BASE_DOMAIN=awjdev.xyz` (backend) and
`NEXT_PUBLIC_TENANT_BASE_DOMAIN=awjdev.xyz` (frontend), the following should be
verified live — none of this is proven yet, only the code contract that should
produce it:

1. `https://alrshd.awjdev.xyz` — a real API call from that origin (e.g.
   submitting the login form for a user belonging to tenant `alrshd`) is
   recognized as tenant `alrshd` by the backend (check via a successful login
   response, or inspect that `HostnameTenantContext` is set — not observable from
   outside, so a functional login test is the practical check).
2. Confirm explicitly that step 1 still shows the **generic landing page** on
   first load at `/` — that is expected, not a bug — and that tenant recognition
   only becomes observable once a form actually calls the API from that origin.
   Do not treat continued display of the landing page as a failure, and do not
   treat it as proof of success either — only an actual login/API round trip
   confirms resolution.
3. An unknown tenant hostname (e.g. `https://does-not-exist.awjdev.xyz`) fails
   closed — a login attempt from that origin returns 404, not a guess or a
   fallback to non-tenant mode.
4. A lookalike hostname (e.g. `https://evilawjdev.xyz` or
   `https://awjdev.xyz.example.com`, if reachable at all under whatever DNS
   exists for them) is never treated as a tenant host — already proven at the
   code level by the added tests; worth a live spot-check only if such a host is
   actually reachable.
5. `https://awj.up.railway.app` continues to work exactly as it does today
   (non-tenant login path) — unaffected by any of the above.

---

## Git

| Field | Value |
|---|---|
| PR | [#816](https://github.com/safwan5001-source/Nebrax/pull/816) |
| Branch | `claude/awj-tenant-subdomains-ebdop5` |
| Base SHA | `d9b88d6` (`origin/main`) |
| Previous head SHA | `29d6f12` (tests + docs + `setup.sh` parity fix) |
| Updated head SHA | set after this correction commit — see PR for current tip |
| Merge | **not performed** |
| Deploy | **not performed** |

---

## Next step

Do not merge or deploy. Waiting on Safwan's review and approval, and on Safwan
to apply the two environment variables above wherever the respective runtimes
actually run (their identity not being provable from this repository alone).
