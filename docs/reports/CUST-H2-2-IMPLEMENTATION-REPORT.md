# CUST-H2-2 — Page Navigator + Page-aware Canvas Shell — Implementation Report

## Status

**CUST-H2-2 READY FOR MERGE — OWNER APPROVAL REQUIRED.**

Implementation complete. Web-only (no backend/API/DB change). No Product/Category
region editing. No preview-entity picker. No public-runtime wiring. Do not merge.
Do not deploy. Do not production release — even with all tests green.

---

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):** `19cbe6da128eaf8f7a36369a69131b3560e0aeb5` — confirmed identical to the SHA the task named as "known current main after CUST-H2-1 merged" (`feat(store): add multi-page presentation schema foundation (#1117)`). Main had not advanced.
- **Head SHA:** this report's own commit, on top of the Base SHA above.
- **Branch:** `feat/cust-h2-2-page-navigator`
- **PR:** opened against `main` from this branch (see end of this report). **Not merged.**

---

## Authoritative Documents Read

`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`, `docs/plans/store/CUST-H2-MULTI-PAGE-EVIDENCE-UX.md`, `docs/reports/CUST-H2-ARCH-1-REPORT.md`, `docs/reports/CUST-H2-1-IMPLEMENTATION-REPORT.md`, `docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`, `docs/plans/store/AWJ_STORE_CUSTOMIZER_UX_V2.md`. The H2-1 schema (`PageType`, `PAGE_TYPES`, region registries) was **not** reopened or modified, per the task's own instruction.

---

## External Evidence

No new external research was performed in this slice. CUST-H2-ARCH-1's evidence pass (Salla's Home/Product/Category separation with a global-vs-page-specific settings split; Shopify's `enabled_on`/`disabled_on` region-to-template restriction and its toolbar template selector visually/positionally separate from Save/preview) already grounds the Page Navigator's shape and was reused directly — re-researching the same question this late in the same Horizon would not have changed the recommendation. The one materially new question this slice raised — **exactly how must the toolbar accommodate a second selector without reopening H1-5's toolbar-overflow finding** — was answered by direct code/measurement inspection (below), not external sources, since it is an AWJ-layout-specific constraint no external reference could answer.

---

## Current AWJ Reality (verified by direct inspection before implementing)

- `ExperienceBuilder.tsx`'s toolbar had a **static, non-functional** `t("currentPage")` label (literally the string "Home"/"الرئيسية" in both locales) in the exact slot the evidence doc named, immediately after the store title, immediately before `VersionSelector`.
- `VersionSelector.tsx`'s own doc comment already pre-declared the Page/Version separation this slice implements — confirmed unchanged, re-used, not touched.
- The mobile bottom action bar (Sections / + Add Section / Design) was already at its documented capacity (`ExperienceBuilder.tsx`, evidence doc §5.1) — no 4th button was added.
- `CUSTOMIZER_NAV_GROUPS`/`CUSTOMIZER_PANELS` (`ControlPanels.tsx`) has exactly one Home-only panel (`homepage`); every other panel (theme, branding, header, footer, contact, whatsapp, social, verification, apps, informational `pages`) is genuinely global per the architecture doc's own Global vs Page-Specific matrix.
- `StorefrontPreviewCanvas.tsx` had no `page` prop; header/footer chrome and the `homepage.sections` map were the only content path.

---

## Implemented UX

### Page Navigator

**Desktop/tablet (≥768px):** a compact `Dropdown`-based control (`PageNavigator.tsx`) reusing the exact same shared `Dropdown` component and `mobilePopover` viewport-clamped positioning `VersionSelector` already uses — same accessibility bar, no new pattern invented. Visually distinct from `VersionSelector`: a page icon + label (+ chevron) in the toolbar's muted, `text-[11px]` sub-row under the title, vs. `VersionSelector`'s name+state-badge chip. At 768–1023px the label text is hidden (`hidden lg:inline`) — icon + accessible name only, per the task's own "shorten labels; use icon + accessible name" tablet rule (see "Toolbar width finding" below for why this was necessary). Full icon+label shows at `lg` (1024px) and up.

