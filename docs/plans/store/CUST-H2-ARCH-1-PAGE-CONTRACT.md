# CUST-H2-ARCH-1 — Multi-Page Presentation Architecture

# Status
ARCHITECTURE LOCK CANDIDATE — documentation only. No DB/API/runtime code is authorized by this document. No merge, deploy, or production release.

**Date:** 2026-09-30
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `0d6040b92b62212cb71a5dae86827fffcebe94a5`
**Parent architecture:** `docs/plans/store/CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md` (implemented, closed)
**Evidence authority:** `docs/plans/store/CUST-H2-MULTI-PAGE-EVIDENCE-UX.md`

---

## Current Schema

Reproduced from direct code inspection (see evidence document §3 for file:line citations).

`storefront_presentation_versions` (per-Version row, one JSON document):
```
id                    uuid PK
tenant_id             uuid FK
storefront_id         uuid FK
name                  string(120)
schema_version        unsignedSmallInteger
config                json NOT NULL      -- the entire StorefrontPresentationConfig
revision              unsignedInteger default 1
scheduled_for         timestamp nullable
schedule_generation   unsignedInteger default 0
last_published_at     timestamp nullable
timestamps
```

`storefront_presentations` (head, 0..1 per Storefront, pointers only):
```
draft_config / draft_revision / published_config / published_revision / published_at   -- legacy compatibility fields, unchanged
draft_schema_version / published_schema_version
schedule_epoch
active_version_id / scheduled_version_id / compatibility_working_version_id            -- nullable FKs → storefront_presentation_versions.id
```

`StorefrontPresentationConfig` (TypeScript, `web/.../presentation/config.ts:81-150`, PHP twin `App\Support\Commerce\StorefrontPresentationNormalizer`, `VERSION = 2`):
```ts
interface StorefrontPresentationConfig {
  version: 2;
  themePreset: ThemePresetId; primaryColor: string; accentColor: string | null;
  fontPreset: FontPresetId; density: DensityId; radius: RadiusId; productCard: ProductCardStyleId;
  branding: { displayName; logoDataUrl; compactLogoDataUrl; faviconDataUrl };
  header: { style; showSearch; showAccount; showCart; showCategoryNav; links: PresentationNavLink[] };
  homepage: { sections: PresentationHomeSection[]; heroHeadline; heroSubheadline };
  footer: { tagline; showLogo; copyright };
  contact: { phone; email; address; hours };
  whatsapp: { enabled; phone; message; placement };
  social: PresentationSocialLink[];
  verification: { crNumber; licenseNumber; sourceUrl; requestedVerifiedLabel };
  sbc: { authentication_number; seal_token; show_in_storefront };
  apps: { iosUrl; androidUrl; appName; showHomepageSection; showFooterLinks };
  pages: PresentationContentPage[];   // informational/CMS-metadata pages (about/contact/faq/policies) — NOT Home/Product/Category
}
interface PresentationHomeSection { id: string; type: HomeBuilderSectionKey; visible: boolean; content?: SectionContent }
```

There is no `page` column anywhere, no per-page revision, and no Product/Category namespace. Save is a whole-document `PUT` (`config` + `revision`); the server returns the whole document back. `PATCH` renames the Version's `name` only.

---

## Proposed Multi-Page Presentation Model

### Decision: additive namespace inside the same Version document; zero new tables, zero new columns

The smallest architecture that satisfies page-specific presentation, global presentation, exact preview, normalized persistence, Published parity, backward compatibility, Version lifecycle, and future page expansion is to **keep the existing document exactly as-is** and add one new optional, additive top-level key to `StorefrontPresentationConfig`:

