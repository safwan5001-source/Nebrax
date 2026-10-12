# CUST-HV V10b — True theme Preview, Apply summary and "new Draft Version" apply — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V10b** — second V10 slice (V10a model + Apply core ✔ → **V10b Preview / Apply summary / new Draft** → V10c section labels, copy / paste style, reset design → V10d Library thumbnails, hover action bar, drag reorder). |
| **Branch** | `cust-hv/v10b-theme-preview-apply` (stacked on V10a until it merges) |
| **Authority** | V0 §16 (Apply is non-destructive and ordered: Preview → Apply summary → new Draft Version → editor) · D-30 · DEF-4 (a theme card must not pretend the live store is the theme) |
| **Scope** | Merchant app only. No PHP, endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Where the Preview lives | **In the builder**: `/commerce/appearance?version=<base>&previewTheme=<id>`. The Canvas renders `applyTheme(draft, theme).config` through the same loaders as editing (real categories, new arrivals, offers), so the preview is "the theme over the merchant's own data", with the real Desktop / Tablet / Mobile switch. | The builder already owns the data loading and the Canvas; a second renderer in the gallery would drift. |
| Read-only | While previewing, the section / panel rail and the controls aside are removed (`!hidden` + `inert`), Canvas selection is a no-op, Save / Publish are disabled. Nothing is written. | A preview must not be editable and must not be able to dirty a Version. |
| Base document | The Published Version when there is one, else the most recently updated Version, else the default document. The theme is applied to a **copy**. | "Over the merchant's own data" — and the saved draft is exactly the pixels they previewed. |
| Apply summary | The ten areas (changed / no change) and the fixed "what stays" list, from `applyTheme` (V10a), above the Canvas. Applying a theme identical to the current design is disabled with a note. | V0 §16 step 2. |
| The one write | `applyThemeAsNewDraft`: create a NEW Draft Version → save the themed copy of the previewed document with that draft's revision → on failure delete the new draft and say so. Then open it in the editor. The Published Version and existing Versions are never written. | V0 §16 step 3; same rollback as the former gallery flow. |
| Gallery | Renders `BUILT_IN_THEMES` (six). Each card's action is **Preview & apply** (a link to the builder preview); the old one-click "Use theme" is removed. The honest "View published store" link stays; the old `theme-registry.ts` (three preset-only entries) is deleted — one source of truth. | The frozen contract makes Apply an ordered flow; two parallel entry points would let the gallery bypass the summary. |
| Query parsing | The appearance page reads `?version` / `?previewTheme` **after mount** and mounts the builder once they are known. | On a client navigation `window.location` is updated after the new page commits; reading it during render dropped the parameters (found by the real-browser run). |
| Gift pack | Bloom's `pack` still adds only the gift sections the store can back, supplied by the page (`themePackSections`); failure to compute them never blocks the theme. **The pack is computed before the preview is shown** (`withThemePack`): the Canvas, the Apply summary (an "adds N gift sections" line; `noop` is false when only the pack changes something) and the saved draft are one configuration, and Apply writes exactly that (`writeThemedDraft`). | FLOWERS-H15 unchanged; review finding P2 (the previewed result must equal the saved result). |
| Base readiness | Apply is enabled only over the merchant's own loaded document — a loaded version, or a store with no versions yet — and only once the pack (if any) is computed. While the version loads, fails, or the choice is ambiguous the bar says so and Apply is disabled. | Review finding P1: before the load `draft` is the default document; a draft created from it would drop the merchant's content. |
| Read-only on every width | While previewing, the mobile editing bar and its sheets are not rendered, the mobile version button is disabled, the desktop version selector is inert, and "Restore default" is disabled (and guarded in the handler). Only the device switch, Exit and Apply act. | Review round 2 (P1): the preview is presented as read-only; on a phone the always-mounted bar could open editable sheets and dirty the draft that Apply writes. |
| Exit during Apply | The builder toolbar's Exit is disabled for the duration of the two-request apply, like the bar's own Exit. | Review round 2 (P2): a full-page navigation between create and save would abort the save and skip the rollback, leaving an empty draft. |
| Gallery links | The Preview & apply link is offered only once the base version is resolved (`loading` / `ready` / `error`): loading or failed is not "no versions", and a link without `version` would let the builder pick a draft instead of the Published Version. On error the cards say so. | Review round 2 (P2). |
| Assets | Unchanged from V10a: a theme listing an asset fails closed (`assets_unsupported`) — no write at all. | AMEND-6 clone-on-apply remains gated; nothing ships imagery. |

