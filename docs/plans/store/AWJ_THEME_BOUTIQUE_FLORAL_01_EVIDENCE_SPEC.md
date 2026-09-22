# AWJ Ready Theme — Boutique / Floral 01

**Status:** Evidence Pass in progress — living specification, not implementation  
**Reference site:** `https://romancflower.com/`  
**Observed:** 2026-09-22  
**Repository:** `safwan5001-source/Nebrax`  
**Baseline:** `main` @ `dffe6c86017e88019a82fceb2b0214d8a895b332`  
**Target:** one ready-made, merchant-customizable theme in the AWJ Store theme library  
**Working name:** `Boutique / Floral 01`  
**Related authority:** `AWJ_STORE_CUSTOMIZER_UX_V2.md`, `AWJ_STORE_CUSTOMIZER_PERSISTENCE_ARCHITECTURE.md`, `AWJ_STOREFRONT_DESIGN_SYSTEM.md`, `AWJ_STOREFRONT_RESPONSIVE_BASELINE_V1.md`, `AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`.

---

## 1. Decision record

AWJ will treat the reference as inspiration for a **complete ready-made storefront theme**, not as a redesign of the ERP application and not as a one-page visual skin.

The implementation contract is:

```text
Ready Theme
  = theme metadata
  + theme-token preset
  + component variants
  + page templates
  + section presets and default order
  + responsive rules
  + interaction/state rules
  + Customizer control schema
```

Applying the theme must instantiate a coherent storefront experience using the merchant's own catalog, categories, content, brand and media. The merchant can then edit it through the same AWJ visual Customizer: click-to-edit, add/reorder/duplicate/hide/delete sections, Desktop/Tablet/Mobile preview, Draft/Preview/Publish and Basic/Advanced disclosure.

This document is intentionally separate from the ERP design system. ERP chrome remains a dense daily accounting tool. This theme governs the **public storefront canvas only**. The Customizer chrome continues to follow the AWJ ERP design system; only its preview canvas renders this theme.

## 2. Legal and product boundary

AWJ may reproduce the reference's **design direction and reusable interaction patterns**, but must not copy:

- the Romanc Flower name, logo or trade dress;
- product, testimonial, editorial or campaign copy;
- photographs, illustrations, icons or payment images;
- downloadable code, CSS, JavaScript or WordPress/Woodmart implementation details;
- identifiers, analytics tags, URLs or third-party account data.

AWJ implementation must use original components and merchant-provided/licensed content. Reference-specific WordPress and WooCommerce mechanics are evidence of behavior, not the AWJ architecture.

## 3. Evidence method and confidence labels

Every statement in this document uses one of these labels:

| Label | Meaning |
|---|---|
| **Observed** | Directly visible or measurable on the live public reference at the stated viewport/date. |
| **Observed, content-dependent** | Present on at least one observed page/product; may vary with catalog data. |
| **Inferred** | Strongly suggested by loaded markup/styles or common component behavior, but the final UI state was not directly observed. |
| **AWJ decision** | Chosen for AWJ; not claimed to exist on the reference. |
| **Not observed** | Not accessible or not yet exercised. Must not be invented or marked complete. |

Current direct browser viewport: **1363 × 936 CSS px**, Arabic RTL.

## 4. Coverage ledger

