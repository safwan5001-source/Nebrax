# PAY-V2-4 — Payment Gateway Fees Accounting Design

**Status:** Approved design direction / documentation only — no accounting implementation authorized by this document.

**Date:** 2026-09-12

## 1. Purpose

Define the accounting contract that must exist before PAY-V2-5 implements payment-provider fees. This document extends `AWJ_PAYMENT_METHODS_V2_DAFTRA_REFERENCE.md` and preserves the existing rule that Payment Methods V2 does not create new accounting effects until an explicit accounting design is approved.

This phase changes no journals, VAT/ZATCA behavior, payment posting, gateway execution, POS behavior, Store checkout, or database schema.

## 2. Reference boundary

The Daftra reference already documented in AWJ supports these useful concepts: centrally managed payment methods, payment-method expenses, fixed/percentage fee calculation, minimum fee behavior, and tax on payment-method expenses where configured.

AWJ uses those concepts as a benchmark, not as a specification to clone. The AWJ design below deliberately distinguishes provider cost from a customer-facing surcharge and introduces a settlement-clearing model needed for asynchronous gateway settlement.

Where Daftra documentation does not establish complete settlement, refund, chargeback, or reconciliation semantics, this document records an AWJ design decision rather than attributing that behavior to Daftra.

## 3. Core accounting decisions

### 3.1 Provider fee is not customer surcharge

Two concepts must never share one accounting field or rule:

1. **Provider / merchant fee** — an amount charged by the gateway/provider to AWJ's merchant tenant. It is a merchant expense and does not reduce what the customer paid against the invoice.
2. **Customer surcharge** — an additional amount charged to the customer. It changes customer consideration/document totals and may have VAT/ZATCA implications.

PAY-V2-5 is limited to provider/merchant fees unless a separate customer-surcharge policy is explicitly approved.

### 3.2 Electronic collection uses a gateway clearing account

A successful gateway payment must not be posted directly to the final bank account merely because the customer has paid. Until the provider settles the funds, AWJ records an asset/clearing balance representing money due from the gateway.

Conceptual entry when a customer pays 1,000:

- Dr Gateway clearing / receivable: 1,000
- Cr Customer receivable: 1,000

The invoice is paid by 1,000. A later provider deduction must not rewrite the customer payment to 975.

### 3.3 Settlement is a separate accounting event

If the provider later settles 975 and charges a total provider cost of 25:

- Dr Bank: 975
- Dr Provider fee expense (and, where applicable, separately routed input tax): 25 total provider deduction
- Cr Gateway clearing / receivable: 1,000

The exact split between fee expense and tax is driven by the provider's valid fee/tax evidence and the approved tenant tax configuration. PAY-V2-5 must not hard-code a VAT percentage or assume recoverability.

### 3.4 Provider fee tax is not invoice tax

Tax on a provider fee, when applicable, belongs to the provider-cost transaction. It must not modify the original sales invoice tax or taxable consideration paid by the customer.

Customer-facing surcharge tax is a separate future policy because it may alter the taxable customer document and ZATCA representation.

## 4. Required financial snapshots

Historical financial events must remain reproducible after settings change. Any implemented provider-fee event must snapshot, at minimum where applicable:

- gateway/provider identity;
- payment/payment-intent reference;
- settlement reference;
- original customer-paid amount;
- fee rule identity/type;
- percentage/fixed/minimum inputs when AWJ calculates the fee;
- actual provider fee amount when provider settlement is authoritative;
- fee tax amount and tax identity/rate when applicable;
- gross settlement amount;
- net bank settlement amount;
- currency and minor-unit precision;
- accounting routing used at posting time;
- event timestamps/provider reference.

Later edits to gateway, payment method, accounts, or fee rules must never rewrite posted history.

## 5. Rounding and arithmetic

Financial calculations must use the project's established decimal/minor-unit discipline; never binary floating-point arithmetic.

If AWJ calculates a configured fee:

1. calculate the percentage component on the approved fee base;
2. add the fixed component;
3. apply an approved minimum fee if configured;
4. round once according to currency/minor-unit rules at the defined boundary;
5. calculate fee tax according to the approved tax rule;
6. snapshot the resulting amounts.

