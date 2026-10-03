# FLOWERS-EVIDENCE-1 — AWJ Flowers & Gifts Reuse / Gap Audit

**Status:** Repository Evidence Pass — documentation only  
**Date:** 2026-10-03  
**Repository:** `safwan5001-source/Nebrax`  
**Base:** `main` @ `0dc38c4458a13970bcc88925deb9274085ea5425`  
**Scope:** Map the FNP Flowers & Gifts capability evidence onto the actual AWJ repository and classify what can be reused, extended, built, or deferred.

> This document is **not implementation authorization**.
> It does not authorize schema, API, accounting, tax, ZATCA, inventory, checkout, merge, deploy, or production changes.
> Any capability marked `PARTIAL_EXTENSIBLE` still needs a bounded contract before code if it changes a public API, persistence model, financial total, inventory lifecycle, or tenant/security boundary.

---

# 1. Evidence inputs

This audit uses the merged FNP evidence as the external reference:

- `docs/plans/store/FNP_FLOWERS_GIFTS_EVIDENCE_PASS.md`
- `docs/plans/store/FNP_FLOWERS_GIFTS_EVIDENCE_PASS_2_CHECKOUT_OPERATIONS.md`
- `docs/plans/store/FNP_FLOWERS_GIFTS_EVIDENCE_PASS_3_POLICIES_LIFECYCLE.md`
- `docs/plans/store/FNP_DEEP_EVIDENCE_1_REPORT.md`
- `docs/plans/store/FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md`

Repository architecture/status evidence was taken from current code and merged implementation/ADR reports, including:

- Product / ProductVariant / ProductOption / ProductOptionValue
- ProductMedia
- CommerceListing
- Commerce category publication
- Storefront product/category controllers
- CommerceCart / CommerceCartItem
- CommerceCheckout
- CommerceOrder / CommerceOrderLine / CommerceOrderSnapshot
- CommerceCustomerAddress
- CustomerIdentity
- FulfillmentPolicy
- AvailableToSellService
- InventoryReservationService
- CommerceOrderReservationService
- CommerceShippingZone / ShippingRateService
- Storefront Presentation / Customizer
- Storefront capability registry
- Commerce Mobile implementation reports and current-state records

The open Flowers & Gifts direction PR **#1179** is intentionally **not treated as merged authority**. It remains open and predates this reuse/gap audit.

---

# 2. Status vocabulary

Every capability is classified as exactly one of:

- **PROVEN_EXISTING** — implemented and evidenced in repository/runtime contracts.
- **PARTIAL_EXTENSIBLE** — a real nearby authority exists, but the Flowers capability itself is not complete.
- **MISSING** — no suitable live capability found.
- **DEFERRED_PLANNED** — explicitly planned/deferred in repository docs.
- **CONFLICT_RISK** — reusing the apparent capability directly would violate an existing boundary or create a second source of truth.
- **UNKNOWN** — repository evidence is insufficient to classify safely.

---

# 3. Executive summary

AWJ already has a strong Commerce/ERP foundation for a Flowers & Gifts vertical.

The repository **does not need a second commerce engine** for flowers.

The following are already real and reusable:

- products;
- product variants and option values;
- variant-scoped price/inventory/media;
- tenant/channel publication;
- categories and category publication;
- product media;
- server-authoritative cart;
- guest → customer cart identity merge;
- checkout session;
- saved customer addresses;
- immutable order snapshots;
- Commerce Order;
- customer order history API;
- fulfillment source policy;
- warehouse-aware ATS;
- atomic inventory reservations;
- shipping zones/rates;
- COD / Pay-on-Pickup payment-intent foundation;
- structured Store Builder / presentation system;
- Arabic/English and RTL foundations.

The biggest missing layer is **not ERP**. It is the gifting-specific commerce model and richer catalog/discovery model:

- general facets / filter dimensions;
- curated collections distinct from categories;
- Occasion;
- Recipient / relationship merchandising;
- gift sender / recipient semantics;
- product personalization fields and customer-upload media;
- gift message;
- add-ons;
- fixed/configurable bundles;
- bouquet composition/BOM;
- date/time slot/cutoff/capacity;
- earliest-delivery promise;
- no-address recipient flow;
- florist substitution policy;
- failed-delivery workflow;
- money-gift accounting/legal contract;
- live wishlist persistence;
- live storefront customer account bridge;
- promotion/coupon engine;
- returns/cancellation policy for perishables/personalized goods.

The architectural direction should therefore be:

```text
Reuse AWJ ERP + Commerce authorities
        ↓
Add shared Commerce capabilities where the need is generic
        ↓
Add Flowers & Gifts vertical semantics only where truly vertical
        ↓
Expose through the existing Store Builder / Storefront
        ↓
Themes remain presentation only
```

---

# 4. High-level capability matrix

