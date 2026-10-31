// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  createFakeAwj,
  type FakeBackend,
  type FakeCategory,
  manyProducts,
} from "./__tests__/fake-awj-catalog";

/**
 * X3 — the sitemap is produced from AWJ `store/v1` only.
 *
 * The real data layer runs against a fake AWJ backend (fetch is the only seam).
 * There is no Spree client left in the codebase to reach; the sitemap must still
 * build with every SPREE_* variable unset. Tenant selection is by the request
 * Host alone, as in production.
 */
const request = vi.hoisted(() => ({
  host: undefined as string | undefined,
  proto: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
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

const HOST_A = "shop-a.example.sa";
const HOST_B = "shop-b.example.sa";
const API = "https://api.awj.test";
const LEAK = /spree|SQLSTATE|SECRET_TOKEN|db-internal|AWJ_COMMERCE_API_URL/i;

let errorLog: MockInstance;
let warnLog: MockInstance;

function useBackend(backend: FakeBackend) {
  const fake = createFakeAwj(backend);
  vi.stubGlobal("fetch", fake.fetchMock);
  return fake;
}

function tree(...roots: Array<[string, string[]]>): FakeCategory[] {
  return roots.map(([id, childIds]) => ({
    id,
    parent_id: null,
    children: childIds.map((childId) => ({ id: childId, parent_id: id })),
  }));
}

async function loadRoute() {
  return import("@/app/sitemap");
}

async function allUrls(): Promise<string[]> {
  const { default: sitemap, generateSitemaps } = await loadRoute();
  const chunks = await generateSitemaps();
  const urls: string[] = [];
  for (const { id } of chunks) {
    const entries = await sitemap({ id: Promise.resolve(String(id)) });
    expect(entries.length).toBeLessThanOrEqual(10_000);
    urls.push(...entries.map((entry) => entry.url));
  }
  return urls;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(process.env)) {
    if (/^(NEXT_PUBLIC_)?SPREE_/.test(key)) vi.stubEnv(key, undefined as never);
  }
  vi.stubEnv("AWJ_COMMERCE_API_URL", API);
  vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "");
  // Functional tests are not about the rate budget (see "upstream rate budget").
  vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "1000000");
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "sa");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
  request.host = HOST_A;
  request.proto = "https";
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errorLog.mockRestore();
  warnLog.mockRestore();
});

describe("no Spree dependency", () => {
  it("builds the sitemap with every SPREE_* variable unset and never touches a Spree client", async () => {
    const fake = useBackend({
      [HOST_A]: { products: manyProducts(3), categories: tree(["c1", []]) },
    });
    const { default: sitemap, generateSitemaps } = await loadRoute();

    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }]);
    const entries = await sitemap({ id: Promise.resolve("0") });

    expect(entries.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(["storefront", "products", "categories"]).toContain(call.path);
    }
    for (const call of fake.fetchMock.mock.calls) {
      expect(String(call[0]).startsWith(`${API}/store/v1/`)).toBe(true);
    }
  });
});

