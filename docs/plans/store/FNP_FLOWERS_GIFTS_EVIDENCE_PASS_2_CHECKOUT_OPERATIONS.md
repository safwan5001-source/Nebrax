> **Evidence precedence notice (2026-10-03):** This document is a preliminary FNP evidence pass. For the current FNP Saudi storefront, use `FNP_DEEP_EVIDENCE_1_REPORT.md` and `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md` from PR #1181 as the higher-authority evidence where they verify, correct, or supersede statements here. In particular, `checkout.fnp.sa` is a live legacy Shopify surface; evidence about current storefront behavior should prefer direct observations from `www.fnp.sa` and the public APIs used by that storefront. See §36 "Corrections & deltas vs prior AWJ FNP passes" in the deep report.

# FNP Flowers & Gifts Evidence Pass — Checkout, Account, Orders & Promotions

**Status:** External Evidence Pass — Documentation only  
**Date:** 2026-10-03  
**Repository:** `safwan5001-source/Nebrax`  
**Branch:** `docs/fnp-flowers-gifts-evidence-pass`  
**Parent evidence:** `FNP_FLOWERS_GIFTS_EVIDENCE_PASS.md`  
**Scope:** Cart, account, wishlist, order tracking, order intake, delivery data, payments, discounts, cancellation/refund evidence, and checkout-adjacent behavior visible from FNP public pages.

> Evidence only. No implementation authorization.

---

## 1. Why this continuation exists

The first FNP pass focused on catalog, gifting, merchandising, personalization, delivery promise, substitution, bundles, corporate gifting, and florist-specific operations.

This continuation focuses on customer-account and transaction-flow evidence that is less visible from catalog pages.

The live interactive checkout could not be fully exercised from the current research environment, so this pass **does not invent hidden checkout steps**. It records only publicly observable or indexed evidence.

---

# 2. Account model

## OBSERVED

FNP FAQ describes a customer account that:

- is free to register;
- stores personal information for faster future orders;
- supports username/password login;
- stores recipient details;
- stores prior order history.

## Evidence

- https://checkout.fnp.sa/pages/faq

## AWJ implication

For gifting, account value extends beyond ordinary customer profile data.

A useful consumer account can retain:

```text
Customer profile
Saved recipients
Saved delivery addresses
Order history
Wishlist
Potential reminder/event data
```

Saved recipients should remain separate from the ERP customer master unless an explicit identity model says otherwise.

---

# 3. Saved recipients are a real gifting capability

## OBSERVED

FNP FAQ explicitly says the customer account includes a section to store **recipient details**.

## AWJ implication

This supports a future first-class consumer concept:

`SavedRecipient`

Possible fields:

- display name;
- relationship;
- phone;
- saved addresses;
- notes;
- birthday/anniversary/reminder metadata only if explicitly supported later.

This is different from:

- ERP Partner;
- Commerce customer identity;
- delivery recipient snapshot;
- recipient merchandising facet.

Do not collapse them.

---

# 4. Cart persistence / browsing behavior

## OBSERVED

FNP FAQ explains the shopping cart as a place that retains intended purchases while the customer continues browsing or leaves the site to think.

It also exposes a "Manage Cart" capability with item removal.

## Evidence

- https://checkout.fnp.sa/pages/faq

## AWJ implication

At minimum, AWJ consumer commerce should support:

- cart persistence across navigation;
- line removal;
- quantity changes;
- variant/personalization persistence;
- revalidation at checkout.

The public evidence does not prove FNP's exact anonymous-cart expiry or cross-device merge behavior.

Those remain UNKNOWN.

---

# 5. Wishlist

## OBSERVED

FNP exposes a Wishlist page with:

- Share Wishlist;
- Clear All;
- Add All;
- login prompt to save Wishlist to account.

## Evidence

- https://checkout.fnp.sa/en/a/wishlist

## AWJ implication

Wishlist is useful for gifting stores and should be classified as **shared Commerce**, not Flowers-only.

Potential capabilities:

