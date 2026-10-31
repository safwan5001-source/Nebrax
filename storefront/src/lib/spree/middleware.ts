import { type NextRequest, NextResponse } from "next/server";
import {
  canonicalizeLocale,
  matchLocale,
  negotiateAcceptLanguage,
  negotiateLocale,
} from "@/i18n/normalize";
import { REQUEST_PATHNAME_HEADER, REQUEST_SEARCH_HEADER } from "@/i18n/routing";
import type { HostContext } from "@/lib/commerce/edge-storefront-locale";
import { buildAccountLoginHref } from "@/lib/utils/account-redirect";
import { isWholesaleEnabled } from "./config";

const COUNTRY_COOKIE = "spree_country";
const LOCALE_COOKIE = "spree_locale";
const ACCESS_TOKEN_COOKIE = "_spree_jwt";
const REFRESH_TOKEN_COOKIE = "_spree_refresh_token";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Legacy Spree-backed checkout pages (`(checkout)/{checkout,confirm-payment,
 * order-placed}/[id]`). They belong to the opt-in wholesale add-on; without it
 * they must answer a genuine HTTP 404 (X5b).
 */
const LEGACY_CHECKOUT_PATH =
  /^\/(checkout|confirm-payment|order-placed)\/([^/]+)$/;
/** AWJ-native static segment under `checkout/` — it wins over `checkout/[id]`. */
const AWJ_CHECKOUT_STATIC_SEGMENT = "payment-return";

function isLegacyCheckoutPath(localizedPath: string): boolean {
  const normalized = localizedPath.replace(/\/+$/, "");
  const match = normalized.match(LEGACY_CHECKOUT_PATH);
  if (!match) return false;
  // Raw comparison on purpose: the router matches static segments literally, so
  // `/checkout/%70ayment-return` or `/checkout/Payment-Return` resolve to the
  // legacy `[id]` page (and must be closed), not to the AWJ-native route.
  return !(match[1] === "checkout" && match[2] === AWJ_CHECKOUT_STATIC_SEGMENT);
}

/**
 * Native wholesale buyer pages (`(storefront)/buyer/**`). They are only meaningful on a Host whose channel is
 * wholesale; elsewhere they must answer a genuine 404 instead of rendering a wholesale gate on a retail store.
 */
const BUYER_PATH = /^\/buyer(\/|$)/;
/** The opt-in Spree wholesale portal group (`(wholesale)/wholesale/**`). */
const LEGACY_WHOLESALE_PATH = /^\/wholesale(\/|$)/;

/**
 * Where a legacy `/wholesale/*` URL lands on a host that runs the NATIVE wholesale journey. `null` means "no native
 * equivalent" (the URL is then closed with a real 404, never redirected to something unrelated).
 */
function nativeWholesaleEquivalent(legacyPath: string): string | null {
  const path = legacyPath.replace(/\/+$/, "") || "/wholesale";
  if (path === "/wholesale" || path === "/wholesale/sign-in") {
    return "/buyer/sign-in";
  }
  if (path === "/wholesale/apply") return "/buyer/membership";
  if (path === "/wholesale/quick-order") return "/buyer/quick-order";
  if (path === "/wholesale/cart") return "/cart";
  if (
    path === "/wholesale/products" ||
    path.startsWith("/wholesale/products/")
  ) {
    return "/products";
  }
  return null;
}

/** A country-only bare path (`/sa`): the market without a locale, not a page. */
const BARE_COUNTRY = /^\/([a-z]{2})\/?$/i;

const HAS_COUNTRY_LOCALE =
  /^\/([a-z]{2})\/([a-z]{2,3}(?:-[a-z0-9]{2,8})*)(\/|$)/i;

