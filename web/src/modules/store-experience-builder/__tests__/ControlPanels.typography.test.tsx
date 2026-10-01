/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";

/**
 * CUST-H3-2 — the Typography control is live only because `tajawal-geist`
 * passed implementation-time verification (see
 * `docs/reports/CUST-H3-2-IMPLEMENTATION-REPORT.md`). This covers the
 * merchant-facing contract directly: exactly the two verified presets are
 * offered, selecting one patches only `fontPreset`, and primaryColor stays
 * untouched by an unrelated Typography change.
 */
describe("Store Customizer — Typography control (CUST-H3-2)", () => {
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

  it("selecting Tajawal patches only fontPreset, leaving primaryColor and other fields untouched", async () => {
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
    expect(next.themePreset).toBe(DEFAULT_PRESENTATION_CONFIG.themePreset);
    expect(next.radius).toBe(DEFAULT_PRESENTATION_CONFIG.radius);
  });
});
