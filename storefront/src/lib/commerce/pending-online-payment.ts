/**
 * The one piece of state the online-payment journey keeps in the browser: *which order is this device paying for*.
 *
 * Why it exists at all: the provider sends the shopper back to a fixed address (`/checkout/payment-return`) that
 * carries no order identity (and the provider's own query string is never trusted). The page therefore needs the
 * order id and its signed ownership reference, both issued when the order was placed, to ask the server what
 * happened.
 *
 * What it is **not**: it is not business persistence and never a statement of fact. It holds no amount, no status
 * and no payment outcome — those always come from the server. The reference is the same credential the API issued
 * for this order; losing it only means the page cannot look the order up (a safe, honest dead end), and it expires
 * on its own so a shared device does not keep it for long.
 *
 * `localStorage` rather than `sessionStorage`: the provider page may open the return link in a new tab or an in-app
 * browser; a tab-scoped store would lose the order exactly then.
 */

const STORAGE_KEY = "awj.pendingOnlinePayment.v1";

/** A reference older than this is dropped — long enough to finish paying, short enough for a shared device. */
export const PENDING_PAYMENT_TTL_MS = 6 * 60 * 60 * 1000;

export interface PendingOnlinePayment {
  orderId: string;
  orderReference: string;
  orderNumber: string | null;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked storage (private mode, policy): the journey degrades to "cannot identify order"
  }
}

export function savePendingOnlinePayment(
  value: Omit<PendingOnlinePayment, "savedAt">,
  now: number = Date.now(),
): void {
  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...value, savedAt: now } satisfies PendingOnlinePayment),
    );
  } catch {
    // Storage full/blocked: the redirect still happens; only the return page's lookup is affected.
  }
}

export function readPendingOnlinePayment(
  now: number = Date.now(),
): PendingOnlinePayment | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingOnlinePayment>;
    if (
      typeof parsed.orderId !== "string" ||
      typeof parsed.orderReference !== "string" ||
      typeof parsed.savedAt !== "number" ||
      now - parsed.savedAt > PENDING_PAYMENT_TTL_MS
    ) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      orderId: parsed.orderId,
      orderReference: parsed.orderReference,
      orderNumber:
        typeof parsed.orderNumber === "string" ? parsed.orderNumber : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    store.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearPendingOnlinePayment(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
