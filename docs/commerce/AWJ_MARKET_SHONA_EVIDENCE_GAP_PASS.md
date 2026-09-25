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
