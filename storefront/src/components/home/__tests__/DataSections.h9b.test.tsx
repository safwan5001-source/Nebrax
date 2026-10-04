import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FLOWERS-H9b / ADR-21 — the three published data-backed sections. They store
 * only references/text; everything shown is read live. An empty or failed read
 * must leave no section (never an empty heading, never an invented value).
 */

const mocks = vi.hoisted(() => ({
  fetchShelfProducts: vi.fn(),
  fetchDiscoveryValues: vi.fn(),
  fetchEarliestDelivery: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    values ? `${key}|${Object.values(values).join("|")}` : key,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/products/ProductCard", () => ({
  ProductCard: ({
    product,
    listId,
  }: {
    product: { id: string };
    listId: string;
  }) => <div data-testid="card" data-id={product.id} data-list={listId} />,
}));
vi.mock("@/components/products/ProductCarousel", () => ({
  ProductCarousel: ({ products }: { products: { id: string }[] }) => (
    <div data-testid="carousel" data-count={products.length} />
  ),
}));
vi.mock("@/lib/commerce/data-sections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commerce/data-sections")>()),
  fetchShelfProducts: mocks.fetchShelfProducts,
  fetchDiscoveryValues: mocks.fetchDiscoveryValues,
  fetchEarliestDelivery: mocks.fetchEarliestDelivery,
}));

const { ProductShelfSection } = await import("../ProductShelfSection");
const { DiscoverySection } = await import("../DiscoverySection");
const { DeliveryPromiseBand } = await import("../DeliveryPromiseBand");

const shelf = (over = {}) => ({
  title: "",
  deliverToday: false,
  limit: 8,
  source: { kind: "collection" as const, slug: "best-sellers" },
  ...over,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ProductShelfSection", () => {
  const base = { basePath: "/sa/ar", locale: "ar", headingId: "shelf-a" };

  it("renders the API's products in the API's order under the merchant title", async () => {
    mocks.fetchShelfProducts.mockResolvedValue([{ id: "p2" }, { id: "p1" }]);
    render(
      (await ProductShelfSection({
        ...base,
        content: shelf({ title: "الأكثر مبيعاً" }),
      })) as React.JSX.Element,
    );
    expect(screen.getByRole("heading", { name: "الأكثر مبيعاً" })).toBeTruthy();
    expect(screen.getAllByTestId("card").map((el) => el.dataset.id)).toEqual([
      "p2",
      "p1",
    ]);
    expect(mocks.fetchShelfProducts).toHaveBeenCalledWith(
      shelf({ title: "الأكثر مبيعاً" }),
    );
  });

  it("links 'view all' to the listing with the same source", async () => {
    mocks.fetchShelfProducts.mockResolvedValue([{ id: "p1" }]);
    render(
      (await ProductShelfSection({
        ...base,
        content: shelf({
          source: { kind: "facet", key: "occasion", value: "eid" },
          deliverToday: true,
        }),
      })) as React.JSX.Element,
    );
    const link = screen.getByRole("link", { name: /viewAll/ });
    const url = new URL(link.getAttribute("href") as string, "https://x.test");
    expect(url.pathname).toBe("/sa/ar/products");
    expect(url.searchParams.get("facet[occasion]")).toBe("eid");
    expect(url.searchParams.get("deliver_today")).toBe("true");
  });

  it("falls back to neutral titles: deliver-today, otherwise a generic selection", async () => {
    mocks.fetchShelfProducts.mockResolvedValue([{ id: "p1" }]);
    const today = render(
      (await ProductShelfSection({
        ...base,
        content: shelf({ source: undefined, deliverToday: true }),
      })) as React.JSX.Element,
    );
    expect(screen.getByRole("heading", { name: "deliverToday" })).toBeTruthy();
    today.unmount();
    render(
      (await ProductShelfSection({
        ...base,
        content: shelf(),
      })) as React.JSX.Element,
    );
    expect(screen.getByRole("heading", { name: "shopSelection" })).toBeTruthy();
  });

  it("uses the carousel for the market preset", async () => {
    mocks.fetchShelfProducts.mockResolvedValue([
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ]);
    render(
      (await ProductShelfSection({
        ...base,
        content: shelf(),
        themePreset: "awj-market",
      })) as React.JSX.Element,
    );
    expect(screen.getByTestId("carousel").dataset.count).toBe("3");
    expect(screen.queryAllByTestId("card")).toHaveLength(0);
  });

  it("leaves no section when the source has no products or the read fails", async () => {
    mocks.fetchShelfProducts.mockResolvedValueOnce([]);
    expect(await ProductShelfSection({ ...base, content: shelf() })).toBeNull();
    mocks.fetchShelfProducts.mockRejectedValueOnce(new Error("down"));
    expect(await ProductShelfSection({ ...base, content: shelf() })).toBeNull();
  });
});

