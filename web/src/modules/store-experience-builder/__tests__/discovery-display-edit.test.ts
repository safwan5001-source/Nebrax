import { describe, expect, it } from "vitest";
import {
  DISCOVERY_OPTION_KEYS,
  type DiscoveryDisplayOptions,
  discoveryDisplayOptionsOf,
  discoveryRowsApply,
  discoverySource,
  explicitDiscoveryOptionCount,
  explicitVisualOverrides,
  normalizeDiscoveryOptions,
  resetAllDiscoveryOptions,
  resetDiscoveryOption,
  selectDiscoveryTemplate,
  setDiscoveryColumn,
  setDiscoveryOption,
} from "../discovery-display-edit";
import { DISCOVERY_TEMPLATES, resolveDiscoveryDisplay } from "../presentation/discovery-templates";
import { normalizeOptionalSectionContent } from "../presentation/section-content";

/** AWJ-VD-H1 / VD-4c — the pure edit helpers behind the discovery display controls. */

const keys = (value: object) => Object.keys(value);

describe("selectDiscoveryTemplate", () => {
  it("writes only the template id — never its values", () => {
    const next = selectDiscoveryTemplate({}, "gift-circles");
    expect(next).toEqual({ template: "gift-circles" });
    for (const key of ["layout", "columns", "rows", "shape", "size", "textPosition", "cardStyle"]) {
      expect(next).not.toHaveProperty(key);
    }
  });

  it("every registry template writes just its id", () => {
    for (const id of Object.keys(DISCOVERY_TEMPLATES)) {
      expect(keys(selectDiscoveryTemplate({}, id))).toEqual(["template"]);
    }
  });

  it("keeps explicit settings untouched when a template is chosen", () => {
    const next = selectDiscoveryTemplate({ layout: "carousel", columns: { mobile: 3 }, gap: "loose" }, "minimal-text");
    expect(next).toEqual({ layout: "carousel", template: "minimal-text", columns: { mobile: 3 }, gap: "loose" });
  });

  it("an undefined or unknown id removes the template and nothing else", () => {
    const withTemplate: DiscoveryDisplayOptions = { template: "swipe-rail", gap: "tight" };
    expect(selectDiscoveryTemplate(withTemplate, undefined)).toEqual({ gap: "tight" });
    expect(selectDiscoveryTemplate(withTemplate, "constructor")).toEqual({ gap: "tight" });
    expect(selectDiscoveryTemplate(withTemplate, "not-a-template")).toEqual({ gap: "tight" });
  });
});

