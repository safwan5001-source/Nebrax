import { describe, expect, it } from 'vitest';
import type { PosCartLine } from '@/lib/pos-active-cart';
import { planPosCartUnitChange } from '@/lib/pos-unit-change';

const units = [
  { name: 'حبة', price: '5.00' },
  { name: 'كرتون', price: '40.00' },
];

function line(patch: Partial<PosCartLine> & Pick<PosCartLine, 'key' | 'unit'>): PosCartLine {
  return {
    productId: 'p1',
    description: 'ماء',
    sku: null,
    price: '5.00',
    qty: 1,
    tax: 15,
    discount: '1.25',
    ...patch,
  };
}

describe('planPosCartUnitChange', () => {
  it('يبقي التحديد على السطر بعد إعادة كتابة المفتاح ولا يعطّل الشريط', () => {
    const items = [line({ key: 'p1:-:حبة', unit: 'حبة', qty: 2, price: '5.00' })];
    const plan = planPosCartUnitChange(items, 'p1:-:حبة', 'كرتون', units);

    expect(plan?.selectedKey).toBe('p1:كرتون');
    expect(plan?.items.map((item) => item.key)).toEqual(['p1:كرتون']);
    expect(plan?.items.find((item) => item.key === plan.selectedKey)).toMatchObject({
      unit: 'كرتون',
      price: '40.00',
      qty: 2,
      discount: '1.25',
    });
    expect(plan?.selectedKey).not.toBe('p1:-:حبة');
  });

  it('ينقل التحديد إلى السطر المدموج ويجمع الكمية دون استبدال سعر السطر القائم', () => {
    const items = [
      line({ key: 'p1:-:حبة', unit: 'حبة', qty: 2, price: '5.00' }),
      line({ key: 'p1:-:كرتون', unit: 'كرتون', qty: 4, price: '39.50' }),
    ];
    const plan = planPosCartUnitChange(items, 'p1:-:حبة', 'كرتون', units);

    expect(plan?.selectedKey).toBe('p1:-:كرتون');
    expect(plan?.items).toHaveLength(1);
    expect(plan?.items[0]).toMatchObject({ key: 'p1:-:كرتون', qty: 6, price: '39.50', unit: 'كرتون' });
    expect(plan?.items.some((item) => item.key === 'p1:-:حبة')).toBe(false);
  });

  it('لا يخطط تغييراً حين الوحدة لم تتبدل أو المنتج بلا وحدات', () => {
    const items = [line({ key: 'p1:-:حبة', unit: 'حبة' })];
    expect(planPosCartUnitChange(items, 'p1:-:حبة', 'حبة', units)).toBeNull();
    expect(planPosCartUnitChange(items, 'p1:-:حبة', 'كرتون', undefined)).toBeNull();
    expect(planPosCartUnitChange(items, 'missing', 'كرتون', units)).toBeNull();
  });
});
