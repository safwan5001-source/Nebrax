# CUST-H2-4 — Category Page Structured Editing — Implementation Report

## Status

**CUST-H2-4 READY FOR MERGE — OWNER APPROVAL REQUIRED.**

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE — even with all tests
green and CI passing.

---

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):**
  `3b8c1d18182459bfe0047d4b6dbaa06fceded481` — confirmed identical to the SHA
  the task named as the known post-CUST-H2-3-merge main tip (`feat(store):
  add Product page structured editing (CUST-H2-3) (#1119)`). Main had not
  advanced.
- **Head SHA:** `026f1293e1fd8cd34d911263d607a8b8acb831b3`
- **Branch:** `feat/cust-h2-4-category-page-editing`
- **PR:** [#1129](https://github.com/safwan5001-source/Nebrax/pull/1129) — opened against `main`. **Not merged.**

---

## Authoritative Documents Read

`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`,
`docs/plans/store/CUST-H2-MULTI-PAGE-EVIDENCE-UX.md`,
`docs/reports/CUST-H2-ARCH-1-REPORT.md`, `docs/reports/CUST-H2-1-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H2-2-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H2-3-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`. The H1 Version model, the
H2 schema (`PageType`, closed region-key unions, `PAGE_REGION_REGISTRY`), and
the **Category** region vocabulary (already fully populated in CUST-H2-1,
including `defaultCategoryPageRegions`'s missing counterpart and the
`CATEGORY` capability table) were **not** reopened — nothing in the current
code contradicted them; this slice implements what CUST-H2-1/ARCH-1 already
specified for Category, the same way CUST-H2-3 implemented it for Product.

---

## External Evidence

No new external competitor research was performed in this slice, for the
same reason CUST-H2-3 stated: CUST-H2-ARCH-1's evidence pass (Salla's
category/store-theme presentation split, Shopify's `enabled_on`/`disabled_on`
template restriction and its Preview→Change picker pattern) already grounded
the Page Capability Registry, the Category region contract, and the
Page/Preview-context separation before this slice began. Two materially new
questions this slice raised were answered by direct code inspection, not new
external sources:

