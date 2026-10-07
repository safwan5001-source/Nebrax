/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";

afterEach(cleanup);

describe("section design survives builder operations (CUST-HV V5b)", () => {
  it("Duplicate section copies the visual design (deeply), not just type/visible/content", () => {
    const design = { background: { kind: "solid" as const, color: { role: "surfaceAlt" as const } }, spacing: { top: "lg" as const }, radius: "md" as const };
    const config: StorefrontPresentationConfig = {
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: {
        ...DEFAULT_PRESENTATION_CONFIG.homepage,
        sections: [{ id: "b1", type: "banner", visible: true, design }],
      },
    };
    const onChange = vi.fn();
    render(
      <ControlPanels panel="homepage" config={config} locale="en" liveStoreName={null} onChange={onChange} selectedSection="b1" />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Duplicate section" })[0]);
    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    expect(next.homepage.sections).toHaveLength(2);
    const [original, copy] = next.homepage.sections;
    expect(copy.id).not.toBe(original.id);
    expect(copy.design).toEqual(design);
    expect(copy.design).not.toBe(original.design); // a clone: editing one never edits the other
  });
});
