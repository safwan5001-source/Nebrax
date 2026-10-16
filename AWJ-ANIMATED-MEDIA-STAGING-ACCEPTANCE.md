# AWJ Animated Media — Staging Acceptance (GIF + Animated WebP)

| | |
|---|---|
| Scope | Phase 1 only (animated GIF / animated WebP). Phase 2 **not** started. |
| Merge verified | `a50ce81f3fedcf5c8a700797e19c1275f0df0cea` — *feat(store-builder): support animated GIF and WebP media (#1541)*, squash-merged into `main` (parent `97341a1`, #1542). ✅ ancestor of `origin/main`, which is currently that SHA. |
| Staging environment | **None exists** (see §2). **No deployment, flag change, migration or infrastructure change was made by this task.** |
| Overall outcome | **STOPPED AT A DOCUMENTED TEST PLAN** (no staging environment) — plus the findings in §1. **Updated after owner-reported production checks — see §0.** |
| Recommendation | **Superseded by §0/§8:** the owner has since enabled the flag in production and reported a GIF end-to-end check on an iPhone. Treat production as a *limited, owner-supervised canary*; do **not** widen until animated WebP and the remaining checks in §4 pass. |

---

## 0. Update — status after owner-reported production checks (supersedes the “now/NO-GO” wording below)

**Evidence classes used in this document:** *Verified here* = I ran it or read it from the repo/Railway (read-only). *Owner-reported* = stated by the owner, **not independently verified in this session**. *Not verified* = nobody has evidence.

| Fact | Class | Detail |
|---|---|---|
| Phase 1 is merged: `a50ce81f3fedcf5c8a700797e19c1275f0df0cea` | Verified here | ancestor of `origin/main`. |
| `STOREFRONT_MEDIA_ANIMATED_ENABLED` now **exists** on production `nibras-api` | Verified here (variable **name only**; value deliberately not read) | It was absent when §1.2 was written. |
| The flag is **enabled** on Railway | Owner-reported | consistent with the variable now existing. |
| GIF upload, storefront playback, pause and resume work on a **real iPhone** | Owner-reported | browser/iOS version not stated, so this is *not* recorded as “iPhone Safari” and does not close the multi-version Safari item. |
| Animated **WebP** has not been manually verified | Owner-reported | open. |
| Canvas showed no animation or control while the storefront did | Verified here (code) | explained and addressed in `AWJ-ANIMATED-MEDIA-CANVAS-PARITY-REPORT.md`. |

Consequences for this document: §1.1 (auto-deploy) and §1.2 (flag defaulting on, unset) are **historical** — the deployment happened and the flag is now explicitly set. The code default is **still `true`** (§4 #16 stays FAIL as a *default*); that risk now only matters for a new environment (e.g. the future staging) and for any environment where the variable is accidentally unset. Option B in §1.2 (default `false`) remains the durable fix and is **not** done.

---

## 1. Urgent findings (read first) — *historical, see §0*

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
| 1 | Upload an animated **GIF** via the Customizer media library | **PASS (owner-reported, production)**; staging **BLOCKED** | ✅ PHP feature test (created, original kept, sanitised `animated.gif`, static ladder from frame 1) | In the staging Customizer upload a real GIF (≤5 MB, ≤300 frames, ≤20 s, ≤2560 px, Σpx ≤ 40 M). Expect status `created`, “animated” badge, frames/duration summary. |
| 2 | Upload an animated **WebP** | **NOT VERIFIED** (owner: not yet tested) — **next action** | ✅ same, WebP | Same with a real animated WebP (e.g. from `img2webp`). |
| 3 | Reject malformed/oversized files (truncated, nested ANMF, FF-00 ext, LZW, 251+ frames of 400×400, >5 MB) with stable code and **no** R2 write | **BLOCKED** (R2 real) | ✅ PoC + boundary tests: `rejected`, 0 rows, 0 storage calls | Upload the PoCs from `docs/plans/store/s0-spikes/security/poc/`; confirm the error toast and an **empty** R2 prefix (`aws s3 ls`/dashboard). |
| 4 | Animation **plays** on the published storefront (hero background, slider slide) | **GIF: PASS (owner-reported, real iPhone)**; WebP **NOT VERIFIED**; desktop browsers **BLOCKED** | ⚠️ Not demonstrable here: headless Chromium never advances animated images (canary self-skips 2 tests) | Open the published page in headed Chrome/Firefox/Safari; the image visibly moves. |
| 5 | **Pause / Play** control (WCAG 2.2.2) | **GIF: PASS (owner-reported, real iPhone: pause and resume)**; WebP / keyboard / AR+EN labels on device **NOT VERIFIED** | ✅ DOM/unit tests + Chromium test for control presence after hydration | Click pause → frame freezes (still shown); play → resumes; keyboard Enter/Space; label AR/EN. |
| 6 | **Static first-frame fallback** (poster / `<picture>` still) | **BLOCKED** | ✅ tests: ladder built from frame 1, poster decodes at canvas size, GD-decoded at upload | With animation request blocked (DevTools) the hero shows the still, correct crop/size. |
| 7 | **`prefers-reduced-motion`** | **BLOCKED** | ✅ real-Chromium test: still used, no `animated.*` request, no control | OS setting “Reduce motion” on iPhone/macOS → no animated request in Network tab. |
| 8 | **No JavaScript** | **BLOCKED** | ✅ real-Chromium `javaScriptEnabled:false`: still only, 0 animated requests, 0 buttons | Disable JS (DevTools) → still only, no dead control. |
| 9 | **Desktop layout** (1440 px, RTL + LTR, text-over-motion scrim) | **BLOCKED** | ✅ Playwright visual spec + contrast gate tests | Visual check AR and EN; text over animation publishes only with the ≥ required scrim. |
| 10 | **Mobile layout** (390 px, DPR 3) | **BLOCKED** (device) | ⚠️ Chromium emulation only | Real iPhone + Android: no layout shift (CLS), phone art-direction still. |
| 11 | **Tenant isolation** (tenant B cannot read/list/publish tenant A's animated asset; uniform 404) | **BLOCKED** | ✅ `animation is tenant scoped in the workspace api`, `a published animation is served through the gate and never across tenants`, signed-URL tamper test; independent adversarial review | Two staging tenants; request A's `…/customizer/{id}/animated.gif` on B's host and with B's token → 404 identical to a non-existent id. |
| 12 | **Unpublished-asset access** (only published references are served publicly) | **BLOCKED** | ✅ publication-gate tests (unreferenced/draft asset → 404 on the storefront route; workspace signed URL works only for the owner, expires 20 min) | Upload but do **not** publish; `curl -I` the public proxy URL → 404; publish → 200 `image/gif|webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` on the storefront route (workspace signed route: `private, max-age=600`); unpublish → 404 again. |
| 13 | **Real Cloudflare R2 delivery** (PUT original + sanitised + ladder; GET through Laravel + same-origin Next proxy; ETag/304; content-type; size) | **PARTIAL — indirect, owner-reported:** a GIF uploaded and played end-to-end in production, which exercises the real R2 write and the proxy read for that asset. Object layout, headers, ETag/304 and the rejection-writes-nothing check are **NOT VERIFIED** | ⚠️ only a faked R2 in tests; never exercised against real R2 | On staging with a test bucket: upload → list objects (expect `original.*`, `animated.*`, ladder `w480…1920`, thumbs); fetch via storefront; compare bytes to the sanitised file; verify no direct R2 URL is exposed. |
| 14 | **Safari / iPhone** compatibility (playback, pause, Low Power Mode, rotation, reduced motion, WebP animation, GIF) | **PARTIAL — owner-reported only:** GIF playback + pause/resume on one real iPhone (OS/browser not recorded). Not verified: WebP, Low Power Mode, rotation, reduced motion, a second iOS version, Mac Safari, Android, Firefox. I did not test any device. | none | Run the device checklist in `AWJ-ANIMATED-MEDIA-PHASE1-ACCEPTANCE-REPORT.md` §3.3 on iPhone (current iOS + one back), Mac Safari, Android Chrome, Firefox. |
| 15 | **40 M total-pixel limit enforced** | **BLOCKED** on staging; **PASS** locally | ✅ config `animated.max_total_pixels = 40,000,000` on `a50ce81`; boundary tests (400×400: 249 ✔, 250 ✔, 251 ✘ `animated_too_heavy`, 300 ✘), 0 rows, 0 storage calls; static limits and other animated bounds pinned unchanged | On staging upload a 400×400×251-frame GIF → `animated_too_heavy`; ×250 → accepted. |
| 16 | **Feature flag defaults to disabled** | **FAIL (default)** — production is now **explicitly enabled** (variable present; owner-reported on) | `STOREFRONT_MEDIA_ANIMATED_ENABLED` still defaults to **true** in code. Master gate `STOREFRONT_MEDIA_R2_ENABLED` defaults false | Fix per §1.2 option A/B, then re-verify with `php artisan tinker` → `config('storefront_media.animated.enabled')`. |
| 17 | **Rollback** works (flag off → new uploads refused, retries refused, existing assets keep serving) | **BLOCKED** | ✅ tests: kill switch restores `animated_not_supported`; retry cannot regenerate; no serve-time flag check | §6 rollback drill on staging. |
| 18 | Production runtime parity (GD + libwebp decode of posters, `finfo` mime sniffing, memory) | **BLOCKED** | ✅ CI container has GD/WebP; production Dockerfile (Railpack on Railway) **differs from the repo `Dockerfile`** (build label *Railpack*) — GD/WebP presence on Railway not verified | On staging: upload GIF and WebP; confirm ladder generated; check `php -m` / `gd_info()` in the service shell. |

**Totals (updated):** staging checks: none run (no staging). Production, owner-reported: **#1, #4, #5 PASS for GIF**, #13/#14 partial. **FAIL 1** (#16, default). **Not verified:** #2 and every WebP-specific check. Everything else remains **BLOCKED**. Local PASS evidence for #3, 6–9, 11, 12, 15, 17 is unchanged.

---

## 5. Security and performance findings

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | Phase 1 merged and auto-deployed to production before staging/device acceptance (§1, historical). The owner has since enabled the flag explicitly (§0) | Medium (process) | Mitigated by supervised canary; code default still `true` (option B open) |
| S2 | Real-R2 and real-device evidence is now **owner-reported for GIF only** (one iPhone); nothing for WebP, other devices, Safari versions, Low Power Mode or reduced motion; headless playback is unobservable here | Medium–High for wide rollout | Open — §4 #2, #13–14 |
| S2b | Canvas (editor preview) did not mirror animated media or its pause/play control; a lone animated slide on the storefront had no pause control (WCAG 2.2.2) | Medium (parity / a11y) | Fixed in PR #1547 code — see `AWJ-ANIMATED-MEDIA-CANVAS-PARITY-REPORT.md` |
| S3 | Parser hardening done (F1/F2/F4/F5); 40 M budget caps decoded memory at ≈ 160 MB per image (desktop Chromium measured); re-decode CPU on low-RAM browsers unmeasured | Medium → Low | Closed in PR; device validation open |
| S4 | Tenant isolation and publication gating covered by tests + an independent review; **not** exercised against real R2 | Medium | Open until #11–13 on staging |
| S5 | Residual info/low items F6 (bytes inside image-data streams survive), F7, F8 | Low/Info | Documented in the hardening report |
| P1 | `QUEUE_CONNECTION=sync` / single Apache replica: variant generation is inline (bounded to one usage per request); animated uploads decode a poster in-request (≤ ≈ 10 MB GD buffer) | Low | Monitor request time on first uploads |
| P2 | Video/AVIF concerns (Apache worker saturation, buffering proxy) are Phase 2 only — **not** triggered by GIF/WebP, which are small files via the existing proxy | Info | n/a |

---

## 6. Precise enable / rollback procedure

**Gates (both must be true for animated uploads):** `STOREFRONT_MEDIA_R2_ENABLED=true` **and** `STOREFRONT_MEDIA_ANIMATED_ENABLED=true`. Env changes on Railway redeploy the service; `deploy/entrypoint.sh` runs `config:cache`, so *editing the value without a restart has no effect*.

**Before enabling anywhere new** (the production flag is already on — §0)
1. Make the safe default real: set the variable explicitly in every environment, or ship option B (code default `false`).
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
| No physical device in this sandbox | A person with devices | Owner reported GIF on one iPhone (§0). Still needed: animated WebP, a second iOS version, Low Power Mode, rotation, reduced motion, Android/desktop browsers (§4 #2, #4–10, #14). No simulated result will be called device verification |
| Real R2 behaviour of the upload/serve path | Staging with the test bucket | §4 #13 |
| Unknown value of `STOREFRONT_MEDIA_R2_ENABLED` in production | Dashboard read by the owner | Implied `true` by the owner-reported end-to-end GIF; not read by me |
| Railway runtime image (GD/WebP) not verified | Shell on the service | §4 #18 |

---

## 8. Go / no-go for limited enablement

**Updated:** the owner has already enabled the flag in production and verified GIF on one iPhone, so “limited enablement” is a *fact*, not a proposal. **Recommendation: keep it a supervised canary (internal/owner tenants only); do not announce or widen until animated WebP and the conditions below are met.**

*Original assessment (before the owner's production checks):* **NO-GO.**

Conditions for widening beyond the canary:
1. §1.2 resolved so “off by default” is true, and the production value of `STOREFRONT_MEDIA_R2_ENABLED` is known.
2. A staging environment exists and §4 #1–3, 11–13, 15, 17, 18 pass against **real R2**.
3. §4 #4–10 and #14 pass on **real devices** (iPhone Safari current + previous iOS, Android Chrome, desktop Chrome/Firefox/Safari) — in particular playback, pause/play, Low Power Mode and reduced motion.
4. A canary tenant and the rollback drill (§6) are agreed.

Nothing found so far contradicts the code-level evidence (tests, fuzz, CI green), so the blockers are *process and environment*, not known defects — with the exception of the default-on flag (§4 #16).

---

## 9. Branch / PR / SHAs

- Phase 1 merge SHA (verified): `a50ce81f3fedcf5c8a700797e19c1275f0df0cea` (PR #1541, merged).
- Because #1541 is merged, the designated branch was restarted from `main`: **`claude/awj-animated-media-support-7kzzga`**, PR **#1547**, Base SHA `a50ce81f3fedcf5c8a700797e19c1275f0df0cea` (later merged with `main` for #1546). The PR first carried this document only; it now also carries the Canvas/storefront parity fix (`AWJ-ANIMATED-MEDIA-CANVAS-PARITY-REPORT.md`). Head SHA: see that report.
- This task made no merge, deploy, production flag/config change, migration or API change; Phase 2 was not started.
