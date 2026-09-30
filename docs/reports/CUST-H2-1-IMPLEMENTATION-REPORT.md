# CUST-H2-1 — Presentation Schema + Page Registry Foundation — Implementation Report

## Status

**CUST-H2-1 READY FOR MERGE — OWNER APPROVAL REQUIRED.**

Implementation complete. No DB migration. No UI. No public Product/Category runtime
wiring. No preview-entity picker. No new API. Do not merge. Do not deploy. Do not
production release — even with all tests green and CI passing.

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):** `ce97b2d3367c954af5e353a4df058635fdfa1918` — confirmed identical to the SHA the task named as the known post-CUST-H2-ARCH-1-merge main tip (`docs(store): define CUST-H2 multi-page builder architecture (#1116)`). Main had not advanced.
- **Head SHA:** this report's own commit, on top of the Base SHA above.
- **Branch:** `feature/cust-h2-1-page-presentation-schema`
- **PR:** opened against `main` from this branch (link below, once opened).

## Implemented Scope

Exactly the 11 items in CUST-H2-1's own scope, from
`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`'s Implementation Slicing table.
No later CUST-H2 slice's work is included.

### Schema

- `StorefrontPresentationNormalizer::VERSION` (PHP) and `PRESENTATION_CONFIG_VERSION`
  (TS, both `web/` and `storefront/` twins) bump 2 → 3, additive-only.
- `pagePresentation?: PagePresentation` added to `StorefrontPresentationConfig`.
  **Optional and absent by default** — normalizing any document that doesn't set it
  (including every pre-CUST-H2 document) omits the key entirely from the output,
  never an empty `{}` shell. Verified in every normalizer twin.
- **Zero DB migration.** `pagePresentation` lives entirely inside the existing
  `config` JSON column on `storefront_presentation_versions`.
- `homepage`, the informational/CMS `pages` array, and every other existing
  top-level field are untouched, byte-for-byte.

### Product Page Presentation Contract

Closed `ProductPageRegionKey` union, 9 members, exactly the architecture doc's
Product Page Region Contract table:
`media_gallery`, `identity`, `price`, `availability`, `variant_selector`,
`quantity_cta`, `description`, `custom_fields`, `sku_options_details`.
`specifications`/`related_products`/`trust_shipping_payment` are **not** members —
no data model exists for them (confirmed by the architecture doc); they are not a
region until that capability exists, consistent with the exclusion list in the
task brief.

### Category Page Presentation Contract

Closed `CategoryPageRegionKey` union, **6 members**:
`breadcrumbs`, `identity_title`, `description`, `subcategories_rail`,
`filter_sort_bar`, `product_grid`. `category_banner_image`/`promotional_content`
are excluded per the task brief (no data model / no such region exists today).

**`pagination` is deliberately excluded — see "Verification against merged ARCH-1"
below**, per the task's own conditional instruction ("LIVE only if
architecture/current code explicitly treats it as a separate region; verify this
against the merged ARCH-1 before implementing; do not invent semantics beyond the
documented contract").

### Page Type Registry

```ts
export const PAGE_TYPES = ["home", "product", "category"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
```

