import { describe, expect, it } from "vitest";
import type { DiscoveryOption } from "@/lib/commerce/data-sections";
import type { ListingFacetImageSource } from "@/lib/commerce/listing-facets";
import {
  buildDiscoveryItems,
  carouselItemWidthPx,
  discoveryColumnVars,
  discoveryMaxItems,
  discoveryRows,
  discoveryTileImage,
  resolveDiscoveryOptionVisual,
  sortDiscoveryOptions,
  visibleDiscoveryOptions,
} from "../discovery-items";
import { resolveDiscoveryDisplay } from "../discovery-templates";
import type { DiscoveryContent, DiscoveryLayout } from "../section-content";

const M1 = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const V = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const path = (file: string) =>
  `/api/storefront/media/facet-visuals/${V}/${M1}/${file}`;
const SOURCES: ListingFacetImageSource[] = [
  { width: 160, format: "webp", src: path("thumb-160.webp") },
  { width: 160, format: "jpg", src: path("thumb-160.jpg") },
  { width: 320, format: "webp", src: path("thumb-320.webp") },
  { width: 320, format: "jpg", src: path("thumb-320.jpg") },
  { width: 480, format: "webp", src: path("480w.webp") },
  { width: 768, format: "jpg", src: path("768w.jpg") },
];

const base: DiscoveryContent = {
  title: "",
  axis: "facet",
  dimension: "occasion",
  display: "tiles",
};
const display = (over: Partial<DiscoveryContent> = {}) =>
  resolveDiscoveryDisplay({ ...base, ...over });
const layoutDisplay = (layout: DiscoveryLayout, over = {}) => {
  const d = display({ layout, ...over });
  return { ...d, layout };
};
const option = (
  value: string,
  count: number,
  extra: Partial<DiscoveryOption> = {},
): DiscoveryOption => ({ value, name: value.toUpperCase(), count, ...extra });

