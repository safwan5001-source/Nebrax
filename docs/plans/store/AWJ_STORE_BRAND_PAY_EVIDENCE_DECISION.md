# STORE-BRAND-PAY-EVIDENCE-1 — Payment Capability Evidence & Decision Packet

**Task:** STORE-BRAND-PAY-EVIDENCE-1  
**Base SHA:** `5802fc30b673e1be8b7fff8943d733d55b5df7a0`  
**Scope:** evidence/documentation only; no runtime, schema, gateway, checkout, accounting, or deployment changes.

## Decision

**Classification: ARCHITECTURE_DECISION_REQUIRED / DEFERRED.**

Do **not** implement `STORE-BRAND-PAY-1` in the current horizon.

AWJ has an authoritative channel-scoped source for operational `PaymentMethod` rows, but that source does **not** model card-network/wallet acceptance. The current Commerce Payment Intent contract supports only:

- `cod`
- `pay_on_pickup`

Therefore mada, Visa, Mastercard, Apple Pay, and Google Pay are **not proven storefront capabilities today**. Rendering those marks in the Footer would be a false acceptance claim.

This is the valid Decision Gate described by the horizon definition. It does not block the non-payment composition/QA/closure path.

## 1. Current sources of truth

### Commerce Payment Intent capability

`storefront/src/lib/commerce/checkout-types.ts` declares:

`AWJ_PAYMENT_INTENT_METHODS = ["cod", "pay_on_pickup"]`

and explicitly documents that no online/card method exists yet.

Backend authority is `CommercePaymentIntent` / `CommercePaymentIntentService`; the payment method is derived from delivery method and is not a card/wallet choice.

### Merchant/channel-enabled operational payment methods

Public storefront reads:

`GET /store/v1/checkout/payment-methods`

through `StorefrontCheckoutController::paymentMethods()`.

That controller resolves the current storefront SalesChannel and delegates to:

`PaymentMethodChannelAvailabilityService::availableFor($channel)`

The response exposes only safe public fields:

- `id`
- `name`
- `name_en`
- `settlement_type`

Frontend `fetchAwjPaymentMethods()` documents the same boundary: methods are channel-enabled, default online-channel availability can be empty, and the request shape contains no provider/card fields.

### PaymentMethod is not a card-network capability registry

`PaymentMethod` is an operational company-wide settlement destination. Existing records are modeled around settlement/account destinations such as cash/bank.

This can answer “which operational payment destination is enabled for this channel?” but cannot answer:

- accepts mada?
- accepts Visa?
- accepts Mastercard?
- accepts Apple Pay?
- accepts Google Pay?

### PaymentGateway is not acceptance truth

`PaymentGateway` is a provider/integration foundation. Existing provider identifiers (for example Stripe/Tap/PayTabs/Checkout.com/Custom) do not prove that a given storefront accepts any specific card network or wallet.

Provider configuration must never be translated directly into Footer acceptance marks.

## 2. Scope / isolation

The public payment-method endpoint is resolved from the active `StorefrontContext` SalesChannel and uses the existing tenant-aware availability service.

Therefore the existing operational-method truth is channel-scoped and tenant-guarded.

However, the missing network/wallet acceptance model means Preview and Published Storefront currently have no safe shared truth from which payment-brand marks could be derived.

## 3. Individual capability classification

| Brand / option | Type | Proven supported now? | Proven enabled per storefront? | Classification |
|---|---|---:|---:|---|
| COD | Commerce Payment Intent method | Yes | Derived by delivery flow | COMPLETE (non-logo scope) |
| Pay on Pickup | Commerce Payment Intent method | Yes | Derived by delivery flow | COMPLETE (non-logo scope) |
| mada | Card network / acceptance brand | No | No | DEFERRED |
| Visa | Card network / acceptance brand | No | No | DEFERRED |
| Mastercard | Card network / acceptance brand | No | No | DEFERRED |
| Apple Pay | Wallet / payment option | No | No | DEFERRED |
| Google Pay | Wallet / payment option | No | No | DEFERRED |
| Stripe / Tap / PayTabs / Checkout.com / Custom | Gateway/provider identifiers | Foundation only | Not equivalent to shopper acceptance | OUT_OF_SCOPE as Footer marks |

## 4. First-party brand evidence

These sources are evidence for **future** implementation only. They do not change the capability decision above.

### Visa

First-party Visa Brand Center / merchant signage resources provide official digital brand artwork and requirements.

- https://corporate.visa.com/en/about-visa/brand.html
- https://merchantsignage.visa.com/brandguidelines

Only official artwork should be used, and only when Visa acceptance is actually true.

### Mastercard

First-party Mastercard Brand Center states that merchant websites/apps may use the Mastercard acceptance mark only for brands they actually accept. Artwork must be official and unaltered, and acceptance marks shown together require parity.

- https://www.mastercard.com/brandcenter/us/en/brand-requirements/mastercard.html
- https://www.mastercard.com/brandcenter/us/en/faq.html

### Apple Pay

Apple requires the Apple Pay mark to communicate actual Apple Pay availability, using Apple-provided artwork without alteration. Apple Pay on the web also requires merchant/domain setup.

- https://developer.apple.com/apple-pay/marketing/
- https://developer.apple.com/design/human-interface-guidelines/apple-pay
- https://developer.apple.com/documentation/ApplePayontheWeb/configuring-your-environment

### Google Pay

Google's first-party brand guidelines require the provided Google Pay mark, prohibit altering it, and describe it as an indicator of Google Pay as a real payment option in the payment flow.

- https://developers.google.com/pay/api/android/guides/brand-guidelines

### mada

A sufficiently precise first-party public asset/usage rule set was not captured in this evidence pass. Before any future mada implementation, obtain and record the official Saudi Payments/mada merchant acceptance artwork and current usage requirements. Do not source the mark from an icon library or arbitrary web asset.

## 5. Why Footer payment marks are unsafe today

A Footer row such as “mada / Visa / Mastercard / Apple Pay / Google Pay” would imply those options are accepted.

Current AWJ truth can only prove:

1. which operational `PaymentMethod` rows a channel has enabled; and
2. that Commerce Payment Intent currently supports COD / Pay on Pickup.

It cannot prove card-network or wallet capability.

Therefore a static logo list, a gateway-derived list, or a merchant-entered decorative list would violate the horizon truth rule: **payment logos are never decorative claims**.

## 6. Required future architecture before PAY-1

A future payment integration horizon must define a server-authoritative acceptance capability model, for example a normalized capability set tied to the effective storefront/channel and active provider configuration.

The model must answer independently, at minimum:

- `mada`
- `visa`
- `mastercard`
- `apple_pay`
- `google_pay`

It must be derived from actual supported + configured + enabled checkout capability, not merchant decoration and not provider name inference.

Before implementation it must also define:

- tenant/channel isolation;
- provider-to-capability mapping authority;
- wallet/device/runtime eligibility versus general merchant acceptance;
- Preview/Public API exposure;
- safe fallback when provider state is unavailable;
- reconciliation with Checkout's real payment options;
- brand-asset provenance and parity rules.

## 7. Horizon consequence

- `STORE-BRAND-PAY-EVIDENCE-1`: resolved at Decision Gate.
- `STORE-BRAND-PAY-1`: **DEFERRED**; do not run in this horizon.
- `STORE-BRAND-COMPOSE-1`: may proceed without payment marks once APPS-1 and CONTACT-1 are closed.
- No payment logo placeholder should be added.

## 8. Safety statement

No code, database, financial posting, payment provider, checkout request/response, RBAC, tenant resolution, or deployment configuration is changed by this task.
