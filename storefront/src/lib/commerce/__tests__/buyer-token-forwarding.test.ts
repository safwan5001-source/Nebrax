import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "wholesale.example.com" })),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

const { storefrontFetch, storefrontBuyerRequest, BUYER_TOKEN_HEADER } =
  await import("../config");

function ok(body: unknown = { data: [] }): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("buyer token on price-bearing catalogue reads (H6 Batch G)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    fetchMock.mockReset().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a DTC visitor's request is exactly what it was: no token header, no forced cache mode", async () => {
    await storefrontFetch("products", { page: 1 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers[BUYER_TOKEN_HEADER]).toBeUndefined();
    expect(init).not.toHaveProperty("cache");
    expect(init.headers["X-Storefront-Forwarded-Host"]).toBe(
      "wholesale.example.com",
    );
  });

  it("a buyer token is sent and ALWAYS forces no-store, whatever cache the caller asked for", async () => {
    await storefrontFetch("products", undefined, { buyerToken: "tok-123" });
    await storefrontFetch("products", undefined, {
      buyerToken: "tok-123",
      cache: "force-cache",
    });

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers[BUYER_TOKEN_HEADER]).toBe("tok-123");
      expect(init.cache).toBe("no-store");
    }
  });

  it("the buyer request helper attaches host + gateway secret + token and never caches", async () => {
    await storefrontBuyerRequest("GET", "wholesale/membership", {
      token: "tok-9",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.awj.test/store/v1/wholesale/membership",
    );
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.headers[BUYER_TOKEN_HEADER]).toBe("tok-9");
    expect(init.headers["X-Storefront-Gateway-Secret"]).toBe("gw-secret");
    expect(init.headers["X-Storefront-Forwarded-Host"]).toBe(
      "wholesale.example.com",
    );
    expect(init.headers.Cookie).toBeUndefined();
  });

  it("login sends credentials in a JSON body, never in the URL", async () => {
    await storefrontBuyerRequest("POST", "auth/login", {
      body: { email: "b@x.test", password: "pw" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("pw");
    expect(String(url)).not.toContain("b@x.test");
    expect(JSON.parse(init.body)).toEqual({
      email: "b@x.test",
      password: "pw",
    });
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers[BUYER_TOKEN_HEADER]).toBeUndefined();
  });

  it("a 401/403 from the catalogue surfaces as a status-bearing error the gate can read", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({ error: { code: "forbidden", message: "x" } }),
    } as unknown as Response);

    await expect(storefrontFetch("products")).rejects.toMatchObject({
      status: 403,
    });
  });
});
