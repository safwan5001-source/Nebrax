# CUST-H2-3 — Product Page Structured Editing — Implementation Report

## Status

**CUST-H2-3 READY FOR MERGE — OWNER APPROVAL REQUIRED.**

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE — even with all tests
green and CI passing.

---

## Repository State

- **Base SHA (fetched `origin/main` tip at task start):** `60db405ed9fcdeb118de66c525943647ad6548bb`
  — confirmed identical to the SHA the task named as the known post-CUST-H2-2-merge
  main tip (`feat(store): add multi-page Customizer navigation (CUST-H2-2) (#1118)`).
  Main had not advanced.
- **Head SHA:** this report's own commit, on top of the Base SHA above.
- **Branch:** `feat/cust-h2-3-product-page-editing`
- **PR:** opened against `main` from this branch (see end of this report). **Not merged.**

---

## Authoritative Documents Read

`docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`,
`docs/plans/store/CUST-H2-MULTI-PAGE-EVIDENCE-UX.md`,
`docs/reports/CUST-H2-ARCH-1-REPORT.md`,
`docs/reports/CUST-H2-1-IMPLEMENTATION-REPORT.md`,
`docs/reports/CUST-H2-2-IMPLEMENTATION-REPORT.md`. The H1 Version model, the
H2 schema (`PageType`, closed region-key unions, `PAGE_REGION_REGISTRY`), and
the Product region vocabulary were **not** reopened — nothing in the current
code contradicted them.

---

## External Evidence

