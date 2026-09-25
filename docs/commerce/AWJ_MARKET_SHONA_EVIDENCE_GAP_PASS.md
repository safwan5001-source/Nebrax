# AWJ Market — Shona Evidence & Feature Gap Pass

**Status:** Evidence pass in progress  
**Reference storefront:** https://store.shonaksa.com/  
**Theme working name:** `AWJ Market`  
**Theme key proposal:** `awj-market`

## 1. Purpose

Define a reusable AWJ Store theme for high-density retail, grocery, supermarket, and large-catalog commerce, using Shona Store as an external benchmark without copying its brand identity or proprietary assets.

This document is evidence-first. It separates:

1. externally observed reference behavior,
2. verified existing AWJ capability,
3. partial capability / wiring gaps,
4. missing product capabilities,
5. AWJ decisions and proposals.

No missing capability is to be implemented implicitly as part of theme work.

## 2. Scope of the evidence pass

Review both desktop and mobile behavior across:

- Home
- Header and search
- Navigation and categories
- Product grids and product cards
- Category/catalog pages
- Search and filtering
- Offers
- Product detail
- Variant/product availability
- Branch availability
- Favorites
- Cart
- Checkout
- Customer/account surfaces
- Reviews
- FAQ/content sections
- Store location
- Trust/service sections
- App promotion
- Policies
- Footer
- Mobile bottom navigation
- Loading, empty, unavailable, and error states where observable

## 3. Initial external evidence

Initial inspection of the public Shona storefront confirms or indicates the following patterns. These are reference observations, not yet AWJ implementation decisions.

| Reference capability | Initial evidence state | AWJ comparison state |
|---|---|---|
| Promotional hero/banners | Observed | Compare with Store Customizer sections |
| Category discovery | Observed | Existing AWJ catalog capability; verify storefront parity |
| Dense product catalog | Observed | Existing direction; verify component parity |
| Search | Observed | Existing AWJ capability; verify UX parity |
| Product detail | Observed | Existing AWJ capability |
| Product media | Observed | Existing AWJ capability |
| Price + add to cart | Observed | Existing Commerce flow; verify current contract |
| Purchase-count/social proof | Observed on product surface | Gap verification required |
| Barcode/model metadata | Observed on product surface | Public storefront exposure verification required |
| Branch availability / choose branch | Observed | High-priority gap verification |
| Offers/discount discovery | Observed | Promotions capability comparison required |
| Favorites | UI indication observed | End-to-end capability verification required |
| Customer reviews | Observed | Gap verification required |
| FAQ | Observed | Candidate Store Customizer content section |
| WhatsApp/contact | Observed | Verify current storefront presentation capability |
| Store location/map | Observed | Candidate section / capability verification |
| Trust/service features | Observed | Candidate reusable content section |
| App promotion | Observed | Verify existing presentation/app-link capability |
| Policies | Observed | Pages/content capability verification required |
| Mobile bottom navigation | Observed | Compare with AWJ mobile baseline |

## 4. Feature-gap classification

Every benchmark item must be assigned exactly one implementation state after repository/API verification:

- **EXISTING** — supported end-to-end and reusable by the theme.
- **WIRING_GAP** — backend/domain capability exists but Storefront/API/UI wiring is incomplete.
- **PARTIAL** — capability exists but does not satisfy the required commerce behavior.
- **MISSING** — no verified AWJ capability exists.
- **THEME_ONLY** — presentation capability requiring no new domain behavior.
- **DEFER / REJECT** — not justified for AWJ Market.

## 5. High-priority investigation: branch availability

The reference storefront exposes product availability by branch and a branch-selection interaction.

AWJ must not imitate this as static theme UI. Before proposing implementation, verify the complete truth path:

`Product / Variant → inventory source (branch/warehouse) → sellable availability → Storefront API → customer branch selection → Cart → Checkout`

Required evidence before an AWJ decision:

- existing inventory-by-branch/warehouse model,
- storefront-safe availability contract,
- variant-level behavior,
- out-of-stock behavior,
- branch/store selection persistence,
- cart validation when stock changes,
- checkout revalidation,
- reservation semantics, if any,
- tenant isolation,
- information-leak boundaries between internal stock and public sellable availability.

The storefront should expose only the public availability semantics required for commerce, not internal accounting/inventory details.

## 6. Reviews and social proof

Reference storefront uses customer-review/social-proof surfaces.

Before adding reviews to AWJ Market, verify whether AWJ currently has:

- review/rating persistence,
- authenticated or verified-purchase eligibility,
- moderation,
- tenant ownership/isolation,
- aggregate rating calculation,
- storefront API exposure,
- merchant controls,
- abuse/spam handling.

