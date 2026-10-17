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
 * Nothing here streams ORIGIN bytes to the visitor (`deliverBuffered` only paces an already fully buffered body so the memory budget can
 * follow it to the end of its delivery) and nothing here knows about tenants or publication: the origin gate (which
 * resolves the storefront from the forwarded host and checks the Published reference) is untouched.
 */

// Laravel caps every generated file at `storefront_media.variant_max_bytes` (6 MiB; pinned by media-proxy-guard.test.ts and StorefrontMediaVariantByteCeilingTest) and
// the animated file at 5 MiB, so a published file always fits under this bound. Keep it ABOVE that ceiling.
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENT = 16;
export const DEFAULT_MAX_QUEUE = 64;
export const DEFAULT_QUEUE_WAIT_MS = 4_000;
const MIB = 1024 * 1024;

// Aggregate read-phase memory budget. Reading a body holds the received chunks AND, for an instant, the assembled copy, so one
// in-flight read costs up to `body bound × READ_COPY_FACTOR`. Concurrency and body bound are only safe TOGETHER:
//   maxConcurrent × maxBodyBytes × READ_COPY_FACTOR  ≤  maxBufferedBytes  ≤  HARD_MAX_BUFFERED_BYTES.
// The defaults (16 × 8 MiB × 2) are exactly the default budget, so default behaviour is unchanged. An operator can raise the budget
// (to HARD_MAX_BUFFERED_BYTES at most) but can never configure past it: `mediaProxyLimits` lowers the concurrency — never the body
// bound that keeps published files servable — until the product fits.
// P2-0b: the same budget also covers the DELIVERY phase. A read reserves `maxBodyBytes × READ_COPY_FACTOR`; when the body has been
// read the reservation shrinks to the buffered body's size (min {@link MIN_DELIVERY_CHARGE_BYTES}) and is kept until the response has
// been handed to the visitor, cancelled, aborted or timed out — so slow visitors cannot pile up buffers while new requests keep being
// admitted. The origin SLOT, by contrast, is released as soon as the read ends (Laravel's workers are never held by a slow visitor).
export const READ_COPY_FACTOR = 2;
// Floor for the body bound. The proxy refuses any body above `maxBodyBytes`, and Laravel publishes variants up to
// `storefront_media.variant_max_bytes` (6 MiB) and animations up to `animated.max_bytes` (5 MiB). A smaller override — a typo such as
// "1" included — would turn valid published media into 502s, so overrides below this are RAISED to it, never honoured. Keep it at or
// above both producer ceilings (pinned against config/storefront_media.php by media-proxy-guard.test.ts); 2 × it must fit the
// smallest budget (also pinned).
export const MIN_MAX_BODY_BYTES = 6 * MIB;
export const DEFAULT_MAX_BUFFERED_BYTES = 256 * MIB;
export const MIN_MAX_BUFFERED_BYTES = 32 * MIB;
export const HARD_MAX_BUFFERED_BYTES = 512 * MIB;
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Upper bound on how long a buffered response may stay outstanding (the budget share is freed when it passes). */
export const DEFAULT_DELIVERY_TIMEOUT_MS = 120_000;
/** A finished-but-undelivered response is charged at least this much (bounds the NUMBER of outstanding deliveries too). */
export const MIN_DELIVERY_CHARGE_BYTES = 64 * 1024;
/** The buffered body is handed to the transport in pieces of this size (views of the same buffer; no copies). */
export const DELIVERY_CHUNK_BYTES = 64 * 1024;

