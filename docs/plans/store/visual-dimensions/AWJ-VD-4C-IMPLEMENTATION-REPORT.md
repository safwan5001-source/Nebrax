# AWJ-VD-4C — Implementation Report (Storefront Builder controls for the discovery section)

STATUS: **PR pending**
DATE: 2026-10-15
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-4c (H1-4)
AUTHORITY: the owner authorized this slice on 2026-10-15 as **web/UI only**. No API, database, migration, permission, security or tenant-isolation change was made or is needed.

## Outcome

The Store Experience Builder's `discovery` section panel now edits **exactly the optional display keys of the VD-4a contract** and shows a **live preview** inside the controls panel.

- **Controls**: template (the 7 registry templates, Arabic/English name and a one-line description), layout (image-grid · image-cards · carousel · icon-grid · text-list, plus "legacy (tiles/chips)" = no layout), columns per device (mobile 1–4 · tablet 2–6 · desktop 2–8, each optional), rows (1–2, enabled only for a carousel), gap, text position, content order, value order, shape, size, show name, card style, alignment, show counts, max values (4–24).
- **Groups**: Layout · Look · Content · Advanced, collapsible (`aria-expanded` / `aria-controls`), each with a badge counting the settings set explicitly in it.
- **Inheritance is visible and reversible**: every control states where its effective value comes from (explicit · from template: *name* · system default · legacy look) and has a "reset to inherited" action that **deletes the key**.
- **Shape / size / name** default to "don't force". Once any of them is explicit, a warning states that it overrides the shape, size and name of **every** value in the section, including looks set on a value itself.
- **Panel preview**: renders the section from the *resolved* options through the web `FacetVisualTile` twin and the shared facet-visual resolver, for a chosen preview device (mobile / tablet / desktop), in the store's own tokens.

**Not touched:** the API, database, migrations, RBAC, the normalizers (PHP / storefront / web), `discovery-templates.ts`, the commerce firewall, the storefront renderer (VD-4b), the admin editor (VD-3), `MediaRefField.tsx`, and anything under `commerce-workspace/`.

## Contract and behavior

### Inheritance semantics (D-08 + VD-4a)

- **A key is written only when the merchant sets it.** Choosing a template writes `template` and nothing else; none of the template's layout, columns, shape … is copied (tests: every registry id writes exactly `["template"]`; explicit settings stay untouched when a template is chosen).
- **Reset deletes the key** (no placeholder, no `undefined` written). Clearing the last column device removes `columns`.
- The effective value and its source come from the same precedence as `resolveDiscoveryDisplay` — explicit → template → system default — through `discoverySource()`; a test checks it agrees with the resolver for every template key. Layout with nothing chosen anywhere reads as **legacy look**, not a system default.
- **Rows**: the control is disabled with a stated reason unless the *resolved* layout is a carousel (an explicit non-carousel layout beats a carousel template). The helper also refuses to write `rows` otherwise. A stored `rows` value survives leaving the carousel (it is inactive, the resolver ignores it) and can still be reset; the panel says so.
- **shape / size / showLabel** are not resolved here (VD-4a): non-explicit, the panel shows "not forced: each value keeps its own look" plus the fallback a value without a look of its own gets (template, then system) and its source.

### One normalizer, no new validation

