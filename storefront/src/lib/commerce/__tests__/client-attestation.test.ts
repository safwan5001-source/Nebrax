import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

const {
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  CLIENT_IP_TIMESTAMP_HEADER,
  clientIpAttestation,
  signClientIp,
  trustedClientIp,
} = await import("../client-attestation");
const { storefrontBuyerRequest } = await import("../config");

const h = (init: Record<string, string>) => new Headers(init);

describe("client-attestation (B2C activation readiness)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("matches the API signature vector byte for byte (StorefrontSignedClientIdentityTest)", () => {
    expect(
      signClientIp(
        "vector-secret",
        "shop.example.com",
        "203.0.113.7",
        1700000000,
      ),
    ).toBe("44c4ddacb69135606fbde789b667b99de9da54ccae492a1438fac51614a3779f");
  });

  describe("trusted source selection", () => {
    it("trusts nothing when no source is configured, whatever the visitor sends", () => {
      const headers = h({
        "x-forwarded-for": "8.8.8.8",
        "x-real-ip": "8.8.4.4",
        "x-vercel-forwarded-for": "1.1.1.1",
      });
      expect(trustedClientIp(undefined, headers)).toBeNull();
      expect(trustedClientIp("", headers)).toBeNull();
      expect(trustedClientIp("garbage", headers)).toBeNull();
    });

    it("reads only the declared header", () => {
      const headers = h({
        "x-forwarded-for": "8.8.8.8",
        "x-real-ip": "8.8.4.4",
        "x-vercel-forwarded-for": "1.1.1.1",
      });
      expect(trustedClientIp("vercel", headers)).toBe("1.1.1.1");
      expect(trustedClientIp("real-ip", headers)).toBe("8.8.4.4");
    });

    it("xff-right:N counts proxies from the RIGHT, so a forged left side is never read", () => {
      // The visitor wrote "6.6.6.6"; the one trusted proxy appended the address it actually saw.
      const headers = h({ "x-forwarded-for": "6.6.6.6, 34.120.1.1" });
      expect(trustedClientIp("xff-right:1", headers)).toBe("34.120.1.1");
      expect(trustedClientIp("xff-right:2", headers)).toBe("6.6.6.6");
      expect(trustedClientIp("xff-right:3", headers)).toBeNull();
      expect(trustedClientIp("xff-right:0", headers)).toBeNull();
    });

    it.each([
      "10.0.0.4",
      "127.0.0.1",
      "192.168.1.5",
      "172.20.0.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "not-an-ip",
      "8.8.8.8:1234",
    ])("discards the non-public or malformed address %s", (value) => {
      expect(trustedClientIp("real-ip", h({ "x-real-ip": value }))).toBeNull();
    });

    it("accepts public IPv4, IPv6 and IPv4-mapped public addresses", () => {
      expect(trustedClientIp("real-ip", h({ "x-real-ip": "34.120.1.1" }))).toBe(
        "34.120.1.1",
      );
      expect(
        trustedClientIp("real-ip", h({ "x-real-ip": "2a00:1450:4001:810::1" })),
      ).toBe("2a00:1450:4001:810::1");
      expect(
        trustedClientIp("real-ip", h({ "x-real-ip": "::ffff:34.120.1.1" })),
      ).toBe("::ffff:34.120.1.1");
      expect(
        trustedClientIp("real-ip", h({ "x-real-ip": "::ffff:10.0.0.1" })),
      ).toBeNull();
    });
  });

  describe("attestation", () => {
    beforeEach(() => vi.stubEnv("STOREFRONT_CLIENT_IP_SOURCE", "real-ip"));

    it("signs host + address + timestamp with the gateway secret", () => {
      const out = clientIpAttestation(
        "gw",
        "shop.example.com",
        h({ "x-real-ip": "34.120.1.1" }),
        1_700_000_000_000,
      );
      expect(out[CLIENT_IP_HEADER]).toBe("34.120.1.1");
      expect(out[CLIENT_IP_TIMESTAMP_HEADER]).toBe("1700000000");
      expect(out[CLIENT_IP_SIGNATURE_HEADER]).toBe(
        signClientIp("gw", "shop.example.com", "34.120.1.1", 1700000000),
      );
    });

    it("is empty without a gateway secret or without a resolvable address", () => {
      expect(
        clientIpAttestation(
          undefined,
          "shop.example.com",
          h({ "x-real-ip": "34.120.1.1" }),
        ),
      ).toEqual({});
      expect(clientIpAttestation("gw", "shop.example.com", h({}))).toEqual({});
    });
  });

  describe("transport (storefrontBuyerRequest)", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
      vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw");
      mocks.headers.mockImplementation(
        async () =>
          new Headers({
            host: "shop.example.com",
            "x-real-ip": "34.120.1.1",
            "x-forwarded-for": "6.6.6.6",
          }),
      );
      fetchMock.mockReset().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
      vi.stubGlobal("fetch", fetchMock);
    });

    it("sends exactly the legacy request when no source is configured (default)", async () => {
      await storefrontBuyerRequest("POST", "auth/login", {
        body: { email: "a@b.test", password: "x" },
      });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers[CLIENT_IP_HEADER]).toBeUndefined();
      expect(init.headers[CLIENT_IP_SIGNATURE_HEADER]).toBeUndefined();
      expect(init.headers["X-Forwarded-For"]).toBeUndefined();
    });

    it("attaches a signed attestation to a mutation when the operator declared a source, and never forwards raw XFF", async () => {
      vi.stubEnv("STOREFRONT_CLIENT_IP_SOURCE", "real-ip");
      await storefrontBuyerRequest("POST", "auth/login", {
        body: { email: "a@b.test", password: "x" },
      });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers[CLIENT_IP_HEADER]).toBe("34.120.1.1");
      expect(init.headers[CLIENT_IP_SIGNATURE_HEADER]).toBe(
        signClientIp(
          "gw",
          "shop.example.com",
          "34.120.1.1",
          Number(init.headers[CLIENT_IP_TIMESTAMP_HEADER]),
        ),
      );
      expect(init.headers["X-Forwarded-For"]).toBeUndefined();
      expect(init.headers["x-forwarded-for"]).toBeUndefined();
    });

    it("does not attest reads", async () => {
      vi.stubEnv("STOREFRONT_CLIENT_IP_SOURCE", "real-ip");
      await storefrontBuyerRequest("GET", "me", { token: "t" });
      expect(
        fetchMock.mock.calls[0][1].headers[CLIENT_IP_HEADER],
      ).toBeUndefined();
    });

    it("an unreadable request scope degrades to no attestation instead of failing the call", async () => {
      vi.stubEnv("STOREFRONT_CLIENT_IP_SOURCE", "real-ip");
      mocks.headers
        .mockImplementationOnce(
          async () => new Headers({ host: "shop.example.com" }),
        ) // host resolution
        .mockRejectedValueOnce(new Error("outside request scope"));
      await storefrontBuyerRequest("POST", "auth/login", { body: {} });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls[0][1].headers[CLIENT_IP_HEADER],
      ).toBeUndefined();
    });
  });
});