| Capability | Status | Existing authority | Reuse path | Main gap / risk | Next task |
|---|---|---|---|---|---|
| Product master | PROVEN_EXISTING | `Product` | Reuse as-is | Do not add Flowers-only product table | — |
| Variants | PROVEN_EXISTING | `ProductVariant` + option values | Reuse as-is | None for size/flavor/color choices | — |
| Variant inventory | PROVEN_EXISTING | `InventoryState` | Reuse as-is | Must remain single inventory truth | — |
| Variant pricing | PROVEN_EXISTING | `ProductUnitPrice` / Commerce price resolver | Reuse as-is | No client pricing | — |
| Product media | PROVEN_EXISTING | `ProductMedia` | Reuse for merchant product assets | Customer personalization uploads are different | FLOWERS-PERSONALIZATION-1 |
| Category hierarchy | PROVEN_EXISTING | `ProductCategory` + publication | Reuse as structural taxonomy | Exact-match storefront filtering is too narrow for FNP-style discovery | FLOWERS-TAXONOMY-1 |
| Category publication | PROVEN_EXISTING | `CommerceCategoryListing` | Reuse | Keep independent from product publication | — |
| Product publication | PROVEN_EXISTING | `CommerceListing` | Reuse | Channel-level, not city-slot-level | FLOWERS-AVAILABILITY-1 |
| Brand | PARTIAL_EXTENSIBLE | `Product.brand/brand_id` | Reuse catalog authority | Need storefront filter/brand landing contract | FLOWERS-TAXONOMY-1 |
| Arbitrary facets | MISSING | No general storefront facet engine found | Build shared Catalog capability | Current storefront returns empty facets | FLOWERS-TAXONOMY-1 |
| Curated collections | MISSING | No distinct Commerce Collection model found | Build shared Merchandising capability | Do not abuse categories/tags | FLOWERS-TAXONOMY-1 |
| Occasion | MISSING | None | Flowers vertical merchandising facet | Must not be hard-coded enum | FLOWERS-TAXONOMY-1 |
| Recipient/relationship merchandising | MISSING | None | Flowers vertical merchandising facet | Distinct from delivery recipient | FLOWERS-TAXONOMY-1 |
| Search | PARTIAL_EXTENSIBLE | Storefront product search | Reuse and extend | Currently simple text search, no intent/facet search | FLOWERS-DISCOVERY-1 |
| Sorting | PROVEN_EXISTING | Storefront product list | Reuse | Limited sort set is acceptable initially | — |
| PDP variants | PROVEN_EXISTING | Storefront variant commerce | Reuse | None | — |
| Structured care/safety/allergen content | MISSING | Generic description only / no proven reusable typed content registry | Add shared product-content blocks | Avoid adding many dedicated Product columns | FLOWERS-CONTENT-1 |
| Product personalization fields | MISSING | None found | Shared Commerce personalization capability | Needs validation, storage, snapshots, fulfillment visibility | FLOWERS-PERSONALIZATION-1 |
| Customer personalization media | MISSING | ProductMedia is merchant/product-owned | New tenant-safe customer-upload object | Do not overload ProductMedia | FLOWERS-PERSONALIZATION-1 |
| Gift message | MISSING | None found | Flowers gifting/order metadata capability | Must persist immutably into order context | FLOWERS-GIFTING-IDENTITY-1 |
| Gift sender display | MISSING | None | Flowers gifting identity | Distinct from billing customer | FLOWERS-GIFTING-IDENTITY-1 |
| Delivery recipient | PARTIAL_EXTENSIBLE | checkout contact/address snapshots | Extend with recipient semantics | Current checkout contact is not a saved gifting-recipient model | FLOWERS-GIFTING-IDENTITY-1 |
| Saved addresses | PROVEN_EXISTING | `CommerceCustomerAddress` | Reuse | Snapshot behavior already correct | — |
| Saved recipients | MISSING | None found | Flowers/customer-account capability | Do not map directly to Partner | FLOWERS-GIFTING-IDENTITY-1 |
| Guest cart | PROVEN_EXISTING | `CommerceCart` | Reuse | Server authoritative | — |
| Auth cart merge | PROVEN_EXISTING | Commerce cart identity work | Reuse | Keep concurrency/idempotency invariants | — |
| Cart line custom metadata | MISSING | `CommerceCartItem` has fixed fields | Extend carefully | No generic safe personalization/add-on payload today | FLOWERS-PERSONALIZATION-1 |
| Checkout session | PROVEN_EXISTING | `CommerceCheckout` | Reuse | Extend via bounded fields/side tables, not parallel checkout | FLOWERS-CHECKOUT-EXT-1 |
| Commerce Order | PROVEN_EXISTING | `CommerceOrder` | Reuse | Keep order != invoice | — |
| Immutable order snapshot | PROVEN_EXISTING | `CommerceOrderSnapshot` | Reuse pattern | Flowers metadata needs bounded snapshot contract | FLOWERS-CHECKOUT-EXT-1 |
| Customer order history API | PROVEN_EXISTING | `commerce/v1/me/orders` | Reuse backend | Storefront UI bridge still partial | FLOWERS-ACCOUNT-BRIDGE-1 |
| Public guest order reference | PARTIAL_EXTENSIBLE | signed/reference order lookup infrastructure | Reuse security pattern | No FNP-style public tracking UX/state model yet | FLOWERS-TRACKING-1 |
| Wishlist backend | MISSING | Storefront capability = design_only | Build shared Commerce wishlist | UI must not pretend persistence exists | COM-WISHLIST-1 |
| Coupon/promotion engine | DEFERRED_PLANNED | ADR-11; UI design_only | Build shared Commerce engine later | Financial total impact | COM-PROMOTIONS-1 |
| Shipping zones/rates | PROVEN_EXISTING | `CommerceShippingZone` + `ShippingRateService` | Reuse | Current contract is rate matching, not delivery scheduling | FLOWERS-DELIVERY-CONTRACT-1 |
| Pickup | PROVEN_EXISTING | checkout/shipping path | Reuse | None | — |
| Delivery date | MISSING | No authoritative schedule model found | Shared fulfillment extension | Must not be client-only | FLOWERS-DELIVERY-CONTRACT-1 |
| Time slots | MISSING | None found | Shared fulfillment extension | Needs capacity/cutoff | FLOWERS-DELIVERY-CONTRACT-1 |
| Service levels | PARTIAL_EXTENSIBLE | delivery method + rate infrastructure | Extend | No Standard/Midnight/etc configurable schedule contract | FLOWERS-DELIVERY-CONTRACT-1 |
| Cutoffs | MISSING | None found | Shared delivery promise | Current same-day cannot be derived safely | FLOWERS-DELIVERY-CONTRACT-1 |
| Slot capacity | MISSING | None found | Shared delivery scheduling | Concurrency-sensitive | FLOWERS-DELIVERY-CONTRACT-1 |
| Earliest delivery promise | MISSING | None found | Shared delivery-promise service | Must be server-authoritative | FLOWERS-DELIVERY-CONTRACT-1 |
| Warehouse fulfillment source | PROVEN_EXISTING | `FulfillmentPolicyService` | Reuse | Good foundation for local florist branches | — |
| ATS | PROVEN_EXISTING | `AvailableToSellService` | Reuse | Warehouse/variant aware | — |
| Inventory reservation | PROVEN_EXISTING | `InventoryReservationService` | Reuse | Do not create florist-specific reservation table | — |
| Order reservation | PROVEN_EXISTING | `CommerceOrderReservationService` | Reuse | Reservation != stock movement/accounting | — |
| City-aware assortment | PARTIAL_EXTENSIBLE | publication + fulfillment source + ATS | Extend | No destination-aware listing policy today | FLOWERS-AVAILABILITY-1 |
| Same-day eligibility | MISSING | No combined promise service | Derive from shared authorities | Must combine ATS + prep + cutoff + destination + slot | FLOWERS-SAMEDAY-1 |
| Add-ons | MISSING | No product-backed add-on relationship found | Shared Commerce merchandising capability | Use real Product/Variant lines | FLOWERS-ADDONS-1 |
| Related products | PARTIAL_EXTENSIBLE | UI/recommendation surfaces exist | Could supply add-on discovery | Not a transactional add-on contract | FLOWERS-ADDONS-1 |
| Fixed bundles | MISSING | No bundle/kit domain found | Shared Commerce capability | Inventory/order decomposition unresolved | FLOWERS-BUNDLE-EVIDENCE-1 |
| Configurable bundles | MISSING | No domain found | Shared Commerce capability | Larger contract | FLOWERS-BUNDLE-EVIDENCE-1 |
| Bouquet BOM/recipe | MISSING | No BOM/assembly/recipe domain found | ERP/Inventory capability if approved | Costing/waste/substitution/accounting risk | FLOWERS-BOM-EVIDENCE-1 |
| Substitution policy | MISSING | No Commerce substitution audit model found | Flowers fulfillment policy | Must preserve original request and stock/accounting history | FLOWERS-SUBSTITUTION-EVIDENCE-1 |
| Failed delivery | MISSING | No dedicated local-delivery failure workflow found | Shared fulfillment capability | Retry/fees/perishable disposal/refund unresolved | FLOWERS-FAILED-DELIVERY-EVIDENCE-1 |
| Delivery exception notification | PARTIAL_EXTENSIBLE | communication/growth foundations documented | Reuse notification transport later | Transaction event contract not proven | FLOWERS-NOTIFICATIONS-1 |
| No-address recipient flow | MISSING | None | Flowers gifting workflow | Privacy, consent, TTL, contact attempts | FLOWERS-RECIPIENT-ADDRESS-1 |
| Returns / cancellation | PARTIAL_EXTENSIBLE | ERP returns/refunds/credit note boundaries exist | Reuse financial authorities | Commerce/perishable cutoff policy incomplete | FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1 |
| Partial cancellation | UNKNOWN | Payment refund statuses/ERP primitives exist, but no complete storefront contract proven in this audit | Evidence needed | High financial/lifecycle sensitivity | FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1 |
| COD / Pay on Pickup | PROVEN_EXISTING | Commerce payment-intent foundation | Reuse | No provider/card dependency | — |
| Online/card PSP | DEFERRED_PLANNED | Storefront capability design_only | Shared Commerce | Provider selection unresolved | COM-PAYMENTS-PROVIDER |
| Tax presentation in storefront | DEFERRED_PLANNED | capability registry says deferred | Shared Commerce | Must not infer VAT line client-side | COM-TAX-PRESENTATION |
| Money bouquets | CONFLICT_RISK | ordinary Product can technically represent item, but financial meaning does not fit normal product safely | Dedicated decision first | cash custody/tax/refund/fraud/accounting | FLOWERS-MONEY-GIFT-EVIDENCE-1 |
| Corporate gifting enquiry | PARTIAL_EXTENSIBLE | ERP customers/quotes + Commerce foundations | Reuse ERP B2B primitives | No gifting campaign/multi-recipient workflow | FLOWERS-CORPORATE-GIFTING-EVIDENCE-1 |
| Bulk pricing | PARTIAL_EXTENSIBLE | price-list foundations exist | Reuse shared pricing | Need current storefront/B2B exposure contract | FLOWERS-CORPORATE-GIFTING-EVIDENCE-1 |
| Store Builder | PROVEN_EXISTING | `StorefrontPresentationConfig` + section registry | Reuse | Add new section types/data sources, not new builder | FLOWERS-BUILDER-1 |
| Multi-page builder | PARTIAL_EXTENSIBLE | pagePresentation seam exists | Reuse the proven multi-page presentation seam | Flowers-specific PDP/category controls and data-bound sections still require bounded extension | FLOWERS-BUILDER-1 |
| Themes | PROVEN_EXISTING | theme presets / AWJ Market direction | Reuse | Theme must not own business logic | FLOWERS-THEME-1 |
| Arabic/RTL | PROVEN_EXISTING | storefront system | Reuse | Seed labels/content still need localization | — |

