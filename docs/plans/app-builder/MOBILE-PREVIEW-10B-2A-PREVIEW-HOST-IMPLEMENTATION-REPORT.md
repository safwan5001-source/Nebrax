# MOBILE-PREVIEW-10B-2A — Preview Host Service: Implementation Report

**Scope:** implementation + tests + PR only. **Nothing was deployed, no DNS or domain was touched, no Railway variable was set, no signing action was taken.**

> **Criterion #10 remains OPEN.** `preview.awjdev.xyz` is not resolvable, has no TLS, and serves
> nothing; `assetlinks.json` and the AASA are **not live**. No physical-device verification happened.

## 1. Architecture

A separate service in `preview-host/`: Node 22, `node:http`, **zero npm dependencies** (no install step, no
lockfile, nothing fetched at build time). Not routed through the ERP web app, the storefront, or the Laravel
`nibras-api`.

Rationale: the repo's existing services are Next.js (`web/`, `storefront/`) and Laravel; both bring session/tenant
middleware, analytics hooks and request logging that this URL must not touch. Three static-ish routes do not justify
a framework, and a framework's default access log would record the full `/preview/{reference}` path. With bare
`node:http` there is no default request logging at all, so the log boundary is entirely code we own.

## 2. Files added / changed

| Path | Role |
|---|---|
| `preview-host/src/config.js` | env parsing + validation (fail-closed inputs) |
| `preview-host/src/associations.js` | pure builders for `assetlinks.json` and AASA |
| `preview-host/src/fallback-page.js` | constant Arabic fallback HTML + hash-pinned CSP |
| `preview-host/src/app.js` | routing, headers, redacting log (`createApp`) |
| `preview-host/src/server.js` | entry point; exits 1 on bad config |
| `preview-host/test/*.test.js` | 25 tests (config, routes, preview, logging, process-level) |
| `preview-host/Dockerfile`, `.dockerignore`, `README.md`, `package.json` | packaging |
| `.github/workflows/preview-host-ci.yml` | tests + Docker build + container smoke |
| `.github/ci-gate/required-checks.json`, `scripts/ci-gate/test_ci_gate.py` | register the new path-scoped check (expected-count assertion 9 → 10) |

No change to `mobile/`, `nibras-api`/Laravel, `web/`, `storefront/`, migrations, contracts, RBAC or tenancy.

## 3. Routes

| Route | Behaviour |
|---|---|
| `GET /health` | 200 `{"status":"ok"}`; no DB, no config values |
| `GET /.well-known/assetlinks.json` | 200 `application/json`; package `com.example.awjmobileruntimeproof`; fingerprints from env; **503** if not configured |
| `GET /.well-known/apple-app-site-association` | 200 `application/json`, no extension; `appIDs: ["<TEAM>.com.example.awjMobileRuntimeProof"]`, `apps: []`, `components: [{"/": "/preview/*"}]`; **503** if not configured |
| `GET /preview/{reference}` | 200 static generic page (title *معاينة أَوْج على الجوال*). Reference `^[A-Za-z0-9]{1,128}$` (mirrors the Flutter resolver). Never calls the backend; no state is exposed |
| malformed `/preview/…` / unknown path | **404** with the *same* generic page and headers; the path is never echoed. The status reveals only that the path cannot be a reference, never reference state |
| any other method | 405 (`Allow: GET, HEAD`); `HEAD` supported |

No redirects exist anywhere (trailing-slash and `.json` variants of the AASA are plain 404s). No cookies are ever set.
Paths are matched on the raw URL — nothing is percent-decoded or normalised; the query string is discarded.

## 4. Security headers

`/preview/*` and the generic 404: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
(inline stylesheet pinned by hash — no `'unsafe-inline'`, no script source at all), `X-Frame-Options: DENY`,
`X-Robots-Tag: noindex, nofollow`; page also carries `<meta name="referrer" content="no-referrer">` as defence in depth.
`Pragma: no-cache` was left out: `no-store` already covers every HTTP/1.1 intermediary and it adds nothing here.

Association files: `Content-Type: application/json`, `Cache-Control: public, max-age=300`, `X-Content-Type-Options: nosniff`
only — deliberately no CSP/frame headers that could interfere with the OS verification crawlers. The page has no
scripts, images, fonts, links, forms, or any `http(s)://` URL (asserted by tests).

## 5. Logging

