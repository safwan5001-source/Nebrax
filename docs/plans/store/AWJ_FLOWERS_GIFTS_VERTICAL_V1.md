# AWJ Flowers & Gifts Vertical Pack V1

**Status:** Product / Architecture Direction — Documentation only  
**Date:** 2026-10-03  
**Repository:** `safwan5001-source/Nebrax`  
**Original Base:** `main` @ `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087`  
**Reconciled against:** `main` @ `590770bf9e78e940fcda426f0a10c1ff87915647` (FNP evidence + FLOWERS-EVIDENCE-1 merged)  
**Scope:** AWJ Commerce + Store Builder vertical specialization for flower and gift merchants.  
**Implementation authorization:** None. No database/API/accounting behavior is authorized by this document alone.

---

## 0. Evidence precedence and current authority

This direction document was originally authored before the deep FNP audit and before the AWJ repository reuse/gap audit.

It is now reconciled against the merged evidence:

- `FNP_DEEP_EVIDENCE_1_REPORT.md`
- `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md`
- `FLOWERS_EVIDENCE_1_AWJ_REUSE_GAP_AUDIT.md`

Where this document describes a **business capability**, it remains the vertical direction.
Where it previously implied a specific persistence model or shared-Commerce contract, the newer evidence/contract task takes precedence.

In particular:

- `FLOWERS-TAXONOMY-1` decides the storage/contract boundary for Category vs Facet vs Collection vs Occasion vs Recipient vs Brand.
- `FLOWERS-GIFTING-IDENTITY-1` decides purchaser/sender/recipient/saved-recipient ownership and snapshot semantics.
- `FLOWERS-PERSONALIZATION-1` decides product-defined customer inputs and upload security/lifecycle.
- `FLOWERS-DELIVERY-CONTRACT-1` decides service levels/date/slot/cutoff/lead-time/capacity/earliest-delivery.
- bundles, bouquet BOM, substitutions, failed delivery, no-address gifting, and money gifts remain evidence/architecture-gated.

This document still does **not** authorize implementation.

---

## 1. Purpose

AWJ should support a first-class **Flowers & Gifts vertical pack** on top of the existing Commerce platform.

This must **not** be implemented as a theme-only solution.

The pack defines domain behavior and merchant workflows specific to flowers, gifts, cakes, chocolates, balloons, personalized gifts, and similar occasion-driven retail, while preserving the existing Commerce, Inventory, Accounting, Tenant Isolation, Storefront, and Store Builder boundaries.

Conceptually:

```text
AWJ ERP Core
  ├─ Products / Variants
  ├─ Inventory
  ├─ Customers
  ├─ Accounting
  └─ Invoices
        ↓
AWJ Commerce Core
  ├─ Catalog
  ├─ Cart / Checkout
  ├─ Commerce Order
  ├─ Payment
  ├─ Fulfillment
  └─ Shipping
        ↓
Flowers & Gifts Vertical Pack
  ├─ Occasions
  ├─ Recipients
  ├─ Flower/Gift attributes
  ├─ Gift message
  ├─ Add-ons
  ├─ Bundles
  ├─ Delivery date / slot semantics
  └─ Vertical Store Builder sections
        ↓
Themes
  ├─ Luxury
  ├─ Romantic
  ├─ Minimal
  ├─ Nebras
  └─ future themes
```

**Vertical Pack != Theme.**

A theme controls presentation.  
The vertical pack controls capabilities, merchandising semantics, and workflows.

---

## 2. Product goal

Enable a flower/gift merchant to create a commercially credible storefront without manually translating a generic catalog into a gifting business model.

The merchant should be able to sell through:

- product type;
- occasion;
- recipient;
- delivery timing;
- combination / bundle;
- personalization;
- add-ons;
- curated collections.

The customer should be able to shop by **intent**, not only by SKU/category.

Examples:

- Birthday → For Her → Roses → Deliver Today
- Graduation → Flowers + Chocolate
- New Baby → Gift Box + Balloon
- Anniversary → Premium Bouquet + Message Card
- Same-day gifts → Dammam / Khobar / other supported merchant zones

---

## 3. Architecture boundary