---

# 5. Catalog core

## 5.1 Product is already the master

**PROVEN_EXISTING**

`app/Models/Product.php` is the authoritative ERP product model.

It already carries:

- tenant/branch semantics;
- SKU/barcode;
- bilingual name;
- product type/unit;
- category;
- brand;
- pricing references;
- tax rate;
- inventory tracking;
- active lifecycle;
- product tags/internal notes;
- UOM foundations.

### Decision implication

Do **not** introduce `FlowerProduct`, `GiftProduct`, or a parallel vertical catalog.

Flowers & Gifts must enrich Product through bounded shared/vertical metadata.

---

## 5.2 Variants are mature and should be reused

**PROVEN_EXISTING**

`app/Models/ProductVariant.php` proves:

- deterministic combinations;
- option-value membership;
- variant SKU;
- variant-specific inventory state;
- variant-specific pricing;
- variant-specific media.

This is directly suitable for ordinary sellable choices such as:

- cake weight;
- cake flavor;
- arrangement size;
- gift size;
- color when color changes the sellable SKU.

### Important boundary

Do not represent:

- gift message;
- image upload;
- engraving text;
- delivery date;
- recipient;

as variants.

Those are transaction/customer inputs, not SKU identity.

---

# 6. Categories, facets, collections

## 6.1 Categories are real but insufficient for FNP-style discovery