describe("DiscoverySection", () => {
  const base = { basePath: "/sa/ar", locale: "ar", headingId: "disc-a" };
  const axis = {
    name: "المناسبة",
    options: [
      { value: "eid", name: "العيد", count: 4 },
      { value: "mothers-day", name: "عيد الأم", count: 2 },
    ],
  };

  it("renders tiles linking to the facet-filtered listing", async () => {
    mocks.fetchDiscoveryValues.mockResolvedValue(axis);
    render(
      (await DiscoverySection({
        ...base,
        content: {
          title: "",
          axis: "facet",
          dimension: "occasion",
          display: "tiles",
        },
      })) as React.JSX.Element,
    );
    expect(mocks.fetchDiscoveryValues).toHaveBeenCalledWith({
      axis: "facet",
      dimension: "occasion",
    });
    const link = screen.getByRole("link", { name: "العيد" });
    const url = new URL(link.getAttribute("href") as string, "https://x.test");
    expect(url.pathname).toBe("/sa/ar/products");
    expect(url.searchParams.get("facet[occasion]")).toBe("eid");
    expect(screen.getByRole("heading").textContent).toBe("discoverBy المناسبة");
  });

  it("renders chips, honours a merchant title, and caps the options", async () => {
    mocks.fetchDiscoveryValues.mockResolvedValue({
      ...axis,
      options: Array.from({ length: 20 }, (_, i) => ({
        value: `v${i}`,
        name: `قيمة ${i}`,
        count: 1,
      })),
    });
    render(
      (await DiscoverySection({
        ...base,
        content: {
          title: "تسوّق حسب المناسبة",
          axis: "facet",
          dimension: "occasion",
          display: "chips",
        },
      })) as React.JSX.Element,
    );
    expect(
      screen.getByRole("heading", { name: "تسوّق حسب المناسبة" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(12);
  });

  it("links brands by id with a brand title fallback", async () => {
    mocks.fetchDiscoveryValues.mockResolvedValue({
      name: "",
      options: [
        {
          value: "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e",
          name: "علامة",
          count: 3,
        },
      ],
    });
    render(
      (await DiscoverySection({
        ...base,
        content: { title: "", axis: "brand", display: "tiles" },
      })) as React.JSX.Element,
    );
    expect(screen.getByRole("heading", { name: "shopByBrand" })).toBeTruthy();
    const url = new URL(
      screen
        .getByRole("link", { name: "علامة" })
        .getAttribute("href") as string,
      "https://x.test",
    );
    expect(url.searchParams.get("brand_id")).toBe(
      "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e",
    );
  });

  it('treats a merchant facet keyed "brand" as a facet, not as the built-in brands', async () => {
    mocks.fetchDiscoveryValues.mockResolvedValue({
      name: "الماركة",
      options: [{ value: "gucci", name: "غوتشي", count: 2 }],
    });
    render(
      (await DiscoverySection({
        ...base,
        content: {
          title: "",
          axis: "facet",
          dimension: "brand",
          display: "tiles",
        },
      })) as React.JSX.Element,
    );
    expect(mocks.fetchDiscoveryValues).toHaveBeenCalledWith({
      axis: "facet",
      dimension: "brand",
    });
    const url = new URL(
      screen
        .getByRole("link", { name: "غوتشي" })
        .getAttribute("href") as string,
      "https://x.test",
    );
    expect(url.searchParams.get("facet[brand]")).toBe("gucci");
    expect(url.searchParams.has("brand_id")).toBe(false);
  });

  it("renders nothing for a facet axis with no dimension", async () => {
    expect(
      await DiscoverySection({
        ...base,
        content: { title: "", axis: "facet", dimension: "", display: "tiles" },
      }),
    ).toBeNull();
    expect(mocks.fetchDiscoveryValues).not.toHaveBeenCalled();
  });

  it("leaves no section when the dimension has no visible value or the read fails", async () => {
    mocks.fetchDiscoveryValues.mockResolvedValueOnce(null);
    expect(
      await DiscoverySection({
        ...base,
        content: { title: "", axis: "facet", dimension: "x", display: "tiles" },
      }),
    ).toBeNull();
    mocks.fetchDiscoveryValues.mockRejectedValueOnce(new Error("down"));
    expect(
      await DiscoverySection({
        ...base,
        content: { title: "", axis: "facet", dimension: "x", display: "tiles" },
      }),
    ).toBeNull();
  });
});

describe("DeliveryPromiseBand", () => {
  const base = { locale: "en", headingId: "dp-a" };

  it("states the live earliest window with the merchant's optional text", async () => {
    mocks.fetchEarliestDelivery.mockResolvedValue({
      date: "2999-01-02",
      startTime: "19:00",
      endTime: "22:00",
      label: "Evening",
      timezone: "Asia/Riyadh",
    });
    render(
      (await DeliveryPromiseBand({
        ...base,
        content: { title: "", body: "Order before noon" },
      })) as React.JSX.Element,
    );
    expect(
      screen.getByRole("heading", { name: "earliestDelivery" }),
    ).toBeTruthy();
    expect(screen.getByText(/^deliveryAt\|/).textContent).toMatch(
      /7:00 PM – 10:00 PM/,
    );
    expect(screen.getByText("Order before noon")).toBeTruthy();
  });

  it("omits the band when nothing is deliverable, scheduling is off, or the read fails", async () => {
    mocks.fetchEarliestDelivery.mockResolvedValueOnce(null);
    expect(
      await DeliveryPromiseBand({
        ...base,
        content: { title: "x", body: "y" },
      }),
    ).toBeNull();
    mocks.fetchEarliestDelivery.mockRejectedValueOnce(new Error("down"));
    expect(
      await DeliveryPromiseBand({
        ...base,
        content: { title: "x", body: "y" },
      }),
    ).toBeNull();
  });

  it("omits the band for a malformed date or window rather than printing garbage", async () => {
    mocks.fetchEarliestDelivery.mockResolvedValue({
      date: "soon",
      startTime: "19:00",
      endTime: "22:00",
      label: "x",
      timezone: "Asia/Riyadh",
    });
    expect(
      await DeliveryPromiseBand({ ...base, content: { title: "", body: "" } }),
    ).toBeNull();
  });
});