If these do not exist, reviews are a product feature proposal and **not** a theme-only task.

Likewise, any displayed purchase count must have a defined, privacy-safe source and semantics before exposure.

## 7. Theme architecture rules

AWJ Market is a reusable AWJ theme, not a Shona clone.

Do not copy:

- Shona branding,
- logos,
- proprietary images/content,
- hard-coded merchant colors,
- merchant-specific copy.

AWJ Market should consume the same commerce domain contracts as other AWJ themes. Theme differences should primarily live in composition, presentation, density, section presets, and theme tokens.

Merchant-facing customization should use the AWJ Store Customizer. Theme Tokens remain an internal implementation layer rather than merchant-facing terminology.

## 8. Proposed AWJ Market positioning

Primary fit:

- supermarkets,
- grocery,
- food and FMCG,
- high-SKU retail,
- household/general retail,
- other merchants needing dense, fast product discovery.

The name `Market` is intentionally broader than `Grocery`.

## 9. Planned evidence matrix

The final matrix will use this structure:

| Surface / capability | External evidence | AWJ repository/API evidence | State | Decision / proposal | Dependencies | Priority |
|---|---|---|---|---|---|---|

No row may be marked EXISTING without repository/API evidence.

## 10. Execution sequence

1. Complete external page/surface inventory on desktop and mobile.
2. Verify each capability against current AWJ repository and APIs.
3. Produce the Feature Gap Matrix.
4. Separate theme-only work from product/domain gaps.
5. Define AWJ Market Theme Spec: pages, sections, blocks, cards, responsive behavior, states, and customization controls.
6. Review and approve the spec before implementation.
7. Implement in small scoped PRs.
8. Run focused tests first, then broader tests where financial, inventory, security, checkout, or tenant-isolation behavior is affected.
9. No merge, deploy, or production release without explicit approval.

## 11. Current decisions

- Working theme name: **AWJ Market**.
- Proposed internal key: **`awj-market`**.
- Evidence and gap analysis precede implementation.
- Missing features are separate scoped product proposals; they are not silently bundled into theme work.
- Branch availability is a high-priority capability investigation.
- Desktop and mobile parity are required before the theme is considered complete.

## 12. Open evidence work

This document is intentionally not final. Next evidence passes must add:

- exact page/surface inventory,
- screenshots or stable references where appropriate,
- repository/API evidence for each AWJ comparison,
- mobile behavior,
- cart/checkout behavior,
- availability semantics,
- promotions,
- favorites,
- reviews,
- content/pages,
- final gap priorities and dependencies.


## 14. External Evidence Pass 02 — additional confirmed patterns

Evidence captured from the public reference storefront on 2026-09-25. These are reference observations, not AWJ implementation decisions.

### Home and content surfaces

The public storefront confirms a commerce-oriented home composition that includes promotional messaging, category discovery, FAQ, customer testimonials/reviews, store location/map, merchant story/about content, trust/service features, app promotion, and policy/business-information links.

### Dedicated offers discovery

A dedicated public offers surface exists. AWJ Market should therefore verify whether current AWJ promotions can deterministically power an offers collection, including variant pricing, validity windows, sales-channel eligibility, and tenant isolation. This is not assumed to be theme-only.

### Product-detail evidence

Multiple unrelated product pages consistently expose price, add-to-cart, purchase-count/social-proof information, a model/barcode-like identifier, branch availability, and branch selection. Because the availability pattern appears across multiple products, it is treated as an intentional reference capability rather than a one-product anomaly.

Important: AWJ must not assume the reference model number maps directly to AWJ SKU, barcode, GTIN, or variant ID. The public identifier contract must be verified first. Likewise, purchase counts require defined aggregation, return/cancellation semantics, and privacy-safe exposure before AWJ can reproduce them.

### Evidence matrix additions

| Capability | External evidence | AWJ state | Required verification |
|---|---|---|---|
| Dedicated offers page | Confirmed | Unknown | Promotions to storefront collection |
| Purchase count | Confirmed on multiple PDPs | Unknown | Domain source and privacy semantics |
| Model/barcode-like identifier | Confirmed | Unknown public mapping | SKU/barcode/GTIN contract |
| Branch availability | Confirmed on multiple PDPs | High-priority verification | Inventory to storefront to cart |
| Branch selector | Confirmed | High-priority verification | Persistence and checkout validation |
| FAQ | Confirmed | Candidate THEME_ONLY/content | Customizer content blocks |
| Store location/map | Confirmed | Candidate THEME_ONLY/content | Store settings/location contract |
| Trust/service section | Confirmed | Candidate THEME_ONLY/content | Reusable section |
| App promotion | Confirmed | Verification required | Storefront app-link settings |
| Policies/business info | Confirmed | Verification required | Pages/public business profile |

