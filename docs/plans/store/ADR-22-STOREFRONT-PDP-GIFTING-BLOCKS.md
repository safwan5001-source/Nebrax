# ADR-22 — Gifting blocks on the storefront product page (FLOWERS-PDP-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H11
**Date:** 2026-10-04
**Scope:** storefront product detail (`storefront/`) — renders contracts that already exist; no backend change

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- `GET store/v1/products/{id}` already returns, each only when non-empty: `personalization.fields` (ADR-16), `content_blocks` (ADR-17), `addons` (ADR-18), and — while delivery scheduling is on — `delivery_promise` (ADR-20). `POST store/v1/cart/items` already accepts `personalization` (key → string) and `addons` (`{product_id, product_variant_id?, quantity}`) and re-validates and re-prices them (ADR-16/18).
- The PDP is assembled from named **page regions** whose order and visibility the merchant controls through the published presentation document (`ProductPageRegionKey`; PHP normalizer + web twin + storefront twin). Region keys are therefore a three-way contract.
- Gift message, delivery date and slot, and recipient are checkout-level (ADR-15/19) and belong to H12.

## 2. Decision (AWJ DECISION)

1. **Render, don't decide.** The storefront parses the four blocks into a view model (`pdp-gifting.ts`: validated keys / UUIDs / currencies / dates / clock times, bounded counts, locale-picked names; malformed rows dropped, never repaired) and sends only the shopper's *choices* — answers and add-on `{product, variant, quantity}`. Prices shown for add-ons are informational; the server owns validation and pricing. The request carries no price and omits `personalization` / `addons` entirely when nothing was chosen, so the add-to-cart call of a product without gifting inputs is unchanged.
2. **No new page-region keys.** Adding reorderable regions would change the presentation contract in PHP and both TypeScript twins and every tenant's stored document. The blocks attach to existing regions instead: the delivery promise under `availability`; personalization and add-ons with `quantity_cta` (purchase configuration belongs with the action it feeds, outside the fixed AWJ Market bar); structured information under `description`. Each region still renders nothing when its data is absent, and wholesale (Spree) products carry no gifting data.
3. **Delivery promise wording is honest.** The promise has no timezone, so "today" is shown only from the server's own `same_day` flag, any other date as a plain calendar date (never "tomorrow"), and a not-deliverable promise as a neutral line. Date and slot are chosen and re-checked at checkout (H12).
4. **Required personalization is gated client-side only to save a round trip and focus the first gap**; the server rejects what it does not accept. Inputs enforce the field's `max_length`, are labelled, describe their help/error text, and set `aria-invalid`.
5. **Accessibility / RTL:** fieldset + legend groups, 44px targets on inputs and selects, logical spacing, `bdi` around prices and counters.

## 3. Rejected / Not adopted

- New region keys for each block (contract churn across three code bases and stored tenant documents).
- Computing or caching add-on prices or availability in the browser.
- A client-side "same day" or "tomorrow" derived from the browser clock.
- Rendering content blocks as HTML.

## 4. Consequences

- A product with none of the four blocks renders and adds to cart exactly as before.
- A merchant who hides the `description` region also hides the structured information; hiding `availability` hides the promise (the existing region visibility semantics).

## 5. Unknown / deferred

- Destination (city/region) entry on the PDP and destination-aware promise — needs the destination model (H12).
- Recommendations — no API exists.
- Per-block ordering across blocks of the same type beyond the API's own sort order.
