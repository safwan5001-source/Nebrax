# CUST-HV V9e — Product page image zoom on / off — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9e** — closes V9 (V9a category cover → V9b benefits → V9c content blocks → V9d cards / shelves → **V9e product zoom**). |
| **Branch** | `cust-hv/v9e-product-zoom` (stacked on V9d-4 until it merges) |
| **Authority** | V0 §14.2 ("Product page: `zoom: on | off`; gallery thumbnail placement variants **LATER**") · §14.3 (commerce firewall) · §2.2 (additive, normalizers in lock-step) |
| **Scope** | One additive key on the existing `pagePresentation.product` namespace in PHP (authority) + two TS twins + shared fixture; the public gallery; the product-page inspector. No endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Where it lives | `pagePresentation.product.zoom`, beside `regions` (a property of the product page, not of a region or of the global tokens). | The contract names it a product-page option; the namespace already exists and is versioned independently. |
| Stored form | **Only `"off"`**. `"on"`, booleans, other casing, numbers → absence. Canonical key order `version · regions · zoom`. | Absence = today's behaviour, so a document that never chose it is byte-identical (same rule as every additive key). |
| Category pages | Never carry `zoom` (dropped, tested). | Not a category capability. |
| What "off" does | The main picture becomes a plain image: no click-to-enlarge button, no hint, no lightbox. **Swipe between pictures and the thumbnails keep working.** The picture itself, its URL, alt text and size are untouched. | Zoom is a way of looking, not content; navigation between media is not zoom. |
| Not in this slice | Thumbnail placement variants (V0 marks them LATER), pinch-zoom, zoom level. | Smallest coherent set; stated. |

## What was built

- PHP `StorefrontPresentationNormalizer` (`normalizePageTypePresentation(…, withZoom)` — product only) and both TS `page-regions.ts` (`ProductPagePresentation.zoom?: "off"`); fixture `product-zoom.json` (12 cases; expected values computed by the PHP authority).
- Storefront: `resolvePublicProductZoom` (`page-runtime.ts`), `MediaGallery` (`zoomEnabled`, default on; the off branch keeps the swipe handlers), `ProductDetails` passes the resolved value.
- Merchant app: a "Product image zoom" switch under the product-page structure list (with a help line saying price and availability are unaffected); region edits now **preserve** a stored `zoom` (the previous writer rebuilt the product page from `regions` alone and would have dropped it); AR / EN strings.

## Backward compatibility

No `zoom` key ⇒ identical markup, identical behaviour. A product page saved by an older builder (no `zoom`) keeps zoom on. The new builder never writes `zoom: "on"`.

## Tests

- Shared fixture × PHP `StorefrontProductZoomTest` (with idempotence), storefront and web `product-zoom.test.ts` (12 cases each, compared through JSON so key order is pinned).
- `MediaGallery.zoom.test.tsx`: on = zoom button + hint; off = plain picture, no button / hint / lightbox, swipe and thumbnails still navigate; `resolvePublicProductZoom` defaults to on.
- `ExperienceBuilder.productRegions.test.tsx`: the switch dirties the draft, `zoom` survives a later region edit and saves as `version · regions · zoom`; switching back on stores nothing.
- Full suites: web, storefront, PHP mirror (see PR).

## Design Quality Pass

No new visual primitive: the off state is the existing picture frame without its button and hint (same ratio, radius and background, so layout is identical at 390 / 430 / 768 / 1024 / 1280 / 1440 and in RTL / LTR). The inspector control is the shared `Toggle` (44 px rows on small screens, keyboard operable) with a help line.

## Limitations (stated)

- The Canvas product preview has no zoom affordance to hide (it never drew one), so there is no Canvas change; the effect is visible on the published page.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched. **Commerce firewall:** the key is a two-state viewing option; it cannot reach price, availability, offer or tax (also covered by the V9d-4 hostile-document fixture's closed lists). No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
