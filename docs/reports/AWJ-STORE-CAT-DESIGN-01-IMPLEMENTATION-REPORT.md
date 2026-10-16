# AWJ-STORE-CAT-DESIGN-01 — Implementation Report

Category section design controls for the AWJ Store homepage (`التصنيفات` / `تسوّق حسب القسم`).

| | |
|---|---|
| **Status** | Implemented on a feature branch, PR open for review. **Not merged, not deployed.** |
| **Branch** | `claude/ecstatic-curie-yeo8nd` |
| **Base SHA** | `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5` (`origin/main`, "refine AWJ Core-Dark shell (#1539)") |
| **Head SHA / PR** | See §14 — PR #1542 |
| **Scope owner decisions needed** | 3 — see §12 (extra Canvas media route · px values vs named steps · route allow-list entry) |

---

## 1. Discovery summary (what the repository actually did before this task)

The screenshots in the brief were a product brief, so behaviour was verified in code first.

| Finding | Evidence |
|---|---|
| The categories section had **no section-specific settings at all**. Storefront `CategoriesSection.tsx` rendered one fixed tile (accent edge, 80 px picture, bold two-line name, optional sub-category count) in a fixed grid (2/3/4/6 columns, Market 3/4/6/8), capped at 12 (Market 18). | `storefront/src/components/home/CategoriesSection.tsx`; goldens in §6 |
| The only things a merchant could set were the generic `section.design` groups (`background`, `text.heading`, `typography.headingStyle`, `width`, `spacing`, `border`, `radius`, `separator`) which style the **section frame**, not the cards. Content tab said "managed section". | `SECTION_DESIGN_CAPABILITIES.categories`, `ControlPanels.tsx` |
| Section settings live in the versioned presentation document (`homepage.sections[]`, version 3). `design` is normalized by **three byte-twin normalizers** (PHP authority `StorefrontSectionDesignNormalizer` + `web` and `storefront` `section-design.ts`) pinned by `tests/Fixtures/presentation/section-design.json`. | files above |
| Draft / publish: draft in `draft_config`, published snapshot read host-resolved by `/store/v1/storefront`; saving normalizes and **never 422s on content** (VD-4a owner decision 4: clamp integral numbers, drop anything else). | `StorefrontPresentationDraftApiTest`, `…PublicRuntimeTest`, `AWJ-VD-4A-IMPLEMENTATION-REPORT.md` |
| Existing "preset" mechanism = `sectionPresetsFor(type)` in the generic Design inspector (replaces the whole `design`); copy/paste/reset also operate on `design`. | `themes/section-presets.ts`, `design/DesignInspector.tsx`, `design/design-clipboard.ts` |
| Canvas (merchant preview) was a **separate mock** of the tile (names only, Tailwind classes resolved from the simulated viewport), fed by a workspace categories read that returned `id` + `name` only — **no pictures, no colour**. | `StorefrontPreviewCanvas.tsx`, `CommerceWorkspaceStorefrontCategoryController` |
| Closest precedent: `discovery` display settings (VD-4a/b/c) — optional typed keys, clamp-or-drop numbers, byte-identical twins, native scroll-snap carousel, `--store-scrim` token pair. Re-used wherever possible. | `AWJ-VD-4A/4B/4C-IMPLEMENTATION-REPORT.md` |
| Latest related report: `CUST-H4-CLOSURE-REPORT.md` (categories LIVE end-to-end with Canvas↔Published parity on *data*); CUST-H4-3 had explicitly left category pictures out of the Canvas. | `docs/reports/` |

**Schema / migration requirement: none.** Everything is an additive optional group inside the existing `section.design` JSON (schema version stays 3). No table, column, or catalogue data is touched.

---

## 2. What was implemented

### Slice A — contract (`design.display`, categories only)
* New optional group **`design.display`** on `categories` sections: `layout`, `columns`, `gap`, `itemWidth`, `card`, `image`, `name` (full table in §4).
* **`layout` gates the group**: without a valid layout the whole group is dropped (no inert metadata). **Absent display = the classic tile, byte for byte.**
* Implemented in PHP (authority) and both TS twins, pinned by 20 new cases in the shared fixture (180 cases now green in PHP, web, storefront).

