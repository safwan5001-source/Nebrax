"use server";

import type { Market } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@/i18n/locales";
import { fetchStorefrontDefaultLocale } from "@/lib/commerce/storefront";
import { getClient, getLocaleOptions } from "@/lib/spree";
import { getDefaultCountry } from "@/lib/store";

/**
 * COM-7-P1/P2B: a single static AWJ Market, not a Spree Markets API call.
 *
 * AWJ has no Market/multi-country/multi-currency concept — every tenant
 * is single-currency (`Tenant.currency`, SAR by default; see
 * AWJ_SPREE_TECHNICAL_FIT_AUDIT.md §3/§4) and Saudi Arabia is the only
 * market today (international expansion is an explicit future product
 * decision, not a COM-7 concern — see AWJ_SPREE_ADMIN_SANDBOX_GAP_MAP.md
 * "الأسواق/الدول"). `supported_locales` reflects what is actually
 * registered in `src/i18n/locales.ts` (`ar`/`en` — the two AWJ_STORE_
 * LANGUAGE_DECISION.md §1-2 requires). This still only backs
 * `getMarkets()`/`resolveCurrency()` (root layout + catalog pricing
 * display); `resolveMarket()`/`getMarketCountries()` below remain
 * Spree-backed and unused by any AWJ catalog page.
 */
async function resolveAwjDefaultLocale() {
  try {
    const configured = await fetchStorefrontDefaultLocale();
    return resolveSupportedLocale(configured ?? undefined) ?? DEFAULT_LOCALE;
  } catch {
    // إعداد اللغة أدنى شأناً من فشل الكتالوج كاملاً — العربية سقوطٌ آمن دائماً
    // (AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md §9، القرار
    // السابق: «العربية ليست مرحلة تعريب لاحقة»).
    return DEFAULT_LOCALE;
  }
}

async function staticAwjMarket(): Promise<Market> {
  return {
    id: "awj-sa",
    name: "AWJ Store — Saudi Arabia",
    currency: "SAR",
    default_locale: await resolveAwjDefaultLocale(),
    tax_inclusive: true,
    default: true,
    country_isos: [getDefaultCountry().toUpperCase()],
    supported_locales: ["ar", "en"],
    countries: [
      {
        iso: getDefaultCountry().toUpperCase(),
        iso3: "SAU",
        name: "Saudi Arabia",
        states_required: false,
        zipcode_required: false,
      },
    ],
  };
}

async function cachedResolveMarket(
  country: string,
  options: { locale?: string; country?: string },
) {
  "use cache: remote";
  cacheLife("hours");
  cacheTag("resolved-market");
  return getClient().markets.resolve(country, options);
}

async function cachedListMarketCountries(
  marketId: string,
  options: { locale?: string; country?: string },
) {
  "use cache: remote";
  cacheLife("hours");
  cacheTag("market-countries");
  return getClient().markets.countries.list(marketId, options);
}

export async function getMarkets(_options?: {
  locale?: string;
  country?: string;
}): Promise<{ data: Market[] }> {
  return { data: [await staticAwjMarket()] };
}

export async function resolveMarket(country: string) {
  const options = await getLocaleOptions();
  return cachedResolveMarket(country, options);
}

export async function getMarketCountries(marketId: string) {
  const options = await getLocaleOptions();
  return cachedListMarketCountries(marketId, options);
}

/**
 * Resolve the currency for a given country on the server side, using the
 * cached markets list. Returns undefined if the country is not served by
 * any market.
 */
export async function resolveCurrency(
  country: string,
): Promise<string | undefined> {
  const { data: markets } = await getMarkets();
  const iso = country.toLowerCase();
  for (const market of markets) {
    const match = market.countries?.some((c) => c.iso.toLowerCase() === iso);
    if (match) return market.currency;
  }
  return undefined;
}
