# DELIVERY-DECISION-PASS-8 — DG-3 Evidence Contract & Posting Prerequisites

**Task:** `DELIVERY-DECISION-PASS-8`
**Decision area:** `OD-DG-3-TAX-POINT`
**Nature:** architecture and durable documentation only.
**Base SHA (`origin/main` at start):** `b0c3574225531ed907991bd9c5f23a7e8f5d66bb`
**Access date:** 2026-10-05
**Owner:** Safwan
**PASS-7 status:** accepted through PR #1233 at merge SHA
`b0c3574225531ed907991bd9c5f23a7e8f5d66bb`.

## 1. Executive conclusion

PASS-7 is accepted as **Option D**: universal Saudi/GCC VAT principles,
versioned evidence-backed provider/merchant policy, and `UNKNOWN` fail-closed.
PASS-8 turns that decision into a semantic evidence contract. It does not
create the contract's physical schema and does not authorize the imported-order
financial command.

A future imported order is not eligible merely because it exists in the
Delivery Hub, has a webhook, has a settlement, or has a compatible financial
role configuration. The minimum future path is:

```text
raw provider / merchant / payment / tax-document evidence
  -> immutable append-only normalized evidence snapshot
  -> pinned policy + legal/financial-role + VAT-basis snapshot
  -> one or more derived tax-point results
  -> VAT reporting-period projection
  -> posting prerequisite / accounting-representability result
  -> separately authorized canonical financial transition
```

The evidence layer is not accounting authority. `InvoiceService::post` remains
the single canonical sale/inventory authority. Operational Hub state, webhook
arrival, settlement/remittance, and current configuration cannot replace the
historical evidence or become a tax point by software convention.

`UNKNOWN` blocks the affected prerequisite. A legally proven tax result can
still fail the separate accounting-representability gate when AWJ cannot
represent it without duplicating or prematurely recognizing Revenue, AR, VAT,
COGS, or Stock.

## 2. Durable PASS-7 acceptance correction

The merged PASS-7 report contains historical pre-merge wording. The current
durable state is:

| Item | Current state |
|---|---|
| Decision | `OD-DG-3-TAX-POINT` **ACCEPTED** |
| Owner | Safwan |
| Choice | Option D — hybrid universal rule + versioned evidence-backed policy + fail-closed `UNKNOWN` |
| PR / merge | PR #1233 / `b0c3574225531ed907991bd9c5f23a7e8f5d66bb` |
| Effect | Architecture/documentation acceptance only |
| Not authorized | Imported-order posting, VAT posting, provider enablement, connector activation, production release/deploy |

Acceptance does not close the implementation prerequisites. The historical
PASS-7 report is corrected minimally to distinguish its pre-merge state from
the accepted current state. No historical evidence or prior decision is
rewritten.

## 3. Reused decisions and repository authority

This pass reuses the following decisions and does not reopen them:

| Authority | Reused boundary |
|---|---|
| `DELIVERY-DECISION-PASS-3` / `OD-DG-6-TRIGGER` | Operational states do not post. A later explicit command is the only future transition; it must use one transaction and the canonical Invoice path. |
| `DELIVERY-DECISION-PASS-5` / `OD-DG-8-IMPORT` | Imported commercial values require a frozen provider snapshot. Net settlement is not sale price or tax authority. |
| `DELIVERY-DECISION-PASS-6` / `OD-DG-3-POSTING-GATE` | Financial-role fields are necessary and fail closed; they are not sufficient and do not authorize a post. |
| `DLV-FINANCIAL-ROLE-CONFIG-1` | Versioned `selling_role`, `invoice_responsibility`, `collection_role`, `merchant_vat_status_at_supply`, evidence reference, and verification time; `posting_authorized = false` remains intentional. |
| `DLV-HUB-PROJECTION-1` | Hub data is tenant/branch-scoped operational projection only. It creates no invoice, payment, journal, VAT, Revenue, COGS, or Stock. |
| `DELIVERY-DECISION-PASS-1` / `DLV-POS-1` | The DLV-ACCOUNTING-1 foundation and manual POS evidence establish gross sale, platform receivable clearing, merchant-collected tender, and unchanged canonical authorities. |
| `DELIVERY-DECISION-PASS-7` | Tax point is component/result-level, evidence-backed, versioned, and separate from VAT-period projection, tax documents, settlement, and canonical sale recognition. |