### Slice B — storefront renderer
* `categories-display.ts` (twin) — pure resolver: layout defaults, which placements/shapes each layout supports, overlay-needs-backing rule, per-device CSS custom properties, RTL-aware picture position, fallback swatch with ≥ 4.5:1 initial colour.
* `CategoryDisplayList.tsx` (twin) — **one view for storefront and Canvas** (`next/link` + `next/image` in the storefront; a non-navigating tile + `<img>` in Canvas), over one plain-CSS stylesheet `categories-display.css` (twin; Tailwind 3 and 4 both cannot differ because it is not Tailwind).
* Five layouts: `grid`, `horizontal_scroll` (native scroll-snap; focus-reveal via the existing `CarouselRail`), `circles`, `image_tiles`, `compact_list`.
* Wired through `published-nodes.tsx` (`cloneElement`, like the shelf layout) into `CategoriesSection`; classic path untouched.

### Slice C — editor + Canvas
* `CategoriesDisplayFields` in the **التصميم** tab above the generic inspector, in five disclosure sub-panels: **طريقة العرض · البطاقة · الصورة · الاسم · التجاوب**; contextual (nothing but the layout until a layout is chosen; scrolling layouts get item width, not columns; border colour only when there is a border; aspect disabled where the shape decides it; overlay name cannot lose its backing; name colour automatic on a scrim).
* Four presets (**Elegant cards, Circular categories, Compact, Image tiles**) that replace only `design.display`; dirty-state line ("edited from preset"), "back to classic" button.
* Canvas renders the chosen display with the **same resolver, view and stylesheet**, pinned to the simulated device; classic preview untouched when no display.
* Canvas now shows the merchant's real category pictures and colours (see §5 — backend addition).
* Existing behaviours kept: draft save, publish, undo/redo (every change is a normal section edit), copy/paste design, design reset (resets the display with the rest of the design — one confirmed reset), generic frame presets (**now preserve** `display`; they used to replace the whole design).

---

## 3. Files changed

**Backend (PHP)**
`app/Support/Commerce/StorefrontSectionDesignNormalizer.php` (+group) · `app/Http/Controllers/Api/CommerceWorkspaceStorefrontCategoryController.php` (opt-in `with_media`) · **new** `CommerceWorkspaceCategoryMediaController.php`, `ServesCategoryImageBytes.php` (trait extracted verbatim from `StorefrontMediaController::showCategory`, behaviour unchanged) · `StorefrontMediaController.php` (uses trait) · `routes/api.php` (+1 signed route).

**Storefront** — new `lib/presentation/categories-display.ts`, `components/home/CategoryDisplayList.tsx`, `categories-display.css`, `app/dev/categories-display-visual/{page.tsx,fixtures.ts}` (dev-only, 404 in production) · modified `section-design.ts`, `CategoriesSection.tsx`, `published-nodes.tsx`.

**Web** — new `presentation/categories-display.ts`, `CategoryDisplayList.tsx`, `categories-display.css` (byte twins), `CanvasCategoryDisplay.tsx`, `CategoriesDisplayFields.tsx`, `categories-display-edit.ts`, `categories-display-presets.ts`, `categories-display-messages.ts`, dev harness `app/dev/customizer-visual/category-fixtures.ts` · modified `section-design.ts` (twin), `StorefrontPreviewCanvas.tsx`, `ControlPanels.tsx`, `ExperienceBuilder.tsx`, `design/DesignInspector.tsx`, `messages.ts`, `commerce-workspace/workspace-categories.ts`, dev page `customizer-visual/page.tsx`.

**Tests / fixtures** — `tests/Fixtures/presentation/section-design.json` (+20 cases, capability snapshot), `tests/Feature/StorefrontCategoryDisplayTest.php`, `…/CommerceWorkspaceCategoryMediaApiTest.php`, `…/CommerceModuleBoundaryTest.php` (route allow-list), storefront `categories-display.test.ts`, `CategoriesSection.display.test.tsx`, `categories-display.css.test.ts`, `categories-legacy-golden.ts`; web `categories-display.test.ts`, `ControlPanels.categoriesDisplay.test.tsx`, `StorefrontPreviewCanvas.categoriesDisplay.test.tsx`, `workspace-categories.test.ts`, `ExperienceBuilder.homeCatalog.test.tsx`.

**Evidence** — `docs/reports/awj-store-cat-design-01-evidence/` (§9).

---

## 4. Settings schema, defaults and compatibility

