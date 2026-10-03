> **Evidence precedence notice (2026-10-03):** This document is a preliminary FNP evidence pass. For the current FNP Saudi storefront, use `FNP_DEEP_EVIDENCE_1_REPORT.md` and `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md` from PR #1181 as the higher-authority evidence where they verify, correct, or supersede statements here. In particular, `checkout.fnp.sa` is a live legacy Shopify surface; evidence about current storefront behavior should prefer direct observations from `www.fnp.sa` and the public APIs used by that storefront. See §36 "Corrections & deltas vs prior AWJ FNP passes" in the deep report.

# FNP Flowers & Gifts Evidence Pass — Terms, Privacy, Failed Delivery & Lifecycle

**Status:** External Evidence Pass — Documentation only  
**Date:** 2026-10-03  
**Repository:** `safwan5001-source/Nebrax`  
**Branch:** `docs/fnp-flowers-gifts-evidence-pass`  
**Parent evidence:** `FNP_FLOWERS_GIFTS_EVIDENCE_PASS.md` and `FNP_FLOWERS_GIFTS_EVIDENCE_PASS_2_CHECKOUT_OPERATIONS.md`  
**Scope:** Terms/policy evidence, privacy/marketing consent, delivery failure/exception behavior, order acceptance, redirection cutoffs, substitution, lifecycle implications, and remaining unresolved gaps.

> Evidence only. No implementation authorization.

---

## 1. Order submission and acceptance are distinct

### OBSERVED

FNP's Shipping Policy states that after receiving an order/application it may:

- accept;
- refuse;
- cancel all or part;
- request additional verification or information.

For gift orders, FNP asks for recipient name and exact shipping address. The policy also states that the order is not accepted until shipping information for the accepted portion is sent.

### Evidence

- https://checkout.fnp.sa/en/policies/shipping-policy

### AWJ implication

This strengthens the distinction:

```text
Checkout submission
!=
Operational acceptance
!=
Payment state
!=
Fulfillment state
!=
Invoice state
```

AWJ should preserve independent lifecycle dimensions instead of one combined status.

---

## 2. Manual-review / verification gate

### OBSERVED

FNP reserves the right to request additional verification/information before accepting an order.

### AWJ implication

A mature gifting workflow may need a review state for exceptional orders, for example:

- high-value orders;
- money arrangements;
- suspicious payment;
- incomplete recipient information;
- corporate/custom orders;
- unusual delivery requests.

This does **not** authorize a fraud engine. It only establishes the need to leave architectural room for a review gate.

---

## 3. Whole or partial cancellation by merchant

### OBSERVED

FNP's Shipping Policy expressly allows cancellation of an order in whole or in part. When FNP cancels a portion, its stated remedy is refund/non-charge for the cancelled portion.

### Evidence

- https://checkout.fnp.sa/en/policies/shipping-policy

### AWJ implication

This is strong evidence that line-level or partial-order adjustment can matter in gifting commerce.

AWJ must evaluate partial cancellation against the existing independent lifecycles for:

- Commerce Order;
- Payment;
- Fulfillment;
- Invoice;
- Return;
- Refund;
- Credit Note.

Do not implement partial cancellation as a simple line delete after confirmation.

---

## 4. Refund destination

### OBSERVED

For FNP-initiated cancellation, the shipping policy states refund may return to the original credit/debit card or bank account, or the cancelled amount may simply not be charged.

### AWJ implication

Refund and cancellation are distinct operations.

A cancellation may result in:

- no capture;
- partial capture avoided;
- refund after capture.

AWJ should preserve payment-state-aware cancellation behavior.

---

## 5. Customer-initiated cancellation remains unresolved

### OBSERVED

The public Shipping Policy evidence located in this pass does **not** fully establish customer cancellation windows for:

- flowers;
- cakes/food;
- personalized products;
- custom products;
- prepared orders;
- dispatched orders.

### AWJ implication

No customer cancellation policy should be copied from incomplete evidence.

Keep:

`FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1`

as an explicit external evidence gate.

---

## 6. Address and redirect cutoff

### OBSERVED

Multiple FNP product pages state that once an order is prepared for delivery it cannot be redirected to another address.

Some pages state delivery details become final once the order is placed or confirmed.

### Evidence

- https://www.fnp.sa/en/gift/personalised-frame-love-for-mom
- https://checkout.fnp.sa/en/products/special-treats-hamper
- https://www.fnp.sa/en/gift/luxury-floral-n-chocolate-arrangement-baby-girl-congratulations
- https://checkout.fnp.sa/en/products/reasons-of-love-engraved-photo-frame

### AWJ implication

Recipient/address editing should be lifecycle-gated.

Candidate conceptual cutoff:

```text
SUBMITTED
  ↓
ACCEPTED
  ↓
PREPARATION_STARTED
  ↓
READY_FOR_DISPATCH
  ↓
OUT_FOR_DELIVERY
  ↓
DELIVERED
```

The exact statuses are not approved; the key requirement is an explicit editability boundary.

---

## 7. Delivery delay / exception behavior

### OBSERVED

FNP product pages state that delivery can rarely be delayed by circumstances such as:

- traffic congestion;
- route issues;
- remote delivery address;
- weather.

Some pages say the customer will be notified in advance when such delays occur.

### Evidence

- https://checkout.fnp.sa/en/products/reasons-of-love-engraved-photo-frame
- https://www.fnp.sa/en/gift/graduation-celebration-gift-n-balloon-box

### AWJ implication

Future fulfillment should support exception states/details rather than silently missing a promised slot.

Potential fields/concepts:

- exception reason;
- original promised window;
- revised ETA;
- notification state;
- operator note;
- customer-contact audit.

---

## 8. Failed delivery is still not fully proven

### OBSERVED

Public evidence clearly covers delay and redirect restrictions.

### UNKNOWN

This pass did not find authoritative public evidence for the exact FNP workflow when delivery fails because:

- recipient cannot be reached;
- recipient refuses;
- address is inaccessible;
- recipient is absent;
- phone is wrong;
- repeated delivery attempt is required.

### AWJ implication

Do not invent failed-delivery policy.

Recommended future task:

`FLOWERS-FAILED-DELIVERY-EVIDENCE-1`

It should research:
- retry attempts;
- extra fee;
- return to shop;
- perishables disposal;
- customer notification;
- refund eligibility;
- re-delivery;
- proof of attempted delivery.

---

## 9. "No Address, No Worries" remains operationally under-specified

### OBSERVED

FNP publicly markets "No Address, No Worries", and other public copy states that recipient phone details can be used when the sender lacks the address.

### UNKNOWN

The public evidence reviewed does not expose:

- who contacts the recipient;
- channel used;
- consent wording;
- whether sender identity is revealed;
- expiration/timeout;
- what happens if recipient does not respond;
- how delivery area eligibility is confirmed;
- whether payment happens before address collection.

### AWJ implication

This remains a dedicated contract/evidence task:

`FLOWERS-RECIPIENT-ADDRESS-1`

It must be solved before implementation.

---

## 10. Substitution can be customer-visible or merchant-executed

### OBSERVED

FNP pages show two patterns:

- some language says a substitution option may be offered;
- other pages say FNP may need to substitute on the customer's behalf without informing them to preserve timely delivery.

### Evidence

- https://www.fnp.sa/en/gift/smart-appreciation-teacher-mini-cake
- https://checkout.fnp.sa/en/products/special-treats-hamper
- https://checkout.fnp.sa/en/products/reasons-of-love-engraved-photo-frame

### AWJ implication

Substitution is not one boolean.

Potential policy dimensions:

```text
Substitution mode:
- NEVER
- ASK_CUSTOMER
- MERCHANT_ALLOWED_WITH_RULES

Matching constraints:
- same category
- same color/theme
- equal/higher value
- quantity tolerance
- brand restrictions
- allergen restrictions

Notification:
- required
- optional
- post-fact notification
```

No exact enum is approved.

---

## 11. Food safety makes substitution more sensitive

### OBSERVED

FNP cake pages expose allergens such as flour/wheat, egg, dairy, and facility handling of nuts.

### Evidence

- https://www.fnp.sa/en/gift/funky-sisters-cake

### AWJ implication

For food products, substitution cannot safely preserve only price and appearance.

It may need to preserve or revalidate:

- allergens;
- dietary claims;
- flavor;
- size/servings;
- food category;
- preparation constraints.

This strengthens the case for domain-aware substitution rules.

---

## 12. Product-specific shelf/freshness guidance

### OBSERVED

FNP product pages include care windows such as:

- cake consume within 48 hours;
- some cake pages: consume within 1–3 days;
- balloon float-time guidance such as 8–10 hours;
- food/package expiration-date references.

### Evidence

- https://checkout.fnp.sa/en/products/mba-garduate-2026-celebration-cake
- https://www.fnp.sa/en/gift/smart-appreciation-teacher-mini-cake
- https://www.fnp.sa/en/gift/graduation-celebration-gift-n-balloon-box
- https://checkout.fnp.sa/en/products/special-treats-hamper

### AWJ implication

Flowers & Gifts needs richer product handling metadata/content than generic retail.

Potential future structured concepts:

- consume-by guidance;
- storage instructions;
- handling duration;
- fragile/perishable flags;
- product-family care profiles.

