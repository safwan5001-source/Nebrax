> **Evidence precedence notice (2026-10-03):** This document is a preliminary FNP evidence pass. For the current FNP Saudi storefront, use `FNP_DEEP_EVIDENCE_1_REPORT.md` and `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md` from PR #1181 as the higher-authority evidence where they verify, correct, or supersede statements here. In particular, `checkout.fnp.sa` is a live legacy Shopify surface; evidence about current storefront behavior should prefer direct observations from `www.fnp.sa` and the public APIs used by that storefront. See §36 "Corrections & deltas vs prior AWJ FNP passes" in the deep report.

# FNP Flowers & Gifts Evidence Pass

**Status:** External Evidence Pass — Documentation only  
**Date:** 2026-10-03  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** `main` @ `49ecc540a116acc9c503d87c34efeca7fa59cd2d`  
**Reference storefront:** FNP Saudi — https://www.fnp.sa/ and related public FNP Saudi pages  
**Purpose:** Capture the observable commerce, merchandising, gifting, delivery, personalization, product, corporate-gifting, and operational patterns used by FNP Saudi before AWJ makes final Flowers & Gifts vertical decisions.

> This document is **evidence**, not implementation authorization.
> It deliberately separates what FNP publicly exposes from AWJ implications.
> It does not authorize schema, API, accounting, tax, inventory, checkout, merge, deploy, or production changes.

---

## 1. Executive conclusion

FNP Saudi should not be understood as merely an online flower shop.

The public storefront behaves more like an **occasion-driven gifting commerce platform** where the same merchandise can be discovered and sold through several overlapping dimensions:

- product type;
- occasion;
- recipient / relationship;
- flower type;
- color;
- packaging / arrangement style;
- food characteristics such as flavor and serving size;
- personalization;
- gift combinations;
- brand;
- price;
- city / delivery serviceability;
- delivery urgency.

This is important for AWJ because a generic single-tree category model is not enough to reproduce the observed customer journey.

The most important architecture implication from this evidence pass is:

```text
Category tree alone
    !=
Flowers & Gifts merchandising model
```

A credible Flowers & Gifts vertical needs a combination of catalog taxonomy, facets/attributes, curated collections, gifting semantics, personalization, location-aware fulfillment, and delivery promise logic.

---

# 2. Evidence methodology

This pass reviewed publicly accessible FNP Saudi storefront, collection/category, product, delivery, personalized-gift, location, and corporate-gifting pages.

Evidence is classified as:

- **OBSERVED** — directly visible in a public FNP page.
- **INFERRED** — reasonable product/architecture implication derived from observed behavior, but not proof of FNP's internal implementation.
- **UNKNOWN** — public evidence is insufficient to determine the internal model or workflow.

This report must not represent inferred backend architecture as if it were confirmed FNP implementation.

---

# 3. Store identity and overall business model

## OBSERVED

FNP presents flowers alongside:

- cakes;
- chocolates;
- perfumes;
- personalized gifts;
- plants;
- branded gifts;
- balloons;
- hampers;
- soft toys;
- watches / accessories on some gifting paths;
- combinations of multiple gift types.

Public pages position gifting by occasion and relationship, not only by merchandise category.

The storefront also exposes delivery-focused landing pages, location-specific landing pages, personalized-gift pages, brand pages, and corporate-gifting pages.

## AWJ implication

Flowers & Gifts should be treated as a **gifting vertical**, not as a narrow florist theme.

The underlying commerce design should support merchant catalogs where flowers are one important family among several gift families.

---

# 4. Multi-dimensional discovery model

## OBSERVED

The Birthday Gifts collection exposes multiple simultaneous filters:

- Category;
- Price;
- Flavour;
- Occasion;
- Cake Type;
- Flower Color;
- Flower Type;
- Packaging Type;
- Price Range;
- Serving Size.

The same collection shows hundreds of products across flowers, cakes, perfumes, money arrangements, balloons, personalized cakes, teddy bears, and combinations.

FNP also exposes recipient-specific pages such as birthday gifts for her.

## Evidence

- https://www.fnp.sa/en/gifts-birthday
- https://www.fnp.sa/en/gifts-birthday-for-her
- https://www.fnp.sa/en/flowers
- https://www.fnp.sa/en/photo-frames

## AWJ implication

AWJ should not force all these concepts into one hierarchy.

Recommended conceptual separation:

```text
Category
Facet / Attribute
Occasion
Recipient / Relationship
Collection
Brand
Location availability
Delivery capability
```

A product may participate in many of these simultaneously.

Example:

```text
Product: Rose + Cake Combo
Category: Gift Set
Occasion: Birthday, Anniversary
Recipient: Her, Wife
Flower Type: Rose
Flower Color: Pink
Cake Flavor: Chocolate
Delivery: Same-day eligible
City: Dammam eligible
Collection: Best Sellers
```

This is not an approved schema; it is the minimum conceptual richness suggested by evidence.

---

# 5. Occasion-driven merchandising

## OBSERVED

FNP repeatedly organizes products around gifting occasions, including examples such as:

- Birthday
- Anniversary
- Wedding
- Graduation
- Housewarming
- Mother's Day
- Father's Day
- Valentine's Day
- National Day
- Congratulations
- Thank-you / appreciation contexts

Some product detail pages explicitly list relevant occasions.

## Evidence

