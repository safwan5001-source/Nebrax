# CUST-H2-ARCH-1 — Multi-Page Visual Builder: Evidence Pass + UX Recommendation

**Status:** Evidence Pass — documentation only, no application code change
**Date:** 2026-09-30
**Repository:** `safwan5001-source/Nebrax`
**Base SHA:** `0d6040b92b62212cb71a5dae86827fffcebe94a5` (`origin/main` tip; identical to the SHA CUST-H1 Horizon Closure named as its own merge commit — main has not advanced)
**Parent Horizon:** CUST-H1 — Theme Copies & Safe Publication Lifecycle (**CLOSED**, `docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`)
**Companion document:** `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md` (architecture)
**Authority:** `docs/plans/store/AWJ_STORE_CUSTOMIZER_HORIZON_ROADMAP_V1.md` §7 (HORIZON CUST-H2)

No DB/API/runtime change is authorized by this document. No merge, deploy, or production release.

---

## 1. Scope of this pass

CUST-H2 — Multi-Page Visual Builder — moves AWJ's structured visual-editing model beyond Home to **Product** and **Category** pages, inside the *same* active design Version that CUST-H1 introduced. Page navigation is not Version navigation.

This document is the Evidence Pass: what Salla and Shopify actually prove today, what AWJ's own code actually does today (not what earlier docs assumed), the gap matrix between them, and the UX recommendation for the Page Navigator. The architecture decision built on this evidence is in the companion `CUST-H2-ARCH-1-PAGE-CONTRACT.md`.

---

## 2. External Evidence

### 2.1 Salla

Salla is used as a functional maturity benchmark, not a literal design source (per the Horizon Roadmap's own framing, §2 and §13). Salla's help-center pages are a JS-rendered SPA; several fetches in this pass returned only navigation/category text rather than full article bodies. Findings below are marked by confidence.

| Finding | Source | Confidence |
|---|---|---|
| Salla's theme customization surface explicitly separates **Home page**, **Product page** ("صفحة هبوط المنتج" — product landing page), **category pages**, **informational pages**, and header/footer as distinct customizable surfaces. | https://help.salla.sa/article/إدارة-وتخصيص-تصميم-الثيم/q793mmwb0n5x33ol7r3h9cjo · https://help.salla.sa/article/تخصيص-عناصر-صفحة-عناصر-الثيم/d5almi1jbg1h8365chaq8lt3 | High — already independently verified and cited by the CUST-H1 Horizon Roadmap (§2.1), re-confirmed in this pass. |
| Salla's Product page customization ("شراء وسام وتخصيص صفحة المنتج") describes configurable regions distinct from global theme settings: **quick-purchase element** ("عنصر الشراء السريع") is called out explicitly as a togglable product-page-specific feature, separate from store-wide styling. Settings are organized between **global theme settings** (apply to all product pages) and **individual product-page settings**. | https://help.salla.sa/article/ثيم-وسام/ehncwt66icknl9rhj1quvwlu | Medium — page content was thin on direct fetch; the global/page-specific settings split and the quick-purchase toggle are the concrete facts recovered. |
| Salla documents Home-page elements ("عناصر الصفحة الرئيسية") as a category distinct from "عناصر إضافية" (additional/optional elements) and from informational-page elements — i.e. Salla's own documentation already separates page-scoped element sets rather than one flat list. | https://help.salla.sa/article/1255017559 | Medium — confirmed at the navigation/taxonomy level; full article body not retrieved. |
| Salla Twilight (theme developer platform) scopes components to a specific page via a **file-path convention** in `twilight.json`: a component declared with `"path": "home.custom-slider"` lives at `src/views/components/home/custom-slider.twig` and is only renderable via `{% component home %}` inside that page's own template under `src/views/pages/`. Component visibility/activation is centrally controlled via the Partners Portal. | https://docs.salla.dev/422558m0 | High — concrete mechanic, directly fetched and quoted. |

**AWJ interpretation:** Salla proves the market expects three separable customization surfaces (Home / Product / Category) with a clear global-vs-page-specific settings split, and that even at the theme-developer level, components are namespaced to the page they belong to. This is external validation for AWJ's own Page Type Registry + Page Capability Registry design (§5 of the architecture doc) — not a license to copy Salla's specific UI.

### 2.2 Shopify

Shopify's official developer and merchant documentation is directly fetchable and gave precise, quotable mechanics.

| Finding | Source | Confidence |
|---|---|---|
| Shopify's template system maps **one page type → one or more template files**. "You must have a matching template for any page type that you want to render… to render a product page, you need at least one template of type `product`." Merchants/developers can create **alternate templates** per resource (e.g. a second product template for a different product family) — up to 1,000 JSON templates per theme across all types. | https://shopify.dev/docs/storefronts/themes/architecture/templates | High |
| The theme editor's **template/page selector sits in the toolbar**, visually and positionally distinct from Save and the device/preview switcher. Selecting a template changes what the sidebar tree shows (that template's sections/blocks); **global theme settings live behind a separate "theme settings" icon**, explicitly separated from template-specific settings in the UI. | https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/features-overview | High |
| Sections declare an **`enabled_on` / `disabled_on`** allow-list/block-list keyed by `templates` (e.g. `["product"]`, `["*"]`) and `groups` (e.g. `header`, `footer`). A homepage-only section that declares `enabled_on: { templates: ["homepage"] }` simply never appears in the **Add section** picker while editing a product or collection template — the restriction is enforced by omission from the picker, not a runtime error. | https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema | High — directly quoted JSON schema. |
| The theme editor has a **"Preview" picker** in the sidebar (`Preview → Change`) that lets a merchant pick a specific existing product/collection/page to preview against the template currently being edited, and a separate flow to assign a specific alternate template to a specific resource. Exact persistence semantics of the preview-only selection (vs. template assignment) could not be confirmed to a quotable level in this pass — see the Gap Matrix note. | https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/add-and-edit-store-resources | Medium — mechanism confirmed to exist; whether the *preview* choice itself is ever persisted as opposed to the separate template-assignment feature was not independently quotable from the fetched pages in this pass. |

