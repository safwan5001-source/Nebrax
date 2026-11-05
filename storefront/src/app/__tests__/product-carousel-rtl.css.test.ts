import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Luxe Motion QA — the pre-hydration rules of `.product-carousel .swiper-slide` must be direction-neutral.
 *
 * Swiper writes its own inline gap on each slide (`margin-right` in LTR, `margin-left` in RTL). A physical
 * `margin-right` left in the stylesheet therefore stacks on top of Swiper's `margin-left` in Arabic: the rail
 * renders with a double gap and its first slide offset by one gap from the start edge (reproduced in a real
 * browser by `e2e/luxe-motion-qa.spec.ts › home: product rail`). The logical `margin-inline-end` resolves to the
 * very property Swiper sets in each direction, so the inline value simply wins.
 */
const css = readFileSync(resolve(__dirname, "../globals.css"), "utf8");

function baseSlideRule(): string {
  const match = css.match(/\.product-carousel \.swiper-slide \{([^}]*)\}/);
  if (!match)
    throw new Error("`.product-carousel .swiper-slide` rule not found");
  return match[1];
}

describe("product carousel pre-hydration slide spacing", () => {
  it("uses a logical inline-end margin", () => {
    expect(baseSlideRule()).toMatch(/margin-inline-end:\s*24px/);
  });

  it("carries no physical left/right margin that would double Swiper's inline gap in RTL", () => {
    expect(baseSlideRule()).not.toMatch(/margin-(left|right)\s*:/);
  });
});
