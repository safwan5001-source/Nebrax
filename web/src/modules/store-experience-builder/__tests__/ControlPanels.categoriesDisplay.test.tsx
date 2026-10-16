/**
 * @vitest-environment jsdom
 *
 * AWJ-STORE-CAT-DESIGN-01 — the categories section's display controls inside the builder's Design tab:
 * contextual groups, presets, per-device values, and the guarantee that none of it touches the section's content.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presetById } from "../categories-display-presets";
import { ControlPanels } from "../ControlPanels";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type StorefrontPresentationConfig,
} from "../presentation/config";

afterEach(cleanup);

const baseConfig = (design?: unknown): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: {
    ...DEFAULT_PRESENTATION_CONFIG.homepage,
    sections: [
      { id: "hero", type: "hero", visible: true },
      { id: "categories", type: "categories", visible: true, label: "تسوّق حسب القسم", design } as never,
      { id: "newArrivals", type: "newArrivals", visible: true },
    ],
  },
});

/** Controlled harness: ControlPanels is a pure function of `config`, so edits must flow back in. */
function mount(initial: StorefrontPresentationConfig, locale: "ar" | "en" = "en") {
  const latest = { current: initial };
  function Harness() {
    const [config, setConfig] = useState(initial);
    latest.current = config;
    return (
      <ControlPanels
        panel="homepage"
        config={config}
        locale={locale}
        liveStoreName={null}
        onChange={(next) => setConfig(next)}
        selectedSection="categories"
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Design" : "التصميم" }));
  const section = () => latest.current.homepage.sections.find((s) => s.id === "categories") as
    | (StorefrontPresentationConfig["homepage"]["sections"][number] & { design?: { display?: Record<string, any> } })
    | undefined;
  return { section, config: () => latest.current };
}

const open = (group: string) => {
  const root = document.querySelector(`[data-catd-group="${group}"]`) as HTMLElement;
  const toggle = within(root).getAllByRole("button")[0];
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return root;
};
/** Exact-pixel inputs live under an "Advanced" disclosure; open it and return the input whose id ends with `suffix`. */
const exact = (suffix: string) => {
  const toggle = document.querySelector(`[data-catd-advanced-toggle$="${suffix.replace(/-exact$/, "")}"]`) as HTMLElement | null;
  if (toggle && toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return Array.from(document.querySelectorAll<HTMLInputElement>("input[type=number]")).find((b) => b.id.endsWith(suffix)) as HTMLInputElement;
};
const layoutButton = (id: string) => document.querySelector(`[data-catd-layout="${id}"]`) as HTMLButtonElement;

describe("the classic look is the starting point", () => {
  it("shows the classic status and only the layout group until a layout is chosen", () => {
    mount(baseConfig());
    expect(screen.getByText("Current look: classic (no display settings)")).toBeTruthy();
    expect(document.querySelector('[data-catd-group="layout"]')).not.toBeNull();
    for (const group of ["card", "image", "name", "responsive"]) {
      expect(document.querySelector(`[data-catd-group="${group}"]`), group).toBeNull();
    }
    expect(document.querySelector("[data-catd-pick-first]")).not.toBeNull();
    expect(layoutButton("classic").getAttribute("aria-pressed")).toBe("true");
  });

  it("mounting the panel changes nothing in the document", () => {
    const { section } = mount(baseConfig({ spacing: { top: "md" } }));
    expect(section()?.design).toEqual({ spacing: { top: "md" } });
  });

  it("the generic section styling is still there beneath it", () => {
    mount(baseConfig());
    expect(document.querySelector("[data-design-inspector]")).not.toBeNull();
    expect(document.querySelector("[data-catd-panel]")).not.toBeNull();
  });

  it("other section types never get the panel", () => {
    const config = baseConfig();
    render(
      <ControlPanels panel="homepage" config={config} locale="en" liveStoreName={null} onChange={vi.fn()} selectedSection="newArrivals" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(document.querySelector("[data-catd-panel]")).toBeNull();
  });
});

describe("choosing a layout", () => {
  it("writes only design.display.layout and reveals the contextual groups", () => {
    const { section } = mount(baseConfig());
    fireEvent.click(layoutButton("grid"));
    expect(section()?.design).toEqual({ display: { layout: "grid" } });
    for (const group of ["card", "image", "name", "responsive"]) {
      expect(document.querySelector(`[data-catd-group="${group}"]`), group).not.toBeNull();
    }
    expect(layoutButton("grid").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-catd-pick-first]")).toBeNull();
  });

  it("never touches the section's content or identity", () => {
    const { section, config } = mount(baseConfig());
    const before = section() as Record<string, unknown>;
    fireEvent.click(layoutButton("circles"));
    const after = section() as Record<string, unknown>;
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(before.type);
    expect(after.visible).toBe(before.visible);
    expect(after.label).toBe(before.label);
    expect("content" in after).toBe(false);
    // The neighbouring sections are untouched, in the same order.
    expect(config().homepage.sections.map((s) => s.id)).toEqual(["hero", "categories", "newArrivals"]);
  });

  it("hides what the layout cannot use: scrolling layouts have item width, not columns", () => {
    mount(baseConfig());
    fireEvent.click(layoutButton("circles"));
    open("responsive");
    expect(document.querySelector('[data-catd-responsive="columns"]')).toBeNull();
    expect(document.querySelector('[data-catd-responsive="itemWidth"]')).not.toBeNull();
    fireEvent.click(layoutButton("grid"));
    expect(document.querySelector('[data-catd-responsive="columns"]')).not.toBeNull();
    expect(document.querySelector('[data-catd-responsive="itemWidth"]')).toBeNull();
  });

  it("offers each layout only the name placements it can draw", () => {
    mount(baseConfig());
    fireEvent.click(layoutButton("circles"));
    const name = open("name");
    const placements = within(name).getByRole("group", { name: "Name placement" });
    expect(within(placements).getAllByRole("button").map((b) => b.textContent)).toEqual(["Below", "Above"]);
    fireEvent.click(layoutButton("grid"));
    const again = within(open("name")).getByRole("group", { name: "Name placement" });
    expect(within(again).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Below",
      "Above",
      "Over the picture",
      "Beside it",
    ]);
  });

  it("switching layout drops a placement the new layout cannot draw", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid", name: { placement: "beside", size: 18 } } }));
    fireEvent.click(layoutButton("circles"));
    expect(section()?.design?.display).toEqual({ layout: "circles", name: { size: 18 } });
  });
});

describe("presets", () => {
  it("each preset replaces only the display and is shown as the applied preset", () => {
    const { section } = mount(baseConfig({ spacing: { top: "md" } }));
    for (const id of ["elegant_cards", "circular", "compact", "image_tiles"] as const) {
      fireEvent.click(document.querySelector(`[data-catd-preset="${id}"]`) as HTMLElement);
      expect(section()?.design?.display).toEqual(presetById(id).display);
      // Section styling outside the display is untouched.
      expect(section()?.design?.spacing).toEqual({ top: "md" });
      expect(document.querySelector(`[data-catd-preset="${id}"]`)?.getAttribute("aria-pressed")).toBe("true");
      expect(document.querySelector("[data-catd-status]")?.getAttribute("data-catd-status")).toBe("preset");
    }
  });

  it("applying a preset leaves the section's content, label and order untouched", () => {
    const { section, config } = mount(baseConfig());
    fireEvent.click(document.querySelector('[data-catd-preset="compact"]') as HTMLElement);
    const s = section() as Record<string, unknown>;
    expect(s.label).toBe("تسوّق حسب القسم");
    expect("content" in s).toBe(false);
    expect(config().homepage.sections.map((x) => x.id)).toEqual(["hero", "categories", "newArrivals"]);
  });

  it("shows a dirty state once a preset is edited, and restores the preset on re-applying it", () => {
    const { section } = mount(baseConfig());
    fireEvent.click(document.querySelector('[data-catd-preset="elegant_cards"]') as HTMLElement);
    open("card");
    const radius = exact("card-radius-exact");
    fireEvent.change(radius, { target: { value: "4" } });
    fireEvent.blur(radius);
    expect(section()?.design?.display?.card?.radius).toBe(4);
    expect(document.querySelector("[data-catd-status]")?.getAttribute("data-catd-status")).toBe("dirty");
    expect(screen.getByText("Edited from preset: Elegant cards")).toBeTruthy();
    fireEvent.click(document.querySelector('[data-catd-preset="elegant_cards"]') as HTMLElement);
    expect(section()?.design?.display).toEqual(presetById("elegant_cards").display);
    expect(document.querySelector("[data-catd-status]")?.getAttribute("data-catd-status")).toBe("preset");
  });

  it("back to classic removes the display entirely (and keeps the rest of the design)", () => {
    const { section } = mount(baseConfig({ spacing: { top: "md" }, display: presetById("circular").display }));
    fireEvent.click(document.querySelector("[data-catd-classic]") as HTMLElement);
    expect(section()?.design).toEqual({ spacing: { top: "md" } });
    expect(screen.getByText("Current look: classic (no display settings)")).toBeTruthy();
  });

  it("back to classic on a display-only design leaves no design at all", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    fireEvent.click(document.querySelector("[data-catd-classic]") as HTMLElement);
    expect(section()?.design).toBeUndefined();
  });
});

describe("card, image and name controls", () => {
  it("card: radius and padding are clamped into 0-32 and written as plain pixels", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    open("card");
    const radius = exact("card-radius-exact");
    fireEvent.change(radius, { target: { value: "500" } });
    fireEvent.blur(radius);
    expect(section()?.design?.display?.card?.radius).toBe(32);
    const padding = exact("card-padding-exact");
    fireEvent.change(padding, { target: { value: "-4" } });
    fireEvent.blur(padding);
    expect(section()?.design?.display?.card?.padding).toBe(0);
  });

  it("card: a typed value is committed on blur, not clamped digit by digit", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    open("card");
    const radius = exact("card-radius-exact");
    fireEvent.change(radius, { target: { value: "1" } });
    expect(section()?.design?.display?.card).toBeUndefined(); // still typing
    fireEvent.change(radius, { target: { value: "16" } });
    fireEvent.blur(radius);
    expect(section()?.design?.display?.card?.radius).toBe(16);
  });

  it("card: border colour only appears when there is a border", () => {
    mount(baseConfig({ display: { layout: "circles" } })); // circles default to no frame
    const card = open("card");
    expect(within(card).queryByRole("group", { name: "Border colour" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Border" }));
    expect(within(open("card")).queryByRole("group", { name: "Border colour" })).not.toBeNull();
  });

  it("card: colours are the theme's tokens (no free colour input anywhere)", () => {
    mount(baseConfig({ display: { layout: "grid" } }));
    for (const group of ["card", "name"]) open(group);
    expect(document.querySelector('[data-catd-panel] input[type="color"]')).toBeNull();
    expect(document.querySelector('[data-catd-panel] input[type="text"]')).toBeNull();
  });

  it("image: the aspect ratio is disabled where the shape decides it", () => {
    mount(baseConfig({ display: { layout: "grid", image: { shape: "circle" } } }));
    const image = open("image");
    const aspect = within(image).getByRole("group", { name: "Aspect ratio" });
    for (const b of within(aspect).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-catd-aspect-derived]")).not.toBeNull();
  });

  it("image: hiding it keeps the name and says so", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const image = open("image");
    fireEvent.click(within(image).getByRole("switch", { name: "Show the picture" }));
    expect(section()?.design?.display?.image).toEqual({ show: false });
    expect(document.querySelector("[data-catd-image-hidden]")).not.toBeNull();
    const nameSwitch = within(open("name")).getByRole("switch", { name: "Show the name" }) as HTMLButtonElement;
    expect(nameSwitch.disabled).toBe(true);
    expect(nameSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("image: custom height is per device and 'automatic' clears every device", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const image = open("image");
    fireEvent.click(within(image).getByRole("button", { name: "Custom" }));
    expect(section()?.design?.display?.image?.height).toEqual({ desktop: 140 });
    const boxes = within(open("image")).getAllByRole("spinbutton");
    const mobile = boxes.find((b) => b.id.endsWith("img-h-mobile")) as HTMLInputElement;
    fireEvent.change(mobile, { target: { value: "5000" } });
    fireEvent.blur(mobile);
    expect(section()?.design?.display?.image?.height).toEqual({ mobile: 400, desktop: 140 });
    fireEvent.click(within(open("image")).getByRole("button", { name: "Automatic (from the ratio)" }));
    expect(section()?.design?.display?.image).toBeUndefined();
  });

  it("name: hiding it stores show:false and explains that the accessible name stays", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const name = open("name");
    fireEvent.click(within(name).getByRole("switch", { name: "Show the name" }));
    expect(section()?.design?.display?.name).toEqual({ show: false });
    expect(screen.getByText(/stays available to screen readers/)).toBeTruthy();
    // The other name controls disappear while the name is hidden.
    expect(within(open("name")).queryByRole("group", { name: "Name placement" })).toBeNull();
  });

  it("name: an overlaid name cannot be left without a backing", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid", name: { placement: "overlay" } } }));
    const name = open("name");
    const bg = within(name).getByRole("group", { name: "Name background" });
    expect(within(bg).queryByRole("button", { name: "None" })).toBeNull();
    expect(document.querySelector("[data-catd-overlay-backed]")).not.toBeNull();
    // On the scrim the name colour is automatic.
    const color = within(name).getByRole("group", { name: "Name colour" });
    for (const b of within(color).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(bg).getByRole("button", { name: "Surface" }));
    expect(section()?.design?.display?.name?.background).toBe("surface");
    for (const b of within(within(open("name")).getByRole("group", { name: "Name colour" })).getAllByRole("button")) {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("name: size is bounded to 12-32 and weight/lines/alignment write plain values", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const name = open("name");
    const size = exact("name-size-exact");
    fireEvent.change(size, { target: { value: "99" } });
    fireEvent.blur(size);
    expect(section()?.design?.display?.name?.size).toBe(32);
    fireEvent.change(within(name).getByRole("combobox"), { target: { value: "800" } });
    expect(section()?.design?.display?.name?.weight).toBe(800);
    fireEvent.click(within(within(name).getByRole("group", { name: "Lines" })).getByRole("button", { name: "Full" }));
    expect(section()?.design?.display?.name?.lines).toBe("natural");
    fireEvent.click(within(within(name).getByRole("group", { name: "Name alignment" })).getByRole("button", { name: "End" }));
    expect(section()?.design?.display?.name?.align).toBe("end");
  });

  it("reset group clears only that group", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid", card: { radius: 4 }, name: { size: 20 } } }));
    const card = open("card");
    fireEvent.click(within(card).getByRole("button", { name: "Reset this group" }));
    expect(section()?.design?.display).toEqual({ layout: "grid", name: { size: 20 } });
  });
});

describe("responsive values", () => {
  it("columns are per device within each device's range, with a per-value reset", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const responsive = open("responsive");
    const cols = (device: string) =>
      within(responsive).getAllByRole("spinbutton").find((b) => b.id.endsWith(`cols-${device}`)) as HTMLInputElement;
    fireEvent.change(cols("mobile"), { target: { value: "9" } });
    fireEvent.blur(cols("mobile"));
    fireEvent.change(cols("desktop"), { target: { value: "1" } });
    fireEvent.blur(cols("desktop"));
    expect(section()?.design?.display?.columns).toEqual({ mobile: 4, desktop: 2 });
    const reset = within(document.querySelector('[data-catd-responsive="columns"]') as HTMLElement).getAllByRole("button", {
      name: /Reset to default/,
    });
    fireEvent.click(reset[0]);
    expect(section()?.design?.display?.columns).toEqual({ desktop: 2 });
  });

  it("an unset device shows the layout default and no reset button", () => {
    mount(baseConfig({ display: { layout: "grid", columns: { desktop: 4 } } }));
    const responsive = open("responsive");
    const box = (device: string) =>
      within(responsive).getAllByRole("spinbutton").find((b) => b.id.endsWith(`cols-${device}`)) as HTMLInputElement;
    expect(box("mobile").value).toBe("2");
    expect(box("tablet").value).toBe("3");
    expect(box("desktop").value).toBe("4");
    expect(within(document.querySelector('[data-catd-responsive="columns"]') as HTMLElement).getAllByRole("button", { name: /Reset to default/ })).toHaveLength(1);
  });

  it("gap is 4-32 px per device (under advanced)", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    open("responsive");
    const gap = exact("gap-tablet");
    fireEvent.change(gap, { target: { value: "1" } });
    fireEvent.blur(gap);
    expect(section()?.design?.display?.gap).toEqual({ tablet: 4 });
  });
});

