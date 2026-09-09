# ADR-02 — Inventory Reservation & Available-to-Sell

**Status:** Accepted — Architecture Direction  
**Date:** 2026-09-09  
**Scope:** AWJ Commerce inventory-availability architecture only — no implementation approval

## Context

ADR-01 established that Commerce Order is independent from Sales Invoice and that Inventory Reservation is independent from physical Stock Movement. The Existing Architecture Audit identified the absence of a first-class reservation / Available-to-Sell capability as the highest-priority Commerce inventory gap. It also found that current legacy sales paths can sell without an availability reservation gate.

AWJ Commerce will serve multiple channels, including native web commerce, mobile commerce such as «متجرنا», POS, and future external channels. Those channels must not promise the same physical inventory independently.

This ADR defines the invariants of the future reservation capability while preserving the existing Inventory Core, valuation, accounting, and legacy flows.

## Decision

AWJ Commerce will introduce a first-class, auditable, warehouse-scoped Inventory Reservation capability.

Reservations affect **availability**, but never by themselves change physical On Hand quantity, inventory valuation, average cost, COGS, Journal Entries, or the General Ledger.

The central conceptual relationship is:

```text
Available To Sell = max(0, On Hand - Active Reserved)
```

The exact production calculation may later account for approved stock classifications or policies, but no Commerce channel may treat raw `On Hand` alone as guaranteed sellable availability.

## 1. Reservation != Stock Movement

A reservation is an operational commitment against stock. It is not a physical issue.

Example:

```text
Initial
On Hand   = 10
Reserved  = 0
Available = 10

Reserve 3
On Hand   = 10
Reserved  = 3
Available = 7
```

When fulfillment physically issues those three units, the inventory movement reduces On Hand and the corresponding reservation is consumed/reconciled. The architecture must prevent both reservation and fulfillment from reducing physical stock independently for the same units.

## 2. Warehouse-scoped availability

Reservations and sellable availability must be evaluated at the inventory fulfillment-source level, at minimum Product × Warehouse within the trusted Tenant boundary.

A company-wide quantity is not sufficient to promise stock assigned to a specific fulfillment source.

Conceptually:

```text
Tenant
 └─ Warehouse
     └─ Product
          └─ Reservations
```

Selection/routing of which warehouse should fulfill an order is explicitly deferred to the follow-up **Channel ↔ Warehouse / Fulfillment Source ADR**.

## 3. Auditable reservation records

AWJ must not rely on a single mutable `reserved_quantity` field as the sole source of reservation truth.

The future capability requires auditable reservation records capable of explaining who/what reserved inventory, the quantity, fulfillment source, lifecycle state, and relevant source/idempotency identity.

A conceptual record may contain information such as:

```text
InventoryReservation
  tenant
  warehouse
  product
  source_type
  source_id
  quantity_base
  status
  expires_at
  idempotency_identity
```

This is **not an approved database schema**.

Derived/cached counters may later be used for performance, but they must not erase the auditable source records or create an independent conflicting truth.

## 4. Reservation lifecycle

The minimum conceptual lifecycle is:

```text
ACTIVE
  ├─ CONSUMED
  ├─ RELEASED
  └─ EXPIRED
```

Only active reservations reduce Available-to-Sell.

- **ACTIVE:** inventory is committed operationally and reduces availability.
- **CONSUMED:** the reserved quantity has been fulfilled/physically issued according to the approved inventory flow.
- **RELEASED:** the commitment was intentionally removed, for example after cancellation or an approved workflow transition.
- **EXPIRED:** a time-bounded reservation/hold reached its expiry according to an approved policy.

Records should remain auditable rather than being deleted merely because they no longer reduce availability.

Exact persistence/state-transition implementation is deferred.

## 5. Reservation timing is policy-driven and remains partially undecided

ADR-02 preserves the Best-of-Breed rule: **Capability != Policy**.

Candidate policy values remain conceptually:

```text
InventoryReservationPolicy

ON_ORDER_CONFIRMATION
ON_PAYMENT_CONFIRMED
```

ADR-02 does **not** approve a universal default yet. Payment method, COD, external gateway behavior, channel semantics, and order confirmation rules can affect the correct timing.

A short-lived checkout/payment hold may be required to prevent simultaneous customers from being promised the same last unit while a payment attempt is in progress. If adopted, it must use the same reservation capability with an explicit purpose/type rather than creating a second independent inventory truth.

