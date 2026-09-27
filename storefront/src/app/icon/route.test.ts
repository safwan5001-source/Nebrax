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

  it("redirects to the neutral favicon when the published identity is absent", async () => {
    mocks.fetchPublishedPresentation.mockResolvedValue(null);

    const response = await GET(new Request("https://store.example.test/icon"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example.test/favicon.ico",
    );
  });
});
