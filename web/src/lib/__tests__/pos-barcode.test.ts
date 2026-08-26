import { describe, expect, it } from 'vitest';
import { appendPosCartProduct, matchPosBarcode } from '@/lib/pos-barcode';

const product = {
  id: 'product-1',
  sku: 'SKU-001',
  barcode: '6281234567890',
  name: 'منتج اختبار',
  tax_rate: 15,
  pos_barcodes: [{ code: 'CARTON-001', unit_name: 'carton', default_quantity: 12 }],
};

describe('مطابقة باركود POS', () => {
  it('يطابق SKU والباركود الأساسيين بوحدة الأساس', () => {
    expect(matchPosBarcode([product], ' SKU-001 ')).toEqual({ product, unitName: null, quantity: 1, kind: 'base' });
    expect(matchPosBarcode([product], '6281234567890')).toEqual({ product, unitName: null, quantity: 1, kind: 'base' });
  });

  it('يطابق الباركود البديل بوحدته وكميته المحددتين', () => {
    expect(matchPosBarcode([product], 'CARTON-001')).toEqual({ product, unitName: 'carton', quantity: 12, kind: 'alternate' });
  });

  it('يعيد null لباركود غير معروف ولا يغير السلة', () => {
    expect(matchPosBarcode([product], 'UNKNOWN')).toBeNull();
  });

  it('يبقي منطق السلة كما هو: ينشئ السطر ثم يزيد كمية الوحدة المطابقة فقط', () => {
    const baseUnit = { name: 'piece', price: '10.00' };
    const first = appendPosCartProduct([], product, baseUnit, 1);
    const second = appendPosCartProduct(first, product, baseUnit, 3);
    const carton = appendPosCartProduct(second, product, { name: 'carton', price: '100.00' }, 12);

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ productId: product.id, unit: 'piece', qty: 4, price: '10.00' });
    expect(carton).toHaveLength(2);
    expect(carton[1]).toMatchObject({ productId: product.id, unit: 'carton', qty: 12, price: '100.00' });
  });
});
