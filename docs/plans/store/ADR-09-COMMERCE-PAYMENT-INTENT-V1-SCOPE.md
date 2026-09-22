# ADR-09 — Commerce Payment Intent V1 Scope (COD / Pay on Pickup)

**Status:** Accepted — Owner Decision
**Date:** 2026-09-22
**Scope:** authorizes the first implementation of `ADR-04`'s Payment Intent orchestration boundary, for Commerce Core (shared by Storefront, Mobile, and future App Builder apps). Does not select a payment provider/vendor. Does not authorize saved payment methods, online capture, or any real card/wallet processing.

## Context

`ADR-04` (Accepted, 2026-09-09) already decided the Payment Intent orchestration shape (`Commerce Order → Payment Intent → Provider Attempt → Successful Settlement → existing AWJ Payment Core`) but authorized no implementation. Repository evidence (Decision/Evidence Packet, delivered 2026-09-22) confirmed:

- No payment concept exists anywhere in Commerce checkout today — `CommerceCheckout`/`CommerceOrder` carry no payment method, no payment status, no amount-collected field. `CommerceCheckoutController::complete()` produces a `confirmed` order with zero payment step.
- `PaymentGateway` (credential storage), `PaymentMethod` (`settlement_type` cash|bank), and `PaymentMethodChannelAvailabilityService` (tested, tenant-scoped, per-channel enablement) already exist as shared, `CompanyWide` platform primitives but are consumed by zero controllers.
- `PaymentGatewaySettlementService` already gives the AWJ Payment Core a place to land gateway-settled funds via manual reconciliation (clearing account `1170`, fee account `5510`) — this is the "existing AWJ Payment Core" ADR-04 requires Commerce to integrate with rather than duplicate.
- ADR-04 §4/§5 already anticipates `COD` and `PAY_ON_PICKUP` as method shapes, and already requires COD to sit `pending/uncollected` until actual collection — never "paid at order creation."

The Owner Decision authorizes implementing this now, bounded to methods that require no vendor: COD and Pay on Pickup.

## AWJ Decision (owner-authorized)

1. **Payment Intent is a first-class Commerce Core concept**, implemented per ADR-04's shape: a `CommercePaymentIntent` (or equivalently named) record tied 1:1 (or 1:many across retries, per ADR-04 §2) to a `CommerceOrder`, carrying a lifecycle state (at minimum: `pending`, `awaiting_collection`, `collected`, `cancelled` — exact enum is implementation detail, not re-litigated here) and a `method` (`cod`, `pay_on_pickup` for this pass).
2. **COD / Pay on Pickup never mark an order paid at creation.** Order confirmation (existing ADR-01 behavior, unchanged) and payment collection are independent events; a Payment Intent for these methods starts `pending`/`awaiting_collection` and only a separate, explicit collection action (out of scope to build a UI for in this pass beyond what's needed to prove the state machine, but the *capability* to transition to `collected` must exist) moves it forward.
3. **`PaymentMethodChannelAvailabilityService` is wired into the shared Commerce checkout/payment contract** — a channel (mobile, web) asks which payment methods are enabled for it via this existing service, unchanged internally. No mobile-specific or web-specific availability logic is introduced.
4. **No parallel ledger.** Settlement/accounting authority remains exactly what ADR-04 and the existing `PaymentGatewaySettlementService`/`LedgerService` already provide. This pass does not add new journal-posting logic beyond what COD collection eventually requires (and that posting, if built in this pass, reuses `PaymentService`/`LedgerService` unchanged — no new financial write path invented).
5. **Shared, not mobile-only.** The Payment Intent model, state machine, and channel-availability wiring live in `app/Models`/`app/Services/Commerce` (or `app/Services/Payments`, implementation's choice) and are consumed identically by `/commerce/v1`, `/store/v1`, and future App Builder consumers — never a mobile-specific payment flow.
6. **No raw card/wallet data ever stored or processed by AWJ.** Not applicable to COD/Pickup directly, but stated here as a standing constraint for when a real PSP is later chosen (ADR-04 §21 already lists this as a stated benefit of the boundary; restated here as an explicit rule for this implementation).

## Open Decisions (still not made — explicitly out of scope here)

- **Payment provider/vendor** (Moyasar, HyperPay, Tap, PayTabs, or other) — a strategic vendor commitment, a separate future Owner Decision, prepared against fresh official/primary documentation at that time.
- **Online capture policy** (immediate vs. authorize-then-capture) — meaningless until a provider exists; deferred with it.
- **Saved payment methods** — explicitly out of scope for this pass.
- **COD invoice timing** — ADR-04 §5 already named this as its own non-decision; unchanged here.

## Consequences

### Benefits
Implements the accepted ADR-04 boundary for the first time, on the cheapest possible method (no vendor, no webhook surface, no PCI exposure), proving the orchestration model works before any vendor commitment is made. Unblocks a real mobile checkout completion that isn't silently "free."

### Costs / trade-offs
Introduces a new domain concept (Payment Intent) and its own state machine/tests before any online payment actually exists — pure architecture investment ahead of the revenue-generating case, justified because the accepted ADR-04 shape does not change once a provider is later added (the adapter slots in, the orchestration boundary doesn't move).

## References
- `docs/plans/store/ADR-04-PAYMENT-INTENT-CAPTURE-REFUND.md`
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md`
- `docs/plans/commerce/COM-MOBILE-PAYMENTS-1-IMPLEMENTATION-REPORT.md` (full evidence, once implemented)