### Current code boundaries inspected

The current `InvoiceService::post` implementation locks the invoice, rejects a
non-draft, rebuilds totals from stored lines, posts the ledger entry, posts
output tax, and calls `InventoryService::recordSaleCogs()` inside its database
transaction. It therefore remains the canonical sale/inventory authority and
cannot be repurposed by this document as a tax-evidence store or advance-VAT
projection.

The current `DeliveryPlatformProfileVersion` is append-only and pins the
financial-role snapshot. `DeliveryFinancialRoleGate` returns blocked/eligible
with `posting_authorized: false`; PASS-8 adds no fields, migrations, or gate
changes. Existing `DeliveryInvoiceContext` and
`platform_receivable_clearing` semantics are reused, not redesigned.

## 4. Evidence register reused from PASS-7

No broad research was repeated. These sources are carried forward and remain
separated into general law, provider fact, and AWJ decision:

| Ref | Authority / title | Official URL or repository reference | What it supports | What it does not support |
|---|---|---|---|---|
| G1 | GCC Unified VAT Agreement, Article 23 | https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/02-GCC-VAT-Agreement.pdf | General goods/services tax-due framework, earliest applicable event, payment/invoice timing, goods disposal/dispatch and service completion. | It does not map a provider event or webhook to supply. |
| Z1 | ZATCA VAT Implementing Regulations | https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VATImplementingRegulations.aspx | Saudi implementing provisions and special cases applied to facts. | It is not attributed as the source of the general Article 23 goods rule and does not prove a provider role. |
| Z2 | ZATCA VAT Law | https://www.zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VATLaw.aspx | Statutory framework for taxable supplies, tax invoices, consideration, and liability. | It does not resolve a platform's commercial role from a UI label. |
| Z3 | ZATCA Deemed Suppliers Guideline | https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Persons-Liable-to-Pay-Tax-in-Special-Cases-Deemed-Suppliers.pdf | General marketplace/deemed-supplier concepts and meal/delivery distinctions. | It does not enable any named AWJ provider or merchant. |
| Z4 | ZATCA Tax Invoicing and Records Guideline, version 3 | https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Tax-Invoicing-and-Records-under-VAT-Provisions.pdf | Tax-invoice, records, and evidence distinctions. | A document label alone does not prove supplier identity or supply. |
| Z5 | ZATCA Agents Guideline, version 1, with retained official archive | https://web.archive.org/web/20220419220231/https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Agents%20Guideline.pdf | General disclosed-agent/own-name-agent consequences. | Provider terms still require transaction-specific verification. |
| Z6 | ZATCA VAT Implementing Regulations, Article 46 | https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/VATImplementingRegulations.aspx | Effective cash-accounting treatment and payment-based reporting to the extent paid. | It does not change the legal tax point or authorize payment-based Revenue/Stock posting. |
| Z7 | ZATCA E-Invoicing Detailed Guideline, §8 | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf | The supported advance/final document flow: type `386` advance document and type `388` later document referencing it, where the scenario applies. | It does not select AWJ's advance accounting mechanism or authorize ordinary sale posting for an advance. |
| P1 | HungerStation restaurant terms | https://hungerstation.com/sa-ar/general-terms-conditions-restaurant-contracts | Published ordinary relationship facts recorded in PASS-7: restaurant sells menu items, supplies customer tax invoice, HungerStation may collect, later reconciles/transfers, and separately invoices fees. | It does not prove a named merchant agreement, exact event timestamps, VAT status, or universal tax-point mapping. |

The evidence contract below is an **AWJ architecture proposal** grounded in
these sources and repository authorities. It is not a new legal interpretation.

## 5. Raw evidence contract

The following is a semantic vocabulary, not a migration or a literal database
column list. A future implementation must preserve the original raw payload or
document and the normalized interpretation separately.

### 5.1 Identity and scope

Every evidence item must be attributable to:

- tenant/company identity;
- trusted provider profile and provider/platform identity;
- store/branch identity, including the provider-store-to-AWJ mapping evidence;
- provider order ID and provider event ID, when supplied;
- event sequence, provider version, external reference, and stable
  customer-sale component/supply identity;
- the source order and any parent/child or referenced document identity.

An external ID is not authority by itself. The trusted mapping must be proved
before tenant-owned lookup or linkage. A component identity must remain stable
across partial payments, corrections, and replays.

