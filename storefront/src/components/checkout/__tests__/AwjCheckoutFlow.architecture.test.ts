import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COM-CHECKOUT-1C — structural guards, not DOM assertions:
 *
 * 1. The AWJ-native checkout flow must never import the Spree/wholesale
 *    checkout data layer or `CheckoutContext`/`CheckoutProvider` — the
 *    Storefront architecture boundary keeps AWJ DTC Checkout fully
 *    AWJ-native (AWJ_CHECKOUT_V1_ARCHITECTURE.md; "no Spree checkout for
 *    the AWJ DTC flow").
 * 2. No hardcoded physical-direction Tailwind utility (`ml-`, `mr-`,
 *    `pl-`, `pr-`, `text-left`, `text-right`) — this UI must render
 *    correctly in both RTL (Arabic, the default locale) and LTR without a
 *    per-direction fork, matching every other AWJ Store surface's
 *    logical-property convention.
 */

const CHECKOUT_FLOW_PATH = join(__dirname, "..", "AwjCheckoutFlow.tsx");

const PHYSICAL_DIRECTION_CLASS = /\b(ml|mr|pl|pr)-\d|text-(left|right)\b/;

function readSource(): string {
  return readFileSync(CHECKOUT_FLOW_PATH, "utf-8");
}

describe("AwjCheckoutFlow — architecture boundaries", () => {
  it("never imports the Spree checkout data layer or CheckoutContext/CheckoutProvider", () => {
    const source = readSource();
    const importLines = source
      .split("\n")
      .filter((line) => /^import\b/.test(line.trim()));

    for (const line of importLines) {
      expect(line).not.toMatch(/["']@\/lib\/data\/checkout["']/);
      expect(line).not.toMatch(/CheckoutContext/);
      expect(line).not.toMatch(/CheckoutProvider/);
      expect(line).not.toMatch(/@spree\/sdk/);
    }
  });

  it("only calls into the AWJ checkout server actions module", () => {
    const source = readSource();

    expect(source).toMatch(/from ["']@\/lib\/data\/awj-checkout["']/);
  });

  it("uses no hardcoded physical-direction Tailwind classes (RTL/LTR safe by construction)", () => {
    const source = readSource();
    const offendingLines = source
      .split("\n")
      .filter((line) => PHYSICAL_DIRECTION_CLASS.test(line));

    expect(offendingLines).toEqual([]);
  });
});
