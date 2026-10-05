# DELIVERY-DECISION-PASS-7 — DG-3 tax point

**Task:** `DELIVERY-DECISION-PASS-7`
**Decision:** `OD-DG-3-TAX-POINT`
**Nature:** evidence, architecture decision, and durable documentation only.
**Base SHA (`origin/main` at start):** `230d9f020f859705db8a5c0ae07db1acb453e5d7`
**Access date:** 2026-10-05
**Status:** proposed; no production behavior is enabled by this report.

## 1. Executive conclusion

Saudi VAT law supplies a general earliest-event rule for goods, but it does
not turn every Delivery Hub event into a tax point. For a normal goods sale,
the relevant date is the earliest legally applicable event among placing the
goods at the customer's disposal, dispatch/transport in the circumstances
specified by the Regulations, receipt of payment, or issuance of an invoice.
The exact rule depends on the facts, the type of supply, and whether a
payment is actually received or merely authorized.

The safe AWJ decision is **Option D — a hybrid**:

1. Universal Saudi rules and precedence are recorded as immutable policy
   principles.
2. The selected event and required evidence are versioned per provider,
   merchant agreement, supply type, and effective period.
3. A missing, contradictory, corrected, or unproven fact is `UNKNOWN` and
   blocks imported-order financial posting. No webhook time, settlement time,
   current time, or operational status is a fallback.
4. The derived VAT tax point is a traceable result, not raw evidence. It must
   point to the raw provider/payment/invoice evidence and the policy version
   that selected it.

This pass does not authorize an imported order, change
`DeliveryFinancialRoleGate`, call `InvoiceService`, recognize VAT, create a
payment, or change manual POS behavior.

## 2. Scope and reused accepted decisions

This pass answers the tax-point questions for an imported delivery-platform
order where AWJ has evidence that the merchant is the seller. It reuses, and
does not reopen:

- `OD-DG-8-IMPORT`: preserve the frozen provider commercial snapshot;
- `OD-DG-3-POSTING-GATE`: required financial-role facts are fail-closed;
- `DLV-ACCOUNTING-1`: gross sale and platform clearing are distinct;
- `DLV-POS-1`, `DLV-HUB-PROJECTION-1`, and `DLV-HUB-UI-1`: operational Hub
  state is not posting authority;
- `DLV-FINANCIAL-ROLE-CONFIG-1`: the role dimensions are versioned and
  `posting_authorized = false` intentionally;
- the horizon invariants that settlement is later than, and not the same as,
  the underlying sale.

No accepted decision is changed. The report does not reopen provider role,
commission, settlement, reconciliation, refund, connector, or webhook work.

## 3. Evidence method and source register

The following are the decision sources. G1 is the GCC primary instrument for
the general goods/services date-of-supply rules; Z1/Z2/Z3/Z4 are Saudi
implementation and guidance sources; the HungerStation terms are provider
evidence only.