### 3.1 Reuse existing AWJ authority

This pack must reuse existing AWJ authorities and must not create parallel truth for:

- Product
- Variant
- Inventory
- Warehouse
- Customer
- Commerce Order
- Payment
- Fulfillment
- Invoice
- Accounting
- VAT / ZATCA
- Tenant ownership

The pack may add vertical metadata and orchestration, but it must not duplicate the above domains.

### 3.2 Accounting boundary

Flowers & Gifts functionality must preserve:

```text
Commerce Order != Sales Invoice
Gift Message     != Accounting data
Occasion         != Accounting data
Recipient        != Customer master
Delivery slot    != Revenue recognition
Bundle UI        != Separate accounting authority
```

Posting, tax, ledger behavior, document numbering, ZATCA behavior, and invoice immutability remain owned by the existing Invoice / Accounting domains.

Reference: `ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md`.

### 3.3 Inventory boundary

Flower/gift merchandising must not bypass inventory safety.

Inventory-tracked components and sellable products remain subject to the existing/future Commerce Available-to-Sell and reservation model.

Reference: `ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md`.

### 3.4 Shipping boundary

The pack may add **delivery-date and delivery-slot semantics**, but it must not fork the shipping-price authority.

Shipping fees remain server-authoritative and use the shared Commerce shipping-rate foundation.

Reference: `ADR-10-COMMERCE-SHIPPING-RATE-V1-SCOPE.md`.

---

## 4. Core vertical concepts

### 4.1 Occasion

An **Occasion** is a merchandising/navigation concept.

Examples:

- Birthday
- Anniversary
- Wedding
- Graduation
- New Baby
- Congratulations
- Thank You
- Get Well
- Apology
- Love
- Mother's Day
- Valentine's Day
- Ramadan / Eid
- National occasions where applicable

Required behavior:

- merchant-configurable within the tenant;
- localized labels;
- active/inactive and sortable presentation;
- products may participate in multiple occasions;
- usable by storefront discovery and Store Builder sections;
- must not be a hard-coded global enum.

**Storage/model decision is intentionally deferred to `FLOWERS-TAXONOMY-1`.**
Occasion may become a first-class vertical entity or a governed facet dimension; this document does not pre-authorize a table shape or many-to-many schema.

### 4.2 Recipient

Recipient is also merchandising/navigation metadata.

Examples:

- For Her
- For Him
- Mother
- Father
- Wife
- Husband
- Friend
- Colleague
- Child
- Newborn

Required behavior mirrors Occasion: merchant-configurable, localized, sortable, and assignable to many products.

**Storage/model decision is intentionally deferred to `FLOWERS-TAXONOMY-1`.**

Recipient merchandising is **not** the order recipient/delivery person record and must remain distinct from saved recipients and checkout delivery contacts.

### 4.3 Product vertical attributes

Candidate flower/gift attributes include:

**Flowers**
- flower type;
- dominant color;
- stem count / size;
- arrangement type;
- packaging style;
- vase included;
- fragrance warning / care note where relevant.

**Gifts**
- gift type;
- brand;
- size;
- personalization support;
- gender/recipient relevance;
- age relevance where appropriate.

**Food / cake / chocolate**
- flavor;
- size/servings;
- allergen information;
- message-on-cake option;
- preparation lead time.

V1 should avoid creating bespoke database columns for every possible attribute.

Preferred direction: reuse existing Product/Variant/Option authorities where they represent sellable SKU choices, and add shared/vertical merchandising facets where they represent discovery metadata.

Do **not** pre-classify Occasion or Recipient as dedicated database entities here; `FLOWERS-TAXONOMY-1` owns that decision.

Delivery Slot, Gift Message, Add-on, Bundle, and personalization each require their own bounded contract because they affect checkout, fulfillment, inventory, or historical order context.

---

## 5. Gift Message

Gift Message is a checkout/order capability.

Candidate fields:

- message text;
- sender display name;
- hide sender identity flag, when merchant permits;
- card style / card product reference, if offered;
- language;
- optional recipient name.

Rules:

