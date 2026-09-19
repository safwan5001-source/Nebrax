# STORE-BACKEND-1 — Customizer persistence and publish lifecycle — Implementation Report

## Status

**COMPLETE for this slice. PR opened. Not merged. Not deployed.**

Authority: [`docs/plans/store/AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`](./AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md) (PR [#874](https://github.com/safwan5001-source/Nebrax/pull/874), SHA `6898384969facbf16990feb82d741ce62217eba7`).

This slice is **only** Draft → Preview → Publish → Published Runtime for `StorefrontPresentation`. STORE-UI-6 chrome was not redesigned.

---

## 1. Architecture authority used

| | |
|---|---|
| Document | `docs/plans/store/AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md` |
| Architecture PR | [#874](https://github.com/safwan5001-source/Nebrax/pull/874) |
| Architecture merge SHA | `6898384969facbf16990feb82d741ce62217eba7` |
| Design-first policy | `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` §5.16–§5.30 updated to match architecture §11 |
| STORE-UI-6 | Already merged and visually approved (PR #871). This PR wires it; it does not restyle it. |

No ownership, schema, route, preview, publish, concurrency, cache, or capability decision was reinterpreted.

---

## 2. Repository evidence checked

Narrow pass after architecture lock. Unrelated AWJ (fuel, HR, accounting engine) was not re-audited.

| Source | Finding vs architecture |
|---|---|
| `storefronts` migration + `Storefront` | UUID, `tenant_id`, `sales_channel_id`, `slug`, `name`, `is_active`, `default_locale`. **No** presentation columns. Unchanged in this PR except `hasOne(StorefrontPresentation)`. |
| Latest `main` `52aa207` STORE-ADMIN-LIFECYCLE-1 (#873) | Merchant activate/deactivate of `Storefront.is_active` only. Compatible: architecture already treats inactive storefronts as resolver 404. **Not a contradiction.** Branch was rebased onto this SHA. |
| Workspace APIs | Sanctum User + `EnsureUserPrincipal` + `SetTenant` + `EnsureActiveSubscription` + `commerce.manage`. Foreign `{id}` → 404 `'المتجر غير موجود.'`. `self_service` 403. Reused. |
| `GET /store/v1/storefront` | Host-resolved `{ name, default_locale }`. Extended **additively** with `presentation`. |
| STORE-UI-6 `StorefrontPresentationConfig` v1 | PHP twin of `normalizePresentationConfig()`. Client may pre-normalize; server always re-normalizes. |
| Dual DB | sqlite + pgsql. Unique indexes are full (not partial). Concurrency test skips unless pgsql+pcntl. |
| Laravel `Cache::` | Still unused for presentation. None added. |
| Route allowlist | `CommerceModuleBoundaryTest` updated with the two new URIs. Activate/deactivate from LIFECYCLE-1 kept. |
| CI copy-list | `app/Support/Commerce` is a new directory; added to `ci.yml` ALLOWED + mkdir/cp, `setup.sh`, `deploy/assemble.sh`. `tests/Fixtures/presentation` copied. |

**Stop-condition check:** repository evidence does **not** contradict the approved architecture. Implementation continued.

---

## 3. Exact migration / schema implemented

Table: `storefront_presentations`

```text
id                    uuid PK
tenant_id             foreignUuid → tenants  cascadeOnDelete
storefront_id         foreignUuid → storefronts  cascadeOnDelete
schema_version        unsignedSmallInteger  default 1
draft_config          json                  NOT NULL
draft_revision        unsignedInteger       default 0
published_config      json                  NULL
published_revision    unsignedInteger       NULL
published_at          timestamp             NULL
timestamps            created_at, updated_at
```

Constraints: `unique(storefront_id)`, `unique(tenant_id, storefront_id)`, `index(tenant_id)`.

No SoftDeletes. No `created_by`. No status enum. No columns on `storefronts`, `sales_channels`, or `tenants.settings`.

**Timestamp shift (allowed by architecture §12):** architecture named `2026_09_19_010000`. `storefronts` is `2026_09_20`, so this file is `2026_10_03_020000` to keep the FK valid. Dual-engine indexes only; no partial unique indexes.

Lazy create: GET does not insert. First PUT inserts revision `1`. Publish with no row or `draft_revision = 0` → 422.

---

## 4. Draft API

```text
GET  /api/commerce/workspace/storefronts/{id}/presentation
PUT  /api/commerce/workspace/storefronts/{id}/presentation
```

- Auth: Sanctum + EnsureUserPrincipal + SetTenant + SetBranch + EnsureActiveSubscription + `commerce.manage`
- Extra deny: `self_service` → 403
- `{id}` UUID (`whereUuid`). Malformed → 404 (no route match). Foreign/missing → **404** `'المتجر غير موجود.'`
- GET: virtual default when no row (`draft_revision: 0`, `published: null`). No insert.
- PUT body: `{ "config": {…}, "draft_revision": n }` only. Unknown envelope keys → 422. Oversize (1.5 MiB) → 422.
- Server normalizes before persist. Client `version` overwritten to `1`.
- Saving Draft **never** writes `published_config` / `published_revision` / `published_at`.
- Stale `draft_revision` → **409**. First-insert unique race: catch `QueryException` **outside** the transaction; map `23505` / SQLite `19` to retry-read.

Response shape matches architecture §4 (no `tenant_id`, no channel id, no catalog).

---

## 5. Publish API

```text
POST /api/commerce/workspace/storefronts/{id}/presentation/publish
```

Same auth as Draft. Body `{ "draft_revision": n }` optional but sent by the Customizer.

Transaction (architecture §6):

1. lock storefront (`lockForUpdate`)
2. lock presentation (`orderBy id` + `lockForUpdate`)
3. re-check `tenant_id`
4. no row or `draft_revision = 0` → 422
5. client revision mismatch → 409
6. re-normalize draft; size fail aborts the transaction
7. same `draft_revision` + same document → idempotent 200, **`published_at` unchanged**
8. else copy normalized draft → `published_config`, set `published_revision`, `published_at = now()`, `schema_version = 1`

A failed Publish leaves the previous Published snapshot unchanged.

---

## 6. Public runtime behavior

Host-resolved `GET /store/v1/storefront` is additive:

```json
{
  "data": {
    "name": "…",
    "default_locale": "ar",
    "presentation": null
  }
}
```

- `presentation: null` when no row or `published_config IS NULL` → AWJ Modern / `resolveHomeSections()` with no argument.
- Object is the normalized Published snapshot. Draft is absent.
- Public SELECT is `published_config` + `schema_version` only. Never `draft_config`. Never `SELECT *`.
- `name` remains `storefronts.name`. `branding.displayName` is a client override via existing `previewStoreName()` semantics.
- Identity still exposes **no** `tenant_id`, channel id, or draft.

---

## 7. Preview behavior

**A — authenticated in-workspace canvas.** Locked.

- `/commerce/appearance` uses `selectedStoreId` as `{id}`.
- On load: GET draft → React state. While editing: page-lifetime state. **No** `localStorage` / `sessionStorage` / cookies.
- Canvas renders draft. It does not fetch `GET /store/v1/storefront` for theme.
- Switching stores reloads that storefront's draft.
- **Not introduced:** preview token, `?preview=`, unpublished public route, iframe of the live storefront, draft cookie authority.

The storefront `/dev` ExperienceBuilder remains a visual harness (not API-wired). Architecture map wires **web** only.

---

## 8. Authorization

| Situation | Status |
|---|---|
| Unauthenticated | 401 |
| ApiClient / customer token | 403 `EnsureUserPrincipal` |
| Missing `commerce.manage` | 403 |
| `self_service` | 403 |
| Inactive subscription | 403 |
| Storefront missing or other tenant | **404** `'المتجر غير موجود.'` |
| Stale `draft_revision` | 409 |
| Envelope / oversize / nothing to publish | 422 |

No `commerce.appearance` permission. Reuses `commerce.manage`.

---

## 9. Tenant / store isolation

- Tenant from `SetTenant` → `TenantContext` from the Sanctum User. Never from `{id}`, query, header, cookie, Host, or body.
- Storefront under `TenantScope`, then explicit `$row->tenant_id === TenantContext::id()`.
- Presentation is `CompanyWide` (institution-level), matching `Storefront`. `booted()` rejects a storefront that is not same-tenant (mirror `StorefrontDomain`).
- Two storefronts of the same tenant are isolated by `{id}`.
- Public runtime is Host → `ResolveStorefrontDomain` only. Cross-tenant Host cannot see another tenant's published snapshot.

---

## 10. Normalization / security

PHP twin: `app/Support/Commerce/StorefrontPresentationNormalizer.php`.

| Rule | Enforcement |
|---|---|
| Unknown keys | Dropped |
| Invalid tokens / colours | Fail closed to field default |
| URLs | https only. `javascript:` / `http:` / `data:` (except raster logo) / `vbscript:` / `file:` rejected |
| Logo SVG | `sanitizeLogoUrl` rejects `data:image/svg` |
| Logo size | 512 KiB; oversized stored as null |
| Document size | 1.5 MiB body + stored JSON → 422 |
| Schema | Client `version` overwritten to 1 on write. Stored `schema_version > 1` fails closed to AWJ Modern on **read** only |
| Envelope | `rejectUnknown` on raw JSON. `tenant_id` / `published_config` / `is_verified` cannot be written |
| XSS | No HTML/CSS/JS fields. `presentationCssVars` emits validated hex only |
| Verification | `requestedVerifiedLabel` + CR persist. **No** `is_verified`. **No** Verified / موثّق badge from merchant input |
| Draft secrecy | Workspace-only GET. Public SELECT never reads `draft_config` |

---

## 11. Concurrency

Integer `draft_revision` + `lockForUpdate`. No `If-Match`. No `updated_at` as concurrency.

- Two saves, same revision: lock serializes; loser 409.
- Stale editor: 409. Client re-GETs. **Does not merge JSON.**
- Publish vs save: same row lock; later writer sees committed state.
- Repeated publish of identical draft: 200, `published_at` unchanged.
- First insert race: unique `(storefront_id)` + `QueryException` outside the transaction.
- SQLite: same unique + revision checks. True race test **skips** unless pgsql+pcntl.

---

## 12. Cache behavior

- **No** Laravel `Cache::` for presentation.
- Next.js `fetchStorefrontConfig()` / `storefrontFetch("storefront")` uses `cache: "no-store"`.
- Catalog/product GETs are unchanged (optional 3rd `init` argument; catalog calls omit it).
- Host-keyed 60s locale Map left alone (`default_locale` only).
- Draft save does not invalidate public runtime (there is no public cache to bust).
- Prove: publish then GET public in the same process sees the new snapshot (`StorefrontPresentationPublicRuntimeTest`).

---

## 13. STORE-UI-6 wiring

`web/src/app/(commerce)/commerce/appearance/page.tsx` passes `storefrontId={selectedStoreId}`.

`web/src/modules/store-experience-builder/ExperienceBuilder.tsx`:

| Event | Behavior |
|---|---|
| Load | GET draft. Loading notice until the response. |
| Save | PUT `{ config, draft_revision }`. Success notice **only** after 200. |
| Publish | POST `{ draft_revision }`. Success notice **only** after 200. |
| 409 | Re-GET. Discard local dirty. Stale notice. Never merge. Never claim success. |
| No storefront | Capability notice. Buttons do not pretend to persist. |
| Restore default | Client draft reset only (history **DEFERRED**). PUT if the merchant later saves. |
| Storage | No `localStorage` / `sessionStorage`. |

Client lives in `web/src/modules/commerce-workspace/presentation.ts` (`api()`). Paths are workspace `/commerce/workspace/storefronts/{id}/presentation`. Never `store/v1`. Never `tenant_id` in the body.

Visual chrome (two-pane, desktop / tablet 768 / mobile 390, Arabic RTL, English LTR) is STORE-UI-6 and was **not** redesigned.

---

## 14. Public storefront wiring

When `presentation` is non-null:

- Homepage: `resolveHomeSections(published.homepage.sections)` for implemented keys only. Gated keys (`banner`, `featured`, `offers`, `benefits`, `appPromo`, `customContent`) still dropped.
- Theme: `presentationCssVars` on a real flex column wrapper (CSS vars do not inherit through `display: contents`).
- Header: published logo, compact, search/account/cart flags, extra nav links.
- Footer: tagline/copyright/contact/social/app links; CR/license as “merchant provided” text only.
- WhatsApp: `StoreWhatsApp` mounts only when published `enabled` + sanitary number.

When `presentation` is null:

- Layout remains a Fragment (layout.test contract).
- Homepage calls `resolveHomeSections()` with no argument.
- Unpublished copyright remains `© {year} <bdi>{displayName}</bdi>`.
- Existing stores keep AWJ Modern.

Pages stay GATED: public still uses existing `POLICY_LINKS`. No CMS.

---

## 15. Capability states after implementation

| Capability | After STORE-BACKEND-1 | Notes |
|---|---|---|
| Theme persistence | **LIVE** | Closed token set + public CSS vars from Published |
| Homepage composition | **LIVE** for `hero`, `categories`, `newArrivals`, `wholesale` | Gated keys persist as flags and stay unrendered |
| Custom nav / footer / contact / WhatsApp / social / app links | **LIVE** | WhatsApp still does not send. App section absent without a valid URL |
| Draft persistence | **LIVE** | Workspace GET/PUT. No `localStorage` |
| Customizer preview | **LIVE** as in-workspace canvas | No iframe / token / unpublished public route |
| Publish | **LIVE** | Authoritative promote. Save does not publish |
| Branding persistence | **DESIGN_ONLY** | Data URLs round-trip. No media object. No ERP logo |
| Business verification | **GATED** | Persist CR/license/URL/`requestedVerifiedLabel`. **No Verified badge. No `is_verified`.** |
| Informational pages | **GATED** | `pages[]` metadata only. No CMS |
| Version history / restore | **DEFERRED** | Editor restore-default is a client draft reset |

Twins updated: `storefront/src/lib/presentation/capabilities.ts` and `web/src/modules/store-experience-builder/presentation/capabilities.ts`.

---

## 16. Changed files

### Add

| File | Role |
|---|---|
| `database/migrations/2026_10_03_020000_create_storefront_presentations_table.php` | Schema §2 |
| `app/Models/StorefrontPresentation.php` | `BaseModel` + `CompanyWide` |
| `app/Services/Commerce/StorefrontPresentationService.php` | GET virtual default, PUT, POST publish |
| `app/Services/Commerce/StaleDraftRevisionException.php` | 409 |
| `app/Services/Commerce/NothingToPublishException.php` | 422 |
| `app/Services/Commerce/PresentationDocumentTooLargeException.php` | 422 |
| `app/Support/Commerce/StorefrontPresentationNormalizer.php` | PHP twin |
| `app/Http/Requests/SaveStorefrontPresentationRequest.php` | `config` + `draft_revision` |
| `app/Http/Requests/PublishStorefrontPresentationRequest.php` | optional `draft_revision` |
| `app/Http/Controllers/Api/CommerceWorkspaceStorefrontPresentationController.php` | Thin 404/409/self_service |
| `tests/Feature/StorefrontPresentationDraftApiTest.php` | Draft + auth + IDOR |
| `tests/Feature/StorefrontPresentationPublishApiTest.php` | Atomic publish, failed preserve, idempotent, stale |
| `tests/Feature/StorefrontPresentationPublicRuntimeTest.php` | Published-only, default fallback, Host isolation |
| `tests/Feature/StorefrontPresentationNormalizerTest.php` | Golden fixtures, unsafe URLs, verification |
| `tests/Feature/StorefrontPresentationPostgresConcurrencyTest.php` | Skip unless pgsql+pcntl |
| `tests/Fixtures/presentation/v1-default.json` | Golden default |
| `tests/Fixtures/presentation/v1-unsafe-input.json` | Unsafe URLs + verification flag |
| `storefront/src/lib/presentation/public.ts` | Published helpers |
| `storefront/src/lib/presentation/__tests__/public.test.ts` | Public helpers |
| `storefront/src/components/layout/StoreWhatsApp.tsx` | Floating control, unmounted unless published |
| `web/src/modules/commerce-workspace/presentation.ts` | Workspace API client |
| `web/src/modules/commerce-workspace/presentation.test.ts` | Client mapping + 409 |
| `web/src/modules/store-experience-builder/__tests__/ExperienceBuilder.test.tsx` | Load/save/409/no storage |
| `docs/plans/store/STORE-BACKEND-1-IMPLEMENTATION-REPORT.md` | This report |

**Normalizer test location:** architecture named `tests/Unit/…`. CI copy glob is `tests/Feature/*.php` only (`tests/Unit` is not copied). The test lives in Feature so sqlite+pgsql CI actually runs it. Same assertions.

### Modify

| File | Change |
|---|---|
| `routes/api.php` | GET/PUT presentation + POST publish, `commerce.manage`, `whereUuid` |
| `tests/Feature/CommerceModuleBoundaryTest.php` | Allowlist the two URIs (LIFECYCLE-1 activate/deactivate kept) |
| `app/Models/Storefront.php` | `hasOne(StorefrontPresentation)` only. **No new columns.** |
| `app/Http/Controllers/Api/StorefrontConfigController.php` | Additive `presentation` from published only |
| `.github/workflows/ci.yml`, `setup.sh`, `deploy/assemble.sh` | Copy `app/Support/Commerce` + `tests/Fixtures/presentation` |
| `storefront/src/lib/commerce/storefront.ts` | Type + `cache: "no-store"` on identity fetch |
| `storefront/src/lib/commerce/config.ts` | Optional `StorefrontFetchInit.cache` |
| `storefront/src/app/[country]/[locale]/(storefront)/page.tsx` | Published sections when present |
| `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx` | Published tokens / chrome when present |
| `storefront/src/components/layout/Header.tsx` / `Footer.tsx` | Optional published props; unpublished defaults preserved |
| `storefront/src/lib/presentation/capabilities.ts` | §11 LIVE flags |
| `storefront/messages/{ar,en,de,es,fr,pl}.json` | Footer whatsapp / merchant-provided / CR / license |
| `web/src/app/(commerce)/commerce/appearance/page.tsx` | `storefrontId={selectedStoreId}` |
| `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` | GET/PUT/POST + 409 |
| `web/src/modules/store-experience-builder/presentation/capabilities.ts` | §11 LIVE flags |
| `web/src/modules/store-experience-builder/messages.ts` | save/publish/load/stale notices |
| `web/src/lib/mock-data.ts` | Demo GET/PUT/POST presentation |
| `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` | §5.16–§5.29 |

---

## 17. Tests and exact results

### PHP (written, not runnable in this sandbox)

No PHP in the sandbox (`php` not installed; Laravel is assembled in CI via `setup.sh`). Tests exist and target architecture §13:

| File | Cases |
|---|---|
| DraftApi | virtual GET, persist + increment, draft ≠ published, guest 401, staff 403, self_service 403, foreign 404, missing 404, malformed id, cross-store, unknown envelope, stale 409, name/locale unchanged |
| PublishApi | atomic copy, 422 nothing, stale 409, idempotent `published_at`, failed publish preserves previous, unknown envelope, cross-tenant 404 |
| PublicRuntime | null when unpublished, draft never on public payload, publish then GET sees snapshot, Host isolation, anonymous workspace 401 |
| Normalizer | fail-closed default, drop unknown, unsafe URLs, verification stored not authorized, oversized logo null, forward schema fail-closed, client version overwritten |
| PostgresConcurrency | skip unless pgsql+pcntl |

§13 mapping: 1–15, 19 covered by those files. 16–18 / 20 sqlite+pgsql + existing storefront regression + capability honesty are CI / frontend.

### Web Vitest (this sandbox)

```text
npx vitest run src/modules/store-experience-builder \
  src/modules/commerce-workspace/presentation.test.ts \
  src/app/(commerce)/commerce/appearance/page.test.tsx
```

**4 files, 18 tests passed.**

Covers: §11 flags, API client mapping, load/save, success only after 200, 409 re-GET no merge, no browser storage.

### Storefront Vitest (this sandbox)

```text
pnpm exec vitest run src/lib/commerce/__tests__/storefront.test.ts \
  src/lib/commerce/__tests__/config.test.ts \
  src/lib/presentation src/components/customizer/__tests__ \
  src/app/[country]/[locale]/(storefront)/layout.test.tsx
```

**9 files, 53 tests passed.**

Covers: identity `cache: "no-store"`, catalog GETs have no cache, `presentation: null` stays null, unpublished layout is Fragment, playground Save still inert, no Verified badge.

---

## 18. SQLite result

**Not run locally.** No PHP. CI job `php artisan test (L11, sqlite)` on this PR is the gate. Dual-engine migration uses full unique indexes (no partial unique).

---

## 19. PostgreSQL result

**Not run locally.** No PHP. CI job `php artisan test (L11, pgsql)` on this PR is the gate. `StorefrontPresentationPostgresConcurrencyTest` runs only when pgsql+pcntl.

---

## 20. Storefront tests / typecheck / lint

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | pass |
| `pnpm check` (biome, 393 files) | pass |
| `pnpm check:locales` (ar/de/es/fr/pl vs en) | all 6 OK |
| Focused Vitest | 53 passed |
| Full `pnpm test` | not re-run as a whole-suite after focused 53; storefront-ci.yml will run it |

---

## 21. Web build

| Check | Result |
|---|---|
| Focused Vitest | 18 passed |
| `npx tsc --noEmit` | **pre-existing errors** in unrelated `*.test.tsx` (POS, documents, products). None in STORE-BACKEND-1 files. `web/tsconfig.json` includes tests. |
| `next build` compile | **succeeded** (16.5s after parent-lockfile isolation) |
| `next build` lint | **failed in this sandbox** because parent `/workspace/eslint.config.mjs` is picked up (`@next/next/no-img-element` rule not found). That file is not in the Nebrax repo. GitHub `web-ci.yml` checks out Nebrax alone. Not a product change. |

No STORE-BACKEND-1 ESLint error. `ControlPanels.tsx` still has the pre-existing STORE-UI-6 `react-refresh` warning only.

CI `web-ci.yml` (`npm ci` → `npm run test` → `npm run build`) is the production-shaped gate.

---

## 22. CI status

**Not yet green at report time** — this report is committed with the implementation; GitHub Actions will run:

- `ci.yml` — php artisan test on sqlite + pgsql, copy-list guard includes `app/Support/Commerce`
- `storefront-ci.yml` — biome + locales + tsc + vitest
- `web-ci.yml` — vitest + next build

Do **not** treat this document as a CI pass. The PR must wait for those checks.

---

## 23. Risks

1. **PHP tests unseen in this sandbox.** Dual-engine unique + `lockForUpdate` + TenantScope on public snapshot must be proven by CI.
2. **Copy-list / assemble.** `app/Support/Commerce` is new. Guard + three copy scripts were updated together; a missed glob would 500 on first GET.
3. **Public TenantScope.** `publishedSnapshotForStorefront` relies on `ResolveStorefrontDomain` setting `TenantContext`. That is the existing public chain; tests assert Host isolation.
4. **Sandbox `next build` lint.** Parent App Builder ESLint config is not CI. Do not “fix” unrelated ERP lint in this PR.
5. **Data-URL size.** 512 KiB logos inside 1.5 MiB JSON are the approved DESIGN_ONLY cap, not a media library.
6. **Visual.** Header/Footer gained optional props with unpublished defaults. Unpublished copyright markup was restored to the `bdi` form. No live screenshot pass in this sandbox (no assembled Laravel / public Host).

---

## 24. Remaining work

Explicitly **out of STORE-BACKEND-1** (architecture §12 / §14):

- Branding media upload / storage / public media route
- Pages CMS
- External/government business verification / Verified authority
- Version history / restore-from-history
- Preview token / unpublished public storefront route / iframe
- Laravel `Cache::` layer
- Product/category ID resolution inside nav hrefs
- Accounting / inventory / payment / shipping / tax / checkout / product CRUD

GATED/DEFERRED after this PR: verification, pages, branding media, version history.

**Next recommended slice:** wait for this PR's CI (sqlite + pgsql + storefront-ci + web-ci). Do not start another STORE task from this branch.

---

## 25. Branch

`feat/store-backend-1-customizer-persistence`

Rebased onto latest `origin/main` after STORE-ADMIN-LIFECYCLE-1 (#873). Fast-forward of uncommitted work; `routes/api.php` and `CommerceModuleBoundaryTest.php` auto-merged (activate/deactivate kept + presentation added).

---

## 26. PR

Title: `feat(store): customizer persistence and publish lifecycle (STORE-BACKEND-1)`

Opened against `main`. **Not merged. Not deployed.**

---

## 27. Base SHA

`52aa20797368cf91ea07d1e3c8efa140229b768e`

`feat(store): STORE-ADMIN-LIFECYCLE-1 merchant activate/deactivate (#873)` — latest `origin/main` at implementation.

Architecture lock SHA `6898384969facbf16990feb82d741ce62217eba7` is an ancestor.

`git merge-base --is-ancestor origin/main HEAD` holds after rebase.

---

## 28. Head SHA

Filled after the implementation commit on this branch (see Git table in the PR body / `git rev-parse HEAD`).

---

## 29. Recommended next step

1. Wait for GitHub CI: sqlite, pgsql, storefront-ci, web-ci.
2. Review the PR. Confirm no merge until sqlite+pgsql are green.
3. **Do not merge. Do not deploy.**
4. Do not continue into another STORE task from this work.

---

## Explicit confirmations

- No merge.
- No deploy.
- No preview token / unpublished public route / iframe / `?preview=`.
- No Verified mint / `is_verified` / badge from CR/license/`requestedVerifiedLabel`.
- No columns on `storefronts` or `sales_channels`.
- No `tenants.settings` presentation blob.
- No Laravel `Cache::`.
- No media upload, pages CMS, or version history.
- No `commerce.appearance` permission.
- No localStorage for draft.
- Success UI only after real 200.
- 409 → re-GET, no JSON merge.
- STORE-UI-6 not redesigned.
- Identity `cache: "no-store"` only; catalog GETs unchanged.
