import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fulfillOrder, toLatinDigits, updateFulfillmentDetails, validateDetails, validateFailure } from './fulfill-order';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a) }));

describe('fulfill-order.ts (COPS-H2-3 writes)', () => {
  beforeEach(() => apiMock.mockReset().mockResolvedValue({ data: { id: 'o1' } }));

  it('POSTs the action with the displayed expected_version and drops blank fields', async () => {
    await fulfillOrder('o 1', 'dispatch', 3, { carrier_name: ' سمسا ', tracking_number: '', tracking_url: '  ', courier_phone: '٠٥٠٠٠٠٠٠٠٠' });
    const [path, options] = apiMock.mock.calls[0];
    expect(path).toMatch(/\/o%201\/fulfillment\/dispatch$/);
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ expected_version: 3, carrier_name: 'سمسا', courier_phone: '٠٥٠٠٠٠٠٠٠٠' });
  });

  it('sends version 0 for the first action and the failure reason/note', async () => {
    await fulfillOrder('o1', 'start', 0);
    expect(apiMock.mock.calls[0][1].body).toEqual({ expected_version: 0 });
    await fulfillOrder('o1', 'fail', 4, { reason: 'address_issue', note: ' ملاحظة ' });
    expect(apiMock.mock.calls[1][1].body).toEqual({ expected_version: 4, reason: 'address_issue', note: 'ملاحظة' });
  });

  it('PATCHes details and keeps an explicit empty string (a deliberate clear) as an empty value', async () => {
    await updateFulfillmentDetails('o1', 2, { carrier_name: '', tracking_number: 'T-2', type: 'carrier' });
    const [path, options] = apiMock.mock.calls[0];
    expect(path).toMatch(/\/o1\/fulfillment$/);
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({ expected_version: 2, carrier_name: '', tracking_number: 'T-2', type: 'carrier' });
  });

  it('validates like the server: reason list, note length, https url, phone digits, field length', () => {
    expect(validateFailure('', '')).toBe('reason_required');
    expect(validateFailure('bogus', '')).toBe('reason_required');
    expect(validateFailure('other', 'x'.repeat(501))).toBe('note_too_long');
    expect(validateFailure('other', 'x'.repeat(500))).toBeNull();
    expect(validateDetails({ tracking_url: 'http://x.test' })).toBe('url_invalid');
    expect(validateDetails({ tracking_url: 'https://x.test/a b' })).toBe('url_invalid');
    expect(validateDetails({ tracking_url: 'HTTPS://X.test/track' })).toBeNull();
    expect(validateDetails({ courier_phone: '12ab' })).toBe('phone_invalid');
    expect(validateDetails({ courier_phone: '٠٥٠٠٠٠٠٠٠٠' })).toBeNull();
    expect(validateDetails({ carrier_name: 'x'.repeat(101) })).toBe('field_too_long');
    expect(validateDetails({})).toBeNull();
  });

  it('normalizes Arabic-Indic and Persian digits to Latin', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹')).toBe('01234567890123456789');
  });
});