| Surface / state | Current evidence | Status |
|---|---|---|
| Home — desktop | Direct live inspection, DOM and computed styles | **Observed** |
| Catalog/products page — desktop | Direct live inspection | **Observed** |
| Product detail — desktop | Direct live inspection of simple product | **Observed** |
| Empty cart — desktop | Direct live inspection | **Observed** |
| Account login — desktop | Direct live inspection | **Observed** |
| Blog index — desktop | Direct live inspection | **Observed** |
| About page shell — desktop | Direct live inspection; page body appeared visually/content-light | **Observed with gap** |
| Header/footer global shells | Seen across all inspected pages | **Observed** |
| Search overlay/results | Full-screen open/close and query entry observed; successful/no-result rendering still unresolved | **Observed with gap** |
| Wishlist | Header and product actions found; destination/state not yet verified | **Partial** |
| Compare | Related-product compare actions found; compare page not yet verified | **Partial** |
| Quick view | Earlier public crawl suggested it; current direct live state not yet verified | **Not yet confirmed** |
| Mini-cart | Empty side drawer observed; populated state not exercised | **Observed with gap** |
| Filled cart | Populated state not exercised | **Not observed** |
| Checkout with empty cart | Direct visit redirected to the empty-cart surface | **Observed boundary** |
| Checkout with populated cart | Not exercised | **Not observed** |
| Product variations/options | Only a simple product was directly inspected | **Not observed** |
| Out-of-stock/backorder | Stock filter exists; card/detail states not yet captured | **Not observed** |
| Product search results / no results | Not exercised | **Not observed** |
| Mobile 390/430 | Mobile navigation and sticky-toolbar assets detected, but no direct viewport observation yet | **Not observed** |
| Tablet 768/1024 | Not directly observed | **Not observed** |
| Hover/focus/keyboard states | Static styles inspected; state matrix still pending | **Partial** |
| Loading/skeleton/error | Not exposed during public-page pass | **Not observed** |

**Completion rule:** this theme specification cannot become `Ready for implementation` until every required row in §16 is either directly observed, explicitly replaced by an AWJ decision, or intentionally excluded with a reason.

## 5. Reference technology — evidence only

The reference currently exposes WordPress, WooCommerce, Woodmart and Elementor classes/assets. Examples include product-loop modules, side cart, full-screen search, sticky toolbar, Swiper carousels, product labels, wishlist/compare actions and Elementor animation/countdown/testimonial widgets.

**AWJ decision:** none of those packages or their DOM contracts become AWJ dependencies. They only help identify visible capabilities. AWJ implements equivalent behavior with the existing Next.js storefront and presentation contract.

## 6. Global visual language

### 6.1 Observed desktop baseline

| Property | Evidence |
|---|---|
| Direction/language | Arabic, `dir=rtl`, `lang=ar`. |
| Page background | Warm off-white measured as `rgb(244, 243, 241)` (`#F4F3F1`). |
| Base text | Muted gray measured as `rgb(118, 118, 118)` (`#767676`). |
| Base body typography | Custom `careem`, with Arial/Helvetica fallback; 14px / 400 on desktop. |
| Display/CTA typography | A second display face was observed on hero CTA (`zain mob`), 20px / 500. |
| Primary observed CTA | Sage green measured as `rgb(130, 149, 115)` (`#829573`), white label. |
| Promotional strip | Pale blush measured as `rgb(247, 223, 222)` (`#F7DFDE`). |
| CTA geometry | Hero CTA measured 12px × 24px padding, 3px radius. |
| Account action geometry | Login action measured 35px radius and pink fill (`rgb(229,114,126)`); treated as a component-specific reference, not a second global primary without further evidence. |
| Container | Main desktop content measured approximately 1222px inside a 1348px body, with ~63px outer margins and 15px inner side padding. |
| Motion | `fadeInUp`, `fadeInDown`, `slideInUp`, grow/shrink/pop/head-shake classes/assets are loaded; actual necessity and reduced-motion behavior remain to be audited. |

### 6.2 Preliminary AWJ token preset

These are **provisional design targets**, not a pixel-copy contract. They must pass contrast/accessibility review before locking.

```yaml
theme:
  id: boutique-floral-01
  mode: light
  direction: locale
colors:
  page: "#F4F3F1"
  surface: "#FFFFFF"
  text: "#2C2B29"          # AWJ decision: stronger than reference body gray for readability
  textMuted: "#767676"
  primary: "#829573"
  primaryForeground: "#FFFFFF"
  accentSoft: "#F7DFDE"
  border: "#E7E3DE"        # provisional
  sale: "#B74755"          # provisional semantic sale color
typography:
  body: merchant-selectable-arabic-sans
  display: merchant-selectable-arabic-display
shape:
  controlRadius: 4
  mediaRadius: 0
  editorialRadius: 40
layout:
  maxContentWidth: 1250
  desktopColumns: 5
```

