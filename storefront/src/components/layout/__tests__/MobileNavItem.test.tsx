import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StoreExtraNavLink } from "@/components/layout/MobileMenu";
import { MobileNavItem } from "@/components/layout/MobileNavItem";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { label?: string }) =>
    ({
      showSubmenu: `Show submenu for ${values?.label}`,
      hideSubmenu: `Hide submenu for ${values?.label}`,
    })[key] ?? key,
}));

const group: StoreExtraNavLink = {
  id: "shop",
  label: "Shop",
  href: "/sa/ar/products",
  dropdown: true,
  children: [
    { id: "k1", label: "Shoes", href: "/sa/ar/c/shoes", newTab: false },
    { id: "k2", label: "Blog", href: "https://example.com", newTab: true },
  ],
};

describe("MobileNavItem (V7d-3)", () => {
  it("a plain item is a single link carrying the parity marker", () => {
    const onNavigate = vi.fn();
    render(
      <MobileNavItem
        item={{ id: "a", label: "About", href: "/x" }}
        linkClass="row"
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByRole("link", { name: "About" });
    expect(link).toHaveAttribute("data-mobile-extra-nav");
    link.click();
    expect(onNavigate).toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an item with children is an accordion: the label still links, the chevron discloses", async () => {
    const user = userEvent.setup();
    render(
      <MobileNavItem
        item={group}
        linkClass="row"
        onNavigate={() => undefined}
      />,
    );
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute(
      "href",
      "/sa/ar/products",
    );
    const toggle = screen.getByRole("button", {
      name: "Show submenu for Shop",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Shoes" })).toBeNull();
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: "Hide submenu for Shop" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Shoes" })).toHaveAttribute(
      "href",
      "/sa/ar/c/shoes",
    );
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
});