describe("URLs and tenant isolation", () => {
  it("lists both locales of the single Saudi market under the request host", async () => {
    useBackend({
      [HOST_A]: {
        products: [{ id: "prod-1", updated_at: "2026-03-04T05:06:07+00:00" }],
        categories: tree(["cat-1", ["cat-2"]]),
      },
    });
    const { default: sitemap } = await loadRoute();

    const entries = await sitemap({ id: Promise.resolve("0") });
    const urls = entries.map((entry) => entry.url);

    expect(urls).toEqual([
      `https://${HOST_A}/sa/ar`,
      `https://${HOST_A}/sa/ar/products`,
      `https://${HOST_A}/sa/ar/c/cat-1`,
      `https://${HOST_A}/sa/ar/c/cat-2`,
      `https://${HOST_A}/sa/ar/products/prod-1`,
      `https://${HOST_A}/sa/en`,
      `https://${HOST_A}/sa/en/products`,
      `https://${HOST_A}/sa/en/c/cat-1`,
      `https://${HOST_A}/sa/en/c/cat-2`,
      `https://${HOST_A}/sa/en/products/prod-1`,
    ]);
    expect(entries[4]?.lastModified).toEqual(
      new Date("2026-03-04T05:06:07+00:00"),
    );
    expect(entries[4]).toMatchObject({
      changeFrequency: "weekly",
      priority: 0.6,
    });
  });

  it("uses the tenant's default locale first", async () => {
    useBackend({
      [HOST_A]: { products: [], categories: [], defaultLocale: "en" },
    });
    const { default: sitemap } = await loadRoute();

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );

    expect(urls[0]).toBe(`https://${HOST_A}/sa/en`);
    expect(urls).toContain(`https://${HOST_A}/sa/ar`);
  });

  it("serves each tenant only its own catalog and its own host", async () => {
    const fake = useBackend({
      [HOST_A]: {
        products: [{ id: "a-1" }, { id: "a-2" }],
        categories: tree(["a-cat", []]),
      },
      [HOST_B]: {
        products: [{ id: "b-1" }],
        categories: tree(["b-cat", []]),
      },
    });
    const { default: sitemap } = await loadRoute();

    request.host = HOST_A;
    const a = (await sitemap({ id: Promise.resolve("0") })).map((e) => e.url);
    request.host = HOST_B;
    const b = (await sitemap({ id: Promise.resolve("0") })).map((e) => e.url);

    expect(a.every((url) => url.startsWith(`https://${HOST_A}/`))).toBe(true);
    expect(b.every((url) => url.startsWith(`https://${HOST_B}/`))).toBe(true);
    expect(a.join()).toMatch(/a-1/);
    expect(a.join()).not.toMatch(/b-1|b-cat|shop-b/);
    expect(b.join()).toMatch(/b-1/);
    expect(b.join()).not.toMatch(/a-1|a-2|a-cat|shop-a/);

    // Every backend call carried the host of the request that caused it.
    const hosts = fake.calls.map((call) => call.host);
    expect(new Set(hosts)).toEqual(new Set([HOST_A, HOST_B]));
  });

  it("an unknown host gets no catalog and no URLs", async () => {
    const fake = useBackend({
      [HOST_A]: { products: [{ id: "a-1" }], categories: [] },
    });
    request.host = "unknown.example.sa";
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("0") })).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
    expect(fake.calls.every((call) => call.host === "unknown.example.sa")).toBe(
      true,
    );
  });

  it("keeps the configured store URL (path included) when it is the request host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", `https://${HOST_A}/shop/`);
    useBackend({ [HOST_A]: { products: [{ id: "a-1" }], categories: [] } });
    const { default: sitemap } = await loadRoute();

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );

    expect(urls).toContain(`https://${HOST_A}/shop/sa/ar/products/a-1`);
  });

  it("ignores a configured store URL that belongs to a different host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", `https://${HOST_B}`);
    useBackend({ [HOST_A]: { products: [{ id: "a-1" }], categories: [] } });
    const { default: sitemap } = await loadRoute();

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );

    expect(urls.every((url) => url.startsWith(`https://${HOST_A}/`))).toBe(
      true,
    );
  });
});

