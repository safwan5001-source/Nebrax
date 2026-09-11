import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

const { storefrontFetch } = await import("../config");

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("commerce/config — storefront identity transport (COM-7-P2B)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: {} })),
    );
    mocks.headers.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards the real incoming Host header on every request", async () => {
    await storefrontFetch("categories");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Forwarded-Host"],
    ).toBe("shop.example.com");
  });

  it("never sends a gateway secret header when none is configured", async () => {
    await storefrontFetch("categories");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).not.toHaveProperty("X-Storefront-Gateway-Secret");
  });

  it("includes the gateway secret header when STOREFRONT_GATEWAY_SECRET is configured", async () => {
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "shared-secret");

    await storefrontFetch("categories");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Gateway-Secret"],
    ).toBe("shared-secret");
  });

  it("throws when the incoming request carries no Host header at all", async () => {
    mocks.headers.mockResolvedValueOnce(new Headers());

    await expect(storefrontFetch("categories")).rejects.toThrow(/Host header/);
  });

  it("uses AWJ_STOREFRONT_DEV_HOST instead of the real Host outside production", async () => {
    vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "dev.local.test");
    vi.stubEnv("NODE_ENV", "development");

    await storefrontFetch("categories");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Forwarded-Host"],
    ).toBe("dev.local.test");
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("never reads AWJ_STOREFRONT_DEV_HOST in a production build", async () => {
    vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "dev.local.test");
    vi.stubEnv("NODE_ENV", "production");

    await storefrontFetch("categories");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Forwarded-Host"],
    ).toBe("shop.example.com");
    expect(mocks.headers).toHaveBeenCalled();
  });

  it("builds URLs with no tenant-slug path segment", async () => {
    await storefrontFetch("products/abc-123");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://awj-api.test/store/v1/products/abc-123");
  });
});
