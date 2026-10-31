import { SUPPORTED_LOCALES } from "@/i18n/locales";
import {
  resolveHostContextForRequest,
  resolveStorefrontDefaultLocaleForRequest,
} from "@/lib/commerce/edge-storefront-locale";
import { createSpreeMiddleware } from "@/lib/spree/middleware";
import { getDefaultCountry, getDefaultLocale } from "@/lib/store";

export const proxy = createSpreeMiddleware({
  defaultCountry: getDefaultCountry(),
  defaultLocale: getDefaultLocale(),
  supportedLocales: SUPPORTED_LOCALES,
  resolveStorefrontLocale: resolveStorefrontDefaultLocaleForRequest,
  // H6 Final Closure: real 404s for unknown Hosts and for wholesale-only pages on non-wholesale Hosts.
  resolveHostContext: resolveHostContextForRequest,
  // Set STOREFRONT_UNKNOWN_HOST_404=0 to restore the old generic-shell behavior for unknown Hosts (e.g. while a
  // default platform domain is still used for demos). Any other value keeps the real 404.
  closeUnknownHosts: process.env.STOREFRONT_UNKNOWN_HOST_404 !== "0",
});

export const config = {
  // `icon/?$` is only the dynamic store icon (`app/icon/route.ts`).
  // It has no file extension, so without this exclusion the locale proxy
  // rewrites `/icon` to `/{country}/{locale}/icon` and the handler never runs.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icon/?$|.*\\..*$).*)",
    // X5b: the first entry skips any path containing a dot, but a legacy
    // checkout id may contain one (`/checkout/test.123`). This explicit entry
    // routes exactly `/{country}/{locale}/{legacy section}/{id}` through the
    // proxy so it can answer a real 404; the proxy itself passes every other
    // dotted path (static assets) straight through.
    "/:country/:locale/:section(checkout|confirm-payment|order-placed)/:id",
  ],
};
