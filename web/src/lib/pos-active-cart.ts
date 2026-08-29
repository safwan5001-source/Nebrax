/**
 * نموذج سلات POS النشطة — دوال نقية بلا React.
 * اللقطة المحلية والـ hook يستهلكان نفس المصدر حتى لا يتفرّع العقد.
 */

import type { PosCustomer } from '@/components/pos/customer-picker';

export interface PosCartLine {
  key: string;
  productId: string | null;
  description: string;
  sku: string | null;
  unit: string | null;
  price: string;
  qty: number;
  tax: number;
  discount: string;
}

export interface PosActiveCart {
  id: string;
  /** هوية الخادم للسجل append-only؛ تبقى مستقلة عن مفتاح الواجهة المحلي. */
  auditCartId?: string | null;
  number: number;
  items: PosCartLine[];
  customer: PosCustomer | null;
  note: string;
  taxInclusive: boolean;
}

function id(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createPosActiveCart(number: number, taxInclusive: boolean): PosActiveCart {
  return { id: id(), auditCartId: null, number, items: [], customer: null, note: '', taxInclusive };
}

export function cartHasUnsavedData(cart: PosActiveCart): boolean {
  return cart.items.length > 0 || cart.customer !== null || cart.note.trim().length > 0;
}

/** تضمن أن استعادة عملية معلّقة لا تنسخ السلة نفسها عند النقر المتكرر. */
export function appendPosActiveCart(carts: PosActiveCart[], cart: PosActiveCart): PosActiveCart[] {
  return carts.some((current) => current.id === cart.id) ? carts : [...carts, cart];
}

/** إغلاق سلة لا يترك شاشة بلا سلة؛ آخر سلة تُستبدل بمسودة جديدة مستقلة. */
export function closePosActiveCart(
  carts: PosActiveCart[],
  activeId: string,
  idToClose: string,
  defaultTaxInclusive: boolean,
): { carts: PosActiveCart[]; activeId: string } {
  const remaining = carts.filter((cart) => cart.id !== idToClose);
  if (remaining.length > 0) {
    return { carts: remaining, activeId: idToClose === activeId ? remaining[0].id : activeId };
  }

  const fresh = createPosActiveCart(1, defaultTaxInclusive);
  return { carts: [fresh], activeId: fresh.id };
}