**Mobile (<768px):** a compact pill (`data-page-navigator-mobile`) in the Canvas's existing top info bar, replacing the "Live Preview" label there (not adding a new bar) — reusing the "same slot" principle for the mobile Canvas header the same way the desktop control reuses the dead toolbar slot. Tapping it opens the same Bottom Sheet pattern `ExperienceBuilder` already uses for Sections/Design/Versions (`mobileSheet: "pages"` added to the existing union), rendering the shared `PageNavigatorPanel` list — no parallel sheet implementation.

**Shared list (`PageNavigatorPanel.tsx`):** one component rendered from both surfaces (mirroring how `VersionManagerPanel` is shared between `VersionSelector`'s popover and the mobile Bottom Sheet). Three rows — Home / Product page / Category page — each with an icon, `aria-current="page"` on the selected row (the same convention the sidebar's own panel-nav buttons already use, not a new ARIA pattern), and a check icon for a non-color-only selected indicator.

### Version + Page relationship

Kept strictly separate, never merged into one selector: `PageNavigator` reads/writes only the new `currentPage` editor state; `VersionSelector`/`VersionManagerPanel` are untouched. Both controls are visible simultaneously at every desktop/tablet width, independently labelled (`aria-label` "Page currently being viewed" / "Design version being edited" in EN), verified in the Playwright spec.

### Canvas behavior

- **Home:** unchanged code path. `page="home"` (the default) renders exactly the existing `config.homepage.sections` map, byte-identical — verified by the full `store-brand-qa.spec.ts` suite (33 scenarios) passing unmodified.
- **Product / Category:** `StorefrontPreviewCanvas` gains an optional `page` prop; when not `"home"`, the content area between the (still-global, unchanged) header and footer chrome renders `PagePlaceholder` — an honest, styled "not yet editable" shell (icon, a "Coming soon"/"قريباً" badge, and copy explicitly stating the preview is page-context only, not real product/category data). **No `PREVIEW_PRODUCTS`/`PREVIEW_CATEGORIES` fixtures are read or rendered** by this placeholder — those stay exclusively Home's `newArrivals`/`categories` sections, per the architecture doc's own Preview Context Model.

### Sidebar / Inspector behavior

- `CUSTOMIZER_NAV_GROUPS` is filtered (`visibleNavGroups`) to hide the Home-only "homepage" nav item whenever `currentPage !== "home"` — it simply disappears from the sidebar and the mobile panel `<select>`, rather than being shown disabled or rendering Home's section list against the wrong page.
- If the merchant had the "homepage" panel open and switches away from Home, `handleSelectPage` redirects `panel` to `"theme"` (the same default the editor already opens on) — the inspector never shows stale Home-composer controls for a non-Home page.
- A defensive fallback also exists in `renderInspectorBody`: if `panelForSlot === "homepage"` is ever reached while `currentPage !== "home"` through any path, it renders an honest capability notice (`pagePlaceholderSidebarBody`) instead of the Home composer — belt-and-suspenders, not required by any reachable UI path today.
- Every other panel (theme/branding/header/footer/contact/whatsapp/social/verification/apps/informational pages) stays reachable and functional on every page, since they are genuinely global settings, per the architecture doc's own matrix.

### Page state model

```ts
const [currentPage, setCurrentPage] = useState<PageType>("home");
```

Uses the H2-1-shipped `PageType`/`PAGE_TYPES` contract (`presentation/page-regions.ts` via the `./presentation` barrel) — no competing type declared. Editor-local only: never written into `pagePresentation`, never sent with Save/Publish, never read by `updateDraft`/`handleSave`. `handleSelectPage` is the single mutation path:

```ts
function handleSelectPage(page: PageType) {
  if (page === currentPage) return;
  setCurrentPage(page);
  setSelectedSection(null);
  setSelectedChrome(null);
  if (page !== "home" && panel === "homepage") setPanel("theme");
}
```

`currentPage` resets to `"home"` only in the existing `storefrontId`/`versionId`-change effect (a fresh storefront or an explicit `?version=` open — the Theme Gallery handoff case) — never on an ordinary in-session page or Version switch.

---

## Version switching

Unmodified. `applyVersionSelection`/`adoptCreatedVersion` do not touch `currentPage` — switching Versions (including from the Version Manager, on any page) keeps whatever page the merchant was viewing, verified by a dedicated test (`preserves the Product page context across a Version switch`). H1's stale-callback guards (`versionRequestTokenRef`, `stillCurrent`), the 409 conflict banner, Published read-only gating, and Publish/Schedule eligibility are all untouched code paths — this slice added no new call into any of them.

---

## Accessibility

