import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";

/**
 * Regression coverage for the Codex P2 finding on PR #1084: the skeleton's
 * image tile must track ProductCard's own AWJ Market height, or the resolved
 * card collapses to a shorter height the instant it loads (layout shift).
 */
describe("ProductCardSkeleton", () => {
  it("reserves the standard image height by default", () => {
    const { container } = render(<ProductCardSkeleton />);
    expect(container.firstElementChild?.firstElementChild).toHaveClass("h-36");
  });

  it("reserves the AWJ Market image height under the theme marker", () => {
    const { container } = render(
      <PublishedThemeMarkerProvider themePreset="awj-market">
        <ProductCardSkeleton />
      </PublishedThemeMarkerProvider>,
    );
    expect(container.firstElementChild?.firstElementChild).toHaveClass("h-28");
  });
});
