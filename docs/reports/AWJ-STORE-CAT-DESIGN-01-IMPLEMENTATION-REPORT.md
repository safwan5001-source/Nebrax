# AWJ-STORE-CAT-DESIGN-01 — Implementation Report

Category section design controls for the AWJ Store homepage (`التصنيفات` / `تسوّق حسب القسم`).

| | |
|---|---|
| **Status** | Implemented; owner review round applied; CI green on the code head. PR open. **Not merged, not deployed.** |
| **Branch** | `claude/ecstatic-curie-yeo8nd` |
| **Base SHA** | `5fb6f2331cc82e2d37dce6d79e512658e7cd834c` (`origin/main` at review time — merged into the branch, clean, no conflicts). Original base: `a2d2fcb7f83cfaa8cb361eb2744de7fc649393e5`. |
| **Head SHA / PR** | See §14 — PR #1542 |
| **Owner decisions** | Both resolved in the review round (§12): signed picture route approved conditionally; bounded pixel values approved with easy defaults + advanced control. |

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

## 5. Backend addition: signed category picture for the Canvas (approved conditionally — see §15)

The Canvas's workspace categories read returned only `id`+`name`, and the picture route is host-resolved on the storefront domain (unreachable from a merchant `<img>`; the web app authenticates with a Bearer token, not a cookie). A faithful preview of `fit`/`position`/`shape` needs real pictures, so this slice mirrors the **CUST-H4-8b product-media trust model exactly**:

* `GET commerce/workspace/storefronts/{id}/categories?…&with_media=true` (**opt-in**; default payload unchanged and pinned by the existing test) adds `color` and `image_url` — a 20-minute `temporarySignedRoute`.
* New unauthenticated-by-design route `commerce/workspace/storefronts/{id}/category-media/{category}` behind `signed` only. It serves bytes only for a category that is **(a) of the storefront's tenant, (b) active, (c) published on that storefront's own sales channel** — else a uniform 404. Both queries bypass `TenantScope` explicitly and match tenant by hand; tenant context is set only for the R2 read and restored.
* Bytes come from the same code the public route uses (trait extracted verbatim; its existing tests pass unchanged).
* The storage path is never serialized.

Tested in `CommerceWorkspaceCategoryMediaApiTest` (16 tests after the review round; the negatives are listed in §15): signed payload shape, minimal default shape, TTL, no-Authorization serving, cross-tenant, sibling channel, unpublished/inactive/no-image/unknown ids, unsigned/tampered/expired, list auth + foreign storefront, R2 under the right tenant, no tenant-context leak.

---

## 6. Tests run (exact commands and results)

| Scope | Command | Result |
|---|---|---|
| Contract, PHP | `php artisan test --filter=StorefrontSectionDesignTest` (via `setup.sh` copy in `nibras-app`) | pass, 180 shared-fixture cases |
| Contract, document / API / isolation | `--filter=StorefrontCategoryDisplayTest` | 6 passed (classic byte identity, firewall, never-422, draft→reopen→publish→public, no unpublished leak, tenant isolation, unauthenticated write rejected) |
| Backend media | `--filter=CommerceWorkspaceCategoryMediaApiTest` | 16 passed (10 first round + 6 security negatives) |
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
* **Parity**: column count, row count, item count identical in all 45; computed styles of card, frame, image, name and fallback identical except `img{color}` (`next/image` inlines `transparent`, irrelevant). See `parity-and-metrics.json` (condensed, §18).
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

## 12. Owner decisions (resolved in the review round)

1. **Signed category-picture route — approved conditionally** (verify tenant isolation, signature, authorization; deny unauthorized access; add negative security tests). Done — see §15.
2. **Bounded pixel values — approved, with easy defaults and an advanced control, without changing the architectural contract.** Done — see §16. The stored contract is unchanged (plain bounded integers, clamp-or-drop); only the editor changed.
3. `CommerceModuleBoundaryTest` allow-list entry for `…/category-media/{category}` remains a governance edit for the reviewer to acknowledge (it is the intended, minimal change; the test otherwise fails by design on any new Commerce route).

## 13. Next recommended action
Review §12, then merge-gate on CI (sqlite + pgsql + Web CI + Storefront CI). Afterwards: free-colour controls with a publish-time contrast gate, and the sub-category count as an optional `name` meta line.

## 14. Review round (PR #1542) — what was checked and changed

### 14.1 CI on the head SHA
Head `94d15c730ae97783c1caf2ae602744deaf6d88b0` (the branch merged with the latest `origin/main` `5fb6f23`; the merge was conflict-free):

| Check | Result |
|---|---|
| php artisan test (L11, sqlite) | success |
| php artisan test (L11, pgsql) | success |
| web build (Next.js) — push and PR runs | success |
| storefront (lint + typecheck + test) — push and PR runs | success |
| merchant preview visual QA / published footer visual QA | success |
| CI Gate | success |

