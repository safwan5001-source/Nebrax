# CUST-HV V6c-7 — Hero & Banner layout variants — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-7** — seventh and last sub-slice of V6c (… V6c-5 per-CTA style ✔ → V6c-6 per-CTA colour + `soft` + gate ✔ → **V6c-7 layout variants**). Closes the V6 "Hero & Banner" scope of the Master Horizon (per-instance, design depth, media, mobile art direction, overlay, placement, buttons, bounded overlap, scheduling, region contrast proof). |
| **Branch** | `cust-hv/v6c7-layout-variants` (from `main` after V6c-6 #1288) |
| **Authority** | V0 §3.3 (`layout?: string  // variant key, per type`) · §3.4 (hero: `text-over-image · split · centered · minimal`; banner: `card · full-bleed · split · text-band`) · §8.3 |
| **Scope** | One additive optional `design` field, **`layout`**, on **hero and banner only** (per-type closed lists). No migration, no API route change, no publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. |

---

## AWJ Decision recorded here (what V0 left open — not a contract change)

V0 names four variants per type but not what each one *is* when the section sits on a picture whose legibility is proven for the **whole frame**. Two rules shaped the decisions: (1) a variant may not move text onto a surface its contrast proof did not cover; (2) where an existing control already says the same thing, the variant is not duplicated.

| Variant | Meaning | Why it is safe / what it is not |
|---|---|---|
| hero **default** (`text-over-image`) | absence of the field | unchanged — never stored |
| hero **`centered`** | content box and text centred; the button row follows | purely geometric; the text stays on the same backdrop |
| hero **`minimal`** | headline and buttons only, compact (subheadline hidden, shorter, tighter) | purely geometric; the picture/backdrop is untouched, so the proven text colours still match it |
| hero **`split`** | from md: the text column is the inline-start half, the **overlay covers only that half**, the other half's picture is bare | the text stays on the picture **under the same overlay**; the region it sits on is a *subset* of the proven whole-frame range, so the proof still covers it. Needs a proven picture (it narrows *that picture's* overlay) |
| banner **default** (`card`) | absence of the field | unchanged |
| banner **`split`** | from md: its own picture fills the inline-end half edge to edge, the copy the other half | the banner's picture is *content*, not a backdrop; text stays on the card surface |
| banner **`text-band`** | a slim band without the picture; from md the copy and the buttons share one row | text stays on the card surface |
| banner `full-bleed` | **not a layout** | `design.width.mode = full` (V5) already says it; a second way to say it would be a second source of truth |

**Precedence:** a layout is a *preset*. The layout rules sit before the designed inner spacing, the 3×3 content position and the height preset in the stylesheet, so anything the merchant sets explicitly still wins. The `split` variants are ≥ md (768 px) effects: the stylesheet repeats the check for the real storefront, and the resolver (which the Canvas feeds with the simulated device width) emits no token for a simulated phone.

## What was built

