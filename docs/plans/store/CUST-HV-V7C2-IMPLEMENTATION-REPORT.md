# CUST-HV V7c-2 — Header overlay-on-hero — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7c-2** — second half of V7c (V7a structure ✔ → V7b colours ✔ → V7c-1 `sticky: on-scroll-up` ✔ → **V7c-2 overlay-on-hero** → V7d navigation + icons → V7e footer). |
| **Branch** | `cust-hv/v7c2-overlay-hero` (from `main` after V7c-1 #1295) |
| **Authority** | V0 §9.1 (`mode`) · §9.3 (frozen overlay-on-hero behaviour, points 1–6) · §4.5 / §4.5.7 (provable contrast, never an estimate) · §2.2 (additive) |
| **Scope** | One enum value pair on the existing `header.design`: `mode: solid | overlay-hero`. No new key, no migration, no API / publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3, no accounting effect. |

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| `transparent` mode? | **Not accepted** (dropped fail-closed, fixture-pinned). | A transparent header is only ever safe over a backdrop the proof knows — that is exactly `overlay-hero`. A free transparent header over arbitrary page content can never be proven (§9.3.1). |
| Which hero qualifies? | The **first visible** home section, a `hero` with a **picture** background the server proved (V6b bounds + the resolver painted it), layout **not `split`**. `slider` joins in V8; a banner's picture is content on a card, not a backdrop, so banners never qualify. | A split hero covers only half of its picture (the region the proof covers is not the region the header sits on). |
| What is proven? | The better of pure white / black over the picture **after the hero's own overlay**, ≥ 4.5:1 against the **whole** picture's channel bounds (not an average, not a band estimate) — the band is a subset, so it is covered a fortiori (§4.5.7). Unprovable ⇒ the header silently stays **solid** (§9.3.1), shown to the merchant as a one-line reason; there is **no publish error**. | The decision is deterministic from the document + server evidence, so it needs no gate; a wrong overlay is impossible rather than rejected. |
| The automatic scrim (§9.3.3, ≤ 40 %)? | **Not built.** | Under this proof it is unreachable: header text and hero text are judged against the *same* interval with the same better-of-white/black rule, and a hero whose text cannot be proven paints no picture at all — so an eligible hero already passes without a wash, and one that does not pass is not eligible. A scrim becomes meaningful only with a top-band-only region proof (more permissive than the whole picture), which does not exist. Shipping it would be dead code. |
| What does "overlay" look like structurally? | The header becomes a **zero-height** sticky box whose bands paint over the hero; the hero starts at the very top, its **picture bleeds to both viewport edges** (the frame is full-bleed, the text column keeps its container alignment), its content is pushed below the bands by the header's measured height (`--hd-block`, with an over-estimating CSS fallback until the controller measures). | Zero height means no layout shift when the header turns solid, and `main` needs no knowledge of the header. |
| Transparent → solid? | Past 24 px of scroll, or immediately while the shopper works inside the header (focus within, an expanded control, an open dialog locking the page); 200 ms fade, instant under `prefers-reduced-motion`. | V0 §9.3.2. |
| No JavaScript? | Until the controller marks it live the overlay header is **not sticky** (it scrolls away with the hero), so it can never sit transparent over later content. | Progressive enhancement that cannot produce an unreadable state. |
| Other pages? | The decision lives on the Home hero's marker (`data-ho`), applied with `:has()`: any other page, an ineligible home, or an opted-out header is exactly as before. | Home only (§9.3.1) with no client round trip, no flash. |
| Interplay | With `sticky: off` the header stays relative; with `on-scroll-up` the hide slide uses the measured band height (a 0-height box cannot slide by its own height); V7b colours apply once solid (`--hd-bg`), transparent state uses the proven foreground; shadow in the solid state is a `drop-shadow` filter (a 0-height box has no box to shadow). | |

## What was built

- **Model**: PHP `StorefrontHeaderDesignNormalizer::MODES` and TS twins (byte-identical) `HEADER_MODES`, token `hmo`, `overlayIsSolid`. New twin `header-overlay.ts`: `overlayHeroCandidate`, `resolveHeaderOverlay` (the proof), `overlayMarker`. `mediaBackgroundBounds` extracted from `mediaInterval` so the proof reuses the exact union-and-overlay logic.
- **Storefront**: `publishedHeaderOverlay` (server decision incl. "the picture is really painted"), `SectionDesignFrame` `extraAttrs`, `publishedNodes` `headerOverlay`, Home page wiring, `HeaderOverlay` client controller, stylesheet block (shared chrome block + storefront-only viewport-unit bleed).
- **Canvas**: same decision from the Canvas's own proven bounds, same marker/tokens/stylesheet block, `HeaderOverlayPreview` simulator, Canvas-only bleed (container-query units: the root becomes an inline-size container only while an overlay is active). Both simulators now read the scroller that actually moved (capture-phase `watchScroll`), replacing the earlier "nearest `overflow:auto` ancestor" guess, which was wrong whenever the page itself scrolls.
- **Editor**: "Header mode" select (Default / Solid / Transparent over the home hero) with the hint and the structural reason an opted-in overlay is inactive (AR/EN).
- **Dev fixture**: `/dev/customizer-visual?scenario=overlay`.

## Backward compatibility

Additive enum; absent / `solid` ⇒ no `hmo` token, no controller, no marker, byte-identical markup (test-pinned). Every V7a/V7b/V7c-1 proof was re-run on the new stylesheet.

## Design Quality Pass — real Chromium

**Storefront** — the production `Header`, production `HeroSection` through `publishedNodes`, the production `publishedHeaderOverlay` decision and wrapper attributes, the production `HeaderOverlay` / `HeaderScrollUp` controllers (esbuild-bundled), real pictures with known pixel ranges: 18 scenarios × AR RTL / EN LTR × 6 viewports (390 / 430 / 768 / 1024 / 1280 / 1440), **4 532 checks including 120 pixel proofs, 0 violations**:

- eligible: header takes 0 px; hero flush at the top; the picture reaches **both** viewport edges; no radius on a bleeding hero; container top padding gone; heading and first button start below the bands; `--hd-block` = the bands' real height = the hero's reserved padding; transparent bands and borders; wordmark / links / icons in the proven colour; the cart pill (its own surface) untouched;
- **pixel proof**: with text, borders and own-surface elements hidden, the real pixels behind the bands clear 4.5:1 against that colour — and the negative control `ovLie` (declared bounds the picture does not honour) is **caught** by it at every viewport;
- solid after 24 px / on focus, sticky at the top; transparent again at the top; on-scroll-up leaves and returns solid; sticky-off scrolls away; V7b designed colours take over once solid; centered / two-row layouts compose;
- no JavaScript: `position: relative`, never over later content;
- ineligible (opted out, `solid`, split, plain hero, banner first, wide-range or mid-tone picture, no evidence, evidence absent): header keeps its height and opaque surface, the hero stays a contained card.

Negative control: overlay rules stripped from the stylesheet → 2 002 violations.

**Canvas** — `web/e2e/cust-hv-v7c2-canvas-overlay.spec.ts` (real Next dev server, media endpoints mocked with a proven dark picture), AR / EN × 6 widths: **12/12** — same structure, bleed to the frame's edges (including a frame wider than the container), reserved height, colours, solid/transparent on scroll.

Evidence: `docs/plans/store/cust-hv-v7c2/`.

## Tests

`header-overlay.test.ts` (candidate rules, the proof, a sweep proving every accepted outcome clears 4.5:1 over its whole bounds, markers, threshold) in both twins; PHP fixture (`mode`); `public-overlay.test.ts`; `HeaderOverlay` controller tests (live / measure / threshold / focus / aria-expanded / scroll-lock / cleanup); `Header` mounts the controller only when opted in; `published-nodes` marker tests; Canvas tests (marker, unproven ⇒ solid, split / non-first / opted-out ⇒ solid, scroll simulator, sticky off) and the editor control with its inactive reasons; stylesheet parity block (identical modulo scope) includes the overlay rules.

## Limitations (stated)

- The overlay needs a picture hero as the **first** visible section; a slider (V8) will qualify when it exists.
- A logo **image** is never recoloured: over a picture the merchant's artwork is shown as is (`logo.treatment` mono variants remain deferred).
- The editor says *why* a structurally ineligible overlay is inactive; whether the picture's legibility is provable is only visible in the Canvas (the panel has no media evidence).
- The in-page offset (`--store-header-offset`) is unchanged: on an overlay Home it over-reserves slightly, which is harmless for scroll margins.
- With `sticky: off` the V7a mobile-menu-sheet offset limitation is unchanged.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the enum rides the existing presentation document and its three normalizers; no endpoint, gate or persistence change; the server only *reads* the contrast evidence it already publishes. No arbitrary CSS/JS/HTML: enumerated tokens only. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
