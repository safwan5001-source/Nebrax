# ADR-19 — Commerce Delivery Scheduling (FLOWERS-DELIVERY-CONTRACT-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H7 (H7a: model, availability, public options, admin API; H7b: checkout/order integration, capacity)
**Date:** 2026-10-03
**Scope:** shared Commerce fulfilment promise — not Flowers-only

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- Delivery today is a method (`delivery` / `pickup`) plus a city/region ⇒ flat fee (`CommerceShippingZone`, `ShippingRateService`, ADR-10). There is no requested date, no time window and no cut-off. Stock is checked point-in-time at completion (`CommerceCheckoutService` header contract); there is no reservation at checkout.
- `FulfillmentPolicy`/`FulfillmentPolicyService` pick the warehouse for a channel; `AvailableToSellService` derives sellable quantity. Neither knows about time.
- `Tenant.timezone` exists (default `Asia/Riyadh`). `SalesChannel` is the Commerce boundary, not `Branch` (ADR-03).
- H3 (`commerce_gift_settings`) established the pattern: a per-channel typed policy row, **absent = feature off**, a checkout-scoped row, an immutable order snapshot, review-required on revalidation.

**EXTERNAL EVIDENCE** — flower/gift retailers sell a *delivery date + time window* chosen at checkout, with same-day availability governed by a daily cut-off, blocked dates for holidays, and limited slot capacity at peak. The labels vary per merchant; no label is canonical.

## 2. Decision (AWJ DECISION)

Scheduling is **a channel-level policy layered on the existing shipping/fulfilment authorities — shipping is not forked.**

### 2.1 Data (all `CompanyWide`, per `SalesChannel`)

- `commerce_delivery_schedule_settings` — one row per channel, **absent or `is_enabled=false` ⇒ no scheduling and byte-identical checkout**. Fields: `is_required`, `timezone` (IANA, null ⇒ tenant timezone), `lead_time_minutes` (0…43 200), `cutoff_time` (`HH:MM`, same-day cut-off in the policy timezone, null ⇒ none), `max_days_ahead` (1…90, default 30).
- `commerce_delivery_slots` — named windows for a method: `method` (`delivery`/`pickup`), free-text `label`/`label_en` (no hard-coded marketing labels), `start_time`/`end_time` (`HH:MM`, end after start, same day), `weekday_mask` (bit per weekday, Sunday = bit 0), optional `capacity` (null = unlimited; enforced from H7b), optional `shipping_zone_id` (delivery only; null = any destination), `sort_order`, `is_active`. At most 48 per channel.
- `commerce_delivery_blocked_dates` — a calendar date the channel does not fulfil, for `all` methods or one; unique per (channel, date, method).

### 2.2 Semantics (single authority: `CommerceDeliveryScheduleService`)

- All dates are **calendar dates in the policy timezone** (`Y-m-d`); slot times are local wall-clock. The server never trusts a client clock or timezone.
- A slot on date *D* is **selectable** iff: the channel is enabled; the slot is active and matches the method; its weekday bit includes *D*'s weekday; *D* is within `max_days_ahead` and not blocked for the method; the slot **start** (local *D* + `start_time`) is at or after `now + lead_time_minutes`; the same-day cut-off has not passed when *D* is today; and — for delivery — the slot has no zone restriction or the destination resolves to its zone through the existing `ShippingRateService` matcher (city first, then region).
- **Service level / earliest fulfilment** are *derived*: the earliest selectable (date, slot) is returned with the options. No separate "service level" entity in V1 (INFERENCE: named slots cover the need; a distinct level only matters once carrier integrations exist).
- Public read `GET delivery-schedule?method=&city=&region=` on `store/v1` and `commerce/v1` returns only selectable slots (no capacity numbers, no internal ids beyond the slot id). Destination inputs only *filter the display*; H7b revalidates against the **stored** checkout destination.
- Admin API under `commerce/workspace/storefronts/{id}/delivery-schedule…` for a web channel and `commerce/workspace/mobile-channels/{id}/delivery-schedule…` for an active mobile `SalesChannel` (`commerce.manage`; self-service denied; tenant-scoped 404): `GET` (policy + slots + blocked dates), `PUT settings`, `PUT slots` (atomic replace), `PUT blocked-dates` (atomic replace). Same controller and service for both; the channel is never taken from the body. Channel rows are locked for replacement. A mobile channel has no `Storefront`, so its id (as bound to the app's API client) is the identifier.

### 2.3 H7b (recorded here so the contract is one document)

- `PATCH checkout/schedule {date, slot_id}` stores the choice on the open checkout; `complete()` revalidates with the stored method/destination and `now` (`schedule_unavailable` / `schedule_required` ⇒ review-required, no order).
- Capacity is enforced by counting confirmed order schedules for (slot, date) **under a row lock on the slot** inside the order transaction, so two checkouts cannot both take the last place. The order stores an **immutable schedule snapshot** (method, date, slot label/times, timezone); serializers expose `schedule` only when present.

## 3. Rejected / Not adopted

- A second shipping/zone model, carrier or distance logic.
- Hard-coded labels ("same day", "express", occasion names) or per-label business rules.
- Per-product lead time and product delivery restrictions in H7 — deferred to H8 (the derived delivery *promise* per product/listing), to avoid two lead-time authorities.
- Reserving stock when a slot is picked (reservation ≠ checkout contract; ADR-01/ADR-02).
- Any timezone from the client; any date arithmetic in the browser as an authority.

## 4. Consequences

- A channel with no settings row behaves exactly as before. The feature is configuration, not a mandatory behaviour (configurable-policy rule).
- Orders remain commercial commitments (CommerceOrder ≠ Invoice); no ledger, VAT, ZATCA, inventory or price behaviour changes.
- Availability is computed on demand from a handful of small per-channel rows (no per-product queries), so it can be reused by H8/H10 without N+1.

## 5. Unknown / deferred

Per-product lead time and "deliver today" eligibility (H8), recurring/subscription deliveries, driver/route capacity, pickup-location–specific slots (`PickupLocation` is a separate concept, ADR-03), holiday calendars imported from an external source.
