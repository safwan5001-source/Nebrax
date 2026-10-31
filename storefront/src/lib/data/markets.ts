"use server";

import { DEFAULT_LOCALE, resolveSupportedLocale } from "@/i18n/locales";
import { fetchStorefrontDefaultLocale } from "@/lib/commerce/storefront";
import type { StoreMarket } from "@/lib/commerce/types";
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
 * LANGUAGE_DECISION.md §1-2 requires). This backs
 * `getMarkets()`/`resolveCurrency()` (root layout + catalog pricing
 * display).
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

async function staticAwjMarket(): Promise<StoreMarket> {
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

export async function getMarkets(_options?: {
  locale?: string;
  country?: string;
}): Promise<{ data: StoreMarket[] }> {
  return { data: [await staticAwjMarket()] };
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
