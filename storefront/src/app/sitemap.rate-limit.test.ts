// @vitest-environment node
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { createFakeAwj, manyProducts } from "./__tests__/fake-awj-catalog";

/**
 * X3 / Codex P1 — the sitemap must live inside the AWJ public API rate budget.
 *
 * Backend facts (app/Http/Middleware/EnforcePublicApiRateLimit.php,
 * app/Support/PublicApiRateLimits.php): `store/v1` catalog routes allow
 * 30 requests per FIXED 60 s window, keyed by sha1(client IP) — the Next.js
 * server's IP — so the budget is shared by every host this server fronts and by
 * all live storefront reads. Excess requests get 429 + Retry-After.
 *
 * The fake backend reproduces that limiter exactly (one window, one key, 429
 * with Retry-After, rejected requests do not extend the window). Time is
 * `Date.now()`, driven by fake timers, so a "crawl" of minutes runs instantly.
 */
const request = vi.hoisted(() => ({ host: "shop-a.example.sa" }));

vi.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers();
    h.set("host", request.host);
    h.set("x-forwarded-proto", "https");
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
const WINDOW_MS = 60_000;
const AWJ_LIMIT = { limit: 30, windowMs: WINDOW_MS };
const GENERIC = "Sitemap is temporarily unavailable.";

let errorLog: MockInstance;

async function loadRoute() {
  vi.resetModules(); // fresh budget counters per test
  return import("@/app/sitemap");
}

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

/** Pull `id` once; on a refusal wait one full window and try again (a crawler). */
async function crawlFile(
  sitemap: (props: { id: Promise<string> }) => Promise<{ url: string }[]>,
  id: number,
  attempts = 3,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await sitemap({ id: Promise.resolve(String(id)) });
    } catch (error) {
      expect((error as Error).message).toBe(GENERIC);
      advance(WINDOW_MS);
    }
  }
  throw new Error(`file ${id} never became available`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
  vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "sa");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "");
  request.host = HOST_A;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("request cost of a sitemap file", () => {
  it("never exceeds 7 upstream requests per file, however large the catalog", async () => {
    const fake = createFakeAwj({
      [HOST_A]: {
        products: manyProducts(100_000),
        categories: [{ id: "c1", parent_id: null }],
      },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "1000000");
    const { default: sitemap } = await loadRoute();

    for (const id of [0, 1, 99, 199]) {
      const before = fake.calls.length;
      await sitemap({ id: Promise.resolve(String(id)) });
      const spent = fake.calls.length - before;
      expect(spent).toBeLessThanOrEqual(id === 0 ? 7 : 6);
    }
  });

  it("an index costs 1 request regardless of catalog size", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(100_000), categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    const { generateSitemaps } = await loadRoute();

    expect(await generateSitemaps()).toHaveLength(200);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("crawling a large catalog inside the real 30 / 60 s limit", () => {
  it("lists all 100,000 products with zero upstream 429s, over many windows", async () => {
    const fake = createFakeAwj(
      {
        [HOST_A]: {
          products: manyProducts(100_000),
          categories: [
            {
              id: "c1",
              parent_id: null,
              children: [{ id: "c2", parent_id: "c1" }],
            },
          ],
        },
      },
      AWJ_LIMIT,
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const { default: sitemap, generateSitemaps } = await loadRoute();

    const files = await generateSitemaps();
    expect(files).toHaveLength(200);

    const urls: string[] = [];
    for (const { id } of files) {
      urls.push(...(await crawlFile(sitemap, id)).map((e) => e.url));
    }

    // 2 locales × (home + products + 2 categories + 100,000 products)
    expect(urls).toHaveLength(2 * (2 + 2 + 100_000));
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(`https://${HOST_A}/sa/ar/products/p-99999`);
    expect(urls).toContain(`https://${HOST_A}/sa/en/products/p-0`);
    // The guard, not the API, held the line.
    expect(fake.rateLimitedCount()).toBe(0);
  });

  it("never spends more than half of any API window on the sitemap", async () => {
    const fake = createFakeAwj(
      { [HOST_A]: { products: manyProducts(5000), categories: [] } },
      AWJ_LIMIT,
    );
    const stamps: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        stamps.push(Date.now());
        return fake.fetchMock(input, init);
      }),
    );
    const { default: sitemap } = await loadRoute();

    // hammer: every file asked back-to-back, retried the moment it is refused
    for (let id = 0; id < 10; id++) await crawlFile(sitemap, id);

    const perWindow = new Map<number, number>();
    for (const at of stamps) {
      const bucket = Math.floor(at / WINDOW_MS);
      perWindow.set(bucket, (perWindow.get(bucket) ?? 0) + 1);
    }
    // Windows are aligned to the first reservation, not to the clock, so allow
    // the straddle: any 60 s span holds at most the budget (15) + one file (7).
    for (const at of stamps) {
      const inSpan = stamps.filter((t) => t >= at && t < at + WINDOW_MS).length;
      expect(inSpan).toBeLessThanOrEqual(15);
    }
    expect(fake.rateLimitedCount()).toBe(0);
  });
});

describe("budget guard", () => {
  it("refuses over-budget work WITHOUT calling the API, then recovers next window", async () => {
    const fake = createFakeAwj(
      { [HOST_A]: { products: manyProducts(5000), categories: [] } },
      AWJ_LIMIT,
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const { default: sitemap } = await loadRoute();

    await sitemap({ id: Promise.resolve("0") }); // 7
    await sitemap({ id: Promise.resolve("1") }); // 6 → 13
    const used = fake.calls.length;

    await expect(sitemap({ id: Promise.resolve("2") })).rejects.toThrow(
      GENERIC,
    );
    expect(fake.calls).toHaveLength(used); // fail closed, no upstream call
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/upstream budget exhausted, retry after \d+s/),
    );

    advance(WINDOW_MS);
    await expect(sitemap({ id: Promise.resolve("2") })).resolves.not.toEqual(
      [],
    );
  });

  it("an exhausted budget makes the index THROW (retryable) but robots discovery falls back", async () => {
    const fake = createFakeAwj(
      { [HOST_A]: { products: manyProducts(5000), categories: [] } },
      AWJ_LIMIT,
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const { default: sitemap, generateSitemaps } = await loadRoute();
    const { listSitemapIdsForRobots } = await import("@/lib/data/sitemap");
    await sitemap({ id: Promise.resolve("0") });
    await sitemap({ id: Promise.resolve("0") }); // 14 of 15 used
    expect(await generateSitemaps()).toHaveLength(10); // 15th request
    const used = fake.calls.length;

    await expect(generateSitemaps()).rejects.toThrow(GENERIC);
    expect(await listSitemapIdsForRobots()).toEqual([{ id: 0 }]);
    expect(fake.calls).toHaveLength(used); // neither touched the API
  });

  it("honours SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(5000), categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "6");
    const { default: sitemap } = await loadRoute();

    await expect(sitemap({ id: Promise.resolve("0") })).rejects.toThrow(
      GENERIC,
    ); // needs 7
    expect(fake.calls).toHaveLength(0);
    await expect(sitemap({ id: Promise.resolve("1") })).resolves.not.toEqual(
      [],
    ); // needs 6
  });

  it("keeps counters only — no catalog data — so tenants stay isolated", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: [{ id: "a-1" }], categories: [] },
      [HOST_B]: { products: [{ id: "b-1" }], categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "1000000");
    const { default: sitemap } = await loadRoute();

    request.host = HOST_A;
    const a = (await sitemap({ id: Promise.resolve("0") })).map((e) => e.url);
    request.host = HOST_B;
    const b = (await sitemap({ id: Promise.resolve("0") })).map((e) => e.url);

    expect(a.join()).toMatch(/a-1/);
    expect(a.join()).not.toMatch(/b-1/);
    expect(b.join()).toMatch(/b-1/);
    expect(b.join()).not.toMatch(/a-1/);
  });
});

