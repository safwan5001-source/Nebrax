import { api, hasApiStatus } from '@/lib/api';
import { normalizePresentationConfig, type StorefrontPresentationConfig } from '@/modules/store-experience-builder/presentation';
import { commerceStorefrontPresentationPath } from './presentation';

export function commerceStorefrontPresentationVersionsPath(storefrontId: string): string {
  return `${commerceStorefrontPresentationPath(storefrontId)}/versions`;
}

export function commerceStorefrontPresentationVersionPath(storefrontId: string, versionId: string): string {
  return `${commerceStorefrontPresentationVersionsPath(storefrontId)}/${versionId}`;
}

export type StorefrontPresentationVersionRecord = {
  id: string;
  storefrontId: string;
  name: string;
  state: 'draft' | 'published' | 'scheduled';
  schemaVersion: number;
  revision: number;
  config: StorefrontPresentationConfig;
};

export type PresentationVersionOutcome =
  | { ok: true; data: StorefrontPresentationVersionRecord }
  | { ok: false; reason: 'conflict' | 'not_found' | 'forbidden' | 'validation' | 'failed'; message: string };

export async function createStorefrontPresentationVersion(
  storefrontId: string,
  name: string,
): Promise<PresentationVersionOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionsPath(storefrontId), {
      method: 'POST',
      body: { name },
    });
    return mapOutcome(payload);
  } catch (error) {
    return failure(error, 'create_failed');
  }
}

export async function loadStorefrontPresentationVersion(
  storefrontId: string,
  versionId: string,
): Promise<PresentationVersionOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionPath(storefrontId, versionId));
    return mapOutcome(payload);
  } catch (error) {
    return failure(error, 'load_failed');
  }
}

export async function saveStorefrontPresentationVersion(
  storefrontId: string,
  versionId: string,
  config: StorefrontPresentationConfig,
  revision: number,
): Promise<PresentationVersionOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionPath(storefrontId, versionId), {
      method: 'PUT',
      body: { config, revision },
    });
    return mapOutcome(payload);
  } catch (error) {
    return failure(error, 'save_failed');
  }
}

function mapOutcome(payload: unknown): PresentationVersionOutcome {
  const data = mapVersionRecord(payload);
  return data ? { ok: true, data } : { ok: false, reason: 'failed', message: 'invalid_payload' };
}

export function mapVersionRecord(payload: unknown): StorefrontPresentationVersionRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (typeof row.storefront_id !== 'string' || row.storefront_id === '') return null;
  if (typeof row.name !== 'string') return null;
  if (row.state !== 'draft' && row.state !== 'published' && row.state !== 'scheduled') return null;
  if (typeof row.revision !== 'number' || !Number.isFinite(row.revision)) return null;
  if (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)) return null;

  return {
    id: row.id,
    storefrontId: row.storefront_id,
    name: row.name,
    state: row.state,
    schemaVersion: typeof row.schema_version === 'number' ? row.schema_version : 1,
    revision: row.revision,
    config: normalizePresentationConfig(row.config),
  };
}

function failure(error: unknown, fallback: string): PresentationVersionOutcome {
  let reason: PresentationVersionOutcome extends { ok: false; reason: infer R } ? R : never = 'failed';
  if (hasApiStatus(error, 409)) reason = 'conflict';
  else if (hasApiStatus(error, 403)) reason = 'forbidden';
  else if (hasApiStatus(error, 404)) reason = 'not_found';
  else if (hasApiStatus(error, 422)) reason = 'validation';

  return {
    ok: false,
    reason,
    message: error instanceof Error && error.message ? error.message : fallback,
  };
}
