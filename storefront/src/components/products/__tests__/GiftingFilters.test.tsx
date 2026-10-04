import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiftingFilters } from "@/components/products/GiftingFilters";
import type { ListingFacets } from "@/lib/commerce/listing-facets";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/sa/ar/products",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}|${Object.values(values).join("|")}` : key,
}));

const BRAND = "0a1b2c3d-1111-4222-8333-444455556666";

const facets: ListingFacets = {
  groups: [
    {
      key: "occasion",
      systemKey: "occasion",
      name: "المناسبة",
      values: [
        { slug: "birthday", name: "عيد ميلاد", count: 4 },
        { slug: "wedding", name: "زفاف", count: 2 },
      ],
    },
    {
      key: "recipient",
      systemKey: "recipient",
      name: "المُهدى إليه",
      values: [{ slug: "mom", name: "أمي", count: 3 }],
    },
  ],
  brands: [{ id: BRAND, name: "روزا", count: 5 }],
};

function lastPush(): URL {
  const calls = nav.push.mock.calls;
  return new URL(calls[calls.length - 1][0] as string, "http://x");
}

describe("GiftingFilters (FLOWERS-H10)", () => {
  beforeEach(() => {
    nav.search = "";
    nav.push.mockClear();
  });
  afterEach(() => cleanup());

  it("renders each facet as a labelled group of toggle buttons with counts", () => {
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    const occasion = screen.getByRole("group", { name: "المناسبة" });
    const birthday = within(occasion).getByRole("button", {
      name: /عيد ميلاد/,
    });
    expect(birthday.getAttribute("aria-pressed")).toBe("false");
    expect(birthday.textContent).toContain("(4)");
    expect(screen.getByRole("group", { name: "المُهدى إليه" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "giftingBrand" })).toBeTruthy();
  });

  it("selecting a value pushes it to the URL and keeps unrelated params and scroll position", () => {
    nav.search = "q=rose&collection=roses";
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: /عيد ميلاد/ }));
    const url = lastPush();
    expect(url.pathname).toBe("/sa/ar/products");
    expect(url.searchParams.get("facet[occasion]")).toBe("birthday");
    expect(url.searchParams.get("q")).toBe("rose");
    expect(url.searchParams.get("collection")).toBe("roses");
    expect(nav.push.mock.calls[0][1]).toEqual({ scroll: false });
  });

  it("marks selected values pressed, lists them as removable chips, and removes one at a time", () => {
    nav.search = "facet[occasion]=birthday,wedding&facet[recipient]=mom";
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    expect(
      within(screen.getByRole("group", { name: "المناسبة" }))
        .getByRole("button", { name: /عيد ميلاد/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const chips = screen.getByRole("list", { name: "giftingActive" });
    expect(within(chips).getAllByRole("listitem").length).toBe(4); // 3 chips + clear all
    fireEvent.click(
      within(chips).getByRole("button", {
        name: /clearFilter\|المناسبة: عيد ميلاد/,
      }),
    );
    expect(lastPush().searchParams.get("facet[occasion]")).toBe("wedding");
    expect(lastPush().searchParams.get("facet[recipient]")).toBe("mom");
  });

  it("clear all removes the gifting filters but not the collection or search", () => {
    nav.search =
      "q=rose&collection=roses&facet[occasion]=birthday&brand_id=" +
      BRAND +
      "&deliver_today=true";
    render(<GiftingFilters facets={facets} deliverTodayAvailable />);
    fireEvent.click(screen.getByRole("button", { name: "clearAll" }));
    const url = lastPush();
    expect([...url.searchParams.keys()].sort()).toEqual(["collection", "q"]);
  });

  it("brand is a single choice", () => {
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: /روزا/ }));
    expect(lastPush().searchParams.get("brand_id")).toBe(BRAND);
  });

  it("offers Deliver today only when the store schedules delivery, or while it is active", () => {
    const { rerender } = render(
      <GiftingFilters facets={facets} deliverTodayAvailable={false} />,
    );
    expect(
      screen.queryByRole("button", { name: "giftingDeliverToday" }),
    ).toBeNull();
    rerender(<GiftingFilters facets={facets} deliverTodayAvailable />);
    fireEvent.click(
      screen.getByRole("button", { name: "giftingDeliverToday" }),
    );
    expect(lastPush().searchParams.get("deliver_today")).toBe("true");

    cleanup();
    nav.search = "deliver_today=true";
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    // Still removable when active even though scheduling reads unavailable.
    const toggle = screen.getAllByRole("button", {
      name: "giftingDeliverToday",
    })[0];
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a chip for a selected value that no longer exists, using the raw token", () => {
    nav.search = "facet[occasion]=retired";
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    const chips = screen.getByRole("list", { name: "giftingActive" });
    expect(within(chips).getByText("المناسبة: retired")).toBeTruthy();
  });

  it("renders nothing when there is nothing to filter by", () => {
    const { container } = render(
      <GiftingFilters
        facets={{ groups: [], brands: [] }}
        deliverTodayAvailable={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("the mobile toggle controls the group panel and shows the active count", () => {
    nav.search = "facet[occasion]=birthday";
    render(<GiftingFilters facets={facets} deliverTodayAvailable={false} />);
    const toggle = screen.getByRole("button", { name: /^filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("(1)");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(panel?.className).toContain("grid");
    expect(panel?.className).not.toMatch(/(^| )hidden( |$)/);
  });
});