- https://www.fnp.sa/en/gifts-birthday
- https://www.fnp.sa/en/gifts-national-day
- https://www.fnp.sa/en/products/assorted-roses-with-truffle-birthday-photo-cake

## AWJ implication

Occasion is a first-class merchandising concept for this vertical.

It should not be limited to static theme navigation.

A merchant needs to:

- create/edit occasions;
- localize labels;
- assign products to multiple occasions;
- build storefront sections from an occasion;
- filter/search by occasion;
- activate/deactivate seasonal occasions;
- control sorting/curation.

---

# 6. Recipient / relationship-driven merchandising

## OBSERVED

FNP content and navigation distinguish recipients and relationships such as:

- her;
- him;
- wife;
- husband;
- mother;
- father;
- friend;
- colleagues;
- professional recipients in corporate gifting.

## Evidence

- https://www.fnp.sa/en/gifts
- https://www.fnp.sa/en/gifts-birthday-for-her
- https://www.fnp.sa/en/gifts-national-day
- https://corporate.fnp.sa/en/

## AWJ implication

Recipient merchandising is distinct from the actual delivery recipient record.

AWJ must keep separate:

```text
Recipient merchandising tag
!=
Delivery recipient
!=
Purchasing customer
!=
Gift-message sender name
```

---

# 7. Product taxonomy: flower-specific characteristics

## OBSERVED

FNP exposes flower-specific filtering and product composition information.

Examples include:

- roses;
- mixed flowers;
- flower color;
- flower type;
- bouquet;
- vase;
- box / tray / arrangement;
- wrapping;
- stem counts;
- flower species/components.

Product details frequently enumerate exact component counts.

Examples:

- 3 cappuccino roses;
- eucalyptus;
- chrysanthemums;
- specific wrapping;
- ribbon;
- glass bowl / tray / vase.

## Evidence

- https://www.fnp.sa/en/gifts-birthday
- https://checkout.fnp.sa/en/products/flowers-beauty-n-chocolates
- https://checkout.fnp.sa/en/products/product13
- https://checkout.fnp.sa/en/products/patchi-chocolates-and-yellow-rose-flower-bouquet

## AWJ implication

Flowers require structured product composition/content beyond a plain description.

Possible concepts to evaluate later:

- flower type;
- flower color;
- stem count;
- arrangement type;
- packaging type;
- container;
- artificial vs fresh;
- care profile;
- sellable composition snapshot.

Do not assume all of these need dedicated database columns.

---

# 8. Food / cake characteristics

## OBSERVED

FNP uses cake-specific merchandising properties such as:

- flavor;
- cake type;
- serving size;
- weight;
- personalized/picture cake;
- storage;
- recommended consumption period.

Example products expose 500g cake weights and approximate serving sizes.

## Evidence

- https://www.fnp.sa/en/gifts-birthday
- https://www.fnp.sa/en/products/peach-roses-bouquet-with-redvelvet-cake
- https://checkout.fnp.sa/en/products/mix-roses-bouquet-with-chocolate-cake

## AWJ implication

Flowers & Gifts is partially a perishables vertical.

The product/content model may need reusable vertical blocks for:

- weight;
- serving size;
- allergens — not confirmed from current evidence but likely a separate compliance question;
- storage;
- best-consumed period;
- preparation lead time;
- care instructions.

No food-compliance decision is made by this evidence pass.

---

# 9. Product detail structure

## OBSERVED

FNP product pages commonly separate:

- Product Details;
- How to Care / Care Instructions;
- Delivery Instructions;
- product imagery;
- price;
- SKU/brand/category on some pages;
- earliest delivery information;
- add-to-cart;
- payment/installment information;
- trust messages;
- related add-on/upsell surface such as "Make it extra special with".

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://checkout.fnp.sa/en/products/flowers-beauty-n-chocolates
- https://www.fnp.sa/en/products/expressing-gratitude-mug

## AWJ implication

AWJ should avoid treating long product description text as the only vertical content field.

Candidate structured content blocks:

```text
Product Details
Composition
Care Instructions
Food Storage / Consumption
Delivery Instructions
Personalization Instructions
Substitution Notice
```

---

# 10. Care instructions are product-family dependent

## OBSERVED

Different items expose different care instructions:

### Flowers
- indirect sunlight;
- trim stems;
- change water;
- flower food;
- maintain floral foam;
- remove wilted leaves/flowers.

### Chocolates
- temperature considerations;
- refrigeration;
- expiration guidance.

### Cakes
- refrigeration;
- serving at room temperature;
- recommended consumption period.

### Printed/personalized items
- humidity / cleaning / washing guidance.

## Evidence

- https://checkout.fnp.sa/en/products/munikh-beethoven-chocolate-box-n-flower-bouquet
- https://checkout.fnp.sa/en/products/flowers-beauty-n-chocolates
- https://www.fnp.sa/en/products/peach-roses-bouquet-with-redvelvet-cake
- https://www.fnp.sa/en/products/cushion-birthday-with-photo

## AWJ implication

A reusable content-block or product-care model is preferable to hard-coded flower-only copy.

---

# 11. Personalization is broader than a gift message

## OBSERVED

FNP sells personalized products including:

- photo frames;
- mugs;
- cushions;
- picture cakes;
- personalized chocolates;
- customized figurines;
- products requiring an uploaded photo;
- products requiring customer-provided text or name.

One combo explicitly states that personalisation requires one image.

Public catalog copy describes getting pictures or text printed on products.

## Evidence

