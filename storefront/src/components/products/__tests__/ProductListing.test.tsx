import type { ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { GiftingFilters } from "@/components/products/GiftingFilters";
import { InfiniteProductList } from "@/components/products/InfiniteProductList";
import { ListingAnalytics } from "@/components/products/ListingAnalytics";
import { ProductListing } from "@/components/products/ProductListing";
import type { StorefrontListParams } from "@/lib/utils/listing-context";
import { parseListingSearchParams } from "@/lib/utils/listing-search-params";

const product = { id: "p1", name: "Rose" };

function find(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return find((node.props as { children?: ReactNode }).children, type);
}

async function renderInner(
  baseParams?: StorefrontListParams,
  extra: {
    listingFacets?: unknown;
    fetchDeliverTodayAvailable?: () => Promise<boolean>;
  } = {},
) {
  const outer = ProductListing({
    state: parseListingSearchParams({}),
    basePath: "/products",
    currency: "SAR",
    locale: "en" as never,
    listId: "all",
    listName: "All",
    baseParams,
    fetchProducts: async () =>
      ({
        data: [product],
        meta: {
          count: 1,
          pages: 1,
          ...(extra.listingFacets
            ? { listingFacets: extra.listingFacets }
            : {}),
        },
      }) as never,
    fetchFilters: async () => ({}) as never,
    fetchDeliverTodayAvailable: extra.fetchDeliverTodayAvailable,
  });
  const inner = (outer.props as { children: ReactElement }).children;
  const Fn = inner.type as (p: unknown) => Promise<ReactElement>;
  return Fn(inner.props);
}

describe("ProductListing catalog context identity", () => {
  it("changes the analytics key and the island key together when only the catalog context changes", async () => {
    const a = await renderInner(undefined);
    const b = await renderInner({
      collection: "roses",
    } as StorefrontListParams);

    const analyticsA = find(a, ListingAnalytics)?.props as { stateKey: string };
    const analyticsB = find(b, ListingAnalytics)?.props as { stateKey: string };
    expect(analyticsA.stateKey).not.toBe(analyticsB.stateKey);

    const islandA = find(a, InfiniteProductList);
    const islandB = find(b, InfiniteProductList);
    expect(islandA?.key).toBe(analyticsA.stateKey);
    expect(islandB?.key).toBe(analyticsB.stateKey);
  });

  it("keeps the analytics key stable for an identical context", async () => {
    const a = await renderInner({
      collection: "roses",
    } as StorefrontListParams);
    const b = await renderInner({
      collection: "roses",
    } as StorefrontListParams);
    expect(
      (find(a, ListingAnalytics)?.props as { stateKey: string }).stateKey,
    ).toBe((find(b, ListingAnalytics)?.props as { stateKey: string }).stateKey);
  });

  it("hands page-1 facet counts and the delivery capability to the gifting filters", async () => {
    const facets = {
      groups: [
        { key: "occasion", systemKey: "occasion", name: "O", values: [] },
      ],
      brands: [],
    };
    const tree = await renderInner(undefined, {
      listingFacets: facets,
      fetchDeliverTodayAvailable: async () => true,
    });
    const props = find(tree, GiftingFilters)?.props as {
      facets: unknown;
      deliverTodayAvailable: boolean;
    };
    expect(props.facets).toBe(facets);
    expect(props.deliverTodayAvailable).toBe(true);
  });

  it("renders empty facets and no Deliver today when the fetchers provide neither or fail", async () => {
    const none = await renderInner();
    const noneProps = find(none, GiftingFilters)?.props as {
      facets: { groups: unknown[]; brands: unknown[] };
      deliverTodayAvailable: boolean;
    };
    expect(noneProps.facets).toEqual({ groups: [], brands: [] });
    expect(noneProps.deliverTodayAvailable).toBe(false);

    const failing = await renderInner(undefined, {
      fetchDeliverTodayAvailable: async () => {
        throw new Error("down");
      },
    });
    expect(
      (
        find(failing, GiftingFilters)?.props as {
          deliverTodayAvailable: boolean;
        }
      ).deliverTodayAvailable,
    ).toBe(false);
  });
});
