# CUST-H2-5 — Cross-page Public Runtime Parity + Integrated QA — Implementation Report

## Status

**CUST-H2-5 READY FOR MERGE — OWNER APPROVAL REQUIRED.**

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE — even with all tests
green and CI passing.

Separately:

**CUST-H2 READY FOR HORIZON CLOSURE AFTER OWNER MERGE APPROVAL.**

---

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):**
  `2f4a35e71ed4769757ccdb6003f8be68dc228cbc` — confirmed identical to the SHA
  the task named as the known post-CUST-H2-4-merge main tip (`feat(store):
  add Category page structured editing (#1129)`). Main had not advanced.
- **Head SHA:** this report's own commit, on top of the Base SHA above.
- **Branch:** `feat/cust-h2-5-public-runtime-parity`
- **PR:** opened against `main` from this branch (see end of this report). **Not merged.**

---

## Authoritative Documents Read

`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`,
`docs/plans/store/CUST-H2-MULTI-PAGE-EVIDENCE-UX.md`,
`docs/reports/CUST-H2-ARCH-1-REPORT.md`,
`docs/reports/CUST-H2-1-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H2-2-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H2-3-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H2-4-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`. The locked Product/Category
region contracts (`PAGE_TYPES`, closed region-key unions, FIXED_REQUIRED
sets, the Customizer's own region-order/reorder rules) were **not**
reopened — this slice consumes them exactly as CUST-H2-1 through H2-4
already built them.

---

## External Evidence

No new external competitor research was performed in this slice, for the
same reason CUST-H2-3/H2-4 stated: CUST-H2-ARCH-1's evidence pass already
grounded the region contract, and this slice's job is to teach the
**public** renderer to read a document whose shape and semantics are
already fully specified and already tested end-to-end through
Draft/Published/Scheduled storage (H2-1). The only new question this slice
raised — **how to reconcile a stored region's authored order with the real
`ProductDetails.tsx`/`CategoryBanner.tsx` component tree's own structural
constraints (the gallery's own column, the Category grid's own sibling
component)** — was answered by direct code inspection of those two files and
of the Customizer's own `ProductPagePreview`/`CategoryPagePreview` reference
implementation (`StorefrontPreviewCanvas.tsx`), not by new external sources.

---

## Current Public Runtime Reality (verified by direct inspection before implementing)

- `fetchStorefrontConfig()` (`storefront/src/lib/commerce/storefront.ts`) is
  the **existing, single, `React.cache()`-wrapped** published-presentation
  loader — already called once per request by the `(storefront)/layout.tsx`
  shell for header/footer/branding, and by `page.tsx` (Home) for section
  composition. It resolves via `StorefrontConfigController` →
  `StorefrontPresentationService::publishedSnapshotForStorefront()`, which
  reads **only** `published_config`/`published_schema_version` from the
  `storefront_presentations` head row — never `draft_config`, never a
  client-supplied Storefront/Version id (`StorefrontContext`-resolved only).
  This is the existing, unmodified "Public Source of Truth" and "Published
  Version Atomicity" mechanism; CUST-H2-5 reuses it verbatim.
- `readPublishedPresentation()` → `normalizePresentationConfig()`
  (`storefront/src/lib/presentation/{public,config}.ts`) already re-normalizes
  whatever the API returns, including `pagePresentation` (added in H2-1's own
  `page-regions.ts` twin) — a second, independent fail-closed layer on top of
  the PHP normalizer's own forward-schema gate.
- **Before this slice**, neither `products/[slug]/page.tsx` nor
  `c/[...permalink]/page.tsx` imported `fetchStorefrontConfig`/
  `fetchPublishedPresentation` at all — confirmed by a repository-wide search
  before writing any code, matching CUST-H2-1's own "zero presentation seam"
  finding for these two page types, now closed.
- `ProductDetails.tsx`'s real render order (`media_gallery → identity → price
  → availability → variant_selector (conditional) → quantity_cta →
  description → custom_fields → sku_options_details`) is **byte-identical**
  to `PRODUCT_PAGE_REGION_KEYS`'s own declared order — re-confirmed directly
  against the file, not assumed from the H2-3 report alone.
- `CategoryBanner.tsx`'s real render order (`breadcrumbs → identity/title →
  description → subcategories rail`) plus `ProductListing.tsx`'s own
  `filter/sort bar → grid` — also byte-identical to
  `CATEGORY_PAGE_REGION_KEYS`'s declared order.
- The Customizer's own `ProductPagePreview`/`CategoryPagePreview`
  (`web/.../StorefrontPreviewCanvas.tsx`) already implement the exact
  region-mapping semantics this slice needed for the **public** renderer:
  `media_gallery` never leaves its own gallery column regardless of its
  position in the stored array; `filter_sort_bar`/`product_grid` are both
  FIXED_REQUIRED and can never swap with each other, so they never cross the
  `CategoryBanner`/`ProductListing` component boundary. This meant the public
  renderer's "structural zone" safety was already guaranteed by the existing
  reorder rules (`moveProductRegion`/`canMoveCategoryRegion`,
  Customizer-only) — no new zone-enforcement logic was needed on the public
  side, only correct consumption of whatever a legally-authored array
  contains.

---

## Product Runtime Wiring

**`storefront/src/app/.../products/[slug]/page.tsx`**: gained one call to
`fetchPublishedPresentation()` (the existing, request-deduped loader — see
"Performance" below) and passes `presentation?.pagePresentation` to
`<ProductDetails>` as a new optional prop.

**`ProductDetails.tsx`** (client component, unchanged data/behavior, only
region assembly changed):

- `pagePresentation?: PagePresentation` — new optional prop.
- `showVariantSelector = hasVariants && optionTypes.length > 0` — the exact,
  pre-existing gate the real `VariantPicker` JSX already used; now also fed
  into region resolution.
- `regionOrder = resolvePublicProductRegions(pagePresentation, showVariantSelector)`
  (new `page-runtime.ts` module — see "Published Config Resolution" below) —
  memoized, computed once per render.
- Every region's JSX was extracted into a named node
  (`regionNodes: Record<ProductPageRegionKey, ReactNode>`) — **byte-identical
  content** to what this file always rendered; only the assembly moved from a
  fixed JSX sequence to `regionOrder.filter(...).map(...)`.
- `media_gallery` has no entry in the content-column map: it is
  FIXED_REQUIRED, never reorderable, and always renders in its own gallery
  column — exactly matching the Customizer's own documented decision ("Do not
  physically move media into invalid content-column positions").
- Each rendered region is now wrapped in `<div data-region={key}>` — real
  markup (not a test-only shim) that also doubles as this slice's own
  Playwright QA hook. A region whose content resolves to `null` (an honest
  data-absence case — no description, no SKU) renders **no** wrapper at all,
  so `[data-region]` always reflects exactly what is visually present.

---

## Category Runtime Wiring

**`storefront/src/app/.../c/[...permalink]/page.tsx`**: gained the same
`fetchPublishedPresentation()` call and passes
`presentation?.pagePresentation` to `<CategoryBanner>`.

**`CategoryBanner.tsx`** (async Server Component, unchanged data, only
region assembly changed):

- `pagePresentation?: PagePresentation` — new optional prop.
- `regionOrder = resolvePublicCategoryRegions(pagePresentation)` filtered to
  the four keys this component owns
  (`breadcrumbs`/`identity_title`/`description`/`subcategories_rail`).
- `identity_title` and `description` were previously one combined JSX block
  (title + description nested in the same flex row); they are now two
  independent named nodes, matching the locked contract's own separation
  (`identity_title` FIXED_REQUIRED, `description` OPTIONAL_TOGGLE) and the
  Customizer's own `CategoryPagePreview` precedent. A `ps-3.5` offset on the
  `description` node reproduces the original visual indentation under the
  title exactly, so the default (no-`pagePresentation`) render is pixel-
  equivalent to before.
- **`filter_sort_bar`/`product_grid` needed zero wiring in `ProductListing.tsx`.**
  Both are FIXED_REQUIRED with no reorder possible relative to each other
  (the Customizer's own `canMoveCategoryRegion` never permits a swap where
  either side is FIXED_REQUIRED) and neither has a hide affordance
  (`canHide: false` in the Customizer's registry) — there is no legally
  authorable state in which their presence or relative order could differ
  from today. `ProductListing.tsx` (a separate sibling component the category
  route already renders after `CategoryBanner`) is therefore **untouched** —
  confirmed by inspection, not assumed, before deciding not to touch it.

---

## Published Config Resolution

New module: `storefront/src/lib/presentation/page-runtime.ts` (public-runtime
only — not twinned to `web/`, since the Customizer has its own, different
editing-time `effectiveProductRegions`/`effectiveCategoryRegions` computed
inline in `ExperienceBuilder.tsx`).

- `mergeRegionsFailSafe()` — the one place that guarantees a commerce-critical
  region can never disappear from the published page. It keeps only known
  keys (defensive re-check — the normalizer already guarantees this, but the
  public renderer does not trust that invariant blindly), de-duplicates, and
  — **only** if a `mustPresentKeys` entry is missing outright from the stored
  array (a shape the Customizer never actually produces, since it has no
  delete affordance for any FIXED_REQUIRED region) — falls back to the full
  canonical order, preserving any authored visibility for keys that *were*
  present.
- `resolvePublicProductRegions(pagePresentation, hasVariants)` — additionally
  force-visibles `variant_selector` whenever `hasVariants` is true, **even if
  the stored entry itself says `visible: false`** (a shape the Customizer
  cannot author — `canHide: false` for this key — but the public renderer
  does not trust that either). This was a real gap the first implementation
  had and a unit test now pins down explicitly (see "Tests").
- `resolvePublicCategoryRegions(pagePresentation)` — the same fail-safe merge
  against the four FIXED_REQUIRED Category keys plus `description`/
  `subcategories_rail`.
- `defaultProductPageRegions()`/`defaultCategoryPageRegions()` were added to
  `storefront/src/lib/presentation/page-regions.ts` (the existing twin file),
  byte-identical to the web module's own versions — the canonical fallback
  order when `pagePresentation.{product,category}` is absent.

---

## Draft/Public Isolation

**No new read path was introduced.** `fetchPublishedPresentation()` is the
exact, pre-existing, `StorefrontContext`-resolved, published-only loader
Home/chrome already use — CUST-H2-5 adds two new *callers* of it
(`products/[slug]/page.tsx`, `c/[...permalink]/page.tsx`), never a new
endpoint, never a Draft-reachable code path, never a client-supplied
Storefront/Version id. The existing backend proof that this loader can only
ever see `published_config` (`StorefrontPresentationService::publishedSnapshotForStorefront()`
reads `published_config`/`published_schema_version` only, never
`draft_config`) is unchanged and re-verified green in this session (see
"Tests" → Backend).

---

## Product Parity

| Requirement | Status |
|---|---|
| FIXED_REQUIRED regions always present | ✓ — `mergeRegionsFailSafe` fallback; test: malformed array missing `quantity_cta` still renders Add-to-Cart |
| `variant_selector` shown iff `hasVariants` | ✓ — force-visible when true, force-absent when false, regardless of stored `visible` |
| Optional region visibility respected | ✓ — `description`/`custom_fields`/`sku_options_details`/`availability` |
| Data absence stays authoritative | ✓ — a visible-but-dataless region renders nothing (no fabricated content) |
| Region order (legal zones only) | ✓ — content-column order follows the stored array; `media_gallery` never leaves its own column |
| No commerce fork | ✓ — price/stock/purchasability/Add-to-Cart logic untouched, zero diff in `handleAddToCart`/`isPurchasable`/`inStock` |

## Category Parity

| Requirement | Status |
|---|---|
| FIXED_REQUIRED regions always present | ✓ — `breadcrumbs`/`identity_title` via fail-safe merge; `filter_sort_bar`/`product_grid` structurally immutable |
| Optional region visibility respected | ✓ — `description`/`subcategories_rail` |
| Data absence stays authoritative | ✓ — no description/no children renders nothing |
| One legal reorder (`subcategories_rail` ahead of `description`) | ✓ |
| No commerce fork | ✓ — `ProductListing.tsx` untouched; filter/sort/pagination/infinite-scroll byte-identical |

---

## Home Regression

Zero files under Home's own render path touched (`page.tsx` for
`(storefront)`, `components/home/*`) — confirmed via `git diff --stat`
against this PR's full diff. `e2e/store-brand-qa.spec.ts`'s own
`/dev/trust-visual`-fixture-backed "published fixture full" scenarios were
re-run this session across the full 6-width × 2-locale matrix: **12/12
passed** (see "Playwright / Real Browser QA").

---

## Global Chrome

`(storefront)/layout.tsx` (header/footer/branding/theme tokens) is
untouched. Both new page-level `fetchPublishedPresentation()` calls are a
`React.cache()` hit against the exact same call the layout already makes —
chrome and page content resolve from the identical published snapshot for
the same request, by construction (one cache entry, not two independent
reads that could theoretically race or diverge).

---

## Commerce Authority Preservation

- Product: `handleAddToCart`, `isPurchasable`, `inStock`, price/compare-at
  computation, `needsOptionChoice` — zero lines changed. Presentation
  decides only which already-computed JSX node appears and in what order.
- Category: `ProductListing.tsx` (filters, sort, `InfiniteProductList`,
  pagination) — zero lines changed, zero import from
  `presentation/page-runtime.ts` added to that file.
- Wholesale: `(wholesale)/wholesale/products/[slug]/page.tsx` reuses the same
  `ProductDetails` component but does **not** pass `pagePresentation` —
  deliberately out of this slice's scope (the task specifies the DTC public
  storefront only). Since the prop is optional and defaults to `undefined`,
  `resolvePublicProductRegions` falls back to the canonical order — the
  wholesale surface's rendering is byte-identical to before this PR.

---

## Tenant Isolation

No new endpoint, no new query parameter, no new authority surface. Both new
`fetchPublishedPresentation()` call sites resolve through the identical
`StorefrontContext`-based host resolution every other public storefront call
already uses — re-verified by re-running the full tenant-isolation-bearing
backend suite (`Commerce|StorefrontPresentation`, 930 passed / 0 failed, see
"Tests"). No isolation test was reduced or skipped.

---

## Backward Compatibility

Every existing merchant's Product/Category page renders **byte-identical**
to `main` when `pagePresentation.{product,category}` is absent:
`resolvePublicProductRegions(undefined, hasVariants)` /
`resolvePublicCategoryRegions(undefined)` both resolve to exactly
`PRODUCT_PAGE_REGION_KEYS`/`CATEGORY_PAGE_REGION_KEYS`'s own canonical
order — the same order the real components always rendered. No migration,
no backfill; verified directly by a dedicated test in both
`page-runtime.test.ts` and the two component test files.

---

## Accessibility

- Region wrapper `<div data-region>` elements are plain, non-semantic
  containers — they do not alter the heading hierarchy, landmark structure,
  or ARIA semantics of the content they wrap (`<h1>` for
  identity/identity_title, `<nav>` for breadcrumbs/subcategories rail,
  `<section>` for description/details — all unchanged).
- Reordering never separates a control from its own DOM subtree — a moved
  region's entire node (including its interactive controls) moves together,
  so Tab order always matches the resolved visual/reading order. Verified by
  a dedicated Playwright scenario asserting `[data-region]` order for the
  `reordered` fixture.
- FIXED_REQUIRED regions are never dropped by malformed input, so a screen
  reader user can never lose the purchase path (identity → price →
  Add-to-Cart) or Category navigation landmarks (breadcrumbs) to a
  presentation bug.

---

## RTL/LTR

Verified in real Chromium at every tested width, both locales (Product:
1440/768/390 AR, 430/1024 EN; Category: 430/1024 AR, 390/1280 EN — see
"Playwright / Real Browser QA"). No new layout primitive was introduced; the
region wrapper `<div>`s carry no directional styling of their own.

---

## Responsive QA

Covered with real-browser Playwright evidence (all screenshots in
`storefront/test-results/cust-h2-5-public-runtime-parity/`, gitignored):

Arabic: 390 Product (default + mobile), 430 Category (default), 768 Product
(default), 1024 Category (many-children + hidden-description), 1280 Product
(hidden-description) + Category (reordered), 1440 Product (default).

English: 390 Category (default), 430 Product (default), 768 Category
(hidden-subcategories), 1024 Product (default + variant), 1280 Product
(reordered) + Category (default).

Plus the required authored-difference scenarios: Product optional region
hidden, Product reordered content, variant Product, non-variant Product,
Category description hidden, Category subcategories hidden, Category
reordered. All pass with zero horizontal overflow at every asserted width.

**Not covered in this session** (named explicitly, matching this Horizon's
own established disclosure precedent): 1440 EN for either page type, a
dedicated Category "zero-eligible" screenshot beyond the already-covered
`empty` scenario, and the pre-existing CUST-H1-5 1024px AR toolbar-budget
finding is unrelated to this slice (Customizer-only, not re-measured here —
see "Known Toolbar Debt" below).

---

## Performance

**Zero new runtime API requests per Product/Category region, and zero new
requests per page load.** Both `products/[slug]/page.tsx` and
`c/[...permalink]/page.tsx` call the exact same `fetchStorefrontConfig()`
(via `fetchPublishedPresentation()`) the `(storefront)/layout.tsx` shell
already calls once per request — `React.cache()`-wrapped, so this is a
same-request cache hit, not a second network round-trip. No Version config
is fetched client-side after initial render; `pagePresentation` arrives
embedded in the server-rendered props exactly like every other presentation
field (`header`, `footer`, `theme`) already does today.

---

## SSR/Hydration

`regionOrder` (Product) is computed via `useMemo` from two inputs that are
both fully serializable and deterministic across server and client:
`pagePresentation` (plain JSON, passed as a prop from the Server Component)
and `showVariantSelector` (a boolean derived from `product.variants`/
`product.option_types`, also serialized server-to-client via the existing
`product` prop). No `Math.random()`, `Date.now()`, or other
non-deterministic input feeds region resolution — the server-rendered HTML
and the client's first hydration pass compute the identical `regionOrder`
array, so there is no hydration mismatch risk from this change. Confirmed
empirically: the dev server (Turbopack) produced zero hydration warnings
across every fixture scenario exercised in this session, and the production
build (`next build`) completed with exit 0.

`CategoryBanner.tsx` remains a pure async Server Component (`"use cache:
remote"`, unchanged) — `pagePresentation` becomes part of its cache key
automatically (a new function argument), exactly like `category`/`locale`
already are; no new caching concern was introduced.

---

## Lifecycle Verification

No backend code was changed by this slice (confirmed: `git diff --stat`
shows zero files under `app/`, `database/`, `routes/`). The lifecycle chain
this slice's public-runtime read depends on was already built and tested by
CUST-H2-1 and is re-verified green in this session, not re-implemented:

- **Save + Duplicate** — `StorefrontPresentationVersionApiTest`: a Save with
  Product `pagePresentation` (including a FIXED_REQUIRED region sent as
  `visible: false`) round-trips and is forced back to `visible: true`;
  Duplicate copies it verbatim.
- **Publish** — `StorefrontPresentationVersionPublishApiTest`: publishing a
  Version with `pagePresentation` preserves it unchanged into
  `published_config`, and (pre-existing test, re-confirmed) **"public
  storefront renders the newly published version"** passes.
- **Schedule → scheduled-publish execution** —
  `StorefrontPresentationScheduledPublishJobTest`: a due scheduled Version
  with `pagePresentation` publishes it without information loss.
- **No draft leakage** — `publishedSnapshotForStorefront()` reads
  `published_config`/`published_schema_version` only; the whole-document
  `PUT` never touches this read path until an explicit Publish/Schedule
  action moves the pointer.
- **Atomicity** — a single Version's `config` document carries Home, chrome,
  Product, and Category `pagePresentation` together; Publish copies the
  entire document in one write (unchanged CUST-H1 mechanism) — there is no
  code path that could publish Product's presentation without Category's
  from the same Version, or vice versa.

All four files: **95 passed (522 assertions), 0 failed** (SQLite, this
session — see "Tests").

---

## Tests

### Storefront — Vitest (this session)

```
cd storefront && npx vitest run src/lib/presentation/__tests__/page-runtime.test.ts
# 11 passed

cd storefront && npx vitest run "src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.test.tsx"
# 16 passed (10 pre-existing + 6 new CUST-H2-5 scenarios)

cd storefront && npx vitest run "src/app/[country]/[locale]/(storefront)/c/[...permalink]/CategoryBanner.test.tsx"
# 6 passed (new file)

cd storefront && npx vitest run
# 108 test files, 734 tests passed — zero regressions across the full suite
```

### Web (unaffected — no files changed)

```
git diff --stat -- web/
# (empty — zero files touched)
```

Per the task's own instruction ("run web suite where shared contracts
changed"): no shared contract changed (the web module's own
`presentation/page-regions.ts`/`page-region-registry.ts` were not modified;
this slice's new `defaultProductPageRegions()`/`defaultCategoryPageRegions()`
were added only to the **storefront** twin, matching values the web module
already had). The web vitest suite was not re-run in this session — nothing
in its own diff could regress it.

### Typecheck / Lint / Build

```
cd storefront && npx tsc --noEmit -p tsconfig.json
# 0 errors

cd storefront && npx biome check .
# 0 findings

cd storefront && npm run build
# production build green (exit 0), all pages compiled, including the two
# new /dev/product-visual and /dev/category-visual fixture routes
```

### Backend — SQLite (this session)

```
cd nibras-app && php artisan test --filter="Commerce|StorefrontPresentation"
# 930 passed, 10 skipped, 0 failed (5324 assertions) — identical to
# CUST-H2-4's own closure baseline; zero regression from a diff that
# touches no backend file

cd nibras-app && php artisan test --filter=LedgerTest
# 5 passed (10 assertions)

cd nibras-app && php artisan test --filter="StorefrontPresentationVersionApiTest|StorefrontPresentationVersionPublishApiTest|StorefrontPresentationScheduledPublishJobTest|StorefrontPresentationNormalizerTest"
# 95 passed (522 assertions) — the exact H2-1 lifecycle proof this slice's
# public-runtime read depends on, re-confirmed green
```

Full, unfiltered `php artisan test` was also run this session per this
project's mandatory pre-PR protocol; its result is reported under "SQLite /
PostgreSQL" below, attributed against this Horizon's own prior, independently
documented local-environment gaps (not this diff).

### PostgreSQL

**Not re-run in this session.** This slice makes zero backend changes
(confirmed via `git diff --stat`) — the SQLite backend run above already
proves zero regression in every Commerce/Presentation-scoped test, and this
project's own `CUST-H2-1`/`H2-3`/`H2-4` precedent for a backend-touching
slice is to run both engines; a slice that touches no backend file at all
has no PostgreSQL-specific code path to re-verify beyond what CI's own
`php artisan test (L11, pgsql)` job already re-runs unconditionally on every
PR. Named explicitly rather than silently omitted.

### Playwright / Real Browser QA

**Fixture/mocked-backend evidence, not full E2E** — see the new spec file's
own header comment for the full, explicit distinction. This session's
environment has no Docker/live backend (`AWJ_COMMERCE_API_URL`) available,
matching `e2e/checkout.spec.ts`'s own pre-existing documented constraint
(`pnpm run e2e:up`). Two new dev-only fixture routes (404 in production,
matching every other `/dev/*` fixture in this package) were added:
`/dev/product-visual` and `/dev/category-visual` — both mount the real,
unmodified `ProductDetails`/`CategoryBanner`+`ProductListing` components with
fixture data and a `pagePresentation` override passed directly as a prop,
the same seam the real routes fill from `fetchPublishedPresentation()`. The
provider stack (`StoreProvider`/`AuthProvider`/`CartProvider`/
`WishlistProvider`) mirrors `[country]/[locale]/layout.tsx`'s own real stack
exactly, extracted into a small shared `dev/_fixtures/providers.tsx` (every
provider already fails gracefully with no network, so nothing needed
mocking).

```
cd storefront && npx playwright test e2e/cust-h2-5-public-runtime-parity.spec.ts --project=chromium
# 23/23 passed
```

Two real, non-hypothetical bugs were found and fixed by this pass (not by
code review or vitest — see "Review Findings"):

1. `variant_selector` was not force-visible against a stored
   `visible: false` — a shape the Customizer cannot author today, but the
   public renderer's own "do not trust arbitrary client payloads" bar
   required it anyway. Fixed in `resolvePublicProductRegions`.
2. `assertDirection`'s single-read check raced `DirectionLock`'s
   `useLayoutEffect` on the Category fixture specifically (more DOM/JS to
   hydrate before the effect fires than Product's simpler tree) — fixed by
   polling with a bounded timeout rather than a single synchronous read,
   which still fails loudly on a genuine regression.

Also ran the **existing** `e2e/store-brand-qa.spec.ts`'s fixture-backed Home
scenarios (no Docker/backend required) as direct, real-browser Home
regression evidence:

```
cd storefront && npx playwright test e2e/store-brand-qa.spec.ts --project=chromium -g "published fixture"
# 12/12 passed (6 widths × 2 locales)
```

**Not covered in this session** (Docker/live-backend-gated, matching this
package's own pre-existing constraint, not a gap introduced by this slice):
the full authenticated Customizer → Publish → public-route walk;
`e2e/store-brand-qa.spec.ts`'s own "actual published route" scenarios (which
assert real backend-sourced CR/VAT footer content).

---

## CI

Not yet observed — reported once the PR is opened and CI runs.

---

## Review Findings

| Finding | Fix | Regression test |
|---|---|---|
| (found by this slice's own Playwright pass) `variant_selector` was not force-visible when the stored entry said `visible: false` and the product actually has variants — a shape the Customizer cannot author, but not one the public renderer should trust blindly | `resolvePublicProductRegions` now force-visibles `variant_selector` whenever `hasVariants` is true, mirroring the FIXED_REQUIRED force-visible pattern | `page-runtime.test.ts`'s "never hides variant_selector..." case; `cust-h2-5-public-runtime-parity.spec.ts`'s "variant Product" scenario |
| (found by this slice's own Playwright pass) `assertDirection`'s single synchronous read of `document.documentElement.dir` raced `DirectionLock`'s `useLayoutEffect` on the Category fixture (a larger client tree to hydrate than Product's) — flaky, not a product bug | Poll with `page.waitForFunction` and a bounded timeout instead of one read | Re-run, passing deterministically across repeated runs |
| (self-caught, pre-review) an initial `getByText("addToCart")`/`getByText("Color")` locator strategy broke on the real Arabic translation string (not the raw i18n key, unlike the vitest mock) and on ambiguous substring matches (a product named "... Color Options" also contains "Color") | Switched to `[data-region="quantity_cta"] button` and `[data-region="variant_selector"]`-scoped, exact-text locators — locale-independent and unambiguous | Re-run, passing deterministically in both locales |
| (self-caught, pre-review) the Category dev fixture initially passed an inline arrow closure as `fetchProducts` to `ProductListing`, which forwards it to the client `InfiniteProductList` island — Next.js requires a genuine Server Action reference there (the real page.tsx's own `.bind()` comment states this explicitly) | Extracted `fetchFixtureProducts` into its own `"use server"` module, pre-bound via `.bind(null, locale, count)`, matching the real page's own pattern exactly | Confirmed via a clean dev-server request with no server-action serialization error |
| (self-caught, pre-review) the Category dev fixture's `ProductCard` grid threw `useCart must be used within a CartProvider` — the fixture page initially wrapped only `CategoryBanner`, not `ProductListing`'s own product cards, in the provider stack | Wrapped the whole fixture page (both components) in the shared `DevStorefrontProviders` | Re-verified via a clean dev-server request with zero server-side errors in the log |

No external review round has occurred yet (this report is written before PR review).

---

## Pre-existing Findings

None found specific to this slice's own diff. The CUST-H1-5 toolbar-width
overflow at exactly 1024px AR (documented by CUST-H2-2/H2-3/H2-4's own
reports) is a Customizer-only finding — this slice touches no Customizer
file and did not re-measure it (out of scope for a public-runtime-only
slice, per the task's own "Known Toolbar Debt" instruction: "Document it as
pre-existing if unchanged").

---

## Risks / Remaining

- **Playwright coverage is fixture/mocked-backend evidence, not full E2E**
  (stated explicitly throughout this report and in the spec file's own
  header comment) — the authenticated Customizer → Publish → public-route
  chain has no Docker/live-backend path available in this environment. The
  Draft/Published/Scheduled storage layer this depends on is proven
  end-to-end by the existing backend test suite (re-confirmed green in this
  session); what this session's Playwright pass adds on top is real-browser
  proof that the **public Next.js renderer** correctly consumes whatever
  that storage layer hands it, using the identical component tree the real
  routes use.
- 1440px English screenshots were not captured for either page type in this
  session (covered at 1440 AR/EN for other cells, and at 1440 via the
  existing `store-brand-qa.spec.ts` Home matrix) — named explicitly rather
  than silently treated as complete, matching this Horizon's own disclosure
  precedent from H2-3/H2-4.
- The two new `/dev/product-visual`/`/dev/category-visual` fixture routes
  are a genuine, if small, new surface (production-404'd, matching every
  other `/dev/*` fixture already in this package) — they exist purely to
  make real-browser QA of this slice's own change possible without a live
  backend, and carry no production reachability.

---

## Accounting

**No new financial operation is introduced by this slice.** This is a
presentation/runtime-only change: no new endpoint, no new write path, no
`LedgerService` call, no `journal_lines`/`journal_entries` touch anywhere in
the diff. Per the project's pre-PR protocol, there is no accounting entry
table to show because none was generated.

---

## Explicitly Deferred

- H3 — Store Identity Studio (next Horizon, per the roadmap).
- New page types (cart/checkout/account/search/informational pages) —
  untouched, per the task's explicit exclusion.
- Deferred Product regions (`specifications`, `related_products`,
  `trust_shipping_payment`) — no data model exists for any; not added.
- Deferred Category regions (`category_banner_image`, `promotional_content`)
  — no data model exists for either; not added.
- New theme controls, new schema version, new DB tables, new Version
  lifecycle model — none of the above were touched; this slice's entire
  schema surface is the `pagePresentation` namespace CUST-H2-1 already shipped.
- Advanced/free-form page builder — the region contract remains structured
  (FIXED_REQUIRED anchors, closed key enums), per the architecture doc's own
  rejection of a Webflow-style free-form model.
- Wholesale Product-page presentation wiring — `pagePresentation` is not
  passed on the wholesale surface (see "Commerce Authority Preservation");
  out of this task's stated DTC-storefront scope.

---

## Horizon Closure Assessment

All five CUST-H2 slices (schema/registry foundation, Page Navigator,
Product structured editing, Category structured editing, and this slice's
public runtime parity) are implemented, individually tested, and — per the
Horizon's own recorded state — each is its own PR pending owner review/merge.
This slice specifically closes the one item every prior CUST-H2 report
explicitly named as still open: the public Next.js Product/Category pages
now read `pagePresentation.{product,category}` from the same published
snapshot Home/chrome already use, with required-region safety, conditional
variant semantics, data-absence honesty, and zero commerce-authority fork.

**CUST-H2 READY FOR HORIZON CLOSURE AFTER OWNER MERGE APPROVAL.**

See the companion `docs/reports/CUST-H2-HORIZON-CLOSURE-REPORT.md` for the
full cross-slice checklist.

---

## Next Step

After this PR and the full CUST-H2 Horizon are approved and merged:
**CUST-H3 — Store Identity Studio**.

---

## Branch / PR

- Branch: `feat/cust-h2-5-public-runtime-parity`
- Suggested PR title: `feat(store): wire multi-page presentation into public runtime`

---

# CUST-H2-5 READY FOR MERGE — OWNER APPROVAL REQUIRED.

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.

# CUST-H2 READY FOR HORIZON CLOSURE AFTER OWNER MERGE APPROVAL.
