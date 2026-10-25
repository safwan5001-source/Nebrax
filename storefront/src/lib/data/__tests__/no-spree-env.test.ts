// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * H0 / X6 follow-up — AWJ-native storefront behaviour with NO Spree environment.
 *
 * Unlike `customer.gated.test.ts` (which mocks `@/lib/spree` away), this suite runs
 * the REAL `@/lib/spree` configuration and the real data layer with every
 * `SPREE_*` / `NEXT_PUBLIC_SPREE_*` variable removed. The only seams are the
 * framework (`next/*`) and the network (`fetch`). The Spree entry points are
 * wrapped in spies that call through, so any code path that tries to build or
 * fetch a Spree client either fires a spy or hits the real "not available" error
 * — both fail these tests.
 *
 * It deliberately does not duplicate the X6 scanner (static): this is the
 * runtime counterpart.
 *
 * The sitemap is AWJ-native since X3 and is asserted positively below. Policies are NOT
 * AWJ-native yet — see the "known gap" block; that test asserts today's dependency
 * honestly rather than passing by mocking Spree.
 */
const spree = vi.hoisted(() => ({
  getClient: vi.fn(),
  getClientForSurface: vi.fn(),
  getWholesaleClient: vi.fn(),
  initSpreeNext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/spree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spree")>();
  const wrap =
    <A extends unknown[], R>(
      spy: (...args: A) => void,
      fn: (...args: A) => R,
    ) =>
    (...args: A): R => {
      spy(...args);
      return fn(...args);
    };
  return {
    ...actual,
    getClient: wrap(spree.getClient, actual.getClient),
    getClientForSurface: wrap(
      spree.getClientForSurface,
      actual.getClientForSurface,
    ),
    getWholesaleClient: wrap(
      spree.getWholesaleClient,
      actual.getWholesaleClient,
    ),
    initSpreeNext: wrap(spree.initSpreeNext, actual.initSpreeNext),
  };
});

vi.mock("@spree/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spree/sdk")>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      spree.createClient(...args);
      return actual.createClient(...args);
    },
  };
});

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "shop.example.sa" }),
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name)
        ? { name, value: cookieJar.get(name) as string }
        : undefined,
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { ACCOUNT_AUTH_CAPABILITY } from "@/lib/commerce/capabilities";
import {
  getAwjCheckout,
  getAwjPaymentMethods,
  startOrResumeAwjCheckout,
  updateAwjContact,
  updateAwjDelivery,
} from "@/lib/data/awj-checkout";
import {
  addAwjItem,
  getAwjCart,
  removeAwjItem,
  updateAwjItem,
} from "@/lib/data/cart";
import {
  getCustomer,
  login,
  logout,
  register,
  requestPasswordReset,
  resetPassword,
  syncSession,
  updateCustomer,
} from "@/lib/data/customer";
import { cachedGetPolicy, getPolicy } from "@/lib/data/policies";
import { getClient } from "@/lib/spree";

const AWJ_API = "https://api.awj.test";
const LEAK = /spree|SPREE_|publishable|not configured|AWJ_COMMERCE_API_URL/i;

const money = { amount_minor: 0, currency: "SAR" };
const awjCart = {
  status: null,
  items: [],
  subtotal: money,
  currency: "SAR",
  has_unavailable_items: false,
};
const awjCheckout = {
  status: null,
  contact: { name: null, phone: null, email: null },
  delivery: {
    method: null,
    amount: money,
    address: {
      country: null,
      region: null,
      city: null,
      district: null,
      street: null,
      postal_code: null,
      notes: null,
    },
  },
  cart: awjCart,
};

const savedEnv: Record<string, string | undefined> = {};
const spreeEnvKeys = () =>
  Object.keys(process.env).filter((k) => /^(NEXT_PUBLIC_)?SPREE_/.test(k));

const fetchMock = vi.fn();

