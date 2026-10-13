import { describe, expect, it } from 'vitest';
import {
  deliveryLadder,
  deliveryPlatformKeys,
  isKnownDeliveryPlatform,
  nativeStatusOf,
  readManualStatuses,
  readReadinessRows,
  type ReadinessRow,
} from '@/lib/integration-center';

/** صفوف نقطة الجاهزية كما يُعيدها الخادم اليوم (INT-READY-1): لا منصة جاهزة، وكل الأعلام false. */
const TODAY = [
  ['hungerstation', 'AWAITING_PROVIDER_APPROVAL'],
  ['jahez', 'NOT_SUPPORTED'],
  ['mrsool', 'NOT_SUPPORTED'],
  ['keeta', 'AWAITING_PROVIDER_APPROVAL'],
  ['ninja', 'NOT_SUPPORTED'],
  ['the_chefz', 'NOT_SUPPORTED'],
].map(([platform_key, ux_state]) => ({ platform_key, ux_state, connect_enabled: false, sync_enabled: false }));

function row(over: Partial<ReadinessRow> = {}): ReadinessRow {
  return {
    platformKey: 'keeta', uxState: 'AWAITING_PROVIDER_APPROVAL', connectEnabled: false, syncEnabled: false,
    technical: null, evidenceDate: null, evidenceRef: null, ...over,
  };
}

describe('platform keys', () => {
  it('are the six approved platforms in the central registry order', () => {
    expect(deliveryPlatformKeys()).toEqual(['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz']);
  });

  it('recognizes only registry keys (case-sensitive)', () => {
    expect(isKnownDeliveryPlatform('keeta')).toBe(true);
    expect(isKnownDeliveryPlatform('Keeta')).toBe(false);
    expect(isKnownDeliveryPlatform('talabat')).toBe(false);
    expect(isKnownDeliveryPlatform('')).toBe(false);
    expect(isKnownDeliveryPlatform('../keeta')).toBe(false);
  });
});

describe('readManualStatuses (step A)', () => {
  it('maps active, disabled and absent profiles; absence is a readable "unset"', () => {
    const manual = readManualStatuses({ data: [
      { platform_key: 'keeta', is_active: true },
      { platform_key: 'jahez', is_active: false },
    ] });
    expect(manual?.get('keeta')).toBe('set');
    expect(manual?.get('jahez')).toBe('disabled');
    expect(manual?.has('ninja')).toBe(false);
  });

  it('one active profile wins over a disabled duplicate, regardless of order', () => {
    expect(readManualStatuses({ data: [{ platform_key: 'keeta', is_active: false }, { platform_key: 'keeta', is_active: true }] })?.get('keeta')).toBe('set');
    expect(readManualStatuses({ data: [{ platform_key: 'keeta', is_active: true }, { platform_key: 'keeta', is_active: false }] })?.get('keeta')).toBe('set');
  });

  it('a row without a string platform_key makes either read unreadable; well-formed unknown string keys are still ignored', () => {
    for (const platform_key of [undefined, null, 7, {}]) {
      expect(readManualStatuses({ data: [{ platform_key, is_active: true }] })).toBeNull();
      expect(readReadinessRows({ data: [...TODAY, { platform_key, ux_state: 'NOT_SUPPORTED', connect_enabled: false, sync_enabled: false }] })).toBeNull();
    }
    expect(readManualStatuses({ data: [{ is_active: true }] })).toBeNull();
    expect(readManualStatuses({ data: [{ platform_key: 'talabat', is_active: true }] })?.size).toBe(0);
  });

  it('a non-object entry makes the read unreadable, never an empty list', () => {
    expect(readManualStatuses({ data: [null] })).toBeNull();
    expect(readManualStatuses({ data: ['keeta'] })).toBeNull();
    expect(readManualStatuses({ data: [[]] })).toBeNull();
    expect(readReadinessRows({ data: [...TODAY, null] })).toBeNull();
    expect(readReadinessRows({ data: [...TODAY, 'jahez'] })).toBeNull();
  });

  it('ignores rows of unknown platforms', () => {
    const manual = readManualStatuses({ data: [{ platform_key: 'talabat', is_active: true }, { platform_key: 'talabat' }] });
    expect(manual?.size).toBe(0);
  });

  it('a known platform row without a boolean flag makes the whole read unreadable, never "not set up"', () => {
    for (const is_active of ['yes', 1, 0, null, undefined]) {
      expect(readManualStatuses({ data: [{ platform_key: 'keeta', is_active }] })).toBeNull();
    }
    expect(readManualStatuses({ data: [{ platform_key: 'jahez', is_active: true }, { platform_key: 'keeta' }] })).toBeNull();
    expect(deliveryLadder('keeta', readManualStatuses({ data: [{ platform_key: 'keeta', is_active: 1 }] }), null).a).toBe('unreadable');
  });

  it('is null for an unreadable payload, never an empty success', () => {
    expect(readManualStatuses(null)).toBeNull();
    expect(readManualStatuses({})).toBeNull();
    expect(readManualStatuses({ data: {} })).toBeNull();
    expect(readManualStatuses('x')).toBeNull();
  });
});