- https://www.fnp.sa/en/personalised-gifts
- https://www.fnp.sa/en/flowers-n-personalised-gifts
- https://www.fnp.sa/en/products/love-combos-cushion-and-mug
- https://www.fnp.sa/en/products/customized-best-boss-figurine

## AWJ implication

AWJ must separate:

```text
Gift Message
!=
Product Personalization
```

Product personalization should be modeled as product-defined input requirements.

Candidate input types for future evaluation:

- short text;
- long text;
- name;
- image;
- multiple images;
- date;
- selection;
- cake message;
- engraving/printing instructions.

The exact supported field registry, file limits, media storage, moderation/security, and fulfillment rendering are separate implementation decisions.

---

# 12. Gift message vs product personalization

## OBSERVED

FNP's public product catalog demonstrates personalization of the actual product, while its broader gifting model is centered on sending gifts to recipients.

The public evidence reviewed here does not fully expose the complete gift-message checkout data contract.

## AWJ implication

Do not collapse these concepts.

Recommended separation:

```text
Order-level gifting:
- recipient
- gift message
- sender display preference

Line/product-level personalization:
- image upload
- name
- print text
- custom choices
```

This remains an AWJ design implication rather than confirmed FNP backend structure.

---

# 13. No Address, No Worries

## OBSERVED

Many FNP product pages visibly show the trust/capability message:

**"No Address, No Worries"**

The general Gifts page also states that a customer can share the recipient's phone number when they do not have the address, and FNP will handle the rest.

## Evidence

- https://www.fnp.sa/en/gifts
- https://checkout.fnp.sa/en/products/chocolates-and-flowers-gift-arrangement
- https://www.fnp.sa/en/products/cushion-birthday-with-photo

## AWJ implication

This is a major gifting-specific workflow and must not be ignored.

It suggests a possible future flow:

```text
Purchaser provides recipient phone
        ↓
Order enters address-pending state
        ↓
Recipient/contact workflow obtains delivery address
        ↓
Address becomes fulfillment snapshot
        ↓
Delivery continues
```

However, the public pages do not expose the exact operational workflow, consent mechanism, messaging channel, expiry behavior, or failure handling.

Therefore AWJ should create a dedicated evidence/contract task before implementation:

`FLOWERS-RECIPIENT-ADDRESS-1`

---

# 14. Delivery is part of the product promise

## OBSERVED

FNP advertises multiple delivery modes:

- same-day;
- standard;
- express;
- fixed-time;
- morning;
- midnight.

Product pages can display an earliest available delivery time and state that the customer may choose a preferred slot in the next step.

Examples:

- earliest delivery today at a specific time;
- earliest delivery tomorrow;
- same-day landing collections;
- "3 Hour Delivery" trust badge on many product pages.

## Evidence

- https://www.fnp.sa/en/personalised-gifts
- https://www.fnp.sa/en/gifts-dammam
- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://checkout.fnp.sa/en/products/product13
- https://www.fnp.sa/en/same-day-delivery-gifts

## AWJ implication

The Flowers & Gifts vertical should distinguish at least:

```text
Delivery Method
Delivery Service Level
Requested Date
Time Slot
Cutoff
Preparation Lead Time
Location / Zone eligibility
Capacity / availability
```

A time slot alone is insufficient to express the observed delivery promise.

---

# 15. Same-day delivery is a merchandising dimension

## OBSERVED

FNP has dedicated same-day collections for both gifts and flowers.

Same-day products span multiple categories:

- flowers;
- cakes;
- chocolates;
- personalized gifts;
- hampers;
- combos.

## Evidence

- https://www.fnp.sa/en/same-day-delivery-gifts
- https://www.fnp.sa/en/same-day-delivery-flowers

## AWJ implication

"Deliver Today" should not be a manually curated static category if AWJ can derive authoritative eligibility.

Long-term eligibility should account for:

```text
Product availability
+ fulfillment location
+ destination/service zone
+ preparation lead time
+ current time/cutoff
+ delivery-service capability
+ slot availability/capacity
```

This evidence supports a dynamic same-day merchandising query.

---

# 16. Location-aware commerce

## OBSERVED

FNP has city-specific landing pages such as Dammam and Al Khobar.

Catalog pages expose delivery-city filtering in some product groups.

Delivery messaging repeatedly names serviceable Saudi cities and regions.

## Evidence

- https://www.fnp.sa/en/gifts-dammam
- https://www.fnp.sa/en/gifts-al-khobar
- https://www.fnp.sa/en/photo-frames
- https://www.fnp.sa/en/same-day-delivery-gifts

## AWJ implication

Location must influence more than the shipping fee.

The vertical should evaluate:

```text
Product
× fulfillment source
× destination
× service level
× delivery date/slot
```

before promising availability.

This aligns with AWJ's existing Commerce fulfillment-source and shipping boundaries but requires additional vertical orchestration.

---

# 17. Dedicated / temperature-controlled delivery

## OBSERVED

Multiple FNP product pages state that orders are delivered in dedicated or temperature-controlled/refrigerated vehicles to protect flowers, chocolate, and cake quality.

## Evidence

- https://checkout.fnp.sa/en/products/flowers-beauty-n-chocolates
- https://checkout.fnp.sa/en/products/product13
- https://www.fnp.sa/en/products/peach-roses-bouquet-with-redvelvet-cake
- https://www.fnp.sa/en/products/assorted-roses-with-truffle-birthday-photo-cake