### 5.2 Raw event time and provenance

For every supplied timestamp, preserve:

- the raw provider value exactly as received;
- parsed instant, timezone/offset, and timezone confidence/status;
- precision (date, minute, second, fractional second, or unknown);
- source type and source reference;
- provider correction/version and supersession link;
- AWJ `received_at` and `ingested_at` separately;
- parser/normalization version and any ambiguity or rejection reason.

AWJ must never replace a missing or ambiguous legal event with `now()`,
webhook arrival, ingestion time, settlement time, or accounting-post time.
Timezone normalization must not silently change the legal local calendar date.

### 5.3 Supply facts

For each customer-facing component or claimed supply, preserve:

- goods/service classification evidence, or `UNKNOWN`;
- supplier identity, supplier VAT role/TIN, and invoice responsibility;
- effective VAT-registration status at supply with supporting evidence;
- distinct delivery/service supplier when the evidence proves one;
- supplied amount, currency, component identity, taxable amount, tax category,
  rate, and VAT amount evidence;
- dispatch, pickup, merchant handoff, delivery, and service-completion facts;
- cancellation, correction, refund, and supersession evidence;
- characterization of discounts, platform-funded/merchant-funded amounts, and
  non-supply/non-taxable document adjustments.

An amount that is not an actual customer-facing supply is not forced into
goods or services. The platform-to-merchant B2B fee is separately identified
and does not enter the customer-sale tax-point result.

### 5.4 Payment facts

Keep these separate, even when a provider supplies one combined payload:

- authorization and authorization status;
- capture and capture status;
- actual receipt/credit and recipient;
- agent/principal relevance where contract evidence proves it;
- amount, currency, payment reference, payer, and payment source;
- refund, reversal, chargeback, or correction evidence;
- deterministic allocation to a supplied component/tax-point result;
- allocated amount, remaining/unallocated amount, and allocation policy/version.

Authorization, capture, actual receipt, platform collection, and settlement
are not interchangeable. A settlement/remittance amount is not the customer
sale tax point or sale value merely because it is money transferred later.

### 5.5 Invoice and tax-document facts

For each invoice or tax document preserve:

- issuer and supplier/TIN;
- invoice responsibility and identified customer/supplier roles;
- invoice/document ID and provider reference;
- issue timestamp with original timezone/precision;
- document type and status;
- raw document reference and checksum;
- ZATCA reporting/clearance evidence where applicable;
- referenced document ID and correction/credit/debit relationship;
- advance/final relationship and allocated component/amount;
- proof that an early document is a valid tax invoice for the identified
  supplier and allocated supplied component. A pro-forma, order receipt,
  confirmation, or payment request does not satisfy this contract.

### 5.6 Fulfillment and correction facts

Preserve raw facts for order creation, merchant acceptance, preparation,
ready, dispatch, pickup, handoff, delivery, service completion, cancellation,
refund, correction, replay, and provider supersession. The event name is only
an operational label until the applicable G1/ZATCA rule and provider/merchant
evidence establish its legal meaning.

### 5.7 Evidence provenance

Each raw item must carry or reference:

- source type (provider API, webhook, merchant agreement/invoice, payment
  processor, delivery proof, settlement statement, or manual evidence);
- raw payload/document checksum and immutable evidence reference;
- verification source, verification timestamp, actor/system, and verifier
  outcome;
- correction/supersession chain and conflict reason;
- tenant and branch scope used for the verification;
- retention/audit classification appropriate to tax and financial sensitivity.

## 6. Immutability and versioning contract

1. Raw evidence is append-only. A duplicate with the same scoped identity,
   checksum, and provider version is an idempotent replay; it creates no second
   fact. A same identity with a different checksum is a conflict or correction,
   never an overwrite.
2. Provider corrections append a new evidence item linked to the superseded
   item. The old item remains queryable. A correction after posting cannot
   silently mutate a posted invoice or reinterpret its journal.
3. Out-of-order events are retained and later ordered by the provider event
   sequence/version when reliable, then by the normalized source timestamp with
   its confidence. AWJ receipt order is not legal event order.
4. Conflicting timestamps, roles, amounts, suppliers, or documents produce a
   conflict state and block the affected result. A human or separately
   authorized evidence policy may resolve it only by appending a reason and
   evidence reference.
