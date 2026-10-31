/**
 * Edge-Middleware-safe Storefront default-locale resolver
 * (STORE-LOCALE-WIRING-1).
 *
 * `storefrontFetch()` in `./storefront.ts` (via `./config.ts`) resolves the
 * visitor's Host with `next/headers`'s `headers()` — a Server
 * Component/Route Handler API backed by Next's request-scoped
 * `AsyncLocalStorage`. Edge Middleware (`src/proxy.ts` /
 * `src/lib/spree/middleware.ts`) runs *before* that machinery exists for the
 * request and receives the Host directly on the `NextRequest` it is handed
 * instead. The two are a compatible request/response shape but a distinct
 * API surface, so this module reads the Host from `NextRequest` and never
 * imports `next/headers` — see the STORE_LOCALE_WIRING_1_SCOPE_REPORT.md
 * "Risks" section for why this isn't assumed to just work as-is.
 *
 * This intentionally reuses `buildStorefrontUrl()` / `getGatewaySecret()` /
 * the forwarded-host header name from `./config.ts` — the same trust
 * contract `storefrontFetch()` uses — rather than inventing a second
 * Storefront-identity mechanism. Only the Host-acquisition step differs.
 */

import type { NextRequest } from "next/server";
import {
  buildStorefrontUrl,
  FORWARDED_HOST_HEADER,
  GATEWAY_SECRET_HEADER,
  getGatewaySecret,
} from "./config";

interface AwjStorefrontConfigResponse {
  data?: {
    default_locale?: string | null;
    capabilities?: { wholesale_buyer?: unknown };
  };
  error?: { code?: unknown; message?: unknown };
}

/**
 * What the proxy may know about the request's Host (H6 Final Closure).
 *
 * - `known`: the API resolved the Host to a live Storefront. `wholesaleBuyer` is the API's own answer to "is native
 *   wholesale buying open here?" (deployment flag AND a wholesale-flagged channel) — never inferred from the URL.
 * - `unknown`: the API answered its definitive "no valid store for this Host" 404. Only this state may be turned into a
 *   real HTTP 404 by the caller.
 * - `unavailable`: anything else (not configured, network error, timeout, 5xx, a 404 that is not that definitive
 *   answer, malformed body). Callers must treat it as "no information": never 404 a Host on it.
 */
export type HostContext =
  | { state: "known"; defaultLocale: string | null; wholesaleBuyer: boolean }
  | { state: "unknown" }
  | { state: "unavailable" };

/** Fail-closed request budget so a slow/unreachable API never strands a
 * cookie-less first visitor at the Edge — the caller falls through to the
 * existing Accept-Language/static-default chain on timeout. */
const REQUEST_TIMEOUT_MS = 1500;

/**
 * Tiny, bounded, Host-keyed cache with a short TTL. Not a cache
 * architecture — a single module-level `Map` that only helps while a given
 * Edge isolate happens to be reused across requests (best-effort; nothing
 * depends on it surviving). Bounded so a flood of distinct/spoofed Host
 * headers cannot grow it unboundedly, and short-lived so a Storefront's
 * `default_locale` change (STORE-ADMIN-ADOPT-1B-1) is picked up within
 * seconds, not stuck until a deploy.
 */
const CACHE_TTL_MS = 60_000;
/** A failed lookup is remembered only briefly, so an outage neither hammers the API nor outlives itself. */
const UNAVAILABLE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 200;

/** How long a previous definitive answer may stand in for a failed refresh (a blip must not flip a Host's state). */
const STALE_MAX_MS = 600_000;

interface CacheEntry {
  context: HostContext;
  expiresAt: number;
  staleUntil: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<HostContext>>();

function cacheGet(host: string): HostContext | undefined {
  const entry = cache.get(host);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) return undefined;
  return entry.context;
}

/** The last definitive (known/unknown) answer, even if expired, while it is still inside the stale window. */
function cacheGetStale(host: string): HostContext | undefined {
  const entry = cache.get(host);
  if (!entry || entry.context.state === "unavailable") return undefined;
  if (entry.staleUntil <= Date.now()) {
    cache.delete(host);
    return undefined;
  }
  return entry.context;
}

function cacheSet(host: string, context: HostContext): void {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(host)) {
    // Bounded FIFO eviction — simplicity over strict LRU, since this cache
    // only ever exists to save a redundant fetch, never as a correctness
    // dependency.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  const ttl =
    context.state === "unavailable" ? UNAVAILABLE_TTL_MS : CACHE_TTL_MS;
  const now = Date.now();
  cache.set(host, {
    context,
    expiresAt: now + ttl,
    staleUntil: now + STALE_MAX_MS,
  });
}

