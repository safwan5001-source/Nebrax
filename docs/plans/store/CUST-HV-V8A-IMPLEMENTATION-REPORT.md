# CUST-HV V8a — Slider: content model, behaviour and Publish rules — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8a** — first of the V8 "Slider / Gallery / Motion" slices (V8a model + gate → V8b storefront rendering + real-Chromium/RTL/reduced-motion proof → V8c Canvas parity + editor → V8d gallery model → V8e gallery rendering + lightbox → V8f gallery Canvas + editor). |
| **Branch** | `cust-hv/v8-slider-gallery` (from `main` after V7e-3 #1301) |
| **Authority** | V0 §13.1 (Slider, D-16) · §3.2 / §7 (`MediaRef`, ownership, Publish gate) · §4.5 (provable contrast) · §3.4 (capability registry) · §2.2 (additive, three normalizers in lock-step) |
| **Scope** | Data model + normalisation (PHP authority, two byte-identical TS twins, one shared fixture) and the Publish rules. **No rendering and no editor**: nothing draws a slider yet, so every existing store renders exactly as today. `PRESENTATION_CONFIG_VERSION` stays 3; no endpoint, no migration, no accounting effect. |

## Why V8 is split

A slider is four independently verifiable things — what the document may say and what Publish must prove (this slice), how it behaves and looks in a real browser with RTL swipe, `prefers-reduced-motion` and keyboard (needs the real-Chromium proof, like V7e-2), how the merchant edits it plus Canvas parity (like V7e-3), and the Gallery after it. Shipping the model first lets the contrast and ownership rules be proven in isolation against real uploads before any pixel depends on them.

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| New section type, how it is stored | `slider` joins a new `HOME_MEDIA_SECTION_KEYS` set (PHP + both TS), accepted fail-closed but **outside the default document** and **outside `HOME_DATA_SECTION_KEYS`**. | The default document must not change; the data-section set is counted by vertical setup as "data sections", which a slider is not. |
| Where behaviour lives | `content.behaviour`, beside `content.slides`; `design` keeps visual tokens only. | Autoplay / arrows / transition are behaviour, not look. |
| Slide picture | `media` keeps `alt` / `decorative` (it can be a meaningful picture) and **drops `fit`**; `mobile` is stored `decorative` with no `alt` / `fit`, sharing the slide's alt. | `contain` letterboxing would reveal a surface the picture's luminance evidence does not cover (same rule as a hero background); art direction is not a second content, so the gate must not ask for a second alt. |
| Behaviour canonical form | Only non-defaults are stored: `autoplay: true`, `interval` (5 / 8 / 10, only with autoplay; 6 is the default), `transition` (`fade` / `none`), `duration` (`fast` / `slow`), `arrows: false`, `dots: false`, `loop: true`. | Equivalent documents are literally equal; `interval` is meaningless without autoplay. D-16: autoplay off by default, interval ≥ 5 s — the closed list cannot express less. |
| Slide button | `cta = { label ≤ 80, href }` only, always drawn as the solid primary button; no per-slide `style` / `colour` yet. | A solid button's label is computed over its own fill; per-slide look overrides (V0 §6.1) are a later, separately proven slice. |
| Section design | `slider` allows `background` (solid / gradient), `width`, `spacing`, `border`, `radius`, `shadow`, `separator` and `mediaTreatment.height`. **No `text` group, no `layout`, no `motion.reveal`.** | Text colours are per slide (they sit on each picture). `layout: split` puts the copy on the section surface — its contrast proof is its own slice. The slider's motion is `behaviour.transition`; a reveal on a likely LCP element is not offered. A picture *section* background is not offered either: the pictures are the slides. |
| Draft vs Publish | The draft keeps 1–8 slides and incomplete buttons (the editor re-normalises on every keystroke); **Publish requires ≥ 2 slides** (V0: 2–8) for every visible slider. | A single slide is a hero; the draft must not lose the merchant's work. |
| What Publish proves per slide | Every visible slide that carries text (heading, sub or a complete button) proves its text colour — explicit or the automatic best of white / black — over the **range** of its own picture (default + phone) under its own overlay. Implemented by judging a pseudo-design `{ background: media + mobile + overlay, text.body }` with the existing `SectionDesignContrast::issues`. | One algorithm, not two (V0 §4.5.7: never an average or endpoints-only estimate); "unprovable = non-conforming". |
| Library | The Library lists the slider **disabled with the reason** ("the slider editor is on its way") — `state: deferred`, `merchantAddable: false` — instead of hiding it. | The registry was built for exactly this (visible, disabled, reason — never flattened to live). V8c flips it. |

## What was built

- **PHP**: `StorefrontSliderNormalizer` (authority), `SliderPublishRules` (publish rules), wiring in `StorefrontPresentationNormalizer` (`HOME_MEDIA_SECTION_KEYS`, dispatch), `StorefrontSectionDesignNormalizer` (`slider` capability; `overlay` / `backgroundRef` made reusable), `StorefrontPresentationPublishValidator`.
- **TS twins**: `slider-content.ts` (byte-identical in storefront and web; added to the twin-identity test) with `normalizeSliderContent`, `resolveSliderBehaviour`, `sliderPublishIssues`; both `section-content.ts` (dispatch, `sliderContentOf`), both `tokens.ts` / `config.ts`, `section-design.ts` (twin: `slider` capability; two helpers exported).
- **Merchant app (compile-level only)**: registry entry for `slider` (deferred), AR / EN messages.
- **Fixtures**: `tests/Fixtures/presentation/slider.json` (67 content cases — expected values computed by the PHP authority and reviewed — and 21 publish cases) and the `slider` row in `section-design.json`.

## Backward compatibility

A document without a slider is unchanged in all three normalizers (test-pinned, version stays 3); `slider` is not in the default document. Invalid or unknown input is dropped field by field; old published versions are untouched.

## Tests

- PHP `StorefrontSliderTest` (97 tests, 278 assertions): the 67 content cases (strict serialised equality, so key order is part of the contract, plus idempotence), the 21 publish cases, hidden slider never blocks, default-document and vertical-setup isolation, capability registry shape, validator integration, and **integration with real uploads and real luminance evidence** — two proven slides publish; per-locale alt required unless `decorative`, and the phone picture asks for no second alt; a full-range picture under text is unprovable until its overlay darkens it; **another tenant's picture (default or phone) is `media_missing`** (tenant-isolation test required by V0 §3.6 whenever a `MediaRef` appears).
- Storefront and web `slider-content.test.ts`: both fixtures × the normaliser / `sliderPublishIssues`, helpers, absent-⇒-unchanged; twin byte-identity extended.
- Web: the capability / Library tests record the deferred `slider` row; the 14-card picker list now has the 15th, disabled with its reason.

## Design Quality Pass

No pixel is drawn by this slice (no renderer, no editor), so there is no visual surface to evaluate; the only merchant-visible addition is the disabled Library card with its reason (AR + EN). Responsive / RTL / reduced-motion / keyboard evidence belongs to V8b and V8c.

## Limitations (stated)

- No rendering and no editor (V8b–V8c); until then a slider can only arrive through the API and is not drawn by the Canvas or the storefront.
- No per-slide button style / colour, no `layout: split`, no section `text` group, no `mediaTreatment.aspect` / `fit` (deferred, see above).
- `transition` / `duration` / `interval` are stored but have no effect until V8b.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched or strengthened** — the slider rides the existing presentation document and the existing generic `StorefrontMediaPublishGate` (it scans for any `mediaId`, so slide and phone pictures are covered with no new code path). No URLs, styles or HTML in the document: only closed lists, validated colour references, text, and links through the existing content-href sanitiser. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
