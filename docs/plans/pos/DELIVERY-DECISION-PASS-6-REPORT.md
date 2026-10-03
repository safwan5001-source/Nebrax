# DELIVERY-DECISION-PASS-6 — DG-3 posting boundary

**Task:** DELIVERY-DECISION-PASS-6
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Nature:** evidence / architecture / documentation only. No production code, migration, VAT implementation, invoice posting change, commission, settlement, reconciliation, refund, connector, or webhook.
**Base SHA (`origin/main` at start):** `48051f2cc7d5d2c7fc50d45892aa29fe53d643fa`
**That SHA is the squash of PR #1205 (DELIVERY-DECISION-PASS-5).** OD-DG-8-IMPORT is already accepted there as Option B. This file does not embed its own commit hash.

**DG-3 is not closed.** No platform is accepted here as agent, principal, or collector. The recommendation is a fail-closed posting gate. It becomes a decision only if Safwan accepts **OD-DG-3-POSTING-GATE**.

Not reopened: OD-DG-8, OD-DG-8-IMPORT, OD-DG-9-POS, OD-DG-9-HUB, OD-DG-6, OD-DG-6-TRIGGER, OD-HUB-STATES, OD-HUB-IDENTITY, DG-1, DG-2, DG-5, or the already shipped simple-collector foundation used by manual POS.

---

## 1. Executive summary

ZATCA's food-delivery rule is general. It is not a finding about HungerStation, Jahez, Mrsool, Keeta, Ninja, or The Chefz. Whether a platform is the seller depends on the contract and on whether the restaurant is VAT-registered. A label in a consumer page is not that proof.

Published terms were found for some platforms. They are not the same model, and none of them is accepted as AWJ's tax role.

| Platform | What this pass can say | Financial posting |
|---|---|---|
| HungerStation | Published restaurant terms (6 Aug 2026): the restaurant sells through the platform and must give the customer a tax invoice. HungerStation invoices the restaurant and later transfers a reconciled balance. | Still disabled |
| Jahez | No merchant contract read. Customer terms and a VAT-group certificate do not prove the role. | Disabled. Role UNKNOWN |
| Mrsool | Courier terms were found. They do not prove the restaurant's sale. | Disabled. Role UNKNOWN |
| Keeta | KSA user terms say the user buys from the merchant, the merchant issues the order tax invoice, and Keeta issues the invoice for its own fees. Keemart is stated differently. Not a signed merchant contract. | Still disabled |
| Ninja | Consumer terms define the merchant as the item provider and say prices include VAT. They do not say who issues the tax invoice. | Disabled. Role UNKNOWN |
| The Chefz | User terms say the user receives an invoice issued by The Chefz. That does not prove principal versus third-party billing. | Disabled. Role UNKNOWN |

A global rule "the merchant is the seller and the platform only collects" is not safe. The safe V1 rule is per provider configuration, default `UNKNOWN`, and `UNKNOWN` blocks the invoice transition.

Operational ingestion, the Delivery Hub, mapping, and storing the frozen commercial snapshot may continue. Creating or posting the canonical invoice may not, until that configuration's role is evidenced and explicitly enabled. This pass does not enable any configuration.

---

## 2. Evidence methodology

| Tier | Used for | Not used for |
|---|---|---|
| 1 | ZATCA guidelines and published provider merchant terms or invoicing statements | Applying a general example to a named platform |
| 2 | Official onboarding or merchant material whose publisher is the platform | Filling gaps in a missing contract |
| 3 | Integration-partner pages | Tax role, invoice duty, or VAT recovery |

Blogs, SEO pages, forums, app screenshots, and "typical commission" articles were not used. A missing public contract is recorded as UNKNOWN. UNKNOWN is the result, not a prompt to guess.

ZATCA says the written contract is not enough if it does not match the actual transaction. A future enablement still needs the merchant's accepted terms and the VAT-registration fact at the time of supply.

---

## 3. ZATCA rules supported by official sources

These are general rules. They are not findings about a named platform.

**Agents Guideline, version one, July 2020**  
https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Agents%20Guideline.pdf

- An agent acting in the principal's name does not become the supplier. The tax invoice shows the principal's name and TIN. The agent may issue it only if the third-party billing conditions are met. The principal keeps the primary VAT liability.
- An agent acting in the agent's own name is deemed to supply the goods or services. The tax invoice shows the agent's name and TIN.
- A disclosed commission is not automatically VAT-exempt. The commercial arrangement decides whether the person is agent or principal.

