import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getBuyerToken: vi.fn(),
  setBuyerToken: vi.fn(),
  clearBuyerToken: vi.fn(),
}));

vi.mock("@/lib/commerce/buyer-session", () => ({
  getBuyerToken: mocks.getBuyerToken,
  setBuyerToken: mocks.setBuyerToken,
  clearBuyerToken: mocks.clearBuyerToken,
}));

vi.mock("@/lib/commerce/config", async () => {
  class StorefrontApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { StorefrontApiError, storefrontBuyerRequest: mocks.request };
});

const { StorefrontApiError } = await import("@/lib/commerce/config");
const { signInBuyer, signOutBuyer, applyForWholesale, getBuyerAccess } =
  await import("../wholesale-buyer");

describe("wholesale buyer server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBuyerToken.mockResolvedValue(undefined);
  });

  it("sign-in stores the token server-side and returns nothing but success", async () => {
    mocks.request.mockResolvedValue({ data: { token: "secret-token" } });

    const result = await signInBuyer("b@x.test", "pw");

    expect(result).toEqual({ success: true });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(mocks.setBuyerToken).toHaveBeenCalledWith("secret-token");
    expect(mocks.request).toHaveBeenCalledWith("POST", "auth/login", {
      body: { email: "b@x.test", password: "pw" },
    });
  });

  it("every sign-in failure is one indistinguishable key and sets no cookie", async () => {
    for (const status of [401, 422]) {
      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(status, "whatever", "internal detail"),
      );
      const result = await signInBuyer("b@x.test", "pw");
      expect(result).toEqual({ success: false, error: "invalidCredentials" });
    }
    mocks.request.mockRejectedValueOnce(
      new StorefrontApiError(429, "rate_limited", "x"),
    );
    expect(await signInBuyer("b@x.test", "pw")).toEqual({
      success: false,
      error: "rateLimited",
    });
    mocks.request.mockResolvedValueOnce({ data: {} });
    expect(await signInBuyer("b@x.test", "pw")).toEqual({
      success: false,
      error: "generic",
    });
    expect(mocks.setBuyerToken).not.toHaveBeenCalled();
  });

  it("sign-out revokes the session and always clears the cookie, even if the API call fails", async () => {
    mocks.getBuyerToken.mockResolvedValue("tok");
    mocks.request.mockRejectedValue(new Error("network"));

    await signOutBuyer();

    expect(mocks.request).toHaveBeenCalledWith("POST", "auth/logout", {
      token: "tok",
    });
    expect(mocks.clearBuyerToken).toHaveBeenCalledOnce();
  });

  it("applying without a session never calls the API", async () => {
    expect(await applyForWholesale()).toEqual({
      success: false,
      error: "invalidCredentials",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("applying uses the buyer's own token only", async () => {
    mocks.getBuyerToken.mockResolvedValue("tok");
    mocks.request.mockResolvedValue({ data: {} });

    expect(await applyForWholesale()).toEqual({ success: true });
    expect(mocks.request).toHaveBeenCalledWith(
      "POST",
      "wholesale/application",
      {
        token: "tok",
      },
    );
  });

  describe("getBuyerAccess", () => {
    const withToken = () => mocks.getBuyerToken.mockResolvedValue("tok");

    it("no session ⇒ signed out, with no API call", async () => {
      expect(await getBuyerAccess()).toEqual({
        state: "signed_out",
        displayName: null,
      });
      expect(mocks.request).not.toHaveBeenCalled();
    });

    it.each([
      [null, "no_application"],
      [{ status: "pending" }, "pending"],
      [{ status: "approved" }, "approved"],
      [{ status: "rejected" }, "rejected"],
      [{ status: "suspended" }, "suspended"],
      [{ status: "garbage" }, "unavailable"],
    ])("membership %j ⇒ %s", async (membership, expected) => {
      withToken();
      mocks.request.mockImplementation(async (_m: string, path: string) =>
        path === "me"
          ? { data: { customer: { display_name: "Buyer One" } } }
          : { data: { membership } },
      );

      expect(await getBuyerAccess()).toEqual({
        state: expected,
        displayName: "Buyer One",
      });
    });

    it("an expired/invalid session (401) is signed out; a host without wholesale (404) is unavailable", async () => {
      withToken();
      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(401, "unauthenticated", "x"),
      );
      expect((await getBuyerAccess()).state).toBe("signed_out");

      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(404, "not_found", "x"),
      );
      expect((await getBuyerAccess()).state).toBe("unavailable");
    });

    it("any other failure fails closed to unavailable, never approved", async () => {
      withToken();
      mocks.request.mockRejectedValue(new Error("boom"));
      expect((await getBuyerAccess()).state).toBe("unavailable");
    });
  });
});
