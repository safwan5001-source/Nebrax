/**
 * AWJ-ANIMATED-MEDIA P2-0 — safety rails for the BUFFERED image path of the Customizer media proxy.
 *
 * The proxy reads a Laravel-served image body completely (≤ a few MB) before answering. That buffering is deliberate: it
 * keeps slow visitors off Laravel's Apache workers (a worker is held only for the fast Node↔Laravel copy). These helpers
 * make the buffering SAFE without changing it:
 *
 *  - {@link readBodyBounded}: never hold more than `maxBytes` of a response in memory — whatever `Content-Length` claims
 *    (absent, too large, or a lie). Reads in chunks and aborts the origin stream the moment the bound is crossed.
 *  - {@link createConcurrencyGate}: a bounded number of simultaneous origin round-trips (global and per visitor host), a
 *    short bounded queue, and a deadline — a flood from one storefront cannot exhaust memory or Laravel's workers, and a
 *    stuck origin can never hold a slot forever. Slots are always released (`finally`), so the gate recovers by itself.
 *
 * Nothing here streams bytes to the visitor and nothing here knows about tenants or publication: the origin gate (which
 * resolves the storefront from the forwarded host and checks the Published reference) is untouched.
 */

// Laravel caps every generated file at `storefront_media.variant_max_bytes` (6 MiB; pinned by StorefrontMediaVariantByteCeilingTest) and
// the animated file at 5 MiB, so a published file always fits under this bound. Keep it ABOVE that ceiling.
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENT = 16;
export const DEFAULT_MAX_QUEUE = 64;
export const DEFAULT_QUEUE_WAIT_MS = 4_000;
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface MediaProxyLimits {
  /** Largest origin body held in memory. */
  maxBodyBytes: number;
  /** Simultaneous origin round-trips for the whole instance. */
  maxConcurrent: number;
  /** …of which one visitor host may hold at most this many (noisy-neighbour protection between storefronts). */
  maxConcurrentPerHost: number;
  /** Requests allowed to wait for a slot. */
  maxQueue: number;
  queueWaitMs: number;
  /** Deadline for one origin round-trip including the body read. */
  timeoutMs: number;
}

function integerEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Environment overrides are optional and clamped; an absent or malformed value keeps the safe default. */
export function mediaProxyLimits(
  env: Record<string, string | undefined> = process.env,
): MediaProxyLimits {
  const maxConcurrent = integerEnv(
    env.STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT,
    DEFAULT_MAX_CONCURRENT,
    1,
    256,
  );
  return {
    maxBodyBytes: integerEnv(
      env.STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
      64 * 1024,
      32 * 1024 * 1024,
    ),
    maxConcurrent,
    maxConcurrentPerHost: Math.max(1, Math.ceil(maxConcurrent / 2)),
    maxQueue: integerEnv(
      env.STOREFRONT_MEDIA_PROXY_MAX_QUEUE,
      DEFAULT_MAX_QUEUE,
      0,
      1024,
    ),
    queueWaitMs: DEFAULT_QUEUE_WAIT_MS,
    timeoutMs: integerEnv(
      env.STOREFRONT_MEDIA_PROXY_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
  };
}

// ───────────────────────────── bounded body ─────────────────────────────

export class BodyTooLargeError extends Error {
  constructor() {
    super("origin body exceeds the proxy bound");
    this.name = "BodyTooLargeError";
  }
}

/** A numeric `Content-Length`, or `null` when absent/invalid (never trusted either way). */
export function declaredLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d{1,15}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/**
 * Reads the whole body, but never more than `maxBytes`. A `Content-Length` above the bound is refused without reading a
 * byte; a missing or understated one is irrelevant because the bytes actually received are counted. The origin stream is
 * cancelled as soon as the bound is crossed.
 *
 * @throws BodyTooLargeError when the declared or the actual size exceeds `maxBytes`
 */
export async function readBodyBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = declaredLength(response.headers);
  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError();
  }
  if (!response.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(new ArrayBuffer(received));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ───────────────────────────── concurrency gate ─────────────────────────────

export class GateBusyError extends Error {
  constructor() {
    super("media proxy is at capacity");
    this.name = "GateBusyError";
  }
}

interface Waiter {
  key: string;
  grant: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ConcurrencyGate {
  /**
   * Resolves with a `release` function (idempotent) once a slot is free, or rejects with {@link GateBusyError} when the
   * queue is full, the wait deadline passes, or `signal` aborts. Callers MUST call `release` in a `finally`.
   */
  acquire(key: string, signal?: AbortSignal): Promise<() => void>;
  /** Current counters (for tests and diagnostics; no per-host data is exposed). */
  stats(): { active: number; queued: number };
}

export function createConcurrencyGate(
  limits: Pick<
    MediaProxyLimits,
    "maxConcurrent" | "maxConcurrentPerHost" | "maxQueue" | "queueWaitMs"
  >,
): ConcurrencyGate {
  let active = 0;
  const perKey = new Map<string, number>();
  const queue: Waiter[] = [];

  const canRun = (key: string) =>
    active < limits.maxConcurrent &&
    (perKey.get(key) ?? 0) < limits.maxConcurrentPerHost;

  const take = (key: string): (() => void) => {
    active += 1;
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      const left = (perKey.get(key) ?? 1) - 1;
      if (left <= 0) perKey.delete(key);
      else perKey.set(key, left);
      drain();
    };
  };

  /** Hands freed slots to the oldest waiters that are allowed to run (a host at its cap is skipped, not blocking others). */
  const drain = () => {
    for (let i = 0; i < queue.length && active < limits.maxConcurrent; ) {
      const waiter = queue[i];
      if (canRun(waiter.key)) {
        queue.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.grant();
      } else {
        i += 1;
      }
    }
  };

  return {
    acquire(key, signal) {
      if (signal?.aborted) return Promise.reject(new GateBusyError());
      // A request that fits runs at once: any waiter that could also run was granted by `drain`, so none is overtaken.
      if (canRun(key)) {
        return Promise.resolve(take(key));
      }
      if (queue.length >= limits.maxQueue) {
        return Promise.reject(new GateBusyError());
      }
      return new Promise<() => void>((resolve, reject) => {
        const remove = () => {
          const at = queue.indexOf(waiter);
          if (at >= 0) queue.splice(at, 1);
        };
        const onAbort = () => {
          clearTimeout(waiter.timer);
          remove();
          reject(new GateBusyError());
        };
        const waiter: Waiter = {
          key,
          grant: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve(take(key));
          },
          timer: setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            remove();
            reject(new GateBusyError());
          }, limits.queueWaitMs),
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(waiter);
      });
    },
    stats: () => ({ active, queued: queue.length }),
  };
}

// One gate per server process (the standalone Node server runs the route handlers in a single process). Rebuilt only if
// the configured limits change, which in production never happens after boot.
let shared: { signature: string; gate: ConcurrencyGate } | null = null;

export function sharedMediaProxyGate(
  limits: MediaProxyLimits,
): ConcurrencyGate {
  const signature = JSON.stringify([
    limits.maxConcurrent,
    limits.maxConcurrentPerHost,
    limits.maxQueue,
    limits.queueWaitMs,
  ]);
  if (!shared || shared.signature !== signature) {
    shared = { signature, gate: createConcurrencyGate(limits) };
  }
  return shared.gate;
}

/** Test hook: forget the shared gate (and every slot it holds). */
export function resetSharedMediaProxyGate(): void {
  shared = null;
}
