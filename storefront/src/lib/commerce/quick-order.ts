/**
 * H6 Quick Order (native wholesale) — view models and pure helpers.
 *
 * Everything the buyer sees here comes from the backend's `buyer/quick-order/*` responses: the SKU is resolved SERVER-side,
 * the price is the approved wholesale precedence (or none), and the only things sent back are ids and quantities. Nothing in
 * this module computes or submits a price.
 */

export type QuickOrderUnavailableReason =
  | "no_wholesale_price"
  | "not_purchasable";

export type QuickOrderLine = {
  productId: string;
  variantId: string | null;
  unitKey: string;
  unitName: string;
  sku: string | null;
  name: string;
  nameEn: string | null;
  descriptor: string | null;
  price: { amountMinor: number; currency: string } | null;
  available: boolean;
  unavailableReason: QuickOrderUnavailableReason | null;
  inStock: boolean | null;
  exact: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Strict mapper: anything that is not a well-formed line is dropped (never guessed at). */
export function quickOrderLineFromApi(raw: unknown): QuickOrderLine | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const r = raw as Record<string, unknown>;
  const productId = str(r.product_id);
  const name = str(r.name);
  if (!productId || !UUID.test(productId) || !name) return null;
  const variantId = str(r.product_variant_id);
  if (variantId !== null && !UUID.test(variantId)) return null;

  const priceRaw = r.price as Record<string, unknown> | null | undefined;
  const price =
    priceRaw &&
    typeof priceRaw === "object" &&
    Number.isInteger(priceRaw.amount_minor) &&
    typeof priceRaw.currency === "string"
      ? {
          amountMinor: priceRaw.amount_minor as number,
          currency: priceRaw.currency,
        }
      : null;
  // an "available" line must carry a price; a priced line is never shown as unavailable by guesswork
  const available = r.available === true && price !== null;
  const reason = r.unavailable_reason;

  return {
    productId,
    variantId,
    unitKey: str(r.unit_key) ?? "base",
    unitName: str(r.unit_name) ?? "",
    sku: str(r.sku),
    name,
    nameEn: str(r.name_en),
    descriptor: str(r.descriptor),
    price: available ? price : null,
    available,
    unavailableReason: available
      ? null
      : reason === "no_wholesale_price"
        ? "no_wholesale_price"
        : "not_purchasable",
    inStock: typeof r.in_stock === "boolean" ? r.in_stock : null,
    exact: r.exact === true,
  };
}

export const QUICK_ORDER_MAX_LINES = 50;
/** UI-side ceiling only (friendly validation); the server is the authority on quantities. */
export const QUICK_ORDER_MAX_QUANTITY = 999_999;

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Latin digits for quantities typed with Arabic-Indic or Persian numerals. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXT_ARABIC_INDIC.indexOf(d)));
}

export type QuantityError = "required" | "invalid" | "too_large";

/** `null` when the text is a whole number in 1..MAX; the reason otherwise. Never rounds or clamps silently. */
export function quantityError(text: string): QuantityError | null {
  const t = normalizeDigits(text).trim();
  if (t === "") return "required";
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  if (n < 1) return "invalid";
  if (n > QUICK_ORDER_MAX_QUANTITY) return "too_large";
  return null;
}

export function quantityValue(text: string): number {
  return Number(normalizeDigits(text).trim());
}

export type PastedRow = { sku: string; quantity: string };

/**
 * One row per non-empty line: `SKU`, `SKU 12`, `SKU,12`, `SKU;12`, `SKU<TAB>12`, `SKU x 12` (spaces required), `SKU × 12`. A line whose last token
 * is a whole number takes it as the quantity (default 1); everything before it is the SKU. At most `max` rows are returned and
 * `truncated` says whether more were dropped, so the caller can tell the buyer instead of silently ignoring lines.
 */
export function parsePastedRows(
  text: string,
  max = QUICK_ORDER_MAX_LINES,
): { rows: PastedRow[]; truncated: boolean } {
  const rows: PastedRow[] = [];
  let truncated = false;
  for (const rawLine of normalizeDigits(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (rows.length >= max) {
      truncated = true;
      break;
    }
    // The multiplication sign is unambiguous; a latin "x" only counts with spaces around it ("SHIRTX5" is a SKU, not 5 × SHIRT).
    const match = line.match(/^(.*?)(?:[\s,;:]+|\s+[xX]\s+|\s*×\s*)(\d+)$/u);
    if (match && match[1].trim() !== "") {
      rows.push({ sku: match[1].trim(), quantity: match[2] });
    } else {
      rows.push({ sku: line, quantity: "1" });
    }
  }
  return { rows, truncated };
}

export type QuickOrderEntry = {
  /** Local list key (stable across edits). */
  id: string;
  line: QuickOrderLine;
  /** Raw text of the quantity input. */
  quantity: string;
};

export type QuickOrderSubmitItem = {
  product_id: string;
  product_variant_id?: string;
  unit_key: string;
  quantity: number;
};

/** The entries that can be submitted: purchasable with an approved price AND a valid quantity. */
export function eligibleEntries(
  entries: readonly QuickOrderEntry[],
): QuickOrderEntry[] {
  return entries.filter(
    (e) => e.line.available && quantityError(e.quantity) === null,
  );
}

/** The wire shape — ids, unit and quantity only. No price, no buyer, no partner, no channel. */
export function submitItems(
  entries: readonly QuickOrderEntry[],
): QuickOrderSubmitItem[] {
  return entries.map((e) => ({
    product_id: e.line.productId,
    ...(e.line.variantId ? { product_variant_id: e.line.variantId } : {}),
    unit_key: e.line.unitKey,
    quantity: quantityValue(e.quantity),
  }));
}

/** Same product + variant + unit added twice → one entry with the summed quantity (the cart would merge them anyway). */
export function mergeEntry(
  entries: readonly QuickOrderEntry[],
  next: QuickOrderEntry,
): QuickOrderEntry[] {
  const same = (e: QuickOrderEntry) =>
    e.line.productId === next.line.productId &&
    e.line.variantId === next.line.variantId &&
    e.line.unitKey === next.line.unitKey;
  const index = entries.findIndex(same);
  if (index === -1) return [...entries, next];
  const merged = [...entries];
  // An invalid quantity on either side must stay visible and blocking: summing it as 0 would turn a typo into a
  // valid (smaller) order with no message. Keep the offending raw text so the row shows its validation error.
  if (quantityError(entries[index].quantity)) return merged;
  if (quantityError(next.quantity)) {
    merged[index] = { ...entries[index], quantity: next.quantity };
    return merged;
  }
  merged[index] = {
    ...entries[index],
    quantity: String(
      Math.min(
        quantityValue(entries[index].quantity) + quantityValue(next.quantity),
        QUICK_ORDER_MAX_QUANTITY,
      ),
    ),
  };
  return merged;
}

export type QuickOrderFailure = { index: number; reason: string };

/** Server rejection → which of the SUBMITTED entries failed (by position in the submitted list) and why. */
export function failuresFromError(error: unknown): QuickOrderFailure[] | null {
  const details = (error as { details?: unknown } | null)?.details as
    | { reason?: unknown; lines?: unknown }
    | undefined;
  if (details?.reason !== "quick_order_rejected") return null;
  if (!Array.isArray(details.lines)) return [];
  return details.lines.flatMap((l) => {
    const row = l as { index?: unknown; reason?: unknown };
    return Number.isInteger(row.index) && typeof row.reason === "string"
      ? [{ index: row.index as number, reason: row.reason }]
      : [];
  });
}
