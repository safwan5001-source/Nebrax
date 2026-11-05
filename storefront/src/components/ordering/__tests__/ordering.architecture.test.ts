import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COPS-H4 Buyer Ordering UX — architectural guard.
 *
 * The server's Checkout (`POST checkout/complete`, `CommerceChannelIntakeGuard`) is the single source of truth for whether
 * an order is accepted. The buyer-facing intake notice is advice. These checks keep it that way: it must never become a
 * second source of truth (no API of its own, no browser persistence) and must never gate an action.
 */

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string) =>
  readFileSync(path.join(root, relative), "utf8");

const notices = [
  "src/components/ordering/OrderingBanner.tsx",
  "src/components/ordering/OrderingCartNotice.tsx",
  "src/contexts/OrderingContext.tsx",
  "src/lib/commerce/ordering.ts",
];

describe("ordering notice architecture", () => {
  it.each(
    notices,
  )("%s makes no network call of its own and persists nothing", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/storefrontFetch|storefrontCartRequest|api\(/);
    expect(source).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|cookies\(/,
    );
  });

  it.each(notices)("%s cannot disable, hide or redirect anything", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\bdisabled\b/);
    expect(source).not.toMatch(
      /\brouter\.(push|replace)\b|\bredirect\s*\(|notFound\s*\(/,
    );
  });

  it("the only reader of data.ordering is the storefront config parser (no parallel endpoint)", () => {
    const parser = read("src/lib/commerce/storefront.ts");
    expect(parser).toContain("readOrdering(response.data.ordering)");
    // The one request stays GET store/v1/storefront.
    expect(parser).toContain('"storefront"');
  });

  it("the cart page and the checkout flow never gate their primary action on the ordering block", () => {
    for (const file of [
      "src/app/[country]/[locale]/(storefront)/cart/page.tsx",
      "src/components/checkout/AwjCheckoutFlow.tsx",
    ]) {
      const source = read(file);
      // `ordering` may feed notices and copy, but no `disabled={…ordering…}` / early-return on it.
      expect(source).not.toMatch(/disabled=\{[^}]*ordering/);
      expect(source).not.toMatch(/if\s*\([^)]*ordering[^)]*\)\s*return\b/);
    }
  });
});
