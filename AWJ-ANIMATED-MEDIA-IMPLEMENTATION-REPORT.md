# AWJ-ANIMATED-MEDIA P1 — Implementation Report

**Scope:** animated media in AWJ Store Builder (Customizer).
**Delivered:** Phase 1 — animated **GIF** and animated **WebP**. **Not delivered (deliberately):** Phase 2 — animated AVIF, MP4, WebM (reasons in §4).
**Status:** PR open, **not merged, not deployed.**

> **Update 2026-10-16:** after the owner's review, the no-JavaScript limitation was fixed, real-Chromium validation was added, an independent security review was run (3 sanitiser issues found and fixed), and Phase 2 was designed. See **`AWJ-ANIMATED-MEDIA-PHASE1-ACCEPTANCE-REPORT.md`** (supersedes the corresponding statements below) and `docs/plans/store/AWJ-ANIMATED-MEDIA-PHASE2-ARCHITECTURE-PROPOSAL.md`.

| | |
|---|---|
| Branch | `claude/awj-animated-media-support-7kzzga` |
| Base SHA | `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5` |
| Head SHA | `1e61bdc8d9bda91424ffc2609e0a7fd7273ff5d0` at PR creation (last code commit `29a09e778bd3cc71e1dd26d75a7334f1b1294fd4`; later commits are doc-only) |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1541 |

---

## 1. Discovery — what already existed

The Store Builder already had a complete, production-verified media system. **Nothing parallel was built.**

| Layer | Existing asset (reused) |
|---|---|
| Storage | `R2StorageService`, domain `storefront-media`, tenant-prefixed keys; fail-closed flag `STOREFRONT_MEDIA_R2_ENABLED` |
| Library | `StorefrontMedia` (`storefront_media`), `StorefrontMediaService` (upload / dedupe / quota / retry / safe delete), workspace API `commerce/workspace/storefront-media*` |
| Variants | `StorefrontMediaVariantGenerator` (Intervention Image on GD → WebP + JPEG ladder 480/768/1280/1920 + thumbs) |
| Delivery | `StorefrontCustomizerMediaController` (Published-reference gate, uniform 404, `private, no-store`, content ETag) behind the same-origin Next.js proxy (only layer allowed `public` cache) |
| Refs / gates | `MediaRef` (mediaId + crop/focal/fit/alt/decorative), reference scanner, publish gate, contrast evidence, derivatives |
| UI | Admin `MediaPicker` / `MediaRefField` / framing editor; storefront `SectionBackdrop`, `HomeSlider`, `MediaImage` |

**Did it already support the requested formats?** No. The library **explicitly rejected** them: V0 contract §7.4 (FROZEN) said *"no SVG, no GIF/animated"*, §21.2 listed GIF/animated and video as *Rejected (motion/a11y, CSP/LCP)*, and the upload returned `animated_not_supported`. There was no `<video>` anywhere, and nothing in the storefront applied `prefers-reduced-motion` to images.

**Decision:** the owner request for this feature is the amendment authority; it is recorded as **AMEND-22** in the V0 contract (and `CLAUDE.md`). The change is additive — no migration, no breaking API change, no change to accounting/ERP modules — so it did not trigger the "stop and ask" rule.

---

## 2. Features implemented (Phase 1)

