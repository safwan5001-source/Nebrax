import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, persistUser, type AuthUser } from '../auth';

const store = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => store.clear()),
  key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
  get length() { return store.size; },
};

const user: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'مدير النظام',
  email: 'owner@example.com',
  role: 'owner',
  permissions: ['pos.audit.view', 'pos.audit.review'],
  tenant_id: '22222222-2222-4222-8222-222222222222',
};

describe('currentUser referential stability', () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('يعيد نفس المرجع ما دامت قيمة المستخدم المخزنة لم تتغير', () => {
    persistUser(user);

    const first = currentUser();
    const second = currentUser();

    expect(first).toBe(user);
    expect(second).toBe(first);
    expect(second?.permissions).toBe(first?.permissions);
  });

  it('يحدّث المرجع عندما تتغير قيمة المستخدم المخزنة فعلياً', () => {
    persistUser(user);
    const first = currentUser();

    const changed = { ...user, permissions: [...(user.permissions ?? []), 'pos.override.approve'] };
    store.set('user', JSON.stringify(changed));
    const second = currentUser();

    expect(second).not.toBe(first);
    expect(second?.permissions).toContain('pos.override.approve');
    expect(currentUser()).toBe(second);
  });
});