The first run on the earlier head `5e10d42` also had web build, storefront and visual QA green; its PHP jobs were superseded by the new head. **No CI failure occurred on this PR, so no unrelated or related failure needed fixing.** The earlier local-only failures were environmental (sandbox: no `bcmath`, no Google Fonts for `next build`) and do not occur in CI — the web build the sandbox could not run is now proven by CI.

### 14.2 Local verification on the merged tree
| Scope | Result |
|---|---|
| Web `vitest run` (full) | 635 files / **7 404 tests passed**, 0 failed (includes the design-drift ratchet) |
| Storefront `vitest run` (full) | 208 files / **2 802 tests passed**, 15 skipped (pre-existing skips) |
| PHP focused (`StorefrontSectionDesign`, `StorefrontCategoryDisplay`, `CommerceWorkspaceCategoryMedia`, `CommerceModuleBoundary`, `StorefrontCategoryMedia`, `CommerceWorkspaceStorefrontCategory`, `StorefrontCommerceFirewall`, `StorefrontPresentation*`) | 372 passed, 1 skipped |
| Earlier PHP full run (pre-merge) | 7 239 passed; 26 failed, all `Fuel*` / `bcmath` (sandbox only); CI is green for the whole suite |
| Biome (storefront) | no errors on changed paths |

### 14.3 Existing settings and published stores are unaffected
* Classic look = absence of `design.display`. Byte-identity goldens (default theme and AWJ Market) rendered from the **pre-change component on `main`** still pass after every change in this round.
* `StorefrontSectionDesignTest` (180 shared-fixture cases), `StorefrontCategoryDisplayTest` (legacy document byte identity, default document has no `design`), the pre-HV golden, v1 default and unsafe-input fixtures, and the commerce firewall all pass in PHP, web and storefront.
* A display on any other section type is dropped; a display without a valid `layout` is dropped — a stale or hand-written document cannot switch a live store to a new look.
* The default workspace categories payload is unchanged (`with_media` is opt-in; the existing shape test passes untouched).
* The one behaviour change to an existing editor control is intentional and tested: the generic frame presets now **preserve** `design.display` instead of wiping it.
* Only change to a default value inside the new feature: the Image-tiles name size default 15 → 16 px (so a fresh layout lands on a named step). It affects only documents that already carry a display, i.e. none in production.

### 14.4 Preview data cannot reveal categories the storefront may not show
The Canvas list is the workspace categories read, already gated by `commerce.manage`, subscription, `ownedStorefront()` and `publishedCategoryIds(storefront.sales_channel_id)`; `with_media` only adds `color` and a signed URL to the rows that already passed those gates. Tests assert that with `with_media` the list returns **only** the published, active, own-tenant, own-channel category — unpublished, inactive, other-channel and other-tenant categories (and their picture URLs) are absent from the body.

## 15. Security: negative tests added for the signed category-picture route

`CommerceWorkspaceCategoryMediaApiTest` now has 16 tests (was 10). New negatives:

| Threat | Test |
|---|---|
| Minting URLs without permission | `self_service`, `staff` (no `commerce.manage`) and an expired subscription get 403 and the body contains no `signature` |
| Leaking unpublished / inactive / other-channel / other-tenant categories through the preview list or their picture URLs | list contains exactly the visible category; hidden names and URLs are absent |
| Re-using a signature | swapped storefront id, swapped category id, extra query parameters (`path=../../etc/passwd`, `disk=local`) and an extended `expires` all return 403 |
| A signature as a standing grant | the same valid URL returns 404 as soon as the category is unpublished, or deactivated |
| Wrong verbs / hostile ids | POST, PUT, PATCH, DELETE → 405; non-UUID ids (including `../../etc/passwd`) → 404 even under a valid signature |
| Existence oracle | a foreign category and a non-existent one return the same status and message |
| Cache / cookie hygiene | no `Set-Cookie`; `Cache-Control` is `private`, never `public` |

Already covered in the first round: unsigned, tampered and expired URLs; another tenant's category under a valid signature for this storefront; sibling channel; no-image and unknown ids; unauthenticated and foreign-storefront list calls; R2 read under the storefront's own tenant with no tenant-context leak; the signed URL's 20-minute lifetime.

**Verified properties:** tenant isolation (explicit `tenant_id` match with `TenantScope` bypassed on purpose, because the request is unauthenticated); signature (Laravel `signed`, bound to storefront id, category id, expiry and every query parameter); authorization of minting (`commerce.manage` + subscription + owned storefront); no storage path in any response.

**Residual risks (accepted, documented):** the signed URL appears in the merchant's own browser requests and may be logged by proxies for its 20-minute life; the route has no per-IP throttle (identical to the existing product-media route — a global throttle would be a separate, cross-route decision).

