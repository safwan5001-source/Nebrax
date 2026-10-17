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

describe("customizer media proxy — animated file (AWJ-ANIMATED-MEDIA P1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    hostHeader.value = "shop.example.com";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.example.com");
  });

  it("forwards animated.gif / animated.webp for a media id with the same cache contract", async () => {
    for (const [file, type] of [
      ["animated.gif", "image/gif"],
      ["animated.webp", "image/webp"],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        new Response(new Uint8Array([71, 73, 70]), {
          status: 200,
          headers: { "content-type": type, etag: '"e"' },
        }),
      );
      const response = await call(UUID, file);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("cache-control")).toBe(
        CUSTOMIZER_MEDIA_CACHE_CONTROL,
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        `/media/customizer/${UUID}/${file}`,
      );
    }
  });

  it("never forwards the animated file for a transform key, or any other extension", async () => {
    expect((await call(KEY, "animated.gif")).status).toBe(404);
    expect((await call(UUID, "animated.png")).status).toBe(404);
    expect((await call(UUID, "animated.GIF")).status).toBe(404);
    expect((await call(UUID, "original.gif")).status).toBe(404);
    expect((await call(UUID, "animated.gif.php")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a gate refusal through as 404 (unpublished / other tenant)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await call(UUID, "animated.gif")).status).toBe(404);
  });
});

// ───────────────────────────── AWJ-ANIMATED-MEDIA P2-0 ─────────────────────────────
// The buffered image path is now bounded and guarded; nothing about its contract (headers, cache, auth boundaries) changed.

import { afterEach } from "vitest";
import {
  resetConstrainedWarning,
  resetSharedMediaProxyGate,
} from "@/lib/commerce/media-proxy-guard";

const BOUND = 65_536; // the smallest bound the environment may set

function bodyOf(size: number, fill = 9) {
  return new Uint8Array(size).fill(fill);
}

function streamOf(sizes: number[]) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= sizes.length) return controller.close();
      controller.enqueue(bodyOf(sizes[i++]));
    },
  });
}

/** A fetch that stays pending until `settle` is called, and rejects like fetch does when its signal aborts. */
function deferredFetch() {
  const pending: Array<{
    settle: (r: Response) => void;
    init: RequestInit;
  }> = [];
  fetchMock.mockImplementation(
    (_url: unknown, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ settle: resolve, init });
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  return pending;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("customizer media proxy — P2-0 bounded buffering", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetSharedMediaProxyGate();
    hostHeader.value = "shop.example.com";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.example.com");
    vi.stubEnv("STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES", String(BOUND));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("serves a normal GIF, animated WebP and static JPEG/WebP byte-for-byte with the unchanged headers", async () => {
    const cases = [
      [UUID, "animated.gif", "image/gif"],
      [UUID, "animated.webp", "image/webp"],
      [UUID, "1280w.jpg", "image/jpeg"],
      [KEY, "768w.webp", "image/webp"],
    ] as const;
    for (const [id, file, type] of cases) {
      const payload = bodyOf(40_000, file.length);
      fetchMock.mockResolvedValueOnce(
        new Response(payload, {
          status: 200,
          headers: { "content-type": type, etag: '"e1"' },
        }),
      );
      const response = await call(id, file);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("etag")).toBe('"e1"');
      expect(response.headers.get("cache-control")).toBe(
        CUSTOMIZER_MEDIA_CACHE_CONTROL,
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
    }
  });

  it("still buffers: the visitor gets one complete body, never the origin's stream", async () => {
    const origin = new Response(streamOf([1000, 1000, 1000]), {
      headers: { "content-type": "image/webp" },
    });
    fetchMock.mockResolvedValue(origin);
    const response = await call(UUID, "480w.webp");
    expect(response.body).not.toBe(origin.body);
    expect((await response.arrayBuffer()).byteLength).toBe(3000);
  });

  it("accepts a body of exactly the bound", async () => {
    fetchMock.mockResolvedValue(
      new Response(bodyOf(BOUND), { headers: { "content-type": "image/gif" } }),
    );
    const response = await call(UUID, "animated.gif");
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(BOUND);
  });

  const expectUniformFailure = async (response: Response, status = 502) => {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  };

  it("refuses an origin Content-Length above the bound with a uniform 502, and gives up on the origin body unread", async () => {
    let cancelled = false;
    let consumed = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        // the stream machinery may prefetch one chunk; what matters is that nothing is drained
        consumed += 1;
        c.enqueue(bodyOf(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: {
          "content-type": "image/webp",
          "content-length": String(BOUND * 100),
        },
      }),
    );
    await expectUniformFailure(await call(UUID, "480w.webp"));
    expect(cancelled).toBe(true);
    expect(consumed).toBeLessThanOrEqual(2);
  });

  it("bounds a body with NO Content-Length (chunked) by the bytes actually received", async () => {
    fetchMock.mockResolvedValue(
      new Response(streamOf(new Array(50).fill(10_000)), {
        headers: { "content-type": "image/webp" },
      }),
    );
    await expectUniformFailure(await call(UUID, "480w.webp"));
  });

  it("bounds a body whose Content-Length UNDERSTATES its size", async () => {
    fetchMock.mockResolvedValue(
      new Response(bodyOf(BOUND * 3), {
        headers: { "content-type": "image/gif", "content-length": "12" },
      }),
    );
    await expectUniformFailure(await call(UUID, "animated.gif"));
  });

  it("a mid-body origin failure is a uniform 502, not a half-answer", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error("ECONNRESET 10.1.2.3:8080 gw-secret"));
      },
    });
    fetchMock.mockResolvedValue(new Response(body));
    await expectUniformFailure(await call(UUID, "480w.webp"));
  });
});

