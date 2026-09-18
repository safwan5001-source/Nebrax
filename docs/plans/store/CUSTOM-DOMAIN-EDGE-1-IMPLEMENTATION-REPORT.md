# CUSTOM-DOMAIN-EDGE-1 — Railway Edge Foundation — Implementation Report

## Status

**COMPLETE** (including P1 V1-hostname / ICANN Public Suffix fix). PR opened, not merged, not deployed.

EDGE-2 (frontend) and EDGE-3 (Make Primary opening + provider-first Disconnect) are **not** in this slice.

## Git

- Latest `main` SHA used: `0b5a868a81ee6746edefc38ea45b8e7f47ef4693`
- Confirmed ancestor of architecture PR #863 merge SHA `0b5a868a81ee6746edefc38ea45b8e7f47ef4693`
- Branch: `feat/custom-domain-edge-1-railway-foundation`
- PR: [#864](https://github.com/safwan5001-source/Nebrax/pull/864)
- Base SHA: `0b5a868a81ee6746edefc38ea45b8e7f47ef4693`
- Implementation SHA: `9c72c4137628ceeee0eaaa55078d41899542cfdb`
- P1 hostname SHA: see the PR head after the ICANN Public Suffix commits
- Head SHA at report time: see the PR head

`main` was already at #863. Later #862 is in ancestry (parent of #863). Those commits were kept.

## Architecture Authority

- Architecture PR: [#863](https://github.com/safwan5001-source/Nebrax/pull/863)
- Merge SHA: `0b5a868a81ee6746edefc38ea45b8e7f47ef4693`
- Document: `docs/plans/store/AWJ_CUSTOM_DOMAIN_EDGE_TLS_ARCHITECTURE.md`
- Decision: **CASE B** (subdomain-only V1, manual merchant DNS, server-driven Railway GraphQL)

Ownership TXT contract is unchanged:

- record: `_awj-verification.<hostname>`
- value: `awj-domain-verification=<token>`

`verification_status = verified` means **ownership only**. It is not Edge ready, TLS ready, HTTPS ready, or Make Primary eligibility.

## Railway Evidence

Live GraphQL introspection on `https://backboard.railway.com/graphql/v2` (2026-09-18). Unauthenticated schema query required a browser User-Agent; the schema was readable without guessing field names.

| Item | Evidence used |
|---|---|
| Authentication | `Authorization: Bearer` workspace/account token (official). Project-token `Project-Access-Token` was **not** proven for `customDomainCreate`. |
| Endpoint | `https://backboard.railway.com/graphql/v2` (`config/storefront.php` `edge.endpoint`) |
| Create | `customDomainCreate(input: CustomDomainCreateInput!)` — `domain`, `environmentId`, `projectId`, `serviceId`, optional `targetPort` |
| Status | `customDomain(id, projectId)` and `domains(...).customDomains` |
| Delete (interface only) | `customDomainDelete(id)` — **not called** by Disconnect in EDGE-1 |
| Reconciliation | `domains.customDomains` filtered by hostname (case-insensitive). Create conflict (`already`/`taken`/`exists`/`in use`) then `findByHostname`. |
| DNS instructions | `status.dnsRecords[]` (`fqdn`/`hostlabel`, `recordType`, `requiredValue`, `purpose`) **plus** `verificationDnsHost` + `verificationToken`. ACME `DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE` is **not** shown to the merchant. |
| Certificate readiness | Live enum `certificateStatus = CERTIFICATE_STATUS_TYPE_VALID` → AWJ `ready`. Official docs said `ISSUED`; **live schema is the authority**. Docs-era `ISSUED` is **not** treated as ready. |
| DNS propagated | Live enum `DNS_RECORD_STATUS_PROPAGATED` (docs said `VALID`). Routing CNAME propagated + cert not VALID → `tls_pending`. Else `dns_required`. |
| Cert failed | `CERTIFICATE_STATUS_TYPE_ISSUE_FAILED` → `failed` |
| Transport | HTTP 429 / 5xx / connect timeout → `StorefrontEdgeUnavailableException` → **503**. Never mark `ready`. |

Uncertainties remaining (not guessed):

- AWJ Railway **plan / custom-domain quota**: **UNKNOWN**
- Whether a **project** token authorizes `customDomainCreate`: **UNKNOWN** (workspace token recommended)
- Production `RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` / `RAILWAY_STOREFRONT_SERVICE_ID`: **not set by this PR**

## Schema

Migration: `database/migrations/2026_09_21_020000_add_edge_state_to_storefront_domains_table.php`

Dated **after** `2026_09_21_010000_add_verification_challenge_to_storefront_domains_table.php` so it cannot run before `storefront_domains` exists.

| Column | Null / default | Notes |
|---|---|---|
| `edge_status` | default `'none'` | `none\|pending\|dns_required\|tls_pending\|ready\|failed` |
| `edge_provider` | nullable | `'railway'` once provisioned |
| `edge_provider_id` | nullable | Railway custom domain `id` |
| `edge_dns_instructions` | nullable JSON | `{records:[{type,name,value}]}` |
| `edge_last_error` | nullable | sanitized, no secrets |
| `edge_checked_at` | nullable | last provider observation |
| `edge_ready_at` | nullable | first time `ready` was observed |

Backward compatible. Existing AWJ-managed and verified custom rows stay valid at `edge_status=none`. **No backfill. No auto provisioning. No automatic Make Primary.** No certificate PEM, no per-row Railway project/service IDs, no SoftDeletes, no `is_tls_ready` boolean.

## Provider Boundary

- `StorefrontEdgeClient`: `provision` / `fetch` / `findByHostname` / `release`
- `RailwayStorefrontEdgeClient`: GraphQL only. Credentials from `config/storefront.php` (`RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_STOREFRONT_SERVICE_ID`, optional target port). Missing config → 503. Token is sent in `Authorization` only; never in GraphQL variables, JSON, or logs.
- `FakeStorefrontEdgeClient`: in-memory; hostname-derived ids (`fake-` + sha256 prefix) so forked pgsql children share one id; unknown ids default to `dns_required` unless `unknownIdsAreMissing`.
- `RailwayEdgeStatusMapper`: live enums → AWJ semantic states only.

`release` exists for EDGE-3. EDGE-1 Disconnect does **not** call it.

## APIs

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/commerce/workspace/storefronts/{id}/domains/{domainId}/activate-edge` | Empty body. TenantContext + `commerce.manage`. |
| `POST` | `/api/commerce/workspace/storefronts/{id}/domains/{domainId}/refresh-edge` | Empty body. Same authority. |

Presentation: additive `edge` on every workspace domain JSON.

- AWJ-managed: `edge = null`
- Custom: `{status, dns_instructions.records, checked_at, ready_at, last_error}`
- Never `edge_provider_id`, Railway token, project/service/environment ids, raw GraphQL

### RBAC

- Route middleware: `commerce.manage`
- `self_service` → 403
- Staff without `commerce.manage` → 403
- Guest → 401
- Owner and admin allowed

### Tenant Isolation

Unknown / cross-tenant / cross-storefront → **404** (not 403). Same lock path as #861: all storefront domain rows `ORDER BY id` `lockForUpdate`.

Client cannot supply `tenant_id`, `storefront_id`, provider id, Railway ids, `edge_status`, DNS instructions, or ready flags. Extra body fields are ignored.

### Error semantics

| Event | Status |
|---|---|
| Unknown / cross-tenant / cross-storefront | 404 |
| Missing `commerce.manage` / self_service | 403 |
| Guest | 401 |
| Unverified / inactive / AWJ-managed / apex / AWJ namespace | 422 |
| Refresh before Activate | 422 |
| Provider uniqueness conflict (unresolved) | 409 |
| Missing Railway config / 429 / 5xx / timeout | 503 |

## Idempotency

Activate:

1. `edge_provider_id` present and provider object exists → `fetch`, no second create.
2. Else `findByHostname` → attach existing Railway id.
3. Else `customDomainCreate`.
4. Create conflict or timeout-after-record → `findByHostname` then attach; if still missing, rethrow 409/503.
5. Provider object missing on a stored id → fall through to find/create (Activate may provision again).

Refresh never creates. Missing provider object → `failed`, row kept. Transport error → 503, status unchanged, never `ready`.

## TLS Readiness

The **only** AWJ `ready` evidence is live Railway `certificateStatus = CERTIFICATE_STATUS_TYPE_VALID`.

Not sufficient: AWJ TXT verified, CNAME exists, DNS propagated, `is_active`, HTTP 200, cached `edge_status` alone, client flags.

No HTTP fetch of merchant hostnames. No SSRF.

EDGE-1 may persist `ready` after that observation. **Make Primary still rejects every custom domain.**

## V1 hostname rule

Activate allows a custom hostname only when it is a **subdomain of an ICANN registrable domain**: at least one DNS label to the left of `IcannRegistrableDomain::registrableDomain()`.

| Hostname | Result |
|---|---|
| `shop.example.com` | allowed (subdomain of `example.com`) |
| `example.com` | 422 apex |
| `shop.co.uk` | 422 registrable apex on multi-label suffix `co.uk` |
| `www.shop.co.uk` | allowed (subdomain of `shop.co.uk`) |

`isV1SubdomainHostname()` (label-count `>= 3`) was removed. That rule accepted `shop.co.uk` and violated the EDGE-1 stop condition against homemade Public Suffix logic.

### Dependency search (no composer package added)

Searched current assembled dependencies and the kernel repo:

| Source | PSL? |
|---|---|
| `composer require` in `.github/workflows/ci.yml`, `setup.sh`, `deploy/assemble.sh` | `laravel/sanctum`, `league/flysystem-aws-s3-v3`, `predis/predis` only |
| Laravel 11 skeleton / `laravel/framework` | no PSL (`league/uri` has no public-suffix parser; `league/uri-hostname-parser` is abandoned) |
| `web/package.json` / `storefront/package.json` | no `psl` / `tldts` / `parse-domain` |
| `app/Support` | `HostnameNormalizer` is ASCII label syntax only |

`jeremykendall/php-domain-parser` is the standard PHP library but is **not** in the tree, does **not** ship the PSL dat file, and would require a new `composer require` in all three assembly scripts plus a vendored data file. That is a dependency change. It was **not** added.

### Minimum safe option implemented

- Frozen Mozilla PSL **ICANN** snapshot (2026-09-18) as `IcannPublicSuffixRules` (PHP nowdoc so existing `app/Support/*.php` CI copy picks it up; no new assembly path).
- Official publicsuffix.org matching algorithm in `IcannRegistrableDomain` (exact / `*.wildcard` / `!exception` / default `*`).
- Fail closed on empty, malformed, public-suffix-itself, or hostname == registrable domain.
- **No runtime HTTP** to publicsuffix.org or any other host.
- PRIVATE suffixes omitted: CNAME-apex is an ICANN-registrable concern (`foo.github.io` remains a V1 subdomain of `github.io`).
- No schema change. No Railway client/API change.

AWJ managed namespace reused: `ManagedStorefrontHostname::isUnderBaseDomain` + exact base match.

## Security

- Tenant Isolation: 404 lock path; provider id read from the locked row only
- Client cannot set provider id / DNS / `edge_status`
- SSRF: no HTTP to merchant hostname; GraphQL endpoint is fixed; PSL is a frozen in-repo snapshot (no fetch of publicsuffix.org)
- V1 hostname: ICANN registrable-domain check; `shop.co.uk` cannot Activate
- Secrets: Laravel env only; never `NEXT_PUBLIC_*`; never merchant JSON; never logs of `Authorization`
- AWJ namespace: Activate re-checks managed base
- Ownership TXT unchanged and not replaced by Railway TXT
- Dual TXT: `_awj-verification` (ownership) vs Railway `verificationDnsHost` (edge). Both merchant-facing DNS, neither an AWJ credential

## Resolver

**Unchanged.** `ResolveStorefrontDomain` still requires exists + `is_active` + `isVerified()`. No TLS requirement. No Host-header redesign. Regression: `StorefrontDomainResolutionApiTest` **17 passed**.

## Make Primary

**Unchanged fail-closed for custom.** `makePrimaryForCurrentTenant` still throws `CustomDomainNotReadyForPrimaryException` for every `type=custom`, including `edge_status=ready`.

Regression: `a_custom_domain_with_edge_ready_still_cannot_become_primary` → 422.

EDGE-3 will re-query live `CERTIFICATE_STATUS_TYPE_VALID` before opening it.

## Disconnect

**Unchanged from #861.** Custom non-primary → DB hard delete. AWJ-managed / current primary → 422. `release()` is **not** called.

Temporary orphan window: a Railway binding can remain after DB delete and consume a domain slot until EDGE-3 (provider-first: Railway then DB; 503 keeps the row).

Regression in this PR: Activate then Disconnect → `FakeStorefrontEdgeClient::releaseCalls === 0` and the row is gone.

## Files Changed

Backend / assembly:

- `app/Models/StorefrontDomain.php`
- `app/Services/Commerce/CommerceWorkspaceStorefrontsService.php`
- `app/Services/Commerce/Edge/*` (client, Railway, fake, mapper, DTOs)
- `app/Services/Commerce/StorefrontEdge*.php` / `DomainNot*ForEdgeException.php`
- `app/Support/IcannRegistrableDomain.php`
- `app/Support/IcannPublicSuffixRules.php` (frozen ICANN PSL snapshot 2026-09-18)
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php`
- `app/Providers/TenancyServiceProvider.php`
- `config/storefront.php`
- `routes/api.php`
- `database/migrations/2026_09_21_020000_add_edge_state_to_storefront_domains_table.php`
- `.github/workflows/ci.yml` / `setup.sh` / `deploy/assemble.sh` (`app/Services/Commerce/Edge` copy list)

Tests:

- `tests/Feature/StorefrontDomainEdgeStateMigrationTest.php`
- `tests/Feature/RailwayEdgeStatusMapperTest.php`
- `tests/Feature/RailwayStorefrontEdgeClientTest.php`
- `tests/Feature/IcannRegistrableDomainTest.php`
- `tests/Feature/CommerceWorkspaceActivateEdgeApiTest.php`
- `tests/Feature/CommerceWorkspaceRefreshEdgeApiTest.php`
- `tests/Feature/CommerceWorkspaceActivateEdgePostgresConcurrencyTest.php`
- `tests/Feature/CommerceWorkspaceMakePrimaryDomainApiTest.php` (ready-still-422)
- `tests/Feature/CommerceWorkspaceStorefrontDomainsApiTest.php` (additive `edge` key)
- `tests/Feature/CommerceModuleBoundaryTest.php`

Docs:

- `docs/plans/store/CUSTOM-DOMAIN-EDGE-1-IMPLEMENTATION-REPORT.md`

No `web/` or `storefront/` frontend files.

## Tests

PHP is not installed in this sandbox (kernel-only repo; tests assemble Laravel in CI). Counts below are from GitHub Actions on PR #864.

Original EDGE-1 implementation recorded from [CI run 35376113993](https://github.com/safwan5001-source/Nebrax/actions/runs/35376113993) (`pull_request` on `52cc123`). P1 hostname-fix counts are recorded from the follow-up `pull_request` run on this PR (see Full suite table).

### Targeted backend (CI)

| Suite | sqlite | pgsql |
|---|---|---|
| `IcannRegistrableDomainTest` | pending P1 CI | pending P1 CI |
| `StorefrontDomainEdgeStateMigrationTest` | **3 passed** | **3 passed** |
| `RailwayEdgeStatusMapperTest` | **8 passed** | **8 passed** |
| `RailwayStorefrontEdgeClientTest` | **10 passed** | **10 passed** |
| `CommerceWorkspaceActivateEdgeApiTest` | **21 passed** + P1 apex case | **21 passed** + P1 apex case |
| `CommerceWorkspaceRefreshEdgeApiTest` | **13 passed** | **13 passed** |
| `CommerceWorkspaceActivateEdgePostgresConcurrencyTest` | **skipped** (sqlite) | **1 passed** |
| `CommerceWorkspaceMakePrimaryDomainApiTest` | **16 passed** | **16 passed** |
| `CommerceWorkspaceDisconnectCustomDomainApiTest` (#861) | **12 passed** | **12 passed** |
| `CommerceWorkspaceAddCustomDomainApiTest` (1B-3A) | **11 passed** | **11 passed** |
| `CommerceWorkspaceVerifyCustomDomainApiTest` (1B-3A) | **13 passed** | **13 passed** |
| `CommerceWorkspaceStorefrontDomainsApiTest` (1B-2) | **11 passed** | **11 passed** |
| `StorefrontDomainResolutionApiTest` | **17 passed** | **17 passed** |
| `CommerceModuleBoundaryTest` | **3 passed** | **3 passed** |
| `CommerceWorkspaceDomainLifecyclePostgresConcurrencyTest` (#861) | **skipped** (sqlite) | **1 passed** |

### PostgreSQL

`CommerceWorkspaceActivateEdgePostgresConcurrencyTest`: **PASS**.

Concurrent Activate on one verified custom subdomain leaves a single hostname-derived `edge_provider_id`.

### Full suite / CI

| Gate | Run | Result |
|---|---|---|
| `php artisan test (L11, sqlite)` | [35376113993](https://github.com/safwan5001-source/Nebrax/actions/runs/35376113993) job [105701070679](https://github.com/safwan5001-source/Nebrax/actions/runs/35376113993/job/105701070679) | **SUCCESS** — **43 skipped, 4189 passed** (25735 assertions) |
| `php artisan test (L11, pgsql)` | [35376113993](https://github.com/safwan5001-source/Nebrax/actions/runs/35376113993) job [105701071005](https://github.com/safwan5001-source/Nebrax/actions/runs/35376113993/job/105701071005) | **SUCCESS** — **4232 passed** (25966 assertions), **0 failed, 0 skipped** |

pgsql − sqlite passed = 43, matching the sqlite skip count (includes pgsql-only concurrency tests).

## Migration Safety

- Additive nullable/default columns only
- Existing rows valid at `edge_status=none`
- No data backfill
- No Railway call on migrate
- `migrate --force` on boot still fails the container if the migration fails (good)

## Risks / Remaining

1. **EDGE-2 remains** — no Activate button, DNS copy UI, or Check HTTPS on `/commerce/domains`. Backend `edge` is ready for it.
2. **EDGE-3 remains** — Make Primary still 422 for custom even when `ready`. Disconnect still DB-only (orphan Railway bindings until provider-first).
3. **Railway plan / domain quota still UNKNOWN.** Hobby default 2 / Pro 20 per service. Create fails closed on quota.
4. **Production env credentials/IDs are not configured by this PR.** Activate/Refresh return 503 until ops set `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_STOREFRONT_SERVICE_ID` on the **Laravel** service (never Next.js, never git).
5. Target Railway service **must** be the storefront Next.js service, not the Laravel API. Wrong service id would attach Host to a process that never runs `ResolveStorefrontDomain`.
6. Frozen ICANN PSL snapshot (2026-09-18). New suffixes after that date fall through to the official default `*` rule (last label = public suffix) — fail-closed for 2-label apex, including unknown TLDs. Refresh the snapshot; do not fetch at runtime.
7. Dual TXT merchant confusion is an EDGE-2 copy problem, not an API contract change.

## Scope Confirmation

- no frontend EDGE-2
- no Make Primary opening for custom
- no Disconnect provider integration
- no apex / ALIAS / Cloudflare automation
- no background worker / queue
- no Railway token creation
- no deploy
- no merge
- no accounting changes
- no unrelated refactor
- no homemade label-count Public Suffix heuristic
- no new composer dependency
- no schema change
- 1B-3A TXT contract unchanged

## Recommended Next Action

1. Human: set Laravel env (`RAILWAY_API_TOKEN` workspace token + project/environment/storefront **service** ids). Confirm Railway plan/quota before production scale.
2. Review and merge this PR independently.
3. Next slice: **EDGE-2** frontend on `/commerce/domains` (Activate, DNS instructions, Check HTTPS). Still no Make Primary for custom.
4. Then **EDGE-3**: Make Primary iff live cert `CERTIFICATE_STATUS_TYPE_VALID`; Disconnect Railway-then-DB.

Do not merge from this agent.
Do not deploy from this agent.
Do not start EDGE-2 from this agent.
