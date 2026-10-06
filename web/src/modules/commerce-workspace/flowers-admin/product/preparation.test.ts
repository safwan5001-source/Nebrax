import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { loadPreparation, mapPreparation, preparationToMinutes, savePreparation, splitPreparation } from './preparation';

afterEach(() => apiMock.mockReset());

describe('product preparation client', () => {
  it('maps minutes, and treats null/absent as no product-specific lead', () => {
    expect(mapPreparation({ data: { preparation_minutes: 180 } })).toEqual({ minutes: 180 });
    expect(mapPreparation({ data: { preparation_minutes: 0 } })).toEqual({ minutes: 0 });
    expect(mapPreparation({ data: { preparation_minutes: null } })).toEqual({ minutes: 0 });
    expect(mapPreparation({ data: { preparation_minutes: 'x' } })).toBeNull();
    expect(mapPreparation(null)).toEqual({ minutes: 0 });
  });

  it('converts input to minutes with the server range (1–43200) and blank/0 = none', () => {
    expect(preparationToMinutes('', 'hours')).toBe(0);
    expect(preparationToMinutes('0', 'days')).toBe(0);
    expect(preparationToMinutes('2', 'hours')).toBe(120);
    expect(preparationToMinutes('30', 'days')).toBe(43200);
    expect(preparationToMinutes('31', 'days')).toBeNull();
    expect(preparationToMinutes('43201', 'minutes')).toBeNull();
    expect(preparationToMinutes('1.5', 'hours')).toBeNull();
    expect(preparationToMinutes('-3', 'hours')).toBeNull();
    expect(preparationToMinutes('abc', 'minutes')).toBeNull();
  });

  it('shows saved minutes in the best unit and round-trips', () => {
    expect(splitPreparation(0)).toEqual({ value: '', unit: 'hours' });
    expect(splitPreparation(45)).toEqual({ value: '45', unit: 'minutes' });
    expect(splitPreparation(180)).toEqual({ value: '3', unit: 'hours' });
    expect(splitPreparation(2880)).toEqual({ value: '2', unit: 'days' });
    for (const m of [1, 45, 60, 90, 1440, 43200]) {
      const { value, unit } = splitPreparation(m);
      expect(preparationToMinutes(value, unit)).toBe(m);
    }
  });

  it('uses the product-scoped path and sends null to remove the lead', async () => {
    apiMock.mockResolvedValue({ data: { preparation_minutes: 120 } });
    await loadPreparation('p/1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/products/p%2F1/preparation');
    await savePreparation('p1', 120);
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/products/p1/preparation', { method: 'PUT', body: { preparation_minutes: 120 } });
    await savePreparation('p1', 0);
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/products/p1/preparation', { method: 'PUT', body: { preparation_minutes: null } });
  });

  it('classifies failures', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(404, 'x', {}));
    expect(await loadPreparation('p1')).toMatchObject({ ok: false, kind: 'not_found' });
    apiMock.mockRejectedValueOnce(new ApiError(422, 'مهلة التجهيز خارج المدى المسموح.', {}));
    expect(await savePreparation('p1', 5)).toMatchObject({ ok: false, kind: 'invalid', message: 'مهلة التجهيز خارج المدى المسموح.' });
  });
});
