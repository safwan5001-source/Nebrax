import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WishlistButton } from "@/components/products/WishlistButton";
import { WishlistProvider } from "@/contexts/WishlistContext";
import { WISHLIST_CAPABILITY } from "@/lib/commerce/capabilities";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("Wishlist — DESIGN_ONLY capability seam", () => {
  it("is declared design_only, so nothing may treat it as authoritative", () => {
    expect(WISHLIST_CAPABILITY).toBe("design_only");
  });

  it("renders nothing outside a provider rather than a dead control", () => {
    const { container } = render(<WishlistButton productId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes both accessible names and toggles pressed state", async () => {
    const user = userEvent.setup();
    render(
      <WishlistProvider>
        <WishlistButton productId="p1" />
      </WishlistProvider>,
    );

    const button = screen.getByRole("button", { name: "addToFavorites" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    const selected = screen.getByRole("button", {
      name: "removeFromFavorites",
    });
    expect(selected).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps each product's state independent", async () => {
    const user = userEvent.setup();
    render(
      <WishlistProvider>
        <WishlistButton productId="p1" />
        <WishlistButton productId="p2" />
      </WishlistProvider>,
    );

    const [first, second] = screen.getAllByRole("button");
    await user.click(first);

    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
  });

  it("persists nothing — not to localStorage, not to a cookie", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    render(
      <WishlistProvider>
        <WishlistButton productId="p1" />
      </WishlistProvider>,
    );
    await user.click(screen.getByRole("button"));

    // Browser storage must never stand in for real business persistence: a
    // favourite surviving a reload would imply an account-level promise the
    // platform has not made.
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain("wishlist");

    setItem.mockRestore();
  });
});
