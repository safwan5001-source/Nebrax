/**
 * FLOWERS-H2 / ADR-14 — عميل إدارة التسويق: الأبعاد الوصفية (Facets) وقيمها،
 * والمجموعات اليدوية، وإسناد قيم الأبعاد للمنتجات. نفس اتفاقية بقية
 * `commerce-workspace`: لا `tenant_id` في أي طلب (المستأجر من الجلسة)، و`{id}`
 * محدِّد صفّ فقط، والخادم هو سلطة الملكية والتحقق. كل دالة كتابية تعيد
 * `{ ok: false, conflict }` بدل الرمي حتى تعرض الواجهة سبباً مفهوماً (409/422).
 */

import { ApiError, api } from '@/lib/api';

export const FACETS_PATH = '/commerce/workspace/facets';
export const COLLECTIONS_PATH = '/commerce/workspace/collections';
export const SYSTEM_FACET_KEYS = ['occasion', 'recipient'] as const;
export type SystemFacetKey = (typeof SYSTEM_FACET_KEYS)[number];
export const COLLECTION_STATUSES = ['draft', 'active'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export type FacetValue = {
  id: string;
  slug: string;
  name: string;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

export type Facet = {
  id: string;
  key: string;
  systemKey: SystemFacetKey | null;
  name: string;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  values: FacetValue[];
};

export type Collection = {
  id: string;
  slug: string;
  title: string;
  titleEn: string | null;
  description: string | null;
  status: CollectionStatus;
  sortOrder: number;
  memberCount: number;
};

export type CollectionMember = {
  productId: string;
  name: string;
  nameEn: string | null;
  sku: string | null;
  isActive: boolean;
  position: number;
};

export type WriteResult<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string | null };

const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function mapValue(raw: unknown): FacetValue | null {
  const row = obj(raw);
  if (!row || !str(row.id) || !str(row.slug) || !str(row.name)) return null;
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    nameEn: str(row.name_en),
    sortOrder: num(row.sort_order),
    isActive: row.is_active === true,
    productCount: num(row.product_count),
  };
}

export function mapFacet(raw: unknown): Facet | null {
  const row = obj(raw);
  if (!row || !str(row.id) || !str(row.key) || !str(row.name)) return null;
  const systemKey = (SYSTEM_FACET_KEYS as readonly unknown[]).includes(row.system_key) ? (row.system_key as SystemFacetKey) : null;
  return {
    id: row.id as string,
    key: row.key as string,
    systemKey,
    name: row.name as string,
    nameEn: str(row.name_en),
    sortOrder: num(row.sort_order),
    isActive: row.is_active === true,
    values: (Array.isArray(row.values) ? row.values : []).map(mapValue).filter((v): v is FacetValue => v !== null),
  };
}

export function mapCollection(raw: unknown): Collection | null {
  const row = obj(raw);
  if (!row || !str(row.id) || !str(row.slug) || !str(row.title)) return null;
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    titleEn: str(row.title_en),
    description: str(row.description),
    status: row.status === 'active' ? 'active' : 'draft',
    sortOrder: num(row.sort_order),
    memberCount: num(row.member_count),
  };
}

function mapMember(raw: unknown): CollectionMember | null {
  const row = obj(raw);
  if (!row || !str(row.product_id) || !str(row.name)) return null;
  return {
    productId: row.product_id as string,
    name: row.name as string,
    nameEn: str(row.name_en),
    sku: str(row.sku),
    isActive: row.is_active === true,
    position: num(row.position),
  };
}

function dataOf(payload: unknown): Record<string, unknown> | null {
  return obj(obj(payload)?.data);
}

async function write<T>(run: () => Promise<T>): Promise<WriteResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, status: error.status, message: error.message || null };
    return { ok: false, status: null, message: null };
  }
}

// ── الأبعاد ────────────────────────────────────────────────────────────

export async function loadFacets(): Promise<Facet[] | null> {
  try {
    const list = dataOf(await api<unknown>(FACETS_PATH))?.facets;
    if (!Array.isArray(list)) return null;
    return list.map(mapFacet).filter((f): f is Facet => f !== null);
  } catch {
    return null;
  }
}

export type FacetDraft = { key: string; name: string; nameEn?: string; systemKey?: SystemFacetKey };

export function createFacet(draft: FacetDraft): Promise<WriteResult<Facet | null>> {
  return write(async () =>
    mapFacet(
      dataOf(
        await api<unknown>(FACETS_PATH, {
          method: 'POST',
          body: {
            key: draft.key,
            name: draft.name,
            ...(draft.nameEn ? { name_en: draft.nameEn } : {}),
            ...(draft.systemKey ? { system_key: draft.systemKey } : {}),
          },
        }),
      )?.facet,
    ),
  );
}

export function updateFacet(
  id: string,
  patch: { name?: string; nameEn?: string | null; isActive?: boolean; sortOrder?: number },
): Promise<WriteResult<Facet | null>> {
  return write(async () =>
    mapFacet(
      dataOf(
        await api<unknown>(`${FACETS_PATH}/${id}`, {
          method: 'PUT',
          body: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.nameEn !== undefined ? { name_en: patch.nameEn } : {}),
            ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
            ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
          },
        }),
      )?.facet,
    ),
  );
}