**PROVEN_EXISTING for hierarchy**
**MISSING for general facets**

Current storefront catalog supports:

- `category_id`;
- text search;
- sort.

Repository evidence explicitly records that storefront product filters currently return an empty facets list.

That means FNP-style simultaneous discovery:

```text
Category
+ Occasion
+ Recipient
+ Flower Type
+ Flower Color
+ Packaging
+ Flavor
+ Serving Size
+ Brand
+ Delivery
```

cannot be represented honestly through today's public filtering contract.

## 6.2 Do not overload category hierarchy

The existing category authority should remain the stable structural taxonomy.

Recommended direction:

```text
ProductCategory
  = structural hierarchy

Product Attribute / Facet
  = filterable descriptive dimension

Collection
  = curated/rule-based merchandising group

Occasion / Recipient
  = vertical semantic facets or first-class vertical dimensions
```

Exact data model remains for `FLOWERS-TAXONOMY-1`.

---

# 7. Collections

**MISSING**

No distinct live Commerce Collection domain was found in this audit.

This is important because FNP evidence proves that a curation can include products that do not all share the same Occasion facet.

Therefore:

```text
Collection != Category
Collection != Facet
```

AWJ needs a shared Commerce merchandising concept if it wants:

- Best Sellers;
- New Arrivals curation;
- Seasonal campaign;
- Premium Gifts;
- Deliver Today;
- Flowers & Chocolate;
- merchant-curated homepage rows.

Some current Store Builder sections can render categories/new arrivals, but that is not equivalent to a reusable persisted Collection domain.

---

# 8. Search and filters

## Current state

**PARTIAL_EXTENSIBLE**

`StorefrontProductController` supports:

- search;
- category filter;
- sorting;
- pagination;
- publication gating;
- authoritative price;
- derived availability.

Search is currently simple product-field matching, not a rich intent/facet search system.

## Flowers implication

A search such as:

```text
هدية تخرج لها ورد يوصل اليوم
```

cannot safely be mapped today to:

- Occasion = Graduation;
- Recipient = Her;
- Product family = Flowers;
- Delivery eligibility = Today.

This should remain a future discovery layer on top of structured facets.

Do not start with AI search.

First build trustworthy structured filters.

---

# 9. Publication and location-aware assortment

## Existing strengths

**PROVEN_EXISTING**

`CommerceListing` already separates Commerce publication from Product master data.

`CommerceCategoryListing` similarly separates category publication.

This is the correct foundation.

## Gap

FNP evidence shows assortment can vary by delivery geography.

AWJ publication today is primarily:

```text
Product × Sales Channel
```

Flowers may eventually need availability closer to:

```text
Product
× Sales Channel
× Fulfillment Source
× Destination
× Service Level
× Date/Slot
```

Do not solve this by duplicating Product rows per city.

Recommended task:

`FLOWERS-AVAILABILITY-1`

---

# 10. Inventory / ATS / reservation

This is one of AWJ's strongest reusable areas.

## ATS

**PROVEN_EXISTING**

`AvailableToSellService` computes:

```text
max(0, On Hand - Active Reserved)
```

warehouse-aware and variant-aware.

## Reservation

**PROVEN_EXISTING**

`InventoryReservationService` and `CommerceOrderReservationService` already establish:

- atomic reservation;
- concurrency behavior;
- explicit source identity;
- no accounting effect;
- no stock movement at reservation time.