Merchant-facing controls expose names such as **لون المتجر، لون الخلفية، الخط الأساسي، خط العناوين، استدارة الصور**. Technical token names remain internal, per `AWJ_STORE_CUSTOMIZER_UX_V2.md`.

## 7. Global header contract

### 7.1 Desktop — observed

The header is a two-row composition with a combined measured height of 154px:

1. **Utility/brand row — 104px**
   - centered/primary brand logo;
   - account action;
   - full-screen search action;
   - wishlist action;
   - cart action with count;
   - warm off-white background matching the page.
2. **Primary navigation row — 50px**
   - Home;
   - Products;
   - Blog;
   - About;
   - RTL ordering;
   - sticky-capable header classes and sticky-shadow capability.

### 7.2 Header variants required in AWJ

| Variant | Use |
|---|---|
| `floral-centered` | Theme default: logo-led, spacious desktop identity. |
| `floral-compact` | Sticky/scrolled state with reduced height. |
| `floral-mobile` | Mobile top bar with menu, logo and cart; exact reference behavior pending direct observation. |

### 7.3 Customizer controls

- logo/media and logo width by device;
- sticky on/off;
- announcement bar on/off, text, link, background/text colors, animation on/off;
- navigation links and ordering;
- show/hide account, search, wishlist and cart;
- cart display: icon only / count / count + subtotal where supported;
- transparent-over-hero is **not** part of the default until observed or selected as an AWJ extension.

### 7.4 Full-screen search — observed with gap

- opens as a full-width layer directly below the 154px header;
- measured approximately 1363 × 782px in the inspected viewport;
- search form occupies an approximately 111px-high top row;
- explicit close control;
- inspected placeholder is `Search for posts`, not product-specific Arabic copy;
- entering an Arabic flower query left the instructional message visible and exposed no result cards during the observation window.

**AWJ decision:** the ready theme must use storefront-product search by default, with localized copy and explicit loading, results, no-results and error states. The reference's apparent post-search mismatch/empty AJAX behavior is a defect to avoid, not a behavior to copy.

## 8. Home page template

### 8.1 Observed section sequence

The live page established this desktop flow. Approximate vertical positions are included to distinguish actual sequence from duplicated responsive/carousel markup:

1. Header — 0–154px.
2. Main content top padding — to ~194px.
3. Repeating announcement/marquee strip — ~194px, 48px measured height, blush background.
4. A large custom-gift hero/editorial section — ~242–999px — containing:
   - headline;
   - supporting headline/copy;
   - imagery;
   - green CTA;
   - large editorial rounded region (40px measured on one container).
5. Intermediate visual/editorial bands — ~1058–2277px — including a large multi-image block and a white benefits/trust band.
6. First product collection — ~2423–2860px — 20 product nodes in carousel markup.
7. Image-led promotional band — ~2920–3489px.
8. Full-width visual/editorial campaign — ~3548–4297px.
9. Second product collection — ~4443–4860px — includes the observed sale state with percentage badge, original and current prices.
10. Two further image-led promotional/editorial bands — ~4896–5886px.
11. Third product collection — ~6031–6468px — vase/arrangement-led products.
12. Promotional countdown — ~6469–7218px — days/hours/minutes/seconds.
13. Testimonials/reviews carousel — ~7466–7801px — avatar, name, five-star visual and long review copy.
14. Payment-method/logo carousel — ~7861–8106px.
15. Multi-column footer — ~8205–8673px.

The blank/duplicate nodes inside these ranges are implementation artifacts and must not become duplicate AWJ sections.

### 8.2 AWJ default home composition

```yaml
homepage:
  - announcementMarquee
  - heroEditorial
  - categoryTiles
  - featuredProducts
  - splitEditorial
  - bestSellers
  - promotionCountdown
  - themedCollection
  - testimonials
  - trustBenefits
  - paymentMethods
```

This is a theme preset. The merchant may reorder, duplicate, hide or delete eligible sections. Header and footer are global regions, not reorderable home sections.

### 8.3 Section contracts

#### Announcement marquee

- fields: message, optional link/CTA, start/end scheduling, colors;
- variants: static / marquee;
- accessibility: pause motion, reduced-motion fallback to static text;
- duplicated visual copies are rendering behavior, not duplicated merchant content.

