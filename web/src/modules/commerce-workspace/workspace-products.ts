/**
 * CUST-H2-3 — عميل واجهة قراءة منتجات مساحة عمل Commerce
 * (`commerce/workspace/storefronts/{id}/products`). نفس اتفاقية
 * `presentation-versions.ts`: `{id}`/`{product}` محدِّدا صفّ فقط، لا
 * `tenant_id` في أي طلب، والمستأجر من الجلسة عبر `SetTenant`. قراءة فقط —
 * لا فعل كتابي هنا إطلاقاً، ولا يُستهلك هذا العميل من خارج المُخصِّص.
 *
 * منتقي "معاينة منتج" هو **سياق محرِّر فقط**: لا شيء هنا يُكتَب إلى
 * `pagePresentation`/الحفظ/النشر — راجع `ExperienceBuilder`'s
 * `previewProductId` state.
 */

import { api, hasApiStatus } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export function commerceWorkspaceProductsPath(storefrontId: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${storefrontId}/products`;
}

export function commerceWorkspaceProductPath(storefrontId: string, productId: string): string {
  return `${commerceWorkspaceProductsPath(storefrontId)}/${productId}`;
}

export interface WorkspaceProductSummary {
  id: string;
  name: string;
  nameEn: string | null;
  thumbnailUrl: string | null;
  isVariantManaged: boolean;
}

export interface WorkspaceProductOptionValue {
  id: string;
  value: string;
  valueEn: string | null;
}

export interface WorkspaceProductOption {
  id: string;
  name: string;
  nameEn: string | null;
  values: WorkspaceProductOptionValue[];
}

export interface WorkspaceProductMedia {
  id: string;
  url: string;
  alt: string | null;
}

export interface WorkspaceProductVariant {
  id: string;
  sku: string | null;
  optionValueIds: string[];
  priceAmountMinor: number;
  currency: string;
  inStock: boolean | null;
  media: WorkspaceProductMedia[];
}

export interface WorkspaceProductDetail {
  id: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  sku: string | null;
  categoryName: string | null;
  priceAmountMinor: number;
  currency: string;
  inStock: boolean | null;
  media: WorkspaceProductMedia[];
  isVariantManaged: boolean;
  options: WorkspaceProductOption[] | null;
  variants: WorkspaceProductVariant[] | null;
}

interface Failure<Reason extends string> {
  ok: false;
  reason: Reason;
  message: string;
}

export type WorkspaceProductListOutcome =
  | { ok: true; data: WorkspaceProductSummary[]; hasMore: boolean }
  | Failure<'forbidden' | 'not_found' | 'failed'>;

export type WorkspaceProductReadOutcome =
  | { ok: true; data: WorkspaceProductDetail }
  | Failure<'forbidden' | 'not_found' | 'failed'>;

function classifyReadFailure(error: unknown): 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  return 'failed';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function asMediaList(raw: unknown): WorkspaceProductMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceProductMedia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.url !== 'string') continue;
    out.push({ id: row.id, url: row.url, alt: typeof row.alt === 'string' ? row.alt : null });
  }
  return out;
}

function mapSummary(row: unknown): WorkspaceProductSummary | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') return null;
  if (typeof record.name !== 'string') return null;
  return {
    id: record.id,
    name: record.name,
    nameEn: typeof record.name_en === 'string' ? record.name_en : null,
    thumbnailUrl: typeof record.thumbnail_url === 'string' ? record.thumbnail_url : null,
    isVariantManaged: record.is_variant_managed === true,
  };
}

function mapOptions(raw: unknown): WorkspaceProductOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WorkspaceProductOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    const values = Array.isArray(row.values) ? row.values : [];
    const mappedValues: WorkspaceProductOptionValue[] = [];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const valueRow = value as Record<string, unknown>;
      if (typeof valueRow.id !== 'string' || typeof valueRow.value !== 'string') continue;
      mappedValues.push({
        id: valueRow.id,
        value: valueRow.value,
        valueEn: typeof valueRow.value_en === 'string' ? valueRow.value_en : null,
      });
    }
    out.push({
      id: row.id,
      name: row.name,
      nameEn: typeof row.name_en === 'string' ? row.name_en : null,
      values: mappedValues,
    });
  }
  return out;
}

function mapVariants(raw: unknown): WorkspaceProductVariant[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WorkspaceProductVariant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string') continue;
    const price = row.price && typeof row.price === 'object' ? (row.price as Record<string, unknown>) : {};
    out.push({
      id: row.id,
      sku: typeof row.sku === 'string' ? row.sku : null,
      optionValueIds: Array.isArray(row.option_value_ids)
        ? row.option_value_ids.filter((v): v is string => typeof v === 'string')
        : [],
      priceAmountMinor: typeof price.amount_minor === 'number' ? price.amount_minor : 0,
      currency: typeof price.currency === 'string' ? price.currency : 'SAR',
      inStock: typeof row.in_stock === 'boolean' ? row.in_stock : null,
      media: asMediaList(row.media),
    });
  }
  return out;
}

function mapDetail(payload: unknown): WorkspaceProductDetail | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (typeof row.name !== 'string') return null;
  const price = row.price && typeof row.price === 'object' ? (row.price as Record<string, unknown>) : {};
  const category = row.category && typeof row.category === 'object' ? (row.category as Record<string, unknown>) : null;

  return {
    id: row.id,
    name: row.name,
    nameEn: typeof row.name_en === 'string' ? row.name_en : null,
    description: typeof row.description === 'string' ? row.description : null,
    sku: typeof row.sku === 'string' ? row.sku : null,
    categoryName: category && typeof category.name === 'string' ? category.name : null,
    priceAmountMinor: typeof price.amount_minor === 'number' ? price.amount_minor : 0,
    currency: typeof price.currency === 'string' ? price.currency : 'SAR',
    inStock: typeof row.in_stock === 'boolean' ? row.in_stock : null,
    media: asMediaList(row.media),
    isVariantManaged: row.is_variant_managed === true,
    options: mapOptions(row.options),
    variants: mapVariants(row.variants),
  };
}

export async function listWorkspaceProducts(
  storefrontId: string,
  params: {
    search?: string;
    categoryId?: string;
    sort?: 'newest';
    page?: number;
    perPage?: number;
    /**
     * CUST-H4-5 — batched resolution for the Home "Featured" section's real
     * Canvas preview and the picker's own "selected products" chips. Bounded
     * to `MAX_FEATURED_PRODUCTS` (8) by the backend's own validation; passing
     * more fails the request rather than silently truncating it. Omitted
     * entirely by every other caller (search list, category grid, new
     * arrivals), which keeps their existing behavior unchanged.
     */
    ids?: string[];
  } = {},
  signal?: AbortSignal,
): Promise<WorkspaceProductListOutcome> {
  try {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    // CUST-H2-4 — feeds the Category page's real `product_grid` preview
    // region: the same authoritative category-membership + eligibility gate
    // the public Commerce API already applies (`category_id` on this exact
    // route), never a client-side filter over a fetched list.
    if (params.categoryId) query.set('category_id', params.categoryId);
    // CUST-H4-3 — feeds the Home "New Arrivals" section's real Canvas
    // preview with the same recency order Published already uses
    // (`-available_on` → `created_at` desc). Omitted entirely by every other
    // caller, which keeps the default alphabetical order unchanged.
    if (params.sort) query.set('sort', params.sort);
    if (params.page) query.set('page', String(params.page));
    if (params.perPage) query.set('per_page', String(params.perPage));
    for (const id of params.ids ?? []) query.append('ids[]', id);
    const qs = query.toString();
    const path = qs ? `${commerceWorkspaceProductsPath(storefrontId)}?${qs}` : commerceWorkspaceProductsPath(storefrontId);
    const payload = await api<unknown>(path, { signal });
    if (!payload || typeof payload !== 'object') {
      return { ok: false, reason: 'failed', message: 'invalid_payload' };
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    const rows: WorkspaceProductSummary[] = [];
    for (const row of data) {
      const summary = mapSummary(row);
      if (summary === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
      rows.push(summary);
    }
    const meta = (payload as { meta?: { pagination?: { has_more?: unknown } } }).meta;
    const hasMore = meta?.pagination?.has_more === true;
    return { ok: true, data: rows, hasMore };
  } catch (error) {
    return { ok: false, reason: classifyReadFailure(error), message: errorMessage(error, 'list_failed') };
  }
}

export async function showWorkspaceProduct(
  storefrontId: string,
  productId: string,
  signal?: AbortSignal,
): Promise<WorkspaceProductReadOutcome> {
  try {
    const payload = await api<unknown>(commerceWorkspaceProductPath(storefrontId, productId), { signal });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyReadFailure(error), message: errorMessage(error, 'load_failed') };
  }
}
