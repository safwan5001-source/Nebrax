# Storefront Flat Host — Production Inventory Gate

**Date:** 2026-10-13 · **PR:** #1402 (open, **not merged**) · **Branch:** `claude/store-host-flat-migration-diagnosis`
**Base SHA (main at report time):** `3683c3e` (merge-base with the branch: `0c90419`) · **Head SHA:** see §8
**Scope:** `h.dominah.store.awjdev.xyz`, `zhor-tyb.dominah.store.awjdev.xyz` → `dominah-h…`, `dominah-zhor-tyb…`
**Mutations performed:** none. No INSERT/UPDATE/DELETE, no backfill, no DNS/Railway change, no production credential used or recorded.

> ## GATE RESULT: **BLOCKED — production data not readable from this session.**
> Items 1–5 of the gate (tenant/storefront binding, `h` inactive state, target-name conflicts) **cannot be confirmed** here.
> The request refers to "manual inventory results", but **none were attached to the message**, and this session has no read path to the production
> database (Railway tooling exposes service/domain/variable metadata only — values are redacted — and no SQL tool; I deliberately did **not** use the
> Railway agent or any DB credential). Nothing below should be read as a successful inventory.
> Run §3 (SELECT-only) and send the output; the gate can then be closed.

---

## 1. Confirmed (from repository, tests, and public read-only probes)

| # | Statement | Evidence |
|---|---|---|
| C1 | Both legacy hosts have the nested shape `{store}.{tenant}.store.awjdev.xyz` and can only have been produced by `forAdditionalStoreSlug` before Option A (`h` = store slug, `dominah` = tenant slug). | code + earlier TLS evidence (cert is `*.store.awjdev.xyz`, nested name mismatches) |
| C2 | Targets under Option A: `dominah-h.store.awjdev.xyz`, `dominah-zhor-tyb.store.awjdev.xyz` — both single-label, covered by the existing wildcard cert. | `FlatStorefrontHostTest` |
| C3 | The planner maps exactly that pair from rows shaped like production (tenant `dominah`; store `h` **inactive**, store `zhor-tyb` active), reports no conflicts, binds each row to its own `tenant_id`/`storefront_id`, and flags `h` as `apply_as=inactive`. A same-named store `h` under another tenant maps to `other-h…` (no cross-tenant influence). | new test `production_shape_h_inactive_and_zhor_tyb_active_map_to_free_targets_and_inactive_stays_inactive` |
| C4 | The planner is read-only (table snapshot identical before/after) and has no apply option. | tests |
| C5 | Creating new stores **cannot reactivate** an inactive store/domain: a new store named `h` becomes `h-2` → `dominah-h-2…`; the old store and domain rows stay inactive; the old host still 404s. | new test `creating_new_stores_never_reactivates_an_inactive_store_or_domain` |
| C6 | Host resolution is exact-row, fails closed for inactive domain/storefront/unverified, and never falls back across tenants. | existing `StorefrontDomainResolutionApiTest` + `FlatStorefrontHostTest` |
| C7 | Global uniqueness: `storefront_domains.hostname` UNIQUE + `ManagedHostnameAvailability` (domain row **or** any tenant slug incl. soft-deleted) → deterministic suffix; registration rejects a slug equal to a managed host label. Tenant isolation of creation verified (`MultiStoreCreation*`, `FlatStorefrontHostTest`). | tests |
| C8 | PR #1402 vs latest `main` (`3683c3e`): `git merge-tree` reports **no conflicts**; none of the 35 files changed on `main` since the merge-base touch host/storefront-domain code. | git |

Reactivation risk review (code): the only code that flips an existing domain back to active is `StorefrontProvisioningService::ensureManagedDomain()`
(first-store provisioning, host `{tenant}.{base}` only). `h.dominah…` is not that host, so it is unaffected. The planner never proposes `active` for an inactive
source; any future apply step **must** honour `apply_as` (create the new row inactive, or skip when `skip_deleted`) and must not modify the legacy row.

## 2. Not verified (needs production read access)

