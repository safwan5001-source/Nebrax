# AWJ Storefront — Design-First Capability Policy

**Status:** active · **Owner decision** recorded during STORE-UI-3 (PR #860).

---

## 1. The decision

> **Missing backend capability does not block storefront design completion.
> It blocks production activation.**

AWJ has no real external storefront users yet. Stopping the storefront's design
each time a backend contract is absent would fragment the design across many
slices and force already-approved surfaces — `ProductCard`, the product detail
page — to be reopened and redesigned every time a capability later lands.

So the coherent storefront design is finished first, and backend gaps are closed
afterwards in dedicated tasks, against UI that is already agreed.

## 2. The four states

Every storefront capability is in exactly one of these.

| State | Meaning |
|---|---|
| **LIVE** | A real backend contract exists and the interaction works end to end. |
| **DESIGN_ONLY** | The intended final UX is built now for visual completeness. No authoritative contract backs it. It persists nothing and asserts nothing. |
| **GATED** | Designed and built, but withheld from production until its contract lands. |
| **DEFERRED** | Documented as future work. Nothing is built. |

`DESIGN_ONLY` and `GATED` overlap in practice: a capability designed without a
backend is both — built for review, not for production.

## 3. What design-first never licenses

Design-first is permission to draw the intended UX early. It is **not**
permission to manufacture truth. None of the following is ever acceptable,
whatever state a capability is in:

- inventing a backend API, endpoint or response shape;
- adding a migration or changing schema to make a design work;
- fabricating a financial or commercial fact — a price, a discount, a stock
  figure, a delivery date, a rating, a guarantee;
- creating fake authoritative persistence;
- **substituting `localStorage`, `sessionStorage` or a cookie for real business
  persistence.** Browser storage that survives a reload reads to a shopper as an
  account-level promise the platform has not made;
- weakening tenant isolation, or widening what a surface can reach;
- reporting success for a mutation the server refused.

A `DESIGN_ONLY` control must be honest about being inert. It may hold state for
the life of the page so the states can be reviewed; it must not imply that the
state was recorded anywhere.

## 4. What every designed-but-unbacked capability must record

For each one, this document (or the slice's implementation report) states:

1. the intended UX,
2. the component and the surfaces it appears on,
3. its current capability state,
4. **the exact missing backend contract**, precisely enough to build from,
5. what activation will require.

The point of (4) is that gap closure later is a backend task with a known
target, not a rediscovery exercise.

## 5. Register

### 5.1 Wishlist / favourites — **DESIGN_ONLY / GATED**

| | |
|---|---|
| **Intended UX** | A restrained heart. On `ProductCard` it sits over the image; on the product detail page beside the product name. States: default (outline), selected (filled, primary), hover, focus-visible, pending (dimmed, non-interactive), error (reverts the flip). Accessible names: "إضافة إلى المفضلة" / "إزالة من المفضلة", "Add to favorites" / "Remove from favorites", with `aria-pressed`. |
| **Component / surfaces** | `components/products/WishlistButton.tsx`, routed through `contexts/WishlistContext.tsx`. Appears on the homepage, `/products`, category results, search results and product detail — one component, not a per-page design. |
| **State** | `DESIGN_ONLY`. Declared in `lib/commerce/capabilities.ts` as `WISHLIST_CAPABILITY`. |
| **Missing backend contract** | `GET store/v1/wishlist` → the shopper's saved products · `POST store/v1/wishlist/items` `{ product_id }` · `DELETE store/v1/wishlist/items/{product}`. Plus **an identity to hang it on**: the storefront's cart identity is an anonymous cookie token, and a favourites list that outlives a cart needs an account. That identity decision is the substantive part of this gap, not the three routes. |
| **Activation requirement** | Implement the routes and the identity, then change `WISHLIST_CAPABILITY` to `"live"` and point `WishlistProvider.toggle` at the real mutation. **No consuming component changes** — that is what the seam buys. |
| **Current behaviour** | Favourites live in React state for the life of the page and are persisted nowhere, deliberately including no browser storage. A reload clears them. |

### 5.2 Payment — **DESIGN_ONLY / GATED** (STORE-UI-4)

| | |
|---|---|
| **Intended UX** | Stage 4 of the checkout. A titled stage carrying a clear "online payment is not enabled for this store yet" state, then the *shape* of the choice — card, bank transfer, cash on delivery — each dashed, dimmed and badged "not enabled", none selectable. No provider name, no brand mark, no card field anywhere. Continuing advances the flow and calls nothing. |
| **Component / surfaces** | `components/checkout/awj/PaymentStage.tsx`, rendered by `AwjCheckoutFlow` between delivery and review; echoed as a read-only row on the review stage. |
| **State** | `DESIGN_ONLY`. Declared as `PAYMENT_CAPABILITY` in `lib/commerce/capabilities.ts`. |
| **Missing backend contract** | `GET store/v1/checkout/payment-methods` → the methods **this storefront** enabled · `POST store/v1/checkout/payment-intent` `{ method }` → a provider-side intent (client secret or redirect URL; card data never passes through AWJ) · `POST store/v1/checkout/complete` must then **require** a settled or authorised intent instead of confirming on its own · plus a server-verified provider webhook receiver, processed idempotently inside a trusted tenant context. ADR-04 fixes the boundary (`Commerce Order → Payment Intent → Provider Attempt → AWJ Payment → Invoice`) and is recorded as *Accepted — Architecture Direction, no implementation approval*. |
| **Activation requirement** | Implement the routes and the webhook receiver, then flip `PAYMENT_CAPABILITY` to `"live"` and replace the stage's inert body with the provider's own element. The stage, the progress ladder and the review row do not move. |
| **Current behaviour** | Renders and advances. Submits nothing, stores nothing, charges nothing. The confirmation states that the order is a commercial commitment and that no payment was taken. |

### 5.3 Coupons and promotion codes — **DESIGN_ONLY / GATED** (STORE-UI-4)

| | |
|---|---|
| **Intended UX** | A labelled code field with an Apply button in the cart summary and the cart drawer. Submitting a code answers with the capability message; the code is never reported as accepted, no discount row appears, and no displayed amount changes. |
| **Component / surfaces** | `components/cart/CouponField.tsx`, inside `CartSummary` on the cart page and in the drawer footer. Hidden on the checkout summary, where the cart is read-only. |
| **State** | `DESIGN_ONLY`. Declared as `COUPON_CAPABILITY`. |
| **Missing backend contract** | `POST store/v1/cart/coupon` `{ code }` → the re-serialized cart · `DELETE store/v1/cart/coupon` → the re-serialized cart. Structurally larger than the two routes: `CommerceCartService::serialize()` must grow a server-computed `discount` **and** `total` beside `subtotal`, because a discount the storefront derived from a subtotal would be a client-authoritative monetary calculation. |
| **Activation requirement** | Implement both routes and the two new cart figures, then flip `COUPON_CAPABILITY` and replace `handleSubmit`'s body with the real mutation. `CartSummary` gains a discount row and a total row; no other layout moves. |
| **Current behaviour** | Holds the typed code in component state for the life of the page. No cookie, no `localStorage` — asserted by a test. |

*(§5.5 below records the separate, still-`DEFERRED` case of sale/compare-at pricing on the catalogue, which has no API field at all.)*

### 5.4 Category imagery — **DEFERRED**

`store/v1/categories` exposes `color` and no image. The 350px cover band that
reserved space for one was removed in STORE-UI-3 rather than filled with a
placeholder or stock photography. Closing this needs an image column on the
category resource and a media route; until then the restrained header stands.

### 5.5 Related / recommended products — **DEFERRED**

No authoritative relationship exists, and arbitrary catalogue ordering is not a
recommendation. Nothing is rendered. Closing this needs either a stored
relationship or a semantic query with defined meaning.

### 5.6 Ratings and reviews — **DEFERRED**

No contract, nothing rendered anywhere.

### 5.7 Compare-at / sale pricing on the catalogue — **DEFERRED**

`original_price` is hard-`null` and `compare_at` is never populated, so the sale
badge and strikethrough are structurally unreachable. The branches remain in
`ProductCard` and the product detail page, gated on real API values, so they
light up if such a price is ever sent. Nothing presents a discount today.

### 5.8 Shipping and delivery pricing — **DESIGN_ONLY** (method live, amount unpriced)

No delivery promise, shipping estimate, guarantee or payment mark is shown
anywhere in the storefront. All would be commercial claims the platform has not
made.

STORE-UI-4 refined this for the checkout, where a delivery *method* is real. The
two methods in `CommerceCheckoutService::DELIVERY_METHODS` (`pickup`,
`standard`) are chosen by the shopper, stored on the checkout and carried onto
the order — that part is **LIVE**. The *amount* is not: `updateDelivery()` writes
`delivery_amount_minor => 0` unconditionally and the controller accepts no
amount from the client, so the storefront shows the methods with no price, no
estimate and no date, and never presents the server's zero as "free delivery".
Declared as `DELIVERY_PRICING_CAPABILITY`.

**Missing backend contract:** a shipping pricing authority — a rate source, a
zone/region model and a per-method quote — that `updateDelivery()` can consult,
so `delivery.amount` becomes a real figure and the order total becomes
subtotal + delivery rather than subtotal alone.

**Tax is separate and fully `DEFERRED`** (`TAX_PRESENTATION_CAPABILITY`): no tax
field exists on the cart, the checkout or the order, and whether storefront
prices are VAT-inclusive is a tenant policy this API does not state. No tax row
is rendered — a zero would be a monetary assertion with no source.

### 5.9 Product comparison — **DEFERRED**

Not designed, not built.

### 5.10 Account order history — **DESIGN_ONLY / GATED** (STORE-UI-5)

| | |
|---|---|
| **Intended UX** | A professional order-history list: number, date, authoritative status, authoritative total, item count. Cards on a phone, the same rows on a desktop — not a squeezed table. Empty state with one action (start shopping). |
| **Component / surfaces** | `components/account/AccountOrderList.tsx` on `/account/orders` and the account overview entry. |
| **State** | `DESIGN_ONLY`. Declared as `ACCOUNT_ORDER_HISTORY_CAPABILITY`. |
| **Missing backend contract** | `GET store/v1/account/orders` → the shopper's `CommerceOrder`s in the `serializeOrder()` shape. Plus an identity to hang them on: checkout today writes `customer_identity_id` as null because the cart is an anonymous cookie. |
| **Activation requirement** | Implement the list route on a customer identity, flip the capability, pass the mapped `StorefrontOrder[]` into `AccountOrderList`. The leftover Spree `customer.orders.list` path is a different backend and must not be wired in. |
| **Current behaviour** | Empty list plus the honest capability notice. No fabricated orders, no Spree payment/fulfilment badges. |

### 5.11 Account order detail / lookup — **DESIGN_ONLY / GATED** (STORE-UI-5)

| | |
|---|---|
| **Intended UX** | A complete order detail: number, date, `confirmed` status, line items (via `CartLine`), authoritative total, contact, delivery address/method, and a status presentation. Never titled Invoice. No download invoice/receipt. |
| **Component / surfaces** | `components/account/AccountOrderDetail.tsx` on `/account/orders/[id]`. |
| **State** | `DESIGN_ONLY`. Declared as `ACCOUNT_ORDER_LOOKUP_CAPABILITY`. |
| **Missing backend contract** | `GET store/v1/account/orders/{id}` → one `CommerceOrder` in the `serializeOrder()` shape, scoped to the customer (or a signed guest lookup). |
| **Activation requirement** | Implement the lookup, flip the capability, render `AccountOrderDetail` with the mapped order. |
| **Current behaviour** | The route states that past orders cannot be looked up yet. The designed component is covered by tests and the development preview. |

### 5.12 Account order status timeline — **DESIGN_ONLY / GATED** (STORE-UI-5)

| | |
|---|---|
| **Intended UX** | Four steps: placed / preparing / on the way / delivered. Only **placed** may light up, and only when the authoritative status is `confirmed`. Later steps stay labelled "not tracked". |
| **Component / surfaces** | `components/account/AccountOrderStatus.tsx`, inside order detail. |
| **State** | `DESIGN_ONLY`. Declared as `ACCOUNT_ORDER_STATUS_CAPABILITY`. |
| **Missing backend contract** | A fulfilment lifecycle on `CommerceOrder` (and a storefront serializer for it) before any step past "placed" may light up. |
| **Activation requirement** | Flip the capability once those statuses are authoritative. |
| **Current behaviour** | A confirmed order is marked placed. Nothing is claimed as shipped or delivered. |

### 5.13 Saved addresses — **DESIGN_ONLY / GATED** (STORE-UI-5)

| | |
|---|---|
| **Intended UX** | Address list, card, add, edit, remove, default badge. |
| **Component / surfaces** | `components/account/AccountAddresses.tsx` on `/account/addresses`. |
| **State** | `DESIGN_ONLY`. Declared as `ACCOUNT_ADDRESSES_CAPABILITY`. |
| **Missing backend contract** | `GET/POST/PATCH/DELETE store/v1/account/addresses`, hanging on the same customer identity as the order list. Checkout must later be taught to offer a saved address — that is a later slice. |
| **Activation requirement** | Implement the book, flip the capability, replace `refuse()` with the real mutation. |
| **Current behaviour** | Empty book, dashed card shape, add/edit/remove answer with the capability message. No browser storage. The leftover Spree address CRUD is not called. |

### 5.14 Saved payment methods — **DESIGN_ONLY / GATED** (STORE-UI-5)

| | |
|---|---|
| **Intended UX** | Empty state, saved-method card shape, add, remove. No provider name, no brand mark, no card field. |
| **Component / surfaces** | `components/account/AccountPaymentMethods.tsx` on `/account/payment-methods`. |
| **State** | `DESIGN_ONLY`. Declared as `ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY`. |
| **Missing backend contract** | `GET/DELETE store/v1/account/payment-methods`. Creating a method is a provider-hosted element; card data never passes through AWJ. |
| **Activation requirement** | Implement the routes, flip the capability, replace the inert body with the provider's element. |
| **Current behaviour** | Empty + dashed shapes. Add/remove report no success. No `localStorage`. |

### 5.15 Account wishlist page — **DESIGN_ONLY / GATED** (STORE-UI-5)

Same contract as §5.1. STORE-UI-5 added the account-side surface (`/account/wishlist`, `AccountWishlist`) on the existing `WishlistContext`. Favourites remain page-lifetime only.

### 5.16 Theme persistence — **DESIGN_ONLY / GATED** (STORE-UI-6)

| | |
|---|---|
| **Intended UX** | Preset, primary colour, density, radius and product-card treatment applied to a live storefront preview. |
| **Component / surfaces** | `storefront/src/components/customizer/ExperienceBuilder.tsx`, `/commerce/appearance`. |
| **State** | `DESIGN_ONLY`. `THEME_PERSISTENCE_CAPABILITY`. |
| **Missing backend contract** | `GET/PUT /api/commerce/workspace/storefronts/{id}/presentation` (Sanctum, `SetTenant`, `commerce.manage`, foreign id → 404) plus published tokens on `GET store/v1/storefront`. Presentation-only body. No product/category master data. |
| **Activation requirement** | Persist the closed token set, then flip the capability. Preview already consumes `--store-*`. |
| **Current behaviour** | Page-lifetime draft. Save reports that nothing was stored. |

### 5.17 Merchant branding persistence — **DESIGN_ONLY / GATED** (STORE-UI-6)

| | |
|---|---|
| **Intended UX** | Logo, compact logo, favicon, display-name override. Typographic fallback when no logo. Never AWJ corporate branding. |
| **Component / surfaces** | `StoreBrand` logo slot; Branding panel. |
| **State** | `DESIGN_ONLY`. `BRANDING_PERSISTENCE_CAPABILITY`. |
| **Missing backend contract** | Tenant-scoped branding media, not ERP `company.logo` and not product `store/v1/media/{id}`. |
| **Activation requirement** | Upload + public URL on the presentation payload. |
| **Current behaviour** | File is read as a data URL for this page only. Not uploaded. |

### 5.18 Homepage composition — **DESIGN_ONLY / GATED** (STORE-UI-6)

| | |
|---|---|
| **Intended UX** | Visibility, order, hero copy, gated placeholders for banner/featured/offers/benefits/app/custom. |
| **Component / surfaces** | Homepage panel; `resolveHomeSections()` remains the public seam. |
| **State** | `DESIGN_ONLY`. `HOMEPAGE_COMPOSITION_CAPABILITY`. |
| **Missing backend contract** | `sections: [{ key, visible }]` on presentation, constrained to implemented keys for the public storefront. Featured product/category **ids** must resolve as tenant-owned + published. |
| **Activation requirement** | Pass published sections into `resolveHomeSections(configured)`. |
| **Current behaviour** | Public homepage still uses defaults. Preview applies the draft. |

### 5.19 Custom navigation links — **DESIGN_ONLY** (STORE-UI-6)

Missing: validated link list on presentation. External hrefs https-only.

### 5.20 Footer configuration — **DESIGN_ONLY** (STORE-UI-6)

Missing: tagline, copyright, optional contact/social/app columns on presentation.

### 5.21 Contact information — **DESIGN_ONLY** (STORE-UI-6)

Missing: storefront contact fields. ERP company phone is not this contract.

### 5.22 WhatsApp — **DESIGN_ONLY** (STORE-UI-6)

| | |
|---|---|
| **Intended UX** | Enable, E.164 number, opening message, floating and/or footer placement. |
| **State** | `DESIGN_ONLY`. `WHATSAPP_CAPABILITY`. |
| **Missing backend contract** | `whatsapp: { enabled, phone, message, placement }` on presentation. |
| **Current behaviour** | Preview-only `wa.me` link. No send. Public storefront does not mount the control without published config. |

### 5.23 Social links — **DESIGN_ONLY** (STORE-UI-6)

Missing: https-only social list on presentation. Spree `STORE_*` env is not an AWJ contract.

### 5.24 Business verification — **GATED** (STORE-UI-6)

| | |
|---|---|
| **Intended UX** | Merchant-provided CR/license/source URL, strictly separated from AWJ verified state. |
| **State** | `GATED`. `BUSINESS_VERIFICATION_CAPABILITY`. |
| **Missing backend contract** | An AWJ-or-external verified status. Merchant-typed numbers/URLs must never produce a Verified badge. |
| **Current behaviour** | Preview always shows “Not verified”. The requested-badge toggle is stored on the draft and ignored by the renderer. |

### 5.25 Mobile app links — **DESIGN_ONLY** (STORE-UI-6)

Missing: App Store / Play URLs on presentation. Public app section must stay absent when URLs are missing.

### 5.26 Informational pages — **GATED** (STORE-UI-6)

Missing: `GET/PUT` pages CMS. Spree `policies.get` is not AWJ. Designed entry points only.

### 5.27 Draft persistence — **DESIGN_ONLY** (STORE-UI-6)

Missing: draft revision row. Save is inert. No `localStorage`.

### 5.28 Customizer preview session — **DESIGN_ONLY** (STORE-UI-6)

Missing: preview token / unpublished-theme public route. The in-workspace canvas is the designed preview.

### 5.29 Publish — **GATED** (STORE-UI-6)

Missing: authoritative publish that copies a draft to the live presentation without changing the storefront on save. Publish never reports success.

### 5.30 Version history / restore — **DEFERRED** (STORE-UI-6)

Nothing built. Restore-default in the editor is page-lifetime draft reset only.

## 6. Applying this to future slices

A slice that meets a missing capability does not stop. It:

1. completes the intended `DESIGN_ONLY` / `GATED` UI where doing so is safe,
2. records the gap here with all five items from §4,
3. continues,
4. lists the gap in its implementation report for later closure.

It stops only where continuing would damage security or data integrity — which
§3 defines.
