# CUST-HV V1A — Independent Defects — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | V1A — Independent proven defects (DEF-1, DEF-3a, DEF-4, DEF-9, DEF-10, DEF-11 — subsumes DEF-8) |
| **Branch** | `cust-hv/v1a-independent-defects` |
| **PR** | #1252 — https://github.com/safwan5001-source/Nebrax/pull/1252 |
| **Base SHA** | `4a22e811f6ff723d6b95a5c396ca80e6ca8e0903` (`origin/main` at rebase; Flowers H2-10 merged) |
| **Head SHA (code)** | `510981f6541416774a554b6c9e97d100b752d7b2` — this report is the PR's final, docs-only commit on top of it |
| **Authority** | `CUST-HV-MASTER-HORIZON-EXECUTION.md` · `CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md` §20 / §20.1 (D-33) · Roadmap V1 · Master Gap §27.2 |

Overlap check before starting: open PRs #1250 (Flowers H2-10, product admin), #1247 (Product Media consumer wiring), #1245 (multi-store) touch none of the Customizer shell, storefront Header/MobileMenu or Theme gallery. Nothing to coordinate.

---

## Implemented

| Defect | Outcome |
|---|---|
| **DEF-1** custom header links never reached phones | `MobileMenu` takes `extraLinks`; `StorefrontLayout` passes the **same** `publishedExtraNav()` list to the desktop `Header` and the mobile menu (parity by construction). Links sit with the main navigation (after categories, before Contact), close the menu on follow, and are absent when none are published. Enabled/safe/resolved-href filtering is unchanged (single source). |
| **DEF-4** theme "Preview" opened the live store | Per-card "Preview" removed. One page-level **«عرض المتجر المنشور» / "View published store"** link (new tab, `noreferrer`); when the domain is not provisioned, an explanation replaces it. The page description now says *using a theme creates a new draft and leaves the published store unchanged* — verified true against the existing apply flow (new Draft Version; Published never overwritten). A true theme preview remains **V10**. |
| **DEF-11** (+DEF-8) primary actions off-screen | **Exit / Save draft / Publish are always rendered on screen** at 390·430·768·1024·1280·1440, AR and EN, clean·dirty·conflict. Secondary controls collapse into one **More** menu as the bar narrows (table below). |
| **DEF-3a / DEF-9 / DEF-10** | Comment/doc-only. CategoryBanner now explains the image exists since #1110 and why the header still renders no cover (V9/DEF-3b). Capabilities header (storefront + web copies) distinguishes live named **Theme Versions** (H1) from the **point-in-time history/restore + Undo** that `VERSION_HISTORY_CAPABILITY` tracks (deferred to H5). HeroSection prop doc states the layout does pass `heroHeadline/heroSubheadline`. **No constant changed** (consumers + tests assert `"deferred"`). |

### Toolbar tiers (DEF-11)

| Control | < 768 | 768–1023 | 1024–1279 | ≥ 1280 |
|---|---|---|---|---|
| Exit (label) | icon | icon | icon | icon + label |
| Save draft · Publish | **inline** | **inline** | **inline** | **inline** |
| Title | hidden (< 640) | inline | inline | inline (truncates) |
| Page navigator | pill below bar | inline | inline | inline |
| Version | button → sheet | inline (≤148 px) | inline | inline |
| Status chip | dot on More + name + menu header | chip | chip | chip |
| Device switch | not applicable (mobile canvas) | **More** | inline | inline |
| Open store · Schedule | **More** | **More** | **More** | inline |
| Restore default | **More** | **More** | **More** | **More** |

Save/Publish/Schedule eligibility and their explanatory `title` strings are computed **once** (`saveDisabled/publishDisabled/scheduleDisabled/…Title`) and shared by the inline button and its More twin, so they cannot drift. Handlers, version logic, permissions and publish semantics are untouched.

## UX / design improvements (beyond the minimum)