describe("easy options first, exact pixels on demand (owner decision 2)", () => {
  it("named steps write the plain pixel value — the contract stays pixels", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const card = open("card");
    const radius = within(card).getByRole("group", { name: "Corner radius" });
    fireEvent.click(within(radius).getByRole("button", { name: "X-large" }));
    expect(section()?.design?.display?.card?.radius).toBe(24);
    fireEvent.click(within(within(open("card")).getByRole("group", { name: "Inner padding" })).getByRole("button", { name: "Roomy" }));
    expect(section()?.design?.display?.card?.padding).toBe(20);
    const name = open("name");
    fireEvent.click(within(within(name).getByRole("group", { name: "Font size" })).getByRole("button", { name: "X-large" }));
    expect(section()?.design?.display?.name?.size).toBe(20);
  });

  it("the exact control is collapsed while a named step matches, and opens by itself for a custom value", () => {
    mount(baseConfig({ display: { layout: "grid", card: { radius: 16 } } }));
    open("card");
    const toggle = document.querySelector('[data-catd-advanced-toggle$="card-radius"]') as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    cleanup();
    mount(baseConfig({ display: { layout: "grid", card: { radius: 19 } } }));
    open("card");
    const open2 = document.querySelector('[data-catd-advanced-toggle$="card-radius"]') as HTMLElement;
    expect(open2.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-catd-custom-value]")?.textContent).toContain("19");
  });

  it("the advanced toggle is a keyboard-operable disclosure wired to its panel", () => {
    mount(baseConfig({ display: { layout: "grid" } }));
    open("card");
    const toggle = document.querySelector('[data-catd-advanced-toggle$="card-radius"]') as HTMLElement;
    const panel = document.getElementById(toggle.getAttribute("aria-controls") as string) as HTMLElement;
    expect(panel.hasAttribute("hidden")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect(toggle.className).toMatch(/focus-visible:ring-2/);
  });

  it("gap steps set every device at once; per-device pixels stay available and mark the value custom", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    const responsive = open("responsive");
    const gap = document.querySelector('[data-catd-responsive="gap"]') as HTMLElement;
    fireEvent.click(within(gap).getByRole("button", { name: "Loose" }));
    expect(section()?.design?.display?.gap).toEqual({ mobile: 20, tablet: 20, desktop: 20 });
    expect(within(document.querySelector('[data-catd-responsive="gap"]') as HTMLElement).getByRole("button", { name: "Loose" }).getAttribute("aria-pressed")).toBe("true");
    const tablet = exact("gap-tablet");
    fireEvent.change(tablet, { target: { value: "9" } });
    fireEvent.blur(tablet);
    expect(section()?.design?.display?.gap).toEqual({ mobile: 20, tablet: 9, desktop: 20 });
    expect(document.querySelector("[data-catd-custom-value]")).not.toBeNull();
    void responsive;
  });

  it("a layout's own defaults and the four presets always land on a named step (never a 'custom value' on a fresh start)", () => {
    for (const layout of ["grid", "horizontal_scroll", "circles", "image_tiles", "compact_list"] as const) {
      mount(baseConfig({ display: { layout } }));
      open("card");
      open("name");
      const custom = document.querySelectorAll('[data-catd-steps] ~ [data-catd-custom-value], [data-catd-steps] [data-catd-custom-value]');
      expect(custom.length, layout).toBe(0);
      cleanup();
    }
    for (const id of ["elegant_cards", "circular", "compact", "image_tiles"] as const) {
      mount(baseConfig({ display: presetById(id).display }));
      open("card");
      open("name");
      expect(document.querySelectorAll('[data-catd-steps] [data-catd-custom-value]').length, id).toBe(0);
      cleanup();
    }
  });

  it("every named step stays inside the contract's own range", () => {
    const { section } = mount(baseConfig({ display: { layout: "grid" } }));
    open("card");
    for (const [group, button, key, max] of [
      ["Corner radius", "Round", "radius", 32],
      ["Corner radius", "Square", "radius", 32],
      ["Inner padding", "None", "padding", 32],
    ] as const) {
      fireEvent.click(within(within(open("card")).getByRole("group", { name: group })).getByRole("button", { name: button }));
      const value = section()?.design?.display?.card?.[key as "radius" | "padding"];
      expect(value === undefined || (value >= 0 && value <= max)).toBe(true);
    }
  });
});

