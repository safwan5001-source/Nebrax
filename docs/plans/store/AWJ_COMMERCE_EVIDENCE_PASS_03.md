# AWJ Commerce — Evidence Pass 03

**Status:** Final pre-Master-Plan verification
**Date:** 2026-09-09
**Scope:** Documentation/research only. No production code, schema, API, accounting, inventory, authentication, merge or deployment change.

## Evidence labels

- **AWJ VERIFIED** — observed in the current AWJ repository.
- **EXTERNAL VERIFIED** — supported by an authoritative external source.
- **ADR APPROVED** — already decided by merged Commerce ADRs.
- **INFERENCE** — architectural conclusion derived from evidence, not an existing implementation fact.
- **OPEN / REQUIRES VERIFICATION** — intentionally unresolved; must not be implemented as an assumption.

---

## 1. Saudi VAT / ZATCA invoice-timing gate

### 1.1 Authoritative evidence

**EXTERNAL VERIFIED — ZATCA:**

- Standard Tax Invoice is usually the B2B invoice type; Simplified Tax Invoice is usually B2C.
- In the standard case, the actual date of supply for goods/services is delivery/performance, subject to specific VAT rules.
- The VAT date of supply can move earlier where a Tax Invoice is issued before actual supply.
- An advance payment before actual supply can cause the supply to be deemed to occur on the payment date for the amount paid; a part-payment applies to the paid portion.
- Therefore payment, invoice issuance, and actual delivery/performance are not interchangeable events under Saudi VAT.
- Phase 2 e-invoicing requires integrated electronic invoicing behavior according to ZATCA invoice type and technical rules.

Authoritative source set reviewed:

- ZATCA VAT Implementing Regulations page.
- ZATCA E-Invoicing Definition.
- ZATCA E-Invoicing Knowledge Base / Detailed Guidelines.
- ZATCA VAT Professional Services Guideline, specifically date-of-supply / advance-payment examples.

### 1.2 Commerce trigger matrix

This matrix is an architecture gate, not tax advice and not an implementation default.

| Scenario | Commerce event | What is established | AWJ implementation conclusion |
|---|---|---|---|
| B2C immediate sale, paid and supplied together | payment + supply close together | Simplified Tax Invoice is normally the B2C document type | Existing ZATCA invoice engine remains authority; Commerce must not invent a second invoice implementation |
| B2B immediate sale, paid/supplied together | payment + supply close together | Tax Invoice is normally the B2B document type | Existing invoice/ZATCA classification remains authority |
| Prepayment before supply | payment precedes delivery | Advance payment can advance VAT date for the amount paid | `ON_FULFILLMENT` cannot be a universal invoice/tax default |
| Partial prepayment | partial payment precedes delivery | VAT date can arise for the paid portion | Commerce needs an explicit tax/invoicing decision before implementing partial-prepayment automation |
| COD | order confirmation precedes payment; payment commonly near delivery | Order creation itself is not proof of payment or delivery | `ON_ORDER_CONFIRMATION` cannot be a universal invoice/tax default |
| Payment authorization only | provider authorizes but funds not necessarily captured | Authorization is not equivalent to AWJ financial settlement | Do not treat authorization as paid or as universal VAT trigger |
| Partial fulfillment | only part of order supplied | Actual supply can occur in parts; invoice/payment timing can interact | Quantity/timing policy requires explicit Saudi matrix, not a generic Commerce assumption |
| Invoice issued before actual supply | invoice precedes supply | ZATCA VAT guidance says date can move earlier to invoice issue | Invoice creation itself has tax consequences; it cannot be used as a harmless operational event |

### 1.3 Decision

**ADR APPROVED + EXTERNAL VERIFIED:** ADR-01 was correct to leave the universal `InvoiceTriggerPolicy` default unresolved.

**INFERENCE / REQUIRED MASTER-PLAN GATE:**

Do not implement one global default such as:

- `ON_ORDER_CONFIRMATION`,
- `ON_PAYMENT_CONFIRMED`, or
- `ON_FULFILLMENT`

for all Saudi Commerce transactions.

The implementation plan must include a focused Saudi invoice-trigger/tax decision gate before automatic Commerce-to-Invoice generation is enabled. The gate must explicitly cover B2C/B2B, advance/partial payment, COD, delivery/fulfillment, partial fulfillment, and invoice-before-supply cases.

**OPEN:** Exact legal behavior for every mixed scenario is not fully specified by the evidence reviewed here. Where needed, accounting/tax-owner review is required before production automation.

---

## 2. AWJ pricing / discount / VAT authority call graph

### 2.1 Existing pricing boundaries

