# PAY-V2-6A — Gateway Refund & Chargeback Accounting Design

Status: PROPOSED DESIGN — documentation only; no runtime/accounting implementation in this task.

## 1. Purpose

Define the accounting and lifecycle boundary for refunds after PAY-V2-5 introduced gateway clearing and provider settlement accounting.

Core invariant:

> A commercial/tax correction, a customer cash refund, and a payment-provider settlement adjustment are three different business facts. AWJ must never collapse them into one automatic action.

This document does not change journals, VAT, ZATCA, invoice totals, routes, gateway SDKs, checkout, webhooks, or production behavior.

## 2. Existing AWJ baseline

PAY-V2-5 established:

- gateway customer collection posts gross to `gateway_clearing` against AR;
- customer document `paid_amount` remains gross;
- provider settlement is a separate immutable accounting event;
- merchant fee is a business expense, not a customer surcharge;
- unsupported provider deductions/credits and fee tax fail closed;
- an unsettled gateway collection can use the existing Payment reversal lifecycle;
- a gateway collection already included in a posted settlement cannot use ordinary Payment reversal.

PAY-V2-6 must preserve all of these invariants.

## 3. Three independent facts

### A. Commercial / tax correction

A credit note, sales return, or other approved commercial correction changes what the customer legally/commercially owes and may affect VAT/ZATCA according to the existing document subsystem.

A gateway refund must NOT automatically create, edit, cancel, or infer such a document.

### B. Customer money refund

A customer refund is the financial fact that money is being returned to the customer. It must have its own immutable identity, amount, date, provider reference/status, and link to the original gateway-funded payment or allocation.

It is not an edit of the original Payment and is not ordinary `PaymentReversalService` after provider settlement.

### C. Provider-side refund / settlement effect

The provider may later:

- deduct the customer refund from money it owes AWJ;
- debit AWJ's bank/account;
- return part/all of the original merchant fee;
- retain the original merchant fee;
- charge a new refund fee;
- report other explicit adjustments.

These are separate provider facts. AWJ must post only authoritative provider evidence and must never infer fee refundability.

## 4. Required lifecycle model

The future implementation should use an additive gateway-refund aggregate rather than mutating the original Payment.

Minimum conceptual states:

- `pending`: provider refund requested/known but no authoritative completed financial event yet;
- `succeeded`: provider confirms customer refund succeeded;
- `failed`: provider confirms no customer refund occurred;
- `cancelled` only if the provider/API semantics actually support cancellation before success.

Posted accounting history is immutable. State transitions must be explicit and idempotent.

A provider event/reference must be unique in a tenant + gateway/provider context so replay cannot create a second accounting effect.

## 5. Refund amount rules

- Refund amount uses AWJ integer minor-unit money convention; no floats.
- Full and partial refunds are supported conceptually.
- Cumulative successful refunds must never exceed the gateway-funded amount eligible for refund.
- For split tender, only the gateway-funded portion is eligible for a gateway refund.
- A refund must be linked to the original gateway payment and, when necessary, its original allocation/document context.
- Customer refund amount is never reduced by provider fees in AWJ records. A 400 refund remains a 400 customer refund even if the provider charges AWJ an additional fee.

## 6. Accounting scenarios

The exact debit-side commercial/customer-balance account must follow the approved source document/refund reason and existing AWJ accounting path. PAY-V2-6 must not invent a generic contra-revenue or tax correction outside the document subsystem.

### Scenario 1 — refund before provider settlement

If a gateway collection remains in clearing and an authoritative customer refund succeeds before that collection has been settled, the provider-side monetary effect can reduce the provider receivable/clearing position for the refunded amount.

Conceptual provider-side effect:

```
Dr approved customer refund / liability destination   REFUND
Cr gateway_clearing                                   REFUND
```

The debit destination must come from the approved AWJ refund/document accounting path. It must not be guessed by PAY-V2-6.

The original Payment remains immutable historical evidence.

### Scenario 2 — refund after original provider settlement