describe("sortDiscoveryOptions / visibleDiscoveryOptions", () => {
  const options = [
    option("a", 3),
    option("b", 9),
    option("c", 3),
    option("d", 9),
  ];

  it("merchant keeps the API order and never mutates the input", () => {
    const before = [...options];
    expect(
      sortDiscoveryOptions(options, "merchant").map((o) => o.value),
    ).toEqual(["a", "b", "c", "d"]);
    expect(options).toEqual(before);
  });

  it("count sorts by count descending, ties in API order", () => {
    expect(sortDiscoveryOptions(options, "count").map((o) => o.value)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    expect(options.map((o) => o.value)).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts before capping, so the cap keeps the highest counts", () => {
    const many = Array.from({ length: 30 }, (_, i) => option(`v${i}`, i));
    const top = visibleDiscoveryOptions(
      many,
      display({ valueSort: "count", maxItems: 4 }),
    );
    expect(top.map((o) => o.value)).toEqual(["v29", "v28", "v27", "v26"]);
  });

  it("defaults to the legacy cap of 12 and clamps maxItems to 4–24", () => {
    const many = Array.from({ length: 40 }, (_, i) => option(`v${i}`, 1));
    expect(visibleDiscoveryOptions(many, display())).toHaveLength(12);
    expect(
      visibleDiscoveryOptions(many, display({ maxItems: 24 })),
    ).toHaveLength(24);
    expect(discoveryMaxItems(2)).toBe(4);
    expect(discoveryMaxItems(99)).toBe(24);
    expect(discoveryMaxItems(Number.NaN)).toBe(12);
    expect(discoveryMaxItems(7.9)).toBe(7);
  });
});

describe("discoveryTileImage", () => {
  it("prefers WebP, lists real widths ascending and picks a 2x fallback src", () => {
    const image = discoveryTileImage(SOURCES, 80);
    expect(image?.srcSet).toBe(
      `${path("thumb-160.webp")} 160w, ${path("thumb-320.webp")} 320w, ${path("480w.webp")} 480w`,
    );
    expect(image?.src).toBe(path("thumb-160.webp"));
    expect(discoveryTileImage(SOURCES, 112)?.src).toBe(path("thumb-320.webp"));
    expect(discoveryTileImage(SOURCES, 400)?.src).toBe(path("480w.webp"));
  });

  it("falls back to JPEG when no WebP exists, and to null without sources", () => {
    const jpg = SOURCES.filter((s) => s.format === "jpg");
    expect(discoveryTileImage(jpg, 80)?.srcSet).toContain("768w.jpg 768w");
    expect(discoveryTileImage(jpg, 80)?.srcSet).not.toContain(".webp");
    expect(discoveryTileImage([], 80)).toBeNull();
    expect(discoveryTileImage(undefined, 80)).toBeNull();
  });
});

describe("resolver wiring (D-08 per-property chain)", () => {
  const withImage = option("eid", 5, {
    visual: { image: { mediaId: M1, fit: "cover" }, shape: "heart" },
    imageSources: SOURCES,
  });

  it("section-explicit values beat the value's own, the value beats facet defaults, which beat the template", () => {
    const d = display({ template: "boutique-arches", shape: "star" });
    // section shape wins over the value's heart; size is not explicit => template lg
    const v = resolveDiscoveryOptionVisual(
      withImage,
      { shape: "diamond", size: "sm" },
      d,
      "image-cards",
    );
    expect(v.shape).toBe("star");
    // value has no size => facet default sm beats the template's lg
    expect(v.size).toBe("sm");

    const noSection = display({ template: "boutique-arches" });
    const v2 = resolveDiscoveryOptionVisual(
      withImage,
      undefined,
      noSection,
      "image-cards",
    );
    expect(v2.shape).toBe("heart"); // value's own, above the template's arch
    expect(v2.size).toBe("lg"); // template, nothing above sets it
  });

  it("the template fills in only what nothing above set; the system default is last", () => {
    const plain = option("x", 1);
    expect(
      resolveDiscoveryOptionVisual(
        plain,
        undefined,
        display({ template: "boutique-arches" }),
        "image-cards",
      ),
    ).toMatchObject({ shape: "arch", size: "lg", showLabel: true });
    expect(
      resolveDiscoveryOptionVisual(plain, undefined, display(), "image-grid"),
    ).toMatchObject({ shape: "circle", size: "md", showLabel: true });
  });

  it("section showLabel=false hides every label, even one a value asked to show", () => {
    const shown = option("x", 1, { visual: { showLabel: true } });
    expect(
      resolveDiscoveryOptionVisual(
        shown,
        undefined,
        display({ showLabel: false }),
        "image-grid",
      ).showLabel,
    ).toBe(false);
    expect(
      resolveDiscoveryOptionVisual(shown, undefined, display(), "image-grid")
        .showLabel,
    ).toBe(true);
  });

  it("an image keeps its fallback icon from the facet defaults (image -> icon -> text)", () => {
    const v = resolveDiscoveryOptionVisual(
      withImage,
      { icon: "gift" },
      display(),
      "image-grid",
    );
    expect(v.content).toBe("image");
    expect(v.fallbackIcon).toBe("gift");
  });

  it("an image without usable sources never reaches the resolver as an image", () => {
    // the listing parser already removes it; defensive: no sources => not usable
    const noSources = option("eid", 5, {
      visual: { image: { mediaId: M1, fit: "cover" } },
    });
    const v = resolveDiscoveryOptionVisual(
      noSources,
      { icon: "gift" },
      display(),
      "image-grid",
    );
    expect(v.content).toBe("icon");
    expect(v.icon).toBe("gift");
  });
});

describe("fallback frames and icon-grid ordering", () => {
  it("nothing set anywhere keeps a shaped frame with the initial (aligned grid), not a frameless label", () => {
    const v = resolveDiscoveryOptionVisual(
      option("x", 1),
      undefined,
      display(),
      "image-grid",
    );
    expect(v.content).toBe("icon");
    expect(v.icon).toBeUndefined();
    expect(v.shape).toBe("circle");
  });

  it("an explicit text-only choice stays frameless", () => {
    const v = resolveDiscoveryOptionVisual(
      option("x", 1, { visual: { content: "none" } }),
      undefined,
      display(),
      "image-grid",
    );
    expect(v.content).toBe("none");
  });

  it("asking for an unavailable icon still keeps the frame", () => {
    const v = resolveDiscoveryOptionVisual(
      option("x", 1, { visual: { content: "icon" } }),
      undefined,
      display(),
      "image-grid",
    );
    expect(v.content).toBe("icon");
    expect(v.icon).toBeUndefined();
  });

  it("icon-grid shows the resolved icon before the image; other layouts show the image", () => {
    const o = option("eid", 5, {
      visual: { image: { mediaId: M1, fit: "cover" }, icon: "gift" },
      imageSources: SOURCES,
    });
    const iconGrid = resolveDiscoveryOptionVisual(
      o,
      undefined,
      display(),
      "icon-grid",
    );
    expect(iconGrid).toMatchObject({ content: "icon", icon: "gift" });
    expect(iconGrid.image).toBeUndefined();
    const grid = resolveDiscoveryOptionVisual(
      o,
      undefined,
      display(),
      "image-grid",
    );
    expect(grid.content).toBe("image");
  });

  it("icon-grid falls back to the image, then to the initial, when there is no icon", () => {
    const img = option("eid", 5, {
      visual: { image: { mediaId: M1, fit: "cover" } },
      imageSources: SOURCES,
    });
    expect(
      resolveDiscoveryOptionVisual(img, undefined, display(), "icon-grid")
        .content,
    ).toBe("image");
    const none = resolveDiscoveryOptionVisual(
      option("x", 1),
      undefined,
      display(),
      "icon-grid",
    );
    expect(none).toMatchObject({ content: "icon" });
    expect(none.icon).toBeUndefined();
  });
});

describe("buildDiscoveryItems", () => {
  const values = {
    name: "المناسبة",
    options: [
      option("eid", 5, {
        visual: { image: { mediaId: M1, fit: "cover" } },
        imageSources: SOURCES,
      }),
      option("plain", 2),
    ],
  };

  it("carries name, slug, count, resolved visual and a tile image for an image value", () => {
    const items = buildDiscoveryItems(values, layoutDisplay("image-grid"));
    expect(items.map((i) => [i.value, i.name, i.count])).toEqual([
      ["eid", "EID", 5],
      ["plain", "PLAIN", 2],
    ]);
    expect(items[0].visual?.content).toBe("image");
    expect(items[0].image?.srcSet).toContain("160w");
    expect(items[1].image).toBeNull();
  });

  it("text-list draws no media at all", () => {
    const items = buildDiscoveryItems(values, layoutDisplay("text-list"));
    expect(items.every((i) => i.visual === null && i.image === null)).toBe(
      true,
    );
  });

  it("brand-like options (no visual, no defaults) become initial frames", () => {
    const brands = { name: "", options: [option("b1", 3), option("b2", 1)] };
    const items = buildDiscoveryItems(brands, layoutDisplay("image-grid"));
    expect(items.map((i) => i.visual?.content)).toEqual(["icon", "icon"]);
    expect(items.every((i) => i.image === null)).toBe(true);
  });

  it("applies valueSort and maxItems before building", () => {
    const many = {
      name: "x",
      options: Array.from({ length: 10 }, (_, i) => option(`v${i}`, i)),
    };
    const items = buildDiscoveryItems(
      many,
      layoutDisplay("image-grid", { valueSort: "count", maxItems: 4 }),
    );
    expect(items.map((i) => i.value)).toEqual(["v9", "v8", "v7", "v6"]);
  });
});

describe("geometry", () => {
  it("emits the three column variables, clamped to the contract ranges", () => {
    expect(discoveryColumnVars({ mobile: 3, tablet: 4, desktop: 6 })).toEqual({
      "--disc-cols-m": "3",
      "--disc-cols-t": "4",
      "--disc-cols-d": "6",
    });
    expect(discoveryColumnVars({ mobile: 9, tablet: 1, desktop: 99 })).toEqual({
      "--disc-cols-m": "4",
      "--disc-cols-t": "2",
      "--disc-cols-d": "8",
    });
    expect(
      discoveryColumnVars({ mobile: Number.NaN, tablet: 3, desktop: 4 })[
        "--disc-cols-m"
      ],
    ).toBe("1");
  });

  it("columns resolve section -> template -> default per device", () => {
    expect(display({ template: "market-icons" }).columns).toEqual({
      mobile: 4,
      tablet: 6,
      desktop: 8,
    });
    expect(
      display({ template: "market-icons", columns: { mobile: 2 } }).columns,
    ).toEqual({
      mobile: 2,
      tablet: 6,
      desktop: 8,
    });
    expect(display().columns).toEqual({ mobile: 2, tablet: 3, desktop: 4 });
  });

  it("rows are 1–2 and only a carousel can have two", () => {
    expect(discoveryRows(5)).toBe(2);
    expect(discoveryRows(0)).toBe(1);
    expect(display({ layout: "carousel", rows: 2 }).rows).toBe(2);
    expect(display({ layout: "image-grid", rows: 2 }).rows).toBe(1);
    expect(display({ template: "swipe-rail" }).rows).toBe(2);
  });

  it("a carousel column fits its widest frame plus padding, with a floor", () => {
    const item = (size: "sm" | "md" | "lg") => ({
      value: size,
      name: size,
      count: 1,
      visual: {
        content: "none" as const,
        shape: "circle" as const,
        size,
        showLabel: true,
      },
      image: null,
    });
    expect(carouselItemWidthPx([item("sm")])).toBe(88);
    expect(carouselItemWidthPx([item("sm"), item("lg")])).toBe(136);
    expect(carouselItemWidthPx([])).toBe(88);
  });
});
