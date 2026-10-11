# CUST-HV V9d-4 — Commerce-firewall closure for the cards / shelves slices — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9d-4** — closing slice of V9d (V9d-1 card tokens → V9d-2 layout / columns / per-section cards → V9d-3 section title → **V9d-4 firewall tests**). |
| **Branch** | `cust-hv/v9d4-commerce-firewall` (stacked on V9d-3 until it merges) |
| **Authority** | V0 §14.3 (commerce firewall: no presentation control may set or hide price, discount, stock, availability, offer truth, tax or checkout amounts) · CLAUDE.md Commerce contracts 6 and 10 |
| **Scope** | **Tests and fixture only.** No production code, endpoint, schema or behaviour change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## What was built

A single shared hostile fixture, `tests/Fixtures/presentation/commerce-firewall.json`: one document where **every presentation scope** carries commercial keys (`price`, `priceMinor`, `discount`, `discountPercent`, `stock`, `stockLabel`, `availability`, `tax`, `vat`, `total`, `currency`, `sku`, `quantity`) — the document root, the global-token groups (`cards`, `surfaces`, `typography`, `layout`, `motion`, `productCard`), the homepage, each section (new arrivals, featured, offers, product shelf, hero, benefits, custom content), their `content`, `design`, `design.cards`, a product-shelf `source`, hero CTAs, benefit items and content blocks — next to legitimate card / shelf / title settings.

| Layer | Test | Proves |
|---|---|---|
| PHP authority | `StorefrontCommerceFirewallTest` | after `StorefrontPresentationNormalizer::normalize` **no key anywhere** matches the commercial pattern and no injected commercial value is reachable; the legitimate keys (cards, `showTitle`, offer ids) survive |
| Storefront twin | `lib/presentation/__tests__/commerce-firewall.test.ts` | same, on `normalizePresentationConfig`; plus a **control** that the raw document does carry ≥ 10 such keys (the scan can see them) |
| Merchant-app twin | `__tests__/commerce-firewall.test.ts` | same |
| Static (PHP) | same test class | the presentation layer (`Storefront*Normalizer`, publish rules, contrast gates) imports **no** price / offer / cart / checkout / order / inventory / ledger service or model; and `CommercePriceResolver`, `StorefrontOfferResolver`, `CommerceCartService`, `CommerceCheckoutService`, `CommerceOrderService` do **not** read the presentation layer (no coupling in either direction) |

## Why this is the right level

Prices, discounts, stock and offer truth are produced by the commerce services from commerce data; the presentation document is an input to rendering only. The strongest guarantee is therefore (a) no presentation key can name those concepts (closed lists, tested above end-to-end across all three normalizers), and (b) no code path connects the two layers. A runtime "same price before/after" assertion would pass trivially given (b) and add fixture weight without adding protection. The browser proofs of V9d-1/-2 additionally assert, per variant, that every commercial string rendered on the production `ProductCard` is identical.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
