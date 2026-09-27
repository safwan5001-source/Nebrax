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

function storefrontWithFavicon(faviconDataUrl: string | null) {
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

  it("exposes the configured published favicon without changing existing metadata", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithFavicon(FAVICON_A),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: FAVICON_A });
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

  it("keeps tenant-specific values isolated across sequential metadata requests", async () => {
    mocks.fetchStorefrontConfig
      .mockResolvedValueOnce(storefrontWithFavicon(FAVICON_A))
      .mockResolvedValueOnce(storefrontWithFavicon(FAVICON_B));

    const storeA = await generateStoreMetadata({ locale: "en" });
    const storeB = await generateStoreMetadata({ locale: "en" });

    expect(storeA.icons).toEqual({ icon: FAVICON_A });
    expect(storeB.icons).toEqual({ icon: FAVICON_B });
    expect(storeA.icons).not.toEqual(storeB.icons);
  });

  it.each([
    ["missing", null],
    ["malformed", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["unsupported", "javascript:alert(1)"],
  ])("uses the neutral fallback when favicon is %s", async (_, favicon) => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithFavicon(favicon),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
  });

  it("does not fail metadata rendering when the storefront identity request fails", async () => {
    mocks.fetchStorefrontConfig.mockRejectedValueOnce(new Error("offline"));

    await expect(
      generateStoreMetadata({ locale: "en" }),
    ).resolves.toMatchObject({
      icons: { icon: "/favicon.ico" },
      description: "Store description",
    });
  });
});