After the original collection has already been settled to bank, AWJ must not reverse the historical settlement or original Payment. A new refund/provider event is required.

If the provider later debits AWJ's bank directly, conceptual provider-side effect is:

```
Dr approved customer refund / liability destination   REFUND
Cr bank                                                REFUND
```

If instead the provider offsets the refund against future gateway collections, the credit is to the provider clearing position rather than pretending a bank debit happened.

The actual route must follow authoritative provider settlement evidence.

### Scenario 3 — original merchant fee is retained

No fee reversal entry is created. The historical merchant fee expense remains unchanged.

### Scenario 4 — provider explicitly refunds original merchant fee

Fee recovery is a separate fact from customer refund. Only authoritative provider evidence may create it.

Conceptually, depending on where the provider returns the money:

```
Dr bank or gateway_clearing             FEE_REFUND
Cr provider_fee_expense                  FEE_REFUND
```

Do not infer this from the customer refund amount or percentage.

### Scenario 5 — provider charges a new refund fee

A new refund fee is a new merchant/provider expense. It must not change the customer's refund amount.

Conceptually:

```
Dr provider_fee_expense                  REFUND_FEE
Cr bank or gateway_clearing              REFUND_FEE
```

Only authoritative provider evidence may post it.

### Scenario 6 — fee tax

Provider fee tax remains fail-closed until AWJ has an approved tax evidence/recoverability policy and canonical account routing. No hard-coded VAT rate and no automatic modification of original invoice VAT/ZATCA.

## 7. Commercial document / VAT / ZATCA boundary

Gateway refund does not itself prove that a taxable sale should be reduced.

Therefore PAY-V2-6 must not automatically:

- edit or delete the original invoice;
- change original invoice VAT;
- change original ZATCA XML/UUID/hash/QR;
- create a credit note;
- create a sales return;
- infer a taxable reason.

If a credit note/return already exists or is explicitly created through the approved document workflow, a refund may reference it. The document subsystem remains authoritative for commercial/tax correction.

## 8. Payment reversal boundary

`PaymentReversalService` remains the correction mechanism for an eligible unsettled AWJ Payment voucher.

For a gateway payment already represented in a provider settlement:

- ordinary Payment reversal remains blocked;
- customer refund uses the future gateway-refund lifecycle;
- provider fee refund/retention/new fee are separate provider events;
- historical Payment and settlement rows/journals remain immutable.

Do not call `PaymentReversalService` as a shortcut for a post-settlement gateway refund.

## 9. Refund vs chargeback

Chargeback/dispute accounting is NOT authorized for implementation in PAY-V2-6B unless repository evidence shows an already-approved canonical model.

A chargeback can involve dispute fees, provisional holds, reversals, wins/losses, and later releases. Treating it as a normal refund would be unsafe.

PAY-V2-6A records only this boundary: chargebacks require a separate approved design before accounting implementation.

## 10. Reconciliation and provider evidence

For every posted provider refund effect, preserve immutable snapshots sufficient to explain the journal later:

- tenant;
- gateway/provider;
- original Payment reference;
- provider refund/event reference;
- customer refund gross amount;
- provider fee refunded, if explicitly reported;
- new refund fee, if explicitly reported;
- provider fee tax only when later authorized;
- bank/clearing destination actually used;
- related settlement/event references where available;
- currency;
- accounting date;
- journal entry ID;
- actor/created-by where applicable.

Unknown provider differences fail closed. Never classify unexplained differences as merchant fee expense.

## 11. Partial, multiple and split-tender refunds

- Multiple partial refunds may exist for one gateway payment.
- Sum of succeeded refunds must be capped by eligible gateway-funded amount.
- Concurrent refund requests must lock/recheck the eligible amount.
- In split tender, cash/bank/manual portions are outside gateway refund eligibility.
- Refund matching must not alter unrelated tender lines.
- A batch provider settlement may contain refund effects from several payments, but each provider refund remains independently traceable.

## 12. Idempotency and concurrency

Future implementation must:

