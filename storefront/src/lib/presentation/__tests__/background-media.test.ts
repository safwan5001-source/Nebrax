import { describe, expect, it } from "vitest";
import {
  backgroundMediaPath,
  mediaBoundsLookup,
  sectionBackdrop,
} from "../background-media";
import type { PresentationHomeSection } from "../config";
import type { ResolvedMedia } from "../media-ref";
import { readResolvedMedia } from "../resolved-media";

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

function resolved(extra: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    width: 1600,
    height: 900,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "webp",
        src: `/api/storefront/media/customizer/${A}/w-800.webp`,
      },
    ],
    ...extra,
  };
}

const hero = (
  id: string,
  background: unknown,
  visible = true,
): PresentationHomeSection =>
  ({
    id,
    type: "hero",
    visible,
    design: { background },
  }) as PresentationHomeSection;

describe("section background media (CUST-HV V6b-3)", () => {
  it("keys paths by the section's index in the WHOLE list, hidden sections included", () => {
    expect(backgroundMediaPath(3, "media")).toBe(
      "homepage.sections.3.design.background.media",
    );
    expect(backgroundMediaPath(0, "mobile")).toBe(
      "homepage.sections.0.design.background.mobile",
    );
  });

  it("bounds are looked up by reference identity, so two sections using one picture stay independent", () => {
    const first = { mediaId: A, decorative: true as const };
    const second = { mediaId: A, decorative: true as const };
    const sections = [
      hero("a", { kind: "media", media: first }, false), // hidden, still index 0
      hero("b", { kind: "media", media: second }),
    ];
    const bounds = mediaBoundsLookup(sections, {
      [backgroundMediaPath(0, "media")]: resolved({
        contrast: { min: [0, 0, 0], max: [10, 10, 10] },
      }),
      [backgroundMediaPath(1, "media")]: resolved({
        contrast: { min: [200, 200, 200], max: [255, 255, 255] },
      }),
    });
    expect(bounds(first)?.max).toEqual([10, 10, 10]);
    expect(bounds(second)?.min).toEqual([200, 200, 200]);
    expect(bounds({ mediaId: A })).toBeNull();
  });

  it("a picture the server did not prove (no contrast) has no bounds, and no resolved picture means no backdrop", () => {
    const ref = { mediaId: A, decorative: true as const };
    const section = hero("a", { kind: "media", media: ref });
    expect(
      mediaBoundsLookup([section], {
        [backgroundMediaPath(0, "media")]: resolved(),
      })(ref),
    ).toBeNull();
    expect(sectionBackdrop(section, 0, {})).toBeNull();
    expect(
      sectionBackdrop(hero("x", { kind: "solid", color: { hex: "#fff" } }), 0, {
        [backgroundMediaPath(0, "media")]: resolved(),
      }),
    ).toBeNull();
  });

  it("the backdrop carries the default picture, the focal point, the phone picture and whether there is an overlay", () => {
    const section = hero("a", {
      kind: "media",
      media: { mediaId: A, decorative: true, focal: { x: 20, y: 70 } },
      mobile: { mediaId: B, decorative: true },
      overlay: { color: { role: "overlay" }, alpha: 40 },
    });
    const data = sectionBackdrop(section, 0, {
      [backgroundMediaPath(0, "media")]: resolved(),
      [backgroundMediaPath(0, "mobile")]: resolved({ width: 700 }),
    });
    expect(data?.media.width).toBe(1600);
    expect(data?.mobile?.width).toBe(700);
    expect(data?.focal).toEqual({ x: 20, y: 70 });
    expect(data?.overlay).toBe(true);
  });

  it("reads contrast bounds defensively: only a valid, ordered 3-channel range survives", () => {
    const entry = (contrast: unknown) =>
      readResolvedMedia({
        p: {
          width: 10,
          height: 10,
          decorative: true,
          alt: {},
          sources: [
            {
              kind: "w",
              width: 10,
              height: 10,
              format: "jpg",
              src: `/api/storefront/media/customizer/${A}/100w.jpg`,
            },
          ],
          contrast,
        },
      }).p;
    expect(entry({ min: [0, 1, 2], max: [3, 4, 5] })?.contrast).toEqual({
      min: [0, 1, 2],
      max: [3, 4, 5],
    });
    for (const bad of [
      { min: [0, 1], max: [3, 4, 5] },
      { min: [0, 1, 2], max: [3, 4] },
      { min: [9, 1, 2], max: [3, 4, 5] },
      { min: [0, 1, 256], max: [3, 4, 300] },
      { min: [0, 1.5, 2], max: [3, 4, 5] },
      { min: "0", max: "1" },
      null,
      "x",
    ]) {
      expect(entry(bad)).toBeDefined();
      expect(entry(bad)?.contrast).toBeUndefined();
    }
  });
});