describe("generic section styling coexists with the display", () => {
  it("a frame preset from the generic inspector keeps the card display", () => {
    const { section } = mount(baseConfig({ display: presetById("circular").display }));
    const select = document.querySelector("[data-design-preset]") as HTMLSelectElement;
    const soft = Array.from(select.options).find((o) => o.value === "soft");
    expect(soft).toBeTruthy();
    fireEvent.change(select, { target: { value: "soft" } });
    expect(section()?.design?.display).toEqual(presetById("circular").display);
    expect(section()?.design?.radius).toBeDefined(); // the frame preset did apply
  });

  it("resetting the section's design resets the card display with it (one 'reset' covers the design)", () => {
    const { section } = mount(baseConfig({ spacing: { top: "lg" }, display: { layout: "grid" } }));
    fireEvent.click(document.querySelector("[data-design-reset]") as HTMLElement);
    fireEvent.click(document.querySelector("[data-design-reset-confirm]") as HTMLElement);
    expect(section()?.design).toBeUndefined();
  });
});

describe("Arabic", () => {
  it("renders the whole panel in Arabic", () => {
    mount(baseConfig({ display: presetById("elegant_cards").display }), "ar");
    const panel = document.querySelector("[data-catd-panel]") as HTMLElement;
    expect(within(panel).getByText("عرض بطاقات التصنيفات")).toBeTruthy();
    expect(within(panel).getAllByText("طريقة العرض").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("البطاقة").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("الصورة").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("الاسم").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("التجاوب").length).toBeGreaterThan(0);
    expect(panel.textContent).not.toMatch(/Elegant cards|Card style/);
  });
});

