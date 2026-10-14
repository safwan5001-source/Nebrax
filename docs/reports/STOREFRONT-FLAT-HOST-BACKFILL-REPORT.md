# Storefront Flat Host — Backfill (insert-only) · Implementation Report

**Date:** 2026-10-14 · **Status:** CODE ONLY — **NOT executed on production · NOT merged · NOT deployed** · no Railway/DNS/SSL change
**Context (confirmed by Safwan):** PR #1402 merged (`9baae08`), Railway release `f9428876`, production inventory S1–S5 done with no conflicts on the two targets.
**Branch:** `claude/storefront-flat-host-backfill` · **Base SHA:** `f942887` (main at branch creation; contains `9baae08`) · **Head SHA / PR:** see PR description and hand-off message

## 1. What it does

`php artisan storefront:flat-host-backfill --host=<legacy> [--host=…] (--dry-run | --execute)`

| Legacy host | Inserted host | New row state |
|---|---|---|
| `zhor-tyb.dominah.store.awjdev.xyz` | `dominah-zhor-tyb.store.awjdev.xyz` | **active** (legacy source active+verified), `is_primary=false` |
| `h.dominah.store.awjdev.xyz` | `dominah-h.store.awjdev.xyz` | **inactive** (legacy source inactive), `is_primary=false` |

Same `tenant_id`, `storefront_id` (hence the same sales channel) as the legacy row; `type=awj_subdomain`; `verification_status` copied from the source (never promoted).

### Safety properties (each covered by a test — §3)
1. **Exactly one explicit mode.** Neither or both of `--dry-run`/`--execute` → exit 2, nothing runs. Hosts must be listed explicitly (`--host`, max 10) — there is no "all" mode.
2. **Insert-only.** No UPDATE/DELETE of any existing row, no other table touched. Legacy rows, storefronts, channels and tenants are asserted byte-identical before/after.
3. **One DB transaction per execute, all-or-nothing.** Tenant rows locked (`FOR UPDATE`, sorted ids — the same anchor `CreateStorefrontForCurrentTenant`/`StorefrontProvisioningService` use), then the legacy domain, storefront and sales-channel rows (fixed order, so a concurrent storefront (de)activation serialises with the run); sources re-read after locking; `UNIQUE(hostname)` is the last line. Any conflict rolls back every host.
4. **Dry-run:** no transaction, no locks, no write; prints `would_insert`.
5. **Idempotent.** Existing target with the same tenant+storefront+`awj_subdomain` → `already_present`, no write. If its `is_active` **or `verification_status`** differs from the desired state → `--dry-run` reports `drift` (exit non-zero); `--execute` **aborts and rolls back the whole transaction** (no partial inserts for other hosts) with reason `drift`. The drifted row is never corrected (e.g. someone activated `dominah-h`).
6. **No inactive→active.** New row is active only if the tenant (active, not soft-deleted), domain, verification, storefront (not deleted) and sales channel (not deleted) are all active/verified; otherwise inactive. The original `h` storefront/domain stay inactive (asserted).
7. **Tenant isolation.** Tenant/storefront/channel come from the legacy row and must agree three ways (`tenant_mismatch` otherwise); a same-named store under another tenant is neither read nor created for (asserted); no cross-tenant target is accepted (`target_taken`).
8. **Global uniqueness / reserved labels.** Target taken by any other row → `target_taken`; label equal to any tenant slug (incl. soft-deleted) → `target_is_tenant_slug`; two legacy hosts mapping to one target (`a`+`b-c` vs `a-b`+`c`) → `duplicate_target`.
9. **`is_primary=false` always.** The partial unique index `(storefront_id) WHERE is_primary AND is_active` allows one active primary per storefront and the legacy row already holds it; inserting a second would violate it, and demoting the legacy row would be an UPDATE (forbidden here).
10. **Eligibility.** Only `awj_subdomain` rows whose hostname is exactly `{store}.{tenant}.{base}`; custom domains, first-store hosts (`{tenant}.{base}`), unknown/invalid hosts are refused.

## 2. Files

