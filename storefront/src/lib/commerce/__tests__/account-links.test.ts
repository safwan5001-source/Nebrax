import { describe, expect, it } from "vitest";
import { accountHrefs } from "../account-links";

describe("accountHrefs (H6 Final Closure, L2)", () => {
  it("keeps the Spree-era account pages for ordinary hosts", () => {
    expect(accountHrefs("/sa/ar", false)).toEqual({
      account: "/sa/ar/account",
      orders: "/sa/ar/account/orders",
    });
  });

  it("points a native wholesale host at the native buyer pages", () => {
    expect(accountHrefs("/sa/en", true)).toEqual({
      account: "/sa/en/buyer/membership",
      orders: "/sa/en/buyer/orders",
    });
  });
});
