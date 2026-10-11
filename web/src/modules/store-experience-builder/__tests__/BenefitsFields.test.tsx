/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICON_KEYS } from "../presentation/icon-registry";
import { BenefitsFields } from "../ControlPanels";
import { customizerMessage } from "../messages";

afterEach(cleanup);

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

describe("BenefitsFields — icon (CUST-HV V9b)", () => {
  it("offers 'No icon' plus every registry key, named in the editor's language", () => {
    const { container } = render(
      <BenefitsFields items={[{ id: "a", title: "x", body: "" }]} t={t} locale="ar" onChange={() => {}} />,
    );
    const select = container.querySelector("[data-benefit-icon-select]") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", ...ICON_KEYS]);
    expect(select.options[1].textContent).toBe("شاحنة");
  });

  it("choosing an icon stores the key; choosing 'No icon' removes the field (never an empty value)", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <BenefitsFields items={[{ id: "a", title: "x", body: "" }]} t={t} locale="en" onChange={onChange} />,
    );
    const select = () => container.querySelector("[data-benefit-icon-select]") as HTMLSelectElement;
    fireEvent.change(select(), { target: { value: "truck" } });
    expect(onChange).toHaveBeenLastCalledWith([{ id: "a", title: "x", body: "", icon: "truck" }]);
    rerender(
      <BenefitsFields items={[{ id: "a", title: "x", body: "", icon: "truck" }]} t={t} locale="en" onChange={onChange} />,
    );
    expect(select().value).toBe("truck");
    fireEvent.change(select(), { target: { value: "" } });
    const last = onChange.mock.calls.at(-1)?.[0][0];
    expect(last).toEqual({ id: "a", title: "x", body: "" });
    expect("icon" in last).toBe(false);
  });

  it("says where the layout lives", () => {
    const { container } = render(<BenefitsFields items={[]} t={t} locale="en" onChange={() => {}} />);
    expect(container.textContent).toContain(t("benefitsLayoutNote"));
  });
});
