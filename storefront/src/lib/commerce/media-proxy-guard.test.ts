import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BodyTooLargeError,
  createConcurrencyGate,
  DEFAULT_DELIVERY_TIMEOUT_MS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_BUFFERED_BYTES,
  DEFAULT_MAX_CONCURRENT,
  DELIVERY_CHUNK_BYTES,
  DeliveryDeadlineError,
  declaredLength,
  deliverBuffered,
  GateBusyError,
  HARD_MAX_BUFFERED_BYTES,
  MIN_DELIVERY_CHARGE_BYTES,
  MIN_MAX_BODY_BYTES,
  MIN_MAX_BUFFERED_BYTES,
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
    // 100000 concurrent is clamped to 256, then fitted into the 256 MiB budget at the 6 MiB floor: ⌊256 / (2 × 6)⌋ = 21
    expect(l.maxConcurrent).toBe(21);
    expect(l.maxBodyBytes).toBe(MIN_MAX_BODY_BYTES);
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
    expect(gate.stats()).toEqual({ active: 2, queued: 0, bytes: 0 });
    a();
    b();
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
  });

  it("queues beyond the limit and hands the freed slot to the waiter; release is idempotent", async () => {
    const gate = createConcurrencyGate(limits);
    const a = await gate.acquire("a");
    await gate.acquire("b");
    const waiting = gate.acquire("c");
    expect(gate.stats()).toEqual({ active: 2, queued: 1, bytes: 0 });
    a();
    a(); // second call must not free a second slot
    const c = await waiting;
    expect(gate.stats()).toEqual({ active: 2, queued: 0, bytes: 0 });
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
    expect(gate.stats()).toEqual({ active: 2, queued: 0, bytes: 0 });
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
    expect(gate.stats()).toEqual({ active: 2, queued: 1, bytes: 0 });
    const other = await gate.acquire("quiet"); // not blocked behind the noisy host
    expect(gate.stats().active).toBe(3);
    first();
    const granted = await third; // freed noisy slot goes to the noisy waiter
    expect(gate.stats()).toEqual({ active: 3, queued: 0, bytes: 0 });
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
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
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
          expect(l.maxBodyBytes).toBeGreaterThanOrEqual(MIN_MAX_BODY_BYTES);
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
    expect(gate.stats()).toEqual({ active: 4, queued: 0, bytes: 0 });
    const queued = gate.acquire("e");
    await expect(gate.acquire("f")).rejects.toBeInstanceOf(GateBusyError); // queue (1) is full ⇒ shed
    held[0]();
    (await queued)();
    for (const r of held) r();
    held[1](); // idempotent
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
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

// ───────────────────────────── body override floor (P2 review) ─────────────────────────────
// The proxy refuses any body above `maxBodyBytes`. Laravel publishes variants up to `storefront_media.variant_max_bytes` (6 MiB) and
// animations up to `animated.max_bytes` (5 MiB), so no configuration may set the bound below the largest valid published file.
describe("body override floor (producer ceilings)", () => {
  const config = readFileSync(
    resolve(process.cwd(), "../config/storefront_media.php"),
    "utf-8",
  );
  const mibOf = (expr: string | undefined) => {
    const m = (expr ?? "").match(/(\d+)\s*\*\s*1024\s*\*\s*1024/);
    return m ? Number(m[1]) * 1024 * 1024 : Number.NaN;
  };
  const variantCeiling = mibOf(
    config.match(/'variant_max_bytes'\s*=>\s*([^,]+),/)?.[1],
  );
  const animatedCeiling = mibOf(
    config.match(
      /'max_bytes'\s*=>\s*\(int\) env\('STOREFRONT_MEDIA_ANIMATED_MAX_BYTES',\s*([^)]+)\)/,
    )?.[1],
  );

  it("the floor is not below the largest file Laravel can publish (config-pinned, both producers)", () => {
    expect(variantCeiling).toBe(6 * MiB);
    expect(animatedCeiling).toBe(5 * MiB);
    expect(MIN_MAX_BODY_BYTES).toBeGreaterThanOrEqual(variantCeiling);
    expect(MIN_MAX_BODY_BYTES).toBeGreaterThanOrEqual(animatedCeiling);
    expect(DEFAULT_MAX_BODY_BYTES).toBeGreaterThan(MIN_MAX_BODY_BYTES); // default keeps its headroom
  });

  it("the smallest budget still fits one floor-sized body with its copy (the invariant is satisfiable)", () => {
    expect(2 * MIN_MAX_BODY_BYTES).toBeLessThanOrEqual(MIN_MAX_BUFFERED_BYTES);
  });

  it("too-small, zero, negative and typo values are RAISED to the floor — never honoured", () => {
    for (const small of [
      "1",
      "0",
      "-5",
      "1024",
      "65536",
      String(MIN_MAX_BODY_BYTES - 1),
      " 7 ",
    ]) {
      expect(mediaProxyLimits(env({ L: small })).maxBodyBytes, small).toBe(
        MIN_MAX_BODY_BYTES,
      );
    }
    expect(mediaProxyLimits(env({ L: "1" })).bodyRaisedToFloor).toBe(true);
  });

  it("values at or above the floor are untouched (up to the 32 MiB cap and the budget); the default is unchanged", () => {
    expect(
      mediaProxyLimits(env({ L: String(MIN_MAX_BODY_BYTES) })).maxBodyBytes,
    ).toBe(MIN_MAX_BODY_BYTES);
    expect(
      mediaProxyLimits(env({ L: String(MIN_MAX_BODY_BYTES) }))
        .bodyRaisedToFloor,
    ).toBeUndefined();
    expect(mediaProxyLimits(env({ L: String(10 * MiB) })).maxBodyBytes).toBe(
      10 * MiB,
    );
    expect(mediaProxyLimits(env({ L: String(1000 * MiB) })).maxBodyBytes).toBe(
      32 * MiB,
    );
    expect(mediaProxyLimits({}).maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(mediaProxyLimits({}).bodyRaisedToFloor).toBeUndefined();
  });

  it("non-numeric / non-integer values still fall back to the default (8 MiB), not to the floor", () => {
    for (const bad of ["abc", "1.5", "", " ", "NaN"]) {
      expect(mediaProxyLimits(env({ L: bad })).maxBodyBytes, bad).toBe(
        DEFAULT_MAX_BODY_BYTES,
      );
    }
  });

  it("the floor does not weaken the aggregate budget: raising to the floor still satisfies concurrent × body × 2 ≤ budget", () => {
    for (const B of [
      "",
      "1",
      String(32 * MiB),
      String(100 * MiB),
      String(512 * MiB),
    ]) {
      for (const C of ["", "1", "16", "256"]) {
        const l = mediaProxyLimits(env({ L: "1", C, B }));
        expect(l.maxBodyBytes, `B=${B} C=${C}`).toBe(MIN_MAX_BODY_BYTES);
        expect(worstCase(l), `B=${B} C=${C}`).toBeLessThanOrEqual(
          l.maxBufferedBytes,
        );
        expect(l.maxConcurrent).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("readBodyBounded at the floor accepts the largest valid files and still refuses one byte more", async () => {
    const floor = mediaProxyLimits(env({ L: "1" })).maxBodyBytes;
    for (const size of [5 * MiB, 6 * MiB]) {
      const { response } = chunked([size]);
      expect((await readBodyBounded(response, floor)).byteLength).toBe(size);
    }
    await expect(
      readBodyBounded(chunked([6 * MiB + 1]).response, floor),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});

// ───────────────────────────── delivery memory (P2-0b) ─────────────────────────────

describe("byte-aware gate", () => {
  const limits = {
    maxConcurrent: 8,
    maxConcurrentPerHost: 8,
    maxBufferedBytes: 100,
    maxBytesPerHost: 60,
    maxQueue: 1,
    queueWaitMs: 40,
  };

  it("reserves bytes with the slot; endRound frees the slot but keeps the retained share until the permit is released", async () => {
    const gate = createConcurrencyGate(limits);
    const permit = await gate.acquire("a", undefined, 50);
    expect(gate.stats()).toEqual({ active: 1, queued: 0, bytes: 50 });
    permit.endRound(20);
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 20 });
    permit.endRound(5); // a second endRound neither frees the slot twice nor GROWS the share back, and may only shrink it
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 5 });
    permit.endRound(500); // can never grow beyond what is held
    expect(gate.stats().bytes).toBe(5);
    permit();
    permit(); // idempotent
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
  });

  it("a release without endRound frees slot and bytes together, exactly once", async () => {
    const gate = createConcurrencyGate(limits);
    const permit = await gate.acquire("a", undefined, 40);
    permit();
    permit();
    permit.endRound(10); // after a full release nothing comes back
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
  });

  it("queues when the BYTES do not fit (slots free), grants in order as bytes return, and sheds beyond the queue", async () => {
    const gate = createConcurrencyGate(limits);
    const a = await gate.acquire("a", undefined, 60);
    a.endRound(60); // slot free, bytes retained
    const b = await gate.acquire("b", undefined, 40); // 100 used: full
    const waiter = gate.acquire("c", undefined, 40); // does not fit: queued
    await expect(gate.acquire("d", undefined, 40)).rejects.toBeInstanceOf(
      GateBusyError,
    ); // queue (1) full
    expect(gate.stats()).toEqual({ active: 1, queued: 1, bytes: 100 });
    a(); // delivery finished: 60 bytes back → the waiter runs
    const c = await waiter;
    expect(gate.stats()).toEqual({ active: 2, queued: 0, bytes: 80 });
    b();
    c();
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
  });

  it("a waiter that never fits is shed after the wait deadline, leaves the queue, and the gate recovers", async () => {
    const gate = createConcurrencyGate(limits);
    const hold = await gate.acquire("a", undefined, 60);
    hold.endRound(60);
    const hold2 = await gate.acquire("b", undefined, 40);
    await expect(gate.acquire("c", undefined, 40)).rejects.toBeInstanceOf(
      GateBusyError,
    ); // waits 40 ms, then shed
    expect(gate.stats().queued).toBe(0);
    hold();
    hold2();
    expect(
      (await gate.acquire("c", undefined, 40)).endRound(0),
    ).toBeUndefined();
    expect(gate.stats().bytes).toBe(0);
  });

  it("a waiter whose visitor leaves is removed without ever taking bytes", async () => {
    const gate = createConcurrencyGate({ ...limits, queueWaitMs: 5000 });
    const hold = await gate.acquire("a", undefined, 60);
    const hold2 = await gate.acquire("b", undefined, 40);
    const controller = new AbortController();
    const waiter = gate.acquire("c", controller.signal, 10);
    expect(gate.stats().queued).toBe(1);
    controller.abort();
    await expect(waiter).rejects.toBeInstanceOf(GateBusyError);
    expect(gate.stats()).toEqual({ active: 2, queued: 0, bytes: 100 });
    hold();
    hold2();
    expect(gate.stats()).toEqual({ active: 0, queued: 0, bytes: 0 });
  });

  it("one host cannot take more than its byte share; another host still gets through (fairness)", async () => {
    const gate = createConcurrencyGate({ ...limits, maxQueue: 0 });
    const a1 = await gate.acquire("a", undefined, 30);
    a1.endRound(30);
    const a2 = await gate.acquire("a", undefined, 30); // host a: 60 = its cap
    await expect(gate.acquire("a", undefined, 1)).rejects.toBeInstanceOf(
      GateBusyError,
    );
    const b = await gate.acquire("b", undefined, 30); // another host is unaffected
    expect(gate.stats().bytes).toBe(90);
    a1();
    a2();
    b();
    expect(gate.stats().bytes).toBe(0);
  });

  it("without a byte budget the gate behaves exactly as before (bytes ignored)", async () => {
    const gate = createConcurrencyGate({
      maxConcurrent: 1,
      maxConcurrentPerHost: 1,
      maxQueue: 0,
      queueWaitMs: 10,
    });
    const p = await gate.acquire("a", undefined, 1_000_000_000);
    await expect(gate.acquire("b")).rejects.toBeInstanceOf(GateBusyError);
    p();
    expect(gate.stats().active).toBe(0);
  });
});

describe("deliverBuffered", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const bytes = (n: number) =>
    Uint8Array.from({ length: n }, (_, i) => i % 251);
  const opts = (
    onSettled: () => void,
    extra: Partial<Parameters<typeof deliverBuffered>[1]> = {},
  ) => ({
    onSettled,
    deadlineMs: 60_000,
    chunkBytes: 1000,
    ...extra,
  });

  it("delivers exactly the buffered bytes, in order, one chunk per read, and settles only after the consumer is done with the last chunk", async () => {
    const body = bytes(2500);
    const settled = vi.fn();
    const reader = deliverBuffered(body, opts(settled)).getReader();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 3; i++) {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      parts.push(value as Uint8Array);
      expect(settled).not.toHaveBeenCalled(); // still outstanding while chunks remain — and right after the last chunk was handed over
    }
    expect(parts.map((p) => p.byteLength)).toEqual([1000, 1000, 500]);
    expect(Uint8Array.from(parts.flatMap((p) => [...p]))).toEqual(body);
    expect((await reader.read()).done).toBe(true);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("is pull-based: nothing is handed over until the consumer reads, and a stalled consumer holds the delivery open", async () => {
    const settled = vi.fn();
    const body = bytes(5000);
    const spy = vi.spyOn(body, "subarray");
    const stream = deliverBuffered(body, opts(settled));
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
    const reader = stream.getReader();
    await reader.read();
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1); // one chunk per read, no read-ahead
    expect(settled).not.toHaveBeenCalled();
    await reader.cancel();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("an empty body completes on the first read", async () => {
    const settled = vi.fn();
    const reader = deliverBuffered(
      new Uint8Array(0),
      opts(settled),
    ).getReader();
    expect((await reader.read()).done).toBe(true);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("cancel (visitor disconnect) settles once; repeated cancels and later reads change nothing", async () => {
    const settled = vi.fn();
    const stream = deliverBuffered(bytes(5000), opts(settled));
    const reader = stream.getReader();
    await reader.cancel();
    await reader.cancel().catch(() => undefined);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("the request signal aborting settles once and errors the stream (the connection is torn down, not left half-open)", async () => {
    const settled = vi.fn();
    const controller = new AbortController();
    const reader = deliverBuffered(
      bytes(5000),
      opts(settled, { signal: controller.signal }),
    ).getReader();
    await reader.read();
    controller.abort();
    await expect(reader.read()).rejects.toBeInstanceOf(DeliveryDeadlineError);
    expect(settled).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("an already-aborted signal settles immediately", async () => {
    const settled = vi.fn();
    const controller = new AbortController();
    controller.abort();
    deliverBuffered(bytes(10), opts(settled, { signal: controller.signal }));
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("the deadline cuts off a consumer that never reads (slow-loris) and frees the share exactly once", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const stream = deliverBuffered(
      bytes(5000),
      opts(settled, { deadlineMs: 10_000 }),
    );
    vi.advanceTimersByTime(9_999);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(settled).toHaveBeenCalledTimes(1);
    await expect(stream.getReader().read()).rejects.toBeInstanceOf(
      DeliveryDeadlineError,
    );
    vi.advanceTimersByTime(60_000);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("a delivery that completes cancels its timer: no late release, no leaked timer", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const reader = deliverBuffered(
      new Uint8Array(10),
      opts(settled, { deadlineMs: 10_000 }),
    ).getReader();
    await reader.read();
    await reader.read();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a throwing onSettled cannot break the delivery or double-fire", async () => {
    const settled = vi.fn(() => {
      throw new Error("boom");
    });
    const reader = deliverBuffered(
      new Uint8Array(10),
      opts(settled),
    ).getReader();
    await reader.read();
    await expect(reader.read()).resolves.toBeDefined();
    expect(settled).toHaveBeenCalledTimes(1);
  });
});

describe("delivery limits", () => {
  it("defaults and clamps: 120 s, 10 s – 600 s, malformed ⇒ default; per-host byte share ≥ one read, ≤ the budget", () => {
    expect(mediaProxyLimits({}).deliveryTimeoutMs).toBe(
      DEFAULT_DELIVERY_TIMEOUT_MS,
    );
    expect(DEFAULT_DELIVERY_TIMEOUT_MS).toBe(120_000);
    expect(
      mediaProxyLimits({ STOREFRONT_MEDIA_PROXY_DELIVERY_TIMEOUT_MS: "1" })
        .deliveryTimeoutMs,
    ).toBe(10_000);
    expect(
      mediaProxyLimits({
        STOREFRONT_MEDIA_PROXY_DELIVERY_TIMEOUT_MS: "99999999",
      }).deliveryTimeoutMs,
    ).toBe(600_000);
    for (const bad of ["abc", "1.5", "", " "]) {
      expect(
        mediaProxyLimits({ STOREFRONT_MEDIA_PROXY_DELIVERY_TIMEOUT_MS: bad })
          .deliveryTimeoutMs,
        bad,
      ).toBe(120_000);
    }
    for (const B of ["", String(32 * MiB), String(512 * MiB)]) {
      for (const L of ["", "1", String(32 * MiB)]) {
        const l = mediaProxyLimits(env({ B, L }));
        expect(l.maxBytesPerHost, `B=${B} L=${L}`).toBeGreaterThanOrEqual(
          l.maxBodyBytes * READ_COPY_FACTOR,
        );
        expect(l.maxBytesPerHost).toBeLessThanOrEqual(l.maxBufferedBytes);
      }
    }
    expect(mediaProxyLimits({}).maxBytesPerHost).toBe(128 * MiB);
  });

  it("every request is charged at least a floor, so tiny images cannot be held open in unbounded numbers", () => {
    expect(MIN_DELIVERY_CHARGE_BYTES).toBe(64 * 1024);
    expect(DELIVERY_CHUNK_BYTES).toBe(64 * 1024);
    expect(
      mediaProxyLimits({}).maxBufferedBytes / MIN_DELIVERY_CHARGE_BYTES,
    ).toBe(4096); // ≤ 4096 outstanding deliveries at the default budget
  });
});