describe("accessibility of the controls", () => {
  it("every group header is a disclosure with aria-expanded and aria-controls", () => {
    mount(baseConfig({ display: { layout: "grid" } }));
    for (const group of ["layout", "card", "image", "name", "responsive"]) {
      const root = document.querySelector(`[data-catd-group="${group}"]`) as HTMLElement;
      const toggle = within(root).getAllByRole("button")[0];
      expect(toggle.getAttribute("aria-expanded")).not.toBeNull();
      const controls = toggle.getAttribute("aria-controls") as string;
      expect(document.getElementById(controls)).not.toBeNull();
    }
  });

  it("every control button is at least 44px tall by class and has a focus ring", () => {
    mount(baseConfig({ display: { layout: "grid" } }));
    for (const group of ["card", "image", "name"]) open(group);
    const buttons = Array.from(document.querySelectorAll("[data-catd-panel] button[aria-pressed], [data-catd-panel] button[role='switch']"));
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) {
      expect(b.className, b.textContent ?? "").toMatch(/min-h-11/);
      expect(b.className, b.textContent ?? "").toMatch(/focus-visible:ring-2/);
    }
  });

  it("the inherited choice is marked by a dashed outline AND data attribute, the chosen one is pressed", () => {
    mount(baseConfig({ display: { layout: "grid", card: { style: "shadow" } } }));
    const card = open("card");
    const style = within(card).getByRole("group", { name: "Card style" });
    expect(within(style).getByRole("button", { name: "Soft shadow" }).getAttribute("aria-pressed")).toBe("true");
    const hover = within(card).getByRole("group", { name: "Hover and focus effect" });
    expect(within(hover).getByRole("button", { name: "None" }).getAttribute("data-effective")).toBe("inherited");
  });

  it("a status line announces the current look politely", () => {
    mount(baseConfig());
    const status = document.querySelector("[data-catd-status]") as HTMLElement;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain("classic");
  });
});
