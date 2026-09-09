# AWJ Commerce — Evidence Pass 02

**Status:** Research / Architecture Evidence — no production implementation authorization  
**Date:** 2026-09-09  
**Parent evidence:** `AWJ_COMMERCE_EVIDENCE_PASS_01.md`  
**Canonical decisions:** ADR-01 .. ADR-05  

> Goal: close high-impact evidence gaps before writing `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`. This document distinguishes verified AWJ facts, official external evidence, approved ADR decisions, derived implications, and unresolved questions. It does not authorize schema/API/production changes.

## Evidence labels

- **AWJ VERIFIED** — confirmed from current repository/default branch.
- **EXTERNAL VERIFIED** — supported by current official documentation.
- **ADR APPROVED** — already fixed by merged Commerce ADRs.
- **DERIVED** — architecture implication from verified evidence; not implementation detail.
- **OPEN / REQUIRES VERIFICATION** — must not be guessed in implementation planning.

---

## 1. Saudi VAT / ZATCA invoice timing

### 1.1 EXTERNAL VERIFIED — invoice type

Current ZATCA guidance continues to distinguish:
- Tax Invoice: normally B2B.
- Simplified Tax Invoice: normally B2C.

For Phase 2, Simplified Tax Invoices are reported to FATOORA within 24 hours of generation, while the generated invoice must be presented/shared with the buyer as required by the e-invoicing rules.

Official references:
- ZATCA — What is E-Invoicing: https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/What-is-e-invoicing.aspx
- ZATCA — E-Invoicing Detailed Guideline: https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf
- ZATCA — VAT Implementing Regulations: https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VATImplementingRegulations.aspx

### 1.2 EXTERNAL VERIFIED — VAT date-of-supply interaction

ZATCA guidance states that the ordinary actual date of supply is generally delivery/performance, but an earlier tax point can arise when a Tax Invoice is issued or advance payment is received before actual supply. For advance part-payment, the supply is deemed to occur for the paid portion.

Official reference:
- ZATCA Professional Services VAT Guideline: https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/VAT_Professional_Services_Guideline_English.pdf

### 1.3 DERIVED — no universal Commerce invoice trigger

This supports ADR-01's decision not to hard-code one universal `InvoiceTriggerPolicy` such as `ON_PAYMENT_CONFIRMED` or `ON_FULFILLMENT` for every Saudi commerce scenario.

A Commerce implementation must distinguish at minimum:
- B2C vs B2B invoice form/clearance-reporting path.
- prepayment / partial prepayment.
- COD / pay-on-pickup.
- actual supply/fulfillment timing.
- partial fulfillment.

This is a tax/compliance boundary, not a convenience setting.

### 1.4 OPEN / REQUIRES VERIFICATION

Before choosing defaults, produce a dedicated Saudi invoice-trigger matrix covering at least:
- B2C prepaid online order.
- B2C COD.
- B2C pay on pickup.
- B2B prepaid order.
- B2B credit/terms order.
- partial prepayment.
- partial fulfillment / backorder.
- cancellation before supply.
- refund after payment but before supply.
- return after supply.

Do not infer these defaults solely from Shopify/Odoo/Salla behavior. ZATCA/VAT authority wins.

---

## 2. External channel inbound events and reconciliation

### 2.1 EXTERNAL VERIFIED — Shopify

Current Shopify documentation explicitly states:
- webhook ordering is not guaranteed, even within a topic;
- duplicate deliveries can occur;
- HTTPS webhook deliveries carry an HMAC signature;
- `X-Shopify-Webhook-Id` is intended for duplicate detection;
- reconciliation jobs are recommended because webhook delivery is not a complete replacement for reconciliation;
- order webhook handlers should acknowledge quickly and process long work out of band.

Official references:
- https://shopify.dev/docs/apps/build/webhooks
- https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- https://shopify.dev/docs/agents/orders/order-webhooks

### 2.2 EXTERNAL VERIFIED — Salla

Current Salla documentation recommends the same core receiver pattern:

`Verify → Acknowledge → Queue → Process → Process idempotently`

Salla supports signature-based webhook verification and recommends timing-safe comparison. Its current development playbook explicitly warns that retries/duplicate deliveries happen and that processed event IDs should be tracked.

Official references:
- https://docs.salla.dev/421119m0
- https://docs.salla.dev/2316085m0

### 2.3 EXTERNAL VERIFIED — Zid

Current Zid Merchant API supports webhook subscriptions for commerce events including order creation/status changes and allows authentication data to be configured for webhook delivery. Current Zid webhook documentation includes conditions for order status and payment method including COD.

Official references:
- https://docs.zid.sa/webhooks
- https://docs.zid.sa/create-a-webhook

### 2.4 AWJ VERIFIED

