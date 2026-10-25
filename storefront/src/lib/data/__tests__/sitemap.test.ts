// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  host: undefined as string | undefined,
  proto: undefined as string | undefined,
  throws: false,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (request.throws) throw new Error("outside a request scope");
    const h = new Headers();
    if (request.host) h.set("host", request.host);
    if (request.proto) h.set("x-forwarded-proto", request.proto);
    return h;
  },
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { StorefrontApiError } from "@/lib/commerce/config";
import {
  describeSitemapFailure,
  getSitemapCategories,
  getSitemapProductPage,
  resolveSitemapBaseUrl,
  SitemapSourceError,
} from "@/lib/data/sitemap";

const API = "https://api.awj.test";
const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function listing(data: unknown[], total: number) {
  return {
    data,
    meta: {
      request_id: "r",
      pagination: {
        page: 1,
        per_page: 100,
        total,
        last_page: 1,
        has_more: false,
      },
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AWJ_COMMERCE_API_URL", API);
  vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
  request.host = "shop.example.sa";
  request.proto = undefined;
  request.throws = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getSitemapProductPage", () => {
  it("reads store/v1/products with page and per_page only, forwarding the visitor host", async () => {
    fetchMock.mockResolvedValue(ok(listing([], 0)));

    await getSitemapProductPage(3, 100);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(`${API}/store/v1/products`);
    expect([...parsed.searchParams.entries()]).toEqual([
      ["page", "3"],
      ["per_page", "100"],
    ]);
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ "X-Storefront-Forwarded-Host": "shop.example.sa" });
  });

  it("never asks for more than the API's per_page ceiling", async () => {
    fetchMock.mockResolvedValue(ok(listing([], 0)));

    await getSitemapProductPage(1, 5000);

    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("per_page"),
    ).toBe("100");
  });

  it("maps id, updated_at and the renderable primary image, dropping rows without an id", async () => {
    fetchMock.mockResolvedValue(
      ok(
        listing(
          [
            {
              id: "p1",
              updated_at: "2026-01-02T03:04:05+00:00",
              thumbnail_url: "/store/v1/media/m1",
            },
            { id: "p2", updated_at: "garbage", thumbnail_url: null },
            { id: "", name: "no id" },
            { name: "missing id" },
            null,
          ],
          5,
        ),
      ),
    );

    await expect(getSitemapProductPage(1, 100)).resolves.toEqual({
      total: 5,
      items: [
        {
          id: "p1",
          updated_at: "2026-01-02T03:04:05+00:00",
          image_url: "/api/storefront/media/m1",
        },
        { id: "p2", updated_at: null, image_url: null },
      ],
    });
  });

  it.each([
    ["no data array", { data: null, meta: { pagination: { total: 1 } } }],
    ["no pagination", { data: [] }],
    ["negative total", listing([], -1)],
    ["non-numeric total", listing([], "7" as unknown as number)],
  ])("rejects a response with %s", async (_label, body) => {
    fetchMock.mockResolvedValue(ok(body));

    await expect(getSitemapProductPage(1, 100)).rejects.toBeInstanceOf(
      SitemapSourceError,
    );
  });

  it("propagates an API error as StorefrontApiError", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "unavailable", message: "m" } }),
        {
          status: 503,
        },
      ),
    );

    await expect(getSitemapProductPage(1, 100)).rejects.toBeInstanceOf(
      StorefrontApiError,
    );
  });
});

describe("getSitemapCategories", () => {
  it("flattens the tree parents-first, keeps top-level categories and de-duplicates", async () => {
    fetchMock.mockResolvedValue(
      ok({
        data: [
          {
            id: "a",
            parent_id: null,
            children: [
              {
                id: "a1",
                parent_id: "a",
                children: [{ id: "a1x", parent_id: "a1" }],
              },
              { id: "a2", parent_id: "a" },
            ],
          },
          { id: "b", parent_id: null },
          { id: "a2", parent_id: "a" },
          { id: "", parent_id: null },
        ],
        meta: { request_id: "r" },
      }),
    );

    const categories = await getSitemapCategories();

    expect(categories.map((c) => c.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
      "/store/v1/categories",
    );
  });

  it("returns an empty list for a storefront without categories", async () => {
    fetchMock.mockResolvedValue(ok({ data: [], meta: { request_id: "r" } }));

    await expect(getSitemapCategories()).resolves.toEqual([]);
  });

  it("rejects a response with no list", async () => {
    fetchMock.mockResolvedValue(ok({ data: {}, meta: { request_id: "r" } }));

    await expect(getSitemapCategories()).rejects.toBeInstanceOf(
      SitemapSourceError,
    );
  });
});

describe("resolveSitemapBaseUrl", () => {
  it("builds the origin from the request host", async () => {
    request.proto = "https";
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "https://shop.example.sa",
    );
  });

  it("honours the first x-forwarded-proto value, and only http/https", async () => {
    request.proto = "http, https";
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "http://shop.example.sa",
    );
    request.proto = "javascript";
    expect(await resolveSitemapBaseUrl()).toMatch(
      /^https?:\/\/shop\.example\.sa$/,
    );
  });

  it("keeps the configured URL when it is for the same host (canonical agreement)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://Shop.Example.sa/store/");
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "https://shop.example.sa/store",
    );
  });

  it("adds https to a protocol-less configured URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "shop.example.sa");
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "https://shop.example.sa",
    );
  });

  it("prefers the request host over a configured URL for another host", async () => {
    request.proto = "https";
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://other.example.sa");
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "https://shop.example.sa",
    );
  });

  it("falls back to the configured URL when there is no usable request host", async () => {
    request.host = undefined;
    vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "prod.example.sa");
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "https://prod.example.sa",
    );

    request.throws = true;
    await expect(resolveSitemapBaseUrl()).resolves.toBe(
      "https://prod.example.sa",
    );
  });

  it.each([
    'evil.example/"><x>',
    "a b.example",
    "-bad.example",
    "host:99999999",
    "x".repeat(300),
  ])("ignores the malformed host %j", async (host) => {
    request.host = host;
    await expect(resolveSitemapBaseUrl()).resolves.toBeUndefined();
  });

  it("is undefined when neither a host nor a configured URL exists", async () => {
    request.host = undefined;
    await expect(resolveSitemapBaseUrl()).resolves.toBeUndefined();
  });

  it("ignores a configured URL with an unsupported protocol", async () => {
    request.host = undefined;
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "ftp://x.example");
    // ensureProtocol keeps "ftp://" as-is only if it starts with http(s); otherwise prefixes https
    expect(await resolveSitemapBaseUrl()).not.toMatch(/^ftp:/);
  });
});

describe("describeSitemapFailure", () => {
  it("logs status and code for an API error, never its message or details", () => {
    const error = new StorefrontApiError(
      503,
      "internal",
      "SQLSTATE[08006] db-internal.awj.local",
      { secret: "SECRET_TOKEN_123" },
    );

    const description = describeSitemapFailure(error);

    expect(description).toBe("AWJ API 503 (internal)");
    expect(description).not.toMatch(/SQLSTATE|SECRET|db-internal/);
  });

  it("describes other failures bounded and without crashing on non-errors", () => {
    expect(
      describeSitemapFailure(new Error("x".repeat(1000))).length,
    ).toBeLessThanOrEqual(300);
    expect(describeSitemapFailure("boom")).toBe("unknown error");
  });
});