- **Schedule is now reachable at every width** (previously only from the version manager below `lg`).
- Exit arrow mirrors in RTL (`←`→`→`), as a "back" affordance should.
- Status never disappears: chip ≥768; below it a dot on More (warning/conflict colour), the trigger's accessible name (`More actions — Unsaved draft`) and a status header inside the menu.
- Touch targets: Save/Publish/Exit/More are 40 px tall on handhelds (36 px from `md`).
- Version name readable at 768 (84→148 px) — the screenshot pass showed it truncated to "…التـ".
- Menu choices show a **visible check** (+ emphasis) for the active device; reserved space so labels do not jump. Found in the visual pass — the choice had only been announced via `aria-checked`.
- Menu opens inward on the logical end edge (RTL-safe), inside the viewport at 390.

## Files changed

**Storefront** — `components/layout/MobileMenu.tsx`, `Header.tsx`, `app/[country]/[locale]/(storefront)/layout.tsx`; comments in `CategoryBanner.tsx`, `HeroSection.tsx`, `lib/presentation/capabilities.ts`.
**Web** — `modules/store-experience-builder/ExperienceBuilder.tsx` (toolbar), `VersionSelector.tsx`, `messages.ts` (+`moreActions`, `previewDevice`), `presentation/capabilities.ts` (comment); `app/(commerce)/commerce/themes/page.tsx`, `modules/commerce-workspace/messages.ts` (DEF-4); `components/ui/dropdown.tsx` (additive `checked` / `external` / `dataAttrs`).
**Harness (dev-only)** — `app/dev/customizer-versions/page.tsx` (`openStore=1`, `conflict` scenario), `lib/mock-data.ts` (`bumpMockPresentationVersionRevision`; demo Version **PUT** now reaches its real handler — before, a demo save returned an empty body and could neither succeed nor conflict).
**Tests** — storefront `MobileMenu.test.tsx`, `layout.test.tsx`; web `ExperienceBuilder.toolbar.test.tsx` (new), `dropdown.test.tsx` (new), `themes/page.test.tsx`; `e2e/cust-hv-v1a-toolbar-reachability.spec.ts` (new).
**Docs** — this report + `cust-hv-v1a/` screenshots (JPEG).

## Tests

| Layer | Result |
|---|---|
| Focused (new) | toolbar structure/parity/keyboard **10** · Dropdown **3** · theme-gallery honesty **4** · MobileMenu links **4** · layout parity **1** |
| Red-without-fix proof | layout parity test fails (`undefined` vs list) with `layout.tsx` reverted; baseline geometry probe reproduced the V0 findings (AR 390–1024 and EN 390–1024 Publish off-screen) before any change |
| Storefront | biome ✓ · `tsc` ✓ · vitest **131 files / 1016 tests** ✓ · `pnpm build` ✓ |
| Web | vitest **407 files / 3365 tests** ✓ (re-run after the final Dropdown change) · `next build` incl. TS ✓ |
| Playwright (real Chromium, repo config) | `cust-hv-v1a-toolbar-reachability.spec.ts` **41/41**: **36 geometry cases** (6 widths × AR/EN × clean/dirty/conflict — Exit/Save/Publish fully inside the viewport, no overlap, ≥36/40 px tall, toolbar not horizontally scrollable, status perceivable, conflict banner visible), keyboard (Enter opens · Tab reaches item · Esc closes and returns focus), RTL menu inside viewport, 768 device-switch-from-More drives the Canvas, Schedule dialog opens from More, 1024/1440 tier checks |
| CI | PR #1252 checks — see PR (not polled in a loop) |

Not run: PHP/Laravel suite — no backend file changed.

## Visual / responsive evidence

`docs/plans/store/cust-hv-v1a/` (42 JPEGs): `{ar,en}-{390,430,768,1024,1280,1440}-{clean,dirty,conflict}.jpg` (toolbar + banner + canvas head), `*-more-open.jpg` (AR/EN × 390, AR 768, EN 1024/1440), `ar-768-schedule-from-more.jpg`. Before-state is the V0 baseline (`cust-hv-v0-baseline/`, `CUST-HV-V0-BASELINE-VISUAL-EVIDENCE-REPORT.md` §3.1). **AR RTL** and **EN LTR** are both asserted in every geometry case (`dir` attribute checked); the storefront mobile-menu links are covered by component tests (the V0 report notes the menu sheet cannot be opened under browser automation in that stack).