- `node:http` has **no default request logging**; the app writes one line per request itself.
- Format `METHOD LABEL STATUS`, where LABEL is a **fixed route label chosen by the code**, not derived from the URL:
  `GET /preview/[REDACTED] 200`, `GET /health 200`, `GET [UNMATCHED] 404`. Path, query, headers, client IP and
  user agent are never logged, so a reference placed anywhere in a URL cannot reach the log.
- Errors log the error class name only (messages/stacks could embed request data). Config errors name the variable,
  never its value.
- Verified by in-process tests and by a test that runs the real `server.js` and scans its stdout/stderr.

**Not controlled by this repo:** Railway's edge/proxy and HTTP logs record request paths before traffic reaches this
process. They are **not** redacted by this service, and this PR does not claim otherwise. The fallback case (app not
installed / link unverified) is the only time a reference crosses the network; its exposure in platform logs, and the
retention/redaction options Railway offers, remain an operational item for the owner (see §8). The reference is also
one-time and 5-minute TTL on the backend, which bounds the impact.

## 6. Runtime configuration

| Variable | Required | Notes |
|---|---|---|
| `PORT` | no (default 3000) | Railway injects it |
| `ANDROID_APP_LINK_SHA256_FINGERPRINTS` | **yes** | one or more SHA-256 cert fingerprints (32 colon-separated hex bytes), separated by comma/whitespace; case-normalised, de-duplicated |
| `APPLE_TEAM_ID` | **yes** | 10 alphanumeric characters |

No secrets, DB, Redis, R2 or backend credentials. `PREVIEW_HOST` is not needed by this service (it serves whatever
host reaches it) and was not introduced.

> **Superseded by `MOBILE-PREVIEW-10B-2C-ANDROID-ONLY-HOST-FOLLOWUP.md`:** startup is no longer fatal for a missing/malformed
> platform input; each association route fails closed (503) independently. The paragraph below describes the original #1454 behavior.

**Fail-closed decision:** `server.js` **refuses to start (exit 1)** if either input is missing or malformed, printing the
variable name only. A deployed-but-healthy-looking service with unusable association files is the worse failure mode;
Railway keeps the previous deployment instead. Defence in depth: `createApp` itself answers `503` (no body resembling an
association) for any association route whose input is absent. Placeholders are never emitted. Format validation cannot
detect a *wrong but well-formed* fingerprint/Team ID — that stays an operator responsibility.

## 7. Tests

`cd preview-host && npm test` → 25 tests, 0 failures: health; assetlinks (shape, multi-fingerprint, JSON, no redirect/cookie,
determinism); AASA (shape, scope, no `.json`/trailing-slash variants); missing/malformed Android and Apple inputs;
method handling/HEAD; fallback page (headers, no echo of reference or query, identical body for different references,
no third-party content, 128/129-char boundary, encoded/dotted/extra-segment references); log redaction; process-level
fail-closed start and stdout/stderr leak scan. `scripts/ci-gate` self-tests still pass (72/72).

A Docker image build and container smoke run is part of `preview-host-ci.yml` (no Docker daemon was available in the
authoring session, so the image itself was first exercised there; the image contents were simulated locally by copying
exactly `package.json` + `src/`).

## 8. Railway deployment requirements (not performed)

For the existing `awj-preview-host` service, when the owner authorises it:

1. Source: this repository; **Root Directory `preview-host`** (Dockerfile auto-detected; start command comes from the image).
   `railway.json` is intentionally not provided — Railway has deprecated Config as Code and new services cannot opt in.
2. Health check path: `/health`.
3. Variables: `ANDROID_APP_LINK_SHA256_FINGERPRINTS`, `APPLE_TEAM_ID` (`PORT` is injected).
4. Then, each its own authorised step: domain attachment for `preview.awjdev.xyz`, DNS record, TLS issuance.

## 9. Known operational gaps

- Android signing fingerprint of the exact keystore that signs the test APK — **not available** (debug keystore is per-build-machine).
- Apple Developer Team ID — **not available** (`DEVELOPMENT_TEAM` absent from the project).
- The three placeholder hosts in `mobile/` (`preview.awj-runtime-proof.example`) still need their own reviewed PR (10B Phase 2); untouched here.
- Railway proxy/edge log retention of `/preview/{reference}` — not controllable from this repo.
- Store badges mentioned in 10A §10 are deliberately **not** included: any store link would be a third-party URL and risks
  carrying the reference; the page is generic text only, per this task's brief.

## 10. Explicit status

- DNS **not** configured · TLS/domain **not** attached · `assetlinks.json`/AASA **not live** · **no deploy performed**.
- **Criterion #10 remains OPEN.**