### Updated branch-availability investigation

Reference evidence is now strong enough to make branch availability a formal capability investigation. AWJ must verify the complete truth path:

Product/Variant -> inventory source (branch/warehouse) -> sellable availability -> Storefront API -> customer branch selection -> Cart -> Checkout.

The public storefront contract should expose only commerce-safe availability. Internal stock-ledger quantities, costing, or accounting details must not become public merely because they exist in ERP.

### Candidate AWJ Market section inventory

Current evidence supports evaluating these reusable sections: announcement/promo strip, prominent-search header, hero banners, category shortcuts, product rails/grids, offers discovery, merchant story, trust/service features, reviews/testimonials, FAQ, store location/map, app promotion, and policy/business-information footer.

This remains an evidence-derived candidate inventory, not the final Theme Spec.

## 15. Next evidence pass — AWJ repository/API

The next pass must verify current AWJ implementation evidence for, in order:

1. branch/warehouse inventory and sellable availability,
2. public product identifiers/barcodes,
3. promotions/offers,
4. favorites,
5. reviews,
6. content/pages and policy links,
7. storefront business profile, location, and app links.

Only repository/API evidence can move a matrix item to EXISTING, WIRING_GAP, PARTIAL, or MISSING.


## 16. AWJ Repository/API Evidence Pass 01 — inventory and branch availability

Evidence verified against current `main` source.

### Verified existing capability

AWJ already has a real server-authoritative sellable-availability path. `AvailableToSellService::forWarehouse()` reads physical on-hand from `product_warehouse_stock` and subtracts active inventory reservations. The physical location key is explicitly `warehouse_id`; Commerce does not create a parallel stock balance.

`StorefrontProductController` resolves the Sales Channel fulfillment warehouse through `FulfillmentPolicyService::resolveWarehouseFor()`. Public catalog responses expose only derived `in_stock` state, not raw stock quantity, cost, valuation, or internal ledger detail. When no fulfillment policy is configured, availability is represented as unknown (`null`) rather than falsely unavailable.

Variant-managed PDPs are already variant-aware: each active variant receives its own resolved price, `in_stock`, descriptor, option values, and media. `AvailableToSellService::forWarehouse(..., variantId)` is the shared availability authority.

Cart and checkout are also variant-aware. Checkout revalidates sellable identity, publication, UOM, authoritative price, and warehouse stock; invalid or insufficient lines fail closed before order creation. Tenant isolation is enforced through tenant-scoped inventory models and fail-closed variant resolution.

### Important limitation for the Shona benchmark

Current storefront availability is resolved against the **single fulfillment warehouse configured for the Sales Channel**. This is materially different from a customer-facing list of multiple branches/locations where the shopper chooses a branch and sees availability per branch.

The existing architecture deliberately keeps Sales Channel, Branch, Warehouse, and future Pickup Location as distinct concepts. A Branch is not implicitly a Warehouse, and a Warehouse is not automatically a customer-selectable pickup/store location.

Therefore the Shona-style capability is classified as:

| Capability | Classification | Evidence-based reason |
|---|---|---|
| Server-authoritative sellable availability | **EXISTING** | Warehouse-scoped ATS + active reservations |
| Product-level public `in_stock` | **EXISTING** | Storefront list/detail derive availability server-side |
| Variant-level public `in_stock` | **EXISTING** | PDP resolves ATS per concrete variant |
| Checkout stock revalidation | **EXISTING** | Checkout fails closed on insufficient/unavailable sellable identity |
| Single channel fulfillment warehouse | **EXISTING** | Fulfillment policy resolves warehouse for Sales Channel |
| Public multi-branch/location availability list | **MISSING** | No verified public contract enumerates customer-visible locations with per-location availability |
| Customer branch/location selector | **MISSING** | Current warehouse authority is trusted server configuration, not browser-selected fulfillment authority |
| Persist selected pickup/store location through cart/checkout | **MISSING** | No verified current contract for customer-selected location persistence |
| Click & Collect / pickup-location domain | **DEFERRED / SEPARATE CAPABILITY** | Existing ADR explicitly keeps Pickup Location distinct and leaves its persistence/model for follow-up design |

### AWJ Market decision

Do **not** implement Shona's branch selector as a theme-only control and do not allow the browser to choose an arbitrary `warehouse_id`.

AWJ Market V1 can safely consume the existing `in_stock` contract. A future “availability by location / choose pickup location” feature requires a separately scoped Commerce capability that defines a public pickup/location identity, eligible warehouse mapping, tenant-safe exposure, cart persistence, checkout revalidation, and stock-change behavior.

This is a platform gap discovered by the theme benchmark, not a defect in the current storefront.

