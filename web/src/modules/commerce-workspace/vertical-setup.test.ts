import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import {
  SETUP_DESTINATIONS,
  applyStarters,
  loadVerticalSetup,
  mapStarterPreview,
  mapStarterResult,
  mapVerticalSetup,
  previewStarters,
} from './vertical-setup';

afterEach(() => apiMock.mockReset());

const setupPayload = (items: unknown[]) => ({ data: { setup: { vertical: 'flowers_gifts', items } } });

describe('vertical setup mapping', () => {
  it('maps items, defaults unknown state to not configured and drops keyless rows', () => {
    const mapped = mapVerticalSetup(
      setupPayload([
        { key: 'occasions', available: true, state: 'configured', count: 12, manage_in: 'merchandising' },
        { key: 'add_ons', available: true, state: 'weird', count: 'x', manage_in: 5 },
        { available: true },
        'junk',
      ]),
    );
    expect(mapped?.vertical).toBe('flowers_gifts');
    expect(mapped?.items).toEqual([
      { key: 'occasions', available: true, state: 'configured', count: 12, manageIn: 'merchandising' },
      { key: 'add_ons', available: true, state: 'not_configured', count: 0, manageIn: '' },
    ]);
  });

  it('returns null for a malformed payload', () => {
    expect(mapVerticalSetup(null)).toBeNull();
    expect(mapVerticalSetup({ data: {} })).toBeNull();
    expect(mapVerticalSetup({ data: { setup: { vertical: 'x', items: 'no' } } })).toBeNull();
  });

  it('maps a preview and counts only list lengths', () => {
    const preview = mapStarterPreview({
      data: {
        starters: {
          would_create: 3,
          facets: [
            { system_key: 'occasion', facet: 'missing', missing_values: [1, 2, 3], existing_values: [] },
            { system_key: 'recipient', facet: 'blocked', missing_values: [], existing_values: [] },
            { facet: 'existing' },
          ],
        },
      },
    });
    expect(preview).toEqual({
      wouldCreate: 3,
      facets: [
        { systemKey: 'occasion', facet: 'missing', missingCount: 3, existingCount: 0 },
        { systemKey: 'recipient', facet: 'blocked', missingCount: 0, existingCount: 0 },
      ],
    });
  });

  it('reads the apply result and reports blocked facets', () => {
    expect(
      mapStarterResult({
        data: { starters: { created: 4, facets: [{ system_key: 'occasion', facet: 'blocked' }, { system_key: 'recipient', facet: 'existing' }] } },
      }),
    ).toEqual({ created: 4, blockedKeys: ['occasion'] });
    expect(mapStarterResult({ data: { starters: {} } })).toBeNull();
  });
});

describe('vertical setup client', () => {
  it('reads the checklist from the store-scoped path with no tenant identifier', async () => {
    apiMock.mockResolvedValueOnce(setupPayload([{ key: 'occasions', available: true, state: 'configured', count: 1, manage_in: 'merchandising' }]));
    const setup = await loadVerticalSetup('store 1');
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store%201/vertical-setup');
    expect(setup?.items).toHaveLength(1);
  });

  it('returns null when the read fails', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom'));
    expect(await loadVerticalSetup('s')).toBeNull();
  });

  it('previews with GET and applies with POST, never sending a body', async () => {
    apiMock.mockResolvedValueOnce({ data: { starters: { would_create: 0, facets: [] } } });
    expect(await previewStarters('s')).toEqual({ ok: true, data: { wouldCreate: 0, facets: [] } });
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s/vertical-setup/starters');

    apiMock.mockResolvedValueOnce({ data: { starters: { created: 2, facets: [] } } });
    expect(await applyStarters('s')).toEqual({ ok: true, data: { created: 2, blockedKeys: [] } });
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s/vertical-setup/starters', { method: 'POST' });
  });

  it('turns an API error into a result instead of throwing', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'اختر نشاط', null));
    expect(await applyStarters('s')).toEqual({ ok: false, status: 422, message: 'اختر نشاط' });
    apiMock.mockRejectedValueOnce(new Error('network'));
    expect(await previewStarters('s')).toEqual({ ok: false, status: null, message: null });
  });

  it('a malformed success body is a failure, not a silent success', async () => {
    apiMock.mockResolvedValueOnce({ data: {} });
    expect((await applyStarters('s')).ok).toBe(false);
  });
});

describe('setup destinations', () => {
  it('links the settings that have a dashboard screen', () => {
    expect(SETUP_DESTINATIONS.gift_settings).toBe('/commerce/gifting');
    expect(SETUP_DESTINATIONS.delivery_schedule).toBe('/commerce/delivery');
    expect(SETUP_DESTINATIONS.merchandising).toBe('/commerce/merchandising');
  });
});