PHP twin: `StorefrontPresentationNormalizer::PAGE_TYPES`. No `cart`/`checkout`/
`account`/`search`/informational page type added — the registry is expandable
later (each new `PageType` is one more optional key under `pagePresentation`, or
follows `home`'s existing `homepage` precedent) without touching this slice's
shape.

### Page Capability Registry

`web/src/modules/store-experience-builder/presentation/page-region-registry.ts`
(Customizer/editor-only — see "Capability registry scope" below) implements the
full `PageRegionCapability` contract (`key`, `allowedPageTypes`, `state`,
`requirement`, `maxInstances`, `canDuplicate`, `canDelete`, `canHide`,
`requiredDataDependency`, `fallbackBehavior`, `responsiveConstraints`,
`accessibilityRequirements`, `previewRenderer`, `publishedRenderer`), populated for
all 9 Product and 6 Category keys from the architecture doc's two region-contract
tables. `maxInstances = 1` and `canDuplicate = false` for every entry (no
repeatable Product/Category region in H2 V1). Home's own registry
(`SECTION_CAPABILITIES`/`GATED_HOME_SECTION_KEYS`/`MAX_HOME_SECTIONS`) is untouched
and not retrofit into this shape.

### PHP Normalizer

`App\Support\Commerce\StorefrontPresentationNormalizer` gains `PAGE_TYPES`,
`PRODUCT_PAGE_REGION_KEYS`, `CATEGORY_PAGE_REGION_KEYS`,
`FIXED_REQUIRED_PRODUCT_REGION_KEYS`, `FIXED_REQUIRED_CATEGORY_REGION_KEYS`, and
`normalizePagePresentation()` / `normalizePageTypePresentation()` /
`normalizePageRegions()`. No separate PHP registry class — see "Capability
registry scope" below for why that mirrors existing precedent.

### TypeScript Normalizer

Twin-mirrored in `web/src/modules/store-experience-builder/presentation/` and
`storefront/src/lib/presentation/`, exactly like the existing `section-content.ts`
twin:
- `page-regions.ts` (**new** in both) — Page Type Registry, closed region-key
  unions, `PageRegionInstance<K>` / `ProductPagePresentation` /
  `CategoryPagePresentation` / `PagePresentation` types, `normalizePagePresentation()`.
- `tokens.ts` — `PRESENTATION_CONFIG_VERSION` 2 → 3.
- `config.ts` — `pagePresentation?: PagePresentation` added to
  `StorefrontPresentationConfig`; wired into `normalizePresentationConfig()`.
- `capabilities.ts` — `PRODUCT_PAGE_PRESENTATION_CAPABILITY` /
  `CATEGORY_PAGE_PRESENTATION_CAPABILITY`, both `"design_only"` (schema exists,
  round-trips through Draft/Published storage, but no Customizer UI and no public
  runtime reads it yet).
- `index.ts` — barrel export for the new file(s).

## Verification against merged ARCH-1: `pagination`

The task brief explicitly required verifying `pagination`'s status against the
merged architecture before implementing it, rather than assuming either way. Direct
re-read of the merged `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`:

- Its illustrative type alias (§"Proposed Multi-Page Presentation Model") lists
  `"pagination"` as a `CategoryPageRegionKey` member.
- Its own detailed "Category Page Region Contract" table — the ground-truth,
  per-key table with Required?/Reorderable?/Hideable?/Duplicable?/Data
  dependency/Capability state columns — has **no row for `pagination`**.
- `product_grid`'s row states: *"pagination model (infinite scroll) is
  commerce-authoritative, not a presentation choice in H2 V1"* — describing
  pagination as a property of `product_grid`, not an independent region.
- `docs/reports/CUST-H2-ARCH-1-REPORT.md`'s own "Category Page Region Map" summary
  (FIXED_REQUIRED: `breadcrumbs`, `identity_title`, `filter_sort_bar`,
  `product_grid`; OPTIONAL_TOGGLE: `description`, `subcategories_rail`; DEFERRED:
  `category_banner_image`, `promotional_content`) also gives `pagination` no entry.

Conclusion: neither the merged architecture nor the current code treats
`pagination` as a separate region anywhere with actual capability data behind it.
Per the task's own rule ("do not invent semantics beyond the documented contract"),
`pagination` is **not** implemented as a `CategoryPageRegionKey` member. Recorded
as a one-line note worth fixing in the architecture doc itself (the bare type alias
should drop it to match its own table) — not made in this PR, which is scoped to
implementation, not an architecture-document edit.

## Capability registry scope: rich `PAGE_REGION_REGISTRY` is web-only

Home's own equivalent (`SECTION_CAPABILITIES` in `section-capabilities.ts`) is
already web-only — the public storefront's normalizer twin has no picker, no
`previewRenderer`/`publishedRenderer` naming need, and no Add/Duplicate UI concept.
The new `PAGE_REGION_REGISTRY` follows the same split. What the storefront's
normalizer *does* need — the closed key lists and the FIXED_REQUIRED sets, for
correct fail-closed normalization — lives in `page-regions.ts`, twin-mirrored
exactly like `section-content.ts` already is. `page-region-registry.ts` imports
its key lists from `page-regions.ts` rather than re-declaring them, so there is
exactly one place that enumerates "what regions exist for this page type."

`previewRenderer`/`publishedRenderer` values were taken from direct inspection of
`storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx`,
`.../c/[...permalink]/CategoryBanner.tsx`, and
`storefront/src/components/products/ProductListing.tsx`'s actual imports
(`MediaGallery`, `VariantPicker`, `ProductCustomFields`, `Breadcrumbs`,
`ListingFilterBar`, `InfiniteProductList`) rather than invented — several Product
regions (identity, price, availability, quantity_cta, description,
sku_options_details) are inline JSX inside `ProductDetails.tsx` with no extracted
component, and are named as such rather than attributed to a component that
doesn't exist. `responsiveConstraints`/`accessibilityRequirements` are `null` for
every region: per-region responsive/accessibility verification is CUST-H2-2+
Playwright work, not something this schema-only slice can honestly claim.

## Other key design decisions

### `content` is always dropped in this slice

`PageRegionInstance.content?: Record<string, unknown>` exists in the type (so a
later slice giving it real per-region shapes is additive, not a rename), but the
normalizer unconditionally omits it in CUST-H2-1. No typed per-region content
contract exists yet (CUST-H2-3/H2-4 scope); accepting an untyped free-form bag
before that contract exists would be the one thing every other branch of this
normalizer refuses to do.

### `variant_selector` is never forced visible by the normalizer

Every other FIXED_REQUIRED region is forced back to `visible: true` regardless of
client input. `variant_selector`'s FIXED_REQUIRED-ness is conditional on a specific
product's `hasVariants` — data the document-level normalizer has no access to (this
is a schema document, not tied to one product). Enforcing that condition is a
public-runtime concern for CUST-H2-5. Matches the task brief's own framing:
"conditionally required when variants exist; not merchant-hideable when dependency
exists" — `canHide`/`canDelete` are both `false` for this key in the registry, but
the *normalizer* does not fabricate the dependency check it cannot perform.