describe("published catalog only", () => {
  it("lists exactly what the public API returns — hidden and draft products never appear", async () => {
    // The backend's publish gate is what keeps hidden/draft rows out of the
    // listing; the sitemap must add nothing of its own and ask for no detail rows.
    const fake = useBackend({
      [HOST_A]: {
        products: [{ id: "published-1" }, { id: "published-2" }],
        categories: tree(["published-cat", []]),
      },
    });
    const urls = await allUrls();

    expect(urls.filter((url) => url.includes("/products/"))).toHaveLength(4);
    expect(urls.join()).not.toMatch(/draft|hidden/);
    for (const call of fake.callsTo("products")) {
      expect([...call.query.keys()].sort()).toEqual(["page", "per_page"]);
    }
  });

  it("includes top-level categories and de-duplicates a category repeated in the tree", async () => {
    useBackend({
      [HOST_A]: {
        products: [],
        categories: [
          ...tree(["root", ["child"]]),
          { id: "child", parent_id: "root" },
        ],
      },
    });
    const { default: sitemap } = await loadRoute();

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );

    const arCategories = urls.filter((url) => url.includes("/sa/ar/c/"));
    expect(arCategories).toEqual([
      `https://${HOST_A}/sa/ar/c/root`,
      `https://${HOST_A}/sa/ar/c/child`,
    ]);
  });

  it("emits the primary image as an absolute same-origin URL, only when one exists", async () => {
    useBackend({
      [HOST_A]: {
        products: [
          { id: "with-image", thumbnail_url: "/store/v1/media/m-1" },
          { id: "without-image", thumbnail_url: null },
        ],
        categories: [],
      },
    });
    const { default: sitemap } = await loadRoute();

    const entries = await sitemap({ id: Promise.resolve("0") });
    const withImage = entries.find((e) =>
      e.url.endsWith("/ar/products/with-image"),
    );
    const without = entries.find((e) =>
      e.url.endsWith("/ar/products/without-image"),
    );

    expect(withImage?.images).toEqual([
      `https://${HOST_A}/api/storefront/media/m-1`,
    ]);
    expect(without && "images" in without).toBe(false);
  });

  it("omits lastModified for a missing or invalid timestamp instead of inventing one", async () => {
    useBackend({
      [HOST_A]: {
        products: [
          { id: "bad", updated_at: "not-a-date" },
          { id: "none", updated_at: null },
        ],
        categories: [],
      },
    });
    const { default: sitemap } = await loadRoute();

    const entries = await sitemap({ id: Promise.resolve("0") });

    const products = entries.filter((e) => e.url.includes("/ar/products/"));
    expect(products).toHaveLength(2);
    for (const entry of products) expect(entry.lastModified).toBeUndefined();
  });

  it("lists only routes that exist: home and /products, not the page-less /c", async () => {
    useBackend({ [HOST_A]: { products: [], categories: [] } });
    const { default: sitemap } = await loadRoute();

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );

    expect(urls).toEqual([
      `https://${HOST_A}/sa/ar`,
      `https://${HOST_A}/sa/ar/products`,
      `https://${HOST_A}/sa/en`,
      `https://${HOST_A}/sa/en/products`,
    ]);
    const storefront = resolve(__dirname, "[country]/[locale]/(storefront)");
    expect(existsSync(resolve(storefront, "products/page.tsx"))).toBe(true);
    expect(existsSync(resolve(storefront, "c/page.tsx"))).toBe(false);
    expect(existsSync(resolve(storefront, "c/[...permalink]/page.tsx"))).toBe(
      true,
    );
  });
});

