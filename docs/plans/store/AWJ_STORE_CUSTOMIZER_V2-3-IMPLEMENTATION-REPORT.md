# AWJ Store Customizer V2 — Visual Builder Implementation Report

**Status:** READY FOR REVIEW

**Repository:** `safwan5001-source/Nebrax`  
**Branch:** `feat/store-customizer-v2-visual-builder`  
**Base:** `main` at `0f916f5f744c95fcf48b6420d8b01923800574f7`  
**Reference:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_UX_V2.md` and the supplied `AWJ Store Customizer V2 Prototype V0.2`.

## Executive summary

This slice implements the approved standalone Visual Builder workspace without restarting the V2/CONTRACT-2 work. The existing section-instance contract, capability rules, ID-based selection bridge, section picker, reorder, visibility, duplicate, delete, hero protection, and Draft → Save → Preview → Publish lifecycle were reused unchanged. The implementation is limited to the frontend workspace boundary and interaction layer.

The Commerce workspace shell now treats `/commerce/appearance` as a dedicated full-screen editor surface. The Commerce Header and Commerce Sidebar are not rendered inside the Customizer. The editor exposes an explicit **الخروج إلى التجارة / Exit to Commerce** control, while the editor chrome remains AWJ-owned and the storefront identity remains isolated to the Canvas.

## Implemented experience

The top toolbar now contains the exit action, store/page context, draft status, Arabic/English controls, and Desktop/Tablet/Mobile preview modes. The preview mode buttons operate on the same responsive document and do not alter presentation configuration. Existing Save Draft and Publish controls retain their existing API and lifecycle semantics; no fake persistence or publish behavior was introduced.

The workspace keeps the Canvas as the dominant area. Existing navigation and inspector surfaces remain available on Desktop as AWJ editor chrome, while the Canvas continues to use the existing storefront primitives and `presentationCssVars`. Merchant-selected storefront tokens do not restyle the surrounding editor.

Direct Canvas selection remains instance-ID based. Selecting a Canvas section resolves `section.id`, highlights the exact rendered instance with the existing non-color-only selection treatment, opens contextual section settings, and keeps the section-list selection synchronized. Section-list selection continues to scroll the Canvas to the exact instance without resetting the editor state.

Mobile is preview-first rather than a compressed desktop editor. At mobile width the Canvas is the primary surface and a touch-sized action bar exposes **Sections**, **Add Section**, and **Design**. Section and design controls open an AWJ-styled Bottom Sheet with an independently scrollable content region. Selecting a section directly in the Canvas opens its contextual settings in the sheet.

## Changed files

| File | Purpose |
|---|---|
| `web/src/components/commerce-workspace/commerce-workspace-shell.tsx` | Bypasses the normal Commerce Header and Sidebar for the standalone Customizer route. |
| `web/src/modules/store-experience-builder/ExperienceBuilder.tsx` | Adds the standalone AWJ toolbar, preview-first mobile surface, contextual Bottom Sheet, and preserves the existing selection/lifecycle bridges. |
| `web/src/modules/store-experience-builder/messages.ts` | Adds bilingual labels for exit, current page, preview draft, mobile sections, design, and close actions. |
| `docs/plans/store/AWJ_STORE_CUSTOMIZER_V2-3-IMPLEMENTATION-REPORT.md` | This report. |

No backend, API, database, tenant, authentication, authorization, Commerce business-rule, CONTRACT-2, or persistence files were changed.

## Verification

The targeted Customizer suite passed:

| Verification | Result |
|---|---:|
| Section selection and Canvas synchronization | 7/7 passed |
| Section instance operations and capability rules | 11/11 passed |
| Section editing regression suite | 8/8 passed |
| Targeted total | **26/26 passed** |
| `npm run build` | **Passed** |
| `git diff --check` | **Passed** |

The repository-wide `npx tsc --noEmit` still reports the pre-existing baseline errors in unrelated test files under POS settings, platform cards, product components, document presentation, and import jobs. No error was reported from the files changed by this implementation. The Next.js build completed successfully.

## Visual QA

Visual and interaction QA was performed against the supplied Prototype V0.2 direction using the local Demo mode at the required widths.

| Viewport | Result | Evidence |
|---|---|---|
| Desktop `1440×960` | Standalone workspace, no Commerce Header/Sidebar, Canvas dominant, toolbar device controls, exact Canvas selection/highlight | `/home/ubuntu/work/Nebrax/qa-artifacts/customizer-desktop-1440.png` |
| Mobile `390×844` | Preview-first Canvas, no permanent desktop sidebar, touch action bar | `/home/ubuntu/work/Nebrax/qa-artifacts/customizer-mobile-390.png` |
| Mobile Bottom Sheet | Sections sheet opens and scrolls independently | `/home/ubuntu/work/Nebrax/qa-artifacts/customizer-mobile-390-sheet.png` |

The automated Playwright smoke check also verified that the standalone route has no detected Commerce Sidebar, the Canvas exists, the Desktop `categories` instance selects and highlights by ID, and the Mobile Bottom Sheet is present and independently scrollable. Raw results are stored at `/home/ubuntu/work/Nebrax/qa-artifacts/qa-results.json`.

The local Next.js development overlay displayed unrelated existing project issues while running the app; these did not prevent rendering the Customizer and are not caused by the changed files.

## Scope and release gate

This work is intentionally limited to the approved Visual Builder UI slice. It does not add Undo/Redo, DnD reorder, per-instance content contracts, version history, new persistence, or a public unpublished preview route. Gated section types remain honest and continue to follow the existing capability model.

The branch is ready for owner review through one focused PR. **No merge, deploy, release, or production action was performed.**
