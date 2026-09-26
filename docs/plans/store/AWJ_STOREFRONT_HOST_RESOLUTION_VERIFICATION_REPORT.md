# AWJ Storefront Host Resolution Verification

**Task:** VERIFY-STOREFRONT-HOST-1
**Status:** **VERIFIED_WITH_GAPS**
**Date:** 2026-09-16
**Base:** `dc03db7ae95f12e50ab520a6ae08bbebff9b6df8` (main)
**Scope:** Verification only. No provisioning, no merge, no deploy. No application code changed.

This report is evidence for the next task, `COM-STORE-PROVISION-1`. It does not redesign the
architecture defined in `AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md` — it confirms that
architecture against the current code and states exactly what is missing to make
`alrshd.store.awjdev.xyz` a real, working storefront.

---

## 1. Current request-resolution chain

```
Host (alrshd.store.awjdev.xyz)
  → App\Support\HostnameNormalizer::normalize()            (app/Support/HostnameNormalizer.php)
  → App\Http\Middleware\ResolveStorefrontDomain::handle()   (app/Http/Middleware/ResolveStorefrontDomain.php)
      → App\Models\StorefrontDomain  (exact hostname match, is_active, verification_status = verified)
      → App\Tenancy\TenantContext::set($domain->tenant_id)
      → App\Models\Storefront        (whereKey($domain->storefront_id), is_active)
      → App\Models\SalesChannel      (whereKey($storefront->sales_channel_id), type=web, is_active)
      → App\Tenancy\StorefrontContext::set(tenant, channel, storefront)
  → routes/api_storefront.php  (store/v1/{categories,products,media,storefront,cart,checkout})
      → controllers read only from StorefrontContext + TenantScope-filtered queries
```

Registered in `routes/api_storefront.php` under `Route::middleware([ResolveStorefrontDomain::class, EnforcePublicApiRateLimit::class.':unauth'])`. Every failure at any step aborts with a
uniform, non-revealing **404** — no distinction between "unknown host", "unverified", "inactive
storefront", "inactive channel", etc.

**Files / classes / methods that establish this boundary:**

| Role | File | Class::method |
|---|---|---|
| Hostname normalization | `app/Support/HostnameNormalizer.php` | `HostnameNormalizer::normalize()` |
| Host → Tenant/Storefront/Channel resolver (production authority) | `app/Http/Middleware/ResolveStorefrontDomain.php` | `ResolveStorefrontDomain::handle()` |
| Domain record + verification | `app/Models/StorefrontDomain.php` | `isVerified()`, `booted()` |
| Storefront record | `app/Models/Storefront.php` | `booted()` (channel ownership + type re-check) |
| Sales channel record | `app/Models/SalesChannel.php` | — |
| Anonymous trusted context carrier | `app/Tenancy/StorefrontContext.php` | `set()/tenantId()/salesChannelId()/storefrontId()` |
| Route registration | `routes/api_storefront.php` | trusted group vs. non-production legacy group |
| Next.js → Laravel trust gateway | `app/Http/Middleware/ResolveStorefrontDomain.php::incomingHostname()` + `config/storefront.php` | secret-gated `X-Storefront-Forwarded-Host` |
| Next.js-side host resolution | `storefront/src/lib/commerce/config.ts` | `resolveVisitorHostname()`, `storefrontFetch()` |
| Legacy dev-only resolver (not production authority) | `app/Http/Middleware/ResolveStorefrontTenant.php` | rejects itself when `app()->environment('production')` |

### Answers to the ten critical questions (§5)

1. **Runtime:** Laravel (`store/v1/*` routes), called server-side by the Next.js `storefront/`
   app — never the browser directly in production.
2. **Hostname extraction/normalization:** `ResolveStorefrontDomain::incomingHostname()` picks
   either `$request->getHost()` or a secret-gated `X-Storefront-Forwarded-Host` header, then
   `HostnameNormalizer::normalize()` strips scheme/path/query/port, lowercases, and validates
   syntax (≥2 labels, RFC label rules).
