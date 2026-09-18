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
