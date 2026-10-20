/**
 * @vitest-environment jsdom
 *
 * FLOWERS-H9c / ADR-21 — the Canvas renders the approved live section-data
 * projection when present and keeps loading/empty/error states honest.
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

  it("productShelf shows authored content and the deliver-today badge while data is loading", () => {
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
    expect(el.querySelector("[aria-hidden=\"true\"]")).not.toBeNull();
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
    expect(el.querySelector("[aria-hidden=\"true\"]")).not.toBeNull();
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
    expect(el.querySelector("[aria-hidden=\"true\"]")).not.toBeNull();
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
    expect(section(container, "p-1").querySelector("[aria-hidden=\"true\"]")).not.toBeNull();
  });

  it("renders server-projected product cards and discovery values instead of a placeholder", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={withSections([
          { id: "shelf-1", type: "productShelf", visible: true, content: { title: "Shelf", deliverToday: false, limit: 2 } },
          { id: "d-1", type: "discovery", visible: true, content: { title: "Shop by", axis: "brand", display: "tiles" } },
        ])}
        locale="en"
        viewport="desktop"
        homeSectionProducts={{ "shelf-1": [{ id: "p1", name: "وردة", nameEn: "Rose", thumbnailUrl: "/rose.jpg", priceAmountMinor: 2500, currency: "SAR", inStock: true }] }}
        homeSectionProductsState={{ "shelf-1": "ready" }}
        homeSectionDiscovery={{ "d-1": { axis: "brand", name: "", nameEn: null, visual: null, options: [{ value: "b1", name: "Brand", nameEn: "Brand", count: 3, visual: null }] } }}
        homeSectionDiscoveryState={{ "d-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    expect(container.querySelector('[data-home-data-section="productShelf"] [data-card]')).not.toBeNull();
    expect(container.querySelector('[data-home-data-section="productShelf"]')?.textContent).toContain("SAR");
    expect(container.querySelector('[data-home-data-section="productShelf"]')?.textContent).toContain("Rose");
    expect(container.querySelector('[data-home-data-section="discovery"]')?.textContent).toContain("Brand");
  });

  it("uses resolved discovery visuals and the published fallback headings", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={withSections([
          { id: "shelf-1", type: "productShelf", visible: true, content: { title: "", deliverToday: false, limit: 2 } },
          { id: "d-1", type: "discovery", visible: true, content: { title: "", axis: "facet", dimension: "occasion", layout: "image-grid", template: "gift-circles" } },
        ])}
        locale="en"
        viewport="desktop"
        homeSectionProducts={{ "shelf-1": [{ id: "p1", name: "Rose", thumbnailUrl: null, priceAmountMinor: 2500, currency: "SAR", inStock: true }] }}
        homeSectionProductsState={{ "shelf-1": "ready" }}
        homeSectionDiscovery={{ "d-1": { axis: "facet", dimension: "occasion", name: "المناسبة", nameEn: "Occasion", visual: { defaults: { content: "image", shape: "circle" } }, options: [{ value: "birthday", name: "عيد ميلاد", nameEn: "Birthday", count: 3, visual: { image: { mediaId: "00000000-0000-4000-8000-000000000001", sources: [{ width: 320, src: "/signed-media-1.jpg" }] } } }] } }}
        homeSectionDiscoveryState={{ "d-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    expect(container.querySelector('[data-home-data-section="discovery"] h2')?.textContent).toContain("Shop by Occasion");
    expect(container.querySelector('[data-home-data-section="discovery"] [data-facet-content="image"]')).not.toBeNull();
    expect(container.querySelector('[data-home-data-section="discovery"] img')?.getAttribute("src")).toBe("/signed-media-1.jpg");
  });

  it("formats the live delivery window and uses the published heading", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={withSections([{ id: "p-1", type: "deliveryPromise", visible: true, content: { title: "", body: "" } }])}
        locale="en"
        viewport="desktop"
        homeSectionDelivery={{ "p-1": { date: "2099-10-08", startTime: "19:00", endTime: "22:00", label: "raw", labelEn: "raw", timezone: "UTC" } }}
        homeSectionDeliveryState={{ "p-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    const text = section(container, "p-1").textContent ?? "";
    expect(text).toContain("Earliest delivery");
    expect(text).not.toContain("2099-10-08");
    expect(text).toContain("7:00");
  });

  it("keeps the AWJ Market automatic shelf as a rail", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={{ ...withSections([{ id: "shelf-1", type: "productShelf", visible: true, content: { title: "", deliverToday: false, limit: 2 } }]), themePreset: "awj-market" }}
        locale="en"
        viewport="desktop"
        homeSectionProducts={{ "shelf-1": [{ id: "p1", name: "Rose", thumbnailUrl: null, priceAmountMinor: 2500, currency: "SAR", inStock: true }] }}
        homeSectionProductsState={{ "shelf-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    expect(container.querySelector('[data-shelf-layout="rail"]')).not.toBeNull();
  });

  it("applies the published discovery display controls to live values", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={withSections([{ id: "d-1", type: "discovery", visible: true, content: { title: "", axis: "brand", display: "tiles", layout: "carousel", rows: 2, gap: "loose", textPosition: "overlay", contentSequence: "label-first", cardStyle: "elevated", align: "start" } }])}
        locale="en"
        viewport="mobile"
        homeSectionDiscovery={{ "d-1": { axis: "brand", name: "", nameEn: null, visual: { defaults: { content: "icon" } }, options: [{ value: "b1", name: "Brand", nameEn: "Brand", count: 3, visual: { icon: "tag" } }] } }}
        homeSectionDiscoveryState={{ "d-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    const list = container.querySelector('[data-home-data-section="discovery"] [data-discovery-layout="carousel"]');
    expect(list?.getAttribute("data-discovery-gap")).toBe("loose");
    expect(list?.getAttribute("data-discovery-rows")).toBe("2");
    expect(list?.getAttribute("data-discovery-text-position")).toBe("overlay");
    expect(list?.getAttribute("data-discovery-content-sequence")).toBe("label-first");
    expect(list?.getAttribute("data-discovery-card-style")).toBe("elevated");
    expect(list?.getAttribute("data-discovery-align")).toBe("start");
    expect((list as HTMLElement | null)?.style.getPropertyValue("--disc-rows")).toBe("2");
  });

  it("keeps text-list columns and the published desktop carousel row rule", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={withSections([{ id: "d-1", type: "discovery", visible: true, content: { title: "", axis: "brand", display: "tiles", layout: "text-list", columns: { desktop: 7 } } }])}
        locale="en"
        viewport="desktop"
        homeSectionDiscovery={{ "d-1": { axis: "brand", name: "", nameEn: null, visual: null, options: [{ value: "b1", name: "Brand", nameEn: null, count: 1, visual: null }] } }}
        homeSectionDiscoveryState={{ "d-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    expect(container.querySelector('[data-discovery-layout="text-list"]')?.className).toContain("grid-cols-7");
  });

  it("uses the four-column Market grid default when grid is explicit", () => {
    const { container } = render(
      <StorefrontPreviewCanvas
        config={{ ...withSections([{ id: "shelf-1", type: "productShelf", visible: true, content: { title: "", deliverToday: false, limit: 2 }, design: { layout: "grid" } }]), themePreset: "awj-market" }}
        locale="en"
        viewport="desktop"
        homeSectionProducts={{ "shelf-1": [{ id: "p1", name: "Rose", thumbnailUrl: null, priceAmountMinor: 2500, currency: "SAR", inStock: true }] }}
        homeSectionProductsState={{ "shelf-1": "ready" }}
        onSelectSection={() => {}}
      />,
    );
    expect(container.querySelector('[data-shelf-layout="grid"]')?.className).toContain("grid-cols-4");
  });
});