5. Checksums cover the exact raw bytes/canonical document representation used
   for verification. Normalized values have their own normalization version;
   changing a parser creates a new derivation, not a raw mutation.
6. Every derived result pins the legal/tax policy version, provider/merchant
   policy version, financial-role configuration version, VAT accounting-basis
   version, timezone interpretation version, and derivation implementation
   version.
7. Merchant VAT status is historical and effective-dated. Current tenant
   configuration or current VAT number cannot reinterpret a past supply.
8. A future implementation must make duplicate delivery of the same evidence
   idempotent, and a replay must not create duplicate invoices, payments,
   journals, stock movement, COGS, or tax documents.

## 7. Policy and derived-state vocabulary

### 7.1 Tax-point evidence status

These are evidence/derivation states, not accounting states:

| State | Meaning | Posting consequence |
|---|---|---|
| `UNKNOWN` | Required legal fact, supplier/role, component classification, event, timestamp, document, or allocation is absent, ambiguous, contradictory, or unverified. | Blocks the affected result and any dependent financial prerequisite. |
| `KNOWN` | AWJ has a deterministic candidate result from identified evidence and a pinned policy, but the full proof standard for legal selection or document/accounting consequence is not complete. | Never sufficient for posting. It is an intermediate derivation state only. |
| `PROVEN` | Required raw evidence, supplier/role, classification, historical versions, legal event selection, timestamp, amount/VAT allocation, and conflict checks satisfy the applicable policy and are traceable. | May satisfy the tax-point prerequisite only; all other gates still apply. |

Only `PROVEN` satisfies the tax-point prerequisite. `KNOWN` must not be
silently promoted because the order is old, settled, delivered, or ready.

### 7.2 VAT reporting projection state

| State | Meaning | Transition rule |
|---|---|---|
| `UNKNOWN` | Basis, payment allocation, tax category/rate, or required reporting fact is not proven. | Remains blocked until a versioned evidence item resolves it. |
| `PROVEN_PERIOD` | The reporting period and allocated taxable/VAT amounts are proven under the pinned standard/accrual or cash-basis policy. | Immutable for that derivation; a later correction creates a new derivation/correction path. |
| `PENDING_UNPAID` | A legal tax point may be proven, but under an effective cash basis the relevant amount has not yet been actually paid/allocated. No VAT period is fabricated. | Later proven payment allocation extends/clears the projection idempotently. |
| `CORRECTION_REQUIRED` | A post-derivation correction, conflict, or required tax-document correction invalidates the current projection for automated use. | Requires a new evidence-backed derivation and, if already posted, the prescribed correction process. |

Evidence state (`UNKNOWN`/`KNOWN`/`PROVEN`) is separate from accounting/posting
state. `PENDING_UNPAID` is not a failed legal tax point and is not a payment,
journal, or ordinary AWJ sale invoice. It may be represented safely for a
canonical sale only after the representability gate approves the later-clearing
projection. Otherwise posting remains blocked.

Other terms must be domain-qualified: `provider_received`, `awj_ingested`,
`service_completed`, `payment_received`, `tax_document_issued`,
`accounting_posted`, and `settlement_reconciled`. Bare `ready`, `completed`,
`paid`, or `posted` are prohibited in the evidence contract.

## 8. Multiple components and tax-point results

One delivery order may produce multiple results. Each derived result is keyed
to a stable supplied component/supply identity and contains:

- supplier identity, VAT role/TIN, effective VAT-registration status, and
  invoice responsibility;
- goods/service classification and evidence;
- allocated taxable amount and currency;
- VAT category/rate and allocated VAT in integer minor units;
- selected legal event kind and tax-point timestamp/date with timezone basis;
- payment allocation and reporting projection state;
- valid tax-document evidence where invoice issue is the selected earlier event;
- raw evidence references, policy/version pins, derivation version, and conflict
  status.

A partial advance creates a result only for the proven allocated component and
amount. The remaining order value remains independently evaluated. A meal and
a separately supplied delivery service, if proven, have independent supplier,
classification, and result gates. A non-supply/document adjustment has no
Article 23 result and is not taxable consideration merely because it has a
numeric value.

Multiple tax-point results are VAT timing/reporting facts only. They do not
imply multiple canonical sales, Revenue recognition, AR recognition, VAT
recognition through ordinary sale posting, COGS postings, or Stock movements.