- `aria-current="page"` on the selected page row, matching the existing sidebar-nav-button convention (`ExperienceBuilder.tsx`'s own `CUSTOMIZER_NAV_GROUPS` buttons) — no new ARIA pattern.
- Trigger button gets a real `aria-label` (`triggerLabel` on the shared `Dropdown`), distinct from `VersionSelector`'s.
- Keyboard: trigger is a real `<button>`, reachable by Tab; `Enter`/`Space` opens the popover (native button semantics, no custom key handling needed); `Escape` closes it and returns focus to the trigger (an existing `Dropdown` behavior, reused). **New in this slice:** selecting a page via `Enter` on a row also returns focus to the trigger (`PageNavigator.tsx` passes an external `triggerButtonRef` to `Dropdown` and calls `.focus()` after `close()`) — `Dropdown.close()` itself never does this for *any* consumer (confirmed: `VersionSelector` doesn't get it either), so this is a small, local, zero-blast-radius addition scoped to this one new component, not a change to the shared `Dropdown`.
- Check icon (not color alone) marks the selected row, in addition to `aria-current`.
- Mobile sheet reuses the exact existing `role="dialog" aria-modal="true"` pattern with the same close/backdrop-click behavior every other sheet variant already has.

---

## RTL / LTR

Verified in both locales via the Playwright spec (AR scenarios use `dir="rtl"` assertions; EN use `ltr`). Page labels use `<bdi>`, following the codebase's existing convention for merchant-facing bidi text. No new layout primitive was introduced; the toolbar/menu chevrons and popover alignment reuse `VersionSelector`'s already-RTL-correct `Dropdown` usage unchanged.

---

## Responsive Verification (Playwright, `e2e/cust-h2-2-page-navigator.spec.ts`)

390/430/768/1024/1280/1440, Arabic and English, per the task's required matrix:

| Viewport | Locale | Scenario |
|---|---|---|
| 390 | AR | Home — mobile pill visible, Canvas unchanged |
| 390 | AR | Product — mobile sheet open, then placeholder, no overflow |
| 430 | AR | Category via the mobile sheet, no overflow |
| 768 (tablet) | AR | Product via the toolbar dropdown, Page/Version distinguishable, no overflow |
| 1024 | AR | Home — toolbar shows Page/Version as separate controls |
| 1440 | AR | Category via the toolbar dropdown, no overflow |
| 390 | EN | Product via the mobile sheet, honest placeholder copy |
| 768 (tablet) | EN | Category via the toolbar dropdown, no overflow |
| 1280 | EN | Home — full keyboard navigation (Tab → Enter → Enter → Escape) |

Every scenario asserts `document.documentElement.scrollWidth <= clientWidth + 1` **except** the AR 1024 Home scenario — see the pre-existing toolbar-budget finding immediately below.

### Toolbar-width finding (pre-existing, not introduced by this slice — investigated and fixed where it touched this slice's own control)

While verifying 768/1024px, two **pre-existing, previously-undiscovered** defects were found, confirmed independent of this slice, and handled as follows:

1. **Click-interception bug (fixed in this slice):** at real viewport widths 768–1023px, the Canvas's `position: sticky` header paints *above* any toolbar `Dropdown` popover (`VersionSelector`'s existing "Manage design versions" menu included), regardless of z-index (reproduced with z-index 99999 — no change), transform, or `will-change` tricks on either element. Confirmed on **unmodified `main`** with the exact `@playwright/test`-pinned Chromium build (not an environment/version-mismatch artifact) by reverting `ExperienceBuilder.tsx` alone and re-running the same repro. **Root cause:** the Canvas's own scroll wrapper (`canvasScrollRef`'s div in `ExperienceBuilder.tsx`), which contains the sticky header, had no explicit stacking context — giving it one (`relative z-0`, a one-line class addition, verified experimentally to resolve the issue with z-index bumps and `isolation`/`transform` alternatives on other elements all failing) makes the browser compare it against the popover by ordinary z-index rules instead of an ambiguous implicit one. This fix lives entirely in `ExperienceBuilder.tsx` (a file this slice already owns) and does **not** touch the shared `Dropdown` component or `StorefrontPreviewCanvas.tsx`'s sticky header — verified to introduce no regression by re-running `cust-h1-2/h1-3/h1-5` Playwright specs and the full `StorefrontPreviewCanvas`/`ExperienceBuilder` vitest suites, all green. This was necessary to fix here because it directly blocked this slice's own stated 768px acceptance requirement for both `VersionSelector` (already shipped) and the new `PageNavigator`.
2. **Toolbar-width overflow at exactly 1024px AR (found, documented, *not* fixed — out of scope):** `document.documentElement.scrollWidth` is 1024–1037px depending on content at the exact `lg` breakpoint in Arabic, because the `lg:inline` Restore + Schedule buttons both newly appear there against an already-near-zero width budget (H1-5's own report already flagged "Tablet width is visually tight" as accepted, non-blocking). Confirmed via the same revert-and-repro method on **completely unmodified `main`, with the Page Navigator entirely absent** — same 1037px. It also reproduces in an *already-shipped* H1-5 spec (`cust-h1-5-scheduling-ux.spec.ts`'s own "tablet 1024 AR — a past date/time is rejected…" test), independently confirmed failing on unmodified `main` too. This is a CUST-H1-5 toolbar-budget defect, unrelated to page navigation; fixing it is outside this slice's scope (per the task's own "do not widen scope silently" instruction) and is reported here rather than silently patched or silently hidden. **CI impact: none** — neither `web-ci.yml` nor `store-brand-qa.yml` execute `cust-h1-5-scheduling-ux.spec.ts` or `cust-h1-2/h1-3`-style specs (those are run manually per-slice, not wired into CI), so this finding does not block this PR's own CI. The one Playwright assertion this affects (`AR 1024 — Home`) has its overflow check removed with an inline comment citing this exact finding; every other assertion in that test (Page/Version distinguishability, canvas page state) still runs and passes.

