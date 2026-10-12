/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DesignInspector } from "../design/DesignInspector";
import { customizerMessage } from "../messages";
import { SECTION_DESIGN_CAPABILITIES, type SectionDesign, normalizeSectionDesign } from "../presentation/section-design";
import type { DesignContext } from "../presentation/section-design-resolve";
import { sectionPresetsFor } from "../themes";

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const ctx: DesignContext = { primaryColor: "#12372a", accentColor: null, dir: "ltr" };

afterEach(cleanup);

describe("built-in section presets (V10c)", () => {
  it("every preset is already in the section's normal form, structural only (no colour reference), for every type", () => {
    for (const type of Object.keys(SECTION_DESIGN_CAPABILITIES)) {
      for (const preset of sectionPresetsFor(type)) {
        expect(normalizeSectionDesign(type, preset.design), `${type}/${preset.id}`).toEqual(preset.design);
        expect(JSON.stringify(preset.design), `${type}/${preset.id}`).not.toMatch(/background|text|color|colour|role|hex|#/i);
        expect(preset.label.ar && preset.label.en).toBeTruthy();
      }
    }
  });

  it("only types that can use a preset get any; ids and designs are unique per type", () => {
    expect(sectionPresetsFor("not-a-section")).toEqual([]);
    for (const type of Object.keys(SECTION_DESIGN_CAPABILITIES)) {
      const presets = sectionPresetsFor(type);
      expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
      expect(new Set(presets.map((p) => JSON.stringify(p.design))).size).toBe(presets.length);
    }
  });

  it("a shelf offers its theme's rail and column styles; a type without that group does not", () => {
    const shelf = sectionPresetsFor("featured");
    expect(shelf.some((p) => p.design.layout === "rail")).toBe(true);
    expect(shelf.some((p) => p.design.columns === 4)).toBe(true);
    expect(sectionPresetsFor("categories").some((p) => p.design.layout !== undefined)).toBe(false);
  });
});

function Harness({ type, initial }: { type: string; initial?: SectionDesign }) {
  const [design, setDesign] = useState<SectionDesign | undefined>(initial);
  return (
    <>
      <DesignInspector type={type} design={design} ctx={ctx} t={t} onChange={setDesign} />
      <output data-testid="design">{JSON.stringify(design ?? null)}</output>
    </>
  );
}

describe("DesignInspector — ready styles (V10c)", () => {
  it("applying a style replaces the section's design and says so; reset still clears it", () => {
    render(<Harness type="featured" initial={{ layout: "rail" }} />);
    const select = document.querySelector<HTMLSelectElement>("[data-design-preset]")!;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "airy" } });
    expect(JSON.parse(screen.getByTestId("design").textContent ?? "null")).toEqual({
      spacing: { top: "lg", bottom: "lg" },
    });
    expect(screen.getAllByRole("status").map((n) => n.textContent)).toContain("Style applied. You can adjust it or reset it.");
    expect(select.value).toBe("");
    fireEvent.click(document.querySelector("[data-design-reset]")!);
    fireEvent.click(document.querySelector("[data-design-reset-confirm]")!);
    expect(screen.getByTestId("design").textContent).toBe("null");
  });

  it("a type no preset applies to shows no selector", () => {
    render(<Harness type="not-a-section" />);
    expect(document.querySelector("[data-design-preset]")).toBeNull();
  });
});