## AWJ implication

For Flowers & Gifts, fulfillment may eventually require delivery-capability constraints such as:

- refrigerated;
- fragile;
- upright handling;
- food-safe;
- same-day local fleet.

This should not be assumed as V1 scope, but the data model should avoid making delivery method a simple label that cannot later carry capabilities.

---

# 18. Delivery-address finality and redirection rules

## OBSERVED

Product delivery instructions repeatedly state that:

- the address should be accurate before checkout;
- delivery details become final once the order is confirmed/prepared;
- once an order is out for delivery, it cannot be redirected.

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://checkout.fnp.sa/en/products/munikh-beethoven-chocolate-box-n-flower-bouquet
- https://www.fnp.sa/en/products/expressing-gratitude-mug

## AWJ implication

The vertical may need explicit order-edit cutoffs:

```text
Before preparation
Before dispatch
Out for delivery
Delivered
```

Recipient/address edits may be allowed only before a defined fulfillment transition.

This should be expressed as order/fulfillment policy, not free-form UI behavior.

---

# 19. Substitution is a first-class florist reality

## OBSERVED

FNP repeatedly discloses substitution behavior when an item is unavailable because of:

- weather;
- seasonality;
- market conditions;
- regional availability;
- temporary availability.

The stated intent is to preserve value, quality, style/theme/color where possible, and prioritize on-time delivery.

Some pages state substitution may be made without informing the customer.

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://checkout.fnp.sa/en/products/red-roses-n-rochers-bouquet
- https://www.fnp.sa/en/products/peach-roses-bouquet-with-redvelvet-cake
- https://www.fnp.sa/en/products/seasons-greetings-photo-frame
- https://www.fnp.sa/en/products/expressing-gratitude-mug

## AWJ implication

Substitution should receive a dedicated architecture/evidence pass.

Potential concepts:

- substitution allowed;
- substitution approval required;
- equal-or-higher-value rule;
- preserve color/theme;
- allowed component alternatives;
- customer notification;
- merchant override;
- fulfillment audit trail;
- price/accounting treatment.

Do **not** silently implement automatic substitutions from inventory rules alone.

Recommended future task:

`FLOWERS-SUBSTITUTION-EVIDENCE-1`

---

# 20. Fresh flowers may arrive partially closed

## OBSERVED

FNP frequently states that flowers may arrive in bud/underdeveloped form to increase lifespan.

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://checkout.fnp.sa/en/products/product13
- https://checkout.fnp.sa/en/products/patchi-chocolates-and-yellow-rose-flower-bouquet

## AWJ implication

This is mostly customer-information content rather than a core commerce feature, but the Store Builder/product model should support product-family delivery disclaimers and care expectations.

---

# 21. Bundle / combo merchandising

## OBSERVED

FNP strongly merchandises combinations such as:

- flowers + chocolates;
- flowers + cake;
- flowers + personalized gifts;
- flowers + balloons;
- flowers + perfume;
- multi-item hampers.

Product details often enumerate each component.

Some products present customer choice between alternatives.

## Evidence

- https://www.fnp.sa/en/flowers-n-personalised-gifts
- https://checkout.fnp.sa/en/products/garden-gala-flower-bouquet-with-chocolate-box
- https://checkout.fnp.sa/en/products/flowers-beauty-n-chocolates
- https://www.fnp.sa/en/products/seasons-greetings-flower-n-mini-cake-combo

## AWJ implication

AWJ should distinguish:

1. merchandising-only collection/group;
2. fixed sellable bundle;
3. configurable bundle.

Inventory and fulfillment behavior determines whether the bundle must decompose into real components.

---

# 22. Money arrangements are not ordinary bundles

## OBSERVED

FNP sells multiple flower + cash arrangements.

Examples visible on the storefront include:

- SAR 500;
- SAR 1000;
- SAR 1200;
- SAR 1500;
- SAR 1800;
- SAR 2000.

A specific SAR 2000 product explicitly states the count and denomination of the cash notes and sells at a price greater than the embedded cash value.

## Evidence

- https://www.fnp.sa/en
- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://www.fnp.sa/en/gift/flowers-and-money-arrangement-sar2000

## AWJ implication

Money gifts require a separate accounting, cash-control, fraud, operational, and tax review.

They must **not** be modeled casually as a normal product component.

Recommended future evidence gate:

`FLOWERS-MONEY-GIFT-EVIDENCE-1`

Questions include:

- Is embedded cash treated as pass-through value?
- What is revenue vs liability/cash movement?
- Who funds the notes?
- How is denomination/cash custody tracked?
- What are cancellation/refund rules?
- Are there legal/compliance limits?
- How does ZATCA/tax treatment apply?

No answer is assumed in this document.

---

# 23. Add-ons / "Make it extra special"

## OBSERVED

Product pages may include an additional merchandising surface labeled similar to "Make it extra special with".

FNP also sells small accessory/add-on products such as number candles and occasion toppers.

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://www.fnp.sa/en/products/number-1-candle
- https://www.fnp.sa/en/products/get-well-soon-topper

## AWJ implication

Add-ons should be product/variant-backed wherever possible so that:

- pricing is authoritative;
- inventory can be tracked;
- VAT/accounting remains normal;
- order lines stay auditable.

Add-on eligibility can then be merchandising metadata.

---

# 24. Brand merchandising

## OBSERVED

