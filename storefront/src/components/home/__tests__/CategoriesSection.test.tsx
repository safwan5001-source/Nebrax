import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function category(overrides: Record<string, unknown>) {
  const base = {
    id: "c1",
    name: "إلكترونيات",
    color: null,
    children: undefined,
    ...overrides,
  };
  // The adapter derives the permalink from the id, so the fixture must too.
  return { ...base, permalink: base.id };
}

async function loadSection(getCategories: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock("next-intl/server", () => ({
    getTranslations: vi.fn(async () => (key: string) => key),
  }));
  vi.doMock("@/lib/data/categories", () => ({ getCategories }));

  const { CategoriesSection } = await import(
    "@/components/home/CategoriesSection"
  );
  return CategoriesSection({ basePath: "/sa/ar", locale: "ar", country: "sa" });
}

describe("CategoriesSection", () => {
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

  it("tints a tile from the merchant's colour and stays neutral without one", async () => {
    const element = await loadSection(
      vi.fn().mockResolvedValue({
        data: [
          category({ color: "#12372a" }),
          category({ id: "c2", name: "المنزل", color: "not-a-colour" }),
        ],
      }),
    );

    const { getAllByRole } = render(element as React.JSX.Element);
    const [tinted, neutral] = getAllByRole("link");
    expect(tinted.getAttribute("style")).toContain("#12372a");
    expect(neutral.getAttribute("style")).toContain("--store-surface-muted");
  });
});
