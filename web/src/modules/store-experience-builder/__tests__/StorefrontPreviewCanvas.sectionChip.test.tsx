/**
 * @vitest-environment jsdom
 *
 * CUST-HV V10c (V0 §17.1) — the merchant's own name for a section appears on the Canvas as a selection chip: only on the
 * selected section, as inert editor chrome (plain text, not announced, never the section's own markup).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

const config = (labelA?: string, labelB?: string): StorefrontPresentationConfig =>
  ({
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        { id: "b1", type: "benefits", visible: true, ...(labelA ? { label: labelA } : {}) },
        { id: "b2", type: "benefits", visible: true, ...(labelB ? { label: labelB } : {}) },
      ],
    },
  }) as StorefrontPresentationConfig;

function mount(cfg: StorefrontPresentationConfig, selected: string | null) {
  return render(
    <StorefrontPreviewCanvas
      config={cfg}
      locale="en"
      viewport="desktop"
      selectedSection={selected}
      onSelectSection={() => {}}
    />,
  );
}

describe("Canvas selection chip (section name)", () => {
  afterEach(cleanup);

  it("shows the name on the selected section only — two sections of one type stay distinguishable", () => {
    const { container } = mount(config("Eid perks", "Trade perks"), "b2");
    const chips = container.querySelectorAll("[data-section-chip]");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("Trade perks");
    expect(chips[0].closest("[data-preview-section-id]")?.getAttribute("data-preview-section-id")).toBe("b2");
  });

  it("is inert editor chrome: hidden from assistive tech, and the unselected and unnamed cases carry none", () => {
    const { container, rerender } = mount(config("Eid perks"), "b1");
    expect(container.querySelector("[data-section-chip]")?.getAttribute("aria-hidden")).toBe("true");

    rerender(
      <StorefrontPreviewCanvas config={config("Eid perks")} locale="en" viewport="desktop" selectedSection="b2" onSelectSection={() => {}} />,
    );
    expect(container.querySelector("[data-section-chip]")).toBeNull();

    rerender(
      <StorefrontPreviewCanvas config={config()} locale="en" viewport="desktop" selectedSection="b1" onSelectSection={() => {}} />,
    );
    expect(container.querySelector("[data-section-chip]")).toBeNull();
  });

  it("renders the name as text, never as markup", () => {
    const { container } = mount(config('<img src=x onerror=alert(1)>'), "b1");
    expect(container.querySelector("[data-section-chip] img")).toBeNull();
    expect(container.querySelector("[data-section-chip]")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("is never part of the storefront section itself (the frame's markup is unchanged)", () => {
    const { container } = mount(config("Eid perks"), "b1");
    expect(container.querySelector("[data-sd] [data-section-chip]")).toBeNull();
  });

  // CUST-HV V10d review (CI visual QA): a positioned section wrapper re-anchors absolutely positioned content inside the section, so
  // only a section that carries the action bar becomes positioned — everything else keeps the box it had.
  it("only a section that carries the action bar becomes positioned (the wrapper is untouched everywhere else)", () => {
    const labels = { toolbar: "t", moveUp: "u", moveDown: "d", duplicate: "c", hide: "h", remove: "r", confirmRemove: "y", cancel: "n" };
    const actions = { onMove() {}, onDuplicate() {}, onHide() {}, onDelete() {}, labels };

    const plain = mount(config(), null);
    expect(plain.container.querySelectorAll("[data-preview-section-id]").length).toBeGreaterThan(0);
    expect(plain.container.querySelector(".awj-preview-section-actionable")).toBeNull();
    plain.unmount();

    const { container } = render(
      <StorefrontPreviewCanvas
        config={config()}
        locale="en"
        viewport="desktop"
        selectedSection={null}
        onSelectSection={() => {}}
        sectionActions={actions}
      />,
    );
    const wrappers = container.querySelectorAll("[data-preview-section-id]");
    expect(wrappers.length).toBeGreaterThan(0);
    for (const wrapper of wrappers) expect(wrapper.classList.contains("awj-preview-section-actionable")).toBe(true);
  });
});
