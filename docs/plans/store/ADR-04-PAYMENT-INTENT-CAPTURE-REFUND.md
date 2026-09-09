# ADR-04 — Payment Intent / Authorization / Capture / Refund

**Status:** Accepted — Architecture Direction  
**Date:** 2026-09-09  
**Scope:** AWJ Commerce payment orchestration boundary only — no implementation approval

## Context

ADR-01 separated Commerce Order from Sales Invoice and left invoice timing policy-driven. ADR-02 introduced warehouse-scoped inventory reservation and intentionally deferred payment-specific checkout holds. ADR-03 defined channel-to-warehouse fulfillment boundaries.

The Existing Architecture Audit found an existing AWJ Payment Core and POS split-tender behavior, but no first-class Commerce Payment Intent / authorization / capture abstraction and no inbound payment-webhook receiver.

Commerce therefore needs a payment orchestration boundary without creating a second financial ledger or coupling provider-specific behavior directly to Commerce Order or Invoice.

## Decision

AWJ Commerce introduces **Payment Intent** as the orchestration boundary between Commerce Orders and payment providers.

The following remain distinct concepts:

```text
Commerce Order
Payment Intent
Provider Payment Transaction / Attempt
AWJ Payment
Sales Invoice
Refund
Credit Note
Return
```

Payment lifecycle events such as authorization, capture, COD collection, failure, cancellation, and refund are explicit. Provider callbacks must be server-verified and processed idempotently inside a trusted Tenant context.

Successful settlement integrates with the existing AWJ Payment Core rather than creating a parallel financial ledger.

Refund is a monetary operation and remains distinct from Credit Note, Return, and Exchange.

## 1. Canonical Commerce payment boundary

Conceptually:

```text
Cart
 ↓
Commerce Order
 ↓
Reservation / Checkout Hold where required
 ↓
Payment Intent
 ↓
Provider Attempt / Authorization / Capture / COD
 ↓
Successful Settlement
 ↓
Existing AWJ Payment Core
```

Fulfillment and Invoice remain separate lifecycle dimensions governed by their own approved rules/policies.

A successful payment does not by itself redefine ADR-01 or automatically force a Sales Invoice to be created/posted unless the approved InvoiceTriggerPolicy requires that behavior.

## 2. Payment Intent is not a provider transaction

A Payment Intent represents AWJ's intention to collect an amount for a Commerce Order/payment obligation.

A provider transaction/attempt records what happened during a specific interaction with a payment provider or payment method.

Conceptually:

```text
Commerce Order
     ↓
Payment Intent
     ├─ Attempt A → failed
     ├─ Attempt B → authorized
     └─ Attempt C → captured / settled
```

Retries or changing an allowed payment method/provider must not require creating a duplicate Commerce Order merely to preserve payment history.

The exact persistence model is deferred.

## 3. Payment amount is derived from an approved commercial snapshot

A Payment Intent amount must correspond to an approved Order amount due, including the applicable commercial calculation such as:

```text
items
- discounts
+ tax
+ shipping/charges
───────────────
amount due
```

Once a payment operation has started, AWJ must not silently mutate the underlying Order total so that the commercial amount and payment obligation diverge.

If an allowed Order change affects the payable amount, the payment workflow must explicitly reconcile, cancel/replace, adjust, or otherwise transition the payment obligation according to a separately approved implementation policy.

ADR-04 does not define the exact adjustment mechanism.

## 4. Authorization and capture are distinct capabilities

AWJ Commerce must be capable of representing at least:

```text
IMMEDIATE_CAPTURE
AUTHORIZE_THEN_CAPTURE
COD
PAY_ON_PICKUP
```

where supported/approved.

Authorization means the provider has approved/held the amount according to provider semantics; it is not automatically equivalent to final settlement.

Capture represents collection/settlement initiation according to provider semantics.

Providers that only expose immediate payment can map through the adapter without forcing every provider to implement a separate authorization step.

ADR-04 does not choose a universal default capture policy.

## 5. COD is not paid at order creation

