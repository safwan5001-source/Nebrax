# ADR-03 — Sales Channel ↔ Warehouse / Fulfillment Source

**Status:** Accepted — Architecture Direction  
**Date:** 2026-09-09  
**Scope:** AWJ Commerce channel-to-inventory fulfillment architecture only — no implementation approval

## Context

ADR-01 established Commerce Order as an operational entity independent from Sales Invoice. ADR-02 established a first-class warehouse-scoped Inventory Reservation capability and required sellable availability to be evaluated at the selected inventory fulfillment source.

The next architectural question is therefore: when an order originates from AWJ Web Store, «متجرنا» Mobile, POS, or a future external channel, which inventory source is eligible to fulfill and reserve that order?

AWJ must answer this without conflating sales origin, organizational ownership, and physical inventory location.

## Decision

AWJ separates **Sales Channel**, **Branch**, and **Warehouse** as distinct concepts.

```text
Sales Channel
     ↓
Fulfillment Policy
     ↓
Eligible Warehouses
     ↓
Selected Warehouse
     ↓
Atomic Inventory Reservation
```

Inventory truth remains owned by the existing inventory/warehouse domain. A Sales Channel does not own an independent physical stock balance.

V1 implementation should begin with a fixed eligible warehouse per applicable channel/context. The architecture may support ordered-priority warehouses as a foundation, but automatic optimization/routing engines and automatic multi-warehouse split fulfillment are deferred.

## 1. Channel != Branch != Warehouse

These concepts answer different questions:

- **Sales Channel:** where/how the commercial transaction originated.
- **Branch:** the relevant AWJ organizational/operational unit where applicable.
- **Warehouse:** the physical inventory source from which stock can be reserved and issued.

Examples of Sales Channels may include:

```text
AWJ Web Store
«متجرنا» Mobile
AWJ POS
Salla
Zid
Shopify
Other future connected channels
```

The exact persistence model and channel taxonomy are not approved by this ADR.

A Channel must not be modeled as merely a synonym for Branch or Warehouse.

## 2. Warehouse is the V1 inventory fulfillment source

For inventory-tracked items, the V1 fulfillment inventory source is an AWJ Warehouse.

AWJ should not introduce an excessively generic fulfillment-source abstraction before there is a concrete requirement for non-warehouse stock authorities.

The architecture must nevertheless avoid assumptions that make later support for pickup locations, 3PL nodes, or other fulfillment concepts impossible.

## 3. Channel-to-warehouse eligibility is a mapping

The architecture must not assume that every Sales Channel permanently owns exactly one warehouse through a single hard-coded `warehouse_id` relationship.

Conceptually:

```text
Sales Channel
   ├─ Warehouse A
   ├─ Warehouse B
   └─ Warehouse C
```

A small merchant may configure only one eligible warehouse. A larger merchant may later configure multiple eligible warehouses.

This mapping represents **eligibility/configuration**, not inventory ownership.

Exact database tables, keys, and mapping cardinalities are deferred to implementation design.

## 4. Fulfillment routing policy is finite and typed

AWJ preserves the Best-of-Breed rule: Capability != Policy.

The conceptual policy family remains:

```text
FulfillmentRoutingPolicy

FIXED_LOCATION
PRIORITY_LOCATIONS
ROUTING_ENGINE
```

ADR-03 classifies these as follows:

- **FIXED_LOCATION — V1 implementation direction.**
- **PRIORITY_LOCATIONS — V1 foundation / later activation.** The architecture must not prevent it, but V1 need not implement automatic fallback routing unless separately approved.
- **ROUTING_ENGINE — Later/Advanced.**

AWJ will not build a generic optimization engine in V1 for nearest warehouse, cheapest shipment, SLA optimization, load balancing, or other advanced routing criteria.

## 5. Routing succeeds only when reservation succeeds

Warehouse selection and inventory reservation cannot be treated as two unrelated promises.

A route is not considered successfully allocated merely because a warehouse appeared to have stock at an earlier read.

The final allocation must be backed by a successful atomic reservation under ADR-02.

Conceptually, for a future ordered-priority policy:

```text
eligible warehouses
       ↓
try according to approved order
       ↓
atomic availability + reservation
       ↓
success => allocation succeeds
failure => try next eligible source if policy permits
```

