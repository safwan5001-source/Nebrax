import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BodyTooLargeError,
  createConcurrencyGate,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_BUFFERED_BYTES,
  DEFAULT_MAX_CONCURRENT,
  declaredLength,
  GateBusyError,
  HARD_MAX_BUFFERED_BYTES,
  mediaProxyLimits,
  READ_COPY_FACTOR,
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

describe("contract with the Laravel variant ceiling", () => {
  // Laravel never stores a generated file above `storefront_media.variant_max_bytes` (and the animated file is capped at its
  // own limit), so every published file must fit under this proxy bound. The PHP side is pinned by
  // StorefrontMediaVariantByteCeilingTest; this is the other half (the PHP test cannot read this file in CI).
  const config = readFileSync(
    resolve(process.cwd(), "../config/storefront_media.php"),
    "utf-8",
  );
  const mib = (expr: string) => {
    const m = expr.match(/(\d+)\s*\*\s*1024\s*\*\s*1024/);
    return m ? Number(m[1]) * 1024 * 1024 : Number.NaN;
  };

  it("keeps the default body bound above the generated-variant ceiling", () => {
    const ceiling = config.match(/'variant_max_bytes'\s*=>\s*([^,]+),/);
    expect(
      ceiling,
      "variant_max_bytes not found in config/storefront_media.php",
    ).not.toBeNull();
    expect(mib(ceiling?.[1] ?? "")).toBeLessThan(DEFAULT_MAX_BODY_BYTES);
  });

  it("keeps the default body bound above the animated upload limit", () => {
    const animated = config.match(
      /'max_bytes'\s*=>\s*\(int\) env\('STOREFRONT_MEDIA_ANIMATED_MAX_BYTES',\s*([^)]+)\)/,
    );
    expect(animated, "animated.max_bytes not found").not.toBeNull();
    expect(mib(animated?.[1] ?? "")).toBeLessThan(DEFAULT_MAX_BODY_BYTES);
  });
});

// ───────────────────────────── aggregate read budget (P2-0 review, P1) ─────────────────────────────
// Worst-case memory of the READ phase is concurrent × body bound × READ_COPY_FACTOR (the received chunks and the assembled copy
// coexist for an instant). The limits are only safe together, so `mediaProxyLimits` derives them from one budget.
const MiB = 1024 * 1024;
const env = (o: Record<string, string>) => ({
  ...(o.C !== undefined && { STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT: o.C }),
  ...(o.L !== undefined && { STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES: o.L }),
  ...(o.B !== undefined && { STOREFRONT_MEDIA_PROXY_MAX_BUFFERED_BYTES: o.B }),
});
const worstCase = (l: ReturnType<typeof mediaProxyLimits>) =>
  l.maxConcurrent * l.maxBodyBytes * READ_COPY_FACTOR;

