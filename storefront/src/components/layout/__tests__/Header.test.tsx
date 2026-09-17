import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ namespace }: { namespace: string }) => {
    const labels: Record<string, Record<string, string>> = {
      header: {
        account: "Account",
        cart: "Cart",
        openCart: "Open cart",
        skipToContent: "Skip to content",
        submitSearch: "Search",
        wholesale: "Wholesale",
      },
      footer: { shop: "Shop" },
    };
    return (key: string) => labels[namespace]?.[key] ?? key;
  },
}));

vi.mock("@/lib/spree", () => ({ isWholesaleEnabled: () => false }));

vi.mock("@/components/layout/StoreSearch", () => ({
  StoreSearch: () => <div data-testid="store-search" />,
}));

vi.mock("@/components/layout/CartButton", () => ({
  CartButton: ({ variant }: { variant?: string }) => (
    <button type="button">{`cart-${variant ?? "icon"}`}</button>
  ),
}));

vi.mock("@/components/layout/RegionPreferences", () => ({
  RegionPreferences: () => <div data-testid="region" />,
}));

vi.mock("@/components/layout/MobileMenu", () => ({ MobileMenu: () => null }));

import { Header } from "@/components/layout/Header";

async function renderHeader() {
  const markup = await Header({
    basePath: "/us/en",
    locale: "en" as Locale,
    mobileNavigation: <div data-testid="mobile-nav" />,
    categoryNavigation: <div data-testid="category-nav" />,
    storeName: "متجر الاختبار",
  });
  render(markup);
}

describe("Header", () => {
  it("mounts exactly one search field across both of its placements", async () => {
    await renderHeader();

    // Two instances would each own a query, so crossing the md breakpoint
    // mid-search would swap the shopper onto a blank field.
    expect(screen.getAllByTestId("store-search")).toHaveLength(1);
  });

  it("points the skip link at the main landmark", async () => {
    await renderHeader();

    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#main-content");
  });

  it("keeps the store name in its own bidi isolate", async () => {
    await renderHeader();

    const brand = screen.getAllByRole("link", { name: /متجر الاختبار/ })[0];
    expect(brand.querySelector("bdi")).not.toBeNull();
  });
});
