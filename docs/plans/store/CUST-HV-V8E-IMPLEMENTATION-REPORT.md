# CUST-HV V8e — Gallery: storefront rendering, viewer and real-browser proof — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8e** — fifth V8 slice (V8a–c slider ✔ → V8d gallery model ✔ #1310 → **V8e gallery rendering + viewer + Chromium proof** → V8f gallery Canvas + editor + Library flip). |
| **Branch** | `cust-hv/v8e-gallery-render` (from `main` after V8d) |
| **Authority** | V0 §13.2 (Gallery, D-24) · §6.6 (motion) · §3.5 (one stylesheet, tokens only) · §3.2.1 (per-locale alt) |
| **Scope** | Storefront only: the published page draws a `gallery` section (grid or strip, captions, links, modal viewer). **No PHP, endpoint, schema or Publish-rule change**; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. The Canvas and the editor are V8f, so a gallery can still only arrive through the API and the Library keeps it disabled. |

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| "Reuse `MediaLightbox`" (V0 §13.2) | **A new generic viewer (`GalleryLightbox`), not the product one.** | The product lightbox is Spree-`Media`-typed, has no focus trap, physical `right-4` placement and physical ←/→ — none of which meets the contract it is quoted for ("focus trap, `Esc`, arrow keys, RTL, restore focus"). The contract's requirements are kept; the component is not. |
| Progressive enhancement | The server renders the **complete** gallery: grid / strip, pictures, captions, links. With the viewer on, an unlinked picture is an `<a>` to the **large picture file** (a no-JS visitor simply opens it); `GalleryClient` upgrades a plain click to the modal viewer after hydration, and leaves a modified click (new tab, download) to the browser. Strip buttons render only after hydration and only when the strip overflows. | No dead control without JavaScript (proved with JS disabled). |
| Layout is CSS, not script | `--ga-n` = visible columns by viewport: **phones 2**, tablets cap **4 → 3, 6 → 4**, desktops the authored count. The strip is a native `scroll-snap` scroller (touch, wheel, keyboard and direction are the browser's). | Fewer failure modes, no layout shift, works with JavaScript off. |
| Link vs viewer | A picture with a merchant link stays a link (through the shared `destination()` rules; `https://` gets `noopener noreferrer`); the others open the viewer. A linked picture with neither alt nor caption is still named ("Picture n"). | Recorded in V8d; the merchant's explicit link wins. |
| Captions | `<figcaption>` under the picture on the section surface, drawn only when `captions` is on; colour comes from the section frame's proven token (undesigned: the theme's muted foreground). | Nothing is drawn over a gallery picture, so no contrast verdict per image is needed. |
| Viewer behaviour | Real modal dialog: focus to Close on open, **Tab / Shift+Tab trapped**, `Esc` and a backdrop press close, page scroll-locked, focus returns to the opener, wraps at both ends, neighbours prefetched. **← / → follow the visual direction** (in RTL ← is "next"); previous / next on the logical edges; a swipe toward the inline-start edge goes forward. | Same logical-RTL rules as the slider; arrow keys follow what the user sees. |
| Viewer buttons | Dark translucent fill with a light edge (not a white wash). | The Chromium pass showed white-on-light-picture arrows nearly invisible; fixed and re-proved. |
| Loading | The first row is eager **only when the gallery opens the page**; everything else is lazy with the intrinsic size reserved by the aspect-ratio frame. | LCP without layout shift. |
| Stylesheet | One block in `globals.css` (`@layer utilities`), mirrored into `store-preview.css` for the Canvas (the parity test pins them). Only closed-list data attributes reach it. | §3.5. |

## What was built

- `lib/presentation/gallery-resolve.ts` (the pure join: omitted-not-guessed, per-locale alt, fit / focal, options, layout) and `pictureData`.
- `HomeGallery.tsx` (server markup), `GalleryClient.tsx` (viewer opener + strip buttons), `GalleryLightbox.tsx` (the viewer, lazy-loaded on first open), `published-nodes.tsx` branch, `page.tsx` labels, `home.gallery.*` strings in six locales, the gallery stylesheet block (+ mirror).
- Proof tooling: `scripts/gallery-proof/{mount.tsx,dynamic-shim.tsx,measure.mjs}` and the env-gated `gallery-proof.render.test.tsx`.