/**
 * The Host the API must be asked about. Mirrors `resolveVisitorHostname()` in `./config.ts` exactly — including its
 * non-production-only `AWJ_STOREFRONT_DEV_HOST` escape hatch (never read in production) — so the proxy and the
 * server components always identify the same Storefront. Without this, local development against a registered
 * Storefront would be told "unknown Host" and every page would 404.
 */
function hostForRequest(request: NextRequest): string {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.AWJ_STOREFRONT_DEV_HOST
  ) {
    return process.env.AWJ_STOREFRONT_DEV_HOST;
  }
  return request.headers.get("host") || request.nextUrl.host;
}

/**
 * Resolves the Host's context from `GET store/v1/storefront` (see {@link HostContext}). Never throws.
 *
 * The Host used is the request's own transport-level `Host` header (or, in its absence, `NextRequest`'s parsed
 * `nextUrl.host`) — the same authoritative value `resolveVisitorHostname()` reads server-side. The backend's own
 * `ResolveStorefrontDomain` decides which Storefront that is from this same forwarded Host, as for every other
 * `store/v1` call; nothing here influences it.
 */
export async function resolveHostContextForRequest(
  request: NextRequest,
): Promise<HostContext> {
  const host = hostForRequest(request);
  if (!host) return { state: "unavailable" };

  const cached = cacheGet(host);
  if (cached !== undefined) return cached;

  // A cold cache under load would otherwise fan out one identical API call per concurrent request.
  const pending = inflight.get(host);
  if (pending) return pending;

  const lookup = fetchHostContext(host)
    .then((fresh) => {
      // A failed refresh keeps the previous definitive answer (and re-arms it briefly) instead of flipping the Host.
      const stale =
        fresh.state === "unavailable" ? cacheGetStale(host) : undefined;
      const context = stale ?? fresh;
      if (stale) {
        const entry = cache.get(host);
        cache.set(host, {
          context: stale,
          expiresAt: Date.now() + UNAVAILABLE_TTL_MS,
          staleUntil: entry?.staleUntil ?? Date.now() + STALE_MAX_MS,
        });
      } else {
        cacheSet(host, context);
      }
      return context;
    })
    .finally(() => inflight.delete(host));
  inflight.set(host, lookup);
  return lookup;
}

/**
 * Resolves the current request's Host's `Storefront.default_locale`, or `null` on any failure or when the
 * Storefront has none. Never throws — every caller must be able to treat `null` exactly like "no preference" and
 * fall through to the existing Accept-Language → static-default chain. Shares its lookup and cache with
 * {@link resolveHostContextForRequest}, so a request that needs both makes one call.
 */
export async function resolveStorefrontDefaultLocaleForRequest(
  request: NextRequest,
): Promise<string | null> {
  const context = await resolveHostContextForRequest(request);
  return context.state === "known" ? context.defaultLocale : null;
}

/** The API's definitive "no valid store for this Host" answer, as opposed to any other 404 (e.g. a wrong base URL). */
function isUnresolvedHostAnswer(
  status: number,
  body: AwjStorefrontConfigResponse | null,
): boolean {
  if (status !== 404) return false;
  const error = body?.error;
  if (!error || error.code !== "not_found") return false;
  // Laravel's own unmatched-route 404 shares the code; its message names the route. The Host resolver's does not.
  return !(
    typeof error.message === "string" &&
    /could not be found/i.test(error.message)
  );
}

async function fetchHostContext(host: string): Promise<HostContext> {
  let url: URL;
  try {
    url = buildStorefrontUrl("storefront");
  } catch {
    // AWJ_COMMERCE_API_URL not configured — nothing to call.
    return { state: "unavailable" };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    [FORWARDED_HOST_HEADER]: host,
  };
  const secret = getGatewaySecret();
  if (secret) {
    headers[GATEWAY_SECRET_HEADER] = secret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => null)) as AwjStorefrontConfigResponse | null;
      return isUnresolvedHostAnswer(response.status, body)
        ? { state: "unknown" }
        : { state: "unavailable" };
    }

    const body = (await response.json()) as AwjStorefrontConfigResponse;
    const locale = body.data?.default_locale;
    return {
      state: "known",
      defaultLocale:
        typeof locale === "string" && locale.trim() ? locale : null,
      // Only a literal `true` opens it: an absent/legacy field is "closed".
      wholesaleBuyer: body.data?.capabilities?.wholesale_buyer === true,
    };
  } catch {
    // Network error, abort/timeout, or malformed JSON — fail open for the Host, closed for the capability.
    return { state: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Test-only: clears the module-level cache between cases. */
export function __resetStorefrontLocaleCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
