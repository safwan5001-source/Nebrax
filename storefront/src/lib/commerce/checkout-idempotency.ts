/**
 * COM-CHECKOUT-1C (fix) — persists the `POST /checkout/complete`
 * Idempotency-Key across a page reload for the *same* checkout attempt,
 * scoped to a checkout identity (see `getAwjCheckoutIdentity` in
 * `@/lib/data/awj-checkout`) rather than a single global key.
 *
 * **Why this exists**: the key used to live only in a `useRef`, so it was
 * stable across re-renders and retries within one mount, but a fresh page
 * load (reload after a lost response, a tab restored, a brief network
 * drop) minted a brand-new UUID. If the backend's completion had actually
 * succeeded before the response was lost, that new key would collide with
 * the checkout's already-`completed` row and the visitor would see
 * `idempotency_conflict` instead of the successful order being replayed.
 *
 * **Design**: `localStorage`, keyed by `PREFIX + identity` — never a
 * single static key, so two genuinely different checkouts (different cart
 * identity) never share a value. The key for one checkout is written the
 * first time it's needed and read back verbatim on every later call
 * (reload or retry) until `clearPersistedIdempotencyKey` removes it after
 * a *confirmed* successful completion — never before, and never on a
 * failure (a `review_required`/`idempotency_conflict`/transient error must
 * keep the same key so a retry still replays correctly if the earlier
 * attempt actually landed server-side).
 *
 * **Storage-unavailable fallback**: every `localStorage` access is
 * wrapped — private browsing, disabled storage, or a storage quota error
 * all degrade to "treat as if nothing was persisted" (read returns
 * `null`, write/clear are silent no-ops) rather than throwing. The caller
 * (`resolveIdempotencyKey`) still returns a usable key in that case; it
 * just won't survive a reload, which is the same behavior this fix
 * replaces the `useRef`-only version with as its floor, not a regression.
 */

const STORAGE_KEY_PREFIX = "awj-checkout-idempotency-key:";

function storageKeyFor(identity: string): string {
  return `${STORAGE_KEY_PREFIX}${identity}`;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Accessing `window.localStorage` itself can throw (some private-mode
    // configurations, storage disabled by policy).
    return null;
  }
}

/** Reads the persisted key for this checkout identity, or `null` if none/unavailable. */
export function readPersistedIdempotencyKey(identity: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    return storage.getItem(storageKeyFor(identity));
  } catch {
    return null;
  }
}

/** Persists a key for this checkout identity. Silently no-ops if storage is unavailable. */
export function writePersistedIdempotencyKey(
  identity: string,
  key: string,
): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(storageKeyFor(identity), key);
  } catch {
    // Quota exceeded or storage disabled mid-session — the in-memory value
    // the caller already holds still works for the rest of this mount.
  }
}

/**
 * Removes the persisted key for this checkout identity. Call this only
 * after a *confirmed* successful completion (never before, never on
 * failure) — see module doc.
 */
export function clearPersistedIdempotencyKey(identity: string): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.removeItem(storageKeyFor(identity));
  } catch {
    // Best-effort cleanup — a leftover entry for a now-completed checkout
    // is inert (the checkout identity changes once the cart is replaced,
    // and a stale key on a *different* checkout row than the one it was
    // written for is never a duplicate-order risk: idempotency state lives
    // per-CommerceCheckout on the backend, not keyed by the key string).
  }
}

/** A fresh, URL-safe identifier — used both as a genuinely new key and as the old-browser fallback below. */
function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Extremely old-browser fallback — still URL-safe and long enough for the
  // backend's `PublicApiIdempotency` length bounds (8–255 chars).
  return `awj-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Resolves the Idempotency-Key to use for this checkout attempt: the
 * persisted value for `identity` if one exists (reload/retry of the same
 * checkout), otherwise a freshly generated one that is immediately
 * persisted so the *next* reload sees it too.
 *
 * `identity === null` (no cart token at all — nothing to persist against,
 * e.g. the empty-cart state that never reaches completion anyway) skips
 * storage entirely and returns an ephemeral key, matching this module's
 * pre-persistence behavior for that unreachable case.
 */
export function resolveIdempotencyKey(identity: string | null): string {
  if (identity === null) {
    return generateIdempotencyKey();
  }

  const existing = readPersistedIdempotencyKey(identity);
  if (existing) {
    return existing;
  }

  const fresh = generateIdempotencyKey();
  writePersistedIdempotencyKey(identity, fresh);

  return fresh;
}
