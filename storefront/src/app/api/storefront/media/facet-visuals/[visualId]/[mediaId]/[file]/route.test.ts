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

import { FACET_VISUAL_MEDIA_CACHE_CONTROL, GET } from "./route";

const VISUAL = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const MEDIA = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

const fetchMock = vi.fn();

function call(
  visualId: string,
  mediaId: string,
  file: string,
  init?: RequestInit,
) {
  return GET(
    new Request(
      `https://shop.example.com/api/storefront/media/facet-visuals/${visualId}/${mediaId}/${file}`,
      init,
    ),
    { params: Promise.resolve({ visualId, mediaId, file }) },
  );
}

function image(status: number, headers: Record<string, string> = {}) {
  return new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, {
    status,
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, no-store",
      etag: '"abc"',
      ...headers,
    },
  });
}

describe("facet visual media proxy — N14 (AWJ-VD-H1 VD-1c, D3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    hostHeader.value = "shop.example.com";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.example.com");
  });

  it("forwards the visitor host and gateway secret and caches a 200 for at most 300 s", async () => {
    fetchMock.mockResolvedValue(image(200));

    const response = await call(VISUAL, MEDIA, "480w.webp");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      FACET_VISUAL_MEDIA_CACHE_CONTROL,
    );
    expect(FACET_VISUAL_MEDIA_CACHE_CONTROL).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.example.com/store/v1/media/facet-visuals/${VISUAL}/${MEDIA}/480w.webp`,
    );
    expect(JSON.stringify(init.headers)).toContain("shop.example.com");
    expect(JSON.stringify(init.headers)).toContain("gw-secret");
    expect(init.cache).toBe("no-store");
  });

  it("revalidation after the 300 s window reaches the origin: a re-authorized 304 is cached again, a refused one becomes an uncached 404", async () => {
    // Re-authorized: the origin ran every guard and answered 304.
    fetchMock.mockResolvedValueOnce(image(304));
    const fresh = await call(VISUAL, MEDIA, "480w.webp", {
      headers: { "If-None-Match": '"abc"' },
    });
    expect(fetchMock.mock.calls[0][1].headers["If-None-Match"]).toBe('"abc"');
    expect(fresh.status).toBe(304);
    expect(fresh.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate",
    );
    expect(fresh.headers.get("etag")).toBe('"abc"');
    expect(fresh.headers.get("x-content-type-options")).toBe("nosniff");

    // The image stopped being authorized (N7 at the origin): the same
    // conditional request is a 404 and nothing of it is cacheable.
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"code":"not_found"}}', {
        status: 404,
        headers: { "cache-control": "no-store" },
      }),
    );
    const refused = await call(VISUAL, MEDIA, "480w.webp", {
      headers: { "If-None-Match": '"abc"' },
    });
    expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBe('"abc"');
    expect(refused.status).toBe(404);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(refused.headers.get("etag")).toBeNull();
    expect(await refused.text()).toBe("");
  });

  it("never caches a 404 or a 5xx, and never forwards an unexpected status", async () => {
    for (const [origin, expected] of [
      [404, 404],
      [500, 502],
      [503, 502],
      [403, 502],
      [301, 502],
      [206, 502],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: origin,
          headers: { "cache-control": "public, max-age=999", etag: '"x"' },
        }),
      );
      const response = await call(VISUAL, MEDIA, "480w.webp");
      expect(response.status, String(origin)).toBe(expected);
      expect(response.headers.get("cache-control"), String(origin)).toBe(
        "no-store",
      );
      expect(response.headers.get("etag"), String(origin)).toBeNull();
    }
  });

  it("refuses a 200 that is not an image the origin serves", async () => {
    fetchMock.mockResolvedValue(image(200, { "content-type": "text/html" }));
    const response = await call(VISUAL, MEDIA, "480w.webp");
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects malformed params before contacting the origin", async () => {
    for (const [visualId, mediaId, file] of [
      [VISUAL, MEDIA, "original.jpg"],
      [VISUAL, MEDIA, "1200w.webp"],
      [VISUAL, MEDIA, "480w.png"],
      [VISUAL, MEDIA, "../480w.webp"],
      [VISUAL, MEDIA, "..%2F480w.webp"],
      [VISUAL, `${MEDIA}/x`, "480w.webp"],
      ["not-a-uuid", MEDIA, "480w.webp"],
      [VISUAL.toUpperCase(), MEDIA, "480w.webp"],
      [VISUAL, "..", "480w.webp"],
      [VISUAL, MEDIA, ""],
    ]) {
      const response = await call(visualId, mediaId, file);
      expect(response.status, `${visualId}/${mediaId}/${file}`).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing without a visitor host", async () => {
    hostHeader.value = null;
    const response = await call(VISUAL, MEDIA, "480w.webp");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