| Ref | Authority and title | Official URL | Date / access | What it proves | What it does not prove |
|---|---|---|---|---|---|
| G1 | GCC Unified VAT Agreement, Article 23 (tax due date for goods and services) | https://tax.gov.ae/-/media/Files/FTA/links/Legislation/VAT/02-GCC-VAT-Agreement.pdf | Official FTA-hosted copy of the GCC Agreement; accessed 2026-10-05 | Article 23 contains the tax due-date framework for goods and services: the earliest applicable event, including disposal/dispatch for goods and completion of services, with payment and invoice timing where applicable. Article 24 concerns imports and is not the domestic service rule. | It does not map a named provider webhook, acceptance state, pickup, or settlement to supply without facts. |
| Z1 | ZATCA, *VAT Implementing Regulations* | https://zatca.gov.sa/en/RulesRegulations/VAT/Pages/VATImplementingRegulations.aspx | Current official regulations page; accessed 2026-10-05 | Saudi implementing provisions and special timing cases that supplement/apply the GCC framework. It is not the source attributed here for the general Article 23 goods rule. | It does not map a named provider webhook, acceptance state, pickup, or settlement to supply without facts. |
| Z2 | ZATCA, *VAT Law* | https://zatca.gov.sa/en/RulesRegulations/VAT/Pages/VATLaw.aspx | Current official law page; accessed 2026-10-05 | The statutory framework for taxable supplies, tax invoices, consideration, and tax liability. | It does not decide the commercial role of a platform from a consumer UI label. |
| Z3 | ZATCA, *Guideline for Persons Liable to Pay Tax in Special Cases — Deemed Suppliers* | https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Persons-Liable-to-Pay-Tax-in-Special-Cases-Deemed-Suppliers.pdf | Current official guideline URL; accessed 2026-10-05 | Article 47 marketplace/deemed-supplier concepts, including the significance of supplier VAT registration and the distinction between meal, delivery, and platform-fee supplies. | Its food-delivery examples are general. They do not prove the role or event mapping of HungerStation, Jahez, Keeta, Mrsool, Ninja, or The Chefz. |
| Z4 | ZATCA, *Guideline for Tax Invoicing and Records under VAT Provisions*, version 3 | https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Tax-Invoicing-and-Records-under-VAT-Provisions.pdf | May 2026; accessed 2026-10-05 | Tax-invoice timing, electronic invoicing, records, and the distinction between issuing a document and proving the underlying supply. | Invoice issue alone is not a universal provider-specific supply event; it does not establish merchant/platform principal status. |
| Z5 | ZATCA, *Agents Guideline*, version 1, July 2020 | Official ZATCA publication; the prior repository evidence records the original URL as unavailable and the archived official capture at https://web.archive.org/web/20220419220231/https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Agents%20Guideline.pdf | July 2020; access/recheck 2026-10-05 | Disclosed-agent versus own-name-agent consequences, including invoice identity and primary VAT responsibility. | An agency label in a provider's user terms is not enough to establish the VAT result for a particular merchant transaction. |
| P1 | HungerStation, *General Terms and Conditions for Restaurant Contracts* | https://hungerstation.com/sa-ar/general-terms-conditions-restaurant-contracts | Page states updated 2026-08-06; rechecked 2026-10-05 | For the published ordinary restaurant relationship: the restaurant sells its products through the platform, supplies the customer tax invoice with the order, HungerStation may collect electronic customer payments, balances are reconciled/transferred, and HungerStation separately invoices restaurant amounts/fees. | It does not prove a named merchant's signed agreement, exact payment-receipt instant, delivery event semantics, VAT status at supply, or a universal HungerStation tax-point rule. |

Where the official text or provider payload does not establish an event, this
report says `UNKNOWN`; it does not fill the gap with industry practice.

## 4. General Saudi VAT rules

### A. Goods date of supply

Under Article 23 of the GCC Unified VAT Agreement (G1), the goods tax point
is generally the earliest applicable statutory event: the goods being placed
at the customer's disposal, the dispatch/transport event where Article 23
makes that the relevant event, receipt of payment, or issuance of the invoice.
Saudi implementing provisions (Z1) and current ZATCA guidance apply the
framework and address special cases; they are not the source of the general
Article 23 rule.

This is an **earliest applicable legal event** rule, not an instruction to
choose whichever timestamp an API happens to expose. A food order may include
separate supplies (for example meal and delivery); each supply can require its
own analysis (Z3).

### B. Service components and classification

Article 23 of G1 governs both goods and services. For a service component,
Article 23(2)(d)'s completion/performance event applies rather than the goods
dispatch rule, subject to the Agreement's earlier payment and invoice timing
rules and Saudi implementing guidance. A delivery
charge is not presumed to be a service or a separate supply: the contract,
commercial substance, provider/merchant evidence, and VAT classification must
establish whether it is a goods component, a separately supplied service, or
part of another supply.