The existing architecture audit already proved that AWJ has a mature **outbound** webhook stack with durable outbox/delivery/retry/HMAC/SSRF protection, but no inbound external-provider webhook receiver was found.

AWJ also already has durable idempotency precedents in Public API and POS checkout. These are reuse patterns, not proof that an inbound receiver already exists.

### 2.5 DERIVED — inbound adapter contract

A future external-channel/payment inbound boundary should require, independent of provider-specific payload shape:

1. authenticate/verify provider delivery before trusting business data;
2. resolve the external connection/store through trusted configuration;
3. establish trusted AWJ `TenantContext` before tenant-scoped queries;
4. persist a provider delivery/event identity or equivalent durable dedupe key;
5. acknowledge quickly where provider contract permits;
6. queue business processing;
7. make processing idempotent;
8. tolerate out-of-order events;
9. support reconciliation against provider canonical state;
10. never let an inbound payload choose an arbitrary AWJ tenant, warehouse, Partner, or financial document by untrusted local IDs.

This is an architecture contract only. It does **not** choose table names, queue classes, or endpoint paths.

### 2.6 OPEN / REQUIRES VERIFICATION

Per provider, later implementation work must verify:
- exact signature algorithm and raw-body requirements;
- retry schedule and timeout contract;
- stable event/delivery identifier semantics;
- event ordering guarantees (usually none);
- API versioning policy;
- reconciliation/read-back APIs;
- credential rotation/revocation behavior.

Provider-specific security must not be generalized from another provider.

---

## 3. Pricing authority in current AWJ

### 3.1 AWJ VERIFIED — PriceList is advisory before document snapshot

`app/Services/PriceListService.php` explicitly documents that a price list proposes a price before save and does not recalculate an invoice or mutate its line. The invoice line remains the historical amount source of truth.

`app/Http/Controllers/Api/PriceListController.php` likewise states that selecting a list only proposes an invoice-item price and does not become a global discount or rewrite existing invoices.

`app/Services/Accounting/PosCustomerPriceListResolver.php` explicitly limits itself to proposing/validating product price before creation of a new invoice; it does not rewrite historical invoice snapshots.

### 3.2 AWJ VERIFIED — pricing logic is currently distributed

The existing architecture audit identified current pricing responsibility across:
- `InvoiceService::applyItemsAndTotals`
- `PriceListService`
- `PosCustomerPriceListResolver`

It classified a central resolver as **NEW service / REUSE existing internal logic**, not a replacement for invoice tax/rounding/accounting behavior.

### 3.3 DERIVED — Central Price Resolver boundary

A Commerce price resolver should initially be an orchestration/read decision boundary that produces a proposed commercial snapshot before Commerce Order confirmation. It must not silently become a second tax calculator or mutate posted/durable financial snapshots.

Promotion evaluation, if/when added, is a separate capability from PriceList resolution. The existing `min_sale_price` protection must remain enforceable rather than being bypassed by Commerce discounts.

### 3.4 OPEN / REQUIRES VERIFICATION

Before specifying the resolver API/schema, trace exact current call paths for:
- standard invoice creation;
- POS checkout;
- DeliveryNote → invoice draft;
- Quote → invoice draft;
- customer default price list;
- UOM-specific price list items;
- header and line discount floors;
- tax-inclusive/exclusive and rounding behavior if applicable.

No Commerce resolver implementation PR should precede that call-graph verification.

---

## 4. Product variants compatibility risk

### 4.1 AWJ VERIFIED — no ProductVariant aggregate found

The existing architecture audit found no product variants/options/attributes model or migration. Current `Product` is the SKU/product authority.

### 4.2 AWJ VERIFIED — AWJ already has multiple UOM/barcode semantics

Current repository contains `ProductBarcode`, and `Product::alternateBarcodes()` relates multiple alternate barcodes to one Product. `BarcodeRegistryEntry` provides tenant-wide barcode uniqueness across primary and alternate barcode space. Product barcodes may carry `unit_name` and `default_quantity` semantics.

This means a future variant design cannot assume that "one alternate barcode = one variant". AWJ already uses alternate barcodes for UOM/scanning semantics independently of product variants.

Repository evidence includes:
- `app/Models/ProductBarcode.php`
- `app/Models/Product.php`
- `app/Models/BarcodeRegistryEntry.php`
- existing UOM/barcode hardening documents and implementation reports.

### 4.3 DERIVED — variants require their own compatibility audit

A variant implementation could affect at least:
- SKU/barcode uniqueness and scanner resolution;
- Product + UOM conversion semantics;
- PriceListItem lookup;
- POS catalog/cart;
- invoice and purchase line snapshots;
- stock movement and warehouse availability;
- returns/exchanges;
- imports/exports;
- external channel product mapping;
- reporting.

