# ADR-14 — Commerce Catalog Facets & Collections (FLOWERS-TAXONOMY-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H2
**Date:** 2026-10-03
**Scope:** shared Commerce catalog/merchandising — *not* Flowers-only
**Gate resolved:** `FLOWERS-TAXONOMY-1` (Category vs Facet vs Collection vs Occasion vs Recipient vs Brand vs Variant)

---

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- `ProductCategory` is a real structural hierarchy (branch-sharing aware), published per channel through `CommerceCategoryListing`.
- Storefront/mobile product lists filter only by `category_id`, `search`, `sort`. No facet engine, no collection model exists (`FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md` §6–8).
- `Product.brand_id` + `Brand` exist; they are not exposed as a storefront filter.
- `Classification` (ERP analytics) is **single-valued, document-analytical and branch-scoped** — it cannot express "a product belongs to several occasions" and must not be overloaded (`CLASSIFICATIONS_IMPLEMENTATION_PLAN.md`).
- `ProductVariant`/`ProductOption` model sellable SKU identity (size, flavour) and must never carry occasion/recipient.
- Commerce publication rows (`CommerceListing`, `CommerceCategoryListing`) are `CompanyWide` and are the public gate.

**EXTERNAL EVIDENCE**

- Shopify exposes storefront filters from product options, metafields (including metaobject references for governed values) and category attributes; multi-value dimensions are filtered with OR within a dimension and AND across dimensions (Shopify Help Center "Search & Discovery filters"; Storefront API `ProductFilter`).
- Saleor models attributes as reusable, strictly-typed fields, distinct from free-form metadata (Saleor docs, "Attributes overview").
- FNP Saudi evidence: a curation can contain products that do not share the same occasion, so *Collection ≠ Facet* (`FNP_DEEP_EVIDENCE_1_REPORT.md`).

**INFERENCE** — A governed, tenant-configurable *dimension → values → product assignment* model covers Occasion, Recipient, Flower type, Colour, Flavour etc. without a column per merchant idea.

## 2. Decision (AWJ DECISION)

| Concept | Owner | Cardinality | Purpose |
|---|---|---|---|
| **Category** | existing `ProductCategory` | 1 per product | structural hierarchy — *unchanged* |
| **Facet** (dimension) | new `commerce_facets` | merchant-defined | filterable descriptive dimension |
| **Facet value** | new `commerce_facet_values` | many per facet | localized, sortable, active/inactive value |
| **Assignment** | new `commerce_product_facet_values` | many-to-many | a product may hold several values per facet |
| **Occasion / Recipient** | *system-key facets* (`system_key = occasion | recipient`) | many-to-many | merchandising — **not enums, not variants** |
| **Brand** | existing `Product.brand_id` | 1 per product | exposed as a **built-in filter dimension**, not copied into facets |
| **Collection** | new `commerce_collections` (+ products) | many-to-many, ordered | curated merchandising group (manual in V1) |
| **Variant/Option** | existing | — | SKU identity only |
| **Classification** | existing | — | ERP analytics only — *not reused* |

### 2.1 Facets

- Tenant-owned, `CompanyWide` (the online catalog is company level, like `CommerceListing`). Every row carries `tenant_id`; cross-tenant references are rejected structurally in model `saving` guards, not only in services.
- `key`: stable machine slug, unique per tenant (`unique(tenant_id, key)`). `system_key`: nullable, one of the finite platform keys (`occasion`, `recipient`), unique per tenant when set. System-key facets are ordinary rows the merchant can rename/reorder/deactivate; the key lets Store Builder sections and onboarding address them without hard-coding values.
- Localization follows the existing catalog convention: `name` (Arabic-first) + `name_en`.
- Values: `slug` unique within the facet, `sort_order`, `is_active`. Duplicate prevention: slug unique per facet, and a normalized-name check per facet.
- Deactivating a facet or value hides it from the storefront and from counts; **assignments are retained** so reactivation restores merchandising. Deleting a value that is assigned is refused (deactivate instead); deleting an unused value is allowed.
- A product's assignments are **replaced as a set per request** (idempotent), validated to the same tenant.

### 2.2 Storefront query semantics

- Public filter parameter: `facet[<facetKey>]=<valueSlug>[,<valueSlug>…]`.
- **OR within one facet, AND across facets.** Unknown facet key or value slug → empty result (fail closed), never "ignore the filter".
- Only **active** facets/values are filterable. Built-in `brand_id` filter composes with the same AND semantics.
- `meta.facets` lists filterable facets with values and **disjunctive counts** (a facet's own selection does not narrow its own counts), computed with set-based grouped queries over the already-gated candidate set (`is_active` + published `CommerceListing`). No per-product loops.
- The publication gate (`CommerceListing`) remains authoritative; facets can never expose an unpublished product.

### 2.3 Collections

- Tenant-owned, `CompanyWide`: `title` / `title_en`, `slug` (unique per tenant), `status` (`draft` | `active`), `sort_order`, ordered manual membership (`commerce_collection_products`, `position`).
- A collection is **not a category and not a facet**: members need not share any attribute.
- Public read lists only `active` collections and only their members that pass the product publication gate.
- **Rule-based/smart collections are deferred.** "Deliver Today" is **not** a collection — it is a dynamic availability surface (H8).
- Per-channel collection publication is deferred; V1 gates visibility by `status` + product publication.

### 2.4 Store Builder consumption (data contract)

Sections reference `facet_key` + `value_slug` or `collection_slug` and are resolved server-side through the same read paths. Sections own no taxonomy truth.

## 3. Rejected / Not adopted

- **Occasion/Recipient as hard-coded enums or columns** — violates merchant configurability and the 60+-activity policy rule.
- **Occasion/Recipient as Variants/Options** — they are not SKU identity.
- **Category explosion** (`Flowers > Birthday > For Her > Red`) — rejected by the Horizon.
- **Reusing `Classification`** — single-valued analytics, wrong cardinality and scope.
- **Free-form JSON tags on Product** — ungoverned, unlocalizable, unindexable.
- **Static "Deliver Today" taxonomy** — availability is dynamic (H8).
- **Copying Brand into a facet** — would create a second source of truth.

## 4. Consequences

- Additive migrations only; generic stores are unaffected (no facets → `meta.facets = []`, same product list).
- No effect on ledger, inventory, pricing, ZATCA, Commerce Order/Invoice boundaries.
- Performance: composite indexes `(tenant_id, facet_value_id, product_id)` and `(product_id)`; filtering uses `whereExists`/`whereIn` subqueries; counts use one grouped query per response.
- Bounded growth: per-tenant limits (facets ≤ 30, values per facet ≤ 200) enforced server-side.

## 5. Unknown / deferred

- Smart (rule-based) collections, per-channel collection publication, facet-driven SEO landing pages, facet value images, and search-by-intent remain future work.
