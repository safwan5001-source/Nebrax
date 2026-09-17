/**
 * AWJ Store data adapter — server-only configuration.
 *
 * This module is the ONLY place in the storefront that knows the AWJ
 * Commerce API's base URL and how the visitor's storefront identity is
 * conveyed to it. Nothing else under `src/lib/commerce/` or `src/lib/data/`
 * talks to `fetch` against the AWJ backend directly without going through
 * `storefrontFetch()` below — see
 * docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md §4 (the "AWJ Store
 * data/actions boundary" between the Spree-derived UI and the AWJ API).
 */

import { headers } from "next/headers";
import {
  AWJ_CART_COOKIE_NAME,
  applyAwjSetCookie,
  getAwjCartToken,
} from "./cart-cookies";

export const FORWARDED_HOST_HEADER = "X-Storefront-Forwarded-Host";
export const GATEWAY_SECRET_HEADER = "X-Storefront-Gateway-Secret";

function getApiBaseUrl(): string {
  const raw = process.env.AWJ_COMMERCE_API_URL;
  if (!raw) {
    throw new Error(
      "AWJ_COMMERCE_API_URL is not configured. Set it to the AWJ Laravel backend's base URL " +
        "(e.g. http://localhost:8000) in the storefront's server environment.",
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Resolves the hostname the visitor actually used to reach this storefront —
 * the production authority for Tenant/Storefront/SalesChannel resolution
 * (COM-7-P2A/P2B), replacing COM-7-P1's provisional `AWJ_STORE_TENANT_SLUG`.
 *
 * This reads the real `Host` header Next.js's own server received for this
 * request (`next/headers`), exactly the value Laravel's own
 * `$request->getHost()` would see if a browser hit it directly. Never a
 * client-supplied header, cookie, query parameter, or locale — this is the
 * literal transport-level Host of the request the visitor's browser made
 * to reach *this* server, which nothing downstream of the browser can alter.
 *
 * `AWJ_STOREFRONT_DEV_HOST` is a **non-production-only** escape hatch for
 * local development without real DNS/`StorefrontDomain` records pointing at
 * this machine — mirroring the backend's own non-production-only
 * `{tenantSlug}` route (`ResolveStorefrontTenant`). It is never read when
 * `NODE_ENV === "production"`, so it can never become a production
 * authority no matter how a deployment is misconfigured.
 */
async function resolveVisitorHostname(): Promise<string> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.AWJ_STOREFRONT_DEV_HOST
  ) {
    return process.env.AWJ_STOREFRONT_DEV_HOST;
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) {
    throw new Error(
      "Unable to resolve the storefront hostname: the incoming request carried no Host header.",
    );
  }
  return host;
}

/**
 * The Next.js storefront server — not the browser — is the sole caller of
 * `store/v1` in production, so the literal connection Host Laravel sees is
 * always Laravel's own domain, never the visitor's. This shared secret lets
 * Laravel trust an explicit forwarded-host header conveying the visitor's
 * real hostname instead (see `config/storefront.php` on the backend for the
 * full trust rationale). Never exposed to the browser — read only here,
 * server-side, never via `NEXT_PUBLIC_*`.
 */
/**
 * Exported for `edge-storefront-locale.ts` (Edge Middleware runtime, which
 * has no `next/headers` access — see that module's header comment). This
 * function itself only reads `process.env`, so it is Edge-safe as-is; it is
 * exported rather than duplicated so there remains exactly one place that
 * knows the gateway secret's env var name.
 */
export function getGatewaySecret(): string | undefined {
  return process.env.STOREFRONT_GATEWAY_SECRET || undefined;
}

/**
 * Exported for `edge-storefront-locale.ts` — same rationale as
 * `getGatewaySecret()` above: pure env/string logic, no `next/headers`
 * dependency, so it is safe to reuse from Edge Middleware without
 * duplicating the `store/v1/{path}` URL contract.
 */
export function buildStorefrontUrl(path: string): URL {
  const base = getApiBaseUrl();
  const cleanPath = path.replace(/^\/+/, "");
  return new URL(`${base}/store/v1/${cleanPath}`);
}

export class StorefrontApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /**
     * The error envelope's optional structured `details` — e.g. a
     * `review_required` (409) response's `{ items, checkout }` from
     * COM-CHECKOUT-1B. Untyped here (this module doesn't know about
     * checkout shapes); callers narrow it themselves.
     */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

export type StorefrontQueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

async function raiseForErrorResponse(response: Response): Promise<never> {
  let code = "http_error";
  let message = `AWJ storefront API request failed (${response.status})`;
  let details: unknown;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
  } catch {
    // Non-JSON error body — keep the generic message.
  }
  throw new StorefrontApiError(response.status, code, message, details);
}

