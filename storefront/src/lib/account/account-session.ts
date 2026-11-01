/**
 * Server-only holder of the retail shopper's account session token (B2C-ACCOUNTS).
 *
 * The token the backend issues at `POST store/v1/auth/login` lives ONLY in an HttpOnly, SameSite=Lax, host-only cookie
 * written from a server action — never returned to client code, never in `localStorage`, never in a URL. It is
 * host-only by construction (no `Domain`) and the backend additionally binds the token to the sales channel the host
 * resolves to, so a session can never be replayed on another store.
 *
 * Persistence is the shopper's choice ("remember me"): a persistent cookie lives exactly as long as the server-side
 * token (`maxAge` = the lifetime the API reported), a non-persistent one is a browser-session cookie whose server token
 * is short-lived anyway. The server stays the authority: an expired / revoked token is simply rejected by the API.
 *
 * CSRF: every state-changing call is a Next.js Server Action (framework-enforced same-origin Origin/Host check, POST
 * only) and the cookie is `SameSite=Lax`, so a cross-site request carries no session; the token never reaches the
 * browser's JS and the Laravel API is only ever called server-to-server with the gateway secret.
 */
import { cookies } from "next/headers";
import {
  ACCOUNT_HINT_COOKIE,
  ACCOUNT_REFRESH_COOKIE,
  ACCOUNT_SESSION_COOKIE,
  LEGACY_BROWSER_COOKIES,
} from "@/lib/account/session-cookies";

const DAY_SECONDS = 60 * 60 * 24;
/** Never trust a lifetime above what the product allows, whatever the API said. */
const MAX_COOKIE_DAYS = 90;

/** The account token for the current request, or `undefined` — also outside a request scope. Never throws. */
export async function getAccountToken(): Promise<string | undefined> {
  try {
    const store = await cookies();
    const value = store.get(ACCOUNT_SESSION_COOKIE)?.value;
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

export function cookieMaxAgeSeconds(
  sessionDays: number | null | undefined,
): number | undefined {
  if (typeof sessionDays !== "number" || !Number.isFinite(sessionDays)) {
    return undefined;
  }
  const days = Math.min(Math.max(Math.floor(sessionDays), 1), MAX_COOKIE_DAYS);
  return days * DAY_SECONDS;
}

/**
 * `remember` + the API-reported lifetime → persistent cookie; otherwise a browser-session cookie (no `maxAge`), which the
 * browser drops on exit. A missing lifetime is never promoted to "persistent".
 */
export async function setAccountToken(
  token: string,
  options: { remember: boolean; sessionDays: number | null | undefined },
): Promise<void> {
  const store = await cookies();
  const maxAge = options.remember
    ? cookieMaxAgeSeconds(options.sessionDays)
    : undefined;
  store.set(ACCOUNT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(maxAge !== undefined ? { maxAge } : {}),
  });
  // presence hint only (see ACCOUNT_HINT_COOKIE): not a credential.
  store.set(ACCOUNT_HINT_COOKIE, "1", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(maxAge !== undefined ? { maxAge } : {}),
  });
}

export async function clearAccountToken(): Promise<void> {
  const store = await cookies();
  for (const name of [
    ACCOUNT_SESSION_COOKIE,
    ACCOUNT_HINT_COOKIE,
    ACCOUNT_REFRESH_COOKIE,
    ...LEGACY_BROWSER_COOKIES,
  ]) {
    store.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
