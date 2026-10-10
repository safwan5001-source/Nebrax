# CUST-HV V6c-6 — Per-CTA button colour and `soft` style (Hero & Banner) behind a region-contrast gate — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6c-6** — sixth sub-slice of V6c (… V6c-5 per-CTA style ✔ → **V6c-6 per-CTA colour + `soft` + the gate** → layout variants) |
| **Branch** | `cust-hv/v6c6-cta-colour` (from `main` after V6c-5 #1286) |
| **Authority** | V0 §6.1 ("a per-CTA override limited to `style` and `colour` … label contrast follows §4.5") · §8.2 (`Cta`) · §4.5 (region contrast) |
| **Scope** | Two additive optional keys on each CTA of a Hero or Banner: **`colour`** (`brand` \| `accent` \| `text`) and the fourth style **`soft`**. A new publish gate (`CtaColourContrast`, PHP authority + TS twin + shared fixture). No migration, no API route change, `PRESENTATION_CONFIG_VERSION` stays 3. No accounting / commerce effect. `icon` is still not accepted (deferred to the icon registry slice). |

---

## AWJ Decision recorded here (what V0 left open — not a contract change)

V0 §6.1 freezes that a CTA's `colour` may be overridden and that its label contrast follows §4.5; it does not say *which backdrop* a button on a Hero/Banner section is judged against, nor which styles need a proof. Following the precedent of the global buttons (V5e-2b, `ButtonTokensContrast`):

| Style | Label | Judged? |
|---|---|---|
| `solid`, `soft` | computed over the button's **own opaque fill** (`labelOver`: the preferred colour when it clears 4.5:1, else the proven white/black) | **No — correct by construction.** `soft`'s fill is an opaque light tint of the role colour, so the label does not depend on the backdrop. |
| `outline`, `link` | the role colour itself, directly on what the section draws behind the button | **Yes** — the colour must clear 4.5:1 against the **whole luminance interval** of that backdrop. |

**The backdrop** is exactly what the section really draws: the design background (solid; gradient — judged across the whole gradient, not its ends; picture — the proven encoded-channel bounds under its overlay) or, with no design background, the hero's brand gradient (primary 700 → 600 → 500) / the banner's own surface (white, and the palette surface when set). Unproven = non-compliant. A hidden section, an incomplete draft (it is not drawn), a button without a `colour` (it follows the section's own colours, which the section already proves), and `solid`/`soft` are never judged. The default style is decided by the position among the **drawn** buttons (the renderers' own rule), so a draft before a real button does not change what the real one is.

## What was built

| Layer | Change |
|---|---|
| **Contract (PHP authority + 2 TS twins)** | `Cta.colour?: 'brand'\|'accent'\|'text'`; `style` gains `soft`; canonical order `label, href, style, colour`; anything else (wrong case, non-string, a hex, `icon`) is dropped on its own and the button stays; a colour/style alone is not a button. Shared fixtures `banner-ctas.json` / `hero-content.json` extended. |
| **Gate (PHP + TS twin + fixture `cta-colour.json`, 24 cases)** | `CtaColourContrast::errors` is added to `StorefrontPresentationPublishValidator::errors` (422 at `homepage.sections[i].content.ctas[j].colour`, `contrast_insufficient` / `contrast_unprovable`); the TS twin `ctaColourIssues` (byte-identical in web and storefront, test-enforced) gives the editor the same verdict live. Ratios agree to 1e-4. |
| **Published renderers** | `HeroSection` / `BannerBand` paint a coloured button from three **validated custom properties** (`--cta-fill`, `--cta-label`, `--cta-border`: hex values computed from the palette role by `buttonColours`, never from the document) through Tailwind arbitrary-value classes. A coloured banner button is an *outline variant* for the global button tokens (size, corner, weight follow the store; its fill and colour stay its own). The section-design **link rule** now steps aside for `[data-cta-colour]` (found by the browser proof, below). |
| **Canvas** | The same paint, attributes and looks in the editor preview. |
| **Merchant UI** | Per CTA slot: **Style** (now with *Soft*) and **Button colour** (Automatic / Brand / Accent / Text), disabled while the slot is empty; choosing *Soft* without a colour picks Brand (never a silent no-op); a live warning on the exact button when the gate would reject it ("pick another colour, or Filled/Soft"). AR + EN copy. |

## Backward compatibility
Absent `colour` ⇒ identical normalised output and identical rendering (the paint code is not reached; `soft` without a colour keeps the section's primary look). A pre-V6c-6 document, and an older reader that ignores the keys, shows the positional look. The gate only reads buttons that carry a `colour`, so no existing document can start failing to publish.

## Design Quality Pass — real Chromium, the published hero (production `HeroSection`) and banner (`BannerBand`)

2 types × 3 surfaces (**default** · **solid design background** · **proven picture background**) × 4 styles × 3 colours × 2 directions, plus the banner under the **global button tokens** (size *lg*, radius *pill*, style *outline*) = **180 pages**, each at 6 real device viewports (390×844 · 430×932 · 768×1024 · 1024×768 · 1280×800 · 1440×900):

| | |
|---|---|
| Checks | **1080** page×viewport · **2160** buttons · **2160** exact-paint checks · **1560** pixel checks |
| Violations | **0** |
| Asserted | every button's computed fill / label / border **equals** the paint the renderer should produce for its role colour — also under the global tokens, which must not recolour it · `solid`/`soft`: the label clears 4.5:1 over the button's own fill (measured on the rendered pixels) · **gate soundness against the real pixels:** for every `outline`/`link` the gate **passed**, the button's text and border are hidden, the pixels that really sit behind it are photographed, and the worst measured contrast against them is ≥ 4.5 · tap heights (hero 36 px / 44 px from md, banner 40 px) · underline on `link`, 2 px border on `outline` · no overflow, no overlap, never outside the section |
| **Negative control** | the gate blinded (it passes everything): **600 violations** — pixels behind coloured outline/link buttons fail 4.5:1 where the gate would have rejected them. The measurement can fail. |

**Defect found by the proof and fixed in this slice:** inside a designed section (`data-sd~="link"`), the section's own *link colour* rule (`a:not(…)`) outranked the coloured button's label (the banner on a picture rendered white instead of the chosen colour — 1800 violations on the first run). The rule now excludes `[data-cta-colour]`, in both stylesheets (parity-tested). A second measurement fix: the own-fill sample was taken in the rounded corner of a pill button (the backdrop, not the fill) — now taken mid-height.

The gate is deliberately **conservative**: it judges a colour against the whole interval of the backdrop (a gradient's worst point, a picture's proven bounds), so it can reject a colour that would happen to fit where the button sits (of the 54 coloured outline/link pages in LTR, the gate passed 24 and rejected 30). Soundness (never pass what the pixels reject) is what is asserted; the rejections are counted, not asserted.

Evidence: `docs/plans/store/cust-hv-v6c6/cta-colour-proof-summary.json` and four screenshots (hero link on a picture · banner outline under pill tokens · banner soft on a dark surface RTL 390 · hero outline on a light surface 768). Tooling is env-gated and inert in CI: `storefront/src/components/home/__tests__/cta-colour-proof.render.test.tsx` (`CTA_COLOUR_PROOF_DIR`) + `storefront/scripts/cta-colour-proof/measure.mjs`. The V6c-4 (overlap) and V6c-5 (style) proofs were re-run on this branch: 0 violations.

## Tests

| Suite | Result |
|---|---|
| `cta-colour.json` (PHP · web · storefront) | 24 cases, same verdict and ratio (1e-4) in all three runtimes: default brand gradient, custom-accent pass, solid/soft never judged, effective style by drawn position, uncoloured buttons never judged, incomplete drafts, solid/gradient/picture backdrops (gradient judged across its whole range), unprovable picture, banner surface + dark palette surface, other types ignored |
| `banner-ctas.json` / `hero-content.json` | `colour` kept after `style`; each role accepted; wrong-case/non-string/unknown dropped; style/colour alone is not a button; `icon` still dropped |
| `CtaColourContrastTest` (PHP) | exact error path/code at publish; passing/uncoloured/solid/soft block nothing; a hidden section never blocks |
| `HeroSection`, published banner | colour → validated custom properties (role → hex), label computed over the fill, no paint without a palette context, coloured = outline variant for the tokens, soft = opaque tint, link = no fill/border, drawn-position default |
| `ControlPanels` | colour select; Automatic removes the key; Soft defaults the colour; live advisory only for rejected outline/link; AR/EN copy |
| Canvas | the same paint and attributes as the storefront |
| Twin parity | `cta-colour.ts` byte-identical (web ↔ storefront); the section-design CSS block still the same rule set |
| Storefront full | 1679 passed (+6 env-gated skipped) · `tsc` (tests included) and biome clean |
| Web `store-experience-builder` + commerce/appearance + `src/lib` | 1820 passed (no `tsc` error in the touched modules) |
| Full `php artisan test` | 5868 passed, 58 skipped, **28 failed — exactly the known container-only set** (26 `Fuel*` needing bcmath, `ResendMailTransportTest`, `UserInvitationTest`); CI runs them with the extensions |

## Limitations (stated)
- `icon` (and a curated icon registry) is not in this slice. `soft`, `colour` and the gate apply to **Hero and Banner only**; the slider, announcement and header actions (V0 §6.1's other hosts) adopt the same model in their own slices.
- The gate is conservative (whole-interval); a colour rejected where the button happens to sit on a favourable area is still rejected — the merchant picks another colour or Filled/Soft.
- The editor's advisory reads the picture's proven bounds as they load, so on a picture background it may briefly say "cannot be proven" before the evidence arrives.

## Invariants
Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the keys ride the existing presentation document and its three normalizers; the only server change is one additional pure check inside the existing publish validation (422 shape unchanged). No arbitrary CSS/JS/HTML: enumerated tokens → validated hex custom properties. No financial behaviour ⇒ no journal entries.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
