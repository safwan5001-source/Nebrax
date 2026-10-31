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
      public readonly details?: unknown,
    ) {
      super(message);
    }
  }
  return { StorefrontApiError, storefrontBuyerRequest: mocks.request };
});

const { StorefrontApiError } = await import("@/lib/commerce/config");
const {
  signInBuyer,
  signOutBuyer,
  applyForWholesale,
  getBuyerAccess,
  registerBuyer,
  verifyBuyerEmail,
  resendBuyerVerification,
  requestBuyerPasswordReset,
  resetBuyerPassword,
  getBuyerOrders,
  getBuyerOrder,
} = await import("../wholesale-buyer");

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

describe("registration and verification actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBuyerToken.mockResolvedValue(undefined);
  });

  it("register posts the form with only a validated locale prefix, sets no session and returns no token", async () => {
    mocks.request.mockResolvedValue({ data: { verification_required: true } });

    const result = await registerBuyer({
      displayName: "Ann",
      email: "a@x.test",
      password: "pw-123456",
      basePath: "/sa/ar",
    });

    expect(result).toEqual({ success: true });
    expect(mocks.request).toHaveBeenCalledWith("POST", "auth/register", {
      body: {
        display_name: "Ann",
        email: "a@x.test",
        password: "pw-123456",
        locale_path: "/sa/ar",
      },
    });
    expect(mocks.setBuyerToken).not.toHaveBeenCalled();
  });

  it("a hostile base path never reaches the API as a link prefix", async () => {
    mocks.request.mockResolvedValue({ data: {} });

    await registerBuyer({
      displayName: "A",
      email: "a@x.test",
      password: "pw-123456",
      basePath: "//evil.example",
    });
    await resendBuyerVerification({
      email: "a@x.test",
      basePath: "https://evil.example",
    });

    for (const call of mocks.request.mock.calls) {
      expect(call[2].body.locale_path).toBeUndefined();
    }
  });

  it("verify sends only the token and maps every failure to a key, never server text", async () => {
    mocks.request.mockResolvedValueOnce({ data: { verified: true } });
    expect(await verifyBuyerEmail("t".repeat(64))).toEqual({ success: true });
    expect(mocks.request).toHaveBeenCalledWith("POST", "auth/verify-email", {
      body: { token: "t".repeat(64) },
    });

    mocks.request.mockRejectedValueOnce(
      new StorefrontApiError(422, "validation_failed", "internal detail"),
    );
    expect(await verifyBuyerEmail("x")).toEqual({
      success: false,
      error: "validation",
    });
    mocks.request.mockRejectedValueOnce(
      new StorefrontApiError(429, "rate_limited", "x"),
    );
    expect(await verifyBuyerEmail("x")).toEqual({
      success: false,
      error: "rateLimited",
    });
    mocks.request.mockRejectedValueOnce(new Error("boom"));
    expect(await verifyBuyerEmail("x")).toEqual({
      success: false,
      error: "generic",
    });
  });

  it("resend is a plain success for the caller whatever the address (the API answers neutrally)", async () => {
    mocks.request.mockResolvedValue({ data: { verification_required: true } });

    expect(
      await resendBuyerVerification({
        email: "ghost@x.test",
        basePath: "/sa/en",
      }),
    ).toEqual({ success: true });
    expect(mocks.request).toHaveBeenCalledWith(
      "POST",
      "auth/verification/resend",
      {
        body: { email: "ghost@x.test", locale_path: "/sa/en" },
      },
    );
  });

  describe("H6 Batch M — application context, password reset, order history", () => {
    it("an application sends only the optional company/phone and never a partner, price list or identity", async () => {
      mocks.getBuyerToken.mockResolvedValue("tok");
      mocks.request.mockResolvedValue({ data: {} });

      await applyForWholesale({
        companyName: "  Horizon Co ",
        contactPhone: " +966501234567 ",
      });

      expect(mocks.request).toHaveBeenCalledWith(
        "POST",
        "wholesale/application",
        {
          token: "tok",
          body: { company_name: "Horizon Co", contact_phone: "+966501234567" },
        },
      );
      const sent = JSON.stringify(mocks.request.mock.calls[0]);
      for (const forbidden of ["partner", "price_list", "tenant", "identity"]) {
        expect(sent).not.toContain(forbidden);
      }

      mocks.request.mockClear();
      await applyForWholesale({ companyName: "   ", contactPhone: "" });
      expect(mocks.request).toHaveBeenCalledWith(
        "POST",
        "wholesale/application",
        {
          token: "tok",
        },
      );
    });

    it("a 422 on apply is a field problem, not bad credentials", async () => {
      mocks.getBuyerToken.mockResolvedValue("tok");
      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(422, "validation_failed", "x"),
      );
      expect(await applyForWholesale({ contactPhone: "<script>" })).toEqual({
        success: false,
        error: "validation",
      });
    });

    it("the reset request is neutral and carries only the email and a locale path", async () => {
      mocks.request.mockResolvedValue({ data: { reset_requested: true } });
      expect(
        await requestBuyerPasswordReset({
          email: "b@x.test",
          basePath: "/sa/ar",
        }),
      ).toEqual({ success: true });
      expect(mocks.request).toHaveBeenCalledWith(
        "POST",
        "auth/password/forgot",
        {
          body: { email: "b@x.test", locale_path: "/sa/ar" },
        },
      );
    });

    it("a reset spends the token, clears this browser's session cookie and returns no token", async () => {
      mocks.request.mockResolvedValue({ data: { password_reset: true } });
      const result = await resetBuyerPassword({
        token: "t".repeat(64),
        password: "new-password-1",
      });
      expect(result).toEqual({ success: true });
      expect(mocks.clearBuyerToken).toHaveBeenCalled();
      expect(mocks.setBuyerToken).not.toHaveBeenCalled();
    });

    it("a failed reset keeps the cookie and is one generic validation failure", async () => {
      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(422, "validation_failed", "internal"),
      );
      const result = await resetBuyerPassword({
        token: "t".repeat(64),
        password: "new-password-1",
      });
      expect(result).toEqual({ success: false, error: "validation" });
      expect(mocks.clearBuyerToken).not.toHaveBeenCalled();
    });

    it("order history uses only the verified session and maps public fields", async () => {
      mocks.getBuyerToken.mockResolvedValue("tok");
      mocks.request.mockResolvedValue({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            number: "CORD-1",
            status: "confirmed",
            total: { amount_minor: 1600, currency: "SAR" },
            created_at: null,
          },
          { id: "broken" },
        ],
        meta: { pagination: { page: 1, last_page: 3 } },
      });

      const result = await getBuyerOrders(2);

      expect(mocks.request).toHaveBeenCalledWith("GET", "buyer/orders?page=2", {
        token: "tok",
      });
      expect(result).toMatchObject({
        kind: "ok",
        data: { page: 1, lastPage: 3 },
      });
      expect(result.kind === "ok" && result.data.orders).toHaveLength(1);
    });

    it("order history without a session never calls the API; refusals map to states, not errors", async () => {
      expect(await getBuyerOrders()).toEqual({ kind: "signed_out" });
      expect(mocks.request).not.toHaveBeenCalled();

      mocks.getBuyerToken.mockResolvedValue("tok");
      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(401, "unauthenticated", "x"),
      );
      expect(await getBuyerOrders()).toEqual({ kind: "signed_out" });

      const suspended = new StorefrontApiError(403, "forbidden", "x", {
        membership_status: "suspended",
      });
      mocks.request.mockRejectedValueOnce(suspended);
      expect(await getBuyerOrders()).toEqual({
        kind: "not_approved",
        membership: "suspended",
      });

      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(500, "server_error", "x"),
      );
      expect(await getBuyerOrders()).toEqual({ kind: "unavailable" });
    });

    it("an order detail validates the id shape locally and treats someone else's order as plainly not found", async () => {
      mocks.getBuyerToken.mockResolvedValue("tok");
      expect(await getBuyerOrder("../../etc/passwd")).toEqual({
        kind: "not_found",
      });
      expect(mocks.request).not.toHaveBeenCalled();

      mocks.request.mockRejectedValueOnce(
        new StorefrontApiError(404, "not_found", "x"),
      );
      expect(
        await getBuyerOrder("11111111-1111-4111-8111-111111111111"),
      ).toEqual({ kind: "not_found" });
    });
  });
});
