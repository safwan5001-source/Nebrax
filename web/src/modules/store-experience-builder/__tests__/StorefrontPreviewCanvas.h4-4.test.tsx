/**
 * @vitest-environment jsdom
 *
 * CUST-H4-4 — Canvas ↔ Published parity proof for banner (imageAlt),
 * benefits, customContent and appPromo. Twin assertions live on the
 * Published side in storefront/src/components/home/__tests__/*.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function withSections(
  sections: StorefrontPresentationConfig["homepage"]["sections"],
  apps?: Partial<StorefrontPresentationConfig["apps"]>,
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
    apps: { ...DEFAULT_PRESENTATION_CONFIG.apps, ...apps },
  };
}

describe("Canvas — Banner imageAlt (CUST-H4-4)", () => {
  afterEach(() => cleanup());

  it("uses the merchant-authored imageAlt on the preview image", () => {
    const config = withSections([
      {
        id: "banner-1",
        type: "banner",
        visible: true,
        content: {
          title: "عرض الصيف",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "https://example.com/banner.jpg",
          imageAlt: "صورة منتجات الصيف",
        },
      },
    ]);
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const img = container.querySelector(
      '[data-preview-section-id="banner-1"] img',
    ) as HTMLImageElement;
    expect(img.alt).toBe("صورة منتجات الصيف");
  });

  it("stays decorative (empty alt) when no imageAlt is authored — backward compatible", () => {
    const config = withSections([
      {
        id: "banner-1",
        type: "banner",
        visible: true,
        content: {
          title: "عرض الصيف",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "https://example.com/banner.jpg",
        },
      },
    ]);
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const img = container.querySelector(
      '[data-preview-section-id="banner-1"] img',
    ) as HTMLImageElement;
    expect(img.alt).toBe("");
  });
});

describe("Canvas — Benefits (CUST-H4-4 parity proof)", () => {
  afterEach(() => cleanup());

  it("renders every authored item's title and body, same content Published renders", () => {
    const config = withSections([
      {
        id: "benefits-1",
        type: "benefits",
        visible: true,
        content: {
          items: [
            { id: "b1", title: "شحن مجاني", body: "لكل الطلبات فوق 200 ريال" },
            { id: "b2", title: "استرجاع سهل", body: "" },
          ],
        },
      },
    ]);
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const section = container.querySelector(
      '[data-preview-section-id="benefits-1"]',
    ) as HTMLElement;
    expect(section.textContent).toContain("شحن مجاني");
    expect(section.textContent).toContain("لكل الطلبات فوق 200 ريال");
    expect(section.textContent).toContain("استرجاع سهل");
  });
});

describe("Canvas — Benefits icons and layout (CUST-HV V9b)", () => {
  afterEach(() => cleanup());

  const sections = (design?: Record<string, unknown>) =>
    withSections([
      {
        id: "benefits-1",
        type: "benefits",
        visible: true,
        ...(design ? { design } : {}),
        content: {
          items: [
            { id: "b1", title: "Free delivery", body: "", icon: "truck" },
            { id: "b2", title: "Easy returns", body: "" },
          ],
        },
      },
    ] as never);
  const mount = (design?: Record<string, unknown>) =>
    render(
      <StorefrontPreviewCanvas config={sections(design)} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    ).container.querySelector('[data-preview-section-id="benefits-1"]') as HTMLElement;

  it("draws the icon only on the item that has one, decoratively", () => {
    const section = mount();
    const icons = section.querySelectorAll("[data-benefit-icon]");
    expect(icons).toHaveLength(1);
    expect(icons[0].querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(section.querySelectorAll("[data-benefit-item]")[1].querySelector("[data-benefit-icon]")).toBeNull();
  });

  it("absent layout is cards in automatic columns; the layout and the simulated device reach the list's attributes (columns are proven in the browser)", () => {
    const auto = mount();
    const root = auto.querySelector("[data-benefits]") as HTMLElement;
    expect(root.getAttribute("data-benefits")).toBe("auto");
    expect(root.getAttribute("data-vp")).toBe("desktop");
    expect(auto.querySelector("li")?.className).toContain("border-store-border");
    cleanup();
    const four = mount({ layout: "columns-4" });
    expect(four.querySelector("[data-benefits]")?.getAttribute("data-benefits")).toBe("columns-4");
    expect(four.querySelector("li")?.className).toContain("border-store-border");
    cleanup();
    const flat = mount({ layout: "flat" });
    expect(flat.querySelector("[data-benefits]")?.getAttribute("data-benefits")).toBe("flat");
    expect(flat.querySelector("li")?.className).not.toContain("border-store-border");
  });
});

describe("Canvas — Custom Content (CUST-H4-4 parity proof)", () => {
  afterEach(() => cleanup());

  it("renders authored heading/paragraph blocks verbatim, no HTML interpreted", () => {
    const config = withSections([
      {
        id: "cc-1",
        type: "customContent",
        visible: true,
        content: {
          blocks: [
            { id: "h1", kind: "heading", text: "من نحن" },
            { id: "p1", kind: "paragraph", text: "<b>not html</b>" },
          ],
        },
      },
    ]);
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const section = container.querySelector(
      '[data-preview-section-id="cc-1"]',
    ) as HTMLElement;
    expect(section.querySelector("h2")?.textContent).toBe("من نحن");
    // Literal text, not interpreted as markup — no real <b> element exists.
    expect(section.querySelector("b")).toBeNull();
    expect(section.textContent).toContain("<b>not html</b>");
  });
});

describe("Canvas — App Promo (CUST-H4-4 real-config parity proof)", () => {
  afterEach(() => cleanup());

  it("renders both badges when both store URLs are real", () => {
    const config = withSections(
      [{ id: "ap-1", type: "appPromo", visible: true }],
      {
        iosUrl: "https://apps.apple.com/app/id123",
        androidUrl: "https://play.google.com/store/apps/details?id=sa.awj",
      },
    );
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const section = container.querySelector(
      '[data-preview-section-id="ap-1"]',
    ) as HTMLElement;
    expect(section.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
  });

  it("renders only the iOS badge when only the App Store URL is real", () => {
    const config = withSections(
      [{ id: "ap-1", type: "appPromo", visible: true }],
      { iosUrl: "https://apps.apple.com/app/id123", androidUrl: "" },
    );
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const section = container.querySelector(
      '[data-preview-section-id="ap-1"]',
    ) as HTMLElement;
    expect(section.querySelectorAll("img").length).toBe(1);
  });

  it("falls back to the honest placeholder — never a fabricated badge — when neither URL is real", () => {
    const config = withSections(
      [{ id: "ap-1", type: "appPromo", visible: true }],
      { iosUrl: "", androidUrl: "" },
    );
    const { container } = render(
      <StorefrontPreviewCanvas config={config} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const section = container.querySelector(
      '[data-preview-section-id="ap-1"]',
    ) as HTMLElement;
    expect(section.querySelectorAll("img").length).toBe(0);
  });
});

describe("Canvas — text-only custom content keeps the editor's block selection (V9c review)", () => {
  afterEach(() => cleanup());

  it("rings the selected heading / paragraph even though the section has no other block kind", () => {
    const config = withSections([
      {
        id: "cc-1",
        type: "customContent",
        visible: true,
        content: {
          blocks: [
            { id: "b1", kind: "heading", text: "Title" },
            { id: "b2", kind: "paragraph", text: "Body" },
          ],
        },
      },
    ]);
    const { container } = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
        onSelectSection={() => {}}
        activeSlides={{ "cc-1": "b2" }}
      />,
    );
    const marked = container.querySelectorAll("[data-content-block]");
    expect(Array.from(marked).map((n) => n.getAttribute("data-content-block"))).toEqual(["b1", "b2"]);
    expect(container.querySelector('[data-content-block="b2"]')?.hasAttribute("data-selected")).toBe(true);
    expect(container.querySelector('[data-content-block="b1"]')?.hasAttribute("data-selected")).toBe(false);
  });
});

describe("Canvas — text-only sub-headings follow the simulated device (V9c review)", () => {
  afterEach(() => cleanup());

  it("a level-3 heading is sized from the viewport, not from a host media query", () => {
    const config = withSections([
      { id: "cc-1", type: "customContent", visible: true, content: { blocks: [{ id: "b1", kind: "heading", text: "Sub", level: 3 }] } },
    ]);
    const sizeOn = (viewport: "mobile" | "desktop") => {
      const { container, unmount } = render(
        <StorefrontPreviewCanvas config={config} locale="en" viewport={viewport} onSelectSection={() => {}} />,
      );
      const cls = container.querySelector("h3")?.className ?? "";
      unmount();
      return cls;
    };
    expect(sizeOn("mobile")).toContain("text-base");
    expect(sizeOn("desktop")).toContain("text-lg");
    expect(`${sizeOn("mobile")} ${sizeOn("desktop")}`).not.toContain("md:");
  });
});
