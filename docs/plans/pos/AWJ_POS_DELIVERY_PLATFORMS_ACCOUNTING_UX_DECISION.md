# AWJ POS — Delivery Platforms Accounting & UX Decision

**Status:** Architecture/accounting/UX decision — documentation only  
**Date:** 2026-10-02  
**Scope:** Delivery-platform integration ownership, POS delivery channels, receivable/clearing, settlement/reconciliation, Delivery Hub and UX.  
**Runtime/schema changes require separate implementation approval.**

## 1. Goal

Support delivery platforms in AWJ POS while preserving correct accounting and a fast cashier UX.

Initial platforms:

- HungerStation
- Keeta
- Jahez
- Mrsool
- Ninja
- The Chefz

The cashier should recognize the platform by **logo + name**, select it quickly, and AWJ should automatically treat platform-collected orders as **amounts receivable from the platform**, not cash/bank and not net sales.

---

## 2. Evidence summary

### HungerStation — verified public partner API

Official evidence:

- https://developer.hungerstation.com/en/documentation/api-partner-api-overview
- https://developer.hungerstation.com/en/documentation/pos-partner-picking-how-to-integrate
- https://developer.hungerstation.com/api-specifications

Verified capabilities include POS integration, webhook-driven incoming orders, order retrieval/update, vendor/store mapping, partner onboarding, and order-history/reconciliation support.

**State:** `VERIFIED_PUBLIC_API`.

### Keeta — verified public order API

Official evidence:

- https://api-docs.mykeeta.com/apis/standard/docs/orderintegrationguide
- https://api-docs.mykeeta.com/apis/standard/order
- https://api-docs.mykeeta.com/apis/opendelivery/merchantendpoints
- https://api-docs.mykeeta.com/apis/opendelivery/integrating-with-keeta-api

Verified capabilities include new-order events, cancellation/refund events, delivery status, merchant/store mapping and merchant-side order actions.

Keeta also exposes merchant-settlement-related information in the order flow. AWJ must still treat provider settlement evidence as authoritative and must not assume every financial field is final at initial order ingest.

**State:** `VERIFIED_PUBLIC_API`.

### Jahez — partner POS integration verified; public API contract not established

Operational POS integration is documented by Foodics. Orders can flow into Foodics Cashier and status changes can be synchronized back. The integration requires enablement/onboarding.

Evidence:

- https://help.foodics.com/hc/en-us/articles/7530462943132-Jahez

**State:** `VERIFIED_PARTNER_INTEGRATION / PUBLIC_CONTRACT_UNVERIFIED`.

### Mrsool — partner POS integration verified; public API contract not established

Foodics documents direct Mrsool integration with merchant authorization/onboarding and orders arriving in Foodics Cashier.

Evidence:

- https://help.foodics.com/hc/en-us/articles/7530409996060-Mrsool

**State:** `VERIFIED_PARTNER_INTEGRATION / PUBLIC_CONTRACT_UNVERIFIED`.

### The Chefz — partner POS integration verified; public API contract not established

Foodics documents The Chefz integration where orders arrive directly in Foodics Cashier after merchant authorization/configuration.

Evidence:

- https://help.foodics.com/hc/en-us/articles/7530493962652-The-Chefz

**State:** `VERIFIED_PARTNER_INTEGRATION / PUBLIC_CONTRACT_UNVERIFIED`.

### Ninja — integration ecosystem evidence; native contract not established

Foodics Marketplace documents FoodiZone as connecting delivery platforms including Ninja into Foodics POS.

Evidence:

- https://www.foodics.com/portfolio/foodizone/

This proves ecosystem integration exists, but does not establish a public Ninja API contract available directly to AWJ.

**State:** `ECOSYSTEM_INTEGRATION_VERIFIED / NATIVE_CONTRACT_UNVERIFIED`.

---

## 3. Capability matrix

| Platform | Public API verified | POS integration evidence | Native AWJ connector status | Manual fallback |
|---|---|---|---|---|
| HungerStation | Yes | Yes | Eligible after official onboarding | Yes |
| Keeta | Yes | Yes | Eligible after official onboarding | Yes |
| Jahez | Not publicly verified | Yes | Gated pending official contract | Yes |
| Mrsool | Not publicly verified | Yes | Gated pending official contract | Yes |
| The Chefz | Not publicly verified | Yes | Gated pending official contract | Yes |
| Ninja | Not publicly verified | Ecosystem evidence | Gated pending official contract | Yes |

