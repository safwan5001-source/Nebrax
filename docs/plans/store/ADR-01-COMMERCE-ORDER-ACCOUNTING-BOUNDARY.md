# ADR-01 — Commerce Order & Accounting Boundary

**Status:** Accepted — Architecture Direction  
**Date:** 2026-09-09  
**Scope:** AWJ Commerce Core architecture only — no implementation approval

## Context

AWJ Commerce must support native web commerce, the future mobile commerce client (including «متجرنا» as a pilot), POS, and future external channels without duplicating or weakening the existing ERP accounting and inventory domains.

The Existing Architecture Audit confirmed that AWJ already has mature Invoice, Ledger, Inventory, Payment, ReturnDocument, CreditNote, POS, RBAC, tenant isolation, outbound webhook, and idempotency foundations. It also confirmed that AWJ currently has no first-class Commerce Order, Sales Channel, inventory reservation/Available-to-Sell, Payment Intent/Authorization/Capture, consumer identity, or inbound webhook receiver.

This ADR defines the boundary between the future Commerce operational domain and the existing accounting domain. It intentionally does not define database schema or implementation details.

## Decision

The conceptual Commerce responsibility flow is:

```text
Cart
  ↓
Commerce Order
  ↓
Inventory Reservation
  ↓
Payment
  ↓
Fulfillment
  ↓
Sales Invoice
```

This is a responsibility boundary, not a mandatory synchronous sequence for every business. Valid timing differences must be expressed through finite typed policies, not separate implementations or an unrestricted rules engine.

## 1. Commerce Order is a first-class operational entity

`CommerceOrder` is conceptually independent from Quote, Sales Invoice, Delivery Note, Payment, ReturnDocument, and CreditNote.

It represents the commercial transaction agreed through a sales channel and must eventually preserve enough historical transaction context to explain what was agreed. Candidate context includes tenant, sales channel, customer, lines/products, quantities, prices, discounts, taxes, shipping, currency, fulfillment source, and policy/version context where historical interpretation requires it.

This list is architectural context only and is **not an approved database schema**.

## 2. Order != Invoice

**Invariant:** Creating or confirming a Commerce Order does not by itself recognize revenue, post a journal entry, or create/post a Sales Invoice.

The existing AWJ Invoice Core remains authoritative for Sales Invoices. Commerce must not duplicate invoice posting, ledger posting, VAT/tax calculation authority, COGS accounting, ZATCA document behavior, document numbering, or existing invoice immutability rules.

Commerce may determine when an Invoice is required, but creation/posting must pass through the approved Invoice domain and services.

## 3. Reservation != Stock Movement

Commerce requires a future first-class Inventory Reservation capability. The architecture must distinguish conceptually between:

```text
On Hand
Reserved
Available To Sell
Committed
Issued
Released
```

At minimum, the intended conceptual relationship is:

```text
Available To Sell = On Hand - active reservations
```

A reservation is not itself an outbound stock movement.

Exact reservation semantics, concurrency behavior, expiry/release behavior, warehouse allocation, oversell policy, and the precise meanings of Committed and Issued are deferred to **ADR-02 — Inventory Reservation & Available-to-Sell**.

## 4. Independent lifecycles

Commerce must not collapse operational state into one compound status. At minimum, Order, Payment, and Fulfillment are independent lifecycle dimensions.

For example, the architecture must be able to represent conceptually:

```text
Order:       CONFIRMED
Payment:     PAID
Fulfillment: PARTIALLY_FULFILLED
```

without inventing a state such as `paid_and_partially_shipped`.

ADR-01 does not approve enum names or persistence schema.

## 5. Invoice trigger is a typed policy

AWJ retains the Best-of-Breed principle: **Capability != Policy**.

Candidate typed policy values remain:

```text
InvoiceTriggerPolicy

ON_PAYMENT_CONFIRMED
ON_FULFILLMENT
ON_DELIVERY
```

These are architecture candidates, not authorization to implement every option. ADR-01 deliberately does **not** approve a default. The final supported set and default require accounting, VAT, and ZATCA validation.

No generic rules engine is authorized. Policy changes must not silently reinterpret historical Commerce Orders; policy/version context must be preserved where necessary for historical interpretation.

## 6. Accounting and inventory responsibility boundary

| Event | Inventory effect | Accounting effect |
|---|---|---|
| Cart | None | None |
| Commerce Order created | None | None |
| Commerce Order confirmed | Reservation according to approved policy | None by itself |
| Payment authorization | None | None by itself |
| Payment capture/receipt | Payment-domain effect according to approved rules | Accounting/payment effect where applicable |
| Fulfillment | Physical inventory effect according to approved inventory policy | Must not independently invent revenue accounting |
| Invoice posting | Existing Invoice Core behavior | Authoritative invoice accounting impact |
| Return | Depends on disposition/restock | Separate from Refund |
| Refund | Does not inherently restock inventory | Payment-domain correction |
| Credit Note | No inventory effect by itself under current AWJ architecture | Financial correction |
| Exchange | Return + replacement flow | Financial delta through underlying approved documents |

