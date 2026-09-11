import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchStorefrontDefaultLocale: vi.fn(),
}));

vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontDefaultLocale: mocks.fetchStorefrontDefaultLocale,
}));
vi.mock("@/lib/spree", () => ({
  getClient: () => ({}),
  getLocaleOptions: vi.fn(),
}));

const { getMarkets } = await import("../markets");

/**
 * COM-7-P2B — the resolved Storefront's `default_locale` drives the single
 * static AWJ Market's `default_locale`/`supported_locales`, per
 * AWJ_STORE_LANGUAGE_DECISION.md §4 ("اللغة الافتراضية للمتجر تأتي من
 * إعدادات المتجر/أَوْج"). Arabic is always the safe fallback — never the
 * Spree template's original "en".
 */
describe("lib/data/markets — AWJ default locale wiring", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "sa");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.fetchStorefrontDefaultLocale.mockReset();
  });

  it("defaults to Arabic when the Storefront has no override configured", async () => {
    mocks.fetchStorefrontDefaultLocale.mockResolvedValueOnce(null);

    const { data } = await getMarkets();

    expect(data[0].default_locale).toBe("ar");
  });

  it("honors the resolved Storefront's configured default locale when supported", async () => {
    mocks.fetchStorefrontDefaultLocale.mockResolvedValueOnce("en");

    const { data } = await getMarkets();

    expect(data[0].default_locale).toBe("en");
  });

  it("falls back to Arabic when the backend returns an unsupported locale", async () => {
    mocks.fetchStorefrontDefaultLocale.mockResolvedValueOnce("fr-CA");

    const { data } = await getMarkets();

    expect(data[0].default_locale).toBe("ar");
  });

  it("falls back to Arabic instead of throwing when the config fetch fails", async () => {
    mocks.fetchStorefrontDefaultLocale.mockRejectedValueOnce(
      new Error("network error"),
    );

    const { data } = await getMarkets();

    expect(data[0].default_locale).toBe("ar");
  });

  it("always exposes both Arabic and English as supported locales", async () => {
    mocks.fetchStorefrontDefaultLocale.mockResolvedValueOnce("ar");

    const { data } = await getMarkets();

    expect(data[0].supported_locales).toEqual(["ar", "en"]);
  });

  it("resolves the same market identity regardless of the locale/country hint passed in", async () => {
    mocks.fetchStorefrontDefaultLocale.mockResolvedValue("ar");

    const inArabic = await getMarkets({ locale: "ar", country: "sa" });
    const inEnglish = await getMarkets({ locale: "en", country: "sa" });

    expect(inArabic.data[0].id).toBe(inEnglish.data[0].id);
    expect(inArabic.data[0].country_isos).toEqual(
      inEnglish.data[0].country_isos,
    );
  });
});
