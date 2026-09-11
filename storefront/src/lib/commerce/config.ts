/**
 * AWJ Store data adapter — server-only configuration.
 *
 * This module is the ONLY place in the storefront that knows the AWJ
 * Commerce API's base URL and tenant resolution. Nothing else under
 * `src/lib/commerce/` or `src/lib/data/` talks to `fetch` against the AWJ
 * backend directly without going through `storefrontFetch()` below — see
 * docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md §4 (the "AWJ Store
 * data/actions boundary" between the Spree-derived UI and the AWJ API).
 */

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
 * Resolves which tenant's storefront this Next.js deployment serves.
 *
 * **Provisional, single-tenant-per-deployment fallback — not the
 * production model.** COM-7-P0/P1 explicitly do not implement
 * hostname/domain-based multi-tenant resolution; that is COM-7-P2's job
 * (see AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md §4, §11,
 * §12). This value is a fixed, server-only deployment variable —
 * `AWJ_STORE_TENANT_SLUG` is never read from `NEXT_PUBLIC_*`, a request
 * header, a cookie, or a query parameter, so nothing a browser sends can
 * change which tenant's catalog is served. It establishes no
 * multi-tenant *authority* (there is exactly one tenant per deployment,
 * chosen at deploy time by whoever configures the environment) — it only
 * lets COM-7-P1 validate the catalog adapter end-to-end against a real
 * AWJ tenant before real domain resolution exists.
 */
function getTenantSlug(): string {
  const slug = process.env.AWJ_STORE_TENANT_SLUG;
  if (!slug) {
    throw new Error(
      "AWJ_STORE_TENANT_SLUG is not configured. COM-7-P1 resolves the storefront's tenant from a " +
        "fixed, server-only deployment variable — real per-request hostname resolution is COM-7-P2.",
    );
  }
  return slug;
}

function buildStorefrontUrl(path: string): URL {
  const base = getApiBaseUrl();
  const tenantSlug = getTenantSlug();
  const cleanPath = path.replace(/^\/+/, "");
  return new URL(`${base}/store/v1/${tenantSlug}/${cleanPath}`);
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
 * Fetches from the AWJ Store public catalog API (`store/v1/{tenant}/...`).
 * Anonymous, read-only — no auth header, matching the backend's
 * unauthenticated `ResolveStorefrontTenant` + rate-limited catalog routes.
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

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

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
