import type { Category } from "@spree/sdk";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PagePresentation } from "@/lib/presentation/page-regions";

/**
 * CUST-H2-5 — public Category runtime region parity. `CategoryBanner` is an
 * async Server Component under a "use cache: remote" directive (a no-op
 * outside Next's own build-time compiler, same as "use client" at runtime),
 * so it is invoked directly and awaited rather than rendered synchronously —
 * the same pattern `CategoriesSection.test.tsx` already uses for an async
 * Home section.
 */
async function loadBanner(props: {
  category: Category;
  basePath: string;
  locale: string;
  pagePresentation?: PagePresentation;
}) {
  vi.resetModules();
  // "use cache: remote" is a no-op directive outside Next's own build-time
  // compiler; the real `next/cache` exports throw outside a Next request/
  // build context, so this mirrors what Next's compiler would otherwise
  // strip away for a plain component-level test.
  vi.doMock("next/cache", () => ({
    cacheLife: vi.fn(),
    cacheTag: vi.fn(),
  }));
  // `Breadcrumbs` is itself an async Server Component; React's client
  // renderer (what `@testing-library/react` uses under jsdom) cannot render
  // an unresolved async component as a child, so it is mocked here exactly
  // like `ProductDetails.test.tsx` mocks `MediaGallery`/`ProductCustomFields`
  // — this test is about region order/visibility, not Breadcrumbs' own
  // internals, which have no test coverage gap from this substitution.
  vi.doMock("@/components/navigation/Breadcrumbs", () => ({
    Breadcrumbs: () => (
      <nav aria-label="breadcrumbs-mock">breadcrumbs-mock</nav>
    ),
  }));

  const { CategoryBanner } = await import("./CategoryBanner");
  return CategoryBanner(props);
}

function category(overrides: Record<string, unknown> = {}): Category {
  return {
    id: "cat-1",
    name: "Electronics",
    permalink: "electronics",
    description: null,
    color: null,
    image: null,
    children: [],
    ancestors: [],
    ...overrides,
  } as unknown as Category;
}

describe("CategoryBanner — CUST-H2-5 public page presentation parity", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders today's exact default region order when pagePresentation is absent", async () => {
    const element = await loadBanner({
      category: category({
        description: "All things electronic.",
        children: [{ id: "c-2", name: "Phones", permalink: "phones" }],
      }),
      basePath: "/sa/en",
      locale: "en",
    });

    const { container } = render(element as React.JSX.Element);
    const text = container.textContent ?? "";

    const order = [
      "breadcrumbs-mock",
      "Electronics",
      "All things electronic.",
      "Phones",
    ];
    const positions = order.map((needle) => text.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("hides the description when marked not visible, without hiding the title", async () => {
    const pagePresentation: PagePresentation = {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          { id: "description", key: "description", visible: false },
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: true,
          },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };

    const element = await loadBanner({
      category: category({ description: "All things electronic." }),
      basePath: "/sa/en",
      locale: "en",
      pagePresentation,
    });

    render(element as React.JSX.Element);

    expect(screen.getByText("Electronics")).toBeInTheDocument();
    expect(
      screen.queryByText("All things electronic."),
    ).not.toBeInTheDocument();
  });

  it("hides the subcategories rail when marked not visible", async () => {
    const pagePresentation: PagePresentation = {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          { id: "description", key: "description", visible: true },
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: false,
          },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };

    const element = await loadBanner({
      category: category({
        children: [{ id: "c-2", name: "Phones", permalink: "phones" }],
      }),
      basePath: "/sa/en",
      locale: "en",
      pagePresentation,
    });

    render(element as React.JSX.Element);
    expect(screen.queryByText("Phones")).not.toBeInTheDocument();
  });

  it("respects an authored order: subcategories_rail ahead of description", async () => {
    const pagePresentation: PagePresentation = {
      category: {
        version: 1,
        regions: [
          { id: "breadcrumbs", key: "breadcrumbs", visible: true },
          { id: "identity_title", key: "identity_title", visible: true },
          {
            id: "subcategories_rail",
            key: "subcategories_rail",
            visible: true,
          },
          { id: "description", key: "description", visible: true },
          { id: "filter_sort_bar", key: "filter_sort_bar", visible: true },
          { id: "product_grid", key: "product_grid", visible: true },
        ],
      },
    };

    const element = await loadBanner({
      category: category({
        description: "All things electronic.",
        children: [{ id: "c-2", name: "Phones", permalink: "phones" }],
      }),
      basePath: "/sa/en",
      locale: "en",
      pagePresentation,
    });

    const { container } = render(element as React.JSX.Element);
    const text = container.textContent ?? "";
    expect(text.indexOf("Phones")).toBeLessThan(
      text.indexOf("All things electronic."),
    );
  });

  it("never hides breadcrumbs/identity_title, even from a malformed stored array", async () => {
    const malformedPagePresentation = {
      category: {
        version: 1,
        // Only description present — breadcrumbs/identity_title missing.
        regions: [{ id: "description", key: "description", visible: true }],
      },
    } as any as PagePresentation;

    const element = await loadBanner({
      category: category({ description: "All things electronic." }),
      basePath: "/sa/en",
      locale: "en",
      pagePresentation: malformedPagePresentation,
    });

    render(element as React.JSX.Element);
    expect(screen.getByText("Electronics")).toBeInTheDocument();
  });

  it("does not fabricate a description or subcategories rail when the category has none", async () => {
    const element = await loadBanner({
      category: category(),
      basePath: "/sa/en",
      locale: "en",
    });

    const { container } = render(element as React.JSX.Element);
    expect(container.querySelector("nav[aria-label='Electronics']")).toBe(null);
  });
});
