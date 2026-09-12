# AWJ Storefront Preview Gate — First Real Preview Report

**Status:** READY (locally verified; no repository code changes required)
**Date:** 2026-09-12
**Base:** `11ed2ff141ec7d6e1faa56d3000820fd4d76e25d` (main, includes merged PR #769/#775 — COM-7-P2A/P2B)
**Scope:** Verify the storefront is ready for a first real Preview; determine the deployment path; do not deploy

## 1. Readiness

**READY** for a first Preview deployment, with one required manual step (creating real `Storefront`/`StorefrontDomain` records for the preview environment — no admin UI exists yet, so this is a one-time script/tinker action, same as every prior COM-7 verification in this repo).

No code, config, or schema changes were required to reach this state. This report documents verification only.

## 2. What Was Verified

1. **Latest `main` contains P2A + P2B correctly** — confirmed via `git log`/`git reset --hard origin/main` at the given merge SHA, and by re-running the full P2A/P2B backend test suite (`StorefrontGatewayAndConfigTest`, `StorefrontDomainResolutionApiTest`, `StorefrontModelTest`, `HostnameNormalizerTest`, `StorefrontCatalogApiTest`, `BranchIsolationGuardTest`): **68 passed (274 assertions)**, zero failures, on a freshly `migrate:fresh`'d database built from this exact `main`.
2. **Runtime requirements** — enumerated below (§4/§5); all confirmed by exercising them, not just reading code.
3. **Deployment infrastructure** — inspected `render.yaml` (backend only, Docker on Render) and `web/vercel.json` (the *admin* Next.js app's Vercel config). **No `storefront/vercel.json` or any other deployment config exists for `/storefront` today** — it has never been deployed. `web/vercel.json`'s shape (framework: nextjs, build/install commands, git deployment gating on `main`/`preview/**`) is the established pattern this repo already uses for a Next.js app on Vercel and is directly reusable for `/storefront` when deployment is approved.
4. **URL/hostname strategy** — no production hostname was invented (see §3/§10).
5. **End-to-end Arabic/English rendering, locale-switch identity stability, and fail-closed unknown-hostname behavior** — all verified live against a real build (§6–§9).
6. **Visual check** — two screenshots taken (Arabic listing, English listing) via a real Chromium browser against the live standalone build; sent to the user in this session. No rendering blockers found (see §10).

## 3. Preview Architecture / Path

Unchanged from the P2A/P2B-approved architecture — this task did not invent anything new:

```
Visitor → Host: <preview-hostname> → Next.js storefront server (/storefront)
                                            │ next/headers reads the real Host
                                            │ storefrontFetch() → Laravel store/v1/...
                                            │   + X-Storefront-Forwarded-Host: <preview-hostname>
                                            │   + X-Storefront-Gateway-Secret: <shared secret>
                                            ▼
                              ResolveStorefrontDomain (Laravel)
                              StorefrontDomain → Storefront → Tenant → SalesChannel
                                            ▼
                                   trusted StorefrontContext
```

**Two independently deployable services**, matching the already-approved separation (`/web` = ERP admin, `/storefront` = customer storefront, both Next.js; Laravel = single source of truth):

- **Backend**: already deployable via the existing `render.yaml` (Docker, Render) — no changes needed. The only *addition* needed for Preview is the `STOREFRONT_GATEWAY_SECRET` env var (not currently in `render.yaml`, since P2A/P2B never needed it deployed anywhere — see §4).
- **Frontend (`/storefront`)**: **no deployment configuration exists yet.** The repo has no `storefront/vercel.json`, no Railway config, and no CI/CD step that builds or ships it anywhere. `web/vercel.json` demonstrates the pattern Vercel deployment would follow for `/storefront` (separate Vercel project rooted at `storefront/`, same `framework: nextjs` shape), but creating that file/project is a **deployment action**, explicitly out of scope for this task ("STOP BEFORE DEPLOYMENT").

## 4. Required Environment Variables

**Backend (Laravel)** — one addition beyond what's already documented in P2A/P2B:

| Variable | Required value | Currently in `render.yaml`? |
|---|---|---|
| `STOREFRONT_GATEWAY_SECRET` | A real secret, shared with the frontend's copy | **No — must be added** before the storefront can resolve real hostnames in any deployed environment |

Everything else the backend needs (`DB_*`, `APP_ENV=production`, etc.) is already correctly configured in `render.yaml` and unaffected by the storefront.

**Frontend (`storefront/`)** — per `.env.example` (unchanged by this task, already correct from P2B):

| Variable | Purpose | Preview value |
|---|---|---|
| `AWJ_COMMERCE_API_URL` | Laravel backend base URL | The deployed backend's real URL (e.g. Render service URL) |
| `STOREFRONT_GATEWAY_SECRET` | Must **exactly match** the backend's value | Same secret as above — **server-only**, never `NEXT_PUBLIC_*`, never sent to or readable by the browser (confirmed by code inspection: read only in `src/lib/commerce/config.ts`, only attached as an outbound request header from the Next.js server to Laravel) |
| `AWJ_STOREFRONT_DEV_HOST` | Non-production-only override | Must be **left unset** in any real Preview deployment (`NODE_ENV=production` on Vercel/Railway already makes this dead code even if accidentally set — verified in P2B; still, do not set it, to avoid confusion) |
| `NEXT_PUBLIC_DEFAULT_COUNTRY` / `NEXT_PUBLIC_DEFAULT_LOCALE` | Cosmetic defaults, not authority | `sa` / `ar` (already the `.env.example` defaults) |

## 5. Required Storefront/Domain/SalesChannel Data

No admin UI exists yet (unchanged from P2A/P2B — explicitly deferred both times). For this Preview, the following must be created once via Artisan/Tinker against the deployed backend, exactly as this report's own verification did locally:

1. A `Tenant` (active) — one already exists if a real merchant is being previewed; otherwise a dedicated preview tenant.
2. A `SalesChannel` with `type = 'web'`, `is_active = true`, owned by that tenant.
3. A `Storefront` row: `sales_channel_id` → the channel above, `is_active = true`, `default_locale` set to `'ar'` (or `'en'`, per preference — both are fully supported).
4. A `StorefrontDomain` row: `hostname` = the exact **non-production** preview hostname (see §10 — none is prescribed by this report), `type = 'custom'`, `is_active = true`, **`verification_status = 'verified'`** (this is what actually grants production authority to that hostname — omitting this fails closed, by design).

This is the same four-step sequence P2A's and P2B's own local verifications used (`tests/Feature/StorefrontDomainResolutionApiTest.php`'s `seedDomainStore()` helper encodes the identical shape).

## 6. Arabic Result

Verified locally end-to-end (live Laravel backend + `next build` + standalone production server, real HTTP requests with `Host: awj-preview-gate.local`):

| Check | Result |
|---|---|
| `lang="ar"` | ✅ |
| `dir="rtl"` | ✅ |
| Product listing | ✅ — 3 seeded products render with Arabic names |
| Product detail | ✅ — real SKU (`PG-1`), SAR-formatted price (`ر.س`) |
| Categories | ✅ — real category name (`إلكترونيات`) rendered |
| Media | Gracefully handled — no real media file was seeded for this Preview probe, so the placeholder-image state renders (not a defect; P1's own report already verified real media end-to-end with a seeded file, and that code path is untouched since) |
| Price | ✅ — `SAR`/`ر.س` present on both listing and detail |
| Availability | ✅ — renders `غير متوفر` (out of stock, correctly, since no `ProductWarehouseStock` was seeded for this probe — the availability *mechanism* is exercised and correct, just reflecting real zero stock) |

Screenshot sent to user: Arabic product listing, correct RTL mirroring (header icons, product grid reading order, typography) — see attached image.

## 7. English Result

| Check | Result |
|---|---|
| Same store identity as Arabic | ✅ — same 3 products (`PG-1..3`), same tenant, verified via identical product IDs across both locale requests |
| Product listing | ✅ |
| Product detail | Not re-probed separately in English (identical code path to Arabic's detail check, already covered end-to-end in COM-7-P2B's own report) |
| English name uses `name_en` when available | ✅ — `Preview Product 1/2/3` rendered (from `products.name_en`), not the Arabic `name` |
| `lang="en"` | ✅ |
| `dir="ltr"` | ✅ |

Screenshot sent to user: English product listing, correct LTR layout (mirrored header, product grid order) — see attached image.

## 8. Tenant/Store Isolation Result

- **Unknown/unmapped hostname fails closed**: confirmed live — `X-Storefront-Forwarded-Host: unknown-nowhere.local` (correct secret, otherwise-valid request) → **HTTP 404**, non-revealing, matching `StorefrontDomainResolutionApiTest`'s `unknown_hostname_fails_closed` test.
- **Locale switching does not change Storefront/Tenant/SalesChannel**: confirmed live — the Arabic and English requests against the same `Host` returned the exact same 3 product IDs/SKUs; no code path in `storefrontFetch()`/`ResolveStorefrontDomain` reads locale at all (re-confirmed by inspection, matching P2A's `locale_switching_never_changes_the_resolved_tenant_storefront_or_channel` test, re-run green in this session).
- **Full backend isolation suite** (domain A/B isolation, inactive/unverified domain, inactive Storefront/SalesChannel, cross-tenant binding rejection, header/cookie/query spoofing) — re-run fresh on this exact `main`: **68 passed, 0 failed**. Not re-probed manually against a second live tenant in this session (a Low-effort verification task re-running the existing, comprehensive automated suite is the proportionate check here, not re-deriving it by hand).
- **`STOREFRONT_GATEWAY_SECRET` never reaches the browser**: confirmed by code inspection (only read server-side in `src/lib/commerce/config.ts`, attached only as an outbound header on the Next.js-server-to-Laravel request) — unchanged from P2B, re-verified as still true on this `main`.

## 9. Production Build Result

```
pnpm build → exit 0
```

Verified against a live seeded backend (as in P2A/P2B). No route required a live backend to complete static generation. Runtime-verified via `node .next/standalone/server.js` (the correct standalone runner — `next start` is documented as incompatible with this project's `output: "standalone"` config, a pre-existing fact from P2B, not something this task changed).

## 10. Blockers

**None that block a Preview.** Two non-blocking observations, explicitly not fixed (out of scope per "do not redesign or polish"):

1. **Storefront header still shows the original Spree wordmark/logo**, not AWJ branding. Purely cosmetic, not a rendering defect — visible in the attached screenshots. Left untouched.
2. **Category names do not localize** (the P2B-documented, explicitly-accepted-for-this-gate bilingual gap) — an English-locale visitor would see the Arabic category name. Already known, already accepted, not addressed here.

**No production hostname was invented.** A first Preview needs one of:

- An **AWJ-controlled subdomain** (`type = 'awj_subdomain'` in `StorefrontDomain`) pointed at wherever `/storefront` ends up deployed — e.g. a Vercel preview URL's custom domain, or a subdomain like `preview.awj.app` **if and when such a domain is actually provisioned** (not assumed here).
- Or, simplest and requiring zero new DNS: **Vercel's own auto-generated preview URL** (e.g. `awj-storefront-git-preview-<org>.vercel.app`) registered as the `StorefrontDomain.hostname` value once the frontend is actually deployed there. This is the safest "clearly non-production" choice — it is not a real merchant domain, is trivially disabled/rotated, and requires no DNS changes at all.

Either choice is a **deployment decision**, not something this report should pick unilaterally — flagged for Safwan's approval per §14.

## 11. Changes Made

**None to the repository.** This task was verification-only. Local, non-committed, git-ignored scaffolding used for verification (and already discarded at the end of this session):

- A temporary `Tenant`/`SalesChannel`/`Storefront`/`StorefrontDomain`/products seed in the local `nibras-app` test database (not part of this repo).
- `STOREFRONT_GATEWAY_SECRET` set in the local `nibras-app/.env` and `storefront/.env.local` (both git-ignored, never committed).
- Two screenshots taken via a local headless Chromium run, sent directly to the user — not committed to the repo.

This document itself (`docs/plans/store/AWJ_STOREFRONT_FIRST_PREVIEW_REPORT.md`) is the only repository change.

## 12. Tests / Results

```
php artisan test --filter="StorefrontGatewayAndConfigTest|StorefrontDomainResolutionApiTest|StorefrontModelTest|HostnameNormalizerTest|StorefrontCatalogApiTest|BranchIsolationGuardTest"
Tests:    68 passed (274 assertions)
```

Run on SQLite, freshly migrated from this exact `main` (`11ed2ff1`). PostgreSQL was not re-run in this session — P2B's own report already verified the identical suite on PostgreSQL 16 with zero regressions, and this task made no code changes that could affect driver-specific behavior, so re-running it would not produce new information for a Low-effort verification task.

```
pnpm build → exit 0
```

End-to-end manual verification: see §6–§9 (live curl requests + two browser screenshots).

## 13. Branch / PR / SHAs

| Field | Value |
|---|---|
| Branch | `claude/storefront-preview-gate` |
| PR | (to be opened — documentation only, zero application code changes) |
| Base SHA | `11ed2ff141ec7d6e1faa56d3000820fd4d76e25d` (main) |
| Head SHA | (set after commit) |

## 14. Recommended Next Action

**Awaiting Safwan's explicit approval before any deployment**, per this task's instructions. When approved, the concrete next steps are:

1. Decide the Preview hostname strategy (§10 — a Vercel-generated preview URL is the lowest-risk default recommendation; an AWJ-controlled subdomain is the alternative if one is already provisioned).
2. Add `STOREFRONT_GATEWAY_SECRET` to the Render backend's environment (generate a real secret; it does not exist in `render.yaml` today).
3. Create a `storefront/vercel.json` (or equivalent Railway config) — a genuine deployment action, not performed in this task.
4. Deploy `/storefront` to the chosen platform with the environment variables in §4.
5. Run the one-time Artisan/Tinker step in §5 to create the real `Storefront`/`StorefrontDomain`/`SalesChannel` rows for whichever tenant is being previewed.
6. Re-run this exact verification (§6–§9) against the real deployed URLs before sharing the Preview link further.

No code change is required to reach that point — this repository is ready.