Before selecting a tax-point rule, AWJ must classify every customer-facing
order component included in the customer sale (at minimum meal/goods,
delivery when charged to the customer, and any separately priced customer
adjustment) as goods, service, or unresolved. `UNKNOWN` classification blocks
selection for that customer-sale component. A platform's separate B2B
commission/brokerage fee is not a customer-sale component: preserve it as raw
evidence, but evaluate it under its own later fee/settlement gate. The derived
result must retain the classification evidence and the applicable Article 23
policy path/subparagraph.

### C. Actual supply, invoice, payment, and advance payment

- An actual supply event can create the tax point when it is the applicable
  statutory event for the classified component: disposal/dispatch for goods
  under G1 Article 23, or performance/completion under G1 Article 23(2)(d),
  subject to earlier payment/invoice rules.
- An invoice issued before that event can advance the tax point where the
  applicable G1 rule and Saudi implementing material treat invoice issue as
  the earlier event. It does not prove that the named party is the supplier.
- Payment actually received before supply, including an advance payment, can
  advance the tax point for the amount received under the payment rule. A
  payment authorization or an uncompleted card hold is not automatically
  receipt of funds.
- If a supply is cancelled after an advance-payment tax point, the legal and
  accounting consequence is a correction/refund/credit-note analysis under the
  applicable VAT rules. The advance does not become harmless merely because
  the order was later cancelled.
- Payment receipt, invoice issue, and delivery can be different instants. AWJ
  must preserve all three and derive the result from the effective policy and
  evidence, rather than overwrite one with another.

### D. Agent and marketplace boundary

Z3 and Z5 distinguish the supplier from an agent and address deemed suppliers.
The restaurant's VAT registration status and the actual contractual/economic
substance matter. Collection, invoicing on behalf of another, and supplying
in one's own name are different legal facts. A provider's settlement or fee
invoice is not the customer's meal supply.

## 5. Event-by-event analysis

The table answers whether each event can advance the tax point **in some
facts**, not whether it always does for a delivery platform. `Conditional`
means the event can matter only if the current Regulations and evidence make
it the applicable earliest event.