FNP exposes branded-gift navigation and named brands including examples such as:

- Patchi;
- Bostani;
- Cerruti 1881;
- Godiva;
- Titan;
- Bateel;
- Venchi;
- Feel Good Tea.

## Evidence

- https://www.fnp.sa/en/all-brands
- https://www.fnp.sa/en/same-day-delivery-gifts

## AWJ implication

Brand is useful as a first-class catalog/merchandising facet for gift stores.

It should not be hard-coded into theme navigation.

---

# 25. Curated merchandising and intent

## OBSERVED

FNP uses merchandising concepts such as:

- Best sellers;
- personalized gifts;
- same-day gifts;
- branded gifts;
- flowers & money;
- gift combos and hampers;
- recipient/occasion landing pages.

The homepage highlights distinct themed product groups rather than exposing only the category tree.

## Evidence

- https://www.fnp.sa/en
- https://www.fnp.sa/en/gifts
- https://www.fnp.sa/en/same-day-delivery-gifts

## AWJ implication

AWJ Store Builder needs collection-driven sections that can be backed by:

- explicit merchant curation;
- catalog query/facet;
- delivery capability;
- occasion;
- recipient;
- brand;
- product type.

---

# 26. Sorting and filtering

## OBSERVED

FNP collection pages expose sort options including:

- relevance;
- price low-to-high;
- price high-to-low;
- newest first.

Filters expose counts.

## Evidence

- https://www.fnp.sa/en/gifts-birthday

## AWJ implication

Flowers & Gifts does not require a unique sorting engine, but AWJ storefront catalog should support robust faceted filtering and standard sorting with count-aware UX where feasible.

---

# 27. Earliest-delivery messaging

## OBSERVED

Some product pages show a concrete earliest-delivery message before checkout, for example a specific time today or "tomorrow", followed by a note that a preferred delivery slot can be selected next.

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://www.fnp.sa/en/gift/flowers-and-money-arrangement-sar2000

## AWJ implication

This is a powerful conversion feature.

AWJ should eventually expose a server-derived:

`earliest_delivery_at`

or equivalent presentation contract rather than recalculating availability in theme code.

Exact API design is deferred.

---

# 28. Trust signals

## OBSERVED

Common FNP product-page trust signals include examples such as:

- No Address, No Worries;
- 8 Million Customers;
- 3 Hour Delivery;
- Fresh Flowers & Cakes;
- On Time Delivery;
- customer-count messaging.

## Evidence

- https://checkout.fnp.sa/en/products/chocolates-and-flowers-gift-arrangement
- https://www.fnp.sa/en/gift/flowers-and-money-arrangement-sar2000

## AWJ implication

Store Builder should support merchant-configurable trust/benefit sections and badges.

However, AWJ must not fabricate claims. Merchant-facing configuration should require actual merchant-provided text/evidence and remain presentation content.

---

# 29. BNPL / installment messaging

## OBSERVED

Some FNP product pages show:

- Tamara;
- Tabby;
- interest-free installment messaging.

## Evidence

- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://www.fnp.sa/en/gift/flowers-and-money-arrangement-sar2000

## AWJ implication

This is not Flowers & Gifts-specific.

It belongs to shared AWJ Commerce payment capability, while vertical themes may surface payment badges on product pages.

---

# 30. Taxes and shipping display

## OBSERVED

Some product pages explicitly state:

- taxes included;
- shipping calculated at checkout.

## Evidence

- https://www.fnp.sa/en/products/expressing-gratitude-mug
- https://www.fnp.sa/en/products/get-well-soon-topper

## AWJ implication

This reinforces the need to keep tax and shipping server-authoritative and separate from theme logic.

No FNP tax treatment is inferred beyond the visible presentation text.

---

# 31. Corporate gifting is a separate business mode

## OBSERVED

FNP operates a dedicated corporate-gifting surface.

The corporate site supports:

- corporate gift enquiry;
- company name;
- requested quantity;
- desired item/request;
- phone/email;
- customized gifts;
- company logos;
- branded packaging;
- custom hampers;
- bulk discounts;
- minimum quantities varying by product;
- samples before large customized orders;
- processing lead times;
- tracking;
- credit/debit cards;
- bank transfer;
- corporate purchase orders.

Corporate pages target:

- clients;
- partners;
- employees;
- teams.

## Evidence

- https://corporate.fnp.sa/en/
- https://corporate.fnp.sa/en/faqs/

## AWJ implication

Flowers & Gifts should anticipate a later **Corporate Gifting** capability, but it should not be forced into B2C checkout.

Possible future concepts:

- corporate quote/enquiry;
- bulk order;
- recipient list;
- per-recipient delivery;
- branded packaging;
- logo personalization;
- sample approval;
- MOQ;
- corporate pricing;
- purchase-order workflow;
- bank-transfer settlement;
- campaign/order batch;
- scheduled gifting.

Recommended future track:

`FLOWERS-CORPORATE-GIFTING-EVIDENCE-1`

---

# 32. Corporate customization differs from consumer personalization

## OBSERVED

Corporate FNP supports company-logo customization and branded packaging.

## AWJ implication

AWJ should distinguish:

```text
Consumer personalization
- photo
- name
- message

Corporate customization
- company logo
- branded packaging
- quantity/MOQ
- sample approval
- repeatable recipient batches
```

They may reuse a shared personalization/media engine but have different workflows.

---

# 33. Bulk pricing / quantity discounts