The exact checkout-hold timing, TTL, renewal, conversion to order reservation, and payment interaction are deferred to the Payment/Checkout ADR.

## 6. Atomic acquisition is mandatory

Availability check and reservation acquisition must be one concurrency-safe operation.

The following pattern is **not sufficient** when executed without transactional concurrency protection:

```text
if available >= requested:
    reserve(requested)
```

Two concurrent requests could both observe the same final unit and both succeed.

The implementation must guarantee the invariant that successful competing reservations cannot collectively reserve more than the sellable quantity permitted by policy.

Conceptually:

```text
BEGIN
  acquire concurrency protection for Product × Warehouse stock
  determine current permitted availability
  reject if insufficient
  create/update reservation idempotently
COMMIT
```

The exact locking/serialization mechanism is an implementation decision and must be validated on the production database engine, including PostgreSQL concurrency tests.

## 7. Reservation mutations must be idempotent

Create, release, consume, expiry-processing, and callback-driven reservation mutations must be designed so retries do not duplicate or over-release inventory.

AWJ already has mature idempotency precedents in Public API and POS checkout. Commerce should reuse/generalize those principles rather than inventing an unrelated retry model.

Idempotency must not weaken Tenant Isolation or permit an idempotency key from one tenant/source to affect another.

## 8. Oversell is rejected by default in Commerce

For inventory-tracked Commerce items, insufficient Available-to-Sell must reject the reservation by default.

Example:

```text
Available = 2
Requested = 3
Result    = reservation rejected
```

AWJ must not represent an intentional backorder merely by allowing negative physical stock or negative Available-to-Sell.

A future `ALLOW_BACKORDER` capability/policy may be introduced through a separate approved decision if required, with explicit semantics. It is not part of ADR-02 V1 direction.

This decision applies to the new Commerce reservation boundary and does not silently change legacy ERP/POS behavior.

## 9. Non-inventory items do not reserve stock

Services and products that do not track inventory do not require physical inventory reservation.

The implementation must use the authoritative Product/Inventory configuration rather than infer this from channel presentation metadata.

## 10. UOM normalization is mandatory

Reservation comparisons and concurrency guarantees must operate on a canonical inventory/base quantity compatible with AWJ's existing UOM conversion rules.

Example:

```text
1 carton = 12 base units
Order quantity = 2 cartons
Reservation quantity = 24 base units
```

The original commercial UOM/quantity should remain available where required for order history and audit, while reservation safety uses normalized inventory quantity.

Reservation must not introduce a second UOM conversion authority.

## 11. Reservation has no valuation or accounting effect

Creating, extending, releasing, consuming-as-a-reservation-state, or expiring a reservation must not by itself modify:

- moving-average cost;
- inventory valuation;
- COGS;
- General Ledger balances;
- Journal Entries;
- revenue recognition;
- VAT/ZATCA documents.

Physical fulfillment/stock movement and Invoice/accounting effects remain owned by their existing approved domains as established by ADR-01.

## 12. Release and expiry restore availability

When an active reservation is legitimately released or expires, its remaining active quantity stops reducing Available-to-Sell.

Order cancellation, failed/abandoned checkout, payment failure, or operational cancellation may trigger release only according to the later approved workflow/policy. ADR-02 defines the inventory invariant, not every business trigger.

Release/expiry must be idempotent and auditable.

## 13. Partial fulfillment must preserve the remainder

The reservation capability must support partial fulfillment without releasing the unfulfilled remainder accidentally.

Conceptually, if ten units are reserved and six are fulfilled:

```text
Reserved initially: 10
Fulfilled:           6
Remaining reserved:  4
```

The implementation may represent this using split reservation records, quantity fields, immutable events, or another proven design, but the four unfulfilled units must remain reserved until consumed, released, or expired according to policy.

ADR-02 does not approve a persistence representation.

## 14. Backward compatibility and POS migration

ADR-02 does not immediately force existing ERP/POS sales paths through the new reservation engine.

Initial Commerce implementation may introduce reservation for web/mobile Commerce while legacy flows remain operational. However, the long-term architecture must converge toward a consistent availability truth across channels; otherwise a legacy/POS sale could consume stock already promised to Commerce.

Any migration of POS or legacy Invoice flows to reservation-aware availability is a separate scoped change requiring regression tests and explicit approval.

