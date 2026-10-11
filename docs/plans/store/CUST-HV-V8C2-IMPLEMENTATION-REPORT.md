# CUST-HV V8c-2 — Slider editor and Library flip — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8c-2** — second of the two V8c parts (V8a model ✔ #1303 → V8b storefront ✔ #1306 → V8c-1 Canvas parity ✔ #1307 → **V8c-2 editor + Library flip**) → V8d gallery. |
| **Branch** | `cust-hv/v8c2-slider-editor` (from `main` after #1307) |
| **Authority** | V0 §13.1 (Slider, D-16) · §4.5 (provable contrast) · §7.10 (media field) · §3.2.1 (the editor's verdict uses the gate's numbers) |
| **Scope** | Merchant app + the byte-identical slider twin (one added pure function). **No PHP, no endpoint, no schema, no Publish-rule change**; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| How a slide is born | **Add = pick a picture.** A slide's stored shape requires its picture (a slide without a usable `media` drops at normalisation), so the editor never holds a picture-less draft: "Add a slide" opens the media picker and creates the slide from the chosen asset, then selects it. | The editor can only produce what the normaliser keeps; no hidden repair. |
| Where edits are expressed | **Pure edits in `slider-edit.ts`** (`addSlide`, `duplicateSlide`, `moveSlide`, `removeSlide`, `setSlide*`, `setBehaviour`). Every output is asserted `normalizeSliderContent(x) == x`. | One place owns the invariants (≤ 8, unique ids, no empty strings, non-default behaviour only). |
| Per-slide verdict | New **`slideContrastIssues(slide, ctx)`** in the twin (`slider-content.ts`, both apps): the gate's judgement of ONE slide, independent of the slide count. `sliderPublishIssues` now composes it, so the editor and Publish cannot disagree. | `sliderPublishIssues` short-circuits below two slides; the editor must still say what is wrong with slide 1 while the merchant builds. |
| Text colour | Automatic by default ("contrast proven"); an explicit colour that fails is flagged with the same copy as other sections. A picture that cannot be proven shows the shared status line with a one-tap **"Add a darker overlay"**. | Same affordances as the section-background picture (V6b), one mental model. |
| Slide pictures | Main picture: alt text kept (a slide picture can be meaningful), framing editor offers **cover only** (new `coverOnly` prop on `MediaRefField`, defaulting to `decorativeOnly`). Phone picture: decorative-only (shares the main picture's alt). | Mirrors the V8a storage contract (`fit` dropped, mobile decorative). |
| Canvas ↔ panel | The slide on show is **one value** (`activeSlides[sectionId]`, held by `ExperienceBuilder`): choosing a row shows it in the Canvas; browsing with the Canvas's arrows/dots selects it in the panel. | The merchant edits what they are looking at. |
| Alignment | `start` is stored as absence (it is the default), so equivalent documents match literally. | Same rule as behaviour. |
| Library | `slider`: **live, addable**, no reason; several allowed (`maxInstances: null`), duplicable. `sectionSliderReason` removed from both locales. | The model, storefront, Canvas and editor all exist. |
| Button | Label + link only; always the solid primary button (V8a). Per-slide button style / colour stays deferred. | Unchanged contract. |

## What was built

- `SliderFields.tsx` — slide list (select, up / down, duplicate, delete, each a real labelled button, 44 px on touch and 32 px with a pointer), add (picker), counter and "two slides needed" hint, add disabled with a reason at eight; selected-slide editor (picture, phone picture, heading / sub with counters, button label + link, overlay strength + colour, text colour, alignment, legibility status); behaviour group (autoplay, interval only with autoplay, transition, speed only when the transition moves, arrows, dots, loop, a reduced-motion note).
- `slider-edit.ts` — the pure edits; `slideContrastIssues` (twin); `MediaRefField.coverOnly`; `DeferredCommitField` exported; wiring in `ControlPanels` / `ExperienceBuilder` / `StorefrontPreviewCanvas` / `CanvasSlider` (`onActiveSlideChange`); Library flip in `section-capabilities.ts`; AR / EN strings.

## Backward compatibility

A document without a slider is unchanged. Existing sections' editors are untouched (`DeferredCommitField` is only exported; `MediaRefField` defaults are unchanged). Removing a slider's last slide stores the section with no content (an empty slider is not stored) — it still exists, still shows "add at least two slides".

## Tests

- `slider-edit.test.ts` (10): add / limit / duplicate (independent copy) / move / remove, text truncation by code point, button rule, phone-picture contract, overlay / colour / alignment, behaviour compaction, templates — each result is also stable under the normaliser.
- `SliderFields.test.tsx` (12): empty state, add through the picker, limit, reorder / duplicate / delete, neighbour selection, picture field props, copy + button, unprovable picture (flag + status + "darker"), no-evidence, ok, behaviour, overlay.
- `slideContrastIssues` in both twins' `slider-content.test.ts` (100 each); capability and Library tests updated to *live / addable*.
- Web suite for `store-experience-builder` + `(commerce)`: 115 files / 1 958 tests passing.

## Design Quality Pass

`e2e/cust-hv-v8c2-slider-editor.spec.ts` — the real builder (demo mode), AR RTL and EN LTR × 390 / 1024 / 1280 / 1440, **8 / 8**: Library offers Slider enabled → add three slides through the picker → the Canvas holds one carousel with three slides → copy reaches the active slide, an incomplete button does not render → choosing a row shows that slide → browsing in the Canvas selects the row → reorder changes the Canvas order → duplicate and delete → dots off removes them, transition *None* reaches the Canvas → no added horizontal overflow and every control inside the viewport. Below 768 the panel is a bottom sheet over the Canvas, so the one Canvas click is dispatched to the element.

## Limitations (stated)

- Autoplay never runs in the editor (V8c-1); the Canvas does not show hover / focus pause rules.
- No per-slide button style / colour, no `layout: split`, no `mediaTreatment.aspect` / `fit` (deferred since V8a).
- A slide's real-upload → real-evidence → real-gate chain is shared with the hero background (V6b-5) and was not re-run here; the e2e mocks the evidence endpoint.
- No drag-to-reorder: reordering is by labelled buttons (keyboard and touch operable).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, revision concurrency, media ownership, Publish safety: **untouched** — the editor only writes the Draft document through the existing `updateDraft`, picks media through the existing workspace-scoped picker and reads the same read-only evidence endpoint. No arbitrary CSS / JS / HTML: every colour is a role or a validated hex, every link goes through the existing content-href sanitiser at normalisation. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