- anonymous local wishlist;
- account-persisted wishlist;
- shareable wishlist;
- add-all-to-cart;
- clear-all.

Exact privacy/public-token design requires a later contract.

---

# 6. Order tracking

## OBSERVED

FNP FAQ states customers can use **Track Order**, enter an order number, and retrieve the current delivery/order status.

## Evidence

- https://checkout.fnp.sa/pages/faq

## AWJ implication

Storefront account capability should eventually expose customer-safe order tracking.

Important security implication:

A public order-number lookup must not reveal personal/order data solely because an order number is guessed.

AWJ should require a safe verification mechanism, account identity, signed token, or another approved contract.

This is an AWJ security implication, not a claim about FNP's exact security design.

---

# 7. Multiple order-entry channels

## OBSERVED

FNP FAQ lists several ways to place an order:

- online through the website;
- by phone;
- by email/support-assisted ordering.

## Evidence

- https://checkout.fnp.sa/pages/faq

## AWJ implication

This is important for florist operations.

AWJ Flowers & Gifts should not assume all commerce orders originate from self-service web checkout.

Potential order sources:

```text
Storefront
POS
Phone order
WhatsApp-assisted order
Manual admin order
Corporate enquiry/order
Future marketplace/integration
```

The underlying Commerce Order should preserve `source/channel` without creating separate accounting logic.

---

# 8. Required order information

## OBSERVED

FNP FAQ lists order information including:

- recipient name;
- full delivery address;
- recipient contact number;
- delivery date;
- delivery time for hand-delivered products;
- sender name;
- shipping option;
- billing information.

## Evidence

- https://checkout.fnp.sa/pages/faq

## AWJ implication

This strongly supports the separation:

```text
Purchaser / billing identity
Sender display identity
Recipient identity
Recipient phone
Delivery destination
Delivery date/time
Shipping/service option
```

These must not be collapsed into a single "customer" record.

---

# 9. Sender identity is explicit

## OBSERVED

FNP FAQ lists **sender name** as part of the information required to place an order.

## AWJ implication

The Flowers & Gifts vertical should carry an explicit gifting sender field.

Potential distinction:

```text
Authenticated customer
Billing name
Gift sender display name
Anonymous / hidden sender preference
```

The public FAQ does not fully establish whether anonymous sender is supported in every flow.

---

# 10. Product customization can be assisted manually

## OBSERVED

FNP FAQ states customers can contact support to request a customized product.

Separately, product pages expose structured image/text personalization fields.

## Evidence

- https://checkout.fnp.sa/pages/faq
- public personalized-product pages documented in the parent evidence pass.

## AWJ implication

There are potentially two customization modes:

1. **Structured self-service personalization**
2. **Assisted custom-order request**

AWJ should not force every special request into predefined personalization fields.

A future `CustomRequest / AssistedOrder` concept may be useful, especially for florists and corporate gifting.

---

# 11. Variant upgrades on PDP

## OBSERVED

FNP cake product pages expose "Pick an Upgrade" controls for values such as:

- 500 g;
- 1 kg;
- 1.5 kg;
- 2 kg;
- flavor alternatives such as Vanilla, Chocolate, Red Velvet.

## Evidence

- https://checkout.fnp.sa/en/products/delicious-mango-cake-half-kg
- https://checkout.fnp.sa/en/products/unicorn-special-photo-cake

## AWJ implication

Ordinary size/flavor changes should use AWJ's Product/Variant model where appropriate.

Do not model them as arbitrary personalization fields.

---

# 12. Product Message field

## OBSERVED

Some cake/product pages expose a dedicated **Product Message** input in addition to variants and, on personalized products, image upload.

## Evidence

- https://checkout.fnp.sa/en/products/classic-strawberry-cheesecake
- https://checkout.fnp.sa/en/products/congratulaiton-graduation-2026-cake-for-girl
- https://checkout.fnp.sa/en/products/a-velvety-photo-cake
- https://checkout.fnp.sa/en/products/unicorn-special-photo-cake

