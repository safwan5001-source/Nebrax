# CUSTOM-DOMAIN-EDGE-3 — Live-Ready Make Primary + Provider-First Disconnect — Implementation Report

## Status

**COMPLETE.** PR opened, not merged, not deployed.

EDGE-1 and EDGE-2 were not re-implemented. No schema migration. No resolver change.

## Git

- Latest `main` SHA used: `190bd71636980851e4231c3b640989398735bbc7`
- Confirmed ancestor of EDGE-1 / PR #864 `85e3dec6abd20e79707d2fcd68ddff90c4f9f3a9`
- Confirmed ancestor of EDGE-2 / PR #867 `190bd71636980851e4231c3b640989398735bbc7`
- Branch: `feat/custom-domain-edge-3-lifecycle`
- PR: [#870](https://github.com/safwan5001-source/Nebrax/pull/870)
- Base SHA: `190bd71636980851e4231c3b640989398735bbc7`
- Head SHA (CI-verified): `8fc5e54af6b918144af4255b2940ce378334dd14`

## Architecture Authority

- Document: `docs/plans/store/AWJ_CUSTOM_DOMAIN_EDGE_TLS_ARCHITECTURE.md` §15 Disconnect, §16 Make Primary, §20 Concurrency, §27 EDGE-3
- EDGE-1 report: `docs/plans/store/CUSTOM-DOMAIN-EDGE-1-IMPLEMENTATION-REPORT.md`
- EDGE-2 report: `docs/plans/store/CUSTOM-DOMAIN-EDGE-2-IMPLEMENTATION-REPORT.md`

`StorefrontEdgeClient::release()` already called Railway `customDomainDelete(id)`. No new GraphQL operation. `release()` now treats authoritative “already gone / not found” as success (idempotent). Timeout / 429 / 5xx remain fail-closed.

## Make Primary Preconditions

Custom domain, all required:

- `type = custom`
- `verification_status = verified`
- `is_active`
- provider is the supported configured provider (`railway`) when set
- live provider observation exists (fetch by stored id, else `findByHostname` within the configured storefront service)
- live snapshot is not missing
- mapped status is `ready` (EDGE-1 mapper: certificate ISSUED)
- then existing `StorefrontDomain::makePrimary()`

AWJ-managed: existing verified + active path. No Railway call.

Persisted `edge_status = ready` is **never** sufficient on its own.

## Live Provider Re-check

Every custom Make Primary:

1. Short `lockForUpdate` on all storefront domain rows: 404 isolation, local eligibility. AWJ promotes here. Custom captures hostname + provider id and **does not** promote.
2. **No DB lock:** `fetch(providerId)` if present; if missing, `findByHostname(hostname)` on the configured storefront service. Never `provision()`.
3. Transport / 429 / 5xx / misconfigured → **503**, no promotion.
4. Short lock: persist the observation via existing `applyEdgeSnapshot()` and **commit** (so a later 422 cannot roll back the live cache).
5. Short lock: revalidate local invariants, promote only if live status is `ready`.

If live DNS/TLS is no longer ready: persist the refreshed status, **422**, do **not** promote, do **not** auto-demote an already-primary domain (no failover).

## TOCTOU / Locking Strategy

Provider HTTP is **outside** the DB transaction (ticket requirement; avoids holding row locks across Railway).

Final promotion and local delete re-take the existing `lockForUpdate` of **all storefront domain rows `ORDER BY id`** (same #861 / EDGE-1 lock) and revalidate:

- domain still on this tenant/storefront
- still custom / still verified / still active
- still not primary (Disconnect)
- live-mapped `edge_status === ready` with a provider id (Make Primary)

**Disconnect ↔ Make Primary fence (no new column):** before any Railway `find`/`release`, Disconnect’s first lock rejects current primary, then sets `is_active = false` and **commits**. Make Primary already requires `is_active` in its first lock and again inside the promotion lock, so it cannot promote a domain that Disconnect has already fenced. On provider 503, Disconnect restores `is_active` only if the row is still custom and not primary (binding was not released).

Closed residual: `release()` while the row is concurrently primary, leaving a local primary without a Railway binding. Remaining residual: a certificate can lapse between the live fetch and the promotion lock (unchanged). Disconnect eligibility (not primary / not AWJ) is decided **before** any `release()`.

## Exactly-One-Primary Invariant

Unchanged: `StorefrontDomain::makePrimary()` demotes other primaries on the same storefront then sets this row. PostgreSQL concurrency test races two live-ready custom domains; exactly one active primary remains.

## AWJ-managed Regression

Existing Make Primary tests remain. EDGE-3 adds an explicit test that AWJ promotion does **zero** `fetch` / `provision` calls. No EDGE requirement was added to managed domains.

## Provider-First Disconnect

1. Lock: 404 isolation; AWJ → 422; current primary → 422. **No provider call yet.** If eligible, set `is_active = false` and commit (Make Primary fence).
2. Unlock. `findByHostname(hostname)` on the configured storefront service:
   - found → `release(that id)` (hostname-scoped; never deletes an unrelated Railway domain)
   - absent → confirmed absence; continue
   - timeout / 429 / 5xx → **503**, restore `is_active` if still custom/non-primary, local row remains
3. Lock: revalidate still custom and not primary; hard-delete the local row.

## Provider Reconciliation

- Hostname lookup is confined to EDGE-1’s configured storefront service (`projectId` / `environmentId` / `serviceId`).
- Stale stored `edge_provider_id` is **not** released if `findByHostname` does not match this hostname (avoids deleting an unrelated provider object).
- `release()` is idempotent when Railway reports the object already gone.
- Ambiguous / transport failure never becomes success.

## Idempotency

- Make Primary on an already-primary live-ready custom domain: 200, no `provision()`.
- Disconnect after successful release+delete: second call 404.
- Disconnect when provider already absent: local cleanup succeeds; no `provision()`.

## Tenant Isolation / RBAC

Unchanged:

| Case | Result | Provider |
|---|---|---|
| guest | 401 | no call |
| self_service | 403 | no call |
| staff without `commerce.manage` | 403 | no call |
| cross-tenant | 404 | no call |
| cross-storefront | 404 | no call |
| unknown domain | 404 | no call |

Client body fields (`tenant_id`, `edge_status`, `is_primary`, provider id, TLS) are ignored. Empty Make Primary body.

## Frontend Changes

Smallest change on `/commerce/domains`:

- `canMakeDomainPrimary` is true for custom when the **server-presented** `edge.status === 'ready'` (and verified, active, not already primary).
- Click uses the existing Make Primary API. Backend may still 422/503 after live refresh.
- No optimistic primary flip. Failure keeps previous rows.
- Disconnect confirmation unchanged. 503 keeps the row visible.
- AR/EN: `makePrimaryUnavailable`, `disconnectUnavailable`.

## Backend Changes

- `CommerceWorkspaceStorefrontsService::makePrimaryForCurrentTenant`
- `CommerceWorkspaceStorefrontsService::disconnectCustomDomainForCurrentTenant`
- Controller maps edge transport errors on Make Primary and Disconnect to 503
- `RailwayStorefrontEdgeClient::release()` idempotent on gone
- `FakeStorefrontEdgeClient` can simulate release outage

No new routes. No presenter change. No `ResolveStorefrontDomain` change.

## Schema Changes

**NONE.**

## Files Changed

Backend:

- `app/Services/Commerce/CommerceWorkspaceStorefrontsService.php`
- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php`
- `app/Services/Commerce/Edge/RailwayStorefrontEdgeClient.php`
- `app/Services/Commerce/Edge/FakeStorefrontEdgeClient.php`

Frontend:

- `web/src/modules/commerce-workspace/domains.ts`
- `web/src/modules/commerce-workspace/domains.test.ts`
- `web/src/modules/commerce-workspace/messages.ts`
- `web/src/app/(commerce)/commerce/domains/page.tsx`
- `web/src/app/(commerce)/commerce/domains/page.edge.test.tsx`

Tests:

- `tests/Feature/CommerceWorkspaceMakePrimaryCustomEdgeApiTest.php`
- `tests/Feature/CommerceWorkspaceCustomMakePrimaryPostgresConcurrencyTest.php`
- `tests/Feature/CommerceWorkspaceDisconnectMakePrimaryPostgresConcurrencyTest.php`
- `tests/Feature/CommerceWorkspaceMakePrimaryDomainApiTest.php`
- `tests/Feature/CommerceWorkspaceDisconnectCustomDomainApiTest.php`
- `tests/Feature/CommerceWorkspaceActivateEdgeApiTest.php`
- `tests/Feature/RailwayStorefrontEdgeClientTest.php`

Docs:

- `docs/plans/store/CUSTOM-DOMAIN-EDGE-3-IMPLEMENTATION-REPORT.md`

## Tests

Local Vitest (this environment):

| Suite | Result |
|---|---|
| `domains.test.ts` | **35 passed** |
| `messages.test.ts` | **5 passed** |
| `nav.test.ts` | **3 passed** |
| `stores.test.ts` | **14 passed** |
| `page.test.tsx` (1B-2) | **6 passed** |
| `page.manage.test.tsx` (1B-3A) | **6 passed** |
| `page.lifecycle.test.tsx` (1B-3B) | **7 passed** |
| `page.edge.test.tsx` (EDGE-2/3) | **13 passed** |
| commerce-workspace + domains pages | **89 passed** |

PHP: this sandbox has no `php` binary. Authoritative Laravel results are GitHub CI (`ci.yml` sqlite + pgsql) on Head `8fc5e54af6b918144af4255b2940ce378334dd14`.

| Suite (CI) | sqlite | pgsql |
|---|---|---|
| Full `php artisan test` | **44 skipped, 4224 passed** (25871 assertions) | **4268 passed** (26107 assertions), 0 failed |
| `CommerceWorkspaceMakePrimaryCustomEdgeApiTest` | PASS | PASS |
| `CommerceWorkspaceMakePrimaryDomainApiTest` | PASS | PASS |
| `CommerceWorkspaceDisconnectCustomDomainApiTest` | PASS | PASS |
| `RailwayStorefrontEdgeClientTest` | PASS | PASS |
| `CommerceWorkspaceCustomMakePrimaryPostgresConcurrencyTest` | skipped | **PASS** (exactly one active primary) |

Delta vs EDGE-2 `190bd71`: sqlite +26, pgsql +27 (EDGE-3 cases + pgsql concurrency).

## PostgreSQL Concurrency

`CommerceWorkspaceCustomMakePrimaryPostgresConcurrencyTest` forks two live-ready custom Make Primary calls. GitHub pgsql job: **PASS** — exactly one active primary remains.

## TypeScript

Touched files typecheck via Next.js `web-ci.yml` build. Pre-existing `tsc` errors remain in untouched POS/platform/products tests.

## Build / CI

Recorded from PR [#870](https://github.com/safwan5001-source/Nebrax/pull/870) Head `8fc5e54af6b918144af4255b2940ce378334dd14`:

| Gate | Run | Result |
|---|---|---|
| `web build (Next.js)` + Vitest | [35397137716](https://github.com/safwan5001-source/Nebrax/actions/runs/35397137716) | **SUCCESS** — **1894 tests passed**; Next.js compile succeeded |
| `php artisan test (L11, sqlite)` | [35397137764](https://github.com/safwan5001-source/Nebrax/actions/runs/35397137764) | **SUCCESS** — **44 skipped, 4224 passed** (25871 assertions) |
| `php artisan test (L11, pgsql)` | [35397137764](https://github.com/safwan5001-source/Nebrax/actions/runs/35397137764) | **SUCCESS** — **4268 passed** (26107 assertions), **0 failed** |

No backend schema files changed.

## Risks / Remaining

1. Residual TOCTOU: live ISSUED then cert revoked before the promotion lock. Fail-closed on the next Make Primary / Refresh.
2. Disconnect fences Make Primary by committing `is_active = false` before Railway HTTP. PostgreSQL test `CommerceWorkspaceDisconnectMakePrimaryPostgresConcurrencyTest` asserts the disconnect child never `release()`s if the row remains primary.
3. No automatic failover. Primary custom that later loses TLS stays primary until the merchant switches.
4. Railway plan/quota still UNKNOWN (architecture).
5. 503 after fence: `is_active` is restored so the merchant can retry Disconnect or later Make Primary; the Railway binding was not released.

## Scope Confirmation

- no migration/schema
- no resolver loosening
- no provider secret exposure
- no auto failover
- no deploy
- no merge
- no accounting changes
- no unrelated refactor
- no apex domains
- no polling / queues / cron
- no Cloudflare
- EDGE-1 mapper and GraphQL operations otherwise unchanged
- EDGE-2 Activate → DNS → HTTPS Ready UX unchanged except Make Primary on `ready`

## Recommended Next Action

Review and merge this PR independently. No further custom-domain lifecycle slice is specified after EDGE-3.

Do not merge from this agent.
Do not deploy from this agent.
