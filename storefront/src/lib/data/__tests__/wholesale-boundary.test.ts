/**
 * H6 Batch D — architecture guard for the wholesale boundary.
 *
 * The legacy Spree-shaped wholesale data layer (`lib/data/wholesale.ts`) and its
 * characterization tests were removed in W1b. What remains is the guard that
 * keeps the AWJ-native commerce modules free of any Spree or legacy wholesale
 * import, so a cart/price mapping cannot silently cross surfaces again.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every module specifier a source file imports/re-exports/requires, including multi-line declarations. */
function moduleSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*["']([^"']+)["']/g))
    out.push(m[1]);
  for (const m of source.matchAll(
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ))
    out.push(m[1]);
  return out;
}

describe("moduleSpecifiers (guard helper)", () => {
  it("sees specifiers of multi-line, side-effect, re-export and dynamic imports", () => {
    const src = [
      "import {",
      "  getClient,",
      "  withAuthRefresh,",
      '} from "@/lib/spree";',
      'import type { A } from "@spree/sdk";',
      'import "./side-effect";',
      'export { x } from "./data/wholesale";',
      'const m = await import("@/lib/spree/cookies");',
    ].join("\n");
    expect(moduleSpecifiers(src)).toEqual(
      expect.arrayContaining([
        "@/lib/spree",
        "@spree/sdk",
        "./side-effect",
        "./data/wholesale",
        "@/lib/spree/cookies",
      ]),
    );
  });
});

describe("AWJ-native commerce modules stay wholesale-free (no cart/price mapping across surfaces)", () => {
  const COMMERCE_DIR = join(__dirname, "../../commerce");

  it("no module under lib/commerce imports the Spree wrapper, the SDK or the wholesale data layer", () => {
    const files = readdirSync(COMMERCE_DIR).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const specifiers = moduleSpecifiers(
        readFileSync(join(COMMERCE_DIR, file), "utf-8"),
      );
      for (const spec of specifiers) {
        expect(spec, file).not.toMatch(
          /@\/lib\/spree|@spree\/|data\/wholesale/,
        );
      }
    }
  });

  it("the AWJ cart/checkout adapters never mention a wholesale surface in executable code", () => {
    for (const file of ["cart.ts", "checkout.ts", "checkout-types.ts"]) {
      const code = readFileSync(join(COMMERCE_DIR, file), "utf-8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(code, file).not.toMatch(/wholesale/i);
    }
  });
});
