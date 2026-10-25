import { vi } from "vitest";

/**
 * A minimal stand-in for the AWJ Store backend (`store/v1`) for the sitemap and
 * robots tests. It models the parts of the contract the sitemap relies on and
 * nothing else:
 *  - the tenant is chosen ONLY by the forwarded host header (unknown host → 404);
 *  - `products` lists the tenant's PUBLISHED products, paginated, `per_page` ≤ 100;
 *  - `categories` is the tenant's published tree;
 *  - `storefront` carries the default locale.
 * Hidden/draft items are modelled by simply not being in the published set, which
 * is what the real controllers' publish gates do.
 */

export interface FakeProduct {
  id: string;
  updated_at?: string | null;
  thumbnail_url?: string | null;
}

export interface FakeCategory {
  id: string;
  parent_id: string | null;
  children?: FakeCategory[];
}

export interface FakeTenant {
  products: FakeProduct[];
  categories: FakeCategory[];
  defaultLocale?: string;
}

export type FakeBackend = Record<string, FakeTenant | { status: number }>;

export interface RecordedCall {
  path: string;
  host: string | undefined;
  query: URLSearchParams;
}

const API = "https://api.awj.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function manyProducts(count: number, prefix = "p"): FakeProduct[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
  }));
}

export interface FakeRateLimit {
  /** Requests allowed per window (AWJ `unauth`: 30). */
  limit: number;
  /** Fixed window in ms (AWJ: 60_000). */
  windowMs: number;
}

/**
 * `rateLimit` models `EnforcePublicApiRateLimit:unauth`: ONE fixed window per
 * client IP — the Next.js server's — so every host and every kind of storefront
 * read draws on the same budget. A request over the limit is a 429 with
 * `Retry-After`, and (as in Laravel) does not extend the window. Time is
 * `Date.now()`, so tests drive it with fake timers.
 */
export function createFakeAwj(backend: FakeBackend, rateLimit?: FakeRateLimit) {
  const calls: RecordedCall[] = [];
  const window = { start: 0, hits: 0 };
  let rateLimited = 0;

  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const host = headers["X-Storefront-Forwarded-Host"];
    const path = url.pathname.replace(/^\/store\/v1\//, "");
    calls.push({ path, host, query: url.searchParams });

    if (rateLimit) {
      const now = Date.now();
      if (now - window.start >= rateLimit.windowMs) {
        window.start = now;
        window.hits = 0;
      }
      if (window.hits >= rateLimit.limit) {
        rateLimited += 1;
        const retryAfter = Math.ceil(
          (window.start + rateLimit.windowMs - now) / 1000,
        );
        return new Response(
          JSON.stringify({
            error: { code: "rate_limited", message: "Too many requests." },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(retryAfter),
            },
          },
        );
      }
      window.hits += 1;
    }

    const tenant = host ? backend[host] : undefined;
    if (!tenant) {
      return json(
        { error: { code: "storefront_not_found", message: "Not found." } },
        404,
      );
    }
    if ("status" in tenant) {
      return json(
        {
          error: {
            code: "internal",
            message:
              "SQLSTATE[08006] connection to db-internal.awj.local:5432 refused (SECRET_TOKEN_123)",
          },
        },
        tenant.status,
      );
    }

    if (path === "storefront") {
      return json({
        data: { name: "Test", default_locale: tenant.defaultLocale ?? "ar" },
      });
    }
    if (path === "categories") {
      return json({
        data: tenant.categories,
        meta: { request_id: "req-1" },
      });
    }
    if (path === "products") {
      const perPage = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get("per_page") ?? 15)),
      );
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const total = tenant.products.length;
      const lastPage = Math.max(1, Math.ceil(total / perPage));
      return json({
        data: tenant.products.slice((page - 1) * perPage, page * perPage),
        meta: {
          request_id: "req-1",
          pagination: {
            page,
            per_page: perPage,
            total,
            last_page: lastPage,
            has_more: page < lastPage,
          },
        },
      });
    }
    return json({ error: { code: "not_found", message: "Not found." } }, 404);
  });

  return {
    fetchMock,
    calls,
    api: API,
    callsTo: (path: string) => calls.filter((call) => call.path === path),
    rateLimitedCount: () => rateLimited,
  };
}
