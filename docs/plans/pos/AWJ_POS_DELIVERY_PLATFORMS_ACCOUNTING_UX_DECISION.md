# AWJ POS — Delivery Platforms Accounting & UX Decision

**Status:** Evidence-first proposal — documentation only  
**Date:** 2026-10-02  
**Branch:** `docs/pos-delivery-platforms-accounting-ux`  
**Base SHA:** `b6024bd25a826e3800238d9c3ea1c62920001614`  
**Scope:** POS delivery channels, receivable/clearing, settlement/reconciliation, UX.  
**No runtime code / no schema / no merge / no deploy.**

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

For a verified native connector:

```text
Platform webhook
-> trusted tenant/store mapping
-> idempotent order ingest
-> POS/order workspace
-> fulfillment
-> canonical Invoice/Payment domains
-> platform receivable/clearing
-> settlement/reconciliation
```

Imported orders already carry the channel; cashier does not re-select it.

### Manual fallback

Every configured platform must remain usable manually even without API access.

Manual mode should capture at minimum:

- channel
- external order reference
- collection policy
- branch/store mapping

This makes the feature useful before all native integrations are approved.

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

## 9. VAT / ZATCA boundary

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

## 10. Security and tenant-isolation gates

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

## 11. Backward compatibility

This feature is additive.

- Existing POS cash/card/multi-tender behavior remains valid.
- Legacy sales do not require a SalesChannel migration.
- Invoice Core remains authoritative.
- Payment/Ledger routing remains authoritative.
- Historical journals are not reinterpreted after configuration changes.
- No connector may bypass RBAC, actor propagation, branch rules, CashBankAccount protections or Tenant Isolation.

---

## 12. Recommended delivery slices

### DLV-1 — Channel foundation + manual POS UX

- configured delivery channels
- official logos + names
- POS selector
- external order reference
- no native API yet
- no broad accounting refactor

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

## 13. Locked decisions

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
11. This document authorizes no merge, deploy, schema or runtime accounting change.

---

## 14. Open implementation items

Before coding:

- obtain native API/partner packages for Jahez, Mrsool, The Chefz and Ninja;
- obtain official logo assets/usage permission;
- validate each platform merchant contract’s agency/collection/VAT role;
- decide whether external order reference is mandatory per channel;
- define semantic account names for platform clearing and fee expense;
- inspect current POS checkout extension point and SalesChannel reuse opportunity;
- define refund/credit-note interaction;
- define settlement matching and variance workflow;
- produce focused implementation plans for DLV-1 and DLV-2 separately.