### Why `VERSION` had to bump everywhere in the same slice

The web Customizer always writes `version: PRESENTATION_CONFIG_VERSION` on every
save (existing behavior, unchanged). If only the web normalizer bumped to 3 while
the storefront's public-read normalizer stayed at `VERSION = 2`, the very next
merchant save through the Customizer — even one that never touches
`pagePresentation` — would produce a document tagged `version: 3`, which the
storefront's forward-schema fail-closed rule (an H1 invariant) would then reject to
AWJ Modern defaults, breaking that merchant's live published storefront. All three
normalizers (PHP, web TS, storefront TS) bump together for exactly this reason.

## Twin-Parity Evidence

No literal cross-runtime fixture-execution harness exists in this codebase for
PHP-vs-TS parity (confirmed: no such mechanism backs the existing v2 Home-section
normalizer either) — parity is proven the same way the existing suite already
proves it for Home: mirrored test files in each language asserting identical
scenarios against identical inputs. This slice follows that exact precedent:

| Scenario | PHP (`StorefrontPresentationNormalizerTest.php`) | web TS (`page-presentation.test.ts`) | storefront TS (`page-presentation.test.ts`) |
|---|---|---|---|
| Absent `pagePresentation` stays absent | ✓ | ✓ | ✓ |
| Empty/malformed `pagePresentation` collapses to absent | ✓ | ✓ | ✓ |
| Valid Product regions, id defaults to key | ✓ | ✓ | ✓ |
| Unknown / cross-page-type keys dropped | ✓ | ✓ | ✓ |
| Duplicate keys collapse to first occurrence | ✓ | ✓ | ✓ |
| FIXED_REQUIRED forced visible regardless of input | ✓ | ✓ | ✓ |
| `variant_selector` never forced visible | ✓ | ✓ | ✓ |
| `content` always dropped | ✓ | ✓ | ✓ |
| Forward page-content schema drops only that page type | ✓ | ✓ | ✓ |
| Round-trip stability | ✓ | ✓ | ✓ |

All three suites pass with the same semantics for the same inputs.

## Backward Compatibility

- Every pre-CUST-H2 document (any schema, any field combination) normalizes with
  **no** `pagePresentation` key present — not merely `undefined`, actually absent
  from the JSON — proven directly by
  `a_pre_cust_h2_document_normalizes_byte_identically_aside_from_the_version_bump`
  (PHP) and its TS twins.
- No Product/Category defaults are backfilled into an existing v2 document. Absence
  in, absence out.
- `homepage`, `pages`, chrome, branding, every other existing field: unchanged
  shape, unchanged normalization logic, unchanged tests (all still green).

## Forward-Schema Safety

Two independent fail-closed layers, both new to this slice, both additive to the
existing H1 invariant (never replacing it):

1. **Document-level (reused, not new):** a stored/declared `version` greater than
   the running normalizer's `VERSION` (now 3) fails closed to AWJ Modern defaults —
   exactly the existing H1 rule, now protecting schema 3 instead of 2.
