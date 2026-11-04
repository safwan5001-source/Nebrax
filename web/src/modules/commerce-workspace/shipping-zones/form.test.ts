import { describe, expect, it } from 'vitest';
import { EMPTY_ZONE_FORM, MAX_RATE_MINOR, validateZoneForm, type ZoneFormValues } from './form';

const valid = (over: Partial<ZoneFormValues> = {}): ZoneFormValues => ({ ...EMPTY_ZONE_FORM, name: 'الدمام', matchValue: 'الدمام', rate: '15', ...over });
const payloadOf = (values: ZoneFormValues) => {
  const r = validateZoneForm(values);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r.payload;
};
const errorsOf = (values: ZoneFormValues) => {
  const r = validateZoneForm(values);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('validateZoneForm (COPS-H4-2)', () => {
  it('converts SAR to integer halalas and sends exactly the contract keys', () => {
    expect(payloadOf(valid({ rate: '15' }))).toEqual({ name: 'الدمام', match_type: 'city', match_value: 'الدمام', rate_amount_minor: 1500, is_active: true });
    expect(Object.keys(payloadOf(valid())).sort()).toEqual(['is_active', 'match_type', 'match_value', 'name', 'rate_amount_minor']);
  });

  it.each([
    ['0', 0],
    ['0.01', 1],
    ['0.1', 10],
    ['12.50', 1250],
    ['1,500', 150000],
    ['٢٥٫٥٠', 2550],
    ['999999999.99', 99999999999],
  ])('rate %s SAR → %s halalas, always an integer', (rate, minor) => {
    const p = payloadOf(valid({ rate }));
    expect(p.rate_amount_minor).toBe(minor);
    expect(Number.isInteger(p.rate_amount_minor)).toBe(true);
  });

  it('is exact for classic binary-float traps', () => {
    expect(payloadOf(valid({ rate: '0.07' })).rate_amount_minor).toBe(7);
    expect(payloadOf(valid({ rate: '1.15' })).rate_amount_minor).toBe(115);
    expect(payloadOf(valid({ rate: '19.99' })).rate_amount_minor).toBe(1999);
  });

  it.each(['', '  ', '-1', '-0.01', 'abc', '1.234', '1e3', '12..5', '1,2,3.0.1'])('rejects the rate %j', (rate) => {
    expect(errorsOf(valid({ rate })).rate).toBe('rateInvalid');
  });

  it('rejects a fee above the server cap (100000000000 halalas) but accepts the cap itself', () => {
    expect(MAX_RATE_MINOR).toBe(100_000_000_000);
    expect(errorsOf(valid({ rate: '1000000000.01' })).rate).toBe('rateTooLarge');
    expect(payloadOf(valid({ rate: '1000000000' })).rate_amount_minor).toBe(MAX_RATE_MINOR);
  });

  it('requires a name and a match value, trims them, and caps both at 255', () => {
    expect(errorsOf(valid({ name: '   ' })).name).toBe('nameRequired');
    expect(errorsOf(valid({ matchValue: '' })).matchValue).toBe('matchValueRequired');
    expect(errorsOf(valid({ name: 'ا'.repeat(256) })).name).toBe('nameTooLong');
    expect(errorsOf(valid({ matchValue: 'ا'.repeat(256) })).matchValue).toBe('matchValueTooLong');
    expect(payloadOf(valid({ name: '  الجبيل  ', matchValue: ' الجبيل ' }))).toMatchObject({ name: 'الجبيل', match_value: 'الجبيل' });
    expect(payloadOf(valid({ name: 'ا'.repeat(255) })).name.length).toBe(255);
  });

  it('keeps match type and active flag', () => {
    expect(payloadOf(valid({ matchType: 'region', isActive: false }))).toMatchObject({ match_type: 'region', is_active: false });
  });

  it('reports every invalid field at once', () => {
    expect(Object.keys(errorsOf({ ...EMPTY_ZONE_FORM, rate: 'x' })).sort()).toEqual(['matchValue', 'name', 'rate']);
  });
});