## Backward compatibility

A document without a gallery renders byte-identically (no new markup, no request). The CSS block only matches `[data-gallery*]`.

## Tests

- `gallery-resolve.test.ts` (7), `HomeGallery.test.tsx` (11: server markup is complete, eager rule, captions, links, openers, viewer open / modified click / Esc + focus return), `GalleryLightbox.test.tsx` (9: dialog semantics, close paths, arrow keys in LTR and RTL, wrap, focus trap, edges, swipe in both directions, single picture, scroll restore), `published-nodes.gallery.test.tsx` (7).

## Design Quality Pass — real Chromium

`scripts/gallery-proof/` renders the **production** `publishedNodes` → `resolveGallery` → `HomeGallery` for 8 configurations (3-column grid with captions, 6-column grid, 2-column 4:5 with an unbroken caption word, contain-fit + focal, carousel, grid + viewer with a linked image, carousel + viewer, designed dark surface) in AR RTL and EN LTR at 390 / 430 / 768 / 1024 / 1280 / 1440 and mounts the **real client components**:

**5 150 checks, 0 violations** (re-run after the viewer-button fix: viewer pages 1 538 / 0).

| Area | What is asserted |
|---|---|
| Layout | no horizontal overflow · visible columns 2 / tablet cap / authored · the authored gap · every frame has the authored aspect ratio and its picture fills it (cover / contain, focal point) · first item on the inline-start edge · every picture decodes · captions stay inside their item (a 90-character unbroken word wraps, AR + EN) · caption contrast ≥ 4.5 : 1 on the actual surface, designed or not |
| Strip | scroll-snap x mandatory · item width = (strip − gaps) / n · buttons exist iff it overflows, on the logical edges (mirrored in RTL), ≥ 44 px, `aria-disabled` at the ends, and a click moves the strip toward the inline-end edge (negative `scrollLeft` in RTL) |
| No JavaScript | JS disabled: same grid / strip, **zero buttons**, no viewer, openers are anchors to the picture file |
| Viewer | modal dialog covers the viewport, focus on Close, page scroll-locked, picture + caption inside the viewport, counter "2 of N", no overflow while open · Close on the inline-end edge, previous / next on their logical edges, all ≥ 44 px · → / ← follow the visual direction · Tab / Shift+Tab cycle inside · `Esc` and a backdrop press close, scroll lock released, focus back on the opener · the linked image is a link, never an opener · focus ring on picture anchors ≥ 2 px |
| Motion | reduced motion: no transition, no hover zoom · with motion: hover zoom on |

**Negative controls — each makes the proof fail:** `--physical` (physical left / right on the buttons, 12 violations) · `--noreduce` (reduced-motion rules removed, 1) · `--swapkeys` (arrow keys not following the visual direction, 6) · `--notrap` (no focus trap, 12) · `--wrongcols` (wrong desktop column count, 12).

Screenshots: `docs/plans/store/cust-hv-v8e/` (grid, strip, viewer, RTL + LTR, phone + desktop).

## Limitations (stated)

- No Canvas parity and no editor (V8f); the Library keeps the gallery disabled with its reason.
- No pinch / zoom or drag inside the viewer (arrows, keyboard and swipe navigate; the picture is the largest rendered width).
- The viewer wraps; there is no thumbnail strip, download or share (not in the contract).
- Real-upload → real-evidence chain: nothing is proven over a gallery picture, so no evidence is needed; per-locale alt and ownership are the generic media gate's (V8d tests).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the storefront reads only the Published document and the resolved media the server already scopes to the tenant (same-origin proxy paths only). No arbitrary CSS / JS / HTML: closed-list data attributes, validated numbers, links through `destination()`. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
