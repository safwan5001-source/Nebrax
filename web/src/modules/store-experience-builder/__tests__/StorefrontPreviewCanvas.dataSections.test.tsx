/**
 * @vitest-environment jsdom
 *
 * FLOWERS-H9c / ADR-21 — the Canvas never fabricates data for the data-backed
 * sections: it shows only the merchant-authored title and an honest "live
 * data appears here" note, and flags a section the storefront would omit.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function withSections(
  sections: unknown[],
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections: sections as never },
  };
}

function renderCanvas(config: StorefrontPresentationConfig, locale: "ar" | "en" = "en") {
  return render(
    <StorefrontPreviewCanvas config={config} locale={locale} viewport="desktop" onSelectSection={() => {}} />,
  );
}

function section(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-preview-section-id="${id}"] [data-home-data-section]`);
  if (!el) throw new Error(`data section ${id} not rendered`);
  return el as HTMLElement;
}

describe("Canvas — data-backed sections (ADR-21)", () => {
  afterEach(() => cleanup());

  it("productShelf shows the authored title, the deliver-today badge and a live-data note — no products", () => {
    const { container } = renderCanvas(
      withSections([
        {
          id: "shelf-1",
          type: "productShelf",
          visible: true,
          content: { title: "Roses for today", source: { kind: "collection", slug: "roses" }, deliverToday: true, limit: 8 },
        },
      ]),
    );
    const el = section(container, "shelf-1");
    expect(el.textContent).toContain("Roses for today");
    expect(el.textContent).toContain("Deliver today");
    expect(el.textContent).toContain("Live store products appear here");
    expect(el.hasAttribute("data-incomplete")).toBe(false);
    expect(el.querySelector("img")).toBeNull();
  });

  it("falls back to the localized section name when no title is authored", () => {
    const { container } = renderCanvas(
      withSections([
        { id: "d-1", type: "discovery", visible: true, content: { title: "", axis: "brand", display: "tiles" } },
      ]),
    );
    const el = section(container, "d-1");
    expect(el.querySelector("h2")?.textContent?.length).toBeGreaterThan(0);
    expect(el.textContent).toContain("Live catalog values appear here");
  });

  it("flags a productShelf or discovery section with no stored content as incomplete", () => {
    const { container } = renderCanvas(
      withSections([
        { id: "shelf-1", type: "productShelf", visible: true },
        { id: "d-1", type: "discovery", visible: true },
      ]),
    );
    for (const id of ["shelf-1", "d-1"]) {
      const el = section(container, id);
      expect(el.hasAttribute("data-incomplete")).toBe(true);
      expect(el.textContent).toContain("Incomplete — this section will not appear in the store");
    }
  });

  it("deliveryPromise never claims incompleteness (the date is computed live) and shows no date", () => {
    const { container } = renderCanvas(
      withSections([{ id: "p-1", type: "deliveryPromise", visible: true }]),
    );
    const el = section(container, "p-1");
    expect(el.hasAttribute("data-incomplete")).toBe(false);
    expect(el.textContent).toContain("The earliest delivery window appears here, live");
    expect(el.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("hidden data sections are not rendered", () => {
    const { container } = renderCanvas(
      withSections([{ id: "p-1", type: "deliveryPromise", visible: false }]),
    );
    expect(container.querySelector("[data-home-data-section]")).toBeNull();
  });

  it("renders in Arabic too", () => {
    const { container } = renderCanvas(
      withSections([{ id: "p-1", type: "deliveryPromise", visible: true }]),
      "ar",
    );
    expect(section(container, "p-1").textContent).toContain("أقرب موعد توصيل يظهر هنا حيّاً");
  });
});
