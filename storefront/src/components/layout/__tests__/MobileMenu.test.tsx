import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileMenu } from "@/components/layout/MobileMenu";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      closeMenu: "Close menu",
      openMenu: "Open menu",
      menu: "Menu",
      home: "Home",
      allProducts: "All Products",
      contact: "Contact",
      myAccount: "My Account",
      wholesale: "Wholesale",
    })[key] ?? key,
  useLocale: () => "en",
}));

vi.mock("@/components/layout/RegionPreferences", () => ({
  RegionPreferences: ({ variant }: { variant: string }) => (
    <button type="button" aria-label="Region and language">
      {variant}
    </button>
  ),
}));

describe("MobileMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("places My Account below Wholesale and centers Region and language", async () => {
    const user = userEvent.setup();

    render(
      <MobileMenu rootCategories={[]} basePath="/us/en" wholesaleEnabled />,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const menu = screen.getByRole("dialog", { name: "Menu" });
    const wholesale = within(menu).getByRole("link", { name: "Wholesale" });
    const myAccount = within(menu).getByRole("link", { name: "My Account" });
    const regionPreferences = within(menu).getByRole("button", {
      name: "Region and language",
    });
    const footer = regionPreferences.closest('[data-slot="sheet-footer"]');

    expect(
      wholesale.compareDocumentPosition(myAccount) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(footer).toHaveClass("items-center");
  });

  it("keeps the wholesale entry hidden when the addon is disabled", async () => {
    const user = userEvent.setup();

    render(
      <MobileMenu
        rootCategories={[]}
        basePath="/us/en"
        wholesaleEnabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const menu = screen.getByRole("dialog", { name: "Menu" });
    expect(
      within(menu).queryByRole("link", { name: "Wholesale" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("link", { name: "My Account" }),
    ).toHaveAttribute("href", "/us/en/account");
  });
  // CUST-HV V1A / DEF-1 — merchant-published header links used to be rendered
  // only from `lg` up, and `MobileMenu` received none, so below 1024px they were
  // unreachable on the published store.
  describe("merchant-published header links (DEF-1)", () => {
    const extraLinks = [
      { id: "nav-about", label: "About us", href: "/us/en/about" },
      { id: "nav-ig", label: "Instagram", href: "https://instagram.com/awj" },
    ];

    it("lists every published link, in order, with its resolved href", async () => {
      const user = userEvent.setup();
      render(
        <MobileMenu
          rootCategories={[]}
          basePath="/us/en"
          wholesaleEnabled={false}
          extraLinks={extraLinks}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Open menu" }));

      const menu = screen.getByRole("dialog", { name: "Menu" });
      const links = menu.querySelectorAll("[data-mobile-extra-nav]");
      expect(Array.from(links, (link) => link.textContent)).toEqual([
        "About us",
        "Instagram",
      ]);
      expect(
        within(menu).getByRole("link", { name: "About us" }),
      ).toHaveAttribute("href", "/us/en/about");
      expect(
        within(menu).getByRole("link", { name: "Instagram" }),
      ).toHaveAttribute("href", "https://instagram.com/awj");
    });

    it("places them with the main navigation, ahead of Contact and the account group", async () => {
      const user = userEvent.setup();
      render(
        <MobileMenu
          rootCategories={[]}
          basePath="/us/en"
          wholesaleEnabled
          extraLinks={extraLinks}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Open menu" }));

      const menu = screen.getByRole("dialog", { name: "Menu" });
      const order = within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent);
      expect(order.indexOf("About us")).toBeGreaterThan(
        order.indexOf("All Products"),
      );
      expect(order.indexOf("About us")).toBeLessThan(order.indexOf("Contact"));
      expect(order.indexOf("Instagram")).toBeLessThan(
        order.indexOf("Wholesale"),
      );
      expect(order.indexOf("Instagram")).toBeLessThan(
        order.indexOf("My Account"),
      );
    });

    it("closes the menu when a link is followed", async () => {
      const user = userEvent.setup();
      render(
        <MobileMenu
          rootCategories={[]}
          basePath="/us/en"
          wholesaleEnabled={false}
          extraLinks={extraLinks}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      await user.click(screen.getByRole("link", { name: "About us" }));

      expect(
        screen.queryByRole("dialog", { name: "Menu" }),
      ).not.toBeInTheDocument();
    });

    it("renders nothing extra when the merchant published no links", async () => {
      const user = userEvent.setup();
      render(
        <MobileMenu
          rootCategories={[]}
          basePath="/us/en"
          wholesaleEnabled={false}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Open menu" }));

      const menu = screen.getByRole("dialog", { name: "Menu" });
      expect(menu.querySelectorAll("[data-mobile-extra-nav]")).toHaveLength(0);
    });
  });
});
