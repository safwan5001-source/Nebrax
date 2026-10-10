/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { ColourField } from "../design/ColourField";
import { DesignInspector } from "../design/DesignInspector";
import { clearDesignClipboard } from "../design/design-clipboard";
import { PaletteEditor } from "../design/PaletteEditor";
import { customizerMessage } from "../messages";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { CUSTOMIZER_MESSAGES } from "../messages";
import type { SectionDesign } from "../presentation/section-design";
import type { DesignContext } from "../presentation/section-design-resolve";

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const ctx: DesignContext = { primaryColor: "#12372a", accentColor: null, dir: "ltr" };

beforeEach(() => {
  clearDesignClipboard();
  window.localStorage.clear();
});
afterEach(cleanup);

function Harness({ type, initial }: { type: string; initial?: SectionDesign }) {
  const [design, setDesign] = useState<SectionDesign | undefined>(initial);
  return (
    <>
      <DesignInspector type={type} design={design} ctx={ctx} t={t} onChange={setDesign} />
      <output data-testid="design">{JSON.stringify(design ?? null)}</output>
    </>
  );
}
const out = () => JSON.parse(screen.getByTestId("design").textContent ?? "null");

describe("ColourField (CUST-HV V5d)", () => {
  function Field({ initial }: { initial?: Parameters<typeof ColourField>[0]["value"] }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <ColourField label="Colour" value={value} onChange={setValue} ctx={ctx} t={t} />
        <output data-testid="v">{JSON.stringify(value ?? null)}</output>
      </>
    );
  }
  const v = () => JSON.parse(screen.getByTestId("v").textContent ?? "null");

  it("picks a role as a reference (it follows the palette), never a copied colour", () => {
    render(<Field />);
    fireEvent.click(screen.getByRole("button", { name: /^Accent #/ }));
    expect(v()).toEqual({ role: "accent" });
  });

  it("accepts a valid hex (lower-cased), rejects an invalid one with an explanation, and remembers recents", () => {
    render(<Field />);
    const input = screen.getByLabelText("Colour code");
    fireEvent.change(input, { target: { value: "#12" } });
    expect(v()).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("6-digit");
    fireEvent.change(input, { target: { value: "#ABCDEF" } });
    expect(v()).toEqual({ hex: "#abcdef" });
    expect(document.querySelector('[data-colour-recent="#abcdef"]')).not.toBeNull();
    // a CSS string is never accepted
    fireEvent.change(input, { target: { value: "red" } });
    expect(v()).toEqual({ hex: "#abcdef" });
  });

  it("clear returns to automatic / unset", () => {
    render(<Field initial={{ hex: "#101820" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(v()).toBeNull();
  });

  it("storage being blocked never breaks the field", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Field />);
    fireEvent.change(screen.getByLabelText("Colour code"), { target: { value: "#101820" } });
    expect(v()).toEqual({ hex: "#101820" });
    spy.mockRestore();
  });
});

const field = (name: string) =>
  within(document.querySelector(`[data-colour-field="${name}"]`) as HTMLElement);
const setHex = (name: string, hex: string) =>
  fireEvent.change(field(name).getByLabelText("Colour code"), { target: { value: hex } });

describe("DesignInspector (CUST-HV V5d)", () => {
  it("offers only the groups the type declares", () => {
    render(<Harness type="productShelf" />);
    expect(screen.getByText("Background")).toBeTruthy();
    expect(document.querySelector('[data-colour-field="text-heading"]')).not.toBeNull();
    expect(document.querySelector('[data-colour-field="text-body"]')).toBeNull(); // shelves: heading colour only
    expect(screen.queryByText("Border")).toBeNull();
    expect(screen.queryByText("Corners")).toBeNull();
    expect(screen.queryByText("Shadow")).toBeNull();
  });

  it("a type with no design capability says so instead of showing empty controls", () => {
    render(<Harness type="mystery" />);
    expect(screen.getByText("This section has no design options yet.")).toBeTruthy();
  });

  it("a solid background stores a role reference; automatic text is shown, and removing the background removes it", () => {
    render(<Harness type="banner" />);
    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    expect(out()).toEqual({ background: { kind: "solid", color: { role: "brand" } } });
    expect(field("text-body").getByText("Automatic (clearest on the background)")).toBeTruthy();
    const bgGroup = screen.getByText("Background").closest("fieldset") as HTMLElement;
    fireEvent.click(within(bgGroup).getByRole("button", { name: "None" }));
    expect(out()).toBeNull();
  });

  it("an explicit colour that fails is flagged with the ratio and one tap fixes it", () => {
    render(<Harness type="banner" initial={{ background: { kind: "solid", color: { hex: "#102030" } } }} />);
    setHex("text-body", "#222222");
    expect(out().text.body).toEqual({ hex: "#222222" });
    expect(field("text-body").getByRole("alert").textContent).toContain("cannot be published");
    fireEvent.click(field("text-body").getByRole("button", { name: "Use the clearest" }));
    expect(out().text.body).toEqual({ hex: "#ffffff" });
    expect(field("text-body").getByRole("status").textContent).toBe("Contrast is sufficient");
  });

  it("a gradient that cannot be proven readable is blocked at the editor with the same verdict as the server", () => {
    render(
      <Harness
        type="banner"
        initial={{
          background: { kind: "gradient", from: { hex: "#d1456a" }, to: { hex: "#1e8b9a" }, direction: "to-end" },
        }}
      />,
    );
    expect(field("bg-to").getByRole("alert").textContent).toContain("cannot be proven");
    setHex("bg-from", "#0b1b3a");
    setHex("bg-to", "#12372a");
    expect(document.querySelector('[data-colour-field="bg-to"] [role="alert"]')).toBeNull();
  });

  it("a section that paints its own dark surface disables text colours until a background exists", () => {
    render(<Harness type="hero" />);
    expect(document.querySelector("[data-design-needs-background]")).not.toBeNull();
    expect((field("text-body").getByLabelText("Colour code") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    expect(document.querySelector("[data-design-needs-background]")).toBeNull();
    expect((field("text-body").getByLabelText("Colour code") as HTMLInputElement).disabled).toBe(false);
  });

  it("full-width band is offered only for a solid background", () => {
    render(<Harness type="featured" initial={{ background: { kind: "gradient", from: { role: "brand" }, to: { role: "accent" }, direction: "to-end" } }} />);
    expect(document.querySelector("[data-design-bleed]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    fireEvent.click(document.querySelector("[data-design-bleed]") as HTMLElement);
    expect(out().width).toEqual({ mode: "full" });
  });

  it("spacing / border / radius / shadow write enumerated values only", () => {
    render(<Harness type="benefits" />);
    const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
    fireEvent.change(select("Top"), { target: { value: "lg" } });
    fireEvent.change(select("Corners"), { target: { value: "pill" } });
    fireEvent.change(select("Shadow"), { target: { value: "soft" } });
    fireEvent.click(screen.getByRole("button", { name: "Thin" }));
    expect(out()).toEqual({ spacing: { top: "lg" }, border: { width: "hairline" }, radius: "pill", shadow: "soft" });
    // "None" is a decision (it removes a legacy border); "Default" returns to the section's own look
    const borderGroup = screen.getByText("Border", { selector: "legend" }).closest("fieldset") as HTMLElement;
    fireEvent.click(within(borderGroup).getByRole("button", { name: "None" }));
    expect(out().border).toEqual({ width: "none" });
    fireEvent.click(within(borderGroup).getByRole("button", { name: "Default" }));
    expect(out().border).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Thin" }));
    fireEvent.change(select("Top"), { target: { value: "" } });
    expect(out().spacing).toBeUndefined();
  });

  it("text alignment and content position are separate controls writing separate fields", () => {
    render(<Harness type="customContent" />);
    const text = screen.getByText("Text alignment").closest("label") as HTMLElement;
    const block = screen.getByText("Content position").closest("label") as HTMLElement;
    fireEvent.click(within(block).getByRole("button", { name: "Centre" }));
    fireEvent.click(within(text).getByRole("button", { name: "Start" }));
    expect(out()).toEqual({ text: { align: "start" }, align: "center" });
  });

  it("typography offers named steps only, per the type's allowance, and stores real numbers for weights", () => {
    const { unmount } = render(<Harness type="benefits" />);
    const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
    fireEvent.change(select("Heading size"), { target: { value: "xl" } });
    fireEvent.change(select("Text size"), { target: { value: "lg" } });
    fireEvent.change(select("Heading weight"), { target: { value: "700" } });
    fireEvent.change(select("Line spacing"), { target: { value: "relaxed" } });
    fireEvent.change(select("Heading style"), { target: { value: "underline" } });
    expect(out().typography).toEqual({
      headingScale: "xl",
      bodyScale: "lg",
      headingWeight: 700,
      lineHeight: "relaxed",
      headingStyle: "underline",
    });
    fireEvent.change(select("Heading weight"), { target: { value: "" } });
    expect(out().typography.headingWeight).toBeUndefined();
    unmount();

    // a shelf declares only the heading style
    render(<Harness type="featured" />);
    expect(screen.queryByLabelText("Heading size")).toBeNull();
    expect(screen.getByLabelText("Heading style")).toBeTruthy();
  });

  it("copy then paste moves only what the target type can render; reset is two-step", () => {
    const rich: SectionDesign = {
      background: { kind: "solid", color: { role: "surfaceAlt" } },
      border: { width: "hairline" },
      radius: "md",
      spacing: { top: "lg" },
    };
    const { unmount } = render(<Harness type="banner" initial={rich} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy design" }));
    expect(screen.getByText("Design copied.")).toBeTruthy();
    unmount();

    render(<Harness type="productShelf" />);
    fireEvent.click(screen.getByRole("button", { name: "Paste design" }));
    // a shelf declares background + spacing, not border / radius
    expect(out()).toEqual({ background: { kind: "solid", color: { role: "surfaceAlt" } }, spacing: { top: "lg" } });

    fireEvent.click(screen.getByRole("button", { name: "Reset design" }));
    expect(out()).not.toBeNull(); // not yet: it asks first
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(out()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset design" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }));
    expect(out()).toBeNull();
  });

  it("paste is disabled until something was copied", () => {
    render(<Harness type="banner" />);
    expect((screen.getByRole("button", { name: "Paste design" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Copy design" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("DesignInspector — separators and reveal (CUST-HV V5e-3)", () => {
  const field = (name: string) => document.querySelector(`[data-design-field="${name}"]`) as HTMLSelectElement;

  it("every designable type offers a separator; only hero and banner offer the reveal", () => {
    for (const type of ["hero", "banner", "categories", "newArrivals", "featured", "offers", "productShelf", "discovery", "benefits", "customContent", "appPromo", "deliveryPromise", "wholesale"]) {
      render(<Harness type={type} />);
      expect(field("separator.top"), type).not.toBeNull();
      expect(field("motion.reveal") !== null, type).toBe(type === "hero" || type === "banner");
      cleanup();
    }
  });

  it("an edge's kind writes the enumerated value; colour and height appear only once an edge is set", () => {
    render(<Harness type="benefits" />);
    expect(document.querySelector('[data-colour-field="separator-color"]')).toBeNull();
    expect(field("separator.height")).toBeNull();
    fireEvent.change(field("separator.bottom"), { target: { value: "wave" } });
    expect(out()).toEqual({ separator: { bottom: "wave" } });
    expect(document.querySelector('[data-colour-field="separator-color"]')).not.toBeNull();
    fireEvent.change(field("separator.height"), { target: { value: "lg" } });
    fireEvent.change(field("separator.top"), { target: { value: "line" } });
    expect(out()).toEqual({ separator: { top: "line", bottom: "wave", height: "lg" } });
  });

  it("clearing both edges removes the whole group", () => {
    render(<Harness type="benefits" initial={{ separator: { bottom: "curve" } }} />);
    fireEvent.change(field("separator.bottom"), { target: { value: "" } });
    expect(out()).toBeNull();
  });

  it("clearing the last edge drops a chosen colour and height too — nothing is stranded in the document (review)", () => {
    render(
      <Harness
        type="benefits"
        initial={{ separator: { bottom: "wave", color: { hex: "#112233" }, height: "lg" } }}
      />,
    );
    fireEvent.change(field("separator.bottom"), { target: { value: "none" } });
    expect(out()).toBeNull();
  });

  it("the automatic colour shown is the one the resolver uses for the chosen kind (review)", () => {
    const shown = () => document.querySelector('[data-colour-field="separator-color"] [data-colour-current]')?.textContent;
    const { unmount } = render(<Harness type="benefits" initial={{ separator: { bottom: "line" } }} />);
    expect(shown()).toBe("Border"); // a line follows the border role
    unmount();
    const band = render(<Harness type="benefits" initial={{ separator: { bottom: "band" } }} />);
    expect(shown()).toBe("Brand"); // a band follows the brand
    band.unmount();
    const wave = render(
      <Harness type="benefits" initial={{ background: { kind: "solid", color: { hex: "#101820" } }, separator: { top: "wave" } }} />,
    );
    expect(shown()).toBe("Page colour"); // on a designed background a shape cuts in with the page behind it
    wave.unmount();
    const bare = render(<Harness type="benefits" initial={{ separator: { top: "wave" } }} />);
    expect(shown()).toBe("Brand"); // with no designed background a page-coloured shape would be invisible
    bare.unmount();
    render(<Harness type="benefits" initial={{ separator: { top: "line", bottom: "band" } }} />);
    expect(shown()).toBe("Automatic (per shape)"); // mixed defaults are not summarised by one swatch
  });

  it("a full-width band explains that it carries no separator", () => {
    render(
      <Harness
        type="featured"
        initial={{ background: { kind: "solid", color: { hex: "#101820" } }, width: { mode: "full" }, separator: { bottom: "wave" } }}
      />,
    );
    expect(document.querySelector("[data-design-sep-bleed]")).not.toBeNull();
  });

  it("the reveal stores only the named value; the default removes the group", () => {
    render(<Harness type="banner" />);
    fireEvent.change(field("motion.reveal"), { target: { value: "fade-up" } });
    expect(out()).toEqual({ motion: { reveal: "fade-up" } });
    fireEvent.change(field("motion.reveal"), { target: { value: "" } });
    expect(out()).toBeNull();
  });
});

describe("PaletteEditor (CUST-HV V5d)", () => {
  it("sets and clears a role; an unset role shows today's token as the value in use", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PaletteEditor palette={undefined} ctx={ctx} t={t} onChange={onChange} />);
    expect(document.querySelectorAll("[data-colour-role]").length).toBe(0); // hex only: roles define themselves
    setHex("palette-surface", "#101820");
    expect(onChange).toHaveBeenLastCalledWith({ surface: "#101820" });
    rerender(<PaletteEditor palette={{ surface: "#101820" }} ctx={ctx} t={t} onChange={onChange} />);
    fireEvent.click(field("palette-surface").getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("accent role (CUST-HV V5d-3 / DEF-2)", () => {
  it("the palette editor sets and clears the accent (the existing accentColor key)", () => {
    const onAccent = vi.fn();
    const { rerender } = render(
      <PaletteEditor palette={undefined} ctx={ctx} t={t} onChange={vi.fn()} onAccentChange={onAccent} />,
    );
    setHex("palette-accent", "#d1456a");
    expect(onAccent).toHaveBeenLastCalledWith("#d1456a");
    rerender(
      <PaletteEditor palette={undefined} ctx={{ ...ctx, accentColor: "#d1456a" }} t={t} onChange={vi.fn()} onAccentChange={onAccent} />,
    );
    fireEvent.click(field("palette-accent").getByRole("button", { name: "Clear" }));
    expect(onAccent).toHaveBeenLastCalledWith(null);
  });
});

describe("Design tab in the section inspector (CUST-HV V5d)", () => {
  const config = (type: "hero" | "banner"): StorefrontPresentationConfig => ({
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections: [{ id: "s1", type, visible: true }] },
  });

  it("opens on Content, switches to Design, and a design edit reaches the document", () => {
    const onChange = vi.fn();
    render(<ControlPanels panel="homepage" config={config("banner")} locale="en" liveStoreName={null} onChange={onChange} selectedSection="s1" />);
    expect(document.querySelector("[data-design-inspector]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    expect(document.querySelector("[data-design-inspector='banner']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    expect(next.homepage.sections[0].design).toEqual({ background: { kind: "solid", color: { role: "brand" } } });
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    expect(document.querySelector("[data-design-inspector]")).toBeNull();
  });
});

describe("design messages (CUST-HV V5d)", () => {
  it("every design / palette key exists in Arabic and English", () => {
    const keys = (pack: object) => Object.keys(pack).filter((k) => /^(design|palette|contentTab)/.test(k)).sort();
    expect(keys(CUSTOMIZER_MESSAGES.ar)).toEqual(keys(CUSTOMIZER_MESSAGES.en));
    expect(keys(CUSTOMIZER_MESSAGES.en).length).toBeGreaterThan(50);
  });
});

describe("hero / banner placement grid and height (CUST-HV V6c-3)", () => {
  const cell = (row: string, col: string) =>
    document.querySelector(`[data-placement-cell="${row}-${col}"]`) as HTMLButtonElement;

  it("offers the 3×3 grid for hero and banner, and the old three-way control for other types", () => {
    const { unmount } = render(<Harness type="hero" />);
    expect(document.querySelectorAll("[data-placement-cell]")).toHaveLength(9);
    unmount();
    render(<Harness type="benefits" />);
    expect(document.querySelectorAll("[data-placement-cell]")).toHaveLength(0);
    expect(screen.getByText("Content position")).toBeTruthy();
  });

  it("a cell writes BOTH halves in one commit: align (inline) and valign (block); the pressed cell is exposed", () => {
    render(<Harness type="banner" />);
    fireEvent.click(cell("end", "start"));
    expect(out()).toEqual({ align: "start", valign: "end" });
    expect(cell("end", "start").getAttribute("aria-pressed")).toBe("true");
    expect(cell("start", "start").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cell("center", "center"));
    expect(out()).toEqual({ align: "center", valign: "center" });
  });

  it("the grid is a labelled group, not inside a <label>: clicking the caption or hint selects nothing", () => {
    render(<Harness type="hero" />);
    const group = screen.getByRole("group", { name: "Content position" });
    expect(group.tagName).toBe("FIELDSET");
    expect(cell("start", "start").closest("label")).toBeNull();
    // a click on the caption / hint must not be forwarded to the first cell
    fireEvent.click(screen.getByText("Content position"));
    fireEvent.click(group.querySelector("p") as HTMLElement);
    expect(out()).toBeNull();
    expect(document.querySelectorAll('[data-placement-cell][aria-pressed="true"]')).toHaveLength(0);
  });

  it("every cell has an accessible name that says where it is", () => {
    render(<Harness type="hero" />);
    expect(cell("start", "start").getAttribute("aria-label")).toBe("top Start");
    expect(cell("center", "center").getAttribute("aria-label")).toBe("middle Centre");
    expect(cell("end", "end").getAttribute("aria-label")).toBe("bottom End");
  });

  it("Automatic clears both halves and is disabled while nothing is chosen", () => {
    render(<Harness type="hero" initial={{ align: "end", valign: "start", radius: "lg" }} />);
    const reset = document.querySelector("[data-placement-reset]") as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(out()).toEqual({ radius: "lg" });
    expect(reset.disabled).toBe(true);
    expect(document.querySelectorAll('[data-placement-cell][aria-pressed="true"]')).toHaveLength(0);
  });

  it("an existing align alone (no valign) shows no pressed cell and keeps its value until a cell is chosen", () => {
    render(<Harness type="banner" initial={{ align: "center" }} />);
    expect(document.querySelectorAll('[data-placement-cell][aria-pressed="true"]')).toHaveLength(0);
    expect(out()).toEqual({ align: "center" });
  });

  it("height presets are named steps in a select; Default removes the group; hero and banner only", () => {
    const { unmount } = render(<Harness type="hero" />);
    const height = () => screen.getByLabelText("Section height") as HTMLSelectElement;
    expect([...height().options].map((o) => o.value)).toEqual(["", "compact", "standard", "tall", "screen"]);
    fireEvent.change(height(), { target: { value: "tall" } });
    expect(out()).toEqual({ mediaTreatment: { height: "tall" } });
    fireEvent.change(height(), { target: { value: "screen" } });
    expect(out()).toEqual({ mediaTreatment: { height: "screen" } });
    fireEvent.change(height(), { target: { value: "" } });
    expect(out()).toBeNull();
    unmount();
    render(<Harness type="categories" />);
    expect(screen.queryByText("Section height")).toBeNull();
  });

  it("has AR and EN copy for every new key", () => {
    for (const key of [
      "designPlacementHint",
      "designHeight",
      "designHeightCompact",
      "designHeightStandard",
      "designHeightTall",
      "designHeightScreen",
      "designHeightHint",
    ] as const) {
      expect(CUSTOMIZER_MESSAGES.ar[key]).toBeTruthy();
      expect(CUSTOMIZER_MESSAGES.en[key]).toBeTruthy();
    }
  });
});
