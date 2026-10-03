/**
 * @vitest-environment jsdom
 *
 * CUST-H4-5 — Canvas rendering of the real "featured" section. The fetch
 * itself is owned by `ExperienceBuilder` (see `ExperienceBuilder.featured.test.tsx`);
 * this covers the presentational contract: loading/empty/error states,
 * real name/image rendering, stored-order restoration, and that a missing
 * selected id is omitted without a placeholder.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function withSections(
  sections: StorefrontPresentationConfig["homepage"]["sections"],
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
  };
}

function featuredSectionConfig(productIds: string[]) {
  return withSections([
    { id: "featured-1", type: "featured", visible: true, content: { productIds } },
  ]);
}

function section() {
  return document.querySelector('section[aria-labelledby="preview-featured-featured-1"]');
}

describe("Canvas — Featured real product data (CUST-H4-5)", () => {
  afterEach(() => cleanup());

  it("renders nothing by way of the removed bare-id-chip list — real name/image instead", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolved={{ "featured-1": [{ id: "p1", name: "منتج حقيقي", thumbnailUrl: "https://cdn.example.test/p1.jpg" }] }}
        featuredResolvedState={{ "featured-1": "ready" }}
      />,
    );
    expect(section()?.textContent).toContain("منتج حقيقي");
    expect(section()?.textContent ?? "").not.toContain("p1");
    const img = section()?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.test/p1.jpg");
  });

  it("shows a loading skeleton while idle/loading, never the bare id text", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolvedState={{ "featured-1": "loading" }}
      />,
    );
    expect(section()?.querySelector(".animate-pulse")).not.toBeNull();
    expect(section()?.textContent ?? "").not.toContain("p1");
  });

  it("renders an honest empty state when no products are selected", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig([])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
      />,
    );
    expect(document.querySelector("[data-home-featured-empty]")).not.toBeNull();
  });

  it("shows a retry affordance on error, never fake content", () => {
    const onRetry = vi.fn();
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolvedState={{ "featured-1": "error" }}
        onRetryFeatured={onRetry}
      />,
    );
    const errorBox = document.querySelector("[data-home-featured-error]");
    expect(errorBox).not.toBeNull();
    (errorBox?.querySelector("button") as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledWith("featured-1");
  });

  it("restores the merchant-stored productIds order regardless of the resolved array's own order", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1", "p2", "p3"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolved={{
          "featured-1": [
            { id: "p3", name: "ثالث", thumbnailUrl: null },
            { id: "p1", name: "أول", thumbnailUrl: null },
            { id: "p2", name: "ثانٍ", thumbnailUrl: null },
          ],
        }}
        featuredResolvedState={{ "featured-1": "ready" }}
      />,
    );
    const names = Array.from(section()?.querySelectorAll("li p") ?? []).map((el) => el.textContent);
    expect(names).toEqual(["أول", "ثانٍ", "ثالث"]);
  });

  it("omits a selected id missing from the resolved array, without a placeholder", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1", "p2"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolved={{ "featured-1": [{ id: "p1", name: "موجود", thumbnailUrl: null }] }}
        featuredResolvedState={{ "featured-1": "ready" }}
      />,
    );
    expect(section()?.querySelectorAll("li")).toHaveLength(1);
    expect(section()?.textContent).toContain("موجود");
  });

  it("resolves two Featured section instances independently", () => {
    render(
      <StorefrontPreviewCanvas
        config={withSections([
          { id: "featured-1", type: "featured", visible: true, content: { productIds: ["p1"] } },
          { id: "featured-2", type: "featured", visible: true, content: { productIds: ["p9"] } },
        ])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolved={{
          "featured-1": [{ id: "p1", name: "الأول", thumbnailUrl: null }],
          "featured-2": [{ id: "p9", name: "التاسع", thumbnailUrl: null }],
        }}
        featuredResolvedState={{ "featured-1": "ready", "featured-2": "ready" }}
      />,
    );
    const sections = document.querySelectorAll('section[aria-labelledby^="preview-featured-"]');
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain("الأول");
    expect(sections[1].textContent).toContain("التاسع");
  });

  it("uses an honest fallback (no invented image) for a product with no thumbnail", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
        featuredResolved={{ "featured-1": [{ id: "p1", name: "بلا صورة", thumbnailUrl: null }] }}
        featuredResolvedState={{ "featured-1": "ready" }}
      />,
    );
    expect(section()?.querySelector("img")).toBeNull();
    expect(section()?.textContent).toContain("بلا صورة");
  });

  it("gives the heading a real aria-labelledby landmark, unique per section instance", () => {
    render(
      <StorefrontPreviewCanvas
        config={featuredSectionConfig(["p1"])}
        locale="ar"
        viewport="desktop"
        onSelectSection={() => {}}
      />,
    );
    const heading = document.getElementById("preview-featured-featured-1");
    expect(heading?.tagName).toBe("H2");
    expect(section()?.getAttribute("aria-labelledby")).toBe("preview-featured-featured-1");
  });
});
