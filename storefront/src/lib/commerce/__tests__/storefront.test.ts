import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

const {
  fetchStorefrontConfig,
  fetchStorefrontDefaultLocale,
  fetchStorefrontName,
} = await import("../storefront");

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("commerce/storefront identity (COM-7-P3A)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "Spree Store");
    vi.stubGlobal("fetch", vi.fn());
    mocks.headers.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the server-resolved store name from GET store/v1/storefront", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: { name: "شركة دمينة للاستيراد والتصدير", default_locale: "ar" },
        meta: { request_id: "req-1" },
      }),
    );

    const config = await fetchStorefrontConfig();

    expect(config.name).toBe("شركة دمينة للاستيراد والتصدير");
    expect(config.default_locale).toBe("ar");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://awj-api.test/store/v1/storefront");
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Forwarded-Host"],
    ).toBe("shop.example.com");
  });

  it("does not use NEXT_PUBLIC_STORE_NAME as the resolved store identity", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: { name: "المتجر الرئيسي", default_locale: "ar" },
        meta: { request_id: "req-2" },
      }),
    );

    await expect(fetchStorefrontName()).resolves.toBe("المتجر الرئيسي");
  });

  it("returns null when the API cannot identify the store instead of falling back to another tenant", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "not_found", message: "النطاق غير مسجّل." } },
        false,
        404,
      ),
    );

    await expect(fetchStorefrontName()).resolves.toBeNull();
  });

  it("returns null for a blank name rather than inventing identity", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: { name: "   ", default_locale: "ar" },
        meta: { request_id: "req-3" },
      }),
    );

    await expect(fetchStorefrontName()).resolves.toBeNull();
  });

  it("still exposes default_locale for existing P2B callers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: { name: "Store", default_locale: "en" },
        meta: { request_id: "req-4" },
      }),
    );

    await expect(fetchStorefrontDefaultLocale()).resolves.toBe("en");
  });
});