2. **Page-content-level (new in this slice):** each `pagePresentation.{product,category}`
   sub-document carries its own `version: 1`; a value greater than 1 drops that
   page type's sub-document only (the other page type, if present, is unaffected) —
   because "page-content schema evolves independently of the document's top-level
   `version`" per the architecture doc's own Normalization section.

Searched explicitly for every other place a schema-version literal could hide:
`grep` for `'version' => 2`/`"version": 2` across `tests/Feature/*.php` found only
the one hardcoded assertion (see "Pre-existing test fix" below) and the intentional
v1-shaped *input* fixtures (`v1-default.json`, `v1-unsafe-input.json`, correctly
left at `1` — they represent legacy documents being fed in, not current output).
Every other reference to "the current schema version" in the whole test suite
already used the `StorefrontPresentationNormalizer::VERSION` constant, so the bump
propagated automatically and correctly everywhere else.

## H1 Lifecycle Compatibility

Beyond the schema-bump regression pass (full existing `StorefrontPresentation*`
suite unchanged and green), three new targeted tests prove `pagePresentation`
specifically — not just the version number — survives every H1 lifecycle
operation this schema bump touches:

- **Save + Duplicate** — `StorefrontPresentationVersionApiTest::save_persists_page_presentation_and_duplicate_copies_it_unchanged`:
  a Save with a Product `pagePresentation` (including a FIXED_REQUIRED region sent
  as `visible: false`) round-trips through the whole-document `PUT`, is forced back
  to `visible: true`, and a subsequent Duplicate copies that exact normalized
  `pagePresentation` verbatim.
- **Publish** — `StorefrontPresentationVersionPublishApiTest::publishing_a_version_with_page_presentation_preserves_it_unchanged`:
  a Category `pagePresentation` survives an immediate Publish into
  `published_config`, FIXED_REQUIRED forcing intact.
- **Schedule → scheduled-publish execution** — `StorefrontPresentationScheduledPublishJobTest::a_due_scheduled_version_with_page_presentation_publishes_it_without_information_loss`:
  a Product `pagePresentation` survives the full Schedule → due →
  `executeScheduledPublish()` path into `published_config`, exercising the same
  code path CUST-H1's dispatcher already tests, now with the new key present.

All three pass on SQLite and PostgreSQL (see Tests below). No page-level
concurrency was added — Version-level `revision` remains the sole concurrency
granularity, per the architecture doc's explicit decision; this slice does not
revisit that.

## Tenant Isolation Impact

None. This slice adds no endpoint, no controller, no route. `pagePresentation`
region content is a closed enum key + boolean `visible` + a client-supplied `id`
string only — it carries no `tenant_id`/`storefront_id`/`product_id`/`category_id`
field anywhere in its normalized shape, so it cannot become presentation authority.
The existing `StorefrontPresentationVersion` ownership model
(`TenantContext`-only authority, foreign/missing → 404) is untouched; every
existing tenant-isolation test in the Storefront/Presentation suite still passes
unmodified.

## Tests

### Backend — SQLite (this session)

```
php artisan test --filter=StorefrontPresentationNormalizerTest
# 31 passed (157 assertions)

php artisan test --filter=StorefrontPresentation
# 191 passed, 1 skipped (PostgreSQL-only concurrency test)

php artisan test --filter="BranchIsolationGuardTest|CommerceModuleBoundaryTest|CompanyTest"
# 12 passed clean (one earlier run in this session flaked on a stray concurrent
# SQLite writer from a since-corrected background-job mistake; re-run alone: clean)

php artisan test <every *Test.php file except Fuel*/R2*/ProductMediaR2*>
# 9 failed, 49 skipped, 4824 passed (30187 assertions), 536.63s
```

