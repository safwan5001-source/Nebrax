# Storefront Flat-Host Migration — Phase 1 Diagnosis

**Date:** 2026-10-13 · **Status:** DIAGNOSIS ONLY — no code, DNS, Railway, or data changes made.
**Repo:** `safwan5001-source/Nebrax` · **Base:** `main` @ `073e102ac9334a4f80f368a64d1a3762bb701350`
**Branch:** `claude/store-host-flat-migration-diagnosis` · **Head SHA / PR:** see PR (docs-only commit)

> **Gate result: STOP before Phase 2.** A global flat store slug is **not safe** under the
> current schema (store slugs are unique per tenant only). A deterministic naming scheme needs
> Safwan's decision (§5).

---

## 1. Root cause of the Safari error

| Claim | Status | Evidence |
|---|---|---|
| Nested host `zhor-tyb.dominah.store.awjdev.xyz` fails TLS name check | **CONFIRMED** | `openssl s_client`/`curl -v` to the host: handshake completes, server presents `CN=*.store.awjdev.xyz` (Let's Encrypt YE2). A single-label wildcard does not match two labels → browser "privacy error". |
| DNS reaches Railway for nested host | **CONFIRMED** | Resolves to `69.46.46.52` (CNAME `*.store` → Railway matches any depth). DNS is *not* the problem; the certificate is. |
| Flat host `zhor-tyb.store.awjdev.xyz` is valid over HTTPS | **CONFIRMED** | Same cert, SAN matches; expires 2026-12-13; HTTP/2 307 → `/sa/ar` → 200. |
| Railway `storefront` service binds only `*.store.awjdev.xyz` (:8080) | **CONFIRMED** (Railway MCP, read-only `list-domains`) | Custom domain `*.store.awjdev.xyz`; no nested wildcard (`*.*.store…`) exists, and Let's Encrypt/Railway wildcard certs cannot cover two labels anyway. |
| `h.dominah.store…` also fails | Same mechanism (unverified separately) | Same two-label shape. |

**Therefore the nested hostnames cannot be fixed at the app layer.** The browser aborts before any HTTP request, so no redirect code can ever run for old HTTPS links.

**Side observation (UNCONFIRMED significance):** an obviously non-existent host
(`zzz-nonexistent-probe.store.awjdev.xyz`) also returns 307 → 200 with `<title>Spree Store</title>`,
identical to a real one. The repo's resolver (`ResolveStorefrontDomain`) 404s unknown hosts at the API
layer; the Next.js shell evidently renders before/independently of that. Needs a manual look at what the
storefront does on API 404 — not a tenant-leak finding (no tenant data seen), but "unknown host = 200 page" is
worth fixing separately.

## 2. How hostnames are produced and resolved today

**Production (all in `app/`):**
- `App\Support\ManagedStorefrontHostname` is the only builder.
  - `forSlug($tenantSlug)` → `{tenant-slug}.{base}` (first store, via `StorefrontProvisioningService`).
  - `forAdditionalStoreSlug($storeSlug,$tenantSlug)` → **`{store-slug}.{tenant-slug}.{base}`** (additional stores, via `CreateStorefrontForCurrentTenant`). This is the nested form that breaks TLS.
- `preview_url` (what "Open Store" shows) is built server-side as `'https://'.$hostname.'/'` from a verified, active `storefront_domains` row — `CommerceWorkspaceStorefrontsService::authorizedPreviewUrl()` (primary first) and the two provisioning services. Host headers are **not** used. Good.
- Base domain: `config/storefront.php` → env `AWJ_STOREFRONT_BASE_DOMAIN` (set on Railway `nibras-api`; value redacted by tooling, assumed `store.awjdev.xyz`).
- Web consumers: `web/src/app/(commerce)/commerce/stores/page.tsx` (`store.previewUrl`) and the store editor; they render the API value only.

**Resolution (`ResolveStorefrontDomain`):** *no label parsing at all.* The normalized `Host` is looked up as an
exact match in `storefront_domains.hostname` (**globally unique**), then tenant is taken from the row, then storefront/channel
are re-verified under that tenant. Fails closed (404). `X-Storefront-Forwarded-Host` is honoured only with a
`hash_equals`-matched gateway secret. Custom domains inside the managed namespace are rejected
(`ManagedNamespaceHostnameException`). IDN/punycode is explicitly unsupported by `HostnameNormalizer` (ASCII only).

**Which label is which:** in `zhor-tyb.dominah.store…`, `zhor-tyb` = additional store slug, `dominah` = tenant slug
(`tenants.slug`, globally unique). Nothing in resolution depends on this; it exists only at generation time.

## 3. Uniqueness / collision assessment

| Identifier | Uniqueness | Source |
|---|---|---|
| `tenants.slug` | global | migration `…000001_create_tenants_and_users` |
| `storefronts.slug` | **per tenant only** `unique(tenant_id, slug)` | `2026_09_20_010000_create_storefronts_table` |
| `storefront_domains.hostname` | global | `…020000_create_storefront_domains_table` |

Consequences for a flat `{store-slug}.store.awjdev.xyz`:
1. **Two tenants may legitimately have the same store slug** (`store`, `shop`, `gifts`, auto-derived from names via `CatalogSlug::derive` — `gifts`, `gifts-2` are only de-duplicated *within* a tenant). Flat slug would collide → cannot be introduced as-is.
2. A store slug can equal **another tenant's slug**, which already owns `{tenant-slug}.store…` for its first store.
3. Hostname uniqueness is only enforced at insert time; the existing nested `StorefrontHostnameConflictException` check would convert collisions into hard errors on store creation.

**Real counts of existing duplicate slugs / nested hosts / custom domains: UNKNOWN** — no production DB access. See §6.

## 4. Existing / legacy links & custom domains

- Custom domains: `type=custom`, outside the managed namespace, rejected inside it → **a flat scheme cannot collide with them**, and precedence is by exact hostname row (unchanged).
- Already-issued nested URLs (`preview_url` values shown to users, anything copied/shared) will remain unreachable over HTTPS regardless of code. **No app-layer 301/308 is possible** for them, and none must be claimed.
- Counts of nested rows, custom domains, and external references: unknown (§6).

## 5. Decision needed — proposed deterministic schemes

| Option | Host | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | `{tenant-slug}-{store-slug}.store.awjdev.xyz` for additional stores; first store stays `{tenant-slug}.store…` | Globally unique by construction when composed with a reserved delimiter policy; single-label → valid under existing wildcard cert; zero DNS/cert change; pure function of existing data | Longer; needs a collision guard (`a-b` + `c` vs `a` + `b-c`) → solved by checking the generated host against `storefront_domains` at creation and failing/suffixing deterministically; existing rows migrated by a reviewed one-off mapping |
| B | `{store-slug}.store…` flat, with global uniqueness | Shortest, matches example | Needs new global uniqueness (schema change + backfill + renames for existing duplicates) |
| C | `{short-id}.store…` (stable random id, e.g. 8-char from store UUID) | Collision-resistant, rename-proof | Not human-readable |
| D | Keep nested + buy/route `*.*.store` | — | **Not feasible**: Let's Encrypt / Railway wildcard cannot cover two labels; multiple per-tenant certs = per-tenant Railway domains |

The example `zhor-tyb.store.awjdev.xyz` is Option B; **I cannot recommend B until duplicate-slug counts are known.**
Under A the example would become `dominah-zhor-tyb.store.awjdev.xyz`.

Legacy-link plan (staged, needs approval): (1) new links use the chosen scheme; (2) keep old rows active for API compatibility;
(3) old *HTTPS* nested links stay broken — only fixable by infrastructure (per-tenant Railway domain + cert, or a dedicated edge for `*.*.store`) which I'm not proposing;
(4) after verified TLS+DNS for a legacy host, a 308 can map old→new by exact stored row (never by label parsing).

## 6. What must be checked manually (no credentials / read-only access here)

1. Production DB (read-only): `SELECT slug, count(*) FROM storefronts WHERE deleted_at IS NULL GROUP BY slug HAVING count(*)>1;`
2. `SELECT count(*), type FROM storefront_domains GROUP BY type;` and count of hostnames with ≥2 dots before `.store.awjdev.xyz`.
3. Whether any generated `{a}-{b}` would collide with an existing tenant slug / hostname (dry-run mapping).
4. Actual value of `AWJ_STOREFRONT_BASE_DOMAIN` on `nibras-api` (redacted in tooling).
5. What the `storefront` service does for an unknown host (the "Spree Store" 200 observation, §1).
6. Browser-level confirmation of the Safari error text (screenshot is consistent with cert mismatch; not independently reproduced on iOS).
7. Outbound emails/notifications/social-share/SEO canonicals: none found in `app/` or `web/src` building store URLs other than `preview_url`; external copies unknowable.

## 7. Phase 2 outline (not started; contingent on §5 decision)

- Extend `ManagedStorefrontHostname` (single builder) with the chosen form; reject any host not exactly one label under base; stop emitting 2-label hosts.
- Resolution stays exact-row lookup; add new rows, never rewrite hostnames silently; reviewed backfill via command with `--dry-run`, no schema change under A.
- Tests: builder (valid/invalid/malicious hosts, collision), two tenants with identical store slugs, cross-tenant denial, no default fallback, forwarded-host spoofing, open-redirect.
- Rollback: old rows untouched; revert builder to nested form; remove new rows by listed IDs.

## 8. Tests / CI

Nothing run — diagnosis only, no code changed.

## 9. Approval points

Before: choosing scheme (§5) → backfill/migration → merge → DNS/Railway change → production deploy. None have been done.
