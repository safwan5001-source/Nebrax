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
