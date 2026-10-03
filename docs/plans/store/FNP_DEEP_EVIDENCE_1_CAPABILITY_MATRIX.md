# FNP-DEEP-EVIDENCE-1 — Capability Matrix

**Companion to:** `FNP_DEEP_EVIDENCE_1_REPORT.md` · **Inspection date:** 2026-10-03 · **Target:** https://www.fnp.sa/ (+ `api.fnp.qa`, `checkout.fnp.sa`, `corporate.fnp.sa`)

> External evidence only — not an implementation authorization. Rows describe what FNP's *public* surfaces show; nothing here is an AWJ decision.

**Legend** — *Observed*: `OBSERVED` (seen in the rendered storefront or in a public JSON response the storefront itself calls) · `INFERRED [code]` (read only from publicly served client code / feature flags — proves built capability, not live KSA behaviour) · `NOT OBSERVED` (looked for, not found) · `UNKNOWN` (cannot be determined publicly). *Confidence*: HIGH / MEDIUM / LOW. *AWJ relevance* is analysis (HIGH/MED/LOW + why), not a decision. Evidence URLs are the page or endpoint where the evidence was seen; API endpoints are listed without session tokens.

**Row count:** 160 — OBSERVED 120 · INFERRED [code] 23 · NOT OBSERVED 13 · UNKNOWN 4.


## Discovery, taxonomy & search (22)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| Country & language gate on first visit | OBSERVED | https://www.fnp.sa/en | Modal: country (KSA, UAE, Singapore, Qatar visible on desktop; 8 countries on mobile) then delivery city, Confirm; Arabic default | HIGH | MED — market/locale selection pattern | Is the gate shown on every new device or geo-detected? |
| City selector limited to 4 cities | OBSERVED | https://www.fnp.sa/en | Riyadh, Jeddah, Mecca, Khobar only; footer/sitemap/API know ≥9 names | HIGH | HIGH — city UX / serviceability | Why is Madinah excluded from the selector but present in API? |
| Mega menu with 9 top items and titled columns | OBSERVED | https://www.fnp.sa/en | Birthday, Gift Sets, Flowers, Cakes, Perfumes, More Gifts, Occasions, Brands, Personalised; 1–5 titled columns each | HIGH | MED — IA reference | Is the menu CMS-driven per country? |
| ≥16 independent discovery dimensions | OBSERVED | https://www.fnp.sa/en/gifts-birthday | Family, occasion, recipient, combo type, brand, flower type/colour, packaging, flavour, cake type/theme, serving size, price, delivery, city, personalisation, season | HIGH | HIGH — single-tree catalogue insufficient | Which dimensions are mandatory for AWJ V1? |
| Two-level category hierarchy separate from facets | OBSERVED | https://api.fnp.qa/talaash/v1/web/facets | `category_hierarchy` l1/l2 with counts; other facets are attributes | HIGH | HIGH — taxonomy contract | Is hierarchy depth capped at 2 by design? |
| Curated collections as named records (curations) | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list | `pageType PLP_CURATION`, ids `cur_ksa_<slug>`; Birthday collection 514 vs Occasion facet Birthday 323 | HIGH | HIGH — collection membership model | Rule-based or manual membership? |
| Context-dependent facet set | OBSERVED | https://api.fnp.qa/talaash/v1/web/facets | 10 facets on Birthday; 8 after Flowers>Roses | HIGH | MED | How are facet sets chosen per collection? |
| Faceted listing with URL-encoded state | OBSERVED | https://www.fnp.sa/en/gifts-birthday?filters=category_hierarchy%3Aflowers%3Aroses | filters + sortBy/sortOrder in query; canonical stays clean; robots disallows | HIGH | MED — shareable filters / SEO | — |
| Infinite scroll listing (40/page) | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list | pageSize=40, hasNext, no numbered pagination | HIGH | MED | — |
| Price histogram slider | OBSERVED | https://www.fnp.sa/en/gifts-birthday | Histogram buckets of SAR 50; min/max inputs on mobile | HIGH | LOW | — |
| Sort: relevance / price asc / price desc / newest | OBSERVED | https://www.fnp.sa/en/gifts-birthday | `defaultPrice` sort; item at SAR 1,800 sat 2nd in ascending list | MEDIUM | LOW — sort on variant price | Sort key vs displayed price? |
| Product cards: options pill, Customize pill, delivery badge, heart, quick-add | OBSERVED | https://www.fnp.sa/en/gifts-birthday | No rating, no % off, no old price on cards; badge is an SVG image | HIGH | HIGH — card contract | Is badge text localised or baked into SVG? |
| Earliest-delivery badge on cards (SAME_DAY / MORNING) | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list | `earliestDelivery TODAY`, `earliestDeliveryNudge.type`; MORNING only on 23/285 Riyadh items | HIGH | HIGH — delivery promise on listing | How is earliest delivery computed per product? |
| Autosuggest with trending, discovery tiles, bestsellers | OBSERVED | https://api.fnp.qa/talaash/v1/web/autosuggest | Empty query returns 10 trending, discovery categories, 12 bestsellers | HIGH | MED | Are trending terms manual? |
| Curated-collection + product suggestions (city-aware) | OBSERVED | https://api.fnp.qa/talaash/v1/web/autosuggest?geoId=riyadh&keyword=wife&limit=8 | keywords (PLP_CURATION) + products with price; geoId on every call | HIGH | HIGH — search returns collections | Ranking logic? |
| Typo tolerance and Arabic queries | OBSERVED | https://api.fnp.qa/talaash/v1/web/autosuggest | `rosess` → roses; `زهور`, `كيك` return relevant results | HIGH | HIGH — AR/EN search parity | Synonym dictionary (AR/EN) behaviour? |
| No zero-result state for nonsense queries | OBSERVED | https://www.fnp.sa/en/search?qs=xqzvbn | 29 vanilla-cake results for gibberish; no-results component exists in code | HIGH | MED — avoid false matches | Match threshold? |
| Search results page reusing PLP facets | OBSERVED | https://www.fnp.sa/en/search?qs=roses | 261 Today items; price SAR 79–18,000 | HIGH | MED | — |
| Recent searches | INFERRED [code] | https://www.fnp.sa/en | Strings `recentSearches`, `clearRecent`; not shown on fresh profile | MEDIUM | LOW | Stored locally or server-side? |
| Mobile filter bottom sheet | OBSERVED | https://www.fnp.sa/en/gifts-birthday | Tab strip, histogram, 'Clear All Filters', 'Show Items' | HIGH | MED — mobile filter UX | — |
| Brand pages via brand attribute | OBSERVED | https://www.fnp.sa/en/all-brands | `brand` field (FNP, FNP-KSA, Bostani, Gucci, Dior…); 13 brand collections in sitemap | HIGH | MED | Brand governance (who owns brand pages)? |
| Internal labels leak (Branded_new, duplicate colours, Arabic facet labels) | OBSERVED | https://www.fnp.sa/en/gifts-birthday | `Branded_new(51)`, Multi-colored/Multi Color/Multi-color, `تشيز كيك(1)` | HIGH | MED — data hygiene guardrails | — |

