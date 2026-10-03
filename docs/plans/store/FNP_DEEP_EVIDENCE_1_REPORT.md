# FNP-DEEP-EVIDENCE-1 — Flowers & Gifts Commerce Deep Audit (fnp.sa)

**Status:** External Evidence Pass — documentation only. Not an implementation authorization.
**Inspection date:** 2026-10-03 (≈01:30–03:00 UTC, i.e. ≈04:30–06:00 Riyadh time).
**Target:** https://www.fnp.sa/ (Arabic default, `/en` English) and its public satellites: `api.fnp.qa` (the storefront's own API host), `checkout.fnp.sa` (legacy Shopify store), `corporate.fnp.sa` (corporate WordPress site).
**Baseline reviewed first:** `docs/plans/store/FNP_FLOWERS_GIFTS_EVIDENCE_PASS.md`, `…_PASS_2_CHECKOUT_OPERATIONS.md`, `…_PASS_3_POLICIES_LIFECYCLE.md` (branch `docs/fnp-flowers-gifts-evidence-pass`, PR #1180; 3,586 lines). This report verifies, corrects and extends them — it does not repeat them. Section "Corrections & deltas vs prior passes" lists every place where this pass changes the baseline.
**Companion file:** `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md` (one row per capability; evidence URL, confidence, AWJ relevance, open question).

> Rules honored: no order placed, no payment attempted, no personal data typed or submitted, no recipient/delivery created. Only guest carts were created (a few dozen throw-away guest sessions, each abandoned), one deliberately invalid coupon code was tried, and one synthetic solid-colour PNG (no person, no text) was passed through a photo-personalisation widget. No load testing, scanning or crawling beyond the public sitemap (6 files) and a few hundred small read-only calls (a handful per collection/city) to the same JSON endpoints the storefront itself calls.
> This document describes a competitor's public behavior as **evidence**. No proprietary copy, images, or design are reproduced beyond short quotations needed to prove a point. Screenshots were **not** committed to the repository for the same reason (see §37).

---

## Evidence classification used

| Tag | Meaning in this report |
|---|---|
| **OBSERVED** | Directly visible in the rendered storefront, or returned by a public JSON endpoint that the storefront itself calls in normal use (marked `[UI]` or `[API]`). |
| **INFERRED** | Reasonable implication. Includes anything read only from publicly served **client code** (JS bundle strings / feature flags), marked `[code]` — such strings prove the capability is *built into the client*, not that it is live or reachable in KSA. Never presented as FNP backend fact. |
| **UNKNOWN** | Public evidence is insufficient. Left open deliberately. |

Confidence: HIGH (seen in several independent places / reproduced), MEDIUM (seen once or only via code), LOW (single weak signal).
"AWJ implication" paragraphs are analysis, not decisions.

---

## 1. Executive Summary

**What FNP Saudi is (OBSERVED):** a multi-country, multi-channel gifting commerce platform running as a **headless Next.js storefront** on `www.fnp.sa`, backed by a first-party API (`api.fnp.qa`) split into catalogue/search (`/talaash/…`), consumer/CMS (`/consumer/…`) and order (`/order/…`) services. A **legacy Shopify store is still live** at `checkout.fnp.sa`. The prior passes used that legacy store as their main PDP/policy source — several of their findings are therefore about the *old* stack (see Corrections).

**The ten findings that matter most (new vs. prior passes):**

1. **Delivery is modelled as city-specific logistics groups, not a global "same-day" flag.** The cart groups lines by `vendor | shipment-method | time-slot | date` (e.g. `KSAV_RIYADH|KSAV_RIYADH_STD|slot_0800_1200|2026-10-03`). Four cities tested via the UI selector gave **three distinct logistics profiles**: Riyadh and Jeddah (7 standard slots @ SAR 25 + midnight @ SAR 49, different vendors), Mecca (shares Jeddah's vendor and catalogue, but only **2 slots, SAR 35, no midnight**), Khobar (Eastern vendor, 5 standard slots + midnight). Only `STANDARD_DELIVERY` and `MIDNIGHT_DELIVERY` were selectable anywhere; "3 hours", "Express", "Fixed time", "2-hour" appear only as marketing/curation names (the `two-hour-delivery-gifts` collection exists and is **empty**). §13–14.
2. **City changes the catalogue, not prices.** Same SKU price in every city (0 differences across 259/259/270/85 common products), but catalogue size differs: Birthday collection Riyadh 514 / Jeddah 503 / Dammam-Khobar 512 / Madinah 109; Money bouquets 17/15/17/**0**; Plants 94/54/67/8. Mecca resolves to Jeddah's catalogue; Dammam/Jubail/Dhahran resolve to Khobar's; the UI only offers **4 cities** (Riyadh, Jeddah, Mecca, Khobar) while the footer, SEO pages and API know ≥9. Unknown city ids silently fall back to Riyadh. §14.
3. **The homepage is a per-city CMS feed** (`KSA HP Riyadh`, `KSA JED HP`, `KSA EST HP`, `KSA MED HP`, default `KSA HP`) — Madinah's feed simply omits the "Flowers & Chocolates / Flowers & Money" sections. §4, §14.
4. **A single cart/checkout surface with a 4-step stepper** (`/en/cart`: Sender info → Delivery address → Time slot → Payment) and a separate `/en/payment` page. **Guest checkout is real** (server-side guest cart via a guest JWT). Sender details (first, last, phone, email — all required) come *before* the address; a **"Surprise Gift" toggle hides the sender at delivery**. §9–12.
5. **Fees the prior reports missed:** a flat **SAR 3 "Platform Fee"** on every cart; a paid shipping membership **FNP Gold (SAR 49/yr = 4 free deliveries)**; prices are **tax-inclusive** and the 15% VAT line shown is computed over item + delivery + platform fee (and, for money bouquets, over the embedded cash too — OBSERVED arithmetic, no accounting conclusion). §11, §18, §20.
6. **No-address flow is now partially specified** (from client code + a rendered label): the address step offers "Don't know the address?" → asks only receiver name, phone, country, city → "our concierge" collects delivery details; the card reads "No address? No problem — We'll contact {name} and collect the delivery details." The checkout summary shows "Don't Know the address". Still **UNKNOWN**: contact timing, non-response handling, fees, sender-privacy interplay, payment timing. §9.
7. **Order/payment vocabulary can be reconstructed** (from the client i18n catalogue): order `ORDERED → APPROVED → PROCESSING → (HOLD) → OUT_FOR_DELIVERY → DELIVERED | CANCELLED`; payment `Pending / Authorized / Successful / Partially Refunded / Refunded / Failed`. There is **no public tracking lookup** on www (FAQ promises a "Track Order" button that does not exist; `/en/track-order` is 404). §23.
8. **There is no real cancellation/refund/return/failed-delivery policy on www.** The "Order and Refund Policy" is the merchant-acceptance clause only; the customer "Cancellation Request" section ends mid-sentence ("FNP will not cancel or alter."). §24–25.
9. **Personalisation = three small widgets, not a design tool:** photo-only, text-only (25 chars), photo+text (2 steps); one image, JPEG/PNG, stated 100 KB–10 MB (not enforced client-side in the tested step), crop/rotate/flip editor, **no composite preview of the customer's image**, no price/time impact observed. A separate order-level "message card" (occasion + ≤200 chars + preset messages) is free. §8.
10. **The product ships many correctness/consistency defects worth designing against** (AED price on the Saudi homepage, Qatar registered address in the invoice template, Indian festival pages and Indian wallet partners in Saudi copy, leaked internal tags like `Branded_new`, four different contact numbers/emails, icon buttons mislabelled "Add to cart", stale seasonal products, FAQ answering a UI that no longer exists…). §33.

**Bottom line for AWJ:** the highest-value, least-obvious patterns are (a) delivery groups keyed by vendor/method/slot/date, (b) a catalogue that is *per-city assortment* with *global pricing*, (c) per-country feature flags as configuration (matches AWJ rule 6 "policy is configured, not imposed"), (d) a post-add-to-cart add-on moment and cart-level message card as separate objects from product personalisation, (e) money/cash gifts being sold as ordinary SKUs with composition text only. Every one of these needs an AWJ contract before use; none should be copied as a screen sequence.

---

## 2. Site Surface Map

All URLs inspected 2026-10-03. "Type" values: SSR page, client modal/drawer, JSON endpoint, static asset.

### 2.1 Storefront (www.fnp.sa — Next.js, `x-powered-by: Next.js`, nginx/1.24)

| Surface | URL / endpoint | Type | Notes |
|---|---|---|---|
| Home | `/` (ar, default), `/en` | SSR + per-geo feed | `NEXT_LOCALE`, `geo`, `country`, `currency`, `domain`, `language`, `source` cookies set on first hit (100-year expiry). `hreflang`: ar, en, x-default |
| Country & language gate | modal on first visit | modal | Desktop view showed Saudi Arabia, UAE, Singapore, Qatar (scrolling list); mobile listed 8 (adds Philippines, Malaysia, Kuwait, Bahrain); then "Delivery city" |
| City selector | header chip | modal | Riyadh, Jeddah, Mecca, Khobar only |
| Mega menu | header, 9 top items | hover panel | Birthday, Gift Sets, Flowers, Cakes, Perfumes, More Gifts, Occasions, Brands, Personalised (+ "Corporate", currency, language, cart, account) |
| Search box + suggestions | header | client + `GET /talaash/v1/web/autosuggest` | trending / discovery / curated-keyword + product suggestions |
| Search results | `/en/search?qs=<term>` | SSR | same facet UI as collections |
| Collections ("curations") | e.g. `/en/gifts-birthday` (318 URLs/locale in sitemap) | SSR + `product-list`/`facets` | `pageType: PLP_CURATION` |
| City landing pages | `/en/{gifts,flowers,cakes}-{riyadh,jeddah,dammam,al-khobar,dhahran,al-jubail,al-qatif,mecca}` (21) | SSR | Madinah has no page though it is in footer |
| Same-day pages | `/en/same-day-delivery-gifts`, `/en/same-day-delivery-flowers` | SSR | the "all" collection in practice (1,896 = whole Riyadh catalogue) |
| 2-hour page | `/en/two-hour-delivery-gifts` | SSR | collection "2 Hour Gift Delivery" — **0 products** |
| Brand pages | `/en/all-brands`, `/en/godiva`, `/en/patchi-chocolates`, … | SSR | brand = product attribute (`brand`: FNP, FNP-KSA, Bostani, Gucci, Dior …) |
| PDP | `/en/gift/<slug>` (ar: `/gift/<slug>`) | SSR | legacy `/en/products/<slug>` answers with a 3xx |
| Personalisation drawer | opens on Add To Cart for customisable PDPs | client drawer | 1- or 2-step |
| Add-on modal | opens on Add To Cart for other PDPs | client modal | "Make it extra special" |
| Cart + checkout stepper | `/en/cart` | client | guest allowed |
| Payment | `/en/payment` | client | renders a skeleton even without a cart |
| Wishlist | `/en/wishlist` | client | login-gated heart |
| Orders | `/en/orders` | client | empty state for guests |
| Login | modal from user icon / heart / checkout | modal | mobile-or-email single field; Google; Apple |
| Reminders | account tab (mobile bottom bar) | client | occasion reminders (code strings) |
| Support: FAQs / Contact / About | `/en/faqs`, `/en/contact-us`, `/en/about-us` | SSR | FAQ answers are accordions |
| Legal | `/en/terms-conditions`, `/en/privacy-policy` | SSR | no shipping / refund / cancellation / returns pages on www |
| Corporate (SEO page) | `/en/gifts-for-corporate` | SSR | header "Corporate" button target; no form |
| Corporate (real B2B site) | `https://corporate.fnp.sa/en/` | separate WordPress site | enquiry forms; catalogue PDF |
| Legacy store | `https://checkout.fnp.sa/en/…` | Shopify | policies, FAQ, wishlist app, legacy PDPs |
| App promotion | footer QR + App Store/Google Play badges | static | also hero strip |
| Sitemap / robots | `/sitemap.xml` (6 child files) / `/robots.txt` | static | 2,085 product URLs/locale; 318 collection URLs/locale; lastmod ≈ 2026-06-28 |

### 2.2 Features searched for and **not** observed

Gift cards / vouchers (0 strings in code), referral programme, loyalty points (only Gold shipping membership), pickup / store collection, subscriptions for recurring flowers, wishlist share / clear-all / add-all-to-cart (no strings, no UI), saved recipients as a first-class list (only address-book + occasion "profiles" in code), public order tracking, live chat widget (WhatsApp button only), product-level ratings on cards, a live age/content gate (the `showGate` country flag is `true` for KSA only — most likely the country/language gate modal; meaning not confirmed).

### 2.3 Remarketing / abandonment clues

Guest sessions are server-side (a cart row is created on first Add To Cart with a guest JWT valid for ~100 years). Trackers fire on first page load, before any consent interaction: GA4 `G-N3Y60L37YW`, Google Ads (`AW-557007252`, `AW-568408654`), DoubleClick, TikTok pixel, Snapchat pixel, Rudderstack (`rudderstack-gcp.fnp.ae`, carries `delivery_city`, `web_uuid`), Trackier web SDK; MoEngage SDK present in the bundle (`[code]`). No cookie-consent banner appeared. No abandoned-cart message could be observed (would require entering contact data). **UNKNOWN:** whether the cart `sender` email triggers abandonment emails.

---

## 3. Capability Inventory (summary)

The row-level inventory is in `FNP_DEEP_EVIDENCE_1_CAPABILITY_MATRIX.md` (160 rows). Headline counts:

| Domain | Rows | OBSERVED | INFERRED [code] | NOT OBSERVED / UNKNOWN |
|---|---|---|---|---|
| Discovery, taxonomy & search | 22 | 21 | 1 | 0 |
| PDP, personalisation, add-ons, bundles, money gifts, food/plants/safety | 42 | 37 | 2 | 3 |
| Cart, checkout, payment & promotions | 28 | 18 | 7 | 3 |
| Delivery & city-aware commerce | 14 | 13 | 0 | 1 |
| Gifting identity, account, wishlist, orders, lifecycle, notifications | 19 | 4 | 10 | 5 |
| Policy, privacy, legal & support | 12 | 5 | 2 | 5 |
| Corporate, SEO, growth, mobile & technical surface | 13 | 12 | 1 | 0 |
| Weaknesses (what not to copy) | 10 | 10 | 0 | 0 |
| **Total** | **160** | **120** | **23** | **17** |

---

## 4. Catalog & Taxonomy

### 4.1 Distinct discovery dimensions (answer to "how many?")

**19** discovery dimensions were identified (OBSERVED across mega-menu, facets, sitemap collections, API); at least 16 are usable independently by a shopper:

| # | Dimension | Where it lives | Global (header) or collection-only |
|---|---|---|---|
| 1 | Product family (flowers, cakes, perfumes, plants, chocolates, balloons, hampers, jewellery, watches, fruit baskets, money, décor) | `category_hierarchy` (l1/l2), menu | Global |
| 2 | Occasion (birthday, anniversary, graduation, get-well, new-born, wedding, promotion, thank-you, I'm sorry, sympathy…) | menu + `OCCASION` facet + dozens of collection pages | Global (menu), also facet |
| 3 | Recipient / relationship (him, her, husband, wife, mother, father, kids, grandmother/-father, boyfriend, girlfriend, parents) | menu + ~49 collections | Global |
| 4 | Gift-set / combo type ("Flowers & X": cakes, chocolates, perfumes, watches, jewellery, money, balloons) | menu | Global |
| 5 | Brand (Godiva, Patchi, Bostani, Bateel, Venchi, Feel Good Tea, Ferrero, Titan, Cerruti, Aani & Dani, Kooheji…) | menu + `brand` attribute | Global |
| 6 | Flower type (roses, tulips, lilies, orchids, sunflowers, hydrangea, chrysanthemum…) | menu + `FLOWER_TYPE` | Global |
| 7 | Flower colour | `FLOWER_COLOR` facet + colour collections (red/pink/white-flowers) | Collection-only |
| 8 | Packaging / arrangement (bouquet, vase, box, basket, bowl, premium) | menu + `PACKAGING_TYPE` | Global |
| 9 | Cake flavour | menu + `FLAVOUR` facet | Global |
| 10 | Cake type (designer, picture, cup, mono, cheesecake, heart-shaped…) | `CAKE_TYPE` facet + menu | Both |
| 11 | Kids cake theme (dinosaur, Labubu, Lilo & Stitch, Hello Kitty, Frozen, Minecraft, football…) | menu | Global |
| 12 | Serving size | `SERVING_SIZE` facet | Collection-only |
| 13 | Price (slider with histogram) + price-range buckets | `price`, `PRICE_RANGE` | Collection-only |
| 14 | Delivery timing ("Today") | `DELIVERY` facet, same-day / 2-hour collections | Collection-only |
| 15 | City / serviceability | selector, per-city catalogue + 21 city pages | Global (state) |
| 16 | Personalisation | "Personalised" menu + "Customize" badge | Global |
| 17 | Seasonal / event | ≈80 collections (Valentine, Eid, Ramadan, National Day, Foundation Day, Hajj/Umrah, Back-to-school…) | Menu "Occasions" + SEO |
| 18 | Curated lists | bestsellers, new arrivals, trending, on-sale, "Exclusive Deals Zone" | Mixed |
| 19 | Profession for graduation gifts | `gifts-mba/architecture/engineering/nursing/it/law` | Collection-only |

### 4.2 Hierarchy vs facets vs curated collections

* **Hierarchy (OBSERVED [API]):** only one — `category_hierarchy`, two levels (`item_category.l1 / l2`; filter token `category_hierarchy:flowers:roses`). Counts roll up (Flowers 138 → Roses 53, Mixed 45 …).
* **Facets:** attribute-driven multi-selects: `DELIVERY`, `OCCASION`, `FLOWER_COLOR`, `FLOWER_TYPE`, `PACKAGING_TYPE`, `PRICE_RANGE`, `FLAVOUR`, `CAKE_TYPE`, `SERVING_SIZE`, plus a range facet (`price` with histogram). The **set shown is context-dependent** (after choosing Flowers>Roses the facet list shrinks from 10 to 8).
* **Curations:** every collection is a named record (`cur_ksa_<slug>`, `pageType: PLP_CURATION`, `curationName`). Membership is **not** simply a tag: "Birthday Gifts" holds 514 items yet its own Occasion facet says Birthday (323) — so ≥191 items sit in the collection without the Birthday tag (rule/manual curation — mechanism **UNKNOWN**).
* Same product is reachable through many landing pages: e.g. a rose bouquet appears under Flowers, Roses, Birthday, Anniversary, For Her, Same-Day, a city page, a colour page, and an `all` collection (OBSERVED).

### 4.3 Navigation depth and locale/city behaviour

* Mega menu: 9 top items; each panel has 1–5 titled columns ("Packaging Type | By Occasions | Flower Type | Flower Gift Sets | By Recipient" under Flowers; "By Type | By Flavours | By Occasion | Cakes for Kids" under Cakes; "Everyday Occasions | Special Occasion" under Occasions). Depth: 2 clicks to most collections; the same destination appears in 3–5 menu panels (e.g. "Flowers & Chocolates" in Birthday, Gift Sets, Flowers).
* The link set of the server-rendered nav was identical (179 links) for cookies `riyadh/jeddah/makkah/khobar/madinah`; because server HTML kept the Riyadh label for all, this comparison is weak (LOW). Client-side nav after UI city change was not diffed → **UNKNOWN**.
* Locale: Arabic is default; the English menu and the Arabic menu are the same structure. In Arabic the UI is RTL, but the "Corporate" button, the currency code `SAR` and some breadcrumb parts stay Latin (mixed-language).
* Seasonal entries are hand-placed in the menu ("Teacher's Day 5 Oct", "Boss's Day 16 Oct", typo "Pink Ocotber").

### 4.4 Catalogue size facts

Riyadh total (the `all` collection) = **1,896** purchasable products on 2026-10-03; sitemap lists **2,085** product URLs per locale (≈190 not purchasable in Riyadh — other-city or unavailable items, INFERRED). Product ids are 13–14-digit numerics (Shopify-style, INFERRED) with variant suffix `-V0`; SKUs encode family and attributes (`FLRSRDBQWIRGUX1`, `CKPCCTH5RGUX19`).

---

## 5. Search & Discovery

**Search box** (OBSERVED [UI][API]):
* Rotating placeholder with an emoji ("Search 'Congratulations Gifts' 💐"); on focus with an empty query the API returns **trending searches (10)**, **discovery tiles** (Trending Occasion / Trending Categories / By Recipient, ~6 each) and **12 bestselling products**. Recent-searches and "Clear" strings exist in code `[code]` but no recents were shown (fresh profile).
* Typed query → `keywords` (curated-collection suggestions, type `PLP_CURATION`, id `cur_ksa_<slug>`, 5–8) **and** `products` (5–16 with price + URL). Debounced per keystroke (calls for `ros`, `rose`, …). All calls carry `geoId` — **suggestions are city-aware**.
* Tested: `roses` → Roses Online / Red / Spray / White / Valentine / Forever / Yellow Roses + 8 product hits; `birthday`, `graduation` (profession collections incl. an internal-looking suggestion `influencer-graduation`), `chocolate` (brand collections Patchi/Ferrero/Bostani), `wife` (Gifts/Flowers/Birthday gifts for Wife), `same day` (→ "Same Day Delivery Gifts", "Same Day Delivery Flowers" **and** an unrelated "Daughters Day Gifts"; product hits included off-season items "Nurse Day rose bouquet", "Father's Day cake").
* **Typo handling:** `rosess` still returns rose results. **Arabic:** `زهور` → "Lilies Flowers / Carnations Delivery" + flower products; `كيك` → "Cake Delivery / Cakes Delivery in Dhahran…" + cakes. **Gibberish:** `xqzvbn` is not a zero-result — it returns Vanilla Cake / Venchi Chocolates suggestions and, on the results page, **29 items** (vanilla cakes). There is no "no results" state reachable for nonsense input (the no-results component exists `[code]`: "Uh-oh!"). Synonym handling beyond fuzziness — **UNKNOWN**.
* **Results page** `/en/search?qs=roses` reuses the collection UI: 261 "Today" items, Category/Price (SAR 79–18,000)/Delivery/Flavour/Occasion/Cake Type/Flower colour/type/Packaging/Price range facets, same sort options. `robots.txt` disallows `/*search`, `/*filters`, `/*sort`.
* **Sorting:** Relevance, Price low→high, Price high→low, Newest first (`sortBy=defaultPrice&sortOrder=asc`). Observed anomaly: in an ascending list a SAR 1,800 item sat at position 2 between SAR 109 items — sort uses `defaultPrice`, which may differ from the displayed variant price (INFERRED).
* **Collection counts drift:** the "Birthday Gifts" header showed 514 on most loads (and in the API) but 553 on one load a few minutes later (cause UNKNOWN: A/B, inventory sync or fallback).

---

## 6. Product Listing (cards) & Filters

### 6.1 Collection page behaviour (OBSERVED [UI][API])

* First 40 products are server-rendered; later pages via `GET /talaash/v1/web/product-list?pageSize=40&page=N&geoId=…&slug=…&filters=…&sortBy=…` with `hasNext` → **infinite scroll** (no numbered pagination, no "load more" button found).
* Filter state is in the URL: `?filters=category_hierarchy:flowers:roses&sortBy=defaultPrice&sortOrder=asc`; canonical stays on the clean URL (good) and robots blocks `filters`.
* Multi-select checkboxes; counts update to the current selection (Delivery "Today(514)" → "(53)"). Category tree counts are exact per city.
* **Mobile:** filters open as a bottom sheet with horizontal tabs (Category / Price / Delivery / Flavour / Occasion / …), a **price histogram slider with min/max inputs**, "+N more" chips, sticky "Clear All Filters" / "Show Items".
* **Zero-result handling:** "No Products Found — try adjusting your filters or search terms" with "Clear All Filters". An empty curated page (e.g. `no-discount-collection-only-for-coupon-code` → "Exclusive Deals Zone • 0") still renders and is listed in the sitemap.
* **Dirty facets (OBSERVED):** `Branded_new(51)` (raw internal label, also in breadcrumb and mobile sheet as `BRANDED_NEW`); three spellings of one colour (`Multi-colored 36 / Multi Color 6 / Multi-color 2`); Arabic labels inside the English sheet (`تشيز كيك`, `كيك على شكل قلب`); "Eid Gifts(1)" and "Father's Day(1)" in October; "Combos" appearing twice in the tree.

### 6.2 Card anatomy — what is known *before* the PDP

| Element | Present | Source |
|---|---|---|
| Image (carousel dots for multi-image) | ✔ | UI |
| Title, price (single "from" price) | ✔ | UI/API |
| **"N options"** pill (variant count) | ✔ where variants exist | UI |
| **"Customize"** pill | ✔ for personalisable items | UI |
| **Earliest-delivery badge** ("Same Day"; `MORNING` variant exists) | ✔, delivered as an **SVG image** (`earliestDeliveryNudge.icon.url`) — no text in DOM | API |
| Wishlist heart (unlabelled icon button) | ✔ | UI |
| Quick-add "+" | ✔ (behaviour not exercised) | UI |
| `brand`, `position`, `item_category l1/l2`, `isWishlist` | in API only | API |
| Old/new price, % discount, rating, review count | **not shown** on cards | UI |
| Stock/unavailable state | none seen — unavailable items are simply absent from the city assortment | UI |

In Riyadh 23 of 285 sampled products carried the `MORNING` nudge; in Jeddah/Mecca/Khobar/Madinah all sampled items were `SAME_DAY`. `earliestDelivery` was `TODAY` for every item at 05:00 Riyadh time — cut-off behaviour later in the day is **UNKNOWN** (not observable in the inspection window).

---

## 7. Product Detail Page (PDP)

Sampled families: pure flowers, flower+chocolate (Bostani), flower+cake combos, cakes (photo/custom/cheesecake/graduation), personalised mug+cushion, photo frame, perfume-with-photo, money bouquets (fresh and artificial flowers), plant, balloons, balloon-and-rose room décor, perfume hamper.

### 7.1 Layout (desktop, OBSERVED)

Breadcrumb · gallery (3–5 stills, thumbnails; **no video seen**) · **SKU printed under the image** · title · price (tax-inclusive, no tax line) · aggregate rating chip (only when a review exists, e.g. "5.0 • 1") · variant selector(s) · Add To Cart · wishlist heart · **Buy now, Pay later** panel (Tamara / Tabby, text only — no instalment amount computed) · trust strip ("Fresh Flowers & Cakes / On Time Delivery / 1 M+ Happy Customers") · accordions **Product Details / Delivery Information / Care Instructions / Reviews** · "Make it extra special" add-ons carousel · "Similar Products" · a "Find Similar" button on the main image (behaviour not exercised) · share button.

* **There is no delivery date/time/city picker on the PDP.** City is global state; date and slot are chosen later in the cart. The PDP gives no delivery-time promise (only the card badge on listing pages).
* **Content completeness varies by product.** Flower/money/perfume/plant/balloon PDPs have all three accordions; several cake and combo-variant PDPs (mango cheesecake, Bostani rose box, graduation cake, photo cake) show **no description / delivery / care sections at all**; the "custom cake" PDP has allergens and storage text.
* Structured data: `Product` JSON-LD with SKU, brand, price, availability — **no `aggregateRating`** even when a rating is visible.
* Arabic PDP can carry a **different product name** than English (EN "Sweet Darling 150 Red Rose Flower Bouquet" vs AR "أميرة الورد | 150 وردة حمراء"; body copy says "Rose Princess Bouquet … FNB").
* Mobile: full-bleed gallery, sticky Add To Cart bar, the same accordions.

### 7.2 Variants / options

Two observed forms: **size/flavour variants** (`Select a Weight`: 500 g SAR 159 / 1 kg 259 / 2 kg 439; `Select a Flavor` ×4 on the custom cake → name suffix "1 Kg / Chocolate"; 3–12 options on some cards) and **gift-upgrade variants** (`Select a Gift Options`: "Flowers n Chocolate 229 / With Cake n Roses 349 / With Burberry Perfume 559"; "With Flowers 109 / With Balloons 129 / With Balloons and Chocolate 149"; "With Roses and Chocolate 429" on a cheesecake). Each variant is a separate line id (`-V0`) with its own price. A `{percent}% off` badge for variants exists in code but no variant discount was observed. **Component-level choice is not offered** — the bundle is a fixed list; the PDP shows composition as free text (e.g. "5 pink roses · 2 purple limonium · eucalyptus").

### 7.3 Delivery / care / safety content (OBSERVED, verbatim themes)

* "Once an order is prepared for delivery, it cannot be redirected to another address." (all families)
* "Roses may arrive in bud / partially open form" (flowers, décor).
* Flowers: remove wrapping, change water daily, trim 2–3 cm. Cakes: refrigerate on arrival, **consume within 48 hours**, "open the box right at delivery, before our delivery agent leaves". Plants: medium light, 18–28 °C. Balloons: **choking warning for children under 8**; helium balloons "up to 8 hours".
* Cakes: allergens listed only on the custom-cake PDP ("Flour, Egg, Chocolate, Dairy, soya").
* Marketing claims repeated on PDPs: "delivering for over 30 / 25 years", "fleet of refrigerated vehicles" (even on balloons and mugs) — inconsistent with each other and with About ("established 1994").

---

## 8. Personalisation

OBSERVED on 6 customisable products; the add-to-cart button opens a **drawer** instead of adding silently.

| Pattern | Steps | Inputs | Seen on |
|---|---|---|---|
| Photo + text | 2/2 | Upload Image → crop/rotate editor → Next → "Text on product" (≤25, optional) → Save and Continue | Photo cake, custom cake, mug+cushion |
| Text only | 1/1 | "Text on product" ≤25 chars, counter `0/25` | Mango cheesecake, graduation-cap cake |
| Photo only | 1/1 | Upload Image → editor | Photo frame, photo-customised perfume |

* **File rules shown:** "File size should be 100 KB – 10.0 MB only. Upload only JPEG or PNG." plus "Please upload good quality image and ensure you have rights to use the image" (+ "View more": a *High vs Low quality image* guidance, `[code]`). `<input accept="image/*" multiple=false>` → **exactly one image**; multiple images per product not supported in the tested widgets.
* **Validation behaviour (tested with throw-away files):** a `.txt` file was **silently ignored** (no error). A 179-byte PNG (far below the stated 100 KB floor) was **accepted** and opened the editor — the floor is not enforced at that step (server-side enforcement **UNKNOWN**). An error string for failed upload exists `[code]`.
* **Editor:** square crop with handles, flip and rotate buttons, a fine-rotation slider (0.0° readout), Reset, Apply; then "Re Upload / Edit Image".
* **Preview:** the step-2 preview showed the product's **stock photo**, not the customer's image composited onto the product (OBSERVED with the synthetic image). So the customer cannot see the printed result before paying.
* **Storage/transport:** after Save, the image is `PUT` to a signed Google Cloud Storage URL (converted to `.jpg`); the cart line carries `personalizedDetails: { text: [""], images: ["<url>"] }`.
* **Cart behaviour:** the line shows a thumbnail, "You can edit your personalised details — Edit", and "Add text on Product" if text was skipped.
* **Price/time impact:** none observed (unit price unchanged; earliest slot unchanged at 8–12 same day). Whether production lead-time rules exist for photo cakes later in the day is **UNKNOWN**.
* **Add-ons are gated on customisation:** strings "Sending personalised gift? Please customise the gift first to add addons." `[code]`.
* **Separate from personalisation — the order-level message card** (free): required **occasion** (16 records incl. a duplicated "Best of luck"; "I don't have any occasion in mind" escape), then a **≤200-char message textarea** and "Choose message" with 4–19 preset messages per occasion (served by `GET /consumer/api/occasions/v1`). Plus **Delivery Instructions** (≤50 chars) per cart.
* Item-level gift message vs product text vs delivery instruction are three different fields: product text (≤25, printed), message card (≤200, card), delivery instruction (≤50, courier).

---

## 9. Gift Identity

| Role | Capture point | Required | Notes |
|---|---|---|---|
| Account holder | login (mobile/email OTP) | optional (guest allowed) | profile: name, DOB, anniversary date, gender, email, phone `[code]` |
| Purchaser = **Sender** | cart "Sender details*" modal | **yes**: first name, last name, phone (+966 default), **email** | blocks checkout until saved |
| Anonymous sender | toggle in the same modal: "Make it a Surprise Gift. Your details won't be shared at the time of delivery" | optional | order detail shows "Sender information is hidden for this order" `[code]`; the sender email is still required |
| Billing person | payment step | card form `[code]`: billing information / shipping information blocks, card holder name | UNKNOWN whether billing differs from sender |
| Recipient | address step (not entered) `[code]` | receiver first/last name, phone; "Ordering for yourself? Use your details." | per-delivery, not per-account |
| Saved recipient / address | login: "Your saved address", address book `[code]`; FAQ: "address book and a reminder section to store your recipients details" | — | No standalone "recipients list" UI observed |
| Occasion reminder "profiles" | Reminders tab: name, relation (father/mother/brother/sister/friend/spouse/other), occasion, date, avatar `[code]` | — | marketing hook: "Free reminder, 20% off your next gift" `[code]` |
| Gift message | message card | optional | see §8 |
| Product message | personalisation | optional | see §8 |
| Multi-recipient orders | "Delivery 1 / N" switcher in orders `[code]` | — | one order can hold several deliveries (groups) |

**UNKNOWN:** whether the recipient is notified, whether recipient phone is shared with couriers only, how the "Surprise Gift" sender is represented on the physical card.

---

## 10. No Address, No Worries

* **Where advertised (OBSERVED [UI]):** homepage hero strip icon "No Address, No Worries", About page ("No Address, No worries"), FAQ none, checkout summary label "Don't Know the address".
* **Is it selectable (OBSERVED + `[code]`):** feature flag `isDontKnowAddressAvailable: true` for KSA. The address step contains an "**Or — Don't know the address?**" control; its page is titled "Don't have the location?" and says: *share the following details about the recipient — our concierge will make sure the gift is delivered perfectly*. Fields: receiver's name, phone, country, city (all three alerts mandatory). The selected card then reads "**No address? No problem — We'll contact {name} and collect the delivery details.**" The `/en/payment` skeleton lists "Don't Know the address" in Delivery Details.
* **Information required:** receiver name + phone + country/city only (so city-level serviceability still applies: the address step otherwise says "Tell us the recipient's location to check product availability").
* **Contact / sender privacy / non-response / eligibility geography / fees / payment timing:** **UNKNOWN** (the flow cannot be completed without entering contact data).
* **Implication (analysis):** the order exists before an address does; availability is evaluated at city level; the flow needs a "pending recipient confirmation" sub-state that the visible order statuses (§23) do not name (closest: `HOLD`).

---

## 11. Cart

OBSERVED [UI][API] at `/en/cart` (one page; no separate cart-vs-checkout split).

* Header stepper: **Sender info → Delivery address → Time slot → Payment**; Login button (optional).
* Blocks, top to bottom: Sender details* ("Please share sender details to checkout") · **FNP Gold** upsell (SAR 49/yr, "4 Shipping ~~SAR 100~~ for FREE") · **Delivery details** (method · date · slot · price, with "Change") · line(s) with thumbnail, name, **Quantity dropdown**, trash icon · personalisation row · **Add Message Card (FREE)** · **Delivery Instructions (0/50)** · **Make it extra special** add-on carousel · **Shop from Bestsellers** · summary card (Item total, **Platform Fee SAR 3.00**, Delivery Charges, "Including SAR x in taxes", total, primary CTA "Add sender details") · **coupon field**.
* Absent: save-for-later, move-to-wishlist, delivery-city change inside the cart (city is global).
* Persistence: the cart is server-side under a guest JWT (`POST /consumer/api/auth/get-guest-token/v1`, `POST /order/api/v1/carts/line-items`, `GET /order/api/v1/carts?geoId=…`). Persistence across a full page load was confirmed (the personalised line reappeared after navigating to `/en/cart` directly). Cart statuses: `ACTIVE`, `expired` flag; `reorder` replaces the cart (confirm modal) `[code]`.
* **Item model:** `itemType: MAIN` (add-ons use another type, INFERRED), `quantity`, `unitPrice`, `lineTotal`, `discountAmount`, `sku`, `variantLabel(+Ar)`, `serviceable`, `personalizedDetails`, `attributes{}`.
* **Group model:** one `itemGroup` per `vendorId|shipmentMethodId|timeSlotId|date` with `groupSubtotal / groupShipping / groupTax / groupDiscount / groupTotal`, `modesAvailable: ["SCHEDULED"]`, `selectedMode`, `isServiceable`; plus `groupingSummary` (totalGroups, serviceableGroups, notServiceableGroups). A cart can therefore split into several deliveries (the orders UI has a "Delivery N of M" switcher).
* **Money (OBSERVED, 10 carts):** `grandTotal = subtotal + shippingTotal + platformFee`; `taxTotal = grandTotal × 15 / 115` in every sample (e.g. 1,527 → 199.17; 177 → 23.09; 2,367 → 308.74; money bouquet 1,427 → 186.13 including its embedded cash). Prices are therefore tax-inclusive; the platform fee is outside the group totals. `priceBreakup` keys: `discountTotal, grandTotal, platformFee, shippingTotal, subtotal, taxTotal`; order-detail strings add `handlingFee`, `couponDiscount`.
* Default selection on add: earliest same-day Standard slot (08:00–12:00, SAR 25) — i.e. the cart **pre-selects a delivery promise** before the customer says where the gift goes.

---

## 12. Checkout

**Directly observed (no data entered):**
1. `/en/cart` as above; Login optional; strings confirm "continue as guest or log in to checkout".
2. **Sender modal:** First name*, Last name*, Phone* (+966 flag selector), Email id*, Surprise-Gift toggle, "Save Details".
3. **Delivery preference modal** (§13).
4. `/en/payment` (reachable directly, even with no cart): two panels "Sender Details" / "Delivery Details (Edit)" (time, recipient name, phone, address), a "Pay on delivery" accordion, Total, **Pay Now**, "100% Safe & Secure Payments" with logos **Visa, Mastercard, PayPal, American Express, Tabby, Tamara**, "100% Smile Guaranteed — Unique Products • On time Delivery". With an empty cart it renders `undefined undefined` as the recipient name, `Total Amount 0` and a disabled Pay Now — a **rendering defect**.

**Not reached (would require typing contact data):** the address step UI itself, address autocomplete/map, OTP, payment-method selection, final review.

**Known only from client code `[code]` (INFERRED; flags for KSA):** address step = "Select or add recipient's address" with search ("Search an area, street name…"), **Use current location** (map pin "Confirm delivery location"), saved addresses (login), address types Home / Office / Others, fields *Apt & floor / Villa no., Building / cluster name, Block-street-building-house no., Directions to reach, Postal code (6-digit rule inherited from another country)*, **"Instant | Schedule"** tabs; payment = *Credit & debit cards* (number, name, expiry month/year, CVV), **Apple Pay native: true, Google Pay native: true**, **Cash on delivery: true** ("Place order with Cash on Delivery?"), Tamara/Tabby; PayNow and Atome flags false for KSA (they belong to Singapore); error/state strings: "Payment failed — if money was deducted, it will be refunded automatically within a few minutes", "Payment Expired / Payment Closed / Waiting for Action", "Missing sender name or email. Please update your details in the cart", "COD is not applicable to buy FNP Gold membership". The payment layer is a third-party SDK using **payment intents** (`intentId`, `proceedWith`, wallet-balance, instalment-plan and loyalty hooks) — vendor not identified.

**Payment methods — three inconsistent sources:** T&C lists "Visa, Master, Mastercard, American Express, PayPal"; the payment page shows those plus Tabby and Tamara; code adds COD, Apple Pay, Google Pay. **No `mada` logo or string** was found anywhere on www or in the bundles inspected (support through the card SDK is UNKNOWN).

**Observed sequence (only what was directly seen):** PDP → Add To Cart → (drawer/modal) → `/en/cart` → sender modal → schedule modal. The remaining sequence order is the stepper's order; it is *not* proven that address must precede slot (the stepper lists Time slot after Delivery address, and the slot picker needs a city only).

---

## 13. Delivery Model

### 13.1 Service levels actually selectable (OBSERVED [API], 4 cities × 3 products)

| Level (`methodTypeId`) | Riyadh | Jeddah | Mecca (`makkah`) | Khobar (Eastern) |
|---|---|---|---|---|
| **Standard** (`STANDARD_DELIVERY`) | SAR 25 · Morning 8–12, 11–3 · Afternoon/Evening 1–5, 3–7, 5–9, 7–11 · Night 10 pm–2 am (7 slots) | identical to Riyadh (vendor `KSAV_JED_MAK`, method `…STD_JED`) | **SAR 35** · only 10 am–4 pm and 4 pm–10 pm (method `…STD_MAK`) | SAR 25 · 10–2, 12–5, 3–8, 5–11, 10 pm–2 am (vendor `KSAV_EASTERN`, `…STD_DAM`) |
| **Midnight** (`MIDNIGHT_DELIVERY`) | SAR 49 · 11:00 pm–11:59 pm | SAR 49 · same | **not offered** | SAR 49 · same |
| Same-day / morning / "earliest" | derived: first available slot of the day is flagged `earliestForDay` (08:00–12:00) and pre-selected | same | 10–16 | 10–14 |
| Express / 3-hour / fixed-time / instant / pickup | **not selectable**; `instantDelivery: false` in every response | | | |

* Dates: `available-dates` returned **3 quick dates** (today + 2) with `availableSlotsCount` (Riyadh 8, Jeddah 8, Mecca 2, Khobar 6) and an empty `blockDates`; "Select a date" opens a full calendar where **every day from today to ≈ 3 Dec 2026 (~2 months) is enabled** and later months are disabled — but the calendar still lets the user page endlessly into 2027+ (all disabled).
* All delivery prices were flat per method (no per-product, per-weight, per-distance or peak-date surcharge seen); the SAR 3 platform fee is separate. **FNP Gold** makes shipping free for 4 deliveries (cost SAR 49) across eligible method types.
* **Method-type vocabulary (OBSERVED [API], Gold plan payload)** — a global catalogue of 35 codes: `1HR_TIME_DELIVERY, 1_HR_DELIVERY, 2_DAY_DELIVERY, ANYTIME_DELIVERY, DIGITAL_DELIVERY, EARLY_MORNING, EVENING_DELIVERY, EXPRESS_30_MIN, EXPRESS_60_MIN, EXPRESS_DELIVERY, E_NEXT_DAY_DELIVERY, FIXED_TIME_DELIVERY, FIXTIME_DELIVERY, FLEXIBLE_DELIVERY, FREE_DELIVERY, FREE_SHIPPING, INSTANT_DELIVERY, INTL_*, LAST_MINUTE, MIDNIGHT_DELIVERY, MID_NIGHT (also with a trailing-space duplicate), MORNING_DELIVERY, PREMIUM_SHIPPING, STANDARD_DELIVERY, VALENTINE_*`. Only two are live in KSA in the sampled flows; code includes "Delivery in 60–90 min" and "Order arriving in 30 mins" strings for instant delivery (other countries).
* **Marketing vs live:** hero strip "3 Hours Delivery", the corporate SEO page ("Express Delivery guarantees swift arrival … Fixed-Time Delivery …") and PDP copy ("Express to all the major cities") describe levels that the cart never offered. **Cut-off times, per-slot capacity, slot sell-out, lead time for cakes/personalised items: UNKNOWN** (all 8 slots were open at 05:20 Riyadh time).

### 13.2 Delivery data model hints

`vendorId` (`KSAV_RIYADH`, `KSAV_JED_MAK`, `KSAV_EASTERN`), `shipmentMethodId` (`<vendor>_STD[_<hub>]`, `_MDN`), `timeSlotId` (`slot_0800_1200`), `timeOfDayId` (MORNING / AFTERNOON_EVENING / NIGHT), `catalogAmount`, `earliestForDay`, `available`. Delivery is therefore **vendor- and hub-scoped**; a vendor can serve several cities (`KSAV_JED_MAK` = Jeddah + Mecca) with city-specific methods and prices.

---

## 14. City-Aware Commerce (high priority)

### 14.1 What the selector does

UI choices: **Riyadh, Jeddah, Mecca, Khobar** (geo ids `riyadh, jeddah, makkah, khobar`). The choice sets the `geo` cookie and a client-side state; `geoId` is sent with every catalogue, search and cart call. A hand-edited cookie alone does **not** change the cart's city (cart calls kept `geoId: riyadh`). Unknown ids (taif, abha, zzz) fall back to Riyadh in the UI, while the raw API returns 0 products with `serviceable: true` (misleading flag). The default city is Riyadh (response header `x-geo: riyadh`; whether it is IP-derived could not be determined from a non-Saudi egress).

### 14.2 What changes with city (OBSERVED [API], 11 collections × 6 geo ids)

| Collection (slug) | Riyadh | Jeddah = Mecca | Khobar = Dammam = Jubail = Dhahran | Madinah (API only) |
|---|---|---|---|---|
| gifts-birthday | 514 | 503 | 512 | 109 |
| flowers | 760 | 718 | 693 | 113 |
| cakes | 505 | 506 | 504 | 78 |
| flowers-n-money | 17 | 15 | 17 | **0** |
| personalised-gifts | 30 | 25 | 25 | 7 |
| plants | 94 | 54 | 67 | 8 |
| perfumes | 80 | 73 | 66 | 4 |
| balloons | 67 | 59 | 56 | 7 |
| gift-hampers | 78 | 65 | 55 | 1 |
| chocolates | 235 | 230 | 204 | 16 |
| same-day-delivery-gifts | 1,896 | 1,778 | 1,701 | 198 |

| Aspect | Verdict |
|---|---|
| Product availability / count | **varies by city** (above) |
| Product price | **identical** across cities (0 differences in 259 / 259 / 270 / 85 shared products) |
| Delivery service levels, slot list, slot price, shipping fee | **vary** (§13.1: Mecca SAR 35, 2 slots, no midnight) |
| Earliest-delivery badge | `MORNING` badge only seen in Riyadh (23 of 285) |
| Homepage sections | **vary** — one CMS feed per region; Madinah feed has 7 components (no Flowers & Chocolates / Flowers & Money rows) vs 9 |
| Categories / menu | **same** server-rendered link set; empty collections are not hidden (e.g. the empty `two-hour-delivery-gifts` and coupon-only pages stay live) |
| Out-of-stock state | no explicit state: item simply absent from the city assortment |
| SEO | 21 per-city landing pages for Riyadh, Jeddah, Dammam, Khobar, Dhahran, Jubail, Qatif, Mecca (Madinah missing) |

### 14.3 Homepage feeds (OBSERVED [API] `GET /consumer/api/feed/active?type=homepage`)

Labels: `KSA HP Riyadh`, `KSA JED HP` (serves Jeddah and Mecca), `KSA EST HP` (Khobar, Dammam), `KSA MED HP` (Madinah), `KSA HP` (default for unknown cities). Component types: `hero-banner` (3), `collections` ×5–6, `product-recommendation` ×2, `shop-bestsellers`. One Riyadh feed item stores **`currency: "AED"`** — the KSA homepage shows "AED 199" for one Bostani product while the product itself costs SAR 199 (data-entry defect in the CMS item; denormalised price+currency in the feed).

### 14.4 Implication (analysis)
The model is **global price list + per-city assortment + per-city logistics profile + per-region merchandising**. City is not a price dimension and not a shipping-zone formula; it selects (a) assortment, (b) vendor/hub, (c) methods/slots/fees, (d) CMS feed.

---

## 15. Substitution

(OBSERVED on PDP "Delivery Information" per family — **three different wordings** for the same operational reality)

| Wording | Seen on | Meaning |
|---|---|---|
| "Although we try to avoid it, substitution may sometimes be necessary due to temporary/local unavailability … we may have to do this **without notifying you**, since we place the utmost priority on on-time delivery" | mugs, perfume hamper, plants, balloons | whole-item/component substitution; **no customer approval**, no notification |
| "Occasionally, small details may be adjusted or changed depending on availability, while ensuring your gift retains **the same value, quality**, and lovely taste you chose" | money bouquets (incl. fresh-flower ones) | component adjustment; equal-value promise |
| "Sometimes we offer you a substitution option if …" | cakes, combos | implies an *offer* path (approval) — mechanics **UNKNOWN** |

* Colour/style preservation, higher-value-only rule, brand substitution, allergen implications and timing: **not stated** (the legacy store carried some of this; see prior pass 3).
* Notification channel: none stated; the order status set has `HOLD` ("We'll update you shortly") which is the only visible exception state.
* **Component vs whole-product substitution is not separated in copy**; product composition (bulleted stems/items) and "may arrive in bud" are the only expectation-management tools.

---

## 16. Add-ons / Upsell / Cross-sell

OBSERVED in **all three** places:

| Surface | Name | Behaviour |
|---|---|---|
| PDP (below the fold) | "Make it extra special" | category tabs (All, Cakes, Chocolate, Balloons, Greeting Cards, Combos, Toppers, Teddy, Incense & Candles, Plants, Others — **tab set and order change per product**: "Most Popular / Best Selling / Birthday / Toppers…" for a cake, "Most Loved / Birthday / Combos…" for a plant); items SAR 5–219 (cards SAR 12, toppers 10, balloons 12–59, mini cakes 39, chocolates 22–119) |
| Immediately after Add To Cart | modal "Make it extra special" | same carousel, "Skip & continue", "Continue shopping", "**Proceed to cart**", "Confirm • N addons" `[code]`; also **"Buy together — please confirm addon purchase along with the gift"** `[code]` |
| Cart | "Make it extra special" + "Shop from Bestsellers" | carousel with "+" quick-add |

* Add-ons are **separate products** with their own ids (`itemType` differs from `MAIN`; images from a separate CDN path `ik.imagekit.io/fnpsa/Replacement/…`), with quantity steppers (`increase/decreaseAddonQty`) and an "Addons" label in order details `[code]`. They are returned by the cart service as `recommendations.addOnProducts` — i.e. cart-contextual.
* Not observed in checkout (post-payment-method) — add-ons live in PDP/modal/cart only.
* Upsell by variant (gift-upgrade options, §7.2) is a second upsell mechanism.

---

## 17. Bundles & Combinations

| Observed shape | Classification | Evidence |
|---|---|---|
| "Red Roses n Cake Love Combo" (roses + 250 g mini cake) | **Fixed bundle** sold as one SKU (composition in text; "Cake Flavor: Chocolate, Weight 250 g — Serves 2; 3 red roses, black wrapping") | PDP |
| Same combo with *With Balloons / With Balloons and Chocolate* | **Fixed bundle with tiered upgrade variants** (no per-component choice) | PDP variants |
| Gucci Flora perfume hamper (2 white tulips, candle, baby-rose stem, 10 chocolates, 50 ml perfume) | Fixed bundle; **third-party component brand named in copy** ("Pink Scented Candle (IKEA)") | PDP |
| "Flowers & X" menu entries (cakes, chocolates, perfumes, watches, jewellery, money, balloons) | **Merchandising collections** over fixed SKUs | menu / API |
| Money arrangements | Fixed bundle (§18) | PDP |
| Cart-level "buy together" add-ons | Separate lines | cart |

**Configurable bundle (customer picks components): not observed.** Component details are free-text bullets, not structured data; no stock per component is exposed.

---

## 18. Money Bouquets

OBSERVED on `flowers-n-money` (17 items in Riyadh, SAR 239–2,589; 15 Jeddah/Mecca; 17 Khobar; **0 Madinah**).

* **Denominations/amount:** disclosed as text in "Product Details" — e.g. *"5 pink roses · 2 purple limoniums · eucalyptus · Cash arrangement containing **10 × 100 riyal notes. Total: 1000 riyals**"*; the artificial-flower box: *"Medium round black box · Artificial roses · **18 × 100 riyal notes, totalling 1800 riyals**"*. Amount is also in the **product name** ("…1000 SAR Money Bouquet", "SAR1800 …").
* **Selling price vs embedded cash:** SAR 1,399 (cash 1,000), SAR 2,339 (cash 1,800), SAR 849 (cash 500) — the difference is not itemised.
* Appears under the breadcrumb family "Combos" (a Gift-Set subtype, not its own product type); same cart, same slots, same SAR 25 shipping, same BNPL panel (Tamara/Tabby shown on a cash gift), same substitution wording ("small details may be adjusted… same value"), same coupon field, **no extra restriction, verification, order limit or cash-specific disclosure** at PDP, cart or payment skeleton.
* **VAT arithmetic (OBSERVED, no conclusion):** cart tax (15/115) was calculated over the whole payable amount including the cash component.
* Cancellation/refund language specific to cash gifts, identity/KYC, per-order limits, delivery-signature rules, city availability beyond the counts above: **UNKNOWN / not stated publicly.**
* **All accounting, legal and compliance questions are unresolved** — see §34 and the matrix; none inferred here.

---

## 19. Food / Cakes / Perishables / Plants

* **Cakes:** weight variants (500 g / 1 / 1.5 / 2 kg) and serving size facet ("4–6 persons", "8–10"); mini cake "250 g — serves 2"; **"consume within 48 hours"**; "refrigerate immediately"; "let cream cakes sit at room temperature before serving"; allergens only on the custom cake page; ingredients not listed; shelf life/storage temperature numbers absent; no preparation lead time shown; photo/personalised cakes use the generic delivery slots; "dedicated delivery fleet … designed to maintain temperature" (copy), refrigerated-vehicle claim even on non-perishables. Cake **flavour, type, theme, serving size** are all searchable facets.
* **Returns/cancellation wording for food:** none.
* **Plants:** care text (light, water, 18–28 °C); pot/container named in "Gift Details"; city availability sharply reduced (94 → 54/67 → 8); breadcrumb family "Plants"; no toxicity/pet warning; no size dimensions in the sampled item.
* **Balloons/décor:** choking warning (<8 y), float time ("up to 8 hours depending on location"), arrangement "arrives as shown", décor items up to SAR 5,739 with the same SAR 25 shipping (no installation fee line).
* **Perfume/brand gifts:** brand attribute (Gucci, Dior, Burberry …) drives brand pages; product copy names component brands.

---

## 20. Promotions

* **Coupon field** on the cart: `POST /order/api/v1/carts/promo {code, geoId}`. An invalid code returned HTTP **409** with "**Invalid promo code: NOTACOUPON1**" (echoes input; no hint of why — expired / ineligible / minimum spend not distinguished). Stacking, minimums, exclusions, validity windows, city/channel/customer constraints: **UNKNOWN**. Cart `recommendedPromos: []` field exists (suggested promos).
* **Sale prices / %-off:** not shown on cards or PDPs sampled; a "Gifts On Sale" collection exists (28 items) and variant `% off` badges exist in code; fixed-amount vs percentage engine: UNKNOWN.
* **Coupon-only collection:** `/en/no-discount-collection-only-for-coupon-code` → curation "Exclusive Deals Zone" with **0 products** (empty page, still in the sitemap).
* **Campaign URLs:** `robots.txt` disallows `/*?promo`; corporate "Talk to expert" links use `?promo=desk_corp_tte_header` — promo is also a **traffic-attribution parameter**.
* **Membership discounts:** FNP Gold = free shipping ×4 + "Exclusive FNP offers"; Reminders banner "Free reminder, 20% off your next gift" `[code]`; legacy store "10% off when you subscribe" (newsletter) — **absent from www**.
* **Fees interplay:** a SAR 3 platform fee is always charged; Gold waives delivery only.

---

## 21. Wishlist

* Guest tap on the heart → **login modal** (no anonymous wishlist). `/en/wishlist` as guest → empty state "Your wishlist is empty — Save items you like… move them to the cart anytime". Toasts "Item added to / removed from your wishlist". Counter "N items". Heart is present on cards, PDP and cart bestseller cards.
* **Not found:** share link, clear all, add-all-to-cart, product state badges (price drop / stock). No strings for them in the catalogue. The legacy Shopify store runs a separate wishlist app (`/en/a/wishlist`) — different system.
* Logged-in persistence and privacy of any share link: **UNKNOWN** (no login performed).

---

## 22. Account

* **Login (OBSERVED [UI]):** one field "Login with Mobile / Email Id" → Continue; or Google; or Apple; footer "By continuing you agree to Terms & Privacy". Code: mobile → **4-digit OTP via WhatsApp or SMS** (choice, resend timer), email → OTP/email login; marketing-consent checkbox string exists but KSA flag `showFnpUpdatesConsent: false`.
* **Registration:** implicit (first successful OTP creates the account) `[code]`.
* **Password recovery:** none in the current flow; the FAQ still documents a password-reset path and "email support@fnp.sa with your order number to get your login ID and password" (legacy).
* **Profile `[code]`:** name, first/last, DOB, anniversary date, gender, email, phone with dial codes; menu: My Orders, Wishlist, Reminders, Chat support, FAQs, Logout; "Recent gifts"; currency selector.
* **Saved addresses:** yes after login ("Your saved address"); **saved recipients:** via address book + reminder profiles (see §9).
* **Notifications/preferences, account deletion/correction:** no UI strings; the privacy policy says to email support@fnp.sa.
* **Order history:** `/en/orders` — View Details, Reorder (replaces cart), Rate Order (delivery + items), Help, Invoice download (KSA flag true), "Delete Order" (removes it from history only).

---

## 23. Order Tracking & Lifecycle Vocabulary

* **Public tracking by order number: not present.** The FAQ says "you will see a 'Track Order' option on the top right corner… enter your order number & click 'Track Now'" — the header has no such control and `/en/track-order`, `/en/order-tracking` return 404. Tracking is account-only (`/en/orders` → order detail).
* **Customer-visible status vocabulary `[code]` (INFERRED, not a state machine):**

| Order status code | Label | Sub-text |
|---|---|---|
| `ORDERED` | Ordered | "Thank you! We have received your order." |
| `APPROVED` | Approved | "Your delivery partner has been assigned." |
| `PROCESSING` | Processing | "We're packing and checking everything carefully." |
| `HOLD` | On hold | "Your order is on hold. We'll update you shortly." |
| `OUT_FOR_DELIVERY` | Out for delivery | "Order is out for delivery! Arriving soon" |
| `DELIVERED` | Delivered | "Your order has been delivered. Enjoy!" |
| `CANCELLED` | Cancelled | "This order has been cancelled." |
| (derived) `deliveryToday`, `default` | — | "Your order will be delivered today." / "We're preparing your order." |

| Payment status | Sub-text |
|---|---|
| Payment Pending | "Your payment is currently under process." |
| Payment Authorized | "Your card has been authorized; final capture may still be pending." |
| Payment Successful | "Your payment has been received." (+ "Payment was made using …") |
| Partially Refunded | "Part of the payment has been refunded to your original payment method." |
| Payment Refunded | "The amount has been credited back to your account." |
| Payment Failed | "There was an issue processing your payment." |

* Other order UI elements: "Estimated delivery time", step list ("Show more delivery status steps"), "Delivery N of M" switcher with a tooltip "You can swiftly track all your delivery from here", item/delivery ratings (stars + free text), instant-delivery variant ("Order arriving in 30 mins"), order id `Order ID: {id}`, invoice with `Total paid`.
* Merchant-side acceptance (T&C): "FNP reserves the right to accept, refuse or cancel your application (in whole or in part)… may request additional verifications… your order will not be accepted until the shipping information… has been sent to you" — i.e. **submission ≠ acceptance** (confirms prior pass 3); the `ORDERED → APPROVED` pair is the likely UI expression (INFERRED).

---

## 24. Cancellation / Refund / Return

**What exists publicly (OBSERVED):**
* T&C/"Order and Refund Policy" (identical text on www T&C and the legacy `…/policies/refund-policy`): merchant may accept/refuse/cancel in whole or part; if **FNP** cancels, the "sole and exclusive remedy" is refund to the same card/bank, or no charge for the cancelled part. Price-error clause lets FNP cancel even after confirmation.
* Payment failure: automatic refund "within a few minutes" if money was deducted `[code]`; partial/full refund statuses exist `[code]`.
* "**Cancellation Request**" section: *"FNP does its best to ensure that you receive excellent service. If at any time you encounter problems with an order, please let us know. FNP will not cancel or alter."* — **the sentence is cut off** (OBSERVED on www and legacy).

**Matrix of requested distinctions**

| Case | Publicly stated? |
|---|---|
| FNP-initiated cancellation | Yes (above) |
| Customer-initiated cancellation (window, fee, who/how) | **No** |
| Partial cancellation | Yes, merchant side only ("in whole or in part") |
| Flowers / food / cakes / personalised / money gifts specific rules | **No** (only "cannot be redirected once prepared") |
| Failed delivery | **No** |
| Damaged / wrong item | **No** (FAQ-less; "Help" button in orders `[code]`) |
| Refund method | Original card/bank only; wallet/credit **UNKNOWN** |
| Refund timeline | Only "a few minutes" for failed payments; otherwise **No** |
| Payment reversal vs refund | status words only |
| Returns | **No return policy exists**; "FNP Purchase Protection — we've got your back with eligible purchases" string exists in code but no page |
| Order edit after submit | Checkout page offers "Do you want to edit your order? Edit sender, recipient and delivery details" `[code]` (window UNKNOWN); PDP: delivery details "become final" after confirmation / "cannot be redirected once prepared" |

---

## 25. Failed Delivery

**Nothing is published** about: recipient absent/unreachable/refusing, wrong address, repeated attempts, re-delivery, fees, returned goods, perishable disposal, refund eligibility, proof of attempted delivery. Related signals only: (a) "opening the box right at delivery, before our delivery agent leaves" (cake PDPs) — implies courier-side hand-over inspection; (b) delay language "may be delayed… you'll be notified in advance" (weather/traffic); (c) order status `HOLD`; (d) the `PROCESSING` sub-text mentions a "delivery partner" (courier is a partner, not necessarily FNP staff). **UNKNOWN: all of it.** The No-address flow adds a recipient-contact failure mode that is equally undocumented.

---

## 26. Notifications

* **OBSERVED:** OTP over WhatsApp/SMS; a floating **WhatsApp** button (number `+966 59 905 1879`) on every page; WhatsApp deep link with prefilled "Hi".
* **INFERRED `[code]`:** order-status updates implied by status copy ("We'll update you shortly"), occasion-reminder push ("we'll notify you on time and help you pick the perfect gift" — app), MoEngage engagement SDK, delivery delay notice "in advance" (PDP copy), receipt/invoice download. **No** recipient-notification, dispatch-SMS, or substitution-approval message was visible.
* **UNKNOWN:** which events send email vs SMS vs WhatsApp vs push; sender-vs-recipient addressing; opt-outs per channel.

---

## 27. Privacy

(OBSERVED, `/en/privacy-policy` 8,454 chars; and consent mechanics)

* **Collected:** name, address, email, phone, purchase behaviour, billing address / "other payment instrument details" (while also saying "no card details are passed on"), tracking info, communications; at registration email/name/phone/"other payment method details"; profile adds DOB/anniversary/gender `[code]`. **Recipient data** is "delivery information" — the policy never distinguishes sender from recipient or addresses third-party consent.
* **Sharing:** with "FNP entities and affiliates" for fraud prevention and joint services; ad networks may set cookies; disclosure to courts/law enforcement; business transfers include the data. Payment details go to "our secure payment provider".
* **Marketing/consent:** special-offer emails with opt-out by contacting support/unsubscribe link; **no consent checkbox in the KSA login or checkout** (flag false); trackers load before any consent interaction; **no cookie banner** observed.
* **Rights:** "correct, update or delete" by emailing support@fnp.sa or phone/post; no retention period; no mention of Saudi PDPL (absence only — no legal conclusion).
* **Odd/contradictory statements:** "we do not use any kind of encryption in our models" (unclear), "placing an order requires registration" (contradicted by guest checkout), "we do not use … web beacons" while GA4/TikTok/Snapchat trackers fire. Consumer vs corporate: the corporate site has its own "Privacy policy" link (not audited); the www policy is generic and legacy-worded ("press releases", "Social Security numbers").

---

## 28. Terms / Legal / Compliance

| Item | Finding (OBSERVED) |
|---|---|
| Governing law | Kingdom of Saudi Arabia |
| Age | under-18s may not register or transact |
| Business identity on www | HQ address (3813 Muhammad Ali Janah St, Al Shuhada, Riyadh), support@fnp.sa, phone; trading name **"Ferns N Petals for Trading"** appears on the FAQ page and in the invoice template. **CR and VAT numbers are not shown on any www page inspected**; they appear only in the legacy store footer (`CR No.1010823460 — VAT No.311401708500003`) |
| Invoice | KSA flag `isInvoiceAvailable: true`; client invoice template strings contain **no VAT-number / ZATCA fields** and a **Doha, Qatar registered address** (`regEn`); real server-generated KSA invoice content **UNKNOWN** |
| Payment methods clause | Visa/Master/AmEx/PayPal only — inconsistent with UI |
| Hours | "8 am to 12 am (Monday to Sunday)" (T&C); FAQ gives two different phone numbers and hours (08:00–00:00 vs 08:00–01:00) |
| Food/allergen/age/safety notices | only product-level (custom cake allergens; balloon choking) |
| Cash/money-gift disclosures | none beyond composition text |
| Policy links | footer: Terms & Conditions, Privacy Policy only; **no shipping, refund, returns, cancellation pages** (404s) |
| T&C quality | Truncated cancellation sentence; "Application Fee" wording from another business template; generic marketplace boilerplate |

No legal conclusions drawn.

---

## 29. Corporate Gifting

Two distinct surfaces:

1. **`www.fnp.sa/en/gifts-for-corporate`** — SEO marketing page (≈8,400 chars of copy), header "Corporate" button target. A product collection `gifts-for-corporate` exists (13 items: fruit baskets, plants, hampers). Claims: bulk-ordering services, "exclusive FNP offers and discounts via **Airtel, Cred, and MobKwik**" (Indian partners — copy leaked from another country), delivery variety "Morning, Midnight, Express, Fixed-Time, Standard, Same-Day". No form, no quote CTA.
2. **`corporate.fnp.sa`** — separate **WordPress** site (Contact Form 7), phone +966 55 570 0498, corporate@fnp.sa. Contents: category tree (Gifts by Type incl. onboarding gifts, plants, flowers, cupcakes, cakes, chocolates, combos, hampers, bags & travel, outdoor & safety, office & writing, drinkware, accessories, promotional gifts, apparel; Daily occasions; Festivals — Eid Al Adha; By recipient — boss/clients/employees), **Digital Catalogue PDF** (KSA Corporate portfolio 04/2025), "Talk to Expert" and "Enquire Now". **No prices and no cart on product pages** (only "Enquire Now"); three enquiry forms with fields *Name, Phone, Email, "I am looking for", Quantity, Company Name* → "Enquire Now". Bilingual en/ar.

| Capability asked | Verdict |
|---|---|
| Enquiry | **Confirmed** (forms) |
| B2B order flow / checkout | **Not present online**; "place an order … through our website or by calling" (FAQ) — claim |
| MOQ | Claim: "varies by product" |
| Bulk pricing | Claim: "bulk discounts… contact sales" |
| Quote | implied by enquiry; no quote document seen |
| Sample before order | Claim: "we can provide samples upon request" |
| Company logo / branded packaging / custom hampers | Claim + marketing sections ("Corporate Branded Packaging", "Bespoke Corporate Gifting"); no configurator |
| Bank transfer / purchase order | Claim in FAQ: "credit/debit cards, bank transfers, and corporate purchase orders" |
| Recipient lists / multi-address delivery | Not stated (consumer cart has multi-delivery groups; B2B use UNKNOWN) |
| Tracking | Claim: tracking number by email |
| Lead time | Claim: standard 2–3 business days, customised longer |

Everything under "Claim" is marketing text; no capability was independently exercised.

---

## 30. SEO / Growth

* **Page factory:** 318 collection URLs per locale in the sitemap (non-exclusive pattern counts: 21 city pages; ≥24 Valentine-type; ≈33 non-Saudi/global festival or "day" pages; ≈28 Eid/Ramadan/National/Foundation/Hajj/Umrah; ≈49 recipient pages; ≈15 graduation/profession). Product pages: 2,000 + 85 per locale. `lastmod` ≈ 2026-06-25/28 (3+ months stale vs today).
* **Long SEO tails:** home and collections carry long boilerplate tails under the grid (home: nine headed sections plus a five-question FAQ) ("FNP … Saudi Arabia" paragraphs, FAQ blocks, international-presence text "133 countries", "FNP.com", Malaysia/Philippines links) — repeated across pages.
* **Metadata:** per-page title/description; PDP self-canonical and hreflang ar/en/x-default (x-default points to `/en` on PDPs but to the Arabic root on the home page); **English collection pages canonicalise to the Arabic (non-/en) URL and expose no hreflang** (so `/en` collections declare themselves duplicates). `BreadcrumbList` on all; `Product` JSON-LD on PDPs; home `LocalBusiness`. **No `<h1>` in the server HTML of collection pages**; no `ItemList`/`FAQPage` structured data though FAQ text is on the page. Filter/sort/search/cart/account/promo URLs are disallowed in robots.txt.
* **Indexable junk:** `gifts-diwali`, `gifts-easter`, `gifts-thanksgiving-day`, `gifts-halloween`, `gifts-christmas`, `gifts-friendship-day`, Indian Valentine-week pages (`rose-day`, `propose-day`, `hug-day`, `kiss-day`, `teddy-day`, `promise-day`, `chocolate-day`), `gifts-fifa-world-cup`, an Arabic-slug page `تحسين-جودة-الصور` ("improve image quality"), `all`, `fnp`, `b2b`, `influencer-graduation`, `father-influencer` — all `index, follow`; `gifts-diwali` returns 23 live products.
* **Growth mechanics:** app promotion (footer QR + store badges + hero strip), Reminders (app), Gold membership, BNPL badges, WhatsApp, newsletter (legacy only), UGC reviews with "verified buyer" disclaimer, occasion-driven homepage ("Celebrate Every Moment"), brand tiles.
* **Social proof:** product rating shown only where ≥1 review exists and usually with a count of 1 ("5.0 (1)", "62 / 85 days ago"); the trust strip says "1 M+ Happy Customers", About says "6 Million Customer Served Globally". Reviews are all labelled "from verified buyers" (mechanism UNKNOWN).

---

## 31. Mobile UX

OBSERVED at 390×844.

* App-like shell: **bottom tab bar** (fnp / Categories / Reminders / Account); header "Delivery to **Riyadh ▾**", language toggle `ع`, search under a category chip row (All gifts / Birthday / Gift Sets / Flowers …) — no mega-menu; Country & Language modal lists 8 countries.
* PLP: filter **bottom sheet** with tab strip, price histogram + min/max inputs, "Clear All Filters / Show Items", count line "Birthday Gifts • 514 items".
* PDP: full-bleed gallery, sticky "Add To Cart", same accordions; variants as selectors.
* Cart/checkout: single column; modals become full-height sheets; same stepper.
* Differences vs desktop: category chips instead of mega-menu, reminders tab, a mobile-only banner "Free reminder, 20% off your next gift" `[code]`, address step "mobile" titles/subtitles `[code]`.
* Friction: icon-only controls without labels (heart, header cart reads "Add to cart"), long SEO text under the grid, endless calendar months (see §13).

---

## 32. Technical Surface (non-intrusive)

* Rendering: Next.js App Router with RSC (`_rsc` calls), `vary: rsc`, HTML `cache-control: private, no-cache, no-store` (no CDN caching of pages); first-page products SSR, later pages from API; ≈320–670 KB HTML per page.
* Locale/city: `NEXT_LOCALE`, `geo`, `language`, `currency`, `country`, `domain`, `source` cookies; headers `x-country/x-domain/x-currency/x-language/x-geo` on API calls; `/en` prefix, Arabic at root.
* Images: `static-assets-prod.fnp.qa` (AVIF/WebP/JPG), add-on stills via ImageKit, category icons via a GCS public bucket, user uploads via signed GCS PUT. Fonts DM Sans + Tajawal.
* Search/catalogue service name "talaash" (`autosuggest`, `product-list`, `facets`, `includeFacets=false`); a single listing contract serves collections and search.
* Guest auth: unauthenticated guest JWT (`isGuest`, `sessionId`, `deviceId`) with a ~100-year expiry; refresh token likewise (INFERRED risk: very long-lived bearer).
* Multi-country: one codebase with per-country config objects (`KSA, AE, QA, SG, MY, PH, KW, BH, OM …`) toggling `isCodAvail, isDontKnowAddressAvailable, isDeliveryInstructions, isInvoiceAvailable, applePayNativeEnabled, googlePayNativeEnabled, payNowEnabled, atomeEnabled, showFnpUpdatesConsent, corporateUrl, isPlpFacetsAvailable, showPdpSeoContent, pdpStickyBuyNow, showBuyNowPayLaterWidget, showGate` — policy-as-configuration (`[code]`).
* Product IDs, Gold plan, occasion records, curation ids (`cur_ksa_…`) are Mongo/Shopify-looking identifiers (INFERRED).
* Platform history: `checkout.fnp.sa` is a live **Shopify** store with the same company data (CR/VAT footer, 9-city selector) — the relationship to the new order service (which orders actually flow where) is **UNKNOWN**.

---

## 33. What FNP Does Poorly (mandatory)

| # | Weakness | Evidence |
|---|---|---|
| 1 | **Wrong currency on the Saudi homepage** (AED 199 item inside the Riyadh feed) | feed JSON + rendered tile |
| 2 | **Foreign legal/brand data in Saudi surfaces:** Qatar (Doha) registered address in the invoice template; "trusted destination for all customers in Qatar"/"first store in the UAE" in About; Indian partners (Airtel, Cred, MobKwik), Diwali/Easter/Thanksgiving pages in Saudi sitemap | code, About, corporate page, sitemap |
| 3 | **Business identity missing** on www (no CR/VAT shown) while the legacy store shows them | footers |
| 4 | **Four different support contacts:** footer +966 11 520 1376 / support@fnp.sa; FAQ +966 11 520 1111 (two different hours); SEO text support.sa@fnp.ae; WhatsApp +966 59 905 1879 | pages |
| 5 | **FAQ answers describe a UI that no longer exists** ("Track Order" top-right button, password reset, "Manage Your Cart") | FAQ vs UI |
| 6 | **No real cancellation/refund/return/failed-delivery policy**; cancellation sentence truncated mid-clause | T&C |
| 7 | **Payment-methods statement contradicts the UI** (T&C vs Tamara/Tabby/COD/Apple Pay); `mada` absent | T&C, payment page |
| 8 | **Delivery promise via marketing that the cart does not honour** (3-hour, Express, Fixed-time; empty `two-hour-delivery-gifts` page) | hero, SEO page, cart |
| 9 | **Silent substitution wording** (without notifying you) on gifts; three inconsistent substitution statements | PDP |
| 10 | **Dirty merchandising data exposed to customers:** `Branded_new` / `BRANDED_NEW`, duplicate colours, Arabic labels in English facets, "Pink Ocotber", duplicate "Best of luck" occasion, `influencer-graduation` shown as a search suggestion | facets, menu, search |
| 11 | **Stale seasonal inventory:** Valentine/New Year/Women's Day/graduation items in "New arrivals"/search results in October; Eid and Ramadan collections live | API, search |
| 12 | **Search never says "no results"** (gibberish returns vanilla cakes) and mixes unrelated curations ("same day" → Daughters Day) | search |
| 13 | **Counts drift** (514 vs 553) and **"serviceable: true" with 0 products** for unknown cities | API |
| 14 | **PDP content gaps:** many cake/combo PDPs have no description, delivery or care sections; aggregate rating shown but absent from structured data; SKU shown in raw form; EN/AR product names diverge ("Sweet Darling" vs "أميرة الورد", "FNB") | PDP |
| 15 | **Accessibility:** header cart icon is labelled "Add to cart"; wishlist heart has no label; delivery badges ("Same Day") are images with no text; price in Arabic UI stays "SAR 1499" Latin | DOM |
| 16 | **Personalisation preview doesn't preview** the customer's image; stated 100 KB floor not enforced client-side; non-image files fail silently | widget test |
| 17 | **SEO stuffing and canonical mistakes:** long repeated tails, English collections canonicalised to Arabic URLs without hreflang, no `<h1>` in server HTML, stale sitemap, junk indexable pages | SEO audit |
| 18 | **Over-long guest tokens** (~100 years) and trackers firing before any consent interaction | cookies/network |
| 19 | **Checkout skeleton shows `undefined undefined`** when opened without a cart | `/en/payment` |
| 20 | **Cart pre-selects a delivery promise before any address**; no explicit cut-off messaging observed; endless calendar paging | cart |
| 21 | **Trust claims inconsistent** ("1 M+" vs "6 Million", "30 years" vs "25 years" vs "1994") and "refrigerated vehicles" on non-perishables | PDP, About |
| 22 | **City UX gap:** 4 selector cities but 9 city names in footer/sitemap; Madinah not selectable and Mecca silently = Jeddah catalogue | selector, API |

**Do not copy:** the SEO tail pages, festival sprawl, the post-submit refund wording, the pre-selected delivery slot without an address, hand-keyed currency in CMS items, free-text composition without structured components, icon-only controls without labels.

---

## 34. Unknowns (explicit)

Cut-off times and slot capacity; whether lead-time rules exist for photo/personalised cakes; what happens after address-less order placement (contact timing, retries, failure outcome); sender-hidden representation to recipients; payment timing for no-address; refund/cancel windows; failed-delivery rules; substitution approval mechanics; whether `mada`/STC Pay exist behind the card SDK; real KSA invoice contents (VAT number, QR/ZATCA, address); who the production payment provider is; relationship between `checkout.fnp.sa` (Shopify) and the new order service; promotion stacking/exclusion/min-spend logic; "serviceable" semantics; how curations decide membership; whether `HOLD` is the recipient-unreachable state; whether guest carts trigger abandonment emails; account area content (not logged in); wishlist persistence/sharing; review verification mechanism; whether Gold covers Midnight (the eligible-method list says it does); what `showGate` gates; the tax treatment of money-gift value, bundles and platform fee (never inferred).

---

## 35. AWJ Implications (analysis only — no decisions)

Mapped to the existing `ADR-01…13` / Commerce Master Plan boundaries; every point needs its own contract before any build.

1. **Delivery groups as first-class** (`vendor | method | slot | date`) with per-city method catalogues and fees; the cart *must not assume* a single delivery per order. Aligns with ADR-03 (channel / warehouse / fulfillment source) and ADR-10 (shipping rate v1) but is richer than a flat rate.
2. **Global price, per-location assortment.** Avoid city-priced catalogues by default; model city/zone as *assortment + logistics profile + merchandising feed* (a configurable policy per AWJ rule 6, not a hard-coded behaviour).
3. **Policy-as-config per market:** COD, no-address, delivery instructions, invoice availability, wallet payments, consent checkbox, BNPL widgets are all toggles per country — mirrors the AWJ "policy is configured, not imposed" principle.
4. **Guest-first server cart** keyed to a device/session token with strict expiry (FNP's 100-year token is an anti-pattern); sender data captured before address is a business choice AWJ should decide explicitly.
5. **Separate objects** for product personalisation (structured inputs, ≤N text fields, 1+ images with validation and a *real* preview), order-level message card (occasion + presets), delivery instruction, and gift-sender privacy ("surprise") — FNP keeps them separate in the cart but mixes them in copy.
6. **No-address flow = pending-recipient state** with a contact attempt policy, TTL and fallback; payment timing and sender privacy must be decided up front (FNP's public evidence stops at the form).
7. **Money gifts need their own ADR** (accounting, tax, KYC/limits, refund) *before* they can be sold as ordinary SKUs; FNP shows the gap, not the answer (ADR-01 boundary: Commerce order ≠ invoice; cash value must not be assumed taxable or non-taxable).
8. **Add-on placement:** PDP, post-add modal and cart share one recommendations contract; add-ons are separate lines with their own quantity.
9. **Taxonomy:** keep hierarchy (1–2 levels) separate from facets and from curated collections; give collections an explicit membership model (rule vs manual) and block internal labels from public surfaces.
10. **Lifecycle vocabulary:** FNP's public set (Ordered/Approved/Processing/Hold/Out for delivery/Delivered/Cancelled + payment Pending/Authorized/Successful/Partially refunded/Refunded/Failed) is a *customer-facing* projection; AWJ should keep payment, fulfilment and invoice lifecycles independent (ADR-04, ADR-01).
11. **Legal/trust content is part of the product:** CR/VAT, accurate contact, refund/cancellation/returns/failed-delivery pages and substitution policy are launch gates, not copywriting.
12. **Saudi payment expectation:** `mada` is absent from FNP's visible stack — verify AWJ's payment-provider coverage for the Saudi market rather than assuming parity with FNP.
13. **City UX:** show the effective logistics profile at selection time (assortment + slots + fee) instead of silently remapping (Mecca→Jeddah).
14. **SEO/IA discipline:** one canonical per locale, hreflang pairs, real `<h1>`, no junk pages for non-market festivals, structured data matching visible content.

---

## 36. Corrections & deltas vs prior AWJ FNP passes

| Prior statement / gap | This pass |
|---|---|
| Pass 1–3 cite `checkout.fnp.sa/en/products/…` as storefront evidence | That host is the **legacy Shopify store**; the live storefront is `www.fnp.sa` (Next.js) with `/en/gift/<slug>` PDPs and a first-party cart/order API. `/en/products/<slug>` on www now 3xx-redirects. Some legacy PDP details (allergen blocks, footer CR/VAT) do not appear on the live PDPs. |
| "Exact checkout screen sequence not proven" (Pass 2 §33) | Cart is a unified `/en/cart` with a 4-step stepper; sender modal and schedule modal observed; `/en/payment` skeleton observed; address/payment strings from code. |
| "Sender identity is explicit" (Pass 2 §9) | Adds the **Surprise Gift toggle**, required email, and the hidden-sender order-detail string. |
| No-address "operationally under-specified" (Pass 1 §13, Pass 3 §9) | Adds the form fields, concierge wording, KSA feature flag, and the checkout label; remaining gaps listed in §10/§34. |
| Delivery levels "Standard / Same Day / Express / 3 Hour / Morning / Midnight / Fixed time / Next day" (Pass 1 §14–15, Pass 3 §22) | In live carts only **Standard and Midnight** exist; others are marketing/curation names; slots, prices and counts are city-specific (§13). |
| City availability "can empty entire sections" (Pass 2 §29) | Quantified per collection and city, with cluster aliases (Mecca=Jeddah, Dammam=Khobar) and the per-region homepage feed labels. |
| Payment methods "COD, cards…" | Adds the three-way contradiction (T&C vs UI vs code), Apple/Google Pay flags, `mada` absence. |
| Coupon "capability" (Pass 2 §18) | Adds the endpoint, the 409 error shape, the empty "Exclusive Deals Zone", `?promo` attribution, and the SAR 3 platform fee / Gold. |
| Order acceptance ≠ submission (Pass 3 §1) | Confirmed; status vocabulary added. |
| Tracking "public/customer order tracking" (Pass 2 §6) | The FAQ's public "Track Now" button does **not** exist on www; tracking is login-only. |
| Personalisation limits "100 KB–10 MB JPEG/PNG" (Pass 2 §13) | Reproduced; added enforcement test, editor, single-image rule, no composite preview, cart edit link, text-only/photo-only/2-step patterns. |
| Corporate gifting (Pass 1 §31) | Separates the SEO page (no form) from the real WordPress B2B site (enquiry form, catalogue PDF, no prices). |
| Money arrangements (Pass 1 §22) | Adds denomination disclosure text, price-vs-cash gap, BNPL on cash gifts, no cash-specific restrictions, VAT-line arithmetic over the full amount. |

---

## 37. Evidence URLs & artefacts

**Pages (inspected 2026-10-03):** `https://www.fnp.sa/`, `/en`, `/en/gifts-birthday`, `/en/flowers`, `/en/cakes`, `/en/same-day-delivery-gifts`, `/en/two-hour-delivery-gifts`, `/en/gifts-for-corporate`, `/en/gifts-dammam`, `/en/flowers-riyadh`, `/en/flowers-n-money`, `/en/search?qs=roses`, `/en/no-discount-collection-only-for-coupon-code`, `/en/gift/sweet-darling-roses-bouquet`, `/en/gift/chocolate-truffle-birthday-special-photo-cake`, `/en/gift/special-mango-cheesecake`, `/en/gift/customized-cake`, `/en/gift/graduation-cake`, `/en/gift/romantic-personalised-mug-n-cushion`, `/en/gift/golden-personalized-photo-frame-decorated`, `/en/gift/jador-eau-de-perfume-50-ml-with-name-v`, `/en/gift/beautiful-roses-and-1000-sar-money-bouquet`, `/en/gift/sar1800-and-artificial-flowers-arrangement`, `/en/gift/sanseveria-air-purifying-plant`, `/en/gift/white-helium-balloons`, `/en/gift/balloons-with-room-full-of-roses`, `/en/gift/gucci-flora-perfume-hamper`, `/en/gift/chocolate-cake-n-red-rose-bouquet`, `/en/gift/bostani-pink-flower-box`, `/en/cart`, `/en/payment`, `/en/wishlist`, `/en/orders`, `/en/faqs`, `/en/contact-us`, `/en/about-us`, `/en/terms-conditions`, `/en/privacy-policy`, `/robots.txt`, `/sitemap.xml` (+ 6 child sitemaps), `https://corporate.fnp.sa/en/`, `/en/faqs/`, `/en/giftology-laptop-backpack-black/`, `https://checkout.fnp.sa/en/policies/refund-policy`, `/en/policies/terms-of-service`, `/en/policies/shipping-policy`.
**Endpoints (read-only, as the storefront calls them):** `https://api.fnp.qa/talaash/v1/web/{autosuggest,product-list,facets}`, `…/consumer/api/{feed/active?type=homepage, auth/get-guest-token/v1, occasions/v1}`, `…/order/api/v1/{carts, carts/line-items, carts/promo, carts/groups/{key}/available-time-slots, carts/groups/{key}/available-dates, subscription/plans}`.
**Public client code reviewed (static JS chunks of `/_next/static/chunks/…`):** English message catalogue (≈800 keys across 20 namespaces), per-country configuration object, payment SDK chunk. Everything from this source is labelled `[code]` / INFERRED.
**Local evidence artefacts (not committed — FNP assets):** screenshots (`/tmp/claude-0/…/scratchpad/shots/*.png`: home/modal/city selector/mega menus/filters/mobile/PDPs/cart/sender modal/schedule modal/calendar/customize drawer/message card/payment skeleton/search/Arabic PDP), captured JSON (`…/raw/api/*.json`), sitemap files, and the extracted i18n/config dumps (`…/raw/i18n_en.txt`, `…/raw/js/`).

### Limitations
* No order/payment/personal-data entry ⇒ address step UI, payment-method list, account area, tracking detail, notifications and post-order behaviour not exercised.
* Observation window is one morning (≈05:00 Riyadh): **time-of-day effects (cut-offs, slot sell-out, same-day availability) could not be observed.**
* City tests used UI selection for 4 cities; extra geo ids were exercised through the same API with the storefront's headers (not selectable in the UI).
* Client-code findings prove built capability, not live behaviour in KSA.
* English locale was the primary lens; Arabic was checked for home, PDP and parity only.
* Prices/counts are a snapshot of 2026-10-03 and drift minute to minute.

### Recommended next research action
**FNP-DEEP-EVIDENCE-2 (needs a human operator with a real recipient, outside this agent's rules):** a supervised, low-value real order from Riyadh + one from Mecca to capture the address step, payment-method list (mada/Apple Pay), confirmation/email/SMS/WhatsApp content, invoice PDF (VAT/ZATCA fields), tracking statuses and timing, a deliberate **No-Address** order (contact timing/sender privacy), a customer-initiated cancellation attempt at three ages, and a late-afternoon cut-off probe — ideally on a refundable test order, with legal sign-off.