| Layer | Change |
|---|---|
| **Contract (PHP authority + 2 TS twins, byte-identical)** | `layout` after `valign` (V0 §3.3 order), per-type closed lists; capability value = the list. Anything else (the other type's variant, a default name such as `text-over-image`, wrong case, non-string, any other section type) is dropped on its own. Shared fixture `section-design.json`: capability registry + 14 new cases read by PHP, web and storefront. |
| **Resolver (twins, byte-identical)** | tokens `lctr`, `lmin`, `lsplit` (hero; needs `mediaProven` and width ≥ 768), `lband`, `lbsplit` (banner; width ≥ 768). |
| **Stylesheet (storefront `globals.css` + Canvas `store-preview.css`, parity-tested)** | one block of presets inside the section-design block, before the spacing/position/height rules. |
| **Merchant UI** | `DesignInspector`: one "Layout" select, listing exactly the type's own variants (Automatic + variants); a hero's *Split* without a proven picture says why it does nothing. AR + EN copy. |
| **Canvas** | same tokens and rules; the phone frame shows no `split`. |

## Backward compatibility
Absent `layout` ⇒ identical normalised output, identical resolved attributes and tokens, no new CSS rule matches (each keys on a token that exists only when set). Renderers needed no change: the hooks are the existing section markup (`data-section-content`, its children).

## Design Quality Pass — real Chromium, the published hero (production `HeroSection`) and banner (`BannerBand`)

hero × {default surface, proven picture} × {default, centered, minimal, split} + banner × {picture + copy, copy only, picture only, explicit inner spacing `none`} × {default, split, text-band} (the banner kinds also include *title + subtitle with no button* and *a single button*) + a picture hero with an explicit inline position (`align` centre / end) × {default, split} × 2 directions = **60 pages**, each at 6 real device viewports (390×844 · 430×932 · 768×1024 · 1024×768 · 1280×800 · 1440×900):

| | |
|---|---|
| Checks | **360** page×viewport · **312** pixel checks |
| Violations | **0** |
| Asserted | **centered**: content box centred (±2 px), `text-align: center`, button row centred in its box · **minimal**: subheadline not displayed, hero shorter than the default · **hero split (≥ 768)**: the overlay is exactly half the section and on the **inline-start** edge (the right edge under RTL), the text column and every button stay inside that half, the other half's picture is **brighter** (bare); on a phone the overlay stays full width · **banner split (≥ 768)**: the picture is half the card, on the inline-end edge, fills the card height, the copy stays in the other half; stacked exactly as the default on a phone · **text-band**: the picture is hidden, the band is slimmer than the card, from md the buttons share the row with the copy and sit at the inline end · tap heights · no horizontal overflow · **contrast on the real pixels:** for every picture-hero layout × viewport × direction, the heading's colour is measured against the pixels that really sit behind it (text and borders hidden, the background photographed) — ≥ 4.5:1 |
| **Negative control** | the five layout rule sets stripped from the stylesheet: **272 violations** — the measurement can fail |

Evidence: `docs/plans/store/cust-hv-v6c7/layout-proof-summary.json` and screenshots (hero split LTR 1280 and RTL 1024; banner split RTL 1024; banner text-band LTR 1280 and RTL 390; hero centred 390; hero minimal 1280). Tooling is env-gated and inert in CI: `storefront/src/components/home/__tests__/layout-proof.render.test.tsx` (`LAYOUT_PROOF_DIR`) + `storefront/scripts/layout-proof/measure.mjs`.

## Review findings resolved (Codex) — all six real

| Finding | Verdict | Fix |
|---|---|---|
| The banner `split` copy rule was not gated on a picture (the grid rule was): a banner with no `imageUrl` kept its flex layout but gained a second `1.5rem 2rem` of nested padding | **Real** (reproduced: padding `24px 32px` vs `0px`) | the copy rule is scoped to the same `:has(> img)` condition |
| `text-band` hid the picture of a **picture-only** banner — its only content — leaving an empty bordered band (the emptiness check counts the picture as content) | **Real** (reproduced: the picture's display was `none`) | the picture is hidden only when the copy box holds visible copy (a non-`sr-only` heading, a subtitle or a button); a picture-only banner keeps its picture |
| With `layout: split` + an explicit `spacing.inner`, the later inner-spacing rules moved the spacing to the section root and cleared the content box, but the split's fixed copy padding stayed: `none` could not remove it and every step was added on top | **Real** (reproduced: padding `24px 32px` left under `inner: none`) | an explicit inner spacing replaces the preset's copy padding (`padding: 0`); only a small gutter (`column-gap: 1rem`) stays between the two halves, which adjacency requires |

| *(round 2)* The Canvas draws a lone banner button as a `<span>`, so the `text-band` rule's copy predicate (`a`, `div`, …) missed it and the preview kept the picture while the storefront hid it | **Real** (preview ↔ storefront disagreement) | the predicate also matches `[data-cta-style]`, which both the published anchor and the Canvas span carry; a Canvas test pins the marker on the lone span, a stylesheet test pins the selector |
| *(round 2)* A `text-band` banner with a title and subtitle but **no** button auto-placed the `<p>` in the second grid column, beside the heading, squeezing it | **Real** (reproduced: subtitle not under the heading, not in its column) | `h2` and `p` are explicitly placed in column 1; the second column is reserved for the actions. Proof kinds *no button* and *single button* added |

| *(round 3, P1 — contrast safety)* With a picture hero on `split`, an explicit `align: center` / `end` (the 3×3 grid's inline half) moved the copy out of the inline-start half, while the overlay stays confined to that half: the copy could land on the **bare** picture, which the contrast proof (computed under the overlay) never covered | **Real and important** (reproduced: 30 violations — the text column and buttons crossing the middle) | at ≥ md the split hero's content box ignores the inline position (`margin-inline: 0 auto`, `inline-size: auto`, a higher-specificity rule than the `balign` rules): the text column stays in the overlaid half whatever `align` says, so the proof still covers it. The inline half of the 3×3 grid is documented as not applying to a split hero at ≥ md (the block half, `valign`, still does). Proof kinds *picture + align centre / end* added |

The browser proof gained the banner kinds above; against the pre-fix stylesheets it reports violations in exactly those categories (a copy-only banner gaining padding · a picture-only banner losing its picture · inner spacing `none` leaving padding / no gutter · the subtitle beside the heading) and 0 with the fixes. The stylesheet tests pin the three selectors in both runtimes.

**Visual finding fixed during the pass:** the first text-band left the buttons hugging the title instead of at the band's end (the copy box did not grow). It now fills the band and pushes the buttons to the inline end; the proof asserts it.

## Tests

| Suite | Result |
|---|---|
| `section-design.json` fixture (PHP · web · storefront) | identical output incl. key order; capability registry equal (per-type lists); 14 new cases (each variant kept, other type's variant dropped, defaults/unknown/wrong-case/non-string dropped, four other types drop `layout`, canonical order) |
| Resolver twins | tokens per variant and type; `split` gated by proven picture and width (767 none, 768 yes); other types emit nothing; the stylesheet carries a rule per token and the overlay is narrowed on the split hero only |
| CSS parity (storefront ↔ Canvas) | the section-design block is the same rule set |
| `DesignInspector` | each type lists exactly its own variants; Default removes the field; no control for other types; the inactive note for an unprovable hero split; AR/EN copy |
| Canvas | always-on variants carry the storefront's token in every device frame; banner split absent on the phone frame; hero split with no proven picture emits nothing |
| Storefront full | 1699 passed (+7 env-gated skipped) · `tsc` (tests included) and biome clean |
| Web `store-experience-builder` + commerce/appearance + `src/lib` | 1846 passed (no `tsc` error in the touched modules) |
| Full `php artisan test` | 5868 passed, 58 skipped, **28 failed — exactly the known container-only set** (26 `Fuel*` needing bcmath, `ResendMailTransportTest`, `UserInvitationTest`); CI runs them with the extensions |

## Limitations (stated)
- A split hero's **inline** position is the layout's: the 3×3 grid's inline half (`align`) is ignored at ≥ md while `split` is active (the block half, `valign`, and every phone width keep working).
- `layout` for the other section types arrives with their slices (V8 slider/gallery, V9 cards/categories/benefits/app promo): they drop it fail-closed until then (test-pinned).
- The hero `split` is a text-column + bare-picture arrangement on **one** picture; a second, separate side image is not part of the contract.
- A banner `text-band` hides the banner's picture rather than moving it; choosing it is the merchant's statement that this band is text.

## Invariants
Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the field rides the existing presentation document and its three normalizers; no endpoint, gate or persistence change. No arbitrary CSS/JS/HTML: enumerated tokens only. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
