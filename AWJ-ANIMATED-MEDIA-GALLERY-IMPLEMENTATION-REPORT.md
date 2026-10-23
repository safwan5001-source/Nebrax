# AWJ-ANIMATED-MEDIA — Animated GIF / WebP in the Storefront Gallery (PR #1652)

| | |
|---|---|
| **PR** | [#1652](https://github.com/safwan5001-source/Nebrax/pull/1652) — `feat/storefront-gallery-animated-media` → `main` |
| **Original base SHA** | `7273b591dc66b8ad7288c6e8dbaa9ff424a6b6f2` (draft opened here) |
| **Draft head SHA (before this work)** | `579d397e5a59bd592cefd5893a9b0cce7573d7b5` |
| **Code head SHA (this work, before the report commit)** | `3734c75381d4334c4df194acb41f38438d5a577c` |
| **Merged-in `main`** | `cc8b1a4b68dcaf9f54c8cbea21733adee51469c9` (clean merge; only unrelated treasury files came in) |
| **Status** | Ready for review. **Not merged, not deployed.** |

## 1. Summary

A merchant uploaded a valid animated GIF to the Gallery (معرض الصور) and publishing failed with
`animated_not_allowed_here` ("section backgrounds and slider slides only"). The gallery now accepts and **renders** safely
sanitised GIF / animated WebP — in the grid and in the lightbox — under a configurable WCAG 2.2.2 policy.

The draft in #1652 only opened the publish gate and wired `MotionPicture`/lightbox. Review of the draft found real defects, all fixed here:

| # | Draft defect | Fix |
|---|---|---|
| 1 | Existing test `an_animation_is_publishable_only_where_the_storefront_renders_it` still asserted the gallery is **denied** → PHP CI would have been red | Updated; gallery now asserted allowed, logo/blocks still denied |
| 2 | Lightbox `<source>` animation was **not pausable and not hydration-gated**: a >5 s looping animation with no pause/stop/hide mechanism (WCAG 2.2.2 fail) and motion for no-JS | Viewer now uses `MotionPicture` (still first, animation after hydration) + the policy below |
| 3 | Lightbox reduced-motion `<source type="image/webp" srcSet={item.webp \|\| item.src}>` could label the **JPEG fallback as WebP**, had no `sizes`, and had no JPEG poster | Poster sources are now built by the one established helper (`animatedPictureSources`) with `sizes="100vw"`, WebP + JPEG |
| 4 | `MotionPicture id={animation.src}`: two gallery tiles of the same asset (or the grid and another section) shared pause state by accident; no gallery-level control | Identity is `{sectionId}-gallery-motion[-{imageId}]`, deliberate sharing only |
| 5 | No `showMotionControls` setting, no editor/Canvas parity, no tests of any kind, no CSS for a control | Added end to end (below) |
| 6 | Editor error text still said "backgrounds and slider slides only" | AR/EN updated |

## 2. Behaviour (UX + accessibility decision)

**Setting** `content.options.showMotionControls` — stored **only as `true`** (like `captions`/`lightbox`), so legacy documents gain no key and published bytes are unchanged.

| `showMotionControls` | Visible pause button | Motion | WCAG 2.2.2 mechanism |
|---|---|---|---|
| **off (default)** | none (the merchant's requested design) | each animated picture plays a **bounded window of 5 s once it is ≥25 % on screen**, then settles on its still frame | motion never lasts > 5 s ⇒ no pause control required |
| **on** | **one** pause/play button for the whole gallery (top inline-end corner; the lightbox shows the same button and **shares state**) | continuous | the button |
| either | — | `prefers-reduced-motion`: the browser picks the poster `<source>`; the animation file is **never requested**; no button | OS-level preference honoured |
| either | — | no JS / SSR: still frame only; the animated `<source>`s are added after hydration; no dead button | no motion without a control |

The 5 s window uses the existing "drop the animated `<source>`s" mechanism (an animated `<img>` cannot be paused), started by a timer. A short play-once file (`loop=false` and `durationMs ≤ 5000`) is exempt (it ends by itself) so it is never yanked back to frame 1. This is a **policy decision for the owner** (`configurable-policies.md` principle): the alternative "always show a pause button" is one toggle away per gallery.

## 3. Files changed

**Backend (PHP)**
- `app/Services/Commerce/StorefrontMediaPublishGate.php` — gallery `content.images.N.media` allowed (draft); comment/message aligned.
- `app/Support/Commerce/StorefrontGalleryNormalizer.php` — `showMotionControls` opt-in (`=== true`, last in key order).
- `tests/Fixtures/presentation/gallery.json` — 4 new shared cases + `false` added to the "defaults never stored" case.

**Storefront**
- `src/lib/presentation/animated-sources.ts` — `MOTION_BUDGET_MS`, `exceedsMotionBudget()`.
- `src/components/ui/motion-picture.tsx` — optional `autoStopMs` + `useMotionBudget` (IntersectionObserver start; unchanged when not passed).
- `src/components/home/HomeGallery.tsx`, `GalleryClient.tsx`, `GalleryLightbox.tsx` — grid + viewer rendering, shared control.
- `src/lib/presentation/gallery-content.ts` — twin of the PHP normalizer.
- `src/app/globals.css` — `[data-gallery-motion]` + viewer toggle rules.
- `src/app/dev/animated-media-visual/page.tsx` — 4 dev scenarios for the browser spec.

**Web (editor)**
- `presentation/gallery-content.ts` (byte-identical twin), `gallery-edit.ts` (`compactOptions`), `GalleryFields.tsx` (toggle + explanation), `CanvasGallery.tsx` (animated preview + same policy), `StorefrontPreviewCanvas.tsx` (labels), `messages.ts` (AR/EN), `store-preview.css` (mirrored CSS).

**Docs:** `CLAUDE.md` (animated-media section), this report.

**Tests added/updated**
- PHP: `tests/Feature/StorefrontGalleryAnimatedMediaTest.php` (new, 8 tests), `StorefrontAnimatedMediaTest.php` (updated).
- Storefront: `HomeGalleryAnimated.test.tsx` (new, 15), `animated-media.test.ts` (+2), `gallery-content.test.ts`, `gallery-resolve.test.ts` (updated), `e2e/animated-media-visual.spec.ts` (+11 browser specs).
- Web: `CanvasGalleryMotion.test.tsx` (new, 6), `GalleryFields.test.tsx` (+2), `gallery-edit.test.ts` (+1), `gallery-content.test.ts` (updated).

## 4. Tests and results

| Suite | Result |
|---|---|
| PHP `StorefrontGalleryAnimatedMediaTest` + `StorefrontAnimatedMediaTest` + `StorefrontGalleryTest` (incl. all fixture cases) | **115 passed** (720 assertions) |
| PHP negative control — new test against `main`'s gate | **4 of 8 fail** (as they must) |
| PHP `--filter=Storefront` (broader) | **1472 passed, 17 skipped** (14,766 assertions, 0 failures; on the pre-merge-of-main tree — `main`'s only new files are unrelated treasury code) |
| Storefront vitest (full) | **2990 passed, 15 skipped** (216 files) |
| Storefront `tsc --noEmit` | clean |
| Web vitest `store-experience-builder` (159 files, incl. CSS-parity tests) | **2956 passed** |
| Web `tsc --noEmit` | no errors in any non-test file I touched (pre-existing errors exist in unrelated `*.test.tsx` files on `main`) |
| **Real Chromium** (`playwright.animated-media.config.ts`) | **20 passed, 3 skipped** (the three "frames really change" canaries — see §6) |

**CI on code head `819276c`:** all 7 checks green — `php artisan test` (sqlite **and** pgsql, full suite), `web build (Next.js)`, `storefront (lint + typecheck + test)`, `merchant preview visual QA`, `published footer visual QA`, `CI Gate`; mergeable state `clean`. (An earlier `CI Gate` failure on `85d43d7` was only the gate's own "stale gate: PR head is now 819276c" guard, not a test failure.)

Not run locally: the **full** PHP suite and the two `next build`s — they ran in CI (above). The Codex review bot did not review (its usage limit was reached: "We couldn't complete this review"); there are no review threads, so **no automated or human code review has happened yet.**

## 5. Analysis

**Tenant isolation / security.** Nothing about asset trust changed: only server-issued same-origin proxy paths (`/api/storefront/media/customizer/{uuid}/animated.{gif|webp}`) from the resolver reach the DOM — never user-supplied URLs. The gate still looks assets up through the tenant-scoped, `active` query: another tenant's asset ⇒ `media_missing`, not-ready/failed ⇒ `media_not_ready`, deleted ⇒ `media_missing`, rotate/crop/focal/fit ⇒ `animated_transform_unsupported` (all asserted, GIF and WebP, no per-asset special-casing). The proxy still serves a file only when the tenant's **published** document references it and only on the tenant's own host (asserted, including cross-tenant 404). No new upload path/permission, no limits touched (frames/pixel budget/dimension caps unchanged), still ladder never contains the animated file. The allow-list regex is anchored (`\z`) and matches only the `…images.N.media` leaf (a sibling key such as `poster` stays denied — asserted).

**Backward compatibility.** `showMotionControls` is `true`-only; the normalizer test proves legacy documents gain no `options` key, non-`true` values (`false`, `"yes"`, `1`, …) never opt in, and re-normalising is byte-identical. A gallery with no animated picture renders **byte-identically** to before regardless of the setting (asserted by SSR string equality), and `GalleryViewerItem.motion` is spread only for animated items. `MotionPicture`/`SectionBackdrop`/`HomeSlider` behaviour is untouched (`autoStopMs` is opt-in; existing animated-media tests and browser specs pass).

**Accessibility.** Control: native `<button>`, accessible name Pause/Play (existing `home.motion` strings, AR/EN), `aria-pressed`, 44 px target (browser-verified ≥ 40 px), two-tone focus ring (existing rule), keyboard operable (Enter verified), inside the dialog's focus trap in the viewer. RTL: control sits at the **inline-end** corner in LTR and RTL (browser-verified); logical properties only. Alt text, captions, link/lightbox semantics unchanged.

**Editor/Canvas parity.** Same `data-gallery` DOM and CSS (parity tests green); the Canvas plays the signed sanitised animation, applies the same policy, and falls back to the still on a stale signature. Difference (documented): the Canvas cannot read loop metadata, so it applies the 5 s window to every animated picture (the storefront exempts short play-once files), and starts the clock at mount rather than on visibility.

## 6. Known risks, unverified items, remaining work

1. **Frame-advance playback was not verified here.** The three "frames really change" Playwright canaries skip because this headless Chromium build does not advance *any* animated image (the harness' own control-GIF canary fails). Source selection, fetching, decoding, sizing, pause/resume and the 5 s settle **are** verified in Chromium; actual frame motion needs a manual look on a desktop browser (see checklist).
2. **Manual checks still owed** (no WebKit/Firefox/real devices here): Safari/iOS (animated WebP + GIF in `<picture>`), Firefox, real phone scroll performance with several animated tiles, and a visual pass of the control over light/busy thumbnails.
3. **Finite repeat counts ≥ 2** (GIF/WebP loop count `N`) are not exposed by the analyser (`loop` = infinite only), so a `loop=false` file that plays `N × duration > 5 s` is treated as "ends by itself". Rare; the fix is to expose the loop count in the animation meta (additive, but a separate change to the media pipeline).
4. **Policy call for the owner:** with the control off, motion is capped at 5 s per picture. If the owner prefers continuous motion by default the setting must default to `true` (it would then show the button) — there is no compliant "continuous and invisible" option.
5. **Perf:** a gallery of up to 24 animated tiles each fetches its full `animated.*` after hydration (no `srcset` for animations, by design of the P1 pipeline). The 25 %-visible IntersectionObserver gates only the *timer*, not the fetch; the existing per-file limits bound it. Recommend merchants use few animated tiles; a future slice could lazy-mount animated sources on visibility.
6. **No code review yet** (Codex bot hit its usage limit; comment `@codex review` to retry). Pre-existing lint errors in unrelated storefront files (`CategoriesSection.display.test.tsx`, `header-overlay.ts`) are on `main`, not introduced here.

**Manual checklist:** (a) upload a real GIF and an animated WebP → add to a gallery → Preview shows motion, (b) publish passes, (c) published page: motion starts after load, settles after ~5 s with the default, (d) turn on *Show a pause button…* → one button, pause/play works in grid and viewer, (e) OS "reduce motion" → still only, (f) Arabic/RTL and a phone width, (g) Safari iOS.

## 7. Proposed next action

Review the PR; run the manual checklist on a staging store; decide the §6.4 policy default; then merge when CI is green. **No deploy** is implied — Deploy/Production needs separate explicit approval.
