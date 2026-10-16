import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BodyTooLargeError,
  createConcurrencyGate,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_CONCURRENT,
  declaredLength,
  GateBusyError,
  mediaProxyLimits,
  readBodyBounded,
} from "./media-proxy-guard";

/** A response whose body is produced chunk by chunk; `cancelled` tells whether the reader gave up early. */
function chunked(sizes: number[], headers: Record<string, string> = {}) {
  const state = { sent: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= sizes.length) return controller.close();
      const size = sizes[i++];
      state.sent += size;
      controller.enqueue(new Uint8Array(size).fill(7));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body, { headers }), state };
}

describe("mediaProxyLimits", () => {
  it("has safe defaults and ignores malformed or out-of-range overrides", () => {
    expect(mediaProxyLimits({})).toMatchObject({
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
    });
    expect(
      mediaProxyLimits({
        STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT: "abc",
        STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES: "1.5",
      }),
    ).toMatchObject({
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    });
  });

  it("clamps overrides so a typo can neither disable the bound nor starve the proxy", () => {
    const l = mediaProxyLimits({
      STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT: "100000",
      STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES: "1",
      STOREFRONT_MEDIA_PROXY_TIMEOUT_MS: "1",
    });
    expect(l.maxConcurrent).toBe(256);
    expect(l.maxBodyBytes).toBe(64 * 1024);
    expect(l.timeoutMs).toBe(1_000);
    expect(
      mediaProxyLimits({ STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT: "0" })
        .maxConcurrent,
    ).toBe(1);
  });

  it("a single host may use at most half the slots (at least one)", () => {
    expect(
      mediaProxyLimits({ STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT: "16" })
        .maxConcurrentPerHost,
    ).toBe(8);
    expect(
      mediaProxyLimits({ STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT: "1" })
        .maxConcurrentPerHost,
    ).toBe(1);
  });
});

describe("declaredLength", () => {
  it("reads only a plain non-negative integer", () => {
    expect(declaredLength(new Headers({ "content-length": "1234" }))).toBe(
      1234,
    );
    expect(declaredLength(new Headers())).toBeNull();
    for (const bad of ["-1", "1e9", "12 34", "abc", "0x10", ""]) {
      expect(declaredLength(new Headers({ "content-length": bad }))).toBeNull();
    }
  });
});