| Event | Result | Analysis and timestamp to preserve |
|---|---|---|
| 1. Customer places order | No, by itself | An order is an offer/operational fact unless the contract and supply facts establish an actual supply or advance payment. Preserve provider order time and raw value. |
| 2. Platform receives order | No, by itself | Platform receipt is not customer disposal, dispatch, payment receipt, or invoice issue. Preserve receipt time and event ID. |
| 3. Merchant receives order | No, by itself | Operational routing does not prove supply. Preserve merchant-received time if supplied. |
| 4. Merchant accepts order | No, by itself; otherwise UNKNOWN if contract says acceptance completes a supply | Acceptance normally proves an operational commitment, not the statutory goods event. Preserve it; do not select it without authoritative mapping. |
| 5. Payment authorization | No, by itself | An authorization/hold is not necessarily receipt. Preserve authorization status, amount, currency, and provider reference separately. |
| 6. Payment capture | Conditional | Capture is evidence of a payment operation, not conclusive proof that the merchant or platform received funds. Preserve capture time and status; require settlement/payment evidence for receipt. |
| 7. Advance payment received | Yes, conditionally and only for the amount/component received | Actual receipt before supply can create an advance-payment tax point for the amount received under G1 and applicable Saudi guidance. A partial advance does not prove the entire order or remaining consideration has that tax point. Preserve received/credited time, recipient, amount, allocation, instrument, and proof of actual receipt. |
| 8. Preparation starts | No for goods; otherwise UNKNOWN absent service evidence | Preparation is not a general goods event. For a service, it may be evidence in the performance timeline, but no source makes preparation alone the universal service-completion event. Preserve it without selecting it by default. |
| 9. Ready | No, by itself | Ready is a kitchen/platform state, not customer disposal or dispatch. Preserve it as operational evidence only. |
| 10. Courier pickup | Conditional by component | Pickup can be relevant to the goods dispatch rule under G1 Article 23 where the component is goods and the factual delivery arrangement fits that rule. It is not a service-completion rule and is not universally a tax point; preserve pickup proof, actor, location, component, and goods identity. |
| 11. Merchant handoff to courier | Conditional/otherwise UNKNOWN | Handoff may coincide with goods dispatch or transfer of control, but the event label alone does not prove that and does not complete a service by default. Preserve handoff time, component, and courier acceptance. |
| 12. Delivery to customer | Conditional by component | Delivery can be the actual placing-at-disposal event for goods, or evidence of completed performance for a separately supplied delivery service, where the classification and contract support that result and no earlier applicable event occurred. Preserve delivery confirmation, time, component, location/precision, and order linkage. |
| 13. Invoice issuance | Conditional, potentially advancing | An invoice issued before another applicable event can be the earliest statutory event under G1 Article 23 as applicable. Preserve issuer, invoice number, issue time, TIN, tax period, raw payload, component allocation, and whether it is merchant invoice or provider invoice. |
| 14. Cancellation before supply | No supply tax point unless an earlier invoice/payment event already occurred | Cancellation does not itself create a supply. Check whether an invoice or actual advance payment already created a tax point. Preserve cancellation time, reason, actor, and prior events. |
| 15. Cancellation after payment | Does not erase an earlier payment tax point | The earlier advance/payment consequence remains; preserve cancellation and payment evidence. Credit-note/refund treatment is a later legal/accounting action, not a re-dating of the original event. |
| 16. Refund after supply | No new sale tax point | Refund/correction may require a credit note or other prescribed document under the applicable facts. Preserve original tax point and refund/correction evidence; do not replace the original date. |
| 17. Platform settlement/reconciliation | No for underlying customer sale | Settlement aggregates and reconciles amounts. It is not the customer's supply event and must not replace the earlier tax point. Preserve settlement period, statement, order links, and components. |
| 18. Platform remittance to merchant | No for underlying customer sale | Remittance is a later transfer/clearing event. It can evidence receipt by the merchant for a platform fee/receivable analysis, but not the meal's supply date. Preserve remittance time and bank/provider references. |
| 19. Webhook received by AWJ | No | This is AWJ observation time only. Preserve it for audit/latency; never use it as legal tax-point time. |
| 20. AWJ financial posting time | No | Posting is an internal accounting event after proof. Preserve it separately; it must not become the tax point merely because posting is late. |

## 6. Direct answers to the specific questions

**C — Merchant acceptance:** Rejected as a universal rule. No ZATCA source
reviewed makes acceptance of an online order itself the goods tax point.
Acceptance may be evidence in a particular contract, but AWJ needs the
contract plus the statutory mapping; otherwise it is `UNKNOWN`/non-authority.

**D — Preparation:** Rejected as a universal rule. Preparation is not the
general goods event in G1 Article 23. For a service it may support a factual
performance timeline, but no reviewed source makes preparation alone the
universal completion event.

**E — Pickup/handoff:** Conditionally possible only where it is the applicable
dispatch/transport or transfer event under G1 Article 23 for a goods
component, and not as a substitute for the service-completion rule in Article
23(2)(d). Provider labels alone are insufficient.

**F — Delivery:** Conditionally possible when delivery places a goods
component at the customer's disposal, or completes a separately supplied
service where the classification and evidence support that result. It is not
automatically the tax point and delivery is not presumed to be a separate
service.

**G — Platform payment:** An actual advance received can advance the tax point;
authorization is not equivalent to receipt. Capture is not enough without
evidence of actual receipt or the legally relevant deemed-receipt/agent fact.
Platform collection as agent must be analyzed under the contract and Z5; the
platform's collection does not by itself make the platform the meal supplier.

**H — Early invoice:** Yes, invoice issue can advance the tax point where the
applicable G1 Article 23 rule applies. Invoice issue does not determine
supplier identity or cure missing merchant/platform role evidence.

