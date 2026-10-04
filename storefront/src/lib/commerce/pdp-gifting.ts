/**
 * FLOWERS-H11 — the gifting blocks of a product detail, normalized for the PDP.
 *
 * Source: `GET store/v1/products/{id}` (ADR-16 personalization, ADR-17 content
 * blocks, ADR-18 add-ons, ADR-20 delivery promise). The storefront renders
 * these and sends the shopper's *choices* back (field values, add-on product /
 * variant / quantity); every price, availability and validity decision stays
 * with the server, which re-validates and re-prices on add-to-cart. Nothing
 * here computes or invents any of it, and malformed rows are dropped rather
 * than repaired.
 */

export type PersonalizationFieldType = "text" | "textarea" | "select";

export interface PersonalizationOption {
  valueKey: string;
  label: string;
}

export interface PersonalizationField {
  key: string;
  type: PersonalizationFieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  /** null for `select`. */
  maxLength: number | null;
  options: PersonalizationOption[];
}

export const CONTENT_BLOCK_TYPES = [
  "composition",
  "care",
  "natural_variation",
  "included_items",
  "dimensions",
  "materials",
  "allergens",
  "storage",
  "preparation_notes",
  "personalization_instructions",
] as const;
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export interface ContentBlock {
  type: ContentBlockType;
  /** Plain text — never HTML. */
  body: string;
}

export interface AddonOption {
  productId: string;
  variantId: string | null;
  name: string;
  /** Informational; the server re-prices every add-on line. */
  amountMinor: number;
  currency: string;
  inStock: boolean | null;
  maxQuantity: number;
  thumbnailUrl: string | null;
}

export interface DeliveryPromiseView {
  deliverable: boolean;
  sameDay: boolean;
  /** `Y-m-d` and the slot's window; null unless deliverable. */
  earliest: { date: string; startTime: string; endTime: string } | null;
}

export interface ProductGifting {
  personalization: PersonalizationField[];
  contentBlocks: ContentBlock[];
  addons: AddonOption[];
  /** null = the store does not state a promise (scheduling off / not configured). */
  deliveryPromise: DeliveryPromiseView | null;
}

export const EMPTY_PRODUCT_GIFTING: ProductGifting = {
  personalization: [],
  contentBlocks: [],
  addons: [],
  deliveryPromise: null,
};

/** Bounds mirror the API's own ceilings so a hostile payload cannot flood the page. */
export const MAX_PERSONALIZATION_FIELDS = 8;
export const MAX_CONTENT_BLOCKS = 12;
export const MAX_ADDONS = 12;
export const MAX_SELECT_OPTIONS = 40;
/** `CommerceProductAddon::MAX_QUANTITY_CEILING` — a larger value is a contract violation. */
export const MAX_ADDON_QUANTITY = 10;

const FIELD_KEY = /^[a-z0-9][a-z0-9_]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CURRENCY = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pick(name: unknown, nameEn: unknown, locale: string): string | null {
  const en = text(nameEn);
  return locale.toLowerCase().startsWith("en") && en ? en : text(name);
}

function parseFields(raw: unknown, locale: string): PersonalizationField[] {
  const rows =
    isRecord(raw) && Array.isArray(raw.fields) ? (raw.fields as unknown[]) : [];
  const out: PersonalizationField[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= MAX_PERSONALIZATION_FIELDS) break;
    if (!isRecord(row)) continue;
    const key = text(row.key);
    const type = row.type;
    const label = pick(row.label, row.label_en, locale);
    if (
      !key ||
      !FIELD_KEY.test(key) ||
      seen.has(key) ||
      !label ||
      (type !== "text" && type !== "textarea" && type !== "select")
    ) {
      continue;
    }
    let options: PersonalizationOption[] = [];
    if (type === "select") {
      const rawOptions = Array.isArray(row.options)
        ? (row.options as unknown[])
        : [];
      for (const option of rawOptions) {
        if (options.length >= MAX_SELECT_OPTIONS) break;
        if (!isRecord(option)) continue;
        const valueKey = text(option.value_key);
        const optionLabel = pick(option.label, option.label_en, locale);
        if (!valueKey || !optionLabel) continue;
        options.push({ valueKey, label: optionLabel });
      }
      // A choice with nothing to choose from cannot be answered — drop it.
      if (options.length === 0) continue;
    } else {
      options = [];
    }
    const maxLength =
      type === "select"
        ? null
        : typeof row.max_length === "number" &&
            Number.isInteger(row.max_length) &&
            row.max_length > 0
          ? row.max_length
          : null;
    seen.add(key);
    out.push({
      key,
      type,
      label,
      helpText: text(row.help_text),
      required: row.is_required === true,
      maxLength,
      options,
    });
  }
  return out;
}