Cash on Delivery must not be represented as successfully paid merely because the Order was created or confirmed.

Conceptually:

```text
Order confirmed
Payment method = COD
Payment state  = pending / uncollected
```

Only actual collection should produce the corresponding successful AWJ payment/settlement record according to the approved collection flow.

This prevents recognition of cash that has not actually been collected.

ADR-04 does not decide COD invoice timing.

## 6. Checkout Hold is a payment-aware reservation capability

ADR-04 resolves the ADR-02 open point as follows:

AWJ Reservation Engine should support a **temporary checkout/payment hold capability**, but that hold is not mandatory for every payment method or every Commerce Order.

A payment flow involving redirect, 3DS, or another asynchronous customer step may conceptually use:

```text
Checkout
 ↓
Temporary Inventory Hold
 ↓
Payment Intent / Provider flow
 ↓
Payment confirmed
 ↓
Order Reservation according to approved policy
```

If payment fails, is cancelled, or the hold legitimately expires, the remaining hold is released/expired idempotently and sellable availability is restored under ADR-02.

COD or other flows may transition directly to an Order Reservation according to InventoryReservationPolicy without requiring the same temporary hold sequence.

The hold must use the same Reservation capability/source of truth established by ADR-02, with an explicit purpose/type, rather than creating a second inventory-hold engine.

ADR-04 does not decide hold TTL, renewal, grace periods, or provider-specific timing.

## 7. Browser return is not payment truth

A browser redirect, client-side callback, query parameter, or customer-visible success screen must not by itself be treated as authoritative proof of payment.

Payment confirmation must be established through trusted server-side mechanisms supported by the provider, such as authenticated/signed webhook processing and/or server-to-server verification.

Client return routes may improve UX and trigger status refresh, but must not bypass provider verification.

## 8. Inbound provider events are a new security boundary

The Existing Architecture Audit identified mature outbound webhooks but no equivalent generic inbound payment-webhook receiver.

A future inbound provider-event capability must:

- verify provider authenticity/signature using the provider's approved mechanism;
- identify the trusted AWJ provider/account configuration;
- establish Tenant context before resolving tenant-owned records;
- validate provider references against the intended Payment Intent/attempt;
- process events idempotently;
- reject/reconcile inconsistent amounts/currencies/states;
- avoid trusting tenant/order identifiers supplied only by untrusted client input;
- preserve an auditable event/processing trail as appropriate.

Exact endpoint and persistence design are deferred.

## 9. Idempotency is mandatory

Provider APIs and webhooks may retry. AWJ may also retry internal operations after network or process failure.

The architecture must guarantee that replaying the same logical provider event or payment mutation cannot create duplicate captures, duplicate AWJ Payments, duplicate refunds, or duplicate accounting effects.

Conceptually:

```text
Repeated provider event
        ↓
1 logical capture/settlement
        ↓
1 corresponding AWJ financial effect
```

Idempotency should use provider event/transaction identity where available plus AWJ operation identity as appropriate.

AWJ already has mature Public API and POS idempotency precedents; Commerce should reuse/generalize those principles rather than invent an unrelated retry model.

## 10. Sensitive card data stays outside AWJ

AWJ must not store raw PAN, CVV/CVC, or sensitive card-authentication data.

Commerce should use provider-hosted checkout, tokenization, provider SDK/components, or other approved mechanisms that keep sensitive card data outside AWJ's application/database boundary as far as reasonably possible.

AWJ may retain permitted operational metadata required for reconciliation/support, such as:

```text
provider identity
provider transaction/reference
payment method type
permitted masked metadata
amount
currency
status
relevant timestamps
```

Exact fields depend on provider/security/compliance requirements and are not approved by this ADR.

## 11. Payment state is separate from Order, Fulfillment, and Invoice state

AWJ Commerce must not collapse payment lifecycle into `order.status`.

The architecture preserves separate dimensions:

```text
Order State
Payment State
Fulfillment State
Invoice State
```

For example, a valid future state may be:

