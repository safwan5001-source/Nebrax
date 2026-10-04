import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AwjProduct } from "../types";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
  getLocale: vi.fn(async () => "ar"),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next-intl/server", () => ({ getLocale: mocks.getLocale }));

const {
  discoveryListingParams,
  fetchDiscoveryValues,
  fetchEarliestDelivery,
  fetchShelfProducts,
  shelfListingParams,
} = await import("../data-sections");
const { fetchProducts } = await import("../products");

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function product(id: string): AwjProduct {
  return {
    id,
    name: `منتج ${id}`,
    name_en: `Product ${id}`,
    description: null,
    sku: null,
    category: null,
    price: { amount_minor: 5000, currency: "SAR" },
    in_stock: true,
    thumbnail_url: null,
    created_at: null,
    updated_at: null,
  };
}

const B1 = "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e";

const pagination = {
  page: 1,
  per_page: 8,
  total: 1,
  last_page: 1,
  has_more: false,
};

describe("commerce/data-sections — FLOWERS-H9b", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
    vi.stubGlobal("fetch", fetchMock);
    mocks.getLocale.mockResolvedValue("ar");
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("productShelf", () => {
    it("maps a source to the public list query and the matching listing deep link", () => {
      expect(
        shelfListingParams({
          source: { kind: "collection", slug: "best-sellers" },
          deliverToday: false,
        }),
      ).toEqual({ collection: "best-sellers" });
      expect(
        shelfListingParams({
          source: { kind: "facet", key: "occasion", value: "eid" },
          deliverToday: true,
        }),
      ).toEqual({ "facet[occasion]": "eid", deliver_today: "true" });
      expect(shelfListingParams({ deliverToday: true })).toEqual({
        deliver_today: "true",
      });
      expect(shelfListingParams({ deliverToday: false })).toEqual({});
    });

    it("requests per_page, the collection and keeps ordinary shelves cacheable", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: [product("a"), product("b")],
          meta: { pagination },
        }),
      );
      const products = await fetchShelfProducts({
        source: { kind: "collection", slug: "best-sellers" },
        deliverToday: false,
        limit: 6,
      });

      expect(products.map((p) => p.id)).toEqual(["a", "b"]);
      const [url, init] = fetchMock.mock.calls[0];
      const query = new URL(url).searchParams;
      expect(new URL(url).pathname).toBe("/store/v1/products");
      expect(query.get("per_page")).toBe("6");
      expect(query.get("collection")).toBe("best-sellers");
      expect(query.has("deliver_today")).toBe(false);
      expect(init.cache).toBeUndefined();
    });

    it("never caches a deliver-today shelf (it depends on the clock, stock and capacity)", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: [], meta: { pagination } }),
      );
      await fetchShelfProducts({ deliverToday: true, limit: 8 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(new URL(url).searchParams.get("deliver_today")).toBe("true");
      expect(init.cache).toBe("no-store");
    });

    it("sends a facet source as the PHP array query", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: [], meta: { pagination } }),
      );
      await fetchShelfProducts({
        source: { kind: "facet", key: "recipient", value: "mom" },
        deliverToday: false,
        limit: 4,
      });
      expect(
        new URL(fetchMock.mock.calls[0][0]).searchParams.get(
          "facet[recipient]",
        ),
      ).toBe("mom");
    });
  });

  describe("discovery", () => {
    const meta = {
      pagination,
      facets: [
        {
          key: "occasion",
          name: "المناسبة",
          name_en: "Occasion",
          values: [
            {
              slug: "eid",
              name: "العيد",
              name_en: "Eid",
              count: 4,
              selected: false,
            },
            {
              slug: "empty",
              name: "فارغ",
              name_en: null,
              count: 0,
              selected: false,
            },
            { slug: "", name: "بلا slug", count: 2 },
            { slug: "no-name", name: "  ", count: 2 },
            { slug: "Bad Slug", name: "رمز غير صالح", count: 2 },
          ],
        },
      ],
      brands: [
        { id: B1, name: "علامة", count: 3, selected: false },
        {
          id: "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6f",
          name: "بلا منتجات",
          count: 0,
          selected: false,
        },
        { id: "not-a-uuid", name: "معرّف غير صالح", count: 5, selected: false },
      ],
    };

    it("reads values and counts from the list meta with one per_page=1 request", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [], meta }));
      const axis = await fetchDiscoveryValues({
        axis: "facet",
        dimension: "occasion",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        new URL(fetchMock.mock.calls[0][0]).searchParams.get("per_page"),
      ).toBe("1");
      expect(axis).toEqual({
        name: "المناسبة",
        options: [{ value: "eid", name: "العيد", count: 4 }],
      });
    });

    it("uses English names under the English locale and falls back to Arabic", async () => {
      mocks.getLocale.mockResolvedValue("en");
      fetchMock.mockResolvedValue(jsonResponse({ data: [], meta }));
      const axis = await fetchDiscoveryValues({
        axis: "facet",
        dimension: "occasion",
      });
      expect(axis?.name).toBe("Occasion");
      expect(axis?.options[0].name).toBe("Eid");
    });

    it("reads the brand axis and drops brands with no products", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [], meta }));
      expect(await fetchDiscoveryValues({ axis: "brand" })).toEqual({
        name: "",
        options: [{ value: B1, name: "علامة", count: 3 }],
      });
    });

    it("is null for an unknown dimension, an empty axis, or a response without facet meta", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [], meta }));
      expect(
        await fetchDiscoveryValues({ axis: "facet", dimension: "nope" }),
      ).toBeNull();
      fetchMock.mockResolvedValue(
        jsonResponse({ data: [], meta: { pagination } }),
      );
      expect(
        await fetchDiscoveryValues({ axis: "facet", dimension: "occasion" }),
      ).toBeNull();
      expect(await fetchDiscoveryValues({ axis: "brand" })).toBeNull();
    });

    it("maps an option to its listing deep link", () => {
      expect(
        discoveryListingParams({ axis: "facet", dimension: "occasion" }, "eid"),
      ).toEqual({
        "facet[occasion]": "eid",
      });
      expect(discoveryListingParams({ axis: "brand" }, B1)).toEqual({
        brand_id: B1,
      });
      // A merchant facet that is literally keyed "brand" is still a facet.
      expect(
        discoveryListingParams({ axis: "facet", dimension: "brand" }, "gucci"),
      ).toEqual({ "facet[brand]": "gucci" });
    });
  });

  describe("deliveryPromise", () => {
    const schedule = {
      enabled: true,
      timezone: "Asia/Riyadh",
      earliest: { date: "2026-10-07", slot_id: "s2" },
      dates: [
        {
          date: "2026-10-07",
          slots: [
            {
              id: "s1",
              label: "صباحاً",
              label_en: "Morning",
              start_time: "09:00",
              end_time: "12:00",
            },
            {
              id: "s2",
              label: "مساءً",
              label_en: "Evening",
              start_time: "19:00",
              end_time: "22:00",
            },
          ],
        },
      ],
    };

    it("returns the earliest selectable window, never cached", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: schedule }));
      expect(await fetchEarliestDelivery()).toEqual({
        date: "2026-10-07",
        startTime: "19:00",
        endTime: "22:00",
        label: "مساءً",
        timezone: "Asia/Riyadh",
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(new URL(url).pathname).toBe("/store/v1/delivery-schedule");
      expect(new URL(url).searchParams.get("method")).toBe("delivery");
      expect(init.cache).toBe("no-store");
    });

    it("is null when scheduling is off, nothing is selectable, or the slot is missing", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: { ...schedule, enabled: false } }),
      );
      expect(await fetchEarliestDelivery()).toBeNull();
      fetchMock.mockResolvedValue(
        jsonResponse({ data: { ...schedule, earliest: null } }),
      );
      expect(await fetchEarliestDelivery()).toBeNull();
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: {
            ...schedule,
            earliest: { date: "2026-10-07", slot_id: "zzz" },
          },
        }),
      );
      expect(await fetchEarliestDelivery()).toBeNull();
    });
  });

  describe("listing deep links reach the public list", () => {
    it("forwards collection, brand, deliver_today and facet entries — and nothing else unknown", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: [], meta: { pagination } }),
      );
      await fetchProducts({
        limit: 12,
        collection: "best-sellers",
        brand_id: "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e",
        deliver_today: true,
        "facet[occasion]": "eid",
        "facet[Bad Key]": "x",
        unknown_param: "y",
      });
      const [url, init] = fetchMock.mock.calls[0];
      const query = new URL(url).searchParams;
      expect(query.get("collection")).toBe("best-sellers");
      expect(query.get("brand_id")).toBe(
        "0b8f9c3e-1d2a-4f6b-9c7d-3e5a1b2c4d6e",
      );
      expect(query.get("deliver_today")).toBe("true");
      expect(query.get("facet[occasion]")).toBe("eid");
      expect(query.has("facet[Bad Key]")).toBe(false);
      expect(query.has("unknown_param")).toBe(false);
      expect(init.cache).toBe("no-store");
    });

    it("does not disable caching for an ordinary listing", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: [], meta: { pagination } }),
      );
      await fetchProducts({ limit: 12 });
      expect(fetchMock.mock.calls[0][1].cache).toBeUndefined();
    });
  });
});