## Design Quality Pass

Primary action clear (Publish filled, Save outlined, never moved) ✓ · Canvas dominance unchanged ✓ · grouping: identity/context left, actions right, rare actions in More ✓ · mobile: 40 px targets, version button + More fit at 390 ✓ · 768: bar fits with version readable; **the missing editing surface at 768 is DEF-7 / V1B and is untouched** · long labels: EN "Exit to Commerce" and "Store Experience Builder" — at EN 1280 the title truncates with an ellipsis (tooltip carries the full text); acceptable, revisit in V1B/V5 with the toolbar restyle · motion: existing 150 ms menu fade only · keyboard/focus ✓ · merchant terminology: "More actions", "View published store".

## Safety

- **Tenant isolation / RBAC / auth:** no backend, route, permission or data-access change. Toolbar actions call the same handlers with the same disabled conditions.
- **Draft vs Published:** unchanged. The theme page text describes existing behaviour (Apply → new Draft Version). Published reads still require the same flow.
- **Revision / concurrency:** `selectedVersion.revision` save path, 409 conflict state, stale-response guards and publish-head checks untouched; conflict state is now covered end-to-end in the harness.
- **Media ownership:** not applicable (no media change).
- **Commerce / accounting truth:** none touched.
- **Backward compatibility:** storefront links: absent list ⇒ identical menu. `DropdownItem` additions are optional props; items that do not opt in keep `role="menuitem"` (asserted). Absent design settings: no visual-contract work in this slice.
- **Frozen V0 invariants:** none reinterpreted; no arbitrary CSS/JS/HTML, no free positioning, no new infrastructure.

## Review findings / observations (not fixed — out of V1A scope)

1. **Shared `Dropdown` + `mobilePopover` + `align="end"` is broken in RTL at ≥ lg** (`lg:!left-auto` cancels logical `end-0`; the menu landed ~200 px off-screen). The new More menu deliberately uses plain absolute placement; about 15 other call sites use `mobilePopover` (`notification-bell`, `pos-topbar`, `action-group`, invoices/products/accounts pages…); **which of them are end-aligned and visible at ≥ lg in RTL was not audited here**. Left unfixed (shared component, wider blast radius than V1A) — recommended as a separate small fix.
2. **Escape does not close the mobile inspector bottom sheet** (only its "×" does) — keyboard gap in the V5/V1B inspector surface.
3. Dev harness at 390: pre-existing 1 px document overflow from the canvas notice text (also present on unmodified `main`).
4. Dev-mode Next overlay ("3 Issues": a malformed SVG path, dotted i18n keys in `appBuilder.*`/`developer.*`) is unrelated to this slice and pre-existing.
5. **External evidence gate (V0 §21.3):** the Salla/Daftra pages were **not re-fetched** for V1A — it adds no product behaviour derived from competitors (defect fixes only). Relevant standing evidence is V0 §21.2 (*Theme / template*: Preview → Apply, Apply creates a new Draft; *Menus*: parity of items across devices). Adopted/changed/rejected: nothing new. Flagged for transparency rather than silently skipped.

## Risks / deferred

- More tier thresholds are CSS breakpoints, deliberately simple; a very long locale string could still squeeze the flexible middle (it truncates; primaries stay). The geometry spec is the permanent guard (V0 §20.1 *Longevity*): V1B/V5 may restyle/relocate the toolbar but must keep it green.
- DEF-7 (768 editing surface), BL-4 (1024 Canvas width), DEF-2, DEF-6 → **V1B**, co-designed with V5.

## Status

- **Merge: NOT PERFORMED**
- **Deploy: NOT PERFORMED**
- **Production release: NOT PERFORMED**

## Next dependency-safe slice

V2 (Media Foundation), V3 (Announcement Bar) and V5 (Section Visual Contract / Inspector) all depend only on V0. **V2 first-step gate:** inspect the merged Product Media derivative architecture (AWJ-PRODUCT-MEDIA-3A.2/-4) and open PR #1247, and reuse that imaging path — STOP and report if #1247 materially conflicts. V1B closes together with V5.
