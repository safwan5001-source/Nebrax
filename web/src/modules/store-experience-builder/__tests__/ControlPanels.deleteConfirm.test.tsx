/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";

afterEach(cleanup);

const withSections = (sections: StorefrontPresentationConfig["homepage"]["sections"]): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
});

function mount(config: StorefrontPresentationConfig) {
  const onChange = vi.fn();
  render(<ControlPanels panel="homepage" config={config} locale="en" liveStoreName={null} onChange={onChange} />);
  return onChange;
}
const lastSections = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig).homepage.sections;

describe("deleting a section (CUST-HV V1B / DEF-6)", () => {
  it("a section with authored content asks first, and Cancel keeps it", () => {
    const onChange = mount(
      withSections([{ id: "b1", type: "banner", visible: true, content: { title: { ar: "عرض", en: "Sale" } } as never }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("Delete this section?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a section with only a design asks too; confirming removes it", () => {
    const onChange = mount(
      withSections([
        { id: "b1", type: "banner", visible: true, design: { radius: "md" } },
        { id: "b2", type: "benefits", visible: true },
      ]),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Delete section" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(lastSections(onChange).map((s) => s.id)).toEqual(["b2"]);
  });

  it("Escape cancels", () => {
    const onChange = mount(withSections([{ id: "b1", type: "banner", visible: true, design: { radius: "md" } }]));
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an empty section is still removed immediately (no behaviour change)", () => {
    const onChange = mount(withSections([{ id: "b1", type: "banner", visible: true }]));
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(lastSections(onChange)).toEqual([]);
  });
});
