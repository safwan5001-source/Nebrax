import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
  };
});

import {
  commerceStorefrontPresentationPath,
  commerceStorefrontPresentationPublishPath,
  loadStorefrontPresentation,
  mapPresentationRecord,
  publishStorefrontPresentation,
  saveStorefrontPresentation,
} from './presentation';

afterEach(() => apiMock.mockReset());

const DRAFT = {
  version: 1,
  themePreset: 'navy',
  primaryColor: '#1e3a5f',
  homepage: { heroHeadline: 'مرحبا' },
};

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      storefront_id: 'store-1',
      schema_version: 1,
      draft: DRAFT,
      draft_revision: 1,
      published: null,
      published_revision: null,
      published_at: null,
      ...overrides,
    },
  };
}

describe('commerce workspace presentation API client', () => {
  it('uses workspace paths and never the public storefront API', () => {
    expect(commerceStorefrontPresentationPath('store-1')).toBe(
      '/commerce/workspace/storefronts/store-1/presentation',
    );
    expect(commerceStorefrontPresentationPublishPath('store-1')).toBe(
      '/commerce/workspace/storefronts/store-1/presentation/publish',
    );
    expect(commerceStorefrontPresentationPath('store-1')).not.toContain('store/v1');
    expect(commerceStorefrontPresentationPath('store-1')).not.toContain('tenant');
  });

  it('loads a draft without sending a tenant identifier', async () => {
    apiMock.mockResolvedValue(envelope());

    const result = await loadStorefrontPresentation('store-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.storefrontId).toBe('store-1');
      expect(result.data.draftRevision).toBe(1);
      expect(result.data.draft.themePreset).toBe('navy');
    }
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation');
    expect(JSON.stringify(apiMock.mock.calls[0])).not.toContain('tenant_id');
  });

  it('saves with config and draft_revision only', async () => {
    apiMock.mockResolvedValue(envelope({ draft_revision: 2 }));

    const result = await saveStorefrontPresentation('store-1', DRAFT as never, 1);

    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation', {
      method: 'PUT',
      body: { config: DRAFT, draft_revision: 1 },
    });
    const body = apiMock.mock.calls[0][1].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['config', 'draft_revision']);
  });

  it('maps a stale revision to conflict so the editor can re-GET', async () => {
    apiMock.mockRejectedValue(new ApiError(409, 'المسودة تغيّرت. أعد التحميل ثم احفظ من جديد.', {}));

    const result = await saveStorefrontPresentation('store-1', DRAFT as never, 0);

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      message: 'المسودة تغيّرت. أعد التحميل ثم احفظ من جديد.',
    });
  });

  it('publishes the current draft revision', async () => {
    apiMock.mockResolvedValue(
      envelope({
        published: DRAFT,
        published_revision: 1,
        published_at: '2026-09-19T00:00:00.000Z',
      }),
    );

    const result = await publishStorefrontPresentation('store-1', 1);

    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith(
      '/commerce/workspace/storefronts/store-1/presentation/publish',
      { method: 'POST', body: { draft_revision: 1 } },
    );
  });

  it('drops tenant_id from mapped records', () => {
    const mapped = mapPresentationRecord({
      data: {
        storefront_id: 'store-1',
        tenant_id: 'forged',
        draft_revision: 0,
        draft: DRAFT,
      },
    });
    expect(mapped).not.toBeNull();
    expect(mapped).not.toHaveProperty('tenant_id');
    expect(JSON.stringify(mapped)).not.toContain('forged');
  });
});