## PDP, personalisation, add-ons, bundles, money gifts, food/plants/safety (42)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| PDP with SKU, price, variants, BNPL panel, trust strip, accordions | OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | SKU under image; Product Details / Delivery Information / Care Instructions / Reviews | HIGH | HIGH — PDP content contract | Which accordions are mandatory per family? |
| No delivery date/time picker on PDP | OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | City global; date/slot chosen in cart | HIGH | HIGH — where delivery promise lives | Why defer slot selection? |
| PDP content gaps on many cakes/combos | OBSERVED | https://www.fnp.sa/en/gift/special-mango-cheesecake | No description/delivery/care sections | HIGH | MED — content completeness rule | — |
| Size/flavour variants with per-variant price | OBSERVED | https://www.fnp.sa/en/gift/customized-cake | Weight × flavour; `-V0` variant ids; 3–12 options on cards | HIGH | HIGH — variant model | Variant stock per city? |
| Gift-upgrade variants ('With Balloons', 'With Cake n Roses') | OBSERVED | https://www.fnp.sa/en/gift/chocolate-cake-n-red-rose-bouquet | Fixed tiers at +20/+40/+120/+330 SAR; no per-component choice | HIGH | HIGH — configurable vs fixed bundles | Are tiers separate SKUs in inventory? |
| Composition as free-text bullets | OBSERVED | https://www.fnp.sa/en/gift/gucci-flora-perfume-hamper | Components listed incl. third-party brand names | HIGH | HIGH — BOM question | Structured composition? |
| Product-level ratings/reviews (verified-buyer note) | OBSERVED | https://www.fnp.sa/en/gift/gucci-flora-perfume-hamper | '5.0 (1)', '62 days ago', 'All reviews are from verified buyers'; no aggregateRating in JSON-LD | HIGH | MED — social proof | Verification mechanism? |
| Image-based 'Find Similar' | OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | Button on main image; behaviour not exercised | LOW | LOW | How is similarity computed? |
| BNPL messaging (Tamara, Tabby) without computed instalments | OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | Text only; also shown on cash-gift PDPs | HIGH | MED — BNPL widget | Min/max basket eligibility? |
| Substitution disclosure on PDP (3 wordings) | OBSERVED | https://www.fnp.sa/en/gift/romantic-personalised-mug-n-cushion | 'without notifying you' vs 'same value, quality' vs 'we offer a substitution option' | HIGH | HIGH — substitution policy | Approval / notification mechanics? |
| Care and safety text per family | OBSERVED | https://www.fnp.sa/en/gift/white-helium-balloons | Cakes: consume within 48 h; balloons: choking <8 y; plants 18–28 °C | HIGH | MED — safety content | Allergen block only on one cake page? |
| Allergen information | OBSERVED | https://www.fnp.sa/en/gift/customized-cake | 'Flour, Egg, Chocolate, Dairy, soya' on one cake page only | MEDIUM | HIGH — food compliance | Where are ingredients/allergens for others? |
| Product video | NOT OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | Gallery of stills only | MEDIUM | LOW | — |
| Arabic/English product name divergence | OBSERVED | https://www.fnp.sa/gift/sweet-darling-roses-bouquet | AR 'أميرة الورد \| 150 وردة حمراء' vs EN 'Sweet Darling…'; copy says 'FNB' | HIGH | MED — localisation integrity | — |
| Photo + text personalisation (2 steps) | OBSERVED | https://www.fnp.sa/en/gift/chocolate-truffle-birthday-special-photo-cake | Upload → crop/rotate → text ≤25 → Save and Continue | HIGH | HIGH — structured inputs | — |
| Text-only personalisation (≤25 chars) | OBSERVED | https://www.fnp.sa/en/gift/graduation-cake | Counter 0/25, optional | HIGH | HIGH | Allowed characters / Arabic text rules? |
| Photo-only personalisation | OBSERVED | https://www.fnp.sa/en/gift/golden-personalized-photo-frame-decorated | Upload + editor, 1/1 | HIGH | HIGH | — |
| Single-image rule and file spec | OBSERVED | https://www.fnp.sa/en/gift/chocolate-truffle-birthday-special-photo-cake | accept image/*, multiple=false; 'JPEG or PNG, 100 KB–10 MB' | HIGH | HIGH — validation spec | Server-side enforcement? |
| Floor on file size not enforced client-side | OBSERVED | https://www.fnp.sa/en/gift/chocolate-truffle-birthday-special-photo-cake | 179-byte PNG accepted into editor; .txt silently ignored | HIGH | HIGH — validation UX | Server rejects later? |
| Image editor (crop, rotate, flip) | OBSERVED | https://www.fnp.sa/en/gift/chocolate-truffle-birthday-special-photo-cake | Square crop handles, fine-rotation slider, Reset/Apply | HIGH | MED | — |
| No composite preview of customer image | OBSERVED | https://www.fnp.sa/en/gift/chocolate-truffle-birthday-special-photo-cake | Step-2 preview showed the stock product image | MEDIUM | HIGH — expectation management | Is a preview produced later? |
| Personalisation stored on cart line | OBSERVED | https://api.fnp.qa/order/api/v1/carts/line-items | `personalizedDetails {text[], images[]}`; signed GCS PUT; cart 'Edit' link | HIGH | HIGH — order-line data model | Retention of uploaded images? |
| Personalisation does not change price or earliest slot | OBSERVED | https://www.fnp.sa/en/cart | 149 → 149; slot 8–12 same day | MEDIUM | HIGH — lead-time policy | Production lead time for photo cakes? |
| Add-ons gated until personalisation done | INFERRED [code] | https://www.fnp.sa/en/cart | 'Sending personalised gift? Please customise the gift first to add addons.' | MEDIUM | MED | — |
| Order-level message card (occasion + ≤200 chars + presets) | OBSERVED | https://www.fnp.sa/en/cart | 16 occasion records; 4–19 preset messages each; FREE | HIGH | HIGH — gift message vs product text | Printed card or digital? |
| Delivery instruction (≤50 chars) | OBSERVED | https://www.fnp.sa/en/cart | Textarea with counter 0/50 | HIGH | MED | Passed to courier verbatim? |
| Add-on carousel on PDP, post-add modal and cart | OBSERVED | https://www.fnp.sa/en/cart | 'Make it extra special' in three places; category tabs vary by product | HIGH | HIGH — one recommendation contract | — |
| Add-ons are separate lines with own quantity | INFERRED [code] | https://api.fnp.qa/order/api/v1/carts/line-items | itemType MAIN vs add-on; quantity steppers; `recommendations.addOnProducts` | MEDIUM | HIGH | Add-on stock and substitution? |
| Fixed bundles sold as one SKU | OBSERVED | https://www.fnp.sa/en/gift/chocolate-cake-n-red-rose-bouquet | Roses + 250 g mini cake; tiered upgrade variants | HIGH | HIGH | BOM/inventory per component? |
| Configurable bundle (customer picks components) | NOT OBSERVED | https://www.fnp.sa/en/combos | Only fixed lists and tiers | MEDIUM | MED | — |
| 'Flowers & X' merchandising collections | OBSERVED | https://www.fnp.sa/en/flowers-n-chocolates | Menu entries over fixed SKUs | HIGH | MED | — |
| Money bouquets sold as ordinary SKUs | OBSERVED | https://www.fnp.sa/en/gift/beautiful-roses-and-1000-sar-money-bouquet | SAR 1,399 with 1,000 cash; same cart, slots, coupon, BNPL | HIGH | HIGH — needs ADR before use | Accounting/KYC/limits? |
| Denomination and amount disclosed as text and in title | OBSERVED | https://www.fnp.sa/en/gift/sar1800-and-artificial-flowers-arrangement | '18 × 100 riyal notes, totalling 1800 riyals' | HIGH | HIGH | Structured denominations? |
| Cash-specific restrictions / disclosures | NOT OBSERVED | https://www.fnp.sa/en/gift/beautiful-roses-and-1000-sar-money-bouquet | None at PDP/cart/payment skeleton | MEDIUM | HIGH | Hidden verification at acceptance? |
| City availability of money gifts | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list?slug=flowers-n-money | Riyadh 17, Jeddah 15, Khobar 17, Madinah 0 | HIGH | MED | — |
| VAT line computed over cash component | OBSERVED | https://www.fnp.sa/en/cart | Tax 186.13 on 1,427 total | HIGH | HIGH — no accounting conclusion | — |
| Cake weight/serving/flavour/type facets | OBSERVED | https://www.fnp.sa/en/cakes | Serving size, flavour, cake type, theme | HIGH | MED | — |
| Shelf life guidance 'consume within 48 hours' | OBSERVED | https://www.fnp.sa/en/gift/customized-cake | Refrigerate, serve at room temperature | HIGH | MED | — |
| Refrigerated/dedicated fleet claim | OBSERVED | https://www.fnp.sa/en/gift/customized-cake | Also appears on non-perishables | MEDIUM | LOW | Real cold chain? |
| Plant care text and pot description | OBSERVED | https://www.fnp.sa/en/gift/sanseveria-air-purifying-plant | Light, water, 18–28 °C; no toxicity note | HIGH | MED | — |
| Plant availability by city | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list?slug=plants | 94 / 54 / 67 / 8 | HIGH | MED | — |
| Balloon choking warning | OBSERVED | https://www.fnp.sa/en/gift/white-helium-balloons | Children under eight | HIGH | LOW | — |

