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

  it("uses a request-scoped icon route for both browser and Apple identity", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(FAVICON_A),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: "/icon", apple: "/icon" });
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

  it("keeps the request-scoped icon route stable when favicon falls back to a logo", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(null, FAVICON_B),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: "/icon", apple: "/icon" });
  });

  it("keeps store-specific identity isolated across sequential metadata requests", async () => {
    mocks.fetchStorefrontConfig
      .mockResolvedValueOnce(storefrontWithBranding(FAVICON_A))
      .mockResolvedValueOnce(storefrontWithBranding(FAVICON_B));

    const storeA = await generateStoreMetadata({ locale: "en" });
    const storeB = await generateStoreMetadata({ locale: "en" });

    expect(storeA.icons).toEqual({ icon: "/icon", apple: "/icon" });
    expect(storeB.icons).toEqual({ icon: "/icon", apple: "/icon" });
  });

  it("uses the neutral fallback when favicon and logo are unsafe", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(
        "javascript:alert(1)",
        "data:image/svg+xml;base64,PHN2Zy8+",
      ),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: "/icon", apple: "/icon" });
  });

  it("does not fail metadata rendering when the storefront identity request fails", async () => {
    mocks.fetchStorefrontConfig.mockRejectedValueOnce(new Error("offline"));

    await expect(
      generateStoreMetadata({ locale: "en" }),
    ).resolves.toMatchObject({
      icons: { icon: "/icon", apple: "/icon" },
      description: "Store description",
    });
  });
});
