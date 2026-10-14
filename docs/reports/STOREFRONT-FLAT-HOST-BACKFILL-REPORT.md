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
3. **One DB transaction per execute, all-or-nothing.** Tenant rows locked (`FOR UPDATE`, sorted ids — the same anchor `CreateStorefrontForCurrentTenant`/`StorefrontProvisioningService` use) plus the legacy domain rows; sources re-read after locking; `UNIQUE(hostname)` is the last line. Any conflict rolls back every host.
4. **Dry-run:** no transaction, no locks, no write; prints `would_insert`.
5. **Idempotent.** Existing target with the same tenant+storefront+`awj_subdomain` → `already_present`, no write. If its `is_active` **or `verification_status`** differs from the desired state → `--dry-run` reports `drift` (exit non-zero); `--execute` **aborts and rolls back the whole transaction** (no partial inserts for other hosts) with reason `drift`. The drifted row is never corrected (e.g. someone activated `dominah-h`).
6. **No inactive→active.** New row is active only if domain, verification, storefront (not deleted) and sales channel (not deleted) are all active/verified; otherwise inactive. The original `h` storefront/domain stay inactive (asserted).
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
| `tests/Feature/FlatHostBackfillTest.php` | new — 23 tests |
| `docs/reports/STOREFRONT-FLAT-HOST-BACKFILL-REPORT.md` | new — this report |

No migration, no schema change, no API/route change, no change to resolution or financial code.

## 3. Tests

| Run | Result |
|---|---|
| `php artisan test --filter=FlatHostBackfillTest` (local SQLite) | **23 passed** |
| Related: `FlatHostBackfillTest\|FlatStorefrontHostTest\|MultiStore\|StorefrontProvisioning\|StorefrontDomain\|StorefrontGateway\|ApplicationCatalog` | **166 passed, 1 skipped, 0 failed** |
| Mutation check | flipping `is_primary` to `true` made 8 tests fail (partial unique index + tests bite); reverted |
| PostgreSQL | not available locally — **runs in CI's pgsql leg** (same `RefreshDatabase` tests; this is where `FOR UPDATE` and the partial index are really exercised) |
| Full local suite | not re-run for this PR (previous run: 154 sandbox-only failures identical on untouched `main`); CI is authoritative |
| CI on this PR | see PR checks (reported in the hand-off message when finished) |

Coverage map: mode flags & no-host/too-many · dry-run no-write · bindings and states of both rows (zhor-tyb active, h inactive) · legacy rows byte-identical · h storefront stays inactive · idempotent re-run (no duplicates) · drift reported not fixed · primary constraint · cross-tenant target taken (rollback of the other host) · tenant-slug reservation · dash-concatenation ambiguity · tenant mismatch · ineligible/invalid/unknown hosts · first-store host · other tenant with same store slug untouched · resolution after backfill (new active host resolves, new `h` host 404, legacy hosts unchanged, no redirect, no cross-tenant fallback, forwarded-host without secret ignored).

## 4. Legacy HTTPS links (item 11)
The backfill changes **data only**. Certificates/DNS are untouched, so `https://zhor-tyb.dominah.store.awjdev.xyz` and `https://h.dominah.store.awjdev.xyz` **remain TLS-invalid** (cert `*.store.awjdev.xyz` does not cover two labels). The tests assert the legacy rows and their app-level behaviour are unchanged and that no redirect is introduced. The new single-label hosts are the only working HTTPS URLs.

## 5. Decision needed (not decided here): what "Open Store" shows
`preview_url` (`authorizedPreviewUrl`) picks the **primary** verified active domain first. The legacy row is still `is_primary` and active, and this PR (insert-only) cannot change that — so **Open Store for `zhor-tyb` will keep showing the TLS-broken legacy URL after the backfill** until one of these follow-ups (each needs your approval):

| Option | What | Data write? |
|---|---|---|
| **P1 (recommended)** | Code PR: `authorizedPreviewUrl` ranks nested managed legacy hosts (within base but not one-label) *below* every other candidate | none |
| P2 | One-off UPDATE: demote the legacy row (`is_primary=false`) and promote the new one, in a transaction, via `DomainMakePrimary` semantics | 2 UPDATEs on production |

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
- Open Store still shows the legacy URL until §5 is decided.
- Production-only conditions I cannot see: a row inserted between your S1–S5 inventory and the run (handled: `target_taken`/conflict abort); legacy `zhor-tyb` primary state (irrelevant to insert).
- Only the two listed hosts are in scope; the fleet-wide backfill (if any other legacy hosts exist) would reuse the same command with more `--host` values after its own inventory.
- **Registration race (Codex P2, accepted, not coded):** a tenant registering the slug `dominah-h` / `dominah-zhor-tyb` *during the few seconds of `--execute`* could pass validation and insert its tenant while the backfill inserts the domain (two tables, independent unique constraints) → that tenant could not provision its own first-store host. Closing it needs a DB-enforced cross-table reservation (schema) or a global lock — disproportionate for a one-off run on two known hosts. Mitigation: run `--execute` once in a quiet window; after the run `RegisterRequest` rejects those slugs (it checks existing `awj_subdomain` hosts); post-check `SELECT id, slug FROM tenants WHERE slug IN ('dominah-h','dominah-zhor-tyb');` must return 0 rows.
- PostgreSQL locking/index behaviour is verified by CI, not locally.
- The new `zhor-tyb` host serves the storefront immediately on `--execute` (it is active by design).

## 8. Next step
Review → CI green → your merge approval → deploy → you run the runbook (dry-run first). I'll ask for production execution approval only after review and CI are complete.
