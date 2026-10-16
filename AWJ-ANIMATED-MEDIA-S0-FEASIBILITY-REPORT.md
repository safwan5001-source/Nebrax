# AWJ Animated Media — S0 Feasibility Report (Phase 2: AVIF · MP4 · WebM)

| | |
|---|---|
| Branch | `claude/awj-animated-media-support-7kzzga` |
| PR | #1541 — **open, not merged** |
| Scope | S0 feasibility only. No production Dockerfile, config, schema, or deploy change. No migration. |
| Spike material | `docs/plans/store/s0-spikes/{avif,r2-range,video,streaming,security}/` (non-production, self-contained) |
| Raw run output | scratchpad (`…/scratchpad/s0/compat/`), not in repo; summarised numbers are in `results/` files in the repo |

**Rule applied throughout:** nothing below is claimed as real-device verification unless a real device ran it. Headless desktop browsers and S3 look-alikes are labelled as such.

---

## 1. Executive summary

| # | Spike | Result | Go / No-go |
|---|---|---|---|
| S0-A | AVIF first-frame decode + runtime | **PASS (conditional)** | **GO** for static + animated-AVIF *first-frame* via GD/libavif, **provided** a header-dimension check precedes any decode (bomb: a 1 KB file OOM-kills the worker). Animated AVIF *playback* in browsers is **not proven** here. |
| S0-B | R2 HTTP Range | **BLOCKED** (no R2 credentials) | Contract proven on two independent S3 implementations; R2 itself unverified. Owner-runnable probe supplied. |
| S0-C | Safari / iOS requirements | **BLOCKED** (no devices) | Nothing claimed. Device harness supplied. |
| S0-D | MP4 / WebM compatibility | **PASS** (desktop Chromium/Chrome/Firefox, *headless*); **BLOCKED** for Safari/iOS/Android | MP4 (H.264/AAC) **GO**. WebM stays **DEFERRED** (as the owner decided). |
| S0-E | Streaming + Apache saturation | **FAIL for the "Laravel/Apache is the byte path" design at scale; PASS for Next streaming proxy** | **NO-GO** for serving video bytes through the shared Apache prefork pool. **GO** for a streaming (non-buffering) Next proxy. Detail in §7. |
| — | Hosting topology | **VERIFIED** (Railway, repo files) | Single replica each; see §8. |
| — | Security review of `StorefrontAnimatedImage.php` | **4 findings need action before Phase 1 merge** (F1, F2, F4 + a policy call on F3) | **CONDITIONAL GO** for merge after fixes. High-severity: none. |
| — | Dev page inaccessible in production | **PASS (content) / known soft-404 (status)** | See §10. |

**Recommended next action:** approve (a) a small hardening commit on PR #1541 for F1/F2/F4/F5 (+ decision on F3), and (b) a Phase 2 MVP of **AVIF + MP4 (H.264/AAC) with merchant poster**, with video bytes served by a path that is **not** the shared Apache pool. WebM stays deferred.

---

## 2. S0-A — AVIF first-frame decoding + runtime

**Environment:** `php:8.3-apache` (Debian trixie, PHP 8.3.35). Baseline = production Dockerfile's GD flags. Spike image = same + `libavif-dev` + `--with-avif` (`avif/Dockerfile.avif`). Production `Dockerfile` **untouched**.

| Check | Baseline GD | GD + libavif 1.2.1 |
|---|---|---|
| `gd_info()['AVIF Support']` | `false` | `true` |
| `getimagesize()` on AVIF | works (dims + mime) | works |
| `imagecreatefromavif` | absent | present |
| still 800×400 | — | decoded, 2.4 ms |
| animated AVIS 400×400 (3 fr) | — | decoded as **frame 0** only, 1.1 ms |
| animated AVIS + alpha | — | decoded, alpha preserved (`rgba 255,0,0,63`) |
| animated 1920×600 (60 fr, 144 KB) | — | decoded, 41.8 ms, +15.7 MiB RSS |
| truncated (400 B / 800 B) | — | clean `is not a valid AVIF file` warning, no crash |
| hostile box size | — | clean rejection |
| **bomb: 1,067 B declaring 8192×8192** | — | `memory_limit=256M` → **PHP fatal**; `memory_limit=-1` in 512 MiB container → **OOM-killed (exit 137)** |

