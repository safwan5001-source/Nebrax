import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileMenu } from "@/components/layout/MobileMenu";

const localeMock = vi.hoisted(() => ({ value: "en" }));

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
  useLocale: () => localeMock.value,
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
    localeMock.value = "en";
  });

  it.each([
    ["ar", "rtl", "right"],
    ["en", "ltr", "left"],
  ])("opens %s from the reading-start edge with explicit direction", async (locale, direction, side) => {
    localeMock.value = locale;
    const user = userEvent.setup();
    render(
      <MobileMenu
        rootCategories={[]}
        basePath={`/sa/${locale}`}
        wholesaleEnabled={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog).toHaveAttribute("dir", direction);
    expect(dialog).toHaveAttribute("data-side", side);
    expect(within(dialog).getByRole("link", { name: "Home" })).toHaveClass(
      "text-start",
      "min-h-11",
      "shrink-0",
    );
    expect(
      within(dialog).getByRole("button", { name: "Close menu" }),
    ).not.toHaveClass("md:hidden", "hidden");
  });

  it("closes via its named close control and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(
      <MobileMenu
        rootCategories={[]}
        basePath="/sa/ar"
        wholesaleEnabled={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close menu",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes via Escape and releases the page scroll lock", async () => {
    const user = userEvent.setup();
    render(
      <MobileMenu
        rootCategories={[]}
        basePath="/sa/ar"
        wholesaleEnabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.body).toHaveAttribute("data-scroll-locked");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
  });

  it("closes by clicking the outside overlay", async () => {
    const user = userEvent.setup();
    render(
      <MobileMenu
        rootCategories={[]}
        basePath="/sa/ar"
        wholesaleEnabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(document.querySelector('[data-slot="sheet-overlay"]')!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("makes inactive category panels inert and resets them on close", async () => {
    localeMock.value = "ar";
    const user = userEvent.setup();
    render(
      <MobileMenu
        rootCategories={
          [
            {
              id: "cat",
              name: "Flowers",
              permalink: "flowers",
              children: [
                {
                  id: "leaf",
                  name: "Roses",
                  permalink: "flowers/roses",
                  children: [],
                },
              ],
            },
          ] as never
        }
        basePath="/sa/ar"
        wholesaleEnabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("button", { name: "Flowers" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(
        dialog.querySelector('[data-mobile-menu-panel="main"]'),
      ).toHaveAttribute("inert"),
    );
    expect(dialog.querySelector('[data-mobile-menu-panel="main"]')).toHaveClass(
      "translate-x-full",
    );
    expect(within(dialog).getByRole("link", { name: "Roses" })).toHaveAttribute(
      "href",
      "/sa/ar/c/flowers/roses",
    );
    expect(
      within(dialog).getByRole("button", { name: "Region and language" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(
      screen
        .getByRole("dialog")
        .querySelector('[data-mobile-menu-panel="main"]'),
    ).not.toHaveAttribute("inert");
    expect(
      screen.queryByRole("link", { name: "Roses" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    "ar",
    "en",
  ])("keeps the parent centered immediately during Back in %s", async (locale) => {
    localeMock.value = locale;
    const user = userEvent.setup();
    render(
      <MobileMenu
        rootCategories={
          [
            {
              id: "root",
              name: "Root",
              permalink: "root",
              children: [
                {
                  id: "child",
                  name: "Child",
                  permalink: "root/child",
                  children: [
                    {
                      id: "leaf",
                      name: "Leaf",
                      permalink: "root/child/leaf",
                      children: [],
                    },
                  ],
                },
              ],
            },
          ] as never
        }
        basePath={`/sa/${locale}`}
        wholesaleEnabled={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog.querySelector("nav")!).getByRole("button", {
        name: "Root",
      }),
    );
    await waitFor(() =>
      expect(
        dialog.querySelector('[data-mobile-menu-panel="main"]'),
      ).toHaveAttribute("inert"),
    );
    const parent = dialog.querySelector('[data-mobile-menu-panel="category"]')!;
    await user.click(
      within(parent as HTMLElement).getByRole("button", { name: "Child" }),
    );
    await waitFor(() => expect(parent).toHaveAttribute("inert"));
    await user.click(
      within(dialog.firstElementChild as HTMLElement).getByRole("button", {
        name: "Child",
      }),
    );
    expect(parent).not.toHaveAttribute("inert");
    expect(parent).toHaveClass("translate-x-0");
    const outgoing = dialog.querySelectorAll(
      '[data-mobile-menu-panel="category"]',
    )[1];
    expect(outgoing).toHaveAttribute("inert");
    expect(outgoing).toHaveClass(
      locale === "ar" ? "-translate-x-full" : "translate-x-full",
    );
    // A second Back before the cleanup timer fires must land on main, not a stale index.
    await user.click(
      within(dialog.firstElementChild as HTMLElement).getByRole("button", {
        name: "Root",
      }),
    );
    expect(dialog.querySelector('[data-mobile-menu-panel="main"]')).toHaveClass(
      "translate-x-0",
    );
    expect(
      dialog.querySelector('[data-mobile-menu-panel="main"]'),
    ).not.toHaveAttribute("inert");
  });

  it("keeps tenant categories, links and feature flags local when IDs collide", async () => {
    const user = userEvent.setup();
    const menu = (tenant: string, wholesale: boolean) => (
      <MobileMenu
        key={tenant}
        rootCategories={
          [
            {
              id: "shared",
              name: `Category ${tenant}`,
              permalink: tenant,
              children: [],
            },
          ] as never
        }
        basePath={`/${tenant}/en`}
        wholesaleEnabled={wholesale}
        extraLinks={[
          {
            id: "shared",
            label: `About ${tenant}`,
            href: `/${tenant}/en/about`,
          },
        ]}
      />
    );
    const view = render(menu("a", true));
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("link", { name: "About a" })).toHaveAttribute(
      "href",
      "/a/en/about",
    );
    await user.keyboard("{Escape}");
    view.rerender(menu("b", false));
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("link", { name: "About b" })).toHaveAttribute(
      "href",
      "/b/en/about",
    );
    expect(screen.getByRole("link", { name: "Category b" })).toHaveAttribute(
      "href",
      "/b/en/c/b",
    );
    expect(
      screen.queryByRole("link", { name: "About a" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Category a" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Wholesale" }),
    ).not.toBeInTheDocument();
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
