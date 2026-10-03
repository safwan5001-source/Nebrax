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
  commerceWorkspaceOffersPath,
  isKnownOfferReason,
  KNOWN_OFFER_REASONS,
  listWorkspaceOffers,
} from './workspace-offers';

afterEach(() => apiMock.mockReset());

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    product_id: 'p1',
    product: { id: 'p1', name: 'هاتف', name_en: 'Phone', thumbnail_url: 'https://cdn.example.test/p1.jpg', is_variant_managed: false },
    starts_at: null,
    ends_at: '2026-12-01T00:00:00+00:00',
    is_active: true,
    position: 0,
    evaluation: {
      is_live: true,
      reason: null,
      reference_price: { amount_minor: 25000, currency: 'SAR' },
      offer_price: { amount_minor: 19000, currency: 'SAR' },
      discount_percent: 24,
    },
    created_at: '2026-10-01T00:00:00+00:00',
    updated_at: '2026-10-01T00:00:00+00:00',
    ...overrides,
  };
}

function hiddenRow(reason: string, overrides: Record<string, unknown> = {}) {
  return liveRow({
    id: `o-${reason}`,
    evaluation: { is_live: false, reason, reference_price: null, offer_price: null, discount_percent: null },
    ...overrides,
  });
}

describe('workspace-offers client — CUST-H4-7', () => {
  it('builds a storefront-scoped path with no tenant id', () => {
    expect(commerceWorkspaceOffersPath('store-1')).toBe('/commerce/workspace/storefronts/store-1/offers');
  });

  it('parses a live offer with both prices and the backend discount_percent untouched', async () => {
    apiMock.mockResolvedValueOnce({ data: [liveRow()], meta: { max_offers: 12 } });
    const outcome = await listWorkspaceOffers('s1');
    expect(outcome).toEqual({
      ok: true,
      maxOffers: 12,
      data: [
        {
          id: 'o1',
          product: { name: 'هاتف', nameEn: 'Phone', thumbnailUrl: 'https://cdn.example.test/p1.jpg' },
          isActive: true,
          startsAt: null,
          endsAt: '2026-12-01T00:00:00+00:00',
          isLive: true,
          reason: null,
          referencePrice: { amountMinor: 25000, currency: 'SAR' },
          offerPrice: { amountMinor: 19000, currency: 'SAR' },
          discountPercent: 24,
        },
      ],
    });
  });

  it('passes a 0% genuine discount through verbatim (no client rounding or hiding)', async () => {
    apiMock.mockResolvedValueOnce({
      data: [
        liveRow({
          evaluation: {
            is_live: true,
            reason: null,
            reference_price: { amount_minor: 25000, currency: 'SAR' },
            offer_price: { amount_minor: 24999, currency: 'SAR' },
            discount_percent: 0,
          },
        }),
      ],
    });
    const outcome = await listWorkspaceOffers('s1');
    expect(outcome.ok && outcome.data[0].discountPercent).toBe(0);
  });

  it.each(KNOWN_OFFER_REASONS)('preserves the backend reason "%s" and exposes no prices for a hidden row', async (reason) => {
    apiMock.mockResolvedValueOnce({ data: [hiddenRow(reason)] });
    const outcome = await listWorkspaceOffers('s1');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data[0]).toMatchObject({
      isLive: false,
      reason,
      referencePrice: null,
      offerPrice: null,
      discountPercent: null,
    });
    expect(isKnownOfferReason(outcome.data[0].reason)).toBe(true);
  });

  it('keeps an unknown future reason as raw text instead of failing or guessing', async () => {
    apiMock.mockResolvedValueOnce({ data: [hiddenRow('brand_new_reason')] });
    const outcome = await listWorkspaceOffers('s1');
    expect(outcome.ok && outcome.data[0].reason).toBe('brand_new_reason');
    expect(isKnownOfferReason('brand_new_reason')).toBe(false);
    expect(isKnownOfferReason(null)).toBe(false);
  });

  it('keeps a row whose product was deleted (product: null) so the editor can say so honestly', async () => {
    apiMock.mockResolvedValueOnce({ data: [hiddenRow('product_unavailable', { product: null })] });
    const outcome = await listWorkspaceOffers('s1');
    expect(outcome.ok && outcome.data[0].product).toBeNull();
  });

  it('drops prices a non-live row might carry — live status is never inferred from them', async () => {
    apiMock.mockResolvedValueOnce({
      data: [
        liveRow({
          evaluation: {
            is_live: false,
            reason: 'expired',
            reference_price: { amount_minor: 25000, currency: 'SAR' },
            offer_price: { amount_minor: 19000, currency: 'SAR' },
            discount_percent: 24,
          },
        }),
      ],
    });
    const outcome = await listWorkspaceOffers('s1');
    expect(outcome.ok && outcome.data[0]).toMatchObject({ isLive: false, offerPrice: null, discountPercent: null });
  });

  it('rejects a live row that lacks the price proof (malformed payload, never patched up)', async () => {
    apiMock.mockResolvedValueOnce({
      data: [liveRow({ evaluation: { is_live: true, reason: null, reference_price: null, offer_price: null, discount_percent: null } })],
    });
    expect(await listWorkspaceOffers('s1')).toMatchObject({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it.each([
    ['non-object payload', 'oops'],
    ['missing data', {}],
    ['non-array data', { data: {} }],
    ['row without id', { data: [liveRow({ id: '' })] }],
    ['row without evaluation', { data: [liveRow({ evaluation: undefined })] }],
    ['row with a non-boolean is_live', { data: [liveRow({ evaluation: { is_live: 'yes' } })] }],
    ['non-object row', { data: ['x'] }],
  ])('treats a %s as an invalid payload', async (_label, payload) => {
    apiMock.mockResolvedValueOnce(payload);
    expect(await listWorkspaceOffers('s1')).toMatchObject({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('returns an empty list for a storefront with no configured offers', async () => {
    apiMock.mockResolvedValueOnce({ data: [], meta: { max_offers: 12 } });
    expect(await listWorkspaceOffers('s1')).toEqual({ ok: true, data: [], maxOffers: 12 });
  });

  it('classifies 403 / 404 / other failures', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(403, 'no', null));
    expect(await listWorkspaceOffers('s1')).toMatchObject({ ok: false, reason: 'forbidden' });
    apiMock.mockRejectedValueOnce(new ApiError(404, 'gone', null));
    expect(await listWorkspaceOffers('s1')).toMatchObject({ ok: false, reason: 'not_found' });
    apiMock.mockRejectedValueOnce(new ApiError(500, 'boom', null));
    expect(await listWorkspaceOffers('s1')).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('forwards the AbortSignal to the transport and reports an abort as a failure', async () => {
    const controller = new AbortController();
    apiMock.mockImplementationOnce((_path: string, init: { signal?: AbortSignal }) => {
      expect(init.signal).toBe(controller.signal);
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    controller.abort();
    expect(await listWorkspaceOffers('s1', controller.signal)).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('issues exactly one GET for the whole list, with no query and no body', async () => {
    apiMock.mockResolvedValueOnce({ data: [liveRow(), hiddenRow('expired')] });
    await listWorkspaceOffers('s1');
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toBe('/commerce/workspace/storefronts/s1/offers');
    expect(Object.keys(apiMock.mock.calls[0][1] as object)).toEqual(['signal']);
  });
});