- tenant-controlled enable/disable;
- maximum length;
- server validation;
- sanitized text;
- stored as historical order context;
- immutable or versioned once fulfillment reaches the merchant-defined cutoff;
- never used as accounting identity or customer master data.

The public storefront must make the distinction between:

```text
Purchaser / customer
Recipient / delivery contact
Gift-message sender display
```

These can be different people.

---

## 6. Add-ons

Add-ons are optional products/services offered in context of another product.

Examples:

- chocolate;
- balloon;
- vase;
- greeting card;
- cake topper;
- teddy bear;
- premium wrapping.

The model must avoid a fake free-text pricing layer.

Preferred direction:

- add-ons resolve to real catalog products/variants or a controlled service product;
- price remains server-authoritative;
- inventory-tracked add-ons participate in inventory rules;
- selected add-ons are snapshotted into the Commerce Order;
- add-ons can be constrained by parent product/category/occasion.

Future examples:

```text
Bouquet A
  ├─ Add chocolate (+ SAR ...)
  ├─ Add balloon (+ SAR ...)
  └─ Add vase (+ SAR ...)
```

---

## 7. Bundles / Gift Combos

Flowers & Gifts requires first-class merchandising of combinations.

Examples:

- Flowers + Chocolate
- Flowers + Cake
- Flowers + Perfume
- Flowers + Balloon
- Gift Box + Card
- Graduation Bundle

A bundle must not be implemented as a storefront-only visual grouping if fulfillment/inventory depends on its components.

V1 design must distinguish at least:

1. **Curated merchandising group**  
   Multiple independently purchased items presented together.

2. **Fixed bundle**  
   One sellable offer composed of defined components.

3. **Configurable bundle**  
   Customer selects from allowed component choices.

Implementation details remain deferred until the current Product/Variant/Inventory model is inspected for the minimum safe extension.

Accounting must still use the approved Commerce → Invoice boundary.

---

## 8. Delivery date and time slots

For flowers and gifts, **when the order arrives is part of the buying decision**.

Required concepts:

- requested delivery date;
- delivery time slot;
- same-day eligibility;
- cutoff time;
- preparation lead time;
- blocked dates;
- slot capacity;
- pickup slot where enabled;
- tenant timezone;
- fulfillment source compatibility.

A storefront must not promise a delivery date solely from client-side logic.

Server authority is required for:

- slot availability;
- cutoff evaluation;
- merchant calendar;
- delivery zone;
- preparation lead time;
- capacity;
- product restrictions.

A customer-visible label such as "Deliver today" must be derived from current authoritative availability, not static section copy.

### 8.1 Delivery contract direction

The deep FNP evidence confirmed that customer-visible delivery marketing labels are not sufficient evidence of selectable checkout methods. AWJ therefore must not hard-code competitor labels or infer a scheduling model from marketing pages.

`FLOWERS-DELIVERY-CONTRACT-1` must determine the minimum shared contract for:

- service level;
- delivery/pickup date;
- named time slot;
- start/end time;
- cutoff;
- disabled dates/calendar;
- preparation lead time;
- optional capacity;
- destination-zone compatibility;
- fulfillment-source compatibility;
- authoritative revalidation before order confirmation.

Carrier integration is not required to establish this contract.

Exact schema/API/state-machine details remain unapproved.

---

## 9. Same-day merchandising

"Deliver Today" should be a dynamic merchandising surface, not a manually maintained category.

Eligibility should eventually derive from:

```text
Product active
AND sellable inventory / policy
AND merchant/warehouse availability
AND preparation lead time
AND current cutoff
AND destination zone
AND an available delivery slot
```

The exact query/performance model requires implementation evidence.

Do not hard-code same-day eligibility in presentation configuration.

---

## 10. Storefront information architecture

Recommended flowers/gifts navigation primitives:

- Shop by Occasion
- Shop by Recipient
- Flowers
- Gifts
- Cakes / Chocolates / optional merchant categories
- Gift Combos
- Deliver Today
- Best Sellers
- New Arrivals
- Premium / Luxury Collection
- Personalized Gifts

These are capabilities, not a mandatory navigation layout.

The theme decides visual composition.

---

## 11. Store Builder integration