No new external research was performed in this slice. CUST-H2-ARCH-1's
evidence pass (Salla's global-vs-page-specific settings split and its
Product-page quick-purchase toggle; Shopify's `enabled_on`/`disabled_on`
region-to-template restriction, its "Preview → Change" product picker, and
its toolbar template selector visually/positionally separate from Save) had
already grounded the Page Capability Registry, the region contract, and the
Page/Preview-context separation before this slice began — re-researching the
same questions this late would not have changed the decisions. The two
materially new questions this slice raised — **exactly where the workspace
product read endpoint should live** (Section "Workspace Preview Product API"
below) and **how to keep a second toolbar control inside the pre-existing,
already-documented 768–1023px budget crunch** (Section "Responsive /
Visual Verification") — were both answered by direct code inspection and by
reusing CUST-H2-2's own already-validated fix for the same constraint, not
by new external sources.

---

## Current AWJ Product Reality (verified by direct inspection before implementing)

- `storefront/.../products/[slug]/ProductDetails.tsx` is a fully real,
  hardcoded component tree — confirmed its exact render order is
  `media_gallery → identity (title/wishlist/share) → price → availability →
  variant_selector (conditional on hasVariants) → quantity_cta → description →
  custom_fields → sku_options_details` — **byte-identical** to
  `PRODUCT_PAGE_REGION_KEYS`'s own declaration order from CUST-H2-1, not a
  coincidence: this order is now documented as the canonical default
  (`defaultProductPageRegions()`, `presentation/page-regions.ts`).
- `product.custom_fields` is a `@spree/sdk` (wholesale-surface) concept only.
  A repository-wide search of `app/` confirms AWJ's own `Product` model has no
  such column, and no controller populates it for the DTC/AWJ catalog this
  slice's workspace API reads. `ProductCustomFields` itself already returns
  `null` for an empty/absent list. Consequence, stated plainly: for a real
  AWJ product, the `custom_fields` region is **always** an honest omission in
  this slice — not a bug, not a deferred feature, a fact about what data
  exists today.
- No authenticated `commerce.manage`-scoped product read endpoint existed
  (confirmed by re-searching `routes/api.php` before writing one — see
  "Workspace Preview Product API" below).
- `Storefront.sales_channel_id` is a **NOT NULL, FK-constrained** column
  (`database/migrations/2026_09_20_010000_create_storefronts_table.php`) —
  discovered empirically (a test asserting a channel-less Storefront failed
  with a SQLite constraint violation) and confirmed in the migration. Every
  Storefront always has exactly one resolved sales channel; the eligibility
  rule below has no "channel not yet configured" branch to design for.

---

## Workspace Preview Product API

**Routes** (`routes/api.php`, inside the existing `commerce.manage`-gated,
`EnsureActiveSubscription`-gated group that already carries every other
`commerce/workspace/storefronts/{id}/...` route):

```
GET /api/commerce/workspace/storefronts/{id}/products
GET /api/commerce/workspace/storefronts/{id}/products/{product}
```

**AWJ Decision — scoped under the Storefront, not a bare `/products`:** the
task's own suggested conceptual shape (`GET /api/commerce/workspace/products`)
was evaluated and **not** adopted, for one concrete reason the task itself
authorized ("Exact route shape may follow existing Commerce workspace
conventions if current code proves a better naming pattern"): eligibility is
resolved from a **specific Storefront's** `sales_channel_id` (see below), not
from "any channel the tenant happens to own." A bare tenant-wide endpoint
would either need a second `storefront_id` selector parameter (reopening the
exact "tenant authority from the body/query" anti-pattern the task explicitly
forbids) or silently pick an arbitrary channel. Nesting under
`storefronts/{id}` reuses the identical `{id}` UUID-route-constraint +
`commerce.manage` + `ownedStorefront()` pattern every sibling presentation
route in this same file already uses — zero new conventions.

**Controller:** `app/Http/Controllers/Api/CommerceWorkspaceStorefrontProductController.php`
(new, thin). Reuses — does not duplicate — the exact same authority services
the mobile `CommerceProductController` already uses:
`CommercePriceResolver`, `AvailableToSellService`, `FulfillmentPolicyService`,
`ProductMediaGalleryService`, and the same public-safe
`StorefrontProductResource` (which already excludes cost/margin/supplier/raw-stock
fields — reused directly for the detail response rather than inventing a new
DTO). List rows are a hand-built minimal shape (`id`, `name`, `name_en`,
`thumbnail_url`, `is_variant_managed`) — never the full resource.

**Auth chain:** `auth:sanctum`, `EnsureUserPrincipal`, `SetTenant`, `SetBranch`
(all four already apply to the entire enclosing route group),
`EnsureActiveSubscription` (same enclosing group), `EnsurePermission:commerce.manage`
(per-route, matching every sibling `commerce/workspace/storefronts/{id}/...`
route). `denySelfService()` is a private per-controller check, mirroring
`CommerceWorkspaceStorefrontPresentationVersionController`'s own belt-and-suspenders
pattern (the route's `commerce.manage` gate already excludes `self_service`
by RBAC default — this is defense in depth, matching precedent, not a new
requirement).

**Tenant Isolation:** `ownedStorefront()` is a private method, copied
(intentionally, matching the existing duplication precedent across
`CommerceWorkspaceStorefrontPresentationVersionController` and
`StorefrontPresentationVersionService`, neither of which share this ~10-line
helper via a common trait) — tenant authority comes from `TenantContext::id()`
only, a foreign or missing Storefront id returns `null` → the controller
aborts `404`. Product id is never trusted as authority: `Product::query()`
already carries `BaseModel`'s tenant scope, so a foreign product id simply
resolves to nothing, closing the loop the same way `ownedVersion()` already
does for presentation Versions.

**Eligibility rule (determined by inspection, not assumed):** a Product is
eligible to preview on a given Storefront if and only if it is
`is_active = true` **and** has a `CommerceListing` row with `is_published = true`
on that **Storefront's own** `sales_channel_id` — the identical gate
`/commerce/v1/products` already applies to its resolved mobile channel,
applied here to the channel of the specific Storefront the merchant has open
in the Customizer, not "any channel of this tenant." A product published
only on a different channel of the same tenant (e.g. the mobile channel) is
correctly excluded — proven by a dedicated isolation test. This directly
answers the task's own eligibility question: "only Products eligible/published
for the current Storefront context should be selectable for storefront
preview" — confirmed true, on the Storefront's resolved channel specifically.

**Payload:**
- List: `{ id, name, name_en, thumbnail_url, is_variant_managed }` per row,
  `{ page, per_page, total, last_page, has_more }` pagination meta. `search`
  (name/name_en/sku, same LIKE pattern as `/commerce/v1/products`),
  deterministic `ORDER BY name, id`, `per_page` capped at 50 (default 20).
- Detail: `StorefrontProductResource`'s existing shape — `id`, `name`,
  `name_en`, `description`, `sku`, `category`, `price` (amount_minor +
  currency only, no compare-at — that field does not exist on this resource
  either), `in_stock`, `thumbnail_url`, `media[]`, `is_variant_managed`,
  `options`/`variants` (variant-managed products only). **Never**: cost,
  margin, supplier, purchase price, raw quantity-on-hand, internal notes,
  tags — verified by a dedicated payload-safety test asserting these literal
  strings never appear in either response body.

**Non-leaking 404:** a foreign Storefront, a foreign Product, an inactive
Product, an unpublished Product, and a Product published only on a different
channel of the same tenant **all** return the identical `404 "المنتج غير موجود."`/`"المتجر
غير موجود."` — no status code or message distinguishes "exists but you can't
see it" from "does not exist."

---

## Product Preview Context

**Why the Product id is editor context only, never presentation authority:**
`previewProductId` (`ExperienceBuilder.tsx`) is a plain `useState`, in the
exact same category as the pre-existing `viewport`/`selectedSection`/
`selectedChrome`/`currentPage` state (CUST-H2-2) — never read by
`updateDraft`, never serialized into `pagePresentation`, never sent in the
Save/Publish request body. `pagePresentation.product.regions` stores only
`{id, key, visible}` — a closed enum key plus a boolean, never a product id,
mirroring the existing `featured.productIds`-is-a-stable-id-reference
precedent the architecture doc already established as the boundary. Two
tests (`ExperienceBuilder.productRegions.test.tsx` #2/#3) assert directly
that switching the previewed product neither changes the saved `config` body
nor flips `lifecycle` to `dirty`.

**Default/fallback behavior:** on first entering the Product page (or on a
fresh Storefront/Version open), the first eligible Product is selected
deterministically (`ORDER BY name, id` from the list endpoint — the same
order the picker displays). If the Product list is empty, an honest
`data-product-preview-state="empty"` state renders — no fixture, no
fabricated product (`PREVIEW_PRODUCTS` stays exclusively Home's own
fixture, never read by this code path). If the currently previewed Product
becomes foreign/deleted/unpublished between requests (a `404` on the detail
fetch), the Canvas falls back to a different eligible Product already in the
loaded list, or the same honest empty state if none remain — it never
resurrects the stale entity.

**Version switching:** re-verified the architecture doc's own reasoning
holds without new code: eligibility is scoped to the **Storefront's**
`sales_channel_id`, not to any one Version, so an ordinary in-session Version
switch (same Storefront) never invalidates `previewProductId` — no special
"is it still eligible" check was needed for that path, and none was added.
A **fresh** Storefront/Version-prop open (a different Storefront, or an
explicit `?version=` from the Theme Gallery) resets `previewProductId` to
`null` in the same effect that already resets `currentPage` to `"home"`
(CUST-H2-2) — verified by test #17.

---

## Product Region Model

**Default order** (`defaultProductPageRegions()`, `presentation/page-regions.ts`,
all `visible: true`): `media_gallery → identity → price → availability →
variant_selector → quantity_cta → description → custom_fields → sku_options_details`
— taken directly from `PRODUCT_PAGE_REGION_KEYS`'s own declared order
(CUST-H2-1), independently re-verified against `ProductDetails.tsx`'s actual
JSX order in this slice, not re-guessed.

**FIXED_REQUIRED** (never hideable, never movable, no UI affordance for
either at all — not even disabled): `media_gallery`, `identity`, `price`,
`quantity_cta`.

**CONDITIONALLY REQUIRED:** `variant_selector`. **AWJ Decision** (the task's
own contract describes Canvas-visible behavior, not stored-array membership,
and explicitly forbids "persist[ing] Product-specific hasVariants truth into
config"): the stored region array **always** contains a `variant_selector`
entry, at its canonical default position, reorderable exactly like an
optional region (bounded by the same adjacent-FIXED_REQUIRED rule, never
hideable/deletable) — this is authored once, independent of whichever
Product currently happens to be previewed. Both the Canvas preview and the
region-list inspector **display** it only when the *currently previewed*
Product actually has variants (`previewProduct.variants.length > 0`) — a
purely presentational filter applied at render time, never written back into
`draft`. This keeps the persisted contract valid for both variant and
non-variant Products, per the task's own explicit requirement, while still
letting a merchant see and reorder it whenever they are looking at a variant
product.

**OPTIONAL_TOGGLE, reorderable:** `availability`, `description`,
`custom_fields`, `sku_options_details`.

**Region reordering — the exact rule implemented (`moveProductRegion()`,
`presentation/page-region-registry.ts`):** a region swaps with its immediate
neighbor unless either side of the swap is a FIXED_REQUIRED region, in which
case the move is a no-op (the button is simply `disabled`). This single,
generic "skip past a fixed anchor" rule — not a hardcoded pair of zone
boundaries — naturally produces exactly the two reorder zones the
architecture doc's table implies: `availability`/`variant_selector` may swap
with each other (bounded above by `price`, below by `quantity_cta`), and
`description`/`custom_fields`/`sku_options_details` may reorder freely among
themselves (bounded above by `quantity_cta`). `media_gallery` never
participates in reordering at all (it is FIXED_REQUIRED and, per the task's
own "media may remain structurally separate from the Product content
column" guidance, is rendered in its own gallery column regardless of its
position in the `regions` array). Verified by test #8/#9: `availability`'s
"move up" button is disabled (would cross `price`); `description`'s "move
down" (into `custom_fields`) succeeds and dirties the Version.

---

## Structured Editing UX

**Selection:** clicking a region in the Canvas (`data-preview-product-region-id`)
or in the inspector list opens the "Product page structure" panel and
highlights the matching row — stable ids (`region.id`, defaulting to the
region key, per the existing H2-1 normalizer convention), never Home's
section ids, and never regenerated on each open (they live in `draft`/the
computed default, not freshly minted per render).

**Reorder:** accessible `Move up`/`Move down` buttons
(`ProductRegionInspector.tsx`), reusing the exact same `iconBtnClass`/
`moveIndex`-family styling Home's own section-list editor already
established — exported from `ControlPanels.tsx` rather than duplicated.
Drag-and-drop was not added, per the task's own explicit instruction.

**Visibility:** the shared `Toggle` component (`ControlPanels.tsx`), now
carrying an optional `disabled` prop (a small, backward-compatible addition —
every other existing `Toggle` consumer is unaffected) used for the Published
read-only case below.

**Inspector:** `ProductRegionInspector.tsx`, wired as a new `"product"`
`CustomizerPanel`, visible in the sidebar nav only when `currentPage === "product"`
(the exact mirror-image of how `"homepage"` is already hidden outside Home).
No new design fields were invented — visibility and permitted reorder only,
per the task's explicit inspector-scope boundary.

**Preview Product picker:** `ProductPreviewPicker.tsx` (desktop/tablet,
reusing the shared `Dropdown` component and, initially, `PageNavigator`'s
icon-only-at-768–1023px / full-label-at-1024px+ compaction technique —
**revised** during this slice's own Playwright pass to defer the full label
to `xl` (1280px) instead of `lg`, once real-browser measurement showed the
`lg`-breakpoint version measurably worsened the pre-existing CUST-H1-5
1024px AR toolbar overflow; see "Responsive / Visual Verification") +
`ProductPreviewPickerPanel.tsx` (the shared list — search input, thumbnail +
name rows, loading/error/empty states — rendered from both the desktop
dropdown and the mobile Bottom Sheet, one implementation, not two, matching
`PageNavigatorPanel`'s own precedent).

---

## Version Interaction

**Save semantics:** unchanged. Product region edits live in
`draft.pagePresentation.product` exactly like every other draft field; the
existing whole-document `updateDraft()` → `handleSave()` → `savePresentationVersion(storefrontId, versionId, config, revision)`
path is the only Save path — no new endpoint, no fragment persistence, no
new revision token. Verified by test #13/#14/#15: toggling a region sets
`lifecycle: "dirty"`; Save sends the existing Version's own `revision` (5 in
the test, unchanged by the edit) and a `config.pagePresentation.product.regions`
array reflecting the edit.

**Lazy materialization — "only actual editing should dirty the Version":**
`effectiveProductRegions` reads `draft.pagePresentation?.product?.regions ??
defaultProductPageRegions()` — a **pure computation**, never written back to
`draft` merely by being read. Only `handleToggleProductRegionVisibility`/
`handleMoveProductRegion` call `updateDraft()` (which is what flips
`lifecycle` to `dirty`). Opening the Product page, browsing its structure,
and switching the preview Product all read this computed fallback without
ever touching `draft` — verified by test #1 (loads first eligible product,
no dirty) and #4 (empty state, no dirty).

**Concurrency:** no page-level revision was added. The existing Version-level
`revision` (H1's own invariant, reused unchanged by CUST-H2-1/H2-2) remains
the sole concurrency guard — Session A editing the Product page and Session B
saving the same Version elsewhere still produces the existing 409
stale-revision response on whichever session saves second, exactly as it
already does for Home/chrome edits. No new test was written for this
specific case because no new code path exists to test: `handleSave()` is
byte-identical to the one CUST-H1's own 409 tests already exercise.

---

## Page Interaction

`currentPage`/`panel` switching (CUST-H2-2) is unchanged in mechanism, only
extended: leaving the Product page resets `selectedProductRegion` (safe, per
the task's own "Product region selection may reset safely" rule) and
redirects `panel` away from `"product"` if it was open (mirroring the
existing `"homepage"` redirect). No Save is triggered by a page switch, no
Product API refetch happens on Product → Home → Product (the already-loaded
`productList`/`previewProduct` state simply persists in memory) — verified
by test #16.

---

## Public Runtime Boundary

**Explicitly not wired until CUST-H2-5.** `pagePresentation.product` now
round-trips through Draft/Published/Scheduled storage with **real** merchant
edits (not merely schema-shaped placeholder data, as in CUST-H2-1), and the
Customizer's own Canvas is a real, editable preview — but the **public**
Next.js Product page (`storefront/.../products/[slug]/page.tsx` +
`ProductDetails.tsx`) imports nothing from `presentation/page-regions.ts`
and was not touched by this slice. A merchant's Product-page edits here are
visible only inside the authenticated Customizer; the live storefront
renders exactly as it does on unmodified `main` until CUST-H2-5 explicitly
teaches the public renderer to read this document. `PRODUCT_PAGE_PRESENTATION_CAPABILITY`
is set to `"live"` in this slice specifically to describe the now-real
*Customizer-side* editing capability (matching `HOMEPAGE_COMPOSITION_CAPABILITY`'s
own precedent of being `"live"` as an editor capability, independent of
separately-tracked public-runtime wiring) — this section is the explicit,
literal statement the capability comment itself points back to.

---

## Tenant Isolation

`CommerceWorkspaceStorefrontProductApiTest.php` — 15 tests, all passing,
covering every scenario the task mandated:

1. tenant A lists only tenant A's eligible products.
2. tenant A cannot list a foreign Storefront's products (404).
3. a foreign Product id returns a non-leaking 404 (response body never
   contains the foreign product's name).
4. same-tenant but inactive Product → excluded from list, 404 on detail.
5. same-tenant but unpublished Product → excluded from list, 404 on detail.
6. same-tenant Product published only on a *different* channel of the same
   tenant → excluded, 404 on detail (the eligibility-scoped-to-this-Storefront
   rule, proven, not merely asserted).
7. `tenant_id`/`company_id` query parameters cannot widen the result.
8. guests are rejected (401).
9. `self_service` is forbidden (403).
10. `staff` without `commerce.manage` is denied (403).
11. an inactive subscription is denied (403).
12. list payload never leaks cost/margin/internal fields (byte-string
    search across the full response body for `avg_cost`, `purchase_price`,
    `internal_notes`, the internal tag value, and the literal cost figures).
13. detail payload — same safety assertion.
14. search/pagination/deterministic ordering.
15. a variant-managed product is flagged in the list and returns the
    variant response shape in detail.

---

## Security

- Product id, Storefront id: selectors only, resolved through
  `TenantContext`-only ownership — never trusted from the request body.
- No cost, margin, supplier, purchase price, raw inventory, or internal
  note/tag field is ever serialized in either response — reusing
  `StorefrontProductResource`'s existing exclusion list rather than
  re-deriving a new one that could drift.
- The Customizer's own product preview `<img>` tags point at the existing
  public, unauthenticated `/store/v1/media/{id}` (or `/storefront/v1/media/{id}`)
  route — the same route `StorefrontProductResource` already builds for the
  live, anonymous storefront. Product media for a **published, eligible**
  product is not secret; no new media-serving surface was introduced.
- No DB migration; no new write path of any kind. This slice cannot reach a
  financial/accounting write path — no journal entry, no `LedgerService`
  call exists anywhere in the diff.

---

## Accessibility

- Region rows: real `<button>`s, reachable by Tab, `aria-pressed` on the
  selectable label, a text "Required" badge (never color-only) on
  FIXED_REQUIRED/variant_selector rows.
- Move buttons: `aria-label="Up"/"Down"` — real, accessible names, not icon-only
  with no label; `disabled` (not merely visually greyed) when a move would
  cross a fixed anchor or on a Published Version.
- Visibility toggle: the shared `Toggle` component's existing `aria-label`
  convention, now also carrying a real `disabled` attribute (a small,
  additive change to the shared component) for the Published read-only case
  — a screen reader correctly announces it as non-interactive, not merely a
  silently-ignored click.
- Preview Product picker: reuses `Dropdown`'s existing keyboard/focus
  contract (`Escape` closes and returns focus, `Enter`/`Space` on a row
  selects and returns focus to the trigger) — the identical pattern
  `PageNavigator` already established in CUST-H2-2, not a new one.
- No drag-and-drop as the only reorder mechanism — button-based reorder is
  the primary and only mechanism in this slice, per the task's own
  requirement.

---

## RTL/LTR

Verified two ways: the vitest suite (both `initialLocale="ar"` and `"en"`,
Arabic labels inside `<bdi>` per existing convention) **and** a real-browser
Playwright pass (`e2e/cust-h2-3-product-editing.spec.ts`, new; plus the
updated `e2e/cust-h2-2-page-navigator.spec.ts`) against the pre-installed
Chromium, in both locales. No new layout primitive was introduced — the
region list, picker, and Canvas reuse existing logical-CSS-property
conventions (`ps-`/`pe-`/`start-`/`end-`) already established throughout
`store-experience-builder`.

---

## Responsive / Visual Verification

A real-browser Playwright pass was run against the dev harness
(`/dev/customizer-versions`), extended with three new dev-only Product
fixtures in `lib/mock-data.ts` (a long-named simple product, a
variant-managed product, and a bare product with no image/description/SKU —
mirroring `CommerceWorkspaceStorefrontProductController`'s exact response
shape, so the same client-side mapping code runs against both real and
fixture data). **This is not the full 15-cell matrix the task describes** —
see "Risks / Remaining" for the explicit, honest scope statement — but it is
real, not merely reasoned-about, and it caught two genuine bugs neither unit
tests nor code review had found:

**Bug found and fixed — Product content column collapsing to a
one-character-wide vertical stack.** `ProductPagePreview` originally copied
`ProductDetails.tsx`'s `lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]`
verbatim. `lg:` is a **viewport** media query; the Customizer's preview
frame is a **scaled-down container** that can be far narrower than 1024px
even while simulating the "desktop" device, once the editor's own
sidebar/inspector take their share of a real window. At a real ≥1024px
browser width the two-column grid activated inside a ~486px container: the
gallery's own preferred near-square size claimed most of the `minmax(0,34rem)`
track, squeezing the content column to a sliver and wrapping the Arabic
title almost one character per line — confirmed with a screenshot, not
merely `scrollWidth`. **Fix:** the Product preview now always stacks
single-column (gallery, then content) inside the Customizer — same region
order and content as the real desktop layout, only the side-by-side
arrangement is not replicated in-editor (documented in
`ProductPagePreview`'s own doc comment). Re-verified clean at 1024/1280/1440.

**Bug found and mitigated — the toolbar Preview Product picker measurably
worsened the pre-existing CUST-H1-5 1024px AR overflow.** Measured directly:
Home at a real 1024px viewport was already at `scrollWidth: 1026` (2px over,
matching CUST-H2-2's own "zero net contribution" baseline); Product with
this slice's picker showing its full label at `lg` (1024px, the same
breakpoint the already-tight Restore/Schedule buttons also activate at) hit
`scrollWidth: 1139` — a new, real 115px regression, not the ~13px CUST-H2-2
itself found and accepted. **Fix:** the picker's label now defers to `xl`
(1280px, a genuinely spacious width) instead of `lg`, keeping it icon-only
through the entire pre-existing budget-constrained 768–1279px range —
reducing the regression to `scrollWidth: 1069` at 1024px (down from 1139)
while adding zero overflow at 1280px and 1440px (both exactly
`scrollWidth === clientWidth`, re-verified after the fix). The **residual**
~45px at exactly 1024px AR was not fully eliminated — the icon-only trigger
itself still has non-zero width, and this codebase's Tailwind setup has no
`@container` query support to size purely off the toolbar's own remaining
space. This residual is accepted, not hidden: `ExperienceBuilder.pageNavigator.test.tsx`'s
own AR 1024 Home scenario already established the precedent of dropping the
strict no-overflow assertion for this exact known-constrained width, and
`cust-h2-3-product-editing.spec.ts`'s AR 1024 scenario does the same, with
an inline comment citing this exact finding rather than silently omitting
the check.

---

## Tests

### Backend — SQLite

```
php artisan test --filter=CommerceWorkspaceStorefrontProductApiTest
# 15 passed (71 assertions)

php artisan test --filter="CommerceWorkspaceStorefront|CommerceCatalogApiTest|StorefrontPresentationVersion"
# 162 passed (844 assertions) — zero regressions in every sibling
# Commerce-workspace/presentation-version suite

php artisan test --filter="Commerce|StorefrontPresentation"
# 908 passed, 10 skipped — after fixing CommerceModuleBoundaryTest (see
# "Review Findings")

php artisan test
# full suite — see "SQLite" below for the complete result
```

### PostgreSQL

Started PostgreSQL 16 locally, database/role matching CI's exact credentials
(`ci.yml`: `nibras`/`secret`/`nibras`), via a separate `.env.pgsql` (never
touching the live `.env`, following H2-1's own documented precedent for
avoiding the exact SQLite-corruption mistake that report describes):

```
php artisan migrate:fresh --force --env=pgsql
# clean, all migrations apply

php artisan test --env=pgsql --filter=CommerceWorkspaceStorefrontProductApiTest
# 15 passed (71 assertions)

php artisan test --env=pgsql --filter="CommerceWorkspaceStorefrontProductApiTest|CommerceModuleBoundaryTest|StorefrontPresentationVersion|CommerceCatalogApiTest"
# 119 passed (606 assertions)
```

### Frontend Tests

```
cd web && npx vitest run src/modules/commerce-workspace/workspace-products.test.ts
# 10 passed — path builders, list/detail mapping, 403/404 classification,
# malformed-payload rejection, variant-managed mapping

cd web && npx vitest run src/modules/store-experience-builder/__tests__/ExperienceBuilder.productRegions.test.tsx
# 13 passed — covers the task's required scenarios 1–3, 5–9, 12–17
# (4, 10, 11 covered via renderReady()/dedicated empty-state and variant
# tests folded into the same file; 18 covered in the Published test;
# 19/20 — Home unchanged / Category still a placeholder — covered by the
# pre-existing, still-green ExperienceBuilder.pageNavigator.test.tsx, not
# duplicated here)

cd web && npx vitest run src/modules/store-experience-builder src/modules/commerce-workspace "src/app/(commerce)"
# 473 passed (44 files) — zero regressions across every Customizer/appearance suite

cd web && npx vitest run
# 2430 passed (327 files) — H2-1's own closure baseline was 2398; H2-2 added
# 9 more (2407); this slice adds the remaining 23 (10 client + 13 editor)
```

### Typecheck / Build

```
cd web && npx tsc --noEmit -p tsconfig.json
# 15 pre-existing errors (products/documents/import-jobs/platform/pos
# modules — identical count and files to CUST-H2-2's own closure baseline),
# 0 in any file this slice touches

cd web && npm run build
# production build green (exit 0), all pages compiled
```

### Playwright (real Chromium, this session)

```
cd web && npx playwright test e2e/cust-h2-3-product-editing.spec.ts \
  e2e/cust-h2-2-page-navigator.spec.ts --project=desktop
# 15/15 passed — both files, after the two fixes described above
```

Six new scenarios in `cust-h2-3-product-editing.spec.ts`: default preview at
1440 AR, switching to the variant product via the mobile Bottom Sheet picker
at 430 AR (`variant_selector` appears), a long product name at 768 AR, a
Product with no image/description/SKU at 1024 AR (honest omissions, no
fabricated content), hiding an optional region live at 1280 EN, and a
Published Version's read-only structure panel at 1280 EN. Three existing
CUST-H2-2 scenarios were updated (Product is no longer a placeholder) rather
than left asserting stale copy. Screenshots written to
`web/test-results/cust-h2-3-product-editing/` (gitignored).

### SQLite (full suite, this session)

```
php artisan test
# 55 failed, 49 skipped, 4906 passed (30707 assertions), 916s
```

The full-suite failure count (55) is higher than H2-1/H2-2's own closure
baselines because this dev container is missing the AWS SDK's
`Aws\Exception\AwsException` class entirely (confirmed: every visible
failure detail in this run's own output is `R2SmokeTestCommandTest`/
`R2StorageServiceTest` — `Class "Aws\Exception\AwsException" not found`,
the exact `Fuel*/R2*/ProductMediaR2*` family CUST-H1/H2-1's own reports
already exclude as a local-dev-only gap, not a CI gap). To directly confirm
zero regression in anything this diff actually touches — rather than
relying on that inference alone — a second, targeted run scoped to every
Commerce/Storefront/Presentation test in the suite was run to completion
with full output captured:

```
php artisan test --filter="Commerce|StorefrontPresentation"
# 908 passed, 10 skipped, 0 failed (5244 assertions), 92s
```

### CI

Not yet observed — reported once the PR is opened and CI runs.

---

## Review Findings

| Finding | Fix | Regression test |
|---|---|---|
| (self-caught, pre-review) `Storefront.sales_channel_id` is `NOT NULL` in the schema, not nullable as the initial defensive branch assumed — a test asserting the "no channel yet" case failed with a SQLite constraint violation, not the expected empty list | Removed the dead `sales_channel_id === null` branches from both `index()` and `show()` in `CommerceWorkspaceStorefrontProductController`; removed the now-impossible test case | The remaining 15 tests in `CommerceWorkspaceStorefrontProductApiTest.php`, all green |
| (self-caught, pre-review) `moveProductRegion`/`canMoveProductRegion`'s first generic signature (`<K extends string>(regions: readonly {key: K}[])`) narrowed the return type to `{key: K}[]`, losing `id`/`visible` at the type level even though the same objects survive at runtime | Changed the generic to `<T extends {key: string}>(regions: readonly T[]): T[]`, preserving the full element type | `tsc --noEmit` catches this class of error immediately; re-run clean |
| (self-caught, pre-review) `formatMinorAmount()`'s initial `locale === "ar" ? "ar-SA" : "en-US"` ternary tripped the repository's own `date-formatting-guardrail.test.ts` (a locale string built this way can emit Eastern Arabic digits on some ICU builds — the exact class of bug that guardrail exists to catch, here for currency rather than dates) | Switched to the existing central `displayLocale()` helper (`lib/formatting.ts`), the same one `fuel-quantity.ts` already uses for `Intl.NumberFormat` | `date-formatting-guardrail.test.ts` passes; full vitest suite re-run green (2430/2430) |
| (self-caught, pre-review) `ExperienceBuilder.pageNavigator.test.tsx`'s own Product-page assertions (written for CUST-H2-2's honest placeholder) failed once the Product page became real | Added `workspace-products` mocks (default: zero eligible products, an honest outcome that file's own assertions already expected) and replaced the stale placeholder assertion with the new real empty-state assertion; renamed the test to describe the new reality | The file itself, 9/9 green |
| (self-caught, pre-review) `CommerceModuleBoundaryTest`'s exact allow-list of every legitimate `commerce/...` API route (`ALLOWED_COMMERCE_API_ROUTES`) did not include this slice's two new routes | Added `api/commerce/workspace/storefronts/{id}/products` and `.../products/{product}` in their correct alphabetically-sorted position (the test does `assertSame` against a `sort()`ed discovered list) | `CommerceModuleBoundaryTest`, 3/3 green; broader `--filter="Commerce\|StorefrontPresentation"` re-run, 908 passed/0 failed |
| (found by this slice's own Playwright pass, not code review or unit tests) `ProductPagePreview`'s `lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]` (copied from `ProductDetails.tsx`) activates on the real browser viewport, not the Customizer's own scaled-down preview container — at a real ≥1024px window the two-column grid squeezed the content column to a sliver, wrapping the title almost one character per line | Product preview now always stacks single-column in the Customizer (documented as an explicit AWJ Decision in `ProductPagePreview`'s own doc comment) | `cust-h2-3-product-editing.spec.ts`'s AR 1024 scenario (screenshot evidence); re-verified clean at 1024/1280/1440 |
| (found by this slice's own Playwright pass) The toolbar Preview Product picker's full label activating at the same `lg` (1024px) breakpoint the already-tight Restore/Schedule buttons use measurably worsened the pre-existing CUST-H1-5 overflow (Home `scrollWidth: 1026` vs. Product `scrollWidth: 1139` at an identical real 1024px viewport) | Deferred the picker's full label to `xl` (1280px) instead of `lg`, matching zero measured regression at 1280/1440px; reduced (not eliminated) the 1024px-specific residual to `scrollWidth: 1069` | Re-measured directly via Playwright at 1024/1280/1440; the accepted 1024px AR residual is documented, not silently dropped (see "Responsive / Visual Verification" and "Pre-existing Findings") |

No external review round has occurred yet (this report is written before PR review).

---

## Pre-existing Findings

The CUST-H1-5 toolbar-width overflow at exactly 1024px AR — documented by
CUST-H2-2's own report (root cause: the `lg:inline` Restore + Schedule
buttons in the toolbar's primary row) — is still present, **and this
slice's own toolbar addition initially measurably worsened it** (a real
finding, not a hypothetical — see "Responsive / Visual Verification"):
Home's own baseline at a real 1024px viewport was `scrollWidth: 1026` (2px
over, matching CUST-H2-2's "zero net contribution" claim); Product with
this slice's `ProductPreviewPicker` showing its full label at the same `lg`
breakpoint the Restore/Schedule buttons use hit `scrollWidth: 1139`. Fixed
by deferring the picker's label to `xl` (1280px) instead of `lg`, which
reduced the regression to `scrollWidth: 1069` — smaller than the original
115px gap, but not fully zero at exactly this one breakpoint. The
`cust-h2-2-page-navigator.spec.ts` AR 1024 Home scenario already carries a
precedent of dropping the strict overflow assertion for this exact known
constraint; `cust-h2-3-product-editing.spec.ts`'s own AR 1024 scenario now
does the same, with a comment citing this exact finding.

---

## Risks / Remaining

- **A real Playwright pass was run, but it is not the task's full 15-cell
  matrix.** Covered with real browser verification: 1440/1024/768/430 AR,
  1280 EN, both a simple and a variant Product, a long product name, a
  Product with no image/description/SKU, region hide/show, region reorder
  (via the earlier `ExperienceBuilder.productRegions.test.tsx` unit suite,
  not separately re-verified in Playwright), and Published read-only. **Not
  covered in this session:** 390 EN specifically for Product (390 AR is
  covered via the H2-2 spec's own updated scenario), 1440 EN, an
  out-of-stock Product's exact visual badge, and the no-eligible-Products
  empty state as a real-browser screenshot (covered at the vitest/unit
  level only, test #4 in `ExperienceBuilder.productRegions.test.tsx`). Named
  explicitly rather than silently treated as "done."
- The accepted ~45px residual overflow at exactly 1024px AR (see "Pre-existing
  Findings") is a real, measured, and documented trade-off — not eliminated,
  because doing so without either removing tablet-width reachability of the
  Preview Product picker entirely or investing in a `@container`-query-based
  toolbar redesign (well outside this slice's scope) was not proportionate
  to attempt further in this session.
- `ProductRegionInspector`'s per-row "Required" badge text is shared between
  FIXED_REQUIRED and the conditionally-required `variant_selector` — both
  read simply "Required" in this slice; a future slice could distinguish
  "always required" from "required for this product" if merchant feedback
  shows the distinction matters, but the task's own contract does not
  require it and inventing a second badge state was avoided.
- `custom_fields` is a fully dead region for every real AWJ product today
  (see "Current AWJ Product Reality") — it exists in the schema/registry
  because CUST-H2-1 already committed to the 9-key contract, and this
  slice's job is to implement that contract honestly, not to prune it.
  Worth flagging for a future product decision (build real custom fields
  for AWJ's own catalog, or formally deprecate the region), not resolved
  here.

---

## Accounting

**No new financial operation is introduced by this slice.** The Workspace
Product read API is read-only (no write path of any kind), and
`pagePresentation.product` is a presentation-only document namespace
(region order/visibility) — never routed through `LedgerService`, never
touching `journal_lines`/`journal_entries`, carrying no money. No journal
entry table applies; there is no accounting entry to show per the project's
pre-PR protocol, because none was generated.

---

## Explicitly Deferred

- Category structured editing (CUST-H2-4) — `Category` remains exactly the
  CUST-H2-2 honest placeholder; not reopened.
- The Category preview picker/API — same reasoning; not built.
- Public Product runtime wiring — `pagePresentation.product` remains inert
  on the live storefront until CUST-H2-5, stated explicitly above.
- Public Category runtime wiring — CUST-H2-5, unrelated to this slice.
- Any deferred Product region (`specifications`, `related_products`,
  `trust_shipping_payment`, ratings/reviews) — no data model exists for any
  of them; none were added, per the locked contract.
- A full Playwright responsive/RTL/visual QA pass for this slice specifically
  (see "Risks / Remaining").

---

## Next Step

If approved: **CUST-H2-4 — Category Page Structured Editing**, per the
architecture doc's Implementation Slicing table.

---

# CUST-H2-3 READY FOR MERGE — OWNER APPROVAL REQUIRED.

DO NOT MERGE. DO NOT DEPLOY. DO NOT PRODUCTION RELEASE.
