/**
 * Shared form shapes for the AWJ checkout stages.
 *
 * These are draft state only — what the shopper has typed but not yet sent.
 * Once a stage saves, its authority is the `StorefrontCheckout` the server
 * returns, and every stage re-reads from that rather than from its own draft.
 */

export interface ContactForm {
  name: string;
  phone: string;
  email: string;
}

export interface AddressForm {
  country: string;
  region: string;
  city: string;
  district: string;
  street: string;
  postalCode: string;
  notes: string;
}

/** FLOWERS-H12b — the gift stage's draft (ADR-15). Sent only when the shopper continues. */
export interface GiftForm {
  isGift: boolean;
  recipientName: string;
  recipientPhone: string;
  senderName: string;
  hideSender: boolean;
  message: string;
}

export const EMPTY_GIFT: GiftForm = {
  isGift: false,
  recipientName: "",
  recipientPhone: "",
  senderName: "",
  hideSender: false,
  message: "",
};

/** FLOWERS-H12b — the schedule stage's draft (ADR-19): a date and a window of that date. */
export interface ScheduleDraft {
  date: string | null;
  slotId: string | null;
}

export const EMPTY_SCHEDULE: ScheduleDraft = { date: null, slotId: null };

export const EMPTY_CONTACT: ContactForm = { name: "", phone: "", email: "" };

export const EMPTY_ADDRESS: AddressForm = {
  country: "",
  region: "",
  city: "",
  district: "",
  street: "",
  postalCode: "",
  notes: "",
};

/**
 * Every stage the journey can have, in order. `payment` is present because the
 * journey has a payment moment that must be designed; it is inert — see
 * `PAYMENT_CAPABILITY` and `PaymentStage`.
 *
 * `schedule` (delivery date & window, ADR-19) and `gift` (recipient, sender and
 * card message, ADR-15) are channel policies: a store that has not turned them
 * on has exactly the original six stages — see `activeCheckoutStages`.
 */
export const CHECKOUT_STAGES = [
  "contact",
  "address",
  "delivery",
  "schedule",
  "gift",
  "payment",
  "review",
  "confirmation",
] as const;

export type CheckoutStage = (typeof CHECKOUT_STAGES)[number];

/**
 * The stages this checkout actually has. Date comes before the gift card
 * because it depends on the destination and method already chosen, and is the
 * larger decision; the gift is optional and independent of both.
 */
export function activeCheckoutStages(options: {
  schedule: boolean;
  gift: boolean;
}): CheckoutStage[] {
  return CHECKOUT_STAGES.filter(
    (stage) =>
      (stage !== "schedule" || options.schedule) &&
      (stage !== "gift" || options.gift),
  );
}
