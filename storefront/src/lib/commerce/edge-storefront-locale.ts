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
  data?: { default_locale?: string | null };
}

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
const CACHE_MAX_ENTRIES = 200;

interface CacheEntry {
  locale: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(host: string): string | null | undefined {
  const entry = cache.get(host);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(host);
    return undefined;
  }
  return entry.locale;
}

function cacheSet(host: string, locale: string | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(host)) {
    // Bounded FIFO eviction — simplicity over strict LRU, since this cache
    // only ever exists to save a redundant fetch, never as a correctness
    // dependency.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(host, { locale, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Resolves the current request's Host's `Storefront.default_locale` from
 * `GET store/v1/storefront`, or `null` on any failure (missing
 * configuration, network error, timeout, non-OK response, malformed body,
 * or an absent/blank field). Never throws — every caller must be able to
 * treat `null` exactly like "no preference" and fall through to the
 * existing Accept-Language → static-default chain.
 *
 * The Host used is the request's own transport-level `Host` header (or, in
 * its absence, `NextRequest`'s parsed `nextUrl.host`) — the same
 * authoritative value `resolveVisitorHostname()` reads server-side. Locale
 * never participates in *which* Storefront is resolved; the backend's own
 * `ResolveStorefrontDomain` does that from this same forwarded Host, same
 * as every other `store/v1` call.
 */
export async function resolveStorefrontDefaultLocaleForRequest(
  request: NextRequest,
): Promise<string | null> {
  const host = request.headers.get("host") || request.nextUrl.host;
  if (!host) return null;

  const cached = cacheGet(host);
  if (cached !== undefined) return cached;

  const locale = await fetchStorefrontDefaultLocale(host);
  cacheSet(host, locale);
  return locale;
}

async function fetchStorefrontDefaultLocale(
  host: string,
): Promise<string | null> {
  let url: URL;
  try {
    url = buildStorefrontUrl("storefront");
  } catch {
    // AWJ_COMMERCE_API_URL not configured — nothing to call.
    return null;
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
    if (!response.ok) return null;

    const body = (await response.json()) as AwjStorefrontConfigResponse;
    const locale = body.data?.default_locale;
    return typeof locale === "string" && locale.trim() ? locale : null;
  } catch {
    // Network error, abort/timeout, or malformed JSON — fail closed.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Test-only: clears the module-level cache between cases. */
export function __resetStorefrontLocaleCacheForTests(): void {
  cache.clear();
}