### Backend
- **`StorefrontAnimatedImage`** — dependency-free GIF / animated-WebP **container parser** (production has no ffmpeg, Imagick or AVIF; GD can neither decode animated WebP nor write animations). It:
  - validates real structure (truncated / malformed / out-of-canvas frames → `image_unreadable`) — MIME and type are read from bytes, never from extension or client type;
  - measures frames, duration (≤10 ms frame delays counted as 100 ms like browsers), loop, canvas size;
  - **sanitises**: drops GIF comments / plain-text / XMP / unknown app extensions (keeps the loop extension) and WebP EXIF / XMP (clears the VP8X flags);
  - extracts the **first frame** as a still (GIF natively; WebP by re-wrapping frame-1 bitstream chunks; a first frame that doesn't cover the canvas → upload refused `animated_poster_unavailable` rather than showing a wrong poster).
- **Upload branch** in `StorefrontMediaService`: bounded frames (300), duration (20 s), edge (2560), pixels (2.5 MP), frames×pixels (**40 M** — lowered from 150 M in the hardening round, see `AWJ-ANIMATED-MEDIA-HARDENING-REPORT.md`), bytes (5 MB default) — all in `config/storefront_media.php → animated`, kill switch `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` (restores the old `animated_not_supported` refusal). 1-frame GIF = ordinary static image. APNG stays rejected. Dedupe / quota / retry work unchanged.
- **Variants:** static WebP+JPEG ladder + thumbs generated from **frame 1** (poster / reduced-motion fallback / admin thumbnails); original kept byte-for-byte; the **sanitised** `animated.{gif|webp}` is the only animated file ever served (stored as an extra `variants` entry, `kind: anim` — no schema change).
- **Delivery:** public controller and signed workspace controller accept `animated.gif|webp` (media-id only, never a transform key) behind the *existing* Published-reference gate, tenant checks, uniform 404, `nosniff`, `private, no-store`, ETag.
- **Resolver:** additive `animation` field `{src, format, width, height, frames, durationMs, loop}`; `sources` is still the static ladder, so any renderer that ignores `animation` shows a correct still image.
- **Workspace API:** additive `kind` + `animation` **only for animated assets** — static asset payloads are byte-identical (guarded by the existing allow-list test).
- **Gates:**
  - contrast — animated assets store **no** pixel evidence; the contrast engine receives worst-case bounds `[0..255]`, so text over motion publishes **only under a scrim that is proven for any frame** (`contrast_unprovable` otherwise; verified: none / 20 % → rejected, 70 % black → publishes);
  - no crop / rotate / focal / fit on animation (`animated_transform_unsupported`; derivative endpoint refuses too);
  - animation publishable only where the storefront renders it — section backgrounds and slider slides — otherwise `animated_not_allowed_here` (no silent still-image surprise in logo / gallery / content blocks).

### Admin UI (`web/`)
- File picker accepts GIF; hint text (AR/EN) updated, still states the real 5 MB limit.
- Library card: `GIF · Animated` / `WEBP · Animated` badge, `12 frames · 1.2 s` summary, **still frame by default**, explicit Play / Stop preview (no autoplay in the editor — respects reduced-motion and keeps the grid light).
- `MediaRefField`: same preview toggle, notice that animations can't be cropped, and the crop/rotate editor is hidden for animations.
- Upload rejections for the new codes are **localized by code** (AR + EN); other codes keep the server text.
- Publish-issue text for the two new publish codes.
- Desktop / mobile variants: the existing `media` + `mobile` pair is preserved — each can independently be animated or static.

### Storefront (`storefront/`)
- Proxy route + path contract accept `animated.{gif|webp}` (UUID only; format must match the extension; anything else 404s before reaching Laravel).
- `readResolvedMedia` validates the `animation` payload strictly (proxy prefix, UUID, `animated.<format>` == declared format, ≥2 frames); invalid → dropped, the still image still renders.
- `animatedPictureSources`: `<source>` ordering contract — **reduced-motion still first** (phone, then desktop), then animated phone, phone stills, animated desktop, still ladder / `<img>` fallback. Honoured by the browser before hydration and without JS.
- `MotionPicture` / `MotionToggle`: pause / play (WCAG 2.2.2, V0 §6.6) via a shared per-id store; control rendered only after hydration and **never** for visitors who prefer reduced motion; lives outside the `aria-hidden` backdrop layer.
- Integrated into `SectionBackdrop` (hero / banner backgrounds, incl. phone art-direction) and `HomeSlider` slides (toggle in the existing control bar). With no animation the markup is unchanged.
- i18n: `home.motion.pause/play` in all 6 storefront locales (ar, en, de, es, fr, pl).

---

## 3. Files changed (46 files, +2909 / −95)

**New:** `app/Services/Commerce/StorefrontAnimatedImage.php` · `storefront/src/components/ui/motion-picture.tsx` · `storefront/src/lib/presentation/animated-sources.ts` · `web/.../media/MotionPreview.tsx` · tests: `tests/Feature/{StorefrontAnimatedImageTest,StorefrontAnimatedMediaTest,AnimatedMediaFixtures}.php`, `storefront/.../AnimatedMedia.test.tsx`, `storefront/.../animated-media.test.ts`, `web/.../AnimatedMedia.test.tsx`.

**Modified (backend):** `StorefrontMediaService`, `StorefrontMediaVariantGenerator`, `StorefrontPublishedMediaResolver`, `StorefrontMediaPublishGate`, `StorefrontMediaContrastEvidence`, `StorefrontMediaDerivativeService`, `StorefrontMediaEvidenceBackfiller`, `StorefrontMedia` (model), `StorefrontMediaResource`, `StorefrontCustomizerMediaController`, `CommerceWorkspaceStorefrontMediaFileController`, `config/storefront_media.php`, `tests/Feature/StorefrontMediaApiTest.php` (two expectations that encoded the old "no GIF / animated" rule).

**Modified (web):** `storefront-media.ts`, `MediaPicker.tsx`, `MediaRefField.tsx`, `messages.ts`, `announcement-status.ts`, `presentation/media-ref.ts`, `store-preview.css`.

**Modified (storefront):** `SectionBackdrop.tsx`, `HomeSlider.tsx`, `globals.css`, `customizer-media.ts`, `resolved-media.ts`, `presentation/media-ref.ts` (byte-identical twin of the web copy), proxy `route.ts` (+ test), 6 message files.

**Docs:** V0 contract (§7.4 + AMEND-22), `CLAUDE.md`, this report.

No accounting, ledger, POS, ZATCA or other ERP module was touched.

---

## 4. Supported formats & limitations

| Format | Status | Notes |
|---|---|---|
| Static JPEG / PNG / WebP | unchanged | same files, same payload shape |
| **GIF** (animated) | ✅ supported | ≤5 MB, ≤300 frames, ≤20 s, ≤2560 px edge, ≤2.5 MP, frames×px ≤40 M (was 150 M) |
| **Animated WebP** | ✅ supported | same limits; first frame must cover the full canvas (else refused with a clear code) |
| GIF with 1 frame | ✅ | treated as a static image |
| APNG, SVG | ❌ | still rejected |
| **Animated AVIF** | ⏸ **not built** | Production `Dockerfile` builds GD `--with-webp` only (no libavif); `gd_info()` here also reports no AVIF. No way to validate or extract a poster ⇒ "support after compatibility validation" fails validation. Needs an image-runtime change (separate, owner-approved). |
| **MP4 / WebM** | ⏸ **not built** | (a) no ffmpeg ⇒ no duration probe or poster generation in production; (b) `R2StorageService::get` has no HTTP Range support and the Next proxy buffers whole bodies — Safari/iOS won't play video without 206 responses; (c) needs a new `MediaRef` kind + normaliser changes (document schema) and a CSP `media-src` decision. That is a migration-class / architectural change, so per the execution rules it stops for approval. |

**Behavioural limitations (by design):**
- Animated media: backgrounds of hero/banner sections and slider slides only; no crop / rotate / focal / fit.
- Text over motion needs a strong scrim (proven for any frame) — otherwise publish says `contrast_unprovable`.
- ~~Visitors without JavaScript get the animation but no pause control~~ **Fixed (2026-10-16):** the server HTML now carries only the still; the animation and its pause control are added together after hydration. Reduced-motion visitors never get the animation.
- An animated hero is its own LCP element and a 5 MB GIF is heavy; animated WebP is recommended (the admin hint does not yet say so).
- The editor Canvas preview shows the first frame (play only in the library / field preview).

---

## 5. Tests & results

| Suite | Result |
|---|---|
| New PHP: `StorefrontAnimatedImageTest` (19), `StorefrontAnimatedMediaTest` (21) — inspector, sanitising, poster, limits, kill switch, dedupe, retry, signed URL + tampered tenant, public delivery gate, **cross-tenant isolation**, unpublish, closed file-name set, resolver, contrast scrim, transforms, slot allow-list | ✅ pass (with `StorefrontMediaApiTest`: 81 tests / 858 assertions) |
| PHP media/storefront regression sweep (779 tests: media, slider, gallery, facet visuals, contrast, presentation, workspace media) | ✅ 0 failures |
| **Full `php artisan test`** (SQLite) | 7262 passed, 139 skipped, **26 failed** — all 26 are `Fuel*` tests failing with `Call to undefined function bcmul()`: **`bcmath` is not installed in this sandbox** (the env hook flagged it; CI installs it). 0 media-related failures. **Not re-run on PostgreSQL** (CI does that). |
| `web` vitest (`store-experience-builder` + `commerce-workspace`, 3282 tests) | ✅ all pass after fixing one regression I introduced (Canvas preview stylesheet parity — fixed in `29a09e7`); new `AnimatedMedia.test.tsx` 8 tests |
| `storefront` vitest (full, 2736 tests) | ✅ 2721 passed, 15 skipped; `tsc --noEmit` clean; `biome lint` at baseline (2 pre-existing warnings) |
| `storefront` `next build` | ✅ exit 0 |
| `web` `npm run build` | ✅ exit 0 |

**Not done / not verified:** no real-browser (Playwright) or visual verification of the animated rendering — rendering is proven at DOM level in jsdom (source ordering, pause, reduced-motion) only; no run against real R2 or production; CI on GitHub not yet observed at the time of writing; `next lint` isn't configured in `web` (interactive prompt), so only `tsc`/build were used there (tsc has pre-existing unrelated errors in other test files).

---

## 6. Security assessment

- **Tenant isolation:** unchanged mechanism (BaseModel scope, `TenantContext`, signed `tenant` param re-checked, host-resolved storefront). Cross-tenant public read and tampered-tenant signed URL tests pass.
- **Authorization:** same workspace RBAC / `denySelfService` / uniform non-revealing 404; public file requires the media to be in the *published* document of the *host's* storefront.
- **Malicious uploads:** type from bytes; strict container validation (bounded loops, hard frame ceiling, no recursion, no decode of pixels in PHP); size/dimension/frame/duration/pixel budgets; truncated and structurally forged files rejected before any storage write ("a rejected file never reaches storage" asserted).
- **Safe delivery:** only the *sanitised* copy is served (no GIF comments / XMP / EXIF); closed file-name vocabulary `animated.(gif|webp)`; `X-Content-Type-Options: nosniff`; origin `private, no-store`; proxy re-validates id/file before forwarding; storefront drops any `animation` payload outside the proxy-path contract.
- **Privacy:** original retained (as for static assets) but never public.
- **Resource use:** no new dependency; parsing is linear in ≤5 MB; poster decode reuses the existing GD budget guard.
- **Accessibility:** reduced-motion stills, pause control, no motion in unsupported slots, contrast proven worst-case.

## 7. Backward compatibility

- No migration; `kind`/`mime`/`variants` columns already loose enough. No route removed or changed; additive fields only.
- Static assets: payload shape byte-identical (existing allow-list test untouched); static storefront markup unchanged (existing backdrop / slider tests untouched).
- Two existing test expectations changed because they asserted the removed rule (tiny static GIF now fails on size, not type; header-only fake animated WebP is now "unreadable", not "unsupported").
- Rollback: `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` stops new animated uploads; already-uploaded animated assets keep rendering their still first frame if the storefront ignores `animation`, and the publish gates still apply.
- Rolling deploy: an old storefront with new backend ignores `animation` (still image); a new storefront with an old backend never receives it.

## 8. Risks & remaining work

| Risk | Mitigation / next |
|---|---|
| LCP / bandwidth for animated heroes | recommend animated WebP; consider a lower default cap or a first-paint poster-then-swap strategy |
| ~~No pause for no-JS visitors~~ | fixed — no-JS gets the still only |
| `MotionToggle` store is module-global per `id` (same animation used twice shares pause) | acceptable; document |
| Unverified in real browsers / production R2 | run the existing Playwright visual specs + a production browser check before enabling |
| Animated logo / gallery / content blocks refused | extend renderers (`MediaImage`, gallery, content blocks) in a later slice if wanted |
| AVIF / video | separate approved slices (below) |

## 9. Recommended next step

1. Let CI run (sqlite + pgsql + web + storefront); review and merge **if** the owner accepts AMEND-22.
2. Production check on a test tenant: upload an animated WebP and a GIF, publish a hero with a ≥70 % scrim, verify in real Chrome / Safari / Firefox + `prefers-reduced-motion`, then enable.
3. Decide Phase 2 separately: **video** needs (a) Range-capable delivery (R2 range reads + streaming proxy), (b) a `MediaRef` video kind / schema bump, (c) ffmpeg or a pure-PHP duration probe + merchant-supplied poster, (d) a CSP `media-src` decision — a short ADR first. **Animated AVIF** needs libavif in the production GD build (Dockerfile) and a decision on that image change.
