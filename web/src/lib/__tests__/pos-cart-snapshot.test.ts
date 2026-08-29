import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  POS_CART_SNAPSHOT_TTL_MS,
  POS_PENDING_ATTEMPT_TTL_MS,
  buildPosCartStorageKey,
  markSaleClearedSync,
  parsePosCartSnapshot,
  serializePosCartSnapshot,
  type PosCartSnapshotScope,
} from '@/lib/pos-cart-snapshot';
import type { PosActiveCart } from '@/lib/pos-active-cart';

const scope: PosCartSnapshotScope = {
  tenantId: 'tenant-a',
  branchId: 'branch-a',
  deviceId: 'device-a',
  warehouseId: 'wh-a',
  shiftId: 'shift-a',
  sessionId: 'session-a',
  userId: 'user-a',
};

const first: PosActiveCart = {
  id: 'cart-a', number: 1, items: [], customer: null, note: '', taxInclusive: false,
};
const second: PosActiveCart = {
  id: 'cart-b',
  number: 2,
  items: [{
    key: 'line-b',
    productId: 'product-b',
    description: 'منتج ب',
    sku: 'B',
    unit: 'piece',
    price: '100',
    qty: 2,
    tax: 15,
    discount: '0',
  }],
  customer: { id: 'c1', name: 'عميل' },
  note: 'ملاحظة',
  taxInclusive: true,
};

describe('pos-cart-snapshot', () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('يبني مفتاح تخزين مقيّداً بالنطاق', () => {
    expect(buildPosCartStorageKey(scope)).toBe(
      'nibras_pos_active_carts:tenant-a:branch-a:device-a:wh-a:shift-a:session-a:user-a',
    );
  });

  it('يستعيد لقطة v1 صالحة بنفس النطاق', () => {
    const now = 1_700_000_000_000;
    const raw = serializePosCartSnapshot({
      scope,
      carts: [first, second],
      activeId: second.id,
      pendingAttempt: { cartId: second.id, attemptId: '11111111-1111-4111-8111-111111111111', savedAt: now },
      now,
    });
    const parsed = parsePosCartSnapshot(raw, scope, false, now);
    expect(parsed.status).toBe('restored');
    expect(parsed.activeId).toBe(second.id);
    expect(parsed.carts).toHaveLength(2);
    expect(parsed.pendingAttempt?.attemptId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('يرفض اختلاف إصدار المخطط', () => {
    const raw = JSON.stringify({
      v: 99,
      savedAt: Date.now(),
      scope,
      carts: [first],
      activeId: first.id,
    });
    expect(parsePosCartSnapshot(raw, scope, false).status).toBe('ignored_invalid');
  });

  it('يرفض TTL منتهية للسلة', () => {
    const savedAt = 1_000_000;
    const raw = serializePosCartSnapshot({
      scope,
      carts: [second],
      activeId: second.id,
      now: savedAt,
    });
    const parsed = parsePosCartSnapshot(raw, scope, false, savedAt + POS_CART_SNAPSHOT_TTL_MS + 1);
    expect(parsed.status).toBe('ignored_stale');
    expect(parsed.carts[0].id).not.toBe(second.id);
  });

  it('يتجاهل نطاقاً مختلفاً (مستأجر/فرع)', () => {
    const raw = serializePosCartSnapshot({
      scope,
      carts: [second],
      activeId: second.id,
    });
    const other = { ...scope, tenantId: 'other-tenant' };
    expect(parsePosCartSnapshot(raw, other, false).status).toBe('ignored_scope');
  });

  it('يتهاجر الشكل القديم بلا إصدار مرة واحدة', () => {
    const legacy = JSON.stringify({ carts: [first, second], activeId: second.id });
    const parsed = parsePosCartSnapshot(legacy, scope, false);
    expect(parsed.status).toBe('restored');
    expect(parsed.activeId).toBe(second.id);
    expect(parsed.pendingAttempt).toBeNull();
  });

  it('يسقط pendingAttempt بعد انتهاء TTL الخاص به دون رفض السلة', () => {
    const savedAt = 2_000_000;
    const raw = serializePosCartSnapshot({
      scope,
      carts: [second],
      activeId: second.id,
      pendingAttempt: { cartId: second.id, attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', savedAt },
      now: savedAt,
    });
    const parsed = parsePosCartSnapshot(raw, scope, false, savedAt + POS_PENDING_ATTEMPT_TTL_MS + 1);
    expect(parsed.status).toBe('restored');
    expect(parsed.pendingAttempt).toBeNull();
  });

  it('يمسح السلة المباعة وpendingAttempt بشكل متزامن', () => {
    const key = buildPosCartStorageKey(scope);
    const now = Date.now();
    memory.set(key, serializePosCartSnapshot({
      scope,
      carts: [first, second],
      activeId: second.id,
      pendingAttempt: { cartId: second.id, attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', savedAt: now },
      now,
    }));
    const next = markSaleClearedSync({
      storageKey: key,
      scope,
      carts: [first, second],
      activeId: second.id,
      soldCartId: second.id,
      defaultTaxInclusive: false,
      now,
    });
    expect(next.carts).toEqual([first]);
    expect(next.activeId).toBe(first.id);
    const stored = parsePosCartSnapshot(memory.get(key), scope, false, now);
    expect(stored.status).toBe('restored');
    expect(stored.carts).toEqual([first]);
    expect(stored.pendingAttempt).toBeNull();
  });
});
