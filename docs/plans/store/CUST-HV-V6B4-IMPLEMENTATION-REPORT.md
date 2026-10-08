# CUST-HV V6b-4 — Merchant control + Canvas for picture backgrounds — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6b-4** — fourth part of V6b (V6b-1 evidence ✔ → V6b-2 contract + gate ✔ → V6b-3 storefront ✔ → **V6b-4 merchant control + Canvas** → V6b-5 real-pixel proof suite). Built as 4a (read-only bounds API, hook, Canvas) and 4b (the Design-tab control). |
| **Branch** | `cust-hv/v6b4-media-inspector` (from `main` after V6b-3) |
| **Authority** | V0 §8.1 (hero/banner picture, overlay, phone art direction) · §3.2.1 / §4.5 (the editor shows the gate's own verdict) · §7.8/§7.10 (a picture is a `MediaRef`; previews are editor-only signed URLs) |

---

## Implemented

### 4a — The editor reads the numbers the gate uses (read-only, no new endpoint)
- `derivatives/status` and `derivatives/ensure` return **`contrast`** for the usage: the same margin-widened bounds `StorefrontMediaContrastEvidence` gives the publish gate (default frame ⇒ the asset's evidence; a framed usage ⇒ the union over its ready derivative rows). `null` when there is no valid evidence (framed usage still processing, an asset that predates evidence, a translucent picture, nulled evidence). Raw `region_luminance` still never leaves the server.
- `useBackgroundMediaBounds(sections)` (web): reads each visible picture background's usages once, polls a still-processing framed usage (bounded: 30 × 2 s), ignores stale responses, and exposes `lookup(ref)` (what `DesignContext.mediaBounds` expects) and `stateOf(ref)` — `loading | ready | unavailable`. A document with no picture background fetches nothing.
- `CanvasBackdrop` — the Canvas paints **the same `data-sd-backdrop` / `data-sd-overlay` DOM** as the storefront, so the single CSS block (identical in both stylesheets since V6b-3) styles both. The picture is the editor-only signed URL (`useMediaRefPreview`); the Canvas simulates the device, so the **phone picture is chosen from the `viewport` prop**, not a media query against the host window. It is painted only when the resolver says the picture is **proven** (same rule as the storefront); otherwise the section keeps its legacy surface.

### 4b — The Design tab
- **Picture** joins None / Solid / Gradient for **hero and banner only** (the registry's per-kind allowance). Choosing it shows the picker; nothing is written until a picture is picked (a picture background without a picture does not exist in the contract). Removing the picture drops the background and keeps "Picture" selected.
- **Main picture** and an optional **phone picture** reuse `MediaRefField` (library picker, framing editor, per-usage readiness) with a new `decorativeOnly` mode: a background picture is decoration by contract, so the decorative toggle and alt fields are not offered.
- **Overlay:** strength select — *No overlay* + 5 … 90 % in steps of 5 (exactly the contract's enumeration) — and the overlay colour (`ColourField`: palette roles as references, or hex; default role `overlay`).
- **Live verdict**, the gate's own: *checking…* (bounds still loading), *can't be measured yet* (no valid evidence — wait or choose another), *can't be proven* with **“Add a darker overlay”** (+20 % up to 90 %), or *legible (≥ 4.5:1)*. The inspector uses `sectionContrastIssues` with the server's bounds, so it cannot disagree with publish.
- AR/EN copy for every new string (`designBgImage…`, `designOverlay…`, `designPicture…`).

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontMediaDerivativeTest` +1: default and framed usages return the **same bounds the gate computes**; framed-and-unprepared ⇒ `null` (no generation); after `ensure` ⇒ the derivative's own bounds; nulled evidence ⇒ `null`; no raw evidence in any response |
| Hook | `use-background-media-bounds` 5: collects visible pictures only, one read per usage, `unavailable` on no-evidence/network error, polls a processing usage until its bounds arrive, idle for documents without pictures |
| Canvas | `StorefrontPreviewCanvas.background` 5: paints once proven (tokens, overlay vars, decorative first-child backdrop, signed URL), nothing when unproven or when the range cannot be cleared, phone picture in the mobile viewport vs default in desktop, no network for a hero without a picture |
| Inspector | `DesignInspector.picture` 10: Picture offered to hero/banner only; pick flow writes a decorative reference; no alt/decorative UI; phone picture optional and removable; remove keeps Picture selected; overlay steps (0, 5 … 90) + colour default; the four verdict states; "darker overlay" raises 40 → 60; a strong overlay makes a wide range provable; switching away leaves Picture |
| Suites | web vitest **3970 ✔** (440 files; builder 1118) · storefront vitest 1533 ✔ · tsc + biome clean · full PHP — see PR |

## Design Quality Pass
Unit-level coverage of every state above (loading / measuring / no evidence / unprovable / proven; empty / picked; phone present / absent; overlay none / each step) in EN. The control reuses the existing inspector vocabulary (Segmented, Field, ColourField, MediaRefField) and logical (RTL-safe) layout, so AR mirrors with the rest of the tab. **Not claimed here:** pixel evidence of the new inspector rows and of the Canvas painting a real photo at 390/430/768/1024/1280/1440 in AR and EN — that is V6b-5's Chromium suite on real uploads (this slice's merchant-visible surface is exercised there end to end together with publish and the storefront).

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation / RBAC | The bounds ride the existing `commerce.manage` derivative routes; asset and usage are tenant-scoped (unknown/foreign ⇒ the same 404 as before) |
| Draft vs Published | Editor reads evidence for the draft's own references; publishing is still gated server-side by the same service |
| Security | Only validated enumerations/colours are written; no URL/CSS enters the document; preview URLs are signed, short-lived and never stored |
| Backward compatibility | `contrast` is an additive response field; `Picture` is an additive control; documents without picture backgrounds are unchanged and fetch nothing |
| Accessibility | native controls, labelled; verdict is `role=status`/`alert`; picture is decorative and `aria-hidden` on canvas |
| Commerce / accounting | Untouched |

## Limitations / next
- **V6b-5** — the real-pixel Chromium proof on real uploaded photos: publish → storefront vs Canvas parity, six widths, AR/EN, contrast sampled from rendered pixels, derivative-cropped frames, evidence-missing and overlay-rescue flows.
- A picture's *own* focal point applies to the default picture only (CSS `object-position` is per `<img>`); phone framing is a crop on the phone `MediaRef`.
- The Canvas swaps to the phone picture only in its simulated mobile viewport (tablet uses the default; the storefront's break is `max-width: 767px`).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
