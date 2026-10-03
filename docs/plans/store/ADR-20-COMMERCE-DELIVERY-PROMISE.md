# ADR-20 — Derived Delivery Promise (FLOWERS-AVAILABILITY-1 / FLOWERS-SAMEDAY-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H8 (H8a: promise seam, preparation time, `commerce/v1` exposure; H8b: `store/v1` parity and the `deliver_today` filter)
**Date:** 2026-10-03
**Scope:** shared Commerce read seam — not Flowers-only

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- `AvailableToSellService` is the single authority for sellable quantity (On Hand − active reservations, per warehouse and variant); `FulfillmentPolicyService` resolves the channel's warehouse.
- ADR-19 / H7 added the channel delivery schedule (lead time, cut-off, blocked dates, windows, capacity, zone restriction). It deliberately deferred per-product lead time and "deliver today" eligibility to H8 "to avoid two lead-time authorities" (ADR-19 §3).
- Product lists and PDP already compute `in_stock` per row (one ATS read per row today).

## 2. Decision (AWJ DECISION)

The delivery promise is **derived at request time, never stored**, by composing existing authorities. This ADR adds no copy of ATS and no copy of scheduling rules.

```text
deliverable = published (caller-guaranteed)
              ∧ valid fulfilment warehouse for the channel
              ∧ ATS > 0                       (AvailableToSellService)
              ∧ ∃ window applicable to the destination, after
                effective lead time, same-day cut-off, blocked dates,
                weekday, capacity               (CommerceDeliveryScheduleService)
same_day    = deliverable ∧ earliest.date == today in the channel timezone
```

### 2.1 Preparation time (the one new input)

- `commerce_product_preparations`: one row per product, `preparation_minutes` 1…43 200; **absent = no product-specific lead** (`0`/`null` in the API deletes the row — one representation). `CompanyWide`, `OWNED_CHILD` of the product (cleaned with a true delete; no financial or stock effect).
- Admin `GET/PUT commerce/workspace/products/{id}/preparation` (`products.view` / `products.manage`, self-service denied, tenant-scoped 404).
- **Effective lead = max(channel lead, product preparation)**, not the sum. The channel lead is the floor for processing any order; a product preparation time is how long that product needs. Adding them would count the same elapsed time twice. This keeps one lead-time authority (the schedule evaluator) with a per-call override.

### 2.2 Reusable seam, constant queries

- `CommerceDeliveryScheduleService::context()` loads the channel policy once (settings, applicable windows, grouped bookings, blocked dates, DST intervals); `evaluate(context, minLead, stopAtEarliest)` is pure in-memory. `options()` is now `evaluate(context())` — public behaviour is unchanged.
- `AvailableToSellService::forWarehouseMany()` + `InventoryReservationService::activeReservedMany()` read On Hand and active reservations for many products in two grouped queries with the same definitions as the single reads.
- `CommerceDeliveryPromiseService::forProducts(channel, products, city?, region?, now?)` returns `productId => promise` (or `null` while scheduling is off). The query count does not depend on the number of products or distinct preparation times (verified by a test). This is the shared seam for PDP, cards, collections, the Store Builder and Deliver Today.

### 2.3 Exposure

- `commerce/v1` `GET /products` and `GET /products/{id}` gain `delivery_promise` **only while the channel's scheduling is enabled** (ordinary payloads are byte-identical otherwise). Optional `city`/`region` query parameters only select zone-restricted windows; without a destination only unrestricted windows count.
- Payload: `{deliverable, same_day, earliest: {date, slot{id,label,label_en,start_time,end_time}} | null, reason: null | not_configured | out_of_stock | no_slot}`. Preparation minutes are not exposed.
- The promise is informational. Checkout still revalidates the chosen window server-side (ADR-19); stock is still checked at completion (ADR-01/02). A promise never reserves stock.

## 3. Rejected / Not adopted

- Storing a "deliver today" flag or any cached promise (would go stale; "must change automatically").
- Summing channel and product lead times; a second lead-time or cut-off model.
- A parallel stock computation in the promise service.
- Hard-coded marketing labels ("same day", "express") — `same_day` is a derived boolean only.
- Pickup promises, carrier/driver capacity, per-product delivery restrictions (V1).

## 4. Consequences

- Channels without scheduling see no change anywhere.
- No ledger, VAT, ZATCA, inventory valuation or price behaviour changes.

## 5. Unknown / deferred

H8b (`store/v1` parity and the `deliver_today` list filter); promise for pickup; per-variant preparation time; promise on cart lines.
