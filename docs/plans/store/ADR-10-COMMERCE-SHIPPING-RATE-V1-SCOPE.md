# ADR-10 — Commerce Shipping Rate V1 Scope (Configurable Zones, No Carrier)

**Status:** Accepted — Owner Decision
**Date:** 2026-09-22
**Scope:** authorizes a shared, merchant-configurable shipping-rate foundation for Commerce Core. Does not select a carrier/aggregator. Does not authorize carrier API integration, label generation, live quotes, multi-warehouse optimization, split shipments, 3PL orchestration, or dimensional/weight-based rating unless proven necessary for the minimum correct zone model.

## Context

Repository evidence (Decision/Evidence Packet, delivered 2026-09-22) confirmed:

- `CommerceCheckoutService::DELIVERY_METHODS = ['pickup', 'standard']` is the entire shipping system today; `delivery_amount_minor` is hardcoded to `0` unconditionally, for every channel.
- `FulfillmentPolicy`/`FulfillmentPolicyService` answers "which warehouse fulfills this channel" (`ADR-03`, `FIXED_LOCATION`) — a different question from "what does shipping cost," and is not the right layer for rates.
- `ADR-03` §17 already explicitly deferred shipping cost optimization, SLA optimization, and 3PL fulfillment as non-decisions.
- `COMMERCE_MOBILE_API_READINESS.md` already classified this "Ready with Hardening": delivery-method selection exists, no rate resource does.
- The Saudi National Address book (`COM-MOBILE-ADDRESSES-1`, merged) already carries `region`/`city`/`district` — the exact fields a zone-based rate lookup needs, with no new address data required.

The Owner Decision authorizes closing the rate gap now, without any carrier commitment.

## AWJ Decision (owner-authorized)

1. **A merchant-configurable shipping-zone/rate model is the V1 shipping policy.** A tenant defines zones (at minimum keyed by the existing address fields — city/region — no new geocoding capability introduced) and a flat rate per zone. This is the first real, non-zero `delivery_amount_minor`.
2. **Server-authoritative, matching the existing `delivery_amount_minor` precedent.** No client-supplied shipping amount is ever accepted — the server resolves the rate from the configured zone table exactly as `CommerceCheckoutService::updateDelivery()` already treats `delivery_amount_minor` as a server-owned field today.
3. **Pickup is preserved unchanged** — it remains a zero-cost method alongside the newly-priced zone-based method(s); no existing pickup behavior is altered.
4. **Shared, not mobile-only.** The rate-resolution service (e.g., `ShippingRateService`, alongside the existing `FulfillmentPolicyService`) is consumed identically by `/commerce/v1`, `/store/v1`, and future App Builder consumers.
5. **Designed for future carrier adapters without a checkout redesign.** The `delivery_method` contract gains a real rate lookup, not a carrier-specific one — a future carrier/aggregator integration (`COM-MOBILE-SHIPPING-CARRIER`, still open) should plug into the same method-resolution point this pass establishes, not require re-touching `CommerceCheckoutController`/`CommerceCheckoutService`'s public contract.
6. **Intentionally bounded scope.** No carrier API call, no label, no live quote, no multi-warehouse split, no dimensional/weight-based rating is built in this pass unless repository evidence during implementation proves the minimum correct zone model cannot function without it (expected outcome: it will not be needed — a flat per-zone rate is sufficient for V1).

## Open Decisions (still not made — explicitly out of scope here)

- **Carrier/aggregator selection** (SMSA, Aramex, Saudi Post/SPL, an aggregator, or none) — a strategic vendor commitment, a separate future Owner Decision.
- Exact zone granularity (city-level vs. region-level vs. a hybrid) is an implementation detail resolved during the task itself from repository evidence (existing address field cardinality), not re-litigated here — it is not a strategic commitment.

## Consequences

### Benefits
Replaces a hardcoded `0` with a real, merchant-controlled shipping charge without any vendor dependency; establishes the seam a future carrier adapter plugs into cleanly.

### Costs / trade-offs
No live rate accuracy, no tracking, no label — this is a manual-fulfillment-appropriate model, not a full 3PL integration; merchants needing real-time carrier rates will need the (separately gated) carrier integration later.

## References
- `docs/plans/store/ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` §17
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §14
- `docs/plans/commerce/COM-MOBILE-SHIPPING-1-IMPLEMENTATION-REPORT.md` (full evidence, once implemented)
