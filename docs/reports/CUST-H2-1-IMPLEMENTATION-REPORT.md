# CUST-H2-1 — Presentation Schema + Page Registry Foundation — Implementation Report

## Status

Implementation complete. No DB migration. No UI. No public-runtime wiring. No new API.

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):** `ce97b2d3367c954af5e353a4df058635fdfa1918` — confirmed identical to the SHA the task named as the known post-CUST-H2-ARCH-1-merge main tip (`docs(store): define CUST-H2 multi-page builder architecture (#1116)`). Main had not advanced.
- **Branch:** `feature/cust-h2-1-page-presentation-schema`

## Scope

Implemented exactly the 11 items in CUST-H2-1's scope, from
`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`'s Implementation Slicing table:

1. Top-level schema version 2 → 3.
2. Optional `pagePresentation` namespace on `StorefrontPresentationConfig`.
3. Product page presentation contract (`ProductPageRegionKey`, 9 keys).
4. Category page presentation contract (`CategoryPageRegionKey`, 6 keys).
5. Shared Page Type Registry (`PageType = "home" | "product" | "category"`).
6. Shared Page Capability Registry (`PAGE_REGION_REGISTRY`, web-only — see "Capability registry scope" below).
7. PHP normalizer support (`App\Support\Commerce\StorefrontPresentationNormalizer`).
8. TypeScript normalizer support (both `web/` and `storefront/` twins).
9. Exact parity tests (mirrored PHP/TS test suites, same scenarios).
10. Fail-closed tests (unknown keys, cross-page-type keys, forward page-content schema).
11. Backward-compatibility tests (every pre-CUST-H2 document normalizes byte-identically).

No UI, no public Product/Category runtime wiring, no preview picker, no new API, no DB
migration, no CUST-H2-2/H2-3/H2-4/H2-5 work — all confirmed out of scope and untouched.

## Files changed

**PHP (single normalizer, no separate registry class — see rationale below):**
- `app/Support/Commerce/StorefrontPresentationNormalizer.php` — `VERSION` 2 → 3;
  `PAGE_TYPES`, `PRODUCT_PAGE_REGION_KEYS`, `CATEGORY_PAGE_REGION_KEYS`,
  `FIXED_REQUIRED_PRODUCT_REGION_KEYS`, `FIXED_REQUIRED_CATEGORY_REGION_KEYS` constants;
  `normalizePagePresentation()` / `normalizePageTypePresentation()` / `normalizePageRegions()`.

**TypeScript — twin-mirrored in `web/src/modules/store-experience-builder/presentation/`
and `storefront/src/lib/presentation/`** (same discipline as the existing
`section-content.ts` twin):
- `page-regions.ts` (**new**) — Page Type Registry, closed region-key unions,
  `PageRegionInstance<K>`/`ProductPagePresentation`/`CategoryPagePresentation`/
  `PagePresentation` types, `normalizePagePresentation()`.
- `tokens.ts` — `PRESENTATION_CONFIG_VERSION` 2 → 3.
- `config.ts` — `pagePresentation?: PagePresentation` added to
  `StorefrontPresentationConfig`; wired into `normalizePresentationConfig()`.
- `capabilities.ts` — `PRODUCT_PAGE_PRESENTATION_CAPABILITY` /
  `CATEGORY_PAGE_PRESENTATION_CAPABILITY`, both `"design_only"`.
- `index.ts` — barrel export for the new file(s).