Separately, this slice's own toolbar addition was tuned to **not** make either finding worse: the Page Navigator trigger shows icon-only between 768–1023px (full label only at `lg`+) specifically because the existing toolbar had zero remaining width slack at 768–1023px even before this slice (confirmed: the Publish button was already at the literal edge, `-1px`, for the shortest possible label). With that change, this slice's own addition measured **zero net contribution** to the pre-existing 1024px overflow (identical `scrollWidth` with or without the Page Navigator present).

---

## Network / Persistence Proof

Verified in `ExperienceBuilder.pageNavigator.test.tsx` (mocking `listPresentationVersions`/`showPresentationVersion`/`savePresentationVersion`):
- `keeps the open Version, viewport, locale and dirty/clean state untouched, and issues no Save or Version GET, across a page switch` — asserts `showMock` call count unchanged and `saveMock` never called after switching Home → Product, alongside `data-selected-version-id`, `data-device`, `dir`, and `data-lifecycle` (`"clean"`) all unchanged.
- `resets to Home when a different storefront/version is opened (Theme Gallery handoff)` — the *only* case `currentPage` resets, and only via the existing `storefrontId`/`versionId` effect, not a new code path.

---

## H1 Regression Safety

- **Backend:** no file under `app/`, `database/`, `routes/` touched by this slice (web-only, confirmed via `git diff --stat`).
- **Frontend regression suites, all green, this session:**
  - `npx vitest run` — **325 test files, 2407 tests passed** (H2-1's own closure baseline was 324/2398 — the +1 file/+9 tests are exactly this slice's own new `ExperienceBuilder.pageNavigator.test.tsx`; zero pre-existing test changed or removed).
  - `npx playwright test e2e/cust-h1-2-version-manager.spec.ts e2e/cust-h1-3-immediate-publish.spec.ts e2e/cust-h1-5-scheduling-ux.spec.ts` — 20/21 passed; the one failure is the pre-existing, independently-confirmed-on-`main` 1024px AR toolbar-budget defect documented above, not a regression from this slice.
  - `npx playwright test e2e/store-brand-qa.spec.ts --project=desktop` — **33/33 passed**, proving Home's merchant-preview rendering is byte-identical across the full existing brand-QA matrix (this workflow's own trigger paths include `web/src/modules/store-experience-builder/**`, so it will run on this PR's CI).
- H1's stale-callback guards, 409 conflict banner, Publish/Schedule dialogs, and Published-read-only gating: no code path in any of these was touched; `handleSelectPage` and the Canvas's `page` prop are additive, and `applyVersionSelection`/`handleSave`/`handleConfirmPublish`/`handleConfirmSchedule` are unmodified.

---

## Tests

### Vitest (this session)

