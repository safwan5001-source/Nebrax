import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HeaderNavLinks } from "@/components/layout/HeaderNavLinks";
import type { StoreExtraNavLink } from "@/components/layout/MobileMenu";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { label?: string }) =>
    ({
      mainMenu: "Main menu",
      showSubmenu: `Show submenu for ${values?.label}`,
      hideSubmenu: `Hide submenu for ${values?.label}`,
    })[key] ?? key,
}));

const items: StoreExtraNavLink[] = [
  { id: "plain", label: "Home", href: "/sa/ar" },
  {
    id: "shop",
    label: "Shop",
    href: "/sa/ar/products",
    dropdown: true,
    badge: { text: "New", tone: "accent" },
    icon: "tag",
    children: [
      { id: "k1", label: "Shoes", href: "/sa/ar/c/shoes", newTab: false },
      { id: "k2", label: "Blog", href: "https://example.com", newTab: true },
      { id: "k3", label: "Bags", href: "/sa/ar/c/bags", newTab: false },
    ],
  },
];

describe("HeaderNavLinks (V7d-3)", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<HeaderNavLinks items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a plain item is a link and a dropdown parent is a link plus a disclosure button", () => {
    render(<HeaderNavLinks items={items} />);
    expect(
      screen.getByRole("navigation", { name: "Main menu", hidden: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Home", hidden: true }),
    ).toHaveAttribute("href", "/sa/ar");
    expect(
      screen.getByRole("link", { name: /Shop/, hidden: true }),
    ).toHaveAttribute("href", "/sa/ar/products");
    const button = screen.getByRole("button", {
      name: "Show submenu for Shop",
      hidden: true,
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls");
    expect(
      document.getElementById(button.getAttribute("aria-controls") ?? ""),
    ).toHaveAttribute("hidden");
  });

  it("renders the badge with its tone and the icon decoratively", () => {
    render(<HeaderNavLinks items={items} />);
    const badge = document.querySelector("[data-nav-badge]");
    expect(badge).toHaveTextContent("New");
    expect(badge).toHaveAttribute("data-nav-badge", "accent");
    expect(document.querySelector("a[data-extra-nav] svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("the button opens and closes the panel (no hover needed)", async () => {
    const user = userEvent.setup();
    render(<HeaderNavLinks items={items} />);
    const button = screen.getByRole("button", {
      name: "Show submenu for Shop",
      hidden: true,
    });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(
      button.getAttribute("aria-controls") ?? "",
    ) as HTMLElement;
    expect(panel).not.toHaveAttribute("hidden");
    expect(within(panel).getAllByRole("link")).toHaveLength(3);
    await user.click(
      screen.getByRole("button", {
        name: "Hide submenu for Shop",
        hidden: true,
      }),
    );
    expect(panel).toHaveAttribute("hidden");
  });

  it("ArrowDown on the button opens and focuses the first child; arrows rove; Escape returns focus", async () => {
    const user = userEvent.setup();
    render(<HeaderNavLinks items={items} />);
    const button = screen.getByRole("button", {
      name: "Show submenu for Shop",
      hidden: true,
    });
    button.focus();
    await user.keyboard("{ArrowDown}");
    const [first, second, third] = Array.from(
      document.querySelectorAll<HTMLElement>("[data-nav-child]"),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(first));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(first); // wraps
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(third);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(third);
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);
  });

  it("focus leaving the item closes it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <HeaderNavLinks items={items} />
        <button type="button">outside</button>
      </>,
    );
    const button = screen.getByRole("button", {
      name: "Show submenu for Shop",
      hidden: true,
    });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    act(() => screen.getByRole("button", { name: "outside" }).focus());
    expect(
      screen.getByRole("button", {
        name: "Show submenu for Shop",
        hidden: true,
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("a mouse hover opens it; touch pointers do not", () => {
    render(<HeaderNavLinks items={items} />);
    const root = document.querySelector("[data-nav-dropdown]") as HTMLElement;
    fireEvent.pointerEnter(root, { pointerType: "touch" });
    expect(root).not.toHaveAttribute("data-open");
    fireEvent.pointerEnter(root, { pointerType: "mouse" });
    expect(root).toHaveAttribute("data-open");
  });

  it("new-tab children carry rel=noopener noreferrer", () => {
    render(<HeaderNavLinks items={items} />);
    const blog = Array.from(document.querySelectorAll("[data-nav-child]")).find(
      (a) => a.textContent === "Blog",
    );
    expect(blog).toHaveAttribute("target", "_blank");
    expect(blog).toHaveAttribute("rel", "noopener noreferrer");
  });
});
