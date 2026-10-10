/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CUST-HV V5e-2b — the global button tokens address "the store's solid CTA" by class tokens, so
 * markup stays byte-identical when no token is set. This test pins that selector to the real
 * components: if a component drops one of the three classes the tokens silently stop reaching
 * it, and this fails instead.
 */
const src = (rel: string) =>
  readFileSync(resolve(__dirname, "../../..", rel), "utf8");
const SOLID_CTA =
  '[class~="bg-store-primary"][class~="rounded-store"][class~="font-bold"]';

// Every quoted string, not only a literal `className="…"`: a component may choose its classes in a ternary (the
// Banner's first-vs-second button, V6c-2). Only a string that really matches the three-class selector is counted,
// so unrelated strings cannot inflate the number.
function classStrings(file: string): string[] {
  return [...src(file).matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);
}

describe("global button selector ↔ real components (V5e-2b)", () => {
  const expected: Array<[string, number]> = [
    ["components/home/BannerBand.tsx", 2],
    ["components/products/ProductCard.tsx", 1],
    ["components/products/QuickView.tsx", 2],
  ];
  for (const [file, count] of expected) {
    it(`${file} carries ${count} solid CTA(s) the tokens reach`, () => {
      const matching = classStrings(file).filter((value) => {
        const el = document.createElement("a");
        el.className = value;
        return el.matches(SOLID_CTA);
      });
      expect(matching).toHaveLength(count);
    });
  }

  it("the hero CTA is deliberately not a global button (it is inverted on the brand gradient — V6 owns it)", () => {
    const hero = classStrings("components/home/HeroSection.tsx").filter(
      (value) => value.includes("bg-store-primary-foreground"),
    );
    expect(hero.length).toBeGreaterThan(0);
    for (const value of hero) {
      const el = document.createElement("a");
      el.className = value;
      expect(el.matches(SOLID_CTA)).toBe(false);
    }
  });

  it("the stylesheet addresses exactly this selector (and the shared Button's default variant)", () => {
    const css = src("app/globals.css");
    expect(css).toContain(SOLID_CTA);
    expect(css).toContain('[data-slot="button"][data-variant="default"]');
    // the shared Button really carries the attributes the stylesheet keys on
    const button = src("components/ui/button.tsx");
    expect(button).toContain('data-slot="button"');
    expect(button).toContain("data-variant={variant}");
  });
});