**I — Settlement/remittance:** No for the underlying customer sale. Use only as
later clearing/remittance evidence unless a separate supply is being analyzed.

**J — Late webhook:** Use the legally relevant historical timestamp from the
provider/payment/merchant invoice evidence, together with its source and
precision. `webhook_received_at` and `AWJ_ingested_at` are audit timestamps,
never substitutes.

**K — Order before supply:** Wait for the applicable proof of actual supply,
actual advance receipt, or earlier valid invoice/dispatch event, as selected by
the versioned policy. An order or Hub state alone is insufficient.

**L — Advance then cancellation:** Preserve the advance tax point and analyze
the cancellation/refund/credit-note consequence under the applicable VAT rules.
Do not simply mark the order as never taxable or move the tax point to the
refund date.

**M — Incomplete/contradictory timestamps:** Keep all raw values, mark the tax
point unresolved, and block financial posting until authoritative evidence
resolves the conflict. A provider correction is a new versioned fact, not a
silent mutation of posted history.

## 7. HungerStation application

P1 still supports the ordinary published restaurant relationship described in
the prior AWJ evidence: the restaurant sells the menu items and provides the
customer tax invoice; HungerStation may collect electronic payments; balances
are later reconciled/transferred; HungerStation separately invoices the
restaurant for amounts/fees. This is provider evidence, not Saudi law and not
a named merchant's signed agreement.

What can be said:

- Customer order, platform receipt, merchant acceptance, preparation, ready,
  pickup, handoff, and delivery are distinct facts. P1 does not establish that
  any one is the Saudi VAT tax point.
- The restaurant invoice is material evidence of invoice issue if the merchant
  actually issued it, but the invoice's raw issue time and issuer/TIN must be
  obtained. P1 does not prove when the invoice is generated or delivered in the
  API flow.
- Electronic collection and later reconciliation/remittance are separate
  facts. P1 does not prove whether a particular card capture is receipt by the
  merchant, receipt by HungerStation as agent, or merely an authorization.
- Settlement is not the meal supply date merely because the terms describe a
  later reconciled balance.

Before a HungerStation configuration could be considered, AWJ still needs:

1. API payload examples/contract definitions for order-created, accepted,
   ready, picked-up, delivered, cancelled, paid/captured, refunded, and
   invoice-issued events;
2. signed or accepted merchant terms and the merchant's VAT registration
   status at the relevant supply date;
3. payment evidence identifying authorization, capture, actual receipt,
   recipient/agent, and amount allocation;
4. delivery/handoff proof and the provider's event correction/replay rules;
5. the merchant invoice payload or immutable invoice reference and issue time;
6. configuration for meal versus delivery supply and any merchant/platform
   discount funding.

No HungerStation operational event is selected as tax point by this report.

## 8. Other-provider UNKNOWN matrix

This is a narrow reuse of Pass 6 evidence, not a new provider investigation.

| Provider | Tax-point conclusion in this pass | Missing evidence |
|---|---|---|
| Jahez | `UNKNOWN`. Customer terms/payment language does not prove seller, invoice issuer, or payment receipt semantics. | Accepted merchant agreement, VAT role, invoice payload, payment and delivery event definitions. |
| Keeta | The published KSA user terms say the user buys from the merchant, the merchant provides the order tax invoice, and Keeta invoices its fees; Keemart is stated differently. This is not a signed merchant tax-point agreement. Tax-point event remains `UNKNOWN`. | Merchant agreement, order-type distinction, actual invoice/payment payloads, supply/delivery semantics. |
| Mrsool | `UNKNOWN` for a restaurant sale. Existing courier terms do not prove the restaurant's sale or invoice. | Restaurant/store agreement, invoice issuer/TIN, payment and delivery evidence. |
| Ninja | `UNKNOWN`. Consumer terms identify a merchant/item provider and payment collection language but do not establish tax invoice responsibility or timing. | Merchant agreement, invoice payload, actual receipt and supply events. |
| The Chefz | `UNKNOWN`. User terms saying an invoice is issued by The Chefz do not distinguish principal billing from billing on behalf of a merchant. | Merchant agreement, invoice TIN/role, payment receipt, supply event, delivery evidence. |

