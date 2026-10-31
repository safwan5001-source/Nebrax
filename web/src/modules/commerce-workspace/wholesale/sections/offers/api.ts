import {
  createWorkspaceOffer,
  deleteWorkspaceOffer,
  listWorkspaceOffers,
  updateWorkspaceOffer,
  type WorkspaceOffer,
  type WorkspaceOfferWrite,
} from '@/modules/commerce-workspace/workspace-offers';
import { listWorkspaceProducts, type WorkspaceProductSummary } from '@/modules/commerce-workspace/workspace-products';

/**
 * Wholesale offers ARE the store's offers (`storefront_offers`) — one table, one resolver (`StorefrontOfferResolver`).
 * An offer row is only a scheduled candidate: it carries no price or discount. It is live only when the channel's
 * resolved price for the product is strictly below the product's base price, so "discount configuration" for
 * wholesale is the channel price list (Price Lists section) plus this candidate list.
 */

const statusForReason = { forbidden: 403, not_found: 404, failed: 500 } as const;

export type LoadedOffers = { offers: WorkspaceOffer[]; maxOffers: number | null };

/** The workspace client reports failures as values; `useResource` expects a throw, so convert with a status. */
export async function loadOffers(storeId: string): Promise<LoadedOffers> {
  const outcome = await listWorkspaceOffers(storeId);
  if (!outcome.ok) throw Object.assign(new Error(outcome.message), { status: statusForReason[outcome.reason] });
  return { offers: outcome.data, maxOffers: outcome.maxOffers };
}

/** Eligible products (active + published on the store) matching a search — the only products an offer can point at. */
export async function searchEligibleProducts(storeId: string, search: string): Promise<WorkspaceProductSummary[]> {
  const outcome = await listWorkspaceProducts(storeId, { search: search || undefined, perPage: 10 });
  return outcome.ok ? outcome.data : [];
}

export { createWorkspaceOffer, deleteWorkspaceOffer, updateWorkspaceOffer };
export type { WorkspaceOffer, WorkspaceOfferWrite };

/** `<input type="datetime-local">` value (local, minute precision) → ISO-8601 with offset; empty → null. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO → `datetime-local` value in the viewer's zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