The precise calculation boundary must be covered by deterministic tests before implementation is accepted.

## 6. Scenario matrix

| Scenario | Customer receivable | Gateway clearing | Provider fee | Bank | Required behavior |
|---|---:|---:|---:|---:|---|
| Successful electronic collection | decrease by gross paid | increase by gross paid | none yet unless fee is authoritatively known/postable | none | Customer payment remains gross |
| Settlement with no fee | unchanged | decrease by gross | 0 | increase by gross | Clearing reaches zero for settled amount |
| Settlement with merchant fee | unchanged | decrease by gross | expense/tax recognized | increase by net | Gross = net + provider deductions |
| Partial settlement | unchanged | decrease only settled gross | recognize only attributable authoritative deductions | increase by net portion | Remaining clearing stays open |
| Batch settlement | unchanged | decrease by sum of matched gross events | recognize settlement fees/tax | increase by actual batch net | Every component remains traceable |
| Full customer refund | follow approved refund/reversal path | reverse/refund flow through gateway clearing | do not assume original fee is refunded | bank depends on provider settlement state | Preserve original payment history |
| Partial customer refund | adjust only refunded customer amount through approved refund path | gateway clearing tracks provider-side refund | provider fee treatment follows provider evidence | bank depends on settlement | Never rewrite original gross payment |
| Provider refunds original fee | no customer effect | provider settlement effect | reverse/reduce fee expense/tax only from authoritative evidence | settlement effect | Separate from customer refund amount |
| Provider retains/adds refund fee | no extra customer effect unless separately approved | settlement effect | new/retained merchant expense | settlement effect | Never silently pass cost to customer |
| Failed payment | no change | no change | no accounting entry | no change | Operational failure only |
| Authorized but not captured | no change unless existing accounting policy explicitly says otherwise | no settled asset | none | none | Authorization alone is not collection |
| Void before financial posting | no change | no change | none | no change | No financial history fabricated |
| Chargeback | customer/receivable treatment requires separately approved chargeback policy | provider-side clearing movement | chargeback/provider fees separated | settlement/bank effect | PAY-V2-5 must not invent policy |
| Settlement variance/unmatched item | no silent customer change | unresolved amount remains reconcilable | no guessed fee | actual bank amount recorded only through approved reconciliation flow | Fail visibly; do not force balance |

## 7. Refund and reversal rules

Posted history is immutable. A refund/reversal must create the appropriate reversing/corrective financial event through the accounting engine; it must not edit the original payment or original provider-fee event in place.

Provider fee refundability is not assumed. Three independent facts may exist:

- customer amount refunded;
- original provider fee refunded/not refunded;
- additional provider refund/chargeback fee charged.

PAY-V2-5 must model only facts supported by the provider event/settlement evidence. It must never infer that refunding the customer automatically refunds the merchant fee.

The existing safe Payment reversal lifecycle remains authoritative for normal posted Payments. PAY-V2-5 must not bypass or weaken it.

## 8. Partial payments and split tender

A fee must attach only to the gateway-funded portion to which it belongs.

For a split payment (for example, cash 400 + gateway 600), a gateway fee must never be calculated against the full 1,000 unless the approved provider contract explicitly bases it on that amount. Existing POS multi-tender semantics and idempotency must remain intact.

Partial invoice payments similarly recognize the customer payment at its gross paid amount. Provider deductions do not reduce `paid_amount`.

## 9. Batch settlement and reconciliation

A provider may settle many customer payments in one bank transfer. Therefore PAY-V2-5 must not assume one payment equals one bank settlement.

The design must support a settlement aggregate containing multiple traceable payment/provider events while preserving:

- tenant isolation;
- gross collected total;
- provider fee total;
- fee-tax total where applicable;
- other explicit provider adjustments;
- net bank amount;
- matched and unmatched state;
- immutable provider settlement reference;
- idempotent import/posting behavior.