Negative-stock behavior in existing flows is not redefined by this ADR.

## 15. External channels

For future Salla, Zid, Shopify, WooCommerce, or other connected channels, AWJ must distinguish:

```text
Internal Reservation Truth
External Inventory Projection
Reconciliation
```

Publishing an inventory quantity externally is not equivalent to acquiring an atomic distributed lock in that external system.

The candidate quantity projected to a channel should derive from approved sellable availability rather than blindly exposing physical On Hand. Safety buffers, source-of-truth direction, webhook behavior, latency handling, and reconciliation rules are deferred to integration-specific ADRs/plans.

## 16. Tenant Isolation and security

Every reservation mutation and availability calculation must occur inside a trusted Tenant context.

Product, warehouse, source order, reservation, and any external mapping identifiers must be validated as belonging to the same tenant before mutation.

Background expiry workers, payment callbacks, inbound webhooks, and external synchronization jobs are not exempt from Tenant Isolation. They must establish trusted tenant identity before resolving tenant-owned records.

Cross-tenant reservation or release is a critical security/data-integrity failure and requires dedicated negative tests in implementation.

## 17. Required implementation invariants

Any future implementation must preserve at least these invariants:

1. Reservation never directly changes physical On Hand.
2. Reservation never directly changes valuation, cost, COGS, ledger, or tax documents.
3. Only active reserved quantity reduces Available-to-Sell.
4. Availability is scoped to the selected fulfillment inventory source.
5. Successful reservation acquisition is atomic under concurrency.
6. Reservation mutations are idempotent.
7. Insufficient sellable inventory rejects Commerce reservation by default.
8. UOM quantities are normalized using existing inventory conversion authority.
9. Partial fulfillment preserves the unfulfilled reservation remainder.
10. Release/expiry cannot release more than the valid remaining reservation.
11. Tenant-owned identifiers cannot cross Tenant boundaries.
12. Legacy ERP/POS behavior is not silently changed by introducing Commerce reservation.

## 18. Explicit non-decisions

ADR-02 intentionally does **not** decide:

- database tables/columns/indexes;
- locking primitive or isolation level;
- cached/denormalized reservation counters;
- universal default `InventoryReservationPolicy`;
- checkout-hold requirement as a V1 feature;
- checkout-hold TTL/renewal rules;
- payment gateway interaction;
- COD-specific reservation timing;
- warehouse selection/routing;
- multi-warehouse split allocation;
- branch ↔ warehouse semantics;
- external-channel safety buffers;
- backorder implementation;
- preorder implementation;
- POS migration timing;
- legacy negative-stock policy;
- reservation UI;
- exact public/mobile API contract;
- fulfillment persistence model;
- return valuation.

These require follow-up ADRs or implementation plans.

## 19. Consequences

### Benefits

- Prevents independent Commerce channels from promising the same available stock under correct implementation.
- Preserves physical inventory and accounting truth while adding operational commitments.
- Creates an auditable explanation for reserved inventory.
- Supports web/mobile Commerce, partial fulfillment, future external channels, and eventual POS convergence.
- Provides a clean foundation for payment holds and warehouse routing without coupling them to inventory valuation.
- Makes concurrency and idempotency explicit architecture requirements rather than afterthoughts.

### Costs and trade-offs

- Introduces a new inventory-adjacent subsystem with concurrency-sensitive behavior.
- Requires strong PostgreSQL concurrency and Tenant Isolation testing.
- Requires lifecycle cleanup/reconciliation for released/expired/stale reservations.
- Creates a transition period where legacy sales paths may not yet participate in the same availability gate.
- External channels remain eventually consistent and require reconciliation.
- Warehouse routing and payment timing must be solved before the full Commerce flow is complete.

## 20. Follow-up sequence

After ADR-02, the architecture sequence is:

1. **Channel ↔ Warehouse / Fulfillment Source**
2. **Payment Intent / Authorization / Capture / Refund**, including any checkout-hold timing decision
3. **Customer / Mobile Identity Boundary**
4. External-channel inventory projection/reconciliation as required
5. Accounting review for Return Valuation where required

No production implementation, migration, API change, POS behavior change, merge, or deployment is authorized by this ADR.

## References

- `ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md`
- `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md`
- `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`
- `AWJ_COMMERCE_PLATFORM_RESEARCH.md`
- `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md`
- `AWJ_STORE_MASTER_PLAN.md`
