import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')), api }));

import { AI_ACTION_STATUSES, aiActionHref, aiActionsPath, fetchAiActions } from './ai-actions-history';

beforeEach(() => api.mockReset());

describe('ai-actions-history contract (IMP-H8-S4b)', () => {
  it('builds only the allow-listed query and never a scope parameter', () => {
    expect(aiActionsPath({ page: 2, perPage: 25 })).toBe('/ai-actions?page=2&per_page=25');
    expect(aiActionsPath({ page: 1, perPage: 10, status: 'failed', mine: true })).toBe('/ai-actions?page=1&per_page=10&status=failed&mine=1');
    expect(aiActionsPath({ page: 1, perPage: 10, mine: false })).not.toContain('mine');
    expect(aiActionsPath({ page: 1, perPage: 10, status: 'executed' })).not.toMatch(/tenant|created_by|branch/);
  });

  it('lists exactly the server statuses', () => {
    expect(AI_ACTION_STATUSES).toEqual([
      'created', 'editing', 'ready_for_approval', 'approved', 'expired', 'executing', 'executed', 'partially_failed', 'failed', 'cancelled',
    ]);
  });

  it('links only types with a known screen and encodes the id', () => {
    expect(aiActionHref('product_import.v1', 'a b')).toBe('/products/ai-import?action=a%20b');
    expect(aiActionHref('future_type.v1', 'x')).toBeNull();
  });

  it('turns a 403 into "unavailable" (not an error) and rethrows anything else', async () => {
    api.mockRejectedValueOnce(new ApiError(403, 'no', { error: { code: 'tenant_not_enabled' } }));
    expect(await fetchAiActions({ page: 1, perPage: 10 })).toEqual({ availability: 'unavailable', page: null });

    api.mockRejectedValueOnce(new ApiError(500, 'boom', null));
    await expect(fetchAiActions({ page: 1, perPage: 10 })).rejects.toBeInstanceOf(ApiError);

    api.mockRejectedValueOnce(new ApiError(422, 'bad', null));
    await expect(fetchAiActions({ page: 1, perPage: 10 })).rejects.toBeInstanceOf(ApiError);
  });
});
