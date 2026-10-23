# AWJ Animated Media — Phase 2 Readiness Review (Animated AVIF · MP4 · WebM)

| | |
|---|---|
| Type | **Review only — no implementation, no migration, no infrastructure, no production change.** |
| Sources read | `docs/plans/store/AWJ-ANIMATED-MEDIA-PHASE2-ARCHITECTURE-PROPOSAL.md`, `AWJ-ANIMATED-MEDIA-S0-FEASIBILITY-REPORT.md`, `AWJ-ANIMATED-MEDIA-HARDENING-REPORT.md`, PR #1541 (Phase 1, merged `a50ce81`), PR #1547 (Canvas parity, merged `d865117`) |
| Code inspected (relevant parts only) | `StorefrontMedia` model, `StorefrontMediaService`, `StorefrontMediaPublishGate`, `StorefrontCustomizerMediaController`, `R2StorageService`, `Dockerfile`, storefront media proxy route + `customizer-media.ts`, `animated-sources.ts`, `MotionPicture`, Canvas `animated-preview-store` |
| Read-only external checks | Railway build log of `nibras-api` (how production is built); Cloudflare R2 docs (presigned URLs, `GetObject` params); MDN (AVIF support); php.net (`imagecreatefromavif`) |
| Evidence tags | **[Repo]** read in code · **[S0]** measured in the S0 spikes (not repeated) · **[Ext]** primary external doc · **[Prod]** read from Railway (read-only) · **[Unverified]** nobody has evidence |

## Status update — owner decisions and evidence (recorded after this review)

| Item | Status | Evidence class |
|---|---|---|
| **Architecture B2** (Laravel authorises; Next.js streams video bytes from R2 using server-side signed URLs) | **Approved architecturally by the owner** | Owner decision |
| **Poster design P2** (the poster belongs to the video asset itself; **no** `poster_media_id` migration) | **Approved by the owner** — supersedes option P1 in §5 #4. **P2 is the only poster design in this plan:** no `poster_media_id` migration, and approval #4 is **granted** (not outstanding) | Owner decision |
| **Animated WebP** | **Manually tested successfully by the owner on a real iPhone, in the Canvas and on the published storefront** | Owner-reported (not independently verified in this repository); closes the "WebP unverified" gap for that one device |
| Every other real-device and security acceptance test (second iOS version, Low Power Mode, reduced motion on device, Android, Safari desktop, Firefox, animated AVIF, MP4/WebM playback, real-R2 Range/presigned behaviour, Railway edge streaming) | **Remain unverified** unless independently evidenced | — |
| **These approvals do NOT authorise video rollout.** | They fix the *design direction* only. No video code, upload route, authorise endpoint, flag, canary or production change is authorised; the gates in §4.6 and §6 still apply, and approvals #1, #5, #6, #10, #11, #12 in §5 are still required before their slices (#4 is already granted — P2). **Approval #7 has two parts with different states (single definition, used everywhere in this document):** *#7a — the interpretation* (server-to-server signed R2 fetch by the storefront proxy is not "direct R2 exposure" under AMEND-1) is **covered in principle by the documented B2 owner approval**; *#7b — the ADR text* has **not been written and no acceptance of any text is on record** — it is drafted in slice V0 and its acceptance is **required before V1 starts** (it is not assumed from #7a). | — |

### Delivery status after this review (repository state, verified against `main`)

| Slice / gate | State | Where |
|---|---|---|
| **P2-0** — proxy safety for the existing buffered image path (incl. P2-0b delivery-memory budget) | **Implemented and merged** — PR #1552, merge commit `3cf914235` | Report: [`docs/reports/AWJ_ANIMATED_MEDIA_P2_0_REPORT.md`](AWJ_ANIMATED_MEDIA_P2_0_REPORT.md) (this file did not exist in the tree when this review was first written — the first review round flagged the reference as dangling; the report landed with #1552) |
| **V0** — delivery spike, harness part | **Harness merged** — PR #1558 (`5732917`) and follow-up PR #1646 (`f5bb08f8a`): credential-safe probe, SSRF guard, redaction, verified cleanup, fault injection. **Local S3 look-alike only — NOT R2 evidence.** | [`AWJ_ANIMATED_MEDIA_V0_R2_RANGE_REPORT.md`](AWJ_ANIMATED_MEDIA_V0_R2_RANGE_REPORT.md), [`AWJ_ANIMATED_MEDIA_V0_FOLLOWUP_REPORT.md`](AWJ_ANIMATED_MEDIA_V0_FOLLOWUP_REPORT.md) |
| **V-G1** — presigned GET + `Range` on **real Cloudflare R2** | **NOT RUN → gate state NO-GO.** No R2 result file exists in the repository; the owner prerequisites (test bucket, bucket-scoped token as `S3_*`, egress) are still outstanding (V0 report §6) | — |
| V-G2 … V-G7, approvals #1, #5, #6, #10, #11, #12 | Not started / not granted | §4.6, §5 |
| Approval #7 — AMEND-1 clarification | **#7a interpretation: covered in principle by the B2 approval (owner decision). #7b ADR text: not written, acceptance not granted** (drafted in V0; accepted before V1) | §5 |

**Gate rule (unchanged by anything above):** the MP4 "CONDITIONAL GO" in §0 is *conditional on V-G1 passing on real R2* — it is not permission to start video code. **Until V-G1 has passed on real Cloudflare R2, slices V1–V7 must not start and MP4 stays NO-GO for implementation.** A passing local look-alike run proves the harness, nothing about R2. If V-G1 fails and no safe proxy-side shim exists, video stays NO-GO; Laravel streaming is never the fallback.

## 0. Verdict at a glance

