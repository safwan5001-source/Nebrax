# MOBILE-PREVIEW-10B-2C — Android-Only Preview Host Startup (Follow-up)

**Scope:** `preview-host/` configuration/startup behavior + tests + CI smoke only. **No deploy, no Railway variable
change, no DNS/domain/TLS change, no signing action, no change to `mobile/` or any backend.**

> **Criterion #10 remains OPEN.** Android physical-device verification can now proceed once the host is deployed and
> reachable; iOS verification is deferred, so the criterion cannot close yet.

## 1. Owner decision

iOS physical-device verification is **deferred** (no Apple Developer Program membership is being purchased now).
Android verification proceeds first. The original #1454 behavior — refuse to start unless **both** `ANDROID_APP_LINK_SHA256_FINGERPRINTS`
and `APPLE_TEAM_ID` are valid — would have made an Android-only deployment impossible without inventing an Apple Team ID,
which is explicitly not allowed.

## 2. New behavior: platform-independent configuration

| Input state | Process | `/health` | `/.well-known/assetlinks.json` | `/.well-known/apple-app-site-association` | `/preview/{ref}` |
|---|---|---|---|---|---|
| Android valid, Apple missing (**current phase**) | starts | 200 | **200** | **503** | 200 |
| Apple valid, Android missing | starts | 200 | 503 | 200 | 200 |
| Both valid | starts | 200 | 200 | 200 | 200 |
| Both missing | starts | 200 | 503 | 503 | 200 |
| Android malformed | starts | 200 | 503 | per Apple input | 200 |
| Apple malformed | starts | 200 | per Android input | 503 | 200 |
| `PORT` invalid | **exits 1** | — | — | — | — |

- `loadConfig()` now returns `errors` (**fatal, process-level — currently only `PORT`**) and `notices` (per-platform: missing or malformed signing input).
- `server.js` exits 1 only on `errors`. For each notice it prints `preview-host: association disabled (503): <VARIABLE> …` to stderr and a one-line
  summary to stdout (`associations android=enabled apple=disabled`). Messages name the variable, **never its value**.
- Route-level fail-closed logic in `app.js` is **unchanged** (already independent per route). A disabled platform answers 503 with a plain-text body — no
  JSON, no placeholder, no echo of the offending input, no redirect, no cookie.
- Why not a stricter rule: a half-configured platform cannot produce a *valid-looking* association (the route is 503), so starting does not create the
  failure mode that motivated fail-on-startup in #1454. The cost of the old rule — blocking the Android proof — was real. The operator signal that was
  lost with exit-on-misconfig is replaced by the startup stderr/stdout lines and the 503s themselves.
- Trade-off to be aware of: a typo in `ANDROID_APP_LINK_SHA256_FINGERPRINTS` no longer fails the deploy; the service goes healthy with `assetlinks` at 503.
  After deploying, check `GET /.well-known/assetlinks.json` returns 200 (and the startup line says `android=enabled`) before testing on a device.

## 3. Unchanged protections

`/preview/[REDACTED]`-only logging with fixed route labels · `Referrer-Policy: no-referrer` · `Cache-Control: no-store` · hash-pinned CSP · no
third-party resources/analytics · no reference echo · no redirects · no cookies. The preview route is behaviorally identical in every configuration
(asserted for all six matrix rows plus process-level log scans in Android-only mode).

## 4. Android input

Runtime variable stays `ANDROID_APP_LINK_SHA256_FINGERPRINTS`; it is supplied only as a Railway variable by the owner. **No fingerprint is committed**
— tests use clearly fake fixture values. `APPLE_TEAM_ID` is not defaulted or invented.

## 5. Files

`preview-host/src/config.js`, `preview-host/src/server.js`, `preview-host/test/{config,routes,logging}.test.js`,
`.github/workflows/preview-host-ci.yml` (image smoke rewritten for the new contract), this report, and a supersession note in the 10B-2A report.
`app.js` is untouched.

## 6. Tests

`cd preview-host && npm test` → 39 tests, 0 failures. New/changed coverage: independent config parsing (missing, empty, malformed, both missing, invalid
`PORT`); a six-row HTTP matrix (association statuses, no association-shaped body on 503, no echoed invalid input, health and preview unaffected);
process-level runs of the real `server.js` (invalid `PORT` exits 1; Android-only serves 200/503/200; no inputs and malformed inputs start; reference and
query never reach stdout/stderr; invalid values never printed). Docker was not available locally; the CI smoke step builds the image and exercises
invalid-`PORT` exit, Android-only, both-configured and nothing-configured containers. The same four scenarios were reproduced locally against `src/server.js`.

## 7. Status

- iOS deferred · Apple route fail-closed (503) until `APPLE_TEAM_ID` exists.
- Remaining operational inputs for Android: set the fingerprint variable on `awj-preview-host`, deploy, attach `preview.awjdev.xyz`, DNS, TLS — each requires separate owner authorization, **none performed**.
- The three placeholder hosts in `mobile/` still need their own reviewed PR (10B Phase 2).
- **Criterion #10: OPEN.**