## 9. VAT accounting-basis contract

The future snapshot must pin an effective-dated, historically provable basis:

- `standard/accrual` — report according to the applicable legal tax-point and
  reporting rules for the proven taxable result;
- `cash_accounting` — only where legally applicable and evidenced; preserve the
  legal tax point, but derive reporting inclusion from actual payment and
  deterministic component/result allocation under Z6 Article 46;
- `UNKNOWN` — no basis is proven or the effective interval is contradictory.

For cash accounting, unpaid consideration may remain `PENDING_UNPAID`. Later
payment must extend or clear the projection idempotently, with amount-bounded
allocation and no invented period. The basis snapshot must include election or
eligibility evidence, effective interval, source, verification time, and policy
version. Merchant VAT registration alone is insufficient.

Cash-basis reporting does not alter the number or timing of canonical Revenue,
AR, COGS, or Stock recognition events. If AWJ cannot represent pending VAT and
later clearing safely, the accounting-representability result is blocked.

## 10. Advance VAT and tax-document contract

The future implementation must distinguish:

1. legal VAT timing;
2. VAT reporting-period projection;
3. required tax/e-invoice document lifecycle; and
4. canonical sale/inventory posting.

Where the accepted Z7 §8 evidence applies, the future evidence set must prove
the advance-document flow, including type `386`, later type `388`, referenced
advance document, supplier/TIN, invoice responsibility, component allocation,
document status, and applicable ZATCA reporting/clearance evidence. Exact
B2B/B2C/profile conditions remain scenario-dependent; unsupported assumptions
stay `UNKNOWN`.

An ordinary AWJ sales invoice must not be posted merely to represent an
advance VAT allocation. `InvoiceService::post` remains the single canonical
sale/inventory authority. The advance mechanism must be separately designed as
a VAT advance/liability or tax-reporting projection and later clear/reconcile
deterministically against the canonical sale without duplicate Revenue, AR,
VAT, COGS, or Stock. PASS-8 does not choose that accounting mechanism.

Until both the required tax-document lifecycle and a safe representability /
clearing design exist, an advance case fails the posting prerequisite.

## 11. Monetary-element contract

Every imported monetary element must be classified into exactly one semantic
category, with evidence:

| Category | Treatment |
|---|---|
| Supplied goods | Customer-facing goods component; Article 23 goods path. |
| Supplied services | Customer-facing service component; Article 23 service path only when separately supplied and proven. |
| Merchant-funded discount / consideration adjustment | Preserve payer and proven tax treatment; do not invent a supply. |
| Platform-funded amount / discount | Preserve platform funding evidence and customer-sale treatment separately; do not turn it into commission or a merchant discount without proof. |
| Non-supply / non-taxable document adjustment | Preserve under AWJ's canonical adjustment semantics; no goods/services classification, Article 23 result, or taxable consideration unless separately proven. |
| Platform-to-merchant B2B fee | Separate supplier/customer supply and separate future fee/settlement gate; outside the customer-sale tax-point gate. |
| `UNKNOWN` | No guess. Blocks financial posting where VAT correctness or canonical totals are affected. |

This contract does not implement commission, settlement, refund, or tax
calculation. Manual POS behavior remains unchanged.

## 12. Posting prerequisite matrix

This is a future architecture matrix, not a production gate change. `blocked`
means the imported financial transition must not run.

