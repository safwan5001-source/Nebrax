/**
 * لقطة سلات POS النشطة — مسودة واجهة فقط لإعادة بناء UX بعد refresh/crash.
 * ليست مصدر حقيقة مالية؛ الخادم يعيد التحقق عند checkout/hold.
 */

import {
  cartHasUnsavedData,
  closePosActiveCart,
  createPosActiveCart,
  type PosActiveCart,
  type PosCartLine,
} from '@/lib/pos-active-cart';
import type { PosCustomer } from '@/components/pos/customer-picker';

export const POS_CART_SNAPSHOT_VERSION = 1;
/** عمر معقول لمسودة سلة غير مكتملة (24 ساعة). */
export const POS_CART_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
/** عمر محاولة دفع معلّقة غامضة لإعادة استخدام مفتاح #559 (ساعتان). */
export const POS_PENDING_ATTEMPT_TTL_MS = 2 * 60 * 60 * 1000;

export interface PosCartSnapshotScope {
  tenantId: string;
  branchId: string;
  deviceId: string;
  warehouseId: string;
  shiftId: string;
  sessionId: string;
  userId: string;
}

export interface PosPendingCheckoutAttempt {
  cartId: string;
  attemptId: string;
  savedAt: number;
}

export interface PosCartSnapshot {
  v: number;
  savedAt: number;
  scope: PosCartSnapshotScope;
  carts: PosActiveCart[];
  activeId: string;
  pendingAttempt?: PosPendingCheckoutAttempt | null;
}

export type PosCartRestoreStatus =
  | 'restored'
  | 'fresh'
  | 'ignored_stale'
  | 'ignored_invalid'
  | 'ignored_scope';

export interface PosCartParseResult {
  status: PosCartRestoreStatus;
  carts: PosActiveCart[];
  activeId: string;
  pendingAttempt: PosPendingCheckoutAttempt | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPosCustomer(value: unknown): value is PosCustomer {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isPosCartLine(value: unknown): value is PosCartLine {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string'
    && (value.productId === null || typeof value.productId === 'string')
    && typeof value.description === 'string'
    && (value.sku === null || typeof value.sku === 'string')
    && (value.unit === null || typeof value.unit === 'string')
    && typeof value.price === 'string'
    && typeof value.qty === 'number'
    && Number.isFinite(value.qty)
    && typeof value.tax === 'number'
    && Number.isFinite(value.tax)
    && typeof value.discount === 'string'
  );
}

function isPosActiveCart(value: unknown): value is PosActiveCart {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.number !== 'number') return false;
  if (!Array.isArray(value.items) || !value.items.every(isPosCartLine)) return false;
  if (typeof value.note !== 'string' || typeof value.taxInclusive !== 'boolean') return false;
  if (!(value.customer === null || isPosCustomer(value.customer))) return false;
  if (!(value.auditCartId === undefined || value.auditCartId === null || typeof value.auditCartId === 'string')) {
    return false;
  }
  return true;
}

function isScope(value: unknown): value is PosCartSnapshotScope {
  if (!isRecord(value)) return false;
  return (
    typeof value.tenantId === 'string'
    && typeof value.branchId === 'string'
    && typeof value.deviceId === 'string'
    && typeof value.warehouseId === 'string'
    && typeof value.shiftId === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.userId === 'string'
  );
}

function scopesEqual(a: PosCartSnapshotScope, b: PosCartSnapshotScope): boolean {
  return (
    a.tenantId === b.tenantId
    && a.branchId === b.branchId
    && a.deviceId === b.deviceId
    && a.warehouseId === b.warehouseId
    && a.shiftId === b.shiftId
    && a.sessionId === b.sessionId
    && a.userId === b.userId
  );
}

function normalizePendingAttempt(
  value: unknown,
  carts: PosActiveCart[],
  now: number,
): PosPendingCheckoutAttempt | null {
  if (!isRecord(value)) return null;
  if (typeof value.cartId !== 'string' || typeof value.attemptId !== 'string') return null;
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return null;
  if (now - value.savedAt > POS_PENDING_ATTEMPT_TTL_MS) return null;
  if (!carts.some((cart) => cart.id === value.cartId)) return null;
  return { cartId: value.cartId, attemptId: value.attemptId, savedAt: value.savedAt };
}

export function buildPosCartStorageKey(scope: PosCartSnapshotScope): string {
  return [
    'nibras_pos_active_carts',
    scope.tenantId,
    scope.branchId,
    scope.deviceId,
    scope.warehouseId,
    scope.shiftId,
    scope.sessionId,
    scope.userId,
  ].join(':');
}

