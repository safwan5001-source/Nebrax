# Storefront Host — Option A Implementation Report

**Date:** 2026-10-13 · **Status:** IMPLEMENTED ON PR — **NOT MERGED — NOT DEPLOYED — NO DNS/RAILWAY/DATA CHANGES**
**Decision (approved by Safwan):** first store `{tenant-slug}.store.awjdev.xyz`; additional stores `{tenant-slug}-{store-slug}.store.awjdev.xyz`.
**Builds on:** `STOREFRONT-FLAT-HOST-MIGRATION-PHASE1-DIAGNOSIS.md` (PR #1397).
**Branch:** `claude/store-host-flat-migration-diagnosis` (same PR #1397) · **Base SHA (main at Phase 1):** `073e102ac9334a4f80f368a64d1a3762bb701350`
**Head SHA / PR:** see PR #1397 (final SHA in the PR and in the hand-off message).

> **No schema change was needed.** Global uniqueness already exists (`storefront_domains.hostname` UNIQUE, `tenants.slug` UNIQUE);
> the new guarantees are enforced in code on top of them.

---

## 1. Read-only conflict check

### 1.1 Production data — NOT AVAILABLE here
Railway MCP gives service/domain/variable metadata only; there is no DB query tool and `nibras-db` credentials are not exposed to this session.
**Therefore no claim is made that production has zero conflicts.** The administrator must run the queries in §1.2 (all `SELECT`) and
`php artisan storefront:flat-host-plan` (read-only, §3.3) against production, and send the output before any backfill is designed.

### 1.2 Queries for the administrator (PostgreSQL, read-only)
Replace `store.awjdev.xyz` if `AWJ_STOREFRONT_BASE_DOMAIN` differs. Run in a read-only session (`BEGIN READ ONLY;` … `ROLLBACK;`).

```sql
-- Q1 inventory of managed hosts by shape
SELECT d.hostname, d.is_active, d.verification_status, t.slug AS tenant_slug, s.slug AS store_slug,
       CASE WHEN d.hostname = t.slug||'.store.awjdev.xyz' THEN 'first'
            WHEN d.hostname = s.slug||'.'||t.slug||'.store.awjdev.xyz' THEN 'legacy_nested'
            ELSE 'unrecognized' END AS shape
FROM storefront_domains d
JOIN tenants t ON t.id = d.tenant_id
JOIN storefronts s ON s.id = d.storefront_id
WHERE d.type = 'awj_subdomain'
ORDER BY shape, d.hostname;

-- Common CTE for Q2–Q6
WITH legacy AS (
  SELECT d.id, d.hostname, t.slug AS ts, s.slug AS ss, t.slug||'-'||s.slug AS label
  FROM storefront_domains d
  JOIN tenants t ON t.id = d.tenant_id
  JOIN storefronts s ON s.id = d.storefront_id
  WHERE d.type = 'awj_subdomain'
    AND d.hostname = s.slug||'.'||t.slug||'.store.awjdev.xyz')

-- Q2 two legacy rows mapping to the same target (dash-concatenation ambiguity)
SELECT label, count(*), array_agg(hostname) FROM legacy GROUP BY label HAVING count(*) > 1;

-- Q3 target equals some tenant's slug (reserved for that tenant's first store)
SELECT l.hostname, l.label, x.id AS colliding_tenant FROM legacy l JOIN tenants x ON x.slug = l.label;

-- Q4 target already exists as a domain row
SELECT l.hostname, e.hostname AS existing FROM legacy l
JOIN storefront_domains e ON e.hostname = l.label||'.store.awjdev.xyz';

-- Q5 target label longer than 63 chars (invalid DNS label)
SELECT hostname, label, length(label) FROM legacy WHERE length(label) > 63;

-- Q6 total counts
SELECT count(*) AS legacy_nested FROM legacy;
```

```sql
-- Q7 tenant/store slugs that cannot form a valid host label (underscore, uppercase, etc.)
SELECT 'tenant' AS kind, slug FROM tenants WHERE slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
UNION ALL
SELECT 'store', slug FROM storefronts WHERE slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$';

-- Q8 custom domains and any custom row inside the managed namespace
SELECT type, count(*) FROM storefront_domains GROUP BY type;
SELECT hostname, tenant_id FROM storefront_domains WHERE type = 'custom' AND hostname LIKE '%.awjdev.xyz';

-- Q9 soft-deleted tenants/storefronts that still reserve a slug
SELECT 'tenant', slug FROM tenants WHERE deleted_at IS NOT NULL
UNION ALL SELECT 'storefront', slug FROM storefronts WHERE deleted_at IS NOT NULL;
```

### 1.3 What the code-level analysis proves (independent of production data)
| Scenario | Outcome under Option A |
|---|---|
| Two tenants, same store slug (`gifts`) | distinct hosts `alpha-gifts…` / `beta-gifts…` — tested |
| `a` + `b-c` vs `a-b` + `c` (both → `a-b-c`) | first creator keeps `a-b-c`; second is deterministically suffixed (`c-2` → `a-b-c-2`) — tested |
| Additional-store label equals another tenant's slug (even before that tenant has a store) | reserved by `ManagedHostnameAvailability` → suffixed — tested; that tenant later gets its own `{slug}.store…` — tested |
| New tenant registers a slug equal to an existing additional-store label | rejected at validation (422) for `awj_subdomain` rows — tested; non-managed (`custom`) rows keep the old registration contract |
| Race between two creators | DB `UNIQUE(hostname)` is the last line; loser fails closed (existing `StorefrontHostnameConflictException` / `QueryException`) |
| Tenant+store label > 63 chars, or slug with `_`/`.` | builder throws `StorefrontBaseDomainMisconfiguredException` (fail closed) — **residual: such a store cannot be created until the slug is shortened** |

## 2. Unknown host: why `307 → 200` (item 7)

Evidence (read-only, own probes, no auth, no PII):
- `GET https://zzz-nonexistent-probe.store.awjdev.xyz/` → `307 /sa/ar` → `200`, `<title>Spree Store</title>`; the real-looking `zhor-tyb.store…` returns the **same** shell.
  Bodies differ only by ~450 bytes (nonces/ids); the visible text is identical generic placeholders ("Spree Store", "المتجر", "لا توجد منتجات").
- The `307` comes from `storefront/src/proxy.ts` (`createSpreeMiddleware`): it redirects any path to `/{country}/{locale}` using static defaults,
  **before and independent of host resolution** (the only host-aware step there is a best-effort default-locale lookup that falls back to `null`).
- Laravel side (tested): unknown/legacy/lookalike hosts get **404 from `store/v1/*`** — no tenant context is set and nothing is returned.

Conclusion: **CONFIRMED** no tenant/store data is rendered for an unknown host in the probed pages (generic empty template only).
**NOT PROVEN:** the exact Next.js fallback component path when the backend 404s (I did not trace every page's error handling), and I did not
crawl other routes (`/products`, `/cart`, sitemap) on an unknown host. Recommended (not implemented — outside this PR's scope, touches the
Spree-derived storefront): make the storefront return a real 404 page when `GET store/v1/storefront` is 404 for the host, and add `noindex` for unresolved hosts.

## 3. Implementation

### 3.1 Changed behaviour
- `ManagedStorefrontHostname::forAdditionalStoreSlug()` → `{tenant}-{store}.{base}`; result must be exactly one label under the base (fail closed on dots, `/`, `@`, `_`, IDN/unicode, >63 chars). New `labelOf()`. It reads nothing from the request — links never derive from `Host`/`X-Forwarded-*`.
- New `ManagedHostnameAvailability` (read-only): host is taken if a `storefront_domains` row exists (any tenant) **or** its label equals any tenant slug (incl. soft-deleted).
- `CreateStorefrontForCurrentTenant`: store-slug derivation now also skips candidates whose composed host is taken → deterministic `-2`, `-3` suffix. Store slug uniqueness per tenant is unchanged.
- `RegisterRequest`: slug rejected when it equals the label of an existing managed (`awj_subdomain`) host.
- `ResolveStorefrontDomain` (**matching logic unchanged — exact row lookup, no tenant fallback**): added one fail-closed pre-check rejecting an incoming/forwarded host value containing `/ ? # @ \ whitespace ://` (previously `beta.x/../y` was silently trimmed to `beta.x`; found by the new tests). Gateway-secret trust model unchanged.
- Preview URL (`authorizedPreviewUrl`) untouched: it still emits only stored, verified, active rows.

### 3.2 Existing hosts / custom domains
Nothing is rewritten. Existing nested rows stay in `storefront_domains` and keep resolving at the API (if reached). Custom domains are untouched and keep precedence (exact row; managed namespace is closed to them).

### 3.3 Dry-run backfill (no apply path exists)
`php artisan storefront:flat-host-plan [--json]` → `FlatHostMigrationPlanner` (SELECT only). Classifies `first | legacy_nested | unrecognized`, computes targets, flags
`target_taken_by_domain | target_is_tenant_slug | duplicate_target | invalid_target`; exit code 1 on any conflict. The command has **no** `--apply` option (asserted by a test),
and a test proves the `storefront_domains` table is byte-identical before/after.
An actual backfill (insert new `awj_subdomain` rows alongside the old, keep old rows) requires your separate approval after the production output is reviewed; it still would not need a schema change.

## 4. Legacy links strategy (item 8)

| Case | Status |
|---|---|
| Old nested HTTPS link `https://{store}.{tenant}.store.awjdev.xyz` | **Remains broken in browsers.** Cert is `*.store.awjdev.xyz` (single label) → TLS name mismatch before any HTTP. **No application redirect can fix this and none is claimed.** |
| App-layer 301/308 old→new | **Not implemented, deliberately.** Code would never execute for HTTPS visitors. Only meaningful after infra provides a valid cert for the old names. |
| Infra options (need your approval, none done) | (a) per-tenant Railway custom domains for each legacy host (cert per host; cost/ops scale with count); (b) a dedicated edge/redirector with a cert covering the old names (e.g. `*.*.store` is not issuable as one wildcard — would need per-host certs); (c) accept breakage and re-share new links. Recommended: (c) for rarely shared links, (a) only for hosts the Q1 inventory shows are in real use. |
| Plain `http://` | not relied on; HSTS/redirect behavior unverified |
| After (a)/(b) exist | add a 308 keyed by the exact stored legacy row → its new row (identity-preserving, never by parsing labels), only after verifying TLS+DNS per host |

Known non-working cases: every existing nested HTTPS URL; any external copy of them (emails/social/QR) — counts unknown.

## 5. Tests and results

Environment: Laravel project built from the repo by `setup.sh` (`/home/user/nibras-app`), SQLite.

| Command | Result |
|---|---|
| `php artisan test --filter='FlatStorefrontHostTest\|StorefrontProvisioning\|MultiStore\|ManagedStorefront\|StorefrontDomain\|StorefrontGateway'` | **149 passed, 1 skipped, 0 failed** (486 assertions) |
| Full `php artisan test` | **6433 passed, 73 skipped, 154 failed** (47,201 assertions). All 154 failures are in 32 unrelated classes (StorefrontMedia*, ProductMediaR2*, Fuel*, AuthRecovery, UserInvitation, AttachmentDurability, DocumentStorageDiagnose, R2*, Resend…: image/R2/mail environment). Re-running exactly those classes on untouched `main` (my changes stashed, project rebuilt) gives the **same 154 failed / 373 passed** → pre-existing in this sandbox, none touch hosts/tenancy. CLAUDE.md asks for an all-green suite; that cannot be shown here — CI must be the judge |
| Baseline (all failing classes, `main` without my changes) | 154 failed / 373 passed = identical to with-change run |
| PostgreSQL CI | not run locally (SQLite only); CI will run it on the PR |
| `web/` build / storefront build | not run — no `web/` or `storefront/` files changed |
| GitHub CI on the PR | previous head (docs-only, `2ae3a44`): sqlite + pgsql + CI Gate green. Code head: running when this report was written — see the PR checks (CI is the authority for the full suite and PostgreSQL) |

New tests (`tests/Feature/FlatStorefrontHostTest.php`, 41 cases incl. data-provider rows) cover: builder format; nested form never generated; invalid/malicious parts (dot, slash, `@`, `_`, IDN lookalike, >63, empty);
case normalisation; header-independence of link generation; global uniqueness (two tenants, same store slug); dash-concatenation ambiguity; tenant-slug reservation; registration collision; DB-level duplicate;
tenant isolation (each host → only its tenant, no cross-tenant payload); 404 for legacy-nested/lookalike/prefix/suffix/unknown/base hosts; case + trailing dot; forged `X-Storefront-Forwarded-Host`
(wrong/absent secret, `X-Forwarded-Host`, `X-Original-Host`, `Forwarded`, `X-Forwarded-Proto`) cannot switch tenant; signed forwarded host exact-match, malformed forwarded values fail closed;
inactive/unverified fails closed; no context leakage across consecutive requests (no default-tenant fallback); planner read-only + conflict detection; command has no apply option.
Updated expectations in `MultiStoreCreationTest` / `MultiStoreCreationApiTest` to the new format.

## 6. Security review
- Link construction: only from stored rows / `tenants.slug` + `storefronts.slug`; request headers never enter it (tested).
- Resolution: exact `hostname` row → tenant from the row → storefront/channel re-verified under that tenant; no label parsing, no fuzzy/first-match, no default tenant (unchanged; regression-tested).
- Forwarded host: honored only with constant-time-matched gateway secret (unchanged); now also rejects structurally invalid values.
- Open redirect: no redirect code added.
- Unicode/IDNA: still ASCII-only; lookalikes rejected (tested).
- Takeover: managed namespace closed to custom domains (unchanged); `storefront_domains` has no soft-delete (a removed row frees its hostname immediately; storefront deletion semantics were not traced), so a freed label can be re-issued — **residual (unverified path):** an old link could then point to a different tenant's store with the same composed label. Mitigation if needed: reserve retired labels (requires a table → separate proposal).
- Cache: storefront-side locale cache is keyed by full Host (bounded, 60 s); with single-label hosts, distinct tenants have distinct keys. No Laravel-side response cache keyed by host was found.
- Information disclosure: registration-time slug check reveals that a managed host label exists (generic message "غير متاح"); equivalent to the existing `unique:tenants,slug` disclosure.

## 7. Rollout / rollback
1. Merge (after your approval) → new additional stores get the new format immediately; existing rows unchanged.
2. Run `storefront:flat-host-plan` on production; review conflicts; decide on backfill (separate approval).
3. Rollback: revert the PR — the only persistent effect is rows created in the new format (valid, active, and harmless; they can be listed by `hostname` shape and removed by ID if desired). No schema to roll back.

## 8. Residual risks / open items
- Production conflict inventory not done (no access) — blocks backfill.
- Existing nested links stay broken over HTTPS (infra decision pending).
- Long tenant+store slugs (>63 combined) and `_` slugs cannot get a store host.
- Slug-label reuse after store deletion (see §6).
- Storefront unknown-host UX (generic 200 page) not fixed; separate small PR recommended.
- Safari/iOS behaviour not independently reproduced.

## 9. Next step and approval points
1. Admin runs §1.2 queries + `storefront:flat-host-plan` on production (read-only) and returns the output.
2. Approve merge of this PR (backend-only, no schema change) — separate approval.
3. Decide legacy-link infra option (§4) — approval before any DNS/Railway change.
4. Separate approval for any backfill that writes `storefront_domains` rows.
5. Separate approval for production deploy.