### Security and accounting boundary

The future public location feature must preserve these existing invariants:

- physical inventory truth remains in the inventory/warehouse domain;
- the client cannot override trusted warehouse authority directly;
- no internal stock ledger, cost, valuation, or accounting data is exposed publicly;
- all location/warehouse mappings are tenant-bound;
- variant-level availability remains concrete and fail-closed;
- no accounting, inventory-posting, or legacy ERP behavior changes as a side effect of theme work.

## 17. Matrix update after Repository/API Pass 01

The first major Shona gap is now resolved at architecture level: **AWJ has robust availability, but not customer-selectable multi-location availability.**

Next repository evidence pass:

1. public SKU/barcode/GTIN exposure,
2. promotions and dedicated offers collection,
3. favorites,
4. reviews/ratings,
5. content/pages/policies,
6. public business profile, map/location, and app links.


## 18. AWJ Repository/API Evidence Pass 02 — identifiers, offers, wishlist, reviews, content

Evidence verified against current `main` source.

### Product identifiers

`StorefrontProductResource` already exposes the product-level `sku` publicly. Variant detail payloads also expose each variant's `sku`. The Product domain also has a legacy/primary `Product.barcode` and separate multiple-barcode capability, but the public storefront resource does **not** expose barcode/GTIN fields.

Classification:

| Capability | State | Notes |
|---|---|---|
| Public product SKU | **EXISTING** | Explicit allow-listed field in StorefrontProductResource |
| Public variant SKU | **EXISTING** | Variant payload contains SKU |
| Public barcode/GTIN | **WIRING_GAP / CONTRACT DECISION REQUIRED** | Barcode exists internally, but is deliberately absent from the public allow-list; multiple-barcode semantics make a blind mapping unsafe |

AWJ Market must not label SKU as barcode/model number. If a public barcode/GTIN is justified, define which identifier is merchant/customer-facing and expose it explicitly through the safe public resource.

### Offers, discounts, and compare-at pricing

The storefront design already contains dormant sale/compare-at presentation branches, but current evidence states `original_price` is hard-null and `compare_at` is never populated. The sale badge/strikethrough therefore cannot become authoritative today. Coupon UX is also DESIGN_ONLY/GATED and has no server-authoritative cart discount contract yet.

Classification:

| Capability | State | Notes |
|---|---|---|
| Sale/compare-at presentation shape | **DESIGN_ONLY / GATED** | UI branches exist but no authoritative API value activates them |
| Authoritative compare-at/original price | **MISSING** | Current storefront contract does not provide it |
| Coupon/promotion-code UI | **DESIGN_ONLY / GATED** | Intended UX exists |
| Coupon monetary authority | **MISSING** | Cart lacks authoritative discount/total contract required by documented activation plan |
| Dedicated public Offers collection | **MISSING** | No verified storefront offers contract/query; cannot derive it client-side from fabricated discounts |

The Shona-style Offers page is therefore a real platform/catalog-merchandising gap, not merely a route to add to AWJ Market.

### Wishlist / favourites

AWJ already designed a reusable WishlistButton and WishlistContext across home, catalog/search/category results and PDP. However, the documented capability state is DESIGN_ONLY/GATED. Favourites live only in React page-lifetime state and intentionally do not use localStorage/cookies as fake persistence.

The missing substantive dependency is shopper identity plus real wishlist persistence/API.

Classification: **DESIGN_ONLY / GATED; backend/identity capability MISSING.**

AWJ Market may reuse the designed surface, but it must remain gated until a real customer identity and wishlist contract are active.

### Ratings and reviews

Current storefront policy explicitly classifies ratings/reviews as DEFERRED: no authoritative contract and nothing production-active.

Classification: **MISSING / DEFERRED.**

Shona evidence therefore identifies reviews as a genuine AWJ product capability candidate. It requires persistence, customer/verified-purchase identity rules, moderation, aggregation, tenant isolation, merchant controls, and abuse handling before activation.

### Content, contact, WhatsApp, policies and app links

The Storefront Presentation contract already contains merchant-configurable presentation data for:

- contact phone, email, address and hours;
- WhatsApp enabled state, phone, message and placement;
- social links;
- app name plus validated App Store and Google Play URLs, with homepage/footer visibility controls;
- content-page metadata for a closed set of page slugs;
- footer tagline/copyright;
- business verification-related metadata with explicit safeguards against self-minting a verified badge.

The Customizer architecture also already persists these presentation settings and the Footer consumes configured policy pages.

Classification:

| Capability | State | Notes |
|---|---|---|
| Contact details | **EXISTING** | Presentation contract |
| WhatsApp | **EXISTING** | Safe configurable presentation contract |
| Social links | **EXISTING** | Bounded presentation contract |
| App Store / Google Play links | **EXISTING** | URL validation + visibility controls |
| Policy-page navigation/metadata | **EXISTING / PARTIAL CONTENT MODEL** | Configured page metadata/navigation exists; do not infer arbitrary CMS/page-builder capability |
| Footer business information | **EXISTING / PARTIAL** | Several safe fields exist; exact Market footer requirements still need mapping |
| Store address text | **EXISTING** | Contact address |
| Interactive map/embed | **MISSING / NOT VERIFIED** | No safe map/embed contract verified in this pass; arbitrary HTML/JS is intentionally forbidden |

### Security note for map/location

Do not implement a merchant-pasted arbitrary iframe/HTML field. Current presentation persistence intentionally forbids arbitrary HTML/CSS/JS. If AWJ Market needs a map, prefer a structured location contract (for example coordinates or a validated map URL) rendered by an AWJ-owned component.

## 19. Consolidated high-value gap snapshot

After the first two repository passes, the benchmark has surfaced these material gaps:

1. **Customer-selectable multi-location availability / pickup location** — missing platform capability; existing single-warehouse ATS remains authoritative.
2. **Dedicated offers + authoritative compare-at/promotional pricing** — missing public monetary/catalog contract.
3. **Persistent wishlist** — designed but gated; needs shopper identity and backend persistence.
4. **Ratings/reviews** — missing/deferred product capability.
5. **Public barcode/GTIN** — internal data exists but public semantics/allow-list decision is missing.
6. **Structured map/location section** — address exists; safe interactive-map contract not verified.

These gaps must remain separate scoped capabilities. None should be silently implemented inside the AWJ Market theme PR.

## 20. Next pass

Next evidence work should complete the theme-side parity matrix: homepage section types, category/product-card density, search/filter/sort behavior, mobile bottom navigation, cart/checkout presentation, and responsive states. Then the document can be converted into the first complete AWJ Market Theme Spec candidate and reviewed for merge.


## 21. AWJ Repository/UI Evidence Pass 03 — theme-side parity

Evidence verified against current `main` storefront contracts, responsive baseline, and presentation tokens.

### Homepage composition

The presentation contract already recognizes these home section types: `hero`, `categories`, `newArrivals`, `wholesale`, `banner`, `featured`, `offers`, `benefits`, `appPromo`, and `customContent`.

However, the contract explicitly separates implemented sections from gated sections. `banner`, `featured`, `offers`, `benefits`, `appPromo`, and `customContent` are currently gated. Their presence in Theme Tokens is a design seam, not proof of a production data contract.

**AWJ Market decision:** use the existing section-instance architecture and ordering/visibility contract. Do not create a parallel Market-only page-builder schema. Market defines a preset/default composition; capabilities remain gated by the platform.

### Density and product cards

The current presentation system already supports `comfortable|compact` density, `standard|compact` product-card treatment, `standard|compact` header styles, and a bounded radius system.

The locked responsive baseline also establishes two-column mobile browsing, three-column tablet behavior, and denser desktop product grids; the catalog implementation validated two columns on mobile, three on tablet, and four on desktop.

Classification: **EXISTING presentation foundation.**

**AWJ Market decision:** default toward compact commerce density and compact product cards, while keeping merchant customization through the shared tokens. The theme must not fork ProductCard or catalog truth merely to achieve density.

### Search

Storefront search is already server-authoritative and searches `name`, `name_en`, and `sku`, with pagination. The existing responsive baseline requires prominent search access.

There is no authoritative contract for suggestions, trending queries, recent searches, typo tolerance, barcode search on the public storefront, or predictive autocomplete.

Classification:

- basic catalog search: **EXISTING**;
- prominent Market search composition: **THEME/PRESENTATION**;
- suggestions/autocomplete/trending/recent searches: **MISSING / DEFERRED** unless separately specified.

### Filters and sorting

Current public catalog supports category filtering plus server-side sorting by `name`, `sale_price`, and `created_at`, ascending/descending. It has no price, availability, option, brand, or other facet filters.

Classification:

- category filter: **EXISTING**;
- name/price/date sorting: **EXISTING**;
- faceted filtering: **MISSING**.

**AWJ Market decision:** do not draw fake supermarket facets. A future faceting capability should be server-authoritative and operate over the full eligible catalog, not a client-side partial page.

### Mobile bottom navigation

The locked AWJ Store Responsive Visual Baseline already requires persistent bottom navigation on primary mobile shopping surfaces and explicitly removes it from desktop.

Classification: **EXISTING/LOCKED storefront presentation requirement.**

AWJ Market should inherit the shared mobile navigation rather than create a theme-specific navigation system.

