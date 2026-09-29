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
 *
 * The preview frame is a plain, width-constrained div rendered inside the
 * real Customizer page (not an iframe — see `data-preview-frame` in
 * `ExperienceBuilder.tsx`), so Tailwind's `sm:`/`md:` responsive prefixes
 * would evaluate against the host browser's actual window width, not the
 * simulated device. A desktop host previewing the mobile device must still
 * get the mobile-sized image, which is exactly what a literal `sm:`/`md:`
 * class name (present regardless of any real cascade) would get wrong and a
 * single explicit class per simulated viewport gets right.
 */
describe("web customizer preview — AWJ Market card proportions", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses ProductCard's own standard fixed image height for AWJ Modern at the desktop/tablet simulated width", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
      />,
    );
    expect(container.querySelector(".h-52")).not.toBeNull();
    expect(container.querySelector(".h-36")).toBeNull();
    expect(container.querySelector(".h-40")).toBeNull();
  });

  it("uses ProductCard's own exact Market fixed image height at the desktop/tablet simulated width", () => {
    const marketConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: "awj-market" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={marketConfig} locale="en" viewport="desktop" />,
    );
    expect(container.querySelector(".h-40")).not.toBeNull();
    expect(container.querySelector(".h-52")).toBeNull();
  });

  it("uses the mobile-sized image at the simulated mobile viewport, not the host browser's own width (AWJ Modern)", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="mobile"
      />,
    );
    expect(container.querySelector(".h-36")).not.toBeNull();
    expect(container.querySelector(".h-52")).toBeNull();
  });

  it("uses the mobile-sized Market image at the simulated mobile viewport, not the host browser's own width", () => {
    const marketConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: "awj-market" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={marketConfig} locale="en" viewport="mobile" />,
    );
    expect(container.querySelector(".h-28")).not.toBeNull();
    expect(container.querySelector(".h-40")).toBeNull();
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
    // Scoped to the New Arrivals shelf specifically: the homepage categories
    // grid below now also resolves to `gap-3` at this (non-Market) config —
    // see `categoriesGap` — so the previous unscoped `.mt-4.grid.gap-3`
    // selector would otherwise match whichever of the two sections happens
    // to render first in the DOM instead of the shelf this test means to
    // check.
    const grid = view.container.querySelector(
      'section[aria-labelledby="preview-arrivals"] ul.grid',
    );
    expect(grid?.className).toContain("grid-cols-4");
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

/**
 * Regression coverage for the Codex P2 findings (rounds 6-7) on PR #1084: the
 * New Arrivals grid used `mobileViewport ? "grid-cols-2" : "grid-cols-2
 * sm:grid-cols-3 lg:grid-cols-4"`, so a desktop host simulating the tablet
 * (768px) or mobile device still got the `sm:`/`lg:` classes evaluated
 * against the host's own window width instead of the simulated one — the
 * same class of bug `cardImageHeight` was already fixed for (round 6). Round
 * 7 then caught that the round-6 fix itself mapped the wrong published
 * component's breakpoints: this preview section represents the homepage
 * shelf, rendered by `NewArrivals.tsx` (`grid-cols-2 sm:grid-cols-3
 * lg:grid-cols-4`, `sm` at 640px / `lg` at 1024px) — not the differently-
 * breakpointed `ProductGrid.tsx` used for catalog/category pages. At this
 * preview's three discrete widths (390/768/1280), all three land in a
 * distinct tier: mobile below `sm` for 2 columns, tablet at/above `sm` but
 * below `lg` for 3, desktop at/above `lg` for 4.
 */
describe("web customizer preview — New Arrivals column count follows the simulated viewport", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ["mobile", "grid-cols-2"],
    ["tablet", "grid-cols-3"],
    ["desktop", "grid-cols-4"],
  ] as const)("renders %s columns at the %s simulated viewport", (viewport, expectedClass) => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport={viewport}
      />,
    );
    const arrivalsGrid = container.querySelector(
      'section[aria-labelledby="preview-arrivals"] ul.grid',
    );
    expect(arrivalsGrid).not.toBeNull();
    expect(arrivalsGrid?.className).toContain(expectedClass);
  });

  it("widens the desktop tier to 5 columns for AWJ Market", () => {
    const marketConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: "awj-market" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={marketConfig} locale="en" viewport="desktop" />,
    );
    const arrivalsGrid = container.querySelector(
      'section[aria-labelledby="preview-arrivals"] ul.grid',
    );
    expect(arrivalsGrid?.className).toContain("grid-cols-5");
  });
});

/**
 * Regression coverage for AWJ Market Full Theme Completion: the homepage
 * categories grid (`CategoriesSection.tsx`) got its own dense preset for
 * Market (more/tighter tiles). This preview section mirrors it with the same
 * resolve-from-`viewport` technique as `cardImageHeight`/`newArrivalsColumns`
 * above, for the same reason: real `sm:`/`lg:`/`xl:` prefixes would evaluate
 * against this host browser, not the simulated device.
 */
describe("web customizer preview — categories grid follows the simulated viewport and theme", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ["mobile", "grid-cols-2"],
    ["tablet", "grid-cols-3"],
    ["desktop", "grid-cols-6"],
  ] as const)("AWJ Modern renders %s columns at the %s simulated viewport", (viewport, expectedClass) => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport={viewport}
      />,
    );
    const categoriesGrid = container.querySelector(
      'section[aria-labelledby="preview-categories"] ul.grid',
    );
    expect(categoriesGrid?.className).toContain(expectedClass);
  });

  it.each([
    ["mobile", "grid-cols-3"],
    ["tablet", "grid-cols-4"],
    ["desktop", "grid-cols-8"],
  ] as const)("AWJ Market renders %s columns at the %s simulated viewport", (viewport, expectedClass) => {
    const marketConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: "awj-market" as const,
    };
    const { container } = render(
      <StorefrontPreviewCanvas config={marketConfig} locale="en" viewport={viewport} />,
    );
    const categoriesGrid = container.querySelector(
      'section[aria-labelledby="preview-categories"] ul.grid',
    );
    expect(categoriesGrid?.className).toContain(expectedClass);
    expect(categoriesGrid?.className).toContain("gap-2");
  });
});
