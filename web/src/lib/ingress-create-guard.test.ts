import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearUnconfirmedCreate,
  createGuardScope,
  findUnconfirmedCreate,
  listUnconfirmedCreates,
  recordUnconfirmedCreate,
  resetUnconfirmedCreatesForTests,
} from './ingress-create-guard';

const entry = (over: Partial<Parameters<typeof recordUnconfirmedCreate>[1]> = {}) => ({ platformKey: 'keeta', profileId: 'p1', storeId: 'Store-100', at: 1, ...over });

beforeEach(resetUnconfirmedCreatesForTests);

describe('ingress create guard (in-memory only)', () => {
  it('matches the same platform + store ID (trimmed), and nothing else', () => {
    const scope = createGuardScope({ id: 'u1', tenant_id: 't1' });
    recordUnconfirmedCreate(scope, entry());
    expect(findUnconfirmedCreate(scope, 'keeta', 'Store-100')).not.toBeNull();
    expect(findUnconfirmedCreate(scope, 'keeta', '  Store-100  ')).not.toBeNull();
    expect(findUnconfirmedCreate(scope, 'keeta', 'Store-200')).toBeNull();
    expect(findUnconfirmedCreate(scope, 'jahez', 'Store-100')).toBeNull();
    expect(findUnconfirmedCreate(scope, 'keeta', 'store-100')).toBeNull();
  });

  it('is scoped to tenant + user: another user or tenant is not blocked', () => {
    recordUnconfirmedCreate(createGuardScope({ id: 'u1', tenant_id: 't1' }), entry());
    expect(findUnconfirmedCreate(createGuardScope({ id: 'u2', tenant_id: 't1' }), 'keeta', 'Store-100')).toBeNull();
    expect(findUnconfirmedCreate(createGuardScope({ id: 'u1', tenant_id: 't2' }), 'keeta', 'Store-100')).toBeNull();
    expect(findUnconfirmedCreate(createGuardScope(null), 'keeta', 'Store-100')).toBeNull();
  });

  it('lists a platform\'s blocked IDs oldest first, and clears only the one asked for', () => {
    const scope = createGuardScope({ id: 'u1', tenant_id: 't1' });
    recordUnconfirmedCreate(scope, entry({ storeId: 'B', at: 2 }));
    recordUnconfirmedCreate(scope, entry({ storeId: 'A', at: 1 }));
    recordUnconfirmedCreate(scope, entry({ platformKey: 'jahez', storeId: 'J', at: 3 }));
    expect(listUnconfirmedCreates(scope, 'keeta').map((e) => e.storeId)).toEqual(['A', 'B']);
    clearUnconfirmedCreate(scope, 'keeta', 'A');
    expect(listUnconfirmedCreates(scope, 'keeta').map((e) => e.storeId)).toEqual(['B']);
    expect(listUnconfirmedCreates(scope, 'jahez')).toHaveLength(1);
  });

  it('holds no secret and no response data: only platform, profile id, the user\'s own store ID and a timestamp', () => {
    const scope = createGuardScope({ id: 'u1', tenant_id: 't1' });
    recordUnconfirmedCreate(scope, entry());
    expect(Object.keys(listUnconfirmedCreates(scope, 'keeta')[0]).sort()).toEqual(['at', 'platformKey', 'profileId', 'storeId']);
  });

  it('the source touches no storage, network, cookie or logging (nothing survives a reload by design)', () => {
    const code = readFileSync(fileURLToPath(new URL('./ingress-create-guard.ts', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|window\.|fetch\s*\(|XMLHttpRequest|sendBeacon|console\.|\bapi\s*[<(]/);
  });
});