#### Hero editorial

- desktop media ratio observed near 1363:585 (~2.33:1) for a main campaign image;
- alternate/mobile media slot required;
- fields: eyebrow, title, body, CTA label/link, desktop image, mobile image, focal point, overlay strength;
- variants: full-bleed / contained / split;
- fallback: legible text and CTA when media is absent.

#### Category tiles

- image-led categories;
- configurable source: manual selection / automatic published categories;
- card ratio and column count responsive;
- whole tile clickable, with title and optional count.

#### Product collection

- source: manual products / category / newest / featured / offers / best sellers when supported;
- layout: carousel or grid;
- fields: title, subtitle, CTA, item limit, card variant;
- must reuse the canonical commerce listing, price, inventory and publication contracts; theme configuration never stores product truth.

#### Split editorial

- two-part image/content composition;
- reversible image position;
- optional large radius (reference showed 40px on an editorial container);
- stacked mobile order must be configurable without producing separate content documents.

#### Promotion countdown

- title, copy, target time, CTA and media/background;
- values: days/hours/minutes/seconds;
- expiry behavior: hide / replace with expired copy / switch CTA;
- server-authoritative target timestamp; no commerce discount truth is created by the visual timer.

#### Testimonials

- card: avatar, customer name, rating visual, quote;
- carousel desktop/mobile behavior;
- merchant-entered testimonials must not be represented as verified purchase reviews unless backed by an AWJ review contract.

#### Payment methods

- logo list from allowed/licensed assets;
- decorative/supporting trust content only; must not claim an enabled payment method not present in checkout configuration.

## 9. Product card contract

### 9.1 Observed states and anatomy

- image-led, borderless/lightweight card on page background;
- desktop measured card width ~222px in a five-column row;
- title;
- one or more category links;
- price;
- Add to Cart action;
- sale label with percentage;
- original price plus current price;
- in-stock simple products;
- product image and full-card/product-title navigation;
- wishlist and compare affordances exist in the storefront ecosystem, but card placement/visibility needs direct interaction verification.

### 9.2 Required AWJ states

| State | Required rendering |
|---|---|
| Regular | Image, title, optional category, price, primary purchase action. |
| Sale | Discount label, accessible original/current price relationship. |
| Out of stock | Explicit text + disabled/alternate action; never color alone. |
| Multiple variants | “Choose options” rather than false direct add. |
| Unavailable image | Stable aspect-ratio placeholder. |
| Loading | Theme-aligned skeleton with no layout shift. |
| Error | Local retry/fallback without collapsing the whole collection. |
| Long title | Predictable line clamp and accessible full name. |
| RTL/LTR mixed name | `<bdi>` around merchant/catalog content. |

### 9.3 Customizer controls

- grid density and columns by breakpoint within safe bounds;
- image ratio/fitting/focal behavior;
- show/hide category, rating and quick action labels;
- add-to-cart style: text / filled / icon-supported;
- sale badge shape and position;
- card alignment and spacing;
- hover image/quick actions only when keyboard and touch equivalents exist.

## 10. Catalog/category template

### 10.1 Observed desktop anatomy

- global header/footer;
- filter surface with:
  - Categories;
  - Stock status;
  - Price range;
  - Filter action;
- category navigation list including balloons, natural flowers, party setup, bouquets, flower baskets and vases;
- ten product cards were rendered in the inspected state;
- AJAX-shop capability is present in the reference implementation.

### 10.2 AWJ contract

- title/breadcrumb area;
- result count;
- sort control;
- filter drawer/sidebar depending on viewport;
- active filter chips and clear-all;
- pagination or load-more chosen at product level, not hard-coded by theme;
- URL-addressable filters for share/back navigation;
- empty/no-results state with clear recovery action;
- loading/error states;
- no hidden inventory or unpublished listings may leak through filters.

**Gap:** the current custom “Products” page routed its filter form toward `/shop/` and showed an unusual leading `6` in one product title. AWJ should reproduce the visual capability, not reference-site content/routing defects.

## 11. Product-detail template

### 11.1 Observed anatomy

