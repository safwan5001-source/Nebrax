import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B2C-ACCOUNTS — the customer-account server actions. They forward to the Host-resolved `store/v1` identity API, keep the
 * session token ONLY in an HttpOnly cookie, never return the token or upstream text, send no owner/tenant id of their own
 * and refuse everything when the host does not state `customer_accounts: true`.
 */
const jar = vi.hoisted(
  () => new Map<string, { value: string; options: Record<string, unknown> }>(),
);
const request = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name)?.value } : undefined,
    set: (
      name: string,
      value: string,
      options: Record<string, unknown> = {},
    ) => {
      if (options.maxAge === 0) jar.delete(name);
      else jar.set(name, { value, options });
    },
  }),
}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/commerce/storefront", () => ({ fetchStorefrontConfig: config }));
vi.mock("@/lib/commerce/config", async () => {
  class StorefrontApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  }
  return { StorefrontApiError, storefrontBuyerRequest: request };
});

import { StorefrontApiError } from "@/lib/commerce/config";
import {
  changePassword,
  claimOrder,
  deleteAddress,
  getOrder,
  listAddresses,
  listOrders,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  saveAddress,
  syncSession,
  updateProfile,
  verifyEmail,
} from "@/lib/data/customer";

const ID = "11111111-2222-3333-4444-555555555555";
const customerRow = {
  id: "c1",
  display_name: "Sara Al Otaibi",
  email: "sara@shop.test",
  phone: "+966501234567",
};
const apiError = (status: number, text = "SECRET internal detail") =>
  new StorefrontApiError(status, "x", text);

function open(on = true) {
  config.mockResolvedValue({
    capabilities: { wholesaleBuyer: false, customerAccounts: on },
  });
}

beforeEach(() => {
  jar.clear();
  request.mockReset();
  config.mockReset();
  open(true);
});