describe('readReadinessRows and nativeStatusOf (step B)', () => {
  it('reads today\'s six rows and none is available', () => {
    const rows = readReadinessRows({ data: TODAY });
    expect(rows?.size).toBe(6);
    for (const key of deliveryPlatformKeys()) {
      expect(nativeStatusOf(rows?.get(key))).not.toBe('available');
    }
    expect(nativeStatusOf(rows?.get('hungerstation'))).toBe('pending');
    expect(nativeStatusOf(rows?.get('keeta'))).toBe('pending');
    expect(nativeStatusOf(rows?.get('jahez'))).toBe('unavailable');
    expect(nativeStatusOf(rows?.get('mrsool'))).toBe('unavailable');
    expect(nativeStatusOf(rows?.get('ninja'))).toBe('unavailable');
    expect(nativeStatusOf(rows?.get('the_chefz'))).toBe('unavailable');
  });

  it('is available only for READY_TO_CONNECT with connect_enabled=true together', () => {
    expect(nativeStatusOf(row({ uxState: 'READY_TO_CONNECT', connectEnabled: true }))).toBe('available');
    expect(nativeStatusOf(row({ uxState: 'READY_TO_CONNECT', connectEnabled: false }))).toBe('unreadable');
  });

  it('treats contradictions and unknown states as unreadable, never as ready or as unavailable', () => {
    expect(nativeStatusOf(row({ uxState: 'NOT_SUPPORTED', connectEnabled: true }))).toBe('unreadable');
    expect(nativeStatusOf(row({ uxState: 'AWAITING_PROVIDER_APPROVAL', connectEnabled: true }))).toBe('unreadable');
    expect(nativeStatusOf(row({ syncEnabled: true, connectEnabled: false }))).toBe('unreadable');
    expect(nativeStatusOf(row({ uxState: 'CONNECTED' }))).toBe('unreadable');
    expect(nativeStatusOf(row({ uxState: '' }))).toBe('unreadable');
    expect(nativeStatusOf(null)).toBe('unreadable');
    expect(nativeStatusOf(undefined)).toBe('unreadable');
  });

  it('a known row without text ux_state or boolean flags, or a missing known row, makes the whole read unreadable', () => {
    const without = (key: string) => TODAY.filter((r) => r.platform_key !== key);
    const patched = (key: string, patch: Record<string, unknown>) => TODAY.map((r) => (r.platform_key === key ? { ...r, ...patch } : r));
    expect(readReadinessRows({ data: patched('keeta', { connect_enabled: 'false' }) })).toBeNull();
    expect(readReadinessRows({ data: patched('keeta', { sync_enabled: 0 }) })).toBeNull();
    expect(readReadinessRows({ data: patched('jahez', { ux_state: undefined }) })).toBeNull();
    expect(readReadinessRows({ data: patched('jahez', { ux_state: 7 }) })).toBeNull();
    expect(readReadinessRows({ data: without('ninja') })).toBeNull();
    expect(readReadinessRows({ data: [] })).toBeNull();
  });

  it('a repeated known provider row makes the read unreadable: row order must never decide the displayed state', () => {
    const conflicting = { ...TODAY[3], ux_state: 'READY_TO_CONNECT', connect_enabled: true };
    expect(readReadinessRows({ data: [...TODAY, conflicting] })).toBeNull();
    expect(readReadinessRows({ data: [conflicting, ...TODAY] })).toBeNull();
    expect(readReadinessRows({ data: [...TODAY, TODAY[3]] })).toBeNull();
  });

  it('ignores rows of unknown platforms and is null for a non-list payload', () => {
    expect(readReadinessRows({ data: [...TODAY, { platform_key: 'talabat', ux_state: 'READY_TO_CONNECT' }] })?.size).toBe(6);
    expect(readReadinessRows(null)).toBeNull();
    expect(readReadinessRows({ data: 'x' })).toBeNull();
  });

  it('carries the internal evidence fields only when the server sent them', () => {
    const withEvidence = readReadinessRows({ data: TODAY.map((r) => (r.platform_key === 'keeta'
      ? { ...r, technical: 'OWNER_GATE', evidence_date: '2026-10-11', evidence_ref: 'docs/x.md §4.4' }
      : r)) })?.get('keeta');
    expect(withEvidence?.technical).toBe('OWNER_GATE');
    expect(withEvidence?.evidenceDate).toBe('2026-10-11');
    expect(withEvidence?.evidenceRef).toBe('docs/x.md §4.4');

    const without = readReadinessRows({ data: TODAY })?.get('keeta');
    expect(without?.technical).toBeNull();
    expect(without?.evidenceRef).toBeNull();
  });
});