**Guideline for Persons Liable to Pay Tax in Special Cases — Deemed Suppliers**  
https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Persons-Liable-to-Pay-Tax-in-Special-Cases-Deemed-Suppliers.pdf

- An electronic marketplace facilitates a supply when suppliers offer goods or services to customers through it. Article 47 of the VAT Implementing Regulations.
- If the resident restaurant is VAT-registered, the platform is not the deemed supplier of that meal. The restaurant supplies the customer. The platform's own fee to the restaurant is a separate supply.
- If the resident restaurant is not VAT-registered, the platform is often the deemed supplier of that meal: it is treated as buying and resupplying, and it reports the VAT.
- Delivery can be a different supply from the meal. A platform can be an intermediary for a registered restaurant's meal and a deemed supplier for delivery by a non-registered courier. Some platforms contract drivers themselves and then charge VAT on delivery under the normal rules.
- Payment processing alone, advertising alone, or redirecting the customer to another marketplace is not "facilitating".
- The guide's food-delivery section says platforms often collect the payment, handle complaints, and issue invoices. That sentence describes the class of apps. It does not name these six platforms.
- Refund VAT depends on the facts and on whether the platform was the deemed supplier. The guide does not pick one refund document for every app.
- Substance prevails over a contractual label. The amended Article 47(3) application described in that guide takes effect from 1 January 2026.

**E-invoicing**  
https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Tax-Invoicing-and-Records-under-VAT-Provisions.pdf  
Version 3, May 2026. A resident taxable person, and a person issuing on that person's behalf, must issue the tax invoice electronically under the e-invoicing rules. This does not decide which of the two persons is the supplier.

---

## 4. Provider evidence matrix

| Provider | Seller of the meal | Customer tax invoice | Collection | Commission / fee | Discounts | Refunds | Tier | Confidence | Missing |
|---|---|---|---|---|---|---|---|---|---|
| HungerStation | Published restaurant terms: the restaurant sells the menu items through the platform. | Same terms: the restaurant must attach a tax invoice for the customer. | Terms describe a later transfer of the restaurant's credit balance after reconciliation. That is not proof of every tender. | HungerStation sends the restaurant invoices. The percentage is on the order total excluding VAT. Who may recover the VAT on that fee is not stated. | The restaurant must disclose its own offers. HungerStation may offer customer discounts without asking the restaurant. Who bears those discounts is not stated. | HungerStation refunds the customer for restaurant fault and may deduct that cost from the restaurant. Commission stays on the original order amount. | 1, published restaurant terms, updated 6 Aug 2026. https://hungerstation.com/sa-ar/general-terms-conditions-restaurant-contracts | Medium for those published clauses. Not a signed copy for a named merchant. | Signed acceptance, merchant VAT status, delivery-fee VAT, and the economic payer of HungerStation's own discounts. |
| Jahez | UNKNOWN | UNKNOWN. A privacy line about issuing invoices is a data-processing purpose, not a tax-role clause. | Customer terms say Jahez processes payment and refunds the same method. That does not prove collection for the restaurant versus a resale. | UNKNOWN | UNKNOWN | Customer cancellation/refund text only. Not the accounting document. | Customer terms are not a merchant contract. The VAT-group PDF shows Jahez International is a VAT-group representative. It does not allocate a sale. | Low. Role UNKNOWN. | Merchant agreement: seller, invoice issuer, fee invoice, discount payer. |
| Mrsool | UNKNOWN for a restaurant order. Courier terms are a different contract. | UNKNOWN | Courier terms: the user pays the courier for the goods and service. Not evidence that Mrsool collects a restaurant's sale. | Courier terms: Mrsool sets a commission and collects it from the courier. Not a restaurant commission. | UNKNOWN | UNKNOWN for the restaurant document. | Courier terms: https://s.mrsool.co/terms | Low for the restaurant sale. | Restaurant or store merchant agreement. |
| Keeta | User terms: the user buys the goods from the merchant. Keeta says it acts as the merchant's agent and technology provider for that order. | User terms: the merchant provides the tax invoice for the order. Keeta provides the tax invoice for the platform fees. Keemart is different: Keeta invoices the whole order. | User terms: Keeta processes receipt and payment as agent of the merchant. | Delivery fees are charged unless an exemption applies. No restaurant commission rate or fee-VAT clause was found. | Keeta may run vouchers and offers. The economic payer of a menu discount is not stated. | Refunds can go to the Keeta wallet or the original method. No VAT credit-note rule. | Official KSA user terms, not a merchant contract. https://www.mykeeta.com/contents/user.html?region=SA&locale=en Entity stated there: Keeta Technologies Arabia Limited, CR 1009019761, VAT 312187366900003. | Medium for the published user statement. Low as a merchant VAT position. | Signed merchant agreement matching those sentences, and a rule for Keemart versus restaurant orders. |
| Ninja | Consumer terms define the merchant as the person who provides the item through the app. Not a tax finding. | UNKNOWN | Payment is taken for the order, including by a third-party collector. Not proof of an agency collection. | UNKNOWN | UNKNOWN. A premium plan is mentioned in an FAQ and is not a discount-payer rule. | Consumer text: no exchange, with a FAQ that compensation is possible for a damaged item. Not a tax document. | Consumer terms on https://ananinja.com/sa/en/privacy-policy | Low. Role UNKNOWN. | Merchant contract and invoice issuer. |
| The Chefz | UNKNOWN. Stores display products. That is not a seller finding. | User terms: the user is given an electronic copy of an invoice issued by The Chefz. An agent may also issue on behalf of a principal. The sentence does not choose. | Payment service is mentioned. Agency versus resale is not. | UNKNOWN | Cashback into the app wallet is described. The funding party is not. | Compensation is credited to the wallet. No VAT credit-note rule. | User terms, not a restaurant contract. https://thechefz.co/ar/terms-and-conditions-ar/ Company named there: شركة أفضل الطهاة لتقدم الوجبات, CR 1010996779. A 2021 VAT certificate exists and does not allocate a sale. | Low. Role UNKNOWN. | Merchant contract stating who supplies the meal and whose TIN is on the customer invoice. |

