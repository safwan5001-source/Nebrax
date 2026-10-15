import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VD-5 / D-S-3 — WCAG 2.2 SC 2.4.11 (Focus Not Obscured). `MobileBottomNav` is `fixed` over
 * the bottom of the viewport below `md`; the root scroller must reserve that strip via
 * `scroll-padding-bottom`, otherwise Tab leaves a focused link under the bar. Real-browser
 * proof lives in the PR evidence; this pins the stylesheet contract and its marker hook.
 */
const css = readFileSync(resolve(__dirname, "../globals.css"), "utf8");
const nav = readFileSync(
  resolve(__dirname, "../../components/layout/MobileBottomNav.tsx"),
  "utf8",
);

/** Body of the first `selector { ... }` block found anywhere in the stylesheet. */
function ruleBody(selector: string): string | null {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("bottom-nav scroll padding (D-S-3)", () => {
  const body = ruleBody("html:has([data-store-bottom-nav])");

  it("reserves the bar's height, the safe area and a ring allowance on the root scroller", () => {
    expect(body).not.toBeNull();
    const decl = body?.replace(/\s+/g, " ") ?? "";
    expect(decl).toMatch(
      /scroll-padding-bottom: calc\( ?var\(--store-bottom-nav-height\) \+ env\(safe-area-inset-bottom\) \+ 0\.25rem ?\)/,
    );
  });

  it("applies only below md, where the bar is displayed, and is scoped to layouts that render it", () => {
    const at = css.indexOf("html:has([data-store-bottom-nav]) {");
    const mediaAt = css.lastIndexOf("@media", at);
    expect(css.slice(mediaAt, css.indexOf("{", mediaAt)).trim()).toBe(
      "@media (width < 48rem)",
    );
    // nothing between the media query and the rule but whitespace
    expect(css.slice(css.indexOf("{", mediaAt) + 1, at).trim()).toBe("");
  });

  it("uses no raw colour or fixed pixel height for the bar", () => {
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|\d+px/i);
  });

  it("is keyed on the marker the bar actually renders, and the bar hides at the same breakpoint", () => {
    expect(nav).toContain('data-store-bottom-nav=""');
    expect(nav).toMatch(/className="fixed [^"]*\bmd:hidden\b/);
  });
});