| Dimension | Required evidence | Allowed state | Blocking state | Authority / scope | Can change before posting? | After posting |
|---|---|---|---|---|---|---|
| A. Operational eligibility | Trusted tenant/store/branch mapping, permanent provider identity, accepted operational state, not cancelled, idempotent order identity | `eligible` or `blocked` | Unrouted, foreign branch, cancelled, conflict, duplicate identity | Hub projection / branch isolation; order-level | Yes, append-only transition and reroute rules | Late operational facts do not rewrite posted accounting |
| B. Financial-role eligibility | Pinned role version, selling role, invoice responsibility, collection role, supplier VAT status, evidence reference | `eligible` only for compatible evidenced merchant-seller shape; otherwise `blocked` | Any role/status `UNKNOWN`, incompatible platform-seller shape, wrong tenant/version | `DeliveryFinancialRoleGate` + historical role snapshot; order/component supplier | Yes only through a new effective version before posting | Posted context remains pinned; later config cannot reinterpret it |
| C. Tax-point evidence | `PROVEN` result for every required supplied component/allocated amount, legal event, timestamp, supplier, classification, VAT allocation, raw refs | `PROVEN` per result | `UNKNOWN`, `KNOWN`, conflict, missing component, invalid early document | DG-3 policy + evidence snapshot; component/result-level | Yes through new derivation; never silent mutation | Correction requires new evidence/correction process |
| D. VAT reporting projection | Basis version; `PROVEN_PERIOD` or safely represented `PENDING_UNPAID`; payment allocation for cash basis; exact taxable/VAT reconciliation | `PROVEN_PERIOD` or approved `PENDING_UNPAID` | `UNKNOWN`, `CORRECTION_REQUIRED`, invented period, unallocated paid amount | VAT-basis policy + payment evidence; result-level | Yes before posting by append-only derivation | Later payment/correction uses prescribed idempotent projection/correction |
| E. Tax-document requirements | Valid supplier tax invoice/advance-final document where required; type/status/reference/clearance evidence | `satisfied` or `not_applicable` only when proven | Missing required document, pro-forma only, contradictory status, unsupported profile | Z4/Z7 and provider/merchant evidence; component/result-level | Yes before posting; corrections supersede | Document correction does not silently edit posted invoice |
| F. Accounting representability | Approved projection can represent all results, periods, advances, pending cash VAT, corrections, and supplier allocations without unsafe canonical effects | `representable` only after explicit future design approval | Any duplicate/premature Revenue, AR, VAT, COGS, Stock risk or missing clearing model | AWJ accounting authority / architecture decision; order and result-level | Yes only via approved design gate | Posted accounting follows canonical correction authorities |
| G. Final posting authorization | All A–F prerequisites proven, actor/command authorized, idempotency lock and canonical transition available | `eligible_for_explicit_command`; never automatic | Any prerequisite blocked or no separately authorized command | Future command + existing permissions; order-level | Yes until command starts | One canonical post and immutable historical snapshots |

All dimensions are necessary and not sufficient in isolation. “All
prerequisites proven” does not mean “post automatically”; a separately
authorized command must exist and be explicitly invoked. This pass does not set
`posting_authorized = true` or modify `DeliveryFinancialRoleGate`.

## 13. Accounting-representability gate

This is deliberately separate from tax legality. It must fail closed when AWJ
cannot represent, without unsafe side effects:

- multiple VAT periods or allocated components;
- partial/advance VAT and its required document flow;
- `PENDING_UNPAID` cash-basis VAT and later clearing;
- supplier/component VAT allocations and exact minor-unit reconciliation;
- correction or supersession after prior evidence;
- a tax document whose lifecycle cannot be reconciled to the canonical sale.

The gate must reject a legally correct result rather than fabricate a journal,
ordinary sale invoice, payment, tax period, or inventory event. Its future
decision must state the approved VAT-only projection and clearing authority,
while preserving one canonical sale/inventory recognition path.

## 14. Canonical authority invariants

- `InvoiceService::post` is the canonical sale/inventory authority.
- One underlying delivery sale has one canonical Revenue/AR/COGS/Stock
  recognition path unless a later separately approved architecture changes this
  invariant.
- Evidence snapshots and VAT projections never call `InvoiceService::post`,
  write journals, create payments, move stock, or recognize COGS.
- Multiple tax-point results or advance documents never imply multiple sales.
- Platform-collected consideration follows accepted
  `platform_receivable_clearing` semantics; no invented cash/bank receipt.
- Merchant-collected behavior remains the existing canonical tender behavior.
- Settlement/remittance is later clearing evidence, not customer-sale tax point
  or gross sale value.
- Operational Hub state and webhook receipt remain non-financial facts.
- Posted history is never reinterpreted from current role, VAT, policy,
  timezone, or provider configuration.

## 15. Tenant, branch, and security contract

The future evidence layer must require:

- tenant-owned raw and derived evidence, enforced before lookup/linkage;
- trusted provider/store-to-tenant mapping before tenant-owned resolution;
- branch scope and routed-branch authorization where applicable;
- no external ID as authority and no cross-tenant evidence linking;
- no cross-tenant reuse of policy, role, basis, timezone, or derivation versions;
- encrypted provider secrets kept outside this evidence contract;
- audit access appropriate to tax/financial sensitivity, with actor/system and
  verification timestamps;
