import { describe, expect, it } from "vitest";
import {
  categoryInitial,
  categorySwatch,
  imageSizes,
  LAYOUT_DEFAULTS,
  LAYOUT_PLACEMENTS,
  LAYOUT_SHAPES,
  resolveCategoryDisplay,
} from "../categories-display";
import {
  type CategoryDisplay,
  DISPLAY_LAYOUTS,
  type DisplayLayout,
  normalizeDisplay,
} from "../section-design";

const resolve = (display: CategoryDisplay, dir: "ltr" | "rtl" = "ltr") =>
  resolveCategoryDisplay(display, dir);

describe("categories display — per-layout defaults (AWJ-STORE-CAT-DESIGN-01)", () => {
  it("every layout resolves from a bare layout with no undefined or NaN custom property", () => {
    for (const layout of DISPLAY_LAYOUTS) {
      const r = resolve({ layout });
      expect(r.layout).toBe(layout);
      for (const [name, value] of Object.entries(r.vars)) {
        expect(value, `${layout} ${name}`).toBeTruthy();
        expect(value, `${layout} ${name}`).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it("each layout starts from its own rhythm, close to the classic tile's 12px gap and bordered card", () => {
    expect(resolve({ layout: "grid" }).columns).toEqual({
      mobile: 2,
      tablet: 3,
      desktop: 6,
    });
    expect(resolve({ layout: "grid" }).gap).toEqual({
      mobile: 12,
      tablet: 12,
      desktop: 12,
    });
    expect(resolve({ layout: "grid" }).card.style).toBe("border");
    expect(resolve({ layout: "circles" }).card.style).toBe("none");
    expect(resolve({ layout: "image_tiles" }).name.placement).toBe("overlay");
    expect(resolve({ layout: "compact_list" }).name.placement).toBe("beside");
    expect(resolve({ layout: "circles" }).image.shape).toBe("circle");
    expect(resolve({ layout: "horizontal_scroll" }).itemWidth).toEqual({
      mobile: 140,
      tablet: 160,
      desktop: 180,
    });
  });

  it("scrolling layouts are the fixed-width ones; the rest use columns", () => {
    expect(resolve({ layout: "horizontal_scroll" }).scroll).toBe(true);
    expect(resolve({ layout: "circles" }).scroll).toBe(true);
    for (const layout of ["grid", "image_tiles", "compact_list"] as const) {
      expect(resolve({ layout }).scroll).toBe(false);
    }
  });
});

describe("categories display — responsive overrides", () => {
  it("each device overrides on its own; an unset device keeps the layout default", () => {
    const r = resolve({
      layout: "grid",
      columns: { desktop: 4 },
      gap: { mobile: 8 },
    });
    expect(r.columns).toEqual({ mobile: 2, tablet: 3, desktop: 4 });
    expect(r.gap).toEqual({ mobile: 8, tablet: 12, desktop: 12 });
    expect(r.vars["--cd-cols-d"]).toBe("4");
    expect(r.vars["--cd-gap-m"]).toBe("8px");
    expect(r.vars["--cd-gap-t"]).toBe("12px");
  });

  it("a custom image height replaces the aspect ratio on that device only", () => {
    const r = resolve({
      layout: "grid",
      image: { aspect: "16:9", height: { tablet: 140 } },
    });
    expect(r.vars["--cd-ar-m"]).toBe("16 / 9");
    expect(r.vars["--cd-h-m"]).toBe("auto");
    expect(r.vars["--cd-ar-t"]).toBe("auto");
    expect(r.vars["--cd-h-t"]).toBe("140px");
    expect(r.vars["--cd-ar-d"]).toBe("16 / 9");
    expect(r.image.heights).toEqual({
      mobile: null,
      tablet: 140,
      desktop: null,
    });
  });

  it("a circle's custom height is its diameter and its ratio stays 1:1", () => {
    const r = resolve({
      layout: "circles",
      image: { height: { desktop: 96 } },
    });
    expect(r.vars["--cd-ar-d"]).toBe("1 / 1");
    expect(r.vars["--cd-h-d"]).toBe("auto");
    expect(r.vars["--cd-w-d"]).toBe("96px");
    expect(r.vars["--cd-w-m"]).toBe("100%");
  });

  it("a square or circle ignores the chosen aspect (the shape decides)", () => {
    expect(
      resolve({ layout: "grid", image: { shape: "square", aspect: "16:9" } })
        .vars["--cd-ar-m"],
    ).toBe("1 / 1");
    expect(
      resolve({ layout: "grid", image: { shape: "rect", aspect: "3:2" } }).vars[
        "--cd-ar-m"
      ],
    ).toBe("3 / 2");
  });

  it("compact thumbnails are bounded to 32-96px whatever height was stored", () => {
    const r = resolve({
      layout: "compact_list",
      image: { height: { mobile: 400, tablet: 48 } },
    });
    expect(r.vars["--cd-thumb-m"]).toBe("96px");
    expect(r.vars["--cd-thumb-t"]).toBe("48px");
    expect(r.vars["--cd-thumb-d"]).toBe("48px");
  });
});

describe("categories display — a layout only offers what it can draw", () => {
  it("coerces a placement the layout does not support to the layout's own", () => {
    expect(
      resolve({ layout: "circles", name: { placement: "overlay" } }).name
        .placement,
    ).toBe("below");
    expect(
      resolve({ layout: "circles", name: { placement: "beside" } }).name
        .placement,
    ).toBe("below");
    expect(
      resolve({ layout: "compact_list", name: { placement: "above" } }).name
        .placement,
    ).toBe("beside");
    expect(
      resolve({ layout: "horizontal_scroll", name: { placement: "beside" } })
        .name.placement,
    ).toBe("below");
    expect(
      resolve({ layout: "grid", name: { placement: "beside" } }).name.placement,
    ).toBe("beside");
  });

  it("coerces an image shape the layout does not support", () => {
    expect(
      resolve({ layout: "circles", image: { shape: "rect" } }).image.shape,
    ).toBe("circle");
    expect(
      resolve({ layout: "image_tiles", image: { shape: "circle" } }).image
        .shape,
    ).toBe("rect");
    expect(
      resolve({ layout: "compact_list", image: { shape: "rect" } }).image.shape,
    ).toBe("square");
  });

  it("the lists the editor offers agree with what the resolver accepts", () => {
    for (const layout of DISPLAY_LAYOUTS) {
      for (const placement of LAYOUT_PLACEMENTS[layout]) {
        expect(resolve({ layout, name: { placement } }).name.placement).toBe(
          placement,
        );
      }
      for (const shape of LAYOUT_SHAPES[layout]) {
        expect(resolve({ layout, image: { shape } }).image.shape).toBe(shape);
      }
    }
  });

  it("every layout default is itself inside what the layout supports", () => {
    for (const layout of DISPLAY_LAYOUTS as readonly DisplayLayout[]) {
      expect(LAYOUT_DEFAULTS[layout].columns.mobile).toBeGreaterThanOrEqual(1);
      expect(LAYOUT_PLACEMENTS[layout].length).toBeGreaterThan(0);
    }
  });
});

describe("categories display — card", () => {
  it("the card style implies a frame, and an explicit field overrides it", () => {
    const none = resolve({ layout: "grid", card: { style: "none" } }).vars;
    expect(none["--cd-bw"]).toBe("0px");
    expect(none["--cd-bg"]).toBe("transparent");
    expect(none["--cd-shadow"]).toBe("none");

    const border = resolve({ layout: "grid", card: { style: "border" } }).vars;
    expect(border["--cd-bw"]).toBe("1px");
    expect(border["--cd-bc"]).toBe("var(--store-border)");

    const shadow = resolve({ layout: "grid", card: { style: "shadow" } }).vars;
    expect(shadow["--cd-bw"]).toBe("0px");
    expect(shadow["--cd-shadow"]).toMatch(/^0 1px 3px/); // soft by default, never heavy

    const filled = resolve({ layout: "grid", card: { style: "filled" } }).vars;
    expect(filled["--cd-bg"]).toBe("var(--store-surface-muted)");

    const custom = resolve({
      layout: "grid",
      card: {
        style: "none",
        borderWidth: 3,
        borderColor: "primary",
        background: "muted",
      },
    }).vars;
    expect(custom["--cd-bw"]).toBe("3px");
    expect(custom["--cd-bc"]).toBe("var(--store-primary)");
    expect(custom["--cd-bg"]).toBe("var(--store-surface-muted)");
  });

  it("radius and padding are the stored pixels; an absent radius keeps the theme's", () => {
    const r = resolve({
      layout: "grid",
      card: { radius: 20, padding: 6 },
    }).vars;
    expect(r["--cd-radius"]).toBe("20px");
    expect(r["--cd-pad"]).toBe("6px");
    expect(resolve({ layout: "grid" }).vars["--cd-radius"]).toBe(
      "var(--store-radius, 0.75rem)",
    );
    expect(
      resolve({ layout: "grid", card: { radius: 0 } }).vars["--cd-radius"],
    ).toBe("0px");
  });

  it("only theme tokens ever reach a colour property — no stored text becomes CSS", () => {
    const r = resolve({
      layout: "grid",
      card: { background: "surface", borderColor: "accent" },
      name: { color: "primary" },
    });
    for (const key of ["--cd-bg", "--cd-bc", "--cd-name-color"]) {
      expect(r.vars[key]).toMatch(
        /^(var\(--store-[a-z-]+(, .+)?\)|transparent)$/,
      );
    }
  });

  it("hover is off unless asked, and is a colour/edge change only", () => {
    expect(resolve({ layout: "grid" }).card.hover).toBe(false);
    expect(
      resolve({ layout: "grid", card: { hover: "subtle" } }).card.hover,
    ).toBe(true);
  });
});

describe("categories display — name", () => {
  it("an overlaid name always has a contrast-proven backing", () => {
    const none = resolve({
      layout: "image_tiles",
      name: { background: "none" },
    });
    expect(none.name.placement).toBe("overlay");
    expect(none.name.background).toBe("scrim");
    expect(none.vars["--cd-name-color"]).toBe(
      "var(--store-scrim-foreground, #fff)",
    );

    const defaulted = resolve({
      layout: "grid",
      name: { placement: "overlay" },
    });
    expect(defaulted.name.background).toBe("scrim");

    // On a themed surface the name keeps its own token colour.
    const surface = resolve({
      layout: "grid",
      name: { placement: "overlay", background: "surface", color: "primary" },
    });
    expect(surface.name.background).toBe("surface");
    expect(surface.vars["--cd-name-color"]).toBe("var(--store-primary)");
  });

  it("a scrim in a non-overlay placement also takes the scrim's foreground", () => {
    const r = resolve({
      layout: "grid",
      name: { background: "scrim", color: "primary" },
    });
    expect(r.vars["--cd-name-color"]).toBe(
      "var(--store-scrim-foreground, #fff)",
    );
  });

  it("hiding the name hides it, but hiding the image too keeps it (a tile is never blank)", () => {
    expect(resolve({ layout: "grid", name: { show: false } }).name.show).toBe(
      false,
    );
    expect(resolve({ layout: "grid", image: { show: false } }).name.show).toBe(
      true,
    );
    expect(
      resolve({ layout: "grid", image: { show: false }, name: { show: false } })
        .name.show,
    ).toBe(true);
  });

  it("size, weight, alignment and clamp reach the stylesheet as plain values", () => {
    const r = resolve({
      layout: "grid",
      name: { size: 20, weight: 800, align: "end", lines: 1 },
    });
    expect(r.vars["--cd-name-size"]).toBe("20px");
    expect(r.vars["--cd-name-weight"]).toBe("800");
    expect(r.vars["--cd-name-align"]).toBe("end");
    expect(r.vars["--cd-lines"]).toBe("1");
    expect(r.name.lines).toBe(1);
    const natural = resolve({ layout: "grid", name: { lines: "natural" } });
    expect(natural.name.lines).toBeNull();
    expect(natural.vars["--cd-lines"]).toBe("none");
  });
});

describe("categories display — image positioning and RTL", () => {
  it("start/end follow the writing direction; top/bottom/center do not", () => {
    const at = (
      position: "start" | "end" | "top" | "bottom" | "center",
      dir: "ltr" | "rtl",
    ) => resolve({ layout: "grid", image: { position } }, dir).vars["--cd-op"];
    expect(at("start", "ltr")).toBe("left center");
    expect(at("start", "rtl")).toBe("right center");
    expect(at("end", "ltr")).toBe("right center");
    expect(at("end", "rtl")).toBe("left center");
    expect(at("top", "rtl")).toBe("center top");
    expect(at("bottom", "ltr")).toBe("center bottom");
    expect(at("center", "rtl")).toBe("center center");
  });

  it("fit is cover unless contain is chosen", () => {
    expect(resolve({ layout: "grid" }).vars["--cd-fit"]).toBe("cover");
    expect(
      resolve({ layout: "grid", image: { fit: "contain" } }).vars["--cd-fit"],
    ).toBe("contain");
  });
});

describe("categories display — sizes hint", () => {
  it("grid layouts use one column's share of the viewport, scrolling layouts the fixed width", () => {
    expect(imageSizes(resolve({ layout: "grid" }))).toBe(
      "(min-width: 1024px) 17vw, (min-width: 640px) 33vw, 50vw",
    );
    expect(imageSizes(resolve({ layout: "circles" }))).toBe(
      "(min-width: 1024px) 120px, (min-width: 640px) 104px, 88px",
    );
  });
});

describe("categories display — fallback frame helpers", () => {
  it("uses the merchant's colour only when it is a plain hex literal", () => {
    expect(categorySwatch("#12372a")?.background).toBe("#12372a");
    expect(categorySwatch("#ABC")?.background).toBe("#aabbcc");
    expect(categorySwatch("red")).toBeNull();
    expect(categorySwatch("url(javascript:alert(1))")).toBeNull();
    expect(categorySwatch("#12372a; background:url(x)")).toBeNull();
    expect(categorySwatch(null)).toBeNull();
  });

  it("picks the initial's colour for >= 4.5:1 over any merchant colour", () => {
    const lum = (hex: string) => {
      const channels = [1, 3, 5].map((i) => {
        const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    for (const hex of [
      "#ffffff",
      "#000000",
      "#ffd400",
      "#12372a",
      "#808080",
      "#ff0000",
      "#00a2ff",
      "#7a7a7a",
    ]) {
      const swatch = categorySwatch(hex);
      expect(swatch).not.toBeNull();
      const a = lum(hex);
      const b = lum((swatch as { foreground: string }).foreground);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio, hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("takes the first code point as the initial", () => {
    expect(categoryInitial("  إلكترونيات")).toBe("إ");
    expect(categoryInitial("shoes")).toBe("S");
    expect(categoryInitial("😀 fun")).toBe("😀");
    expect(categoryInitial("   ")).toBe("");
  });
});

describe("categories display — round trip through the contract normalizer", () => {
  it("a normalized display resolves identically after another normalization (fixed point)", () => {
    const raw = {
      layout: "image_tiles",
      columns: { mobile: 9, desktop: 5 },
      card: { radius: 99, hover: "subtle" },
      name: { placement: "below", size: 3 },
    };
    const once = normalizeDisplay(raw) as CategoryDisplay;
    const twice = normalizeDisplay(once) as CategoryDisplay;
    expect(twice).toEqual(once);
    expect(resolve(once)).toEqual(resolve(twice));
    expect(resolve(once).columns).toEqual({ mobile: 4, tablet: 3, desktop: 5 });
    expect(resolve(once).vars["--cd-radius"]).toBe("32px");
    expect(resolve(once).vars["--cd-name-size"]).toBe("12px");
  });
});
