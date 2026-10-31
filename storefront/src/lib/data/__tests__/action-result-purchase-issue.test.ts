import { describe, expect, it } from "vitest";
import { StorefrontApiError } from "@/lib/commerce/config";
import { actionResult } from "../utils";

describe("actionResult — wholesale purchase issue is additive (H6 Batch K)", () => {
  it("a wholesale refusal carries the stable key next to the unchanged error text", async () => {
    const signedOut = await actionResult(async () => {
      throw new StorefrontApiError(401, "unauthenticated", "backend text");
    }, "fallback");
    const unavailable = await actionResult(async () => {
      throw new StorefrontApiError(422, "validation_failed", "no price", {
        reason: "unavailable_for_wholesale",
      });
    }, "fallback");

    expect(signedOut).toEqual({
      success: false,
      error: "backend text",
      purchaseIssue: "sign_in_required",
    });
    expect(unavailable).toMatchObject({
      success: false,
      purchaseIssue: "unavailable_for_wholesale",
    });
  });

  it("every other failure is byte-identical to before: no extra key", async () => {
    const generic = await actionResult(async () => {
      throw new Error("plain");
    }, "fallback");
    const dtcValidation = await actionResult(async () => {
      throw new StorefrontApiError(422, "validation_failed", "bad quantity");
    }, "fallback");
    const nonError = await actionResult(async () => {
      throw "x";
    }, "fallback");

    expect(generic).toEqual({ success: false, error: "plain" });
    expect(dtcValidation).toEqual({ success: false, error: "bad quantity" });
    expect(nonError).toEqual({ success: false, error: "fallback" });
    expect(Object.keys(generic)).not.toContain("purchaseIssue");
  });

  it("success results are untouched", async () => {
    expect(await actionResult(async () => ({ cart: 1 }), "f")).toEqual({
      success: true,
      cart: 1,
    });
  });
});
