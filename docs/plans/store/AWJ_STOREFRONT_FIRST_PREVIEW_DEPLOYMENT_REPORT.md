# AWJ Storefront — First Real Preview Deployment Report

**Status:** **BLOCKED — repository prepared, actual deployment NOT executed**
**Date:** 2026-09-12
**Base:** `a4b614fd0a893296236fefba2db02e29e65b8c1d` (main, includes merged PR #776 — Preview Gate readiness report)
**Authoritative prior report:** `docs/plans/store/AWJ_STOREFRONT_FIRST_PREVIEW_REPORT.md`

## 1. Why This Is Blocked (read this first)

This session (the Claude Code Remote sandbox executing this task) has:

- **No Vercel CLI, API token, or MCP connector** — cannot create a Vercel project, set its environment variables, or trigger a deployment.
- **No Railway CLI, API token, or MCP connector** — same limitation for the alternative platform.
- **No Render API token / dashboard access** — cannot add the `STOREFRONT_GATEWAY_SECRET` environment variable to the live `nibras-api` service, and cannot open a shell/tinker session against the live production database.
- **No credentials for the deployed production PostgreSQL** — cannot inspect existing tenants to pick a "safe test/demo tenant," and cannot run the one-time `Storefront`/`StorefrontDomain`/`SalesChannel` seed against real production data.

Per the task's own instruction — *"If no safe tenant exists, STOP and report instead of guessing"* — the same principle applies here: **I will not fabricate a deployment, a Preview URL, or screenshots of a live environment that does not exist.** Doing so would violate the task's explicit safety intent far more than reporting the gap honestly.

What I *did* do: everything on the repository side that is safe, minimal, and reversible, so that the moment someone with the right dashboard/CLI access executes the remaining steps, the Preview comes up correctly on the first try — no further repo changes needed.

## 2. Deployment Target Decision

**Recommended: Vercel, using the auto-generated preview URL** (not a custom domain), for `/storefront` — same conclusion as the Preview Gate report's §10, now made concrete:

- Lowest risk: no DNS change, no `awj.app` involvement, trivially disabled/rotated.
- The repo already has an established, working pattern for this exact shape: `web/vercel.json` (the ERP admin app). `storefront/vercel.json` (added in this task) mirrors it exactly, just pointed at the `storefront/` directory as the Vercel project root.
- Railway was considered per the task's instruction to document if chosen instead — **not chosen**, because there is no existing Railway configuration in this repo for any Next.js app (unlike Vercel, which already hosts `/web`), so Vercel is both safer (proven pattern) and lower-effort here.
- Render (already hosting the Laravel backend) is **not** a candidate for the storefront itself — no change to that decision; the storefront stays a separate Next.js deployment, per the approved two-service architecture.

## 3. Repository Changes Made

| File | Change | Why |
|---|---|---|
| `storefront/vercel.json` (new) | Vercel project config: `framework: nextjs`, `buildCommand: pnpm build`, `installCommand: pnpm install`, git deployment gating on `main`/`preview/**` only | Mirrors `web/vercel.json`'s already-proven shape; without this file Vercel cannot be pointed at `storefront/` as its own project |
| `render.yaml` | Added `STOREFRONT_GATEWAY_SECRET` as a `sync: false` env var on the `nibras-api` service (alongside the existing `APP_KEY`/`FRONTEND_URL` pattern) | Documents the requirement in the blueprint so it isn't silently missing; `sync: false` means Render will prompt for the value in the dashboard rather than storing it in git — **the secret itself is never in this repo** |

No other files were changed. No `.env`, no seed data, no migrations, no accounting/inventory code.

## 4. Environment Variables (names only — no values)

**Render (`nibras-api`)** — one addition, set manually in the Render dashboard after this PR merges (or even before — the blueprint field just documents the name):

| Variable | Where |
|---|---|
| `STOREFRONT_GATEWAY_SECRET` | Render dashboard → `nibras-api` → Environment. Generate with e.g. `openssl rand -hex 32`. |

**Vercel (new `storefront` project)** — set in Vercel dashboard → Project → Settings → Environment Variables, scoped to **Preview** (not Production, since no production hostname exists yet):

| Variable | Value guidance |
|---|---|
| `AWJ_COMMERCE_API_URL` | The live Render backend URL, e.g. `https://nibras-api.onrender.com` |
| `STOREFRONT_GATEWAY_SECRET` | **Exactly** the same value set on Render above. Server-only — do **not** prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_DEFAULT_COUNTRY` | `sa` |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar` |
| `NEXT_PUBLIC_SITE_URL` | Leave as the Vercel-assigned preview URL once known, or omit for first deploy |
| `SPREE_API_URL`, `SPREE_PUBLISHABLE_KEY` | Placeholder values are fine — cart/checkout is out of scope for this Preview |
| `AWJ_STOREFRONT_DEV_HOST` | **Leave unset.** Setting this would be a security regression (non-production hostname override). |

Confirmed by code inspection (unchanged from P2B): `STOREFRONT_GATEWAY_SECRET` is read only in `storefront/src/lib/commerce/config.ts`, used solely as an outbound request header from the Next.js **server** to Laravel — never serialized into any page, script, or client bundle.

## 5. Storefront / Domain / SalesChannel Data — NOT Created

**Blocked for the same reason as §1**: no access to the live production database. This must be executed once, by someone with production DB access (Render shell/psql, or `php artisan tinker` against the deployed app), **after** the Vercel deployment exists and its real preview hostname is known (the `StorefrontDomain.hostname` must exactly match it).

Exact steps to run (adapt the tenant selection — see note below):

```php
// php artisan tinker (against the DEPLOYED production database)

// 1. Pick or create a safe preview tenant. Do NOT reuse a real merchant's
//    live tenant unless Safwan explicitly designates one as previewable —
//    prefer a dedicated demo tenant if one exists.
$tenant = \App\Models\Tenant::where('slug', '<demo-tenant-slug>')->firstOrFail();

// 2. An active Web sales channel for that tenant.
$channel = \App\Models\SalesChannel::firstOrCreate(
    ['tenant_id' => $tenant->id, 'type' => 'web'],
    ['is_active' => true, 'name' => 'Web Storefront']
);
$channel->update(['is_active' => true]);

// 3. The Storefront row.
$storefront = \App\Models\Storefront::firstOrCreate(
    ['sales_channel_id' => $channel->id],
    ['is_active' => true, 'default_locale' => 'ar']
);
$storefront->update(['is_active' => true]);

// 4. The StorefrontDomain — hostname MUST be the exact Vercel preview
//    hostname assigned after deployment (e.g. awj-storefront-xyz.vercel.app),
//    known only once step §6 below has run once.
\App\Models\StorefrontDomain::create([
    'storefront_id' => $storefront->id,
    'hostname' => '<exact-vercel-preview-hostname>',
    'type' => 'custom',
    'is_active' => true,
    'verification_status' => 'verified',
]);
```

**On the tenant choice**: I do not have visibility into the production tenant list, so I cannot confirm today whether a dedicated demo tenant already exists there (one does exist in this repo's *local* CI/test fixtures — `تجربة`/reference-company style seeds used throughout `tests/Feature/*` — but that is not the same as a real row in the deployed production database). **Safwan must confirm which tenant is safe to preview** before this step runs, per the task's explicit instruction not to guess.

## 6. Deployment — NOT Executed

Not performed, for the reasons in §1. The concrete manual sequence once someone has Vercel access:

1. In Vercel: **New Project** → import `safwan5001-source/Nebrax` → set **Root Directory** to `storefront` → it will detect `storefront/vercel.json` and apply the Next.js preset.
2. Set the environment variables from §4 (Preview scope).
3. Push/merge triggers a deploy per `vercel.json`'s `git.deploymentEnabled` gate (`main` and `preview/**` branches only — this PR's branch does not match either pattern, so **merging or pushing this exact PR branch will not itself trigger a Vercel deploy**; the first deploy will need to be either a manual `vercel deploy` from the CLI, or triggered by a push to `main` or a `preview/*`-named branch after this PR is reviewed).
4. Vercel assigns an auto-generated preview hostname (e.g. `nebrax-storefront-<hash>-<org>.vercel.app`).
5. Run §5's tinker script using that exact hostname.
6. Re-run the Preview Gate's own verification (§6–§9 of the prior report) against the real URL.

## 7. Post-Deploy Verification — NOT RUN (no live URL exists)

None of the following could be checked because no deployment exists yet:

- Arabic result — not run
- English result — not run
- Security/isolation result (unknown hostname fail-closed, gateway secret absent from browser, no cross-tenant leakage) — not run against a live URL (all previously verified locally in the Preview Gate report and unchanged by this task's config-only diff)
- Existing ERP/API health — **not affected**: no Render service was touched (no push, no manual dashboard change made by this session); `nibras-api` was not restarted or redeployed by this task
- Screenshots — none taken; there is nothing live to screenshot

## 8. Tests / Build Results

```
storefront/vercel.json  → valid JSON (verified: python3 json.load)
render.yaml             → valid YAML (verified: python3 yaml.safe_load)
```

No application code changed, so the existing `php artisan test` (68 passed, from the Preview Gate report, unaffected by this diff) and `pnpm build` results from the prior report still hold. Not re-run in full for this config-only change, consistent with proportionate verification for a two-file, no-code diff.

## 9. Risks

- **None to existing production systems** — no live service was touched by this session.
- The only live-system risk going forward is entirely in the *manual* steps in §4/§6, which this report intentionally does not execute: adding a Render env var is a config-only change that does not require code redeploy of a different version (Render will restart the existing image with the new env var), so ERP/API downtime risk is minimal but not zero (any env var change on Render triggers a restart of that service).
- Running §5's tinker script against production data is the one step requiring real care — it only *adds* rows to three empty-by-default tables (`storefronts`, `storefront_domains`, and possibly one `sales_channels` row); it does not touch accounting, inventory, or invoice data, matching the task's explicit constraint.

## 10. Remaining Work

1. Safwan (or someone with the relevant access) executes §6 (Vercel project creation + deploy) and §4 (env vars on both platforms).
2. Safwan confirms the safe preview tenant for §5, or authorizes creating a dedicated demo tenant.
3. Run §5's seed script with the real hostname from step 1.
4. Re-run full Arabic/English/security verification against the live URL and update this report (or file a follow-up) with real results and screenshots.
5. Only after that: consider whether an AWJ-controlled subdomain (vs. the Vercel-generated URL) is wanted before sharing more broadly — still a separate, later decision, not part of this task.

## 11. Branch / PR / SHAs

| Field | Value |
|---|---|
| Branch | `claude/storefront-preview-deploy` |
| PR | *(added after opening — see next commit)* |
| Base SHA | `a4b614fd0a893296236fefba2db02e29e65b8c1d` (main) |
| Head SHA | `b605ded6af616b6c420a47a09b6d212afc3b7ef1` |
| Deployment identifier | **None — no deployment occurred** |

## 12. Rollback Procedure

Nothing was deployed, so there is nothing to roll back at runtime. If the repository changes themselves need to be undone:

```bash
git revert <head-sha-of-this-PR>
```

or simply do not merge this PR — `storefront/vercel.json` has no effect until a Vercel project actually references this repo with `storefront/` as its root, and the `render.yaml` addition is `sync: false` (Render will not apply any value until one is manually entered in the dashboard).

## 13. Recommended Next Step

Grant this session (or whichever session continues this work) one of:
- A Vercel API token / project access (via an MCP connector or CLI credentials), **or**
- Direct confirmation that Safwan will personally perform §4/§5/§6 manually using the exact values documented above, then ask for the live URL to be re-verified in a follow-up task.

Either path completes the Preview with zero further repository changes required — this report and its two config files are sufficient.