describe("pagination", () => {
  it("never omits or duplicates a published item across files", async () => {
    const products = manyProducts(10_500);
    useBackend({
      [HOST_A]: { products, categories: tree(["c1", ["c2", "c3"]]) },
    });

    const urls = await allUrls();

    // 2 locales × (home + products + 3 categories + 10,500 products)
    expect(urls).toHaveLength(2 * (2 + 3 + 10_500));
    expect(new Set(urls).size).toBe(urls.length);
    for (const locale of ["ar", "en"]) {
      for (const product of [products[0], products[5000], products[10_499]]) {
        expect(urls).toContain(
          `https://${HOST_A}/sa/${locale}/products/${product.id}`,
        );
      }
      expect(urls).toContain(`https://${HOST_A}/sa/${locale}/c/c3`);
    }
  });

  it("splits the index into fixed 5-page files", async () => {
    useBackend({
      [HOST_A]: { products: manyProducts(30_000), categories: [] },
    });
    const { generateSitemaps } = await loadRoute();

    // 30,000 products / (5 pages × 100) = 60 files
    const files = await generateSitemaps();
    expect(files).toHaveLength(60);
    expect(files.at(-1)).toEqual({ id: 59 });
  });

  it("an index for exactly one page boundary has no empty trailing file", async () => {
    useBackend({
      [HOST_A]: { products: manyProducts(500), categories: [] },
    });
    const { generateSitemaps } = await loadRoute();

    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }]);
  });

  it("reads only a single product row to count, and no catalog page, for the index", async () => {
    const fake = useBackend({
      [HOST_A]: { products: manyProducts(30_000), categories: [] },
    });
    const { generateSitemaps } = await loadRoute();

    await generateSitemaps();

    const productCalls = fake.callsTo("products");
    expect(productCalls).toHaveLength(1);
    expect(productCalls[0].query.get("per_page")).toBe("1");
    expect(fake.callsTo("categories")).toHaveLength(0);
  });

  it("file k lists exactly product pages 5k+1..5k+5, and nothing else", async () => {
    const fake = useBackend({
      [HOST_A]: { products: manyProducts(30_000), categories: [] },
    });
    const { default: sitemap } = await loadRoute();

    const entries = await sitemap({ id: Promise.resolve("2") });
    const pages = fake
      .callsTo("products")
      .map((call) => Number(call.query.get("page")));

    // 500 products × 2 locales; file 2 starts at product index 1000
    expect(entries).toHaveLength(1000);
    expect(entries[0]?.url).toBe(`https://${HOST_A}/sa/ar/products/p-1000`);
    expect(entries.at(-1)?.url).toBe(`https://${HOST_A}/sa/en/products/p-1499`);
    expect(new Set(pages)).toEqual(new Set([11, 12, 13, 14, 15]));
    expect(pages).toHaveLength(5);
    expect(fake.callsTo("categories")).toHaveLength(0);
    for (const call of fake.callsTo("products")) {
      expect(call.query.get("per_page")).toBe("100");
    }
  });

  it("file 0 carries the statics and categories; later files do not", async () => {
    useBackend({
      [HOST_A]: { products: manyProducts(600), categories: tree(["c1", []]) },
    });
    const { default: sitemap } = await loadRoute();

    const first = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );
    const second = (await sitemap({ id: Promise.resolve("1") })).map(
      (e) => e.url,
    );

    expect(first).toContain(`https://${HOST_A}/sa/ar`);
    expect(first).toContain(`https://${HOST_A}/sa/ar/c/c1`);
    expect(second).toHaveLength(200);
    expect(second[0]).toBe(`https://${HOST_A}/sa/ar/products/p-500`);
    expect(second.every((url) => url.includes("/products/p-"))).toBe(true);
  });

  it("answers an id past the last addressable file without asking the API", async () => {
    const fake = useBackend({
      [HOST_A]: { products: manyProducts(10), categories: [] },
    });
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("200") })).resolves.toEqual([]);
    expect(fake.fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty file when the catalog shrank below the requested files", async () => {
    useBackend({
      [HOST_A]: { products: manyProducts(10), categories: [] },
    });
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("7") })).resolves.toEqual([]);
  });

  it("reads the catalog once per request, shared by both locales, and the category tree once", async () => {
    const fake = useBackend({
      [HOST_A]: { products: manyProducts(250), categories: tree(["c1", []]) },
    });
    const { default: sitemap } = await loadRoute();

    await sitemap({ id: Promise.resolve("0") });

    expect(fake.callsTo("categories")).toHaveLength(1);
    expect(fake.callsTo("storefront")).toHaveLength(1);
    // pages 1..5 are requested (a fixed, pre-reserved cost); 3 hold data
    expect(fake.callsTo("products")).toHaveLength(5);
  });

  it("does not retain catalog pages between requests", async () => {
    const fake = useBackend({
      [HOST_A]: { products: manyProducts(1), categories: [] },
    });
    const { default: sitemap } = await loadRoute();

    await sitemap({ id: Promise.resolve("0") });
    await sitemap({ id: Promise.resolve("0") });

    expect(fake.callsTo("products")).toHaveLength(10);
  });

  it("announces — never silently drops — products beyond what this route can list", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(1), categories: [] },
    });
    const real = fake.fetchMock.getMockImplementation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const response = await real?.(input, init);
        if (new URL(String(input)).pathname.endsWith("/products")) {
          const body = await response?.json();
          body.meta.pagination.total = 150_000;
          return new Response(JSON.stringify(body), { status: 200 });
        }
        return response as Response;
      }),
    );
    const { generateSitemaps } = await loadRoute();

    // 100,000 listable products / 500 per file = 200 files
    expect((await generateSitemaps()).length).toBe(200);
    expect(warnLog).toHaveBeenCalledWith(
      expect.stringMatching(/150000.*omitted/),
    );
  });

  it("warns when a product page comes back short", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(150), categories: [] },
    });
    const real = fake.fetchMock.getMockImplementation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const response = await real?.(input, init);
        const url = new URL(String(input));
        if (
          url.pathname.endsWith("/products") &&
          url.searchParams.get("page") === "2"
        ) {
          const body = await response?.json();
          body.data = body.data.slice(0, 10);
          return new Response(JSON.stringify(body), { status: 200 });
        }
        return response as Response;
      }),
    );
    const { default: sitemap } = await loadRoute();

    await sitemap({ id: Promise.resolve("0") });

    expect(warnLog).toHaveBeenCalledWith(
      expect.stringMatching(/page 2 returned 10 of 50/),
    );
  });
});