## AWJ implication

This further confirms at least three distinct input classes:

```text
Variant selection
Product-level personalization/message
Order-level gift message
```

They should have separate persistence and fulfillment semantics.

---

# 13. Personalization media constraints

## OBSERVED

A personalized photo cake publicly states accepted formats:

- JPEG;
- PNG;
- HEVC;
- HEIF;

with file size less than 1 MB.

## Evidence

- https://checkout.fnp.sa/en/products/a-velvety-photo-cake
- https://checkout.fnp.sa/en/products/unicorn-special-photo-cake

## AWJ implication

Personalization media requires an explicit contract for:

- allowed MIME/types;
- size caps;
- tenant-scoped storage;
- malware/content safety scanning where appropriate;
- image transformation;
- retention after fulfillment;
- order snapshot/reference;
- access control.

Do not store arbitrary data URLs in order JSON as the long-term production design.

---

# 14. Food allergen information

## OBSERVED

A cake product page explicitly lists allergens such as:

- flour/wheat;
- egg;
- chocolate;
- dairy/milk.

## Evidence

- https://checkout.fnp.sa/en/products/kitkat-chocolate-cake

## AWJ implication

The parent evidence pass treated allergen support as an open question. This new evidence confirms that **allergen content is a real storefront requirement** for at least part of the Flowers & Gifts catalog.

AWJ should later decide whether allergen data is:

- structured attributes;
- reusable product-content profile;
- regulated food metadata.

This requires Saudi food-commerce/compliance evidence before final modeling.

---

# 15. Cart summary pricing language

## OBSERVED

The Wishlist/cart surface displays:

- estimated total;
- taxes included;
- discounts and shipping calculated at checkout.

## Evidence

- https://checkout.fnp.sa/en/a/wishlist

## AWJ implication

The storefront should distinguish:

```text
Merchandise subtotal
Discount
Shipping/delivery
Tax presentation
Final total
```

All monetary values must remain server-authoritative.

---

# 16. Checkout login acceleration

## OBSERVED

The cart/wishlist surface prompts:

**Have an account? Log in to check out faster.**

## Evidence

- https://checkout.fnp.sa/en/a/wishlist

## AWJ implication

AWJ should preserve guest checkout capability where product policy permits, while using account login to accelerate:

- saved recipients;
- saved addresses;
- order history;
- customer details.

Whether login is optional/required is an AWJ product decision, not inferred from this message alone.

---

# 17. Payment methods

## OBSERVED

FNP public pages describe or display multiple payment approaches including:

- credit/debit card;
- online banking;
- digital wallets;
- installment / BNPL messaging;
- corporate bank transfer;
- corporate purchase order.

Product pages show a "Ways to pay" strip.

## Evidence

- https://checkout.fnp.sa/en/collections/gifts-for-girlfriend
- product pages in the parent pass;
- https://corporate.fnp.sa/en/faqs/

## AWJ implication

Payment method support belongs to shared Commerce.

Flowers & Gifts should only consume the available methods and, where appropriate, expose payment badges.

Corporate PO is not equivalent to immediate B2C payment and belongs to a separate B2B order/approval path.

---

# 18. Discounts and promotions

## OBSERVED

FNP exposes:

- sale/discounted prices on some product/collection pages;
- newsletter subscription with a **10% off** message;
- an **Exclusive Deals Zone** collection;
- a collection whose path explicitly references coupon-code eligibility;
- city/marketing pages discussing festive/special discounts.

## Evidence

- https://checkout.fnp.sa/en/collections/gifts-for-girlfriend
- https://www.fnp.sa/en/no-discount-collection-only-for-coupon-code
- https://www.fnp.sa/en/gifts-dammam

## AWJ implication

Flowers & Gifts requires no unique promotion engine; it needs a shared Commerce promotion capability capable of expressing at least:

- product/collection eligibility;
- coupon code;
- exclusion/inclusion rules;
- percentage/fixed discount;
- campaign period;
- possibly channel/customer constraints.

