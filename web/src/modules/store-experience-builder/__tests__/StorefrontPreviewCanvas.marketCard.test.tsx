/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

/**
 * Regression coverage for the Codex P2 finding on PR #1084: selecting AWJ
 * Market must change the merchant-facing preview's card proportions too, or
 * the preview materially disagrees with what Publish actually ships.
 */
describe("web customizer preview — AWJ Market card proportions", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses a square image tile for AWJ Modern (unchanged default)", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
      />,
    );
    expect(container.querySelector(".aspect-square")).not.toBeNull();
    expect(container.querySelector(".aspect-\\[4\\/3\\]")).toBeNull();
  });

  it("uses a shorter, denser image tile once AWJ Market is selected", () => {
    const marketConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: "awj-market" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={marketConfig} locale="en" viewport="desktop" />,
    );
    expect(container.querySelector(".aspect-\\[4\\/3\\]")).not.toBeNull();
    expect(container.querySelector(".aspect-square")).toBeNull();
  });
});
