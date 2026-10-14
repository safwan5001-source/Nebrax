import { describe, expect, it } from 'vitest';
import { STORE_ID_MAX_BYTES, checkStoreId, readBranchOptions } from './ingress-create';
import { readActiveProfileIds } from './integration-center';

describe('checkStoreId', () => {
  it('trims, requires a value, and returns the exact string to send', () => {
    expect(checkStoreId('  Store-100  ')).toEqual({ ok: true, value: 'Store-100' });
    expect(checkStoreId('')).toEqual({ ok: false, problem: 'required' });
    expect(checkStoreId(' \t ')).toEqual({ ok: false, problem: 'required' });
  });

  it('rejects control characters inside (the panel reader would otherwise reject the created point)', () => {
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u001fb', 'a\u007fb', 'a\tb']) {
      expect(checkStoreId(bad), JSON.stringify(bad)).toEqual({ ok: false, problem: 'invalidChars' });
    }
  });

  it('limits by bytes like the server (strlen), not by characters', () => {
    expect(STORE_ID_MAX_BYTES).toBe(191);
    expect(checkStoreId('a'.repeat(191)).ok).toBe(true);
    expect(checkStoreId('a'.repeat(192))).toEqual({ ok: false, problem: 'tooLong' });
    expect(checkStoreId('م'.repeat(95)).ok).toBe(true); // 190 bytes
    expect(checkStoreId('م'.repeat(96))).toEqual({ ok: false, problem: 'tooLong' }); // 192 bytes, 96 characters
  });
});

describe('readBranchOptions', () => {
  it('keeps active branches only, and keeps nothing it cannot read', () => {
    expect(readBranchOptions({ data: [
      { id: 'b1', name: 'Dammam', is_active: true },
      { id: 'b2', name: 'Closed', is_active: false },
      { id: 'b3', name: '   ', is_active: true },
      { id: 'b4', name: 'Khobar' },
    ] })).toEqual([{ id: 'b1', name: 'Dammam' }, { id: 'b4', name: 'Khobar' }]);
  });

  it('a malformed payload is unreadable, not "no branches"', () => {
    expect(readBranchOptions(null)).toBeNull();
    expect(readBranchOptions({ data: 'x' })).toBeNull();
    expect(readBranchOptions({ data: [{ id: 'bad id/x', name: 'A' }] })).toBeNull();
    expect(readBranchOptions({ data: [null] })).toBeNull();
    expect(readBranchOptions({ data: [] })).toEqual([]);
  });
});

describe('readActiveProfileIds', () => {
  it('maps each known platform to its active profile id; inactive or unknown platforms are absent', () => {
    const result = readActiveProfileIds({ data: [
      { id: 'p-keeta', platform_key: 'keeta', is_active: true },
      { id: 'p-jahez', platform_key: 'jahez', is_active: false },
      { id: 'p-x', platform_key: 'not_a_platform', is_active: true },
    ] });
    expect([...(result ?? [])]).toEqual([['keeta', 'p-keeta']]);
  });

  it('the first active profile wins; an inactive one never hides an active one', () => {
    const result = readActiveProfileIds({ data: [
      { id: 'old', platform_key: 'keeta', is_active: false },
      { id: 'a', platform_key: 'keeta', is_active: true },
      { id: 'b', platform_key: 'keeta', is_active: true },
    ] });
    expect(result?.get('keeta')).toBe('a');
  });

  it('a malformed payload, a non-boolean flag, or an active row with an unusable id makes the whole read unreadable', () => {
    expect(readActiveProfileIds(null)).toBeNull();
    expect(readActiveProfileIds({ data: [{ id: 'p', platform_key: 'keeta', is_active: 'yes' }] })).toBeNull();
    expect(readActiveProfileIds({ data: [{ id: 'a/b', platform_key: 'keeta', is_active: true }] })).toBeNull();
    expect(readActiveProfileIds({ data: [{ platform_key: 'keeta', is_active: true }] })).toBeNull();
    expect(readActiveProfileIds({ data: [{ id: 'p', is_active: true }] })).toBeNull();
  });
});