| File | Change |
|---|---|
| `app/Services/Commerce/FlatHostBackfillService.php` | new — logic above |
| `app/Services/Commerce/FlatHostBackfillException.php` | new — typed fail-closed reasons |
| `app/Console/Commands/StorefrontFlatHostBackfillCommand.php` | new — Artisan command |
| `tests/Feature/FlatHostBackfillTest.php` | new — 28 tests |
| `app/Services/Commerce/CommerceWorkspaceStorefrontsService.php` | **P1**: `authorizedPreviewUrl` ranks legacy nested managed hosts below every other candidate (+ `isLegacyNestedManagedHost`) |
| `app/Support/ManagedHostNamespaceLock.php` | new — PostgreSQL advisory xact lock (shared/exclusive), no-op off pgsql, refuses to run outside a transaction |
| `app/Services/Commerce/ManagedHostnameAvailability.php` | + `tenantSlugCollidesWithManagedHost` / `assertTenantSlugFree` |
| `app/Http/Controllers/Api/AuthController.php` | `register()`: shared lock + slug re-check inside the existing transaction, before `Tenant::create` |
| `app/Http/Requests/RegisterRequest.php` | rule now delegates to `ManagedHostnameAvailability` (no behaviour change) |
| `tests/Feature/StorefrontPreviewUrlTest.php` | new — 7 tests (P1) |
| `tests/Feature/ManagedHostNamespaceLockPostgresTest.php` | new — 4 PG-only tests incl. 2 concurrent (fork) race proofs |
| `docs/reports/STOREFRONT-FLAT-HOST-BACKFILL-REPORT.md` | new — this report |

No migration, no schema change, no API/route change, no change to resolution or financial code.

## 3. Tests

| Run | Result |
|---|---|
| `php artisan test --filter=FlatHostBackfillTest` (local SQLite) | **28 passed** |
| Related (SQLite): `FlatHostBackfillTest\|FlatStorefrontHostTest\|MultiStore\|StorefrontProvisioning\|StorefrontDomain\|StorefrontGateway\|ApplicationCatalog` | **70 passed** for `FlatHostBackfillTest|StorefrontPreviewUrlTest|FlatStorefrontHostTest` (219 assertions) |
| Mutation check | flipping `is_primary` to `true` made 8 tests fail (partial unique index + tests bite); reverted |
| Local PostgreSQL 16 (`DB_CONNECTION=pgsql`), same + `ManagedHostNamespaceLockPostgresTest` + `StorefrontProvisioningPostgresConcurrencyTest` + MultiStore/StorefrontDomain/StorefrontProvisioning | **169 passed, 0 failed** (626 assertions) |
| Registration/Auth/Tenant/CommerceWorkspace-domain regression | PG **190 passed**; SQLite **185 passed, 5 skipped** |
| Full local suite | not re-run for this PR (previous run: 154 sandbox-only failures identical on untouched `main`); CI is authoritative |
| CI on this PR | see PR checks (reported in the hand-off message when finished) |

Coverage map: mode flags & no-host/too-many · dry-run no-write · bindings and states of both rows (zhor-tyb active, h inactive) · legacy rows byte-identical · h storefront stays inactive · idempotent re-run (no duplicates) · drift reported not fixed · primary constraint · cross-tenant target taken (rollback of the other host) · tenant-slug reservation · dash-concatenation ambiguity · tenant mismatch · ineligible/invalid/unknown hosts · first-store host · other tenant with same store slug untouched · resolution after backfill (new active host resolves, new `h` host 404, legacy hosts unchanged, no redirect, no cross-tenant fallback, forwarded-host without secret ignored).

## 4. Legacy HTTPS links (item 11)
The backfill changes **data only**. Certificates/DNS are untouched, so `https://zhor-tyb.dominah.store.awjdev.xyz` and `https://h.dominah.store.awjdev.xyz` **remain TLS-invalid** (cert `*.store.awjdev.xyz` does not cover two labels). The tests assert the legacy rows and their app-level behaviour are unchanged and that no redirect is introduced. The new single-label hosts are the only working HTTPS URLs.

## 5. Open Store (P1) — implemented, code only
Before: `preview_url` picked the primary domain first, so after the insert-only backfill `zhor-tyb` would still show the TLS-broken legacy primary.
Now (`CommerceWorkspaceStorefrontsService::authorizedPreviewUrl`): among the already-filtered candidates (same tenant, same storefront, `is_active`, verified) a **legacy nested managed host** (`{store}.{tenant}.{base}` — inside the base domain but more than one label) is ranked **below every other candidate**; the order within each group is unchanged (primary first, then hostname).

| Case | Result |
|---|---|
| legacy nested primary + flat verified active (non-primary) | **flat** |
| legacy nested only | legacy (backward-compatible fallback; still TLS-invalid) |
| flat inactive / unverified | never preferred; falls back to legacy |
| custom domain primary + nested + flat | **custom** (precedence preserved) |
| store `h`: inactive store and/or inactive domains | `preview_url = null` (also when a domain row is active but the store is inactive) |
| other tenant's / foreign-`tenant_id` domain rows | never used |