```ts
interface StorefrontPresentationConfig {
  version: 3;                                    // schema bump: additive only
  // ...every existing field, byte-identical, unchanged...
  themePreset; primaryColor; accentColor; fontPreset; density; radius; productCard;
  branding; header; homepage; footer; contact; whatsapp; social; verification; sbc; apps; pages;

  pagePresentation?: PagePresentation;            // NEW — optional, absent = "not customized yet"
}

interface PagePresentation {
  product?: ProductPagePresentation;
  category?: CategoryPagePresentation;
}

interface PageRegionInstance<K extends string> {
  id: string;            // stable instance id, same convention as PresentationHomeSection.id
  key: K;                 // closed enum, from the Page Capability Registry for that page type
  visible: boolean;       // ignored/forced-true by the server for FIXED_REQUIRED regions
  content?: Record<string, unknown>;  // present only when authored; typed per-region in a later slice
}

type ProductPageRegionKey =
  | "media_gallery" | "identity" | "price" | "availability"
  | "variant_selector" | "quantity_cta" | "description"
  | "custom_fields" | "sku_options_details";

type CategoryPageRegionKey =
  | "breadcrumbs" | "identity_title" | "description"
  | "subcategories_rail" | "filter_sort_bar" | "product_grid" | "pagination";

interface ProductPagePresentation {
  version: 1;                                     // page-content schema evolves independently of the document's top-level `version`
  regions: PageRegionInstance<ProductPageRegionKey>[];
}
interface CategoryPagePresentation {
  version: 1;
  regions: PageRegionInstance<CategoryPageRegionKey>[];
}
```

### Why this shape, and why not the task's illustrative `global:`/`pages.home` wrapper

The task's own example (`presentation: { global: ..., pages: { home, product, category } }`) is conceptually correct but **not adopted literally**, for one concrete, evidence-grounded reason: `pages` is already a taken key on `StorefrontPresentationConfig` — `PresentationContentPage[]`, the informational/CMS-metadata page list (about/contact/faq/policies). Renaming it, or wrapping every existing top-level field under a new `global:` key, would be a **breaking rename of every field the normalizer, every Customizer panel, and every existing test currently addresses** — pure churn with no merchant-visible benefit, and a direct violation of the backward-compatibility mandate for zero gain. `homepage` is left exactly where it is for the same reason: it is already, in effect, "page: home," it is already isolated from chrome/identity, and renaming it buys nothing.

The two new page types get one dedicated, uncollided key: `pagePresentation.product` / `pagePresentation.category`. This is asymmetric with `homepage` living at the top level — that asymmetry is the honest cost of respecting existing byte-compatibility rather than a stylistic choice, and is recorded here explicitly rather than hidden.

### Backward compatibility

- `pagePresentation` is optional. Absent → the normalizer produces `undefined`/omits it entirely; every existing Version (schema_version 2) continues to normalize and render **byte-identically** — the Product/Category pages simply have no presentation seam yet, exactly as they do today (evidence doc §3.4).
- Schema bump 2 → 3 is additive-only: no existing field changes shape, type, or meaning. A v2 document read by v3-aware code produces `pagePresentation: undefined`; a v3 document with `pagePresentation` present read by would-be older code is exactly the case the existing **forward-schema fail-closed rule** already protects (a Version tagged `schema_version: 3` must not be normalized by code that only knows `VERSION = 2`) — this is a direct reuse of an H1 invariant, not a new one.
- `StorefrontPresentationNormalizer::VERSION` bumps from 2 to 3; `MAX_DOCUMENT_BYTES` (1.5 MiB) is unchanged — `pagePresentation` for two pages, each holding at most ~9 region instances with small typed content, is negligible against that budget.
- **No DB migration.** The entire model fits inside the existing `config` JSON column on `storefront_presentation_versions`. This follows the CLAUDE.md-adjacent project instruction to prefer presentation-document evolution over database schema expansion where it honestly fits — and it honestly fits here, since Home's own section model already lives the same way.

---

## Global vs Page-Specific Matrix

