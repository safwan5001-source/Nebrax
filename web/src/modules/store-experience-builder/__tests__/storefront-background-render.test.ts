import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { resolveStorefrontBackgroundStyle } from "../presentation/storefront-background-render";

describe("resolveStorefrontBackgroundStyle", () => {
  it("preserves the legacy backgroundColor when the global contract is absent", () => {
    expect(resolveStorefrontBackgroundStyle(DEFAULT_PRESENTATION_CONFIG, "ltr")).toEqual({ backgroundColor: DEFAULT_PRESENTATION_CONFIG.backgroundColor });
  });
  it("resolves solid palette colors without accepting arbitrary CSS", () => {
    expect(resolveStorefrontBackgroundStyle({ ...DEFAULT_PRESENTATION_CONFIG, background: { kind: "solid", color: { hex: "#123456" } } }, "ltr")).toEqual({ backgroundColor: "#123456" });
  });
  it("resolves logical gradient directions in LTR and RTL", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, background: { kind: "gradient" as const, from: { hex: "#111111" }, to: { hex: "#eeeeee" }, direction: "to-end" as const } };
    expect(resolveStorefrontBackgroundStyle(config, "ltr").backgroundImage).toContain("to right");
    expect(resolveStorefrontBackgroundStyle(config, "rtl").backgroundImage).toContain("to left");
  });
  it("fails closed for media until its separate publish authorization phase", () => {
    expect(resolveStorefrontBackgroundStyle({ ...DEFAULT_PRESENTATION_CONFIG, background: { kind: "media", media: { mediaId: "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e", decorative: true } } }, "ltr")).toEqual({ backgroundColor: DEFAULT_PRESENTATION_CONFIG.backgroundColor });
  });
});
