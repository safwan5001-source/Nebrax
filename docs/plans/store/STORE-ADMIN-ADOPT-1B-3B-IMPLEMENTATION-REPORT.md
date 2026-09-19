# STORE-ADMIN-ADOPT-1B-3B — Safe Custom Domain Lifecycle — Implementation Report

## Status

**COMPLETE** (fail-closed on custom-domain Make Primary). PR opened, not merged, not deployed.

Custom Domain Edge/TLS provisioning is **not** in this slice. A verified custom domain proves DNS ownership only.

## Git

- Latest `main` SHA used: `b79e51f89e51166310900d723cda203577ff3bca`
- Confirmed ancestor of PR #856 merge SHA `0318f0eeaac1396283c290a3acfc5f93ce441875`
- Branch: `feat/store-admin-adopt-1b-3b-domain-lifecycle`
- PR: [#861](https://github.com/safwan5001-source/Nebrax/pull/861)
- Base SHA: `b79e51f89e51166310900d723cda203577ff3bca`
- Implementation SHA: `dd91a81d75483ffa80c4072053233afa74cad92b`
- Head SHA at report time: see the PR head (docs-only follow-ups after the implementation commit do not change behavior)

`main` had moved past #856 (`#859`, `#857`, `#860`). Those commits were kept; 1B-3A was not re-implemented.

## Repository Evidence

| Question | Finding |
|---|---|
| `is_primary` | Exclusive per storefront among **active** primaries. Partial unique index `storefront_domains_one_primary_active_per_storefront`. Legal/default URL only — **not** a resolver requirement. |
| `is_active` | Default `true`. Resolver requires `is_active` **and** `isVerified()`. Inactive domains do not resolve publicly. |
| `makePrimary()` | Transaction: demote other primaries on the same storefront, then set this row `is_primary = true`. No type/verification/TLS check inside the model. Reused as-is for eligible AWJ-managed domains. |
| Delete/soft-delete | **No SoftDeletes.** Migration comment: hard delete frees `hostname` immediately. This slice uses that existing hard-delete semantics. No migration added. |
| Resolver requirements | Hostname exists **and** `is_active` **and** `verification_status = verified`. Then active Storefront + active `web` SalesChannel of the same tenant. **Does not require `is_primary`.** Pending/failed/inactive never resolve. |
| Edge/TLS readiness state | **Does not exist.** No column, no boolean, no Railway/ACME/certificate/reachability persisted state on `StorefrontDomain`. |

### Exact blocker (fail-closed)

There is no authoritative persisted evidence that a custom domain is EDGE/TLS READY. Therefore this slice:

- does **not** invent a readiness boolean
- does **not** add a migration
- does **not** integrate Railway/TLS
- rejects Make Primary for every `custom` domain with 422, even when `verification_status = verified`

`verification_status = verified`, `verified_at`, DNS TXT success, `is_active`, `is_primary`, DNS/CNAME existence, and any client/frontend flag are **not** treated as HTTPS readiness.

## Implementation

### APIs added

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/commerce/workspace/storefronts/{id}/domains/{domainId}/make-primary` | Empty body. TenantContext + `commerce.manage`. |
| `DELETE` | `/api/commerce/workspace/storefronts/{id}/domains/{domainId}` | Empty body. TenantContext + `commerce.manage`. |

### Authorization

- Route middleware: `commerce.manage`
- Controller: `self_service` → 403
- Staff without `commerce.manage` → 403
- Guest → 401
- Owner and admin (wildcard `*`) allowed

### Tenant Isolation

Unknown / cross-tenant / cross-storefront domain → **404** (not 403). Lookup is scoped to the current tenant's storefront; the target domain is taken only from that storefront's locked rows.

Client cannot set `tenant_id`, `storefront_id`, `type`, `verification_status`, `verification_token`, `verified_at`, `is_primary`, `is_active`, or any edge-readiness flag. Extra body fields are ignored.

### Make Primary eligibility

- **AWJ-managed** (`awj_subdomain`): verified + active + owned → existing `StorefrontDomain::makePrimary()`. Already-primary is idempotent 200.
- **Custom**: always 422 `CustomDomainNotReadyForPrimaryException`.
  - If already TXT-verified: *"تم التحقق من ملكية النطاق، لكن تفعيل HTTPS/النطاق لم يكتمل بعد."*
  - Otherwise: not eligible until verification **and** HTTPS activation exist.
- Inactive / unverified AWJ-managed → 422 `DomainNotEligibleForPrimaryException`.

### Disconnect behavior

- Custom + not primary → hard delete. Hostname globally freed. Public resolver 404s.
- AWJ-managed → 422, row kept.
- Current primary (including a custom that was seeded as primary) → 422 fail-closed. No automatic failover to the AWJ-managed domain (no such proven primitive reused here).
- Unrelated domains on the same storefront are untouched.

### Transactions / locking

Both lifecycle ops run in a DB transaction, lock all storefront domain rows `ORDER BY id` (`lockForUpdate`), then decide. Make Primary still calls the existing model method; no new locking architecture. PostgreSQL concurrency test proves two concurrent eligible AWJ Make Primary calls leave exactly one active primary.

### Frontend

`/commerce/domains`:

- Make Primary shown only for eligible AWJ-managed (verified, active, not already primary).
- Disconnect shown only for custom domains, behind a confirmation dialog. No optimistic removal. Success → authoritative list reload.
- API failure leaves the row in place.
- Verified custom shows **Ownership verified** + **Awaiting domain activation** (AR/EN). Never labeled Ready.
- Verify Now / Add Custom Domain from 1B-3A unchanged.

## Security

- Cross-tenant: 404, no mutation.
- Cross-storefront: 404, no mutation.
- Public resolver: unchanged fail-closed contract. Disconnected hostname cannot resolve. Pending/failed custom still cannot resolve. Verified-but-not-edge-ready custom cannot become primary, so it cannot become the store's legal primary hostname through this slice. It can still resolve **if** it is verified+active (resolver never required primary) — that is pre-existing COM-7-P2A behavior, not introduced here.
- AWJ-managed domains cannot be disconnected on this path.
- Client-authority fields rejected / ignored.

## Files Changed

Backend:

- `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php`
- `app/Services/Commerce/CommerceWorkspaceStorefrontsService.php`
- `app/Services/Commerce/CustomDomainNotReadyForPrimaryException.php`
- `app/Services/Commerce/DomainNotEligibleForPrimaryException.php`
- `app/Services/Commerce/DomainNotDisconnectableException.php`
- `routes/api.php`
- `tests/Feature/CommerceModuleBoundaryTest.php`
- `tests/Feature/CommerceWorkspaceMakePrimaryDomainApiTest.php`
- `tests/Feature/CommerceWorkspaceDisconnectCustomDomainApiTest.php`
- `tests/Feature/CommerceWorkspaceDomainLifecyclePostgresConcurrencyTest.php`

Frontend:

- `web/src/app/(commerce)/commerce/domains/page.tsx`
- `web/src/app/(commerce)/commerce/domains/page.manage.test.tsx`
- `web/src/app/(commerce)/commerce/domains/page.lifecycle.test.tsx`
- `web/src/modules/commerce-workspace/domains.ts`
- `web/src/modules/commerce-workspace/domains.test.ts`
- `web/src/modules/commerce-workspace/messages.ts`
- `web/src/modules/commerce-workspace/messages.test.ts`

Docs:

- `docs/plans/store/STORE-ADMIN-ADOPT-1B-3B-IMPLEMENTATION-REPORT.md`

## Tests

### Targeted frontend (this environment)

| Suite | Result |
|---|---|
| `domains.test.ts` + `messages.test.ts` + domains page tests | **46 passed** |
| commerce-workspace + stores + domains | **76 passed** |

PHP is not installed in this sandbox (kernel-only repo; tests assemble Laravel in CI). Backend counts below are from GitHub Actions on PR #861, SHA `a064db8834ba933dc9493c210ec2800c72af17b9`.

### Targeted backend (CI)

Recorded from [CI run 35365149642](https://github.com/safwan5001-source/Nebrax/actions/runs/35365149642) (`pull_request` on HEAD `a064db8`).

| Suite | sqlite | pgsql |
|---|---|---|
| `CommerceWorkspaceMakePrimaryDomainApiTest` | **15 passed** | **15 passed** |
| `CommerceWorkspaceDisconnectCustomDomainApiTest` | **12 passed** | **12 passed** |
| `CommerceWorkspaceAddCustomDomainApiTest` (1B-3A) | **11 passed** | **11 passed** |
| `CommerceWorkspaceVerifyCustomDomainApiTest` (1B-3A) | **13 passed** | **13 passed** |
| `CommerceWorkspaceStorefrontDomainsApiTest` (1B-2) | **11 passed** | **11 passed** |
| `StorefrontDomainResolutionApiTest` | **17 passed** | **17 passed** |
| `CommerceModuleBoundaryTest` | **3 passed** | **3 passed** |
| `CommerceWorkspaceDomainLifecyclePostgresConcurrencyTest` | **skipped** (sqlite) | **1 passed** |

### PostgreSQL

`CommerceWorkspaceDomainLifecyclePostgresConcurrencyTest`: **PASS** on pgsql.

Concurrent Make Primary on two eligible AWJ-managed domains leaves exactly one active primary.

### Typecheck

`npx tsc --noEmit`: **zero errors in touched files**. Pre-existing errors remain in untouched POS/platform/documents/products/import-jobs tests (same class of leftovers reported on #856).

### Build

`next build` compiled the app (including `/commerce/domains`). Full lint gate in this sandbox is polluted by a parent App Builder lockfile and pre-existing eslint errors in untouched files. Authoritative web build is GitHub `web-ci.yml`.

### Full suite / CI

| Gate | Run | Result |
|---|---|---|
| `php artisan test (L11, sqlite)` | [35365149642](https://github.com/safwan5001-source/Nebrax/actions/runs/35365149642) job [105665671551](https://github.com/safwan5001-source/Nebrax/actions/runs/35365149642/job/105665671551) | **SUCCESS** — **42 skipped, 4112 passed** (25364 assertions) |
| `php artisan test (L11, pgsql)` | [35365149642](https://github.com/safwan5001-source/Nebrax/actions/runs/35365149642) job [105665671919](https://github.com/safwan5001-source/Nebrax/actions/runs/35365149642/job/105665671919) | **SUCCESS** — **4154 passed** (25587 assertions), **0 failed, 0 skipped** |
| `web build (Next.js)` | [35365149633](https://github.com/safwan5001-source/Nebrax/actions/runs/35365149633) | **SUCCESS** |

pgsql − sqlite = 42, matching the sqlite skip count (includes the pgsql-only concurrency test).

## Migration

**None.** No schema change. No SoftDeletes. No readiness column.

## Risks / Remaining

1. **Custom Domain Edge/TLS provisioning is still separate.** Verified custom domains cannot become Primary until a later slice persists real HTTPS/edge readiness (Railway domain registration + TLS/ACME), then Make Primary can be opened for that state only.
2. A verified+active custom domain can still **resolve publicly** (resolver does not require `is_primary`). That is pre-existing and out of scope to redesign.
3. Disconnect of the current primary is refused; the merchant must first Make Primary an eligible AWJ-managed domain. There is no automatic failover in this slice.

## Scope Confirmation

- no Railway integration
- no TLS automation
- no accounting changes
- no Store lifecycle
- no unrelated refactor
- no merge
- no deploy
- 1B-3A TXT contract unchanged (`_awj-verification.<hostname>` / `awj-domain-verification=<token>`)

## Recommended Next Action

Review and merge this PR independently. Next product slice, if desired: **Custom Domain Edge/TLS provisioning** (Railway registration + certificate readiness state), then reopen Make Primary for custom domains that have that evidence.

Do not merge from this agent.
Do not deploy from this agent.
Do not start any task after 1B-3B.