| # | Item | Why unverified |
|---|---|---|
| U1 | That `h.dominah…` and `zhor-tyb.dominah…` exist as `awj_subdomain` rows at all, and their `tenant_id` / `storefront_id` | no DB read |
| U2 | That each domain's tenant == its storefront's tenant == its sales-channel's tenant (`dominah`) | no DB read |
| U3 | That store `h` is **inactive** (`storefronts.is_active=false`, domain `is_active`) and not soft-deleted | no DB read |
| U4 | That `dominah-h.store…` / `dominah-zhor-tyb.store…` are free as domain rows **and** as tenant slugs (incl. soft-deleted tenants) | no DB read |
| U5 | That no other tenant already owns a conflicting label; the full fleet-wide inventory (previous report Q1–Q9) | no DB read |
| U6 | Whether `dominah`'s own first-store host `dominah.store…` exists | no DB read |

Public probes can't help: `*.store.awjdev.xyz` resolves and serves for any label (wildcard), so DNS/HTTP says nothing about DB rows.

## 3. SELECT-only queries to run (PostgreSQL)

Run in a read-only session: `BEGIN READ ONLY;` … `ROLLBACK;`. They return identifiers and flags only (no PII, no secrets).

```sql
-- S1  Binding + state of the two legacy hosts   (covers U1, U2, U3)
SELECT d.hostname, d.type, d.is_primary,
       d.is_active  AS domain_active, d.verification_status,
       d.id AS domain_id, d.tenant_id AS domain_tenant_id,
       s.id AS storefront_id, s.tenant_id AS storefront_tenant_id, s.slug AS store_slug,
       s.is_active  AS store_active, s.deleted_at AS store_deleted_at,
       c.id AS channel_id, c.tenant_id AS channel_tenant_id, c.type AS channel_type, c.is_active AS channel_active,
       t.id AS tenant_id, t.slug AS tenant_slug, t.is_active AS tenant_active, t.deleted_at AS tenant_deleted_at,
       (d.tenant_id = s.tenant_id AND s.tenant_id = c.tenant_id AND c.tenant_id = t.id) AS tenant_consistent
FROM storefront_domains d
LEFT JOIN storefronts    s ON s.id = d.storefront_id
LEFT JOIN sales_channels c ON c.id = s.sales_channel_id
LEFT JOIN tenants        t ON t.id = d.tenant_id
WHERE d.hostname IN ('h.dominah.store.awjdev.xyz', 'zhor-tyb.dominah.store.awjdev.xyz');
-- PASS: exactly 2 rows; tenant_consistent = true on both; tenant_slug = 'dominah' on both;
--       store_slug 'h' / 'zhor-tyb'; for h: store_active = false AND domain_active = false (or at least store_active = false), store_deleted_at NULL.

-- S2  Targets must be free as domains and as tenant slugs   (covers U4)
SELECT 'domain' AS kind, hostname AS value FROM storefront_domains
 WHERE hostname IN ('dominah-h.store.awjdev.xyz', 'dominah-zhor-tyb.store.awjdev.xyz')
UNION ALL
SELECT 'tenant_slug', slug FROM tenants            -- includes soft-deleted (no deleted_at filter)
 WHERE slug IN ('dominah-h', 'dominah-zhor-tyb');
-- PASS: 0 rows.

-- S3  Everything the tenant 'dominah' owns (sanity for U6 and unexpected extra stores)
SELECT s.slug AS store_slug, s.is_active, s.deleted_at, d.hostname, d.type, d.is_primary, d.is_active AS domain_active, d.verification_status
FROM tenants t
LEFT JOIN storefronts s ON s.tenant_id = t.id
LEFT JOIN storefront_domains d ON d.storefront_id = s.id
WHERE t.slug = 'dominah'
ORDER BY s.slug, d.hostname;

-- S4  Same store slugs under other tenants (they must map to their own prefix, never to dominah-)
SELECT t.slug AS tenant_slug, s.slug AS store_slug, d.hostname
FROM storefronts s JOIN tenants t ON t.id = s.tenant_id
LEFT JOIN storefront_domains d ON d.storefront_id = s.id
WHERE s.slug IN ('h', 'zhor-tyb') AND t.slug <> 'dominah';

-- S5  Fleet-wide: any other legacy row whose target would equal one of ours or each other   (covers U5)
WITH legacy AS (
  SELECT d.id, d.hostname, t.slug AS ts, s.slug AS ss, t.slug || '-' || s.slug AS label
  FROM storefront_domains d
  JOIN tenants t ON t.id = d.tenant_id
  JOIN storefronts s ON s.id = d.storefront_id
  WHERE d.type = 'awj_subdomain' AND d.hostname = s.slug || '.' || t.slug || '.store.awjdev.xyz')
SELECT label, count(*) AS n, array_agg(hostname ORDER BY hostname) AS legacy_hosts
FROM legacy GROUP BY label HAVING count(*) > 1;
-- PASS: 0 rows.   (Q3/Q4/Q5 from the Option A report cover tenant-slug and existing-domain collisions fleet-wide.)
```