The public evidence does not prove FNP's exact stacking/priority rules.

Those remain UNKNOWN.

---

# 19. Promotion eligibility collections

## OBSERVED

FNP exposes a public collection named/path-associated with "no discount collection only for coupon code" and an "Exclusive Deals Zone".

## Evidence

- https://www.fnp.sa/en/no-discount-collection-only-for-coupon-code

## AWJ implication

This suggests promotion qualification can intersect with merchandising collections.

AWJ should avoid hard-coding discount behavior into theme collections.

A future Promotion engine should reference explicit eligibility sets/conditions while Catalog collections remain reusable.

---

# 20. Newsletter acquisition discount

## OBSERVED

FNP pages expose a newsletter signup message offering 10% off upon subscription.

## Evidence

- https://checkout.fnp.sa/en/collections/gifts-for-girlfriend
- https://checkout.fnp.sa/en/collections/gifts-bestsellers

## AWJ implication

This belongs to Growth/CRM rather than Flowers vertical core.

Potential shared future capability:

```text
Lead capture
→ consent
→ audience/customer identity
→ promotional entitlement/coupon
```

Must comply with privacy/marketing-consent requirements.

---

# 21. Order acceptance is not automatic

## OBSERVED

FNP Shipping Policy states that after receiving an order/application FNP may:

- accept;
- refuse;
- cancel all or part;
- request additional verification/information.

It also says a gift order requires recipient name and exact shipping address, and that the order is not accepted until shipping information for the accepted part has been sent.

## Evidence

- https://checkout.fnp.sa/en/policies/shipping-policy

## AWJ implication

A Flowers & Gifts Commerce Order may need to distinguish:

```text
Submitted
Accepted / Confirmed
Rejected
Cancelled
Partially accepted — only if AWJ later supports such semantics
```

But AWJ should not copy FNP's exact legal/order-acceptance wording blindly.

This evidence reinforces that "checkout submitted" and "merchant operational acceptance" can be separate concepts.

---

# 22. Additional verification before acceptance

## OBSERVED

FNP Shipping Policy reserves the right to request additional verification or information before accepting an order.

## AWJ implication

High-risk or exceptional orders may require a manual-review gate.

Potential cases:

- unusually high value;
- money bouquet;
- suspicious payment;
- unclear recipient data;
- corporate custom order.

Fraud/risk design requires dedicated security evidence.

---

# 23. Cancellation and refund evidence

## OBSERVED

FNP Shipping Policy states that if FNP cancels all or part of an order, the remedy is generally:

- refunding the received amount back to the relevant card/bank method; or
- not charging the cancelled portion.

## Evidence

- https://checkout.fnp.sa/en/policies/shipping-policy

## Important limitation

This evidence covers **FNP-initiated cancellation** from the shipping policy excerpt.

It does **not** establish the full customer-initiated cancellation window, return eligibility, perishable-goods return policy, personalized-goods refund policy, or refund SLA.

Those remain unresolved.

## AWJ implication

Do not define Flowers & Gifts return/refund rules until we research:

- perishable goods;
- custom/personalized goods;
- cakes/food;
- flowers;
- wrong/damaged item;
- failed delivery;
- customer cancellation before preparation;
- cancellation after personalization/assembly begins;
- refund destination;
- partial cancellation.

Recommended evidence task:

`FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1`

---

# 24. Partial cancellation / partial acceptance signal

## OBSERVED

FNP's Shipping Policy language refers to cancellation of an order **in whole or in part** and refund/non-charge of the cancelled part.

## AWJ implication

This suggests a mature gifting platform may need order-line-level cancellation/adjustment.

AWJ already requires careful separation of:

- Order;
- Payment;
- Fulfillment;
- Invoice;
- Return;
- Refund;
- Credit Note.

Do not implement partial cancellation until the existing Commerce lifecycle is mapped against this requirement.

---

# 25. Order history

## OBSERVED

FNP account FAQ explicitly states the account stores history of previously placed orders.

## AWJ implication

