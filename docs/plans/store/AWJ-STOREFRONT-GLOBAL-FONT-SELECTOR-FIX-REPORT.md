# AWJ Storefront — Fix Global Font Selector — Report

| | |
|---|---|
| **Branch** | `fix/storefront-global-font-selector` |
| **Base SHA** | `55f687551dcc9ce712ca08217236add581cf5ae0` (`main`, includes #1681) |
| **Head SHA / PR** | see the PR (this report is part of the head commit) |
| **Merge / Deploy** | NOT PERFORMED |

## 1. Root cause

PR #1681 extended the catalogue behind **Heading font / Body font** (`typography.headingFamily` / `bodyFamily`), but the main
**Typography** selector in the Design panel writes a different, older field: the persisted `fontPreset`. That field was a closed
two-value enum, duplicated in four places:

| Layer | Where | Was |
|---|---|---|
| Authority (validation on save/publish) | `StorefrontPresentationNormalizer::FONT_PRESETS` | `['cairo-geist','tajawal-geist']` |
| Selector options (Customizer) | `FONT_PRESETS` in `web/.../presentation/tokens.ts` | the same two |
| Selector options (storefront customizer mirror) | `FONT_PRESETS` in `storefront/src/lib/presentation/tokens.ts` | the same two |
| Resolver (published + Canvas) | `fontPresetFamilyStack()` | `tajawal-geist` ? Tajawal stack : Cairo stack |

So a new key could neither be offered nor survive normalisation (it fell back to `cairo-geist`).

## 2. The fix (single source of truth)

`fontPreset` now accepts **any key of the font catalogue** introduced in #1681 — no second list.

- **PHP:** `StorefrontPresentationNormalizer::FONT_PRESETS = StorefrontGlobalTokensNormalizer::FONT_FAMILIES` (one authority; the
  fail-closed default stays `cairo-geist`).
- **TS twins (`tokens.ts` ×2):** `FONT_PRESETS` is derived from `FONT_CATALOGUE`; `FontPresetId = FontFamilyKey`;
  `fontPresetFamilyStack(id)` = `fontFamilyStack(id) ?? <Cairo stack>`. The two legacy keys resolve to the **exact same stacks as before**
  (test-pinned), and keep their localised labels ("Cairo + Geist", "Tajawal + Geist"); the others show the catalogue's proper-noun name.
- **Selector (`ControlPanels.tsx` ×2):** the font `<option>` shows the localised label for the legacy two, the catalogue name for the rest.
- **Nothing else changed:** same field, same document version (3), same API, no migration.

Result — the selector now lists 15 fonts: Cairo + Geist, Tajawal + Geist (unchanged, first), IBM Plex Sans Arabic, Noto Sans Arabic · Inter,
Readex Pro, Rubik, El Messiri, Amiri · Lora, Almarai, Alexandria, Noto Kufi Arabic, Reem Kufi, **Thmanyah Sans, Thmanyah Serif Display,
Thmanyah Serif Text**.

## 3. How the selection reaches the storefront (unchanged mechanism)

`fontPreset` → `publishedThemeStyle()` sets `fontFamily` on the single theme wrapper that contains the header/navigation, category rail,
cards, buttons, PDP, cart and checkout; descendants inherit it. The Canvas root does the same (`StorefrontPreviewCanvas`). **Precedence is unchanged:**
`typography.bodyFamily` (explicit) > `fontPreset` (global) > Cairo default; `typography.headingFamily` still styles h1–h3 independently.
Fonts load only when used (`preload: false`), so selecting one never loads the others.

## 4. Backward compatibility and isolation

- Existing stores: stored `cairo-geist` / `tajawal-geist` values validate and render exactly as before; documents without `fontPreset` still default to
  `cairo-geist`. No store's selected font is altered, no field is added to existing documents (`pre-hv-golden` and the PHP fixtures are green).
- Unknown values (including `thmanyah-mono`) still fail closed to `cairo-geist`.
- Tenant isolation: `fontPreset` lives in each store's own presentation document; no shared state, no new storage or route.
- ERP/accounting dashboard typography (`web/src/app/layout.tsx`) is untouched. Other `fontPreset` consumer: the App Builder only copies the string into
  `theme.tokens` (free-form); not changed.

## 5. Changed files

| File | Change |
|---|---|
| `app/Support/Commerce/StorefrontPresentationNormalizer.php` | `FONT_PRESETS` = catalogue constant |
| `web/src/modules/store-experience-builder/presentation/tokens.ts` | `FONT_PRESETS` from catalogue; resolver via `fontFamilyStack` |
| `storefront/src/lib/presentation/tokens.ts` | same (twin) |
| `web/src/modules/store-experience-builder/ControlPanels.tsx`, `storefront/src/components/customizer/ControlPanels.tsx` | option label (legacy label or catalogue name) |
| `web/src/app/dev/customizer-visual/page.tsx` | dev-only fixture: optional `?fontPreset=` query (used by the browser test) |
| `web/e2e/typography-global-font.spec.ts` | new real-browser proof (29 tests) |
| tests: PHP normalizer test; storefront `config` / `font-catalogue` / `public` / `tokens` / customizer `ControlPanels.typography`; web `presentation`, `ControlPanels.typography`, `StorefrontPreviewCanvas.typography` | updated + new cases |
| `docs/plans/store/typography-global-font/*.png`, this report | evidence / docs |

## 6. Tests and results

| Check | Result |
|---|---|
| Laravel (`nibras-app`, SQLite): `StorefrontPresentationNormalizerTest`, `StorefrontGlobalTokensTest`, `PreHvBackwardCompatibilityTest`, `ButtonTokensPublishGateTest` | 61 passed |
| Laravel broader (`Presentation|StorefrontGlobal|StorefrontCustomizer|PreHv`) | 379 passed, 2 failed — both in `CommerceApiOpenApiContractTest` (order creation returns 500); **identical failure with the original `main` normalizer restored**, i.e. pre-existing/environmental (this container lacks `bcmath`), unrelated |
| Storefront vitest (presentation + components + app) | 2481 passed, 16 skipped; presentation + customizer re-run after final edits: 1567 passed |
| Web vitest `store-experience-builder` | 3016 passed (159 files); typography/themes/presentation re-run after final edits: 287 passed |
| **Real Chromium** (`typography-global-font.spec.ts`, desktop project) | **29 passed**: 7 new fonts × {AR, EN} × {desktop 1280, mobile 390} — wrapper stack, inherited button/heading stack, and the actual `next/font` face is loaded; plus "explicit body family wins" and "default store keeps Cairo + Geist" |
| Storefront `tsc` / `biome`, `next build` | clean / compiled successfully |
| Web `next build` | compiled successfully; `tsc` shows only pre-existing errors in untouched test files |
| Visual evidence | `docs/plans/store/typography-global-font/` — default (Cairo) vs Thmanyah Serif Display AR 1280, Thmanyah Sans EN 390: nav, search, buttons, cards, headings all switch |

Save/reload/publish: the value is a normalised field of the existing presentation document, so the existing draft/publish round-trip carries it
(PHP normalizer round-trips each new key; TS normaliser mirrors it). A live save/publish against a deployed backend was **not** exercised from here —
verify on staging after the backend deploys.

## 7. Risks and notes

- **Deploy order matters:** backend first (so `fontPreset: "thmanyah-*"` survives normalisation), then storefront/web. An older backend would silently
  turn a newly chosen key back into `cairo-geist` on save.
- **Rollback:** a store that picked a new global font and is rolled back to older code falls back to Cairo + Geist; nothing else changes.
- **Thmanyah licence:** unchanged from #1681 — shipped on the owner's responsibility without a written exception on file (see
  `AWJ-STOREFRONT-TYPOGRAPHY-LIBRARY-EXPANSION-REPORT.md` §4).
- Two selectors still exist (global font, and heading/body overrides) with the existing precedence; unifying them would be a larger UX change and is out of scope.
- The selector label stays "Typography"/"الخط" — unchanged.

## 8. Next action

Merge/deploy backend → frontends (requires explicit approval), then smoke on staging: choose Thmanyah Sans as the global font, save, publish, and
load the public store in AR/EN on desktop and mobile; request the written Thmanyah exception.