export interface MediaProxyLimits {
  /** Largest origin body held in memory (after the budget has been applied). */
  maxBodyBytes: number;
  /** Simultaneous origin round-trips for the whole instance (after the budget has been applied). */
  maxConcurrent: number;
  /** The read-phase memory budget the two limits above were fitted into: maxConcurrent × maxBodyBytes × READ_COPY_FACTOR ≤ this. */
  maxBufferedBytes: number;
  /** `true` only when a `STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES` integer below {@link MIN_MAX_BODY_BYTES} was raised to it. */
  bodyRaisedToFloor?: true;
  /** What the operator asked for before the budget was applied; present only when the budget lowered a value. */
  constrained?: { requestedConcurrent: number; requestedBodyBytes: number };
  /** …of which one visitor host may hold at most this many (noisy-neighbour protection between storefronts). */
  maxConcurrentPerHost: number;
  /** …and one visitor host may hold at most this many bytes of the budget (reads + outstanding deliveries); ≥ one read's reservation. */
  maxBytesPerHost: number;
  /** How long a buffered response may stay outstanding before it is cut off and its budget share freed. */
  deliveryTimeoutMs: number;
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

/**
 * Environment overrides are optional and clamped; an absent or malformed value keeps the safe default. The clamped values are then
 * fitted into the aggregate read budget (see READ_COPY_FACTOR): the body bound is capped at half the budget (so a single read always
 * fits) and the concurrency is lowered until `maxConcurrent × maxBodyBytes × READ_COPY_FACTOR ≤ maxBufferedBytes`.
 */
export function mediaProxyLimits(
  env: Record<string, string | undefined> = process.env,
): MediaProxyLimits {
  const maxBufferedBytes = integerEnv(
    env.STOREFRONT_MEDIA_PROXY_MAX_BUFFERED_BYTES,
    DEFAULT_MAX_BUFFERED_BYTES,
    MIN_MAX_BUFFERED_BYTES,
    HARD_MAX_BUFFERED_BYTES,
  );
  const requestedBodyBytes = integerEnv(
    env.STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES,
    DEFAULT_MAX_BODY_BYTES,
    MIN_MAX_BODY_BYTES,
    32 * MIB,
  );
  const rawBody = env.STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES;
  const bodyRaisedToFloor =
    rawBody !== undefined &&
    rawBody.trim() !== "" &&
    Number.isInteger(Number(rawBody)) &&
    Number(rawBody) < MIN_MAX_BODY_BYTES;
  const requestedConcurrent = integerEnv(
    env.STOREFRONT_MEDIA_PROXY_MAX_CONCURRENT,
    DEFAULT_MAX_CONCURRENT,
    1,
    256,
  );
  const maxBodyBytes = Math.min(
    requestedBodyBytes,
    Math.floor(maxBufferedBytes / READ_COPY_FACTOR),
  );
  const maxConcurrent = Math.max(
    1,
    Math.min(
      requestedConcurrent,
      Math.floor(maxBufferedBytes / (maxBodyBytes * READ_COPY_FACTOR)),
    ),
  );
  const constrained =
    maxConcurrent !== requestedConcurrent ||
    maxBodyBytes !== requestedBodyBytes;
  return {
    maxBodyBytes,
    maxConcurrent,
    maxBufferedBytes,
    ...(bodyRaisedToFloor && { bodyRaisedToFloor: true as const }),
    ...(constrained && {
      constrained: { requestedConcurrent, requestedBodyBytes },
    }),
    maxConcurrentPerHost: Math.max(1, Math.ceil(maxConcurrent / 2)),
    maxBytesPerHost: Math.min(
      maxBufferedBytes,
      Math.max(
        Math.ceil(maxBufferedBytes / 2),
        maxBodyBytes * READ_COPY_FACTOR,
      ),
    ),
    deliveryTimeoutMs: integerEnv(
      env.STOREFRONT_MEDIA_PROXY_DELIVERY_TIMEOUT_MS,
      DEFAULT_DELIVERY_TIMEOUT_MS,
      10_000,
      600_000,
    ),
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

let warnedConstrained = false;
let warnedRaised = false;
/** Logs once per process (never per request) when an override was changed to stay safe. No secrets, hosts or URLs involved. */
export function warnIfLimitsConstrained(limits: MediaProxyLimits): void {
  if (limits.constrained && !warnedConstrained) {
    warnedConstrained = true;
    console.warn(
      "[media-proxy] configured limits exceed the read-memory budget; lowered to fit",
      {
        requestedConcurrent: limits.constrained.requestedConcurrent,
        requestedBodyBytes: limits.constrained.requestedBodyBytes,
        maxConcurrent: limits.maxConcurrent,
        maxBodyBytes: limits.maxBodyBytes,
        maxBufferedBytes: limits.maxBufferedBytes,
      },
    );
  }
  if (limits.bodyRaisedToFloor && !warnedRaised) {
    warnedRaised = true;
    console.warn(
      "[media-proxy] STOREFRONT_MEDIA_PROXY_MAX_BODY_BYTES is below the producer ceiling; raised to the floor",
      {
        maxBodyBytes: limits.maxBodyBytes,
        floorBytes: MIN_MAX_BODY_BYTES,
      },
    );
  }
}

/** Test hook. */
export function resetConstrainedWarning(): void {
  warnedConstrained = false;
  warnedRaised = false;
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
  bytes: number;
  grant: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * What {@link ConcurrencyGate.acquire} hands out. Calling it releases everything (idempotent). `endRound` ends the origin
 * round-trip — the SLOT is freed at once — while keeping `retainBytes` of the reservation (never more than was reserved) until
 * the permit itself is called; that is how a buffered response keeps its share of the memory budget until it has been delivered.
 */
export type Permit = (() => void) & {
  endRound(retainBytes: number): void;
};

export interface ConcurrencyGate {
  /**
   * Resolves with a {@link Permit} once a slot — and, when a byte budget is configured, `bytes` of it — is free, or rejects with
   * {@link GateBusyError} when the queue is full, the wait deadline passes, or `signal` aborts. Callers MUST release the permit
   * exactly through `permit()` on every path (it is idempotent).
   */
  acquire(key: string, signal?: AbortSignal, bytes?: number): Promise<Permit>;
  /** Current counters (for tests and diagnostics; no per-host data is exposed). `bytes` = budget currently reserved or retained. */
  stats(): { active: number; queued: number; bytes: number };
}

export function createConcurrencyGate(
  limits: Pick<
    MediaProxyLimits,
    "maxConcurrent" | "maxConcurrentPerHost" | "maxQueue" | "queueWaitMs"
  > &
    Partial<Pick<MediaProxyLimits, "maxBufferedBytes" | "maxBytesPerHost">>,
): ConcurrencyGate {
  let active = 0;
  let usedBytes = 0;
  const perKey = new Map<string, number>();
  const perKeyBytes = new Map<string, number>();
  const queue: Waiter[] = [];
  const budget = limits.maxBufferedBytes;
  const perHostBudget = limits.maxBytesPerHost ?? budget;

  const canRun = (key: string, bytes: number) =>
    active < limits.maxConcurrent &&
    (perKey.get(key) ?? 0) < limits.maxConcurrentPerHost &&
    (budget === undefined ||
      (usedBytes + bytes <= budget &&
        (perHostBudget === undefined ||
          (perKeyBytes.get(key) ?? 0) + bytes <= perHostBudget)));

  const addBytes = (key: string, delta: number) => {
    usedBytes += delta;
    const next = (perKeyBytes.get(key) ?? 0) + delta;
    if (next <= 0) perKeyBytes.delete(key);
    else perKeyBytes.set(key, next);
  };

  const take = (key: string, bytes: number): Permit => {
    active += 1;
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
    addBytes(key, bytes);
    let slotHeld = true;
    let held = bytes;
    const releaseSlot = () => {
      if (!slotHeld) return;
      slotHeld = false;
      active -= 1;
      const left = (perKey.get(key) ?? 1) - 1;
      if (left <= 0) perKey.delete(key);
      else perKey.set(key, left);
    };
    const shrinkTo = (retain: number) => {
      const next = Math.min(held, Math.max(0, retain));
      if (next === held) return;
      addBytes(key, next - held);
      held = next;
    };
    const permit = (() => {
      releaseSlot();
      shrinkTo(0);
      drain();
    }) as Permit;
    permit.endRound = (retainBytes: number) => {
      releaseSlot();
      shrinkTo(retainBytes);
      drain();
    };
    return permit;
  };

  /** Hands freed capacity to the oldest waiters that are allowed to run (a host at its cap is skipped, not blocking others). */
  const drain = () => {
    for (let i = 0; i < queue.length; ) {
      const waiter = queue[i];
      if (canRun(waiter.key, waiter.bytes)) {
        queue.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.grant();
      } else {
        i += 1;
      }
    }
  };

  return {
    acquire(key, signal, bytes = 0) {
      if (signal?.aborted) return Promise.reject(new GateBusyError());
      // A request that fits runs at once: any waiter that could also run was granted by `drain`, so none is overtaken.
      if (canRun(key, bytes)) {
        return Promise.resolve(take(key, bytes));
      }
      if (queue.length >= limits.maxQueue) {
        return Promise.reject(new GateBusyError());
      }
      return new Promise<Permit>((resolve, reject) => {
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
          bytes,
          grant: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve(take(key, bytes));
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
    stats: () => ({ active, queued: queue.length, bytes: usedBytes }),
  };
}

// ───────────────────────────── buffered delivery (P2-0b) ─────────────────────────────

export class DeliveryDeadlineError extends Error {
  constructor() {
    super("buffered response was not delivered in time");
    this.name = "DeliveryDeadlineError";
  }
}

export interface DeliveryOptions {
  /** Called exactly once when the delivery is over, whichever way it ended (complete, cancelled, aborted, deadline). */
  onSettled: () => void;
  /** How long the response may stay outstanding. */
  deadlineMs: number;
  /** The visitor's request signal: aborting it ends the delivery. */
  signal?: AbortSignal;
  chunkBytes?: number;
}

/**
 * Hands an ALREADY BUFFERED body to the transport as a pull-based stream: one chunk at a time, only when the consumer asks for the
 * next one (a slow visitor therefore holds nothing but the one shared buffer). This is NOT origin streaming — the bytes were read
 * completely from Laravel before this is called; it only lets the proxy know when delivery has finished or been abandoned.
 *
 * `onSettled` fires exactly once on: the consumer asking for more after the last chunk (it has finished with all of them), the
 * consumer cancelling (visitor disconnect), the request signal aborting, or the deadline passing (the stream is then errored so the connection is torn down rather than left half-open).
 */
export function deliverBuffered(
  body: Uint8Array,
  options: DeliveryOptions,
): ReadableStream<Uint8Array> {
  const chunk = options.chunkBytes ?? DELIVERY_CHUNK_BYTES;
  let offset = 0;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const onAbort = () => {
    try {
      controller?.error(new DeliveryDeadlineError());
    } catch {
      // already closed or errored
    }
    settle();
  };
  const settle = () => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    options.onSettled();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
        timer = setTimeout(onAbort, options.deadlineMs);
        timer.unref?.();
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener("abort", onAbort, { once: true });
      },
      // highWaterMark 0: `pull` runs only while the consumer has a read pending, so nothing is handed over ahead of it. The stream is
      // closed — and the budget share freed — on the read that FOLLOWS the last chunk, i.e. once the consumer has finished with it.
      pull(c) {
        if (settled) return;
        if (offset >= body.byteLength) {
          c.close();
          settle();
          return;
        }
        const end = Math.min(body.byteLength, offset + chunk);
        c.enqueue(body.subarray(offset, end));
        offset = end;
      },
      cancel() {
        settle();
      },
    },
    { highWaterMark: 0 },
  );
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
    limits.maxBufferedBytes,
    limits.maxBytesPerHost,
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
