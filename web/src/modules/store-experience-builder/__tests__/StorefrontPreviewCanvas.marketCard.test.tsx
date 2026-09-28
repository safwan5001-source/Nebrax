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

  it("uses ProductCard's own standard fixed image height for AWJ Modern (unchanged default)", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
      />,
    );
    expect(container.querySelector(".h-36")).not.toBeNull();
    expect(container.querySelector(".h-28")).toBeNull();
  });

  it("uses ProductCard's own exact Market fixed image height once AWJ Market is selected", () => {
    const marketConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: "awj-market" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={marketConfig} locale="en" viewport="desktop" />,
    );
    expect(container.querySelector(".h-28")).not.toBeNull();
    expect(container.querySelector(".h-36")).toBeNull();
  });
});

/**
 * Regression coverage for the Codex P2 finding on PR #1084: the published
 * Header only ties `header.style === "compact"` to the logo/utility strip
 * (see `(storefront)/layout.tsx`, `Header.tsx`) — every other difference is
 * the shell's own responsive behavior. Market's starting bundle sets
 * header.style to compact by default, so the preview must not also collapse
 * to mobile chrome on a desktop/tablet viewport just because of that.
 */
describe("web customizer preview — compact header style vs. mobile viewport", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps desktop chrome (category nav, wide grid, no bottom nav) when header.style is compact but the viewport is desktop", () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      header: { ...DEFAULT_PRESENTATION_CONFIG.header, style: "compact" as const },
    };
    const view = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" />,
    );
    expect(view.getByRole("navigation", { name: "Categories" })).toBeTruthy();
    const grid = view.container.querySelector(".mt-4.grid.gap-3");
    expect(grid?.className).toContain("lg:grid-cols-4");
    expect(view.queryByRole("navigation", { name: "Home" })).toBeNull();
  });

  it("still uses the mobile identity grid and bottom nav at the mobile viewport, regardless of header style", () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG };
    const view = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="mobile" />,
    );
    expect(view.getByRole("navigation", { name: "Home" })).toBeTruthy();
    expect(view.queryByRole("navigation", { name: "Categories" })).toBeNull();
  });
});