Consumer order history is part of Commerce Account UX and should not be confused with internal ERP document lists.

The storefront needs a customer-safe view with only the order information appropriate for that consumer.

---

# 26. Password recovery

## OBSERVED

FNP FAQ describes email-based password recovery.

## AWJ implication

Authentication mechanics belong to shared consumer identity.

No reason exists to make Flowers & Gifts own authentication.

AWJ should reuse the approved Commerce customer/mobile identity and security architecture.

---

# 27. Search / category discovery evidence

## OBSERVED

FNP FAQ says products are classified by:

- flowers;
- cakes;
- gifts;
- occasion.

The live catalog additionally demonstrates much richer facets as documented in the parent evidence pass.

## AWJ implication

The customer discovery model should expose:

- category navigation;
- occasion navigation;
- recipient navigation;
- faceted filtering;
- search.

Search ranking internals remain UNKNOWN.

---

# 28. Best-seller collection

## OBSERVED

FNP has a dedicated Best Seller Gifts collection.

## Evidence

- https://checkout.fnp.sa/en/collections/gifts-bestsellers

## AWJ implication

"Best sellers" can be:

- manually curated;
- derived from sales data;
- hybrid.

Public evidence does not prove which approach FNP uses.

AWJ should define its own trustworthy derivation later rather than label arbitrary products as best sellers.

---

# 29. City-specific availability can empty entire sections

## OBSERVED

The storefront output can state **"No products available for the selected city"** for sections such as:

- Football Cakes;
- Flowers & Chocolate;
- Flowers & Money.

## Evidence

- https://checkout.fnp.sa/en
- https://checkout.fnp.sa/

## AWJ implication

This is stronger evidence that city selection affects the actual merchandising dataset.

Store Builder section rendering must gracefully support:

- no eligible products for destination;
- hide-empty-section policy;
- fallback collection;
- alternate city prompt;
- delivery-unavailable state.

Do not show an empty product carousel simply because the theme section exists.

---

# 30. City/serviceability context should influence homepage rendering

## OBSERVED

Homepage/collection output is location-sensitive.

## AWJ implication

For a future AWJ vertical storefront:

```text
Published page structure
+ current visitor delivery context
+ catalog/serviceability
= rendered merchandising
```

Theme configuration alone is insufficient.

This requires careful caching strategy so tenant, locale, city, catalog publication, and availability do not leak or become stale.

---

# 31. Delivery promises are shown before checkout

## OBSERVED

FNP product and homepage surfaces expose time promises such as:

- 9:00 pm Today;
- 3 Hour Delivery;
- day/time choice.

## Evidence

- https://www.fnp.sa/en
- multiple product pages in the parent evidence pass.

## AWJ implication

Delivery promise calculation must be reusable by:

- product page;
- product card;
- homepage section;
- cart;
- checkout.

A single server-authoritative delivery-promise service is preferable to duplicated UI calculations.

---

# 32. Returns / cancellation remain a high-priority evidence gap

The public sources reviewed are not sufficient to safely define AWJ policy.

Before implementation, research must include:

- FNP Terms and Conditions;
- any dedicated refund/return/cancellation policy;
- Saudi e-commerce consumer rules relevant to perishable/customized goods;
- payment-gateway refund behavior;
- tax/ZATCA consequences in AWJ.

This is explicitly not closed by this pass.

---

# 33. Checkout flow — what is proven vs unknown

## Proven from public evidence

A transaction can involve:

- cart;
- optional account/login acceleration;
- recipient identity;
- recipient phone;
- delivery address;
- delivery date;
- delivery time/slot;
- sender name;
- shipping/service option;
- billing information;
- discounts;
- shipping calculation;
- payment;
- order tracking after placement.

## Not proven

The exact FNP screen sequence is not treated as proven here.

Unknowns include:

- exact step order;
- guest checkout form layout;
- address autocomplete/maps;
- OTP;
- coupon placement;
- gift-message placement;
- add-on placement;
- payment provider orchestration;
- retry behavior;
- abandoned checkout;
- reservation timing;
- webhook lifecycle;
- fraud checks.