```text
Order:       CONFIRMED
Payment:     CAPTURED
Fulfillment: PARTIALLY_FULFILLED
Invoice:     PARTIALLY_INVOICED
```

Exact state enums are deferred.

## 12. Provider-specific behavior is isolated behind an adapter boundary

Commerce Core must not accumulate provider-specific conditionals throughout Order, Reservation, Invoice, or accounting services.

Conceptually:

```text
Commerce Payment Core
        ↓
Payment Provider Adapter
        ↓
Specific Provider API
```

The core capability may request operations such as:

```text
create payment session/intent
verify status/event
authorize
capture
cancel/void
refund
```

subject to the capabilities of the selected provider.

Provider-specific request/response formats, signatures, credentials, redirect behavior, and error mappings belong behind the adapter boundary.

ADR-04 does not select a payment provider.

## 13. Existing AWJ Payment Core remains the financial settlement authority

ADR-04 does not replace the existing AWJ Payment model/services or POS payment capabilities.

The intended boundary is conceptually:

```text
Commerce Payment Intent / Provider orchestration
                ↓
verified successful settlement/collection
                ↓
Existing AWJ Payment Core
```

Commerce must not create a second independent receivables/cash ledger.

The exact integration point, service calls, posting timing, split-tender reuse, and transaction boundaries require implementation design and accounting regression tests.

## 14. Refund != Credit Note != Return != Exchange

AWJ preserves the separation established by the Commerce research and ADR-01:

- **Refund:** monetary movement back to the customer.
- **Credit Note:** financial/tax correction document.
- **Return:** goods/operational reverse flow.
- **Exchange:** return/replacement workflow plus any financial delta.

These operations may be coordinated by a business workflow, but one must not be implemented as an alias for another.

A successful Refund must not silently create inventory movement. A Return must not imply money was refunded. A provider reversal must not automatically create a Credit Note without the approved financial/tax workflow.

## 15. Partial refunds are a required foundation

The architecture must support multiple legitimate partial refunds against a captured/settled amount.

Core invariant:

```text
Total successful refundable monetary reversals
<= amount successfully captured/settled and still refundable
```

Example:

```text
Captured: 500 SAR
Refund A: 100 SAR
Refund B:  50 SAR
Remaining net captured: 350 SAR
```

Refund creation/execution must be idempotent and concurrency-safe so two concurrent requests cannot refund beyond the permitted amount.

Exact rounding, fee, provider, FX, and multi-capture rules are deferred.

## 16. Payment failure and cancellation are explicit

A failed attempt must not corrupt the Commerce Order or erase prior attempts.

Depending on approved policy, failure/cancellation may:

- leave the Order awaiting another payment attempt;
- release/expire a temporary checkout hold;
- cancel an unpaid Order;
- require manual review.

These business outcomes are policy/workflow decisions. ADR-04 requires only that payment failure/cancellation be represented explicitly and processed idempotently.

## 17. Currency and amount validation

Provider confirmation must be reconciled against the intended Payment Intent amount and currency according to the approved provider/payment flow.

AWJ must not mark an obligation paid merely because a provider reference reports success if the amount/currency does not match the expected obligation or an explicitly approved partial-payment flow.

Foreign exchange behavior, multi-currency settlement, provider fees, and rounding details are separate accounting/implementation decisions.

## 18. Tenant Isolation is mandatory

Payment callbacks are a high-risk Tenant Isolation boundary.

A provider transaction/reference must never allow an event for Tenant A to capture, settle, cancel, or refund Tenant B's Payment Intent/Order/Payment.

Future implementation must derive/verify trusted tenant ownership through the configured provider/account context and explicit ownership validation before mutating tenant-owned resources.

Background workers and webhook handlers must establish trusted TenantContext before querying tenant-scoped Order, PaymentIntent, Payment, Invoice, Reservation, or related resources.

Dedicated negative tests must cover cross-tenant provider references, guessed IDs, mismatched account configuration, and replay attempts.

## 19. Required implementation invariants

Any future implementation must preserve at least these invariants:

