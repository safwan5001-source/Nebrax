# CUST-HV V6c-3 — Hero / Banner content position (3×3) and height presets — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-3** — third sub-slice of V6c (V6c-1 window ✔ → V6c-2 CTA model ✔ → **V6c-3 placement grid + height presets** → V6c-4 hero overlap + banner layout variants) |
| **Branch** | `cust-hv/v6c3-banner-placement` (from `main` after V6c-2 #1283) |
| **Authority** | V0 §8.3 ("content width & position (3×3 logical grid) … height preset (`compact\|standard\|tall\|screen`) with bounded min/max") · §3.3 (`align`, `mediaTreatment.height`) · §3.4 (capability registry) |
| **Scope** | Two additive optional `design` fields on **hero and banner only**: `valign` and `mediaTreatment.height`. No migration, no API route change, no publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

---

## AWJ Decision recorded here (a detail V0 left open — not a contract change)

V0 §8.3 lists a **3×3 logical content-position grid** as a Hero/Banner capability and §3.3 already holds its **inline half** — `design.align` (`start|center|end`, "content block alignment"; independent of `text.align`, the copy), which hero and banner already render. It names no field for the **block half**. This slice adds exactly that, as the minimal additive field **`design.valign?: 'start'|'center'|'end'`** (block-axis; `start` = top, `end` = bottom). The grid is the pair (`align`, `valign`); nothing in §3.3 changes meaning, no frozen decision is altered, and the fixture, capability registry and three normalizers carry it in lock-step. `mediaTreatment` was already specified in §3.3 and reserved for V6; only its `height` member enters now (`aspect` / `fit` stay dropped until V8, test-pinned).

## What was built

| Layer | Change |
|---|---|
| **Contract (PHP authority + 2 TS twins, byte-identical)** | `valign` (after `align`) and `mediaTreatment {height}` (after `separator`, before `motion`) on `hero` and `banner` only; anything else — an unknown value, a CSS length such as `600px`, `top` instead of `start`, a non-object `mediaTreatment`, `aspect` / `fit`, any other section type — is dropped on its own. Shared fixture `section-design.json`: capability registry + **27 new cases** read by PHP, web and storefront. |
| **Resolver (twins, byte-identical)** | `valign` → `--sec-vj` (`flex-start`/`center`/`flex-end`), `data-sd` token `valign`. `height` → `--sec-minh` = `10rem` · `18rem` · `28rem` · `clamp(24rem, 100svh, 56rem)`, token `hgt`. Validated tokens only; no raw CSS. `DesignContext.screenHeightPx` (optional): the **Canvas** passes its simulated device's height (844 / 1024 / 800) so "Screen height" there means the previewed device, not the editor window; absent ⇒ the real `100svh`. |
| **Stylesheet (storefront `globals.css` + Canvas `store-preview.css`, parity-tested)** | A preset is a **minimum** (`min-block-size`, content is never clipped) that **replaces** the section's own default minimum. The section root becomes a column flex box so the marked content box sits at the top / middle / bottom; with a height but no explicit position the content stays where the section always put it — **vertically centred for a hero, at the top for a banner** (type-specific fallback; a review finding, see below). Backdrop and overlay are absolutely positioned and take no part in the flow. |
| **Merchant UI** | `PlacementGrid`: one 3×3 control (nine real buttons, `aria-pressed`, accessible names such as "top Start", 44 px targets on phones / 36 px on desktop, the first column is the reading-start side so it mirrors under RTL) that writes **both halves in one commit**; "Default" clears both. It replaces the three-way "Content position" control for hero/banner only — other types keep it. Section height is a select (Default / Compact / Standard / Tall / Screen height), with a hint that explains presets are minimums. AR + EN copy. |
| **Canvas** | Same frame, same tokens, same stylesheet rules (the Canvas hero/banner roots and content boxes have the identical structure the rules address — tested). |

## Backward compatibility
Absent `valign` / `mediaTreatment` ⇒ identical normalised output, identical resolved attributes and tokens, no new CSS rule matches (each keys on a token that exists only when set). A pre-V6c-3 document with `align` alone still renders as before. Hero default heights (11 / 16 / 18 rem) are untouched until a preset is chosen.

## Design Quality Pass — real Chromium, the published hero (production `HeroSection`) and banner (`BannerBand`)

2 types × 5 heights (none + 4 presets) × 4 positions (automatic, top-start, middle-centre, bottom-end) × 2 directions = **80 pages**, each at 6 real device viewports (390×844 · 430×932 · 768×1024 · 1024×768 · 1280×800 · 1440×900):

| | |
|---|---|
| Checks | **480** page×viewport · **664** placement checks · **304** exact-preset checks |
| Violations | **0** |
| Asserted | no horizontal overflow · content never clipped · section ≥ its preset (`screen` = clamp(24rem, viewport height, 56rem) at each device) and, where the preset exceeds the content, **exactly** the preset (so it is the preset, not the content, that sets the height) · content box on the chosen block edge/centre · on the chosen inline edge/centre, **logically** (`start` = the right edge under RTL) whenever the box is narrower than the section · automatic position keeps today's layout once a height is set (hero centred, **banner at the top**) |
| **Negative control** | the same 80 pages with the two new stylesheet rules removed: **320 violations** — the measurement can fail |

Evidence: `docs/plans/store/cust-hv-v6c3/placement-proof-summary.json` and six screenshots (hero tall bottom-end RTL at 390 and 1280; banner screen top-start LTR 1280; banner tall middle-centre RTL 390; hero compact and standard). Tooling is env-gated and inert in CI: `storefront/src/components/home/__tests__/placement-proof.render.test.tsx` (`PLACEMENT_PROOF_DIR`) + `storefront/scripts/placement-proof/measure.mjs`.

Legibility over a picture background needs nothing new: the V6b proof is whole-frame and position-independent, so moving the text inside the section cannot move it onto an unproven region (stated in V6b-5, unchanged).

## Tests

| Suite | Result |
|---|---|
| `section-design.json` fixture (PHP · web · storefront) | identical output including key order; capability registry equal; 27 new cases |
| Resolver twins | tokens/attributes per value; presets are bounded; `screen` follows `screenHeightPx` only when given; other types resolve to nothing; absent ⇒ unchanged; the stylesheet rules exist |
| CSS parity (storefront ↔ Canvas) | the section-design block is the same rule set |
| `DesignInspector` | 9 cells for hero/banner and none for others; a cell writes both halves; accessible names; Default clears both and disables; height select options and removal; AR/EN copy |
| Canvas | frame attrs/tokens equal the storefront's for hero and banner; `screen` follows the simulated device; no design ⇒ no frame |
| Storefront full | 1615 passed (+3 env-gated skipped) · `tsc` (tests included) and biome clean |
| Web `store-experience-builder` + commerce/appearance + `src/lib` | 1744 passed |
| Full `php artisan test` | see PR |

## Review findings resolved (Codex)

| Finding | Verdict | Fix |
|---|---|---|
| A banner with a height preset but no `valign` was vertically centred, although banners have always started at the top — so "Automatic" did not preserve a banner's layout | **Real** (my fallback was a single `center` for both types, contradicting the "Automatic keeps today's layout" claim) | Type-specific fallback in the stylesheet (both sheets, parity-tested): `center` for a hero, `flex-start` for a banner, keyed on the frame's existing `data-design-type`. The browser proof now asserts it (automatic banner within 2 px of the top; 664 placement checks, 0 violations; negative control still 320). |
| The placement grid sat inside the shared `Field`, which renders a `<label>`: a click on its caption or hint was forwarded to the first cell (top-start) and the group had invalid labelling | **Real** | `PlacementGrid` is a `fieldset` with a `legend` (the media focal grid's pattern); a test asserts it is a named group, outside any `<label>`, and that clicking the caption or hint selects nothing. |

## Limitations (stated)
- `screen` follows the **small** viewport (`svh`), so it never jumps with the mobile URL bar; an engine without `svh` ignores the preset and the section keeps its content height.
- Presets are minimums by design; a section whose content is taller than the preset is simply taller.
- `mediaTreatment.aspect` / `fit` (V8) and the Hero `overlap` / layout variants (V6c-4) are not here.

## Invariants
Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the fields ride the existing presentation document and its three normalizers; no endpoint, gate or persistence change. No arbitrary CSS/JS/HTML: enumerated tokens only. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