| Item | Recommendation |
|---|---|
| **Animated AVIF** | **CONDITIONAL GO** for backend slices A0–A2 behind a flag, after owner approval of the image change. **Rollout (A3→canary) is NO-GO until animated-AVIF playback is measured on real iOS Safari and Chrome Android** — nobody has that evidence (§3). Benefit over today's WebP/GIF is file size only. |
| **MP4 (H.264)** | **CONDITIONAL GO, gated on one delivery decision.** The byte path **must not be Laravel** (your constraint, and S0-E proved why). The proposal's Option A ("stream through Laravel") is **withdrawn**. Recommended replacement: *Laravel authorises (short request), the Next/Node proxy streams the bytes from R2 with a server-to-server presigned URL* (§4). Needs one cheap delivery spike with R2 credentials before any video code. |
| **WebM** | **NO-GO / defer.** No Safari/iOS evidence; Firefox playback not proven; add only after MP4 ships, as an optional alternate source. |
| **Server-side transcoding / ffmpeg** | **Out** (reject-don't-repair stays). |

**Two findings that change the earlier plan**
1. **Production is built from the repo `Dockerfile`** **[Prod]** (the build log shows BuildKit `[stage-0 7/9] RUN bash /core/deploy/assemble.sh /core /app && php /core/tests/Fixtures/gd-runtime-smoke.php …` and `[stage-0 8/9] RUN cp /core/deploy/entrypoint.sh …` — the Dockerfile's own steps — then the `/api/health` healthcheck), despite the dashboard's "Railpack" label. This resolves the S0 open question: an AVIF change **will** take effect via the Dockerfile, and the existing GD smoke test in the build can gate it.
2. **Streaming the media proxy would re-couple slow clients to Apache workers.** Today the Next proxy **buffers** the origin body (`arrayBuffer()`) **[Repo]**, which incidentally shields Laravel from slow clients (the worker is held only for the fast Node↔Laravel copy). The S0-E saturation (≈150 concurrent slow streams → API health probes failing) was measured with clients attached *directly* to Apache **[S0]**. If the proxy were made streaming for *Laravel-served* bytes, backpressure would pin a worker per slow viewer. **Rule: Laravel-served images stay buffered (bounded); only R2-direct bytes may stream.**

---

## 1. What Phase 1 already provides, and what Phase 2 can reuse

| Phase 1 asset | Reuse for AVIF | Reuse for video |
|---|---|---|
| Pure-PHP bounded container parser pattern (`StorefrontAnimatedImage`) + fuzz/differential harness (`s0-spikes/security/harness`, 1.17 M inputs) | **Direct** — ISOBMFF prototype already exists (`s0-spikes/avif/avif-probe.php`: 60 k mutated inputs, 0 throwables) | **Direct** — `mp4-probe.php` / `webm-probe.php` agree with ffprobe on 11/11 and 18/18 fixtures **[S0]**; need the same fuzz hardening |
| `StorefrontMediaService` upload branch: inspect → limits → poster check (GD-decoded) → sanitise → ladder → store; "rejected file never reaches storage" invariant; kill-switch config; stable error codes | **Direct** (new format branch) | Partial (pattern; the pipeline differs: no sanitise/ladder from a frame, poster supplied) |
| `kind` (varchar 16), `mime` (varchar 32), `variants` JSON, `size`, dedupe by sha256, quota, soft-delete + purge via `variantList()` **[Repo]** | `kind='animated'` unchanged; `image/avif` fits — **no migration** | `kind='video'`, `video/mp4` fit — **no migration for the asset itself** |
| Published-reference gate, tenant resolution from forwarded host, uniform 404, content-derived ETag, `nosniff`, `private, no-store` origin | Direct (new closed file name) | **Gate logic reusable; the byte path is not** (§4) |
| Additive resolver/API field `animation` (+ web mapper, TS twin allow-list) | `animation.format: "avif"` (unknown format → old storefront drops the animation and shows the still: rolling-deploy safe) | New additive `video` object, same principle |
| Publish gate: allowed slots (`ANIMATED_ALLOWED_PATH`), worst-case contrast `[0..255]`, no transforms | Direct | Same slots; add `video_poster_required` |
| `MotionPicture` / `MotionToggle` (reduced-motion, no-JS, pause/play, hydration gating), Canvas twin + `animated-preview-store` (#1547) | `<source type="image/avif">` slots straight in; Canvas needs only the format-agnostic store | `MotionToggle` reusable; `<video>` needs its own component (no `<source media>` ordering trick); Canvas parity needs a decision |
| 40 M decoded-pixel budget (browser RAM ≈ 4 B × W×H×frames, **[S0 F3]**) | Applies unchanged | Different cost model (HW decode, no RGBA cache) — needs its own caps (§5) |
| `MediaRef` document contract (PHP + 2 TS twins + fixture) | **Unchanged** | **Unchanged** (renderer discovers video from the resolved payload) |
| Owner-reported production proof: flag on, GIF upload/playback/pause on a real iPhone **[owner-reported]** | Confidence in the pipeline | Confidence in gate/proxy; says nothing about video |

**Not reusable / must change:** closed file-name vocabulary (`animated.(gif|webp)` in PHP, proxy regex, TS twin); the Laravel byte-streaming controller (`echo $body->read(8192)` — fine for ≤5 MB images, wrong for video); `R2StorageService::get()` has no `Range` and no URL signing **[Repo]**; the batch `files[]` upload endpoint (assets are independent files).

---

## 2. Production runtime facts relevant to Phase 2

| Fact | Tag |
|---|---|
| `nibras-api`: 1 replica (ams), Docker image built from the repo `Dockerfile`, Apache **prefork**, `php:8.3-apache`, GD `--with-freetype --with-jpeg --with-webp`, no AVIF/ffmpeg/Imagick; the build already runs `gd-runtime-smoke.php` | **[Prod]**, **[Repo]** |
| `QUEUE_CONNECTION=sync`; no workers; the same Apache pool serves the ERP API (invoices, ledger, auth) | **[Repo]** |
| Storefront: Node 22 standalone, 1 replica; proxy buffers whole bodies, forwards only `If-None-Match`, accepts only `200/304` from origin | **[Repo]**, **[Prod]** |
| S0-E: prefork saturates at the 150-worker cap; 53/99 health probes failed at 170 slow streams, 34/220 clients got nothing at 220; ~5 MiB per busy worker | **[S0]** |
| S0-E: Node proxy, 100 slow clients on a 15 MB file: **buffering 1,833 MiB RSS vs streaming 189 MiB** | **[S0]** |
| R2 S3 API: `GetObject` **Range ✅, PartNumber ✅, If-Match ✅, If-None-Match ✅**; `If-Range` **not listed**; no notes on multi-range/suffix | **[Ext]** Cloudflare R2 S3 API page |
| R2 presigned URLs: work on the **S3 API domain only (not custom domains)**; methods GET/HEAD/PUT/DELETE; expiry 1 s–7 d; "treat as **bearer tokens**" | **[Ext]** Cloudflare R2 presigned-URL page |
| R2 actual behaviour for Range/suffix/416/`If-Range`/presigned+Range | **[Unverified]** — S0-B blocked (no credentials); verified only on two S3 look-alikes **[S0]** |

---

## 3. Animated AVIF

### 3.1 Decoder requirements — verified vs not

| Question | Evidence | Status |
|---|---|---|
| Can production decode AVIF? | Not today. Needs `libavif-dev` + `docker-php-ext-configure gd … --with-avif` in the Dockerfile. Spike image on the same base: `gd_info()['AVIF Support']=true`, libavif **1.2.1** (Debian trixie) | **[S0] PASS** |
| Does GD give frame 0 of an animated AVIF (AVIS)? | php.net is silent **[Ext]**; measured: 400×400 3-frame, alpha, and 1920×600 60-frame files decode as frame 0 (alpha preserved), 1–42 ms, ≤ 16 MiB RSS growth | **[S0] PASS** |
| Malformed input | Truncated and hostile-box files → clean `is not a valid AVIF file` warning, no crash | **[S0] PASS** |
| **Decompression bomb** | A **1,067-byte** file declaring 8192×8192 → PHP fatal at `memory_limit=256M`, **OOM-kill (exit 137)** in a 512 MiB container when the limit is lifted | **[S0] real risk** |
| Where it would be built | Dockerfile is what Railway builds **[Prod]**, so the change is effective and the build-time smoke can assert AVIF | **[Prod] PASS** |

### 3.2 Required protections (all feasible without new binaries)
1. **Header-first gate:** `getimagesizefromstring()` (0.4 MiB, no decode **[S0]**) → reject by edge/pixel/frames×pixels budget (**40 M**, 2560 edge, 2.5 MP) **before** any `imagecreatefromavif`.
2. Bounded ISOBMFF validator (box size ≤ remaining, depth ≤ 8, box-count cap, 64-bit-size overflow check) for brands (`avis`/`avif`), `ispe`, track `mdhd/stts` (frames, duration), loop — fuzzed to the same standard as GIF/WebP (productise `avif-probe.php`).
3. **Reject** (do not strip) files with Exif/XMP items (`iinf` types) — rewriting `iloc` is fragile; stable code `avif_metadata_present`.
4. Poster = GD frame 0 → existing WebP+JPEG ladder; GD-decode the poster at upload (the F4 lesson).
5. Pin the base image tag (the floating `php:8.3-apache` moved to trixie during S0); add an AVIF assertion to `gd-runtime-smoke.php` so a missing codec fails the **build**, not production.
6. Supply chain: libavif/dav1d/aom are new C attack surface on untrusted input → rebuild policy and CVE watch (owner-visible risk).

### 3.3 Browser support and fallback
- Still AVIF: Chrome 85, Edge 121, Firefox 93, Safari 16.1 **[Ext, MDN]**. **Animated AVIF: only "Firefox 113+" is documented; MDN says nothing for Chrome or Safari** **[Ext]**.
- Measured here: headless Chromium 141, Chrome 155 and Firefox 158 **decode** still and animated AVIF (incl. alpha) and `<picture><source type="image/avif">` is selected; **animation advance was not observable** (headless engines do not advance images) **[S0]**. Safari/iOS: **[Unverified]**.
- **Fallback behaviour (important):** a browser that does not support AVIF skips the `<source>` and shows the still ladder (first frame) — i.e. **the animation is lost** (unlike GIF/WebP). A browser that supports *still* AVIF but not AVIS would show frame 0 (acceptable). Therefore AVIF is only worthwhile if the animated-AVIF matrix is good on the devices that matter (the owner already tests on iPhone). One animated file per asset in the MVP; a merchant wanting reach uploads GIF/WebP.
- Memory: same 4 B × W×H×frames model and 40 M cap apply; AV1 software decode on low-end phones is CPU-heavy (unmeasured).

### 3.4 AVIF GO / NO-GO
| Gate | GO when | NO-GO when |
|---|---|---|
| G-A1 Build | Image builds on the pinned base; smoke asserts AVIF; image-size/build-time delta recorded | libavif unavailable or build time/size regress materially |
| G-A2 Safety | Fuzz ≥ 500 k mixed inputs: 0 uncaught throwables, 0 warnings, max time/mem bounded; bomb file rejected pre-decode with RSS ≈ idle; metadata files rejected | any unbounded time/memory case |
| G-A3 Playback | **Animation measured on real iOS Safari (current and one version back), Chrome Android, Chrome/Firefox desktop**; pause/play, reduced-motion, no-JS behave; unsupported browsers degrade to the poster | iOS Safari does not animate AVIS (then AVIF is not offered — GIF/WebP remain) |
| G-A4 Tenant/gate | New file name passes the Phase 1 isolation matrix (other tenant, unpublished, wrong extension, transform key) | any cross-tenant read |
| G-A5 E2E | Upload → R2 → published storefront on a canary tenant; rollback drill (flag off) | — |

---

## 4. MP4 / WebM delivery — reassessed under your constraints

**Constraints applied:** (a) *no large video stream through Laravel workers*, (b) tenant isolation and publication gating unchanged, (c) signed access, (d) R2 + HTTP Range, (e) the ERP/financial API must stay available.

### 4.1 Why the proposal's Option A is withdrawn
Option A (Next proxy → **Laravel `video` route** → R2 `GetObject` with `Range`) puts one Apache prefork worker on each in-flight range for as long as the client drains it. S0-E: saturation at the 150-worker cap, health probes failing from ~115 busy workers, ≈ 800 MiB of the container by 150 workers **[S0]**, on the **same pool that serves invoicing**. This is the failure mode your constraint forbids; the earlier owner decision ("Laravel + Next streaming, subject to load testing") is therefore **answered by the load test: fail**.

### 4.2 Options re-scored

| Option | Byte path | Tenant isolation / signed access | Verdict |
|---|---|---|---|
| A Laravel streams ranges | Browser → Node → **Laravel** → R2 | Gate per request | **Rejected** (S0-E; constraint) |
| **B2 Authorise in Laravel, stream in Node (recommended)** | Browser → **Node** → R2 (server-to-server, presigned) | Laravel resolves tenant + storefront from the forwarded host, runs the Published-reference gate, derives the object key **server-side**, returns a short-lived presigned R2 GET URL (+ size, ETag, content-type). The browser never sees an R2 URL (consistent with AMEND-1 and the repo's "no presigned/302/CDN to clients" stance for private files, `AttachmentStorage`) | **Recommended**, subject to gates V-G1…V-G4 |
| B1 302 / presigned URL to the browser | Browser → R2 | Short TTL bearer token in the client; exposes the R2 host (CSP); revocation = TTL | Fallback only, needs an explicit AMEND to AMEND-1 |
| C Public R2 custom domain / CDN | Browser → CDN | **Breaks** publication gating (also: presigned URLs do not work on custom domains **[Ext]**) | Rejected |
| D Edge worker (HMAC check in front of R2) | Browser → edge → R2 | Strong | **New infrastructure** — future option, not for this phase |

### 4.3 B2 in detail
- **Flow:** `GET /api/storefront/media/customizer/{id}/video.mp4` (browser, same-origin) → Next route validates id/file → calls Laravel **internal authorise endpoint** (forwarded host + gateway secret, as today) → receives `{url, expiresAt, size, etag, contentType}` (`etag` = the **client-facing, content-derived strong ETag**, see §4.3a — never R2's object ETag) → evaluates the browser's conditional headers (`If-Match`, `If-None-Match`, `If-Range`) **itself, in RFC 9110 order, before touching R2** (§4.3a; `304`/`412` make no R2 request) and otherwise fetches `url` from R2 with **at most one validated `Range` and no conditional headers**, `redirect:"manual"`, host allow-listed to the configured R2 endpoint (no SSRF; the V0 `guardedFetch` rule) → returns `200` / `206` / `304` / `412` / `416` with the **status-specific headers of §4.3a point 4** (`Content-Range` only on `206` and `416`, never on `200`), `Accept-Ranges: bytes`, `nosniff`, that same `ETag`; a `HEAD` is composed locally (§4.3a point 5, no upstream request); a `GET` `200`/`206` streams the body with backpressure (S0: 189 MiB for 100 slow clients vs 1,833 MiB buffered).
- **Signed access:** URL TTL 60–120 s (the Cloudflare doc says presigned URLs are bearer tokens: here they live only server-to-server, are redacted from logs, and are never sent to a client). `Range` is not a signed header, so the browser's range can be applied to the signed GET (**[Unverified] on R2 — gate V-G1**).
- **Load on Laravel:** one tiny request per *authorisation* (published-index check + offline SigV4 signing, no R2 round trip). Safari issues a probe `bytes=0-1` then ranges, so the proxy caches the authorisation per (host, id) for ≤ 60 s (≤ URL TTL − 10 s); revocation window = cache + signature TTL ≈ ≤ 3 min, within the existing 5-minute public-cache window. Add a per-IP throttle and a kill-switch; **never fall back to Laravel streaming on error** (fail closed to the poster).
- **Where the risk moves:** the single Node replica (CPU, egress, memory). Capacity must be measured and capped (max concurrent video streams, per-IP cap, idle timeout), and a storefront overload must not touch the ERP API — it does not share a process with Laravel.
- **Images stay as they are:** Laravel-served, buffered, bounded (≤ 5 MB). Do **not** make that path streaming (§0 finding 2).

### 4.3a Conditional-request and validator contract (`If-Match`, `If-None-Match`, `If-Range` — the proxy owns all of them)

*Why:* R2's own `GetObject` list names `Range`, `If-Match`, `If-None-Match` but not `If-Range` **[Ext]**; the S0 report concludes "`If-Range` must be handled at our origin, not delegated" **[S0]**; and the V0 look-alike run showed a server that **ignores** `If-Range` (a mismatching ETag still returned 206, `result-selftest-scality.json` I6 — *look-alike behaviour, not R2 evidence*). Forwarding the header would also compare the client's validator with a value the client never saw: the ETag the browser holds is the proxy's content-derived ETag, whereas R2 would compare with its own object ETag. Both effects can silently turn a resume/seek into a full-object transfer (egress, Safari seeking). The same holds for `If-Match` / `If-None-Match`: R2 would compare them with *its* ETag, so a matching `If-None-Match` would come back as a full body instead of `304`, and a stale `If-Match` as content instead of `412`. The contract below therefore evaluates **every** client conditional header locally, against the one client-facing ETag, **before** any R2 fetch, and does **not depend on any R2 conditional-request behaviour**.

1. **One client-facing validator.** The authorise response's `etag` is a *strong*, quoted, content-derived ETag (same family as the existing media ETags, derived from the asset identity of §5a — it changes if the video or the poster changes). The proxy sends exactly this value on every 200/206 and compares client validators with exactly this value. R2's object `ETag` and `Last-Modified` are never sent to the client and never compared with client headers. The proxy emits **no `Last-Modified`** for video.
2. **Upstream request** (proxy → R2, presigned GET): either **no `Range`** (full object) or exactly one **normalised closed in-bounds range `bytes=<start>-<end>`** (`0 ≤ start ≤ end ≤ size − 1`) computed by the proxy from the client's validated `Range` and the authorised `size` — never the client's raw open-ended, suffix, oversized or multi-range form, and never a range that starts at or beyond `size` (those are answered locally, point 4). Multi-range/malformed headers are handled by the proxy's own validator: ignore → 200 or 416, per the ADR. The proxy **never forwards `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since` or `If-Range`** from the browser, and a request answered `304`/`412` makes **no upstream request at all**.
3. **Evaluation order — local, before the R2 fetch** (RFC 9110 §13.2.2, verified against the RFC text). It runs only **after** the Laravel authorisation has succeeded (published-reference gate, tenant, uniform 404 for everything else — the authorisation may come from the ≤ 60 s cache), so no conditional header can reveal the ETag or existence of unpublished media (no `304` oracle). `E` = the authorised client-facing ETag (always strong).

| Step | Precondition | Rule for this proxy | If it decides |
|---|---|---|---|
| 1 | `If-Match` | `*` → true (the authorised representation exists); list → true iff some listed tag equals `E` under the **strong** comparison (a `W/"…"` member never matches); malformed → false | false → **`412`**, no body, no upstream request |
| 2 | `If-Unmodified-Since` | **Ignored**: ignored when `If-Match` is present, and in any case when the representation has no modification date — the proxy issues no `Last-Modified` | – |
| 3 | `If-None-Match` | `*` → false; list → false iff some member equals `E` under the **weak** comparison (`W/` prefix ignored; comma-separated list with optional whitespace. Note: the existing Laravel image `matches()` handles the list and `*` but does **not** strip `W/`; the video proxy must, and the image path is out of scope here); malformed → true | false → **`304`** (GET/HEAD), no body, no upstream request; carries `ETag: E` and the same `Cache-Control` as the `200` (RFC 9110 §15.4.5) |
| 4 | `If-Modified-Since` | **Ignored** (always: ignored when `If-None-Match` is present, and no modification date exists) | – |
| 5 | `Range` + `If-Range` | only if the method is GET and a valid single `Range` is present; entity-tag → true iff strongly equal to `E`; date, weak, unparseable → false; `If-Range` without `Range` → ignored (table below) | false → ignore `Range`, full `200` |
| 6 | otherwise | normal processing: `Range` → `206` / `416` (range validation errors surface here, after steps 1–5), no `Range` → `200` | – |

   `If-Range` outcomes at step 5 (unchanged from the first revision):

| Browser request | Condition | Upstream request | Response |
|---|---|---|---|
| `Range` + `If-Range: "<E>"` | true | `Range: <as validated>` | `206` + `Content-Range` + `E` |
| `Range` + `If-Range: "<other>"` | false → **ignore `Range`** | **no `Range`** (full object; video ≤ 15 MB cap) | `200`, full body, `E` |
| `Range` + `If-Range: W/"<E>"` (weak) | strong comparison fails → false | no `Range` | `200` full |
| `Range` + `If-Range: <HTTP-date>` | no `Last-Modified` was issued, so an exact match is impossible → false | no `Range` | `200` full |
| `Range` + unparseable `If-Range` | false (conservative) | no `Range` | `200` full |
| `If-Range` **without** `Range` | MUST be ignored | none | normal `200` |
| `Range` without `If-Range` | – | `Range` | `206` / `416` |

   *Interactions that follow from the order:* a false `If-Match` beats everything (`412`); a matching `If-None-Match` beats `Range` and `If-Range` (`304`, never `206`); `If-Range` is evaluated only for requests that survived steps 1–4; a `416` can only come from step 6. `HEAD` follows steps 1–4 and is then composed locally (point 5); `Range` and `If-Range` do not apply to it. The date-based preconditions are ignored *because the representation has no modification date* (RFC 9110 §13.1.3/§13.1.4) — if a `Last-Modified` were ever issued, steps 2/4 and the `If-Range` date row must be revisited together.

   Rationale: RFC 9110 §13.1.5 — "A recipient of an If-Range header field MUST ignore the Range header field if the If-Range condition evaluates to false", entity-tags use the strong comparison function, a date must "exactly match" `Last-Modified`; §13.1.1 requires the strong comparison for `If-Match` and §13.1.2 the weak comparison for `If-None-Match`; §13.2.2 fixes the order above.
4. **Response header contract** (RFC 9110 §14.4: "only the 206 and 416 status codes describe a meaning for Content-Range"). The proxy composes `Content-Range` itself from the validated range and the **authorised `size`**; it never copies an upstream `Content-Range` (the look-alike's 416 carries none — V0 R8 — and R2's is unverified).

| Response | `Content-Range` | `Content-Length` | Body |
|---|---|---|---|
| `200` — full GET: no `Range`, `Range` ignored because `If-Range` is false, or multi-range/malformed `Range` ignored per the ADR | **never sent** | `size` | full object |
| `206` — single satisfiable range | `bytes <start>-<end>/<size>` (`end` clamped to `size − 1`; a suffix longer than the object → `bytes 0-<size−1>/<size>`) | `end − start + 1` | that range |
| `416` — unsatisfiable (`first-pos ≥ size`, `suffix-length = 0`) | `bytes */<size>` | – | empty (no upstream body is ever forwarded) |
| `304`, `412` | never sent | – | none |
| `HEAD` `200` (point 5) | never sent | `size` | none |

   Common to all: `Accept-Ranges: bytes`, `ETag: E`, the authorised `Content-Type`, `nosniff`, the existing public `Cache-Control`; no `Last-Modified`. Satisfiability is decided **locally from `size` before any upstream call**, so a `416` costs no R2 request and does not depend on R2's `416` behaviour. For a `206` the proxy checks that the upstream answered `206` with a `Content-Range` equal to the one it computed; any other upstream answer to a ranged request (a `200`, a different range, a missing header) is a protocol failure → uniform `502`, **before** any body byte is sent; the same holds for a full-GET `200` whose `Content-Length` differs from `size` and for any upstream `Content-Encoding` (identity was requested) — these are exactly the response properties the proxy consumes, and therefore the ones V-G1 gates (the poster remains the fallback; never Laravel streaming).
5. **`HEAD`: composed locally, no upstream request.** The authorise response already carries everything a `HEAD` needs — `size` (from the asset's stored variant size, as S0 recommended: no HEAD round trip per request), the content-derived `ETag` and the `Content-Type`. The proxy therefore answers `HEAD` itself with `200` + `Content-Length: size`, `Accept-Ranges: bytes`, `ETag: E`, `Content-Type`, `nosniff`, `Cache-Control`, no body and no `Content-Range`, after steps 1–4 (so a matching `If-None-Match` still yields `304`, a false `If-Match` `412`). `Range` and `If-Range` are **ignored** for `HEAD` (RFC 9110 §14.2: GET is the only method with range handling), and RFC 9110 §9.3.2 asks for the same header fields a `GET` would send. **The GET-signed URL is never used for any method but GET** — the method is part of the S3 signature (V0 look-alike: `HEAD` with a GET-signed URL → `403`, case I2; with a HEAD-signed URL → `200`, case I1; *look-alike evidence, not R2*). *Not adopted:* a second, HEAD-signed URL in the authorise response — it would add a second bearer token and a second signature per authorisation and make R2's `HEAD` behaviour a new gate input, for metadata the authorise response already holds; revisit only if a field not derivable from the authorise response is ever required. *Accepted limitation:* a locally composed `HEAD` cannot notice an R2 object that has gone missing (the `GET` would then fail closed with `502`).
6. **Evidence required in V2 (Node tests, spy on the upstream call):**
   - every `If-Range` row above;
   - `If-None-Match`: matching strong tag, matching `W/` tag, `*`, a list containing the match with spaces, non-matching, and malformed → `304` / `304` / `304` / `304` / proceed / proceed; the `304` has no body, carries `ETag: E` and the `200`'s `Cache-Control`, and causes **zero** upstream calls;
   - `If-Match`: matching strong tag, `*`, `W/` of the same tag, non-matching, malformed → proceed / proceed / `412` / `412` / `412`; `412` makes **zero** upstream calls;
   - order and interactions: `If-Match` false + any other header → `412`; `If-None-Match` matching + `Range` → `304`, not `206`; `If-None-Match` matching + mismatching `If-Range` → `304`; `If-None-Match` non-matching + matching `If-Range` → `206`; `If-Modified-Since` / `If-Unmodified-Since` alone, and with `If-None-Match` / `If-Match`, never change the outcome; `HEAD` with a matching `If-None-Match` → `304`;
   - **`Content-Range` contract (point 4):** exact value `bytes <start>-<end>/<size>` on `206` for closed, open-ended, suffix, EOF-clamped and suffix-longer-than-object ranges; exact `bytes */<size>` on `416` for `first-pos = size`, `first-pos > size` and `suffix-length = 0`; **no `Content-Range` header at all** on every `200` (plain full GET, `If-Range` mismatch, multi-range ignored, malformed `Range` ignored), `304`, `412` and `HEAD`; the values derive from the authorised `size` even when the upstream (look-alike or R2) sends a different or no `Content-Range`; an upstream `200` or a mismatching `Content-Range` to a ranged request, a full-GET `200` with a `Content-Length` other than `size`, and any `Content-Encoding` → uniform `502` with no body byte; an unsatisfiable range → `416` with **zero** upstream calls;
   - **`HEAD` (point 5):** non-conditional `HEAD` → `200` with the `GET` `200`'s `Content-Length`, `ETag`, `Content-Type`, `Accept-Ranges`, no body, no `Content-Range`, **zero** upstream calls; `HEAD` + `Range` and `HEAD` + `If-Range` → the same `200` (ignored); `HEAD` + matching `If-None-Match` → `304`; `HEAD` + false `If-Match` → `412`; `HEAD` for an unpublished or other-tenant asset → the same uniform `404` as `GET`; and across **all** V2 cases every upstream call is a `GET` — the spy never sees a `HEAD`, and the signed URL is never used with another method;
   - **upstream `Range` is normalised, for every ranged case above:** the spy sees either no `Range` or exactly one `bytes=<start>-<end>` with `0 ≤ start ≤ end ≤ size − 1` — open-ended, suffix, EOF-clamped and suffix-longer-than-object client forms are rewritten to their closed equivalent (e.g. `bytes=-500` → `bytes=<size−500>-<size−1>`), and `first-pos ≥ size`, `suffix-length = 0`, multi-range and malformed headers produce **no upstream request with a `Range`** (local `416` or full `200`);
   - **no upstream header leak, for every case above:** the upstream request never carries `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since` or `If-Range`;
   - **no oracle:** an unpublished or other-tenant asset answers the same uniform `404` with or without any conditional header (a matching `If-None-Match` never yields `304` for it); the response ETag is always `E`, also when the upstream (look-alike or R2) returns a different `ETag` or none; likewise the client response carries the proxy's own `Accept-Ranges`, `Content-Type` and no `Last-Modified` when the upstream omits or varies `Accept-Ranges`, `ETag`, `Content-Type` or `Last-Modified` (a stub upstream that returns correct status / length / range / bytes but none of those headers must still produce the full client contract).
7. **Effect on V-G1:** V-G1 is judged only on **requests that actually reach R2** (point 2) and only on **what the proxy consumes from the response or relays as bytes** (status, `Content-Length`, the verified `Content-Range`, `Content-Encoding`, body) — see the gate scope in §4.6. Every R2 header the proxy replaces with its own (`Accept-Ranges`, `ETag`, `Content-Type`, `Last-Modified`) is diagnostic. R2's behaviour for everything the proxy answers or normalises locally — conditional headers (`If-Range`, probe case I6; `If-Match`/`If-None-Match`), `HEAD` (I1/I2), the client-form ranges (open-ended R5, suffix R6, EOF-clamped R7, multi-range/malformed I3–I5) and the unsatisfiable ranges that become a local `416` (R8, R9) — is still *recorded* as diagnostic evidence but is **not a gate input**: it can neither block nor enable the design. **V-G1 remains NOT RUN on real R2 ⇒ NO-GO.**

### 4.4 Remaining delivery unknowns (the only new spikes needed)
| Id | Unknown | Needs | Blocks |
|---|---|---|---|
| V-G1 | R2 behaviour for the presigned GET requests the proxy actually sends: a full GET and normalised closed in-bounds ranges (first byte, Safari `bytes=0-1` probe, mid-range, last byte), plus the security cases (§4.6 scope); client range forms, the local-`416` cases, `If-Range` and `HEAD` are recorded only (§4.3a) — via the AWS SDK | R2 **test bucket + scoped token** (S0-B was blocked on this); script already exists (`s0-spikes/r2-range/range-probe.php`) + a presigned variant | any video code |
| V-G2 | Authorise-endpoint latency/CPU under the Safari probe pattern at N concurrent viewers | local rig (the S0 harness reused) | V1 sizing |
| V-G3 | Node streaming proxy behind **Railway's edge**: long responses, `206`, idle timeouts, egress cost | a **staging service or an owner-supervised canary** | rollout |
| V-G4 | Real iOS/macOS Safari plays the proxied MP4 (206 requirement) | real devices | rollout |

### 4.5 Container, codec and metadata (reuse S0; nothing new to prove)
- MP4 validator in pure PHP, **H.264 accepted per the codec policy of §4.5a — the `avc1` FourCC alone is not sufficient**, non-fragmented, `moov` before `mdat` (reject with a re-export hint), no GPS/`udta`/`meta` (reject); caps proposed: ≤ 15 s, ≤ 1920×1080, ≤ 30 fps, ≤ 4 Mb/s, ≤ 15 MB. Prototype agrees with ffprobe on 11/11 files for 13 fields **[S0]**.
- Browser support measured (headless, **not devices**): Chrome 155 plays all H.264 variants (baseline/high/faststart or not/fragmented/rotated/AAC); Playwright's Chromium cannot play H.264 (e2e needs Chrome stable or AV1/VP9 fixtures); engines **disagree on malformed files** (Chrome plays a hostile-box MP4, Firefox rejects) → server-side validation is mandatory **[S0]**. Firefox `currentTime` did not advance in headless Xvfb → playback unproven there. **Safari/iOS: not tested.**
- WebM: containers/codecs parse and play on Chromium/Chrome; **Safari/iOS unknown** → deferred.

### 4.5a H.264 acceptance policy (V3 validator; reject-don't-repair)

The `avc1` sample entry only names the container mapping; what a decoder cares about is in the `avcC` record and the SPS it carries. A High 10, 4:2:2 or 4:4:4 stream is still `avc1`, and the MVP has no transcoding, so **whatever V3 accepts must play on the target devices** (V-G4 matrix: iPhone and macOS Safari, Chrome Android, Chrome/Firefox desktop). V3 accepts an H.264 track only if **all** rows hold; the first failing row in this order decides the rejection code (deterministic):

| # | Property | Accept | Reject → stable code | Basis |
|---|---|---|---|---|
| 1 | Sample entry / config | `avc1` with a parseable `avcC` that carries ≥ 1 SPS | `avc3` (parameter sets possibly in-band), `avc2`, other entries, missing/empty/unparseable `avcC` → `video_h264_config_unverifiable` | the profile, level, bit depth and chroma cannot be verified from the container otherwise |
| 2 | Profile (`profile_idc`) | **66** Baseline (incl. Constrained Baseline) · **77** Main · **100** High | everything else — 88 Extended; 110 High 10; 122 High 4:2:2; 144 / 244 / 44 High 4:4:4 (all variants); 83 / 86 scalable; 118 / 128 / 134 / 135 / 138 / 139 multiview and MVC — → `video_h264_profile_unsupported` | exactly the three profiles in the S0 corpus (`h264-baseline`, `h264-nofaststart` = Main, `h264-high`); the others are unmeasured |
| 3 | Level (`level_idc`, `constraint_set3_flag`) | an **explicit allow-list** of declared levels, nothing derived by comparison: **`level_idc` ∈ {10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41}** = Levels 1, 1.1, 1.2, 1.3, 2, 2.1, 2.2, 3, 3.1, 3.2, 4, 4.1; plus **Level 1b**, accepted only in its two valid encodings: **`level_idc` = 11 with `constraint_set3_flag` = 1 for profile 66 / 77** (Baseline / Main) and **`level_idc` = 9 for profile 100** (High; 9 is reserved for 66 / 77). Level 1b is below the caps, so accepting it is harmless; it is handled explicitly so it is neither mis-rejected nor mis-read as Level 1.1 | **Defined but above the allow-list** — `level_idc` ∈ {42, 50, 51, 52, 60, 61, 62} (Levels 4.2, 5, 5.1, 5.2, 6, 6.1, 6.2) → `video_h264_level_unsupported`. **Reserved / undefined / mis-encoded** — `level_idc` = 0 · 1 – 8 · **9 with profile 66 / 77** · 14 – 19 · 23 – 29 · 33 – 39 · 43 – 49 · 53 – 59 · 63 – 255 (every value not named above) → `video_h264_level_invalid`; `level_idc` = 11 with `constraint_set3_flag` = 1 on **profile 100** is *not* Level 1b (the flag has a different meaning for High and means nothing for level there) and is read as Level 1.1, which is allow-listed; no value is clamped, rounded or mapped to "the nearest level" | derived from the caps, not a device claim: ≤ 1080p at ≤ 30 fps needs Level 4.0 (MaxFS 8192, MaxMBPS 245 760; 1080p30 = 8160 × 30 = 244 800 MB/s); 4.1 only adds bitrate headroom; 4.2 doubles the macroblock rate (1080p60), which the caps exclude. The 12 numeric values plus the two 1b encodings are the **valid H.264 levels up to 4.1** per Table A-1 / `level_idc` semantics of the standard (cross-checked against FFmpeg `h264_levels.c`: levels 1 – 6.2 are `level_idc` 10 … 62 and 9 is 1b for High). It is the *declared* level — the real decode load is bounded by the resolution / fps / bitrate caps |
| 4 | Bit depth | luma **and** chroma 8-bit (`bit_depth_luma_minus8 = bit_depth_chroma_minus8 = 0`) | any other → `video_h264_bit_depth_unsupported` | the S0 corpus is 8-bit only |
| 5 | Chroma subsampling | **4:2:0** (`chroma_format_idc = 1`, no separate colour planes) | 4:0:0 (monochrome, allowed by High), 4:2:2, 4:4:4, `separate_colour_plane_flag = 1` → `video_h264_chroma_unsupported` | the S0 corpus is `yuv420p` only |

*How the fields are read:* Baseline and Main carry no chroma / bit-depth fields (implicitly 8-bit 4:2:0). For High, the `avcC` extension carries `chroma_format`, `bit_depth_luma_minus8` and `bit_depth_chroma_minus8`; when a muxer omits that extension the validator **parses the SPS** (bounded Exp-Golomb reader, fail closed). When both are present they must agree (`video_h264_config_inconsistent` otherwise); when neither can be read, `video_h264_config_unverifiable`. The S0 prototype (`mp4-probe.php`) already extracts `profile_idc` and `level_idc` and agreed with ffprobe on 11 / 11 files; reading chroma and bit depth (SPS parsing) is **new V3 work**.

*Configuration:* the allowed-profile list and the **allowed `level_idc` set** (the 12 values above, plus the 1b encodings) are constants in `config/storefront_media.php` (video section), not a tenant setting; the validator tests set membership, **never `<=` on `level_idc`**, because the numeric order is not the level order for the 1b encodings and because values between valid levels are not levels. **Narrowing may ship at once; widening (e.g. Level 4.2, High 10) requires V-G4 device evidence first.** Rejection messages (AR/EN) carry the re-export hint, e.g. *H.264 High / Main / Baseline, 8-bit, 4:2:0, level 4.1 or lower — `-profile:v high -level 4.1 -pix_fmt yuv420p`*.

*Evidence status:* **[S0]** measured — profile and level extraction (ffprobe agreement) and headless Chrome 155 playback for Baseline 3.0, Main and High 4.0, all `yuv420p`, 640 × 360. **[Unverified]** — Level 4.1 files, every non-4:2:0 or > 8-bit stream, and playback on Safari / iOS / Android. The table is a conservative design target: accepting a combination is not a claim that it plays everywhere until V-G4 passes.

*V3 acceptance / rejection tests* (fixtures from the extended S0 corpus script, each cross-checked against ffprobe `profile`, `level`, `pix_fmt`; a few are hand-built `avcC` / SPS because libx264 will not emit them):
- **Accept:** Constrained Baseline L3.0 · Main L3.1 · High L4.0 (existing S0 fixtures) · **every allow-listed `level_idc`** (10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41) in a hand-built `avcC` / SPS · **Level 1b in both encodings** (profile 66 or 77 with `level_idc` 11 + `constraint_set3_flag` 1; profile 100 with `level_idc` 9) · High L4.1 at 1920 × 1080 / 30 fps inside the caps · a High `avcC` **without** the extension bytes but with a valid 8-bit 4:2:0 SPS (SPS path).
- **Reject, one fixture per code:** High 10 (`yuv420p10le`, profile 110) → profile · High 4:2:2 (122) → profile · High 4:4:4 Predictive (244) → profile · Extended (88) → profile · Main L4.2 and High L5.0 / L5.1 → level unsupported · streams whose `level_idc` is a reserved / undefined value (one fixture each for 0, 8, 14, 29, 39, 45, 99, 255) and **9 on a Baseline / Main stream** → `video_h264_level_invalid` · a profile-100 stream declaring 10-bit, and one with luma 8 / chroma ≠ 8 → bit depth · a profile-100 monochrome (4:0:0) stream and one declaring 4:2:2 / 4:4:4 → chroma · `avc3` entry, missing `avcC`, `avcC` without SPS, High `avcC` without extension and a truncated SPS → config unverifiable · `avcC` says 8-bit 4:2:0 but the SPS says otherwise → config inconsistent.
- **Regression for "`avc1` alone":** a High 4:4:4 / 10-bit `avc1` file must be **rejected** (it would pass an `avc1`-only check); a fixed precedence test (a High 10 4:2:2 file reports `video_h264_profile_unsupported`; a Main stream with `level_idc` 99 **and** 10-bit reports `video_h264_level_invalid`, i.e. rows are evaluated in table order — config, profile, level, bit depth, chroma — and the first failure wins).
- **Fuzz (V-G5):** mutate `profile_idc`, `level_idc` (**exhaustively, all 256 values × the three profiles × `constraint_set3_flag` — a table-driven test, not sampled**), `chroma_format_idc`, bit-depth fields and SPS / `avcC` length fields: 0 uncaught throwables, bounded time and memory, and every mutated file that still parses is accepted **iff** its mutated values satisfy the table (differential against ffprobe-derived expectations).
- **Contract:** a rejected file never reaches storage (existing invariant); the response carries the stable code and the AR/EN hint.
- **V-G4:** every *accepted* profile / level combination in the fixture set (Baseline, Main, High; Levels 3.0 – 4.1) must play on the device matrix; a failing combination is removed from the allow-list before rollout.

### 4.6 MP4 / WebM GO / NO-GO
| Gate | GO when | NO-GO when |
|---|---|---|
| V-G1 R2 | On **real R2**, in both addressing styles, every **gate case** of the scope table below passes | any gate case fails and no safe proxy-side shim exists (a status, `Content-Length`, `Content-Range`, `Content-Encoding` or body mismatch on a request the proxy really sends, or any security case). Missing or different `Accept-Ranges` / provider ETag / `Content-Type` are diagnostic and never fail the gate. **Current state: NOT RUN on real R2 ⇒ NO-GO** |
| V-G2 Laravel load | Authorise endpoint p95 and CPU negligible vs. image route at the target concurrency; throttle + kill-switch proven | per-request cost comparable to streaming |
| V-G3 Edge/Node | N concurrent slow streams (S0-E rig): proxy RSS bounded (≈ streaming figure), no 5xx, API health unaffected | Railway edge truncates/times out 206 streams |
| V-G4 Devices | **iPhone Safari (2 iOS versions), macOS Safari, Chrome Android, Chrome/Firefox desktop** play inline, muted, looped — **every accepted §4.5a profile / level combination**; Low Power Mode shows poster + play; reduced-motion/Save-Data never fetch the video | iOS cannot play through the proxy |
| V-G5 Safety | Fuzz ≥ 500 k MP4 mutations: 0 uncaught, bounded time/mem; rejected files never reach R2 | any parser DoS |
| V-G6 Isolation | Phase 1 matrix per new file name incl. authorise endpoint (other tenant, unpublished, replay of an expired authorisation, forged host) | any cross-tenant byte |
| V-G7 ERP safety | Load test shows **no measurable effect on `/api/health` or invoicing endpoints** while video is saturated | any coupling |
| **WebM** | MP4 shipped **and** Safari/iOS WebM measured on devices | otherwise stays deferred |

**V-G1 gate scope — keyed to the requests that actually reach R2.** Under §4.3a the proxy sends R2 only (a) a full GET with no `Range` and (b) a normalised closed in-bounds `bytes=<start>-<end>`. The merged V0 harness (#1558/#1646) reports 24 required + 14 informational cases; the V-G1 decision reads its per-case results (not its exit status) as follows:

| Class | V0 cases | Role in V-G1 |
|---|---|---|
| **Gate — what the proxy consumes from R2 for the requests it sends** | **R1 full GET:** status `200`, `Content-Length` = authorised `size`, no `Content-Encoding` (R12), body bytes = the uploaded file (hash). **R2 mid-range · R3 `bytes=0-0` · R4 Safari `bytes=0-1` · R10 last byte** (closed ranges): status `206`, `Content-Range` exactly `bytes <start>-<end>/<size>` (the proxy verifies it, §4.3a point 4), `Content-Length` = `end − start + 1`, no `Content-Encoding`, body bytes = that slice (hash) | must pass |
| **Gate — security (independent of range handling)** | **R13 no 3xx on the production-shaped signed requests** (scoped below) · R14 expiry enforced · R15a–d tampered/unsigned variants refused · R16a/b wrong-method refused · R17 unsigned GET refused · R18 no credential/signature leak · R19/R20 host allow-list · verified cleanup | must pass (any failure = security NO-GO) |
| **Diagnostic only — R2 headers the proxy replaces with its own** | `Accept-Ranges` (the proxy always sends its own) · R2's object `ETag` and **R11** (the client sees only the authorised content-derived ETag; R2's value is never sent or compared) · `Content-Type` (from the authorise response) · `Last-Modified` (never issued) · `Server`, request ids | recorded as evidence; absent, weak, varying or different values **cannot fail V-G1** (they must still not leak a credential — R18 is a security gate) |
| **Diagnostic only — never normalised or sent as such** | R5 open-ended · R6 suffix · R7 EOF-clamped (the proxy turns these client forms into a closed range or a full response) · R8 start == size · R9 start > size (answered `416` locally, no R2 request) | recorded as evidence; **cannot fail V-G1** |
| **Diagnostic only — handled locally** | I1/I2 `HEAD` · I3–I5, I13 multi-range/malformed/oversized · I6 `If-Range` · I7 `If-Match`/`If-None-Match` · I8 gzip · I9–I12, I14 | recorded as evidence |

*R13 scope — production-shaped requests only.* R13 ("a presigned request never answers with a redirect") gates V-G1 **only over the signed `GET` requests the production proxy actually sends to R2**: the **full `GET` without `Range`** (R1, and the I9 slow full `GET`) and the **normalised closed in-bounds ranges** (R2, R3, R4, R10; and the closed `bytes=0-15` probes R14-before, R16a/b-after and the I11-0…7 parallel closed ranges). A `3xx` on any of those requests **fails V-G1**: the proxy forces `redirect:'manual'` and treats any `3xx` as the uniform `502`, so a redirecting R2 would break the served path. A `3xx` observed on a **diagnostic request shape the proxy never sends** — `HEAD` (I1), conditional requests (I6 `If-Range`, I7 `If-Match`/`If-None-Match`, handled locally), client range forms (R5 open-ended, R6 suffix, R7 EOF-clamped, I3–I5 multi/malformed ranges, I13 oversized), the gzip probe (I8), the empty-object probe (I12), the negative / tampered / wrong-method / unsigned cases (R14 expired, R15a–d, R16 `PUT`/`DELETE`, R17, I2) and I10 — is **recorded in the report with its case id and is investigated, but does not fail V-G1** (the harness's `redirectGate` counts only `signed` observations and lists the `signed3xx` ids; the decision reads those ids and applies this scope — the same sub-result rule as above). The scope relaxes **only which observations gate**: `guardedFetch` is **unchanged** — it still refuses any host outside the allow-list before every request, still forces `redirect:'manual'`, and never follows a `3xx` for any request shape, gating or diagnostic, so a diagnostic redirect can neither be followed nor leak a credential (R18 stays a security gate). If a later design change makes the proxy send one of the diagnostic shapes upstream, its `3xx` check becomes gating in the same change.

*Gate principle:* a property gates V-G1 only if **the proxy consumes it from R2's response or it determines the integrity of the bytes the proxy relays** (status, `Content-Length`, the `Content-Range` it verifies, `Content-Encoding`, the body). A header the proxy synthesises or replaces (`Accept-Ranges`, `ETag`, `Content-Type`, `Last-Modified`) is diagnostic evidence, never a provider requirement — otherwise an R2 that omits `Accept-Ranges` or reports a different object ETag while serving the full and closed-range requests correctly would block V1–V7 for something the production path never reads.

*Reading the harness:* the V0 harness's per-case `pass` for R1–R4 and R10 (and the aggregate R11) also checks `Accept-Ranges`, `ETag` and `Content-Type`, so a `pass: false` can be caused **only** by a diagnostic header. The decision therefore applies the table to the recorded sub-results, not to the boolean: re-check status, `Content-Length`, `Content-Range` and `bodyLen` from each case's `observed` record and the body hash from a re-run that records it; a failure attributable solely to a diagnostic header is noted and does not fail V-G1. **Follow-up (a separate spike change, outside this docs-only PR):** make the harness record each sub-check (status, length, range, encoding, body hash, and every synthesised header separately) so the decision is mechanical.

*Consequences:* (i) this scope **supersedes the wording of V0 report §7** where they differ — §7 still lists R5–R7 and R9 as blockers; that text should be conformed in a separate docs change (this PR touches this document only); (ii) a harness run in which only diagnostic cases fail does **not** make V-G1 fail, and one in which any gate case fails does; (iii) if a later design change makes the proxy forward a raw client range form to R2, the corresponding case becomes a gate case again; (iv) the V2 spy test (§4.3a point 6) pins that the upstream `Range` is always closed and in-bounds, which is what keeps this scope true. **None of this changes the status: V-G1 has not been run on real R2 ⇒ NO-GO.**

---

## 5. Database and API changes — approval map

| # | Change | Needed for | Breaking? | **Owner approval** |
|---|---|---|---|---|
| 1 | **Dockerfile:** `libavif-dev`, `gd --with-avif`, pinned base tag, AVIF smoke assertion | AVIF | No (image change) | **REQUIRED** |
| 2 | New closed file name `animated.avif` (PHP regex, proxy regex, TS twin), `animation.format` enum += `avif`, accept `image/avif` uploads, env flag `STOREFRONT_MEDIA_AVIF_ENABLED` (default **false**) | AVIF | Additive (old storefront ignores unknown format → still) | Informational |
| 3 | `kind='video'`, `mime video/mp4`, `variants` JSON entry — **no schema change** | video | No | None |
| 4 | **Poster ownership — RESOLVED: P2 approved and granted (see Status update); P1 is superseded and must not be built.** *(Original options kept for the record only.)* *Option P1:* nullable `storefront_media.poster_media_id` (additive migration; deletion/reference checks extended) — your earlier "preferred" design. *Option P2 (new, recommended to evaluate):* **the poster is part of the video asset** — uploaded in the same request, processed by the existing static pipeline into the asset's own ladder (exactly how animated assets already own a first-frame ladder). **Zero migration, no cross-asset reference, no deletion-protection problem**; trade-off: a poster is not reusable elsewhere and the upload takes two files | video | P1: schema change (**superseded — do not implement**) · P2: none | **GRANTED — P2 only.** No decision pending |
| 5 | **Video upload endpoint** (multipart `video` + `poster`) or extension of the existing `files[]` contract | video | Additive | **REQUIRED** (new API surface) |
| 6 | **Internal authorise endpoint** (gateway-secret protected, forwarded-host scoped) returning a presigned R2 URL | video | Additive, internal | **REQUIRED** (new API + security design) |
| 7 | ADR clarifying AMEND-1: *server-to-server signed R2 fetch by the storefront proxy is not "direct R2 exposure"* | video | Contract interpretation | **#7a interpretation — covered in principle by the B2 approval (documented owner decision). #7b ADR text — NOT written, acceptance NOT granted: drafted in V0, acceptance REQUIRED before V1.** No approval of the text is assumed. |
| 8 | Payload: additive `video` object next to `sources` (poster ladder); public closed names `video.mp4` | video | Additive | Informational |
| 9 | `MediaRef` document contract | — | **No change** | None |
| 10 | Staging environment (own DB + R2 test bucket + hostname) and/or an owner-supervised production canary | V-G3/V-G4, AVIF G-A3 | Infrastructure | **REQUIRED** |
| 11 | R2 test bucket + scoped token for the V-G1 spike | V-G1 | Credentials | **REQUIRED** |
| 12 | CSP Report-Only on the storefront (`media-src 'self'` suffices under B2) | video | Production header | **REQUIRED**, later slice |

### 5a. P2 asset identity — the poster is part of the identity (no migration)

*Current behaviour* **[Repo]**: `StorefrontMediaService::upload` hashes the **one** uploaded file (`sha256`), looks up an *active* asset of the same tenant with that hash (index `tenant_id, sha256`, non-unique) and, on a hit, returns the existing asset **before** the quota check and before any storage write; the media ETag is derived from `sha256` + file name. Under P2 an asset is **two** uploaded files. Reusing this lookup on the video hash alone would deduplicate "the same MP4 with a corrected or differently cropped poster" onto the first asset and silently keep the old poster (and the old ETag).

*Rule (V3):*
1. **Composite digest.** `asset_digest = SHA-256( "awj-video-asset/v1" ‖ 0x00 ‖ SHA-256(video upload bytes) ‖ SHA-256(poster upload bytes) )`, the two inner digests as fixed-length raw bytes (32 + 32, so there is no concatenation ambiguity), written as 64-char hex into the existing `sha256` column. Hashes are over the **uploaded** bytes, not re-encoded output, so an identical re-upload deduplicates and any change to either file does not. No schema change; the existing tenant-scoped, active-state lookup and the ETag formula keep working unchanged, and the poster ladder's ETag now changes with the poster.
2. **Domain separation.** A plain image/animated asset stores the SHA-256 of its raw bytes; a composite digest carries the version tag, so a video asset can never be matched as an image (or the reverse) short of a SHA-256 collision. Lookup is by the composite digest **only** — never by the video hash alone or the poster hash alone.
3. **Order.** Validate both files first (reject-don't-repair; a missing poster is `video_poster_required`), then compute the digest from the validated uploads, then look up; a miss creates the asset, a hit returns it with no storage write and no quota charge.
4. **Audit fields without a migration.** The component hashes are kept in the asset's `variants` JSON (`video.sha256`, `poster.source_sha256`).
5. **Accepted cost.** The same MP4 with a different poster is stored again (≤ 15 MB, counted against the tenant quota). Sharing the video object between assets (content-addressed storage) is a later optimisation, not part of V3.
6. **Known pre-existing property (not changed here):** lookup-then-insert is not atomic and the index is non-unique, so two simultaneous identical uploads can produce two assets today for images as well; V3 decides whether to serialise per tenant.

*Required V3 tests:* same MP4 + same poster → `deduplicated`, same id, no storage write, no quota change · **same MP4 + different poster (corrected or cropped) → new asset id, poster ladder and ETag from the new poster, first asset untouched** · different MP4 + same poster → new asset · poster/video roles swapped → both rejected by the validators, and the swapped pair's digest differs from the original's · an image whose bytes equal the video's SHA-256 input can never match a video asset (domain separation) · tenant isolation (same pair in another tenant → independent assets) · soft-deleted asset does not deduplicate.

Explicitly **not** needed: new service, queue worker, ffmpeg, transcoding, public bucket/CDN, changes to accounting/ERP code.

---

## 6. Proposed PR sequence (small, independently testable, each flag-gated/inert)

Each PR: own branch, docs-style evidence section, sqlite+pgsql CI; none touches ERP/accounting.

| PR | Scope | Depends | Approval | Test / exit evidence |
|---|---|---|---|---|
| **P2-0** *(done — #1552)* | Proxy safety (no behaviour change): bounded body size + concurrency cap on the buffered image path; test pinning "Laravel-served bytes are never streamed to clients" | — | — | vitest; S0 `proxy-memory.js` rerun for 5 MB |
| **A0** | Dockerfile AVIF + pinned base + smoke assertion; **no consumer** | — | **#1** | Build green; `gd_info` AVIF true in CI image; size/time delta recorded |
| **A1** | `AvifContainerInspector` (pure PHP) + header-first bomb guard + metadata rejection; unit/fuzz tests; **not wired** | A0 | — | Fuzz ≥ 500 k, bomb RSS ≈ idle |
| **A2** | Upload branch for AVIF (flag **off**): limits, codes, GD-decoded poster, ladder, no-storage-on-reject, quota, kill-switch | A1 | — | PHP feature tests incl. isolation; sqlite+pgsql |
| **A3** | Delivery + render: `animated.avif` vocabulary, payload format, `<source type="image/avif">`, picker/Canvas pick-up, i18n | A2 | — | Playwright (Chromium/WebKit/Firefox) + **device matrix G-A3** |
| **A4** | Canary enable (config only) | A3 + G-A1…G-A5 | **#10** | Rollback drill |
| **V0** | Delivery spike → written results + ADR draft (throwaway scripts): V-G1, V-G2, V-G4 stub. *Harness merged (#1558, #1646); **real-R2 run outstanding — V-G1 NO-GO*** | R2 token | **#11** (ADR #7b is *drafted* here; drafting needs no approval) | Go/no-go on B2 |
| **V1** | Internal authorise endpoint + presign (flag **off**), isolation tests, throttle | V0 | **#6** and **#7b** (accepted ADR text) | Isolation matrix; expiry/replay tests |
| **V2** | Next `video` route: Range validation + **proxy-side evaluation of `If-Match` / `If-None-Match` / `If-Range` in RFC 9110 §13.2.2 order (§4.3a; no conditional header ever forwarded, `304`/`412` without an R2 call), status-specific `Content-Range` (206/416 only) and a locally composed `HEAD`**, authorisation cache, caps, 206/416 | V1 | — | Node tests; S0-E rig; **V-G3, V-G7** |
| **V3** | Video asset + MP4 validator (flag **off**): `kind=video`, limits/codes, **H.264 profile / level / bit-depth / chroma policy (§4.5a)**, **poster uploaded with the video (P2, no migration)**, composite asset identity (§5a), publish-gate slots, purge | V0 decision (**V-G1 passed on real R2**) | **#5** (#4 already granted) | Fuzz ≥ 500 k (incl. `avcC` / SPS fields), gate + isolation tests, §5a identity tests, §4.5a accept / reject fixtures |
| **V4** | Storefront `MotionVideo` (poster, IntersectionObserver gating, reduced-motion/Save-Data/no-JS, `MotionToggle`), backdrop + slider | V2, V3 | — | Playwright 3 engines + **V-G4** |
| **V5** | Admin UI: upload (video+poster), badge, errors AR/EN/RTL; Canvas shows poster (+ optional play) | V3 | — | vitest + visual |
| **V6** | CSP Report-Only | V4 | **#12** | Zero unexplained violations |
| **V7** | Canary enable | V4, V5, all V-gates | **#10** | Rollback drill |
| **W (later)** | WebM alternate source | V7 + Safari evidence | — | Device matrix |

Recommended order: **P2-0 → (A0…A3 and V0 in parallel) → V1 → V2 → V3 → V4/V5 → V6 → canaries.** AVIF is smaller and independent; video carries the value and the risk, so its delivery gate (V0) runs first.

---

## 7. Risks and blockers

| # | Risk / blocker | Level | Mitigation / owner action |
|---|---|---|---|
| R1 | Video bytes reaching the Apache pool would endanger invoicing/ledger availability | **Critical** | B2 design; V-G7; fail closed to poster; no Laravel streaming fallback |
| R2 | R2 Range/presigned behaviour unproven (no credentials in S0) | High | V0 with a test bucket |
| R3 | No real-device evidence for animated AVIF, WebM, or MP4 via the proxy | High | Device matrix gates; owner iPhone testing already available |
| R4 | Single Node replica becomes the video bottleneck (CPU/egress/memory) | Medium–High | Caps, per-IP limits, load test; staging/canary |
| R5 | libavif/dav1d C attack surface + image-rebuild/CVE duty | Medium | Pinned base, header-first guard, fuzz, rebuild policy |
| R6 | AVIF fallback loses animation on non-supporting browsers | Medium | Offer AVIF only after G-A3; GIF/WebP remain default |
| R7 | Presigned URL is a bearer token | Medium | Server-to-server only, 60–120 s TTL, host allow-list, log redaction |
| R8 | New upload/authorise APIs need owner decisions (poster design is settled: P2) | Process | §5 (#5, #6) |
| R9 | Railway edge behaviour for 206 unmeasured | Medium | V-G3 |
| R10 | Headless CI cannot prove animation/H.264 playback | Medium | Chrome stable + WebKit/Firefox Playwright + real devices |
| R11 | Phase 1 itself: animated WebP and non-iPhone devices still unverified; proxy buffers ≤ 5 MB bodies (≈ 600 MB at 100 slow clients, extrapolated from the 15 MB measurement) | Medium | Close Phase 1 gaps first; P2-0 |

Out of scope and untouched: banner text/layout, accounting/ERP modules, `MediaRef` contract, the 40 M budget.

## 8. Final recommendation

1. **Do not start video on the proposal's delivery design.** Adopt **B2** (Laravel authorises, Node streams from R2 via server-to-server presigned URL) and spend the first video effort on **V0** (needs your R2 test token + ADR approval). If V-G1 fails, video stays NO-GO — do **not** fall back to Laravel streaming.
2. **AVIF:** approve A0 (image change) and proceed A0→A2 behind the flag; **hold A3/A4 until iOS Safari animated-AVIF is measured on a real device.** If iOS does not animate it, drop AVIF; Phase 1 formats stay.
3. **WebM:** defer; revisit after MP4 canary with Safari evidence.
4. **Approvals needed now:** #1 (image), #5/#6 (new upload and internal authorise APIs), #10 (staging or supervised canary), #11 (R2 test bucket/token). **Not needed yet but required before V1:** #7b (acceptance of the AMEND-1 ADR text, drafted in V0; the interpretation #7a is already covered by B2). CSP (#12) can wait.
5. **Before any Phase 2 rollout:** close the Phase 1 verification gaps (animated WebP, second iOS version, Low Power Mode, reduced motion on device) and take the 5-minute decision on the default of `STOREFRONT_MEDIA_ANIMATED_ENABLED` noted in the staging-acceptance document.

## 9. Testing status and identifiers
- **Testing:** none run — this is a documentation-only review (no code changed). Evidence is cited from existing S0 results and read-only checks; the new read-only checks are the Railway build log, two Cloudflare R2 doc pages, MDN and php.net.
- Branch `claude/awj-animated-media-support-7kzzga` (PR #1551). First written against `main` `1296e1ce7`; the review-resolution revision merges `main` at `f5bb08f8a` (which contains #1552, #1558 and #1646) and changes this document only. Head SHA: see the PR.
- Review-resolution revision (docs only): validator contract §4.3a, asset identity §5a, P2-only reconciliation (§5, §6, §7, §8), delivery-status ledger and gate rule (Status update). Checks run: reference/link and SHA verification against the tree, RFC 9110 §13.1.5 text check, source-of-truth re-read of `StorefrontMediaService::upload`/media ETag, V0 look-alike I6 result re-read. No code, test or infrastructure change.
- No merge, deployment, migration, infrastructure or production change was made.