`homepage.sections[type=categories].design.display` (canonical key order). Numbers: an integral JSON number is **clamped** into its range; anything else drops that key (never a 422). Colours: **theme tokens only** (no free hex ⇒ no contrast gate needed).

| Key | Values | Absent means |
|---|---|---|
| `layout` | `grid` · `horizontal_scroll` · `circles` · `image_tiles` · `compact_list` | **whole group dropped → classic tile** |
| `columns` `{mobile,tablet,desktop}` | 1–4 · 2–6 · 2–8 | layout default (grid 2/3/6 · tiles 2/3/4 · list 1/2/3) |
| `gap` `{m,t,d}` | 4–32 px | layout default (12 px; circles 16–20) |
| `itemWidth` `{m,t,d}` | 64–320 px (scrolling layouts) | scroll 140/160/180 · circles 88/104/120 |
| `card.style` | `none` · `border` · `shadow` (soft, fixed) · `filled` | layout default (border / circles & tiles: none) |
| `card.background` | `surface` · `muted` · `transparent` | implied by style |
| `card.borderColor` | `border` · `strong` · `primary` · `accent` | `border` |
| `card.borderWidth` / `radius` / `padding` | 0–4 / 0–32 / 0–32 px | style-implied / theme radius / layout default |
| `card.hover` | `none` · `subtle` (edge + tint, no motion) | none |
| `image.show` | only ever stored as `false` | visible |
| `image.shape` | `rect` · `square` · `circle` (per-layout subset) | layout default |
| `image.aspect` / `fit` / `position` | `1:1 4:3 3:2 16:9` / `cover contain` / `center top bottom start end` (start/end follow RTL) | `4:3` / `cover` / `center` |
| `image.height` `{m,t,d}` | 48–400 px (circle: diameter; list: thumbnail 32–96) | automatic (aspect ratio reserves space) |
| `name.show` | only ever stored as `false` | visible (forced visible if the image is also hidden) |
| `name.placement` | `below above overlay beside` (per-layout subset) | layout default |
| `name.align` / `size` / `weight` / `color` / `lines` / `background` | `start center end` / 12–32 px / 400–800 / `foreground muted primary` / `1 2 natural` / `none scrim surface` | layout default |

**Compatibility strategy.** The classic look is *the absence of the group* and is the default for every stored document — nothing silently switches live stores. Verified by byte-identity goldens (§6), a PHP document test, and `StorefrontSectionDesignTest`. The classic's sub-category count ("N sub-categories") is not part of the new layouts (see §11).

**Unknown / unrelated settings** are preserved by the existing serializer rules; `display` on any other section type is dropped (fixture cases).

---

## 5. Backend addition: signed category picture for the Canvas (needs your eye)

The Canvas's workspace categories read returned only `id`+`name`, and the picture route is host-resolved on the storefront domain (unreachable from a merchant `<img>`; the web app authenticates with a Bearer token, not a cookie). A faithful preview of `fit`/`position`/`shape` needs real pictures, so this slice mirrors the **CUST-H4-8b product-media trust model exactly**:

* `GET commerce/workspace/storefronts/{id}/categories?…&with_media=true` (**opt-in**; default payload unchanged and pinned by the existing test) adds `color` and `image_url` — a 20-minute `temporarySignedRoute`.
* New unauthenticated-by-design route `commerce/workspace/storefronts/{id}/category-media/{category}` behind `signed` only. It serves bytes only for a category that is **(a) of the storefront's tenant, (b) active, (c) published on that storefront's own sales channel** — else a uniform 404. Both queries bypass `TenantScope` explicitly and match tenant by hand; tenant context is set only for the R2 read and restored.
* Bytes come from the same code the public route uses (trait extracted verbatim; its existing tests pass unchanged).
* The storage path is never serialized.

Tested in `CommerceWorkspaceCategoryMediaApiTest` (10 tests): signed payload shape, minimal default shape, TTL, no-Authorization serving, cross-tenant, sibling channel, unpublished/inactive/no-image/unknown ids, unsigned/tampered/expired, list auth + foreign storefront, R2 under the right tenant, no tenant-context leak.

---

## 6. Tests run (exact commands and results)

