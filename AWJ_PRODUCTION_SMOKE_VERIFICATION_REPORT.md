# AWJ — Production Smoke Verification Report

| | |
|---|---|
| Date / window | 2026-10-13, ~18:25–18:55 UTC (Railway project «أَوْج AWJ», env `production`) |
| Repository | `safwan5001-source/Nebrax` |
| Branch (investigation) | `claude/awj-production-smoke-verify-0kzcn3` |
| Base SHA = Head SHA | `be3a7aac2353565d9f2beb5d9e2bb3b34bdd28e8` (= `origin/main`, PR #1389 merge) |
| Mode | Read-only. No production writes, config changes, migrations, merges or deploys. No credentials used. |

## 1. Summary

**Verdict: PASS (with two low-severity observations).**

- All 6 Railway services are healthy on the post-#1389 deployments.
- The reported `/store/v1/{storefront,categories,products,cart}` 404s are **expected behavior**, not a defect: the routes exist, but are authoritatively **Host-resolved**; a request whose Host is `nibras-api-production.up.railway.app` has no storefront domain, so the backend deliberately returns a non-revealing 404.
- PR #1389 is CI-only (`.github/workflows/ci.yml` + a report; +151/−1, 2 files) and cannot have changed runtime routing.
- No 5xx from real traffic; auth boundaries behave as expected.

## 2. Service results

| Service | Deployment (created UTC) | Status | Notes |
|---|---|---|---|
| Nebrax (web) | 3145172f, 18:34:11 | SUCCESS, 1/1 online | An earlier deploy 5c590f9d (12:15) FAILED at build: `frontend grpc server closed unexpectedly` — Railway builder infra error, superseded by successful deploy |
| nibras-api | dea3a134, 18:34:11 | SUCCESS, 1/1 online | |
| storefront | 288f1ce5, 18:34:11 | SUCCESS, 1/1 online | Log: `NEXT_PUBLIC_SITE_URL is not set — email links will be broken` (see §6) |
| awj-scheduler | ac00b29c, 18:34:11 | SUCCESS | Last cron run 18:50:06 succeeded |
| awj-clamav | 642d1197, 10-12 | SUCCESS, online | |
| nibras-db (PostgreSQL) | 32bef937, 09-02 | SUCCESS, online | |

## 3. Endpoint checks (anonymous GET/POST-empty only)

| Check | Result |
|---|---|
| `GET nibras-api/api/health` | **200** `{"status":"ok"}` (0.53s) |
| `https://awj.up.railway.app/`, `https://awjdev.xyz/` (web) | **200**, Arabic RTL Next.js shell |
| `https://storefront-production-2266.up.railway.app/` | **307 → /sa/ar**, `/sa/ar` **200** |
| `GET /api/me`, `/api/invoices` with `Accept: application/json` | **401** `Unauthenticated.` — no data exposed |
| `POST /api/login` with empty body | **422** validation errors (no credentials sent) |
| `GET /store/v1/storefront` on API host | **404** JSON `{"error":{"code":"not_found",…"تعذّر تحديد متجر صالح"}}` |
| `GET /api/store/v1/storefront` | 404 (wrong prefix — route is not under `/api`) |
| `GET /api/platform/dashboard` | 404 (path not registered; not further probed — platform auth surface not in scope) |

DB connectivity is evidenced indirectly: authenticated production traffic at 17:57–18:30 (`/api/me`, commerce workspace, app-builder, document-batches) returned 200/201 with 40–170 ms latency, and `/api/health` is OK.

## 4. Analysis of the reported 404s

| Route | Exists? | Expected vs actual |
|---|---|---|
| `GET /store/v1/storefront` | Yes — `routes/api_storefront.php:66` | Expected 404 when Host unresolved; actual 404 |
| `GET /store/v1/categories` | Yes — line 41 | same |
| `GET /store/v1/products` | Yes — line 49 | same |
| `GET /store/v1/cart` | Yes — line 79 | same |

**Mechanism.** `StorefrontApiServiceProvider` mounts `routes/api_storefront.php` under prefix `store/v1` (not `/api/store/v1`). Every route passes `ResolveStorefrontDomain`, which resolves tenant/storefront/channel **only from the Host** (or from `X-Storefront-Forwarded-Host` when accompanied by the matching `STOREFRONT_GATEWAY_SECRET`), and returns a non-revealing 404 on any failure. The API's own Railway hostname is not a registered storefront domain, hence 404 — reproduced with a single anonymous GET (response body above).

**Who sent them (HTTP log, nibras-api, 2026-10-13):** 18:40:04–18:40:43 UTC, ~38 requests, UA `node`, multiple AWS source IPs (3.81.4.196, 44.197.171.101, 54.227.2.192, 54.183.13.146, 65.2.37.56), repeating the set storefront → categories → products → cart per page render. That pattern matches a Next.js server render of a storefront page calling the API **without a resolvable Host/forwarded-host**. It started ~6 min after the 18:34 deploy.
- It was **not** the Railway `storefront` service: that service's HTTP log is empty for 18:38–18:45, and the Railway storefront reaches the API through `AWJ_COMMERCE_API_URL` + forwarded-host/secret.
- Not a real shopper journey: the storefront at `*.store.awjdev.xyz` and `storefront-production-2266` serves 200s.
- Candidate callers (**unconfirmed**): a Vercel-hosted storefront (`storefront/vercel.json` enables main/preview deployments; Vercel egresses from AWS) or an external synthetic/e2e job, pointed at the raw API URL with a missing/mismatched gateway secret. Source cannot be identified from Railway logs alone.

**Predates #1389?** Yes. `/store/v1/storefront` shows 4xx in the 7-day series on 10-06 through 10-13 (26 4xx of 581 requests; 555 2xx), including days before today's merge. #1389 contains no runtime code. The 18:40 burst is the largest, but its timing follows the redeploy, not a code change.

**Environment config.** `storefront` service variables present (names only): `AWJ_COMMERCE_API_URL`, `STOREFRONT_GATEWAY_SECRET`, `NEXT_PUBLIC_DEFAULT_COUNTRY`, `NEXT_PUBLIC_DEFAULT_LOCALE`. Values were deliberately not read. No evidence of an outdated API URL on Railway; the 200 responses at storefront-production-2266 indicate the current wiring works.

## 5. Security and tenant isolation

- Protected routes reject anonymous requests with 401; login validates input (422). No tenant data returned to any anonymous call.
- Unresolvable storefront Host → uniform, non-revealing 404 (by design; avoids tenant/domain enumeration).
- 7-day window: 14,317 requests (13,574 2xx / 723 4xx / 2 5xx). Last 24 h: 2,533 requests, **0 5xx**, 181 4xx.
- **Disclosure about my own probes:** two anonymous requests I sent *without* `Accept: application/json` (`/api/me`, `/api/invoices`) returned **HTTP 500**, logged at 18:51:20 as `Route [login] not defined` (`Authenticate` middleware tries to redirect guests to `route('login')`). These 2 errors are mine, not real traffic; they are the only 5xx in the current deployment's error log. With `Accept: application/json` (what the SPA/API clients send) the response is a correct 401. No data is exposed, but see risk R1.

## 6. Risks and unresolved questions

| # | Severity | Item |
|---|---|---|
| R1 | Low | Authenticated `/api/*` routes return 500 (not 401) to anonymous clients that omit `Accept: application/json`, because no `login` route exists. Scanners/health probes hitting such routes will inflate 5xx. Smallest fix: in `bootstrap/app.php`, `$middleware->redirectGuestsTo(fn () => null)` / `shouldRenderJsonWhen(fn ($r) => $r->is('api/*'))`. Not applied. |
| R2 | Low | `storefront` logs `NEXT_PUBLIC_SITE_URL is not set — email links will be broken`. Set it in Railway (needs approval) if storefront emails are in use. |
| R3 | Info | Unknown origin of the 18:40 `node` bursts (see §4). If a Vercel/e2e storefront is meant to be live, its `AWJ_COMMERCE_API_URL`/`STOREFRONT_GATEWAY_SECRET` or forwarded host is misconfigured; if not intended, no action. Needs owner to say whether a Vercel storefront exists. |
| R4 | Info | Earlier `/api/company-browser-identity` 404 (18:26, UA `node`) and historic 4xx not individually triaged beyond the above. |
| R5 | Info | Scope limits: no authenticated flows, no write-path, no ZATCA/payments exercised (by instruction). DB health inferred from app responses, not a direct query. |

## 7. Final verdict

**PASS.** Services healthy; the 404s are by-design Host-resolution responses, pre-date PR #1389, and do not affect real user journeys. No fix required for the 404s.

## 8. Recommended next action

1. Confirm whether a Vercel (or other external) storefront targets `nibras-api-production.up.railway.app`; if yes, align its API URL / gateway secret / forwarded host; if no, treat the 404s as scanner/CI noise and optionally filter them from alerting.
2. Optionally ship R1 (JSON-guest handling) as a separate small change, and set `NEXT_PUBLIC_SITE_URL` (R2) — each with explicit approval.
3. Re-check the Nebrax 12:15 build failure only if it recurs (infra-class error; later build succeeded).