No provider in this matrix is enabled or treated as a tax-point exception.

## 9. Minimum historical snapshot recommendation

The minimum future immutable snapshot must separate **raw evidence** from the
**derived tax point**.

Raw evidence, per relevant event:

- provider/platform and merchant/store/branch identity;
- provider order ID, event ID, event type, sequence/version, and raw payload
  reference/checksum;
- original provider timestamp exactly as received;
- parsed instant, explicit timezone/offset interpretation, and normalization
  metadata;
- precision (`date`, minute, second, fractional second, or unknown);
- source (`provider API`, webhook, merchant invoice, payment processor,
  settlement statement, delivery proof), received-at, and ingestion attempt;
- payment authorization, capture, actual receipt/credit, recipient, amount,
  currency, and provider reference as separate facts;
- merchant invoice number, issuer/TIN, issue time, document type, and raw
  invoice reference;
- dispatch/pickup/handoff/delivery proof and event correction status;
- cancellation/refund/correction references, without deleting original facts;
- merchant VAT status at supply and the effective financial-role configuration
  version.

Derived result:

- `tax_point_status`: `unknown`, `known`, `proven`, or an equivalent explicit
  state whose semantics are documented, at order and component/result level;
- one or more derived tax-point results, each keyed by stable order component
  or supply reference, classified goods/service, allocated taxable amount and
  currency, selected date/instant, and legal timezone basis. The result set
  covers customer-sale components only; a platform B2B fee has a separate
  result and gate;
- each result's selected event kind and raw evidence reference(s). A partial
  advance creates a result only for the proven allocated amount/component; it
  must not mark the whole order or remaining value proven;
- tax-point policy ID/version and evidence version;
- derivation timestamp and actor/system version;
- conflict/override reason if a corrected authoritative event superseded an
  earlier unposted interpretation.

Multiple proven results must also have a future canonical-reporting projection
decision. A single order-level `invoice_date` and whole-order VAT posting must
not collapse allocated results whose legal tax points fall in different VAT
periods. The future implementation must either split the legally relevant tax
documents/postings by component/period or use an approved canonical
component-level reporting authority that preserves each allocated result,
amount, and tax period. Merely proving each result in the snapshot is not
enough if the posting/reporting layer still reports the full tax amount under
one date.

The raw provider value must never be replaced by `now()`, posting time, or a
new provider value without retaining the prior version. A posted invoice's
historical result is not reinterpreted by later configuration changes.

## 10. Timezone and temporal safety

Saudi VAT reporting uses a legal date/time concept, while external systems may
send UTC, Saudi local time, an explicit offset, or an ambiguous local string.
AWJ should preserve all of the following:

- the original string/number and provider format;
- the parsed instant in a canonical representation;
- the stated offset/timezone, or an explicit `timezone_unknown` status;
- the conversion rule and parser/normalization version;
- source, receipt time, and precision.

An offset-less value must not be silently interpreted as UTC or Asia/Riyadh.
If the timezone can change the legal calendar date, tax-point status is
`UNKNOWN` until resolved by provider documentation or authoritative evidence.
Display conversion is presentation; it must not mutate the legal historical
instant or calendar-date basis.

## 11. Idempotency, late events, and corrections

Future implementation must preserve these invariants:

- duplicate event: one evidence identity and no second tax-point effect;
- partial advance: allocate the proven tax point to the paid amount/component;
  do not collapse multiple dates or amounts into one order-level result;
- out-of-order event: retain the event and recompute only an unposted,
  versioned derived result when policy permits;
- late delivery confirmation: never use its receipt time as the event time;
- corrected provider timestamp: retain original and corrected values, mark the
  conflict/resolution, and require review if the legal date changes;