- correction and replay logs that cannot expose foreign tenant/store data.

This is not Connector Core design and does not add permissions, APIs, secret
storage, or webhook behavior.

## 16. HungerStation implementation-readiness checklist

PASS-7's published P1 terms are provider evidence only. They do not establish
readiness for a named merchant. The minimum readiness packet is:

| Requirement | State at PASS-8 | Consequence |
|---|---|---|
| Named merchant's accepted/signed HungerStation agreement | **MISSING** | No merchant-specific legal-role policy. |
| Merchant VAT status at relevant supply period | **MISSING / UNKNOWN** | Supplier VAT gate blocks. |
| Effective merchant VAT accounting basis | **MISSING / UNKNOWN** | Reporting projection gate blocks. |
| Official order event semantics | **MISSING** | Acceptance/dispatch/delivery labels cannot select tax point. |
| Authorization, capture, actual receipt semantics | **MISSING** | Payment/advance allocation cannot be proven. |
| Agent/recipient evidence | **UNKNOWN** | Collection cannot be mapped to supplier/payment receipt. |
| Customer invoice payload/reference | **MISSING** | Supplier, TIN, responsibility, and early-document proof missing. |
| Invoice issue timestamp semantics | **MISSING** | Invoice event cannot be selected safely. |
| Supplier/TIN responsibility per component | **UNKNOWN** | Component gate blocks. |
| Dispatch/handoff/delivery semantics | **MISSING** | Goods disposal/dispatch mapping is unproven. |
| Cancellation/refund semantics | **MISSING** | Correction path remains blocked. |
| Correction/replay semantics | **MISSING** | Append-only/idempotent derivation cannot be verified. |
| Advance-payment document evidence where applicable | **NOT APPLICABLE until an advance case is evidenced; otherwise MISSING** | No advance path may pass by default. |
| Published ordinary restaurant terms | **AVAILABLE** (P1, provider fact only) | Supports no more than the limited facts recorded in PASS-7. |

HungerStation is therefore **NOT READY / BLOCKED** for imported financial
posting and is not enabled by this pass.

## 17. Other-provider readiness state

No provider research was repeated. PASS-7/PASS-6 evidence is carried forward:

| Provider | Current evidence state | Imported financial posting |
|---|---|---|
| Keeta | Partial public user-term evidence with differing merchant/fee shapes; no named merchant agreement or complete event/payment/document packet. | `UNKNOWN` / BLOCKED |
| Jahez | No merchant contract and no complete supplier/invoice/payment/tax-point packet. | `UNKNOWN` / BLOCKED |
| Mrsool | Courier/user terms do not prove the restaurant customer sale or supplier role. | `UNKNOWN` / BLOCKED |
| Ninja | Consumer terms identify an item provider but do not prove invoice responsibility and tax-point mapping. | `UNKNOWN` / BLOCKED |
| The Chefz | Consumer terms refer to an invoice but do not prove principal versus billing-on-behalf role. | `UNKNOWN` / BLOCKED |

Manual POS remains independent and unchanged. No provider is enabled.

## 18. Future implementation slices

These are dependency proposals, not authorization:

| Slice | Scope | State | Reason |
|---|---|---|---|
| A. Immutable evidence snapshot foundation | Append-only raw/normalized evidence, checksum, scope, supersession, provenance vocabulary | `OWNER_GATE` | Contract is documented, but schema/runtime implementation needs separate authorization and a tenant/security review. |
| B. Policy/evidence derivation service | Version-pinned policy evaluation and component tax-point results | `OWNER_GATE` | Requires approved policy vocabulary and legal/financial implementation design; not authorized by PASS-8. |
| C. VAT reporting projection foundation | Basis-aware periods, `PENDING_UNPAID`, exact allocation, correction state | `OWNER_GATE` | Advance/cash accounting mechanism remains a separate design gate. |
| D. Accounting-representability evaluator | Safe representability decision without journal/posting side effects | `OWNER_GATE` | Requires explicit design for advance, pending cash VAT, multiple periods, and clearing. |
| E. Posting-prerequisite evaluator | Matrix A–G, fail-closed reasons, historical pins | `OWNER_GATE` | Must not change `DeliveryFinancialRoleGate` or authorize posting without a separately approved command. |
| F. Provider-specific evidence adapter | HungerStation or another provider's verified payload/contract mapping | `PROVIDER_EVIDENCE_GATE` | Named merchant agreement, official test path, and complete event/payment/document packet are missing. |
| G. Imported-order financial-transition command | Explicit command using `InvoiceService::create` + `post` and accepted clearing behavior | `BLOCKED` | Requires A–F, OD-DG-3 acceptance (now present), provider enablement, and separate implementation authorization. |

