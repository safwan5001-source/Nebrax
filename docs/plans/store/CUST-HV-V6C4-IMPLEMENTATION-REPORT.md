# CUST-HV V6c-4 — Hero overlap preset — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-4** — fourth sub-slice of V6c (V6c-1 window ✔ → V6c-2 CTA model ✔ → V6c-3 placement + height ✔ → **V6c-4 hero overlap**). Banner/hero layout variants and per-CTA style are tracked as the next V6 sub-slices. |
| **Branch** | `cust-hv/v6c4-overlap-variants` (from `main` after V6c-3 #1284) |
| **Authority** | V0 §6.5 / D-13 ("Hero overlap: preset-only `none\|sm\|md`, ≥ md only, disabled when the hero is not a proven picture hero, never clips content or focus rings") · §3.3 / §3.4 (capability registry) |
| **Scope** | One additive optional `design` field on **hero only**: `overlap`. No migration, no API route change, no publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

## What was built

| Layer | Change |
|---|---|
| **Contract (PHP authority + 2 TS twins, byte-identical)** | `overlap` (`sm` \| `md`; `none` is the absence of the field and is never stored) after `separator`, before `mediaTreatment`, on `hero` only. Unknown values, CSS lengths (`3rem`), and any other section type (banner included) are dropped on their own. Shared fixture `section-design.json`: capability registry + new cases read by PHP, web and storefront; the legacy case that pinned `overlap` as "not accepted yet" was re-scoped to `layout` / `mediaTreatment.aspect`. |
| **Resolver (twins, byte-identical)** | `--sec-ovlp` = `2rem` / `4rem` and the `ovlp` token — emitted **only** for a hero that paints a proven picture (the same `mediaProven` test the picture backdrop uses), with **no bottom separator**, and (Canvas) a simulated width ≥ 768. `DesignContext.simulatedWidthPx` is optional: absent ⇒ the stylesheet's media query alone decides (the published storefront). |
| **Stylesheet (storefront `globals.css` + Canvas `store-preview.css`, parity-tested)** | Inside `@media (min-width: 48rem)`: the hero frame gets `margin-block-end: -overlap`; the hero root reserves `padding-block-end: spacing + overlap` (so no content or focus ring can sit under the sheet); with a height preset its minimum grows by the overlap (the preset stays the hero's **visible** height — found by the browser proof, see below); the next element becomes an opaque sheet (`position: relative; z-index: 2`, page colour + the store radius on its top corners via a zero-specificity `:where()` that yields to any surface the next section paints itself). Canvas adds wrapper-aware rules (each Canvas section sits in a selection wrapper) before the shared block. |
| **Merchant UI** | `DesignInspector`: hero-only "Overlap" select (Default / Small / Medium) with a hint; when a value is set but the resolver would not apply it (no proven picture, or a bottom separator) a status line says so — the merchant is never left guessing why nothing moved. AR + EN copy. |
| **Canvas** | Same frame, tokens and rules; the phone frame is told its width (`simulatedWidthPx` 390 / 768 / 1280) so a simulated phone shows no overlap, matching the storefront. |

## Backward compatibility
Absent `overlap` ⇒ identical normalised output, identical resolved attributes and tokens; every new rule keys on the `ovlp` token that exists only when set. Hero heights, separators, placement and every other section are untouched.

## Design Quality Pass — real Chromium, the published hero (production `HeroSection` + picture backdrop + design frame) followed by a second section

3 kinds (**picture** hero · picture hero with a **bottom separator** · hero with **no picture to prove**) × 2 heights (none, tall) × 3 presets (none, sm, md) × 2 directions = **36 pages**, each at 6 real device viewports (390×844 · 430×932 · 768×1024 · 1024×768 · 1280×800 · 1440×900):

| | |
|---|---|
| Checks | **216** page×viewport · **32** active-overlap checks · **184** must-not-overlap checks · **216** hit-test sweeps |
| Violations | **0** |
| Asserted | below 768 px, without a proven picture, or with a bottom separator: the next section never overlaps the hero · at ≥ 768 px with a proven picture: the sheet's top sits **exactly** the preset (2 rem / 4 rem) above the hero's bottom edge (±1 px) · the hero's **visible** height equals the same hero without overlap (a height preset is not eaten) · no heading, copy line or CTA of the hero reaches the sheet · a point inside the overlap strip hits the sheet, not the picture (it is above and opaque) · every focusable element on the page, scrolled into view, is hit-testable at its own centre (nothing is covered) · no horizontal overflow |
| **Negative control** | the same pages with the `ovlp` rules stripped from the stylesheet: **64 violations** — the measurement can fail |

**Defect found by the proof and fixed in this slice:** with a height preset (e.g. *Tall*) the overlap initially ate into it — the hero's visible height was 448 − 64 = 384 px. The hero's minimum now grows by the overlap, so the preset stays the visible height (asserted per viewport; a stylesheet test pins the rule).

Evidence: `docs/plans/store/cust-hv-v6c4/overlap-proof-summary.json` and four screenshots (hero + medium overlap at 1280 LTR; small overlap at 768 LTR; tall hero + medium overlap RTL at 1280 and 390 — the phone shows the normal stacked layout). Tooling is env-gated and inert in CI: `storefront/src/components/home/__tests__/overlap-proof.render.test.tsx` (`OVERLAP_PROOF_DIR`) + `storefront/scripts/overlap-proof/measure.mjs`.

## Tests

| Suite | Result |
|---|---|
| `section-design.json` fixture (PHP · web · storefront) | identical output incl. key order; capability registry equal (hero only); new cases for kept/dropped values, canonical order, banner + 8 other types dropping it |
| Resolver twins | tokens per preset; disabled for non-media / unprovable / no-evidence / bottom separator / simulated phone (767 none, 768 yes); banner never; stylesheet rules incl. the preset-minimum rule |
| CSS parity (storefront ↔ Canvas) | the section-design block is the same rule set |
| `DesignInspector` | hero-only select; options; writes and removes the field; inactive status for the two disabling situations; AR/EN copy |
| Canvas | no overlap marker without a proven picture in any device frame |
| Storefront full | 1637 passed (+4 env-gated skipped) · `tsc` (tests included) and biome clean |
| Web `store-experience-builder` + commerce/appearance + `src/lib` | 1772 passed |
| Full `php artisan test` | 5844 passed, 58 skipped, **28 failed — exactly the known container-only set** (26 `Fuel*` needing bcmath, `ResendMailTransportTest`, `UserInvitationTest`); CI runs them with the extensions |

## Limitations (stated)
- Overlap needs a **proven** picture hero: a hero on a solid colour/gradient, or a picture the publish gate could not prove, does not overlap (the control says why).
- The sheet takes the page colour unless the next section paints its own surface; a section that is itself transparent over a patterned page would still be given an opaque page-colour surface (by design — legibility over the picture is non-negotiable).
- Hero layout variants (`text-over-image | split | centered | minimal`), banner variants and per-CTA style/colour/icon are not in this slice.

## Invariants
Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the field rides the existing presentation document and its three normalizers; no endpoint, gate or persistence change. No arbitrary CSS/JS/HTML: enumerated tokens only. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