export function buildPosCartSnapshotScope(input: {
  tenantId: string;
  userId: string;
  branchId?: string | null;
  session: {
    id: string;
    pos_device_id?: string | null;
    warehouse_id?: string | null;
    shift_id?: string | null;
  };
}): PosCartSnapshotScope {
  return {
    tenantId: input.tenantId,
    branchId: input.branchId ?? 'main',
    deviceId: input.session.pos_device_id ?? 'no-device',
    warehouseId: input.session.warehouse_id ?? 'no-warehouse',
    shiftId: input.session.shift_id ?? 'no-shift',
    sessionId: input.session.id,
    userId: input.userId,
  };
}

function emptyResult(
  status: PosCartRestoreStatus,
  defaultTaxInclusive: boolean,
): PosCartParseResult {
  const fresh = createPosActiveCart(1, defaultTaxInclusive);
  return { status, carts: [fresh], activeId: fresh.id, pendingAttempt: null };
}

/**
 * يقرأ لقطة v1 أو يهاجر الشكل القديم `{carts,activeId}` مرة واحدة ضمن النطاق المتوقع.
 * عند أي رفض يُفضَّل البدء بسلة جديدة بدلاً من خلط مستأجر/فرع آخر.
 */
export function parsePosCartSnapshot(
  raw: string | null | undefined,
  expectedScope: PosCartSnapshotScope,
  defaultTaxInclusive: boolean,
  now = Date.now(),
): PosCartParseResult {
  if (!raw) return emptyResult('fresh', defaultTaxInclusive);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyResult('ignored_invalid', defaultTaxInclusive);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.carts) || typeof parsed.activeId !== 'string') {
    return emptyResult('ignored_invalid', defaultTaxInclusive);
  }

  const carts = parsed.carts.filter(isPosActiveCart);
  if (carts.length === 0 || !carts.some((cart) => cart.id === parsed.activeId)) {
    return emptyResult('ignored_invalid', defaultTaxInclusive);
  }

  // شكل قديم بلا إصدار: يُقبل فقط لأن المفتاح نفسه مقيّد بالنطاق؛ يُعاد كتابته كـ v1 لاحقاً.
  if (parsed.v === undefined) {
    return {
      status: 'restored',
      carts,
      activeId: parsed.activeId,
      pendingAttempt: null,
    };
  }

  if (parsed.v !== POS_CART_SNAPSHOT_VERSION) {
    return emptyResult('ignored_invalid', defaultTaxInclusive);
  }

  if (!isScope(parsed.scope) || !scopesEqual(parsed.scope, expectedScope)) {
    return emptyResult('ignored_scope', defaultTaxInclusive);
  }

  if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) {
    return emptyResult('ignored_invalid', defaultTaxInclusive);
  }

  if (now - parsed.savedAt > POS_CART_SNAPSHOT_TTL_MS) {
    return emptyResult('ignored_stale', defaultTaxInclusive);
  }

  return {
    status: 'restored',
    carts,
    activeId: parsed.activeId,
    pendingAttempt: normalizePendingAttempt(parsed.pendingAttempt, carts, now),
  };
}

export function serializePosCartSnapshot(input: {
  scope: PosCartSnapshotScope;
  carts: PosActiveCart[];
  activeId: string;
  pendingAttempt?: PosPendingCheckoutAttempt | null;
  now?: number;
}): string {
  const snapshot: PosCartSnapshot = {
    v: POS_CART_SNAPSHOT_VERSION,
    savedAt: input.now ?? Date.now(),
    scope: input.scope,
    carts: input.carts,
    activeId: input.activeId,
    pendingAttempt: input.pendingAttempt ?? null,
  };
  return JSON.stringify(snapshot);
}

export function writePosCartSnapshotSync(
  storageKey: string,
  payload: {
    scope: PosCartSnapshotScope;
    carts: PosActiveCart[];
    activeId: string;
    pendingAttempt?: PosPendingCheckoutAttempt | null;
    now?: number;
  },
): void {
  try {
    localStorage.setItem(storageKey, serializePosCartSnapshot(payload));
  } catch {
    // امتلاء التخزين لا يمنع البيع؛ الاستعادة تحسين استمرارية فقط.
  }
}

export function clearPosCartSnapshotSync(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

/**
 * بعد نجاح checkout: إزالة السلة المباعة فوراً من التخزين حتى لا تعود بعد reload
 * قبل اكتمال دورة React. يمسح أيضاً pendingAttempt.
 */
export function markSaleClearedSync(input: {
  storageKey: string;
  scope: PosCartSnapshotScope;
  carts: PosActiveCart[];
  activeId: string;
  soldCartId: string;
  defaultTaxInclusive: boolean;
  now?: number;
}): { carts: PosActiveCart[]; activeId: string } {
  const next = closePosActiveCart(input.carts, input.activeId, input.soldCartId, input.defaultTaxInclusive);
  writePosCartSnapshotSync(input.storageKey, {
    scope: input.scope,
    carts: next.carts,
    activeId: next.activeId,
    pendingAttempt: null,
    now: input.now,
  });
  return next;
}

export function snapshotHasRestorableWork(carts: PosActiveCart[]): boolean {
  return carts.some(cartHasUnsavedData);
}
