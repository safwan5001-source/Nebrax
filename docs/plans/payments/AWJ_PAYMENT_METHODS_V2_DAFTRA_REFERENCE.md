# AWJ Payment Methods V2 — Daftra Reference & Gap Analysis

**Status:** Reference / planning only — no implementation decision that changes accounting behavior is authorized by this document.

**Date:** 2026-09-11

## 1. Purpose

Document the current AWJ payment-method foundation, the useful patterns observed in Daftra payment-method documentation, the gaps between them, and a safe direction for future implementation. This is a reference for Payments, POS, invoices, purchases, refunds, and AWJ Store.

Accounting accuracy, tenant isolation, backward compatibility, and preservation of historical documents take priority over feature parity.

## 2. Current AWJ repository evidence

AWJ already has a tenant-scoped `payment_methods` master table. The current model supports:

- Arabic name and optional English name.
- Settlement type: `cash` or `bank`.
- Required operational destination through `cash_bank_account_id`.
- Instructions.
- `available_online`.
- Active/inactive state.
- One default method.
- Tenant-scoped uniqueness and indexes.

Payments link to `payment_method_id` and also persist `payment_method_name` as a historical snapshot, so later renaming or disabling the master method does not make historical vouchers unreadable.

The current controller also protects important invariants:

- an inactive method cannot be default;
- only one default is retained;
- a used method cannot be deleted and should be disabled instead;
- the selected cash/bank destination must be active and match the settlement type.

The current code intentionally describes payment methods as operational master data **without independent fees/accounting impact**. Therefore fees must not be added as superficial UI fields without a separately approved accounting design.

### POS

AWJ POS already supports multiple tenders in one checkout: each tender carries `payment_method_id` and its amount. POS settings also already contain payment-method enablement/restriction concepts. This foundation must be preserved rather than rebuilt.

## 3. Daftra reference findings

Daftra's documented pattern treats payment methods as centrally managed configuration reused by collection/payment surfaces. Relevant concepts include:

- active/inactive method;
- default method;
- customer/online availability;
- customer-facing instructions;
- default treasury/bank destination;
- custom payment methods;
- payment-method expenses/fees;
- fee calculation as fixed amount, percentage, or a combination, with documented minimum-fee behavior;
- tax applied to payment-method expenses where configured;
- POS-level selection of which enabled methods are available and which method is default;
- split collection across more than one payment method;
- online-payment gateways and store/customer payment availability.

These are reference patterns, not requirements to clone Daftra literally.

## 4. Gap matrix

| Capability | AWJ current state | V2 direction |
|---|---|---|
| Central tenant payment-method master | Present | Preserve |
| AR/EN names | Present | Preserve |
| Cash/bank settlement destination | Present | Preserve and harden |
| Active/inactive | Present | Preserve |
| Default method | Present | Preserve |
| Instructions | Present | Preserve |
| Online availability | Present | Refine into channel policy when needed |
| Historical method-name snapshot | Present | Mandatory backward-compatible behavior |
| Split POS tender | Present | Preserve |
| POS payment-method restriction | Present | Preserve/refine |
| Payment-method fees | Missing intentionally | Separate accounting design before implementation |
| Fixed / percentage fee rules | Missing | Candidate V2 feature |
| Minimum fee | Missing | Candidate V2 feature |
| Tax on payment fee | Missing | Separate tax/accounting design required |
| Gateway configuration | Not part of current payment-method foundation | Separate gateway layer |
| AWJ Store channel policy | Not yet integrated | Reuse central master; do not create a separate Store payment-method master |
| Per-channel availability | Partial | Introduce explicit channel policy only when required |

## 5. Proposed architecture direction

Use three layers instead of turning `payment_methods` into an overloaded table.

### Layer A — Payment Method Master

The existing tenant-scoped master remains the source of truth for the business-visible payment method:

- identity/name;
- settlement type;
- cash/bank destination;
- active/default state;
- instructions;
- historical references.

Existing IDs and historical snapshots must remain valid.

### Layer B — Channel Availability / Policy

A method may be allowed or disallowed by channel without duplicating the master record. Candidate channels include:

- back-office collections/payments;
- POS;
- AWJ Store;
- customer portal;
- future mobile commerce/app.

Do not prematurely create a generic policy engine. Extend the existing POS settings first and introduce a shared channel model only when Store/customer channels require it.

### Layer C — Payment Gateway

Electronic gateway configuration is not the same concept as a payment method. A gateway is an integration/provider configuration that may power one or more customer-visible payment methods.

Keep credentials/secrets outside normal payment-method payloads and UI responses. Gateway secrets require encrypted/secret storage, tenant isolation, explicit permissions, auditability, and safe webhook/idempotency handling.

## 6. Payment fees — accounting gate

**No implementation is approved yet.**

Before adding fees, AWJ must decide and test at least:

1. Who bears the fee: customer, merchant, or configurable per method/channel?
2. Whether the fee becomes part of the invoice/document total or is created at collection time.
3. Revenue/expense account routing for fees.
4. VAT/tax treatment and tax-account routing.
5. Rounding rules and minor-unit arithmetic.
6. Partial payment behavior.
7. Split-tender allocation when only some methods have fees.
8. Refund, void, reversal, and chargeback behavior.
9. Whether gateway/provider cost is distinct from a customer-facing surcharge.
10. ZATCA/document implications when a customer-facing fee changes the taxable consideration.
11. Historical snapshots of the applied fee rule/rate/amount so later settings changes never rewrite history.

Until these are approved, the existing invariant — payment methods themselves do not create independent accounting impact — remains authoritative.

## 7. Safety invariants for implementation

Any Payment Methods V2 implementation must preserve:

- strict `tenant_id` isolation;
- cash/bank ACL enforcement through the established CashBankAccount service path;
- actor propagation to posting services;
- no direct journal-line writes outside the accounting engine;
- one valid active default where required by existing behavior;
- no deletion of methods referenced by historical transactions;
- snapshot fields on posted/historical transactions;
- existing POS multi-tender behavior and idempotency;
- backward-compatible APIs unless a separately approved versioning/migration plan exists.

Financial, security, tenant-isolation, refund/reversal, and POS checkout tests must not be weakened to make V2 pass.

## 8. AWJ Store decision

AWJ Store must consume the AWJ central payment-method foundation. It must **not** create an independent store-owned payment-method master.

Store-specific enablement, presentation, ordering, gateway availability, or instructions may be channel configuration layered on top of the central method.

This preserves one accounting destination and one operational identity while allowing Store UX to differ from POS/back-office UX.

## 9. Suggested implementation sequence

### PAY-V2-1 — Foundation hardening / contracts

Repository verification and focused tests for current invariants, APIs, tenant isolation, default behavior, cash/bank ACL, historical snapshots, and POS restrictions. Avoid schema expansion unless an actual defect requires it.

### PAY-V2-2 — Channel availability foundation

Add only the minimum abstraction required to share payment-method availability with AWJ Store/customer channels while preserving existing POS behavior.

### PAY-V2-3 — Gateway foundation

Provider/gateway configuration, secrets boundary, permissions, idempotency/webhook model, and Store/customer integration. No provider-specific sprawl in the payment-method master.

### PAY-V2-4 — Fees accounting design

Docs/tests-first accounting specification for surcharge/provider fee/tax/refund/reversal semantics. Implementation starts only after explicit approval of the accounting policy.

### PAY-V2-5 — Fees implementation

Implement only the approved policy, with focused financial and tenant-isolation tests followed by broader required CI.

## 10. Explicit non-goals

This reference does not authorize:

- changing journal rules;
- changing VAT/ZATCA behavior;
- database migration for fees;
- adding gateway credentials;
- redesigning payment/POS screens;
- merging or deploying implementation;
- refactoring unrelated payment, invoice, purchase, or POS code.

## 11. Recommended immediate next step

Run **PAY-V2-1** as a narrow repository verification pass. Produce an implementation/verification report showing current routes, permissions, request/resource contracts, tests, POS policy behavior, Store touchpoints, and any confirmed defects. Only confirmed gaps should become implementation PRs.