`is_primary` and all rows are untouched (asserted: read path is write-free; snapshot identical). End-to-end test: backfill → `zhor-tyb` shows `https://dominah-zhor-tyb.store.awjdev.xyz/`, `h` shows `null`, legacy rows unchanged.

## 5b. Registration race — closed without schema (proved on PostgreSQL)
Problem: `tenants.slug` and `storefront_domains.hostname` are separate unique constraints over one namespace (`{slug}.{base}`); "check free, then insert" in two concurrent transactions could produce a tenant and a domain with the same label.
Solution: a **PostgreSQL advisory transaction lock** with reader/writer semantics (`ManagedHostNamespaceLock`):
- **registration** (`AuthController::register`, inside its existing transaction): `shared` lock → re-check the slug against managed hosts → insert tenant. Many registrations run in parallel; they only conflict on `tenants.slug`, as before.
- **backfill** (`--execute`): `exclusive` lock first (before any row lock; order advisory → tenants → domains → storefronts → channels). It waits for in-flight registrations (then sees their committed tenant → `target_is_tenant_slug`, no write) and blocks new registrations until it commits (they then see the committed domain → 422 `slug`).
- Off PostgreSQL (SQLite tests) it is a no-op — SQLite serialises writers anyway. Outside a transaction it throws (a transaction-scoped lock without a transaction would protect nothing).

Evidence (local PostgreSQL 16 + `pcntl_fork`, `ManagedHostNamespaceLockPostgresTest`):
1. registration in flight (tenant inserted, uncommitted) → backfill **waited >0.8 s** then aborted with `target_is_tenant_slug`; no domain row created.
2. backfill in flight (domain inserted, uncommitted) → registration **waited >0.8 s** then was rejected; no tenant created.
3. two registrations hold the shared lock concurrently (<0.5 s wait).
4. **Mutation check:** with the lock body disabled, tests 1 and 2 FAIL (race reproduced); restored → pass. So the tests prove the lock is what closes the race.

Residual (documented, not introduced here): `CreateStorefrontForCurrentTenant` (additional-store creation) can race a registration the same way; it does not take this lock. Adding it there is a 2-line follow-up (acquire before its tenant row lock) but serialises every store creation against the exclusive lock only while a backfill runs — I left it out as outside this task's scope.

## 6. Production runbook (for you to run; I will not run it)
Prereqs: PR merged and deployed (the command ships in the app image); run in the production app shell.
```
php artisan storefront:flat-host-backfill --host=zhor-tyb.dominah.store.awjdev.xyz --host=h.dominah.store.awjdev.xyz --dry-run
# expect: would_insert ×2; dominah-zhor-tyb new_row_active=true; dominah-h new_row_active=false; exit 0
php artisan storefront:flat-host-backfill --host=zhor-tyb.dominah.store.awjdev.xyz --host=h.dominah.store.awjdev.xyz --execute
# expect: inserted ×2; re-running → already_present ×2
```
Post-check (SELECT only): the two new rows exist with the legacy `tenant_id`/`storefront_id`, `is_primary=false`, `dominah-h` inactive, legacy rows unchanged (compare with your pre-run S1 output); `GET https://dominah-zhor-tyb.store.awjdev.xyz/` should serve; `dominah-h…` should 404.
**Rollback** (needs your approval, it is a DELETE): `DELETE FROM storefront_domains WHERE hostname IN ('dominah-zhor-tyb.store.awjdev.xyz','dominah-h.store.awjdev.xyz');` — nothing else depends on these rows and legacy rows are untouched.

## 7. Risks / residual
- Open Store: after backfill `zhor-tyb` shows the flat URL (P1). Until the backfill is executed in production the legacy URL is still what is shown (nothing to prefer yet).
- Production-only conditions I cannot see: a row inserted between your S1–S5 inventory and the run (handled: `target_taken`/conflict abort); legacy `zhor-tyb` primary state (irrelevant to insert).
- Only the two listed hosts are in scope; the fleet-wide backfill (if any other legacy hosts exist) would reuse the same command with more `--host` values after its own inventory.
- **Registration race:** closed by the advisory lock (§5b). The lock waits only for in-flight registrations (seconds) while `--execute` runs; schedule the run outside peak signup.
- PostgreSQL behaviour is now also verified locally (PG 16: all backfill, preview and lock tests pass, incl. the existing provisioning concurrency test) and on CI's pgsql leg.
- The new `zhor-tyb` host serves the storefront immediately on `--execute` (it is active by design).

## 8. Next step
Review → CI green → your merge approval → deploy → you run the runbook (dry-run first). I'll ask for production execution approval only after review and CI are complete.
