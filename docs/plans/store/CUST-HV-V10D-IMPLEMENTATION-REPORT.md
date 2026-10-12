# CUST-HV V10d — Library thumbnails, Canvas hover action bar and drag reorder — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V10d** — last V10 slice (V10a model ✔ → V10b Preview / Apply ✔ → V10c names + styles ✔ → **V10d Library thumbnails, hover action bar, drag reorder**). |
| **Branch** | `cust-hv/v10d-section-ux` (stacked on V10c until it merges) |
| **Authority** | V0 §17.2 ("reuse of Canvas hover action bar") · V10 row ("Library thumbnails, hover action bar, drag reorder") · D-19 / D-23 |
| **Scope** | Merchant app only. No PHP, storefront, endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| One source for list operations | `presentation/section-ops.ts` — pure `moveSection(To)`, `setSectionVisible`, `duplicateSection`, `deleteSection`, `sectionIsAuthored`, `canMoveSection`. The section list (ControlPanels) was refactored onto them (behaviour unchanged, all its tests green) and the Canvas bar and drag and drop use the same functions. | Three entry points must not be three implementations of "duplicate" or "delete"; the app-promo switch, the hero legacy text, the hero limit and the section cap live in one place. |
| Hover action bar | A small toolbar inside each section wrapper of the Home Canvas: **move up / down, hide, duplicate, delete**. Shown on hover, focus-within and selection (touch: on the selected section); positioned on the **inline-end** edge (left in RTL). Buttons never select the section. Delete of a section with authored content asks inline (confirm / cancel), an empty one is removed at once — the list's rule. | Reuses the existing pointer / selection model; inside the wrapper so the hero-overlap sibling rules (`.awj-preview-section + …`) stay valid. |
| Where it exists | Only while editing the Home page of a **Draft / Scheduled** Version — never on a Published Version, in Theme Preview or in the dev harness (the prop is absent). Every action is an ordinary draft edit (`updateDraft`), revision-checked at Save. | Draft vs Published invariant; a preview must not be able to edit. |
| Drag reorder | HTML5 drag and drop on the section list rows (handle hint on ≥ md), with a before / after drop indicator; **the up / down buttons remain the keyboard and touch path** (drag is an addition, never the only way). | WCAG 2.5.7 — a dragging alternative must exist. |
| Library thumbnails | `SectionThumbnails.tsx`: a layout **wireframe per section type** (72×48 SVG: hero, slider with dots, gallery grid, categories, shelves with rail peek, offers with tag corners, benefits, app promo, content lines, discovery chips, delivery band, wholesale rows…) replacing the 16 px glyphs — **slider and gallery had none**. Pure SVG, no text, no price / product / picture, token colours, mirrored in RTL. A test requires one for every `ALL_HOME_SECTION_KEYS` type, structurally distinct. | Distinguish section types at a glance without implying content the merchant does not have. |
| Not built | Canvas selection chip with the section name (the outline + list + inspector title carry it); touch long-press drag; user-saved presets (V0 §17.3 LATER). | Smallest coherent set; stated. |

## Tests

- `section-ops.test.ts` (7): move by step / to index / edges, immutability, show-hide (+ app switch), duplicate (design, suffixed name, position, new id; legacy hero text; hero and list limits), delete fallbacks, "would lose something".
- `ControlPanels.dragReorder.test.tsx` (5): drop after / before, indicator and dragging marks, self-drop and no-drag no-ops, buttons still work, the handle is decorative.
- `ExperienceBuilder.sectionActions.test.tsx` (7): labelled toolbar inside each wrapper, disabled edges, move / hide / duplicate (selected) / delete (immediate vs confirm vs cancel), clicks on the bar never select, **no bar on a Published Version or in Theme Preview**.
- `SectionThumbnails.test.tsx` (4) and the existing Library tests.
- Real Chromium (`e2e/cust-hv-v10d-section-actions.spec.ts`, 12): the bar hidden until hover, visible inside the Canvas frame on the inline-end edge (AR left / EN right), Down edits the draft (dirty); **real drag-and-drop** of a list handle reorders the list; the Library shows ≥ 10 wireframes at 390 / 1024 in AR / EN with no added overflow.

- Interplay with V10c (merged first): the shared section operations carry V10c's review fixes — `copyLabel` shortens the original name, never the suffix; a section with only a typed name counts as authored (deleting it asks). The Canvas name chip (inline-start) and this slice's action bar (inline-end) share the selected section: while the bar shows, the chip's width is capped so the two never overlap. Real Chromium (`never overlap`, 4): AR / EN at 1024 / 1280 with the builder simulating a phone and a 60-character name — fails without the cap, passes with it.

## Design Quality Pass

Screenshots from the run (`test-results/cust-hv-v10d/*.png`): bar over a new-arrivals section and over the selected benefits section in AR RTL; the Library in EN LTR with wireframes. Targets: bar buttons 28 px (compact, pointer-oriented; the 44 px list controls remain the touch path), focus ring on every button, no colour-only state (the delete is also the ✕ glyph and the confirm is text), reduced-motion unaffected (no animation added).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency (edits go through the draft + revision-checked Save), media ownership: untouched. **Commerce firewall:** structure edits only. No arbitrary CSS / JS / HTML. No journal entry.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
