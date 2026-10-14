import { describe, expect, it } from 'vitest';
import { branchLabel, readBranchNames, readIngressPoints, type IngressPoint } from './signed-ingress';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'acc-1',
  delivery_platform_profile_id: 'prof-1',
  platform_key: 'keeta',
  external_store_id: 'store-100',
  branch_id: 'br-1',
  configured_by: 'user-9',
  operated_by: 'user-8',
  status: 'configured',
  secret_prefix: 'SENTINEL_PREFIX',
  secret_version: 2,
  disabled_at: null,
  created_at: '2026-10-01T08:00:00Z',
  ...over,
});

describe('readIngressPoints (allow-list reader)', () => {
  it('keeps only the approved fields — nothing secret-bearing or user-identifying reaches the result', () => {
    const points = readIngressPoints({ data: [row({ secret: 'SENTINEL_SECRET', token: 'SENTINEL_TOKEN', signing_key: 'SENTINEL_KEY' })] }, 'keeta');
    expect(points).toEqual([{ id: 'acc-1', storeId: 'store-100', branchId: 'br-1', status: 'configured', secretVersion: 2, createdAt: '2026-10-01T08:00:00Z', disabledAt: null }]);
    const serialized = JSON.stringify(points);
    for (const leak of ['SENTINEL', 'user-9', 'user-8', 'prof-1', 'secret_prefix', 'configured_by', 'operated_by']) expect(serialized).not.toContain(leak);
  });

  it('returns only the displayed platform and ignores other (well-formed) platforms', () => {
    const points = readIngressPoints({ data: [row(), row({ id: 'acc-2', platform_key: 'jahez', external_store_id: 'other' })] }, 'keeta');
    expect(points?.map((p) => p.storeId)).toEqual(['store-100']);
  });

  it('an empty list is a real empty result, a non-list is unreadable (null), never empty', () => {
    expect(readIngressPoints({ data: [] }, 'keeta')).toEqual([]);
    expect(readIngressPoints({ data: [row({ platform_key: 'jahez' })] }, 'keeta')).toEqual([]);
    for (const bad of [null, undefined, {}, { data: null }, { data: 'x' }, { data: {} }, []]) expect(readIngressPoints(bad, 'keeta')).toBeNull();
  });

  it('is fail-closed on malformed rows of the displayed platform and on malformed row envelopes', () => {
    const bad: Record<string, unknown>[] = [
      { id: 7 }, { id: 'has space' }, { id: '' },
      { external_store_id: '' }, { external_store_id: 5 }, { external_store_id: ' padded ' }, { external_store_id: 'a\nb' }, { external_store_id: 'x'.repeat(192) },
      { status: 'active' }, { status: null }, { status: 'CONFIGURED' },
      { secret_version: 0 }, { secret_version: -1 }, { secret_version: 1.5 }, { secret_version: '2' }, { secret_version: null },
      { branch_id: 5 }, { branch_id: '' }, { branch_id: 'a b' }, { branch_id: undefined },
    ];
    for (const over of bad) expect(readIngressPoints({ data: [row(over)] }, 'keeta'), JSON.stringify(over)).toBeNull();
    for (const envelope of [[null], ['x'], [[]], [{ no_platform: true }], [{ platform_key: 5 }]]) {
      expect(readIngressPoints({ data: envelope }, 'keeta')).toBeNull();
    }
    expect(readIngressPoints({ data: [row(), row()] }, 'keeta')).toBeNull();
  });

  it('descriptive dates degrade to null without failing the read', () => {
    const [point] = readIngressPoints({ data: [row({ created_at: 'not a date', disabled_at: 12 })] }, 'keeta')!;
    expect(point.createdAt).toBeNull();
    expect(point.disabledAt).toBeNull();
  });

  it('keeps an unrouted point and a disabled point as they are', () => {
    const points = readIngressPoints({ data: [row({ id: 'a', branch_id: null }), row({ id: 'b', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z', external_store_id: 's2' })] }, 'keeta')!;
    expect(points[0].branchId).toBeNull();
    expect(points[1]).toMatchObject({ status: 'disabled', disabledAt: '2026-10-05T00:00:00Z' });
  });
});

describe('readBranchNames', () => {
  it('maps id → name, skipping malformed branch rows, and is null for a non-list', () => {
    const names = readBranchNames({ data: [{ id: 'br-1', name: 'Dammam', extra: 'x' }, { id: 'br-2' }, { id: 'a b', name: 'bad' }, { id: 'br-3', name: 'Line\nbreak' }] });
    expect([...names!]).toEqual([['br-1', 'Dammam']]);
    expect(readBranchNames({ data: 'x' })).toBeNull();
    expect(readBranchNames(null)).toBeNull();
  });
});

describe('branchLabel', () => {
  const point = (branchId: string | null): IngressPoint => ({ id: 'a', storeId: 's', branchId, status: 'configured', secretVersion: 1, createdAt: null, disabledAt: null });
  const names = new Map([['br-1', 'Dammam']]);

  it('without branches.view it is neutral and leaks neither name nor id', () => {
    expect(branchLabel(point('br-1'), false, names)).toEqual({ kind: 'routed' });
    expect(branchLabel(point('br-1'), false, null)).toEqual({ kind: 'routed' });
    expect(JSON.stringify(branchLabel(point('br-1'), false, names))).not.toMatch(/Dammam|br-1/);
  });
  it('with branches.view it shows the authorized name only, otherwise "unavailable" (never the id)', () => {
    expect(branchLabel(point('br-1'), true, names)).toEqual({ kind: 'named', name: 'Dammam' });
    expect(branchLabel(point('br-9'), true, names)).toEqual({ kind: 'unavailable' });
    expect(branchLabel(point('br-1'), true, null)).toEqual({ kind: 'unavailable' });
  });
  it('an unrouted point is unrouted regardless of permission', () => {
    expect(branchLabel(point(null), false, null)).toEqual({ kind: 'unrouted' });
    expect(branchLabel(point(null), true, names)).toEqual({ kind: 'unrouted' });
  });
});