describe("customizer media proxy — P2-0 concurrency", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetSharedMediaProxyGate();
    hostHeader.value = "shop.example.com";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.example.com");
    // 2 slots ⇒ one host may hold 1; the queue holds 1
    vi.stubEnv("STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT", "2");
    vi.stubEnv("STOREFRONT_MEDIA_PROXY_MAX_QUEUE", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const ok = (n = 3) =>
    new Response(bodyOf(n), { headers: { "content-type": "image/webp" } });

  it("excess simultaneous requests wait, then are shed with an uncached 503 + Retry-After; origin load stays within the limit", async () => {
    const pending = deferredFetch();
    const first = call(UUID, "480w.webp");
    await flush();
    const queued = call(UUID, "768w.webp");
    await flush();
    const shed = await call(UUID, "1280w.webp");

    expect(shed.status).toBe(503);
    expect(shed.headers.get("cache-control")).toBe("no-store");
    expect(shed.headers.get("retry-after")).toBe("2");
    expect(await shed.text()).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the shed and the queued request never reached Laravel

    pending[0].settle(ok());
    expect((await first).status).toBe(200);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2); // the queued one runs once the slot is free
    pending[1].settle(ok());
    expect((await queued).status).toBe(200);
  });

  it("recovers: after a burst (including failures) a fresh request is served immediately", async () => {
    const pending = deferredFetch();
    const a = call(UUID, "480w.webp");
    await flush();
    const b = call(UUID, "768w.webp");
    await flush();
    expect((await call(UUID, "1280w.webp")).status).toBe(503);

    pending[0].settle(new Response("boom", { status: 500 })); // origin failure frees the slot
    expect((await a).status).toBe(502);
    await flush();
    pending[1].settle(ok());
    expect((await b).status).toBe(200);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
    expect((await call(UUID, "1920w.webp")).status).toBe(200);
  });

  it("an over-budget configuration is fitted (64 requested × 32 MiB ⇒ 1 slot × 16 MiB) and still queues, sheds and recovers", async () => {
    resetConstrainedWarning();
    vi.stubEnv("STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT", "64");
    vi.stubEnv(
      "STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES",
      String(32 * 1024 * 1024),
    );
    vi.stubEnv(
      "STOREFRONT_MEDIA_PROXY_MAX_BUFFERED_BYTES",
      String(32 * 1024 * 1024),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const pending = deferredFetch();
    const first = call(UUID, "480w.webp");
    await flush();
    const queued = call(UUID, "768w.webp");
    await flush();
    const shed = await call(UUID, "1280w.webp");
    expect(shed.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one slot, not 64: the budget lowered the concurrency

    pending[0].settle(ok());
    expect((await first).status).toBe(200);
    await flush();
    pending[1].settle(ok());
    expect((await queued).status).toBe(200);

    // recovered: a fresh request is served at once, and the constraint was reported once (not per request), without host/secret
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
    expect((await call(UUID, "1920w.webp")).status).toBe(200);
    const constrained = warn.mock.calls.filter((c) =>
      String(c[0]).includes("exceed the read-memory budget"),
    );
    expect(constrained).toHaveLength(1);
    expect(JSON.stringify(constrained[0])).not.toMatch(
      /gw-secret|shop\.example\.com|api\.example\.com/,
    );
  });

  it("a visitor who disconnects frees the slot and cancels the origin request", async () => {
    const pending = deferredFetch();
    const controller = new AbortController();
    const gone = call(UUID, "480w.webp", { signal: controller.signal });
    await flush();
    expect(pending[0].init.signal?.aborted).toBe(false);
    controller.abort();
    expect((await gone).status).toBe(502); // nobody is listening; the point is the slot
    expect(pending[0].init.signal?.aborted).toBe(true);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
    expect((await call(UUID, "768w.webp")).status).toBe(200);
  });

  it("a stuck origin hits the deadline (uniform 502) and its slot comes back", async () => {
    vi.stubEnv("STOREFRONT_MEDIA_PROXY_TIMEOUT_MS", "1000");
    resetSharedMediaProxyGate();
    deferredFetch(); // never settles
    const started = Date.now();
    const response = await call(UUID, "480w.webp");
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
    expect((await call(UUID, "768w.webp")).status).toBe(200);
  }, 10_000);

  it("requests rejected by the contract (bad id/file, no Host) never take a slot or reach the origin", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await call("nope", "480w.webp")).status).toBe(404);
      expect((await call(UUID, "original.jpg")).status).toBe(404);
    }
    hostHeader.value = null;
    expect((await call(UUID, "480w.webp")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    hostHeader.value = "shop.example.com";
    fetchMock.mockResolvedValue(ok());
    expect((await call(UUID, "480w.webp")).status).toBe(200);
  });

  it("a 304 revalidation takes and returns a slot like any other round-trip", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: '"abc"' } }),
    );
    for (let i = 0; i < 6; i += 1) {
      const response = await call(UUID, "480w.webp", {
        headers: { "if-none-match": '"abc"' },
      });
      expect(response.status).toBe(304);
    }
  });
});