### Product detail and variants

The storefront already has authoritative product detail, media gallery, generic product options, concrete variant selection, variant price, variant availability, and variant-specific media. The generic model deliberately avoids inferring color/size semantics when the backend supplies no renderer metadata.

Classification: **EXISTING.**

AWJ Market can change PDP composition/density, but must reuse the generic variant contract and must not introduce grocery-specific assumptions into the product domain.

### Cart and checkout

Cart mutation and checkout remain server-authoritative. The client sends sellable identity/variant, unit and quantity, never authoritative price. Checkout revalidates commercial facts. Unsupported monetary claims remain gated.

Classification: **EXISTING commerce foundation; theme presentation may vary.**

AWJ Market must not create separate cart/checkout business logic. Dense cart rows, sticky actions, mobile composition, and visual hierarchy are theme/presentation concerns only.

### Responsive contract

The locked baseline covers approximately 390–430, 768, 1024, 1280 and 1440 widths; Arabic RTL and English LTR; mobile two-column product browsing where readable; progressively denser tablet/desktop layouts; and no horizontal overflow.

Classification: **EXISTING/LOCKED shared contract.**

AWJ Market is one responsive theme document, not separate desktop and mobile themes.

## 22. AWJ Market Theme Spec Candidate V1

### Identity

- Display name: **AWJ Market**
- Proposed internal key: `awj-market`
- Purpose: high-density commerce preset for grocery, supermarket, FMCG, household and other high-SKU retail, while remaining compatible with general catalog products.
- Reference role: Shona supplies evidence for useful commerce composition/patterns only; no Shona branding, proprietary assets, copy, or merchant identity is copied.

### Architecture

AWJ Market is a **theme/presentation preset over shared AWJ commerce contracts**, not a storefront fork.

It should reuse:

- StorefrontPresentationConfig and its safe normalization;
- shared ProductCard/ProductGrid/category/search components;
- existing product/variant/media/price/availability contracts;
- shared cart and checkout flows;
- shared mobile bottom navigation;
- content/contact/WhatsApp/social/app-link presentation contracts;
- tenant-resolved publication and commerce boundaries.

### Default visual/composition direction

- compact header with highly prominent search;
- dense category discovery near the top of the home page;
- compact, scan-friendly product cards;
- strong price and add-to-cart hierarchy;
- multiple catalog rails/collections only when backed by authoritative queries/contracts;
- restrained decoration so product discovery remains dominant;
- responsive two-column mobile browsing, progressive tablet density, and denser desktop grid;
- persistent shared mobile bottom navigation on primary shopping surfaces;
- RTL-first quality with equivalent LTR behavior;
- merchant colors, branding, radius and supported presentation settings remain customizable through shared Theme Tokens/Customizer.

### Candidate default home order

Subject to capability gates:

1. promotional/announcement area where configured,
2. hero/banner,
3. categories,
4. offers when authoritative offers exist,
5. featured products when authoritative selection exists,
6. new arrivals,
7. additional merchant-selected product/category sections when supported,
8. benefits/trust section when merchant-configured claims are supported,
9. app promotion when configured,
10. FAQ/content where enabled,
11. contact/location area,
12. shared footer/policies/business information.

A missing capability removes/gates its section; the theme must not fill the gap with fabricated commerce data.

### Product-card direction

AWJ Market should start from the shared compact ProductCard preset and optimize for rapid scanning:

- image remains clear but not oversized;
- product name receives enough lines for grocery/FMCG naming;
- authoritative price is visually dominant;
- availability is derived only from AWJ truth;
- add-to-cart is fast and obvious;
- variant-managed products retain generic selection rules;
- sale badge/original price remains absent until authoritative promotion pricing exists;
- wishlist remains gated until persistent identity/backend exists;
- ratings/purchase counts remain absent until their contracts exist.

### Catalog direction

- prominent search;
- category navigation;
- real server-side sort controls;
- no fake faceted filters;
- pagination/infinite-loading behavior continues to use authoritative API pages;
- future Market facets should be a shared platform capability, not theme-local filtering.

### Capability gaps discovered by the theme

Separate product workstreams are required for:

1. customer-selectable multi-location availability / pickup location;
2. authoritative promotions, compare-at pricing and dedicated offers collection;
3. persistent wishlist/customer identity;
4. ratings and reviews;
5. explicit public barcode/GTIN semantics if desired;
6. safe structured map/location rendering;
7. server-side catalog faceting;
8. optional search suggestions/autocomplete if later justified.

None of these belongs silently inside the first AWJ Market theme implementation PR.

### Initial implementation boundary