## OBSERVED

Corporate FNP states that bulk discounts are available for large orders.

## AWJ implication

Bulk/corporate pricing is a shared Commerce/B2B pricing concern, not theme code.

It may later connect with AWJ quotation/customer pricing capabilities.

---

# 34. Sample-before-order workflow

## OBSERVED

Corporate FNP states that samples of customized gifts can be provided before a large order.

## AWJ implication

This suggests a future workflow for:

```text
Corporate enquiry
→ sample
→ approval
→ bulk production/order
→ fulfillment
```

This is Future scope and should not block Flowers & Gifts B2C MVP.

---

# 35. Search/discovery by gifting intent

## OBSERVED

FNP's category and landing-page structure repeatedly maps common human intents to dedicated pages:

- birthday gifts;
- gifts for her;
- same-day;
- personalized gifts;
- city delivery;
- brands;
- flower combinations.

## AWJ implication

Search should eventually understand structured intent, not only literal product-title matching.

Potential future synonym/query enrichment can map phrases to facets:

```text
"هدية تخرج لها"
→ Occasion: Graduation
→ Recipient: Her
```

No AI search requirement is established by this report.

---

# 36. SEO landing-page strategy

## OBSERVED

FNP has many public landing pages targeted by:

- occasion;
- recipient;
- product family;
- delivery speed;
- city;
- combinations;
- personalized gifts;
- brands.

Pages also contain substantial explanatory/SEO copy.

## Evidence

Examples:
- https://www.fnp.sa/en/gifts-dammam
- https://www.fnp.sa/en/gifts-al-khobar
- https://www.fnp.sa/en/same-day-delivery-gifts
- https://www.fnp.sa/en/personalised-gifts
- https://www.fnp.sa/en/gifts-national-day

## AWJ implication

AWJ should eventually support SEO/indexable collection/landing pages generated from safe merchant-controlled templates and catalog facets.

But FNP's heavy SEO copy should not be copied blindly; AWJ should preserve better visual hierarchy and content quality.

---

# 37. Seasonal merchandising

## OBSERVED

FNP uses seasonal/event-specific landing pages such as National Day and repeatedly promotes Mother's Day, Father's Day, Valentine’s, birthdays, anniversaries, graduation, etc.

## AWJ implication

Store Builder needs campaign/seasonal section presets and easy scheduling eventually.

Scheduling behavior is not confirmed from public FNP evidence and remains an AWJ product opportunity.

---

# 38. Product options / variants

## OBSERVED

Collection output shows some products with "2 options", "3 options", "4 options", and more.

## Evidence

- https://www.fnp.sa/en/gifts-birthday

## AWJ implication

Existing AWJ Product/Variant capability should remain authoritative for ordinary options.

The vertical must not reinvent variants for size/flavor/choice when the generic variant system can safely represent them.

Personalization fields remain distinct from variants.

---

# 39. Component-level product details

## OBSERVED

Many FNP gift sets enumerate detailed contents.

Examples include exact counts/weights of:

- flowers;
- chocolate pieces;
- cake weight;
- decorative pieces;
- wrapping;
- containers;
- cash notes;
- food items.

## AWJ implication

This supports future evaluation of:

- composition display;
- fulfillment pick/prep list;
- recipe/BOM;
- fixed bundle components.

But the public page does not prove whether FNP internally manages these as inventory components.

Therefore AWJ must not infer FNP's internal BOM implementation.

---

# 40. Bouquet assembly / BOM remains a separate architecture question

## OBSERVED

FNP descriptions clearly represent many bouquets as assemblies of multiple physical inputs.

## INFERRED

A florist ERP may need to consume components when assembling a bouquet.

## AWJ implication

AWJ needs a dedicated evidence pass before choosing between:

- bundle;
- kit;
- BOM;
- recipe;
- light manufacturing/assembly;
- product modifier.

Recommended task remains:

`FLOWERS-BOM-EVIDENCE-1`

Questions:

- Do stems have inventory?
- Is wrapping inventory-tracked?
- How is wastage handled?
- Are substitutions component-level?
- When is component stock consumed?
- How is bouquet cost calculated?
- Can one bouquet be prepared from alternative recipes?
- Is labor included in costing?
- Is the finished bouquet stocked or made-to-order?

---

# 41. Time-sensitive inventory and perishability

## OBSERVED

FNP emphasizes:

- freshness;
- temperature control;
- product care;
- substitutions caused by seasonality/availability;
- same-day/rapid fulfillment.

## AWJ implication

Traditional perpetual inventory alone may not cover every future florist need.

Potential future concerns include:

- batch/lot;
- expiry/freshness;
- purchase date;
- wastage;
- spoilage;
- quality status;
- flower-grade/length.

These are **not proven FNP storefront features** and must be researched independently before AWJ adopts them.

---

# 42. Operational preparation lead time

## OBSERVED

Corporate customized orders may require longer processing.

Personalized gifts and delivery service levels imply preparation constraints.

## AWJ implication

Product/variant/personalization may require:

- minimum preparation duration;
- service-level compatibility;
- same-day exclusion;
- cutoff.

This belongs to authoritative availability calculation.

---

# 43. Product imagery and expectation management

## OBSERVED

FNP delivery instructions often state that actual products may differ slightly from images due to lighting, size differences, availability, or substitutions.

## Evidence