describe("setDiscoveryOption / resetDiscoveryOption", () => {
  it("sets an explicit key and resets it by deleting it (no placeholder value)", () => {
    const set = setDiscoveryOption({}, "gap", "loose");
    expect(set).toEqual({ gap: "loose" });
    const reset = resetDiscoveryOption(set, "gap");
    expect(reset).toEqual({});
    expect("gap" in reset).toBe(false);
  });

  it("setting a value to undefined deletes the key", () => {
    expect(setDiscoveryOption({ gap: "tight", align: "start" }, "gap", undefined)).toEqual({ align: "start" });
  });

  it("emits keys in the canonical contract order whatever the edit order", () => {
    let options: DiscoveryDisplayOptions = {};
    options = setDiscoveryOption(options, "maxItems", 8);
    options = setDiscoveryOption(options, "showCounts", true);
    options = setDiscoveryOption(options, "align", "start");
    options = setDiscoveryColumn(options, "desktop", 5);
    options = selectDiscoveryTemplate(options, "gift-circles");
    options = setDiscoveryOption(options, "layout", "image-grid");
    options = setDiscoveryOption(options, "shape", "arch");
    options = setDiscoveryOption(options, "gap", "tight");
    const canonical = DISCOVERY_OPTION_KEYS.filter((key) => key in options);
    expect(keys(options)).toEqual(canonical);
    expect(keys(options)).toEqual([
      "layout",
      "template",
      "columns",
      "gap",
      "shape",
      "align",
      "showCounts",
      "maxItems",
    ]);
  });

  it("clamps an out-of-range integer instead of rejecting it (maxItems 4–24)", () => {
    expect(setDiscoveryOption({}, "maxItems", 99)).toEqual({ maxItems: 24 });
    expect(setDiscoveryOption({}, "maxItems", 1)).toEqual({ maxItems: 4 });
  });

  it("drops a non-integral value rather than inventing an error", () => {
    expect(setDiscoveryOption({}, "maxItems", 7.5)).toEqual({});
    expect(setDiscoveryOption({ maxItems: 10 }, "maxItems", Number.NaN)).toEqual({});
  });

  it("is pure: the input is never mutated", () => {
    const input: DiscoveryDisplayOptions = { gap: "tight", columns: { mobile: 2 } };
    const snapshot = JSON.stringify(input);
    setDiscoveryOption(input, "align", "start");
    setDiscoveryColumn(input, "desktop", 6);
    resetDiscoveryOption(input, "gap");
    selectDiscoveryTemplate(input, "swipe-rail");
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("equals what the section normalizer would produce for the same document", () => {
    const options = setDiscoveryOption(setDiscoveryOption({ template: "market-icons" }, "showLabel", false), "size", "lg");
    const viaNormalizer = normalizeOptionalSectionContent("discovery", {
      title: "",
      axis: "brand",
      display: "tiles",
      ...options,
    });
    expect(discoveryDisplayOptionsOf(viaNormalizer as never)).toEqual(options);
    expect(keys(discoveryDisplayOptionsOf(viaNormalizer as never))).toEqual(keys(options));
  });
});

describe("columns", () => {
  it("sets one device at a time and keeps the others", () => {
    let options = setDiscoveryColumn({}, "mobile", 3);
    options = setDiscoveryColumn(options, "desktop", 6);
    expect(options).toEqual({ columns: { mobile: 3, desktop: 6 } });
    expect(keys(options.columns ?? {})).toEqual(["mobile", "desktop"]);
  });

  it("clearing the last device removes `columns` entirely", () => {
    const options = setDiscoveryColumn({ columns: { tablet: 4 } }, "tablet", undefined);
    expect(options).toEqual({});
    expect("columns" in options).toBe(false);
  });

  it("clamps each device into its own range (mobile 1–4, tablet 2–6, desktop 2–8)", () => {
    expect(setDiscoveryColumn({}, "mobile", 9).columns).toEqual({ mobile: 4 });
    expect(setDiscoveryColumn({}, "tablet", 1).columns).toEqual({ tablet: 2 });
    expect(setDiscoveryColumn({}, "desktop", 20).columns).toEqual({ desktop: 8 });
    expect(setDiscoveryColumn({}, "mobile", 0).columns).toEqual({ mobile: 1 });
  });

  it("resetting `columns` deletes all devices", () => {
    expect(resetDiscoveryOption({ columns: { mobile: 2, tablet: 3 }, gap: "tight" }, "columns")).toEqual({
      gap: "tight",
    });
  });
});

describe("rows apply to the carousel only", () => {
  it("is refused while the resolved layout is not a carousel", () => {
    expect(discoveryRowsApply({})).toBe(false);
    expect(setDiscoveryOption({}, "rows", 2)).toEqual({});
    expect(setDiscoveryOption({ layout: "image-grid" }, "rows", 2)).toEqual({ layout: "image-grid" });
    // A template whose layout is not a carousel does not enable rows either.
    expect(setDiscoveryOption({ template: "gift-circles" }, "rows", 2)).toEqual({ template: "gift-circles" });
  });

  it("is accepted with an explicit carousel layout or a carousel template", () => {
    expect(setDiscoveryOption({ layout: "carousel" }, "rows", 2)).toEqual({ layout: "carousel", rows: 2 });
    expect(setDiscoveryOption({ template: "swipe-rail" }, "rows", 1)).toEqual({ template: "swipe-rail", rows: 1 });
    expect(discoveryRowsApply({ template: "swipe-rail" })).toBe(true);
  });

  it("an explicit non-carousel layout beats a carousel template", () => {
    expect(discoveryRowsApply({ template: "swipe-rail", layout: "text-list" })).toBe(false);
  });

  it("a stored rows value survives leaving the carousel (it is only inactive) and can still be reset", () => {
    const stored: DiscoveryDisplayOptions = { layout: "carousel", rows: 2 };
    const away = setDiscoveryOption(stored, "layout", "image-grid");
    expect(away).toEqual({ layout: "image-grid", rows: 2 });
    expect(resolveDiscoveryDisplay({ title: "", axis: "brand", display: "tiles", ...away }).rows).toBe(1);
    expect(resetDiscoveryOption(away, "rows")).toEqual({ layout: "image-grid" });
  });

  it("clamps rows into 1–2", () => {
    expect(setDiscoveryOption({ layout: "carousel" }, "rows", 5)).toEqual({ layout: "carousel", rows: 2 });
    expect(setDiscoveryOption({ layout: "carousel" }, "rows", 0)).toEqual({ layout: "carousel", rows: 1 });
  });
});

describe("inheritance sources (the same precedence as resolveDiscoveryDisplay)", () => {
  it("explicit beats template beats system default", () => {
    expect(discoverySource({ template: "gift-circles", gap: "tight" }, "gap")).toEqual({ kind: "explicit" });
    expect(discoverySource({ template: "gift-circles" }, "gap")).toEqual({ kind: "system" });
    expect(discoverySource({ template: "gift-circles" }, "textPosition")).toEqual({
      kind: "template",
      templateId: "gift-circles",
    });
    expect(discoverySource({}, "textPosition")).toEqual({ kind: "system" });
  });

  it("layout with nothing chosen anywhere is the legacy look, not a system default", () => {
    expect(discoverySource({}, "layout")).toEqual({ kind: "legacy" });
    expect(discoverySource({ template: "swipe-rail" }, "layout")).toEqual({ kind: "template", templateId: "swipe-rail" });
    expect(discoverySource({ layout: "text-list" }, "layout")).toEqual({ kind: "explicit" });
  });

  it("columns are resolved per device", () => {
    const options: DiscoveryDisplayOptions = { template: "gift-circles", columns: { mobile: 2 } };
    expect(discoverySource(options, "columns", "mobile")).toEqual({ kind: "explicit" });
    expect(discoverySource(options, "columns", "tablet")).toEqual({ kind: "template", templateId: "gift-circles" });
    // `swipe-rail` defines no columns: the system default applies.
    expect(discoverySource({ template: "swipe-rail" }, "columns", "desktop")).toEqual({ kind: "system" });
  });

  it("rows come from a template only when the layout is a carousel", () => {
    expect(discoverySource({ template: "swipe-rail" }, "rows")).toEqual({ kind: "template", templateId: "swipe-rail" });
    expect(discoverySource({ template: "swipe-rail", layout: "image-grid" }, "rows")).toEqual({ kind: "system" });
  });

  it("agrees with the resolver on every template key", () => {
    for (const [id, template] of Object.entries(DISCOVERY_TEMPLATES)) {
      const resolved = resolveDiscoveryDisplay({ title: "", axis: "brand", display: "tiles", template: id as never });
      expect(resolved.layout).toBe(template.layout);
      expect(discoverySource({ template: id as never }, "layout")).toEqual({ kind: "template", templateId: id });
      expect(resolved.textPosition).toBe(template.textPosition);
      expect(resolved.cardStyle).toBe(template.cardStyle);
    }
  });
});

describe("shape / size / label overrides", () => {
  it("lists only the explicit ones", () => {
    expect(explicitVisualOverrides({})).toEqual([]);
    expect(explicitVisualOverrides({ template: "gift-circles" })).toEqual([]);
    expect(explicitVisualOverrides({ shape: "heart", showLabel: false })).toEqual(["shape", "showLabel"]);
    expect(explicitVisualOverrides({ size: "lg", gap: "tight" })).toEqual(["size"]);
  });

  it("an explicit `showLabel: false` is kept (false is a value, not absence)", () => {
    const options = setDiscoveryOption({}, "showLabel", false);
    expect(options).toEqual({ showLabel: false });
    expect(explicitVisualOverrides(options)).toEqual(["showLabel"]);
  });
});

describe("counts, reset-all, legacy and round trip", () => {
  it("counts explicit settings (columns one per device)", () => {
    expect(explicitDiscoveryOptionCount({})).toBe(0);
    expect(explicitDiscoveryOptionCount({ template: "gift-circles", columns: { mobile: 2, tablet: 3 }, gap: "tight" })).toBe(4);
  });

  it("reset all returns no options", () => {
    expect(resetAllDiscoveryOptions()).toEqual({});
  });

  it("a legacy document (no display settings) is untouched: normalizing nothing is nothing", () => {
    expect(normalizeDiscoveryOptions({})).toEqual({});
    const legacy = { title: "T", axis: "facet", dimension: "occasion", display: "chips" } as const;
    expect(discoveryDisplayOptionsOf(legacy)).toEqual({});
  });

  it("round-trips: options in → document → options out, same values and key order", () => {
    const options: DiscoveryDisplayOptions = {
      layout: "carousel",
      template: "swipe-rail",
      columns: { mobile: 3, desktop: 6 },
      rows: 2,
      gap: "loose",
      textPosition: "overlay",
      contentSequence: "label-first",
      valueSort: "count",
      shape: "arch",
      size: "sm",
      showLabel: false,
      cardStyle: "elevated",
      align: "start",
      showCounts: true,
      maxItems: 10,
    };
    const doc = { title: "عنوان", axis: "facet", dimension: "occasion", display: "tiles", ...options } as const;
    const stored = normalizeOptionalSectionContent("discovery", doc);
    expect(stored).toEqual(doc);
    const back = discoveryDisplayOptionsOf(stored as never);
    expect(back).toEqual(options);
    expect(keys(back)).toEqual(keys(options));
    // Re-normalizing is a fixed point.
    expect(normalizeDiscoveryOptions(back)).toEqual(back);
  });

  it("drops unknown or mistyped values on edit (a hostile stored value cannot survive an edit)", () => {
    const hostile = { gap: "gigantic", align: 3, layout: "marquee", showCounts: "yes" } as never;
    expect(normalizeDiscoveryOptions(hostile)).toEqual({});
  });
});
