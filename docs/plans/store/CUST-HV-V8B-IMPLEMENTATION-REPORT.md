# CUST-HV V8b — Slider: storefront rendering and real-browser proof — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8b** — second of the V8 slices (V8a model + Publish rules ✔ #1303 → **V8b storefront rendering + Chromium proof** → V8c Canvas parity + editor → V8d gallery model → V8e gallery rendering + lightbox → V8f gallery Canvas + editor). |
| **Branch** | `cust-hv/v8b-slider-render` (from `main` after #1303) |
| **Authority** | V0 §13.1 (Slider, D-16) · §6.6 (motion) · §4.5 (provable contrast) · §7.7 (phone art direction) · §3.5 (one resolver, tokens only) |
| **Scope** | The published storefront draws a `slider` section. One PHP change (the public media resolver now also publishes the proven contrast bounds of **slide** pictures); no Canvas, no editor, no schema or endpoint change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| Carousel library | **No library.** One in-house track (`HomeSlider.tsx`, ≈ 300 lines): slides stacked in one grid cell, the active one selected by `--sl-active`, a CSS transition, a timer. V0 §13.1 says "reuse the Swiper dependency (RTL verification U-3 first)"; every behavioural requirement of the contract is kept, and the library choice is an implementation detail it does not freeze. | Each requirement (logical RTL, `inert` on inactive slides, reduced motion, pause rules, first-slide-only eager loading) is a handful of rules here and is proven in a real browser with nothing between the document and the DOM; the U-3 question ("does Swiper mirror correctly under RTL?") disappears. No new bytes on the homepage's critical path. |
| Progressive enhancement | The server renders slide 1 active and every other slide `inert` + `aria-hidden`; the **controls render only after hydration**. | Without JavaScript the visitor sees one complete slide and no dead control (proved with JavaScript disabled). |
| Text colour | The Publish gate's own algorithm decides it, per slide, from the **bounds the server publishes** (`effectiveText` + `sectionContrastIssues` over the same pseudo-design). A slide with copy whose picture is **not** proven (stale or hand-built document) **withholds the picture** and draws the brand surface with its own automatic foreground. Slides with no copy always show their picture. | Text is never placed on a surface the proof did not cover; same fail-closed rule as a hero background (V6b-3). |
| Slide button | Solid, in the slide's **copy colour**, with the label in the better of pure white / black over that fill (always ≥ 4.5 : 1). | It contrasts with the picture exactly as far as the copy does and needs no extra proof; the global button tokens cannot put an `outline`/`link` button on an unproven picture. |
| Autoplay end | Without `loop`, autoplay **ends on the last slide** and offers Play; with `loop` it wraps. | The behaviour toggle `loop` means exactly one thing; a show that silently restarts is a surprise. |
| Pause rules | Pauses on hover, on focus within, while the tab is hidden, on the Pause / Play button, and on the **first touch (sticky: Play resumes)**. The track is `aria-live="off"` while it runs and `polite` otherwise. | D-16 + the ARIA carousel pattern. |
| Reduced motion | `prefers-reduced-motion: reduce` ⇒ no transition (CSS) and **autoplay never starts and there is no Pause button** (component). Manual navigation always works. | §6.6 "everything resolves to static". |
| Section design | Wrapped by the existing `SectionDesignFrame`; the slider root is the frame's direct child, so `background`, `spacing`, `width`, `border`, `radius`, `shadow`, `separator` and the `mediaTreatment.height` preset apply with the existing rules. | One design pipeline. |
| Public media resolver | Slide pictures (`…content.slides.N.media|mobile`) now carry the same `contrast` bounds as a section-background picture; nothing else does (a test pins both). | The storefront must re-decide the colour with the numbers the gate proved. Derived from a public picture; no raw evidence leaves. |

## What was built

- **PHP**: `StorefrontPublishedMediaResolver` (+ path test).
- **Storefront**: `slider-resolve.ts` (pure join of the document, the resolved media and the proof), `HomeSlider.tsx` (the client track), `published-nodes.tsx` (wiring, first-visible-section priority), the slider block in `globals.css` (inside `@layer utilities`, tokens only), `home.slider.*` strings in six locales, and `page.tsx` passing the labels.
- **Proof tooling**: `scripts/slider-proof/` (`make-pictures.mjs`, `mount.tsx`, `link-shim.tsx`, `measure.mjs`) and the env-gated `slider-proof.render.test.tsx`.

## Backward compatibility

A document without a slider renders byte-identically (no new markup, no new request). The CSS block only matches `[data-slider]`.

## Tests

- `slider-resolve.test.ts` (15), `HomeSlider.test.tsx` (28: server markup, controls, keyboard in LTR / RTL, swipe both ways, loop and clamping, every autoplay rule with fake timers, reduced motion), `published-nodes.slider.test.tsx` (7); PHP `StorefrontMediaRefTest` +1.

## Design Quality Pass — real Chromium

`scripts/slider-proof/` renders the **production** `publishedNodes` → `resolveSlider` → `HomeSlider` for 12 configurations (basic, light picture, black|white split under a 70 % wash, three alignments, fade, none, autoplay, phone art direction, eight slides with an unbroken word, a single slide, an unproven picture, and a designed frame) in AR RTL and EN LTR at 390 / 430 / 768 / 1024 / 1280 / 1440 and mounts the **real client component**:

**7 324 checks, 0 violations.**

| Area | What is asserted (every page × direction × width unless noted) |
|---|---|
| Layout | no horizontal overflow · exactly slide 1 active and inside the slider · every other slide `inert` + `aria-hidden` **and** actually not showing (parked outside, or hidden for fade / none) · the active picture loaded, the **phone picture below 768 px** (asserted from `currentSrc`) · copy never leaves its slide (a 100-character unbroken word wraps, 8 slides, AR + EN) · the three alignments land start / centre / end, mirrored under RTL · copy never collides with an arrow, the dots or the pause control and is the topmost thing at its centre · a designed frame applies its tokens and the *tall* preset |
| Logical RTL | "previous" on the inline-start edge, "next" on the inline-end edge · the next slide waits on the inline-end side · `→` / `←` follow the visual direction · a touch swipe toward the inline-start edge goes forward (both directions, both languages) |
| Controls & keyboard | arrows and pause ≥ 44 px, dots ≥ 24 × 44 · `aria-current` follows the active dot · pause button iff autoplay · `aria-live` off while it runs, polite otherwise · Tab never lands inside an inactive slide · every control shows a two-tone focus ring · slide names read "n of N" / "n من N" |
| No JavaScript | JavaScript disabled: slide 1 whole, no dead control, other slides not showing |
| Readability on real pixels | with the glyphs hidden, every pixel under each heading and sub line is read back (at 390 / 768 / 1280): the WCAG ratio of the copy colour against **that pixel** is ≥ 4.5 on every slide — dark picture, light picture, and the black \| white split under a 70 % wash; an unproven picture draws the brand surface at ≥ 4.5 and no `<img>`; the button fill equals the copy colour and its label clears 4.5 |
| Motion | `prefers-reduced-motion`: every slide transition is `0s`, autoplay never advances and there is no Pause button · with motion: autoplay advances after the 5 s interval, the Pause button holds it (label flips to Play), hover holds it, and it resumes after |

**Negative controls — each makes the proof fail:** `--noinert` (36 violations) · `--physical` left / right arrows (12, all RTL) · `--lie` low-contrast copy (66) · `--nomotion` reduced-motion rules removed (42).

**Defects the proof found and this slice fixed:**
1. A designed section background recoloured the slide copy dark (≈ 1.4 : 1 over the pictures): the shared resolver emitted `fg / heading / link` text tokens for a `slider` from its section surface. `resolveSectionDesign` now emits none for `slider` (both byte-identical twins, regression test in both apps); the copy colour is per slide, over its own picture.
2. Focus on the Pause / Play button held the show, so pressing Play did not start it. Focus on that button no longer counts as reading the slides (unit test added).

Screenshots: `docs/plans/store/cust-hv-v8b/` (LTR desktop, RTL phone, light picture, wash, designed frame, withheld picture, alignment, phone art direction).

## Limitations (stated)

- No Canvas parity and no editor (V8c); until then a slider can only arrive through the API.
- Pictures in the proof are synthetic photographs (grain, gradients, a hard split); the **real-upload → real evidence → real gate** chain is the one V6b-5 proved for hero backgrounds and is shared (the same bounds, overlay and engine); a slider-specific real-pipeline run is not repeated here.
- No per-slide button style / colour, no `layout: split`, no `mediaTreatment.aspect` / `fit`, no drag handle on desktop (swipe is touch / pen; the arrows, dots and keyboard are the mouse interface).
- Slide pictures beyond the first are `loading="lazy"`; the browser may still fetch the next one early because it is one step away.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the storefront reads only the Published document and the resolved media the server already scopes to the tenant; the only server change publishes numbers derived from a public picture. No arbitrary CSS / JS / HTML: every colour is a validated hex written to a custom property, every class a literal, every `href` through the content-href sanitiser and `destination()`. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
