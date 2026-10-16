import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPreset,
  explicitCount,
  resetGroup,
  resetResponsive,
  sameDisplay,
  setDevice,
  setField,
  setImageHeight,
  setLayout,
} from "../categories-display-edit";
import { CATEGORIES_DISPLAY_MESSAGES } from "../categories-display-messages";
import {
  CATEGORY_DISPLAY_PRESET_IDS,
  CATEGORY_DISPLAY_PRESETS,
  matchingPreset,
  presetById,
} from "../categories-display-presets";
import {
  LAYOUT_PLACEMENTS,
  LAYOUT_SHAPES,
  resolveCategoryDisplay,
} from "../presentation/categories-display";
import { CUSTOMIZER_MESSAGES } from "../messages";
import {
  type CategoryDisplay,
  DISPLAY_LAYOUTS,
  normalizeDisplay,
} from "../presentation/section-design";

const repo = (path: string) => readFileSync(resolve(process.cwd(), "..", path), "utf8");

/**
 * AWJ-STORE-CAT-DESIGN-01 — the builder's side of the categories display: byte-identical twins of the storefront's
 * contract / resolver / stylesheet / view, and the pure edit helpers + presets that sit on top of them.
 */
describe("twins of the storefront (the preview is the storefront's own code)", () => {
  const pairs: Array<[string, string]> = [
    [
      "web/src/modules/store-experience-builder/presentation/section-design.ts",
      "storefront/src/lib/presentation/section-design.ts",
    ],
    [
      "web/src/modules/store-experience-builder/presentation/categories-display.ts",
      "storefront/src/lib/presentation/categories-display.ts",
    ],
    [
      "web/src/modules/store-experience-builder/categories-display.css",
      "storefront/src/components/home/categories-display.css",
    ],
  ];
  for (const [web, storefront] of pairs) {
    it(`${web.split("/").pop()} is byte-identical to the storefront's`, () => {
      expect(repo(web)).toBe(repo(storefront));
    });
  }

  it("the view is the same component: identical from its first declaration down, only the import paths differ", () => {
    const body = (source: string) => source.slice(source.indexOf("/** One category as the view draws it"));
    expect(body(repo("web/src/modules/store-experience-builder/CategoryDisplayList.tsx"))).toBe(
      body(repo("storefront/src/components/home/CategoryDisplayList.tsx")),
    );
    const imports = (source: string) =>
      source
        .slice(0, source.indexOf("/** One category as the view draws it"))
        .replace(/@\/lib\/presentation\//g, "./presentation/");
    expect(imports(repo("storefront/src/components/home/CategoryDisplayList.tsx"))).toBe(
      imports(repo("web/src/modules/store-experience-builder/CategoryDisplayList.tsx")),
    );
  });
});

describe("setLayout", () => {
  it("creates a display from the classic look with the layout alone (every default stays unstored)", () => {
    expect(setLayout(undefined, "grid")).toEqual({ layout: "grid" });
    for (const layout of DISPLAY_LAYOUTS) {
      expect(setLayout(undefined, layout)).toEqual({ layout });
    }
  });

  it("switching layout prunes what the new layout cannot draw, and keeps what it can", () => {
    const grid: CategoryDisplay = {
      layout: "grid",
      columns: { mobile: 3, desktop: 5 },
      gap: { mobile: 8 },
      card: { radius: 20 },
      image: { shape: "rect", aspect: "3:2", fit: "contain" },
      name: { placement: "beside", align: "end", size: 18 },
    };
    const circles = setLayout(grid, "circles") as CategoryDisplay;
    expect(circles.layout).toBe("circles");
    expect(circles.columns).toBeUndefined(); // scrolling layouts have no column count
    expect(circles.image?.shape).toBeUndefined(); // circles are always round
    expect(circles.name?.placement).toBeUndefined(); // "beside" is not a circles placement
    // …but everything else survives.
    expect(circles.gap).toEqual({ mobile: 8 });
    expect(circles.card).toEqual({ radius: 20 });
    expect(circles.image).toEqual({ aspect: "3:2", fit: "contain" });
    expect(circles.name).toEqual({ align: "end", size: 18 });

    const back = setLayout(circles, "grid") as CategoryDisplay;
    expect(back.itemWidth).toBeUndefined();
  });

  it("never leaves a combination the resolver would have to coerce", () => {
    const messy: CategoryDisplay = {
      layout: "grid",
      itemWidth: { mobile: 100 },
      image: { shape: "circle" },
      name: { placement: "overlay" },
    };
    for (const layout of DISPLAY_LAYOUTS) {
      const next = setLayout(messy, layout) as CategoryDisplay;
      if (next.name?.placement) expect(LAYOUT_PLACEMENTS[layout]).toContain(next.name.placement);
      if (next.image?.shape) expect(LAYOUT_SHAPES[layout]).toContain(next.image.shape);
    }
  });

  it("does not mutate its input", () => {
    const input: CategoryDisplay = { layout: "grid", columns: { mobile: 2 }, name: { placement: "beside" } };
    const snapshot = JSON.stringify(input);
    setLayout(input, "circles");
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("field edits", () => {
  const base: CategoryDisplay = { layout: "grid" };

  it("setField writes through the normalizer: canonical order, clamped integers, dropped invalid values", () => {
    const next = setField(base, "card", "radius", 99) as CategoryDisplay;
    expect(next).toEqual({ layout: "grid", card: { radius: 32 } });
    const sized = setField(next, "name", "size", 3) as CategoryDisplay;
    expect(sized.name).toEqual({ size: 12 });
    expect(Object.keys(sized)).toEqual(["layout", "card", "name"]);
    // @ts-expect-error — an invalid enum value is dropped, never stored
    expect(setField(base, "card", "style", "glow")).toEqual({ layout: "grid" });
  });

  it("setField with undefined deletes the key and an emptied group disappears", () => {
    const withRadius = setField(base, "card", "radius", 10) as CategoryDisplay;
    expect(setField(withRadius, "card", "radius", undefined)).toEqual({ layout: "grid" });
    const two = setField(withRadius, "card", "padding", 4) as CategoryDisplay;
    expect(setField(two, "card", "radius", undefined)).toEqual({ layout: "grid", card: { padding: 4 } });
  });

  it("show is only ever stored as false", () => {
    const hidden = setField(base, "name", "show", false) as CategoryDisplay;
    expect(hidden.name).toEqual({ show: false });
    expect(setField(hidden, "name", "show", undefined)).toEqual({ layout: "grid" });
  });

  it("edits on the classic look (no display) do nothing", () => {
    expect(setField(undefined, "card", "radius", 5)).toBeUndefined();
    expect(setDevice(undefined, "gap", "mobile", 8)).toBeUndefined();
  });

  it("setDevice sets, clamps and deletes one device at a time", () => {
    let d = setDevice(base, "columns", "mobile", 9) as CategoryDisplay;
    expect(d.columns).toEqual({ mobile: 4 });
    d = setDevice(d, "columns", "desktop", 5) as CategoryDisplay;
    expect(d.columns).toEqual({ mobile: 4, desktop: 5 });
    d = setDevice(d, "columns", "mobile", undefined) as CategoryDisplay;
    expect(d.columns).toEqual({ desktop: 5 });
    d = setDevice(d, "columns", "desktop", undefined) as CategoryDisplay;
    expect(d.columns).toBeUndefined();
    expect(setDevice(base, "gap", "tablet", 1)).toEqual({ layout: "grid", gap: { tablet: 4 } });
  });

  it("custom image height is per device and automatic again once none is left", () => {
    let d = setImageHeight(base, "desktop", 160) as CategoryDisplay;
    expect(d.image).toEqual({ height: { desktop: 160 } });
    d = setImageHeight(d, "mobile", 9999) as CategoryDisplay;
    expect(d.image?.height).toEqual({ mobile: 400, desktop: 160 });
    d = setImageHeight(d, "desktop", undefined) as CategoryDisplay;
    d = setImageHeight(d, "mobile", undefined) as CategoryDisplay;
    expect(d).toEqual({ layout: "grid" });
  });

  it("resetGroup and resetResponsive return to the layout's defaults", () => {
    const d: CategoryDisplay = {
      layout: "grid",
      columns: { mobile: 3 },
      gap: { mobile: 8 },
      card: { radius: 4 },
      name: { size: 20 },
    };
    expect(resetGroup(d, "card")).toEqual({ layout: "grid", columns: { mobile: 3 }, gap: { mobile: 8 }, name: { size: 20 } });
    expect(resetResponsive(d, "gap")).toEqual({ layout: "grid", columns: { mobile: 3 }, card: { radius: 4 }, name: { size: 20 } });
  });

  it("counts explicit settings per group", () => {
    const d: CategoryDisplay = {
      layout: "grid",
      columns: { mobile: 2, tablet: 3 },
      gap: { desktop: 12 },
      card: { radius: 4, padding: 2 },
      image: { height: { mobile: 100, desktop: 120 }, fit: "contain" },
    };
    expect(explicitCount(d, "card")).toBe(2);
    expect(explicitCount(d, "image")).toBe(3);
    expect(explicitCount(d, "name")).toBe(0);
    expect(explicitCount(d, "responsive")).toBe(3);
    expect(explicitCount(undefined, "card")).toBe(0);
  });
});

describe("presets", () => {
  it("there are exactly the four named presets, each a normalized fixed point", () => {
    expect(CATEGORY_DISPLAY_PRESET_IDS).toEqual(["elegant_cards", "circular", "compact", "image_tiles"]);
    for (const preset of CATEGORY_DISPLAY_PRESETS) {
      expect(normalizeDisplay(preset.display)).toEqual(preset.display);
      expect(applyPreset(preset.display)).toEqual(preset.display);
    }
  });

  it("each preset uses a distinct layout and only keys the display contract owns", () => {
    expect(CATEGORY_DISPLAY_PRESETS.map((p) => p.display.layout)).toEqual([
      "grid",
      "circles",
      "compact_list",
      "image_tiles",
    ]);
    const allowed = ["layout", "columns", "gap", "itemWidth", "card", "image", "name"];
    for (const preset of CATEGORY_DISPLAY_PRESETS) {
      expect(Object.keys(preset.display).every((k) => allowed.includes(k))).toBe(true);
    }
  });

  it("every preset resolves with no coercion (what it says is what is drawn)", () => {
    for (const preset of CATEGORY_DISPLAY_PRESETS) {
      const r = resolveCategoryDisplay(preset.display);
      expect(LAYOUT_PLACEMENTS[preset.display.layout]).toContain(r.name.placement);
      if (preset.display.name?.placement) expect(r.name.placement).toBe(preset.display.name.placement);
      if (preset.display.image?.shape) expect(r.image.shape).toBe(preset.display.image.shape);
    }
  });

  it("an overlay preset keeps its name on the contrast-proven scrim", () => {
    const tiles = resolveCategoryDisplay(presetById("image_tiles").display);
    expect(tiles.name.placement).toBe("overlay");
    expect(tiles.name.background).toBe("scrim");
  });

  it("matches a display only when it is exactly equal to the preset", () => {
    const preset = presetById("elegant_cards");
    expect(matchingPreset(preset.display)).toBe("elegant_cards");
    const edited = setField(preset.display, "card", "radius", 8) as CategoryDisplay;
    expect(matchingPreset(edited)).toBeNull();
    expect(sameDisplay(edited, preset.display)).toBe(false);
    expect(matchingPreset(undefined)).toBeNull();
  });

  it("applying a preset carries no content: every key is one the display contract owns", () => {
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    for (const preset of CATEGORY_DISPLAY_PRESETS) walk(preset.display);
    const contract = new Set([
      "layout", "columns", "gap", "itemWidth", "card", "image", "name",
      "mobile", "tablet", "desktop",
      "style", "background", "borderColor", "borderWidth", "radius", "padding", "hover",
      "show", "shape", "aspect", "fit", "position", "height",
      "placement", "align", "size", "weight", "color", "lines",
    ]);
    expect([...keys].filter((k) => !contract.has(k))).toEqual([]);
  });
});

describe("messages", () => {
  it("Arabic and English carry exactly the same keys, none empty", () => {
    const ar = Object.keys(CATEGORIES_DISPLAY_MESSAGES.ar).sort();
    const en = Object.keys(CATEGORIES_DISPLAY_MESSAGES.en).sort();
    expect(ar).toEqual(en);
    for (const locale of ["ar", "en"] as const) {
      for (const [key, value] of Object.entries(CATEGORIES_DISPLAY_MESSAGES[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("Arabic strings contain Arabic script; the catalog spreads both locales into the customizer's", () => {
    for (const [key, value] of Object.entries(CATEGORIES_DISPLAY_MESSAGES.ar)) {
      if (key === "catdUnitPx") continue;
      expect(value, key).toMatch(/[؀-ۿ]/);
    }
    for (const locale of ["ar", "en"] as const) {
      for (const key of Object.keys(CATEGORIES_DISPLAY_MESSAGES[locale])) {
        expect(CUSTOMIZER_MESSAGES[locale]).toHaveProperty(key);
      }
    }
  });

  it("every closed-vocabulary label the panel assembles exists", () => {
    const en = CATEGORIES_DISPLAY_MESSAGES.en as Record<string, string>;
    const need = [
      ...DISPLAY_LAYOUTS.map((id) => `catdLayout_${id}`),
      ...DISPLAY_LAYOUTS.map((id) => `catdLayoutHint_${id}`),
      ...CATEGORY_DISPLAY_PRESET_IDS.map((id) => `catdPreset_${id}`),
      ...CATEGORY_DISPLAY_PRESET_IDS.map((id) => `catdPresetHint_${id}`),
      ...["none", "border", "shadow", "filled"].map((id) => `catdCardStyle_${id}`),
      ...["surface", "muted", "transparent"].map((id) => `catdCardBackground_${id}`),
      ...["border", "strong", "primary", "accent"].map((id) => `catdCardBorderColor_${id}`),
      ...["none", "subtle"].map((id) => `catdCardHover_${id}`),
      ...["rect", "square", "circle"].map((id) => `catdImageShape_${id}`),
      ...["cover", "contain"].map((id) => `catdImageFit_${id}`),
      ...["center", "top", "bottom", "start", "end"].map((id) => `catdImagePosition_${id}`),
      ...["below", "above", "overlay", "beside"].map((id) => `catdNamePlacement_${id}`),
      ...["start", "center", "end"].map((id) => `catdNameAlign_${id}`),
      ...[400, 500, 600, 700, 800].map((id) => `catdNameWeight_${id}`),
      ...["foreground", "muted", "primary"].map((id) => `catdNameColor_${id}`),
      ...["1", "2", "natural"].map((id) => `catdNameLines_${id}`),
      ...["none", "scrim", "surface"].map((id) => `catdNameBackground_${id}`),
      ...["mobile", "tablet", "desktop"].map((id) => `catdDevice_${id}`),
    ];
    for (const key of need) expect(en, key).toHaveProperty(key);
  });
});