Do not confuse consumer guidance with inventory-expiry accounting without a separate inventory design.

---

## 13. Temperature-controlled delivery is repeatedly explicit

### OBSERVED

FNP repeatedly states use of temperature-controlled delivery vehicles for cakes and mixed gift products.

### Evidence

- https://checkout.fnp.sa/en/products/mba-garduate-2026-celebration-cake
- https://checkout.fnp.sa/en/products/special-treats-hamper
- https://www.fnp.sa/en/gift/funky-sisters-cake

### AWJ implication

Delivery service selection may eventually need capability matching:

```text
Order requires:
- temperature_controlled
- fragile
- upright
- food_safe
- oversized
...

Fulfillment method provides:
- matching capabilities
```

This belongs to fulfillment/shipping architecture, not theme code.

---

## 14. Privacy: collected data categories

### OBSERVED

FNP Corporate Privacy Policy describes collecting personal/delivery-related data such as:

- name;
- email;
- phone;
- billing address;
- payment-method-related details handled with a secure payment provider;
- purchase behavior;
- communications/messages;
- order/tracking-related information.

It also states some browsing is possible without account registration, while some activities such as placing an order require registration on that corporate policy surface.

### Evidence

- https://corporate.fnp.sa/en/privacy-policy/

### AWJ implication

Flowers & Gifts data is privacy-sensitive because one order may contain personal data for **two or more people**:

- purchaser;
- sender display identity;
- recipient;
- possibly corporate recipients;
- support communications.

AWJ should classify and retain recipient/contact data deliberately.

---

## 15. Privacy: recipient data is especially sensitive operationally

### INFERRED FROM OBSERVED MODEL

Gift purchases naturally cause the purchaser to provide information about a third-party recipient.

### AWJ implication

AWJ must not treat recipient data as if the recipient personally created an account.

Potential requirements:

- purpose limitation;
- restricted staff visibility;
- retention policy;
- masking where possible;
- audit access;
- secure public tracking;
- consent/notification review for no-address contact flows.

Saudi PDPL requirements must be researched from authoritative Saudi sources before final policy.

---

## 16. Marketing communications and opt-out

### OBSERVED

FNP Corporate Privacy Policy states it may send information about:

- products;
- services;
- special deals;
- promotions;

and says users are offered an option to opt out.

It separately describes newsletter/press-release use of name/email.

### Evidence

- https://corporate.fnp.sa/en/privacy-policy/

### AWJ implication

AWJ Growth/CRM must separate:

```text
Transactional communication
!=
Marketing communication
```

Marketing consent/opt-out should not be inferred merely from checkout or recipient data.

---

## 17. Recipient data must not become a marketing lead automatically

### AWJ decision implication

Even if a purchaser provides a recipient phone number for delivery, that recipient should not automatically become a marketing subscriber.

This is an AWJ privacy principle that should be validated against Saudi PDPL and marketing rules.

---

## 18. Privacy updates / correction / deletion

### OBSERVED

FNP Corporate Privacy Policy describes contacting support to correct, update, or delete personal/delivery information.

### Evidence

- https://corporate.fnp.sa/en/privacy-policy/

### AWJ implication

Consumer-account tooling should eventually support privacy operations without corrupting immutable accounting/order history.

Deletion requests may require:

- deleting profile data;
- anonymizing optional personal fields;
- retaining legally required transaction records;
- preserving audit/accounting documents.

This needs a dedicated privacy-retention design, not ad hoc row deletion.

---

## 19. Payment data boundary

### OBSERVED

FNP Corporate Privacy Policy states required purchase details may be submitted directly to a secure payment provider and says card details are not stored by FNP in the described context.

### AWJ implication

AWJ should continue to avoid raw card-data storage and rely on approved gateway/tokenized payment integrations.

This is shared Commerce/security architecture, not Flowers-specific.

---

## 20. Support is part of the transaction experience

### OBSERVED

FNP exposes contact support with phone/email/contact form, and gifting pages mention support for order status and purchase issues.

### Evidence

- https://checkout.fnp.sa/pages/contact-us
- https://www.fnp.sa/en/gifts-al-khobar
- https://www.fnp.sa/en/gifts-for-him

### AWJ implication

Flowers & Gifts operations likely need a merchant/admin customer-support surface connected to orders.

Potential later capability:

- search order by reference/phone;
- update allowed recipient details before cutoff;
- resend notifications;
- record support note;
- escalate delivery exception.

This should reuse AWJ permissions and audit trails.

---

## 21. Out-of-stock is explicit at product level

### OBSERVED

FNP product pages can show "currently out of stock" rather than silently hiding every unavailable product.

### Evidence

- https://www.fnp.sa/en/gift/personalised-photo-mug