## 16. Pixel values: easy first, exact on demand
The contract is unchanged (bounded integers, clamp-or-drop; PHP/web/storefront normalizers and fixture untouched in this round). The editor now offers:
* **Named steps first** — card radius (Square 0 · Small 8 · Medium 12 · Large 16 · X-large 24 · Round 32), inner padding (None 0 · Tight 8 · Normal 12 · Roomy 20), name size (Small 13 · Normal 14 · Large 16 · X-large 20), card gap for all devices at once (Tight 8 · Normal 12 · Loose 20). A step writes the plain pixel number.
* **Advanced** — a keyboard-operable disclosure (`aria-expanded` / `aria-controls`) with the exact bounded control (slider + typed value committed on blur/Enter, per-value reset); gap offers per-device pixels there. It opens by itself when the current value is not a named step, and says so ("Custom value"), so nothing is ever hidden.
* Every layout default and every preset lands on a named step; per-device columns, border width and picture height keep their direct controls (their ranges are small).
* Tests: steps write exact pixels, advanced collapsed/auto-open, disclosure semantics, gap-all-devices + per-device override marks custom, defaults and presets never show "custom". Evidence: `awj-store-cat-design-01-evidence/editor/editor-steps-advanced__{ar,en}__desktop.png`.

## 17. Final state and remaining risks

| | |
|---|---|
| Branch | `claude/ecstatic-curie-yeo8nd` |
| PR | [safwan5001-source/Nebrax#1542](https://github.com/safwan5001-source/Nebrax/pull/1542) — open, ready for review, **not merged, not deployed** |
| Base SHA | `5fb6f2331cc82e2d37dce6d79e512658e7cd834c` (`origin/main`; original base `a2d2fcb`) |
| Head SHA (CI-verified code) | `94d15c730ae97783c1caf2ae602744deaf6d88b0` — all checks green. A later docs-only commit records these results (no code change; re-run CI is not expected to differ). |

Remaining risks / items for the reviewer:
1. The signed-URL residual risks in §15 (log exposure for 20 minutes; no throttle on the route).
2. The route allow-list edit in `CommerceModuleBoundaryTest` needs an explicit acknowledgement.
3. The classic "N sub-categories" line is not drawn by the new layouts; free colour pickers (needing a contrast gate) and an in-panel mini preview are not implemented.
4. No screen-reader (assistive technology) pass was possible; keyboard, focus, contrast, RTL and reduced-motion were verified in a real browser.
5. Web vitest has no dedicated CI job (the web CI job is the Next.js build); the full web suite was run locally (7 404 passed).

## 18. PR size review (before merge)

**Evidence file.** `parity-and-metrics.json` was a raw dump of 45 cases × 5 elements × 21 computed-style properties for both renderers: **10 675 lines / 271 KB — 53 % of the PR's added lines**. It was condensed to **92 lines / 10.6 KB**, keeping what proves Canvas ↔ storefront parity: per case, item/column/row counts and page overflow for both renderers, the first item's size, and the list of computed-style differences (only `img.color`, 43 cases — `next/image` inlines `transparent`); plus a summary of which elements and properties were compared. The raw dump is regenerable from the two dev fixtures and was not referenced by any test or doc.

**`CategoriesDisplayFields.tsx` (1 216 lines) — not split.** It is one panel: generic controls (`Group`, `Choice`, `Switch`, `NumberControl`, `StepControl`, `GapControl`) followed by the panel body. No duplicated logic, no mixed responsibilities, no state shared across files, and its size is in line with its sibling `DiscoveryDisplayFields.tsx` (967 lines). A split now would only add imports and risk the tested behaviour; revisit if a second panel needs the primitives.

**Twin drift is already guarded and the guards work.** `web/…/__tests__/categories-display.test.ts` asserts byte identity of `section-design.ts`, `categories-display.ts` and `categories-display.css`, and identity of `CategoryDisplayList.tsx` from its first declaration down plus an import-path-normalized header. Mutation check performed for this review: appending a line to each of the four storefront twins makes exactly that test fail (1 failed / 24 passed each time); the files were restored. The contract itself is pinned across PHP, web and storefront by `tests/Fixtures/presentation/section-design.json`.

**Not touched in this round:** behaviour, API, database, visual design, tests, source code.

**Size result.** PR added lines **19 842 → 9 270** (−53 %); changed files unchanged at 151; deletions 78. **CI after the condensation** (head `e3e840cbc07f27567f585780abe206ca94630135`, base `5fb6f2331cc82e2d37dce6d79e512658e7cd834c`): php sqlite, php pgsql, web build, storefront, both visual QA jobs and CI Gate all green. Related tests re-run locally: 79 web + 79 storefront passed. This note is the only later change (docs-only).
