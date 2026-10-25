// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeAwj,
  type FakeBackend,
  manyProducts,
} from "./__tests__/fake-awj-catalog";

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

function useBackend(backend: FakeBackend) {
  const fake = createFakeAwj(backend);
  vi.stubGlobal("fetch", fake.fetchMock);
  return fake;
}

beforeEach(() => {
  vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.awj.test");
  vi.stubEnv("AWJ_STOREFRONT_DEV_HOST", "");
  vi.stubEnv("SITEMAP_UPSTREAM_BUDGET_PER_MINUTE", "1000000");
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "sa");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
  request.host = HOST_A;
  request.proto = "https";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function robots() {
  const { default: handler } = await import("@/app/robots");
  return handler();
}

describe("robots.txt", () => {
  it("references exactly the sitemap files the index produces, on the request host", async () => {
    useBackend({
      [HOST_A]: { products: manyProducts(30_000), categories: [] },
    });

    const result = await robots();

    expect(result.sitemap).toEqual(
      Array.from(
        { length: 60 },
        (_, id) => `https://${HOST_A}/sitemap/${id}.xml`,
      ),
    );
    expect(result.host).toBe(`https://${HOST_A}`);
  });

  it("names the host of each tenant, never another tenant's", async () => {
    useBackend({
      [HOST_A]: { products: [], categories: [] },
      [HOST_B]: { products: [], categories: [] },
    });

    request.host = HOST_B;
    const result = await robots();

    expect(JSON.stringify(result)).toContain(HOST_B);
    expect(JSON.stringify(result)).not.toContain(HOST_A);
  });

  it("uses the configured store URL when it is the request host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", `https://${HOST_A}`);
    useBackend({ [HOST_A]: { products: [], categories: [] } });

    expect((await robots()).sitemap).toEqual([
      `https://${HOST_A}/sitemap/0.xml`,
    ]);
  });

  it("still lists the first sitemap when the AWJ API is down", async () => {
    useBackend({ [HOST_A]: { status: 503 } });

    const result = await robots();

    expect(result.sitemap).toEqual([`https://${HOST_A}/sitemap/0.xml`]);
    expect(JSON.stringify(result)).not.toMatch(/SQLSTATE|SECRET|db-internal/);
  });

  it("omits sitemap references rather than inventing a host when none is known", async () => {
    useBackend({ [HOST_A]: { products: [], categories: [] } });
    request.host = undefined;

    const result = await robots();

    expect(result.sitemap).toBeUndefined();
    expect(result.host).toBeUndefined();
    expect(result.rules).toBeDefined();
  });

  it("keeps the crawl rules unchanged", async () => {
    useBackend({ [HOST_A]: { products: [], categories: [] } });

    const { rules } = await robots();

    expect(rules).toEqual([
      { userAgent: "meta-externalagent", disallow: ["/"] },
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/*/account",
          "/*/account/*",
          "/*/cart",
          "/*/checkout",
          "/*/checkout/*",
          "/*?*sort=*",
          "/*?*page=*",
          "/*?*filter*=*",
        ],
      },
    ]);
  });
});
