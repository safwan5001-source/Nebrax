import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * With buyer authentication gated (the shipped default and the only implemented state — there is no buyer-identity
 * backend yet), every buyer account action refuses with a typed code, reaches no upstream client and leaks no
 * internal detail. The module itself must not import any Spree code, so a regression that wires an account action
 * back to a commerce SDK fails here.
 */
const cookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet }),
}));

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT_AUTH_CAPABILITY } from "@/lib/commerce/capabilities";
import {
  getCustomer,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  syncSession,
  updateCustomer,
} from "@/lib/data/customer";

describe("buyer account actions while ACCOUNT_AUTH_CAPABILITY is gated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ships as gated", () => {
    expect(ACCOUNT_AUTH_CAPABILITY).toBe("gated");
  });

  it("login refuses with a typed code and no internal text", async () => {
    const result = await login("a@b.sa", "secret1");
    expect(result).toEqual({ success: false, code: "capability_unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/spree|SPREE_|configured/i);
  });

  it("register refuses with a typed code and no internal text", async () => {
    const result = await register({
      email: "a@b.sa",
      password: "secret1",
      password_confirmation: "secret1",
    });
    expect(result).toEqual({ success: false, code: "capability_unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/spree|SPREE_|configured/i);
  });

  it("password recovery and profile update refuse", async () => {
    expect(await requestPasswordReset("a@b.sa", "https://x/r")).toEqual({
      success: false,
      code: "capability_unavailable",
    });
    expect(await resetPassword("tok", "secret1", "secret1")).toEqual({
      success: false,
      code: "capability_unavailable",
    });
    expect(await updateCustomer({ first_name: "A" })).toEqual({
      success: false,
      code: "capability_unavailable",
    });
  });

  it("session reads are anonymous and never reconcile with Spree", async () => {
    expect(await getCustomer()).toBeNull();
    expect(await syncSession()).toEqual({ customer: null, refreshed: false });
  });

  it("logout expires the account-session cookies and any leftover legacy cookie", async () => {
    await expect(logout()).resolves.toBeUndefined();
    const expired = cookieSet.mock.calls.map((c) => c[0]);
    expect(expired).toEqual(
      expect.arrayContaining([
        "awj_account_session",
        "awj_account_refresh",
        "_spree_jwt",
        "_spree_refresh_token",
        "_spree_cart_token",
        "_spree_cart_token_id",
        "_spree_wholesale_cart_token",
        "_spree_wholesale_cart_token_id",
      ]),
    );
    for (const call of cookieSet.mock.calls) {
      expect(call[2]).toMatchObject({ path: "/", maxAge: 0 });
      expect(call[0]).toBeTypeOf("string");
    }
  });

  it("the module imports no Spree wrapper or SDK", () => {
    const source = readFileSync(join(__dirname, "../customer.ts"), "utf-8");
    expect(source).not.toMatch(/@\/lib\/spree|@spree\//);
  });
});
