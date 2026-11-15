import { describe, expect, it } from 'vitest';
import {
  buildEndPayload, buildLinkPayload, buildOwnerPayload, buildTankerPayload, capacityMilliliters, EMPTY_LINK_FORM, EMPTY_OWNER_FORM, EMPTY_TANKER_FORM,
  hasChanges, linkPhase, localToday, ownerFormFrom, tankerFormFrom, validateEnd, validateLink, validateOwner, validateTanker,
} from './form-logic';
import type { OwnerCompanyLink, Tanker, TankerOwner } from './types';

const owner = (extra: Partial<TankerOwner> = {}): TankerOwner => ({ id: 'o1', code: 'TO-1', name: 'عسكر', status: 'active', phone: '0500000000', notes: 'ملاحظة', created_at: null, ...extra });
const tanker = (extra: Partial<Tanker> = {}): Tanker => ({ id: 't1', fuel_tanker_owner_id: 'o1', plate_number: 'أ ب ج 1234', plate_country: 'SA', capacity_milliliters: 30000000, status: 'active', notes: null, created_at: null, ...extra });

describe('owner form', () => {
  it('requires a name and limits lengths', () => {
    expect(validateOwner(EMPTY_OWNER_FORM)).toEqual({ name: 'required' });
    expect(validateOwner({ ...EMPTY_OWNER_FORM, name: '   ' })).toEqual({ name: 'required' });
    expect(validateOwner({ ...EMPTY_OWNER_FORM, name: 'x'.repeat(256) })).toEqual({ name: 'too_long' });
    expect(validateOwner({ ...EMPTY_OWNER_FORM, name: 'ok', code: 'c'.repeat(65), phone: 'p'.repeat(51), notes: 'n'.repeat(2001), reason: 'r'.repeat(501) }))
      .toEqual({ code: 'too_long', phone: 'too_long', notes: 'too_long', reason: 'too_long' });
    expect(validateOwner({ ...EMPTY_OWNER_FORM, name: 'ok' })).toEqual({});
  });

  it('creates with trimmed values, empty optionals as null, and never carries tenant or partner identifiers', () => {
    const payload = buildOwnerPayload({ ...EMPTY_OWNER_FORM, name: '  عسكر  ', code: ' ', phone: ' 0500 ', reason: '' });
    expect(payload).toEqual({ name: 'عسكر', code: null, phone: '0500', notes: null, status: 'active' });
    expect(Object.keys(payload)).not.toContain('tenant_id');
    expect(Object.keys(payload)).not.toContain('partner_id');
  });

  it('edits send only what changed (+ reason only with a real change)', () => {
    const original = owner();
    expect(buildOwnerPayload(ownerFormFrom(original), original)).toEqual({});
    expect(buildOwnerPayload({ ...ownerFormFrom(original), reason: 'لا تغيير' }, original)).toEqual({});
    expect(buildOwnerPayload({ ...ownerFormFrom(original), status: 'suspended', reason: 'إيقاف' }, original)).toEqual({ status: 'suspended', reason: 'إيقاف' });
    expect(buildOwnerPayload({ ...ownerFormFrom(original), name: 'عسكر الجديد', code: '' }, original)).toEqual({ name: 'عسكر الجديد', code: null });
    expect(hasChanges({ reason: 'x' })).toBe(false);
    expect(hasChanges({ name: 'x' })).toBe(true);
  });

  it('never sends phone or notes for a viewer whose API response omitted them', () => {
    const redacted = owner({ phone: undefined, notes: undefined });
    const form = { ...ownerFormFrom(redacted), phone: 'typed', notes: 'typed', name: 'جديد' };
    expect(buildOwnerPayload(form, redacted)).toEqual({ name: 'جديد' });
  });
});

