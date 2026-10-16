# AWJ Animated Media — Canvas ↔ Storefront Parity (Implementation Report)

| | |
|---|---|
| Branch | `claude/awj-animated-media-support-7kzzga` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1547 (open, **not merged**) — now carries the parity fix + the updated acceptance document |
| Base SHA | `336284170ea6a044ee745fda2f1c844e161215cf` (`origin/main` when this work started: #1541 + #1546; PR #1541 is `a50ce81`) |
| Code head (verified) | __CODE__ |
| Final head | the commit that adds this report (docs-only; given in the hand-off message) |
| Scope | Web Canvas + two storefront touch-ups. **No** change to media validation, tenant isolation, storage, accounting, migrations or APIs. No merge, no deploy. |

---

## 1. Findings

### 1.1 Why the storefront shows a pause/play button and the Canvas does not
The two surfaces are **separate renderers** that mirror each other's DOM and CSS (an intentional design: the Canvas is a "twin", kept in step by shared CSS blocks):

| | Published storefront | Canvas (Store Builder) |
|---|---|---|
| Section backdrop | `SectionBackdrop` → `MotionPicture` swaps in the animated `<source>`s after hydration and renders `MotionToggle` | `CanvasBackdrop` rendered `<picture><img src={previewUrl}>` only |
| Slider | `HomeSlider` → `MotionPicture` per slide + `MotionToggle` in `data-slider-bar` | `CanvasSlider` → `SlidePicture` rendered `previewUrl` only |
| What `previewUrl` is | — | the **still ladder** (first frame) the server derives from the animation |
| Where the animated URL lived | resolved payload `animation` | `asset.animation.url` (signed, sanitised) — fetched by `useMediaRefPreview` but **thrown away**; used only by the media picker's on-request `MotionPreview` |

So the Canvas always showed the poster, with no control, **because the Canvas twins had no animated-media code at all** — the motion work (Phase 1) added the toggle/animation to the storefront and a play-on-request preview to the media *picker*, but never reached `CanvasBackdrop`/`CanvasSlider`. The toggle's **CSS** (`[data-slider-bar] [data-motion-toggle]`) had already been mirrored into `store-preview.css`; the **markup** had not.

### 1.2 Is the static poster intentional?
**Partly.** "The editor never autoplays" is documented only for the media *library grid/picker* (`MotionPreview.tsx`: a grid of animations would be heavy and ignores reduced motion), and `CanvasSlider` documents that *carousel autoplay* does not run. Nothing records a decision that the *Canvas preview of a published section* must be static; the omission was a gap, and it made the preview misrepresent the page (no motion, no control, and nothing hinting the picture is animated).

### 1.3 Does the Canvas interfere with selecting/editing?
Reviewed `StorefrontPreviewCanvas`: every section is wrapped in `SelectablePreviewSection` (`role="button"`, `onClick` selects). The backdrop is `pointer-events: none`; Canvas buttons (slider arrows/dots) already sit inside that wrapper. By **mouse**, a motion toggle behaves like them: a small (≥ 40 px) real button at the bottom-inline-end corner that toggles motion **and** lets the click select the section (nothing is swallowed, no modal).

**By keyboard there was a real, pre-existing interference (D5):** the wrapper's `onKeyDown` called `preventDefault()` + select for *any* Enter/Space that bubbled up, including keystrokes from controls inside it — so a keyboard user could never operate a slider arrow, a dot or the new motion toggle in the Canvas (the key was cancelled and the section selected instead). A new control that cannot be operated by keyboard would have violated the "without interfering" requirement, so the wrapper now acts only on its **own** Enter/Space (`event.target === event.currentTarget`). Mouse/click behaviour is unchanged.

### 1.4 Additional confirmed defects found while reviewing
| # | Defect | Surface | Severity | Action |
|---|---|---|---|---|
| D1 | **A slider reduced to one slide** (other slides dropped at resolve time as unavailable) has `controls=false`, so an animated slide played with **no pause control** (WCAG 2.2.2). | Storefront | Medium (a11y) | **Fixed** (6 lines) + test that fails without the fix |
| D2 | The motion toggle had **no dedicated focus ring**: it fell back to the global `1px black` outline, which disappears over a dark picture / dark pill, while the neighbouring slider controls use a two-tone ring. | Storefront + Canvas CSS | Low–Medium (a11y, 2.4.7/1.4.11) | **Fixed** (one selector added to the existing two-tone rule in both stylesheets) |
| D3 | The storefront toggle exposes both `aria-pressed` **and** a label that flips ("Pause animation"/"Play animation"), so assistive tech announces the state twice (APG: a toggle's name must not change when it uses pressed state). | Storefront | Low | **Not changed** (out of the "parity defects only" scope; one-line follow-up: drop `aria-pressed`). The new Canvas control uses the label-only pattern; a test pins it. |
| D5 | Canvas section wrapper cancelled Enter/Space from controls inside it (keyboard users could not operate slider arrows/dots or the motion toggle in the Canvas) | Canvas | Medium (keyboard/a11y; blocks the new control) | **Fixed** (3 lines) + test that fails without the fix |
| D4 | Backdrop control is 40 × 40 px (slider pill: 44 × 44). Meets WCAG 2.5.8 (AA, 24 px) but not the 44 px AAA target. | Storefront | Info | Not changed |

---

## 2. Accessibility and visual review of the existing control

| Aspect | Result |
|---|---|
| Role/name | real `<button type="button">`, `aria-label` + `title` from the locale; SVG `aria-hidden`; AR "إيقاف الحركة / تشغيل الحركة", EN "Pause animation / Play animation" ✅ |
| Location in the tree | backdrop: **outside** the `aria-hidden` decorative layer ✅; slider: first item of the existing bar ✅ |
| Reduced motion | control hidden, stills shown (storefront already; **Canvas now mirrors it**) ✅ |
| No JavaScript | animation and control are both absent from server HTML (existing tests) ✅ |
| Contrast (WCAG 1.4.11 ≥ 3:1) | white glyph on `rgba(0,0,0,.6)`: worst case (white picture behind) ≈ **5.7 : 1** (computed: effective #666 vs #fff) ✅ |
| Target size | 40 px / 44 px ✅ AA |
| Focus visibility | was weak (D2) → two-tone ring now ✅ |
| RTL | position uses logical `inset-inline-end`/`inset-block-end`; verified no physical `left/right` in the Canvas style; slider bar is centred (direction-neutral) ✅ |
| Semantics | D3 (double state announcement) — reported |

Visual consistency: the Canvas control reuses the storefront's exact glyphs, size, colours, border and position (`CANVAS_MOTION_TOGGLE_STYLE` is guarded value-for-value against the storefront's `MOTION_TOGGLE_STYLE` by a test), and inside the slider it is styled by the **same** mirrored CSS pill.

---

## 3. What was changed (minimal; no second rendering system)

**Web (Canvas)**
| File | Change |
|---|---|
| `media/animated-preview-store.ts` (new, ~35 lines) | tiny in-memory store: `useMediaRefPreview` publishes the asset's signed *sanitised animated* URL (already in the response it fetches — **no extra request**); Canvas pictures read it. Never written to the document. |
| `media/use-media-ref-preview.ts` | +1 call publishing that URL. Hook signature and existing mocks unchanged. |
| `media/CanvasMotion.tsx` (new, ~75 lines) | `usePrefersReducedMotion`, `CanvasMotionToggle` (storefront-identical markup/glyphs/style, label-only a11y), `CANVAS_MOTION_TOGGLE_STYLE`. |
| `media/CanvasBackdrop.tsx` | same `<picture><img>`; `src` is the animation while playing (default), the still when paused / reduced motion / URL expired (`onError`); toggle sibling outside the aria-hidden layer when either picture is animated (the storefront rule). |
| `CanvasSlider.tsx` | active slide plays, inactive slides keep their still (inert + hidden anyway → no extra decode); motion control is the first item of the existing `data-slider-bar` (which now also renders for an animated slider with dots off, as on the storefront). Optional `labels.motion` — callers that predate it render exactly as before. |
| `StorefrontPreviewCanvas.tsx`, `messages.ts` | pass labels; two new AR/EN keys (`canvasMotionPause/Play`, same wording as the storefront); `SelectablePreviewSection` keyboard handler acts only on its own keystrokes (D5). |
| `store-preview.css` | +1 selector (D2). |

**Storefront**: `HomeSlider.tsx` renders the existing `data-slider-bar` + `MotionToggle` for a lone animated slide (D1, after hydration only, so no dead control without JS); `globals.css` +1 selector (D2).

**Decision made (reversible, owner may veto):** the Canvas **plays by default** (a faithful preview of the published page) and the editor can pause it; it is **still** for reduced-motion editors. If you prefer an always-still Canvas with opt-in playback (like the picker), the single change is the initial `useState(true)` → `false` in `CanvasBackdrop` and `CanvasSlider`.

**Not changed:** media validation, publish gates, tenant isolation, storage/R2, derivatives, accounting, API shape, migrations, the document/`MediaRef` contract.

---

## 4. Tests and results

| Check | Result |
|---|---|
| New `CanvasMotion.test.tsx` (19 tests): backdrop plays by default on the same structure; control outside `aria-hidden`; no `aria-pressed`; pause → still, play → animation; static unchanged; reduced motion → still + no control; expired URL → still; phone/desktop picture choice + "either animated" rule; **Arabic** labels + RTL logical placement (no physical `left/right`); legacy callers without labels unchanged; slider: control first in bar, only active slide plays, pause survives browsing, dots-off bar, reduced motion, **RTL + Arabic**, expiry fallback, late-arriving URL / removed slide, mirror guards (inline style value-for-value; two-tone focus ring in both stylesheets) | ✅ 19 passed |
| New `StorefrontPreviewCanvas.keyboard.test.tsx`: Enter/Space on the section selects and is default-prevented; the same keys from a control inside it are neither selected nor prevented. **Fails without the D5 fix** | ✅ |
| Storefront `AnimatedMedia.test.tsx`: lone animated slide gets bar + toggle and pausing drops the animation; lone static slide / server markup has none. **Verified the new test fails without the fix** (stash → red → restore → green) | ✅ |
| Web `store-experience-builder` + `app/(commerce)/commerce/appearance` suites (static and animated media, Canvas, picker, background bounds, CSS parity, selection) after the final code change | ✅ 154 files / 2,817 tests (earlier wider run incl. `commerce-workspace`: 198 files / 3,401 tests) |
| Storefront full vitest | ✅ 2,823 passed / 15 skipped, run twice (before and after the CSS change) |
| `tsc --noEmit` (storefront, web files touched) · storefront biome on touched files · `next build` (web) | ✅ clean (web `tsc` shows only pre-existing test-file type errors unrelated to this change) |
| PHP media tests | not re-run: **no PHP file changed** in this task (last run: 68 focused + 363 sweep, round 2) |
| AR/EN and RTL | covered in unit tests above; **not** exercised in a real browser (see §6) |

## 5. CI
__CI__

## 6. Risks and what is NOT verified

| Risk / gap | Level | Note |
|---|---|---|
| **Not seen in a real browser.** The Canvas toggle's layout/placement over a real hero, the RTL mirror, and actual animation in the Canvas were verified by DOM/unit tests only. This sandbox's headless Chromium cannot advance animated images, and the Canvas needs an authenticated workspace. | Medium | Owner check: open Appearance → a hero/banner with an animated GIF and an animated slide, in AR and EN, desktop + mobile viewport: animation plays, control bottom-end (backdrop) / in the pill (slider), pause shows the still, clicking it also selects the section. |
| **Animated WebP** in either surface is still not manually verified (owner-reported GIF only). The Canvas code path is format-agnostic (it uses the server's sanitised URL), but this is unproven. | Medium | Upload one animated WebP and repeat the check on the storefront and Canvas. |
| Editor signature expiry (signed URLs last 20 min): a paused→played animation after a long session may hit an expired URL | Low | `onError` falls back to the still; refreshing the editor renews. Existing behaviour of every editor image. |
| Default-playing Canvas could distract while editing | Low | One click pauses; reduced-motion respected; flip default in 2 places if you prefer (§3). |
| Storefront D3 (`aria-pressed` + changing label) and D4 (40 px target) | Low/Info | Not changed; recommended follow-ups. |
| Lone-slide fix changes markup only for an animated slider reduced to one slide | Low | Server HTML unchanged; test-guarded. |

## 7. PR #1547 documentation
`AWJ-ANIMATED-MEDIA-STAGING-ACCEPTANCE.md` was updated with **verified-only** evidence: a new §0 separates *verified here* (merge SHA; the `STOREFRONT_MEDIA_ANIMATED_ENABLED` variable now exists on production `nibras-api` — name only, value unread), *owner-reported* (flag enabled; GIF upload, playback, pause/resume on a real iPhone — OS/browser not stated, so it is **not** recorded as Safari and does not close the multi-version item) and *not verified* (animated WebP, other devices, Low Power Mode, rotation, reduced motion on device, R2 object layout). Checklist rows #1, #2, #4, #5, #13, #14, #16 and the go/no-go were corrected accordingly, §1 is marked historical, and the recommendation is now "supervised canary; do not widen until WebP and the remaining checks pass". Nothing owner-reported is presented as verified by me.

## 8. Remaining actions (owner)
1. Real-browser check of the Canvas (§6) and an animated-WebP end-to-end test.
2. Decide the Canvas default (playing vs still) and whether to take D3/D4.
3. Option B from the acceptance document (code default of `STOREFRONT_MEDIA_ANIMATED_ENABLED` → `false`) is still open.
4. Merging #1547 redeploys production from `main` (Railway auto-deploy, no CI wait) — merge deliberately.

No merge, deployment, production configuration change, migration, API change or Phase 2 work was done.