Evidence: `avif/results/probe-gd-{baseline,avif}.json`, `probe-bomb-avif.txt`.

**Findings**
- **Mandatory control:** `getimagesizefromstring()` reads dimensions without decoding (0.4 MiB peak). Enforce edge/pixel caps on the header **before** `imagecreatefromavif`. Without it a 1 KB upload kills the request/container.
- GD gives frame 0 of an AVIS — good enough for the static poster / reduced-motion still (same design as GIF/WebP).
- **Container-level risk:** adding `libavif-dev` changes the runtime library set (libavif 1.2.1 + dav1d/aom transitive). Image-size/build-time delta **not measured**. Debian's floating `php:8.3-apache` tag moved to trixie during this work — pin it.
- Container-structure prototype `avif/avif-probe.php` (bounded ISOBMFF AVIF/AVIS reader: brands, dims, frame count, duration, has_moov): **60,000 mutated inputs → 0 unexpected throwables, max 2.8 ms, 0.5 MiB**. Prototype only; not production code.
- **Browsers (headless):** Chromium 141, Chrome 155 and Firefox 158 all decode still and animated AVIF (incl. alpha) and `<picture><source type="image/avif">` is selected. **Animation advance was NOT measured** — headless engines do not advance image animation (the harness's canary detected this and reported `animates:false` for the GIF/WebP controls too). Treat AVIF animation playback as **unverified**.
- Safari/iOS AVIF: **BLOCKED** (no device).

**Verdict:** PASS, conditional on header pre-check, pinned base image, and a `GD_AVIF_ENABLED` style kill switch mirroring `STOREFRONT_MEDIA_ANIMATED_ENABLED`.

---

## 3. S0-B — Cloudflare R2 HTTP Range

**Blocked:** no R2 credentials in this environment. Real R2 behaviour is **not measured.**

Substitute evidence (S3 semantics via the same AWS SDK for PHP 3.401.2 the app uses), against **SeaweedFS** and **Scality CloudServer** (MinIO images were unavailable). Both returned identical results for 14 cases (`r2-range/result-{seaweedfs,scality}.json`):

| Case | Result |
|---|---|
| `bytes=0-0`, `0-1` (Safari-style probe), closed range, open-ended, suffix `-100` | **206** + correct `Content-Range` |
| end beyond size | 206, clamped |
| start ≥ size | **416 `InvalidRange`** |
| multi-range `0-1,5-6`, malformed, wrong unit | **200 full body** (Range ignored) |
| `Range` + `If-Match` right/wrong, `If-None-Match` current | 206 / 412 / 304 |
| `HEAD` | `Accept-Ranges: bytes`, `Content-Length`, ETag |

Implication for design: map S3 `InvalidRange` → 416 + `Content-Range: bytes */size`; multi-range must be **ignored (200)** or rejected, never forwarded; known size from DB (`variants[].bytes`) avoids a HEAD per request. `If-Range` must be handled at our origin, not delegated.

**Owner action to close this item** (test bucket; writes/deletes only `s0-range-probe/probe.bin`):
```
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com S3_KEY=… S3_SECRET=… S3_BUCKET=<test-bucket> S3_REGION=auto \
php docs/plans/store/s0-spikes/r2-range/range-probe.php /path/to/vendor/autoload.php > result-r2.json
```
Send `result-r2.json` back; compare to the table above.

---

## 4. S0-C — Safari / iOS

**BLOCKED — no Apple device or Safari/WebKit engine was available.** No Safari or iOS claim is made in this report.

What exists to close it: `video/pages/device.html` + `video/server.js` harness (`node server.js 8099`, then open `http://<LAN-IP>:8099/page/device.html` on the iPhone/iPad and Mac Safari; `?mode=norange` serves a deliberately Range-ignoring origin to check the failure mode). The harness POSTs results back to `/__result`.

Hypotheses to verify on device (from public Apple/WebKit guidance, **not** verified here): Safari requires a Range-capable origin (206 + `Content-Range`) for `<video>`; inline autoplay needs `muted` + `playsinline`; Low Power Mode may block autoplay; HEVC/H.264 baseline vs high profile limits; WebM support varies by OS version; animated AVIF support by OS version. WebM remains deferred until this is measured.

---

## 5. S0-D — MP4 / WebM compatibility

Corpus (ffmpeg): H.264 baseline/high, faststart vs not, fragmented, rotated 90°, +AAC, HEVC, AV1 (MP4 and WebM), VP8, VP9, truncated, hostile box sizes.

| Engine (headless, Linux) | H.264 MP4 | HEVC | AV1 | VP8/VP9/AV1 WebM | Truncated MP4 | Hostile box size |
|---|---|---|---|---|---|---|
| Playwright Chromium 141 | **no** (no proprietary codecs) | no | plays | plays | error | error |
| Chrome 155 stable | **plays** (all 6 variants incl. rotated, fragmented, non-faststart) | no | plays | plays | error | **plays** (lenient) |
| Firefox 158 | metadata + `playing` event OK; **`currentTime` did not advance** in headless Xvfb → *playback not proven* | `canPlayType` yes | metadata OK | metadata OK | error | error |

Takeaways
- **Playwright's Chromium cannot play H.264** — any MP4 e2e in this repo's Playwright setup needs Chrome stable (or AV1/VP9 fixtures). Phase 1 e2e remains unaffected.
- **Engines disagree on malformed input** (Chrome plays `hostile-boxsize.mp4`; Firefox rejects). Server-side validation therefore cannot defer to "the browser will cope": we must reject non-conforming files at upload (as the owner decided).
- Firefox's `play()` promise stayed pending on truncated media — storefront code must never `await video.play()` without a timeout/`catch`.
- **Pure-PHP validators vs ffprobe (ground truth):** MP4 prototype agreed on **11/11 files for all 13 fields** (codec, profile, level, size, duration, fps, bitrate, audio, faststart, fragmented, rotation, GPS); WebM prototype **18/18** (`video/mp4-probe.php`, `webm-probe.php`, `results-*-compare.json`). Pure PHP is viable; no `ffprobe` dependency needed in the API image. (Prototype scope: the corpus above; not fuzz-hardened like the GIF/WebP parser — needs the same fuzz + differential review before production.)
- Not measured: Android Chrome/WebView, Samsung Internet, iOS/macOS Safari, real hardware decode/battery, autoplay policies on mobile.

**Verdict:** MP4 (H.264 + optional AAC, faststart required, ≤ agreed bitrate/size caps) is feasible and validatable. WebM: technically playable in Chrome/Firefox; **stays deferred** pending S0-C.

---

## 6. Poster, MediaRef, schema (design confirmation — nothing implemented)

Unchanged from the owner's decisions: merchant-supplied static poster; `poster_media_id` additive migration **not created**; MediaRef document contract unchanged (new kinds surface in the resolved payload, as with `animation`). The S0 work found nothing that contradicts these.

---

## 7. S0-E — Streaming performance + Apache saturation

**Rig:** `php:8.3-apache` (prefork, as production Dockerfile), `--cpus=2 --memory=2g`, default `MaxRequestWorkers=150`; a 15.2 MB MP4 streamed from SeaweedFS via a ranged `GetObject` in a PHP route modelled on the planned `video` route (`streaming/www/stream.php`). Each client is throttled to **250 KiB/s** (≈ 2 Mbit/s mobile) for a 25 s hold ⇒ every client holds a worker for the full transfer. A health probe hits `/health.php` throughout. Rows are `streaming/results/matrix-s3-2cpu-2g.jsonl`.

| Concurrent viewers | Busy workers (max) | TTFB p50 / p95 / max (ms) | Health probes failed | Container mem peak | CPU peak | Notes |
|---|---|---|---|---|---|---|
| 20 | 17 | 1,381 / 1,699 / 1,699 | 0 / 99 | 101 MiB | 89 % | |
| 60 | 51 | 3,206 / 4,613 / 4,619 | 1 / 99 | 269 MiB | 99 % | prefork spawns gradually → TTFB grows before workers exist |
| 100 | 79 | 1,453 / 4,497 / 4,847 | 1 / 99 | 394 MiB | 159 % | |
| 140 | 114 | 3,960 / 7,184 / 7,399 | **11 / 99** | 617 MiB | 139 % | health starts failing |
| 170 | **150 (cap)** | 1,090 / 5,353 / **17,414** | **53 / 99** | 801 MiB | 194 % | pool exhausted; API probe unusable ~half the time |
| 220 | 150 | 7,323 / 21,588 / 22,382 | **77 / 82** | 802 MiB | 140 % | **34 of 220 clients got no response** |

Reading
- **One slow viewer = one Apache worker for the whole transfer.** The pool saturates at ≈ **150 concurrent streams**, and because the pool is **shared with the REST API and admin**, the API becomes unavailable at the same moment. The first health failures appear at ~115 busy workers.
- Memory ≈ **~5 MiB per busy worker** (101→801 MiB for 17→150) — not the constraint; the **worker count and the 2-CPU ceiling** are.
- No client errors below saturation, i.e. Range/206 correctness holds under load.
- **Node proxy memory (storefront same-origin route):** the current media proxy `arrayBuffer()`-buffers the whole upstream body. With 100 slow clients on the same 15 MB file (`streaming/proxy-memory.js`, `results/proxy-memory-*.jsonl`):

| Proxy mode | RSS baseline | RSS peak |
|---|---|---|
| buffering (today's `route.ts` behaviour) | 60 MiB | **1,833 MiB** |
| streaming pass-through (`Response(up.body)`, Range/Content-Range/Accept-Ranges forwarded) | 60 MiB | **189 MiB** |

  ⇒ **Video must not go through the buffering proxy** (OOM risk on a small Railway instance); the image path is unaffected today because images are small.
- **Not measured (honest gaps):** Railway edge behaviour for long streamed responses/Range and any edge timeout; real R2 latency (SeaweedFS was on the same Docker network ≈ 0 ms); a CPU-bound `src=file` control; behaviour of default `max_execution_time` on very slow clients; a second resource profile. The absolute 150 figure is the *default* `MaxRequestWorkers` — production's actual value/plan CPU/RAM is unverified, so treat numbers as relative, not capacity promises.

**Verdict / recommendation**
- **NO-GO:** serving video bytes from the Laravel Apache prefork pool as the primary path. At ~150 concurrent viewers it takes the API down with it.
- **GO:** Next streaming proxy (Range pass-through, no buffering, `req.on('close')` cancel).
- Preferred origin of bytes (needs approval, not implemented): R2 public/custom-domain (or short-lived signed URL redirect) behind Cloudflare cache, **keeping tenant isolation + publication gate at the URL-issuing layer**; fallback: a dedicated lightweight media service (separate Railway service/process pool) so video load cannot starve the API. Re-run this matrix against the chosen path on a staging service before any enablement.

---

## 8. Hosting topology (verified from repo + Railway tooling)

- **Storefront:** Node 22 standalone Next.js Docker image on Railway, 1 replica (region ams).
- **API (`nibras-api`):** Dockerfile build from `php:8.3-apache`, **mpm_prefork**, 1 replica (ams).
- Consequence: no horizontal headroom, no dedicated worker/queue for media, and the Railway edge sits in front of both. Streaming assumptions (long-lived responses, Range) through the Railway edge are **unmeasured** and require a staging service to test.
- Note: Railway's UI label (Railpack) vs the repo's Dockerfile — the Dockerfile governs builds; document this to avoid a future "why isn't libavif there" surprise.

---

## 9. Security review of `StorefrontAnimatedImage.php` (pre-merge)

Independent fuzz + differential review by a separate agent (report: findings below; harness and PoCs in `s0-spikes/security/`). **Agent-reported scale:** ~1.17 M mutated GIF/WebP inputs (random, structure-aware, exhaustive byte/bit/truncation); invariants checked on every accepted input; differential against Pillow, Chromium `ImageDecoder`, gifsicle, ImageMagick, webpmux/anim_dump, ffprobe.

**No high-severity issue.** 0 uncaught exceptions/warnings other than `StorefrontMediaException`, 0 meta changes after `sanitize()`, 0 non-idempotent or larger-than-input outputs; worst crafted 5 MB inputs ≤ 0.86 s and ≤ 39.5 MB peak at `memory_limit=256M`. On the **served (sanitised)** output no decoder ever saw *more* frames than `inspect()`.

I independently **re-ran PoCs F1, F2, F4 against the repository class** (PHP 8.3.6): confirmed.

| ID | Sev | Status | Issue | Reproduction (mine) | Fix |
|---|---|---|---|---|---|
| F1 | Low-Med | **Confirmed** | WebP: nested `ANMF` / unknown chunks inside an `ANMF` are ignored by `inspect()`; libwebp treats them as extra frames. Bypasses frame/duration/pixel caps **on the stored original only** (sanitiser drops them). | `webp_hidden_frames_n3.webp`: `inspect` = 2 frames, Pillow = 5 | In `webp()`, require each ANMF's children to be exactly `[ALPH?][VP8\|VP8L]`, else unreadable (also fixes F5) |
| F2 | Low | **Confirmed** | GIF: extension `21 FF 00 …` — `inspect` stops at trailer, other decoders count a hidden 3rd frame. | `gif_ext_ff_zero_hides_frame.gif`: `inspect` = 2, Pillow = 3 | Reject non-GCE extensions whose first sub-block length is 0 |
| F3 | **Med (policy)** | Agent-measured (not re-run by me) | `max_total_pixels=150M` lets one 2560×976×60 image cost ≈ **480 MB** decoded in a browser (RGBA frame cache); several slider slides multiply it. PHP side is cheap. | `webp_heavy_2560x976x60.webp` (148 KB) | Lower `max_total_pixels` to ~30–40 M (≈120–160 MB) and/or lower animated `max_pixels`. **Needs owner decision** — it changes product limits. Mobile/Firefox/Safari memory untested. |
| F4 | Low | **Confirmed** | Poster passes the upload-time `getimagesizefromstring` dim check but `imagecreatefromstring()` fails (LZW min-code-size byte, WebP canvas ≠ bitstream dims) → asset likely ends `failed` after upload (safe failure, poor UX). | `gif_poster_gd_fail.gif`, `webp_dims_mismatch_poster_gd_fail.webp`: dims ok, GD **FAIL** | Require LZW min code size 2..8; compare VP8/VP8L header dims to ANMF dims; or GD-decode the poster at upload |
| F5 | Low | Agent-reported | inspect/sanitize accept some WebP layouts libwebp rejects (e.g. `[VP8L][ALPH]`) → broken image, never extra frames. | `classify_webp_rej.py` | Same fix as F1/F4 |
| F6 | Info | Agent-reported | Arbitrary bytes inside LZW sub-blocks / after a VP8L bitstream survive sanitising; ICCP (≤64 KB) unvalidated → **do not claim "EXIF/XMP stripped" for image-data streams**. | `gif_payload_survives.gif`, `webp_payload_survives.webp` | Documentation wording; optional re-encode (not recommended: loses fidelity) |
| F7 | Info | Agent-reported | Padding bytes copied non-zero; ICCP kept when VP8X ICC flag clear. | grammar check | Write `\0` pads; drop ICCP when flag clear |
| F8 | Low | Suspected, untested | Min-delay rule (≤10 ms → 100 ms) vs browsers that clamp differently ⇒ real duration could exceed counted (bounded 300 × 100 ms = 30 s vs 20 s limit). | — | Measure on Safari/Firefox |

**Not covered:** Firefox/Safari/mobile decoders, production GD/libwebp versions, end-to-end Laravel/R2 failure path for F4, coverage-guided fuzzing (AFL/libFuzzer), APNG.

**Recommendation:** merge-gating for PR #1541 → fix **F1(+F5), F2, F4** (small, local, with regression tests using the supplied PoCs) and get an owner decision on **F3**. **No production code was changed for these in this S0 task** — awaiting approval, per "no production changes without further approval".

---

## 10. Dev-only page `/dev/animated-media-visual` in production

Verified with a real `NODE_ENV=production next build` + `next start`:
- Fixture markup is **absent** from the response (0 occurrences of `animated.gif|webp` / the media proxy path) for every `?scenario=`; the body is the framework not-found UI.
- **Defect found and fixed (one-line reorder, `storefront/src/app/dev/animated-media-visual/page.tsx`):** `notFound()` ran before `await searchParams`, so Next prerendered the route at build time as a static page cached with `s-maxage=31536000`. It now reads `searchParams` first, so the route is **dynamic** (`◐`) and decides per request. Build and typecheck pass.
- **Known residual:** the HTTP status is still **200** (soft-404). This is app-wide behaviour in this build: `/dev/nonexistent` also answers 200, and the existing `/dev/customizer-visual` guard behaves identically. It leaks nothing, but it is not a "real" 404. Not changed (would be an app-wide routing change). Recommend a follow-up: block `/dev/*` in the proxy/middleware for production, or add `X-Robots-Tag`/robots disallow — **not verified** whether crawlers are excluded today.

---

## 11. Blocked / not-verified register

| Item | Why | How to close |
|---|---|---|
| Cloudflare R2 Range | No credentials | Run `range-probe.php` (§3) |
| Safari / iOS / iPadOS playback, autoplay, AVIF, Range requirement | No Apple devices | `device.html` harness (§4) on real devices |
| Android Chrome / WebView | No device | Same harness |
| Animated image playback advance (GIF/WebP/AVIF) in any browser | Headless engines don't advance animation; headed Chrome not run | Headed run on a desktop with a display |
| Firefox video `currentTime` advance | Headless Xvfb clock | Headed Firefox |
| Railway edge behaviour for long streams / Range | Would require deploying a staging service | Needs approval for a staging service |
| Production Apache `MaxRequestWorkers`, CPU/RAM limits | Not read from production | Owner/ops to confirm |
| libavif image size/build-time/CVE-surface delta | Not measured | Part of Phase 2 slice 1 |

---

## 12. Go / No-go recommendations

1. **Phase 1 (PR #1541):** CONDITIONAL GO — apply F1/F2/F4(+F5) fixes with regression tests; owner decides F3 limits. Keep open until then. Keep dev page + Playwright (done; soft-404 residual noted).
2. **AVIF:** GO for slice 1 (GD/libavif, header pre-check, pinned base image, kill switch) — separate approval for the Dockerfile change.
3. **Video MVP:** GO for **MP4 H.264/AAC only**, merchant poster, upload validation in pure PHP (fuzz-hardened first), localized rejection errors, no transcoding.
4. **Delivery:** NO-GO on Apache-prefork as the byte path; GO on a streaming Next proxy; choose R2/CDN or a dedicated media service and re-test on staging.
5. **WebM:** remain DEFERRED until Safari/iOS evidence.
6. **CSP Report-Only:** unchanged from the approved design; nothing in S0 contradicts it.
7. **No** merge, deploy, production config change or migration was performed.

## 13. Reproduction index

| What | Where |
|---|---|
| AVIF images/probes | `s0-spikes/avif/` (`Dockerfile.avif`, `probe-gd.php`, `probe-bomb.php`, `avif-probe.php`, `results/`) |
| R2/S3 Range probe + results | `s0-spikes/r2-range/` |
| Browser harness, MP4/WebM probes, comparison | `s0-spikes/video/` |
| Apache matrix, proxy memory test | `s0-spikes/streaming/` (`run-matrix.sh`, `proxy-memory.js`, `results/`) |
| Security PoCs + fuzz harness | `s0-spikes/security/{poc,harness}/` (PoC files are inert test images; `webp_hidden_frames_n90000.webp`, 5.4 MB, omitted — regenerate with `harness/`) |