| Setting | Classification | Where it lives today | Notes |
|---|---|---|---|
| Theme preset, primary/accent color, font preset, density, radius, product-card style | **GLOBAL** | top-level `StorefrontPresentationConfig` | Unchanged; already shared across every page via CSS vars/header style |
| Branding (logo/favicon/display name) | **GLOBAL** | `branding` | Unchanged |
| Header (style, search/account/cart toggles, nav links) | **GLOBAL** | `header` | Shared chrome; already rendered on every page today via the storefront shell layout |
| Footer, contact, WhatsApp, social, verification, SBC, apps | **GLOBAL** | respective top-level keys | Unchanged |
| Hero, homepage categories, new arrivals, wholesale, banner, featured, offers, benefits, appPromo, customContent | **HOME** | `homepage.sections` | Unchanged — Home's existing section model, untouched by this Horizon |
| Media/gallery presentation | **PRODUCT** | `pagePresentation.product.regions["media_gallery"]` | Region is FIXED_REQUIRED (content is real product media; presentation controls order/emphasis only, never existence) |
| Title/identity region | **PRODUCT** | `regions["identity"]` | FIXED_REQUIRED |
| Rating placement | **DEFERRED** | — | No review/rating capability exists anywhere in the codebase (confirmed absent); not a region until that capability exists |
| Price presentation | **PRODUCT** | `regions["price"]` | FIXED_REQUIRED — commerce-authoritative value, presentation controls layout only |
| Variant/options placement | **PRODUCT** | `regions["variant_selector"]` | GATED on `product.hasVariants`; not merchant-hideable when variants exist |
| Quantity + purchase CTA | **PRODUCT** | `regions["quantity_cta"]` | FIXED_REQUIRED — a merchant must never be able to remove Add-to-Cart |
| Stock/availability presentation | **PRODUCT** | `regions["availability"]` | OPTIONAL_TOGGLE |
| Description | **PRODUCT** | `regions["description"]` | OPTIONAL_TOGGLE, reorderable |
| Specifications (structured table) | **DEFERRED** | — | No structured spec data model exists beyond SKU/options text |
| Related products | **DEFERRED** | — | No relationship/recommendation data exists (confirmed absent in code, matches `AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` §5.5) |
| Trust/shipping/payment presentation | **DEFERRED** | — | No such component exists on the PDP today |
| Category identity/title | **CATEGORY** | `regions["identity_title"]` | FIXED_REQUIRED |
| Category banner image | **DEFERRED** | — | Category resource has no image field (confirmed; `CategoryBanner.tsx`'s own comment) |
| Description | **CATEGORY** | `regions["description"]` | OPTIONAL_TOGGLE |
| Subcategories | **CATEGORY** | `regions["subcategories_rail"]` | OPTIONAL_TOGGLE, position-configurable |
| Sorting position, filters layout | **CATEGORY** | `regions["filter_sort_bar"]` | FIXED_REQUIRED existence; layout-only configurability — commerce query behavior (facets/sort logic) is never forked |
| Product grid/list presentation | **CATEGORY** | `regions["product_grid"]` | FIXED_REQUIRED; pagination model (infinite scroll) is commerce-authoritative, not a presentation choice in H2 V1 |
| Promotional/content regions | **DEFERRED** | — | No such region exists in the Category page component tree today |

---

## Page Type Registry

```ts
type PageType = "home" | "product" | "category";
// Expandable later (cart, checkout, account, search, informational/custom pages)
// WITHOUT a destructive migration: each new PageType adds one more optional
// key under `pagePresentation` (or continues using the existing `homepage`
// precedent for `home`) — never requires touching existing page types' data.
```

`home` deliberately keeps using its own existing, working `homepage` key and `SECTION_CAPABILITIES`/`GATED_HOME_SECTION_KEYS` tables rather than being retrofitted into the new `PageRegionInstance` shape in this Horizon — Home already works, is tested, and is out of scope for a destructive rename. A future cleanup Horizon may adapt Home's tables to implement the same registry *interface* the Page Capability Registry defines below, but that is not required for CUST-H2 V1.

---

## Page Capability Registry

One contract shape, instantiated once per `(pageType, regionKey)`:

```ts
interface PageRegionCapability {
  key: string;                                   // stable, closed enum member
  allowedPageTypes: PageType[];                  // e.g. ["product"] — never assume cross-page validity
  state: "LIVE" | "DESIGN_ONLY" | "GATED" | "DEFERRED";
  requirement: "FIXED_REQUIRED" | "OPTIONAL_TOGGLE" | "REORDERABLE" | "CONFIGURABLE" | "GATED" | "DEFERRED";
  maxInstances: number | null;                   // 1 for all Product/Category regions in H2 V1 (no repeatable regions yet)
  canDuplicate: boolean;                          // false for every Product/Category region in H2 V1
  canDelete: boolean;                             // false for FIXED_REQUIRED; true for OPTIONAL_TOGGLE
  canHide: boolean;                               // distinct from canDelete — Home already treats hide/show and delete as different operations
  requiredDataDependency: string | null;          // e.g. "product.variants.length > 0" for variant_selector
  fallbackBehavior: "omit" | "show_disabled" | "show_placeholder";
  responsiveConstraints: string | null;            // free-text note, not enforced code, in this ARCH-1 slice
  accessibilityRequirements: string | null;
  previewRenderer: string;                        // component name the Customizer Canvas will use (CUST-H2-3/4)
  publishedRenderer: string;                       // component name the public Next.js page already uses today
}
```

`PAGE_REGION_REGISTRY: Record<PageType, Record<string, PageRegionCapability>>` — populated for `product` and `category` in CUST-H2-1 (see Implementation Slicing). Unlike Home's flat `SECTION_CAPABILITIES` (which only needs `maxInstances`/`canDuplicate`/`canDelete` because every Home section is optional-by-default), this registry must also carry `requirement` and `requiredDataDependency`, because most Product/Category regions are **not** optional — this is the deliberate difference from Home's model recorded in the Evidence document's Gap Matrix.

---

## Home Contract

Unchanged. `homepage.sections: PresentationHomeSection[]`, `SECTION_CAPABILITIES`, `GATED_HOME_SECTION_KEYS = ["offers"]`, `MAX_HOME_SECTIONS = 30` — all exactly as implemented today. CUST-H2 does not touch this contract.

---

## Product Page Region Contract

Ground truth: `storefront/src/app/[country]/[locale]/(storefront)/products/[slug]/ProductDetails.tsx` (416 lines, fully LIVE, real `@spree/sdk` data via the AWJ adapter).

| Region key | Required? | Reorderable? | Hideable? | Duplicable? | Data dependency | Capability state |
|---|---|---|---|---|---|---|
| `media_gallery` | Yes (FIXED_REQUIRED) | No | No | No | `product.media` / selected variant's media | LIVE |
| `identity` (title + wishlist + share) | Yes (FIXED_REQUIRED) | No | No | No | `product.name` | LIVE (wishlist itself remains `DESIGN_ONLY` per the existing Design-First register — unaffected by this Horizon) |
| `price` | Yes (FIXED_REQUIRED) | No | No | No | `product.price` / `compare_at` | LIVE |
| `availability` | No (OPTIONAL_TOGGLE) | Yes, within the content column | Yes | No | `product.in_stock` | LIVE |
| `variant_selector` | Conditional — FIXED_REQUIRED **when** `product.hasVariants`, otherwise absent (never merchant-toggled) | Limited (position within content column only) | No | No | `product.variants`, `product.optionTypes` | LIVE |
| `quantity_cta` (quantity stepper + Add-to-Cart) | Yes (FIXED_REQUIRED) | No | No | No | Cart contract | LIVE |
| `description` | No (OPTIONAL_TOGGLE) | Yes | Yes | No | `product.description` (plain text, never HTML — existing deliberate choice) | LIVE |
| `custom_fields` | No (OPTIONAL_TOGGLE) | Yes | Yes | No | `product.custom_fields` | LIVE |
| `sku_options_details` | No (OPTIONAL_TOGGLE) | Yes | Yes | No | `product.sku`, `product.options_text` | LIVE |
| `specifications` | — | — | — | — | No structured data model exists | **DEFERRED** |
| `related_products` | — | — | — | — | No relationship/recommendation data exists | **DEFERRED** |
| `trust_shipping_payment` | — | — | — | — | No such component/data exists | **DEFERRED** |

`maxInstances = 1` and `canDuplicate = false` for every LIVE region above — there is no repeatable Product-page region in H2 V1 (unlike Home's `banner`/`featured`/`customContent`, which are genuinely repeatable).

---

## Category Page Region Contract

Ground truth: `storefront/.../c/[...permalink]/CategoryBanner.tsx` + `storefront/src/components/products/ProductListing.tsx` (both fully LIVE).

| Region key | Required? | Reorderable? | Hideable? | Duplicable? | Data dependency | Capability state |
|---|---|---|---|---|---|---|
| `breadcrumbs` | Yes (FIXED_REQUIRED) | No | No | No | `category.ancestors` | LIVE |
| `identity_title` | Yes (FIXED_REQUIRED) | No | No | No | `category.name` | LIVE |
| `description` | No (OPTIONAL_TOGGLE) | No | Yes | No | `category.description` | LIVE |
| `category_banner_image` | — | — | — | — | Category resource has no image field | **DEFERRED** |
| `subcategories_rail` | No (OPTIONAL_TOGGLE) | Yes (position) | Yes | No | `category.children` | LIVE |
| `filter_sort_bar` | Yes (FIXED_REQUIRED existence; CONFIGURABLE layout only) | No | No | No | `ListingFilterBar`, `getProductFilters` | LIVE — commerce query/facet logic is never forked by presentation |
| `product_grid` | Yes (FIXED_REQUIRED) | No | No | No | `InfiniteProductList` | LIVE — infinite-scroll pagination model is commerce-authoritative in H2 V1, not a presentation choice |
| `promotional_content` | — | — | — | — | No such region exists today | **DEFERRED** |

---

## Preview Context Model

- The chosen preview product/category is **editor context, not storefront presentation authority** — never written into `pagePresentation`, never sent in the Save/Publish request body. This mirrors the existing, unpersisted `viewport`/`selectedSection`/`selectedChrome` React state already in `ExperienceBuilder.tsx` today.
- Default selection: the first tenant-eligible published product/category, resolved through a tenant-scoped, ownership-checked lookup — see the capability gap below.
- **Confirmed gap, not invented here:** no authenticated Commerce-workspace (`commerce.manage`) product/category list-and-read endpoint exists today. `CommerceProductController`/`CommerceCategoryController` exist but are wired only under the anonymous/mobile-token `commerce/v1` API (`routes/api_commerce.php`, `AuthenticateApiClient` chain), not the ERP workspace auth chain the Customizer runs under. The picker is therefore **DESIGN_ONLY** until a workspace-scoped equivalent (e.g. `GET /api/commerce/workspace/products`, `GET /api/commerce/workspace/categories`, `SetTenant` + `commerce.manage`, foreign/missing → 404 not 403, following `StorefrontPresentationVersionService::ownedStorefront()`'s exact pattern) is built — a CUST-H2-3/H2-4 dependency, not a CUST-H2-1 blocker (the schema/registry foundation does not need the picker to exist).
- Empty state: zero eligible products/categories → an honest "no products yet" empty state in the Canvas, never a fabricated fixture presented as real. Existing dev-only fixtures (`PREVIEW_PRODUCTS`/`PREVIEW_CATEGORIES`, already used inside Homepage's `newArrivals`/`categories` sections) may continue to be used for Homepage exactly as today, and may be reused for a Product/Category dev/visual-harness only if clearly separated from the merchant-facing Canvas — never silently promoted to merchant runtime.
- Preview-entity selection is not tied to Version identity and may reasonably survive a Version switch (see Version Switching below) — it answers "what am I looking at," not "which design am I editing."

---

## Normalization

`StorefrontPresentationNormalizer` (PHP) and `normalizePresentationConfig()` (TS) both gain a `pagePresentation` branch, following the exact existing pattern used for `homepage.sections`:

- Unknown region keys are dropped (fail-closed), exactly as unknown home-section types are dropped today.
- A region key not in `PAGE_REGION_REGISTRY[pageType]`'s allow-list for that page type is dropped, even if it is a valid key for a *different* page type — this is the direct analogue of Shopify's `enabled_on.templates` restriction (evidence doc §2.2), enforced server-side, not merely by the Add-region picker's UI.
- A `FIXED_REQUIRED` region with `visible: false` in an incoming payload is normalized back to `visible: true` server-side — the client picker never offers a way to set this, but the server does not trust the client not to have sent it anyway (same fail-closed posture as every other normalizer branch).
- Document-size limit (1.5 MiB) is unchanged; `pagePresentation` for two pages of ≤9 small region instances each is far below the budget actually exercised by Homepage's own 30-section ceiling.

---

## Schema Version / Migration Strategy

- **No DB migration.** `pagePresentation` lives inside the existing `config` JSON column.
- `StorefrontPresentationNormalizer::VERSION` bumps 2 → 3, additive-only (see "Backward compatibility" above).
- Every existing Version (any tenant, any Storefront) continues to read and render byte-identically with `pagePresentation` absent — this is verified by construction (an optional field the normalizer treats as "no page customization yet"), not by a data migration/backfill of any kind. This is a genuine advantage of the additive-JSON approach over a new table: there is nothing to backfill.
- Forward-schema fail-closed (H1's existing invariant) applies unchanged: a Version tagged `schema_version: 3` must never be read/normalized/published by code that only implements `VERSION = 2`, across every existing path (exact read, exact save, duplicate/create-from-Version, legacy GET/PUT mapping, immediate publish, scheduled publish) — this is pure reuse, not a new rule to design.

---

## Save Semantics

- **One Save writes the full Version document** — home, chrome, and both page-specific namespaces together, exactly as today's single Save already persists Home-section edits and chrome edits together in one request. There is no fragment/partial save for `pagePresentation`, matching the existing whole-document `PUT .../versions/{version}` contract exactly.
- Switching pages inside the Customizer requires **no server read**: the entire `StorefrontPresentationConfig` (now including `pagePresentation`) is already held client-side in the single in-memory `draft` object after one Version GET; changing "current page" is a pure client-side state transition (the same category of state as `viewport` today), not a network round-trip.
- **A stale Product-page editor cannot silently overwrite a Category-page edit**, because there is only one `draft` document per open Version per browser tab: editing Product then switching to Category then Saving persists both sets of edits atomically in the same request and the same object, exactly as editing "header" then "homepage" then Saving already does today. The risk the task's question is really probing — two *different browser tabs/sessions* editing the same Version concurrently — is unaffected by adding page namespaces; it was already possible today between, say, a "homepage" edit and a "header" edit in two tabs, and is already correctly handled by the existing Version-level `revision` 409 mechanism.

---

## Concurrency

**Decision: Version-level revision remains the sole concurrency granularity for H2 V1. No page-level revisions.**

Scenario from the task: Session A edits the Product page, Session B edits the Category page, of the same Version.

- Both sessions hold their own in-memory copy of the same whole `config` document (as they already do today for any two chrome panels).
- Whichever session saves first succeeds and increments the Version's single `revision`.
- The second session's save, still carrying the pre-A `revision`, receives the existing **409 stale-revision** response — exactly the same UX AWJ already ships and has tested for two tabs editing different Home panels today. There is no silent last-write-wins: this is explicitly the invariant CUST-H1 already locked and CUST-H2 must not weaken.
- This is a deliberately **coarse but safe** conflict: B's Category edit and A's Product edit did not logically collide, yet B still gets a 409 and must reload-and-reapply. This is accepted for H2 V1 because:
  1. it is the existing, already-tested H1 behavior, extended with zero new code;
  2. page-level revisions would require a second concurrency-token axis, a second round of the entire H1 §29 test matrix (stale-save, publish-vs-save races, schedule interactions) *per page*, for a conflict pattern (two editors on the same Version at the same moment) the roadmap itself does not evidence as a real merchant pain point yet;
  3. the task's own instruction is explicit: do not add page-level revisions merely because they sound sophisticated, and use the current H1 concurrency guarantee as the baseline.
- If real merchant usage later proves this coarse conflict rate is a genuine problem, a future Horizon may introduce field-level or region-level optimistic merge — that is a new, separately-justified decision, not something CUST-H2 pre-builds speculatively.

---

## Version Switching

Unchanged from CUST-H1. Switching the active Version reloads the entire `StorefrontPresentationConfig` (now potentially including `pagePresentation`) from the server for that Version, replacing the in-memory `draft`. Unsaved edits in the previous Version are handled by the existing dirty-state/discard-confirmation behavior already governing Version switches today — CUST-H2 does not change this contract, it only means the replaced document is larger.

---

## Page Switching

New in CUST-H2. Switching the current page (`home` ↔ `product` ↔ `category`) is a pure client-side state change:

- Does **not** discard unsaved edits — the whole `draft` object persists across the switch, since all three pages' data live in the same object.
- Does **not** trigger any Save — Save remains an explicit merchant action exactly as today.
- Does **not** require a server read, per Save Semantics above.
- Preserves dirty/clean status correctly: if any page's data differs from the last-saved snapshot, the toolbar's existing draft-status indicator continues to reflect that — it already operates on the whole `draft` vs. last-saved comparison, not a per-panel comparison, so no new dirty-tracking logic is needed.

---

## Public Runtime Mapping

```
Customizer Page Preview (Canvas, page-aware, CUST-H2-2+)
        ↓
pagePresentation.{product,category}  (Normalized Presentation Contract, this document)
        ↓
Version Draft  (storefront_presentation_versions.config)
        ↓
Published Snapshot  (storefront_presentations.published_config — unchanged mechanism, same atomic copy-on-publish)
        ↓
Public Product/Category Renderer  (ProductDetails.tsx / CategoryBanner.tsx + ProductListing.tsx)
```

**This chain is only fully closed in CUST-H2-5.** ARCH-1 (this document) defines the contract; CUST-H2-2 makes the Customizer Canvas page-aware for editing/preview only; CUST-H2-3/H2-4 build real region editing; CUST-H2-5 is the slice that teaches the *public* Next.js Product/Category pages to actually read `pagePresentation` region order/visibility, closing the parity chain. Until CUST-H2-5 ships, any Customizer edit to Product/Category presentation is **DESIGN_ONLY at the public-runtime end** even though it round-trips correctly through Draft/Published storage — this must be stated honestly in each intermediate slice's own capability table, per the Design-First Policy.

---

## Tenant Isolation

No change to the existing pattern. `StorefrontPresentationVersion` remains `CompanyWide`; ownership resolves through `TenantContext::id()` comparison inside `ownedStorefront()`/`findOwnedVersion()`; foreign or missing Storefront/Version → 404, never 403. Any new preview-entity lookup (once its endpoint exists, per the Preview Context Model gap above) must follow the identical pattern: tenant authority from `TenantContext` only, never from a request body/query id; a foreign product/category id fails closed as 404 with no existence leak. `pagePresentation` region content references stable AWJ product/category ids only (mirroring the existing `featured.productIds` pattern) — it never clones catalog data into the presentation document, preserving the "AWJ is the system of record" boundary (`AWJ_STOREFRONT_DESIGN_SYSTEM.md` §3).

---

## Backward Compatibility

Covered in detail under "Schema Version / Migration Strategy" above. Summary: every existing merchant's Homepage, chrome, Draft/Published/Scheduled lifecycle, and public storefront rendering is unaffected — `pagePresentation` is optional and absent by default, and the public Product/Category pages do not change behavior at all until CUST-H2-5 explicitly wires them.

---

## Accessibility

- The Page Navigator follows the same accessibility bar already required of `VersionSelector`/`VersionManagerPanel`: keyboard reachable, a semantic current-selection state (not color-only), and screen-reader-announced page changes.
- Region reorder/hide/show in the future Product/Category editors (CUST-H2-3/H2-4) must offer a keyboard/button alternative, not drag-and-drop only — reusing the exact rule Home's section list already follows (`AWJ_STORE_CUSTOMIZER_UX_V2.md` §11).
- FIXED_REQUIRED regions being non-hideable is itself an accessibility guarantee: a merchant cannot accidentally remove the purchase path or navigation landmarks (breadcrumbs) from the public page.

---

## RTL/LTR

No new concern beyond what CUST-H1 already verified for the toolbar. The Page Navigator's label text and dropdown are Arabic-first with English support, following the existing `<bdi>`/logical-CSS-property conventions already used throughout the Customizer.

---

## Responsive Behavior

The Page Navigator must fit inside the toolbar's existing width budget (see Evidence doc §5.1 — reusing the dead `t("currentPage")` label's slot rather than adding new space). Verification at 390/430/768/1024/1280/1440 is required in CUST-H2-2's own implementation report, following the same matrix H1-2/H1-5 already used and the same discipline that caught two real overflow bugs in that Horizon.

---

## Failure / Empty States

- Zero eligible preview products/categories → explicit empty state in the Canvas (see Preview Context Model).
- A Version whose `pagePresentation` references a product/category id that later becomes foreign/deleted/unpublished must fail safely on the Canvas (a "this item is no longer available" notice), never resurrect a stale entity and never leak its existence if it belongs to another tenant — same posture as the existing "AWJ is the system of record" lifecycle rule for Homepage's `featured.productIds`.
- Forward-schema `pagePresentation` (a Version saved by a newer deployment) fails closed exactly as every other forward-schema path already does — no fabricated default is substituted.

---

## Rejected Alternatives

1. **One completely separate config document per page.** Rejected. Multiplies the save/version/schema/migration surface by the number of pages, breaks the "one Version = one editable snapshot" mental model CUST-H1 just established and tested, and would need per-page concurrency handling for no proven benefit.
2. **One Version config containing global + page subdocuments.** **Accepted** — this is the recommendation above.
3. **Storing page layouts outside presentation Versions** (e.g., a separate `page_layouts` table keyed by page type, outside the Version model). Rejected for the same reasons CUST-H1-ARCH-1 already rejected "replace head with Versions immediately" and "store all Versions in one JSON array on head": it reintroduces cross-table concurrency and migration/public-runtime risk that the existing single-document-per-Version model was specifically designed to avoid.
4. **A separate DB table for page presentation.** Rejected. No migration is needed at all — the JSON column has ample headroom (1.5 MiB cap, current usage far below it) and a table would add join complexity, a second lock-order concern in every Version transaction (create/save/publish/schedule/delete), and a second schema-version axis, for a shape that fits inside the existing document.
5. **Fully free-form page builder.** Rejected. Directly violates AWJ's "not Webflow" structured-section principle (`AWJ_STORE_CUSTOMIZER_UX_V2.md` §3.3, roadmap §13.9) and the FIXED_REQUIRED-region safety requirement — a merchant must never be able to delete Add-to-Cart, price, or the product grid.
6. **iframe/live public URL as the editor Canvas.** Rejected. Violates the already-locked non-negotiable boundary (`AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`'s and `AWJ_STORE_CUSTOMIZER_UX_V2.md` §16's existing rejection of any iframe of the live store), would leak pre-publish Draft state to a public route, and — concretely, per this pass's own evidence — the public Product/Category pages have no presentation seam today, so an iframe would show generic unstyled content rather than any real preview of the Draft being edited.

---

## Security Stop Gates

- Preview product/category ids are selectors only, never authority — enforced by following `ownedStorefront()`'s exact pattern once the workspace catalog-read endpoint exists.
- No unpublished/foreign/ineligible product or category becomes reachable through the Customizer's preview architecture; a foreign id fails closed as 404, never 403, never a partial existence leak.
- `pagePresentation` never carries price, stock, variant truth, or any other commerce fact — only structural ordering/visibility flags and stable entity-id references, exactly mirroring the existing `featured.productIds` pattern.
- The Customizer preview remains authenticated-workspace-only; no preview token, no unpublished-theme public route, no iframe — unchanged from the existing locked capability (`CUSTOMIZER_PREVIEW_CAPABILITY`, LIVE, "in-workspace canvas" per the Design-First Policy §5.28).
- Any change to the *public* Product/Category renderer (CUST-H2-5) must not fork query/filter/sort/pagination behavior away from its current commerce-authoritative implementation — presentation may reorder/hide/show layout only.

---

## Implementation Slicing

| Slice | Scope | Explicitly excluded |
|---|---|---|
| **CUST-H2-1** | Schema: `pagePresentation` optional namespace, schema bump 2→3, PHP/TS normalizer twin, Page Type Registry, Page Capability Registry populated for `product`/`category`, fail-closed tests (byte-identical default for existing Versions, forward-schema rejection, unknown/cross-page-type region drop). **Zero DB migration. Zero UI.** | Any Customizer UI change; any public-runtime change |
| **CUST-H2-2** | Page Navigator UI (toolbar control + mobile page-pill/bottom-sheet), `currentPage` editor state in `ExperienceBuilder`, `StorefrontPreviewCanvas` gains a `page` prop; Product/Category selected in the Canvas render an honest "not yet editable" placeholder (never a fake section) | Real region editing; the preview-entity picker (blocked on the confirmed missing endpoint) |
| **CUST-H2-3** | Product page structured editing: region instances, Preview Product picker (requires the workspace catalog-read endpoint from the Gap Matrix — a stated dependency, not invented here), Product Page Region Map enforcement, Customizer-side preview renderer reusing `ProductDetails.tsx`'s real components | Public runtime wiring (deferred to H2-5) |
| **CUST-H2-4** | Category page structured editing, same shape as H2-3, reusing `CategoryBanner.tsx`/`ProductListing.tsx` | Public runtime wiring |
| **CUST-H2-5** | Cross-page parity: teach the public Next.js Product/Category pages to read `pagePresentation` region order/visibility, closing the Public Runtime Mapping chain; integrated responsive/RTL/accessibility QA across Home+Product+Category | New page types (cart/checkout/account/search/informational) |
| **CUST-H2 Horizon Closure** | Closure report per the roadmap's own Horizon lifecycle (§6.1 item 9) | New scope |

Each slice remains independently reviewable and testable, per the roadmap's own execution model. No slice after this one is authorized to begin merely because this document exists — each still requires its own UX/architecture/implementation/verification/pre-merge-review/owner-merge-gate cycle.

---

*Documentation only. This file does not authorize application code, database, API, or deployment change. Do not merge without owner review. Do not deploy.*
