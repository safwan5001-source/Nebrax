# ADR-21 — Data-backed Store Builder Sections (FLOWERS-BUILDER-SECTIONS-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H9 (H9a: content contract; H9b: storefront renderers; H9c: builder UI)
**Date:** 2026-10-04
**Scope:** shared Store Builder — not Flowers-only

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- The builder (`web/src/modules/store-experience-builder`) and the public storefront share one presentation document. Section instances are `{id, type, visible, content?}` over a **closed set of types**; the PHP `StorefrontPresentationNormalizer` is the server authority and two TypeScript twins (`web/.../presentation/section-content.ts`, `storefront/src/lib/presentation/section-content.ts`) must agree with it. Unknown types and unsafe content are dropped (fail closed); empty content is omitted. Existing sections (`featured`, `offers`) store **references only** and read live Commerce data.
- H2 added merchant-defined facets (occasion, recipient, …) and manual collections, readable through `GET products?collection=` / `facet[key]=` and the facet/brand counts in the product list `meta`; H7/H8 added the public `delivery-schedule` read and the derived `delivery_promise` / `deliver_today`.

## 2. Decision (AWJ DECISION)

The Horizon's candidate sections (occasions, recipients, flower types, gift categories, brands, best sellers, premium, personalized, products by occasion/recipient, deliver today, curated collections, seasonal campaigns, delivery promise) are **three generic data-backed types**, not twenty bespoke ones. Their *meaning* comes from merchant data (a collection or facet value the merchant already defines and names), so no marketing label or occasion is hard-coded and a new campaign needs no release.

| Type | Stores (content) | Reads live |
|---|---|---|
| `productShelf` | `title` (≤ 80), optional `source` = `{kind:'collection', slug}` or `{kind:'facet', key, value}`, `deliverToday` (bool), `limit` (2–12, default 8) | products (price, availability, promise) via the public product list |
| `discovery` | `title` (≤ 80), `dimension` (a facet key, or `brand`), `display` (`tiles`\|`chips`) | facet values / brands and counts from the product list meta |
| `deliveryPromise` | optional editorial `title` (≤ 80) and `body` (≤ 200) | the earliest slot from the public delivery schedule |

Rules:

1. **Sections consume data; they own no business truth.** Content never holds product ids, names, prices, stock, discounts, facet values, counts, dates or slots. A shelf with only `deliverToday` is valid ("Deliver Today"); a shelf with neither a usable source nor `deliverToday` has no content.
2. **Fail closed, twin-aligned.** Slugs/keys use the existing safe-token rule; titles are plain text bounded by code points; non-boolean `deliverToday` is false; non-integer `limit` falls back to the default; unknown source kinds, unsafe tokens and unknown displays are dropped; extra keys are dropped; empty content is omitted. PHP and both TS normalizers read **one shared fixture** (`tests/Fixtures/presentation/data-sections.json`) in their tests.
3. **Seasonal and editorial needs reuse existing mechanisms.** Valentine's/Mother's Day/Ramadan/Eid/graduation/campaigns = a merchant collection or facet value + a merchant-authored shelf title. Care guide, why-shop-with-us and store story = the existing `benefits` / `customContent` sections (presets belong to H14 onboarding), not new types.
4. **Staged exposure.** H9a makes the server accept and normalize the three types **without** adding them to the default document or to the builder/storefront key lists, so the default document and its TS twins do not change and no merchant can add a section the storefront cannot yet render. H9b adds storefront rendering; H9c adds the builder UI and only then the default-document entries.

## 3. Rejected / Not adopted

- One bespoke type per candidate (twenty types, twenty normalizers/panels/renderers, hard-coded labels).
- Storing product ids, counts or delivery dates in section content (would go stale; duplicates authorities).
- A second builder, or free-form HTML/CSS blocks.
- Hard-coded occasion or recipient taxonomies (they are merchant data since H2).

## 4. Consequences

- Existing documents and the default document are byte-identical until H9c.
- A shelf/discovery source that no longer exists simply renders nothing (the live read returns no products/values) — never an error and never invented data.

## 5. Unknown / deferred

Per-section scheduling windows (campaign start/end), shelf sorting options, shelf/discovery content in the `storefront/` dev customizer copies, and locale-specific titles (existing sections store one merchant-authored string; unchanged here).
