/**
 * Storefront capability states.
 *
 * AWJ has no live external storefront users yet, so a missing backend
 * capability must not fragment the storefront's design. The owner's decision
 * (recorded in `docs/plans/store/AWJ_STOREFRONT_DESIGN_FIRST_POLICY.md`) is:
 *
 *   Missing backend capability does not block storefront design completion.
 *   It blocks production activation.
 *
 * A capability declared here states which of those two situations it is in, so
 * the UI can be built once and switched on later without being redesigned.
 */
export type CapabilityState =
  /** Real backend exists and the interaction works end to end. */
  | "live"
  /**
   * The intended UX is built for visual completeness, but no authoritative
   * contract backs it. It must never persist anything, never assert a
   * commercial fact, and never claim success it cannot deliver.
   */
  | "design_only"
  /** Designed and built, withheld from production until its contract lands. */
  | "gated"
  /** Documented as future work; nothing is built. */
  | "deferred";

/**
 * Wishlist / favourites.
 *
 * `design_only`: there is no wishlist endpoint anywhere in `store/v1` and no
 * adapter in this repository — verified, not assumed. The affordance exists so
 * that `ProductCard` and the product detail page do not have to be redesigned
 * when the contract lands, and it keeps its state in memory for the length of
 * the page only.
 *
 * It deliberately does NOT fall back to `localStorage` or a cookie. A favourite
 * that survives a reload would look like an account-level promise the platform
 * has not made, and the owner's policy forbids substituting browser storage for
 * real business persistence.
 *
 * Missing backend contract, for later gap closure:
 *   GET    store/v1/wishlist                 → the shopper's saved products
 *   POST   store/v1/wishlist/items           → { product_id }
 *   DELETE store/v1/wishlist/items/{product} → remove
 * plus an identity to hang it on, since the storefront's cart identity is an
 * anonymous cookie token and a favourites list outliving a cart needs an
 * account.
 */
export const WISHLIST_CAPABILITY = "design_only" as CapabilityState;

/**
 * Coupons, promotions and discount codes.
 *
 * `design_only`: verified absent, not assumed. `CommerceCartService::serialize()`
 * returns `{status, items, subtotal, currency, has_unavailable_items}` — there is
 * no discount field, no promotion field and no total. `routes/api_storefront.php`
 * exposes three cart routes (`GET cart`, `POST cart/items`,
 * `PATCH/DELETE cart/items/{item}`) and five checkout routes; none of them
 * accepts a code. `StorefrontCheckoutController` rejects unknown request keys
 * outright (`rejectUnknown()`), so a code could not even be smuggled through an
 * existing endpoint.
 *
 * The field is built so the cart and checkout summary do not have to be
 * redesigned when promotions land. Submitting it never reports a discount,
 * never alters a displayed amount, and never claims the code was stored. It
 * answers with the honest capability message and nothing else.
 *
 * Missing backend contract, for later gap closure:
 *   POST   store/v1/cart/coupon    → { code }        → the re-serialized cart
 *   DELETE store/v1/cart/coupon                      → the re-serialized cart
 * and, structurally larger than the two routes: the cart serializer must grow a
 * server-computed `discount` and `total` alongside `subtotal`, since a discount
 * that the storefront derives from a subtotal would be a client-authoritative
 * monetary calculation.
 */
export const COUPON_CAPABILITY = "design_only" as CapabilityState;

/**
 * Online payment.
 *
 * `design_only`: there is no payment route in `routes/api_storefront.php`, no
 * `PaymentIntent` model in `app/Models`, and `CommerceCheckoutService::complete()`
 * creates a `CommerceOrder` with `status = confirmed` and no payment of any kind.
 * ADR-04 ("Payment Intent / Authorization / Capture / Refund") is recorded as
 * **Accepted — Architecture Direction ... no implementation approval**, so the
 * boundary is agreed and the implementation does not exist.
 *
 * The checkout therefore carries a payment stage that is designed and visibly
 * inert. It names no provider, shows no brand mark, and offers no method the
 * store has not enabled — per the design-first policy §5.6, a payment mark is a
 * commercial claim the platform has not made. Placing the order states plainly
 * that it is a commercial commitment and that no payment has been taken.
 *
 * Missing backend contract, for later gap closure:
 *   GET  store/v1/checkout/payment-methods → the methods THIS storefront enabled
 *   POST store/v1/checkout/payment-intent  → { method } → a provider-side intent
 *                                            (client secret / redirect URL),
 *                                            never card data through AWJ
 *   POST store/v1/checkout/complete        → must then require a settled or
 *                                            authorised intent rather than
 *                                            confirming on its own
 * plus a server-verified provider webhook receiver, processed idempotently
 * inside a trusted tenant context (ADR-04 §1).
 */
export const PAYMENT_CAPABILITY = "design_only" as CapabilityState;

/**
 * Shipping/delivery pricing.
 *
 * `design_only` for presentation, with a live method choice underneath.
 * `CommerceCheckoutService::DELIVERY_METHODS` is the fixed list `['pickup',
 * 'standard']` and `updateDelivery()` writes `'delivery_amount_minor' => 0`
 * unconditionally — the method a shopper picks is real and is stored; the amount
 * is a server-forced zero because no shipping pricing authority exists. The
 * controller does not accept an amount from the client at all.
 *
 * So the storefront shows the two real methods and shows no price, no estimate
 * and no delivery date for either. It never presents the zero as "free
 * delivery": that would be a commercial claim, and the amount is a placeholder,
 * not a quote.
 *
 * Missing backend contract, for later gap closure: a shipping pricing authority
 * (rate source, zone/region model, per-method quote) that `updateDelivery()` can
 * consult, so `delivery.amount` becomes a real server-computed figure and the
 * checkout total becomes subtotal + delivery rather than subtotal alone.
 */