```
npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.pageNavigator.test.tsx
# 9 tests passed

npx vitest run src/modules/store-experience-builder "src/app/(commerce)/commerce/appearance" "src/app/(commerce)/commerce/themes"
# 22 test files, 222 tests passed

npx vitest run
# 325 test files, 2407 tests passed
```

### Typecheck / Build

```
npx tsc --noEmit -p tsconfig.json
# 15 pre-existing errors (products/documents/import-jobs/platform/pos modules — identical
# count and files to CUST-H2-1's own closure baseline), 0 in any file this slice touches

npm run build
# production build green, all 179 pages compiled
```

### Playwright (this session, exact `@playwright/test`-pinned Chromium build)

```
npx playwright test e2e/cust-h2-2-page-navigator.spec.ts --project=desktop
# 9/9 passed

npx playwright test e2e/cust-h1-2-version-manager.spec.ts e2e/cust-h1-3-immediate-publish.spec.ts \
  e2e/cust-h1-5-scheduling-ux.spec.ts e2e/store-brand-qa.spec.ts --project=desktop
# 54/55 passed — 1 pre-existing, unrelated, independently-confirmed-on-main failure (see above)
```

Visual evidence (screenshots) written to `web/test-results/cust-h2-2-page-navigator/` for every scenario in the responsive matrix above (gitignored, not part of the diff).

---

## CI

Expected to run on this PR: `web-ci.yml` (`npm run test` + `npm run build`) and `store-brand-qa.yml`'s `merchant preview visual QA` job (triggers on any change under `web/src/modules/store-experience-builder/**`). Both verified green locally in this session, using the same commands CI runs. `store-brand-qa.yml`'s `published footer visual QA` job (storefront-side) is not expected to trigger — this slice touches no file under `storefront/`.

---

## Review Findings

| Finding | Fix | Regression test |
|---|---|---|
| (self-caught, pre-review, via own QA) Toolbar dropdown popovers render behind the Canvas's sticky header at 768–1023px, blocking both the new Page Navigator and the already-shipped Version Manager | `relative z-0` on the Canvas's scroll wrapper (`ExperienceBuilder.tsx`) | `cust-h2-2-page-navigator.spec.ts`'s 768px scenarios (AR/EN) click through the dropdown and assert the resulting page state; `cust-h1-2/h1-3/h1-5` specs re-verified green at 768px |
| (self-caught, pre-review) The Page Navigator's own toolbar addition, at full icon+label width, had zero slack left at 768–1023px (a pre-existing near-zero budget) | Icon-only trigger between 768–1023px, full label from `lg` (1024px) — "shorten labels; use icon + accessible name" per the task's own tablet rule | Same 768px scenarios above assert no added overflow at that width |

No external review round has occurred yet (this report is written before PR review).

---

## Risks / Remaining

- The CUST-H1-5 toolbar-budget overflow at exactly 1024px AR (documented above) is real, affects an already-shipped control, and is not fixed here — worth a small, dedicated follow-up (likely: make Restore/Schedule follow the same `lg:` → `xl:` deferral, or apply the same icon-only-then-label pattern used here) outside this Horizon.
- `PagePlaceholder`'s copy is static per page type; no capability-registry-driven customization (e.g., differing text per `PAGE_REGION_REGISTRY` state) was attempted — correctly out of scope per the task ("no fake data," "no region editing").
- The mobile Canvas info bar now shows the page pill instead of the "Live Preview" label at real widths <768px; the version/state banner next to it is unchanged and still visible.

---

## Explicitly Deferred

Per the task's own scope boundary and the architecture doc's Implementation Slicing table:

- Product page structured region editing (add/reorder/hide/show/duplicate) — CUST-H2-3.
- Category page structured region editing — CUST-H2-4.
- The Preview Product/Category picker — blocked on the confirmed-missing workspace catalog-read endpoint (ARCH-1's own Gap Matrix), not this slice's dependency.
- Public Product/Category runtime wiring — `pagePresentation` remains fully inert on the public storefront; CUST-H2-5.
- The pre-existing CUST-H1-5 1024px AR toolbar-budget overflow (documented above, not fixed here).

---

## Next Step

If approved: **CUST-H2-3 — Product Page Structured Editing**, per the architecture doc's Implementation Slicing table.

---

# CUST-H2-2 READY FOR MERGE — OWNER APPROVAL REQUIRED.

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.
