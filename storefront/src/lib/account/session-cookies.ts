/**
 * Buyer-account session cookie names (shared by the proxy and the account layout).
 *
 * There is no live buyer-account session yet: `ACCOUNT_AUTH_CAPABILITY` is `gated` and every server action under
 * `@/lib/data/customer` refuses (`capability_unavailable`). These names are the contract the future `store/v1`
 * customer session (register / login / logout / me, tracked as B1–B4 in the exit plan) will write; until then nothing
 * sets them, so every protected `/account/*` page redirects to the sign-in screen.
 *
 * `LEGACY_BROWSER_COOKIES` lists names an earlier (removed) integration wrote. Nothing reads them any more; logout
 * expires them so an old browser sheds them.
 */
export const ACCOUNT_SESSION_COOKIE = "awj_account_session";
export const ACCOUNT_REFRESH_COOKIE = "awj_account_refresh";

/**
 * B2C-ACCOUNTS — a NON-secret, JS-readable presence hint written next to the HttpOnly session cookie (same lifetime),
 * value `1`. It carries no token and grants nothing: it only lets the browser skip the session check on stores/visits
 * where no account session can exist, so a store without accounts (or a guest) makes no extra request on any page.
 * The server never trusts it — the HttpOnly cookie and the API decide every request.
 */
export const ACCOUNT_HINT_COOKIE = "awj_account_hint";

export const LEGACY_BROWSER_COOKIES: readonly string[] = [
  "_spree_jwt",
  "_spree_refresh_token",
  "_spree_cart_token",
  "_spree_cart_token_id",
  "_spree_wholesale_cart_token",
  "_spree_wholesale_cart_token_id",
];
