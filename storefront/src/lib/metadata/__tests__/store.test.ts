import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";

const mocks = vi.hoisted(() => ({
  fetchStorefrontConfig: vi.fn(),
}));

vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontConfig: mocks.fetchStorefrontConfig,
}));

import { generateStoreMetadata } from "../store";

const FAVICON_A = "data:image/png;base64,iVBORw0KGgo=";
const FAVICON_B = "https://cdn.example.test/store-b.webp";

function storefrontWithBranding(
  faviconDataUrl: string | null,
  logoDataUrl: string | null = null,
) {
  return {
    name: "Store",
    default_locale: "en",
    business_identity: {
      legal_name: null,
      cr_number: null,
      vat_number: null,
    },
    presentation: {
      ...DEFAULT_PRESENTATION_CONFIG,
      branding: {
        ...DEFAULT_PRESENTATION_CONFIG.branding,
        faviconDataUrl,
        logoDataUrl,
      },
    },
  };
}

describe("store metadata favicon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "AWJ Store");
    vi.stubEnv("STORE_META_DESCRIPTION", "Store description");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example.test");
  });

  it("exposes the configured published favicon and Apple icon without changing existing metadata", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(FAVICON_A),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: FAVICON_A, apple: FAVICON_A });
    expect(metadata.title).toEqual({
      template: "%s | AWJ Store",
      default: "AWJ Store",
    });
    expect(metadata.description).toBe("Store description");
    expect(metadata.openGraph).toMatchObject({
      siteName: "AWJ Store",
      type: "website",
      images: ["/social-image.webp"],
    });
  });

  it("uses logoDataUrl for both browser and Apple identity when favicon is missing", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(null, FAVICON_B),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: FAVICON_B, apple: FAVICON_B });
  });

  it("keeps store-specific values isolated across sequential metadata requests", async () => {
    mocks.fetchStorefrontConfig
      .mockResolvedValueOnce(storefrontWithBranding(FAVICON_A))
      .mockResolvedValueOnce(storefrontWithBranding(FAVICON_B));

    const storeA = await generateStoreMetadata({ locale: "en" });
    const storeB = await generateStoreMetadata({ locale: "en" });

    expect(storeA.icons).toEqual({ icon: FAVICON_A, apple: FAVICON_A });
    expect(storeB.icons).toEqual({ icon: FAVICON_B, apple: FAVICON_B });
    expect(storeA.icons).not.toEqual(storeB.icons);
  });

  it.each([
    ["missing", null, null],
    ["malformed", "data:image/svg+xml;base64,PHN2Zy8+", null],
    ["unsupported", "javascript:alert(1)", null],
  ])("uses the neutral fallback when favicon is %s and no logo exists", async (_, favicon, logo) => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(favicon, logo),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({
      icon: "/favicon.ico",
      apple: "/favicon.ico",
    });
  });

  it("falls back from an unsafe favicon to a valid logo", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding("javascript:alert(1)", FAVICON_B),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: FAVICON_B, apple: FAVICON_B });
  });

  it("does not fail metadata rendering when the storefront identity request fails", async () => {
    mocks.fetchStorefrontConfig.mockRejectedValueOnce(new Error("offline"));

    await expect(
      generateStoreMetadata({ locale: "en" }),
    ).resolves.toMatchObject({
      icons: { icon: "/favicon.ico", apple: "/favicon.ico" },
      description: "Store description",
    });
  });
});