1. Commerce Order, Payment Intent, provider transaction, AWJ Payment, Invoice, Refund, Credit Note, and Return remain distinct concepts.
2. Payment Intent amount/currency is tied to an approved commercial obligation/snapshot.
3. Authorization is not silently treated as capture/settlement.
4. COD is not marked paid until collection occurs.
5. Browser/client success is not authoritative payment proof.
6. Provider events and payment mutations are server-verified and idempotent.
7. Successful settlement integrates with the existing AWJ Payment Core rather than a parallel ledger.
8. Refund does not itself move inventory or substitute for Credit Note/Return.
9. Cumulative successful refunds cannot exceed the legitimately refundable captured/settled amount.
10. Temporary checkout holds, when used, share ADR-02 Reservation truth and release/expire safely.
11. Sensitive raw card data is not stored by AWJ.
12. Provider-specific behavior remains behind an adapter boundary.
13. Amount/currency inconsistencies cannot silently mark an obligation paid.
14. Cross-tenant payment mutation is forbidden.
15. Existing ERP/POS payment behavior is not silently changed by introducing Commerce orchestration.

## 20. Explicit non-decisions

ADR-04 intentionally does **not** decide:

- payment provider/vendor selection;
- database schema/indexes;
- exact PaymentIntent/payment-attempt state enums;
- universal default capture policy;
- checkout-hold TTL/renewal/grace period;
- provider-specific 3DS/redirect UX;
- InvoiceTriggerPolicy default;
- COD invoice timing;
- COD operational collection UX;
- provider-specific webhook schemas/endpoints;
- exact existing Payment Core integration method;
- split-tender Commerce implementation;
- partial capture rules;
- multi-capture rules;
- provider fee accounting;
- foreign exchange settlement accounting;
- chargeback/dispute workflow;
- store credit;
- gift cards;
- B2B payment terms/credit accounts;
- saved payment methods;
- subscription/recurring payments;
- public/mobile payment API contract.

These require follow-up ADRs, provider decisions, accounting review, or implementation plans.

## 21. Consequences

### Benefits

- Separates commercial orders from payment-provider mechanics and financial settlement.
- Supports retries, asynchronous providers, COD, future authorization/capture, and partial refunds cleanly.
- Preserves the existing AWJ Payment Core as the financial authority.
- Reduces duplicate-payment/accounting risk through explicit idempotency requirements.
- Creates a safe place to integrate ADR-02 checkout holds without making them universal.
- Keeps Refund, Credit Note, Return, and Exchange correctly separated.
- Limits PCI/security exposure by keeping sensitive card data outside AWJ.
- Makes provider replacement/addition possible without contaminating Commerce Core.

### Costs and trade-offs

- Introduces a new payment orchestration subsystem and inbound webhook security boundary.
- Requires provider-specific adapters and reconciliation logic.
- Requires strong concurrency/idempotency tests for capture/refund paths.
- Adds multiple payment lifecycle states rather than a simple `paid` boolean.
- Checkout hold timing remains provider/policy-dependent.
- Financial integration with existing Payment Core requires careful accounting regression testing.

## 22. Follow-up sequence

After ADR-04, the architecture sequence is:

1. **ADR-05 — Customer / Mobile Identity Boundary**
2. External-channel inventory/payment projection and reconciliation as required
3. Detailed Commerce implementation plan covering Order, Reservation, Sales Channel, Payment Intent, and inbound provider events
4. Provider selection/integration ADR when a concrete gateway is chosen
5. Accounting review for Return Valuation and provider fee/FX treatment where required

No production implementation, migration, provider integration, API change, accounting change, POS behavior change, merge, or deployment is authorized by this ADR.

## References

- `ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md`
- `ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md`
- `ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md`
- `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md`
- `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`
- `AWJ_COMMERCE_PLATFORM_RESEARCH.md`
- `AWJ_COMMERCE_CAPABILITY_RESEARCH_03_RETURNS.md`
- `AWJ_STORE_MASTER_PLAN.md`
