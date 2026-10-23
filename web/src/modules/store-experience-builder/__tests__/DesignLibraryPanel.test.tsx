/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignLibraryPanel } from "../DesignLibraryPanel";
import {
  clonePresentationConfig,
  DEFAULT_PRESENTATION_CONFIG,
  type StorefrontPresentationConfig,
} from "../presentation";
import { designLibraryVariant } from "../design-library";

afterEach(cleanup);

function mount(
  config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG),
  locale: "ar" | "en" = "en",
) {
  const onChange = vi.fn();
  const onSelectSection = vi.fn();
  render(
    <DesignLibraryPanel
      config={config}
      locale={locale}
      selectedSection={null}
      onChange={onChange}
      onSelectSection={onSelectSection}
    />,
  );
  return { onChange, onSelectSection };
}

function variant(id: string): HTMLElement {
  return document.querySelector(
    `[data-design-library-variant="${id}"]`,
  ) as HTMLElement;
}

describe("AWJ Store Design Library panel", () => {
  it("lets merchants browse six visual previews in English and Arabic", () => {
    mount();
    expect(screen.getByText("Store Design Library")).toBeTruthy();
    expect(document.querySelectorAll("[data-design-library-variant]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-design-variant-preview]")).toHaveLength(6);
    cleanup();

    mount(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG), "ar");
    expect(screen.getByText("مكتبة تصميم المتجر")).toBeTruthy();
    expect(screen.getByText("بطاقات تحريرية")).toBeTruthy();
  });

  it("renders a distinct, content-rich representation for every existing variant", () => {
    mount();
    const expectedImages: Record<string, number> = {
      "product-editorial": 3,
      "categories-orbit": 4,
      "categories-showcase": 3,
      "banner-split": 1,
      "featured-rail": 3,
      "gallery-story": 3,
    };

    const layouts = new Set<string>();
    for (const [id, imageCount] of Object.entries(expectedImages)) {
      const preview = document.querySelector(
        `[data-design-variant-preview="${id}"]`,
      ) as HTMLElement;
      const layout = preview.querySelector("[data-preview-layout]");
      expect(preview.getAttribute("aria-hidden")).toBe("true");
      expect(layout).toBeTruthy();
      layouts.add(layout?.getAttribute("data-preview-layout") ?? "");
      expect(preview.querySelectorAll("img")).toHaveLength(imageCount);
      preview.querySelectorAll("img").forEach((image) => {
        expect(image.getAttribute("src")).toContain("/store-design-library/");
        expect(image.getAttribute("width")).toBe("320");
        expect(image.getAttribute("height")).toBe("240");
        expect(image.getAttribute("alt")).toBe("");
      });
    }

    expect(layouts.size).toBe(6);
  });

  it("localizes preview content and sets an explicit LTR or RTL direction", () => {
    mount();
    const english = document.querySelector(
      '[data-design-variant-preview="product-editorial"]',
    ) as HTMLElement;
    expect(english.getAttribute("data-preview-direction")).toBe("ltr");
    expect(english.textContent).toContain("Woven carryall");
    expect(english.textContent).toContain("SAR 129");
    cleanup();

    mount(clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG), "ar");
    const arabic = document.querySelector(
      '[data-design-variant-preview="product-editorial"]',
    ) as HTMLElement;
    expect(arabic.getAttribute("data-preview-direction")).toBe("rtl");
    expect(arabic.textContent).toContain("حقيبة منسوجة");
    expect(arabic.textContent).toContain("129 ر.س");
  });

  it("applies a product-card variant without touching commerce or page content", () => {
    const config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
    const { onChange } = mount(config);
    fireEvent.click(
      within(variant("product-editorial")).getByRole("button", {
        name: "Apply variant",
      }),
    );

    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    expect(next.cards).toEqual({
      align: "center",
      imageRatio: "3:4",
      imageFit: "cover",
      hover: "lift",
    });
    expect(next.homepage).toBe(config.homepage);
    expect(next.contact).toBe(config.contact);
  });

  it("applies a category variant to the existing section instead of duplicating it", () => {
    const config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
    const beforeCount = config.homepage.sections.length;
    const { onChange, onSelectSection } = mount(config);
    fireEvent.click(
      within(variant("categories-showcase")).getByRole("button", {
        name: "Apply variant",
      }),
    );

    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    const category = next.homepage.sections.find(
      (section) => section.type === "categories",
    );
    const expected = designLibraryVariant("categories-showcase");
    expect(expected?.scope).toBe("section");
    expect(next.homepage.sections).toHaveLength(beforeCount);
    expect(category?.design).toEqual(
      expected?.scope === "section" ? expected.design : undefined,
    );
    expect(onSelectSection).toHaveBeenCalledWith(category?.id);
  });

  it("preserves an existing hidden section's visibility when applying a variant", () => {
    const config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
    const category = config.homepage.sections.find(
      (section) => section.type === "categories",
    );
    expect(category).toBeTruthy();
    if (category) category.visible = false;

    const expected = designLibraryVariant("categories-showcase");
    const { onChange } = mount(config);
    fireEvent.click(
      within(variant("categories-showcase")).getByRole("button", {
        name: "Apply variant",
      }),
    );

    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    const updated = next.homepage.sections.find(
      (section) => section.id === category?.id,
    );
    expect(updated?.visible).toBe(false);
    expect(updated?.design).toEqual(
      expected?.scope === "section" ? expected.design : undefined,
    );
  });

  it("adds a missing gallery as a normal homepage section for existing reorder controls", () => {
    const config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
    expect(config.homepage.sections.some((section) => section.type === "gallery")).toBe(false);
    const { onChange, onSelectSection } = mount(config);
    fireEvent.click(
      within(variant("gallery-story")).getByRole("button", {
        name: "Add section",
      }),
    );

    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    const gallery = next.homepage.sections.at(-1);
    const expected = designLibraryVariant("gallery-story");
    expect(expected?.scope).toBe("section");
    expect(gallery).toMatchObject({ type: "gallery", visible: true });
    expect(gallery?.design).toEqual(
      expected?.scope === "section" ? expected.design : undefined,
    );
    expect(onSelectSection).toHaveBeenCalledWith(gallery?.id);
  });

  it("can add another instance of a repeatable component without replacing the existing one", () => {
    const config = clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
    const existing = config.homepage.sections.filter(
      (section) => section.type === "banner",
    );
    const { onChange } = mount(config);
    fireEvent.click(
      within(variant("banner-split")).getByRole("button", {
        name: "Add another",
      }),
    );

    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    const banners = next.homepage.sections.filter(
      (section) => section.type === "banner",
    );
    expect(banners).toHaveLength(existing.length + 1);
    expect(banners.at(-1)).toMatchObject({ visible: true });
    const expected = designLibraryVariant("banner-split");
    expect(banners.at(-1)?.design).toEqual(
      expected?.scope === "section" ? expected.design : undefined,
    );
  });

  it("offers the legacy original after a variant is applied", () => {
    const config: StorefrontPresentationConfig = {
      ...clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG),
      cards: {
        align: "center",
        imageRatio: "3:4",
        imageFit: "cover",
        hover: "lift",
      },
    };
    const { onChange } = mount(config);
    fireEvent.click(
      within(variant("product-editorial")).getByRole("button", {
        name: "Original design",
      }),
    );

    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    expect(next.productCard).toBe("standard");
    expect(next.cards).toBeUndefined();
  });

  it("filters variants by category and search without hiding them from assistive names", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Categories" }));
    expect(document.querySelectorAll("[data-design-library-variant]")).toHaveLength(2);
    expect(variant("categories-orbit")).toBeTruthy();
    expect(document.querySelector('[data-design-library-variant="product-editorial"]')).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nothing matches this" },
    });
    expect(screen.getByText("No variants match your search.")).toBeTruthy();
  });
});
