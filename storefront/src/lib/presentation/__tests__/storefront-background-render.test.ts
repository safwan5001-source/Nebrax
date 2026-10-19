import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../config";
import { resolveStorefrontBackgroundStyle } from "../storefront-background-render";

describe("resolveStorefrontBackgroundStyle", () => {
  it("preserves the legacy backgroundColor when the global contract is absent", () => {
    expect(resolveStorefrontBackgroundStyle(DEFAULT_PRESENTATION_CONFIG, "ltr")).toEqual({ backgroundColor: DEFAULT_PRESENTATION_CONFIG.backgroundColor });
  });
  it("resolves solid colours and logical gradients safely", () => {
    const solid = resolveStorefrontBackgroundStyle({ ...DEFAULT_PRESENTATION_CONFIG, background: { kind: "solid", color: { hex: "#123456" } } }, "ltr");
    expect(solid).toEqual({ backgroundColor: "#123456" });
    const gradient = { ...DEFAULT_PRESENTATION_CONFIG, background: { kind: "gradient" as const, from: { hex: "#111111" }, to: { hex: "#eeeeee" }, direction: "to-end" as const } };
    expect(resolveStorefrontBackgroundStyle(gradient, "ltr").backgroundImage).toContain("to right");
    expect(resolveStorefrontBackgroundStyle(gradient, "rtl").backgroundImage).toContain("to left");
  });
  it("fails closed for media until the publish gate is intentionally advanced", () => {
    expect(resolveStorefrontBackgroundStyle({ ...DEFAULT_PRESENTATION_CONFIG, background: { kind: "media", media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e", decorative: true } } }, "ltr")).toEqual({ backgroundColor: DEFAULT_PRESENTATION_CONFIG.backgroundColor });
  });
});
