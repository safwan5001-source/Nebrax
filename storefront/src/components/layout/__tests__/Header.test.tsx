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

async function renderHeader(extra: Partial<Parameters<typeof Header>[0]> = {}) {
  const markup = await Header({
    basePath: "/us/en",
    locale: "en" as Locale,
    mobileNavigation: <div data-testid="mobile-nav" />,
    categoryNavigation: <div data-testid="category-nav" />,
    storeName: "متجر الاختبار",
    ...extra,
  });
  return render(markup);
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

  describe("structural design (V7a)", () => {
    const identityRow = (container: HTMLElement) =>
      container.querySelector(
        "header > div:not(.hidden) > div > div",
      ) as HTMLElement;

    it("an absent design renders the exact classes the header always had", async () => {
      const { container } = await renderHeader();
      expect(container.querySelector("header")?.className).toBe(
        "sticky top-(--store-announcement-height) z-40 bg-store-surface",
      );
      expect(identityRow(container).className).toBe(
        "grid grid-cols-[1fr_minmax(0,1fr)_1fr] grid-rows-[var(--store-header-height)_auto] items-center gap-x-2 gap-y-1 md:flex md:h-store-header-lg md:grid-rows-none md:gap-6",
      );
      expect(
        screen.getByRole("link", { name: /متجر الاختبار/ }).className,
      ).toBe(
        "inline-flex min-w-0 max-w-full items-center text-store-primary justify-self-center md:justify-self-start",
      );
    });

    it("an explicit all-defaults design only swaps the fixed row height for a minimum", async () => {
      const plain = await renderHeader();
      const plainRow = identityRow(plain.container).className;
      plain.unmount();
      const { container } = await renderHeader({
        design: { layout: "standard", sticky: "always" },
      });
      expect(identityRow(container).className).toBe(
        plainRow
          .replace(
            "grid-rows-[var(--store-header-height)_auto]",
            "grid-rows-[minmax(var(--store-header-height),auto)_auto]",
          )
          .replace("md:h-store-header-lg", "md:min-h-store-header-lg"),
      );
    });

    it("sticky off drops the sticky positioning", async () => {
      const { container } = await renderHeader({ design: { sticky: "off" } });
      const header = container.querySelector("header") as HTMLElement;
      expect(header.className).toBe("relative z-40 bg-store-surface");
    });

    it("on-scroll-up stays sticky and mounts its controller; always / off mount none", async () => {
      const up = await renderHeader({ design: { sticky: "on-scroll-up" } });
      expect(up.container.querySelector("header")?.className).toContain(
        "sticky",
      );
      expect(up.container.querySelector("[data-header-scroll]")).not.toBeNull();
      up.unmount();
      for (const sticky of ["always", "off"] as const) {
        const view = await renderHeader({ design: { sticky } });
        expect(view.container.querySelector("[data-header-scroll]")).toBeNull();
        view.unmount();
      }
    });

    it("centered places the menu, search, brand and actions on explicit desktop columns", async () => {
      const { container } = await renderHeader({
        design: { layout: "centered" },
      });
      const row = identityRow(container);
      expect(row.className).toContain(
        "md:grid-cols-[2.5rem_minmax(0,1fr)_auto_minmax(0,1fr)_2.5rem]",
      );
      expect(row.className).toContain(
        "lg:grid-cols-[0_minmax(0,1fr)_auto_minmax(0,1fr)_0]",
      );
      expect(
        screen.getByTestId("store-search").parentElement?.className,
      ).toContain("md:col-start-2");
      expect(
        screen.getByRole("link", { name: /متجر الاختبار/ }).className,
      ).toContain("md:col-start-3");
    });

    it("two-row sends the search under the brand and actions", async () => {
      const { container } = await renderHeader({
        design: { layout: "two-row" },
      });
      expect(identityRow(container).className).toContain(
        "md:grid-cols-[auto_minmax(0,1fr)_auto]",
      );
      expect(
        screen.getByTestId("store-search").parentElement?.className,
      ).toContain("lg:col-span-2");
      expect(screen.getByTestId("store-search")).toBeInTheDocument();
    });

    it("mobile logo-start keeps the brand after the menu on a three-column grid", async () => {
      await renderHeader({ design: { mobileLayout: "logo-start" } });
      const brand = screen.getByRole("link", { name: /متجر الاختبار/ });
      expect(brand.className).toContain("justify-self-start");
      expect(brand.className).not.toContain("justify-self-center");
      expect(brand.parentElement?.className).toContain(
        "grid-cols-[auto_minmax(0,1fr)_auto]",
      );
    });

    it("mounts exactly one search field in every layout", async () => {
      for (const layout of ["standard", "centered", "two-row"] as const) {
        const { unmount } = await renderHeader({ design: { layout } });
        expect(screen.getAllByTestId("store-search")).toHaveLength(1);
        unmount();
      }
    });

    it("the empty-search placeholder follows the layout", async () => {
      const { container } = await renderHeader({
        design: { layout: "two-row" },
      });
      expect(
        container.querySelector("[data-testid=store-search]"),
      ).not.toBeNull();
    });
  });
});
