# PR-COM-7-P2A — Storefront & Domain Resolution Foundation — Implementation Report

## Identifiers

| Field | Value |
|-------|-------|
| PR | (to be opened) |
| Branch | `claude/com-7-p2a-storefront-domain` |
| Base SHA | `6f36400f26e0c0795f4e807f399af48ce58f66ed` (main) |
| Head SHA | `6b1457f3f405bdc25a2d483f70915de74645c749` |
| Predecessor | PR #766 (COM-7-P1), merged as `a31ad154`; PR #768 (docs, the P2 decision) |

## Executive Summary

COM-7-P2A implements the persistence and trusted hostname-resolution foundation approved in `AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md`: two new tables (`storefronts`, `storefront_domains`), a centralized hostname normalizer, a new fail-closed domain-resolution middleware (`ResolveStorefrontDomain`) that becomes the production authority for the COM-7-P1 public catalog API, and a matching security test suite (41 new tests). The COM-7-P1 provisional `{tenantSlug}` route-slug resolution is retired from production (not registered at all when `APP_ENV=production`, and defensively refuses to run even if invoked) but preserved as an explicitly non-production development/testing path, so the existing 14 COM-7-P1 catalog tests keep passing unchanged.

No cart/checkout/payment/customer-auth/admin-UI/DNS-automation work was added — this PR is exactly the "foundation" slice: models, invariants, hostname parsing, and the resolver that the catalog now runs behind.

## Architecture Implemented

Target authority chain (implemented exactly as decided):

```
Incoming Host
  → HostnameNormalizer::normalize()  (App\Support)
  → StorefrontDomain (hostname unique globally, active + verified)
  → Storefront (active)
  → SalesChannel (active, type=web, same tenant — re-checked live, not trusted from the FK alone)
  → StorefrontContext (tenant + storefront + sales channel)
```

Ownership graph persisted:

```
Tenant
  └─ Storefront (CompanyWide, tenant-owned, soft-deletes)
       ├─ SalesChannel (existing model, type=web enforced at write time)
       └─ StorefrontDomain (1..n, CompanyWide, tenant-owned, hostname globally unique)
```

`SalesChannel` itself is untouched — no branding/domain/locale columns were added to it, per the decision's explicit prohibition.

## Exact Migrations / Schema

**`database/migrations/2026_09_20_010000_create_storefronts_table.php`** (additive):

```
storefronts
- id                uuid, primary key
- tenant_id         uuid, FK → tenants, cascadeOnDelete
- sales_channel_id  uuid, FK → sales_channels, cascadeOnDelete
- slug              string
- name              string
- is_active         boolean, default true
- default_locale    string(10), default 'ar'
- timestamps
- soft deletes

unique(tenant_id, slug)   -- literal per the approved contract; no partial index
                          -- excluding soft-deleted rows (unlike products.sku) —
                          -- slug reuse after delete is an explicit later decision,
                          -- not invented here.
```

**`database/migrations/2026_09_20_020000_create_storefront_domains_table.php`** (additive):

```
storefront_domains
- id                    uuid, primary key
- tenant_id             uuid, FK → tenants, cascadeOnDelete
- storefront_id         uuid, FK → storefronts, cascadeOnDelete
- hostname              string(253)
- type                  enum('awj_subdomain', 'custom')
- is_primary            boolean, default false
- is_active             boolean, default true
- verification_status   enum('pending', 'verified', 'failed'), default 'pending'
- timestamps            (no soft deletes — current mapping record, not an audit log)

unique(hostname)                                    -- globally unique, not per-tenant
index(storefront_id, is_active)
index(tenant_id)

-- Raw partial unique index (PostgreSQL + SQLite compatible, same pattern as
-- `branches_one_main_per_tenant`):
CREATE UNIQUE INDEX storefront_domains_one_primary_active_per_storefront
  ON storefront_domains (storefront_id)
  WHERE is_primary = true AND is_active = true;
```

