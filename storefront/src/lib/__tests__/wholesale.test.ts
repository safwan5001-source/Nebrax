import { describe, expect, it } from "vitest";
import type { StoreCustomer } from "@/lib/commerce/types";
import {
  isWholesaleApproved,
  WHOLESALE_GROUP_NAME,
  wholesaleSignInHref,
} from "../wholesale";

function customerIn(...groupNames: string[]): StoreCustomer {
  return {
    id: "cus_1",
    email: "buyer@example.com",
    first_name: null,
    last_name: null,
    phone: null,
    accepts_email_marketing: false,
    full_name: "Buyer",
    available_store_credit_total: "0",
    display_available_store_credit_total: "0",
    addresses: [],
    default_billing_address: null,
    default_shipping_address: null,
    customer_groups: groupNames.map((name, i) => ({ id: `g${i}`, name })),
  };
}

describe("isWholesaleApproved", () => {
  it("is false for a guest", () => {
    expect(isWholesaleApproved(null)).toBe(false);
  });

  it("is false for a signed-in customer in no group or an unrelated group", () => {
    expect(isWholesaleApproved(customerIn())).toBe(false);
    expect(isWholesaleApproved(customerIn("VIP", "Retail"))).toBe(false);
  });

  it("is true only for exact membership of the wholesale group", () => {
    expect(isWholesaleApproved(customerIn(WHOLESALE_GROUP_NAME))).toBe(true);
    expect(isWholesaleApproved(customerIn("VIP", WHOLESALE_GROUP_NAME))).toBe(
      true,
    );
  });

  it("does not treat a look-alike group name as approval", () => {
    expect(isWholesaleApproved(customerIn("wholesale"))).toBe(false);
    expect(isWholesaleApproved(customerIn("Wholesale "))).toBe(false);
    expect(isWholesaleApproved(customerIn("Wholesale Applicants"))).toBe(false);
  });

  it("fails closed when the customer carries no group list", () => {
    const noGroups = {
      ...customerIn(),
      customer_groups: undefined,
    } as unknown as StoreCustomer;
    expect(isWholesaleApproved(noGroups)).toBe(false);
  });
});

describe("wholesaleSignInHref", () => {
  const basePath = "/us/en";

  it("points at the dedicated sign-in page", () => {
    expect(wholesaleSignInHref(basePath)).toBe("/us/en/wholesale/sign-in");
  });

  it("carries a return target", () => {
    expect(
      wholesaleSignInHref(basePath, "/us/en/wholesale/products/mug?ref=grid"),
    ).toBe(
      "/us/en/wholesale/sign-in?redirect=%2Fus%2Fen%2Fwholesale%2Fproducts%2Fmug%3Fref%3Dgrid",
    );
  });

  it("drops a stale redirect instead of nesting it", () => {
    expect(
      wholesaleSignInHref(
        basePath,
        "/us/en/wholesale?redirect=%2Fus%2Fen%2Fwholesale",
      ),
    ).toBe("/us/en/wholesale/sign-in?redirect=%2Fus%2Fen%2Fwholesale");
  });

  it.each([
    "https://example.com/us/en/wholesale",
    "//example.com",
    "/us/en/wholesale/sign-in",
    null,
  ])("omits an unusable return target: %s", (returnTo) => {
    expect(wholesaleSignInHref(basePath, returnTo)).toBe(
      "/us/en/wholesale/sign-in",
    );
  });
});
