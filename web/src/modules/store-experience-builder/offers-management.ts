import type {
  WorkspaceOffer,
  WorkspaceOfferDeleteOutcome,
  WorkspaceOfferMutationOutcome,
  WorkspaceOfferWrite,
} from "@/modules/commerce-workspace/workspace-offers";
import type { WorkspaceProductListOutcome } from "@/modules/commerce-workspace/workspace-products";
import type { PresentationHomeSection } from "./presentation/config";
import { offersContentOf } from "./presentation/section-content";

/**
 * CUST-H4-7b — thin merchant CRUD over the H4-6 `storefront_offers` backend.
 *
 * Two authorities, kept apart on purpose:
 *  - the configured Offers catalog is storefront-level Commerce data, owned by
 *    `ExperienceBuilder`'s shared workspace read and mutated only through these
 *    actions (the server answers; the UI reconciles to it — no shadow model);
 *  - which offers a section shows is per-instance presentation content
 *    (`OffersContent.offerIds`).
 */
export interface OfferManagement {
  /** Server cap (`meta.max_offers`, 12 today); `null` until the first read. */
  maxOffers: number | null;
  /** Search the real workspace product source (same one Featured uses). */
  searchProducts: (search: string, signal?: AbortSignal) => Promise<WorkspaceProductListOutcome>;
  create: (input: WorkspaceOfferWrite) => Promise<WorkspaceOfferMutationOutcome>;
  update: (offerId: string, input: WorkspaceOfferWrite) => Promise<WorkspaceOfferMutationOutcome>;
  remove: (offerId: string) => Promise<WorkspaceOfferDeleteOutcome>;
}

/** Inclusive upper bound mirrored from `StorefrontOfferService::MAX_POSITION` (input `max` attribute only). */
export const OFFER_MAX_POSITION = 9999;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * ISO-8601 instant from the API → the `YYYY-MM-DDTHH:mm` string a native
 * `datetime-local` input expects, in the merchant's local time. No timezone
 * policy is invented: the API stores/compares UTC instants, the browser shows
 * the same instant locally.
 */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Local `datetime-local` value → the ISO-8601 instant (with `Z`) the H4-6 API
 * accepts. Empty / unparsable → `null` (= "no bound", which also clears an
 * existing bound on PATCH).
 */
export function localInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Removes a deleted offer id from every Offers section that references it, so
 * no merchant-visible selection dangles. Pure: returns the same array (and the
 * same section objects) when nothing referenced the id, so callers can skip a
 * needless draft change.
 */
export function removeOfferIdFromSections(
  sections: PresentationHomeSection[],
  offerId: string,
): { sections: PresentationHomeSection[]; changed: boolean } {
  let changed = false;
  const next = sections.map((section) => {
    if (section.type !== "offers") return section;
    const ids = offersContentOf(section).offerIds;
    if (!ids.includes(offerId)) return section;
    changed = true;
    const remaining = ids.filter((id) => id !== offerId);
    return { ...section, content: remaining.length ? { offerIds: remaining } : undefined };
  });
  return changed ? { sections: next, changed } : { sections, changed };
}

/** Rows ordered like the server orders them (`position`, then the server's own stable order). */
export function upsertOffer(rows: WorkspaceOffer[], offer: WorkspaceOffer): WorkspaceOffer[] {
  const exists = rows.some((row) => row.id === offer.id);
  const merged = exists ? rows.map((row) => (row.id === offer.id ? offer : row)) : [...rows, offer];
  return merged
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.position - b.row.position || a.index - b.index)
    .map(({ row }) => row);
}