If concurrency causes availability to disappear before reservation acquisition, the candidate warehouse is not considered successfully selected.

The exact transactional implementation remains an implementation decision and must preserve ADR-02 concurrency invariants.

## 6. Inventory truth belongs to warehouses, not channels

AWJ must not create independent physical stock truths such as:

```text
Web Store stock = 10
Mobile stock    = 8
Salla stock     = 6
```

for the same physical units.

The authoritative conceptual flow is:

```text
Warehouse Inventory
       ↓
Inventory Reservations
       ↓
Available-to-Sell
       ↓
Channel-specific projection/policy
```

Channel inventory views are derived from inventory truth. They do not become independent accounting/inventory ledgers.

## 7. Channel-specific caps and safety buffers are policies, not stock balances

A future business may choose to expose less than total warehouse Available-to-Sell to a particular channel.

For example:

```text
Warehouse ATS = 100
External channel sellable cap = 30
```

or:

```text
Channel Sellable = Warehouse ATS - Safety Buffer
```

Such rules, if introduced, are channel availability/projection policies. They do not create new physical stock.

ADR-03 does not approve caps, buffers, allocation quotas, or their persistence model for V1.

## 8. No automatic multi-warehouse split fulfillment in V1

ADR-03 explicitly defers automatic split allocation of one fulfillment requirement across multiple warehouses.

Example:

```text
Required = 10
Dammam available = 6
Riyadh available = 4
```

V1 must not automatically interpret this as a successful `6 + 4` allocation unless a later approved multi-source fulfillment capability exists.

Automatic splitting introduces additional complexity in shipments, tracking, cancellation, partial fulfillment, returns, COD/payment reconciliation, and invoice timing.

The architecture must not permanently forbid multi-source fulfillment, but it is outside the V1 decision.

## 9. Pickup Location != Warehouse

A customer-facing pickup location and an inventory warehouse are distinct concepts.

A pickup point or branch may be served by a central warehouse and may not own an independent inventory balance.

Conceptually, a future configuration may be:

```text
Pickup Location
      ↓
Fulfillment configuration
      ↓
Warehouse
```

ADR-03 does not approve the Click & Collect data model. It only forbids treating Pickup Location and Warehouse as inherently identical.

## 10. POS compatibility

POS often has an operational relationship such as:

```text
POS Terminal
   ↓
Branch
   ↓
Warehouse
```

However, Commerce architecture must not hard-code POS-specific assumptions into the general Sales Channel model.

When POS is later made reservation-aware, its eligible inventory source should be resolved through an approved configuration/boundary compatible with this ADR and ADR-02.

ADR-03 does not change current POS behavior.

## 11. External channel compatibility

Future external channels such as Salla, Zid, Shopify, or WooCommerce may map to one or more AWJ warehouses, but external inventory publication remains a projection rather than a distributed lock.

External-channel latency, safety buffers, webhook synchronization, source-of-truth direction, and reconciliation are deferred to integration-specific decisions.

An external channel must not create a second authoritative AWJ inventory balance.

## 12. Branch relationship remains explicit and separate

Some Commerce orders may require a Branch for operational ownership, numbering, permissions, reporting, accounting context, or other existing AWJ behavior.

ADR-03 does not decide those rules.

It does decide that assigning a Branch does not implicitly mean that the Branch itself is the physical Warehouse, and selecting a Warehouse does not silently rewrite Branch ownership.

Any Branch ↔ Warehouse mapping must preserve existing AWJ company/branch isolation semantics and backward compatibility.

## 13. Tenant Isolation is mandatory

Every channel-to-warehouse eligibility mapping, routing decision, allocation, and reservation must be tenant-bound.

The following must never be possible:

```text
Tenant A Sales Channel
        ↓
Tenant B Warehouse
```

or an Order/Branch/Channel/Reservation combination that crosses trusted Tenant ownership.

Future implementation must explicitly validate ownership of all relevant identifiers rather than relying only on incidental query scoping.

Background jobs, inbound webhooks, payment callbacks, external sync workers, and mobile/public API requests must establish trusted Tenant context before resolving channel or warehouse mappings.

Cross-tenant mapping or allocation is a critical security/data-integrity failure and requires dedicated negative tests.

