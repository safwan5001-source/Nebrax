import { describe, expect, it } from "vitest";
import { categoryAccent, isValidCategoryColor } from "../category-accent";

describe("categoryAccent", () => {
  it("accepts only plain hex literals", () => {
    expect(isValidCategoryColor("#12372a")).toBe(true);
    expect(isValidCategoryColor("#ABC")).toBe(true);
    expect(isValidCategoryColor(" #12372a ")).toBe(true);
    expect(isValidCategoryColor(null)).toBe(false);
    expect(isValidCategoryColor("")).toBe(false);
    expect(isValidCategoryColor("red")).toBe(false);
  });

  it("refuses anything that could carry more than a colour into the style attribute", () => {
    // The column is free text on the AWJ side, so the tile treats it as input.
    for (const hostile of [
      "url(javascript:alert(1))",
      "#fff; background-image: url(https://evil.test/x.png)",
      "expression(alert(1))",
      "var(--store-primary)",
    ]) {
      expect(isValidCategoryColor(hostile)).toBe(false);
      expect(categoryAccent(hostile).background).toBe(
        "var(--store-surface-muted)",
      );
    }
  });

  it("falls back to the neutral treatment when no colour is set", () => {
    const accent = categoryAccent(null);
    expect(accent.background).toBe("var(--store-surface-muted)");
    expect(accent.foreground).toBe("var(--store-muted-foreground)");
  });

  it("tints from the category's own colour when one is set", () => {
    const accent = categoryAccent("#12372a");
    expect(accent.background).toContain("#12372a");
    expect(accent.foreground).toContain("#12372a");
  });

  it("keeps the label readable on a pale category colour", () => {
    // A near-white colour cannot also be the label colour on its own tint.
    expect(categoryAccent("#fdfdfd").foreground).toBe(
      "var(--store-foreground)",
    );
  });
});
