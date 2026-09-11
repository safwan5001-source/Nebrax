import type { Country, Market } from "@spree/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_PATHNAME_HEADER, REQUEST_SEARCH_HEADER } from "@/i18n/routing";

const mocks = vi.hoisted(() => ({
  getMarkets: vi.fn(),
  headers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  redirect: vi.fn((location: string) => {
    throw new Error(`redirect:${location}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/lib/data/markets", () => ({ getMarkets: mocks.getMarkets }));
vi.mock("@/lib/store", () => ({
  getDefaultCountry: () => "us",
  getDefaultLocale: () => "en",
}));
vi.mock("@/components/layout/DocumentShell", () => ({
  DocumentShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/cart/CartDrawer", () => ({ CartDrawer: () => null }));
vi.mock("@/components/seo/JsonLd", () => ({ JsonLd: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { CountryLocaleLayoutContent } from "./layout";

function country(iso: string): Country {
  return {
    iso,
    iso3: iso,
    name: iso,
    states_required: false,
    zipcode_required: false,
  } as Country;
}

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
    name: "Market",
    currency: "USD",
    default_locale: "en",
    tax_inclusive: false,
    default: true,
    country_isos: ["US"],
    supported_locales: ["en"],
    countries: [country("US")],
    ...overrides,
  } as Market;
}

describe("CountryLocaleLayout Market fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to the Market locale without dropping path or query", async () => {
    mocks.getMarkets.mockResolvedValue({
      data: [
        market({
          default_locale: "es",
          supported_locales: ["es"],
          country_isos: ["AR"],
          countries: [country("AR")],
        }),
      ],
    });
    mocks.headers.mockResolvedValue(
      new Headers({
        [REQUEST_PATHNAME_HEADER]: "/ar/en/products/coffee",
        [REQUEST_SEARCH_HEADER]: "?sort=price",
      }),
    );

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "ar", locale: "en" }),
      }),
    ).rejects.toThrow("redirect:/ar/es/products/coffee?sort=price");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/ar/es/products/coffee?sort=price",
    );
    expect(mocks.getMarkets).toHaveBeenCalledWith({
      country: "us",
      locale: "en",
    });
  });

  it("redirects a storefront-supported locale that is unavailable in the Market", async () => {
    mocks.getMarkets.mockResolvedValue({
      data: [
        market(),
        market({
          id: "market-eu",
          name: "Europe",
          currency: "EUR",
          default: false,
          default_locale: "de",
          supported_locales: ["de", "es", "fr"],
          country_isos: ["PL"],
          countries: [country("PL")],
        }),
      ],
    });
    mocks.headers.mockResolvedValue(
      new Headers({
        [REQUEST_PATHNAME_HEADER]: "/pl/pl",
      }),
    );

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "pl", locale: "pl" }),
      }),
    ).rejects.toThrow("redirect:/pl/de");
    expect(mocks.redirect).toHaveBeenCalledWith("/pl/de");
    expect(mocks.getMarkets).toHaveBeenCalledWith({
      country: "us",
      locale: "en",
    });
  });

  it("redirects an unknown country to the default Market and keeps the page", async () => {
    mocks.getMarkets.mockResolvedValue({ data: [market()] });
    mocks.headers.mockResolvedValue(
      new Headers({
        [REQUEST_PATHNAME_HEADER]: "/zz/en/products/coffee",
      }),
    );

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "zz", locale: "en" }),
      }),
    ).rejects.toThrow("redirect:/us/en/products/coffee");
  });

  it.each([
    ["an empty Markets response", []],
    [
      "a Market without countries",
      [market({ countries: [], country_isos: [] })],
    ],
  ])("does not redirect the default route to itself for %s", async (_, markets) => {
    mocks.getMarkets.mockResolvedValue({ data: markets });

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "us", locale: "en" }),
      }),
    ).resolves.toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects a non-default route once when no Market target is available", async () => {
    mocks.getMarkets.mockResolvedValue({ data: [] });
    mocks.headers.mockResolvedValue(
      new Headers({
        [REQUEST_PATHNAME_HEADER]: "/zz/en/products/coffee",
        [REQUEST_SEARCH_HEADER]: "?sort=price",
      }),
    );

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "zz", locale: "en" }),
      }),
    ).rejects.toThrow("redirect:/us/en/products/coffee?sort=price");
  });

  // ── COM-7-P2B — Arabic default + locale switching preserves identity ──

  it("renders Arabic directly with no redirect when the Market supports it as default", async () => {
    mocks.getMarkets.mockResolvedValue({
      data: [
        market({
          default_locale: "ar",
          supported_locales: ["ar", "en"],
          country_isos: ["SA"],
          countries: [country("SA")],
        }),
      ],
    });

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "sa", locale: "ar" }),
      }),
    ).resolves.toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not redirect when switching between Arabic and English within the same enabled Market", async () => {
    mocks.getMarkets.mockResolvedValue({
      data: [
        market({
          default_locale: "ar",
          supported_locales: ["ar", "en"],
          country_isos: ["SA"],
          countries: [country("SA")],
        }),
      ],
    });

    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "sa", locale: "ar" }),
      }),
    ).resolves.toBeDefined();
    await expect(
      CountryLocaleLayoutContent({
        children: <main />,
        params: Promise.resolve({ country: "sa", locale: "en" }),
      }),
    ).resolves.toBeDefined();

    // نفس السياق (السوق/الدولة) في الطلبين — تبديل اللغة وحده لا يستدعي أي
    // إعادة توجيه، فهو لا يغيّر هوية المتجر (Tenant/Storefront/Channel).
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getMarkets).toHaveBeenCalledTimes(2);
  });
});
