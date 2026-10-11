# CUST-HV V8f — Gallery in the Canvas, the gallery editor and the Library flip — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V8f** — last of the V8 gallery slices (V8d model ✔ #1310 → V8e storefront ✔ #1311 → **V8f Canvas + editor + Library flip**). With it V8 (Slider / Gallery) is complete; the V8 "motion tokens / reduced motion" items of the roadmap were delivered with the slider (V8b) and the gallery's own reduced-motion rules (V8e). |
| **Branch** | `cust-hv/v8f-gallery-editor` (from `main` after V8e) |
| **Authority** | V0 §13.2 (Gallery, D-24) · §6 (the Canvas shows what will be published — one stylesheet block) · §3.4 (`layout` is a design variant) · §7.10 (media field) |
| **Scope** | Merchant app only. **No PHP, storefront behaviour, endpoint, schema or Publish-rule change**; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Canvas markup | `CanvasGallery` renders the **same `data-gallery` DOM** the storefront draws, so the one stylesheet block (parity-tested, mirrored into `store-preview.css` in V8e) styles both. It differs only where an editor must: signed workspace preview URLs (`useMediaRefPreview`), no viewer / no links (a click selects the section), and an incomplete gallery shows a dashed card saying what it needs. | One decision, two callers (§3.5). |
| Visible columns | The shared block picks the column count with media queries against the **host window**; the Canvas carries `data-vp` and a small Canvas-only block (placed *before* the parity-tested marker, higher specificity) gives each simulated device the storefront's own count. | The Canvas resolves breakpoints from its `viewport` prop. The parity test still pins the shared block byte for byte. |
| Layout `grid | carousel` | Edited where V0 §3.4 puts it — the section **Design tab** (`layout` capability, shared inspector). For a gallery the empty choice reads "Grid" (not "Automatic"), `carousel` reads "Scrolling strip", and the hint is gallery-specific. The content tab says where it lives. | One place per setting; no second control writing `design.layout`. |
| Selection ↔ Canvas | The editor's selected picture is ringed in the Canvas and kept in view (`aria-current`, `scrollIntoView({block, inline: "nearest"})` — a strip scrolls to it, the page does not jump). Same shared `activeSlides` map as the slider (`slide or image id by section id`). | The merchant edits what they are looking at. |
| Adding a picture | **Add = pick a picture** (the stored shape requires `media`; the editor never holds a picture-less draft). | The editor can only produce what the normaliser keeps. |
| The media field | Not cover-only and not decorative-only: a gallery image keeps its **whole** `MediaRef` — alt (per locale) / decorative / framing / `fit` (V8d). | Nothing is drawn over a gallery picture; `contain` is legitimate. |
| Link | Optional per image (commit on blur through the existing field); the hint states that a linked picture always opens its link even with the viewer on (V8d / V8e rule). | The merchant is told the rule where they set it. |
| Options | Columns, picture shape (ratio), gap (six steps), captions, viewer — all through `setOptions`, which stores only non-defaults. Phones always show two columns — said in the hint. | Canonical form; honest authoring. |
| Library | `gallery`: **live and addable**, no reason, several instances allowed, duplicable. `sectionGalleryReason` removed from both locales. | Model, storefront, Canvas and editor all exist. |
| No Canvas viewer | The preview never opens the viewer. | A modal in the editor would trap the editor; the storefront proof (V8e) covers it. |

## What was built

- `CanvasGallery.tsx`, the `gallery` branch of `StorefrontPreviewCanvas`, the Canvas-only `data-vp` / selection block in `store-preview.css`, `canvasGallery*` strings.
- `gallery-edit.ts` — the pure edits (add / duplicate / move / remove, caption, link, media, options); every result is asserted stable under the normaliser.
- `GalleryFields.tsx` — picture list (select, up / down, duplicate, delete, 44 px touch targets, semantic tokens), add through the picker with the counter / minimum / maximum hints, the selected picture's media + caption (counter) + link, the display options; wiring in `ControlPanels`; the layout labels in `DesignInspector`.
- Library flip in `section-capabilities.ts`; AR / EN strings (`gallery*`).

## Backward compatibility

A document without a gallery is unchanged; existing sections' editors are untouched (`DesignInspector` only gains a label and two gallery-conditional strings). Removing the last picture stores the section with no content (an empty gallery is not stored) — it stays, showing "add at least two pictures".

## Tests

- `gallery-edit.test.ts` (8), `CanvasGallery.test.tsx` (7: the storefront's DOM, signed previews and alt naming, captions / fit / focal, ringed selection + scroll into view, nothing interactive, strip + RTL, empty state), `GalleryFields.test.tsx` (8: empty state, add through the picker, limit, reorder / duplicate / delete, the full-reference media field, caption + link, row selection, canonical options); capability and Library tests record *live / addable*.

## Design Quality Pass

`e2e/cust-hv-v8f-gallery-editor.spec.ts` — the real builder (demo mode), AR RTL × EN LTR × 390 / 1024 / 1280 / 1440: Library offers Gallery enabled → three pictures through the picker → the Canvas holds one gallery with three pictures (grid by default) → the last added is ringed → a caption appears in the Canvas only once captions are on → selecting a row moves the ring → columns and shape reach the Canvas → reorder / duplicate / delete follow → the Design tab's layout select (first option "Grid") turns the Canvas into a strip → no added horizontal overflow and every control inside the viewport.

## Limitations (stated)

- The Canvas strip scrolls natively but has no previous / next buttons (they are the storefront's post-hydration enhancement); the preview never opens the viewer.
- One picture is added per picker visit (multi-select add is a media-picker feature, not part of this slice).
- No drag-to-reorder (labelled buttons, keyboard and touch operable).
- The Canvas's picture alt is a neutral "Picture n" (the real, per-locale alt is the merchant's, judged at Publish).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, revision concurrency, media ownership, Publish safety: **untouched** — the editor writes the Draft through the existing `updateDraft`, picks media through the existing workspace-scoped picker, and the Canvas reads only the signed read-only previews it already reads. No arbitrary CSS / JS / HTML: closed-list attributes and validated numbers; links pass the existing content-href sanitiser at normalisation. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
