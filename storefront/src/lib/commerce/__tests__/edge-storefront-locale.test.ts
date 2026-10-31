import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStorefrontLocaleCacheForTests,
  resolveHostContextForRequest,
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

describe("resolveHostContextForRequest (H6 Final Closure)", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubGlobal("fetch", vi.fn());
    __resetStorefrontLocaleCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const unresolved = () =>
    jsonResponse(
      {
        error: { code: "not_found", message: "تعذّر تحديد متجر صالح." },
        meta: { request_id: "r" },
      },
      false,
      404,
    );

  it("reports a known Host with its locale and the wholesale capability", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: { default_locale: "ar", capabilities: { wholesale_buyer: true } },
      }),
    );
    await expect(
      resolveHostContextForRequest(requestFor("ws.example")),
    ).resolves.toEqual({
      state: "known",
      defaultLocale: "ar",
      wholesaleBuyer: true,
    });
  });

  it("treats a missing or non-literal capability as closed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          default_locale: "en",
          capabilities: { wholesale_buyer: "yes" },
        },
      }),
    );
    await expect(
      resolveHostContextForRequest(requestFor("retail.example")),
    ).resolves.toMatchObject({ state: "known", wholesaleBuyer: false });
  });

  it("recognizes only the API's definitive 'no valid store' answer as an unknown Host", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(unresolved());
    await expect(
      resolveHostContextForRequest(requestFor("nobody.example")),
    ).resolves.toEqual({ state: "unknown" });
  });

  it("does NOT call a Host unknown on any other failure (route 404, wrong service, 5xx, bad body, network, no config)", async () => {
    const cases: Array<() => void> = [
      // Laravel's own unmatched-route 404 shares the code but names the route
      () =>
        vi.mocked(fetch).mockResolvedValueOnce(
          jsonResponse(
            {
              error: {
                code: "not_found",
                message: "The route store/v1/storefront could not be found.",
              },
            },
            false,
            404,
          ),
        ),
      // a different service answering 404 (HTML / empty / other envelope)
      () =>
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 404)),
      () =>
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => {
            throw new Error("html");
          },
        } as unknown as Response),
      () =>
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 500)),
      () =>
        vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, false, 403)),
      () => vi.mocked(fetch).mockRejectedValueOnce(new Error("network down")),
    ];
    let i = 0;
    for (const arrange of cases) {
      arrange();
      await expect(
        resolveHostContextForRequest(requestFor(`case-${i++}.example`)),
      ).resolves.toEqual({ state: "unavailable" });
    }
    vi.unstubAllEnvs();
    await expect(
      resolveHostContextForRequest(requestFor("noconfig.example")),
    ).resolves.toEqual({ state: "unavailable" });
  });

  it("makes one API call for concurrent requests on a cold Host", async () => {
    let release: (r: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const req = requestFor("burst.example");
    const all = Promise.all([
      resolveHostContextForRequest(req),
      resolveHostContextForRequest(req),
      resolveHostContextForRequest(req),
    ]);
    release(jsonResponse({ data: { default_locale: "ar" } }));
    const results = await all;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("keeps the last definitive answer through a failed refresh, but not forever", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: { default_locale: "ar", capabilities: { wholesale_buyer: true } },
      }),
    );
    const req = requestFor("blip.example");
    await expect(resolveHostContextForRequest(req)).resolves.toMatchObject({
      wholesaleBuyer: true,
    });

    // the 60 s cache expires, the refresh fails: the Host keeps its capability
    vi.setSystemTime(Date.now() + 61_000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("blip"));
    await expect(resolveHostContextForRequest(req)).resolves.toMatchObject({
      state: "known",
      wholesaleBuyer: true,
    });

    // …and a later success replaces it
    vi.setSystemTime(Date.now() + 61_000);
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          default_locale: "ar",
          capabilities: { wholesale_buyer: false },
        },
      }),
    );
    await expect(resolveHostContextForRequest(req)).resolves.toMatchObject({
      wholesaleBuyer: false,
    });

    // an outage longer than the stale window finally degrades to 'unavailable'
    vi.setSystemTime(Date.now() + 61_000);
    vi.mocked(fetch).mockRejectedValue(new Error("down"));
    vi.setSystemTime(Date.now() + 700_000);
    await expect(resolveHostContextForRequest(req)).resolves.toEqual({
      state: "unavailable",
    });
  });

  it("does not bleed a context across Hosts", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({ data: { capabilities: { wholesale_buyer: true } } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: {} }));
    const a = await resolveHostContextForRequest(requestFor("a.example"));
    const b = await resolveHostContextForRequest(requestFor("b.example"));
    expect(a).toMatchObject({ wholesaleBuyer: true });
    expect(b).toMatchObject({ wholesaleBuyer: false });
  });
});