AWJ should derive its checkout from product/architecture requirements, not mimic an unverified screen sequence.

---

# 34. New AWJ implications from this continuation

Compared with the parent FNP evidence pass, this continuation adds/strengthens:

1. **Saved recipients**
2. **Wishlist**
3. **Public/customer order tracking**
4. **Assisted order entry**
5. **Sender identity as explicit order data**
6. **Product Message separate from gift message**
7. **Allergen information**
8. **Personalization upload constraints**
9. **Promotion/coupon capability**
10. **Newsletter acquisition promotions**
11. **Order acceptance vs submission**
12. **Additional verification/manual review**
13. **Partial cancellation signal**
14. **Consumer order history**
15. **Location-aware empty-state rendering**
16. **Reusable delivery-promise service**
17. **Returns/cancellation as a dedicated evidence gate**

---

# 35. Revised recommended task queue

Before implementation of Flowers & Gifts vertical, recommended evidence/contract sequence is now:

1. `FLOWERS-EVIDENCE-1` — AWJ reuse/gap matrix.
2. `FLOWERS-TAXONOMY-1` — category/facet/occasion/recipient/collection/brand contract.
3. `FLOWERS-PERSONALIZATION-1` — structured fields + media.
4. `FLOWERS-GIFTING-IDENTITY-1` — purchaser/sender/saved-recipient/delivery-recipient boundary.
5. `FLOWERS-DELIVERY-CONTRACT-1` — service levels/date/slot/cutoff/earliest promise.
6. `FLOWERS-RECIPIENT-ADDRESS-1` — no-address workflow.
7. `FLOWERS-SUBSTITUTION-EVIDENCE-1`.
8. `FLOWERS-BOM-EVIDENCE-1`.
9. `FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1`.
10. `FLOWERS-MONEY-GIFT-EVIDENCE-1`.
11. `FLOWERS-FULFILLMENT-OPS-1`.
12. `FLOWERS-CORPORATE-GIFTING-EVIDENCE-1`.
13. `FLOWERS-SEO-1`.
14. `FLOWERS-THEME-1`.

Shared Commerce capabilities such as Wishlist, Promotion Engine, consumer account/order history, and payment methods should not be duplicated inside the vertical if AWJ already has or plans them.

---

# 36. Sources used in this continuation

- https://checkout.fnp.sa/pages/faq
- https://checkout.fnp.sa/en/a/wishlist
- https://checkout.fnp.sa/en/policies/shipping-policy
- https://checkout.fnp.sa/en/products/delicious-mango-cake-half-kg
- https://checkout.fnp.sa/en/products/classic-strawberry-cheesecake
- https://checkout.fnp.sa/en/products/congratulaiton-graduation-2026-cake-for-girl
- https://checkout.fnp.sa/en/products/a-velvety-photo-cake
- https://checkout.fnp.sa/en/products/unicorn-special-photo-cake
- https://checkout.fnp.sa/en/products/kitkat-chocolate-cake
- https://checkout.fnp.sa/en/collections/gifts-for-girlfriend
- https://checkout.fnp.sa/en/collections/gifts-bestsellers
- https://www.fnp.sa/en/no-discount-collection-only-for-coupon-code
- https://www.fnp.sa/en/gifts-dammam
- https://www.fnp.sa/en/
- https://checkout.fnp.sa/en
- https://corporate.fnp.sa/en/faqs/

---

# 37. Status

This continuation does **not** close the FNP research.

Remaining high-value research areas:

- Terms & Conditions;
- full returns/refund/cancellation policy;
- privacy/marketing consent;
- payment-method details;
- coupon stacking/eligibility;
- real checkout interaction when browser access allows;
- order-status vocabulary;
- customer support/escalation;
- failed-delivery behavior;
- abandoned checkout;
- delivery proof;
- recipient-contact flow for missing address;
- mobile app-specific gifting differences.

No implementation should start merely from this evidence continuation.
