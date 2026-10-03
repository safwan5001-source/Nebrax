import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Offer } from "@/lib/commerce/offers";

function offer(id: string, overrides: Partial<Offer> = {}): Offer {
  return {
    id,
    productId: `p-${id}`,
    name: `منتج ${id}`,
    thumbnailUrl: null,
    referencePrice: { amountMinor: 25000, currency: "SAR", display: "250 ر.س" },
    offerPrice: { amountMinor: 19000, currency: "SAR", display: "190 ر.س" },
    discountPercent: 24,
    ...overrides,
  };
}

// Every props object the shelf hands to a card, to prove nothing non-serializable
// (a function) ever crosses the server → client component boundary.
const propsSeen: Array<Record<string, unknown>> = [];

async function loadShelf(
  fetchOffers: ReturnType<typeof vi.fn>,
  offerIds: string[] = ["o1"],
) {
  vi.resetModules();
  vi.doMock("@/components/products/OfferCard", () => ({
    OfferCard: (props: { offer: Offer; basePath: string }) => {
      propsSeen.push(props);
      const { offer: o, basePath } = props;
      return (
        <div
          data-testid="offer-card"
          data-id={o.id}
          data-product={o.productId}
          data-base-path={basePath}
          data-percent={o.discountPercent}
        />
      );
    },
  }));
  vi.doMock("@/lib/commerce/offers", () => ({ fetchOffers }));
  const { OffersShelf } = await import("@/components/home/OffersShelf");
  return OffersShelf({
    offerIds,
    basePath: "/sa/ar",
    title: "العروض",
    headingId: "offers-s1",
  });
}

function ids(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-testid=offer-card]")).map(
    (el) => (el as HTMLElement).dataset.id as string,
  );
}

describe("OffersShelf — CUST-H4-7 public read + stored order", () => {
  it("passes only serializable props to the client OfferCard (no function may cross the server→client boundary)", async () => {
    propsSeen.length = 0;
    const fetchOffers = vi.fn().mockResolvedValue([offer("o1"), offer("o2")]);
    render((await loadShelf(fetchOffers, ["o1", "o2"])) as React.JSX.Element);
    expect(propsSeen).toHaveLength(2);
    for (const props of propsSeen) {
      expect(Object.keys(props).sort()).toEqual(["basePath", "offer"]);
      // JSON round-trip is lossless only for serializable data.
      expect(JSON.parse(JSON.stringify(props))).toEqual(props);
    }
  });

  it("reads once, filters to the selected ids and renders the section with an aria-labelledby heading", async () => {
    const fetchOffers = vi.fn().mockResolvedValue([offer("o1"), offer("o2")]);
    const { container } = render(
      (await loadShelf(fetchOffers, ["o1"])) as React.JSX.Element,
    );

    expect(fetchOffers).toHaveBeenCalledTimes(1);
    expect(fetchOffers).toHaveBeenCalledWith();
    expect(ids(container)).toEqual(["o1"]);
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("offers-s1");
    expect(container.querySelector("h2#offers-s1")?.textContent).toBe("العروض");
  });

  it("restores the merchant-stored offerIds order even when the API answers in database order", async () => {
    const fetchOffers = vi
      .fn()
      .mockResolvedValue([offer("o2"), offer("o3"), offer("o1")]);
    const { container } = render(
      (await loadShelf(fetchOffers, ["o1", "o2", "o3"])) as React.JSX.Element,
    );
    expect(ids(container)).toEqual(["o1", "o2", "o3"]);
  });

  it("omits a stored id the API did not return (not live / deleted) with no placeholder and no gap", async () => {
    const fetchOffers = vi.fn().mockResolvedValue([offer("o1"), offer("o3")]);
    const { container } = render(
      (await loadShelf(fetchOffers, ["o1", "o2", "o3"])) as React.JSX.Element,
    );
    expect(ids(container)).toEqual(["o1", "o3"]);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("never shows a live offer the merchant did not select", async () => {
    const fetchOffers = vi
      .fn()
      .mockResolvedValue([offer("o1"), offer("extra")]);
    const { container } = render(
      (await loadShelf(fetchOffers, ["o1"])) as React.JSX.Element,
    );
    expect(ids(container)).toEqual(["o1"]);
  });

  it("passes the backend discount_percent through untouched to each card", async () => {
    const fetchOffers = vi
      .fn()
      .mockResolvedValue([
        offer("o1", { discountPercent: 61 }),
        offer("o2", { discountPercent: 0 }),
      ]);
    const { container } = render(
      (await loadShelf(fetchOffers, ["o1", "o2"])) as React.JSX.Element,
    );
    const percents = Array.from(
      container.querySelectorAll("[data-testid=offer-card]"),
    ).map((el) => (el as HTMLElement).dataset.percent);
    expect(percents).toEqual(["61", "0"]);
  });

  it("links through the locale base path", async () => {
    const fetchOffers = vi.fn().mockResolvedValue([offer("o1")]);
    const { container } = render(
      (await loadShelf(fetchOffers)) as React.JSX.Element,
    );
    expect(
      (container.querySelector("[data-testid=offer-card]") as HTMLElement)
        .dataset.basePath,
    ).toBe("/sa/ar");
  });

  it("omits the whole section when no selected offer is live", async () => {
    expect(
      await loadShelf(vi.fn().mockResolvedValue([offer("other")]), [
        "o1",
        "o2",
      ]),
    ).toBeNull();
    expect(await loadShelf(vi.fn().mockResolvedValue([]), ["o1"])).toBeNull();
  });

  it("omits the whole section when the request fails entirely (like every other optional section)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const element = await loadShelf(
      vi.fn().mockRejectedValue(new Error("network down")),
      ["o1"],
    );
    expect(element).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("uses the grid used by the other published shelves (two columns on mobile) and never overflows its cell", async () => {
    const fetchOffers = vi.fn().mockResolvedValue([offer("o1")]);
    const { container } = render(
      (await loadShelf(fetchOffers)) as React.JSX.Element,
    );
    const list = container.querySelector("ul") as HTMLElement;
    expect(list.className).toContain("grid-cols-2");
    expect(list.className).toContain("lg:grid-cols-4");
    expect(container.querySelector("li")?.className).toContain("min-w-0");
  });
});
