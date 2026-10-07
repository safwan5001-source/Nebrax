import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  FONT_PRESETS,
  fontPresetFamilyStack,
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
      "awj-bloom",
    ]);
    expect(presetPrimary("awj-market")).toBe("#0f766e");
    expect(primaryForeground("#0f766e")).toBe("#ffffff");
  });

  it("FLOWERS-H15: awj-bloom has its own primary with white foreground", () => {
    expect(presetPrimary("awj-bloom")).toBe("#9d2449");
    expect(primaryForeground("#9d2449")).toBe("#ffffff");
  });

  it("CUST-H3-2: registers the curated tajawal-geist preset alongside cairo-geist", () => {
    expect(FONT_PRESETS.map((preset) => preset.id)).toEqual([
      "cairo-geist",
      "tajawal-geist",
    ]);
  });

  it("CUST-H3-2: resolves the full font-family stack deterministically and fails closed to Cairo", () => {
    expect(fontPresetFamilyStack("cairo-geist")).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
    expect(fontPresetFamilyStack("tajawal-geist")).toBe(
      "var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif",
    );
    expect(fontPresetFamilyStack("bogus-value" as never)).toBe(
      "var(--font-geist), var(--font-cairo), system-ui, sans-serif",
    );
  });

  it("CUST-H3-2-FIX-1: the tajawal-geist stack never references Cairo or the shared --font-geist, so Cairo cannot shadow Tajawal", () => {
    const stack = fontPresetFamilyStack("tajawal-geist");
    expect(stack).not.toContain("--font-cairo");
    // Must use the dedicated Tajawal-fallback Geist instance, not the
    // Cairo-fallback one — reusing --font-geist here would resolve Arabic
    // to Cairo via Geist's own baked-in fallback before Tajawal is reached.
    expect(stack).toContain("--font-geist-tajawal");
    expect(stack).not.toMatch(/var\(--font-geist\),/);
  });

  it("CUST-H3-2: presentationCssVars is unaffected by font preset — color/radius only", () => {
    const vars = presentationCssVars("#1e3a5f", "subtle");
    expect(vars["--store-primary"]).toBe("#1e3a5f");
    expect(vars["--store-radius"]).toBe("0.5rem");
    expect(vars).not.toHaveProperty("--store-font-arabic");
  });

  it("CUST-HV V5d-3 (DEF-2): the accent role is emitted only when the merchant set one", () => {
    const legacy = presentationCssVars("#1e3a5f", "subtle", null);
    expect(legacy).toEqual(presentationCssVars("#1e3a5f", "subtle"));
    expect(legacy).not.toHaveProperty("--store-accent");
    const live = presentationCssVars("#1e3a5f", "subtle", "#d1456a");
    expect(live["--store-accent"]).toBe("#d1456a");
    expect(live["--store-accent-foreground"]).toBe(
      primaryForeground("#d1456a"),
    );
    // an unsafe value is never emitted
    expect(
      presentationCssVars("#1e3a5f", "subtle", "url(x)"),
    ).not.toHaveProperty("--store-accent");
  });
});