describe("readBodyBounded", () => {
  it("returns the exact bytes of a normal body (chunks reassembled in order)", async () => {
    const parts = [
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5, 6]),
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    });
    const out = await readBodyBounded(new Response(stream), 1024);
    expect([...out]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("accepts a body of exactly the bound and refuses one byte more", async () => {
    expect(
      (await readBodyBounded(chunked([100, 100]).response, 200)).byteLength,
    ).toBe(200);
    await expect(
      readBodyBounded(chunked([100, 101]).response, 200),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("an empty or bodiless response is an empty buffer", async () => {
    expect((await readBodyBounded(new Response(null), 10)).byteLength).toBe(0);
    expect((await readBodyBounded(new Response(""), 10)).byteLength).toBe(0);
  });

  it("refuses a Content-Length above the bound WITHOUT reading the body", async () => {
    const { response, state } = chunked([10], { "content-length": "999999" });
    await expect(readBodyBounded(response, 1000)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
    expect(state.sent).toBe(0);
    expect(state.cancelled).toBe(true);
  });

  it("a MISSING Content-Length (chunked) is bounded by the bytes actually received, and the origin is cancelled early", async () => {
    const { response, state } = chunked(new Array(100).fill(1000)); // 100 kB, no header
    await expect(readBodyBounded(response, 2500)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
    expect(state.cancelled).toBe(true);
    expect(state.sent).toBeLessThan(10_000); // gave up after a few chunks, did not drain 100 kB
  });

  it("a MISLEADING (understated) Content-Length cannot smuggle a big body past the bound", async () => {
    const { response } = chunked([4000], { "content-length": "10" });
    await expect(readBodyBounded(response, 1000)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("an overstated Content-Length that is still within the bound is accepted (the real size is what counts)", async () => {
    const { response } = chunked([50], { "content-length": "900" });
    expect((await readBodyBounded(response, 1000)).byteLength).toBe(50);
  });

  it("propagates a mid-stream origin failure (the route turns it into a uniform 502)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error("socket hang up"));
      },
    });
    await expect(readBodyBounded(new Response(stream), 1000)).rejects.toThrow(
      "socket hang up",
    );
  });
});

describe("createConcurrencyGate", () => {
  afterEach(() => vi.useRealTimers());
  const limits = {
    maxConcurrent: 2,
    maxConcurrentPerHost: 2,
    maxQueue: 2,
    queueWaitMs: 1000,
  };

  it("grants up to the limit at once and counts active slots", async () => {
    const gate = createConcurrencyGate(limits);
    const a = await gate.acquire("a");
    const b = await gate.acquire("b");
    expect(gate.stats()).toEqual({ active: 2, queued: 0 });
    a();
    b();
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("queues beyond the limit and hands the freed slot to the waiter; release is idempotent", async () => {
    const gate = createConcurrencyGate(limits);
    const a = await gate.acquire("a");
    await gate.acquire("b");
    const waiting = gate.acquire("c");
    expect(gate.stats()).toEqual({ active: 2, queued: 1 });
    a();
    a(); // second call must not free a second slot
    const c = await waiting;
    expect(gate.stats()).toEqual({ active: 2, queued: 0 });
    c();
  });

  it("rejects when the queue is full (load is shed, not accumulated)", async () => {
    const gate = createConcurrencyGate(limits);
    await gate.acquire("a");
    await gate.acquire("b");
    void gate.acquire("c").catch(() => undefined);
    void gate.acquire("d").catch(() => undefined);
    await expect(gate.acquire("e")).rejects.toBeInstanceOf(GateBusyError);
    expect(gate.stats().queued).toBe(2);
  });

  it("a waiter gives up after the wait deadline and leaves the queue; the gate then recovers", async () => {
    vi.useFakeTimers();
    const gate = createConcurrencyGate(limits);
    const a = await gate.acquire("a");
    await gate.acquire("b");
    const waiting = gate.acquire("c");
    const assertion = expect(waiting).rejects.toBeInstanceOf(GateBusyError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(gate.stats().queued).toBe(0);
    a();
    const again = await gate.acquire("c");
    expect(gate.stats().active).toBe(2);
    again();
  });

  it("a waiter whose visitor disconnects leaves the queue and never takes a slot", async () => {
    const gate = createConcurrencyGate(limits);
    const a = await gate.acquire("a");
    await gate.acquire("b");
    const controller = new AbortController();
    const waiting = gate.acquire("c", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(GateBusyError);
    expect(gate.stats()).toEqual({ active: 2, queued: 0 });
    a();
    expect(gate.stats().active).toBe(1);
    await expect(gate.acquire("x", AbortSignal.abort())).rejects.toBeInstanceOf(
      GateBusyError,
    );
  });

  it("one host cannot take every slot (noisy-neighbour protection); another host still gets through", async () => {
    const gate = createConcurrencyGate({
      maxConcurrent: 4,
      maxConcurrentPerHost: 2,
      maxQueue: 8,
      queueWaitMs: 1000,
    });
    const first = await gate.acquire("noisy");
    await gate.acquire("noisy");
    const third = gate.acquire("noisy"); // queued: noisy is at its cap although 2 slots are free
    expect(gate.stats()).toEqual({ active: 2, queued: 1 });
    const other = await gate.acquire("quiet"); // not blocked behind the noisy host
    expect(gate.stats().active).toBe(3);
    first();
    const granted = await third; // freed noisy slot goes to the noisy waiter
    expect(gate.stats()).toEqual({ active: 3, queued: 0 });
    other();
    granted();
  });

  it("recovers fully after a burst: every slot returns even when work fails", async () => {
    const gate = createConcurrencyGate(limits);
    const runs = Array.from({ length: 6 }, async (_, i) => {
      const release = await gate.acquire(`h${i % 3}`).catch(() => null);
      if (!release) return "shed";
      try {
        if (i % 2) throw new Error("origin failed");
        return "ok";
      } catch {
        return "failed";
      } finally {
        release();
      }
    });
    const outcomes = await Promise.all(runs);
    expect(outcomes.filter((o) => o === "shed").length).toBeLessThanOrEqual(2);
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
    const fresh = await gate.acquire("after");
    fresh();
  });
});