## Cart, checkout, payment & promotions (28)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| Unified cart + checkout page with 4-step stepper | OBSERVED | https://www.fnp.sa/en/cart | Sender info → Delivery address → Time slot → Payment | HIGH | HIGH — checkout structure | Strict step order? |
| Guest checkout with server-side cart | OBSERVED | https://api.fnp.qa/consumer/api/auth/get-guest-token/v1 | Guest JWT (~100-year expiry), cart row created on first add | HIGH | HIGH — guest session design | Token lifetime rationale? |
| Quantity dropdown, remove | OBSERVED | https://www.fnp.sa/en/cart | — | HIGH | LOW | Max quantity? |
| No save-for-later / move-to-wishlist in cart | NOT OBSERVED | https://www.fnp.sa/en/cart | — | MEDIUM | LOW | — |
| Delivery groups per vendor\|method\|slot\|date | OBSERVED | https://api.fnp.qa/order/api/v1/carts?geoId=riyadh | `itemGroups[].groupKey`, per-group totals, `groupingSummary` | HIGH | HIGH — multi-delivery order model | How are groups split when items differ? |
| Pre-selected earliest same-day slot and Standard method | OBSERVED | https://www.fnp.sa/en/cart | Default 8–12, SAR 25 before address | HIGH | HIGH — promise before address | — |
| Platform fee (SAR 3) | OBSERVED | https://api.fnp.qa/order/api/v1/carts/line-items | `priceBreakup.platformFee: 3` on every cart; outside group totals | HIGH | HIGH — fee transparency | VAT treatment of the fee? |
| Tax-inclusive pricing; VAT line = total × 15/115 | OBSERVED | https://www.fnp.sa/en/cart | 10 carts match; includes embedded cash on money bouquets | HIGH | HIGH — tax display contract (no conclusion) | Which components are taxable? |
| Coupon field with generic error | OBSERVED | https://api.fnp.qa/order/api/v1/carts/promo | POST {code, geoId} → 409 'Invalid promo code: <code>' | HIGH | MED — promo UX | Error taxonomy (expired / ineligible)? |
| Coupon stacking / minimum / exclusions | UNKNOWN | https://www.fnp.sa/en/cart | Not observable without valid codes | LOW | HIGH | — |
| Recommended promos in cart | INFERRED [code] | https://api.fnp.qa/order/api/v1/carts?geoId=riyadh | `recommendedPromos: []` | LOW | MED | — |
| FNP Gold shipping membership upsell | OBSERVED | https://api.fnp.qa/order/api/v1/subscription/plans | SAR 49/yr, 4 free deliveries, benefits list, FAQ; COD not applicable to Gold | HIGH | MED — membership | Does Gold waive platform fee? |
| Sender modal (first, last, phone, email required) | OBSERVED | https://www.fnp.sa/en/cart | +966 selector; blocks checkout until saved | HIGH | HIGH — sender capture | — |
| Surprise Gift toggle (sender hidden at delivery) | OBSERVED | https://www.fnp.sa/en/cart | 'Your details won't be shared at the time of delivery'; order detail hides sender | HIGH | HIGH — anonymous gifting | How is sender shown on card? |
| Address step with map/current location/saved addresses | INFERRED [code] | https://www.fnp.sa/en/cart | Search area/street, 'Use current location', saved addresses (login), Home/Office/Others | MEDIUM | HIGH — address model | — |
| Address fields incl. villa/building/directions/postal code | INFERRED [code] | https://www.fnp.sa/en/cart | Apt/Villa, building/cluster, block-street-house, directions, 6-digit postal (inherited) | MEDIUM | HIGH | KSA national address support? |
| No-address option ('Don't know the address?') | INFERRED [code] | https://www.fnp.sa/en/payment | Receiver name/phone/country/city only; 'concierge'; KSA flag true; label on payment page | MEDIUM | HIGH — no-address flow | Contact timing, failure outcome, fees? |
| Payment page skeleton reachable without a cart | OBSERVED | https://www.fnp.sa/en/payment | Shows `undefined undefined`, total 0, disabled Pay Now | HIGH | LOW | — |
| Payment logos: Visa, Mastercard, PayPal, Amex, Tabby, Tamara | OBSERVED | https://www.fnp.sa/en/payment | No mada logo/string anywhere | HIGH | HIGH — Saudi payment coverage | mada behind card SDK? |
| COD, Apple Pay, Google Pay enabled for KSA | INFERRED [code] | https://www.fnp.sa/en/cart | `isCodAvail`, `applePayNativeEnabled`, `googlePayNativeEnabled` true; PayNow/Atome false | MEDIUM | HIGH | COD limits / fees? |
| Payment states: expired/closed/waiting/failed with auto-refund copy | INFERRED [code] | https://www.fnp.sa/en/payment | 'refunded automatically within a few minutes' | MEDIUM | MED — payment intent states | — |
| T&C payment methods contradict UI | OBSERVED | https://www.fnp.sa/en/terms-conditions | Visa/Master/Amex/PayPal only | HIGH | MED | — |
| Edit-order prompt on checkout | INFERRED [code] | https://www.fnp.sa/en/payment | 'Edit sender, recipient and delivery details' | LOW | MED | Window and conditions? |
| Address-step order vs slot-step order | UNKNOWN | https://www.fnp.sa/en/cart | Stepper implies address then slot; not exercised | LOW | MED | — |
| Gifts On Sale collection | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list?slug=gifts-on-sale | 28 items; no % badges on cards | MEDIUM | MED | Discount engine? |
| Coupon-only 'Exclusive Deals Zone' | OBSERVED | https://www.fnp.sa/en/no-discount-collection-only-for-coupon-code | Empty (0 products) but live | HIGH | LOW | Intended use? |
| ?promo attribution parameter | OBSERVED | https://www.fnp.sa/robots.txt | `Disallow: /*?promo`; corporate links use ?promo=… | MEDIUM | LOW | — |
| Newsletter discount (legacy only) | OBSERVED | https://checkout.fnp.sa/en/policies/shipping-policy | '10% off when you subscribe' on Shopify footer; not on www | HIGH | LOW | — |

## Delivery & city-aware commerce (14)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| Standard delivery with 7 slots (Riyadh/Jeddah) at SAR 25 | OBSERVED | https://api.fnp.qa/order/api/v1/carts/groups/KSAV_RIYADH%7CKSAV_RIYADH_STD%7Cslot_0800_1200%7C2026-10-03/available-time-slots | Morning 8–12, 11–3; afternoon/evening 1–5, 3–7, 5–9, 7–11; night 10pm–2am | HIGH | HIGH | Slot capacity? |
| Midnight delivery 11:00–11:59 pm at SAR 49 | OBSERVED | https://api.fnp.qa/order/api/v1/carts/groups/KSAV_RIYADH%7CKSAV_RIYADH_STD%7Cslot_0800_1200%7C2026-10-03/available-time-slots | Riyadh, Jeddah, Khobar; not Mecca | HIGH | HIGH | Cut-off for midnight? |
| Mecca: SAR 35, two slots (10–4, 4–10), no midnight | OBSERVED | https://api.fnp.qa/order/api/v1/carts?geoId=makkah | Vendor KSAV_JED_MAK method STD_MAK | HIGH | HIGH — per-city method catalogue | — |
| Khobar: Eastern vendor, 5 standard slots + midnight | OBSERVED | https://api.fnp.qa/order/api/v1/carts?geoId=khobar | 10–2, 12–5, 3–8, 5–11, 10pm–2am | HIGH | HIGH | — |
| Same-day derived from first slot flag | OBSERVED | https://api.fnp.qa/order/api/v1/carts/groups | `earliestForDay` on first slot; default selected | HIGH | HIGH | How is earliest computed (cut-offs)? |
| Express / 3-hour / fixed-time / pickup selectable | NOT OBSERVED | https://www.fnp.sa/en/cart | `instantDelivery:false`; marketing mentions them; 2-hour collection empty | HIGH | HIGH — marketing vs live | — |
| Global method-type vocabulary (35 codes) | OBSERVED | https://api.fnp.qa/order/api/v1/subscription/plans | 1HR, EXPRESS_30/60, INSTANT, FIXED_TIME, EARLY_MORNING, INTL_*, VALENTINE_* … | HIGH | MED — shipment taxonomy | Which are live per country? |
| Date selection: 3 quick dates + calendar to ~2 months | OBSERVED | https://www.fnp.sa/en/cart | Calendar enabled 3 Oct–3 Dec 2026; later months disabled but navigable | HIGH | MED — booking horizon | Blocked/peak dates? |
| Flat delivery price per method | OBSERVED | https://api.fnp.qa/order/api/v1/carts | No per-product/weight/peak surcharge seen | MEDIUM | MED | Peak-day surcharges (Valentine, Eid)? |
| City-specific catalogue size, shared pricing | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list | Birthday 514/503/512/109; 0 price diffs across common products | HIGH | HIGH — assortment vs price | Assortment source of truth? |
| Regional aliasing (Mecca=Jeddah, Dammam/Jubail/Dhahran=Khobar) | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list | Identical counts and feeds | HIGH | HIGH — zone clusters | — |
| Per-region homepage CMS feeds | OBSERVED | https://api.fnp.qa/consumer/api/feed/active?type=homepage | KSA HP Riyadh / JED / EST / MED / default; Madinah 7 vs 9 components | HIGH | MED — regional merchandising | Who curates feeds? |
| Unknown city falls back silently; API says serviceable:true with 0 products | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list?geoId=taif | UI normalises to Riyadh | HIGH | HIGH — serviceability semantics | — |
| 21 SEO city landing pages | OBSERVED | https://www.fnp.sa/en/gifts-dammam | 21 indexed city landing pages were observed across gifts/flowers/cakes; not every product-family × city combination exists, and Madinah is missing from this set | HIGH | MED — city SEO | Which family/city combinations are intentionally omitted? |

## Gifting identity, account, wishlist, orders, lifecycle, notifications (19)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| Sender vs recipient vs account separation | OBSERVED | https://www.fnp.sa/en/cart | Sender captured first; recipient per delivery; account optional | HIGH | HIGH | — |
| Recipient details in address form; 'Ordering for yourself?' | INFERRED [code] | https://www.fnp.sa/en/cart | RECEIVER'S DETAILS section; use own details | MEDIUM | HIGH | — |
| Saved addresses / address book | INFERRED [code] | https://www.fnp.sa/en/orders | 'Your saved address'; FAQ mentions address book | MEDIUM | MED | — |
| Occasion reminders with recipient 'profiles' | INFERRED [code] | https://www.fnp.sa/en/cart | Name, relation, occasion, date, avatar; '20% off your next gift' banner | MEDIUM | MED — retention loop | App-only? |
| Multi-delivery orders (Delivery N of M) | INFERRED [code] | https://www.fnp.sa/en/orders | Switcher UI for several deliveries in one order | MEDIUM | HIGH — multi-recipient | Multi-recipient at checkout? |
| Substitution approval flow | UNKNOWN | https://www.fnp.sa/en/orders | No notification evidence | LOW | HIGH | — |
| Login-gated wishlist | OBSERVED | https://www.fnp.sa/en/wishlist | Guest heart → login; empty state text | HIGH | MED | — |
| Share / clear all / add-all-to-cart | NOT OBSERVED | https://www.fnp.sa/en/wishlist | No UI and no strings | MEDIUM | LOW | — |
| Mobile/email OTP login; Google; Apple | OBSERVED | https://www.fnp.sa/en | 'Login with Mobile / Email Id'; 4-digit OTP via WhatsApp or SMS [code] | HIGH | HIGH — Saudi login norms | OTP provider/costs? |
| Marketing consent checkbox suppressed for KSA | INFERRED [code] | https://www.fnp.sa/en | `showFnpUpdatesConsent:false` | MEDIUM | HIGH — consent design | Consent captured elsewhere? |
| Profile fields (DOB, anniversary, gender) | INFERRED [code] | https://www.fnp.sa/en/orders | Used for marketing/reminders | MEDIUM | MED | — |
| Account deletion/correction UI | NOT OBSERVED | https://www.fnp.sa/en/privacy-policy | Email support@fnp.sa only | MEDIUM | HIGH — privacy rights | — |
| Order history with reorder, rate, help, invoice, delete-from-history | INFERRED [code] | https://www.fnp.sa/en/orders | Reorder replaces cart; rate delivery and items; invoice (KSA flag) | MEDIUM | MED | — |
| Public tracking by order number | NOT OBSERVED | https://www.fnp.sa/en/track-order | 404; FAQ promises 'Track Now' | HIGH | MED — enumeration-safe design | — |
| Order status vocabulary (7 codes) | INFERRED [code] | https://www.fnp.sa/en/orders | ORDERED, APPROVED, PROCESSING, HOLD, OUT_FOR_DELIVERY, DELIVERED, CANCELLED | MEDIUM | HIGH | Is HOLD the unreachable-recipient state? |
| Payment status vocabulary (6) | INFERRED [code] | https://www.fnp.sa/en/orders | Pending, Authorized, Successful, Partially Refunded, Refunded, Failed | MEDIUM | HIGH — separate payment lifecycle | — |
| Submission ≠ acceptance | OBSERVED | https://www.fnp.sa/en/terms-conditions | Merchant may accept/refuse/cancel in whole or part; verification before acceptance | HIGH | HIGH | SLA for acceptance? |
| OTP via WhatsApp/SMS | INFERRED [code] | https://www.fnp.sa/en | Channel choice and resend timer | MEDIUM | MED | — |
| Order/delivery notifications | UNKNOWN | https://www.fnp.sa/en/orders | Copy implies updates; channels not visible | LOW | HIGH | — |

## Policy, privacy, legal & support (12)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| Customer-initiated cancellation policy | NOT OBSERVED | https://www.fnp.sa/en/terms-conditions | Cancellation sentence truncated: 'FNP will not cancel or alter.' | HIGH | HIGH | Windows/fees? |
| Refund policy | OBSERVED | https://checkout.fnp.sa/en/policies/refund-policy | Only merchant-cancellation remedy (refund to same card/bank) | HIGH | HIGH | Timelines? |
| Returns policy | NOT OBSERVED | https://www.fnp.sa/en/terms-conditions | No page; 'FNP Purchase Protection' string only | HIGH | HIGH | — |
| Failed-delivery policy | NOT OBSERVED | https://www.fnp.sa/en/terms-conditions | Nothing on absent/unreachable/refused/wrong address | HIGH | HIGH | — |
| Shipping policy page on www | NOT OBSERVED | https://www.fnp.sa/en/shipping-policy | 404 (exists on legacy Shopify) | HIGH | MED | — |
| CR and VAT numbers on www | NOT OBSERVED | https://www.fnp.sa/en/terms-conditions | Only on legacy store footer | HIGH | HIGH — trust/legal | — |
| Invoice template with Qatar registered address, no VAT fields | INFERRED [code] | https://www.fnp.sa/en/orders | `regEn` Doha address; keys lack VAT/ZATCA | MEDIUM | HIGH — ZATCA/legal | Server-rendered KSA invoice contents? |
| Privacy policy generic and legacy-worded | OBSERVED | https://www.fnp.sa/en/privacy-policy | No sender/recipient distinction, no retention, no PDPL mention | HIGH | HIGH — recipient data | — |
| Trackers before consent; no cookie banner | OBSERVED | https://www.fnp.sa/en | GA4, Google Ads, TikTok, Snapchat, Rudderstack fire on load | HIGH | HIGH — consent policy | — |
| WhatsApp floating button | OBSERVED | https://www.fnp.sa/en | +966 59 905 1879 deep link | HIGH | MED | Order-specific context passed? |
| Inconsistent contact data across pages | OBSERVED | https://www.fnp.sa/en/faqs | Four numbers/emails; two opening-hours statements | HIGH | LOW — avoid | — |
| In-transaction support (Help on order, 'Need gifting help?') | INFERRED [code] | https://www.fnp.sa/en/orders | Chat with experts string; Help button | LOW | MED | — |

## Corporate, SEO, growth, mobile & technical surface (13)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| Marketing SEO page (no form) | OBSERVED | https://www.fnp.sa/en/gifts-for-corporate | Header 'Corporate' target; Indian partner copy (Airtel, Cred, MobKwik) | HIGH | MED | — |
| Separate WordPress B2B site with enquiry forms | OBSERVED | https://corporate.fnp.sa/en/ | Name, phone, email, 'I am looking for', quantity, company; Talk to Expert | HIGH | HIGH — B2B funnel | — |
| Digital catalogue PDF; no prices; Enquire Now only | OBSERVED | https://corporate.fnp.sa/en/giftology-laptop-backpack-black/ | KSA portfolio 04/2025 | HIGH | MED | — |
| MOQ / bulk pricing / samples / PO / bank transfer / lead time | OBSERVED (claims) | https://corporate.fnp.sa/en/faqs/ | FAQ claims only; 2–3 business days | MEDIUM | MED — verify before copying | Real terms? |
| Branded packaging and logo customisation | OBSERVED (claims) | https://corporate.fnp.sa/en/ | Marketing sections; no configurator | MEDIUM | MED | — |
| Large page factory (318 collections, 2,085 products per locale) | OBSERVED | https://www.fnp.sa/sitemap.xml | lastmod ≈ June 2026 | HIGH | MED | — |
| Junk/foreign festival pages indexable | OBSERVED | https://www.fnp.sa/en/gifts-diwali | Diwali, Easter, Thanksgiving, Halloween, Christmas, Indian Valentine-week pages | HIGH | LOW — avoid | — |
| English collections canonicalised to Arabic URL, no hreflang | OBSERVED | https://www.fnp.sa/en/gifts-birthday | PDPs correct; PLPs not; no <h1> in server HTML | HIGH | MED — SEO hygiene | — |
| Structured data limited to Breadcrumb/Product | OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | No AggregateRating/ItemList/FAQPage | HIGH | LOW | — |
| App promotion + reminders + Gold + BNPL | OBSERVED | https://www.fnp.sa/en | Footer QR, store badges, hero strip | HIGH | MED | — |
| Multi-country single codebase with per-country flags | INFERRED [code] | https://www.fnp.sa/en | Config object per country toggling COD, no-address, invoice, wallets… | MEDIUM | HIGH — policy-as-config | — |
| Bottom-tab app-like shell and filter sheet | OBSERVED | https://www.fnp.sa/en | Tabs: fnp / Categories / Reminders / Account | HIGH | MED — mobile IA | — |
| Headless Next.js + first-party APIs; legacy Shopify still live | OBSERVED | https://www.fnp.sa/en | x-powered-by Next.js; api.fnp.qa; checkout.fnp.sa Shopify | HIGH | MED — stack context | Which stack takes orders? |

## Weaknesses (what not to copy) (10)

| Capability | Observed | Evidence URL | Details | Confidence | AWJ relevance | Open question |
|---|---|---|---|---|---|---|
| AED price on the Saudi homepage | OBSERVED | https://api.fnp.qa/consumer/api/feed/active?type=homepage | CMS feed item stores currency AED | HIGH | HIGH — currency integrity | — |
| Foreign business data on Saudi surfaces (Qatar address, Indian partners) | OBSERVED | https://www.fnp.sa/en/about-us | Qatar/UAE copy in About; invoice template Doha | HIGH | HIGH | — |
| FAQ describes non-existent tracking | OBSERVED | https://www.fnp.sa/en/faqs | 'Track Order … Track Now' | HIGH | MED | — |
| Silent substitution wording | OBSERVED | https://www.fnp.sa/en/gift/white-helium-balloons | 'without notifying you' | HIGH | HIGH | — |
| Search shows junk matches and internal suggestion | OBSERVED | https://api.fnp.qa/talaash/v1/web/autosuggest | `influencer-graduation`; 'same day' → Daughters Day | HIGH | MED | — |
| Stale seasonal inventory in October | OBSERVED | https://api.fnp.qa/talaash/v1/web/product-list?slug=new-arrival-gifts | 2026 Grad box, Valentine items, Eid/Ramadan collections live | HIGH | MED | — |
| Accessibility defects (header cart labelled 'Add to cart', unlabeled heart, image-only badges) | OBSERVED | https://www.fnp.sa/en/gift/sweet-darling-roses-bouquet | DOM aria-labels | HIGH | HIGH — a11y baseline | — |
| Counts drift and misleading serviceable flag | OBSERVED | https://www.fnp.sa/en/gifts-birthday | 514 vs 553 on separate loads | MEDIUM | MED | — |
| Over-long guest tokens | OBSERVED | https://api.fnp.qa/consumer/api/auth/get-guest-token/v1 | exp ≈ year 2126 | HIGH | HIGH — security hygiene | — |
| Trust claims inconsistent (1M vs 6M customers; 25 vs 30 years) | OBSERVED | https://www.fnp.sa/en/about-us | Contradictory across PDP/About | HIGH | LOW | — |