### Flowers implication

Do not create:

- `FlowerReservation`;
- `BouquetReservation`;
- per-storefront stock counters.

Any Flowers availability calculation must consume these authorities.

---

# 11. Cart

## Server authority

**PROVEN_EXISTING**

`CommerceCart` is:

- tenant-scoped;
- storefront/channel-scoped;
- server-authoritative;
- anonymous-capable;
- customer-claimable;
- status-controlled.

Cart identity merge work is already implemented and tested.

## Important gap

`CommerceCartItem` currently contains a closed transactional shape:

- product;
- optional variant;
- product-name snapshot;
- unit;
- quantity.

There is no general live payload for:

- product personalization;
- gift message;
- selected add-ons relationship;
- recipient metadata;
- delivery customization.

### Direction

Do not add an uncontrolled `metadata JSON` dumping ground.

Define typed side data or a bounded extensible schema in a dedicated contract.

---

# 12. Checkout

## Existing checkout

**PROVEN_EXISTING**

`CommerceCheckout` already separates checkout from order.

Repository contracts preserve:

```text
CommerceCheckout != CommerceOrder
CommerceOrder != Invoice
```

Current checkout supports:

- contact;
- delivery address;
- delivery method;
- shipping amount;
- payment method;
- completion idempotency;
- immutable order creation.

## Flowers extension points

Potential Flowers checkout information includes:

- sender display identity;
- recipient identity;
- gift message;
- no-address mode;
- requested delivery date;
- requested slot;
- personalization confirmation.

These should extend the existing checkout lifecycle rather than creating `FlowerCheckout`.

---

# 13. Customer identity and addresses

## Address book

**PROVEN_EXISTING**

`CommerceCustomerAddress` is already:

- customer-owned;
- tenant-safe;
- independent from ERP Partner;
- Saudi National Address aware;
- capable of shipping/billing defaults.

Checkout selection copies address fields into checkout/order context rather than storing a mutable reference.

That snapshot rule is exactly correct for gifting.

## Saved recipient

**MISSING**

A saved recipient is not merely an address.

Potential model:

```text
SavedRecipient
- customer owner
- name
- phone
- relationship
- one-or-more addresses
- optional event/reminder metadata
```

This must not silently become an ERP Partner.

---

# 14. Gift identity

**MISSING**

No current model was found for the four-way distinction:

```text
Purchaser
Billing identity
Gift sender display identity
Delivery recipient
```

FNP evidence proves this distinction matters.

Recommended task:

`FLOWERS-GIFTING-IDENTITY-1`

This task should determine which data is:

- CustomerIdentity-owned;
- Checkout-owned;
- Order snapshot;
- optional marketing data;
- recipient-only delivery data.

---

# 15. Product personalization

**MISSING as a transaction capability**

AWJ already has excellent merchant product-media infrastructure.

But `ProductMedia` represents merchant/catalog assets.

Customer-uploaded personalization is a different security/lifecycle problem.

## Required concerns

- input definitions per product;
- text/image/select input types;
- required/optional;
- max length;
- MIME allowlist;
- size/count limits;
- tenant isolation;
- temporary vs retained storage;
- secure upload authorization;
- fulfillment visibility;
- immutable order snapshot/reference;
- deletion/retention policy.

### Explicit decision

Do not reuse ProductMedia rows for customer uploads merely because storage already exists.

Reuse the storage/service patterns, not the domain object.

---

# 16. Care / allergens / safety

**MISSING as structured product content**

The Product model has generic description and attributes such as brand/tags, but no proven general typed content-block model for:

- composition;
- care instructions;
- allergens;
- storage;
- safety warnings;
- personalization instructions;
- delivery disclaimer.

Recommended:

`FLOWERS-CONTENT-1`

Prefer a reusable shared Catalog content-block/profile capability over one database column per flower/cake concern.

---

# 17. Store Builder

## Existing foundation

**PROVEN_EXISTING**

`StorefrontPresentationConfig` supports:

- theme preset;
- tokens;
- branding;
- header;
- homepage section instances;
- section authored content;
- footer;
- contact;
- WhatsApp;
- social;
- legal/verification surfaces;
- apps;
- content pages;
- page-presentation namespace.

Existing section model is structured and normalized fail-closed.

## Flowers direction

Do not build a second "Flower Store Builder".

Extend the existing registry with bounded section types/data sources such as:

- Shop by Occasion;
- Shop by Recipient;
- Gift Combos;
- Deliver Today;
- Personalized Gifts;
- Brands;
- Premium Collection.

Business eligibility must be computed outside presentation code.

---

# 18. Wishlist

**MISSING backend / DESIGN_ONLY UI**

The repository says this explicitly:

`WISHLIST_CAPABILITY = "design_only"`

The storefront deliberately does not persist wishlist in local storage because that would falsely imply account-level persistence.

This is a good existing design discipline.

Flowers does not need a vertical wishlist.

It needs shared Commerce:

`COM-WISHLIST-1`

---

# 19. Promotions and coupons

**DEFERRED_PLANNED**

The storefront has designed surfaces but no live discount authority.

`COUPON_CAPABILITY = "design_only"`

ADR-11 explicitly defers promotions and says the eventual engine must be shared Commerce.

This is correct.

Do not create:

- flower coupon table;
- theme discount;
- client-side percentage discount.

Any promotion must be server-authoritative and integrated with order totals/payment obligation.

---

# 20. Shipping and delivery rate