export function deleteFacet(id: string): Promise<WriteResult<true>> {
  return write(async () => {
    await api<unknown>(`${FACETS_PATH}/${id}`, { method: 'DELETE' });
    return true as const;
  });
}

export function createFacetValue(facetId: string, draft: { name: string; nameEn?: string }): Promise<WriteResult<FacetValue | null>> {
  return write(async () =>
    mapValue(
      dataOf(
        await api<unknown>(`${FACETS_PATH}/${facetId}/values`, {
          method: 'POST',
          body: { name: draft.name, ...(draft.nameEn ? { name_en: draft.nameEn } : {}) },
        }),
      )?.value,
    ),
  );
}

export function updateFacetValue(
  facetId: string,
  valueId: string,
  patch: { name?: string; nameEn?: string | null; isActive?: boolean },
): Promise<WriteResult<FacetValue | null>> {
  return write(async () =>
    mapValue(
      dataOf(
        await api<unknown>(`${FACETS_PATH}/${facetId}/values/${valueId}`, {
          method: 'PUT',
          body: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.nameEn !== undefined ? { name_en: patch.nameEn } : {}),
            ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
          },
        }),
      )?.value,
    ),
  );
}

export function deleteFacetValue(facetId: string, valueId: string): Promise<WriteResult<true>> {
  return write(async () => {
    await api<unknown>(`${FACETS_PATH}/${facetId}/values/${valueId}`, { method: 'DELETE' });
    return true as const;
  });
}

// ── إسناد المنتجات ─────────────────────────────────────────────────────

export const productFacetsPath = (productId: string) =>
  `/commerce/workspace/products/${encodeURIComponent(productId)}/facets`;

export async function loadProductFacetValueIds(productId: string): Promise<string[] | null> {
  try {
    const ids = dataOf(await api<unknown>(productFacetsPath(productId)))?.value_ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

export function replaceProductFacetValueIds(productId: string, valueIds: string[]): Promise<WriteResult<string[]>> {
  return write(async () => {
    const ids = dataOf(await api<unknown>(productFacetsPath(productId), { method: 'PUT', body: { value_ids: valueIds } }))?.value_ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  });
}

// ── المجموعات ──────────────────────────────────────────────────────────

export async function loadCollections(): Promise<Collection[] | null> {
  try {
    const list = dataOf(await api<unknown>(COLLECTIONS_PATH))?.collections;
    if (!Array.isArray(list)) return null;
    return list.map(mapCollection).filter((c): c is Collection => c !== null);
  } catch {
    return null;
  }
}

export type CollectionDraft = { title: string; titleEn?: string; description?: string; status: CollectionStatus };

export function createCollection(draft: CollectionDraft): Promise<WriteResult<Collection | null>> {
  return write(async () =>
    mapCollection(
      dataOf(
        await api<unknown>(COLLECTIONS_PATH, {
          method: 'POST',
          body: {
            title: draft.title,
            status: draft.status,
            ...(draft.titleEn ? { title_en: draft.titleEn } : {}),
            ...(draft.description ? { description: draft.description } : {}),
          },
        }),
      )?.collection,
    ),
  );
}

export function updateCollection(id: string, patch: Partial<CollectionDraft>): Promise<WriteResult<Collection | null>> {
  return write(async () =>
    mapCollection(
      dataOf(
        await api<unknown>(`${COLLECTIONS_PATH}/${id}`, {
          method: 'PUT',
          body: {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.titleEn !== undefined ? { title_en: patch.titleEn || null } : {}),
            ...(patch.description !== undefined ? { description: patch.description || null } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
          },
        }),
      )?.collection,
    ),
  );
}

export function deleteCollection(id: string): Promise<WriteResult<true>> {
  return write(async () => {
    await api<unknown>(`${COLLECTIONS_PATH}/${id}`, { method: 'DELETE' });
    return true as const;
  });
}

export async function loadCollectionMembers(id: string): Promise<CollectionMember[] | null> {
  try {
    const list = dataOf(await api<unknown>(`${COLLECTIONS_PATH}/${id}/products`))?.products;
    return Array.isArray(list) ? list.map(mapMember).filter((m): m is CollectionMember => m !== null) : null;
  } catch {
    return null;
  }
}

export function replaceCollectionMembers(id: string, productIds: string[]): Promise<WriteResult<CollectionMember[]>> {
  return write(async () => {
    const list = dataOf(await api<unknown>(`${COLLECTIONS_PATH}/${id}/products`, { method: 'PUT', body: { product_ids: productIds } }))?.products;
    return Array.isArray(list) ? list.map(mapMember).filter((m): m is CollectionMember => m !== null) : [];
  });
}

/** يبدّل موضعي عنصرين متجاورين (ترتيب أعضاء المجموعة) — نقية لتسهيل الاختبار. */
export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** مفتاح بُعد آمن (ASCII slug) من نص حر؛ فارغ إن لم يكن قابلاً للاشتقاق. */
export function suggestFacetKey(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
