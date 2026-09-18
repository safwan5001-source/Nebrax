import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards for the AWJ checkout, not DOM assertions:
 *
 * 1. The AWJ-native checkout must never import the Spree/wholesale checkout
 *    data layer or `CheckoutContext`/`CheckoutProvider` — the Storefront
 *    architecture boundary keeps AWJ DTC Checkout fully AWJ-native
 *    (AWJ_CHECKOUT_V1_ARCHITECTURE.md; "no Spree checkout for the AWJ DTC
 *    flow").
 * 2. No hardcoded physical-direction Tailwind utility (`ml-`, `mr-`, `pl-`,
 *    `pr-`, `text-left`, `text-right`) — this UI must render correctly in both
 *    RTL (Arabic, the default locale) and LTR without a per-direction fork,
 *    matching every other AWJ Store surface's logical-property convention.
 * 3. No payment-provider name or brand mark anywhere in the checkout. The
 *    payment stage is DESIGN_ONLY (`PAYMENT_CAPABILITY`), and naming a provider
 *    would assert a commercial capability the platform does not have. STORE-UI-4
 *    added the stage, so it added the guard with it.
 *
 * STORE-UI-4 split the flow into per-stage components, so these guards cover
 * the whole `awj/` directory rather than one file — a rule that only held for
 * the orchestrator would be a rule the stages could walk around.
 */

const CHECKOUT_DIR = join(__dirname, "..");
const AWJ_DIR = join(CHECKOUT_DIR, "awj");

const PHYSICAL_DIRECTION_CLASS = /\b(ml|mr|pl|pr)-\d|text-(left|right)\b/;

/**
 * Provider and scheme names. Deliberately includes ones nobody has asked for:
 * the guard's job is to fail when someone reaches for any of them, not to
 * enumerate today's temptations.
 */
const PAYMENT_BRANDS =
  /\b(stripe|adyen|paypal|checkout\.com|hyperpay|moyasar|tap ?payments?|tabby|tamara|mada|visa|mastercard|amex|american express|apple ?pay|google ?pay|stc ?pay|klarna)\b/i;

function awjFiles(): string[] {
  return readdirSync(AWJ_DIR)
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .map((name) => join(AWJ_DIR, name));
}

function checkoutSources(): Array<{ path: string; source: string }> {
  return [join(CHECKOUT_DIR, "AwjCheckoutFlow.tsx"), ...awjFiles()].map(
    (path) => ({ path, source: readFileSync(path, "utf-8") }),
  );
}

describe("AWJ checkout — architecture boundaries", () => {
  it("covers every AWJ checkout file, so a new stage cannot skip these guards", () => {
    const paths = checkoutSources().map(({ path }) => path);
    expect(paths.length).toBeGreaterThanOrEqual(7);
  });

  it("never imports the Spree checkout data layer, CheckoutContext/Provider or the Spree SDK", () => {
    for (const { path, source } of checkoutSources()) {
      const importLines = source
        .split("\n")
        .filter((line) => /^import\b/.test(line.trim()));

      for (const line of importLines) {
        expect(line, path).not.toMatch(/["']@\/lib\/data\/checkout["']/);
        expect(line, path).not.toMatch(/CheckoutContext/);
        expect(line, path).not.toMatch(/CheckoutProvider/);
        expect(line, path).not.toMatch(/@spree\/sdk/);
      }
    }
  });

  it("only calls into the AWJ checkout server actions module", () => {
    const flow = readFileSync(
      join(CHECKOUT_DIR, "AwjCheckoutFlow.tsx"),
      "utf-8",
    );

    expect(flow).toMatch(/from ["']@\/lib\/data\/awj-checkout["']/);
  });

  it("uses no hardcoded physical-direction Tailwind classes (RTL/LTR safe by construction)", () => {
    for (const { path, source } of checkoutSources()) {
      const offendingLines = source
        .split("\n")
        .filter((line) => PHYSICAL_DIRECTION_CLASS.test(line));

      expect(offendingLines, path).toEqual([]);
    }
  });

  it("names no payment provider or card scheme anywhere in the checkout", () => {
    for (const { path, source } of checkoutSources()) {
      expect(source, path).not.toMatch(PAYMENT_BRANDS);
    }
  });

  it("the payment stage collects no card data of any kind", () => {
    const stage = readFileSync(join(AWJ_DIR, "PaymentStage.tsx"), "utf-8");

    expect(stage).not.toMatch(/<Input\b/);
    expect(stage).not.toMatch(/<input\b/);
    expect(stage).not.toMatch(/\bcc-(number|exp|csc)\b/);
  });
});
