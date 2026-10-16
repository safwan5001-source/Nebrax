/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { presetById } from "../categories-display-presets";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";
import type { CategoryDisplay } from "../presentation/section-design";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(cleanup);

/**
 * AWJ-STORE-CAT-DESIGN-01 — the Canvas draws the categories section with the storefront's own resolver, view and
 * stylesheet when a display is chosen, pinned to the simulated device; without one it is the classic preview, untouched.
 */

const CATEGORIES = [
  { id: "c1", name: "إلكترونيات", imageUrl: "https://api.test/media/c1?signature=x", color: null },
  { id: "c2", name: "المنزل والحديقة والأدوات المنزلية الطويلة جدا جدا", imageUrl: null, color: "#12372a" },
  { id: "c3", name: "أخرى", imageUrl: null, color: null },
];

function configWith(display?: CategoryDisplay): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        { id: "categories", type: "categories", visible: true, ...(display ? { design: { display } } : {}) } as never,
      ],
    },
  };
}

function canvas(
  display: CategoryDisplay | undefined,
  props: Partial<Parameters<typeof StorefrontPreviewCanvas>[0]> = {},
) {
  return render(
    <StorefrontPreviewCanvas
      config={configWith(display)}
      locale="en"
      viewport="desktop"
      homeCategoriesState="ready"
      homeCategories={CATEGORIES}
      {...props}
    />,
  ).container;
}

describe("Canvas: classic preview is untouched without a display", () => {
  it("renders the classic grid tiles and no display view", () => {
    const container = canvas(undefined);
    expect(container.querySelector(".awj-cd")).toBeNull();
    expect(container.querySelector("[data-canvas-category-display]")).toBeNull();
    // The classic tiles: one bordered card per category, names only.
    expect(container.querySelectorAll("#preview-categories ~ ul > li, section[aria-labelledby='preview-categories'] ul > li")).toHaveLength(3);
  });
});

describe("Canvas: a chosen display uses the storefront's own markup", () => {
  for (const layout of ["grid", "horizontal_scroll", "circles", "image_tiles", "compact_list"] as const) {
    it(`${layout}: same view, real category names, no navigation`, () => {
      const container = canvas({ layout });
      const list = container.querySelector("ul.awj-cd");
      expect(list?.getAttribute("data-cd-layout")).toBe(layout);
      expect(container.querySelector("[data-canvas-category-display]")?.getAttribute("data-canvas-category-display")).toBe(layout);
      expect(list?.querySelectorAll("li")).toHaveLength(3);
      // The Canvas never navigates: no anchors inside the preview list.
      expect(list?.querySelector("a")).toBeNull();
      expect(list?.textContent).toContain("إلكترونيات");
      expect(list?.textContent).toContain("أخرى");
    });
  }

  it("pins the simulated device (media queries would read the host window, not the preview width)", () => {
    for (const viewport of ["mobile", "tablet", "desktop"] as const) {
      const container = canvas({ layout: "grid" }, { viewport });
      expect(container.querySelector(".awj-cd")?.getAttribute("data-cd-device")).toBe(viewport);
      cleanup();
    }
  });

  it("draws the merchant's real picture inside the frame and the fallback where there is none", () => {
    const container = canvas({ layout: "grid", image: { fit: "contain", position: "top" } });
    const imgs = container.querySelectorAll(".awj-cd img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toContain("api.test/media/c1");
    expect(imgs[0].getAttribute("alt")).toBe("");
    expect(imgs[0].classList.contains("awj-cd__img")).toBe(true);
    expect(container.querySelectorAll(".awj-cd__fallback")).toHaveLength(2);
    const style = container.querySelector(".awj-cd")?.getAttribute("style");
    expect(style).toContain("--cd-fit: contain");
    expect(style).toContain("--cd-op: center top");
  });

  it("the merchant's colour paints the fallback frame; an invalid one never reaches CSS", () => {
    const container = canvas({ layout: "grid" }, {
      homeCategories: [
        { id: "c1", name: "A", imageUrl: null, color: "#12372a" },
        { id: "c2", name: "B", imageUrl: null, color: "red; background:url(x)" },
      ],
    });
    const frames = container.querySelectorAll<HTMLElement>(".awj-cd__fallback");
    expect(frames[0].style.backgroundColor).toBe("rgb(18, 55, 42)");
    expect(frames[1].style.backgroundColor).toBe("");
    expect(container.innerHTML).not.toContain("url(x)");
  });

  it("is the SAME model the storefront resolves: a preset's variables reach the root", () => {
    const container = canvas(presetById("elegant_cards").display);
    const style = container.querySelector(".awj-cd")?.getAttribute("style") ?? "";
    expect(style).toContain("--cd-radius: 16px");
    expect(style).toContain("--cd-pad: 12px");
    expect(style).toContain("--cd-cols-d: 6");
    expect(style).toContain("--cd-name-size: 14px");
  });

  it("start/end picture positions follow the preview's direction (RTL for Arabic)", () => {
    const display: CategoryDisplay = { layout: "grid", image: { position: "start" } };
    const ar = canvas(display, { locale: "ar" });
    expect(ar.querySelector(".awj-cd")?.getAttribute("style")).toContain("--cd-op: right center");
    cleanup();
    const en = canvas(display, { locale: "en" });
    expect(en.querySelector(".awj-cd")?.getAttribute("style")).toContain("--cd-op: left center");
  });

  it("a hidden name keeps the accessible name on the tile", () => {
    const container = canvas({ layout: "grid", name: { show: false } });
    const tiles = container.querySelectorAll<HTMLElement>(".awj-cd__card");
    expect(Array.from(tiles).map((t) => t.getAttribute("aria-label"))).toEqual([
      CATEGORIES[0].name,
      CATEGORIES[1].name,
      CATEGORIES[2].name,
    ]);
  });
});

describe("Canvas: data states keep their own messages under a display", () => {
  it("loading, error and empty are still the section's own states", () => {
    const display: CategoryDisplay = { layout: "grid" };
    expect(canvas(display, { homeCategoriesState: "loading" }).querySelector(".awj-cd")).toBeNull();
    cleanup();
    expect(canvas(display, { homeCategoriesState: "error" }).querySelector("[data-home-categories-error]")).not.toBeNull();
    cleanup();
    const empty = canvas(display, { homeCategories: [] });
    expect(empty.querySelector("[data-home-categories-empty]")).not.toBeNull();
    expect(empty.querySelector(".awj-cd")).toBeNull();
  });
});
