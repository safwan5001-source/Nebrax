/**
 * Server-only plumbing for the AWJ `awj_cart_token` cookie.
 *
 * Laravel owns this cookie: it is HttpOnly, so no browser JS — Spree's SDK
 * client included — ever reads or writes its value. This module's job is
 * narrow: read the incoming request's cookie so it can be forwarded to
 * Laravel as a `Cookie` header (fetch() never forwards a Next.js server's
 * own incoming cookies automatically — a same-origin browser concept that
 * doesn't apply to a server-to-server call to a different origin), and
 * mirror whatever `Set-Cookie` Laravel sends back onto the Next.js
 * response so the *browser* ends up holding the right value — again never
 * exposing it to client-side code.
 *
 * The mirrored cookie always uses Next's own `cookies().set()` (never a
 * literal copy of Laravel's raw `Set-Cookie` string) so it is host-only
 * relative to the storefront's own domain, never Laravel's — see
 * AWJ_CART_WIRING's "Cookie forwarding" requirement. Laravel does not set
 * an explicit `Domain` attribute either (confirmed host-only, PR #805), so
 * this never silently drops or widens that guarantee.
 */
import { cookies } from "next/headers";

export const AWJ_CART_COOKIE_NAME = "awj_cart_token";

/** Read the visitor's cart token from the incoming request, to forward to Laravel. */
export async function getAwjCartToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(AWJ_CART_COOKIE_NAME)?.value;
}

interface ParsedSetCookie {
  name: string;
  value: string;
  /** `undefined` = session cookie (Laravel always sets one, but stay defensive). */
  maxAge?: number;
}

/**
 * Parses one `Set-Cookie` header value. Only extracts what we re-apply
 * ourselves (name, value, Max-Age) — attributes like Domain/Path/HttpOnly
 * from Laravel's raw header are intentionally never copied through; our
 * own `applyAwjSetCookie` re-asserts the storefront's own HttpOnly/
 * SameSite=Lax/Path=/ policy instead of trusting the upstream string.
 */
function parseSetCookie(header: string): ParsedSetCookie | null {
  const [pair, ...attrs] = header.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq);
  const value = pair.slice(eq + 1);

  let maxAge: number | undefined;
  for (const attr of attrs) {
    const [rawKey, rawVal] = attr.split("=");
    const key = rawKey?.trim().toLowerCase();
    if (key === "max-age" && rawVal !== undefined) {
      const parsed = Number.parseInt(rawVal.trim(), 10);
      if (!Number.isNaN(parsed)) maxAge = parsed;
    } else if (
      key === "expires" &&
      rawVal !== undefined &&
      maxAge === undefined
    ) {
      const expiresAt = Date.parse(attr.slice(attr.indexOf("=") + 1).trim());
      if (!Number.isNaN(expiresAt)) {
        maxAge = Math.floor((expiresAt - Date.now()) / 1000);
      }
    }
  }

  return { name, value, maxAge };
}

/**
 * Reads every `Set-Cookie` header off an AWJ cart response and mirrors the
 * `awj_cart_token` one (only) onto the Next.js response cookie jar, using
 * our own trusted attributes. A no-op when the response set no cookie
 * (GET on an already-valid cart never rotates the token), and best-effort
 * (swallowed) when called during a Server Component render, where Next.js
 * forbids writing cookies at all — mirroring the same guard
 * `@/lib/spree/cookies`'s `clearCartCookies` callers already rely on.
 */
export async function applyAwjSetCookie(response: Response): Promise<void> {
  const rawValues =
    "getSetCookie" in response.headers &&
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (() => {
          const single = response.headers.get("set-cookie");
          return single ? [single] : [];
        })();

  const match = rawValues
    .map(parseSetCookie)
    .find((parsed) => parsed?.name === AWJ_CART_COOKIE_NAME);
  if (!match) return;

  try {
    const store = await cookies();
    if (match.maxAge !== undefined && match.maxAge <= 0) {
      store.set(AWJ_CART_COOKIE_NAME, "", { maxAge: -1, path: "/" });
      return;
    }

    store.set(AWJ_CART_COOKIE_NAME, match.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      ...(match.maxAge !== undefined ? { maxAge: match.maxAge } : {}),
    });
  } catch {
    // Cookie mutation isn't allowed during a Server Component render —
    // best-effort only, same pattern as clearCartCookies() in @/lib/spree.
  }
}

/** Clears the cart cookie locally (e.g. after a confirmed-invalid GET). Best-effort, same reason as above. */
export async function clearAwjCartCookie(): Promise<void> {
  try {
    const store = await cookies();
    store.set(AWJ_CART_COOKIE_NAME, "", { maxAge: -1, path: "/" });
  } catch {
    // Server Component render — ignore, matches clearCartCookies().
  }
}
