import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPublishedPresentation: vi.fn(),
}));

vi.mock("@/lib/commerce/storefront", () => ({
  fetchPublishedPresentation: mocks.fetchPublishedPresentation,
}));

import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import { GET } from "./route";

describe("storefront icon route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves a published raster data URL as an image response", async () => {
    mocks.fetchPublishedPresentation.mockResolvedValue({
      ...DEFAULT_PRESENTATION_CONFIG,
      branding: {
        ...DEFAULT_PRESENTATION_CONFIG.branding,
        faviconDataUrl: "data:image/png;base64,AA==",
      },
    });

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the published logo when no favicon is set", async () => {
    mocks.fetchPublishedPresentation.mockResolvedValue({
      ...DEFAULT_PRESENTATION_CONFIG,
      branding: {
        ...DEFAULT_PRESENTATION_CONFIG.branding,
        faviconDataUrl: null,
        logoDataUrl: "data:image/jpeg;base64,QQ==",
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
    mocks.fetchPublishedPresentation.mockResolvedValue(null);

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example.test/favicon.ico",
    );
  });

  it("redirects to the neutral favicon when the published image is rejected", async () => {
    mocks.fetchPublishedPresentation.mockResolvedValue({
      ...DEFAULT_PRESENTATION_CONFIG,
      branding: {
        ...DEFAULT_PRESENTATION_CONFIG.branding,
        faviconDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        logoDataUrl: "http://cdn.example/logo.png",
        compactLogoDataUrl: null,
      },
    });

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example.test/favicon.ico",
    );
  });
});