**AWJ interpretation:** Shopify's `enabled_on`/`disabled_on` model is the strongest available precedent for AWJ's Page Capability Registry (§5 of the architecture doc): a region/section declares which page types it may appear on, and the picker (not a runtime check) is what keeps a Home-only block off the Product page. Shopify's template-selector-in-toolbar, sidebar-tree-per-template, and separate-global-settings-icon are the strongest precedent for keeping AWJ's Page Navigator visually and semantically separate from the Version Selector — which is also independently already the intent recorded in AWJ's own code (§3.1 below).

### 2.3 Other sources

No Apple HIG / Material research was performed in this pass — the specific interaction questions this Horizon raises (a toolbar page selector, a bottom-sheet page picker on mobile) are already answered by direct precedent in AWJ's own existing Version Selector/Version Manager pattern (CUST-H1) and by Shopify's toolbar template selector; inventing a third reference for the same question would not change the recommendation in §6.

---

## 3. Current AWJ Reality

This section reports **verified code**, not the roadmap's prior assumptions. Evidence gathered by direct inspection of `origin/main` at the Base SHA above.

### 3.1 ExperienceBuilder toolbar — no page control exists today

`web/src/modules/store-experience-builder/ExperienceBuilder.tsx:1290-1482` — the header row is: Exit → store-name label (a **static** `t("currentPage")` string that does nothing today — it is not a functioning control) → `VersionSelector` (desktop) / a "Versions" button opening a bottom sheet (mobile) → draft-status badge → `ms-auto` group (Open store link, Desktop/Tablet/Mobile device switcher, Restore, Save, Publish, Schedule (`hidden lg:inline` — already toolbar-budget-constrained per H1-5's own finding)).

Critically, `VersionSelector.tsx`'s own doc comment **already anticipates** this exact Horizon:

> "مؤشّر النسخة في الشريط العلوي، منفصل بصرياً ودلالياً عن أي مُنتقي صفحة مستقبلي: يجيب «أي نسخة تصميم أُعدِّل؟» لا «أي صفحة أعرض؟»." (`VersionSelector.tsx:4-7`)

This means the CUST-H1 implementers deliberately pre-separated "which Version" from "which page" in the code's own self-documentation, before CUST-H2 was scoped. The Page Navigator is new, unrelated code — not an extension of `VersionSelector`/`VersionManagerPanel`, which reference nothing about pages.

### 3.2 The presentation document is 100% Homepage-shaped

`StorefrontPresentationConfig` (`web/src/modules/store-experience-builder/presentation/config.ts:81-150`, mirrored byte-for-byte in `storefront/src/lib/presentation/config.ts`) is one flat document: theme tokens, `branding`, `header`, `homepage: { sections, heroHeadline, heroSubheadline }`, `footer`, `contact`, `whatsapp`, `social`, `verification`, `sbc`, `apps`, `pages` (informational/CMS-metadata pages — `about`/`contact`/`faq`/policies — unrelated to Home/Product/Category). There is no namespace today for Product-page or Category-page presentation. `StorefrontPreviewCanvas.tsx` has no `page` prop; it unconditionally renders the fixed header chrome, the `config.homepage.sections` stack, and the fixed footer chrome (`StorefrontPreviewCanvas.tsx:400-698`). There is no branch for a Product or Category page anywhere in that file.

The PHP twin, `App\Support\Commerce\StorefrontPresentationNormalizer`, mirrors this 1:1 (`VERSION = 2`, `MAX_DOCUMENT_BYTES = 1,572,864` = 1.5 MiB, closed `HOME_BUILDER_SECTION_KEYS`).

### 3.3 The persistence model is Version-document-level, not fragment-level

`storefront_presentation_versions` (migration `2026_10_12_010000_...`) stores the **entire** `config` as one JSON column, with a single `revision` for optimistic concurrency — no `page` column, no per-page revision. The Save API (`PUT .../presentation/versions/{version}`) is a **whole-document PUT**: client sends the entire `StorefrontPresentationConfig` plus the `revision` it started from; server returns the entire document back. `PATCH` is reserved for renaming the Version's `name`, not for partial config updates. Version state (`draft`/`scheduled`/`published`) is derived at read time from head pointers (`active_version_id`/`scheduled_version_id` on `storefront_presentations`) — there is no merchant-writable status column, and no per-page state of any kind.

This is the single most important constraint for CUST-H2: **whatever page-specific model is added, it lives inside the same one JSON document, saved by the same whole-document PUT, under the same single Version revision** — unless a deliberate, separately-justified architecture change breaks that pattern. See the companion architecture document's Concurrency section.

### 3.4 The public Product and Category pages have **zero** presentation seam today

This is the most consequential single finding of this evidence pass.

- **Product page** (`storefront/.../products/[slug]/page.tsx` + `ProductDetails.tsx`): a fully hardcoded, 100% real-data (Spree-adapter via `store/v1/products/{slug}`) component tree — `MediaGallery` → category eyebrow → title/wishlist/share → price/compare-at → availability → `VariantPicker` (conditional on `hasVariants`) → quantity stepper + Add-to-cart → description (plain text, not HTML) → `ProductCustomFields` → SKU/options. **No trust badges, no "related products" shelf, no structured specifications table exist anywhere in this component tree** — not even as gated placeholders. They are simply not built.
- **Category page** (`storefront/.../c/[...permalink]/page.tsx` + `CategoryBanner.tsx` + `ProductListing.tsx`): `Breadcrumbs` → title + optional description → subcategory chip rail (`category.children`) → `ListingFilterBar` (facets/sort) → `InfiniteProductList` (infinite scroll, not numbered pagination) → empty state. **No category banner image** — by deliberate design; the code's own comment states the category resource has no image field and a placeholder would be a fabricated commercial claim (`CategoryBanner.tsx:16-22`, consistent with `AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md` §3).
- A repository-wide search for any import of `@/lib/presentation/*` inside the Product/Category page files returns **nothing**. Today's theme system (colors, radius, header/footer chrome, Homepage section stack) has no reach into these two page types at all beyond the global CSS-variable/header-style layer the storefront shell already applies everywhere.

**Consequence:** CUST-H2 is not "extending an existing seam to two more pages." It is introducing the **first** presentation seam these two page types have ever had. That is a large unlock, and it is also why the roadmap correctly scopes structured Product/Category *editing* into later slices (CUST-H2-3/H2-4) behind this ARCH-1 contract-only slice.

### 3.5 No authenticated workspace catalog-read endpoint exists for a Preview-entity picker

The Customizer runs under the authenticated Commerce workspace auth chain (`Sanctum` + `EnsureUserPrincipal` + `SetTenant` + `EnsureActiveSubscription` + `commerce.manage`, per `CommerceWorkspaceStorefrontPresentationVersionController`'s own pattern). A search of `routes/api.php` for any `commerce/workspace` product or category route returns nothing. `CommerceProductController`/`CommerceCategoryController` exist (`app/Http/Controllers/Api/Commerce{Product,Category}Controller.php`) but are wired only in `routes/api_commerce.php` under the **mobile Commerce API** (`AuthenticateApiClient` — a store bearer token resolved to a `SalesChannel`, not a logged-in ERP/Commerce workspace user). The public storefront's own `store/v1/products`/`store/v1/categories` are Host-resolved and anonymous.

**Consequence:** there is today no reusable, authenticated, tenant-scoped, `commerce.manage`-gated endpoint the Customizer's future "which product/category am I previewing" picker could call. This is recorded as a named gap in the Gap Matrix below and carried into the architecture document's capability-state table rather than invented here.

### 3.6 Homepage section model, precisely (correcting an over-broad reading of the docs)

Per actual code, only **`offers`** is capability-gated (`GATED_HOME_SECTION_KEYS = ["offers"]`, `tokens.ts:58`) — never rendered on the public storefront regardless of merchant content. `hero`/`categories`/`newArrivals`/`wholesale` are unconditionally implemented and are the fallback when no presentation exists at all. `banner`/`benefits`/`customContent`/`featured`/`appPromo` are **live but content-gated**: real published components (`BannerBand`, `BenefitsBand`, `CustomContentBand`, `FeaturedShelf`, `AppPromoBand`) exist and render only when the merchant has authored non-empty content for them (`storefront/.../page.tsx:120-234`, `publishedNodes()`).

### 3.7 Existing tests / QA surface

Backend: extensive `StorefrontPresentation*Test.php` coverage (draft/publish/versions/schedule/dispatcher/backfill/legacy-compat/Postgres-concurrency/normalizer/public-runtime — 12 files). Frontend: 14 vitest files under `store-experience-builder/__tests__/`, but **only one** Playwright spec exists for the whole Customizer surface (`store-brand-qa.spec.ts`) — nothing Experience-Builder-specific, and **no Playwright spec exists at all for the Product or Category pages**, and no presentation-parity test exists for either. This is new test surface CUST-H2 will need to create, not extend.

---

## 4. Gap Matrix

| Roadmap requirement | Current support | Missing contract | Risk | Architecture consequence |
|---|---|---|---|---|
| Page Navigator distinct from Version Selector | `VersionSelector` code already self-documents the separation intent; no page control exists | A new toolbar control + `currentPage` editor state | Toolbar overflow at 390/430/768 (H1-5 already found and fixed one toolbar-budget bug) | Reuse the dead `t("currentPage")` label's existing toolbar slot rather than adding new width budget (see §6) |
| Page-specific presentation model | None — `StorefrontPresentationConfig` is Homepage-only | New optional namespace inside the same JSON document (not a new table) | Schema-version churn if done carelessly; must stay backward compatible | See architecture doc §"Proposed Multi-Page Presentation Model" |
| Product page structured regions | Real, fully LIVE, hardcoded component tree; zero presentation seam | Region registry + region-instance persistence + Canvas rendering path for Product | Merchant must never be able to hide/delete Add-to-Cart, price, or gallery | Region contract distinguishes FIXED_REQUIRED from OPTIONAL/REORDERABLE (architecture doc) |
| Category page structured regions | Real, fully LIVE, hardcoded component tree; zero presentation seam; infinite-scroll listing, no banner image field | Same as above, for Category | Filters/sort/grid are commerce-authoritative — presentation must not fork query behavior | Region contract marks grid/filter/pagination FIXED_REQUIRED, layout-only where configurable |
| Preview entity selection (which product/category to preview) | No authenticated workspace catalog-read endpoint exists at all | `GET /api/commerce/workspace/products`, `GET /api/commerce/workspace/categories` (or equivalent), tenant-scoped, `commerce.manage` | Inventing this endpoint here would violate "Do not invent it" | Marked **GATED** in the architecture doc's capability table; picker itself is DESIGN_ONLY until the endpoint exists |
| Public Product/Category runtime honoring presentation | Zero seam today (§3.4) | Teaching the real Next.js Product/Category pages to read `pagePresentation.{product,category}` region order/visibility | Must not fork into a second hardcoded layout; must reuse the exact same components | Deferred to CUST-H2-5 (Cross-page parity); ARCH-1 defines the contract those components will eventually read |
| Version-level vs page-level concurrency | H1 already has a working, tested Version-level 409/conflict UX | None — this is a reuse decision, not a missing contract | Adding page-level revisions would multiply the concurrency test matrix for no proven merchant need | Architecture doc keeps Version-level revision as the sole concurrency granularity for H2 V1 |
| Section vs Region vocabulary collision | Homepage "section" = repeatable, mostly-optional content block; Product/Category needs mostly-fixed structural regions | A distinct "Region" vocabulary and registry, so Home's existing `SECTION_CAPABILITIES`/`GATED_HOME_SECTION_KEYS` are not disturbed | Reusing "section" terminology for Product/Category would imply reorderable/deletable-by-default, which is false for most PDP/PLP regions | Architecture doc introduces `PageRegion`/`PAGE_REGION_REGISTRY` as a sibling contract, not a rename of Home's existing model |

---

## 5. UX Recommendation

### 5.1 Page Navigator

- **Desktop:** replace the currently-dead static `t("currentPage")` label (today at `ExperienceBuilder.tsx:~1305`, immediately after the store-name, immediately before `VersionSelector`) with a real compact dropdown — same toolbar slot, so no new width budget is consumed on an already-tight toolbar (H1-5 found and fixed a real 768px/toolbar-overflow bug; CUST-H2 must not reopen it). Visually distinct from `VersionSelector`: a page icon + page name (e.g. "🏠 الرئيسية ▾") rather than `VersionSelector`'s name+state-badge shape, so the two controls are never visually confusable, matching Shopify's precedent of a template selector visually and positionally separate from Save/preview controls, and matching AWJ's own already-recorded intent in `VersionSelector.tsx`'s doc comment.
- **Mobile:** the existing bottom action bar is already at capacity (Sections / + / Design, per `ExperienceBuilder.tsx:1692-1714`) and the `MobileSheet` union (`"sections" | "settings" | "design" | "versions" | null`) already has a precedent for a non-editing sheet (`"versions"`). Do not add a 4th bottom button. Recommend a small page-name pill at the top of the Canvas (not the bottom bar) that opens a `"pages"` bottom sheet — keeping the bottom bar exactly as merchants already know it, and keeping the Canvas primary per the UX_V2 mobile rule.
- The merchant must always be able to answer both "which Version am I editing?" and "which page am I previewing?" independently — reinforcing, not merging, the two questions, exactly as `VersionSelector.tsx`'s own comment already commits to.

### 5.2 Version + Page relationship

Page is editor-session state, not Version identity. Switching pages must not reload the Version from the server (the whole `StorefrontPresentationConfig` document — now including page-specific data — is already held client-side after one Version GET, exactly as Home/chrome edits already coexist in that same in-memory object today). Switching Versions replaces that whole document (as today); the currently-selected page (and the currently-selected preview product/category) are editor context that may reasonably survive a Version switch, since they answer "what am I looking at," not "which design am I editing."

### 5.3 Preview entity selection

Strong preference, consistent with the task's own framing and with how `viewport`/`selectedSection`/`selectedChrome` already behave in `ExperienceBuilder.tsx` today (plain React state, never part of the persisted `config`): the chosen preview product/category is **editor context only**, never persisted presentation authority, never sent in the Save/Publish request body. This also sidesteps the confirmed missing-endpoint gap (§3.5/§4) becoming a blocking dependency for the schema/registry foundation slice (CUST-H2-1) — the picker's data-source gap only blocks the *picker UI* (CUST-H2-3/H2-4), not the contract this ARCH-1 slice defines.

---

## 6. Non-goals of this pass

No application code was changed to produce this document. No conclusion here authorizes implementation, migration, API, or public-runtime change — see the companion architecture document for the precise proposal and its own explicit merge/deploy gate.
