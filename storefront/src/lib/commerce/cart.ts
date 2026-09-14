/**
 * AWJ Store Cart V1 client — the only module that calls `store/v1/cart*`.
 * Talks to `storefrontCartRequest()` (the cart-aware transport in
 * `./config`, itself an extension of the same boundary `storefrontFetch()`
 * uses for the catalog) and returns the storefront's own
 * `StorefrontCart` view model, never the raw wire shape.
 */

import {
  type AwjCart,
  mapAwjCartToViewModel,
  type StorefrontCart,
} from "./cart-types";
import { storefrontCartRequest } from "./config";
import type { AwjResourceResponse } from "./types";

/**
 * GET the current cart. Never creates one — a fresh visitor with no
 * `awj_cart_token` cookie gets the backend's own empty-cart shape back
 * (`CommerceCartService::emptyResponse()`), not a 404 and not a new cart.
 */
export async function fetchAwjCart(): Promise<StorefrontCart> {
  const response = await storefrontCartRequest<AwjResourceResponse<AwjCart>>(
    "GET",
    "cart",
  );
  return mapAwjCartToViewModel(response.data);
}

/**
 * POST a cart line. `productId` is the real AWJ product UUID — never a
 * Spree-shaped synthetic id like `${id}-default` (see
 * `mapAwjProductToViewModel`'s own warning: that id "is not a real Spree
 * variant and never will back a real cart"). `unitKey` is `"base"` unless
 * the catalog response explicitly names another canonical AWJ UOM
 * identity (`unit:<UnitTemplateUnit UUID>`) — never inferred from a label.
 * The cart is lazily created by Laravel on first successful call; this
 * never sends a price — the backend resolves it via `CommercePriceResolver`.
 */
export async function addAwjCartItem(
  productId: string,
  quantity: number,
  unitKey: string = "base",
): Promise<StorefrontCart> {
  const response = await storefrontCartRequest<AwjResourceResponse<AwjCart>>(
    "POST",
    "cart/items",
    { product_id: productId, quantity, unit_key: unitKey },
  );
  return mapAwjCartToViewModel(response.data);
}

/** PATCH a line's quantity by its AWJ cart item id. */
export async function updateAwjCartItem(
  itemId: string,
  quantity: number,
): Promise<StorefrontCart> {
  const response = await storefrontCartRequest<AwjResourceResponse<AwjCart>>(
    "PATCH",
    `cart/items/${encodeURIComponent(itemId)}`,
    { quantity },
  );
  return mapAwjCartToViewModel(response.data);
}

/** DELETE a line by its AWJ cart item id — the only mutation unavailable lines allow. */
export async function removeAwjCartItem(
  itemId: string,
): Promise<StorefrontCart> {
  const response = await storefrontCartRequest<AwjResourceResponse<AwjCart>>(
    "DELETE",
    `cart/items/${encodeURIComponent(itemId)}`,
  );
  return mapAwjCartToViewModel(response.data);
}