Every edit goes through `normalizeOptionalSectionContent("discovery", …)` (the builder's byte-identical twin of the PHP/storefront normalizers) via `normalizeDiscoveryOptions`. So:

- keys are in the canonical contract order whatever order the merchant touched them in (test with `assertSame`-style key-order checks);
- an out-of-range integer is **clamped** (maxItems 99 → 24, columns mobile 9 → 4), a fractional/NaN/mistyped value **drops the key** — the existing clamp-or-drop rule; the panel invents no error and nothing can cause a 422;
- re-normalizing the output is a fixed point, and a stored document → options → document round trip keeps values and key order.

### Round trip and legacy documents (VD-4a behavior kept)

- A legacy document (no display settings) is emitted **byte-for-byte as before** by edits that do not touch display settings (test with key order).
- The VD-4a rename round trip still holds: settings are kept from the last real content in a ref refreshed in an effect, so an edit that briefly empties the section (facet axis with no dimension yet) does not lose them. The ref is now mirrored in state so the new controls re-render; the existing regression tests are unchanged and green. A new test edits a display setting *while the section is incomplete* (nothing is committed), then chooses the dimension and sees the setting arrive with it.

### Panel preview

- Layouts follow the VD-4b renderer rule for rule (see *Review fixes*): image grid; image cards; carousel (items sized from the widest frame, ignores `columns`, a second row on mobile only); icon grid (icon first); text list (plain names); and the legacy tiles/chips look with a line saying so.
- Columns follow the chosen preview device (mobile is the default); the frame is capped to the simulated device width so a wide panel does not stretch a mobile preview. The summary line states the columns (and rows) in effect.
- Text position (below / over image / beside), content order, card style, gap, alignment, show counts, `valueSort`, `maxItems` (bounded by a preview cap of 12) all affect what is drawn.
- **Fallback look**: the sample values deliberately include a picture that cannot be shown (falls back to the value's icon) and a value with nothing but a name (falls back to its initial), so the merchant sees the fallback, not only the happy path.
- **Values**: real facet value names and counts when the panel has loaded the chosen dimension (active values, merchant order, localized); otherwise the built-in samples (12 gift-shop occasions, one very long name). Pictures are always inline samples (the builder does not read value visuals); the caption says which of the two it is.
- **Tokens**: the frame is `.awj-store-preview` with the store's own variables (`presentationCssVars` of the document's primary / radius / accent), so the admin dark mode does not repaint it and no admin colours reach the store frame. The only wiring edit in `ControlPanels.tsx` passes those variables as `storeVars`.
- Preview only: nothing is saved, nothing is requested.

## Changed files

**New (all under `web/src/modules/store-experience-builder/`):**
- `discovery-display-edit.ts` — pure helpers: set / reset / column / template / reset-all, sources, counts, override list, all through the normalizer.
- `DiscoveryDisplayFields.tsx` — the controls (groups, inheritance badges, reset, overrides warning).
- `DiscoveryPanelPreview.tsx` — the live preview.
- `discovery-preview-model.ts` — sample data, real-value source, pure value selection.
- `discovery-display-messages.ts` — 99 keys per locale, spread into the module catalog.
- `__tests__/discovery-display-edit.test.ts` · `__tests__/DiscoveryDisplayFields.test.tsx` · `__tests__/ControlPanels.discoveryDisplay.test.tsx`
- this report

**Modified:**
- `DataSectionFields.tsx` — `DiscoveryFields` mounts the new controls; options ref mirrored in state; the private option-extraction helper moved to `discovery-display-edit.ts`.
- `ControlPanels.tsx` — wiring only: passes `storeVars` (plus two import lines).
- `messages.ts` — one import and one spread per locale, next to the existing discovery keys.

## Tests and exact results (local)

| Command | Result |
|---|---|
| `cd web && npx vitest run …/discovery-display-edit.test.ts` | **32 passed** |
| `cd web && npx vitest run …/DiscoveryDisplayFields.test.tsx` | **62 passed** (47 before the review fixes) |
| `cd web && npx vitest run …/ControlPanels.discoveryDisplay.test.tsx` | **8 passed** |
| Regression: `ControlPanels.dataSections.test.tsx`, `discovery-display.test.ts`, `facet-visual-tile.test.tsx` | **32 passed** (unchanged files) |
| `cd web && npm run test` (full) | **621 files / 6996 tests passed** (includes the drift ratchet) — re-run after the review fixes |
| `cd web && npm run build` | **Compiled successfully; 190/190 static pages** |
| `cd web && npx tsc --noEmit` | **48 errors, all pre-existing in test/e2e files; none in changed files** (an extra error in my first test draft was fixed) |

`npm run lint` is not configured. PHP and storefront suites were not run: no PHP or storefront file changed.

**What the tests pin:**
- *Helpers*: template writes only its id (all 7); canonical order; clamp-or-drop; purity (input never mutated); equality with the section normalizer; per-device column ranges; rows only for a carousel (explicit and template, explicit non-carousel layout wins, stored value survives and can be reset); sources agree with the resolver; legacy untouched; round trip is a fixed point; hostile stored values are dropped on edit.
- *Panel*: groups and badges; inherited option marked but not pressed; reset deletes the key; the five layouts plus legacy; rows disabled with a described-by reason; each control writes its key in canonical order; the warning appears for each of shape / size / label and disappears on reset; `ar`/`en` key parity, no empty strings, Arabic strings contain Arabic script; every template has a name and a one-line description in both languages; 44px target classes on every button; no fixed-palette classes or raw hex.
- *Preview*: each of the five layouts plus legacy; the device switch changes the columns; explicit shape beats the template's; fallback look (image, icon and initial all present); text list has no media; accessible names kept when the label is hidden; `maxItems`, `valueSort`, cap; long Arabic title wraps with `dir="rtl"`; real names drive the preview and the caption says so.
- *Integration through `ControlPanels`*: legacy byte-for-byte with key order; template-only emit; panel output equals the normalizer's; reset deletes; rename keeps settings; setting survives an incomplete facet axis; Arabic UI.

## Visual verification

A throwaway Next.js dev page (**not committed**, deleted before commit) mounted `DiscoveryDisplayFields` inside a replica of the builder sidebar (`[data-posture="studio"] [data-builder-controls]` with `html[data-awj-ui="3"]` and the `.dark` class, 300–366 px wide), driven by Playwright/Chromium. Screenshots were opened and read.

| Viewport (panel width) | Scenarios checked |
|---|---|
| 390 (366 px panel) | AR light: template + explicit overrides (arches, mobile 3 columns, heart, counts, loose gap), all four groups open · EN dark: carousel with rows = 2 · EN light: icon grid, editorial portrait (overlay + start alignment), text list · AR light: carousel, swipe-rail |
| 768 (744 px panel) | AR dark with a 74-character title · EN light legacy |
| 1280 (320 px panel) | AR dark legacy with groups open · AR light carousel · EN dark template list · AR dark icon grid |

Problems found and fixed from what the screenshots showed:
1. **Columns** were three side-by-side selects that truncated "Inherited (3)" to "Inherited (" in 320 px → each device is now its own row.
2. **Image cards** kept the size step's fixed width inside a wider cell → at first the media filled the card; the review pass (#4) reverted that to match VD-4b, which keeps the size step's frame, and replaced the overlay with 4b's scrim pill.
3. **Icon grid** at four columns broke words ("Graduatio/n") → tighter card padding and a 10 px label from four columns up. Two-line wrapping of a very narrow cell can still break a long English word; that is the tile's own `break-words`, which is shared with the storefront.
4. **A wide panel** stretched the mobile preview across a desktop-sized frame → the frame is capped to the simulated device width and centred.

Checked and fine: no horizontal page overflow at any size (the only wide scroll width came from the harness's own JSON debug line, confirmed by hiding it); long Arabic title wraps; RTL mirrors the controls, device switch and reset buttons; LTR in English; light and dark panel contrast (selected buttons use `primary` / `primary-foreground`, the store frame stays light by design); the dashed "inherited" marker is accompanied by the source text, never colour alone; the overrides warning in light and dark.

Not done: no real-device or screen-reader pass; keyboard operation is covered by native buttons / selects and the tests, not by a manual run.

## Self-review

**Residual risks / notes:**
- **The preview follows VD-4b but is not pixel-exact.** After the review it was aligned with 4b's actual behaviour (`DiscoveryItems.tsx`, `discovery-items.ts`, read from `origin/feat/vd-4b-storefront-visual-renderer`; see *Review fixes* #4). It still compacts fonts, gaps and the device width to fit a ~300 px panel and uses sample pictures, and it paints `--store-scrim` with 4b's value because the admin store sheet does not define it, so the caption says the published store is the reference. If 4b changes before merge, only `DiscoveryPanelPreview.tsx` / `discovery-preview-model.ts` need adjusting; no saved data is affected.
- **"Reset all" is one click and relies on the builder's undo** (review finding 9, accepted as designed): it removes the template and every explicit setting at once; the section history can restore them.
- **The preview frame is `aria-hidden`**, so a keyboard user cannot scroll the carousel rail inside it (it has no focus stop); with the preview capped at 12 values this loses nothing the controls do not already state.
- **Store locale/direction**: the builder state exposes no separate store locale or direction (the canvas itself uses the editor `locale`), so the preview frame's `dir` follows the editor language like the canvas (review finding 10).
- **Values are real names with sample looks.** The builder does not read value visuals (VD-3 adds that), so pictures and the fallback demonstration are samples; the caption states it. When VD-3 lands, the preview can take real visuals through `previewValueVisual` in one place.
- **`rows` stored while not a carousel** is kept (inactive), not deleted — deleting it silently would destroy a setting the merchant may restore. The panel shows it is inactive and offers reset.
- **Sticky preview was not added**: the panel is a long form and a sticky preview would take a third of a 700 px viewport; the preview sits above the groups instead. If feedback asks for it, it is a class change.
- **Merge surface**: `messages.ts` gets 5 lines next to the discovery keys; `ControlPanels.tsx` a 4-line wiring; `DataSectionFields.tsx` is owned by this slice. VD-3 / VD-4b areas are untouched.
- The panel's group bodies stay mounted but `hidden` when collapsed, so `aria-controls` always points at a real element.

**Decision Gate:** none. Nothing required an API, DB, permission, security or tenant change.

## Review fixes (PR #1507, independent review: no blocking findings)

Accessibility is a binding requirement of this slice, so every accessibility finding was fixed. Numbering is the reviewer's.

| # | Finding | Status | What changed / why |
|---|---|---|---|
| 1 | Focus lost to `<body>` after a per-control reset and after "Reset all" (WCAG 2.4.3) | **Fixed** | A per-control reset now moves focus to the control's first remaining button/select (else its group header) through a context-driven effect. "Reset all" is `aria-disabled` instead of `disabled`, so it keeps focus and a further press is a no-op. Tests assert `document.activeElement` is not `<body>` (template, select, enum, a control whose select is disabled, and reset-all); the per-control test was shown to fail with the refocus removed. |
| 2 | Touch targets fell below 44 px from `sm:` up | **Fixed** | Every `sm:size-9` / `sm:min-h-10` / `sm:h-10` removed in both files. The test now parses every button and select: each needs an unprefixed `size/h/min-h` of at least 11 (44 px) and **no responsive-prefixed** size class below 11; a second test pins that the guard rejects `sm:size-9` / `md:min-h-10`. |
| 3 | The shape/size/label fallback line could name the template when the dimension's default wins | **Fixed** | Dimension defaults sit above the template (§3.6). The line now reads "Unless the dimension sets its own default, a value with no look of its own gets: …" (AR + EN, `ddVisualFallback`); tests check both languages. |
| 4 | Preview did not match VD-4b | **Fixed** | Compared with 4b's code and aligned: **rows** = 2 on mobile only (summary says "two rows on mobile only" on tablet/desktop); the **carousel ignores `columns`** and sizes items from the widest frame + 24 px (min 88 px), and the columns control now says so; **icon-grid** shows the icon before the image (a value with no icon keeps its image/initial); **text-list** draws plain names (no tile, no `showLabel`, no text position); **overlay** puts the caption on the frame over the scrim pill (top with label-first), **beside** is a row (reversed with label-first); a **count** shows only beside a visible name; gaps are 4b's per device; card paddings/borders are 4b's; image cards no longer stretch the media (4b does not). Tests pin each of these. The "approximate" caption now says it follows the store's layout rules and the published store is the reference. |
| 5 | Preview exposed a fake heading and sample lists to assistive tech | **Fixed** | The frame is `aria-hidden="true"` with nothing focusable inside (the carousel's focus stop was dropped); the device switcher and the caption stay outside it. A test asserts the attribute, no focusable/role elements inside, and that no heading/list-item is exposed. |
| 6 | The dashed "inherited" marker was visual only | **Fixed** | An inherited option's accessible name is now "<label> (inherited)" / "<label> (موروث)" via `aria-label` (it still contains the visible label); a test covers EN and AR. (Visually hidden text was tried first; the accessible-name computation drops the separating space between inline children, so the name was glued: "Image grid(inherited)".) |
| 7 | Unused keys; bare `aria-label` on the badge | **Fixed** | `ddEffective` and `ddPreviewFallbackLegend` removed (the report no longer promises the legend); a test fails if any non-dynamic key is unused. The badge shows the number (`aria-hidden`) plus sr-only text "Settings set here: N". |
| 8 | "N settings override the template" counted an inactive stored `rows` | **Fixed** | The count excludes the template itself and a `rows` value the resolver ignores (non-carousel layout); tested for both layouts. |
| 9 | One-click "Reset all" | **Accepted** | By design: it relies on the builder's undo. Listed in Self-review. |
| 10 | Preview `dir` follows the admin UI language | **Accepted** | The builder state has no store locale/direction (the canvas uses the same editor `locale`); kept and documented. |

Also in this pass: the preview's scrim uses 4b's `--store-scrim` pair (`rgb(0 0 0 / 0.72)` over `rgb(255 255 255)`), defined on the preview frame because the admin store sheet does not carry it (no raw hex was added).

**Results after the fixes:** `DiscoveryDisplayFields.test.tsx` 62 passed; `discovery-display-edit.test.ts` 32; `ControlPanels.discoveryDisplay.test.tsx` 8; regression files (`ControlPanels.dataSections`, `discovery-display`, `facet-visual-tile`) 32 — all passed; full `npm run test`: 621 files / 6996 tests passed; `npm run build`: compiled, 190/190 static pages; `npx tsc --noEmit`: 48 errors, the same pre-existing test/e2e ones.

**Visual re-check** (throwaway harness again, not committed; 390 / 768 / 1280, AR RTL + EN LTR, light + dark): carousel with two mobile rows and item widths from the frame (peek of the next item, no column dependence); swipe-rail with counts; image cards with overlay captions on the scrim pill; image grid with `beside` + label-first in RTL; plain text list with counts; icon grid with icons only; and a keyboard reset (focus on the template reset button, Enter) which lands focus on the "No template" button with its focus ring visible. No horizontal overflow at any size. Looked at each screenshot; no defect found in this pass.

## Accounting impact

**None.** No financial operation, no journal entry, no money handled.

## Tenant / branch isolation, RBAC, API, DB

- No model, query, endpoint, migration, permission or middleware. No change to the commerce firewall.
- The panel still reads facets through the existing `loadFacets` client (tenant-scoped by the API as before) and writes only closed-list values, bounded integers and booleans via the normalizer; no free text was added.
- No new network request: the preview's pictures are inline data URIs.

## Backward compatibility

- Additive and optional. Untouched legacy documents are emitted byte-for-byte as before; `display` (tiles/chips) is still edited and honoured when no layout is in effect.
- The VD-4a round-trip regression tests are unchanged and pass.
- Existing translations are untouched; the new catalog is merged additively.

## Git state

- Branch: `feat/vd-4c-builder-discovery-controls` from `origin/main` (`a37d893`)
- PR / head: recorded when the orchestrator opens the PR