The existing Store Customizer remains a **structured-section visual builder**.

Flowers & Gifts extends the Section Registry; it does not create a separate page builder.

Candidate vertical sections:

### Discovery
- Shop by Occasion
- Shop by Recipient
- Flower Types
- Gift Categories
- Brand strip

### Merchandising
- Best Sellers
- Deliver Today
- Gift Combos
- Premium Collection
- New Arrivals
- Personalized Gifts
- Curated Collection
- Products by Occasion

### Editorial / trust
- Delivery promise
- Gift message explainer
- Care guide
- Why shop with us
- Store story

### Seasonal
- Valentine's
- Mother's Day
- Eid
- Graduation
- Wedding season
- Merchant-defined campaign collection

All sections must follow the existing Store Builder contract:

- Add
- Edit
- Reorder
- Duplicate
- Hide / Show
- Delete
- responsive by construction
- preview-first
- click-to-edit
- Draft → Preview → Publish

Reference: `AWJ_STORE_CUSTOMIZER_UX_V2.md`.

---

## 12. Product page experience

A flowers/gifts product page may contain, based on capability:

1. media gallery;
2. product title;
3. price;
4. available variants;
5. vertical attributes;
6. delivery destination/date prompt;
7. delivery availability;
8. personalization;
9. gift message;
10. add-ons;
11. quantity;
12. add to cart;
13. care / composition details;
14. fulfillment notes;
15. related gift combos;
16. recommendations.

Do not require every block for every product.

Capability-driven rendering is required.

---

## 13. Cart and checkout

Checkout must support gifting without confusing purchaser identity and recipient delivery information.

Conceptual flow:

```text
Cart
  ↓
Delivery / Pickup
  ↓
Recipient contact
  ↓
Delivery address
  ↓
Date + slot
  ↓
Gift message
  ↓
Payment
  ↓
Order confirmation
```

Exact ordering may be tested later, but the data boundaries must remain distinct.

Candidate order snapshot context:

- purchaser/customer identity;
- gift sender display identity;
- recipient name;
- recipient phone;
- delivery address snapshot;
- requested service level/date/slot;
- gift message snapshot;
- selected add-ons;
- selected personalization;
- only the vertical metadata required for fulfillment/audit.

The exact ownership and snapshot contract is deferred to `FLOWERS-GIFTING-IDENTITY-1`, `FLOWERS-PERSONALIZATION-1`, and `FLOWERS-DELIVERY-CONTRACT-1`.

A saved recipient must not silently become an ERP Partner/Customer master record.

No client-provided price/tax/shipping authority.

---

## 14. Merchant onboarding

When creating or configuring an AWJ Store, merchant may choose:

```text
Business vertical:
○ General retail
● Flowers & Gifts
○ future verticals
```

Selecting Flowers & Gifts should preconfigure, not permanently lock:

- recommended sections;
- starter occasion set;
- starter recipient set;
- gift-message capability;
- add-on suggestions;
- delivery-date/slot capability;
- same-day section;
- recommended catalog attributes.

Merchant may disable or customize supported features.

The vertical selection should be represented as a finite platform capability/configuration, not arbitrary executable rules.

---

## 15. Theme model

Themes must remain independent of business capability.

Examples:

- Nebras Flowers
- Romantic
- Luxury
- Minimal
- Modern Gifts

All may consume the same Flowers & Gifts data contracts.

Theme code must not own:

- occasions;
- recipients;
- delivery-slot truth;
- gift-message persistence;
- bundle pricing;
- inventory rules;
- checkout validation.

A theme may choose how those capabilities are presented.

---

## 16. Tenant isolation and security

All vertical data must be tenant-scoped.

Mandatory protection applies to:

- occasions;
- recipients;
- merchant delivery configuration;
- slots;
- add-on relationships;
- bundle definitions;
- personalization definitions;
- checkout gift data;
- order snapshots;
- storefront reads;
- public mutations;
- background jobs.

Never resolve a tenant-owned product, option, warehouse, order, slot, or vertical record from an untrusted identifier without trusted tenant context.

Cross-tenant tests are mandatory for implementation slices.

---

## 17. Backward compatibility