A settlement must satisfy an explicit reconciliation equation before final posting, subject only to separately modeled provider adjustments. Unknown variance must remain visible/unresolved rather than being posted automatically to an arbitrary expense account.

## 10. Account routing

PAY-V2-5 must use the established accounting-routing/ledger services and must not write journal lines directly.

Required semantic destinations are:

- gateway clearing / receivable account;
- provider fee expense account;
- input-tax account where the approved tax treatment permits it;
- final bank/cash-bank account through existing ACL-protected routing.

Exact account IDs must not be hard-coded into gateway or payment-method code. Routing must be tenant-aware and follow the canonical AWJ accounting configuration pattern.

## 11. Tenant isolation and security invariants

Financial fee/settlement configuration and events must be tenant-scoped at every read/write boundary.

PAY-V2-5 must include negative tests for:

- cross-tenant gateway/fee-rule references;
- forged `tenant_id` on direct model/service writes;
- cross-tenant clearing/bank/account routing;
- cross-tenant settlement/payment matching;
- missing TenantContext where required;
- actor/RBAC bypass;
- replay/idempotency of provider settlement events.

Gateway credentials remain governed by PAY-V2-3 and must never be copied into fee or settlement snapshots.

## 12. VAT / ZATCA boundary

This design does **not** authorize a hard-coded Saudi VAT treatment for provider fees.

Before PAY-V2-5 posts fee tax, implementation must establish from the tenant/provider tax evidence and AWJ tax configuration:

- whether tax exists on the provider fee;
- the tax identity/rate shown by the provider evidence;
- whether/how it is eligible for input-tax treatment;
- the canonical tax account routing.

Merchant provider fees must not modify the original customer's invoice VAT/ZATCA document.

A customer-facing surcharge is outside PAY-V2-5 because it may change taxable consideration and therefore requires a separate VAT/ZATCA/document decision.

## 13. PAY-V2-5 authorized scope after approval

PAY-V2-5 may implement only the minimum merchant-provider-fee foundation needed to honor this design. It may include:

- provider fee rule/configuration if AWJ must calculate expected fees;
- gateway clearing routing;
- immutable fee/settlement snapshots/events;
- settlement posting through the accounting engine;
- focused refund/reversal handling supported by existing canonical flows;
- reconciliation/idempotency safeguards;
- financial + tenant-isolation tests.

PAY-V2-5 must stop and request a new decision if implementation requires changing invoice taxable totals, customer surcharge behavior, chargeback receivable policy, ZATCA documents, broad account-routing architecture, or unrelated Payment/POS contracts.

## 14. Explicit non-goals

Not authorized by PAY-V2-4:

- customer surcharge implementation;
- provider SDK/API integration;
- checkout or PaymentIntent orchestration;
- webhook receiver implementation;
- hard-coded VAT rates/recoverability;
- chargeback accounting policy;
- changing invoice/POS UX;
- direct journal-line writes;
- unrelated payment/accounting refactoring;
- merge/deploy of financial implementation.

## 15. Acceptance gates for PAY-V2-5

PAY-V2-5 is not complete merely because CI is green. Review must confirm:

1. gross customer payment is never reduced by merchant fees;
2. gateway clearing represents unsettled provider funds;
3. settlement reconciles gross, explicit deductions, and net bank amount;
4. provider fee and fee tax are distinct where tax applies;
5. no fee tax is guessed or hard-coded;
6. original posted financial events remain immutable;
7. refund does not assume fee refundability;
8. partial/split payments fee only the applicable gateway portion;
9. batch settlement is supported by the model rather than forcing 1:1 payment-to-bank assumptions;
10. unknown settlement variance fails visibly;
11. accounting engine/routing services are used canonically;
12. Tenant Isolation, RBAC, actor propagation, and idempotency are tested on SQLite and PostgreSQL.

## 16. Next step

Before code, review this PAY-V2-4 specification against the current accounting engine, tax routing, PaymentService/reversal lifecycle, CashBankAccount ACL path, and PAY-V2-3 gateway foundation. Produce a narrow PAY-V2-5 implementation plan from repository evidence. Do not implement any financial behavior that is not explicitly supported by this document.