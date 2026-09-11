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

const FORWARDED_HOST_HEADER = "X-Storefront-Forwarded-Host";
const GATEWAY_SECRET_HEADER = "X-Storefront-Gateway-Secret";

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
function getGatewaySecret(): string | undefined {
  return process.env.STOREFRONT_GATEWAY_SECRET || undefined;
}

function buildStorefrontUrl(path: string): URL {
  const base = getApiBaseUrl();
  const cleanPath = path.replace(/^\/+/, "");
  return new URL(`${base}/store/v1/${cleanPath}`);
}

export class StorefrontApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

export type StorefrontQueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

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
    let code = "http_error";
    let message = `AWJ storefront API request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new StorefrontApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}
