# CUST-HV V8d — Gallery: content model and Publish rule — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8d** — fourth gallery-side slice of V8 (V8a slider model ✔ → V8b slider rendering ✔ → V8c slider Canvas + editor ✔ → **V8d gallery model** → V8e gallery rendering + lightbox → V8f gallery Canvas + editor). |
| **Branch** | `cust-hv/v8d-gallery-model` (from `main` after V8c-2) |
| **Authority** | V0 §13.2 (Gallery, D-24) · §3.2 / §3.2.1 / §7 (`MediaRef`, per-locale alt, ownership) · §3.4 (capability registry, `layout` variants) · §2.2 (additive, three normalizers in lock-step) |
| **Scope** | Data model + normalisation (PHP authority, two byte-identical TS twins, one shared fixture) and the Publish rule. **No rendering and no editor**: nothing draws a gallery yet, so every existing store renders exactly as today. `PRESENTATION_CONFIG_VERSION` stays 3; no endpoint, no migration, no accounting effect. |

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| Where the section type lives | `gallery` joins `HOME_MEDIA_SECTION_KEYS` (PHP + both TS) beside `slider`; accepted for storage, **outside the default document** and **outside `HOME_DATA_SECTION_KEYS`**. | The default document must not change; "data sections" are counted by vertical setup. |
| Layout `grid | carousel` | Stored where V0 §3.4 puts it: **`design.layout`**, closed list `["carousel"]`; absence = grid. Registry: `LAYOUTS.gallery` in PHP and both TS twins. | The existing per-type `layout` machinery (hero, banner) and the inspector's layout control apply with no new editor surface. |
| Options | `content.options` = `{ columns?: 2|4|6, aspect?: "4:3"|"16:9"|"4:5", gap?: "none"|"xs"|"sm"|"lg"|"xl", captions?: true, lightbox?: true }`; only non-defaults stored (defaults: 3 columns, `1:1`, gap `md`, no captions, no lightbox). | Equivalent documents are literally equal (same canonical-form rule as slider behaviour). Aspect and gap are content-level (they belong to how *these* images are shown), so the design registry gets no new group. |
| Image shape | `{ id, media: MediaRef, caption?, link? }`, ≤ 24 stored, **≥ 2 to publish** (V0: 2–24). The image keeps its **whole** `MediaRef` — alt / decorative / framing / **`fit`**. | Nothing is drawn over a gallery picture, so `contain` cannot invalidate a luminance proof (unlike a slide, V8a). Per-locale alt is the generic media gate's job (AMEND-10/14); no new path. |
| Caption | Plain text in the store's language ≤ 120 code points, kept as written; whitespace = absence. **Always kept**, drawn only when `captions` is on. | Switching the option off must not destroy the merchant's text. Same text rule as slide headings. |
| Link | Per image, through the shared content-href sanitiser (`javascript:`, `//host`, `http:` refused). **With `lightbox`, an image that has a link stays a link; the others open the viewer** (rule recorded for V8e). | One explicit rule instead of a conflict; the merchant's explicit link wins. |
| What Publish proves | Visible gallery ⇒ **≥ 2 images** (`gallery_images_min`). **No contrast verdict**: captions sit on the section surface (not over the picture) and take the existing automatic, proven foreground. | A gallery with one image is a picture; the draft must not lose work. Nothing over a picture ⇒ nothing to prove per image. |
| Section design | `gallery` allows `background` (solid / gradient), `width`, `spacing`, `layout`, `border`, `radius`, `shadow`, `separator`. **No `text`, no `mediaTreatment`, no media background.** | Captions use the automatic proven colour; the aspect is `options.aspect`; the pictures *are* the images. |
| Masonry / collage | **Not in the contract** (no key). | V0: collage later; CSS-column masonry excluded (reorders DOM vs visual order). |
| Library | Listed **disabled with its reason** ("the gallery editor is on its way") — `state: deferred`, `merchantAddable: false` — until V8f. | The registry's job: visible, disabled, explained, never hidden. |

## What was built

- **PHP**: `StorefrontGalleryNormalizer` (authority), `GalleryPublishRules`, wiring in `StorefrontPresentationNormalizer` (`HOME_MEDIA_SECTION_KEYS`, dispatch), `StorefrontSectionDesignNormalizer` (`LAYOUTS.gallery`, `gallery` capability), `StorefrontPresentationPublishValidator`.
- **TS twins**: `gallery-content.ts` (byte-identical in storefront and web; added to the twin-identity test) with `normalizeGalleryContent`, `resolveGalleryOptions`, `galleryPublishIssues`; both `section-content.ts` (dispatch, `galleryContentOf`), both `tokens.ts`, both `section-design.ts` (`LAYOUTS.gallery`, capability, `GalleryLayout`).
- **Merchant app (registry only)**: `gallery` entry (deferred), AR / EN strings, Library tests.
- **Fixtures**: `tests/Fixtures/presentation/gallery.json` (56 content cases — expected values computed by the PHP authority and reviewed line by line — and 6 publish cases) and the `gallery` row of `section-design.json`.

## Backward compatibility

A document without a gallery is unchanged in all three normalizers (test-pinned; version stays 3). Unknown / invalid input is dropped field by field; a gallery section with no content survives as a bare instance, as every other section does.

## Tests

- PHP `StorefrontGalleryTest` (70 tests, 210 assertions): the 56 content cases (strict serialised equality, so key order is part of the contract, plus idempotence), the 6 publish cases, hidden gallery never blocks, default-document / vertical-setup isolation, bare instance, design capability shape (layout list, no `text`, no media background), validator integration, and **integration with real uploads**: two images publish whatever their options; **per-locale alt required unless `decorative`**; **another tenant's picture is `media_missing`** (tenant-isolation test required by V0 §3.6 whenever a `MediaRef` appears).
- Storefront and web `gallery-content.test.ts` (67 each): both fixtures × the normaliser / `galleryPublishIssues`, helpers, closed lists, media-section placement, design layout rule; twin byte-identity extended.
- Web: capability / Library tests record the deferred `gallery` row; the picker list gains the 16th card, disabled with its reason.

## Design Quality Pass

No pixel is drawn by this slice (no renderer, no editor), so there is no visual surface to evaluate; the only merchant-visible addition is the disabled Library card with its reason (AR + EN). Responsive / RTL / keyboard / lightbox evidence belongs to V8e and V8f.

## Limitations (stated)

- No rendering and no editor (V8e–V8f); until then a gallery can only arrive through the API and is not drawn by the Canvas or the storefront.
- `options` / `layout` are stored but have no effect until V8e.
- No per-image alt override beyond the `MediaRef`'s own, no drag-reorder contract (the editor reorders by buttons, as the slider's), no masonry / collage.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched or strengthened** — the gallery rides the existing presentation document and the generic `StorefrontMediaPublishGate` (it scans for any `mediaId`, so gallery pictures are covered with no new code path). No URLs, styles or HTML in the document: only closed lists, text, and links through the existing content-href sanitiser. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
