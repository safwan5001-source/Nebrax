import { describe, expect, it } from "vitest";
import {
  accessStateFromMembership,
  buyerErrorKey,
  buyerFormErrorKey,
  canApply,
  canSeeWholesalePrices,
  catalogGateFromError,
  isMembershipStatus,
  localePathFrom,
  purchaseIssueFromError,
} from "../wholesale-buyer";

describe("catalogGateFromError — only 401/403 are access gates", () => {
  it("401 ⇒ sign in, 403 ⇒ approval required", () => {
    expect(catalogGateFromError({ status: 401 })).toBe("sign_in_required");
    expect(catalogGateFromError({ status: 403 })).toBe("approval_required");
  });

  it.each([
    404, 422, 429, 500, 502,
  ])("%i keeps its existing handling (not a gate)", (status) => {
    expect(catalogGateFromError({ status })).toBeNull();
  });

  it("non-API errors are never a gate", () => {
    expect(catalogGateFromError(new Error("boom"))).toBeNull();
    expect(catalogGateFromError(null)).toBeNull();
    expect(catalogGateFromError(undefined)).toBeNull();
    expect(catalogGateFromError({ status: "401" })).toBeNull();
  });
});

describe("membership → buyer state", () => {
  it("maps every backend status and the never-applied case", () => {
    expect(accessStateFromMembership(null)).toBe("no_application");
    expect(accessStateFromMembership(undefined)).toBe("no_application");
    for (const status of ["pending", "approved", "rejected", "suspended"]) {
      expect(accessStateFromMembership({ status })).toBe(status);
    }
  });

  it("an unknown or malformed status fails closed to unavailable, never approved", () => {
    expect(accessStateFromMembership({ status: "APPROVED" })).toBe(
      "unavailable",
    );
    expect(accessStateFromMembership({ status: "vip" })).toBe("unavailable");
    expect(accessStateFromMembership({})).toBe("unavailable");
    expect(isMembershipStatus(true)).toBe(false);
  });

  it("only approved unlocks prices", () => {
    expect(canSeeWholesalePrices("approved")).toBe(true);
    for (const state of [
      "signed_out",
      "no_application",
      "pending",
      "rejected",
      "suspended",
      "unavailable",
    ] as const) {
      expect(canSeeWholesalePrices(state)).toBe(false);
    }
  });

  it("an application can only be started when none exists", () => {
    expect(canApply("no_application")).toBe(true);
    for (const state of [
      "signed_out",
      "pending",
      "approved",
      "rejected",
      "suspended",
      "unavailable",
    ] as const) {
      expect(canApply(state)).toBe(false);
    }
  });
});

describe("buyerErrorKey — no internal text, sign-in failures indistinguishable", () => {
  it("collapses credential-ish failures to one key", () => {
    expect(buyerErrorKey(401, "unauthenticated")).toBe("invalidCredentials");
    expect(buyerErrorKey(422, "validation_failed")).toBe("invalidCredentials");
    expect(buyerErrorKey(401, undefined)).toBe("invalidCredentials");
  });

  it("rate limiting, unavailable wholesale and anything else", () => {
    expect(buyerErrorKey(429, undefined)).toBe("rateLimited");
    expect(buyerErrorKey(404, "not_found")).toBe("unavailable");
    expect(buyerErrorKey(500, "server_error")).toBe("generic");
    expect(buyerErrorKey(undefined, undefined)).toBe("generic");
  });
});

describe("registration / verification error keys", () => {
  it("a 422 is a validation answer here (unlike sign-in), others keep their own key, no server text ever", () => {
    expect(buyerFormErrorKey(422)).toBe("validation");
    expect(buyerFormErrorKey(429)).toBe("rateLimited");
    expect(buyerFormErrorKey(404)).toBe("unavailable");
    expect(buyerFormErrorKey(500)).toBe("generic");
    expect(buyerFormErrorKey(undefined)).toBe("generic");
  });
});

describe("localePathFrom — only a /xx/yy prefix may travel to the link builder", () => {
  it("accepts a country/locale base path and drops everything else", () => {
    expect(localePathFrom("/sa/ar")).toBe("/sa/ar");
    for (const bad of [
      "",
      "/",
      "/sa",
      "/sa/ar/buyer",
      "//evil.example",
      "https://evil.example",
      "/SA/AR",
      "/sa/ar?x=1",
    ]) {
      expect(localePathFrom(bad)).toBeUndefined();
    }
  });
});

describe("purchaseIssueFromError (H6 Batch K)", () => {
  it("maps a signed-out refusal, a not-approved refusal and an unavailable line to stable keys", () => {
    expect(purchaseIssueFromError({ status: 401 })).toBe("sign_in_required");
    expect(purchaseIssueFromError({ status: 403 })).toBe("approval_required");
    expect(
      purchaseIssueFromError({
        status: 422,
        details: { reason: "unavailable_for_wholesale" },
      }),
    ).toBe("unavailable_for_wholesale");
  });

  it("leaves every other failure alone so DTC handling is unchanged", () => {
    expect(purchaseIssueFromError({ status: 422 })).toBeNull();
    expect(
      purchaseIssueFromError({ status: 422, details: { reason: "other" } }),
    ).toBeNull();
    expect(purchaseIssueFromError({ status: 404 })).toBeNull();
    expect(
      purchaseIssueFromError({ status: 409, code: "review_required" }),
    ).toBeNull();
    expect(purchaseIssueFromError({ status: 500 })).toBeNull();
    expect(purchaseIssueFromError(new Error("boom"))).toBeNull();
    expect(purchaseIssueFromError(null)).toBeNull();
    expect(purchaseIssueFromError(undefined)).toBeNull();
  });
});