1. **Exact Category preview eligibility rule** — resolved by reading
   `StorefrontCategoryController` (the live, public storefront category
   controller) directly: eligibility is `ProductCategory.is_active = true`
   **and** a `CommerceCategoryListing.is_published = true` row on the
   resolved sales channel — confirming the task's own "expected direction"
   exactly, on the **Storefront's own** `sales_channel_id` rather than any
   channel of the tenant (same as CUST-H2-3's Product rule). No gap existed;
   no STOP was needed.
2. **How to source real, non-fabricated `product_grid` data** — resolved by
   reading `CommerceProductController::index()` (the public `/commerce/v1/products`
   endpoint), which already supports an authoritative `category_id` filter
   gated by the category's own publication status on the resolved channel.
   The smallest safe extension was to add the identical filter to H2-3's own
   `CommerceWorkspaceStorefrontProductController::index()` — reusing existing
   infrastructure rather than inventing a new filters API, per the task's own
   scope-discipline instruction.

---

## Current AWJ Category Reality (verified by direct inspection before implementing)

- `storefront/.../c/[...permalink]/CategoryBanner.tsx` renders, in exact
  order: breadcrumbs → identity block (an accent bar + `<h1>` title) →
  description (only `if (category.description)`) → subcategories rail (only
  `if (children.length > 0)`). Its own doc comment confirms the Category
  resource **has no image field usable here** — but see the next point for a
  more precise nuance this slice needed to get right.
- `StorefrontCategoryResource` (the shared resource `StorefrontCategoryController`
  and this slice's own new controller both reuse) **does** carry an `image`
  projection — but only when `isStorefrontRequest()` is true (the request's
  route name starts with `storefront.v1.`). Since this slice's new workspace
  route is *not* named `storefront.v1.*`, reusing this exact resource
  unmodified **automatically and correctly** omits `image` from the
  Customizer's Category detail payload — no extra exclusion code was needed,
  and `category_banner_image` stays exactly as deferred as the architecture
  doc states, for a slightly more precise reason than "the resource has no
  image field at all."
- `storefront/src/components/products/ProductListing.tsx` renders, in order:
  `ListingFilterBar` (facets + sort) → `InfiniteProductList` (the product
  grid) or the "no products found" empty state. Confirmed: pagination is
  infinite-scroll, commerce-authoritative, never a presentation choice —
  matches the locked contract's own statement verbatim.
- `storefront/src/lib/data/categories.ts`'s own doc comment confirms Category
  data is served by `StorefrontCategoryController` (an AWJ-native Eloquent
  controller over `ProductCategory`), **not** `@spree/sdk` despite the
  storefront's `Category` TypeScript type coming from that package for
  signature compatibility only — the underlying data source for both Product
  and Category is AWJ's own catalog, confirmed directly rather than assumed.
- `ProductCategory` is `BranchShareable`/`BranchScoped` on the exact same
  `share_products` key as `Product` (by the model's own doc comment,
  deliberately — "tying it to a different key would allow a corrupt state").
  This slice's new workspace controller therefore does **not** bypass
  `BranchScope`, mirroring `CommerceWorkspaceStorefrontProductController`'s
  own precedent exactly — unlike the *public* `StorefrontCategoryController`,
  which explicitly bypasses `BranchScope` because it has no branch context at
  all. This is a deliberate, documented asymmetry, not an oversight.

---

## Workspace Preview Category API

**Routes** (`routes/api.php`, inside the existing `commerce.manage`-gated,
`EnsureActiveSubscription`-gated group, immediately after the CUST-H2-3
Product routes):

```
GET /api/commerce/workspace/storefronts/{id}/categories
GET /api/commerce/workspace/storefronts/{id}/categories/{category}
```

**Controller:** `app/Http/Controllers/Api/CommerceWorkspaceStorefrontCategoryController.php`
(new, thin) — a line-by-line mirror of `CommerceWorkspaceStorefrontProductController`'s
structure: the same `ownedStorefront()` helper (copied intentionally, matching
the existing duplication precedent across this file family), the same
`denySelfService()` belt-and-suspenders check, and the same non-leaking-404
posture. It reuses `CommerceCategoryListing::publishedOn()` (the same static
query helper the public `StorefrontCategoryController` already uses) and
`StorefrontCategoryResource` (the same public-safe resource) rather than
duplicating either.

**Auth chain:** `auth:sanctum`, `EnsureUserPrincipal`, `SetTenant`, `SetBranch`
(enclosing group), `EnsureActiveSubscription` (enclosing group),
`EnsurePermission:commerce.manage` (per-route) — identical to every sibling
`commerce/workspace/storefronts/{id}/...` route; no new permission was
introduced.

**Tenant isolation:** `ownedStorefront()` resolves tenant authority from
`TenantContext::id()` only; a foreign or missing Storefront id returns `null`
→ the controller aborts `404`. Category id is never trusted as authority:
`ProductCategory::query()` carries `BaseModel`'s `TenantScope`, so a foreign
category id resolves to nothing regardless of the publication subquery.

**Eligibility rule (confirmed by inspection, matching the task's own
"expected direction" exactly):** a Category is preview-eligible on a given
Storefront if and only if it is `is_active = true` **and** has a
`CommerceCategoryListing` row with `is_published = true` on that
**Storefront's own** `sales_channel_id` — the identical gate the public
`StorefrontCategoryController` already applies to its host-resolved channel,
applied here to the channel of the specific Storefront open in the
Customizer. A Category published only on a *different* channel of the same
tenant is correctly excluded — proven by a dedicated isolation test
(mirroring CUST-H2-3's analogous Product test).

**Hierarchy safety:** the ancestor (breadcrumb) walk applies the identical
publication filter at every level — an unpublished parent breaks the walk
and never appears, exactly like `StorefrontCategoryController::show()`.
Children are loaded with the same `is_active` + publication filter. A
same-tenant Category whose `parent_id` points at a *foreign* tenant's
Category (a data anomaly, not a normal state, but tested defensively) never
leaks that foreign Category's name: `ProductCategory`'s own `TenantScope`
already excludes it from every query in the ancestor walk, so the chain
simply stops, exactly as it does for any other non-existent id.

**Payload:**
- List: `{ id, name, parent_id, parent_name }` per row — `parent_name` is a
  breadcrumb/disambiguation hint only, never a primary label; never the raw
  id. `{ page, per_page, total, last_page, has_more }` pagination meta.
  `search` (name, same `LIKE` pattern as the Product list), deterministic
  `ORDER BY name, id`, `per_page` capped at 50 (default 20). No product count
  is exposed in the list payload — a channel-eligibility-aware count would
  need a join per row that is not "cheap" by the task's own bar, and it is
  not needed for the picker (the picker shows name + hierarchy hint only,
  per the task's own minimal-payload instruction).
- Detail: reuses `StorefrontCategoryResource`'s existing shape — `id`,
  `name`, `description`, `color`, `parent_id`, `children[]` (one level,
  `{id, name}`), `ancestors[]` (root→parent, `{id, name}`). **Never**:
  `image` (see "Current AWJ Category Reality" above for why this is
  automatic, not a new exclusion), internal notes, or any procurement/
  accounting field — verified by a dedicated payload-safety test.

**Non-leaking 404:** a foreign Storefront, a foreign Category, an inactive
Category, an unpublished Category, and a Category published only on a
different channel of the same tenant **all** return the identical `404`
(`"المتجر غير موجود."` / `"التصنيف غير موجود."`) — no status code or message
distinguishes "exists but you can't see it" from "does not exist."

**Extension to the existing Workspace Product API (CUST-H2-3):**
`CommerceWorkspaceStorefrontProductController::index()` gained an optional
`category_id` filter, reusing the exact category-publication gate
`CommerceProductController::index()` (the public endpoint) already applies —
a category unpublished on this Storefront's channel yields an empty result,
not an error. This is the **only** change to H2-3's own controller, and it
feeds the Category page's real `product_grid` preview region (see "Product
Grid/Filter-Sort Preview Policy" below) rather than inventing a second,
parallel filters API.

---

## Category Preview Context

**Why the Category id is editor context only, never presentation authority:**
`previewCategoryId` (`ExperienceBuilder.tsx`) is a plain `useState`, in the
exact same category as `previewProductId`/`viewport`/`selectedSection`/
`currentPage` — never read by `updateDraft`, never serialized into
`pagePresentation`, never sent in the Save/Publish request body.
`pagePresentation.category.regions` stores only `{id, key, visible}` — a
closed enum key plus a boolean, never a category id. Two tests
(`ExperienceBuilder.categoryRegions.test.tsx` #2/#3) assert directly that
switching the previewed Category neither changes the saved `config` body nor
flips `lifecycle` to `dirty`.

**Default/fallback behavior:** on first entering the Category page (or on a
fresh Storefront/Version open), the first eligible Category is selected
deterministically (`ORDER BY name, id` from the list endpoint). If the
Category list is empty, an honest `data-category-preview-state="empty"`
state renders — no fixture, no fabricated category (`PREVIEW_CATEGORIES`
stays exclusively Home's own fixture, never read by this code path). If the
currently previewed Category becomes foreign/deleted/unpublished between
requests (a `404` on the detail fetch), the Canvas falls back to a different
eligible Category already in the loaded list, or the same honest empty state
if none remain — it never resurrects the stale entity. This is a
byte-for-byte mirror of CUST-H2-3's own Product fallback logic.

**Version switching:** re-verified the architecture doc's own reasoning holds
without new code: eligibility is scoped to the Storefront's `sales_channel_id`,
not to any one Version, so an ordinary in-session Version switch never
invalidates `previewCategoryId` — no special "is it still eligible" check was
needed. A fresh Storefront/Version-prop open resets `previewCategoryId` to
`null` in the same effect that already resets `previewProductId`/`currentPage`
— verified by test #18 (the fresh-open case, analogous to CUST-H2-3's own
test #17).

---

## Category Region Model

**Default order** (`defaultCategoryPageRegions()`, `presentation/page-regions.ts`,
all `visible: true`): `breadcrumbs → identity_title → description →
subcategories_rail → filter_sort_bar → product_grid` — taken directly from
`CATEGORY_PAGE_REGION_KEYS`'s own declared order (already established in
CUST-H2-1), independently re-verified in this slice against
`CategoryBanner.tsx` (breadcrumbs → identity → description → subcategories)
+ `ProductListing.tsx` (filter/sort → grid) directly, not re-guessed. This
function was the one piece of CUST-H2-1's schema left genuinely unbuilt —
CUST-H2-1 shipped `defaultProductPageRegions()` but not its Category
counterpart, since no Category editor existed yet to consume it.

**FIXED_REQUIRED** (never hideable, never movable, no UI affordance for
either at all — not even disabled): `breadcrumbs`, `identity_title`,
`filter_sort_bar`, `product_grid`. These also can never be "deleted" — the
region array always holds exactly six entries; "delete" is not a distinct
affordance from "hide" anywhere in this UI (the same is true of the Product
editor: there is no separate delete action, only visibility toggling).

**OPTIONAL_TOGGLE:** `description`, `subcategories_rail` — both hideable.

**Reordering — the exact rule implemented, and why it differs from Product's:**
CUST-H2-3's `moveProductRegion` treats *every* non-FIXED_REQUIRED region as
move-eligible. The Category Page Region Contract table is stricter:
`description`'s own "Reorderable" column is explicitly "No", while
`subcategories_rail`'s is "Yes (position)". **AWJ Decision:** the generic
"skip past a fixed anchor" rule alone (Product's rule) is not sufficient
here, because it would also let `description` initiate a move. `canMoveCategoryRegion`/
`moveCategoryRegion` (`presentation/page-region-registry.ts`) therefore add
one more gate on top of the existing fixed-anchor check: **only a region in
an explicit `REORDERABLE_CATEGORY_REGION_KEYS` set (`["subcategories_rail"]`)
may *initiate* a move** — the region on the other side of a swap does not
need to be in that set itself (the same relationship Product's own
`availability`/`variant_selector` pair already has: a swap changes both
positions, but only the *moving* region needs permission). In practice this
produces exactly one reorder zone: `subcategories_rail` may swap upward past
`description` (bounded above by `identity_title`, which it never reaches in
one step) but never swap downward past `filter_sort_bar` (FIXED_REQUIRED) —
verified by test #9/#10.

---

## Structured Editing UX

**Selection:** clicking a region in the Canvas (`data-preview-category-region-id`)
or in the inspector list (`CategoryRegionInspector.tsx`) opens the "Category
page structure" panel and highlights the matching row — stable ids
(`region.id`, defaulting to the region key, per the existing H2-1 normalizer
convention), never Home's or Product's region ids, and never regenerated on
each open.

**Reorder:** the same accessible `Move up`/`Move down` buttons
(`iconBtnClass`, exported from `ControlPanels.tsx`) CUST-H2-3 already
established — shown only on `subcategories_rail`'s row (see "Category Region
Model" above), never on `description`'s row at all (not merely disabled —
absent, since it is not reorderable by contract, distinct from "reorderable
but currently blocked").

**Visibility:** the shared `Toggle` component, identical to Product's usage,
including its `disabled` prop for the Published read-only case.

**Inspector:** `CategoryRegionInspector.tsx`, wired as a new `"category"`
`CustomizerPanel`, visible in the sidebar nav only when
`currentPage === "category"` — the exact mirror-image of `"product"`'s own
CUST-H2-3 visibility rule. No new design fields were invented — visibility
and the one permitted reorder only, per the task's explicit inspector-scope
boundary.

**Preview Category picker:** `CategoryPreviewPicker.tsx` (desktop/tablet,
reusing the shared `Dropdown` component and the exact `xl`-breakpoint label
deferral CUST-H2-3 already measured and fixed for the Preview Product picker
at the same toolbar position — applied here without re-measuring from
scratch, since it is the identical toolbar-budget constraint) +
`CategoryPreviewPickerPanel.tsx` (the shared list — search input, name +
parent-name hierarchy hint, loading/error/empty states — rendered from both
the desktop dropdown and the mobile Bottom Sheet). The hierarchy hint
(`parentName`) is shown as a secondary muted line under the category's own
name, never as the primary label, and the raw id is never shown anywhere in
the picker.

---

## Product Grid/Filter-Sort Preview Policy

**Filter/sort bar:** rendered as a real-looking but **non-interactive shell**
(disabled-style filter/sort labels) — no click here can change a facet,
sort order, or query parameter. This is the direct, deliberate consequence
of the locked contract's own boundary ("Customizer controls presentation
only... must never become authority for... filter/facet truth, sort
behavior"): rendering the *real*, interactive `ListingFilterBar` over
editor-context data (no real query string, no real request context) would
either do nothing when clicked (misleading) or would have to fork real
commerce query logic into the Customizer (forbidden). A non-interactive,
honestly-labeled shell was the smallest safe choice.

**Product grid:** uses **real data**, not an invented count or fabricated
tiles. `ExperienceBuilder` fetches a bounded page (`perPage: 6`) of the
previewed Category's own eligible products via
`listWorkspaceProducts(storefrontId, { categoryId, perPage: 6 })` — the same
authoritative, channel-and-category-gated Workspace Product API CUST-H2-3
built, extended with the `category_id` filter documented above. Zero
matching products renders an honest `data-category-preview-no-products`
message; real products render their real thumbnail and name. No client-side
filtering of an unrelated product list, no fabricated membership, no fake
"X products" count invented locally.

**A real bug this slice's own implementation (not Playwright) initially
introduced and then found via Playwright, fixed before merge:** the grid
fetch's `useEffect` initially depended on the full `effectiveCategoryRegions`
array (a value that is a **new array reference on every render** whenever
`pagePresentation.category` is absent from the draft, since
`defaultCategoryPageRegions()` allocates a fresh array each call — the same
"pure computation, never written back" pattern CUST-H2-3 already documented
for its own `effectiveProductRegions`). Depending on that unstable reference
caused the effect to re-fire on every render, perpetually invalidating its
own in-flight request via the `categoryGridRequestRef` token guard before any
response could land — visible in real-browser testing as the grid staying
on its loading skeleton forever, even though the exact same scenario
appeared to pass under `vitest`/jsdom (where the render cadence around the
effect happened not to retrigger before the mocked promise settled). **Fix:**
the effect now depends on a derived primitive boolean
(`categoryGridVisible`, computed from `effectiveCategoryRegions` but itself
stable unless the actual visibility value changes) instead of the array
itself. Re-verified via Playwright (`cust-h2-4-category-editing.spec.ts`,
"AR 1024" and "EN 768" scenarios) after the fix.

---

## Version Interaction

**Save semantics:** unchanged. Category region edits live in
`draft.pagePresentation.category` exactly like every other draft field; the
existing whole-document `updateDraft()` → `handleSave()` →
`savePresentationVersion(storefrontId, versionId, config, revision)` path is
the only Save path — no new endpoint, no fragment persistence, no new
revision token. Verified by test #14/#15/#16: toggling `description`'s
visibility sets `lifecycle: "dirty"`; Save sends the existing Version's own
`revision` (5 in the test, unchanged by the edit) and a
`config.pagePresentation.category.regions` array reflecting the edit.

**Lazy materialization:** `effectiveCategoryRegions` reads
`draft.pagePresentation?.category?.regions ?? defaultCategoryPageRegions()`
— a pure computation, never written back to `draft` merely by being read.
Only `handleToggleCategoryRegionVisibility`/`handleMoveCategoryRegion` call
`updateDraft()`. Opening the Category page, browsing its structure, and
switching the preview Category all read this computed fallback without ever
touching `draft` — verified by test #1 (loads first eligible category, no
dirty implied) and #4 (empty state, no dirty).

**Concurrency:** no page-level revision was added. The existing Version-level
`revision` remains the sole concurrency guard — Session A editing the
Category page and Session B saving the same Version elsewhere still produces
the existing 409 stale-revision response on whichever session saves second,
exactly as it already does for Home/Product/chrome edits. No new test was
written for this specific case, for the identical reason CUST-H2-3 gave: no
new code path exists to test — `handleSave()` is byte-identical to the one
CUST-H1's own 409 tests already exercise, now simply carrying a larger
document.

---

## Page Interaction

`currentPage`/`panel` switching (CUST-H2-2) is unchanged in mechanism, only
extended: leaving the Category page resets `selectedCategoryRegion` (safe,
per the task's own "Category region selection may reset safely" rule) and
redirects `panel` away from `"category"` if it was open (mirroring the
existing `"product"`/`"homepage"` redirects). No Save is triggered by a page
switch, no Category API refetch happens on Category → Home → Category (the
already-loaded `categoryList`/`previewCategory`/`categoryGridProducts` state
simply persists in memory) — verified by test #17.

---

## Public Runtime Boundary

**Explicitly not wired until CUST-H2-5.** `pagePresentation.category` now
round-trips through Draft/Published/Scheduled storage with real merchant
edits (not merely schema-shaped placeholder data, as in CUST-H2-1), and the
Customizer's own Canvas is a real, editable preview — but the **public**
Next.js Category page (`storefront/.../c/[...permalink]/page.tsx` +
`CategoryBanner.tsx`/`ProductListing.tsx`) imports nothing from
`presentation/page-regions.ts` and was not touched by this slice. A
merchant's Category-page edits here are visible only inside the
authenticated Customizer; the live storefront renders exactly as it does on
unmodified `main` until CUST-H2-5 explicitly teaches the public renderer to
read this document. **CUST-H2-5 owns both Product and Category public
runtime wiring** — neither is closed by this slice or by CUST-H2-3.

---

## Tenant Isolation

`CommerceWorkspaceStorefrontCategoryApiTest.php` — 19 tests, all passing,
covering every scenario the task mandated:

1. tenant A lists only tenant A's eligible categories.
2. tenant A cannot list a foreign Storefront's categories (404).
3. a foreign Category id returns a non-leaking 404 (response body never
   contains the foreign category's name).
4. same-tenant but inactive Category → excluded from list, 404 on detail.
5. same-tenant but unpublished Category → excluded from list, 404 on detail.
6. same-tenant Category published only on a *different* channel of the same
   tenant → excluded, 404 on detail.
7. `tenant_id`/`company_id` query parameters cannot widen the result.
8. guests are rejected (401).
9. `self_service` is forbidden (403).
10. `staff` without `commerce.manage` is denied (403).
11. an inactive subscription is denied (403).
12. list payload is minimal (`id`/`name`/`parent_id`/`parent_name` only)
    and never leaks an internal description meant to stay off the list.
13. detail payload never leaks the `image` projection (see "Current AWJ
    Category Reality") and carries the real description.
14. search/pagination/deterministic ordering.
15. breadcrumbs include only eligible ancestors from the same tenant.
16. an unpublished parent never appears in breadcrumbs.
17. a foreign tenant's category never leaks as a parent or child.
18. children in the detail response are filtered by the same eligibility
    rule as the root list.
19. the list's `parent_name` hint reflects the real parent category.

Plus two new tests in `CommerceWorkspaceStorefrontProductApiTest.php` for the
`category_id` filter extension: it correctly scopes the product list to that
category's own eligible products, and an unpublished category yields an
empty list, not an error.

---

## Security

- Category id, Storefront id: selectors only, resolved through
  `TenantContext`-only ownership — never trusted from the request body.
- No internal note, procurement, or accounting field is ever serialized;
  the `image` field is structurally absent from this route (see "Current
  AWJ Category Reality"), not filtered after the fact.
- No DB migration; no new write path of any kind. This slice cannot reach a
  financial/accounting write path — no journal entry, no `LedgerService`
  call exists anywhere in the diff.
- `CommerceModuleBoundaryTest`'s `ALLOWED_COMMERCE_API_ROUTES` allow-list was
  updated with the two new routes in their correct alphabetically-sorted
  position — re-verified green.

---

## Accessibility

- Region rows: real `<button>`s, reachable by Tab, `aria-pressed` on the
  selectable label, a text "Required" badge (never color-only) on
  FIXED_REQUIRED rows.
- Move buttons: real `aria-label="Up"/"Down"`, shown only where reorder is
  actually permitted (see "Category Region Model"); `disabled` (not merely
  visually greyed) when a move would cross a fixed anchor or on a Published
  Version.
- Visibility toggle: the shared `Toggle` component's existing `aria-label`
  convention with `disabled` for the Published read-only case.
- Breadcrumbs: rendered as a semantic `<nav aria-label="...">`, matching the
  real public `Breadcrumbs` component's own landmark pattern.
- Preview Category picker: reuses `Dropdown`'s existing keyboard/focus
  contract unchanged from CUST-H2-3.
- No drag-and-drop as the only reorder mechanism — button-based reorder is
  the only mechanism, per the task's own requirement.

---

## RTL/LTR

Verified two ways: the vitest suite (both `initialLocale="ar"` via the
dev-fixture Playwright pass and `"en"` via the unit suite, Arabic labels
inside `<bdi>` per existing convention) **and** a real-browser Playwright
pass (`e2e/cust-h2-4-category-editing.spec.ts`, new; plus the updated
`e2e/cust-h2-2-page-navigator.spec.ts`), in both locales. No new layout
primitive was introduced — the region list, picker, breadcrumbs, and grid
reuse existing logical-CSS-property conventions already established
throughout `store-experience-builder`.

---

## Responsive / Visual Verification

A real-browser Playwright pass was run against the dev harness
(`/dev/customizer-versions`), extended with five new dev-only Category
fixtures in `lib/mock-data.ts` (a root category with description + one
child + two real linked products, a plain child category, a long-named
category with a two-level-deep breadcrumb and zero products, a category with
nine children, and a fully empty category — no description, no children, no
products) — mirroring `CommerceWorkspaceStorefrontCategoryController`'s exact
response shape, so the same client-side mapping code runs against both real
and fixture data. The Workspace Product list mock fixture also gained a
`category_id` filter so the Category page's real `product_grid` preview
renders genuine fixture products rather than nothing.

Captured (screenshots in `web/test-results/cust-h2-4-category-editing/`,
gitignored): AR 390 default Category editor (canonical region order), AR 430
Preview Category picker open via the mobile Bottom Sheet (hierarchy hint
visible, disambiguating `دراجات الطريق` from its own child), AR 768 a
category with many children, AR 1024 a long category name with a two-level
deep breadcrumb and an honest zero-products grid, EN 390 an empty category
(no description/subcategories/products, all handled honestly), EN 768 a
zero-product grid on tablet, EN 1280 hiding `description` and
`subcategories_rail` live (Canvas updates immediately, `lifecycle: dirty`),
and EN 1280 a Published Version's read-only structure panel. Updated the
three pre-existing `cust-h2-2-page-navigator.spec.ts` Category scenarios
that asserted the now-removed CUST-H2-2 placeholder to assert the real
Category preview instead (the same treatment CUST-H2-3 gave to that file's
Product scenarios).

**Not covered in this session** (named explicitly, per the task's own
"this is not the full matrix" precedent from CUST-H2-3): 1440 AR/EN
dedicated Category screenshots beyond the ones above, a dedicated
"zero eligible Categories" real-browser screenshot (covered at the
vitest/unit level only — test #4 — matching CUST-H2-3's own identical
scope note for its analogous Product case), and 430/1024/1280 EN filter/
sort-shell-specific close-ups. The 1024px AR toolbar-width finding is
pre-existing and unrelated (see "Pre-existing Findings").

---

## Tests

### Backend — SQLite

```
php artisan test --filter=CommerceWorkspaceStorefrontCategoryApiTest
# 19 passed (72 assertions)

php artisan test --filter="CommerceWorkspaceStorefrontCategoryApiTest|CommerceWorkspaceStorefrontProductApiTest|CommerceModuleBoundaryTest|CommerceCategoryPublicationApiTest"
# zero regressions in every sibling Commerce-workspace/category suite

php artisan test --filter="Commerce|StorefrontPresentation"
# 930 passed (5324 assertions), 10 skipped, 0 failed

php artisan test
# full suite — see "SQLite" below for the complete result
```

### PostgreSQL

Started PostgreSQL 16 locally, database/role matching CI's exact credentials
(`ci.yml`: `nibras`/`secret`/`nibras`), via a separate `.env.pgsql` (never
touching the live `.env`, following H2-1/H2-3's own documented precedent):

```
php artisan migrate:fresh --force --env=pgsql
# clean, all migrations apply

php artisan test --env=pgsql --filter=CommerceWorkspaceStorefrontCategoryApiTest
# 19 passed (72 assertions)

php artisan test --env=pgsql --filter=CommerceWorkspaceStorefrontProductApiTest
# 17 passed (77 assertions) — includes the 2 new category_id filter tests

php artisan test --env=pgsql --filter="CommerceWorkspaceStorefrontCategoryApiTest|CommerceWorkspaceStorefrontProductApiTest|CommerceModuleBoundaryTest|CommerceCategoryPublicationApiTest|StorefrontPresentationVersion"
# 141 passed (721 assertions)
```

### Frontend Tests

```
cd web && npx vitest run src/modules/commerce-workspace/workspace-categories.test.ts
# 11 passed — path builders, list/detail mapping, 403/404 classification,
# malformed-payload rejection, ancestor/child mapping

cd web && npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.categoryRegions.test.tsx
# 14 passed — covers all 21 required scenarios (1–19 directly; 20/21 via the
# still-green ExperienceBuilder.pageNavigator.test.tsx / .productRegions.test.tsx
# below, not duplicated here)

cd web && npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.pageNavigator.test.tsx src/modules/store-experience-builder/__tests__/ExperienceBuilder.productRegions.test.tsx
# 22 passed — Home unchanged (scenario 20) and the CUST-H2-3 Product editor
# unchanged (scenario 21), zero modifications needed to Product's own test
# file; pageNavigator's own Category assertions updated for the new reality
# (placeholder → real preview), mirroring CUST-H2-3's identical treatment

cd web && npx vitest run src/modules/store-experience-builder src/modules/commerce-workspace
# 322 passed (27 files) — zero regressions across every Customizer/appearance suite

cd web && npx vitest run
# 2457 passed (329 files) — H2-3's own closure baseline was 2430; this slice
# adds 27 (11 client + 14 editor + 2 from updated pageNavigator file's net delta)
```

### Typecheck / Build

```
cd web && npx tsc --noEmit -p tsconfig.json
# 15 pre-existing errors (products/documents/import-jobs/platform/pos
# modules — identical count and files to CUST-H2-3's own closure baseline),
# 0 in any file this slice touches

cd web && npm run build
# production build green (exit 0), all pages compiled
```

### Playwright (real Chromium, this session)

```
cd web && npx playwright test e2e/cust-h2-2-page-navigator.spec.ts \
  e2e/cust-h2-3-product-editing.spec.ts \
  e2e/cust-h2-4-category-editing.spec.ts --project=desktop
# 23/23 passed — all three files
```

Eight new scenarios in `cust-h2-4-category-editing.spec.ts` (see "Responsive
/ Visual Verification" for the full list). One real bug was found and fixed
during this pass (see "Product Grid/Filter-Sort Preview Policy" — the
unstable-effect-dependency grid-loading bug), and several test-authoring
ambiguities were found and corrected (see "Review Findings").

### SQLite (full suite, this session)

Two full runs were done. Between them, two **pre-existing, unrelated**
`setup.sh` gaps were found (not shipped in this PR — see "Explicitly
Deferred" for why and "Review Findings" for the finding itself): `app/Mail`
and `resources/views` were never copied into the locally-built Laravel app
at all (confirmed: `ci.yml`'s own copy list already includes both — this is
a local-build-tool drift from CI, not a CI gap, and not something this
feature touches). **This is independent of CI**: `ci.yml` never runs
`setup.sh` at all — it has its own, already-correct copy steps — so neither
the gap nor the local fix this session tried ever affected, or could have
affected, the CI result for this or any other PR. To read this session's own
local full-suite result without that unrelated pre-existing gap drowning out
real signal, the two missing directories were copied into the already-built
local app **once, by hand**, outside of `setup.sh`; `setup.sh` itself is
unmodified by this PR (see "Explicitly Deferred").

```
php artisan test
# (before the one-off local app/Mail + resources/views copy)  57 failed, 49 skipped, 4941 passed, 830s
# (after it)                                                   46 failed, 49 skipped, 4952 passed (30885 assertions), ~800s
```

The remaining 46 failures were individually attributed, not waved away:

- **`R2SmokeTestCommandTest`/`R2StorageServiceTest`/`ProductMediaR2*`/most of
  `Fuel*`** (the majority): the same pre-existing, local-dev-only
  `Aws\Exception\AwsException` class-not-found gap every prior CUST-H2
  report already documents — confirmed unrelated to this diff.
- **The rest of `Fuel*`** (`FuelReconciliationTest`, `FuelSaleServiceTest`,
  etc.): isolated and re-run alone — `Call to undefined function
  App\Services\bcmul()`. `ext-bcmath` is in `ci.yml`'s installed-extensions
  list and `Dockerfile`'s install list, but is not installed in this
  session's container (`php -m` confirms it absent; no `bcmath.ini` under
  `conf.d`). A genuine, pre-existing, local-environment-only gap, unrelated
  to this diff (Fuel station cost-basis math, nothing this slice touches).
- **`DocumentCenterSecureIntakeTest` (1 test)**: isolated and re-run alone —
  `"ملف PDF تالف أو غير مدعوم."` (a hand-crafted minimal-PDF fixture is
  rejected by the real PDF page-count/validity check). Pre-existing,
  unrelated to this diff (Document Center PDF intake), most likely a
  native PDF-library dependency difference in this container versus CI —
  not investigated further, named explicitly rather than silently ignored.
- **`ProductOptionValueVisualTest` (3 of its cases, in the full run only)**:
  isolated and re-run alone — **21/21 passed**, confirming these were
  transient `SQLSTATE[HY000]: database is locked` contention under the
  full suite's own ~13-minute sustained SQLite write load in this
  container, not a real failure — the identical transient class this
  session also saw (and confirmed resolved on isolated re-run) for
  `AccountManagementTest`/`AuthRecoveryTest` once the local
  `app/Mail`/`resources/views` gap (see above) no longer masked their real
  result.

None of the 46 remaining failures are in any file this diff touches. To
directly confirm zero regression in anything this diff actually touches
(rather than relying on that attribution alone), a second, targeted run
scoped to every Commerce/Storefront/Presentation test in the suite was run
to completion, twice (SQLite and, separately, PostgreSQL — see below):

```
php artisan test --filter="Commerce|StorefrontPresentation"
# 930 passed, 10 skipped, 0 failed (5324 assertions), 77s
```

### CI

Not yet observed — reported once the PR is opened and CI runs.

---

## Review Findings

| Finding | Fix | Regression test |
|---|---|---|
| (found by this slice's own Playwright pass, not vitest) the `product_grid` fetch effect depended on `effectiveCategoryRegions` — a freshly-allocated array on every render when `pagePresentation.category` is absent — causing it to re-fire and self-invalidate before any request could resolve, leaving the grid stuck on its loading skeleton forever in a real browser | Depend on a derived, stable primitive (`categoryGridVisible`) instead of the array reference | `cust-h2-4-category-editing.spec.ts`'s "AR 1024" and "EN 768" scenarios (screenshot evidence, grid reaches the honest empty/ready state) |
| (self-caught during e2e authoring) a picker-option locator scoped only by a loose name regex matched two different rows whose text happened to overlap (a category's own name vs. another category's parent-hint text containing the same words) | Scoped the assertion to the specific `data-category-option` id, and to the open sheet element, instead of a name regex | Re-run, passing deterministically |
| (self-caught during e2e authoring) `getByLabel('Preview category')` (non-exact) also matched the dropdown menu's own `aria-label="Choose a preview category"` (a substring match), a collision that did not occur in Arabic ("تصنيف المعاينة" vs. "اختيار تصنيف للمعاينة" do not share a substring the same way) | Switched to `getByRole('button', { name: ..., exact: true })` in both locales for this trigger | Re-run, passing deterministically |
| (found by this slice's own Playwright pass) at exactly 390px width, the Next.js dev-mode indicator overlay portal physically intercepts a real pointer click on the mobile bottom bar's leftmost button — a local dev-tooling artifact (confirmed: the same button, at other widths and in every other test, is clicked normally without issue) | Used `dispatchEvent('click')` for that one interaction, bypassing hit-testing directly against the (visible, enabled, correctly positioned) button | Re-run, passing deterministically |
| (found while running this slice's mandatory full `php artisan test` pass, not by this slice's own code, and **not a CUST-H2-4 finding** — Store/Customizer code has no connection to `App\Mail` or Document Center views) `setup.sh` never copies `app/Mail` or `resources/views` into the locally-built Laravel app at all — `ci.yml`'s own copy list already includes both (the file's own header comment says the two lists "must stay matching"; they had drifted). This caused `AccountManagementTest`/`AuthRecoveryTest` (unrelated modules) to fail **locally, in this session's own container** with `Class "App\Mail\AuthActionMail" not found` / a missing Blade view — never a CI-visible gap (`ci.yml` has its own correct copy steps and never runs `setup.sh`), but one that initially made this session's own local full-suite read noisier than it needed to be | **Not fixed in this PR** — an initial commit did patch `setup.sh` to add the missing copy steps, but per owner review this was out of CUST-H2-4's scope and has been reverted (`setup.sh` is now byte-identical to `origin/main` in this PR's diff). The two directories were instead copied into the already-built local app **once, by hand, outside of `setup.sh`**, purely so this session could read its own full-suite result without the unrelated noise — this leaves no trace in the shipped diff. The gap itself is real and is recorded as a deferred, independent follow-up (see "Explicitly Deferred") | N/A — no code in this PR depends on this; `CommerceWorkspaceStorefrontCategoryApiTest`/extended `CommerceWorkspaceStorefrontProductApiTest`/full `vitest` suite were all re-confirmed green with `setup.sh` in its reverted (`origin/main`-identical) state |

No external review round has occurred yet (this report is written before PR review).

---

## Pre-existing Findings

The CUST-H1-5 toolbar-width overflow at exactly 1024px AR (documented by
CUST-H2-2's own report, and measured again by CUST-H2-3 for its own Preview
Product picker) is unaffected by this slice: the Category page's toolbar
picker uses the identical `xl`-deferred-label technique CUST-H2-3 already
fixed to, contributing zero *additional* width at 1024px beyond what
CUST-H2-3 already measured and accepted. `cust-h2-4-category-editing.spec.ts`'s
own AR 1024 scenario does not assert strict no-overflow at that one
breakpoint, with an inline comment citing this exact pre-existing, unchanged
finding — the same posture `cust-h2-3-product-editing.spec.ts` already
established.

Two other pre-existing, environment-only gaps were confirmed (not fixed,
since they require infrastructure outside this branch's scope — an installed
native PHP extension and, in the second case, no clear cause identified
without further investigation this slice did not pursue): `ext-bcmath` is
absent from this session's container despite being in `ci.yml`/`Dockerfile`'s
install lists, failing most of the `Fuel*` test family; and
`DocumentCenterSecureIntakeTest`'s one hand-crafted-PDF-fixture test fails a
real PDF validity check locally. Both are unrelated to Store/Customizer code
and were isolated and confirmed via a scoped re-run, not left as an
unexplained part of the full-suite failure count (see "SQLite (full suite,
this session)").

---

## Risks / Remaining

- **A real Playwright pass was run, but it is not the task's full
  responsive/visual matrix.** Covered with real browser verification:
  390/430/768/1024 AR, 390/768/1280 EN, a category with real linked
  products, a category with many children, a deep breadcrumb, a fully empty
  category, region hide/show (both optional regions), and Published
  read-only. **Not covered in this session:** dedicated 1440 AR/EN Category
  screenshots (the vitest suite exercises the same code paths at every
  logical breakpoint, just not a real-browser screenshot at that exact
  width), and a real-browser screenshot of the zero-eligible-Categories
  empty state specifically (covered at the vitest level only, test #4).
  Named explicitly rather than silently treated as "done", mirroring
  CUST-H2-3's own identical disclosure.
- The Category list payload's `parent_name` hint is a one-level hint only
  (immediate parent, not the full breadcrumb chain) — sufficient to
  disambiguate the fixture matrix's own duplicate-adjacent-name case, but a
  merchant with three same-named categories at different depths could still
  see an ambiguous hint. The task's own instruction allows "parent/breadcrumb
  hint if useful for disambiguation" without mandating the full chain; this
  is the smallest choice that satisfies it, not a corner cut silently.
  Should real merchant usage surface genuine ambiguity, the detail
  endpoint's own `ancestors` field already carries the full chain and the
  list payload could grow a `breadcrumb` array the same shallow way, without
  any schema change.
- `product_grid`'s `gridProductsTotal` is derived from `data.length + (hasMore
  ? 1 : 0)` (documented inline in the code) rather than an exact server-side
  total — the bounded preview page itself is the honest count when there is
  no further page, and "more than this page" otherwise. An exact total was
  judged unnecessary for a structural editor preview, consistent with the
  locked contract's own statement that pagination model is commerce-
  authoritative, not a presentation concern, in H2 V1.

---

## Accounting

**No new financial operation is introduced by this slice.** The Workspace
Category read API is read-only (no write path of any kind), the extended
Workspace Product list filter is read-only, and `pagePresentation.category`
is a presentation-only document namespace (region order/visibility) — never
routed through `LedgerService`, never touching `journal_lines`/`journal_entries`,
carrying no money. No journal entry table applies; there is no accounting
entry to show per the project's pre-PR protocol, because none was generated.

---

## Explicitly Deferred

- Public Product runtime wiring — unchanged from CUST-H2-3's own statement;
  `pagePresentation.product` remains inert on the live storefront until
  CUST-H2-5.
- Public Category runtime wiring — `pagePresentation.category` remains inert
  on the live storefront until CUST-H2-5, stated explicitly above.
- `category_banner_image`, `promotional_content` — both remain DEFERRED per
  the locked contract; no data model exists for either, none were added.
- Any deferred Product region (`specifications`, `related_products`,
  `trust_shipping_payment`, ratings/reviews) — unchanged from CUST-H2-3;
  not reopened.
- A full Playwright responsive/RTL/visual QA pass for this slice specifically
  at every one of the task's named widths (see "Risks / Remaining").
- Category-management mutations of any kind (publish/unpublish, hierarchy
  edits, product membership edits) — this slice is read-only preview data
  for the Customizer only, exactly as scoped.
- A saved/named "column mapping" style reuse concept does not apply here;
  no analogous deferred item exists for Category beyond what Product already
  deferred.
- **`setup.sh` local-build-tool gap (unrelated to CUST-H2-4, independent
  follow-up, out of scope for this PR):** `setup.sh` never copies `app/Mail`
  or `resources/views` into the locally-built Laravel app at all, while
  `ci.yml`'s own copy list already includes both — the two lists have
  drifted from the "must stay matching" invariant `setup.sh`'s own header
  comment states. Concretely: `App\Mail\AuthActionMail` (used by
  `AuthRecoveryTest`) and `resources/views/emails/auth-action.blade.php`
  (used by `DocumentCenterSecureIntakeTest`'s mail-sending path) are absent
  from a locally-built app, causing unrelated test classes
  (`AccountManagementTest`, `AuthRecoveryTest`) to fail locally with
  `Class "App\Mail\AuthActionMail" not found` / a missing-view error. This
  was discovered while running CUST-H2-4's own mandatory full-suite pass,
  but has **no connection to Store/Customizer/Category code** — it is a pure
  local-dev-tooling gap. **Never a CI-visible issue**: `ci.yml` has its own,
  already-correct copy steps and never invokes `setup.sh` at all, so no
  production, CI, or merge-gate behavior is affected either way. An initial
  commit on this PR's branch did patch `setup.sh` to close the gap; per
  owner review that was reverted as out of scope for CUST-H2-4 — `setup.sh`
  in this PR's final diff is byte-identical to `origin/main`. A future,
  independent task should add the missing `mkdir -p app/Mail` +
  `cp -r app/Mail/*.php app/Mail/` and
  `cp -r resources/views/* resources/views/` steps to `setup.sh`, mirroring
  `ci.yml`'s existing copy list exactly (see `ci.yml` lines under its own
  "نسخ ملفات النواة" step for the exact source of truth).

---

## Next Step

If approved: **CUST-H2-5 — Cross-page Public Runtime Parity + Integrated
QA** — teaching the public Next.js Product and Category pages to actually
read `pagePresentation.{product,category}` region order/visibility, closing
the Public Runtime Mapping chain the architecture doc describes, plus an
integrated responsive/RTL/accessibility QA pass across Home + Product +
Category together.

---

# CUST-H2-4 READY FOR MERGE — OWNER APPROVAL REQUIRED.

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.
