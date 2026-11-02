/**
 * COPS-H2-5 — the guest tracking token lives in the page path (`/track/{token}`), and it is a reusable bearer credential for
 * a narrow, PII-free order projection. Error telemetry attaches the current URL (`request.url`, referrer, breadcrumbs,
 * span/transaction descriptions) even with default PII off, so every outgoing Sentry payload is scrubbed here first.
 *
 * Pure and dependency-free so the same code runs in the browser and Node inits and can be unit-tested without the SDK.
 * It rewrites only the single path segment after `/track/`; everything else in the payload is left untouched.
 */
// The page path (`/track/{token}`) and the backend API path the storefront server calls (`/store/v1/order-tracking/{token}`).
const TRACK_SEGMENT = /(\/(?:track|order-tracking)\/)[^/?#\s"'\\]+/gi;
// The bare token shape, wherever it appears (headers, bodies, messages) even without a path around it.
const BARE_TOKEN = /trk1\.[0-9a-f-]{36}\.\d+\.[0-9a-f]{16,}/gi;
const REDACTED = "[redacted]";
const MAX_DEPTH = 10;

export function redactTrackingPath(value: string): string {
  let out = value;
  if (out.includes("/track/") || out.includes("/order-tracking/")) {
    out = out.replace(TRACK_SEGMENT, `$1${REDACTED}`);
  }
  return out.includes("trk1.") ? out.replace(BARE_TOKEN, REDACTED) : out;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactTrackingPath(value);
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) {
    return value;
  }
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = walk(value[i], depth + 1, seen);
    }
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    record[key] = walk(record[key], depth + 1, seen);
  }
  return record;
}

/** Scrubs a Sentry event, transaction or breadcrumb in place and returns it (so it can be used directly as a hook). */
export function scrubTrackingCredentials<T>(payload: T): T {
  try {
    return walk(payload, 0, new WeakSet()) as T;
  } catch {
    // Telemetry must never throw into the app; an unscrubbable payload is dropped rather than leaked.
    return null as T;
  }
}

/** Whether a pathname is a guest tracking page (`/{country}/{locale}/track/{token}`): such pages load no third-party telemetry at all. */
export function isTrackingPath(pathname: string | null | undefined): boolean {
  return !!pathname && /(^|\/)track\/[^/]+/.test(pathname);
}

/** Vercel Analytics / Speed Insights `beforeSend`: keeps the event but strips the token from its URL. */
export function redactTrackingEventUrl<T extends { url: string }>(event: T): T {
  return { ...event, url: redactTrackingPath(event.url) };
}
