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

function mount(config: GlobalTokensDoc = {}, t = tEn) {
  const patch = vi.fn();
  const view = render(<GlobalTokensEditor config={config} t={t} patch={patch} />);
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
      expect(container.textContent).toContain(t("gtMotionNote"));
      cleanup();
    }
    expect(tAr("gtTitle")).not.toBe(tEn("gtTitle"));
  });
});