describe("a host without customer accounts", () => {
  beforeEach(() => open(false));

  it("refuses every public action with a typed code and makes no identity request", async () => {
    const results = [
      await login("a@b.sa", "secret123"),
      await register({
        email: "a@b.sa",
        password: "secret123",
        first_name: "A",
      }),
      await requestPasswordReset("a@b.sa"),
      await resetPassword("t".repeat(64), "secret123"),
      await verifyEmail("t".repeat(64)),
    ];
    for (const r of results) {
      expect(r).toEqual({ success: false, code: "capability_unavailable" });
    }
    expect(await syncSession()).toEqual({
      available: false,
      customer: null,
      refreshed: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed when the capability read itself fails", async () => {
    config.mockRejectedValue(new Error("boom"));
    expect((await syncSession()).available).toBe(false);
    expect(await login("a@b.sa", "x")).toMatchObject({
      code: "capability_unavailable",
    });
  });
});

describe("login", () => {
  it("stores the token in an HttpOnly SameSite=Lax cookie, persistent for the API-reported lifetime, and never returns it", async () => {
    request.mockResolvedValue({
      data: { token: "tok-123", customer: customerRow, session_days: 30 },
    });

    const result = await login("sara@shop.test", "pw-123456", true);

    expect(result).toEqual({
      success: true,
      user: {
        id: "c1",
        email: "sara@shop.test",
        first_name: "Sara",
        last_name: "Al Otaibi",
        phone: "+966501234567",
      },
    });
    expect(JSON.stringify(result)).not.toContain("tok-123");
    expect(request).toHaveBeenCalledWith("POST", "auth/login", {
      body: { email: "sara@shop.test", password: "pw-123456", remember: true },
    });
    const session = jar.get("awj_account_session");
    expect(session?.value).toBe("tok-123");
    expect(session?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });
    // the presence hint is NOT a credential and is JS-readable
    expect(jar.get("awj_account_hint")?.value).toBe("1");
    expect(jar.get("awj_account_hint")?.options.httpOnly).toBe(false);
  });

  it("without 'remember me' the cookie is a browser-session cookie (no maxAge)", async () => {
    request.mockResolvedValue({
      data: { token: "tok-1", customer: customerRow, session_days: 1 },
    });
    await login("sara@shop.test", "pw-123456", false);
    expect(jar.get("awj_account_session")?.options).not.toHaveProperty(
      "maxAge",
    );
    expect(request).toHaveBeenCalledWith(
      "POST",
      "auth/login",
      expect.objectContaining({
        body: expect.objectContaining({ remember: false }),
      }),
    );
  });

  it("a missing lifetime is never promoted to a persistent cookie", async () => {
    request.mockResolvedValue({
      data: { token: "tok-1", customer: customerRow },
    });
    await login("sara@shop.test", "pw-123456", true);
    expect(jar.get("awj_account_session")?.options).not.toHaveProperty(
      "maxAge",
    );
  });

  it("maps failures to a safe code without upstream text and sets no cookie", async () => {
    for (const [status, code] of [
      [422, "invalid_credentials"],
      [401, "invalid_credentials"],
      [429, "rate_limited"],
      [500, "request_failed"],
    ] as const) {
      request.mockRejectedValueOnce(apiError(status));
      const result = await login("a@b.sa", "secret123");
      expect(result).toEqual({ success: false, code });
      expect(JSON.stringify(result)).not.toMatch(/SECRET/);
    }
    expect(jar.size).toBe(0);
  });
});

describe("register", () => {
  it("sends one display name, never signs in and never sets a cookie", async () => {
    request.mockResolvedValue({ data: { verification_required: true } });
    const result = await register({
      email: "a@b.sa",
      password: "secret123",
      password_confirmation: "secret123",
      first_name: "Sara",
      last_name: "Al Otaibi",
      basePath: "/sa/ar",
    });
    expect(result).toEqual({ success: true, verificationRequired: true });
    expect(request).toHaveBeenCalledWith("POST", "auth/register", {
      body: {
        display_name: "Sara Al Otaibi",
        email: "a@b.sa",
        password: "secret123",
        locale_path: "/sa/ar",
      },
    });
    expect(jar.size).toBe(0);
  });

  it("rejects a mismatching confirmation or an empty name before any request", async () => {
    expect(
      await register({
        email: "a@b.sa",
        password: "secret123",
        password_confirmation: "other",
        first_name: "A",
      }),
    ).toEqual({ success: false, code: "password_mismatch" });
    expect(await register({ email: "a@b.sa", password: "secret123" })).toEqual({
      success: false,
      code: "validation_failed",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("never lets a client-supplied tenant or owner id travel in the body", async () => {
    request.mockResolvedValue({ data: {} });
    await register({
      email: "a@b.sa",
      password: "secret123",
      first_name: "A",
      ...({ tenant_id: "x", customer_identity_id: "y" } as object),
    });
    const body = request.mock.calls[0][2].body;
    expect(Object.keys(body).sort()).toEqual([
      "display_name",
      "email",
      "password",
    ]);
  });
});

describe("recovery and verification", () => {
  it("password reset clears this browser's session cookies after the API ended every session", async () => {
    jar.set("awj_account_session", { value: "old", options: {} });
    request.mockResolvedValue({ data: { password_reset: true } });
    expect(await resetPassword("t".repeat(64), "brand-new-1")).toEqual({
      success: true,
    });
    expect(jar.has("awj_account_session")).toBe(false);
  });

  it("a bad/expired link is one generic invalid_token", async () => {
    request.mockRejectedValue(apiError(422));
    expect(await resetPassword("x", "brand-new-1")).toEqual({
      success: false,
      code: "invalid_token",
    });
    expect(await verifyEmail("x")).toEqual({
      success: false,
      code: "invalid_token",
    });
  });

  it("the reset request is neutral and passes only the locale path (never a host)", async () => {
    request.mockResolvedValue({ data: { reset_requested: true } });
    expect(
      await requestPasswordReset("a@b.sa", "https://evil.test/r", "/sa/ar"),
    ).toEqual({ success: true });
    expect(request).toHaveBeenCalledWith("POST", "auth/password/forgot", {
      body: { email: "a@b.sa", locale_path: "/sa/ar" },
    });
  });
});

describe("session sync and sign out", () => {
  it("returns the signed-in customer for a valid session", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockResolvedValue({ data: { customer: customerRow } });
    const result = await syncSession();
    expect(result.available).toBe(true);
    expect(result.customer?.email).toBe("sara@shop.test");
    expect(request).toHaveBeenCalledWith("GET", "account/profile", {
      token: "tok",
    });
  });

  it("no cookie ⇒ anonymous with no profile request", async () => {
    expect(await syncSession()).toEqual({
      available: true,
      customer: null,
      refreshed: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("a rejected token clears the cookies; a transient failure keeps them", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockRejectedValueOnce(apiError(500));
    expect(await syncSession()).toMatchObject({ customer: null, stale: true });
    expect(jar.has("awj_account_session")).toBe(true);

    request.mockRejectedValueOnce(apiError(401));
    expect(await syncSession()).toMatchObject({ customer: null });
    expect(jar.has("awj_account_session")).toBe(false);
  });

  it("logout revokes the session server-side and always drops the cookies, even if the API is down", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    jar.set("awj_account_hint", { value: "1", options: {} });
    request.mockRejectedValue(apiError(503));
    await expect(logout()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith("POST", "auth/logout", {
      token: "tok",
    });
    expect(jar.size).toBe(0);
  });
});

describe("authenticated actions", () => {
  it("are signed_out without a session and make no request", async () => {
    for (const result of [
      await listOrders(),
      await listAddresses(),
      await updateProfile({ displayName: "A" }),
      await changePassword({ currentPassword: "a", newPassword: "b" }),
    ]) {
      expect(result).toEqual({ kind: "signed_out" });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("send the server-held token and never an owner id; a 401 ends the session", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockResolvedValueOnce({
      data: [],
      meta: { pagination: { page: 2, last_page: 3 } },
    });
    expect(await listOrders(2)).toEqual({
      kind: "ok",
      data: { orders: [], page: 2, lastPage: 3 },
    });
    expect(request).toHaveBeenCalledWith("GET", "account/orders?page=2", {
      token: "tok",
    });

    request.mockRejectedValueOnce(apiError(401));
    expect(await listOrders()).toEqual({ kind: "signed_out" });
    expect(jar.has("awj_account_session")).toBe(false);
  });

  it("refuse a malformed id before any request (no probing through path tricks)", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    for (const bad of ["../x", "1;drop", "", "not-a-uuid/../../me"]) {
      expect(await getOrder(bad)).toEqual({ kind: "not_found" });
      expect(await deleteAddress(bad)).toEqual({ kind: "not_found" });
      expect(
        await saveAddress(
          {
            recipient_name: "a",
            phone: "+966500000000",
            country: "SA",
            city: "c",
            street: "s",
          },
          bad,
        ),
      ).toEqual({ kind: "not_found" });
    }
    expect(await revokeSession("../1")).toEqual({ kind: "not_found" });
    expect(request).not.toHaveBeenCalled();
  });

  it("an order the API reports as not found is just not_found (another customer's id is indistinguishable)", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockRejectedValue(apiError(404));
    expect(await getOrder(ID)).toEqual({ kind: "not_found" });
  });

  it("address saves use an allow-listed body: no owner/tenant keys, blanks dropped, country upper-cased", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockResolvedValue({
      data: {
        id: ID,
        recipient_name: "A",
        phone: "+966500000000",
        country: "SA",
        city: "c",
        street: "s",
      },
    });
    await saveAddress({
      recipient_name: " A ",
      phone: "+966500000000",
      country: "sa",
      city: "c",
      street: "s",
      label: "  ",
      delivery_notes: "",
      ...({ customer_identity_id: "evil", tenant_id: "evil" } as object),
    } as never);
    const body = request.mock.calls[0][2].body;
    // owner/tenant keys never travel; blank OPTIONAL fields are explicit nulls so an edit can really clear them
    expect(body).toEqual({
      recipient_name: "A",
      phone: "+966500000000",
      country: "SA",
      city: "c",
      street: "s",
      label: null,
      delivery_notes: null,
    });
  });

  it("a validation/rate-limit answer surfaces as a safe code, not upstream text", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockRejectedValueOnce(apiError(422));
    const result = await changePassword({
      currentPassword: "a",
      newPassword: "b",
    });
    expect(result).toEqual({ kind: "invalid", code: "validation_failed" });
    request.mockRejectedValueOnce(apiError(429));
    expect(await claimOrder({ orderNumber: "CORD-1" })).toEqual({
      kind: "invalid",
      code: "rate_limited",
    });
  });

  it("claim sends only the order number (+ optional signed reference) — never an identity", async () => {
    jar.set("awj_account_session", { value: "tok", options: {} });
    request.mockResolvedValue({
      data: {
        order: {
          id: ID,
          number: "CORD-1",
          total: { amount_minor: 100, currency: "SAR" },
        },
      },
    });
    const result = await claimOrder({
      orderNumber: " CORD-1 ",
      orderReference: "v1.abc",
    });
    expect(result.kind).toBe("ok");
    expect(request).toHaveBeenCalledWith("POST", "account/orders/claim", {
      token: "tok",
      body: { order_number: "CORD-1", order_reference: "v1.abc" },
    });
    expect(await claimOrder({ orderNumber: "   " })).toEqual({
      kind: "not_found",
    });
  });
});

describe("module hygiene", () => {
  it("imports no Spree wrapper or SDK and never reads the token back into a return value", () => {
    const source = readFileSync(join(__dirname, "../customer.ts"), "utf-8");
    expect(source).not.toMatch(/@\/lib\/spree|@spree\//);
    expect(source).not.toMatch(
      /token:\s*(token|response\.data\??\.token)\s*[,}]\s*\n?\s*(customer|user)/,
    );
  });
});
