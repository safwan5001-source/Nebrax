# CUST-HV V9c-2 — Custom Content blocks in the Canvas and the editor — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9c-2** — second and last V9c slice (V9c-1 model + storefront ✔ → **V9c-2 Canvas + editor**). V9d cards / rails and V9e product zoom follow. |
| **Branch** | `cust-hv/v9c2-content-editor` (stacked on V9c-1 until it merges) |
| **Authority** | V0 §15 (shared block vocabulary, D-21) · §6 (the Canvas shows what will be published) · §3.4 (one place per setting) · §7.10 (media field) |
| **Scope** | Merchant app only. **No PHP, storefront behaviour, endpoint, schema or Publish-rule change**; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Canvas markup | `CanvasContentBlocks` uses the storefront's classes and decisions (h2 / h3, logical alignment, line breaks, spacer heights, callout accent + tone label, button looks) for any section that uses a kind beyond headings and paragraphs; a text-only section keeps its original preview (accordion mirror included). | The same split the storefront makes (V9c-1), so the preview never promises a disclosure the storefront would not draw. |
| Columns in the Canvas | The count comes from the **simulated device** (`data-vp`: one on phones, two from tablet) in a Canvas-only block placed before the V5c parity marker — not from a media query against the host window. | Same decision as the gallery (V8f); the parity-tested shared block is untouched. |
| Editor shape | A list of blocks (select, move, duplicate, delete) with the selected block's fields below it; a `columns` row shows its two columns as nested lists with their own add menu (≤ 4, no nested columns). Add = an accessible `<select>` of the allowed kinds. | One compact control, native on touch, no nested popover; same selection model as the slider / gallery (`activeSlides` map). |
| Add semantics | An image is added **through the picker** (the stored shape needs its picture); a button starts as a named draft ("Button") with no link — kept and not drawn, with a note saying why; every other kind starts empty. | The editor can only produce what the normaliser keeps (a wholly empty button would vanish). |
| Typing in heading / paragraph | The draft is normalised on every keystroke and the stored form of these two kinds is trimmed (V9c-1, legacy rule), which would swallow every space typed at the end of a word. The two fields therefore keep what the merchant typed and adopt the draft only when it changed from elsewhere (`BufferedText`). Covered by a test that simulates the real normalising draft. | Real typing must work with the contract's canonical form. |
| Accessible names | The new segmented controls sit in `role="group"` + `aria-labelledby`, not inside a `<label>` (a label's text becomes the accessible name of its first button). The shared `Segmented` gains `aria-pressed`. | Found by the unit tests: the first segment was named after the whole field. |
| Where things live | Level and alignment on the block; callout icon from the shared registry; image through the full `MediaRefField` (per-locale alt, decorative, framing, fit). | One place per setting (§3.4). |

## What was built

- `content-blocks-edit.ts` — the pure edits (add / remove / move / duplicate with fresh ids for a columns block's children / every field setter); every result is asserted stable under the normaliser.
- `ContentBlocksFields.tsx` (editor), `CanvasContentBlocks.tsx` (Canvas), the Canvas-only column / selection block in `store-preview.css`, the `customContent` branches of `ControlPanels` / `StorefrontPreviewCanvas` (the old `CustomFields` is gone), `cb*` strings in Arabic and English.
- The text-only Canvas preview now shows heading level, alignment and paragraph line breaks as the storefront does.

## Backward compatibility

A section of only headings and paragraphs previews and edits as before (plus the level / alignment / line-break fields). Blocks of any other kind that arrived through the API are no longer hidden by the editor (V9c-1 kept them untouched; V9c-2 lists and edits them). The twin-identity of `content-blocks.ts` is test-enforced.

## Tests

- `content-blocks-edit.test.ts` (13), `ContentBlocksFields.test.tsx` (12: add menu per kind, picker, spaces survive the normalising draft, canonical writes, button draft note, image / callout fields, reorder / duplicate / delete naming, per-column limits and no nested columns, twelve-block limit, Arabic copy), `CanvasContentBlocks.test.tsx` (7).
- Whole web suite 4 860+ tests, drift ratchet clean.

## Design Quality Pass

`e2e/cust-hv-v9c2-content-blocks.spec.ts` — the real builder (demo mode), AR RTL × EN LTR × 390 / 768 / 1024 / 1280 / 1440 (**10 / 10**): Library → heading (level 3, centred; the Canvas shows an `h3` with `text-align: center`) → paragraph (line break kept) → picture through the picker (the section switches to the general preview) + caption → button (not drawn until it has a link; the note disappears with the link) → success callout with an icon → two columns with a block in each (**one computed column on phones, two otherwise, the first on the inline-start side in both directions**, stacked below tablet) → the ringed selection is the block just added, inside the second column → reorder / duplicate / delete → no added horizontal overflow and every control inside the viewport.

## Limitations (stated)

- No drag-to-reorder (labelled buttons, keyboard and touch operable); no button colour / `soft` (gate first, V9c-1); one image per picker visit.
- Moving a block between lists (top level ⇄ a column) is not offered — delete and add (or duplicate) instead.
- Benefits and some older fields still trim as typed (their own slice); only the new editor buffers.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, revision concurrency, media ownership: **untouched** — the editor writes the Draft through the existing `updateDraft`, picks media through the existing workspace-scoped picker, and the Canvas reads only the signed read-only previews it already reads. No arbitrary CSS / JS / HTML. Commerce firewall: nothing here touches price, offer, stock or tax. No journal entry, no accounting behaviour.

## Review round (four findings, all real, all fixed)

| Finding | Fix |
|---|---|
| Heading / paragraph inputs kept characters beyond the stored limit (the draft truncates, the buffered field kept showing them) | `BufferedText` takes the stored limit as `maxLength` (120 / 600): the field never holds what Save would drop. Test. |
| "Sub-heading" changed only the size on the published text-only band (always `<h2>`) | The storefront's text-only path now renders `level: 3` as a real `<h3>` (default unchanged; the section still takes its name from the first heading). Test. |
| Canvas heading sizes used `md:` (host window) instead of the simulated device | Sizes are chosen from `viewport` (mobile → the base pair, otherwise the `md:` pair): no `md:` class remains. Test. |
| Round 2 — the text-only level-3 heading still used `md:` in the Canvas; `maxLength` counts UTF-16 units not code points; an image field's Remove was a silent no-op | The text-only h3 is sized from `viewport`; the buffered fields cut by **code point** (`limit`, emoji count once — tests with 130 emoji / 700 Arabic letters); the image field's Remove now deletes the block, as the list's delete does. |
| Round 3 — clearing an unlinked button's label dropped the whole block; the Canvas outline button lacked the published token marker | An emptied label of a button with no link stays in the field and is not committed (the block survives until text is typed); the Canvas outline button carries `data-slot="button" data-variant="outline"` like the published one. Tests. |
| A text-only section bypassed the selection ring / scroll | Its flat preview wraps each block in the same `Selectable` as the general path (the accordion mirror of a designed Market section remains a collapsed-cards preview). Test. |

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
