/**
 * CUST-H2-4 — عميل واجهة قراءة تصنيفات مساحة عمل Commerce
 * (`commerce/workspace/storefronts/{id}/categories`). نفس اتفاقية
 * `workspace-products.ts` (CUST-H2-3) حرفياً: `{id}`/`{category}` محدِّدا صفّ
 * فقط، لا `tenant_id` في أي طلب، والمستأجر من الجلسة عبر `SetTenant`. قراءة
 * فقط — لا فعل كتابي هنا إطلاقاً، ولا يُستهلك هذا العميل من خارج المُخصِّص.
 *
 * منتقي "معاينة تصنيف" هو **سياق محرِّر فقط**: لا شيء هنا يُكتَب إلى
 * `pagePresentation`/الحفظ/النشر — راجع `ExperienceBuilder`'s
 * `previewCategoryId` state.
 */

import { api, hasApiStatus } from '@/lib/api';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export function commerceWorkspaceCategoriesPath(storefrontId: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${storefrontId}/categories`;
}

export function commerceWorkspaceCategoryPath(storefrontId: string, categoryId: string): string {
  return `${commerceWorkspaceCategoriesPath(storefrontId)}/${categoryId}`;
}

export interface WorkspaceCategorySummary {
  id: string;
  name: string;
  parentId: string | null;
  /** Breadcrumb/disambiguation hint only — never shown as a primary label. */
  parentName: string | null;
}

export interface WorkspaceCategoryAncestor {
  id: string;
  name: string;
}

export interface WorkspaceCategoryChild {
  id: string;
  name: string;
}

export interface WorkspaceCategoryDetail {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  children: WorkspaceCategoryChild[];
  ancestors: WorkspaceCategoryAncestor[];
}

interface Failure<Reason extends string> {
  ok: false;
  reason: Reason;
  message: string;
}

export type WorkspaceCategoryListOutcome =
  | { ok: true; data: WorkspaceCategorySummary[]; hasMore: boolean }
  | Failure<'forbidden' | 'not_found' | 'failed'>;

export type WorkspaceCategoryReadOutcome =
  | { ok: true; data: WorkspaceCategoryDetail }
  | Failure<'forbidden' | 'not_found' | 'failed'>;

function classifyReadFailure(error: unknown): 'forbidden' | 'not_found' | 'failed' {
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  return 'failed';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mapSummary(row: unknown): WorkspaceCategorySummary | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') return null;
  if (typeof record.name !== 'string') return null;
  return {
    id: record.id,
    name: record.name,
    parentId: typeof record.parent_id === 'string' ? record.parent_id : null,
    parentName: typeof record.parent_name === 'string' ? record.parent_name : null,
  };
}

function mapAncestors(raw: unknown): WorkspaceCategoryAncestor[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceCategoryAncestor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    out.push({ id: row.id, name: row.name });
  }
  return out;
}

function mapChildren(raw: unknown): WorkspaceCategoryChild[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceCategoryChild[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    out.push({ id: row.id, name: row.name });
  }
  return out;
}

function mapDetail(payload: unknown): WorkspaceCategoryDetail | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (typeof row.name !== 'string') return null;

  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
    children: mapChildren(row.children),
    ancestors: mapAncestors(row.ancestors),
  };
}

export async function listWorkspaceCategories(
  storefrontId: string,
  params: { search?: string; page?: number; perPage?: number } = {},
  signal?: AbortSignal,
): Promise<WorkspaceCategoryListOutcome> {
  try {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.perPage) query.set('per_page', String(params.perPage));
    const qs = query.toString();
    const path = qs ? `${commerceWorkspaceCategoriesPath(storefrontId)}?${qs}` : commerceWorkspaceCategoriesPath(storefrontId);
    const payload = await api<unknown>(path, { signal });
    if (!payload || typeof payload !== 'object') {
      return { ok: false, reason: 'failed', message: 'invalid_payload' };
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    const rows: WorkspaceCategorySummary[] = [];
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

export async function showWorkspaceCategory(
  storefrontId: string,
  categoryId: string,
  signal?: AbortSignal,
): Promise<WorkspaceCategoryReadOutcome> {
  try {
    const payload = await api<unknown>(commerceWorkspaceCategoryPath(storefrontId, categoryId), { signal });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyReadFailure(error), message: errorMessage(error, 'load_failed') };
  }
}
