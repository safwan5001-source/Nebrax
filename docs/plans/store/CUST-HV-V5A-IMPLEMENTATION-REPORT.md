# CUST-HV V5a — Contrast engine (proved on real pixels) & palette contract — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5a** — first slice of V5 (V5 is split like V2/V4; see *V5 plan*) |
| **Branch** | `cust-hv/v5a-design-contract` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `367aee3e` — `origin/main` after V4b (#1265) merged |
| **Authority** | V0 §3.2.1, §4.1, §4.5, §19.0 (AMEND-20 — contrast algorithm *selected and proved in V5/V6*), §4.4 (gradients) |
| **Depends on** | V0 only |

V5a ships **no merchant-visible change and nothing a renderer consumes yet**. It delivers the two things every later V5–V9 slice stands on and that V0 explicitly assigned to V5 to *prove*: the contrast-validation algorithm, and the palette contract.

---

## V5 plan (dependency-safe sub-slices)

| Slice | Scope |
|---|---|
| **V5a** *(this)* | contrast engine ×3 + real-render proof · `palette` contract ×3 (+ `accentColor` role resolution) |
| V5b | `design` contract (typed groups per section type, capability registry) ×3 + `resolveSectionDesign` pure resolver |
| V5c | renderers (Canvas + storefront) apply `design`/palette; `accentColor` goes live in chrome; absent ⇒ byte-identical |
| V5d | `ColourField`, Content / Design / Layout inspector, copy/paste style, reset; **PHP publish contrast gate**; V1B co-design (768 surface, DEF-2/6/7, BL-4) |
| V5e | typography tokens, buttons, surfaces, separators, overlap presets, bounded motion |

---

## The contrast algorithm — selected and proved here (AMEND-20)

V0 froze the **invariant** (any informative text over a merchant colour, gradient, overlay, transformed media or image must meet WCAG against what is *actually rendered*; never a region average; never a gradient's two stops alone; unproven = non-compliant) and left the algorithm to this slice. Five earlier documentation passes each froze a colour-science model that the next pass found wrong — so this slice's gate is **tests against real rendered output**, not prose.

`ContrastEngine` (PHP authority) + `contrast-engine.ts` (web and storefront, byte-identical):

1. **Encoded-space model.** Browsers composite and interpolate on gamma-*encoded* channels; the engine does the same. (A linear-light blend of 40 %-white-over-black predicts ≈ 9:1 for black text; Chromium draws ≈ 3.66:1 — asserted.)
2. **Overlay over gradient = gradient between the two composited ends** (both operations are linear in encoded space), so overlays are exact, not approximated.
3. **Direction is ignored.** The text position inside a section is unknown, so the *whole* range is checked. Horizontal and diagonal gradients are both proved.
4. **Dense sampling + a proven bound.** WCAG luminance is nonlinear in the encoded channels, so ends are not enough. The engine samples the interpolation (1 024 points) and widens the luminance range by a *proof*, not a guess: luminance is Lipschitz with `K = Σ wᵢ·slope(cᵢ)·|Δᵢ|` (the local slope of the sRGB EOTF is increasing, so its value at the range's upper end bounds the range); any point is ≤ δt/2 from a sample, so it deviates ≤ `K·δt/2`.
5. **Measured browser error.** Chromium's drawn gradient deviates up to **0.99 of an 8-bit level** from the ideal interpolation (measured, not assumed — see *Findings*), so the rounding allowance is one full level × the local slope.
6. **Image regions** are fed as per-channel encoded **min/max over the pixels actually rendered** (V6 supplies them from the transform-specific derivative). Luminance is monotone per channel, so the interval is strict — never an average.
7. **Worst ratio over `[Lmin, Lmax]`** against the foreground luminance: if the foreground's luminance lies *inside* the range, the background crosses it ⇒ worst ratio is exactly 1 ⇒ fail. Only an *established* ratio passes (`passes()`); an invalid colour is 1:1.

Automatic foreground (white or pure black, whichever is provably better) exists for every opaque background at ≥ 4.5:1, so — as V0 §4.5.1 promised — no background colour is ever rejected (tested on 500 random colours).

### Proof (all executable)

| Claim | Evidence |
|---|---|
| **Never overstates compliance** vs the real range | 400 random gradients ± overlays (TS) and 150 (PHP) against a 4 096-point brute force of the real interpolation: overstatement ≤ 1e-9 |
| **Not uselessly pessimistic** | in the decision range (2:1–8:1) the engine is ≤ 7 % below the truth, *including* the one-level browser allowance |
| **Gradient-interior counter-example** (`#d1456a`→`#1e8b9a`, black text) | both stops pass (4.77 / 5.21), real interior ≈ 4.09, engine 3.98 ⇒ **fails**; an endpoints-only check would have passed it |
| **Overlay counter-example** (40 % white over black, black text) | Chromium draws ≈ 3.66:1; engine 3.60 (conservative); linear-light model would say ≈ 9 |
| **Image-like region** | half-near-black / half-near-white: an *average* check sees a healthy mid-tone ratio ≈ 2.1, the light half makes white text 1.18:1; extremes say so |
| **Real Chromium pixels** | `web/e2e/cust-hv-v5a-contrast-render-proof.spec.ts` — 17 cases (7 gradient/overlay specs × horizontal and diagonal, + 3 named proofs): Chromium paints each to a screenshot, **every pixel's luminance is measured**, and the engine's range contains the drawn range, its worst ratio ≤ the measured worst, and verdicts agree wherever the real result is clearly on one side |
| **Three implementations agree** | one fixture `tests/Fixtures/presentation/contrast.json` (13 cases) generated by the PHP authority, asserted by PHP and both TS twins |

### Findings during the proof (kept, not hidden)

1. **Half a level was not enough.** The first run of the real-pixel proof caught the drawn luminance falling 0.0001–0.0002 *below* the engine's range (a diagonal counter-example and a dark pair). A direct measurement showed Chromium's gradient deviating up to 0.99 level from the ideal interpolation. The allowance was raised to one level × local slope, fixture regenerated, proof re-run green. This is exactly the failure mode AMEND-20 predicted for paper-only models.
2. **A test premise of mine was wrong, not the engine:** a half-dark/half-light patch has mean luminance ≈ 0.46 (ratio ≈ 2.07 with white), not "≈ 2.5"; the assertion now states what matters (average ≫ worst).

---

## Palette contract — V0 §4.1

`primaryColor` stays the **brand** value and `accentColor` the **accent** value (existing keys, no dual source of truth). The additive optional `palette` object holds the other seven roles: `surface · surfaceAlt · text · heading · link · border · overlay`.

- Lenient + deterministic (PHP authority `normalizePalette` + `palette.ts` twins, pinned by `tests/Fixtures/presentation/palette.json`, 11 cases): each role is kept or dropped on its own; **hex only**, lower-cased (one canonical form), fixed role order; CSS strings/functions/`url(...)`, non-strings, unknown roles and `brand`/`accent` keys never survive. Absent ⇒ the key is not emitted.
- `PRESENTATION_CONFIG_VERSION` stays **3**; a document without `palette` normalises **byte-identically** (asserted in PHP and both TS apps).
- `resolvePalette` returns `null` for a role the merchant did not set — meaning "keep today's fixed token". That is what makes *absent palette ⇒ unchanged* a property of the resolver, not a hope; and it keeps legacy `accentColor: null` documents rendering unchanged. `suggestAccent(brand)` is an editor-only swatch suggestion (never stored, never rendered unless chosen).

---

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC | No route, model, query or migration. Pure functions + one additive optional key. |
| Draft vs Published / concurrency | Untouched. |
| Media ownership | Untouched (the engine *accepts* region bounds; V6 supplies them from tenant-scoped derivatives). |
| Commerce / accounting | Untouched. No journal entries. |
| Backward compatibility | `palette` additive/optional; version stays 3; absent ⇒ byte-identical; nothing consumes it yet. |
| Accessibility | The engine is the accessibility proof for V5d's publish gate: unproven = non-compliant. |

## Verification

| Gate | Result |
|---|---|
| PHP | `ContrastEngineTest` **6** (696 assertions) · `StorefrontPresentationPaletteTest` **3** · related presentation suites ✓ |
| Web | `contrast-engine.test.ts` **21** · `palette.test.ts` **18** · full vitest **424 files / 3647 ✓** |
| Storefront | same two suites (**21 + 18**) · full vitest **140 files / 1235 ✓** · `tsc` ✓ · `biome lint` ✓ |
| Real-render proof | `cust-hv-v5a-contrast-render-proof.spec.ts` **17/17** on Chromium (local Implementation Evidence Gate, as in V3/V4b; not wired into CI) |
| Full backend (sqlite, local) | 5746 passed · 57 skipped · **28 failed — all environment-only and identical to `main`** (`ext-bcmath` Fuel* suites; mail views) · PostgreSQL by CI |

## Risks / deferred

- **Inert by design.** No renderer reads `palette` and no publish path calls the engine until V5c/V5d; that is deliberate so each slice stays reviewable and reversible.
- **Image regions need V6's evidence.** The engine consumes `channelBoundsInterval(min,max)`; computing those bounds from the *transform-specific rendered* pixels (and the reserved `region_luminance` derivative column — shape owned by V5/V6) is V6's job. Until then an image-backed section cannot be proved, i.e. is treated as non-compliant at the gate — the V0 fail-closed rule.
- **Conservatism is intentional**: the proven slack makes the engine ≤ 7 % pessimistic in the 2:1–8:1 decision band; a colour pair within ≈ 7 % of the 4.5:1 line may be reported as failing although it would pass. The merchant is offered the automatic foreground, which always passes.
- **Large-text threshold (3:1)** is exposed (`TEXT_LARGE`) but each *use* of it (≥ 24 px / ≥ 18.66 px bold) is decided by the section contract in V5b/V5d.

## Next dependency-safe slice

**V5b** — the `design` contract (typed groups per section type, capability registry, `resolveSectionDesign`) ×3 with fixtures; absent `design` ⇒ unchanged.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
