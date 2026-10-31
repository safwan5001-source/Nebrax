// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * X5 — route-tree inventory. Checkout URLs have exactly ONE owner:
 *   - AWJ-native, Spree-free:  (store-checkout)/checkout and (store-checkout)/checkout/payment-return
 * The legacy Spree pages (`checkout/[id]`, `confirm-payment/[id]`, `order-placed/[id]`) and their gated `(checkout)` group
 * were removed (H6); the proxy keeps answering a real 404 for those URLs (see `lib/spree/middleware.test.ts`). This test
 * makes sure none of them can reappear, ungated, anywhere in the route tree.
 */
const ROOT = path.join(process.cwd(), "src/app/[country]/[locale]");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");
const files = walk(ROOT).map(rel);
const routes = files.filter((f) => /(^|\/)(page|route)\.tsx?$/.test(f));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("checkout route ownership (X5)", () => {
  it("no legacy Spree checkout page exists anywhere in the route tree", () => {
    const legacy = routes.filter((r) =>
      /(^|\/)(checkout\/\[[^\]]+\]|confirm-payment|order-placed)(\/|$)/.test(r),
    );
    expect(legacy).toEqual([]);
  });

  it("the gated (checkout) route group is gone", () => {
    expect(files.filter((f) => f.startsWith("(checkout)/"))).toEqual([]);
  });

  it("the AWJ-native checkout routes exist, are outside the gated group, and import nothing from Spree", () => {
    const awj = [
      "(store-checkout)/checkout/page.tsx",
      "(store-checkout)/checkout/payment-return/page.tsx",
    ];
    for (const route of awj) {
      expect(routes).toContain(route);
      expect(read(route)).not.toMatch(
        /from\s+["'](@spree\/sdk|@\/lib\/spree|@\/lib\/data\/(checkout|payment|orders|addresses|customer)\b)/,
      );
    }
    // …and their layout is not the gated one.
    expect(files).toContain("(store-checkout)/layout.tsx");
    expect(read("(store-checkout)/layout.tsx")).not.toMatch(
      /isWholesaleEnabled/,
    );
  });

  it("no other route group contains a checkout-shaped legacy path", () => {
    const strays = routes.filter(
      (r) =>
        !r.startsWith("(store-checkout)/") &&
        /(^|\/)(checkout|confirm-payment|order-placed)(\/|$)/.test(r),
    );
    expect(strays).toEqual([]);
  });
});