describe("customizer media proxy — P2-0 failures leak nothing and boundaries are unchanged", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetSharedMediaProxyGate();
    hostHeader.value = "shop.example.com";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "gw-secret");
    vi.stubEnv("AWJ_COMMERCE_API_URL", "https://api.example.com");
    vi.stubEnv("STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES", String(BOUND));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const SECRETS = ["gw-secret", "api.example.com", "10.1.2.3", "/store/v1"];
  const noLeak = (text: string) => {
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  };

  it("a network error is a uniform 502 with no message, URL, host or secret anywhere in the response", async () => {
    fetchMock.mockRejectedValue(
      new TypeError(
        "fetch failed: connect ECONNREFUSED 10.1.2.3:443 https://api.example.com/store/v1/media gw-secret",
      ),
    );
    const response = await call(UUID, "480w.webp");
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const dump =
      JSON.stringify([...response.headers]) + (await response.text());
    noLeak(dump);
    expect(await response.text()).toBe("");
  });

  it("an origin 5xx with a revealing body is replaced by an empty 502", async () => {
    fetchMock.mockResolvedValue(
      new Response("Whoops: SQLSTATE[08006] at /app/Http/Foo.php gw-secret", {
        status: 500,
        headers: { "x-powered-by": "PHP/8.3", server: "Apache/2.4" },
      }),
    );
    const response = await call(UUID, "480w.webp");
    expect(response.status).toBe(502);
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("server")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("origin 401/403/404 (gate refusal, wrong tenant, unpublished) never reveal which: 404 stays 404, the rest is the uniform 502", async () => {
    for (const [status, expected] of [
      [404, 404],
      [403, 502],
      [401, 502],
      [429, 502],
    ] as const) {
      fetchMock.mockResolvedValueOnce(new Response("denied", { status }));
      const response = await call(UUID, "480w.webp");
      expect(response.status).toBe(expected);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }
  });

  it("the oversize warning is server-side only and carries no host, URL or secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(
      new Response(bodyOf(BOUND + 1), {
        headers: { "content-type": "image/webp" },
      }),
    );
    const response = await call(UUID, "480w.webp");
    expect(response.status).toBe(502);
    expect(warn).toHaveBeenCalledTimes(1);
    noLeak(JSON.stringify(warn.mock.calls[0]));
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain(
      "shop.example.com",
    );
  });

  it("tenant/storefront resolution is still the origin's alone: the visitor host and gateway secret are forwarded verbatim, per request", async () => {
    fetchMock.mockResolvedValue(
      new Response(bodyOf(10), { headers: { "content-type": "image/webp" } }),
    );
    hostHeader.value = "alpha.example.com";
    await call(UUID, "480w.webp");
    hostHeader.value = "beta.example.com";
    await call(UUID, "480w.webp");
    const sent = fetchMock.mock.calls.map(([, init]) => init.headers);
    expect(sent[0]["X-Storefront-Forwarded-Host"]).toBe("alpha.example.com");
    expect(sent[1]["X-Storefront-Forwarded-Host"]).toBe("beta.example.com");
    for (const headers of sent) {
      expect(headers["X-Storefront-Gateway-Secret"]).toBe("gw-secret");
    }
    // nothing about the body is shared between hosts: each answer is its own buffer
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("no gateway secret configured ⇒ none is sent (unchanged); the animated file still refuses a transform key", async () => {
    vi.stubEnv("STOREFRONT_GATEWAY_SECRET", "");
    fetchMock.mockResolvedValue(new Response(bodyOf(5)));
    await call(UUID, "480w.webp");
    expect(
      fetchMock.mock.calls[0][1].headers["X-Storefront-Gateway-Secret"],
    ).toBeUndefined();
    fetchMock.mockClear();
    expect((await call(KEY, "animated.gif")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