**AWJ VERIFIED:** `PriceListService` is a pre-document price suggestion/resolution service. Its own contract states that it does not recalculate an invoice or modify an invoice line; the saved invoice line remains the historical amount truth.

**AWJ VERIFIED:** `PosCustomerPriceListResolver` similarly proposes/validates price before a new invoice is created and does not reinterpret a historical invoice snapshot.

**AWJ VERIFIED:** `InvoiceService::applyItemsAndTotals()` is the actual sales-invoice line/totals calculation boundary. Repository evidence states that it builds invoice lines and totals from lines and handles tax-inclusive/exclusive calculation.

**AWJ VERIFIED:** Header discount logic is part of the invoice calculation boundary. The existing PR-PRICE-1 work specifically hardened minimum-sale-price enforcement against header discounts.

**AWJ VERIFIED:** AWJ currently has no single Central Price Resolver. Existing logic is distributed across `PriceListService`, `PosCustomerPriceListResolver`, and invoice calculation, with related logic elsewhere.

### 2.2 Required Commerce layering

**INFERENCE:** Commerce must not replace `InvoiceService::applyItemsAndTotals()` as financial/tax authority.

A future Commerce price resolver should be a commercial quotation/snapshot boundary that composes existing pricing sources and policy, then hands approved immutable commercial values into the existing invoice path when an invoice is legally/operationally due.

Conceptually:

```text
Product / UOM / PriceList / Customer context
                  |
                  v
       Commerce Price Resolution
        + promotion decisions
        + shipping quote
                  |
                  v
       Commerce Order snapshot
     (commercial, non-accounting)
                  |
        invoice trigger gate
                  |
                  v
     Existing InvoiceService
      tax/totals/posting/ZATCA
```

This diagram is architectural intent, not proof that a `CommercePriceResolver` class already exists.

### 2.3 Promotions

**AWJ VERIFIED:** Existing Commerce audit found no current promotions/coupons engine.

**DECISION CARRY-FORWARD:** Price lists and promotions remain separate concepts. V1 must not create a generic rules engine merely to support Commerce.

Any promotion implementation must preserve existing `min_sale_price` protection and authorized override behavior.

---

## 3. Shipping fee / VAT / accounting boundary

### 3.1 Existing AWJ behavior

**AWJ VERIFIED:** `Invoice` already has a `shipping` monetary field.

**AWJ VERIFIED:** `InvoiceService` currently defines a 15% VAT rate specifically documented as the VAT rate for shipping.

**AWJ VERIFIED:** Accounting routing already contains semantic role `sales_shipping_revenue` (legacy account 4130) under ACC-3.

**AWJ VERIFIED:** Public invoice resources expose shipping as part of invoice monetary data.

Therefore shipping is not a wholly new financial concept in AWJ.

### 3.2 Commerce boundary

**ADR APPROVED:** Fulfillment/Shipment remains operational and separate from Invoice/accounting.

**INFERENCE:** A Commerce shipping quote/selection may contribute a commercial shipping amount to the CommerceOrder snapshot. When an Invoice is legitimately created, the amount must enter the existing Invoice financial path rather than causing Fulfillment/Shipment to post accounting directly.

```text
Shipping method/rate selection
          |
          v
Commerce Order shipping snapshot
          |
          | invoice trigger
          v
Existing Invoice.shipping
          |
          v
Existing InvoiceService tax + ledger routing
```

**NON-NEGOTIABLE:** Shipment/Fulfillment must not become a second accounting authority.

### 3.3 Tax-policy caution

**OPEN / REQUIRES VERIFICATION:** The repository currently contains a hard-coded 15% shipping VAT assumption in `InvoiceService`. This evidence pass confirms that the behavior exists; it does **not** conclude that 15% is legally correct for every future Commerce shipping scenario, especially where the underlying supply may have a different VAT treatment or a third-party shipping arrangement.

The Master Plan must not silently generalize this legacy assumption. A shipping-tax compatibility check belongs before Commerce shipping expands beyond existing invoice semantics.

---

## 4. Product Variant deferment contract

### 4.1 Current AWJ facts

**AWJ VERIFIED:** Current `Product` is the inventory/product SKU authority; the Commerce audit found no first-class Product Variant/Option aggregate.

**AWJ VERIFIED:** AWJ already has multiple-UOM and alternate-barcode infrastructure, including `ProductBarcode` and tenant-wide barcode uniqueness/registry semantics.

**AWJ VERIFIED:** Existing price-list entries and POS/product workflows depend on current Product/UOM/barcode contracts.

Therefore a variant model is not merely storefront presentation metadata.

### 4.2 V1 deferment decision