| Scope | Command | Result |
|---|---|---|
| Contract, PHP | `php artisan test --filter=StorefrontSectionDesignTest` (via `setup.sh` copy in `nibras-app`) | pass, 180 shared-fixture cases |
| Contract, document / API / isolation | `--filter=StorefrontCategoryDisplayTest` | 6 passed (classic byte identity, firewall, never-422, draft→reopen→publish→public, no unpublished leak, tenant isolation, unauthenticated write rejected) |
| Backend media | `--filter=CommerceWorkspaceCategoryMediaApiTest` | 10 passed |
| Existing suites touching the same files | `--filter='StorefrontCategoryMediaTest\|CommerceWorkspaceStorefrontCategory\|CommerceWorkspaceMediaApiTest\|CommerceModuleBoundaryTest'` | all pass (after adding the new route to the allow-list) |
| Backend broad | `--filter='Storefront\|CommerceWorkspace\|Presentation\|Commerce\|Tenant\|Isolation\|BranchIsolationGuard'` | 2 921 passed, 41 skipped, 3 failed → `CommerceModuleBoundaryTest` (**fixed**, allow-list) + 2 `Fuel*` (pre-existing: `bcmath` not installed in the sandbox) |
| Backend full | `php artisan test` (sandbox copy built by `setup.sh`) | **7 239 passed, 139 skipped, 26 failed** — all 26 are `Fuel*` tests failing with `Call to undefined function App\Services\bcmul()` (PHP `bcmath` is not installed in the sandbox; the session hook warns about it; CI installs it). No failure outside `Fuel*`. |
| Storefront | `pnpm --dir storefront exec vitest run` | 208 files / 2 801 tests passed (re-run focused after the last fix: 52/52 in the two display files) |
| Storefront types / lint | `npx tsc --noEmit` · `npx biome check` on changed files | clean · clean (1 info: fragment in a test) |
| Web | `npx vitest run` | 633 files passed; **1 failure, fixed**: the semantic-token drift ratchet flagged palette classes in my dev harness → replaced with semantic classes; ratchet 3/3 green |
| Web types | `npx tsc --noEmit` | no errors in non-test source (test/e2e files carry pre-existing errors) |
| Build | `next build` (web) | **blocked by the sandbox**: `next/font` cannot fetch Google Fonts (no outbound network) — identical before my change; CI builds |

**Byte-identity goldens.** `CategoriesSection.display.test.tsx` compares `innerHTML` with goldens produced by rendering the **pre-change component from `origin/main`** (default theme and AWJ Market): equal.

**Matrix covered by tests:** each layout renders expected structure and exact links/order/cap; names visible/hidden with `aria-label`+`title` on the link; hiding the picture keeps the name, hiding both keeps the name; missing picture → fallback frame (valid hex only; hostile colour never reaches CSS); `cover`/`contain`/position CSS variables; long Arabic names (clamp, break); zero/one/many/20 categories; RTL vs LTR picture position; per-device column/gap/height overrides; clamping/invalid parameters; twins byte-identical (contract, resolver, stylesheet, view body); editor draft round trip; presets never touch content/label/order; frame presets keep the display; stylesheet contract (logical properties only, no raw colour, reduced-motion, contained scrolling, focus ring, 44 px).

---

## 7. Visual QA (real Chromium, real components, no backend)

Dev-only fixtures (404 in production, local SVG pictures — no network): storefront `/dev/categories-display-visual` mounts the storefront's real `CategoriesDisplayBlock`; web `/dev/customizer-visual?scenario=categories-display|categories-panel` mounts the real Canvas and the real `ControlPanels`.

* **45 cases × (storefront + Canvas)**: grid/scroll/circles/tiles/list at **390 / 768 / 1280**, Arabic RTL and English LTR, plus names hidden, overlay (scrim and surface), circular pictures, `contain`+`top`+3 px border, no-frame/name-above, custom per-device height, big names, picture hidden.
* **Parity**: column count, row count, item count identical in all 45; computed styles of card, frame, image, name and fallback identical except `img{color}` (`next/image` inlines `transparent`, irrelevant). See `parity-and-metrics.json`.
* **No page-level horizontal overflow** on the storefront in any case; scrolling layouts scroll natively (RTL `scrollLeft` goes negative, snap `x mandatory`, `overscroll-behavior-x: contain`).
* **Keyboard**: Tab through a 390 px rail in AR and EN — every focused tile ends fully visible (measured after smooth-scroll settles), solid focus outline. `prefers-reduced-motion`: `scroll-behavior: auto`, transition `0s`.
* **Bug found by the screenshots and fixed**: `line-clamp` on an element with vertical padding let a hidden third line peek through the scrim bar (image tiles, 390 px). The clamp now lives on an inner span; regression test added.
* **Editor**: classic → preset → all groups → tiles → circular+tablet, AR/EN, desktop and 390 px.

