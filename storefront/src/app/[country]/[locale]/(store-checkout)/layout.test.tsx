import { Children, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontConfig: vi.fn(),
}));

import { StoreBrand } from "@/components/layout/StoreBrand";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import StoreCheckoutLayout from "./layout";

async function checkout(locale: string) {
  return (await StoreCheckoutLayout({
    children: <section>Checkout content</section>,
    params: Promise.resolve({ country: "us", locale }),
  })) as ReactElement<Record<string, unknown>>;
}

describe("StoreCheckoutLayout published theme", () => {
  it("applies published theme, background, logo, and localized store name", async () => {
    vi.mocked(fetchStorefrontConfig).mockResolvedValueOnce({
      name: "Live name",
      default_locale: "en",
      business_identity: { legal_name: null, cr_number: null, vat_number: null },
      presentation: {
        ...DEFAULT_PRESENTATION_CONFIG,
        primaryColor: "#123456",
        backgroundColor: "#abcdef",
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          displayName: "Published shop",
          logoDataUrl: "https://assets.example/store-logo.png",
        },
      },
      presentationMedia: {},
    });

    const root = await checkout("en");
    expect(root.props.dir).toBe("ltr");
    expect(root.props.style).toMatchObject({
      "--store-primary": "#123456",
      backgroundColor: "#abcdef",
    });
    const [header, main] = Children.toArray(root.props.children) as ReactElement[];
    const headerRow = Children.only(header.props.children) as ReactElement;
    const brand = Children.toArray(headerRow.props.children)[0] as ReactElement;
    expect(brand.type).toBe(StoreBrand);
    expect(brand.props).toMatchObject({
      name: "Published shop",
      logoUrl: "https://assets.example/store-logo.png",
    });
    expect(main.props.className).toBe("flex-1");
    const themed = Children.only(main.props.children) as ReactElement;
    expect(themed.type).toBe(PublishedThemeMarkerProvider);
    expect(themed.props.themePreset).toBe(DEFAULT_PRESENTATION_CONFIG.themePreset);
  });

  it("uses safe default branding and RTL when presentation data is unavailable", async () => {
    vi.mocked(fetchStorefrontConfig).mockResolvedValueOnce({
      name: "Live shop",
      default_locale: "ar",
      business_identity: { legal_name: null, cr_number: null, vat_number: null },
      presentation: null,
      presentationMedia: {},
    });

    const root = await checkout("ar");
    expect(root.props.dir).toBe("rtl");
    expect(root.props.style).toEqual({});
    const [header] = Children.toArray(root.props.children) as ReactElement[];
    const headerRow = Children.only(header.props.children) as ReactElement;
    const brand = Children.toArray(headerRow.props.children)[0] as ReactElement;
    expect(brand.props).toMatchObject({ name: "Live shop", logoUrl: null });
  });
});
