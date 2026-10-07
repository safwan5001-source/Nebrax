/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalTokensEditor } from "../design/GlobalTokensEditor";
import { customizerMessage } from "../messages";
import type { GlobalTokensDoc } from "../presentation/global-tokens";

afterEach(cleanup);

const tAr = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("ar", key);
const tEn = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

function mount(config: GlobalTokensDoc = {}, t = tEn, colours?: { primaryColor: string; accentColor: string | null }) {
  const patch = vi.fn();
  const view = render(<GlobalTokensEditor config={config} t={t} patch={patch} colours={colours} />);
  const field = (name: string) => view.container.querySelector(`[data-gt-field="${name}"]`) as HTMLSelectElement;
  return { patch, field, container: view.container };
}

describe("GlobalTokensEditor (CUST-HV V5e-2a)", () => {
  it("offers named steps only, with an 'as today' choice on every control", () => {
    const { field, container } = mount();
    const names = [...container.querySelectorAll("[data-gt-field]")].map((el) => el.getAttribute("data-gt-field"));
    expect(names).toEqual([
      "typography.headingScale",
      "typography.bodyScale",
      "typography.headingWeight",
      "typography.bodyWeight",
      "typography.lineHeight",
      "typography.sectionHeading",
      "buttons.style",
      "buttons.colour",
      "buttons.size",
      "buttons.radius",
      "buttons.hover",
      "typography.buttonText.weight",
      "typography.buttonText.case",
      "surfaces.radius",
      "surfaces.border",
      "surfaces.shadow",
      "layout.contentWidth",
      "motion.duration",
      "motion.easing",
    ]);
    for (const name of names) expect(field(name!).value).toBe("");
    // no free-form inputs anywhere
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("choosing a step writes that field into its group; weights are real numbers; border is {width}", () => {
    const { field, patch } = mount({ typography: { headingScale: "lg" } });
    fireEvent.change(field("typography.headingWeight"), { target: { value: "800" } });
    expect(patch).toHaveBeenLastCalledWith({ typography: { headingScale: "lg", headingWeight: 800 } });
    fireEvent.change(field("surfaces.border"), { target: { value: "medium" } });
    expect(patch).toHaveBeenLastCalledWith({ surfaces: { border: { width: "medium" } } });
    fireEvent.change(field("layout.contentWidth"), { target: { value: "wide" } });
    expect(patch).toHaveBeenLastCalledWith({ layout: { contentWidth: "wide" } });
  });

  it("choosing the default removes the field, and an emptied group is removed from the document", () => {
    const { field, patch } = mount({ typography: { headingScale: "lg", lineHeight: "tight" }, motion: { duration: "fast" } });
    fireEvent.change(field("typography.headingScale"), { target: { value: "" } });
    expect(patch).toHaveBeenLastCalledWith({ typography: { lineHeight: "tight" } });
    fireEvent.change(field("motion.duration"), { target: { value: "" } });
    expect(patch).toHaveBeenLastCalledWith({ motion: undefined });
  });

  it("shows the selected values and explains that a card radius overrides the preset", () => {
    const { field } = mount({ surfaces: { radius: "pill", shadow: "soft" }, motion: { easing: "emphasized" } });
    expect(field("surfaces.radius").value).toBe("pill");
    expect(field("surfaces.shadow").value).toBe("soft");
    expect(field("motion.easing").value).toBe("emphasized");
    expect(screen.getByText(tEn("gtRadiusNote"))).toBeTruthy();
  });

  it("reset clears all four groups, and is disabled when nothing is set", () => {
    const off = mount();
    expect((off.container.querySelector("[data-gt-reset]") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const { patch, container } = mount({ layout: { contentWidth: "narrow" } });
    fireEvent.click(container.querySelector("[data-gt-reset]")!);
    expect(patch).toHaveBeenCalledWith({ typography: undefined, surfaces: undefined, layout: undefined, motion: undefined });
  });

  it("every label exists in both Arabic and English", () => {
    for (const t of [tAr, tEn]) {
      const { container } = mount({}, t);
      expect(container.textContent).toContain(t("gtTypography"));
      expect(container.textContent).toContain(t("gtButtons"));
      expect(container.textContent).toContain(t("gtButtonsNote"));
      expect(container.textContent).toContain(t("gtMotionNote"));
      cleanup();
    }
    expect(tAr("gtTitle")).not.toBe(tEn("gtTitle"));
  });

  it("button fields write the buttons group; button text writes the nested typography object", () => {
    const { field, patch } = mount({ typography: { headingScale: "lg" } });
    fireEvent.change(field("buttons.style"), { target: { value: "soft" } });
    expect(patch).toHaveBeenLastCalledWith({ buttons: { style: "soft" } });
    fireEvent.change(field("typography.buttonText.weight"), { target: { value: "800" } });
    expect(patch).toHaveBeenLastCalledWith({ typography: { headingScale: "lg", buttonText: { weight: 800 } } });
    fireEvent.change(field("typography.buttonText.case"), { target: { value: "upper" } });
    expect(patch).toHaveBeenLastCalledWith({ typography: { headingScale: "lg", buttonText: { case: "upper" } } });
  });

  it("clearing the last button text field removes buttonText, and an emptied typography group goes with it", () => {
    const { field, patch } = mount({ typography: { buttonText: { weight: 500 } } });
    fireEvent.change(field("typography.buttonText.weight"), { target: { value: "" } });
    expect(patch).toHaveBeenLastCalledWith({ typography: undefined });
  });

  it("warns — live, in the editor — when an outline/link button colour cannot be proven on the page", () => {
    const pale = mount({ buttons: { style: "outline" } }, tEn, { primaryColor: "#fde68a", accentColor: null });
    expect(pale.container.querySelector("[data-gt-button-contrast]")).not.toBeNull();
    cleanup();
    const solid = mount({ buttons: { style: "solid" } }, tEn, { primaryColor: "#fde68a", accentColor: null });
    expect(solid.container.querySelector("[data-gt-button-contrast]")).toBeNull();
    cleanup();
    const dark = mount({ buttons: { style: "outline" } }, tEn, { primaryColor: "#12372a", accentColor: null });
    expect(dark.container.querySelector("[data-gt-button-contrast]")).toBeNull();
    cleanup();
    // no colour context ⇒ no guess
    expect(mount({ buttons: { style: "outline" } }).container.querySelector("[data-gt-button-contrast]")).toBeNull();
  });
});
