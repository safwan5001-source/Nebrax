import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isSafeHexColor,
  presentationCssVars,
  presetPrimary,
  primaryForeground,
  THEME_PRESETS,
} from "../tokens";

describe("presentation tokens", () => {
  it("accepts only six-digit hex colours", () => {
    expect(isSafeHexColor("#12372a")).toBe(true);
    expect(isSafeHexColor("#fff")).toBe(false);
    expect(isSafeHexColor("12372a")).toBe(false);
  });

  it("picks a readable primary foreground", () => {
    expect(primaryForeground("#12372a")).toBe("#ffffff");
    expect(contrastRatio("#12372a", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(primaryForeground("#f8f9fa")).toBe("#111827");
  });

  it("emits CSS variables from a merchant primary without touching commerce tokens", () => {
    const vars = presentationCssVars("#1e3a5f", "subtle");
    expect(vars["--store-primary"]).toBe("#1e3a5f");
    expect(vars["--store-radius"]).toBe("0.5rem");
    expect(vars["--store-primary-foreground"]).toBe("#ffffff");
  });

  it("registers awj-market alongside the existing closed preset set", () => {
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual([
      "awj-modern",
      "navy",
      "burgundy",
      "sand",
      "slate",
      "awj-market",
    ]);
    expect(presetPrimary("awj-market")).toBe("#0f766e");
    expect(primaryForeground("#0f766e")).toBe("#ffffff");
  });
});
