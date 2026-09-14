import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cookieStore = new Map<string, string>();
  return {
    headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
    cookieStore,
    cookieGet: vi.fn((name: string) =>
      cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined,
    ),
    cookieSet: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: vi.fn(async () => ({ get: mocks.cookieGet, set: mocks.cookieSet })),
}));

const { storefrontFetch, storefrontCartRequest } = await import("../config");

function jsonResponse(
  body: unknown,
  ok = true,
  status = 200,
  setCookie?: string,
): Response {
  return {
    ok,
    status,
    json: async () => body,
    headers: {
      getSetCookie: () => (setCookie ? [setCookie] : []),
      get: (name: string) =>
        name.toLowerCase() === "set-cookie" ? (setCookie ?? null) : null,
    },
  } as unknown as Response;
}

describe("commerce/config — storefront identity transport (COM-7-P2B)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: {} })),
    );
    mocks.headers.mockClear();
    mocks.cookieStore.clear();
    mocks.cookieGet.mockClear();
    mocks.cookieSet.mockClear();
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

describe("commerce/config — storefrontCartRequest (AWJ Cart V1 transport)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { items: [] } })),
    );
    mocks.headers.mockClear();
    mocks.cookieStore.clear();
    mocks.cookieGet.mockClear();
    mocks.cookieSet.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards the visitor's awj_cart_token cookie on GET", async () => {
    mocks.cookieStore.set("awj_cart_token", "raw-token-abc");

    await storefrontCartRequest("GET", "cart");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Cookie).toBe(
      "awj_cart_token=raw-token-abc",
    );
  });

  it("sends no Cookie header for a fresh visitor with no cart token", async () => {
    await storefrontCartRequest("GET", "cart");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).not.toHaveProperty("Cookie");
  });

  it("sends a JSON body and Content-Type on POST/PATCH, matching a mutation call", async () => {
    await storefrontCartRequest("POST", "cart/items", {
      product_id: "prod-1",
      quantity: 2,
      unit_key: "base",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      product_id: "prod-1",
      quantity: 2,
      unit_key: "base",
    });
  });

  it("never sends a price field in the mutation body", async () => {
    await storefrontCartRequest("POST", "cart/items", {
      product_id: "prod-1",
      quantity: 2,
      unit_key: "base",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).not.toHaveProperty("price");
    expect(body).not.toHaveProperty("unit_price");
  });

  it("forwards the same forwarded-host and gateway-secret headers storefrontFetch() uses", async () => {
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "shared-secret");

    await storefrontCartRequest("PATCH", "cart/items/item-1", { quantity: 3 });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Storefront-Forwarded-Host"]).toBe("shop.example.com");
    expect(headers["X-Storefront-Gateway-Secret"]).toBe("shared-secret");
  });

  it("uses the DELETE method with no body for item removal", async () => {
    await storefrontCartRequest("DELETE", "cart/items/item-1");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });

  it("mirrors a Set-Cookie response header onto the Next.js cookie jar", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { data: { items: [] } },
            true,
            200,
            "awj_cart_token=new-token; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax",
          ),
        ),
    );

    await storefrontCartRequest("POST", "cart/items", {
      product_id: "p",
      quantity: 1,
    });

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "awj_cart_token",
      "new-token",
      expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
    );
  });

  it("raises StorefrontApiError with the backend's error code/message on failure, after still mirroring any Set-Cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: "not_found", message: "السلة غير متاحة." } },
            false,
            404,
            "awj_cart_token=; Max-Age=0; Path=/",
          ),
        ),
    );

    await expect(
      storefrontCartRequest("POST", "cart/items", {
        product_id: "p",
        quantity: 1,
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(mocks.cookieSet).toHaveBeenCalledWith("awj_cart_token", "", {
      maxAge: -1,
      path: "/",
    });
  });
});