**Rule:** “integration exists” is not the same as “AWJ has an official API contract”. No native connector is authorized until official onboarding, credentials, event semantics and test/sandbox evidence are available.

---

## 4. AWJ domain decision

A delivery platform is **not merely a payment method**.

Conceptually it is:

```text
Sales Channel
+ External Order Source
+ Settlement / Collection Counterparty (when platform collects)
```

AWJ must keep three identities separate:

1. **Invoice customer**
2. **Sales channel**
3. **Settlement counterparty / collector**

Selecting “HungerStation” in POS must never automatically make HungerStation the legal invoice customer.

This preserves the existing AWJ Commerce boundary in:

- `docs/plans/store/ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md`

---

## 5. Accounting decision

AWJ should reuse the same clearing/settlement concept already documented for gateways:

- `docs/plans/payments/AWJ_PAY_V2_4_FEES_ACCOUNTING_DESIGN.md`
- `docs/plans/accounting/ACC-3-sales-payment-account-routing.md`

### Gross sale principle

If a platform-collected sale is SAR 100, AWJ must preserve the gross amount of SAR 100.

Conceptually:

```text
Dr Delivery-platform receivable / clearing   100
Cr Customer receivable / sale settlement     100
```

The exact implementation boundary must use canonical AWJ Invoice/Payment/Ledger services. This document does not authorize posting changes.

### Settlement principle

Example provider statement:

- Gross matched amount: 100
- Platform fee: 20
- VAT on provider fee: 3
- Net bank deposit: 77

Conceptually:

```text
Dr Bank                                       77
Dr Platform fee expense                       20
Dr Recoverable input VAT (if valid)            3
Cr Delivery-platform receivable / clearing   100
```

The VAT treatment on provider fees must come from valid tax evidence and tenant tax configuration. It must never be hard-coded or assumed recoverable.

### Reconciliation invariant

```text
matched gross receivable
= net bank settlement
+ authoritative fees
+ authoritative fee tax
+ other typed provider adjustments
```

Unknown variance remains **unreconciled**. AWJ must not silently post it to a miscellaneous expense account.

---

## 6. Settlement is first-class

A platform settlement may cover many orders.

The future model must support:

- platform identity
- merchant/store/branch mapping
- settlement reference and period
- gross matched order total
- commissions/fees
- VAT on platform fees where evidenced
- refunds
- merchant-funded vs platform-funded promotions
- delivery/service adjustments
- other explicit typed deductions
- net bank deposit
- matched / partially matched / unmatched state
- immutable source evidence
- idempotent import/posting

**Do not assume one order equals one bank transfer.**

---

## 7. POS UX decision

### Manual selection

Cashier sees a compact sales-channel selector:

```text
[ داخل المتجر ] [ HungerStation ] [ Jahez ] [ Keeta ] [ Mrsool ] [ Ninja ] [ The Chefz ]
```

Each external channel shows:

- official logo
- short name
- clear selected state

Default remains **داخل المتجر**.

### When a platform is selected

AWJ records the sales channel.

If tenant configuration says the platform collects the money, AWJ automatically switches the settlement treatment to platform receivable/clearing.

Cashier-facing wording can be:

- `آجل — مستحق من هنقرستيشن`
- `Receivable from HungerStation`

The cashier must not choose ledger accounts manually.

### Automatic API mode

For a verified native connector, **AWJ Backend owns the provider integration**. The browser/POS client must never own provider credentials, webhook verification, tenant resolution, idempotency or financial posting.

```text
Delivery platform
-> AWJ Backend connector/webhook boundary
-> authenticate + resolve tenant/store/branch
-> idempotent external-order ingest
-> AWJ order/domain state
-> POS / Delivery Hub projection
-> fulfillment
-> canonical Invoice/Payment/Inventory domains
-> platform receivable/clearing
-> settlement/reconciliation
```

The POS is a **consumer/operator surface**, not the integration owner. This means an order can be received and safely persisted even when no cashier screen is open.

Imported orders already carry the channel and external order reference; cashier does not re-select or re-type them.

Provider API keys, secrets and tokens remain server-side and encrypted under the canonical tenant-scoped secret mechanism. They must never be exposed to the POS/browser bundle.

### Manual fallback

Every configured platform must remain usable manually even without API access.

Manual mode should capture at minimum:

- channel
- external order reference
- collection policy
- branch/store mapping

