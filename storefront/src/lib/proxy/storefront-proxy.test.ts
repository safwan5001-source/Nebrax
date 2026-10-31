import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostContext } from "@/lib/commerce/edge-storefront-locale";
import { createStorefrontProxy } from "@/lib/proxy/storefront-proxy";

const middleware = createStorefrontProxy({
  defaultCountry: "us",
  defaultLocale: "en",
  supportedLocales: ["en", "de", "zh-CN"],
});

describe("Storefront proxy", () => {
  it("canonicalizes an existing country and locale prefix", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/US/ZH-cn/products?sort=name"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/zh-CN/products?sort=name",
    );
  });

  it("redirects an unsupported storefront locale without dropping the path", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/ar/it/products/coffee"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/products/coffee",
    );
    expect(response.cookies.get("awj_country")?.value).toBe("us");
    expect(response.cookies.get("awj_locale")?.value).toBe("en");
  });

  it("falls back to a supported locale when the configured default is unavailable", async () => {
    const invalidDefaultMiddleware = createStorefrontProxy({
      defaultCountry: "us",
      defaultLocale: "it",
      supportedLocales: ["en", "de"],
    });

    const response = await invalidDefaultMiddleware(
      new NextRequest("https://store.example/us/it/products"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/products",
    );
  });

  it("negotiates the first supported browser language", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/products", {
        headers: { "accept-language": "it-IT, de-DE;q=0.9, en;q=0.8" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/de/products",
    );
  });

  it("uses Accept-Language quality weights instead of header order", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/products", {
        headers: { "accept-language": "de;q=0, en-US;q=0.9" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/products",
    );
  });

  it("forwards the localized request path for Market-aware fallbacks", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/ar/en/products/coffee?sort=price"),
    );

    expect(
      response.headers.get("x-middleware-request-x-awj-request-pathname"),
    ).toBe("/ar/en/products/coffee");
    expect(
      response.headers.get("x-middleware-request-x-awj-request-search"),
    ).toBe("?sort=price");
  });

  it("redirects an anonymous protected account request to sign in", async () => {
    const response = await middleware(
      new NextRequest(
        "https://store.example/us/en/account/orders?state=complete",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/account?redirect=%2Fus%2Fen%2Faccount%2Forders%3Fstate%3Dcomplete",
    );
  });

  it.each([
    "/us/en/account",
    "/us/en/account/register",
    "/us/en/account/forgot-password",
    "/us/en/account/reset-password?token=reset-token",
  ])("keeps the public account route accessible: %s", async (pathname) => {
    const response = await middleware(
      new NextRequest(`https://store.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "awj_account_session",
    "awj_account_refresh",
  ])("allows a protected account request with a %s session cookie", async (cookieName) => {
    const request = new NextRequest(
      "https://store.example/us/en/account/orders",
    );
    request.cookies.set(cookieName, "session-token");

    const response = await middleware(request);

    expect(response.headers.get("location")).toBeNull();
  });

  it("does not treat an empty auth cookie as a session credential", async () => {
    const request = new NextRequest(
      "https://store.example/us/en/account/orders",
    );
    request.cookies.set("awj_account_session", "");

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/us/en/account?");
  });
});

describe("Storefront proxy — Storefront default locale (STORE-LOCALE-WIRING-1)", () => {
  function middlewareWithResolver(
    resolveStorefrontLocale: (
      request: NextRequest,
    ) => Promise<string | null | undefined>,
  ) {
    return createStorefrontProxy({
      defaultCountry: "sa",
      defaultLocale: "ar",
      supportedLocales: ["ar", "en"],
      resolveStorefrontLocale,
    });
  }

  it("redirects a cookie-less first visit to the Storefront's configured Arabic default", async () => {
    const resolver = vi.fn().mockResolvedValue("ar");
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/"),
    );

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/ar",
    );
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("redirects a cookie-less first visit to the Storefront's configured English default", async () => {
    const resolver = vi.fn().mockResolvedValue("en");
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/"),
    );

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/en",
    );
  });

  it("lets an existing awj_locale cookie override the Storefront's default locale", async () => {
    const resolver = vi.fn().mockResolvedValue("en");
    const middleware = middlewareWithResolver(resolver);

    const request = new NextRequest("https://alrshd.store.example/");
    request.cookies.set("awj_locale", "ar");

    const response = await middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/ar",
    );
    // The buyer's own cookie already decides — no need to ask the Store API.
    expect(resolver).not.toHaveBeenCalled();
  });

  it("lets the reverse cookie/default combination hold too (ar cookie overrides en default)", async () => {
    const resolver = vi.fn().mockResolvedValue("ar");
    const middleware = middlewareWithResolver(resolver);

    const request = new NextRequest("https://alrshd.store.example/");
    request.cookies.set("awj_locale", "en");

    const response = await middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/en",
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it("keeps an explicit localized URL authoritative and never consults the resolver", async () => {
    const resolver = vi.fn().mockResolvedValue("en");
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/sa/ar/products"),
    );

    // Already-canonical — middleware passes it through (no redirect).
    expect(response.headers.get("location")).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("lets the Storefront's default locale outrank Accept-Language negotiation", async () => {
    const resolver = vi.fn().mockResolvedValue("en");
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/", {
        headers: { "accept-language": "ar" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/en",
    );
  });

  it("falls back to Accept-Language when the Storefront locale lookup fails", async () => {
    const resolver = vi.fn().mockResolvedValue(null);
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/", {
        headers: { "accept-language": "en" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/en",
    );
  });

  it("falls back to Accept-Language when the resolver rejects instead of hanging or erroring", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("network error"));
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/", {
        headers: { "accept-language": "en" },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/en",
    );
  });

  it("falls back to the static default when both the resolver and Accept-Language are unavailable", async () => {
    const resolver = vi.fn().mockResolvedValue(null);
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://alrshd.store.example/"),
    );

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/ar",
    );
  });

  it("stays backward compatible for Arabic Storefronts (no-op vs. the pre-existing static default)", async () => {
    const resolver = vi.fn().mockResolvedValue("ar");
    const middleware = middlewareWithResolver(resolver);

    const response = await middleware(
      new NextRequest("https://existing-arabic-store.example/"),
    );

    expect(response.headers.get("location")).toBe(
      "https://existing-arabic-store.example/sa/ar",
    );
  });

  it("does not redirect-loop: the redirect target is a canonical prefix the middleware passes through", async () => {
    const resolver = vi.fn().mockResolvedValue("en");
    const middleware = middlewareWithResolver(resolver);

    const first = await middleware(
      new NextRequest("https://alrshd.store.example/"),
    );
    expect(first.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/en",
    );

    const second = await middleware(
      new NextRequest("https://alrshd.store.example/sa/en"),
    );
    expect(second.headers.get("location")).toBeNull();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("resolves each request's own Host — no cross-tenant bleed between two Storefronts", async () => {
    const localeByHost: Record<string, string> = {
      "tenant-a.example": "ar",
      "tenant-b.example": "en",
    };
    const resolver = vi.fn(async (request: NextRequest) => {
      return localeByHost[request.nextUrl.host] ?? null;
    });
    const middleware = middlewareWithResolver(resolver);

    const responseA = await middleware(
      new NextRequest("https://tenant-a.example/"),
    );
    const responseB = await middleware(
      new NextRequest("https://tenant-b.example/"),
    );

    expect(responseA.headers.get("location")).toBe(
      "https://tenant-a.example/sa/ar",
    );
    expect(responseB.headers.get("location")).toBe(
      "https://tenant-b.example/sa/en",
    );
  });

  it("preserves pre-existing behavior entirely when no resolver is configured", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en",
    );
  });
});

describe("dynamic store icon bypass", () => {
  const localeMiddleware = createStorefrontProxy({
    defaultCountry: "sa",
    defaultLocale: "ar",
    supportedLocales: ["ar", "en"],
    resolveStorefrontLocale: vi.fn().mockResolvedValue("ar"),
  });

  it.each([
    "/icon",
    "/icon/",
  ])("does not locale-prefix %s", async (pathname) => {
    const response = await localeMiddleware(
      new NextRequest(`https://alrshd.store.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("does not rewrite /icon to /sa/ar/icon when locale cookies are already set", async () => {
    const request = new NextRequest("https://alrshd.store.example/icon");
    request.cookies.set("awj_country", "sa");
    request.cookies.set("awj_locale", "ar");

    const response = await localeMiddleware(request);

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still locale-routes / and storefront pages", async () => {
    const root = await localeMiddleware(
      new NextRequest("https://alrshd.store.example/"),
    );
    const products = await localeMiddleware(
      new NextRequest("https://alrshd.store.example/products"),
    );
    const localized = await localeMiddleware(
      new NextRequest("https://alrshd.store.example/sa/ar/products"),
    );

    expect(root.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/ar",
    );
    expect(products.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/ar/products",
    );
    expect(localized.headers.get("location")).toBeNull();
  });

  it("does not treat a longer path that starts with icon as the icon route", async () => {
    const response = await localeMiddleware(
      new NextRequest("https://alrshd.store.example/icons"),
    );

    expect(response.headers.get("location")).toBe(
      "https://alrshd.store.example/sa/ar/icons",
    );
  });

  it.each([
    "/favicon.ico",
    "/api/storefront",
    "/_next/static/chunk.js",
    "/_next/image",
  ])("keeps the existing exclusion for %s", async (pathname) => {
    const response = await middleware(
      new NextRequest(`https://store.example${pathname}`),
    );

    expect(response.headers.get("location")).toBeNull();
  });
});

describe("X5b: legacy checkout routes answer a real 404", () => {
  const legacy = [
    "/us/en/checkout/abc",
    "/us/en/confirm-payment/abc",
    "/us/en/order-placed/abc",
  ];
  const closedPath = "/us/en/awj-legacy-checkout-closed";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const rewriteOf = (response: Response) =>
    response.headers.get("x-middleware-rewrite");

  it.each(
    legacy,
  )("rewrites %s to a path that matches no route (no redirect)", async (path) => {
    const response = await middleware(
      new NextRequest(`https://store.example${path}?x=1`),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(rewriteOf(response)).toBe(`https://store.example${closedPath}`);
  });

  it("closes the legacy route for every spelling that resolves to checkout/[id]", async () => {
    for (const path of [
      "/us/en/checkout/%70ayment-return",
      "/us/en/checkout/Payment-Return",
      "/us/en/checkout/abc/",
    ]) {
      const response = await middleware(
        new NextRequest(`https://store.example${path}`),
      );
      expect(rewriteOf(response)?.replace(/\/$/, "")).toBe(
        `https://store.example${closedPath}`,
      );
    }
  });

  it("leaves the AWJ-native checkout routes untouched", async () => {
    for (const path of [
      "/us/en/checkout",
      "/us/en/checkout/",
      "/us/en/checkout/payment-return",
      "/us/en/cart",
    ]) {
      const response = await middleware(
        new NextRequest(`https://store.example${path}`),
      );
      expect(rewriteOf(response)).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("does not touch deeper or unrelated paths", async () => {
    for (const path of [
      "/us/en/checkout/abc/extra",
      "/us/en/products/checkout",
      "/us/en/wholesale/checkout/abc",
    ]) {
      const response = await middleware(
        new NextRequest(`https://store.example${path}`),
      );
      expect(rewriteOf(response)).toBeNull();
    }
  });

  it("still canonicalises the locale prefix before deciding (no gate bypass by prefix spelling)", async () => {
    const response = await middleware(
      new NextRequest("https://store.example/US/EN/checkout/abc"),
    );

    expect(response.headers.get("location")).toBe(
      "https://store.example/us/en/checkout/abc",
    );
  });

  it.each([
    "/us/en/checkout/test.123",
    "/us/en/confirm-payment/test.123",
    "/us/en/order-placed/test.123",
    // Not the static `payment-return` segment, so it resolves to checkout/[id].
    "/us/en/checkout/payment-return.v2",
  ])("closes the dotted legacy id %s without cookies or redirect", async (path) => {
    const response = await middleware(
      new NextRequest(`https://store.example${path}`),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(rewriteOf(response)).toBe(`https://store.example${closedPath}`);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps dotted ids, static assets and AWJ routes on the plain pass-through", async () => {
    for (const path of [
      "/us/en/products/shirt.v2",
      "/us/en/checkout/test.123/extra",
      "/logo.png",
    ]) {
      const response = await middleware(
        new NextRequest(`https://store.example${path}`),
      );
      expect(rewriteOf(response)).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

describe("H6 Final Closure: host context, wholesale-only pages, bare country, cookie attributes", () => {
  const closedPath = "/sa/ar/awj-legacy-checkout-closed";
  type Ctx = HostContext;

  const retail: Ctx = {
    state: "known",
    defaultLocale: "ar",
    wholesaleBuyer: false,
  };
  const wholesale: Ctx = {
    state: "known",
    defaultLocale: "ar",
    wholesaleBuyer: true,
  };

  function withContext(
    ctx: Ctx | "reject",
    extra: { closeUnknownHosts?: boolean } = {},
  ) {
    const resolveHostContext = vi.fn(async () => {
      if (ctx === "reject") throw new Error("boom");
      return ctx;
    });
    const mw = createStorefrontProxy({
      defaultCountry: "sa",
      defaultLocale: "ar",
      supportedLocales: ["ar", "en"],
      resolveHostContext,
      ...extra,
    });
    return { mw, resolveHostContext };
  }

  // A request path that ends in "/" keeps it on the rewritten URL; the router ignores it, so compare without it.
  const rewriteOf = (response: Response) =>
    response.headers.get("x-middleware-rewrite")?.replace(/\/$/, "") ?? null;
  const call = (mw: ReturnType<typeof withContext>["mw"], path: string) =>
    mw(new NextRequest(`https://store.example${path}`));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers a real 404 (rewrite to no route, no redirect) for a Host the API definitively does not know", async () => {
    const { mw } = withContext({ state: "unknown" });
    for (const path of ["/sa/ar", "/sa/ar/products", "/sa/en/cart"]) {
      const response = await call(mw, path);
      expect(response.headers.get("location")).toBeNull();
      expect(rewriteOf(response)).toMatch(/\/awj-legacy-checkout-closed$/);
    }
  });

  it("sets no locale cookies on an unknown Host", async () => {
    const { mw } = withContext({ state: "unknown" });
    const response = await call(mw, "/sa/ar/products");
    expect(response.cookies.get("awj_country")).toBeUndefined();
    expect(response.cookies.get("awj_locale")).toBeUndefined();
  });

  it("never closes a Host on 'unavailable' or a rejected lookup (fail open for the Host)", async () => {
    for (const ctx of [{ state: "unavailable" } as Ctx, "reject" as const]) {
      const { mw } = withContext(ctx);
      const response = await call(mw, "/sa/ar/products");
      expect(rewriteOf(response)).toBeNull();
      expect(response.status).toBe(200);
    }
  });

  it("honors the off switch for unknown Hosts", async () => {
    const { mw } = withContext(
      { state: "unknown" },
      { closeUnknownHosts: false },
    );
    const response = await call(mw, "/sa/ar/products");
    expect(rewriteOf(response)).toBeNull();
  });

  it("closes native buyer pages on a retail Host, on an unavailable lookup and on an unknown Host", async () => {
    for (const ctx of [retail, { state: "unavailable" } as Ctx]) {
      const { mw } = withContext(ctx);
      for (const path of [
        "/sa/ar/buyer/sign-in",
        "/sa/ar/buyer/orders",
        "/sa/ar/buyer/orders/abc",
        "/sa/ar/buyer/forgot-password",
        "/sa/ar/buyer/",
      ]) {
        const response = await call(mw, path);
        expect(rewriteOf(response)).toBe(`https://store.example${closedPath}`);
      }
    }
  });

  it("serves native buyer pages on a Host whose API says wholesale is open", async () => {
    const { mw } = withContext(wholesale);
    for (const path of ["/sa/ar/buyer/sign-in", "/sa/ar/buyer/orders/abc"]) {
      const response = await call(mw, path);
      expect(rewriteOf(response)).toBeNull();
      expect(response.status).toBe(200);
    }
  });

  it("does not mistake look-alike paths for buyer pages", async () => {
    const { mw } = withContext(retail);
    for (const path of ["/sa/ar/buyers-guide", "/sa/ar/products/buyer"]) {
      expect(rewriteOf(await call(mw, path))).toBeNull();
    }
  });

  it("closes the legacy /wholesale/* URLs with a real 404 on a retail Host", async () => {
    const { mw } = withContext(retail);
    for (const path of [
      "/sa/ar/wholesale",
      "/sa/ar/wholesale/sign-in",
      "/sa/ar/wholesale/apply",
      "/sa/ar/wholesale/cart",
      "/sa/ar/wholesale/quick-order",
      "/sa/ar/wholesale/products/abc",
    ]) {
      const response = await call(mw, path);
      expect(response.headers.get("location")).toBeNull();
      expect(rewriteOf(response)).toBe(`https://store.example${closedPath}`);
    }
  });

  it("redirects legacy /wholesale/* to the native equivalent on a native wholesale Host, closing the rest", async () => {
    const { mw } = withContext(wholesale);
    const cases: Array<[string, string | null]> = [
      ["/sa/ar/wholesale", "/sa/ar/buyer/sign-in"],
      ["/sa/ar/wholesale/sign-in", "/sa/ar/buyer/sign-in"],
      ["/sa/ar/wholesale/apply", "/sa/ar/buyer/membership"],
      ["/sa/ar/wholesale/cart", "/sa/ar/cart"],
      ["/sa/ar/wholesale/quick-order", "/sa/ar/buyer/quick-order"],
      ["/sa/ar/wholesale/products", "/sa/ar/products"],
      ["/sa/ar/wholesale/products/abc", "/sa/ar/products"],
      ["/sa/ar/wholesale/whatever", null],
    ];
    for (const [from, to] of cases) {
      const response = await call(mw, `${from}?x=1`);
      if (to) {
        expect(response.status).toBe(308);
        expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
          to,
        );
        expect(new URL(response.headers.get("location") ?? "").search).toBe(
          "?x=1",
        );
      } else {
        expect(rewriteOf(response)).toBe(`https://store.example${closedPath}`);
      }
    }
  });

  it("does not consult the Host context for static or non-localized requests", async () => {
    const { mw, resolveHostContext } = withContext(retail);
    await call(mw, "/_next/static/chunk.js");
    await call(mw, "/logo.png");
    expect(resolveHostContext).not.toHaveBeenCalled();
  });

  it("routes a bare country (/sa) to that market's root instead of /sa/ar/sa", async () => {
    const { mw } = withContext(retail);
    const response = await call(mw, "/sa");
    expect(response.headers.get("location")).toBe(
      "https://store.example/sa/ar",
    );
    const trailing = await call(mw, "/sa/");
    expect(new URL(trailing.headers.get("location") ?? "").pathname).toMatch(
      /^\/sa\/ar\/?$/,
    );
    const other = await call(mw, "/ae");
    expect(other.headers.get("location")).toBe("https://store.example/ae/ar");
  });

  it("keeps ordinary bare pages on the old redirect (longer than a country code)", async () => {
    const { mw } = withContext(retail);
    const response = await call(mw, "/products");
    expect(response.headers.get("location")).toBe(
      "https://store.example/sa/ar/products",
    );
  });

  it("sets the locale cookies HttpOnly, SameSite=Lax and (in production) Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { mw } = withContext(retail);
    const response = await call(mw, "/sa/ar/products");
    for (const name of ["awj_country", "awj_locale"]) {
      const cookie = response.cookies.get(name);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
      expect(cookie?.secure).toBe(true);
      expect(cookie?.path).toBe("/");
      expect(cookie?.maxAge).toBe(365 * 24 * 60 * 60);
    }
  });

  it("keeps the cookie VALUES (names, country, locale) exactly as before", async () => {
    const { mw } = withContext(retail);
    const response = await call(mw, "/sa/en/products");
    expect(response.cookies.get("awj_country")?.value).toBe("sa");
    expect(response.cookies.get("awj_locale")?.value).toBe("en");
  });
});

describe("legacy cookie-name migration (spree_country / spree_locale → awj_country / awj_locale)", () => {
  const proxy = createStorefrontProxy({
    defaultCountry: "sa",
    defaultLocale: "ar",
    supportedLocales: ["ar", "en"],
  });

  function withCookies(url: string, cookies: Record<string, string>) {
    const request = new NextRequest(url);
    for (const [name, value] of Object.entries(cookies)) {
      request.cookies.set(name, value);
    }
    return request;
  }

  it("still reads the legacy pair on a bare path, so a returning visitor keeps their market and language", async () => {
    const response = await proxy(
      withCookies("https://store.example/products", {
        spree_country: "sa",
        spree_locale: "en",
      }),
    );
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/sa/en/products",
    );
  });

  it("writes the new pair and expires the legacy pair in the same response", async () => {
    const response = await proxy(
      withCookies("https://store.example/sa/en/products", {
        spree_country: "sa",
        spree_locale: "en",
      }),
    );
    expect(response.cookies.get("awj_country")?.value).toBe("sa");
    expect(response.cookies.get("awj_locale")?.value).toBe("en");
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/spree_country=;[^\n]*Max-Age=0/i);
    expect(setCookie).toMatch(/spree_locale=;[^\n]*Max-Age=0/i);
  });

  it("prefers the new pair over a stale legacy pair", async () => {
    const response = await proxy(
      withCookies("https://store.example/products", {
        awj_country: "sa",
        awj_locale: "ar",
        spree_country: "ae",
        spree_locale: "en",
      }),
    );
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/sa/ar/products",
    );
  });

  it("sets no legacy cookie header when the browser never had one", async () => {
    const response = await proxy(
      new NextRequest("https://store.example/sa/ar/products"),
    );
    expect(response.headers.getSetCookie().join("\n")).not.toMatch(/spree_/);
  });

  it("sends a protected account page to sign-in unless an account-session cookie is present (and a stale _spree_jwt does not count)", async () => {
    const anonymous = await proxy(
      new NextRequest("https://store.example/sa/ar/account/orders"),
    );
    expect(anonymous.headers.get("location")).toContain("/sa/ar/account");

    const staleLegacy = await proxy(
      withCookies("https://store.example/sa/ar/account/orders", {
        _spree_jwt: "x",
      }),
    );
    expect(staleLegacy.headers.get("location")).toContain("/sa/ar/account");

    const signedIn = await proxy(
      withCookies("https://store.example/sa/ar/account/orders", {
        awj_account_session: "x",
      }),
    );
    expect(signedIn.headers.get("location")).toBeNull();
  });
});
