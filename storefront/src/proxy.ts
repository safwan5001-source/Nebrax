import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { resolveStorefrontDefaultLocaleForRequest } from "@/lib/commerce/edge-storefront-locale";
import { createSpreeMiddleware } from "@/lib/spree/middleware";
import { getDefaultCountry, getDefaultLocale } from "@/lib/store";

export const proxy = createSpreeMiddleware({
  defaultCountry: getDefaultCountry(),
  defaultLocale: getDefaultLocale(),
  supportedLocales: SUPPORTED_LOCALES,
  resolveStorefrontLocale: resolveStorefrontDefaultLocaleForRequest,
});

export const config = {
  // `icon/?$` is only the dynamic store icon (`app/icon/route.ts`).
  // It has no file extension, so without this exclusion the locale proxy
  // rewrites `/icon` to `/{country}/{locale}/icon` and the handler never runs.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icon/?$|.*\\..*$).*)",
  ],
};