## Current shipping-rate authority

**PROVEN_EXISTING**

`CommerceShippingZone` supports:

- city match;
- region match;
- active/inactive;
- server-authoritative rate.

`ShippingRateService` resolves city before region.

This is a strong V1 foundation.

## Missing scheduling layer

Current shipping-rate logic does not equal:

- date availability;
- time slot;
- service level schedule;
- cutoff;
- capacity;
- preparation lead time;
- blocked dates;
- earliest delivery.

These need a shared delivery scheduling/promise contract.

Recommended:

`FLOWERS-DELIVERY-CONTRACT-1`

Despite the task name, the resulting service likely belongs largely to shared Commerce/Fulfillment.

---

# 21. Delivery service levels

**PARTIAL_EXTENSIBLE**

AWJ has a delivery method and shipping authority.

It does not yet have a proven general service-level model equivalent to:

- Standard;
- Midnight;
- Same-day;
- Next-day;
- Fixed-time.

Do not hard-code FNP names.

Model merchant-configurable service levels with capabilities/policy.

---

# 22. Same-day

**MISSING as an authoritative derived promise**

FNP's same-day evidence shows this must not be a static category.

AWJ has several ingredients:

- CommerceListing;
- FulfillmentPolicy;
- ATS;
- reservation;
- shipping zones/rates.

Missing ingredients:

- prep lead time;
- cutoff;
- date/calendar;
- slot/service-level availability.

Therefore `Deliver Today` should remain blocked until a server service can answer it truthfully.

---

# 23. Add-ons

**MISSING**

No dedicated live product/add-on relationship was found.

Correct direction:

- add-on resolves to a real Product/Variant;
- price from Commerce pricing;
- inventory from ATS;
- becomes a real order line;
- relationship/eligibility is merchandising data.

Do not store add-on price directly in Flowers metadata.

---

# 24. Bundles

**MISSING**

No general fixed/configurable bundle domain was found.

This is a shared Commerce gap, not Flowers-only.

Required evidence questions:

- one price or sum of components;
- component-level tax;
- component-level inventory;
- substitutions;
- fulfillment;
- returns;
- order-line decomposition;
- accounting allocation.

Recommended:

`FLOWERS-BUNDLE-EVIDENCE-1`

Name is Flowers-driven, but the eventual capability may belong in Commerce Core.

---

# 25. Bouquet composition / BOM

**MISSING**

Repository search found no suitable BOM/recipe/assembly domain that can be safely reused for florist bouquet composition.

Product variants are **not** a BOM.

Bundles are **not automatically** a BOM.

A bouquet can consume:

- flower stems;
- wrapping;
- ribbon;
- foam;
- vase;
- accessories;
- labor.

This affects:

- component stock;
- wastage;
- cost;
- substitutions;
- profitability.

Recommended:

`FLOWERS-BOM-EVIDENCE-1`

No implementation until inventory/accounting implications are approved.

---

# 26. Substitution

**MISSING**

The repository contains strict variant-integrity tests using the word substitution, but those explicitly prevent accidental sibling variant replacement.

That is not a florist substitution capability.

No live model was found for:

- requested component;
- actual substituted component;
- reason;
- approver/operator;
- customer consent;
- value rule;
- price effect;
- inventory effect.

Recommended:

`FLOWERS-SUBSTITUTION-EVIDENCE-1`

---

# 27. Failed delivery

**MISSING**

No dedicated Commerce failed-delivery workflow was found for local florist delivery.

A complete contract must cover:

- unreachable recipient;
- absent recipient;
- refused delivery;
- wrong address;
- retry;
- redelivery fee;
- return to shop;
- perishable disposal;
- refund eligibility;
- proof of attempt.

Recommended:

`FLOWERS-FAILED-DELIVERY-EVIDENCE-1`

---

# 28. No-address gifting

**MISSING**

AWJ has strong address infrastructure, but no workflow where:

- purchaser supplies only recipient phone/city;
- order proceeds with address pending;
- recipient is contacted later;
- delivery address is collected before fulfillment.

This is not a simple nullable address.

It introduces a stateful recipient-contact workflow and privacy rules.

Recommended:

`FLOWERS-RECIPIENT-ADDRESS-1`

---

# 29. Order tracking

## Backend

**PARTIAL_EXTENSIBLE**

AWJ has:

- Commerce Order;
- authenticated customer order history API;
- order serializer;
- guest/signed reference patterns.

## Gap

A complete customer-visible fulfillment timeline with:

- processing;
- out for delivery;
- exception;
- delivered;
- failed;

is not proven as a live Storefront contract in this audit.

Do not copy FNP's status vocabulary.

Build from AWJ's real order/payment/fulfillment authorities.

---

# 30. Notifications

**PARTIAL_EXTENSIBLE**

AWJ has mail/auth notification infrastructure and a documented Growth/communication direction that anticipates WhatsApp/SMS/Email routing.

No evidence in this pass proves a live generic Commerce transaction-event notification bus covering:

- recipient contact;
- dispatch;
- delay;
- substitution approval;
- failed delivery.

Recommended:

`FLOWERS-NOTIFICATIONS-1`

Prefer a shared event/communication capability.

---

# 31. Returns / cancellation / refund

**PARTIAL_EXTENSIBLE with financial risk**

AWJ already has ERP financial/document authorities for returns/refunds/credit-note boundaries.

But Flowers introduces policy questions:

- cancellation before preparation;
- after personalization starts;
- after bouquet assembly;
- after dispatch;
- perishable product return;
- failed delivery;
- partial cancellation;
- substitution dispute.

These policies must not bypass:

- Payment Intent;
- Invoice;
- Credit Note;
- Inventory;
- Accounting.

Recommended:

`FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1`

---

# 32. Payments

## Cash settlement

**PROVEN_EXISTING**

Commerce Payment Intent foundation exists for:

- COD;
- Pay on Pickup.

## Online/card

**DEFERRED_PLANNED**

The storefront capability registry explicitly says online/card is still design-only because no PSP is integrated.

Flowers must not build its own payment path.

---

# 33. Tax presentation

**DEFERRED_PLANNED**

Storefront tax presentation is explicitly deferred.

This is especially important because FNP visually exposes VAT arithmetic, but AWJ must not imitate that client-side.

Invoice Core remains tax/ZATCA authority.

Any pre-invoice tax presentation needs its own approved shared Commerce contract.

---

# 34. Money bouquets

**CONFLICT_RISK — high**

AWJ Product could technically create a SKU named "1000 SAR Money Bouquet".

That does **not** make the embedded cash ordinary merchandise.

Potential issues:

- cash custody;
- revenue vs pass-through value;
- VAT/tax;
- refunds;
- denomination;
- fraud;
- payment method restrictions;
- cash reconciliation;
- ZATCA/invoice representation.

Therefore:

```text
Money Bouquet
!=
normal fixed bundle
```

Recommended:

`FLOWERS-MONEY-GIFT-EVIDENCE-1`

No implementation before accounting/legal evidence.

---

# 35. Corporate gifting

**PARTIAL_EXTENSIBLE**

AWJ already has stronger ERP foundations than a typical standalone gifting store:

- B2B customers;
- quotations;
- sales documents;
- pricing foundations;
- bank/payment methods;
- product catalog.

Missing gifting-specific orchestration may include:

- campaign/batch;
- recipient import/list;
- multi-address fulfillment;
- branded personalization;
- sample approval;
- MOQ workflow.

Do not create parallel B2B customer or quotation systems.

Recommended:

`FLOWERS-CORPORATE-GIFTING-EVIDENCE-1`

---

# 36. Tenant isolation

Future Flowers capability must preserve existing tenancy patterns.

High-risk new data:

- saved recipients;
- recipient phones;
- recipient addresses;
- customer-upload personalization images;
- gift messages;
- substitution records;
- delivery attempts;
- money-gift details;
- delivery slot reservations.

Required rules:

1. every persisted object tenant-owned or reachable only through a tenant-owned root;
2. public storefront context comes from resolved Storefront/SalesChannel, never client tenant id;
3. customer data additionally scoped to authenticated CustomerIdentity;
4. customer-upload media uses unguessable, guarded references;
5. public order tracking cannot be enumerable;
6. async jobs reconstruct tenant context from trusted persisted ownership;
7. no cross-tenant recipient/address/media reuse.

---

# 37. Accounting safety

The following must remain outside Flowers presentation logic:

- price;
- tax;
- discount;
- shipping amount;
- payment status;
- invoice amount;
- refund;
- COGS;
- inventory valuation;
- cash gift value.

Capabilities requiring dedicated accounting review:

- money bouquets;
- bundle allocation if one commercial price maps to components;
- substitution with value difference;
- complimentary add-ons;
- partial cancellation after payment/invoice;
- failed-delivery refunds;
- spoilage/wastage if BOM is introduced.

No Flowers table should become an alternate ledger.

---

# 38. Backward compatibility

The vertical should be additive.

A non-Flowers merchant must continue to work with:

- ordinary Product;
- category;
- existing storefront;
- current checkout;
- existing shipping rates;
- current Store Builder;
- POS;
- invoicing;
- inventory.

Recommended activation model:

```text
tenant/store vertical capability = flowers_gifts
```

enables suggested capabilities/configuration but does not rewrite base Commerce behavior.

Avoid:

- mandatory Flowers columns on every Product;
- global checkout steps that all merchants must complete;
- hard-coded Occasion/Recipient fields in core Product;
- theme-owned domain state.

---

# 39. Reuse as-is

The strongest reusable foundations are:

- Product;
- ProductVariant;
- Product options/values;
- ProductMedia for merchant catalog media;
- Product/category publication;
- CommerceListing;
- CommerceCart;
- cart customer identity merge;
- CommerceCheckout;
- CommerceOrder;
- CommerceOrderSnapshot pattern;
- CommerceCustomerAddress;
- CustomerIdentity;
- customer order history backend;
- FulfillmentPolicy;
- AvailableToSellService;
- InventoryReservationService;
- CommerceOrderReservationService;
- CommerceShippingZone;
- ShippingRateService;
- COD/Pay-on-Pickup Payment Intent;
- Storefront Presentation / Store Builder;
- Theme presets;
- Arabic/RTL/localization foundations.

---

# 40. Reuse with bounded extension

These are real foundations but need extension:

- Brand → storefront facet/landing;
- category/search → general facets;
- CommerceListing → destination/fulfillment-aware assortment;
- Product content → structured care/safety/allergen blocks;
- Cart/Checkout → gifting/personalization side data;
- Commerce Order Snapshot → immutable gifting context;
- customer account → saved recipients/wishlist/storefront bridge;
- shipping → service levels/date/slot/cutoff/capacity;
- order history → tracking timeline;
- notification foundations → commerce event delivery;
- ERP returns/refunds → perishable/personalized-commerce policy;
- B2B ERP → corporate gifting orchestration.