function parseBlocks(raw: unknown, locale: string): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentBlock[] = [];
  for (const row of raw) {
    if (out.length >= MAX_CONTENT_BLOCKS) break;
    if (!isRecord(row)) continue;
    const type = row.type;
    const body = pick(row.body, row.body_en, locale);
    if (
      typeof type !== "string" ||
      !(CONTENT_BLOCK_TYPES as readonly string[]).includes(type) ||
      !body
    ) {
      continue;
    }
    out.push({ type: type as ContentBlockType, body });
  }
  return out;
}

function parseAddons(raw: unknown, locale: string): AddonOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AddonOption[] = [];
  for (const row of raw) {
    if (out.length >= MAX_ADDONS) break;
    if (!isRecord(row)) continue;
    const productId = text(row.product_id);
    const variantRaw = row.product_variant_id;
    const variantId = text(variantRaw);
    const name = pick(row.name, row.name_en, locale);
    const price = isRecord(row.price) ? row.price : null;
    const amount = price?.amount_minor;
    const currency = text(price?.currency);
    const max = row.max_quantity;
    if (
      !productId ||
      !UUID.test(productId) ||
      (variantRaw !== null && variantRaw !== undefined && !variantId) ||
      (variantId !== null && !UUID.test(variantId)) ||
      !name ||
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < 0 ||
      !currency ||
      !CURRENCY.test(currency) ||
      typeof max !== "number" ||
      !Number.isInteger(max) ||
      max < 1 ||
      max > MAX_ADDON_QUANTITY
    ) {
      continue;
    }
    out.push({
      productId,
      variantId,
      name,
      amountMinor: amount,
      currency,
      inStock: typeof row.in_stock === "boolean" ? row.in_stock : null,
      maxQuantity: max,
      thumbnailUrl: text(row.thumbnail_url),
    });
  }
  return out;
}

function parsePromise(raw: unknown): DeliveryPromiseView | null {
  if (!isRecord(raw) || typeof raw.deliverable !== "boolean") return null;
  const sameDay = raw.same_day === true;
  const earliest = isRecord(raw.earliest) ? raw.earliest : null;
  const slot = earliest && isRecord(earliest.slot) ? earliest.slot : null;
  const date = text(earliest?.date);
  const start = text(slot?.start_time);
  const end = text(slot?.end_time);
  const valid =
    date !== null &&
    ISO_DATE.test(date) &&
    start !== null &&
    CLOCK.test(start) &&
    end !== null &&
    CLOCK.test(end);
  if (raw.deliverable && !valid) return null;
  return {
    deliverable: raw.deliverable,
    sameDay: raw.deliverable && sameDay,
    earliest:
      raw.deliverable && valid
        ? {
            date: date as string,
            startTime: start as string,
            endTime: end as string,
          }
        : null,
  };
}

export function parseProductGifting(
  raw: {
    personalization?: unknown;
    content_blocks?: unknown;
    addons?: unknown;
    delivery_promise?: unknown;
  },
  locale: string,
): ProductGifting {
  return {
    personalization: parseFields(raw.personalization, locale),
    contentBlocks: parseBlocks(raw.content_blocks, locale),
    addons: parseAddons(raw.addons, locale),
    deliveryPromise: parsePromise(raw.delivery_promise),
  };
}

export function hasGifting(gifting: ProductGifting): boolean {
  return (
    gifting.personalization.length > 0 ||
    gifting.contentBlocks.length > 0 ||
    gifting.addons.length > 0 ||
    gifting.deliveryPromise !== null
  );
}

/** What the shopper chose, sent to the cart as-is (the server validates and prices). */
export interface PdpSelections {
  /** Only non-empty answers, keyed by field key. */
  personalization: Record<string, string>;
  addons: { productId: string; variantId: string | null; quantity: number }[];
}

export const EMPTY_PDP_SELECTIONS: PdpSelections = {
  personalization: {},
  addons: [],
};

/** Keys of required fields still unanswered (blank / whitespace counts as unanswered). */
export function missingRequiredFields(
  fields: readonly PersonalizationField[],
  values: Readonly<Record<string, string>>,
): string[] {
  return fields
    .filter(
      (field) => field.required && (values[field.key] ?? "").trim() === "",
    )
    .map((field) => field.key);
}
