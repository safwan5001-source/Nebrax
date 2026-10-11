/**
 * @vitest-environment jsdom
 *
 * CUST-HV V9d-3 — shelf title override / hide: the Canvas renders the section's own title (or hides it visually while keeping it as the
 * accessible name), and the editor writes only `title` / `showTitle: false` — never ids it did not own.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

type Sections = StorefrontPresentationConfig["homepage"]["sections"];

function withSections(sections: Sections): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
  };
}

function canvas(sections: Sections) {
  return render(
    <StorefrontPreviewCanvas
      config={withSections(sections)}
      locale="en"
      viewport="desktop"
      onSelectSection={() => {}}
      homeNewArrivalsState="ready"
      featuredResolvedState={{ "f-1": "ready" }}
      offersState="ready"
    />,
  );
}

function arrivalsHeading() {
  return document.querySelector<HTMLElement>("[data-section-heading] h2");
}

function heading(id: string) {
  return document.getElementById(id);
}

describe("Canvas — shelf titles (V9d-3)", () => {
  afterEach(() => cleanup());

  it("new arrivals: default title, own title, hidden title", () => {
    canvas([{ id: "na-1", type: "newArrivals", visible: true }]);
    expect(arrivalsHeading()?.textContent).toBe("New arrivals");
    expect(arrivalsHeading()?.className).not.toContain("sr-only");
    cleanup();

    canvas([{ id: "na-1", type: "newArrivals", visible: true, content: { title: "Fresh drops" } }]);
    expect(arrivalsHeading()?.textContent).toBe("Fresh drops");
    cleanup();

    canvas([{ id: "na-1", type: "newArrivals", visible: true, content: { showTitle: false } }]);
    const h = arrivalsHeading();
    expect(h?.className).toContain("sr-only");
    expect(h?.textContent).toBe("New arrivals");
    expect(document.querySelector("[data-section-heading][data-title-hidden]")).not.toBeNull();
    expect(document.querySelector("[data-heading-bar]")).toBeNull();
  });

  it("featured and offers keep the heading as the section's accessible name while hidden", () => {
    canvas([
      { id: "f-1", type: "featured", visible: true, content: { productIds: [], title: "Picks", showTitle: false } },
      { id: "o-1", type: "offers", visible: true, content: { offerIds: [], showTitle: false } },
    ]);
    const featured = heading("preview-featured-f-1");
    expect(featured?.className).toContain("sr-only");
    expect(featured?.textContent).toBe("Picks");
    expect(heading("preview-offers-o-1")?.className).toContain("sr-only");
    expect(document.querySelector('section[aria-labelledby="preview-offers-o-1"]')).not.toBeNull();
  });
});

describe("Editor — shelf title fields (V9d-3)", () => {
  afterEach(() => cleanup());

  function panel(section: Sections[number], onChange: (c: StorefrontPresentationConfig) => void) {
    return render(
      <ControlPanels
        panel="homepage"
        config={withSections([section])}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
        selectedSection={section.id}
      />,
    );
  }

  it("new arrivals: typing writes a title; the toggle writes showTitle:false; clearing both removes the content", () => {
    const onChange = vi.fn();
    panel({ id: "na-1", type: "newArrivals", visible: true }, onChange);
    const input = document.querySelector<HTMLInputElement>("[data-shelf-title]")!;
    fireEvent.change(input, { target: { value: "Fresh drops" } });
    expect(onChange.mock.calls.at(-1)![0].homepage.sections[0].content).toEqual({ title: "Fresh drops" });

    fireEvent.click(screen.getByLabelText("Show title"));
    expect(onChange.mock.calls.at(-1)![0].homepage.sections[0].content).toEqual({ showTitle: false });
  });

  it("new arrivals: with nothing authored the section carries no content", () => {
    const onChange = vi.fn();
    panel({ id: "na-1", type: "newArrivals", visible: true, content: { title: "x" } }, onChange);
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-shelf-title]")!, { target: { value: "" } });
    expect(onChange.mock.calls.at(-1)![0].homepage.sections[0].content).toBeUndefined();
  });

  it("featured: the title edit keeps the picked ids", () => {
    const onChange = vi.fn();
    panel({ id: "f-1", type: "featured", visible: true, content: { productIds: ["p1", "p2"] } }, onChange);
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-shelf-title]")!, { target: { value: "Picks" } });
    expect(onChange.mock.calls.at(-1)![0].homepage.sections[0].content).toEqual({
      productIds: ["p1", "p2"],
      title: "Picks",
    });
  });

  it("offers: hiding the title keeps the offer ids and shows the accessible-name note", () => {
    const onChange = vi.fn();
    panel({ id: "o-1", type: "offers", visible: true, content: { offerIds: ["a"] } }, onChange);
    fireEvent.click(screen.getByLabelText("Show title"));
    expect(onChange.mock.calls.at(-1)![0].homepage.sections[0].content).toEqual({ offerIds: ["a"], showTitle: false });
  });
});