## What was built

- `themes/apply-theme-flow.ts` (create → save → rollback), `themes/preview-link.ts` (base-version choice, preview URL), `themes/ThemePreviewBar.tsx` (summary + Apply / Exit), builder wiring (`previewThemeId`, `themePackSections`, themed Canvas config, inert editing), appearance page (post-mount query, pack provider), Theme Gallery rewritten over `BUILT_IN_THEMES`, AR / EN strings (`themeGalleryPreviewApply`, `theme*` in the builder).

## Backward compatibility

The builder without `previewThemeId` is byte-for-byte the editor it was. `?version=` handling is unchanged (now read after mount; the builder mounts once). A store with no versions can still preview and apply (the base is the default document).

## Tests

- `apply-theme-flow.test.ts` (7): creates a new draft and saves the themed copy with the new draft's revision; rolls back on a failed save; writes nothing when create fails or when a theme lists an asset; the Bloom pack adds only what the store can back, survives a data failure, and other themes never ask for it.
- `ExperienceBuilder.themePreview.test.tsx` (6): bar with ten areas + kept list; editing inert; **nothing written**; the Canvas carries the theme's tokens; Apply → create + save + opens the draft; failed apply → alert, rollback, stays in preview; Exit → normal editor, URL param removed; unknown theme id → normal editor.
- Gallery `page.test.tsx` rewritten (7): every theme, Preview & apply links (no direct apply), base version = Published / latest / none, no link without a store or permission, the honest store link.
- Real Chromium (`flowers-h15-bloom-theme.spec.ts`, 9): gallery lists six themes at 390 / 1440 AR + 1440 EN; **gallery → Preview → summary → Apply** writes the themed draft with the gift sections (preview wrote nothing first); the preview bar at 390 / 768 / 1024 / 1440 in AR RTL and EN LTR fits the viewport (no horizontal overflow), lists all ten areas, and keeps Apply / Exit visible.
- Review-round tests: Apply disabled and nothing written until the version loads (then saves the loaded document, not the default); a failed load never enables Apply; the pack's sections are announced in the summary and saved exactly as previewed; Apply waits for the pack; `withThemePack` unit tests (noop becomes false with only a pack; identity on null / failed application).
- Review round 2 tests: toolbar Exit disabled while applying; on a 390 px viewport the mobile bar is absent in preview and returns on Exit; gallery links absent while loading and on failure (with the error note) and present once resolved.
- Whole web suite green (see PR).

## Design Quality Pass

Evidence screenshots from the run above (`test-results/flowers-h15-bloom-theme/*-preview.png`): the bar uses the semantic tokens (`border-border`, `bg-surface`, `text-muted`, `bg-primary`), 44 px touch targets below `md`, a two-column area list so the summary stays compact on a phone, the "kept" list as chips; AR RTL / EN LTR mirror correctly; the Canvas below shows the theme (e.g. AWJ Atelier: serif headings, sharp corners, centred header) over the store's own data.

## Limitations (stated)

- The builder toolbar (Exit, device mode, version label) stays visible during a preview; Save / Publish / Schedule are disabled.
- The preview applies to the base version's document at load time; edits made elsewhere after opening are not reflected until reload.

## Invariants

Tenant isolation, authN/authZ (the gallery still needs `commerce.manage`; the writes are the existing authorised version endpoints), **Draft vs Published** (the apply creates a new draft; the Published Version is never written), concurrency (revision-checked save, rollback on failure), media ownership (themes carry no media; no global asset is written), backward compatibility: satisfied. **Commerce firewall:** themes are closed-list tokens. No arbitrary CSS / JS / HTML. No journal entry.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