function awjRoutes(url: string, init?: RequestInit) {
  const { pathname } = new URL(url);
  const method = init?.method ?? "GET";
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ data, meta: { request_id: "req-1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  if (pathname.endsWith("/store/v1/storefront")) {
    return ok({ name: "Shop", default_locale: "ar" });
  }
  if (pathname.endsWith("/store/v1/products")) {
    return new Response(
      JSON.stringify({
        data: [{ id: "prod-1", updated_at: null, thumbnail_url: null }],
        meta: {
          request_id: "req-1",
          pagination: {
            page: 1,
            per_page: 100,
            total: 1,
            last_page: 1,
            has_more: false,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (pathname.endsWith("/store/v1/categories")) {
    return ok([{ id: "cat-1", parent_id: null, children: [] }]);
  }
  if (pathname.endsWith("/checkout/payment-methods")) {
    return ok({ payment_methods: [], online_methods: [] });
  }
  if (pathname.includes("/checkout")) return ok(awjCheckout);
  if (pathname.includes("/cart")) return ok(awjCart);
  void method;
  return new Response("{}", { status: 404 });
}

beforeAll(() => {
  for (const k of spreeEnvKeys()) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  for (const k of spreeEnvKeys()) delete process.env[k];
  vi.stubEnv("AWJ_COMMERCE_API_URL", AWJ_API);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    awjRoutes(url, init),
  );
  vi.stubGlobal("fetch", fetchMock);
});

const expectSpreeUntouched = () => {
  expect(spree.getClient).not.toHaveBeenCalled();
  expect(spree.getClientForSurface).not.toHaveBeenCalled();
  expect(spree.getWholesaleClient).not.toHaveBeenCalled();
  expect(spree.initSpreeNext).not.toHaveBeenCalled();
  expect(spree.createClient).not.toHaveBeenCalled();
};

const awjUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("test environment precondition", () => {
  it("has no SPREE_* / NEXT_PUBLIC_SPREE_* variable set", () => {
    expect(spreeEnvKeys()).toEqual([]);
  });

  it("the real Spree client really is unavailable here (so the spies below are meaningful)", () => {
    expect(() => getClient()).toThrow(/Spree client is not available/);
    expect(spree.getClient).toHaveBeenCalledTimes(1);
  });
});

describe("buyer account actions stay gated and never initialise Spree", () => {
  it("ships gated", () => {
    expect(ACCOUNT_AUTH_CAPABILITY).toBe("gated");
  });

  it("every account action resolves to a typed refusal without touching Spree", async () => {
    const results = [
      await login("a@b.sa", "secret1"),
      await register({
        email: "a@b.sa",
        password: "secret1",
        password_confirmation: "secret1",
      }),
      await requestPasswordReset("a@b.sa", "https://shop.example.sa/r"),
      await resetPassword("tok", "secret1", "secret1"),
      await updateCustomer({ first_name: "A" }),
    ];
    for (const r of results) {
      expect(r).toEqual({ success: false, code: "capability_unavailable" });
    }
    expect(await getCustomer()).toBeNull();
    expect(await syncSession()).toEqual({ customer: null, refreshed: false });
    await expect(logout()).resolves.toBeUndefined();

    expectSpreeUntouched();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(results)).not.toMatch(LEAK);
  });
});

describe("AWJ-native guest cart works without Spree configuration", () => {
  it("reads, adds, updates and removes via store/v1 only", async () => {
    const cart = await getAwjCart();
    expect(cart?.kind).toBe("awj");

    const added = await addAwjItem("prod-1", 2);
    const updated = await updateAwjItem("item-1", 3);
    const removed = await removeAwjItem("item-1");
    for (const r of [added, updated, removed]) {
      expect(r.success).toBe(true);
    }

    const urls = awjUrls();
    expect(urls.length).toBe(4);
    for (const u of urls) {
      expect(u.startsWith(`${AWJ_API}/store/v1/cart`)).toBe(true);
    }
    expectSpreeUntouched();
  });

  it("an AWJ API failure surfaces AWJ's own message, never Spree/config detail", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "unavailable",
              message: "Cart is temporarily unavailable.",
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );

    expect(await getAwjCart()).toBeNull();
    const failed = await addAwjItem("prod-1", 1);
    expect(failed).toEqual({
      success: false,
      error: "Cart is temporarily unavailable.",
    });
    expect(JSON.stringify(failed)).not.toMatch(LEAK);
    expectSpreeUntouched();
  });
});

describe("AWJ-native guest checkout works without Spree configuration", () => {
  it("start/resume, contact, delivery, payment methods and read use store/v1/checkout only", async () => {
    const started = await startOrResumeAwjCheckout();
    const contact = await updateAwjContact({
      name: "سالم",
      phone: "0500000000",
    });
    const delivery = await updateAwjDelivery("pickup");
    const checkout = await getAwjCheckout();
    const methods = await getAwjPaymentMethods();

    expect(started.success).toBe(true);
    expect(contact.success).toBe(true);
    expect(delivery.success).toBe(true);
    expect(checkout?.cart.kind).toBe("awj");
    expect(methods).toEqual([]);

    for (const u of awjUrls()) {
      expect(u.startsWith(`${AWJ_API}/store/v1/checkout`)).toBe(true);
    }
    expectSpreeUntouched();
  });

  it("forwards the visitor host and never sends a Spree credential", async () => {
    await getAwjCheckout();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Storefront-Forwarded-Host"]).toBe("shop.example.sa");
    expect(JSON.stringify(headers)).not.toMatch(/spree|publishable/i);
  });

  it("a checkout API failure never leaks Spree/config detail to the shopper", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "unavailable",
              message: "Checkout is temporarily unavailable.",
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );
    const started = await startOrResumeAwjCheckout();
    expect(started).toEqual({
      success: false,
      error: "Checkout is temporarily unavailable.",
    });
    expect(await getAwjCheckout()).toBeNull();
    expect(JSON.stringify(started)).not.toMatch(LEAK);
    expectSpreeUntouched();
  });
});

