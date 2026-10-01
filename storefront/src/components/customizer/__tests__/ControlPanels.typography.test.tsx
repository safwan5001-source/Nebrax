/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import { ControlPanels } from "../ControlPanels";

/**
 * CUST-H3-2 — storefront trust-visual mirror of the merchant Typography
 * control. Same contract as the web Customizer's own
 * `ControlPanels.typography.test.tsx`: exactly the two verified presets,
 * enabled, and selecting one patches only `fontPreset`.
 */
describe("Storefront customizer mirror — Typography control (CUST-H3-2)", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers Cairo + Geist and Tajawal + Geist, enabled, not a disabled single choice", () => {
    render(
      <ControlPanels
        panel="theme"
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        liveStoreName={null}
        onChange={() => {}}
      />,
    );

    const select = screen.getByLabelText("Typography") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Cairo + Geist", "Tajawal + Geist"]);
  });

  it("selecting Tajawal patches only fontPreset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="theme"
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
      />,
    );

    const select = screen.getByLabelText("Typography") as HTMLSelectElement;
    await user.selectOptions(select, "tajawal-geist");

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.fontPreset).toBe("tajawal-geist");
    expect(next.primaryColor).toBe(DEFAULT_PRESENTATION_CONFIG.primaryColor);
  });
});