- enforce a tenant + gateway/provider + provider refund/event reference uniqueness rule;
- wrap accounting effects in one DB transaction;
- lock/recheck original gateway payment/refund eligibility;
- ensure duplicate webhook/API replay produces at most one journal effect;
- reject same reference with conflicting financial facts;
- remain correct under concurrent duplicate requests.

## 13. Tenant Isolation and security

Mandatory:

- active `TenantContext`;
- all gateway, Payment, refund, bank/CashBankAccount, document and settlement references same tenant;
- forged `tenant_id` rejected/overwritten according to canonical model invariant;
- no `withoutGlobalScope(TenantScope::class)` workaround;
- existing RBAC only unless separately approved;
- actor propagation to CashBank/accounting guards;
- bank access through `CashBankAccountService` where applicable;
- journals through `LedgerService`, never direct journal-line persistence.

## 14. Period lock

Refund/provider accounting uses the existing Ledger/date guard.

- no posting into a locked accounting period;
- no silent back-dating to the original payment/invoice date;
- a later refund is posted on its authoritative/approved accounting date;
- if business policy requires a different treatment, stop and request an explicit accounting decision.

## 15. Branch attribution

Gateway settlements/refunds may be institution-wide provider events. Do not invent branch attribution for multi-branch provider batches.

Future implementation must follow existing repository evidence and Ledger semantics. If the required branch policy is not already canonical, stop and document the blocker rather than guessing.

## 16. PAY-V2-6B — authorized implementation scope after approval

Minimum implementation may include:

1. additive gateway-refund model/table with tenant/gateway/original-payment/provider references and immutable financial snapshots;
2. full/partial refund eligibility and cumulative cap;
3. idempotency/concurrency guards;
4. provider-confirmed customer refund accounting using existing canonical account/document path only where repository evidence makes the debit destination unambiguous;
5. explicit original-fee refund and new-refund-fee facts only where account routing is already approved;
6. preservation of the PAY-V2-5 settled-payment reversal guard;
7. focused SQLite/PostgreSQL tests for accounting, tenant isolation, period lock, duplicate events and split tender.

If repository evidence cannot determine the correct debit destination for a customer refund without inventing new commercial/tax accounting, PAY-V2-6B must STOP and report that exact blocker. It must not invent a generic refund account merely to make CI green.

## 17. Explicit non-goals

- automatic credit note / sales return creation;
- changing invoice VAT/ZATCA automatically;
- customer surcharge;
- provider SDK/API calls;
- webhook receiver;
- Store checkout/PaymentIntent orchestration;
- generic chargeback/dispute accounting;
- FX/multi-currency refund architecture;
- generic reconciliation platform;
- generic account-routing redesign;
- unrelated Payment/POS refactor.

## 18. Acceptance gates for PAY-V2-6B

Before merge of any implementation:

- original Payment remains immutable;
- post-settlement refund does not use ordinary Payment reversal;
- full/partial cumulative refund cannot exceed eligible gateway amount;
- split-tender gateway cap enforced;
- customer refund amount is gross and independent of provider fees;
- original merchant fee is not reversed unless explicit provider evidence says it was refunded;
- new refund fee is separate;
- fee tax fails closed unless separately approved;
- unknown provider differences fail closed;
- no automatic invoice/VAT/ZATCA mutation;
- period lock honored;
- Tenant Isolation negative tests pass;
- duplicate/concurrent event cannot double-post;
- SQLite + PostgreSQL CI green;
- architecture/tool limitations did not move logic outside canonical layers.

## 19. Decision summary

AWJ will model gateway refunds as new immutable financial/provider events, not edits to historical customer payments or settlements.

Commercial/tax correction remains under the existing document subsystem. Customer money refund is its own fact. Provider fee retention/refund/new fee is separately evidenced and accounted.

When AWJ lacks an approved canonical accounting destination, it fails closed rather than inventing accounting policy.

Next step after owner approval: PAY-V2-6B repository evidence pass and narrow implementation plan; implementation begins only for paths whose accounting destination is proven by existing AWJ architecture.