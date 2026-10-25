// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createFakeAwj, manyProducts } from "./__tests__/fake-awj-catalog";

/**
 * X3 / Codex P2 — behaviour through Next's REAL metadata route loader.
 *
 * Next 16.2 turns `app/sitemap.ts` (with `generateSitemaps`) into a route whose
 * GET calls `generateSitemaps()` on every request and answers 404 for an id that
 * is not in the list — BEFORE the sitemap function runs. Calling `sitemap()` or
 * `generateSitemaps()` directly cannot see that, so these tests run the actual
 * loader (`next-metadata-route-loader`) on the real `sitemap.ts`, write the code
 * it generates to a scratch module, and drive that module's `GET` / `generateStaticParams`.
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
const SITEMAP_TS = resolve(__dirname, "sitemap.ts");
const SCRATCH_DIR = resolve(__dirname, "__tests__/.generated");
const WINDOW_MS = 60_000;

interface GeneratedRoute {
  GET: (
    request: Request,
    ctx: { params: Promise<{ __metadata_id__: string }> },
  ) => Promise<Response>;
  generateStaticParams: () => Promise<Array<{ __metadata_id__: string }>>;
}

let generatedPath: string;

/** Run Next's actual loader on sitemap.ts and return the code it emits. */
async function generateRouteCode(): Promise<string> {
  const { default: loader } = await import(
    "next/dist/build/webpack/loaders/next-metadata-route-loader"
  );
  const exportsOfSitemap = ["dynamic", "generateSitemaps", "default"];
  const context = {
    getOptions: () => ({ isDynamicRouteExtension: "1", filePath: SITEMAP_TS }),
    addDependency: () => undefined,
    // webpack's loadModule(): the loader only reads the module's export names
    loadModule: (
      _path: string,
      done: (err: Error | null, ...rest: unknown[]) => void,
    ) =>
      done(null, "", null, {
        dependencies: exportsOfSitemap.map((name) => ({
          constructor: { name: "HarmonyExportSpecifierDependency" },
          name,
        })),
      }),
  };
  return (loader as unknown as (this: typeof context) => Promise<string>).call(
    context,
  );
}

async function loadRoute(): Promise<GeneratedRoute> {
  vi.resetModules(); // fresh request-budget counters per test
  return (await import(/* @vite-ignore */ generatedPath)) as GeneratedRoute;
}

function get(route: GeneratedRoute, id: string) {
  return route.GET(new Request(`https://${HOST_A}/sitemap/${id}.xml`), {
    params: Promise.resolve({ __metadata_id__: `${id}.xml` }),
  });
}

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

beforeAll(async () => {
  const code = await generateRouteCode();
  mkdirSync(SCRATCH_DIR, { recursive: true });
  generatedPath = resolve(SCRATCH_DIR, "sitemap-route.ts");
  writeFileSync(generatedPath, code);
});

afterAll(() => {
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
  vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "sa");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
  vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "");
  vi.stubEnv("NEXT_PHASE", "");
  request.host = HOST_A;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the generated route is what Next really builds", () => {
  it("validates ids through generateSitemaps() before calling the sitemap function", async () => {
    const code = await generateRouteCode();

    expect(code).toContain("const sitemaps = await generateSitemaps()");
    expect(code).toMatch(/foundId == null[\s\S]*status: 404/);
  });
});

describe("existing chunk ids survive temporary throttling (no false 404)", () => {
  it("serves a valid chunk, and 404s only an id that truly does not exist", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(1200), categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "1000000");
    const route = await loadRoute();

    const ok = await get(route, "1");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("/sa/ar/products/p-500");

    const missing = await get(route, "9");
    expect(missing.status).toBe(404);
  });

  it("budget exhaustion on a valid chunk is a retryable error, never a 404", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(5000), categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    const route = await loadRoute();

    expect((await get(route, "0")).status).toBe(200); // 1 + 7 of 15
    const results: Array<number | string> = [];
    for (const id of ["1", "2", "3"]) {
      results.push(
        await get(route, id).then(
          (response) => response.status,
          (error: Error) => error.message,
        ),
      );
    }

    // later files hit the local budget: an error (Next → 500), not a 404 Response
    expect(results).toContain("Sitemap is temporarily unavailable.");
    expect(results).not.toContain(404);
  });

  it("recovers on the next window and then serves the same chunk", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(5000), categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    const route = await loadRoute();
    await get(route, "0"); // 8
    await get(route, "1"); // 7 → 15 of 15
    await expect(get(route, "5")).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );

    advance(WINDOW_MS);
    const retry = await get(route, "5");

    expect(retry.status).toBe(200);
    expect(await retry.text()).toContain("/sa/ar/products/p-2500");
  });

  it("an upstream 429 while validating the id is a retryable error, not a 404", async () => {
    const fake = createFakeAwj(
      { [HOST_A]: { products: manyProducts(5000), categories: [] } },
      { limit: 30, windowMs: WINDOW_MS },
    );
    vi.stubGlobal("fetch", fake.fetchMock);
    const route = await loadRoute();
    for (let i = 0; i < 30; i++) {
      await fake.fetchMock("https://api.awj.test/store/v1/categories", {
        headers: { "X-Storefront-Forwarded-Host": HOST_A },
      });
    }

    await expect(get(route, "3")).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
    expect(fake.rateLimitedCount()).toBeGreaterThan(0);
  });

  it("an API outage is a retryable error, not a 404", async () => {
    const fake = createFakeAwj({ [HOST_A]: { status: 503 } });
    vi.stubGlobal("fetch", fake.fetchMock);
    const route = await loadRoute();

    await expect(get(route, "1")).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
  });

  it("an unknown host is not a catalog: error, no URLs", async () => {
    const fake = createFakeAwj({
      [HOST_A]: { products: manyProducts(10), categories: [] },
    });
    vi.stubGlobal("fetch", fake.fetchMock);
    request.host = "unknown.example.sa";
    const route = await loadRoute();

    await expect(get(route, "0")).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
  });
});

describe("build time and robots stay separate from chunk validation", () => {
  it("generateStaticParams declares one file during `next build`, with no Host and no API", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubGlobal("fetch", vi.fn());
    const route = await loadRoute();

    await expect(route.generateStaticParams()).resolves.toEqual([
      { __metadata_id__: "0.xml" },
    ]);
  });

  it("outside the build, generateStaticParams does not invent a list either", async () => {
    vi.stubGlobal(
      "fetch",
      createFakeAwj({ [HOST_A]: { status: 503 } }).fetchMock,
    );
    const route = await loadRoute();

    await expect(route.generateStaticParams()).rejects.toThrow(
      "Sitemap is temporarily unavailable.",
    );
  });

  it("robots.txt still falls back to the first file while the same API is throttled", async () => {
    vi.stubGlobal(
      "fetch",
      createFakeAwj({ [HOST_A]: { status: 503 } }).fetchMock,
    );
    vi.resetModules();
    const { default: robots } = await import("@/app/robots");

    expect((await robots()).sitemap).toEqual([
      `https://${HOST_A}/sitemap/0.xml`,
    ]);
  });
});
