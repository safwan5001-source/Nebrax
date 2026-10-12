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

function mount(config: StorefrontPresentationConfig, selected: string | null = "n1") {
  const onChange = vi.fn();
  render(
    <ControlPanels
      panel="homepage"
      config={config}
      locale="en"
      liveStoreName={null}
      onChange={onChange}
      selectedSection={selected}
    />,
  );
  return onChange;
}
const lastSections = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig).homepage.sections;
const nameInput = () => document.querySelector<HTMLInputElement>("[data-section-name]")!;

/** CUST-HV V10c (V0 §17.1) — a section's own name: editor metadata, shown in the list and the inspector, never in the store. */
describe("section name (V10c)", () => {
  it("typing stores the name; the placeholder is the section's default title", () => {
    const onChange = mount(withSections([{ id: "n1", type: "newArrivals", visible: true }]));
    expect(nameInput().placeholder).toBe("New arrivals");
    fireEvent.change(nameInput(), { target: { value: "Eid drop" } });
    expect(lastSections(onChange)[0]).toEqual({ id: "n1", type: "newArrivals", visible: true, label: "Eid drop" });
  });

  it("clearing removes the key (absence = the default title)", () => {
    const onChange = mount(withSections([{ id: "n1", type: "newArrivals", visible: true, label: "Eid drop" }]));
    expect(nameInput().value).toBe("Eid drop");
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(lastSections(onChange)[0]).toEqual({ id: "n1", type: "newArrivals", visible: true });
  });

  it("the name is limited to 60 characters (code points) — the field never holds what Save would drop", () => {
    const onChange = mount(withSections([{ id: "n1", type: "newArrivals", visible: true }]));
    fireEvent.change(nameInput(), { target: { value: "ع".repeat(70) } });
    expect(Array.from(lastSections(onChange)[0].label ?? "")).toHaveLength(60);
    expect(Array.from(nameInput().value)).toHaveLength(60);
  });

  it("trims with the stored form's set: a name of only non-breaking spaces is a name (as on the server), plain spaces are not", () => {
    const onChange = mount(withSections([{ id: "n1", type: "newArrivals", visible: true }]));
    fireEvent.change(nameInput(), { target: { value: "\u00a0" } });
    expect(lastSections(onChange)[0].label).toBe("\u00a0");
  });

  it("the section list shows the name, with the type as a quiet hint", () => {
    mount(withSections([
      { id: "n1", type: "newArrivals", visible: true, label: "Eid drop" },
      { id: "b1", type: "benefits", visible: true },
    ]), null);
    const rows = document.querySelectorAll("[data-composer-section]");
    expect(rows[0].textContent).toContain("Eid drop");
    expect(rows[0].querySelector("[data-section-type-hint]")?.textContent).toBe("New arrivals");
    expect(rows[1].querySelector("[data-section-type-hint]")).toBeNull();
  });

  it("duplicating a named section keeps the name with a suffix, within the limit", () => {
    const onChange = mount(
      withSections([{ id: "f1", type: "featured", visible: true, label: "x".repeat(58), design: { radius: "md" } }]),
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate section" }));
    const [original, copy] = lastSections(onChange);
    expect(copy.id).not.toBe(original.id);
    expect(Array.from(copy.label ?? "").length).toBeLessThanOrEqual(60);
    expect(copy.label?.startsWith("x".repeat(58))).toBe(true);
    expect(copy.design).toEqual({ radius: "md" });
  });

  it("an unnamed section duplicates without inventing a name", () => {
    const onChange = mount(withSections([{ id: "f1", type: "featured", visible: true }]), null);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate section" }));
    expect("label" in lastSections(onChange)[1]).toBe(false);
  });
});
