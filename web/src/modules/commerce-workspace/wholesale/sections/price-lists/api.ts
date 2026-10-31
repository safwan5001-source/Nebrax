import { api } from '@/lib/api';
import { loadProductPublicationList } from '@/modules/products/publication';
import { updateChannelSettings, type ChannelSettings } from '../../channel';

/**
 * Price lists are AWJ-wide sales settings (`CompanyWide`); the wholesale channel merely points at one through
 * `sales_channels.default_price_list_id`. Amounts: the API returns riyal strings (`price`) and accepts minor units.
 */

export type PriceListItem = {
  id: string;
  price_list_id: string;
  product_id: string;
  product_name?: string | null;
  product_sku?: string | null;
  unit_name: string | null;
  /** Riyal string, as returned by the API (display only). */
  price: string;
};

export type PriceList = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  items_count?: number;
  items?: PriceListItem[];
};

export type PriceListInput = { name: string; description: string | null; is_active: boolean };

export async function fetchPriceLists(): Promise<PriceList[]> {
  const response = await api<{ data: PriceList[] }>('/price-lists');
  return Array.isArray(response.data) ? response.data : [];
}

export async function fetchPriceList(id: string): Promise<PriceList> {
  const response = await api<{ data: PriceList }>(`/price-lists/${encodeURIComponent(id)}`);
  return response.data;
}

export async function createPriceList(input: PriceListInput): Promise<PriceList> {
  const response = await api<{ data: PriceList }>('/price-lists', { method: 'POST', body: input });
  return response.data;
}

export async function updatePriceList(id: string, input: PriceListInput): Promise<PriceList> {
  const response = await api<{ data: PriceList }>(`/price-lists/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
  return response.data;
}

export async function deletePriceList(id: string): Promise<void> {
  await api(`/price-lists/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** `priceMinor` is an integer in halalas (the contract); callers convert from the riyal input with `riyalToMinor`. */
export async function addPriceListItem(listId: string, item: { product_id: string; unit_name: string | null; price: number }): Promise<PriceListItem> {
  const response = await api<{ data: PriceListItem }>(`/price-lists/${encodeURIComponent(listId)}/items`, { method: 'POST', body: item });
  return response.data;
}

export async function removePriceListItem(listId: string, itemId: string): Promise<void> {
  await api(`/price-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
}

export type ProductChoice = { id: string; name: string; sku: string | null; is_active: boolean; units: { name: string; factor: number }[] };

export async function searchProducts(search: string): Promise<ProductChoice[]> {
  const query = new URLSearchParams({ search, per_page: '10' });
  const response = await api<{ data: ProductChoice[] }>(`/products?${query.toString()}`);
  return Array.isArray(response.data) ? response.data : [];
}

export type CustomerDefault = { id: string; name: string; default_price_list_id: string | null };

/** Customers' own default list (used by POS / ERP invoices — not by the wholesale storefront today). */
export async function fetchCustomerDefaults(): Promise<CustomerDefault[]> {
  const response = await api<{ data: CustomerDefault[] }>('/partners?type=customer');
  return (Array.isArray(response.data) ? response.data : []).map((partner) => ({
    id: partner.id,
    name: partner.name,
    default_price_list_id: partner.default_price_list_id ?? null,
  }));
}

/** Assign (id) or clear (null) the channel default list. Sends ONLY `default_price_list_id`. */
export function assignChannelPriceList(channelId: string, priceListId: string | null): Promise<ChannelSettings> {
  return updateChannelSettings(channelId, { default_price_list_id: priceListId });
}

// ── coverage diagnostics ────────────────────────────────────────────────────────────────────────────────────────

export const COVERAGE_PAGE_SIZE = 100;
export const COVERAGE_MAX_PAGES = 10;

export type PublishedProduct = { id: string; name: string; sku: string | null };

/**
 * Active products published on the store, paged from the server. Stops after `maxPages` and says so (`partial`):
 * a capped scan is never presented as a total.
 */
export async function collectPublishedProducts(
  storeId: string,
  { maxPages = COVERAGE_MAX_PAGES }: { maxPages?: number } = {},
): Promise<{ products: PublishedProduct[]; partial: boolean; serverTotal: number }> {
  const products: PublishedProduct[] = [];
  let page = 1;
  let lastPage = 1;
  let serverTotal = 0;
  do {
    const result = await loadProductPublicationList({ storefrontId: storeId, status: 'published', page, perPage: COVERAGE_PAGE_SIZE });
    serverTotal = result.meta.total;
    lastPage = result.meta.lastPage;
    for (const item of result.items) {
      if (item.isActive) products.push({ id: item.id, name: item.name, sku: item.sku });
    }
    page += 1;
  } while (page <= lastPage && page <= maxPages);

  return { products, partial: lastPage > maxPages, serverTotal };
}

export type Coverage = {
  /** Active published products examined. */
  total: number;
  covered: number;
  uncovered: PublishedProduct[];
  /** Price-list items whose product is not (active and) published on this store — informational. */
  itemsOutsideCatalog: number;
};

/** Pure: a product is covered when the list holds at least one item for it (any unit). */
export function computeCoverage(published: PublishedProduct[], itemProductIds: string[]): Coverage {
  const inList = new Set(itemProductIds);
  const publishedIds = new Set(published.map((product) => product.id));
  const uncovered = published.filter((product) => !inList.has(product.id));
  return {
    total: published.length,
    covered: published.length - uncovered.length,
    uncovered,
    itemsOutsideCatalog: [...inList].filter((id) => !publishedIds.has(id)).length,
  };
}