All 9 failures are in exactly 2 files — `AuthRecoveryTest` (8) and
`DocumentCenterSecureIntakeTest` (1) — both the exact pre-existing, unrelated,
local-dev-only gap `App\Mail\AuthActionMail` not found (`setup.sh` does not copy
`app/Mail/` into this container's assembled app; `deploy/assemble.sh` and
`.github/workflows/ci.yml`'s assembly step both do). This is the identical failure
signature `docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`'s own closure pass
independently documented (its "Tests" section: *"All 9 failures are in exactly 2
files — `AuthRecoveryTest` and `DocumentCenterSecureIntakeTest` — both the exact
pre-existing, unrelated local-dev-only gap"*) — re-confirmed here on top of this
slice's changes. **Zero failures in any Storefront/Presentation/Commerce/Branch/
Company-scoped test.**

`Fuel*`/`R2*`/`ProductMediaR2*` excluded per this repo's own documented precedent
(`docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`'s "Tests" section) — missing
`bcmath`/AWS SDK in this dev container only; CI installs both and is unaffected.

### Backend — PostgreSQL (this session)

PostgreSQL 16 started locally (`service postgresql start`), database/role created
matching CI's exact credentials (`ci.yml`: `nibras`/`secret`/`nibras`), run via a
separate `.env.pgsql` + `--env=pgsql` (never touching the live `.env` mid-run, after
an earlier mistake in this session briefly did exactly that and corrupted one
concurrent SQLite run — caught, diagnosed, and the corrupted run discarded and
re-run clean; see the git history of this session for the full trace if needed):

```
php artisan test --env=pgsql --filter=StorefrontPresentation
# 192 passed, 0 skipped (PostgreSQL runs the concurrency test SQLite skips)

php artisan test --env=pgsql --filter="StorefrontPresentationVersionApiTest|StorefrontPresentationVersionPublishApiTest|StorefrontPresentationScheduledPublishJobTest"
# 64 passed (365 assertions) — includes the 3 new H1-lifecycle pagePresentation tests
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

### CI

Not yet observed at PR-open time — this section will be updated once GitHub Actions
reports the `php artisan test (L11, sqlite)`, `php artisan test (L11, pgsql)`, and
`web build (Next.js)` checks for this PR's head commit.

### Review Findings

| Finding | Fix | Regression test |
|---|---|---|
| `StorefrontPresentationLegacyCompatibilityForkTest` hardcoded the schema-version literal `2` for "current normalizer version after a Version save," where every other assertion in the same file already references `StorefrontPresentationNormalizer::VERSION` | Changed the one call site to reference the constant, matching its neighbors | The test itself, re-run green after the fix; the bump to 3 is real, intended behavior, not masked |
| (self-caught, pre-review) A session mistake briefly wrote PostgreSQL credentials into the live `.env` while a SQLite full-suite run was executing in the background, corrupting that run (Laravel's `TestCase::createApplication()` re-reads `.env` per test class) | Restored `.env` immediately; created a separate `.env.pgsql` used only via `--env=pgsql`, never touching the shared `.env`; discarded the corrupted run and re-ran the full suite cleanly | The clean re-run's own result, reported above |

No reviewer has looked at this PR yet at report-writing time; this table will be
updated as real findings arrive.

## Risks / Remaining

- The `CategoryPageRegionKey`/`pagination` inconsistency between
  `CUST-H2-ARCH-1-PAGE-CONTRACT.md`'s illustrative type alias and its own detailed
  table (see "Verification against merged ARCH-1" above) is worth a one-line fix in
  that document; not made in this PR (implementation slice, not an architecture edit).
- `page-region-registry.ts`'s `previewRenderer`/`publishedRenderer` free-text values
  describing inline JSX are documentation aids for CUST-H2-3/H2-4, not a contract
  any code currently reads — a future slice extracting these into named components
  should update the registry text to match, not treat it as frozen.
- `storefront` had no installed dependencies in this environment; installed via
  `pnpm install --frozen-lockfile` (already tracked by the existing `pnpm-lock.yaml`,
  no lockfile change) purely to run its test suite in this session.

## Accounting

No new financial operation is introduced by this slice — `pagePresentation` is a
presentation-only document namespace (structural region order/visibility), never
routed through `LedgerService`, never touching `journal_lines`/`journal_entries`,
and carrying no money. No journal-entry table applies.

## Explicitly Deferred

Per the task brief and the architecture doc's own Implementation Slicing table —
none of the following exist in this slice:

- Page Navigator UI / `currentPage` editor state.
- Product page structured editing / region instance authoring UI.
- Category page structured editing.
- The Preview Product/Category picker (blocked on a confirmed-missing
  `commerce.manage`-scoped workspace catalog-read endpoint, per the architecture
  doc's own Gap Matrix — not this slice's dependency to resolve).
- Public Product/Category runtime wiring: `pagePresentation` is inert — the public
  Next.js Product/Category pages render exactly as they do today, with zero import
  of this new namespace anywhere in their component tree.

## Next Step

If approved: **CUST-H2-2 — Page Navigator + Page-aware Canvas Shell**, per the
architecture doc's Implementation Slicing table. Not started by this task.

---

# CUST-H2-1 READY FOR MERGE — OWNER APPROVAL REQUIRED.

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.
