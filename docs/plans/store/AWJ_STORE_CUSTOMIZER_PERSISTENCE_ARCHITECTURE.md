# STORE-CUSTOMIZER-ARCH-1 — Draft → Preview → Publish → Published Runtime

**Status:** Architecture lock. Docs only. Not implemented. Not merged. Not deployed.  
**Date:** 2026-09-19  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** `main` `ae50844b16dc473f781e2aafa3e47888803cecf2` (STORE-UI-6 merge, PR #871)  
**Authority for:** STORE-BACKEND-1  

This document is the implementation authority for persisting the AWJ Store Customizer lifecycle. It records **decisions**, not options. It does not create a migration, API, or UI change.

---

## 0. Evidence base (what was read, not assumed)

Narrow pass after STORE-UI-6. Unrelated AWJ (fuel, HR, accounting engine) was not re-audited.

| Source | What it established |
|---|---|
| `storefronts` migration + `Storefront` model | UUID PK, `tenant_id`, `sales_channel_id` (web only), `slug`, `name`, `is_active`, `default_locale`. **No** theme/logo/SEO/presentation columns. Soft deletes. `unique(tenant_id, slug)`. `CompanyWide`. |
| COM-7-P2 domain decision | Ownership is `Tenant → Storefront → (Web SalesChannel + StorefrontDomain[])`. Branding/theme **must not** live on `sales_channels` or on the storefronts core table. A tenant may own more than one storefront. |
| `SalesChannel` | Commercial origin (`web`/`mobile`/`pos`/`external`). Catalog publication, fulfillment, and pricing hang here. Two storefronts could later share a channel's listings without sharing a theme. |
| `StorefrontContext` + `ResolveStorefrontDomain` | Public authority is Host → verified active domain → active storefront → same-tenant web channel. Fail-closed 404. No client `tenant_id`. |
| Workspace APIs | Internal `/api/commerce/workspace/storefronts…`. Sanctum User + `EnsureUserPrincipal` + `SetTenant` + `EnsureActiveSubscription`. Writes: `commerce.manage`. Foreign `{id}` → **404, not 403**. No `GET …/storefronts/{id}` today (list + PUT identity). |
| `GET /store/v1/storefront` | Host-resolved `{ name, default_locale }` only. Anonymous. |
| STORE-UI-6 `StorefrontPresentationConfig` v1 | Canonical TS contract + `normalizePresentationConfig()` fail-closed to AWJ Modern. URL sanitizers. Draft is page-lifetime React state. Save/Publish inert. |
| Capabilities / design-first §5.16–§5.30 | DESIGN_ONLY / GATED / DEFERRED matrix. Version history **deferred**. Verification must not mint Verified. No preview token. No iframe of the live store. |
| Print templates | Closest draft/publish analog (`print_templates` + numbered immutable revisions). Rejected for V1 because version history is deferred and the customizer needs one current draft + one current published snapshot. |
| `tenants.settings` | ERP blob; previously held print designs and still holds `company.logo`. **Forbidden** as storefront presentation storage. |
| Laravel `Cache::` | Not used for domain resolution, catalog, or storefront identity. Live DB reads. |
| Next.js AWJ catalog fetch | `storefrontFetch` GET has **no** `cache: "no-store"` today (mutations do). Spree leftover `"use cache: remote"` is not the AWJ catalog. Host-keyed 60s locale Map is best-effort only. |
| Dual DB | CI matrix sqlite + pgsql. Partial unique indexes must work on both. True-race tests skip unless `pgsql` + `pcntl`. |
| Route allowlist | `CommerceModuleBoundaryTest::ALLOWED_COMMERCE_API_ROUTES` must be updated for any new workspace URI. |

**HEAD is STORE-UI-6.** Public homepage still calls `resolveHomeSections()` with no argument and CSS defaults `--store-primary: #12372a`. Existing stores stay on AWJ Modern until a Published row exists.

---

## 1. Ownership

### Decision

```text
Tenant
  └─ Storefront
       └─ StorefrontPresentation   (1:1, new)
```

Customization is owned by the **Storefront**, not by the Tenant as a blob, not by `SalesChannel`, not by Branch, and not by `tenants.settings`.

### Why this graph

- COM-7-P2 locked `Tenant → Storefront → (Web SalesChannel + Domains)` and forbade hanging branding/theme/SEO on `SalesChannel` or on the storefronts **core** table.
- The Customizer is already keyed by the workspace store selector (`selectedStoreId` = `storefronts.id`). Appearance uses that store's `name` as typographic fallback.
- Catalog publication maps storefront → `sales_channel_id`. That mapping is correct for listings and **wrong** for presentation: a future second storefront on the same web channel must be able to look different.
- `Storefront::booted()` already forbids binding a non-`web` or cross-tenant channel. Mobile carts may have a null `storefront_id`. Presentation therefore cannot hang on the channel.

### Isolation boundary

| Layer | Authority | Rule |
|---|---|---|
| Tenant | `SetTenant` → `TenantContext` from the Sanctum **User** (`user.tenant_id`) | Never from `{id}`, query, header, cookie, Host, or body. |
| Storefront | `Storefront::query()` under `TenantScope`, then explicit `$row->tenant_id === TenantContext::id()` | Missing or other-tenant `{id}` → **404** `'المتجر غير موجود.'` (IDOR: no existence leak). |
| Presentation | Same tenant + `storefront_id` of that row | Child of the storefront. `CompanyWide` (institution-level, not branch-scoped), matching `Storefront`. |
| Public runtime | `ResolveStorefrontDomain` only | Anonymous. Published snapshot only. Draft is unreachable. |

`self_service` remains **403** on every workspace method, matching the existing controller deny. `accountant` / `staff` do not receive `commerce.manage` (owner/admin via `*`).

Do **not** add `commerce.appearance`. Reuse `commerce.manage`.

---

## 2. Persistence model

### Decision: one current-head row per storefront

**Table:** `storefront_presentations`

This is current state, not an audit log. Version history / restore remains **DEFERRED**.

```text
storefront_presentations
- id                          uuid PK
- tenant_id                   foreignUuid → tenants  cascadeOnDelete
- storefront_id               foreignUuid → storefronts  cascadeOnDelete
- schema_version              unsignedSmallInteger  default 1
- draft_config                json                  NOT NULL
- draft_revision              unsignedInteger       default 0
- published_config            json                  NULL
- published_revision          unsignedInteger       NULL
- published_at                timestamp             NULL
- timestamps                  created_at, updated_at
```

**Constraints / indexes**

| Name | Definition | Why |
|---|---|---|
| PK | `id` UUID | AWJ `BaseModel` / `HasUuids` convention. No bigint. |
| Unique | `unique(storefront_id)` | Exactly one presentation row per storefront. |
| Unique | `unique(tenant_id, storefront_id)` | Isolation-shaped uniqueness, matching `storefronts (tenant_id, slug)`. Dual unique is cheap and documents the tenant boundary. |
| Index | `index(tenant_id)` | Tenant-scoped listing/debug. |
| FK | `tenant_id` cascade | Same as `storefronts` / `storefront_domains`. |
| FK | `storefront_id` cascade | Live binding, like domains — not historical like orders (`restrictOnDelete`). |

**No SoftDeletes.** The row is current configuration, not an audit trail. A soft-deleted storefront is hidden by `TenantScope`; its presentation row is unreachable. Hard-deleting a storefront cascades and frees the unique key.

**No `created_by`.** `storefronts` and `storefront_domains` do not carry it.

**No status enum.** Draft always exists on the row (JSON document). Published is present iff `published_config` is non-null.

### Column semantics

| Column | Meaning |
|---|---|
| `draft_config` | Normalized `StorefrontPresentationConfig` v1. Always a JSON object after first save. |
| `draft_revision` | Monotonic optimistic-concurrency token for the draft. `0` means “no saved draft yet” (GET virtual default). First successful PUT writes `1`. Each successful PUT increments by 1. |
| `published_config` | Last successfully published normalized snapshot. `NULL` = never published → public runtime uses AWJ Modern defaults. |
| `published_revision` | The `draft_revision` that was promoted. `NULL` if never published. Repeated publish of the same draft is a no-op when `draft_revision === published_revision`. |
| `schema_version` | Persistence schema integer, currently `1`, equal to `PRESENTATION_CONFIG_VERSION`. Also stored as `version` inside the JSON. Column exists so a future v2 migrator can query without decoding JSON. |
| `published_at` | When the last successful publish committed. Unchanged on draft save. Unchanged on idempotent re-publish. |

### Lazy create

- **GET** of a storefront with no row does **not** insert. It returns the in-memory default draft (`draft_revision: 0`, `published: null`).
- **PUT** inserts the row on first save (revision `1`) or updates it.
- **Publish** with no row or `draft_revision = 0` → **422**. Nothing to promote.

First-insert races: `unique(storefront_id)` is the final authority. Catch `QueryException` **outside** the transaction (PostgreSQL aborted-txn rule). Map `23505` / SQLite `19` to a retry-read of the winner, then apply the same revision check. Do not hold a tenant-row lock for this path; that lock is for provisioning, not presentation.

### Why not the alternatives

| Alternative | Rejected because |
|---|---|
| Columns on `storefronts` | COM-7-P2 §2 and the storefronts migration explicitly deferred branding/theme/SEO off this table. |
| JSON on `sales_channels` | Channel is commercial origin. Theme must not couple to listings/pricing/fulfillment. |
| `tenants.settings` | Already abandoned for print designs. ERP `company.logo` is not merchant storefront branding. Cross-store collision if a tenant has two storefronts. |
| Print-template revision tables (`draft` / `published` / `superseded` rows) | Version history is **DEFERRED**. Three tables + checksums + assignments overbuild V1. Atomic promote is an in-row copy under `lockForUpdate`. A later history table can snapshot `published_config` without changing this head row. |
| Two tables (`_drafts` + `_published`) | Extra join, extra race, same 1:1 facts. One row is the transaction boundary. |

---

## 3. Config contract

### Persisted JSON shape authority

**Starting contract:** STORE-UI-6 `StorefrontPresentationConfig` v1.

Canonical TypeScript: `storefront/src/lib/presentation/config.ts` (`PRESENTATION_CONFIG_VERSION = 1`). Web mirror: `web/src/modules/store-experience-builder/presentation/`. Laravel must port the same rules in PHP. **PHP is the persistence authority.** The client may pre-normalize; the server always re-normalizes and stores only its result.

The document is presentation-only. It must not contain products, categories, prices, inventory, listings, or other AWJ commerce truth. Nav/product/category `href` values are strings, not FK lookups, in V1. Featured/banner/offers sections have no product-id fields in v1 — do not invent them.

### Normalization boundary

Server-side equivalent of `normalizePresentationConfig()` **before** any write (draft save **and** publish):

- Missing / non-object input → `DEFAULT_PRESENTATION_CONFIG` (AWJ Modern `#12372a`, Cairo+Geist, comfortable, default radius).
- Unknown object keys **dropped** (fail closed).
- Unknown homepage section keys dropped; implemented keys omitted from a partial list keep default position at the end (`resolveHomeBuilderSections` / public `resolveHomeSections`).
- Unsupported tokens (theme, font, density, radius, product card, header style, WhatsApp placement, social network, page slug) → that field's default.
- Invalid hex → preset primary or `null` accent. Only `/^#([0-9a-fA-F]{6})$/`.
- IDs must match `/^[a-zA-Z0-9_-]{1,64}$/` else regenerated.
- Length caps: labels 80, hero 120/200, footer 200/120, contact 40/120/200/80, WhatsApp message 300, CR/license 40, nav ≤ 12, social ≤ 8, internal href 240.
- External URLs: `sanitizeExternalUrl` — **https only**. Reject `javascript:`, `data:`, `vbscript:`, `file:`, `http:`.
- Logos: `sanitizeLogoUrl` — `https://…` or raster `data:image/(png|jpeg|jpg|webp);base64,…`. **SVG rejected**.
- App URLs: App Store / Play host allow-lists after https sanitize; else `""`.
- `version` in JSON is overwritten to `PRESENTATION_CONFIG_VERSION` (currently 1). Client-supplied version is not authority.

**Golden fixtures:** one shared JSON fixture set asserted by both the PHP normalizer tests and the existing TS tests, so the twins cannot drift.

### Validation boundary

Two layers, both server-side:

1. **Envelope** (workspace PUT/publish): reject unknown **top-level request keys** (cart/checkout `rejectUnknown` pattern). Allowed PUT keys: `config`, `draft_revision`. Allowed publish keys: `draft_revision` (optional). Authority fields (`tenant_id`, `storefront_id`, `published_config`, `schema_version`, `is_verified`, …) are not accepted from the client.
2. **Config document:** normalize (fail closed) rather than 422 on every bad token — matching today's Customizer, which never blocks typing a bad colour; it snaps to safe. **422** is reserved for:
   - storefront missing → actually **404**
   - envelope unknown keys
   - payload not a JSON object
   - oversize (below)
   - stale `draft_revision` → **409**
   - publish with nothing to promote

### Size caps (locked)

| Cap | Limit | On exceed |
|---|---|---|
| Each `branding.*DataUrl` | 512 KiB | field stored as `null`; if the client sent **only** oversized logos and nothing else would change, still a successful normalize — but if the raw request body exceeds the document cap, **422** |
| Entire request body | 1.5 MiB | **422**, no write |
| Stored JSON (normalized, encoded) | 1.5 MiB | **422**, no write |

### Branding media (locked, not invented)

STORE-BACKEND-1 **persists** sanitized `logoDataUrl` / `compactLogoDataUrl` / `faviconDataUrl` inside the JSON so the current Customizer can round-trip without an upload API.

This is **not** a media library:

- No upload endpoint in STORE-BACKEND-1.
- Do not reuse ERP `company.logo` or `GET store/v1/media/{id}`.
- `BRANDING_PERSISTENCE_CAPABILITY` stays `design_only` until a tenant-scoped branding media object exists.
- A later media ticket may replace data URLs with stored object URLs without changing ownership or the draft/publish lifecycle.

### Schema version handling

- Persist `schema_version = 1` and JSON `version: 1`.
- Readers: if stored version `<` current, run the PHP normalizer (additive defaults). If stored version `>` current (forward row), fail closed to AWJ Modern for **that** snapshot and leave the row untouched. Do not attempt to guess v2.
- No v2 is defined here. Introducing v2 is a later architecture pass.

### Unknown-field / invalid-value / defaults

| Case | Behavior |
|---|---|
| Unknown JSON key | Drop |
| Invalid enum / colour / URL | Field-level default or `""` / `null` |
| Missing published row | Public runtime: current AWJ Modern behavior (see §7) |
| `requestedVerifiedLabel: true` | **Stored.** Renderers **ignore** it. Never copied into a verified-status column. |

---

## 4. Draft contract

Authenticated Commerce Workspace. Internal ERP prefix, **not** `/store/v1`, **not** `/api/v1`, **not** `/commerce/v1`.

Web client already prefixes `NEXT_PUBLIC_API_URL` (`…/api`), so paths below are Laravel routes as registered in `routes/api.php`.

### GET current Draft

```text
GET /api/commerce/workspace/storefronts/{id}/presentation
```

| | |
|---|---|
| Auth | `auth:sanctum` + `EnsureUserPrincipal` + `SetTenant` + `SetBranch` + `EnsureActiveSubscription` + `EnsurePermission:commerce.manage` |
| Extra deny | `self_service` → 403 (controller, existing pattern) |
| `{id}` | Storefront UUID. `whereUuid`. Malformed → 404 (no route match). |
| Tenant | `TenantContext` only. Foreign/missing → **404** `'المتجر غير موجود.'` |
| Side effect | None. No insert. |

**200 response**

```json
{
  "data": {
    "storefront_id": "<uuid>",
    "schema_version": 1,
    "draft": { "...StorefrontPresentationConfig..." },
    "draft_revision": 0,
    "published": null,
    "published_revision": null,
    "published_at": null
  }
}
```

- `draft` is always a normalized full document (virtual default when no row).
- `published` is the normalized published snapshot or `null`.
- No `tenant_id`. No `sales_channel_id`. No commerce catalog.

GET is `commerce.manage` (not the open store list) because **draft is secret**. Unpublished configuration must not leak to every workspace reader.

### PUT Save Draft

```text
PUT /api/commerce/workspace/storefronts/{id}/presentation
```

PATCH is **not** added. The Customizer always holds a full document; identity updates already use PUT. One write verb.

**Request**

```json
{
  "config": { "...StorefrontPresentationConfig or partial..." },
  "draft_revision": 0
}
```

| | |
|---|---|
| Auth | Same as GET |
| `config` | Required object. Server normalizes. |
| `draft_revision` | Required integer ≥ 0. Must equal the current stored revision (`0` if no row). Mismatch → **409**. |
| Envelope unknown keys | **422** |
| Oversize | **422** |
| Success | **200** with the same shape as GET, new `draft_revision` (`n+1`) |

**Saving Draft MUST NOT alter `published_config`, `published_revision`, or `published_at`.** Tests must prove the published JSON is byte-identical after a draft save.

Insert on first PUT (`draft_revision` client `0` → stored `1`). Subsequent PUTs update `draft_config` and increment `draft_revision` only.

### 404 / 403 / 401 / 409

| Situation | Status |
|---|---|
| Unauthenticated | 401 |
| ApiClient / customer token | 403 `EnsureUserPrincipal` |
| Missing `commerce.manage` | 403 |
| `self_service` | 403 |
| Inactive subscription | 403 |
| Hostname tenant ≠ user tenant | 403 `SetTenant` |
| Storefront missing or other tenant | **404** `'المتجر غير موجود.'` |
| Stale `draft_revision` | **409** |
| Envelope / oversize | 422 |

---

## 5. Preview contract

### Decision: **A — authenticated Commerce Workspace context**

No preview token. No unpublished-theme public route. No iframe of the live storefront.

### Why A, not B

Repository evidence:

- STORE-UI-6 designed preview as the **in-editor canvas** (`StorefrontPreviewCanvas`) inside `/commerce/appearance`. It already reuses `StoreBrand`, `--store-*`, `storeContainerClassName`, and homepage section keys.
- Design-first §5.28: *“Missing: preview token / unpublished-theme public route. The in-workspace canvas is the designed preview.”*
- STORE-UI-6 report: *“No unpublished-theme public route, no preview token. Iframe of the live storefront is not an unpublished-theme preview.”*
- Workspace `preview_url` is the **live** `https://{verified-hostname}/` for “View Store”, not a draft session. Do not overload it.
- The merchant is already a Sanctum User with `TenantContext`. The canvas reads `GET …/presentation` → `draft`. Public anonymous traffic never sees that route.
- A token would only be necessary to project an unpublished theme onto the **anonymous** Next.js storefront. That surface is not the designed preview, and inventing a token “because Shopify has one” is forbidden by the brief.

### Preview behavior (locked)

1. `/commerce/appearance` uses `CommerceStoreContext.selectedStoreId` as `{id}`.
2. On load: `GET …/presentation` → `initialConfig={data.draft}` + `draft_revision`.
3. While editing: page-lifetime React state, still normalized client-side for snappy UX. **Not** written to `localStorage` / `sessionStorage` / cookies.
4. Canvas renders `draft`. It must not fetch `GET /store/v1/storefront` for theme (that payload is published-only).
5. Switching stores reloads that storefront's draft. Unsaved dirty state is discarded (or confirmed); it is not written implicitly.
6. Public Host-resolved storefront never accepts `?preview=`, `X-Preview-Token`, or cookies as theme authority.

A later “view unpublished theme on the real storefront host” is a new capability. It is not STORE-BACKEND-1. If it is ever designed, it will need an explicit token with storefront+tenant bind, expiry, and revocation — **not** defined here.

Public anonymous users must never obtain Draft configuration. Cross-tenant preview is impossible because GET draft is TenantScoped and 404s foreign ids.

---

## 6. Publish contract

```text
POST /api/commerce/workspace/storefronts/{id}/presentation/publish
```

| | |
|---|---|
| Auth | Identical to draft GET/PUT (`commerce.manage`, etc.) |
| Body | `{ "draft_revision": <int> }` optional but **recommended**. If sent, must equal current `draft_revision` or **409**. If omitted, publish whatever draft is committed at lock time. |
| Envelope unknown keys | 422 |

### Transaction boundary

```text
DB::transaction
  → lock the storefronts row for this tenant (ownership freeze)
  → lock the storefront_presentations row (`lockForUpdate`) if it exists
  → re-check tenant_id
  → if no row or draft_revision = 0 → 422 (no partial write)
  → if client sent draft_revision and it ≠ current → 409
  → normalize draft_config again (never publish a previously stored blob without re-normalize)
  → if normalize/validate/size fails → throw; transaction aborts; published_* unchanged
  → if draft_revision === published_revision and published_config equals normalized draft
        → return 200 (idempotent; do not bump published_at)
  → else copy normalized draft → published_config
        published_revision = draft_revision
        published_at = now()
        schema_version = 1
  → commit
```

A failed Publish (exception, 422, 409, process kill before commit) **leaves the previous Published snapshot unchanged**. That is the whole point of copying inside one transaction instead of mutating in place on the public column during draft saves.

Lock order: storefront then presentation, always `orderBy id` if multiple presentation rows were ever involved (they will not be). Do not lock the tenant row; provisioning owns that pattern.

### Response **200**

Same shape as GET draft, with `published` now equal to the promoted snapshot and `published_revision === draft_revision`.

### Idempotency

Repeated POST of an already-published identical draft returns 200 and does not rewrite `published_at`. Concurrent publish + draft save: row lock serializes; the later writer sees the committed state. See §8.

---

## 7. Published runtime

### Decision

Public storefront obtains presentation **only** from Host-resolved `GET /store/v1/storefront`, extended **additively**.

```json
{
  "data": {
    "name": "المتجر الرئيسي",
    "default_locale": "ar",
    "presentation": null
  },
  "meta": { "request_id": "..." }
}
```

| `presentation` | Meaning |
|---|---|
| `null` | Never published. Client uses current AWJ Modern / `resolveHomeSections()` with no argument — **byte-compatible with today**. |
| object | Normalized published `StorefrontPresentationConfig`. Draft fields are **absent**. |

Do **not** add `GET /store/v1/presentation`. One Host-resolved identity document is enough. Existing `fetchStorefrontConfig()` reads `name` / `default_locale` and ignores unknown keys — additive `presentation` is backward compatible.

### Rules

- Public runtime reads **Published only**. The query selects `published_config` and never `draft_config`. Do not `SELECT *` in the public controller.
- No row, or `published_config IS NULL` → `presentation: null`.
- Soft-deleted / inactive storefront already fails resolver → 404, unchanged.
- `name` remains `storefronts.name`. `branding.displayName` is an override the client applies via existing `previewStoreName()` semantics: non-empty display name else live name. Do not overwrite `storefronts.name` on publish.
- Homepage: `resolveHomeSections(published.homepage.sections)` **only** when `presentation` is non-null. Gated keys (`banner`, `featured`, `offers`, `benefits`, `appPromo`, `customContent`) remain unimplemented; `resolveHomeSections` drops them. Persisting `visible: true` on a gated key does **not** make it LIVE.
- Theme tokens: apply `presentationCssVars` from published primary/radius when `presentation` is non-null; else keep `globals.css` AWJ Modern defaults.
- Header/footer/WhatsApp/social/contact: consume published fields when present. WhatsApp control stays unmounted when `enabled` is false or the number is unsanitary.
- Verification: public renderer **never** shows a Verified badge from `requestedVerifiedLabel` or CR/license/URL. Merchant-provided numbers may appear as footer text only, matching the preview canvas.
- Informational `pages[]`: metadata only. No CMS body. Public must not start rendering Spree `policies.get` HTML as if it were AWJ content. Pages stay **GATED**.
- Identity endpoint still exposes **no** `tenant_id`, channel id, or draft.

Existing stores with no presentation row keep today's homepage, header, and tokens. That is the backward-compatibility contract.

---

## 8. Concurrency

Simplest mechanism already in-repo: **integer revision + `lockForUpdate`**, matching Document Center `expectedVersion` and commerce unique-constraint races. No `If-Match` header (unused on commerce workspace APIs).

| Event | Behavior |
|---|---|
| Two Draft saves, same `draft_revision` | Row lock serializes. First commit wins (`n → n+1`). Second applies its revision check, sees mismatch, **409**. Client re-GETs. |
| Two Draft saves, second sends the new revision | Sequential last-write-wins. Intended. |
| Stale editor (`draft_revision` behind) | **409**. Do not merge JSON. |
| Publish while a Draft save is in flight | Same row lock. If save commits first, publish promotes the **new** draft (unless client sent an old `draft_revision` → 409). If publish commits first, save with the old revision → 409; save with the new (post-publish) revision updates draft only and does not touch published. |
| Repeated Publish of the same draft | Idempotent 200. `published_at` unchanged. |
| First insert race | Unique `(storefront_id)` + catch `QueryException` outside the transaction. Loser re-reads and follows the 409/retry path. |
| SQLite | Same unique + revision checks. True `lockForUpdate` race tests **skip** unless `pgsql` + `pcntl`, matching checkout/provisioning. |

Do not use `updated_at` as concurrency (clock skew, silent overwrite). Do not add a revision **history** table in V1.

---

## 9. Cache

### Current fact

- Laravel public catalog, domain resolution, and `GET /store/v1/storefront` are **uncached live DB reads**. No `Cache::remember` / tags.
- COM-7-P2 §10: *if no cache exists, document that fact rather than adding speculative caching.*
- Next.js AWJ catalog `storefrontFetch` GET currently passes no `cache: "no-store"` (mutations do). Leftover Spree `"use cache: remote"` paths are **not** this payload. Edge locale Map is Host-keyed, 60s, `default_locale` only.

### Decision

STORE-BACKEND-1 **does not introduce** a Laravel presentation cache.

On the Next.js side, `fetchStorefrontConfig()` / `storefrontFetch("storefront")` **must** use `cache: "no-store"` so a publish is visible on the next request. Do not add a generic product/list cache here.

If a future slice caches published presentation:

- Cache key **must** include `storefront_id` + `tenant_id` (and locale only if the payload becomes locale-specific — it is not, today).
- Invalidate **only** on successful Publish, scoped to that storefront.
- **Draft Save must not invalidate public runtime.**

No invalidation hook is required in V1 beyond `cache: "no-store"` on the identity fetch. Prove that with a test: publish then GET public sees the new snapshot without a process restart.

The 60s Host-keyed locale Map is unrelated to presentation and is left alone (it caches `default_locale`, not theme).

---

## 10. Security invariants

Locked:

| Invariant | Enforcement |
|---|---|
| Tenant isolation | `SetTenant` + `TenantScope` + explicit `tenant_id` re-check after lock. |
| Storefront ownership | `{id}` is a selector only. Foreign → 404. |
| Authorization | Sanctum User, `commerce.manage`, not self_service, active subscription. |
| IDOR | 404 not 403 for missing/foreign storefront. Same message. Tests: cross-tenant GET/PUT/publish. |
| Draft secrecy | Draft routes are workspace-only. Public SELECT never reads `draft_config`. No public `?preview=`. |
| Safe URL validation | PHP twin of `urls.ts`. https only. No `javascript:` / `data:` (except raster logo data URLs) / `vbscript:` / `file:` / `http:`. |
| XSS boundary | No HTML/CSS/JS fields. Tokens are closed enums + hex. `presentationCssVars` emits only validated hex. Do not `dangerouslySetInnerHTML` presentation strings. Leftover Spree `policy.body_html` is **not** this contract. |
| No arbitrary HTML/CSS/JS | Not a page builder. `customContent` stays a gated placeholder. |
| No cross-tenant preview | Preview is the workspace canvas under TenantScope. |
| No public Draft fallback | `presentation: null` → AWJ Modern defaults, never draft. |
| No client-authoritative persistence | Server re-normalizes. Envelope rejects tenant/store/published fields. `requestedVerifiedLabel` cannot mint verified. |
| No logo SVG | `sanitizeLogoUrl` rejects `data:image/svg`. |
| Gateway | Public identity remains Host + optional gateway secret. Workspace never calls `store/v1` as tenant authority. |

---

## 11. Capability boundary

Persistence does **not** flip every STORE-UI-6 capability to LIVE.

| Capability | After STORE-BACKEND-1 | Notes |
|---|---|---|
| Theme persistence | **LIVE** | Closed token set in JSON + public CSS vars from published. |
| Homepage composition | **LIVE** for implemented keys only (`hero`, `categories`, `newArrivals`, `wholesale`) | Gated keys persist as flags and stay unrendered. |
| Custom nav / footer / contact / WhatsApp / social / app links | **LIVE** as presentation fields | WhatsApp still does not send. App section absent without a valid URL. |
| Draft persistence | **LIVE** | Workspace GET/PUT. No `localStorage`. |
| Customizer preview | **LIVE** as in-workspace canvas fed by GET draft | Still not an iframe / token / unpublished public route. |
| Publish | **LIVE** | Authoritative promote. Save still does not publish. |
| Branding persistence | **DESIGN_ONLY** | Data URLs round-trip with caps. No media object. No ERP logo. |
| Business verification | **GATED** | CR/license/URL/`requestedVerifiedLabel` persist. **No Verified badge. No `is_verified` derived from merchant input.** |
| Informational pages | **GATED** | `pages[]` metadata only. No CMS. No Spree policies. |
| Version history / restore | **DEFERRED** | Editor “restore default” remains a client reset of the draft document, then PUT if the merchant saves. |

**Hard rule:** merchant-entered verification information MUST NOT create an authoritative Verified status. No column, no public flag, no renderer branch that treats `requestedVerifiedLabel` or a non-empty CR as verified.

---

## 12. Implementation map (STORE-BACKEND-1, not this PR)

Minimal slice that makes Draft persist, Publish promote, and public runtime read Published. No media API. No pages CMS. No history table. No preview token.

### Add

| File | Role |
|---|---|
| `database/migrations/2026_09_19_010000_create_storefront_presentations_table.php` | Schema in §2. Timestamp may shift; keep dual-engine indexes only. |
| `app/Models/StorefrontPresentation.php` | `BaseModel` + `CompanyWide`. Casts for json/bool/datetime. Fillable = columns in §2. `booted()`: storefront must belong to the same tenant (mirror `StorefrontDomain`). |
| `app/Services/Commerce/StorefrontPresentationService.php` | GET virtual default, PUT save, POST publish. TenantContext + lock + revision. |
| `app/Support/Commerce/StorefrontPresentationNormalizer.php` | PHP twin of `normalizePresentationConfig` + URL sanitizers. |
| `app/Http/Requests/SaveStorefrontPresentationRequest.php` | Envelope: `config` required array, `draft_revision` required integer min 0. `authorize(): true`. |
| `app/Http/Requests/PublishStorefrontPresentationRequest.php` | Optional `draft_revision`. |
| `app/Http/Controllers/Api/CommerceWorkspaceStorefrontPresentationController.php` | Thin: 404 mapping, 409 mapping, self_service deny. |
| `tests/Feature/StorefrontPresentationDraftApiTest.php` | Draft persist, draft ≠ published, auth, IDOR. |
| `tests/Feature/StorefrontPresentationPublishApiTest.php` | Atomic publish, failed publish preserves published, idempotent repeat, stale revision. |
| `tests/Feature/StorefrontPresentationPublicRuntimeTest.php` | Public published-only, default fallback, Host isolation. |
| `tests/Unit/StorefrontPresentationNormalizerTest.php` | Golden fixtures, unsafe URLs, verification flag stored not authorized. |
| `tests/Feature/StorefrontPresentationPostgresConcurrencyTest.php` | Skip unless pgsql+pcntl. Publish vs save lock. |
| `tests/Fixtures/presentation/v1-*.json` | Shared golden documents. |

### Modify

| File | Change |
|---|---|
| `routes/api.php` | GET/PUT presentation + POST publish next to existing storefront workspace routes, `commerce.manage`. |
| `tests/Feature/CommerceModuleBoundaryTest.php` | Allowlist the two new URIs (`…/presentation`, `…/presentation/publish`). |
| `app/Models/Storefront.php` | `hasOne(StorefrontPresentation::class)` only. **No new columns.** |
| `app/Http/Controllers/Api/StorefrontConfigController.php` | Additive `presentation` from `published_config` only. |
| `storefront/src/lib/commerce/storefront.ts` | Type + `cache: "no-store"` on this fetch. |
| `storefront/src/lib/commerce/config.ts` | `storefrontFetch` GET `cache: "no-store"` (or at least the storefront identity call). |
| `storefront/src/app/[country]/[locale]/(storefront)/page.tsx` | `resolveHomeSections(published?.homepage.sections)` when published. |
| `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx` | Apply published tokens / StoreBrand logo / header+footer presentation when published. |
| `web/src/app/(commerce)/commerce/appearance/page.tsx` | Pass `selectedStoreId` into the builder. |
| `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` | GET draft on mount; PUT on Save; POST publish on Publish; honour 409. |
| `web/src/modules/store-experience-builder/presentation/capabilities.ts` and `storefront/src/lib/presentation/capabilities.ts` | Flip only the capabilities listed LIVE in §11. Keep verification/pages/branding-media/history as they are. |
| `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` | Update §5.16–§5.29 states after the backend lands (not in this docs PR). |

### Explicitly out of STORE-BACKEND-1

- Branding media upload / storage / public media route
- Pages CMS
- Verified-business authority
- Version history / restore-from-history
- Preview token / unpublished public route / iframe
- Columns on `storefronts` or `sales_channels`
- `commerce.appearance` permission
- Laravel `Cache::` layer
- Product/category ID resolution inside nav hrefs
- Any accounting / inventory / order change

---

## 13. Test plan

Required **before** STORE-BACKEND-1 can be considered complete. Write the tests as the slice is built; this architecture PR does not add them.

| # | Case | Expect |
|---|---|---|
| 1 | Draft persists | PUT then GET returns normalized config; `draft_revision` increments |
| 2 | Draft ≠ Published | After save, public `presentation` still `null`; `published_config` unchanged |
| 3 | Published-only public runtime | After publish, `GET /store/v1/storefront` (Host) returns published object; `draft_config` not in SQL used by that controller |
| 4 | Default fallback | Store with no row: public payload `presentation: null`; homepage still default sections / AWJ Modern tokens |
| 5 | Successful atomic publish | Publish copies normalized draft → published; `published_revision = draft_revision`; `published_at` set |
| 6 | Failed publish preserves previous Published | Inject normalize/size failure (or exception after lock); previous `published_config` byte-identical |
| 7 | Authorization | Guest 401; staff without `commerce.manage` 403; self_service 403; owner 200 |
| 8 | Cross-tenant denial | Tenant B `{id}` on tenant A session → 404 GET/PUT/publish; no row created in B |
| 9 | Cross-store denial | Tenant A storefront 2 cannot be read/written with storefront 1's session tricks; `{id}` selects only that row |
| 10 | Public Draft denial | Anonymous `GET /store/v1/storefront` never contains draft-only fields (e.g. a unique draft hero string before publish) |
| 11 | Validation / envelope | Unknown top-level key 422; `tenant_id` in body ignored/rejected; does not change authority |
| 12 | Unsafe URLs | `javascript:`, `http://`, `data:text/html`, SVG data URL stored as empty/null; https kept |
| 13 | Stale / concurrent update | PUT with old `draft_revision` → 409; winner's JSON preserved |
| 14 | Repeated Publish | Second POST 200; `published_at` unchanged when draft unchanged |
| 15 | Cache | After publish, subsequent public GET (same process) sees published snapshot. No Laravel cache to bust. Next fetch uses `no-store`. |
| 16 | SQLite | Feature tests green under CI sqlite |
| 17 | PostgreSQL | Same tests green under CI pgsql; lock race test runs only here |
| 18 | Existing storefront regression | `StorefrontPublicIdentityTest`, catalog, cart, checkout, workspace identity/domains still pass. `name` / `default_locale` unchanged by draft save. |
| 19 | Verification | `requestedVerifiedLabel: true` + CR number persist; public and preview renderer still have no Verified / موثّق badge from that input |
| 20 | Capability honesty | Architecture tests updated so LIVE capabilities match §11; Save/Publish may report success **only** after real 200 |

---

## 14. Open questions

**None that block database or API compatibility for STORE-BACKEND-1.**

Every lifecycle, ownership, schema, route, concurrency, cache, and security decision above is locked from repository evidence.

Non-blocking follow-ups (do **not** hold STORE-BACKEND-1):

- Tenant-scoped branding media object (replaces data URLs).
- AWJ-or-external verified-business authority (separate from merchant CR text).
- Informational pages CMS.
- Version history / restore.
- Optional later “view unpublished theme on the real host” (would require a new architecture pass and a token — **not** implied by this document).

---

## 15. Recommended STORE-BACKEND-1 scope (summary)

1. `storefront_presentations` 1:1 head row (draft JSON + published JSON + integer revisions).
2. Workspace `GET/PUT …/presentation` and `POST …/presentation/publish` under existing Sanctum + `commerce.manage` + 404-not-403.
3. PHP normalizer twin of STORE-UI-6, with size caps and URL safety.
4. Additive `presentation` on `GET /store/v1/storefront` (null → AWJ Modern).
5. Wire `/commerce/appearance` Save/Publish to those APIs using `selectedStoreId`.
6. Public storefront consumes **published** tokens/sections only.
7. Flip only the capabilities listed LIVE in §11.
8. Tests in §13 on SQLite and PostgreSQL.

**Stop conditions for implementers:** do not put theme on `storefronts` or `sales_channels`; do not mint Verified; do not add a preview token; do not cache without a storefront-scoped key; do not invent a pages CMS or media upload in this slice.
