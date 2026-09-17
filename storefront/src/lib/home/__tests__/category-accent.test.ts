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
      expect(categoryAccent(hostile).rule).toBe("var(--store-border-strong)");
    }
  });

  it("falls back to the neutral edge when no colour is set", () => {
    const accent = categoryAccent(null);
    expect(accent.rule).toBe("var(--store-border-strong)");
    expect(accent.isMerchantColor).toBe(false);
  });

  it("uses the category's own colour when one is set", () => {
    const accent = categoryAccent("#12372a");
    expect(accent.rule).toBe("#12372a");
    expect(accent.isMerchantColor).toBe(true);
  });

  it("deepens a near-white colour so the accent stays visible", () => {
    const accent = categoryAccent("#fdfdfd");
    expect(accent.rule).toContain("#fdfdfd");
    expect(accent.rule).toContain("var(--store-foreground)");
    expect(accent.isMerchantColor).toBe(true);
  });
});
