import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SPREE-X1 — with buyer authentication gated (the shipped default), no buyer
 * account action may reach the Spree client or leak internal detail.
 *
 * `getClient` / `getClientForSurface` / `withAuthRefresh` throw if touched, and
 * SPREE_* are explicitly unset: any regression that routes an account action
 * back through Spree fails here.
 */
const spreeTouched = vi.fn();

vi.mock("@/lib/spree", () => {
  const boom = () => {
    spreeTouched();
    throw new Error(
      "Spree client is not available (SPREE_API_URL leaked internal detail)",
    );
  };
  return {
    getClient: boom,
    getClientForSurface: boom,
    withAuthRefresh: boom,
    ensureFreshSession: vi.fn(async () => {
      spreeTouched();
      return "valid";
    }),
    isAuthError: () => false,
    getAccessToken: vi.fn().mockResolvedValue(undefined),
    setAccessToken: vi.fn(),
    clearAccessToken: vi.fn(),
    clearAuthCookies: vi.fn(),
    getRefreshToken: vi.fn().mockResolvedValue("legacy-refresh"),
    setRefreshToken: vi.fn(),
    clearRefreshToken: vi.fn(),
    getCartToken: vi.fn().mockResolvedValue(undefined),
    getCartId: vi.fn().mockResolvedValue(undefined),
    clearCartCookies: vi.fn(),
    clearAllCartCookies: vi.fn(),
    cacheTagSuffix: (surface: string) =>
      surface === "wholesale" ? "-wholesale" : "",
    SURFACES: ["dtc", "wholesale"] as const,
  };
});

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));

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
import * as spree from "@/lib/spree";

describe("buyer account actions while ACCOUNT_AUTH_CAPABILITY is gated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SPREE_API_URL", "");
    vi.stubEnv("SPREE_PUBLISHABLE_KEY", "");
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

  it("logout clears local cookies without building the Spree client", async () => {
    await expect(logout()).resolves.toBeUndefined();
    expect(spree.clearAccessToken).toHaveBeenCalled();
    expect(spree.clearRefreshToken).toHaveBeenCalled();
    expect(spree.clearAllCartCookies).toHaveBeenCalled();
  });

  it("never touches the Spree client or session helpers", async () => {
    await login("a@b.sa", "x");
    await register({
      email: "a@b.sa",
      password: "x",
      password_confirmation: "x",
    });
    await requestPasswordReset("a@b.sa");
    await resetPassword("t", "x", "x");
    await updateCustomer({});
    await getCustomer();
    await syncSession();
    await logout();
    expect(spreeTouched).not.toHaveBeenCalled();
  });
});