The external order reference is manually entered only when it was not supplied by an integrated order source. Native/API orders must not ask the cashier to re-enter it.

This makes the feature useful before all native integrations are approved.

### Do not duplicate channel selection as a payment choice

The cashier must not be required to choose the same platform twice, for example:

```text
Channel = Jahez
Payment method = HungerStation
```

That creates an avoidable contradictory state.

Preferred AWJ behavior:

```text
Cashier selects: HungerStation
-> AWJ records Sales Channel = HungerStation
-> configured collection policy = Platform Collected
-> AWJ derives settlement treatment = Receivable from HungerStation
```

The cashier-facing checkout may display `آجل — مستحق من هنقرستيشن`, but the persisted domain model must not reduce the platform to a generic payment-method enum. Cash/card/multi-tender remain payment mechanisms; delivery channel and settlement counterparty remain separate semantic dimensions.

### Delivery Hub / Online Orders workspace

AWJ should provide a unified operational workspace for external delivery orders rather than treating delivery integration as checkout buttons only.

Conceptual filter/navigation:

```text
طلبات التوصيل
[ الكل ] [ HungerStation ] [ Jahez ] [ Keeta ] [ Mrsool ] [ Ninja ] [ The Chefz ]
```

A normalized order card/row should be able to expose, subject to provider capability:

- platform logo + name
- external order reference
- branch/store
- received time
- order amount
- normalized status
- preparation/fulfillment state
- provider-specific actions only when officially supported

Conceptual lifecycle:

```text
Incoming -> Accepted -> Preparing -> Ready -> Handed off / Completed
                    \-> Cancelled / Exception
```

Provider-native statuses must be preserved as source evidence and mapped to AWJ normalized states; AWJ must not invent provider actions or status transitions that the official connector does not support.

The Delivery Hub is operational. Accounting remains authoritative in canonical Invoice/Payment/Ledger domains, and settlement/reconciliation remains a separate accounting workspace.

### POS close / Z-report presentation

Delivery-platform sales must be visible separately from physical tender expectations. A platform-collected order must not increase expected cash-drawer or card-terminal collections.

Example presentation:

```text
Cash sales                  1,200
Card-terminal sales         2,500
HungerStation sales           850
Jahez sales                   600
Expected physical cash      1,200
```

This is reporting/presentation guidance, not authorization to redefine existing POS close accounting.

---

## 8. Logo and brand UX

- Use official permitted platform brand assets.
- Always show logo **and** platform name.
- Do not use brand colors as AWJ financial semantic colors.
- AWJ selection/focus states remain controlled by AWJ design tokens.
- Logo failure degrades to platform name + neutral fallback mark.
- No emoji substitutes in production POS.

This follows AWJ’s existing design principle: daily accounting clarity, density, speed and trust before decoration.

---

## 9. Inventory, cancellation and discount boundaries

### Inventory event

Printing is not an inventory accounting event by itself. AWJ must not encode a rule such as “deduct inventory when the receipt is printed”.

Delivery orders must use the same canonical AWJ inventory/fulfillment event policy as equivalent POS orders. The implementation plan must explicitly define the stock-consumption/reversal event and test cancellation/retry behavior so printing or reprinting cannot duplicate stock movement.

### Discounts

The settlement/order model must preserve who economically funds a promotion:

- merchant-funded discount;
- platform-funded discount/reimbursement;
- mixed/other provider adjustment when evidenced.

These must not collapse into one generic discount when their accounting/tax treatment differs.

### Cancellation / compensation

Cancellation must reference the original order and, once a tax invoice exists, follow AWJ's canonical refund/credit-note rules.

A provider payment after cancellation must not automatically be classified as sales revenue merely because the platform compensated the merchant. Compensation classification depends on the contract, source evidence and approved accounting/tax policy.

Prepared-but-unsold food/waste is an inventory/cost event separate from cancellation of sales consideration. No automatic waste-expense posting is authorized by this document.

---

## 10. VAT / ZATCA boundary

ZATCA distinguishes between agency arrangements where an agent acts in the principal’s name and arrangements where the agent acts in its own name. Therefore AWJ must not assume one legal/tax role for all delivery platforms.

Official references:

- https://www.zatca.gov.sa/en/HelpCenter/guidelines/Documents/Agents%20Guideline.pdf
- https://www.zatca.gov.sa/en/HelpCenter/guidelines/Documents/VAT_Digital_Economy_Guidebook_Egnlish.pdf
- https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Pages/default.aspx