The first implementation slice should be presentation-only wherever possible: register the `awj-market` preset, establish its default shared token choices/composition, and apply Market-specific responsive presentation using existing components/contracts. Any required shared component extension must remain generic and backward-compatible with AWJ Modern and other themes.

No database, accounting, inventory-posting, tenant-resolution, price authority, cart authority, or checkout authority change is justified by this Theme Spec alone.

## 23. Evidence-pass conclusion

The benchmark is now sufficiently classified to proceed from discovery to a scoped implementation plan. The core Market experience can be built on the existing AWJ storefront architecture. The main missing items are platform capabilities, not reasons to fork the theme or duplicate commerce truth.

Before implementation, create a small Theme Implementation Plan that identifies exact shared files/components, compatibility tests, visual acceptance widths, and which gated sections remain intentionally inactive. Implementation should then proceed as small reviewable PRs.


## 24. Master Pre-Implementation Pass — Horizon execution preparation

### Execution strategy

AWJ Market will not move into implementation piecemeal. The repository evidence, visual/theme contract, capability gates, compatibility rules, acceptance matrix, and test plan must be closed first. Only then should the complete implementation package be handed to Horizon for one coordinated execution horizon.

This does **not** authorize Horizon to invent missing contracts. The implementation horizon is bounded by this specification and by the existing AWJ authority boundaries.

### Current verified implementation foundation

The following are already available and should be reused rather than rebuilt:

- host/tenant-resolved storefront and publication eligibility;
- safe public product resource with allow-listed fields;
- product/category catalog, server search and server sorting;
- generic product options and concrete variant identity;
- authoritative price and derived availability;
- product/variant media;
- server-authoritative cart and checkout flows;
- responsive storefront shell and mobile bottom navigation;
- dedicated checkout shell that intentionally removes storefront marketing/navigation chrome;
- StorefrontPresentationConfig with safe normalization;
- Draft persistence, workspace preview, atomic Publish and public Published-only runtime;
- semantic presentation tokens including density, card, header, radius and theme preset seams;
- contact, WhatsApp, social, app-link and policy-page presentation metadata;
- locked responsive acceptance widths and RTL/LTR baseline.

### Horizon non-negotiable authority boundaries

Horizon must not:

- create a second product/category/price/inventory source of truth;
- make browser-selected `warehouse_id` authoritative;
- calculate commercial discounts, totals, tax, delivery prices or stock facts client-side;
- expose raw stock quantity, inventory ledger, cost, margin, valuation or accounting data publicly;
- add arbitrary merchant HTML/CSS/JS or unsafe iframe injection to the presentation contract;
- weaken tenant resolution, publication guards, cart mutation gateway, IDOR protection, or Draft/Published isolation;
- alter accounting, inventory posting, financial rules, database contracts or public APIs merely to make the theme resemble the benchmark;
- activate gated capability UI as though it were live;
- fork cart/checkout/product business logic for AWJ Market;
- regress AWJ Modern or other existing theme/presentation behavior.

### Capability gate manifest for the implementation horizon

The first AWJ Market implementation may consume only authoritative/live capabilities. The following remain gated unless a separately approved platform implementation is included in the Horizon package with its own contracts/tests:

- customer-selectable multi-location availability / pickup location;
- authoritative offers/compare-at pricing and dedicated Offers collection;
- persistent wishlist/customer identity;
- ratings/reviews;
- purchase-count social proof;
- public barcode/GTIN beyond the already-public SKU;
- safe structured interactive map;
- faceted catalog filtering;
- search suggestions/autocomplete/trending/recent searches;
- arbitrary related/recommended products;
- coupons/promotion codes without server-computed discount/total;
- unsupported payment/shipping/tax claims.

### Surface inventory for visual implementation

Horizon must treat AWJ Market as a coherent responsive system across these surfaces, not just a homepage skin:

1. storefront shell/header/search/category navigation;
2. mobile bottom navigation on normal storefront surfaces;
3. home composition and all enabled section states;
4. catalog/product listing;
5. category results;
6. search results and no-results state;
7. product detail for simple and variant-managed products;
8. media states: multiple, single and missing media;
9. availability states: in stock, out of stock, unknown;
10. cart drawer and cart page;
11. empty cart;
12. checkout shell and contact/address/delivery/payment/review/confirmation stages, respecting capability gates;
13. content/contact/policy/footer surfaces supported by the shared presentation contract;
14. Customizer preview and published runtime parity for Market presentation tokens.

### Responsive acceptance matrix

At minimum verify approximately:

| Width | Required review |
|---:|---|
| 390px | compact phone / two-column catalog where readable / bottom-nav safe area |
| 430px | large phone / long Arabic product names and actions |
| 768px | tablet composition / three-column catalog baseline |
| 1024px | wide tablet / compact desktop transition |
| 1280px | desktop commerce density |
| 1440px | wide desktop hierarchy and bounded canvas |

