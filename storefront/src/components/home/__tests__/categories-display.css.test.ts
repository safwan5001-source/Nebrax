import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCategoryDisplay } from "@/lib/presentation/categories-display";

const css = readFileSync(
  resolve(__dirname, "../categories-display.css"),
  "utf8",
);
/** The stylesheet without comments, so prose in the header cannot satisfy or trip a check. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * AWJ-STORE-CAT-DESIGN-01 — contract of the shared stylesheet. The web Canvas carries a byte-identical copy
 * (enforced from the web side), so these properties hold for the storefront and its preview alike.
 */
describe("categories-display.css", () => {
  it("uses logical properties only (RTL/LTR are the document's)", () => {
    expect(code).not.toMatch(
      /(?:^|[\s{;])(?:margin|padding|border)-(?:left|right)\s*:/,
    );
    expect(code).not.toMatch(/(?:^|[\s{;])(?:left|right)\s*:/);
    expect(code).not.toMatch(
      /\b(?:text-align|float|clear)\s*:\s*(?:left|right)\b/,
    );
    // Sizes go through inline-size / block-size (min-/max-width on the root are direction-neutral).
    expect(code).not.toMatch(/(?:^|[\s{;])(?:width|height)\s*:/);
  });

  it("carries no raw colour: every colour is a store token or a custom property", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgba?\(/);
  });

  it("honours reduced motion for hover transitions and smooth scrolling", () => {
    expect(code).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.awj-cd__card\s*\{\s*transition:\s*none/,
    );
    // Smooth scrolling is only ever switched on when motion is allowed.
    expect(code).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?scroll-behavior:\s*smooth/,
    );
    expect(code.match(/(?<![\w-])scroll-behavior/g)).toHaveLength(1);
  });

  it("scrolls sideways natively, contained, with snapping and no page-level overflow", () => {
    const rail = code.match(
      /\.awj-cd\[data-cd-layout="horizontal_scroll"\],\s*\.awj-cd\[data-cd-layout="circles"\]\s*\{([^}]*)\}/,
    );
    expect(rail?.[1]).toContain("overflow-x: auto");
    expect(rail?.[1]).toContain("overscroll-behavior-x: contain");
    expect(rail?.[1]).toContain("scroll-snap-type: x mandatory");
    expect(rail?.[1]).toContain("grid-auto-flow: column");
    expect(code).toMatch(
      /\.awj-cd\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/,
    );
    expect(code).toContain("scroll-snap-align: start");
  });

  it("acts on the picture itself: object-fit and object-position are set on the image, not the frame", () => {
    expect(code).toMatch(
      /\.awj-cd__img\s*\{[^}]*object-fit:\s*var\(--cd-fit\)[^}]*object-position:\s*var\(--cd-op\)/,
    );
    expect(code).not.toMatch(/\.awj-cd__media\s*\{[^}]*object-fit/);
  });

  it("reserves the picture's space with an aspect ratio (no layout shift)", () => {
    expect(code).toMatch(
      /\.awj-cd__media\s*\{[^}]*aspect-ratio:\s*var\(--cd-ar\)/,
    );
  });

  it("keeps a visible keyboard focus ring and a 44px minimum target", () => {
    expect(code).toMatch(
      /\.awj-cd__card:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--store-primary\)/,
    );
    expect(code).toMatch(/\.awj-cd__card\s*\{[^}]*min-height:\s*44px/);
  });

  it("the line clamp is on the inner text, never on the padded name element", () => {
    expect(code).toMatch(/\.awj-cd__name-text\[data-cd-clamp="2"\]/);
    expect(code).not.toMatch(/\.awj-cd__name\[data-cd-clamp/);
  });

  it("hover is a colour/edge change only — no transform, no animation", () => {
    expect(code).not.toMatch(/\btransform\s*:/);
    expect(code).not.toMatch(/@keyframes|animation\s*:/);
  });

  it("the shadow is never authored here: it only arrives as the fixed soft token", () => {
    expect(code).toContain("box-shadow: var(--cd-shadow)");
    expect(code).not.toMatch(/box-shadow:\s*\d/);
  });

  it("picks the effective responsive values from media queries AND from a pinned device, in lockstep", () => {
    // Every custom property the resolver emits per device must be selectable by both mechanisms.
    const resolved = resolveCategoryDisplay({ layout: "grid" });
    const perDevice = new Set(
      Object.keys(resolved.vars)
        .filter((key) => /-[mtd]$/.test(key))
        .map((key) => key.replace(/-[mtd]$/, "")),
    );
    expect([...perDevice].sort()).toEqual(
      [
        "--cd-ar",
        "--cd-cols",
        "--cd-gap",
        "--cd-h",
        "--cd-iw",
        "--cd-thumb",
        "--cd-w",
      ].sort(),
    );
    for (const name of perDevice) {
      for (const k of ["m", "t", "d"]) {
        expect(css, `${name}-${k} read`).toContain(
          `${name}: var(${name}-${k})`,
        );
      }
    }
    // Tablet at 640px, desktop at 1024px — the same breakpoints the `sizes` hint uses.
    expect(css).toContain("@media (min-width: 640px)");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain('.awj-cd[data-cd-device="tablet"]');
    expect(css).toContain('.awj-cd[data-cd-device="desktop"]');
  });

  it("the overlay name sits on the scrim token, which the storefront defines with a proven pair", () => {
    const globals = readFileSync(
      resolve(__dirname, "../../../app/globals.css"),
      "utf8",
    );
    expect(globals).toMatch(/--store-scrim:\s*rgb\(0 0 0 \/ 0\.72\)/);
    expect(globals).toMatch(/--store-scrim-foreground:\s*#ffffff/);
    // White on 72 % black, composited over the lightest possible photo (pure white), must stay >= 4.5:1.
    const channel = 1 * (1 - 0.72); // sRGB value of the composited backing
    const linear = ((channel + 0.055) / 1.055) ** 2.4;
    const ratio = 1.05 / (linear + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