describe("an upstream 429", () => {
  function saturate(fake: ReturnType<typeof createFakeAwj>, hits: number) {
    // live storefront traffic already spent `hits` of the shared window
    return Promise.all(
      Array.from({ length: hits }, () =>
        fake.fetchMock("https://api.awj.test/store/v1/categories", {
          headers: { "X-Storefront-Forwarded-Host": HOST_A },
        }),
      ),
    );
  }

  it("fails the file generically, logs Retry-After, and makes NO further calls during the cool-down", async () => {
    const fake = createFakeAwj(
      { [HOST_A]: { products: manyProducts(5000), categories: [] } },
      AWJ_LIMIT,
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const { default: sitemap } = await loadRoute();
    await saturate(fake, 29);

    const failure = await sitemap({ id: Promise.resolve("1") }).catch(
      (error: unknown) => error,
    );

    expect((failure as Error).message).toBe(GENERIC);
    expect(fake.rateLimitedCount()).toBeGreaterThan(0);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/AWJ API 429 \(rate_limited\), retry after \d+s/),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/Too many/);

    // cool-down: the next attempts must not touch the API at all
    const after = fake.calls.length;
    advance(5_000);
    await expect(sitemap({ id: Promise.resolve("1") })).rejects.toThrow(
      GENERIC,
    );
    await expect(sitemap({ id: Promise.resolve("0") })).rejects.toThrow(
      GENERIC,
    );
    expect(fake.calls).toHaveLength(after);
  });

  it("resumes after Retry-After and then serves a complete file", async () => {
    const fake = createFakeAwj(
      { [HOST_A]: { products: manyProducts(700), categories: [] } },
      AWJ_LIMIT,
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const { default: sitemap } = await loadRoute();
    await saturate(fake, 29);
    await sitemap({ id: Promise.resolve("1") }).catch(() => undefined);

    advance(WINDOW_MS + 1_000);
    const entries = await sitemap({ id: Promise.resolve("1") });

    // 700 products: file 1 holds p-500..p-699 for both locales
    expect(entries).toHaveLength(400);
  });

  it("caps an absurd Retry-After at one window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 429,
            headers: { "retry-after": "86400" },
          }),
      ),
    );
    const { default: sitemap } = await loadRoute();
    await sitemap({ id: Promise.resolve("0") }).catch(() => undefined);

    advance(WINDOW_MS + 1);
    const healthy = createFakeAwj({
      [HOST_A]: { products: manyProducts(10), categories: [] },
    });
    vi.stubGlobal("fetch", healthy.fetchMock);
    await expect(sitemap({ id: Promise.resolve("0") })).resolves.not.toEqual(
      [],
    );
  });

  it("is shared across hosts, because the upstream limit is per server IP", async () => {
    const fake = createFakeAwj(
      {
        [HOST_A]: { products: manyProducts(700), categories: [] },
        [HOST_B]: { products: manyProducts(700), categories: [] },
      },
      AWJ_LIMIT,
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const { default: sitemap } = await loadRoute();
    await saturate(fake, 29);

    request.host = HOST_A;
    await sitemap({ id: Promise.resolve("1") }).catch(() => undefined);
    const after = fake.calls.length;
    request.host = HOST_B;
    await expect(sitemap({ id: Promise.resolve("1") })).rejects.toThrow(
      GENERIC,
    );
    expect(fake.calls).toHaveLength(after);
  });
});