## 14. Reporting dimensions must remain available

Sales Channel and fulfillment Warehouse represent different analytical dimensions and should remain distinguishable in future Commerce reporting.

Examples include:

- sales by channel;
- orders by channel;
- fulfillment volume by warehouse;
- cancellation/stockout rate by channel and warehouse;
- external-channel reconciliation metrics.

ADR-03 does not define reporting schemas or UI, but the architecture must not collapse these dimensions into one identifier.

## 15. Backward compatibility

ADR-03 does not require existing ERP Invoice, Delivery Note, POS, inventory transfer, or warehouse flows to be rewritten immediately.

New Commerce flows may adopt Sales Channel and warehouse eligibility first. Legacy flows may migrate only through separately scoped, tested, explicitly approved changes.

No existing document should be silently assigned a synthetic Commerce Channel merely to satisfy this ADR.

## 16. Required implementation invariants

Any future implementation must preserve at least these invariants:

1. Sales Channel, Branch, and Warehouse remain distinct concepts.
2. Physical inventory truth remains owned by the inventory/warehouse domain.
3. A Sales Channel does not own an independent physical stock balance.
4. Commerce reservation may only target an eligible warehouse within the trusted Tenant.
5. A fulfillment allocation is not successful until the corresponding atomic reservation succeeds.
6. V1 does not require a generic optimization/routing engine.
7. Automatic multi-warehouse split fulfillment is not enabled by default in V1.
8. Pickup Location is not inherently the same entity as Warehouse.
9. Channel-specific sellable caps/buffers, if later introduced, are policies/projections rather than physical stock.
10. Channel and warehouse remain separate reporting dimensions.
11. Existing ERP/POS behavior is not silently changed.
12. Cross-tenant channel/warehouse mappings or allocations are forbidden.

## 17. Explicit non-decisions

ADR-03 intentionally does **not** decide:

- SalesChannel database schema;
- channel type enum values;
- warehouse mapping table/schema;
- whether PRIORITY_LOCATIONS ships in the first implementation PR;
- routing-engine algorithms;
- nearest-location logic;
- shipping cost optimization;
- SLA optimization;
- load balancing;
- automatic multi-warehouse split allocation;
- split shipment persistence;
- Branch ↔ Warehouse cardinality;
- Click & Collect persistence;
- pickup-location model;
- 3PL fulfillment model;
- channel inventory caps/safety-buffer implementation;
- external-channel source-of-truth direction;
- external synchronization/reconciliation details;
- POS reservation migration;
- public/mobile API contract;
- Commerce reporting schema/UI.

These require follow-up ADRs or implementation plans.

## 18. Consequences

### Benefits

- Keeps sales origin separate from organizational and physical inventory concepts.
- Allows AWJ Web, «متجرنا», POS, and future external channels to share one inventory truth.
- Provides a safe path from simple fixed-warehouse merchants to future multi-location businesses.
- Integrates naturally with ADR-02 atomic reservation semantics.
- Avoids premature routing-engine complexity.
- Preserves future Click & Collect and 3PL options without over-generalizing V1.
- Keeps channel and warehouse reporting dimensions clean.

### Costs and trade-offs

- Introduces a new Sales Channel/configuration boundary.
- Requires tenant-safe mapping and validation.
- Fixed-location V1 is intentionally less sophisticated than advanced multi-location commerce platforms.
- Automatic split fulfillment is deferred even when aggregate stock across warehouses could satisfy an order.
- Future priority routing and external channels require additional reconciliation and failure handling.

## 19. Follow-up sequence

After ADR-03, the architecture sequence is:

1. **Payment Intent / Authorization / Capture / Refund**, including checkout-hold timing interaction with ADR-02
2. **Customer / Mobile Identity Boundary**
3. External-channel inventory projection/reconciliation as required
4. Detailed implementation plans for Commerce Order, Reservation, Sales Channel, and fulfillment configuration
5. Accounting review for Return Valuation where required

No production implementation, migration, API change, POS behavior change, merge, or deployment is authorized by this ADR.

## References

- `ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md`
- `ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md`
- `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md`
- `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`
- `AWJ_COMMERCE_PLATFORM_RESEARCH.md`
- `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md`
- `AWJ_STORE_MASTER_PLAN.md`