/**
 * Fetches from the AWJ Store public catalog API (`store/v1/...`).
 * Anonymous, read-only — no auth header, matching the backend's
 * unauthenticated `ResolveStorefrontDomain` + rate-limited catalog routes.
 */
export async function storefrontFetch<T>(
  path: string,
  params?: StorefrontQueryParams,
): Promise<T> {
  const url = buildStorefrontUrl(path);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const hostname = await resolveVisitorHostname();
  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    [FORWARDED_HOST_HEADER]: hostname,
  };
  const secret = getGatewaySecret();
  if (secret) {
    requestHeaders[GATEWAY_SECRET_HEADER] = secret;
  }

  const response = await fetch(url.toString(), { headers: requestHeaders });

  if (!response.ok) {
    await raiseForErrorResponse(response);
  }

  return (await response.json()) as T;
}

export type StorefrontCartMethod = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Fetches/mutates the AWJ Store Cart V1 API (`store/v1/cart*`) — the one
 * extension this module makes beyond `storefrontFetch()`'s anonymous
 * catalog reads, per AWJ_CART_WIRING's "extend the existing AWJ commerce
 * boundary safely rather than creating an unrelated second HTTP client."
 *
 * Differences from `storefrontFetch()`, both required by the strict
 * backend storefront mutation gateway (`RequireStorefrontMutationGateway`)
 * and by the cart's own token cookie contract, never by loosening
 * anything: forwards the visitor's `awj_cart_token` cookie (fetch() never
 * forwards a Next.js server's own incoming cookies to a cross-origin
 * call), sends a JSON body for POST/PATCH, and mirrors any `Set-Cookie`
 * Laravel returns back onto the Next.js response — see
 * `applyAwjSetCookie()`. The gateway secret and forwarded-host headers are
 * unconditionally attached exactly as `storefrontFetch()` already does;
 * this never widens what the backend trusts, it only adds the pieces a
 * mutation additionally needs.
 */
export async function storefrontCartRequest<T>(
  method: StorefrontCartMethod,
  path: string,
  body?: unknown,
  /**
   * Extra request headers, merged in after the trust-boundary headers below
   * (so a caller can never override them). The only current use is
   * `Idempotency-Key` on `POST checkout/complete` (COM-CHECKOUT-1B) — no new
   * transport, same gateway.
   */
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = buildStorefrontUrl(path);
  const hostname = await resolveVisitorHostname();
  const requestHeaders: Record<string, string> = {
    ...extraHeaders,
    Accept: "application/json",
    [FORWARDED_HOST_HEADER]: hostname,
  };
  const secret = getGatewaySecret();
  if (secret) {
    requestHeaders[GATEWAY_SECRET_HEADER] = secret;
  }
  const cartToken = await getAwjCartToken();
  if (cartToken) {
    requestHeaders.Cookie = `${AWJ_CART_COOKIE_NAME}=${cartToken}`;
  }
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url.toString(), {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  await applyAwjSetCookie(response);

  if (!response.ok) {
    await raiseForErrorResponse(response);
  }

  return (await response.json()) as T;
}