Both migrations were run and verified on **both** SQLite and PostgreSQL 16 (`migrate:fresh` succeeds on both; the partial index syntax is identical across both drivers, following the repository's own established `branches.is_main`/`products.sku` precedent).

No existing table, column, or migration was modified. No `sales_channels` row is reinterpreted or backfilled — the tables start empty and only tests populate them via factories/direct `Model::create()`.

## Changed Files

### New

| File | Purpose |
|------|---------|
| `database/migrations/2026_09_20_010000_create_storefronts_table.php` | `storefronts` table |
| `database/migrations/2026_09_20_020000_create_storefront_domains_table.php` | `storefront_domains` table + partial unique index |
| `app/Models/Storefront.php` | Storefront model — `CompanyWide`, enforces SalesChannel ownership/type at `saving()` |
| `app/Models/StorefrontDomain.php` | Domain model — `CompanyWide`, hostname mutator/normalization, ownership + uniqueness guards, `makePrimary()` |
| `app/Support/HostnameNormalizer.php` | Single centralized hostname normalize/validate function |
| `app/Support/InvalidHostnameException.php` | Thrown by the normalizer on malformed input |
| `app/Http/Middleware/ResolveStorefrontDomain.php` | New trusted, fail-closed Host → StorefrontContext resolver (production authority) |
| `tests/Feature/HostnameNormalizerTest.php` | 15 unit tests for the normalizer |
| `tests/Feature/StorefrontModelTest.php` | 8 model-invariant tests (ownership, uniqueness, primary-domain) |
| `tests/Feature/StorefrontDomainResolutionApiTest.php` | 17 HTTP-level security/isolation tests for the new resolver |

### Modified

| File | Change |
|------|--------|
| `app/Tenancy/StorefrontContext.php` | Added optional `storefrontId` (3rd param on `set()`, new `storefrontId()`/`hasStorefront()`); fully backward-compatible with the P1 2-arg call site |
| `app/Http/Middleware/ResolveStorefrontTenant.php` | Documented as non-production-only; added a defensive `app()->environment('production')` guard (404) |
| `routes/api_storefront.php` | Added the new host-based route group (production authority, no `{tenantSlug}` segment); wrapped the legacy `{tenantSlug}` group in `if (! app()->environment('production'))` |
| `app/Http/Controllers/Api/StorefrontProductController.php` | `$tenantSlug` read as nullable (`$request->route('tenantSlug')`) instead of force-cast to string, for the new tenantSlug-less routes |
| `app/Http/Resources/StorefrontProductResource.php` | `tenantSlug` constructor param now `?string`; `mediaUrl()` picks the legacy (`storefront.v1.legacy.media.show`) or new (`storefront.v1.media.show`) route name accordingly |

No `setup.sh`/`ci.yml` changes were needed — both already glob-copy `app/Models/*.php`, `app/Http/Middleware/*.php`, `app/Support/*.php`, `database/migrations/*.php`, and `tests/Feature/*.php` wholesale, and this PR reuses the existing `routes/api_storefront.php` file and `StorefrontApiServiceProvider` (no new route file or provider was introduced).

## Hostname Normalization Rules (`App\Support\HostnameNormalizer::normalize()`)

Single centralized function, called from exactly two places (`StorefrontDomain::setHostnameAttribute()` on write, `ResolveStorefrontDomain` on every request) — no other file parses a hostname.

- Strips a leading `scheme://` if present (defensive; a real HTTP `Host` header never carries one).
- Truncates at the first `/`, `?`, or `#` (path/query/fragment).
- Rejects `user:pass@host` userinfo forms.
- Strips a trailing `:port` (digits only).
- Lowercases (ASCII case-folding via `mb_strtolower`).
- Strips a trailing `.` (FQDN dot).
- Validates: 2+ labels required (rejects single-label hosts like `localhost` — those belong to the legacy dev-only path, not real store domains), each label 1–63 chars matching `[a-z0-9]([a-z0-9-]*[a-z0-9])?` (no leading/trailing hyphen, no empty labels), total length ≤ 253.
- No IDN/punycode support (ASCII labels only) — documented as a known gap, not silently mishandled.

Malformed input throws `InvalidHostnameException` (extends `RuntimeException`), which both call sites treat as fail-closed (a 404 in the middleware, a hard write rejection in the model).

## Tenant/Storefront/SalesChannel Enforcement Points

1. **`Storefront::booted()` (`saving`)** — loads the referenced `SalesChannel` bypassing `TenantScope` explicitly (`withoutGlobalScope`) to read its *real* `tenant_id`, and rejects the save if it doesn't match the storefront's own tenant (falling back to the ambient `TenantContext` when `tenant_id` isn't populated yet at create time — see "Bugs found & fixed" below), or if `type !== 'web'`. Enforced structurally at the model layer — not opt-in via a service that could be bypassed.
2. **`StorefrontDomain::booted()` (`saving`)** — same pattern: the referenced `Storefront`'s real `tenant_id` must match the domain's own tenant.
3. **`StorefrontDomain::booted()` (`creating`)** — pre-checks global hostname uniqueness with a friendly `RuntimeException`, backstopped by the DB `unique(hostname)` constraint for race conditions.
4. **`StorefrontDomain::setHostnameAttribute()`** — mutator, normalizes on every write (see above).
5. **`ResolveStorefrontDomain` middleware** — re-checks all of the above *live*, at request time, independent of whether they held true at creation time (a `SalesChannel` can be edited to a non-`web` type or deactivated after a `Storefront` was validly created against it — the resolver re-verifies `type=web` and `is_active` on every single request, not just at write time). This is deliberate defense-in-depth, matching the existing `FulfillmentPolicyService` precedent in this codebase (never trust that a stored foreign key is still valid — re-verify against the live row).

## Compatibility Handling for the P1 Provisional Resolution

- The legacy `ResolveStorefrontTenant` (`{tenantSlug}` route-based) middleware is **not registered at all** when `app()->environment('production')` is true (verified: `APP_ENV=production php artisan route:list --path=store/v1` shows only the 5 new host-based routes, none of the 5 legacy ones).
- As independent defense-in-depth, the middleware itself also refuses to run in a `production` environment (aborts 404), so its safety does not depend on the route-registration guard alone.
- In every other environment (`local`, `testing`), both route trees coexist without ambiguity: the legacy URI shape (`store/v1/{tenantSlug}/products`, 2 segments, variable-then-literal) never matches the new URI shape (`store/v1/products/{id}`, 2 segments, literal-then-variable/UUID) or vice versa, verified by `route:list` and by all 14 pre-existing P1 tests plus all 17 new P2A tests passing side by side in the same run.
- `StorefrontContext::set()` gained an optional third parameter (`storefrontId`) — the legacy middleware's existing 2-argument call is untouched and still valid; only the new middleware passes the third argument.
- `StorefrontProductResource`/`StorefrontProductController` now treat `tenantSlug` as nullable and pick the matching route name for building media URLs — this is the only behavior change visible to a caller of the *existing* P1 routes, and it is purely internal URL-construction plumbing (verified unchanged by the full P1 test suite passing).

## Security Tests and Results

**`tests/Feature/HostnameNormalizerTest.php`** — 16 tests, pure unit-level (no DB): lowercasing, scheme/port/path/query/fragment/trailing-dot stripping, combined normalization, and rejection of empty/credentialed/single-label/empty-label/hyphen-leading/hyphen-trailing/over-length-label/over-length-total/invalid-character inputs.

**`tests/Feature/StorefrontModelTest.php`** — 8 tests: cross-tenant `SalesChannel` binding rejected; non-`web` `SalesChannel` rejected; valid same-tenant `web` channel succeeds; cross-tenant `Storefront` binding rejected; duplicate hostname rejected globally (even across tenants, even with different casing); hostname normalized on write; malformed hostname rejected on write; primary-domain invariant (`makePrimary()` correctly demotes the previous primary transactionally).

**`tests/Feature/StorefrontDomainResolutionApiTest.php`** — 17 HTTP-level tests, mapped directly to the decision document's §11 required list:

| # | Requirement | Test |
|---|---|---|
| 1 | Domain A → Tenant/Storefront/Channel A only | `domain_a_resolves_only_to_tenant_storefront_channel_a` |
| 2 | Domain B → B only | `domain_b_resolves_only_to_tenant_storefront_channel_b` |
| 3 | Unknown hostname fails closed | `unknown_hostname_fails_closed` |
| 4 | Invalid hostname fails closed | `a_malformed_hostname_fails_closed_instead_of_crashing` (uses `localhost` — syntactically valid to Symfony's own `Request::getHost()` guard, but rejected by our stricter normalizer; see note below) |
| 5 | Inactive domain fails closed | `an_inactive_domain_fails_closed` |
| 6 | Unverified custom domain fails closed | `an_unverified_custom_domain_fails_closed` (+ `a_failed_verification_domain_fails_closed`) |
| 7 | Inactive Storefront fails closed | `an_inactive_storefront_fails_closed` |
| 8 | Inactive/non-web SalesChannel fails closed | `an_inactive_sales_channel_fails_closed` + `a_channel_that_changes_away_from_web_type_can_no_longer_establish_storefront_authority` (live re-check, not just at-creation) |
| 9 | Storefront cannot bind another tenant's SalesChannel | covered in `StorefrontModelTest` (model layer — this is a write-time invariant, not a request-resolution one) |
| 10 | Domain cannot bind another tenant's Storefront | covered in `StorefrontModelTest` |
| 11 | Globally duplicate hostname rejected | covered in `StorefrontModelTest` |
| 12 | Conflicting client `tenant_id` doesn't change authority | `a_conflicting_client_supplied_tenant_id_never_changes_authority` |
| 13 | Client tenant header/cookie doesn't change authority | `a_tenant_like_client_header_or_cookie_never_changes_authority` (+ `an_authorization_header_never_influences_domain_resolution`) |
| 14 | Locale switching doesn't change identity | `locale_switching_never_changes_the_resolved_tenant_storefront_or_channel` |
| 15 | No cross-tenant catalog access via hostname manipulation | `direct_product_access_cannot_cross_tenant_through_hostname_manipulation` |
| 16 | Customer identity doesn't cross tenants via hostname | **N/A for this path** — see note below |
| 17 | Cache isolation if caching exists | **N/A — no caching introduced**, see Caching Finding below |

**Note on #4 (malformed hostname) and the test technique**: Laravel's test HTTP client builds requests via `Symfony\Component\HttpFoundation\Request::create()` with an absolute URL, which runs its *own* host-syntax validation (`Request::isHostValid()`) before the request is even dispatched — genuinely malformed hosts (empty labels, leading hyphens) are rejected by Symfony itself (`BadRequestException` → HTTP 400, verified manually) before ever reaching `ResolveStorefrontDomain`. This is a real, independent defense-in-depth layer, but it means those specific malformed shapes can't be driven through `ResolveStorefrontDomain` via the HTTP test client at all (they're rejected one layer earlier, with the same fail-closed, non-2xx, non-leaking outcome). `HostnameNormalizerTest` covers all of those malformed shapes directly at the unit level instead. The HTTP-level test uses `localhost` (a single-label host, syntactically valid to Symfony but explicitly rejected by our normalizer as an invalid *store* hostname) to prove the resolver's *own* validation is what fails closed here, not just Symfony's outer guard.

**Note on #16 (customer identity)**: this PR carries no customer authentication at all — `store/v1` (both route trees) has always been (P1) and remains (P2A) fully anonymous, with no Sanctum/customer middleware anywhere in the chain. There is no customer-identity concept for a hostname to leak across. `an_authorization_header_never_influences_domain_resolution` is the closest concrete evidence: an arbitrary `Authorization: Bearer <token>` header has zero effect on which tenant's catalog is returned, proving the path doesn't even attempt to read auth-shaped input as authority. Full "customer identity across domains" testing is deferred to whichever future phase adds authenticated storefront access.

### Test run results

```
php artisan test --filter="HostnameNormalizerTest|StorefrontModelTest|StorefrontDomainResolutionApiTest"
Tests: 41 passed (assertions vary by driver — see PostgreSQL run below)
```

```
php artisan test --filter="StorefrontCatalogApiTest"   # pre-existing P1 suite, unchanged assertions
Tests: 14 passed (76 assertions)
```

```
php artisan test --filter=BranchIsolationGuardTest
Tests: 4 passed (118 assertions) — Storefront/StorefrontDomain correctly classified CompanyWide
```

## PostgreSQL Results

Ran against a local PostgreSQL 16 instance (same version as CI's `postgres:16` service container), migrated fresh from scratch:

```
php artisan test --filter="HostnameNormalizerTest|StorefrontModelTest|StorefrontDomainResolutionApiTest|StorefrontCatalogApiTest|BranchIsolationGuardTest|LedgerTest"
Tests: 64 passed (270 assertions)
```

Confirms the partial unique index (`storefront_domains_one_primary_active_per_storefront`), the two `enum` columns, and all model-level `RuntimeException` invariants behave identically to SQLite — no PostgreSQL-only surprises (this repo's own history shows enum/CHECK-constraint strictness differs between the two drivers, so this was verified deliberately, not assumed).

## Broader Test Results

Full suite, PostgreSQL:

```
php artisan test
Tests: 27 failed, 3375 passed (21751 assertions)
```

The 27 failures are the pre-existing `FuelCostBasisService` (`bcmul()` undefined — missing BCMath extension function in this sandbox) failures, unrelated to Commerce/storefront and already present on `main` before this PR (same failure signature documented in the COM-7-P1 report's baseline). No new failure was introduced by this PR on either driver.

Full suite, SQLite: same 27 pre-existing failures, all storefront/P2A/P1 tests green.

## Build/CI Status

No frontend (`storefront/`) files were touched by this PR — confirmed via `git status` (0 files under `storefront/`). Per the task's own testing strategy (§13.G), TypeScript/Vitest/build steps are **not applicable** to this PR and were not run; the existing `storefront-ci.yml` workflow is expected to pass unchanged since no file it builds was modified.

GitHub Actions CI status: pending — will be confirmed after the PR is opened and pushed (see PR link above once available).

## Caching Finding

**No caching was introduced or found in the affected paths.** Neither the pre-existing P1 catalog controllers/resources nor the new `ResolveStorefrontDomain` middleware use `Cache::`, `remember()`, HTTP response caching, or Next.js `"use cache"` directives (this PR touches no frontend code at all). This matches the P1 report's own documented cache decision, which deferred caching until real per-request tenant/store variance exists — which is exactly what this PR introduces. Per the task's own instruction, no speculative caching was added; a follow-up phase that introduces catalog caching must key/tag by `(tenant_id, storefront_id, sales_channel_id)` at minimum, per the decision document's §10.

## Risks

1. **No IDN/punycode support** in `HostnameNormalizer` — ASCII-only labels. A merchant with a genuinely internationalized domain name cannot be onboarded without either pre-converting to punycode externally or a follow-up enhancement. Documented, not silently mishandled (rejected outright, not mangled).
2. **`verification_status` has no automated transition path yet** — a domain must be marked `verified` by some future process (admin action, DNS-check job, etc.); this PR only provides the persistence states and the resolver's guard, per the decision document's explicit allowance to defer the verification *workflow* to a later PR. Today, nothing in this PR can create a `verified` domain outside of a direct `Model::create()`/test/future-service call with that field explicitly set — there is no accidental "auto-verify" path.
3. **The live re-check in `ResolveStorefrontDomain`** (re-verifying `SalesChannel.type='web'`/`is_active` on every request) adds two additional scoped `whereKey()` queries per anonymous request beyond what P1's `ResolveStorefrontTenant` did (which resolved a channel query but no storefront query). This is a small, deliberate cost for defense-in-depth (see Enforcement Points above) and is in the same query-cost class as the existing per-request `TenantScope`/`CommerceListing` queries the catalog controllers already run; no N+1 pattern was introduced (all three lookups are single-row `whereKey()`/`where()->first()` calls, not per-item loops).
4. **Two coexisting route trees** in one file — while proven non-ambiguous by route shape and by the full test suite passing both concurrently, any *future* route added to either group must keep this in mind (e.g., avoid a legacy-side literal segment that could collide with a new-side literal at the same position). This is a maintainability note, not a live bug.

## Deferred Items (explicitly out of scope, per the task)

Full DNS ownership-verification workflow and automation; SSL/certificate provisioning; storefront branding/theme/SEO/page-builder schema; a storefront/domain-management admin UI or API endpoints (no `StorefrontController`/`StorefrontDomainController` write API was built — models are created directly via Eloquent in this PR's own tests, exactly as the equivalent `SalesChannel`/`Product` models already are elsewhere in this codebase's test suite); cart/checkout/payment/shipping/fulfillment redesign; Order→Invoice; customer address book; COM-7-P2B (Arabic/English localization) — `Storefront.default_locale` is persisted but nothing yet reads it to drive UI language; broad refactors; deployment.

## Confirmation: Excluded Scope

**Not implemented in this PR**, as instructed: COM-7-P2B localization, cart, checkout, payment, shipping, fulfillment-model redesign, Order→Invoice, customer address book, DNS verification automation, SSL/certificate provisioning, storefront admin UI, theme builder, SEO/page builder, App Builder, Apps & Integrations, broad refactors, deployment. No accounting table, `CommerceOrder` semantics, `InventoryReservation`, `FulfillmentPolicy`, or `Branch`/`Warehouse` semantics were touched. No `sales_channels` row was reinterpreted, backfilled, or given new columns.

## Next Recommended Task

**COM-7-P2B — Arabic/English Storefront Integration**: register the `ar` locale in the Next.js storefront, wire `Storefront.default_locale` into locale resolution, verify RTL/LTR rendering preserves the resolved `StorefrontContext` across a language switch (the backend guarantee is already in place — `locale_switching_never_changes_the_resolved_tenant_storefront_or_channel` proves the server side; P2B's job is making the frontend actually vary by locale without touching identity). Separately, a genuinely new task (not P2B) should design the domain-verification workflow and a minimal admin surface to create/manage `Storefront`/`StorefrontDomain` records, since none exists yet — today they can only be created directly via Eloquent (tests) or a future artisan/admin tool.
