/**
 * Wire types for the AWJ Store Cart V1 API (`store/v1/cart*`), and the small
 * storefront-facing view model derived from them.
 *
 * These are AWJ-owned, deliberately NOT forced into `@spree/sdk`'s `Cart`/
 * `LineItem` shapes: that interface is a Spree checkout state machine
 * (`current_step`, `fulfillments`, `payments`, `billing_address`,
 * `payment_methods`, ...) with no AWJ equivalent, and AWJ Cart V1 has no
 * checkout yet (see docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md).
 * Faking that whole state machine to reuse Spree-shaped cart UI verbatim
 * would be exactly the "new commerce architecture" this integration must
 * not introduce, and would risk Checkout-adjacent components (express
 * checkout, order lookup) running against data that was never real.
 *
 * `mapAwjCartToViewModel` below produces `StorefrontCart` — the thin shape
 * the storefront cart UI actually reads.
 */

export interface AwjCartMoney {
  amount_minor: number;
  currency: string;
}

/** Raw `store/v1/cart*` line shape, exactly as `CommerceCartService::serialize()` returns it. */
export interface AwjCartLine {
  id: string;
  product_id: string | null;
  product_variant_id: string | null;
  /**
   * The chosen variant spelled out by the backend
   * (`DocumentLineVariantResolver::descriptor()`), e.g. "1 لتر / ستانلس ستيل".
   * `null` for a simple product, and also for a variant line that no longer
   * resolves — an unavailable line keeps its name snapshot but loses the
   * descriptor along with everything else `purchasable()` would have supplied.
   */
  variant_descriptor: string | null;
  product_name: string;
  unit_key: string;
  unit_name: string;
  quantity: number;
  unit_price: AwjCartMoney;
  line_total: AwjCartMoney;
  /**
   * false = the line is retained read/remove-only (product deleted,
   * unpublished, deactivated, UOM no longer valid, or its price no longer
   * resolves). Never dropped silently — see CommerceCartService::serialize().
   */
  available: boolean;
}

/**
 * Raw `store/v1/cart*` response shape. Deliberately carries no cart id —
 * the backend never exposes one; the opaque `awj_cart_token` HttpOnly
 * cookie is the only handle, and it must never reach client JS or the URL.
 */
export interface AwjCart {
  status: "active" | null;
  items: AwjCartLine[];
  subtotal: AwjCartMoney;
  currency: string;
  has_unavailable_items: boolean;
}

/** The storefront cart view model — what UI components actually consume. */
export interface StorefrontCartLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  /** The variant the shopper chose, as the backend spells it. `null` for a simple product. */
  variantDescriptor: string | null;
  name: string;
  unitKey: string;
  unitName: string;
  quantity: number;
  unitPrice: AwjCartMoney;
  lineTotal: AwjCartMoney;
  available: boolean;
}

export interface StorefrontCart {
  /** Discriminant for `isStorefrontCart()` — narrows a shared cart-context value. */
  readonly kind: "awj";
  items: StorefrontCartLine[];
  subtotal: AwjCartMoney;
  currency: string;
  hasUnavailableItems: boolean;
  itemCount: number;
}

export function mapAwjCartToViewModel(cart: AwjCart): StorefrontCart {
  const items = cart.items.map(
    (line): StorefrontCartLine => ({
      id: line.id,
      productId: line.product_id,
      variantId: line.product_variant_id ?? null,
      variantDescriptor: line.variant_descriptor ?? null,
      name: line.product_name,
      unitKey: line.unit_key,
      unitName: line.unit_name,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      lineTotal: line.line_total,
      available: line.available,
    }),
  );

  return {
    kind: "awj",
    items,
    subtotal: cart.subtotal,
    currency: cart.currency,
    hasUnavailableItems: cart.has_unavailable_items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export function isStorefrontCart(cart: unknown): cart is StorefrontCart {
  return (
    typeof cart === "object" &&
    cart !== null &&
    (cart as { kind?: unknown }).kind === "awj"
  );
}

/**
 * Integer-safe display formatting only — `amount_minor` is never divided,
 * rounded, or recomputed here. The backend's own value is authoritative;
 * this only chooses how to print it.
 */
export function formatMinorAmount(money: AwjCartMoney): string {
  try {
    return new Intl.NumberFormat("ar-SA", {
      style: "currency",
      currency: money.currency,
      currencyDisplay: "symbol",
    }).format(money.amount_minor / 100);
  } catch {
    return `${(money.amount_minor / 100).toFixed(2)} ${money.currency}`;
  }
}
