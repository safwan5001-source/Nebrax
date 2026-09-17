import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStorefrontLocaleCacheForTests,
  resolveStorefrontDefaultLocaleForRequest,
} from "../edge-storefront-locale";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function requestFor(host: string): NextRequest {
  return new NextRequest(`https://${host}/`, {
    headers: { host },
  });
}

describe("edge-storefront-locale (STORE-LOCALE-WIRING-1)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal("fetch", vi.fn());
    __resetStorefrontLocaleCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not import next/headers — it is Edge-Middleware-safe by construction", async () => {
    // This module is exercised with no `next/headers` mock anywhere in this
    // file. If it depended on that Server Component API it would throw
    // outside a request-scoped AsyncLocalStorage; the fact these tests pass
    // is the runtime-compatibility proof itself.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { default_locale: "en" } }),
    );

    await expect(
      resolveStorefrontDefaultLocaleForRequest(
        requestFor("alrshd.store.example"),
      ),
    ).resolves.toBe("en");
  });

  it("resolves the current request's own Host — the authoritative transport Host", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { default_locale: "ar" } }),
    );

    await resolveStorefrontDefaultLocaleForRequest(
      requestFor("alrshd.store.example"),
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://awj-api.test/store/v1/storefront");
    expect(
      (init?.headers as Record<string, string>)["X-Storefront-Forwarded-Host"],
    ).toBe("alrshd.store.example");
  });

  it("does not bleed a cached locale across different tenant Hosts", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ data: { default_locale: "ar" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { default_locale: "en" } }));

    const localeA = await resolveStorefrontDefaultLocaleForRequest(
      requestFor("tenant-a.example"),
    );
    const localeB = await resolveStorefrontDefaultLocaleForRequest(
      requestFor("tenant-b.example"),
    );

    expect(localeA).toBe("ar");
    expect(localeB).toBe("en");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches a resolved locale for the same Host within the TTL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { default_locale: "en" } }),
    );

    const host = "alrshd.store.example";
    const first = await resolveStorefrontDefaultLocaleForRequest(
      requestFor(host),
    );
    const second = await resolveStorefrontDefaultLocaleForRequest(
      requestFor(host),
    );

    expect(first).toBe("en");
    expect(second).toBe("en");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed (returns null) on a network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    await expect(
      resolveStorefrontDefaultLocaleForRequest(
        requestFor("unreachable.example"),
      ),
    ).resolves.toBeNull();
  });

  it("fails closed on a non-OK response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 404));

    await expect(
      resolveStorefrontDefaultLocaleForRequest(
        requestFor("unknown-host.example"),
      ),
    ).resolves.toBeNull();
  });

  it("fails closed when default_locale is null (legacy/unresolved Storefront)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { default_locale: null } }),
    );

    await expect(
      resolveStorefrontDefaultLocaleForRequest(requestFor("legacy.example")),
    ).resolves.toBeNull();
  });

  it("fails closed when the response body is malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Response);

    await expect(
      resolveStorefrontDefaultLocaleForRequest(
        requestFor("broken-body.example"),
      ),
    ).resolves.toBeNull();
  });

  it("fails closed without attempting a fetch when AWJ_COMMERCE_API_URL is not configured", async () => {
    vi.unstubAllEnvs();

    await expect(
      resolveStorefrontDefaultLocaleForRequest(
        requestFor("unconfigured.example"),
      ),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
