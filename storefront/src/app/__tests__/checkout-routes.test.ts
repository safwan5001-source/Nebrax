// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * X5 — route-tree inventory. Checkout URLs must have exactly two owners:
 *   - AWJ-native, Spree-free:  (store-checkout)/checkout and (store-checkout)/checkout/payment-return
 *   - legacy Spree/wholesale:  (checkout)/{checkout/[id], confirm-payment/[id], order-placed/[id]}, gated in one layout
 * so a new checkout-shaped route cannot appear elsewhere (ungated) without this test failing.
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
  it("the legacy Spree checkout pages live only in the gated (checkout) group", () => {
    const legacy = routes.filter((r) =>
      /(^|\/)(checkout\/\[[^\]]+\]|confirm-payment|order-placed)(\/|$)/.test(r),
    );
    expect(legacy.sort()).toEqual([
      "(checkout)/checkout/[id]/page.tsx",
      "(checkout)/confirm-payment/[id]/page.tsx",
      "(checkout)/order-placed/[id]/page.tsx",
    ]);
  });

  it("the (checkout) group's layout is a server component that 404s unless wholesale is enabled, before any page runs", () => {
    const layout = read("(checkout)/layout.tsx");
    expect(layout).not.toMatch(/^\s*["']use client["']/m);
    expect(layout).toMatch(/isWholesaleEnabled\(\)/);
    expect(layout).toMatch(/if \(!isWholesaleEnabled\(\)\) notFound\(\)/);
    // the gate precedes the shell/provider in the file's only exported component
    expect(layout.indexOf("notFound()")).toBeLessThan(
      layout.indexOf("<CheckoutShell>"),
    );
  });

  it("every page of the group sits under that layout (no nested route group escapes it)", () => {
    const pages = routes.filter((r) => r.startsWith("(checkout)/"));
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page).not.toMatch(/\(.+\)\/.*\(.+\)/); // no second route group inside → same layout chain
    }
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
        !r.startsWith("(checkout)/") &&
        !r.startsWith("(store-checkout)/") &&
        /(^|\/)(checkout|confirm-payment|order-placed)(\/|$)/.test(r),
    );
    expect(strays).toEqual([]);
  });
});