This ADR creates no new accounting behavior.

## 7. Return != Refund != Credit Note != Exchange

These are separate concepts and must remain separate in Commerce.

The Architecture Audit confirmed that AWJ already has a distinct `CreditNote` separate from `ReturnDocument`. Commerce should reuse or extend these existing boundaries rather than replace or collapse them.

A refund must not imply restocking. A return must not imply that a refund has occurred. A Credit Note must not be treated as an inventory return. An Exchange is an orchestration of return/replacement and any financial delta, not a synonym for any one of them.

## 8. Return valuation is explicitly not decided

The Architecture Audit identified existing AWJ behavior related to inventory valuation on returns. ADR-01 does not adopt that behavior as the future Commerce valuation policy.

> **Existing AWJ behavior — accounting review required.**

Any future decision affecting original outbound cost, current moving-average cost, COGS reversal, inventory valuation, or historical profitability requires dedicated accounting review/ADR and strong regression tests.

No valuation change is authorized by this ADR.

## 9. Tenant Isolation is a mandatory implementation gate

The Architecture Audit found that tenant-owned FK resolution relies heavily on an active `TenantContext`/`TenantScope`. Future Commerce paths—especially inbound webhooks, background jobs, external-channel synchronization, payment callbacks, and mobile/public mutations—must establish a trusted tenant context before resolving tenant-owned identifiers.

Commerce must not assume that a normal authenticated ERP request has already established tenant scope.

Cross-tenant ownership of identifiers such as product, customer/partner, warehouse, order, payment, and external mappings is a security boundary and must be explicitly protected in later implementation design and tests.

ADR-01 does not redesign AWJ Tenant Isolation; it records this as a mandatory security gate.

## 10. Backward compatibility

Commerce extends AWJ; it does not replace the existing sales/accounting architecture.

Existing Invoice Core, Ledger, Inventory services, Payments, ReturnDocument, CreditNote, POS, Quote flow, and ZATCA behavior remain authoritative within their current responsibilities.

Existing ERP and POS flows must continue to work without requiring a Commerce Order. Commerce Order must not become a mandatory wrapper around legacy AWJ sales flows unless a later migration decision explicitly approves that change.

## 11. Explicit non-decisions

ADR-01 intentionally does **not** decide:

- CommerceOrder database schema.
- Exact enum/status names.
- Default `InvoiceTriggerPolicy`.
- ZATCA invoice timing.
- VAT tax-point decisions.
- Reservation timing.
- Reservation expiry/release semantics.
- Oversell policy.
- Exact Available-to-Sell algorithm beyond the conceptual relationship above.
- Warehouse/channel allocation.
- Partial fulfillment implementation.
- Payment provider selection.
- Payment authorization/capture implementation.
- Consumer/mobile authentication.
- B2B hierarchy.
- Promotion engine.
- Return valuation method.
- Exchange financial implementation.
- Inbound webhook architecture.

These require later ADRs, accounting/security review, or implementation plans.

## 12. Consequences

### Benefits

- Prevents premature accounting impact from Commerce operations.
- Avoids duplicate invoice, tax, ledger, COGS, and ZATCA logic.
- Supports web, mobile, POS, and external channels behind a common Commerce boundary.
- Allows Payment and Fulfillment to evolve independently.
- Supports future partial fulfillment, COD, authorization/capture, and external-channel scenarios without redefining Invoice.
- Preserves the authority and immutability expectations of the existing Invoice domain.
- Protects backward compatibility for existing ERP/POS flows.

### Costs and trade-offs

- Requires a new CommerceOrder aggregate.
- Requires an Inventory Reservation subsystem before Commerce can safely rely on Available-to-Sell.
- Introduces coordination across independent Order, Payment, Fulfillment, and Invoice lifecycles.
- Makes idempotency mandatory for Commerce mutations and callbacks.
- Increases reconciliation requirements across channels and asynchronous flows.
- Adds security-sensitive tenant boundaries for workers, callbacks, and inbound integrations.
- May require preservation of policy/version context for historical orders.

## 13. Follow-up ADR sequence

The approved architecture sequence after ADR-01 is:

1. **ADR-02 — Inventory Reservation & Available-to-Sell**
2. **Channel ↔ Warehouse / Fulfillment Source**
3. **Payment Intent / Authorization / Capture / Refund**
4. **Customer / Mobile Identity Boundary**
5. **Accounting review for Return Valuation**, where required

No production implementation, migration, API change, merge, or deployment is authorized by this ADR.

## References

- `AWJ_STORE_MASTER_PLAN.md`
- `AWJ_COMMERCE_PLATFORM_RESEARCH.md`
- `AWJ_COMMERCE_FEATURE_MATRIX.md`
- `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`
- `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md`
- `AWJ_COMMERCE_CAPABILITY_RESEARCH_03_RETURNS.md`
- `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md`