Every critical surface must be checked in Arabic RTL and English LTR. No horizontal overflow. Mixed Arabic/Latin/SKU/price content must remain stable.

### State acceptance matrix

The Horizon implementation must explicitly cover:

- loading where the current architecture exposes a loading boundary;
- empty catalog/search/cart states;
- API/business rejection without false success;
- missing media;
- simple product;
- variant-managed product before selection and after valid selection;
- unavailable variant/combinations;
- product in stock / out of stock / availability unknown;
- long names/descriptions;
- configured and absent merchant branding;
- configured and absent optional content/presentation sections;
- Draft preview versus Published public runtime;
- unsupported/gated capabilities remaining absent or honestly gated.

### Accessibility acceptance

Preserve or improve the shared storefront baseline:

- semantic heading hierarchy and landmarks;
- keyboard reachable search, navigation, product controls, variant controls, cart and checkout;
- visible focus states;
- meaningful accessible names for icon-only controls;
- correct disabled/pending/error semantics;
- no color-only state communication;
- logical RTL/LTR layout rather than fragile physical offsets;
- reduced-motion behavior where motion exists;
- touch targets appropriate for mobile commerce.

### Performance acceptance

AWJ Market must not add per-card detail fetches, per-card inventory queries, or client-side N+1 behavior. Catalog pages continue to use paginated server results and narrowed card data. Images must preserve stable aspect-ratio/layout behavior. Theme composition must avoid unnecessary client components and duplicated data fetches. Any performance claim in the final report must be measured; unmeasured metrics must be reported as such, never inferred.

### Customizer and theme compatibility acceptance

- `awj-market` must be represented through the shared presentation/theme architecture, not a separate persistence model.
- Draft Save must not publish.
- Public runtime reads Published only.
- unknown/stale tokens fail closed through normalization.
- merchant branding and colors remain merchant-controlled where supported.
- Market defaults may choose compact density/card/header composition, but merchant-supported overrides remain valid.
- AWJ Modern remains the safe fallback.
- other existing themes/presets must not inherit Market-only styling accidentally.
- Customizer preview and public runtime must use the same semantic token meaning.

### Suggested one-horizon internal execution order

Horizon may execute the work as one coordinated task, but internally it should proceed in dependency order:

1. verify exact `main` Base SHA and read this Master Spec plus current presentation contracts;
2. register the Market preset/key in shared closed token sets and both backend/frontend normalizers where required by the existing architecture;
3. add Market defaults without changing existing preset defaults;
4. implement shared, theme-aware composition/style seams needed by Market;
5. complete shell/home/catalog/PDP/cart presentation;
6. verify checkout compatibility without forking its business flow;
7. wire Customizer selection/preview using existing Draft/Publish contracts;
8. add/update focused unit/component tests;
9. run storefront lint/typecheck/tests/build;
10. run backend/presentation contract tests if shared normalization/persistence code changes;
11. perform visual matrix review across required widths and RTL/LTR;
12. run broader regression only where blast radius justifies it;
13. produce the final Horizon implementation report;
14. STOP before merge/deploy unless the current owner authorization explicitly covers that action.

### Final Horizon report contract

The final MD report must include:

- exact task scope and what was intentionally excluded;
- Base SHA / Branch / PR / Head SHA;
- implementation summary by surface;
- changed files grouped by responsibility;
- contracts reused and any contract changes;
- capability gates that remain inactive;
- focused tests and exact results;
- full storefront test/lint/typecheck/build results;
- backend tests if applicable;
- visual verification matrix with widths and RTL/LTR;
- accessibility findings;
- performance findings, explicitly marking anything not measured;
- tenant/security/backward-compatibility assessment;
- risks and remaining work;
- CI state;
- merge/deploy state;
- recommended next action.

## 25. Remaining pre-Horizon closure checklist

Before marking the package `READY FOR HORIZON IMPLEMENTATION`, complete only these evidence/spec closure items:

- map the exact shared files/components likely to change for preset registration, runtime styling and Customizer selection;
- verify backend and frontend presentation token/normalizer parity for adding a new preset key;
- verify current home section renderer behavior and which gated section placeholders are preview-only versus public-hidden;
- verify Market styling can remain theme-aware without duplicating ProductCard/cart/checkout logic;
- define focused regression tests for AWJ Modern fallback and Draft/Published isolation;
- confirm PR #1001 CI/merge state and merge the documentation when clean;
- issue a final single Horizon task prompt referencing the merged durable spec.

Until those items are closed, status remains **PRE-HORIZON — NOT READY FOR IMPLEMENTATION**.