The next independent, genuinely dependency-ready Horizon task is
`DLV-CLOSE-1`, not an imported-order slice. It can remain bounded to POS
close/Z-report channel presentation because its dependencies are merged and it
does not recognize imported VAT or create imported invoices.

## 19. Horizon queue reconciliation

The original queue order is retained as history. Current disposition:

- `DLV-COMMISSION-1`: blocked by authoritative provider fee/tax evidence and
  its own accounting decision; do not infer commission from settlement.
- `DLV-SETTLEMENT-1`: blocked on commission/evidence and platform settlement
  authority; settlement is not customer-sale tax point.
- `DLV-RECON-1`: blocked until typed settlement evidence and matching authority
  exist.
- `DLV-REFUND-1`: blocked for imported-provider behavior until canonical
  correction/refund evidence and authority are confirmed; existing manual/POS
  refund behavior is unchanged.
- `DLV-CLOSE-1`: next genuinely dependency-ready bounded task, independent of
  imported-order VAT recognition.
- `DLV-CONNECTOR-CORE-1`: may be considered only as a projection/intake
  security task under a separate scope; imported financial behavior remains
  blocked and provider onboarding is absent. It is not promoted by PASS-8.
- `DLV-HUNGERSTATION-1`, `DLV-KEETA-1`, and
  `DLV-PROVIDER-READINESS-1`: provider-evidence/onboarding gates remain open.
- `DLV-VERTICAL-1`, `DLV-QA-1`, and `DLV-CLOSE-HORIZON-1`: downstream and not
  ready while imported posting and provider evidence remain blocked.

## 20. New decision gates

1. **DG-3-EVIDENCE-SNAPSHOT:** approve the physical append-only evidence
   contract, tenant/branch isolation, checksum/supersession, and historical
   retention model before implementation.
2. **DG-3-POLICY-DERIVATION:** approve versioned policy/derivation semantics,
   including component suppliers, tax-point cardinality, timezone confidence,
   VAT basis, and correction behavior.
3. **DG-3-VAT-PROJECTION:** approve the VAT-only reporting projection for
   multiple periods, advance documents, `PENDING_UNPAID`, exact VAT allocation,
   and idempotent clearing. This does not choose an advance accounting
   mechanism in PASS-8.
4. **DG-3-ACCOUNTING-REPRESENTABILITY:** approve the separate evaluator and
   its invariant that legal tax proof may still fail when AWJ cannot represent
   it without duplicate/premature Revenue, AR, VAT, COGS, or Stock.
5. **DG-3-PROVIDER-READINESS:** approve one named merchant/provider packet,
   beginning with HungerStation, before any provider-specific policy or adapter
   is enabled.
6. **DG-3-FINANCIAL-TRANSITION:** separately authorize the explicit imported
   financial command only after all prerequisite dimensions are proven and the
   canonical Invoice/Payment/Inventory boundaries remain intact.

No gate above is closed by writing this report. No production behavior is
changed.

## 21. Review and out-of-scope confirmation

Implementer self-review, reviewer-style review, and AWJ Guardian review must
verify this document specifically for:

- no schema disguised as implementation;
- no posting authorization or VAT calculation;
- no order-level tax point replacing component results;
- no cash-basis or advance document conflation with Revenue/AR/COGS/Stock;
- no platform fee or settlement conflation with customer sale;
- no webhook/Hub timestamp treated as tax point;
- no current configuration reinterpretation of history;
- tenant/branch isolation and no cross-tenant version reuse.

This pass changes documentation only. It creates no migration, model, API,
permission, connector, webhook, settlement, commission, reconciliation,
refund, invoice, payment, journal, inventory, POS behavior, VAT calculation,
provider enablement, deployment, or production release.

**PRE_MERGE_REVIEW:** pending until this pass's own PR has exact-head green
CI, zero unresolved P1/P2 findings, clean working tree, and final diff review.
