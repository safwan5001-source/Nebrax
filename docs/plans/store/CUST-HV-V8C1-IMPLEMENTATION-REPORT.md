# CUST-HV V8c-1 — Slider in the Canvas — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8c-1** — first of two parts of V8c (V8a model ✔ #1303 → V8b storefront ✔ #1306 → **V8c-1 Canvas parity** → V8c-2 slider editor + Library flip) → V8d gallery. |
| **Branch** | `cust-hv/v8c-slider-editor` (from `main` after #1306) |
| **Authority** | V0 §6 (the Canvas shows what will be published — one resolver, one stylesheet block) · §13.1 · §4.5 (provable contrast) |
| **Scope** | Merchant app only (+ the shared pure decision moved into the byte-identical twin): the Canvas draws a `slider` section. **No PHP, no storefront behaviour change** (the storefront resolver now calls the shared function; its tests pass unchanged), no endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Where the per-slide decision lives | **`slideDraw(slide, ctx)` in `slider-content.ts`** (byte-identical in web and storefront): picture vs brand surface, the copy colour, the solid button's label, the resolved overlay. The storefront's `resolveSlider` now only joins server data to it; the Canvas calls the same function with the editor's own proven bounds. | One decision, two callers — the Canvas cannot disagree with the storefront about whether a slide's copy is readable. |
| Canvas proof source | The Canvas reads each slide picture's **proven bounds** through the existing read-only hook (`useBackgroundMediaBounds`, now also collecting the pictures of every *visible* slider slide and its phone picture) — the same numbers the Publish gate will use; a slide whose bounds are not proven yet draws the brand surface, exactly as the storefront would. | V0 §3.2.1: the editor's verdict uses the gate's numbers. |
| Phone picture | Chosen from the **simulated** `viewport`, not a media query against the host window (as `CanvasBackdrop`). | The editor window is larger than the simulated device. |
| Copy sizing and slide height | The shared stylesheet block sizes the copy and the slide with media queries against the **host window**; the Canvas root carries `data-vp="mobile | tablet | desktop"` and a small Canvas-only block (placed *before* the parity-tested marker, higher specificity) gives each device the storefront's own numbers. | The Canvas resolves breakpoints from its `viewport` prop. The parity test still pins the shared block byte-for-byte. |
| Autoplay in the editor | Nothing autoplays; arrows and dots browse the slides (the pause control does not exist in the Canvas) and a screen-reader note says "Autoplay does not run in the preview". | A moving preview is hostile to editing; the storefront proof already covers the timer. |
| Incomplete slider | A slider with no slide shows a dashed card saying what it needs; Publish still enforces ≥ 2 slides. | Honest authoring. |

## What was built

- `slider-content.ts` (both apps): `slideDraw` + `SlideDraw`; storefront `slider-resolve.ts` refactored onto it.
- `CanvasSlider.tsx`, the `slider` branch of `StorefrontPreviewCanvas`, `use-background-media-bounds.ts` (slider pictures), `store-preview.css` (device sizing), AR / EN messages, and the dev-page scenario `/dev/customizer-visual?scenario=slider`.

## Backward compatibility

A document without a slider renders exactly as before. The storefront's output is unchanged (its 49 slider tests + the 7 336-check Chromium proof's inputs are untouched by this refactor; `slider-resolve` / `HomeSlider` / `published-nodes` suites pass unchanged).

## Design Quality Pass

`e2e/cust-hv-v8c-canvas-slider.spec.ts` (real Next dev server; the media endpoints mocked: a dark picture with proven bounds, one with none, a light one) — AR RTL / EN LTR × the three simulated devices (1 280 / 768 / 390 px frames inside a 1 440 px window) — **6 / 6**: the page gains no horizontal overflow; the active slide is whole and inside the frame; the others are `inert` and parked and the next one waits on the inline-end side; the proven dark picture carries the proven white copy and the button label clears 4.5 : 1 against its fill; the unproven slide withholds the picture for the brand surface at ≥ 4.5 : 1; the light picture proves black copy; arrows on the logical edges (mirrored under RTL), ≥ 44 px, three dots; **the heading size, the copy padding and the slide height are the simulated device's own** (mobile 20 px / 56 px / 16 rem, tablet 24 / 72 / 17.25 rem, desktop 36 / 80 / 28.8 rem), not the host window's; the copy never leaves the frame. Screenshots are in the test results; the storefront's own Chromium proof for the same markup is V8b's.

Unit: `CanvasSlider.test.tsx` (8), the shared `slideDraw` cases in both apps' `slider-content.test.ts` (6 each), the picture collection of `use-background-media-bounds`.

## Limitations (stated)

- No editor yet (V8c-2): a slider can still only arrive through the API; the Library keeps it disabled with its reason.
- The Canvas draws the slide button as a non-link span (it is a preview); the unit tests run React 18 which drops the `inert` attribute, so `inert` is asserted in the browser spec (Next App Router renders with React 19).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the Canvas reads the same workspace media endpoints (signed, read-only) it already reads for backgrounds. No arbitrary CSS / JS / HTML: every colour reaches the DOM as a validated custom property. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