**TypeScript — web-only** (Customizer/editor concept, not mirrored to the public
storefront, same split as `section-capabilities.ts` vs. Home's normalizer):
- `web/.../presentation/page-region-registry.ts` (**new**) — the rich
  `PageRegionCapability` interface and `PAGE_REGION_REGISTRY`, populated for
  `product`/`category` from the architecture doc's two region-contract tables.

**Tests:**
- `tests/Feature/StorefrontPresentationNormalizerTest.php` — 13 new test methods.
- `tests/Feature/StorefrontPresentationLegacyCompatibilityForkTest.php` — one
  pre-existing assertion hardcoded the literal `2` for "the current schema version
  after a Version save"; fixed to reference `StorefrontPresentationNormalizer::VERSION`
  like every other assertion in that file already does (see "Pre-existing test fix" below).
- `tests/Fixtures/presentation/default-config.json` — `"version"` 2 → 3 (this fixture
  is compared against `defaultConfig()`'s literal output).
- `web/src/modules/store-experience-builder/__tests__/page-presentation.test.ts` (**new**),
  `storefront/src/lib/presentation/__tests__/page-presentation.test.ts` (**new**) —
  mirrored scenarios (absence/backward-compat, fail-closed drops, FIXED_REQUIRED
  forcing, round-trip stability), the "exact parity tests" scope item.

## Key design decisions

### `pagePresentation` is genuinely optional and omitted, not `{}`, when absent

Per the architecture doc: "Absent → the normalizer produces `undefined`/omits it
entirely." Both TS normalizers conditionally spread the key
(`...(pagePresentation ? { pagePresentation } : {})`); the PHP normalizer only adds
the key to the returned array when non-null. Verified directly: normalizing any
document without `pagePresentation` (including every existing pre-CUST-H2 document)
produces no `pagePresentation` key at all — not an empty object — so the JSON
persisted to `storefront_presentation_versions.config` is unaffected for every
tenant who has not touched this feature.

### `content` is always dropped in this slice

`PageRegionInstance.content?: Record<string, unknown>` exists in the type (so the
later slice that gives it real per-region shapes is additive, not a rename), but
the normalizer unconditionally omits it in CUST-H2-1. No typed per-region content
contract exists yet (that's CUST-H2-3/H2-4 scope); accepting an untyped free-form
bag before that contract exists would be the one thing every other branch of this
normalizer refuses to do. Covered by
`region_content_is_always_dropped_in_this_slice` (PHP) and its TS twin.

### `variant_selector` is never forced visible by the normalizer

Every other FIXED_REQUIRED region (`media_gallery`, `identity`, `price`,
`quantity_cta` for Product; `breadcrumbs`, `identity_title`, `filter_sort_bar`,
`product_grid` for Category) is forced back to `visible: true` regardless of
client input. `variant_selector`'s FIXED_REQUIRED-ness is conditional on a specific
product's `hasVariants` — data the document-level normalizer has no access to (this
is a schema document, not tied to one product). Enforcing that condition is a
public-runtime concern for CUST-H2-5, not something this slice's normalizer can
honestly claim to do. Covered by
`variant_selector_is_not_forced_visible_because_it_is_data_dependent`.

### `CategoryPageRegionKey` has 6 members, not 7 — `"pagination"` excluded

The architecture doc's illustrative type alias (§"Page Type Registry" /
"Proposed Multi-Page Presentation Model") lists
`"pagination"` as a `CategoryPageRegionKey` member, but neither its own detailed
"Category Page Region Contract" table nor the `CUST-H2-ARCH-1-REPORT.md`'s
"Category Page Region Map" summary give `pagination` a row — both describe
pagination as a property of `product_grid` ("infinite-scroll pagination is
commerce-authoritative, not a presentation choice in H2 V1"), not an independent
region. Since the Page Capability Registry's own contract requires every key to
carry a full capability record (state/requirement/dependency/etc.), and no such
record exists anywhere for `pagination`, including it as a bare enum member would
leave a hole in the very registry this slice exists to populate. Resolved by
following the two fully-specified sources (the detailed table and the report
summary) over the shorthand type alias, which reads as an unreconciled draft
artifact. This is a documentation-internal inconsistency, not a re-opening of the
architectural decision — the Category region *set* the two authoritative tables
agree on (`breadcrumbs`, `identity_title`, `description`, `subcategories_rail`,
`filter_sort_bar`, `product_grid`) is implemented unchanged.

### Capability registry scope: rich `PAGE_REGION_REGISTRY` is web-only

Home's own equivalent (`SECTION_CAPABILITIES` in `section-capabilities.ts`) is
already web-only — the public storefront's normalizer twin has no picker, no
`previewRenderer`/`publishedRenderer` naming need, and no Add/Duplicate UI concept.
The new `PAGE_REGION_REGISTRY` (with `previewRenderer`, `publishedRenderer`,
`fallbackBehavior`, etc.) follows the same split. What the storefront's normalizer
*does* need — the closed key lists and the FIXED_REQUIRED sets, for correct
fail-closed normalization — lives in `page-regions.ts`, twin-mirrored exactly like
`section-content.ts` already is. `page-region-registry.ts` imports its key lists
from `page-regions.ts` rather than re-declaring them, so there is exactly one place
that enumerates "what regions exist for this page type" and the two files cannot
drift apart.

`previewRenderer`/`publishedRenderer` values were taken from direct inspection of
`storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx`,
`.../c/[...permalink]/CategoryBanner.tsx`, and
`storefront/src/components/products/ProductListing.tsx`'s actual imports (`MediaGallery`,
`VariantPicker`, `ProductCustomFields`, `Breadcrumbs`, `ListingFilterBar`,
`InfiniteProductList`) rather than invented — several Product regions (identity,
price, availability, quantity_cta, description, sku_options_details) are inline
JSX inside `ProductDetails.tsx` with no extracted component, and are named as such
rather than attributed to a component that doesn't exist.

`responsiveConstraints` and `accessibilityRequirements` are `null` for every region:
per-region responsive/accessibility verification is CUST-H2-2+ work (Playwright
evidence, per the architecture doc's own sections), not something this schema-only
slice can honestly claim.

### Why VERSION had to bump everywhere in the same slice, not just where `pagePresentation` is read

The web Customizer always writes `version: PRESENTATION_CONFIG_VERSION` on every
save (existing behavior, unchanged). If only the web normalizer bumped to 3 while
the storefront's public-read normalizer stayed at `VERSION = 2`, the very next
merchant save through the Customizer — even one that never touches
`pagePresentation` — would produce a document tagged `version: 3`, which the
storefront's forward-schema fail-closed rule (an H1 invariant, correctly still
protecting the system) would then reject to AWJ Modern defaults, breaking that
merchant's live published storefront. All three normalizers (PHP, web TS,
storefront TS) bump together in this one slice for exactly this reason, even
though the storefront does not render `pagePresentation` at all yet.