**INFERENCE / MASTER-PLAN DECISION:** Product Variants are not a prerequisite for the first Commerce Core vertical slice.

Commerce V1 may sell existing AWJ Product/SKU records directly.

The V1 Commerce contracts must avoid assuming that `product_id` will forever be the only sellable identity. Public/mobile API representations and internal Commerce snapshots should be designed so a future sellable-variant identity can be introduced without rewriting historical CommerceOrder snapshots.

This does **not** authorize a new schema now.

### 4.3 Variant compatibility gate

Before first-class variants are implemented, a dedicated compatibility audit must cover at minimum:

- Product lifecycle/deletion protection,
- Inventory balances and movements,
- Warehouse quantities and reservation identity,
- UOM normalization,
- primary/alternate barcode registry,
- PriceListItem semantics,
- POS catalog/scanning/held carts,
- sales invoices and invoice snapshots,
- purchases/receiving/returns,
- Delivery Notes,
- ReturnDocument / CreditNote / exchange paths,
- import/export/workbook behavior,
- public product API,
- reporting and search,
- tenant-wide uniqueness and ownership constraints.

**OPEN:** Exact variant schema and migration strategy are intentionally undecided.

---

## 5. Final pre-Master-Plan conclusions

No evidence in Pass 03 requires reopening ADR-01 through ADR-05.

The following are sufficiently stable to enter the Commerce Implementation Master Plan:

1. CommerceOrder remains non-accounting and separate from Invoice.
2. Inventory Reservation / ATS remains the highest-priority missing Commerce foundation.
3. Reservation must be atomic, idempotent, tenant/warehouse scoped and concurrency tested on PostgreSQL.
4. SalesChannel, Warehouse, Branch and Pickup Location remain separate concepts.
5. PaymentIntent, provider attempt/transaction, existing AWJ Payment, Refund and CreditNote remain separate boundaries.
6. Browser/client payment success is never financial authority.
7. Commerce customer identity remains separate from ERP staff User and from Partner.
8. Existing AWJ InvoiceService + Ledger + ZATCA paths remain financial/tax authority.
9. Commerce pricing may resolve/quote commercial values but must not replace historical invoice/tax calculation authority.
10. Shipping is already represented financially on Invoice; Shipment/Fulfillment remains operational and must not post accounting itself.
11. Product Variants are deferred from the first Commerce Core vertical slice and require a dedicated compatibility gate.
12. No universal Saudi invoice-trigger default is approved yet.

---

## 6. Mandatory gates for the Master Plan

The Master Plan must include these gates explicitly:

### Gate C1 — Reservation foundation

No checkout/order confirmation path that promises stock may bypass the first-class reservation/ATS contract.

### Gate C2 — Saudi invoice-trigger decision

Automatic Commerce-to-Invoice generation cannot ship until the relevant Saudi scenario matrix is approved for the targeted vertical slice.

### Gate C3 — Existing financial authority reuse

No Commerce service may directly write journal lines, stock valuation, COGS or ZATCA invoice artifacts outside approved existing services.

### Gate C4 — Payment trust boundary

No client redirect/success screen may mark an order paid. Provider/server verification and idempotent inbound processing are required.

### Gate C5 — Tenant isolation

Trusted TenantContext must be established before tenant data lookup in inbound/background flows; external references must never be sufficient by themselves to select or cross tenant ownership boundaries.

### Gate C6 — Variants

No first-class variant implementation is part of the initial Commerce vertical slice. Any later variant milestone begins with the compatibility audit above.

### Gate C7 — Backward compatibility

Legacy ERP invoice/POS flows are not forced through CommerceOrder initially. Commerce is introduced as an additional channel-aware flow around reusable existing cores.

---

## 7. Remaining open questions — allowed into planning, not assumptions

These do not block writing the Master Plan, but they must remain explicit decision points:

1. Exact Saudi invoice trigger for each selected launch scenario.
2. Exact treatment of partial prepayments/partial fulfillment in the first supported Commerce vertical slice.
3. Whether the existing fixed 15% shipping VAT behavior is sufficient for the launch scope or requires a generalized tax treatment first.
4. Exact Commerce promotion types allowed in V1.
5. Exact customer-to-Partner creation/resolution milestone.
6. Exact payment provider(s) and provider-specific capabilities.
7. Exact external channel chosen after متجرنا/web pilot.
8. Exact future Product Variant schema.

---

## 8. Research stop condition

The architecture now has enough verified evidence to proceed to the **AWJ Commerce Implementation Master Plan** without opening another broad Evidence Pass.

Further research should be triggered only by a concrete implementation decision or unresolved gate, not by general exploration.

**Next artifact:** `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`.
