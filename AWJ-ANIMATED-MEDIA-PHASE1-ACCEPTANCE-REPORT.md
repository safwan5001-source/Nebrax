# AWJ-ANIMATED-MEDIA — Phase 1 Acceptance Report & Phase 2 Design Hand-off

**Date:** 2026-10-16 · **PR:** [#1541](https://github.com/safwan5001-source/Nebrax/pull/1541) (open — **not merged, not deployed, no production change**)
**Branch:** `claude/awj-animated-media-support-7kzzga` · **Base SHA:** `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5`
**Head SHA (code):** `d10cd36` (see §1 for the exact final head and its CI)
**Companion documents:** `AWJ-ANIMATED-MEDIA-IMPLEMENTATION-REPORT.md` (Phase 1 build report) · `docs/plans/store/AWJ-ANIMATED-MEDIA-PHASE2-ARCHITECTURE-PROPOSAL.md` (Phase 2 design — **proposal only**)

**Owner decisions applied:** (1) AMEND-22 accepted — animated GIF/WebP are officially allowed in supported placements. (2) Phase 2 approved for *design only* — no migrations, infrastructure or breaking contract changes were made.

---

## 0. Executive summary

| Requirement from your review | Result |
|---|---|
| Verify GitHub CI incl. PostgreSQL | ✅ All 7 jobs green on the Phase 1 head `29a09e7`, **including `php artisan test (L11, pgsql)` and `(sqlite)`**. After the follow-up commits CI re-ran: storefront / web build / visual QA green on `e14f0f8`; the final head `d10cd36` is re-running (status in §1). |
| Address the no-JavaScript accessibility limitation | ✅ **Fixed, not just justified.** Server HTML now contains only the still; the animation and its pause control are added together after hydration. A no-JS visitor never receives motion they cannot stop (WCAG 2.2.2). Verified in a real browser (§3). |
| Real-browser validation (Safari/iOS, Chrome) | ⚠️ **Chromium: done (10 pass / 2 self-skipped).** **Safari/iOS/Firefox: NOT possible here** (only Chromium is installed; WebKit-on-Linux would not be iOS Safari anyway) — a manual device checklist is in §3.3. In-browser *playback* could not be demonstrated in this sandbox's Chromium (it does not advance animated images at all, even untouched control files); proven instead with independent decoders. |
| Tenant isolation & publication gating | ✅ Re-confirmed by tests **and** by an independent adversarial code review (§4): no cross-tenant or unpublished read found. |
| Backward compatibility | ✅ Preserved (§6). |
| Phase 2 architecture proposal | ✅ Delivered as a separate document, with spikes, slices and 8 owner decisions. |

**New this round (not asked, but found by verification):** an independent security review of the byte-level parser found **three real sanitiser defects** (wrong poster for partial-first-frame GIFs, a parser/decoder differential that produced an *undecodable served file*, and metadata that survived inside sub-blocks). All three were reproduced, **fixed, and covered by regression tests** (§4). Your own earlier feedback was right to insist on validation: these would not have shown up in the happy-path tests.

---

## 1. CI findings

| Head | Commit content | Result |
|---|---|---|
| `29a09e7` (Phase 1 code) | feature + CSS parity fix | ✅ **7/7 green**: `php artisan test (L11, pgsql)` ✓ (17 min), `(sqlite)` ✓, `CI Gate` ✓, `web build (Next.js)` ✓, `storefront (lint + typecheck + test)` ✓, `merchant preview visual QA` ✓, `published footer visual QA` ✓ |
| `e14f0f8` | hydration-gated animation, dev page + Playwright spec | storefront ✓, web build ✓, both visual-QA ✓ (PHP jobs superseded by the next push) |
| `d10cd36` (**last code change**) | sanitiser hardening after security review | storefront ✓, Store Brand QA (both jobs) ✓, web CI ✓; the PHP run (sqlite + pgsql) was **superseded** by the next docs-only push (the repo's `ci.yml` cancels in-progress runs) |
| `23b3e51` and later (**docs only**, same code as `d10cd36`) | reports | full CI re-run **pending/in progress at time of writing**. Because every push restarts the ~17-minute PHP jobs, I stopped pushing after this edit. **The authoritative final result is the PR's Checks tab; I will also post it as a PR comment** (comments do not restart CI). |

**Observed transient failure (disclosed):** on commit `1e61bdc` the workflow *Store Brand QA → merchant preview visual QA* failed once (32 passed, 1 failed: a Playwright `page.goto('/dev/trust-visual…')` navigation error in `web/e2e/store-brand-qa.spec.ts`, a footer/trust page unrelated to media). The same job **passed on three later runs with identical product code** (`da94e4b`, `e14f0f8`, `d10cd36`). I believe it is a cold-start flake but have not proven the root cause. Likewise, the first push (`9cda0ab`) failed *Web CI* — that was a genuine regression from my storefront CSS change (Canvas-preview parity test); it was fixed in `29a09e7`.

**Local full-suite note (unchanged):** the sandbox lacks `bcmath`, so 26 `Fuel*` tests fail locally with `bcmul()` undefined. **CI (which installs bcmath) passes them**, confirming the failures are environmental and unrelated.

**Automated Codex review:** *did not run* ("usage limits reached") — so there has been **no automated third-party review** of the PR. The independent review in §4 was performed by a separate fresh-context reviewer instead. A human code review is still recommended.

**Final CI:** see the PR Checks tab / PR comment (not repeated here to avoid restarting CI with another docs push).

---

## 2. The no-JavaScript limitation — resolved

**Problem:** previously the server rendered the animated `<source>`, so a visitor with JavaScript disabled got an animation with no way to pause it.

**Fix (`MotionPicture`):** the animated `<source>`s are filtered out during server render and hydration and added only after hydration, at the same moment the `MotionToggle` appears. The `prefers-reduced-motion` stills remain first in every case.

**Side benefits:** the still paints first (better LCP); the animation file is not fetched until the page is interactive.

**Evidence:** unit tests (server markup contains no animated source and no `<button>`; after hydration both appear) and a real-Chromium test with `javaScriptEnabled: false` asserting `currentSrc` is the still, **zero** `animated.*` requests, zero buttons, `naturalWidth > 0`.

---

## 3. Real-browser validation

### 3.1 Setup
`/dev/animated-media-visual` (dev-only, 404 in production) mounts the **real** `SectionBackdrop` and `HomeSlider`; `e2e/animated-media-visual.spec.ts` answers the same-origin media proxy paths with fixtures that are **the exact bytes the PHP pipeline emits** (`StorefrontAnimatedImage::sanitize()` / `posterBytes()`), and logs every request so "never fetched" is assertable. Run: `pnpm exec playwright test -c playwright.animated-media.config.ts`. Chromium 141, Linux.

### 3.2 Results (real Chromium)

| Check | Result |
|---|---|
| GIF hero: still first, animated source selected after hydration, no hydration-mismatch errors | ✅ |
| Pause → the still; play → the animation again; `aria-pressed` and accessible names correct | ✅ |
| Arabic RTL: control at the inline end, keyboard operable (Enter), ≥ 40 px touch target | ✅ |
| **`prefers-reduced-motion: reduce`**: still used, **animation never requested**, no control | ✅ |
| **No JavaScript**: still only, **animation never requested**, no dead control | ✅ |
| Animated WebP: sanitised file fetched, decodes, renders at 400 px | ✅ |
| The still extracted from an animated WebP's first frame (re-wrapped VP8X) decodes as a full-canvas red image | ✅ |
| Phone viewport (390×844, touch): phone-only animation plays on phone, **not** on desktop; no horizontal scroll | ✅ |
| Slider: animated slide + toggle inside the existing control bar; pausing shows the still | ✅ |
| Static section: byte-for-byte old behaviour (no animation request, no control) | ✅ |
| Playback: frames really change (GIF, WebP) | ⏭️ **self-skipped** — see below |

**Honest limitation — playback.** In this sandbox's Chromium, animated images never advance past frame 0: I ran a control with the **untouched ImageMagick GIF/WebP and an ffmpeg-generated moving test pattern** under headless, headed (Xvfb), SwiftShader and flag variants — all stayed on frame 0. So the two "frames change" tests contain a *canary* (an untouched known-good GIF) and **skip visibly** when the browser cannot animate, instead of failing falsely or passing vacuously. They should run (and be expected to pass) on CI/real browsers.

**Independent evidence the sanitised files animate:** decoded with **ImageMagick** (giflib / libwebp): sanitised GIF and sanitised WebP each = **3 frames, 400×400, 200 ms, red → blue → lime**, identical to the originals; `ffprobe` agrees for GIF (3 frames). *(ffmpeg cannot decode animated WebP at all — originals included — a known ffmpeg limitation, not a defect.)* The hardened sanitiser also emits **byte-identical** output for these well-formed fixtures.

### 3.3 Not validated — manual device checklist (required before enabling in production)
Safari/WebKit and Firefox are not installed here, and Linux WebKit ≠ iOS Safari. Please run, on real devices, with an animated WebP and a GIF hero (+ a ≥70 % scrim):

- [ ] iPhone Safari (current iOS and one version back): hero animates after load; pause/play works; **Low Power Mode**; rotate; no layout shift.
- [ ] iPad Safari and macOS Safari.
- [ ] Chrome Android and Samsung Internet.
- [ ] Firefox desktop.
- [ ] Settings → Accessibility → **Reduce Motion** on iOS/macOS/Android/Windows: the still is shown and the animation is not downloaded (check network panel).
- [ ] Arabic RTL and English LTR; slow-3G throttle (the still must paint first).
- [ ] Animated hero with text: confirm the scrim-proven text colour is readable on every frame.

---

## 4. Security: independent review, findings, fixes

A separate fresh-context reviewer (no access to my conclusions) adversarially reviewed the parser, upload branch, controllers and gates; I **re-ran its reproduction scripts** before fixing anything.

| # | Finding | Severity | Reproduced | Status |
|---|---|---|---|---|
| 1 | A GIF whose first frame is a sub-rectangle: GD sizes the still to the *frame* (100×100) and ignores the offset → wrong ladder / reduced-motion image; `animated_poster_unavailable` only existed for WebP | Medium | ✅ | **Fixed** — first frame must cover the canvas; poster dimensions must equal the canvas at upload; poster is taken from the sanitised copy actually served |
| 2 | GCE block: terminator byte never checked; a forged terminator made `inspect()` and a spec-compliant decoder disagree, and the **served `animated.gif` was undecodable** (plausibly bypassing frame limits) | Medium-low | ✅ (invalid output); extra frames *not* reproduced | **Fixed** — terminator must be `0x00`; block rebuilt canonically |
| 3 | Metadata survived by verbatim copying: extra NETSCAPE sub-blocks, WebP ANIM trailing bytes, unknown chunks inside ANMF, oversize ICCP; unlimited NETSCAPE copies | Low | ✅ | **Fixed** — sanitiser now *rebuilds* canonical blocks (one 19-byte NETSCAPE, 6-byte ANIM, ANMF header + ALPH/VP8/VP8L only, ICCP ≤ 64 KB) |
| 4 | WebP whose first chunk is not VP8X/VP8/VP8L was classed static and passed through unvalidated | Low | ✅ | **Fixed** — rejected |
| 5 | WebP frames after the first aren't checked against their own bitstream dimensions (browsers reject mismatches; not a limit bypass) | Low | suspected | **Accepted risk** — documented |
| 6 | `retry()` could regenerate an animated file after the kill switch was turned off | Low | suspected | **Fixed** (+ test) |
| 7 | GIF decodability only detected at generation (asset `failed` instead of clean rejection) | Low | suspected | **Fixed** by the poster-dimension check at upload |
| 8 | `animated.*` ETag unchanged if the sanitiser changes | Low | suspected | **Fixed** — ETag bound to `SANITISER_VERSION` |
| — | Facet-visual containers can make an animated asset "published", so `animated.*` becomes publicly fetchable although never linked | Low | by design | **Documented** (sanitised file only; no leak) |

**Confirmed clean by the reviewer:** no crash / OOB read / hang / memory blow-up (5 MB adversarial inputs: 2.5 M one-byte sub-blocks, 250 k extensions, 600 k junk chunks all ≤ 0.1 s); `inspect`/`sanitize`/`posterBytes` share one parse; **no cross-tenant or unpublished-asset read** through either controller; the original (`original.*`) can never be served; Content-Type derives from the stored variant; publish-gate slot regex correctly anchored; contrast bounds conservative; temp files and R2 objects cleaned on every failure path.

**Regression tests added:** partial-first-frame GIF (unit + upload rejection), forged-terminator GIF (unit + upload), canonical-rebuild equivalence, hidden bytes in NETSCAPE/ANIM/ANMF, NETSCAPE flood, junk-first WebP, kill-switch-on-retry, ETag version binding. Targeted run: **91 passed / 910 assertions**.

**Tenant isolation & publication gating — current evidence** (all passing): other-tenant public host → 404; unpublished → 404; unpublish ends serving immediately; `animated.png`/transform-key/`animated.gif` on a static asset → 404; tampered signed `tenant` → 403; workspace API cross-tenant read/delete → 404; publish rejected for non-supported slots; contrast worst-case bounds.

---

## 5. Test & build summary (final code)

| Suite | Result |
|---|---|
| New/affected PHP (`StorefrontAnimatedImageTest` 26, `StorefrontAnimatedMediaTest` 24, `StorefrontMediaApiTest`) | ✅ 91 passed |
| PHP media/storefront regression sweep (presentation, slider, gallery, facet, contrast, workspace media) | ✅ **790 passed, 0 failed**, 5 skipped |
| Full `php artisan test` (local, SQLite) at Phase 1 head | 7262 passed / 26 failed — all `Fuel*`, `bcmul()` undefined (sandbox lacks bcmath); **same suite green in CI incl. PostgreSQL** |
| storefront: `tsc`, `biome lint` (baseline), vitest (2736 → all pass), `next build` | ✅ |
| web: vitest (store-experience-builder + commerce-workspace, 3282), `npm run build` | ✅ (one regression I introduced — Canvas preview CSS parity — was caught by an existing test and fixed) |
| Playwright real Chromium | ✅ 10 passed, 2 self-skipped (canary) |

---

## 6. Backward compatibility

- **No migration; no breaking API change.** Static asset payloads and static storefront markup are unchanged (guarded by pre-existing allow-list and markup tests). Rolling deploy is safe both ways (old storefront ignores `animation`; old backend never sends it).
- New this round: hydration gating changes *when* the animation starts (after hydration instead of at first paint) — an intentional behavioural change for accessibility, limited to animated media added in this PR (no pre-existing content is affected).
- **Rollback:** `STOREFRONT_MEDIA_ANIMATED_ENABLED=false` stops new animated uploads **and** retry-regeneration; existing animated assets keep rendering their still first frame if the storefront ignores `animation`.

---

## 7. Phase 2 (design only)

Delivered: `docs/plans/store/AWJ-ANIMATED-MEDIA-PHASE2-ARCHITECTURE-PROPOSAL.md`, covering AVIF decoder and production compatibility, video validation/metadata/poster, HTTP Range delivery and storage, media-reference contract, CSP and security, performance and mobile behaviour, deployment and rollback, and 9 slices (S0 spikes → S8).

**Headline recommendations**
1. **Keep `MediaRef` unchanged.** Video/AVIF are *asset kinds* discovered through the resolved payload — exactly how Phase 1 added `animation` — so no stored presentation document changes and rollout is order-independent.
2. **AVIF:** feasible only with a **Dockerfile change** (`libavif-dev`, `gd --with-avif`) *after* a spike proves GD decodes frame 0 of an AVIS file (undocumented); reject (don't strip) AVIF carrying Exif/XMP. Animated-AVIF browser support for Chrome/Safari is **unverified** (MDN documents Firefox 113+ only).
3. **Video:** merchant-supplied static poster (no ffmpeg), pure-PHP MP4/H.264 validation, reject-don't-repair, fixed safe playback policy (muted, loop, viewport-gated, poster-only under reduced-motion/Save-Data). **One additive nullable migration** (`poster_media_id`) needs your approval.
4. **Range delivery is mandatory** (Safari/iOS require `206`; WebKit bugs cited in the proposal). Recommend streaming via Laravel + a streaming Next proxy to preserve AMEND-1/4/16 (no direct R2 URLs). R2's S3 API lists `Range` as implemented — exact single/suffix/416 behaviour still to be proven by a spike. Prefork-worker concurrency is the main risk → load-test gate.
5. **CSP:** none exists today; introduce **Report-Only** with the video work (`media-src 'self'` suffices under the recommended delivery).
6. **Nothing ships before spike slice S0** (GD/AVIS, R2 Range, real-iPhone 200-vs-206, device matrix, load test).

**Decisions requested (full list in the proposal §12):** AVIF Dockerfile change · merchant poster vs. server extraction · `poster_media_id` migration · delivery Option A vs. B · reject-vs-strip policy · WebM alternate · Report-Only CSP · production host of the storefront (Railway Docker vs. Vercel).

---

## 8. Remaining risks

| Risk | Severity | Mitigation / owner |
|---|---|---|
| **Safari/iOS/Firefox never exercised**; no real-device run | **High for go-live** | Run §3.3 checklist; add WebKit/Firefox to a CI Playwright job |
| In-browser playback unproven in this sandbox (canary-skipped) | Medium | CI/real browsers should execute those 2 tests; confirm they pass |
| No automated third-party review (Codex quota) + only one independent reviewer | Medium | Human review of `StorefrontAnimatedImage.php` and the upload branch before merge |
| Hand-written binary parsers remain a security-sensitive surface | Medium | Add a fuzz/property test corpus (Phase 2 S1/S3 already plan this); keep the kill switch |
| Animated hero is its own LCP / 5 MB GIF is heavy | Medium | Recommend animated WebP; the still now paints first; consider lowering the default cap |
| Never exercised against real R2/production | Medium | Canary tenant check after merge, behind the flag |
| WebP later-frame dimensions unvalidated (#5) | Low | Accepted; browsers reject mismatches |
| `MotionToggle` pause state shared per animation id | Low | By design |
| Dev page + e2e spec added to the repo (dev-only, 404 in production) | Low | Remove if you prefer not to carry them |
| Final CI on the last head (docs-only commits after `d10cd36`) | — | see §1 — verify PHP sqlite + pgsql green on the PR before merging |

---

## 9. Recommended next action

1. **Do not merge yet.** Wait for the final CI on `d10cd36` (§1), then have a human review `StorefrontAnimatedImage.php`.
2. Run the **manual device checklist (§3.3)** on a staging environment with the flag on for one canary tenant (iPhone Safari first).
3. Review the Phase 2 proposal; answer the 8 decisions; if approved, start with **S0 spikes only** (no production code).
4. When ready to merge Phase 1: merge with `STOREFRONT_MEDIA_ANIMATED_ENABLED` defaulting to on only after step 2 passes (or deploy with it `false` and enable per environment).
