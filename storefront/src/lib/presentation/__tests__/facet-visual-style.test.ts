import { describe, expect, it } from "vitest";
import { FACET_VISUAL_SHAPES, FACET_VISUAL_SIZES } from "../facet-visual";
import {
  contrastRatio,
  FACET_ICON_MIN_CONTRAST,
  FACET_SHAPE_GEOMETRY,
  FACET_VISUAL_SIZE_PX,
  facetImageStyle,
  facetShapeFrameStyle,
  readableIconColor,
} from "../facet-visual-style";

describe("facet shape engine (VD-2)", () => {
  it("defines geometry for exactly the closed shape list, each by one technique", () => {
    expect(Object.keys(FACET_SHAPE_GEOMETRY)).toEqual([...FACET_VISUAL_SHAPES]);
    for (const shape of FACET_VISUAL_SHAPES) {
      const g = FACET_SHAPE_GEOMETRY[shape];
      const techniques = [g.radius, g.polygon, g.maskPath].filter(
        (t) => t !== undefined,
      );
      expect(techniques, shape).toHaveLength(1);
      expect(["1 / 1", "4 / 3", "3 / 4"]).toContain(g.aspect);
    }
  });

  it("uses CSS for simple shapes, percentage polygons for star/diamond/hexagon and masks for curves", () => {
    expect(facetShapeFrameStyle("circle")).toMatchObject({
      borderRadius: "50%",
      aspectRatio: "1 / 1",
    });
    expect(facetShapeFrameStyle("portrait")).toMatchObject({
      aspectRatio: "3 / 4",
    });
    for (const shape of ["star", "diamond", "hexagon"] as const) {
      const style = facetShapeFrameStyle(shape);
      expect(style.clipPath).toMatch(/^polygon\(/);
      // Responsive: every coordinate is a percentage (no fixed lengths, no `path()`).
      expect(
        style.clipPath
          .replace(/^polygon\(|\)$/g, "")
          .split(/[\s,]+/)
          .every((p) => p.endsWith("%")),
      ).toBe(true);
    }
    for (const shape of ["heart", "vase", "arch"] as const) {
      const style = facetShapeFrameStyle(shape);
      expect(style.maskImage).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(style.WebkitMaskImage).toBe(style.maskImage);
      expect(style.maskSize).toBe("100% 100%");
      expect(decodeURIComponent(style.maskImage)).toContain(
        "preserveAspectRatio='none'",
      );
      expect(style.clipPath).toBeUndefined();
    }
  });

  it("geometry is code-owned: mask paths are plain path commands, no markup or script", () => {
    for (const shape of FACET_VISUAL_SHAPES) {
      const path = FACET_SHAPE_GEOMETRY[shape].maskPath;
      if (path) expect(path).toMatch(/^[MLHVCZ0-9 .-]+$/);
    }
  });

  it("an unknown shape falls back to the circle", () => {
    // @ts-expect-error — defensive: data could carry a shape added in a later release.
    expect(facetShapeFrameStyle("blob")).toEqual(
      facetShapeFrameStyle("circle"),
    );
  });

  it("sizes cover the closed size list and grow monotonically", () => {
    expect(Object.keys(FACET_VISUAL_SIZE_PX)).toEqual([...FACET_VISUAL_SIZES]);
    expect(FACET_VISUAL_SIZE_PX.sm).toBeLessThan(FACET_VISUAL_SIZE_PX.md);
    expect(FACET_VISUAL_SIZE_PX.md).toBeLessThan(FACET_VISUAL_SIZE_PX.lg);
    // The smallest tile still beats the WCAG 2.5.8 target size (24px) and the AWJ 44px touch target.
    expect(FACET_VISUAL_SIZE_PX.sm).toBeGreaterThanOrEqual(44);
  });

  it("frames an image with fit, focal point and zoom in CSS only", () => {
    expect(facetImageStyle({ fit: "cover" })).toEqual({
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "50% 50%",
    });
    expect(
      facetImageStyle({ fit: "contain", focal: { x: 20, y: 80 }, zoom: 1.4 }),
    ).toEqual({
      width: "100%",
      height: "100%",
      objectFit: "contain",
      objectPosition: "20% 80%",
      transform: "scale(1.4)",
      transformOrigin: "20% 80%",
    });
  });
});

describe("icon colour contrast guard (WCAG 2.2 SC 1.4.11)", () => {
  it("computes the WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("keeps a readable colour, drops an unreadable one, and ignores invalid input", () => {
    expect(readableIconColor("#9d2449", "#fdf2f4")).toBe("#9d2449");
    expect(contrastRatio("#f5f5f5", "#ffffff")).toBeLessThan(
      FACET_ICON_MIN_CONTRAST,
    );
    expect(readableIconColor("#f5f5f5", "#ffffff")).toBeUndefined();
    expect(readableIconColor("#9d2449", undefined)).toBe("#9d2449");
    expect(readableIconColor(undefined, "#ffffff")).toBeUndefined();
    expect(readableIconColor("red", "#ffffff")).toBeUndefined();
  });
});