- conflicting timestamps: fail closed; no earliest-event guess from arrival
  order;
- replay: idempotent evidence ingestion and no duplicate invoice/payment;
- webhook after posting: audit the late fact and route to the prescribed
  correction/credit-note process; do not silently rewrite the posted invoice;
- a provider correction after posting cannot authorize a reinterpretation of
  historical accounting without a separately approved correction document.

## 12. Posting-gate implication

The future imported-order posting gate should require an explicit equivalent
of:

`tax_point_status = proven` for every required customer-sale component/result
and allocated taxable amount, not merely once for the order header, plus a
proven canonical-reporting projection for every result. The separate platform
B2B fee remains outside this customer-sale gate and requires its own later
fee/invoice/evidence gate.

alongside the existing role, invoice-responsibility, collection-role, and
merchant-VAT-status-at-supply requirements. `known` may be useful as an
intermediate operational state, but it must not authorize financial posting
unless its exact evidence standard is defined to be equivalent to `proven`.

This is a future requirement only. `DeliveryFinancialRoleGate` is unchanged;
`posting_authorized` remains `false`; no imported order is authorized here.

## 13. OD-DG-3-TAX-POINT

**Recommendation: OPTION D — hybrid universal principle plus versioned,
evidence-backed provider policy, with UNKNOWN blocking.**

Universal:

- apply G1 Article 23 for both classified goods and services, using the
  applicable goods or service subparagraph, with Saudi implementing
  provisions/guidance applied to the facts;
- classify every customer-sale component as goods, service, or `UNKNOWN`
  before selecting the corresponding rule; keep a platform B2B fee outside
  this customer-sale gate and under its own later fee gate;
- separate supply, invoice issue, payment receipt, advance payment, delivery,
  platform fee, settlement, and remittance;
- preserve actual historical event times and retain raw evidence;
- reject unknown role, supply, invoice, payment, timezone, or contradictory
  evidence rather than defaulting.

Provider/merchant-specific:

- whether an event is dispatch, placing at disposal, service performance/
  completion under Article 23(2)(d), actual receipt, or invoice issue for each
  customer-sale component;
- whether a provider collects as agent, principal, or merely processes payment;
- meal versus delivery supply and invoice responsibility;
- effective policy version and accepted merchant agreement;
- correction/refund evidence and payment-recipient semantics.

Required evidence is the combination of G1's applicable Article 23 rule,
current Saudi implementing material, the effective merchant/provider
agreement, customer-sale component classification, merchant VAT status at
supply, raw event and payment/invoice evidence, allocated taxable amounts,
canonical-reporting projection, and a deterministic policy derivation. The
platform B2B fee follows its own later evidence and posting gate. If any
material element for the customer sale is absent or contradictory, posting
remains blocked.

### Owner decision required

Safwan must approve or reject `OD-DG-3-TAX-POINT` as written. Approval would
approve the architecture/documentation decision only; it would not authorize
production implementation, imported-order posting, VAT recognition, provider
enablement, or deployment.

## 14. Explicit out-of-scope implementation

This pass created no migrations, schema/model fields, gate changes,
`InvoiceService` changes, VAT calculations, invoices, payments, journals,
inventory actions, POS changes, connectors, webhooks, settlements,
reconciliation, commission, refunds, credential changes, API changes, deploys,
or production behavior.

## 15. Next Horizon task recommendation

After owner approval, create a documentation/architecture follow-up that
freezes the evidence contract and policy vocabulary, then a separately
authorized implementation task for an immutable raw-event/tax-point evidence
snapshot and a posting-gate check. That task must first obtain one named
merchant's accepted HungerStation agreement, payment evidence, invoice
payload, and event semantics. It must remain blocked for any provider whose
role or tax-point evidence is still `UNKNOWN`.

**PRE_MERGE_REVIEW: PASS for the documentation scope only.**
No merge or deploy is authorized by this report.
