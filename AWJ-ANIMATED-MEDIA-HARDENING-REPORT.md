# AWJ Animated Media — PR #1541 Security Hardening & Maintainability Report

| | |
|---|---|
| PR | https://github.com/safwan5001-source/Nebrax/pull/1541 — **open, not merged** |
| Branch | `claude/awj-animated-media-support-7kzzga` |
| Base SHA | `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5` (PR base; `main` has since advanced to `5fb6f23`, PR reports *mergeable: clean*) |
| Code head (verified) | `f3a46a84df8055356fea1e8f1dd51cddb6a798dc` |
| Final head | the commit that adds this report (shown on the PR; no code, test or config change after `f3a46a8`) |
| Scope | F1, F2, F4, F5 fixes · F3 assessment (no limit change) · limited cleanup · verification |
| Not done (by instruction) | Phase 2 · migrations · API/contract changes · merge · deploy · production config |

## Recommendation: **READY FOR REVIEW**

All four approved findings (F1, F2, F4, F5) are fixed with PoC-based regression tests, 7/7 CI checks (incl. PostgreSQL) are green on the code head, and nothing was merged or deployed. **Condition for merge:** the owner decides F3 (§2, §9) — it is a documented medium risk with a kill switch, not a code defect, so it does not block *review*; it should be settled (or knowingly accepted) before merge.

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

## 2. F3 — decoded browser memory (assessment only; `max_total_pixels` is still 150,000,000)

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
| **Reported, not done** | Moving `docs/plans/store/s0-spikes/` (≈ 60 files) into its own docs-only PR | It would cut this PR's file count roughly in half and make code review easier, but it deletes evidence from the branch the owner asked to be preserved, and rewrites history references in the S0 report. Low technical risk; **needs an owner decision**. |

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
| **F3 browser memory / mobile re-decode CPU** | **Medium** | Limit unchanged at 150 M ⇒ up to ≈ 600 MB decoded per image on cache-everything browsers; low-RAM browsers re-decode (CPU/battery). Requires owner decision (§2). Mitigated for now by: placement restriction (backgrounds and slider slides only), `prefers-reduced-motion` still, pause/play control, kill switch `STOREFRONT_MEDIA_ANIMATED_ENABLED`, feature unmerged. |
| Real-device/Safari/Firefox behaviour | Medium (unknown) | Nothing here was run on physical devices; headless desktop Chromium only. |
| F6/F7/F8 | Low/Info | Arbitrary bytes inside image-data streams survive sanitising; ICCP/padding; delay clamping untested in Safari/Firefox. |
| Stricter WebP/GIF acceptance | Low | A hand-crafted but spec-valid WebP with trailing unknown chunks inside an `ANMF`, or a GIF with a non-standard-size application extension, is now rejected with the "re-export" message. Encoders exercised in the review are unaffected (all 35 encoder-made seeds still accepted); other encoders were not tested. |
| PR size / reviewability | Low | 130+ files, ≈ 1/3 non-production spike material (see §4 for the split option). |
| `main` has advanced (`5fb6f23`) | Low | GitHub reports the PR *mergeable: clean*; re-check CI after any rebase/merge. |
| PR description is from the first revision | Info | Still correct in substance (GIF/WebP only, no migration); the acceptance, S0 and this report supersede its "not verified" list. |

## 8. Identifiers

- Branch: `claude/awj-animated-media-support-7kzzga`
- Base SHA: `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5`
- Code head SHA: `f3a46a84df8055356fea1e8f1dd51cddb6a798dc`
- Final head SHA: the commit adding this report (see the PR; docs-only on top of `f3a46a8`)
- PR: https://github.com/safwan5001-source/Nebrax/pull/1541

## 9. Owner decisions requested

1. **F3:** approve lowering `animated.max_total_pixels` (recommended **40 M**; **75 M** at most) — or keep 150 M knowingly.
2. Optionally split `s0-spikes/` into a docs-only PR (§4).
3. Real-device memory/CPU validation (iOS Safari, Android Chrome) before relying on any limit.

No merge, deploy, migration, production configuration change or Phase 2 work was performed.
