/**
 * Server-only holder of the wholesale buyer's session token (H6 Batch G).
 *
 * The token the backend issues at `POST store/v1/auth/login` is kept ONLY in an
 * HttpOnly, SameSite=Lax, host-only cookie set from a server action — never
 * returned to client code, never in `localStorage`, never in a URL. The cookie
 * is per-host by construction (no `Domain`), and the backend additionally binds
 * the token to the sales channel its host resolves to, so a token can never be
 * replayed on another store.
 */
import { cookies } from "next/headers";

export const AWJ_BUYER_COOKIE_NAME = "awj_buyer_session";

/** Matches the backend's customer-token lifetime ceiling; the API rejects an expired token regardless. */
const BUYER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The buyer token for the current request, or `undefined` — also outside a
 * request scope (build, tests), where reading cookies throws. Never throws.
 */
export async function getBuyerToken(): Promise<string | undefined> {
  try {
    const store = await cookies();
    const value = store.get(AWJ_BUYER_COOKIE_NAME)?.value;
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function setBuyerToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(AWJ_BUYER_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BUYER_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearBuyerToken(): Promise<void> {
  const store = await cookies();
  store.set(AWJ_BUYER_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Init for a price-bearing catalogue read: carries the buyer token when there
 * is one (which also forces no-store in `storefrontFetch`), and is exactly
 * `base` for every other visitor so DTC requests are unchanged.
 */
export async function withBuyerToken<T extends object>(
  base: T | undefined,
): Promise<(T & { buyerToken?: string }) | undefined> {
  const token = await getBuyerToken();
  if (!token) return base;
  return { ...(base ?? ({} as T)), buyerToken: token };
}