- breadcrumbs: Home → category → subcategory → product;
- back-to-products control;
- image/gallery area with click-to-enlarge;
- product title;
- price;
- quantity stepper (`-`, numeric value, `+`);
- Add to Cart;
- Add to Wishlist;
- SKU;
- linked categories;
- share actions;
- tab/accordion set: Description, Reviews, Shipping & Delivery;
- long rich-text product description with headings and lists;
- reviews area and, when no reviews exist, a review form with rating, text, name, email and cookie consent;
- related-products carousel/list;
- compare actions on related products.

### 11.2 AWJ requirements

- media gallery supports image count, thumbnails, zoom/lightbox, keyboard close and swipe;
- pricing uses canonical minor-unit values and currency formatting;
- quantity respects stock, minimum, maximum and step rules from commerce contracts;
- variants/options have explicit selection, validation and unavailable combinations;
- shipping/delivery content is merchant-configured but must not override checkout truth;
- reviews require a separate capability and moderation contract; until then the theme may design the surface but must gate submission/display honestly;
- share URLs use the resolved storefront domain and current locale;
- related products are tenant/storefront scoped and publication-safe.

### 11.3 Single-image gallery interaction — observed

The inspected simple product used one tall portrait image inside a zoom-enabled gallery. Activating `Click to enlarge` opened a modal/lightbox layer with:

- explicit Arabic Close control with `Esc` hint;
- Share control;
- Full-screen control;
- no previous/next controls in the single-image case.

Multi-image thumbnail, previous/next, swipe and image-counter behavior remains unobserved.

## 12. Cart and checkout surfaces

### 12.1 Empty cart — observed

- clear empty-cart headline;
- “new in store” recommendation area;
- four recommended products with image, name, price, rating when available and Add to Cart;
- global footer and navigation remain present.

### 12.2 Mini-cart — empty observed; filled pending

The header cart opens a side drawer without leaving the page. In the inspected empty state it exposed:

- approximately 340px drawer width across the full 936px viewport height;
- title `Shopping cart`;
- explicit Close action;
- Arabic empty message: no products in the cart;
- `Return To Shop` action;
- dimmed/overlay-style page relationship implied by the drawer shell.

The populated state was not exercised in this pass.

AWJ must eventually specify and verify:

- line image/name/variant/price;
- quantity editing and pending state;
- remove and undo/recovery behavior;
- subtotal, discounts and shipping/tax messaging;
- cart error/conflict/stock-change states;
- CTA hierarchy: continue shopping / view cart / checkout;
- guest → authenticated identity transition using AWJ's canonical merge policy;
- mobile bottom/sticky checkout action where appropriate.

### 12.3 Checkout boundary

A direct visit to `/checkout/` with an empty cart redirected to `/cart/` and reused the empty-cart recommendations surface. Populated checkout was **not observed** and is not approved for visual imitation yet. AWJ checkout must prioritize transaction clarity, address/delivery/payment correctness, validation and accessible error recovery over decorative parity with the reference.

## 13. Account, blog and content templates

### 13.1 Account login — observed

- centered login surface;
- username/email;
- password and reveal control;
- Log in;
- Remember me;
- Lost password;
- global footer.

The lost-password route was also observed: explanatory copy, username/email field and a Reset Password action inside the same global shell. The visible registration action/link did not expose a registration form in the inspected public state; `?action=register` returned the login form. Authenticated dashboard, orders, addresses and profile states were not observed.

### 13.2 Blog index — observed

- hero/title block;
- editorial intro heading and body;
- article card with title, excerpt, author, date, time and Read More;
- contact/inquiry form area;
- reference content currently includes placeholder WordPress copy. AWJ must use merchant content and never copy it.

### 13.3 About — observed with gap

The page loaded with the global shell and imagery but exposed little meaningful text in the inspected state. A visual screenshot pass is still required before locking its page template.

### 13.4 Required generic pages

- About;
- Contact;
- Blog index/article when blogging is enabled;
- Terms;
- Privacy;
- Returns/refunds;
- Shipping/delivery;
- FAQ/custom content page.

All page types must inherit theme header/footer, content typography, RTL/LTR handling and responsive spacing.

## 14. Footer contract

