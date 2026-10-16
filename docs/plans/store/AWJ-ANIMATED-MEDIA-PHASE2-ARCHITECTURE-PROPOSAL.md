# AWJ-ANIMATED-MEDIA Phase 2 — Architecture Proposal (Animated AVIF · MP4 · WebM)

| | |
|---|---|
| **Status** | **PROPOSAL for review — design only.** Nothing in this document is implemented. |
| **Owner decision (2026-10-16)** | Phase 2 approved *for technical design only*. **No schema migration, no new infrastructure, no breaking contract change** until this design is reviewed. |
| **Builds on** | PR #1541 (Phase 1: animated GIF / animated WebP) and the V0 contract (`CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md`, AMEND-22) |
| **Related** | `AWJ-ANIMATED-MEDIA-IMPLEMENTATION-REPORT.md`, `AWJ-ANIMATED-MEDIA-PHASE1-ACCEPTANCE-REPORT.md` |

> **How to read evidence in this document.** Every claim is tagged:
> **[Repo]** verified in this repository · **[Ext]** from an external primary source (linked) · **[Env]** measured in the session sandbox · **[Unverified]** believed true but *not* confirmed — each one is turned into a spike in §11 before anything depends on it.

---

## 0. Summary and recommendation

| Capability | Verdict | Recommended path |
|---|---|---|
| **Animated AVIF** | Feasible, **blocked on one image-runtime change** | Add libavif to the production PHP image (`gd --with-avif`) **after a spike proves** GD decodes the first frame of an AVIS file; add a pure-PHP ISOBMFF validator (same approach as the GIF/WebP parser). Same delivery shape as Phase 1 (`animated.avif`, additive `animation` payload, still first-frame ladder as fallback). **No schema migration.** |
| **MP4 (H.264) video** | Feasible, **largest slice**; needs a delivery change | Treat video as a new library **asset kind** (`kind = video`) with a **merchant-supplied static poster**; keep **`MediaRef` unchanged** (no document-schema change); fixed safe playback policy (muted, looping, inline, viewport-gated, poster-only under reduced-motion / data-saver). **Range-capable delivery** end-to-end (R2 → Laravel → Next proxy). One **additive** migration (poster link) needs your approval. |
| **WebM** | Feasible, **lower priority** | After MP4: accept VP9/VP8 WebM as an *alternate* encode of the same asset (smaller files; Safari support must be proven by spike). Not required for MVP. |
| **Server-side poster extraction / transcoding / metadata remux** | Optional, **defer** | Would need `ffmpeg` (new binary and likely a separate worker service). Not needed if the poster is merchant-supplied and non-conforming files are *rejected* instead of transcoded. |

**Principle:** keep the Phase 1 architecture. A video/AVIF is *another file of a library asset*, delivered through the *same* Published-reference gate, tenant isolation, uniform-404 and proxy; the **document contract (`MediaRef`) does not change**, so no stored presentation document is rewritten, and a rolling deploy is safe in both directions.

**Decisions I need from you are collected in §12.**

---

## 1. Constraints (verified facts)

### 1.1 Production runtime

| Fact | Tag |
|---|---|
| Backend image is `php:8.3-apache` (Debian), `mod_php` + **prefork** MPM (one process per concurrent request) | **[Repo]** `Dockerfile` |
| GD is configured `--with-freetype --with-jpeg --with-webp` — **no AVIF** (`gd_info()` here also shows `AVIF Support` empty) | **[Repo]** `Dockerfile`; **[Env]** |
| No `ffmpeg`, `ffprobe`, Imagick in the image (only `poppler-utils` besides build libs) | **[Repo]** `Dockerfile` |
| `QUEUE_CONNECTION=sync`; no cron/worker in production (V0 §7.5 rule 4) | **[Repo]** `Dockerfile`, V0 contract |
| PHP limits: `upload_max_filesize=20M`, `post_max_size=128M`, `memory_limit=256M` | **[Repo]** `deploy/php/awj-uploads.ini` |
| `R2StorageService::get()` takes **no `Range`** parameter; `put()` has a known stream bug so callers pass byte strings | **[Repo]** `app/Services/R2StorageService.php`, `StorefrontMediaService` comment |
| The Next proxy buffers the whole body (`arrayBuffer()`), only forwards `If-None-Match`, only accepts `200/304` from the origin | **[Repo]** `storefront/src/app/api/storefront/media/customizer/[id]/[file]/route.ts` |
| Storefront ships as a Node 22 **standalone Docker image on Railway** (`storefront/Dockerfile`); `vercel.json` also exists (previews) — **production host to confirm** | **[Repo]**; **[Unverified]** which host serves production |
| The storefront sets **no CSP** and no `media-src`/`img-src` today | **[Repo]** (`next.config.ts` has no `headers()`, `proxy.ts` sets none) |
| `<video>` is not used anywhere in `web/` or `storefront/` | **[Repo]** |

