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
 * The six stages, in order. `payment` is present because the journey has a
 * payment moment that must be designed; it is inert — see
 * `PAYMENT_CAPABILITY` and `PaymentStage`.
 */
export const CHECKOUT_STAGES = [
  "contact",
  "address",
  "delivery",
  "payment",
  "review",
  "confirmation",
] as const;

export type CheckoutStage = (typeof CHECKOUT_STAGES)[number];
