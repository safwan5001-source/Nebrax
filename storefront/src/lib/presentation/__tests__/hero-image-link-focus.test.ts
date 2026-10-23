import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AWJ-HERO-DISPLAY (review on #1645) — the focus indicator of a hero picture link is pinned in the stylesheet: it must not depend
 * on one colour (the picture may span black to white; outside the hero it would sit on the page background), so it is two adjacent
 * rings drawn INSIDE the element — a black outline over a white inset band. The real-browser pixel proof is in the PR report.
 */
const css = readFileSync(
  resolve(__dirname, "../../../app/globals.css"),
  "utf8",
);
const rule = (selector: string, from = 0) => {
  const at = css.indexOf(selector, from);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at) + 1);
};

describe("hero picture link focus indicator", () => {
  const block = rule("[data-hero-image-link]:focus-visible {");

  it("is a dark outline over a light band — two colours, so one always contrasts", () => {
    expect(block).toMatch(/outline:\s*3px solid #000/);
    expect(block).toMatch(/box-shadow:\s*inset 0 0 0 6px #fff/);
  });

  it("is drawn inside the hero's edge (negative offset), never outside on the page background", () => {
    expect(block).toMatch(/outline-offset:\s*-3px/);
  });

  it("uses fixed colours, not theme or section tokens (those can be recoloured to match the picture)", () => {
    expect(block).not.toMatch(/var\(--/);
  });

  it("keeps a visible system-colour outline in forced-colors mode (box-shadow is dropped there)", () => {
    const forced = css.slice(
      css.indexOf("@media (forced-colors: active) {\n  [data-hero-image-link]"),
    );
    expect(forced).toMatch(
      /\[data-hero-image-link\]:focus-visible\s*\{[^}]*outline:\s*3px solid Highlight/,
    );
  });
});
