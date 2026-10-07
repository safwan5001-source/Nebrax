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
