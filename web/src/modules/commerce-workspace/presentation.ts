/**
 * STORE-BACKEND-1 — مسودة مظهر المتجر ونشرها.
 *
 * `{id}` محدِّد صفّ فقط. المستأجر من الجلسة (SetTenant). لا `tenant_id`
 * ولا `published_config` ولا `is_verified` في الطلب. المسار مساحة عمل
 * التجارة، لا `store/v1`. المسودة سرّية — لا تُجلب للمتجر العام.
 */

import { api, hasApiStatus } from '@/lib/api';
import {
  normalizePresentationConfig,
  type StorefrontPresentationConfig,
} from '@/modules/store-experience-builder/presentation';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export function commerceStorefrontPresentationPath(id: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${id}/presentation`;
}

export function commerceStorefrontPresentationPublishPath(id: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${id}/presentation/publish`;
}

export type StorefrontPresentationRecord = {
  storefrontId: string;
  schemaVersion: number;
  draft: StorefrontPresentationConfig;
  draftRevision: number;
  published: StorefrontPresentationConfig | null;
  publishedRevision: number | null;
  publishedAt: string | null;
};

export type PresentationOutcome =
  | { ok: true; data: StorefrontPresentationRecord }
  | {
      ok: false;
      reason: 'conflict' | 'not_found' | 'forbidden' | 'validation' | 'failed';
      message: string;
    };

export async function loadStorefrontPresentation(
  storefrontId: string,
): Promise<PresentationOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationPath(storefrontId));
    const data = mapPresentationRecord(payload);
    if (!data) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyPresentationFailure(error), message: errorMessage(error, 'load_failed') };
  }
}

export async function saveStorefrontPresentation(
  storefrontId: string,
  config: StorefrontPresentationConfig,
  draftRevision: number,
): Promise<PresentationOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationPath(storefrontId), {
      method: 'PUT',
      body: { config, draft_revision: draftRevision },
    });
    const data = mapPresentationRecord(payload);
    if (!data) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyPresentationFailure(error), message: errorMessage(error, 'save_failed') };
  }
}

export async function publishStorefrontPresentation(
  storefrontId: string,
  draftRevision: number,
): Promise<PresentationOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationPublishPath(storefrontId), {
      method: 'POST',
      body: { draft_revision: draftRevision },
    });
    const data = mapPresentationRecord(payload);
    if (!data) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyPresentationFailure(error), message: errorMessage(error, 'publish_failed') };
  }
}

export function mapPresentationRecord(payload: unknown): StorefrontPresentationRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.storefront_id !== 'string' || row.storefront_id === '') return null;
  if (typeof row.draft_revision !== 'number' || !Number.isFinite(row.draft_revision)) return null;

  return {
    storefrontId: row.storefront_id,
    schemaVersion: typeof row.schema_version === 'number' ? row.schema_version : 1,
    draft: normalizePresentationConfig(row.draft),
    draftRevision: row.draft_revision,
    published: row.published == null ? null : normalizePresentationConfig(row.published),
    publishedRevision: typeof row.published_revision === 'number' ? row.published_revision : null,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
  };
}

function classifyPresentationFailure(
  error: unknown,
): 'conflict' | 'not_found' | 'forbidden' | 'validation' | 'failed' {
  if (hasApiStatus(error, 409)) return 'conflict';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'validation';
  return 'failed';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
