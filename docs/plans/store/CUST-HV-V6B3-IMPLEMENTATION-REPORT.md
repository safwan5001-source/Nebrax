# CUST-HV V6b-3 — Picture background on the published storefront — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6b-3** — third part of V6b (V6b-1 evidence ✔ → V6b-2 contract + gate ✔ → **V6b-3 storefront rendering** → V6b-4 merchant inspector + Canvas → V6b-5 real-pixel proof suite) |
| **Branch** | `cust-hv/v6b3-media-render` (from `main` after V6b-2) |
| **Authority** | V0 §8.1 (hero/banner media, overlay, phone art direction) · §3.5 (resolver is the one place a design becomes DOM tokens) · §7.8 (the browser only ever sees proxy paths) · AMEND-1/9 |

---

## Implemented

### The server tells the storefront what was proved — nothing else
`StorefrontPublishedMediaResolver` adds **`contrast: {min:[r,g,b], max:[r,g,b]}`** to entries **under `design.background` only** (logos and every other reference are unchanged). They are the same margin-widened bounds the publish gate used (`StorefrontMediaContrastEvidence`), so the public page picks its automatic text colour with the gate's own algorithm. They are derived from a picture that is already public, so nothing secret leaves; raw `region_luminance`, averages and dominant colour still never do. Invalid/absent evidence ⇒ no `contrast` ⇒ unproven.

### One resolver, one decision (both TS twins byte-identical)
`resolveSectionDesign` paints a picture background **only when it is proven right there**: every picture that can show (default + phone) has bounds **and** the text clears 4.5:1 over the whole range under the overlay. Then it emits `mbg` (+ `ovl` with `--sec-ovl` / `--sec-ovl-a`) and the usual `fg`/`heading`/`link` tokens. **Otherwise it behaves as if there were no background at all** — legacy surface *and* legacy text colours — so a stale or hand-built document can never put text on an unproven picture, and never gets a colour chosen for a surface that is not there.

### Backdrop DOM + CSS (identical block in `globals.css` and the Canvas `store-preview.css`, parity-tested)
`<div data-sd-backdrop aria-hidden>` → `<picture>` (+ `<div data-sd-overlay>`). Rendered by the section itself as its first child, so the frame's `> *` rules never touch it:
- the section root becomes the positioning context and drops its own fill (`mbg`); the backdrop is `absolute inset:0`, `overflow:hidden`, `border-radius: inherit` (clips to the section's radius without clipping focus outlines), `pointer-events:none`;
- everything after the backdrop paints above it (`z-index:1`);
- overlay colour/strength come only from the validated vars.

### Storefront wiring
- `lib/presentation/background-media.ts` — paths keyed by the section's index in the **whole** list (hidden sections count, exactly like the server); bounds looked up by **reference identity** (two sections using one picture stay independent).
- `SectionBackdrop` — decorative `<picture>`: **phone picture = art direction** (`<source media="(max-width:767px)">` ahead of the default ones, so exactly one file loads), WebP + JPEG, real rendered widths, focal point; the **first hero** is eager + `fetchpriority=high` (LCP), everything else lazy.
- `publishedNodes` feeds `mediaBounds` to the resolver and a `backdrop` node to `HeroSection` / `BannerBand` (new optional prop; absent ⇒ byte-identical output).
- `resolved-media.ts` reads `contrast` defensively (3 integer channels 0–255, ordered; anything else is dropped).

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontMediaRefTest` +1: only section-background pictures carry bounds, logos never; nulled evidence ⇒ no bounds; raw `region_luminance` never in the payload |
| Resolver (twins) | +4 per twin: proven picture ⇒ `mbg`/`ovl`/vars/proven `fg`, never the solid-fill token; overlay-less; **no bounds / empty range / un-clearable range ⇒ nothing painted and no foreground chosen**; overlay makes a wide range provable |
| Stack | `published-nodes.media` 8: backdrop first child + tokens + eager first hero; unproven ⇒ legacy; wide range ⇒ legacy; phone picture must be proven too; index counts hidden sections; only first hero eager; banner; older payload without media |
| Units | `SectionBackdrop` 3 (decorative, art direction order, priority) · `background-media` 5 · `resolved-media` contrast parsing |
| Real browser (Chromium, real `publishedNodes` output + the compiled storefront CSS) | AR RTL + EN LTR × **390 / 768 / 1280**: no horizontal overflow; backdrop exactly covers the hero root; **phone picture chosen at 390, default at 768/1280**; heading is the element on top at its own centre; overlay colour/opacity as authored; backdrop radius = root radius, `overflow:hidden`, `pointer-events:none`; the unproven third section keeps the legacy gradient (mirrored in RTL) and no backdrop; automatic text: white over the dark picture, black over the pale one |
| **Pixel contrast** | with the text hidden, the real rendered pixels behind each text block were read back: **worst WCAG ratio 7.41 (hero, 390 RTL) … 20.1**, never below 4.5 (`cust-hv-v6b3/pixel-contrast.json`) |
| Full suites | storefront vitest 1533 ✔ · web `store-experience-builder` 1098 ✔ · tsc + biome clean — PHP/web full numbers in the PR |

Evidence: `docs/plans/store/cust-hv-v6b3/` — six full-page screenshots (`{ltr,rtl}-{390,768,1280}.png`), `metrics.json`, `pixel-contrast.json`. The demo pictures are flat colour SVGs whose declared bounds are computed from their real colours — not a photo benchmark; the end-to-end suite on real uploaded photos is V6b-5.

## Design Quality Pass
Checked at 390 / 768 / 1280, EN LTR and AR RTL: heading, supporting line and CTA read cleanly over the picture and its wash; the CTA keeps its own solid fill (it is a nested surface, untouched by the `fg` rules); rounded corners clip the picture without clipping focus rings; the hero keeps its min-height rhythm; RTL mirrors the legacy gradient and the layout, while the picture itself is not mirrored (it is content). **Not claimed here:** Canvas painting of the picture and the merchant control (V6b-4), real photos / derivative-cropped frames in a browser (V6b-5).

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation / RBAC | Bounds computed through the tenant-scoped evidence service in the public tenant context; no new endpoint or permission |
| Draft vs Published | Only the published snapshot's references are resolved; the public page never reads draft evidence |
| Security | Only same-origin proxy paths reach `<img>`; colours are validated hex/role; nothing from the document becomes CSS text; the backdrop is `aria-hidden` and inert |
| Backward compatibility | Additive payload field (optional, ignored by older clients); `backdrop` props optional; documents without a picture background render byte-identically |
| Accessibility | decorative image (`alt=""`, `aria-hidden`), text contrast re-proven at render, no pointer/focus interference |
| Commerce / accounting | Untouched |

## Limitations / next
- **V6b-4** — Canvas paints the same DOM (`useMediaRefPreview` for default + phone) and the merchant inspector gets the picture kind (reusing `MediaRefField`), overlay colour/alpha, AR/EN copy, and a read-only bounds field so the live verdict matches the gate. Until then a picture background can only be authored through the API.
- The phone picture's own focal point is not applied (CSS `object-position` is per `<img>`); a phone-specific framing is a crop on the phone `MediaRef`, which is a derivative with its own evidence.
- Text over a picture whose evidence was cleared *after* publish falls back to the legacy surface (by design) rather than breaking.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