---

## 8. RTL / mobile / accessibility / security assessment

* **RTL/LTR**: logical properties only (stylesheet test); picture `start`/`end` resolve per `dir`; rail starts at the inline-start edge; both languages screenshot-verified.
* **Mobile/touch**: native scrolling rails, 44 px targets, no overflow; Canvas pinned to the simulated device because host media queries would be wrong inside the builder.
* **Accessibility**: one link per tile; visible name is the accessible name; hidden name → same name as `aria-label` + `title`; pictures `alt=""` (name always present); fallback frame `aria-hidden`; visible focus ring; reduced motion; overlay text always on the contrast-proven scrim (white on 72 % black ≈ 9.3:1 over white, asserted) or a themed surface; fallback initial colour is white or black chosen by luminance (≥ 4.5:1 for every colour, asserted). **No screen-reader pass was possible in the sandbox.**
* **Security / tenant isolation**: no raw merchant text becomes CSS (enums, bounded integers, fixed token strings; merchant colour validated as hex); no new tenant-scoped read except the signed media route reviewed in §5; presentation read/write authorization and publish permissions are unchanged and re-asserted (draft never public, foreign tenant 404, anonymous write 401). Commerce firewall: none of the new keys is a denied word.
* **Performance**: no new dependency; aspect-ratio reserves space (no CLS); same `next/image` pipeline (`unoptimized`, same-origin proxy) as before; `sizes` derived from the columns.

---

## 9. Evidence
`docs/reports/awj-store-cat-design-01-evidence/` — `storefront/` (45 published renders), `canvas/` (Arabic Canvas renders), `editor/` (panel + Canvas), `behaviour/` (keyboard focus and scrolled states), `parity-and-metrics.json`, `keyboard-and-scroll.json`.

---

## 10. Not implemented (explicitly)
* Free hex colour pickers for card background / border / name (needs a contrast gate; theme tokens only for now).
* A second picture source, category selection / ordering / limit controls (the content tab is unchanged by design).
* In-panel mini preview (the Canvas, with its device switch, is the live preview; on phones the panel is a bottom sheet over it).
* Dark mode for the storefront (out of scope per D-13).

## 11. Risks and known limitations
* The classic "N sub-categories" line is not drawn by the new layouts.
* Home Canvas previews at most 12 categories (existing H4-3 limit); AWJ Market storefront shows up to 18.
* Pre-existing, not touched: 1 px page overflow in the EN Canvas harness (also in the existing `populated` scenario), three `IntlError INVALID_KEY` console messages from unrelated app-builder keys.
* Publish-time contrast: not needed for `display` (tokens only) — revisit if free colours are added.

## 12. Decisions for the owner
1. **Pixel values** (radius 0–32, padding 0–32, gap 4–32, font 12–32, border 0–4, height) follow the task, but V0 §5.2 says global tokens are *named steps only, never a pixel input*. I kept them bounded and clamp-or-drop (the VD-4a rule). Alternative: named steps. Cheap to change (normalizers + one control).
2. **Canvas picture route** (§5): additive and modelled on H4-8b, but it is a new unauthenticated-by-design signed route. Alternative: ship without pictures in the Canvas (fallback frames only) and drop §5.
3. **`CommerceModuleBoundaryTest` allow-list** now contains `…/category-media/{category}` — a deliberate governance edit that needs a reviewer's explicit nod.

## 13. Next recommended action
Review §12, then merge-gate on CI (sqlite + pgsql + Web CI + Storefront CI). Afterwards: free-colour controls with a publish-time contrast gate, and the sub-category count as an optional `name` meta line.

## 14. Final state

| | |
|---|---|
| Branch | `claude/ecstatic-curie-yeo8nd` |
| PR | [safwan5001-source/Nebrax#1542](https://github.com/safwan5001-source/Nebrax/pull/1542) — open, ready for review, **not merged** |
| Base SHA | `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5` |
| Head SHA (code) | `c2c651c4a825543e2c6a7263b8bdc90cf50432f4` (a follow-up docs-only commit adds this section) |
| CI | Not yet observed at the time of writing — check the PR's checks (sqlite + pgsql, Web CI, Storefront CI). |
| Deployed | No. |