describe('tanker form', () => {
  it('converts liters to an integer milliliter capacity and rejects fractions finer than a milliliter, zero and junk', () => {
    expect(capacityMilliliters('')).toBeNull();
    expect(capacityMilliliters('30000')).toBe(30000000);
    expect(capacityMilliliters('12.5')).toBe(12500);
    expect(capacityMilliliters('0.001')).toBe(1);
    for (const bad of ['0', '-5', 'abc', '1.0005', '1e3']) expect(capacityMilliliters(bad)).toBeUndefined();
  });

  it('validates plate and capacity', () => {
    expect(validateTanker(EMPTY_TANKER_FORM)).toEqual({ plate: 'required' });
    expect(validateTanker({ ...EMPTY_TANKER_FORM, plate: 'A1', capacityLiters: 'x' })).toEqual({ capacity: 'invalid_capacity' });
    expect(validateTanker({ ...EMPTY_TANKER_FORM, plate: 'p'.repeat(65), country: 'c'.repeat(9) })).toEqual({ plate: 'too_long', country: 'too_long' });
    expect(validateTanker({ ...EMPTY_TANKER_FORM, plate: 'A1', capacityLiters: '1000' })).toEqual({});
  });

  it('creating carries the owner id and integer capacity; editing never carries the owner (it is immutable)', () => {
    expect(buildTankerPayload({ ...EMPTY_TANKER_FORM, plate: ' AB-1 ', capacityLiters: '30000' }, 'o1')).toEqual({
      fuel_tanker_owner_id: 'o1', plate_number: 'AB-1', plate_country: null, capacity_milliliters: 30000000, notes: null, status: 'active',
    });
    const original = tanker();
    expect(buildTankerPayload(tankerFormFrom(original), 'o1', original)).toEqual({});
    const edited = buildTankerPayload({ ...tankerFormFrom(original), capacityLiters: '', status: 'inactive', reason: 'خارج الخدمة' }, 'o1', original);
    expect(edited).toEqual({ capacity_milliliters: null, status: 'inactive', reason: 'خارج الخدمة' });
    expect(edited).not.toHaveProperty('fuel_tanker_owner_id');
  });

  it('round-trips the stored capacity through the liter field without drift', () => {
    expect(tankerFormFrom(tanker({ capacity_milliliters: 12500 })).capacityLiters).toBe('12.5');
    expect(tankerFormFrom(tanker({ capacity_milliliters: null })).capacityLiters).toBe('');
  });
});

describe('company link form', () => {
  it('requires a company, ISO dates, and an end that does not precede the start', () => {
    expect(validateLink(EMPTY_LINK_FORM)).toEqual({ partner: 'required' });
    expect(validateLink({ ...EMPTY_LINK_FORM, partnerId: 'p', validFrom: '01/02/2026' })).toEqual({ validFrom: 'invalid_date' });
    expect(validateLink({ ...EMPTY_LINK_FORM, partnerId: 'p', validFrom: '2026-02-01', validTo: '2026-01-31' })).toEqual({ validTo: 'end_before_start' });
    expect(validateLink({ ...EMPTY_LINK_FORM, partnerId: 'p', validFrom: '2026-02-01', validTo: '2026-02-01' })).toEqual({});
    expect(validateLink({ ...EMPTY_LINK_FORM, partnerId: 'p', validTo: '2026-02-01' })).toEqual({});
  });

  it('omits empty dates so the server applies its own "today" — no client clock in any payload', () => {
    expect(buildLinkPayload({ ...EMPTY_LINK_FORM, partnerId: 'p1' })).toEqual({ partner_id: 'p1' });
    expect(buildLinkPayload({ partnerId: 'p1', validFrom: '2026-01-01', validTo: '2026-12-31', note: ' عقد ' })).toEqual({ partner_id: 'p1', valid_from: '2026-01-01', valid_to: '2026-12-31', note: 'عقد' });
    expect(buildEndPayload('', '')).toEqual({});
    expect(buildEndPayload('2026-03-31', ' انتهى العقد ')).toEqual({ valid_to: '2026-03-31', reason: 'انتهى العقد' });
  });

  it('ending cannot precede the link start', () => {
    expect(validateEnd('2026-01-01', { valid_from: '2026-02-01' }, '')).toEqual({ validTo: 'end_before_start' });
    expect(validateEnd('2026-02-01', { valid_from: '2026-02-01' }, '')).toEqual({});
    expect(validateEnd('', { valid_from: '2026-02-01' }, '')).toEqual({});
    expect(validateEnd('bad', { valid_from: '2026-02-01' }, '')).toEqual({ validTo: 'invalid_date' });
  });

  it('classifies a link as active, scheduled or ended for display', () => {
    const link = (extra: Partial<OwnerCompanyLink>) => ({ is_active: false, valid_from: '2026-01-01', valid_to: null, ...extra });
    expect(linkPhase(link({ is_active: true }), '2026-06-01')).toBe('active');
    expect(linkPhase(link({ valid_from: '2026-09-01' }), '2026-06-01')).toBe('upcoming');
    expect(linkPhase(link({ valid_from: '2026-09-01', valid_to: '2026-10-01' }), '2026-06-01')).toBe('upcoming');
    expect(linkPhase(link({ valid_to: '2026-03-01' }), '2026-06-01')).toBe('ended');
    expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