describe("aggregate read budget", () => {
  it("defaults are unchanged and exactly fit the default budget", () => {
    const l = mediaProxyLimits({});
    expect(l).toMatchObject({
      maxConcurrent: 16,
      maxConcurrentPerHost: 8,
      maxBodyBytes: 8 * MiB,
      maxQueue: 64,
      maxBufferedBytes: 256 * MiB,
    });
    expect(DEFAULT_MAX_BUFFERED_BYTES).toBe(256 * MiB);
    expect(worstCase(l)).toBeLessThanOrEqual(l.maxBufferedBytes);
  });

  it("raising concurrency alone cannot exceed the budget: it is reduced, never the body bound", () => {
    const l = mediaProxyLimits(env({ C: "256" }));
    expect(l.maxBodyBytes).toBe(8 * MiB); // the bound that keeps published files servable is untouched
    expect(l.maxConcurrent).toBe(16);
    expect(l.maxConcurrentPerHost).toBe(8);
    expect(worstCase(l)).toBeLessThanOrEqual(l.maxBufferedBytes);
  });

  it("raising the body bound alone reduces concurrency to stay inside the budget", () => {
    const l = mediaProxyLimits(env({ L: String(32 * MiB) }));
    expect(l.maxBodyBytes).toBe(32 * MiB);
    expect(l.maxConcurrent).toBe(4); // 256 MiB / (2 × 32 MiB)
    expect(l.maxConcurrentPerHost).toBe(2);
    expect(worstCase(l)).toBeLessThanOrEqual(l.maxBufferedBytes);
  });

  it("a larger budget is an explicit opt-in and is itself hard-capped", () => {
    const opted = mediaProxyLimits(env({ C: "64", B: String(512 * MiB) }));
    expect(opted.maxConcurrent).toBe(32);
    expect(worstCase(opted)).toBeLessThanOrEqual(512 * MiB);

    const huge = mediaProxyLimits(
      env({ C: "256", L: String(32 * MiB), B: String(100 * 1024 * MiB) }),
    );
    expect(HARD_MAX_BUFFERED_BYTES).toBe(512 * MiB);
    expect(huge.maxBufferedBytes).toBe(HARD_MAX_BUFFERED_BYTES);
    expect(huge.maxConcurrent).toBe(8); // 512 MiB / (2 × 32 MiB)
    expect(worstCase(huge)).toBeLessThanOrEqual(HARD_MAX_BUFFERED_BYTES);
  });

  it("maximum overrides of every variable together stay under the hard ceiling", () => {
    const l = mediaProxyLimits({
      ...env({ C: "256", L: String(32 * MiB), B: String(512 * MiB) }),
      STOREFRONT_MEDIA_PROXY_MAX_QUEUE: "1024",
      STOREFRONT_MEDIA_PROXY_TIMEOUT_MS: "120000",
    });
    expect(l).toMatchObject({
      maxConcurrent: 8,
      maxBodyBytes: 32 * MiB,
      maxQueue: 1024,
      timeoutMs: 120_000,
    });
    expect(worstCase(l)).toBeLessThanOrEqual(HARD_MAX_BUFFERED_BYTES);
  });

  it("a body bound larger than half the budget is itself lowered, so one request always fits", () => {
    const l = mediaProxyLimits(
      env({ L: String(32 * MiB), B: String(32 * MiB) }),
    ); // 32 MiB budget ⇒ at most 16 MiB per body
    expect(l.maxBufferedBytes).toBe(32 * MiB);
    expect(l.maxBodyBytes).toBe(16 * MiB);
    expect(l.maxConcurrent).toBe(1);
    expect(worstCase(l)).toBeLessThanOrEqual(32 * MiB);
  });

  it("holds for every combination, valid or not (grid), and never starves the proxy", () => {
    const values = [
      "",
      "abc",
      "1.5",
      "-5",
      "0",
      "1",
      "64",
      "100000",
      "1e9",
      "NaN",
      " ",
      String(2 ** 53),
      "8388608",
      String(33 * MiB),
    ];
    for (const C of values) {
      for (const L of values) {
        for (const B of values) {
          const l = mediaProxyLimits(env({ C, L, B }));
          expect(worstCase(l), `C=${C} L=${L} B=${B}`).toBeLessThanOrEqual(
            Math.min(l.maxBufferedBytes, HARD_MAX_BUFFERED_BYTES),
          );
          expect(l.maxConcurrent).toBeGreaterThanOrEqual(1);
          expect(l.maxConcurrentPerHost).toBeGreaterThanOrEqual(1);
          expect(l.maxConcurrentPerHost).toBeLessThanOrEqual(l.maxConcurrent);
          expect(l.maxBodyBytes).toBeGreaterThanOrEqual(64 * 1024);
        }
      }
    }
  });

  it("invalid values fall back to the defaults (non-integers) or clamp (out-of-range) — for the budget variable too", () => {
    for (const bad of ["abc", "1.5", "", " ", "NaN"]) {
      expect(mediaProxyLimits(env({ B: bad })), bad).toMatchObject({
        maxBufferedBytes: 256 * MiB,
        maxConcurrent: 16,
      });
      expect(mediaProxyLimits(env({ C: bad })), bad).toMatchObject({
        maxConcurrent: 16,
      });
      expect(mediaProxyLimits(env({ L: bad })), bad).toMatchObject({
        maxBodyBytes: 8 * MiB,
      });
    }
    expect(mediaProxyLimits(env({ B: "1" })).maxBufferedBytes).toBe(32 * MiB);
    expect(mediaProxyLimits(env({ B: "-1" })).maxBufferedBytes).toBe(32 * MiB);
    // numeric spellings that ARE integers (existing semantics) clamp like any other number — never past the hard ceiling
    expect(mediaProxyLimits(env({ B: "1e9" })).maxBufferedBytes).toBe(
      HARD_MAX_BUFFERED_BYTES,
    );
    expect(mediaProxyLimits(env({ B: "0x10" })).maxBufferedBytes).toBe(
      32 * MiB,
    );
  });

  it("the gate built from the constrained limits still queues, sheds and fully recovers", async () => {
    const l = mediaProxyLimits({
      ...env({ C: "64", L: String(32 * MiB) }),
      STOREFRONT_MEDIA_PROXY_MAX_QUEUE: "1",
    });
    expect(l.maxConcurrent).toBe(4);
    const gate = createConcurrencyGate({ ...l, queueWaitMs: 50 });
    // four different hosts fill the instance (per-host cap is 2)
    const held = await Promise.all(
      ["a", "b", "c", "d"].map((h) => gate.acquire(h)),
    );
    expect(gate.stats()).toEqual({ active: 4, queued: 0 });
    const queued = gate.acquire("e");
    await expect(gate.acquire("f")).rejects.toBeInstanceOf(GateBusyError); // queue (1) is full ⇒ shed
    held[0]();
    (await queued)();
    for (const r of held) r();
    held[1](); // idempotent
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
    // after the burst the full constrained capacity is available again
    const again = await Promise.all(
      ["a", "b", "c", "d"].map((h) => gate.acquire(h)),
    );
    expect(gate.stats().active).toBe(4);
    for (const r of again) r();
    expect(gate.stats().active).toBe(0);
  });

  it("measured: the budget covers the instant the received chunks and the assembled copy coexist", async () => {
    // Structural check on the factor: assembling a received body needs `received` bytes of chunks AND `received` bytes of output.
    const { response, state } = chunked([MiB, MiB, MiB]);
    const out = await readBodyBounded(response, 8 * MiB);
    expect(out.byteLength).toBe(3 * MiB);
    expect(state.sent).toBe(3 * MiB);
    expect(READ_COPY_FACTOR).toBe(2);
  });
});
