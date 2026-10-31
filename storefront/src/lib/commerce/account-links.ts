/**
 * Where the storefront chrome's "My account" / "Order history" links point (H6 Final Closure, item L2).
 *
 * On a host where native wholesale buying is open (the API's own `capabilities.wholesale_buyer`), the Spree-era
 * `/account` pages do not exist for buyers — their account is the native membership page and their order history is
 * `/buyer/orders`. Everywhere else the links are exactly what they always were.
 */
export function accountHrefs(
  basePath: string,
  nativeWholesale: boolean,
): { account: string; orders: string } {
  return nativeWholesale
    ? {
        account: `${basePath}/buyer/membership`,
        orders: `${basePath}/buyer/orders`,
      }
    : { account: `${basePath}/account`, orders: `${basePath}/account/orders` };
}