### 14.1 Observed

- multi-column footer, measured ~468px high on the inspected desktop page;
- about/store description;
- contact area;
- categories;
- quick links;
- About link;
- social icon area;
- payment/supporting brand imagery;
- policy links surfaced in a footer navigation structure, including returns, terms and privacy/use policy;
- the live about copy discusses unrelated household-cleaning benefits, likely placeholder content. It is not part of the theme.

### 14.2 AWJ controls

- merchant description;
- contact channels;
- social links using existing safe URL rules;
- menu columns and titles;
- newsletter block only when backend capability exists;
- payment logos driven by enabled integrations where possible;
- copyright;
- policy links;
- column collapse/accordion behavior on mobile.

## 15. Responsive contract

### 15.1 Confirmed principles

- one responsive theme document, not separate desktop/mobile themes;
- desktop currently renders five product columns at ~1363px;
- mobile navigation, mobile cart and sticky bottom-toolbar capabilities are present in the reference assets/markup;
- the reference includes responsive carousel and dropdown modules.

### 15.2 AWJ target matrix — pending visual validation

| Width | Target behavior |
|---|---|
| ≥1280 | 5 product columns; full two-row header; wide editorial layouts. |
| 1024–1279 | 4 columns; reduced gutters; header compaction as needed. |
| 768–1023 | 3 columns; drawer filters; touch-safe carousel controls. |
| 430–767 | 2 columns; mobile header; stacked editorials; bottom-sheet/drawer overlays. |
| 320–429 | 2 compact columns or 1 where content requires; no horizontal page overflow. |

This table is an **AWJ provisional decision**, not a claim of reference-site exact breakpoints. It must be validated at 390, 430, 768, 1024, 1280 and 1440 before lock.

## 16. Mandatory state-by-state completion checklist

### Global

- [x] Desktop header default.
- [ ] Header sticky/scrolled visual state.
- [ ] Mobile header closed/open/submenu.
- [x] Search closed/open/query-entry/close behavior.
- [ ] Search loading/results/no-results/error.
- [ ] Account hover/dropdown versus click behavior.
- [ ] Wishlist empty/populated/remove.
- [x] Mini-cart empty/open/close behavior.
- [ ] Mini-cart populated/loading/error.
- [ ] Cookie/announcement dismissal if part of the intended theme.
- [ ] Focus-visible and reduced-motion audit.

### Home

- [x] Desktop section-family inventory.
- [x] Desktop ordering and section boundaries from live layout geometry.
- [ ] Full-page screenshot review for pixel-level composition and hidden visual details.
- [ ] Tablet layout.
- [ ] Mobile layout.
- [ ] Carousel arrows/dots/swipe/autoplay/pause behavior.
- [ ] Countdown expiry.
- [ ] Empty collection and partial-media behavior.

### Catalog

- [x] Default desktop catalog/filter anatomy.
- [ ] Sort options and selected state.
- [ ] Active filter chips/clear.
- [ ] Pagination/load-more behavior.
- [ ] No results/loading/error.
- [ ] Mobile filter drawer.
- [ ] Sale/out-of-stock/variant card states.

### Product

- [x] Simple product desktop anatomy.
- [x] Reviews-zero form anatomy.
- [x] One-review display confirmed by public search evidence.
- [x] Single-image lightbox open/close/share/full-screen controls.
- [ ] Multi-image thumbnails/previous/next/counter/swipe interactions.
- [ ] Variable product/options.
- [ ] Out-of-stock and invalid quantity.
- [ ] Add-to-cart success/error.
- [ ] Mobile sticky purchase region if any.

### Cart/checkout/account

- [x] Empty cart and recommendations.
- [x] Guest login form.
- [x] Lost-password form.
- [x] Empty-cart checkout redirect boundary.
- [ ] Filled cart.
- [ ] Coupon/discount behavior.
- [ ] Checkout steps and validation.
- [ ] Order success/failure.
- [ ] Registration availability/form and authenticated account/orders.

### Content/footer

- [x] Blog index anatomy.
- [x] Footer information architecture.
- [ ] Article detail.
- [ ] About visual/content anatomy.
- [ ] Contact and policy pages.
- [ ] Mobile footer accordions.