export interface SpreeMiddlewareConfig {
  /** Default country ISO code (default: 'us') */
  defaultCountry?: string;
  /** Default locale code (default: 'en') */
  defaultLocale?: string;
  /** Locale codes for which the storefront has message bundles. */
  supportedLocales?: readonly string[];
  /** Routes to skip — prefixes matched with startsWith (default: ['/_next', '/api', '/favicon.ico']) */
  staticRoutes?: string[];
  /** JWT cookie used to identify a potentially authenticated account request. */
  accessTokenCookieName?: string;
  /** Refresh-token cookie used to preserve recoverable account sessions. */
  refreshTokenCookieName?: string;
  /**
   * Resolves the current request's Storefront-configured default locale
   * (STORE-LOCALE-WIRING-1), or `null`/`undefined` when it cannot be
   * determined. Only consulted for a cookie-less bare-path visit, and only
   * to pick the redirect target — it never influences which Storefront is
   * resolved. Omit to keep the pre-existing behavior (Accept-Language →
   * static `defaultLocale`) exactly as-is.
   */
  resolveStorefrontLocale?: (
    request: NextRequest,
  ) => Promise<string | null | undefined>;
  /**
   * Resolves what the API knows about the request's Host (H6 Final Closure): whether it is a real Storefront at all
   * and whether native wholesale buying is open there. Consulted only for localized page requests. An `unavailable`
   * answer never closes anything except the wholesale-only pages (fail closed for the capability, fail open for the
   * Host). Omit to keep the previous behavior exactly.
   */
  resolveHostContext?: (request: NextRequest) => Promise<HostContext>;
  /**
   * When true, a Host that the API definitively reports as unknown answers a real 404 for every localized page. Off
   * switch for deployments whose default domain intentionally serves a generic shell.
   */
  closeUnknownHosts?: boolean;
}

const PUBLIC_ACCOUNT_PATHS = new Set([
  "/account",
  "/account/register",
  "/account/forgot-password",
  "/account/reset-password",
]);

function isProtectedAccountPath(pathname: string, localizedPrefix: string) {
  const localizedPath = pathname.slice(localizedPrefix.length);
  const normalizedPath = localizedPath.replace(/\/+$/, "") || "/";

  return (
    normalizedPath.startsWith("/account/") &&
    !PUBLIC_ACCOUNT_PATHS.has(normalizedPath)
  );
}

/**
 * Set spree_country / spree_locale cookies on a response so that
 * `getLocaleOptions()` reads values matching the URL during SSR.
 */
function setLocaleCookies(
  response: NextResponse,
  country: string,
  locale: string,
): void {
  // Only the server (this proxy and `getLocaleOptions()`) ever reads these, so they are HttpOnly; the rest of the
  // storefront's cookies (cart, session) already carry the same Secure/SameSite attributes.
  const attributes = {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };
  response.cookies.set(COUNTRY_COOKIE, country, attributes);
  response.cookies.set(LOCALE_COOKIE, locale, attributes);
}

/**
 * A real HTTP 404, decided before rendering starts.
 *
 * Why not `notFound()` in the layout: with `cacheComponents` (PPR) the route is
 * prerendered and its response is streamed, so by the time the layout throws the
 * 200 status line is already committed (`x-nextjs-postponed`). Rewriting to a
 * path that matches no route yields the framework's own 404 (same page and
 * status as any unknown URL) with no redirect and no data fetch.
 */
function legacyCheckoutClosed(
  request: NextRequest,
  canonicalPrefix: string,
  cookies: { country: string; locale: string } | null,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = `${canonicalPrefix}/awj-legacy-checkout-closed`;
  url.search = "";
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);
  requestHeaders.set(REQUEST_SEARCH_HEADER, "");
  const response = NextResponse.rewrite(url, {
    request: { headers: requestHeaders },
  });
  if (cookies) setLocaleCookies(response, cookies.country, cookies.locale);
  return response;
}

/** Redirects to `target` (same origin, same query) without altering the visitor's locale choice. */
function redirectTo(
  request: NextRequest,
  target: string,
  cookies: { country: string; locale: string },
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = target;
  const response = NextResponse.redirect(url, 308);
  setLocaleCookies(response, cookies.country, cookies.locale);
  return response;
}

function nextWithLocaleContext(
  request: NextRequest,
  country: string,
  locale: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);
  requestHeaders.set(REQUEST_SEARCH_HEADER, request.nextUrl.search);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  setLocaleCookies(response, country, locale);
  return response;
}

/**
 * Creates a Next.js middleware that handles:
 * - Redirecting bare paths to /{country}/{locale}/...
 * - Detecting country from cookies → geo headers → default
 * - Detecting locale from cookies → accept-language → default
 * - Syncing spree_country / spree_locale cookies with URL segments so
 *   server-side data fetching (via `getLocaleOptions()`) uses the correct market
 */
