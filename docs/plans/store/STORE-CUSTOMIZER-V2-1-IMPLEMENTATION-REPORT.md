# STORE-CUSTOMIZER-V2-1 — Customizer Shell + Live Preview + Section Selection

**Status:** Implemented. Tests green. Not merged. Not deployed.
**Date:** 2026-09-19
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `83f81fdef6fff78e6e47a1ceca82c8cb6828e8aa` (main = merge of docs PR #876, exactly the expected SHA)
**Branch:** `feat/store-customizer-v2-shell-selection`
**Source of truth:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_UX_V2.md`; persistence lock `AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md` untouched.

---

## 1. Summary

First implementation slice of AWJ Store Customizer UX V2. The existing `/commerce/appearance` Experience Builder was evolved **in place** (no rewrite, no parallel customizer) toward the V2 visual-editor model:

- The customizer's own scroll regions (sidebar nav, settings panel, live preview canvas) are now explicit, independent, thin-scrollbar scroll containers; the top toolbar stays put.
- **Section selection bridge**: a single `selectedSection` state shared between the sidebar homepage composer and the live preview.
- **Scroll-to-Section**: selecting a section in the composer scrolls the preview to it (`prefers-reduced-motion` respected) and highlights it.
- **Click-to-Edit foundation**: clicking (or Enter/Space on) a homepage section inside the preview selects it and opens its homepage settings — without triggering a redundant scroll jump.
- Desktop/Tablet/Mobile preview modes preserved; `StorefrontPresentationConfig` v1, capabilities, persistence architecture, and public contracts unchanged.

The attached Prototype V0.2 HTML was read **only** to confirm the interaction model (select → scroll → highlight, independent scrolls, overscroll containment). **No HTML/CSS/JS, colors, spacing, or dimensions were copied from it.**

## 2. Repository evidence used

| Source | What it established |
|---|---|
| `docs/plans/store/AWJ_STORE_CUSTOMIZER_UX_V2.md` | The UX contract this slice implements (§5 desktop, §7 scroll model, §3.2 click-to-edit, §17 PR split). |
| `web/src/modules/store-experience-builder/` | The merchant-facing builder: `ExperienceBuilder.tsx` (shell), `ControlPanels.tsx` (homepage composer with visibility/reorder), `StorefrontPreviewCanvas.tsx` (homepage sections render seam), `store-preview.css` (token sheet). |
| `storefront/src/components/customizer/` + `storefront/src/lib/presentation/` | The storefront-side mirror used by the dev harness; intentionally untouched in this slice (see §11). |
| `web/src/app/(commerce)/commerce/appearance/page.tsx` + `page.test.tsx` | Route wiring (`selectedStoreId`, live store name fallback) and the existing test/mocking pattern reused for the new tests. |
| `web/vitest.config.ts` | jsdom environment globs; `src/app/**/commerce/**` already covered — no config change needed. |
| Prototype `awj-store-customizer-v2-prototype-v0.2.html` | Interaction model reference only (selection, `scrollIntoView`, `overscroll-behavior: contain`, thin scrollbars). Not a visual source of truth. |

## 3. What was implemented

### A. Customizer shell / independent scrolling

- Added `data-customizer-scroll` to the three customizer-owned scroll regions: sidebar nav, settings panel body, preview canvas container.
- New CSS (in the existing `store-preview.css` token sheet): `scrollbar-width: thin` + muted scrollbar color + `overscroll-behavior: contain` for those regions — visible but unobtrusive, no nested-scroll chaining into the outer page.
- Preview canvas container gained `overscroll-contain`. Toolbar, layout structure, and preview dominance (196 / 300–320 / remainder) are unchanged — they already matched the V2 shell contract.

### B. Section selection (sidebar ↔ preview sync)

- `ExperienceBuilder` owns `selectedSection: HomeBuilderSectionKey | null` (stable section keys from the existing composer model; no new persistence — page-lifetime React state, like the rest of the draft).
- Root exposes `data-selected-section` for tests/QA.
- Composer rows (`HomepagePanel`): the section label is now a semantic select button (`data-section-option`, `aria-pressed`, `title`, focus-visible ring). Selected row gets a start-edge marker bar + background (not color-only) and `aria-pressed="true"`.
- Selecting from the sidebar opens the homepage panel (the section's settings) and queues scroll-to-section.

### C. Scroll-to-Section

- Sidebar-origin selection queues a scroll; after render, the preview target (`[data-preview-section="<key>"]`) receives `scrollIntoView({ behavior, block: "start" })`.
- `behavior` is `"auto"` when `prefers-reduced-motion: reduce` matches, else `"smooth"`.
- Guarded for non-browser/test environments (`scrollIntoView` / `matchMedia` may not exist).
- Preview-origin clicks **do not** scroll (the section is already in view — avoids pointless jumps).
- Sections hidden from the preview simply have no target; selection state itself is unaffected.
- `scroll-margin-top` on preview sections keeps the sticky preview header from covering the scrolled-to section.

### D. Click-to-Edit foundation

- `StorefrontPreviewCanvas` accepts optional `selectedSection` / `onSelectSection`. When provided, each **rendered homepage section** is wrapped in a selectable region: `role="button"`, `tabIndex={0}`, `aria-pressed`, Enter/Space keyboard support, `data-preview-section` stable identity.
- Clicking a preview section selects it, syncs the composer (pressed state), and opens its settings panel. No new inspector, no per-section settings expansion — foundation only, per scope.
- Header/footer/identity regions are **not** selectable yet (deferred to V2-2/V2-3; documented, not hacked in).
- When `onSelectSection` is absent (e.g. the storefront dev-harness mirror), sections render exactly as before.

## 4. UX behavior before / after

| Flow | Before | After |
|---|---|---|
| Reaching a section in a long preview | Manual scrolling through the preview | Select in composer → preview scrolls and highlights it |
| Knowing which section is being edited | None | Selected state synced between composer row and preview outline |
| Editing a section seen in the preview | Find "الصفحة الرئيسية" panel, then find the section in the composer | Click the section in the preview; its settings open |
| Scrolling | Regions scrolled but with default/inconsistent scrollbars and no containment | Three independent thin-scrollbar regions, toolbar always reachable, no scroll chaining |
| Composer row affordance | Label text only (reorder + visibility controls) | Label is a select button with keyboard focus ring |

## 5. Architecture decisions

1. **Evolve the existing web builder** (`web/src/modules/store-experience-builder/`), no new module, no parallel customizer.
2. **Selection is editor chrome state**, not presentation data: `StorefrontPresentationConfig` v1 untouched; nothing persisted; nothing written to browser storage.
3. **Stable identity = existing section keys** (`HomeBuilderSectionKey`); no new ID scheme.
4. **Optional canvas props** keep the storefront mirror (`storefront/src/components/customizer/`) and the public storefront completely untouched; the mirror can adopt the same props in a later slice.
5. Scroll trigger is **origin-aware** (sidebar queues scroll; preview click does not) to prevent scroll jumps, per the UX doc §7.
6. New CSS lives in the existing token sheet (`store-preview.css`) and uses `--store-*` variables; no raw hex in components (the scrollbar color falls back to the palette's muted token value defined in that sheet).

## 6. Changed files

| File | Change |
|---|---|
| `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` | Selection state + origin-aware scroll-to-section effect, `data-selected-section`, `data-customizer-scroll` regions, prop wiring. |
| `web/src/modules/store-experience-builder/ControlPanels.tsx` | Composer rows selectable (`data-section-option`, `aria-pressed`, selected marker), props threading. |
| `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` | Optional selection bridge; homepage sections wrapped in selectable, keyboard-accessible regions with stable `data-preview-section`. |
| `web/src/modules/store-experience-builder/store-preview.css` | Selected-section outline + focus-visible + scroll-margin; thin contained scrollbars for customizer scroll regions. |
| `web/src/app/(commerce)/commerce/appearance/section-selection.test.tsx` | **New** — 7 tests (see §7). |

No backend, API, schema, migration, or public-contract change. No persistence change. No capability-state change.

## 7. Tests run + exact results

Targeted (builder + appearance page):

```
vitest run 'src/app/(commerce)/commerce/appearance' 'src/modules/store-experience-builder'
  Test Files  3 passed (3)
  Tests       13 passed (13)
```

New tests cover: independent scroll regions presence; sidebar selection → composer `aria-pressed` + preview `data-section-selected` sync; scroll-to-section trigger with `block: "start"`; reduced-motion → `behavior: "auto"`; preview click selection without a scroll jump; Desktop/Tablet/Mobile device switching; composer visibility toggle + reorder preserved.

Full web suite:

```
npm test
  Test Files  281 passed (281)
  Tests       1919 passed (1919)
```

(First full-suite run showed a single transient failure unrelated to this change; immediate re-run was fully green — no test was weakened or skipped.)

## 8. Build / typecheck / lint

- `npx tsc --noEmit`: **0 errors in changed scope.** The repo has 12 pre-existing type errors in unrelated files (`pos/settings/configuration`, `gemini-card`, `document-language-selector`, `global-application-controls-card`, `product-multi-barcode-table` tests) — identical count on unmodified `main` (verified by stash A/B). Not fixed here per scope discipline.
- `npm run build` (Next.js production build): **success**, exit 0.
- `next lint`: not configured in `web` (interactive scaffold prompt, no ESLint config in repo) — documented as a tooling gap, not introduced by this PR.

## 9. Visual / manual verification

Environment note: `/commerce/appearance` requires authenticated session + Laravel backend, unavailable in this sandbox. Verification used a **temporary local harness page** (`src/app/dev-v2-check/page.tsx`, rendering `ExperienceBuilder` directly) which was **deleted before commit** and is not part of the diff.

Verified manually in Chromium (RTL, Arabic):

- Desktop shell: toolbar on top, sidebar + settings + dominant preview canvas. ✅
- Independent scroll: sidebar, settings panel, and preview scroll separately; toolbar stays; thin visible scrollbars. ✅
- Section selection from composer: row marked (edge bar + pressed state), preview scrolled to the section (`الجملة`), section outlined in preview. ✅
- Preview click selection: clicking a preview section selects it and opens homepage settings without a scroll jump. ✅ (test-covered)
- Preview modes: حاسوب / جهاز لوحي / جوال switch the framed width as before. ✅ (test-covered)
- No clipping/overflow observed at desktop width.

Screenshots captured during verification (local only, not committed): initial shell, homepage panel, wholesale selected + scrolled, hero selected + scrolled.

**Pre-existing observation (not a regression):** the hero gradient in the **web** preview canvas renders washed-out in the dev server (CSS ordering between Tailwind's `bg-gradient-to-r` utility and the plain-CSS variable overrides in `store-preview.css`). Confirmed identical on unmodified `main` via stash A/B. Recorded as a follow-up; not fixed in this slice.

## 10. Accessibility notes

- Section selection is not color-only: `aria-pressed` on both the composer button and the preview region, plus a start-edge marker bar on the composer row and an outline on the preview section.
- Preview sections are keyboard-operable (Tab focus, Enter/Space select, visible focus ring via `:focus-visible`).
- `prefers-reduced-motion: reduce` switches scroll-to-section to instant.
- RTL-first preserved (`dir` follows builder locale; logical CSS properties only; no physical left/right added).
- Existing keyboard navigation, locale switcher, and mobile tab pattern unchanged.

## 11. Tenant / security impact

None. UI-only slice: no tenant resolution, auth, authorization, API, or public-contract change. Selection state is page-lifetime React state; nothing is written to `localStorage`/`sessionStorage`/cookies (architecture test in the storefront mirror still passes; the web module gained no storage usage). No cross-tenant surface introduced.

## 12. Backward compatibility assessment

- `StorefrontPresentationConfig` v1: unchanged. `normalizePresentationConfig()` and fail-closed behavior: untouched. Capability states: unchanged. Public storefront: untouched (the storefront mirror and `storefront/src` were not modified).
- Composer visibility/reorder behavior preserved (test-covered).
- The storefront dev-harness mirror renders identically (selection props are optional).

## 13. Risks

- **Mirror divergence**: `web` builder now has selection affordances the `storefront` dev-harness mirror lacks. Low risk (mirror is a dev harness), but the two should be re-synced in V2-2.
- Selection outline uses `outline` over arbitrary section backgrounds; contrast of the outline depends on the merchant's chosen primary color. Accepted for the editor chrome (not customer-facing); revisit if a very light primary is allowed against white sections.

## 14. Known gaps

- Header/footer/brand regions are not yet click-selectable (foundation covered homepage sections only).
- Mobile remains the existing Customize/Preview pattern; preview-first + bottom sheet is a later slice per the UX doc.
- Selecting a hidden (invisible) section marks it selected but cannot scroll the preview to it (no render target) — acceptable, matches "hidden = not rendered".

## 15. Explicitly deferred items

- Add / Duplicate / Delete section, Section Picker (V2-2).
- Per-section content editing surface expansion; progressive disclosure model (V2-2/V2-3).
- Store identity + global theme merchant-language controls (V2-3).
- Draft/Preview/Publish backend (V2-4, per locked ARCH-1).
- Undo/Redo, version history (deferred capability).
- Storefront dev-harness mirror sync for selection props.
- Hero gradient dev-mode CSS ordering issue (pre-existing).
- ESLint configuration for `web` (pre-existing tooling gap).

## 16. Git

| | |
|---|---|
| **Branch** | `feat/store-customizer-v2-shell-selection` |
| **Base SHA** | `83f81fdef6fff78e6e47a1ceca82c8cb6828e8aa` |
| **PR** | [#879](https://github.com/safwan5001-source/Nebrax/pull/879) — open, not merged |
| **Head SHA** | `3bdde11170f88065fb2e3b06bad8b98ea6b8766e` (implementation commit; this report is filed in a follow-up commit on the same branch) |

## 17. CI status

GitHub Web CI runs on PR #879 (check the PR page for the authoritative status). Local gates at push time: targeted vitest green (13/13), full web suite green (1919/1919), `tsc --noEmit` no new errors vs baseline, `next build` success.

## 18. Recommended next step

Owner review of this slice, then **PR-STORE-CUSTOMIZER-V2-2** (Section Editing: add / edit / reorder / duplicate / hide / delete with the Section Picker), including syncing the storefront dev-harness mirror with the selection bridge.