3. **Resolver:** `App\Http\Middleware\ResolveStorefrontDomain` (middleware, not a controller).
4. **Queries `StorefrontDomain`?** Yes — exact-match `where('hostname', $hostname)` **before** any
   `TenantContext` is set (a deliberate global, cross-tenant lookup, since the hostname is the sole
   entry point).
5. **Requires `verified`?** Yes — `$domain->isVerified()` (i.e.
   `verification_status === 'verified'`), plus `is_active`.
6. **Resolves exactly one Storefront?** Yes — `Storefront::whereKey($domain->storefront_id)`, a
   primary-key lookup, further filtered by `is_active`.
7. **TenantContext establishment:** `$this->tenantContext->set($domain->tenant_id)` — set from the
   resolved domain's `tenant_id` only, torn down in a `finally` block after the request.
8. **SalesChannel establishment:** `SalesChannel::whereKey($storefront->sales_channel_id)->where('type','web')->where('is_active',true)` — re-validated live, not trusted from the FK alone.
9. **Do catalog queries inherit this context?** Yes — `StorefrontProductController`/
   `StorefrontCategoryController` read `StorefrontContext::salesChannelId()`/`tenantId()` only;
   `Product`/`CommerceListing` queries are additionally filtered by the standard `TenantScope`
   (belt-and-suspenders: FK trust is never assumed).
10. **Can any request parameter override host-derived identity?** No. Verified by code inspection
    (no controller reads `tenant_id`/`storefront_id`/`sales_channel_id` from request input) and by
    passing tests: `tenant_id` query param, `X-Tenant-ID` header, `tenant_id` cookie, an arbitrary
    `Authorization` header, and `locale` switching are all inert
    (`StorefrontDomainResolutionApiTest`).

---

## 2. Live smoke interpretation

The successful browser load of `https://alrshd.store.awjdev.xyz` proves:

- DNS for `*.store.awjdev.xyz` resolves.
- TLS terminates correctly for that wildcard.
- The Railway `storefront` (Next.js) service is reachable and renders a full page (not a raw
  error).

It does **not** prove:

- That `alrshd.store.awjdev.xyz` exists as a `StorefrontDomain` row, verified or otherwise.
- That the Laravel `store/v1/storefront` / `store/v1/products` calls the page makes are
  succeeding rather than 404-ing.
- That `ResolveStorefrontDomain` ever authoritatively resolved anything for this hostname.

**Why the page looks generic regardless of which of those is true — this is the key finding:**
every one of the three data-fetching call sites on the homepage independently swallows a failed
API call and substitutes a locale-generic fallback:

- `storefront/src/lib/commerce/storefront.ts::fetchStorefrontName()` — `try { ... } catch { return
  null; }`. Any error from `storefrontFetch('storefront')` (a 404 from `ResolveStorefrontDomain`
  included) becomes `null`.
- `storefront/src/components/layout/Header.tsx` (and `Footer.tsx`) —
  `displayName = storeName?.trim() || footer("shop")`, i.e. a translated generic "Shop" label
  whenever the name is `null`.
- `storefront/src/components/products/FeaturedProducts.tsx` —
  `cachedListProducts(...).catch(() => [])`, then renders a "no products found" empty state.
- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx::getRootCategories` — same
  `.catch(() => EMPTY_CATEGORIES)` pattern for the category nav.

So **a completely unresolved host** (no `StorefrontDomain` row at all — every `store/v1/*` call
404s) and **a resolved-but-empty store** (a real, verified domain whose tenant genuinely has zero
published products) render **visually identically**: generic Arabic shell, generic heading, empty
product grid. The screenshot alone cannot distinguish them — this is §6's answer C combined with a
consequence of A/D being visually indistinguishable from the frontend alone. This is a legitimate,
intentional resiliency pattern (a storefront should never hard-crash on a transient API failure),
but it means **the frontend cannot be used as a diagnostic signal here** — only a direct backend
check can.

One additional, weaker signal: because the fallback name is a *generic translated label*, not
`null`/blank, a resolved `Storefront.name` (which the seed/registration flow sets from the tenant
or channel name, e.g. "المتجر الرئيسي") would visually differ from the generic "Shop"/"متجر" label
shown in the screenshot's description. This does not prove resolution failed (an operator could
have registered the domain with `name` unset), but the description as given ("generic store
heading") is consistent with the fallback path having fired.

### Production data uncertainty

**Repository evidence cannot prove or disprove that `alrshd.store.awjdev.xyz` currently exists as
a verified `StorefrontDomain` row.** No migration, seeder, or committed report in this repository
creates that row. The only mechanism that could have created it —
`php artisan storefront:register-domain <tenant> alrshd.store.awjdev.xyz --yes` — has no
corresponding execution record in the repository (compare to
`docs/plans/store/AWJ_STOREFRONT_FIRST_PREVIEW_DEPLOYMENT_REPORT.md`, which documents the same gap
for an earlier Vercel-based preview and was explicitly left **BLOCKED — NOT executed**). The
Railway `*.store.awjdev.xyz` wildcard itself is dashboard-configured infrastructure with no
corresponding file in this repository (no `railway.json`/`railway.toml`), so it is invisible to
repository evidence by construction.

**This session's sandbox network policy explicitly denies outbound requests to
`alrshd.store.awjdev.xyz`** (`recentRelayFailures: [{"kind":"connect_rejected", "host":
"alrshd.store.awjdev.xyz:443", "detail": "gateway answered 403 to CONNECT (policy denial or
upstream failure)"}]`), so a live read-only check was not possible from here either.

**Required production check (read-only, safe to run, does not touch data):**

```bash
# Against the deployed production database (Render shell / php artisan tinker), NOT executed here:
php artisan tinker
>>> \App\Models\StorefrontDomain::withoutGlobalScope(\App\Tenancy\TenantScope::class)
        ->where('hostname', 'alrshd.store.awjdev.xyz')->first();
```

or equivalently, a direct HTTP check against the Laravel backend itself (bypassing the Next.js
fallback layer entirely) once its real base URL is known:

```bash
curl -s https://<laravel-backend-host>/store/v1/storefront -H "Host: alrshd.store.awjdev.xyz"
# 200 + {"data":{"name":...}}  → domain resolves (case A)
# 404                          → domain missing/unverified/inactive (case D/E)
```

Neither command was run against production in this session.

---

## 3. Storefront base-domain configuration

**No existing environment-configurable base-domain contract exists for public commerce
storefronts.** This was searched for specifically (`store.awjdev.xyz`, `store.awj.app`,
`STORE_BASE_DOMAIN`, `STOREFRONT_BASE_DOMAIN`, and any storefront-side equivalent of
`NEXT_PUBLIC_TENANT_BASE_DOMAIN`) — none exist.

What **does** exist is a different, unrelated contract for the ERP tenant subdomain
(`{slug}.awjdev.xyz` → the Next.js `web/` admin app), governed by `AWJ_TENANT_BASE_DOMAIN` /
`AWJ_TENANT_BASE_DOMAINS` (`config/tenancy.php`) and `NEXT_PUBLIC_TENANT_BASE_DOMAIN`
(`web/src/lib/tenant-domain.ts`). This is PR #780/#816's territory and is explicitly **not** the
commerce storefront's base domain. The tenancy implementation report itself flags this
distinction: `docs/plans/tenancy/AWJ_TENANT_SUBDOMAIN_V1_IMPLEMENTATION_REPORT.md` §"Storefront
hostname collision" states *"A future `{slug}.store.awj.app` pattern needs a **different** base,
not `StorefrontDomain` rows for ERP slugs."*

**By design, storefront hostnames are not wildcard/pattern-matched at all.** `ResolveStorefrontDomain`
does an exact-string lookup against `storefront_domains.hostname` (one persisted row per hostname,
each independently verified). There is no `*.store.{base}` wildcard concept anywhere in the
resolution code — every storefront hostname, whether `alrshd.store.awjdev.xyz` today or
`alrshd.store.awj.app` tomorrow, must be **registered as its own row** via
`storefront:register-domain` (or a future provisioning flow). Switching the *suffix* used going
forward is an operational/DNS decision (what hostnames get registered), not a code or environment
variable change — there is nothing to "switch via configuration" because there is no base-domain
variable driving generation of expected hostnames.

**Answering §7 directly:**

- Existing config key/env var for storefront base domain: **none.**
- `store.awjdev.xyz` configurable without code changes: **yes, trivially** — it already works with
  zero code changes, because nothing in the code hardcodes a suffix; any hostname string can be
  registered as a `StorefrontDomain` row.
- Production switching to `store.awj.app` via configuration only: **not applicable in the sense
  asked** — there is no config toggle to flip, because the model was never suffix-based. Moving to
  `store.awj.app` means registering new `StorefrontDomain` rows with that hostname (and DNS/TLS
  for that wildcard) — a data/infra change, not a code or env change. If AWJ wants a *generated*
  default hostname per tenant (e.g. auto-provisioning `{slug}.store.awj.app` the moment a
  `Storefront` is created, mirroring how `AWJ_TENANT_BASE_DOMAIN` drives the ERP subdomain), **that
  contract does not exist today** — this is the gap `COM-STORE-PROVISION-1` will need to close if
  auto-provisioning (rather than one-by-one manual registration) is the goal.

---

## 4. Domain registration mechanism

**`php artisan storefront:register-domain {tenant} {hostname} [--channel=] [--make-primary] [--yes]`**
(`app/Console/Commands/RegisterStorefrontDomainCommand.php`).

| Aspect | Behavior |
|---|---|
| Tenant selection | Explicit argument only — UUID or slug, resolved via `Tenant::query()`; **never guesses**, fails clearly if not found |
| Storefront selection | Not selected directly — derived from the tenant's single active `web` `SalesChannel` (or `--channel=<id\|slug>` if more than one exists); `firstOrCreate`s a `Storefront` for that channel if none exists yet |
| Normalization | `HostnameNormalizer::normalize()` — same single code path as the resolver and the model's `setHostnameAttribute()` |
| Verification behavior | Sets `verification_status = VERIFICATION_VERIFIED` **directly** — there is no DNS-challenge/automated verification step in this repository; the operator is asserting ownership by running the command |
| Primary-domain behavior | Only via explicit `--make-primary` flag (never implicit, so it never silently displaces an existing primary) |
| Duplicate/collision protection | Global (cross-tenant) uniqueness check before any write; refuses with a clear error if the hostname belongs to another tenant, and never transfers a hostname between tenants |
| Tenant isolation safeguards | Runs inside `TenantContext::set($tenant->id)` for the duration of the command (`finally` tears it down); the model-level `booted()` hooks on `Storefront`/`StorefrontDomain` independently re-verify channel/storefront ownership matches the tenant |
| Idempotency | Re-running with identical inputs is a no-op success (asserts existing state matches, does not duplicate); conflicting existing state (hostname bound to a different storefront) is a hard failure, never silently overwritten |
| Creates a `SalesChannel`? | **Never** — fails with a clear message if no active `web` channel exists, by design (COM-7-PREVIEW-FIX-1: a sales channel is a real commercial decision, not a side effect of domain registration) |

**Safety for registering `alrshd.store.awjdev.xyz`:** yes, this command is the correct, safe,
existing mechanism — **conditional on the tenant already having an active `web` `SalesChannel`**
(created via `sales-channel:ensure-web` if missing, per this task's evidence in §4 of the task
description — that command was not modified and was not run here). It was **not executed** against
production in this session, per the task's explicit instruction.

---

## 5. Tenant Isolation / Security

All verified by passing automated tests (`tests/Feature/StorefrontDomainResolutionApiTest.php`,
`tests/Feature/StorefrontGatewayAndConfigTest.php`, `tests/Feature/StorefrontModelTest.php`),
re-run in this session:

| Case | Behavior | Evidence |
|---|---|---|
| Unknown host | 404, non-revealing | `unknown_hostname_fails_closed` |
| Cross-tenant (two verified domains, two tenants) | Each host returns only its own tenant's products/categories; direct ID access to the other tenant's product via the wrong host is 404 | `domain_a_resolves_only_to_tenant_storefront_channel_a`, `domain_b_resolves_only_to_tenant_storefront_channel_b`, `direct_product_access_cannot_cross_tenant_through_hostname_manipulation`, `category_tree_is_tenant_isolated_through_the_host_resolved_path` |
| Lookalike host (`awjdev.xyz.evil.com`, `alrshd.store.awjdev.xyz.evil.com`, `alrshd.store.evilawjdev.xyz`, `evil-alrshd.store.awjdev.xyz`) | 404 — exact-string lookup means these are simply different, unregistered hostnames; the real domain in the same DB still resolves correctly | **New test added this session:** `lookalike_hostnames_around_a_real_verified_domain_fail_closed` |
| Unverified domain (`pending`/`failed`) | 404 | `an_unverified_custom_domain_fails_closed`, `a_failed_verification_domain_fails_closed` |
| Inactive domain | 404 | `an_inactive_domain_fails_closed` |
| Inactive storefront | 404 | `an_inactive_storefront_fails_closed` |
| Inactive sales channel | 404 | `an_inactive_sales_channel_fails_closed` |
| Channel type changed away from `web` after storefront creation | 404 (live re-check, not just FK trust) | `a_channel_that_changes_away_from_web_type_can_no_longer_establish_storefront_authority` |
| Client-supplied `tenant_id` query param | Ignored entirely | `a_conflicting_client_supplied_tenant_id_never_changes_authority` |
| `X-Tenant-ID` header + `tenant_id` cookie | Ignored entirely | `a_tenant_like_client_header_or_cookie_never_changes_authority` |
| Arbitrary `Authorization` header | Ignored (no auth on this path at all) | `an_authorization_header_never_influences_domain_resolution` |
| Locale switching | Never changes resolved identity | `locale_switching_never_changes_the_resolved_tenant_storefront_or_channel` |
| Malformed host (`localhost`, single-label) | 404 via `HostnameNormalizer`, not a crash | `a_malformed_hostname_fails_closed_instead_of_crashing` |
| Next.js↔Laravel forwarded-host gateway: wrong/missing secret | Header ignored, falls back to connection host (safe default) | `an_incorrect_gateway_secret_is_ignored_and_falls_back_to_the_connection_host`, `an_unconfigured_gateway_secret_disables_the_forwarded_host_mechanism_entirely`, `a_forwarded_host_alone_without_the_secret_header_at_all_is_ignored` |
| Config endpoint cross-tenant leakage via forwarded-host gateway | Correctly scoped to the forwarded tenant only | `config_endpoint_never_leaks_a_cross_tenant_storefront_via_the_forwarded_host_gateway` |

**TenantContext safety (§10):** confirmed by code inspection of every `store/v1` controller
(`StorefrontProductController`, `StorefrontCategoryController`, `StorefrontConfigController`, and
the cart/checkout controllers) — none read `tenant_id`, `storefront_id`, or `sales_channel_id` from
request query/body/headers/cookies. The only inputs read from the client on the trusted path are
`search`/`category_id`/`sort`/`page`/`per_page` (validated, scalar filters with no bearing on
identity) and the cart's `Idempotency-Key`/cookie token (scoped by the cart's own token, not
tenant). Every catalog query is additionally filtered by the standard `TenantScope` on top of the
`StorefrontContext`-derived channel ID — two independent layers, not one.

No security defect was found. **No STOP condition under §11/§14 was triggered.**

---

## 6. Tests

Run from `/home/user/nibras-app` (the built Laravel app; sources synced from this repo's `app/`,
`routes/`, `tests/`, `config/` per `setup.sh`):

| Command | Tests | Result |
|---|---|---|
| `php artisan test --filter=StorefrontDomainResolutionApiTest` | 18 (17 existing + 1 new) | **PASS** (47 assertions) |
| `php artisan test --filter=StorefrontGatewayAndConfigTest` | 9 | **PASS** (13 assertions) |
| `php artisan test --filter=StorefrontModelTest` | 8 | **PASS** (12 assertions) |
| `php artisan test --filter=HostnameNormalizerTest` | 16 | **PASS** (16 assertions) |
| `php artisan test --filter=RegisterStorefrontDomainCommandTest` | 6 | **PASS** (18 assertions) |
| `php artisan test --filter=SalesChannelTest` | 12 | **PASS** (19 assertions) |
| `php artisan test --filter=EnsureWebSalesChannelCommandTest` | 10 | **PASS** (41 assertions) |
| `php artisan test --filter=CommerceModuleBoundaryTest` | 3 | **PASS** (11 assertions) |
| `php artisan test --filter=ApiTenantIsolationTest` | 5 | **PASS** (28 assertions) |
| `php artisan test` (full suite) | 4001 total | **3927 passed, 35 failed, 39 skipped** — see below |
| `pnpm vitest run src/lib/commerce/__tests__/config.test.ts src/lib/commerce/__tests__/storefront.test.ts` (storefront/) | 20 | **PASS** |

**The 35 full-suite failures are pre-existing and unrelated to this task**, confirmed by isolating
them: all 35 are in `Fuel*Test` classes (`FuelSupplyReceivingTest`, `FuelReconciliationTest`,
`FuelSaleServiceTest`, `FuelAviRfidServiceTest`, `FuelSupplyReceivingApiTest`,
`FuelSaleApiTest`) and `AuthRecoveryTest`/`DocumentCenterSecureIntakeTest`. Root causes, verified
by reading the actual errors:

- Fuel tests: `Call to undefined function App\Services\bcmul()` — this sandbox's PHP build has no
  `ext-bcmath`, a module dependency completely unrelated to Commerce/Storefront.
- Auth/DocumentCenter tests: `Class "App\Mail\AuthActionMail" not found` — a stale/incomplete
  autoload build artifact in this session's scaffolded `nibras-app`, again unrelated to Commerce.

None of the 35 failures touch `Storefront`, `StorefrontDomain`, `SalesChannel`, `TenantContext`,
`StorefrontContext`, or any `store/v1` route. This was not fixed — out of scope for this
verification task.

---

## 7. Files changed

**Documentation:**
- `docs/plans/store/AWJ_STOREFRONT_HOST_RESOLUTION_VERIFICATION_REPORT.md` (this file, new)

**Tests:**
- `tests/Feature/StorefrontDomainResolutionApiTest.php` — added
  `lookalike_hostnames_around_a_real_verified_domain_fail_closed()`, pinning existing fail-closed
  behavior against `awjdev.xyz.evil.com`, `alrshd.store.awjdev.xyz.evil.com`,
  `alrshd.store.evilawjdev.xyz`, and `evil-alrshd.store.awjdev.xyz` while the real
  `alrshd.store.awjdev.xyz` domain (seeded verified in the same test) continues to resolve
  correctly. No production behavior changed by this addition — it exercises code paths already
  covered by `unknown_hostname_fails_closed`.

**Application code:** **none.**

---

## 8. Risks / gaps

1. **Production data state for `alrshd.store.awjdev.xyz` is unconfirmed** (§2's "Production data
   uncertainty") — the most likely explanation, based on the absence of any repository record of
   running `storefront:register-domain` for this hostname (contrast with the explicitly-blocked
   Vercel preview attempt), is case **D** (no `StorefrontDomain` row exists yet), but this is
   inference from absence of evidence, not a confirmed fact. Needs the tinker/curl check in §2
   run by someone with production access.
2. **No auto-provisioning contract for storefront hostnames** (§3) — every storefront hostname is
   registered one at a time via `storefront:register-domain`; there is no `{slug}.store.{base}`
   generation analogous to the ERP tenant subdomain's `AWJ_TENANT_BASE_DOMAIN`. This is a real gap
   if `COM-STORE-PROVISION-1` intends automatic hostname assignment per tenant — it will need new
   design, not just a new env var.
3. **Frontend error-swallowing masks backend resolution state** (§2) — by design, for resiliency,
   but it means operators cannot diagnose "is my storefront actually wired up" from the rendered
   page alone; a status/debug signal (visible only to the merchant admin, not the public storefront)
   could be a useful, separate, small follow-up if this becomes a recurring support question — not
   proposed as part of this task.
4. **No automated lookalike-hostname test existed before this session** — added one (narrowly
   scoped, no behavior change); the underlying protection (exact-string match) already existed and
   was already provably safe via `unknown_hostname_fails_closed`, so this closes a documentation/
   pinning gap, not a security gap.

No security/tenant-isolation defect was found. No STOP condition was triggered.

---

## 9. COM-STORE-PROVISION-1 readiness

Based on the verified architecture above, provisioning a real storefront for a tenant (e.g.
`alrshd`) needs to create/connect, in order:

1. An active `SalesChannel` of `type = 'web'` for the tenant (`sales-channel:ensure-web` already
   does this safely, idempotently — unmodified by this task).
2. A `Storefront` row bound to that channel (`storefront:register-domain` already `firstOrCreate`s
   this as a side effect — no accounting/inventory impact, an operational row only).
3. A `StorefrontDomain` row for the intended public hostname
   (`alrshd.store.awjdev.xyz` today, `alrshd.store.awj.app` later), `verification_status =
   verified`, `is_active = true` — via `storefront:register-domain`.
4. **(Gap, not yet built)** If per-tenant automatic hostname generation/registration (rather than
   one-by-one manual commands) is wanted, a new decision + implementation is needed — there is
   currently no base-domain configuration analogous to `AWJ_TENANT_BASE_DOMAIN` for storefronts,
   and the resolution architecture's exact-match-per-row model does not need one to function
   correctly, only to *scale* onboarding.
5. Confirmation of the Railway `storefront` service's `AWJ_COMMERCE_API_URL` and
   `STOREFRONT_GATEWAY_SECRET` env vars pointing at the correct Laravel backend and matching
   Laravel's own `STOREFRONT_GATEWAY_SECRET` — unverified from the repository (infra-only,
   dashboard-configured), flagged as a prerequisite check, not a code change.

None of steps 1–3 require new code — the existing commands are the correct, safe mechanism. Step 4
is a genuine open design question for `COM-STORE-PROVISION-1` to resolve explicitly (per
CLAUDE.md's "أي قرار له أكثر من طريقة معقولة وصحيحة... يُعرض على المالك قبل التنفيذ" — this is
exactly such a decision and should go to Safwan before implementation, not be inferred).

---

## 10. Git

| Field | Value |
|---|---|
| Branch | `claude/storefront-host-resolution-verify-7v7mwc` |
| Base SHA | `dc03db7ae95f12e50ab520a6ae08bbebff9b6df8` (main) |
| Head SHA | set at commit time below |

No PR opened yet per this task's "do not merge" scope — commit pushed to the branch for review.
No deployment performed.

---

## 11. Recommended next step

Smallest next task: **someone with production database or Render/Railway shell access runs the
read-only check in §2** (`StorefrontDomain::where('hostname', 'alrshd.store.awjdev.xyz')->first()`
or the equivalent `curl -H "Host: ..."` against the Laravel backend directly) and reports back
which of A/D/E is actually true. That single fact determines whether `COM-STORE-PROVISION-1` is
"run `storefront:register-domain` once" (if D/E) or "investigate why a verified domain shows no
data" (if A). Everything else in this report is ready to act on as soon as that's known.

Waiting for Safwan's approval before any further action.