### 1.2 External facts

| Fact | Tag / source |
|---|---|
| PHP ≥ 8.1 GD can read/write AVIF **only when built `--with-avif` against libavif ≥ 0.8.2**; `imageavif()`/`imagecreatefromavif()` exist only then | **[Ext]** [php.watch — GD AVIF](https://php.watch/versions/8.1/gd-avif) |
| `imagecreatefromgif` loads only the first frame of an animated GIF; **whether `imagecreatefromavif` does the same for an AVIS file is not documented** | **[Ext]** [php.net](https://www.php.net/function.imagecreatefromgif.php); gap → **spike S0-A** |
| AVIF (still) support: Chrome 85, Edge 121, Firefox 93, Safari 16.1 | **[Ext]** [MDN — image types](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) |
| Animated AVIF: **Firefox 113+** documented; Chrome/Safari animation versions **not stated** by MDN | **[Ext]** MDN (same page); **[Unverified]** for Chrome/Safari → **spike S0-D** |
| Safari/WebKit on macOS **and every iOS browser** needs a **`206 Partial Content`** + well-formed `Content-Range` answer to a `Range` request to play `<video>`; a plain `200` often fails or cannot seek | **[Ext]** WebKit bugs [229413](https://bugs.webkit.org/show_bug.cgi?id=229413) / [211295](https://bugs.webkit.org/show_bug.cgi?id=211295) (quoting a WebKit engineer), [Discourse thread](https://meta.discourse.org/t/issue-playing-videos-on-ios-and-macos-safari/387497) |
| Cloudflare R2's S3 API marks `GetObject` **`Range` as implemented** (single/suffix/multi-range behaviour not itemised) | **[Ext]** [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/); detail → **spike S0-B** |

---

## 2. Goals and non-goals

**Goals:** animated AVIF; MP4 and WebM *video banners* in the same slots Phase 1 supports (section backgrounds, slider slides); autoplay-muted-loop with poster, lazy loading, reduced-motion respect, pause control; full tenant isolation and publication gating; backward compatibility; no unrelated ERP/accounting change.

**Non-goals (explicit):** video with sound, user-controlled players, long-form video, streaming (HLS/DASH), live, server-side transcoding in P2-MVP, third-party video hosts (YouTube/Vimeo — V0 rejected for CSP/LCP), video in logo/gallery/content blocks, per-frame crop/rotate.

---

## 3. Animated AVIF

### 3.1 Decoder and production compatibility

| Option | What | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | Rebuild the PHP image with `libavif-dev` and `docker-php-ext-configure gd … --with-avif`; decode the first frame with GD; validate/measure the file with a **pure-PHP ISOBMFF parser** (like `StorefrontAnimatedImage`) | No new runtime process; one shared-library dependency; same architecture as GIF/WebP; image already smoke-tested in `Dockerfile` (`gd-runtime-smoke.php`) | Needs the **Dockerfile/image change** (needs your approval); libavif ≥ 0.8.2 must be available on the Debian base (**[Unverified]** — `apt-cache policy libavif-dev` in the image build); **GD first-frame behaviour on AVIS unproven** (S0-A) |
| B | Ship the `avifdec` CLI (`libavif-bin`) and call it with `proc_open` (timeout, `ulimit`) | Deterministic frame-0 extraction even if GD does not handle sequences | A new binary executed on untrusted input; process-spawn cost under prefork |
| C | Imagick + libheif/aom | Mature | Heaviest dependency; large attack surface; against "avoid heavy dependencies" |

**Recommendation:** A, with B as the documented fallback *only if S0-A shows GD cannot decode an AVIS first frame*. C is rejected.

### 3.2 Validation (pure PHP, no decode of pixels beyond frame 0)

Parse ISOBMFF boxes with hard bounds (box size ≤ file, depth ≤ 8, box count cap, no 64-bit size overflow):
- `ftyp` major/compatible brands: accept `avis` (sequence) / `avif`; **reject** if neither brand is present.
- Dimensions from `ispe`; frame count and duration from the `moov/trak/mdia` (`mdhd` timescale + `stts`/`stsz`) of the image-sequence track; loop from `elst`/edit list (if present).
- Same budgets as Phase 1: bytes (5 MB), frames (300), duration (20 s), edge (2560), pixels (2.5 MP), frames×pixels (40 M; was 150 M when this proposal was written — lowered in the Phase 1 hardening round).
- **Metadata policy:** rewriting `meta/iloc` to strip Exif/XMP items is fragile (item offsets). **Proposal: reject** an AVIF that declares `Exif`/`mime` (XMP) items (`iinf` item types), with a clear code (`avif_metadata_present`) and a hint to re-export — instead of silently serving private metadata. (Alternative: serve as-is and document the exposure — *not recommended*.)
- Poster: first frame via GD → feeds the existing WebP+JPEG ladder (identical to Phase 1).

### 3.3 Delivery and rendering

- New closed file name `animated.avif` (`image/avif`), served exactly like `animated.gif|webp` (same controller, gate, headers). Extending the closed vocabulary `animated.(gif|webp|avif)` touches the PHP regexes, the proxy regex and `isCustomizerAnimatedFile` (additive).
- `<source type="image/avif">` is placed in the Phase 1 slot (after the reduced-motion stills). **Graceful degradation is built in:** a browser that supports *still* AVIF but not AVIS would match the `type` and show frame 0 — which *is* the poster (acceptable). A browser with no AVIF support skips it and gets the still ladder.
- **No dual animated encodes in MVP** (one animated file per asset). If a merchant needs maximum reach, upload GIF/WebP; AVIF is the "small file" choice. (Option: allow two uploads linked as one asset — deferred.)
- Payload: the existing additive `animation` field, `format: "avif"` (`readAnimation` allow-list extended).

### 3.4 Compatibility gate (before building)
Animated-AVIF browser matrix must be **measured**, not assumed (Chrome, Safari 16.4+, iOS, Firefox 113+) — spike **S0-D**. Ship only if the *measured* matrix is acceptable; otherwise AVIF stays "not offered" and Phase 1 formats remain the recommendation.

---

## 4. Video (MP4 · WebM)

### 4.1 Asset model — no document change

A video is a **library asset** (`storefront_media.kind = 'video'`), referenced from the document by the *existing* `MediaRef {mediaId, alt, decorative}`. The renderer discovers it is a video from the **resolved payload**, exactly how Phase 1 discovered `animation`. The presentation document, its normalisers, and the JSON fixture stay **byte-identical**.

Columns already fit (`kind` string(16), `mime` string(32): `video/mp4` 9, `video/webm` 10; `variants` JSON). Stored file: `video.mp4` (`video.webm`) in the existing tenant-prefixed R2 domain; purge works through the existing `variantList()` (**[Repo]** `StorefrontMediaReconciler`).

**The one schema addition (needs approval):** a *poster link*. Options:

| Option | Integrity | Cost |
|---|---|---|
| **P1 (recommended)** additive nullable column `storefront_media.poster_media_id` (uuid, FK-like) | Enforced: a poster in use cannot be deleted (reference scanner + delete check extended); no JSON drift | **One additive migration** (nullable, no backfill, down-migration drops the column) — **requires owner approval** |
| P2 store `poster_media_id` inside `variants` JSON | No migration | Soft reference; deletion/usage checks must special-case JSON; easier to corrupt |

### 4.2 Playback policy (fixed, safe defaults — no per-usage options in MVP)

`muted`, `playsinline`, `loop`, no controls, `preload="none"` (below the fold) / `"metadata"` (first section), **autoplay only while ≥ 50 % in view** (IntersectionObserver), **paused when off-screen or tab hidden**, **poster always present** (the linked static asset, full ladder), `aspect-ratio`/`width`/`height` set (no CLS). Visitor signals: `prefers-reduced-motion: reduce` → **poster only, video never fetched**; `Save-Data` / `navigator.connection.saveData` → poster only; iOS **Low Power Mode** (autoplay blocked) → poster stays, a visible play button appears. The Phase 1 `MotionToggle` is reused as the pause/play control (WCAG 2.2.2). Background video is `aria-hidden` (decorative), slider-slide videos use the slide's alt.

*If per-usage choices are later wanted (autoplay off, controls):* additive optional `MediaRef` keys (e.g. `playback`). That is a **contract change** (PHP normaliser + two TS twins + `media-ref.json` + ADR), and an *old* normaliser silently drops an unknown key → falls back to the safe default, so it is rolling-deploy safe — but it is out of the MVP.

### 4.3 Validation and metadata (no ffprobe in production)

| Need | Approach A (recommended): pure PHP | Approach B: `ffprobe`/`ffmpeg` |
|---|---|---|
| **Container/codec allow-list** | MP4: `ftyp` brands (`isom`, `mp41`, `mp42`, `iso2`, `avc1`); `moov/trak/mdia/minf/stbl/stsd` codec FourCC **`avc1` only** (H.264); reject `hvc1/hev1` (patent/browser support), reject fragmented MP4 (`moof`) | Same checks via `ffprobe -show_streams` |
| **Duration / size / fps / bitrate** | `mvhd` (timescale, duration), `tkhd` (w×h), `stts` (fps), file size/duration ⇒ bitrate; enforce ≤ 15 s, ≤ 1920×1080, ≤ 30 fps, ≤ 4 Mb/s, ≤ 15 MB | `ffprobe` JSON |
| **Fast-start** (`moov` before `mdat`) | Detect by box order; **reject** with a re-export hint (`video_not_faststart`) | Auto-fix with `-movflags +faststart` |
| **Metadata/GPS** (`udta`, `meta`) | Reject files carrying `udta` GPS (`©xyz`) or `meta` items — or strip `udta` and patch `stco/co64` offsets (delicate; needs fuzz tests) | `-map_metadata -1 -c copy` |
| **Poster** | **Merchant-supplied static asset** (§4.1); optional later: first-frame extraction | `ffmpeg -ss 0 -frames:v 1` |
| **WebM** | EBML header `DocType=webm`; `Segment/Info` (`TimecodeScale`, `Duration`); `Tracks/TrackEntry` (`CodecID` `V_VP9`/`V_VP8`, `PixelWidth/Height`); require `Cues` (seekable) | `ffprobe` |
| **New runtime** | none | `ffmpeg` in the image (~+100 MB) **or** a separate worker service; executed on untrusted input (sandbox flags, `ulimit`, timeouts); `QUEUE_CONNECTION=sync` ⇒ blocks the request |

**Recommendation:** **A for the MVP** (zero new binaries; strict *reject-don't-repair* policy, clear error codes, merchant poster). **B only as a later slice** if merchants cannot be expected to export conforming files — and then as a **separate worker service**, not inside the Apache web image.

New error codes (stable, localised like Phase 1): `video_unsupported_codec`, `video_too_long`, `video_too_large`, `video_resolution_too_high`, `video_bitrate_too_high`, `video_not_faststart`, `video_metadata_present`, `video_poster_required`.

### 4.4 WebM
Same asset can carry **one** file in MVP. WebM is attractive (VP9 smaller) but **Safari/iOS WebM playback is [Unverified]** → spike S0-D decides whether WebM is an *alternate* `<source>` next to MP4 (then an asset holds two files: `video.mp4` required, `video.webm` optional) or is dropped.

---

## 5. HTTP Range delivery and storage strategy

### 5.1 Why it is mandatory
Safari/iOS will not play a video from a server that answers `Range` with `200` **[Ext]** (§1.2). Today **neither** hop supports it: `R2StorageService::get()` has no range, and the Next proxy buffers and drops `Range` **[Repo]**.

### 5.2 Options

| Option | Flow | Pros | Cons |
|---|---|---|---|
| **A (recommended for MVP)** Stream through Laravel + streaming proxy | Browser → Next proxy (streams, forwards `Range`/`If-Range`) → Laravel `video` route (re-runs the **Published-reference gate**, parses a *single* `Range`, calls R2 `GetObject` with `Range`, answers `206` + `Content-Range` + `Accept-Ranges: bytes` + `Content-Length`) → R2 | **Keeps AMEND-1/4/16 intact** (no direct R2 URL; gate on every request; revocation within the cache window); same tenant-isolation tests apply | Each range request occupies one **prefork Apache worker** while it streams ⇒ concurrency risk with many viewers; Node proxy must stream (no `arrayBuffer`) |
| B Presigned/short-lived R2 URL redirect | Laravel gate issues a short-lived signed R2 URL; browser fetches from R2 directly | Offloads bandwidth and workers | Exposes a (short-lived) direct bucket URL — **contradicts AMEND-1**; revocation window = URL lifetime; CSP `media-src` must allow the R2 host; needs an owner decision |
| C Public R2 custom domain + CDN | Immutable public URLs | Best performance | **Breaks** the Published-reference gate and unpublish semantics — rejected |

**Recommendation:** **A for MVP**, with a **load-test gate** (spike S0-E): 15 MB cap + `preload="none"` keeps typical playback to a few range requests; if the gate fails, move to **B** under a new ADR (amending AMEND-1 explicitly) — not before.

### 5.3 Range semantics to implement (origin and proxy)
Single range only (`bytes=a-b`, `bytes=a-`, `bytes=-n`); multi-range → `416` (or ignore→`200`; decision in ADR); `If-Range` with the ETag; `HEAD`; correct `416` with `Content-Range: bytes */len`; `Content-Length` = range length; `Accept-Ranges: bytes`; **content-derived ETag** as today; origin stays `private, no-store`, the proxy is the only layer that may set `public, max-age=300, must-revalidate` (and must not cache a `206` as a `200`). Add a per-IP `throttle` on the video route (range-flood protection).

### 5.4 Storage
Unchanged domain/keying (`tenant/{tenant}/storefront-media/{id}/video.mp4`), `put()` with a byte string (≤ 15 MB fits `memory_limit=256M`; the stream bug stays out of scope), dedupe by sha256, per-tenant quota counts video bytes (the existing 1 GB / 500 assets caps apply; propose a separate `max_video_assets` cap). R2 `Range` support itself is **[Ext] "implemented"**; exact single/suffix/416 behaviour is confirmed by spike S0-B before coding.

---

## 6. Media-reference contract changes

| Surface | Change | Breaking? |
|---|---|---|
| `MediaRef` (document) | **None in MVP** | No |
| Resolved payload (`presentation_media`) | Additive `video` object: `{ sources:[{src,type}], width, height, durationMs, loop:true, poster:{ sources:[…] } }` alongside the existing `sources` (= poster ladder) | No (old renderers ignore it → show the poster) |
| Workspace asset API | Additive `kind:"video"`, `video:{…}` for video assets only (static payload byte-identical, as in Phase 1) | No |
| Public routes | Closed file names `video.mp4`, `video.webm` (+ `animated.avif`) | Additive |
| Publish gate | Allowed slots = Phase 1 slots; video requires a ready poster (`video_poster_required`); no transform; contrast uses the same worst-case `[0..255]` bounds | Additive rules |
| Optional later | `MediaRef.playback` | Contract change → separate ADR |

Rollout order makes every step backward compatible: backend ships first (no producer of video until the flag is on) → storefront (ignores unknown payload keys, draws poster) → admin UI (only then can merchants create video).

---

## 7. CSP and security

**Today there is no CSP** **[Repo]**, so video does not *violate* one — but introducing video is the right moment to introduce one **in Report-Only first**.

- Proposed baseline (Report-Only → enforce after a clean period): `default-src 'self'; img-src 'self' data:; media-src 'self'; …` — all media is **same-origin through the proxy**, so `media-src 'self'` suffices under Option A. (Option B would additionally need the R2 host — a reason to avoid it.)
- Response headers on every media route: `X-Content-Type-Options: nosniff` (existing); explicit `Content-Type` from a **server-side allow-list** (never from client/extension); proxy gains a content-type allow-list for `video/mp4|webm`, `image/avif`.
- **Hostile-file defence:** bounded ISOBMFF/EBML parsers (box/element size ≤ remaining bytes, depth and count caps, integer-overflow checks, no recursion without limit); fuzz corpus + truncated/forged-size/zero-size/over-nested fixtures in tests; reject before any R2 write ("a rejected file never reaches storage" invariant preserved). If `ffmpeg` is ever adopted: no network protocols (`-protocol_whitelist file`), `-nostdin`, CPU/mem `ulimit`, wall-clock timeout, run in a separate unprivileged service.
- **Tenant isolation / publication gating:** identical to Phase 1 — media is served only if the **host-resolved storefront's published document** references it; uniform 404; `private, no-store` origin; signed workspace preview URLs re-check tenant. Each new file name gets the Phase 1 isolation test pattern (other tenant, unpublished, wrong extension, transform key).
- **Abuse:** range-flood throttle, cap of simultaneous video streams per IP at the proxy, upload size/duration caps enforced *before* parsing deeply, video asset quota.
- **Privacy:** metadata policy in §3.2/§4.3 (reject-or-strip, never serve GPS/Exif).

---

## 8. Performance and mobile behaviour

- **LCP:** the poster (a normal responsive image from the existing ladder) is the LCP element; video is never LCP. Video bytes load only after hydration, in view, and `preload` as above.
- **Bandwidth:** MVP caps (15 MB, ≤ 4 Mb/s, ≤ 15 s, ≤ 1080p); recommend **720p for phone**: the existing `media`/`mobile` pair lets a merchant attach a *smaller phone video* (each is its own asset) — gated by `(max-width:767px)` source selection, like images.
- **Concurrency on the client:** at most one hero video + one slider video active; others stay on poster (IntersectionObserver).
- **iOS specifics:** `muted playsinline` mandatory for inline autoplay; Low Power Mode blocks autoplay → poster + play button; WebKit needs 206 (§5); iOS Safari fullscreen-hijack avoided via `playsinline`.
- **Server:** prefork workers are the scarce resource (§5.2); CDN caching of the *proxy* output (206 handling) is a CDN feature to verify, not to assume.
- **Battery/data:** reduced-motion and Save-Data short-circuit before any network request (same ordering technique as Phase 1 `<source>` media queries is *not* available for `<video>`, so this is done in a small client component *before* it assigns `src`).

---

## 9. Deployment requirements and rollback

| Item | AVIF | Video |
|---|---|---|
| Image/runtime change | **Yes** — `libavif-dev` + `--with-avif` in `Dockerfile` (needs approval; rebuild + smoke test in `gd-runtime-smoke.php`) | **None** for MVP (pure PHP). `ffmpeg` only if Approach B later (separate service) |
| DB | none | **1 additive nullable column** (`poster_media_id`) — needs approval (or P2: none) |
| Config / flags | `STOREFRONT_MEDIA_AVIF_ENABLED` (default **false**) | `STOREFRONT_MEDIA_VIDEO_ENABLED` (default **false**); limits in `config/storefront_media.php` |
| Storefront | proxy regex + payload allow-list | streaming proxy with Range, `MotionVideo` component, CSP Report-Only |
| Order | backend → storefront → admin | backend (route + gate + flag off) → storefront → admin; enable per canary tenant |
| Rollback | flag off ⇒ uploads refused; existing assets keep rendering their first-frame still (payload `animation` ignored if the storefront is rolled back) | flag off ⇒ no new uploads; **already-published videos degrade to their poster** (the gate keeps serving the poster ladder); storefront rollback ignores `video` payload ⇒ posters; the nullable column is inert, so no down-migration is urgent (a safe `dropColumn` exists) |
| Verify before enabling | S0-A…E spikes green; real-device matrix (§10) | same + load test (S0-E) |

No step touches accounting/ERP modules; no stored presentation document is rewritten.

---

## 10. Test and verification plan (applies to every slice)

1. **Backend (PHP):** parser unit tests with real fixtures + forged/truncated/oversized/over-nested/zero-size; upload limits and stable error codes; no storage write on rejection; Range semantics matrix (206/416/HEAD/If-Range/multi-range/suffix); **tenant isolation and publication gating per new file name** (cross-tenant, unpublished, unknown extension, transform key); contrast worst-case bounds; kill-switch; sqlite **and** pgsql CI.
2. **Frontend:** vitest for payload validation (drop-on-invalid), source/priority ordering, reduced-motion / Save-Data / no-JS / pause; **Playwright real-browser** spec extended (`e2e/animated-media-visual.spec.ts` pattern): Chromium now; **WebKit and Firefox in CI** (`playwright install webkit firefox`) — the repo's sandbox has Chromium only.
3. **Real devices (manual checklist, because WebKit-on-Linux ≠ iOS Safari):** iPhone Safari (recent + one iOS-version back), iPad Safari, macOS Safari, Chrome Android, Samsung Internet, Firefox desktop; Low Power Mode; Save-Data; RTL; slow 3G throttle. Record pass/fail per format in the slice report.
4. **Load test (S0-E):** N concurrent 15 MB range streams through proxy + Apache prefork; record worker saturation and p95.

---

## 11. Proposed implementation slices

Each slice = its own branch/PR, flag-gated, with the evidence listed. **S0 produces no production code.**

| # | Slice | Contents | Needs approval? | Exit criteria |
|---|---|---|---|---|
| **S0** | **Spikes (throwaway, no prod change)** | **A** GD+libavif in a scratch image: does `imagecreatefromavif` decode frame 0 of an AVIS? libavif version available on the base? **B** R2 S3 `Range` behaviour (single/suffix/416/multi) via the AWS SDK against a test bucket. **C** Reproduce the 200-vs-206 Safari failure on a real iPhone/Mac against a stub server (and confirm the fix). **D** Browser matrix for animated AVIF and WebM/MP4 on real devices (BrowserStack or owned devices). **E** Load test of streamed ranges through Apache prefork + Node proxy | No (scratch only) | Written results appended to this document; go/no-go per format |
| **S1** | AVIF validator + upload (backend, flag off) | ISOBMFF parser, limits, codes, metadata rejection, poster via GD; **Dockerfile change** | **Yes — image change** | Parser fuzz tests, GD smoke, pgsql+sqlite green |
| **S2** | AVIF delivery + render | `animated.avif` file name (origin/proxy/payload/`<source>`), admin badge/preview, i18n; Playwright + device matrix | No (after S1) | Measured browser matrix acceptable; isolation tests pass |
| **S3** | Video asset + validator (backend, flag off) | `kind=video`, MP4 parser (H.264 only), limits/codes, poster linkage, publish gate, delete-protection; **migration `poster_media_id`** | **Yes — migration** | Parser fuzz + gate + isolation tests; migration up/down tested on pgsql |
| **S4** | Range delivery | R2 `Range` read, Laravel 206/416/HEAD route + throttle, streaming Next proxy (+content-type allow-list) | Only if Option B chosen | Range matrix tests; Safari/iOS real-device playback; S0-E gate met |
| **S5** | Storefront video | `MotionVideo` component (poster, IO gating, reduced-motion/Save-Data/no-JS, pause control), backdrop + slider integration, payload `video` | No | Playwright Chromium+WebKit+Firefox, real-device checklist |
| **S6** | Admin UI | video upload (+ poster picker), badge/summary, play preview, localized errors | No | vitest + visual checks AR/EN/RTL, mobile |
| **S7** | CSP Report-Only | Header + report endpoint/logging; review violations; enforcement is a separate decision | No | Zero unexplained violations over an agreed period |
| **S8 (optional)** | WebM alternate; **ffmpeg worker** (poster extraction, remux) | Second file per asset; separate worker service | **Yes — new infrastructure** | Decided after S5 usage data |

---

## 12. Decisions requested from the owner

1. **AVIF:** approve the **Dockerfile change** (`libavif-dev`, `gd --with-avif`) *conditional on spike S0-A*? Or drop AVIF and keep GIF/WebP only?
2. **Video poster:** merchant-supplied poster (recommended) vs. server extraction (needs ffmpeg ⇒ new infrastructure).
3. **Poster link:** approve one additive migration (`poster_media_id`) — or accept the JSON-only variant (weaker integrity).
4. **Delivery:** Option A (stream via Laravel + proxy; keeps AMEND-1) vs. Option B (short-lived signed R2 URLs; needs a formal AMEND to AMEND-1). Recommendation: A, revisit after S0-E.
5. **Policy:** *reject* non-conforming videos/AVIF (no metadata stripping/transcoding in MVP) — acceptable UX?
6. **WebM:** include as alternate (after Safari spike) or defer?
7. **CSP:** agree to start a **Report-Only** CSP as part of video work?
8. **Production host of the storefront** (Railway Docker vs. Vercel) — affects streaming/response-size assumptions.

## 13. Evidence classification (Horizon-style)

| External Evidence | AWJ Decision | Rejected / Not adopted |
|---|---|---|
| Safari/iOS need 206 [WebKit]; R2 implements `Range` [Cloudflare]; GD needs libavif ≥ 0.8.2 for AVIF [php.watch]; AVIF animation: Firefox 113+ [MDN] | Keep `MediaRef` unchanged; assets own their kind; reject-don't-repair; stream via the existing gate; flags default off; spikes before code | YouTube/Vimeo embeds (CSP/LCP, V0); public R2 domain/CDN (breaks publication gate); Imagick; in-web-image ffmpeg; per-usage playback options in MVP; HLS/DASH |
