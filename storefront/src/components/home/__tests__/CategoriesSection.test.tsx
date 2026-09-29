import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function category(overrides: Record<string, unknown>) {
  const base = {
    id: "c1",
    name: "إلكترونيات",
    color: null,
    image: null,
    children: undefined,
    ...overrides,
  };
  // The adapter derives the permalink from the id, so the fixture must too.
  return { ...base, permalink: base.id };
}

async function loadSection(
  getCategories: ReturnType<typeof vi.fn>,
  themePreset?: "awj-market",
) {
  vi.resetModules();
  vi.doMock("next-intl/server", () => ({
    getTranslations: vi.fn(async () => (key: string) => key),
  }));
  vi.doMock("@/lib/data/categories", () => ({ getCategories }));

  const { CategoriesSection } = await import(
    "@/components/home/CategoriesSection"
  );
  return CategoriesSection({
    basePath: "/sa/ar",
    locale: "ar",
    country: "sa",
    themePreset,
  });
}

describe("CategoriesSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("links every tile to the authoritative category route", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({
        data: [category({}), category({ id: "c2", name: "المنزل" })],
      }),
    );

    const { getAllByRole } = render(element as React.JSX.Element);
    expect(getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/sa/ar/c/c1",
      "/sa/ar/c/c2",
    ]);
  });

  it("renders nothing when the catalogue has no categories", async () => {
    expect(
      await loadSection(vi.fn().mockResolvedValue({ data: [] })),
    ).toBeNull();
  });

  it("renders nothing when the category request fails", async () => {
    expect(
      await loadSection(vi.fn().mockRejectedValue(new Error("down"))),
    ).toBeNull();
  });

  it("caps a long catalogue and offers the full list instead", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({
        data: Array.from({ length: 20 }, (_, i) =>
          category({ id: `c${i}`, name: `قسم ${i}` }),
        ),
      }),
    );

    const { getAllByRole } = render(element as React.JSX.Element);
    const links = getAllByRole("link").map((a) => a.getAttribute("href"));
    // 12 tiles plus the catch-all into the catalogue.
    expect(links).toHaveLength(13);
    expect(links).toContain("/sa/ar/products");
  });

  it("omits the catch-all when every category already fits", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({ data: [category({})] }),
    );

    const { getAllByRole } = render(element as React.JSX.Element);
    expect(getAllByRole("link")).toHaveLength(1);
  });

  it("only counts subcategories the catalogue actually returned", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({
        data: [
          category({ children: [{ id: "a" }, { id: "b" }] }),
          category({ id: "c2", name: "المنزل" }),
        ],
      }),
    );

    const { container } = render(element as React.JSX.Element);
    expect(container.textContent).toContain("subcategories");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("accents a tile with the merchant's colour and stays neutral without one", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({
        data: [
          category({ color: "#12372a" }),
          category({ id: "c2", name: "المنزل", color: "not-a-colour" }),
        ],
      }),
    );

    const { getAllByRole } = render(element as React.JSX.Element);
    const [accented, neutral] = getAllByRole("link");
    // jsdom normalises the literal to rgb() on the way into the attribute.
    expect(accented.getAttribute("style")).toContain("rgb(18, 55, 42)");
    expect(neutral.getAttribute("style")).toContain("--store-border-strong");
    expect(accented.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(neutral.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("uses the authoritative category image before color and keeps accessible text", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({
        data: [
          category({
            color: "#12372a",
            image: { url: "/store/v1/media/categories/c1", alt: "هواتف" },
          }),
        ],
      }),
    );

    const { getByRole } = render(element as React.JSX.Element);
    const link = getByRole("link");
    expect(link.querySelector("img")).toHaveAttribute(
      "src",
      "/store/v1/media/categories/c1",
    );
    expect(link.querySelector("img")).toHaveAttribute("alt", "هواتف");
    expect(link.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(link.textContent).toContain("إلكترونيات");
  });

  describe("AWJ Market density", () => {
    it("raises the tile ceiling above the default AWJ Modern limit", async () => {
      const element = await loadSection(
        vi.fn().mockResolvedValue({
          data: Array.from({ length: 20 }, (_, i) =>
            category({ id: `c${i}`, name: `قسم ${i}` }),
          ),
        }),
        "awj-market",
      );

      const { getAllByRole } = render(element as React.JSX.Element);
      const links = getAllByRole("link").map((a) => a.getAttribute("href"));
      // 18 tiles plus the catch-all into the catalogue.
      expect(links).toHaveLength(19);
      expect(links).toContain("/sa/ar/products");
    });

    it("does not raise the ceiling for AWJ Modern (no theme regression)", async () => {
      const element = await loadSection(
        vi.fn().mockResolvedValue({
          data: Array.from({ length: 20 }, (_, i) =>
            category({ id: `c${i}`, name: `قسم ${i}` }),
          ),
        }),
      );

      const { getAllByRole } = render(element as React.JSX.Element);
      // Unchanged from the pre-Market behaviour asserted above: 12 + catch-all.
      expect(getAllByRole("link")).toHaveLength(13);
    });

    it("denser grid columns and tighter tile padding than AWJ Modern", async () => {
      // More than two categories: the short-list branch (`shown.length <= 2`)
      // keeps a fixed, theme-independent grid regardless of preset, so this
      // needs enough tiles to reach the theme-aware branch either theme uses.
      const data = [
        category({}),
        category({ id: "c2", name: "المنزل" }),
        category({ id: "c3", name: "أخرى" }),
      ];
      const marketEl = await loadSection(
        vi.fn().mockResolvedValue({ data }),
        "awj-market",
      );
      const modernEl = await loadSection(vi.fn().mockResolvedValue({ data }));

      const market = render(marketEl as React.JSX.Element);
      const grid = market.container.querySelector("ul");
      expect(grid?.className).toContain("grid-cols-3");
      expect(grid?.className).toContain("gap-2");
      const tile = market.getAllByRole("link")[0];
      expect(tile.className).toContain("px-3");
      market.unmount();

      const modern = render(modernEl as React.JSX.Element);
      const modernTile = modern.getAllByRole("link")[0];
      expect(modernTile.className).toContain("px-4");
    });
  });
});
