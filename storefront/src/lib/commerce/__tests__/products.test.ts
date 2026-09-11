import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AwjListResponse,
  AwjProduct,
  AwjResourceResponse,
} from "../types";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ host: "shop.example.com" })),
  getLocaleOptions: vi.fn(async () => ({ locale: "ar", country: "sa" })),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/spree", () => ({ getLocaleOptions: mocks.getLocaleOptions }));

const { StorefrontApiError } = await import("../config");
const { fetchProduct, fetchProductFilters, fetchProducts } = await import(
  "../products"
);

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function sampleAwjProduct(overrides: Partial<AwjProduct> = {}): AwjProduct {
  return {
    id: "p1",
    name: "منتج",
    name_en: "Product",
    description: null,
    sku: "SKU-1",
    category: null,
    price: { amount_minor: 5000, currency: "SAR" },
    in_stock: true,
    thumbnail_url: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("commerce/products", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal("fetch", vi.fn());
    mocks.headers.mockClear();
    mocks.getLocaleOptions.mockClear();
    mocks.getLocaleOptions.mockResolvedValue({ locale: "ar", country: "sa" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches a product list and maps pagination + items", async () => {
    const body: AwjListResponse<AwjProduct> = {
      data: [sampleAwjProduct(), sampleAwjProduct({ id: "p2" })],
      meta: {
        request_id: "req-1",
        pagination: {
          page: 1,
          per_page: 12,
          total: 2,
          last_page: 1,
          has_more: false,
        },
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchProducts({ limit: 12, page: 1 });

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe("p1");
    expect(result.meta).toEqual({
      page: 1,
      limit: 12,
      count: 2,
      pages: 1,
      from: 1,
      to: 2,
      in: 2,
      previous: null,
      next: null,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(
      "http://awj-api.test/store/v1/products?page=1&per_page=12",
    );
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Forwarded-Host"],
    ).toBe("shop.example.com");
  });

  it("returns an empty list without error when there are no results", async () => {
    const body: AwjListResponse<AwjProduct> = {
      data: [],
      meta: {
        request_id: "req-2",
        pagination: {
          page: 1,
          per_page: 12,
          total: 0,
          last_page: 1,
          has_more: false,
        },
      },
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchProducts(undefined);

    expect(result.data).toEqual([]);
    expect(result.meta.count).toBe(0);
    expect(result.meta.from).toBe(0);
    expect(result.meta.to).toBe(0);
  });

  it("translates Spree sort ids into the AWJ API's sort columns", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: [],
        meta: {
          request_id: "r",
          pagination: {
            page: 1,
            per_page: 12,
            total: 0,
            last_page: 1,
            has_more: false,
          },
        },
      }),
    );

    await fetchProducts({ sort: "-price" });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("sort=-sale_price");
  });

  it("fetches a single product by id", async () => {
    const body: AwjResourceResponse<AwjProduct> = {
      data: sampleAwjProduct({ id: "p42", sku: "SKU-42" }),
      meta: { request_id: "req-3" },
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    const product = await fetchProduct("p42");

    expect(product.id).toBe("p42");
    expect(product.default_variant?.sku).toBe("SKU-42");
  });

  it("displays the English name when the visitor locale is English (COM-7-P2B)", async () => {
    mocks.getLocaleOptions.mockResolvedValue({ locale: "en", country: "sa" });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: sampleAwjProduct({ name: "منتج", name_en: "Product" }),
        meta: { request_id: "req-en" },
      }),
    );

    const product = await fetchProduct("p1");

    expect(product.name).toBe("Product");
  });

  it("keeps the Arabic name when the visitor locale is Arabic, even if name_en exists", async () => {
    mocks.getLocaleOptions.mockResolvedValue({ locale: "ar", country: "sa" });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: sampleAwjProduct({ name: "منتج", name_en: "Product" }),
        meta: { request_id: "req-ar" },
      }),
    );

    const product = await fetchProduct("p1");

    expect(product.name).toBe("منتج");
  });

  it("falls back to the Arabic name in English when no name_en is set", async () => {
    mocks.getLocaleOptions.mockResolvedValue({ locale: "en", country: "sa" });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: sampleAwjProduct({ name: "منتج", name_en: null }),
        meta: { request_id: "req-en-fallback" },
      }),
    );

    const product = await fetchProduct("p1");

    expect(product.name).toBe("منتج");
  });

  it("throws a StorefrontApiError on a non-ok response instead of returning malformed data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "not_found", message: "المنتج غير موجود." } },
        false,
        404,
      ),
    );

    const failure = fetchProduct("missing");
    await expect(failure).rejects.toBeInstanceOf(StorefrontApiError);
    await expect(failure).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("falls back to a generic error when the error body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(fetchProduct("x")).rejects.toMatchObject({
      status: 500,
      code: "http_error",
    });
  });

  it("returns an empty facet list (AWJ has no faceted search yet)", async () => {
    const filters = await fetchProductFilters();

    expect(filters.filters).toEqual([]);
    expect(filters.sort_options.map((s) => s.id)).toEqual([
      "name",
      "-name",
      "price",
      "-price",
    ]);
  });
});
