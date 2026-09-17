import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createSpreeMiddleware } from "@/lib/spree/middleware";

const middleware = createSpreeMiddleware({
  defaultCountry: "us",
  defaultLocale: "en",
  supportedLocales: ["en", "de", "zh-CN"],
});

describe("Spree locale middleware", () => {
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
    expect(response.cookies.get("spree_country")?.value).toBe("us");
    expect(response.cookies.get("spree_locale")?.value).toBe("en");
  });

  it("falls back to a supported locale when the configured default is unavailable", async () => {
    const invalidDefaultMiddleware = createSpreeMiddleware({
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
      response.headers.get("x-middleware-request-x-spree-request-pathname"),
    ).toBe("/ar/en/products/coffee");
    expect(
      response.headers.get("x-middleware-request-x-spree-request-search"),
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
    "_spree_jwt",
    "_spree_refresh_token",
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
    request.cookies.set("_spree_jwt", "");

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/us/en/account?");
  });
});

describe("Spree locale middleware — Storefront default locale (STORE-LOCALE-WIRING-1)", () => {
  function middlewareWithResolver(
    resolveStorefrontLocale: (
      request: NextRequest,
    ) => Promise<string | null | undefined>,
  ) {
    return createSpreeMiddleware({
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

  it("lets an existing spree_locale cookie override the Storefront's default locale", async () => {
    const resolver = vi.fn().mockResolvedValue("en");
    const middleware = middlewareWithResolver(resolver);

    const request = new NextRequest("https://alrshd.store.example/");
    request.cookies.set("spree_locale", "ar");

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
    request.cookies.set("spree_locale", "en");

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
