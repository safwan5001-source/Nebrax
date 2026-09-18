import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isSafeHexColor,
  presentationCssVars,
  primaryForeground,
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
});