export const DELIVERY_PRICING_CAPABILITY = "design_only" as CapabilityState;

/**
 * Tax presentation in cart and checkout.
 *
 * `deferred`: nothing is built. Neither the cart serializer nor
 * `StorefrontCheckoutController::serializeOrder()` carries a tax field, and
 * `CommerceOrderService::createFromCheckout()` sets the order total to the plain
 * sum of `line_total`. Whether storefront prices are VAT-inclusive is a tenant
 * policy this API does not state, so any tax line the storefront drew — even a
 * zero — would be a monetary assertion it cannot source. No tax row is rendered
 * anywhere in this slice.
 */
export const TAX_PRESENTATION_CAPABILITY = "deferred" as CapabilityState;

/**
 * Account order history.
 *
 * `design_only`: `store/v1` is an anonymous catalog/cart/checkout API
 * (`routes/api_storefront.php`). Completing checkout returns one
 * `CommerceOrder` in-session via `POST store/v1/checkout/complete`; there is
 * no `GET store/v1/account/orders` (or any customer order-list route) to read
 * that order back later. The leftover Spree `customer.orders.list` path is a
 * different commerce backend and must not be presented as AWJ order history —
 * its `payment_status` / `fulfillment_status` vocabulary does not exist on
 * `CommerceOrder` (`draft` | `confirmed` only).
 *
 * The history surface is designed so the account does not have to be
 * reopened when the contract lands. It never fabricates an order, a total,
 * a payment state or a shipment state, and it never reads Spree orders onto
 * the AWJ DTC surface.
 *
 * Missing backend contract, for later gap closure:
 *   GET store/v1/account/orders → the shopper's CommerceOrders, in the
 *                                 `serializeOrder()` shape, newest first
 * plus an identity to hang them on: checkout today writes
 * `CommerceOrder.customer_identity_id` as null because the storefront cart
 * is an anonymous cookie. Listing orders is an identity problem first.
 */
export const ACCOUNT_ORDER_HISTORY_CAPABILITY =
  "design_only" as CapabilityState;

/**
 * Account order lookup / detail.
 *
 * `design_only`: there is no `GET store/v1/account/orders/{id}` and no guest
 * order-lookup route. Confirmation is in-session only (STORE-UI-4). The
 * detail page is designed against `StorefrontOrder` (`serializeOrder()`) so
 * it can light up without being redesigned. It must never call Spree
 * `orders.get`, never title a CommerceOrder an invoice, and never offer
 * Download Invoice / Tax Invoice / Receipt.
 *
 * Missing backend contract:
 *   GET store/v1/account/orders/{id} → one CommerceOrder in the
 *                                      `serializeOrder()` shape
 * scoped to the authenticated customer (or a signed guest lookup token).
 */
export const ACCOUNT_ORDER_LOOKUP_CAPABILITY = "design_only" as CapabilityState;

/**
 * Fulfilment / tracking timeline on an order.
 *
 * `design_only`: `CommerceOrder.status` is `draft | confirmed`. Payment and
 * fulfilment dimensions have not been built — the model says so. A timeline
 * that marks a real order as shipped / out for delivery / delivered would be
 * a commercial claim with no source. The designed timeline may mark
 * **placed** when the authoritative status is `confirmed`; later steps stay
 * visibly untracked.
 *
 * Missing backend contract: a fulfilment lifecycle on the order (and a
 * storefront serializer for it) before any step past "placed" may light up.
 */
export const ACCOUNT_ORDER_STATUS_CAPABILITY = "design_only" as CapabilityState;

/**
 * Saved customer addresses / address book.
 *
 * `design_only`: checkout carries one free-text address per checkout
 * (`PATCH store/v1/checkout/address`). `CommerceOrderSnapshot` is an
 * immutable historical snapshot, not a reusable address book. There is no
 * `store/v1` or `customer/v1` address-book route. The leftover Spree
 * `customer.addresses` CRUD is a different backend and would persist
 * addresses the AWJ checkout does not read.
 *
 * The book is designed (list, card, add, edit, remove, default) and is
 * visibly inert: adding never reports success and nothing is written to
 * browser storage.
 *
 * Missing backend contract:
 *   GET    store/v1/account/addresses
 *   POST   store/v1/account/addresses
 *   PATCH  store/v1/account/addresses/{id}
 *   DELETE store/v1/account/addresses/{id}
 * hanging on the same customer identity the order list needs. Activation
 * also has to teach checkout to offer a saved address — that is a later
 * checkout slice, not this one.
 */
export const ACCOUNT_ADDRESSES_CAPABILITY = "design_only" as CapabilityState;

/**
 * Saved payment methods on the account.
 *
 * `design_only`: same gap as checkout `PAYMENT_CAPABILITY`. There is no
 * saved-method route, no tokenization, and ADR-04 is architecture direction
 * with no implementation approval. The account surface shows the shape of a
 * saved method and an add action; it names no provider, shows no brand
 * mark, collects no card data, and never reports a successful save.
 *
 * Missing backend contract:
 *   GET    store/v1/account/payment-methods → methods THIS storefront saved
 *   POST   is not an AWJ card form — a provider-hosted element creates the
 *          method; AWJ stores a token reference the provider issued
 *   DELETE store/v1/account/payment-methods/{id}
 * Card data must never pass through AWJ.
 */
export const ACCOUNT_SAVED_PAYMENT_METHODS_CAPABILITY =
  "design_only" as CapabilityState;