Also (read-only application command, same DB, preferred if you can run it where `APP_ENV=production` is already configured):
`php artisan storefront:flat-host-plan --json` — expected for the two rows: `status=legacy_nested`, `conflicts=[]`, `target` as above,
`apply_as=active` for `zhor-tyb`, `apply_as=inactive` for `h`.

### Pass criteria to close the gate
1. S1 returns both rows, `tenant_consistent=true`, tenant `dominah`.
2. `h`: store inactive (and domain inactive), not deleted. If `h` turns out **active**, stop — that contradicts the premise and needs your decision.
3. S2 and S5 return 0 rows.
4. Any row in S3/S4 not explained by the premise is reported back before any apply design.

## 4. Conflicts / risks found

| Risk | Status |
|---|---|
| Reactivation of inactive `h` by a later migration | **Mitigated in the plan tooling**: planner emits `apply_as=inactive`; tests assert it. **Residual:** the apply step does not exist yet — when written it must be tested against `apply_as` and must never UPDATE legacy rows. |
| Target collision (`dominah-h`, `dominah-zhor-tyb`) | **Unverified** (U4). Code-side, creation/registration guards prevent new collisions; pre-existing rows are unknown. |
| Old nested HTTPS links (`h.dominah…`, `zhor-tyb.dominah…`) | Remain unreachable in browsers (TLS name mismatch). A redirect is **not** claimed. |
| Inactive `h` host resolves 404 today and after migration | Expected; asserted by test. |
| Long/odd slugs | unchanged from prior report (fail-closed). |

## 5. Tenant isolation / global uniqueness of new store creation
Verified by tests (see C5–C7): creation is bound to the current tenant context, hostnames derive from stored tenant+store slugs only, identical store slugs under two tenants
get distinct hosts, dash-concatenation ambiguity resolves deterministically without sharing a host, tenant-slug labels are reserved, DB UNIQUE is the final guard.
Changes in this step touch only the read-only planner and tests — **no isolation rule changed**.

## 6. Code changes in this step
- `app/Services/Commerce/FlatHostMigrationPlanner.php`: now reads storefront/domain state (`is_active`, `verification_status`, soft-delete); adds per-row `storefront_id`, `store_active`, `store_deleted`, `apply_as`; summary `inactive_sources`.
- `app/Console/Commands/StorefrontFlatHostPlanCommand.php`: prints `apply_as`.
- `tests/Feature/FlatStorefrontHostTest.php`: two new tests (production-shape mapping with inactive `h`; no reactivation by new store creation). Helper `legacyRow()` returns models and accepts an inactive flag.

## 7. Tests and CI
| Check | Result |
|---|---|
| `php artisan test --filter='FlatStorefrontHostTest\|MultiStore\|StorefrontProvisioning\|StorefrontGateway\|StorefrontDomain'` (local SQLite) | **138 passed, 1 skipped, 0 failed** (489 assertions) |
| Full suite locally | not re-run in this step (prior step: 154 sandbox-only failures identical on untouched `main`); CI is authoritative |
| CI on the previous PR head `35bf688` | sqlite ✔, pgsql ✔, CI Gate ✔, web build ✔, Horizon evaluator ✔ |
| CI on the new head (this step's commit) | pending at report time — see PR checks |

## 8. Merge readiness of PR #1402
- **Technically mergeable**: no conflicts with `main` (`3683c3e`), CI green on the previous head; the new head must also be green.
- **Not ready to rely on for migration**: the production inventory gate is open (U1–U6). Merging the code alone does **not** touch existing rows and needs no schema change, so merging is safe from a data standpoint — but any backfill remains blocked until §3 results are in.
- Recommendation: run §3, then decide merge; apply/backfill design only after that.

Branch `claude/store-host-flat-migration-diagnosis` · Base `3683c3e` (branch merge-base `0c90419`) · Head SHA recorded in the PR / hand-off message.

## 9. Approval points
1. Run §3 (or `storefront:flat-host-plan --json`) on production, read-only, and return the output.
2. Approve merge of #1402 (code only; no data change).
3. Approve a backfill design (insert-only, honours `apply_as`, never touches legacy rows) — separate approval.
4. Legacy-link infra choice before any DNS/Railway change.
5. Deploy approval.
