# AWJ Animated Media — PR #1541 Security Hardening & Maintainability Report

| | |
|---|---|
| PR | https://github.com/safwan5001-source/Nebrax/pull/1541 — **open, not merged** |
| Branch | `claude/awj-animated-media-support-7kzzga` |
| Base SHA | `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5` (PR base; `main` has since advanced to `5fb6f23`, PR reports *mergeable: clean*) |
| Round-1 code head (verified) | `f3a46a84df8055356fea1e8f1dd51cddb6a798dc` |
| Round-2 code head (verified) | `a95839fbb99e27446721655f348b07186077172e` — F3 limit change (§10) |
| Final head | the commit that adds this report update (docs-only; the exact SHA is the PR head and is given in the hand-off message) — this report only (docs-only on top of the round-2 code head) |
| Scope | Round 1: F1, F2, F4, F5 fixes · F3 assessment · limited cleanup. **Round 2 (§10): F3 limit 150 M → 40 M, reviewability assessment of `s0-spikes/`, final verification** |
| Not done (by instruction) | Phase 2 · migrations · API/contract changes · merge · deploy · production config |

## Recommendation: **READY FOR REVIEW**

F1, F2, F4, F5 are fixed with PoC-based regression tests; the F3 limit is now **40,000,000** (animated media only) with boundary tests; CI is green on the code heads including SQLite and PostgreSQL (§6, §10.5); nothing was merged or deployed. No open blocker. Remaining risks are listed in §7/§10.6 (mainly: no physical-device validation). The optional evidence split is analysed in §10.3 and is **not** executed.

---

## 1. Security findings fixed

All changes are in `app/Services/Commerce/StorefrontAnimatedImage.php` (+ one safety net in `StorefrontMediaService.php`). No new dependency, no limit changed, no contract/API/schema change; error codes are the existing ones (`image_unreadable`, `animated_poster_unavailable`), so the AR/EN UI messages are unchanged.

| ID | Fix (smallest safe correction) | Regression tests (PoC = S0 security PoC bytes embedded in `AnimatedMediaFixtures`) |
|---|---|---|
| **F1** WebP nested/hidden frames | New `assertFrameData()`: an `ANMF`'s children must be exactly `[ALPH?] + (VP8 \| VP8L)`. Nested `ANMF`, trailing/unknown chunks, 0 or 2 bitstreams → `image_unreadable`. (libwebp reads anything after the first bitstream as top-level chunks, which is how frames were hidden from the frame/duration/pixel caps on the stored original.) | `f1_a_webp_with_nested_anmf_frames…` (PoC `webp_hidden_frames_n3`: *inspect 2 frames vs Pillow 5* → now rejected), `f1_anmf_children_must_be_exactly…` (trailing `XMP `, trailing `ANMF`, inner metadata, two bitstreams, none) |
| **F5** invalid WebP layouts | Same function: `ALPH` allowed only before lossy `VP8`; `VP8` key-frame tag + `9d 01 2a` start code + 14-bit dims, `VP8L` `0x2F` signature + 14-bit dims + version 0 must **equal the ANMF frame size**. | `f5_alph_is_only_valid_before_a_lossy_vp8_stream`, `f5_f4_the_bitstream_header_must_match_the_frame_dimensions` (PoCs `webp_dims_mismatch…`, `webp_vp8l_hdr_16383sq…`, plus a rebuilt 200-vs-400 header) |
| **F2** GIF hidden frame | Extension blocks: Application (`0xFF`) must declare an 11-byte first block, Plain-text (`0x01`) 12, and a zero first block is rejected for every label except the comment (`0xFE`). Decoders disagree on `21 FF 00 …`; that disagreement was the hiding place. | `f2_a_gif_application_extension_with_a_zero_first_block_is_rejected` (PoC `gif_ext_ff_zero_hides_frame`: *inspect 2 vs Pillow 3* → rejected; sizes 0 and 5; plain-text size), `f2_ordinary_extensions_are_still_accepted_and_still_stripped` (ImageMagick/XMP/NETSCAPE/comments unchanged, empty comment still valid) |
| **F4** poster failures | (a) GIF LZW minimum code size must be 2…8 (spec) — a PoC with `0xFF` passed the dimension check but GD could not decode it. (b) F5's bitstream/ANMF dimension check removes the WebP canvas-vs-bitstream mismatch. (c) Safety net in `StorefrontMediaService::inspect()`: the first-frame poster is **GD-decoded before anything is stored**, else `animated_poster_unavailable`. | `f4_a_gif_lzw_minimum_code_size_outside_2_to_8…` (PoC `gif_poster_gd_fail` + sizes 0,1,9,12,255), `every_accepted_animated_file_yields_a_poster_gd_can_actually_decode…` (4 accepted fixtures incl. metadata variants) |
| Storage invariant | Rejected uploads never reach storage / create a row | `StorefrontAnimatedMediaTest::out_of_bounds_or_unsafe_animations_are_rejected…` extended with 6 PoC cases: status `rejected`, stable code, `StorefrontMedia` count 0, **zero R2 calls** |
| Sanitiser unchanged | Sanitised output still re-inspects identically; frame children preserved | `the_sanitised_webp_keeps_exactly_the_validated_frame_children`, existing sanitising/poster/first-frame tests (all still green) |