### AWJ implication

AWJ storefront needs explicit policy for unavailable products:

- hide;
- show as out-of-stock;
- allow backorder only if explicitly supported;
- show alternative/substitute products.

The existing Commerce inventory reservation/ATS policy remains authoritative.

---

## 22. Next-day is another service level

### OBSERVED

FNP gift pages mention Next-day delivery alongside midnight and same-day.

### Evidence

- https://www.fnp.sa/en/gifts-for-him
- https://www.fnp.sa/en/plants

### AWJ implication

Delivery service level should not be a closed florist-only list designed solely around today's FNP labels.

Use a finite extensible service-level contract capable of merchant configuration/policies.

---

## 23. Product safety warnings

### OBSERVED

Balloon product guidance includes a choking hazard warning for children under eight years old.

### Evidence

- https://www.fnp.sa/en/gift/graduation-celebration-gift-n-balloon-box

### AWJ implication

Catalog content may need reusable **Safety / Warning** blocks, separate from care instructions.

Other gift sectors may also need:
- age warnings;
- allergen warnings;
- fragile handling;
- battery safety;
- plant toxicity.

This is better as a general catalog-content capability.

---

## 24. Locale and legal/business identity in storefront footer

### OBSERVED

FNP storefront surfaces show:

- business identity;
- commercial registration number;
- VAT number;
- Terms and Conditions;
- Privacy Policy.

### Evidence

- https://checkout.fnp.sa/en/a/wishlist
- https://checkout.fnp.sa/products/national-day-95-cupcakes

### AWJ implication

AWJ Storefront trust/legal footer should support:

- legal business name;
- CR;
- VAT number;
- contact details;
- policy links;
- required regulatory identity.

This aligns with the existing AWJ Store Business Identity work and should remain shared Storefront capability.

---

## 25. Remaining policy evidence gaps

The following remain unresolved after this pass:

1. Exact customer-initiated cancellation windows.
2. Return/refund eligibility for fresh flowers.
3. Return/refund eligibility for cakes/food.
4. Return/refund eligibility for personalized/custom goods.
5. Failed delivery and redelivery policy.
6. No-address recipient contact workflow.
7. Full order-status vocabulary.
8. Proof-of-delivery model.
9. Coupon stacking and exclusion priority.
10. Abandoned-cart/checkout behavior.
11. Exact privacy policy governing the consumer storefront vs corporate surface.
12. Saudi legal/compliance requirements for recipient third-party data.
13. Money-gift accounting/legal treatment.
14. Food compliance requirements.
15. Exact payment-provider behavior and refund SLA.

None should be guessed.

---

## 26. Stronger lifecycle model suggested by evidence

This is a conceptual AWJ analysis, not an approved state machine:

```text
Cart
↓
Checkout Submitted
↓
Verification / Review? ──→ Rejected
↓
Accepted / Confirmed
↓
Preparation
↓
Ready for Dispatch
↓
Out for Delivery
↓
Delivered

Side paths:
- Cancellation before/after capture
- Partial cancellation
- Delivery exception
- Failed delivery
- Substitution
- Refund
```

Payment and invoicing remain independent lifecycle dimensions.

---

## 27. New recommended evidence tasks

Add these to the vertical evidence backlog:

- `FLOWERS-FAILED-DELIVERY-EVIDENCE-1`
- `FLOWERS-PRIVACY-RECIPIENT-DATA-1`
- `FLOWERS-FOOD-COMPLIANCE-EVIDENCE-1`
- `FLOWERS-SAFETY-CONTENT-1` (can potentially collapse into shared Catalog work)

Existing gates remain:

- `FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1`
- `FLOWERS-RECIPIENT-ADDRESS-1`
- `FLOWERS-SUBSTITUTION-EVIDENCE-1`
- `FLOWERS-MONEY-GIFT-EVIDENCE-1`
- `FLOWERS-BOM-EVIDENCE-1`

---

## 28. Research status after three passes

The FNP evidence is now broad enough to support an AWJ capability-gap analysis across:

- catalog;
- merchandising;
- occasions;
- recipients;
- personalization;
- gift identity;
- delivery service levels;
- same-day and earliest promise;
- location-aware availability;
- substitution;
- add-ons;
- bundles;
- money gifts;
- corporate gifting;
- account/saved recipients;
- wishlist;
- order tracking;
- promotions;
- order acceptance;
- partial cancellation;
- privacy/marketing;
- product care;
- safety/allergens;
- delivery exceptions.

The remaining unanswered items are now mostly **policy/legal/operational-depth questions**, not basic storefront discovery gaps.

That means the next productive step after this pass is to inspect AWJ itself and build the reuse/gap matrix before collecting even more surface-level FNP features.
