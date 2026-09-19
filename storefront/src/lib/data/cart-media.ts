"use server";

import { fetchProduct } from "@/lib/commerce/products";

/**
 * Resolves cart-line thumbnails.
 *
 * `CommerceCartService::serialize()` carries no image on a cart line — it
 * returns product id, name, unit, quantity and money, and nothing else. A cart
 * without product imagery is a real presentation gap, so this closes it from an
 * authority that already exists rather than by inventing one: each line's own
 * `product_id` is read back through `GET store/v1/products/{id}`, the same
 * catalogue contract the listing and product pages use, and the image it
 * returns is that product's own.
 *
 * Deliberately NOT folded into `getAwjCart()`. `CartContext` refreshes the cart
 * on every navigation, and enriching it there would put N catalogue requests
 * behind every page change. This is called only by the surfaces that actually
 * render imagery — the cart page and the cart drawer — and only for the product
 * ids they are showing.
 *
 * Fails soft in every direction: an unknown id, a deleted product, a failed
 * request or a product with no media all resolve to `null`, which renders the
 * same neutral placeholder an imageless product already gets elsewhere. A cart
 * line is never hidden, re-priced or marked unavailable because its picture
 * could not be fetched — availability is the cart's `available` flag and
 * nothing else.
 */
export async function getCartLineImages(
  productIds: string[],
): Promise<Record<string, string | null>> {
  const unique = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id))),
  );
  if (unique.length === 0) return {};

  const resolved = await Promise.all(
    unique.map(async (id): Promise<[string, string | null]> => {
      try {
        const product = await fetchProduct(id);
        return [id, product.thumbnail_url ?? null];
      } catch {
        return [id, null];
      }
    }),
  );

  return Object.fromEntries(resolved);
}