## 17. Theme-engine capability mapping

| Theme need | Current AWJ direction | Required action |
|---|---|---|
| Internal theme tokens | Existing `--store-*` / `presentationCssVars` | Add a preset without exposing technical names. |
| Draft/Preview/Publish | Locked Customizer lifecycle | Reuse; no theme-specific persistence path. |
| Structured home sections | Existing visibility/order seed | Extend section registry for missing section types. |
| Click-to-edit | Approved UX V2 | Theme sections must register selectable regions and inspector schema. |
| Device preview | Approved UX V2 | Validate theme at canonical widths. |
| Product data | Existing storefront APIs | Theme reads only; never duplicates commerce truth. |
| Reviews | Capability-dependent | Gate until review backend/moderation contract exists. |
| Blog | Capability-dependent | Design-first allowed; production activation gated. |
| Wishlist/compare | Capability-dependent | Do not show fake actions when runtime capability is absent. |
| Media | Tenant-scoped media direction | Never embed reference assets; enforce safe formats/limits. |
| Multiple themes | New library requirement | Add theme metadata, preview assets, compatibility/version fields and apply flow in a separate architecture slice. |

## 18. Proposed theme manifest — draft

```json
{
  "id": "boutique-floral-01",
  "version": 1,
  "name": { "ar": "بوتيك الزهور", "en": "Boutique Floral" },
  "category": ["flowers", "gifts", "beauty", "boutique"],
  "directionSupport": ["rtl", "ltr"],
  "status": "designing",
  "presentationSchemaVersion": 1,
  "requiredCapabilities": ["catalog", "cart"],
  "optionalCapabilities": ["reviews", "wishlist", "compare", "blog"],
  "preset": {
    "tokens": "boutiqueFloral01",
    "header": "floral-centered",
    "productCard": "floral-editorial",
    "footer": "floral-multicolumn",
    "homepage": "floral-story-commerce"
  }
}
```

Manifest field names are a proposal only; they must not be implemented before inspecting the current presentation schema and defining backward-compatible theme apply/switch semantics.

## 19. Theme switching invariants — AWJ decision gate

Before implementation, AWJ must lock:

1. whether applying a theme replaces the draft only or creates a recoverable pre-apply revision;
2. which merchant edits survive switching themes;
3. mapping rules for supported sections and safe handling of unsupported sections;
4. whether theme updates affect already-customized stores automatically, opt-in, or only new applications;
5. preservation of published storefront until explicit Publish;
6. fail-closed behavior for unknown theme/version/component variants;
7. tenant isolation and cache invalidation;
8. preview thumbnail/version licensing and provenance.

No implementation task should silently decide these rules.

## 20. Acceptance criteria for “complete theme extraction”

The extraction is complete only when:

- every row in §16 is resolved;
- Desktop, Tablet and Mobile layouts are visually specified;
- page templates cover Home, Catalog, Product, Cart, Checkout, Account and generic content pages;
- every reusable component has default, interactive, empty, loading, error and disabled/unavailable states where applicable;
- tokens include color, type, spacing, container, media ratio, shape, elevation, motion and focus behavior;
- Customizer controls are defined in merchant language with safe bounds;
- every unavailable AWJ capability is marked gated rather than simulated;
- accessibility and RTL/LTR behavior are explicit;
- original AWJ assets/components replace all reference IP;
- theme apply/switch/update semantics are architecturally locked;
- an implementation agent can build the theme without repeatedly reopening the reference to discover omitted controls or states.

## 21. Current conclusion

The reference is suitable as the first AWJ ready-made boutique/floral theme because it combines editorial gifting content with dense commerce coverage: campaign hero, custom-gift story, multiple catalog collections, promotion/countdown, testimonials, product discovery and a full product-detail path.

The current pass is sufficient to open the documentation track and lock the theme anatomy. It is **not yet sufficient to claim a complete extraction**: mobile/tablet behavior, populated commerce states, search/wishlist/compare overlays and several error/empty/interactive states remain explicitly open in §16.

No application code, database schema, API contract, merge or deployment is authorized by this document.