Therefore Product Variants must not be inserted casually into Commerce V1 schema based on Shopify/Odoo data models.

### 4.4 Decision for Master Plan staging

Until the compatibility audit is complete:
- **Commerce V1 must be capable of operating with current flat Product/SKU authority.**
- Variant support should be represented as a separately gated capability/workstream, not a hidden prerequisite for Reservation, Channel, Order, Payment, Fulfillment, or Mobile API foundations.

This is a staging decision, not a rejection of variants.

---

## 5. Shipping / fulfillment boundary

### 5.1 ADR APPROVED

ADR-03 already fixes:

`Sales Channel → Fulfillment Policy → Eligible Warehouses → Selected Warehouse → Atomic Reservation`

V1 uses Warehouse as the fulfillment inventory source, starts with `FIXED_LOCATION`, and does not require automatic split fulfillment.

### 5.2 EXTERNAL VERIFIED — fulfillment is not identical to order

Current Shopify order/fulfillment documentation continues to model fulfillment progress independently from order/payment state and supports location-aware fulfillment. External systems can send multiple fulfillment-related updates and webhook events.

Official references:
- https://shopify.dev/docs/agents/orders/order-webhooks
- https://shopify.dev/docs/apps/build/webhooks

### 5.3 DERIVED

AWJ should preserve independent state dimensions:
- Order state
- Payment state
- Fulfillment state
- Invoice state

Shipping carrier/provider state should not directly become accounting state.

### 5.4 OPEN / REQUIRES VERIFICATION

Still unresolved before implementation plan details:
- shipping fee tax treatment in AWJ's current tax engine;
- whether a dedicated Shipment aggregate is required in V1 or Fulfillment can initially own carrier/tracking data;
- pickup location representation vs Warehouse;
- partial shipment/backorder UX/API contract;
- COD settlement reconciliation boundary;
- carrier webhook security/idempotency requirements.

---

## 6. Payment callback boundary

### 6.1 ADR APPROVED

ADR-04 already requires trusted server verification/webhook rather than browser success, provider adapters, idempotency, multiple attempts, authorization/capture distinction, and reuse of existing AWJ Payment as financial settlement authority.

### 6.2 EXTERNAL VERIFIED

The current external-channel webhook evidence reinforces the receiver requirements: verified raw delivery, durable deduplication, fast acknowledgement, asynchronous processing, out-of-order tolerance, and reconciliation.

### 6.3 DERIVED — payment provider event cannot directly post arbitrary AWJ Payment

A provider callback must first resolve its trusted Commerce payment context and validate at least provider identity/reference, amount, currency, and allowed state transition before invoking existing AWJ financial settlement authority.

The provider payload itself is not an authorization to choose tenant/accounting document IDs.

### 6.4 OPEN / REQUIRES VERIFICATION

Exact payment-provider implementation remains provider-specific. No gateway is selected by this evidence pass.

---

## 7. Evidence Pass 02 conclusions

### Strong enough for Master Plan architecture

The following can now be treated as evidence-backed architecture constraints:

1. Saudi invoice timing cannot use one universal Commerce trigger without a scenario matrix.
2. External inbound events require verified, tenant-safe, durable-idempotent, queue-based processing plus reconciliation.
3. AWJ PriceList is advisory before snapshot; historical document lines remain authoritative.
4. A Commerce Central Price Resolver must orchestrate existing pricing authority rather than replace financial tax/rounding logic.
5. Product variants are not currently part of AWJ Product Core and conflict conceptually with existing independent UOM/alternate-barcode semantics if designed naively.
6. Commerce V1 foundations can and should remain usable with current flat Product/SKU authority while variants undergo a separate compatibility gate.
7. Order, Payment, Fulfillment and Invoice states remain independent.
8. Provider callbacks cannot be trusted as direct tenant/accounting commands.

### Still OPEN before exact implementation PR contracts

- Saudi invoice-trigger scenario matrix and chosen defaults.
- Exact current AWJ pricing call graph and discount/tax/rounding edge behavior.
- Product Variants compatibility audit.
- Shipping fee tax behavior and Shipment-vs-Fulfillment V1 shape.
- Provider-specific payment/channel webhook contracts.
- Exact schema/table/model/service/API names for new Commerce components.

---

## 8. Next evidence gate

Before finalizing `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`, perform only targeted verification for the remaining high-risk items:

1. Saudi/ZATCA invoice-trigger matrix.
2. AWJ pricing/tax/discount call graph.
3. Variant compatibility audit or explicit deferment contract.
4. Shipping fee / fulfillment tax boundary.

If these checks do not materially change ADR-01..05, the Master Plan can then define dependency-ordered implementation PRs without inventing architecture from scratch.

---

**No merge or deployment is authorized by this document.**