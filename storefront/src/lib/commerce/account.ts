/**
 * Native retail customer account — pure vocabulary, mappers and error classification (B2C-ACCOUNTS).
 *
 * No I/O, no `next/*`: it maps what `store/v1` (`auth/*`, `me`, `account/*`) returns onto the small view models the
 * account pages render, and maps failures onto a CLOSED set of safe codes the UI localizes. The authority is always the
 * backend; nothing here decides ownership, eligibility or session validity.
 */
import type { AccountAuthFailureCode } from "@/lib/commerce/account-errors";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

export interface AccountCustomer {
  id: string;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

/** The API stores one display name; the shell greets with first/last. Split on the first whitespace only. */
export function splitDisplayName(displayName: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = displayName.trim();
  if (trimmed === "") return { firstName: null, lastName: null };
  const index = trimmed.search(/\s/);
  if (index === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, index),
    lastName: trimmed.slice(index).trim() || null,
  };
}

export function joinDisplayName(first?: string, last?: string): string {
  return `${first ?? ""} ${last ?? ""}`.trim();
}

export function customerFromApi(raw: unknown): AccountCustomer | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const email = str(raw.email);
  if (!id || !email) return null;
  const displayName = str(raw.display_name) ?? "";
  return {
    id,
    email,
    displayName,
    ...splitDisplayName(displayName),
    phone: str(raw.phone),
  };
}

export interface AccountAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  country: string;
  region: string | null;
  city: string;
  district: string | null;
  street: string;
  buildingNo: string | null;
  additionalNumber: string | null;
  postalCode: string | null;
  deliveryNotes: string | null;
  isDefaultShipping: boolean;
}

export function addressFromApi(raw: unknown): AccountAddress | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const recipientName = str(raw.recipient_name);
  const phone = str(raw.phone);
  const country = str(raw.country);
  const city = str(raw.city);
  const street = str(raw.street);
  if (!id || !recipientName || !phone || !country || !city || !street) {
    return null;
  }
  return {
    id,
    label: str(raw.label),
    recipientName,
    phone,
    country,
    region: str(raw.region),
    city,
    district: str(raw.district),
    street,
    buildingNo: str(raw.building_no),
    additionalNumber: str(raw.additional_number),
    postalCode: str(raw.postal_code),
    deliveryNotes: str(raw.delivery_notes),
    isDefaultShipping: raw.is_default_shipping === true,
  };
}

/** The editable address fields the form submits (snake_case = the API body). Identity and tenant are never part of it. */
export interface AddressInput {
  label?: string;
  recipient_name: string;
  phone: string;
  country: string;
  region?: string;
  city: string;
  district?: string;
  street: string;
  building_no?: string;
  additional_number?: string;
  postal_code?: string;
  delivery_notes?: string;
  is_default_shipping?: boolean;
}

const ADDRESS_KEYS: ReadonlyArray<keyof AddressInput> = [
  "label",
  "recipient_name",
  "phone",
  "country",
  "region",
  "city",
  "district",
  "street",
  "building_no",
  "additional_number",
  "postal_code",
  "delivery_notes",
  "is_default_shipping",
];

/** Allow-list the body: only known address keys, blanks dropped (a PATCH never clears with "" by accident). */
export function addressBody(
  input: Partial<AddressInput>,
): Partial<AddressInput> {
  const body: Record<string, unknown> = {};
  for (const key of ADDRESS_KEYS) {
    const value = input[key];
    if (typeof value === "boolean") body[key] = value;
    else if (typeof value === "string" && value.trim() !== "") {
      body[key] = key === "country" ? value.trim().toUpperCase() : value.trim();
    }
  }
  return body as Partial<AddressInput>;
}

export interface AccountSession {
  id: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  current: boolean;
}

export function sessionFromApi(raw: unknown): AccountSession | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    createdAt: str(raw.created_at),
    lastUsedAt: str(raw.last_used_at),
    expiresAt: str(raw.expires_at),
    current: raw.current === true,
  };
}

/**
 * A failed API call → a safe closed code (never upstream text). 401 on an action that already has a session means the
 * session is gone; the data layer reports it as `signed_out` separately.
 */
export function accountFailureCode(
  status: number | undefined,
  action: "login" | "form",
): AccountAuthFailureCode {
  if (status === 429) return "rate_limited";
  if (status === 404) return "capability_unavailable";
  if (action === "login") {
    return status === 401 || status === 403 || status === 422
      ? "invalid_credentials"
      : "request_failed";
  }
  if (status === 422) return "validation_failed";
  return "request_failed";
}

/** What a lifetime of a freshly issued token means for the cookie — mirrors the API's own `session_days`. */
export function sessionDaysFrom(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}
