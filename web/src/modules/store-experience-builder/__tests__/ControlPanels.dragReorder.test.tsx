/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";

afterEach(cleanup);

const config: StorefrontPresentationConfig = {
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: {
    ...DEFAULT_PRESENTATION_CONFIG.homepage,
    sections: [
      { id: "a", type: "hero", visible: true },
      { id: "b", type: "categories", visible: true },
      { id: "c", type: "benefits", visible: true },
    ],
  },
};

function mount() {
  const onChange = vi.fn();
  render(<ControlPanels panel="homepage" config={config} locale="en" liveStoreName={null} onChange={onChange} />);
  return onChange;
}
const row = (id: string) => document.querySelector(`[data-section-id="${id}"]`) as HTMLElement;
const order = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig).homepage.sections.map((s) => s.id);

/** CUST-HV V10d — drag and drop is an extra way to reorder; the buttons stay the keyboard path. */
describe("composer drag and drop (V10d)", () => {
  it("dropping a section on another moves it there", () => {
    const onChange = mount();
    fireEvent.dragStart(row("a"));
    fireEvent.dragOver(row("c"));
    expect(row("c").getAttribute("data-drop-target")).toBe("after");
    fireEvent.drop(row("c"));
    expect(order(onChange)).toEqual(["b", "c", "a"]);
  });

  it("dragging upward drops before the target; the indicator and the dragged row are marked, and clear on end", () => {
    const onChange = mount();
    fireEvent.dragStart(row("c"));
    expect(row("c").hasAttribute("data-dragging")).toBe(true);
    fireEvent.dragOver(row("a"));
    expect(row("a").getAttribute("data-drop-target")).toBe("before");
    fireEvent.drop(row("a"));
    expect(order(onChange)).toEqual(["c", "a", "b"]);
    fireEvent.dragEnd(row("c"));
    expect(document.querySelector("[data-dragging],[data-drop-target]")).toBeNull();
  });

  it("dropping on itself, or dragging nothing, changes nothing", () => {
    const onChange = mount();
    fireEvent.dragStart(row("b"));
    fireEvent.drop(row("b"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.dragOver(row("a"));
    expect(row("a").hasAttribute("data-drop-target")).toBe(false);
  });

  it("the up / down buttons still work (the keyboard path)", () => {
    const onChange = mount();
    fireEvent.click(row("b").querySelector('button[aria-label="Down"]') as HTMLElement);
    expect(order(onChange)).toEqual(["a", "c", "b"]);
  });

  it("the handle is a decorative hint, not a control", () => {
    mount();
    const handle = row("a").querySelector("[data-drag-handle]") as HTMLElement;
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(handle.tagName).toBe("SPAN");
  });
});
