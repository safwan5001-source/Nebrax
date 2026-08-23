import { describe, expect, it } from 'vitest';
import {
  appendPosActiveCart,
  cartHasUnsavedData,
  closePosActiveCart,
  type PosActiveCart,
  parseStoredPosActiveCarts,
} from './use-pos-active-carts';

const first: PosActiveCart = {
  id: 'cart-a', number: 1, items: [], customer: null, note: '', taxInclusive: false,
};
const second: PosActiveCart = {
  id: 'cart-b', number: 2,
  items: [{ key: 'line-b', productId: 'product-b', description: 'منتج ب', sku: 'B', unit: 'piece', price: '100', qty: 2, tax: 15, discount: '0' }],
  customer: null, note: 'ملاحظة السلة ب', taxInclusive: true,
};

describe('السلات النشطة في POS', () => {
  it('يحفظ السلات المستقلة ويستعيد السلة النشطة فقط من حمولة صالحة', () => {
    const restored = parseStoredPosActiveCarts(JSON.stringify({ carts: [first, second], activeId: second.id }));

    expect(restored).toEqual({ carts: [first, second], activeId: second.id });
    expect(restored?.carts[0].items).toEqual([]);
    expect(restored?.carts[1].items).toHaveLength(1);
    expect(restored?.carts[1].note).toBe('ملاحظة السلة ب');
    expect(restored?.carts[0].taxInclusive).toBe(false);
    expect(restored?.carts[1].taxInclusive).toBe(true);
  });

  it('يرفض التخزين المعطوب أو السلة النشطة غير الموجودة بدلاً من خلط مسودات جلسة أخرى', () => {
    expect(parseStoredPosActiveCarts('{not-json')).toBeNull();
    expect(parseStoredPosActiveCarts(JSON.stringify({ carts: [first], activeId: 'missing' }))).toBeNull();
    expect(parseStoredPosActiveCarts(JSON.stringify({ carts: [], activeId: first.id }))).toBeNull();
  });

  it('لا يضيف السلة نفسها مرتين عند استعادة بيع معلّق ثم النقر المتكرر', () => {
    expect(appendPosActiveCart([first], first)).toEqual([first]);
    expect(appendPosActiveCart([first], second)).toEqual([first, second]);
  });

  it('يغلق السلة المستهدفة فقط وينقل التركيز بصورة محددة ولا يحذف آخر مسودة', () => {
    const afterActiveClose = closePosActiveCart([first, second], second.id, second.id, false);
    expect(afterActiveClose).toEqual({ carts: [first], activeId: first.id });

    const afterInactiveClose = closePosActiveCart([first, second], first.id, second.id, false);
    expect(afterInactiveClose).toEqual({ carts: [first], activeId: first.id });

    const afterLastClose = closePosActiveCart([first], first.id, first.id, true);
    expect(afterLastClose.carts).toHaveLength(1);
    expect(afterLastClose.carts[0].id).not.toBe(first.id);
    expect(afterLastClose.carts[0].number).toBe(1);
    expect(afterLastClose.carts[0].taxInclusive).toBe(true);
    expect(afterLastClose.activeId).toBe(afterLastClose.carts[0].id);
  });

  it('يميز المسودة التي تتطلب تحذيراً قبل إغلاق الجلسة أو الخروج', () => {
    expect(cartHasUnsavedData(first)).toBe(false);
    expect(cartHasUnsavedData(second)).toBe(true);
    expect(cartHasUnsavedData({ ...first, customer: { id: 'customer-a', name: 'عميل' } as PosActiveCart['customer'] })).toBe(true);
  });
});
