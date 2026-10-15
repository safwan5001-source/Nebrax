/**
 * @vitest-environment jsdom
 *
 * AWJ-VD-H1 / VD-4c — the discovery display controls and their live panel preview.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryDisplayFields } from "../DiscoveryDisplayFields";
import { DISCOVERY_DISPLAY_MESSAGES } from "../discovery-display-messages";
import type { DiscoveryDisplayOptions } from "../discovery-display-edit";
import { DISCOVERY_PREVIEW_CAP, previewSelection, previewSource } from "../discovery-preview-model";
import { type CustomizerLocale, CUSTOMIZER_MESSAGES, customizerMessage } from "../messages";
import { DISCOVERY_TEMPLATES } from "../presentation/discovery-templates";
import type { DiscoveryContent } from "../presentation/section-content";

afterEach(cleanup);

const BASE: Pick<DiscoveryContent, "title" | "axis" | "dimension" | "display"> = {
  title: "تسوّق حسب",
  axis: "facet",
  dimension: "occasion",
  display: "tiles",
};

function Harness({
  initial = {},
  locale = "en",
  base = BASE,
  onOptions,
  facets = null,
}: {
  initial?: DiscoveryDisplayOptions;
  locale?: CustomizerLocale;
  base?: typeof BASE;
  onOptions?: (options: DiscoveryDisplayOptions) => void;
  facets?: null;
}) {
  const [options, setOptions] = useState<DiscoveryDisplayOptions>(initial);
  return (
    <DiscoveryDisplayFields
      base={base}
      options={options}
      onOptionsChange={(next) => {
        setOptions(next);
        onOptions?.(next);
      }}
      locale={locale}
      t={(key) => customizerMessage(locale, key)}
      facets={facets}
    />
  );
}

function open(group: string) {
  const button = screen.getByRole("button", { name: new RegExp(`^${group}`) });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}

function control(name: string): HTMLElement {
  const el = document.querySelector(`[data-dd-control="${name}"]`);
  if (!el) throw new Error(`no control ${name}`);
  return el as HTMLElement;
}

function preview(): HTMLElement {
  return document.querySelector("[data-preview-layout]") as HTMLElement;
}

describe("messages", () => {
  it("Arabic and English carry exactly the same keys, none empty", () => {
    const ar = Object.keys(DISCOVERY_DISPLAY_MESSAGES.ar).sort();
    const en = Object.keys(DISCOVERY_DISPLAY_MESSAGES.en).sort();
    expect(ar).toEqual(en);
    for (const locale of ["ar", "en"] as const) {
      for (const [key, value] of Object.entries(DISCOVERY_DISPLAY_MESSAGES[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("is merged into the module catalog for both locales", () => {
    expect(CUSTOMIZER_MESSAGES.ar.ddReset).toBe(DISCOVERY_DISPLAY_MESSAGES.ar.ddReset);
    expect(CUSTOMIZER_MESSAGES.en.ddReset).toBe(DISCOVERY_DISPLAY_MESSAGES.en.ddReset);
  });

  it("every registry template has a name and a one-line description in both languages", () => {
    for (const id of Object.keys(DISCOVERY_TEMPLATES)) {
      for (const locale of ["ar", "en"] as const) {
        const pack = DISCOVERY_DISPLAY_MESSAGES[locale] as Record<string, string>;
        expect(pack[`ddTemplateName_${id}`], `${locale} name ${id}`).toBeTruthy();
        const description = pack[`ddTemplateDesc_${id}`];
        expect(description, `${locale} desc ${id}`).toBeTruthy();
        expect(description).not.toContain("\n");
      }
    }
  });

  it("Arabic strings contain Arabic script, not English placeholders", () => {
    for (const [key, value] of Object.entries(DISCOVERY_DISPLAY_MESSAGES.ar)) {
      expect(/[؀-ۿ]/.test(value), key).toBe(true);
    }
  });
});

describe("controls — inheritance semantics", () => {
  it("shows no explicit value for an untouched (legacy) section and the legacy source for layout", () => {
    render(<Harness />);
    expect(control("layout").querySelector('[data-source="legacy"]')).not.toBeNull();
    expect(document.querySelector("[data-dd-reset]")).toBeNull();
    expect(preview().getAttribute("data-preview-layout")).toBe("legacy");
  });

  it("choosing a template writes only its id and reports where each effective value comes from", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness onOptions={(o) => seen.push(o)} />);
    fireEvent.click(screen.getByRole("button", { name: /Boutique arches/ }));
    expect(seen.at(-1)).toEqual({ template: "boutique-arches" });
    // Layout is now inherited from the template, columns too; the gap is a system default.
    expect(control("layout").querySelector('[data-source="template"]')?.textContent).toContain("Boutique arches");
    expect(preview().getAttribute("data-preview-layout")).toBe("image-cards");
    expect(preview().getAttribute("data-preview-columns")).toBe("2");
    expect(screen.getByRole("button", { name: /Boutique arches/ }).getAttribute("aria-pressed")).toBe("true");
    open("Advanced");
    expect(control("gap").querySelector('[data-source="system"]')).not.toBeNull();
  });

  it("an explicit choice is marked explicit, shows a reset action, and reset deletes the key", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness initial={{ template: "gift-circles" }} onOptions={(o) => seen.push(o)} />);
    fireEvent.click(within(control("layout")).getByRole("button", { name: "Carousel" }));
    expect(seen.at(-1)).toEqual({ layout: "carousel", template: "gift-circles" });
    expect(control("layout").querySelector('[data-source="explicit"]')).not.toBeNull();
    fireEvent.click(within(control("layout")).getByRole("button", { name: /Reset to inherited/ }));
    expect(seen.at(-1)).toEqual({ template: "gift-circles" });
    expect("layout" in (seen.at(-1) ?? {})).toBe(false);
    expect(control("layout").querySelector('[data-source="template"]')).not.toBeNull();
  });

  it("the inherited option is marked without being pressed", () => {
    render(<Harness initial={{ template: "gift-circles" }} />);
    const grid = within(control("layout")).getByRole("button", { name: "Image grid" });
    expect(grid.getAttribute("aria-pressed")).toBe("false");
    expect(grid.getAttribute("data-effective")).toBe("inherited");
  });

  it("the layout list offers the five layouts plus the legacy option (no layout key)", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness initial={{ layout: "text-list" }} onOptions={(o) => seen.push(o)} />);
    const group = within(control("layout"));
    for (const name of ["Image grid", "Image cards", "Carousel", "Icon grid", "Text list"]) {
      expect(group.getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(group.getByRole("button", { name: "Legacy (tiles/chips)" }));
    expect(seen.at(-1)).toEqual({});
  });

  it("a column select shows the inherited value and picking one writes just that device", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness initial={{ template: "gift-circles" }} onOptions={(o) => seen.push(o)} />);
    const mobile = screen.getByRole("combobox", { name: "Columns: Mobile" }) as HTMLSelectElement;
    expect(mobile.value).toBe("");
    expect(within(mobile).getByRole("option", { name: "Inherited (3)" })).toBeTruthy();
    // Mobile accepts 1–4 only.
    expect(Array.from(mobile.options).map((o) => o.value)).toEqual(["", "1", "2", "3", "4"]);
    fireEvent.change(mobile, { target: { value: "2" } });
    expect(seen.at(-1)).toEqual({ template: "gift-circles", columns: { mobile: 2 } });
    fireEvent.change(mobile, { target: { value: "" } });
    expect(seen.at(-1)).toEqual({ template: "gift-circles" });
    const desktop = screen.getByRole("combobox", { name: "Columns: Desktop" }) as HTMLSelectElement;
    expect(Array.from(desktop.options).map((o) => o.value)).toEqual(["", "2", "3", "4", "5", "6", "7", "8"]);
    const tablet = screen.getByRole("combobox", { name: "Columns: Tablet" }) as HTMLSelectElement;
    expect(Array.from(tablet.options).map((o) => o.value)).toEqual(["", "2", "3", "4", "5", "6"]);
  });

  it("rows are disabled (with the reason) unless the resolved layout is a carousel", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness onOptions={(o) => seen.push(o)} />);
    const rows = screen.getByRole("combobox", { name: "Rows" }) as HTMLSelectElement;
    expect(rows.disabled).toBe(true);
    expect(rows.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.querySelector("[data-rows-note]")?.textContent).toContain("carousel");
    fireEvent.click(within(control("layout")).getByRole("button", { name: "Carousel" }));
    expect((screen.getByRole("combobox", { name: "Rows" }) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Rows" }), { target: { value: "2" } });
    expect(seen.at(-1)).toEqual({ layout: "carousel", rows: 2 });
  });

  it("a carousel template enables rows and shows its two rows as inherited", () => {
    render(<Harness initial={{ template: "swipe-rail" }} />);
    const rows = screen.getByRole("combobox", { name: "Rows" }) as HTMLSelectElement;
    expect(rows.disabled).toBe(false);
    expect(within(rows).getByRole("option", { name: "Inherited (2)" })).toBeTruthy();
    expect(preview().getAttribute("data-preview-rows")).toBe("2");
  });

  it("maxItems offers 4–24 and clamps through the normalizer (never an error)", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness onOptions={(o) => seen.push(o)} />);
    open("Content");
    const select = screen.getByRole("combobox", { name: "Maximum values" }) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values[1]).toBe("4");
    expect(values.at(-1)).toBe("24");
    expect(within(select).getByRole("option", { name: "Inherited (12)" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "6" } });
    expect(seen.at(-1)).toEqual({ maxItems: 6 });
  });

  it("every other documented control exists and writes its key", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness onOptions={(o) => seen.push(o)} />);
    open("Look");
    open("Content");
    open("Advanced");
    const press = (name: string, label: string) => fireEvent.click(within(control(name)).getByRole("button", { name: label }));
    press("gap", "Loose");
    press("textPosition", "Over image");
    press("contentSequence", "Name first");
    press("valueSort", "Most products");
    press("size", "Large");
    press("showLabel", "Hide");
    press("cardStyle", "Elevated");
    press("align", "Start");
    press("showCounts", "Show");
    fireEvent.change(screen.getByRole("combobox", { name: "Shape" }), { target: { value: "arch" } });
    expect(seen.at(-1)).toEqual({
      gap: "loose",
      textPosition: "overlay",
      contentSequence: "label-first",
      valueSort: "count",
      shape: "arch",
      size: "lg",
      showLabel: false,
      cardStyle: "elevated",
      align: "start",
      showCounts: true,
    });
    // Canonical key order, whatever order the merchant touched them in.
    expect(Object.keys(seen.at(-1) ?? {})).toEqual([
      "gap",
      "textPosition",
      "contentSequence",
      "valueSort",
      "shape",
      "size",
      "showLabel",
      "cardStyle",
      "align",
      "showCounts",
    ]);
  });
});

describe("shape / size / label overrides", () => {
  it("defaults to 'don't force' with the safe hint and no warning", () => {
    render(<Harness initial={{ template: "gift-circles" }} />);
    open("Look");
    expect(document.querySelector("[data-dd-visual-hint]")).not.toBeNull();
    expect(document.querySelector("[data-dd-visual-warning]")).toBeNull();
    const shape = screen.getByRole("combobox", { name: "Shape" }) as HTMLSelectElement;
    expect(shape.value).toBe("");
    expect(within(shape).getByRole("option", { name: "Don't force" })).toBeTruthy();
    expect(control("shape").textContent).toContain("Not forced");
    // What a value without a look of its own falls back to, and where that comes from.
    expect(control("shape").querySelector("[data-visual-fallback]")?.textContent).toContain("Circle");
    expect(control("shape").querySelector("[data-visual-fallback]")?.textContent).toContain("Gift circles");
  });

  for (const [name, act] of [
    ["shape", () => fireEvent.change(screen.getByRole("combobox", { name: "Shape" }), { target: { value: "heart" } })],
    ["size", () => fireEvent.click(within(control("size")).getByRole("button", { name: "Small" }))],
    ["showLabel", () => fireEvent.click(within(control("showLabel")).getByRole("button", { name: "Hide" }))],
  ] as const) {
    it(`an explicit ${name} shows the warning that it overrides every value's own look`, () => {
      render(<Harness />);
      open("Look");
      act();
      const warning = document.querySelector("[data-dd-visual-warning]");
      expect(warning).not.toBeNull();
      expect(warning?.textContent).toContain("overrides the shape, size and name of every value");
      expect(control(name).querySelector('[data-source="explicit"]')).not.toBeNull();
      // Resetting the only override removes the warning.
      fireEvent.click(within(control(name)).getByRole("button", { name: /Reset to inherited/ }));
      expect(document.querySelector("[data-dd-visual-warning]")).toBeNull();
    });
  }

  it("the Arabic warning is natural Arabic and names all three properties", () => {
    render(<Harness locale="ar" initial={{ shape: "circle" }} />);
    open("المظهر");
    const warning = document.querySelector("[data-dd-visual-warning]");
    expect(warning?.textContent).toBe(DISCOVERY_DISPLAY_MESSAGES.ar.ddVisualOverrideWarning);
    expect(warning?.textContent).toContain("شكل");
    expect(warning?.textContent).toContain("حجم");
    expect(warning?.textContent).toContain("اسم");
  });
});

describe("groups, reset all, counts", () => {
  it("has four collapsible groups, keyboard-operable buttons with aria-expanded", () => {
    render(<Harness />);
    for (const name of ["Layout", "Look", "Content", "Advanced"]) {
      const button = screen.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(button.getAttribute("aria-expanded")).toBe(name === "Layout" ? "true" : "false");
      const body = document.getElementById(button.getAttribute("aria-controls") ?? "");
      expect(body, `${name} body`).not.toBeNull();
      expect(body?.hidden).toBe(name !== "Layout");
    }
    const look = screen.getByRole("button", { name: /^Look/ });
    fireEvent.click(look);
    expect(look.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(look);
    expect(look.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the number of explicit settings per group", () => {
    render(<Harness initial={{ gap: "tight", maxItems: 8, showCounts: true }} />);
    expect(screen.getByRole("button", { name: /^Content/ }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /^Advanced/ }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: /^Layout/ }).textContent).not.toMatch(/\d/);
  });

  it("'Reset all' clears every setting, and is disabled when there are none", () => {
    const seen: DiscoveryDisplayOptions[] = [];
    render(<Harness initial={{ template: "swipe-rail", gap: "tight" }} onOptions={(o) => seen.push(o)} />);
    open("Advanced");
    fireEvent.click(screen.getByRole("button", { name: "Reset all display settings" }));
    expect(seen.at(-1)).toEqual({});
    expect((screen.getByRole("button", { name: "Reset all display settings" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("every control button and select meets the 44px touch target at phone width (classes)", () => {
    render(<Harness initial={{ template: "swipe-rail", gap: "tight" }} />);
    open("Look");
    for (const button of screen.getAllByRole("button")) {
      // 44px on touch widths: either an explicit h/min-h/size-11 class, or a sm: override of a smaller one.
      expect(button.className, button.textContent ?? "").toMatch(/(min-h-11|size-11|h-11)/);
    }
  });

  it("uses no fixed palette or raw hex in class names", () => {
    const { container } = render(<Harness initial={{ template: "swipe-rail", cardStyle: "elevated" }} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(?:bg|text|border|ring)-(?:white|black|neutral|slate|gray|red|green|amber)\b/);
    expect(html).not.toMatch(/class="[^"]*#[0-9a-fA-F]{6}/);
  });
});

describe("panel preview", () => {
  const layouts = [
    ["image-grid", "image-grid"],
    ["image-cards", "image-cards"],
    ["carousel", "carousel"],
    ["icon-grid", "icon-grid"],
    ["text-list", "text-list"],
  ] as const;

  for (const [layout] of layouts) {
    it(`renders the ${layout} layout from the resolved options`, () => {
      render(<Harness initial={{ layout }} />);
      expect(preview().getAttribute("data-preview-layout")).toBe(layout);
      expect(document.querySelectorAll("[data-preview-item]").length).toBeGreaterThan(0);
    });
  }

  it("a carousel renders a keyboard-reachable rail with the resolved rows", () => {
    render(<Harness initial={{ layout: "carousel", rows: 2 }} />);
    const rail = document.querySelector("[data-preview-rail]") as HTMLElement;
    expect(rail.getAttribute("tabindex")).toBe("0");
    expect(rail.getAttribute("aria-label")).toBe("Carousel");
    expect(rail.style.gridTemplateRows).toBe("repeat(2, auto)");
  });

  it("shows the columns of the chosen preview device and the resolved value for it", () => {
    render(<Harness initial={{ template: "gift-circles", columns: { tablet: 5 } }} />);
    // Mobile is the default device.
    expect(preview().getAttribute("data-preview-columns")).toBe("3");
    const device = screen.getByRole("group", { name: "Preview device" });
    fireEvent.click(within(device).getByRole("button", { name: "Tablet" }));
    expect(preview().getAttribute("data-preview-device")).toBe("tablet");
    expect(preview().getAttribute("data-preview-columns")).toBe("5");
    fireEvent.click(within(device).getByRole("button", { name: "Desktop" }));
    expect(preview().getAttribute("data-preview-columns")).toBe("6");
    expect(within(device).getByRole("button", { name: "Desktop" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(device).getByRole("button", { name: "Mobile" }).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-preview-summary]")?.textContent).toContain("6");
  });

  it("uses the resolved shape: explicit section shape beats the template's", () => {
    render(<Harness initial={{ template: "gift-circles" }} />);
    const frameRadius = () => (document.querySelector("[data-preview-item] [aria-hidden='true']") as HTMLElement).style.borderRadius;
    expect(frameRadius()).toBe("50%");
    cleanup();
    render(<Harness initial={{ template: "gift-circles", shape: "square" }} />);
    expect(frameRadius()).toBe("0px");
  });

  it("shows the fallback look when a value has no picture (icon, then the initial)", () => {
    render(<Harness initial={{ layout: "image-grid" }} />);
    const kinds = Array.from(document.querySelectorAll("[data-facet-content]")).map((el) => el.getAttribute("data-facet-content"));
    expect(kinds).toContain("image");
    expect(kinds).toContain("icon");
    expect(kinds).toContain("initial");
  });

  it("text-list draws names only (no media frames)", () => {
    render(<Harness initial={{ layout: "text-list" }} />);
    const kinds = new Set(Array.from(document.querySelectorAll("[data-facet-content]")).map((el) => el.getAttribute("data-facet-content")));
    expect([...kinds]).toEqual(["none"]);
  });

  it("every preview value keeps an accessible name; hiding the label keeps it for screen readers", () => {
    render(<Harness initial={{ layout: "image-grid", showLabel: false }} />);
    const items = document.querySelectorAll("[data-preview-item]");
    expect(items.length).toBeGreaterThan(0);
    // The sample picture is decorative; the name stays in the DOM, visually hidden.
    expect(screen.getAllByText("Birthday")[0].className).toContain("sr-only");
    expect(document.querySelector("[data-preview-item] img")?.getAttribute("alt")).toBe("");
  });

  it("maxItems and valueSort shape what is drawn (and the cap bounds the preview)", () => {
    render(<Harness initial={{ layout: "image-grid", maxItems: 5, valueSort: "count" }} />);
    const names = Array.from(document.querySelectorAll("[data-preview-item]")).map((el) => el.textContent);
    expect(names).toHaveLength(5);
    expect(names[0]).toContain("Birthday"); // 24 products: the most
    cleanup();
    render(<Harness initial={{ layout: "image-grid", maxItems: 24 }} />);
    expect(document.querySelectorAll("[data-preview-item]").length).toBe(DISCOVERY_PREVIEW_CAP);
  });

  it("showCounts draws a count beside each value", () => {
    render(<Harness initial={{ layout: "image-grid", showCounts: true }} />);
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
  });

  it("the legacy look renders tiles or chips and says so", () => {
    render(<Harness base={{ ...BASE, display: "chips" }} />);
    expect(preview().getAttribute("data-preview-layout")).toBe("legacy");
    expect(preview().textContent).toContain("No layout chosen");
    expect(preview().querySelector("li.rounded-full")).not.toBeNull();
  });

  it("a long Arabic section title wraps inside the preview (no unbreakable overflow class missing)", () => {
    const title = "تسوّق حسب المناسبة أو المُهدى إليه أو العلامة التجارية المفضلة لديك اليوم";
    expect(title.length).toBeGreaterThanOrEqual(40);
    render(<Harness locale="ar" base={{ ...BASE, title }} initial={{ template: "gift-circles" }} />);
    const heading = within(preview()).getByRole("heading", { level: 5 });
    expect(heading.textContent).toBe(title);
    expect(heading.className).toContain("break-words");
    expect(preview().getAttribute("dir")).toBe("rtl");
  });

  it("falls back to a default title when the section has none", () => {
    render(<Harness base={{ ...BASE, title: "  " }} locale="ar" />);
    expect(within(preview()).getByRole("heading", { level: 5 }).textContent).toBe("تسوّق حسب");
  });

  it("is English LTR in English, and says whether names are real or sample", () => {
    render(<Harness locale="en" />);
    expect(preview().getAttribute("dir")).toBe("ltr");
    expect(document.querySelector("[data-discovery-preview]")?.textContent).toContain("Sample values");
  });

  it("paints with the store's own tokens (the .awj-store-preview frame), not admin colours", () => {
    render(<Harness />);
    expect(preview().classList.contains("awj-store-preview")).toBe(true);
  });
});

describe("preview model", () => {
  const facets = [
    {
      id: "f1",
      key: "occasion",
      systemKey: null,
      name: "المناسبة",
      nameEn: "Occasion",
      sortOrder: 0,
      isActive: true,
      values: [
        { id: "v2", slug: "b", name: "ب", nameEn: "B", sortOrder: 1, isActive: true, productCount: 9 },
        { id: "v1", slug: "a", name: "أ", nameEn: null, sortOrder: 0, isActive: true, productCount: 3 },
        { id: "v3", slug: "c", name: "ج", nameEn: "C", sortOrder: 2, isActive: false, productCount: 99 },
      ],
    },
  ];

  it("uses the real facet's active values in merchant order, localized", () => {
    const real = previewSource({ facets, axis: "facet", dimension: "occasion", locale: "en" });
    expect(real.kind).toBe("real");
    expect(real.values.map((v) => v.label)).toEqual(["أ", "B"]); // no English name -> Arabic
    expect(real.values.map((v) => v.count)).toEqual([3, 9]);
  });

  it("falls back to samples for brands, an unknown dimension, or no facets", () => {
    expect(previewSource({ facets, axis: "brand", dimension: "", locale: "ar" }).kind).toBe("sample");
    expect(previewSource({ facets, axis: "facet", dimension: "gone", locale: "ar" }).kind).toBe("sample");
    expect(previewSource({ facets: null, axis: "facet", dimension: "occasion", locale: "ar" }).kind).toBe("sample");
  });

  it("sorts by count stably and applies maxItems", () => {
    const { values } = previewSource({ facets: null, axis: "facet", dimension: "", locale: "en" });
    const byCount = previewSelection(values, "count", 4).shown.map((v) => v.count);
    expect(byCount).toEqual([...byCount].sort((a, b) => b - a));
    expect(previewSelection(values, "merchant", 4).shown.map((v) => v.id)).toEqual(values.slice(0, 4).map((v) => v.id));
  });

  it("reports how many values the preview leaves out", () => {
    const { values } = previewSource({ facets: null, axis: "facet", dimension: "", locale: "en" });
    expect(previewSelection(values, "merchant", 24).hidden).toBe(0); // 12 samples, all shown
    expect(previewSelection(values, "merchant", 24).shown).toHaveLength(12);
  });

  it("real names drive the rendered preview and the caption says so", () => {
    render(
      <DiscoveryDisplayFields
        base={BASE}
        options={{ layout: "image-grid" }}
        onOptionsChange={() => undefined}
        locale="en"
        t={(key) => customizerMessage("en", key)}
        facets={facets as never}
      />,
    );
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-discovery-preview]")?.textContent).toContain("Value names from your catalog");
  });
});