Rules:

- platform selection must not automatically change invoice customer identity;
- platform fees and VAT on platform fees do not rewrite original invoice VAT;
- agency/principal/collector treatment must follow the merchant-platform contract;
- any change to invoice identity, invoice type, tax point or taxable consideration requires a separate approved VAT/ZATCA decision.

---

## 11. Security and tenant-isolation gates

No native connector may ship without:

1. trusted tenant resolution before tenant-owned lookups;
2. provider-specific webhook authentication;
3. replay protection and idempotency;
4. external store/vendor mapping;
5. encrypted credential storage using canonical AWJ secret handling;
6. audit evidence without credential leakage;
7. retry policy that cannot duplicate financial posting;
8. cancellation/refund ordering rules;
9. dead-letter/manual recovery path;
10. cross-tenant negative tests;
11. fail-closed behavior;
12. provider sandbox or controlled test evidence.

---

## 12. Backward compatibility

This feature is additive.

- Existing POS cash/card/multi-tender behavior remains valid.
- Legacy sales do not require a SalesChannel migration.
- Invoice Core remains authoritative.
- Payment/Ledger routing remains authoritative.
- Historical journals are not reinterpreted after configuration changes.
- No connector may bypass RBAC, actor propagation, branch rules, CashBankAccount protections or Tenant Isolation.

---

## 13. Recommended delivery slices

### DLV-1 — Channel foundation + manual POS UX

- configured delivery channels
- official logos + names
- POS selector
- external order reference
- collection-policy derivation without duplicate “platform payment method” selection
- no native API yet
- no broad accounting refactor

### DLV-1B — Delivery Hub foundation

- unified online/delivery order workspace
- normalized channel/status presentation
- branch/store-scoped order visibility
- manual and future native orders share one operational projection
- no provider credentials in POS/browser
- no native connector yet

### DLV-2 — Platform clearing + settlement

High accounting risk.

- semantic account routing
- platform clearing/receivable
- settlement aggregate
- fee/tax/adjustment components
- reconciliation equation
- bank routing
- immutable snapshots
- SQLite + PostgreSQL accounting/tenant tests

### DLV-3 — HungerStation native connector

Only after official onboarding credentials/test environment.

### DLV-4 — Keeta native connector

Only after official onboarding credentials/test environment.

### DLV-5+ — Jahez / Mrsool / The Chefz / Ninja

One connector per separately verified official contract.

No reverse engineering.

---

## 14. Locked decisions

1. Delivery apps are **Sales Channels**, not simple payment methods.
2. Invoice customer, channel and settlement counterparty are separate concepts.
3. Platform-collected sales preserve gross value through receivable/clearing.
4. Settlement is a separate reconcilable event.
5. Platform commission and provider-fee VAT do not rewrite original sales.
6. POS uses recognizable **logo + name** and hides accounting complexity.
7. Manual channel mode is a permanent supported fallback.
8. Native connectors require official onboarding/contracts.
9. Unknown settlement variance remains visible.
10. Existing Invoice/Payment/Ledger/ZATCA/Tenant Isolation authority is preserved.
11. Native delivery APIs terminate at AWJ Backend; POS/browser is a consumer, never the credential/webhook/integration owner.
12. Delivery Hub is the unified operational surface for external orders; settlement remains a separate accounting concern.
13. Selecting a platform once must derive its configured collection treatment; cashier must not select the same platform again as a payment method.
14. Printing is not an inventory event; canonical inventory/fulfillment rules remain authoritative.
15. API-imported external order references are not manually re-entered.
16. Cancellation compensation is not automatically classified as sales; evidence and approved accounting/tax policy govern classification.
17. This document authorizes no deploy, schema or runtime accounting change.

---

## 15. Open implementation items

Before coding:

- obtain native API/partner packages for Jahez, Mrsool, The Chefz and Ninja;
- obtain official logo assets/usage permission;
- validate each platform merchant contract’s agency/collection/VAT role;
- decide whether external order reference is mandatory per channel;
- define semantic account names for platform clearing and fee expense;
- inspect current POS checkout extension point and SalesChannel reuse opportunity;
- define refund/credit-note and cancellation-compensation interaction;
- define the canonical inventory consumption/reversal event for delivery orders;
- define normalized Delivery Hub statuses and provider-specific capability mapping;
- define settlement matching and variance workflow;
- produce focused implementation plans for DLV-1, DLV-1B and DLV-2 separately.