Flowers & Gifts is additive.

It must not:

- make Commerce Order mandatory for existing ERP/POS flows beyond already approved Commerce boundaries;
- alter existing product semantics for tenants that do not enable the vertical;
- change invoice posting;
- change VAT/ZATCA logic;
- change inventory valuation;
- alter existing storefront themes unexpectedly;
- require all merchants to configure occasions/recipients/slots.

Generic stores continue to operate unchanged.

---

## 18. MVP sequencing after FLOWERS-EVIDENCE-1

The repository audit proved that Product/Variant/Cart/Checkout/Order/Address/ATS/Reservation/Shipping/Store Builder foundations already exist. The MVP should therefore add only the missing semantic layers in dependency order.

### P0 — taxonomy and merchandising contract

- vertical enablement/config;
- Category vs Facet vs Collection boundary;
- Occasion;
- Recipient merchandising;
- Brand/facet exposure;
- Store Builder data-source/section requirements.

**Gate:** `FLOWERS-TAXONOMY-1`.

### P1 — gifting identity

- purchaser vs gift sender vs delivery recipient;
- Gift Message;
- recipient delivery contact;
- immutable order snapshot semantics;
- saved-recipient decision without turning it into ERP Partner master data.

**Gate:** `FLOWERS-GIFTING-IDENTITY-1`.

### P2 — personalization

- product-defined text/image/select inputs;
- customer-upload media contract;
- validation/security/retention;
- cart/order snapshot;
- merchant fulfillment visibility.

**Gate:** `FLOWERS-PERSONALIZATION-1`.

### P3 — add-ons

- product/variant-backed add-ons;
- authoritative price/inventory;
- cart/order persistence;
- merchant eligibility configuration.

**Gate:** `FLOWERS-ADDONS-1`.

### P4 — delivery scheduling and promise

- service level;
- date;
- slot;
- cutoff;
- calendar;
- lead time;
- optional capacity;
- checkout revalidation;
- earliest-delivery / Deliver Today derivation.

**Gates:** `FLOWERS-DELIVERY-CONTRACT-1`, then `FLOWERS-AVAILABILITY-1` / `FLOWERS-SAMEDAY-1`.

### Later gated capabilities

Do not include in the first implementation slice until dedicated evidence/contracts exist:

- fixed/configurable bundles;
- bouquet BOM/recipe/assembly;
- substitution workflows;
- failed delivery;
- no-address gifting;
- money bouquets/cash gifts;
- corporate gifting orchestration;
- advanced returns/cancellation policies;
- shared promotions/wishlist/payment-provider work.

### Theme work

Themes come after the required business contracts are stable.

- Nebras may be a reference theme;
- generic Flowers & Gifts themes remain reusable presentation presets;
- theme code must not own business truth.

---

## 19. Explicit non-decisions

This document does **not** yet authorize or decide:

- database table names/columns;
- API paths;
- exact enum names;
- bundle valuation/accounting allocation;
- BOM/manufacturing behavior for bouquets;
- recipe/component consumption;
- substitution policy when a flower is unavailable;
- delivery driver application;
- route optimization;
- carrier integration;
- live courier tracking;
- dynamic delivery pricing beyond shared Commerce shipping policy;
- florist production board;
- workshop/preparation workflow;
- supplier purchasing automation;
- automated social marketing;
- AI recommendations;
- perishable inventory valuation changes;
- custom domain changes.

Each requires evidence and, where appropriate, a dedicated ADR/task.

---

## 20. Important future domain: bouquet composition

Flower businesses often assemble a sellable bouquet from components such as stems, wrapping, ribbon, vase, floral foam, and labor.

This is materially different from a normal SKU bundle because it can affect:

- inventory consumption;
- substitution;
- costing;
- yield/waste;
- preparation;
- profitability.

Therefore **do not model bouquet composition casually as a bundle**.

Before implementation, AWJ should run a dedicated evidence/architecture pass for:

```text
AWJ-FLOWERS-BOM-1
Bouquet Composition / Recipe / Assembly / Costing
```

No inventory/accounting rule is approved here.

---

## 21. Recommended task sequence

