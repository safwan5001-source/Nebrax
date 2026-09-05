# AWJ POS V2 — PR-2C: Category Presentation Contract

## Repository state

- Branch: `claude/pos-v2-pr2c-category-presentation`
- PR number/link: recorded after creation (see final chat reply)
- Base SHA: `65314b3772af37ae58483cac63de3dfd7d17cb15` (`origin/main` at session start — confirmed to include merged PR #654)
- Head SHA: recorded after commit (see final chat reply)

## Classification Before Implementation

| Area | Status | Reused vs changed | Reason |
|---|---|---|---|
| `product_categories` table/model | Implemented & usable, missing color | Extended (additive migration) | `image_path` etc. already existed; no color column at all |
| `ProductCategoryController` create/update | Implemented & usable | Reused, minimally extended | Existing image-replace/validation flow untouched; `color` passed through the same way `description` already is |
| `ProductCategoryResource` | Implemented & usable | Extended (one field) | Already exposed `image`; added `color` alongside it |
| `PosSettings` / `SalesConfigController` (`sales_config.pos`) | Implemented & usable | Extended (one new key) | Exact same JSON-settings contract already used for `show_product_images`, `show_cost_profit_in_pos`, etc. |
| POS category rendering (`pos-category-image.tsx`, two call sites in `page.tsx`) | Implemented & usable (image-only) | Reused + one new sibling component | `PosCategoryImage`'s existing fallback (`path={null}` → neutral icon) doubles as the "Default" mode renderer with zero new code |
| POS settings UI (`/pos/settings/configuration`) | Implemented & usable | Extended (one `<Select>`) | Same `Select`/`Label` pattern already used for `product_category_visibility_mode` |
| Category management UI (`/inventory-settings/categories`) | Implemented & usable | Extended (one color input) | Same form/FormData submission pattern already used for the image field |
| Permissions (`products.manage`, `company.manage`) | Implemented & usable | Reused, unchanged | No new permission created — see "Permissions" section |

## What Changed

AWJ POS now supports exactly one persisted, tenant-scoped category presentation
mode — `default | image | color` — governed by the new `category_presentation_mode`
POS setting. Rendering enforces **Image XOR Color**: a category's image and its
color are never shown simultaneously; the active mode alone decides which one
(if any) appears. Categories may now optionally carry a `color` (`#RRGGBB`,
strictly validated server-side). Existing tenants that have never touched the
new setting keep seeing exactly what they saw before this PR (category images),
because the setting's fallback value is `image`, not `default`.

## Files Changed

| File | Purpose |
|---|---|
| `database/migrations/2026_09_05_020000_add_color_to_product_categories_table.php` | New — adds nullable `color` (varchar(7)) to `product_categories` |
| `app/Models/ProductCategory.php` | `color` added to `$fillable`; new `COLOR_REGEX` constant (single source of truth for the safe hex pattern) |
| `app/Http/Requests/StoreProductCategoryRequest.php` | New `color` validation rule using `ProductCategory::COLOR_REGEX` |
| `app/Http/Resources/ProductCategoryResource.php` | Exposes `color` |
| `app/Http/Controllers/Api/ProductCategoryController.php` | Persists `color` on create/update (same pattern as `description`) |
| `app/Http/Resources/ProductResource.php` | New `category_color` field (conditional on `productCategory` being eager-loaded, mirroring the existing `category_image` field) so the POS catalog carries it |
| `app/Support/PosSettings.php` | New `CATEGORY_PRESENTATION_*` constants, `CATEGORY_PRESENTATION_MODES` allow-list, `category_presentation_mode` default (`image`), `categoryPresentationMode()` reader |
| `app/Http/Controllers/Api/SalesConfigController.php` | `category_presentation_mode` added to the `pos` section's inline defaults + validation (`Rule::in`) |
| `web/src/lib/pos-category-presentation.ts` | New — pure decision function `resolveCategoryVisual()` (mode + category data → which visual to render), fully unit-testable without mounting the POS page |
| `web/src/components/pos/pos-category-swatch.tsx` | New — renders a validated color swatch or a neutral fallback icon |
| `web/src/app/(pos)/pos/page.tsx` | `PosConfig`/`Product` types widened; `CATS` carries `color`; both category render call sites now use `renderCategoryVisual()` → `resolveCategoryVisual()` |
| `web/src/app/(app)/pos/settings/configuration/page.tsx` | New `category_presentation_mode` `<Select>` control in the existing "Products and pricing" section |
| `web/src/app/(app)/inventory-settings/categories/page.tsx` | New native `<input type="color">` field (optional, nullable, clearable) in the existing category create/edit form |
| `web/src/messages/en.json` / `ar.json` | New labels: setting name/hint, three option labels (Default/Image/Color — exact Arabic wording مطلوب: افتراضي/صورة/لون), category-form color labels |
| Tests (backend + frontend) | See "Tests" section |

No file under `routes/` was touched — no new routes were needed; the existing `product-categories` and `sales-config/pos` routes already carry the right permissions.

## Database

- **Migration required**: yes — `2026_09_05_020000_add_color_to_product_categories_table.php`.
- **Schema effect**: adds one nullable `color VARCHAR(7)` column to `product_categories`. No column renamed, dropped, or reinterpreted. No data migration/backfill — every existing row gets `NULL`.
- **SQLite result**: `php artisan migrate:fresh --force` — succeeds cleanly (verified twice, before and after the QA session).
- **PostgreSQL result**: `php artisan migrate:fresh --force` — succeeds cleanly.
- **Rollback/safety**: `down()` drops the column — safe, reversible, no cross-table effect. The column is never read by any accounting/inventory/tax code path; `ProductCategory` remains explicitly documented as "no accounting effect."

## Settings Contract

- **Exact setting path**: `tenants.settings['sales_config']['pos']['category_presentation_mode']` — the same JSON structure `show_product_images`/`show_cost_profit_in_pos`/etc. already live in. No new settings subsystem.
- **Allowed values**: `default` | `image` | `color` (`PosSettings::CATEGORY_PRESENTATION_MODES`), enforced server-side via `Rule::in(...)` on `PUT /sales-config/pos`; an invalid value is rejected with `422`, never silently coerced.
- **Persisted default for new/updated settings**: `image` (`PosSettings::CATEGORY_PRESENTATION_IMAGE`) — this is the literal value written into `PosSettings::DEFAULTS` and `SalesConfigController::DEFAULTS['pos']`.
- **Legacy/absent-setting fallback**: also `image` — in this codebase's architecture there is exactly one constant (`DEFAULTS`) that serves both roles (what a brand-new tenant gets, and what `array_merge()` falls back to for any tenant, new or old, that never saved the key). There was no existing per-tenant "registered before/after a cutover date" mechanism for this setting to distinguish "new tenant onboarding default" from "legacy fallback" the way `TenantApplicationService::ENFORCEMENT_CUTOVER_AT` does for application capabilities — inventing one here for a single presentation setting would have been unrelated over-engineering, explicitly out of this PR's scope.
- **Backward-compatibility rationale**: the mission's own semantic model calls `default` the "neutral, no image, no color" mode — but choosing `default` as the fallback value would have silently turned off category images for every tenant that has been looking at them since PR-2, with no action on their part. That is exactly the "arbitrarily choose a default that changes existing tenants' POS appearance" the mission explicitly forbids. `image` was chosen instead, specifically because it reproduces the exact current visual behavior. The string `'default'` remains fully valid and selectable — it is just never the value a tenant silently ends up with.
- **Explicit distinction documented in code**: both `PosSettings.php` (at the `DEFAULTS` array entry and inside `categoryPresentationMode()`) and `page.tsx`/the settings-page component carry inline comments stating this exact reasoning, so a future reader does not "fix" the default to `'default'` without understanding why that would be a regression.

## Category Color Contract

- **Representation**: a single nullable string column, `#RRGGBB` only (`ProductCategory::COLOR_REGEX = '/^#[0-9A-Fa-f]{6}$/'`) — one canonical constant used both by the `StoreProductCategoryRequest` validation rule and (informally, for defense-in-depth) again by the frontend `PosCategorySwatch` component before it is ever placed into a `style` attribute.
- **Validation**: server-side `regex` rule is the actual boundary — verified to reject `red`, `#FFF` (3-digit shorthand), `#GGGGGG` (invalid hex digits), `url(javascript:alert(1))`, `var(--primary)`, `rgb(0,0,0)`, and raw HTML/script strings, all with `422`. Frontend validation (the disabled/native color picker plus a client-side regex check before submit) is supplemental only — it does not gate the actual persisted value.
- **Null behavior**: absent/omitted `color` on create → `null`; sending an empty string on update → normalized to `null` by the framework's existing `ConvertEmptyStringsToNull` middleware (the same mechanism `description`/`parent_id` already rely on for "clear this field") — no separate `remove_color` flag was needed.
- **Security constraints**: the regex is anchored (`^...$`) and character-class-restricted (`[0-9A-Fa-f]{6}` only after a literal `#`), so no CSS function, custom property, URL, or markup can ever pass validation and reach a `style` attribute. The frontend additionally re-validates before rendering (`PosCategorySwatch` and `resolveCategoryVisual`'s consumer never trust the raw value), so even a color that somehow reached the database through a future unaudited path (e.g., a direct DB write) would still render as the neutral fallback rather than being interpolated unsafely.

## Tenant Isolation

- `ProductCategory` already uses `BranchScoped`/tenant scoping (`BaseModel`) — untouched. The new `color` column carries no isolation logic of its own; it is scoped exactly like every other category attribute.
- `category_presentation_mode` is read via `PosSettings::group($tenant)`, the same tenant-resolved accessor every other POS setting already uses.
- **Evidence (tests)**:
  - `the_presentation_mode_setting_is_tenant_scoped_and_does_not_bleed_across_tenants` — tenant A sets `color`, tenant B still reads the `image` fallback.
  - `a_categorys_color_from_one_tenant_is_never_visible_through_another_tenants_categories` — tenant B's `GET /product-categories` returns zero rows for a category created under tenant A.

## Permissions

No new permission was created. Exactly the existing boundaries were reused:

- Creating/editing a category's `color`: same `products.manage` permission that already gates `POST`/`PUT /product-categories` (unchanged route, unchanged middleware).
- Changing `category_presentation_mode`: same `company.manage` permission that already gates `PUT /sales-config/pos` (unchanged route, unchanged middleware).
- Reading either (category list, or `GET /sales-config/pos`): same `products.view` / `invoices.view` permissions already in place.

UI visibility (e.g., hiding the color picker) is not treated as a security boundary anywhere in this change — server validation and the existing route middleware are authoritative.

## Tests

### Targeted backend — SQLite
```
php artisan test --filter=PosCategoryPresentationTest
```
**9 passed (48 assertions).** Covers: valid hex color persists (create + update);
color nullable by default; 7 unsafe/malformed color values individually rejected
(422); all three presentation modes accepted, invalid mode rejected; a tenant
that never saved the setting reads back `image` (not `default`); tenant
isolation for both the setting and category colors; POS catalog
(`GET /pos/products`) returns `category_color` correctly; existing
(pre-migration-shape) categories without a color remain valid and keep their
image behavior.

### Targeted backend — PostgreSQL
```
php artisan migrate:fresh --force   # succeeds
php artisan test --filter=PosCategoryPresentationTest   # (re-run as part of the broader batch below; standalone result identical to SQLite)
```

### Broader backend — SQLite and PostgreSQL (identical filter, both engines)
```
php artisan test --filter='PosCategoryPresentationTest|ProductClassificationTest|SalesConfigTest|ProductBarcodeAndMediaTest|PosCheckoutTest|PosProductCostVisibilityTest|BranchIsolationGuardTest|RoleTest'
```
**92 passed (847 assertions) on SQLite. 92 passed (847 assertions) on PostgreSQL.** Identical counts on both engines — no engine-specific regression.

### Full backend suite — SQLite
```
php artisan test
```
**2353 passed, 1 skipped, 25 failed (16960 assertions).** The 25 failures are
the same pre-existing, environment-only gaps documented in every prior report
for this repository (24 `Fuel*Test` failures — missing `bcmath` extension in
this environment; 1 `DocumentCenterSecureIntakeTest` failure — missing
`poppler-utils`). Both are CI-installed and unrelated to this PR. Passed count
increased by exactly +9 over the pre-PR-2C baseline (2344 → 2353), matching
the 9 new tests added; zero new failures.

### Targeted frontend
```
npx vitest run src/lib/pos-category-presentation.test.ts src/components/pos/pos-category-swatch.test.tsx
```
**10 passed** — the pure XOR decision matrix (6 cases: all-tab icon in every
mode, default → neutral even with both image and color present, image mode
uses image only, image mode with no image falls back safely, color mode uses
color only, color mode with no color falls back safely) plus the swatch
component's own safety (valid color renders, missing/unsafe/malformed color
all fall back to the neutral icon).

### Broader POS frontend
```
npx vitest run "src/app/(pos)" src/components/pos src/lib/__tests__/pos-workspace.test.ts src/lib/pos-receipt.test.ts src/lib/pos-category-presentation.test.ts src/lib/permissions.test.ts "src/app/(app)/pos/settings/configuration/page.test.tsx"
```
**168 passed** (31 test files) — includes the new settings-page test
(`category_presentation_mode` defaults to `image`, saves `color` correctly
without disturbing other fields) and every pre-existing PR-1/PR-2/PR-2S POS
test, all still green.

### Full frontend suite
```
npx vitest run
```
**1449 passed** (228 test files) — zero failures.

### Build
```
npm run build
```
**Exit code 0.**

## Browser QA

Real headless Chromium via Playwright (`/opt/pw-browsers/chromium`), against
a live `next dev` (port 3000) + `php artisan serve` (port 8000) backend, with
a freshly registered tenant and five real categories covering every
combination: image-only, color-only, neither, color + long Arabic name, and
image + long English name.

| Scenario | Result |
|---|---|
| Desktop RTL — Default | PASS — every category shows the identical neutral icon, regardless of its stored image/color |
| Desktop RTL — Image | PASS — categories with an image show it; categories with only a color (no image) correctly fall back to neutral, never showing color |
| Desktop RTL — Color | PASS — categories with a color show it as a swatch; categories with only an image (no color) correctly fall back to neutral, never showing the image |
| Desktop LTR — Default/Image/Color | PASS — full mirror confirmed correct; same XOR behavior confirmed in the Color-mode LTR screenshot |
| Mobile (390×844) — all three modes | PASS for correctness (DOM inspection confirmed the exact same icon/swatch/fallback logic renders correctly — verified via `outerHTML`, e.g. `style="background-color: rgb(219, 39, 119)"` present exactly where expected) — see the pre-existing, unrelated layout note below |
| Category with image | PASS |
| Category without image | PASS (neutral fallback in Image mode; same fallback component already used pre-PR-2C) |
| Category with color | PASS |
| Category without color | PASS (neutral fallback in Color mode) |
| Long Arabic category name | PASS — 2-line clamp, no overlap, swatch/icon unaffected |
| Long English category name | PASS — same |
| Dark mode (RTL, Color mode) | PASS — swatches remain vibrant and legible against the dark surface; category name text stays on the neutral card background (never overlaid on the color itself), consistent with the "restrained treatment" requirement |
| Selected category state | PASS — unaffected by this change; the `border-primary bg-primary-soft` selected styling is applied to the button, not the icon/swatch area |
| Clipping/overlap | None found in any desktop or mobile screenshot |
| Unreadable text due to category color | None — the color swatch never carries text; category name is always rendered on the card's own neutral background |

**Pre-existing, unrelated observation (not a PR-2C defect, not fixed here)**:
at the 390px mobile viewport, the horizontal category strip's icon/swatch
area renders visually compressed to ~36px height (less than the intended
44px), making the icon/swatch difficult to see at a glance, though the DOM
confirms the correct element is present and correctly styled underneath.
**This reproduces identically in Default, Image, and Color modes**, and was
independently confirmed present in the *unmodified* Image-mode rendering
(the exact behavior that already shipped with PR-2) — it is a pre-existing
mobile layout constraint on the category strip container, not something this
PR introduced, changed, or regressed. Fixing it would mean touching the
mobile category strip's layout/height rules, which is explicitly out of
scope ("do not redesign mobile"). Reported honestly per the mission's
instructions rather than silently omitted or silently fixed.

Screenshots (local, not committed — repository has no established convention
requiring binary QA screenshots in-tree):
`/tmp/pw/shots3/{default,image,color}-{rtl,ltr,mobile}.png`,
`color-rtl-dark.png`, `mobile-category-strip-zoom.png`.

## CI

Not yet available at the time of writing this report — the branch had not
been pushed yet when this section was drafted. See the final chat reply for
the PR link and to check CI status after push.

## Safety

Confirmed no changes to:
- Checkout, invoice posting, taxes, VAT, ZATCA — no file under
  `app/Services/Accounting/`, `app/Services/Reporting/`, or any ZATCA-related
  path was touched.
- Inventory costing / stock authority — `Product`, `StockMovement`, and all
  inventory services untouched.
- Payments, returns/exchanges — untouched.
- POS Session financial behavior — untouched.
- R1–R6 — none of `PosController::checkout()`, `PosService`,
  `PosReturnService`, `PosExchangeService`, `InvoiceResource`, or any
  return/exchange/checkout path was modified. `PosCheckoutTest` (part of the
  broader regression run) passes unchanged on both engines.

## Risks / Remaining

- The pre-existing mobile category-strip height constraint (see Browser QA)
  remains unaddressed — it predates this PR and reproduces in all three
  modes; flagged for a future, separately-scoped mobile layout fix, not
  silently absorbed into PR-2C.
- No dedicated "many categories, mixed colors" density/visual-noise test was
  performed beyond the 5-category QA set; the design (color confined to a
  44–48px icon square, never a full-card background) makes this low-risk,
  but a tenant with a very large, all-colored category list was not
  specifically visually stress-tested.

## Deferred

PR-3 (wider desktop cart, Selected Line, numeric keypad, quantity/price/
discount editor redesign) was **not started** — confirmed by `git diff`
against `main` touching zero cart/payment files. No cart interaction,
product-card layout, Quick View, cost/profit security integration, favorite
isolation, or add-to-cart semantics were altered by this PR.

## Next Step

Human/ChatGPT review of this Draft PR → CI → Safwan's explicit approval →
merge. No merge or deploy has occurred as part of this mission.
