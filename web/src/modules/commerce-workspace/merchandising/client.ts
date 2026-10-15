/**
 * FLOWERS-H2 / ADR-14 — عميل إدارة التسويق: الأبعاد الوصفية (Facets) وقيمها،
 * والمجموعات اليدوية، وإسناد قيم الأبعاد للمنتجات. نفس اتفاقية بقية
 * `commerce-workspace`: لا `tenant_id` في أي طلب (المستأجر من الجلسة)، و`{id}`
 * محدِّد صفّ فقط، والخادم هو سلطة الملكية والتحقق. كل دالة كتابية تعيد
 * `{ ok: false, conflict }` بدل الرمي حتى تعرض الواجهة سبباً مفهوماً (409/422).
 */

import { ApiError, api } from '@/lib/api';
import {
  normalizeFacetValueVisual,
  normalizeFacetVisual,
  type FacetValueVisual,
  type FacetVisual,
} from '@/modules/store-experience-builder/presentation/facet-visual';

export const FACETS_PATH = '/commerce/workspace/facets';
export const COLLECTIONS_PATH = '/commerce/workspace/collections';
export const SYSTEM_FACET_KEYS = ['occasion', 'recipient'] as const;
export type SystemFacetKey = (typeof SYSTEM_FACET_KEYS)[number];
export const COLLECTION_STATUSES = ['draft', 'active'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

/**
 * AWJ-VD-H1 / VD-3 — short-lived signed thumbnails the list endpoint attaches to an identity that carries an image
 * (variants only, never the original). They let a role without `commerce.manage` preview identities without reading
 * the media library.
 */
export type FacetVisualPreview = { thumb160: string | null; thumb320: string | null };

export type FacetValue = {
  id: string;
  slug: string;
  name: string;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  /** The stored identity document, normalised (`null` = no identity; an emptied document reads as `null` too). */
  visual: FacetValueVisual | null;
  /** The optimistic-concurrency token: `null` = no row yet, a number = send it back as `expected_version`. */
  visualVersion: number | null;
  visualPreview: FacetVisualPreview | null;
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
  /** `{self?, defaults?}` — the dimension's own appearance and what its values inherit. */
  visual: FacetVisual | null;
  visualVersion: number | null;
  visualPreview: FacetVisualPreview | null;
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

/** An emptied document (nothing customised) is "no identity", exactly as the server's list reports it. */
function orNull<T extends object>(doc: T): T | null {
  return Object.keys(doc).length > 0 ? doc : null;
}

function mapVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function mapPreview(raw: unknown): FacetVisualPreview | null {
  const row = obj(raw);
  if (!row) return null;
  const preview = { thumb160: str(row.thumb_160), thumb320: str(row.thumb_320) };
  return preview.thumb160 || preview.thumb320 ? preview : null;
}

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
    visual: obj(row.visual) ? orNull(normalizeFacetValueVisual(row.visual)) : null,
    visualVersion: mapVersion(row.visual_version),
    visualPreview: mapPreview(row.visual_preview),
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
    visual: obj(row.visual) ? orNull(normalizeFacetVisual(row.visual)) : null,
    visualVersion: mapVersion(row.visual_version),
    visualPreview: mapPreview(row.visual_preview),
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

// ── الهوية المرئية (VD-1b) ─────────────────────────────────────────────

/**
 * Outcome of a visual-identity write. The server's refusals carry a stable `code` the editor translates:
 * 409 `visual_version_conflict` (with `current_version`), 428 `visual_precondition_required`, and 422
 * `visual_invalid` with field errors keyed `visual.<path>` (e.g. `visual.image.mediaId` → `media_not_ready`).
 */
export type VisualWriteResult =
  | { ok: true; visual: unknown; version: number }
  | {
      ok: false;
      status: number | null;
      code: string | null;
      message: string | null;
      currentVersion: number | null;
      errors: Record<string, string[]>;
    };

function visualFailure(error: unknown): Extract<VisualWriteResult, { ok: false }> {
  const none = { status: null, code: null, message: null, currentVersion: null, errors: {} };
  if (!(error instanceof ApiError)) return { ok: false, ...none };
  const body = obj(error.body) ?? {};
  const errors: Record<string, string[]> = {};
  for (const [field, codes] of Object.entries(obj(body.errors) ?? {})) {
    const list = (Array.isArray(codes) ? codes : []).filter((c): c is string => typeof c === 'string');
    if (list.length > 0) errors[field] = list;
  }
  return {
    ok: false,
    status: error.status,
    code: str(body.code),
    message: error.message || null,
    currentVersion: mapVersion(body.current_version),
    errors,
  };
}

async function putVisual(path: string, visual: object | null, expectedVersion: number | null): Promise<VisualWriteResult> {
  // The token is a JSON integer or null — never a string, float or boolean (the API refuses those with a 422).
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    return { ok: false, status: null, code: 'invalid_expected_version', message: null, currentVersion: null, errors: {} };
  }
  try {
    const data = dataOf(await api<unknown>(path, { method: 'PUT', body: { visual, expected_version: expectedVersion } }));
    const version = mapVersion(data?.version);
    if (version === null) return { ok: false, status: null, code: null, message: null, currentVersion: null, errors: {} };
    return { ok: true, visual: data?.visual ?? null, version };
  } catch (error) {
    return visualFailure(error);
  }
}

/** Writes a dimension's `{self, defaults}` document. `visual: null` empties it (the row is kept — a tombstone). */
export function saveFacetVisual(facetId: string, visual: FacetVisual | null, expectedVersion: number | null): Promise<VisualWriteResult> {
  return putVisual(`${FACETS_PATH}/${facetId}/visual`, visual, expectedVersion);
}

/** Writes a value's document. Same contract as {@link saveFacetVisual}. */
export function saveFacetValueVisual(
  facetId: string,
  valueId: string,
  visual: FacetValueVisual | null,
  expectedVersion: number | null,
): Promise<VisualWriteResult> {
  return putVisual(`${FACETS_PATH}/${facetId}/values/${valueId}/visual`, visual, expectedVersion);
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