**Behaviour change to be aware of (deliberate):** the WebP spec allows unknown chunks *after* the bitstream inside an `ANMF`; libwebp then interprets them as top-level chunks, so they are exactly the F1 vector. They are now rejected instead of silently dropped. None of the encoders exercised in the review emit them: all 17 GIF and 18 WebP seed files (ImageMagick, gifsicle, `img2webp`, `gif2webp`, ffmpeg `libwebp_anim`, `webpmux` with ICC/EXIF/XMP, alpha, partial frames, local colour tables, interlace) are still accepted after the fix. One existing test that asserted "XMP inside ANMF is dropped" now asserts rejection; the fixture `webpWithPartialFirstFrame` was corrected to carry a matching bitstream header (it previously relied on the very mismatch F5 now rejects). No other test was altered or weakened.

### Independent re-verification (post-fix differential)

Same harness (`security/harness/fuzz.py`), same seeds and iteration counts as the original review, Pillow as the independent decoder; results in `security/post-fix-differential.json`:

| Run (150k inputs each) | Pillow sees **more** frames than `inspect()` on the original upload — before → after | Pillow rejects the **sanitised** animated output — before → after | uncaught exceptions |
|---|---|---|---|
| GIF seed 11 | 12 → **0** | 0 → 0 | 0 |
| WebP seed 11 | 3 → **0** | 4,440 → 1,220 | 0 |
| WebP seed 12 | 292 → **0** | 4,764 → 405 | 0 |

(The residual rejections are fuzz-corrupted bitstreams — decoder-strictness noise, not extra frames. `MORE_san` — more frames on the *served* file — was 0 before and after.) The 3 re-executed PoCs from §9 of the S0 report (F1, F2, F4) are now rejected by the repository class.

**Not fixed (outside the approved list, still open, all Info/Low):** F6 (arbitrary bytes inside image-data streams survive — do not claim EXIF/XMP is stripped from inside LZW/VP8L data), F7 (non-zero padding / ICCP kept when VP8X ICC flag clear — harmless to decoders), F8 (clamping of 11–19 ms delays by some browsers; untested). F3 below.

---

## 2. F3 — decoded browser memory (round-1 assessment; the limit was **then** 150,000,000 — lowered to 40,000,000 in round 2, §10.1)