export function createSpreeMiddleware(
  config: SpreeMiddlewareConfig = {},
): (request: NextRequest) => Promise<NextResponse> {
  const defaultCountry = config.defaultCountry ?? "us";
  const supportedLocales = config.supportedLocales ?? [];
  const configuredDefaultLocale = config.defaultLocale ?? "en";
  const defaultLocale =
    (supportedLocales.length > 0
      ? (matchLocale(configuredDefaultLocale, supportedLocales) ??
        matchLocale("en", supportedLocales) ??
        supportedLocales[0])
      : canonicalizeLocale(configuredDefaultLocale)) ?? "en";
  const staticRoutes = config.staticRoutes ?? [
    "/_next",
    "/api",
    "/dev",
    "/favicon.ico",
  ];
  const accessTokenCookieName =
    config.accessTokenCookieName ?? ACCESS_TOKEN_COOKIE;
  const refreshTokenCookieName =
    config.refreshTokenCookieName ?? REFRESH_TOKEN_COOKIE;
  const resolveStorefrontLocale = config.resolveStorefrontLocale;
  const resolveHostContext = config.resolveHostContext;
  const closeUnknownHosts = config.closeUnknownHosts ?? true;

  return async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // `/icon` is the dynamic store icon. Locale-prefixing it 404s before
    // `app/icon/route.ts` runs. Match the proxy matcher (`icon/?$`) exactly —
    // `/icons` and other routes still receive locale routing.
    if (pathname === "/icon" || pathname === "/icon/") {
      return NextResponse.next();
    }

    // Skip static routes
    if (staticRoutes.some((route) => pathname.startsWith(route))) {
      return NextResponse.next();
    }

    // Skip if pathname contains a file extension (static assets). A legacy
    // checkout id may legitimately contain a dot (`/checkout/test.123`), so the
    // closed-route check runs first; it only matches the exact
    // `/{country}/{locale}/{checkout|confirm-payment|order-placed}/{id}` shape.
    if (/\.\w+$/.test(pathname)) {
      const dotted = pathname.match(HAS_COUNTRY_LOCALE);
      if (dotted && !isWholesaleEnabled()) {
        const prefix = `/${dotted[1]}/${dotted[2]}`;
        if (isLegacyCheckoutPath(pathname.slice(prefix.length))) {
          // No cookies: the locale here is unvalidated, only the status matters.
          return legacyCheckoutClosed(request, prefix, null);
        }
      }
      return NextResponse.next();
    }

    // Already has /{country}/{locale} prefix — sync cookies with URL segments
    const match = pathname.match(HAS_COUNTRY_LOCALE);
    if (match) {
      const country = match[1].toLowerCase();
      const originalPrefix = `/${match[1]}/${match[2]}`;
      const locale =
        supportedLocales.length > 0
          ? negotiateLocale(match[2], supportedLocales)
          : canonicalizeLocale(match[2]);

      // An unknown locale cannot safely retain the requested country: the
      // global default locale may not be enabled by that country's Market.
      // Use the configured default route while preserving the remaining path.
      if (!locale) {
        const url = request.nextUrl.clone();
        url.pathname = `/${defaultCountry}/${defaultLocale}${pathname.slice(originalPrefix.length)}`;
        const response = NextResponse.redirect(url);
        setLocaleCookies(response, defaultCountry, defaultLocale);
        return response;
      }

      const canonicalPrefix = `/${country}/${locale}`;

      if (originalPrefix !== canonicalPrefix) {
        const url = request.nextUrl.clone();
        url.pathname = `${canonicalPrefix}${pathname.slice(originalPrefix.length)}`;
        const response = NextResponse.redirect(url);
        setLocaleCookies(response, country, locale);
        return response;
      }

      if (
        isProtectedAccountPath(pathname, canonicalPrefix) &&
        !request.cookies.get(accessTokenCookieName)?.value &&
        !request.cookies.get(refreshTokenCookieName)?.value
      ) {
        const loginHref = buildAccountLoginHref(
          canonicalPrefix,
          `${pathname}${request.nextUrl.search}`,
        );
        const response = NextResponse.redirect(
          new URL(loginHref, request.nextUrl),
        );
        setLocaleCookies(response, country, locale);
        return response;
      }

      const localizedPath = pathname.slice(canonicalPrefix.length);

      if (!isWholesaleEnabled() && isLegacyCheckoutPath(localizedPath)) {
        return legacyCheckoutClosed(request, canonicalPrefix, {
          country,
          locale,
        });
      }

      if (resolveHostContext) {
        const normalizedPath = localizedPath.replace(/\/+$/, "") || "/";
        const hostContext: HostContext = await resolveHostContext(
          request,
        ).catch((): HostContext => ({ state: "unavailable" }));

        // A Host the API definitively does not know is not a store: answer 404 instead of an empty shell.
        if (closeUnknownHosts && hostContext.state === "unknown") {
          return legacyCheckoutClosed(request, canonicalPrefix, null);
        }

        const nativeWholesaleOpen =
          hostContext.state === "known" && hostContext.wholesaleBuyer;

        // Native buyer pages exist only where the API says wholesale is open (unknown = closed: fail closed).
        if (BUYER_PATH.test(normalizedPath) && !nativeWholesaleOpen) {
          return legacyCheckoutClosed(request, canonicalPrefix, {
            country,
            locale,
          });
        }

        // The Spree-era portal URLs: when that add-on is off they never render (a real 404, or a redirect to the
        // native equivalent on a native wholesale host); when it is on they are the portal and pass through.
        if (
          !isWholesaleEnabled() &&
          LEGACY_WHOLESALE_PATH.test(normalizedPath)
        ) {
          const equivalent = nativeWholesaleOpen
            ? nativeWholesaleEquivalent(normalizedPath)
            : null;
          return equivalent
            ? redirectTo(request, `${canonicalPrefix}${equivalent}`, {
                country,
                locale,
              })
            : legacyCheckoutClosed(request, canonicalPrefix, {
                country,
                locale,
              });
        }
      }

      return nextWithLocaleContext(request, country, locale);
    }

    // `/sa` alone is a market with no locale. It used to fall through as a page called "sa" and land on
    // `/sa/ar/sa` (a 404); send it to that market's root with the usual locale negotiation instead.
    const bareCountry = pathname.match(BARE_COUNTRY);

    // Detect country: cookie → geo headers → default
    const country =
      bareCountry?.[1].toLowerCase() ??
      request.cookies.get(COUNTRY_COOKIE)?.value ??
      request.headers.get("x-vercel-ip-country")?.toLowerCase() ??
      request.headers.get("cf-ipcountry")?.toLowerCase() ??
      defaultCountry;

    // Detect locale: cookie → Storefront.default_locale → accept-language → default
    // (STORE-LOCALE-WIRING-1 — see storefront/src/lib/commerce/edge-storefront-locale.ts
    // for the resolver's own fail-closed/caching behavior.)
    const cookieValue = request.cookies.get(LOCALE_COOKIE)?.value;
    const cookieLocale =
      supportedLocales.length > 0
        ? negotiateLocale(cookieValue, supportedLocales)
        : canonicalizeLocale(cookieValue);

    let storefrontLocale: string | undefined;
    if (!cookieLocale && resolveStorefrontLocale) {
      // Only asked when the buyer has no cookie preference of their own —
      // a cookie already wins, so the network round-trip would be wasted.
      const resolved = await resolveStorefrontLocale(request).catch(() => null);
      storefrontLocale = resolved
        ? supportedLocales.length > 0
          ? matchLocale(resolved, supportedLocales)
          : canonicalizeLocale(resolved)
        : undefined;
    }

    const acceptLanguage = request.headers.get("accept-language");
    const acceptedLocale =
      supportedLocales.length > 0
        ? negotiateAcceptLanguage(acceptLanguage, supportedLocales)
        : canonicalizeLocale(acceptLanguage?.split(",")[0]?.split(";")[0]);
    const locale =
      cookieLocale ?? storefrontLocale ?? acceptedLocale ?? defaultLocale;

    const url = request.nextUrl.clone();
    url.pathname = `/${country}/${locale}${
      pathname === "/" || bareCountry ? "" : pathname
    }`;

    const response = NextResponse.redirect(url);
    setLocaleCookies(response, country, locale);
    return response;
  };
}
