/**
 * @vitest-environment jsdom
 *
 * AWJ-VD-H1 / VD-4c — the discovery display controls and their live panel preview.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("carries no unused keys (every key is read by a component)", () => {
    const sources = ["DiscoveryDisplayFields.tsx", "DiscoveryPanelPreview.tsx"]
      .map((file) => readFileSync(resolve(__dirname, "..", file), "utf8"))
      .join("\n");
    const dynamic = /^dd(Template(Name|Desc)|Layout|Device|Gap|Size|TextPosition|CardStyle|ValueSort|ContentSequence|Align|Sample|Note)_/;
    for (const key of Object.keys(DISCOVERY_DISPLAY_MESSAGES.en)) {
      if (dynamic.test(key)) continue;
      expect(sources, key).toContain(key);
    }
    expect(Object.keys(DISCOVERY_DISPLAY_MESSAGES.en)).not.toContain("ddEffective");
    expect(Object.keys(DISCOVERY_DISPLAY_MESSAGES.en)).not.toContain("ddPreviewFallbackLegend");
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
    const grid = within(control("layout")).getByRole("button", { name: "Image grid (inherited)" });
    expect(grid.getAttribute("aria-pressed")).toBe("false");
    expect(grid.getAttribute("data-effective")).toBe("inherited");
    // The dashed outline is visual only: the state is also spoken, in the accessible name (which keeps the label).
    expect(grid.getAttribute("aria-label")).toBe("Image grid (inherited)");
    expect(within(control("layout")).getByRole("button", { name: "Carousel" }).hasAttribute("aria-label")).toBe(false);
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
    // §3.6: the dimension's own default sits above the section template, so the line must not claim the template wins.
    expect(control("shape").querySelector("[data-visual-fallback]")?.textContent).toContain("Unless the dimension sets its own default");
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

describe("Arabic accessibility strings", () => {
  it("speaks the inherited state and the badge meaning in Arabic", () => {
    render(<Harness locale="ar" initial={{ template: "gift-circles", gap: "tight" }} />);
    expect(within(control("layout")).getByRole("button", { name: "شبكة صور (موروث)" })).toBeTruthy();
    const badge = screen.getByRole("button", { name: /^متقدّم/ }).querySelector("[title]") as HTMLElement;
    expect(badge.querySelector(".sr-only")?.textContent).toBe("إعدادات محدّدة هنا: 1");
    expect(DISCOVERY_DISPLAY_MESSAGES.ar.ddVisualFallback).toContain("ما لم يضبط البُعد");
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
    const button = screen.getByRole("button", { name: "Reset all display settings" });
    button.focus();
    fireEvent.click(button);
    expect(seen.at(-1)).toEqual({});
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // Not natively disabled: it keeps keyboard focus (WCAG 2.4.3) and a further press is a no-op.
    expect(document.activeElement).toBe(button);
    seen.length = 0;
    fireEvent.click(button);
    expect(seen).toEqual([]);
  });

  it("every interactive control keeps a >=44px target at every breakpoint (no sm:/md:/lg: class shrinks it)", () => {
    render(<Harness initial={{ template: "swipe-rail", gap: "tight", shape: "heart" }} />);
    for (const group of ["Look", "Content", "Advanced"]) open(group);
    const controls = [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("combobox"),
    ] as HTMLElement[];
    expect(controls.length).toBeGreaterThan(30);
    const size = /^(?:(?<variant>[a-z0-9-]+):)?(?<kind>size|h|min-h)-(?<n>\d+(?:\.\d+)?)$/;
    for (const el of controls) {
      const name = `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent ?? ""}`;
      const classes = el.className.split(/\s+/);
      // The unprefixed class that sets the target (11 = 44px) …
      const base = classes.map((c) => size.exec(c)?.groups).filter((g) => g && !g.variant && g.n);
      expect(base.some((g) => Number(g?.n) >= 11), `${name}: base target`).toBe(true);
      // … and no responsive class (sm:, md:, lg: …) that sets a smaller height / size.
      for (const c of classes) {
        const g = size.exec(c)?.groups;
        if (g?.variant) expect(Number(g.n), `${name}: ${c}`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it("the 44px guard itself rejects a shrinking responsive class", () => {
    const size = /^(?:(?<variant>[a-z0-9-]+):)?(?<kind>size|h|min-h)-(?<n>\d+(?:\.\d+)?)$/;
    expect(size.exec("sm:size-9")?.groups?.n).toBe("9");
    expect(size.exec("md:min-h-10")?.groups?.variant).toBe("md");
    expect(size.exec("size-11")?.groups?.variant).toBeUndefined();
  });

  it("uses no fixed palette or raw hex in class names", () => {
    const { container } = render(<Harness initial={{ template: "swipe-rail", cardStyle: "elevated" }} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(?:bg|text|border|ring)-(?:white|black|neutral|slate|gray|red|green|amber)\b/);
    expect(html).not.toMatch(/class="[^"]*#[0-9a-fA-F]{6}/);
  });
});

describe("keyboard focus after a reset (WCAG 2.4.3)", () => {
  it("a per-control reset keeps focus inside the control, never on <body>", () => {
    render(<Harness initial={{ layout: "carousel", template: "gift-circles" }} />);
    const reset = within(control("layout")).getByRole("button", { name: /Reset to inherited/ });
    reset.focus();
    expect(document.activeElement).toBe(reset);
    fireEvent.click(reset);
    // The reset button unmounted with the explicit value; focus moved to the control's first remaining button.
    expect(document.activeElement).not.toBe(document.body);
    expect(control("layout").contains(document.activeElement)).toBe(true);
  });

  it("works for the template, a select, an enum control and a group whose control is disabled", () => {
    render(<Harness initial={{ template: "gift-circles", maxItems: 8, gap: "tight", rows: 2, shape: "heart" }} />);
    for (const group of ["Look", "Content", "Advanced"]) open(group);
    for (const name of ["template", "maxItems", "gap", "shape", "rows"]) {
      const reset = within(control(name)).getByRole("button", { name: /Reset to inherited/ });
      reset.focus();
      fireEvent.click(reset);
      expect(document.activeElement, name).not.toBe(document.body);
      // Rows is disabled for a non-carousel layout: focus falls back to the group header, still inside the panel.
      expect(document.querySelector("[data-discovery-display]")?.contains(document.activeElement), name).toBe(true);
    }
  });

  it("'Reset all' leaves focus on the button", () => {
    render(<Harness initial={{ template: "swipe-rail", gap: "tight" }} />);
    open("Advanced");
    const button = screen.getByRole("button", { name: "Reset all display settings" });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("template override count", () => {
  it("counts settings that override the template, not the template and not a stored inactive rows", () => {
    // gift-circles is not a carousel: the stored `rows` is inactive and must not be counted.
    render(<Harness initial={{ template: "gift-circles", rows: 2, gap: "tight" }} />);
    expect(document.querySelector("[data-template-overridden]")?.textContent).toContain(": 1");
    cleanup();
    render(<Harness initial={{ template: "gift-circles", rows: 2 }} />);
    expect(document.querySelector("[data-template-overridden]")).toBeNull();
    cleanup();
    render(<Harness initial={{ template: "swipe-rail", rows: 1, gap: "tight" }} />);
    expect(document.querySelector("[data-template-overridden]")?.textContent).toContain(": 2");
  });
});

describe("group badge", () => {
  it("exposes its meaning as text, not a bare aria-label", () => {
    render(<Harness initial={{ gap: "tight" }} />);
    const badge = screen.getByRole("button", { name: /^Advanced/ }).querySelector("[title]") as HTMLElement;
    expect(badge.hasAttribute("aria-label")).toBe(false);
    expect(badge.querySelector(".sr-only")?.textContent).toBe("Settings set here: 1");
    expect(badge.querySelector("[aria-hidden='true']")?.textContent).toBe("1");
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

  it("a carousel renders a rail with the resolved rows (mobile) and no focus stop inside the hidden preview", () => {
    render(<Harness initial={{ layout: "carousel", rows: 2 }} />);
    const rail = document.querySelector("[data-preview-rail]") as HTMLElement;
    expect(rail.hasAttribute("tabindex")).toBe(false);
    expect(rail.style.gridTemplateRows).toBe("repeat(2, auto)");
    expect(preview().getAttribute("data-preview-rows")).toBe("2");
  });

  it("VD-4b: a second carousel row exists on mobile only", () => {
    render(<Harness initial={{ template: "swipe-rail" }} />);
    const device = screen.getByRole("group", { name: "Preview device" });
    expect(preview().getAttribute("data-preview-rows")).toBe("2");
    for (const name of ["Tablet", "Desktop"]) {
      fireEvent.click(within(device).getByRole("button", { name }));
      expect(preview().getAttribute("data-preview-rows")).toBe("1");
      expect((document.querySelector("[data-preview-rail]") as HTMLElement).style.gridTemplateRows).toBe("repeat(1, auto)");
      expect(document.querySelector("[data-preview-summary]")?.textContent).toContain("two rows on mobile only");
    }
    fireEvent.click(within(device).getByRole("button", { name: "Mobile" }));
    expect(document.querySelector("[data-preview-summary]")?.textContent).not.toContain("mobile only");
  });

  it("VD-4b: the carousel ignores `columns` and sizes items from the frame (widest frame + 24px, min 88px)", () => {
    const { unmount } = render(<Harness initial={{ layout: "carousel", columns: { mobile: 4 }, size: "lg" }} />);
    const rail = document.querySelector("[data-preview-rail]") as HTMLElement;
    expect(rail.style.gridAutoColumns).toBe("136px"); // lg 112 + 24
    expect(preview().getAttribute("data-preview-columns")).toBe("");
    expect(document.querySelector("[data-preview-summary]")?.textContent).not.toContain("Columns");
    unmount();
    render(<Harness initial={{ layout: "carousel", size: "sm" }} />);
    expect((document.querySelector("[data-preview-rail]") as HTMLElement).style.gridAutoColumns).toBe("88px"); // 56 + 24 < 88
  });

  it("the columns control says columns do not apply to a carousel", () => {
    render(<Harness initial={{ layout: "carousel" }} />);
    expect(document.querySelector("[data-columns-carousel-note]")?.textContent).toContain("Columns do not apply to the carousel");
    cleanup();
    render(<Harness initial={{ layout: "image-grid" }} />);
    expect(document.querySelector("[data-columns-carousel-note]")).toBeNull();
  });

  it("VD-4b: icon-grid shows the icon over the picture, and keeps a value with no icon as its initial", () => {
    render(<Harness initial={{ layout: "icon-grid" }} />);
    const kinds = Array.from(document.querySelectorAll("[data-facet-content]")).map((el) => el.getAttribute("data-facet-content"));
    expect(kinds).not.toContain("image");
    expect(kinds).toContain("icon");
    expect(kinds).toContain("initial");
  });

  it("VD-4b: overlay puts the caption on the frame over the scrim, at the top with label-first; beside is a row", () => {
    render(<Harness initial={{ layout: "image-cards", textPosition: "overlay" }} />);
    const tile = document.querySelector("[data-preview-item] [data-facet-content]") as HTMLElement;
    expect(tile.className).toContain("[&>span:last-child:not(.sr-only)]:absolute");
    expect(tile.className).toContain(":bottom-1.5");
    cleanup();
    render(<Harness initial={{ layout: "image-cards", textPosition: "overlay", contentSequence: "label-first" }} />);
    expect((document.querySelector("[data-preview-item] [data-facet-content]") as HTMLElement).className).toContain(":top-1.5");
    cleanup();
    render(<Harness initial={{ layout: "image-grid", textPosition: "beside", contentSequence: "label-first" }} />);
    const beside = (document.querySelector("[data-preview-item] [data-facet-content]") as HTMLElement).className;
    expect(beside).toContain("flex-row-reverse");
    expect(beside).not.toContain("flex-col");
  });

  it("VD-4b: a count shows only beside a visible name", () => {
    render(<Harness initial={{ layout: "image-grid", showCounts: true, showLabel: false }} />);
    expect(within(preview()).queryByText("24")).toBeNull();
    cleanup();
    render(<Harness initial={{ layout: "image-grid", showCounts: true }} />);
    expect(within(preview()).getAllByText("24").length).toBeGreaterThan(0);
    cleanup();
    // text-list has no label switch: its count always shows.
    render(<Harness initial={{ layout: "text-list", showCounts: true, showLabel: false }} />);
    expect(within(preview()).getAllByText("24").length).toBeGreaterThan(0);
  });

  it("the preview frame is hidden from assistive technology and holds nothing focusable", () => {
    render(<Harness initial={{ layout: "carousel", rows: 2, showCounts: true }} />);
    const frame = preview();
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.querySelector("a, button, input, select, textarea, [tabindex], [role]")).toBeNull();
    // The device switcher and the caption stay outside it, available to everyone.
    expect(frame.contains(screen.getByRole("group", { name: "Preview device" }))).toBe(false);
    expect(frame.contains(document.querySelector("[data-preview-summary]"))).toBe(false);
    // No fake heading or list semantics are exposed.
    expect(screen.queryAllByRole("heading", { level: 5 })).toHaveLength(0);
    expect(within(document.querySelector("[data-discovery-preview]") as HTMLElement).queryAllByRole("listitem")).toHaveLength(0);
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

  it("VD-4b: text-list draws plain names — no tile, no media, and neither showLabel nor text position applies", () => {
    render(<Harness initial={{ layout: "text-list", showLabel: false, textPosition: "overlay", shape: "star" }} />);
    expect(document.querySelectorAll("[data-facet-content]")).toHaveLength(0);
    expect(document.querySelector("[data-preview-item] img, [data-preview-item] svg")).toBeNull();
    expect(screen.getAllByText("Birthday").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-preview-item] .sr-only")).toBeNull();
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
    expect(within(preview()).getAllByText("24").length).toBeGreaterThan(0);
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
    const heading = preview().querySelector("[data-preview-title]") as HTMLElement;
    expect(heading.textContent).toBe(title);
    expect(heading.className).toContain("break-words");
    expect(preview().getAttribute("dir")).toBe("rtl");
  });

  it("falls back to a default title when the section has none", () => {
    render(<Harness base={{ ...BASE, title: "  " }} locale="ar" />);
    expect((preview().querySelector("[data-preview-title]") as HTMLElement).textContent).toBe("تسوّق حسب");
  });

  it("is English LTR in English, and says whether names are real or sample", () => {
    render(<Harness locale="en" />);
    expect(preview().getAttribute("dir")).toBe("ltr");
    expect(document.querySelector("[data-discovery-preview]")?.textContent).toContain("Sample values");
    expect(document.querySelector("[data-discovery-preview]")?.textContent).toContain("Sample preview");
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

  it("real names drive the rendered preview and the status line says it is the catalog's", () => {
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
    expect(document.querySelector("[data-discovery-preview]")?.textContent).toContain("Your catalog's values and pictures");
  });
});