### Method
- Real **Chromium 141** (Playwright build) on a 16 GB / 4-vCPU Linux host, loading GIF/WebP through the same `<img>` + same-origin route a storefront uses; renderer RSS summed over `--type=renderer` processes, baseline = `about:blank` (≈ 155 MB), sampled every 1 s. Memory climbs at roughly real-time pace (≈ frames × 100 ms; e.g. 60 frames ≈ 6 s to plateau), consistent with frames being decoded as the animation advances, so it keeps rising for one **full loop** (playback itself is inferred from this growth — a 1×1-canvas colour canary never observed a change, so it is not independently proven). Windows were therefore ≥ loop length (60-frame fixtures 8–12 s, 300-frame fixtures 45 s; an earlier 8-s run of a 300-frame fixture under-measured and was discarded and redone).
- Fixtures (`memory/gen.sh`): two-frame gradient loops at 100 ms/frame. Decoded memory depends only on W×H×frames, not content. Nine size/frame classes × GIF and WebP; three byte-different variants for multi-image pages.
- Profiles: desktop 1440×900@1×; **mobile emulation** 390×844@3× touch (viewport/DPR only); **`--enable-low-end-device-mode`** (Chromium's low-RAM-device policy).
- Scripts, raw samples and results are in `docs/plans/store/s0-spikes/memory/` (`memory.mjs`, `run-matrix.sh`, `run-long.sh`, `run-lowend.sh`, `results*.jsonl`).
- **Not real-device validation.** No physical phone, iOS Safari, Android Chrome, Firefox or WebKit was measured. "Mobile" above means emulation of viewport/DPR and Chromium's low-RAM policy only.

### Results — one image, desktop Chromium (Δ over baseline, peak)

| W×H×frames | Σ pixels | theoretical RGBA (Σpx×4) | file size WebP / GIF | measured Δ WebP | measured Δ GIF |
|---|---|---|---|---|---|
| 480×270×60 | 7.8 M | 30 MB | 52 KB / 613 KB | 57 MB | 57 MB |
| 1280×720×30 | 27.6 M | 105 MB | 137 KB / 1.5 MB | 141 MB | 143 MB |
| 800×450×100 | 36.0 M | 137 MB | 225 KB / 2.3 MB | 145 MB | 149 MB |
| 1280×720×60 | 55.3 M | 211 MB | 275 KB / 3.0 MB | 250 MB | 255 MB |
| 640×360×300 | 69.1 M | 264 MB | 421 KB / 4.9 MB | 305 MB | 311 MB |
| 2560×976×30 | 75.0 M | 286 MB | 302 KB / 3.3 MB | 335 MB | 335 MB |
| 1920×1080×60 | 124.4 M | 475 MB | 479 KB / 5.7 MB | 518 MB | 524 MB |
| 800×600×300 | 144.0 M | 549 MB | 749 KB / 9.2 MB | 516 MB | 525 MB |
| **2560×976×60 (≈ the 150 M limit)** | **149.9 M** | **572 MB** | **603 KB** / 6.6 MB | **552 MB** | **558 MB** |

### Findings
1. **Decoded memory ≈ 4 bytes × W × H × frames (±15 %)**, identical for GIF and WebP, and unrelated to file size: a **603 KB WebP costs ≈ 550 MB** (≈ 900× its size). The 5 MB byte cap therefore says nothing about decode cost; flat-colour animations (the PoC `*_heavy_*` files are 148–175 KB) are the worst case. The current limit allows ≈ **600 MB per image**.
2. **Viewport/DPR do not matter**: mobile emulation (390 px @3×) decoded the same frames as desktop (536 vs 552 MB for the 150 M image). Browsers decode at natural size, not display size.
3. **Several images on one page** (3 byte-different files, 12 s):
   - only the *visible* slide pays: stacked with `opacity:0` (HomeSlider-like), `display:none` or translated off-screen, the two inactive slides added nothing (Δ 558 / 553 / 578 MB ≈ one image);
   - **simultaneously visible** images add up until Chromium's cache cap: 3 × 1280×720×30 = **444 MB** (≈ 3 × 141), 3 × 1280×720×60 = 506 MB (cap reached), 3 × 2560×976×60 = 570 MB (cap);
   - a **rotating slider** keeps earlier slides' frames until evicted: 1280×720×60 grew 220 → 660 MB absolute over 34 s as slides rotated; the 150 M-class slider plateaued at ≈ 730 MB absolute renderer RSS.
4. **Browsers protect themselves by dropping frames — desktop Chromium caps at ≈ 550–580 MB of decoded animation on this host, and Chromium's low-RAM mode caps at ≈ 45–120 MB** (150 M image: 92 MB; 3 visible 1280×720×60: 88 MB). On a capped browser the memory is bounded but frames are **re-decoded every loop** (CPU/battery cost). That CPU cost could **not** be measured here (no per-process CPU resolution; no device) and is the real mobile risk of large animations. Behaviour of Safari/iOS (jetsam limits), Firefox and Android WebView is **unknown**.

### Comparing the limit with lower thresholds

| `max_total_pixels` | worst single image (Σpx×4) | 3 simultaneously retained | example that still fits | existing uploads |
|---|---|---|---|---|
| **150 M (current)** | ≈ 600 MB | ≈ 1.8 GB (until cache cap) | 2560×976×60, 1920×1080×72 | — |
| 100 M | 400 MB | 1.2 GB | 1920×1080×48 | n/a |
| 75 M | 300 MB | 0.9 GB | 1920×1080×36, 1280×720×80 | n/a |
| **40 M (recommended)** | **≈ 160 MB** | ≈ 480 MB | 1280×720×43, 1920×600×34, 800×450×110, 640×360×170 | n/a |
| 30 M | ≈ 120 MB | ≈ 360 MB | 1280×720×32, 1920×600×26 | n/a |

- **Compatibility impact:** the limit is enforced only at upload (`assertAnimatedLimits`); nothing is migrated or re-evaluated at serve time. PR #1541 is unmerged and undeployed, so **no existing production upload exists** to be affected; if the owner later lowers the limit, assets uploaded under a higher limit keep working. The other bounds (≤ 300 frames, ≤ 20 s, ≤ 2.5 MP/frame, 5 MB) are unchanged by this proposal.
- **Recommendation (evidence-based, owner approval required, nothing changed):** lower `animated.max_total_pixels` from 150 M to **≈ 40 M**. Rationale: it bounds one image at ≈ 160 MB (the measured 1280×720×30 class, 141 MB, passes with headroom), keeps a three-slide slider on a cache-everything browser at ≈ 0.5 GB instead of capped-at-0.55 GB-or-worse, and still admits typical hero banners (1280×720 ≈ 4 s, 1920×600 ≈ 3.5 s at 10 fps). If the owner prefers fewer rejected uploads, **75 M** is the highest value I can support from this evidence (≤ 300 MB/image). A configurable per-placement budget (smaller for slider than for a single hero) would be the longer-term form but is a product decision.
- **Validate before adopting:** repeat `memory.mjs` on physical iOS Safari / Android Chrome (via the harness page approach in the S0 report) and measure CPU/battery of re-decoding; evidence here cannot rule out an OS killing a tab at lower numbers than Chromium's cap.

---

## 3. PR statistics

Measured with `git diff --numstat <base> <head>` against base `a2d2fcb`. *Before* = head `519312a` (start of this task). *After code* = head `f3a46a8`. *Final* includes this report.

| Category | Files before | +/− before | Files after (code head) | +/− after (code head) | Files final | +/− final |
|---|---|---|---|---|---|---|
| Production code (PHP, storefront, web) | 37 | +1,695 / −93 | 37 | +1,748 / −93 | 37 | +1,748 / −93 |
| Tests (PHPUnit, Vitest, Playwright, fixtures) | 16 | +2,008 / −2 | 16 | +2,245 / −2 | 16 | +2,245 / −2 |
| Documentation (reports, contract notes) | 6 | +848 / −1 | 6 | +848 / −1 | 7 | +1,027 / −1 |
| S0 spike material & evidence (`docs/plans/store/s0-spikes/`) | 66 | +2,390 / −0 | 72 | +2,602 / −0 | 69 | +2,601 / −0 |
| **Total** | **125** | **+6,941 / −96** | **131** | **+7,443 / −96** | **129** | **+7,621 / −96** |

*Binary PoC images count as 0 lines. "Before" = head `519312a`; "code head" = `f3a46a8`; "final" = with this report.*

**The PR got slightly larger, not smaller (+4 files, +680 lines):** hardening added 53 production lines and 237 test lines, the F3 assessment and post-fix differential added 9 files to the spike folder, and the cleanup removed 6 (5 empty `.err` files + the superseded script) — net **+3 spike files, +1 report**. (Three stray run-marker files and an empty log that the first F3 commit accidentally included were removed again and git-ignored.) The cleanup that was safe to do without discarding evidence was small by design; the only change that would materially shrink the PR is the owner decision in §4.

What drives the size: **production code is 23 % of added lines**; the rest is tests (security/PoC regression, Playwright), the three animated-media reports/contract notes, and the S0 spike material (`docs/plans/store/s0-spikes/`, non-production evidence that the owner asked to keep).

## 4. Files removed, consolidated, retained

| Action | Files | Why |
|---|---|---|
| **Removed** | 5 zero-byte `*.err` files (`avif/results/probe-gd-{avif,baseline}.err`, `r2-range/result-{scality,seaweedfs}.err`, `streaming/results/matrix-s3.err`) | Empty stderr captures; carry no information. |
| **Consolidated** | `security/harness/mem.mjs` → `memory/memory.mjs` | The new script supersedes it (scenarios, profiles, low-end mode, GIF+WebP, multi-image); keeping both would be a duplicate experimental output. |
| **Retained** | all 12 security PoCs (inert images, ≤ 175 KB each; `webp_hidden_frames_n90000.webp` 5.4 MB was never committed), fuzz/differential harness, `post-fix-differential.json` | Required PoCs and reproducibility; the 4 PoCs behind F1/F2/F4/F5 are additionally embedded as base64 in the PHP fixtures so CI does not depend on the files. |
| **Retained** | AVIF/R2/video/streaming spike scripts and result JSON | Meaningful evidence behind the S0 go/no-go decisions; owner asked to preserve reproducibility. `result-seaweedfs.json` and `result-scality.json` are near-identical in shape but are two independent S3 implementations — kept as separate evidence. |
| **Retained** | `AWJ-ANIMATED-MEDIA-{IMPLEMENTATION,PHASE1-ACCEPTANCE,S0-FEASIBILITY,HARDENING}-REPORT.md`, Phase 2 proposal | Each answers a different gate (build / acceptance / feasibility / hardening). Overlap exists (CI history, risk lists) but merging them would lose the audit trail of owner approvals; flagged below as a candidate if the owner wants one consolidated document. |
| **Not touched** | PHP/Vitest/Playwright tests, `web/` ↔ `storefront/` mirrored contracts and `store-preview.css`, production files > 400 lines | No defect found in the mirrored contracts; no demonstrated maintenance problem justifies splitting `StorefrontAnimatedImage.php` (≈ 540 lines, one cohesive parser, 90+ tests). |
| **Reported, not done** (round 2 analysis: §10.3) | Moving `docs/plans/store/s0-spikes/` (≈ 60 files) into its own docs-only PR | It would cut this PR's file count roughly in half and make code review easier, but it deletes evidence from the branch the owner asked to be preserved, and rewrites history references in the S0 report. Low technical risk; **needs an owner decision**. |

## 5. Tests and results

| Check | Result |
|---|---|
| `StorefrontAnimatedImageTest` + `StorefrontAnimatedMediaTest` (parser regression, PoC cases, malformed/truncated, upload rejection + storage invariants, kill switch, tenant isolation, publication gating, contrast, transform rejection) | **65 passed / 450 assertions** (was 50 → +15 hardening tests/provider cases) |
| Broader media/storefront sweep: `StorefrontMedia*`, `StorefrontCustomizer*`, `*Contrast*`, `*MediaRef*`, `StorefrontPublished*`, `StorefrontBuilder*` (static media backward compatibility, derivatives, delivery, publish gates) | **296 passed, 1 skipped** (3,354 assertions), 0 failed |
| Differential fuzz after the fix (§1) | 450k mutated inputs, **0** extra frames on originals, 0 uncaught exceptions |
| Dev-only `/dev/animated-media-visual` in a production build (S0 report §10) | no fixture markup served; route decided per request |
| Full `php artisan test` (local, SQLite) | **7,287 passed / 139 skipped / 26 failed.** All 26 failures are `Fuel*` tests (`FuelSaleServiceTest`, `FuelReconciliationTest`, `FuelSupplyReceivingTest`, …) failing on undefined `bcmul()`/`bc*` functions — `bcmath` is not installed in this sandbox (the session hook prints the warning; CI installs it and those tests pass there). Same count and class as recorded in the PR description for the first full run; **0 media-, storefront- or tenant-related failures**. |
| Frontend (web/storefront vitest, Playwright) | No frontend source changed in this task (only the dev page reorder committed in the previous step, which `next build` verified). Not re-run locally; covered by CI jobs below. |

## 6. Build & GitHub CI (head `f3a46a8`)

| Check (run 38842687835 / sibling runs) | Result |
|---|---|
| `php artisan test (L11, sqlite)` | ✅ success (15 m 24 s) |
| `php artisan test (L11, pgsql)` — **PostgreSQL** | ✅ success (17 m 30 s) |
| `CI Gate` | ✅ success |
| `web build (Next.js)` | ✅ success |
| `storefront (lint + typecheck + test)` | ✅ success |
| `merchant preview visual QA` | ✅ success |
| `published footer visual QA` | ✅ success |

7/7 green on the code head, including PostgreSQL. The final head differs only by this Markdown file (no code, test or config); its CI run is shown on the PR.

## 7. Remaining risks

| Risk | Level | Note |
|---|---|---|
| **F3 browser memory / mobile re-decode CPU** | **Medium → Low-Medium** | *Round 1 text:* limit was 150 M ⇒ up to ≈ 600 MB decoded per image. *Now (§10.1):* 40 M ⇒ ≈ 160 MB per image; low-RAM browsers still re-decode (CPU/battery, unmeasured). Superseded context: Requires owner decision (§2). Mitigated for now by: placement restriction (backgrounds and slider slides only), `prefers-reduced-motion` still, pause/play control, kill switch `STOREFRONT_MEDIA_ANIMATED_ENABLED`, feature unmerged. |
| Real-device/Safari/Firefox behaviour | Medium (unknown) | Nothing here was run on physical devices; headless desktop Chromium only. |
| F6/F7/F8 | Low/Info | Arbitrary bytes inside image-data streams survive sanitising; ICCP/padding; delay clamping untested in Safari/Firefox. |
| Stricter WebP/GIF acceptance | Low | A hand-crafted but spec-valid WebP with trailing unknown chunks inside an `ANMF`, or a GIF with a non-standard-size application extension, is now rejected with the "re-export" message. Encoders exercised in the review are unaffected (all 35 encoder-made seeds still accepted); other encoders were not tested. |
| PR size / reviewability | Low | ~130 files, ≈ 1/3 of added lines are non-production spike evidence; split analysed in §10.3 (not executed). |
| `main` has advanced (`5fb6f23`) | Low | GitHub reports the PR *mergeable: clean*; re-check CI after any rebase/merge. |
| PR description is from the first revision | Info | Still correct in substance (GIF/WebP only, no migration); the acceptance, S0 and this report supersede its "not verified" list. |

## 8. Identifiers

- Branch: `claude/awj-animated-media-support-7kzzga`
- Base SHA: `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5`
- Round-1 code head: `f3a46a84df8055356fea1e8f1dd51cddb6a798dc`
- Round-2 code head: `a95839fbb99e27446721655f348b07186077172e`
- Final head SHA: the commit that adds this report update (docs-only; the exact SHA is the PR head and is given in the hand-off message) (docs-only on top of the round-2 code head)
- PR: https://github.com/safwan5001-source/Nebrax/pull/1541

## 9. Owner decisions requested

1. ~~F3 limit~~ — **decided and applied in round 2: 40 M** (§10.1).
2. Optional evidence split — see §10.3 (procedure proposed, awaiting a go/no-go; **not executed**).
3. Real-device memory/CPU validation (iOS Safari, Android Chrome) before relying on any limit.

No merge, deploy, migration, production configuration change or Phase 2 work was performed.

---

## 10. Round 2 — final F3 gate & reviewability

### 10.1 F3: `animated.max_total_pixels` 150,000,000 → **40,000,000** (owner-approved)

**Change (3 lines of config, no logic change):** `config/storefront_media.php → animated.max_total_pixels`. The only consumer is `StorefrontMediaService::assertAnimatedLimits()` (`W × H × frames > max_total_pixels` ⇒ `animated_too_heavy`), executed during `inspect()` — i.e. **before any storage write** (verified by tests below).

Untouched (asserted by `the_animated_total_pixel_budget_is_40_million_and_nothing_else_moved`):

| Limit | Value | |
|---|---|---|
| animated frames / duration / edge / pixels per frame / bytes | 300 / 20 s / 2560 px / 2.5 MP / 5 MB | unchanged |
| static images: bytes / short edge / max edge / max pixels | 5 MB / 320 / 8192 / 40,000,000 | unchanged (the static 40 M cap is a separate key and merely happens to have the same value) |
| API error code / localized messages | `animated_too_heavy`, "الصورة المتحركة ثقيلة على المتصفح (أبعاد × إطارات). قلّل الأبعاد أو عدد الإطارات." and the AR/EN `mediaErr_animated_too_heavy` strings | unchanged (messages carry no number, so none needed updating) |

**Boundary tests** (`StorefrontAnimatedMediaTest`; 400×400 = 160,000 px/frame ⇒ the budget is exactly **250 frames**):

| Case | Σ pixels | Expected | Result |
|---|---|---|---|
| 249 frames — just below | 39,840,000 | `created`, 249 frames recorded | ✅ |
| 250 frames — exactly at | 40,000,000 | `created` (limit is `>`) | ✅ |
| 251 frames — just above | 40,160,000 | `rejected` / `animated_too_heavy`, **no row, no new storage call** | ✅ |
| 300 frames (fine under the old 150 M) | 48,000,000 | `rejected` / `animated_too_heavy`, 0 rows, **0 storage calls** | ✅ |
| existing `too heavy (frames × pixels)` provider case | 48,000,000 | now runs on the **default** config (the test no longer overrides the limit) | ✅ |

**Documentation updated:** `config/storefront_media.php` (comment with the measured rationale), `AWJ-ANIMATED-MEDIA-IMPLEMENTATION-REPORT.md` (2 places), `docs/plans/store/AWJ-ANIMATED-MEDIA-PHASE2-ARCHITECTURE-PROPOSAL.md`. `CLAUDE.md` and the V0 contract state no numeric value, so they needed no change. Historic evidence documents (S0 report, round-1 sections above) keep "150 M" deliberately, labelled as the then-current value.

**Compatibility:** enforced at upload only. PR #1541 is unmerged/undeployed so no stored production animation exists; anything uploaded under a higher limit would keep serving. Users uploading banners between 40 M and 150 M Σpixels (e.g. 1920×1080×48) now get `animated_too_heavy` with the existing "reduce dimensions or frames" guidance.

### 10.2 Verification of this change

| Check | Result |
|---|---|
| Focused: `StorefrontAnimatedImageTest` + `StorefrontAnimatedMediaTest` | **68 passed / 480 assertions** (65 → 68: +2 new budget tests, +1 limit-guard test; the provider case was reworked, not removed) |
| Related regression sweep: `StorefrontMedia*`, `StorefrontCustomizer*`, `*Contrast*`, `*MediaRef*`, `StorefrontPublished*`, `StorefrontBuilder*`, `ProductMedia*`, `CategoryMedia*` | **363 passed, 1 skipped, 0 failed** (3,724 assertions) — static media backward compatibility, derivatives, delivery, publish gates, contrast |
| Tenant isolation & publication gating (inside the focused run) | `animation is tenant scoped in the workspace api`, `a published animation is served through the gate and never across tenants`, `the signed workspace url … tampered…`, `an animation is publishable only where the storefront renders it`, `text over an animated background publishes only under a scrim…`, `crop rotate and framing on an animation are refused…` — all ✅ unchanged |
| Full local suite | **Not re-run** (as instructed; the change is one config value + tests). Round-1 full run: 7,287 passed / 26 `Fuel*` failures from missing `bcmath` in this sandbox. Full SQLite + PostgreSQL suites run in CI (§10.5). |

### 10.3 Would moving `docs/plans/store/s0-spikes/` into a separate PR materially simplify #1541?

**Facts**
- `s0-spikes/` is **69 of 129 files (53 %) but only 2,601 of 7,621 added lines (34 %)**, and **0 executable product lines**. Without it, #1541 would be **60 files / ≈ +5,020 lines**, all production code, tests and the four gate reports.
- No runtime or CI dependency: nothing in `app/`, `config/`, `web/`, `storefront/` or the workflows reads it; the four PoCs used by tests are embedded as base64 in `AnimatedMediaFixtures.php` (a comment there names the folder). Only three documents reference it: the S0 report, this report and that fixture comment.
- CI jobs for docs-only paths still run the full PHP matrix, so a separate PR costs ≈ 18 minutes of CI but no extra risk.

**Assessment:** the split is **feasible, low-risk and mechanical, with moderate benefit**. It would halve the file count a reviewer scrolls, but the spike files are one path prefix that reviewers can already collapse/filter (`-docs/plans/store/s0-spikes/**`), contain no code that ships, and the security-relevant diff (parser + tests) is the same either way. The cost is coordination: two PRs, link updates in two reports, and the evidence travelling with a different merge decision than the code it justifies. **My recommendation: do the split only if the reviewer asks for it; otherwise leave #1541 intact** (this is a preference, not a blocker — it does not make the PR safer).

**Proposed exact safe procedure (NOT executed; needs your explicit go):**

1. `git fetch origin main && git switch -c claude/awj-animated-media-s0-evidence origin/main` (new branch; nothing existing is touched).
2. `git checkout claude/awj-animated-media-support-7kzzga -- docs/plans/store/s0-spikes AWJ-ANIMATED-MEDIA-S0-FEASIBILITY-REPORT.md` → one commit "docs(animated-media): S0 feasibility evidence (spikes, PoCs, harnesses, reports)". Tree contents are byte-identical to the PR branch; history is **not** rewritten.
3. Push, open a **docs-only PR** (ready for review, not merged). Verify `git diff --stat origin/main` lists only those paths and that `git ls-tree -r` file hashes equal the PR branch's (`git diff --stat claude/awj-animated-media-support-7kzzga -- docs/plans/store/s0-spikes` is empty).
4. Only after step 3 is reviewed/accepted by you: on the #1541 branch, a normal forward commit `git rm -r docs/plans/store/s0-spikes AWJ-ANIMATED-MEDIA-S0-FEASIBILITY-REPORT.md` plus link edits in this report and the Phase-1 acceptance report ("evidence: PR #<new>"). No force-push, no rebase.
5. Re-run the 68 focused tests (no dependency expected), push once, check CI once (SQLite + PostgreSQL).
6. Rollback at any point: `git revert` the step-4 commit; the evidence PR is independent.
7. Merge order is unconstrained; recommended: evidence PR first so the report links resolve.

**Risks of the split:** dangling links if the PRs merge out of order; PoC provenance for F1/F2/F4/F5 would live in a different PR than the fix (mitigated: the four PoCs stay embedded in tests); the `security/` and `memory/` harness folders are the evidence for the hardening claims, so the hardening report would have to cite the other PR.

### 10.4 PR statistics — before and after round 2

`git diff --numstat a2d2fcb…<head>`; *Start of round 2* = `ffbd367`; *Round-2 code head* = `a95839f`; *Final* = with this report update.

| Category | Files (start of round 2) | +/− | Files (code head) | +/− | Files (final) | +/− |
|---|---|---|---|---|---|---|
| Production code | 37 | +1,748 / −93 | 37 | +1,750 / −93 | 37 | +1,750 / −93 |
| Tests & fixtures | 16 | +2,245 / −2 | 16 | +2,296 / −2 | 16 | +2,296 / −2 |
| Documentation / reports | 7 | +1,027 / −1 | 7 | +1,027 / −1 | 7 | +1,115 / −1 |
| S0 spike evidence (`s0-spikes/`) | 69 | +2,601 / −0 | 69 | +2,601 / −0 | 69 | +2,601 / −0 |
| **Total** | **129** | **+7,621 / −96** | **129** | **+7,674 / −96** | **129** | **+7,762 / −96** |

*Binary PoC images count as 0 lines. Round 2 changed 2 production lines (config), +51 test lines, +88 report lines; file count is unchanged (129). Since the start of the hardening task (`519312a`: 125 files, +6,941 / −96) the PR is +4 files / +821 lines — see §3.*

Round 2 added no files outside tests/config/docs, and no spike files. The numbers are **not** reduced: the split (§10.3) is the only change that would shrink the PR materially, and it was not executed.

### 10.5 GitHub CI

| Check — head `a95839f` (round-2 code head) | Result |
|---|---|
| `php artisan test (L11, sqlite)` | ✅ success (16 m 37 s) |
| `php artisan test (L11, pgsql)` — **PostgreSQL** | ✅ success (17 m 06 s) |
| `CI Gate` | ✅ success |
| `web build (Next.js)` | ✅ success |
| `storefront (lint + typecheck + test)` | ✅ success |
| `merchant preview visual QA` | ✅ success |
| `published footer visual QA` | ✅ success |

7/7 green on the round-2 code head, including SQLite and PostgreSQL (one poll after the expected run time, not repeated polling). The final head differs from `a95839f` only by this Markdown report, so its CI result is not re-awaited; it is visible on the PR. Previous heads: `f3a46a8` 7/7 green, `ffbd367` 7/7 green (docs-only).

### 10.6 Remaining risks (after round 2)

| Risk | Level | Note |
|---|---|---|
| No physical-device validation (iOS Safari, Android, Firefox, WebView) of memory/CPU | Medium (unknown) | The 40 M budget is justified on desktop Chromium + Chromium low-RAM-mode measurements only. Re-decode CPU/battery of capped browsers was never measured. |
| Tighter budget rejects some previously-planned banners (40–150 M Σpixels) | Low | Intentional; clear existing error code/message; limit is a single config key; kill switch `STOREFRONT_MEDIA_ANIMATED_ENABLED` unchanged. |
| F6/F7/F8 (info/low) | Low | Unchanged from §7. |
| Evidence split not executed | Info | Optional; procedure ready (§10.3). |
| `main` advanced since the PR base | Low | PR reported *mergeable: clean*; re-run CI after any rebase/merge. |

### 10.7 Final recommendation: **READY FOR REVIEW**

No code defect or failing check is open. No merge, deployment, migration, API-breaking change, Phase 2 work or production configuration change was made. Stopping here.
