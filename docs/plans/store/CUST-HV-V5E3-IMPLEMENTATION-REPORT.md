# CUST-HV V5e-3 — Section-edge separators and the one-time reveal — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5e-3** — closes V5e (V5e-1 section typography ✓ → V5e-2 global tokens / buttons / fonts ✓ → **V5e-3 separators + reveal**) |
| **Branch** | `cust-hv/v5e3-separators-reveal` (on main after V5e-2c) |
| **Authority** | V0 §3.3 (`separator`, `motion`), §3.4 (per-type registry), §6.4 (separators), §6.6 (motion: one-time subtle reveal, never on LCP / above-the-fold, reduced motion ⇒ static), §2.2 (additive, three normalizers) |
| **Depends on** | V5b (contract) · V5c (frame/resolver/stylesheet) · V5d (inspector) · V5e-2a (`--gt-*`/`data-gt`, reduced-motion discipline) |

**Overlap presets are not in this slice, on purpose.** V0 §6.5 makes the overlap hero-only and "disabled automatically when the first section is not a media hero"; the media hero is V6, and the master horizon lists "bounded overlap" under V6. Shipping the preset before the media hero would ship a setting that can never apply — it follows V6.

---

## Implemented

### Contract (PHP authority + both TS twins, shared fixture now 41 cases)
- `separator`: `{ top?, bottom?, color?, height? }` — kind ∈ none·line·band·wave·angle·curve, colour a role-or-hex `ColorRef`, height sm·md·lg. Offered on **every** designable type (V0 §3.4).
- `motion`: `{ reveal: none | fade-up }` — **hero and banner only** (V0 §3.4); arbitrary durations / keyframes are dropped.
- Invalid values drop on their own, canonical order, absent ⇒ no key; version stays 3. `overlap`, `layout`, `mediaTreatment` remain dropped (V6/V8). The registry snapshot in the fixture is regenerated from the PHP authority and asserted by all three runtimes.

### Resolver — one pure function, no CSS from the document
A separator is a **background layer of the frame**, built in the resolver from validated tokens and a validated hex:
- **line / band** — a one-colour `linear-gradient` strip on the edge (line 1 · 2 · 4 px; band 0.5 · 1 · 1.5 rem; default colours: the border role / the brand);
- **wave / angle / curve** — an inline SVG data URI (`preserveAspectRatio='none'`, 1.5 · 2.5 · 4 rem; default fill: the page behind, `#f8f9fa`), a top edge is the bottom shape flipped, and **RTL mirrors the shape horizontally**;
- the edge's height is **reserved as extra padding** (`--sec-sept` / `--sec-sepb`, added to the designed spacing), so no content can ever reach into a separator;
- with a background the layers are prepended to `--sec-bg` (one `background` value); without one they are the whole background (`--sec-sep`);
- a **full-bleed band skips separators** (it extends past the container, like it skips radius and shadow — the inspector says so).

### Stylesheet (twin blocks, parity-tested)
Three small rules: the separator-only background, and the two `calc()` paddings. Nothing clips the frame (no `overflow`, no `clip-path`), so focus rings at the content edge stay whole — asserted.

### One-time reveal — safe by construction
`SectionReveal` (a client component that renders nothing) is mounted by `published-nodes` **only when a visible section opted in**. Once mounted it:
- leaves **every section already in the viewport untouched** — nothing above the fold, including the LCP content, is ever hidden or delayed;
- marks only sections that start **below the fold** `data-reveal="wait"` and reveals each **once** (`"in"`, a 360 ms opacity + 12 px transition — within V0's ≤ 400 ms), then stops observing;
- does nothing under `prefers-reduced-motion: reduce` or without `IntersectionObserver`, and before JavaScript runs every section is simply visible (no-JS safe). The stylesheet also forces visibility under reduced motion.
The Canvas shows the final state (the editor must never hide content); the motion plays on the published page.

### Merchant UI
Design tab → **Section edge separator** (top / bottom kind, colour with an "as the page" automatic value, height) and **Reveal on scroll** (hero / banner): selects of named steps with a default, AR/EN, a note explaining the reveal never affects the top of the page and stops for reduced motion.

---

## Proof

| Gate | Result |
|---|---|
| PHP | `StorefrontSectionDesignNormalizer` fixture (41 cases incl. every field, canonical order, none kept, per-type allowance, CSS never survives, only the named reveal) + registry snapshot |
| Twins | fixture ×2 · resolver (`section-separators.test.ts`, 10: none/line/band/shape, default colours, top flip, RTL mirror, both edges, layered over solid and gradient backgrounds, bleed skips, **only encoded data URIs and plain colours reach the CSS**) · `SectionReveal` (6: nothing above the fold, once-only, reduced motion, no observer, cleanup) · observer mounted only when opted in |
| Real browser — **compiled storefront CSS**, driven by the real resolver (`cust-hv-v5e3-separators.spec.ts`, 7) | the shape paints on the frame and anchors on the right edge · the reserved padding keeps the content ≥ the separator's height clear · layers above a designed background · RTL mirror + top flip in the painted SVG · no clip on the frame · absent ⇒ nothing · reveal: visible with no attribute, hidden only while waiting, transitions once (≤ 400 ms), reduced motion never hides. **Mutation-checked:** with the CSS removed 4 of 7 fail (the other three assert absence / a layer the background already carries) |
| Real browser — **Canvas** (`cust-hv-v5c-design-render-proof.spec.ts`, 13: AR/EN × 390–1440) | separators on the banner (angle), benefits (curve + band) and delivery promise (line + wave) paint a background layer, the frame never clips, **no text node reaches into a reserved band**, and every existing contrast / overflow / root-surface assertion still holds. The contrast walker now ignores partial-size edge layers (they are decoration the content never overlaps) |
| UI | `DesignInspector` +5 (every designable type offers the separator; only hero/banner the reveal; kinds write enumerated values; colour and height appear once an edge is set; clearing both removes the group; the bleed note; reveal default removes the group) |

## Design Quality Pass
Evidence `docs/plans/store/cust-hv-v5e3/` (Canvas, EN 1280 and AR 390): the banner's angled lower edge, the benefits section's page-coloured curve above and brand band below, the delivery strip's yellow wave over a navy section. Checked: shapes read as part of their section, headings keep their start edge in RTL, the shape flips correctly at the top, nothing overlaps content, no overflow at any of the six widths. Decorative separators are not text and carry no accessibility name (they are CSS backgrounds, not elements).

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation / RBAC / Draft-Published / revision concurrency | Untouched — validated additive groups inside the existing `section.design` |
| Backward compatibility | Absent `separator` / `motion` ⇒ no token, no variable, no layer, no observer; version stays 3; PHP accepts the groups before any UI writes them |
| Accessibility | Separators are never focusable or covering (padding-reserved background layers, no clip); the reveal never hides above-the-fold content, is off under reduced motion and without JS |
| Performance | No JS unless a section opts in; one tiny observer; shapes are tiny data URIs; no LCP-element animation by construction |
| Commerce / accounting | Untouched |

## Limitations / next
- **Overlap presets** follow V6 with the media hero (see above).
- A separator's shape colour is a single colour per section (both edges); per-edge colours would need a contract change and no demand is evidenced.
- A full-bleed band carries no separator (its geometry extends past the container); a bleeding shape edge would need the pseudo-element band to carry the shape — deferred unless asked.
- The reveal runs once per page view; there is no replay on navigation back (a fresh page view re-evaluates).
- **V6 — Hero & Banner** is next (media backgrounds with region-luminance contrast evidence, per-instance hero, mobile art direction, overlay, content placement, buttons, overlap).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
