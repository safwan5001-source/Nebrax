import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

const LABELS: Record<string, string> = {
  home: "Home",
  shop: "Products",
  cart: "Cart",
  account: "Account",
  primaryNavigation: "Primary navigation",
};

let pathname = "/us/en";
let itemCount = 0;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => LABELS[key] ?? key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ itemCount }),
}));

describe("MobileBottomNav", () => {
  beforeEach(() => {
    pathname = "/us/en";
    itemCount = 0;
  });

  it("offers only destinations the storefront actually routes to", () => {
    render(<MobileBottomNav basePath="/us/en" />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const links = within(nav).getAllByRole("link");

    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Home", "/us/en"],
      ["Products", "/us/en/products"],
      ["Cart", "/us/en/cart"],
      ["Account", "/us/en/account"],
    ]);
    expect(within(nav).queryByRole("link", { name: /wishlist/i })).toBeNull();
  });

  it("marks the current surface and leaves Home unmarked inside it", () => {
    pathname = "/us/en/account/orders";
    render(<MobileBottomNav basePath="/us/en" />);

    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shows the cart count once the client cart is known", async () => {
    itemCount = 3;
    render(<MobileBottomNav basePath="/us/en" />);

    const cart = await screen.findByRole("link", { name: /Cart/ });
    expect(cart).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: /Home/ })).not.toHaveTextContent(
      "3",
    );
  });

  it("clears the bottom inset so it never sits under the home indicator", () => {
    render(<MobileBottomNav basePath="/us/en" />);

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveClass("pb-[env(safe-area-inset-bottom)]");
  });
});