---

## 5. Facts versus assumptions

**Facts**

- ZATCA's result changes when the restaurant is not VAT-registered.
- Meal, delivery, and platform fee can be three different supplies.
- Net settlement is not defined by ZATCA as the selling price.
- HungerStation's published restaurant terms put the customer tax invoice on the restaurant and put HungerStation's fee on a separate invoice to the restaurant.
- Keeta's published user terms split the merchant's order invoice from Keeta's fee invoice, and state a different invoice for Keemart.
- No signed merchant agreement for any of the six is in this repository.

**Not assumed**

- That all six share one role.
- That "agent" in a user page is the VAT result.
- That issuing an invoice proves the issuer is the principal.
- That a commission percentage includes or excludes recoverable VAT.
- That a platform discount is merchant-funded or platform-funded unless the order says so.
- That the manual POS simple-collector posting is automatically correct for an imported order.

---

## 6. Current AWJ invariants

- The invoice customer is not the sales channel. A delivery platform is not automatically `Invoice.partner_id`.
- `platform_collected` clears AR to platform receivable. It does not invent cash or bank.
- Gross sale stays intact. Settlement is a later event. Net settlement is not the sale price.
- `InvoiceService` is the only posting authority. The Delivery Hub projection does not post.
- OD-DG-8-IMPORT: the frozen provider snapshot is the commercial price of an imported order. Discounts need a payer. AWJ does not invent one.
- A posted invoice stays frozen. A correction would be a new document.
- Tenant and branch isolation stay fail-closed.
- Manual POS already uses the bounded simple-collector foundation from Pass 1. This pass does not undo those sales.

---

## 7. Safe V1 architecture

Do not enable one global "merchant sells, platform collects" switch.

Each provider configuration carries its own role. The default is `UNKNOWN`. The imported-order command checks that configuration. `UNKNOWN` rejects the command before `InvoiceService::create`.

Where a later, accepted evidence record says the restaurant is the seller and is VAT-registered, the meal invoice can stay the restaurant's gross snapshot, and the platform fee stays off that invoice. Delivery and the platform fee are not silently folded into the meal. Where the restaurant is not VAT-registered, ZATCA's deemed-supplier rule may put the meal on the platform. AWJ must not post the restaurant as seller in that case until a separate decision says so.

HungerStation's published terms and Keeta's published user terms are evidence for a future decision. They do not flip the flag in this pass.

---

## 8. Capability model

Not a schema and not a migration. A future configuration would need at least:

| Field | Values | Default |
|---|---|---|
| `financial_role_status` | `unknown`, `merchant_seller`, `platform_deemed_supplier`, `platform_principal` | `unknown` |
| `invoice_responsibility` | `unknown`, `merchant`, `platform`, `split_meal_and_fee` | `unknown` |
| `collection_role` | `unknown`, `platform_collects_for_merchant`, `merchant_collects`, `platform_collects_as_seller` | `unknown` |

`split_meal_and_fee` is the only Keeta-terms shape that matches a merchant meal invoice plus a separate fee invoice. It is not a global value. Keemart would be a different configuration if it is ever in scope. It is not in scope now.

No field is implied by the platform logo or by the channel slug.

---

## 9. Fail-closed rules

1. Missing `financial_role_status`, `invoice_responsibility`, `collection_role`, or the merchant's VAT-registration status at the time of supply rejects the financial command. One known field does not waive the others.
2. A role may be set only from evidence for that provider configuration, never copied from another provider.
3. Merchant VAT registration is an input. A non-registered restaurant does not inherit the registered-restaurant path.
4. The command posts the frozen snapshot, not the live catalog, and not the net settlement.
5. An unlabeled discount still rejects, as OD-DG-8-IMPORT already requires.
6. Platform fee VAT is not recovered and is not posted inside the customer invoice.
7. The customer on the invoice is not changed to the platform unless `invoice_responsibility` is an accepted platform-seller value.
8. Manual POS checkout is unchanged.

---

## 10. Allowed while any required tax input is UNKNOWN

- Operational intake, routing, and the Hub state machine.
- Product mapping.
- Storing the frozen commercial snapshot and its checksum.
- Display of the provider order, including logo and name.

---

## 11. Disabled while any required tax input is UNKNOWN

- `InvoiceService::create` and `InvoiceService::post` for that imported order.
- VAT recognition on that transition.
- Treating the platform as the invoice customer or as the seller.
- Commission, fee, and fee-VAT posting.
- Settlement and reconciliation.
- A refund or credit note caused by the provider order.
- Using net settlement as revenue, discount, or VAT.

---

## 12. Effect on the imported-order transition

OD-DG-6-TRIGGER still describes the only future command. OD-DG-8-IMPORT removed the price-authority block. DG-3 still blocks enabling it.

The minimum evidence before that command may run for one configuration is:

1. The merchant's accepted terms, or the published standard terms that merchant accepted, stating who sells the meal and who issues the customer tax invoice.
2. The merchant's VAT registration status at the time of supply.
3. A separate answer for delivery and for the platform fee, if those amounts are in the order.
4. A snapshot that already separates merchant-funded and platform-funded discounts.
5. An explicit configuration value, not a default, and an owner acceptance of that value.

Until then the command stays unbuilt and, once built, stays rejected for that configuration.

---

## 13. Effect on commission and settlement

DLV-COMMISSION-1 and DLV-SETTLEMENT-1 stay blocked. A sentence that a percentage is calculated excluding VAT is not permission to post the fee or to recover its VAT. The platform's invoice to the merchant is the evidence for that fee, and it is a later settlement event. It is not part of the customer sale.

---

## 14. Evidence still required at onboarding

For every merchant configuration that should later post:

- The signed or accepted merchant agreement, kept as evidence.
- VAT registration number, or an explicit non-registered status.
- Who issues the customer tax invoice, and whose TIN it carries.
- Whether delivery is the platform's supply, the courier's supply, or the restaurant's supply.
- The platform's fee invoice to the merchant, if commission will ever be posted.
- The payer of each discount type that merchant uses.
- The refund document the merchant must keep when the platform refunds the customer.

---

## 15. Owner decision required

**OD-DG-3-POSTING-GATE — not accepted in this PR.**

Please accept or reject this gate only:

> An imported delivery order may not become a canonical invoice unless that provider configuration has every one of these set from evidence, and none of them is `UNKNOWN`: `financial_role_status`, `invoice_responsibility`, `collection_role`, and the merchant's VAT-registration status at the time of supply. Clearing only the role field does not authorize posting. The default for HungerStation, Jahez, Mrsool, Keeta, Ninja, and The Chefz is `UNKNOWN` on every one of those inputs. Published terms do not flip any flag. The Hub, mapping, and the frozen snapshot may continue. Commission, settlement, fee VAT, and provider refunds stay disabled. Manual POS is unchanged.

This pass does not ask you to declare any platform an agent, a principal, or a collector. DG-3 stays open after the gate, until a later decision accepts one configuration's evidence.

No production deploy.
