import { beforeEach, describe, expect, it, vi } from "vitest";

const hostHeader = vi.hoisted(() => ({
  value: "shop.example.com" as string | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "host" ? hostHeader.value : null,
  }),
}));

import { CUSTOMIZER_MEDIA_CACHE_CONTROL, GET } from "./route";

const UUID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const fetchMock = vi.fn();

function call(id: string, file: string, init?: RequestInit) {
  return GET(
    new Request(
      `https://shop.example.com/api/storefront/media/customizer/${id}/${file}`,
      init,
    ),
    {
      params: Promise.resolve({ id, file }),
    },
  );
}

describe("customizer media proxy (AMEND-1/4/12/16)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    hostHeader.value = "shop.example.com";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.example.com");
  });

  it("forwards the visitor host and gateway secret, and is the only layer that sets a public cache header", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        // the origin says private/no-store; the proxy must not copy that
        headers: {
          "content-type": "image/webp",
          "cache-control": "private, no-store",
          etag: '"abc"',
        },
      }),
    );

    const response = await call(UUID, "480w.webp");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      CUSTOMIZER_MEDIA_CACHE_CONTROL,
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      `/store/v1/media/customizer/${UUID}/480w.webp`,
    );
    expect(JSON.stringify(init.headers)).toContain("shop.example.com");
    expect(JSON.stringify(init.headers)).toContain("gw-secret");
    expect(init.cache).toBe("no-store");
  });

  it("revalidation still reaches the origin gate: If-None-Match is forwarded and a 304 stays a 304", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: '"abc"' } }),
    );

    const response = await call(KEY, "768w.jpg", {
      headers: { "if-none-match": '"abc"' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["If-None-Match"]).toBe('"abc"');
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("cache-control")).toBe(
      CUSTOMIZER_MEDIA_CACHE_CONTROL,
    );
  });

  it("an unpublished/deleted/foreign id (origin 404) is never given a public cache header", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 404,
        headers: { "cache-control": "public, max-age=3600" },
      }),
    );

    const response = await call(UUID, "480w.webp");

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("turns any other origin failure into an uncached 502, never a cacheable error", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    const response = await call(UUID, "480w.webp");

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects malformed ids and files before anything is forwarded", async () => {
    for (const [id, file] of [
      ["not-an-id", "480w.webp"],
      [UUID, "original.jpg"],
      [UUID, "480w.png"],
      [`${KEY}0`, "480w.webp"],
      ["..%2f..", "480w.webp"],
    ]) {
      expect((await call(id, file)).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s without a Host header (the origin could not resolve a storefront anyway)", async () => {
    hostHeader.value = null;
    expect((await call(UUID, "480w.webp")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