- https://www.fnp.sa/en/products/peach-roses-bouquet-with-redvelvet-cake
- https://www.fnp.sa/en/products/expressing-gratitude-mug
- https://www.fnp.sa/en/products/blue-gold-chocolate-n-flower-box

## AWJ implication

Storefront product pages should support merchant-defined product/disclaimer policies without embedding these strings into themes.

---

# 44. Delivery exceptions and notifications

## OBSERVED

FNP states that delivery may be delayed under rare circumstances such as weather, traffic congestion, or remote addresses, and some pages say the customer will be notified.

## Evidence

- https://checkout.fnp.sa/en/products/munikh-beethoven-chocolate-box-n-flower-bouquet
- https://www.fnp.sa/en/products/expressing-gratitude-mug

## AWJ implication

Future fulfillment should support:

- delivery exception reason;
- customer notification;
- revised ETA;
- delivery status/audit.

Not required for the initial vertical foundation, but important for mature florist operations.

---

# 45. Delivery handoff inspection

## OBSERVED

Some FNP pages recommend opening/checking the product upon delivery before the delivery executive leaves.

## Evidence

- https://checkout.fnp.sa/en/products/red-roses-n-rochers-bouquet
- https://www.fnp.sa/en/products/assorted-roses-with-truffle-birthday-photo-cake

## AWJ implication

Could support future proof-of-delivery / quality-confirmation workflows.

No V1 requirement is established.

---

# 46. Apps and mobile channel

## OBSERVED

FNP public pages promote downloading an app for a faster/smoother experience.

## Evidence

- https://www.fnp.sa/en/fnp
- https://www.fnp.sa/en/gifts

## AWJ implication

This aligns with AWJ's broader App Builder direction.

The Flowers & Gifts vertical should be defined at shared Commerce/API capability level so web storefront and future merchant app can consume the same contracts.

---

# 47. Arabic / English storefront

## OBSERVED

FNP exposes Arabic and English versions of product/storefront pages.

## AWJ implication

AWJ remains Arabic/RTL-first with localized vertical labels/content and English support.

Vertical starter taxonomies/occasions should have localized seed labels rather than English-only constants.

---

# 48. Areas where FNP should not be copied blindly

## 48.1 Navigation complexity

FNP's breadth creates large, deep category/landing-page structures.

AWJ should preserve strong intent-based discovery but avoid overwhelming mega-navigation.

## 48.2 SEO-heavy page tails

Many FNP landing pages contain substantial long-form SEO text.

AWJ should support SEO content but not allow it to dominate the shopping experience.

## 48.3 Repeated policies in product content

FNP repeats large blocks of delivery/care text on many product pages.

AWJ should consider reusable policy/content profiles so merchants do not need to duplicate the same copy across hundreds of products.

## 48.4 Substitution without explicit customer notification

FNP publicly states that substitution may sometimes occur without prior notification.

AWJ should not automatically adopt that policy. It is a merchant-policy and customer-experience decision.

---

# 49. Capability map for AWJ

This is **classification for further design**, not implementation approval.

| Capability | Suggested AWJ layer |
|---|---|
| Product / Variant | Commerce Core |
| Category | Commerce Core |
| Brand | Commerce Core / Catalog |
| Collection | Commerce Core / Merchandising |
| Facets / Attributes | Commerce Core / Catalog |
| Occasion | Flowers & Gifts Vertical |
| Recipient merchandising | Flowers & Gifts Vertical |
| Gift Message | Flowers & Gifts Vertical / Checkout |
| Purchaser vs delivery recipient | Flowers & Gifts Vertical on Commerce customer/address primitives |
| Product Personalization | Shared Commerce capability, heavily used by Flowers & Gifts |
| Add-ons | Shared Commerce merchandising capability |
| Fixed/configurable bundle | Shared Commerce capability |
| Flower composition / BOM | ERP/Inventory + Flowers evidence required |
| Care instructions | Catalog content capability |
| Delivery service level | Shared Commerce fulfillment/shipping |
| Date/slot/cutoff | Shared Commerce fulfillment, configured by vertical |
| Same-day merchandising | Derived Commerce/Vertical query |
| No-address recipient flow | Flowers & Gifts / gifting capability |
| Substitution | Flowers & Gifts fulfillment policy |
| Money bouquet | Separate financial/compliance capability — gated |
| Corporate gifting | Future B2B/Commerce capability |
| Branded packaging | Corporate gifting / personalization |
| Bulk discount | B2B pricing |
| Sample approval | Corporate gifting workflow |
| Theme presentation | Store Builder / Themes |
| Trust badges | Store Builder content |
| SEO landing pages | Storefront/SEO platform |

---

# 50. Gaps in the current AWJ Flowers & Gifts V1 direction

The current `AWJ_FLOWERS_GIFTS_VERTICAL_V1.md` direction remains valid at a high level, but this FNP pass shows areas that need stronger treatment before implementation:

1. **General Facet/Taxonomy model** — Occasion/Recipient alone are insufficient.
2. **Delivery Service Level** — broader than simple slots.
3. **Location-aware catalog availability**.
4. **Product personalization field registry**.
5. **No-address recipient workflow**.
6. **Substitution policy and audit**.
7. **Reusable care/delivery content profiles**.
8. **Corporate gifting track**.
9. **Money-gift financial/compliance gate**.
10. **Earliest-delivery promise contract**.
11. **Delivery exception and address-edit cutoff model**.
12. **Potential fulfillment capabilities such as refrigerated handling**.
13. **SEO landing-page generation from facets/locations**.
14. **Component composition/BOM evidence**.

