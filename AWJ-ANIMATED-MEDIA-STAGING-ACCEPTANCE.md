# AWJ Animated Media — Staging Acceptance (GIF + Animated WebP)

| | |
|---|---|
| Scope | Phase 1 only (animated GIF / animated WebP). Phase 2 **not** started. |
| Merge verified | `a50ce81f3fedcf5c8a700797e19c1275f0df0cea` — *feat(store-builder): support animated GIF and WebP media (#1541)*, squash-merged into `main` (parent `97341a1`, #1542). ✅ ancestor of `origin/main`, which is currently that SHA. |
| Staging environment | **None exists** (see §2). **No deployment, flag change, migration or infrastructure change was made by this task.** |
| Overall outcome | **STOPPED AT A DOCUMENTED TEST PLAN** (as instructed when staging is missing) — plus **two urgent findings** (§1). |
| Recommendation | **NO-GO for production enablement; NO-GO for any limited enablement until §1 is resolved and §4 staging/device checks pass** (§8). |

---

## 1. Urgent findings (read first)

### 1.1 `main` is auto-deploying to the only Railway environment — production — right now
Read-only Railway inspection (`list-services`, `get-service-config`, `list-deployments`, `environment-status`):

- The project **أَوْج AWJ** has **one environment, `production`**. Services: `nibras-api`, `Nebrax`, `storefront`, `awj-preview-host`, `awj-scheduler`, `awj-clamav`, `nibras-db`.
- `nibras-api` (and `Nebrax`) are sourced from `safwan5001-source/Nebrax`, branch **`main`**, `checkSuites: false` (no wait for CI), builder Railpack.
- Deployments for commit **`a50ce81`** were created at **2026-10-16 04:31 UTC**: `storefront` ✅ SUCCESS (online, 1/1 replica), `awj-preview-host` ✅, `awj-scheduler` ✅; **`nibras-api` was DEPLOYING and `Nebrax` BUILDING** at the last check.
- So the Phase 1 code is reaching production by Railway's auto-deploy of `main`, not by anything done in this task. The Phase-1 acceptance report's step 2 (“run the device checklist on staging first”) and step 4 (“deploy with the flag `false` and enable per environment”) were **not** in place when the merge happened.

### 1.2 The animated-media flag does **not** default to disabled
`config/storefront_media.php` (identical on `a50ce81`):

```php
'r2'       => ['enabled' => filter_var(env('STOREFRONT_MEDIA_R2_ENABLED', false), …)],      // default OFF
'animated' => ['enabled' => filter_var(env('STOREFRONT_MEDIA_ANIMATED_ENABLED', true), …)], // default ON
```

- `STOREFRONT_MEDIA_ANIMATED_ENABLED` defaults to **`true`**, and it is **not set** on `nibras-api` (variable-name list below). So the effective value in production is **ON**.
- The only thing keeping animated uploads inert is the *separate, pre-existing* master gate `STOREFRONT_MEDIA_R2_ENABLED` (default `false`; while false, every media-library upload answers `503 storage_not_enabled`). That variable **exists** on production `nibras-api` (alongside `R2_*`, `PRODUCT_MEDIA_R2_ENABLED`, `CATEGORY_MEDIA_R2_ENABLED`) — **its value was deliberately not read** (the tool returns all variable values in plaintext, secrets included).
- **Therefore: if `STOREFRONT_MEDIA_R2_ENABLED=true` in production, merchants can upload animated GIF/WebP as soon as the new `nibras-api` is live, with no device/staging acceptance.** If it is `false`, the feature is dormant behind that gate.

**Needs an owner decision today** (I did not change anything because production configuration changes were out of scope):

| Option | Action | Effect |
|---|---|---|
| **A (recommended, 1 minute)** | In Railway → `nibras-api` → Variables: set `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` (triggers a redeploy; `entrypoint.sh` runs `config:cache`, so a restart is required for any env change) | New animated uploads and retry-regeneration refuse with `animated_not_supported`; static media unaffected |
| **B (durable)** | Small PR: change the code default to `false` (`env('STOREFRONT_MEDIA_ANIMATED_ENABLED', false)`) and update the config comment/tests that assert the default | Makes “disabled by default” true for every environment; needs a PR + review |
| C | Confirm `STOREFRONT_MEDIA_R2_ENABLED` is `false` in production (dashboard) and accept the dormant state | Feature stays inert only while that gate is off |

I recommend **A now, then B**, then follow §6 to enable per environment.

---

## 2. Staging / deployment configuration inspected

| Item | Finding |
|---|---|
| Railway project | `أَوْج AWJ` (`18791e5b-…`), workspace *safwan5001-source's Projects* |
| Environments | **`production` only** → **no staging environment** |
| Services | `nibras-api` (Laravel/Apache, Railpack from `main`, healthcheck `/api/health`, 1 replica `ams`), `Nebrax` (second main-tracking service), `storefront` (Next.js), `awj-preview-host`, `awj-scheduler` (cron), `awj-clamav`, `nibras-db` (Postgres) |
| `nibras-api` variable **names** (values not read) | `APP_*`, `DB_*`, `MAIL_*`, `RESEND_KEY`, `STOREFRONT_GATEWAY_SECRET`, `AWJ_STOREFRONT_BASE_DOMAIN`, `AWJ_TENANT_BASE_DOMAIN`, `AWJ_ATTACHMENTS_R2_ENABLED`, `CATEGORY_MEDIA_R2_ENABLED`, `PRODUCT_MEDIA_R2_ENABLED`, **`STOREFRONT_MEDIA_R2_ENABLED`**, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_REGION`, `R2_USE_PATH_STYLE_ENDPOINT`, `DOCUMENT_*`. **No `STOREFRONT_MEDIA_ANIMATED_ENABLED`.** |
| Repo deploy config | `render.yaml` / `deploy/DEPLOY.md` describe an older Render setup (R2 “deferred”); actual hosting is Railway. No staging workflow in `.github/workflows` (CI only; no deploy jobs). |
| Local/CI substitutes | Laravel tests (SQLite + PostgreSQL in CI), Vitest, Playwright Chromium — no real R2, no Safari. |

**Conclusion:** there is no safe staging to reuse. Creating a Railway environment (own Postgres, R2 test bucket, storefront + API services, domains) is **new infrastructure → needs your approval**; I did not create one. Using production with a canary tenant would be a production change and is **not recommended** until §1 is resolved and device checks exist.

**What staging must look like (for approval):** a cloned Railway environment `staging` with its **own** database (no production data), **own R2 bucket** (test bucket + token scoped to it), `STOREFRONT_MEDIA_R2_ENABLED=true`, `STOREFRONT_MEDIA_ANIMATED_ENABLED=true`, storefront service pointed at the staging API and gateway secret, a staging hostname reachable from a real iPhone, and a throw-away tenant + published storefront.

---

## 3. Evidence available without staging (local/CI, identical bytes)

The animated-media code on `a50ce81` is byte-identical to the verified PR head (`d7e5dac`) for all 11 files checked (parser, media service, config, publish gate, resolver, `MotionPicture`, `HomeSlider`, `SectionBackdrop`, 3 test files). Re-run today on that content:

| Check | Result |
|---|---|
| `StorefrontAnimatedImageTest` + `StorefrontAnimatedMediaTest` | ✅ **68 passed / 480 assertions** (this session) |
| Earlier on the same content: media/storefront sweep | ✅ 363 passed, 1 skipped (round 2) |
| GitHub CI on the PR head (SQLite, **PostgreSQL**, web build, storefront, 2 visual QA) | ✅ 7/7 green |
| Differential fuzz after hardening | ✅ 450k inputs, 0 extra frames |

---

## 4. Acceptance checklist and status

Status key — **PASS** (verified, with evidence) · **FAIL** · **BLOCKED** (cannot be done here; how to complete in last column). “Local” = automated tests/headless Chromium in this sandbox, **not** staging and **not** a physical device.

| # | Check | Staging result | Local/prior evidence | How to complete on staging |
|---|---|---|---|---|
| 1 | Upload an animated **GIF** via the Customizer media library | **BLOCKED** | ✅ PHP feature test (created, original kept, sanitised `animated.gif`, static ladder from frame 1) | In the staging Customizer upload a real GIF (≤5 MB, ≤300 frames, ≤20 s, ≤2560 px, Σpx ≤ 40 M). Expect status `created`, “animated” badge, frames/duration summary. |
| 2 | Upload an animated **WebP** | **BLOCKED** | ✅ same, WebP | Same with a real animated WebP (e.g. from `img2webp`). |
| 3 | Reject malformed/oversized files (truncated, nested ANMF, FF-00 ext, LZW, 251+ frames of 400×400, >5 MB) with stable code and **no** R2 write | **BLOCKED** (R2 real) | ✅ PoC + boundary tests: `rejected`, 0 rows, 0 storage calls | Upload the PoCs from `docs/plans/store/s0-spikes/security/poc/`; confirm the error toast and an **empty** R2 prefix (`aws s3 ls`/dashboard). |
| 4 | Animation **plays** on the published storefront (hero background, slider slide) | **BLOCKED** | ⚠️ Not demonstrable here: headless Chromium never advances animated images (canary self-skips 2 tests) | Open the published page in headed Chrome/Firefox/Safari; the image visibly moves. |
| 5 | **Pause / Play** control (WCAG 2.2.2) | **BLOCKED** | ✅ DOM/unit tests + Chromium test for control presence after hydration | Click pause → frame freezes (still shown); play → resumes; keyboard Enter/Space; label AR/EN. |
| 6 | **Static first-frame fallback** (poster / `<picture>` still) | **BLOCKED** | ✅ tests: ladder built from frame 1, poster decodes at canvas size, GD-decoded at upload | With animation request blocked (DevTools) the hero shows the still, correct crop/size. |
| 7 | **`prefers-reduced-motion`** | **BLOCKED** | ✅ real-Chromium test: still used, no `animated.*` request, no control | OS setting “Reduce motion” on iPhone/macOS → no animated request in Network tab. |
| 8 | **No JavaScript** | **BLOCKED** | ✅ real-Chromium `javaScriptEnabled:false`: still only, 0 animated requests, 0 buttons | Disable JS (DevTools) → still only, no dead control. |
| 9 | **Desktop layout** (1440 px, RTL + LTR, text-over-motion scrim) | **BLOCKED** | ✅ Playwright visual spec + contrast gate tests | Visual check AR and EN; text over animation publishes only with the ≥ required scrim. |
| 10 | **Mobile layout** (390 px, DPR 3) | **BLOCKED** (device) | ⚠️ Chromium emulation only | Real iPhone + Android: no layout shift (CLS), phone art-direction still. |
| 11 | **Tenant isolation** (tenant B cannot read/list/publish tenant A's animated asset; uniform 404) | **BLOCKED** | ✅ `animation is tenant scoped in the workspace api`, `a published animation is served through the gate and never across tenants`, signed-URL tamper test; independent adversarial review | Two staging tenants; request A's `…/customizer/{id}/animated.gif` on B's host and with B's token → 404 identical to a non-existent id. |
| 12 | **Unpublished-asset access** (only published references are served publicly) | **BLOCKED** | ✅ publication-gate tests (unreferenced/draft asset → 404 on the storefront route; workspace signed URL works only for the owner, expires 20 min) | Upload but do **not** publish; `curl -I` the public proxy URL → 404; publish → 200 `image/gif|webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` on the storefront route (workspace signed route: `private, max-age=600`); unpublish → 404 again. |
| 13 | **Real Cloudflare R2 delivery** (PUT original + sanitised + ladder; GET through Laravel + same-origin Next proxy; ETag/304; content-type; size) | **BLOCKED** (no R2 test bucket / credentials) | ⚠️ only a faked R2 in tests; never exercised against real R2 | On staging with a test bucket: upload → list objects (expect `original.*`, `animated.*`, ladder `w480…1920`, thumbs); fetch via storefront; compare bytes to the sanitised file; verify no direct R2 URL is exposed. |
| 14 | **Safari / iPhone** compatibility (playback, pause, Low Power Mode, rotation, reduced motion, WebP animation, GIF) | **BLOCKED** (no devices — **no physical-device claim is made**) | none | Run the device checklist in `AWJ-ANIMATED-MEDIA-PHASE1-ACCEPTANCE-REPORT.md` §3.3 on iPhone (current iOS + one back), Mac Safari, Android Chrome, Firefox. |
| 15 | **40 M total-pixel limit enforced** | **BLOCKED** on staging; **PASS** locally | ✅ config `animated.max_total_pixels = 40,000,000` on `a50ce81`; boundary tests (400×400: 249 ✔, 250 ✔, 251 ✘ `animated_too_heavy`, 300 ✘), 0 rows, 0 storage calls; static limits and other animated bounds pinned unchanged | On staging upload a 400×400×251-frame GIF → `animated_too_heavy`; ×250 → accepted. |
| 16 | **Feature flag defaults to disabled** | **FAIL** | `STOREFRONT_MEDIA_ANIMATED_ENABLED` defaults to **true** in code; unset in production (§1.2). Master gate `STOREFRONT_MEDIA_R2_ENABLED` defaults false | Fix per §1.2 option A/B, then re-verify with `php artisan tinker` → `config('storefront_media.animated.enabled')`. |
| 17 | **Rollback** works (flag off → new uploads refused, retries refused, existing assets keep serving) | **BLOCKED** | ✅ tests: kill switch restores `animated_not_supported`; retry cannot regenerate; no serve-time flag check | §6 rollback drill on staging. |
| 18 | Production runtime parity (GD + libwebp decode of posters, `finfo` mime sniffing, memory) | **BLOCKED** | ✅ CI container has GD/WebP; production Dockerfile (Railpack on Railway) **differs from the repo `Dockerfile`** (build label *Railpack*) — GD/WebP presence on Railway not verified | On staging: upload GIF and WebP; confirm ladder generated; check `php -m` / `gd_info()` in the service shell. |

**Totals:** PASS 0 on staging (no staging) · **FAIL 1** (#16) · **BLOCKED 17** · local PASS evidence for #1–3, 5–9, 11, 12, 15, 17 as listed.

---

## 5. Security and performance findings

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | Phase 1 merged and auto-deployed to production with the flag defaulting **on** and no staging/device acceptance (§1) | **High (process)** | Open — owner decision §1.2 |
| S2 | No real-R2, no real-device and no Safari evidence exists; headless playback is unobservable | High for go-live | Open — §4 #13–14 |
| S3 | Parser hardening done (F1/F2/F4/F5); 40 M budget caps decoded memory at ≈ 160 MB per image (desktop Chromium measured); re-decode CPU on low-RAM browsers unmeasured | Medium → Low | Closed in PR; device validation open |
| S4 | Tenant isolation and publication gating covered by tests + an independent review; **not** exercised against real R2 | Medium | Open until #11–13 on staging |
| S5 | Residual info/low items F6 (bytes inside image-data streams survive), F7, F8 | Low/Info | Documented in the hardening report |
| P1 | `QUEUE_CONNECTION=sync` / single Apache replica: variant generation is inline (bounded to one usage per request); animated uploads decode a poster in-request (≤ ≈ 10 MB GD buffer) | Low | Monitor request time on first uploads |
| P2 | Video/AVIF concerns (Apache worker saturation, buffering proxy) are Phase 2 only — **not** triggered by GIF/WebP, which are small files via the existing proxy | Info | n/a |

---

## 6. Precise enable / rollback procedure

**Gates (both must be true for animated uploads):** `STOREFRONT_MEDIA_R2_ENABLED=true` **and** `STOREFRONT_MEDIA_ANIMATED_ENABLED=true`. Env changes on Railway redeploy the service; `deploy/entrypoint.sh` runs `config:cache`, so *editing the value without a restart has no effect*.

**Before enabling anywhere**
1. Resolve §1.2 (set `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` explicitly in production, or ship option B).
2. Complete §4 on a staging environment, including #13 (R2) and #14 (iPhone Safari).

**Enable on staging (approved environment only)**
1. `nibras-api` variables: `STOREFRONT_MEDIA_R2_ENABLED=true`, `STOREFRONT_MEDIA_ANIMATED_ENABLED=true`, `R2_*` pointing at the **test** bucket. Wait for the redeploy to reach SUCCESS (`/api/health` 200).
2. Verify: `php artisan tinker --execute="dump(config('storefront_media.animated.enabled'), config('storefront_media.animated.max_total_pixels'));"` → `true`, `40000000`.
3. Run §4.

**Limited production enablement (only after §8 conditions)**
1. Keep `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` until the go decision; then set `true` on `nibras-api` only (the storefront needs no flag: it only renders an `animation` field the API emits).
2. Canary: one internal tenant, one hero + one slider slide, GIF then WebP; watch `nibras-api` logs for `animated_*` rejections and request durations for 24 h.
3. Widen only after no incidents.

**Rollback (any environment, < 5 minutes)**
1. Set `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` on `nibras-api`; wait for the redeploy.
2. Effect: new animated uploads → `animated_not_supported`; retry-regeneration of animated assets refused; **already stored/published animated files continue to be served** (no serve-time flag check). To also stop playback for visitors, unpublish or replace the affected sections (the storefront renders the still when `animation` is absent).
3. Deeper rollback: Railway → `nibras-api` → Deployments → redeploy the pre-`a50ce81` deployment (`6250906a…`, commit `97341a1`). No migration or schema change is involved, so this is safe in both directions (old storefront ignores `animation`; old API never emits it).
4. Verify: upload a GIF → rejected `animated_not_supported`; a static JPEG still uploads.

---

## 7. Blocked checks and how to complete them

| Blocker | Needed | Owner action |
|---|---|---|
| No staging environment | Approval to create a Railway `staging` environment (own DB, own R2 test bucket + scoped token, hostname) | Approve infrastructure + provide R2 test bucket credentials |
| No physical iPhone/Android in this sandbox | A person with devices | Run §4 #4–10, #14 and report results; no simulated result will be called device verification |
| Real R2 behaviour of the upload/serve path | Staging with the test bucket | §4 #13 |
| Unknown value of `STOREFRONT_MEDIA_R2_ENABLED` in production | Dashboard read by the owner | Check and tell me (or choose §1.2 A) |
| Railway runtime image (GD/WebP) not verified | Shell on the service | §4 #18 |

---

## 8. Go / no-go for limited enablement

**NO-GO (now).**

Conditions for a *limited* canary to become GO:
1. §1.2 resolved so “off by default” is true, and the production value of `STOREFRONT_MEDIA_R2_ENABLED` is known.
2. A staging environment exists and §4 #1–3, 11–13, 15, 17, 18 pass against **real R2**.
3. §4 #4–10 and #14 pass on **real devices** (iPhone Safari current + previous iOS, Android Chrome, desktop Chrome/Firefox/Safari) — in particular playback, pause/play, Low Power Mode and reduced motion.
4. A canary tenant and the rollback drill (§6) are agreed.

Nothing found so far contradicts the code-level evidence (tests, fuzz, CI green), so the blockers are *process and environment*, not known defects — with the exception of the default-on flag (§4 #16).

---

## 9. Branch / PR / SHAs

- Phase 1 merge SHA (verified): `a50ce81f3fedcf5c8a700797e19c1275f0df0cea` (PR #1541, merged).
- This document is the only change. Because #1541 is merged, the designated branch was restarted from `main`: **`claude/awj-animated-media-support-7kzzga`** (Base SHA `a50ce81f3fedcf5c8a700797e19c1275f0df0cea`); Head SHA and the docs-only PR are given in the hand-off message.
- No merge, deploy, production flag/config change, migration or API change was made; Phase 2 was not started.