/**
 * X3 — the sitemap and robots.txt are AWJ-native: they read `store/v1` only, keyed by the
 * visitor's Host, and never build a Spree client. (Full behavioural coverage lives in
 * `src/app/sitemap.test.ts`, `robots.test.ts` and `lib/data/__tests__/sitemap.test.ts`.)
 */
describe("sitemap and robots work without Spree", () => {
  it("sitemap chunk is built from store/v1 with the visitor host and never touches Spree", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://shop.example.sa");
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "sa");
    const { default: sitemap, generateSitemaps } = await import(
      "@/app/sitemap"
    );

    const entries = await sitemap({ id: Promise.resolve("0") });
    const urls = entries.map((entry) => entry.url);

    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    expect(urls).toContain("https://shop.example.sa/sa/ar/products/prod-1");
    expect(urls).toContain("https://shop.example.sa/sa/ar/c/cat-1");
    expect(urls).toContain("https://shop.example.sa/sa/en/products/prod-1");
    expect(JSON.stringify(entries)).not.toMatch(LEAK);

    for (const u of awjUrls()) {
      expect(u.startsWith(`${AWJ_API}/store/v1/`)).toBe(true);
    }
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers["X-Storefront-Forwarded-Host"]).toBe("shop.example.sa");
      expect(JSON.stringify(headers)).not.toMatch(/spree|publishable/i);
    }
    expectSpreeUntouched();
  });

  it("an AWJ API failure yields a generic error and a server-side log only — no Spree/config detail", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://shop.example.sa");
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "unavailable", message: "db-internal is down" },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: sitemap, generateSitemaps } = await import(
      "@/app/sitemap"
    );

    const failure = await sitemap({ id: Promise.resolve("0") }).catch(
      (error: unknown) => error,
    );

    expect((failure as Error).message).toBe(
      "Sitemap is temporarily unavailable.",
    );
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/db-internal/);
    expect((failure as Error).message).not.toMatch(LEAK);
    expectSpreeUntouched();
    errorLog.mockRestore();
  });

  it("robots.txt references the sitemap on the visitor host without Spree", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://shop.example.sa");
    const { default: robots } = await import("@/app/robots");

    const result = await robots();

    expect(result.sitemap).toEqual(["https://shop.example.sa/sitemap/0.xml"]);
    expectSpreeUntouched();
  });
});

/**
 * KNOWN GAP — these assert TODAY'S behaviour, not the desired one.
 *
 * Policies still read through the Spree client (`getClient()`), so with no Spree
 * environment they cannot return data. They are not migrated here (policies have no AWJ
 * source yet). If a future slice migrates them, these tests must be rewritten into
 * positive "works without Spree" tests — a failure here after such a migration is the
 * intended signal.
 */
describe("KNOWN GAP — policies still depend on Spree", () => {
  it("policies: cachedGetPolicy/getPolicy reject because the Spree client is unavailable", async () => {
    await expect(
      cachedGetPolicy("privacy", { country: "sa", locale: "ar" }),
    ).rejects.toThrow(/Spree client is not available/);
    await expect(
      getPolicy("privacy", { country: "sa", locale: "ar" }),
    ).rejects.toThrow(/Spree client is not available/);
    expect(spree.getClient).toHaveBeenCalled();
    expect(spree.createClient).not.toHaveBeenCalled();
  });

  it("policy page: the configuration error is NOT converted to a shopper-safe result", async () => {
    // Documented gap: generateMetadata awaits getPolicy without a guard, so the raw
    // configuration error propagates to Next's error boundary (production hides the
    // message behind a digest, but the code path is not shopper-safe by construction).
    const { generateMetadata } = await import(
      "@/app/[country]/[locale]/(storefront)/policies/[slug]/page"
    );
    await expect(
      generateMetadata({
        params: Promise.resolve({
          country: "sa",
          locale: "ar",
          slug: "privacy",
        }),
      }),
    ).rejects.toThrow(/Spree client is not available/);
  });
});
