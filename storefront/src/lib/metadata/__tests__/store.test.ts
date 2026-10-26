import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";

const mocks = vi.hoisted(() => ({
  fetchStorefrontConfig: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async ({ locale }: { locale: string }) =>
      (key: string) =>
        key === "shop" ? (locale === "ar" ? "المتجر" : "Shop") : key,
  ),
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
  name: string | null = "Store",
  displayName = "",
) {
  return {
    name,
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
        displayName,
      },
    },
  };
}

describe("store metadata favicon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    // A deployment-wide name must never reach page metadata.
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "Spree Store");
    vi.stubEnv("STORE_SEO_TITLE", "Spree Store");
    vi.stubEnv("STORE_META_DESCRIPTION", "Store description");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example.test");
  });

  it("uses a request-scoped icon route for both browser and Apple identity", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(FAVICON_A, null, "Store A"),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(metadata.icons).toEqual({ icon: "/icon", apple: "/icon" });
    expect(metadata.title).toEqual({
      template: "%s | Store A",
      default: "Store A",
    });
    expect(metadata.description).toBe("Store description");
    expect(metadata.openGraph).toMatchObject({
      siteName: "Store A",
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

describe("store metadata branding (META-BRAND-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "Spree Store");
    vi.stubEnv("STORE_SEO_TITLE", "Spree Store");
    vi.stubEnv("STORE_META_DESCRIPTION", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://store.example.test");
  });

  it("never shows Store B's name for Store A and vice versa", async () => {
    mocks.fetchStorefrontConfig
      .mockResolvedValueOnce(storefrontWithBranding(null, null, "Store A"))
      .mockResolvedValueOnce(storefrontWithBranding(null, null, "Store B"));

    const a = await generateStoreMetadata({ locale: "en" });
    const b = await generateStoreMetadata({ locale: "en" });

    expect(a.title).toEqual({ template: "%s | Store A", default: "Store A" });
    expect(b.title).toEqual({ template: "%s | Store B", default: "Store B" });
    expect(JSON.stringify(a)).not.toContain("Store B");
    expect(JSON.stringify(b)).not.toContain("Store A");
  });

  it("prefers the published display name over the live store name", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(null, null, "Live Name", "Published Name"),
    );

    const metadata = await generateStoreMetadata({ locale: "ar" });

    expect(metadata.title).toEqual({
      template: "%s | Published Name",
      default: "Published Name",
    });
    expect(metadata.openGraph).toMatchObject({
      siteName: "Published Name",
      locale: "ar",
    });
  });

  it.each([
    ["ar", "المتجر"],
    ["en", "Shop"],
  ])("falls back to the localized neutral label (%s) when no name resolves", async (locale, label) => {
    mocks.fetchStorefrontConfig.mockRejectedValueOnce(new Error("offline"));

    const metadata = await generateStoreMetadata({ locale });

    expect(metadata.title).toEqual({
      template: `%s | ${label}`,
      default: label,
    });
    expect(metadata.openGraph).toMatchObject({ siteName: label });
  });

  it("never leaks legacy Spree branding or the template description", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(null, null, null),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(JSON.stringify(metadata)).not.toMatch(/spree/i);
    expect(metadata.description).toBeUndefined();
  });

  it("keeps metadataBase and the twitter card unchanged", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValueOnce(
      storefrontWithBranding(null, null, "Store A"),
    );

    const metadata = await generateStoreMetadata({ locale: "en" });

    expect(String(metadata.metadataBase)).toBe("https://store.example.test/");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
