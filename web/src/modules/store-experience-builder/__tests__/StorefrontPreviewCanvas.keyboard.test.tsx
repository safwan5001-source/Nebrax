/**
 * @vitest-environment jsdom
 *
 * AWJ-ANIMATED-MEDIA — selecting a Canvas section by keyboard must not swallow the keystrokes of the controls INSIDE it
 * (the motion toggle, slider arrows and dots): `preventDefault` on a bubbled Enter / Space would cancel their activation.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

const config = {
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections: [{ id: "b1", type: "benefits", visible: true }] },
} as StorefrontPresentationConfig;

describe("Canvas section keyboard selection", () => {
  afterEach(cleanup);

  it("Enter / Space on the section selects it; the same keys from a control inside it are left alone", () => {
    const onSelect = vi.fn();
    const { container } = render(<StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" selectedSection={null} onSelectSection={onSelect} />);
    const wrapper = container.querySelector<HTMLElement>("[data-preview-section-id='b1']")!;

    for (const key of ["Enter", " "]) {
      expect(fireEvent.keyDown(wrapper, { key })).toBe(false); // default prevented: it is the wrapper's own activation
    }
    expect(onSelect).toHaveBeenCalledTimes(2);
    onSelect.mockClear();

    const inner = document.createElement("button"); // stands for the motion toggle / a slider arrow
    wrapper.appendChild(inner);
    for (const key of ["Enter", " "]) {
      expect(fireEvent.keyDown(inner, { key })).toBe(true); // NOT prevented → the button's own click still fires
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});