---

# 41. New capability required

Current audit finds these genuinely absent:

- Facet engine;
- Collection domain;
- Occasion;
- Recipient merchandising;
- Gift message;
- Gift sender identity;
- Saved recipient;
- Product personalization schema;
- Customer personalization media;
- Cart-line personalization persistence;
- Add-on relationship;
- Fixed/configurable bundles;
- Bouquet BOM/recipe;
- Delivery schedule/date/slots;
- Cutoff/capacity;
- Earliest-delivery service;
- No-address recipient workflow;
- Substitution audit;
- Failed-delivery workflow.

---

# 42. Defer / dedicated gate

Do not include in first implementation slice:

- money bouquets;
- corporate gifting;
- bouquet BOM;
- configurable bundles;
- advanced substitutions;
- promotion engine;
- online PSP;
- full returns/cancellation policy;
- no-address workflow;
- delivery exception automation;
- advanced SEO page factory.

---

# 43. Smallest safe Flowers & Gifts MVP

Based on current AWJ architecture, the smallest valuable vertical is:

## Phase A — vertical taxonomy and merchandising

- vertical enablement;
- Occasion;
- Recipient merchandising;
- generic facet support needed by flowers/cakes;
- storefront filter exposure;
- Store Builder sections for Occasion/Recipient.

No checkout change yet.

## Phase B — gifting identity

- sender display;
- delivery recipient;
- gift message;
- immutable snapshot.

Reuse customer/address/order foundations.

## Phase C — personalization

- product-defined text/image inputs;
- tenant-safe upload;
- cart/order snapshot;
- fulfillment/admin visibility.

## Phase D — add-ons

- product-backed;
- server price/inventory;
- separate order lines.

## Phase E — delivery scheduling

- service level;
- requested date;
- slot;
- cutoff;
- lead time;
- capacity;
- earliest delivery;
- Deliver Today query.

Only after this foundation should AWJ tackle:

- bundles;
- BOM;
- substitutions;
- no-address;
- money gifts;
- corporate gifting.

---

# 44. Recommended task sequence

1. **FLOWERS-TAXONOMY-1**  
   Contract for Category vs Facet vs Collection vs Occasion vs Recipient vs Brand.

2. **FLOWERS-GIFTING-IDENTITY-1**  
   Purchaser vs sender vs delivery recipient vs saved recipient.

3. **FLOWERS-PERSONALIZATION-1**  
   Field definitions, uploads, snapshots, security/retention.

4. **FLOWERS-CONTENT-1**  
   Care, composition, allergens, safety, delivery instructions.

5. **FLOWERS-ADDONS-1**  
   Product-backed add-on relationship.

6. **FLOWERS-DELIVERY-CONTRACT-1**  
   Service level/date/slot/cutoff/lead-time/capacity/earliest delivery.

7. **FLOWERS-AVAILABILITY-1**  
   Destination + fulfillment-source + ATS + service-level eligibility.

8. **FLOWERS-SAMEDAY-1**  
   Derived "Deliver Today" merchandising.

9. **FLOWERS-ACCOUNT-BRIDGE-1**  
   Storefront customer account/history/wishlist integration where shared Commerce permits.

10. **FLOWERS-RETURNS-CANCELLATION-EVIDENCE-1**

11. **FLOWERS-SUBSTITUTION-EVIDENCE-1**

12. **FLOWERS-FAILED-DELIVERY-EVIDENCE-1**

13. **FLOWERS-BUNDLE-EVIDENCE-1**

14. **FLOWERS-BOM-EVIDENCE-1**

15. **FLOWERS-RECIPIENT-ADDRESS-1**

16. **FLOWERS-MONEY-GIFT-EVIDENCE-1**

17. **FLOWERS-CORPORATE-GIFTING-EVIDENCE-1**

18. **FLOWERS-BUILDER-1**

19. **FLOWERS-THEME-1**

---

# 45. Relationship to PR #1179

PR #1179 (`AWJ_FLOWERS_GIFTS_VERTICAL_V1.md`) is still open and was authored before:

- the deep FNP audit;
- the corrected current-FNP evidence;
- this repository reuse/gap audit.

Therefore it should not be merged unchanged as final architecture.

Recommended next action after this audit is reviewed:

1. rebase/update the vertical direction against current `main`;
2. revise it using this reuse/gap audit;
3. preserve its valid core principle:
   **Flowers & Gifts is a Vertical Pack, not a Theme**;
4. remove or qualify any data-model assumption that this audit has shown requires a shared Commerce contract first.

---

# 46. Final conclusion

AWJ is already technically capable of supporting a serious Flowers & Gifts vertical without rebuilding core Commerce.

The highest-value architecture choice is to **reuse the mature Commerce authorities and add the missing semantic/merchandising/fulfillment layers in the correct ownership domain**.

The critical boundary is:

```text
Flowers & Gifts Vertical
must orchestrate Commerce capabilities
but must not become a second Catalog,
second Inventory,
second Checkout,
second Payment system,
or second Accounting authority.
```

The immediate next architecture task should be **FLOWERS-TAXONOMY-1**, because taxonomy/facets/collections/occasion/recipient determine both merchant catalog UX and storefront discovery, while requiring no financial or inventory-rule change.
