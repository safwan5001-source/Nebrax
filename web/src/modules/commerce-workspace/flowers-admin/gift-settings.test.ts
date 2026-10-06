import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import {
  GIFT_MESSAGE_MAX_CEILING,
  giftPoliciesEqual,
  loadGiftPolicy,
  mapGiftPolicy,
  parseMessageLength,
  saveGiftPolicy,
} from './gift-settings';

afterEach(() => apiMock.mockReset());

const body = (over: Record<string, unknown> = {}) => ({
  data: { gift_settings: { enabled: true, message_max_length: 180, allow_hide_sender: false, recipient_phone_required: true, ...over } },
});

describe('gift settings client', () => {
  it('maps the server contract to the merchant model', () => {
    expect(mapGiftPolicy(body())).toEqual({ enabled: true, messageMaxLength: 180, allowHideSender: false, recipientPhoneRequired: true });
  });

  it('falls back to the documented defaults for missing optional fields and rejects a malformed body', () => {
    expect(mapGiftPolicy({ data: { gift_settings: { enabled: false } } })).toEqual({
      enabled: false,
      messageMaxLength: 250,
      allowHideSender: true,
      recipientPhoneRequired: true,
    });
    expect(mapGiftPolicy({ data: {} })).toBeNull();
    expect(mapGiftPolicy(null)).toBeNull();
  });

  it('accepts only whole numbers from 1 to the server ceiling', () => {
    expect(parseMessageLength('1')).toBe(1);
    expect(parseMessageLength(` ${GIFT_MESSAGE_MAX_CEILING} `)).toBe(GIFT_MESSAGE_MAX_CEILING);
    for (const bad of ['', '0', '501', '-5', '12.5', '1e2', 'abc', '١٢']) expect(parseMessageLength(bad), bad).toBeNull();
  });

  it('compares policies field by field', () => {
    const a = mapGiftPolicy(body())!;
    expect(giftPoliciesEqual(a, { ...a })).toBe(true);
    expect(giftPoliciesEqual(a, { ...a, enabled: false })).toBe(false);
    expect(giftPoliciesEqual(a, { ...a, messageMaxLength: 181 })).toBe(false);
  });

  it('reads from the store-scoped path and never sends a tenant or channel identifier', async () => {
    apiMock.mockResolvedValueOnce(body());
    const result = await loadGiftPolicy('store/1');
    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store%2F1/gift-settings');
  });

  it('writes all four fields with the API field names', async () => {
    apiMock.mockResolvedValueOnce(body({ enabled: false }));
    await saveGiftPolicy('s1', { enabled: false, messageMaxLength: 100, allowHideSender: true, recipientPhoneRequired: false });
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/gift-settings', {
      method: 'PUT',
      body: { is_enabled: false, message_max_length: 100, allow_hide_sender: true, recipient_phone_required: false },
    });
  });

  it('classifies failures instead of throwing', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(403, 'no', {}));
    expect(await loadGiftPolicy('s')).toMatchObject({ ok: false, kind: 'forbidden', message: null });
    apiMock.mockRejectedValueOnce(new ApiError(404, 'no', {}));
    expect(await loadGiftPolicy('s')).toMatchObject({ ok: false, kind: 'not_found' });
    apiMock.mockRejectedValueOnce(new ApiError(422, 'الطول غير صالح', { errors: { message_max_length: ['x'] } }));
    expect(await saveGiftPolicy('s', mapGiftPolicy(body())!)).toMatchObject({
      ok: false,
      kind: 'invalid',
      message: 'الطول غير صالح',
      fieldErrors: { message_max_length: ['x'] },
    });
    apiMock.mockRejectedValueOnce(new Error('network'));
    expect(await loadGiftPolicy('s')).toMatchObject({ ok: false, kind: 'unavailable' });
    apiMock.mockResolvedValueOnce({ data: {} });
    expect(await loadGiftPolicy('s')).toMatchObject({ ok: false, kind: 'unavailable' });
  });
});