`FLOWERS-EVIDENCE-1` is complete and merged. Continue with:

1. `FLOWERS-TAXONOMY-1` — Category vs Facet vs Collection vs Occasion vs Recipient vs Brand.
2. `FLOWERS-GIFTING-IDENTITY-1` — purchaser/sender/recipient/saved-recipient boundary.
3. `FLOWERS-PERSONALIZATION-1` — product-defined inputs + customer uploads + snapshots.
4. `FLOWERS-CONTENT-1` — care/composition/allergen/safety content blocks.
5. `FLOWERS-ADDONS-1` — product-backed add-on relationship.
6. `FLOWERS-DELIVERY-CONTRACT-1` — service level/date/slot/cutoff/lead-time/capacity/earliest delivery.
7. `FLOWERS-AVAILABILITY-1` — destination + fulfillment source + ATS + service eligibility.
8. `FLOWERS-SAMEDAY-1` — authoritative Deliver Today derivation.
9. `FLOWERS-ACCOUNT-BRIDGE-1` — storefront account/history/wishlist integration where shared Commerce permits.
10. `FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1`.
11. `FLOWERS-SUBSTITUTION-EVIDENCE-1`.
12. `FLOWERS-FAILED-DELIVERY-EVIDENCE-1`.
13. `FLOWERS-BUNDLE-EVIDENCE-1`.
14. `FLOWERS-BOM-EVIDENCE-1`.
15. `FLOWERS-RECIPIENT-ADDRESS-1`.
16. `FLOWERS-MONEY-GIFT-EVIDENCE-1`.
17. `FLOWERS-CORPORATE-GIFTING-EVIDENCE-1`.
18. `FLOWERS-BUILDER-1`.
19. `FLOWERS-THEME-1`.

Shared Commerce capabilities such as promotions, wishlist persistence, online PSP, and tax presentation must not be duplicated inside the Flowers vertical.

Every implementation task must preserve:

- Tenant Isolation;
- server authority for monetary/availability data;
- accounting boundaries;
- backward compatibility;
- idempotency where mutations can retry;
- Arabic/RTL first;
- current Store Builder draft/publish model.

---

## 22. External evidence basis

FNP Saudi was used as an **external commerce evidence source**, not as an architecture to copy.

The merged deep audit distinguishes:

- OBSERVED live storefront/API behavior;
- INFERRED public client-code capability;
- UNKNOWN behavior.

Important corrected evidence includes:

- the live Saudi storefront is `www.fnp.sa` (Next.js), while `checkout.fnp.sa` is a legacy Shopify surface;
- catalog assortment varies by city/region while sampled common-product pricing remained shared;
- selectable delivery behavior observed in live carts is narrower than marketing labels;
- cart/checkout separates sender, recipient/address, scheduling and payment concerns;
- multiple FNP policy/content/consistency weaknesses are explicitly documented as **patterns not to copy**.

AWJ must not copy proprietary design, content, assets, or implementation.
The goal is to use external evidence to identify business capabilities and then implement them through AWJ's own authorities and contracts.

---

## 23. Success criteria

The vertical is successful when:

- a flower/gift merchant can configure the business without hacks;
- a customer can shop by occasion/recipient/intention;
- gift-message and recipient workflows are first-class;
- same-day promises are authoritative;
- add-ons and bundles do not bypass catalog/inventory/accounting truth;
- themes remain interchangeable;
- generic AWJ stores remain unaffected;
- all vertical data is tenant isolated;
- Store Builder remains structured, visual, responsive, and draft/publish safe.

---

## 24. Owner decision recorded

**Decision:** Flowers & Gifts is a vertical pack above AWJ Commerce, not merely a theme.

**Reason:** the sector requires business capabilities—occasion/recipient merchandising, gift messages, add-ons, delivery timing, bundles and potentially bouquet composition—that cannot safely live inside presentation code.

**Theme relationship:** themes consume the vertical capabilities but do not own them.

**Implementation status:** documentation only. This revision is reconciled with the merged FNP deep evidence and `FLOWERS-EVIDENCE-1`. No database/API/accounting behavior, merge, deploy, or production change is authorized by this document.
