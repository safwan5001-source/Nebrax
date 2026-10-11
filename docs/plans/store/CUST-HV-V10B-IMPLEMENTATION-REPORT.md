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
| Gift pack | Bloom's `pack` still adds only the gift sections the store can back, supplied by the page (`themePackSections`); failure to compute them never blocks the theme. | FLOWERS-H15 unchanged. |
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
