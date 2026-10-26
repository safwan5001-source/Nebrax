import { describe, expect, it } from "vitest";
import { readPolicyAvailability } from "../availability";
import { POLICY_SLUGS } from "../slugs";

describe("readPolicyAvailability (X4-FIX, fail closed)", () => {
  it("always returns all four policies, defaulting to false", () => {
    for (const raw of [undefined, null, "x", 7, [], {}]) {
      const result = readPolicyAvailability(raw);
      expect(Object.keys(result)).toEqual([...POLICY_SLUGS]);
      expect(Object.values(result).every((v) => v === false)).toBe(true);
    }
  });

  it("only a literal true counts; truthy look-alikes and unknown keys are ignored", () => {
    expect(
      readPolicyAvailability({
        "shipping-policy": true,
        "privacy-policy": "true",
        "returns-policy": 1,
        "terms-of-service": null,
        about: true,
        __proto__: { "terms-of-service": true },
      }),
    ).toEqual({
      "shipping-policy": true,
      "privacy-policy": false,
      "returns-policy": false,
      "terms-of-service": false,
    });
  });
});
