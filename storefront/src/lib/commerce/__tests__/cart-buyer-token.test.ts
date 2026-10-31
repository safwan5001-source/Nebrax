import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  headers: vi.fn(async () => new Headers({ host: "wholesale.example.com" })),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: () => undefined,
  }),
}));

const { storefrontCartRequest, BUYER_TOKEN_HEADER } = await import("../config");

function ok(body: unknown = { data: {} }): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

describe("buyer session on cart, checkout and payment calls (H6 Batch K)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.jar.clear();
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    fetchMock.mockReset().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a signed-in buyer's HttpOnly-cookie token is sent as the X-Customer-Token header, with host + gateway secret, never cached", async () => {
    mocks.jar.set("awj_buyer_session", "buyer-tok-1");

    await storefrontCartRequest("POST", "cart/items", {
      product_id: "p1",
      quantity: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.awj.test/store/v1/cart/items");
    expect(init.headers[BUYER_TOKEN_HEADER]).toBe("buyer-tok-1");
    expect(init.headers["X-Storefront-Gateway-Secret"]).toBe("gw-secret");
    expect(init.headers["X-Storefront-Forwarded-Host"]).toBe(
      "wholesale.example.com",
    );
    expect(init.cache).toBe("no-store");
  });

  it("the token is never in the URL or the request body", async () => {
    mocks.jar.set("awj_buyer_session", "buyer-tok-2");

    await storefrontCartRequest("PATCH", "checkout/contact", {
      name: "Salem",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("buyer-tok-2");
    expect(String(init.body)).not.toContain("buyer-tok-2");
  });

  it("a visitor without a buyer cookie (every DTC visitor) sends exactly the request it sent before", async () => {
    await storefrontCartRequest("GET", "cart");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers[BUYER_TOKEN_HEADER]).toBeUndefined();
    expect(Object.keys(init.headers).sort()).toEqual(
      [
        "Accept",
        "X-Storefront-Forwarded-Host",
        "X-Storefront-Gateway-Secret",
      ].sort(),
    );
  });

  it("a caller can neither supply nor override the buyer identity through extra headers", async () => {
    mocks.jar.set("awj_buyer_session", "server-held");

    await storefrontCartRequest("POST", "checkout/complete", undefined, {
      "Idempotency-Key": "k-1",
      [BUYER_TOKEN_HEADER]: "forged-by-caller",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers[BUYER_TOKEN_HEADER]).toBe("server-held");
    expect(init.headers["Idempotency-Key"]).toBe("k-1");
  });

  it("an extra header cannot inject a buyer when the visitor has no session (case-insensitive)", async () => {
    await storefrontCartRequest("GET", "cart", undefined, {
      [BUYER_TOKEN_HEADER]: "forged-by-caller",
      "x-customer-token": "forged-lowercase",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers[BUYER_TOKEN_HEADER]).toBeUndefined();
    expect(init.headers["x-customer-token"]).toBeUndefined();
  });
});
