/**
 * FLOWERS-H12b — the gift and delivery-schedule parts of the checkout and the
 * order, normalized for the storefront.
 *
 * Authority stays with the server: the gift policy limits (ADR-15), whether a
 * stored schedule is still selectable (ADR-19) and every completion check come
 * from the API. This module only validates and reshapes what the API sent;
 * anything malformed is dropped (a schedule with a bad date or window is
 * treated as not chosen) rather than repaired or guessed.
 */

import type {
  AwjCheckoutSchedule,
  AwjGift,
  AwjGiftOptions,
  AwjOrderSchedule,
} from "./checkout-types";

export interface StorefrontGift {
  recipientName: string | null;
  recipientPhone: string | null;
  senderDisplayName: string | null;
  hideSender: boolean;
  message: string | null;
}

export interface StorefrontGiftOptions {
  enabled: boolean;
  messageMaxLength: number;
  allowHideSender: boolean;
  recipientPhoneRequired: boolean;
}

/** A store without a gift policy (or an API that predates it) offers no gifting. */
export const GIFT_OPTIONS_DISABLED: StorefrontGiftOptions = {
  enabled: false,
  messageMaxLength: 250,
  allowHideSender: true,
  recipientPhoneRequired: true,
};

export interface StorefrontScheduleSlot {
  id: string;
  label: string;
  labelEn: string | null;
  startTime: string;
  endTime: string;
}

/** The stored selection on an open checkout. */
export interface StorefrontSchedule {
  date: string;
  /** `null` once the window is no longer selectable for the stored method/destination. */
  slot: StorefrontScheduleSlot | null;
  valid: boolean;
}

/** The immutable schedule on an order. */
export interface StorefrontOrderSchedule {
  method: "delivery" | "pickup";
  date: string;
  slot: Omit<StorefrontScheduleSlot, "id">;
  timezone: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function mapGift(
  raw: AwjGift | null | undefined,
): StorefrontGift | null {
  if (!isRecord(raw)) return null;
  return {
    recipientName: str(raw.recipient_name),
    recipientPhone: str(raw.recipient_phone),
    senderDisplayName: str(raw.sender_display_name),
    hideSender: raw.hide_sender === true,
    message: str(raw.message),
  };
}

export function mapGiftOptions(
  raw: AwjGiftOptions | undefined,
): StorefrontGiftOptions {
  if (!isRecord(raw) || raw.enabled !== true) return GIFT_OPTIONS_DISABLED;
  const max = raw.message_max_length;
  return {
    enabled: true,
    messageMaxLength:
      typeof max === "number" && Number.isInteger(max) && max > 0
        ? max
        : GIFT_OPTIONS_DISABLED.messageMaxLength,
    allowHideSender: raw.allow_hide_sender !== false,
    recipientPhoneRequired: raw.recipient_phone_required !== false,
  };
}

function mapSlot(raw: unknown): StorefrontScheduleSlot | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const label = str(raw.label);
  const start = str(raw.start_time);
  const end = str(raw.end_time);
  if (
    !id ||
    !label ||
    !start ||
    !end ||
    !CLOCK.test(start) ||
    !CLOCK.test(end)
  ) {
    return null;
  }
  return {
    id,
    label,
    labelEn: str(raw.label_en),
    startTime: start,
    endTime: end,
  };
}

export function mapCheckoutSchedule(
  raw: AwjCheckoutSchedule | undefined,
): StorefrontSchedule | null {
  if (!isRecord(raw)) return null;
  const date = str(raw.date);
  if (!date || !ISO_DATE.test(date)) return null;
  const slot = mapSlot(raw.slot);
  return { date, slot, valid: raw.valid === true && slot !== null };
}

export function mapOrderSchedule(
  raw: AwjOrderSchedule | undefined,
): StorefrontOrderSchedule | null {
  if (!isRecord(raw)) return null;
  const date = str(raw.date);
  const timezone = str(raw.timezone);
  const method =
    raw.method === "delivery" || raw.method === "pickup" ? raw.method : null;
  const slotRaw = raw.slot;
  const label = isRecord(slotRaw) ? str(slotRaw.label) : null;
  const start = isRecord(slotRaw) ? str(slotRaw.start_time) : null;
  const end = isRecord(slotRaw) ? str(slotRaw.end_time) : null;
  if (
    !date ||
    !ISO_DATE.test(date) ||
    !timezone ||
    !method ||
    !label ||
    !start ||
    !end ||
    !CLOCK.test(start) ||
    !CLOCK.test(end)
  ) {
    return null;
  }
  return {
    method,
    date,
    timezone,
    slot: {
      label,
      labelEn: isRecord(slotRaw) ? str(slotRaw.label_en) : null,
      startTime: start,
      endTime: end,
    },
  };
}

/** The checkout's delivery method as the schedule API names it. */
export function scheduleMethodFor(
  deliveryMethod: string | null,
): "delivery" | "pickup" | null {
  if (deliveryMethod === "standard") return "delivery";
  if (deliveryMethod === "pickup") return "pickup";
  return null;
}

/** The selectable dates and windows from `GET delivery-schedule` (ADR-19). */
export interface StorefrontDeliverySchedule {
  enabled: boolean;
  /** The channel requires a date and window before an order can be placed. */
  required: boolean;
  method: "delivery" | "pickup";
  timezone: string | null;
  dates: Array<{ date: string; slots: StorefrontScheduleSlot[] }>;
}

export function mapDeliverySchedule(
  raw: unknown,
  method: "delivery" | "pickup",
): StorefrontDeliverySchedule {
  const off: StorefrontDeliverySchedule = {
    enabled: false,
    required: false,
    method,
    timezone: null,
    dates: [],
  };
  if (!isRecord(raw) || raw.enabled !== true) return off;
  const dates: StorefrontDeliverySchedule["dates"] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(raw.dates) ? raw.dates : []) {
    if (!isRecord(row)) continue;
    const date = str(row.date);
    if (!date || !ISO_DATE.test(date) || seen.has(date)) continue;
    const slots = (Array.isArray(row.slots) ? row.slots : [])
      .map(mapSlot)
      .filter((slot): slot is StorefrontScheduleSlot => slot !== null);
    if (slots.length === 0) continue;
    seen.add(date);
    dates.push({ date, slots });
  }
  return {
    enabled: true,
    required: raw.required === true,
    method,
    timezone: str(raw.timezone),
    dates,
  };
}
