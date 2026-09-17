import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryNav } from "@/components/layout/CategoryNav";

const LABELS: Record<string, string> = {
  allProducts: "All Products",
  categoryNavigation: "Store categories",
  scrollCategoriesBack: "Show previous categories",
  scrollCategoriesForward: "Show more categories",
};

let locale = "en";
let pathname = "/us/en";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => LABELS[key] ?? key,
  useLocale: () => locale,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

const CATEGORIES = [
  { id: "1", name: "Electronics", permalink: "electronics" },
  { id: "2", name: "Home", permalink: "home" },
];

/** jsdom reports zero-sized boxes, so overflow has to be described explicitly. */
function setRailMetrics(
  rail: HTMLElement,
  metrics: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(rail, "scrollWidth", {
    configurable: true,
    value: metrics.scrollWidth,
  });
  Object.defineProperty(rail, "clientWidth", {
    configurable: true,
    value: metrics.clientWidth,
  });
  rail.scrollLeft = metrics.scrollLeft;
}

function getRail(container: HTMLElement) {
  const rail = container.querySelector<HTMLElement>(".store-rail");
  if (!rail) throw new Error("category rail not found");
  return rail;
}

describe("CategoryNav", () => {
  beforeEach(() => {
    locale = "en";
    pathname = "/us/en";
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("links to the categories supplied by the catalogue and nothing else", () => {
    render(<CategoryNav categories={CATEGORIES} basePath="/us/en" />);

    const nav = screen.getByRole("navigation", { name: "Store categories" });
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/us/en/products",
      "/us/en/c/electronics",
      "/us/en/c/home",
    ]);
  });

  it("marks the open category, including a child permalink", () => {
    pathname = "/us/en/c/electronics/phones";
    render(<CategoryNav categories={CATEGORIES} basePath="/us/en" />);

    expect(screen.getByRole("link", { name: "Electronics" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps the paging controls out of the way while everything fits", () => {
    const { container } = render(
      <CategoryNav categories={CATEGORIES} basePath="/us/en" />,
    );
    setRailMetrics(getRail(container), {
      scrollWidth: 400,
      clientWidth: 400,
      scrollLeft: 0,
    });

    expect(
      screen.queryByRole("button", { name: "Show more categories" }),
    ).toBeNull();
  });

  it("pages forward in reading order in RTL", async () => {
    locale = "ar";
    const user = userEvent.setup();
    const { container } = render(
      <CategoryNav categories={CATEGORIES} basePath="/us/en" />,
    );

    const rail = getRail(container);
    const scrollBy = vi.fn();
    rail.scrollBy = scrollBy;
    setRailMetrics(rail, {
      scrollWidth: 1200,
      clientWidth: 600,
      scrollLeft: 0,
    });
    fireEvent.scroll(rail);

    await user.click(
      screen.getByRole("button", { name: "Show more categories" }),
    );

    // Arabic scrolls towards negative scrollLeft, so "forward" must be negative.
    expect(scrollBy).toHaveBeenCalledWith({ left: -480 });
  });
});