describe('deliveryLadder (A/B/C/D are independent)', () => {
  const readiness = readReadinessRows({ data: TODAY });
  const manual = readManualStatuses({ data: [{ platform_key: 'keeta', is_active: true }] });

  it('manual attribution does not change native readiness, and readiness does not change manual', () => {
    expect(deliveryLadder('keeta', manual, readiness)).toEqual({ platformKey: 'keeta', a: 'set', b: 'pending', c: 'blocked', d: 'blocked' });
    expect(deliveryLadder('jahez', manual, readiness)).toEqual({ platformKey: 'jahez', a: 'unset', b: 'unavailable', c: 'blocked', d: 'blocked' });
  });

  it('a failed profiles read makes only step A unreadable', () => {
    const ladder = deliveryLadder('keeta', null, readiness);
    expect(ladder).toEqual({ platformKey: 'keeta', a: 'unreadable', b: 'pending', c: 'blocked', d: 'blocked' });
  });

  it('a failed readiness read makes B, C and D unreadable and keeps A', () => {
    const ladder = deliveryLadder('keeta', manual, null);
    expect(ladder).toEqual({ platformKey: 'keeta', a: 'set', b: 'unreadable', c: 'unreadable', d: 'unreadable' });
  });

  it('a platform missing from a readable readiness payload is unreadable, not "not available"', () => {
    const partial = readReadinessRows({ data: [TODAY[0]] });
    expect(deliveryLadder('ninja', manual, partial).b).toBe('unreadable');
  });

  it('C and D are never positive: even an available provider reports no connection data', () => {
    const available = new Map([['keeta', row({ uxState: 'READY_TO_CONNECT', connectEnabled: true })]]);
    const ladder = deliveryLadder('keeta', manual, available);
    expect(ladder.b).toBe('available');
    expect(ladder.c).toBe('no_data');
    expect(ladder.d).toBe('no_data');
  });
});
