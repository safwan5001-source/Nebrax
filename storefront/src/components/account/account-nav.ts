/**
 * Destinations the customer-account shell offers.
 *
 * Gift cards are a leftover Spree surface and are not part of the AWJ
 * account. Payment methods and addresses are designed but gated — they
 * stay in the nav so the journey is complete; the pages themselves refuse
 * to persist anything.
 */
export const ACCOUNT_NAV_ITEMS = [
  { href: "/account", key: "overview", exact: true },
  { href: "/account/orders", key: "orders" },
  { href: "/account/profile", key: "profile" },
  { href: "/account/addresses", key: "addresses", gated: true },
  { href: "/account/wishlist", key: "wishlist", gated: true },
  { href: "/account/payment-methods", key: "paymentMethods", gated: true },
] as const;

export type AccountNavKey = (typeof ACCOUNT_NAV_ITEMS)[number]["key"];

export function isAccountNavActive(
  pathname: string,
  basePath: string,
  href: string,
  exact?: boolean,
): boolean {
  const full = `${basePath}${href}`;
  if (exact) return pathname === full || pathname === `${full}/`;
  return pathname === full || pathname.startsWith(`${full}/`);
}