## Pre-existing test fix

`StorefrontPresentationLegacyCompatibilityForkTest::draft_only_edits_do_not_change_how_a_migrated_v1_published_snapshot_is_normalized`
asserted `assertSame(2, (int) $refreshedHead->schema_version, ...)` where every
other assertion of "the current normalizer version" in that same file already uses
`StorefrontPresentationNormalizer::VERSION`. This one call site hardcoded the
literal instead. Bumping `VERSION` to 3 correctly changed the real behavior (the
shared `schema_version` column now advances to 3, not 2, after a Version save) —
the fix makes the assertion reference the constant like its neighbors, not a
behavior change. Confirmed passing after the fix; not touched for any other reason.

## Tests

### Backend (this session, SQLite)

```
php artisan test --filter=StorefrontPresentationNormalizerTest
# 31 passed (157 assertions)

php artisan test --filter=StorefrontPresentation
# 191 passed, 1 skipped (PostgreSQL-only concurrency test) — zero failures after the
# pre-existing-test fix above

php artisan test --filter="BranchIsolationGuardTest|CommerceModuleBoundaryTest|CompanyTest"
# 12 passed initially with one flaked failure traced to a stray concurrent SQLite
# writer from an earlier mis-launched background run in this same session
# (unrelated migration, "database is locked"); re-run alone: 6/6 passed clean.

php artisan test <every *Test.php file except Fuel*/R2*/ProductMediaR2*>
# see below — full-suite result, same exclusion this repo's own CUST-H1 closure
# report documents (missing bcmath / AWS SDK in this dev container; CI installs
# both and is unaffected)
```

### Frontend (this session)

```
cd web && npx vitest run
# 324 test files, 2398 tests passed

cd web && npx tsc --noEmit -p tsconfig.json
# 15 pre-existing errors (products/documents/import-jobs/platform/pos modules,
# same count and same files as CUST-H1's own closure report), 0 in any file this
# slice touches

cd web && npm run build
# production build green, all pages compiled

cd storefront && pnpm install --frozen-lockfile   # storefront had no node_modules
cd storefront && npx vitest run
# 106 test files, 711 tests passed

cd storefront && npx tsc --noEmit -p tsconfig.json
# 0 errors

cd storefront && npm run build
# production build green, all pages compiled
```

**Zero regressions found** in either frontend app's full test suite, typecheck, or
build, and in the backend's Storefront/Presentation-scoped and branch/commerce/
company-scoped test files.

## Accounting

No new financial operation is introduced by this slice — `pagePresentation` is a
presentation-only document namespace (structural region order/visibility), never
routed through `LedgerService`, never touching `journal_lines`/`journal_entries`,
and carrying no money. No journal entry table applies.

## Risks / Follow-ups (recorded, not fixed here)

- The `CategoryPageRegionKey`/`pagination` inconsistency in
  `CUST-H2-ARCH-1-PAGE-CONTRACT.md` (see "Key design decisions" above) is worth a
  one-line correction in that document itself so a future reader doesn't re-trip on
  it; not made in this PR since the task scoped this as an implementation slice,
  not an architecture-document edit.
- `page-region-registry.ts`'s `previewRenderer`/`publishedRenderer` free-text values
  describing inline JSX (e.g. `"ProductDetails (inline price/compare-at,
  HiddenPricePrompt)"`) are documentation aids for CUST-H2-3/H2-4, not a contract
  any code currently reads — a future slice that extracts these into named
  components should update the registry text to match, not treat it as frozen.
- `storefront` had no installed dependencies in this environment; installed via
  `pnpm install --frozen-lockfile` (already tracked by the existing
  `pnpm-lock.yaml`, no lockfile change) purely to run its test suite in this
  session — not a repository change.

---

*No DB migration, no UI, no public Product/Category runtime wiring in this slice —
exactly CUST-H2-1's scope per `CUST-H2-ARCH-1-PAGE-CONTRACT.md`'s Implementation
Slicing table.*
