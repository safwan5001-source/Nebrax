import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchStorefrontConfig: vi.fn(),
}));

vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontConfig: mocks.fetchStorefrontConfig,
}));

import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import { GET } from "./route";

describe("storefront icon route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves a published raster data URL as an image response", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValue({
      presentation: {
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          faviconDataUrl: "data:image/png;base64,AA==",
        },
      },
    });

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the published logo when no favicon is set", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValue({
      presentation: {
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          faviconDataUrl: null,
          logoDataUrl: "data:image/jpeg;base64,QQ==",
        },
      },
    });

    const response = await GET(new Request("https://store.example.test/icon"));
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(Buffer.from("QQ==", "base64"));
  });

  it("redirects to the neutral favicon when the published identity is absent", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValue({ presentation: null });

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example.test/favicon.ico",
    );
  });

  it("redirects to the neutral favicon when the published image is rejected", async () => {
    mocks.fetchStorefrontConfig.mockResolvedValue({
      presentation: {
        ...DEFAULT_PRESENTATION_CONFIG,
        branding: {
          ...DEFAULT_PRESENTATION_CONFIG.branding,
          faviconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
          logoDataUrl: "http://cdn.example/logo.png",
          compactLogoDataUrl: null,
        },
      },
    });

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example.test/favicon.ico",
    );
  });

  describe("media-library favicon (V4a)", () => {
    const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
    const sources = (id: string) => [
      {
        kind: "w",
        width: 480,
        height: 270,
        format: "webp",
        src: `/api/storefront/media/customizer/${id}/480w.webp`,
      },
      {
        kind: "thumb",
        width: 160,
        height: 90,
        format: "webp",
        src: `/api/storefront/media/customizer/${id}/thumb-160.webp`,
      },
      {
        kind: "thumb",
        width: 320,
        height: 180,
        format: "webp",
        src: `/api/storefront/media/customizer/${id}/thumb-320.webp`,
      },
      {
        kind: "thumb",
        width: 320,
        height: 180,
        format: "jpg",
        src: `/api/storefront/media/customizer/${id}/thumb-320.jpg`,
      },
    ];
    const media = (id: string) => ({
      width: 1600,
      height: 900,
      decorative: false,
      alt: { ar: null, en: null },
      sources: sources(id),
    });

    it("redirects to the same-origin 320 px thumbnail and wins over the legacy favicon", async () => {
      mocks.fetchStorefrontConfig.mockResolvedValue({
        presentation: {
          ...DEFAULT_PRESENTATION_CONFIG,
          branding: {
            ...DEFAULT_PRESENTATION_CONFIG.branding,
            faviconDataUrl: "data:image/png;base64,AA==",
            faviconMedia: { mediaId: ID },
          },
        },
        presentationMedia: { "branding.faviconMedia": media(ID) },
      });

      const response = await GET(
        new Request("https://store.example.test/icon"),
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://store.example.test/api/storefront/media/customizer/${ID}/thumb-320.webp`,
      );
    });

    it("falls back to the logo reference when no favicon reference is set", async () => {
      mocks.fetchStorefrontConfig.mockResolvedValue({
        presentation: {
          ...DEFAULT_PRESENTATION_CONFIG,
          branding: {
            ...DEFAULT_PRESENTATION_CONFIG.branding,
            logoMedia: { mediaId: ID },
          },
        },
        presentationMedia: { "branding.logoMedia": media(ID) },
      });

      const response = await GET(
        new Request("https://store.example.test/icon"),
      );

      expect(response.headers.get("location")).toContain(
        `/customizer/${ID}/thumb-320.webp`,
      );
    });

    it("an unresolved reference never blocks the legacy favicon", async () => {
      mocks.fetchStorefrontConfig.mockResolvedValue({
        presentation: {
          ...DEFAULT_PRESENTATION_CONFIG,
          branding: {
            ...DEFAULT_PRESENTATION_CONFIG.branding,
            faviconDataUrl: "data:image/png;base64,AA==",
            faviconMedia: { mediaId: ID },
          },
        },
        presentationMedia: {},
      });

      const response = await GET(
        new Request("https://store.example.test/icon"),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
    });

    it("falls back to the neutral icon when the config request fails", async () => {
      mocks.fetchStorefrontConfig.mockRejectedValue(new Error("down"));

      const response = await GET(
        new Request("https://store.example.test/icon"),
      );

      expect(response.headers.get("location")).toBe(
        "https://store.example.test/favicon.ico",
      );
    });
  });
});
