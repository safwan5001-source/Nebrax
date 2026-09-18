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

### 5.2 Category imagery — **DEFERRED**

`store/v1/categories` exposes `color` and no image. The 350px cover band that
reserved space for one was removed in STORE-UI-3 rather than filled with a
placeholder or stock photography. Closing this needs an image column on the
category resource and a media route; until then the restrained header stands.

### 5.3 Related / recommended products — **DEFERRED**

No authoritative relationship exists, and arbitrary catalogue ordering is not a
recommendation. Nothing is rendered. Closing this needs either a stored
relationship or a semantic query with defined meaning.

### 5.4 Ratings and reviews — **DEFERRED**

No contract, nothing rendered anywhere.

### 5.5 Coupons, promotions and compare-at pricing — **DEFERRED**

`original_price` is hard-`null` and `compare_at` is never populated, so the sale
badge and strikethrough are structurally unreachable. The branches remain in
`ProductCard` and the product detail page, gated on real API values, so they
light up if such a price is ever sent. Nothing presents a discount today.

### 5.6 Shipping, delivery and payment presentation — **DEFERRED**

No delivery promise, shipping estimate, guarantee or payment mark is shown. All
would be commercial claims the platform has not made.

### 5.7 Product comparison — **DEFERRED**

Not designed, not built.

## 6. Applying this to future slices

A slice that meets a missing capability does not stop. It:

1. completes the intended `DESIGN_ONLY` / `GATED` UI where doing so is safe,
2. records the gap here with all five items from §4,
3. continues,
4. lists the gap in its implementation report for later closure.

It stops only where continuing would damage security or data integrity — which
§3 defines.