describe("empty storefront", () => {
  it("serves the static pages only and a single index file", async () => {
    useBackend({ [HOST_A]: { products: [], categories: [] } });
    const { default: sitemap, generateSitemaps } = await loadRoute();

    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }]);
    expect(await sitemap({ id: Promise.resolve("0") })).toHaveLength(4);
    expect(await sitemap({ id: Promise.resolve("1") })).toEqual([]);
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe("AWJ API failure", () => {
  const failing: FakeBackend = { [HOST_A]: { status: 503 } };

  it("fails the chunk with a generic error and logs only status/code server-side", async () => {
    useBackend(failing);
    const { default: sitemap } = await loadRoute();

    const failure = await sitemap({ id: Promise.resolve("0") }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Sitemap is temporarily unavailable.",
    );
    expect((failure as Error).message).not.toMatch(LEAK);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("AWJ API 503 (internal)"),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(LEAK);
  });

  it("does not turn a failed product read into a 200 sitemap without products", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(150), categories: tree(["c1", []]) },
    });
    const real = fake.fetchMock.getMockImplementation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.pathname.endsWith("/products") &&
          url.searchParams.get("page") === "2"
        ) {
          return new Response("{}", { status: 500 });
        }
        return real?.(input, init) as Promise<Response>;
      }),
    );
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("0") })).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
  });

  it("rejects a malformed catalog response without echoing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/storefront")) {
          return new Response(
            JSON.stringify({ data: { default_locale: "ar" } }),
          );
        }
        return new Response(JSON.stringify({ data: "SECRET_TOKEN_123" }));
      }),
    );
    const { default: sitemap } = await loadRoute();

    const failure = await sitemap({ id: Promise.resolve("0") }).catch(
      (error: unknown) => error,
    );

    expect((failure as Error).message).toBe(
      "Sitemap is temporarily unavailable.",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/SECRET_TOKEN/);
  });

  it("the index throws (retryable) instead of declaring a partial file list", async () => {
    useBackend(failing);
    const { generateSitemaps } = await loadRoute();

    await expect(generateSitemaps()).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(LEAK);
  });

  it("only during `next build` does the index fall back to one file", async () => {
    useBackend(failing);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { generateSitemaps } = await loadRoute();

    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }]);
  });

  it("reports a missing API configuration without leaking it in the thrown error", async () => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "");
    vi.stubGlobal("fetch", vi.fn());
    const { default: sitemap } = await loadRoute();

    const failure = await sitemap({ id: Promise.resolve("0") }).catch(
      (error: unknown) => error,
    );

    expect((failure as Error).message).toBe(
      "Sitemap is temporarily unavailable.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails (generic) when the request has no usable host and no configured URL", async () => {
    useBackend({ [HOST_A]: { products: [], categories: [] } });
    request.host = undefined;
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("0") })).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
  });
});

describe("request validation", () => {
  it("rejects invalid chunk identifiers before loading any data", async () => {
    const fake = useBackend({ [HOST_A]: { products: [], categories: [] } });
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("-1") })).resolves.toEqual([]);
    await expect(sitemap({ id: Promise.resolve("invalid") })).resolves.toEqual(
      [],
    );
    expect(fake.fetchMock).not.toHaveBeenCalled();
  });

  it("never reflects a malformed Host header into URLs", async () => {
    useBackend({ [HOST_A]: { products: [], categories: [] } });
    request.host = 'evil.example/"><script>';
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("0") })).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
  });

  it("defaults to https in production when no forwarded protocol is present", async () => {
    vi.stubEnv("NODE_ENV", "production");
    request.proto = undefined;
    useBackend({ [HOST_A]: { products: [], categories: [] } });
    const { default: sitemap } = await loadRoute();

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (e) => e.url,
    );

    expect(urls[0]).toBe(`https://${HOST_A}/sa/ar`);
  });
});