Do not patch all of these directly into code.

First convert each into a bounded architecture/evidence decision.

---

# 51. Recommended next evidence tasks

## Highest priority before vertical implementation

### FLOWERS-EVIDENCE-1 — AWJ repository capability mapping
Inspect the current AWJ:

- Product;
- Variant;
- category;
- collections;
- attributes/options;
- catalog publication;
- storefront query model;
- section registry;
- cart;
- checkout;
- Commerce Order;
- delivery/shipping;
- fulfillment source;
- inventory reservation;
- customer/address;
- media;
- draft/publish.

Output: reuse/gap matrix.

### FLOWERS-TAXONOMY-1
Decide how Occasion, Recipient, generic facets, attributes, collections, brands and category hierarchy interact.

### FLOWERS-PERSONALIZATION-1
Define product-defined personalization fields, validation, media storage and order snapshots.

### FLOWERS-DELIVERY-CONTRACT-1
Define service levels, date, slot, cutoff, lead time, capacity and earliest-delivery calculation.

### FLOWERS-RECIPIENT-ADDRESS-1
Research "No Address, No Worries" style gifting safely.

### FLOWERS-SUBSTITUTION-EVIDENCE-1
Define florist substitutions without corrupting inventory/order/accounting history.

### FLOWERS-BOM-EVIDENCE-1
Decide bouquet composition, component consumption, costing and wastage.

### FLOWERS-MONEY-GIFT-EVIDENCE-1
Separate legal/accounting/cash-control treatment for cash arrangements.

## Later

- FLOWERS-CORPORATE-GIFTING-EVIDENCE-1
- FLOWERS-SEO-1
- FLOWERS-FULFILLMENT-OPS-1
- FLOWERS-THEME-1

---

# 52. Evidence sources reviewed

Primary public FNP Saudi sources used in this pass include:

- https://www.fnp.sa/en/
- https://www.fnp.sa/en/flowers
- https://www.fnp.sa/en/gifts
- https://www.fnp.sa/en/gifts-birthday
- https://www.fnp.sa/en/gifts-birthday-for-her
- https://www.fnp.sa/en/personalised-gifts
- https://www.fnp.sa/en/flowers-n-personalised-gifts
- https://www.fnp.sa/en/same-day-delivery-gifts
- https://www.fnp.sa/en/same-day-delivery-flowers
- https://www.fnp.sa/en/gifts-dammam
- https://www.fnp.sa/en/gifts-al-khobar
- https://www.fnp.sa/en/all-brands
- https://www.fnp.sa/en/photo-frames
- https://www.fnp.sa/en/gifts-national-day
- https://www.fnp.sa/en/gift/flowers-and-sar2000-money-bouquet
- https://www.fnp.sa/en/gift/flowers-and-money-arrangement-sar2000
- https://checkout.fnp.sa/en/products/flowers-beauty-n-chocolates
- https://checkout.fnp.sa/en/products/product13
- https://checkout.fnp.sa/en/products/patchi-chocolates-and-yellow-rose-flower-bouquet
- https://checkout.fnp.sa/en/products/munikh-beethoven-chocolate-box-n-flower-bouquet
- https://checkout.fnp.sa/en/products/garden-gala-flower-bouquet-with-chocolate-box
- https://www.fnp.sa/en/products/peach-roses-bouquet-with-redvelvet-cake
- https://www.fnp.sa/en/products/assorted-roses-with-truffle-birthday-photo-cake
- https://www.fnp.sa/en/products/love-combos-cushion-and-mug
- https://www.fnp.sa/en/products/customized-best-boss-figurine
- https://www.fnp.sa/en/products/expressing-gratitude-mug
- https://www.fnp.sa/en/products/cushion-birthday-with-photo
- https://www.fnp.sa/en/products/number-1-candle
- https://www.fnp.sa/en/products/get-well-soon-topper
- https://corporate.fnp.sa/en/
- https://corporate.fnp.sa/en/faqs/

---

# 53. Limitations / not yet proven

The following were **not** treated as proven internal FNP architecture from public pages:

- exact database schema;
- internal inventory-reservation implementation;
- exact checkout state machine;
- exact recipient-address collection workflow;
- exact cart merge behavior;
- internal search engine;
- promotion engine;
- fulfillment routing algorithm;
- courier dispatch system;
- warehouse topology;
- BOM/recipe engine;
- pricing engine;
- accounting treatment;
- tax treatment;
- ZATCA implementation;
- fraud controls;
- refund mechanics;
- internal substitution approval flow;
- per-slot capacity algorithm.

Any AWJ decision in these areas requires repository evidence and, where relevant, external authoritative evidence.

---

# 54. Final evidence statement

The evidence strongly supports the owner direction that **Flowers & Gifts must be a vertical capability pack, not merely a storefront theme**.

The strongest patterns to carry forward into AWJ design are:

- intent-based discovery;
- multi-dimensional catalog facets;
- occasion and recipient merchandising;
- rich product composition/content;
- product personalization;
- gifting recipient flows;
- delivery service levels and time promises;
- location-aware availability;
- same-day merchandising;
- substitution policy;
- add-ons and combinations;
- corporate gifting as a later B2B extension.

The next safe step is **not implementation**.

The next safe step is to inspect current AWJ Commerce and produce a **reuse/gap matrix** against this evidence.
